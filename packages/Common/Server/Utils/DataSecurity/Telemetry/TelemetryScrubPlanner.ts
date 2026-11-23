import DataCategory from "../../../../Types/DataSecurity/DataCategory";
import {
  DataTypeInfo,
  getBuiltInDataType,
} from "../../../../Types/DataSecurity/DataTypeCatalog";
import { isCustomDataTypeId } from "../../../../Types/DataSecurity/CustomDataTypeId";
import {
  ScrubbedField,
  ScrubTarget,
} from "../../../../Types/DataSecurity/TelemetryScrubTarget";
import LogScrubAction from "../../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../Types/Log/LogScrubPatternType";
import {
  checkScrubRuleCustomRegex,
  DATA_TYPE_OF_SCRUB_PATTERN_TYPE,
  SCRUB_RULE_CUSTOM_PATTERN_TYPE,
  SCRUB_RULE_SENSITIVE_KEYS_PATTERN_TYPE,
} from "../../../../Types/Telemetry/ScrubRule";
import { SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE } from "../../../../Types/Telemetry/ScrubRuleKeys";
import { SecurityEventsTelemetrySource } from "../../../../Types/Telemetry/TelemetryFieldReaders";
import TraceScrubField from "../../../../Types/Trace/TraceScrubField";
import { DataTypeDetector } from "../../../../Utils/DataSecurity/Detector";
import { getBuiltInDetectorsOf } from "../../../../Utils/DataSecurity/Detectors/Index";
import { CORRELATION_ID_ATTRIBUTE_KEYS } from "../../../../Utils/Telemetry/CorrelationIdAttributes";
import {
  buildScrubPatternForDataType,
  isAddressLostToSecurityEvents,
  isSensitiveAttributeKey,
  MAX_SCRUB_PATTERN_LENGTH,
} from "./TelemetryScrubCoverage";

/*
 * THE RULES A TELEMETRY FINDING COULD GET, NARROWEST FIRST (#10366).
 *
 * Every finding a rule can hide gets one, chosen as narrowly as the
 * finding allows - deterministically where it can be, by OneUptime AI only
 * where nothing here fits (Server/Utils/AI/DataSecurity/ScrubRuleWriter).
 * Each is for the finding's service, and the verifier proves each on the
 * finding's records before it is offered (TelemetryScrubProof); the first
 * that hides the data without changing too much else is the one:
 *
 *  1. the data type's own pattern: a built-in pattern type (email, card,
 *     SSN, phone, IP address), or a custom pattern made from the type's
 *     detectors that need no context - Scrub It's rule;
 *  2. for one of the project's own data types, the type's own pattern,
 *     only in the attribute it was found in;
 *  3. for a type told apart only by the words around it (a routing
 *     number), the shape its detectors match, only in the attribute it was
 *     found in;
 *  4. a Named Attributes rule for the attribute the finding is in, which
 *     hides its whole value: a type found by field names alone (a person's
 *     name under customer_name), a value under a key that names a secret,
 *     and the fallback for 2 and 3 when a pattern changes too much;
 *  5. Scrub It's Sensitive Attribute Keys rule, for a value under a key
 *     that looks secret - the broadest, last.
 *
 * What a rule does with what it finds follows the data (#10366's decision):
 * a secret is redacted; personal data is masked, as a finding's samples
 * are; an IP address Security Events reads is hashed (#10396), any other
 * is redacted; business documents are redacted. Hash only when asked:
 * a hash of a low-entropy value, a phone number, can be guessed back.
 */

export enum ScrubRuleSource {
  // The data type's own pattern: Scrub It's rule.
  TypePattern = "TypePattern",
  // One of the project's own data types: its pattern, in its attribute.
  ProjectTypePattern = "ProjectTypePattern",
  // A type told apart by context: its shape, in its attribute.
  ContextPattern = "ContextPattern",
  // The attribute it is in, whole.
  NamedKeys = "NamedKeys",
  // Scrub It's denylist of keys that look secret.
  SensitiveKeys = "SensitiveKeys",
  // Written by OneUptime AI from the shapes of the values, never a value.
  OneUptimeAi = "OneUptimeAi",
}

// A rule a finding could get, before it is proven.
export interface ScrubRuleCandidate {
  source: ScrubRuleSource;
  signal: "log" | "trace";
  patternType: string;
  customRegex?: string | undefined;
  attributeKeys?: Array<string> | undefined;
  scrubAction: string;
  fieldsToScrub: string;
  // An IP Address rule that hashes because Security Events reads the address (#10396).
  hashesForSecurityEvents?: boolean | undefined;
}

// One of the project's own data types, as the planner reads it.
export interface ProjectDataTypePattern {
  category?: DataCategory | string | null | undefined;
  pattern?: string | null | undefined;
  ignoreCase?: boolean | null | undefined;
}

// The data a finding names, as the planner reads it.
export interface ScrubPlanFinding {
  dataTypeId: string;
  // The finding's own category, when it kept one: the catalog's otherwise.
  dataCategory?: DataCategory | string | null | undefined;
  location: string;
  target: ScrubTarget & { signal: "log" | "trace" };
  // The project's own type, for a custom:<id> finding.
  projectType?: ProjectDataTypePattern | undefined;
}

// The built-in pattern type of each data type it finds.
const PATTERN_TYPE_OF_DATA_TYPE: ReadonlyMap<string, string> = new Map(
  Object.entries(DATA_TYPE_OF_SCRUB_PATTERN_TYPE).map(
    ([patternType, dataTypeId]: [string, string]): [string, string] => {
      return [dataTypeId, patternType];
    },
  ),
);

const PERSONAL_CATEGORIES: ReadonlySet<string> = new Set<string>([
  DataCategory.ContactAndIdentity,
  DataCategory.GovernmentId,
  DataCategory.Financial,
  DataCategory.Health,
  DataCategory.SpecialCategory,
]);

// The category a finding's data is in: its own, or its type's in the catalog.
export function getScrubFindingCategory(
  finding: Pick<
    ScrubPlanFinding,
    "dataTypeId" | "dataCategory" | "projectType"
  >,
): string {
  return (
    (finding.dataCategory || "").toString() ||
    (finding.projectType?.category || "").toString() ||
    getBuiltInDataType(finding.dataTypeId)?.category ||
    ""
  );
}

// Whether a finding is a secret: the Secrets and credentials category.
export function isSecretFinding(
  finding: Pick<
    ScrubPlanFinding,
    "dataTypeId" | "dataCategory" | "projectType"
  >,
): boolean {
  return (
    getScrubFindingCategory(finding) === DataCategory.SecretsAndCredentials
  );
}

/*
 * What a rule does with what it finds, by the data's category: personal
 * data masked, everything else - secrets first - redacted. The engines'
 * mask leaves an email's first letter and domain ending, a card's or a
 * phone's last four digits, anything else its first and last characters.
 */
export function getScrubActionOfCategory(category: string): string {
  return PERSONAL_CATEGORIES.has(category)
    ? LogScrubAction.Mask
    : LogScrubAction.Redact;
}

// The parts of the records a rule for the finding's place scrubs.
export function getFieldsToScrubOfTarget(target: ScrubTarget): string {
  if (target.signal === "log") {
    return target.field === ScrubbedField.Body
      ? LogScrubField.Body
      : LogScrubField.Attributes;
  }

  switch (target.field) {
    case ScrubbedField.Events:
      return TraceScrubField.Events;
    case ScrubbedField.Name:
      return TraceScrubField.Name;
    default:
      return TraceScrubField.Attributes;
  }
}

// The attribute a finding is in, for a rule that names it: none for a body, a name or a prompt's text.
export function getAttributeKeyOfTarget(target: ScrubTarget): string | null {
  if (
    target.key === undefined ||
    (target.field !== ScrubbedField.Attributes &&
      target.field !== ScrubbedField.Events)
  ) {
    return null;
  }

  // A record's own session or conversation id: its column keeps it, whatever a rule does.
  if (
    target.field === ScrubbedField.Attributes &&
    CORRELATION_ID_ATTRIBUTE_KEYS.has(target.key)
  ) {
    return null;
  }

  return target.key;
}

/*
 * A project type's pattern as a scrub rule's custom pattern runs it (with
 * "g" alone): case-insensitive as a modifier group - or null when it
 * cannot run there.
 */
export function toScrubPatternOfProjectType(
  type: ProjectDataTypePattern | undefined,
): string | null {
  const pattern: string = (type?.pattern || "").trim();

  if (!pattern) {
    return null;
  }

  const piece: string = type?.ignoreCase ? `(?i:${pattern})` : pattern;

  return piece.length <= MAX_SCRUB_PATTERN_LENGTH &&
    checkScrubRuleCustomRegex(piece) === null
    ? piece
    : null;
}

/*
 * The shape a type told apart only by context matches, without the words
 * around it: its detectors' patterns, those that run as a scrub rule's -
 * so nine digits for a routing number. Far too broad for every value, so
 * only ever used in the one attribute the type was found in.
 */
export function buildContextShapePattern(dataTypeId: string): string | null {
  const pieces: Array<string> = [];

  for (const detector of getBuiltInDetectorsOf(dataTypeId)) {
    if (!detector.requiresContext) {
      continue;
    }

    const piece: string | null = toPlainPiece(detector);

    if (piece !== null && !pieces.includes(piece)) {
      pieces.push(piece);
    }
  }

  if (pieces.length === 0) {
    return null;
  }

  const pattern: string =
    pieces.length === 1
      ? pieces[0]!
      : pieces
          .map((piece: string): string => {
            return `(?:${piece})`;
          })
          .join("|");

  return pattern.length <= MAX_SCRUB_PATTERN_LENGTH &&
    checkScrubRuleCustomRegex(pattern) === null
    ? pattern
    : null;
}

// A detector's pattern as a scrub rule runs it: its i, m or s as a modifier group.
function toPlainPiece(detector: DataTypeDetector): string | null {
  const flags: string = detector.pattern.flags.replace("g", "");
  let modifiers: string = "";

  for (const flag of flags) {
    if (flag === "i" || flag === "m" || flag === "s") {
      modifiers += flag;
    } else if (flag !== "d") {
      return null;
    }
  }

  const source: string = detector.pattern.source;
  const piece: string = modifiers ? `(?${modifiers}:${source})` : source;

  return checkScrubRuleCustomRegex(piece) === null ? piece : null;
}

/*
 * The rules a finding could get, narrowest first - none when no rule
 * here can hide it (OneUptime AI may write one). `securityEventsSources`:
 * Security Events' scans that read the finding's kind of record, for an
 * IP address (#10396). `serviceId`: the service the rule is for.
 */
export function planScrubRuleCandidates(data: {
  finding: ScrubPlanFinding;
  securityEventsSources?: ReadonlyArray<SecurityEventsTelemetrySource>;
  serviceId?: string | null | undefined;
}): Array<ScrubRuleCandidate> {
  const finding: ScrubPlanFinding = data.finding;
  const target: ScrubTarget & { signal: "log" | "trace" } = finding.target;
  const signal: "log" | "trace" = target.signal;
  const category: string = getScrubFindingCategory(finding);
  const info: DataTypeInfo | undefined = getBuiltInDataType(finding.dataTypeId);
  const fieldsToScrub: string = getFieldsToScrubOfTarget(target);
  const attributeKey: string | null = getAttributeKeyOfTarget(target);
  const action: string = getScrubActionOfCategory(category);
  const candidates: Array<ScrubRuleCandidate> = [];

  // A document's marking: hiding the word would not hide the document.
  if (category === DataCategory.BusinessConfidential) {
    return candidates;
  }

  const namedKeys: ScrubRuleCandidate | null = attributeKey
    ? {
        source: ScrubRuleSource.NamedKeys,
        signal,
        patternType: SCRUB_RULE_NAMED_KEYS_PATTERN_TYPE,
        attributeKeys: [attributeKey],
        scrubAction: action,
        fieldsToScrub:
          signal === "log"
            ? LogScrubField.Attributes
            : target.field === ScrubbedField.Events
              ? TraceScrubField.Events
              : TraceScrubField.Attributes,
      }
    : null;

  // 1. The data type's own pattern - a built-in pattern type first.
  const builtIn: string | undefined = PATTERN_TYPE_OF_DATA_TYPE.get(
    finding.dataTypeId,
  );

  if (builtIn) {
    const hashes: boolean =
      builtIn === LogScrubPatternType.IPAddress &&
      isAddressLostToSecurityEvents({
        signal,
        fieldsToScrub,
        serviceId: data.serviceId,
        sources: data.securityEventsSources || [],
      });

    candidates.push({
      source: ScrubRuleSource.TypePattern,
      signal,
      patternType: builtIn,
      // An IP address is redacted where nothing needs it, hashed where Security Events does.
      scrubAction: hashes
        ? LogScrubAction.Hash
        : builtIn === LogScrubPatternType.IPAddress
          ? LogScrubAction.Redact
          : action,
      fieldsToScrub,
      ...(hashes ? { hashesForSecurityEvents: true } : {}),
    });
  } else if (isCustomDataTypeId(finding.dataTypeId)) {
    // 2. One of the project's own data types: its pattern, where it was found.
    const pattern: string | null = toScrubPatternOfProjectType(
      finding.projectType,
    );

    if (pattern) {
      candidates.push({
        source: ScrubRuleSource.ProjectTypePattern,
        signal,
        patternType: SCRUB_RULE_CUSTOM_PATTERN_TYPE,
        customRegex: pattern,
        ...(attributeKey ? { attributeKeys: [attributeKey] } : {}),
        scrubAction: action,
        fieldsToScrub,
      });
    }
  } else if (info && info.foundBy !== "name") {
    const pattern: string | null = buildScrubPatternForDataType(
      finding.dataTypeId,
    );

    if (pattern !== null) {
      // Its context-free detectors: Scrub It's custom pattern.
      candidates.push({
        source: ScrubRuleSource.TypePattern,
        signal,
        patternType: SCRUB_RULE_CUSTOM_PATTERN_TYPE,
        customRegex: pattern,
        scrubAction: action,
        fieldsToScrub,
      });
    } else if (attributeKey) {
      // 3. Told apart by context: its shape, in its attribute alone.
      const shape: string | null = buildContextShapePattern(finding.dataTypeId);

      if (shape !== null) {
        candidates.push({
          source: ScrubRuleSource.ContextPattern,
          signal,
          patternType: SCRUB_RULE_CUSTOM_PATTERN_TYPE,
          customRegex: shape,
          attributeKeys: [attributeKey],
          scrubAction: action,
          fieldsToScrub,
        });
      }
    }
  }

  // 4. The attribute it is in, whole.
  if (namedKeys) {
    candidates.push(namedKeys);
  }

  // 5. Scrub It's denylist, for a value under a key that looks secret.
  if (
    attributeKey &&
    isSensitiveAttributeKey(attributeKey) &&
    (target.field === ScrubbedField.Attributes ||
      target.field === ScrubbedField.Events)
  ) {
    candidates.push({
      source: ScrubRuleSource.SensitiveKeys,
      signal,
      patternType: SCRUB_RULE_SENSITIVE_KEYS_PATTERN_TYPE,
      scrubAction: LogScrubAction.Redact,
      fieldsToScrub:
        signal === "log" ? LogScrubField.Attributes : TraceScrubField.All,
    });
  }

  return candidates;
}

// Whether a candidate names the attribute it reads: a Named Attributes rule, or a pattern in one attribute.
export function isNarrowedToAttributes(candidate: ScrubRuleCandidate): boolean {
  return (candidate.attributeKeys || []).length > 0;
}
