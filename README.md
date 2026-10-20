# dsh-opencode-zen-free

把 **OpenCode Zen 的免费模型**接入 **DeepSeek Harness（DSH）** 的模型选择器。

- **免 key 即可用**：默认走公共额度，不需要 OpenCode Console 账号
- **零本地依赖**：不需要本机装过 OpenCode，不需要登录，不读任何本地数据
- **零第三方依赖**：只依赖 Node 内置模块与 DSH 自身的包
- 支持工具调用，`bash` / `read` 是真实可执行的工具，不是占位

---

## 安装

推荐用 npm 安装（也可手动复制文件，见下方「手动安装」）。

### 方式一：npm（推荐）

```bash
dsh plugin add dsh-opencode-zen-free
```

然后跳到第 3 步「配置」。

如果 `dsh plugin` 子命令在你的版本里不可用，退回到方式二。

### 方式二：手动安装

复制到 profile 的 `node_modules`：

```bash
PROFILE="$USERPROFILE/.dsh/profiles/desktop"
cp -r dsh-opencode-zen-free "$PROFILE/node_modules/"
```

编辑 `~/.dsh/profiles/desktop/package.json`：

`dependencies` 加入：

```json
"dsh-opencode-zen-free": "file:./node_modules/dsh-opencode-zen-free"
```

`dsh.profile.bundles` 数组加入：

```json
"dsh-opencode-zen-free"
```

### 配置

编辑 `~/.dsh/profiles/desktop/cordis.patch.yml`，追加：

```yaml
- id: llm-opencode-zen-free
  name: "dsh-opencode-zen-free"
  config:
    mode: anonymous          # 免 key 走公共额度；改成 private 用自己的 key
    providerId: "opencode-zen-free"
    displayName: "OpenCode Zen 免费模型"
```

想用自己的 Console API key（公共额度被限流时更稳）：

```yaml
- id: llm-opencode-zen-free
  name: "dsh-opencode-zen-free"
  config:
    mode: private
    apiKey: "oc_sk_你的key"
```

### 重启 DSH

模型选择器会出现「**OpenCode Zen 免费模型**」分组。

---

## 可用模型

清单取自 OpenCode 的 models 端点（`https://opencode.ai/zen/v1/models`）实际返回的 id，不是照抄官方文档。

| 模型 | 说明 |
|---|---|
| `big-pickle` | Stealth 模型，免费期数据可能用于改进 |
| `longcat-2.5-preview-free` | 零留存 |
| `mimo-v2.6-flash-free` | 免费期数据可能用于改进 |
| `glm-5.3-flash-free` | 限时免费，零留存 |
| `deepseek-v4.1-flash-free` | 限时免费，零留存 |
| `minimax-m3.1-flash-free` | 限时免费，零留存 |
| `nemotron-3.5-lightning-free` | NVIDIA 试用端点，勿传敏感数据 |
| `nemotron-3.5-super-vl-free` | NVIDIA 试用端点，支持图片输入 |
| `beam-free` | 数据保留 30 天；**中国大陆/香港/澳门等地区不可用** |

> 免费模型由 OpenCode 侧提供，可用性与数据条款随时可能变化，以官方说明为准。
> 上游会增删免费模型（例如 `space-bunny-free` 已下线），插件不自动跟随，
> 更新插件即可拿到新清单。

---

## 配置项

| 字段 | 默认值 | 说明 |
|---|---|---|
| `mode` | `anonymous` | `anonymous` 免 key；`private` 用自己的 Console API key |
| `apiKey` | — | Console API key，仅 `private` 模式使用；留空则读 `OPENCODE_API_KEY` |
| `baseUrl` | `https://opencode.ai/zen/v1` | 上游端点 |
| `providerId` | `opencode-zen-free` | 在模型选择器里的 provider id |
| `displayName` | `OpenCode Zen 免费模型` | 模型分组显示名 |
| `maxAttempts` | `12` | 上游偶发错误时的最大重试次数 |
| `retryBaseDelayMs` | `400` | 首次重试等待毫秒（之后按倍数增长） |
| `retryMaxDelayMs` | `4000` | 重试等待上限毫秒 |
| `streamIdleTimeoutMs` | `180000` | 流式响应空闲超时 |
| `registerGateTools` | `true` | 把 `bash` / `read` 注册为可执行工具 |

---

## 常见问题

**模型调用返回 `RegionError`**

该模型不在你所在地区开放。`beam-free` 明确排除中国大陆/香港/澳门等地区，换其他模型即可。

**间歇性失败**

上游偶发空响应错误，插件会自动重试（默认最多 12 次）。若持续失败，换一个模型，或切到 `private` 模式使用自有额度。

**所有模型返回 `FreeTierError`（提示「can only be used from within OpenCode」）**

这不是配置问题，是 OpenCode 侧对**出口 IP** 的风控判定。免费层是 IP 维度封禁，与账号无关，换 API key 无效。表现通常是：免费模型全部 403，而付费模型仍能正常返回余额/计费错误。

可尝试的解法（按成功率排序，均不保证）：

1. 换一个干净的出口 IP（重启光猫、切换网络、换代理节点）
2. 用 `private` 模式配合自己的 Console key —— 若付费层正常，这条能立刻恢复可用
3. 邮件申诉至 `help@anoma.ly`（OpenCode 官方只认这个渠道，GitHub issue 多为模板回复）

若你之前密集测试过，很可能触发了频次阈值；建议改为按需调用，不要短时间大量重试。

**`private` 模式全部 401**

`apiKey` 没配上。检查 `cordis.patch.yml` 里的 `apiKey`，或设置环境变量 `OPENCODE_API_KEY`。

**看不到「OpenCode Zen 免费模型」分组**

1. 确认 `package.json` 的 `dependencies` 与 `dsh.profile.bundles` 都加了
2. 确认 `cordis.patch.yml` 里的 `id` 是 `llm-opencode-zen-free`
3. 重启 DSH Desktop

**模型不调用工具**

`bash` 与 `read` 需要注册成功才会被调用。若启动日志里有「未找到工具注册表」告警，说明宿主的工具服务未就绪——重启 DSH 通常可解决。

---

## 卸载

```bash
dsh plugin --profile desktop remove dsh-opencode-zen-free
```

并从 `cordis.patch.yml` 删除 `llm-opencode-zen-free` 段落。

---

## 说明

- 免费额度为共享池，高峰期可能被限流，`private` 模式更稳。
- 部分免费模型会把输入用于改进模型，**勿传敏感数据**。
- 建议仅用于个人实验，不要用于生产环境。

想了解免费层的准入机制与实现细节，见 [NOTES.md](NOTES.md)。
