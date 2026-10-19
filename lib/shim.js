/**
 * OpenCode 免费模型的 loopback 转发器（shim）。
 *
 * 为什么要 shim（而不是让 pi-ai 直连上游）：
 *
 *   1. 免费层对请求形态有硬性要求（`tools` 必须含 bash/read、必须流式、
 *      `x-opencode-session` 必须是时间戳编码形态）。这些必须在发往上游前
 *      补齐，而 pi-ai 没有请求体改写钩子。
 *
 *   2. 上游偶发 HTTP 500，需要比 pi-ai 默认（2 次）更强的退避重试。
 *
 * shim 只监听 127.0.0.1 的随机端口，仅接受回环连接。
 */
import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { enforceFreeTierShape, staticIdentityHeaders } from './free-tier.js';
import { SessionIdFactory, requestId } from './session-id.js';

/** 可重试的上游瞬时故障状态码。 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** 单次上游请求的 socket 空闲超时。 */
const UPSTREAM_IDLE_TIMEOUT_MS = 180000;

/** 判断 Host 头是否指向本机回环。 */
function isLoopbackHost(hostHeader) {
  if (!hostHeader) return false;
  const host = String(hostHeader).split(':')[0];
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
}

/** 发起一次上游请求。 */
function forwardOnce(upstreamUrl, method, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(upstreamUrl);
    const doRequest = url.protocol === 'https:' ? httpsRequest : httpRequest;

    const req = doRequest(url, { method, headers }, (res) => {
      resolve({ status: res.statusCode ?? 0, headers: res.headers, stream: res });
    });

    req.on('error', (error) => reject(Object.assign(error, { retryable: true })));
    req.setTimeout(UPSTREAM_IDLE_TIMEOUT_MS, () => {
      req.destroy(Object.assign(new Error('upstream idle timeout'), { retryable: true }));
    });

    if (body && body.length) req.write(body);
    req.end();
  });
}

/**
 * 创建 shim。
 *
 * @param {object} options
 * @param {() => string} options.getApiKey 取当前 Bearer 令牌
 * @param {string} options.upstreamBase 上游 baseUrl（如 .../zen/v1）
 * @param {number} [options.maxAttempts] 最大尝试次数（含首次）
 * @param {number} [options.baseDelayMs] 首次退避毫秒
 * @param {number} [options.maxDelayMs] 退避上限
 * @param {object} options.logger Cordis logger
 */
export function createOpenCodeShim(options) {
  const {
    getApiKey,
    upstreamBase,
    maxAttempts = 12,
    baseDelayMs = 400,
    maxDelayMs = 4000,
    logger,
  } = options;

  /** 每个宿主会话一个稳定的 `ses_` id，保留服务端 sticky 路由。 */
  const sessions = new SessionIdFactory();

  const server = createServer((req, res) => {
    if (!isLoopbackHost(req.headers.host)) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'loopback only', type: 'forbidden' } }));
      return;
    }

    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = Buffer.concat(chunks);
      const path = req.url || '/';

      const isChat = path.endsWith('/chat/completions');
      const isModels = path.endsWith('/models');
      if (!isChat && !isModels) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'not found', type: 'invalid_request_error' } }));
        return;
      }

      // 修正请求形态：补 bash/read、强制流式
      let hostSessionKey = 'default';
      if (isChat && body.length) {
        try {
          const parsed = JSON.parse(body.toString('utf8'));
          const shaped = enforceFreeTierShape(parsed);
          hostSessionKey = String(parsed.sessionId ?? parsed.session ?? 'default');
          body = Buffer.from(JSON.stringify(shaped), 'utf8');
        } catch (error) {
          logger?.warn?.(`dsh-opencode-free: 请求体解析失败，按原样转发：${error.message}`);
        }
      }

      const upstreamUrl = upstreamBase.replace(/\/+$/, '') + (isChat ? '/chat/completions' : '/models');

      // 派生本次会话的 opencode session id，并拼齐整套身份头
      const opencodeSession = sessions.forHostSession(hostSessionKey);
      const identity = staticIdentityHeaders();

      const headers = { ...req.headers };
      delete headers.host;
      delete headers['content-length'];
      headers['content-length'] = String(body.length);
      headers['content-type'] = 'application/json';
      headers.authorization = `Bearer ${getApiKey()}`;
      // 静态身份头
      for (const [k, v] of Object.entries(identity)) headers[k] = v;
      // 动态会话头：三者必须同值
      headers['x-opencode-session'] = opencodeSession;
      headers['x-client-request-id'] = opencodeSession;
      headers['x-opencode-request'] = requestId();

      const attemptLoop = async (attempt) => {
        let upstreamRes;
        try {
          upstreamRes = await forwardOnce(upstreamUrl, 'POST', headers, body);
        } catch (error) {
          if (attempt < maxAttempts && error.retryable) {
            const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
            logger?.warn?.(
              `dsh-opencode-free: 上游网络错误（第 ${attempt}/${maxAttempts} 次）：${error.message}；${delay}ms 后重试`,
            );
            await new Promise((r) => setTimeout(r, delay));
            return attemptLoop(attempt + 1);
          }
          throw error;
        }

        if (RETRYABLE_STATUS.has(upstreamRes.status) && attempt < maxAttempts) {
          upstreamRes.stream.resume(); // 读掉响应体以释放 socket
          const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
          logger?.warn?.(
            `dsh-opencode-free: 上游 ${upstreamRes.status}（第 ${attempt}/${maxAttempts} 次），${delay}ms 后重试`,
          );
          await new Promise((r) => setTimeout(r, delay));
          return attemptLoop(attempt + 1);
        }

        return upstreamRes;
      };

      attemptLoop(1)
        .then((upstreamRes) => {
          const outHeaders = { ...upstreamRes.headers };
          delete outHeaders['transfer-encoding'];
          delete outHeaders['content-length'];
          delete outHeaders.connection;
          res.writeHead(upstreamRes.status, outHeaders);
          upstreamRes.stream.pipe(res);
          upstreamRes.stream.on('error', () => {
            try { res.destroy(); } catch { /* ignore */ }
          });
        })
        .catch((error) => {
          if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              error: {
                message: `opencode-free shim failed after ${maxAttempts} attempts: ${error.message}`,
                type: 'upstream_error',
              },
            }),
          );
        });
    });
  });

  const ready = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      logger?.info?.(`dsh-opencode-free: loopback shim 监听 127.0.0.1:${port}`);
      resolve(port);
    });
  });

  let port = 0;
  return {
    ready,
    baseUrl() {
      return `http://127.0.0.1:${port}/v1`;
    },
    async start() {
      port = await ready;
      return port;
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
