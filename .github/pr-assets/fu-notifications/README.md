# Email, SMS, chat and phones follow-ups: the SLA breach email and the text part

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
request to the network refused.

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
Deadline Missed: Resolution
Deadline Was: Oct 26 2026, 11:59 AM GMT
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
