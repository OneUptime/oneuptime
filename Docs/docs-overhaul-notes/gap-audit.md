# Documentation gap audit (research notes for new pages)

Every fact below was verified in code by a research pass; file references are given so you can re-check them. Path prefixes:
- `D/` = packages/App/FeatureSet/Dashboard/src/
- `C/` = packages/Common/
- `W/` = packages/App/FeatureSet/Workers/Jobs/

Navigation facts every page needs:
- Products open from the **Products** menu in the top bar (C/UI/Components/Navbar/NavBar.tsx). Its groups: Essentials, Observability, AI, Code, Resources, Infrastructure, Dashboards & Automation, Settings (D/Utils/NavigationItems.tsx).
- These side-menu sections start collapsed, so say "expand X": Advanced, Developer, Settings, Rules, Workspace, AI, Notifications, Logs, Audit Logs, On-Call Logs, Reports, Help, Danger Zone (C/UI/Components/SideMenu/SideMenuSectionState.ts).
- There is no "left navigation" any more; say "the Products menu".

## P1. Alerts (new group "Alerts")

Pages: alerts/index "Alerts Overview", alerts/states-and-severities "Alert States & Severities", alerts/episodes "Alert Episodes & Grouping Rules", alerts/settings "Alert Rules & Settings".

Where: Products → Essentials → **Alerts** (`/dashboard/{projectId}/alerts`, D/Utils/RouteMap.ts). Side menu (D/Pages/Alerts/SideMenu.tsx):
- Alerts: All Alerts, Active Alerts (red count badge)
- Episodes: All Episodes, Active Episodes, Documentation
- AI: Insights, Logs, Settings
- Workspace: Slack / Microsoft Teams, or "Connect Slack or Teams"
- Rules: Grouping Rules, On-Call Rules, Owner Rules, Runbook Rules, Privacy Rules, Label Rules, Reminder Rules
- Settings: Alert State, Alert Severity, Note Templates, Custom Fields, Measurements, Number Prefix

Alert vs incident (quote):
- List card: "Alerts flag problems for your team to look into before users are affected. Unlike incidents, they never appear on status pages." (D/Components/Alert/AlertsTable.tsx)
- Products menu: Alerts "Problems for your team to look into before users notice." vs Incidents "Problems that affect your users — respond and resolve." (D/Locales/en.json navbar.items.alertsDescription / incidentsDescription)
- Monitor criteria tooltip: "When you create an alert, it is used to notify the team but is not shown on the status page." (D/Components/Form/Monitor/MonitorCriteriaInstance.tsx)
- Alerts have private notes only ("Alert Notes → Private Notes"; model AlertInternalNote; no public note model).
- Alerts have their own state and severity lists. Number prefixes for new projects: `ALT-` alerts, `AE-` alert episodes (C/Utils/Project/NumberPrefix.ts; applied in C/Server/Services/ProjectService.ts).

Seeded alert states (ProjectService.ts; colours C/Types/BrandColors.ts):
| State | Order | Colour | Flag |
|---|---|---|---|
| Identified | 1 | #fd625e | isCreatedState |
| Acknowledged | 2 | #ffbf53 | isAcknowledgedState |
| Resolved | 3 | #2ab57d | isResolvedState |
(The seeded Resolved description says "When an incident is resolved…" — a product copy bug; do not copy it.)

Seeded alert severities — two, not three (ProjectService.ts):
- High: order 1, #b70400, "Issues causing very high impact to customers. Immediate attention is required."
- Low: order 2, #ffbf53, "Issues causing low impact to customers."

State/severity page copy (D/Components/StateSettings/StateSettingsCopy.ts): states — "Alerts only ever move down this list. Drag a state to change where it sits. A new state is added just above the resolved state."; **Counts as** column: Not acknowledged / Acknowledged / Resolved; built-in states can be renamed, not deleted. Severities — "Most severe first… the one higher in this list wins." Mirrors incidents/states-and-severities.

How alerts are created:
1. Monitor criteria: "When filters match, create an alert." toggles a **Create Alert** list (MonitorCriteriaInstance.tsx). The alert form (D/Components/Form/Monitor/MonitorCriteriaAlertForm.tsx; schema C/Types/Monitor/CriteriaAlert.ts): **Alert Title** (placeholder "e.g., {{monitorName}} is degraded"), **Severity** (required), **Alert Description**, **Ownership & Labels** (Owners, Labels), **On-Call** (On-Call Policies), **Auto Resolve Alert** ("Automatically resolve this alert when this criteria is no longer met"), **Private Alert**, **Remediation Notes**.
2. Manually: **Create Alert** button (AlertsTable.tsx) opens the **Create New Alert** wizard with steps **Alert Details** and **Resources & On-Call** (D/Pages/Alerts/Create.tsx). Fields: Title, Alert Severity, Description, Initial State, Private Alert, Monitor, Other Affected Resources, On-Call Policy. Submit **Create Alert**. Initial State help: "Leave empty for the usual starting state. Pick a later state to record an alert that is already acknowledged or resolved. No one is paged for it."
3. Other sources: SSL and domain expiry warnings (monitor/ssl-certificate-monitor, domain-monitor), SLO burn-rate rules (slo/burn-rate-alerts), network site alerting (monitor/network-sites), workflows/integration templates, the API.

Responding: header buttons **Acknowledge** and **Resolve**; dialogs "Acknowledge Alert", "Resolve Alert", "Mark Alert as {state}" (D/Components/Alert/ChangeState.tsx); list bulk action **Change State**. "Declare Incident" from alerts: incidents/linked-alerts. Alert page menu (D/Pages/Alerts/View/SideMenu.tsx): Basic: Overview, Description, Root Cause, Remediation, Runbooks, State Timeline, Owners, Linked Incidents; On Call: On Call Executions; Logs: Notification Logs, AI Logs; Alert Notes: Private Notes; Advanced: Custom Fields, Audit Logs, Settings, Delete Alert. Settings page: card "Who can see this alert" with **Private Alert** switch, plus a Reminders card. A private alert is visible only to its owner users and owner-team members, plus project admins and owners.

Who is notified: owners — "Alert created", "Alert state changed", "Alert reminder" are on by email by default (C/Server/Services/UserNotificationSettingService.ts); "Alert note posted" and "Added as alert owner" have no default and nothing is sent without a settings row. On-call — the policies on the alert: set in the criteria/create form or by **Alerts → Rules → On-Call Rules** (tabs **Alert Rules** and **Episode Rules**; match fields Monitors, Alert Severities, Alert Labels, Monitor Labels, Alert Title, Alert Description, Monitor Name, Monitor Description, then On-Call Duty Policies — D/Pages/Alerts/Settings/AlertOnCallRules.tsx). Each person is reached per their Alerts tab in User Settings → On-Call Rules.

Rules: **Reminder Rules** — "Periodically remind alert owners while an alert is still open. Rules are evaluated in order — the first matching rule wins." Fields include **Reminder Interval (minutes)** (placeholder 30), **Stop Reminders When** (defaults to Resolved) (AlertReminderRules.tsx). **Privacy Rules** — "Auto-mark alerts as private when they match these rules." On Cloud, Custom Fields and Note Templates need the Growth plan.

Episodes: rules evaluated by priority, lowest number first; the first matching enabled rule wins (C/Server/Services/AlertGroupingEngineService.ts). Rule defaults (C/Models/DatabaseModels/AlertGroupingRule.ts): Priority 1; Is Enabled true; Group By Monitor / Alert Severity / Alert Title / Alert Labels / Monitor Labels all false; Enable Time Window false (Time Window (Minutes) 60); Enable Resolve Delay false (0); Enable Reopen Window false (0); Enable Inactivity Timeout false (60); Episode Owner Users/Teams, Episode Labels, On-Call Duty Policies. Episode title/description templates use `{{alertSeverity}}`, `{{monitorName}}`, `{{alertTitle}}`, `{{alertDescription}}`. Form asks "Group alerts by" (D/Utils/GroupingRule/GroupingRuleSetup.ts); templates: "Group alerts from the same monitor" (30 min), "Group alerts that happen together" (10 min), "Group alerts by severity" (30 min), "Group repeats of the same alert" (60 min, numbers in titles ignored). Incident equivalents: incidents/settings — mirror it. Episode severity = highest severity among member alerts. Paging: when an alert opens a NEW episode both the alert's policy and the rule's policy run; when it joins an existing episode only the alert's policy runs (D/Pages/Alerts/EpisodeDocs.tsx). Episode page menu: Overview, Description, Root Cause, Remediation Notes, Owners, State Timeline, Member Alerts, Private Notes, Audit Logs, Delete Episode. Manual: "Create New Alert Episode", steps **Episode Details** and **On-Call & Owners**, submit **Create Episode**. Owner defaults: "Alert episode created", "state changed", "Alert added to alert episode" on by email.

Link to: incidents/linked-alerts, incidents/states-and-severities, incidents/settings, monitor/incident-alert-templating, on-call/escalation-rules, configuration/label-and-owner-rules, configuration/run-rules-now, runbooks/rules, ai/ai-sre, workspace-connections/slack, workspace-connections/microsoft-teams, permissions/index, slo/burn-rate-alerts.

## P2. Personal notification setup (new group "Notifications")

Pages: notifications/index "How OneUptime Reaches You", notifications/notification-methods "Notification Methods", notifications/on-call-rules "Personal On-Call Rules", notifications/notification-settings "Notification Settings".

Where: top bar → **User Settings**. Side menu (D/Pages/UserSettings/SideMenu.tsx): Get Started: Setup Checklist; Alerts & Notifications: Notification Methods, On-Call Rules, Notification Settings, Email Preferences; On-Call Logs; Incoming Call Policy: Incoming Phone Numbers; Calendar: Calendar Feed; Profile: Custom Fields; Workspace: Slack / Microsoft Teams (only if the project connected them).

Lead concept — three separate systems. Checklist text: "Notification settings are a different system from your on-call rules: they cover updates about your work and your shifts, not the page that wakes you when something fires." (D/Components/UserSettings/SetupChecklist/ChecklistModel.ts)

Notification Methods (D/Components/NotificationMethods/NotificationMethodTabs.tsx) tabs: **Direct Contact** (Email, SMS, Call, WhatsApp, Telegram), **Workspace Apps** (Slack, Microsoft Teams — only connected workspaces), **Push Notifications**, **Webhooks**. Card titles: "Emails for Notifications", "Phone Numbers for SMS Notifications", "Phone Numbers for Call Notifications", "WhatsApp Numbers for Notifications", "Telegram Accounts for Notifications" (has **Rotate Code**), "Push Notification Devices" (**Register Device**, **Test Notification**, **Critical Alerts** column), "Webhooks for Notifications" (Name, Webhook URL, Signing Secret (optional), **Send Test**), Slack / Microsoft Teams account cards (**Send Test Message**). Each method has **Verify**. Critical Alerts: "On-call pages to this device override silent mode and Do Not Disturb. Turned on from the OneUptime On-Call mobile app; browsers cannot override a device's ringer." Project channel gate: SMS, Phone Calls, WhatsApp and Telegram are OFF by default (C/Models/DatabaseModels/Project.ts); turn them on in the **Notification Channels** card on Project Settings → Notifications → Notification Settings — only a project owner, a Billing Admin or someone with Manage Billing (D/Components/NotificationMethods/ProjectNotificationChannelsCopy.ts). Card text: "Each of these has to be on before anyone in this project can add it as a notification method." Deleting a method also deletes every rule that uses it (the delete dialog lists the impact).

On-Call Rules (D/Components/NotificationRule/OnCallRuleKinds.ts): tabs **Incidents**, **Incident Episodes**, **Alerts**, **Alert Episodes**, one card per severity (incident episodes use incident severities, alert episodes alert severities). Rule fields: **Notification Method**, **Notify After** (Immediately / 5 / 10 / 15 / 30 minutes / 1 hour). Admins see the same page under Users → a member → On-Call → On-Call Rules.
Defaults: when a member with a verified sign-in email joins, OneUptime adds their account email as a verified Email method, one rule per severity for each of the four kinds via that email, Immediately, and "When user goes on/off call" rules (C/Server/Services/TeamMemberService.ts; UserNotificationRuleService.ts). Every method later verified (SMS, Call, WhatsApp, Telegram, Push, Slack, Teams, Webhook) gets the same default rules — verifying a phone number starts paging you on it immediately for every severity. New severities get rules backfilled within seconds (5-minute safety job). Fallback: a responder with no matching rule is paged on their verified methods anyway; two things disable it — the project setting `disableOnCallNotificationFallback` (default false) and a rule with **Opt Out of Notifications** (`isOptOut`) — no dashboard control for either (API only).

Notification Settings: matrix of event × channel (Email, SMS, Call, Push, WhatsApp, Telegram, Slack, Teams, Webhook; Slack/Teams only when connected) (D/Pages/UserSettings/NotificationSettings.tsx). Tabs: Incidents, Alerts, Monitoring, Status Pages, Scheduled Maintenance, On-Call. Footer: "Changes save automatically." Defaults are email only for: incident created / state changed / reminder; alert and episode events (see P1); monitor "no active probes" and "probe status changed"; probe events; all roster events plus shift reminders (email AND push); SLO status change / owner added; scheduled maintenance reminder only; missed call. NOT on by default: "Monitor status changed", "Incident note posted", "Maintenance event created / state changed" and similar — with no settings row nothing is sent (callout-worthy).

Setup Checklist sections: "So we can reach you" (Add a way for us to reach you; Verify every method you added; At least one of your channels is usable here), "How you want to be paged" (four rule steps), "Staying informed", "Nice to have" (inbound call number, Slack, Teams, calendar link, profile fields). Optional steps don't count toward the progress bar.
No quiet-hours feature exists; nearest controls are Notify After and push Critical Alerts.

Link to: on-call/escalation-rules, on-call/calendar-feeds, on-call/incoming-call-policy, emails/notification-rollup, mobile-desktop-apps/index, self-hosted/push-notifications, workspace-connections/slack, workspace-connections/microsoft-teams, permissions/index.

## P3. On-Call overview and administration (On Call group)

Pages: on-call/index "On-Call Overview" (how a page reaches a person), on-call/policies "On-Call Policies", on-call/user-overrides "User Overrides", on-call/readiness "Readiness & Reports".

Where: Products → Essentials → **On-Call Duty** (`/dashboard/{id}/on-call-duty/policies`). Side menu (D/Pages/OnCallDuty/SideMenu.tsx): Policies: On-Call Policies, Readiness; Schedules: On-Call Schedules, Schedule Timeline, Calendar Feeds; Incoming Calls: Incoming Call Policies; Advanced: User Overrides, Execution Logs, Archived Policies; Reports: User On Call Time; Settings: Custom Fields, Label Rules, Owner Rules.

Policy: list card "On-call policies decide who is notified when an incident or alert opens, and who is next if nobody acknowledges it." Create fields: Name, **Who gets paged first?**, Description (D/Components/OnCallPolicy/OnCallPolicyCreateForm.ts). Policy menu: Overview, Escalation Rules, Owners, Execution Logs, Notification Logs, User Overrides, Custom Fields, Settings (Export, Archive), Audit Logs, Delete Policy. **Repeat Policy** dialog "Edit Repeat Policy": **Repeat if no one acknowledges**, **Number of times to repeat** (defaults false and 0). Archived policies "page no one: incidents and alerts that use them skip them".

End-to-end flow: (1) a policy is attached to an incident, alert or episode — directly, from a template or monitor criteria, from on-call rules, or a grouping rule; (2) an execution log records status: Scheduled → Started → Executing → **Execution Completed**, or **Execution Completed - No One Notified**, or **Error** (C/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus.ts); (3) escalation levels page users, teams and schedules (on-call/escalation-rules); (4) a user override, if any, reroutes the page; (5) each person is reached through their On-Call Rules, with the fallback behind them (P2); (6) each delivery is a per-user On-Call Log: Scheduled, Started, Executing, Completed, Error; users see it at User Settings → On-Call Logs, card "Notification Logs". Workers run every minute.

User Overrides: "While someone is away, a user override sends the alerts that would page them to the person who covers, for a set time." An override with no policy is global (covers every policy). Form: **Who is away?**, **Who covers?**, **Starts** ("It starts now unless you pick another time."), **Ends**. Table: Away, Covered by, Starts, Ends. Growth plan on Cloud.

Readiness: "if an incident fired right now, who on this project would actually get paged?" Statuses **Ready**, **{count} gaps**, **Unreachable**. A weekly digest emails project owners only when someone can't be paged; no "all clear" mail.
Reports: User On Call Time — columns "User", "Time user was on call".

## P4. Scheduled Maintenance (new group "Scheduled Maintenance")

Pages: scheduled-maintenance/index "Scheduled Maintenance Overview", scheduled-maintenance/creating-events "Creating Maintenance Events", scheduled-maintenance/states "Maintenance States", scheduled-maintenance/templates "Templates & Recurring Events", scheduled-maintenance/settings "Maintenance Rules & Settings".
NOTE: status-pages/subscribers#scheduled-maintenance-events already documents the create form, states and subscriber notifications and is pinned by tests — keep the subscriber detail there and link to it; do not contradict it.

Where: Products → Essentials → **Scheduled Maintenance** (`/dashboard/{id}/scheduled-maintenance-events`). Products menu text: "Announce planned downtime ahead of time." Side menu: Overview: All Events, Ongoing Events; Rules: Owner, Runbook, Label, Reminder; Settings: Event State, Event Templates, Note Templates, Custom Fields, Measurements, Number Prefix.
List page card: "Announce planned work ahead of time, so your customers and status page subscribers are not caught by surprise." Buttons **Create Scheduled Maintenance Event**, **Create from Template**; bulk **Change State**.

Seeded states (ProjectService.ts):
| State | Order | Colour | Flag |
|---|---|---|---|
| Scheduled | 1 | #000000 | isScheduledState |
| Ongoing | 2 | #ffbf53 | isOngoingState |
| Ended | 3 | #4A4A4A | isEndedState |
| Completed | 4 | #2ab57d | isResolvedState |
Ended vs Completed: OneUptime moves an event to Ended automatically at its end time; Completed is the resolved state a person or the API moves it to afterwards.

Automation: every minute, scheduled events whose start time has passed move to Ongoing (W/ScheduledMaintenance/ChangeStateToOngoing.ts); in-progress events past their end time move to Ended (ChangeStateToEnded.ts). Starting an event stops probing its monitors and sets them to **Change Monitor Status to**; ending puts them back to operational. Monitor column "Disable Monitoring because of Ongoing Scheduled Maintenance Event". Header buttons **Mark as {Ongoing}** / **Mark as {Ended}** (named after your states), timing chips "Starts in", "Start overdue", "Overrunning".

Templates & recurring: card "Ready-made maintenance events for work you do often… make it recurring to schedule events automatically." Recurring step fields: **Recurring Event**, **First Event Scheduled At**, **First Event Starts At**, **First Event Ends At**, **How often should this event recur?** (daily, weekly, monthly, yearly). A per-minute worker creates the events. Templates need the Growth plan on Cloud.

Owner notifications: only "Maintenance reminder" on by default; created/state-changed/note-posted opt-in.
Event page menu: Basic: Overview, Description, Owners, State Timeline, Runbooks; Logs: Notification Logs, AI Logs; Notes: Private Notes, Public Notes; Advanced: Custom Fields, Settings, Audit Logs, Delete Event. Number prefix `SM-`.

## P5. Monitor criteria & statuses — monitor/criteria-and-statuses "Monitor Criteria & Statuses"

Where: a monitor's **Criteria** page, and Monitors → Settings → **Monitor Status**.
Seeded statuses (ProjectService.ts):
| Status | Priority | Colour | Description |
|---|---|---|---|
| Operational | 1 | #2ab57d | "Monitor operating normally"; isOperationalState |
| Degraded | 2 | #ffbf53 | "Monitor is operating at reduced performance." |
| Offline | 3 | #fd625e | "Monitor is offline."; isOfflineState |
Monitor Statuses page copy: "From healthiest to worst. Where monitors are shown together, as on a status page or in a monitor group, the status lowest in this list wins…"
Criteria UI: **Match Condition** All or Any; actions "When filters match, change monitor status." → **Change monitor status to**; "When filters match, create an alert." → **Create Alert**; "When filters match, declare an incident." → **Create Incident**; settings **Enable this criteria**; for incoming requests **Group incidents and alerts by a payload field**. A blank criteria instance has all three actions off.
Monitor list pages: Attention Required: Not Operational, Disabled, Probe Disconnected, Probe Disabled; Advanced: Archived.
"Monitor status changed" owner notification is not on by default.

## P6. Exceptions — telemetry/exceptions "Exception Tracking"

Where: Products → Observability → **Exceptions**; tabs **Exceptions** (badge with unresolved count, capped "99+"), **Insights**, **Setup Guide**. States Unresolved / Resolved / Archived; actions **Mark as Resolved**, **Mark as Unresolved**, **Archive**, **Unarchive**. Grouping per project + resource + fingerprint (packages/App/FeatureSet/Telemetry/Utils/Exception.ts); a new occurrence un-resolves a resolved exception; archived stays archived. Fields: Exception Type, Message, Stack Trace, Occurrences, First / Last Seen In Release, Environment, Unhandled, Assign to User / Team, AI Classification and Error Class ("Non-actionable classes are excluded from the Issues list."). Exception page: Investigate: Overview, Stack Trace, Occurrences, Context, Logs; Resolve: AI Assistance; Manage: Settings. "Fix with AI" is refused for resolved or archived exceptions.
Link to: telemetry/source-maps, monitor/exceptions-monitor, ai/ai-agent, ai/ai-sre, telemetry/search-syntax, telemetry/open-telemetry.

## P7–P9. Logs, Traces and Metrics explorers; drop filters & scrub rules

Logs: tabs **Viewer**, **Insights**, **Setup Guide**, **Settings**. Viewer defaults: time range Past 1 hour; columns time, service, severity, message; 100 rows per page; **Live** polls every 10 s, only on page 1 sorted newest-first; up to 100 saved views. Toolbar: **Saved Views**, **+ Save Current View**, **Columns**, **Export** (**Export as CSV** / **Export as JSON**), **List** / **Analytics**, Filters. Log detail panel: Attributes, Context, "Nearby (service + time)", "Related telemetry signals". Insights panels: "Top errors", "Severity distribution", "Sources reporting logs".
Traces: same four tabs; 50 rows per page; Live every 10 s. Analytics: "Traces over time", "Spans over time", "Spans with / without exceptions". Trace detail views **Waterfall**, **Flame graph**, **Service map**, **Operations**; header stats Duration, Spans, Services, Errors, Depth; span tabs Attributes, Events, Logs, Exceptions, Links, Profile, LLM.
Metrics: same four tabs. Explorer actions: "Add metric query", formulas, "Overlay with previous query", "Convert to per-second rate", "Add to dashboard", "Create monitor from this view", "Copy Link". Chart types Line, Bar, Area. Settings: **Pipeline Rules**, **Recording Rules**.
Drop Filters & Scrub Rules (Logs/Traces → Settings: Pipelines, Drop Filters, Scrub Rules, Recording Rules): Scrub rules — "Automatically detect and scrub sensitive data (PII) from logs at ingest time… Drag to reorder." Pattern types email, creditCard, ssn, phoneNumber, ipAddress, sensitiveKeys, custom; actions redact (default, `[REDACTED]`), mask, hash; fields body, attributes, or both (default). Drop filters — Filter Query; Action drop (default) or sample; Sample Percentage 1–99.

## P10. Services — telemetry/services "Service Catalog"

Where: Products → Resources → **Services** (`/dashboard/{id}/service`). List card: "The applications and microservices you run. Each service brings together its logs, traces, metrics, exceptions, incidents and owners in one place." Columns Name, Description, Technology, Last Seen, Labels, Owners; bulk labels, owners, archive. A service is created automatically the first time telemetry arrives with a new `service.name`. Archived services "are hidden from lists but keep collecting telemetry". Last-seen OTel attributes: version, environment, namespace, runtime, SDK language, cloud provider/platform/region. Service page: Basic: Overview, Recommendations, Owners, Feed; Telemetry: Logs, Traces, Metrics, Performance Profiles, Exceptions, Source Maps; Activity: Incidents, Alerts, Scheduled Maintenance; Advanced: Settings, Audit Logs, Delete Service. Overview charts: Requests, Error rate, Latency (p95), Logs, Exceptions, Technology. Settings: Service Details, Service Settings (Service Color, Tech Stack), retention, Archive. Retention overrides need the Scale plan. Services → Settings has Owner Rules and Label Rules.

## P11. Monitor Groups — monitor/monitor-groups "Monitor Groups"

Where: Monitors → **Monitor Groups** (`/dashboard/{id}/monitor-groups`); shown only when Project Settings → Advanced → **Feature Flags** → **Monitor Groups** is on (default off). Switch note: "A monitor group rolls several monitors up into one status, which a status page can show as one row. Turning this off deletes no group." Scale plan on Cloud. List card: "Monitors that together make up one service, such as Checkout. A group shows the worst status among its monitors…" Fields Name, Description; columns Group Name, Current Status, Labels, Owners. Status rule: the group starts at the operational status and takes the highest-priority-number status among its non-archived monitors. Group page: Overview (Monitor Group Details, Current Status, **Uptime Graph** "This group's status over the last 90 days, one bar per day."), Monitors ("Monitors in Group", **Assign Monitor**, **Unassign**), Owners, Incidents, Alerts, Audit Logs, Delete Group.

## P12. Telemetry ingestion keys & data retention

Where: Project Settings → **Telemetry & APM** (collapsed) → **Ingestion Keys** / **Data Retention** (breadcrumbs "Telemetry Ingestion Keys", "Telemetry Settings"). Key fields: **Key Type** (default Server; Server = full ingest, no origin checks; Browser = write-only, needs **Allowed Origins** `https://…` or `app://…`), **Pinned Service Name** (replaces `service.name` on everything written with the key), **Enabled** (kill switch), **Expires At**, **Last Used At** (list shows "Never"), **Requests Per Minute Limit** (Browser keys get a default; Server keys unlimited). Retention: card "Telemetry Data Retention", field **Default Retention (Days)** (minimum 1; button "Edit Retention Settings"); default 15 days; overrides by type, service or resource need Scale.

## P13. Project settings, billing & administration

Pages: configuration/project-settings, configuration/billing, configuration/audit-logs (and delete project inside project-settings).
Side menu (D/Pages/Settings/SideMenu.tsx; only Basic starts open): Basic: Project, Labels; Workspace: Slack, Microsoft Teams, Video Calls; Telemetry & APM; Notifications: Notification Settings, Notification Logs, Mobile Apps; AI: AI Features, LLM Providers, AI Credits (Cloud), AI Logs, MCP Server; Advanced: Domains, API Keys, Feature Flags; Security: SSO, OIDC, SCIM; Audit Logs: Audit Logs, Settings; Danger Zone; Billing and Invoices (Cloud only).
Project page: Project Details (Project Name, Project ID, Data Residency — set by OneUptime staff); **Customer Support Access** (Cloud): "Let OneUptime support access this project", confirm "Let support in".
Project Notification Settings: Current Balance, **Notification Channels**, **Auto Recharge** (defaults: recharge by $20 when the balance falls to $10), Custom SMTP Configs, Twilio (Call/SMS) configs. Notification Logs tabs: Email, SMS, WhatsApp, Telegram, Webhook, Call, Push, Workspace.
Billing: Current Plan with **Change Plan**; Yearly Plan "(Save 20%)"; Seats; Payment Methods (**Add Payment Method**, **Set as Default**, **Re-sync Autopay**); Business Details / Billing Address (Country, Finance / Accounting Email, Send Invoices by Email); Customer Balance. Usage History: "Telemetry Usage History" — Product, Day, Service, Data Ingested (in GB), Data Retention (in Days), Total Cost. Invoices: Download, **Pay Invoice**.
Audit logs: "All changes made to the resources in this project." Recorded for Enterprise plan projects only.
Danger Zone: "Deleting your project will delete it permanently…"; Delete stays locked until you type the project name; Cloud also asks an optional "Why are you deleting this project?".
Plan gates (Cloud): Labels (create) Growth; API Keys Growth; Probes Growth; SMTP configs Growth; Team create Scale (update Growth); SSO / OIDC / SCIM Scale. (Plan ordering comes from env config — say "on OneUptime Cloud, requires the X plan" without ranking plans.)

## P14. Topology — telemetry/topology "Topology"

Where: Products → Observability → **Topology**, also Inventory → **Topology Map**. Tabs **Service Map**, **Infrastructure**, **Network**. Only resources that reported in the selected range are drawn unless **Show inactive** is on. The Network tab is a live LLDP view; the time picker hides on it. Service-map edges are computed every 10 minutes from the last 15 minutes of spans.

## P15. People: inviting members & your account

Inviting (permissions/inviting-people "Inviting People"): Settings → **Users**: card "Everyone who can sign in to this project…", button **Invite User**; dialog "Invite New User": **Email** (placeholder member@company.com), **Name** (only for emails not yet registered), **Team** (starts on the members team), submit **Invite**. With SCIM Push Groups: notice "Users are managed by SCIM Push Groups". Invitees accept on **Project Invitations** → "Pending Invitations" → **Accept**. Member page: Profile, Teams, On-Call (Readiness, Notification Methods, On-Call Rules), Custom Fields, **Remove from Project**. Team Compliance: Team → Compliance (Scale on Cloud, or Enterprise Edition self-hosted).
Your account (introduction/your-account "Your Account"): user menu → **Profile**: Overview: Basic Info with Email, Full Name, **Timezone** ("Select your timezone…"); Profile Picture; Security: Password Management, Passkeys, **Two-factor authentication** ("Authenticator apps", **Add**, backup codes); Danger Zone: Delete Account.

## P16. Home & keyboard shortcuts (introduction/home "The Home Page & Shortcuts")

Home: "Welcome to OneUptime 👋" checklist with four tasks: Create your first monitor, Publish a status page, Invite your team, Set up an on-call policy; each completes when ≥1 monitor, ≥1 status page, >1 team member, ≥1 on-call policy exists; hides when all four are done or dismissed (per browser and project). Overview tiles: Active incidents, Active alerts, Not operational monitors, Ongoing maintenance, SLOs at risk. An "Active Incidents" table. Side menu: Incidents (Active Incidents, Active Episodes), Alerts (Active Alerts, Active Episodes), Monitors (Not Operational), Scheduled Events (Ongoing). A user with no projects goes to the Welcome page with **Create New Project**.
Keyboard shortcuts: Mod+K command palette, Mod+I Ask AI, `/` search the list on the page, `?` shortcut help, Esc closes; **g then** h Home, m Monitors, i Incidents, a Alerts, o On-Call Duty, s Status Pages, e Scheduled Maintenance, d Dashboards, l Logs, t Traces.

## P17. Postmortems — incidents/postmortems "Postmortems"

The incident's **Postmortem** page: "Postmortem Note", "Postmortem Attachments", "Postmortem visible on Status Page?", Notify Subscribers, Subscriber Notification Status, Postmortem Published At; dialogs "Edit Postmortem Note" and "Generate Postmortem with AI" (D/Pages/Incidents/View/Postmortem.tsx). Episodes have the same page. Existing material to pull together and link: incidents/index, incidents/settings (postmortem templates), status-pages/subscribers#the-postmortem, ai/ai-sre (auto postmortem).

## Known inaccuracies in existing pages
1. "Left navigation" is gone — products open from the top-bar Products menu (incidents/index, incidents/settings, status-pages/index, workflows/index, dashboards/index, telemetry/ai-agent-circuit-breaker).
2. ai/ai-agent says the task page is under **AI** > **Tasks**; Tasks is in the **Code** category.
3. incidents/index says owners are notified by "email, SMS, call, push and WhatsApp"; owner notifications also go via Telegram, Slack, Microsoft Teams and webhook.
4. on-call/incoming-call-policy says to add the number under User Settings > Notification Methods > "Incoming Call Numbers"; it is **User Settings → Incoming Call Policy → Incoming Phone Numbers**, card "Phone Numbers for Incoming Call Routing", "Only one verified phone number… per project".
5. on-call/calendar-feeds says set your time zone under User Settings > Profile; the timezone is on the user-menu **Profile** page.
6. permissions/index says "Create as many additional teams as you like" without a plan caveat (team create needs Scale on Cloud); real paths are Project Settings → Basic → Labels and Project Settings → Advanced → API Keys.
7. telemetry/open-telemetry: title ends with a period; ingestion keys are under Project Settings → **Telemetry & APM** → **Ingestion Keys**; image alt texts read "Create Service" / "View Service".
8. on-call/phone-number-whitelist: the two numbers could not be verified in code.
9. Product copy bugs (not docs): EpisodeDocs.tsx shows `{alertTitle}` but the engine uses `{{alertTitle}}`; the seeded alert Resolved description mentions "incident".
