/**
 * OpenCode 免费层的「客户端形态」要求。
 *
 * 免费模型不是「拿 key 就能直连」的普通 OpenAI 端点，上游会对请求做多重
 * 形态校验，任一不满足就返回 HTTP 500（Content-Length: 0，无响应体）。
 *
 * 逐项实测结论（详见 README §2）：
 *
 *   1. tools 数组里必须有 function.name === "bash" 与 "read" 的工具
 *      —— 缺任一个都是 500。这是免费层判断"调用方是不是真的 coding agent"
 *      的启发式。DSH 的工具命名是 ops_* 一类，不满足，所以必须补齐。
 *      补的是真实可执行工具（见 gate-tools.js），不是空占位。
 *
 *   2. x-opencode-session 必须是 OpenCode 服务端登记过的真实 session id
 *      —— 随机生成的 `ses_<hex>` 一律 500；从 opencode 本地
 *      `storage/session_diff/` 读到的历史 id 可直接用（实测 200）。
 *
 *   3. 必须有 user-agent: opencode/<channel>/<version>/<client>
 *      与 x-opencode-client: cli，否则 403 FreeTierError。
 *
 *   4. stream 必须为 true（非流式会被拒）。
 *
 * 本模块负责补齐 1、3、4，并从本地 opencode 存储里解析出 2。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ensureGateTools } from './gate-tools.js';

/**
 * 把请求体修正成免费层认可的形态。
 *
 * - 强制 stream:true 与 stream_options.include_usage
 * - 保证 tools 中同时存在 bash 与 read（已有则保留调用方的版本）
 *
 * @param {object} body OpenAI Chat Completions 请求体
 * @returns {object} 新对象，不改动入参
 */
export function enforceFreeTierShape(body) {
  if (!body || typeof body !== 'object') return body;

  const out = { ...body };
  out.stream = true;
  if (out.stream_options === undefined) {
    out.stream_options = { include_usage: true };
  }
  out.tools = ensureGateTools(out.tools);
  return out;
}

/**
 * opencode 本地数据的候选根目录。
 *
 * Windows: %USERPROFILE%\.local\share\opencode
 * macOS/Linux: ~/.local/share/opencode
 */
function opencodeDataRoots() {
  const roots = [];
  if (process.env.OPENCODE_DATA_DIR) roots.push(process.env.OPENCODE_DATA_DIR);
  roots.push(path.join(os.homedir(), '.local', 'share', 'opencode'));
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    roots.push(path.join(process.env.LOCALAPPDATA, 'opencode'));
  }
  return roots;
}

/**
 * 从 opencode 本地存储里解析一个「服务端登记过」的 session id。
 *
 * 优先取最近修改的 session_diff 文件名（这些是 opencode 真实跑过的会话）。
 *
 * @returns {{ sessionId: string, source: string } | undefined}
 */
export function discoverSessionId(logger) {
  for (const root of opencodeDataRoots()) {
    const dir = path.join(root, 'storage', 'session_diff');
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }

    const candidates = entries
      .filter((f) => f.startsWith('ses_') && f.endsWith('.json'))
      .map((f) => {
        const full = path.join(dir, f);
        let mtime = 0;
        try { mtime = fs.statSync(full).mtimeMs; } catch { /* skip */ }
        return { id: f.slice(0, -'.json'.length), mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);

    if (candidates.length > 0) {
      logger?.info?.(
        `dsh-opencode-free: 从 ${dir} 解析到 ${candidates.length} 个历史 session，使用最新的 ${candidates[0].id}`,
      );
      return { sessionId: candidates[0].id, source: dir };
    }
  }
  return undefined;
}

/** 生成 40 位 hex 的 project id（实测随机值也能通过校验）。 */
export function fallbackProjectId() {
  return Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
}
