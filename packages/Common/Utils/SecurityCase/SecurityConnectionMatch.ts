import {
  normalizeCloudHost,
  readCloudEndpoints,
} from "../../Types/Cloud/CloudInventory";
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

// ---------- URLs ----------

// A URL is at most this long to be read; a longer value is no URL a monitor checks.
export const MAX_URL_LENGTH: number = 2048;

// Whether a value starts with a URL's scheme: letters, then "://".
function hasUrlScheme(value: string): boolean {
  const scheme: number = value.indexOf("://");

  if (scheme < 2 || scheme > 16) {
    return false;
  }

  for (let index: number = 0; index < scheme; index++) {
    const code: number = value.charCodeAt(index);
    const isLetter: boolean =
      (code >= 65 && code <= 90) || (code >= 97 && code <= 122);

    // A scheme starts with a letter; digits, "+", "-" and "." may follow.
    if (
      !isLetter &&
      (index === 0 ||
        !(
          (code >= 48 && code <= 57) ||
          code === 43 ||
          code === 45 ||
          code === 46
        ))
    ) {
      return false;
    }
  }

  return true;
}

/*
 * The host of a URL a case names - https://Shop.acme.example:8443/admin is
 * shop.acme.example - when it is a host name or an address: what a
 * website or API monitor checks. Null for anything else, a URL without a
 * scheme included (it may be a path).
 */
export function getUrlHost(value: string | undefined | null): string | null {
  const text: string = (value || "").trim();

  if (!text || text.length > MAX_URL_LENGTH || !hasUrlScheme(text)) {
    return null;
  }

  const host: string = normalizeCloudHost(text);
  const address: string | null = canonicalAddress(host);

  if (address) {
    return address;
  }

  return isHostNameLike(host) ? host : null;
}

// ---------- Cloud resources ----------

// A cloud resource's ID is at most this long (an Azure resource ID can be long).
export const MAX_RESOURCE_ID_LENGTH: number = 2048;

/*
 * Whether a value is a cloud provider's ID for one resource, which names it
 * and nothing else wherever it is written:
 *   - an AWS ARN: arn:partition:service:region:account:resource;
 *   - an Azure resource ID: /subscriptions/<id>/...;
 *   - a Google Cloud full resource name: //<service>.googleapis.com/....
 * No white space, at most MAX_RESOURCE_ID_LENGTH characters.
 */
export function isCloudResourceIdLike(
  value: string | undefined | null,
): boolean {
  const text: string = (value || "").trim();

  if (text.length < 8 || text.length > MAX_RESOURCE_ID_LENGTH) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    // White space and control characters.
    if (code <= 32 || code === 127) {
      return false;
    }
  }

  const folded: string = text.toLowerCase();

  if (folded.startsWith("arn:")) {
    let colons: number = 0;

    for (let index: number = 0; index < folded.length; index++) {
      if (folded.charCodeAt(index) === 58) {
        colons += 1;
      }
    }

    // arn, partition, service, region, account and the resource.
    return colons >= 5 && !folded.endsWith(":");
  }

  if (folded.startsWith("/subscriptions/")) {
    return folded.length > "/subscriptions/".length;
  }

  if (folded.startsWith("//")) {
    const service: number = folded.indexOf(".googleapis.com/");

    return service > 2 && service + ".googleapis.com/".length < folded.length;
  }

  return false;
}

/*
 * Whether a value a case names is a cloud resource's own ID: compared
 * folded, it is that resource and nothing else, however the value was
 * typed - an ID is never anything's short form.
 */
export function matchResourceId(data: {
  entityValue: string;
  providerResourceId: string | undefined | null;
}): SecurityConnectionVerdict | null {
  const entity: string = foldConnectionValue(data.entityValue);

  if (
    !isCloudResourceIdLike(entity) ||
    entity !== foldConnectionValue(data.providerResourceId)
  ) {
    return null;
  }

  return {
    certainty: SecurityConnectionCertainty.Exact,
    reason: SecurityConnectionReason.ResourceId,
  };
}

/*
 * The names and the addresses a cloud resource answers on (its
 * cloudEndpoints, as a cloud connection's inventory lists them), apart: a
 * name is matched as a host's name is, an address as a host's address is.
 */
export function readCloudEndpointHosts(endpoints: unknown): {
  names: Array<string>;
  addresses: Array<string>;
} {
  const names: Array<string> = [];
  const addresses: Array<string> = [];

  for (const endpoint of readCloudEndpoints(endpoints)) {
    const address: string | null = canonicalAddress(endpoint);

    if (address) {
      if (
        !addresses.includes(address) &&
        getSecurityAddressScope(address) !== SecurityAddressScope.Local
      ) {
        addresses.push(address);
      }
    } else if (isHostNameLike(endpoint) && !names.includes(endpoint)) {
      names.push(endpoint);
    }
  }

  return { names, addresses };
}

// ---------- Monitors ----------

// The most hosts read from one monitor's steps: a monitor has a few steps.
export const MONITOR_TARGET_MAX_HOSTS: number = 10;

// A step value as written: a string, or a URL, Hostname or IP (or their JSON).
function monitorStepText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;

  // The JSON form: { _type: "URL", value: "https://..." }.
  if (typeof record["value"] === "string") {
    return record["value"];
  }

  const text: string = String(value);

  return text === "[object Object]" ? "" : text;
}

// What a JSON or typed object holds under "data" (the class) or "value" (its JSON).
function monitorHolder(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const holder: unknown = record["data"] || record["value"];

  return holder && typeof holder === "object"
    ? (holder as Record<string, unknown>)
    : null;
}

/*
 * A field of a nested monitor setting (dnsMonitor.queryName): a plain object
 * in the class and in its JSON alike.
 */
function monitorSettingText(setting: unknown, key: string): string {
  if (!setting || typeof setting !== "object" || Array.isArray(setting)) {
    return "";
  }

  const value: unknown = (setting as Record<string, unknown>)[key];

  return typeof value === "string" ? value : "";
}

/*
 * The hosts a monitor checks, from its steps - the Monitor column's
 * MonitorSteps or its JSON: a website's or an API's URL by its host; a
 * ping's, a port's, an SSL certificate's or an NTP server's host; the name
 * a DNS monitor looks up and the domain a domain or DNSSEC monitor checks;
 * the host a device's SNMP is polled at. Host names folded, addresses in
 * their one spelling, each once, at most MONITOR_TARGET_MAX_HOSTS. A URL's
 * path, query, user and port are never kept; a step that checks no host
 * (a heartbeat, a script, telemetry) adds nothing.
 */
export function getMonitorTargetHosts(monitorSteps: unknown): Array<string> {
  const hosts: Array<string> = [];
  const holder: Record<string, unknown> | null = monitorHolder(monitorSteps);
  const steps: unknown = holder ? holder["monitorStepsInstanceArray"] : null;

  if (!Array.isArray(steps)) {
    return hosts;
  }

  for (const step of steps) {
    const data: Record<string, unknown> | null = monitorHolder(step);

    if (!data) {
      continue;
    }

    const candidates: Array<string> = [
      monitorStepText(data["monitorDestination"]),
      monitorSettingText(data["dnsMonitor"], "queryName"),
      monitorSettingText(data["dnssecMonitor"], "domainName"),
      monitorSettingText(data["domainMonitor"], "domainName"),
      monitorSettingText(data["snmpMonitor"], "hostname"),
    ];

    for (const candidate of candidates) {
      if (hosts.length >= MONITOR_TARGET_MAX_HOSTS) {
        return hosts;
      }

      const host: string = normalizeCloudHost(candidate);
      const address: string | null = canonicalAddress(host);
      const target: string | null = address
        ? getSecurityAddressScope(address) === SecurityAddressScope.Local
          ? null
          : address
        : isHostNameLike(host)
          ? host
          : null;

      if (target && !hosts.includes(target)) {
        hosts.push(target);
      }
    }
  }

  return hosts;
}

/*
 * Whether a value a case names is what a monitor checks (one of
 * getMonitorTargetHosts):
 *   - an address: exactly when it is a public one, possibly when it is a
 *     private one (another network can use it); a local one names nothing;
 *   - a URL, by its host: exactly when the monitor checks that host;
 *   - a name: as a host's name is matched - exactly when the event says it
 *     is a host or a domain, possibly when it does not say, or when one is
 *     the other's short form.
 * Several monitors checking one address all check it, so how many do never
 * makes it less sure.
 */
export function matchMonitorTarget(data: {
  entityValue: string;
  entityType?: SecurityEntityType | string | undefined;
  target: string;
}): SecurityConnectionVerdict | null {
  const isUrl: boolean =
    data.entityType === SecurityEntityType.Url ||
    hasUrlScheme((data.entityValue || "").trim());
  const host: string | null = isUrl
    ? getUrlHost(data.entityValue)
    : (data.entityValue || "").trim();
  const target: string = (data.target || "").trim();

  if (!host || !target) {
    return null;
  }

  const hostAddress: string | null = canonicalAddress(host);
  const targetAddress: string | null = canonicalAddress(target);

  if (hostAddress || targetAddress) {
    if (!hostAddress || hostAddress !== targetAddress) {
      return null;
    }

    const scope: SecurityAddressScope | null =
      getSecurityAddressScope(hostAddress);

    if (scope === SecurityAddressScope.Public) {
      return {
        certainty: SecurityConnectionCertainty.Exact,
        reason: SecurityConnectionReason.MonitorTarget,
      };
    }

    return scope === SecurityAddressScope.Private
      ? {
          certainty: SecurityConnectionCertainty.Possible,
          reason: SecurityConnectionReason.PrivateAddress,
        }
      : null;
  }

  if (isUrl) {
    return foldConnectionValue(host) === foldConnectionValue(target)
      ? {
          certainty: SecurityConnectionCertainty.Exact,
          reason: SecurityConnectionReason.MonitorTarget,
        }
      : null;
  }

  return matchHostName({
    entityValue: host,
    entityType: data.entityType,
    resourceName: target,
    exactReason: SecurityConnectionReason.MonitorTarget,
  });
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
  /*
   * The hosts of the URLs it names (a host name folded, an address in its
   * one spelling): what a website or API monitor checks...
   */
  urlHosts: Array<string>;
  // ...and the URL each came from, by its host.
  urlHostEntities: Map<string, SecurityEntity>;
  // Cloud resource IDs - ARNs, Azure resource IDs, Google Cloud resource names - folded.
  resourceIds: Array<string>;
  // The entities looked up at all: what "OneUptime does not know it" is said of.
  lookedUp: Array<SecurityEntity>;
}

const HOST_NAME_ENTITY_TYPES: ReadonlyArray<SecurityEntityType> = [
  SecurityEntityType.Host,
  SecurityEntityType.Domain,
  SecurityEntityType.Other,
];

// Whether a value is a URL: typed as one, or written with a scheme.
function isUrlValue(entity: SecurityEntity): boolean {
  return (
    entity.type === SecurityEntityType.Url ||
    (entity.type !== SecurityEntityType.User && hasUrlScheme(entity.value))
  );
}

/*
 * What to look a case's, an event's or an entity's entities up as: a host,
 * domain or untyped value with the shape of a host name as a name, an
 * address as an address, a user's email as an email, a URL by its host,
 * and a cloud provider's ID for a resource as that ID. A user's bare name,
 * a file hash and a process are not looked up: nothing in OneUptime is
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
  const urlHosts: Set<string> = new Set();
  const urlHostEntities: Map<string, SecurityEntity> = new Map();
  const resourceIds: Set<string> = new Set();
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

    if (isUrlValue({ type: entity.type, value })) {
      seen.add(folded);

      const host: string | null = getUrlHost(value);
      const hostAddress: string | null = host ? canonicalAddress(host) : null;

      // A URL on a local address (http://127.0.0.1/) names no machine.
      if (
        host &&
        !(
          hostAddress &&
          getSecurityAddressScope(hostAddress) === SecurityAddressScope.Local
        ) &&
        urlHosts.size < SECURITY_CONNECTION_MAX_ADDRESSES
      ) {
        urlHosts.add(host);

        if (!urlHostEntities.has(host)) {
          urlHostEntities.set(host, { type: entity.type, value });
        }

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

    if (isCloudResourceIdLike(value)) {
      seen.add(folded);

      if (resourceIds.size < SECURITY_CONNECTION_MAX_ADDRESSES) {
        resourceIds.add(folded);
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
    urlHosts: Array.from(urlHosts),
    urlHostEntities,
    resourceIds: Array.from(resourceIds),
    lookedUp,
  };
}

/*
 * The kinds of record each kind of value is looked up among: a name among
 * the machines, clusters, devices, the names cloud resources answer on and
 * the hosts monitors check; an address among the hosts, devices and cloud
 * resources that hold it and the monitors that check it; an email among the
 * project's members; a URL among the monitors that check its host; a cloud
 * resource's ID among the cloud resources.
 */
export const SECURITY_CONNECTION_LOOKUP_KINDS: Readonly<{
  name: ReadonlyArray<SecurityConnectionKind>;
  address: ReadonlyArray<SecurityConnectionKind>;
  email: ReadonlyArray<SecurityConnectionKind>;
  url: ReadonlyArray<SecurityConnectionKind>;
  resourceId: ReadonlyArray<SecurityConnectionKind>;
}> = {
  name: [
    SecurityConnectionKind.Host,
    SecurityConnectionKind.DockerHost,
    SecurityConnectionKind.PodmanHost,
    SecurityConnectionKind.KubernetesCluster,
    SecurityConnectionKind.OpenStackCloud,
    SecurityConnectionKind.NetworkDevice,
    SecurityConnectionKind.CloudResource,
    SecurityConnectionKind.Monitor,
  ],
  address: [
    SecurityConnectionKind.Host,
    SecurityConnectionKind.NetworkDevice,
    SecurityConnectionKind.CloudResource,
    SecurityConnectionKind.Monitor,
  ],
  email: [SecurityConnectionKind.User],
  url: [SecurityConnectionKind.Monitor],
  resourceId: [SecurityConnectionKind.CloudResource],
};

// The most values the project's monitors are searched for in one lookup.
export const SECURITY_CONNECTION_MAX_MONITOR_MENTIONS: number = 160;

/*
 * What the project's monitors are searched for in the database, before
 * each is held to the hosts it really checks (getMonitorTargetHosts): the
 * texts a stored step holds around a host it checks. A monitor's steps are
 * JSON, so a host, an address, a DNS name or a domain it checks is a whole
 * string ("shop.acme.example"), and a URL's host follows its "//" (or a
 * user's "@"). Searching for those, and never for a bare word, keeps a
 * common short name ("www", "api") from reading every monitor of the
 * project - which would push the ones that check it past the read's limit.
 *
 *   a name, a URL's host    "h"   //h   @h
 *   a bare name, also       "h.   //h.  @h.   (h and a domain: its full form)
 *   a full name's short     "s"   //s/  //s:  //s"   (exactly the short form)
 *   form
 *   an IPv4 address         "a"   //a   @a
 *   an IPv6 address         "a"   [a]          (as the case wrote it, and
 *                                                in its one spelling: a
 *                                                monitor keeps an address
 *                                                as somebody typed it)
 *
 * Folded, each once, the case's own names and addresses first, at most
 * SECURITY_CONNECTION_MAX_MONITOR_MENTIONS; matched without case.
 */
export function getMonitorMentionTexts(
  lookups: Pick<
    SecurityConnectionLookups,
    "hostNames" | "urlHosts" | "addresses" | "lookedUp"
  >,
): Array<string> {
  const texts: Array<string> = [];
  const add: (...values: Array<string>) => void = (
    ...values: Array<string>
  ): void => {
    for (const value of values) {
      const folded: string = (value || "").trim().toLowerCase();

      if (
        folded &&
        !texts.includes(folded) &&
        texts.length < SECURITY_CONNECTION_MAX_MONITOR_MENTIONS
      ) {
        texts.push(folded);
      }
    }
  };
  const addHost: (host: string) => void = (host: string): void => {
    add(`"${host}"`, `//${host}`, `@${host}`);
  };

  for (const hostName of lookups.hostNames) {
    addHost(hostName);

    if (!getShortHostName(hostName)) {
      add(`"${hostName}.`, `//${hostName}.`, `@${hostName}.`);
    }
  }

  lookups.urlHosts.forEach((host: string): void => {
    if (canonicalAddress(host)?.includes(":")) {
      add(`"${host}"`, `[${host}]`);
    } else {
      addHost(host);
    }
  });

  for (const address of lookups.addresses) {
    const spellings: Array<string> = [
      address,
      ...lookups.lookedUp
        .filter((entity: SecurityEntity): boolean => {
          return canonicalAddress(entity.value) === address;
        })
        .map((entity: SecurityEntity): string => {
          return entity.value;
        }),
    ];

    for (const spelling of spellings) {
      if (address.includes(":")) {
        add(`"${spelling}"`, `[${spelling}]`);
      } else {
        addHost(spelling);
      }
    }
  }

  // The short forms last: the case's own names find the monitors checking them.
  for (const hostName of lookups.hostNames) {
    const short: string | null = getShortHostName(hostName);

    if (short) {
      add(`"${short}"`, `//${short}/`, `//${short}:`, `//${short}"`);
    }
  }

  return texts;
}

// The kinds of record one value is looked up among, by what it is.
export function getLookupKindsOf(
  entity: SecurityEntity,
): ReadonlyArray<SecurityConnectionKind> {
  const value: string = (entity.value || "").trim();

  if (canonicalAddress(value)) {
    return SECURITY_CONNECTION_LOOKUP_KINDS.address;
  }

  if (isUrlValue({ type: entity.type, value })) {
    return SECURITY_CONNECTION_LOOKUP_KINDS.url;
  }

  if (entity.type === SecurityEntityType.User || isEmailLike(value)) {
    return SECURITY_CONNECTION_LOOKUP_KINDS.email;
  }

  if (isCloudResourceIdLike(value)) {
    return SECURITY_CONNECTION_LOOKUP_KINDS.resourceId;
  }

  return SECURITY_CONNECTION_LOOKUP_KINDS.name;
}

/*
 * Whether a value was looked up among every kind of record it could be. One
 * that was not - a kind the reader's role cannot read, or one whose read
 * failed - is never said to be "not in OneUptime": it may well be there.
 */
export function wasLookedUpEverywhere(
  entity: SecurityEntity,
  unsureKinds: ReadonlySet<SecurityConnectionKind>,
): boolean {
  return !getLookupKindsOf(entity).some(
    (kind: SecurityConnectionKind): boolean => {
      return unsureKinds.has(kind);
    },
  );
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
    // A cloud resource's own ID may be longer than any name or email.
    const maxLength: number = isCloudResourceIdLike(folded)
      ? MAX_RESOURCE_ID_LENGTH
      : MAX_EMAIL_LENGTH;

    if (!folded || seen.has(folded) || folded.length > maxLength) {
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
