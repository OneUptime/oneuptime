# 状态页面概览

状态页是您所监控一切的公开门面：一个 URL，客户打开它就能知道情况，而不必发邮件问您是不是只有他们遇到了问题。它显示您选择公开的服务的当前状态、您正在处理的事件、您计划的维护，以及您想置顶的任何公告。

当凌晨两点出现故障时，状态页是您的支持队列首先链接过去的地方。它也是您的订阅者收到通知的来源——所以值得在需要之前就设置好，而不是等到故障发生时再手忙脚乱。

状态页位于仪表板左侧导航的 **essentials** 分组下的 **Status Pages** 中。此页面上的一切都是按状态页配置的：一个项目可以运行任意多个状态页——面向客户的公开状态页、面向内部受众的私密状态页、针对特定市场的按区域状态页。

## 一览

- **只需两个字段即可创建。** 新建状态页只需要 **Name** 和 **Description**。资源、品牌和域名都是之后配置的。
- **资源就是访客所看到的内容。** 页面上的每一行都是一个 **Status Page Resource**——一个监视器（或监视器组），拥有自己的显示名称、工具提示和正常运行时间选项。分组把一个长页面拆分成若干区块，并且可以嵌套。
- **从第一天起就有预览 URL。** 每个状态页都会获得一个预览链接，让您在自定义域名存在之前就能查看它。
- **面向访客的路由由设置控制开关。** 事件、公告、计划事件和订阅页面，只有在 **Advanced Settings** 中对应的开关打开时才会出现。
- **三种方式让页面变为私密。** 私人用户、主密码，或 SAML SSO / OIDC——再加上 IP 白名单。
- **订阅者会被自动告知。** 电子邮件、短信、Slack、Microsoft Teams 和 Webhook 订阅者都可以关注一个页面，每个渠道都有各自的开关。

## 关键术语

| 术语              | 含义                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Status page**   | 一个公开（或私密）的页面，拥有自己的品牌、域名、资源和订阅者。对应 `StatusPage` 模型。                    |
| **Resource**      | 访客看到的一行——在页面上呈现的监视器或监视器组，带有显示名称和正常运行时间选项。                      |
| **Group**         | 一个容纳资源的命名区块。分组可以嵌套在其他分组之中，每一层都会汇总其下所有内容的状态。 |
| **Announcement**  | 您发布到一个或多个状态页的消息，带有开始时间和可选的结束时间。                                         |
| **Subscriber**    | 通过电子邮件、短信、Slack、Microsoft Teams 或 Webhook 关注该页面的人（或系统）。                                                  |
| **Custom domain** | 您自己的域名——如 `status.example.com`——通过 CNAME 和 SSL 证书指向该页面。                                 |
| **Private user**  | 可以登录私密状态页的账户。与您的 OneUptime 项目用户是分开的。                                    |

## 创建状态页

1. 打开 **Status Pages → All Status Pages**，点击 **Create Status Page**。
2. 在 **Create New Status Page** 弹窗中，填写 **Name**（必填，至少两个字符），以及可选的 **Description**。
3. 点击 **Create Status Page**。

创建表单就是这些。您返回后看到的列表显示 **Name**、**Description**、**Labels** 和 **Owners**，并可按 **Status Page ID**、**Name** 和 **Description** 进行筛选。

打开新页面后，您会进入其 **Overview** 界面，其中包含两张卡片：**Status Page Preview URL**，带有指向页面本身的链接；以及 **Status Page Details**，您可以在此编辑刚才设置的名称、描述和标签。

接下来，按大致有用程度排序：

- 添加资源，让页面上有内容——参见 [状态页资源与分组](/docs/status-pages/resources-and-groups)。
- 设置页面标题、favicon、logo 和封面，然后绑定自定义域名——参见 [状态页品牌与域名](/docs/status-pages/branding-and-domains)。
- 决定人们可以通过哪些渠道订阅——参见 [订阅者与公告](/docs/status-pages/subscribers)。
- 在 **Advanced Settings** 中调整页面上显示的内容。

## 各功能所在的位置

打开一个状态页后，它自己的左侧菜单被分为九个部分。可以把这一节当作本文档组其余内容的地图。

| 部分               | 包含内容                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Basic**             | **Overview**、**Announcements**、**Owners**。                                                                                                   |
| **Resources**         | 单一的 **Resources** 界面——左侧是分组，右侧是所选分组下的监视器。                                                |
| **Subscribers**       | **Email Subscribers**、**SMS Subscribers**、**Slack Subscribers**、**MS Teams Subscribers**、**Webhook Subscribers**、**Subscriber Settings**。 |
| **Notification Logs** | **Notification Logs**——发送给订阅者的内容记录。                                                                                          |
| **Audit**             | **Audit Logs**。                                                                                                                                |
| **Branding**          | **Essential Branding**、**HTML, CSS & JavaScript**、**Custom Domains**、**Header**、**Footer**、**Overview Page**、**Languages**。              |
| **Security**          | **Private Users**、**SSO**、**OIDC**、**SCIM**、**Authentication Settings**。                                                                   |
| **AI**                | **MCP**。                                                                                                                                       |
| **Advanced**          | **Monitor Rules**、**Embedded Status**、**Reports**、**Custom Fields**、**Advanced Settings**、**Delete Status Page**。                         |

在开始查找之前，有两个命名上的小细节值得了解：

- **Resources** 这一项只有在项目启用了监视器组时才叫 **Resources**。否则它显示为 **Monitors**。两种情况下都是同一个界面。
- 没有单独的分组页面。分组和资源已合并，旧的 `/groups` 路由现在会重定向到资源界面。

在单个页面之外，**Status Pages** 部分本身有一个 **More** 分区，包含 **Announcements**；还有一个折叠的 **Settings** 分区，包含 **Announcement Templates**、**Subscriber Templates**、**Custom Fields**、**Owner Rules** 和 **Label Rules**——这些是项目级别的，被所有状态页共享。

## 访客看到的内容

公开页面是一个独立的应用，拥有一小组路由：

- `/` —— **Overview**。
- `/incidents` 和 `/incidents/:id` —— 事件列表和单个事件。
- `/announcements` 和 `/announcements/:id`。
- `/scheduled-events` 和 `/scheduled-events/:id`。
- `/subscribe/email`、`/subscribe/sms`、`/subscribe/slack`、`/subscribe/microsoft-teams`、`/subscribe/webhooks`。
- `/rss` —— 订阅源。
- `/login`、`/sso` 和 `/master-password` —— 仅在私密页面上有意义。

顶部导航栏始终显示 **Overview**；其余项目只有在启用后才会出现。**Incidents**、**Announcements** 和 **Scheduled Events** 各自需要打开对应的开关；**Subscribe** 需要同时打开 **Show Subscriber Page** 并至少启用一个订阅渠道。私密页面还会多出一个 **Logout** 项。

### 概览页面

概览页面是绝大多数访客唯一会看到的页面。从上到下，它会渲染：

1. **任何正在进行的公告**——开始时间已过、结束时间尚未到达的公告。
2. **一个整体状态横幅**——用一行文字概括所有资源还是仅部分资源受到影响。
3. **一个整体正常运行时间百分比**，如果您开启了它。默认关闭。
4. **资源分组**，每个分组下是其资源、当前状态，以及正常运行时间历史条形图。
5. **Active Incidents**。
6. **Scheduled Maintenance Events**。

一个还没有任何内容的全新页面会显示一个空状态，提示您从仪表板添加资源——这正是提醒您前往 **Resources** 界面的信号。

关于什么会让一个事件首次出现在此页面上，以及什么会让它再次消失，请参见 [事件状态与严重级别](/docs/incidents/states-and-severities)。

## 选择页面上显示的内容

大多数显示开关都集中在同一个地方：**Status Pages → your page → Advanced → Advanced Settings**。每张卡片都有自己的 **Edit Settings** 按钮。

**Incident Settings**：

- **Show Incidents**（`showIncidentsOnStatusPage`）——默认开启。关闭它也会移除 **Incidents** 导航项。
- **Show Incident History (in days)**（`showIncidentHistoryInDays`）——事件列表向前追溯的天数。默认 14 天。
- **Show Incident Labels**（`showIncidentLabelsOnStatusPage`）——默认关闭。

**Episode Settings**——事件分集（episode）的三个相同开关：**Show Episodes**（`showEpisodesOnStatusPage`，默认开启）、**Show Episode History (in days)**（默认 14 天），以及 **Show Episode Labels**（默认关闭）。Episode 是独立的模型，拥有自己的端点，而不是事件的一种视图。

**Announcement Settings**：

- **Show Announcements**（`showAnnouncementsOnStatusPage`）——默认开启。
- **Show Announcement History (in days)**（`showAnnouncementHistoryInDays`）——默认 14 天。

**Scheduled Event Settings**：

- **Show Scheduled Maintenance Events**（`showScheduledMaintenanceEventsOnStatusPage`）——默认开启。
- **Show Scheduled Event History (in days)**（`showScheduledEventHistoryInDays`）——默认 14 天。
- **Show Event Labels**（`showScheduledEventLabelsOnStatusPage`）——默认关闭。

**Uptime History Settings**：

- **Show Uptime History (in days)**（`showUptimeHistoryInDays`）——每个资源旁正常运行时间条形图覆盖的天数长度。默认 90 天，取值必须在 1 到 90 之间。资源或分组上的每一个 **Show Uptime %** 和 **Show Status History Chart** 选项都读取这个数值。

**Subscriber Settings**：

- **Show Subscriber Page**（`showSubscriberPageOnStatusPage`）——默认开启，再加上五个按渠道分开的启用开关。相同的渠道开关也出现在 **Subscribers** 部分下专门的 **Subscriber Settings** 界面中；请把那个界面当作设置它们的权威位置。

**Powered By OneUptime Branding**：

- **Hide Powered By OneUptime Branding**——默认关闭，因此访客看到的页脚会显示“Powered by OneUptime”，直到您打开此开关。

**颜色设置在哪里。** 正常运行时间条形图的颜色不在这里——**Default Bar Color**、条形颜色规则、**Downtime Monitor Statuses** 和 **Show Overall Uptime Percent** 都位于 **Status Pages → your page → Branding → Overview Page**。这里没有任何主题或品牌颜色设置；超出这些控件之外的一切都要通过 **Custom CSS** 完成。

## 在正式上线前预览

每个状态页的 **Overview** 界面都带有一张 **Status Page Preview URL** 卡片，其中有一个直达页面本身的链接。在您还在添加资源、尚未绑定自定义域名之前，可以使用它。

在幕后，每一个公开路由都在 `/status-page/{statusPageId}/...` 下有一个预览版本——预览概览页、预览事件列表、预览订阅页面，等等。这意味着从仪表板预览中获取的 URL 或截图，在绑定自定义域名之后与客户实际看到的内容并不一致，所以在把链接粘贴到运行手册或邮件之前，请再三核对。

## 限制谁可以查看页面

不是每个状态页都面向公众。所有相关控制都位于 **Security** 部分。

### 私人用户

在 **Status Pages → your page → Security → Authentication Settings** 中关闭 **Is Visible to Public**（对应 `isPublicStatusPage` 字段）。访客随后会进入 `/login` 并必须登录。

在 **Status Pages → your page → Security → Private Users** 中添加可以登录的人员。这里有一个 **Add in Bulk** 操作——粘贴一份电子邮件地址列表，每个地址都会收到一封邀请邮件。私人用户有自己独立的忘记密码和重置密码流程，与您的 OneUptime 项目账户是分开的。

### 主密码

**Authentication Settings** 中还有一张 **Master Password** 卡片，带有 **Require Master Password** 开关和密码本身。访客随后会访问 `/master-password`，用一个共享密钥解锁页面。

**主密码与私人用户不能同时叠加使用。** 主密码开启期间，私人用户身份验证会被禁用，**Private Users** 界面会显示一条横幅告知这一点。

### SSO 与 OIDC

对于与您的身份提供商绑定的私密页面，**Status Pages → your page → Security → SSO** 配置 SAML（登录 URL、签发者、x509 证书、签名与摘要方法），**Status Pages → your page → Security → OIDC** 配置 OpenID Connect（发现 URL、签发者、客户端 ID 与密钥、作用域、声明名称）。**SCIM** 可以自动从身份提供商（IdP）配置私人用户。这些功能受套餐限制，因此并非在每个安装中都可用。

**SSO Settings** 卡片上有一个 **Force SSO for Login**（`requireSsoForLogin`，默认关闭）开关。请在开启之前先测试您的 SSO 配置——如果配置有误，您将把自己锁在状态页之外。

### IP 白名单

**Authentication Settings** 中还有一张 **IP Whitelist** 卡片，由 `ipWhitelist` 字段支持，供只应响应已知网络的页面使用。

## 可嵌入徽章与 RSS 订阅源

有两种方式可以在页面本身之外展示状态。

**嵌入式状态徽章。** 在 **Status Pages → your page → Advanced → Embedded Status** 的 **Embedded Status Badge** 卡片中开启 **Enable Embedded Status Badge**（`enableEmbeddedOverallStatus`，默认关闭）。它与一个 `embeddedOverallStatusToken` 配对，并从 `/badge/:statusPageId` 提供徽章服务，因此您可以把当前的整体状态嵌入到您的文档、应用页脚或营销页面中。

**RSS 订阅源。** 每个状态页都提供 `/rss`——一个标题为“{status page name} Updates”的订阅源，其条目分别以 `Incident: `、`Announcement: ` 和 `Scheduled Maintenance: ` 为前缀。适合那些更愿意把您的更新导入阅读器或聊天机器人，而不是通过电子邮件订阅的人。

如果您更愿意自己拉取数据，状态页背后有面向概览、事件、计划维护、公告和分集（episode）的公开只读端点——参见 [公共 API](/docs/status-pages/public-api)。

## 接下来读什么

- [状态页资源与分组](/docs/status-pages/resources-and-groups)——把监视器放到页面上并组织成区块。
- [状态页品牌与域名](/docs/status-pages/branding-and-domains)——logo、favicon、页脚、自定义代码，以及把您自己的域名指向该页面。
- [订阅者与公告](/docs/status-pages/subscribers)——五个订阅渠道、双重确认订阅，以及发布公告。
- [公共 API](/docs/status-pages/public-api)——以编程方式读取状态页数据。
- [事件概览](/docs/incidents/index)——出现在页面上的事件。
- [事件状态与严重级别](/docs/incidents/states-and-severities)——什么会让一个事件出现在状态页上，什么会让它消失。
