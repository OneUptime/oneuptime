import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  SECURITY_BLOCK_URL_MAX_LENGTH,
  SecurityBlockHashKind,
  SecurityBlockHashReading,
  SecurityBlockIndicatorProblem,
  SecurityBlockUrlReading,
  getSecurityBlockIndicatorProblem,
  readSecurityBlockDomain,
  readSecurityBlockHash,
  readSecurityBlockUrl,
} from "./SecurityBlockIndicator";

/*
 * THE BLOCKLIST: what a project blocks, why, until when, and where it is
 * enforced (#10338).
 *
 * One block is one thing the project blocks: an address or a range of
 * addresses, blocked or challenged at the edge (#10338), or a domain, a URL
 * or a file blocked on every machine (#10346), until it expires or someone
 * lifts it.
 * The blocklist is a desired state that OneUptime keeps true at every
 * destination that enforces it (Cloudflare, AWS WAF, Azure WAF, Cloud Armor,
 * a firewall that reads a feed, Microsoft Defender, CrowdStrike - each its
 * own issue of #10335), the way a Kubernetes controller keeps a resource:
 * a block is written here once, and the reconciler applies it, reads it
 * back, puts it back when it is removed at the provider and takes it away
 * when the block ends (Server/Utils/SecurityBlocklist).
 *
 * Here: the kinds of value, actions, states and sources a block has, how a
 * value is written (one way, however it was typed), how long a block lasts,
 * and how wide a range may be. Pure, so the Dashboard checks what is typed
 * by the same rules the server checks what is saved.
 */

/*
 * What a block holds: an address or a range (#10338), or a domain, a URL
 * or a file by its hash (#10346), which the endpoint products block on
 * every machine (Microsoft Defender, CrowdStrike). How each is written is
 * readSecurityBlockIndicator's, and SecurityBlockIndicator.ts's.
 */
export enum SecurityBlockIndicatorType {
  IpAddress = "IpAddress",
  IpRange = "IpRange",
  Domain = "Domain",
  Url = "Url",
  FileSha256 = "FileSha256",
  FileSha1 = "FileSha1",
  FileMd5 = "FileMd5",
}

/*
 * What a destination does with what a block matches: turns it away, asks
 * for a challenge a person passes and a script does not (an address at the
 * edge), or - for a file - blocks it and quarantines the copies it finds.
 * A destination that cannot do one says so on the block (supports()).
 */
export enum SecurityBlockAction {
  Block = "Block",
  Challenge = "Challenge",
  BlockAndQuarantine = "BlockAndQuarantine",
}

/*
 * Where a block is enforced (#10346). An address is blocked at the edge in
 * front of the app - Cloudflare, AWS WAF, a firewall that reads the feed -
 * unless it is blocked everywhere: then on every machine too, through
 * Microsoft Defender or CrowdStrike, which a case about a command-and-
 * control server needs, since what matters there is the machines reaching
 * out. A domain, a URL or a file is blocked everywhere OneUptime can: on
 * every machine, and at a firewall or a proxy that holds them.
 *
 * So an endpoint product never fills its indicators with every scanner the
 * edge turns away, and an address can be blocked at the edge and, on its
 * own, everywhere: two blocks, each with its own end.
 */
export enum SecurityBlockReach {
  Edge = "Edge",
  Everywhere = "Everywhere",
}

/*
 * Where a block stands. Active until someone lifts it or its time is up;
 * an ended block is kept, with who ended it and why, so a case and the
 * next block of the same address can say it was blocked before.
 */
export enum SecurityBlockState {
  Active = "Active",
  Lifted = "Lifted",
  Expired = "Expired",
}

/*
 * Who or what made the block: a person on the Blocklist page, a playbook's
 * step (securityPlaybookRunId), an automatic response policy (#10350),
 * OneUptime AI (#10352) or an API key.
 */
export enum SecurityBlockSource {
  Person = "Person",
  Playbook = "Playbook",
  AutomaticResponse = "AutomaticResponse",
  OneUptimeAi = "OneUptimeAi",
  Api = "Api",
}

export const SECURITY_BLOCK_INDICATOR_TYPES: ReadonlyArray<SecurityBlockIndicatorType> =
  [
    SecurityBlockIndicatorType.IpAddress,
    SecurityBlockIndicatorType.IpRange,
    SecurityBlockIndicatorType.Domain,
    SecurityBlockIndicatorType.Url,
    SecurityBlockIndicatorType.FileSha256,
    SecurityBlockIndicatorType.FileSha1,
    SecurityBlockIndicatorType.FileMd5,
  ];

// The kinds of value that are an address or a range of them.
export const SECURITY_BLOCK_ADDRESS_TYPES: ReadonlyArray<SecurityBlockIndicatorType> =
  [SecurityBlockIndicatorType.IpAddress, SecurityBlockIndicatorType.IpRange];

// The kinds of value that are a file, by its hash.
export const SECURITY_BLOCK_FILE_TYPES: ReadonlyArray<SecurityBlockIndicatorType> =
  [
    SecurityBlockIndicatorType.FileSha256,
    SecurityBlockIndicatorType.FileSha1,
    SecurityBlockIndicatorType.FileMd5,
  ];

export const SECURITY_BLOCK_ACTIONS: ReadonlyArray<SecurityBlockAction> = [
  SecurityBlockAction.Block,
  SecurityBlockAction.Challenge,
  SecurityBlockAction.BlockAndQuarantine,
];

export const SECURITY_BLOCK_REACHES: ReadonlyArray<SecurityBlockReach> = [
  SecurityBlockReach.Edge,
  SecurityBlockReach.Everywhere,
];

export function isSecurityBlockIndicatorType(
  value: unknown,
): value is SecurityBlockIndicatorType {
  return (
    typeof value === "string" &&
    (SECURITY_BLOCK_INDICATOR_TYPES as ReadonlyArray<string>).includes(value)
  );
}

export function isSecurityBlockReach(
  value: unknown,
): value is SecurityBlockReach {
  return (
    typeof value === "string" &&
    (SECURITY_BLOCK_REACHES as ReadonlyArray<string>).includes(value)
  );
}

// Whether a block's value is an address or a range.
export function isSecurityBlockAddressType(
  type: SecurityBlockIndicatorType | string | undefined | null,
): boolean {
  return (SECURITY_BLOCK_ADDRESS_TYPES as ReadonlyArray<string>).includes(
    type || "",
  );
}

// Whether a block's value is a file's hash.
export function isSecurityBlockFileType(
  type: SecurityBlockIndicatorType | string | undefined | null,
): boolean {
  return (SECURITY_BLOCK_FILE_TYPES as ReadonlyArray<string>).includes(
    type || "",
  );
}

/*
 * Where a block of this kind is enforced: an address where asked - at the
 * edge unless asked for everywhere - and anything else everywhere.
 */
export function getSecurityBlockReach(data: {
  indicatorType: SecurityBlockIndicatorType | string | undefined | null;
  reach?: SecurityBlockReach | string | undefined | null;
}): SecurityBlockReach {
  if (!isSecurityBlockAddressType(data.indicatorType)) {
    return SecurityBlockReach.Everywhere;
  }

  return data.reach === SecurityBlockReach.Everywhere
    ? SecurityBlockReach.Everywhere
    : SecurityBlockReach.Edge;
}

/*
 * Whether a block made to reach `held` already does what one to reach
 * `wanted` would: a block everywhere is a block at the edge too, never the
 * other way round. A block written before reach was kept is at the edge.
 */
export function doesSecurityBlockReachCover(data: {
  held: SecurityBlockReach | string | undefined | null;
  wanted: SecurityBlockReach | string | undefined | null;
}): boolean {
  return (
    data.held === SecurityBlockReach.Everywhere ||
    data.wanted !== SecurityBlockReach.Everywhere
  );
}

// The kind of a file block, by its hash's.
export function getSecurityBlockFileType(
  kind: SecurityBlockHashKind,
): SecurityBlockIndicatorType {
  switch (kind) {
    case SecurityBlockHashKind.Md5:
      return SecurityBlockIndicatorType.FileMd5;
    case SecurityBlockHashKind.Sha1:
      return SecurityBlockIndicatorType.FileSha1;
    default:
      return SecurityBlockIndicatorType.FileSha256;
  }
}

export const SECURITY_BLOCK_STATES: ReadonlyArray<SecurityBlockState> = [
  SecurityBlockState.Active,
  SecurityBlockState.Lifted,
  SecurityBlockState.Expired,
];

export const SECURITY_BLOCK_SOURCES: ReadonlyArray<SecurityBlockSource> = [
  SecurityBlockSource.Person,
  SecurityBlockSource.Playbook,
  SecurityBlockSource.AutomaticResponse,
  SecurityBlockSource.OneUptimeAi,
  SecurityBlockSource.Api,
];

export function isSecurityBlockAction(
  value: unknown,
): value is SecurityBlockAction {
  return (
    typeof value === "string" &&
    (SECURITY_BLOCK_ACTIONS as ReadonlyArray<string>).includes(value)
  );
}

export function isSecurityBlockState(
  value: unknown,
): value is SecurityBlockState {
  return (
    typeof value === "string" &&
    (SECURITY_BLOCK_STATES as ReadonlyArray<string>).includes(value)
  );
}

export function isSecurityBlockSource(
  value: unknown,
): value is SecurityBlockSource {
  return (
    typeof value === "string" &&
    (SECURITY_BLOCK_SOURCES as ReadonlyArray<string>).includes(value)
  );
}

// ---------- How long a block lasts ----------

const HOUR_IN_MS: number = 60 * 60 * 1000;
const DAY_IN_MS: number = 24 * HOUR_IN_MS;

/*
 * The lengths a block is made for. Every block expires unless someone asks
 * for one that stays until it is lifted: blocks that never end pile up, and
 * an address is often someone else's within days (a cloud VM, a NAT).
 */
export enum SecurityBlockDuration {
  OneHour = "OneHour",
  OneDay = "OneDay",
  SevenDays = "SevenDays",
  ThirtyDays = "ThirtyDays",
  UntilLifted = "UntilLifted",
}

// The length a block gets when nobody says: a day.
export const SECURITY_BLOCK_DEFAULT_DURATION: SecurityBlockDuration =
  SecurityBlockDuration.OneDay;

// The lengths that end by themselves, in the order they are offered.
export const SECURITY_BLOCK_EXPIRING_DURATIONS: ReadonlyArray<SecurityBlockDuration> =
  [
    SecurityBlockDuration.OneHour,
    SecurityBlockDuration.OneDay,
    SecurityBlockDuration.SevenDays,
    SecurityBlockDuration.ThirtyDays,
  ];

export const SECURITY_BLOCK_DURATION_IN_MS: Readonly<
  Record<
    Exclude<SecurityBlockDuration, SecurityBlockDuration.UntilLifted>,
    number
  >
> = {
  [SecurityBlockDuration.OneHour]: HOUR_IN_MS,
  [SecurityBlockDuration.OneDay]: DAY_IN_MS,
  [SecurityBlockDuration.SevenDays]: 7 * DAY_IN_MS,
  [SecurityBlockDuration.ThirtyDays]: 30 * DAY_IN_MS,
};

/*
 * The longest a block that expires may be made or extended for, from now:
 * a year. Longer is what "until lifted" is for, which a Security Admin
 * chooses on purpose.
 */
export const SECURITY_BLOCK_LONGEST_EXPIRY_IN_MS: number = 366 * DAY_IN_MS;

/*
 * How far in the past an expiry a request sends may be and still be read
 * as now: a browser's clock a little behind the server's.
 */
export const SECURITY_BLOCK_EXPIRY_CLOCK_SLACK_IN_MS: number = 60 * 1000;

export function isSecurityBlockDuration(
  value: unknown,
): value is SecurityBlockDuration {
  return (
    typeof value === "string" &&
    (Object.values(SecurityBlockDuration) as Array<string>).includes(value)
  );
}

// When a block made at `from` for `duration` ends: null when it stays until lifted.
export function getSecurityBlockExpiry(
  duration: SecurityBlockDuration,
  from: Date,
): Date | null {
  if (duration === SecurityBlockDuration.UntilLifted) {
    return null;
  }

  return new Date(from.getTime() + SECURITY_BLOCK_DURATION_IN_MS[duration]);
}

/*
 * How long a block was meant to last, as the expiry worker says it ("after
 * 24 hours"): the length it was made for when that is one of the choices,
 * else hours, else days. Null for a block with no end.
 */
export function describeSecurityBlockLength(data: {
  from: Date;
  until: Date | null | undefined;
}): string | null {
  if (!data.until) {
    return null;
  }

  const length: number = data.until.getTime() - data.from.getTime();

  if (length <= 0) {
    return "a moment";
  }

  const hours: number = Math.max(1, Math.round(length / HOUR_IN_MS));

  if (hours < 48) {
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }

  const days: number = Math.round(length / DAY_IN_MS);

  return days === 1 ? "1 day" : `${days} days`;
}

// ---------- The value ----------

/*
 * How wide a range a block may cover: no wider than a /24 of IPv4 or a /48
 * of IPv6. A wider block takes out whole networks - a cloud region's, a
 * mobile carrier's - and their people with them. A person with Security
 * Admin (or a Project Owner or Admin) may block wider, on purpose, down to
 * the widest below; a playbook, an automatic response and OneUptime AI
 * never do.
 */
export const SECURITY_BLOCK_LARGEST_IPV4_PREFIX: number = 24;
export const SECURITY_BLOCK_LARGEST_IPV6_PREFIX: number = 48;

/*
 * The widest anyone may block: a /8 of IPv4 and a /16 of IPv6. Past it a
 * block is no longer about an attacker, and the edges refuse it anyway
 * (Cloudflare's lists take IPv4 /8 at the widest).
 */
export const SECURITY_BLOCK_WIDEST_IPV4_PREFIX: number = 8;
export const SECURITY_BLOCK_WIDEST_IPV6_PREFIX: number = 16;

/*
 * The longest value a block holds: a URL (SECURITY_BLOCK_URL_MAX_LENGTH).
 * A domain is at most 253 characters, a hash 64 and an IPv6 range 43.
 */
export const SECURITY_BLOCK_VALUE_MAX_LENGTH: number =
  SECURITY_BLOCK_URL_MAX_LENGTH;

// The longest reason, and lift reason, a block keeps.
export const SECURITY_BLOCK_REASON_MAX_LENGTH: number = 500;

/*
 * A block's value as it is kept, worked out from what was typed: an IPv4
 * address dotted, an IPv6 address compressed in lowercase (RFC 5952), a
 * range as its first address and its length ("35.205.11.77/24" is
 * 35.205.11.0/24), and a /32 or /128 as the bare address it is. An IPv4
 * address an IPv6 one maps (::ffff:35.205.11.131) is that IPv4 address.
 */
export interface SecurityBlockValue {
  indicatorType: SecurityBlockIndicatorType;
  value: string;
  block: NetworkAddressBlock;
}

export function readSecurityBlockValue(
  value: unknown,
): SecurityBlockValue | null {
  if (typeof value !== "string") {
    return null;
  }

  const block: NetworkAddressBlock | null =
    NetworkAddressBlockUtil.parse(value);

  if (!block) {
    return null;
  }

  return {
    indicatorType: NetworkAddressBlockUtil.isSingleAddress(block)
      ? SecurityBlockIndicatorType.IpAddress
      : SecurityBlockIndicatorType.IpRange,
    value: block.text,
    block,
  };
}

/*
 * Anything a block holds, as it is kept (#10346): an address or a range
 * (with the block it covers), a domain, a URL (with its host: a domain, or
 * an address) or a file's hash.
 */
export interface SecurityBlockIndicatorValue {
  indicatorType: SecurityBlockIndicatorType;
  value: string;
  // An address or a range: what it covers.
  block?: NetworkAddressBlock | undefined;
  // A domain, or a URL's host when that is a domain.
  domain?: string | undefined;
  // A URL's host when that is an address.
  address?: string | undefined;
}

/*
 * What a value is and how it is kept, whatever it is, or null when it is
 * none of them: an address or a range first, then a file's hash, a URL
 * (which starts with its scheme) and a domain.
 */
export function readSecurityBlockIndicator(
  value: unknown,
): SecurityBlockIndicatorValue | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const address: SecurityBlockValue | null = readSecurityBlockValue(value);

  if (address) {
    return address;
  }

  const hash: SecurityBlockHashReading | null = readSecurityBlockHash(value);

  if (hash) {
    return {
      indicatorType: getSecurityBlockFileType(hash.kind),
      value: hash.hash,
    };
  }

  const url: SecurityBlockUrlReading | null = readSecurityBlockUrl(value);

  if (url) {
    return url.url.length > SECURITY_BLOCK_URL_MAX_LENGTH
      ? null
      : {
          indicatorType: SecurityBlockIndicatorType.Url,
          value: url.url,
          ...(url.isAddressHost ? { address: url.host } : { domain: url.host }),
        };
  }

  const domain: { domain: string } | null = readSecurityBlockDomain(value);

  return domain
    ? {
        indicatorType: SecurityBlockIndicatorType.Domain,
        value: domain.domain,
        domain: domain.domain,
      }
    : null;
}

/*
 * A value as blocks write it, whatever it is - the key the reconciler and
 * every destination compare by - or, for text that is none of them, the
 * text trimmed and lower cased.
 */
export function getSecurityBlockValueKey(value: string): string {
  const read: SecurityBlockIndicatorValue | null =
    readSecurityBlockIndicator(value);

  return read ? read.value : (value || "").trim().toLowerCase();
}

// The largest range of the block's family, as a prefix length.
export function getSecurityBlockLargestPrefix(family: 4 | 6): number {
  return family === 4
    ? SECURITY_BLOCK_LARGEST_IPV4_PREFIX
    : SECURITY_BLOCK_LARGEST_IPV6_PREFIX;
}

// The widest anyone may block in the block's family, as a prefix length.
export function getSecurityBlockWidestPrefix(family: 4 | 6): number {
  return family === 4
    ? SECURITY_BLOCK_WIDEST_IPV4_PREFIX
    : SECURITY_BLOCK_WIDEST_IPV6_PREFIX;
}

// Whether a range is wider than the largest range a block takes from anyone.
export function isWiderThanLargestRange(block: NetworkAddressBlock): boolean {
  return block.prefixLength < getSecurityBlockLargestPrefix(block.family);
}

/*
 * Marks an English sentence as a key of the Dashboard's locales - the same
 * marker as Common/UI/Utils/TranslateTemplate's translationKey, kept here so
 * this file stays free of the UI. It returns the text unchanged.
 *
 * The Dashboard's locale extractor reads this file for what it marks and
 * nothing else (a "keys" root of its SOURCE_ROOTS): the Block Address form
 * says what is wrong with a value in the reader's language, with the very
 * sentences the server answers an API client with in English.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

// A sentence with its values, for whoever writes it: the server in English, the Dashboard in the reader's language.
export interface SecurityBlockSentence {
  template: string;
  values: Record<string, string>;
}

export const SECURITY_BLOCK_SENTENCES: {
  enterAddress: string;
  notAnAddress: string;
  enterValue: string;
  notAValue: string;
  wildcardDomain: string;
  unsupportedHash: string;
  urlTooLong: string;
  urlScheme: string;
  tooWide: string;
  widerThanAnyone: string;
  alreadyBlocked: string;
  alreadyBlockedBy: string;
  checkFailed: string;
  checkFailedValue: string;
} = {
  enterAddress: translationKey("Enter the IP address or range to block."),
  notAnAddress: translationKey(
    "Enter an IPv4 or IPv6 address, such as 203.0.113.7, or a range written as an address and a length, such as 203.0.113.0/24.",
  ),
  enterValue: translationKey(
    "Enter the address, domain, URL or file hash to block.",
  ),
  notAValue: translationKey(
    "Enter an IP address or a range, such as 203.0.113.7 or 203.0.113.0/24, a domain such as evil.example, a URL that starts with http:// or https://, or a file's MD5, SHA-1 or SHA-256 hash.",
  ),
  wildcardDomain: translationKey(
    "Enter the domain without *, such as evil.example. Microsoft Defender blocks the names under a domain along with it.",
  ),
  unsupportedHash: translationKey(
    "OneUptime blocks a file by its MD5, SHA-1 or SHA-256 hash, which Microsoft Defender and CrowdStrike match files by. Enter one of those.",
  ),
  urlTooLong: translationKey(
    "A URL on the blocklist is at most {{max}} characters. Block a shorter URL, or its domain.",
  ),
  urlScheme: translationKey(
    "Enter a URL that starts with http:// or https://, or block its domain.",
  ),
  tooWide: translationKey(
    "{{value}} is wider than a {{largest}}, which would block whole networks. Block single addresses or a narrower range, or ask a Security Admin to block it.",
  ),
  widerThanAnyone: translationKey(
    "{{value}} is wider than a {{widest}}, the widest range OneUptime blocks. Block a narrower range.",
  ),
  alreadyBlocked: translationKey("{{value}} is already blocked."),
  alreadyBlockedBy: translationKey(
    "{{value}} is already blocked: {{by}} covers it.",
  ),
  checkFailed: translationKey(
    "OneUptime could not check whether {{value}} is one of your own addresses, so it did not block it. Try again in a minute.",
  ),
  checkFailedValue: translationKey(
    "OneUptime could not check whether {{value}} is protected, so it did not block it. Try again in a minute.",
  ),
};

/*
 * That OneUptime could not tell whether a value is protected: of an address
 * whether it is the project's own, of a domain or a file whether anything
 * protects it.
 */
export function getSecurityBlockCheckFailedSentence(
  value: string,
): SecurityBlockSentence {
  return {
    template: readSecurityBlockValue(value)
      ? SECURITY_BLOCK_SENTENCES.checkFailed
      : SECURITY_BLOCK_SENTENCES.checkFailedValue,
    values: { value },
  };
}

// A sentence filled in English, as the server answers.
export function fillSecurityBlockSentence(
  sentence: SecurityBlockSentence,
): string {
  let text: string = sentence.template;

  for (const [key, value] of Object.entries(sentence.values)) {
    text = text.split(`{{${key}}}`).join(value);
  }

  return text;
}

/*
 * The server's refusals, as sentences: what happened, why, and what to do
 * next. The Dashboard words the ones a person meets in its form itself, in
 * the reader's language (SECURITY_BLOCK_SENTENCES); these are what an API
 * client, a playbook and OneUptime AI read.
 */
export const SECURITY_BLOCK_MESSAGES: {
  enterAddress: string;
  notAnAddress: string;
  enterValue: string;
  notAValue: string;
  wildcardDomain: string;
  unsupportedHash: string;
  urlTooLong: (data: { max: string }) => string;
  urlScheme: string;
  tooWide: (data: { value: string; largest: string }) => string;
  widerThanAnyone: (data: { value: string; widest: string }) => string;
  untilLiftedTakesAdmin: string;
  expiryInThePast: string;
  expiryTooFar: string;
  reasonTooLong: string;
  notActive: (data: { value: string; state: SecurityBlockState }) => string;
  liftOnly: string;
  valueNeverChanges: string;
  actionNeverChanges: string;
  reachNeverChanges: string;
  chooseAction: string;
  challengeOnlyAddresses: string;
  challengeOnlyAtTheEdge: string;
  quarantineOnlyFiles: string;
  alreadyBlocked: (data: { value: string; by: string }) => string;
  notDeletable: string;
  checkFailed: (data: { value: string }) => string;
  checkFailedValue: (data: { value: string }) => string;
} = {
  enterAddress: SECURITY_BLOCK_SENTENCES.enterAddress,
  notAnAddress: SECURITY_BLOCK_SENTENCES.notAnAddress,
  enterValue: SECURITY_BLOCK_SENTENCES.enterValue,
  notAValue: SECURITY_BLOCK_SENTENCES.notAValue,
  wildcardDomain: SECURITY_BLOCK_SENTENCES.wildcardDomain,
  unsupportedHash: SECURITY_BLOCK_SENTENCES.unsupportedHash,
  urlTooLong: (data: { max: string }): string => {
    return fillSecurityBlockSentence({
      template: SECURITY_BLOCK_SENTENCES.urlTooLong,
      values: data,
    });
  },
  urlScheme: SECURITY_BLOCK_SENTENCES.urlScheme,
  tooWide: (data: { value: string; largest: string }): string => {
    return fillSecurityBlockSentence({
      template: SECURITY_BLOCK_SENTENCES.tooWide,
      values: data,
    });
  },
  widerThanAnyone: (data: { value: string; widest: string }): string => {
    return fillSecurityBlockSentence({
      template: SECURITY_BLOCK_SENTENCES.widerThanAnyone,
      values: data,
    });
  },
  untilLiftedTakesAdmin:
    "Only a Security Admin, a Project Admin or a Project Owner can keep a block until someone lifts it. Choose how long it lasts instead.",
  expiryInThePast:
    "The block would end before it starts. Choose when it ends, from now.",
  expiryTooFar:
    "A block that expires lasts a year at most. Choose an earlier end, or keep it until someone lifts it.",
  reasonTooLong: `A reason is at most ${SECURITY_BLOCK_REASON_MAX_LENGTH} characters.`,
  notActive: (data: { value: string; state: SecurityBlockState }): string => {
    return data.state === SecurityBlockState.Expired
      ? `The block on ${data.value} has expired, so it cannot be changed. Block ${data.value} again to block it once more.`
      : `The block on ${data.value} was lifted, so it cannot be changed. Block ${data.value} again to block it once more.`;
  },
  liftOnly:
    "A block ends when someone lifts it or when it expires. To lift it, set its state to Lifted.",
  valueNeverChanges:
    "What a block blocks never changes. Lift this block and block the other value instead.",
  actionNeverChanges:
    "A block's action never changes. Lift this block and block the value again with the other action.",
  reachNeverChanges:
    "Where a block is enforced never changes. Block the address again everywhere: the block at the edge stays until it ends.",
  chooseAction: "Choose Block, Challenge or Block and Quarantine.",
  challengeOnlyAddresses:
    "Only an address or a range can be challenged: a challenge is a page a person passes in a browser. Block the domain, URL or file instead.",
  challengeOnlyAtTheEdge:
    "A challenge is answered in a browser at the edge, so an address blocked on every machine is blocked, never challenged. Choose Block.",
  quarantineOnlyFiles:
    "Only a file can be quarantined. Block the address, domain or URL instead.",
  alreadyBlocked: (data: { value: string; by: string }): string => {
    return fillSecurityBlockSentence(
      getSecurityBlockAlreadyBlockedSentence(data),
    );
  },
  notDeletable:
    "Blocks are kept, so a case and the next block of the address can say it was blocked before. Lift the block instead.",
  // Of an address whether it is the project's own, of anything else whether it is protected.
  checkFailed: (data: { value: string }): string => {
    return fillSecurityBlockSentence(
      getSecurityBlockCheckFailedSentence(data.value),
    );
  },
  checkFailedValue: (data: { value: string }): string => {
    return fillSecurityBlockSentence({
      template: SECURITY_BLOCK_SENTENCES.checkFailedValue,
      values: data,
    });
  },
};

/*
 * What is wrong with blocking a value of this kind with this action, where
 * it is enforced, or null: a challenge is for an address at the edge, and
 * quarantine for a file.
 */
export function getSecurityBlockActionProblem(data: {
  indicatorType: SecurityBlockIndicatorType;
  action: SecurityBlockAction;
  reach: SecurityBlockReach;
}): string | null {
  if (data.action === SecurityBlockAction.Challenge) {
    if (!isSecurityBlockAddressType(data.indicatorType)) {
      return SECURITY_BLOCK_MESSAGES.challengeOnlyAddresses;
    }

    if (data.reach === SecurityBlockReach.Everywhere) {
      return SECURITY_BLOCK_MESSAGES.challengeOnlyAtTheEdge;
    }
  }

  if (
    data.action === SecurityBlockAction.BlockAndQuarantine &&
    !isSecurityBlockFileType(data.indicatorType)
  ) {
    return SECURITY_BLOCK_MESSAGES.quarantineOnlyFiles;
  }

  return null;
}

// That a value is blocked already, and by what when it is a range that covers it.
export function getSecurityBlockAlreadyBlockedSentence(data: {
  value: string;
  by: string;
}): SecurityBlockSentence {
  return data.by === data.value
    ? {
        template: SECURITY_BLOCK_SENTENCES.alreadyBlocked,
        values: { value: data.value },
      }
    : {
        template: SECURITY_BLOCK_SENTENCES.alreadyBlockedBy,
        values: { value: data.value, by: data.by },
      };
}

/*
 * What is wrong with a value someone wants to block, as a sentence with its
 * values, or null: missing; none of an address, a range, a domain, a URL or
 * a file's hash (and why, when that is worth saying: a wildcard, a SHA-512
 * digest, a URL too long or of another scheme); or a range wider than
 * allowed. `mayBlockWideRanges` says whether the blocker may go past the
 * largest range (a person with Security Admin, or a Project Owner or
 * Admin); nobody goes past the widest.
 */
export function getSecurityBlockValueSentence(data: {
  value: unknown;
  mayBlockWideRanges: boolean;
}): SecurityBlockSentence | null {
  const text: string = typeof data.value === "string" ? data.value.trim() : "";

  if (!text) {
    return { template: SECURITY_BLOCK_SENTENCES.enterValue, values: {} };
  }

  // Twice the longest value: a URL a little long is told so, a page of text is not a value.
  if (text.length > SECURITY_BLOCK_VALUE_MAX_LENGTH * 2) {
    return { template: SECURITY_BLOCK_SENTENCES.notAValue, values: {} };
  }

  switch (getSecurityBlockIndicatorProblem(text)) {
    case SecurityBlockIndicatorProblem.Wildcard:
      return { template: SECURITY_BLOCK_SENTENCES.wildcardDomain, values: {} };
    case SecurityBlockIndicatorProblem.UnsupportedHash:
      return { template: SECURITY_BLOCK_SENTENCES.unsupportedHash, values: {} };
    case SecurityBlockIndicatorProblem.UrlTooLong:
      return {
        template: SECURITY_BLOCK_SENTENCES.urlTooLong,
        values: { max: String(SECURITY_BLOCK_URL_MAX_LENGTH) },
      };
    case SecurityBlockIndicatorProblem.UrlScheme:
      return { template: SECURITY_BLOCK_SENTENCES.urlScheme, values: {} };
    default:
      break;
  }

  const indicator: SecurityBlockIndicatorValue | null =
    readSecurityBlockIndicator(text);

  if (!indicator) {
    return { template: SECURITY_BLOCK_SENTENCES.notAValue, values: {} };
  }

  if (!indicator.block) {
    return null;
  }

  const read: { value: string; block: NetworkAddressBlock } = {
    value: indicator.value,
    block: indicator.block,
  };

  const widest: number = getSecurityBlockWidestPrefix(read.block.family);

  if (read.block.prefixLength < widest) {
    return {
      template: SECURITY_BLOCK_SENTENCES.widerThanAnyone,
      values: { value: read.value, widest: `/${widest}` },
    };
  }

  if (isWiderThanLargestRange(read.block) && !data.mayBlockWideRanges) {
    return {
      template: SECURITY_BLOCK_SENTENCES.tooWide,
      values: {
        value: read.value,
        largest: `/${getSecurityBlockLargestPrefix(read.block.family)}`,
      },
    };
  }

  return null;
}

// As getSecurityBlockValueSentence, filled in English, as the server answers.
export function getSecurityBlockValueProblem(data: {
  value: unknown;
  mayBlockWideRanges: boolean;
}): string | null {
  const sentence: SecurityBlockSentence | null =
    getSecurityBlockValueSentence(data);

  return sentence ? fillSecurityBlockSentence(sentence) : null;
}

/*
 * When an expiry a request sent is wrong, or null: in the past (beyond a
 * browser's clock running behind) or more than a year away. Null - until
 * lifted - is for the caller to allow.
 */
export function getSecurityBlockExpiryProblem(data: {
  expiresAt: Date;
  now: Date;
}): string | null {
  const time: number = data.expiresAt.getTime();

  if (!Number.isFinite(time)) {
    return SECURITY_BLOCK_MESSAGES.expiryInThePast;
  }

  if (time <= data.now.getTime() - SECURITY_BLOCK_EXPIRY_CLOCK_SLACK_IN_MS) {
    return SECURITY_BLOCK_MESSAGES.expiryInThePast;
  }

  if (time > data.now.getTime() + SECURITY_BLOCK_LONGEST_EXPIRY_IN_MS) {
    return SECURITY_BLOCK_MESSAGES.expiryTooFar;
  }

  return null;
}

// ---------- Covering ----------

// A block as the covering rule reads it.
export interface SecurityBlockCandidate {
  value: string;
  // Where it is enforced; a block written before reach was kept is at the edge.
  reach?: SecurityBlockReach | string | undefined | null;
}

/*
 * The active block that already covers a value, if any: one of the same
 * value, else - for an address - a range that holds it, the narrowest such
 * range, so the answer names the block that says the most. A value already
 * covered is already blocked, and the answer names what covers it.
 *
 * A block covers only where it is enforced (`reach`, the edge unless
 * said): a block everywhere covers a block at the edge, and a block at the
 * edge never covers one everywhere. A domain, a URL or a file is covered by
 * a block of the same value alone: whether a block of a domain also blocks
 * the names under it is the provider's to say, so OneUptime never answers
 * "already blocked" for a name it has not blocked itself.
 */
export function findCoveringSecurityBlock<T extends SecurityBlockCandidate>(
  value: SecurityBlockIndicatorValue,
  activeBlocks: ReadonlyArray<T>,
  reach: SecurityBlockReach = SecurityBlockReach.Edge,
): T | null {
  let best: T | null = null;
  let bestPrefix: number = -1;

  for (const candidate of activeBlocks) {
    if (
      !doesSecurityBlockReachCover({ held: candidate.reach, wanted: reach })
    ) {
      continue;
    }

    if (!value.block) {
      if (getSecurityBlockValueKey(candidate.value) === value.value) {
        return candidate;
      }

      continue;
    }

    const read: SecurityBlockValue | null = readSecurityBlockValue(
      candidate.value,
    );

    if (!read) {
      continue;
    }

    if (read.value === value.value) {
      return candidate;
    }

    if (
      read.block.prefixLength > bestPrefix &&
      NetworkAddressBlockUtil.containsBlock(read.block, value.block)
    ) {
      best = candidate;
      bestPrefix = read.block.prefixLength;
    }
  }

  return best;
}

/*
 * Whether a block is still in force at `now`: Active, and not past its
 * expiry. A block past its expiry is ended even before the expiry worker
 * marks it, so nothing enforces it in the minute between.
 */
export function isSecurityBlockInForce(
  block: {
    state?: SecurityBlockState | string | undefined | null;
    expiresAt?: Date | string | undefined | null;
  },
  now: Date,
): boolean {
  if (block.state !== SecurityBlockState.Active) {
    return false;
  }

  if (!block.expiresAt) {
    return true;
  }

  return new Date(block.expiresAt).getTime() > now.getTime();
}
