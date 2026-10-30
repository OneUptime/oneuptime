import IconProp from "../Icon/IconProp";

/*
 * The things a security case is about: the accounts, machines, addresses
 * and files its detections name. An entity is identified by its value (case
 * folded, the way the events table's observables are deduplicated); its type
 * decides the icon, and which response actions can act on it (a user can be
 * suspended, a host contained).
 */
export enum SecurityEntityType {
  User = "User",
  Host = "Host",
  IpAddress = "IP Address",
  Domain = "Domain",
  Url = "URL",
  FileHash = "File Hash",
  Process = "Process",
  // A bucket, database or telemetry stream Data Security watches.
  DataStore = "Data Store",
  Other = "Other",
}

export interface SecurityEntity {
  type: SecurityEntityType;
  value: string;
}

// The most entities a case or detection keeps, so one noisy match cannot grow a row without bound.
export const SECURITY_ENTITY_LIMIT: number = 50;

/*
 * A data store as Security Operations names it: "data-store:" and the
 * store's key (Types/DataSecurity/DataStoreKey) - one name for the store
 * whichever source speaks of it, so a Data Security issue, a detection
 * rule grouped on the store and its criticality entry all mean one entity.
 */
export const DATA_STORE_ENTITY_PREFIX: string = "data-store:";

export function getDataStoreEntityValue(storeKey: string): string {
  return `${DATA_STORE_ENTITY_PREFIX}${(storeKey || "").trim()}`;
}

// Whether a value names a data store: the prefix, whatever its case, and a key after it.
export function isDataStoreEntityValue(
  value: string | undefined | null,
): boolean {
  const trimmed: string = (value || "").trim();

  return (
    trimmed.length > DATA_STORE_ENTITY_PREFIX.length &&
    trimmed.slice(0, DATA_STORE_ENTITY_PREFIX.length).toLowerCase() ===
      DATA_STORE_ENTITY_PREFIX
  );
}

// The store's key in a data store's entity value, or "" for any other value.
export function getDataStoreKeyOfEntityValue(
  value: string | undefined | null,
): string {
  return isDataStoreEntityValue(value)
    ? (value || "").trim().slice(DATA_STORE_ENTITY_PREFIX.length).trim()
    : "";
}

/*
 * The typed security-event columns, and the entity each one holds. A value
 * read from one of these is typed by where it came from, which beats any
 * guess from its shape: an email address in principalUser is a user.
 */
export const SECURITY_EVENT_ENTITY_FIELDS: Readonly<
  Record<string, SecurityEntityType>
> = {
  principalUser: SecurityEntityType.User,
  targetUser: SecurityEntityType.User,
  principalHost: SecurityEntityType.Host,
  targetHost: SecurityEntityType.Host,
  principalIp: SecurityEntityType.IpAddress,
  targetIp: SecurityEntityType.IpAddress,
  principalProcess: SecurityEntityType.Process,
  processName: SecurityEntityType.Process,
  processPath: SecurityEntityType.Process,
  processCommandLine: SecurityEntityType.Process,
  parentProcessName: SecurityEntityType.Process,
  parentProcessPath: SecurityEntityType.Process,
  parentProcessCommandLine: SecurityEntityType.Process,
  targetResource: SecurityEntityType.Other,
};

/*
 * Source attribute keys whose last segment names what the value is, for a
 * rule grouped by an attribute rather than a typed column: CloudTrail's
 * `userIdentity.arn`, Kubernetes audit's `user.username`.
 */
const USER_FIELD_SUFFIX_REGEX: RegExp =
  /(?:^|[._])(?:user|username|user_name|login|account|arn|email|upn)$/i;
const HOST_FIELD_SUFFIX_REGEX: RegExp =
  /(?:^|[._])(?:host|hostname|host_name|computer|computername|device|machine)$/i;
const IP_FIELD_SUFFIX_REGEX: RegExp =
  /(?:^|[._])(?:ip|ipaddress|ip_address|src_ip|dst_ip|address|addr)$/i;

/*
 * The entity a value read from this field is: a typed column's own type, a
 * type an attribute key's name gives away, or undefined when the field says
 * nothing and the value's shape has to decide.
 */
export function securityEntityTypeForField(
  field: string | undefined | null,
): SecurityEntityType | undefined {
  const name: string = (field || "").trim();

  if (!name) {
    return undefined;
  }

  // Own keys only: a field named "constructor" is an attribute, not a column.
  if (
    Object.prototype.hasOwnProperty.call(SECURITY_EVENT_ENTITY_FIELDS, name)
  ) {
    const typed: SecurityEntityType = SECURITY_EVENT_ENTITY_FIELDS[name]!;
    return typed === SecurityEntityType.Other ? undefined : typed;
  }

  if (USER_FIELD_SUFFIX_REGEX.test(name)) {
    return SecurityEntityType.User;
  }

  if (HOST_FIELD_SUFFIX_REGEX.test(name)) {
    return SecurityEntityType.Host;
  }

  if (IP_FIELD_SUFFIX_REGEX.test(name)) {
    return SecurityEntityType.IpAddress;
  }

  return undefined;
}

const IPV4_REGEX: RegExp = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
// Hex groups and colons only, at least two colons: "::1", "2001:db8::7".
const IPV6_REGEX: RegExp = /^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}$/i;
// MD5, SHA-1, SHA-256 and SHA-512 digests.
const HASH_REGEX: RegExp =
  /^(?:[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64}|[0-9a-f]{128})$/i;
const EMAIL_REGEX: RegExp = /^[^@\s]{1,64}@[^@\s]{1,255}\.[a-z]{2,63}$/i;
const URL_REGEX: RegExp = /^[a-z][a-z0-9+.-]{1,15}:\/\/\S+$/i;
// Labels of letters, digits and hyphens, ending in an alphabetic TLD.
const DOMAIN_REGEX: RegExp =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function isIpAddress(value: string): boolean {
  const trimmed: string = (value || "").trim();
  const v4: RegExpMatchArray | null = trimmed.match(IPV4_REGEX);

  if (v4) {
    return v4.slice(1).every((octet: string): boolean => {
      return Number(octet) <= 255;
    });
  }

  return trimmed.includes(":") && IPV6_REGEX.test(trimmed);
}

/*
 * The type of an observable the source did not type, from its shape alone.
 * An email address reads as a user (in security data it is almost always a
 * sign-in name); a dotted name as a domain; anything that matches nothing
 * is Other, never a guess.
 *
 * A data store's name is OneUptime's own ("data-store:" and its key), and
 * is read first: a key holds an ARN, a Google Cloud resource name or a
 * traced database's address, whose colons, slashes and "@" the shapes
 * below would take for a URL, an address or a user.
 */
export function inferSecurityEntityType(value: string): SecurityEntityType {
  const trimmed: string = (value || "").trim();

  if (!trimmed) {
    return SecurityEntityType.Other;
  }

  if (isDataStoreEntityValue(trimmed)) {
    return SecurityEntityType.DataStore;
  }

  if (isIpAddress(trimmed)) {
    return SecurityEntityType.IpAddress;
  }

  if (HASH_REGEX.test(trimmed)) {
    return SecurityEntityType.FileHash;
  }

  if (URL_REGEX.test(trimmed)) {
    return SecurityEntityType.Url;
  }

  if (EMAIL_REGEX.test(trimmed)) {
    return SecurityEntityType.User;
  }

  if (DOMAIN_REGEX.test(trimmed)) {
    return SecurityEntityType.Domain;
  }

  return SecurityEntityType.Other;
}

export function securityEntityKey(entity: SecurityEntity): string {
  return entity.value.trim().toLowerCase();
}

/*
 * Merges entity lists: first occurrence wins (an entity typed from a field
 * keeps that type even when an untyped copy of it comes later), empty values
 * are dropped, and the result is capped at SECURITY_ENTITY_LIMIT.
 */
export function mergeSecurityEntities(
  ...lists: Array<Array<SecurityEntity> | undefined | null>
): Array<SecurityEntity> {
  const seen: Map<string, SecurityEntity> = new Map();

  for (const list of lists) {
    for (const entity of list || []) {
      if (!entity || typeof entity.value !== "string") {
        continue;
      }

      const value: string = entity.value.trim();

      if (!value) {
        continue;
      }

      const key: string = value.toLowerCase();
      const existing: SecurityEntity | undefined = seen.get(key);

      if (existing) {
        /*
         * A later typed copy improves an earlier Other: the observable list
         * comes first in some writers, and losing "this is a host" to the
         * order of two arrays would be silly.
         */
        if (
          existing.type === SecurityEntityType.Other &&
          entity.type !== SecurityEntityType.Other
        ) {
          existing.type = entity.type;
        }
        continue;
      }

      if (seen.size >= SECURITY_ENTITY_LIMIT) {
        continue;
      }

      seen.set(key, {
        type: Object.values(SecurityEntityType).includes(entity.type)
          ? entity.type
          : inferSecurityEntityType(value),
        value,
      });
    }
  }

  return Array.from(seen.values());
}

// Entities for a list of untyped observable values.
export function entitiesFromObservables(
  observables: Array<string> | undefined | null,
): Array<SecurityEntity> {
  return mergeSecurityEntities(
    (observables || []).map((value: string): SecurityEntity => {
      return { type: inferSecurityEntityType(value), value };
    }),
  );
}

export function getSecurityEntityIcon(
  type: SecurityEntityType | string,
): IconProp {
  switch (type) {
    case SecurityEntityType.User:
      return IconProp.User;
    case SecurityEntityType.Host:
      return IconProp.ServerStack;
    case SecurityEntityType.IpAddress:
      return IconProp.Globe;
    case SecurityEntityType.Domain:
      return IconProp.GlobeAlt;
    case SecurityEntityType.Url:
      return IconProp.Link;
    case SecurityEntityType.FileHash:
      return IconProp.Fingerprint;
    case SecurityEntityType.Process:
      return IconProp.Terminal;
    case SecurityEntityType.DataStore:
      return IconProp.Database;
    default:
      return IconProp.Tag;
  }
}

/*
 * The entities stored on a case or a detection - a JSON array of
 * { type, value } - read defensively: a row written by an older version, or
 * by hand through the API, may hold anything. A value-less entry is dropped
 * and a type this version does not know reads as Other.
 */
export function readSecurityEntities(value: unknown): Array<SecurityEntity> {
  if (!Array.isArray(value)) {
    return [];
  }

  const types: Array<string> = Object.values(SecurityEntityType);
  const entities: Array<SecurityEntity> = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record: Record<string, unknown> = item as Record<string, unknown>;
    const entityValue: unknown = record["value"];

    if (typeof entityValue !== "string" || !entityValue.trim()) {
      continue;
    }

    const type: unknown = record["type"];

    entities.push({
      type:
        typeof type === "string" && types.includes(type)
          ? (type as SecurityEntityType)
          : SecurityEntityType.Other,
      value: entityValue,
    });
  }

  return entities;
}
