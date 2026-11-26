import { combineScrubRuleProofs } from "./TelemetryScrubProof";
import {
  getScrubRuleFingerprint,
  ScrubRuleProof,
} from "../../../../Types/Telemetry/ScrubRuleProof";
import {
  doesScrubRuleKeyName,
  toComparedScrubRuleKey,
} from "../../../../Types/Telemetry/ScrubRuleKeys";

/*
 * ONE RULE FOR SEVERAL PLACES, WHERE ONE RULE DOES WHAT EACH WOULD (#10366).
 *
 * A telemetry issue's places each get their own proven rule
 * (TelemetryScrubIt): a password under db.password and a token under
 * api_key would be two Named Attributes rules of the same service. Two
 * rules are one where they hide the same way in the same records - the
 * same pattern, action, parts and service - and differ only in the
 * attributes they name: the rule that names both does at each place
 * exactly what that place's own rule did, so their proofs add up to the
 * merged rule's (its fingerprint, every place, every count).
 *
 * Attributes that overlap - db and db.password - are never merged: a key
 * that names another's parents reaches values the other's proof never
 * read.
 */

// A planned rule as merging reads it: what decides what it hides, and where.
export interface MergeableScrubRule {
  signal: "log" | "trace";
  patternType: string;
  customRegex?: string | undefined;
  attributeKeys?: Array<string> | undefined;
  scrubAction: string;
  fieldsToScrub: string;
  // The service it is for: a rule is merged only with another of the same.
  serviceId: string | null;
}

function keysOf(rule: MergeableScrubRule): Array<string> {
  return rule.attributeKeys || [];
}

// Whether any key of one reaches into the other's, or the other's into it - but is not the same.
function doKeysOverlap(
  keys: ReadonlyArray<string>,
  others: ReadonlyArray<string>,
): boolean {
  return keys.some((key: string): boolean => {
    return others.some((other: string): boolean => {
      if (toComparedScrubRuleKey(key) === toComparedScrubRuleKey(other)) {
        return false;
      }

      return (
        doesScrubRuleKeyName(key, other) || doesScrubRuleKeyName(other, key)
      );
    });
  });
}

/*
 * Whether two planned rules may be one: the same pattern, action, parts
 * and service, and either the same reach (no keys, or the same keys) or
 * keys that do not overlap. A rule that reads every attribute is merged
 * only with the very same rule.
 */
export function canMergeScrubRules(
  a: MergeableScrubRule,
  b: MergeableScrubRule,
): boolean {
  if (
    a.signal !== b.signal ||
    a.patternType !== b.patternType ||
    (a.customRegex || "") !== (b.customRegex || "") ||
    a.scrubAction !== b.scrubAction ||
    a.fieldsToScrub !== b.fieldsToScrub ||
    (a.serviceId || "").toLowerCase() !== (b.serviceId || "").toLowerCase()
  ) {
    return false;
  }

  const aKeys: Array<string> = keysOf(a);
  const bKeys: Array<string> = keysOf(b);

  // Every attribute, both: the same rule. One of them only some: another reach.
  if (aKeys.length === 0 || bKeys.length === 0) {
    return aKeys.length === 0 && bKeys.length === 0;
  }

  return !doKeysOverlap(aKeys, bKeys);
}

// The keys of two rules that merge: both, each once, in the order they came.
export function mergeScrubRuleKeys(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): Array<string> {
  const merged: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const key of [...a, ...b]) {
    const compared: string = toComparedScrubRuleKey(key);

    if (!compared || seen.has(compared)) {
      continue;
    }

    seen.add(compared);
    merged.push(key);
  }

  return merged;
}

/*
 * The proofs of the rules that merged, as the merged rule's: every place
 * and count, under its own fingerprint. Null unless every one was proven:
 * a merged rule is proven for all its places, or for none.
 */
export function mergeScrubRuleProofs(data: {
  rule: MergeableScrubRule;
  proofs: ReadonlyArray<ScrubRuleProof | null>;
  now: Date;
}): ScrubRuleProof | null {
  if (
    data.proofs.length === 0 ||
    data.proofs.some((proof: ScrubRuleProof | null): boolean => {
      return !proof;
    })
  ) {
    return null;
  }

  return combineScrubRuleProofs(
    data.proofs as ReadonlyArray<ScrubRuleProof>,
    getScrubRuleFingerprint({
      signal: data.rule.signal,
      patternType: data.rule.patternType,
      customRegex: data.rule.customRegex,
      attributeKeys: data.rule.attributeKeys,
      scrubAction: data.rule.scrubAction,
      fieldsToScrub: data.rule.fieldsToScrub,
      serviceId: data.rule.serviceId,
    }),
    data.now,
  );
}
