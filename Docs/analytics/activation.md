# Activation: milestones, events and the first-hour funnel

This page describes how OneUptime measures a project's first hour (issue #6830): the moments that show a project is getting value, the events that record them, and the funnel built from them. Anyone can rebuild the dashboard from the queries below.

- **Milestones** are stored on the server, one row per project and milestone (`ProjectMilestone`). This is the source of truth. It works on every installation and is never sent anywhere by itself.
- **Events** go to product analytics (PostHog). That happens only where product analytics is set up, which is OneUptime Cloud.
- The tests keep this page and the code in step: `packages/Common/Tests/Types/Analytics/ActivationDocs.test.ts` fails when an event named here does not exist in the code, or an event in the code is missing from this page.

The developer notes are in `packages/Common/Server/Utils/Activation/README.md`.

## The rule every event follows

**Name: `area/thing_happened`.** That is the product area or flow, a slash, then what happened in the past tense, in lower case with underscores. For example `search/no_results`, `guided_setup/finished` and `activation/first_monitor_created`. Events sent before this rule keep their names, because dashboards are built on them (see [Events sent before the rule](#events-sent-before-the-rule)).

**Every event that follows the rule carries:**

| Property | What it holds |
| --- | --- |
| `project_id` | The project's id |
| `plan` | The project's plan (empty without billing) |
| `edition` | `cloud`, `enterprise` or `community` |
| `language` | The Dashboard's language (browser events only) |
| `is_project_creator` | Whether the person created the project (browser events only) |

**No event carries:**

- A name of anything: a person, a project, a monitor.
- An email or any other address, or a phone number.
- Text someone wrote: a message, a note, a title, a description, a question to Ask AI.

There is one exception. A search that found nothing sends the words typed, on OneUptime Cloud only, cut to 40 characters. Those words are the best sign of what people cannot find.

`FORBIDDEN_PROPERTY_WORDS` in `packages/Common/Types/Analytics/ProductEvent.ts` is the list of banned words. A test, `EventPropertyNames.test.ts`, checks the property names of every event in the code against it.

**Where events go.** Events are sent only when `ANALYTICS_KEY` and `ANALYTICS_HOST` are set. OneUptime Cloud sets them. A self-hosted server does not, so it sends nothing. In the browser, an event is also held back when the visitor refused cookies or sends Global Privacy Control. A self-hosted admin still sees every project's milestones on their own server, under Admin Dashboard > Projects.

## Milestones

Each milestone is set once per project, on the server, the first time it becomes true. It is set where the thing happens, after the write that makes it true has succeeded. A refused or failed action never sets it. The call that sets it sends one event, `activation/<milestone>`, carrying `project_id`, `plan`, `edition`, `milestone` and `seconds_since_project_created`. Its distinct id is the email of the person who created the project, the same as `server/project_created`.

| Event | Set when | Set in | Backfilled from |
| --- | --- | --- | --- |
| `activation/first_monitor_created` | The project's first monitor is created, of any type, by anyone | `MonitorService.onCreateSuccess` | `Monitor` |
| `activation/first_check_result_received` | A monitor's check result is first stored. Only a result that passed every refusal is stored: an archived, disabled or missing monitor, a probe not assigned to it, and a blocked project are all refused first | `MonitorLogUtil.saveMonitorLog` | `MonitorProbe.lastPingAt`, and monitors that have received a heartbeat, request, email or server report |
| `activation/first_notification_delivered` | An on-call page reaches a member through any channel: the provider accepted it, they acknowledged it, passed it on, or the call rang. A test page's message counts: it reached them | `UserOnCallLogTimelineService` (create and update) | `UserOnCallLogTimeline` |
| `activation/first_test_page_acknowledged` | A member acknowledges a test page (#6811), from any of its messages | `OnCallTestPageEvents.onTestPageAcknowledged`, from `UserOnCallLogTimelineService.acknowledgePage` | Nothing (new) |
| `activation/first_incident_or_alert_acknowledged` | A person moves an incident or alert to acknowledged, a later state, or resolved (the product's one rule, `AcknowledgedState`). A monitor or workflow doing it does not count | `IncidentStateTimelineService`, `AlertStateTimelineService` | The state timelines a person wrote |
| `activation/second_member_joined` | A second person accepts to be in the project | `TeamMemberService` (create and update) | `TeamMember` |
| `activation/first_status_page_monitor_added` | A status page first shows a monitor or a monitor group | `StatusPageResourceService.onCreateSuccess` | `StatusPageResource` |
| `activation/first_status_page_subscriber_added` | A status page has its first subscriber who can be sent updates (confirmed) | `StatusPageSubscriberService` (create and confirmation) | Confirmed `StatusPageSubscriber` rows |
| `activation/first_on_call_policy_executed` | An on-call policy runs for the first time. A direct page, a test of the policy, or an archived policy's log, does not count | `OnCallDutyPolicyExecutionLogService.onCreateSuccess` | `OnCallDutyPolicyExecutionLog` |
| `activation/first_logs_received` | ClickHouse accepts the project's first logs | `TelemetryFanInWriter.submit` | `TelemetryUsageBilling` (billing on) |
| `activation/first_traces_received` | ClickHouse accepts the project's first spans | `TelemetryFanInWriter.submit` | `TelemetryUsageBilling` (billing on) |
| `activation/first_metrics_received` | ClickHouse accepts the project's first metrics | `TelemetryFanInWriter.submit` | `TelemetryUsageBilling` (billing on) |
| `activation/first_exceptions_received` | ClickHouse accepts the project's first exceptions | `TelemetryFanInWriter.submit` | `TelemetryUsageBilling` (billing on) |
| `activation/first_profiles_received` | ClickHouse accepts the project's first profiles | `TelemetryFanInWriter.submit` | `TelemetryUsageBilling` (billing on) |

**The backfill.** A one-off data migration, `BackfillProjectMilestones`, filled the milestones of projects that existed before milestones were kept, from the data they already had. Those rows have `wasBackfilled = true`, and no event was sent for them. Their times are the best the data has:

- Monitors, status pages, subscribers, acknowledgements, on-call runs and pages: exact, unless the record has since been deleted.
- Check results: approximate. A stored result is kept for only about a day.
- Telemetry: the first day it was metered, which only an installation with billing on keeps.

## Server events

These are sent from the server, each time the thing happens, with `project_id`, `plan` and `edition`.

| Event | Sent when | Properties | Sent from |
| --- | --- | --- | --- |
| `test_page/sent` | Somebody sends a test page: to themselves, to a member, or a test of an on-call policy | `execution_log_id`, `kind` (`Self`, `Member`, `Policy`), `record_kind` (`Incident`, `Alert`) | `OnCallTestPageEvents.onTestPageSent`, from `OnCallTestPageService` |
| `test_page/acknowledged` | Somebody acknowledges a test page | `execution_log_id`, `channel` (the message they acknowledged from, when there was one) | `OnCallTestPageEvents.onTestPageAcknowledged` |

## Behaviour events

These are sent from the Dashboard with `ProductEvents.send(ProductEventName.X, { ... })` (`packages/Common/UI/Utils/ProductEvents.ts`), except `docs/feedback_given`, which the docs server sends for a docs page. The catalog in `packages/Common/Types/Analytics/ProductEvent.ts` lists every property an event may carry. Anything not listed is dropped before the event is sent.

| Event | Sent when | Properties | Sent from |
| --- | --- | --- | --- |
| `home/goals_chosen` | Somebody answers "What do you want to do first?" on Home, skips it (no goals), or changes the answer | `goals`, `goal_count`, `is_change` | Home's Welcome card (`GettingStarted`) |
| `home/checklist_step_started` | A step of the Welcome checklist is opened: its page, its guided setup, or Billing when the plan holds it back | `step`, `goals`, `needs_plan` | `GettingStarted` |
| `home/checklist_step_completed` | This browser first sees a step of the Welcome checklist go from not done to done | `step`, `goals` | `ChecklistEvents`, from Home's checklist |
| `home/checklist_finished` | The last step does | `step_count`, `goals` | `ChecklistEvents` |
| `home/checklist_dismissed` | Somebody hides the Welcome checklist for themselves | `done_count`, `step_count`, `goals` | `GettingStarted` |
| `home/member_step_started` | An invited member opens one of their own first steps on Home: their setup checklist (`reach`), a test page to themselves (`test_page`), their shifts (`on_call`) or the mobile app (`mobile_app`) | `step` | `MemberFirstSteps` |
| `home/member_steps_dismissed` | An invited member hides their own first steps on Home | `open_count` | `MemberFirstSteps` |
| `how_it_works/opened` | A product's "How it works" is opened, or How OneUptime works (`product` is `oneuptime`) | `product`, and for How OneUptime works `source` (`help`, `home`) | `ProductAboutButton`, `HowOneUptimeWorksDialog` |
| `search/no_results` | A command palette search settles with nothing found. Only searches of 2 characters or more count, after one second, or when the palette closes on them | `source`, `query_length`, and on Cloud `query` (40 characters at most) | `DashboardCommandPalette` |
| `ask_ai/question_asked` | Ask AI takes a question. The question itself is never sent | `is_new_conversation`, `permission_mode` | `useAiChat` |
| `ask_ai/answer_rated` | An answer is rated, or its rating cleared | `rating` (`up`, `down`, `cleared`) | `useAiChat` |
| `ask_ai/setup_proposed` | Ask AI proposes a setup plan on one approval card (#6829), once per answer. Never what the parts name | `parts` (`paging`, `website_monitor`, `status_page`, `status_page_monitors`, joined by a dot in the order they run), `part_count`, `permission_mode` | `useAiChat`, through `AskAiSetupEvents` |
| `ask_ai/setup_approved` | The plan's card is answered | `parts` (the approved ones), `approved_count`, `skipped_count` | Same |
| `ask_ai/setup_test_page_sent` | A test page is sent from under an answer that set something up | `target` (`self`, `policy`) | `AskAiTestPageOffer` |
| `importer/opened` | "Import from another tool" is opened | `from` (`?from=` on its address, else `settings`) | `ImportFromTool` |
| `docs/feedback_given` | "Was this page helpful?" is answered at the foot of a docs page. Sent by the docs server, not the Dashboard: only where product analytics is set up (OneUptime Cloud), only with the reader's consent, under an id of its own for each answer and with no person profile. A self-hosted server's docs send nothing | `page` (the page's address under /docs/, without its language), `is_helpful`, `reason` for a no (`unclear`, `missing`, `wrong` or `not_found`), `edition`, `language` (the docs' language) | `DocsFeedback` (`packages/App/FeatureSet/Docs/Utils/DocsFeedback.ts`), from the page's `PageFeedback` |
| `guided_setup/started` | A guided setup opens: `website_down` (Know when my website or API is down, #6804), `on_call` (Page the right person when something breaks, #6805), `status_page` (Publish a status page, #6806) or `telemetry` (Send logs, metrics and traces, then get alerted, #6806) | `setup` | `GuidedSetupFrame`, through `useGuidedSetupEvents` |
| `guided_setup/step_reached` | It moves on to a step. `website_down`'s steps are `check`, `who_is_told`, `test` and `summary`; `on_call`'s are `reach_you`, `who_else`, `no_answer`, `test` and `summary`; `status_page`'s are `pick`, `review` and `summary`; `telemetry`'s are `send`, `alert` and `summary` | `setup`, `step`, `step_number` | Same |
| `guided_setup/finished` | It reaches its end: the thing works and was tested (`on_call`: a test page of the policy acknowledged; `status_page`: a public page showing a monitor, reviewed; `telemetry`: data arrived, and a monitor watches it or the person said "not now") | `setup`, `seconds_taken` | Same |
| `guided_setup/left` | It is left before its end | `setup`, `step`, `step_number` | Same |
| `feedback/given` | Somebody tells OneUptime how something went (#6832): "How easy was that?" at the end of a guided setup (`kind` `setup_flow`, `topic` the setup, `score` 1 to 5), Give feedback in Help (`general`), "Was this clear?" under an explanation (`explanation`, `topic` `how_oneuptime_works` or `term.<term>`, `is_positive`) or the first-week check-in on Home (`check_in`, `is_positive`). What they wrote is never sent, only whether they wrote anything. Every answer is also kept on the server for its master admins (Admin Dashboard > Feedback), on every server | `kind`, `topic`, `score`, `is_positive`, `has_details`, `page` (the route, with no ids) | `ProductFeedback.submit` (`packages/Common/UI/Utils/ProductFeedback.ts`) |
| `products/product_hidden` | A product is hidden in the project, on Project Settings > Products (`source` is `settings`) or with Home's **Keep hidden** (`home`) | `product` (its key, such as `kubernetes`), `source`, `has_data` | `ProductsSettings`, `HiddenProductsWithData` |
| `products/product_shown` | A hidden product is shown again, on Project Settings > Products (`settings`) or with Home's **Show it** (`home`) | `product`, `source` | Same |
| `products/all_products_shown` | **Show every product** on Project Settings > Products | `hidden_count` | `ProductsSettings` |
| `products/product_pinned` | Somebody pins a product to the nav bar, from its card in the products menu (`source` is `menu`) or beside its page's title (`page`) | `product`, `source`, `pin_count` (how many they have pinned now) | `DashboardNavbar`, `ProductPinButton` |
| `products/product_unpinned` | Somebody unpins one | `product`, `source`, `pin_count` | Same |
| `setup_health/opened` | Setup health is opened (#6812), with how many findings of each level it shows. Whether people open it says whether a weekly email of new findings is worth sending | `source` (`?from=` on its address: `home`, `search`; else `direct`), `pages_will_not_arrive_count`, `worth_fixing_count`, `suggestion_count`, `dismissed_count` | `SetupHealthView` |
| `setup_health/fix_opened` | The fix of a finding is opened: which findings people act on, for the one-click fixes the issue leaves for later | `check`, `level` | `SetupHealthView` |
| `setup_health/finding_dismissed` | A finding is dismissed for everyone in the project. The reason is never sent | `check`, `has_reason` | `SetupHealthView` |
| `setup_health/finding_restored` | A dismissed finding is restored | `check` | `SetupHealthView` |
| `paging_ladder/saved` | A paging ladder is saved on How to Reach Me (#6820), by the person (`is_own`) or for a member. Whether people save one, and whether they replace differences, says whether the ladder is the view most people need | `is_own`, `step_count`, `replaced_card_count` (the cards that differed and now use the ladder) | `HowToReachMe` |
| `paging_ladder/grid_opened` | Somebody opens the per-severity grid behind the ladder with "Different for Some Severities" | `is_own`, `differing_card_count` | `HowToReachMe` |
| `used_by/list_opened` | The full list of what refers to a record is opened (#6813): a relation's "See all" on a record's Used by card, or a label's Used by on Settings > Labels. Whether people open it says whether the card's three rows are enough | `record_kind` (`monitor`, `on-call-schedule`, `service`, `status-page`, `team`, `label`), `relation` (the relation, or `all` for a label's whole list) | `UsedByDialog` |
| `sample_project/started` | **Explore Sample Project** is pressed (#6808): a sample project is made, or the person's existing one opened again. A sample counts as no activation: it reaches no milestone, sends no `server/project_created`, and nothing done inside it sends an event but these two | `from` (`welcome`, `goals`, `home`), `is_new` | `ExploreSampleProject` |
| `sample_project/deleted` | A sample project is deleted from its bar | `days_kept` (whole days since it was made) | `SampleProjectBar` |

### The Welcome checklist and its goals

Home asks a new project's owner once what they came to do (issue #6803). The answer is kept on the project, in `Project.goals`: a list of `uptime`, `on_call`, `status_page`, `telemetry`, `infrastructure`, `import` and `explore`. It is null when nobody has answered, and empty when the question was skipped. The checklist's events carry the goals as `goals`: the values in that order, joined by a dot, such as `uptime.status_page`.

A checklist step is done when the thing works, not when a record exists. Most steps are done by a milestone, and the server sends that milestone's `activation/` event the moment it first becomes true. So a step's completion is recorded on the server even when nobody has Home open:

| Step | Done when | Its server event |
| --- | --- | --- |
| `monitor` | A monitor's first check result is stored | `activation/first_check_result_received` |
| `on_call` | A test page is acknowledged or an on-call page reaches someone. Until either, an enabled incident or alert on-call rule runs a policy with a reachable responder | `activation/first_test_page_acknowledged`, `activation/first_notification_delivered` |
| `status_page` | A status page shows a monitor | `activation/first_status_page_monitor_added` |
| `team` | A second person accepts | `activation/second_member_joined` |
| `telemetry` | The first logs, traces, metrics, exceptions or profiles arrive | `activation/first_logs_received` and the other four |
| `infrastructure` | The first metrics arrive | `activation/first_metrics_received` |
| `import` | An import from another tool finishes | None: the import's own run says so |
| `server_email` | The server can send email (a master admin's step on a self-hosted server) | None |

## Events sent before the rule

These names predate the rule and stay as they are. The project name was removed from `server/project_created`, because no event carries a name.

| Event | Sent from |
| --- | --- |
| `server/user_created` | `UserService` |
| `server/project_created` | `ProjectService` |
| `server/monitor_created` | `MonitorService` |
| `server/status_page_created` | `StatusPageService` |
| `server/on_call_policy_created` | `OnCallDutyPolicyService` |
| `server/incident_created` | `IncidentService` |
| `server/team_member_invited` | `TeamMemberService` |
| `server/subscription_started` | `ProjectService` |
| `server/subscription_plan_changed` | `ProjectService` |
| `dashboard/home` | Home |
| `dashboard/home/getting-started-task` | Home's checklist, on a click on a step |
| `dashboard/home/getting-started-dismissed` | Home's checklist |
| `dashboard/home/how-it-works-step` | Home's "How OneUptime works" |
| `dashboard/home/explore-category` | Home |
| `dashboard/home/explore-product` | Home |
| `dashboard/home/search-opened` | Home's command bar |
| `dashboard/home/quick-action` | Home's command bar |
| `dashboard/home/resource-opened` | Home |

The Dashboard also sends a page view per page (`Page View: <trail>`), a form submit per form (`FORM SUBMIT: <form>`), and the revenue funnel's events (`Docs/analytics/gtm-key-events.json`). The server sends the billing events described in `Docs/analytics/marketing-event-webhooks.md`.

## The funnel

| Stage | The question it answers | Measured by |
| --- | --- | --- |
| Signed up | How many people start? | `User.createdAt` / `server/user_created` |
| Created a project | Do they get as far as a project? | `Project.createdAt` / `server/project_created` |
| First monitor | Do they set up the first thing? | `first_monitor_created` |
| First result | Does it work: is OneUptime checking it? | `first_check_result_received` |
| Someone reachable | Would anyone be told when it breaks? | `first_notification_delivered` |
| A tested page | Did they prove the chain works end to end? | `first_test_page_acknowledged` (#6811) |
| A status page with a monitor | Do they tell their own customers? | `first_status_page_monitor_added` |

For each stage, the funnel reports:

- The share of new projects that reach it within a day and within a week.
- The time from the project's creation to the stage, and between each pair of stages, as a median and a 90th percentile.

Split each by plan, by Cloud signup source (`utmSource`), and by the goals the project chose on Home (`Project.goals`).

### On the server's own database

These queries are the source of truth, and the only one that has the baseline, because rows from before the upgrade were backfilled. Run them against the installation's Postgres.

From creating a project to each milestone, for the projects created in the last 90 days:

```sql
WITH "projects" AS (
  SELECT "_id", "createdAt", "planName", "utmSource"
  FROM "Project"
  WHERE "createdAt" >= now() - interval '90 days'
),
"reached" AS (
  SELECT m."milestone", EXTRACT(EPOCH FROM (m."reachedAt" - p."createdAt")) AS "seconds"
  FROM "ProjectMilestone" m
  JOIN "projects" p ON p."_id" = m."projectId"
)
SELECT
  "milestone",
  COUNT(*) AS "projects_reached",
  ROUND(100.0 * COUNT(*) / NULLIF((SELECT COUNT(*) FROM "projects"), 0), 1) AS "percent_of_new_projects",
  ROUND(100.0 * COUNT(*) FILTER (WHERE "seconds" <= 86400) / NULLIF((SELECT COUNT(*) FROM "projects"), 0), 1) AS "percent_within_a_day",
  ROUND(100.0 * COUNT(*) FILTER (WHERE "seconds" <= 604800) / NULLIF((SELECT COUNT(*) FROM "projects"), 0), 1) AS "percent_within_a_week",
  percentile_cont(0.5) WITHIN GROUP (ORDER BY "seconds") AS "median_seconds",
  percentile_cont(0.9) WITHIN GROUP (ORDER BY "seconds") AS "p90_seconds"
FROM "reached"
GROUP BY "milestone"
ORDER BY "median_seconds";
```

To split by plan or signup source, add `p."planName"` or `p."utmSource"` to `reached`, then to the `SELECT` and the `GROUP BY`.

To split by goal, count each project once under every goal it chose, under `skipped` when it chose none, and under `not answered` when nobody answered:

```sql
WITH "projects" AS (
  SELECT "_id", "createdAt", "goals"
  FROM "Project"
  WHERE "createdAt" >= now() - interval '90 days'
),
"project_goals" AS (
  SELECT p."_id", g."goal"
  FROM "projects" p
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(p."goals") = 'array' THEN p."goals" ELSE '[]'::jsonb END
  ) AS g("goal")
  UNION ALL
  SELECT "_id", CASE WHEN "goals" IS NULL THEN 'not answered' ELSE 'skipped' END
  FROM "projects"
  WHERE "goals" IS NULL OR jsonb_typeof("goals") <> 'array' OR "goals" = '[]'::jsonb
)
SELECT
  pg."goal",
  m."milestone",
  COUNT(*) AS "projects_reached",
  ROUND(100.0 * COUNT(*) / NULLIF((SELECT COUNT(*) FROM "project_goals" x WHERE x."goal" = pg."goal"), 0), 1) AS "percent_of_projects_with_goal",
  percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (m."reachedAt" - p."createdAt"))) AS "median_seconds"
FROM "project_goals" pg
JOIN "projects" p ON p."_id" = pg."_id"
JOIN "ProjectMilestone" m ON m."projectId" = pg."_id"
GROUP BY pg."goal", m."milestone"
ORDER BY pg."goal", "median_seconds";
```

From signing up to creating a project, for the person who created it:

```sql
SELECT
  percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (p."createdAt" - u."createdAt"))) AS "median_seconds",
  percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (p."createdAt" - u."createdAt"))) AS "p90_seconds"
FROM "Project" p
JOIN "User" u ON u."_id" = p."createdByUserId"
WHERE p."createdAt" >= now() - interval '90 days';
```

Between two stages, for example from the first monitor to the first result:

```sql
SELECT
  COUNT(*) AS "projects",
  percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (b."reachedAt" - a."reachedAt"))) AS "median_seconds",
  percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (b."reachedAt" - a."reachedAt"))) AS "p90_seconds"
FROM "ProjectMilestone" a
JOIN "ProjectMilestone" b
  ON b."projectId" = a."projectId" AND b."milestone" = 'first_check_result_received'
JOIN "Project" p ON p."_id" = a."projectId"
WHERE a."milestone" = 'first_monitor_created'
  AND p."createdAt" >= now() - interval '90 days';
```

Backfilled times are the best the old data has. To measure only what was recorded live, add `AND m."wasBackfilled" = false`, or `AND NOT a."wasBackfilled" AND NOT b."wasBackfilled"`.

### In PostHog (OneUptime Cloud)

The live events, for projects created in the last 90 days (HogQL):

```sql
SELECT
  event,
  count() AS projects_reached,
  quantile(0.5)(toFloat(properties.seconds_since_project_created)) AS median_seconds,
  quantile(0.9)(toFloat(properties.seconds_since_project_created)) AS p90_seconds,
  countIf(toFloat(properties.seconds_since_project_created) <= 86400) AS within_a_day,
  countIf(toFloat(properties.seconds_since_project_created) <= 604800) AS within_a_week
FROM events
WHERE event LIKE 'activation/%'
  AND properties.project_id IN (
    SELECT properties.project_id FROM events
    WHERE event = 'server/project_created' AND timestamp >= now() - INTERVAL 90 DAY
  )
GROUP BY event
ORDER BY median_seconds
```

Split by `properties.plan`. For signup source, join on `properties.project_id` to `server/project_created`'s `utm_source`. For the goals, join on `properties.project_id` to the latest `home/goals_chosen`'s `goals`.

A PostHog funnel insight works too. Use the steps `server/user_created`, `server/project_created`, `activation/first_monitor_created`, `activation/first_check_result_received`, `activation/first_notification_delivered`, `activation/first_test_page_acknowledged` and `activation/first_status_page_monitor_added`. Every step is filed under the project creator's distinct id, so the creator moves through them as one person.

### The baseline

Before the first guided setup (#6804) ships, run the first server query on OneUptime Cloud's database for the projects created in the last 90 days. Post the results on the epic, #6802: the share of new projects that reach each stage within a day and within a week, and the median and 90th percentile times. Each later change to the first hour is measured against that.
