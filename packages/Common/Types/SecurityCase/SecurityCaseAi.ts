import { SecurityBlockDuration } from "../SecurityBlocklist/SecurityBlock";
import SecurityCaseVerdict from "./SecurityCaseVerdict";
import SecurityCaseAiVerdict from "./SecurityCaseAiVerdict";

/*
 * WHAT ONEUPTIME AI MAY DO ON A SECURITY CASE (#10352): the one reading,
 * for the responder, the project's settings, the API, the Dashboard and
 * the docs tests alike.
 *
 * OneUptime AI triages a case (SecurityCaseTriageRunner), and, where the
 * project lets it, works it to the end: it takes the case, blocks the
 * address, checks the block holds, asks for the code fix and closes the
 * case with a report. What it may do is set per kind of action
 * (SecurityCaseAiArea), each Off, Ask or On its own (SecurityCaseAiMode),
 * under Security Events -> AI -> Settings:
 *
 *   - Case: take the case, set its priority, mark steps done with the
 *     evidence that shows it, and move it to Contained once every step
 *     that contains it is verified. On its own by default.
 *   - Edge: block an address at the edge for at most 24 hours. Asks by
 *     default; On its own only once a Security Admin confirms it, or once
 *     the Scanners policy of #10350 has finished its trial
 *     (getEdgeOnItsOwnClearance).
 *   - Accounts: suspend a user, end their sessions. Asks by default.
 *   - Hosts: contain or isolate a host. Asks by default.
 *   - Code: ask Fix With AI for a pull request that fixes the route. A
 *     person always merges it. On its own by default.
 *   - Close: close the case with a verdict and a closing report. Asks by
 *     default.
 *
 * Off means OneUptime AI leaves that kind of step to a person and says so
 * on the case; Ask means it asks a person, with the evidence, wherever
 * they are (an approval, in Slack or Microsoft Teams too); On its own means
 * it does it, and says so on the timeline, where it can be undone.
 *
 * The whole section has one switch of its own
 * (Project.enableAutomaticSecurityCaseResponse): a project created from
 * now on starts with it on and the defaults above; one that existed before
 * keeps it off until an owner turns it on, so an upgrade never lets
 * OneUptime AI change anything unasked.
 *
 * Every write OneUptime AI makes goes through the playbook engine, as a
 * person's does (Server/Utils/AI/Security/Response): the case's timeline,
 * the audit log, protected entities and approvals apply, and the actor is
 * OneUptime AI. Anything it cannot be sure of becomes a question with its
 * evidence, never an action.
 *
 * Pure, so the server and the Dashboard import it alike. The mode strings
 * are stored on the project and sent by the API: a wire contract, never
 * renamed.
 */

export enum SecurityCaseAiArea {
  Case = "Case",
  Edge = "Edge",
  Accounts = "Accounts",
  Hosts = "Hosts",
  Code = "Code",
  Close = "Close",
}

// In the order a response goes in, and the settings page lists them.
export const SECURITY_CASE_AI_AREAS: ReadonlyArray<SecurityCaseAiArea> = [
  SecurityCaseAiArea.Case,
  SecurityCaseAiArea.Edge,
  SecurityCaseAiArea.Accounts,
  SecurityCaseAiArea.Hosts,
  SecurityCaseAiArea.Code,
  SecurityCaseAiArea.Close,
];

export enum SecurityCaseAiMode {
  // Left to a person, and OneUptime AI says so on the case.
  Off = "Off",
  // Asked of a person, with the evidence, wherever they are.
  Ask = "Ask",
  // Done, on the timeline as OneUptime AI's, where it can be undone.
  OnItsOwn = "OnItsOwn",
}

export const SECURITY_CASE_AI_MODES: ReadonlyArray<SecurityCaseAiMode> = [
  SecurityCaseAiMode.Off,
  SecurityCaseAiMode.Ask,
  SecurityCaseAiMode.OnItsOwn,
];

// What a project starts with, and what an existing one gets once it turns the section on.
export const SECURITY_CASE_AI_DEFAULT_MODES: Readonly<
  Record<SecurityCaseAiArea, SecurityCaseAiMode>
> = {
  [SecurityCaseAiArea.Case]: SecurityCaseAiMode.OnItsOwn,
  [SecurityCaseAiArea.Edge]: SecurityCaseAiMode.Ask,
  [SecurityCaseAiArea.Accounts]: SecurityCaseAiMode.Ask,
  [SecurityCaseAiArea.Hosts]: SecurityCaseAiMode.Ask,
  [SecurityCaseAiArea.Code]: SecurityCaseAiMode.OnItsOwn,
  [SecurityCaseAiArea.Close]: SecurityCaseAiMode.Ask,
};

// The project's switch for the whole section.
export type SecurityCaseAiSwitchColumn = "enableAutomaticSecurityCaseResponse";

export const SECURITY_CASE_AI_SWITCH_COLUMN: SecurityCaseAiSwitchColumn =
  "enableAutomaticSecurityCaseResponse";

export type SecurityCaseAiModeColumn =
  | "securityCaseAiCaseMode"
  | "securityCaseAiEdgeMode"
  | "securityCaseAiAccountsMode"
  | "securityCaseAiHostsMode"
  | "securityCaseAiCodeMode"
  | "securityCaseAiCloseMode";

// The Project column each kind of action is set in.
export const SECURITY_CASE_AI_MODE_COLUMNS: Readonly<
  Record<SecurityCaseAiArea, SecurityCaseAiModeColumn>
> = {
  [SecurityCaseAiArea.Case]: "securityCaseAiCaseMode",
  [SecurityCaseAiArea.Edge]: "securityCaseAiEdgeMode",
  [SecurityCaseAiArea.Accounts]: "securityCaseAiAccountsMode",
  [SecurityCaseAiArea.Hosts]: "securityCaseAiHostsMode",
  [SecurityCaseAiArea.Code]: "securityCaseAiCodeMode",
  [SecurityCaseAiArea.Close]: "securityCaseAiCloseMode",
};

/*
 * Who let a containment kind run on its own, and when: the column only the
 * server writes (Project.securityCaseAiOnItsOwnStamps), as a playbook step
 * saved with Needs Approval off is stamped (SecurityPlaybookStep's
 * approvalTurnedOff). Each of OneUptime AI's containment steps that runs
 * without asking carries its kind's stamp.
 */
export type SecurityCaseAiStampsColumn = "securityCaseAiOnItsOwnStamps";

export const SECURITY_CASE_AI_STAMPS_COLUMN: SecurityCaseAiStampsColumn =
  "securityCaseAiOnItsOwnStamps";

/*
 * The kinds that cut somebody off. Each takes a Security Admin (or a
 * Project Owner or Admin, who hold everything a Security Admin does) to be
 * set to On its own, as a playbook's containment step takes one to run
 * without approval (TURN_OFF_CONTAINMENT_APPROVAL_PERMISSIONS).
 */
export const SECURITY_CASE_AI_CONTAINMENT_AREAS: ReadonlyArray<SecurityCaseAiArea> =
  [
    SecurityCaseAiArea.Edge,
    SecurityCaseAiArea.Accounts,
    SecurityCaseAiArea.Hosts,
  ];

// Why a person without a Security Admin's authority may not set one of them to On its own.
export const SECURITY_CASE_AI_ON_ITS_OWN_REFUSED_MESSAGE: string =
  "Letting OneUptime AI block addresses, suspend users or isolate hosts without asking takes a Security Admin, a Project Admin or a Project Owner.";

export interface SecurityCaseAiOnItsOwnStamp {
  byUserId?: string | undefined;
  // ISO 8601.
  at: string;
}

export type SecurityCaseAiOnItsOwnStamps = Partial<
  Record<SecurityCaseAiArea, SecurityCaseAiOnItsOwnStamp>
>;

/*
 * What the responder works within: the switch, each kind's mode, and who
 * let each containment kind run on its own.
 */
export interface SecurityCaseAiLimits {
  isOn: boolean;
  modes: Record<SecurityCaseAiArea, SecurityCaseAiMode>;
  stamps: SecurityCaseAiOnItsOwnStamps;
}

// What the responder never goes past, whatever the settings say.

// Actions On its own a project's cases may take in one hour, all cases together.
export const SECURITY_CASE_AI_ACTIONS_ON_ITS_OWN_PER_HOUR: number = 10;

// How long the case's detection stays quiet before OneUptime AI closes it.
export const SECURITY_CASE_AI_QUIET_WINDOW_HOURS: number = 24;

// The longest block OneUptime AI makes: it ends by itself, or is renewed by a person.
export const SECURITY_CASE_AI_BLOCK_DURATION: SecurityBlockDuration =
  SecurityBlockDuration.OneDay;

export function isSecurityCaseAiArea(
  value: unknown,
): value is SecurityCaseAiArea {
  return (
    typeof value === "string" &&
    (SECURITY_CASE_AI_AREAS as ReadonlyArray<string>).includes(value)
  );
}

export function isSecurityCaseAiMode(
  value: unknown,
): value is SecurityCaseAiMode {
  return (
    typeof value === "string" &&
    (SECURITY_CASE_AI_MODES as ReadonlyArray<string>).includes(value)
  );
}

// A mode as stored: one it cannot read is Off - a doubt falls toward a person.
export function readSecurityCaseAiMode(value: unknown): SecurityCaseAiMode {
  return isSecurityCaseAiMode(value) ? value : SecurityCaseAiMode.Off;
}

export function readSecurityCaseAiOnItsOwnStamps(
  value: unknown,
): SecurityCaseAiOnItsOwnStamps {
  const stamps: SecurityCaseAiOnItsOwnStamps = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return stamps;
  }

  for (const [area, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isSecurityCaseAiArea(area)) {
      continue;
    }

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      continue;
    }

    const stamp: Record<string, unknown> = raw as Record<string, unknown>;
    const at: unknown = stamp["at"];

    if (typeof at !== "string" || Number.isNaN(Date.parse(at))) {
      continue;
    }

    stamps[area] = {
      ...(typeof stamp["byUserId"] === "string" && stamp["byUserId"]
        ? { byUserId: stamp["byUserId"] as string }
        : {}),
      at,
    };
  }

  return stamps;
}

// The project's columns the limits are read from.
export type SecurityCaseAiLimitsSource = Partial<
  Record<SecurityCaseAiModeColumn, unknown>
> & {
  enableAutomaticSecurityCaseResponse?: boolean | null | undefined;
  securityCaseAiOnItsOwnStamps?: unknown;
};

export function readSecurityCaseAiLimits(
  project: SecurityCaseAiLimitsSource | null | undefined,
): SecurityCaseAiLimits {
  const modes: Record<SecurityCaseAiArea, SecurityCaseAiMode> = {} as Record<
    SecurityCaseAiArea,
    SecurityCaseAiMode
  >;

  for (const area of SECURITY_CASE_AI_AREAS) {
    modes[area] = readSecurityCaseAiMode(
      project?.[SECURITY_CASE_AI_MODE_COLUMNS[area]],
    );
  }

  return {
    // NOT NULL DEFAULT false: only an explicit true is on.
    isOn: project?.enableAutomaticSecurityCaseResponse === true,
    modes,
    stamps: readSecurityCaseAiOnItsOwnStamps(
      project?.securityCaseAiOnItsOwnStamps,
    ),
  };
}

/*
 * WHETHER EDGE MAY RUN ON ITS OWN.
 *
 * Blocking at the edge on its own cuts an address off with nobody looking,
 * so the Edge row's On its own counts only once someone has vouched for
 * it: a Security Admin confirmed it (the Edge stamp), or the Scanners
 * policy of #10350 finished a whole trial run - a week of blocks
 * proposed and proven on the project's own traffic first. Until then, Edge
 * set to On its own asks, and the row says why.
 *
 * The server reads the trial in one place
 * (Server/Utils/AI/Security/Response/SecurityCaseAiEdgeTrial) and hands it
 * here as hasScannersPolicyFinishedTrial.
 */
export enum SecurityCaseAiEdgeClearance {
  ConfirmedBySecurityAdmin = "ConfirmedBySecurityAdmin",
  ScannersPolicyTrial = "ScannersPolicyTrial",
  NotCleared = "NotCleared",
}

export function getEdgeOnItsOwnClearance(data: {
  stamps: SecurityCaseAiOnItsOwnStamps;
  // The Scanners policy of #10350 finished a whole trial run.
  hasScannersPolicyFinishedTrial?: boolean | undefined;
}): SecurityCaseAiEdgeClearance {
  if (data.stamps[SecurityCaseAiArea.Edge]) {
    return SecurityCaseAiEdgeClearance.ConfirmedBySecurityAdmin;
  }

  if (data.hasScannersPolicyFinishedTrial === true) {
    return SecurityCaseAiEdgeClearance.ScannersPolicyTrial;
  }

  return SecurityCaseAiEdgeClearance.NotCleared;
}

// ---------- What OneUptime AI does on a case ----------

/*
 * The things OneUptime AI does on a case, each one of its tools
 * (Server/Utils/AI/Security/Response/SecurityCaseResponseToolkit), and each
 * one kind of action the project sets.
 */
export enum SecurityCaseAiActionKind {
  // The case is OneUptime AI's to work: it is on its queue.
  TakeCase = "TakeCase",
  // The priority OneUptime AI's triage suggested.
  SetPriority = "SetPriority",
  // A judgement step, with the evidence that settles it.
  MarkStepDone = "MarkStepDone",
  // Every step that contains the threat is verified.
  MarkContained = "MarkContained",
  // An address, at the edge, for at most a day (#10342).
  BlockAddress = "BlockAddress",
  // A user suspended, or signed out, through the identity provider.
  ContainAccount = "ContainAccount",
  // A host contained or isolated, through the EDR.
  ContainHost = "ContainHost",
  // Customers or production are affected: it pages people, so it always asks.
  DeclareIncident = "DeclareIncident",
  // Fix With AI's pull request for the route (#10347). Never merged by OneUptime.
  RequestCodeFix = "RequestCodeFix",
  // Closed with a verdict and the closing report.
  CloseCase = "CloseCase",
  // A false positive or benign case: its blocks lifted.
  LiftBlock = "LiftBlock",
  // A false positive or benign case: an exception offered to the rule's owner.
  OfferRuleException = "OfferRuleException",
  // A step OneUptime AI has no way to do: a person's.
  StepForPeople = "StepForPeople",
  // OneUptime AI stopped working the case, and said why.
  HandToPeople = "HandToPeople",
}

export const SECURITY_CASE_AI_ACTION_KINDS: ReadonlyArray<SecurityCaseAiActionKind> =
  Object.values(SecurityCaseAiActionKind);

// The kind of action each is set under; none for a step no setting covers.
export const SECURITY_CASE_AI_ACTION_AREAS: Readonly<
  Record<SecurityCaseAiActionKind, SecurityCaseAiArea | null>
> = {
  [SecurityCaseAiActionKind.TakeCase]: SecurityCaseAiArea.Case,
  [SecurityCaseAiActionKind.SetPriority]: SecurityCaseAiArea.Case,
  [SecurityCaseAiActionKind.MarkStepDone]: SecurityCaseAiArea.Case,
  [SecurityCaseAiActionKind.MarkContained]: SecurityCaseAiArea.Case,
  [SecurityCaseAiActionKind.DeclareIncident]: SecurityCaseAiArea.Case,
  [SecurityCaseAiActionKind.BlockAddress]: SecurityCaseAiArea.Edge,
  [SecurityCaseAiActionKind.ContainAccount]: SecurityCaseAiArea.Accounts,
  [SecurityCaseAiActionKind.ContainHost]: SecurityCaseAiArea.Hosts,
  [SecurityCaseAiActionKind.RequestCodeFix]: SecurityCaseAiArea.Code,
  [SecurityCaseAiActionKind.CloseCase]: SecurityCaseAiArea.Close,
  // Part of closing a false positive: they go as the close goes.
  [SecurityCaseAiActionKind.LiftBlock]: SecurityCaseAiArea.Close,
  [SecurityCaseAiActionKind.OfferRuleException]: SecurityCaseAiArea.Close,
  [SecurityCaseAiActionKind.StepForPeople]: null,
  [SecurityCaseAiActionKind.HandToPeople]: null,
};

/*
 * The actions that ask whatever the setting says. Declaring an incident
 * pages people and can post to status pages; an exception changes what a
 * rule sees, and is its owner's to accept. On its own still asks for these.
 */
export const SECURITY_CASE_AI_ALWAYS_ASKS: ReadonlyArray<SecurityCaseAiActionKind> =
  [
    SecurityCaseAiActionKind.DeclareIncident,
    SecurityCaseAiActionKind.OfferRuleException,
  ];

// What became of one thing OneUptime AI did, asked or left.
export enum SecurityCaseAiActionStatus {
  // Started through the engine; how it went is on its way.
  Doing = "Doing",
  Done = "Done",
  // Waiting for a person to approve it.
  Asked = "Asked",
  // A person turned it down.
  Declined = "Declined",
  // OneUptime AI would not do it, and says why.
  Left = "Left",
  Failed = "Failed",
  // A person took it back.
  Undone = "Undone",
}

export const SECURITY_CASE_AI_ACTION_STATUSES: ReadonlyArray<SecurityCaseAiActionStatus> =
  Object.values(SecurityCaseAiActionStatus);

/*
 * The step OneUptime AI's change of the case's priority is kept under: the
 * Response Plan has no step that sets it.
 */
export const SECURITY_CASE_AI_PRIORITY_STEP_KEY: string = "case:priority";

// The step a hand-off is kept under: it is about the whole case.
export const SECURITY_CASE_AI_HAND_OFF_STEP_KEY: string = "case:hand-off";

// The statuses of an action still under way: one per step at a time.
export const SECURITY_CASE_AI_OPEN_ACTION_STATUSES: ReadonlyArray<SecurityCaseAiActionStatus> =
  [SecurityCaseAiActionStatus.Doing, SecurityCaseAiActionStatus.Asked];

/*
 * Why an action is as it is, as a code the case's AI card words in the
 * reader's language and the timeline in English
 * (Utils/SecurityCase/SecurityCaseAiWords).
 */
export enum SecurityCaseAiActionReason {
  // Done: the setting lets it.
  OnItsOwn = "OnItsOwn",
  // Done: a person approved it.
  Approved = "Approved",
  // Asked: the setting asks first.
  SettingAsks = "SettingAsks",
  // Asked: this kind always asks (SECURITY_CASE_AI_ALWAYS_ASKS).
  AlwaysAsks = "AlwaysAsks",
  // Asked: Edge is On its own, but nobody has confirmed it yet.
  EdgeNotCleared = "EdgeNotCleared",
  // Left: the setting is Off.
  SettingOff = "SettingOff",
  // Left: OneUptime has no way to do this step; a person does it.
  NoWayToDoIt = "NoWayToDoIt",
  // Left: the step takes a person's judgement the evidence cannot settle.
  NeedsJudgement = "NeedsJudgement",
  // Left: the fix only looks done (no attack since, or too few): a person confirms it.
  FixLooksDone = "FixLooksDone",
  // Left: OneUptime cannot check this fix yet (#10603).
  FixNotChecked = "FixNotChecked",
  // Left: what it acts on is protected.
  ProtectedTarget = "ProtectedTarget",
  // Left: a block already holds the address.
  AlreadyBlocked = "AlreadyBlocked",
  // Left: nothing enforces the project's blocklist - no Cloudflare, AWS WAF or firewall feed.
  NoBlockDestination = "NoBlockDestination",
  // Left: none of the case's requests threw an exception to fix in code.
  NothingToFixInCode = "NothingToFixInCode",
  // Failed: the engine could not do it.
  EngineFailed = "EngineFailed",
  // Undone: a person took it back.
  UndoneByPerson = "UndoneByPerson",
  // Declined: a person turned it down.
  DeclinedByPerson = "DeclinedByPerson",
  // A hand-off: why, in its own reason (SecurityCaseHandOffReason).
  HandedOff = "HandedOff",
}

export const SECURITY_CASE_AI_ACTION_REASONS: ReadonlyArray<SecurityCaseAiActionReason> =
  Object.values(SecurityCaseAiActionReason);

/*
 * WHEN ONEUPTIME AI HANDS A CASE TO PEOPLE AT ONCE. It never stands down
 * quietly: every one of these pages the people the case's notification
 * rules name and says why (Server/Utils/SecurityCase/SecurityCaseHandOff).
 */
export enum SecurityCaseHandOffReason {
  // The case's data held text written to steer an AI.
  SteeringText = "SteeringText",
  // The case is at the project's highest priority.
  HighestPriority = "HighestPriority",
  // A target of its step is protected.
  ProtectedTarget = "ProtectedTarget",
  // Too many actions on its own this hour, across the project's cases.
  BreakerTripped = "BreakerTripped",
  // AI was turned off for the project, or for cases.
  AiOff = "AiOff",
  // No LLM provider OneUptime AI can use.
  NoLlmProvider = "NoLlmProvider",
  // The project is out of AI credits, or reached a daily AI limit.
  OutOfCredits = "OutOfCredits",
  // The triage read the case as Inconclusive, or something else than malicious.
  NotLikelyMalicious = "NotLikelyMalicious",
  // A step it did does not hold, and it will not repeat it blindly.
  DidNotHold = "DidNotHold",
  // A step it started failed.
  StepFailed = "StepFailed",
  // A person turned down what it asked.
  Declined = "Declined",
  // Everything left is a person's to do.
  OnlyPeopleCanDo = "OnlyPeopleCanDo",
  // The run could not tell: it failed, or read something it cannot settle.
  CannotTell = "CannotTell",
  // A person took the case over from OneUptime AI (Take Over, on its AI card).
  TakenOver = "TakenOver",
}

/*
 * The hand-offs nobody has to be told of: the person who took the case over
 * knows it is theirs.
 */
export const SECURITY_CASE_HAND_OFFS_TOLD_NOBODY: ReadonlyArray<SecurityCaseHandOffReason> =
  [SecurityCaseHandOffReason.TakenOver];

export const SECURITY_CASE_HAND_OFF_REASONS: ReadonlyArray<SecurityCaseHandOffReason> =
  Object.values(SecurityCaseHandOffReason);

export function isSecurityCaseHandOffReason(
  value: unknown,
): value is SecurityCaseHandOffReason {
  return (
    typeof value === "string" &&
    (SECURITY_CASE_HAND_OFF_REASONS as ReadonlyArray<string>).includes(value)
  );
}

// Where OneUptime AI stands on a case (SecurityCase.aiResponseState).
export enum SecurityCaseAiResponseState {
  // It is working the case: the case is on its queue.
  Working = "Working",
  // It asked a person, and waits for them.
  WaitingForPeople = "WaitingForPeople",
  // It handed the case to people, and said why.
  HandedToPeople = "HandedToPeople",
  // The case is closed.
  Finished = "Finished",
}

export const SECURITY_CASE_AI_RESPONSE_STATES: ReadonlyArray<SecurityCaseAiResponseState> =
  Object.values(SecurityCaseAiResponseState);

// The states in which OneUptime AI still works the case.
export const SECURITY_CASE_AI_ACTIVE_RESPONSE_STATES: ReadonlyArray<SecurityCaseAiResponseState> =
  [
    SecurityCaseAiResponseState.Working,
    SecurityCaseAiResponseState.WaitingForPeople,
  ];

export function isSecurityCaseAiResponseActive(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (SECURITY_CASE_AI_ACTIVE_RESPONSE_STATES as ReadonlyArray<string>).includes(
      value,
    )
  );
}

// ---------- Deciding one action ----------

export enum SecurityCaseAiDecisionKind {
  Do = "Do",
  Ask = "Ask",
  Leave = "Leave",
}

export interface SecurityCaseAiDecision {
  decision: SecurityCaseAiDecisionKind;
  reason: SecurityCaseAiActionReason;
  // The mode the decision was made under; none for an action no setting covers.
  mode: SecurityCaseAiMode | null;
}

/*
 * What the project's settings say of one action: do it, ask, or leave it
 * to a person - and why. Pure: the breaker, a protected target and the
 * hand-offs are the responder's, which reads them first.
 *
 *   - an action no setting covers (a step only a person can do) is left;
 *   - Off leaves it;
 *   - Ask asks;
 *   - On its own does it - except an action that always asks, and Edge
 *     until a Security Admin confirmed it or #10350's trial cleared it,
 *     which ask and say why.
 */
export function decideSecurityCaseAiAction(data: {
  kind: SecurityCaseAiActionKind;
  limits: SecurityCaseAiLimits;
  hasScannersPolicyFinishedTrial?: boolean | undefined;
}): SecurityCaseAiDecision {
  const area: SecurityCaseAiArea | null =
    SECURITY_CASE_AI_ACTION_AREAS[data.kind];

  if (!area) {
    return {
      decision: SecurityCaseAiDecisionKind.Leave,
      reason: SecurityCaseAiActionReason.NoWayToDoIt,
      mode: null,
    };
  }

  const mode: SecurityCaseAiMode = data.limits.modes[area];

  if (mode === SecurityCaseAiMode.Off) {
    return {
      decision: SecurityCaseAiDecisionKind.Leave,
      reason: SecurityCaseAiActionReason.SettingOff,
      mode,
    };
  }

  if (mode === SecurityCaseAiMode.Ask) {
    return {
      decision: SecurityCaseAiDecisionKind.Ask,
      reason: SecurityCaseAiActionReason.SettingAsks,
      mode,
    };
  }

  if (SECURITY_CASE_AI_ALWAYS_ASKS.includes(data.kind)) {
    return {
      decision: SecurityCaseAiDecisionKind.Ask,
      reason: SecurityCaseAiActionReason.AlwaysAsks,
      mode,
    };
  }

  if (
    area === SecurityCaseAiArea.Edge &&
    getEdgeOnItsOwnClearance({
      stamps: data.limits.stamps,
      hasScannersPolicyFinishedTrial: data.hasScannersPolicyFinishedTrial,
    }) === SecurityCaseAiEdgeClearance.NotCleared
  ) {
    return {
      decision: SecurityCaseAiDecisionKind.Ask,
      reason: SecurityCaseAiActionReason.EdgeNotCleared,
      mode,
    };
  }

  return {
    decision: SecurityCaseAiDecisionKind.Do,
    reason: SecurityCaseAiActionReason.OnItsOwn,
    mode,
  };
}

/*
 * The verdict a case closes with after OneUptime AI's read of it: the
 * read's suggested verdict, and none for Inconclusive - a person decides.
 */
export function getSecurityCaseAiClosingVerdict(
  aiVerdict: SecurityCaseAiVerdict | string | null | undefined,
): SecurityCaseVerdict | null {
  switch (aiVerdict) {
    case SecurityCaseAiVerdict.LikelyMalicious:
      return SecurityCaseVerdict.TruePositive;
    case SecurityCaseAiVerdict.LikelyBenign:
      return SecurityCaseVerdict.BenignPositive;
    case SecurityCaseAiVerdict.LikelyFalsePositive:
      return SecurityCaseVerdict.FalsePositive;
    default:
      return null;
  }
}

// A verdict that lifts the case's blocks and offers its rule an exception.
export function isDismissingVerdict(
  verdict: SecurityCaseVerdict | string | null | undefined,
): boolean {
  return (
    verdict === SecurityCaseVerdict.FalsePositive ||
    verdict === SecurityCaseVerdict.BenignPositive
  );
}

/*
 * Whether the hour's actions on their own leave room for one more: the
 * breaker trips at SECURITY_CASE_AI_ACTIONS_ON_ITS_OWN_PER_HOUR.
 */
export function isSecurityCaseAiBreakerTripped(
  actionsThisHour: number,
): boolean {
  return actionsThisHour >= SECURITY_CASE_AI_ACTIONS_ON_ITS_OWN_PER_HOUR;
}
