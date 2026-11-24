import SecurityDetectionSource from "../SecurityCase/SecurityDetectionSource";
import SecurityEventRequestOutcome from "../SecurityEvent/SecurityEventRequestOutcome";
import {
  SecurityBlockValue,
  readSecurityBlockValue,
} from "../SecurityBlocklist/SecurityBlock";
import { SecurityAutomaticResponseMatch } from "./SecurityAutomaticResponsePolicy";
import NetworkAddressBlockUtil from "../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  SecurityAddressScope,
  getSecurityAddressScope,
} from "../../Utils/SecurityCase/SecurityConnectionMatch";

/*
 * WHETHER A POLICY ACTS ON A DETECTION (#10350), and on which address.
 *
 * A policy acts on the address a detection is about - the value its source
 * grouped it on (a rule's Group By Field: the client address for every web
 * attack and password guessing rule OneUptime ships; a threat intel feed's
 * indicator) - and only a public one: a private address is one of the
 * project's own networks', and the blocklist never takes it anyway. A
 * detection about a user, or about several values at once, has no address
 * to act on.
 *
 * Then what the policy matches (SecurityAutomaticResponseMatch):
 *
 *   - its ATT&CK techniques, a technique matching its sub-techniques, or
 *     its detection rules - either one;
 *   - threat intel listing the address: a threat intel detection about it,
 *     or one of the project's feeds listing it;
 *   - every request turned away: every request the detection matched so far
 *     has an outcome, and every outcome is Rejected (4xx). One that reached
 *     a handler, broke something or reached the database is no longer noise
 *     for a policy to wave off: it is for a person. A request whose outcome
 *     OneUptime could not follow says nothing either way, so it is not
 *     taken as turned away.
 *
 * A setup test's detection never: nobody is contained over a test.
 *
 * Pure, so the same rule screens a detection as it is recorded and decides
 * once its facts are all read.
 */

// Why a policy does not act on a detection.
export enum SecurityAutomaticResponseMismatch {
  SetupTest = "SetupTest",
  NoAddress = "NoAddress",
  NotPublic = "NotPublic",
  // The requests only claimed the address (#10416): nothing verified it was theirs.
  OnlyClaimed = "OnlyClaimed",
  NotItsDetection = "NotItsDetection",
  NotListed = "NotListed",
  RequestsGotThrough = "RequestsGotThrough",
  OutcomesUnknown = "OutcomesUnknown",
}

// A detection as a policy reads it.
export interface SecurityAutomaticResponseDetectionFacts {
  source: SecurityDetectionSource | string;
  detectionRuleId?: string | null | undefined;
  mitreTechniques: ReadonlyArray<string>;
  // The value its source grouped it on.
  groupValue?: string | null | undefined;
  /*
   * How many of the requests it matched so far took each outcome
   * (SecurityEventRequestOutcome; "" for those whose outcome is unknown).
   * Left out: none were read.
   */
  outcomes?: Record<string, number> | null | undefined;
  /*
   * Whether threat intel lists the address: true or false once read, null
   * while it is still to be read (as a detection is screened), which no
   * policy is held back by yet.
   */
  isThreatIntelListed: boolean | null;
  /*
   * The verified client addresses (principalIp) of the events the
   * detection kept, as blocks are written. A rule's detection whose kept
   * events never name the address as theirs grouped on something its
   * requests only claimed. Left out, or empty: none were kept to say.
   */
  principalAddresses?: ReadonlyArray<string> | null | undefined;
  isSetupTest?: boolean | undefined;
}

export type SecurityAutomaticResponseMatchResult =
  | { matches: true; address: string }
  | { matches: false; reason: SecurityAutomaticResponseMismatch };

/*
 * The public address a detection is about, as blocks are written, or why
 * it has none: its group value is no single address, or not a public one.
 */
export function getSecurityAutomaticResponseAddress(
  groupValue: string | null | undefined,
):
  | { address: string }
  | {
      reason:
        | SecurityAutomaticResponseMismatch.NoAddress
        | SecurityAutomaticResponseMismatch.NotPublic;
    } {
  const read: SecurityBlockValue | null = readSecurityBlockValue(
    (groupValue || "").trim(),
  );

  if (!read || !NetworkAddressBlockUtil.isSingleAddress(read.block)) {
    return { reason: SecurityAutomaticResponseMismatch.NoAddress };
  }

  if (getSecurityAddressScope(read.value) !== SecurityAddressScope.Public) {
    return { reason: SecurityAutomaticResponseMismatch.NotPublic };
  }

  return { address: read.value };
}

// Whether a detection carries one of a policy's techniques: T1110 matches T1110 and T1110.003.
export function doesSecurityTechniqueMatch(data: {
  policyTechniques: ReadonlyArray<string>;
  detectionTechniques: ReadonlyArray<string>;
}): boolean {
  return data.detectionTechniques.some((technique: string): boolean => {
    const id: string = technique.trim().toUpperCase();

    return data.policyTechniques.some((wanted: string): boolean => {
      const policyId: string = wanted.trim().toUpperCase();

      return (
        Boolean(policyId) && (id === policyId || id.startsWith(`${policyId}.`))
      );
    });
  });
}

/*
 * Whether every request a detection matched so far was turned away: true
 * when each has an outcome and every outcome is Rejected; false when one
 * got further; null when OneUptime cannot tell - none read, or one whose
 * outcome it could not follow.
 */
export function wasEveryRequestTurnedAway(
  outcomes: Record<string, number> | null | undefined,
): boolean | null {
  if (!outcomes) {
    return null;
  }

  let rejected: number = 0;
  let unknown: number = 0;

  for (const [outcome, count] of Object.entries(outcomes)) {
    const requests: number = Number.isFinite(count) ? Math.max(0, count) : 0;

    if (requests === 0) {
      continue;
    }

    if (outcome === SecurityEventRequestOutcome.Rejected) {
      rejected += requests;
    } else if (
      outcome === SecurityEventRequestOutcome.ReachedApp ||
      outcome === SecurityEventRequestOutcome.Errored ||
      outcome === SecurityEventRequestOutcome.ReachedDatabase
    ) {
      return false;
    } else {
      unknown += requests;
    }
  }

  if (unknown > 0 || rejected === 0) {
    return null;
  }

  return true;
}

// Whether a policy acts on a detection, and on which address.
export function matchSecurityAutomaticResponseDetection(data: {
  match: SecurityAutomaticResponseMatch;
  facts: SecurityAutomaticResponseDetectionFacts;
}): SecurityAutomaticResponseMatchResult {
  const { match, facts } = data;

  if (facts.isSetupTest) {
    return {
      matches: false,
      reason: SecurityAutomaticResponseMismatch.SetupTest,
    };
  }

  const address:
    | { address: string }
    | {
        reason:
          | SecurityAutomaticResponseMismatch.NoAddress
          | SecurityAutomaticResponseMismatch.NotPublic;
      } = getSecurityAutomaticResponseAddress(facts.groupValue);

  if (!("address" in address)) {
    return { matches: false, reason: address.reason };
  }

  if (
    facts.source !== SecurityDetectionSource.ThreatIntel &&
    facts.principalAddresses &&
    facts.principalAddresses.length > 0 &&
    !facts.principalAddresses.includes(address.address)
  ) {
    return {
      matches: false,
      reason: SecurityAutomaticResponseMismatch.OnlyClaimed,
    };
  }

  const namesDetections: boolean =
    match.mitreTechniques.length > 0 || match.detectionRuleIds.length > 0;

  if (namesDetections) {
    const isItsDetection: boolean =
      doesSecurityTechniqueMatch({
        policyTechniques: match.mitreTechniques,
        detectionTechniques: facts.mitreTechniques,
      }) ||
      Boolean(
        facts.detectionRuleId &&
          match.detectionRuleIds.includes(facts.detectionRuleId),
      );

    if (!isItsDetection) {
      return {
        matches: false,
        reason: SecurityAutomaticResponseMismatch.NotItsDetection,
      };
    }
  }

  // A detection with nothing to say which it is matches only a policy that waits for threat intel.
  if (!namesDetections && !match.requiresThreatIntel) {
    return {
      matches: false,
      reason: SecurityAutomaticResponseMismatch.NotItsDetection,
    };
  }

  if (match.requiresThreatIntel && facts.isThreatIntelListed === false) {
    return {
      matches: false,
      reason: SecurityAutomaticResponseMismatch.NotListed,
    };
  }

  if (match.requiresEveryRequestTurnedAway) {
    const turnedAway: boolean | null = wasEveryRequestTurnedAway(
      facts.outcomes,
    );

    if (turnedAway === false) {
      return {
        matches: false,
        reason: SecurityAutomaticResponseMismatch.RequestsGotThrough,
      };
    }

    if (turnedAway === null) {
      return {
        matches: false,
        reason: SecurityAutomaticResponseMismatch.OutcomesUnknown,
      };
    }
  }

  return { matches: true, address: address.address };
}

/*
 * Whether threat intel lists a detection's address without reading a feed:
 * a threat intel detection is about the indicator it matched. Null when only
 * the project's feeds can say.
 */
export function isListedByThreatIntelDetection(
  facts: Pick<SecurityAutomaticResponseDetectionFacts, "source">,
): boolean | null {
  return facts.source === SecurityDetectionSource.ThreatIntel ? true : null;
}
