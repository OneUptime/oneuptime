# Runbook 配置与安全

## 输出上限

- 每步输出：**50KB**。超出部分会带标记被截断。
- 每步默认超时：JavaScript、Bash、HTTP 都是 **30 秒**。可逐步骤配置。
- Bash 步骤默认 **认领超时**：**2 分钟** — Worker 等待 Runbook 代理认领作业的最长时间，超过则该步骤失败。

## 权限

Runbook 权限位于 `Runbook` 权限组：

- `CreateRunbook`、`EditRunbook`、`DeleteRunbook`、`ReadRunbook` — 管理 Runbook 模板。
- `CreateRunbookExecution`、`EditRunbookExecution`、`ReadRunbookExecution` — 启动、勾选、读取执行。
- `CreateRunbookRule`、`EditRunbookRule`、`DeleteRunbookRule`、`ReadRunbookRule` — 管理自动触发规则。
- `CreateRunbookAgent`、`EditRunbookAgent`、`DeleteRunbookAgent`、`ReadRunbookAgent` — 管理在你自己的基础设施中执行 Bash 步骤的 Runbook 代理。
- `RunbookAdmin`（角色）— 打包以上所有权限；分配给团队即可拥有完整的 Runbook 能力。

## 队列与 worker

Runbook 执行运行在 `Runbook` BullMQ 队列上。worker 并发为 25——如果你的部署同时有大量执行，请调整。

当 Manual 步骤通过 API 被勾选时，执行会重新入队以从下一步继续。这样 worker 在 Runbook 剩余步骤期间保持热态。

## 加固说明

- **JavaScript 步骤** 在 `isolated-vm` 中运行，并带有沙箱加固序言（切断原型链、移除 `Function` 与 `eval`、冻结内置原型）。
- **Bash 步骤** 永远不在 OneUptime Worker 上运行。它们以作业的形式分派给你安装在自己基础设施中的 [Runbook 代理](/docs/runbooks/agents)。Worker 用步骤的 **Agent Tag** 将作业入队，由代理原子地认领、在本地执行 `bash -c <脚本>`，然后把结果回传。Worker 进程本身没有进入你环境的 shell 权限。
- **HTTP 步骤** 使用宽松的状态校验器，因此 4xx 或 5xx 响应会作为失败步骤记录而不是抛出。捕获的输出真实反映对方返回了什么。

## 数据库表

- `Runbook` — 模板（name、slug、description、isEnabled、步骤 JSON）。
- `RunbookExecution` — 每次运行一行，含可空外键 `incidentId`、`alertId`、`scheduledMaintenanceId` 以及一个 JSON 数组 `stepExecutions`，保存步骤快照与每步状态。
- `RunbookRule` — 自动触发规则，含 `triggerEntityType` 判别字段（Incident、Alert、ScheduledMaintenance）以及与要启动的 Runbook 的多对多关联。
- `RunbookAgent` — 每个已安装代理一行：名称、标签、密钥、`lastAlive`、`connectionStatus`、主机信息。
- `RunbookAgentJob` — 每个派发的 Bash 步骤一行：所需标签、脚本、状态（Pending → Claimed → Running → Succeeded/Failed/TimedOut/Cancelled）、认领截止、租约、输出、退出码。

## 运维提示

- **每个被使用的标签至少跑一个代理**，最好两个以获得高可用。两个相同标签的代理任一都能认领作业 — 你可以滚动重启而不破坏 runbook。
- **捕获 URL，而非数据块。** 如果步骤产生超过几 KB 的数据，请写到 S3 或日志栈，把 URL 放进返回值。
- **幂等性很重要。** 自动步骤（HTTP、JavaScript、Bash）在 worker 中途重启时，或在脚本仍在运行时代理租约过期，都可能多次运行；要设计成可安全重试。
