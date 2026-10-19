# dsh-plugin-clinepass

**把 [ClinePass](https://docs.cline.bot/getting-started/clinepass) 接成 DeepSeek Harness 的模型提供商：装好插件后，只需在「设置 → 模型」填一个 API 密钥即可使用。**

ClinePass 是 Cline 的订阅档（$9.99/月，热门开源编码模型 2–5 倍用量）。它走的还是 Cline API
（`https://api.cline.bot/api/v1`，OpenAI Chat Completions 协议），只是模型代号使用 `cline-pass/*`
命名空间。DSH 的内置提供商目录里没有它，这个小插件把它补成一条正式的 `llm-pi-ai` 路由。

## 效果

装好并激活后，一切走 DSH 原生路径：

- **设置 → 模型** 出现一张 **ClinePass** 卡片，主字段只有 **API 密钥**（收起的「自定义设置」里可改端点、协议、模型列表）；
- 模型选择器出现 12 个 ClinePass 订阅模型（`cline-pass/glm-5.3`、`cline-pass/kimi-k3`、
  `cline-pass/deepseek-v4-pro` …），随选随用；
- 点击卡片里的 **获取可用模型** 会返回 ClinePass 订阅目录（而不是端点那份按量计费目录——见下文）。

> **为什么「添加提供商」的下拉列表里找不到 ClinePass？** 那个下拉只列出**尚未配置**的目录提供商
> （领养入口）。插件已把 ClinePass 预置为一张已配置的提供商卡片，所以它不在下拉里、也不需要
> 从下拉添加——打开「设置 → 模型」直接就能看到卡片。这与你自己手工声明的其他路由
> （如 opencode-go、kimi-coding）行为一致。

## 安装

```bash
# 方式一：开发注入器热装配（免重启，同时写入 profile 的 bundles 列表）
#   dev_install_package /path/to/dsh-plugin-clinepass --profile web

# 方式二：手工装配
#   1) 把本目录放进 profile 的 dependencies（link 或 file 均可），并加入
#      dsh.profile.bundles 列表；
#   2) 重启 DSH。
```

激活后插件会自动把路由种子进 `llm-pi-ai` 的用户层（与「设置 → 模型」页面同一条受支持的写入通道，
落盘在 profile 的 `cordis.patch.yml`），然后你只要：

**设置 → 模型 → ClinePass → 填入 API 密钥（[app.cline.bot](https://app.cline.bot) → Settings → API Keys）→ 应用**

## 它做了什么 / 没做什么

| 做的 | 不做的 |
| --- | --- |
| 幂等预置 `clinepass` 路由（端点、协议、显示名、凭据引用、模型目录） | 不碰 dsh 源码，不碰其他路由 |
| 把「获取可用模型」的答案限定为 `cline-pass/*` | 不接管密钥存储（仍走原生 credentials 服务） |
| 之后完全交给原生 Models 页 / 凭据 / 流式适配器 | 不覆盖你已有的配置 |

**幂等且不破坏**：只要 `clinepass` 这个路由键已经存在（你在 Models 页手调过，或直接写在
`cordis.patch.yml` 里），插件永远不会再写它。在插件配置里把 `seed` 改为 `false` 可完全关闭播种。

**路由键冲突**：如果 `routeKey` 已经是 llm 运行时目录里某个提供商的名字（内置目录占用，或别的
插件注册的路由），插件会打一条警告并拒绝播种——否则会顶掉那条路由自己的端点、协议与凭据引用
（还会在 llm-pi-ai 的目录提交里撞车）。换一个空闲的路由键，或把 `allowReservedRouteKey: true`
设为刻意接管。警告是**每次播种一次**、不是每次激活一次：改插件配置会重新播种，所以没改掉的坏
路由键会再次告警——换用另一个被占用的键时正需要这条提示。这道校验是尽力而为的：如果目录根本读不
到，插件只记一条日志、照常播种，不会因为读不到目录就让路由缺失。

**删除语义**：卡片在 Models 页可以移除（路由只落在用户层）。移除在本次会话内生效并被尊重；
插件下次激活（重启或热重载）时发现路由缺失会重新播种。想彻底不要这张卡片，请用
`seed: false` 而不是删除。

## 预置的模型清单

来自 [ClinePass 文档](https://docs.cline.bot/getting-started/clinepass) 的 12 个订阅模型：

| 模型 | id | 上下文 | 最大输出 | 图片 |
| --- | --- | --- | --- | --- |
| GLM-5.3 | `cline-pass/glm-5.3` | 1,000,000 | 131,072 | ✅ |
| GLM-5.3 Flash | `cline-pass/glm-5.3-flash` | 1,000,000 | 131,072 | ✅ |
| Kimi K3 | `cline-pass/kimi-k3` | 1,048,576 | 131,072 | ✅ |
| DeepSeek V4 Pro | `cline-pass/deepseek-v4-pro` | 1,000,000 | 384,000 | ✅ |
| DeepSeek V4.1 Flash | `cline-pass/deepseek-v4.1-flash` | —（保守默认） | —（保守默认） | ✅ |
| MiMo-V2.5 | `cline-pass/mimo-v2.5` | 1,048,576 | 131,072 | ✅ |
| MiMo-V2.5-Pro | `cline-pass/mimo-v2.5-pro` | 1,048,576 | 131,072 | ❌ 实测拒绝图片输入 |
| MiniMax M3 | `cline-pass/minimax-m3` | 1,048,576 | 512,000 | ✅ |
| Muse Spark 1.3 Contributor | `cline-pass/muse-spark-1.3-contributor` | 1,048,576 | 131,072 | ⚠️ 目录共识；区域受限未实测 |
| Qwen3.8 Max | `cline-pass/qwen3.8-max` | 1,000,000 | 131,072 | ✅ |
| Qwen3.7 Max | `cline-pass/qwen3.7-max` | 1,000,000 | 131,072 | ❌ 实测拒绝图片输入 |
| Qwen3.7 Plus | `cline-pass/qwen3.7-plus` | 1,000,000 | 65,536 | ✅ |

**规格数据从哪来（为什么不能"从 ClinePass 自动拉"）**：Cline 的 API 不发布任何
逐模型规格——`GET /api/v1/models` 每个条目只有 `id/object/created/owned_by` 四个字段，
模型详情端点需要 Cline 应用账号态（API key 访问不了），官方文档的模型表也没有参数列。
所以上表的上下文/输出上限**继承自 pi-ai 内置目录**（2026-09-29，优先厂商官方条目
moonshotai/deepseek/xiaomi/minimax/qwen-token-plan，其次编码订阅聚合商 opencode-go）；
图片列是**在 ClinePass 线上逐模型实测**的（比目录准——目录说 GLM-5.3、DeepSeek V4 Pro
纯文本，但 Cline 的部署实测接受图片）。`deepseek-v4.1-flash` 在所有目录里都没有条目，
保持 llm-pi-ai 保守默认（262144/32768）：低估只会提前触发压缩，永远不会撑爆上下文。

**自动补齐**：插件每次激活时检查已有路由，只填补**缺失**的规格字段（你手改过的值、
增删过的模型一概不碰）。升级插件后无需任何操作，下次激活即自动补齐新规格。

## 为什么「获取可用模型」要包一层

Cline 的 `GET /api/v1/models` 列的是**按量计费目录**（`zai/glm-5.3`、`qwen/qwen3.7-max` 这类
厂商代号，实测 464 个条目里没有任何 `cline-pass/*`）。订阅模型走的是 `cline-pass/*` 别名
（实测 `cline-pass/glm-5.3` 的路由元数据显示底层是 `zai/glm-5.3`）。如果原样透传目录，
用户会把不计订阅额度的代号加进 ClinePass 路由。所以插件把该卡片的发现结果限定为
`cline-pass/*`：预置清单优先，端点将来若发布新的 `cline-pass/*` 条目会自动合入。

**这次探测照做**：即便它贡献不了任何 `cline-pass/*` 条目——它现在是这条路由的实时凭据检查，
顺带还能捡到发布后才上线的新代号。

**被拒的密钥不再被掩盖**：**已填写但被拒绝**的密钥——存的值格式非法/为空
（`INVALID_CREDENTIAL`），或端点回了 401/403（`DISCOVERY_FAILED` 且带 harness 的
“; check the API key” 提示）——现在会**把 harness 自己的错误原样抛到卡片上**，而不是拿预置
清单糊弄过去。旧的回退会把一个填错的 API 密钥变成“看起来成功”。以下两种状态仍按文档回退到
预置清单：**尚未配置**（`MISSING_CREDENTIAL`——空密钥框用户本来就看得到，预置清单正是这种
状态下的既定答案）与**端点不可达/无法解析**（网络失败、非 JSON、401/403 以外的状态码）。

**新型号从哪来**：端点的按量计费目录里永远不会有 `cline-pass/*`（2026-10-06 复核仍是 0/464），
所以「预置清单 + 端点」这套组合实际上永远不会长出新模型。插件因此改为从
[models.dev](https://models.dev/providers/cline-pass/) 的 `cline-pass` provider 取**套餐内目录**
（2026-10-06 实测 18 个，覆盖本插件预置的 12 个，另有 `mimo-v2.6-pro`、`mimo-v2.6-flash`、
`kimi-k2.6`、`kimi-k2.7-code`、`glm-5.2`、`deepseek-v4-flash` 六个新型号）：点「获取可用模型」
时拉取一次（6 小时缓存，失败只回退预置清单、不报错），新增的 `cline-pass/*` 条目照常出现在
待选列表里由你确认后加入。该来源同样只含 `cline-pass/*`，不会把按量计费代号带进这条路由。
预置行永远优先，所以逐模型实测过的图片/上下文规格不会被目录声明覆盖。

## 配置

插件自己的配置在 profile 的 `cordis.patch.yml` 中（entry id `clinepass`），均可在
「设置 → 插件」页调整：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `seed` | `true` | 路由不存在时自动播种；`false` 关闭 |
| `routeKey` | `clinepass` | llm-pi-ai 路由键（Models 页卡片的键） |
| `allowReservedRouteKey` | `false` | 即使 `routeKey` 已被 llm 运行时目录里的某个提供商占用也照样播种（该写入会顶掉目录路由自己的端点/协议/凭据引用，或与别的插件路由冲突）；需要刻意接管该键时才打开 |
| `displayName` | `ClinePass` | 选择器里显示的名字 |
| `apiKeyEnv` | `CLINEPASS_API_KEY` | 凭据引用。改成 `CLINE_API_KEY` 可直接复用你现有 Cline 路由的密钥，零填写生效 |
| `baseURL` | `https://api.cline.bot/api/v1` | Cline API 端点 |
| `api` | `openai-completions` | 线协议 |
| `models` | 12 个订阅模型 | 预置模型清单（字段同上表） |

## 依赖

- `llm-pi-ai`（DSH 自带）——路由的宿主命名空间。profile 里没有它时插件只会打一条警告，不做任何写入。
- `settings` 服务。
- 共享的 `@deepseek-ai/schemastery` ≥3.18.5（harness 自带的那份）——`Config.meta.volatile` 需要
  它支持 volatile，配置才能热改；`peerDependencies` 声明同一下限。
- llm 运行时的提供商目录（`listConfigurableProviders`，由 dsh-llm 提供），`routeKey` 冲突守卫
  要用。没有 llm 服务时播种照常进行，只是不做守卫。

## License

MIT
