# 编写 Runbook

在 **Runbooks → 创建 Runbook** 中创建 Runbook，然后打开它并进入 **步骤** 标签。

## 步骤的结构

每个步骤都有：

| 字段 | 用途 |
| --- | --- |
| **标题** | 清单 UI 中显示的简短标签。必填。 |
| **描述** | 给响应者的可选上下文。支持 Markdown 文本。 |
| **失败时继续** | 打开后，失败的步骤不会中断运行——下一步仍会执行。 |
| **需要审批** | 打开后，Runbook 在该步骤后暂停，并等待用户审批后再执行下一步。 |
| **类型相关配置** | 脚本、URL、代理等——见下文。 |

步骤按**顺序**执行。可在步骤编辑器上用上下箭头调整顺序。

## 步骤类型

### Manual

由响应者勾选的复选框。Runbook 执行到 Manual 步骤时暂停，状态保持 `WaitingForManualStep`，直到有人把它标记为完成（或跳过）。

用于只有人能验证的事情："已确认在负载均衡器仪表板上流量已切换到副本区域。"

### JavaScript

在沙箱 `isolated-vm` 中运行的 JavaScript 片段。沙箱住在你自己的基础设施内的 [Runbook 代理](/docs/runbooks/agents) 上——而不在 OneUptime Worker 上。

JavaScript 步骤上需要配置两件事：

- **Runbook 代理** — 从下拉列表中选定应运行此步骤的代理。只有被选定的代理才能领取任务。
- **脚本** — 要运行的 JavaScript。

```js
const start = Date.now();
// ... your logic ...
return { durationMs: Date.now() - start };
```

返回值会被记录到步骤执行上。`console.log` 输出会作为日志行被捕获。默认执行超时：30 秒。默认领取超时（Worker 等待代理领任务的时长）：2 分钟。

### HTTP 请求

发起一次出站 HTTP 调用。配置方法（GET/POST/PUT/PATCH/DELETE/HEAD）、URL、可选 JSON 头部以及可选请求体。响应状态、头部和正文都会被捕获（总计上限 50KB）。

适用场景：触发 PagerDuty 事件、向 Slack 发消息、调用自己的管理 API 等。HTTP 步骤直接在 OneUptime Worker 上运行；不需要代理。

### Bash

bash 脚本（`bash -c <script>`）在你自己的基础设施内的 [Runbook 代理](/docs/runbooks/agents) 上运行。Bash 绝不会在 OneUptime Worker 上执行。

Bash 步骤上需要配置两件事：

- **Runbook 代理** — 从下拉列表中选定应运行此步骤的代理。只有被选定的代理才能领取任务。
- **脚本** — 要运行的 bash。输出（stdout + stderr）会被捕获，最多 50 KB；超时时进程会被 kill。

如果 Runbook 到达此步骤时所选代理离线，步骤会等待至 **领取超时**（默认 2 分钟）然后以 `TimedOut` 失败。在依赖 Bash 步骤之前，请先在 **Runbooks → 设置 → 代理** 中添加代理。

## 保存与编辑

按 **保存步骤** 持久化。旧版本 Runbook 的进行中执行不受影响——它们继续使用自己的快照。

## 多个步骤与失败处理

默认情况下，失败的步骤会中断运行，把执行标记为 `Failed`。如果你在某个步骤上设置了 **失败时继续**，失败会被记录但下一步仍会运行。这适合"试这三件事，然后通知"这种模式。

## 完整示例

一个简单的"DB 主库不可达" Runbook：

1. **JavaScript** — 从配置服务获取当前主库主机并记录到日志。
2. **Manual** — "确认副本上的复制延迟低于 5 秒。"
3. **HTTP 请求** — 向你的故障切换编排器 API POST。
4. **Manual** — "验证写入已转向新主库。"
5. **HTTP 请求** — 向 Slack POST 一条"恢复"消息。

响应者会看着一个自动步骤运行，勾选一个手动步骤，再看下一个自动步骤运行，以此类推。每个步骤的输出都为事后回顾被捕获。
