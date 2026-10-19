/**
 * 时间戳编码的 OpenCode session id 生成。
 *
 * 这是免费层准入校验的核心，也是本模块存在的原因。
 *
 * ## 关键发现（推翻了一个流传较广的误解）
 *
 * 常有人认为 `x-opencode-session` 必须是「OpenCode 服务端登记过的真实会话」，
 * 于是插件被迫去读本机 `~/.local/share/opencode/storage/session_diff/`，
 * 或者在没装 OpenCode 的机器上直接不可用。
 *
 * **实测否定了这个结论。** 真正的规则是 `ses_` 之后前 12 位十六进制必须是
 * **时间戳编码值**，而不是任意 hex：
 *
 *   encoded = ~(timestampMs * 0x1000 + counter)     // counter 每次 +1，溢出进位
 *   hex12   = encoded & 0xffffffffffffn             // 12 位 hex
 *   id      = `ses_${hex12}${base62(random 14 bytes)}`
 *
 * 验证矩阵（同一 UA、同一 request 头，只改 session 生成方式）：
 *
 *   | session 形态                             | 结果 |
 *   |------------------------------------------|------|
 *   | 随机 hex（`ses_` + 48 hex 字符）           | 500  |
 *   | sha256 哈希派生的 hex                     | 500  |
 *   | 从本地 opencode 存储读的真实历史 id        | 200  |
 *   | **时间戳编码 + base62 尾部**               | 200  |
 *
 * 也就是说：那些「真实 id」之所以能用，是因为它们本来就长这样；不是服务端
 * 查了登记表。按同样的编码规则本地生成，效果完全等价，且不依赖本机装过
 * OpenCode。
 *
 * 附带收益：`/zen/v1` 与 `/inference/openai/v1` 两个端点都接受这个形态，
 * 而 `x-opencode-project` 可以是任意字符串（`global` 即可）。
 */
import { randomBytes } from 'node:crypto';

/** base62 字母表（opencode 用它编码 id 尾部）。 */
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** id 尾部长度：12 hex + 14 base62，与真实 opencode id 等长。 */
const TAIL_LENGTH = 14;

/** counter 上限，超出后进位到时间戳，避免同一毫秒内撞号。 */
const COUNTER_LIMIT = 0xfff;

/** 把字节序列编码成 base62 字符串。 */
function base62FromBytes(bytes, length) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const byte = bytes[i % bytes.length] ?? 0;
    out += BASE62.charAt(byte % 62);
  }
  return out;
}

/**
 * 会话 id 生成器。
 *
 * 每个宿主会话映射到一个稳定的 `ses_` id：同一次会话生命周期内多次请求
 * 复用同一个值，以保留服务端的 sticky 路由与 `reasoning.encrypted_content`
 * 重放能力；不同宿主会话拿到不同 id，互不干扰。
 */
export class SessionIdFactory {
  constructor() {
    /** 宿主会话 id → 已生成的 opencode session id。 */
    this.assigned = new Map();
    /** 上一次使用的时间戳，保证单调不减。 */
    this.lastTimestamp = -1;
    /** 同一时间戳内的序号。 */
    this.counter = 0;
  }

  /**
   * 取（或生成）一个宿主会话对应的 opencode session id。
   *
   * @param {string} hostSessionId 宿主侧的会话标识
   * @returns {string} `ses_` 前缀、26 字符尾部的 opencode 形态 id
   */
  forHostSession(hostSessionId) {
    const existing = this.assigned.get(hostSessionId);
    if (existing !== undefined) return existing;

    // 时间戳单调不减；同一毫秒内用 counter 区分，溢出则进位
    const timestamp = Math.max(Date.now(), this.lastTimestamp);
    if (timestamp !== this.lastTimestamp) this.counter = 0;
    this.lastTimestamp = timestamp;
    this.counter += 1;
    if (this.counter > COUNTER_LIMIT) {
      this.lastTimestamp += 1;
      this.counter = 1;
    }

    const encoded = ~(BigInt(this.lastTimestamp) * 0x1000n + BigInt(this.counter));
    const hex = (encoded & 0xffffffffffffn).toString(16).padStart(12, '0');
    const id = `ses_${hex}${base62FromBytes(randomBytes(TAIL_LENGTH), TAIL_LENGTH)}`;

    this.assigned.set(hostSessionId, id);
    return id;
  }

  /** 已分配的会话数量，便于测试与日志。 */
  get size() {
    return this.assigned.size;
  }
}

/**
 * 生成一个一次性的 opencode request id（`msg_` + 12 hex + 14 base62）。
 *
 * 服务端用 `x-opencode-request` 追踪单次请求，不影响准入，但带上更接近真实客户端。
 *
 * @returns {string}
 */
export function requestId() {
  return `msg_${randomBytes(6).toString('hex')}${base62FromBytes(randomBytes(TAIL_LENGTH), TAIL_LENGTH)}`;
}
