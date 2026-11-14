import { fillTemplate, translationKey } from "../Translator";
import {
  WhoIsToldBreak,
  WhoIsToldBreakKind,
  WhoIsToldChannels,
  WhoIsToldCriteria,
  WhoIsToldEvent,
  WhoIsToldPerson,
  WhoIsToldPersonProblem,
  WhoIsToldPolicy,
  WhoIsToldResult,
  WhoIsToldServerChannel,
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
 * (Types/Monitor/WhoIsTold, #6810), resolved for the whole project at once
 * (WhoIsToldService.resolveProject): the card on a monitor and this list
 * share one set of rules and never disagree.
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
  // The project's other records.
  PolicyNotRun = "policy_not_run",
  ScheduleHasNobodyOnCall = "schedule_has_nobody_on_call",
  LowBalance = "low_balance",
  MonitorNotChecked = "monitor_not_checked",
  MonitorOffForLong = "monitor_off_for_long",
  StatusPageShowsNoMonitor = "status_page_shows_no_monitor",
  StatusPageDomainNotVerified = "status_page_domain_not_verified",
  OneOwner = "one_owner",
  WorkspaceNotUsed = "workspace_not_used",
  TelemetryNotWatched = "telemetry_not_watched",
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
  SetupHealthCheck.MonitorPagesNobody,
  SetupHealthCheck.MonitorTellsNobody,
  SetupHealthCheck.PolicyNotRun,
  SetupHealthCheck.ScheduleHasNobodyOnCall,
  SetupHealthCheck.LowBalance,
  SetupHealthCheck.MonitorNotChecked,
  SetupHealthCheck.StatusPageShowsNoMonitor,
  SetupHealthCheck.StatusPageDomainNotVerified,
  SetupHealthCheck.MonitorOffForLong,
  SetupHealthCheck.TelemetryNotWatched,
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
  Project = "Project",
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
  channelOff: string;
  noBalance: string;
  serverCannotSend: Readonly<Record<WhoIsToldServerChannel, string>>;
  policyNotRun: string;
  scheduleHasNobodyOnCall: Readonly<Record<SetupHealthScheduleReason, string>>;
  lowBalance: string;
  monitorNotChecked: Readonly<Record<SetupHealthMonitorReason, string>>;
  monitorOffForLong: string;
  statusPageShowsNoMonitor: string;
  statusPageDomainNotVerified: string;
  oneOwner: string;
  workspaceNotUsed: string;
  telemetryNotWatched: string;
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
  oneOwner: translationKey(
    "This project has only one owner. Make a second person an owner, so somebody can always manage it.",
  ),
  workspaceNotUsed: translationKey(
    "{{workspace}} is connected, but no notification rule posts to it.",
  ),
  telemetryNotWatched: translationKey(
    "Telemetry arrives in this project, but no monitor alerts on it.",
  ),
};

/*
 * A domain added less than this long ago is not yet said to be unverified:
 * DNS takes a while to answer for a new record.
 */
export const DOMAIN_VERIFICATION_GRACE_IN_MS: number = 60 * 60 * 1000;

// A monitor turned off for longer than this is said to be off for long.
export const MONITOR_OFF_FOR_LONG_IN_DAYS: number = 30;

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
}

export interface SetupHealthResponderFact {
  userId: string;
  name: string;
  // Nothing reaches them (Readiness's NotReachable).
  isNotReachable: boolean;
  // Why, when Readiness says: not a member, invitation not accepted.
  reason: SetupHealthResponderReason;
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
       * just what they want: a suggestion, not a problem.
       */
      return makeSetupHealthFinding({
        check: SetupHealthCheck.MonitorPagesNobody,
        level:
          data.facts.policies.length > 0
            ? SetupHealthLevel.WorthFixing
            : SetupHealthLevel.Suggestion,
        record: data.monitor,
        subject: kind,
        fix:
          kind === SetupHealthEventKind.Alert
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
  getServerFindings,
  getPolicyNotRunFindings,
  getScheduleFindings,
  getLowBalanceFindings,
  getMonitorNotCheckedFindings,
  getMonitorOffForLongFindings,
  getStatusPageFindings,
  getStatusPageDomainFindings,
  getOwnerFindings,
  getWorkspaceFindings,
  getTelemetryFindings,
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
 * may be read: a monitor, policy, schedule or status page by its id; a
 * domain by its status page; a person through the on-call policies (as
 * Readiness is); the project's own findings to every member. What it
 * concerns is cut to what may be read too.
 */
export interface SetupHealthReadable {
  monitorIds: ReadonlySet<string>;
  policyIds: ReadonlySet<string>;
  scheduleIds: ReadonlySet<string>;
  statusPageIds: ReadonlySet<string>;
  // The caller may read the project's on-call policies (and so Readiness).
  canReadResponders: boolean;
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
    case SetupHealthRecordKind.User:
      return readable.canReadResponders;
    case SetupHealthRecordKind.StatusPageDomain:
      // Read through its status page (isFindingReadable).
      return false;
    case SetupHealthRecordKind.Project:
      return true;
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
