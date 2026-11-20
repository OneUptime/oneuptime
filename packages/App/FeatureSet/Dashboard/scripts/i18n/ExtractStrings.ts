import { REPOSITORY_ROOT } from "./LocaleFiles";
import {
  FormColumnDescription,
  FormColumnDescriptionFinder,
} from "./FormColumnDescriptions";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Finds the user-facing strings in the Dashboard's source, the shared UI
 * components it renders and the data models whose names those components
 * show, by reading the TypeScript syntax tree - never by searching text, so
 * a string's position decides whether it is copy, not its spelling.
 *
 * A string is user-facing when it is:
 *
 *   - "call":           the key passed to a translation function - t(),
 *                       tx(), translateString(), translateTemplate(),
 *                       translationKey(), any translate*() helper - or the
 *                       text of a translatableTerm(), which is looked up
 *                       when the sentence it goes into is translated;
 *   - "plural":         a PluralTemplate, { one: "...", other: "..." },
 *                       its forms written as literals or marked as keys
 *                       (translationKey("...")) - its "one" sentence goes
 *                       under the "other" sentence's key plus "_one";
 *   - "prop":           a JSX attribute or object property whose name says
 *                       it is shown (title, description, placeholder, label,
 *                       noItemsMessage... - USER_FACING_PROPS), a tab's
 *                       name, or a title in a list of titles a call draws
 *                       (a page's breadcrumbs - TITLE_LIST_ARGUMENT_INDEX);
 *   - "jsx-text":       the whole text of an element (<p>No data yet.</p>),
 *                       or a string literal standing alone as a child;
 *   - "setter":         the message given to a state setter such as
 *                       setError("...") or setWarningMessage("...");
 *   - "model":          a model's singularName, pluralName or
 *                       tableDescription, or a column's title;
 *   - "column":         a model column's description a form field draws
 *                       because it has none of its own
 *                       (FormColumnDescriptions).
 *
 * It also lists the strings that are on screen but not looked up at run
 * time (`hardcoded`): element text, text attributes of plain HTML elements,
 * and sentences glued together from pieces. That list is the work left for
 * whoever routes a directory through translation (npm run i18n:hardcoded).
 */

export type ExtractedKind =
  | "call"
  | "plural"
  | "prop"
  | "jsx-text"
  | "setter"
  | "model"
  | "column";

export interface ExtractedString {
  text: string;
  kind: ExtractedKind;
  // Repository-relative, with forward slashes.
  file: string;
  line: number;
  // A PluralTemplate's "one" sentence; `text` is its "other" sentence.
  pluralOne?: string | undefined;
  /*
   * A nested key read with t("commandPalette.actions.signOut", "Sign Out"):
   * its path, with `text` the English default the call gives.
   */
  nestedPath?: Array<string> | undefined;
}

/*
 * A nested key a t() call reads without giving its English text, which
 * en.json does not have either - shown to the reader as the raw key.
 */
export interface UndefinedNestedKey {
  path: Array<string>;
  file: string;
  line: number;
}

export type HardcodedReason =
  // Text between tags, or a string literal standing in for it.
  | "jsx-text"
  // title / placeholder / aria-label / alt on a plain HTML element.
  | "html-attribute"
  // A sentence built from pieces: a template literal or "a" + b.
  | "composed";

export interface HardcodedString {
  text: string;
  reason: HardcodedReason;
  file: string;
  line: number;
}

export interface SourceScanResult {
  strings: Array<ExtractedString>;
  hardcoded: Array<HardcodedString>;
  // Nested keys read with no English default anywhere in the call.
  nestedKeyReferences: Array<UndefinedNestedKey>;
}

/*
 * How a root is read:
 *
 *   - "ui":     every string a person reads (see the kinds above);
 *   - "models": a model's names and its columns' titles;
 *   - "keys":   only what the file marks as a key - the text of a
 *               translation call, translationKey("...") - in a file whose
 *               other words are drawn as written. TraceSpanType's choices
 *               read "Entry spans" in every language, as the translated docs
 *               quote them, while what each one is reads in the reader's.
 */
export type SourceKind = "ui" | "models" | "keys";

export interface SourceRoot {
  // Repository-relative directory, or one file in a directory of its own.
  directory: string;
  kind: SourceKind;
}

/*
 * Everything the Dashboard puts on screen comes from these. Stage-2 work
 * that routes strings from elsewhere (Common/Types, say) through translation
 * adds the directory here, so those strings are extracted too.
 */
export const SOURCE_ROOTS: Array<SourceRoot> = [
  { directory: "packages/App/FeatureSet/Dashboard/src", kind: "ui" },
  /*
   * The audit log's screens are Enterprise code, which the Dashboard draws
   * through its plugins: the table on every resource page, its changes
   * dialog and Settings > Audit Logs (#8291, #8319). They hold their words
   * in the Dashboard's locales, so the extractor reads them as it reads the
   * Dashboard's own. The rest of ee/Dashboard is not read yet: each screen
   * comes in as its words are routed through the translator.
   */
  { directory: "ee/Dashboard/AuditLogs", kind: "ui" },
  /*
   * Teams > Compliance, the SCIM pages and their logs, the telemetry
   * retention overrides, and the notice an Enterprise setting's screen
   * shows when the license lapses: Enterprise screens whose every word goes
   * through the reader's Translator since #8296 and #8461. Before, none was
   * read here, so about 116 of their words were in no locale and every
   * reader got them in English.
   */
  { directory: "ee/Dashboard/TeamCompliance", kind: "ui" },
  { directory: "ee/Dashboard/Identity", kind: "ui" },
  { directory: "ee/Dashboard/TelemetryRetention", kind: "ui" },
  { directory: "ee/Dashboard/EnterpriseSettings", kind: "ui" },
  /*
   * The team compliance rules' catalog: each rule kind's and channel's
   * name, what each kind checks, and the sentence a rule reads as on the
   * Compliance page. Only the words the file marks are read: the server
   * evaluates rules with the same file and keeps its own English.
   */
  { directory: "packages/Common/Types/Team/ComplianceRule.ts", kind: "keys" },
  /*
   * What the compliance page says is wrong with a rule, and why a member
   * fails one: the server sends what it found, and the page words it here
   * (#8632). Only the words the file marks are read.
   */
  {
    directory: "packages/Common/Types/Team/TeamComplianceFindings.ts",
    kind: "keys",
  },
  /*
   * Why a team or a label may not take a name (#9674): another one of the
   * project has it. The server refuses in English, and the Dashboard says
   * the refusal in the reader's language under the form's Name field.
   */
  {
    directory: "packages/Common/Types/Database/UniqueName.ts",
    kind: "keys",
  },
  /*
   * The rest of the Enterprise screens the Dashboard draws (#8634): custom
   * roles, the audit log export, the IP allowlists, the license pages, and
   * the status pages' access controls and branding. Every word they draw
   * goes through the reader's Translator, so each new one reaches the
   * locales the way the Dashboard's own do.
   */
  { directory: "ee/Dashboard/CustomRoles", kind: "ui" },
  { directory: "ee/Dashboard/AuditLogExport", kind: "ui" },
  { directory: "ee/Dashboard/IpAllowlists", kind: "ui" },
  { directory: "ee/Dashboard/License", kind: "ui" },
  { directory: "ee/Dashboard/StatusPageAccessControls", kind: "ui" },
  { directory: "ee/Dashboard/StatusPageBranding", kind: "ui" },
  { directory: "packages/Common/UI", kind: "ui" },
  { directory: "packages/Common/Models/DatabaseModels", kind: "models" },
  { directory: "packages/Common/Models/AnalyticsModels", kind: "models" },
  // What a failed vCenter collection means and what fixes it (VMwareCollectionError).
  { directory: "packages/Common/Types/VMware", kind: "ui" },
  // What a failed OpenStack collection means and what fixes it (OpenStackCollectionError).
  { directory: "packages/Common/Types/OpenStack", kind: "ui" },
  /*
   * What a case's verdicts mean, and what each playbook action does: the
   * close dialog and the step editor show them as written there.
   */
  { directory: "packages/Common/Types/SecurityCase", kind: "ui" },
  { directory: "packages/Common/Types/SecurityPlaybook", kind: "ui" },
  /*
   * The AI connections' catalog: each provider's title, description, what
   * arrives, where its credential comes from, and its fields - the Connect
   * page and the connection form show them as written there.
   */
  { directory: "packages/Common/Types/LlmObservability", kind: "ui" },
  /*
   * The cloud connections' catalog: each cloud's title, description, sign
   * in methods, shell and fields - the Connect page and the connection form
   * show them as written there.
   */
  { directory: "packages/Common/Types/CloudConnection", kind: "ui" },
  /*
   * A managed device's status - Online, Offline, Provisioning and the rest -
   * as Inventory > Managed Devices and a device's Inventory page draw it.
   * Only the names the file marks are read: the server words nothing here.
   */
  {
    directory: "packages/Common/Types/DeviceManagement/ManagedDeviceStatus.ts",
    kind: "keys",
  },
  /*
   * What a monitor's pages are told by the shared monitor helpers: the
   * overview's hero, facts and sections, its uptime windows and its metric
   * groups - each helper writes them with the reader's Translator.
   */
  { directory: "packages/Common/Utils/Monitor", kind: "ui" },
  /*
   * What a monitor's Incident Metrics and Alert Metrics charts, and an
   * SLO's, draw: each chart's title, its legend and what it shows (#8282).
   * Only the words the files mark are read: the metric names and units
   * they also hold are stored as written.
   */
  {
    directory: "packages/Common/Utils/Incident/IncidentMetricType.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Utils/Alerts/AlertMetricType.ts",
    kind: "keys",
  },
  { directory: "packages/Common/Utils/Slo/SloMetricType.ts", kind: "keys" },
  /*
   * What is wrong with a one-time code (TOTP) monitor secret's setup key or
   * otpauth:// link, which the secret's form says as it is typed (#9703).
   * Only the sentences the file marks are read: the server and the probe
   * read the same file.
   */
  { directory: "packages/Common/Utils/Totp/TotpSecret.ts", kind: "keys" },
  /*
   * What the server stores as each monitor series' description, which the
   * metrics list words under the series' name (#8356).
   */
  {
    directory: "packages/Common/Server/Utils/Monitor/MonitorMetricUtil.ts",
    kind: "keys",
  },
  /*
   * A duration in milliseconds in the reader's language ("{{value}} ms"):
   * the Dashboard's views and the overview's hero write it with one helper.
   */
  { directory: "packages/Common/Utils/Milliseconds.ts", kind: "ui" },
  /*
   * Every dashboard widget's settings: each setting's and section's name,
   * what it does, its placeholder and its options, which the widget
   * settings form looks up as it draws them. They were never extracted, so
   * every widget's form read English in every language - the Incident
   * List's Lifecycle State filter "Unresolved (open)" (#8164), a Chart's
   * "Chart Type" and "Stacked Area Chart" (#8479). A setting's name is a
   * word by its type (ComponentArgument, PROPS_IN_LISTS).
   */
  { directory: "packages/Common/Utils/Dashboard/Components", kind: "ui" },
  /*
   * The monitor types' cards in Create Monitor's picker: each type's title
   * and what it alerts on, and the categories More lists them under.
   */
  { directory: "packages/Common/Types/Monitor/MonitorType.ts", kind: "ui" },
  /*
   * A new monitor's default criteria, written in the language of the person
   * creating it: each criteria's name and description, and the title and
   * description of every incident and alert it opens. Only the sentences the
   * builders look up are read - filter values, keywords and ids stay as
   * written.
   */
  {
    directory: "packages/Common/Types/Monitor/MonitorCriteriaInstance.ts",
    kind: "keys",
  },
  /*
   * The name a guided setup's status page starts with ("Acme Status"), in
   * the language of the person it is made for - the guided setup's and Ask
   * AI's alike (#7247). Only the sentence the file marks is read.
   */
  {
    directory: "packages/Common/Utils/GuidedSetup/StatusPageRecords.ts",
    kind: "keys",
  },
  /*
   * The name a project's first on-call policy starts with, and the names
   * and descriptions of the two on-call rules made with it, in the
   * language of the person they are made for - the guided setups', Create
   * On-Call Policy's and Ask AI's alike (#7995). Only the sentences the
   * files mark are read.
   */
  {
    directory: "packages/Common/Utils/GuidedSetup/OnCallPolicyRecords.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Types/OnCallDutyPolicy/EveryNewEventRules.ts",
    kind: "keys",
  },
  /*
   * A monitor template's Template sync settings (#7546): the name of each
   * field a linked monitor can keep its own value for, and what it keeps
   * together, as the card and its summary line say them. Only the words the
   * file marks are read: each field's path is stored in a template's
   * doNotSyncFields as written.
   */
  {
    directory: "packages/Common/Types/Monitor/MonitorTemplateSyncField.ts",
    kind: "keys",
  },
  // A cron schedule in words: the monitor's interval, a workflow's schedule.
  { directory: "packages/Common/Utils/CronScheduleText.ts", kind: "ui" },
  /*
   * What Import from Grafana or Datadog and Import Alerts say about each
   * panel, variable and rule of a file, and why a file is refused (#7697):
   * the converters mark them, and the preview words them in the reader's
   * language. Only the words the files mark are read.
   */
  { directory: "packages/Common/Utils/ObservabilityImport", kind: "keys" },
  /*
   * What each Setup health finding says (#6812): the server sends its
   * template, and the page says it in the reader's language.
   */
  {
    directory: "packages/Common/Types/SetupHealth/SetupHealth.ts",
    kind: "ui",
  },
  /*
   * Why an email was not sent when the server has no email set up: the
   * project's Email Logs show it in the reader's language. Only the words
   * the file marks are read.
   */
  {
    directory: "packages/Common/Types/ServerSending/ServerSendingWords.ts",
    kind: "ui",
  },
  // The common schedules a workflow's Schedule trigger offers.
  { directory: "packages/Common/Utils/CronTab.ts", kind: "ui" },
  /*
   * What each placeholder a playbook's note or message may use stands for:
   * the step editor lists them under its field, said on hover.
   */
  {
    directory: "packages/Common/Utils/SecurityCase/SecurityCaseMarkdown.ts",
    kind: "ui",
  },
  /*
   * A case's Response Plan (#9557), shared with the server, OneUptime AI and
   * the mobile app (#10340): every step's words and its buttons', and what
   * OneUptime's own checks of the steps say. The card looks each up as it
   * draws it; the server keeps a step's key and its evidence's keys, never
   * the words.
   */
  {
    directory: "packages/Common/Utils/SecurityCase/ResponsePlan",
    kind: "ui",
  },
  /*
   * What is wrong with a detection rule exception, field by field: the
   * Add Exception form shows each problem under its field, in the
   * reader's language, and the API answers a save with the same words.
   */
  {
    directory: "packages/Common/Types/SecurityEvent/DetectionRuleException.ts",
    kind: "ui",
  },
  /*
   * What is wrong with a watchlist or one of its values: the forms and the
   * Import Values preview show each problem in the reader's language, and
   * the API answers a save with the same words.
   */
  {
    directory: "packages/Common/Types/SecurityEvent/SecurityWatchlist.ts",
    kind: "ui",
  },
  /*
   * What is wrong with a Security Events monitor's watchlist filters: the
   * monitor's form shows it under Filter by Watchlists, and the API answers
   * a save with the same words.
   */
  {
    directory: "packages/Common/Types/SecurityEvent/SecurityWatchlistFilter.ts",
    kind: "ui",
  },
  /*
   * What is wrong with a hunt, and why a scheduled run could not be made:
   * the hunt's form shows each problem under its field, and its page and
   * the Hunts list say the last run's in the reader's language.
   */
  {
    directory: "packages/Common/Types/SecurityEvent/SecurityHunt.ts",
    kind: "ui",
  },
  /*
   * The Hunt Library's starters: each one's name and what it finds, as its
   * row draws them and the hunt it becomes is named and described, in the
   * reader's language. Its search is drawn as written.
   */
  {
    directory: "packages/Common/Types/SecurityEvent/SecurityHuntLibrary.ts",
    kind: "ui",
  },
  /*
   * A Security Events connection's own words: what it imports - Google
   * SecOps' Data to import, Alerts, Detections, Alerts only - which the
   * connection form, the connections list and the diagnostics put in the
   * reader's language and into their sentences (#6658), and every field's
   * title, description and choices plus each provider's description, which
   * the connection form draws (#6700). Only the words the file marks are
   * read: provider names, vendor names, field keys and placeholders that
   * show a value to type (an ID, an address, a query) stay as written.
   */
  {
    directory:
      "packages/Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog.ts",
    kind: "keys",
  },
  /*
   * What each of the traces explorer's span types is: the (i) beside the
   * Span Type choice lists them, and each choice says its own. Only the
   * sentences the file marks are read: the choices' names are drawn as
   * written in every language.
   */
  {
    directory: "packages/Common/Types/Telemetry/TraceSpanType.ts",
    kind: "keys",
  },
  /*
   * What Give Feedback can be about - "Something's broken", "Idea" - as the
   * dialog offers it (#8893). Only the names the file marks are read: the
   * rest of it is the server's rules for asking people.
   */
  {
    directory: "packages/Common/Types/ProductFeedback/ProductFeedback.ts",
    kind: "keys",
  },
  /*
   * What Ask AI's answers rated down drew on that is no product - the
   * docs, other data, nothing - as Settings > AI > AI Results' Ask AI
   * Answers card names it (#7365). Only the words the file marks are read.
   */
  {
    directory: "packages/Common/Types/AI/AskAiRatings.ts",
    kind: "keys",
  },
  /*
   * An audit log entry's action in words - Sign In, Session Timeout - as
   * the audit log's Action column and its Action filter draw it, and a
   * workflow run's status - Timeout, Execution Exceeded Current Plan - as
   * the runs' Status pill and their Status filter draw it (#7781). Only the
   * words the files mark are read: the stored values they label are not.
   */
  {
    directory: "packages/Common/Types/AuditLog/AuditLogActionLabel.ts",
    kind: "keys",
  },
  /*
   * What the audit log's changes dialog calls each field of a session entry
   * ("Signed in with", "Timed out at"), in the reader's language (#8291).
   * Only the labels the file marks are read: the stored values are not.
   */
  {
    directory: "packages/Common/Types/AuditLog/AuditLogSessionEvent.ts",
    kind: "keys",
  },
  /*
   * Why a sign-in failed ("Wrong password", "Too many wrong codes") and the
   * attempt an entry is about ("Sign-In Attempt"), as the audit log's
   * table and dialog draw them (#6788). Only the words the file marks are
   * read: the stored reasons they label are not.
   */
  {
    directory: "packages/Common/Types/AuditLog/AuditLogSignInFailure.ts",
    kind: "keys",
  },
  /*
   * What the server answers a confirmation of Confirm It's You with (#10155):
   * a wrong password or code, a key not accepted, too many attempts. The
   * prompt says each under its field, in the reader's language. Only the
   * words the file marks are read.
   */
  {
    directory: "packages/Common/Types/Accounts/Reauthentication.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Types/Workflow/WorkflowStatus.ts",
    kind: "keys",
  },
  /*
   * The workflow builder's step catalogue (#8359): each step's title and
   * what it does, each setting's name, help and choices, each output's
   * name and help, each returned value's name and what it holds, and the
   * Add Component panel's groups. The canvas, the settings panel, the
   * value picker and the run log look each one up as they draw it. Only
   * the words the files mark are read: ids, the references a workflow
   * stores ({{local.components...}}), example values and a Switch / Case's
   * cases (people name them) stay as written. A record step's words are
   * sentences with its model's name in them ("Find One {{itemName}}",
   * #8642), read as the sentence they were built from (ComposedWords).
   */
  { directory: "packages/Common/Types/Workflow/Components", kind: "keys" },
  { directory: "packages/Common/Types/Workflow/Components.ts", kind: "keys" },
  // The Affected Resources setting the incident and alert steps share.
  {
    directory: "packages/Common/Types/Workflow/AffectedResourcesSetting.ts",
    kind: "keys",
  },
  // Create One Incident's template, and the owners Create One Incident and Alert take.
  {
    directory: "packages/Common/Types/Workflow/CreateFromTemplate.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Types/Workflow/OwnersOnCreateSetting.ts",
    kind: "keys",
  },
  /*
   * A naming rule's name pattern and lookup table (issue #6619): what each
   * placeholder is, and what is wrong with a pattern or a table, as the
   * rule form says it. Only the sentences the files mark are read: the
   * placeholders themselves ({site.code}) are drawn as written.
   */
  {
    directory: "packages/Common/Utils/NetworkDevice/Naming/NamePattern.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Utils/NetworkDevice/Naming/NamingLookup.ts",
    kind: "keys",
  },
  /*
   * Why Add or Delete is locked on the Global User Overrides page for a
   * reader whose permission to add or delete overrides covers only some
   * policies - the words the server refuses with. Only the sentences the
   * file marks are read.
   */
  {
    directory:
      "packages/Common/Types/OnCallDutyPolicy/GlobalUserOverrideAccess.ts",
    kind: "keys",
  },
  /*
   * What a user override overlaps (issue #7630) - the server's refusal and
   * the dialog's words as soon as the times are picked, the notes on an
   * overlap the rule allows, and the lists' "Overlaps" mark - and why an
   * edit of one is refused (issue #7631). The server says them in English;
   * the dashboard in the reader's language. Only the sentences the files
   * mark are read.
   */
  {
    directory: "packages/Common/Types/OnCallDutyPolicy/UserOverrideOverlap.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Types/OnCallDutyPolicy/UserOverrideEdit.ts",
    kind: "keys",
  },
  /*
   * Why an override that names somebody outside the reader's teams is
   * refused, and why a picker offers only their teams' people (issue
   * #9733): the server says them in English, the dashboard in the
   * reader's language. Only the sentences the file marks are read.
   */
  {
    directory:
      "packages/Common/Types/OnCallDutyPolicy/UserOverrideTeamAccess.ts",
    kind: "keys",
  },
  /*
   * What a dashboard template's chart says while it draws its fallback
   * query - why, and where the fix is. Stored in the dashboard as written
   * and looked up where the chart draws it; only the hints the file marks
   * are read.
   */
  {
    directory:
      "packages/Common/Types/Dashboard/DashboardTemplateFallbackHints.ts",
    kind: "keys",
  },
  /*
   * How a change OneUptime AI proposes went the last times it ran on the
   * same cluster or resource: the Remediation step says it under the
   * change.
   */
  {
    directory:
      "packages/Common/Types/AutoRemediation/RemediationTrackRecordWords.ts",
    kind: "ui",
  },
  /*
   * A cloud change in plain words, above its exact command on the
   * Remediation step: each change's sentence and each kind of resource.
   */
  {
    directory: "packages/Common/Utils/AiRemediation/CloudChangeWords.ts",
    kind: "ui",
  },
  /*
   * A Kubernetes object's status and what needs attention about it, by the
   * cluster's own rules: the Overview's Needs attention, every part's page,
   * the lists and the Topology say them in the reader's language. Only the
   * words the file marks are read: Kubernetes' own reasons
   * (CrashLoopBackOff, OOMKilled) are drawn as written.
   */
  {
    directory: "packages/Common/Types/Kubernetes/KubernetesHealth.ts",
    kind: "keys",
  },
  /*
   * When a claim's or a node's disk needs someone, by the same rules: its
   * status ("Nearly full", "Disk almost full") and why ("91% used, 4.5 GiB
   * free", "Full in about 3 days"), the sizes and percents as values.
   */
  {
    directory: "packages/Common/Types/Kubernetes/KubernetesStorageHealth.ts",
    kind: "keys",
  },
  /*
   * The Pod Security Standards' and the CIS Kubernetes Benchmark's controls
   * a cluster's Compliance page scores (#9627): each one's title, what it
   * finds wrong and how to fix it, and why the benchmark's other controls
   * are not scored. Only the words the file marks are read: field names and
   * values are Kubernetes', drawn as written.
   */
  {
    directory:
      "packages/Common/Types/Kubernetes/Compliance/KubernetesComplianceCatalog.ts",
    kind: "keys",
  },
  /*
   * The CIS benchmarks' node and control plane controls kube-bench reads on
   * the nodes (#9873): each one's short title, what its section looks at and
   * how to fix it. Only the words the file marks are read: flags, paths and
   * commands are drawn as written.
   */
  {
    directory:
      "packages/Common/Types/Kubernetes/Compliance/KubernetesNodeBenchmarkCatalog.ts",
    kind: "keys",
  },
  /*
   * The NSA/CISA Kubernetes Hardening Guide's controls (#9875): each one's
   * title, what it finds wrong, how to fix it and the guide's section it is
   * from, and why the guide's other recommendations are not scored.
   */
  {
    directory:
      "packages/Common/Types/Kubernetes/Compliance/NsaCisaHardening.ts",
    kind: "keys",
  },
  /*
   * Why the OneUptime agent's own workloads need what the controls fail
   * (#9929), and the value that removes each. Settings are drawn as written.
   */
  {
    directory:
      "packages/Common/Types/Kubernetes/Compliance/KubernetesAgentWorkloads.ts",
    kind: "keys",
  },
  /*
   * A host's status and what needs attention on it, by one set of rules:
   * the Hosts list and its Needs attention card, a host's hero and page,
   * and its Topology say them in the reader's language. Only the words the
   * file marks are read: mount points and unit names are drawn as written.
   */
  {
    directory: "packages/Common/Types/Host/HostHealth.ts",
    kind: "keys",
  },
  /*
   * A database's status and what needs attention on it, by the lines of its
   * engine's recommended alerts: the Databases list and its Needs attention
   * card, a database's hero and its Needs attention say them in the
   * reader's language. Only the words the file marks are read: the alert
   * templates' own names and the metric names stay as written.
   */
  {
    directory: "packages/Common/Types/DatabaseServer/DatabaseHealth.ts",
    kind: "keys",
  },
  /*
   * What a custom domain's DNS check looked up and what came back, and what
   * a self-hosted server still needs before a custom domain can work: DNS
   * Setup and Add Custom Domain say them in the reader's language. Only the
   * words the files mark are read: record types and hostnames stay as
   * written.
   */
  {
    directory: "packages/Common/Types/CustomDomain/DnsRecordCheckWords.ts",
    kind: "keys",
  },
  {
    directory:
      "packages/Common/Types/CustomDomain/CustomDomainServerReadiness.ts",
    kind: "keys",
  },
  /*
   * Why a custom domain's uploaded certificate and key were not saved: the
   * server's refusals, which the Edit dialog says under the half they are
   * about, in the reader's language. Only the words the file marks are read.
   */
  {
    directory:
      "packages/Common/Types/CustomDomain/UploadedCertificateRefusals.ts",
    kind: "keys",
  },
  /*
   * An error nobody explained (#6836): what happened, what to do next and
   * where to look, which ErrorExplanation says in the reader's language.
   * Only the words the file marks are read.
   */
  {
    directory: "packages/Common/Types/Exception/UnexplainedError.ts",
    kind: "keys",
  },
  /*
   * Why a data check or a reconciliation was not written, added or set up
   * (#7530): the server's refusals, which Write a Check from a Sentence,
   * Suggested Checks and the Reconciliations page say in the reader's
   * language. Only the words the file marks are read.
   */
  {
    directory: "packages/Common/Types/DataObservability/DataCheckRefusals.ts",
    kind: "keys",
  },
  /*
   * A RUM application's status - Receiving data, No recent traffic, Waiting
   * for data - and what each means: the RUM Applications list and an
   * application's hero say them in the reader's language. Only the words
   * the file marks are read: OneUptime AI's tool reads the same English.
   */
  {
    directory: "packages/Common/Types/Rum/RumApplicationStatus.ts",
    kind: "keys",
  },
  /*
   * Session Replay's recording health: why recordings are missing - each
   * reason's label, what it means and the button that fixes it - and the
   * ages, durations and counts its copy writes ("5m ago", "7h"), which the
   * Recording health page and card, the setup guide and the replay settings
   * say in the reader's language. Only the words the file marks are read:
   * its reason codes and field names stay as written.
   */
  {
    directory: "packages/Common/Utils/SessionReplay/SessionReplayHealth.ts",
    kind: "keys",
  },
  /*
   * A dashboard's SLO widgets: the single SLO's metric labels, "Not
   * evaluated yet", the line under its error budget ("43 min remaining")
   * and under its SLI ("target 99.9%"), and the SLO list's Not Evaluated
   * and Disabled. Only the words each file marks are read: the metric names
   * the worker writes and the API's values stay as written.
   */
  {
    directory: "packages/Common/Utils/Slo/SloWidgetFormat.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Utils/Slo/SloListWidgetFormat.ts",
    kind: "keys",
  },
  /*
   * The banner at the top of an SLO's pages: each notice's title, its
   * sentence of what to do and its link (#8446). The banner looks them up;
   * the worker's statuses they are read from stay as written.
   */
  {
    directory: "packages/Common/Utils/Slo/SloHealth.ts",
    kind: "keys",
  },
  // What the SLO forms say of a request filter they cannot read (#8444).
  {
    directory: "packages/Common/Utils/Slo/SloRequestFilter.ts",
    kind: "keys",
  },
  // What the SLO forms say of a Metric SLO's metric they cannot count (#8445).
  {
    directory: "packages/Common/Utils/Slo/SloMetricSli.ts",
    kind: "keys",
  },
  /*
   * A serverless function's status - Receiving data, No recent
   * invocations, Waiting for data - and a service's - Receiving data, No
   * recent data, Waiting for data - and what each means: the Serverless
   * Functions list, a function's hero and a service's hero say them in the
   * reader's language. Only the words each file marks are read, not the
   * stored values the statuses are read from.
   */
  {
    directory: "packages/Common/Types/Serverless/ServerlessFunctionStatus.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Types/Service/ServiceTelemetryStatus.ts",
    kind: "keys",
  },
  /*
   * Where a database or a queue was found ("Application traces", "Added
   * manually") and what kind of cloud resource one is ("Databases and
   * caches"): a database's and a queue's Overview, their lists and a cloud
   * resource's Details say them in the reader's language. Only the words
   * each file marks are read: the server writes the same labels in English
   * (a database's Feed), and the rest of the files are not shown.
   */
  {
    directory:
      "packages/Common/Types/DatabaseServer/DatabaseServerDiscoverySource.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Models/DatabaseModels/MessageQueue.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Types/Cloud/CloudResourceCatalog.ts",
    kind: "keys",
  },
  /*
   * The managed platforms an app runs on (App Platforms): the line the
   * environment guide's picker shows under each, in the reader's language.
   * Only the words the file marks are read: a platform's label and product
   * name are its own, and name environments as ingest mints them.
   */
  {
    directory: "packages/Common/Types/Cloud/CloudPlatform.ts",
    kind: "keys",
  },
  /*
   * A cloud resource's status and what needs attention on it, by one set
   * of rules from its key metrics: the Cloud Overview's Needs attention,
   * the lists, a resource's hero and tiles say them in the reader's
   * language. Only the words the file marks are read: a metric's name is
   * drawn as written.
   */
  {
    directory: "packages/Common/Types/Cloud/CloudResourceHealth.ts",
    kind: "keys",
  },
  /*
   * The sections a cloud resource's metrics read in - Availability,
   * Traffic, Errors, Latency and the rest - on its Overview's Metrics card
   * and its Metrics tab, each heading in the reader's language. Only the
   * words the file marks are read.
   */
  {
    directory: "packages/Common/Types/Cloud/CloudKeyMetricGroup.ts",
    kind: "keys",
  },
  /*
   * Why a cloud resource did not report one of its key metrics (#9569):
   * the catalog's conditions - "Only a replica reports it." - and the
   * reasons and fixes its Metrics list opens to, in the reader's language.
   * Only the words the files mark are read: a metric's name is the cloud's.
   */
  {
    directory: "packages/Common/Types/Cloud/CloudKeyMetricCondition.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Types/Cloud/CloudUnreportedKeyMetrics.ts",
    kind: "keys",
  },
  /*
   * Why one of the other metrics a cloud resource publishes cannot be
   * added (#9563), under it in the resource's More Metrics.
   */
  {
    directory: "packages/Common/Types/Cloud/CloudPublishedMetrics.ts",
    kind: "keys",
  },
  /*
   * What the clouds cost and how to spend less: the kinds of saving the
   * Savings page and its strip name. Only the words the file marks are
   * read: the server keeps the clouds' own words for a recommendation.
   */
  {
    directory: "packages/Common/Types/Cloud/CloudCost.ts",
    kind: "keys",
  },
  /*
   * What each cloud calls its commitments - Savings Plans, reservations,
   * committed use discounts - on Savings' and an account's Commitments
   * card. Only the words the file marks are read.
   */
  {
    directory: "packages/Common/Types/Cloud/CloudCommitments.ts",
    kind: "keys",
  },
  /*
   * A resource's right-sizing from OneUptime's own readings: its verdict,
   * what to change and why, on its Overview. Only the words the file marks
   * are read: a size is its cloud's own name, drawn as written.
   */
  {
    directory: "packages/Common/Types/Cloud/CloudRightSizing.ts",
    kind: "keys",
  },
  /*
   * A cloud change's title - "Failed: DeleteLoadBalancer on web-alb" - in
   * the reader's language: a cloud resource's and an account's Changes,
   * the chart markers and the security cards word it from what the change
   * keeps. Only the frame is a key: the operation and the resource are the
   * cloud's words and OneUptime's names, drawn as written.
   */
  {
    directory: "packages/Common/Utils/Telemetry/CloudChangeTitle.ts",
    kind: "keys",
  },
  /*
   * A cloud health event's description: OneUptime's own sentences in it -
   * an Azure event's kind and tracking id, what caused a resource's change,
   * the products an incident affects - in the reader's language. Only the
   * sentences are keys: the provider's own words are drawn as written.
   */
  {
    directory: "packages/Common/Utils/Telemetry/CloudHealthDescription.ts",
    kind: "keys",
  },
  /*
   * The column titles of the tables OneUptime AI's tools put beside an
   * answer ("Time", "Severity", "Last seen"): the chat draws each in the
   * reader's language (DataTableWidget). Only the titles the tools mark are
   * read: their prompts and what they hand the model stay in English.
   */
  {
    directory: "packages/Common/Server/Utils/AI/Toolbox",
    kind: "keys",
  },
  /*
   * What an AI action's approval card says - its title and the line under
   * it - and the kinds of resource it names: the server stores each as a
   * sentence of AIActionWords and the card says it in the reader's
   * language (ToolActionWords). Only the words the files mark are read.
   */
  {
    directory: "packages/Common/Types/AI/AIActionWords.ts",
    kind: "keys",
  },
  /*
   * What Ask AI's tables and its Sources chips say beside their data - a
   * table's title and line, the cells that are OneUptime's words, a
   * chip's label (issues #7977, #7979, #7980) - which the chat says in the
   * reader's language. Only the words the file marks are read.
   */
  {
    directory: "packages/Common/Types/AI/AIReadTableWords.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Types/AI/AiAffectedResources.ts",
    kind: "keys",
  },
  /*
   * Why OneUptime AI did not start a run someone asked for - Try again,
   * Investigate now - one sentence per refusal code: the server sends the
   * code beside its English message and the card says the code's sentence
   * in the reader's language (#7359).
   */
  {
    directory: "packages/Common/Types/AI/AiRunRefusal.ts",
    kind: "keys",
  },
  /*
   * How an AI remediation round reads on the Remediation step - 'AI
   * remediation for cluster "prod"' - in the reader's language, and the
   * kinds of resource a round runs on.
   */
  {
    directory: "packages/Common/Types/AutoRemediation/RemediationRoundName.ts",
    kind: "keys",
  },
  /*
   * The curated metrics' names: a database's engine charts and tiles, a
   * queue's Broker health charts and tiles (with the unit words their
   * titles add, "Buffer pool size (pages)"), and the storage array, Proxmox,
   * OpenStack and Ceph metric pickers and Metrics tabs. The database and
   * queue catalogs mark their descriptions too, which the (i) beside those
   * tiles and charts says, and so do the monitor catalogs (below). Only the
   * text the files mark is read: metric names and attribute keys stay as
   * written.
   */
  {
    directory:
      "packages/Common/Types/DatabaseServer/DatabaseServerMetricCatalog.ts",
    kind: "keys",
  },
  {
    directory:
      "packages/Common/Types/MessageQueue/MessageQueueMetricCatalog.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Types/Monitor/StorageArrayMetricCatalog.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Types/Monitor/ProxmoxMetricCatalog.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Types/Monitor/OpenStackMetricCatalog.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Types/Monitor/CephMetricCatalog.ts",
    kind: "keys",
  },
  /*
   * What each monitor metric is (#8014): the line under every metric picker
   * of a monitor's form, a Database Health criteria's line, a Database
   * monitor's charts and the metric it stores, and the words under each of
   * the Database catalog's groups. Every monitor metric catalog marks its
   * descriptions - the four above and these eight. These mark nothing else:
   * their metric names are no keys yet (#8353, #8354), and the attribute
   * names, values and units a description gives stay as written in every
   * language (MonitorMetricDescriptionsInLocales).
   */
  {
    directory: "packages/Common/Types/Monitor/DatabaseMetricCatalog.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Types/Monitor/DockerMetricCatalog.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Types/Monitor/DockerSwarmMetricCatalog.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Types/Monitor/HostMetricCatalog.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Types/Monitor/IotMetricCatalog.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Types/Monitor/KubernetesMetricCatalog.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Types/Monitor/PodmanMetricCatalog.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Types/Monitor/VMwareMetricCatalog.ts",
    kind: "keys",
  },
  /*
   * What a monitor's evaluation says, for the Dashboard to word in each
   * reader's language (issue #6542): the sentences the engine stores beside
   * its English (EvaluationSentence, translatableSentence) - each filter's
   * finding, each action's title and message - and the checks, conditions
   * and evaluations over time they name (CriteriaFilterTerms). Only the
   * words each file marks are read: the rest is the server's own English.
   */
  {
    directory: "packages/Common/Types/Monitor/CriteriaFilterTerms.ts",
    kind: "keys",
  },
  {
    directory:
      "packages/Common/Server/Utils/Monitor/Criteria/CompareCriteria.ts",
    kind: "keys",
  },
  {
    directory:
      "packages/Common/Server/Utils/Monitor/Criteria/APIRequestCriteria.ts",
    kind: "keys",
  },
  {
    directory:
      "packages/Common/Server/Utils/Monitor/MonitorCriteriaExpectationBuilder.ts",
    kind: "keys",
  },
  {
    directory:
      "packages/Common/Server/Utils/Monitor/MonitorCriteriaMessageBuilder.ts",
    kind: "keys",
  },
  {
    directory:
      "packages/Common/Server/Utils/Monitor/MonitorCriteriaObservationBuilder.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Server/Utils/Monitor/EvaluationEventText.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Server/Utils/Monitor/MonitorResource.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Server/Utils/Monitor/MonitorIncident.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Server/Utils/Monitor/MonitorAlert.ts",
    kind: "keys",
  },
  {
    directory:
      "packages/Common/Server/Utils/Monitor/MonitorMaintenanceSuppression.ts",
    kind: "keys",
  },
  {
    directory:
      "packages/Common/Server/Utils/Monitor/MonitorDependencySuppression.ts",
    kind: "keys",
  },
  {
    directory: "packages/Common/Server/Utils/Monitor/LogGroupCriteriaFanOut.ts",
    kind: "keys",
  },
  /*
   * The checks a table's columns call for (Data Observability's Suggested
   * Checks, #7221): each one's name and why it is suggested, as whole
   * sentences with the names they give as values, for the Dashboard to
   * word in the reader's language. Only the words the file marks are read.
   */
  {
    directory:
      "packages/Common/Types/DataObservability/DataCheckSuggestions.ts",
    kind: "keys",
  },
  /*
   * Why a data alert most likely happened (its Why This Happened card,
   * #8343): each likely cause's title the server words, as a whole sentence
   * with the names and counts it gives as values, for the Dashboard to word
   * in the reader's language. Only the words the file marks are read.
   */
  {
    directory:
      "packages/Common/Types/DataObservability/DataAlertCauseTitles.ts",
    kind: "keys",
  },
];

/*
 * Files under SOURCE_ROOTS whose strings no frontend shows, so none of them
 * is extracted. EnterpriseLicense is the license server's own table: no
 * project role may read it, and its enterprise-only column titles must stay
 * out of every locale file (a test in ee/ holds every frontend's locales to
 * that). BackupSetting and BackupRun are the instance's backups, which only
 * the Admin Dashboard shows, in words of its own (ee/AdminDashboard/Backups).
 * ProductFeedback is what people told the server, which only the Admin
 * Dashboard's Feedback page shows (#6832).
 */
export const SKIPPED_SOURCE_FILES: ReadonlySet<string> = new Set<string>([
  "packages/Common/Models/DatabaseModels/EnterpriseLicense.ts",
  "packages/Common/Models/DatabaseModels/BackupSetting.ts",
  "packages/Common/Models/DatabaseModels/BackupRun.ts",
  /*
   * What people told OneUptime (#6832): only the Admin Dashboard's Feedback
   * page reads it, in words of its own.
   */
  "packages/Common/Models/DatabaseModels/ProductFeedback.ts",
]);

/*
 * Property and attribute names whose string value is shown to the reader.
 * Names that are sometimes copy and sometimes an identifier (name, value,
 * key, id, type, category, body) are left out on purpose: a wrong key in
 * en.json costs translators time, a missing one is caught by
 * npm run i18n:hardcoded.
 */
export const USER_FACING_PROPS: ReadonlySet<string> = new Set<string>([
  "actionText",
  "actionTitle",
  "alt",
  "aria-description",
  "aria-label",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "ariaLabel",
  "buttonText",
  "cancelButtonText",
  "cannotText",
  "canText",
  "caption",
  "chipLabel",
  "closeButtonText",
  "confirmButtonText",
  "createButtonText",
  "createVerb",
  "deleteButtonText",
  "deleteVerb",
  "description",
  "editButtonText",
  "editText",
  "emptyDescription",
  "emptyMessage",
  "emptyStateDescription",
  "emptyStateMessage",
  "emptyStateTitle",
  "emptyTitle",
  "errorMessage",
  "explanation",
  "fileHint",
  "heading",
  "helpText",
  "hint",
  // A resource overview's identifier line: "type", "account" (ResourceOverview).
  "identifierLabel",
  // A telemetry explorer's chart title (TelemetryViewer looks it up).
  "histogramTitle",
  "label",
  "legend",
  "linkText",
  "loadingMessage",
  "loadingText",
  "meaning",
  "message",
  "moreText",
  // A stepped dialog's Next button, named for what it does (SteppedFormFooter).
  "nextButtonText",
  "nextStep",
  "noItemsMessage",
  "noLogsMessage",
  "noValueMessage",
  "optionsLabel",
  "placeholder",
  "pluralLabel",
  "pluralName",
  "question",
  "searchPlaceholder",
  "sectionDescription",
  "sectionTitle",
  "sentence",
  "seriesName",
  "singularLabel",
  "singularName",
  // A resource overview's status pill's hover (ResourceOverview).
  "statusDescription",
  "strongTitle",
  "sublabel",
  "submitButtonText",
  "subtitle",
  "successMessage",
  "summary",
  "text",
  "title",
  "tooltip",
  "warningMessage",
]);

// Attributes of a plain HTML element that the browser shows as text.
const HTML_TEXT_ATTRIBUTES: ReadonlySet<string> = new Set<string>([
  "alt",
  "aria-description",
  "aria-label",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "label",
  "placeholder",
  "title",
]);

/*
 * Object properties that are copy only inside a particular list: a tab's
 * "name" is its label (Tab translates it), while "name" elsewhere is usually
 * an identifier.
 *
 * A tab is known where it is written, by its list's name or its type: an
 * item of `tabs={[...]}` or `tabs: [...]`, of an array declared as the
 * item's type (`const tabs: Array<Tab> = [...]`), an object pushed onto one
 * (`tabs.push({...})`), declared as one (`const tab: Tab = {...}`) or
 * returned by a function that returns one (`(...): Tab => ({...})`). Only
 * the list's name was read, so a page that built its tabs in a variable -
 * most do - had them looked up but never extracted: "Diff vs. baseline"
 * and "Env Vars" read English in every language (#8367).
 */
export const PROPS_IN_LISTS: ReadonlyArray<{
  list?: string | undefined;
  itemType: string;
  prop: string;
}> = [
  { list: "tabs", itemType: "Tab", prop: "name" },
  /*
   * A dashboard widget's setting and the section it is in: their name is
   * the field's and the fold's title in the widget settings form, known by
   * the type its list or its object is declared as
   * (`const componentArguments: Array<ComponentArgument<T>> = []`, `const
   * DisplaySection: ComponentArgumentSection = {...}`), or a function that
   * returns one (getViewModeArgument), #8479.
   */
  { itemType: "ComponentArgument", prop: "name" },
  { itemType: "ComponentArgumentSection", prop: "name" },
];

// Element text inside these is code or a key name, not copy.
const CODE_ELEMENTS: ReadonlySet<string> = new Set<string>([
  "code",
  "kbd",
  "pre",
  "samp",
  "script",
  "style",
  "var",
  "CodeBlock",
  "CodeEditor",
  "InlineCode",
  "KeyboardKey",
  "ShortcutKey",
]);

/*
 * Components whose `template` attribute is a sentence they translate:
 * <TranslatedSentence template="{{field}} is {{value}}" ... />, and
 * ErrorSentence, a TranslatedSentence with an error in it (#7307).
 */
const TEMPLATE_COMPONENTS: ReadonlySet<string> = new Set<string>([
  "ErrorSentence",
  "NamedSentence",
  "TranslatedSentence",
]);

/*
 * Translation functions whose key is not their first argument:
 * translateInterpolated(translateString, "~{{count}} fetches", values).
 */
const KEY_ARGUMENT_INDEX: Readonly<Record<string, number>> = {
  translateInterpolated: 1,
};

/*
 * Calls that take a list of titles to draw, and the argument the list is:
 * a page's breadcrumbs, BuildBreadcrumbLinksByTitles(PageMap.X, ["Project",
 * "Runbooks", "View Runbook"]), which Breadcrumbs translates when it draws
 * them. They were not keys, so a trail's titles that no other place
 * happened to use ("View Runbook", "Pod Detail", "View MCP Server") read in
 * English in every language.
 */
export const TITLE_LIST_ARGUMENT_INDEX: ReadonlyMap<string, number> = new Map<
  string,
  number
>([["BuildBreadcrumbLinksByTitles", 1]]);

/*
 * t(), tx(), translate(), translateString(), translateTemplate(), ... and
 * translatableTerm(): a term put into a sentence ("... so {{function}}
 * reports to OneUptime.", name || translatableTerm("this function")) is
 * looked up by its text, so a literal one is a key like any other. So is
 * translatableSentence()'s template: a sentence the monitor engine stores
 * for the Dashboard to word (Common/Types/Monitor/EvaluationSentence).
 */
const TRANSLATION_FUNCTION: RegExp =
  /^(t|tx|translate|translatableTerm|translatableSentence|translationKey|translate[A-Z][A-Za-z0-9]*)$/;

// setError("..."), setEmptyMessage("..."), setModalTitle("...").
const MESSAGE_SETTER: RegExp =
  /^set([A-Z][A-Za-z0-9]*)?(Error|Message|Title|Description|Label|Text|Notice|Warning|Hint|Placeholder)$/;

// Model metadata: the names and description of a model.
const MODEL_NAME_PROPS: ReadonlySet<string> = new Set<string>([
  "singularName",
  "pluralName",
  "tableDescription",
]);

// Calls whose object argument describes a column; its title is shown.
const MODEL_COLUMN_CALLS: ReadonlySet<string> = new Set<string>([
  "TableColumn",
  "AnalyticsTableColumn",
]);

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  bull: "•",
  copy: "©",
  gt: ">",
  hellip: "…",
  larr: "←",
  laquo: "«",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  middot: "·",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  raquo: "»",
  rarr: "→",
  rdquo: "”",
  reg: "®",
  rsquo: "’",
  times: "×",
  trade: "™",
};

// The text React renders for JSX entity references: "&hellip;" -> "…".
export const decodeHtmlEntities: (text: string) => string = (
  text: string,
): string => {
  return text.replace(
    /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi,
    (match: string, entity: string): string => {
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        return String.fromCodePoint(parseInt(entity.slice(2), 16));
      }

      if (entity.startsWith("#")) {
        return String.fromCodePoint(parseInt(entity.slice(1), 10));
      }

      return HTML_ENTITIES[entity] ?? match;
    },
  );
};

/*
 * JSX text the way React renders it (Babel's cleanJSXElementLiteralChild):
 * lines are trimmed where they meet a line break, blank lines dropped, and
 * what is left joined with single spaces.
 */
// A line with something on it besides spaces and tabs.
const HAS_TEXT: RegExp = /[^ \t]/;

export const cleanJsxText: (raw: string) => string = (raw: string): string => {
  const lines: Array<string> = raw.split(/\r\n|\n|\r/);
  let lastNonEmptyLine: number = 0;

  lines.forEach((line: string, index: number): void => {
    if (HAS_TEXT.test(line)) {
      lastNonEmptyLine = index;
    }
  });

  let result: string = "";

  lines.forEach((line: string, index: number): void => {
    let trimmed: string = line.replace(/\t/g, " ");

    if (index !== 0) {
      trimmed = trimmed.replace(/^[ ]+/, "");
    }

    if (index !== lines.length - 1) {
      trimmed = trimmed.replace(/[ ]+$/, "");
    }

    if (trimmed) {
      if (index !== lastNonEmptyLine) {
        trimmed = `${trimmed} `;
      }

      result += trimmed;
    }
  });

  return result;
};

const PLACEHOLDER: RegExp = /\{\{[^{}]*\}\}/g;

const LETTER: RegExp = /\p{L}/u;

// Two letters in a row: a word, not "1-10" or "%".
const WORD: RegExp = /\p{L}{2,}/u;

const ONLY_DIGITS: RegExp = /^\d+$/;

const BLANK_LINE: RegExp = /\n\s*\n/;

const URL_SCHEME: RegExp = /:\/\//;

// A path ("/dashboard", "./x") or a hex color ("#6366f1").
const PATH_OR_COLOR: RegExp = /^(\/|\.\/|\.\.\/|#[0-9a-f]{3,8}$)/i;

// Identifier shapes: camelCase, snake_case, kebab-case-id, a.dotted.path.
const IDENTIFIER_SHAPES: ReadonlyArray<RegExp> = [
  /^[a-z]+[A-Z][A-Za-z0-9]*$/,
  /^[A-Za-z0-9]+(_[A-Za-z0-9]+)+$/,
  /^[a-z0-9]+(-[a-z0-9]+){2,}$/,
  /^[\w-]+(\.[\w-]+)+$/,
  /[=<>{}()[\]\\|;$`]/,
];

const LOWERCASE_START: RegExp = /^[a-z]/;

const SOURCE_FILE_NAME: RegExp = /\.tsx?$/;

const TEST_FILE_NAME: RegExp = /\.test\.tsx?$/;

/*
 * Tailwind-style utility: "flex", "text-sm", "hover:bg-gray-50", "w-1/2".
 * A hyphen, a variant colon or a digit: "items-center", "sm:block", "p2".
 */
const UTILITY_MARK: RegExp = /[-:\d]/;

/*
 * A Tailwind utility class: "flex", "text-sm", "hover:bg-gray-50", "w-1/2".
 * Matched by its prefix, so a lowercase phrase with a hyphen in it ("on-call
 * duty") is not mistaken for a class list.
 */
const UTILITY_CLASS: RegExp =
  /^(?:[a-z0-9-]+:)*!?-?(?:flex|grid|block|inline|hidden|relative|absolute|fixed|sticky|static|items|justify|content|self|place|gap|space|divide|p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|w|h|size|min|max|text|font|bg|border|rounded|shadow|ring|outline|opacity|z|top|left|right|bottom|inset|overflow|truncate|whitespace|break|cursor|select|pointer|transition|duration|ease|delay|animate|transform|translate|scale|rotate|sr|leading|tracking|underline|uppercase|lowercase|capitalize|italic|align|order|col|row|fill|stroke|object|aspect|container|list|decoration|grow|shrink|basis|line|from|via|to|backdrop|blur|dark|group|peer)(?:-[a-z0-9./[\]%#()]+)*$/;

/*
 * Whether a string is something a person reads rather than an identifier,
 * a class list, a path or a document. Explicit translation keys ("call",
 * "plural") are trusted further: they only need a letter.
 */
export const isTranslatableText: (
  text: string,
  kind: ExtractedKind,
) => boolean = (text: string, kind: ExtractedKind): boolean => {
  const trimmed: string = text.trim();

  if (!trimmed || !LETTER.test(trimmed.replace(PLACEHOLDER, ""))) {
    return false;
  }

  // An array-index key would be moved to the front of the JSON object.
  if (ONLY_DIGITS.test(text)) {
    return false;
  }

  if (kind === "call" || kind === "plural") {
    return true;
  }

  // A markdown document or a code sample is not a phrase.
  if (trimmed.includes("```") || BLANK_LINE.test(trimmed)) {
    return false;
  }

  if (URL_SCHEME.test(trimmed) || PATH_OR_COLOR.test(trimmed)) {
    return false;
  }

  const tokens: Array<string> = trimmed.split(/\s+/);

  if (tokens.length === 1) {
    const token: string = tokens[0] as string;

    // camelCase, snake_case, CONSTANT_CASE, kebab-case-identifier, a.dotted.path
    if (
      IDENTIFIER_SHAPES.some((shape: RegExp): boolean => {
        return shape.test(token);
      })
    ) {
      return false;
    }
  }

  // A class list: every word a utility, and at least one plainly one.
  if (
    tokens.length > 1 &&
    tokens.every((token: string): boolean => {
      return UTILITY_CLASS.test(token);
    }) &&
    tokens.some((token: string): boolean => {
      return UTILITY_MARK.test(token);
    })
  ) {
    return false;
  }

  return true;
};

// The last identifier of a callee: t, translateString, i18n.t -> t.
const getCalleeName: (expression: ts.Expression) => string | undefined = (
  expression: ts.Expression,
): string | undefined => {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  return undefined;
};

const getPropertyName: (name: ts.PropertyName) => string | undefined = (
  name: ts.PropertyName,
): string | undefined => {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }

  return undefined;
};

const getJsxAttributeName: (attribute: ts.JsxAttribute) => string = (
  attribute: ts.JsxAttribute,
): string => {
  return attribute.name.getText();
};

const unwrap: (expression: ts.Expression) => ts.Expression = (
  expression: ts.Expression,
): ts.Expression => {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }

  return current;
};

/*
 * A PluralTemplate's form: a string literal, or a literal marked as a key
 * - one: translationKey("{{count}} request") - as the templates a .ts
 * module keeps are written. Read either way, so a marked template gets its
 * "_one" sentence too: without it a translated "other" sentence was all a
 * language had for a count of one ("1 Anfragen"), so the Campaigns page's
 * counts stayed English in every language.
 */
const getPluralFormText: (
  expression: ts.Expression,
  options: { markedOnly: boolean },
) => string | undefined = (
  expression: ts.Expression,
  options: { markedOnly: boolean },
): string | undefined => {
  let value: ts.Expression = unwrap(expression);
  let isMarked: boolean = false;

  if (
    ts.isCallExpression(value) &&
    getCalleeName(value.expression) === "translationKey" &&
    value.arguments.length === 1
  ) {
    value = unwrap(value.arguments[0]!);
    isMarked = true;
  }

  if (options.markedOnly && !isMarked) {
    return undefined;
  }

  return ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)
    ? value.text
    : undefined;
};

/*
 * { one: "...", other: "..." }: the two forms of a count-dependent sentence,
 * or null when the object is not one. A "keys" root reads only marked forms.
 */
const getPluralForms: (
  node: ts.ObjectLiteralExpression,
  options: { markedOnly: boolean },
) => { one: string; other: string } | null = (
  node: ts.ObjectLiteralExpression,
  options: { markedOnly: boolean },
): { one: string; other: string } | null => {
  if (node.properties.length !== 2) {
    return null;
  }

  const forms: Record<string, string> = {};

  for (const property of node.properties) {
    if (ts.isPropertyAssignment(property)) {
      const name: string | undefined = getPropertyName(property.name);
      const text: string | undefined = getPluralFormText(
        property.initializer,
        options,
      );

      if (name && text !== undefined) {
        forms[name] = text;
      }
    }
  }

  return forms["one"] !== undefined && forms["other"] !== undefined
    ? { one: forms["one"], other: forms["other"] }
    : null;
};

/*
 * The string literals an expression can evaluate to directly: "a",
 * cond ? "a" : "b", x || "a", x ?? "a". Calls and concatenations are not
 * looked into.
 */
const getLiteralStrings: (
  expression: ts.Expression,
) => Array<{ text: string; node: ts.Node }> = (
  expression: ts.Expression,
): Array<{ text: string; node: ts.Node }> => {
  const node: ts.Expression = unwrap(expression);

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [{ text: node.text, node: node }];
  }

  if (ts.isConditionalExpression(node)) {
    return [
      ...getLiteralStrings(node.whenTrue),
      ...getLiteralStrings(node.whenFalse),
    ];
  }

  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return [...getLiteralStrings(node.left), ...getLiteralStrings(node.right)];
  }

  // cond && "a"
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return getLiteralStrings(node.right);
  }

  return [];
};

/*
 * A sentence glued from pieces in a place where copy goes: `Delete
 * ${name}` or "Delete " + name. These need a template (see
 * Common/UI/Utils/TranslateTemplate).
 */
const getComposedStrings: (expression: ts.Expression) => Array<ts.Node> = (
  expression: ts.Expression,
): Array<ts.Node> => {
  const node: ts.Expression = unwrap(expression);

  if (ts.isTemplateExpression(node)) {
    const literalText: string = [
      node.head.text,
      ...node.templateSpans.map((span: ts.TemplateSpan): string => {
        return span.literal.text;
      }),
    ].join(" ");

    return LETTER.test(literalText) && WORD.test(literalText) ? [node] : [];
  }

  if (ts.isConditionalExpression(node)) {
    return [
      ...getComposedStrings(node.whenTrue),
      ...getComposedStrings(node.whenFalse),
    ];
  }

  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      // Every piece of "a" + b + "c", however the chain nests.
      const operands: Array<ts.Expression> = [];
      const collect: (operand: ts.Expression) => void = (
        operand: ts.Expression,
      ): void => {
        const inner: ts.Expression = unwrap(operand);

        if (
          ts.isBinaryExpression(inner) &&
          inner.operatorToken.kind === ts.SyntaxKind.PlusToken
        ) {
          collect(inner.left);
          collect(inner.right);
        } else {
          operands.push(inner);
        }
      };

      collect(node);

      const hasWords: boolean = operands.some(
        (operand: ts.Expression): boolean => {
          return (
            (ts.isStringLiteral(operand) ||
              ts.isNoSubstitutionTemplateLiteral(operand)) &&
            WORD.test(operand.text)
          );
        },
      );

      return hasWords ? [node] : [];
    }

    if (
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return [
        ...getComposedStrings(node.left),
        ...getComposedStrings(node.right),
      ];
    }
  }

  return [];
};

const getTagName: (
  element: ts.JsxElement | ts.JsxSelfClosingElement,
) => string = (element: ts.JsxElement | ts.JsxSelfClosingElement): string => {
  const tagName: ts.JsxTagNameExpression = ts.isJsxElement(element)
    ? element.openingElement.tagName
    : element.tagName;

  return tagName.getText();
};

const isIntrinsicTag: (tagName: string) => boolean = (
  tagName: string,
): boolean => {
  return LOWERCASE_START.test(tagName) && !tagName.includes(".");
};

// The element a JSX child or attribute belongs to.
const getOwningElement: (
  node: ts.Node,
) => ts.JsxElement | ts.JsxSelfClosingElement | undefined = (
  node: ts.Node,
): ts.JsxElement | ts.JsxSelfClosingElement | undefined => {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) {
      return current;
    }

    if (ts.isJsxOpeningElement(current)) {
      return current.parent;
    }

    if (ts.isJsxFragment(current)) {
      return undefined;
    }

    current = current.parent;
  }

  return undefined;
};

const isInsideCodeElement: (node: ts.Node) => boolean = (
  node: ts.Node,
): boolean => {
  let element: ts.JsxElement | ts.JsxSelfClosingElement | undefined =
    getOwningElement(node);

  while (element) {
    if (CODE_ELEMENTS.has(getTagName(element))) {
      return true;
    }

    element = getOwningElement(element);
  }

  return false;
};

// Children that matter: not whitespace-only text, not {/* comments */}.
const getMeaningfulChildren: (
  children: ts.NodeArray<ts.JsxChild>,
) => Array<ts.JsxChild> = (
  children: ts.NodeArray<ts.JsxChild>,
): Array<ts.JsxChild> => {
  return children.filter((child: ts.JsxChild): boolean => {
    if (ts.isJsxText(child)) {
      return child.text.trim().length > 0;
    }

    if (ts.isJsxExpression(child)) {
      return child.expression !== undefined;
    }

    return true;
  });
};

// The type a declaration names: "Tab" for `Tab`, `Array<Tab>`, `Tab[]`, `ReadonlyArray<Tab>`.
const getNamedItemType: (
  type: ts.TypeNode | undefined,
) => { name: string; isList: boolean } | undefined = (
  type: ts.TypeNode | undefined,
): { name: string; isList: boolean } | undefined => {
  if (!type) {
    return undefined;
  }

  if (ts.isArrayTypeNode(type)) {
    const item: { name: string; isList: boolean } | undefined =
      getNamedItemType(type.elementType);

    return item && !item.isList ? { name: item.name, isList: true } : undefined;
  }

  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const name: string = type.typeName.text;
    const argument: ts.TypeNode | undefined = type.typeArguments?.[0];

    if ((name === "Array" || name === "ReadonlyArray") && argument) {
      const item: { name: string; isList: boolean } | undefined =
        getNamedItemType(argument);

      return item && !item.isList
        ? { name: item.name, isList: true }
        : undefined;
    }

    return { name, isList: false };
  }

  return undefined;
};

// The declared type of the variable a name reads, from the nearest declaration in its file.
const getDeclaredTypeOf: (
  identifier: ts.Identifier,
) => { name: string; isList: boolean } | undefined = (
  identifier: ts.Identifier,
): { name: string; isList: boolean } | undefined => {
  let found: { name: string; isList: boolean } | undefined = undefined;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (found) {
      return;
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === identifier.text
    ) {
      found = getNamedItemType(node.type);
    }

    ts.forEachChild(node, visit);
  };

  visit(identifier.getSourceFile());

  return found;
};

/*
 * What an object literal is written as, where its code says so: an item of
 * a list (by the list's name or its declared item type), or one item (by
 * its declared type, or a function's return type).
 */
const getObjectHolder: (object: ts.Node) => {
  listName?: string | undefined;
  itemType?: string | undefined;
} = (
  object: ts.Node,
): { listName?: string | undefined; itemType?: string | undefined } => {
  let parent: ts.Node | undefined = object.parent;

  while (
    parent &&
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent))
  ) {
    parent = parent.parent;
  }

  if (!parent) {
    return {};
  }

  // One item: `const tab: Tab = {...}`, `return {...}` or `=> ({...})` of a function typed `: Tab`.
  if (ts.isVariableDeclaration(parent)) {
    const type: { name: string; isList: boolean } | undefined =
      getNamedItemType(parent.type);

    return type && !type.isList ? { itemType: type.name } : {};
  }

  const returnedBy: ts.Node | undefined = ts.isReturnStatement(parent)
    ? ts.findAncestor(parent, ts.isFunctionLike)
    : ts.isArrowFunction(parent)
      ? parent
      : undefined;

  if (returnedBy && ts.isFunctionLike(returnedBy)) {
    const type: { name: string; isList: boolean } | undefined =
      getNamedItemType(returnedBy.type);

    return type && !type.isList ? { itemType: type.name } : {};
  }

  // Pushed onto a list: `tabs.push({...})`.
  if (
    ts.isCallExpression(parent) &&
    ts.isPropertyAccessExpression(parent.expression) &&
    parent.expression.name.text === "push" &&
    ts.isIdentifier(parent.expression.expression)
  ) {
    const receiver: ts.Identifier = parent.expression.expression;
    const type: { name: string; isList: boolean } | undefined =
      getDeclaredTypeOf(receiver);

    return {
      listName: receiver.text,
      itemType: type && type.isList ? type.name : undefined,
    };
  }

  if (!ts.isArrayLiteralExpression(parent)) {
    return {};
  }

  let holder: ts.Node | undefined = parent.parent;

  while (
    holder &&
    (ts.isParenthesizedExpression(holder) ||
      ts.isAsExpression(holder) ||
      ts.isSatisfiesExpression(holder))
  ) {
    holder = holder.parent;
  }

  if (holder && ts.isJsxExpression(holder)) {
    holder = holder.parent;
  }

  if (!holder) {
    return {};
  }

  if (ts.isPropertyAssignment(holder)) {
    return { listName: getPropertyName(holder.name) };
  }

  if (ts.isJsxAttribute(holder)) {
    return { listName: getJsxAttributeName(holder) };
  }

  if (ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name)) {
    const type: { name: string; isList: boolean } | undefined =
      getNamedItemType(holder.type);

    return {
      listName: holder.name.text,
      itemType: type && type.isList ? type.name : undefined,
    };
  }

  /*
   * A list a function returns: `(): Array<ComponentArgument<T>> => { return
   * [{...}] }`, as the type it returns a list of (#8479).
   */
  const listReturnedBy: ts.Node | undefined = ts.isReturnStatement(holder)
    ? ts.findAncestor(holder, ts.isFunctionLike)
    : ts.isArrowFunction(holder)
      ? holder
      : undefined;

  if (listReturnedBy && ts.isFunctionLike(listReturnedBy)) {
    const type: { name: string; isList: boolean } | undefined =
      getNamedItemType(listReturnedBy.type);

    return type && type.isList ? { itemType: type.name } : {};
  }

  return {};
};

/*
 * A property assignment inside an object that is an item of `tabs: [...]`,
 * or written as one of the list's items wherever it is (PROPS_IN_LISTS).
 */
export const isPropInList: (
  node: ts.PropertyAssignment,
  prop: string,
) => boolean = (node: ts.PropertyAssignment, prop: string): boolean => {
  const object: ts.Node = node.parent;

  if (!object || !ts.isObjectLiteralExpression(object)) {
    return false;
  }

  const holder: {
    listName?: string | undefined;
    itemType?: string | undefined;
  } = getObjectHolder(object);

  return PROPS_IN_LISTS.some(
    (rule: {
      list?: string | undefined;
      itemType: string;
      prop: string;
    }): boolean => {
      return (
        rule.prop === prop &&
        ((rule.list !== undefined && rule.list === holder.listName) ||
          rule.itemType === holder.itemType)
      );
    },
  );
};

const shortSnippet: (node: ts.Node) => string = (node: ts.Node): string => {
  const text: string = node.getText().replace(/\s+/g, " ").trim();

  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
};

export interface ScanOptions {
  kind: SourceKind;
}

/*
 * react-i18next's t() splits its key on dots, so t("navbar.items.formsTitle")
 * reads a nested key. The other translation helpers turn that off and look a
 * whole English sentence up, dots and all ("Loading...", "Node.js").
 */
const NESTED_KEY_PATH: RegExp = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

const NESTED_KEY_FUNCTIONS: ReadonlySet<string> = new Set<string>(["t"]);

// The English default a t() call gives a nested key, if it gives one.
const getNestedKeyDefault: (
  call: ts.CallExpression,
) => { text: string; node: ts.Node } | undefined = (
  call: ts.CallExpression,
): { text: string; node: ts.Node } | undefined => {
  const second: ts.Expression | undefined = call.arguments[1];

  if (!second) {
    return undefined;
  }

  const literal: { text: string; node: ts.Node } | undefined =
    getLiteralStrings(second)[0];

  if (literal) {
    return literal;
  }

  const options: ts.Expression = unwrap(second);

  if (ts.isObjectLiteralExpression(options)) {
    for (const property of options.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        getPropertyName(property.name) === "defaultValue"
      ) {
        return getLiteralStrings(property.initializer)[0];
      }
    }
  }

  return undefined;
};

/*
 * Scans one file. `file` is how results name it (repository-relative);
 * `sourceText` is its content.
 */
export const scanSourceText: (
  file: string,
  sourceText: string,
  options: ScanOptions,
) => SourceScanResult = (
  file: string,
  sourceText: string,
  options: ScanOptions,
): SourceScanResult => {
  const strings: Array<ExtractedString> = [];
  const hardcoded: Array<HardcodedString> = [];
  const nestedKeyReferences: Array<UndefinedNestedKey> = [];

  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const lineOf: (node: ts.Node) => number = (node: ts.Node): number => {
    return (
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1
    );
  };

  const add: (
    text: string,
    kind: ExtractedKind,
    node: ts.Node,
    extra?: { pluralOne?: string; nestedPath?: Array<string> },
  ) => void = (
    text: string,
    kind: ExtractedKind,
    node: ts.Node,
    extra?: { pluralOne?: string; nestedPath?: Array<string> },
  ): void => {
    if (!isTranslatableText(text, extra?.nestedPath ? "call" : kind)) {
      return;
    }

    const entry: ExtractedString = {
      text: text,
      kind: kind,
      file: file,
      line: lineOf(node),
    };

    if (extra?.pluralOne !== undefined) {
      entry.pluralOne = extra.pluralOne;
    }

    if (extra?.nestedPath !== undefined) {
      entry.nestedPath = extra.nestedPath;
    }

    strings.push(entry);
  };

  // A t("a.b.c") call: a nested key, with or without its English default.
  const addNestedKey: (
    call: ts.CallExpression,
    keyNode: ts.Node,
    key: string,
  ) => void = (
    call: ts.CallExpression,
    keyNode: ts.Node,
    key: string,
  ): void => {
    const fallback: { text: string; node: ts.Node } | undefined =
      getNestedKeyDefault(call);

    if (fallback) {
      add(fallback.text, "call", keyNode, { nestedPath: key.split(".") });
      return;
    }

    nestedKeyReferences.push({
      path: key.split("."),
      file: file,
      line: lineOf(keyNode),
    });
  };

  const report: (
    text: string,
    reason: HardcodedReason,
    node: ts.Node,
  ) => void = (text: string, reason: HardcodedReason, node: ts.Node): void => {
    hardcoded.push({
      text: text,
      reason: reason,
      file: file,
      line: lineOf(node),
    });
  };

  const visitModel: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      MODEL_NAME_PROPS.has(getPropertyName(node.name) || "")
    ) {
      for (const literal of getLiteralStrings(node.initializer)) {
        add(literal.text, "model", literal.node);
      }
    }

    if (
      (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
      MODEL_COLUMN_CALLS.has(getCalleeName(node.expression) || "")
    ) {
      for (const argument of node.arguments || []) {
        if (!ts.isObjectLiteralExpression(argument)) {
          continue;
        }

        for (const property of argument.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            getPropertyName(property.name) === "title"
          ) {
            for (const literal of getLiteralStrings(property.initializer)) {
              add(literal.text, "model", literal.node);
            }
          }
        }
      }
    }

    ts.forEachChild(node, visitModel);
  };

  const visitUi: (node: ts.Node) => void = (node: ts.Node): void => {
    // Translation calls and message setters.
    if (ts.isCallExpression(node)) {
      const callee: string | undefined = getCalleeName(node.expression);

      if (callee && TRANSLATION_FUNCTION.test(callee)) {
        const argument: ts.Expression | undefined =
          node.arguments[KEY_ARGUMENT_INDEX[callee] ?? 0];

        if (argument) {
          for (const literal of getLiteralStrings(argument)) {
            if (
              NESTED_KEY_FUNCTIONS.has(callee) &&
              NESTED_KEY_PATH.test(literal.text)
            ) {
              addNestedKey(node, literal.node, literal.text);
            } else {
              add(literal.text, "call", literal.node);
            }
          }
        }

        // translateNamedAction(translator, { template: "Edit {{itemName}}" })
        for (const callArgument of node.arguments) {
          const unwrapped: ts.Expression = unwrap(callArgument);

          if (!ts.isObjectLiteralExpression(unwrapped)) {
            continue;
          }

          for (const property of unwrapped.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              getPropertyName(property.name) === "template"
            ) {
              for (const literal of getLiteralStrings(property.initializer)) {
                add(literal.text, "call", literal.node);
              }
            }
          }
        }
      } else if (callee && MESSAGE_SETTER.test(callee)) {
        const argument: ts.Expression | undefined = node.arguments[0];

        if (argument) {
          for (const literal of getLiteralStrings(argument)) {
            add(literal.text, "setter", literal.node);
          }
        }
      } else if (callee && TITLE_LIST_ARGUMENT_INDEX.has(callee)) {
        // BuildBreadcrumbLinksByTitles(PageMap.X, ["Project", "View Runbook"])
        const argument: ts.Expression | undefined =
          node.arguments[TITLE_LIST_ARGUMENT_INDEX.get(callee)!];
        const list: ts.Expression | undefined = argument
          ? unwrap(argument)
          : undefined;

        if (list && ts.isArrayLiteralExpression(list)) {
          for (const element of list.elements) {
            if (ts.isSpreadElement(element)) {
              continue;
            }

            for (const literal of getLiteralStrings(element)) {
              add(literal.text, "prop", literal.node);
            }
          }
        }
      }
    }

    // { one: "...", other: "..." }, its forms literal or marked as keys.
    if (ts.isObjectLiteralExpression(node)) {
      const forms: { one: string; other: string } | null = getPluralForms(
        node,
        { markedOnly: false },
      );

      if (forms) {
        add(forms.other, "plural", node, { pluralOne: forms.one });
      }
    }

    // Object properties that hold copy.
    if (ts.isPropertyAssignment(node)) {
      const name: string | undefined = getPropertyName(node.name);

      if (name && (USER_FACING_PROPS.has(name) || isPropInList(node, name))) {
        for (const literal of getLiteralStrings(node.initializer)) {
          add(literal.text, "prop", literal.node);
        }

        for (const composed of getComposedStrings(node.initializer)) {
          report(shortSnippet(composed), "composed", composed);
        }
      }
    }

    // <TranslatedSentence template="..." />
    if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      getJsxAttributeName(node) === "template"
    ) {
      const element: ts.JsxElement | ts.JsxSelfClosingElement | undefined =
        getOwningElement(node);

      if (element && TEMPLATE_COMPONENTS.has(getTagName(element))) {
        const templates: Array<{ text: string; node: ts.Node }> =
          ts.isStringLiteral(node.initializer)
            ? [{ text: node.initializer.text, node: node.initializer }]
            : ts.isJsxExpression(node.initializer) &&
                node.initializer.expression
              ? getLiteralStrings(node.initializer.expression)
              : [];

        for (const template of templates) {
          add(template.text, "call", template.node);
        }
      }
    }

    // JSX attributes that hold copy.
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name: string = getJsxAttributeName(node);

      if (USER_FACING_PROPS.has(name)) {
        const element: ts.JsxElement | ts.JsxSelfClosingElement | undefined =
          getOwningElement(node);
        const isHtmlTextAttribute: boolean =
          Boolean(element) &&
          isIntrinsicTag(getTagName(element!)) &&
          HTML_TEXT_ATTRIBUTES.has(name);

        const literals: Array<{ text: string; node: ts.Node }> =
          ts.isStringLiteral(node.initializer)
            ? [
                {
                  text: decodeHtmlEntities(node.initializer.text),
                  node: node.initializer,
                },
              ]
            : ts.isJsxExpression(node.initializer) &&
                node.initializer.expression
              ? getLiteralStrings(node.initializer.expression)
              : [];

        for (const literal of literals) {
          add(literal.text, "prop", literal.node);

          if (isHtmlTextAttribute && isTranslatableText(literal.text, "prop")) {
            report(literal.text, "html-attribute", literal.node);
          }
        }

        if (
          ts.isJsxExpression(node.initializer) &&
          node.initializer.expression
        ) {
          for (const composed of getComposedStrings(
            node.initializer.expression,
          )) {
            report(shortSnippet(composed), "composed", composed);
          }
        }
      }
    }

    // Text between tags.
    if (ts.isJsxText(node) && LETTER.test(node.text)) {
      const parent: ts.Node = node.parent;
      const text: string = decodeHtmlEntities(cleanJsxText(node.text))
        .replace(/\s+/g, " ")
        .trim();

      if (text && !isInsideCodeElement(node)) {
        const siblings: Array<ts.JsxChild> =
          ts.isJsxElement(parent) || ts.isJsxFragment(parent)
            ? getMeaningfulChildren(parent.children)
            : [node];

        if (siblings.length === 1) {
          add(text, "jsx-text", node);

          if (isTranslatableText(text, "jsx-text")) {
            report(text, "jsx-text", node);
          }
        } else if (isTranslatableText(text, "jsx-text")) {
          // A piece of a sentence with values or markup in it.
          report(text, "composed", node);
        }
      }
    }

    // {"Text"} or {cond ? "A" : "B"} standing in for element text.
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      node.parent &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      !isInsideCodeElement(node)
    ) {
      for (const literal of getLiteralStrings(node.expression)) {
        add(literal.text, "jsx-text", literal.node);

        if (isTranslatableText(literal.text, "jsx-text")) {
          report(literal.text, "jsx-text", literal.node);
        }
      }

      for (const composed of getComposedStrings(node.expression)) {
        report(shortSnippet(composed), "composed", composed);
      }
    }

    ts.forEachChild(node, visitUi);
  };

  /*
   * A "keys" root: the text of its translation calls, and nothing else -
   * no property, attribute or element text, and nothing reported as still
   * hard-coded, since its other words are drawn as written on purpose.
   */
  const visitKeys: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee: string | undefined = getCalleeName(node.expression);

      if (callee && TRANSLATION_FUNCTION.test(callee)) {
        const argument: ts.Expression | undefined =
          node.arguments[KEY_ARGUMENT_INDEX[callee] ?? 0];

        if (argument) {
          for (const literal of getLiteralStrings(argument)) {
            add(literal.text, "call", literal.node);
          }
        }
      }
    }

    // A count-dependent sentence whose two forms are marked as keys.
    if (ts.isObjectLiteralExpression(node)) {
      const forms: { one: string; other: string } | null = getPluralForms(
        node,
        { markedOnly: true },
      );

      if (forms) {
        add(forms.other, "plural", node, { pluralOne: forms.one });
      }
    }

    ts.forEachChild(node, visitKeys);
  };

  if (options.kind === "models") {
    visitModel(sourceFile);
  } else if (options.kind === "keys") {
    visitKeys(sourceFile);
  } else {
    visitUi(sourceFile);
  }

  return {
    strings: strings,
    hardcoded: hardcoded,
    nestedKeyReferences: nestedKeyReferences,
  };
};

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  "Locales",
  "build",
  "dist",
  "node_modules",
]);

// Every .ts / .tsx file under a directory, sorted, without declarations.
export const listSourceFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const files: Array<string> = [];

  // A root that is one file is that file, when it is a source file at all.
  if (fs.existsSync(directory) && fs.statSync(directory).isFile()) {
    const name: string = path.basename(directory);

    return SOURCE_FILE_NAME.test(name) &&
      !name.endsWith(".d.ts") &&
      !TEST_FILE_NAME.test(name)
      ? [directory]
      : [];
  }

  const walk: (current: string) => void = (current: string): void => {
    if (!fs.existsSync(current)) {
      return;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath: string = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          walk(fullPath);
        }
      } else if (
        SOURCE_FILE_NAME.test(entry.name) &&
        !entry.name.endsWith(".d.ts") &&
        !TEST_FILE_NAME.test(entry.name)
      ) {
        files.push(fullPath);
      }
    }
  };

  walk(directory);

  return files.sort();
};

export const toRepositoryPath: (
  filePath: string,
  repositoryRoot?: string,
) => string = (filePath: string, repositoryRoot?: string): string => {
  return path
    .relative(repositoryRoot || REPOSITORY_ROOT, filePath)
    .split(path.sep)
    .join("/");
};

/*
 * Scans every source root. Results are in a fixed order - by file, then
 * line - so two runs over the same tree print the same thing.
 */
export const scanSourceRoots: (
  roots: ReadonlyArray<SourceRoot>,
  repositoryRoot?: string,
) => SourceScanResult = (
  roots: ReadonlyArray<SourceRoot>,
  repositoryRoot?: string,
): SourceScanResult => {
  const rootDirectory: string = repositoryRoot || REPOSITORY_ROOT;
  const strings: Array<ExtractedString> = [];
  const hardcoded: Array<HardcodedString> = [];
  const nestedKeyReferences: Array<UndefinedNestedKey> = [];
  // The column descriptions the UI's forms draw (FormColumnDescriptions).
  const columns: FormColumnDescriptionFinder = new FormColumnDescriptionFinder(
    rootDirectory,
  );

  for (const root of roots) {
    for (const filePath of listSourceFiles(
      path.join(rootDirectory, root.directory),
    )) {
      if (SKIPPED_SOURCE_FILES.has(toRepositoryPath(filePath, rootDirectory))) {
        continue;
      }

      const text: string = fs.readFileSync(filePath, "utf8");
      const result: SourceScanResult = scanSourceText(
        toRepositoryPath(filePath, rootDirectory),
        text,
        { kind: root.kind },
      );

      strings.push(...result.strings);
      hardcoded.push(...result.hardcoded);
      nestedKeyReferences.push(...result.nestedKeyReferences);

      if (root.kind === "ui") {
        strings.push(
          ...columns
            .find(filePath, text)
            .map((column: FormColumnDescription): ExtractedString => {
              return {
                text: column.text,
                kind: "column",
                file: column.file,
                line: column.line,
              };
            }),
        );
      }
    }
  }

  return {
    strings: strings,
    hardcoded: hardcoded,
    nestedKeyReferences: nestedKeyReferences,
  };
};

/*
 * The en.json entries the strings call for: each text maps to itself, and a
 * PluralTemplate adds its "_one" sentence under the "other" sentence's key.
 */
export const getEnglishEntries: (
  strings: ReadonlyArray<ExtractedString>,
) => Record<string, string> = (
  strings: ReadonlyArray<ExtractedString>,
): Record<string, string> => {
  const entries: Record<string, string> = {};

  for (const entry of strings) {
    if (entry.nestedPath) {
      continue;
    }

    entries[entry.text] = entry.text;

    if (entry.pluralOne !== undefined) {
      entries[`${entry.text}_one`] = entry.pluralOne;
    }
  }

  return entries;
};

export interface NestedEnglishEntry {
  path: Array<string>;
  value: string;
}

/*
 * The nested keys the t() calls read, with the English each call gives. The
 * first call in file order wins where two give the same key different text.
 */
export const getNestedEnglishEntries: (
  strings: ReadonlyArray<ExtractedString>,
) => Array<NestedEnglishEntry> = (
  strings: ReadonlyArray<ExtractedString>,
): Array<NestedEnglishEntry> => {
  const entries: Map<string, NestedEnglishEntry> = new Map<
    string,
    NestedEnglishEntry
  >();

  for (const entry of strings) {
    if (!entry.nestedPath) {
      continue;
    }

    const id: string = entry.nestedPath.join(".");

    if (!entries.has(id)) {
      entries.set(id, { path: entry.nestedPath, value: entry.text });
    }
  }

  return Array.from(entries.values());
};
