# 订阅者与公告

状态页是人们需要主动去访问的地方。而订阅者是那些宁愿不必这样做的人——他们只需交给你一个电子邮件地址、一个电话号码、一个 Slack Webhook 或一个 HTTP 端点，之后你的更新就会主动送达他们。

公告则是同一项工作的另一半。监视器可以告诉访客结账功能正在返回 500 错误；但没有任何监视器能告诉他们你周六要迁移数据库、某个第三方服务商今天状态不佳，或者他们昨天读到的那个事件已经彻底解决。公告是自由文本渠道，用来传达一切你的检查无法感知的信息，并且会推送给同一份订阅者列表。

本页涵盖这两方面：五个订阅渠道及访客如何注册、订阅者可以选择接收哪些内容、双重确认与取消订阅流程，以及公告是如何撰写、安排时间和使用模板的。

## 订阅渠道

一个状态页支持五个渠道，每个渠道在状态页上都有自己的开关。前往**状态页 → 你的页面 → 订阅者 → Subscriber Settings**：

- **启用电子邮件订阅者**（`enableEmailSubscribers`）—— 默认开启。其他渠道在你打开它之前都是关闭的。
- **启用短信订阅者**（`enableSmsSubscribers`）—— 默认关闭。
- **启用 Slack 订阅者**（`enableSlackSubscribers`）—— 默认关闭。
- **启用 Microsoft Teams 订阅者**（`enableMicrosoftTeamsSubscribers`）—— 默认关闭。
- **启用 Webhook 订阅者**（`enableWebhookSubscribers`）—— 默认关闭。

每个渠道在状态页侧边菜单的**订阅者**下也都有自己的列表：**电子邮件订阅者**、**SMS 订阅者**、**Slack 订阅者**、**MS Teams 订阅者**和 **Webhook 订阅者**。你可以在那里查看谁已经订阅、手动添加某人，或为某个特定订阅者留下一条**备注**（`internalNote`）。

**光开一个开关是不够的。**状态页导航栏中的**订阅**项只有在**Show Subscriber Page**（`showSubscriberPageOnStatusPage`）开启*并且*至少启用了一个渠道时才会出现。如果你打开了**启用电子邮件订阅者**，却让**Show Subscriber Page**保持关闭，访客就没有办法找到订阅表单。

同样的五个开关在**高级设置**的 **Subscriber Settings** 卡片中还会再出现一次，与**Show Subscriber Page**并列。它们底层对应的是相同的字段——选定一个页面并坚持用它，建议优先使用专门的 **Subscriber Settings** 页面，因为其余的订阅者相关配置也都在那里。

## 访客在订阅页面上看到的内容

**订阅**页面有一个子菜单，每个已启用的渠道各有一个标签——**Email**、**SMS**、**Slack**、**MS Teams**、**Webhooks**——分别对应 `/subscribe/email`、`/subscribe/sms`、`/subscribe/slack`、`/subscribe/microsoft-teams` 和 `/subscribe/webhooks`。每个标签只要求填写最少必要信息：

- **Email** —— 标题为**通过电子邮件订阅**，一个字段**您的电子邮件**，占位符 `subscriber@company.com`。
- **SMS** —— 标题为**通过短信订阅**，一个字段**您的电话号码**，占位符 `+11234567890`。
- **Slack** —— 标题为**通过 Slack 订阅**，包含 **Slack 工作区名称**（用于验证）和 **Slack 传入 Webhook URL**，占位符 `https://hooks.slack.com/services/...`。
- **MS Teams** —— 标题为**通过 Microsoft Teams 订阅**，包含 **Microsoft Teams 工作区名称**和 **Microsoft Teams 传入 Webhook URL**，占位符 `https://outlook.office.com/webhook/...`。
- **Webhooks** —— 标题为**通过 Webhook 订阅**，一个字段 **Webhook URL**。每次状态页事件发生时都会向它发送一个 JSON `POST` 请求。

提交按钮显示为**订阅**，注册成功后会显示*您已成功订阅。*页面还提供**新订阅** / **管理现有订阅**的切换，让已经订阅过的人无需翻找旧邮件就能找回自己的偏好设置。

## 让订阅者选择资源和事件类型

默认情况下，订阅者会收到页面上的全部内容。**Advanced Subscriber Settings** 卡片中的两个开关可以改变这一点：

- **允许订阅者选择资源**（`allowSubscribersToChooseResources`）—— 默认关闭。开启后，订阅表单会新增一个**订阅所有资源**开关；关闭它则会出现**选择要订阅的资源**，让访客可以挑选具体资源。
- **允许订阅者选择事件类型**（`allowSubscribersToChooseEventTypes`）—— 默认关闭。结构相同：一个**订阅所有事件类型**开关，关闭时下方出现**选择要订阅的事件类型**。

事件类型包括 `Incident`（事件）、`Announcement`（公告）和 `Scheduled Event`（计划维护事件）。

这些选择会落到订阅者记录上的 **Is Subscribed to All Resources**（`isSubscribedToAllResources`，默认 true）、**Is Subscribed to All Event Types**（`isSubscribedToAllEventTypes`，默认 true）、**Subscribed to Resources** 和 **Subscribed to Event Types**。

适用场景：一个覆盖多个产品的页面。只使用你的 API 的客户不希望每次营销网站出现波动都收到通知——让他们自己缩小订阅范围，而不是眼睁睁看着他们彻底取消订阅。

同一张卡片中还包含**订阅者时区**。

## 电子邮件双重确认

电子邮件订阅者始终需要确认。当一个订阅者以电子邮件地址创建、且创建时并未标记为已确认时，**Is Subscription Confirmed**（`isSubscriptionConfirmed`）会被强制设为 `false`，并生成一个六位数的**Subscription Confirmation Token**。随后 OneUptime 会发送一封确认邮件，链接格式为 `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`。访客会进入**确认订阅**页面，一旦确认成功，会看到*订阅确认成功*。

短信、Slack、Microsoft Teams 和 Webhook 订阅者会跳过这一步——它们在创建时 `isSubscriptionConfirmed` 就已经设为 `true`。

**未确认意味着静默。**用于获取通知对象的查询会同时过滤 `isUnsubscribed: false` 和 `isSubscriptionConfirmed: true`。一个从未点击确认链接的电子邮件地址会一直留在你的**电子邮件订阅者**列表中，但不会收到任何内容。如果有人坚称自己已经订阅却什么都没收到，先检查这一列。

没有开关可以关闭电子邮件确认——对任何通过状态页注册的人，这一步都是强制的。另外还有一个独立的按订阅者设置的字段，**Send You Have Subscribed Message**（`sendYouHaveSubscribedMessage`，默认 true），控制订阅者确认后是否发送"您已订阅"的邮件。

## 管理和取消订阅

每封订阅者邮件都带有一个取消订阅链接，格式为 `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`。该页面标题为**更新订阅**，告诉访客可以在这里更新偏好设置或取消订阅。它包含：

- 该页面允许的资源和事件类型选择器（如果有）。
- 一个**取消订阅**开关，说明为取消订阅所有资源。它会写入**Is Unsubscribed**（`isUnsubscribed`，默认 false）。
- 一个提交按钮，显示为**更新订阅**；保存后会显示*您的更改已保存。*

丢失链接的人可以在**订阅**页面使用**管理现有订阅**并点击**发送管理链接**。OneUptime 会回复说包含链接的邮件已经发送，如果没有收到，请检查垃圾邮件文件夹。

支撑这一切的接口是 `POST .../subscribe/:statusPageId`、`POST .../manage-subscription/:statusPageId`、`POST .../get-subscription/:statusPageId/:subscriberId` 和 `PUT .../update-subscription/:statusPageId/:subscriberId`。

取消订阅只是翻转一个标记位，而不是删除记录，所以该记录仍会留在渠道列表中，并带有已设置的**Is Unsubscribed**标记——当你以后需要解释某个地址为什么不再收到邮件时，这很有用。

## 订阅者会收到哪些通知

订阅者会收到上述三种事件类型的通知，但每个来源都有自己的开关，所以不会出现意外发送的情况。

### 公告通知

公告本身带有 **Should subscribers be notified?**（`shouldStatusPageSubscribersBeNotified`），在创建表单上体现为**通知状态页订阅者**复选框，默认开启。如果公告在**受影响的监视器（可选）**中指定了监视器，通知就只会针对这些监视器的订阅者；留空则通知所有订阅者。

### 计划维护事件

计划维护事件有自己独立的一组订阅者字段：**Should subscribers be notified when event is created?**、**Should subscribers be notified when event is changed to ongoing?**、**Should subscribers be notified when event is changed to ended?**，以及用于提前提醒的**Subscriber notifications before the event**和**Next subscriber notification before the event at?**。该事件上的**Status Pages**决定它会出现在哪些页面上，**Should be visible on status page?**决定它是否会出现。

### 事件

`Incident`（事件）是第三种事件类型。什么会让一个事件首先出现在状态页上——它涉及哪些资源、哪些状态会让它保持可见——在[事件状态与严重级别](/docs/incidents/states-and-severities)中有介绍。

状态页侧边菜单中的**Notification Logs**部分（`{id}/notification-logs`）是你查看页面实际发送了什么内容的地方。

## 自定义通知模板

**Subscriber Settings**上的**Notification Templates**卡片列出了该状态页使用的模板，包含**Template Name**、**Event Type**和**Notification Method**列——这样你就可以按事件类型和渠道分别调整措辞，而不是所有情况都用同一句话。

项目级模板则在上一层，**状态页 → 设置 → Subscriber Templates**，与**Announcement Templates**并排。

## 电子邮件页脚、自定义 SMTP 和 Twilio

**Subscriber Settings**上还有三张卡片，控制订阅者消息如何从你的项目发出：

- **Email Footer Settings** —— **Enable Custom Email Footer Text** 和 **Subscriber Email Notification Footer Text** 用于在订阅者邮件上添加你自己的页脚。
- **Custom SMTP** —— **Custom SMTP Config** 让订阅者邮件通过你自己的邮件服务器发送，而不是使用默认服务器。
- **Twilio Config** —— **Twilio Config** 是用于短信订阅者的 Twilio 账户配置。

如果你有电子邮件订阅者，尽早配置自定义 SMTP 是值得的：来自你自己域名的邮件被过滤的概率会低得多，凌晨两点阅读邮件的客户也更容易信任它。

## 公告

公告是一条项目级记录（`StatusPageAnnouncement` 模型），你可以将其推送到一个或多个状态页，可选地限定到特定监视器，并设置一个显示时间窗口。

你可以从**状态页 → 更多 → Announcements**创建，也可以从某个具体状态页侧边菜单中的**Announcements**创建。创建表单是一个四步向导：

1. **Basic Information** —— **Announcement Title**（必填，至少两个字符）、**Description**（Markdown，可选）以及**Attachments**，用于随公告在状态页上提供的文件。
2. **Status Pages** —— **在这些状态页上显示公告**，必填的多选字段。一条公告可以同时面向多个页面。
3. **Resources Affected** —— **受影响的监视器（可选）**。如果不选择任何项，则通知所有订阅者。
4. **Schedule & Settings** —— **开始显示公告时间**（必填，默认为当前时间）、**停止显示公告于**（可选）和**通知状态页订阅者**（默认开启）。

访客在 `/announcements` 阅读公告，页面分为**活动公告**和**过往公告**，各自标注**公告于**。当前处于活动状态的公告还会被置顶在概览页面上。没有内容可显示时，页面显示*无公告*，并注明目前还没有发布过任何公告。

附件通过 `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId` 提供，遵循与状态页本身相同的读取权限检查——因此私有页面上的附件也会保持私有。

## 公告的时间安排是如何工作的

**Show At**（`showAnnouncementAt`）和 **End At**（`endAnnouncementAt`）驱动着这一切，但概览页面和公告列表问的是不同的问题，这个差异容易让人困惑。

- **概览页面**在 `showAnnouncementAt` 已过去，且 `endAnnouncementAt` 尚未到来或为空时显示公告。
- **`/announcements` 列表**显示 `showAnnouncementAt` 落在**显示公告历史记录（天数）**（`showAnnouncementHistoryInDays`，默认 14）范围内的公告，然后在客户端将它们拆分为活动和过往两类。

有两个值得提前规划的后果：

- **没有结束日期的公告永远不会过期。**将**停止显示公告于**留空，它会无限期地置顶在概览页面上。给任何有时限的内容都设置一个结束日期。
- **一条旧的、但仍处于活动状态的公告可能会从列表中消失。**如果它开始的时间早于 `showAnnouncementHistoryInDays` 天前，它会从 `/announcements` 中消失，但仍会保留在概览页面上。如果你保留长期有效的通知，请提高历史记录窗口的天数。

公告是否会显示，由**高级设置**上的**Announcement Settings**卡片控制：**显示公告**（`showAnnouncementsOnStatusPage`，默认 true）和**显示公告历史记录（天数）**（默认 14）。在**显示公告**关闭的情况下，公告接口会直接拒绝该请求。

## 公告模板

如果你反复发布同一类通知——比如每月的维护提醒，或某个第三方服务经常出现的降级提示——可以把它预先做成模板。**状态页 → 设置 → Announcement Templates**存储的是 `StatusPageAnnouncementTemplate` 模型，其表单要求填写**Template Name**、**Template Description**、**Announcement Title**、**Description**、**在这些状态页上显示公告**、**受影响的监视器（可选）**和**Notify Subscribers**，这样推送范围和是否通知的决定只需做一次，而不必每次都重新设置。

## Webhook 订阅者与 SSRF 防护

Webhook 订阅者会在每次状态页事件发生时收到一个 JSON `POST` 请求，这使得它们成为将状态页更新接入你自己系统——聊天机器人、内部仪表盘、工单队列——最简单的方式。

由于订阅是公开页面上的公开操作，OneUptime 会对目标地址进行防护：

- 通用的 **Webhook URL** 在被接受之前会经过验证，私有地址、回环地址、链路本地地址和云元数据地址都会被拒绝。你无法将订阅指向 OneUptime 部署自身网络内部的地址。
- **Slack 传入 Webhook URL** 必须以 `https://hooks.slack.com/services/` 开头。

如果某个 Webhook 订阅在注册时被拒绝，首先要检查的就是内部地址或格式错误的 URL。

## 延伸阅读

- [状态页概览](/docs/status-pages/index) —— 状态页是什么，以及它是如何组合而成的。
- [状态页资源与分组](/docs/status-pages/resources-and-groups) —— 订阅者可以从中选择的监视器和分组。
- [状态页品牌与域名](/docs/status-pages/branding-and-domains) —— 自定义域名、徽标以及你邮件所链接页面的外观。
- [公共 API](/docs/status-pages/public-api) —— 以编程方式读取状态页数据。
- [事件状态与严重级别](/docs/incidents/states-and-severities) —— 什么让事件出现在状态页上，什么让它从页面上移除。
- [事件设置与自动化](/docs/incidents/settings) —— 支撑事件沟通的项目级规则。
