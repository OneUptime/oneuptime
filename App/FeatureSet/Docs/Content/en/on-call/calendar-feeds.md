# Calendar Feeds (On-Call Shifts in Google Calendar, Outlook and Apple Calendar)

Calendar Feeds put your on-call shifts into the calendar you already look at. OneUptime publishes a secret iCalendar (`.ics`) link for each person, each schedule and each project; Google Calendar, Outlook, Apple Calendar, Thunderbird and any other app that can subscribe to a calendar by URL polls that link and shows one event per shift. Nothing is installed and no account is connected: the link is the whole integration.

> **Note:** A subscribed calendar is for **planning**. Calendar apps re-fetch feeds on their own schedule — Google Calendar only every 8 to 24 hours — so a swap made an hour before a shift reaches you through OneUptime's own reminders, reassignment notices and pager notifications, not through the calendar.

## What you get

- One event per shift, titled `On-call · <Schedule>` (with ` · <Policy>` appended when the schedule is attached to exactly one escalation policy) in your personal feed and `<Name> · On-call · <Schedule>` in a shared feed. The description lists who is on call, the schedule and its time zone, the layer, the shift in the schedule's zone, in UTC and in your zone, which escalation policies page you through this schedule, and a link to the schedule in the dashboard.
- Overrides are honoured. When someone covers for you, the event moves to them (`(covering for <Name>)` is appended) and stays the same event in your calendar app, so it updates in place instead of duplicating. A partial override splits the shift into touching events.
- Two days of history and 90 days ahead by default. You can widen this to 60 days back and 180 days ahead; a feed that would exceed 5,000 events is shortened and says so in its calendar description.
- Events are marked free (`TRANSP:TRANSPARENT`), so a subscribed feed never blocks your availability, and nothing is marked private, so a shared team calendar shows titles to everyone who can see it.
- Times are sent in UTC and converted by your calendar app; the description spells out the wall-clock time in the schedule's zone and in yours. Set your own time zone under **User Settings** > **Profile** and the schedule's under its **Settings** tab. A schedule without a time zone is expanded in the server's zone, as paging is, and the event says so.

Standing assignments — a user or team named directly on an escalation policy rule — have no start or end and do not appear in any feed. On OneUptime Cloud, feeds follow the same plan as on-call schedules (Growth); a project below that plan gets an empty calendar rather than an error.

## Three kinds of link

| Link              | Who creates it                                                                    | What it contains                                                                                      | Where                                                    |
| ----------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Personal feed** | Each user, one per project                                                        | Your shifts on every schedule in that project, plus the shifts where you cover for someone (optional) | **User Settings** > **Calendar Feed**                    |
| **Schedule feed** | Anyone who can edit the schedule; anyone who can read it may copy the link        | Everyone's shifts on one schedule, with optional coverage-gap events                                  | The schedule's page, card **Subscribe to this schedule** |
| **Project feed**  | Anyone who can edit on-call schedules; anyone who can read them may copy the link | Everyone's shifts on every schedule in the project, with optional coverage-gap events                 | **On-Call Duty** > **Calendar Feeds**                    |

The links look like this:

```
https://<your host>/api/on-call-calendar/user/<token>/shifts.ics
https://<your host>/api/on-call-calendar/schedule/<token>/schedule.ics
https://<your host>/api/on-call-calendar/project/<token>/project.ics
```

The 43-character token in the path is the only credential — there is no login, cookie or API key involved. Treat every one of these links like a password.

## Your personal feed

1. Open **User Settings** > **Calendar Feed** in the project whose shifts you want. Personal feeds are per project: a second project gets a second link and a second calendar.
2. Click **Generate calendar link**. The card **Subscribe to your on-call shifts** now shows the `https://` link and three buttons:
   - **Google Calendar** opens Google Calendar with the link pre-filled.
   - **Apple / other apps** opens the `webcals://` form of the link, which macOS, iOS and most desktop apps hand straight to their subscribe dialog.
   - **Copy webcal link** copies that same `webcal(s)://` link — the one classic Outlook for Windows needs.
3. Subscribe in your calendar app using the per-app steps below.

Settings on the same card:

- **Include shifts I cover for others** (on by default) adds the shifts an override gives you on schedules you are not otherwise a member of.
- **Days of past shifts** (default 2, at most 60) and **Days ahead** (default 90, between 7 and 180).

The status line shows when the link was last fetched, by which calendar app, how many times, and the last four characters of the token so you can tell links apart. If nothing has fetched the link after two days, the page asks whether the server is reachable from the internet (see Troubleshooting).

The page also lists your **Upcoming shifts** (the next 30 days), each with a **Get cover** link that opens User Overrides pre-filled for that shift, and the **Remind me before shifts** card described further down.

Actions:

- **Regenerate link** mints a new token. Every app subscribed to the old link stops updating: for 30 days the old link serves an empty calendar so those apps clear their copy, after that it returns 404. Re-subscribe with the new link.
- **Disable** keeps the link but serves an empty calendar until you enable it again.
- **Delete** removes the link. Apps that still poll it get 404 and keep showing whatever they last fetched — disable first if you want them to empty out.

The same personal link, filtered to one schedule with `?schedule=<id>`, is offered as **Only my shifts on this schedule** on every schedule's page, and the on-call banner and the **My On-Call Policies** page carry an **Add your shifts to your calendar** link to the page above.

In the mobile app: **On-Call** > **Add shifts to my calendar** (also under **Settings** > **Calendar feed**), with one link per project. On iPhone, **Open in Calendar** opens the native subscribe sheet. On Android there is no way to subscribe to a URL on the phone, so the screen offers **Share link** and **Copy https link** and tells you to add the link on a computer, after which it syncs to the phone. The app's **Your shifts** list comes from the same data and has the same **Get cover** action.

## Subscribe in your calendar app

Use the `https://` link unless the app asks for `webcal`; the scheme section below explains the difference.

### Google Calendar (web)

1. In Google Calendar on the web, next to **Other calendars** click **+** > **From URL**.
2. Paste the `https://` link and click **Add calendar**. The **Google Calendar** button in OneUptime does the same with the link pre-filled.

Google fetches the feed **from Google's servers**, roughly every 8 to 24 hours and sometimes longer. There is no refresh button for subscribed calendars, and Google ignores the refresh hints in the feed. The calendar's name and time zone are read **only when you first subscribe**: renaming a schedule later does not rename the calendar in Google — remove and re-add it if the name matters. Google drops reminders carried in calendar files, so set default notifications on that calendar in Google's settings, or better, use OneUptime's own reminders. If Google reports that it could not fetch the URL, make sure you pasted the `https://` form rather than `webcal://`, and append `?nocache=1` to make it look again (OneUptime ignores unknown query parameters, so the feed itself is unchanged). The Google Calendar app on Android and iOS cannot subscribe by URL; add the link on a computer and it appears on the phone.

### Outlook on the web and Outlook.com

1. Open **Calendar** > **Add calendar** > **Subscribe from web**.
2. Paste the `https://` link, give the calendar a name and click **Import**.

Outlook fetches **from Microsoft's servers**: about every 3 hours for Outlook.com and every 4 to 6 hours for work and school accounts, sometimes more than a day. The interval is fixed and there is no manual refresh. Subscribe here rather than in the desktop app if you want the calendar on your phone and in Outlook on the web as well — subscriptions created in classic Outlook for Windows stay on that PC. The new Outlook for Windows and Outlook for Mac use the same **Add calendar** > **Subscribe from web** dialog.

### Classic Outlook for Windows

1. In OneUptime click **Copy webcal link**.
2. In Outlook, open **File** > **Account Settings** > **Account Settings** > **Internet Calendars** > **New**, paste the `webcals://` link and click **Add**. Opening a `webcal` link in a browser also works on a PC where Outlook is installed; Windows has no `webcal` handler otherwise.

Do **not** open the `https://…/shifts.ics` link itself in classic Outlook: it imports a one-time snapshot that never updates. Only `webcal://` and `webcals://` create a subscription.

The feed is refreshed on **Send/Receive** (F9, or the interval under Send/Receive Groups). The subscription's settings have an **Update Limit** checkbox: with it checked, Outlook refreshes no faster than the interval the publisher suggests. OneUptime suggests one hour (`X-PUBLISHED-TTL:PT1H`), so the feed refreshes about hourly. Feeds without that hint never refresh while the box is checked; OneUptime's carry it, so you can leave the box on. Classic Outlook fetches the feed **from your PC** and validates the server's certificate.

### Apple Calendar on macOS

1. Click **Apple / other apps** in OneUptime, or in Calendar choose **File** > **New Calendar Subscription** and paste the link.
2. In the subscribe sheet set **Auto-refresh** — every 5 minutes, 15 minutes, hour, day or week (hourly is the default) — and choose **iCloud** under **Location** so the calendar also appears on your iPhone and iPad and keeps refreshing on that schedule.

macOS fetches the feed **from your Mac**, so it works for an install on a private network as long as the Mac can reach it. A self-signed or internal-CA certificate must be trusted in the macOS keychain first. **Remove alerts** is checked by default in that sheet; it makes no difference here because the feed carries no alarms.

### iPhone and iPad

Subscriptions created on the device itself refresh according to **Settings** > **Calendar** > **Accounts** > **Fetch New Data** — **Automatically** by default, which mostly fetches while charging on Wi-Fi. For a dependable refresh, subscribe on a Mac with **iCloud** as the location, or set **Fetch New Data** to a fixed interval. To subscribe on the device, tap **Open in Calendar** in the OneUptime mobile app, or go to **Settings** > **Calendar** > **Accounts** > **Add Account** > **Other** > **Add Subscribed Calendar** and paste the link.

### Thunderbird

Choose **File** > **New** > **Calendar** > **On the Network** > **iCalendar (ICS)**, paste the `https://` link and pick a refresh interval in the calendar's properties: 1, 5, 15, 30 or 60 minutes. Thunderbird fetches **from your computer** and must trust the server's certificate.

### Fastmail, Proton and other services

Fastmail refreshes roughly hourly and **disables a subscription after five consecutive failed fetches**; if that happens, re-add it once the server is healthy. Proton Calendar refreshes every 4 to 16 hours and rejects very large feeds — reduce **Days ahead** if it complains. Confluence Team Calendars accepts the schedule feed; its 28-character limit on calendar names is respected.

### Android

Neither the Google Calendar app nor Samsung Calendar can subscribe to a URL. Add the `https://` link to Google Calendar on a computer (**Other calendars** > **+** > **From URL**); the calendar then syncs to the phone with everything else in that Google account. The OneUptime mobile app on Android offers **Share link** and **Copy https link** for exactly this.

## How often calendars refresh

| Calendar app                      | Typical refresh                                     | Fetches from        | Notes                                                                                     |
| --------------------------------- | --------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| Google Calendar (From URL)        | 8–24 hours, sometimes longer                        | Google's servers    | No manual refresh; ignores refresh hints; name and time zone read at first subscribe only |
| Outlook.com                       | About 3 hours                                       | Microsoft's servers | Fixed; can exceed 24 hours                                                                |
| Outlook on the web (work, school) | About 4–6 hours                                     | Microsoft's servers | Fixed; no user control                                                                    |
| Classic Outlook for Windows       | On Send/Receive; about hourly with **Update Limit** | Your PC             | Needs a `webcal` link; does not sync to phone or web                                      |
| Apple Calendar (macOS)            | 5 minutes to weekly, default hourly                 | Your Mac            | Store in iCloud to reach iPhone and iPad                                                  |
| Apple Calendar (iOS only)         | Per **Fetch New Data**, battery-gated               | Your phone          | Subscribe on a Mac for reliability                                                        |
| Thunderbird                       | 1–60 minutes                                        | Your computer       |                                                                                           |
| Fastmail                          | About hourly                                        | Fastmail's servers  | Disabled after five failed fetches                                                        |
| Proton Calendar                   | 4–16 hours                                          | Proton's servers    | Rejects large feeds                                                                       |

OneUptime itself serves fresh data: an edit to a layer, a rotation, an override or a policy attachment invalidates the feed at once, and responses are cached for at most five minutes. The wait you see is the calendar app's, not the server's. OneUptime suggests hourly refresh through `REFRESH-INTERVAL` and `X-PUBLISHED-TTL`; only classic Outlook takes the hint, and only with **Update Limit** on — Apple Calendar, Thunderbird and the rest refresh at the interval you set per calendar.

## https, webcal and webcals

All three point at the same feed. `webcal://` and `webcals://` are the `http://` and `https://` link with the scheme renamed, so that the operating system opens a calendar app instead of a browser; `webcals` is the encrypted one and is what OneUptime offers when `HTTP_PROTOCOL` is `https`.

- Google Calendar, Outlook on the web, Thunderbird and Fastmail want the `https://` form.
- Apple Calendar and classic Outlook for Windows subscribe from a `webcal(s)://` link; in classic Outlook the `https://` form is a one-time import.
- `webcal://` without the `s` is unencrypted and sends the token in clear text on every fetch. If your install still runs on plain `http`, the dashboard shows a warning next to the link; switch to `https` before sharing links widely.

## Reminders and reassignment notices

Calendar apps do not deliver alarms from subscribed feeds — Google drops them, Apple strips them by default, Outlook flattens them — so OneUptime sends its own.

On **User Settings** > **Calendar Feed**, the card **Remind me before shifts** lets you pick lead times: **1 week**, **1 day**, **1 hour**, **15 min** or a custom value between 15 minutes and 14 days, several at once. Each reminder is sent once per shift through the delivery methods you chose for **Before my on-call shift starts** on **User Settings** > **Notification Settings** (On-Call tab; email and push are on by default). The message names the schedule, the policies it pages through and the start time in your time zone.

- A shift that lands inside one of your lead times because of a late override — someone hands you a shift 20 minutes before it starts — gets a single catch-up reminder straight away.
- If a shift you were reminded about is handed to someone else, you get **My upcoming on-call shift is reassigned**, a separate event type so it can be silenced on its own.
- Reminders are never sent after a shift has started, and never for schedules that are not attached to any escalation policy, because those cannot page anyone.
- On WhatsApp a reminder arrives on Meta's pre-approved on-call template, which names the schedule and the escalation policy and links to the schedule but does not carry the start time, and which WhatsApp only ships in English. Reassignment notices have no approved WhatsApp template, so they reach you on your other channels instead.

## Shared links for a schedule or a project

A shared link belongs to the **project**, not to whoever copied it, and it shows people's names, never their email addresses.

**Schedule feed.** On a schedule's page the card **Subscribe to this schedule** has two halves: **Only my shifts on this schedule** (your personal link with a schedule filter) and **Everyone's shifts on this schedule (shared team link)**. Anyone with **Edit** permission on schedules can **Publish shared link**, **Regenerate** it or **Disable** it; anyone who can read the schedule can copy it. The card shows when the link was last rotated.

**Project feed.** **On-Call Duty** > **Calendar Feeds** holds the card **Everyone's shifts in this project (shared link)** — one shared link covering every schedule in the project — with the same publish, regenerate and disable actions, and a link to your personal feed page.

Settings on both:

- **Show coverage gaps** (off by default) adds a `No coverage · <Schedule>` event wherever a layer is _meant_ to cover but nobody is on call: an empty layer, a layer whose start date is in the future, layers that do not line up, or any hole in a 24×7 schedule. Off-hours of a business-hours schedule are never reported. **Minimum gap to show (minutes)** (default 60) hides shorter holes; at most 100 gap events are emitted, oldest first.
- **Regenerate when someone leaves the project** (off by default) regenerates the link automatically when someone leaves their last team in the project, so a former colleague's calendar stops updating. Everyone else must re-subscribe afterwards, which is why it is opt-in.
- **Days of past shifts** and **Days ahead**, as on the personal feed.

Put the schedule link into a shared team calendar — Google, Outlook or Confluence — and one subscription serves the whole team. Rotate it when someone who had it leaves, or turn on the automatic rotation above.

When a person leaves their last team in a project, OneUptime also removes them from that project's schedule layers and escalation rules, deletes the project's active and future overrides that name them (as the overridden person or as the substitute), disables their personal feed for the project and deletes their reminders there.

## Events in detail

- Every shift has a stable identity made from the schedule and the shift's start, so the same shift is the same event in your personal feed, in the schedule feed and after you regenerate a link. Calendar apps update it in place; a change bumps the event's sequence number.
- An override that swaps the whole shift keeps the event and changes the person; an override covering part of a shift produces three touching events, for example A 09:00–12:00, B 12:00–13:00, A 13:00–17:00.
- When a schedule is attached to two or more escalation policies and an override applies to only one of them, the people paged differ per policy. The feed shows this instead of hiding it: the shift keeps its event for the person paged by the other policies, with a note naming the policy that pages someone else, and the substitute gets an extra event titled `On-call · <Schedule> · <Policy> (covering for <Name>)`.
- Shifts in the past carry the line "Past shifts reflect the current rotation, not who was actually paged" in their description.
- A schedule that is not attached to any escalation policy is still shown, with a note that it will not page anyone.

## Planning, not audit

The feed shows the rotation **as it is configured now**, including for past days: an override entered afterwards rewrites history in the calendar. For hours actually spent on call, fairness reviews and compensation, use **On-Call Duty** > **Reports** > **User On Call Time**, which is written from what the pager actually did.

## Security

- The token in the link is the only credential. Anyone who has the link sees the shifts — names, schedules, policies — until it is regenerated. Do not paste links into chat rooms or tickets; when a team needs a calendar, share the schedule or project link rather than your personal one.
- Links are per project. A leaked personal link exposes one project's shifts, not every project you belong to.
- **Regenerate** moves the old token into a 30-day grace period (empty calendar, then 404). **Disable** serves an empty calendar. An unknown or expired link returns a plain 404 with no hint. Empty calendars make subscribed apps clear their copy; a 404 makes them keep it, which is why disabling and regenerating serve empty calendars.
- Tokens are stored hashed; the copy shown on the settings page is encrypted with `ENCRYPTION_SECRET`. Set that variable to a real secret on a self-hosted install — the server warns at start-up when it is unset or still one of the placeholders this repository ships (`secret`, or the `please-change-this-to-random-value` that `config.example.env` sets). If you change it later, the page offers **Regenerate link** because the stored copy can no longer be read; the feed keeps working until you do.
- Feed responses are marked `Cache-Control: private`, are excluded from search engines (`X-Robots-Tag: noindex`) and are rate limited per link and per client address.
- OneUptime's own Nginx keeps feed requests out of its logs:

  ```
  location ~ ^/api/on-call-calendar/(user|schedule|project)/ {
      access_log off;
      error_log /dev/null crit;
      proxy_max_temp_file_size 0;
      ...
  }
  ```

  so a token never lands in a log file next to a client address; the application never logs it either. `access_log off` drops the per-request line, `error_log` drops the lines Nginx writes when an upstream fetch fails — without it every client polling during a restart has its token recorded — and `proxy_max_temp_file_size 0` keeps a large feed out of a temporary file. **Any proxy, WAF or CDN you run in front of OneUptime still logs the full URI, in its access log and in its error log,** unless you configure it not to — check that before rolling feeds out.

## Self-hosted configuration

Nothing needs to be switched on: feeds work on every install. Four environment variables control them, set in `config.env` for Docker Compose or under `onCallCalendarFeed` in the Helm values (see the chart's [configuration reference](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#on-call-calendar-feeds)):

| Variable                                                | Helm value                                       | Default | Effect                                                                                                                                               |
| ------------------------------------------------------- | ------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISABLE_ON_CALL_CALENDAR_FEED`                         | `onCallCalendarFeed.disabled`                    | `false` | Kill switch. Every feed URL answers `503` with `Retry-After: 3600`; subscribed apps keep the copy they have and try again later. Nothing is deleted. |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS`       | `onCallCalendarFeed.rateLimit.windowSeconds`     | `60`    | Length of the rate-limit window.                                                                                                                     |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW` | `onCallCalendarFeed.rateLimit.perTokenPerWindow` | `60`    | Fetches one link may make from one client address per window.                                                                                        |
| `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW`    | `onCallCalendarFeed.rateLimit.perIpPerWindow`    | `3000`  | Fetches one client address may make across all links per window — the ceiling for a whole office behind one address.                                 |

Also relevant:

- **`HOST` and `HTTP_PROTOCOL`** build the links. If `HOST` is empty or `localhost`, or `HTTP_PROTOCOL` is `http`, the feed page shows a warning and the links will not work from outside.
- **`TRUSTED_PROXY_HOPS`** decides which address the per-address limit counts. The default `1` is right for the stock Docker Compose and Helm layouts; add one for every proxy of your own — a CDN, WAF or load balancer — that appends to `X-Forwarded-For`, otherwise every calendar client looks like the same address and shares one budget. See [Trusted proxies](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/configuration.md#trusted-proxies) in the chart documentation.
- **Redis** backs the caches and the rate limiter. Both degrade gracefully: without Redis, feeds still render, only more slowly, and the limiter lets requests through.
- In the Helm chart's split mode (`worker.enabled: true`) feeds render on the API tier, so size that tier for a burst of calendar clients polling at the top of the hour.
- The Nginx access-log exemption shown above is part of the shipped `Nginx/default.conf.template`; keep it if you customise the template.

## Troubleshooting

**Nothing has fetched the link, or "Could not fetch the URL".** Google Calendar, Outlook on the web, Fastmail and Proton fetch **from their own servers**, so the OneUptime host must be reachable from the public internet with a certificate they trust. An install on a private network, behind a VPN, or with an internal certificate authority is unreachable to them no matter what you paste. Apple Calendar, Thunderbird and classic Outlook fetch from the device, so they work wherever the device can open the dashboard — after trusting the certificate on that device if it is self-signed. The feed page's status line tells you whether anything has fetched the link yet; `curl -I` against the link from outside your network is the quickest check. Letting OneUptime _reach_ private networks — [Private Network Access](/docs/self-hosted/private-network-access) — is a different matter and does not help here.

**The calendar is stale.** First read the refresh table: for Google the delay is normal. To make Google look again, remove and re-add the calendar or append `?nocache=1` to the link (unknown parameters are ignored, so the feed is unchanged but Google treats it as new). In classic Outlook press F9 and check the **Update Limit** setting. In Apple Calendar use **View** > **Refresh Calendars**. If a same-day change matters, rely on OneUptime's reminders and reassignment notices rather than on the calendar.

**The calendar is empty.** An empty calendar is deliberate. It means the link is disabled, is an old link inside its 30-day grace period after a regenerate, the project is below the plan that includes on-call schedules, or you are no longer on any schedule in that project. Open the link in a browser: the calendar description (`X-WR-CALDESC`) states the reason.

**404.** The link is unknown, has been deleted, or its grace period has ended. Generate a new one and re-subscribe.

**503.** Either `DISABLE_ON_CALL_CALENDAR_FEED` is set, or the server is busy: at most a few feeds are rendered at once, and a schedule that takes very long to expand is cut short. When a previous copy of the feed exists the server serves that instead, with a `Warning: 110` header, so a 503 means there was nothing to fall back to. Clients keep their last copy and retry after the `Retry-After` interval. Fastmail disables a subscription after five failures in a row; re-add it once the server is healthy. The `oncall_calendar_render_duration_ms` metric shows operators which feeds are slow.

**429 or "too many requests".** Many clients behind one address — an office NAT, a VPN gateway — share the per-address budget. Raise `ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW`, and check `TRUSTED_PROXY_HOPS`: when it is too low every client is attributed to your own proxy and they all share one budget.

**Certificate errors in Apple Calendar, Thunderbird or Outlook.** These apps validate TLS on the device. Import your internal CA into the device's trust store — the macOS keychain, the Windows certificate store, Thunderbird's certificate manager — or use a publicly trusted certificate. Server-side fetchers such as Google and Microsoft cannot be made to trust a private CA.

**Times are wrong.** All times in the file are UTC; the calendar app converts to its own zone. If shifts look shifted by a fixed offset, check the schedule's time zone (its **Settings** tab) and your own (**User Settings** > **Profile**). A schedule without a time zone is expanded in the server's zone and the event says so.

**The feed says it was shortened.** More than 5,000 events fell inside the window. Reduce **Days ahead**, or subscribe to **Only my shifts on this schedule** instead of a whole project.

**Google shows an old calendar name.** Google reads the name only at first subscribe; remove and re-add the calendar.

**The settings page says the link needs regenerating.** `ENCRYPTION_SECRET` changed since the link was created, so the server can no longer show it. The existing subscription keeps working; regenerating gives you a link you can copy again and retires the old one after 30 days.

**A shift is missing from my feed.** Only schedule shifts appear; direct user or team assignments on a policy rule are standing and have no events. A shift taken over by someone else through an override leaves your feed because it is now in theirs. Turn on **Include shifts I cover for others** to see shifts you gained through overrides on schedules you are not a member of.
