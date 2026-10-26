# Email, SMS, chat and phones follow-ups: the SLA breach email, the text part and the phone

Screenshots for the pull request "Follow-ups: Email, SMS, chat and phones".

- `sla-email-<width>-before.png` is the email an incident's owners got for a
  missed SLA deadline before this branch: the "incident created" template
  (IncidentOwnerResourceCreated.hbs) with the variables master's
  CheckSlaBreaches job filled in. It never says a deadline was missed.
- `sla-email-<width>-after.png` is the email they get now:
  IncidentOwnerSlaBreached.hbs with the variables IncidentSlaBreachNotice
  builds (a missed resolution deadline, the reader in Europe/London).

Both were rendered by MailService.render with OneUptime's own branding (its
logo as a data: URL, as a browser shows it; mail clients get it by
Content-ID) and shot in headless Chromium at 1280px and 390px, 2x, with every
request to the network refused. After the UI review the missed deadline is
one row, "Resolution Deadline:" (or "Response Deadline:") and when it was,
where it had been two: "Deadline Missed: Resolution" over "Deadline Was:".

## The phone: why Critical On-Call Alerts reads off

- `mobile-settings-ios-before.png`: the app's Settings when iOS Settings had
  turned the responder's critical alerts off - the switch off, no reason.
- `mobile-settings-ios-after.png` (and `-after-dark.png`): the footnote under
  the switch - what turned it off, in bold, what pages do meanwhile, the one
  switch to turn on, and Open iOS Settings.
- `mobile-settings-notifications-off-after.png`: notifications off for the
  app altogether - pages do not come at all - said in red.
- `mobile-settings-android-after.png`: the alarm cannot ring through Do Not
  Disturb on Android, with Open Do Not Disturb access.
- `mobile-alarm-warning-before.png` / `-after.png`: the Alarm sound screen's
  Android warning, before and after (what happens meanwhile, and a button).

The app's own web build (`expo export --platform web`, as `npm run test-ui`
builds it) of a copy whose two critical-alert hooks answer each state with
the real module's words, signed in with tests/ui/fixtures.js and shot in
headless Chromium at 390px, 2x, light and dark. The phone's own settings
pages are not part of it.

## The Dashboard: Incident SLA breached

`notification-settings-sla-row-1280.png`: User Settings > Notification
Settings > Incidents with the new row, under Incident reminder, as a member
who just joined has it (email on). The real page bundled with the
Dashboard's esbuild config beside a stand-in for the side menu, at 1280px.

## The text part

Every email sent over SMTP or SendGrid now carries this text beside its
HTML (EmailPlainText). The SLA breach email above, as a text-only mail
client shows it:

```
OneUptime

SLA breached - Incident INC-42: Checkout API is down

This incident was not resolved before its SLA resolution deadline.

Here are the details:

Incident Title: Checkout API is down
Resolution Deadline: Oct 26 2026, 11:59 AM GMT
SLA Rule: P1 customer SLA
Current State: Investigating
Open For: 2 hours, 30 minutes
Severity: Critical
Project: Acme Prod

You can view this incident by clicking on the button below -

View on Dashboard (https://oneuptime.example.test/dashboard/p/incidents/i)

You can also copy and paste this link:
https://oneuptime.example.test/dashboard/p/incidents/i

Why am I receiving this email?

You are receiving this email because you are the owner of this resource.

Want fewer notification emails?
Choose which notifications you receive in this project.
Manage notification preferences (https://oneuptime.example.test/dashboard/user-settings/notification-settings)

Powered by OneUptime (https://oneuptime.com) · © 2026 OneUptime
```

A status page's uptime report, whose breakdown is a data table:

```
Acme Status

Uptime Report: Acme Status

Here is your status summary for October 2026.

Average Uptime

99.95%

Oct 1 2026 – Oct 26 2026 (GMT)

21m

Downtime

1

Incidents

3

Resources

Breakdown by group

Group / Resource | Uptime | Downtime | Incidents
Payments · 2 resources | 99.93% | 21m | 1
Checkout API | 99.90% | 21m | 1
Card vault | 100% | 0m | 0

View Full Status Page (https://status.acme.example.test)

Unsubscribe (https://status.acme.example.test/unsubscribe/x)
Stop receiving these status updates. You will be asked to confirm.

Powered by OneUptime (https://oneuptime.com) · © 2026 OneUptime
```
