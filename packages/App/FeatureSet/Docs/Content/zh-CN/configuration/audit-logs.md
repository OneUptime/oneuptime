# 审计日志

审计日志记录谁在你的项目中更改了什么：它所覆盖资源的每一次创建、更改和删除，以及更改前后的值。用它查明谁关闭了某个监视器或更改了某个 API 密钥，并为合规审查保留记录。在 OneUptime Cloud 上它属于 Enterprise 套餐，自托管时属于 Enterprise Edition。

:::cards
- [开启审计日志](#开启审计日志): 所有项目默认关闭。
- [阅读审计日志](#阅读审计日志): 谁在何时更改了什么。
- [记录哪些内容](#记录哪些内容): 它覆盖的资源和操作。
- [条目保留多久](#条目保留多久): 7 到 180 天。
:::

## 更改如何成为条目

```mermaid title="更改是否被记录"
flowchart TB
    change["资源被创建、<br/>更改或删除"] --> covered{"审计日志覆盖的<br/>资源?"}
    covered -->|"否"| skipped["不记录"]
    covered -->|"是"| eligible{"Enterprise 套餐或<br/>Enterprise 许可证?"}
    eligible -->|"否"| skipped
    eligible -->|"是"| enabled{"审计日志<br/>已开启?"}
    enabled -->|"否"| skipped
    enabled -->|"是"| entry["一条条目: 谁、什么、<br/>何时以及更改内容"]
    entry --> expired["保留期到期后<br/>删除"]
```

- **默认关闭。** 在有人开启审计日志之前，项目不会记录任何内容，也不会记录开启之前发生的事。
- **记录人们所做的事。** 由人员、API 密钥、MCP 客户端或工作流做出的更改会被记录。OneUptime 自身做出的更改（例如来自后台任务的更改）不会被记录，除非你打开**存储系统事件**。
- **条目无法更改。** 任何人都无法在仪表板中或通过 API 编辑或删除条目。条目只有在保留期到期时才会消失。

## 开始之前

- **在 OneUptime Cloud 上：Enterprise 套餐。** 在其他套餐上，审计日志页面会显示该功能的作用以及如何获得。
- **自托管时：Enterprise Edition**，以及包含审计日志的许可证。参见[企业版](/docs/self-hosted/enterprise)。
- **可以读取审计日志的角色。** Project Owner、Project Admin、Settings Admin 或 **Read Audit Log** 权限。开启审计日志和更改其设置需要 Project Owner、Project Admin 或编辑项目的权限。

## 开启审计日志

:::steps
### 打开审计日志设置

前往**项目设置 → 审计日志 → 设置**。**审计日志**在侧边菜单中默认折叠：点击它即可展开。

### 编辑设置

点击 **Edit Audit Log Settings**。

### 开启

打开**启用审计日志**，设置**保留时长（天）**，并选择是否**存储系统事件**。点击**保存更改**。
:::

| 设置 | 初始值 | 作用 |
| --- | --- | --- |
| **启用审计日志** | 关闭 | 从现在起记录项目资源的更改。 |
| **保留时长（天）** | 7 | 每个条目保留的天数：7 到 180。 |
| **存储系统事件** | 关闭 | 同时记录 OneUptime 自身做出的、不是由人员或密钥发起的更改。 |

对这些设置的更改会在一分钟内生效。

## 阅读审计日志

**项目设置 → 审计日志 → 审计日志**列出项目中的每个条目，最新的在前：

| 列 | 显示内容 |
| --- | --- |
| **何时** | 多久以前，附带日期和时间。 |
| **操作** | `Create`、`Update` 或 `Delete`，或者对于有人下载的抓包文件为 `Download`。 |
| **资源** | 资源名称（资源存在时可点击打开）及其类型。 |
| **执行者** | 做出更改的主体：人员、API 密钥、工作流，或对于 OneUptime 自身做出的更改为 `System`。人员通过 MCP 客户端做出的更改会注明是哪个客户端。 |
| **更改** | 更改了多少个字段，或在创建或删除时记录了多少个字段。点击可查看每个字段。 |

按**资源类型**、**资源名称**、**操作**、**用户电子邮件**或**时间**筛选。更改只显示被更改的字段及其前后值，未做任何更改的保存不会添加条目。

监视器、事件、警报、状态页面、SLO 以及许多其他资源，在其侧边菜单的折叠部分（如**高级**）中也有自己的**审计日志**页面。它只显示该资源的条目，以及属于它的内容的条目：SLO 的页面还会显示其规则和所有者。

## 记录哪些内容

| 资源 | 日志中的**资源类型** |
| --- | --- |
| 监视器 | `Monitor` |
| 事件 | `Incident` |
| 警报 | `Alert` |
| 状态页面 | `Status Page` |
| 计划维护事件 | `Scheduled Maintenance Event` |
| 值班策略 | `On-Call Policy` |
| 服务级别目标（SLO） | `Service Level Objective` |
| SLO 的规则和所有者 | `SLO Burn Rate Rule`、`SLO Monitor Rule`、`Service Level Objective User Owner`、`Service Level Objective Team Owner` |
| 团队 | `Team` |
| 自定义角色，以及获得角色的团队和 API 密钥 | `Custom Role`、`Team Custom Role`、`API Key Custom Role` |
| 标签 | `Label` |
| 事件状态和严重性 | `Incident State`、`Incident Severity` |
| 警报状态和严重性 | `Alert State`、`Alert Severity` |
| 监视器状态 | `Monitor Status` |
| 计划维护状态 | `Scheduled Maintenance State` |
| 事件角色 | `Incident Role` |
| 事后分析状态 | `Postmortem Status` |
| API 密钥 | `API Key` |
| 人们连接的 MCP 客户端 | `MCP Client Authorization` |
| 资产清单项 | `Inventory Item` |
| 收集器配置 | `Collector Config` |
| vCenter 服务器 | `vCenter` |
| 抓包及其下载 | `Packet Capture` |
| 安全案例、剧本及其运行，以及受保护的实体 | `Security Case`、`Security Playbook`、`Security Playbook Run`、`Protected Entity` |

当管理员在他人的账户上添加或移除通知方式或个人值班规则时，也会记录，但不包含地址或号码本身。

其他数据不在审计日志中，例如谁在某个团队中，或单独添加给团队的权限。任何人都无权读取的字段（例如密钥）会从所有条目中省略。

## 条目保留多久

每个条目的保留时间，是其被记录时项目所设的**保留时长（天）**，之后会被删除。新的保留时长适用于新条目：已记录的条目保持原有日期。

要将条目保留超过 180 天，请使用拥有 **Read Audit Log** 的 API 密钥通过 API 读取它们，并存储到你需要的地方。参见[OneUptime API 参考](/docs/api-reference/api-reference)。

## 当套餐或许可证不再包含审计日志时

- **在 OneUptime Cloud 上**，离开 Enterprise 套餐的项目会停止记录，其审计日志页面会显示升级卡片，直到重新回到该套餐。
- **自托管时**，如果 Enterprise 试用期或宽限期结束时没有许可证，或者许可证不包含审计日志，审计日志就会停止记录。审计日志会以红色显示这一点。已记录的条目会保留，一旦激活许可证，就会以相同的设置恢复记录。参见[许可证过期或缺失时](/docs/self-hosted/enterprise#许可证过期或缺失时)。

## 故障排除

:::details 审计日志为空
审计日志默认关闭，不会记录开启之前的任何内容。如果列表提示审计日志已关闭，请按其链接前往设置并开启。否则，更改一个监视器或事件，然后刷新列表。
:::

:::details 审计日志中缺少某项更改
检查该资源是否列在[记录哪些内容](#记录哪些内容)中，以及更改是否发生在开启审计日志之后。OneUptime 自身做出的更改只有在打开**存储系统事件**时才会被记录。
:::

## 后续步骤

:::cards
- [用户、团队与权限](/docs/permissions/index): 决定谁可以读取审计日志。
- [项目设置](/docs/configuration/project-settings): 项目的其他设置。
- [账单与用量](/docs/configuration/billing): 更改项目的套餐。
- [企业版](/docs/self-hosted/enterprise): 自托管安装中的审计日志。
:::
