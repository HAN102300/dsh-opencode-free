# dsh-opencode-free 收录状态

**当前状态：PR 已提交，仅等仓库年龄达标。**

| 项 | 值 |
|---|---|
| 插件仓库 | https://github.com/HAN102300/dsh-opencode-free |
| 收录 PR | https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/7884 |
| `dsh-plugin` topic | ✅ 已添加 |
| 条目文件 | `data/plugins/HAN102300__dsh-opencode-free.yml` |
| CI 结果 | `check` ✅ 通过；`Submission gate` ❌ 仅因仓库年龄 |
| 需人工操作 | **无** |

---

## CI 反馈原文

```
Submission gate — 1 entry/entries need changes

https://github.com/HAN102300/dsh-opencode-free
- repository is 0.0 days old (needs 1) — nothing to do: this check re-runs by
  itself and should clear in about 24h. No need to resubmit, push, or close and
  reopen; the age bar is the only thing failing here.
```

**关键点：不需要做任何事，等待即可。** 不需要关闭重开 PR，不需要 push，不需要重新提交。

仓库创建于 `2026-10-18T08:18:35Z`，满 24 小时后 gate 会自动重跑并通过。

---

## 已通过的全部检查

`check` job（14 个步骤全部 success）：

| 步骤 | 结果 |
|---|---|
| Stale-fork guard | ✅ |
| Every entry file ends in .yml | ✅ |
| Entry files live in data/plugins/ | ✅ |
| A generated README row that lists nothing is not a submission | ✅ |
| READMEs match data/plugins | ✅ |
| awesome-lint | ✅ |
| Added-date regression tests | ✅ |
| Capability-disclosure tests | ✅ |
| Discussion-adoption tests | ✅ |
| Entry-path tests | ✅ |
| Build (locale parity, date derivation, templates) | ✅ |

说明 `dsh.bundle` manifest、YAML 格式、双语一致性、分类、条目路径全部合规。

---

## 条目内容

`data/plugins/HAN102300__dsh-opencode-free.yml`：

```yaml
url: https://github.com/HAN102300/dsh-opencode-free
name: HAN102300/dsh-opencode-free
category: model
description:
  en: 'OpenCode Zen free-tier models for DeepSeek Harness with anonymous no-key access, a loopback OpenAI-compatible shim, and real bash/read gate tools.'
  zh: '为 DeepSeek Harness 接入 OpenCode Zen 免费模型：默认免 key 走公共额度，内置回环 OpenAI 兼容 shim，并把网关要求的 bash/read 注册为真实可执行工具。'
```

英文描述含 `: `（冒号+空格）所以用单引号包住——这是 `contributing.md` 明确要求的，否则 YAML 会解析失败。

---

## 24 小时后

### 如果 gate 自动变绿

CI 会自己重跑，什么都不用做。之后等维护者人工 review：

- 会实际读插件源码，核对描述里的每一条声明
- 会判断分类是否贴切（不贴切维护者直接改，不会打回）
- 会判断是否与已有条目重复

### 如果一直没变绿

在 PR 里留个评论触发重跑，或直接看 PR 页面的 check 状态。

### 可能需要应对的 review 意见

最可能被问的是**与已有条目的重复**。列表里已有：

| 条目 | 做了什么 |
|---|---|
| `DragonHorizon-xtihc/dsh-connect-opencode-free` | 免 key、双源发现、设置页、三档额度 |
| `A42Null/dsh-opencode-zen-plugin` | Console key、目录同步、免费模型默认隐藏 |
| `Ebony-Vinyl/dsh-our-free-model` | 免费车道 + 本地网关 |

PR 描述里已经主动说明了差异（零第三方依赖、约 30KB、聚焦记录并强制执行请求形态、bash/read 是真工具）。如果维护者仍认为重叠，回应要点：

- 不辩解「独一无二」，直接问「需要我改成什么形态才好收录」
- 可以主动提议把描述范围收窄到「最小参考实现 + 完整逆向文档」

---

## 后续维护

### 更新条目（改描述/分类）

```bash
# 在 fork 的 add-dsh-opencode-free 分支上直接改
cd awesome-dsh-plugin
git checkout add-dsh-opencode-free
vim data/plugins/HAN102300__dsh-opencode-free.yml
git commit -am "Update description"
git push
```

**只改自己那一个文件**，不要碰别人的条目，不要手改 README。

### 插件发版

插件仓库自己发版即可，条目不一定要动。但**若能力描述变化，必须同步更新条目**——描述被当作对插件的声明，与代码不符会被要求改。

### 保持活跃

官方有周期扫描：仓库消失、归档、长期停更的条目会被标记并移除。保持插件仓库有提交即可。

---

## 可选优化

### 发布到 npm

好处：预构建安装免 `allowBuilds` 步骤；市场可显示下载量。

```bash
cd dsh-opencode-free
npm publish
```

注意：
- `package.json` 的 `repository` 必须指回被收录的仓库（已配好：`HAN102300/dsh-opencode-free`）
- 映射自动采集，**条目里不要手写 `npm:` 字段**，会被校验拒绝

### 加截图

在插件仓库放 `screenshots.json`：

```jsonc
["assets/screenshot-1.png"]
```

1–8 张，相对路径不能跳出仓库，第三方图床会被拒。不声明也行，市场会从 README 抽取。

---

## 仓库最终结构

```
dsh-opencode-free/          https://github.com/HAN102300/dsh-opencode-free
├── .gitignore
├── LICENSE                 Apache-2.0（GitHub 建库时生成）
├── README.md               完整技术文档 + 排错对照表
├── SUBMISSION.md           本文件
├── cordis.patch.yml        insert llm-opencode-free
├── package.json            dsh.bundle + 预发布分支 peerDependencies
└── lib/
    ├── index.js            Cordis 入口、provider 注册、门禁工具注册
    ├── shim.js             loopback 转发 + 指数退避重试 + 形态修正
    ├── free-tier.js        三层校验补齐、session 自动发现
    └── gate-tools.js       bash/read 真实可执行实现
```

提交历史：

```
d867767 chore: align license field with Apache-2.0 LICENSE
de9850e merge: adopt remote LICENSE
ebfa744 chore: set repository url to HAN102300
1ab736f docs: add submission guide
d7293d3 feat: OpenCode Zen free-tier provider for DSH
```
