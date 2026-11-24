import { sha256Hex } from "../AutoRemediation/RemediationPlanFingerprint";
import { JSONObject, JSONValue } from "../JSON";
import { translationKey } from "../Translator";
import { toStableJsonText } from "./DataSecurityAi";

/*
 * ONEUPTIME AI'S VERDICT ON A FINDING THAT WAITS FOR A PERSON (#10372), WITH
 * THE TEAM'S OWN DECISIONS AS PRECEDENT.
 *
 * A Low finding, one of OneUptime AI's suggestions, or a Medium or High one
 * with a sign it matched wrongly (Utils/DataSecurity/FindingJudgement)
 * waits for someone to Confirm it or mark it Not Sensitive. On a busy
 * project nobody does, and a decision made on one store - "this column of
 * Luhn-valid numbers is order numbers" - has to be made again on the next.
 *
 * So OneUptime AI answers each one - Confirm, Not sensitive or Cannot
 * tell, with a reason in the project's language - from the finding's own
 * facts, its store's, and precedent: the project's earlier decisions on
 * findings of the same data type at locations named alike, with the
 * reasons people gave, each cited by the verdict. Names, shapes and counts
 * only, never a value (DataSecurityAiInput). Its verdict is a proposal:
 *
 *   - Not sensitive is never applied by OneUptime AI, under any rule: a
 *     leak marked as noise is a leak nobody looks at again. A person marks
 *     it, with their own reason - the dialog starts from OneUptime AI's
 *     draft, which they can change.
 *   - Confirm is applied on its own only where a Data Security AI rule sets
 *     Judge to Without asking: confirming raises a store's sensitivity and
 *     the severity of its issues. Then it is a proposal made without asking
 *     (ConfirmFindings), on the store's timeline, undone with one press.
 *
 * The verdict waits on the finding's own row, not in Data Security > AI: a
 * busy project's hundreds of Low findings would bury the inbox they are
 * noise in.
 *
 * Stored on the finding (DataStoreFinding.aiVerdict, aiVerdictAnalysis);
 * its input's hash is kept with it, so a scan that changed nothing it was
 * written from makes no model call. Pure, so the server and the Dashboard
 * read it alike. Stored strings are a contract: never rename one.
 */

export enum DataStoreFindingVerdict {
  // Real data of the type: a person confirms it, and it counts.
  Confirm = "Confirm",
  // What the scan found is not that data: a person marks it Not Sensitive.
  NotSensitive = "NotSensitive",
  // The facts and the team's decisions do not say.
  CannotTell = "CannotTell",
}

// In the order the row and the filter list them.
export const DATA_STORE_FINDING_VERDICTS: ReadonlyArray<DataStoreFindingVerdict> =
  [
    DataStoreFindingVerdict.Confirm,
    DataStoreFindingVerdict.NotSensitive,
    DataStoreFindingVerdict.CannotTell,
  ];

export function isDataStoreFindingVerdict(
  value: unknown,
): value is DataStoreFindingVerdict {
  return (
    typeof value === "string" &&
    (DATA_STORE_FINDING_VERDICTS as ReadonlyArray<string>).includes(value)
  );
}

// What each verdict is called on a finding's row and in its filter.
export const DATA_STORE_FINDING_VERDICT_TITLES: Readonly<
  Record<DataStoreFindingVerdict, string>
> = {
  [DataStoreFindingVerdict.Confirm]: translationKey("Confirm it"),
  [DataStoreFindingVerdict.NotSensitive]: translationKey("Not sensitive"),
  [DataStoreFindingVerdict.CannotTell]: translationKey("Cannot tell"),
};

/*
 * A decision a person made on a finding: what precedent is. OneUptime AI's
 * own confirmations (isConfirmedByAi) are never precedent, so its verdicts
 * never rest on its own earlier ones.
 */
export enum DataStoreFindingDecision {
  NotSensitive = "NotSensitive",
  Confirmed = "Confirmed",
}

export function isDataStoreFindingDecision(
  value: unknown,
): value is DataStoreFindingDecision {
  return (
    value === DataStoreFindingDecision.NotSensitive ||
    value === DataStoreFindingDecision.Confirmed
  );
}

/*
 * What a person decided about a finding, or null when nobody did. A
 * finding confirmed and then marked not sensitive no longer counts: it is
 * not sensitive. OneUptime AI's own confirmation is nobody's decision.
 */
export function getPersonDecision(finding: {
  isSuppressed?: boolean | null | undefined;
  isConfirmed?: boolean | null | undefined;
  isConfirmedByAi?: boolean | null | undefined;
}): DataStoreFindingDecision | null {
  if (finding.isSuppressed === true) {
    return DataStoreFindingDecision.NotSensitive;
  }

  if (finding.isConfirmed === true && finding.isConfirmedByAi !== true) {
    return DataStoreFindingDecision.Confirmed;
  }

  return null;
}

/*
 * A sign that a Medium or High finding matched wrongly, which makes it
 * wait for a person as a Low one does (FindingJudgement.getWrongMatchSigns).
 * Stored with a verdict: never rename one.
 */
export enum FindingWrongMatchSign {
  // More of the matches were well-known test values than real ones.
  MostlyTestValues = "MostlyTestValues",
  // The field's name points at another data type, and not at this one.
  NamePointsElsewhere = "NamePointsElsewhere",
  // An id-like field - order_number, ref_id - holds a Luhn-checked type its name does not point at.
  IdFieldWithLuhnNumbers = "IdFieldWithLuhnNumbers",
}

export const FINDING_WRONG_MATCH_SIGNS: ReadonlyArray<FindingWrongMatchSign> = [
  FindingWrongMatchSign.MostlyTestValues,
  FindingWrongMatchSign.NamePointsElsewhere,
  FindingWrongMatchSign.IdFieldWithLuhnNumbers,
];

export function isFindingWrongMatchSign(
  value: unknown,
): value is FindingWrongMatchSign {
  return (
    typeof value === "string" &&
    (FINDING_WRONG_MATCH_SIGNS as ReadonlyArray<string>).includes(value)
  );
}

// What each sign is called, under a verdict that rests on it.
export const FINDING_WRONG_MATCH_SIGN_TITLES: Readonly<
  Record<FindingWrongMatchSign, string>
> = {
  [FindingWrongMatchSign.MostlyTestValues]: translationKey(
    "Most of its matches are test values",
  ),
  [FindingWrongMatchSign.NamePointsElsewhere]: translationKey(
    "Its field's name points at another data type",
  ),
  [FindingWrongMatchSign.IdFieldWithLuhnNumbers]: translationKey(
    "An id field holding numbers that pass the Luhn check",
  ),
};

/*
 * One earlier decision a verdict cites: the finding it was made on (of the
 * same data type), its store and location, what the person decided and
 * the reason they gave - as they wrote it, for the readers of findings,
 * who read it on that finding anyway. `isSameName` says it was found by
 * the field's name (FindingJudgement.getFindingNameKey); otherwise
 * MeaningSearch ranked it as a name like it. The store is named by its id
 * only: the page reads its name with the reader's own permissions.
 */
export interface DataStoreFindingPrecedent {
  findingId: string;
  dataStoreId: string;
  location: string;
  decision: DataStoreFindingDecision;
  reason: string;
  isSameName: boolean;
  decidedAt?: string | undefined;
}

/*
 * A verdict as the finding keeps it: what OneUptime AI answered, held to
 * its facts (holdFindingVerdictToFacts), with the precedent it cites and
 * the signs it was judged with, in the language it wrote in.
 */
export interface DataStoreFindingVerdictRecord {
  version: number;
  verdict: DataStoreFindingVerdict;
  // Why, in a sentence or two of the project's language.
  reason: string;
  /*
   * For Not sensitive: the reason a person could give, in a sentence -
   * what the Not Sensitive dialog starts from. "" otherwise.
   */
  draft: string;
  // The earlier decisions it cites, at most MAX_FINDING_PRECEDENT.
  precedent: Array<DataStoreFindingPrecedent>;
  signs: Array<FindingWrongMatchSign>;
  language: string;
  writtenAt: string;
}

export const DATA_STORE_FINDING_VERDICT_VERSION: number = 1;

export const DATA_STORE_FINDING_VERDICT_LIMITS: {
  // The most precedent a verdict is told, and cites.
  maxPrecedent: number;
  // The most of a verdict's reason, and of its draft, that is kept.
  maxReasonLength: number;
  // The most of a person's reason a precedent keeps, and tells OneUptime AI.
  maxPrecedentReasonLength: number;
  // The most of a location a precedent keeps.
  maxLocationLength: number;
} = {
  maxPrecedent: 10,
  maxReasonLength: 400,
  maxPrecedentReasonLength: 300,
  maxLocationLength: 500,
};

function readText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function readPrecedent(value: unknown): DataStoreFindingPrecedent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const entry: JSONObject = value as JSONObject;
  const findingId: string = readText(entry["findingId"], 64);
  const dataStoreId: string = readText(entry["dataStoreId"], 64);
  const decision: unknown = entry["decision"];

  if (!findingId || !dataStoreId || !isDataStoreFindingDecision(decision)) {
    return null;
  }

  const decidedAt: string = readText(entry["decidedAt"], 40);

  return {
    findingId,
    dataStoreId,
    location: readText(
      entry["location"],
      DATA_STORE_FINDING_VERDICT_LIMITS.maxLocationLength,
    ),
    decision,
    reason: readText(
      entry["reason"],
      DATA_STORE_FINDING_VERDICT_LIMITS.maxPrecedentReasonLength,
    ),
    isSameName: entry["isSameName"] === true,
    ...(decidedAt ? { decidedAt } : {}),
  };
}

/*
 * A verdict as stored, read back: null for anything that is not one - a
 * value no build of OneUptime wrote reads as no verdict, never as a wider
 * one.
 */
export function readDataStoreFindingVerdictRecord(
  value: unknown,
): DataStoreFindingVerdictRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: JSONObject = value as JSONObject;
  const verdict: unknown = record["verdict"];

  if (!isDataStoreFindingVerdict(verdict)) {
    return null;
  }

  const precedent: Array<DataStoreFindingPrecedent> = Array.isArray(
    record["precedent"],
  )
    ? (record["precedent"] as Array<unknown>)
        .map(readPrecedent)
        .filter(
          (
            entry: DataStoreFindingPrecedent | null,
          ): entry is DataStoreFindingPrecedent => {
            return entry !== null;
          },
        )
        .slice(0, DATA_STORE_FINDING_VERDICT_LIMITS.maxPrecedent)
    : [];
  const signs: Array<FindingWrongMatchSign> = Array.isArray(record["signs"])
    ? (record["signs"] as Array<unknown>).filter(isFindingWrongMatchSign)
    : [];

  return {
    version:
      typeof record["version"] === "number"
        ? record["version"]
        : DATA_STORE_FINDING_VERDICT_VERSION,
    verdict,
    reason: readText(
      record["reason"],
      DATA_STORE_FINDING_VERDICT_LIMITS.maxReasonLength,
    ),
    // Only Not sensitive drafts a reason a person could give.
    draft:
      verdict === DataStoreFindingVerdict.NotSensitive
        ? readText(
            record["draft"],
            DATA_STORE_FINDING_VERDICT_LIMITS.maxReasonLength,
          )
        : "",
    precedent,
    signs,
    language: readText(record["language"], 20),
    writtenAt: readText(record["writtenAt"], 40),
  };
}

// A verdict as the finding stores it.
export function toDataStoreFindingVerdictJson(
  record: DataStoreFindingVerdictRecord,
): JSONObject {
  return JSON.parse(JSON.stringify(record)) as JSONObject;
}

/*
 * What a verdict was written from, in sixty-four hex digits: the data
 * OneUptime AI is sent about the finding - its facts in buckets, the
 * precedent it is told - the language it writes in, and the version of
 * what it is asked. A scan whose finding hashes the same as the verdict it
 * keeps makes no model call.
 */
export function getFindingVerdictInputHash(data: {
  data: JSONValue;
  language: string;
  version?: number | undefined;
}): string {
  return sha256Hex(
    toStableJsonText({
      version: data.version ?? DATA_STORE_FINDING_VERDICT_VERSION,
      language: data.language,
      data: data.data,
    }),
  );
}

export const FINDING_VERDICT_INPUT_HASH_PATTERN: RegExp = /^[0-9a-f]{64}$/;
