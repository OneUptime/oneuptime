import { JSONObject } from "../../Types/JSON";
import { ScrubRuleSignal } from "../../Types/DataSecurity/TelemetryScrubTarget";
import LogScrubAction from "../../Types/Log/LogScrubAction";
import LogScrubField from "../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../Types/Log/LogScrubPatternType";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  LOG_SCRUB_RULE_DEFAULTS,
  TRACE_SCRUB_RULE_DEFAULTS,
} from "../../Types/Telemetry/ScrubRule";
import TraceScrubField from "../../Types/Trace/TraceScrubField";

/*
 * AN ADDRESS A SCRUB RULE HID (#10397).
 *
 * Security Events reads logs and traces after ingest's scrub rules have run
 * (App/FeatureSet/Telemetry/Services/LogScrubRuleService.ts,
 * TraceScrubRuleService.ts), so where a rule hid a client's address it
 * reads what the rule left there, never the address. That used to be
 * dropped like any value that is no address, and the event looked the same
 * as one whose request carried no address at all: nothing to block, and
 * nothing saying why.
 *
 * Now the scans tell the two apart. The value a rule leaves says that a
 * rule hid the address: "[REDACTED]" (Redact), "***.***.***.***" or its
 * IPv6 form (Mask, #10393), a custom pattern's mask that keeps an
 * address's first and last characters, or a Hash rule's token: "[HASHED:"
 * and hex, 8 characters before tokens were keyed per project, 16 since
 * (#10394). The project's enabled scrub rules say which rule did
 * (findScrubRuleThatHid): only an IP Address rule whose action leaves that
 * kind of value, over the part of the record the address was read from.
 * Both are needed. A rule alone cannot say it - a client address that is
 * no IP address is often no address a rule hid at all (OpenTelemetry's
 * client.address may be a host name or a Unix socket), and the rules read
 * now may not be the ones ingest ran - and the value alone cannot name the
 * rule.
 *
 * The event keeps what was read as request attributes beside the request's
 * others (SECURITY_REQUEST_ATTRIBUTES): that a scrub rule hid the client
 * address, what it left, where in the record, and the rule that explains
 * it. Never the address: the rule was set to hide it. principalIp stays
 * empty, so threat intel, entity risk, campaigns and the rules that group
 * by address never take "[REDACTED]" for an address every hidden event
 * shares.
 *
 * Built for the address vault (#10395) to replace: a Hash rule's token is
 * kept as the rule left it, so the scan can look it up, write the address
 * it names into principalIp and clear these (clearClientAddressScrubbed).
 * The pages read them through readHiddenClientAddress, which says nothing
 * once an event names its address.
 *
 * Pure, and read in the browser too: every reading is an indexOf or a
 * slice over a bounded text, never a regular expression - the text is a
 * line anybody can write into a log.
 */

// What a scrub rule leaves in place of what it hides.
export enum ScrubbedAddressKind {
  // Redact: "[REDACTED]".
  Redacted = "redacted",
  // Mask: no digit of the address, its shape at most.
  Masked = "masked",
  // Hash: the rule's token for the address.
  Hashed = "hashed",
}

/*
 * Where in a record a scrub rule hid the address, as its rules name the
 * parts: which rules could have, and which page lists them.
 */
export enum ScrubbedAddressPlace {
  // A log line's text: an access log's first word, a "from" in a message.
  LogBody = "log-body",
  // A log record's attributes: client.address, net.peer.ip.
  LogAttributes = "log-attributes",
  // A span's attributes, those of the request a log line was written in too.
  SpanAttributes = "span-attributes",
}

export const SCRUBBED_ADDRESS_PLACES: ReadonlyArray<ScrubbedAddressPlace> =
  Object.values(ScrubbedAddressPlace);

// The rules of a place's record: log rules for a log line, trace rules for a span.
export type ScrubbedAddressSignal = Extract<ScrubRuleSignal, "log" | "trace">;

export function getSignalOfScrubbedAddressPlace(
  place: ScrubbedAddressPlace,
): ScrubbedAddressSignal {
  return place === ScrubbedAddressPlace.SpanAttributes ? "trace" : "log";
}

export interface ScrubbedAddress {
  kind: ScrubbedAddressKind;
  /*
   * What the rule left, as one spelling: "[REDACTED]", the mask, or the
   * token in lower case - the token the address vault looks up (#10395).
   */
  value: string;
}

// The value of SECURITY_REQUEST_ATTRIBUTES.clientAddressHidden.
export const CLIENT_ADDRESS_HIDDEN_BY_SCRUB_RULE: string = "scrub-rule";

export const SCRUB_REDACTED_VALUE: string = "[REDACTED]";

// What Mask leaves of an IPv4 address, and (#10393) of an IPv6 one.
export const SCRUB_IPV4_MASK: string = "***.***.***.***";
export const SCRUB_IPV6_MASK: string =
  "****:****:****:****:****:****:****:****";

export const SCRUB_HASH_PREFIX: string = "[HASHED:";
export const SCRUB_HASH_SUFFIX: string = "]";

/*
 * How many hex characters a Hash rule's token holds: 8 before tokens were
 * keyed per project, 16 since (#10394). A token of any length between is
 * read as one, so a token that grows is still known.
 */
export const SCRUB_HASH_MIN_HEX_LENGTH: number = 8;
export const SCRUB_HASH_MAX_HEX_LENGTH: number = 64;

/*
 * The longest text read as an address a rule hid: the longest of them with
 * the brackets, port and IPv4-mapped prefix it may be written with.
 */
export const MAX_SCRUBBED_ADDRESS_LENGTH: number = 128;

// A Hash rule writes its token's hex in lower case.
const HEX_DIGITS: string = "0123456789abcdef";

/*
 * The characters a mask is made of: its stars, and what an address keeps of
 * its shape - its dots and colons, and the first and last characters a
 * custom pattern's mask keeps, in the case they were written in.
 */
const MASK_CHARACTERS: string = "*.:0123456789abcdefABCDEF";

const IPV4_MAPPED_PREFIX: string = "::ffff:";

function isHexText(text: string): boolean {
  if (!text) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    if (HEX_DIGITS.indexOf(text[index]!) === -1) {
      return false;
    }
  }

  return true;
}

function isDigits(text: string): boolean {
  if (!text) {
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
 * Whether a text is a Hash rule's token: "[HASHED:", lower-case hex and
 * "]", as the rule writes it.
 */
export function isScrubHashToken(text: string): boolean {
  if (
    !text.startsWith(SCRUB_HASH_PREFIX) ||
    !text.endsWith(SCRUB_HASH_SUFFIX)
  ) {
    return false;
  }

  const hex: string = text.slice(
    SCRUB_HASH_PREFIX.length,
    text.length - SCRUB_HASH_SUFFIX.length,
  );

  return (
    hex.length >= SCRUB_HASH_MIN_HEX_LENGTH &&
    hex.length <= SCRUB_HASH_MAX_HEX_LENGTH &&
    isHexText(hex)
  );
}

/*
 * A mask: a run of three stars or more, and nothing but stars and what an
 * address keeps of its shape - its dots and colons ("***.***.***.***", the
 * IPv6 mask), or the first and last characters a custom pattern's mask
 * keeps ("2*********7", Utils/Telemetry/ScrubMask).
 */
function isMask(text: string): boolean {
  if (text.indexOf("***") === -1) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    if (MASK_CHARACTERS.indexOf(text[index]!) === -1) {
      return false;
    }
  }

  return true;
}

/*
 * What a scrub rule left of a whole value, or null: "[REDACTED]", a mask,
 * or a Hash rule's token, spelt as OneUptime's rules spell them - an app's
 * own logger that writes "[Redacted]" is no scrub rule of the project's.
 * Anything else - an address, a host name, a value a rule hid only part
 * of - is no value a rule left.
 */
export function readScrubbedValue(value: string): ScrubbedAddress | null {
  const text: string = (value || "").trim();

  if (!text || text.length > MAX_SCRUBBED_ADDRESS_LENGTH) {
    return null;
  }

  if (text === SCRUB_REDACTED_VALUE) {
    return { kind: ScrubbedAddressKind.Redacted, value: SCRUB_REDACTED_VALUE };
  }

  if (isScrubHashToken(text)) {
    return { kind: ScrubbedAddressKind.Hashed, value: text };
  }

  if (isMask(text)) {
    return { kind: ScrubbedAddressKind.Masked, value: text };
  }

  return null;
}

// A text without the "::ffff:" an IPv4 address written as IPv6 starts with.
function withoutIpv4MappedPrefix(text: string): string {
  return text.toLowerCase().startsWith(IPV4_MAPPED_PREFIX)
    ? text.slice(IPV4_MAPPED_PREFIX.length)
    : text;
}

/*
 * What a scrub rule left where an address was, read as an address is
 * written in a log or a span: the whole value, or the value with
 *
 *   - the port written after it ("[REDACTED]:51234");
 *   - the brackets an IPv6 address is written in, and its port
 *     ("[****:****:****:****:****:****:****:****]:443");
 *   - the "::ffff:" of the IPv4 address an IPv6 socket names a client by
 *     ("::ffff:[REDACTED]"): an IP Address rule hid only its dotted quad
 *     before #10393;
 *   - the full stop or comma of the sentence it ends.
 *
 * Null for anything else, an address included.
 */
export function readScrubbedAddress(value: string): ScrubbedAddress | null {
  let text: string = (value || "").trim();

  if (!text || text.length > MAX_SCRUBBED_ADDRESS_LENGTH) {
    return null;
  }

  while (text.endsWith(".") || text.endsWith(",")) {
    text = text.slice(0, -1);
  }

  // A port: only after what ends a value a rule leaves, never inside a token.
  const lastColon: number = text.lastIndexOf(":");

  if (lastColon > 0) {
    const port: string = text.slice(lastColon + 1);
    const before: string = text.slice(0, lastColon);

    if (
      port.length <= 5 &&
      isDigits(port) &&
      (before.endsWith("]") || before.endsWith("*"))
    ) {
      text = before;
    }
  }

  const whole: ScrubbedAddress | null = readScrubbedValue(
    withoutIpv4MappedPrefix(text),
  );

  if (whole) {
    return whole;
  }

  // "[REDACTED]" is bracketed too: only what it is not is unwrapped.
  if (text.startsWith("[") && text.endsWith("]")) {
    return readScrubbedValue(withoutIpv4MappedPrefix(text.slice(1, -1)));
  }

  return null;
}

/*
 * ---------------------------------------------------------------------------
 * On the event
 * ---------------------------------------------------------------------------
 */

// The attributes the marker is made of, cleared together.
const MARKER_ATTRIBUTES: ReadonlyArray<string> = [
  SECURITY_REQUEST_ATTRIBUTES.clientAddressHidden,
  SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubbed,
  SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubbedIn,
  SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubRuleId,
  SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubRule,
];

export const CLIENT_ADDRESS_SCRUB_MARKER_ATTRIBUTES: ReadonlyArray<string> =
  MARKER_ATTRIBUTES;

/*
 * The event's request came from an address a scrub rule hid: what the rule
 * left, and where in the record.
 */
export function markClientAddressScrubbed(
  attributes: JSONObject,
  data: { scrubbed: ScrubbedAddress; place: ScrubbedAddressPlace },
): void {
  attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressHidden] =
    CLIENT_ADDRESS_HIDDEN_BY_SCRUB_RULE;
  attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubbed] =
    data.scrubbed.value;
  attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubbedIn] = data.place;
}

// The project's rule that hid it, by its id and its name when it was read.
export function nameClientAddressScrubRule(
  attributes: JSONObject,
  rule: { id: string; name: string },
): void {
  const id: string = (rule.id || "").trim();

  if (!id) {
    return;
  }

  attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubRuleId] = id;

  const name: string = (rule.name || "").trim();

  if (name) {
    attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubRule] =
      name.length > 255 ? `${name.slice(0, 254)}…` : name;
  } else {
    delete attributes[SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubRule];
  }
}

/*
 * The event names its address after all - the request's trace held the
 * address a log rule hid, the vault knew a token (#10395) - so nothing of
 * the marker is left to say otherwise.
 */
export function clearClientAddressScrubbed(attributes: JSONObject): void {
  for (const key of MARKER_ATTRIBUTES) {
    delete attributes[key];
  }
}

function readAttribute(attributes: unknown, key: string): string {
  if (!attributes || typeof attributes !== "object") {
    return "";
  }

  const value: unknown = Object.prototype.hasOwnProperty.call(attributes, key)
    ? (attributes as Record<string, unknown>)[key]
    : undefined;

  return typeof value === "string" ? value.trim() : "";
}

export function isScrubbedAddressPlace(
  value: unknown,
): value is ScrubbedAddressPlace {
  return (
    typeof value === "string" &&
    (SCRUBBED_ADDRESS_PLACES as ReadonlyArray<string>).includes(value)
  );
}

// A client address a scrub rule hid, as an event says it.
export interface HiddenClientAddress {
  kind: ScrubbedAddressKind;
  // What the rule left: "[REDACTED]", a mask, or the rule's token.
  value: string;
  // Where in the record, and so whose rules: null when the event does not say.
  place: ScrubbedAddressPlace | null;
  signal: ScrubbedAddressSignal | null;
  // The project's rule that explains it, when the scan found one: '' otherwise.
  ruleId: string;
  ruleName: string;
}

/*
 * The client address a scrub rule hid from an event, or null: for an event
 * that names its address (principalIp), or carries no marker. What every
 * page reads, so an event the vault named the address of (#10395) shows the
 * address, never this.
 */
export function readHiddenClientAddress(event: {
  principalIp?: string | undefined;
  attributes?: unknown;
}): HiddenClientAddress | null {
  if ((event.principalIp || "").trim()) {
    return null;
  }

  const attributes: unknown = event.attributes;

  if (
    readAttribute(
      attributes,
      SECURITY_REQUEST_ATTRIBUTES.clientAddressHidden,
    ) !== CLIENT_ADDRESS_HIDDEN_BY_SCRUB_RULE
  ) {
    return null;
  }

  const scrubbed: ScrubbedAddress = readScrubbedValue(
    readAttribute(
      attributes,
      SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubbed,
    ),
  ) || { kind: ScrubbedAddressKind.Redacted, value: SCRUB_REDACTED_VALUE };
  const placeText: string = readAttribute(
    attributes,
    SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubbedIn,
  );
  const place: ScrubbedAddressPlace | null = isScrubbedAddressPlace(placeText)
    ? placeText
    : null;
  const ruleId: string = readAttribute(
    attributes,
    SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubRuleId,
  );

  return {
    kind: scrubbed.kind,
    value: scrubbed.value,
    place,
    signal: place ? getSignalOfScrubbedAddressPlace(place) : null,
    ruleId,
    ruleName: ruleId
      ? readAttribute(
          attributes,
          SECURITY_REQUEST_ATTRIBUTES.clientAddressScrubRule,
        )
      : "",
  };
}

/*
 * ---------------------------------------------------------------------------
 * Which rule hid it
 * ---------------------------------------------------------------------------
 */

// A project's scrub rule, as the scans and Security Events' setup read one.
export interface AddressScrubRule {
  id: string;
  name: string;
  patternType: string;
  scrubAction: string;
  fieldsToScrub: string;
}

/*
 * The kind of value a rule's action leaves, as ingest runs it: an action
 * left empty is Redact, and so is one no engine knows. A log rule's and a
 * trace rule's actions are the same words (LogScrubAction,
 * TraceScrubAction).
 */
export function getScrubbedKindOfAction(
  action: string | undefined,
): ScrubbedAddressKind {
  switch ((action || "").trim()) {
    case LogScrubAction.Mask:
      return ScrubbedAddressKind.Masked;
    case LogScrubAction.Hash:
      return ScrubbedAddressKind.Hashed;
    default:
      return ScrubbedAddressKind.Redacted;
  }
}

/*
 * Whether ingest runs a rule over a part of the record: a rule's fields
 * left empty are its default, and fields no engine knows reach nothing.
 */
export function doesScrubRuleReach(
  rule: Pick<AddressScrubRule, "fieldsToScrub">,
  place: ScrubbedAddressPlace,
): boolean {
  const saved: string = (rule.fieldsToScrub || "").trim();

  if (place === ScrubbedAddressPlace.SpanAttributes) {
    const fields: string = saved || TRACE_SCRUB_RULE_DEFAULTS.fieldsToScrub;

    return (
      fields === TraceScrubField.All || fields === TraceScrubField.Attributes
    );
  }

  const fields: string = saved || LOG_SCRUB_RULE_DEFAULTS.fieldsToScrub;

  if (fields === LogScrubField.Both) {
    return true;
  }

  return place === ScrubbedAddressPlace.LogBody
    ? fields === LogScrubField.Body
    : fields === LogScrubField.Attributes;
}

// An IP Address rule: the one pattern known to hide addresses. Log and trace rules share the word.
export function isIpAddressScrubRule(
  rule: Pick<AddressScrubRule, "patternType">,
): boolean {
  return (rule.patternType || "").trim() === LogScrubPatternType.IPAddress;
}

/*
 * The rule that hid an address, of a project's enabled rules of the
 * record's kind in the order ingest runs them: the first IP Address rule
 * over that part of the record whose action leaves what the record holds.
 * Null when none does - a custom pattern's rule, a rule since turned off,
 * changed or deleted, or no rule of OneUptime's: the event still says a
 * scrub rule hid the address, without naming one.
 */
export function findScrubRuleThatHid(
  rules: ReadonlyArray<AddressScrubRule>,
  hidden: { kind: ScrubbedAddressKind; place: ScrubbedAddressPlace },
): AddressScrubRule | null {
  for (const rule of rules) {
    if (
      isIpAddressScrubRule(rule) &&
      doesScrubRuleReach(rule, hidden.place) &&
      getScrubbedKindOfAction(rule.scrubAction) === hidden.kind
    ) {
      return rule;
    }
  }

  return null;
}

// Where Security Events reads a client's address in each kind of record.
export const SECURITY_EVENTS_ADDRESS_PLACES: Readonly<
  Record<ScrubbedAddressSignal, ReadonlyArray<ScrubbedAddressPlace>>
> = {
  log: [ScrubbedAddressPlace.LogBody, ScrubbedAddressPlace.LogAttributes],
  trace: [ScrubbedAddressPlace.SpanAttributes],
};

/*
 * The first of a project's enabled rules of a kind that keeps Security
 * Events from naming the address an attack came from: an IP Address rule
 * that redacts or masks a part of the record Security Events reads the
 * address from. A Hash rule is not one: the address vault names the
 * address behind its token (#10395), which is the way out the setup item
 * offers (#10396).
 */
export function findScrubRuleHidingAddresses(
  rules: ReadonlyArray<AddressScrubRule>,
  signal: ScrubbedAddressSignal,
): AddressScrubRule | null {
  for (const rule of rules) {
    if (
      isIpAddressScrubRule(rule) &&
      getScrubbedKindOfAction(rule.scrubAction) !==
        ScrubbedAddressKind.Hashed &&
      SECURITY_EVENTS_ADDRESS_PLACES[signal].some(
        (place: ScrubbedAddressPlace): boolean => {
          return doesScrubRuleReach(rule, place);
        },
      )
    ) {
      return rule;
    }
  }

  return null;
}

/*
 * ---------------------------------------------------------------------------
 * In Security Events' setup
 * ---------------------------------------------------------------------------
 */

/*
 * A rule that keeps Security Events from naming attackers' addresses, as
 * its setup names it (SecuritySetup.getStatus): of logs or traces that
 * Security Events reads, its id and name, and what it does - Redact or
 * Mask, which Hash Instead will change (#10396).
 */
export interface SecurityAddressScrubRule {
  signal: ScrubbedAddressSignal;
  ruleId: string;
  ruleName: string;
  scrubAction: string;
}

// The setup's rules, read defensively from the wire: logs first, each kind once.
export function readSecurityAddressScrubRules(
  value: unknown,
): Array<SecurityAddressScrubRule> {
  if (!Array.isArray(value)) {
    return [];
  }

  const rules: Array<SecurityAddressScrubRule> = [];

  for (const signal of ["log", "trace"] as Array<ScrubbedAddressSignal>) {
    const item: unknown = value.find((candidate: unknown): boolean => {
      return (
        Boolean(candidate) &&
        typeof candidate === "object" &&
        (candidate as Record<string, unknown>)["signal"] === signal
      );
    });

    if (!item) {
      continue;
    }

    const ruleId: string = readAttribute(item, "ruleId");

    if (!ruleId) {
      continue;
    }

    rules.push({
      signal,
      ruleId,
      ruleName: readAttribute(item, "ruleName"),
      scrubAction: readAttribute(item, "scrubAction"),
    });
  }

  return rules;
}
