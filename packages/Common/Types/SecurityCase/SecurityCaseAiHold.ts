import AIRunStatus from "../AI/AIRunStatus";
import {
  AI_HOLD_OUTAGE_RECORD_COUNT,
  AI_HOLD_OUTAGE_WINDOW_IN_MINUTES,
  AI_HOLD_RECURRENCE_WINDOW_IN_HOURS,
} from "../OnCallDutyPolicy/OnCallPolicyAiHold";
import SecurityPlaybookTrigger from "../SecurityPlaybook/SecurityPlaybookTrigger";
import { translationKey } from "../Translator";
import {
  SecurityCaseAiResponseState,
  isSecurityCaseAiResponseActive,
} from "./SecurityCaseAi";
import SecurityCaseAiVerdict from "./SecurityCaseAiVerdict";
import SecurityCaseStage from "./SecurityCaseStage";
import { SecurityEntity, SecurityEntityType } from "./SecurityEntity";

/*
 * ONEUPTIME AI RESPONDS FIRST TO A SECURITY CASE (#10353), and people are
 * alerted only when it needs them.
 *
 * With the project's "Let OneUptime AI respond first" on (Security Events
 * -> AI -> Settings; Project.enableSecurityCaseAiRespondsFirst), a case a
 * detection opens below the priority the project picks (High by default)
 * is held for at most the time it picks (10 minutes by default): the
 * notice people get when a case opens at their priority, and every Page
 * On-Call step its playbooks reach on their own, wait while OneUptime AI
 * triages the case and works it (#10352). The case's page says "OneUptime
 * AI is on it", with Page now.
 *
 * The hold ends one of three ways, and SecurityCase.aiHoldOutcome keeps
 * which:
 *
 *   - Resolved: the case was contained - every step that contains it
 *     verified by OneUptime's checks (#10340) - or closed, with no person.
 *     Nobody is alerted: the case's Slack and Microsoft Teams rules get one
 *     summary instead, and the page steps that waited are skipped.
 *   - Handed to people: OneUptime AI asked a person to approve a step,
 *     handed the case over (#10352's SecurityCaseHandOff), could not start
 *     on it, read it as not malicious, or ran out of time - or OneUptime's
 *     own rules end every hold (an active attack, the setting turned off).
 *     What was held goes out at once, saying why and what OneUptime AI
 *     already did.
 *   - Stopped: someone pressed Page now (it goes out), the case rose to the
 *     priority people are alerted for at once (it goes out), or a person
 *     took the case - assigned it, moved it on, took it over from OneUptime
 *     AI - and has it: nobody else is alerted.
 *
 * Never held (decideSecurityCaseAiHold): the project's highest priority,
 * several cases opening within minutes - what looks like an active attack,
 * which also ends every hold - a case whose data holds text written to
 * steer an AI, and a case about the same address, user or host as one
 * OneUptime AI resolved in the last 24 hours: its fix did not hold. Nor a
 * case a person opened, the setup test's case, or one OneUptime AI could
 * not work. Response target notices are never held: they are about a
 * deadline.
 *
 * Pure, so the server, the Dashboard and the tests read the same rules.
 * The outcome strings are stored on the case: never rename one.
 */

export enum SecurityCaseAiHoldOutcome {
  // Held: OneUptime AI is on it, and nobody has been alerted yet.
  Holding = "Holding",

  // Contained, every step checked, or closed - with no person: nobody alerted.
  Resolved = "Resolved",

  // Handed to people: what was held goes out, saying why.
  NeedsApproval = "NeedsApproval",
  HandedOff = "HandedOff",
  TimeRanOut = "TimeRanOut",
  NotStarted = "NotStarted",
  NotMalicious = "NotMalicious",
  NotVerified = "NotVerified",
  ActiveAttack = "ActiveAttack",
  TurnedOff = "TurnedOff",
  // Security Events is switched off on the server (#10816): its work stops.
  ProductOff = "ProductOff",

  // Stopped by a person, or by the case's own priority.
  PageNow = "PageNow",
  RoseInPriority = "RoseInPriority",
  TakenByPerson = "TakenByPerson",
}

export const SECURITY_CASE_AI_HOLD_OUTCOMES: ReadonlyArray<SecurityCaseAiHoldOutcome> =
  Object.values(SecurityCaseAiHoldOutcome);

export function isSecurityCaseAiHoldOutcome(
  value: unknown,
): value is SecurityCaseAiHoldOutcome {
  return (
    typeof value === "string" &&
    (SECURITY_CASE_AI_HOLD_OUTCOMES as ReadonlyArray<string>).includes(value)
  );
}

// The three ways a hold ends, as the issue, the card and the digest name them.
export enum SecurityCaseAiHoldEnd {
  Resolved = "Resolved",
  HandedToPeople = "HandedToPeople",
  Stopped = "Stopped",
}

const HANDED_TO_PEOPLE: ReadonlyArray<SecurityCaseAiHoldOutcome> = [
  SecurityCaseAiHoldOutcome.NeedsApproval,
  SecurityCaseAiHoldOutcome.HandedOff,
  SecurityCaseAiHoldOutcome.TimeRanOut,
  SecurityCaseAiHoldOutcome.NotStarted,
  SecurityCaseAiHoldOutcome.NotMalicious,
  SecurityCaseAiHoldOutcome.NotVerified,
  SecurityCaseAiHoldOutcome.ActiveAttack,
  SecurityCaseAiHoldOutcome.TurnedOff,
  SecurityCaseAiHoldOutcome.ProductOff,
];

const STOPPED: ReadonlyArray<SecurityCaseAiHoldOutcome> = [
  SecurityCaseAiHoldOutcome.PageNow,
  SecurityCaseAiHoldOutcome.RoseInPriority,
  SecurityCaseAiHoldOutcome.TakenByPerson,
];

// How a hold ended; null while it holds, and for a case never held.
export function getSecurityCaseAiHoldEnd(
  outcome: SecurityCaseAiHoldOutcome | string | null | undefined,
): SecurityCaseAiHoldEnd | null {
  if (outcome === SecurityCaseAiHoldOutcome.Resolved) {
    return SecurityCaseAiHoldEnd.Resolved;
  }

  if ((HANDED_TO_PEOPLE as ReadonlyArray<string>).includes(outcome || "")) {
    return SecurityCaseAiHoldEnd.HandedToPeople;
  }

  if ((STOPPED as ReadonlyArray<string>).includes(outcome || "")) {
    return SecurityCaseAiHoldEnd.Stopped;
  }

  return null;
}

/*
 * Whether the hold's end sends what it held: every end but Resolved, and a
 * person taking the case - who has it, so nobody else is alerted.
 */
export function isSecurityCaseAiHoldAlerting(
  outcome: SecurityCaseAiHoldOutcome | string | null | undefined,
): boolean {
  const end: SecurityCaseAiHoldEnd | null = getSecurityCaseAiHoldEnd(outcome);

  return (
    end === SecurityCaseAiHoldEnd.HandedToPeople ||
    (end === SecurityCaseAiHoldEnd.Stopped &&
      outcome !== SecurityCaseAiHoldOutcome.TakenByPerson)
  );
}

/*
 * The ends OneUptime AI or its own rules decided, rather than a person: a
 * channel rule that posts OneUptime AI's hand-offs (NotificationRuleUpdateKind
 * AI) posts these too.
 */
export function isSecurityCaseAiHoldHandedOff(
  outcome: SecurityCaseAiHoldOutcome | string | null | undefined,
): boolean {
  return (
    getSecurityCaseAiHoldEnd(outcome) === SecurityCaseAiHoldEnd.HandedToPeople
  );
}

// ---------- The setting ----------

/*
 * How long a case is held, and its bounds: a module of their own, which the
 * project's model reads without the rest of these rules (SecurityCaseAiHoldMinutes).
 */
export {
  SECURITY_CASE_AI_HOLD_MINUTES_CHOICES,
  SECURITY_CASE_AI_HOLD_MINUTES_DEFAULT,
  SECURITY_CASE_AI_HOLD_MINUTES_MAX,
  SECURITY_CASE_AI_HOLD_MINUTES_MIN,
  getSecurityCaseAiHoldMinutes,
} from "./SecurityCaseAiHoldMinutes";

/*
 * What looks like an active attack: this many other cases opened in the
 * project within the window. No case is held then, and every case held is
 * handed to people at once - people, not OneUptime AI, take an attack. The
 * incident side's outage guard, with its numbers (OnCallPolicyAiHold).
 */
export const SECURITY_CASE_AI_HOLD_ATTACK_CASE_COUNT: number =
  AI_HOLD_OUTAGE_RECORD_COUNT;
export const SECURITY_CASE_AI_HOLD_ATTACK_WINDOW_IN_MINUTES: number =
  AI_HOLD_OUTAGE_WINDOW_IN_MINUTES;

/*
 * A case about an address, user or host OneUptime AI resolved a case about
 * within this window is never held: what it did did not hold.
 */
export const SECURITY_CASE_AI_HOLD_RECURRENCE_WINDOW_IN_HOURS: number =
  AI_HOLD_RECURRENCE_WINDOW_IN_HOURS;

/*
 * The entities a fix of OneUptime AI's is about - the address it blocks,
 * the user and the host it contains - and so the ones a new case about the
 * same one shows did not hold. A domain, a URL or a file is no fix's.
 */
export const SECURITY_CASE_AI_HOLD_RECURRENCE_ENTITY_TYPES: ReadonlyArray<SecurityEntityType> =
  [
    SecurityEntityType.IpAddress,
    SecurityEntityType.User,
    SecurityEntityType.Host,
  ];

/*
 * How long a held case may go without OneUptime AI starting on it - its
 * triage queued at once, its work right after the triage reads it as Likely
 * Malicious - before it is taken not to come.
 */
export const SECURITY_CASE_AI_HOLD_START_GRACE_IN_MINUTES: number = 2;

// ---------- Whether a new case is held ----------

/*
 * Why a new case was not held. Most are nothing to say - the setting is
 * off, a person opened the case, it is above the priority the project
 * holds - and the rest are said on the case's timeline, so a case that
 * alerted people at once says why.
 */
export enum SecurityCaseAiHoldSkip {
  NotOn = "NotOn",
  SetupTest = "SetupTest",
  NotOpenedByDetection = "NotOpenedByDetection",
  AtOrAboveThreshold = "AtOrAboveThreshold",
  HighestPriority = "HighestPriority",
  ActiveAttack = "ActiveAttack",
  CannotWorkCases = "CannotWorkCases",
  CannotTriage = "CannotTriage",
  SteeringText = "SteeringText",
  RecentlyResolved = "RecentlyResolved",
  CheckFailed = "CheckFailed",
  // Security Events is switched off on the server: nothing of it runs.
  ProductOff = "ProductOff",
}

// The skips nobody needs to hear of: nothing about them is unexpected.
export const SECURITY_CASE_AI_HOLD_QUIET_SKIPS: ReadonlyArray<SecurityCaseAiHoldSkip> =
  [
    SecurityCaseAiHoldSkip.NotOn,
    SecurityCaseAiHoldSkip.SetupTest,
    SecurityCaseAiHoldSkip.NotOpenedByDetection,
    SecurityCaseAiHoldSkip.AtOrAboveThreshold,
    SecurityCaseAiHoldSkip.HighestPriority,
    // Its pages are switched off too: nobody reads the timeline meanwhile.
    SecurityCaseAiHoldSkip.ProductOff,
  ];

// What is read about a new case, and its project, to decide whether it is held.
export interface SecurityCaseAiHoldFacts {
  // The project's "Let OneUptime AI respond first".
  isOn: boolean;
  /*
   * Security Events is switched off on the server (ServerProducts): what
   * the server does by itself for it stops, and nothing is held.
   */
  isProductOff?: boolean | undefined;
  isSetupTest: boolean;
  isOpenedByDetection: boolean;
  // Below the priority the project holds cases under.
  isBelowThreshold: boolean;
  // At the project's most urgent priority.
  isHighestPriority: boolean;
  // Other cases the project opened within the attack window.
  otherCasesOpenedRecently: number;
  /*
   * Why OneUptime AI could not work the case, in its own words
   * (SECURITY_CASE_RESPONSE_NOT_STARTED_MESSAGES); null when it can.
   */
  cannotWorkCasesBecause: string | null;
  // Why it could not triage the case now, which starts its work; null when it can.
  cannotTriageBecause: string | null;
  // The case's own data holds text written to steer an AI.
  hasSteeringText: boolean;
  /*
   * An address, user or host the case names that a case OneUptime AI
   * resolved within the recurrence window named too.
   */
  recentlyResolvedEntity: SecurityEntity | null;
}

export interface SecurityCaseAiHoldDecision {
  canHold: boolean;
  skip?: SecurityCaseAiHoldSkip | undefined;
  // It looks like an active attack: every case held in the project ends too.
  isActiveAttack?: boolean | undefined;
}

/*
 * The decision, from what was read: the first reason not to hold, in the
 * order the rules are told above, or a hold.
 */
export function decideSecurityCaseAiHold(
  facts: SecurityCaseAiHoldFacts,
): SecurityCaseAiHoldDecision {
  if (!facts.isOn) {
    return { canHold: false, skip: SecurityCaseAiHoldSkip.NotOn };
  }

  if (facts.isProductOff) {
    return { canHold: false, skip: SecurityCaseAiHoldSkip.ProductOff };
  }

  if (facts.isSetupTest) {
    return { canHold: false, skip: SecurityCaseAiHoldSkip.SetupTest };
  }

  if (!facts.isOpenedByDetection) {
    return {
      canHold: false,
      skip: SecurityCaseAiHoldSkip.NotOpenedByDetection,
    };
  }

  if (facts.isHighestPriority) {
    return { canHold: false, skip: SecurityCaseAiHoldSkip.HighestPriority };
  }

  if (!facts.isBelowThreshold) {
    return { canHold: false, skip: SecurityCaseAiHoldSkip.AtOrAboveThreshold };
  }

  if (
    facts.otherCasesOpenedRecently >= SECURITY_CASE_AI_HOLD_ATTACK_CASE_COUNT
  ) {
    return {
      canHold: false,
      skip: SecurityCaseAiHoldSkip.ActiveAttack,
      isActiveAttack: true,
    };
  }

  if (facts.cannotWorkCasesBecause) {
    return { canHold: false, skip: SecurityCaseAiHoldSkip.CannotWorkCases };
  }

  if (facts.cannotTriageBecause) {
    return { canHold: false, skip: SecurityCaseAiHoldSkip.CannotTriage };
  }

  if (facts.hasSteeringText) {
    return { canHold: false, skip: SecurityCaseAiHoldSkip.SteeringText };
  }

  if (facts.recentlyResolvedEntity) {
    return { canHold: false, skip: SecurityCaseAiHoldSkip.RecentlyResolved };
  }

  return { canHold: true };
}

// ---------- What ends a hold ----------

// What a held case's review reads about it, and about OneUptime AI's work on it.
export interface SecurityCaseAiHoldState {
  now: Date;
  openedAt: Date;
  // When the hold time runs out.
  holdUntil: Date | null;
  // The setting is still on, and OneUptime AI may still work cases.
  isStillOn: boolean;
  // Security Events switched off on the server since (#10816).
  isProductOff?: boolean | undefined;
  // The case is still below the priority the project holds cases under.
  isStillBelowThreshold: boolean;
  stage: SecurityCaseStage;
  // Every step that contains the case verified by OneUptime's checks.
  isContainmentVerified: boolean;
  aiVerdict: SecurityCaseAiVerdict | null;
  // The case's latest triage, and when it ended.
  triageStatus: AIRunStatus | null;
  triageSettledAt: Date | null;
  // Where OneUptime AI stands on the case (SecurityCase.aiResponseState).
  responseState: SecurityCaseAiResponseState | null;
  // One of OneUptime AI's steps waits for a person's approval.
  isWaitingForApproval: boolean;
}

export interface SecurityCaseAiHoldReview {
  // Null: keep holding.
  outcome: SecurityCaseAiHoldOutcome | null;
}

const UNFINISHED_TRIAGE_STATUSES: ReadonlyArray<AIRunStatus> = [
  AIRunStatus.Error,
  AIRunStatus.Cancelled,
  AIRunStatus.Stale,
];

function minutesSince(at: Date, now: Date): number {
  return (now.getTime() - at.getTime()) / 60000;
}

/*
 * What to do with a held case now. Pure: everything is read first.
 *
 *   1. Closed, or Contained with every containing step verified: resolved,
 *      nobody alerted. Contained but not every step checked: people.
 *   2. The setting turned off, Security Events switched off on the
 *      server, or the case risen to the priority people are alerted for at
 *      once: people.
 *   3. OneUptime AI handed the case over, or waits for a person's approval:
 *      people.
 *   4. Its triage read the case as not malicious and nobody asked it to
 *      work the case anyway, or it never got started: people.
 *   5. The hold time ran out: people.
 *
 * A person who took the case, and Page now, end the hold where they happen
 * (SecurityCaseAiHold), not here.
 */
export function reviewSecurityCaseAiHold(
  state: SecurityCaseAiHoldState,
): SecurityCaseAiHoldReview {
  if (state.stage === SecurityCaseStage.Closed) {
    return { outcome: SecurityCaseAiHoldOutcome.Resolved };
  }

  if (state.stage === SecurityCaseStage.Contained) {
    return {
      outcome: state.isContainmentVerified
        ? SecurityCaseAiHoldOutcome.Resolved
        : SecurityCaseAiHoldOutcome.NotVerified,
    };
  }

  if (!state.isStillOn) {
    return { outcome: SecurityCaseAiHoldOutcome.TurnedOff };
  }

  if (state.isProductOff) {
    return { outcome: SecurityCaseAiHoldOutcome.ProductOff };
  }

  if (!state.isStillBelowThreshold) {
    return { outcome: SecurityCaseAiHoldOutcome.RoseInPriority };
  }

  if (state.responseState === SecurityCaseAiResponseState.HandedToPeople) {
    return { outcome: SecurityCaseAiHoldOutcome.HandedOff };
  }

  if (
    state.isWaitingForApproval ||
    state.responseState === SecurityCaseAiResponseState.WaitingForPeople
  ) {
    return { outcome: SecurityCaseAiHoldOutcome.NeedsApproval };
  }

  const isWorking: boolean = isSecurityCaseAiResponseActive(
    state.responseState,
  );

  if (
    state.aiVerdict &&
    state.aiVerdict !== SecurityCaseAiVerdict.LikelyMalicious &&
    !isWorking
  ) {
    return { outcome: SecurityCaseAiHoldOutcome.NotMalicious };
  }

  if (!isWorking) {
    const settledLongEnough: boolean =
      !state.triageSettledAt ||
      minutesSince(state.triageSettledAt, state.now) >=
        SECURITY_CASE_AI_HOLD_START_GRACE_IN_MINUTES;

    // The triage did not finish.
    if (
      state.triageStatus &&
      UNFINISHED_TRIAGE_STATUSES.includes(state.triageStatus)
    ) {
      return { outcome: SecurityCaseAiHoldOutcome.NotStarted };
    }

    // No triage at all, long after the case opened.
    if (
      !state.triageStatus &&
      minutesSince(state.openedAt, state.now) >=
        SECURITY_CASE_AI_HOLD_START_GRACE_IN_MINUTES
    ) {
      return { outcome: SecurityCaseAiHoldOutcome.NotStarted };
    }

    // Triaged, and OneUptime AI never took the case up.
    if (
      state.triageStatus &&
      state.triageStatus !== AIRunStatus.Queued &&
      state.triageStatus !== AIRunStatus.Running &&
      settledLongEnough
    ) {
      return { outcome: SecurityCaseAiHoldOutcome.NotStarted };
    }
  }

  if (state.holdUntil && state.now.getTime() >= state.holdUntil.getTime()) {
    return { outcome: SecurityCaseAiHoldOutcome.TimeRanOut };
  }

  return { outcome: null };
}

// ---------- A Page On-Call step while OneUptime AI responds first ----------

/*
 * The playbook runs whose Page On-Call steps wait while a case is held:
 * the ones that started on their own. A run a person started pages when
 * its step comes - they asked for it - and OneUptime AI's own runs page
 * nobody.
 */
export const SECURITY_CASE_AI_HOLD_PAGE_TRIGGERS: ReadonlyArray<string> = [
  SecurityPlaybookTrigger.CaseOpened,
  SecurityPlaybookTrigger.DetectionAdded,
  SecurityPlaybookTrigger.TriagedAsLikelyMalicious,
];

export enum SecurityCaseAiHoldPageDecision {
  // Page as the step says.
  Page = "Page",
  // Wait, in Waiting for OneUptime AI, until the hold ends.
  Wait = "Wait",
  // Skip: the hold ended with nobody to page.
  Skip = "Skip",
}

/*
 * What a playbook's Page On-Call step does about a case's hold, when its
 * run reaches it. A run that started on its own waits while the case is
 * held. Once the hold is over, a run that waited - or started while it
 * held - pages when people were alerted, and skips the page when OneUptime
 * AI resolved the case or a person took it. A run that started after the
 * hold ended pages as it would have: the hold is over.
 */
export function decideSecurityCaseAiHoldPage(data: {
  outcome: SecurityCaseAiHoldOutcome | string | null | undefined;
  holdEndedAt: Date | null | undefined;
  run: {
    trigger?: string | null | undefined;
    isStartedByPerson: boolean;
    createdAt?: Date | null | undefined;
  };
}): SecurityCaseAiHoldPageDecision {
  if (
    data.run.isStartedByPerson ||
    !SECURITY_CASE_AI_HOLD_PAGE_TRIGGERS.includes(data.run.trigger || "")
  ) {
    return SecurityCaseAiHoldPageDecision.Page;
  }

  if (!data.outcome) {
    return SecurityCaseAiHoldPageDecision.Page;
  }

  if (data.outcome === SecurityCaseAiHoldOutcome.Holding) {
    return SecurityCaseAiHoldPageDecision.Wait;
  }

  if (
    data.run.createdAt &&
    data.holdEndedAt &&
    new Date(data.run.createdAt).getTime() >
      new Date(data.holdEndedAt).getTime()
  ) {
    return SecurityCaseAiHoldPageDecision.Page;
  }

  return isSecurityCaseAiHoldAlerting(data.outcome)
    ? SecurityCaseAiHoldPageDecision.Page
    : SecurityCaseAiHoldPageDecision.Skip;
}

// ---------- What the case's page says of a hold ----------

/*
 * How a hold ended, in a sentence, for the case's OneUptime AI card in the
 * reader's language (and the docs). A sentence that names who did it takes
 * {{name}}.
 */
export const SECURITY_CASE_AI_HOLD_OUTCOME_SENTENCES: Readonly<
  Record<SecurityCaseAiHoldOutcome, string>
> = {
  [SecurityCaseAiHoldOutcome.Holding]: translationKey(
    "OneUptime AI is working the case before anyone is alerted.",
  ),
  [SecurityCaseAiHoldOutcome.Resolved]: translationKey(
    "Nobody was alerted: the case was contained, every step checked, before OneUptime AI needed anyone.",
  ),
  [SecurityCaseAiHoldOutcome.NeedsApproval]: translationKey(
    "People were alerted: OneUptime AI asked a person to approve a step.",
  ),
  [SecurityCaseAiHoldOutcome.HandedOff]: translationKey(
    "People were alerted: OneUptime AI handed the case to people.",
  ),
  [SecurityCaseAiHoldOutcome.TimeRanOut]: translationKey(
    "People were alerted: OneUptime AI did not finish in time.",
  ),
  [SecurityCaseAiHoldOutcome.NotStarted]: translationKey(
    "People were alerted: OneUptime AI could not start working the case.",
  ),
  [SecurityCaseAiHoldOutcome.NotMalicious]: translationKey(
    "People were alerted: OneUptime AI's triage did not read the case as Likely Malicious.",
  ),
  [SecurityCaseAiHoldOutcome.NotVerified]: translationKey(
    "People were alerted: the case was marked Contained, but OneUptime could not check every step that contains it.",
  ),
  [SecurityCaseAiHoldOutcome.ActiveAttack]: translationKey(
    "People were alerted: several cases opened within minutes, which looks like an active attack.",
  ),
  [SecurityCaseAiHoldOutcome.TurnedOff]: translationKey(
    "People were alerted: letting OneUptime AI respond first was turned off.",
  ),
  [SecurityCaseAiHoldOutcome.ProductOff]: translationKey(
    "People were alerted: Security Events is off on this server.",
  ),
  [SecurityCaseAiHoldOutcome.PageNow]: translationKey(
    "People were alerted: {{name}} pressed Page now.",
  ),
  [SecurityCaseAiHoldOutcome.RoseInPriority]: translationKey(
    "People were alerted: the case rose to a priority people are alerted for at once.",
  ),
  [SecurityCaseAiHoldOutcome.TakenByPerson]: translationKey(
    "Nobody else was alerted: {{name}} took the case.",
  ),
};

// Who did it, when the hold's end does not know: in place of {{name}}.
export const SECURITY_CASE_AI_HOLD_SOMEONE: string = translationKey("Someone");

/*
 * Why a new case was not held, in a sentence, for its timeline - after
 * "OneUptime AI did not hold this case's alerts." Values in {{braces}}:
 * an entity, OneUptime's own words why it cannot work or triage cases.
 */
export const SECURITY_CASE_AI_HOLD_SKIP_SENTENCES: Readonly<
  Record<SecurityCaseAiHoldSkip, string>
> = {
  [SecurityCaseAiHoldSkip.NotOn]: translationKey(
    "Letting OneUptime AI respond first is off.",
  ),
  [SecurityCaseAiHoldSkip.SetupTest]: translationKey(
    "This is the setup test's case.",
  ),
  [SecurityCaseAiHoldSkip.NotOpenedByDetection]: translationKey(
    "A person opened this case.",
  ),
  [SecurityCaseAiHoldSkip.AtOrAboveThreshold]: translationKey(
    "Cases at this priority alert people at once.",
  ),
  [SecurityCaseAiHoldSkip.HighestPriority]: translationKey(
    "The case is at your highest priority, so people are alerted at once.",
  ),
  [SecurityCaseAiHoldSkip.ActiveAttack]: translationKey(
    "Several cases opened within minutes, which looks like an active attack, so people take it.",
  ),
  [SecurityCaseAiHoldSkip.CannotWorkCases]: translationKey(
    "OneUptime AI cannot work this case: {{why}}",
  ),
  [SecurityCaseAiHoldSkip.CannotTriage]: translationKey(
    "OneUptime AI cannot triage this case: {{why}}",
  ),
  [SecurityCaseAiHoldSkip.SteeringText]: translationKey(
    "Some of the case's data reads like instructions to an AI, so a person has to look at it.",
  ),
  [SecurityCaseAiHoldSkip.RecentlyResolved]: translationKey(
    "OneUptime AI resolved a case about {{value}} in the last 24 hours, and it is back: what it did did not hold.",
  ),
  [SecurityCaseAiHoldSkip.CheckFailed]: translationKey(
    "OneUptime AI could not check whether it may respond first.",
  ),
  [SecurityCaseAiHoldSkip.ProductOff]: translationKey(
    "Security Events is off on this server.",
  ),
};
