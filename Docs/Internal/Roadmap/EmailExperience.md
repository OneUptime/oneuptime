# Email experience

Customers report too much email. The code review found that owner notifications default to email,
burst batching is already enabled, and the settings page requires individual choices across many
event types. This is an implementation audit, not a measurement of customer inbox volume.

## Implemented in this change

1. **Make reducing routine updates easy.** A personal, per-project **Reduce routine emails** action
   turns off 21 informational event types in one transaction. It covers notes, ownership notices,
   monitor/status-page creation, episode membership, and on-call policy membership. It preserves
   existing incident/alert creation, state changes, reminders, assignments, health updates, and
   shift preferences. Other channels and on-call paging are unchanged. Missing routine settings get
   explicit opt-outs so later normal default seeding preserves the choice.
2. **Put preferences within reach.** Owner emails link directly to the relevant project's settings.
   Incident assignment and AI agent preferences, previously missing from the page, are visible.
3. **Honor the latest choice before sending a summary.** Queued events whose email setting was
   disabled or removed are excluded. Entirely unsubscribed batches send no email. A preference
   lookup failure leaves queued items available for a later attempt.

These changes do not reset existing preferences automatically and do not introduce a new delivery
delay. The existing burst rollup remains enabled by default and independently configurable.

## Recommended next steps

| Priority | Improvement | Why / validation |
| --- | --- | --- |
| Next | Measure email volume by project, event type, and recipient | Establish the leading sources of noise and compare emails per active recipient before and after adoption. Use aggregate counts; retain existing notification content policies. |
| Next | Debounce flapping health notifications and consolidate related incidents | Preserve the first actionable outage and meaningful recovery while reducing repeated transitions. Verify with outage/recovery timelines and on-call delivery latency. |
| Next | Offer configurable summaries for routine updates | Let people choose immediate, short summary, or daily summary for informational email. Keep paging, urgent health signals, account and billing email outside this setting. |
| Later | Resource-level subscriptions and temporary muting | People can follow the services they operate without turning off a whole event category. Show scope and expiry clearly, and keep paging governed by on-call rules. |
| Later | Explain why each email was received and show noisy sources | Include ownership/team/subscription context and a relevant preference link so customers can address the source. |

Track preset adoption, routine emails per recipient, summary size, repeated transitions, and support
complaints. Check acknowledgement latency and paging delivery alongside volume so improvement is
not inferred from fewer emails alone.

Grouping and actionable, personalized notifications are established approaches: see
[PagerDuty's noise reduction guidance](https://www.pagerduty.com/ops-guides/ops-practices/reduce-noise/)
and [Atlassian's alert fatigue guidance](https://www.atlassian.com/blog/blog/opsgenie/5-ways-to-reduce-alert-fatigue).
The exact choices above come from OneUptime's current code and should be refined with customer data.

## Validation and limits

Coverage includes rendered settings interactions, real email templates, authenticated API scope,
the event allowlist, queue delivery preferences, and opt-in Postgres integration tests for atomic
updates, rollback, repeated/concurrent requests, and other-channel preservation.

Run the Postgres suite with `RUN_POSTGRES_NOTIFICATION_TESTS=true`, normal database credentials, and
optional `NOTIFICATION_TEST_DATABASE_HOST` / `NOTIFICATION_TEST_DATABASE_PORT`. It creates and removes
an isolated schema using the existing settings table's structure. It does not change customer rows.

Already-sent email cannot be recalled. Delivery uses preferences read immediately before consuming
the queued batch; a change after that read can race with that send. Concurrent preset requests are
serialized. Existing default seeding still has a separate count-then-create race because the settings
table lacks a unique user/project/event constraint; repairing that general constraint is separate work.
