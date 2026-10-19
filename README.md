# dsh-opencode-zen-free

把 **OpenCode Zen 的免费模型**接入 **DeepSeek Harness（DSH）** 的模型选择器。

- **anonymous（默认）**：`Authorization: Bearer public` 走公共额度，**无需 API key**
- **private**：使用自己的 OpenCode Console API key（`oc_sk_...`）
- **零本地依赖**：不需要本机装过 OpenCode，不需要登录，不需要读任何本地数据

所有结论来自实测抓包与逐项二分验证，非文档推测。

---

## 1. 免费模型清单与实测可用性

| 模型 ID | 实测状态 | 说明 |
|---|---|---|
| `space-bunny-free` | ✅ 可用 | Stealth 模型，零留存策略 |
| `big-pickle` | ✅ 可用 | Stealth 模型，免费期数据可能用于改进 |
| `longcat-2.5-preview-free` | ✅ 可用 | 零留存 |
| `mimo-v2.6-flash-free` | ✅ 可用 | 免费期数据可能用于改进 |
| `glm-5.3-flash-free` | ✅ 可用 | 限时免费、零留存 |
| `deepseek-v4.1-flash-free` | ✅ 可用 | 限时免费 |
| `beam-free` | ❌ 地区限制 | 返回 `RegionError`；文档声明中国大陆/香港/澳门不可用 |
| `nemotron-3.5-lightning-free` | ✅ 可用 | NVIDIA 试用端点，勿传敏感数据 |
| `nemotron-3.5-super-vl-free` | 未测 | NVIDIA 试用端点，支持视觉 |
| `jev-1.13-free` | 未纳入 | **System One 结构化决策模型，不是聊天模型** |

> 注：早期版本曾把 `glm-5.3-flash-free`、`deepseek-v4.1-flash-free` 等标为「上游故障」，
> 那是误判。真实原因是当时用的 session id 生成算法不对（见 §2.2），修正后全部可用。

---

## 2. 免费层的四层校验

免费模型**不是**「拿到 key 就能直连的 OpenAI 兼容端点」。上游对请求做四层独立校验：

| 层 | 缺什么 | 错误 |
|---|---|---|
| L1 客户端身份 | UA / `x-opencode-client` | `403 FreeTierError` |
| L2 会话形态 | `ses_` 后 12 位 hex 不是时间戳编码 | `500`（空 body） |
| L3 门禁工具 | `tools` 里不同时含 `bash` 和 `read` | `500`（空 body） |
| L4 流式 | `stream` 不为 `true` | 被拒 |

### 2.1 L1：客户端身份头

缺 UA 或 `x-opencode-client` 时返回：

```json
HTTP 403
{"type":"error","error":{"type":"FreeTierError",
 "message":"OpenCode's free tier can only be used from within OpenCode. Download it at https://opencode.ai and keep building."}}
```

插件发送的身份头：

```
User-Agent: opencode/1.18.31 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14 dsh-opencode-zen-free/0.1.2
x-opencode-client: cli
x-opencode-project: global
```

只写 `opencode/<version>/cli` 也能过 L1，但真实客户端是复合 UA，对齐更稳。
`x-opencode-project` 可以是任意字符串。

### 2.2 L2：session 必须是「时间戳编码」形态

这是最容易踩的坑，也推翻了一个流传较广的误解。

**误解**：`x-opencode-session` 必须是「OpenCode 服务端登记过的真实会话」，
于是插件被迫去读本机 `~/.local/share/opencode/storage/session_diff/`，
在没装 OpenCode 的机器上直接不可用。

**实测矩阵**（同一 UA、同一请求头，只改 session 生成方式）：

| session 形态 | 结果 |
|---|---|
| 随机 hex（`ses_` + 48 hex 字符） | ❌ 500 |
| sha256 哈希派生的 hex | ❌ 500 |
| 从本地 opencode 存储读的真实历史 id | ✅ 200 |
| **时间戳编码 + base62 尾部** | ✅ 200 |

真正的规则是 `ses_` 之后前 12 位十六进制必须是**时间戳编码值**：

```js
encoded = ~(timestampMs * 0x1000 + counter)   // counter 每次 +1，溢出进位
hex12   = encoded & 0xffffffffffffn
id      = `ses_${hex12}${base62(randomBytes(14))}`
```

那些「真实 id」之所以能用，是因为它们本来就长这样——不是服务端查了登记表。
按同样规则本地生成，效果完全等价，且不依赖本机装过 OpenCode。

实现见 `lib/session-id.js`，每个宿主会话映射到一个稳定 id，保留服务端
sticky 路由与 `reasoning.encrypted_content` 重放能力。

### 2.3 L3：tools 里必须同时有 `bash` 和 `read`

实测矩阵（同一 session、同一伪装头）：

| tools 内容 | 结果 |
|---|---|
| 完整 12 个 opencode 工具 | ✅ 200 |
| 删掉 `read`，留 11 个 | ❌ 500 |
| `tools: []` | ❌ 500 |
| 只有 `read` 一个 | ✅ 200 |
| `read` 改名成 `my_read` | ❌ 500 |
| `read` 保留名但描述/参数全简化 | ✅ 200 |
| 自定义工具 + 补齐 `bash`/`read` | ✅ 200 |

上游只认 `function.name` 这个字面量，描述和参数随意。DSH 的工具命名是
`ops_*` 一类，所以必须补齐。

### 2.4 请求体参数

```json
{
  "model": "space-bunny-free",
  "messages": [...],
  "tools": [ /* 必须含 bash 与 read */ ],
  "stream": true,
  "stream_options": { "include_usage": true },
  "max_completion_tokens": 32000,
  "store": false
}
```

完整身份头集合（缺一不可）：

```
Authorization
User-Agent
x-opencode-client
x-opencode-project
x-opencode-session
x-client-request-id    ← 与 x-opencode-session 同值
x-opencode-request     ← msg_ + 12 hex + 14 base62
```

---

## 3. 上游偶发 HTTP 500

即使四层校验全对，上游仍会偶发 `500`（`Content-Length: 0`，无响应体）。
实测 opencode 客户端本体对同一请求会连续重试 6~8 次才成功。

pi-ai 内置的 `maxRetries` 默认只有 2，不够穿过这个窗口。
所以 shim 实现了指数退避重试（默认 12 次，400ms 起，上限 4s）。

---

## 4. 架构

```
DSH agent-loop
  └─ PiAiAdapter            (dsh-llm-pi-ai 的公开 seam)
      └─ pi-ai provider      (openai-completions, baseUrl = shim)
          └─ loopback shim   127.0.0.1:<随机端口>
              ├─ 补齐 bash/read 门禁工具 + 强制 stream
              ├─ 派生时间戳编码 session id
              ├─ 注入完整 OpenCode 身份头
              ├─ 指数退避重试
              └─ HTTPS → opencode.ai/zen/v1
```

为什么需要 shim：pi-ai 没有「请求体改写钩子」，无法在发出前补门禁工具；
`maxRetries` 也不足以穿透 500 窗口。

### 门禁工具是真实工具，不是占位

`bash` 和 `read` 由 `lib/gate-tools.js` 实现为**可执行**工具：

- `bash`：真正跑 shell 命令，返回退出码与输出
- `read`：真正读文件/目录，逐行加行号前缀

只挂名字不实现会比不挂更糟——模型会去调一个永远执行不了的占位工具，
整轮对话被带偏。注册成真工具后，网关校验通过的同时模型调用也能真正落地。

若宿主工具注册表不可用（`ctx.get('tools')` 缺失），插件会告警并降级为
「仅注入名字」，此时模型调用门禁工具会被丢弃。

---

## 5. 安装

### 5.1 前置

1. DSH Desktop `0.2.1-rc.2`
2. **仅 private 模式需要**：OpenCode Console API key

不需要装 OpenCode，不需要登录，不需要任何本地数据。

### 5.2 部署

```bash
PROFILE="$USERPROFILE/.dsh/profiles/desktop"
cp -r dsh-opencode-zen-free "$PROFILE/node_modules/"
```

`package.json` 的 `dependencies` 加入：

```json
"dsh-opencode-zen-free": "file:./node_modules/dsh-opencode-zen-free"
```

`dsh.profile.bundles` 数组加入 `"dsh-opencode-zen-free"`。

### 5.3 配置

`~/.dsh/profiles/desktop/cordis.patch.yml` 追加：

```yaml
- id: llm-opencode-zen-free
  name: "dsh-opencode-zen-free"
  config:
    mode: anonymous          # 免 key；改成 private 用自己的 key
    providerId: "opencode-zen-free"
    displayName: "OpenCode Zen 免费模型"
```

private 模式：

```yaml
- id: llm-opencode-zen-free
  name: "dsh-opencode-zen-free"
  config:
    mode: private
    apiKey: "oc_sk_你的key"
```

可选覆盖：

| 字段 | 默认 | 说明 |
|---|---|---|
| `mode` | `anonymous` | `anonymous` 免 key / `private` 用自有 key |
| `baseUrl` | `https://opencode.ai/zen/v1` | 上游端点 |
| `maxAttempts` | 12 | 上游 5xx 的最大尝试次数 |
| `retryBaseDelayMs` | 400 | 首次退避毫秒 |
| `retryMaxDelayMs` | 4000 | 退避上限毫秒 |
| `registerGateTools` | `true` | 把 bash/read 注册为真实工具 |
| `streamIdleTimeoutMs` | 180000 | 流式空闲超时毫秒 |

### 5.4 重启 DSH

重启后模型选择器出现「**OpenCode 免费模型**」分组。

---

## 6. 验证

### 命令行快速验证（匿名，无需 key）

```bash
# 生成一个时间戳编码的 session id
SID=$(node -e "
const B62='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const b62=(b,l)=>{let o='';for(let i=0;i<l;i++)o+=B62[b[i%b.length]%62];return o;};
let ts=-1,c=0;
const t=Math.max(Date.now(),ts); if(t!==ts)c=0; ts=t; if(++c>0xfff){ts++;c=1;}
const e=~(BigInt(ts)*0x1000n+BigInt(c));
const {randomBytes}=require('crypto');
console.log(\`ses_\${(e&0xffffffffffffn).toString(16).padStart(12,'0')}\${b62(randomBytes(14),14)}\`);
")
REQ=$(node -e "const B62='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';const b62=(b,l)=>{let o='';for(let i=0;i<l;i++)o+=B62[b[i%b.length]%62];return o;};const {randomBytes}=require('crypto');console.log(\`msg_\${randomBytes(6).toString('hex')}\${b62(randomBytes(14),14)}\`)")

curl -sN https://opencode.ai/zen/v1/chat/completions \
  -H "Authorization: Bearer public" \
  -H "Content-Type: application/json" \
  -H "User-Agent: opencode/1.18.31 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14 dsh-opencode-zen-free/0.1.2" \
  -H "x-opencode-client: cli" \
  -H "x-opencode-project: global" \
  -H "x-opencode-session: $SID" \
  -H "x-client-request-id: $SID" \
  -H "x-opencode-request: $REQ" \
  -d '{"model":"space-bunny-free","messages":[{"role":"user","content":"say OK"}],"tools":[{"type":"function","function":{"name":"bash","description":"Run a command","parameters":{"type":"object","properties":{"command":{"type":"string"}},"required":["command"]}}},{"type":"function","function":{"name":"read","description":"Read a file","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}}],"stream":true,"stream_options":{"include_usage":true},"store":false}'
```

看到 `data: {"id":"...","object":"chat.completion.chunk"...}` 即通。

**排错对照**：

| 现象 | 原因 |
|---|---|
| `403 FreeTierError` | 缺 UA 或 `x-opencode-client` |
| `500` 且 body 为空 | session 不是时间戳编码形态，或 tools 里缺 `bash`/`read` |
| `403 RegionError` | 该模型不在你所在地区（如 `beam-free`） |
| 偶发 `500` | 上游瞬时故障，重试 |
| `401` | private 模式的 key 无效 |

---

## 7. 已知限制

1. **部分模型地区受限**：`beam-free` 明确排除中国大陆/香港/澳门等地区。
2. **公共额度有速率限制**：匿名模式共享公共池，高峰期可能被限流；此时切 `private` 模式。
3. **免费层政策可能收紧**：这套身份头绕过的是客户端校验，上游随时可能改规则。
4. **数据条款**：部分模型会把输入用于改进模型，勿传敏感数据。

---

## 8. 卸载

```bash
dsh plugin --profile desktop remove dsh-opencode-zen-free
```

并从 `cordis.patch.yml` 删除 `llm-opencode-zen-free` 段落。

---

## 9. 合规提示

身份头绕过的是 OpenCode 免费层的客户端校验。建议仅用于个人实验，
不要用于生产，不要处理机密信息。上游政策变化时请及时停用。
