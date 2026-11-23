import crypto from "crypto";
import {
  ProductionReviewLeakJSON,
  ProductionReviewLeakProductionJSON,
  ProductionReviewLeakSuggestionJSON,
  SENSITIVE_DATA_LIMITS,
  SensitiveDataColumn,
  SensitiveDataLeakKind,
  SensitiveDataSink,
} from "../../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import {
  DataSecurityCheckInfo,
  getDataSecurityCheck,
} from "../../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataSensitivity from "../../../../../Types/DataSecurity/DataSensitivity";
import SecuritySeverity from "../../../../../Types/SecuritySeverity";
import { NamedDataType } from "./SensitiveDataNames";

/*
 * ONE THING A SENSITIVE DATA RULE FOUND IN A PULL REQUEST (#10376).
 *
 * The rules (TelemetryWriteRules, InfrastructureRules, MigrationRules)
 * each find candidates in the diff; the section keeps the strongest of
 * them, says what production knows of each (ProductionReviewSensitiveData)
 * and hands them to OneUptime AI to word (ProductionReviewSensitiveDataAI).
 * A candidate holds only what the diff shows - a file, a line, a name -
 * and what OneUptime's own catalogs say of it.
 */

export interface SensitiveDataCandidate {
  kind: SensitiveDataLeakKind;
  checkId: string;
  sink?: SensitiveDataSink | undefined;
  column?: SensitiveDataColumn | undefined;
  path: string;
  // The line of the file after the change, and that line's text.
  line: number;
  lineText: string;
  subject: string;
  where?: string | undefined;
  value?: string | undefined;
  isWholeObject?: boolean | undefined;
  dataTypes: Array<NamedDataType>;
  sensitivity: DataSensitivity;
  isBlocking: boolean;
  // OneUptime's own sentence for the point, and for its fix, in English.
  text: string;
  fix: string;
  suggestion?: ProductionReviewLeakSuggestionJSON | undefined;
  /*
   * Telemetry: where production would keep what the line writes, as a
   * telemetry finding names it - "attributes.user.email", "body".
   */
  location?: string | undefined;
  /*
   * Infrastructure: the resource's type, and the names it is known by in
   * the diff - its bucket's name, its identifier, its label - for the
   * project's store it is (ProductionReviewSensitiveData).
   */
  resourceType?: string | undefined;
  resourceNames?: Array<string> | undefined;
  /*
   * Infrastructure: the sensitivity the store's own data sets, when no
   * store of the project is known for it - unknown, so the rule's own.
   */
  isStoreKnown?: boolean | undefined;
}

/*
 * The severity a candidate's check gives its sensitivity, as Data
 * Security's own issue would have it: Low for one the check would not
 * raise at all.
 */
export function severityOf(
  checkId: string,
  sensitivity: DataSensitivity,
): SecuritySeverity {
  const check: DataSecurityCheckInfo | undefined =
    getDataSecurityCheck(checkId);

  return check?.severityBySensitivity[sensitivity] || SecuritySeverity.Low;
}

const SEVERITY_RANK: Readonly<Record<SecuritySeverity, number>> = {
  [SecuritySeverity.Critical]: 3,
  [SecuritySeverity.High]: 2,
  [SecuritySeverity.Medium]: 1,
  [SecuritySeverity.Low]: 0,
};

export function severityRank(severity: SecuritySeverity): number {
  return SEVERITY_RANK[severity] ?? 0;
}

/*
 * The candidates in the order a review lists them: what can fail the
 * check first, then the most severe, then as the files list them.
 */
export function compareCandidates(
  a: SensitiveDataCandidate,
  b: SensitiveDataCandidate,
): number {
  if (a.isBlocking !== b.isBlocking) {
    return a.isBlocking ? -1 : 1;
  }

  const bySeverity: number =
    severityRank(severityOf(b.checkId, b.sensitivity)) -
    severityRank(severityOf(a.checkId, a.sensitivity));

  if (bySeverity !== 0) {
    return bySeverity;
  }

  return 0;
}

// A line as its key reads it: its words, white space made one.
function normalizedText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/*
 * A candidate as the point a review keeps: its key - the nth candidate of
 * the same key in the review is told apart by `occurrences` - its
 * sensitivity as the diff shows it, its severity and whether it can fail
 * the check as what the project knows decided them (the rule's own when it
 * knows nothing), whether it fails the check, and what production knows of
 * it, set apart. A point's own sensitivity is the diff's alone, so a reader
 * shown the point without production (a public repository's comment,
 * OneUptime AI) learns nothing of a store from it.
 */
export function toLeakPoint(data: {
  candidate: SensitiveDataCandidate;
  // The sensitivity a known store gives it: its severity's.
  knownSensitivity?: DataSensitivity | undefined;
  isBlocking?: boolean | undefined;
  isFailOn: boolean;
  occurrences: Map<string, number>;
  production?: ProductionReviewLeakProductionJSON | undefined;
}): ProductionReviewLeakJSON {
  const candidate: SensitiveDataCandidate = data.candidate;
  const sensitivity: DataSensitivity = candidate.sensitivity;
  const severitySensitivity: DataSensitivity =
    data.knownSensitivity || sensitivity;
  const isBlocking: boolean =
    data.isBlocking !== undefined ? data.isBlocking : candidate.isBlocking;
  const baseKey: string = keyOf(candidate, 0);
  const occurrence: number = data.occurrences.get(baseKey) || 0;

  data.occurrences.set(baseKey, occurrence + 1);

  return {
    key: occurrence === 0 ? baseKey : keyOf(candidate, occurrence),
    kind: candidate.kind,
    checkId: candidate.checkId,
    ...(candidate.sink ? { sink: candidate.sink } : {}),
    ...(candidate.column ? { column: candidate.column } : {}),
    path: candidate.path,
    line: candidate.line,
    subject: candidate.subject,
    ...(candidate.where ? { where: candidate.where } : {}),
    ...(candidate.value ? { value: candidate.value } : {}),
    ...(candidate.isWholeObject ? { isWholeObject: true } : {}),
    dataTypeIds: candidate.dataTypes.map((type: NamedDataType): string => {
      return type.id;
    }),
    dataTypeNames: candidate.dataTypes.map((type: NamedDataType): string => {
      return type.name;
    }),
    sensitivity,
    severity: severityOf(candidate.checkId, severitySensitivity),
    isBlocking,
    failsCheck: data.isFailOn && isBlocking,
    text: candidate.text.slice(0, SENSITIVE_DATA_LIMITS.maxTextLength),
    fix: candidate.fix.slice(0, SENSITIVE_DATA_LIMITS.maxFixLength),
    isAiWorded: false,
    ...(candidate.suggestion ? { suggestion: candidate.suggestion } : {}),
    ...(data.production && Object.keys(data.production).length > 0
      ? { production: data.production }
      : {}),
  };
}

/*
 * A candidate's key: the same leak keeps it across pushes - the file, the
 * check, the name and what it sits in, and which of those it is in the
 * file - so a line moved by an edit above it is the same point. 16 hex
 * characters of a SHA-256.
 */
export function keyOf(
  candidate: Pick<
    SensitiveDataCandidate,
    "path" | "checkId" | "subject" | "where" | "kind"
  >,
  occurrence: number,
): string {
  return crypto
    .createHash("sha256")
    .update(
      [
        candidate.path,
        candidate.kind,
        candidate.checkId,
        normalizedText(candidate.subject),
        normalizedText(candidate.where || ""),
        String(occurrence),
      ].join("\u0000"),
    )
    .digest("hex")
    .slice(0, 16);
}
