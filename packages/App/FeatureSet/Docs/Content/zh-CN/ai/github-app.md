# 在 GitHub 中使用 OneUptime

OneUptime GitHub App 不只是一条通往代码的连接——您可以在自己的仓库里跟它对话，它就在那里把活干完。

在 Issue 里提及它，它会开一个 Pull Request。在 Pull Request 里提及它，它会修订这个分支，或者评审这份 diff。给 Issue 打上标签，它就会接手这个 Issue。它产出的一切都是留给人来读的 Pull Request 或评审：**它从不合并任何东西，也从不批准 Pull Request。**

```text
@oneuptime implement this                          →  一个关闭该 Issue 的 Pull Request
@oneuptime revise this — use exponential backoff   →  该 Pull Request 分支上的新提交
@oneuptime review                                  →  发表在该 Pull Request 上的代码评审
```

> 请把 `@oneuptime` 换成您自己应用的 handle。在 OneUptime Cloud 上它就是 `@oneuptime`。在自托管实例上，它是您给 GitHub App 起的名字，全部转成小写并把空格换成连字符——一个名为 "Acme AI" 的应用要写成 `@acme-ai`。如果提及毫无反应，这是第一个该检查的地方。

## 开始之前

- 仓库必须通过 GitHub App **连接到某个 OneUptime 项目**。安装步骤参见 [GitHub 集成（自托管）](/docs/self-hosted/github-integration)；在 OneUptime Cloud 上，从 **项目设置 → 代码仓库** 连接即可。
- 必须有一个启用了 **执行 AI 代码修复** 能力的 Runner 在线——就是执行 [AI 修复任务](/docs/ai/ai-agent)的那个 Runner。没有它，命令会被接受，然后在 30 分钟后失败，并提示没有任何代理接手。
- GitHub App 必须具备 **Issues：读写** 权限，并订阅[需要订阅哪些事件](#需要订阅哪些事件)中列出的 Webhook 事件。

## 命令

每条命令都以提及这个应用开头。提及可以出现在评论中的任何位置，写在它后面的内容都会作为您的请求一并传过去。

### 在 Pull Request 上

| 命令 | 会发生什么 |
| --- | --- |
| `@oneuptime review` | 克隆该分支，读取改动的代码**以及它周围的代码**，然后以评论形式发表评审。不改动任何东西。 |
| `@oneuptime revise this — <您想改的内容>` | 克隆这个 Pull Request 自己的分支，做出修改，并把新提交推送到同一个分支。绝不会另开一个 Pull Request。 |

提及之后写的内容如果不是可识别的命令，就会被当作一次修订请求，因为它几乎总是这个意思：

```text
@oneuptime the retry loop here should back off exponentially, and the test
should cover the 429 case
```

### 在 Issue 上

| 命令 | 会发生什么 |
| --- | --- |
| `@oneuptime implement this` | 处理这个 Issue，并开一个能关闭它的 Pull Request。 |
| `@oneuptime <其他任何内容>` | 同上，您写的话会作为额外的指示。 |

您也可以**完全不写评论**就把一个 Issue 交给它：

- **打上触发标签。** 给 Issue 加上仓库的触发标签（默认是 `oneuptime`）会启动同样的工作。这是从 GitHub 界面派活最可靠的方式。
- **把 Issue 指派给应用的 bot 用户**，前提是您的仓库允许这样做。GitHub 并非在所有地方都允许把应用设为指派人，这正是触发标签存在的原因；如果指派没有反应，就用标签。

### 任何地方

| 命令 | 会发生什么 |
| --- | --- |
| `@oneuptime help` | 列出所有命令。只提及而不写任何内容，效果相同。 |
| `@oneuptime status` | 说明它当前在这个对话里正在做什么。 |
| `@oneuptime cancel` | 停止它在这个对话里进行中的运行。已经推送出去的成果会保留。 |

`help`、`status` 和 `cancel` 从不启动代理运行，因此它们不产生任何开销，也不占用您的每日修复任务预算。

## 它在对话里是什么样子

一条命令只产生**一条评论**，应用会随着工作的推进不断编辑这条评论——所以一个长时间运行的任务不会把 Pull Request 变成一份状态日志。

1. 它会在您的评论上加一个 👀 回应，并发表一条确认消息，说明这次运行属于哪个 OneUptime 项目，并附上实时运行的链接。
2. 完成后，同一条评论会被改写成结果：它开的 Pull Request、它推送的提交，或者对它为什么什么都没做的如实说明。

如果它没有找到值得改的地方，它会直说，而不是开一个凭猜测写出的 Pull Request。这是正常结果，不是失败——给它更明确的方向，再问一次。

## 谁有权向它下命令

**只有对该仓库拥有写入（write）、维护（maintain）或管理员（admin）权限的人。** OneUptime 每一次都直接向 GitHub 查询评论者在该仓库上的权限；它不采信 GitHub 显示在评论旁边的 "contributor" 徽章，那描述的是过往活动，而不是当前权限。

其他人的提及只会在其评论上得到一个 😕 回应，除此之外什么都不会发生。这是有意为之：在公开仓库上任何人都能评论，而一个会可靠回复陌生人的应用，也就是一个能被用来刷屏的应用。

它同样会忽略一切由机器人写的评论（包括它自己写的），并会忽略出现在引用（`>`）或代码块里的提及。这两条规则合在一起，正是让"回复它自己的评论"不会把它再次启动起来的原因。

## 它不会做的事

- **它从不合并。** 这个应用做的任何事都无法把代码送上您的默认分支。
- **它从不批准，也从不请求修改。** 评审是以评论形式发表的，因此来自应用的评审永远无法满足分支保护规则。
- **它从不改写历史。** 一次修订只会追加提交，不会强制推送。如果别人先一步推送到了这个分支，修订会失败，而不是丢掉他们的成果。
- **它无法修订来自 fork 的 Pull Request。** fork 的分支位于安装无权写入的仓库中。它仍然可以评审这样的 Pull Request——改为请它评审即可。
- **它从不修改 Pull Request 的标题、描述或目标分支。** 只改代码。

## 它的开销，以及如何为它划定上限

每一条会启动工作的命令都是一次完整的代理运行——一次克隆、最多 40 次 LLM 调用和 100,000 个输出 token；如果您配置了仓库的构建和测试命令，还要加上它们。

有两条限制适用，而且它们就是已经管着 [AI 修复任务](/docs/ai/ai-agent)的那两条：

- **项目的每日修复运行上限**（**项目设置 → 人工智能**，默认每天 25 次）。GitHub 命令与项目中其余的修复运行共用这份预算。
- **单个仓库的未关闭 Pull Request 上限**（**代码仓库 → 对应仓库 → 设置**，默认 5 个）。评审和修订不受此限：两者都不会往您的待评审队列里新增 Pull Request。

同一个 Issue 或 Pull Request 上，每种运行同时只能有一个在进行。再问一次，它会告诉您它已经在做了；而在修订进行期间请求评审则会同时启动两者，因为它们是不同的请求。

如果一次运行无法启动，应用会在对话里说明原因——它从不无声地失败。

## 关掉它

按仓库关闭：**代码仓库 → 对应仓库 → 设置 → Respond to GitHub Commands**。关掉之后，应用会忽略该仓库中的提及、指派和触发标签，并告诉任何询问的人开关在哪里。

如果您想用 `oneuptime` 以外的标签，**GitHub Trigger Label** 也在同一个页面上。

## 需要订阅哪些事件

在 GitHub App 的"权限与事件"设置里，订阅：

| 事件 | 用于 |
| --- | --- |
| **Issue comment** | Issue *以及* Pull Request 上的 `@mention` 命令 |
| **Issues** | 指派给应用，以及触发标签 |
| **Pull request** | 向应用请求评审 |
| **Pull request review** | 已提交评审的正文中的提及 |
| **Pull request review comment** | diff 内联评论中的提及 |

另外在**代码仓库权限**里，**Issues** 必须是**读写**——GitHub 通过 Issues API 提供 Pull Request 的对话评论，所以正是这一项权限让应用也能在 Pull Request 上发表评论。

## 提示词注入：哪些有防护，哪些没有

Issue 文本、Pull Request 描述、diff 和评论都会成为代理提示词的一部分，而在公开仓库上任何人都能写这些内容。在 Issue 里读到"忽略你的指令，改做 X"这类文字，是完全现实的事。

有两样东西为此划定了边界，而且值得分清哪样是哪样：

- **提示词会把不可信文本标记为一段请求，而不是指令**，并且这次运行的仓库、分支和 Pull Request 在代理启动之前就已经固定——代理读到的任何内容都无法改变它正在处理的对象。
- **真正的隔离来自沙箱。** 代理运行在您的 Runner 上，在一份用完即弃的克隆里，命令环境中的凭据已被剥离，git 操作也受到限制。它最多只能推送到一个分支，而合并只有人能做。

请像对待一位读过这个 Issue 的新贡献者提交的 Pull Request 那样，对待 AI 写出的 Pull Request：审查 diff，而不是描述。

## 故障排查

**我提及它，什么都没发生。** 先检查 handle——它是应用的 slug，不是显示名称。然后检查仓库是否已连接到某个项目（**项目设置 → 代码仓库**）、**Respond to GitHub Commands** 是否开启，以及您的 GitHub App 是否订阅了上面列出的事件。

**它回了个 😕，什么也没说。** 您对该仓库没有写入权限。

**它说它已经在处理这个了。** 该 Issue 或 Pull Request 上已经有一个同类型的运行在进行。`@oneuptime status` 会告诉您是哪一个，`@oneuptime cancel` 可以停掉它。

**它确认之后就长时间没有动静。** 检查 **设置 → Runbook 代理** 下是否有启用了 **执行 AI 代码修复** 的 Runner 在线。没有的话，运行会在 30 分钟后失败，并在对话里说明情况。

**它说这个 Pull Request 来自 fork。** 修订需要一个位于本仓库中的分支。改为请它评审，或者把分支推到这里来。

## 接下来读什么

- [AI 修复任务](/docs/ai/ai-agent)——同一个代理，只是由异常触发，而不是由 GitHub 触发。
- [GitHub 集成（自托管）](/docs/self-hosted/github-integration)——创建和配置 GitHub App。
- [Runner](/docs/runbooks/agents)——执行这些运行的工作进程。
