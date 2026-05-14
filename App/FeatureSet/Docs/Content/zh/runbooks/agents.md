# Runbook 代理

**Runbook 代理**是一个小型的自托管进程,**在你自己的基础设施内**执行 Runbook 的 Bash 步骤。OneUptime Worker 永远不会自己执行你的 shell 命令 — 它只把命令放入队列,而由你安装在自己环境中的 Runbook 代理把它们取走、执行、并将结果回报。

本页说明如何安装一个代理、把 Bash 步骤路由到它、以及如何日常运维。

## 为什么需要代理

OneUptime 早期版本直接在 Worker 上执行 Bash 步骤。这在单租户自托管部署里没问题 — 那里的运维本来就有对宿主机的 shell 权限。但对其他人有两个问题:

- **信任边界**:任何能编写 Runbook 的人都能在 Worker 上执行 shell,可以访问 Worker 拥有的所有环境变量和文件系统。
- **可达性**:大多数有用的 Bash 步骤想要操作的是*客户*侧基础设施(「重启这个服务」、「在我们的集群上跑 kubectl」),而不是 OneUptime 侧的。

Runbook 代理把这反过来。Bash 步骤不在我们这里运行。它们运行在你控制的主机上,而你决定那台主机可以做什么。

## 工作原理

1. 你在 OneUptime 创建一个 Runbook 代理,OneUptime 会生成一个 ID 和一个秘密密钥。
2. 你用那对 ID/密钥加上你的 OneUptime URL,在你基础设施里的一台主机上启动代理容器。
3. 代理每隔几秒问 OneUptime:「有我要做的活儿吗?」
4. 当一个 Bash 步骤运行时,Worker 插入一行作业记录,标上该步骤的 **Agent Tag**,并把状态设为 `Pending`。
5. 同一项目中带有该标签的任一健康代理会原子地认领该作业(永远不会有两个代理执行同一个作业),在本地运行 `bash -c <你的脚本>`,捕获 stdout/stderr/退出码,然后把结果回送。
6. Worker 收到结果后继续 Runbook。

代理只需要到你 OneUptime 实例的**出站 HTTPS**。它不接受任何入站连接。

## 安装代理

### 1. 创建代理记录

进入 **Runbooks → Agents → 新建**,填写:

| 字段 | 说明 |
| --- | --- |
| **名称** | 一个有意义的名字 — 通常是 `跑在哪里-能做什么`,比如 `prod-eu-west-1`。 |
| **描述** | 可选。一句话说明这台主机能访问到什么。未来的你会感谢现在的你。 |
| **标签** | 用逗号分隔。Bash 步骤指向一个标签;项目里任何带有该标签的代理都可以执行。常见模式:`prod`、`staging`、`eu-west-1`、`db-host`。 |

### 2. 复制安装命令

创建代理后,点击该行的 **显示安装说明**。你会看到一个已经填好该代理 ID 和密钥的 `docker run` 命令。**现在就保存密钥** — 之后你可以重置它,但关闭弹窗后无法再看到同一个值。

### 3. 在基础设施里的主机上运行

在你环境里能做下面这些事的任一主机上执行 Docker 命令:

- 通过 HTTPS 访问你的 OneUptime 实例,以及
- 做你希望 Bash 步骤做的事(比如 SSH 到其他主机、`kubectl`、连数据库)。

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.你的域名.com \
  -d oneuptime/runbook-agent:release
```

### 4. 确认代理已连接

回到 **Runbooks → Agents**。大约 60 秒内,代理那一行应当切换为 `Connected`,**Last seen** 时间戳是最新的。如果它一直是 `Disconnected`:

- 看容器日志(`docker logs oneuptime-runbook-agent`),寻找认证错误或网络错误。
- 确认主机能用 `curl` 访问 OneUptime URL。
- 确认复制 ID 和密钥时没有粘到空白字符。

## 标签与路由

标签是 Bash 步骤找到代理的方式。几个模式:

- **每个环境一个标签**。给 prod 代理打 `prod`,staging 打 `staging`。指向 `prod` 的 Bash 步骤只在 prod 上跑。
- **每个区域一个标签**。`eu-west-1`、`us-east-1`。当步骤需要靠近它要操作的资源时很有用。
- **多个代理,同一标签**。跑两个都带 `prod` 标签的代理。任一个都能认领作业 — 提供高可用,允许你做滚动重启而不破坏 Runbook。
- **每个代理多个标签**。你 prod EU 集群里的代理可以同时带 `prod`、`eu-west-1` 和 `kubernetes`。Bash 步骤可以指向其中任一个。

一个 Bash 步骤**必须**指定且只能指定一个代理标签。多标签路由(运行在任何同时带有 `prod` AND `db` 的代理上)在路线图上,这个版本暂未提供。

## 把 Bash 步骤指向代理

在你的 Runbook 里加一个 Bash 步骤。表单会问你 **Agent Tag**:

- 填入与你想运行它的代理匹配的标签。
- 在下方编辑器里写脚本。

Runbook 运行到这一步时,Worker 用那个标签把作业加入队列。只要至少有一个带该标签的健康代理在线,作业就会在几秒内被认领并执行。

## 运维提示

### 超时

每个 Bash 步骤有两个超时:

| 超时 | 默认 | 控制什么 |
| --- | --- | --- |
| **认领超时** | 2 分钟 | Worker 等待*某个*代理来认领作业的最长时间。如果没人按时认领,这一步以 `TimedOut` 失败,Runbook 继续(或停止,取决于**失败时继续**)。 |
| **执行超时** | 30 秒 | 代理给脚本运行的最长时间,超过后发送 `SIGKILL`。每步可单独配置。 |

Worker 的总等待窗口是 `认领超时 + 执行超时 + 几秒余量`。挑符合该步骤的数值。

### 租约与心跳

代理认领作业时拿到一个短租约(默认 30 秒)。脚本运行期间,代理每 10 秒续约。如果代理在脚本中途死掉或丢失网络,租约过期,Worker 会把作业标为 `TimedOut`,而不会永远等下去。

脚本的子进程在租约过期时**不会**自动取消 — 但是 Worker 不再等它,而且其他认领接手后,代理就不能再提交结果了。如果你在意 exactly-once,请把脚本设计成可安全重试的。

### 没有在线代理

如果在步骤执行时没有任何带该步骤标签的健康代理在线,作业会保持 `Pending` 直到认领超时到期,然后以明确的消息("no agent claimed the job")失败。Agents 页是你认真运行 Runbook 之前确认覆盖范围的地方。

### 输出上限

每步合计的 stdout + stderr 上限为 **50 KB**。更多的输出会用标记截断。如果你需要完整日志,在脚本里把它写到 S3 或你的日志系统,然后 `echo` 那个 URL。

### 取消

取消 Runbook 执行(从执行视图或 API)会立即把它所有 `Pending`/`Claimed`/`Running` 状态的 Bash 作业标为 `Cancelled`。已经在脚本中途的代理会跑完手头工作,但服务器不会再接受它的结果。

### 并发

每个代理默认一次只跑一个作业。要允许更多,在代理容器上设置 `RUNBOOK_AGENT_CONCURRENCY` — 但记住代理是和这台主机上其他所有东西共用资源的。

## 环境变量

代理启动时读取下列变量:

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | 是 | — | 你的 OneUptime 实例基址,比如 `https://oneuptime.你的域名.com`。 |
| `RUNBOOK_AGENT_ID` | 是 | — | 代理设置弹窗里显示的 UUID。 |
| `RUNBOOK_AGENT_KEY` | 是 | — | 代理设置弹窗里显示的密钥。 |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS` | 否 | `5000` | 代理拉取新作业的频率。 |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS` | 否 | `60000` | 代理上报存活的频率。 |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | 否 | `10000` | 代理为正在运行的作业续租的频率。 |
| `RUNBOOK_AGENT_CONCURRENCY` | 否 | `1` | 该代理上的最大并发作业数。 |

## 轮换代理密钥

如果密钥泄露,在 OneUptime 里打开该代理并重置密钥,旧密钥立即失效。用新密钥更新代理容器并重启。

## 权限

代理管理位于既有的 Runbooks 权限组下:

- `CreateRunbookAgent`、`EditRunbookAgent`、`DeleteRunbookAgent`、`ReadRunbookAgent` — 管理代理记录。
- `RunbookManager`(角色)— 打包上面所有。

*触发* Runbook(并因此派发 Bash 步骤)所需的权限仍是 `CreateRunbookExecution` / `EditRunbookExecution`。

## 面向代理的 API

供好奇的读者参考 — 代理使用挂载在 `/runbook-agent-ingest` 下的这些端点。它们通过 JSON 体里的代理 ID + 密钥(或 `x-agent-id` / `x-agent-key` 请求头)鉴权。

| 端点 | 作用 |
| --- | --- |
| `POST /heartbeat` | 存活;更新 `lastAlive`、`connectionStatus`、`hostInfo`、`agentVersion`。 |
| `POST /claim-next-job` | 原子地认领标签匹配该代理任一标签的最早 `Pending` 作业。无作业时返回 `{ job: null }`。 |
| `POST /job/:jobId/heartbeat` | 为作业续租。租约过期或作业终结后返回 404。 |
| `POST /job/:jobId/result` | 提交最终结果。如果租约已经转给别的认领,则忽略。 |

你不应该需要手动调它们 — 内置代理就在调。这里之所以记录下来,是为了万一我们的代理不适合你的约束,你可以自己造一个。
