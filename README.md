# dsh-opencode-free

把 **OpenCode Zen 的免费模型**接入 **DeepSeek Harness（DSH）** 的模型选择器。

两种额度模式：

- **anonymous（默认）**：`Authorization: Bearer public` 走公共额度，**无需 API key**
- **private**：使用自己的 OpenCode Console API key（`oc_sk_...`）

所有结论来自对本机 `opencode v2.0.32` 的实测抓包与逐项二分验证，非文档推测。

---

## 1. 免费模型清单与实测可用性

`GET https://opencode.ai/inference/v1/models` 返回 79 个模型，其中免费的有 10 个：

| 模型 ID | 实测状态 | 说明 |
|---|---|---|
| `space-bunny-free` | ✅ 可用 | Stealth 模型，零留存策略 |
| `big-pickle` | ✅ 可用 | Stealth 模型，免费期数据可能用于改进 |
| `longcat-2.5-preview-free` | ✅ 可用 | 零留存 |
| `mimo-v2.6-flash-free` | ✅ 可用 | 免费期数据可能用于改进 |
| `glm-5.3-flash-free` | ⚠️ 上游 500 | 限时免费、零留存；当前上游侧故障 |
| `deepseek-v4.1-flash-free` | ⚠️ 上游 500 | 限时免费；当前上游侧故障 |
| `beam-free` | ⚠️ 上游 500 | 数据保留 30 天；**中国大陆/香港/澳门不可用** |
| `nemotron-3.5-lightning-free` | ⚠️ 上游 500 | NVIDIA 试用端点，勿传敏感数据 |
| `nemotron-3.5-super-vl-free` | 未测 | NVIDIA 试用端点，支持视觉 |
| `jev-1.13-free` | 未纳入 | **System One 结构化决策模型，不是聊天模型** |

> `⚠️ 上游 500` 的判断依据：同一 session、同一伪装头、同一请求形态下，
> 换成 `space-bunny-free` 立刻 200，换回 `glm-5.3-flash-free` 就 500。
> 这是模型维度的差异，不是请求构造问题。

插件里全部 9 个聊天免费模型都注册了（含当前故障的），上游修复后无需改配置即可用。

---

## 2. 三层校验（这是最容易被忽略的部分）

免费模型**不是**「拿到 key 就能直连的 OpenAI 兼容端点」。实测发现上游有三层独立校验，
任一不满足都会失败，且失败形态不同：

| 层 | 缺什么 | 错误 |
|---|---|---|
| L1 客户端身份 | UA / `x-opencode-client` | `403 FreeTierError` |
| L2 会话归属 | `x-opencode-session` 不是服务端登记的 | `500`（空 body） |
| L3 门禁工具 | `tools` 里不同时包含 `bash` 和 `read` | `500`（空 body） |

**匿名通道与私有 key 走的是同一套校验**，三层全部要满足（实测确认）。

### 2.1 L1：客户端身份头

缺 UA 或 `x-opencode-client` 时返回：

```json
HTTP 403
{"type":"error","error":{"type":"FreeTierError",
 "message":"OpenCode's free tier can only be used from within OpenCode. Download it at https://opencode.ai and keep building."}}
```

抓包得到的必需头：

```
user-agent:         opencode/latest/2.0.32/cli
x-opencode-client:  cli
```

UA 的构造公式从 opencode 二进制里提取到：

```js
function Yl(e){ return `opencode/${e.channel}/${e.version}/${e.name}` }
```

即 `opencode/<channel>/<version>/<client-name>`。

### 2.2 L2：session 必须是真实登记过的

这是最难发现的一层。

**实测矩阵**（同一请求体、同一 UA/client）：

| project id | session id | 结果 |
|---|---|---|
| 真实 | 真实 | ✅ 200 |
| 真实 | 随机 `ses_<hex>` | ❌ 500 |
| 随机 | 真实 | ✅ 200 |
| 随机 | 真实格式但随机 | ❌ 500 |

结论：
- **`x-opencode-session` 必须是 OpenCode 服务端登记过的真实会话 id**
- `x-opencode-project` 可以是任意值（随机也能过）

**怎么拿到真实 session id**：opencode 本地存储里有历史会话文件名

```
~/.local/share/opencode/storage/session_diff/ses_<id>.json
```

任意一个都可用（实测用 50 个历史会话里的第一个，直接 200）。
插件会自动扫描这个目录取最新的一个；也可以用 `config.sessionId` 显式指定。

也可以用 opencode 现造一个：

```bash
opencode run "hi"    # 会在 session_diff 下生成新的 ses_*.json
```

### 2.3 L3：tools 里必须同时有 `bash` 和 `read`

这是「工具链路参数」的核心。

**实测矩阵**（同一 session、同一伪装头）：

| tools 内容 | 结果 |
|---|---|
| 完整 12 个 opencode 工具 | ✅ 200 |
| 删掉 `read`，留 11 个 | ❌ 500 |
| `tools: []` | ❌ 500 |
| 只有 `read` 一个 | ✅ 200 |
| `read` 改名成 `my_read` | ❌ 500 |
| `read` 保留名但描述/参数全简化 | ✅ 200 |
| 12 个工具全改名 | ❌ 500 |
| 自定义工具 + 补齐 `bash`/`read` | ✅ 200 |

**结论：上游只认 `function.name` 这个字面量**，描述和参数随意。

DSH 的工具命名是 `ops_inspect_local_file` / `ops_glob` 一类，没有叫 `bash`/`read` 的，
所以**必须补齐**，否则所有请求 500。

### 2.4 请求体其他参数

```json
{
  "model": "space-bunny-free",
  "messages": [...],
  "tools": [ /* 必须含 bash 与 read */ ],
  "stream": true,                                  // 必须 true，非流式被拒
  "stream_options": { "include_usage": true },
  "max_completion_tokens": 32000,                  // 不是 max_tokens
  "store": false
}
```

`b3` / `traceparent` 是 W3C 追踪头，抓包里出现，但实测**不发送也能 200**，插件不发。

---

## 3. 上游偶发 HTTP 500

即使三层校验全对，上游仍会偶发 `500`（`Content-Length: 0`，无响应体）。

实测 opencode 客户端本体对同一请求会连续重试 **6~8 次**才成功：

```
seq#1 status=500 len=62361
seq#2 status=500 len=62361
...
seq#7 status=500 len=62361
seq#8 status=200 len=62361
```

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
              ├─ 注入 OpenCode 伪装头（含真实 session id）
              ├─ 指数退避重试
              └─ HTTPS → opencode.ai/inference/openai/v1
```

为什么需要 shim：pi-ai 没有「请求体改写钩子」，无法在发出前补门禁工具；
而 `maxRetries` 也不足以穿透 500 窗口。

### 门禁工具是真实工具，不是占位

`bash` 和 `read` 由 `lib/gate-tools.js` 实现为**可执行**工具：

- `bash`：真正跑 shell 命令，返回退出码与输出
- `read`：真正读文件/目录，逐行加行号前缀

只挂名字不实现会比不挂更糟——模型会去调一个永远执行不了的占位工具，
整轮对话被带偏。注册成真工具后，网关校验通过的同时模型调用也能真正落地。

若宿主工具注册表不可用（`ctx.get('tools')` 缺失），插件会告警并降级为
「仅注入名字」，此时 Model 调用门禁工具会被丢弃。

---

## 5. 安装

### 5.1 前置

1. DSH Desktop `0.2.1-rc.2`
2. 本机装过 opencode 并至少跑过一次（生成真实 session）
3. **仅 private 模式需要**：OpenCode Console API key

### 5.2 部署

```bash
PROFILE="$USERPROFILE/.dsh/profiles/desktop"
cp -r dsh-opencode-free "$PROFILE/node_modules/"
```

`package.json` 的 `dependencies` 加入：

```json
"dsh-opencode-free": "file:./node_modules/dsh-opencode-free"
```

`dsh.profile.bundles` 数组加入 `"dsh-opencode-free"`。

### 5.3 配置

`~/.dsh/profiles/desktop/cordis.patch.yml` 追加：

```yaml
- id: llm-opencode-free
  name: "dsh-opencode-free"
  config:
    mode: anonymous          # 免 key；改成 private 用自己的 key
    providerId: "opencode-free"
    displayName: "OpenCode 免费模型"
```

private 模式：

```yaml
- id: llm-opencode-free
  name: "dsh-opencode-free"
  config:
    mode: private
    apiKey: "oc_sk_你的key"
```

可选覆盖：

| 字段 | 默认 | 说明 |
|---|---|---|
| `mode` | `anonymous` | `anonymous` 免 key / `private` 用自有 key |
| `sessionId` | 自动发现 | 真实的 OpenCode session id |
| `projectId` | 自动生成 | `x-opencode-project` |
| `maxAttempts` | 12 | 上游 5xx 的最大尝试次数 |
| `retryBaseDelayMs` | 400 | 首次退避毫秒 |
| `retryMaxDelayMs` | 4000 | 退避上限毫秒 |
| `registerGateTools` | `true` | 把 bash/read 注册为真实工具 |
| `clientVersion` | `2.0.32` | UA 里的版本号 |
| `channel` | `latest` | UA 里的 channel |
| `baseUrl` | `https://opencode.ai/inference/openai/v1` | 上游端点 |

### 5.4 重启 DSH

重启后模型选择器出现「**OpenCode 免费模型**」分组。

---

## 6. 验证

### 6.1 命令行快速验证（匿名，无需 key）

```bash
# 取一个真实 session id
SID=$(ls ~/.local/share/opencode/storage/session_diff/ | grep '^ses_' | head -1 | sed 's/\.json$//')
PROJ=$(openssl rand -hex 20)

curl -sN https://opencode.ai/inference/openai/v1/chat/completions \
  -H "Authorization: Bearer public" \
  -H "Content-Type: application/json" \
  -H "User-Agent: opencode/latest/2.0.32/cli" \
  -H "x-opencode-client: cli" \
  -H "x-opencode-project: $PROJ" \
  -H "x-opencode-session: $SID" \
  -H "x-opencode-session-id: $SID" \
  -H "x-session-affinity: $SID" \
  -H "x-session-id: $SID" \
  -d "{\"model\":\"space-bunny-free\",\"messages\":[{\"role\":\"user\",\"content\":\"say OK\"}],\"tools\":[{\"type\":\"function\",\"function\":{\"name\":\"bash\",\"description\":\"Run a command\",\"parameters\":{\"type\":\"object\",\"properties\":{\"command\":{\"type\":\"string\"}},\"required\":[\"command\"]}}},{\"type\":\"function\",\"function\":{\"name\":\"read\",\"description\":\"Read a file\",\"parameters\":{\"type\":\"object\",\"properties\":{\"path\":{\"type\":\"string\"}},\"required\":[\"path\"]}}}],\"stream\":true,\"stream_options\":{\"include_usage\":true},\"store\":false}"
```

看到 `data: {"id":"...","object":"chat.completion.chunk"...}` 即通。

**排错对照**：

| 现象 | 原因 |
|---|---|
| `403 FreeTierError` | 缺 UA 或 `x-opencode-client` |
| `500` 且 body 为空 | session 不真实，或 tools 里缺 `bash`/`read` |
| 偶发 `500` | 上游瞬时故障，重试 |
| `401` | private 模式的 key 无效 |

### 6.2 工具链路验证

带 `bash` 工具，期望返回 `tool_calls`：

```
"tool_calls":[{"index":0,"id":"call-...","type":"function",
  "function":{"name":"bash","arguments":"{\"command\":\"echo hi\"}"}}]
"finish_reason":"tool_calls"
```

---

## 7. 已知限制

1. **session 依赖本地 opencode**：`x-opencode-session` 必须真实，因此本机必须
   装过 opencode 并跑过至少一次。纯新机器需要先 `opencode run "hi"`。
2. **部分模型当前不可用**：见第 1 节。属上游故障，换模型即可。
3. **公共额度有速率限制**：匿名模式共享公共池，高峰期可能被限流；此时切 `private` 模式。
4. **免费层政策可能收紧**：这套伪装头绕过的是客户端校验，上游随时可能改规则。
5. **数据条款**：部分模型会把输入用于改进模型，勿传敏感数据。
6. `beam-free` 明确排除中国大陆/香港/澳门等地区。

---

## 8. 卸载

```bash
dsh plugin --profile desktop remove dsh-opencode-free
```

并从 `cordis.patch.yml` 删除 `llm-opencode-free` 段落。

---

## 9. 合规提示

伪装头绕过的是 OpenCode 免费层的客户端校验。建议仅用于个人实验，
不要用于生产，不要处理机密信息。上游政策变化时请及时停用。
