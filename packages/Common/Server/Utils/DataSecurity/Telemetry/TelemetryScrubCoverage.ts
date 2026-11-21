import LogScrubRule from "../../../../Models/DatabaseModels/LogScrubRule";
import MetricPipelineRule from "../../../../Models/DatabaseModels/MetricPipelineRule";
import Service from "../../../../Models/DatabaseModels/Service";
import TraceScrubRule from "../../../../Models/DatabaseModels/TraceScrubRule";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import DataCategory from "../../../../Types/DataSecurity/DataCategory";
import {
  DataTypeInfo,
  getBuiltInDataType,
} from "../../../../Types/DataSecurity/DataTypeCatalog";
import { readTelemetryDataStoreKeyOwnerId } from "../../../../Types/DataSecurity/DataStoreKey";
import {
  DataStoreKind,
  isDataStoreKind,
  TELEMETRY_DATA_STORE_KINDS,
} from "../../../../Types/DataSecurity/DataStoreKind";
import {
  getScrubTarget,
  getScrubUnavailableReason,
  isMetricNameFinding,
  ScrubbedField,
  ScrubRuleSignal,
  ScrubTarget,
  TelemetryScrubUnavailableReason,
} from "../../../../Types/DataSecurity/TelemetryScrubTarget";
import { DataSecurityDropMetricUnavailableReason } from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
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
  DATA_TYPE_OF_SCRUB_PATTERN_TYPE,
  doesScrubRuleScrubNothing,
  LOG_SCRUB_FIELDS,
  SCRUB_RULE_SENSITIVE_KEY_REGEX,
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
import { getScrubRuleServiceId } from "../../../../Types/Telemetry/ScrubRuleScope";
import TraceScrubAction from "../../../../Types/Trace/TraceScrubAction";
import TraceScrubField from "../../../../Types/Trace/TraceScrubField";
import { isCustomDataTypeId } from "../../../../Utils/DataSecurity/CustomDataTypeDetector";
import { DataTypeDetector } from "../../../../Utils/DataSecurity/Detector";
import { getBuiltInDetectorsOf } from "../../../../Utils/DataSecurity/Detectors/Index";
import { PatternProblemReason } from "../../../../Utils/LinearRegExp/PatternProblem";
import { CORRELATION_ID_ATTRIBUTE_KEYS } from "../../../../Utils/Telemetry/CorrelationIdAttributes";
import LogScrubRuleService from "../../../Services/LogScrubRuleService";
import MetricPipelineRuleService from "../../../Services/MetricPipelineRuleService";
import ServiceService from "../../../Services/ServiceService";
import TraceScrubRuleService from "../../../Services/TraceScrubRuleService";
import WorkspaceActionAuthorization from "../../Workspace/WorkspaceActionAuthorization";
import ProjectDataTypeNames from "../ProjectDataTypeNames";

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
 *
 * What a rule can do with such a name, until the code is fixed, is drop the
 * new data points of every metric of the service whose name has the data
 * type's shape (Drop This Metric, #9757): a Drop rule with a "Matches Regex"
 * filter on the metric's name, of the pattern above. It loses those points
 * for good, so it is never made by Scrub It, only when a person asks for it
 * after reading what it drops (TelemetryMetricDrop). Such a rule covers the
 * name finding, as does a Drop rule with no filter at all, for the service
 * or the project, which stores none of its metrics - and so covers every
 * finding in them.
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
  /*
   * The service it is for; none for every service. A metric pipeline
   * rule's, and a log or trace scrub rule's since #10433: such a rule hides
   * data in its service's records only, so it covers that service's
   * findings only.
   */
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
 * LogScrubRuleService.ts and TraceScrubRuleService.ts), kept in Common
 * (Types/Telemetry/ScrubRule) because Common cannot import from App.
 * TelemetryScrubCoverage.test.ts reads both and fails when they differ.
 */
export const INGEST_SENSITIVE_KEY_REGEX: RegExp =
  SCRUB_RULE_SENSITIVE_KEY_REGEX;

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

// The data type each built-in pattern type finds (Types/Telemetry/ScrubRule).
export { DATA_TYPE_OF_SCRUB_PATTERN_TYPE };

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

/*
 * The rule columns' lengths: character varying(100) for a name since
 * WidenThingNameColumns (1808992530000), and (500) for a description.
 */
const MAX_RULE_NAME_LENGTH: number = ColumnLength.ShortText;
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

/*
 * The filters a Drop rule for a metric's name holding a data type has: the
 * name has the type's shape (buildScrubPatternForDataType) - or null when no
 * pattern can find the type, so no rule can tell those metrics apart.
 */
export function buildMetricDropFilters(
  dataTypeId: string,
): Array<MetricPipelineRuleFilterCondition> | null {
  const pattern: string | null = isCustomDataTypeId(dataTypeId)
    ? null
    : buildScrubPatternForDataType(dataTypeId);

  return pattern === null
    ? null
    : [
        {
          checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
          conditionType: MetricPipelineRuleFilterConditionType.MatchesRegex,
          value: pattern,
        },
      ];
}

function isRuleOfService(
  rule: CoveringScrubRule,
  finding: TelemetryFindingReference,
): boolean {
  const findingServiceId: string = finding.serviceId
    ? finding.serviceId.toString().toLowerCase()
    : "";

  return !rule.serviceId || rule.serviceId.toLowerCase() === findingServiceId;
}

/*
 * Whether an enabled metric pipeline Drop rule keeps a metrics finding's data
 * from being stored: one with no filter, for its service or the project,
 * drops every point of the service's metrics; one with exactly the filter
 * Drop This Metric makes drops those whose name holds the finding's type -
 * which covers a finding in the name.
 */
function dropRuleCovers(
  rule: CoveringScrubRule,
  finding: TelemetryFindingReference,
): boolean {
  if (
    rule.signal !== "metric" ||
    rule.patternType !== MetricPipelineRuleType.Drop ||
    finding.kind !== DataStoreKind.TelemetryMetrics ||
    !isRuleOfService(rule, finding)
  ) {
    return false;
  }

  const filters: Array<MetricPipelineRuleFilterCondition> = rule.filters || [];

  if (filters.length === 0) {
    return true;
  }

  const dropFilters: Array<MetricPipelineRuleFilterCondition> | null =
    isMetricNameFinding(finding.kind, finding.location)
      ? buildMetricDropFilters(finding.dataTypeId)
      : null;

  return (
    dropFilters !== null &&
    filters.length === dropFilters.length &&
    filters.map(filterText).every((text: string, index: number): boolean => {
      return text === filterText(dropFilters[index]!);
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

  // A rule for one service hides nothing in another's records (#10433).
  if (!isRuleOfService(rule, finding)) {
    return false;
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

// The first enabled rule that hides a finding at ingest - or drops it - or null.
export function findCoveringScrubRule(
  coverage: ScrubCoverage,
  finding: TelemetryFindingReference,
): CoveringScrubRule | null {
  const target: ScrubTarget | null = getScrubTarget(
    finding.kind,
    finding.location,
  );

  for (const rule of coverage.rules) {
    if (
      (target && ruleCovers(rule, target, finding)) ||
      dropRuleCovers(rule, finding)
    ) {
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

  const covering: CoveringScrubRule = {
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
  const serviceId: string = getScrubRuleServiceId(rule);

  if (serviceId) {
    covering.serviceId = serviceId;
  }

  return covering;
}

/*
 * An enabled metric pipeline rule that hides an attribute's value (Redact
 * or Remove Attribute), or drops points (Drop), as a covering rule, or null
 * for any other rule.
 */
export function toCoveringMetricRule(
  rule: MetricPipelineRule,
): CoveringScrubRule | null {
  const id: string | undefined = rule.id?.toString() || rule._id?.toString();
  const attributeKey: string = (rule.addAttributeKey || "").trim();
  const isDrop: boolean = rule.ruleType === MetricPipelineRuleType.Drop;

  if (
    !id ||
    typeof rule.ruleType !== "string" ||
    (!isDrop && (!attributeKey || !METRIC_HIDING_RULE_TYPES.has(rule.ruleType)))
  ) {
    return null;
  }

  const covering: CoveringScrubRule = {
    id,
    name: rule.name || "",
    signal: "metric",
    patternType: rule.ruleType,
    // A Drop rule's filters name the metric: no attribute is its part.
    fieldsToScrub: isDrop ? ScrubbedField.Name : ScrubbedField.Attributes,
    filters: Array.isArray(rule.filters) ? rule.filters : [],
  };

  if (!isDrop) {
    covering.attributeKey = attributeKey;
  }
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
        // A rule for one service covers that service's findings only (#10433).
        serviceId: true,
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
        serviceId: true,
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

// The rule Scrub It makes for a finding: what it finds, does, and where in the record.
export interface ScrubRulePlan {
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

// A built-in type by its name; one of the project's own as one, never by its id.
function dataTypeNameOf(dataTypeId: string): string {
  return DataTypeNamer.withoutCustomTypes().nameOf(dataTypeId);
}

/*
 * What a rule Scrub It makes calls the type it scrubs, in its name and its
 * description: one of the project's own by the name the project gave it
 * (#10363), read only for such a type - else the name its finding kept -
 * and a built-in one by the catalog's.
 */
async function nameTypeForRule(data: {
  projectId: ObjectID;
  dataTypeId: string;
  // The name the finding kept when it was found.
  dataTypeName?: string | null | undefined;
}): Promise<string> {
  if (!isCustomDataTypeId(data.dataTypeId)) {
    return dataTypeNameOf(data.dataTypeId);
  }

  return (
    await ProjectDataTypeNames.read({ projectId: data.projectId })
  ).nameOf(data.dataTypeId, data.dataTypeName);
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

export function planScrubRule(data: {
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

/*
 * WHERE SCRUB IT'S RULE APPLIES (#10433).
 *
 * A finding is evidence about one service's telemetry, so Scrub It's log or
 * trace rule is that service's (LogScrubRule.serviceId): it hides the data
 * in the logs or spans the service sends, and changes no other service's -
 * nor breaks the monitors and recording rules that read them. A metric's
 * rule always was its service's (buildMetricScrubRule).
 *
 * A RUM application's session replays are the one exception: a rule names a
 * service, never an application, so Scrub It's rule for a replay's logs or
 * spans applies to every service and app of the project - and says so, in
 * the dialog, the rule's name and its description.
 */
export interface ScrubRuleScopeOfFinding {
  // The service the rule is for; null for every service and app of the project.
  serviceId: ObjectID | null;
  // The service's name; "" for every service.
  serviceName: string;
}

export const EVERY_SERVICE_SCRUB_SCOPE: ScrubRuleScopeOfFinding = {
  serviceId: null,
  serviceName: "",
};

// Why Scrub It makes no rule for a service that is gone, in a sentence a person can act on.
export const SCRUB_SERVICE_GONE: string =
  "The service this telemetry was sent under no longer exists, so no new telemetry of it is left to scrub.";

/*
 * The service a finding's telemetry was sent under, as its store names it:
 * the store's own serviceId, else the owner its key names (a store made
 * before stores kept the column). None for a RUM application's session
 * replays, whose owner is no service.
 */
export function readFindingServiceId(data: {
  kind: DataStoreKind | string | null | undefined;
  serviceId?: ObjectID | string | null | undefined;
  storeKey?: string | null | undefined;
}): string {
  if (data.kind === DataStoreKind.TelemetrySessionReplays) {
    return "";
  }

  const own: string = data.serviceId ? data.serviceId.toString().trim() : "";

  if (ObjectID.isValidUUID(own)) {
    return own.toLowerCase();
  }

  const fromKey: string =
    readTelemetryDataStoreKeyOwnerId(data.storeKey || null) || "";

  return ObjectID.isValidUUID(fromKey) ? fromKey.toLowerCase() : "";
}

/*
 * Where Scrub It's log or trace rule for a finding applies: its service,
 * read with its name, or every service for a RUM application's replays.
 * Refuses (BadDataException) a service-owned store whose service is gone:
 * a rule for every service instead would change what nobody found
 * anything in.
 */
export async function readScrubScopeOfFinding(data: {
  projectId: ObjectID;
  kind: DataStoreKind;
  serviceId?: ObjectID | string | null | undefined;
  storeKey?: string | null | undefined;
}): Promise<ScrubRuleScopeOfFinding> {
  if (data.kind === DataStoreKind.TelemetrySessionReplays) {
    return EVERY_SERVICE_SCRUB_SCOPE;
  }

  const serviceId: string = readFindingServiceId(data);

  if (!serviceId) {
    throw new BadDataException(SCRUB_SERVICE_GONE);
  }

  const service: Service | null = await ServiceService.findOneBy({
    query: { projectId: data.projectId, _id: serviceId },
    select: { _id: true, name: true },
    props: { isRoot: true },
  });

  if (!service) {
    throw new BadDataException(SCRUB_SERVICE_GONE);
  }

  return {
    serviceId: new ObjectID(serviceId),
    serviceName: (service.name || "").trim() || "Service",
  };
}

// What a rule does with a match, as a verb its description uses.
function actionVerb(scrubAction: string): string {
  switch (scrubAction) {
    case LogScrubAction.Mask:
      return "masks";
    case LogScrubAction.Hash:
      return "hashes";
    default:
      return "redacts";
  }
}

// The parts of the records a rule scrubs, as its name says them.
function fieldsNoun(plan: ScrubRulePlan, signal: ScrubRuleSignal): string {
  if (signal === "log") {
    switch (plan.fieldsToScrub) {
      case LogScrubField.Body:
        return "log bodies";
      case LogScrubField.Attributes:
        return "log attributes";
      default:
        return "logs";
    }
  }

  switch (plan.fieldsToScrub) {
    case TraceScrubField.Attributes:
      return "span attributes";
    case TraceScrubField.Events:
      return "span events";
    case TraceScrubField.Name:
      return "span names";
    default:
      return "spans";
  }
}

// The same parts, as a sentence of its description says them.
function describeFields(plan: ScrubRulePlan, signal: ScrubRuleSignal): string {
  switch (plan.fieldsToScrub) {
    case LogScrubField.Body:
      return "log bodies";
    case LogScrubField.Both:
      return "log bodies and attribute values";
    case TraceScrubField.Events:
      return "span events and exceptions";
    case TraceScrubField.Name:
      return "span names";
    case TraceScrubField.All:
      return "span names, attributes, events and exceptions";
    default:
      return signal === "log" ? "log attribute values" : "span attribute values";
  }
}

// The records a rule applies to, as its description says them.
function describeScope(
  scope: ScrubRuleScopeOfFinding,
  signal: ScrubRuleSignal,
): string {
  const records: string = signal === "log" ? "logs" : "spans";

  return scope.serviceId
    ? `${scope.serviceName}'s ${records} only: other services' ${records} are not changed`
    : `the ${records} of every service and app in the project`;
}

/*
 * The name of the rule Scrub It makes: what it hides, in which parts of the
 * records, and whose - "Data Security: Email address in log attributes of
 * checkout". It hides every value of the type there, not one attribute's,
 * so the finding's own place is said in its description, not its name.
 */
export function nameScrubItRule(data: {
  plan: ScrubRulePlan;
  signal: ScrubRuleSignal;
  dataTypeName: string;
  scope: ScrubRuleScopeOfFinding;
}): string {
  const owner: string = data.scope.serviceId
    ? ` of ${data.scope.serviceName}`
    : "";

  return cut(
    `${DATA_SECURITY_SCRUB_RULE_NAME_PREFIX}${data.dataTypeName} in ${fieldsNoun(data.plan, data.signal)}${owner}`,
    MAX_RULE_NAME_LENGTH,
  );
}

function describeRule(data: {
  plan: ScrubRulePlan;
  signal: ScrubRuleSignal;
  dataTypeName: string;
  location: string;
  kind: DataStoreKind;
  scope: ScrubRuleScopeOfFinding;
}): string {
  const origin: string = `Made by Data Security ("Scrub it") from a finding of ${data.dataTypeName} in ${data.location} (${data.kind}).`;
  const applies: string = `It applies to ${describeScope(data.scope, data.signal)}.`;

  if (data.plan.patternType === SCRUB_RULE_SENSITIVE_KEYS_PATTERN_TYPE) {
    return cut(
      `${origin} It ${actionVerb(data.plan.scrubAction)} the whole value of every attribute whose key looks sensitive - password, token, secret, cookie, ... - and every value under such a key inside a list, a map, a log body or a JSON text, from now on. ${applies} What is stored already stays until its retention ends.`,
      MAX_RULE_DESCRIPTION_LENGTH,
    );
  }

  return cut(
    `${origin} It ${actionVerb(data.plan.scrubAction)} every ${data.dataTypeName.toLowerCase()} in ${describeFields(data.plan, data.signal)} from now on. ${applies} What is stored already stays until its retention ends.`,
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
  // What the rule calls the type (nameTypeForRule); the catalog's name when left out.
  dataTypeName?: string | undefined;
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
  const dataTypeName: string =
    data.dataTypeName || dataTypeNameOf(data.dataTypeId);
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
  dataTypeName?: string | null | undefined;
  location: string;
  target: ScrubTarget;
}): Promise<CreatedScrubRule> {
  // Refused before anything is read for a rule that cannot be made.
  let rule: MetricPipelineRule = buildMetricScrubRule({
    ...data,
    dataTypeName: undefined,
  });

  if (isCustomDataTypeId(data.dataTypeId)) {
    rule = buildMetricScrubRule({
      ...data,
      dataTypeName: await nameTypeForRule(data),
    });
  }
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

// What the name of the rule Drop This Metric makes says after the prefix.
export const METRIC_DROP_RULE_NAME: string = "drop metrics named with ";

/*
 * Why the metrics whose names hold a finding's data cannot be dropped by a
 * rule, or null when they can: a finding that is no metric's name, a data
 * type no pattern finds (found by field names, by the words around it, or
 * one of the project's own), a service that is gone.
 */
export function getMetricDropUnavailableReason(data: {
  kind: DataStoreKind | string | null | undefined;
  location: string | null | undefined;
  dataTypeId: string;
  serviceId?: ObjectID | string | null | undefined;
}): DataSecurityDropMetricUnavailableReason | null {
  if (!isMetricNameFinding(data.kind, data.location)) {
    return DataSecurityDropMetricUnavailableReason.NotAMetricName;
  }

  if (!buildMetricDropFilters((data.dataTypeId || "").trim())) {
    return DataSecurityDropMetricUnavailableReason.NoPattern;
  }

  const serviceId: string = data.serviceId ? data.serviceId.toString() : "";

  return ObjectID.isValidUUID(serviceId)
    ? null
    : DataSecurityDropMetricUnavailableReason.NoService;
}

// Why no drop can be made, in a sentence a person can act on.
export const METRIC_DROP_UNAVAILABLE_SENTENCES: Readonly<
  Record<DataSecurityDropMetricUnavailableReason, string>
> = {
  [DataSecurityDropMetricUnavailableReason.NotAMetricName]:
    "Drop This Metric is for findings in a metric's name. Scrub It hides the other findings in metrics.",
  [DataSecurityDropMetricUnavailableReason.NoPattern]:
    "No pattern can find this data type in a metric's name, so no rule could tell those metrics apart. Rename the metrics in your code, and send what varies in their names as an attribute instead.",
  [DataSecurityDropMetricUnavailableReason.NoService]:
    "The service these metrics were sent under no longer exists, so no new metrics of it are left to drop.",
};

/*
 * The Drop rule "Drop This Metric" makes for a finding in a metric's name:
 * every new data point of the service's metrics whose name has the data
 * type's shape is dropped before it is stored. Refuses what
 * getMetricDropUnavailableReason refuses.
 */
export function buildMetricDropRule(data: {
  projectId: ObjectID;
  serviceId?: ObjectID | string | null | undefined;
  kind: DataStoreKind;
  dataTypeId: string;
  location: string;
}): MetricPipelineRule {
  const reason: DataSecurityDropMetricUnavailableReason | null =
    getMetricDropUnavailableReason(data);

  if (reason) {
    throw new BadDataException(METRIC_DROP_UNAVAILABLE_SENTENCES[reason]);
  }

  const dataTypeName: string = dataTypeNameOf(data.dataTypeId);
  const rule: MetricPipelineRule = new MetricPipelineRule();

  rule.projectId = data.projectId;
  rule.serviceId = new ObjectID(data.serviceId!.toString());
  rule.name = cut(
    `${DATA_SECURITY_SCRUB_RULE_NAME_PREFIX}${METRIC_DROP_RULE_NAME}${dataTypeName}`,
    MAX_METRIC_RULE_NAME_LENGTH,
  );
  rule.description = cut(
    `Made by Data Security ("Drop This Metric") from a finding of ${dataTypeName} in this service's metric names. It drops every new data point of the service's metrics whose name holds ${dataTypeName.toLowerCase()} before it is stored: those points are lost for good. What is stored already stays until its retention ends. Delete this rule to store them again.`,
    MAX_RULE_DESCRIPTION_LENGTH,
  );
  rule.ruleType = MetricPipelineRuleType.Drop;
  rule.filterCondition = FilterCondition.All;
  rule.filters = buildMetricDropFilters(data.dataTypeId)!;
  rule.isEnabled = true;

  return rule;
}

/*
 * Drop This Metric on a finding in a metric's name: the Drop rule for its
 * service, made as the person who asked - their permission to create metric
 * pipeline rules checked by the service, and the rule's creation recorded
 * in the project's audit log with them as its author - or the enabled rule
 * that already drops those metrics. Refuses what buildMetricDropRule does.
 */
export async function createDropRuleForFinding(data: {
  projectId: ObjectID;
  userId?: ObjectID | undefined;
  kind: DataStoreKind;
  dataTypeId: string;
  location: string;
  serviceId?: ObjectID | string | null | undefined;
}): Promise<{ ruleId: string; ruleName: string; isNew: boolean }> {
  const location: string = (data.location || "").trim();
  const dataTypeId: string = (data.dataTypeId || "").trim();
  const rule: MetricPipelineRule = buildMetricDropRule({
    ...data,
    location,
    dataTypeId,
  });
  const existing: CoveringScrubRule | null = findCoveringScrubRule(
    await getScrubCoverage(data.projectId),
    { kind: data.kind, dataTypeId, location, serviceId: data.serviceId },
  );

  if (existing) {
    return { ruleId: existing.id, ruleName: existing.name, isNew: false };
  }

  const created: MetricPipelineRule = await MetricPipelineRuleService.create({
    data: rule,
    props: await propsFor(data),
  });

  return {
    ruleId: idOf(created),
    ruleName: created.name || rule.name || "",
    isNew: true,
  };
}

/*
 * "Scrub it" on a telemetry finding: the log or trace scrub rule, or the
 * metric pipeline rule, that hides its data type at its location from now
 * on - or the enabled rule that already does. Refuses (BadDataException) a
 * store that is not telemetry, a location no rule reaches (a session's own
 * details, a metric's name), and a data type no rule can find.
 */
/*
 * Where a finding's data would be scrubbed, or why it cannot be: a store
 * that is not telemetry, a location no rule reaches (a session's own
 * details, a metric's name). Refuses with BadDataException, in the words
 * Scrub It answers with.
 */
export function readScrubbableTarget(data: {
  kind: DataStoreKind;
  dataTypeId: string;
  location: string;
}): { location: string; dataTypeId: string; target: ScrubTarget } {
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

  return { location, dataTypeId, target };
}

// The rule Scrub It would make for a finding, as a person reads it before it is made.
export interface ScrubRulePreview {
  signal: ScrubRuleSignal;
  name: string;
  description: string;
}

/*
 * The rule "Scrub it" would make for a finding, without making it: what a
 * proposal of OneUptime AI's shows a person before they approve it
 * (Server/Utils/AI/DataSecurity/Actions/ScrubTelemetryAction, #10364).
 * Refuses (BadDataException) what createScrubRuleForFinding refuses for a
 * finding no rule covers yet, in the same words. It does not look for a
 * rule that already covers the finding: its caller does.
 */
export async function previewScrubRuleForFinding(data: {
  projectId: ObjectID;
  kind: DataStoreKind;
  dataTypeId: string;
  dataTypeName?: string | null | undefined;
  location: string;
  serviceId?: ObjectID | string | null | undefined;
  storeKey?: string | null | undefined;
}): Promise<ScrubRulePreview> {
  const scrubbable: {
    location: string;
    dataTypeId: string;
    target: ScrubTarget;
  } = readScrubbableTarget(data);

  if (scrubbable.target.signal === "metric") {
    const rule: MetricPipelineRule = buildMetricScrubRule({
      projectId: data.projectId,
      serviceId: data.serviceId,
      kind: data.kind,
      dataTypeId: scrubbable.dataTypeId,
      location: scrubbable.location,
      target: scrubbable.target,
      dataTypeName: isCustomDataTypeId(scrubbable.dataTypeId)
        ? await nameTypeForRule({
            projectId: data.projectId,
            dataTypeId: scrubbable.dataTypeId,
            dataTypeName: data.dataTypeName,
          })
        : undefined,
    });

    return {
      signal: "metric",
      name: rule.name || "",
      description: rule.description || "",
    };
  }

  const rule: ScrubItRule = await planScrubItRule({
    ...data,
    location: scrubbable.location,
    dataTypeId: scrubbable.dataTypeId,
    target: scrubbable.target as ScrubTarget & { signal: "log" | "trace" },
  });

  return {
    signal: rule.signal,
    name: rule.name,
    description: rule.description,
  };
}

/*
 * The log or trace scrub rule Scrub It makes for a finding no rule covers
 * yet, whole: what it finds and does (planScrubRule), the service it is for
 * (readScrubScopeOfFinding), and its name and description, which say both.
 * What the dialog shows before the rule is made, and what is made.
 */
export interface ScrubItRule {
  signal: "log" | "trace";
  plan: ScrubRulePlan;
  dataTypeId: string;
  // The type as the rule calls it: the catalog's name, or the project's own.
  dataTypeName: string;
  scope: ScrubRuleScopeOfFinding;
  name: string;
  description: string;
}

export async function planScrubItRule(data: {
  projectId: ObjectID;
  kind: DataStoreKind;
  dataTypeId: string;
  dataTypeName?: string | null | undefined;
  location: string;
  target: ScrubTarget & { signal: "log" | "trace" };
  serviceId?: ObjectID | string | null | undefined;
  storeKey?: string | null | undefined;
}): Promise<ScrubItRule> {
  // Refused first, for a type no rule can find, before anything is read.
  const plan: ScrubRulePlan = planScrubRule({
    dataTypeId: data.dataTypeId,
    location: data.location,
    target: data.target,
  });
  const [dataTypeName, scope]: [string, ScrubRuleScopeOfFinding] =
    await Promise.all([
      nameTypeForRule({
        projectId: data.projectId,
        dataTypeId: data.dataTypeId,
        dataTypeName: data.dataTypeName,
      }),
      readScrubScopeOfFinding(data),
    ]);

  return {
    signal: data.target.signal,
    plan,
    dataTypeId: data.dataTypeId,
    dataTypeName,
    scope,
    name: nameScrubItRule({
      plan,
      signal: data.target.signal,
      dataTypeName,
      scope,
    }),
    description: describeRule({
      plan,
      signal: data.target.signal,
      dataTypeName,
      location: data.location,
      kind: data.kind,
      scope,
    }),
  };
}

export async function createScrubRuleForFinding(data: {
  projectId: ObjectID;
  userId?: ObjectID | undefined;
  kind: DataStoreKind;
  dataTypeId: string;
  // The name the finding kept for its type: what the rule calls a type that is gone.
  dataTypeName?: string | null | undefined;
  location: string;
  /*
   * The service the store is the telemetry of: the rule is its own - a
   * metric rule always was, a log or trace rule since #10433.
   */
  serviceId?: ObjectID | string | null | undefined;
  // The store's key, which names its service for a store kept without one.
  storeKey?: string | null | undefined;
}): Promise<CreatedScrubRule> {
  const {
    location,
    dataTypeId,
    target,
  }: { location: string; dataTypeId: string; target: ScrubTarget } =
    readScrubbableTarget(data);

  const existing: CoveringScrubRule | null = findCoveringScrubRule(
    await getScrubCoverage(data.projectId),
    {
      kind: data.kind,
      dataTypeId,
      location,
      serviceId: readFindingServiceId(data) || data.serviceId,
    },
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

  const planned: ScrubItRule = await planScrubItRule({
    ...data,
    dataTypeId,
    location,
    target: target as ScrubTarget & { signal: "log" | "trace" },
  });
  const plan: ScrubRulePlan = planned.plan;
  const name: string = planned.name;
  const props: DatabaseCommonInteractionProps = await propsFor(data);

  if (target.signal === "log") {
    const rule: LogScrubRule = new LogScrubRule();
    rule.projectId = data.projectId;
    rule.name = name;
    rule.description = planned.description;
    rule.patternType = plan.patternType;
    rule.scrubAction = plan.scrubAction;
    rule.fieldsToScrub = plan.fieldsToScrub;
    rule.isEnabled = true;

    if (planned.scope.serviceId) {
      rule.serviceId = planned.scope.serviceId;
    }

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
  rule.description = planned.description;
  rule.patternType = plan.patternType;
  rule.scrubAction = plan.scrubAction;
  rule.fieldsToScrub = plan.fieldsToScrub;
  rule.isEnabled = true;

  if (planned.scope.serviceId) {
    rule.serviceId = planned.scope.serviceId;
  }

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
