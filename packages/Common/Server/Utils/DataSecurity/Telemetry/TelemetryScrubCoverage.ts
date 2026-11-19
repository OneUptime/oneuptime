import LogScrubRule from "../../../../Models/DatabaseModels/LogScrubRule";
import MetricPipelineRule from "../../../../Models/DatabaseModels/MetricPipelineRule";
import TraceScrubRule from "../../../../Models/DatabaseModels/TraceScrubRule";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import DataCategory from "../../../../Types/DataSecurity/DataCategory";
import {
  DataTypeInfo,
  getBuiltInDataType,
} from "../../../../Types/DataSecurity/DataTypeCatalog";
import {
  DataStoreKind,
  isDataStoreKind,
  TELEMETRY_DATA_STORE_KINDS,
} from "../../../../Types/DataSecurity/DataStoreKind";
import {
  getScrubTarget,
  getScrubUnavailableReason,
  ScrubbedField,
  ScrubRuleSignal,
  ScrubTarget,
  TelemetryScrubUnavailableReason,
} from "../../../../Types/DataSecurity/TelemetryScrubTarget";
import BadDataException from "../../../../Types/Exception/BadDataException";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import LogScrubAction from "../../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../Types/Log/LogScrubPatternType";
import MetricPipelineRuleFilterCondition, {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
} from "../../../../Types/Metrics/MetricPipelineRuleFilterCondition";
import MetricPipelineRuleType from "../../../../Types/Metrics/MetricPipelineRuleType";
import ObjectID from "../../../../Types/ObjectID";
import {
  checkScrubRuleCustomRegex,
  doesScrubRuleScrubNothing,
  LOG_SCRUB_FIELDS,
  LOG_SCRUB_PATTERN_TYPES,
  LOG_SCRUB_RULE_DEFAULTS,
  SCRUB_RULE_CUSTOM_PATTERN_TYPE,
  SCRUB_RULE_SENSITIVE_KEYS_PATTERN_TYPE,
  ScrubRuleCustomRegexCheck,
  ScrubRuleCustomRegexProblem,
  TRACE_SCRUB_FIELDS,
  TRACE_SCRUB_PATTERN_TYPES,
  TRACE_SCRUB_RULE_DEFAULTS,
} from "../../../../Types/Telemetry/ScrubRule";
import TraceScrubAction from "../../../../Types/Trace/TraceScrubAction";
import TraceScrubField from "../../../../Types/Trace/TraceScrubField";
import { isCustomDataTypeId } from "../../../../Utils/DataSecurity/CustomDataTypeDetector";
import { DataTypeDetector } from "../../../../Utils/DataSecurity/Detector";
import { getBuiltInDetectorsOf } from "../../../../Utils/DataSecurity/Detectors/Index";
import { PatternProblemReason } from "../../../../Utils/LinearRegExp/PatternProblem";
import { CORRELATION_ID_ATTRIBUTE_KEYS } from "../../../../Utils/Telemetry/CorrelationIdAttributes";
import LogScrubRuleService from "../../../Services/LogScrubRuleService";
import MetricPipelineRuleService from "../../../Services/MetricPipelineRuleService";
import TraceScrubRuleService from "../../../Services/TraceScrubRuleService";
import WorkspaceActionAuthorization from "../../Workspace/WorkspaceActionAuthorization";

// Which rule reaches a location is decided beside the store kinds, for the pages too.
export {
  getScrubTarget,
  ScrubbedField,
} from "../../../../Types/DataSecurity/TelemetryScrubTarget";
export type {
  ScrubRuleSignal,
  ScrubTarget,
} from "../../../../Types/DataSecurity/TelemetryScrubTarget";

/*
 * WHETHER A SCRUB RULE ALREADY HIDES WHAT A TELEMETRY FINDING FOUND - AND
 * THE RULE THAT WOULD ("SCRUB IT").
 *
 * A finding in telemetry (TelemetryDataScanner.ts) names a data type and a
 * location: body, attributes.user.email, events.login.token, message, a
 * prompt's key. Ingest's scrub rules (App/FeatureSet/Telemetry/Services/
 * LogScrubRuleService.ts and TraceScrubRuleService.ts) hide data before it
 * is stored, so a finding a rule already covers is old data waiting for its
 * retention, not a leak still flowing - which the finding says (isScrubbed).
 *
 * A rule covers a finding only when ingest would run it there:
 *
 *  - on the right records: log rules for logs (and a RUM application's
 *    logs), trace rules for spans, exceptions and AI calls - an exception
 *    is a copy of its span's exception event, scrubbed by the rules that
 *    scrub events (TraceScrubRuleService.scrubExceptionContent);
 *  - on the right field: a rule's fields to scrub (body, attributes, both;
 *    name, attributes, events, all), or every field when left empty, as
 *    ingest reads it;
 *  - with a pattern that finds this type: a built-in pattern finds its own
 *    type (email -> email-address, creditCard -> credit-card-number, ssn ->
 *    us-ssn, phoneNumber -> phone-number, ipAddress -> ip-address); a
 *    sensitive-keys rule hides the whole value of every attribute whose
 *    key looks sensitive, whatever it holds and whatever its fields say;
 *    and a custom pattern counts only when it is exactly the one "Scrub
 *    it" makes for the type (buildScrubPatternForDataType). A pattern a
 *    person wrote is never taken for one that covers: a finding keeps
 *    only masked samples, which no pattern can be tried on, so coverage
 *    could not be proven - and a finding wrongly called scrubbed is a
 *    leak nobody looks at.
 *
 * A sensitive-keys rule also hides what sits under such a key inside a
 * value: a list's or a map's, a log body's, a JSON text's held in a string
 * (`http.request.body` = {"password": ...}, #8993). A finding names the
 * field it was found in - `body`, `attributes.http.request.body` - and not
 * the key inside it, and the rule keeps the rest of that field, so it
 * covers a finding only where the field's own key looks sensitive.
 *
 * Only enabled rules count, and never one that scrubs nothing
 * (doesScrubRuleScrubNothing).
 *
 * "Scrub it" makes the rule a finding needs, once: the built-in pattern of
 * its type when there is one (masking cards, SSNs and phone numbers,
 * redacting the rest), a sensitive-keys rule for a value under a key that
 * looks sensitive, or else a custom pattern made from the type's own
 * detectors - each on the fields of the finding's location. A finding a
 * rule already covers gets that rule, not a second one.
 *
 * A metric's attribute is a series' label, and the metric pipeline's
 * rules (App/FeatureSet/Telemetry/Services/MetricPipelineRuleService.ts)
 * name an attribute by its key, which no scrub rule does. So "Scrub it" on
 * a metric attribute makes a Redact Attribute rule for its service: it
 * replaces the attribute's value with [REDACTED] - only the values of the
 * data type's shape, where a pattern can find it (a "Matches Regex"
 * filter of the pattern above, so the label keeps its other values), and
 * every value under the key otherwise, since the key's name is what says
 * it is sensitive. Such a rule covers the finding, as does a Redact or
 * Remove Attribute rule of that key for the service or the whole project
 * with no filter. A rule with filters a person wrote never counts, for the
 * reason a person's pattern never does. A metric's name cannot be
 * scrubbed: a pipeline rule renames a metric whole, so the name is fixed
 * in the code that creates the metric.
 */

export interface CoveringScrubRule {
  id: string;
  name: string;
  signal: ScrubRuleSignal;
  patternType: string;
  customRegex?: string | undefined;
  // As ingest reads it: the default when the rule left it empty.
  fieldsToScrub: string;
  // A metric pipeline rule's: the attribute it redacts or removes.
  attributeKey?: string | undefined;
  // A metric pipeline rule's: the service it is for; none for every service.
  serviceId?: string | undefined;
  // A metric pipeline rule's: the rows it applies to.
  filters?: Array<MetricPipelineRuleFilterCondition> | undefined;
}

export interface ScrubCoverage {
  rules: Array<CoveringScrubRule>;
}

export interface TelemetryFindingReference {
  kind: DataStoreKind;
  dataTypeId: string;
  location: string;
  // The service the store is the telemetry of: a metric rule may be its own.
  serviceId?: ObjectID | string | null | undefined;
}

// The metric pipeline rule types that hide an attribute's value.
const METRIC_HIDING_RULE_TYPES: ReadonlySet<string> = new Set([
  MetricPipelineRuleType.RedactAttribute,
  MetricPipelineRuleType.RemoveAttribute,
]);

// What a metric attribute's value is replaced with ("Scrub it"'s, and ingest's default).
export const METRIC_REDACT_REPLACEMENT: string = "[REDACTED]";

export interface CreatedScrubRule {
  signal: ScrubRuleSignal;
  scrubRuleId: string;
  scrubRuleName: string;
}

/*
 * The attribute-KEY denylist ingest's sensitive-keys rules read
 * (SENSITIVE_KEY_REGEX in App/FeatureSet/Telemetry/Services/
 * LogScrubRuleService.ts and TraceScrubRuleService.ts), written out again
 * here because Common cannot import from App. TelemetryScrubCoverage.test.ts
 * reads both and fails when they differ.
 */
export const INGEST_SENSITIVE_KEY_REGEX: RegExp =
  /(password|passwd|pwd|secret|token|api[._-]?key|access[._-]?key|private[._-]?key|client[._-]?secret|authorization|auth[._-]?header|cookie|session[._-]?id|credit[._-]?card|card[._-]?number|ssn|csrf|xsrf)/i;

// The longest key read: no attribute key is longer than a location.
const MAX_KEY_LENGTH: number = 1_024;

export function isSensitiveAttributeKey(key: string): boolean {
  return INGEST_SENSITIVE_KEY_REGEX.test(key.slice(0, MAX_KEY_LENGTH));
}

/*
 * Whether a Sensitive Attribute Keys rule hides the value at this place: a
 * value under a key that looks secret - but for a record's own attribute
 * that can hold the record's session or conversation id, which the rule
 * keeps when it does, as the record's column keeps it (#8924,
 * Utils/Telemetry/CorrelationIdAttributes). Saying such a rule covers it,
 * or offering one for it, would promise what ingest does not do.
 */
function sensitiveKeysRuleHides(target: ScrubTarget): boolean {
  if (
    target.key === undefined ||
    (target.field !== ScrubbedField.Attributes &&
      target.field !== ScrubbedField.Events) ||
    !isSensitiveAttributeKey(target.key)
  ) {
    return false;
  }

  return !(
    target.field === ScrubbedField.Attributes &&
    CORRELATION_ID_ATTRIBUTE_KEYS.has(target.key)
  );
}

// The data type each built-in pattern type finds. Log and trace rules share them.
export const DATA_TYPE_OF_SCRUB_PATTERN_TYPE: Readonly<Record<string, string>> =
  {
    [LogScrubPatternType.Email]: "email-address",
    [LogScrubPatternType.CreditCard]: "credit-card-number",
    [LogScrubPatternType.SSN]: "us-ssn",
    [LogScrubPatternType.PhoneNumber]: "phone-number",
    [LogScrubPatternType.IPAddress]: "ip-address",
  };

const SCRUB_PATTERN_TYPE_OF_DATA_TYPE: ReadonlyMap<string, string> = new Map(
  Object.entries(DATA_TYPE_OF_SCRUB_PATTERN_TYPE).map(
    ([patternType, dataTypeId]: [string, string]): [string, string] => {
      return [dataTypeId, patternType];
    },
  ),
);

// The built-in pattern types "Scrub it" masks rather than redacts.
const MASKED_PATTERN_TYPES: ReadonlySet<string> = new Set([
  LogScrubPatternType.CreditCard,
  LogScrubPatternType.SSN,
  LogScrubPatternType.PhoneNumber,
]);

// What the name of every rule "Scrub it" makes starts with.
export const DATA_SECURITY_SCRUB_RULE_NAME_PREFIX: string = "Data Security: ";

// The rule columns' lengths (character varying(50) and (500)).
const MAX_RULE_NAME_LENGTH: number = 50;
const MAX_RULE_DESCRIPTION_LENGTH: number = 500;
export const MAX_SCRUB_PATTERN_LENGTH: number = 500;

// A metric pipeline rule's name and attribute key (character varying(100)).
const MAX_METRIC_RULE_NAME_LENGTH: number = 100;
export const MAX_METRIC_RULE_ATTRIBUTE_KEY_LENGTH: number = 100;

// A count {n,m} wider than this is made open {n,} when a pattern is too large to run.
const MAX_KEPT_REPEAT: number = 64;

// Whether ingest runs a rule over a part of the record.
function ruleScrubsField(
  rule: CoveringScrubRule,
  field: ScrubbedField,
): boolean {
  if (rule.signal === "log") {
    switch (rule.fieldsToScrub) {
      case LogScrubField.Both:
        return (
          field === ScrubbedField.Body || field === ScrubbedField.Attributes
        );
      case LogScrubField.Body:
        return field === ScrubbedField.Body;
      case LogScrubField.Attributes:
        return field === ScrubbedField.Attributes;
      default:
        return false;
    }
  }

  switch (rule.fieldsToScrub) {
    case TraceScrubField.All:
      return field !== ScrubbedField.Body;
    case TraceScrubField.Attributes:
      return field === ScrubbedField.Attributes;
    case TraceScrubField.Events:
      return field === ScrubbedField.Events;
    case TraceScrubField.Name:
      return field === ScrubbedField.Name;
    default:
      return false;
  }
}

/*
 * The filters "Scrub it" gives a metric rule for a data type under a key:
 * the value has the type's shape (buildScrubPatternForDataType), so the
 * label keeps its other values - or none, where no pattern can find the
 * type: then every value under the key is redacted, since the key's name,
 * or the words around the values, are what say it holds the type.
 */
export function buildMetricScrubFilters(
  dataTypeId: string,
  attributeKey: string,
): Array<MetricPipelineRuleFilterCondition> {
  const pattern: string | null = isCustomDataTypeId(dataTypeId)
    ? null
    : buildScrubPatternForDataType(dataTypeId);

  return pattern === null
    ? []
    : [
        {
          checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
          attributeKey,
          conditionType: MetricPipelineRuleFilterConditionType.MatchesRegex,
          value: pattern,
        },
      ];
}

function filterText(filter: MetricPipelineRuleFilterCondition): string {
  return JSON.stringify([
    filter?.checkOn || "",
    (filter?.attributeKey || "").trim(),
    filter?.conditionType || "",
    filter?.value || "",
  ]);
}

/*
 * Whether a metric pipeline rule hides a metric attribute finding: it
 * redacts or removes that key, for the finding's service or every
 * service, on every row - or only on the rows "Scrub it" would pick. A
 * filter a person wrote never counts: whether it lets the finding's values
 * through cannot be told from masked samples.
 */
function metricRuleCovers(
  rule: CoveringScrubRule,
  target: ScrubTarget,
  finding: TelemetryFindingReference,
): boolean {
  if (!target.key || rule.attributeKey !== target.key) {
    return false;
  }

  const findingServiceId: string = finding.serviceId
    ? finding.serviceId.toString().toLowerCase()
    : "";

  if (rule.serviceId && rule.serviceId.toLowerCase() !== findingServiceId) {
    return false;
  }

  const filters: Array<MetricPipelineRuleFilterCondition> = rule.filters || [];

  if (filters.length === 0) {
    return true;
  }

  const scrubItFilters: Array<string> = buildMetricScrubFilters(
    finding.dataTypeId,
    target.key,
  ).map(filterText);

  return (
    scrubItFilters.length > 0 &&
    filters.length === scrubItFilters.length &&
    filters.map(filterText).every((text: string, index: number): boolean => {
      return text === scrubItFilters[index];
    })
  );
}

function ruleCovers(
  rule: CoveringScrubRule,
  target: ScrubTarget,
  finding: TelemetryFindingReference,
): boolean {
  const dataTypeId: string = finding.dataTypeId;

  if (rule.signal !== target.signal) {
    return false;
  }

  if (rule.signal === "metric") {
    return metricRuleCovers(rule, target, finding);
  }

  if (rule.patternType === SCRUB_RULE_SENSITIVE_KEYS_PATTERN_TYPE) {
    // A key's whole value, whatever the rule's fields say - as ingest runs it.
    return sensitiveKeysRuleHides(target);
  }

  if (!ruleScrubsField(rule, target.field)) {
    return false;
  }

  if (rule.patternType === SCRUB_RULE_CUSTOM_PATTERN_TYPE) {
    const pattern: string | null = buildScrubPatternForDataType(dataTypeId);

    return pattern !== null && rule.customRegex === pattern;
  }

  return DATA_TYPE_OF_SCRUB_PATTERN_TYPE[rule.patternType] === dataTypeId;
}

// The first enabled rule that hides a finding at ingest, or null.
export function findCoveringScrubRule(
  coverage: ScrubCoverage,
  finding: TelemetryFindingReference,
): CoveringScrubRule | null {
  const target: ScrubTarget | null = getScrubTarget(
    finding.kind,
    finding.location,
  );

  if (!target) {
    return null;
  }

  for (const rule of coverage.rules) {
    if (ruleCovers(rule, target, finding)) {
      return rule;
    }
  }

  return null;
}

export function isFindingScrubbed(
  coverage: ScrubCoverage,
  finding: TelemetryFindingReference,
): boolean {
  return findCoveringScrubRule(coverage, finding) !== null;
}

function toCoveringRule(
  rule: LogScrubRule | TraceScrubRule,
  signal: ScrubRuleSignal,
): CoveringScrubRule | null {
  const id: string | undefined = rule.id?.toString();

  if (
    !id ||
    typeof rule.patternType !== "string" ||
    doesScrubRuleScrubNothing({
      patternType: rule.patternType,
      customRegex: rule.customRegex,
      fieldsToScrub: rule.fieldsToScrub,
      knownPatternTypes:
        signal === "log" ? LOG_SCRUB_PATTERN_TYPES : TRACE_SCRUB_PATTERN_TYPES,
      knownFieldsToScrub:
        signal === "log" ? LOG_SCRUB_FIELDS : TRACE_SCRUB_FIELDS,
    })
  ) {
    return null;
  }

  return {
    id,
    name: rule.name || "",
    signal,
    patternType: rule.patternType,
    customRegex: rule.customRegex || undefined,
    fieldsToScrub:
      rule.fieldsToScrub ||
      (signal === "log"
        ? LOG_SCRUB_RULE_DEFAULTS.fieldsToScrub
        : TRACE_SCRUB_RULE_DEFAULTS.fieldsToScrub),
  };
}

/*
 * An enabled metric pipeline rule that hides an attribute's value (Redact
 * or Remove Attribute) as a covering rule, or null for any other rule.
 */
export function toCoveringMetricRule(
  rule: MetricPipelineRule,
): CoveringScrubRule | null {
  const id: string | undefined = rule.id?.toString() || rule._id?.toString();
  const attributeKey: string = (rule.addAttributeKey || "").trim();

  if (
    !id ||
    !attributeKey ||
    typeof rule.ruleType !== "string" ||
    !METRIC_HIDING_RULE_TYPES.has(rule.ruleType)
  ) {
    return null;
  }

  const covering: CoveringScrubRule = {
    id,
    name: rule.name || "",
    signal: "metric",
    patternType: rule.ruleType,
    fieldsToScrub: ScrubbedField.Attributes,
    attributeKey,
    filters: Array.isArray(rule.filters) ? rule.filters : [],
  };
  const serviceId: string = rule.serviceId ? rule.serviceId.toString() : "";

  if (serviceId) {
    covering.serviceId = serviceId;
  }

  return covering;
}

/*
 * A project's enabled log and trace scrub rules, and the metric pipeline
 * rules that hide an attribute, read as OneUptime itself.
 */
export async function getScrubCoverage(
  projectId: ObjectID,
): Promise<ScrubCoverage> {
  const [logRules, traceRules, metricRules]: [
    Array<LogScrubRule>,
    Array<TraceScrubRule>,
    Array<MetricPipelineRule>,
  ] = await Promise.all([
    LogScrubRuleService.findBy({
      query: { projectId, isEnabled: true },
      select: {
        _id: true,
        name: true,
        patternType: true,
        customRegex: true,
        fieldsToScrub: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    }),
    TraceScrubRuleService.findBy({
      query: { projectId, isEnabled: true },
      select: {
        _id: true,
        name: true,
        patternType: true,
        customRegex: true,
        fieldsToScrub: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    }),
    MetricPipelineRuleService.findBy({
      query: { projectId, isEnabled: true },
      select: {
        _id: true,
        name: true,
        ruleType: true,
        addAttributeKey: true,
        serviceId: true,
        filters: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: { isRoot: true },
    }),
  ]);

  const rules: Array<CoveringScrubRule> = [];

  for (const rule of logRules) {
    const covering: CoveringScrubRule | null = toCoveringRule(rule, "log");

    if (covering) {
      rules.push(covering);
    }
  }

  for (const rule of traceRules) {
    const covering: CoveringScrubRule | null = toCoveringRule(rule, "trace");

    if (covering) {
      rules.push(covering);
    }
  }

  for (const rule of metricRules) {
    const covering: CoveringScrubRule | null = toCoveringMetricRule(rule);

    if (covering) {
      rules.push(covering);
    }
  }

  return { rules };
}

/*
 * A detector's pattern with every count wider than MAX_KEPT_REPEAT made
 * open: {2,8000} becomes {2,}. A count is written once and compiled to as
 * many steps as it allows, which the linear-time matcher refuses past a
 * size; open, it is a loop. It matches longer runs than the detector did,
 * which a scrub rule may: the run still ends where the detector's own
 * look-arounds end it. Counts inside a character class or escaped are left
 * alone.
 */
export function relaxLongRepeats(source: string): string {
  let relaxed: string = "";
  let inClass: boolean = false;

  for (let index: number = 0; index < source.length; index++) {
    const character: string = source[index] as string;

    if (character === "\\") {
      relaxed += source.slice(index, index + 2);
      index++;
      continue;
    }

    if (inClass) {
      inClass = character !== "]";
      relaxed += character;
      continue;
    }

    if (character === "[") {
      inClass = true;
      relaxed += character;
      continue;
    }

    if (character === "{") {
      const close: number = source.indexOf("}", index);
      const body: string = close > index ? source.slice(index + 1, close) : "";
      const comma: number = body.indexOf(",");
      const low: string = comma > 0 ? body.slice(0, comma) : "";
      const high: string = comma > 0 ? body.slice(comma + 1) : "";

      if (
        isDigits(low) &&
        isDigits(high) &&
        Number(high) - Number(low) > MAX_KEPT_REPEAT
      ) {
        relaxed += `{${low},}`;
        index = close;
        continue;
      }
    }

    relaxed += character;
  }

  return relaxed;
}

function isDigits(text: string): boolean {
  if (text.length === 0 || text.length > 6) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 48 || code > 57) {
      return false;
    }
  }

  return true;
}

/*
 * One detector's pattern as a scrub rule's custom pattern runs it: with no
 * flags of its own (ingest compiles every custom pattern with "g" alone), so
 * an i, m or s the detector needs becomes a modifier group (?i:...) - or
 * null when it cannot run there: a back-reference, a u flag.
 */
function toScrubPatternPiece(detector: DataTypeDetector): string | null {
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
  const check: ScrubRuleCustomRegexCheck | null =
    checkScrubRuleCustomRegex(piece);

  if (check === null) {
    return piece;
  }

  if (
    check.problem === ScrubRuleCustomRegexProblem.CannotRun &&
    check.cannotRunReason === PatternProblemReason.TooLarge
  ) {
    const relaxed: string = relaxLongRepeats(piece);

    return checkScrubRuleCustomRegex(relaxed) === null ? relaxed : null;
  }

  return null;
}

const scrubPatterns: Map<string, string | null> = new Map();

/*
 * The custom pattern "Scrub it" makes for a built-in data type, or null when
 * none can be made: the type is found by field names alone (a person's
 * name), or only by the words around it - nine digits are a routing number
 * only beside "routing" - which a scrub rule cannot read, so its pattern
 * alone would scrub far more than the type; or it is a document's marking
 * ("Confidential"), and hiding the word would not hide the document. Made
 * of the type's detectors that need no context, surest first, as many as
 * fit the rule's 500 characters, and checked the way the rule is checked
 * when it is saved (checkScrubRuleCustomRegex). A detector's checksum
 * cannot be a pattern: the rule scrubs every value of the type's shape.
 */
export function buildScrubPatternForDataType(
  dataTypeId: string,
): string | null {
  if (scrubPatterns.has(dataTypeId)) {
    return scrubPatterns.get(dataTypeId) ?? null;
  }

  if (
    getBuiltInDataType(dataTypeId)?.category ===
    DataCategory.BusinessConfidential
  ) {
    scrubPatterns.set(dataTypeId, null);
    return null;
  }

  const detectors: Array<DataTypeDetector> = getBuiltInDetectorsOf(dataTypeId)
    .filter((detector: DataTypeDetector): boolean => {
      return !detector.requiresContext;
    })
    .sort((a: DataTypeDetector, b: DataTypeDetector): number => {
      return b.specificity - a.specificity;
    });

  const pieces: Array<string> = [];
  let pattern: string | null = null;

  for (const detector of detectors) {
    const piece: string | null = toScrubPatternPiece(detector);

    if (piece === null) {
      continue;
    }

    const candidate: string =
      pieces.length === 0
        ? piece
        : [...pieces, piece]
            .map((part: string): string => {
              return `(?:${part})`;
            })
            .join("|");

    if (
      candidate.length > MAX_SCRUB_PATTERN_LENGTH ||
      checkScrubRuleCustomRegex(candidate) !== null
    ) {
      continue;
    }

    pieces.push(piece);
    pattern = candidate;
  }

  scrubPatterns.set(dataTypeId, pattern);

  return pattern;
}

interface ScrubRulePlan {
  patternType: string;
  customRegex?: string | undefined;
  scrubAction: string;
  fieldsToScrub: string;
}

function fieldsToScrubFor(target: ScrubTarget): string {
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

function redactAction(signal: ScrubRuleSignal): string {
  return signal === "log" ? LogScrubAction.Redact : TraceScrubAction.Redact;
}

function maskAction(signal: ScrubRuleSignal): string {
  return signal === "log" ? LogScrubAction.Mask : TraceScrubAction.Mask;
}

function dataTypeNameOf(dataTypeId: string): string {
  return getBuiltInDataType(dataTypeId)?.name || "Custom data type";
}

// Why no rule can be made for a data type, in a sentence a person can act on.
function noRuleReason(dataTypeId: string, location: string): string {
  const info: DataTypeInfo | undefined = getBuiltInDataType(dataTypeId);
  /*
   * A scrub rule has no option that hides one attribute whatever it holds:
   * a custom pattern reads every value of the fields it scrubs.
   */
  const keyAdvice: string = `Rename the attribute to a key a sensitive-keys rule hides (password, token, secret, ...), or stop sending ${location}.`;

  if (isCustomDataTypeId(dataTypeId)) {
    return `Scrub It makes rules for OneUptime's own data types. Add a custom scrub rule with your data type's pattern instead. ${keyAdvice}`;
  }

  if (!info) {
    return `"${dataTypeId}" is not a data type Data Security knows.`;
  }

  if (info.foundBy === "name") {
    return `${info.name} is found by field names, not by the shape of its values, so no scrub pattern can find it. ${keyAdvice}`;
  }

  if (info.category === DataCategory.BusinessConfidential) {
    return `A marking says a document is confidential; hiding the word would not hide the document. Stop sending the document in ${location}.`;
  }

  return `${info.name} is told apart from other values only by the words around it, which a scrub rule cannot read, so a rule would hide far more than ${info.name}. ${keyAdvice}`;
}

function planScrubRule(data: {
  dataTypeId: string;
  location: string;
  target: ScrubTarget;
}): ScrubRulePlan {
  const target: ScrubTarget = data.target;
  const builtIn: string | undefined = SCRUB_PATTERN_TYPE_OF_DATA_TYPE.get(
    data.dataTypeId,
  );

  if (builtIn) {
    return {
      patternType: builtIn,
      scrubAction: MASKED_PATTERN_TYPES.has(builtIn)
        ? maskAction(target.signal)
        : redactAction(target.signal),
      fieldsToScrub: fieldsToScrubFor(target),
    };
  }

  // A value under a key that names it: its whole value, whatever its shape.
  if (sensitiveKeysRuleHides(target)) {
    return {
      patternType: SCRUB_RULE_SENSITIVE_KEYS_PATTERN_TYPE,
      scrubAction: redactAction(target.signal),
      fieldsToScrub:
        target.signal === "log"
          ? LogScrubField.Attributes
          : TraceScrubField.All,
    };
  }

  const pattern: string | null = isCustomDataTypeId(data.dataTypeId)
    ? null
    : buildScrubPatternForDataType(data.dataTypeId);

  if (pattern !== null) {
    return {
      patternType: SCRUB_RULE_CUSTOM_PATTERN_TYPE,
      customRegex: pattern,
      scrubAction: redactAction(target.signal),
      fieldsToScrub: fieldsToScrubFor(target),
    };
  }

  throw new BadDataException(noRuleReason(data.dataTypeId, data.location));
}

function cut(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength - 1) + "…" : text;
}

function describeFields(plan: ScrubRulePlan, signal: ScrubRuleSignal): string {
  const records: string = signal === "log" ? "log" : "span";

  switch (plan.fieldsToScrub) {
    case LogScrubField.Body:
      return "log bodies";
    case TraceScrubField.Events:
      return "span events and exceptions";
    case TraceScrubField.Name:
      return "span names";
    default:
      return `${records} attribute values`;
  }
}

function describeRule(data: {
  plan: ScrubRulePlan;
  signal: ScrubRuleSignal;
  dataTypeName: string;
  location: string;
  kind: DataStoreKind;
}): string {
  const origin: string = `Made by Data Security ("Scrub it") from a finding of ${data.dataTypeName} in ${data.location} (${data.kind}).`;

  if (data.plan.patternType === SCRUB_RULE_SENSITIVE_KEYS_PATTERN_TYPE) {
    return cut(
      `${origin} It hides the whole value of every attribute whose key looks sensitive - password, token, secret, cookie, ... - and every value under such a key inside a list, a map, a log body or a JSON text, from now on. What is stored already stays until its retention ends.`,
      MAX_RULE_DESCRIPTION_LENGTH,
    );
  }

  const verb: string =
    data.plan.scrubAction === LogScrubAction.Mask ? "masks" : "redacts";

  return cut(
    `${origin} It ${verb} every ${data.dataTypeName.toLowerCase()} in ${describeFields(data.plan, data.signal)} from now on. What is stored already stays until its retention ends.`,
    MAX_RULE_DESCRIPTION_LENGTH,
  );
}

/*
 * The props a rule is made with. With a person, as that person - their
 * membership and the scrub rule table's own create permission (Project
 * Owner, Project Admin, Create Project Log / Trace Scrub Rule) are checked
 * by the service, as for a rule made in the dashboard, and a person without
 * them is refused. Without one, as OneUptime itself: only for a caller that
 * has checked the person's right to create the rule itself.
 */
async function propsFor(data: {
  projectId: ObjectID;
  userId?: ObjectID | undefined;
}): Promise<DatabaseCommonInteractionProps> {
  if (!data.userId) {
    return { isRoot: true };
  }

  return await WorkspaceActionAuthorization.getProjectMemberProps({
    userId: data.userId,
    projectId: data.projectId,
  });
}

// Why Scrub It cannot hide a metric's name, in a sentence a person can act on.
export const METRIC_NAME_NOT_SCRUBBABLE: string =
  "A metric's name is set by the code that creates the metric, and a pipeline rule can only rename a metric whole. Rename the metric so its name carries no data, and send what varies in it as an attribute instead.";

// Why Scrub It cannot hide a session's own details.
export const SESSION_DETAILS_NOT_SCRUBBABLE: string =
  "Session details come from the RUM recorder, which scrub rules do not reach. Turn off user identity capture or leave this out of identify() and the session's attributes instead.";

/*
 * The Redact Attribute rule "Scrub it" makes for a metric attribute: it
 * hides the key's values in its service's new metrics - those of the data
 * type's shape, or all of them where no pattern finds the type. Refuses a
 * key longer than a rule can name, and a service that is gone.
 */
export function buildMetricScrubRule(data: {
  projectId: ObjectID;
  serviceId?: ObjectID | string | null | undefined;
  kind: DataStoreKind;
  dataTypeId: string;
  location: string;
  target: ScrubTarget;
}): MetricPipelineRule {
  const key: string = data.target.key || "";
  const serviceId: string = data.serviceId ? data.serviceId.toString() : "";

  if (key.length > MAX_METRIC_RULE_ATTRIBUTE_KEY_LENGTH) {
    throw new BadDataException(
      `A metric pipeline rule names an attribute in at most ${MAX_METRIC_RULE_ATTRIBUTE_KEY_LENGTH} characters, and ${data.location} is longer. Rename the attribute, or stop sending it.`,
    );
  }

  if (!ObjectID.isValidUUID(serviceId)) {
    throw new BadDataException(
      "The service these metrics were sent under no longer exists, so no new metrics of it are left to scrub.",
    );
  }

  const filters: Array<MetricPipelineRuleFilterCondition> =
    buildMetricScrubFilters(data.dataTypeId, key);
  const dataTypeName: string = dataTypeNameOf(data.dataTypeId);
  const name: string = cut(
    `${DATA_SECURITY_SCRUB_RULE_NAME_PREFIX}${dataTypeName} in ${data.location}`,
    MAX_METRIC_RULE_NAME_LENGTH,
  );
  const which: string =
    filters.length > 0
      ? `every value of ${key} that holds ${dataTypeName.toLowerCase()}`
      : `every value of ${key}`;
  const rule: MetricPipelineRule = new MetricPipelineRule();

  rule.projectId = data.projectId;
  rule.serviceId = new ObjectID(serviceId);
  rule.name = name;
  rule.description = cut(
    `Made by Data Security ("Scrub it") from a finding of ${dataTypeName} in ${data.location} (${data.kind}). It replaces ${which} with ${METRIC_REDACT_REPLACEMENT} in this service's metrics from now on. What is stored already stays until its retention ends.`,
    MAX_RULE_DESCRIPTION_LENGTH,
  );
  rule.ruleType = MetricPipelineRuleType.RedactAttribute;
  rule.addAttributeKey = key;
  rule.redactReplacement = METRIC_REDACT_REPLACEMENT;
  rule.filterCondition = FilterCondition.All;
  rule.filters = filters;
  rule.isEnabled = true;

  return rule;
}

// "Scrub it" on a metric attribute: its rule, made as the person who asked.
async function createMetricScrubRule(data: {
  projectId: ObjectID;
  userId?: ObjectID | undefined;
  serviceId?: ObjectID | string | null | undefined;
  kind: DataStoreKind;
  dataTypeId: string;
  location: string;
  target: ScrubTarget;
}): Promise<CreatedScrubRule> {
  const rule: MetricPipelineRule = buildMetricScrubRule(data);
  const created: MetricPipelineRule = await MetricPipelineRuleService.create({
    data: rule,
    props: await propsFor(data),
  });

  return {
    signal: "metric",
    scrubRuleId: idOf(created),
    scrubRuleName: created.name || rule.name || "",
  };
}

/*
 * "Scrub it" on a telemetry finding: the log or trace scrub rule, or the
 * metric pipeline rule, that hides its data type at its location from now
 * on - or the enabled rule that already does. Refuses (BadDataException) a
 * store that is not telemetry, a location no rule reaches (a session's own
 * details, a metric's name), and a data type no rule can find.
 */
export async function createScrubRuleForFinding(data: {
  projectId: ObjectID;
  userId?: ObjectID | undefined;
  kind: DataStoreKind;
  dataTypeId: string;
  location: string;
  // The service the store is the telemetry of: a metric rule is its own.
  serviceId?: ObjectID | string | null | undefined;
}): Promise<CreatedScrubRule> {
  if (
    !isDataStoreKind(data.kind) ||
    !TELEMETRY_DATA_STORE_KINDS.includes(data.kind)
  ) {
    throw new BadDataException(
      `Scrub rules hide telemetry as it arrives; a finding in a ${String(data.kind)} store is not telemetry.`,
    );
  }

  const location: string = (data.location || "").trim();
  const dataTypeId: string = (data.dataTypeId || "").trim();

  if (!location || !dataTypeId) {
    throw new BadDataException("The finding has no data type or location.");
  }

  switch (getScrubUnavailableReason(data.kind, location)) {
    case TelemetryScrubUnavailableReason.SessionDetails:
      throw new BadDataException(SESSION_DETAILS_NOT_SCRUBBABLE);
    case TelemetryScrubUnavailableReason.MetricName:
      throw new BadDataException(METRIC_NAME_NOT_SCRUBBABLE);
    default:
      break;
  }

  const target: ScrubTarget | null = getScrubTarget(data.kind, location);

  if (!target) {
    throw new BadDataException(
      `No scrub rule reaches ${location} of ${data.kind}.`,
    );
  }

  const existing: CoveringScrubRule | null = findCoveringScrubRule(
    await getScrubCoverage(data.projectId),
    { kind: data.kind, dataTypeId, location, serviceId: data.serviceId },
  );

  if (existing) {
    return {
      signal: existing.signal,
      scrubRuleId: existing.id,
      scrubRuleName: existing.name,
    };
  }

  if (target.signal === "metric") {
    return await createMetricScrubRule({
      ...data,
      dataTypeId,
      location,
      target,
    });
  }

  const plan: ScrubRulePlan = planScrubRule({ dataTypeId, location, target });
  const dataTypeName: string = dataTypeNameOf(dataTypeId);
  const name: string = cut(
    `${DATA_SECURITY_SCRUB_RULE_NAME_PREFIX}${dataTypeName} in ${location}`,
    MAX_RULE_NAME_LENGTH,
  );
  const description: string = describeRule({
    plan,
    signal: target.signal,
    dataTypeName,
    location,
    kind: data.kind,
  });
  const props: DatabaseCommonInteractionProps = await propsFor(data);

  if (target.signal === "log") {
    const rule: LogScrubRule = new LogScrubRule();
    rule.projectId = data.projectId;
    rule.name = name;
    rule.description = description;
    rule.patternType = plan.patternType;
    rule.scrubAction = plan.scrubAction;
    rule.fieldsToScrub = plan.fieldsToScrub;
    rule.isEnabled = true;

    if (plan.customRegex) {
      rule.customRegex = plan.customRegex;
    }

    const created: LogScrubRule = await LogScrubRuleService.create({
      data: rule,
      props,
    });

    return {
      signal: "log",
      scrubRuleId: idOf(created),
      scrubRuleName: created.name || name,
    };
  }

  const rule: TraceScrubRule = new TraceScrubRule();
  rule.projectId = data.projectId;
  rule.name = name;
  rule.description = description;
  rule.patternType = plan.patternType;
  rule.scrubAction = plan.scrubAction;
  rule.fieldsToScrub = plan.fieldsToScrub;
  rule.isEnabled = true;

  if (plan.customRegex) {
    rule.customRegex = plan.customRegex;
  }

  const created: TraceScrubRule = await TraceScrubRuleService.create({
    data: rule,
    props,
  });

  return {
    signal: "trace",
    scrubRuleId: idOf(created),
    scrubRuleName: created.name || name,
  };
}

function idOf(
  rule: LogScrubRule | TraceScrubRule | MetricPipelineRule,
): string {
  const id: string | undefined = rule.id?.toString() || rule._id?.toString();

  if (!id) {
    throw new BadDataException("The scrub rule was not saved.");
  }

  return id;
}
