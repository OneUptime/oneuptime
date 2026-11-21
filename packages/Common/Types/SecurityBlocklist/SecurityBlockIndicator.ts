/*
 * DOMAINS, URLS AND FILES ON THE BLOCKLIST (#10346): how each is written,
 * one way, however it was typed - so a block, the destination that reads
 * it back and the protected list all compare the same text.
 *
 *   a domain   lower case, in its ASCII form (an internationalized name as
 *              its punycode, xn--...), without a trailing dot: "Evil.Example."
 *              is evil.example;
 *   a URL      http or https, with its scheme and host lower cased, its
 *              default port, fragment and credentials dropped, and its path
 *              and query kept as the browser sends them: the WHATWG
 *              serializer every browser uses, so the provider matches what a
 *              machine requests;
 *   a file     its MD5, SHA-1 or SHA-256 hash, lower-case hex: the hashes
 *              Microsoft Defender and CrowdStrike match files by (CrowdStrike
 *              takes MD5 and SHA-256 only, and says so on the block).
 *
 * Addresses and ranges are SecurityBlock.ts's (readSecurityBlockValue).
 * Pure, so the Dashboard checks what is typed by the same rules the server
 * checks what is saved.
 */

// The longest domain DNS allows, and the longest label of one.
export const SECURITY_BLOCK_DOMAIN_MAX_LENGTH: number = 253;
const DOMAIN_LABEL_MAX_LENGTH: number = 63;

/*
 * The longest URL a block holds, as it is written: the value column's width.
 * A URL longer than this is blocked by a shorter one, or by its domain.
 */
export const SECURITY_BLOCK_URL_MAX_LENGTH: number = 500;

// The kinds of file hash, by their length in hex.
export enum SecurityBlockHashKind {
  Md5 = "Md5",
  Sha1 = "Sha1",
  Sha256 = "Sha256",
}

const HASH_KIND_BY_LENGTH: ReadonlyMap<number, SecurityBlockHashKind> =
  new Map<number, SecurityBlockHashKind>([
    [32, SecurityBlockHashKind.Md5],
    [40, SecurityBlockHashKind.Sha1],
    [64, SecurityBlockHashKind.Sha256],
  ]);

const HEX: RegExp = /^[0-9a-f]+$/;

// A SHA-512 digest: a hash, but not one an endpoint product matches files by.
const SHA512_LENGTH: number = 128;

// A label of a domain in ASCII: letters, digits and hyphens, never a hyphen at either end.
const DOMAIN_LABEL: RegExp = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// A top-level domain: letters, or an internationalized one's punycode.
const TOP_LEVEL_DOMAIN: RegExp = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

// What a value typed as a domain may hold before it is read: no scheme, path, port, credentials or space.
const NOT_IN_A_DOMAIN: RegExp = /[\s/\\:@?#[\]%]/;

// A URL's scheme, as typed.
const URL_SCHEME: RegExp = /^([a-z][a-z0-9+.-]*):\/\//i;

const BLOCKED_URL_SCHEMES: ReadonlyArray<string> = ["http", "https"];

// The hash of a file of no bytes, in each form: blocking one blocks every empty file.
export const EMPTY_FILE_HASHES: ReadonlyArray<string> = [
  "d41d8cd98f00b204e9800998ecf8427e",
  "da39a3ee5e6b4b0d3255bfef95601890afd80709",
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
];

/*
 * Why something typed is not a domain, a URL or a hash OneUptime blocks,
 * when the reason is worth more than "not one": a wildcard, a SHA-512
 * digest, a URL past the longest a block holds, a URL of another scheme.
 */
export enum SecurityBlockIndicatorProblem {
  Wildcard = "Wildcard",
  UnsupportedHash = "UnsupportedHash",
  UrlTooLong = "UrlTooLong",
  UrlScheme = "UrlScheme",
}

export interface SecurityBlockDomainReading {
  domain: string;
}

export interface SecurityBlockUrlReading {
  url: string;
  // Its host: a domain as readSecurityBlockDomain writes it, or an address.
  host: string;
  // Whether its host is an address rather than a domain.
  isAddressHost: boolean;
}

export interface SecurityBlockHashReading {
  hash: string;
  kind: SecurityBlockHashKind;
}

// The hash's kind, by its length, or null for text that is not one OneUptime blocks.
export function readSecurityBlockHash(
  value: unknown,
): SecurityBlockHashReading | null {
  if (typeof value !== "string") {
    return null;
  }

  const hash: string = value.trim().toLowerCase();
  const kind: SecurityBlockHashKind | undefined = HASH_KIND_BY_LENGTH.get(
    hash.length,
  );

  if (!kind || !HEX.test(hash)) {
    return null;
  }

  return { hash, kind };
}

// Whether text is a SHA-512 digest: a file's hash, but not one blocked by.
export function isSha512Hash(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const text: string = value.trim().toLowerCase();

  return text.length === SHA512_LENGTH && HEX.test(text);
}

// Whether a hash is a file of no bytes's: blocking it blocks every empty file.
export function isEmptyFileHash(hash: string): boolean {
  return EMPTY_FILE_HASHES.includes((hash || "").trim().toLowerCase());
}

/*
 * A host name as a block writes it: lower case, ASCII, no trailing dot -
 * or null for one that is not a domain on the internet (one label, a
 * numeric last label, a label too long, characters DNS does not take).
 */
function toAsciiDomain(text: string): string | null {
  let name: string = text.trim();

  if (name.endsWith(".")) {
    name = name.slice(0, -1);
  }

  if (!name || NOT_IN_A_DOMAIN.test(name) || name.includes("*")) {
    return null;
  }

  let hostname: string;

  try {
    // The WHATWG parser lower-cases a name and writes an internationalized one as punycode.
    hostname = new URL(`http://${name}`).hostname;
  } catch {
    return null;
  }

  return isAsciiDomain(hostname) ? hostname : null;
}

// Whether a host name is a domain as a block writes it.
function isAsciiDomain(hostname: string): boolean {
  if (!hostname || hostname.length > SECURITY_BLOCK_DOMAIN_MAX_LENGTH) {
    return false;
  }

  const labels: Array<string> = hostname.split(".");

  if (labels.length < 2) {
    return false;
  }

  for (const label of labels) {
    if (label.length > DOMAIN_LABEL_MAX_LENGTH || !DOMAIN_LABEL.test(label)) {
      return false;
    }
  }

  return TOP_LEVEL_DOMAIN.test(labels[labels.length - 1] || "");
}

// A domain as a block writes it, or null for text that is not one.
export function readSecurityBlockDomain(
  value: unknown,
): SecurityBlockDomainReading | null {
  if (typeof value !== "string") {
    return null;
  }

  const domain: string | null = toAsciiDomain(value);

  return domain ? { domain } : null;
}

// Whether text names a domain with a wildcard: "*.evil.example".
export function isWildcardDomain(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const text: string = value.trim();

  return (
    text.includes("*") &&
    !URL_SCHEME.test(text) &&
    toAsciiDomain(text.split("*").join("x")) !== null
  );
}

/*
 * A URL as a block writes it, or null: http or https, with a host that is
 * a domain or an address. Its fragment and credentials are dropped - a
 * browser never sends them - and so is its default port.
 */
export function readSecurityBlockUrl(
  value: unknown,
): SecurityBlockUrlReading | null {
  if (typeof value !== "string") {
    return null;
  }

  const text: string = value.trim();
  const scheme: RegExpMatchArray | null = text.match(URL_SCHEME);

  if (
    !scheme ||
    !BLOCKED_URL_SCHEMES.includes((scheme[1] || "").toLowerCase()) ||
    /\s/.test(text)
  ) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(text);
  } catch {
    return null;
  }

  url.hash = "";
  url.username = "";
  url.password = "";

  const hostname: string = url.hostname;
  // An IPv6 host is written in brackets.
  const bare: string =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  const isAddressHost: boolean =
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(bare) || bare.includes(":");

  if (!isAddressHost && !isAsciiDomain(bare)) {
    return null;
  }

  return { url: url.href, host: bare, isAddressHost };
}

/*
 * Why what was typed as a domain, URL or file is not one OneUptime blocks,
 * when that is worth saying: null when it is one, or is simply not one.
 */
export function getSecurityBlockIndicatorProblem(
  value: unknown,
): SecurityBlockIndicatorProblem | null {
  if (typeof value !== "string") {
    return null;
  }

  const text: string = value.trim();

  if (isSha512Hash(text)) {
    return SecurityBlockIndicatorProblem.UnsupportedHash;
  }

  const scheme: RegExpMatchArray | null = text.match(URL_SCHEME);

  if (scheme) {
    if (!BLOCKED_URL_SCHEMES.includes((scheme[1] || "").toLowerCase())) {
      return SecurityBlockIndicatorProblem.UrlScheme;
    }

    const url: SecurityBlockUrlReading | null = readSecurityBlockUrl(text);

    return url && url.url.length > SECURITY_BLOCK_URL_MAX_LENGTH
      ? SecurityBlockIndicatorProblem.UrlTooLong
      : null;
  }

  return isWildcardDomain(text) ? SecurityBlockIndicatorProblem.Wildcard : null;
}

/*
 * Whether `child` is `parent` or a name under it: "a.evil.example" is under
 * "evil.example", never "notevil.example". Both as blocks write them.
 */
export function isDomainAtOrUnder(child: string, parent: string): boolean {
  const name: string = (child || "").toLowerCase();
  const zone: string = (parent || "").toLowerCase();

  if (!name || !zone) {
    return false;
  }

  return name === zone || name.endsWith(`.${zone}`);
}
