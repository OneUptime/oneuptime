import LogScrubAction from "../../Types/Log/LogScrubAction";
import LogScrubField from "../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../Types/Log/LogScrubPatternType";
import {
  compileScrubRuleCustomRegex,
  DATA_TYPE_OF_SCRUB_PATTERN_TYPE,
  SCRUB_RULE_BUILT_IN_PATTERNS,
  SCRUB_RULE_SENSITIVE_KEY_REGEX,
  ScrubRegExp,
  scrubRegExpFromBuiltIn,
} from "../../Types/Telemetry/ScrubRule";
import { doScrubScopesMeet } from "../../Types/Telemetry/ScrubRuleScope";
import {
  SecurityEventsFieldNeed,
  SecurityEventsTelemetrySource,
  TelemetryFieldPart,
  TelemetryFieldSignal,
  TelemetryFieldUse,
} from "../../Types/Telemetry/TelemetryFieldReaders";
import TraceScrubField from "../../Types/Trace/TraceScrubField";
import { getHintedDataTypeIds } from "../DataSecurity/FieldNameHints";
import { readOwnValue } from "../LookupTable";
import { CLIENT_ADDRESS_ATTRIBUTES_READ } from "../SecurityEvent/ClientAddressTrust";
import { TRACE_SCAN_ATTRIBUTE_KEYS } from "../SecurityEvent/TelemetryScan/TraceSignals";
import { CORRELATION_ID_ATTRIBUTE_KEYS } from "./CorrelationIdAttributes";
import ScrubIpAddress from "./ScrubIpAddress";
import { TelemetryFieldReference } from "./TelemetryFieldReferences";

/*
 * WHETHER A SCRUB RULE TAKES AWAY WHAT A SAVED QUERY READS (#10433).
 *
 * A scrub rule hides values before a log or a span is stored: the matches
 * of its pattern (an email, a card number, a public IP address, a custom
 * regex) in the parts it scrubs, or the whole value of every attribute
 * whose key looks sensitive. A reference (Utils/Telemetry/
 * TelemetryFieldReferences) is one place a monitor, a dashboard, a saved
 * view, a recording rule or an SLO reads a field. The rule takes away what
 * the reference reads when it reaches the same records (the same signal,
 * services that meet, Types/Telemetry/ScrubRuleScope) and the same part of
 * them, and when it hides what the reference reads there:
 *
 *  - a filter or a search that looks for a value the rule's own pattern
 *    finds - the very pattern ingest runs (Types/Telemetry/ScrubRule) - never
 *    matches again: no record holds the value any more;
 *  - a group-by, an aggregated value, or a filter picked when it is read
 *    (a dashboard's variable), of an attribute whose values hold what the
 *    rule hides, reads what the rule left: every group "[REDACTED]", a
 *    number that is no number. Which attributes hold it is known, not
 *    guessed from a value: the attribute a finding was seen in, the ones
 *    Data Security found the type under (the caller's evidence), one whose
 *    name says it holds it ("customer_email"), and the ones the client's
 *    address is sent under, for an IP Address rule;
 *  - a filter that looks for part of a value (contains, a glob) of such an
 *    attribute, which a rule that hides the whole value makes miss;
 *  - every reading of an attribute whose key a Sensitive Attribute Keys
 *    rule hides the whole value of - but the session or conversation id
 *    that rule keeps (Utils/Telemetry/CorrelationIdAttributes).
 *
 * An exact filter of such an attribute whose value the pattern does not
 * find is left out: the rule keeps that value (a private address, "none"),
 * so the filter still matches what it matched.
 *
 * Security Events reads the logs and spans themselves (Types/Telemetry/
 * TelemetryFieldReaders, SecurityEventsFieldReads): what a rule takes from
 * it is told apart below, by what it hides (findSecurityEventsLosses).
 *
 * Pure, and the same in the server's lookup, a page and a test.
 */

// A rule, saved or about to be, as the lookup reads it.
export interface ScrubRuleReading {
  signal: TelemetryFieldSignal;
  patternType: string;
  customRegex?: string | null | undefined;
  scrubAction?: string | null | undefined;
  // As ingest reads it: the signal's default when it is left out.
  fieldsToScrub?: string | null | undefined;
  // The service it is for; none for every service.
  serviceId?: unknown;
  /*
   * The data type it hides, when it is known: a built-in pattern's own, or
   * the type Scrub It made a custom pattern for.
   */
  dataTypeId?: string | null | undefined;
}

/*
 * What the caller knows of where the rule's data type is: the attribute
 * keys that hold it, in lower case - the key a finding was seen under, and
 * the keys Data Security found the type under.
 */
export interface ScrubRuleKeyEvidence {
  keys: ReadonlySet<string>;
}

// A rule ready to be asked about many references: its pattern compiled once.
export interface CompiledScrubRuleReading {
  rule: ScrubRuleReading;
  // What the rule finds in a value; null for a Sensitive Attribute Keys rule, or a pattern that cannot run.
  regex: ScrubRegExp | null;
  isSensitiveKeysRule: boolean;
  dataTypeId: string | null;
  parts: ReadonlySet<TelemetryFieldPart>;
  // The attribute keys known to hold what it hides, in lower case.
  keysHolding: ReadonlySet<string>;
}

/*
 * The attributes an IP address is sent under by the conventions: the
 * client's (Utils/SecurityEvent/ClientAddressTrust) and a connection's two
 * ends. Their names say "address", which reads as a street's.
 */
const IP_ADDRESS_KEYS: ReadonlyArray<string> = [
  ...CLIENT_ADDRESS_ATTRIBUTES_READ,
  "source.address",
  "destination.address",
];

const IP_ADDRESS_DATA_TYPE: string = "ip-address";
const EMAIL_ADDRESS_DATA_TYPE: string = "email-address";

/*
 * The pattern a rule finds values with, as ingest compiles it: a built-in
 * one, what Data Security calls an IP address, or the rule's own regex.
 * Null for a Sensitive Attribute Keys rule (it reads keys), and for a
 * pattern ingest cannot run - such a rule hides nothing.
 */
export function compileScrubRuleValuePattern(data: {
  patternType: string;
  customRegex?: string | null | undefined;
}): ScrubRegExp | null {
  const patternType: string = (data.patternType || "").trim();

  if (patternType === LogScrubPatternType.Custom) {
    return compileScrubRuleCustomRegex(data.customRegex);
  }

  if (patternType === LogScrubPatternType.IPAddress) {
    return ScrubIpAddress.toScrubRegExp();
  }

  const builtIn: RegExp | undefined = readOwnValue(
    SCRUB_RULE_BUILT_IN_PATTERNS,
    patternType,
  );

  return builtIn ? scrubRegExpFromBuiltIn(builtIn) : null;
}

// The parts of a record a rule scrubs, as ingest runs it.
export function getScrubRuleParts(
  rule: Pick<ScrubRuleReading, "signal" | "patternType" | "fieldsToScrub">,
): Set<TelemetryFieldPart> {
  const isSensitiveKeys: boolean =
    (rule.patternType || "").trim() === LogScrubPatternType.SensitiveKeys;

  if (rule.signal === "log") {
    if (isSensitiveKeys) {
      return new Set([TelemetryFieldPart.Attributes]);
    }

    switch (rule.fieldsToScrub) {
      case LogScrubField.Body:
        return new Set([TelemetryFieldPart.Body]);
      case LogScrubField.Attributes:
        return new Set([TelemetryFieldPart.Attributes]);
      default:
        return new Set([TelemetryFieldPart.Body, TelemetryFieldPart.Attributes]);
    }
  }

  if (isSensitiveKeys) {
    return new Set([TelemetryFieldPart.Attributes, TelemetryFieldPart.Events]);
  }

  switch (rule.fieldsToScrub) {
    case TraceScrubField.Name:
      return new Set([TelemetryFieldPart.SpanName]);
    case TraceScrubField.Attributes:
      return new Set([TelemetryFieldPart.Attributes]);
    case TraceScrubField.Events:
      return new Set([TelemetryFieldPart.Events]);
    default:
      return new Set([
        TelemetryFieldPart.SpanName,
        TelemetryFieldPart.StatusMessage,
        TelemetryFieldPart.Attributes,
        TelemetryFieldPart.Events,
      ]);
  }
}

export function compileScrubRuleReading(
  rule: ScrubRuleReading,
  evidence?: ScrubRuleKeyEvidence | undefined,
): CompiledScrubRuleReading {
  const patternType: string = (rule.patternType || "").trim();
  const isSensitiveKeysRule: boolean =
    patternType === LogScrubPatternType.SensitiveKeys;
  const dataTypeId: string | null =
    (rule.dataTypeId || "").trim() ||
    readOwnValue(DATA_TYPE_OF_SCRUB_PATTERN_TYPE, patternType) ||
    null;
  const keysHolding: Set<string> = new Set<string>(
    Array.from(evidence?.keys || []).map((key: string): string => {
      return key.trim().toLowerCase();
    }),
  );

  if (dataTypeId === IP_ADDRESS_DATA_TYPE) {
    for (const key of IP_ADDRESS_KEYS) {
      keysHolding.add(key.toLowerCase());
    }
  }

  return {
    rule,
    regex: isSensitiveKeysRule ? null : compileScrubRuleValuePattern(rule),
    isSensitiveKeysRule,
    dataTypeId,
    parts: getScrubRuleParts(rule),
    keysHolding,
  };
}

// Whether a Sensitive Attribute Keys rule hides an attribute's whole value, as ingest decides.
export function isKeyHiddenBySensitiveKeysRule(key: string): boolean {
  const trimmed: string = key.trim();

  return (
    trimmed.length > 0 &&
    SCRUB_RULE_SENSITIVE_KEY_REGEX.test(trimmed.slice(0, 1_024)) &&
    !CORRELATION_ID_ATTRIBUTE_KEYS.has(trimmed)
  );
}

// Whether an attribute is known to hold what the rule hides.
function doesKeyHoldIt(compiled: CompiledScrubRuleReading, key: string): boolean {
  const lower: string = key.trim().toLowerCase();

  if (!lower) {
    return false;
  }

  if (compiled.keysHolding.has(lower)) {
    return true;
  }

  return Boolean(
    compiled.dataTypeId && getHintedDataTypeIds(key).has(compiled.dataTypeId),
  );
}

// Whether the pattern finds what it hides in a text: the very question ingest asks.
function doesPatternFind(regex: ScrubRegExp, text: string): boolean {
  try {
    return regex.matchRanges(text).length > 0;
  } catch {
    return false;
  }
}

// A filter text that matches part of a value: a glob.
function isPartialText(text: string): boolean {
  return text.includes("*") || text.includes("?");
}

/*
 * Whether the rule takes away what a reference reads: the same records and
 * part, and what the rule hides is what the reference reads there.
 */
export function doesScrubRuleTakeFrom(
  compiled: CompiledScrubRuleReading,
  reference: TelemetryFieldReference,
): boolean {
  if (
    reference.signal !== compiled.rule.signal ||
    !compiled.parts.has(reference.part) ||
    !doScrubScopesMeet(compiled.rule.serviceId, reference.serviceIds)
  ) {
    return false;
  }

  if (compiled.isSensitiveKeysRule) {
    return reference.key !== undefined
      ? isKeyHiddenBySensitiveKeysRule(reference.key)
      : false;
  }

  if (!compiled.regex) {
    return false;
  }

  const values: Array<string> = reference.values || [];
  const regex: ScrubRegExp = compiled.regex;

  // It looks for a value the rule hides: no record holds that value now.
  if (
    values.some((value: string): boolean => {
      return doesPatternFind(regex, value);
    })
  ) {
    return true;
  }

  if (reference.key === undefined || !doesKeyHoldIt(compiled, reference.key)) {
    return false;
  }

  /*
   * An attribute that holds what the rule hides: a group-by, a value or a
   * filter picked when it is read reads what the rule left; a search, or a
   * filter for part of a value, misses the values the rule hid.
   */
  if (values.length === 0) {
    return true;
  }

  return (
    reference.use === TelemetryFieldUse.Search ||
    values.some((value: string): boolean => {
      return isPartialText(value);
    })
  );
}

/*
 * ---------------------------------------------------------------------------
 * Security Events
 * ---------------------------------------------------------------------------
 */

/*
 * A value of each kind Security Events names an attack by, for asking any
 * pattern - a custom one too - whether it hides it: a public address of
 * each family (documentation ranges, which an IP Address rule hides too),
 * and an email address, which a sign-in names its user by.
 */
const ADDRESS_PROBES: ReadonlyArray<string> = ["203.0.113.7", "2001:db8::1"];
const USER_NAME_PROBES: ReadonlyArray<string> = ["alice@example.com"];

/*
 * The span attributes Security Events reads a user by (TraceSignals), and
 * the client's address by (ClientAddressTrust).
 */
const SECURITY_EVENTS_USER_KEYS: ReadonlyArray<string> =
  TRACE_SCAN_ATTRIBUTE_KEYS.userId;

/*
 * What each scan needs of each kind of record: "Your logs" reads a log
 * line's body and attributes for who signed in and from where, and follows
 * a line into its request's span for the client's address; the Traces
 * source reads a span's attributes for both.
 */
const NEEDS_OF_SOURCE: Readonly<
  Record<
    SecurityEventsTelemetrySource,
    Partial<Record<TelemetryFieldSignal, ReadonlyArray<SecurityEventsFieldNeed>>>
  >
> = {
  [SecurityEventsTelemetrySource.Logs]: {
    log: [
      SecurityEventsFieldNeed.ClientAddresses,
      SecurityEventsFieldNeed.UserNames,
    ],
    trace: [SecurityEventsFieldNeed.ClientAddresses],
  },
  [SecurityEventsTelemetrySource.Traces]: {
    trace: [
      SecurityEventsFieldNeed.ClientAddresses,
      SecurityEventsFieldNeed.UserNames,
    ],
  },
};

/*
 * Whether the rule hides one of the probe values in the part of the record
 * Security Events reads it from: a log's body or attributes, or a span's
 * attributes - by a Sensitive Attribute Keys rule only where it hides the
 * key the value is sent under.
 */
function hidesFromSecurityEvents(
  compiled: CompiledScrubRuleReading,
  probes: ReadonlyArray<string>,
  keys: ReadonlyArray<string>,
): boolean {
  const reachesParts: boolean =
    compiled.rule.signal === "log"
      ? compiled.parts.has(TelemetryFieldPart.Body) ||
        compiled.parts.has(TelemetryFieldPart.Attributes)
      : compiled.parts.has(TelemetryFieldPart.Attributes);

  if (!reachesParts) {
    return false;
  }

  if (compiled.isSensitiveKeysRule) {
    return keys.some(isKeyHiddenBySensitiveKeysRule);
  }

  const regex: ScrubRegExp | null = compiled.regex;

  return regex
    ? probes.some((probe: string): boolean => {
        return doesPatternFind(regex, probe);
      })
    : false;
}

/*
 * What a rule takes from the Security Events scans that read its records
 * (`sources`, SecurityEventsReadTelemetry):
 *
 *  - the client's address, when it hides addresses where they are read -
 *    unless it is an IP Address rule that hashes: Security Events' address
 *    vault names the address behind each such token (#10395);
 *  - who signed in or acted, when it hides email addresses and leaves no
 *    value one person keeps: a redacted or masked user is everyone, so
 *    every per-user count reads one user (#10435). A hash keeps each user
 *    apart.
 *
 * #10396 reads the first to make Scrub It hash an address Security Events
 * reads.
 */
export function findSecurityEventsLosses(
  compiled: CompiledScrubRuleReading,
  sources: ReadonlyArray<SecurityEventsTelemetrySource>,
): Array<SecurityEventsFieldNeed> {
  const needs: Set<SecurityEventsFieldNeed> = new Set<SecurityEventsFieldNeed>();

  for (const source of sources) {
    for (const need of NEEDS_OF_SOURCE[source][compiled.rule.signal] || []) {
      needs.add(need);
    }
  }

  const action: string = (compiled.rule.scrubAction || "").trim();
  const isHash: boolean = action === LogScrubAction.Hash;
  const isIpAddressRule: boolean =
    (compiled.rule.patternType || "").trim() === LogScrubPatternType.IPAddress;
  const losses: Array<SecurityEventsFieldNeed> = [];

  if (
    needs.has(SecurityEventsFieldNeed.ClientAddresses) &&
    !(isIpAddressRule && isHash) &&
    hidesFromSecurityEvents(compiled, ADDRESS_PROBES, CLIENT_ADDRESS_ATTRIBUTES_READ)
  ) {
    losses.push(SecurityEventsFieldNeed.ClientAddresses);
  }

  if (
    needs.has(SecurityEventsFieldNeed.UserNames) &&
    !isHash &&
    hidesFromSecurityEvents(compiled, USER_NAME_PROBES, SECURITY_EVENTS_USER_KEYS)
  ) {
    losses.push(SecurityEventsFieldNeed.UserNames);
  }

  return losses;
}

// The data types whose values Security Events names an attack by.
export const SECURITY_EVENTS_DATA_TYPES: ReadonlyArray<string> = [
  IP_ADDRESS_DATA_TYPE,
  EMAIL_ADDRESS_DATA_TYPE,
];
