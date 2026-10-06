# 订阅者与公告

状态页是一个人们主动过来看的地方。订阅者则是那些宁可不必跑一趟的人——他们只交给你一次邮箱地址、手机号、Slack Webhook 或者 HTTP 端点，之后你的更新就会自己找上门去。

公告是同一件事的另一半。监视器能告诉访客结账接口在返回 500；但没有哪个监视器能告诉他们你周六要迁移数据库、某个第三方服务商今天状态不佳，或者他们昨天读到的那个事件已经彻底收尾了。公告就是那条自由文本的渠道，专门用来讲你的检查看不见的一切，而且它会推送给同一批订阅者。

本页两件事都讲：五种订阅渠道以及访客如何报名、订阅者可以选择听哪些事、双重确认和退订的流程，还有公告怎么写、怎么排期、怎么做成模板。

## 订阅渠道

一个状态页支持五种渠道。这些渠道和访客订阅所在的页面都在一个地方开关：**状态页面 → 你的页面 → 订阅者 → 订阅者设置** 里的 **渠道** 卡片。每个开关一拨动就会保存：

- **显示订阅者页面**（`showSubscriberPageOnStatusPage`）——默认开启。在状态页导航栏里放上 **订阅** 项，访客在那里通过下面的渠道订阅。
- **电子邮件**（`enableEmailSubscribers`）——默认开启。在你打开它们之前，其余的全是关着的。
- **SMS**（`enableSmsSubscribers`）——默认关闭。在 OneUptime Cloud 上，除非该页面有自己的 **Twilio 配置**，否则每条短信都从项目的短信和电话余额中支付。要打开它，项目还需要在 **项目设置 > 通知 > 通知设置** 的 **通知渠道** 卡片中打开 **SMS**。项目所有者或拥有 **Manage Billing** 权限的用户可以开启它。
- **Slack**（`enableSlackSubscribers`）——默认关闭。
- **Microsoft Teams**（`enableMicrosoftTeamsSubscribers`）——默认关闭。
- **Webhook**（`enableWebhookSubscribers`）——默认关闭。

这些开关决定访客能怎样自己订阅：通过已关闭的渠道订阅会被状态页拒绝。它们不会停止通知：你的团队在仪表板上、通过 API 或工作流添加的订阅者，无论哪些渠道开着，都会收到更新。

在 OneUptime Cloud 上，你的套餐不包含的开关旁边会显示所需套餐的名称：**SMS** 和 **显示订阅者页面** 需要 **Growth**，**Slack**、**Microsoft Teams** 和 **Webhook** 需要 **Scale**。

每种渠道在状态页侧边菜单的 **订阅者** 下面还各有一份自己的名单：**电子邮件订阅者**、**SMS 订阅者**、**Slack 订阅者**、**MS Teams 订阅者** 和 **Webhook 订阅者**。你在那里查看谁订阅了、手工添加某个人，或者给某个订阅者留一条 **备注**（`internalNote`）。 某个渠道关闭期间，它的名单顶部会说明这一点，渠道的开关就在旁边，你不用离开名单就能打开它。

**光有一个开关还不够。** 状态页导航栏里的 **订阅** 项，只有在 **显示订阅者页面** 打开 *并且* 至少打开了一种渠道时才会出现。如果你打开了 **电子邮件** 却让 **显示订阅者页面** 关着，访客根本没有路径能找到那张表单。

## 访客在订阅页面上看到什么

**订阅** 页面有一个子菜单，每启用一种渠道就有一个标签页——**电子邮件**、**短信**、**Slack**、**MS Teams**、**Webhook**——分别对应 `/subscribe/email`、`/subscribe/sms`、`/subscribe/slack`、`/subscribe/microsoft-teams` 和 `/subscribe/webhooks`。每个标签页只问它最低限度需要的东西：

- **电子邮件**——标题 **通过电子邮件订阅**，一个字段 **您的电子邮件**，占位符 `subscriber@company.com`。
- **短信**——标题 **通过短信订阅**，一个字段 **您的电话号码**，占位符 `+11234567890`。
- **Slack**——标题 **通过 Slack 订阅**，有 **Slack 工作区名称**（用于校验）和 **Slack 传入 Webhook URL**，占位符 `https://hooks.slack.com/services/...`。
- **MS Teams**——标题 **通过 Microsoft Teams 订阅**，有 **Microsoft Teams 工作区名称** 和 **Microsoft Teams 传入 Webhook URL**，占位符 `https://outlook.office.com/webhook/...`。
- **Webhook**——标题 **通过 Webhook 订阅**，一个字段 **Webhook URL**。每次状态页事件发生时，都会向它发一个 JSON `POST` 请求。

提交按钮上写的是 **订阅**，报名成功后会显示 *您已成功订阅。* 这个页面还分成 **新订阅** 和 **管理现有订阅** 两块，所以已经订阅过的人不用翻旧邮件也能回到自己的偏好设置。

## 让订阅者自己选资源和事件类型

默认情况下，订阅者会收到这个页面上的所有东西。**高级订阅者设置** 卡片里的两个开关可以改变这一点：

- **允许订阅者选择资源**（`allowSubscribersToChooseResources`）——默认关闭。打开之后，订阅表单上会多出一个 **订阅所有资源** 开关；把它关掉，**选择要订阅的资源** 就会出现，访客可以挑具体的资源。
- **允许订阅者选择事件类型**（`allowSubscribersToChooseEventTypes`）——默认关闭。形式一模一样：一个 **订阅所有事件类型** 开关，关掉它，下面就出现 **选择要订阅的事件类型**。

只要开启其中任意一个，表单仍是一页：这些选择放在 **偏好设置** 里，折叠在“更新发送到哪里”下方。折叠时它用一行说明访客将收到什么（在缩小范围之前，是此状态页的所有更新），所以想要全部更新的访客直接点击 **订阅** 即可。**更新订阅** 页面会展开显示同样的选择。

事件类型有 `Incident`、`Announcement` 和 `Scheduled Event` 三种。

这些选择会落在订阅者记录上，成为 **Is Subscribed to All Resources**（`isSubscribedToAllResources`，默认 true）、**Is Subscribed to All Event Types**（`isSubscribedToAllEventTypes`，默认 true）、**Subscribed to Resources** 和 **Subscribed to Event Types**。

适合这种情况：一个页面覆盖了好几款产品。只用你 API 的客户，不想每次市场官网抖一下都被呼一遍——与其眼睁睁看着他把订阅整个退掉，不如让他自己把范围收窄。

同一张卡片上还有 **订阅者时区**。

## 电子邮件的双重确认

电子邮件订阅者一律要确认。当一个带邮箱地址的订阅者被创建、且不是以"已确认"状态创建时，**Is Subscription Confirmed**（`isSubscriptionConfirmed`）会被强制设为 `false`，并生成一个六位数的 **Subscription Confirmation Token**。随后 OneUptime 会发出一封确认邮件，链接形如 `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`。访客会落到一个 **确认订阅** 页面，走完流程后看到 *订阅确认成功*。

短信、Slack、Microsoft Teams 和 Webhook 订阅者跳过这一步——它们创建时 `isSubscriptionConfirmed` 就已经是 `true`。

**没确认就等于收不到。** 为通知拉取订阅者的那条查询会按 `isUnsubscribed: false` 和 `isSubscriptionConfirmed: true` 过滤。一个从没点过链接的邮箱地址，会一直躺在你的 **电子邮件订阅者** 名单里，却什么也收不到。如果有人一口咬定自己订阅了却收不到消息，先去看这一列。

关闭邮件确认是没有开关的——凡是通过状态页报名的人，这一步都是无条件的。另有一个按订阅者维度的字段 **Send You Have Subscribed Message**（`sendYouHaveSubscribedMessage`，默认 true），控制的是订阅者确认之后那封"您已订阅"的邮件。

## 管理和取消订阅

发给订阅者的每一封邮件都带一个退订链接，形如 `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`。那个页面标题是 **更新订阅**，会告诉访客可以在这里更新偏好或者取消订阅。它包含：

- 页面允许访客选择的那些资源和事件类型选择器。
- 一个 **取消订阅** 开关，说明写的是从所有资源退订。它写入 **已取消订阅**（`isUnsubscribed`，默认 false）。
- 一个写着 **更新订阅** 的提交按钮；保存后显示 *您的更改已保存。*

链接丢了的人，可以在 **订阅** 页面上用 **管理现有订阅**，然后点 **发送管理链接**。OneUptime 会回复说带链接的邮件已经发出，如果没收到就检查一下垃圾邮件文件夹。

这一切背后的接口是 `POST .../subscribe/:statusPageId`、`POST .../manage-subscription/:statusPageId`、`POST .../get-subscription/:statusPageId/:subscriberId` 和 `PUT .../update-subscription/:statusPageId/:subscriberId`。

取消订阅翻的是一个标志位，而不是删掉一行记录，所以这条记录仍然留在渠道名单里，带着 **已取消订阅** 标记——之后你需要解释某个地址为什么不再收信时，这很有用。

## 订阅者会收到哪些通知

订阅者听到的就是上面那三种事件类型，但每个来源都有自己的开关，所以不会有东西被误发出去。

### 公告通知

公告本身带一个 **Should subscribers be notified?**（`shouldStatusPageSubscribersBeNotified`），在创建表单上表现为 **计划与通知** 里的 **通知状态页订阅者** 复选框，默认勾选。订阅者只会在公告开始显示时收到一次通知，所以这是在创建时决定的，编辑不会改变它。如果公告在 **受影响的监视器** 里点了名的监视器，通知就只发给关注这些监视器的人；留空则所有订阅者都会收到。

### 计划维护事件

计划维护事件有自己的一组订阅者字段：**Should subscribers be notified when event is created?**、**Should subscribers be notified when event is changed to ongoing?**、**Should subscribers be notified when event is changed to ended?**，外加用于提前预警的 **Subscriber notifications before the event** 和 **Next subscriber notification before the event at?**。事件上的 **状态页面** 决定它出现在哪些页面上，**Should be visible on status page?** 决定它到底会不会出现。

### 事件

`Incident` 是第三种事件类型。一个事件凭什么会出现在状态页上——它牵涉哪些资源、哪些状态让它继续可见——由[事件状态与严重级别](/docs/incidents/states-and-severities)讲清楚。

状态页侧边菜单里的 **通知日志**（`{id}/notification-logs`）是你想知道这个页面到底发出去了什么时该去的地方。

## 自定义通知模板

**订阅者设置** 上的 **通知模板** 卡片列出了这个状态页正在用的模板，列有 **模板名称**、**事件类型** 和 **通知方式**——所以你可以按事件类型、按渠道分别调整措辞，而不是所有场合都用同一套官腔。

项目级的模板在上一层，位于 **状态页面 → 设置 → 订阅者模板**，就挨着 **公告模板**。

## 邮件页脚、自定义 SMTP 和 Twilio

**订阅者设置** 上还有三张卡片，管的是发给订阅者的消息怎么离开你的项目：

- **邮件页脚设置**——**启用自定义邮件页脚文本** 和 **订阅者电子邮件通知页脚文本** 让订阅邮件带上你自己的页脚。
- **自定义 SMTP**——**自定义 SMTP 配置** 让订阅邮件走你自己的邮件服务器，而不是默认那台。
- **Twilio 配置**——**Twilio 配置** 是短信订阅者所用的 Twilio 账号。

如果你有电子邮件订阅者，自定义 SMTP 值得早点做：来自你自己域名的邮件被过滤掉的概率要低得多，而凌晨两点读到它的客户也会更愿意相信它。

## 公告

公告是一条项目级的记录（`StatusPageAnnouncement` 模型），你把它推送到一个或多个状态页上，可以按具体监视器缩小范围，并给它一个展示的时间窗口。

你可以从 **状态页面 → 更多 → 公告** 创建，也可以从某个状态页侧边菜单里的 **公告** 创建。从状态页创建时，那个状态页已经选好，只需写标题和描述，点 **创建公告** 就会回到该状态页的 **公告** 列表（如果你中途取消选择了那个页面，则回到项目的列表）。创建表单分两步，然后是一个确认页：

1. **公告**——**标题**（必填，至少两个字符）和 **描述**（Markdown，必填：这是人们在状态页上读到的正文）。用来放那些应该随公告一起出现在状态页上的文件的 **附件**，放在 **更多字段** 里。
2. **状态页面**——**在这些状态页上显示公告**，必填的多选（一条公告可以同时投放到多个页面），以及 **受影响的监视器**：一个都不选，就通知所有订阅者。选择监视器后，页面选择框下方会建议显示这些监视器的状态页面：“显示受影响监视器的状态页面：”后跟每个页面的名称。点击名称即可添加该页面，点击 **全部添加** 可全部添加；不会替你自动选择。下面的 **计划与通知** 折叠成一行，说明将会发生什么：“立即显示，并一直显示到您结束它为止。 开始显示时会通知订阅者。”展开后可以修改 **开始显示公告时间**（默认是现在）、**停止显示公告于**（留空：公告会一直显示，直到你设置结束时间）或 **通知状态页订阅者**（默认勾选）。这一行会随你的选择变化。结束时间必须晚于开始时间；对新公告来说，还必须是尚未到来的时间：已经结束的公告永远不会显示。

确认页显示同一行。**从模板创建** 会用模板填好表单；从状态页创建时，模板自带的状态页会和那个页面一起保留。

公告自己的页面用同样的两步来编辑它。**将此更新通知订阅者** 在描述下方，**计划** 包含开始和结束时间。设置一个已经过去的结束时间，就是撤下公告的方式。

访客在 `/announcements` 读公告，页面分成 **活动公告** 和 **过往公告**，每条都标着 **公告于**。当前生效的公告还会被置顶在概览页上。没有可展示的内容时，页面显示 *无公告*，并注明到目前为止还没有发布过任何公告。

附件由 `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId` 提供，走的是和状态页本身一样的读取检查——所以私密页面上的附件依然是私密的。

## 公告的排期是怎么工作的

**Show At**（`showAnnouncementAt`）和 **End At**（`endAnnouncementAt`）驱动着一切，但概览页和公告列表问的是不同的问题，而这个差别常常把人绊倒。

- **概览页** 在 `showAnnouncementAt` 已经过去、并且 `endAnnouncementAt` 要么在未来、要么为空时展示一条公告。
- **`/announcements` 列表** 展示的是 `showAnnouncementAt` 落在公告历史记录天数（`showAnnouncementHistoryInDays`，默认 14）范围内的公告，然后在客户端把它们分成活动和过往两组。

有两个后果值得提前想好：

- **没有结束日期的公告永远不会过期。** 把 **停止显示公告于** 留空，它就会无限期地钉在概览页上。凡是有时效的，都给它设一个结束日期。
- **一条很旧但仍然生效的公告可能从列表里消失。** 如果它的开始时间早于 `showAnnouncementHistoryInDays`，它就会从 `/announcements` 上掉下去，同时还留在概览页上。如果你有长期挂着的通知，就把历史窗口调大。

公告到底显不显示，在 **高级设置** 上的 **状态页显示的内容** 卡片里设置：**显示公告**（`showAnnouncementsOnStatusPage`，默认 true）以及它下面的 **显示最近 … 天**（`showAnnouncementHistoryInDays`，默认 14）。**显示公告** 关闭时，公告接口会直接拒绝请求。

## 公告模板

如果你反复发同一类通知——每月一次的维护预告、周期性的第三方服务降级——那就先把它做成罐头。**状态页面 → 设置 → 公告模板** 存的是 `StatusPageAnnouncementTemplate` 模型。它的表单先走 **模板信息**（**模板名称**、**模板描述**），然后是公告本身的步骤：**公告**（**标题**、**描述**）和 **状态页面**（**在这些状态页上显示公告**、**受影响的监视器** 和默认勾选的 **通知状态页订阅者**），于是投放范围和是否通知这两个决定只做一次，而不是每次都做一遍。模板没有时间安排：用它创建的公告从创建时起就会显示，除非你在 **计划与通知** 里修改。

## Webhook 订阅者与 SSRF 防护

Webhook 订阅者会在每次状态页事件发生时收到一个 JSON `POST` 请求，这让它成了把状态页更新接进你自己系统的最省事的办法——一个聊天机器人、一块内部看板、一条工单队列。

因为订阅是公开页面上的公开操作，OneUptime 会守住目标地址：

- 普通的 **Webhook URL** 在被接受之前会先做校验，私有地址、回环地址、链路本地地址和云元数据地址都会被拒绝。你没法把一个订阅指向 OneUptime 部署自身网络内部的东西。
- **Slack 传入 Webhook URL** 必须以 `https://hooks.slack.com/services/` 开头。

如果一个 Webhook 订阅在报名时就被拒了，先怀疑是内网地址或者格式不对的 URL。

## 接下来读什么

- [状态页概览](/docs/status-pages/index) —— 状态页是什么，以及它是怎么拼起来的。
- [状态页资源与分组](/docs/status-pages/resources-and-groups) —— 订阅者可以在哪些监视器和分组之间做选择。
- [状态页品牌与域名](/docs/status-pages/branding-and-domains) —— 自定义域名、logo，以及你邮件所链向的那个页面长什么样。
- [公共 API](/docs/status-pages/public-api) —— 以编程方式读取状态页数据。
- [事件状态与严重级别](/docs/incidents/states-and-severities) —— 什么把一个事件放上状态页，什么又把它撤下来。
- [事件设置与自动化](/docs/incidents/settings) —— 事件沟通背后那些项目级的规则。
