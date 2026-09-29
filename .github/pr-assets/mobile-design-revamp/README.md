# Mobile design revamp

Captures of the real Expo / React Native Web build with synthetic fixtures at
390 × 844. "Before" images are the previously committed review screenshots.
These are browser captures; on iOS and Android the previous build additionally
lost the styling of every `Pressable` drawn with a style callback (rows, chips,
response buttons, the project switcher), which web never showed.

## Light

| Screen | Before | After |
| --- | --- | --- |
| Home | <img src="before-home.png" width="260" alt="Previous Home"> | <img src="after-home.png" width="260" alt="Home with count tiles, on-call card and grouped health rows"> |
| Inbox | <img src="before-incidents.png" width="260" alt="Previous Inbox"> | <img src="after-incidents.png" width="260" alt="Inbox with category tabs, incidents/episodes switch and status-first cards"> |
| Incident | <img src="before-incident-detail.png" width="260" alt="Previous incident detail"> | <img src="after-incident-detail.png" width="260" alt="Incident with status pills, next-step card and content cards"> |
| Monitors | <img src="before-monitors.png" width="260" alt="Previous Monitors"> | <img src="after-monitors.png" width="260" alt="Monitors with health tiles, filter chips and cards"> |
| On-Call | <img src="before-on-call.png" width="260" alt="Previous On-Call"> | <img src="after-on-call.png" width="260" alt="On-Call hero card, quick actions and grouped rows"> |
| Calendar sync | <img src="before-oncall-calendar.png" width="260" alt="Previous calendar sync page"> | <img src="after-oncall-calendar.png" width="260" alt="Calendar sync status and private link cards"> |
| Settings | <img src="before-settings.png" width="260" alt="Previous Settings"> | <img src="after-settings.png" width="260" alt="Settings with account card and Appearance picker"> |
| Sign in | <img src="before-login.png" width="260" alt="Previous sign in"> | <img src="after-login.png" width="260" alt="Sign in with labelled fields and connected server card"> |

## Dark

| Home | Inbox | Incident |
| --- | --- | --- |
| <img src="dark-home.png" width="240" alt="Home in dark mode"> | <img src="dark-inbox.png" width="240" alt="Inbox in dark mode"> | <img src="dark-incident-detail.png" width="240" alt="Incident detail in dark mode"> |

| On-Call | Monitors | Settings |
| --- | --- | --- |
| <img src="dark-on-call.png" width="240" alt="On-Call in dark mode"> | <img src="dark-monitors.png" width="240" alt="Monitors in dark mode"> | <img src="dark-settings.png" width="240" alt="Settings in dark mode"> |

The complete set for all four test viewports is regenerated in
[`packages/MobileApp/docs/screenshots`](../../../packages/MobileApp/docs/screenshots) by
`UPDATE_SCREENSHOTS=1 npm run test-ui`.
