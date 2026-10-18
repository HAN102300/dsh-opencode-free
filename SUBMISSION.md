# dsh-opencode-free 收录申请指南

按 `awesome-dsh-plugin/awesome-dsh-plugin` 的 `contributing.md` 要求，把本插件收录进官方列表的完整步骤。

---

## 前置检查清单

对照 `contributing.md` 的硬性要求逐项确认：

| # | 要求 | 状态 | 备注 |
|---|---|---|---|
| 1 | `package.json` 声明 `dsh.bundle` | ✅ | `{"bundle": {"patch": "./cordis.patch.yml"}}` |
| 2 | 仓库根有 `cordis.patch.yml` | ✅ | 内容为 `insert` 一条 loader 条目 |
| 3 | 真实可用的代码 | ✅ | 4 个模块，匿名/私有双模式已实测 |
| 4 | 仓库创建满 1 天 | ⏳ | **CI 自动查，需等 24 小时** |
| 5 | 仓库加 `dsh-plugin` topic | ⏳ | GitHub 仓库 Settings → Topics |
| 6 | 描述属实、无营销词 | ✅ | 见文末 entry 文件 |
| 7 | 不与已有条目重复 | ⚠️ | **撞 DragonHorizon 那款，需在 PR 里说明差异** |
| 8 | 官方 `@deepseek-ai/*` 用 `peerDependencies` | ✅ | 已用带预发布分支的 `\|\|` 写法 |
| 9 | 每个 PR 最多 3 条 | ✅ | 只有 1 条 |

---

## 第 1 步：创建并推送 GitHub 仓库

```bash
cd D:\dsh-working\dsh-opencode-free

# 1. 在 GitHub 上建空仓库（不要勾选 README/license/gitignore）
#    仓库名建议：dsh-opencode-free

# 2. 关联远端并推送
git remote add origin https://github.com/<你的用户名>/dsh-opencode-free.git
git branch -M main
git push -u origin main
```

推送后立即做两件事：

**① 加 topic**

仓库页 → 右上角 ⚙️ (About) → Topics → 输入 `dsh-plugin` → 保存。

**② 改掉 package.json 里的 OWNER 占位**

```bash
# 把 OWNER 替换成你真实的 GitHub 用户名
sed -i 's/OWNER/<你的用户名>/g' package.json
git add package.json && git commit -m "chore: set repository url"
git push
```

> `contributing.md` 没要求 `repository` 字段，但 npm 发布与市场关联会用到，先填对更省后续维护。

**③ 等 24 小时**

CI 会检查仓库创建时间。这期间可以先做第 2 步的准备。

---

## 第 2 步：Fork 官方列表仓库

```bash
# 在 GitHub 上点 Fork：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin

git clone https://github.com/<你的用户名>/awesome-dsh-plugin.git
cd awesome-dsh-plugin
git remote add upstream https://github.com/awesome-dsh-plugin/awesome-dsh-plugin.git
```

---

## 第 3 步：创建条目文件

**只需一个文件**，路径与命名规则是 `data/plugins/<owner>__<repo>.yml`：

```bash
# 注意是双下划线
vim data/plugins/<你的用户名>__dsh-opencode-free.yml
```

内容（把 `<你的用户名>` 替换掉）：

```yaml
url: https://github.com/<你的用户名>/dsh-opencode-free
name: <你的用户名>/dsh-opencode-free
category: model
description:
  en: 'OpenCode Zen free-tier models for DeepSeek Harness with anonymous no-key access, a loopback OpenAI-compatible shim, and real bash/read gate tools.'
  zh: '为 DeepSeek Harness 接入 OpenCode Zen 免费模型：默认免 key 走公共额度，内置回环 OpenAI 兼容 shim，并把网关要求的 bash/read 注册为真实可执行工具。'
```

### 关键规则

| 规则 | 说明 |
|---|---|
| `url` | 必须与仓库地址**完全一致** |
| `name` | 列表里显示的链接文字，用 `owner/repo` |
| `category` | 分类选 `model`（模型接入） |
| `description.en` | **唯一必填字段** |
| `description.zh` | 可选，不写维护者会补 |
| **含 `: ` 必须加引号** | 上面的 `en` 里有冒号+空格，所以用单引号包住 |

### ⚠️ 绝对不要做的事

- ❌ 不要手工编辑 `README.md` / `README.zh.md`（由脚本从 `data/plugins/*.yml` 生成）
- ❌ 不要碰别人的条目文件
- ❌ 一个 PR 不要超过 3 条

---

## 第 4 步（可选）：本地预览

```bash
npm ci
node scripts/generate-readme.mjs
```

会重新生成两个 README。**可以提交预览结果，但必须与数据源一致**——不一致 CI 会挂。

不跑也行，CI 会自动生成。

---

## 第 5 步：提交 PR

```bash
git checkout -b add-dsh-opencode-free
git add data/plugins/<你的用户名>__dsh-opencode-free.yml
# 如果第 4 步跑了生成脚本，一起提交：
# git add README.md README.zh.md

git commit -m "Add <你的用户名>/dsh-opencode-free"
git push origin add-dsh-opencode-free
```

然后在 GitHub 上向 `awesome-dsh-plugin/awesome-dsh-plugin:main` 开 PR。

---

## 第 6 步：PR 描述——主动说明与已有条目的差异

这是**最容易被拒的一环**。列表里已有高度相似的条目：

| 已有条目 | 做了什么 |
|---|---|
| `DragonHorizon-xtihc/dsh-connect-opencode-free` | 免 key 接入 Zen 免费档、双源模型发现、设置页 UI、三档额度策略 |
| `A42Null/dsh-opencode-zen-plugin` | Console key 接入、目录自动同步、免费模型默认隐藏 |
| `Ebony-Vinyl/dsh-our-free-model` | 免费模型车道 + 本地 OpenAI 兼容网关 |

`contributing.md` 第 4 条原文：

> Where two plugins do the same thing, whoever got here first keeps the slot — but that is a tiebreaker, not tenure... **The rule is not first-come; the rule is whichever is better.**

**建议在 PR 描述里写清楚**（照抄修改）：

```markdown
Adds `<你的用户名>/dsh-opencode-free`.

Similar entries already listed: DragonHorizon-xtihc/dsh-connect-opencode-free,
A42Null/dsh-opencode-zen-plugin, Ebony-Vinyl/dsh-our-free-model.

This one differs in scope: it is a ~22 KB, dependency-free (node builtins only)
implementation whose point is to document and enforce the free-tier request
shape rather than to ship a settings UI. Specifically:

- Anonymous access via `Authorization: Bearer public` (no key), with an optional
  private mode using a Console API key.
- A loopback shim that enforces the three request-shape checks the gateway
  actually applies (verified by bisection against a live `opencode` client):
  the opencode-shaped user-agent / `x-opencode-client`, a *real* registered
  `x-opencode-session` (read from the local opencode session store, since
  randomly generated ids are rejected), and `bash` + `read` present in `tools`.
- `bash` and `read` are registered as real executable tools, not stubs, so a
  model that calls them is not derailed.
- Exponential-backoff retry, because the gateway returns intermittent
  empty-bodied 500s that the upstream client also retries 6-8 times.

No UI surface, no bundled model catalog, no dependencies beyond the DSH peer
packages. Happy to adjust the category or trim the description if it reads as
overlapping.
```

> 诚实说明差异 + 承认可能重叠，比声称「独一无二」更容易过。说明里用到的数字（22 KB、4 个模块、无第三方依赖）必须与代码相符——维护者会核对。

---

## 第 7 步：等 CI

CI 按顺序检查：

1. **条目数** ≤ 3
2. **`dsh.bundle`** 存在（从你的仓库 `package.json` 读）
3. **仓库年龄** ≥ 1 天
4. **`awesome-lint`** + 站点构建

任一失败，输出会明确指出改什么。**在同一分支推修复即可，不用重开 PR。**

---

## 后续维护

### 更新描述或分类

```bash
cd awesome-dsh-plugin
git pull upstream main
# 只改自己那一个文件
vim data/plugins/<你的用户名>__dsh-opencode-free.yml
npm ci && node scripts/generate-readme.mjs
git add data/plugins/<你的用户名>__dsh-opencode-free.yml README.md README.zh.md
git commit -m "Update dsh-opencode-free description"
git push
```

> **只改自己那一条**。手改 README 是这类事故的常见起因——列表增长会移位，改动落到邻居头上。

### 发新版本

插件仓库自己发版即可，列表条目不用动（除非能力描述变了）。

若能力有变化（例如新增了模型、改了配置项），**必须同步更新 description**——
描述被当作对插件的声明，与代码不符会被要求修改。

### 定期自查

`contributing.md` 提到有周期扫描：仓库消失、归档、长期停更的条目会被标记并移除。
保持插件仓库有活跃提交即可。

---

## 可选：提升安装体验

### A. 发布到 npm

```bash
cd dsh-opencode-free
npm publish
```

好处：
- 预构建安装，跳过 `allowBuilds` 构建授权步骤
- 市场可显示下载量（自动采集，**条目里不要手写 `npm:` 字段，会被校验拒绝**）

注意：`package.json` 的 `repository` 必须指回被收录的那个仓库，否则不会关联。

### B. 或：GitHub Release + tarball 字段

```bash
npm pack
# 把生成的 dsh-opencode-free-0.2.0.tgz 上传到 GitHub Release
```

然后在条目文件加：

```yaml
tarball: https://github.com/<你的用户名>/dsh-opencode-free/releases/latest/download/dsh-opencode-free.tgz
```

⚠️ **`latest/download/` 的文件名是照字面取的**。资产名若带版本号，下次发版就 404。
要么资产名不带版本（如上），要么钉住 tag：

```yaml
tarball: https://github.com/<你的用户名>/dsh-opencode-free/releases/download/v0.2.0/dsh-opencode-free-0.2.0.tgz
```

### C. 截图（可选，推荐）

在市场详情页展示 App Store 风格截图。**在你自己仓库里声明**：

```jsonc
// dsh-opencode-free/screenshots.json
["assets/screenshot-1.png", "assets/screenshot-2.png"]
```

规则：
- 1–8 张
- 路径相对该文件，不能以 `/` 开头、不能含 `..`
- 绝对 URL 必须是 GitHub 托管（`raw.githubusercontent.com` 等），第三方图床会被拒
- 不声明也行，市场会从 README 自动抽取

---

## 常见拒稿原因对照

| 原因 | 本插件的状态 |
|---|---|
| 只声明了 `dsh.client`，没有 `dsh.bundle` | ✅ 已正确声明 `bundle` |
| 仓库几分钟前才建 | ⏳ 需等 24h |
| 描述夸大、与代码不符 | ✅ 已按实际能力写 |
| 与已有条目重复 | ⚠️ 需在 PR 里说明差异 |
| peerDependencies 写法导致 ERESOLVE | ✅ 已用带预发布分支的 `\|\|` |
| YAML 里 `: ` 没加引号 | ✅ 已加单引号 |
| 手改了 README | ✅ 不要动 |
| PR 动了别人的条目 | ✅ 只加自己一个文件 |

---

## 当前仓库状态

```
dsh-opencode-free/
├── .gitignore
├── LICENSE              (MIT)
├── README.md            (完整技术文档 + 排错对照表)
├── cordis.patch.yml     (insert llm-opencode-free)
├── package.json         (dsh.bundle + 正确的 peerDependencies)
└── lib/
    ├── index.js         (Cordis 入口、provider 注册、门禁工具注册)
    ├── shim.js          (loopback 转发 + 重试 + 形态修正)
    ├── free-tier.js     (三层校验补齐、session 发现)
    └── gate-tools.js    (bash/read 真实可执行实现)
```

已提交到本地 git：`d7293d3`
