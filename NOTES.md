# 技术说明

记录 OpenCode Zen 免费层的准入机制与实现取舍，供维护与二次开发参考。
用户视角的内容在 [README.md](README.md)。

---

## 1. 免费层不是普通 OpenAI 兼容端点

免费模型**不是**「拿到 key 就能直连」。上游对请求做四层独立校验，
任一不满足就失败。每一条都由实测二分得出，不是文档推测。

| 层 | 缺什么 | 错误 |
|---|---|---|
| L1 客户端身份 | `user-agent` / `x-opencode-client` | `403 FreeTierError` |
| L2 会话形态 | `ses_` 后 12 位 hex 不是时间戳编码 | `500`（空 body） |
| L3 门禁工具 | `tools` 里不同时含 `bash` 和 `read` | `500`（空 body） |
| L4 流式 | `stream` 不为 `true` | 被拒 |

### L1：身份头

```
User-Agent: opencode/1.18.31 ai-sdk/provider-utils/4.0.40 runtime/bun/1.3.14 dsh-opencode-zen-free/0.3.0
x-opencode-client: cli
x-opencode-project: global
```

只写 `opencode/<version>/cli` 也能过 L1，但真实客户端是复合 UA，对齐更稳。
`x-opencode-project` 可以是任意字符串。

### L2：session 必须是时间戳编码形态

这是最容易踩的坑。常有人认为 `x-opencode-session` 必须是「服务端登记过的
真实会话」，于是插件被迫读本机 `~/.local/share/opencode/storage/session_diff/`，
在没装 OpenCode 的机器上直接不可用。

**实测矩阵**（同 UA、同请求头，只改 session 生成方式）：

| session 形态 | 结果 |
|---|---|
| 随机 hex（`ses_` + 48 hex 字符） | 500 |
| sha256 哈希派生的 hex | 500 |
| 从本地 opencode 存储读的真实历史 id | 200 |
| **时间戳编码 + base62 尾部** | 200 |

真正规则是 `ses_` 后前 12 位十六进制为**时间戳编码值**：

```js
encoded = ~(timestampMs * 0x1000 + counter)   // counter 每次 +1，溢出进位
hex12   = encoded & 0xffffffffffffn
id      = `ses_${hex12}${base62(randomBytes(14))}`
```

那些「真实 id」能用，是因为它们本来就长这样，不是服务端查了登记表。
按同规则本地生成效果等价，且不依赖本机装过 OpenCode。

实现见 `lib/session-id.js`。每个宿主会话映射到一个稳定 id，保留服务端
sticky 路由与 `reasoning.encrypted_content` 重放能力。

### L3：门禁工具

实测矩阵（同 session、同身份头）：

| tools 内容 | 结果 |
|---|---|
| 完整 12 个 opencode 工具 | 200 |
| 删掉 `read`，留 11 个 | 500 |
| `tools: []` | 500 |
| 只有 `read` 一个 | 200 |
| `read` 改名成 `my_read` | 500 |
| `read` 保留名但描述/参数全简化 | 200 |
| 自定义工具 + 补齐 `bash`/`read` | 200 |

上游只认 `function.name` 字面量，描述与参数随意。DSH 的工具命名是 `ops_*`
一类，所以必须补齐。

### L4：请求体参数

```json
{
  "model": "glm-5.3-flash-free",
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

### 端点差异

`/zen/v1` 与 `/inference/openai/v1` 行为不同，上述矩阵在两个端点上分别验证过。

---

## 2. 为什么需要 loopback shim

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

两个原因：

1. **pi-ai 没有请求体改写钩子**，无法在发出前补门禁工具、改 `stream`、注入身份头。
2. **`maxRetries` 不够**。pi-ai 默认 2 次，而上游偶发空响应 500，实测 opencode
   客户端本体对同一请求要重试 6~8 次才成功。shim 实现 12 次指数退避。

该模式与 `dsh-workbuddy-connect` 的 loopback shim 一致。shim 只监听 `127.0.0.1`
随机端口，且校验 `Host` 头为回环，不对外暴露。

---

## 3. 门禁工具是真实实现，不是占位

`bash` 和 `read` 由 `lib/gate-tools.js` 实现为可执行工具：

- `bash`：真正跑 shell 命令，返回退出码与合并输出，8MB 缓冲、120s 超时
- `read`：真正读文件/目录，逐行加 1-based 行号前缀；二进制文件回退为提示

只挂名字不实现比不挂更糟——模型会去调一个永远执行不了的占位工具，整轮对话
被带偏。注册成真工具后，网关校验通过的同时模型调用也能真正落地。

若宿主工具注册表不可用（`ctx.get('tools')` 缺失），插件告警并降级为「仅注入
名字」，此时模型调用门禁工具会被丢弃。

---

## 4. 两个曾搞错过的结论

公开记录，因为它们容易再次踩坑：

1. **`x-opencode-session` 不需要是「真实登记过的会话」**。早前版本读本地
   opencode 存储，并把 `glm-5.3-flash-free`、`deepseek-v4.1-flash-free` 误判为
   「上游故障」。真实原因是当时的 session 生成算法不对——改成时间戳编码后
   全部返回 200。
2. **端点会影响行为**。同一套参数在两个端点上的表现不同，矩阵需分别验证。

---

## 5. 模型元数据的取值

上游 models 端点只返回 `{id, object, created, owned_by}`，不带
`contextWindow` / `maxTokens`，`FREE_MODELS` 里给的是保守值（200K / 32K）。
这只是让 DSH 的上下文压缩更早触发，不会溢出。

若 OpenCode 后续在端点暴露这些字段，应改为动态读取。

### 清单的维护口径

清单以 models 端点**实际返回的 id** 为准，不照抄官方文档。2026-10-20 核对时
两者存在差异：

| 端点返回 | 文档有、端点没有 | 说明 |
|---|---|---|
| 10 个免费 id | `exo-free`、`ll-alpha-free`、`mimo-v2.5-free`、`nemotron-3-ultra-free` | 文档列了但端点未返回，不纳入 |
| 含 `jev-1.13-free` | — | 该模型走 systemone API（结构化判定，非对话），不能作为 chat 模型，不纳入 |

已下线的 `space-bunny-free` 同样以端点为准移除，替代模型
`minimax-m3.1-flash-free` 已加入。
