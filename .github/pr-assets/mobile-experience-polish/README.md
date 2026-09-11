# Mobile experience polish

Screenshots of the actual Expo / React Native Web app with synthetic account,
project and operational data. These are browser viewport captures, not native
iOS or Android screenshots. Before images are the previously committed design
references; after images come from this change's Playwright journeys.

## Home

| Before | After |
| --- | --- |
| <img src="before-iphone-size-home.png" width="300" alt="Previous Home overview"> | <img src="iphone-size-home.png" width="300" alt="Home with prominent incident and alert tiles"> |

## Inbox

| Before | After |
| --- | --- |
| <img src="before-iphone-size-incidents.png" width="300" alt="Previous Inbox"> | <img src="iphone-size-incidents.png" width="300" alt="Inbox with shorter heading, readable filters and matching totals"> |

## Main flows

| Monitor health | Incident response | Sign in |
| --- | --- | --- |
| <img src="iphone-size-monitors.png" width="240" alt="Grouped monitor summary and filter controls"> | <img src="iphone-size-incident-detail.png" width="240" alt="Incident details and response actions"> | <img src="iphone-size-login.png" width="240" alt="Sign-in form and recovery options"> |

| Coverage review | Note composer | Settings |
| --- | --- | --- |
| <img src="iphone-size-oncall-coverage-review.png" width="240" alt="Coverage confirmation"> | <img src="iphone-size-add-note.png" width="240" alt="Add note form"> | <img src="iphone-size-settings.png" width="240" alt="Account and workspace settings"> |

## Small phones and error recovery

| 320-point Home | Filter and reset | Teammate retry |
| --- | --- | --- |
| <img src="small-phone-home.png" width="240" alt="Home at the smallest supported test width"> | <img src="small-phone-incidents-filtered.png" width="240" alt="Active filter, matching count and reset at 320 pixels"> | <img src="small-phone-oncall-teammates-retry.png" width="240" alt="Teammate directory failure with a visible retry action"> |

[Incident state recovery](iphone-size-incidents-state-retry.png) shows how a
failed metadata request is distinguished from an empty response queue.

## Larger screens

- Android-size: [on-call overview](android-size-oncall-overview.png),
  [coverage review](android-size-oncall-coverage-review.png).
- Tablet: [Home](tablet-home.png), [monitors](tablet-monitors.png),
  [Settings](tablet-settings.png).

Viewports: small phone 320 × 740, iPhone-size 390 × 844, Android-size 412 × 915,
tablet 768 × 1024. Viewport names describe dimensions, not native emulation.

Run `npm run test-ui` from `MobileApp` to reproduce the browser journeys and
capture screenshots in the Playwright report. The [audit report](../../../MobileApp/docs/UI_AUDIT_2026_09.md)
records the fixes, focused unit/integration checks and environment limitations.
