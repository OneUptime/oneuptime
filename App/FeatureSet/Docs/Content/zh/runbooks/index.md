# Runbook 概览

Runbook 是可复用的响应流程——由手动或自动步骤组成的有序列表——你可以将它附加到事件、告警或计划维护上。它把"现在该怎么办？"这种临时的 Slack 讨论，变成同事在凌晨三点也能从零接手的工作。

## 一览

- OneUptime 仪表板 **分析与自动化 → Runbooks** 下的**顶层功能**。
- **四种步骤类型**：手动清单、JavaScript（沙箱）和 Bash（两者都在你自己的基础设施中的 [Runbook 代理](/docs/runbooks/agents) 上运行）、HTTP 请求。
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
| **JavaScript** | 需要一个小的、封闭的计算——查询配置服务、转换 payload、在下一步前执行逻辑。在你自己的基础设施中的 [Runbook 代理](/docs/runbooks/agents) 上以沙箱方式运行。 | 计算当前副本延迟并决定是否继续。 |
| **HTTP 请求** | 你在调用一个已有的 API——自己的管理端点、云供应商、PagerDuty、Slack。 | 向你的故障切换编排器 `POST`。 |
| **Bash** | 你需要在自己的基础设施上执行 shell 命令——重启服务、跑 `kubectl`、调用部署脚本。需要在你的环境中安装 [Runbook 代理](/docs/runbooks/agents)。 | 重启服务、跑 `kubectl rollout restart`、执行恢复脚本。 |

四种类型可以混在同一个 Runbook 里——Runbook 的优势就在于让人为校验和自动化交织。

## Runbook 在仪表板的位置

| 页面 | 在那里做什么 |
| --- | --- |
| **分析与自动化 → Runbooks** | 浏览、创建和编辑 Runbook 模板。 |
| Runbook 的 **步骤** 标签 | 编写步骤列表并调整顺序。 |
| Runbook 的 **执行** 标签 | 按状态筛选查看此 Runbook 的所有运行。 |
| Runbook 的 **立即运行** 按钮 | 启动一次不附属任何事件的临时执行。 |
| **事件 / 告警 / 计划维护 → 设置 → Runbook 规则** | 按实体类型创建自动触发规则。 |
| 事件 / 告警 / 维护事件 → **Runbooks** 标签 | 查看附加到该事件的执行，并点击 **运行 Runbook** 手动运行。 |

## 常见用法

团队常用 Runbook 解决的几个模式：

- **数据库故障切换** — 用 JavaScript 捕获当前状态，由 Manual 让值班 DBA 确认副本健康，用 HTTP 调用编排器 API，用 Manual 勾选"DNS 已更新"，用 HTTP 在 Slack 发恢复通告。
- **缓存刷新** — 一个 HTTP 步骤加一个 Manual 步骤"在仪表板上确认缓存命中率正在恢复"。
- **影响客户的事件** — Manual：发布状态页更新。HTTP：在 `#customer-incidents` 通知客户成功团队。JavaScript：从内部 API 拉取受影响账户列表。
- **计划维护前置检查** — JavaScript：快照当前指标。Manual：与相关方确认变更窗口。HTTP：在负载均衡器上启用维护模式。
- **常驻卫生检查** — 标题模式为空的规则会在每个事件上捕获系统状态，无论标题是什么——非常适合事后回顾。

## 完整示例

假设你希望所有标题里包含"db-primary"的事件都自动触发一个五步的 DB 故障切换 Runbook。

**1. 创建 Runbook。** 在 **Runbooks → 创建 Runbook** 中命名为"DB primary failover"，并添加这些步骤：

| # | 类型 | 标题 |
| --- | --- | --- |
| 1 | JavaScript | 捕获故障切换前的副本延迟 |
| 2 | Manual | 在 DBA 仪表板上确认副本健康 |
| 3 | HTTP | 向故障切换编排器 `POST` |
| 4 | Manual | 验证写入已转向新主库 |
| 5 | HTTP | 在 `#db-incidents` Slack 通告恢复 |

**2. 添加规则。** 在 **事件 → 设置 → Runbook 规则** 中创建：

```
标题模式：    ^db-primary
Runbooks：    [DB primary failover]
```

**3. 触发。** 一次监控告警打开了事件 `INC-4821 · db-primary connection timeout`。规则匹配，执行被创建，然后：

- 步骤 1 (JavaScript) 在 worker 上立刻运行——它的 `return { lagMs: 412 }` 值被捕获。
- 步骤 2 (Manual) 暂停了执行。值班人员在事件页看到"正在等你"标记，点开仪表板，并勾选步骤。
- 步骤 3 (HTTP) 在步骤 2 被勾选后立即运行——`POST` 响应体被捕获。
- 步骤 4 (Manual) 再次暂停。
- 步骤 5 (HTTP) 运行后执行结束。

**4. 审计。** 执行留在事件的 **Runbooks** 标签上。每个步骤的输出一键可看。下周你写事后回顾时不必再问"那个脚本返回了什么？"——它就在那儿。

## Runbook 如何与 OneUptime 的其他部分配合

- **监控** 打开事件和告警；**Runbook 规则** 把那些事件变成 Runbook 执行。两者一起构成"检测 → 触发 → 响应 → 记录"的闭环。
- **工作区连接**（Slack、Microsoft Teams）是 Runbook HTTP 步骤天然的目标——发状态更新、通知频道。
- **状态页** 通常作为影响客户的 Runbook 中 Manual 步骤来更新。
- **值班排班** 决定谁会被呼叫；Runbook 决定那个人醒来之后做什么。

## 接下来读什么

- [编写 Runbook](/docs/runbooks/authoring) — 创建 Runbook、四种步骤类型以及各自的作用。
- [Runbook 规则](/docs/runbooks/rules) — 把 Runbook 自动附加到事件、告警和计划维护。
- [运行 Runbook](/docs/runbooks/running) — 手动触发、执行视图，以及手动步骤与自动步骤的互动。
- [Runbook 代理](/docs/runbooks/agents) — 安装在你自己的基础设施中运行 Bash 步骤的代理。
- [配置与安全](/docs/runbooks/configuration) — 输出限制、权限和加固说明。
