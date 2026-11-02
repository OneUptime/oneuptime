import {
  SECURITY_TELEMETRY_MAX_LISTED,
  SECURITY_TELEMETRY_MAX_VALUES,
  SECURITY_TELEMETRY_MESSAGE_PLACE,
  SecurityTelemetryPlaceJson,
} from "../../Types/SecurityCase/SecurityConnection";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../Types/SecurityCase/SecurityEntity";
import escapeRegExp from "../RegExpEscape";
import {
  MAX_EMAIL_LENGTH,
  MAX_HOST_NAME_LENGTH,
  MAX_RESOURCE_ID_LENGTH,
  MAX_URL_LENGTH,
  SecurityAddressScope,
  canonicalAddress,
  getSecurityAddressScope,
  getUrlHost,
  isCloudResourceIdLike,
  isEmailLike,
  isHostNameLike,
} from "./SecurityConnectionMatch";

/*
 * WHAT IS SEARCHED FOR IN THE LOGS AND TRACES, AND HOW (Types/SecurityCase/
 * SecurityConnection, "In your logs and traces").
 *
 * A value is searched for when it can only mean one thing wherever it is
 * written - an address, a full host or domain name, an email, a URL, a cloud
 * resource's ID, a file's hash - and never when it is a word a log line
 * could hold for any reason: a bare host name (web-1), a user's bare name
 * (root), a process (powershell.exe). A machine of a bare name is found by
 * its record above, and its own logs open from there.
 *
 * How a log line or a span names one:
 *
 *   in a log line's message   the value as a whole, whatever its case: no
 *                             letter, digit, "_", "-" or "." on either side
 *                             of it, so 10.0.0.1 is named by "from
 *                             10.0.0.1:52144" and "10.0.0.1." but not by
 *                             "10.0.0.12" or "110.0.0.1", and evil.example
 *                             by "https://evil.example/x" but not by
 *                             "evil.example.net" or "sub.evil.example" (a
 *                             ":" is a side of it too for an IPv6 address);
 *   in an attribute           the attribute's value is exactly the value, in
 *                             one of its usual spellings (as written, lower
 *                             and upper case, an IPv6 address also in its
 *                             short form) - never a resource attribute
 *                             ("resource." and the key), which every line of
 *                             the record sending it carries and which says
 *                             only who sent it.
 *
 * Every value here was written outside OneUptime, so it is read with loops
 * over its characters, and only printable ASCII without white space is ever
 * searched for. The pattern a message is matched with is built here with
 * every character of the value escaped (escapeRegExp) and runs in
 * ClickHouse's RE2, whose time grows in line with the text.
 */

// The shapes of value searched for.
export enum SecurityTelemetryValueShape {
  Ipv4Address = "Ipv4Address",
  Ipv6Address = "Ipv6Address",
  Name = "Name",
  Email = "Email",
  Url = "Url",
  ResourceId = "ResourceId",
  Hash = "Hash",
}

// The shortest value searched for: a few characters name nothing in particular.
export const SECURITY_TELEMETRY_MIN_VALUE_LENGTH: number = 4;

// The key every resource attribute starts with: who sent the line, not what it says.
export const RESOURCE_ATTRIBUTE_PREFIX: string = "resource.";

// The flag that makes an RE2 pattern match whatever the case.
export const RE2_CASE_INSENSITIVE_FLAG: string = "(?i)";

// What a value is searched for as.
export interface SecurityTelemetrySearchValue {
  // The entity, as the case, the event or the entity's page names it.
  entity: SecurityEntity;
  shape: SecurityTelemetryValueShape;
  // Lower case text a message must contain to be read at all (the prefilter).
  needles: Array<string>;
  // The RE2 pattern a message names the value whole by.
  messagePattern: string;
  // The spellings an attribute's value may be, exactly.
  spellings: Array<string>;
}

export interface SecurityTelemetrySearch {
  values: Array<SecurityTelemetrySearchValue>;
  // More values could be searched for than SECURITY_TELEMETRY_MAX_VALUES.
  hasMoreValues: boolean;
}

function isAsciiLetterOrDigit(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isHexDigit(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 70) ||
    (code >= 97 && code <= 102)
  );
}

// A character a value runs on through: letters, digits and "_".
function isWordCharacter(code: number): boolean {
  return isAsciiLetterOrDigit(code) || code === 95;
}

/*
 * Whether a value can be searched for at all: printable ASCII with no white
 * space, at least SECURITY_TELEMETRY_MIN_VALUE_LENGTH characters and at most
 * a URL's MAX_URL_LENGTH.
 */
export function isTelemetrySearchText(value: string | undefined | null): boolean {
  const text: string = value || "";

  if (
    text.length < SECURITY_TELEMETRY_MIN_VALUE_LENGTH ||
    text.length > MAX_URL_LENGTH
  ) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code <= 32 || code >= 127) {
      return false;
    }
  }

  return true;
}

// An MD5, SHA-1, SHA-256 or SHA-512 digest: hex digits, and only those lengths.
export function isFileHashLike(value: string | undefined | null): boolean {
  const text: string = (value || "").trim();

  if (![32, 40, 64, 128].includes(text.length)) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    if (!isHexDigit(text.charCodeAt(index))) {
      return false;
    }
  }

  return true;
}

/*
 * Whether a name is a full host or domain name: a host name's shape, with a
 * dot, and a last label of at least two characters holding a letter - so a
 * version ("2.4.1") or a bare name ("web-1") is not one.
 */
export function isFullHostName(value: string | undefined | null): boolean {
  const text: string = (value || "").trim();

  if (!isHostNameLike(text) || text.length > MAX_HOST_NAME_LENGTH) {
    return false;
  }

  const dot: number = text.lastIndexOf(".");

  if (dot <= 0 || text.length - dot - 1 < 2) {
    return false;
  }

  for (let index: number = dot + 1; index < text.length; index++) {
    if (isAsciiLetter(text.charCodeAt(index))) {
      return true;
    }
  }

  return false;
}

/*
 * An IPv6 address in its short form (RFC 5952), from its one spelling
 * (canonicalAddress: eight groups, lower case, no leading zeros): the
 * longest run of two or more zero groups, the first of equal ones, as "::".
 * 2001:db8:0:0:0:0:0:7 is 2001:db8::7.
 */
export function getShortIpv6Address(canonical: string): string {
  const groups: Array<string> = canonical.split(":");

  if (groups.length !== 8) {
    return canonical;
  }

  let bestStart: number = -1;
  let bestLength: number = 0;
  let runStart: number = -1;

  for (let index: number = 0; index <= groups.length; index++) {
    if (index < groups.length && groups[index] === "0") {
      if (runStart === -1) {
        runStart = index;
      }
      continue;
    }

    if (runStart !== -1) {
      const length: number = index - runStart;

      if (length >= 2 && length > bestLength) {
        bestStart = runStart;
        bestLength = length;
      }

      runStart = -1;
    }
  }

  if (bestStart === -1) {
    return groups.join(":");
  }

  return `${groups.slice(0, bestStart).join(":")}::${groups
    .slice(bestStart + bestLength)
    .join(":")}`;
}

// Whether a value is a URL: typed as one, or written with a scheme and a host.
function isUrlShaped(entity: SecurityEntity, value: string): boolean {
  return (
    entity.type === SecurityEntityType.Url ||
    (entity.type !== SecurityEntityType.User && getUrlHost(value) !== null)
  );
}

// Whether a URL names a machine: not one on a local address or on localhost.
function isUrlOnAMachine(value: string): boolean {
  const host: string | null = getUrlHost(value);

  if (!host) {
    // A URL typed as one without a scheme: its text is all there is.
    return true;
  }

  const address: string | null = canonicalAddress(host);

  if (address) {
    return getSecurityAddressScope(address) !== SecurityAddressScope.Local;
  }

  return host !== "localhost" && !host.endsWith(".localhost");
}

/*
 * The shape a value is searched for as, or null when it is not searched
 * for: a process, a data store, a user's bare name, a bare host name, an
 * address every machine has (127.0.0.1, ::1) and anything that is not
 * printable ASCII.
 */
export function getTelemetryValueShape(
  entity: SecurityEntity,
): SecurityTelemetryValueShape | null {
  if (!entity || typeof entity.value !== "string") {
    return null;
  }

  const value: string = entity.value.trim();

  if (
    !isTelemetrySearchText(value) ||
    entity.type === SecurityEntityType.Process ||
    entity.type === SecurityEntityType.DataStore
  ) {
    return null;
  }

  const address: string | null = canonicalAddress(value);

  if (address) {
    if (getSecurityAddressScope(address) === SecurityAddressScope.Local) {
      return null;
    }

    return address.includes(":")
      ? SecurityTelemetryValueShape.Ipv6Address
      : SecurityTelemetryValueShape.Ipv4Address;
  }

  if (isUrlShaped(entity, value)) {
    return isUrlOnAMachine(value) ? SecurityTelemetryValueShape.Url : null;
  }

  if (isEmailLike(value)) {
    return value.length <= MAX_EMAIL_LENGTH
      ? SecurityTelemetryValueShape.Email
      : null;
  }

  // A user's bare name names nobody in particular.
  if (entity.type === SecurityEntityType.User) {
    return null;
  }

  if (isCloudResourceIdLike(value)) {
    return value.length <= MAX_RESOURCE_ID_LENGTH
      ? SecurityTelemetryValueShape.ResourceId
      : null;
  }

  if (isFileHashLike(value)) {
    return SecurityTelemetryValueShape.Hash;
  }

  if (
    (entity.type === SecurityEntityType.Host ||
      entity.type === SecurityEntityType.Domain ||
      entity.type === SecurityEntityType.Other) &&
    isFullHostName(value)
  ) {
    return SecurityTelemetryValueShape.Name;
  }

  return null;
}

// Each spelling once, compared as written.
function unique(values: Array<string>): Array<string> {
  const seen: Set<string> = new Set();
  const result: Array<string> = [];

  for (const value of values) {
    if (value && !seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}

/*
 * The spellings an attribute's value is compared with: as written, and as
 * the usual writers spell the same value - lower case (how hosts, domains
 * and emails are mostly written), upper case (how Windows and many EDRs
 * write machines and hashes), an address in its one spelling, an IPv6
 * address in its short form.
 */
export function getTelemetryAttributeSpellings(
  value: string,
  shape: SecurityTelemetryValueShape,
): Array<string> {
  const text: string = value.trim();

  switch (shape) {
    case SecurityTelemetryValueShape.Ipv4Address:
      return unique([text, canonicalAddress(text) || ""]);
    case SecurityTelemetryValueShape.Ipv6Address: {
      const canonical: string = canonicalAddress(text) || "";

      return unique([
        text,
        text.toLowerCase(),
        canonical ? getShortIpv6Address(canonical) : "",
      ]);
    }
    case SecurityTelemetryValueShape.Name:
    case SecurityTelemetryValueShape.Hash:
      return unique([text, text.toLowerCase(), text.toUpperCase()]);
    case SecurityTelemetryValueShape.Email:
    case SecurityTelemetryValueShape.Url:
    case SecurityTelemetryValueShape.ResourceId:
    default:
      return unique([text, text.toLowerCase()]);
  }
}

/*
 * What a message is read for at all: the value's spellings in lower case,
 * each once (a case-insensitive search for each, before the pattern decides).
 */
export function getTelemetryMessageNeedles(
  value: string,
  shape: SecurityTelemetryValueShape,
): Array<string> {
  return unique(
    getTelemetryAttributeSpellings(value, shape).map(
      (spelling: string): string => {
        return spelling.toLowerCase();
      },
    ),
  );
}

// What a message must not hold beside a value: what it would run on into.
const RUN_ON_CHARACTERS: string = "0-9A-Za-z_.-";
const IPV6_RUN_ON_CHARACTERS: string = "0-9A-Za-z_:.-";
// After a value, a dot ends it unless a letter, digit, "_" or "-" follows.
const AFTER_DOT_RUN_ON_CHARACTERS: string = "0-9A-Za-z_-";

/*
 * The RE2 pattern a message names a value whole by: any of its spellings,
 * whatever the case, with nothing it would run on into beside it - on a
 * side the value itself ends with a letter, a digit or "_" (a URL ending in
 * "/" is named by every longer URL under it).
 */
export function getTelemetryMessagePattern(
  value: string,
  shape: SecurityTelemetryValueShape,
): string {
  const needles: Array<string> = getTelemetryMessageNeedles(value, shape);
  const runOn: string =
    shape === SecurityTelemetryValueShape.Ipv6Address
      ? IPV6_RUN_ON_CHARACTERS
      : RUN_ON_CHARACTERS;
  const text: string = value.trim();
  const startsWithWord: boolean = isWordCharacter(text.charCodeAt(0));
  const endsWithWord: boolean = isWordCharacter(
    text.charCodeAt(text.length - 1),
  );
  const before: string = startsWithWord ? `(?:^|[^${runOn}])` : "";
  const after: string = endsWithWord
    ? `(?:$|[^${runOn}]|\\.(?:$|[^${AFTER_DOT_RUN_ON_CHARACTERS}]))`
    : "";

  return `${RE2_CASE_INSENSITIVE_FLAG}${before}(?:${needles
    .map((needle: string): string => {
      return escapeRegExp(needle);
    })
    .join("|")})${after}`;
}

/*
 * The values a case, an event or an entity names that are searched for in
 * the logs and traces, in the order they are named, each once (whatever its
 * case or spelling), at most SECURITY_TELEMETRY_MAX_VALUES.
 */
export function getTelemetrySearchValues(
  entities: ReadonlyArray<SecurityEntity>,
): SecurityTelemetrySearch {
  const values: Array<SecurityTelemetrySearchValue> = [];
  const seen: Set<string> = new Set();
  let hasMoreValues: boolean = false;

  for (const entity of entities || []) {
    const shape: SecurityTelemetryValueShape | null =
      getTelemetryValueShape(entity);

    if (!shape) {
      continue;
    }

    const value: string = entity.value.trim();
    const key: string =
      shape === SecurityTelemetryValueShape.Ipv4Address ||
      shape === SecurityTelemetryValueShape.Ipv6Address
        ? canonicalAddress(value) || value.toLowerCase()
        : value.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    if (values.length >= SECURITY_TELEMETRY_MAX_VALUES) {
      hasMoreValues = true;
      break;
    }

    values.push({
      entity: { type: entity.type, value },
      shape,
      needles: getTelemetryMessageNeedles(value, shape),
      messagePattern: getTelemetryMessagePattern(value, shape),
      spellings: getTelemetryAttributeSpellings(value, shape),
    });
  }

  return { values, hasMoreValues };
}

/*
 * The text the Logs explorer's message search is opened on for a value: as
 * the case names it, an IPv6 address in the short form logs write it in.
 */
export function getTelemetryMessageSearchText(value: string): string {
  const text: string = (value || "").trim();
  const address: string | null = canonicalAddress(text);

  return address && address.includes(":")
    ? getShortIpv6Address(address)
    : text;
}

// Whether an attribute's key is a resource attribute's: who sent it, not what it says.
export function isResourceAttributeKey(key: string): boolean {
  return key.startsWith(RESOURCE_ATTRIBUTE_PREFIX);
}

/*
 * Where in its log lines or spans a value was found, the most first: the
 * message (SECURITY_TELEMETRY_MESSAGE_PLACE) and the attributes' keys, at
 * most SECURITY_TELEMETRY_MAX_LISTED. Of equal counts the message comes
 * first, then the keys by name, so the same answer always reads the same.
 */
export function getTelemetryPlaces(data: {
  messageCount: number;
  attributeKeys: ReadonlyArray<{ key: string; count: number; value?: string }>;
}): Array<SecurityTelemetryPlaceJson> {
  const places: Array<SecurityTelemetryPlaceJson> = [];

  if (data.messageCount > 0) {
    places.push({
      key: SECURITY_TELEMETRY_MESSAGE_PLACE,
      count: data.messageCount,
    });
  }

  for (const attribute of data.attributeKeys) {
    if (
      attribute.key &&
      attribute.count > 0 &&
      !isResourceAttributeKey(attribute.key)
    ) {
      places.push({
        key: attribute.key,
        count: attribute.count,
        ...(attribute.value ? { value: attribute.value } : {}),
      });
    }
  }

  return places
    .sort(
      (a: SecurityTelemetryPlaceJson, b: SecurityTelemetryPlaceJson): number => {
        if (a.count !== b.count) {
          return b.count - a.count;
        }

        if (a.key === SECURITY_TELEMETRY_MESSAGE_PLACE) {
          return -1;
        }

        if (b.key === SECURITY_TELEMETRY_MESSAGE_PLACE) {
          return 1;
        }

        return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
      },
    )
    .slice(0, SECURITY_TELEMETRY_MAX_LISTED);
}
