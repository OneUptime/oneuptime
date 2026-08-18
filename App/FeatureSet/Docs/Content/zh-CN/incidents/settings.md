# 事件设置与自动化

事件的配置并不位于 Project Settings 中，而是位于事件产品区域本身内部，在 **事件 → 设置** 和 **事件 → 规则** 下，路由以 `/dashboard/{projectId}/incidents/settings/` 开头。如果你一直在 **Project Settings** 中翻找事件模板或自定义字段，这就是你找不到它们的原因。

事件侧边菜单中的 **规则** 和 **设置** 两个部分默认都是折叠的，因此你必须先展开它们，下面列出的各项才会出现。这里的一切都是项目范围的：模板、角色、自定义字段和规则都属于单个项目，并适用于在该项目中声明的每一个事件。

本页是该配置的参考——每个页面包含什么，以及在事件创建那一刻会自动运行哪些内容。

## 事件设置位于何处

在左侧导航中打开 **事件**，然后在侧边菜单底部展开 **设置**。

| 页面                | 你在这里做什么                                              |
| ------------------- | ------------------------------------------------------------ |
| **事件状态**        | 添加、重命名、改颜色并重新排序事件流经的各个状态。            |
| **事件严重性**      | 添加、重命名、改颜色并重新排序严重性级别。                    |
| **事件模板**        | 预填一整个事件——标题、描述、资源、值班策略、所有者、标签。   |
| **备注模板**        | 用于公开备注和私密备注的可复用文本。                          |
| **事后分析模板**    | 可复用的事后分析结构。                                        |
| **自定义字段**      | 定义出现在每个事件上的额外字段。                              |
| **事件角色**        | 定义你为响应者分配的角色，比如 Incident Commander。            |
| **More Settings**   | 事件编号和事件片段编号的前缀。                                |

**事件状态** 和 **事件严重性** 在 [事件状态与严重级别](/docs/incidents/states-and-severities) 中有详细介绍——本页的其余部分从 **事件模板** 开始讲起。

展开 **规则** 后你会看到另外八个页面：**Grouping Rules**、**On-Call Rules**、**Owner Rules**、**Runbook Rules**、**Privacy Rules**、**Label Rules**、**SLA Rules** 和 **Reminder Rules**。这些将在下文进一步介绍。

## 事件模板

事件模板是一个已保存的事件骨架。与其在每次支付集群出问题时重新输入同样的标题、同样的监视器列表和同样的值班策略，你可以把它保存一次，然后从中声明事件。

前往 **事件 → 设置 → 事件模板**（`/dashboard/{projectId}/incidents/settings/templates`）。卡片标题为 **事件模板**。创建一个模板会引导你完成一个六步向导：

- **模板信息** —— **模板名称** 和 **模板描述**。这些是模板自身的名称；它们永远不会出现在事件上。
- **Incident Details** —— **Title**、**Description**（Markdown）、**事件严重性** 和 **Initial Incident State**。**Initial Incident State** 是可选的，默认为空；其选项按状态顺序列出。留空，则从该模板创建的事件会落入项目的创建状态。
- **Resources Affected** —— 该事件应附加的监视器、主机、集群和服务，外加 **Change Monitor Status to**。
- **On-Call** —— **On-Call Policy**，即从该模板创建的事件被声明时要执行的策略。
- **Owners** —— **Owner - Teams** 和 **Owner - Users**。
- **Labels** —— **Labels**。

几条简单规则：

- 模板列表只显示 **Name** 和 **Description**。这些行不能在列表中直接编辑或删除——打开一个模板（`/dashboard/{projectId}/incidents/settings/templates/{modelId}`）来修改它。
- 模板支持 JSON 导入和导出，因此你可以把一个模板从一个项目搬到另一个项目。
- 空状态显示 "No incident templates found."

### 模板是如何被应用的

有两条路径，它们的行为相同。

- **从仪表板** —— 事件列表上的 **从模板创建** 按钮会打开一个 **Select Incident Template** 选择器，声明页面会从 `incidentTemplateId` 查询字符串参数中读取模板，然后用该模板及其所有者团队和所有者用户预填表单。
- **从 API** —— 在 `POST /api/incident` 上传入 `createdIncidentTemplateId`，服务器就会用模板中的内容填充该事件。

关键部分在于合并规则：**模板只会填充你留空未定义的字段**。标题、描述、事件严重性、初始事件状态、**Change Monitor Status to** 背后的监视器状态、监视器、主机、Kubernetes 集群、Docker 主机、Podman 主机、服务、值班策略和标签，只有在调用方或表单未提供任何内容时才会从模板中复制过来。任何你显式设置的内容永远优先。

**空状态对话框指向了错误的位置。** 如果你还没有任何模板，**从模板创建** 按钮会显示一个 **No Incident Templates** 对话框。它的文字指向 Project Settings，但按钮实际会跳转到 **事件 → 设置 → 事件模板**——那才是真正的位置。

## 备注模板

备注模板为响应者提供了用于事件更新的现成文案，这样凌晨三点的状态页更新就不需要由一个睡眼惺忪的人从头开始写。

前往 **事件 → 设置 → 备注模板**（`/dashboard/{projectId}/incidents/settings/note-templates`）。卡片标题为 **Public or Private Note Templates for Incidents**——一个库同时服务两种备注类型。创建表单有两个步骤：

- **模板信息** —— **模板名称** 和 **模板描述**，均为必填。
- **备注详情** —— 备注正文本身，使用 Markdown，必填。

与事件模板一样，这些行是创建和查看的，而不是内联编辑的；打开一个模板来修改它。

备注模板会出现在你真正需要它们的地方：**Acknowledge Incident** 和 **Resolve Incident** 确认对话框都在 **Public Note** 字段旁提供了 **选择备注模板**。公开备注和私密备注的区别请参见 [事件备注、负责人与动态](/docs/incidents/notes-owners-and-feed)。

## 事后分析模板

事后分析模板是你在事件之后撰写的报告的骨架——你的标题结构、你的提示语、你的常设问题——因此项目中的每一次复盘都遵循同样的形式。

前往 **事件 → 设置 → 事后分析模板**（`/dashboard/{projectId}/incidents/settings/postmortem-templates`）。卡片标题为 **事后分析模板**。创建表单有两个步骤：

- **模板信息** —— **模板名称** 和 **模板描述**，均为必填。
- **Postmortem Details** —— **Postmortem Template**，正文本身，使用 Markdown，必填。

你从事件中应用模板，而不是从设置中。打开一个事件，在其侧边菜单中选择 **Postmortem**（`/dashboard/{projectId}/incidents/{incidentId}/postmortem`），然后使用 **Apply Template**。这会打开一个 **Apply Postmortem Template** 对话框，里面有一个 **Select Template** 下拉框；选择一个会把模板正文加载到 **Postmortem Note** 编辑器中，你可以在保存前编辑它。事件片段拥有同样的 **Postmortem** 页面，并使用同一个模板库。

## 自定义字段

自定义字段让你可以在每个事件上携带自己的元数据——一个内部服务名称、一个变更工单引用、一个客户等级。

前往 **事件 → 设置 → 自定义字段**（`/dashboard/{projectId}/incidents/settings/custom-fields`）。该页面标题为 **Incident Custom Fields**。每个定义包含：

- **Field Name** —— 必填，至少两个字符。占位符建议一个类似 slug 的名称，比如 `internal-service`。
- **Field Description** —— 可选。
- **Field Type** —— 必填。它决定数据的输入方式。下拉类型还需要列出其选项。
- **Dropdown Options** —— 下拉框中出现的值，每个都可以带一个可选颜色。

定义存在于它们自己的模型中；值则存在于事件本身的 `customFields` 列中。在单个事件上，你可以在事件侧边菜单中的 **Custom Fields**（`/dashboard/{projectId}/incidents/{incidentId}/custom-fields`）填写它们。

**一个值得了解的缺口。** 事件自定义字段定义是整个事件家族中唯一没有工作流触发器的部分——见下方的工作流小节。

## 事件角色

事件角色是你在响应期间分配给人们的具名职责。请在 **事件 → 设置 → 事件角色**（`/dashboard/{projectId}/incidents/settings/roles`）定义它们；卡片描述以 Incident Commander 和 Responder 作为示例。

角色仅仅是定义。你会按每个事件把人分配到这些角色上——声明向导有一个 **Incident Roles** 步骤，带有一个 **Assign Incident Roles** 字段，并且每个事件的侧边菜单中都有一个 **角色** 页面。

## 编号前缀

每个事件都会得到一个编号。默认情况下它渲染为 `#42`。如果你的团队口头上说 "INC-42"，那就让产品也这样显示。

前往 **事件 → 设置 → More Settings**（`/dashboard/{projectId}/incidents/settings/more`）。卡片是 **Number Prefix**，包含项目上的两个字段：

- **Incident Number Prefix** —— 最多 20 个字符，占位符为 `INC-`。设置它，事件 `#42` 就会显示为 `INC-42`。
- **Incident Episode Number Prefix** —— 对事件片段编号采用同样的思路，占位符为 `IE-`。

任一字段留空则保留默认的 `#` 前缀；未设置的字段会显示 `# (default)`。点击 **更新** 保存。带前缀的值以 `incidentNumberWithPrefix` 的形式存储在事件上，这正是事件列表和事件头部所渲染的内容。

## 事件创建时运行的规则

**事件 → 规则** 包含八个规则引擎。它们做的都是同一件事——在事件刚被创建的那一刻查看它，如果匹配就采取行动——但它们在具体做什么以及多条匹配规则如何解决上有所不同。

- **Grouping Rules** —— 把相关事件分组成事件片段。规则按优先级顺序评估；优先级数字越低越先执行。
- **On-Call Rules** —— 为匹配的事件执行值班策略。下文有详细介绍。
- **Owner Rules** —— 自动指定所有者。
- **Runbook Rules** —— 在事件匹配时启动一个 [runbook](/docs/runbooks/index)。
- **Privacy Rules** —— 决定匹配的事件是否为私密事件。
- **Label Rules** —— 自动应用标签。
- **SLA Rules** —— 跟踪响应和解决时间。规则按顺序评估；顺序数字越低越先执行。
- **Reminder Rules** —— 在事件仍处于开启状态时定期提醒事件所有者。规则按顺序评估，第一条匹配的规则生效。

**顺序语义并不统一。** Grouping Rules、SLA Rules 和 Reminder Rules 是按顺序评估的。On-Call Rules 不是——每条匹配的规则都会触发。不要假设一种模型适用于全部八种规则。

**On-Call Rules**、**Owner Rules**、**Label Rules** 和 **Privacy Rules** 页面是分标签页的——一个 **Incident Rules** 标签页和一个 **Episode Rules** 标签页，各自拥有自己的表格。除非你确实想针对事件片段，否则请配置 **Incident Rules** 标签页。**Grouping Rules**、**Runbook Rules**、**SLA Rules** 和 **Reminder Rules** 则是单个表格。

## 事件值班规则

**事件 → 规则 → On-Call Rules**（`/dashboard/{projectId}/incidents/settings/on-call-rules`）是你让寻呼自动化的地方。卡片 **Incident On-Call Rules** 描述了这些规则会在匹配的事件被创建时自动执行值班策略。该页面有两个标签页：**Incident Rules** 和 **Episode Rules**。

创建表单有三个步骤：

- **基本信息** —— **Name**（占位符建议类似"为任何数据库事件寻呼数据库团队"这样的内容）、**Description**，以及一个 **已启用** 开关。列表会为每条规则渲染一个绿色的 **已启用** 或红色的 **已禁用** 徽标。
- **匹配条件** —— **Monitors**、**Incident Severities**、**Incident Labels**、**Monitor Labels**，外加针对事件标题、事件描述、监视器名称和监视器描述的大小写不敏感正则表达式字段。
- **On-Call Policies** —— 该规则要执行的策略。

### 匹配是如何解决的

该页面自带的这些规则值得牢记：

- 只有当你填写的**所有**条件都通过时，规则才算匹配。你留空的条件会被跳过，而不是判定失败。
- 在单个列表条件内——**Monitors**、**Incident Severities**、**Incident Labels**、**Monitor Labels**——匹配是任一命中即可。
- 模式字段是大小写不敏感的正则表达式。
- **所有匹配的规则都会触发。** 没有优先级，也没有短路。
- 实际执行的策略集合，是每条匹配规则的策略、加上手动或通过模板附加到该事件上的任何策略的并集，并做了去重，因此每个策略最多只会运行一次。

严重性在这里是一个匹配条件，除此之外别无他处。事件严重性上没有值班字段——选择 "Critical Incident" 本身并不会寻呼任何人。如果你希望严重性驱动寻呼，请编写一条以它为匹配条件的值班规则。

## 直接附加值班策略

规则并不是唯一的途径。每个事件都自带一个值班策略列表，体现为声明向导 **On-Call** 步骤上的 **On-Call Policy** 字段，以及事件模板 **On-Call** 步骤上的同一字段。字段说明写得很直白：这些是该事件被创建时要执行的值班策略。

当一个事件被创建时，OneUptime 会先运行标签规则，再运行值班规则（它们会把匹配到的策略合并进事件的列表），然后运行 runbook 规则——如果最终列表非空，其中的每个策略都会被执行。执行是并行进行、独立结算的，因此一个策略失败不会阻止其他策略。每次执行都会标记上触发它的事件，以及"事件已创建"通知事件类型。

要查看发生了什么，请打开该事件，在其侧边菜单中选择 **On-Call Executions**（`/dashboard/{projectId}/incidents/{incidentId}/on-call-policy-execution-logs`）。

## 通过工作流驱动事件

事件的工作流触发器不是手写的——OneUptime 会从数据模型中生成它们，因此事件家族的每一个模型都会得到以其单数名称命名的 **On Create X**、**On Update X** 和 **On Delete X** 组件。最主要的三个是 **On Create Incident**、**On Update Incident** 和 **On Delete Incident**，它们位于 `/dashboard/{projectId}/workflows` 上工作流组件面板的 **Incident** 分类中。

同一套生成机制也为配置本身提供了触发器：**On Create Incident State**、**On Update Incident Severity**、**On Create Incident Template**、**On Create Incident Note Template**、**On Create Incident State Timeline**、**On Create Incident Public Note**、**On Create Incident Internal Note**、**On Create Incident On-Call Rule**、**On Create Incident Role**、**On Create Incident Member** 等等。每个模型也会得到相应的动作组件——**Find One Incident**、**Create One Incident**、**Update One Incident**、**Delete One Incident** 以及它们各自的多行版本——因此名称相近的触发器和动作会并列出现在同一个分类中。**On Create Incident** 启动一个工作流；**Create One Incident** 则会创建一个事件。

接入这些组件时有几个细节需要注意：

- **On Update X** 带有一个可选的 **Listen on** 参数，用于把触发器限定到涉及特定字段的更新上。留空则任何变更都会触发。如果一次更新到达时没有携带哪些字段发生了变化的记录，该过滤器会被跳过，工作流照常运行。
- **On Create X** 和 **On Update X** 都带有一个必填的 **Select Fields** 参数；**On Delete X** 不带任何参数。
- 三者都只暴露一个 **Success** 输出端口，并且各自都接受一个 ID 参数，因此你可以手动针对某一条记录运行该工作流。
- 名称来自模型的单数名称，而不是它的表名——这就是为什么你会看到 **On Create Incident Team Owner** 和 **On Create Incident User Owner**，而不是按表名生成的名称。
- 事件自定义字段定义没有触发器。该模型是事件家族中唯一被禁用了工作流的成员。

关于如何搭建工作流的其余部分，请参见 [创建工作流](/docs/workflows/authoring) 和 [工作流变量](/docs/workflows/variables)。

## 接下来读什么

- [事件概览](/docs/incidents/index) —— 事件功能是如何整体拼接在一起的。
- [声明事件](/docs/incidents/declaring-incidents) —— 声明向导、模板以及 API。
- [事件状态与严重级别](/docs/incidents/states-and-severities) —— 状态和严重性设置页面，以及各个标志的作用。
- [事件备注、负责人与动态](/docs/incidents/notes-owners-and-feed) —— 备注模板的使用场景。
- [订阅者与公告](/docs/status-pages/subscribers) —— 事件之外，谁会听到关于事件的消息。
- [工作流概览](/docs/workflows/index) —— 在事件触发器之上进行自动化。
- [Runbook 概览](/docs/runbooks/index) —— runbook 规则所附加的流程。
