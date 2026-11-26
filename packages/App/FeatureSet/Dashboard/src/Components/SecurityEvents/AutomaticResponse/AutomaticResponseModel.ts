import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";
import {
  ACTS_ON_RULES,
  ACTS_ON_TECHNIQUES,
  ACTS_ON_THREAT_INTEL,
  ACTS_ON_THREAT_INTEL_ANY,
  ACTS_ON_TURNED_AWAY,
  GUARDRAIL_LADDER,
  GUARDRAIL_LIMIT,
  GUARDRAIL_PROTECTED,
  GUARDRAIL_SIGNED_IN,
  GUARDRAIL_UNDO,
  LAST_WEEK_BLOCKED,
  LAST_WEEK_CHALLENGED,
  LAST_WEEK_SPARED,
  MODE_OFF,
  MODE_ON,
  MODE_TRIAL_FINISHED,
  MODE_TRIAL_RUN,
  NOT_A_TECHNIQUE,
  RULE_MISSING,
  RULE_MISSING_TOOLTIP,
  RULE_OFF,
  RULE_OFF_TOOLTIP,
  RULE_REAL_TIME,
  RULE_SCHEDULED,
  RULE_SCHEDULED_TOOLTIP,
  SO_FAR_WOULD_HAVE_BLOCKED,
  SO_FAR_WOULD_HAVE_CHALLENGED,
  SPARED_CANNOT_TELL,
  SPARED_NONE,
  SPARED_NONE_YOURS,
  SPARED_NO_SIGNED_IN,
  SPARED_PROTECTED,
  SPARED_SIGNED_IN,
  STATE_OFF,
  STATE_OFF_TRIAL_FINISHED,
  STATE_ON,
  STATE_ON_BY,
  STATE_TRIAL_RUNNING,
  TRIAL_WOULD_HAVE_BLOCKED,
  TRIAL_WOULD_HAVE_CHALLENGED,
  WOULD_HAVE_LIFTED,
  WOULD_HAVE_STOPPED,
} from "./AutomaticResponseCopy";
import OneUptimeDate from "Common/Types/Date";
import {
  SecurityAutomaticResponseOverviewDestination,
  SecurityAutomaticResponseOverviewPolicy,
  SecurityAutomaticResponseRule,
  SecurityAutomaticResponseRuleState,
} from "Common/Types/SecurityAutomaticResponse/SecurityAutomaticResponseOverview";
import {
  SecurityAutomaticResponseMode,
  SecurityAutomaticResponsePolicyKind,
  SecurityAutomaticResponseTrialState,
  getReadySecurityAutomaticResponsePolicy,
  readMitreTechniqueId,
} from "Common/Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import {
  SecurityAutomaticResponseTimeToBlockDay,
  SecurityAutomaticResponseTrialSummary,
} from "Common/Types/SecurityAutomaticResponse/SecurityAutomaticResponseSummary";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { formatCompactDuration } from "Common/Utils/Milliseconds";

/*
 * What the Automatic Response page says of each policy (#10350), React-free
 * so a plain test pins each rule: the chip beside its switch, where
 * flipping the switch takes it, the line of where it stands, what its
 * trial run would have done and what it did, what it acts on, its
 * guardrails, and its time to block.
 *
 *   Off        the switch starts a 7-day trial run - or, after a whole
 *              week of one, puts it straight to work;
 *   Trial Run  it records what it would have done; once its week is up,
 *              its summary asks "Turn it on?" beside Turn On;
 *   On         it acts, and says what it did in the last week.
 *
 * Turning it on without a trial run is folded under More settings, and the
 * switch turns any of them off.
 */

// Fixed words in the reader's language, or as written when they have none.
export function say(translator: Translator, text: string): string {
  return translator.translateText(text) || text;
}

// ---------- Where it stands ----------

export interface PolicyModeChip {
  text: string;
  tone: PillTone;
}

// Whether a policy finished a whole week of trial run, now or before.
export function hasPolicyFinishedTrial(
  policy: Pick<
    SecurityAutomaticResponseOverviewPolicy,
    "trialState" | "trialFinishedAt"
  >,
): boolean {
  return (
    policy.trialState === SecurityAutomaticResponseTrialState.Finished ||
    Boolean(policy.trialFinishedAt)
  );
}

// The chip beside the switch: Off, Trial Run, Trial Finished, On.
export function getPolicyModeChip(
  policy: Pick<
    SecurityAutomaticResponseOverviewPolicy,
    "mode" | "trialState" | "trialFinishedAt"
  >,
): PolicyModeChip {
  if (policy.mode === SecurityAutomaticResponseMode.On) {
    return { text: MODE_ON, tone: PillTone.Success };
  }

  if (policy.mode === SecurityAutomaticResponseMode.TrialRun) {
    return hasPolicyFinishedTrial(policy)
      ? { text: MODE_TRIAL_FINISHED, tone: PillTone.Info }
      : { text: MODE_TRIAL_RUN, tone: PillTone.Info };
  }

  return { text: MODE_OFF, tone: PillTone.Paused };
}

// Whether the switch shows the policy on: in its trial run, or acting.
export function isPolicySwitchOn(
  policy: Pick<SecurityAutomaticResponseOverviewPolicy, "mode">,
): boolean {
  return policy.mode !== SecurityAutomaticResponseMode.Off;
}

/*
 * Where flipping the switch on takes a policy: into a 7-day trial run, or
 * straight On once a whole week of trial run is behind it.
 */
export function getSwitchedOnMode(
  policy: Pick<
    SecurityAutomaticResponseOverviewPolicy,
    "trialState" | "trialFinishedAt"
  >,
): SecurityAutomaticResponseMode {
  return hasPolicyFinishedTrial(policy)
    ? SecurityAutomaticResponseMode.On
    : SecurityAutomaticResponseMode.TrialRun;
}

// Whether a policy asks to be turned on: its week of trial run is up.
export function isPolicyAskingToTurnOn(
  policy: Pick<
    SecurityAutomaticResponseOverviewPolicy,
    "mode" | "trialState" | "trialFinishedAt"
  >,
): boolean {
  return (
    policy.mode === SecurityAutomaticResponseMode.TrialRun &&
    hasPolicyFinishedTrial(policy)
  );
}

// Whether More settings offers to turn it on without a trial run: it is not on, and has no week behind it.
export function canTurnOnWithoutTrial(
  policy: Pick<
    SecurityAutomaticResponseOverviewPolicy,
    "mode" | "trialState" | "trialFinishedAt"
  >,
): boolean {
  return (
    policy.mode !== SecurityAutomaticResponseMode.On &&
    !hasPolicyFinishedTrial(policy)
  );
}

// A day as the page writes it: "22 Nov", with its year when it is not this year's.
export function writePolicyDay(date: Date, now: Date): string {
  return date.getFullYear() === now.getFullYear()
    ? OneUptimeDate.getDateAsLocalDayMonthString(date)
    : OneUptimeDate.getDateAsLocalDayMonthYearString(date);
}

// The line of where a policy stands; empty for a finished trial, whose summary says it.
export function writePolicyStateLine(data: {
  policy: SecurityAutomaticResponseOverviewPolicy;
  translator: Translator;
  now: Date;
}): string {
  const { policy, translator, now } = data;

  if (policy.mode === SecurityAutomaticResponseMode.On) {
    const since: Date = policy.turnedOnAt || now;

    return policy.turnedOnBy
      ? translator.translateTemplate(STATE_ON_BY, {
          date: writePolicyDay(since, now),
          name: policy.turnedOnBy,
        })
      : translator.translateTemplate(STATE_ON, {
          date: writePolicyDay(since, now),
        });
  }

  if (policy.mode === SecurityAutomaticResponseMode.TrialRun) {
    if (hasPolicyFinishedTrial(policy)) {
      return "";
    }

    return translator.translatePlural(
      STATE_TRIAL_RUNNING,
      Math.max(1, policy.trialDaysLeft),
    );
  }

  if (policy.trialFinishedAt) {
    return translator.translateTemplate(STATE_OFF_TRIAL_FINISHED, {
      date: writePolicyDay(policy.trialFinishedAt, now),
    });
  }

  return say(translator, STATE_OFF);
}

// What the guardrails left alone, as sentences.
function writeSpared(
  summary: SecurityAutomaticResponseTrialSummary,
  translator: Translator,
): Array<string> {
  if (summary.sparedSignedIn === 0 && summary.sparedProtected === 0) {
    return [say(translator, SPARED_NONE)];
  }

  const lines: Array<string> = [];

  lines.push(
    summary.sparedSignedIn > 0
      ? translator.translatePlural(SPARED_SIGNED_IN, summary.sparedSignedIn)
      : say(translator, SPARED_NO_SIGNED_IN),
  );
  lines.push(
    summary.sparedProtected > 0
      ? translator.translatePlural(SPARED_PROTECTED, summary.sparedProtected)
      : say(translator, SPARED_NONE_YOURS),
  );

  return lines;
}

/*
 * What a policy's trial run would have done, as sentences: "In 7 days this
 * would have challenged 1,283 addresses. None had signed-in users, and
 * none were yours." - or so far, while it runs. None for a policy that
 * never ran one, or that is on: what it did says more.
 */
export function writeTrialSummary(data: {
  policy: SecurityAutomaticResponseOverviewPolicy;
  translator: Translator;
}): Array<string> {
  const { policy, translator } = data;
  const summary: SecurityAutomaticResponseTrialSummary | null =
    policy.trialSummary;

  if (!summary || policy.mode !== SecurityAutomaticResponseMode.TrialRun) {
    return [];
  }

  const isChallenge: boolean =
    policy.blockAction === SecurityBlockAction.Challenge;
  const isFinished: boolean = hasPolicyFinishedTrial(policy);
  const lines: Array<string> = [
    translator.translatePlural(
      isFinished
        ? isChallenge
          ? TRIAL_WOULD_HAVE_CHALLENGED
          : TRIAL_WOULD_HAVE_BLOCKED
        : isChallenge
          ? SO_FAR_WOULD_HAVE_CHALLENGED
          : SO_FAR_WOULD_HAVE_BLOCKED,
      summary.wouldActOn,
    ),
    ...writeSpared(summary, translator),
  ];

  if (summary.wouldHaveLifted > 0) {
    lines.push(
      translator.translatePlural(WOULD_HAVE_LIFTED, summary.wouldHaveLifted),
    );
  }

  if (summary.sparedCannotTell > 0) {
    lines.push(
      translator.translatePlural(SPARED_CANNOT_TELL, summary.sparedCannotTell),
    );
  }

  if (summary.wouldHaveStopped > 0) {
    lines.push(
      translator.translatePlural(WOULD_HAVE_STOPPED, summary.wouldHaveStopped),
    );
  }

  return lines;
}

// What a policy that is on did in the last 7 days.
export function writeLastWeek(data: {
  policy: SecurityAutomaticResponseOverviewPolicy;
  translator: Translator;
}): Array<string> {
  const { policy, translator } = data;

  if (policy.mode !== SecurityAutomaticResponseMode.On) {
    return [];
  }

  const lines: Array<string> = [
    translator.translatePlural(
      policy.blockAction === SecurityBlockAction.Challenge
        ? LAST_WEEK_CHALLENGED
        : LAST_WEEK_BLOCKED,
      policy.lastWeek.acted,
    ),
  ];

  if (policy.lastWeek.spared > 0) {
    lines.push(
      translator.translatePlural(LAST_WEEK_SPARED, policy.lastWeek.spared),
    );
  }

  return lines;
}

// ---------- What it acts on ----------

export interface PolicyRuleChip {
  text: string;
  tone: PillTone;
  // In English, looked up where it is drawn.
  tooltip?: string | undefined;
}

/*
 * Where one of a ready policy's rules stands. A rule on its schedule is
 * a warning only while the policy runs: an Off policy's rules are turned
 * real-time as it is turned on.
 */
export function getPolicyRuleChip(data: {
  rule: SecurityAutomaticResponseRule;
  isPolicyRunning: boolean;
}): PolicyRuleChip {
  switch (data.rule.state) {
    case SecurityAutomaticResponseRuleState.RealTime:
      return { text: RULE_REAL_TIME, tone: PillTone.Success };
    case SecurityAutomaticResponseRuleState.Scheduled:
      return data.isPolicyRunning
        ? {
            text: RULE_SCHEDULED,
            tone: PillTone.Warning,
            tooltip: RULE_SCHEDULED_TOOLTIP,
          }
        : { text: RULE_SCHEDULED, tone: PillTone.Neutral };
    case SecurityAutomaticResponseRuleState.Off:
      return {
        text: RULE_OFF,
        tone: PillTone.Paused,
        tooltip: RULE_OFF_TOOLTIP,
      };
    default:
      return {
        text: RULE_MISSING,
        tone: PillTone.Neutral,
        tooltip: RULE_MISSING_TOOLTIP,
      };
  }
}

// A condition a policy acts on, besides its rules: words, and the techniques drawn as chips.
export interface PolicyCondition {
  text: string;
  techniques?: Array<string> | undefined;
}

export function getPolicyConditions(data: {
  policy: SecurityAutomaticResponseOverviewPolicy;
  translator: Translator;
}): Array<PolicyCondition> {
  const { policy, translator } = data;
  const conditions: Array<PolicyCondition> = [];
  const isReady: boolean =
    policy.kind !== SecurityAutomaticResponsePolicyKind.Custom;
  const match: SecurityAutomaticResponseOverviewPolicy["match"] = policy.match;

  // A ready policy's rules are listed one by one; a project's own says its techniques and how many rules.
  if (!isReady && match.mitreTechniques.length > 0) {
    conditions.push({
      text: say(translator, ACTS_ON_TECHNIQUES),
      techniques: match.mitreTechniques,
    });
  }

  if (!isReady && match.detectionRuleIds.length > 0) {
    conditions.push({
      text: translator.translatePlural(
        ACTS_ON_RULES,
        match.detectionRuleIds.length,
      ),
    });
  }

  if (match.requiresThreatIntel) {
    const isThreatIntelAlone: boolean =
      match.mitreTechniques.length === 0 && match.detectionRuleIds.length === 0;

    conditions.push({
      text: say(
        translator,
        isThreatIntelAlone ? ACTS_ON_THREAT_INTEL_ANY : ACTS_ON_THREAT_INTEL,
      ),
    });
  }

  if (match.requiresEveryRequestTurnedAway) {
    conditions.push({ text: say(translator, ACTS_ON_TURNED_AWAY) });
  }

  return conditions;
}

/*
 * The destinations that hold a policy's challenge as a block, by name:
 * none for a policy that blocks, or where every destination challenges.
 */
export function getChallengeHeldAsBlockAt(data: {
  policy: Pick<SecurityAutomaticResponseOverviewPolicy, "blockAction">;
  destinations: ReadonlyArray<SecurityAutomaticResponseOverviewDestination>;
}): Array<string> {
  if (data.policy.blockAction !== SecurityBlockAction.Challenge) {
    return [];
  }

  const names: Array<string> = [];

  for (const destination of data.destinations) {
    const name: string = destination.name.trim();

    if (!destination.canChallenge && name && !names.includes(name)) {
      names.push(name);
    }
  }

  return names;
}

// ---------- Its guardrails ----------

// What keeps a policy safe to leave on, as sentences.
export function writeGuardrails(data: {
  policy: Pick<SecurityAutomaticResponseOverviewPolicy, "duration">;
  maxBlocksPerHour: number;
  translator: Translator;
}): Array<string> {
  const { translator } = data;
  const ladder: string =
    GUARDRAIL_LADDER[data.policy.duration as keyof typeof GUARDRAIL_LADDER] ||
    GUARDRAIL_LADDER[SecurityBlockDuration.OneHour];

  return [
    say(translator, GUARDRAIL_PROTECTED),
    say(translator, GUARDRAIL_SIGNED_IN),
    say(translator, ladder),
    translator.translatePlural(GUARDRAIL_LIMIT, data.maxBlocksPerHour),
    say(translator, GUARDRAIL_UNDO),
  ];
}

// ---------- Time to block ----------

/*
 * A time to block in the reader's words: "41s", "1m 32s", "2h 5m" -
 * seconds under a minute, minutes and seconds under an hour, else hours
 * and minutes.
 */
export function formatTimeToBlock(
  seconds: number | null | undefined,
  translator: Translator,
): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return EMPTY_VALUE_MARK;
  }

  const whole: number = Math.round(seconds);

  if (whole < 60) {
    return formatCompactDuration(translator, { seconds: whole });
  }

  if (whole < 60 * 60) {
    const minutes: number = Math.floor(whole / 60);
    const rest: number = whole % 60;

    return rest === 0
      ? formatCompactDuration(translator, { minutes })
      : formatCompactDuration(translator, { minutes, seconds: rest });
  }

  const hours: number = Math.floor(whole / 3600);
  const minutes: number = Math.floor((whole % 3600) / 60);

  return minutes === 0
    ? formatCompactDuration(translator, { hours })
    : formatCompactDuration(translator, { hours, minutes });
}

export interface TimeToBlockPoint {
  // The day's start, in UTC.
  day: Date;
  seconds: number;
}

// The days a percentile has a figure for, oldest first: a day with no block has none.
export function getTimeToBlockPoints(
  days: ReadonlyArray<SecurityAutomaticResponseTimeToBlockDay>,
  percentile: "p50InSeconds" | "p95InSeconds",
): Array<TimeToBlockPoint> {
  const points: Array<TimeToBlockPoint> = [];

  for (const day of days) {
    const seconds: number | null = day[percentile];

    if (seconds === null || day.count === 0) {
      continue;
    }

    points.push({ day: new Date(`${day.day}T00:00:00.000Z`), seconds });
  }

  return points;
}

// ---------- A project's own policy ----------

export interface TypedTechniques {
  techniques: Array<string>;
  // The first typed that is no technique, as typed.
  invalid: string | null;
}

// The ATT&CK techniques typed into a policy's field: "T1110, t1190.001".
export function readTypedTechniques(value: unknown): TypedTechniques {
  const techniques: Array<string> = [];

  for (const part of String(value ?? "").split(/[\s,;]+/)) {
    const typed: string = part.trim();

    if (!typed) {
      continue;
    }

    const technique: string | null = readMitreTechniqueId(typed);

    if (!technique) {
      return { techniques, invalid: typed };
    }

    if (!techniques.includes(technique)) {
      techniques.push(technique);
    }
  }

  return { techniques, invalid: null };
}

// Why the typed techniques cannot be kept, in the reader's words; null when they can.
export function writeTypedTechniquesProblem(
  value: unknown,
  translator: Translator,
): string | null {
  const typed: TypedTechniques = readTypedTechniques(value);

  return typed.invalid
    ? translator.translateTemplate(NOT_A_TECHNIQUE, { value: typed.invalid })
    : null;
}

/*
 * A policy's name as the page draws it: a ready policy's in the reader's
 * language, a project's own as its people wrote it.
 */
export function getPolicyDisplayName(
  policy: Pick<SecurityAutomaticResponseOverviewPolicy, "kind" | "name">,
  translator: Translator,
): string {
  const ready: { name: string } | undefined =
    getReadySecurityAutomaticResponsePolicy(policy.kind);

  return ready ? say(translator, ready.name) : policy.name;
}

// A policy's description as the page draws it, by the same rule as its name.
export function getPolicyDisplayDescription(
  policy: Pick<SecurityAutomaticResponseOverviewPolicy, "kind" | "description">,
  translator: Translator,
): string {
  const ready: { description: string } | undefined =
    getReadySecurityAutomaticResponsePolicy(policy.kind);

  return ready ? say(translator, ready.description) : policy.description;
}
