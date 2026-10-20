/**
 * 免费层的请求形态要求。
 *
 * 免费模型不是「拿 key 就能直连」的普通 OpenAI 端点，上游对请求做多重形态
 * 校验，任一不满足就失败。所有结论均由实测二分得出，详见 README §2。
 *
 * 校验清单：
 *
 *   L1 客户端身份：缺 `user-agent` 或 `x-opencode-client` → 403 FreeTierError
 *   L2 会话形态：`x-opencode-session` 前 12 位 hex 必须是时间戳编码值
 *                （随机 hex、哈希派生的 hex 都会 500）—— 见 session-id.js
 *   L3 门禁工具：`tools` 里必须同时有 `bash` 与 `read` → 缺任一个 500
 *   L4 流式：`stream` 必须为 true
 *
 * 请求头全集（缺一不可）：
 *   Authorization: Bearer public | <key>
 *   User-Agent: opencode/1.18.31 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14 ...
 *   x-opencode-client: cli
 *   x-opencode-project: global        （任意字符串均可）
 *   x-opencode-session: <ses_...>
 *   x-client-request-id: <同 session>
 *   x-opencode-request: <msg_...>
 */
import { ensureGateTools } from './gate-tools.js';

/** 匿名公共额度使用的令牌。 */
export const ANONYMOUS_TOKEN = 'public';

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
 * opencode 客户端形态的静态身份头。
 *
 * UA 刻意带上 ai-sdk / bun 运行时片段：只写 `opencode/<version>/cli`
 * 也能过 L1，但真实客户端的 UA 就是复合形态，对齐它更稳。
 */
export function staticIdentityHeaders(clientName = 'cli', project = 'global') {
  return {
    'user-agent':
      'opencode/1.18.31 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14 dsh-opencode-zen-free/0.3.0',
    'x-opencode-client': clientName,
    'x-opencode-project': project,
  };
}
