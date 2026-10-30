import LogScrubRule from "../../../../Models/DatabaseModels/LogScrubRule";
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
import BadDataException from "../../../../Types/Exception/BadDataException";
import LogScrubAction from "../../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../Types/Log/LogScrubPatternType";
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
import LogScrubRuleService from "../../../Services/LogScrubRuleService";
import TraceScrubRuleService from "../../../Services/TraceScrubRuleService";
import WorkspaceActionAuthorization from "../../Workspace/WorkspaceActionAuthorization";

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
 * Only enabled rules count, and never one that scrubs nothing
 * (doesScrubRuleScrubNothing).
 *
 * "Scrub it" makes the rule a finding needs, once: the built-in pattern of
 * its type when there is one (masking cards, SSNs and phone numbers,
 * redacting the rest), a sensitive-keys rule for a value under a key that
 * looks sensitive, or else a custom pattern made from the type's own
 * detectors - each on the fields of the finding's location. A finding a
 * rule already covers gets that rule, not a second one.
 */

export type ScrubRuleSignal = "log" | "trace";

// Where in a record a finding sits, as scrub rules name the parts.
export enum ScrubbedField {
  Body = "body",
  Attributes = "attributes",
  Events = "events",
  Name = "name",
}

// The rules that reach a finding, and the part of the record it sits in.
export interface ScrubTarget {
  signal: ScrubRuleSignal;
  field: ScrubbedField;
  /*
   * For a value under a key - an attribute, an event's attribute - the key a
   * sensitive-keys rule reads. For an event's attribute, the last part of
   * the location: the key is at least that, so a match on it is a match on
   * the whole key.
   */
  key?: string | undefined;
}

export interface CoveringScrubRule {
  id: string;
  name: string;
  signal: ScrubRuleSignal;
  patternType: string;
  customRegex?: string | undefined;
  // As ingest reads it: the default when the rule left it empty.
  fieldsToScrub: string;
}

export interface ScrubCoverage {
  rules: Array<CoveringScrubRule>;
}

export interface TelemetryFindingReference {
  kind: DataStoreKind;
  dataTypeId: string;
  location: string;
}

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

// A count {n,m} wider than this is made open {n,} when a pattern is too large to run.
const MAX_KEPT_REPEAT: number = 64;

const ATTRIBUTES_PREFIX: string = "attributes.";
const EVENTS_PREFIX: string = "events.";
const RUM_LOGS_PREFIX: string = "logs.attributes.";
const RUM_SPANS_PREFIX: string = "spans.attributes.";
const RUM_SESSIONS_PREFIX: string = "sessions.";

function keyAfter(location: string, prefix: string): string | null {
  const key: string = location.slice(prefix.length);

  return location.startsWith(prefix) && key.length > 0 ? key : null;
}

function eventTarget(location: string): ScrubTarget | null {
  const rest: string | null = keyAfter(location, EVENTS_PREFIX);

  if (rest === null) {
    return null;
  }

  const dot: number = rest.lastIndexOf(".");

  return {
    signal: "trace",
    field: ScrubbedField.Events,
    key: dot > 0 && dot < rest.length - 1 ? rest.slice(dot + 1) : undefined,
  };
}

function attributeTarget(
  location: string,
  prefix: string,
  signal: ScrubRuleSignal,
  field: ScrubbedField,
): ScrubTarget | null {
  const key: string | null = keyAfter(location, prefix);

  return key === null ? null : { signal, field, key };
}

/*
 * Which rules reach a location of a telemetry store, and which part of the
 * record it is - or null when no scrub rule does: a session header
 * (sessions.*) is written by session replay ingest, which runs none.
 */
export function getScrubTarget(
  kind: DataStoreKind,
  location: string,
): ScrubTarget | null {
  switch (kind) {
    case DataStoreKind.TelemetryLogs:
      if (location === "body") {
        return { signal: "log", field: ScrubbedField.Body };
      }

      return attributeTarget(
        location,
        ATTRIBUTES_PREFIX,
        "log",
        ScrubbedField.Attributes,
      );
    case DataStoreKind.TelemetryTraces:
      if (location === "name") {
        return { signal: "trace", field: ScrubbedField.Name };
      }

      return (
        attributeTarget(
          location,
          ATTRIBUTES_PREFIX,
          "trace",
          ScrubbedField.Attributes,
        ) || eventTarget(location)
      );
    case DataStoreKind.TelemetryExceptions:
      // An exception is its span's exception event: the events' rules scrub it.
      if (location === "message" || location === "stackTrace") {
        return { signal: "trace", field: ScrubbedField.Events };
      }

      return attributeTarget(
        location,
        ATTRIBUTES_PREFIX,
        "trace",
        ScrubbedField.Events,
      );
    case DataStoreKind.TelemetryAiConversations: {
      if (location.startsWith(EVENTS_PREFIX)) {
        return eventTarget(location);
      }

      const attribute: ScrubTarget | null = attributeTarget(
        location,
        ATTRIBUTES_PREFIX,
        "trace",
        ScrubbedField.Attributes,
      );

      if (attribute) {
        return attribute;
      }

      // A prompt or answer, named for the span attribute it is in.
      return location.length > 0
        ? { signal: "trace", field: ScrubbedField.Attributes, key: location }
        : null;
    }
    case DataStoreKind.TelemetrySessionReplays:
      return (
        attributeTarget(
          location,
          RUM_LOGS_PREFIX,
          "log",
          ScrubbedField.Attributes,
        ) ||
        attributeTarget(
          location,
          RUM_SPANS_PREFIX,
          "trace",
          ScrubbedField.Attributes,
        )
      );
    default:
      return null;
  }
}

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

function ruleCovers(
  rule: CoveringScrubRule,
  target: ScrubTarget,
  dataTypeId: string,
): boolean {
  if (rule.signal !== target.signal) {
    return false;
  }

  if (rule.patternType === SCRUB_RULE_SENSITIVE_KEYS_PATTERN_TYPE) {
    // A key's whole value, whatever the rule's fields say - as ingest runs it.
    return (
      target.key !== undefined &&
      (target.field === ScrubbedField.Attributes ||
        target.field === ScrubbedField.Events) &&
      isSensitiveAttributeKey(target.key)
    );
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
    if (ruleCovers(rule, target, finding.dataTypeId)) {
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

// A project's enabled log and trace scrub rules, read as OneUptime itself.
export async function getScrubCoverage(
  projectId: ObjectID,
): Promise<ScrubCoverage> {
  const [logRules, traceRules]: [Array<LogScrubRule>, Array<TraceScrubRule>] =
    await Promise.all([
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
  if (
    target.key !== undefined &&
    (target.field === ScrubbedField.Attributes ||
      target.field === ScrubbedField.Events) &&
    isSensitiveAttributeKey(target.key)
  ) {
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
      `${origin} It hides the whole value of every attribute whose key looks sensitive - password, token, secret, cookie, ... - from now on. What is stored already stays until its retention ends.`,
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

/*
 * "Scrub it" on a telemetry finding: the log or trace scrub rule that hides
 * its data type at its location from now on - or the enabled rule that
 * already does. Refuses (BadDataException) a store that is not telemetry,
 * a location no scrub rule reaches, and a data type no rule can find.
 */
export async function createScrubRuleForFinding(data: {
  projectId: ObjectID;
  userId?: ObjectID | undefined;
  kind: DataStoreKind;
  dataTypeId: string;
  location: string;
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

  if (
    data.kind === DataStoreKind.TelemetrySessionReplays &&
    location.startsWith(RUM_SESSIONS_PREFIX)
  ) {
    throw new BadDataException(
      "Session details come from the RUM recorder, which scrub rules do not reach. Turn off user identity capture or leave this out of identify() and the session's attributes instead.",
    );
  }

  const target: ScrubTarget | null = getScrubTarget(data.kind, location);

  if (!target) {
    throw new BadDataException(
      `No scrub rule reaches ${location} of ${data.kind}.`,
    );
  }

  const existing: CoveringScrubRule | null = findCoveringScrubRule(
    await getScrubCoverage(data.projectId),
    { kind: data.kind, dataTypeId, location },
  );

  if (existing) {
    return {
      signal: existing.signal,
      scrubRuleId: existing.id,
      scrubRuleName: existing.name,
    };
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

function idOf(rule: LogScrubRule | TraceScrubRule): string {
  const id: string | undefined = rule.id?.toString() || rule._id?.toString();

  if (!id) {
    throw new BadDataException("The scrub rule was not saved.");
  }

  return id;
}
