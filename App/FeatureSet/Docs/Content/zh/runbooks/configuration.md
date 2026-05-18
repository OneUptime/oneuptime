# Runbook 配置与安全

## Bash 与 JavaScript 究竟是怎么跑的

Bash 和 JavaScript 步骤**绝不在 OneUptime Worker 上执行**。它们被作为任务派发到某个特定的 [Runbook 代理](/docs/runbooks/agents) — 你在自己基础设施内某台主机上安装的一个小进程。

派发模型：

1. Runbook 步骤的作者在写步骤时从下拉列表里选定一个 Runbook 代理。
2. 步骤运行时，Worker 在 `RunbookAgentJob` 里插入一行，把 `targetAgentId` 设为该代理 ID，状态为 `Pending`。
3. 那个特定的代理（且只有它）原子性地领取任务，在本地执行脚本 — Bash 走 `bash -c <script>`，JavaScript 在 `isolated-vm` 沙箱中 — 然后回报结果。
4. Worker 拿到结果后继续推进 Runbook。

不再有 `RUNBOOK_BASH_ENABLED` 这样的环境变量开关。一个部署里 Bash 或 JavaScript 步骤能不能跑，完全取决于该项目里是否至少有一个已连接的 Runbook 代理。

## 输出上限与超时

- 每步输出：**50&nbsp;KB**。超过部分会带标记被截断。
- 每步执行超时默认值：JavaScript、Bash 和 HTTP 都是 **30 秒**。可按步骤配置。
- Bash 与 JavaScript 步骤的 **领取超时**：**2 分钟** — Worker 在判定失败前等待被选定代理来领任务的时长。

## 权限

Runbook 权限位于 `Runbook` 权限组：

- `CreateRunbook`、`EditRunbook`、`DeleteRunbook`、`ReadRunbook` — 管理 Runbook 模板。
- `CreateRunbookExecution`、`EditRunbookExecution`、`ReadRunbookExecution` — 启动、勾选与查看执行。
- `CreateRunbookRule`、`EditRunbookRule`、`DeleteRunbookRule`、`ReadRunbookRule` — 管理自动触发规则。
- `CreateRunbookAgent`、`EditRunbookAgent`、`DeleteRunbookAgent`、`ReadRunbookAgent` — 管理那些在你自己基础设施中执行 Bash 与 JavaScript 步骤的 Runbook 代理。
- `RunbookAdmin`、`RunbookMember`、`RunbookViewer`（角色） — 分配给团队以分别授予完整控制、日常使用或只读访问。`RunbookAdmin` 把上述细粒度权限打包在一起。

## 队列 & worker

Runbook 执行运行在 `Runbook` 这条 BullMQ 队列上。worker 并发为 25 — 同时运行数多时请在你的部署里调整。

手动步骤通过 API 被勾选后，执行会被重新入队，从下一步继续。这样 worker 在剩余的 Runbook 期间保持热。

## 加固说明

- **JavaScript 和 Bash** 跑在你控制的 Runbook 代理主机上，而不是 OneUptime Worker 上。JavaScript 被包在 `isolated-vm` 沙箱里，加常规前奏（切断原型链、移除 `Function`/`eval`、冻结内置原型）。Bash 在代理上通过 `bash -c` 跑，并在代理侧强制执行超时。
- **HTTP 步骤** 使用宽松的状态验证器，所以 4xx 或 5xx 响应会被记录为失败的步骤而非抛错。这样捕获的输出能反映上游实际返回的内容。
- **代理认证** 通过设置在代理容器上的 ID + 密钥环境变量完成。服务端权威的代理身份来自由所提交 ID/密钥定位到的数据库行——即便密钥被泄露，客户端也不能冒充别的代理。

## 数据库表

- `Runbook` — 模板（name、slug、description、isEnabled、steps JSON）。
- `RunbookExecution` — 每次运行一行，带可空的 `incidentId`、`alertId` 和 `scheduledMaintenanceId` 外键，以及一个 JSON `stepExecutions` 数组，对步骤和每步状态做快照。
- `RunbookRule` — 自动触发规则，带 `triggerEntityType` 区分（Incident、Alert、ScheduledMaintenance），以及与要启动的 Runbook 的多对多关系。
- `RunbookAgent` — 每个已安装代理一行：name、secret key、`lastAlive`、`connectionStatus`、主机信息。
- `RunbookAgentJob` — 每个派发的 Bash 或 JavaScript 步骤一行：`targetAgentId`（步骤作者选定的代理）、步骤类型、脚本、状态（`Pending` → `Claimed` → `Running` → `Succeeded`/`Failed`/`TimedOut`/`Cancelled`）、领取截止、租约、输出、退出码。

## 运营建议

- **确认你在步骤里挑选的代理是健康的。** 如果你需要冗余，运行第二个代理把步骤拆开，或者维护一个面向另一个代理的备用 Runbook。
- **捕获 URL，而不是大块数据。** 如果某步产生超过几 KB 的输出，把它写到 S3 或日志栈，然后返回 URL。
- **幂等性很重要。** 自动步骤（HTTP、JavaScript、Bash）在 worker 在步骤中途重启时，或者代理租约在脚本仍在跑时到期时，可能不止跑一次；把它们设计成可以安全重试。
