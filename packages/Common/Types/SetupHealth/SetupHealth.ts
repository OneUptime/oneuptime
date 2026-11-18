import { fillTemplate, translationKey } from "../Translator";
import {
  WhoIsToldBreak,
  WhoIsToldBreakKind,
  WhoIsToldChannels,
  WhoIsToldCriteria,
  WhoIsToldEvent,
  WhoIsToldOwnerAddedBy,
  WhoIsToldOwnerNotReached,
  WhoIsToldOwnerProblem,
  WhoIsToldPerson,
  WhoIsToldPersonProblem,
  WhoIsToldPolicy,
  WhoIsToldResult,
  WhoIsToldServerChannel,
  getWhoIsToldBreaksForReader,
  hasWhoIsToldHiddenEvent,
} from "../Monitor/WhoIsTold";
import {
  OnCallPageChannel,
  getOnCallPageChannelName,
} from "../OnCallDutyPolicy/OnCallPageChannel";
import { OnCallTestPageRecordKind } from "../OnCallDutyPolicy/OnCallTestPage";

/*
 * SETUP HEALTH (#6812): ONE LIST OF WHAT IS MISCONFIGURED IN A PROJECT, EACH
 * FINDING WITH ITS FIX.
 *
 * OneUptime lets a team build a setup in which a monitor fails and nobody
 * hears about it, while every page along the way looks fine: each product
 * checks its own corner. This looks at the project as a whole and says
 * "these things are wrong, here is how to fix each" - which is also how a
 * person learns the product's rules without reading about them.
 *
 * The server reads the facts once per project, in batches
 * (Server/Services/SetupHealthService), and every rule here is a small pure
 * function over them, so a test can hand any project to each rule. The
 * monitors' findings are the breaks of their "When this goes down" chains
 * (Types/Monitor/WhoIsTold, #6810), and the owners their incidents' and
 * alerts' Created email never reaches (#9371), resolved for the whole
 * project at once (WhoIsToldService.resolveProject): the card on a monitor
 * and this list share one set of rules and never disagree.
 *
 * A finding says what is wrong in one sentence, names the one record it is
 * about, and says which page fixes it. Its words are a template the
 * Dashboard translates with the finding's values; the server fills them in
 * English (`sentence`) for the API and for Ask AI. Three levels, in the
 * spirit of Installation health's fix and warn (#6826):
 *
 *   - PagesWillNotArrive: something set up to tell people will not.
 *   - WorthFixing: a gap people usually do not mean to leave.
 *   - Suggestion: worth a look, and often fine as it is.
 *
 * Home's "Needs attention" counts the first two. A finding can be dismissed
 * for everyone, with a reason ("We do not page for this on purpose"): the
 * dismissal is a RecommendationDismissal of RecommendationType.SetupHealth,
 * named by getSetupHealthDismissalId, and Restore deletes it.
 *
 * Pure, with no server or browser APIs.
 */

export enum SetupHealthLevel {
  PagesWillNotArrive = "pages_will_not_arrive",
  WorthFixing = "worth_fixing",
  Suggestion = "suggestion",
}

// Worst first: the order the page lists them in.
export const SETUP_HEALTH_LEVEL_ORDER: ReadonlyArray<SetupHealthLevel> = [
  SetupHealthLevel.PagesWillNotArrive,
  SetupHealthLevel.WorthFixing,
  SetupHealthLevel.Suggestion,
];

// The levels Home's "Needs attention" counts.
export const SETUP_HEALTH_LEVELS_ON_HOME: ReadonlyArray<SetupHealthLevel> = [
  SetupHealthLevel.PagesWillNotArrive,
  SetupHealthLevel.WorthFixing,
];

/*
 * What is checked. The values are kept in dismissals
 * (getSetupHealthDismissalId), so they are never renamed.
 */
export enum SetupHealthCheck {
  // From the monitors' chains (WhoIsToldBreakKind).
  MonitorTellsNobody = "monitor_tells_nobody",
  MonitorPagesNobody = "monitor_pages_nobody",
  MonitorAlertsPageNobody = "monitor_alerts_page_nobody",
  PolicyHasNoEscalationRules = "policy_has_no_escalation_rules",
  PolicyReachesNobody = "policy_reaches_nobody",
  ResponderCannotBePaged = "responder_cannot_be_paged",
  ChannelOff = "channel_off",
  NoBalance = "no_balance",
  ServerCannotSend = "server_cannot_send",
  // From the chains' owners no Created email reaches (#9371).
  OwnerNotEmailed = "owner_not_emailed",
  /*
   * Somebody on a policy with no verified phone method while the project
   * asks people on call for one (#7449): from Readiness's answer.
   */
  ResponderHasNoPhone = "responder_has_no_phone",
  // The project's other records.
  PolicyNotRun = "policy_not_run",
  ScheduleHasNobodyOnCall = "schedule_has_nobody_on_call",
  LowBalance = "low_balance",
  MonitorNotChecked = "monitor_not_checked",
  MonitorOffForLong = "monitor_off_for_long",
  StatusPageShowsNoMonitor = "status_page_shows_no_monitor",
  StatusPageDomainNotVerified = "status_page_domain_not_verified",
  StatusPageDomainCertificateFailed = "status_page_domain_certificate_failed",
  OneOwner = "one_owner",
  WorkspaceNotUsed = "workspace_not_used",
  TelemetryNotWatched = "telemetry_not_watched",
  IngestionKeyNeverUsed = "ingestion_key_never_used",
}

/*
 * Within a level, the order the page lists the checks in: who is told
 * first, then what is checked and shown, then the project.
 */
export const SETUP_HEALTH_CHECK_ORDER: ReadonlyArray<SetupHealthCheck> = [
  SetupHealthCheck.ServerCannotSend,
  SetupHealthCheck.NoBalance,
  SetupHealthCheck.ChannelOff,
  SetupHealthCheck.MonitorAlertsPageNobody,
  SetupHealthCheck.PolicyHasNoEscalationRules,
  SetupHealthCheck.PolicyReachesNobody,
  SetupHealthCheck.ResponderCannotBePaged,
  SetupHealthCheck.ResponderHasNoPhone,
  SetupHealthCheck.MonitorPagesNobody,
  SetupHealthCheck.MonitorTellsNobody,
  SetupHealthCheck.OwnerNotEmailed,
  SetupHealthCheck.PolicyNotRun,
  SetupHealthCheck.ScheduleHasNobodyOnCall,
  SetupHealthCheck.LowBalance,
  SetupHealthCheck.MonitorNotChecked,
  SetupHealthCheck.StatusPageShowsNoMonitor,
  SetupHealthCheck.StatusPageDomainNotVerified,
  SetupHealthCheck.StatusPageDomainCertificateFailed,
  SetupHealthCheck.MonitorOffForLong,
  SetupHealthCheck.TelemetryNotWatched,
  SetupHealthCheck.IngestionKeyNeverUsed,
  SetupHealthCheck.WorkspaceNotUsed,
  SetupHealthCheck.OneOwner,
];

/*
 * The kind of record a finding is about. The values are also the
 * `resourceType` of a dismissal, so they are never renamed.
 */
export enum SetupHealthRecordKind {
  Monitor = "Monitor",
  OnCallDutyPolicy = "OnCallDutyPolicy",
  OnCallDutyPolicySchedule = "OnCallDutyPolicySchedule",
  User = "User",
  StatusPage = "StatusPage",
  StatusPageDomain = "StatusPageDomain",
  TelemetryIngestionKey = "TelemetryIngestionKey",
  Project = "Project",
  // A team named as an owner that the Created email reaches nobody through (#9371).
  Team = "Team",
  // An owner rule that adds someone no Created email reaches (#9371).
  IncidentOwnerRule = "IncidentOwnerRule",
  AlertOwnerRule = "AlertOwnerRule",
}

export interface SetupHealthRecord {
  kind: SetupHealthRecordKind;
  id: string;
  name: string;
}

// The page that puts a finding right.
export enum SetupHealthFix {
  MonitorCriteria = "MonitorCriteria",
  MonitorProbes = "MonitorProbes",
  MonitorOverview = "MonitorOverview",
  CreateMonitor = "CreateMonitor",
  IncidentOnCallRules = "IncidentOnCallRules",
  AlertOnCallRules = "AlertOnCallRules",
  // No on-call policy yet: the on-call guided setup makes the first (#7369).
  OnCallGuidedSetup = "OnCallGuidedSetup",
  OnCallPolicy = "OnCallPolicy",
  OnCallSchedule = "OnCallSchedule",
  OnCallReadiness = "OnCallReadiness",
  ProjectNotificationSettings = "ProjectNotificationSettings",
  ProjectBilling = "ProjectBilling",
  // Self-hosted: the Admin Dashboard's settings, for the server's admins.
  ServerSettings = "ServerSettings",
  StatusPageResources = "StatusPageResources",
  StatusPageDomains = "StatusPageDomains",
  ProjectOwners = "ProjectOwners",
  WorkspaceNotificationRules = "WorkspaceNotificationRules",
  // The ingestion key's own page: when it was last used, and Delete.
  TelemetryIngestionKey = "TelemetryIngestionKey",
  /*
   * Where an owner no Created email reaches is put right (#9371), as the
   * When this goes down card links it: a team's members, the network
   * device's owners, the incident or alert owner rules.
   */
  TeamMembers = "TeamMembers",
  NetworkDeviceOwners = "NetworkDeviceOwners",
  IncidentOwnerRules = "IncidentOwnerRules",
  AlertOwnerRules = "AlertOwnerRules",
}

// Why a responder can't be paged (ResponderCannotBePaged's reasons), worst first.
export enum SetupHealthResponderReason {
  NotAMember = "not_a_member",
  InvitationNotAccepted = "invitation_not_accepted",
  NoVerifiedMethod = "no_verified_method",
  NoRuleNoFallback = "no_rule_no_fallback",
  OptedOut = "opted_out",
}

export const SETUP_HEALTH_RESPONDER_REASON_ORDER: ReadonlyArray<SetupHealthResponderReason> =
  [
    SetupHealthResponderReason.NotAMember,
    SetupHealthResponderReason.InvitationNotAccepted,
    SetupHealthResponderReason.NoVerifiedMethod,
    SetupHealthResponderReason.NoRuleNoFallback,
    SetupHealthResponderReason.OptedOut,
  ];

// Why nobody is on call in a schedule (ScheduleHasNobodyOnCall's reasons), worst first.
export enum SetupHealthScheduleReason {
  NoRotations = "no_rotations",
  NobodyInRotations = "nobody_in_rotations",
  NobodyNow = "nobody_now",
  GapAhead = "gap_ahead",
}

// Why a monitor is not checked (MonitorNotChecked's reasons).
export enum SetupHealthMonitorReason {
  NoProbe = "no_probe",
  ProbesDisconnected = "probes_disconnected",
}

/*
 * Why a custom domain is not served over HTTPS
 * (StatusPageDomainCertificateFailed's reasons): the states of the Custom
 * Domains page's Status column that say a certificate failed -
 * "Could not issue a free certificate yet" and "Certificate expired".
 */
export enum SetupHealthCertificateReason {
  NotIssued = "not_issued",
  Expired = "expired",
}

/*
 * AN OWNER NO CREATED EMAIL REACHES (OwnerNotEmailed's subjects, #9371):
 * what names them, and why the email can't reach them - each with its own
 * record and fix, as the When this goes down card links it:
 *
 *   - a team of the project with nobody in it who is a member, wherever it
 *     is named: the team (Open Team);
 *   - somebody who isn't a member of the project, or a team of another
 *     project, named in a monitor's criteria (Open Criteria), owning the
 *     network device a monitor watches (Open Network Device), or added by
 *     an owner rule (Open Owner Rules).
 *
 * The values are kept in dismissals (getSetupHealthDismissalId), so they
 * are never renamed.
 */
export enum SetupHealthOwnerSubject {
  TeamHasNobody = "team_has_nobody",
  CriteriaNotInProject = "criteria_not_in_project",
  CriteriaTeamOfAnotherProject = "criteria_team_of_another_project",
  NetworkDeviceNotInProject = "network_device_not_in_project",
  NetworkDeviceTeamOfAnotherProject = "network_device_team_of_another_project",
  OwnerRuleNotInProject = "owner_rule_not_in_project",
  OwnerRuleTeamOfAnotherProject = "owner_rule_team_of_another_project",
}

// Which records an incident or an alert has the on-call rules of.
export enum SetupHealthEventKind {
  Incident = "incident",
  Alert = "alert",
}

export interface SetupHealthFinding {
  /*
   * What makes the finding itself: its check, its subject and its record.
   * Stable from one check to the next.
   */
  key: string;
  check: SetupHealthCheck;
  level: SetupHealthLevel;
  /*
   * Part of what the finding is, when one record can have the check twice:
   * the channel that is off (SMS, Call), incidents or alerts. Empty
   * otherwise.
   */
  subject: string;
  /*
   * What exactly is wrong, when the check has several reasons (a
   * SetupHealthResponderReason, a SetupHealthScheduleReason ...). Empty
   * otherwise. Not part of what the finding is: a responder who now has a
   * verified method but no rule is still the same finding.
   */
  reason: string;
  // The one record it is about: the one a dismissal hides it for.
  record: SetupHealthRecord;
  /*
   * Other records it concerns: the monitors a policy is run for, the
   * policies that page a person, the status page a domain is for.
   */
  related: Array<SetupHealthRecord>;
  fix: SetupHealthFix;
  // The record the fix opens, when there is one: a monitor, a policy ...
  fixRecordId: string;
  /*
   * The words: a template the Dashboard translates with `values` (the
   * names in it are the project's own, set in as written).
   */
  words: string;
  values: Record<string, string>;
  // The words filled in English: for the API and Ask AI.
  sentence: string;
  /*
   * For words that name a time or an amount, the value itself, so a
   * reader can write it the reader's way: when a schedule's gap starts (an
   * ISO date), a balance in US cents.
   */
  startsAt?: string | undefined;
  balanceInUSDCents?: number | undefined;
}

/*
 * THE WORDS OF EACH FINDING, by check and reason (or subject). Each is a
 * whole sentence (the reader's language may put the names anywhere), and
 * the ones the "When this goes down" card says too are the card's own
 * words, so the two say a break one way.
 */
export const SETUP_HEALTH_WORDS: Readonly<{
  monitorTellsNobody: string;
  monitorPagesNobody: Readonly<Record<SetupHealthEventKind, string>>;
  monitorAlertsPageNobody: string;
  policyHasNoEscalationRules: string;
  policyReachesNobody: string;
  responderCannotBePaged: Readonly<Record<SetupHealthResponderReason, string>>;
  responderHasNoPhone: string;
  channelOff: string;
  noBalance: string;
  serverCannotSend: Readonly<Record<WhoIsToldServerChannel, string>>;
  ownerNotEmailed: Readonly<Record<SetupHealthOwnerSubject, string>>;
  policyNotRun: string;
  scheduleHasNobodyOnCall: Readonly<Record<SetupHealthScheduleReason, string>>;
  lowBalance: string;
  monitorNotChecked: Readonly<Record<SetupHealthMonitorReason, string>>;
  monitorOffForLong: string;
  statusPageShowsNoMonitor: string;
  statusPageDomainNotVerified: string;
  statusPageDomainCertificateFailed: Readonly<
    Record<SetupHealthCertificateReason, string>
  >;
  oneOwner: string;
  workspaceNotUsed: string;
  telemetryNotWatched: string;
  ingestionKeyNeverUsed: string;
}> = {
  monitorTellsNobody: translationKey(
    "{{monitor}} tells nobody when it goes down: none of its criteria changes its status or opens an incident or an alert.",
  ),
  monitorPagesNobody: {
    [SetupHealthEventKind.Incident]: translationKey(
      "Nobody is paged when {{monitor}} goes down: no on-call rule matches its incidents.",
    ),
    [SetupHealthEventKind.Alert]: translationKey(
      "Nobody is paged when {{monitor}} goes down: no on-call rule matches its alerts.",
    ),
  },
  monitorAlertsPageNobody: translationKey(
    "Nobody is paged for the alerts of {{monitor}}: only incidents have on-call rules.",
  ),
  policyHasNoEscalationRules: translationKey(
    "On-call policy {{policy}} has no escalation rules, so it pages nobody.",
  ),
  policyReachesNobody: translationKey(
    "On-call policy {{policy}} reaches nobody right now: nobody is on call in its first escalation rule.",
  ),
  responderCannotBePaged: {
    [SetupHealthResponderReason.NotAMember]: translationKey(
      "{{name}} is no longer a member of this project, but an on-call policy still pages them.",
    ),
    [SetupHealthResponderReason.InvitationNotAccepted]: translationKey(
      "{{name}} hasn't accepted the invitation to this project, so pages don't reach them.",
    ),
    [SetupHealthResponderReason.NoVerifiedMethod]: translationKey(
      "{{name}} has no verified notification method, so pages don't reach them.",
    ),
    [SetupHealthResponderReason.NoRuleNoFallback]: translationKey(
      "{{name}} has no on-call rule for some pages an on-call policy sends them, and this project doesn't fall back to verified methods.",
    ),
    [SetupHealthResponderReason.OptedOut]: translationKey(
      "{{name}} opted out of some pages an on-call policy sends them.",
    ),
  },
  responderHasNoPhone: translationKey(
    "{{name}} is on call but has no verified phone method, which this project asks everyone on call to have.",
  ),
  channelOff: translationKey(
    "{{channel}} is off in this project, so pages that use it are not sent.",
  ),
  noBalance: translationKey(
    "This project has no balance left for SMS and calls, so they are not sent.",
  ),
  serverCannotSend: {
    [WhoIsToldServerChannel.Email]: translationKey(
      "This server can't send email yet, so nobody is emailed.",
    ),
    [WhoIsToldServerChannel.SMS]: translationKey(
      "This server can't send SMS yet, so SMS pages are not sent.",
    ),
    [WhoIsToldServerChannel.Call]: translationKey(
      "This server can't make phone calls yet, so call pages are not sent.",
    ),
  },
  /*
   * The card says the team's in these words, and the rest in two sentences
   * of its own (why, then where they are named): here each is one, with
   * the monitor or the owner rule that names them.
   */
  ownerNotEmailed: {
    [SetupHealthOwnerSubject.TeamHasNobody]: translationKey(
      "Team {{team}} has nobody in it who is a member of this project, so nobody is emailed through it.",
    ),
    [SetupHealthOwnerSubject.CriteriaNotInProject]: translationKey(
      "Someone named as an owner in the criteria of {{monitor}} isn't a member of this project, so isn't emailed.",
    ),
    [SetupHealthOwnerSubject.CriteriaTeamOfAnotherProject]: translationKey(
      "A team of another project is named as an owner in the criteria of {{monitor}}, so nobody is emailed through it.",
    ),
    [SetupHealthOwnerSubject.NetworkDeviceNotInProject]: translationKey(
      "An owner of the network device {{monitor}} watches isn't a member of this project, so isn't emailed.",
    ),
    [SetupHealthOwnerSubject.NetworkDeviceTeamOfAnotherProject]: translationKey(
      "A team of another project owns the network device {{monitor}} watches, so nobody is emailed through it.",
    ),
    [SetupHealthOwnerSubject.OwnerRuleNotInProject]: translationKey(
      "Owner rule {{rule}} adds someone who isn't a member of this project as an owner, so they aren't emailed.",
    ),
    [SetupHealthOwnerSubject.OwnerRuleTeamOfAnotherProject]: translationKey(
      "Owner rule {{rule}} adds a team of another project as an owner, so nobody is emailed through it.",
    ),
  },
  policyNotRun: translationKey(
    "On-call policy {{policy}} pages nobody: no on-call rule and no monitor runs it.",
  ),
  scheduleHasNobodyOnCall: {
    [SetupHealthScheduleReason.NoRotations]: translationKey(
      "On-call schedule {{schedule}} has no rotations, so nobody is ever on call in it.",
    ),
    [SetupHealthScheduleReason.NobodyInRotations]: translationKey(
      "Nobody is in the rotations of on-call schedule {{schedule}}, so nobody is ever on call in it.",
    ),
    [SetupHealthScheduleReason.NobodyNow]: translationKey(
      "Nobody is on call in on-call schedule {{schedule}} right now.",
    ),
    [SetupHealthScheduleReason.GapAhead]: translationKey(
      "Nobody will be on call in on-call schedule {{schedule}} from {{time}}.",
    ),
  },
  lowBalance: translationKey(
    "This project's balance for SMS and calls is low ({{balance}}) and auto-recharge is off, so they stop when it runs out.",
  ),
  monitorNotChecked: {
    [SetupHealthMonitorReason.NoProbe]: translationKey(
      "{{monitor}} is never checked: no probe is turned on for it.",
    ),
    [SetupHealthMonitorReason.ProbesDisconnected]: translationKey(
      "{{monitor}} is not checked right now: every probe it uses is disconnected.",
    ),
  },
  monitorOffForLong: translationKey(
    "{{monitor}} has been turned off for more than 30 days.",
  ),
  statusPageShowsNoMonitor: translationKey(
    "Status page {{statusPage}} shows no monitors yet.",
  ),
  statusPageDomainNotVerified: translationKey(
    "{{domain}} doesn't open status page {{statusPage}} yet: its CNAME record isn't verified.",
  ),
  statusPageDomainCertificateFailed: {
    [SetupHealthCertificateReason.NotIssued]: translationKey(
      "{{domain}} doesn't open status page {{statusPage}} over HTTPS yet: its free SSL certificate couldn't be issued.",
    ),
    [SetupHealthCertificateReason.Expired]: translationKey(
      "{{domain}} doesn't open status page {{statusPage}} over HTTPS: its SSL certificate expired and couldn't be renewed.",
    ),
  },
  oneOwner: translationKey(
    "This project has only one owner. Make a second person an owner, so somebody can always manage it.",
  ),
  workspaceNotUsed: translationKey(
    "{{workspace}} is connected, but no notification rule posts to it.",
  ),
  telemetryNotWatched: translationKey(
    "Telemetry arrives in this project, but no monitor alerts on it.",
  ),
  ingestionKeyNeverUsed: translationKey(
    "No data has arrived with ingestion key {{key}} since it was created.",
  ),
};

/*
 * A domain added less than this long ago is not yet said to be unverified:
 * DNS takes a while to answer for a new record.
 */
export const DOMAIN_VERIFICATION_GRACE_IN_MS: number = 60 * 60 * 1000;

// A monitor turned off for longer than this is said to be off for long.
export const MONITOR_OFF_FOR_LONG_IN_DAYS: number = 30;

/*
 * An ingestion key nothing has sent with for this long after it was made is
 * said to be unused: a collector or an SDK is usually pointed at a new key
 * within days.
 */
export const INGESTION_KEY_UNUSED_AFTER_IN_DAYS: number = 7;

/*
 * WHEN AN INGESTION KEY'S USE STARTED BEING RECORDED
 * (TelemetryIngestionKey.lastUsedAt, stamped by every ingest path through
 * Server/Utils/Telemetry/TelemetryIngestionKeyLastUsed). An empty stamp means
 * "never used" only for a key made after its path stamped:
 *
 *   - over HTTP since 2026-09-03 (6b69e402973): OTLP over HTTP, Fluent,
 *     syslog, session replay and every other surface of TelemetryIngest;
 *   - over OTLP gRPC since 2026-11-14 (#7887) and MQTT since 2026-11-15
 *     (#8020): until then, a key the OpenTelemetry Collector's default
 *     exporter used read "never used" however much it sent.
 *
 * So a key made after every path stamped is unused when its stamp is empty.
 * One made between the two dates is unused only in a project that has never
 * received logs, metrics, traces, exceptions or profiles - the data gRPC and
 * MQTT carry - since everything else it could have sent came over HTTP. One
 * made before is never said to be unused: it may have worked for years.
 */
export const INGESTION_KEY_USE_RECORDED_SINCE: string =
  "2026-11-16T00:00:00.000Z";

export const INGESTION_KEY_HTTP_USE_RECORDED_SINCE: string =
  "2026-09-04T00:00:00.000Z";

// How far ahead a schedule's gaps are looked for.
export const SCHEDULE_GAP_LOOKAHEAD_IN_DAYS: number = 7;

// How long the server keeps a project's findings before working them out again.
export const SETUP_HEALTH_CACHE_TTL_IN_MS: number = 60 * 1000;

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

/*
 * WHAT THE SERVER KNOWS, read once per project (SetupHealthService). Each
 * part is null or empty when it was not read or does not apply - a
 * self-hosted server has no balance, OneUptime Cloud always sends - and a
 * rule over a part that is missing finds nothing.
 */
export interface SetupHealthFacts {
  projectId: string;
  // When the facts were read, as an ISO date.
  now: string;
  // The chains of every monitor that checks something and is on.
  chains: Array<WhoIsToldResult>;
  // The project's channels (the same for every chain), when read.
  channels: WhoIsToldChannels | null;
  // The project's on-call policies that are not archived.
  policies: Array<{ id: string; name: string }>;
  // The ids of the policies an enabled on-call rule of any kind runs.
  policyIdsRunByRules: Array<string>;
  // The people any policy can page, and whether each can be (Readiness).
  responders: Array<SetupHealthResponderFact>;
  // The schedules a policy's escalation rules page, with who is on call.
  schedules: Array<SetupHealthScheduleFact>;
  // OneUptime Cloud: the balance SMS and calls are paid from.
  balance: SetupHealthBalanceFact | null;
  // Self-hosted: whether the server can send email; null when not known.
  serverCanSendEmail: boolean | null;
  // Every monitor of the project that is not archived.
  monitors: Array<SetupHealthMonitorFact>;
  statusPages: Array<SetupHealthStatusPageFact>;
  statusPageDomains: Array<SetupHealthDomainFact>;
  owners: SetupHealthOwnersFact | null;
  // The chat workspaces the project has connected.
  workspaces: Array<SetupHealthWorkspaceFact>;
  telemetry: SetupHealthTelemetryFact | null;
  // The project's telemetry ingestion keys.
  ingestionKeys: Array<SetupHealthIngestionKeyFact>;
}

export interface SetupHealthResponderFact {
  userId: string;
  name: string;
  // Nothing reaches them (Readiness's NotReachable).
  isNotReachable: boolean;
  // Why, when Readiness says: not a member, invitation not accepted.
  reason: SetupHealthResponderReason;
  /*
   * No verified phone method while the project asks people on call for one
   * (Readiness's isMissingPhoneMethod, #7449).
   */
  isMissingPhoneMethod?: boolean | undefined;
}

export interface SetupHealthScheduleFact {
  id: string;
  name: string;
  reason: SetupHealthScheduleReason | null;
  // For a gap ahead: when it starts, as an ISO date.
  gapStartsAt: string | null;
}

export interface SetupHealthBalanceFact {
  balanceInUSDCents: number;
  isAutoRechargeOn: boolean;
  // Below this the balance is low: the project's own auto-recharge threshold.
  lowBalanceInUSDCents: number;
}

export interface SetupHealthMonitorFact {
  id: string;
  name: string;
  // Checked by probes (MonitorTypeHelper.isProbableMonitor).
  isCheckedByProbes: boolean;
  // Turned off by hand (disableActiveMonitoring).
  isTurnedOff: boolean;
  // When it last changed, as an ISO date: it has been off since at least then.
  updatedAt: string | null;
  hasNoProbeOn: boolean;
  areAllProbesDisconnected: boolean;
  // A Logs, Metrics, Traces or Exceptions monitor (MonitorTypeHelper.isTelemetryMonitor).
  isTelemetryMonitor: boolean;
}

export interface SetupHealthStatusPageFact {
  id: string;
  name: string;
  // How many monitors and monitor groups it shows.
  resourceCount: number;
}

export interface SetupHealthDomainFact {
  id: string;
  fullDomain: string;
  statusPageId: string;
  statusPageName: string;
  isCnameVerified: boolean;
  // When it was added, as an ISO date.
  createdAt: string | null;
  // Served with a certificate its owner uploaded: there is none to issue.
  isCustomCertificate?: boolean | undefined;
  /*
   * Where its free certificate stands, as the Custom Domains page's Status
   * column reads it (CertificateOrder.getCertificateStates): read only for
   * a verified domain with no uploaded certificate, on an installation that
   * issues free certificates. Undefined or null when not read.
   */
  certificate?: SetupHealthDomainCertificateFact | null | undefined;
}

export interface SetupHealthDomainCertificateFact {
  // When its certificate expires, as an ISO date; null while it has none.
  expiresAt: string | null;
  // Its last order failed, and no order since has succeeded.
  hasOrderFailed: boolean;
}

export interface SetupHealthIngestionKeyFact {
  id: string;
  name: string;
  // When it was made, as an ISO date.
  createdAt: string | null;
  // When data last arrived with it, as an ISO date; null when never recorded.
  lastUsedAt: string | null;
  // Switched off by hand: it is refused, so nothing can arrive with it.
  isDisabled: boolean;
  // When it stops working, as an ISO date; null when never.
  expiresAt: string | null;
}

export interface SetupHealthOwnersFact {
  ownerCount: number;
  // Members who accepted, owners included.
  memberCount: number;
}

export interface SetupHealthWorkspaceFact {
  // Slack, MicrosoftTeams or Mattermost (WorkspaceType).
  workspaceType: string;
  // Its name as people say it: "Slack", "Microsoft Teams".
  workspaceName: string;
  // How many notification rules post to it.
  ruleCount: number;
}

export interface SetupHealthTelemetryFact {
  // Logs, metrics, traces or exceptions have arrived (#6830's milestones).
  receivesTelemetry: boolean;
}

// The record of a finding about the project itself.
function projectRecord(facts: SetupHealthFacts): SetupHealthRecord {
  return {
    kind: SetupHealthRecordKind.Project,
    id: facts.projectId,
    name: "",
  };
}

// What makes a finding itself: its check, its subject and its record.
export function getSetupHealthFindingKey(data: {
  check: SetupHealthCheck;
  subject: string;
  record: Pick<SetupHealthRecord, "kind" | "id">;
}): string {
  return [data.check, data.subject, data.record.kind, data.record.id].join("|");
}

// A finding, with its key and its English sentence.
export function makeSetupHealthFinding(data: {
  check: SetupHealthCheck;
  level: SetupHealthLevel;
  record: SetupHealthRecord;
  fix: SetupHealthFix;
  words: string;
  values?: Record<string, string> | undefined;
  subject?: string | undefined;
  reason?: string | undefined;
  related?: Array<SetupHealthRecord> | undefined;
  fixRecordId?: string | undefined;
  startsAt?: string | undefined;
  balanceInUSDCents?: number | undefined;
}): SetupHealthFinding {
  const values: Record<string, string> = data.values || {};
  const subject: string = data.subject || "";

  const finding: SetupHealthFinding = {
    key: getSetupHealthFindingKey({
      check: data.check,
      subject: subject,
      record: data.record,
    }),
    check: data.check,
    level: data.level,
    subject: subject,
    reason: data.reason || "",
    record: data.record,
    related: data.related || [],
    fix: data.fix,
    fixRecordId: data.fixRecordId || "",
    words: data.words,
    values: values,
    sentence: fillTemplate(data.words, values),
  };

  if (data.startsAt) {
    finding.startsAt = data.startsAt;
  }

  if (data.balanceInUSDCents !== undefined) {
    finding.balanceInUSDCents = data.balanceInUSDCents;
  }

  return finding;
}

function capitalizeFirst(text: string): string {
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}

function monitorRecord(chain: WhoIsToldResult): SetupHealthRecord {
  return {
    kind: SetupHealthRecordKind.Monitor,
    id: chain.monitorId,
    name: chain.monitorName,
  };
}

function policyName(facts: SetupHealthFacts, policyId: string): string {
  return (
    facts.policies.find((policy: { id: string }): boolean => {
      return policy.id === policyId;
    })?.name || ""
  );
}

const PERSON_PROBLEM_REASONS: Readonly<
  Partial<Record<WhoIsToldPersonProblem, SetupHealthResponderReason>>
> = {
  [WhoIsToldPersonProblem.NoVerifiedMethod]:
    SetupHealthResponderReason.NoVerifiedMethod,
  [WhoIsToldPersonProblem.NoRuleNoFallback]:
    SetupHealthResponderReason.NoRuleNoFallback,
  [WhoIsToldPersonProblem.OptedOut]: SetupHealthResponderReason.OptedOut,
};

// A responder who can't be paged, for one reason.
function responderFinding(data: {
  userId: string;
  name: string;
  reason: SetupHealthResponderReason;
  related?: Array<SetupHealthRecord> | undefined;
}): SetupHealthFinding {
  return makeSetupHealthFinding({
    check: SetupHealthCheck.ResponderCannotBePaged,
    level: SetupHealthLevel.PagesWillNotArrive,
    record: {
      kind: SetupHealthRecordKind.User,
      id: data.userId,
      name: data.name,
    },
    reason: data.reason,
    related: data.related,
    fix: SetupHealthFix.OnCallReadiness,
    words: SETUP_HEALTH_WORDS.responderCannotBePaged[data.reason],
    values: { name: data.name || "Someone" },
  });
}

/*
 * ONE MONITOR'S BREAKS AS FINDINGS. A break about the monitor (nothing
 * happens, nobody is paged) is the monitor's; one about a policy or a
 * person is that record's, with the monitor as what it concerns; one about
 * the project's channels or the server is the project's.
 */
export function getChainFindings(
  facts: SetupHealthFacts,
  chain: WhoIsToldResult,
): Array<SetupHealthFinding> {
  const findings: Array<SetupHealthFinding> = [];
  const monitor: SetupHealthRecord = monitorRecord(chain);
  const values: Record<string, string> = { monitor: chain.monitorName };

  for (const brk of chain.breaks) {
    const finding: SetupHealthFinding | null = getBreakFinding({
      facts: facts,
      brk: brk,
      monitor: monitor,
      values: values,
    });

    if (finding) {
      findings.push(finding);
    }
  }

  return findings;
}

/*
 * Each incident and alert a chain opens that its reader may see, and the
 * incident an alert incident rule declares from it: one hidden from them
 * (isHidden, getSetupHealthFactsForReader) is left out, with what it
 * declares, as the card leaves them out.
 */
function getVisibleEvents(chain: WhoIsToldResult): Array<WhoIsToldEvent> {
  const events: Array<WhoIsToldEvent> = [];

  for (const item of chain.criteria) {
    for (const event of item.events) {
      if (event.isHidden) {
        continue;
      }

      events.push(event);

      if (event.declares && !event.declares.incident.isHidden) {
        events.push(event.declares.incident);
      }
    }
  }

  return events;
}

// What names an owner no email reaches, and why, as one subject.
function getOwnerSubject(
  owner: WhoIsToldOwnerNotReached,
): SetupHealthOwnerSubject {
  if (owner.problem === WhoIsToldOwnerProblem.TeamHasNobodyInProject) {
    return SetupHealthOwnerSubject.TeamHasNobody;
  }

  const isPerson: boolean =
    owner.problem === WhoIsToldOwnerProblem.NotInProject;

  switch (owner.addedBy) {
    case WhoIsToldOwnerAddedBy.NetworkDevice:
      return isPerson
        ? SetupHealthOwnerSubject.NetworkDeviceNotInProject
        : SetupHealthOwnerSubject.NetworkDeviceTeamOfAnotherProject;
    case WhoIsToldOwnerAddedBy.OwnerRule:
      return isPerson
        ? SetupHealthOwnerSubject.OwnerRuleNotInProject
        : SetupHealthOwnerSubject.OwnerRuleTeamOfAnotherProject;
    default:
      return isPerson
        ? SetupHealthOwnerSubject.CriteriaNotInProject
        : SetupHealthOwnerSubject.CriteriaTeamOfAnotherProject;
  }
}

/*
 * ONE OWNER NO CREATED EMAIL REACHES, AS A FINDING (#9371), about the
 * record that puts it right - as the card links it:
 *
 *   - a team of the project with nobody in it who is a member: the team,
 *     whose members are its fix, affecting the monitors whose records
 *     name it;
 *   - named in a monitor's criteria, or owning the network device a
 *     monitor watches: that monitor, with its criteria or the device's
 *     owners as its fix;
 *   - added by an owner rule: the rule, with the incident's or alert's
 *     owner rules as its fix, affecting the monitors whose records it
 *     adds them to.
 *
 * Null for an owner the card links no page for: a device's owner with no
 * device, an owner rule's with no rule.
 */
function getOwnerNotEmailedFinding(data: {
  chain: WhoIsToldResult;
  event: WhoIsToldEvent;
  owner: WhoIsToldOwnerNotReached;
}): SetupHealthFinding | null {
  const { chain, event, owner } = data;
  const monitor: SetupHealthRecord = monitorRecord(chain);
  const subject: SetupHealthOwnerSubject = getOwnerSubject(owner);
  const words: string = SETUP_HEALTH_WORDS.ownerNotEmailed[subject];

  if (subject === SetupHealthOwnerSubject.TeamHasNobody) {
    return makeSetupHealthFinding({
      check: SetupHealthCheck.OwnerNotEmailed,
      level: SetupHealthLevel.WorthFixing,
      record: {
        kind: SetupHealthRecordKind.Team,
        id: owner.id,
        name: owner.name,
      },
      subject: subject,
      related: [monitor],
      fix: SetupHealthFix.TeamMembers,
      fixRecordId: owner.id,
      words: words,
      values: { team: owner.name },
    });
  }

  if (owner.addedBy === WhoIsToldOwnerAddedBy.OwnerRule) {
    if (!owner.rule?.id) {
      return null;
    }

    const isAlert: boolean = event.kind === OnCallTestPageRecordKind.Alert;

    return makeSetupHealthFinding({
      check: SetupHealthCheck.OwnerNotEmailed,
      level: SetupHealthLevel.WorthFixing,
      record: {
        kind: isAlert
          ? SetupHealthRecordKind.AlertOwnerRule
          : SetupHealthRecordKind.IncidentOwnerRule,
        id: owner.rule.id,
        name: owner.rule.name,
      },
      subject: subject,
      related: [monitor],
      fix: isAlert
        ? SetupHealthFix.AlertOwnerRules
        : SetupHealthFix.IncidentOwnerRules,
      words: words,
      values: { rule: owner.rule.name },
    });
  }

  if (owner.addedBy === WhoIsToldOwnerAddedBy.NetworkDevice) {
    if (!owner.networkDeviceId) {
      return null;
    }

    return makeSetupHealthFinding({
      check: SetupHealthCheck.OwnerNotEmailed,
      level: SetupHealthLevel.WorthFixing,
      record: monitor,
      subject: subject,
      fix: SetupHealthFix.NetworkDeviceOwners,
      fixRecordId: owner.networkDeviceId,
      words: words,
      values: { monitor: chain.monitorName },
    });
  }

  return makeSetupHealthFinding({
    check: SetupHealthCheck.OwnerNotEmailed,
    level: SetupHealthLevel.WorthFixing,
    record: monitor,
    subject: subject,
    fix: SetupHealthFix.MonitorCriteria,
    fixRecordId: monitor.id,
    words: words,
    values: { monitor: chain.monitorName },
  });
}

/*
 * THE OWNERS NO CREATED EMAIL REACHES (#9371): every owner the chains'
 * incidents and alerts name that their Created email can't reach
 * (WhoIsToldOwners.notReached, the card's "Owners who aren't emailed"),
 * each as a finding about what puts it right. Worth fixing, not a page
 * that won't arrive: the email still goes out, to the owners it reaches or
 * to the Project Owners. A record hidden from the reader names nobody here,
 * as on the card. One place that names someone for many monitors is one
 * finding, affecting each.
 */
export function getOwnerNotEmailedFindings(
  facts: SetupHealthFacts,
): Array<SetupHealthFinding> {
  const findings: Array<SetupHealthFinding> = [];

  for (const chain of facts.chains) {
    for (const event of getVisibleEvents(chain)) {
      for (const owner of event.owners.notReached || []) {
        const finding: SetupHealthFinding | null = getOwnerNotEmailedFinding({
          chain: chain,
          event: event,
          owner: owner,
        });

        if (finding) {
          findings.push(finding);
        }
      }
    }
  }

  return findings;
}

/*
 * THE FACTS AS ONE READER'S CARDS TELL THEM (#9370). A private incident or
 * alert a monitor would open that is not the reader's to see once it
 * exists (#7213) raises no break on that monitor's card for them - nothing
 * of whom it tells - so it raises no finding here either: each chain with
 * such a record has its breaks worked out again without it, as the card
 * works them out (getWhoIsToldBreaksForReader). A policy's or a person's
 * break that some other record raises stays, about that record's monitor
 * alone. Such a record is marked hidden too (isHidden), so none of its
 * owners no Created email reaches is listed for them (#9371): the card
 * tells them nothing of its owners. The chains themselves are kept whole,
 * so a policy a private record's criteria names is still run by something
 * (getPolicyNotRunFindings). The same facts when nothing is hidden from the
 * reader.
 */
export function getSetupHealthFactsForReader(
  facts: SetupHealthFacts,
  isHidden: (event: WhoIsToldEvent) => boolean,
): SetupHealthFacts {
  if (
    !facts.chains.some((chain: WhoIsToldResult): boolean => {
      return hasWhoIsToldHiddenEvent(chain, isHidden);
    })
  ) {
    return facts;
  }

  // A record as the reader is told it: marked hidden when it is.
  const marked: (event: WhoIsToldEvent) => WhoIsToldEvent = (
    event: WhoIsToldEvent,
  ): WhoIsToldEvent => {
    return isHidden(event) ? { ...event, isHidden: true } : event;
  };

  return {
    ...facts,
    chains: facts.chains.map((chain: WhoIsToldResult): WhoIsToldResult => {
      if (!hasWhoIsToldHiddenEvent(chain, isHidden)) {
        return chain;
      }

      return {
        ...chain,
        breaks: getWhoIsToldBreaksForReader({
          result: chain,
          isHidden: isHidden,
        }),
        criteria: chain.criteria.map(
          (item: WhoIsToldCriteria): WhoIsToldCriteria => {
            return {
              ...item,
              events: item.events.map((event: WhoIsToldEvent) => {
                const shown: WhoIsToldEvent = marked(event);

                return event.declares
                  ? {
                      ...shown,
                      declares: {
                        ...event.declares,
                        incident: marked(event.declares.incident),
                      },
                    }
                  : shown;
              }),
            };
          },
        ),
      };
    }),
  };
}

// Whether some chain would open a private incident or alert.
export function hasSetupHealthPrivateEvent(facts: SetupHealthFacts): boolean {
  return facts.chains.some((chain: WhoIsToldResult): boolean => {
    return hasWhoIsToldHiddenEvent(chain, (event: WhoIsToldEvent): boolean => {
      return event.isPrivate === true;
    });
  });
}

function getBreakFinding(data: {
  facts: SetupHealthFacts;
  brk: WhoIsToldBreak;
  monitor: SetupHealthRecord;
  values: Record<string, string>;
}): SetupHealthFinding | null {
  const brk: WhoIsToldBreak = data.brk;

  switch (brk.kind) {
    case WhoIsToldBreakKind.NothingHappens:
      return makeSetupHealthFinding({
        check: SetupHealthCheck.MonitorTellsNobody,
        level: SetupHealthLevel.WorthFixing,
        record: data.monitor,
        fix: SetupHealthFix.MonitorCriteria,
        fixRecordId: data.monitor.id,
        words: SETUP_HEALTH_WORDS.monitorTellsNobody,
        values: data.values,
      });
    case WhoIsToldBreakKind.NobodyPaged: {
      const kind: SetupHealthEventKind =
        brk.recordKind === OnCallTestPageRecordKind.Alert
          ? SetupHealthEventKind.Alert
          : SetupHealthEventKind.Incident;

      /*
       * In a project with no on-call policy yet, email to the owners may be
       * just what they want: a suggestion, not a problem - and its fix is
       * the on-call guided setup, which makes the first policy with the
       * rules that run it, not the rules builder, whose rules would have no
       * policy to page (#7369).
       */
      const hasPolicies: boolean = data.facts.policies.length > 0;

      return makeSetupHealthFinding({
        check: SetupHealthCheck.MonitorPagesNobody,
        level: hasPolicies
          ? SetupHealthLevel.WorthFixing
          : SetupHealthLevel.Suggestion,
        record: data.monitor,
        subject: kind,
        fix: !hasPolicies
          ? SetupHealthFix.OnCallGuidedSetup
          : kind === SetupHealthEventKind.Alert
            ? SetupHealthFix.AlertOnCallRules
            : SetupHealthFix.IncidentOnCallRules,
        words: SETUP_HEALTH_WORDS.monitorPagesNobody[kind],
        values: data.values,
      });
    }
    case WhoIsToldBreakKind.OnlyIncidentsHaveRules:
      return makeSetupHealthFinding({
        check: SetupHealthCheck.MonitorAlertsPageNobody,
        level: SetupHealthLevel.PagesWillNotArrive,
        record: data.monitor,
        fix: SetupHealthFix.AlertOnCallRules,
        words: SETUP_HEALTH_WORDS.monitorAlertsPageNobody,
        values: data.values,
      });
    case WhoIsToldBreakKind.PolicyHasNoLevels:
    case WhoIsToldBreakKind.PolicyReachesNobody: {
      if (!brk.policyId) {
        return null;
      }

      const name: string =
        brk.policyName || policyName(data.facts, brk.policyId);
      const hasNoLevels: boolean =
        brk.kind === WhoIsToldBreakKind.PolicyHasNoLevels;

      return makeSetupHealthFinding({
        check: hasNoLevels
          ? SetupHealthCheck.PolicyHasNoEscalationRules
          : SetupHealthCheck.PolicyReachesNobody,
        level: SetupHealthLevel.PagesWillNotArrive,
        record: {
          kind: SetupHealthRecordKind.OnCallDutyPolicy,
          id: brk.policyId,
          name: name,
        },
        related: [data.monitor],
        fix: SetupHealthFix.OnCallPolicy,
        fixRecordId: brk.policyId,
        words: hasNoLevels
          ? SETUP_HEALTH_WORDS.policyHasNoEscalationRules
          : SETUP_HEALTH_WORDS.policyReachesNobody,
        values: { policy: name },
      });
    }
    case WhoIsToldBreakKind.PersonUnreachable: {
      const reason: SetupHealthResponderReason | undefined = brk.problem
        ? PERSON_PROBLEM_REASONS[brk.problem]
        : SetupHealthResponderReason.NoVerifiedMethod;

      // Reached only by switched-off channels: the switch's finding.
      if (!brk.userId || !reason) {
        return null;
      }

      return responderFinding({
        userId: brk.userId,
        name: brk.userName || "",
        reason: reason,
        related: brk.policyId
          ? [
              {
                kind: SetupHealthRecordKind.OnCallDutyPolicy,
                id: brk.policyId,
                name: brk.policyName || policyName(data.facts, brk.policyId),
              },
            ]
          : [],
      });
    }
    case WhoIsToldBreakKind.ChannelOff: {
      const channel: OnCallPageChannel =
        (brk.channel as OnCallPageChannel) || OnCallPageChannel.SMS;

      return makeSetupHealthFinding({
        check: SetupHealthCheck.ChannelOff,
        level: SetupHealthLevel.PagesWillNotArrive,
        record: projectRecord(data.facts),
        subject: channel,
        related: [data.monitor],
        fix: SetupHealthFix.ProjectNotificationSettings,
        words: SETUP_HEALTH_WORDS.channelOff,
        // It starts the sentence: "Phone call is off ...".
        values: { channel: capitalizeFirst(getOnCallPageChannelName(channel)) },
      });
    }
    case WhoIsToldBreakKind.NoBalance:
      return makeSetupHealthFinding({
        check: SetupHealthCheck.NoBalance,
        level: SetupHealthLevel.PagesWillNotArrive,
        record: projectRecord(data.facts),
        related: [data.monitor],
        fix: SetupHealthFix.ProjectBilling,
        words: SETUP_HEALTH_WORDS.noBalance,
      });
    case WhoIsToldBreakKind.ServerCannotSend:
      return serverFinding(
        data.facts,
        (brk.channel as WhoIsToldServerChannel) || WhoIsToldServerChannel.Email,
        [data.monitor],
      );
  }
}

function serverFinding(
  facts: SetupHealthFacts,
  channel: WhoIsToldServerChannel,
  related: Array<SetupHealthRecord>,
): SetupHealthFinding {
  return makeSetupHealthFinding({
    check: SetupHealthCheck.ServerCannotSend,
    level: SetupHealthLevel.PagesWillNotArrive,
    record: projectRecord(facts),
    subject: channel,
    related: related,
    fix: SetupHealthFix.ServerSettings,
    words: SETUP_HEALTH_WORDS.serverCannotSend[channel],
  });
}

/*
 * The people Readiness says nothing reaches - on any policy, not only the
 * ones a monitor runs: an invitation not accepted, somebody who left, no
 * verified method.
 */
export function getResponderFindings(
  facts: SetupHealthFacts,
): Array<SetupHealthFinding> {
  return facts.responders
    .filter((responder: SetupHealthResponderFact): boolean => {
      return responder.isNotReachable;
    })
    .map((responder: SetupHealthResponderFact): SetupHealthFinding => {
      return responderFinding({
        userId: responder.userId,
        name: responder.name,
        reason: responder.reason,
      });
    });
}

/*
 * The people on a policy with no verified phone method while their project
 * asks everyone on call for one (#7449), as Readiness answers it - never
 * worked out a second time. Somebody nothing reaches is already a finding
 * of their own (getResponderFindings), which says more.
 */
export function getResponderPhoneFindings(
  facts: SetupHealthFacts,
): Array<SetupHealthFinding> {
  return facts.responders
    .filter((responder: SetupHealthResponderFact): boolean => {
      return (
        Boolean(responder.isMissingPhoneMethod) && !responder.isNotReachable
      );
    })
    .map((responder: SetupHealthResponderFact): SetupHealthFinding => {
      return makeSetupHealthFinding({
        check: SetupHealthCheck.ResponderHasNoPhone,
        level: SetupHealthLevel.WorthFixing,
        record: {
          kind: SetupHealthRecordKind.User,
          id: responder.userId,
          name: responder.name,
        },
        fix: SetupHealthFix.OnCallReadiness,
        words: SETUP_HEALTH_WORDS.responderHasNoPhone,
        values: { name: responder.name || "Someone" },
      });
    });
}

// The ids of the policies a monitor's criteria names for what it opens.
function getPolicyIdsNamedByCriteria(
  chains: ReadonlyArray<WhoIsToldResult>,
): Set<string> {
  const named: Set<string> = new Set<string>();

  for (const chain of chains) {
    for (const item of chain.criteria as Array<WhoIsToldCriteria>) {
      for (const event of item.events as Array<WhoIsToldEvent>) {
        for (const policy of event.policies as Array<WhoIsToldPolicy>) {
          if (policy.isNamedByCriteria) {
            named.add(policy.id);
          }
        }
      }
    }
  }

  return named;
}

/*
 * A policy nothing runs: no enabled on-call rule of any kind names it, and
 * no monitor's criteria does. It pages nobody unless somebody adds it to an
 * incident by hand.
 */
export function getPolicyNotRunFindings(
  facts: SetupHealthFacts,
): Array<SetupHealthFinding> {
  const runByRules: Set<string> = new Set<string>(facts.policyIdsRunByRules);
  const named: Set<string> = getPolicyIdsNamedByCriteria(facts.chains);

  return facts.policies
    .filter((policy: { id: string }): boolean => {
      return !runByRules.has(policy.id) && !named.has(policy.id);
    })
    .map((policy: { id: string; name: string }): SetupHealthFinding => {
      return makeSetupHealthFinding({
        check: SetupHealthCheck.PolicyNotRun,
        level: SetupHealthLevel.WorthFixing,
        record: {
          kind: SetupHealthRecordKind.OnCallDutyPolicy,
          id: policy.id,
          name: policy.name,
        },
        fix: SetupHealthFix.IncidentOnCallRules,
        words: SETUP_HEALTH_WORDS.policyNotRun,
        values: { policy: policy.name },
      });
    });
}

// A schedule a policy pages with nobody on call in it, now or soon.
export function getScheduleFindings(
  facts: SetupHealthFacts,
): Array<SetupHealthFinding> {
  const findings: Array<SetupHealthFinding> = [];

  for (const schedule of facts.schedules) {
    if (!schedule.reason) {
      continue;
    }

    if (
      schedule.reason === SetupHealthScheduleReason.GapAhead &&
      !schedule.gapStartsAt
    ) {
      continue;
    }

    findings.push(
      makeSetupHealthFinding({
        check: SetupHealthCheck.ScheduleHasNobodyOnCall,
        level: SetupHealthLevel.WorthFixing,
        record: {
          kind: SetupHealthRecordKind.OnCallDutyPolicySchedule,
          id: schedule.id,
          name: schedule.name,
        },
        reason: schedule.reason,
        fix: SetupHealthFix.OnCallSchedule,
        fixRecordId: schedule.id,
        words: SETUP_HEALTH_WORDS.scheduleHasNobodyOnCall[schedule.reason],
        values: {
          schedule: schedule.name,
          ...(schedule.gapStartsAt
            ? { time: formatEnglishTime(schedule.gapStartsAt) }
            : {}),
        },
        startsAt: schedule.gapStartsAt || undefined,
      }),
    );
  }

  return findings;
}

// "2026-11-14 03:00 UTC", as Installation health writes a time for English readers.
export function formatEnglishTime(value: string): string {
  const date: Date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// "$4.20", for English readers.
export function formatEnglishUsd(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

/*
 * Whether some page of some monitor goes out by a channel paid from
 * the balance: SMS or calls not sent through the project's own Twilio,
 * WhatsApp, Telegram.
 */
export function usesPaidMessages(facts: SetupHealthFacts): boolean {
  const channels: WhoIsToldChannels | null = facts.channels;

  for (const chain of facts.chains) {
    for (const item of chain.criteria) {
      for (const event of item.events) {
        for (const policy of event.policies) {
          for (const person of policy.people as Array<WhoIsToldPerson>) {
            for (const channel of person.channels) {
              if (
                (channel === OnCallPageChannel.SMS &&
                  !channels?.hasOwnTwilioForSms) ||
                (channel === OnCallPageChannel.Call &&
                  !channels?.hasOwnTwilioForCalls) ||
                channel === OnCallPageChannel.WhatsApp ||
                channel === OnCallPageChannel.Telegram
              ) {
                return true;
              }
            }
          }
        }
      }
    }
  }

  return false;
}

/*
 * OneUptime Cloud: pages go out by SMS or calls paid from a balance that is
 * low - below the project's own auto-recharge threshold - while
 * auto-recharge is off. An empty balance is the chains' NoBalance.
 */
export function getLowBalanceFindings(
  facts: SetupHealthFacts,
): Array<SetupHealthFinding> {
  const balance: SetupHealthBalanceFact | null = facts.balance;

  if (
    !balance ||
    balance.isAutoRechargeOn ||
    balance.balanceInUSDCents <= 0 ||
    balance.balanceInUSDCents >= balance.lowBalanceInUSDCents ||
    !usesPaidMessages(facts)
  ) {
    return [];
  }

  return [
    makeSetupHealthFinding({
      check: SetupHealthCheck.LowBalance,
      level: SetupHealthLevel.WorthFixing,
      record: projectRecord(facts),
      fix: SetupHealthFix.ProjectBilling,
      words: SETUP_HEALTH_WORDS.lowBalance,
      values: { balance: formatEnglishUsd(balance.balanceInUSDCents) },
      balanceInUSDCents: balance.balanceInUSDCents,
    }),
  ];
}

/*
 * Self-hosted: a server that can't send email leaves every project without
 * it - owners are not emailed, nor are invitations - whether or not a
 * monitor would email anyone. SMS and calls are the chains' to say, when a
 * page uses them.
 */
export function getServerFindings(
  facts: SetupHealthFacts,
): Array<SetupHealthFinding> {
  if (facts.serverCanSendEmail !== false) {
    return [];
  }

  return [serverFinding(facts, WhoIsToldServerChannel.Email, [])];
}

// A monitor's record, from what the server read of it.
function monitorFactRecord(monitor: SetupHealthMonitorFact): SetupHealthRecord {
  return {
    kind: SetupHealthRecordKind.Monitor,
    id: monitor.id,
    name: monitor.name,
  };
}

/*
 * A monitor checked by probes that no probe checks: none is turned on for
 * it, or every one it uses is disconnected. It never goes down, so nobody
 * is ever told.
 */
export function getMonitorNotCheckedFindings(
  facts: SetupHealthFacts,
): Array<SetupHealthFinding> {
  const findings: Array<SetupHealthFinding> = [];

  for (const monitor of facts.monitors) {
    if (monitor.isTurnedOff || !monitor.isCheckedByProbes) {
      continue;
    }

    let reason: SetupHealthMonitorReason | null = null;

    if (monitor.hasNoProbeOn) {
      reason = SetupHealthMonitorReason.NoProbe;
    } else if (monitor.areAllProbesDisconnected) {
      reason = SetupHealthMonitorReason.ProbesDisconnected;
    }

    if (!reason) {
      continue;
    }

    findings.push(
      makeSetupHealthFinding({
        check: SetupHealthCheck.MonitorNotChecked,
        level: SetupHealthLevel.WorthFixing,
        record: monitorFactRecord(monitor),
        reason: reason,
        fix: SetupHealthFix.MonitorProbes,
        fixRecordId: monitor.id,
        words: SETUP_HEALTH_WORDS.monitorNotChecked[reason],
        values: { monitor: monitor.name },
      }),
    );
  }

  return findings;
}

/*
 * A monitor turned off by hand, and unchanged since, for more than 30 days:
 * most often forgotten. Its last change is the latest it can have been
 * turned off, so "more than 30 days" is never more than the truth.
 */
export function getMonitorOffForLongFindings(
  facts: SetupHealthFacts,
): Array<SetupHealthFinding> {
  const now: number = new Date(facts.now).getTime();
  const limit: number = MONITOR_OFF_FOR_LONG_IN_DAYS * DAY_IN_MS;

  return facts.monitors
    .filter((monitor: SetupHealthMonitorFact): boolean => {
      if (!monitor.isTurnedOff || !monitor.updatedAt) {
        return false;
      }

      const updatedAt: number = new Date(monitor.updatedAt).getTime();

      return !Number.isNaN(updatedAt) && now - updatedAt > limit;
    })
    .map((monitor: SetupHealthMonitorFact): SetupHealthFinding => {
      return makeSetupHealthFinding({
        check: SetupHealthCheck.MonitorOffForLong,
        level: SetupHealthLevel.Suggestion,
        record: monitorFactRecord(monitor),
        fix: SetupHealthFix.MonitorOverview,
        fixRecordId: monitor.id,
        words: SETUP_HEALTH_WORDS.monitorOffForLong,
        values: { monitor: monitor.name },
      });
    });
}

// A status page that shows no monitor and no monitor group.
export function getStatusPageFindings(
  facts: SetupHealthFacts,
): Array<SetupHealthFinding> {
  return facts.statusPages
    .filter((page: SetupHealthStatusPageFact): boolean => {
      return page.resourceCount === 0;
    })
    .map((page: SetupHealthStatusPageFact): SetupHealthFinding => {
      return makeSetupHealthFinding({
        check: SetupHealthCheck.StatusPageShowsNoMonitor,
        level: SetupHealthLevel.WorthFixing,
        record: {
          kind: SetupHealthRecordKind.StatusPage,
          id: page.id,
          name: page.name,
        },
        fix: SetupHealthFix.StatusPageResources,
        fixRecordId: page.id,
        words: SETUP_HEALTH_WORDS.statusPageShowsNoMonitor,
        values: { statusPage: page.name },
      });
    });
}

/*
 * A status page's custom domain whose CNAME record is not verified, an
 * hour after it was added: it does not open the status page yet.
 */
export function getStatusPageDomainFindings(
  facts: SetupHealthFacts,
): Array<SetupHealthFinding> {
  const now: number = new Date(facts.now).getTime();

  return facts.statusPageDomains
    .filter((domain: SetupHealthDomainFact): boolean => {
      if (domain.isCnameVerified) {
        return false;
      }

      const createdAt: number = domain.createdAt
        ? new Date(domain.createdAt).getTime()
        : Number.NaN;

      return (
        Number.isNaN(createdAt) ||
        now - createdAt > DOMAIN_VERIFICATION_GRACE_IN_MS
      );
    })
    .map((domain: SetupHealthDomainFact): SetupHealthFinding => {
      return makeSetupHealthFinding({
        check: SetupHealthCheck.StatusPageDomainNotVerified,
        level: SetupHealthLevel.WorthFixing,
        record: {
          kind: SetupHealthRecordKind.StatusPageDomain,
          id: domain.id,
          name: domain.fullDomain,
        },
        related: [
          {
            kind: SetupHealthRecordKind.StatusPage,
            id: domain.statusPageId,
            name: domain.statusPageName,
          },
        ],
        fix: SetupHealthFix.StatusPageDomains,
        fixRecordId: domain.statusPageId,
        words: SETUP_HEALTH_WORDS.statusPageDomainNotVerified,
        values: {
          domain: domain.fullDomain,
          statusPage: domain.statusPageName,
        },
      });
    });
}

/*
 * Why a verified domain's free certificate does not serve it, or null when
 * it does or may yet: expired, or never issued because its last order
 * failed - the Custom Domains page's "Certificate expired" and "Could not
 * issue a free certificate yet". An order is placed within minutes of the
 * CNAME record being verified and is usually live within 15, so a domain
 * added within the hour is not yet said to have failed. A certificate still
 * being issued, with no failed order, is not a failure.
 */
export function getDomainCertificateReason(
  domain: SetupHealthDomainFact,
  now: number,
): SetupHealthCertificateReason | null {
  const certificate: SetupHealthDomainCertificateFact | null | undefined =
    domain.certificate;

  if (!domain.isCnameVerified || domain.isCustomCertificate || !certificate) {
    return null;
  }

  if (certificate.expiresAt) {
    const expiresAt: number = new Date(certificate.expiresAt).getTime();

    return !Number.isNaN(expiresAt) && expiresAt <= now
      ? SetupHealthCertificateReason.Expired
      : null;
  }

  if (!certificate.hasOrderFailed) {
    return null;
  }

  const createdAt: number = domain.createdAt
    ? new Date(domain.createdAt).getTime()
    : Number.NaN;

  return Number.isNaN(createdAt) ||
    now - createdAt > DOMAIN_VERIFICATION_GRACE_IN_MS
    ? SetupHealthCertificateReason.NotIssued
    : null;
}

/*
 * A status page's custom domain whose CNAME record is verified, but whose
 * free certificate does not serve it: the page does not open on it over
 * HTTPS. A domain served with a certificate its owner uploaded has none to
 * issue.
 */
export function getStatusPageDomainCertificateFindings(
  facts: SetupHealthFacts,
): Array<SetupHealthFinding> {
  const now: number = new Date(facts.now).getTime();
  const findings: Array<SetupHealthFinding> = [];

  for (const domain of facts.statusPageDomains) {
    const reason: SetupHealthCertificateReason | null =
      getDomainCertificateReason(domain, now);

    if (!reason) {
      continue;
    }

    findings.push(
      makeSetupHealthFinding({
        check: SetupHealthCheck.StatusPageDomainCertificateFailed,
        level: SetupHealthLevel.WorthFixing,
        record: {
          kind: SetupHealthRecordKind.StatusPageDomain,
          id: domain.id,
          name: domain.fullDomain,
        },
        reason: reason,
        related: [
          {
            kind: SetupHealthRecordKind.StatusPage,
            id: domain.statusPageId,
            name: domain.statusPageName,
          },
        ],
        fix: SetupHealthFix.StatusPageDomains,
        fixRecordId: domain.statusPageId,
        words: SETUP_HEALTH_WORDS.statusPageDomainCertificateFailed[reason],
        values: {
          domain: domain.fullDomain,
          statusPage: domain.statusPageName,
        },
      }),
    );
  }

  return findings;
}

/*
 * A project with more than one person and only one owner: nobody else can
 * manage its billing, members and settings while they are away.
 */
export function getOwnerFindings(
  facts: SetupHealthFacts,
): Array<SetupHealthFinding> {
  if (
    !facts.owners ||
    facts.owners.ownerCount !== 1 ||
    facts.owners.memberCount < 2
  ) {
    return [];
  }

  return [
    makeSetupHealthFinding({
      check: SetupHealthCheck.OneOwner,
      level: SetupHealthLevel.Suggestion,
      record: projectRecord(facts),
      fix: SetupHealthFix.ProjectOwners,
      words: SETUP_HEALTH_WORDS.oneOwner,
    }),
  ];
}

// A chat workspace that is connected, with no notification rule posting to it.
export function getWorkspaceFindings(
  facts: SetupHealthFacts,
): Array<SetupHealthFinding> {
  return facts.workspaces
    .filter((workspace: SetupHealthWorkspaceFact): boolean => {
      return workspace.ruleCount === 0;
    })
    .map((workspace: SetupHealthWorkspaceFact): SetupHealthFinding => {
      return makeSetupHealthFinding({
        check: SetupHealthCheck.WorkspaceNotUsed,
        level: SetupHealthLevel.Suggestion,
        record: projectRecord(facts),
        subject: workspace.workspaceType,
        fix: SetupHealthFix.WorkspaceNotificationRules,
        words: SETUP_HEALTH_WORDS.workspaceNotUsed,
        values: { workspace: workspace.workspaceName },
      });
    });
}

// Telemetry arrives, and no monitor of logs, metrics, traces or exceptions watches it.
export function getTelemetryFindings(
  facts: SetupHealthFacts,
): Array<SetupHealthFinding> {
  if (
    !facts.telemetry?.receivesTelemetry ||
    facts.monitors.some((monitor: SetupHealthMonitorFact): boolean => {
      return monitor.isTelemetryMonitor;
    })
  ) {
    return [];
  }

  return [
    makeSetupHealthFinding({
      check: SetupHealthCheck.TelemetryNotWatched,
      level: SetupHealthLevel.Suggestion,
      record: projectRecord(facts),
      fix: SetupHealthFix.CreateMonitor,
      words: SETUP_HEALTH_WORDS.telemetryNotWatched,
    }),
  ];
}

/*
 * Whether nothing has ever arrived with an ingestion key, as far as its
 * recorded use can say (INGESTION_KEY_USE_RECORDED_SINCE): a key that is
 * on and has not expired, made more than a week ago, with no use recorded
 * since it was made.
 */
export function isIngestionKeyNeverUsed(data: {
  key: SetupHealthIngestionKeyFact;
  now: number;
  // The project has never received logs, metrics, traces, exceptions or profiles.
  receivesNoTelemetry: boolean;
}): boolean {
  const key: SetupHealthIngestionKeyFact = data.key;

  if (key.isDisabled || key.lastUsedAt) {
    return false;
  }

  const expiresAt: number = key.expiresAt
    ? new Date(key.expiresAt).getTime()
    : Number.NaN;

  if (!Number.isNaN(expiresAt) && expiresAt <= data.now) {
    return false;
  }

  const createdAt: number = key.createdAt
    ? new Date(key.createdAt).getTime()
    : Number.NaN;

  if (
    Number.isNaN(createdAt) ||
    data.now - createdAt <= INGESTION_KEY_UNUSED_AFTER_IN_DAYS * DAY_IN_MS
  ) {
    return false;
  }

  if (createdAt >= new Date(INGESTION_KEY_USE_RECORDED_SINCE).getTime()) {
    return true;
  }

  return (
    data.receivesNoTelemetry &&
    createdAt >= new Date(INGESTION_KEY_HTTP_USE_RECORDED_SINCE).getTime()
  );
}

/*
 * An ingestion key nothing has ever sent with: a collector or an SDK that
 * was never pointed at it, or a key nobody needs. A suggestion: its page
 * says when it was last used, and deletes it.
 */
export function getIngestionKeyFindings(
  facts: SetupHealthFacts,
): Array<SetupHealthFinding> {
  const now: number = new Date(facts.now).getTime();
  // Unknown when the milestones could not be read: then only the stamp decides.
  const receivesNoTelemetry: boolean =
    facts.telemetry !== null && !facts.telemetry.receivesTelemetry;

  return facts.ingestionKeys
    .filter((key: SetupHealthIngestionKeyFact): boolean => {
      return isIngestionKeyNeverUsed({
        key: key,
        now: now,
        receivesNoTelemetry: receivesNoTelemetry,
      });
    })
    .map((key: SetupHealthIngestionKeyFact): SetupHealthFinding => {
      return makeSetupHealthFinding({
        check: SetupHealthCheck.IngestionKeyNeverUsed,
        level: SetupHealthLevel.Suggestion,
        record: {
          kind: SetupHealthRecordKind.TelemetryIngestionKey,
          id: key.id,
          name: key.name,
        },
        fix: SetupHealthFix.TelemetryIngestionKey,
        fixRecordId: key.id,
        words: SETUP_HEALTH_WORDS.ingestionKeyNeverUsed,
        values: { key: key.name },
      });
    });
}

// The rules, each a function of the facts.
export const SETUP_HEALTH_RULES: ReadonlyArray<
  (facts: SetupHealthFacts) => Array<SetupHealthFinding>
> = [
  (facts: SetupHealthFacts): Array<SetupHealthFinding> => {
    return facts.chains.flatMap(
      (chain: WhoIsToldResult): Array<SetupHealthFinding> => {
        return getChainFindings(facts, chain);
      },
    );
  },
  getResponderFindings,
  getResponderPhoneFindings,
  getServerFindings,
  getOwnerNotEmailedFindings,
  getPolicyNotRunFindings,
  getScheduleFindings,
  getLowBalanceFindings,
  getMonitorNotCheckedFindings,
  getMonitorOffForLongFindings,
  getStatusPageFindings,
  getStatusPageDomainFindings,
  getStatusPageDomainCertificateFindings,
  getOwnerFindings,
  getWorkspaceFindings,
  getTelemetryFindings,
  getIngestionKeyFindings,
];

function addRelated(
  into: Array<SetupHealthRecord>,
  records: ReadonlyArray<SetupHealthRecord>,
): void {
  for (const record of records) {
    if (
      !into.some((known: SetupHealthRecord): boolean => {
        return known.kind === record.kind && known.id === record.id;
      })
    ) {
      into.push(record);
    }
  }
}

function reasonRank(finding: SetupHealthFinding): number {
  const index: number = SETUP_HEALTH_RESPONDER_REASON_ORDER.indexOf(
    finding.reason as SetupHealthResponderReason,
  );

  return index === -1 ? SETUP_HEALTH_RESPONDER_REASON_ORDER.length : index;
}

function levelRank(level: SetupHealthLevel): number {
  return SETUP_HEALTH_LEVEL_ORDER.indexOf(level);
}

function checkRank(check: SetupHealthCheck): number {
  return SETUP_HEALTH_CHECK_ORDER.indexOf(check);
}

/*
 * Worst first, then by check, then by the record's name - so the page
 * reads the same way every time.
 */
export function compareSetupHealthFindings(
  a: SetupHealthFinding,
  b: SetupHealthFinding,
): number {
  return (
    levelRank(a.level) - levelRank(b.level) ||
    checkRank(a.check) - checkRank(b.check) ||
    a.subject.localeCompare(b.subject) ||
    a.record.name.localeCompare(b.record.name) ||
    a.key.localeCompare(b.key)
  );
}

/*
 * EVERY FINDING OF A PROJECT, each once, worst first. A finding several
 * rules or monitors make (a policy many monitors run, the server's email)
 * is said once, with every record it concerns; a responder found by both
 * Readiness and a chain keeps the worst reason. One key is one check, so
 * the findings it merges are of one level.
 */
export function getSetupHealthFindings(
  facts: SetupHealthFacts,
): Array<SetupHealthFinding> {
  const byKey: Map<string, SetupHealthFinding> = new Map<
    string,
    SetupHealthFinding
  >();

  for (const rule of SETUP_HEALTH_RULES) {
    for (const finding of rule(facts)) {
      const known: SetupHealthFinding | undefined = byKey.get(finding.key);

      if (!known) {
        byKey.set(finding.key, {
          ...finding,
          related: [...finding.related],
        });
        continue;
      }

      const kept: SetupHealthFinding =
        reasonRank(finding) < reasonRank(known)
          ? { ...finding, related: [...known.related] }
          : known;

      addRelated(kept.related, finding.related);
      byKey.set(finding.key, kept);
    }
  }

  return Array.from(byKey.values()).sort(compareSetupHealthFindings);
}

/*
 * THE DISMISSAL OF A FINDING, as a RecommendationDismissal row holds it
 * (RecommendationType.SetupHealth): the check and its subject as the
 * recommendation, the record as the resource.
 */
export function getSetupHealthDismissalId(
  finding: Pick<SetupHealthFinding, "check" | "subject">,
): string {
  return finding.subject
    ? `${finding.check}:${finding.subject}`
    : finding.check;
}

export interface SetupHealthDismissal {
  // The RecommendationDismissal's id: Restore deletes it.
  id: string;
  recommendationId: string;
  resourceType: string;
  resourceId: string;
  reason: string;
  dismissedByName: string;
  // When, as an ISO date.
  dismissedAt: string | null;
}

export interface DismissedSetupHealthFinding {
  finding: SetupHealthFinding;
  dismissal: SetupHealthDismissal;
}

// The dismissal a finding is hidden by, if any.
export function findSetupHealthDismissal(
  finding: SetupHealthFinding,
  dismissals: ReadonlyArray<SetupHealthDismissal>,
): SetupHealthDismissal | null {
  const recommendationId: string = getSetupHealthDismissalId(finding);

  return (
    dismissals.find((dismissal: SetupHealthDismissal): boolean => {
      return (
        dismissal.recommendationId === recommendationId &&
        dismissal.resourceType === finding.record.kind &&
        dismissal.resourceId === finding.record.id
      );
    }) || null
  );
}

/*
 * The findings, with the dismissed ones set apart. A dismissal of a
 * finding that is gone (fixed since) hides nothing and is not listed.
 */
export function applySetupHealthDismissals(
  findings: ReadonlyArray<SetupHealthFinding>,
  dismissals: ReadonlyArray<SetupHealthDismissal>,
): {
  findings: Array<SetupHealthFinding>;
  dismissed: Array<DismissedSetupHealthFinding>;
} {
  const open: Array<SetupHealthFinding> = [];
  const dismissed: Array<DismissedSetupHealthFinding> = [];

  for (const finding of findings) {
    const dismissal: SetupHealthDismissal | null = findSetupHealthDismissal(
      finding,
      dismissals,
    );

    if (dismissal) {
      dismissed.push({ finding: finding, dismissal: dismissal });
    } else {
      open.push(finding);
    }
  }

  return { findings: open, dismissed: dismissed };
}

export interface SetupHealthCounts {
  pagesWillNotArrive: number;
  worthFixing: number;
  suggestion: number;
  // What Home's "Needs attention" says: the first two levels.
  needsALook: number;
}

export function getSetupHealthCounts(
  findings: ReadonlyArray<Pick<SetupHealthFinding, "level">>,
): SetupHealthCounts {
  const count: (level: SetupHealthLevel) => number = (
    level: SetupHealthLevel,
  ): number => {
    return findings.filter((finding: Pick<SetupHealthFinding, "level">) => {
      return finding.level === level;
    }).length;
  };

  const pagesWillNotArrive: number = count(SetupHealthLevel.PagesWillNotArrive);
  const worthFixing: number = count(SetupHealthLevel.WorthFixing);

  return {
    pagesWillNotArrive: pagesWillNotArrive,
    worthFixing: worthFixing,
    suggestion: count(SetupHealthLevel.Suggestion),
    needsALook: pagesWillNotArrive + worthFixing,
  };
}

/*
 * THE ANSWER ONE PERSON IS HANDED (GET /api/setup-health): the findings
 * about records they may read, the dismissed ones set apart, and what was
 * looked at.
 */
export interface SetupHealthAnswer {
  findings: Array<SetupHealthFinding>;
  dismissed: Array<DismissedSetupHealthFinding>;
  counts: SetupHealthCounts;
  // How many monitors' chains were looked at.
  monitorCount: number;
  // When the findings were worked out, as an ISO date: they are kept a minute.
  checkedAt: string;
}

// What Home asks for (GET /api/setup-health/summary): the counts only.
export interface SetupHealthSummary {
  counts: SetupHealthCounts;
  checkedAt: string;
}

/*
 * THE FINDINGS ONE PERSON MAY SEE. A finding is shown only when its record
 * may be read: a monitor, policy, schedule, status page or ingestion key by
 * its id; a domain by its status page; a person through the on-call
 * policies (as Readiness is); the project's own findings to every member.
 * What it concerns is cut to what may be read too.
 */
export interface SetupHealthReadable {
  monitorIds: ReadonlySet<string>;
  policyIds: ReadonlySet<string>;
  scheduleIds: ReadonlySet<string>;
  statusPageIds: ReadonlySet<string>;
  ingestionKeyIds: ReadonlySet<string>;
  // The caller may read the project's on-call policies (and so Readiness).
  canReadResponders: boolean;
  /*
   * The teams and owner rules an owner no Created email reaches is about
   * (#9371): none when not said.
   */
  teamIds?: ReadonlySet<string> | undefined;
  incidentOwnerRuleIds?: ReadonlySet<string> | undefined;
  alertOwnerRuleIds?: ReadonlySet<string> | undefined;
}

function isRecordReadable(
  record: SetupHealthRecord,
  readable: SetupHealthReadable,
): boolean {
  switch (record.kind) {
    case SetupHealthRecordKind.Monitor:
      return readable.monitorIds.has(record.id);
    case SetupHealthRecordKind.OnCallDutyPolicy:
      return readable.policyIds.has(record.id);
    case SetupHealthRecordKind.OnCallDutyPolicySchedule:
      return readable.scheduleIds.has(record.id);
    case SetupHealthRecordKind.StatusPage:
      return readable.statusPageIds.has(record.id);
    case SetupHealthRecordKind.TelemetryIngestionKey:
      return readable.ingestionKeyIds.has(record.id);
    case SetupHealthRecordKind.User:
      return readable.canReadResponders;
    case SetupHealthRecordKind.StatusPageDomain:
      // Read through its status page (isFindingReadable).
      return false;
    case SetupHealthRecordKind.Project:
      return true;
    case SetupHealthRecordKind.Team:
      return Boolean(readable.teamIds?.has(record.id));
    case SetupHealthRecordKind.IncidentOwnerRule:
      return Boolean(readable.incidentOwnerRuleIds?.has(record.id));
    case SetupHealthRecordKind.AlertOwnerRule:
      return Boolean(readable.alertOwnerRuleIds?.has(record.id));
  }
}

export function isSetupHealthFindingReadable(
  finding: SetupHealthFinding,
  readable: SetupHealthReadable,
): boolean {
  if (finding.record.kind === SetupHealthRecordKind.StatusPageDomain) {
    return finding.related.some((record: SetupHealthRecord): boolean => {
      return (
        record.kind === SetupHealthRecordKind.StatusPage &&
        readable.statusPageIds.has(record.id)
      );
    });
  }

  return isRecordReadable(finding.record, readable);
}

export function redactSetupHealthFindings(
  findings: ReadonlyArray<SetupHealthFinding>,
  readable: SetupHealthReadable,
): Array<SetupHealthFinding> {
  return findings
    .filter((finding: SetupHealthFinding): boolean => {
      return isSetupHealthFindingReadable(finding, readable);
    })
    .map((finding: SetupHealthFinding): SetupHealthFinding => {
      return {
        ...finding,
        related: finding.related.filter(
          (record: SetupHealthRecord): boolean => {
            return isRecordReadable(record, readable);
          },
        ),
      };
    });
}

/*
 * A RECORD'S OWN FINDINGS (#7297): what its page says at the top, beside
 * what the page itself shows. The findings about the record, and for a
 * status page those about its custom domains as well - a domain has no
 * overview of its own, and opens the status page.
 */
export const SETUP_HEALTH_RECORD_KINDS_WITH_A_PAGE: ReadonlyArray<SetupHealthRecordKind> =
  [
    SetupHealthRecordKind.Monitor,
    SetupHealthRecordKind.OnCallDutyPolicy,
    SetupHealthRecordKind.OnCallDutyPolicySchedule,
    SetupHealthRecordKind.StatusPage,
    SetupHealthRecordKind.TelemetryIngestionKey,
  ];

export function isSetupHealthRecordKindWithAPage(
  kind: string,
): kind is SetupHealthRecordKind {
  return SETUP_HEALTH_RECORD_KINDS_WITH_A_PAGE.includes(
    kind as SetupHealthRecordKind,
  );
}

export function doesSetupHealthFindingConcernRecord(
  finding: SetupHealthFinding,
  record: Pick<SetupHealthRecord, "kind" | "id">,
): boolean {
  if (finding.record.kind === record.kind && finding.record.id === record.id) {
    return true;
  }

  return (
    record.kind === SetupHealthRecordKind.StatusPage &&
    finding.record.kind === SetupHealthRecordKind.StatusPageDomain &&
    finding.related.some((related: SetupHealthRecord): boolean => {
      return (
        related.kind === SetupHealthRecordKind.StatusPage &&
        related.id === record.id
      );
    })
  );
}

export function getSetupHealthFindingsForRecord(
  findings: ReadonlyArray<SetupHealthFinding>,
  record: Pick<SetupHealthRecord, "kind" | "id">,
): Array<SetupHealthFinding> {
  return findings.filter((finding: SetupHealthFinding): boolean => {
    return doesSetupHealthFindingConcernRecord(finding, record);
  });
}

/*
 * What one record's page is handed (GET /api/setup-health/record): its open
 * findings the person may see, worst first - never a dismissed one.
 */
export interface SetupHealthRecordAnswer {
  findings: Array<SetupHealthFinding>;
  checkedAt: string;
}

/*
 * The ids of every record of a kind the findings name, for the reads that
 * say which the caller may see.
 */
export function getSetupHealthRecordIds(
  findings: ReadonlyArray<SetupHealthFinding>,
  kind: SetupHealthRecordKind,
): Array<string> {
  const ids: Set<string> = new Set<string>();

  for (const finding of findings) {
    for (const record of [finding.record, ...finding.related]) {
      if (record.kind === kind && record.id) {
        ids.add(record.id);
      }
    }
  }

  return Array.from(ids);
}
