# Runbook 代理

**Runbook 代理** 是一个小型的自托管进程，**在你自己的基础设施内**执行 Runbook 的 Bash *和* JavaScript 步骤。OneUptime Worker 永远不会自己执行你的脚本——它只把任务放入队列，由步骤作者所挑选的 Runbook 代理把它们取走、执行，并将结果回报。

JavaScript 仍然在 `isolated-vm` 沙箱中运行；区别在于沙箱住在你的代理主机上，而不是我们这边。

本页说明如何安装代理、如何把 Bash 与 JavaScript 步骤指向它，以及日常的运营。

## 为什么需要代理

更早版本的 OneUptime 把 Bash 和 JavaScript 步骤跑在 Worker 上。JavaScript 被沙箱化（通过 `isolated-vm`），Bash 则不是。两者对单租户自托管之外的任何场景都有问题：

- **信任边界。** 任何能写 Runbook 的人都能在 Worker 上执行代码，并访问 Worker 自己的环境变量与文件系统。JavaScript 沙箱挡住了明显的攻击，但挡不住一个有决心的用户去探测从我们网络可达的范围。
- **触达范围。** 大多数有用的步骤想操作的是*客户的*基础设施（"重启这个服务"、"在我们集群上跑 kubectl"、"在我们内部数据库里查一条记录"），而不是 OneUptime 的。

Runbook 代理把这件事翻转过来。Bash 和 JavaScript 步骤不再跑在我们这里。它们跑在你控制的主机上，而那台主机能做什么由你决定。

## 工作方式

1. 你在 OneUptime 中创建一个 Runbook 代理。OneUptime 会生成一个 ID 和密钥。
2. 你在基础设施内的主机上运行代理容器，传入该 ID/密钥以及你的 OneUptime URL。
3. 代理每隔几秒钟轮询 OneUptime，问"我有活干吗？"
4. 当你编写一个 Bash 或 JavaScript 步骤时，从下拉列表里选定代理——这个步骤被绑定到那个特定的代理。
5. 步骤运行时，Worker 会插入一行任务，把 `targetAgentId` 设成那个代理。只有那个代理能领取它。
6. 代理在本地执行脚本——Bash 走 `bash -c <script>`，JavaScript 进 `isolated-vm` 沙箱——捕获结果并回报。Worker 收到结果后继续推进 Runbook。

代理只需要 **对外 HTTPS** 即可连到你的 OneUptime 实例。它不接受任何入站连接。

## 安装代理

### 1. 创建代理记录

进入 **Runbooks → 设置 → 代理** 并新建一个代理。填写：

| 字段 | 说明 |
| --- | --- |
| **名称** | 友好名 — 通常写成 `它在哪运行、能做什么`，例如 `prod-eu-west-1`。这就是写步骤时下拉列表里看到的名字。 |
| **描述** | 可选。用一句话说明这台主机能触达什么。未来的你会感谢。 |

### 2. 复制安装命令

创建代理后，在它那一行点 **显示设置说明**。你会看到一个预填了该代理 ID 和密钥的 `docker run` 命令。**现在就把密钥保存好** — 之后可以重置它，但关闭对话框后就再也看不到同一份密钥值。

### 3. 在基础设施内的主机上运行

在你环境中能做到以下两件事的任意一台主机上运行 Docker 命令：

- 通过 HTTPS 触达你的 OneUptime 实例，并且
- 做你希望 Bash/JavaScript 步骤做的事（例如 SSH 到其他主机、`kubectl`、与数据库通信）。

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runbook-agent:release
```

### 4. 确认代理已连接

回到 **Runbooks → 设置 → 代理**。约 60 秒之内，这个代理的那一行应该切换到 `Connected`，并显示新的 **最近活跃** 时间戳。如果它一直 `Disconnected`：

- 查看容器日志（`docker logs oneuptime-runbook-agent`）寻找认证错误或网络失败。
- 用 `curl` 验证主机能否触达你的 OneUptime URL。
- 验证 ID 与密钥拷贝时没有夹带空白字符。

## 把步骤指向某个代理

在你的 Runbook 中添加一个 Bash 或 JavaScript 步骤。表单里有一个 **Runbook 代理** 下拉框，列出当前项目里的全部代理（带连接/未连接标识）：

- 选定应当运行此步骤的代理。
- 在下方编辑器中编写你的脚本。

Runbook 运行到该步骤时，Worker 会排入一条任务，目标即为该代理的 ID。只有那个代理能领取。Bash 通过 `bash -c` 执行；JavaScript 跑在代理上的 `isolated-vm` 沙箱（无文件系统、无网络、无 `Function`/`eval`）。

需要多个代理？把它们都建好，然后把不同步骤分别指向最合适的那个。如果你想要冗余，可以写两个 Runbook（每个对应一个代理），或者把步骤拆到不同代理上。

## 运营注意事项

### 超时

每个 Bash 或 JavaScript 步骤会受两个超时控制：

| 超时 | 默认值 | 控制的内容 |
| --- | --- | --- |
| **领取超时** | 2 分钟 | Worker 等待被选定代理来领任务的时长。代理没及时领的话，步骤会以 `TimedOut` 失败，Runbook 继续走（或停下，取决于 **失败时继续**）。 |
| **执行超时** | 30 秒 | 代理允许脚本运行的最长时间，到时会终止它。可按步骤配置。（Bash 收到 `SIGKILL`；JavaScript 的 isolate 被销毁。） |

Worker 的整体等待窗口是 `领取超时 + 执行超时 + 几秒`。挑能配得上步骤的数字。

### 租约与心跳

代理领到任务时会获得一段短的租约（默认 30 秒）。脚本运行期间，代理每 10 秒续约一次。如果代理在脚本运行途中死掉或断网，租约到期后 Worker 会把任务标记为 `TimedOut`，而不是无限等待。

租约到期时 Bash 子进程**并不会**被自动取消（JavaScript 的 isolate 也会被放任跑完）——但 Worker 不再等它们，而且一旦有别的领取接管之后，代理也无法再提交结果。如果你在意"恰好一次"，请把脚本设计成可以安全重跑。

### 没有在线代理时

如果步骤运行那一刻被选中的代理是离线的，任务会保持 `Pending` 直到领取超时到点，然后以一条清晰的"没有代理领取任务"信息失败。在正经上 Runbook 之前，去代理页面确认覆盖情况。

### 输出上限

每步合并的 stdout + stderr 上限是 **50 KB**。更大的输出会被带标记截断。如果你需要完整日志，在脚本里把它写到 S3 或你的日志存储，然后 `echo` 那个 URL。

### 取消

取消 Runbook 执行（从执行视图或 API）会立即把其中所有 `Pending`/`Claimed`/`Running` 的 Bash 与 JavaScript 任务标为 `Cancelled`。已经在跑脚本的代理仍会跑完手头的活，但它的结果不会被服务器接受。

### 并发

每个代理默认一次只跑一个任务。要允许更多，在代理容器上设置 `RUNBOOK_AGENT_CONCURRENCY` — 但记住代理是和该主机上其他东西共享资源的。

## 环境变量

代理在启动时读取以下变量：

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | 是 | — | 你的 OneUptime 实例基础 URL，例如 `https://oneuptime.yourdomain.com`。 |
| `RUNBOOK_AGENT_ID` | 是 | — | 代理设置对话框中显示的 UUID。 |
| `RUNBOOK_AGENT_KEY` | 是 | — | 代理设置对话框中显示的密钥。 |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS` | 否 | `5000` | 代理轮询新任务的频率。 |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS` | 否 | `60000` | 代理上报存活的频率。 |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | 否 | `10000` | 代理为运行中任务续约的频率。 |
| `RUNBOOK_AGENT_CONCURRENCY` | 否 | `1` | 该代理上最多同时跑的任务数。 |

## 轮换代理密钥

如果密钥泄漏，到 OneUptime 中打开该代理并重置其密钥。旧密钥会立即失效。用新密钥更新代理容器并重启。

## 权限

代理管理位于现有 Runbooks 权限组之下：

- `CreateRunbookAgent`、`EditRunbookAgent`、`DeleteRunbookAgent`、`ReadRunbookAgent` — 管理代理记录。
- `RunbookAdmin`、`RunbookMember`、`RunbookViewer`（角色） — 分配给团队以分别授予完整控制、日常使用或只读访问。`RunbookAdmin` 把上面所有细粒度权限打包在一起。

*触发* Runbook（从而让 Bash 与 JavaScript 步骤被派发）的权限仍是 `CreateRunbookExecution` / `EditRunbookExecution`。

## 面向代理的 API

供好奇者参考——代理使用以下端点。所有端点都挂在 `/runbook-agent-ingest` 下，通过 JSON 体里的代理 ID + 密钥（或 `x-agent-id` / `x-agent-key` 头）认证。

| 端点 | 用途 |
| --- | --- |
| `POST /heartbeat` | 存活上报；更新 `lastAlive`、`connectionStatus`、`hostInfo`、`agentVersion`。 |
| `POST /claim-next-job` | 原子性地领取目标为该代理 ID 的最早一条 `Pending` 任务。没有可做的事时返回 `{ job: null }`。 |
| `POST /job/:jobId/heartbeat` | 续约任务租约。租约已失效或任务终止时返回 404。 |
| `POST /job/:jobId/result` | 提交最终结果。如果租约已经转移，会被忽略。 |

你不需要手动调这些 API — 自带的代理会做。把它们记在这里是为了在我们的代理不满足你某个约束时，你能写自己的代理。
