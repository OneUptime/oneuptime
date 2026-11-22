import { JSONObject, JSONValue } from "../JSON";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
} from "../SecurityBlocklist/SecurityBlock";

/*
 * AUTOMATIC RESPONSE POLICIES (#10350): challenge or block an attacking
 * address as the detection is made, before anybody triages the case, under
 * guardrails that make it safe to leave on.
 *
 * Most breaches of a public app start with noise - scanners probing
 * /.env and /wp-admin, bots trying leaked passwords - from cloud and VPS
 * addresses, minutes to hours before anything works. A person cannot answer
 * in that window; a policy can. Three ready policies ship, each off until
 * someone turns it on, and a project can add its own from a blank one:
 *
 *   Scanners            a web scanning or probing detection (ATT&CK T1595,
 *                       T1190 attempts), while every request so far was
 *                       turned away: challenge for 1 hour;
 *   Password guessing   a brute force or password spraying detection
 *                       (T1110): block for 1 hour;
 *   Known-bad addresses a detection about an address the project's threat
 *                       intel lists: block for 24 hours.
 *
 * Every policy acts on a public address the detection is about, and only
 * through the blocklist's one way in, under the guardrails below. A policy
 * starts in a trial run: for its first week it only records what it would
 * have done, and then asks to be turned on.
 *
 * Shared by the server, which runs the policies, and the Dashboard, which
 * shows them. Pure: free of anything server-only and of React.
 */

export enum SecurityAutomaticResponsePolicyKind {
  Scanners = "Scanners",
  PasswordGuessing = "PasswordGuessing",
  KnownBadAddresses = "KnownBadAddresses",
  // A project's own, made from the blank policy.
  Custom = "Custom",
}

/*
 * Where a policy stands: Off (does nothing), Trial Run (records what it
 * would have done, and does nothing else) or On (acts).
 */
export enum SecurityAutomaticResponseMode {
  Off = "Off",
  TrialRun = "TrialRun",
  On = "On",
}

export const SECURITY_AUTOMATIC_RESPONSE_POLICY_KINDS: ReadonlyArray<SecurityAutomaticResponsePolicyKind> =
  [
    SecurityAutomaticResponsePolicyKind.Scanners,
    SecurityAutomaticResponsePolicyKind.PasswordGuessing,
    SecurityAutomaticResponsePolicyKind.KnownBadAddresses,
    SecurityAutomaticResponsePolicyKind.Custom,
  ];

// The ready policies, in the order the page lists them.
export const SECURITY_AUTOMATIC_RESPONSE_READY_KINDS: ReadonlyArray<SecurityAutomaticResponsePolicyKind> =
  [
    SecurityAutomaticResponsePolicyKind.Scanners,
    SecurityAutomaticResponsePolicyKind.PasswordGuessing,
    SecurityAutomaticResponsePolicyKind.KnownBadAddresses,
  ];

export const SECURITY_AUTOMATIC_RESPONSE_MODES: ReadonlyArray<SecurityAutomaticResponseMode> =
  [
    SecurityAutomaticResponseMode.Off,
    SecurityAutomaticResponseMode.TrialRun,
    SecurityAutomaticResponseMode.On,
  ];

export function isSecurityAutomaticResponsePolicyKind(
  value: unknown,
): value is SecurityAutomaticResponsePolicyKind {
  return (
    typeof value === "string" &&
    (
      SECURITY_AUTOMATIC_RESPONSE_POLICY_KINDS as ReadonlyArray<string>
    ).includes(value)
  );
}

export function isSecurityAutomaticResponseMode(
  value: unknown,
): value is SecurityAutomaticResponseMode {
  return (
    typeof value === "string" &&
    (SECURITY_AUTOMATIC_RESPONSE_MODES as ReadonlyArray<string>).includes(value)
  );
}

export function isReadySecurityAutomaticResponsePolicyKind(
  value: unknown,
): boolean {
  return (
    typeof value === "string" &&
    (SECURITY_AUTOMATIC_RESPONSE_READY_KINDS as ReadonlyArray<string>).includes(
      value,
    )
  );
}

// ---------- The guardrails ----------

const HOUR_IN_MS: number = 60 * 60 * 1000;
const DAY_IN_MS: number = 24 * HOUR_IN_MS;

// How long a policy's trial run lasts before it asks to be turned on.
export const SECURITY_AUTOMATIC_RESPONSE_TRIAL_DAYS: number = 7;
export const SECURITY_AUTOMATIC_RESPONSE_TRIAL_IN_MS: number =
  SECURITY_AUTOMATIC_RESPONSE_TRIAL_DAYS * DAY_IN_MS;

/*
 * The most automatic blocks a project's policies make in an hour. Past it
 * they stop blocking and page the project's security owners: an attack that
 * large needs a person, and stopping quietly would hide the largest attacks.
 */
export const SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR: number = 50;
export const SECURITY_AUTOMATIC_RESPONSE_LIMIT_WINDOW_IN_MS: number =
  HOUR_IN_MS;

/*
 * How far back a signed-in user's use of an address spares it: an office's
 * NAT, a customer's proxy and a person's home address are all used by
 * someone signed in within a month.
 */
export const SECURITY_SIGNED_IN_ADDRESS_LOOKBACK_DAYS: number = 30;
export const SECURITY_SIGNED_IN_ADDRESS_LOOKBACK_IN_MS: number =
  SECURITY_SIGNED_IN_ADDRESS_LOOKBACK_DAYS * DAY_IN_MS;

// The lengths a policy's first block may be, in the order they are offered.
export const SECURITY_AUTOMATIC_RESPONSE_DURATIONS: ReadonlyArray<SecurityBlockDuration> =
  [
    SecurityBlockDuration.OneHour,
    SecurityBlockDuration.OneDay,
    SecurityBlockDuration.SevenDays,
  ];

export function isSecurityAutomaticResponseDuration(
  value: unknown,
): value is SecurityBlockDuration {
  return (
    typeof value === "string" &&
    (SECURITY_AUTOMATIC_RESPONSE_DURATIONS as ReadonlyArray<string>).includes(
      value,
    )
  );
}

// ---------- What a policy matches ----------

/*
 * What a detection must be for a policy to act on it. A detection always
 * has to be about a public address; past that:
 *
 *   - mitreTechniques: it carries one of these ATT&CK techniques, a
 *     technique matching its sub-techniques ("T1110" matches T1110.003);
 *   - detectionRuleIds: or it was made by one of these detection rules;
 *   - requiresThreatIntel: the project's threat intel lists the address;
 *   - requiresEveryRequestTurnedAway: every request of it so far was turned
 *     away (4xx): none reached a handler, broke something or reached the
 *     database.
 *
 * Techniques and rules are either-or: a detection with one of the
 * techniques, or made by one of the rules, matches. A policy with neither
 * matches any detection that meets its other conditions, so a project's
 * own policy needs a technique, a rule or threat intel.
 */
export interface SecurityAutomaticResponseMatch {
  mitreTechniques: Array<string>;
  detectionRuleIds: Array<string>;
  requiresThreatIntel: boolean;
  requiresEveryRequestTurnedAway: boolean;
}

export const SECURITY_AUTOMATIC_RESPONSE_MAX_TECHNIQUES: number = 50;
export const SECURITY_AUTOMATIC_RESPONSE_MAX_RULES: number = 50;

// A policy as the page, the matcher and the guardrails read it.
export interface SecurityAutomaticResponsePolicyDefinition {
  kind: SecurityAutomaticResponsePolicyKind;
  name: string;
  description: string;
  blockAction: SecurityBlockAction;
  // The first block's length: the repeat-offender ladder lengthens the next ones.
  duration: SecurityBlockDuration;
  match: SecurityAutomaticResponseMatch;
}

/*
 * Marks an English sentence as a key of the Dashboard's locales - the same
 * marker as Common/UI/Utils/TranslateTemplate's translationKey, kept here so
 * this file stays free of the UI. It returns the text unchanged.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

/*
 * The ready policies. A project switches them on as they are: what they
 * match, do and for how long is fixed, and a project wanting something
 * else makes its own from the blank policy.
 */
export const SECURITY_AUTOMATIC_RESPONSE_READY_POLICIES: ReadonlyArray<SecurityAutomaticResponsePolicyDefinition> =
  [
    {
      kind: SecurityAutomaticResponsePolicyKind.Scanners,
      name: translationKey("Scanners"),
      description: translationKey(
        "Challenges an address that probes your app for weaknesses, such as /.env, /wp-admin or path traversal, while every request it sent was turned away.",
      ),
      blockAction: SecurityBlockAction.Challenge,
      duration: SecurityBlockDuration.OneHour,
      match: {
        mitreTechniques: ["T1595", "T1190"],
        detectionRuleIds: [],
        requiresThreatIntel: false,
        requiresEveryRequestTurnedAway: true,
      },
    },
    {
      kind: SecurityAutomaticResponsePolicyKind.PasswordGuessing,
      name: translationKey("Password Guessing"),
      description: translationKey(
        "Blocks an address that tries password after password against your sign-in: brute force and password spraying.",
      ),
      blockAction: SecurityBlockAction.Block,
      duration: SecurityBlockDuration.OneHour,
      match: {
        mitreTechniques: ["T1110"],
        detectionRuleIds: [],
        requiresThreatIntel: false,
        requiresEveryRequestTurnedAway: false,
      },
    },
    {
      kind: SecurityAutomaticResponsePolicyKind.KnownBadAddresses,
      name: translationKey("Known-Bad Addresses"),
      description: translationKey(
        "Blocks an address your threat intel lists as malicious, as soon as a detection is about it.",
      ),
      blockAction: SecurityBlockAction.Block,
      duration: SecurityBlockDuration.OneDay,
      match: {
        mitreTechniques: [],
        detectionRuleIds: [],
        requiresThreatIntel: true,
        requiresEveryRequestTurnedAway: false,
      },
    },
  ];

// A ready policy's definition, by its kind.
export function getReadySecurityAutomaticResponsePolicy(
  kind: unknown,
): SecurityAutomaticResponsePolicyDefinition | undefined {
  return SECURITY_AUTOMATIC_RESPONSE_READY_POLICIES.find(
    (policy: SecurityAutomaticResponsePolicyDefinition): boolean => {
      return policy.kind === kind;
    },
  );
}

// What the blank policy starts as: blocks for an hour, matching nothing until it is told what.
export const SECURITY_AUTOMATIC_RESPONSE_BLANK_MATCH: SecurityAutomaticResponseMatch =
  {
    mitreTechniques: [],
    detectionRuleIds: [],
    requiresThreatIntel: false,
    requiresEveryRequestTurnedAway: false,
  };

function readStringList(value: JSONValue | undefined, max: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const kept: Array<string> = [];

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const text: string = item.trim();

    if (text && !kept.includes(text)) {
      kept.push(text);
    }

    if (kept.length >= max) {
      break;
    }
  }

  return kept;
}

// An ATT&CK technique or sub-technique id: T1110, T1110.003.
const MITRE_TECHNIQUE_ID: RegExp = /^T\d{4}(\.\d{3})?$/;

// An ATT&CK technique id as policies keep it: "T1110" or "T1110.003", in capitals.
export function readMitreTechniqueId(value: unknown): string | null {
  const text: string =
    typeof value === "string" ? value.trim().toUpperCase() : "";

  return MITRE_TECHNIQUE_ID.test(text) ? text : null;
}

// What a policy matches, read as stored: anything it cannot read matches nothing more.
export function readSecurityAutomaticResponseMatch(
  value: unknown,
): SecurityAutomaticResponseMatch {
  const record: JSONObject =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as JSONObject)
      : {};

  // Each technique once, however it was written.
  const techniques: Array<string> = Array.from(
    new Set(
      readStringList(
        record["mitreTechniques"],
        SECURITY_AUTOMATIC_RESPONSE_MAX_TECHNIQUES,
      )
        .map((item: string): string | null => {
          return readMitreTechniqueId(item);
        })
        .filter((item: string | null): item is string => {
          return Boolean(item);
        }),
    ),
  );

  return {
    mitreTechniques: techniques,
    detectionRuleIds: readStringList(
      record["detectionRuleIds"],
      SECURITY_AUTOMATIC_RESPONSE_MAX_RULES,
    ),
    requiresThreatIntel: record["requiresThreatIntel"] === true,
    requiresEveryRequestTurnedAway:
      record["requiresEveryRequestTurnedAway"] === true,
  };
}

// Whether a policy names anything a detection must be: a technique, a rule or threat intel.
export function doesSecurityAutomaticResponseMatchNameAnything(
  match: SecurityAutomaticResponseMatch,
): boolean {
  return (
    match.mitreTechniques.length > 0 ||
    match.detectionRuleIds.length > 0 ||
    match.requiresThreatIntel
  );
}

export const SECURITY_AUTOMATIC_RESPONSE_MESSAGES: {
  matchNamesNothing: string;
  readyPolicyFixed: string;
  notADuration: string;
  notAnAction: string;
  turnOnTakesAdmin: string;
  nameRequired: string;
} = {
  matchNamesNothing:
    "Choose what the policy acts on: at least one ATT&CK technique, one detection rule, or addresses your threat intel lists.",
  readyPolicyFixed:
    "A ready policy is switched on as it is. To act on something else, or for another length, create a policy from the blank one.",
  notADuration:
    "Choose how long the policy's first block lasts: 1 hour, 24 hours or 7 days.",
  notAnAction: "Choose Block or Challenge.",
  turnOnTakesAdmin:
    "Only a Security Admin, a Project Admin or a Project Owner can turn an automatic response policy on: its blocks need nobody's approval.",
  nameRequired: "Name the policy.",
};

// ---------- The trial run ----------

// A policy as its trial reads it.
export interface SecurityAutomaticResponseTrialShape {
  mode?: SecurityAutomaticResponseMode | string | null | undefined;
  trialStartedAt?: Date | string | null | undefined;
  trialEndsAt?: Date | string | null | undefined;
  trialFinishedAt?: Date | string | null | undefined;
  trialSkippedAt?: Date | string | null | undefined;
}

export enum SecurityAutomaticResponseTrialState {
  // Never started: the policy is off and never ran a trial.
  NotStarted = "NotStarted",
  // Recording what it would do, until trialEndsAt.
  Running = "Running",
  // Ran its whole week: it has a summary, and asks to be turned on.
  Finished = "Finished",
  // Turned on before a week of trial run: a Security Admin skipped it.
  Skipped = "Skipped",
  // Turned off before its week was up: the next trial starts over.
  Stopped = "Stopped",
}

function readTime(value: Date | string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const time: number = new Date(value).getTime();

  return Number.isFinite(time) ? time : null;
}

/*
 * Whether a policy has finished its trial run: a whole week of recording
 * what it would have done. A trial it is still in finishes once its week is
 * up, even before anyone turns it on; a trial skipped, or stopped before its
 * week was up, never finished. Turning a policy off after its trial keeps it
 * finished: the week it ran is still what it would have done.
 */
export function hasSecurityAutomaticResponseTrialFinished(
  policy: SecurityAutomaticResponseTrialShape,
  now: Date,
): boolean {
  if (readTime(policy.trialFinishedAt) !== null) {
    return true;
  }

  const endsAt: number | null = readTime(policy.trialEndsAt);

  return (
    policy.mode === SecurityAutomaticResponseMode.TrialRun &&
    endsAt !== null &&
    endsAt <= now.getTime()
  );
}

// Where a policy's trial run stands.
export function getSecurityAutomaticResponseTrialState(
  policy: SecurityAutomaticResponseTrialShape,
  now: Date,
): SecurityAutomaticResponseTrialState {
  if (hasSecurityAutomaticResponseTrialFinished(policy, now)) {
    return SecurityAutomaticResponseTrialState.Finished;
  }

  if (policy.mode === SecurityAutomaticResponseMode.TrialRun) {
    return SecurityAutomaticResponseTrialState.Running;
  }

  if (policy.mode === SecurityAutomaticResponseMode.On) {
    return SecurityAutomaticResponseTrialState.Skipped;
  }

  return readTime(policy.trialStartedAt) !== null
    ? SecurityAutomaticResponseTrialState.Stopped
    : SecurityAutomaticResponseTrialState.NotStarted;
}

// The whole days left of a trial run still running: 0 once it is up.
export function getSecurityAutomaticResponseTrialDaysLeft(
  policy: SecurityAutomaticResponseTrialShape,
  now: Date,
): number {
  const endsAt: number | null = readTime(policy.trialEndsAt);

  if (endsAt === null) {
    return 0;
  }

  return Math.max(0, Math.ceil((endsAt - now.getTime()) / DAY_IN_MS));
}

// ---------- A policy as it runs ----------

// A stored policy, as the definition below reads it.
export interface SecurityAutomaticResponsePolicyRecord {
  kind?: SecurityAutomaticResponsePolicyKind | string | null | undefined;
  name?: string | null | undefined;
  description?: string | null | undefined;
  blockAction?: SecurityBlockAction | string | null | undefined;
  duration?: SecurityBlockDuration | string | null | undefined;
  matchConditions?: unknown;
}

/*
 * What a policy matches, does and for how long, as it runs: a ready
 * policy's own, from this file - so a ready policy improved here is
 * improved for every project - and a project's own from its columns, with
 * what cannot be read as the blank policy's.
 */
export function readSecurityAutomaticResponsePolicyDefinition(
  policy: SecurityAutomaticResponsePolicyRecord,
): SecurityAutomaticResponsePolicyDefinition {
  const ready: SecurityAutomaticResponsePolicyDefinition | undefined =
    getReadySecurityAutomaticResponsePolicy(policy.kind);

  if (ready) {
    return ready;
  }

  return {
    kind: SecurityAutomaticResponsePolicyKind.Custom,
    name: (policy.name || "").trim(),
    description: (policy.description || "").trim(),
    blockAction:
      policy.blockAction === SecurityBlockAction.Challenge
        ? SecurityBlockAction.Challenge
        : SecurityBlockAction.Block,
    duration: isSecurityAutomaticResponseDuration(policy.duration)
      ? policy.duration
      : SecurityBlockDuration.OneHour,
    match: readSecurityAutomaticResponseMatch(policy.matchConditions),
  };
}
