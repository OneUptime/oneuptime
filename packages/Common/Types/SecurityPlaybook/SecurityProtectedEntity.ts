import { SecurityEntityType } from "../SecurityCase/SecurityEntity";
import {
  SecurityBlockHashReading,
  SecurityBlockUrlReading,
  isDomainAtOrUnder,
  readSecurityBlockDomain,
  readSecurityBlockHash,
  readSecurityBlockUrl,
} from "../SecurityBlocklist/SecurityBlockIndicator";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../Utils/NetworkTraffic/NetworkAddressBlock";

/*
 * The users, hosts, addresses, domains and files a project's containment
 * never touches: break-glass accounts, domain controllers, the VPN gateway
 * every attack against the network names, the office's address, the
 * company's own domains, the installers of its own software. A protected
 * user or host is a value or a pattern of one, matched whatever the case:
 * `*` stands for any run of characters, so `svc-*` protects every service
 * account and `*.corp.example.com` every host of a domain. A protected
 * address is an IPv4 or IPv6 address or a range of them (203.0.113.0/24,
 * 2001:db8::/48), matched as a range: it protects every address inside it,
 * and refuses a block of a range that holds any of them. A protected
 * domain (#10346) is a name, or `*.` and a name for every name under it;
 * a block of a name above it is refused too, since a block of a domain
 * blocks the names under it, and so is a URL on it. A protected file is
 * its MD5, SHA-1 or SHA-256 hash. A containment step reports a protected
 * target as protected, and neither it nor an approver can act on it; the
 * blocklist refuses to block it (#10338).
 */

/*
 * The kinds of entity containment acts on, and so the ones a project
 * protects: users and hosts, which playbooks suspend and contain, and
 * addresses, domains and files, which the blocklist blocks. A data store
 * is none of them: the steps that close a store's exposure (Block public
 * access to data stores, Revoke data store sharing) change how it is
 * shared, never cut anyone off, and a store meant to be public is protected
 * where it is described - marked public by design in its Settings, which
 * those steps leave alone. A URL is protected by its host's domain.
 */
export const PROTECTED_ENTITY_TYPES: ReadonlyArray<SecurityEntityType> = [
  SecurityEntityType.User,
  SecurityEntityType.Host,
  SecurityEntityType.IpAddress,
  SecurityEntityType.Domain,
  SecurityEntityType.FileHash,
];

// The start of a protected domain that covers every name under it: "*.example.com".
export const PROTECTED_SUBDOMAINS_PREFIX: string = "*.";

/*
 * A protected domain as stored: a name as blocks write it (lower case,
 * ASCII, no trailing dot), or `*.` and one for every name under it - or
 * null for a value that is neither.
 */
export function normalizeProtectedDomainValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text: string = value.trim();
  const isSubdomains: boolean = text.startsWith(PROTECTED_SUBDOMAINS_PREFIX);
  const domain: { domain: string } | null = readSecurityBlockDomain(
    isSubdomains ? text.slice(PROTECTED_SUBDOMAINS_PREFIX.length) : text,
  );

  if (!domain) {
    return null;
  }

  return isSubdomains
    ? `${PROTECTED_SUBDOMAINS_PREFIX}${domain.domain}`
    : domain.domain;
}

// A protected file as stored: its hash in lower-case hex, or null for a value that is not one.
export function normalizeProtectedFileHashValue(value: unknown): string | null {
  const hash: SecurityBlockHashReading | null = readSecurityBlockHash(value);

  return hash ? hash.hash : null;
}

/*
 * Whether blocking `value` - a domain, or a URL - touches a protected
 * domain entry: the same name; a name above it, whose block would block it;
 * and, for an entry of `*.` and a name, any name under that name. A URL
 * touches the entry when its host is the name, or under a `*.` entry: its
 * block blocks that page of the protected site.
 */
export function matchesProtectedDomain(
  entryValue: string,
  value: string,
): boolean {
  const entry: string | null = normalizeProtectedDomainValue(entryValue);

  if (!entry) {
    return false;
  }

  const isSubdomains: boolean = entry.startsWith(PROTECTED_SUBDOMAINS_PREFIX);
  const protectedName: string = isSubdomains
    ? entry.slice(PROTECTED_SUBDOMAINS_PREFIX.length)
    : entry;

  const url: SecurityBlockUrlReading | null = readSecurityBlockUrl(value);

  if (url) {
    return (
      !url.isAddressHost &&
      (url.host === protectedName ||
        (isSubdomains && isDomainAtOrUnder(url.host, protectedName)))
    );
  }

  const domain: { domain: string } | null = readSecurityBlockDomain(value);

  if (!domain) {
    return false;
  }

  return (
    isDomainAtOrUnder(protectedName, domain.domain) ||
    (isSubdomains && isDomainAtOrUnder(domain.domain, protectedName))
  );
}

// Whether a file's hash is a protected entry's, whatever its case.
export function matchesProtectedFileHash(
  entryValue: string,
  value: string,
): boolean {
  const entry: string | null = normalizeProtectedFileHashValue(entryValue);
  const hash: string | null = normalizeProtectedFileHashValue(value);

  return Boolean(entry && hash && entry === hash);
}

export const PROTECTED_ENTITY_VALUE_MAX_LENGTH: number = 500;

export const PROTECTED_ENTITY_WILDCARD: string = "*";

export interface ProtectedEntityRule {
  type: SecurityEntityType;
  // The value or pattern, as the project wrote it.
  value: string;
}

export function isProtectedEntityType(
  value: unknown,
): value is SecurityEntityType {
  return (
    typeof value === "string" &&
    (PROTECTED_ENTITY_TYPES as ReadonlyArray<string>).includes(value)
  );
}

/*
 * A protected address as stored: an address or a range written the one way
 * blocks are (NetworkAddressBlock: an IPv6 address compressed in lowercase,
 * a range as its first address and its length), or null when the value is
 * neither.
 */
export function normalizeProtectedAddressValue(value: unknown): string | null {
  const block: NetworkAddressBlock | null = NetworkAddressBlockUtil.parse(
    typeof value === "string" ? value : "",
  );

  return block ? block.text : null;
}

/*
 * Whether an address or a range is protected by an entry of the list that
 * names an address or a range: whether the two share any address. A block
 * of 203.0.113.0/24 is refused by an entry of 203.0.113.10, and a block of
 * 203.0.113.10 by an entry of 203.0.113.0/24. Never true for a value that is
 * not an address or a range, or for two of different families.
 */
export function matchesProtectedAddress(
  entryValue: string,
  value: string,
): boolean {
  const entry: NetworkAddressBlock | null = NetworkAddressBlockUtil.parse(
    entryValue || "",
  );
  const block: NetworkAddressBlock | null = NetworkAddressBlockUtil.parse(
    value || "",
  );

  return Boolean(
    entry && block && NetworkAddressBlockUtil.overlaps(entry, block),
  );
}

// A protected value as stored: trimmed, with no run of wildcards.
export function normalizeProtectedEntityValue(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  let text: string = value.trim();

  while (text.includes("**")) {
    text = text.split("**").join("*");
  }

  return text;
}

/*
 * Whether a value matches a protected pattern, whatever the case. Matched
 * piece by piece rather than with a regular expression: the pieces are
 * found in order, the first at the start and the last at the end.
 */
export function matchesProtectedEntityPattern(
  pattern: string,
  value: string,
): boolean {
  const wanted: string = normalizeProtectedEntityValue(pattern).toLowerCase();
  const text: string = (value || "").trim().toLowerCase();

  if (!wanted || !text) {
    return false;
  }

  if (!wanted.includes(PROTECTED_ENTITY_WILDCARD)) {
    return wanted === text;
  }

  const pieces: Array<string> = wanted.split(PROTECTED_ENTITY_WILDCARD);
  const first: string = pieces[0] || "";
  const last: string = pieces[pieces.length - 1] || "";

  if (!text.startsWith(first)) {
    return false;
  }

  let position: number = first.length;

  for (let index: number = 1; index < pieces.length - 1; index++) {
    const piece: string = pieces[index] || "";

    if (!piece) {
      continue;
    }

    const found: number = text.indexOf(piece, position);

    if (found < 0) {
      return false;
    }

    position = found + piece.length;
  }

  return text.length - last.length >= position && text.endsWith(last);
}

/*
 * The kind of protected entry that protects an entity of this kind: its
 * own, except a URL, which its host's domain entries protect.
 */
export function getProtectedEntityTypeFor(
  type: SecurityEntityType,
): SecurityEntityType {
  return type === SecurityEntityType.Url ? SecurityEntityType.Domain : type;
}

/*
 * The entry that protects this entity, if any: a user or a host by its
 * value or pattern, an address by the range it falls in, a domain or a URL
 * by the domains (matchesProtectedDomain), a file by its hash.
 */
export function findProtectingRule(data: {
  type: SecurityEntityType;
  value: string;
  rules: ReadonlyArray<ProtectedEntityRule>;
}): ProtectedEntityRule | undefined {
  const ruleType: SecurityEntityType = getProtectedEntityTypeFor(data.type);

  return data.rules.find((rule: ProtectedEntityRule): boolean => {
    if (rule.type !== ruleType) {
      return false;
    }

    switch (rule.type) {
      case SecurityEntityType.IpAddress:
        return matchesProtectedAddress(rule.value, data.value);
      case SecurityEntityType.Domain:
        return matchesProtectedDomain(rule.value, data.value);
      case SecurityEntityType.FileHash:
        return matchesProtectedFileHash(rule.value, data.value);
      default:
        return matchesProtectedEntityPattern(rule.value, data.value);
    }
  });
}
