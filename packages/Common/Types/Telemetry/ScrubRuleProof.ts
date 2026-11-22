import { sha256Hex } from "../AutoRemediation/RemediationPlanFingerprint";
import LogScrubPatternType from "../Log/LogScrubPatternType";
import { readScopeId } from "./ScrubRuleScope";
import { readScrubRuleKeys, toComparedScrubRuleKey } from "./ScrubRuleKeys";

/*
 * A SCRUB RULE PROVEN ON THE VERY RECORDS A FINDING WAS SEEN IN (#10366).
 *
 * Before OneUptime offers a rule for a finding - or makes one on its own -
 * plain code with no model in it (Server/Utils/DataSecurity/Telemetry/
 * TelemetryScrubProof) reads the records the finding was seen in and the
 * newest records of the same service and place, runs the rule through the
 * code ingest runs, and asks the scanner what is left:
 *
 *  - it covers the finding when the data type is no longer found in any
 *    value at the place that held it;
 *  - it overreaches by the share of the other values at the place - those
 *    that never held the type - that it changes.
 *
 * The proof is kept with the rule (LogScrubRule.proof): the places it was
 * proven for, what was read and what came of it, and the rule as it was
 * when it was proven (its fingerprint). A rule that carries a proof covers
 * those places, custom pattern or not - for as long as the rule is still
 * the rule that was proven: change its pattern, its keys, its action, its
 * fields or its service, and the proof no longer counts.
 *
 * Only OneUptime writes a proof (the column takes no person's write): a
 * proof a person could type would be a leak nobody looks at.
 */

export const SCRUB_RULE_PROOF_VERSION: number = 1;

/*
 * The overreach a rule may have on the sample: none to run on its own, up
 * to five in a hundred to be offered with a warning. Past that a pattern
 * is not offered; only the rule that names the attribute is.
 */
export const SCRUB_OVERREACH_TO_RUN_ALONE: number = 0;
export const SCRUB_OVERREACH_TO_OFFER: number = 0.05;

// One place the rule was proven for: a finding's data type and location, in a kind of store.
export interface ScrubRuleProofPlace {
  dataTypeId: string;
  location: string;
  // The store's kind (DataStoreKind): the same location means another place in another kind.
  kind: string;
  findingId?: string | undefined;
}

export interface ScrubRuleProof {
  version: number;
  // When it was proven (ISO 8601).
  provenAt: string;
  // The rule as it was proven: getScrubRuleFingerprint.
  fingerprint: string;
  places: Array<ScrubRuleProofPlace>;
  // Records read: the finding's own, kept with it, and in all.
  findingRecordsRead: number;
  recordsRead: number;
  // Values at the place that held the data type, and how many still hold it.
  valuesWithData: number;
  valuesStillWithData: number;
  // Values at the place that never held it, and how many the rule changed.
  otherValues: number;
  otherValuesChanged: number;
}

// A rule as its fingerprint reads it: what decides what it hides, and where.
export interface ScrubRuleFingerprintInput {
  signal: "log" | "trace";
  patternType: string;
  customRegex?: string | null | undefined;
  attributeKeys?: unknown;
  scrubAction?: string | null | undefined;
  fieldsToScrub?: string | null | undefined;
  serviceId?: unknown;
}

const FINGERPRINT_LENGTH: number = 16;

// What a fingerprint looks like: sixteen lower-case hex digits.
const FINGERPRINT_PATTERN: RegExp = /^[0-9a-f]{16}$/;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/*
 * What a rule is, in sixteen hex digits: its signal, pattern, keys (as they
 * are compared), action, fields and service. Two rules that hide the same
 * values in the same records have the same fingerprint.
 */
export function getScrubRuleFingerprint(
  rule: ScrubRuleFingerprintInput,
): string {
  const keys: Array<string> = readScrubRuleKeys(rule.attributeKeys)
    .map((key: string): string => {
      return toComparedScrubRuleKey(key);
    })
    .sort();

  return sha256Hex(
    JSON.stringify([
      rule.signal,
      text(rule.patternType).trim(),
      rule.patternType === LogScrubPatternType.Custom
        ? text(rule.customRegex)
        : "",
      keys,
      text(rule.scrubAction).trim(),
      text(rule.fieldsToScrub).trim(),
      readScopeId(rule.serviceId),
    ]),
  ).slice(0, FINGERPRINT_LENGTH);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : -1;
}

// A proof as stored, read strictly: anything that is not one is no proof.
export function readScrubRuleProof(value: unknown): ScrubRuleProof | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const fingerprint: string = text(raw["fingerprint"]);

  if (
    raw["version"] !== SCRUB_RULE_PROOF_VERSION ||
    !FINGERPRINT_PATTERN.test(fingerprint)
  ) {
    return null;
  }

  const numbers: Array<number> = [
    count(raw["findingRecordsRead"]),
    count(raw["recordsRead"]),
    count(raw["valuesWithData"]),
    count(raw["valuesStillWithData"]),
    count(raw["otherValues"]),
    count(raw["otherValuesChanged"]),
  ];

  if (
    numbers.some((value: number): boolean => {
      return value < 0;
    })
  ) {
    return null;
  }

  const places: Array<ScrubRuleProofPlace> = [];

  for (const item of Array.isArray(raw["places"]) ? raw["places"] : []) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const place: Record<string, unknown> = item as Record<string, unknown>;
    const dataTypeId: string = text(place["dataTypeId"]).trim();
    const location: string = text(place["location"]).trim();
    const kind: string = text(place["kind"]).trim();

    if (!dataTypeId || !location || !kind) {
      continue;
    }

    const read: ScrubRuleProofPlace = { dataTypeId, location, kind };
    const findingId: string = text(place["findingId"]).trim();

    if (findingId) {
      read.findingId = findingId;
    }

    places.push(read);
  }

  return {
    version: SCRUB_RULE_PROOF_VERSION,
    provenAt: text(raw["provenAt"]),
    fingerprint,
    places,
    findingRecordsRead: numbers[0]!,
    recordsRead: numbers[1]!,
    valuesWithData: numbers[2]!,
    valuesStillWithData: numbers[3]!,
    otherValues: numbers[4]!,
    otherValuesChanged: numbers[5]!,
  };
}

// The share of the place's other values the rule changed: none when there were none.
export function getScrubOverreachShare(
  proof: Pick<ScrubRuleProof, "otherValues" | "otherValuesChanged">,
): number {
  return proof.otherValues > 0
    ? proof.otherValuesChanged / proof.otherValues
    : 0;
}

// Whether the rule hid the data type in every value at the place that held it.
export function doesScrubRuleProofHideTheData(
  proof: Pick<ScrubRuleProof, "valuesWithData" | "valuesStillWithData">,
): boolean {
  return proof.valuesWithData > 0 && proof.valuesStillWithData === 0;
}

export enum ScrubOverreach {
  // It changed nothing else at the place: it may run on its own.
  None = "None",
  // A little: offered, with a warning.
  Some = "Some",
  // Too much to offer a pattern.
  TooMuch = "TooMuch",
}

export function getScrubOverreach(share: number): ScrubOverreach {
  if (share <= SCRUB_OVERREACH_TO_RUN_ALONE) {
    return ScrubOverreach.None;
  }

  return share <= SCRUB_OVERREACH_TO_OFFER
    ? ScrubOverreach.Some
    : ScrubOverreach.TooMuch;
}

function counted(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${String(count)} ${many}`;
}

/*
 * A proof in a sentence, as a proposal, the issue's timeline and the
 * owners' email say it: counts only, never a value.
 */
export function describeScrubRuleProof(
  proof: Pick<
    ScrubRuleProof,
    | "recordsRead"
    | "findingRecordsRead"
    | "valuesWithData"
    | "valuesStillWithData"
    | "otherValues"
    | "otherValuesChanged"
  >,
): string {
  const read: string = `${counted(proof.recordsRead, "record", "records")}${
    proof.findingRecordsRead > 0
      ? `, ${String(proof.findingRecordsRead)} of them the finding's own`
      : ""
  }`;
  const hid: string =
    proof.valuesStillWithData === 0
      ? `it hid the data in ${proof.valuesWithData === 1 ? "the 1 value" : `all ${String(proof.valuesWithData)} values`} that held it`
      : `it left the data in ${String(proof.valuesStillWithData)} of the ${counted(proof.valuesWithData, "value", "values")} that held it`;
  let others: string = "there were no other values at its place to change";

  if (proof.otherValues > 0) {
    others =
      proof.otherValuesChanged === 0
        ? `changed none of the ${counted(proof.otherValues, "other value", "other values")} at its place`
        : `also changed ${String(proof.otherValuesChanged)} of the ${counted(proof.otherValues, "other value", "other values")} at its place`;
  }

  return `Proven on ${read}: ${hid}, and ${others}.`;
}

/*
 * Whether a rule's proof covers a place: it is a proof of this very rule
 * (its fingerprint), it hid the data, and the place is one it was proven
 * for.
 */
export function doesScrubRuleProofCover(data: {
  rule: ScrubRuleFingerprintInput;
  proof: unknown;
  place: { dataTypeId: string; location: string; kind: string };
}): boolean {
  const proof: ScrubRuleProof | null = readScrubRuleProof(data.proof);

  if (
    !proof ||
    proof.fingerprint !== getScrubRuleFingerprint(data.rule) ||
    !doesScrubRuleProofHideTheData(proof)
  ) {
    return false;
  }

  return proof.places.some((place: ScrubRuleProofPlace): boolean => {
    return (
      place.dataTypeId === data.place.dataTypeId &&
      place.location === data.place.location &&
      place.kind === data.place.kind
    );
  });
}

// Whether a rule carries a proof of itself as it is now.
export function isScrubRuleProven(data: {
  rule: ScrubRuleFingerprintInput;
  proof: unknown;
}): boolean {
  const proof: ScrubRuleProof | null = readScrubRuleProof(data.proof);

  return Boolean(
    proof &&
      proof.fingerprint === getScrubRuleFingerprint(data.rule) &&
      doesScrubRuleProofHideTheData(proof),
  );
}
