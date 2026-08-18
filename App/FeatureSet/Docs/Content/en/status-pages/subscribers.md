# Subscribers & Announcements

A status page is a place people go. Subscribers are the people who would rather not have to — they hand you an email address, a phone number, a Slack webhook or an HTTP endpoint once, and after that your updates come to them.

Announcements are the other half of the same job. A monitor can tell your visitors that checkout is returning 500s; no monitor can tell them that you are migrating databases on Saturday, that a third-party provider is having a bad day, or that the incident they read about yesterday is fully closed out. Announcements are the free-text channel for everything your checks cannot see, and they fan out to the same subscriber list.

This page covers both: the five subscription channels and how visitors sign up, what subscribers can choose to hear about, the double opt-in and unsubscribe flows, and how announcements are written, scheduled and templated.

## Subscription channels

A status page supports five channels, each with its own toggle on the status page. Go to **Status Pages → your page → Subscribers → Subscriber Settings**:

- **Enable Email Subscribers** (`enableEmailSubscribers`) — on by default. Everything else is off until you turn it on.
- **Enable SMS Subscribers** (`enableSmsSubscribers`) — off by default.
- **Enable Slack Subscribers** (`enableSlackSubscribers`) — off by default.
- **Enable Microsoft Teams Subscribers** (`enableMicrosoftTeamsSubscribers`) — off by default.
- **Enable Webhook Subscribers** (`enableWebhookSubscribers`) — off by default.

Each channel also gets its own list in the status page side menu under **Subscribers**: **Email Subscribers**, **SMS Subscribers**, **Slack Subscribers**, **MS Teams Subscribers** and **Webhook Subscribers**. That is where you look at who is signed up, add someone by hand, or leave yourself a **Notes** (`internalNote`) entry on a particular subscriber.

**One toggle is not enough.** The **Subscribe** item in the status page nav bar only appears when **Show Subscriber Page** (`showSubscriberPageOnStatusPage`) is on *and* at least one channel is enabled. If you turn on **Enable Email Subscribers** but leave **Show Subscriber Page** off, visitors have no way to reach the form.

The same five toggles appear a second time inside the **Subscriber Settings** card on **Advanced Settings**, alongside **Show Subscriber Page**. They are the same columns underneath — pick one screen and stay on it, and prefer the dedicated **Subscriber Settings** page since that is where the rest of the subscriber configuration lives.

## What a visitor sees on the Subscribe page

The **Subscribe** page has a sub-menu with one tab per enabled channel — **Email**, **SMS**, **Slack**, **MS Teams**, **Webhooks** — mapped to `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams` and `/subscribe/webhooks`. Each tab asks for the minimum it needs:

- **Email** — heading **Subscribe by Email**, one field **Your Email** with the placeholder `subscriber@company.com`.
- **SMS** — heading **Subscribe by SMS**, one field **Your Phone Number** with the placeholder `+11234567890`.
- **Slack** — heading **Subscribe by Slack**, with **Slack Workspace Name** (used for validation) and **Slack Incoming Webhook URL**, placeholder `https://hooks.slack.com/services/...`.
- **MS Teams** — heading **Subscribe by Microsoft Teams**, with **Microsoft Teams Workspace Name** and **Microsoft Teams Incoming Webhook URL**, placeholder `https://outlook.office.com/webhook/...`.
- **Webhooks** — heading **Subscribe by Webhook**, one field **Webhook URL**. A JSON `POST` request is sent to it on each status page event.

The submit button reads **Subscribe**, and a successful signup shows *You have been subscribed successfully.* The page also carries a **New Subscription** / **Manage Existing Subscription** split, so someone who already subscribed can get back to their preferences without hunting for an old email.

## Letting subscribers choose resources and event types

By default a subscriber gets everything on the page. Two toggles in the **Advanced Subscriber Settings** card change that:

- **Allow Subscribers to Choose Resources** (`allowSubscribersToChooseResources`) — off by default. Turn it on and the subscribe form grows a **Subscribe to All Resources** toggle; clear it and **Select Resources to Subscribe** appears so the visitor can pick individual resources.
- **Allow Subscribers to Choose Event Types** (`allowSubscribersToChooseEventTypes`) — off by default. Same shape: a **Subscribe to All Event Types** toggle, and **Select Event Types to Subscribe** underneath when it is cleared.

The event types are `Incident`, `Announcement` and `Scheduled Event`.

The choices land on the subscriber record as **Is Subscribed to All Resources** (`isSubscribedToAllResources`, default true), **Is Subscribed to All Event Types** (`isSubscribedToAllEventTypes`, default true), **Subscribed to Resources** and **Subscribed to Event Types**.

Good for: a page that covers several products. A customer who only uses your API does not want a page every time the marketing site wobbles — let them narrow the list themselves rather than watching them unsubscribe entirely.

The same card also carries **Subscriber Timezones**.

## Email double opt-in

Email subscribers always confirm. When a subscriber is created with an email address and was not created already-confirmed, **Is Subscription Confirmed** (`isSubscriptionConfirmed`) is forced to `false` and a six-digit **Subscription Confirmation Token** is generated. OneUptime then emails a confirmation link shaped like `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`. The visitor lands on a **Confirm Subscription** page and, once it goes through, sees *Subscription confirmed successfully*.

SMS, Slack, Microsoft Teams and webhook subscribers skip this — they are created with `isSubscriptionConfirmed` already set to `true`.

**Unconfirmed means silent.** The query that fetches subscribers for a notification filters on `isUnsubscribed: false` and `isSubscriptionConfirmed: true`. An email address that never clicked the link will sit in your **Email Subscribers** list and receive nothing. If someone swears they are subscribed but hears nothing, check that column first.

There is no toggle to turn email confirmation off — it is unconditional for anyone who signs up through the status page. A separate per-subscriber column, **Send You Have Subscribed Message** (`sendYouHaveSubscribedMessage`, default true), controls the "you have subscribed" email that goes out once a subscriber is confirmed.

## Managing and canceling a subscription

Every subscriber email carries an unsubscribe link of the form `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`. That page is titled **Update Subscription** and tells the visitor they can update their preferences or unsubscribe there. It holds:

- Whatever resource and event-type pickers the page allows.
- An **Unsubscribe** toggle, described as unsubscribing from all resources. It writes **Is Unsubscribed** (`isUnsubscribed`, default false).
- A submit button reading **Update Subscription**; saving shows *Your changes have been saved.*

Someone who lost the link uses **Manage Existing Subscription** on the **Subscribe** page and presses **Send Management Link**. OneUptime replies that an email with the link has been sent and to check the spam folder if it does not arrive.

The endpoints behind all of this are `POST .../subscribe/:statusPageId`, `POST .../manage-subscription/:statusPageId`, `POST .../get-subscription/:statusPageId/:subscriberId` and `PUT .../update-subscription/:statusPageId/:subscriberId`.

Unsubscribing flips a flag rather than deleting a row, so the record stays in the channel list with **Is Unsubscribed** set — useful when you need to explain later why a particular address stopped receiving mail.

## What subscribers get notified about

Subscribers hear about the three event types above, but each source has its own switch, so nothing is sent by accident.

### Announcement notifications

The announcement itself carries **Should subscribers be notified?** (`shouldStatusPageSubscribersBeNotified`), exposed on the create form as the **Notify Status Page Subscribers** checkbox and on by default. If the announcement names monitors under **Monitors affected (Optional)**, the notification is scoped to those monitors; leave it empty and all subscribers are notified.

### Scheduled maintenance events

A scheduled maintenance event has its own set of subscriber columns: **Should subscribers be notified when event is created?**, **Should subscribers be notified when event is changed to ongoing?**, **Should subscribers be notified when event is changed to ended?**, plus **Subscriber notifications before the event** and **Next subscriber notification before the event at?** for advance warnings. **Status Pages** on the event decides which pages it appears on, and **Should be visible on status page?** decides whether it appears at all.

### Incidents

`Incident` is the third event type. What makes an incident reach a status page in the first place — which resources it touches and which states keep it visible — is covered in [Incident States & Severities](/docs/incidents/states-and-severities).

The **Notification Logs** section in the status page side menu (`{id}/notification-logs`) is where you go when you need to see what the page actually sent.

## Customizing notification templates

The **Notification Templates** card on **Subscriber Settings** lists the templates this status page uses, with columns **Template Name**, **Event Type** and **Notification Method** — so you can vary the wording per event type and per channel rather than accepting one house message for everything.

Project-wide templates live one level up, at **Status Pages → Settings → Subscriber Templates**, next to **Announcement Templates**.

## Email footer, custom SMTP and Twilio

Three more cards on **Subscriber Settings** control how subscriber messages leave your project:

- **Email Footer Settings** — **Enable Custom Email Footer Text** and **Subscriber Email Notification Footer Text** put your own footer on subscriber emails.
- **Custom SMTP** — **Custom SMTP Config** sends subscriber email through your own mail server instead of the default.
- **Twilio Config** — **Twilio Config** is the Twilio account used for SMS subscribers.

Custom SMTP is worth doing early if you have email subscribers: mail that comes from your own domain is far less likely to be filtered, and far more likely to be trusted by the customer reading it at 2am.

## Announcements

An announcement is a project-level record (the `StatusPageAnnouncement` model) that you fan out to one or more status pages, optionally scoped to specific monitors, with a window during which it is shown.

You create one from **Status Pages → More → Announcements**, or from **Announcements** in an individual status page's side menu. The create form is a four-step wizard:

1. **Basic Information** — **Announcement Title** (required, at least two characters), **Description** (Markdown, optional) and **Attachments** for files that should be available with the announcement on the status page.
2. **Status Pages** — **Show announcement on these status pages**, a required multi-select. One announcement can target several pages at once.
3. **Resources Affected** — **Monitors affected (Optional)**. If you select none, all subscribers are notified.
4. **Schedule & Settings** — **Start Showing Announcement At** (required, defaults to now), **End Showing Announcement At** (optional) and **Notify Status Page Subscribers** (on by default).

Visitors read announcements at `/announcements`, split into **Active Announcements** and **Past Announcements**, each stamped with **Announced at**. Currently live announcements are also pinned to the top of the overview page. When there is nothing to show, the page reads *No Announcement* with the note that none have been posted so far.

Attachments are served from `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId`, behind the same read check as the status page itself — so an attachment on a private page stays private.

## How announcement scheduling works

**Show At** (`showAnnouncementAt`) and **End At** (`endAnnouncementAt`) drive everything, but the overview page and the announcements list ask different questions, and the difference trips people up.

- **The overview page** shows an announcement when `showAnnouncementAt` is in the past and `endAnnouncementAt` is either in the future or empty.
- **The `/announcements` list** shows announcements whose `showAnnouncementAt` falls within **Show Announcement History (in days)** (`showAnnouncementHistoryInDays`, default 14), then splits them client-side into active and past.

Two consequences worth planning around:

- **An announcement with no end date never expires.** Leave **End Showing Announcement At** empty and it stays pinned to the overview page indefinitely. Set an end date on anything time-bound.
- **An old but still-active announcement can vanish from the list.** If it started more than `showAnnouncementHistoryInDays` ago it drops off `/announcements` while remaining on the overview. Raise the history window if you keep long-running notices.

Whether announcements appear at all is controlled by the **Announcement Settings** card on **Advanced Settings**: **Show Announcements** (`showAnnouncementsOnStatusPage`, default true) and **Show Announcement History (in days)** (default 14). With **Show Announcements** off, the announcements endpoint refuses the request outright.

## Announcement templates

If you post the same kind of notice repeatedly — a monthly maintenance heads-up, a recurring third-party degradation — pre-can it. **Status Pages → Settings → Announcement Templates** stores the `StatusPageAnnouncementTemplate` model, and its form asks for **Template Name**, **Template Description**, **Announcement Title**, **Description**, **Show announcement on these status pages**, **Monitors affected (Optional)** and **Notify Subscribers**, so the fan-out and the notify decision are made once instead of every time.

## Webhook subscribers and SSRF protection

Webhook subscribers receive a JSON `POST` request on each status page event, which makes them the easiest way to pipe status page updates into a system of your own — a chatbot, an internal dashboard, a ticketing queue.

Because subscribing is a public operation on a public page, OneUptime guards the target:

- A generic **Webhook URL** is validated before it is accepted, and private, loopback, link-local and cloud-metadata addresses are rejected. You cannot point a subscription at something inside the OneUptime deployment's own network.
- A **Slack Incoming Webhook URL** must start with `https://hooks.slack.com/services/`.

If a webhook subscription is rejected at signup, an internal or malformed URL is the first thing to check.

## Where to read next

- [Status Pages Overview](/docs/status-pages/index) — what a status page is and how it is put together.
- [Status Page Resources & Groups](/docs/status-pages/resources-and-groups) — the monitors and groups subscribers can choose between.
- [Status Page Branding & Domains](/docs/status-pages/branding-and-domains) — custom domains, logos and the look of the page your emails link to.
- [Public API](/docs/status-pages/public-api) — reading status page data programmatically.
- [Incident States & Severities](/docs/incidents/states-and-severities) — what puts an incident on a status page and what takes it off.
- [Incident Settings & Automation](/docs/incidents/settings) — the project-level rules behind incident communication.
