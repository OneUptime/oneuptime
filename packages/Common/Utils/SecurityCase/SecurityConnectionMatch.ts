import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  SECURITY_CONNECTION_EVENT_PADDING_IN_MINUTES,
  SECURITY_CONNECTION_KINDS,
  SECURITY_CONNECTION_MAX_ADDRESSES,
  SECURITY_CONNECTION_MAX_ENTITIES,
  SECURITY_CONNECTION_MAX_WINDOW_IN_HOURS,
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
  SecurityConnectionCertainty,
  SecurityConnectionKind,
  SecurityConnectionReason,
} from "../../Types/SecurityCase/SecurityConnection";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../Types/SecurityCase/SecurityEntity";
import { getEntityRiskKey } from "./SecurityEntityRiskScore";

/*
 * The rules that decide whether a value Security Events names is a OneUptime
 * record (Types/SecurityCase/SecurityConnection says why there are two
 * certainties), as pure functions: the server that looks the values up, the
 * pages that say how sure a connection is and the tests read them here.
 *
 * Every value here was written outside OneUptime - a host name an EDR sent,
 * a user name an attacker typed into an SSH prompt - so each is read with
 * loops over its characters, never a regular expression with a repeat, and
 * anything that does not look like what it is looked up as is not looked up.
 */

/*
 * The one way a value is compared: trimmed and case folded, as an entity's
 * risk key and a case's grouping key are, and as OneUptime keys its own
 * resources (canonicalizeEntityValue).
 */
export function foldConnectionValue(value: string | undefined | null): string {
  return getEntityRiskKey(value || "");
}

// A DNS name is at most 253 characters; a value longer than that is no host name.
export const MAX_HOST_NAME_LENGTH: number = 253;

// An email address, as SMTP allows it.
export const MAX_EMAIL_LENGTH: number = 254;

function isAsciiLetterOrDigit(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

/*
 * Whether a value can be a machine's name: letters, digits, hyphens,
 * underscores and dots, starting and ending with a letter or a digit, with
 * no two dots together. What it rules out is what a host lookup must never
 * be handed: spaces, wildcards, quotes, a path or a URL.
 */
export function isHostNameLike(value: string | undefined | null): boolean {
  const text: string = (value || "").trim();

  if (!text || text.length > MAX_HOST_NAME_LENGTH) {
    return false;
  }

  if (
    !isAsciiLetterOrDigit(text.charCodeAt(0)) ||
    !isAsciiLetterOrDigit(text.charCodeAt(text.length - 1))
  ) {
    return false;
  }

  let previousWasDot: boolean = false;

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code === 46) {
      if (previousWasDot) {
        return false;
      }

      previousWasDot = true;
      continue;
    }

    previousWasDot = false;

    // Letters, digits, "-" and "_".
    if (!isAsciiLetterOrDigit(code) && code !== 45 && code !== 95) {
      return false;
    }
  }

  return !canonicalAddress(text);
}

/*
 * A name's short form - its first label - when it has one: web-1 for
 * web-1.acme.internal. A bare name (no dot), or anything that is not a host
 * name, has none.
 */
export function getShortHostName(
  value: string | undefined | null,
): string | null {
  const folded: string = (value || "").trim().toLowerCase();

  if (!isHostNameLike(folded)) {
    return null;
  }

  const dot: number = folded.indexOf(".");

  return dot > 0 ? folded.slice(0, dot) : null;
}

export interface SecurityConnectionVerdict {
  certainty: SecurityConnectionCertainty;
  reason: SecurityConnectionReason;
}

/*
 * Whether a name an event gives is the name a OneUptime record reports:
 *   - exactly, when the two are the same (folded) and the event says the
 *     value is a host or a domain name;
 *   - possibly, when the two are the same but the event does not say what
 *     the value is (an untyped value: "production" may be an environment as
 *     well as a cluster), or when one of the two is a bare name and the
 *     other's first label - web-1 and web-1.acme.internal.
 * Two full names that only share a first label (web-1.prod.acme and
 * web-1.staging.acme) are two machines, and no match.
 */
export function matchHostName(data: {
  entityValue: string;
  // The entity's type: an untyped value (Other) is never an exact match.
  entityType?: SecurityEntityType | string | undefined;
  resourceName: string | undefined | null;
  // What an exact match is called: a host's name, a cluster's, a device's.
  exactReason?: SecurityConnectionReason | undefined;
}): SecurityConnectionVerdict | null {
  const entity: string = foldConnectionValue(data.entityValue);
  const resource: string = foldConnectionValue(data.resourceName);

  if (!entity || !resource) {
    return null;
  }

  if (entity === resource) {
    if (data.entityType === SecurityEntityType.Other) {
      return {
        certainty: SecurityConnectionCertainty.Possible,
        reason: SecurityConnectionReason.UntypedValue,
      };
    }

    return {
      certainty: SecurityConnectionCertainty.Exact,
      reason: data.exactReason || SecurityConnectionReason.HostName,
    };
  }

  if (!isHostNameLike(entity) || !isHostNameLike(resource)) {
    return null;
  }

  const entityShort: string | null = getShortHostName(entity);
  const resourceShort: string | null = getShortHostName(resource);

  if (
    (entityShort === null && resourceShort === entity) ||
    (resourceShort === null && entityShort === resource)
  ) {
    return {
      certainty: SecurityConnectionCertainty.Possible,
      reason: SecurityConnectionReason.ShortHostName,
    };
  }

  return null;
}

/*
 * The project member an email names: only an email that is the member's,
 * folded. A bare user name - root, admin, kmorgan - names nobody in
 * particular, and is never matched.
 */
export function matchEmail(data: {
  entityValue: string;
  email: string | undefined | null;
}): SecurityConnectionVerdict | null {
  const entity: string = foldConnectionValue(data.entityValue);

  if (!isEmailLike(entity) || entity !== foldConnectionValue(data.email)) {
    return null;
  }

  return {
    certainty: SecurityConnectionCertainty.Exact,
    reason: SecurityConnectionReason.Email,
  };
}

/*
 * Whether a value has the shape of an email address: one "@" with
 * something on both sides, a dot after it, no white space, not too long.
 */
export function isEmailLike(value: string | undefined | null): boolean {
  const text: string = (value || "").trim();

  if (!text || text.length > MAX_EMAIL_LENGTH) {
    return false;
  }

  const at: number = text.indexOf("@");

  if (at <= 0 || at !== text.lastIndexOf("@") || at === text.length - 1) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    // White space and control characters.
    if (code <= 32 || code === 127) {
      return false;
    }
  }

  const domain: string = text.slice(at + 1);
  const dot: number = domain.indexOf(".");

  return dot > 0 && dot < domain.length - 1;
}

// ---------- Addresses ----------

/*
 * Where an address is used, which decides how much it says about one
 * machine:
 *   Public   reachable from the internet: one machine's at a time.
 *   Private  a private network's (10/8, 172.16/12, 192.168/16, 100.64/10,
 *            fc00::/7): another network can give it to another machine.
 *   Local    every machine has it, or none does (loopback, link-local,
 *            unspecified, multicast, broadcast): it names no machine.
 */
export enum SecurityAddressScope {
  Public = "Public",
  Private = "Private",
  Local = "Local",
}

function readIpv4(text: string): Array<number> | null {
  const parts: Array<string> = text.split(".");

  if (parts.length !== 4) {
    return null;
  }

  const octets: Array<number> = [];

  for (const part of parts) {
    if (part.length === 0 || part.length > 3) {
      return null;
    }

    for (let index: number = 0; index < part.length; index++) {
      const code: number = part.charCodeAt(index);

      if (code < 48 || code > 57) {
        return null;
      }
    }

    const octet: number = Number(part);

    if (octet > 255) {
      return null;
    }

    octets.push(octet);
  }

  return octets;
}

function isHexDigit(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 70) ||
    (code >= 97 && code <= 102)
  );
}

// The eight 16-bit groups of an IPv6 address, or null when it is not one.
function readIpv6Groups(text: string): Array<number> | null {
  let address: string = text;

  // A zone ("%eth0") names the interface, not the address.
  const zone: number = address.indexOf("%");

  if (zone !== -1) {
    address = address.slice(0, zone);
  }

  if (!address.includes(":") || address.length > 45) {
    return null;
  }

  const doubleColon: number = address.indexOf("::");

  if (doubleColon !== -1 && doubleColon !== address.lastIndexOf("::")) {
    return null;
  }

  const readGroups: (part: string) => Array<number> | null = (
    part: string,
  ): Array<number> | null => {
    if (!part) {
      return [];
    }

    const groups: Array<number> = [];
    const pieces: Array<string> = part.split(":");

    for (let index: number = 0; index < pieces.length; index++) {
      const piece: string = pieces[index]!;

      // An embedded IPv4 address ends the address: ::ffff:10.0.0.5.
      if (index === pieces.length - 1 && piece.includes(".")) {
        const octets: Array<number> | null = readIpv4(piece);

        if (!octets) {
          return null;
        }

        groups.push(
          octets[0]! * 256 + octets[1]!,
          octets[2]! * 256 + octets[3]!,
        );
        continue;
      }

      if (piece.length === 0 || piece.length > 4) {
        return null;
      }

      for (let char: number = 0; char < piece.length; char++) {
        if (!isHexDigit(piece.charCodeAt(char))) {
          return null;
        }
      }

      groups.push(parseInt(piece, 16));
    }

    return groups;
  };

  if (doubleColon === -1) {
    const groups: Array<number> | null = readGroups(address);

    return groups && groups.length === 8 ? groups : null;
  }

  const head: Array<number> | null = readGroups(address.slice(0, doubleColon));
  const tail: Array<number> | null = readGroups(address.slice(doubleColon + 2));

  if (!head || !tail || head.length + tail.length > 7) {
    return null;
  }

  return [
    ...head,
    ...new Array<number>(8 - head.length - tail.length).fill(0),
    ...tail,
  ];
}

/*
 * One spelling of an address, so two spellings of the same one compare
 * equal: an IPv4 address as written, an IPv4 address an IPv6 one maps
 * (::ffff:10.0.0.5) as that IPv4 address, and an IPv6 address as its eight
 * groups in lowercase hex without leading zeros (2001:db8::7 and
 * 2001:0DB8:0:0:0:0:0:7 are both 2001:db8:0:0:0:0:0:7). Null when the value
 * is not an address.
 */
export function canonicalAddress(
  value: string | undefined | null,
): string | null {
  const text: string = (value || "").trim();

  if (!text || text.length > 64) {
    return null;
  }

  const ipv4: Array<number> | null = readIpv4(text);

  if (ipv4) {
    return ipv4.join(".");
  }

  const groups: Array<number> | null = readIpv6Groups(text);

  if (!groups) {
    return null;
  }

  // IPv4-mapped: ::ffff:a.b.c.d
  if (
    groups.slice(0, 5).every((group: number): boolean => {
      return group === 0;
    }) &&
    groups[5] === 0xffff
  ) {
    return [
      Math.floor(groups[6]! / 256),
      groups[6]! % 256,
      Math.floor(groups[7]! / 256),
      groups[7]! % 256,
    ].join(".");
  }

  return groups
    .map((group: number): string => {
      return group.toString(16);
    })
    .join(":");
}

export function getSecurityAddressScope(
  value: string | undefined | null,
): SecurityAddressScope | null {
  const address: string | null = canonicalAddress(value);

  if (!address) {
    return null;
  }

  const ipv4: Array<number> | null = readIpv4(address);

  if (ipv4) {
    const [a, b] = [ipv4[0]!, ipv4[1]!];

    if (
      a === 0 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      a >= 224 // multicast, reserved and broadcast
    ) {
      return SecurityAddressScope.Local;
    }

    if (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    ) {
      return SecurityAddressScope.Private;
    }

    return SecurityAddressScope.Public;
  }

  const groups: Array<number> = address.split(":").map((group: string) => {
    return parseInt(group, 16);
  });
  const first: number = groups[0]!;

  // :: and ::1
  if (
    groups.slice(0, 7).every((group: number): boolean => {
      return group === 0;
    }) &&
    (groups[7] === 0 || groups[7] === 1)
  ) {
    return SecurityAddressScope.Local;
  }

  // fe80::/10 link-local, ff00::/8 multicast
  if ((first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) {
    return SecurityAddressScope.Local;
  }

  // fc00::/7 unique local, fec0::/10 site-local
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfec0) {
    return SecurityAddressScope.Private;
  }

  return SecurityAddressScope.Public;
}

/*
 * What an address an event names says about the record holding it, given
 * how many of the project's records hold it: exactly that record when it is
 * public and nobody else holds it; possibly, when it is private or shared;
 * nothing at all when it is local.
 */
export function matchAddress(data: {
  address: string;
  holderCount: number;
}): SecurityConnectionVerdict | null {
  const scope: SecurityAddressScope | null = getSecurityAddressScope(
    data.address,
  );

  if (!scope || scope === SecurityAddressScope.Local || data.holderCount < 1) {
    return null;
  }

  if (data.holderCount > 1) {
    return {
      certainty: SecurityConnectionCertainty.Possible,
      reason: SecurityConnectionReason.SharedAddress,
    };
  }

  if (scope === SecurityAddressScope.Private) {
    return {
      certainty: SecurityConnectionCertainty.Possible,
      reason: SecurityConnectionReason.PrivateAddress,
    };
  }

  return {
    certainty: SecurityConnectionCertainty.Exact,
    reason: SecurityConnectionReason.Address,
  };
}

/*
 * The addresses in a list a record reports - a host's host.ip, a device's
 * other addresses: separated by commas or white space, each in its one
 * spelling, each once, the ones that name no machine left out.
 */
export function readRecordAddresses(
  text: string | Array<string> | undefined | null,
): Array<string> {
  const parts: Array<string> = Array.isArray(text)
    ? text
    : (text || "").split(",");
  const seen: Set<string> = new Set();
  const addresses: Array<string> = [];

  for (const part of parts) {
    for (const piece of (part || "").split(" ")) {
      const address: string | null = canonicalAddress(piece);

      if (
        !address ||
        seen.has(address) ||
        getSecurityAddressScope(address) === SecurityAddressScope.Local
      ) {
        continue;
      }

      seen.add(address);
      addresses.push(address);
    }
  }

  return addresses;
}

// Whether a record reports this address, whatever spelling either uses.
export function recordReportsAddress(
  recordAddresses: string | Array<string> | undefined | null,
  address: string,
): boolean {
  const wanted: string | null = canonicalAddress(address);

  return (
    Boolean(wanted) && readRecordAddresses(recordAddresses).includes(wanted!)
  );
}

// ---------- What a lookup looks for ----------

export interface SecurityConnectionLookups {
  /*
   * The names to look records up by, folded, each once: from the entities
   * that are hosts, domains or untyped values with the shape of a host name.
   */
  hostNames: Array<string>;
  // The entity each name came from, by the folded name: its type decides how sure a match is.
  hostNameEntities: Map<string, SecurityEntity>;
  /*
   * What the names are looked up as: each name, and the short form of each
   * full name (a host reporting web-1 for web-1.acme.internal)...
   */
  hostNameQueryValues: Array<string>;
  // ...and the bare names a full name may start with (web-1 for web-1.acme.internal).
  hostNamePrefixes: Array<string>;
  // Addresses, in their one spelling, without the ones that name no machine.
  addresses: Array<string>;
  // Emails, folded.
  emails: Array<string>;
  // The entities looked up at all: what "OneUptime does not know it" is said of.
  lookedUp: Array<SecurityEntity>;
}

const HOST_NAME_ENTITY_TYPES: ReadonlyArray<SecurityEntityType> = [
  SecurityEntityType.Host,
  SecurityEntityType.Domain,
  SecurityEntityType.Other,
];

/*
 * What to look a case's, an event's or an entity's entities up as: a host,
 * domain or untyped value with the shape of a host name as a name, an
 * address as an address, a user's email as an email. A user's bare name, a
 * URL, a file hash and a process are not looked up: nothing in OneUptime is
 * keyed by them.
 */
export function getSecurityConnectionLookups(
  entities: ReadonlyArray<SecurityEntity>,
): SecurityConnectionLookups {
  const hostNames: Set<string> = new Set();
  const hostNameEntities: Map<string, SecurityEntity> = new Map();
  const queryValues: Set<string> = new Set();
  const prefixes: Set<string> = new Set();
  const addresses: Set<string> = new Set();
  const emails: Set<string> = new Set();
  const lookedUp: Array<SecurityEntity> = [];
  const seen: Set<string> = new Set();

  for (const entity of entities.slice(0, SECURITY_CONNECTION_MAX_ENTITIES)) {
    if (!entity || typeof entity.value !== "string") {
      continue;
    }

    const value: string = entity.value.trim();
    const folded: string = value.toLowerCase();

    if (!value || seen.has(folded)) {
      continue;
    }

    const address: string | null = canonicalAddress(value);

    if (address) {
      seen.add(folded);

      if (
        getSecurityAddressScope(address) !== SecurityAddressScope.Local &&
        addresses.size < SECURITY_CONNECTION_MAX_ADDRESSES
      ) {
        addresses.add(address);
        lookedUp.push({ type: entity.type, value });
      }

      continue;
    }

    if (entity.type === SecurityEntityType.User || isEmailLike(value)) {
      seen.add(folded);

      if (isEmailLike(value)) {
        emails.add(folded);
        lookedUp.push({ type: entity.type, value });
      }

      continue;
    }

    if (HOST_NAME_ENTITY_TYPES.includes(entity.type) && isHostNameLike(value)) {
      seen.add(folded);
      hostNames.add(folded);
      hostNameEntities.set(folded, { type: entity.type, value });
      queryValues.add(folded);

      const short: string | null = getShortHostName(folded);

      if (short) {
        queryValues.add(short);
      } else {
        prefixes.add(folded);
      }

      lookedUp.push({ type: entity.type, value });
    }
  }

  return {
    hostNames: Array.from(hostNames),
    hostNameEntities,
    hostNameQueryValues: Array.from(queryValues),
    hostNamePrefixes: Array.from(prefixes),
    addresses: Array.from(addresses),
    emails: Array.from(emails),
    lookedUp,
  };
}

// The best of a record's matches: exact when any is.
export function getBestCertainty(
  certainties: ReadonlyArray<SecurityConnectionCertainty>,
): SecurityConnectionCertainty {
  return certainties.includes(SecurityConnectionCertainty.Exact)
    ? SecurityConnectionCertainty.Exact
    : SecurityConnectionCertainty.Possible;
}

/*
 * The order records are listed in: exact connections first, then by kind
 * (machines, clusters, devices, services, people), then by name.
 */
export function compareConnectedResources(
  a: {
    certainty: SecurityConnectionCertainty;
    kind: SecurityConnectionKind;
    name: string;
  },
  b: {
    certainty: SecurityConnectionCertainty;
    kind: SecurityConnectionKind;
    name: string;
  },
): number {
  if (a.certainty !== b.certainty) {
    return a.certainty === SecurityConnectionCertainty.Exact ? -1 : 1;
  }

  const kindOrder: number =
    SECURITY_CONNECTION_KINDS.indexOf(a.kind) -
    SECURITY_CONNECTION_KINDS.indexOf(b.kind);

  if (kindOrder !== 0) {
    return kindOrder;
  }

  return a.name.localeCompare(b.name);
}

// ---------- Windows ----------

export interface SecurityConnectionWindow {
  start: Date;
  end: Date;
}

function clampToNow(time: Date, now: Date, earliest: Date): Date {
  if (time.getTime() <= now.getTime()) {
    return time;
  }

  // Never before the moment it is about, even on a clock running behind.
  return new Date(Math.max(now.getTime(), earliest.getTime()));
}

/*
 * The window around one event: half an hour either side, ending no later
 * than now - nothing has happened after now, and a picker that says so
 * reads as a mistake.
 */
export function getEventConnectionWindow(
  time: Date,
  now: Date,
): SecurityConnectionWindow {
  return {
    start: OneUptimeDate.addRemoveMinutes(
      time,
      -SECURITY_CONNECTION_EVENT_PADDING_IN_MINUTES,
    ),
    end: clampToNow(
      OneUptimeDate.addRemoveMinutes(
        time,
        SECURITY_CONNECTION_EVENT_PADDING_IN_MINUTES,
      ),
      now,
      time,
    ),
  };
}

/*
 * A case's window: from half an hour before its first detection to half an
 * hour after its last (or its opening, for a case nothing has joined), at
 * most a day - the last day of a long case - and ending no later than now.
 */
export function getCaseConnectionWindow(data: {
  firstDetectedAt?: Date | string | undefined | null;
  lastDetectedAt?: Date | string | undefined | null;
  createdAt?: Date | string | undefined | null;
  now: Date;
}): SecurityConnectionWindow {
  const read: (value: Date | string | undefined | null) => Date | null = (
    value: Date | string | undefined | null,
  ): Date | null => {
    if (!value) {
      return null;
    }

    const date: Date = new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
  };

  const last: Date =
    read(data.lastDetectedAt) ||
    read(data.firstDetectedAt) ||
    read(data.createdAt) ||
    data.now;
  const first: Date = read(data.firstDetectedAt) || last;
  const end: Date = clampToNow(
    OneUptimeDate.addRemoveMinutes(
      last,
      SECURITY_CONNECTION_EVENT_PADDING_IN_MINUTES,
    ),
    data.now,
    last,
  );
  const earliest: Date = OneUptimeDate.addRemoveHours(
    end,
    -SECURITY_CONNECTION_MAX_WINDOW_IN_HOURS,
  );
  const start: Date = OneUptimeDate.addRemoveMinutes(
    first.getTime() < last.getTime() ? first : last,
    -SECURITY_CONNECTION_EVENT_PADDING_IN_MINUTES,
  );

  return {
    start: start.getTime() < earliest.getTime() ? earliest : start,
    end,
  };
}

// ---------- The log an event was read from ----------

export interface SecurityLogResource {
  // The resource type the log row named (Types/Telemetry/ServiceType).
  type: string;
  id: string;
}

/*
 * The resource the log an event was read from was sent under, as the event
 * carries it (SECURITY_LOG_RESOURCE_*_ATTRIBUTE), when it carries a real id:
 * an event of another source, or one written before events carried it, has
 * none.
 */
export function readSecurityLogResource(
  attributes: JSONObject | undefined | null,
): SecurityLogResource | null {
  if (!attributes || typeof attributes !== "object") {
    return null;
  }

  const id: unknown = attributes[SECURITY_LOG_RESOURCE_ID_ATTRIBUTE];
  const type: unknown = attributes[SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE];

  if (
    typeof id !== "string" ||
    typeof type !== "string" ||
    !type.trim() ||
    !ObjectID.isValidUUID(id.trim())
  ) {
    return null;
  }

  return { type: type.trim(), id: id.trim() };
}

// ---------- The way back: what a record is searched for by ----------

/*
 * The values the security events about a record are searched for: its
 * names (folded, each once) and its public addresses (the server keeps only
 * the ones no other record holds). Private addresses are left out - another
 * network's machine can hold the same one - and so are the ones that name
 * no machine; Security Events shows those as possible connections, never
 * counted on the record's page.
 */
export function getRecordSecurityValues(data: {
  names: ReadonlyArray<string | undefined | null>;
  addresses?: string | Array<string> | undefined | null;
}): Array<string> {
  const values: Array<string> = [];
  const seen: Set<string> = new Set();

  for (const name of data.names) {
    const folded: string = (name || "").trim().toLowerCase();

    if (!folded || seen.has(folded) || folded.length > MAX_EMAIL_LENGTH) {
      continue;
    }

    seen.add(folded);
    values.push(folded);
  }

  for (const address of readRecordAddresses(data.addresses)) {
    if (
      getSecurityAddressScope(address) === SecurityAddressScope.Public &&
      !seen.has(address)
    ) {
      seen.add(address);
      values.push(address);
    }
  }

  return values;
}

/*
 * The spellings an observable is searched for, so the index on the events'
 * observables can be used and the usual casings still match: as written,
 * lowercase (how hosts and clusters are keyed) and uppercase (how Windows
 * and many EDRs name machines).
 */
export function getObservableSearchValues(
  values: ReadonlyArray<string>,
  limit: number = SECURITY_CONNECTION_MAX_ENTITIES,
): Array<string> {
  const spellings: Array<string> = [];
  const seen: Set<string> = new Set();

  for (const value of values) {
    const trimmed: string = (value || "").trim();

    if (!trimmed) {
      continue;
    }

    for (const spelling of [
      trimmed,
      trimmed.toLowerCase(),
      trimmed.toUpperCase(),
    ]) {
      if (!seen.has(spelling) && spellings.length < limit) {
        seen.add(spelling);
        spellings.push(spelling);
      }
    }
  }

  return spellings;
}
