# Notification Email Rollup

When something goes badly wrong, it rarely goes wrong once. A flapping upstream link takes forty
monitors down, forty incidents are declared, each one is acknowledged and then resolved, and every
owner of every one of those resources gets an email for every step. That is how a monitoring tool
turns a single outage into two hundred messages in one inbox — and how the messages stop being read.

OneUptime coalesces those bursts automatically. You do not have to turn it on, and there is nothing
to configure — but if you would rather have every notification as its own email, you can
[switch rollup off for yourself](#turning-rollup-off-for-yourself), one project at a time.

## How it works

Every owner notification email you receive is counted against a small budget, held per project, per
recipient, per email address, and per **category** of resource — incidents, alerts, monitors,
scheduled maintenance, status pages, probes, SLOs, and so on.

- The **first four** emails in a category within any ten-minute window are sent immediately, exactly
  as they always were. Same subject, same template, same links.
- The **fifth and every later** email in that window is held back.
- About five minutes later, everything held back for you in that project — across all categories —
  arrives as **one** email listing what happened, newest first, with a link to each resource.

The rollup includes notifications that you are still subscribed to when it is sent. If you turn off
an event's email while its notifications are queued, those notifications are left out of the rollup.
Turning email back on later does not replay those skipped updates.

Below the threshold the feature does nothing at all. A project that produces three owner emails a
day still receives those three owner emails individually.

## What the rollup email looks like

The subject line tells you the scale _and the kind_ of storm before you open it:

```
[Acme Production] 112 notifications: 63 Monitors, 41 Incidents, 6 Alerts +2 more
```

Inside, a summary card gives the total, the time window the rollup covers, and the breakdown by
category. Below it the notifications are grouped into one section per category — incidents first,
then alerts, then the monitors and probes that noticed them — so the first thing under the summary
is the first thing worth clicking.

Each section holds one row per resource rather than one row per event. If an incident was created,
then acknowledged, then resolved, that is a single row showing where it ended up — which makes the
rollup _more_ current than the three individual emails would have been, since each of those is a
stale snapshot by the time you read it. Every row carries the time of its latest update, and a row
that absorbed several says how many, so the counts in the sections and the summary card always add
up to the same total.

Times are shown in UTC, and the date is shown as well whenever a rollup happens to span more than
one day.

![A rollup email carrying fifteen notifications](/docs/static/images/NotificationRollupEmail.png)

## What is never rolled up

Rollup only ever touches owner and member notifications — the "something you are responsible for
changed" family. It is structurally incapable of reaching anything else, because it lives inside the
one code path those notifications take and nothing else does.

Never delayed, and never counted:

| Category                                  | Examples                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| On-call paging                            | Every escalation-policy page, and every acknowledgement request                                      |
| On-call timing                            | "You are on call now", "you are next on call", "your shift starts soon", "your shift was reassigned" |
| Account security                          | Password reset, email verification, password changed, two-factor backup code used or regenerated     |
| Administrative notices about your account | An administrator changed your notification methods or your on-call rules                             |
| Billing and balance                       | Invoices, subscription overdue, "we could not page anyone because the card declined"                 |
| Instance health                           | Postgres, Redis and ClickHouse warnings to instance admins                                           |
| Status page subscribers                   | Every email your status page sends to your own subscribers                                           |
| SLA breaches                              | Sent immediately even though they reuse the incident-created notification type                       |

Only email is affected. SMS, phone calls, push notifications, WhatsApp, Telegram, Slack, Microsoft
Teams and webhooks are delivered immediately, exactly as before, including for the notifications
whose email was held back.

## Limits

- A rollup email carries at most **500** notifications. Anything beyond that stays queued and goes
  out in the next rollup, at most five minutes later.
- It renders at most **100** rows. Because rows are folded per resource, that is 100 distinct
  resources; beyond it the email reports honest totals and links you to the project.
- A single recipient can receive at most **12** rollup emails per hour from one project. That ceiling
  is enforced by the database, not by a timer, so it holds even during a sustained multi-hour storm.
- Worst-case added delay for a held-back notification is about six minutes.

## Turning rollup off for yourself

Some people want the batching. Some people file every notification as it lands, or feed the mailbox
to something that does, and a rollup email breaks that. So rollup can be switched off, per person and
per project, under **User Settings → Notification Settings** in the dashboard — the same page every
rollup email links to at the bottom.

With it off, every owner and member notification email in that project is sent to you individually
and immediately again, exactly as it was before rollup existed: same subject, same template, same
links, no threshold and no five-minute wait. Anything already queued for you when you switch it off
still arrives as one last rollup a few minutes later; everything after that comes one at a time.

The switch is **yours alone and scoped to one project**. Turning it off does not change what your
colleagues receive, and it does not carry across projects — so the noisy production project can keep
batching while the quiet internal one sends everything through, or the other way round. It is on for
everyone until they turn it off; there is nothing to enable and nothing to migrate.

What it does **not** touch:

- **Which notifications you get.** That is the per-event-type, per-channel setting on the same page
  (see below). Rollup and this switch only ever change how many emails those notifications are
  packed into.
- **On-call paging and shift email**, **account security email**, **billing email**, instance health
  warnings and status page subscriber email. None of those are ever rolled up in the first place, so
  turning rollup off changes nothing about them — see [What is never rolled up](#what-is-never-rolled-up).
- **Any other channel.** SMS, phone calls, push, WhatsApp, Telegram, Slack, Microsoft Teams and
  webhooks are already immediate.

## Turning it down further

Open **Manage notification preferences** at the bottom of an owner notification or rollup email,
or go to **User Settings → Notification Settings** in the dashboard.

Choose **Reduce routine emails** to turn off these informational emails for yourself in the current
project:

- Notes posted on incidents, alerts, episodes, and scheduled maintenance.
- Notices that you were added as a resource owner.
- New monitors and status pages.
- Incidents or alerts added to existing episodes.
- Being added to or removed from an on-call policy.

The action preserves your existing choices for incident and alert creation, state changes, reminders,
incident assignments, monitor health, and on-call shifts. It does not enable any email you previously
disabled. Paging, other delivery channels, account email, billing email, and status page subscriber
email are unaffected.

The changes save together. Review the per-event switches below to turn any individual email back on.
These preferences also apply to notifications waiting for a rollup; an already-sent email cannot be
recalled. Email rollup remains a separate setting that controls batching for the events you keep.
