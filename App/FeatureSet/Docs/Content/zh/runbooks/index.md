# Runbook 概览

Runbook 是可复用的响应流程——由手动或自动步骤组成的有序列表——你可以将它附加到事件、告警或计划维护上。它把"现在该怎么办？"这种临时的 Slack 讨论，变成同事在凌晨三点也能从零接手的工作。

## 一览

- OneUptime 仪表板 **分析与自动化 → Runbooks** 下的**顶层功能**。
- **四种步骤类型**：手动清单、JavaScript（沙箱）、HTTP 请求、Bash（在你自己的基础设施中的 [Runbook 代理](/docs/runbooks/agents) 上运行）。
- **三条触发路径**：匹配事件 / 告警 / 计划维护的规则，或者在任意事件上手动点击"运行 Runbook"。
- **快照语义**：Runbook 启动时，它的步骤会被拷贝到执行上。之后编辑模板永远不会改变正在进行中的执行。
- **完整审计轨迹**：每个步骤的状态、输出、错误信息和耗时永远保留在执行上。

## 为什么用 Runbook？

事件响应往往是一分钟小问题与几小时大故障之间的分界。Runbook 帮你：

- **沉淀部落知识**——"队列堵塞时怎么办"放在团队找得到的地方。
- **降低平均恢复时间 (MTTR)**——自动步骤秒级完成；手动步骤消除决策瘫痪。
- **审计响应动作**——每个步骤、每个输出、每次响应者点击都记录在执行上。
- **赋能初级工程师**——他们能放心运行 Runbook，而不必凌晨三点呼叫资深同事。
- **靠数据而非记忆写事后回顾**——保留下来的执行就是当时实际发生了什么的冻结记录。

## 关键概念

后面文档中会反复出现的几个术语，先理顺：

| 术语 | 含义 |
| --- | --- |
| **Runbook** | 模板。一段命名的可复用流程，包含有序的步骤列表和 `isEnabled` 开关。 |
| **步骤** | Runbook 中的一项。具有类型（Manual / JavaScript / HTTP / Bash）、标题、描述和该类型专属配置。 |
| **Runbook 规则** | 当事件、告警或计划维护的标题或描述匹配正则时，自动附加一个或多个 Runbook 的模式。 |
| **执行** | Runbook 的一次运行。规则触发、有人在事件上点"运行 Runbook"、或在 Runbook 上点"立即运行"时创建。保存步骤快照以及每步的状态/输出。 |
| **快照** | Runbook 步骤在每次执行上的冻结副本。让你随后能修改模板而不改写历史。 |

## Runbook 的生命周期

1. **撰写** — 创建一个 Runbook，混合 Manual、JavaScript、HTTP 和 Bash 步骤，保存。
2. **（可选）添加规则** — 在事件、告警或计划维护的设置中，让 OneUptime 在事件标题或描述匹配正则时启动这个 Runbook。
3. **触发** — 要么匹配事件被创建时规则自动触发，要么响应者在事件上手动点击 **运行 Runbook**。
4. **执行** — 创建一个新执行并附带步骤快照。自动步骤在 Runbook worker 上运行；遇到 Manual 步骤就暂停，等待有人勾选。
5. **审计** — 执行永远留在事件的 **Runbooks** 标签和 Runbook 的执行列表中。每步的输出、错误和时间都保留，供事后回顾用。

## 何时用哪种步骤类型

快速决策指南。更详细的拆解见 [编写 Runbook](/docs/runbooks/authoring)。

| 步骤类型 | 适用场景 | 例子 |
| --- | --- | --- |
| **Manual** | 必须由人来验证、判断或执行 OneUptime 无法观察的动作。 | "在负载均衡器仪表板上确认副本区域流量。" |
| **JavaScript** | 需要一个小的、封闭的计算——查询配置服务、转换 payload、在下一步前执行逻辑。 | 计算当前副本延迟并决定是否继续。 |
| **HTTP 请求** | 你在调用现有 API——自家管理接口、云厂商、PagerDuty、Slack。 | 向 failover 协调器 `POST`。 |
| **Bash** | 你需要在自己的基础设施上运行 shell 命令 — 重启服务、执行 `kubectl`、调用部署脚本。需要在你的环境中安装 [Runbook 代理](/docs/runbooks/agents)。 | 重启服务，`kubectl rollout restart`，运行恢复脚本。 |

一个 Runbook 中可以混用全部四种——Runbook 的力量在于把人的确认与自动化交织起来。

## Runbook 在仪表板中的位置

| 页面 | 你在那里做什么 |
| --- | --- |
| **分析与自动化 → Runbooks** | 浏览、创建、编辑 Runbook 模板。 |
| **Runbook 的步骤标签** | 编写并重排步骤列表。 |
| **Runbook 的执行标签** | 按状态过滤查看此 Runbook 的所有运行。 |
| **Runbook 的"立即运行"按钮** | 启动一次不绑定任何事件的临时执行。 |
| **事件 / 告警 / 计划维护 → 设置 → Runbook 规则** | 为每种实体类型创建自动触发规则。 |
| **事件 / 告警 / 维护事件 → Runbooks 标签** | 查看绑定到该事件的执行，并点击 **运行 Runbook** 进行手动运行。 |

## 常见用例

团队常用 Runbook 应对的几种模式：

- **数据库 failover** — 用 JavaScript 捕获当前状态，请值班 DBA 确认副本健康（Manual），调用协调器 API（HTTP），勾选"DNS 已更新"（Manual），向 Slack 发布"恢复正常"（HTTP）。
- **清理缓存** — 一条 HTTP 步骤加一条 Manual "确认仪表板上缓存命中率正在恢复"。
- **影响客户的事件** — Manual：在状态页发布更新；HTTP：在 #customer-incidents 通知 CS 团队；JavaScript：从内部 API 拉取受影响账号列表。
- **计划维护前检查** — JavaScript：对当前指标拍快照；Manual：与相关方确认变更窗口；HTTP：在负载均衡器上启用维护模式。
- **始终运行的卫生规则** — 一条标题模式为空的规则，在每次事件上都捕获系统状态——做事后回顾时非常有用。

## 完整示例

假设你希望每个标题包含 "db-primary" 的事件都自动启动一个五步的数据库 failover Runbook。

**1. 创建 Runbook。** 在 **Runbooks → 创建 Runbook** 中，命名为 "DB primary failover" 并添加以下步骤：

| # | 类型 | 标题 |
| --- | --- | --- |
| 1 | JavaScript | failover 前捕获副本延迟 |
| 2 | Manual | 在 DBA 仪表板确认副本健康 |
| 3 | HTTP | 向 failover 协调器 `POST` |
| 4 | Manual | 验证写入已切到新主库 |
| 5 | HTTP | 在 Slack `#db-incidents` 发布"恢复正常" |

**2. 添加规则。** 在 **事件 → 设置 → Runbook 规则** 中创建：

```
标题模式：  ^db-primary
Runbooks：  [DB primary failover]
```

**3. 触发。** 监控告警打开事件 `INC-4821 · db-primary connection timeout`。规则匹配，创建一次执行：

- 步骤 1（JavaScript）立即在 worker 上运行，`return { lagMs: 412 }` 被记录。
- 步骤 2（Manual）让执行暂停。值班看到事件页上的"等待您"标签，查看仪表板后勾选。
- 步骤 3（HTTP）在步骤 2 被勾选后立即运行，`POST` 响应体被记录。
- 步骤 4（Manual）再次暂停。
- 步骤 5（HTTP）运行，执行结束。

**4. 审计。** 执行留在事件的 **Runbooks** 标签上。每步输出一键即看。下周写事后回顾时，你不必再问"那段脚本返回了什么？"——就在那里。

## Runbook 与 OneUptime 其它模块的配合

- **监控**打开事件与告警；**Runbook 规则**把这些事件转成 Runbook 执行。两者合起来形成闭环：检测 → 触发 → 响应 → 记录。
- **Workspace 集成**（Slack、Microsoft Teams）是 Runbook HTTP 步骤的天然目标——发布状态更新、通知频道。
- **状态页**经常作为客户影响 Runbook 中的 Manual 步骤被更新。
- **值班排班**决定谁被叫到；Runbook 决定那个人醒来后该做什么。

## 接下来读什么

- [编写 Runbook](/docs/runbooks/authoring) — 创建 Runbook，四种步骤类型以及各自的作用。
- [Runbook 规则](/docs/runbooks/rules) — 把 Runbook 自动附加到事件、告警和计划维护上。
- [运行 Runbook](/docs/runbooks/running) — 手动触发、执行视图，以及手动与自动步骤的交互。
- [Runbook 代理](/docs/runbooks/agents) — 安装在你自己基础设施中运行 Bash 步骤的代理。
- [配置与安全](/docs/runbooks/configuration) — 输出上限、权限、加固说明。
