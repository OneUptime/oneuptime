import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  SecurityBlockAction,
  SecurityBlockValue,
  isSecurityBlockInForce,
  readSecurityBlockValue,
} from "./SecurityBlock";
import { SECURITY_BLOCK_CONFIRMATION_MAX_AGE_IN_MS } from "./SecurityBlockEnforcement";
import { SecurityAddressProtection } from "./SecurityProtectedAddress";

/*
 * A BLOCKLIST FEED (#10345): a secret URL a firewall or a proxy reads the
 * project's blocklist from, on a schedule - Palo Alto's External Dynamic
 * Lists, FortiGate's threat feeds, Check Point's Network Feeds, Cisco's
 * Security Intelligence feeds, OPNsense's and pfSense's URL tables, and a
 * script on a host that loads it into nftables, ipset, nginx, HAProxy or
 * Windows Firewall.
 *
 * Pull, not push: the firewall reaches OneUptime, so OneUptime never needs a
 * route into the customer's network or a firewall admin's credentials. Each
 * feed is a destination of the blocklist of its own kind
 * (Server/Utils/SecurityBlocklist/SecurityBlocklistFeedDestination): what it
 * holds is what the firewall fetched last, so a block counts as enforced at
 * a feed only once the firewall has fetched a list that holds it, and only
 * while it keeps fetching.
 *
 * Here: what a feed serves, from which blocks, to whom, and how a fetch log
 * says whether the firewall still reads it. Pure, so the Dashboard says what
 * the server does by the same rules.
 */

/*
 * What a feed serves: IPv4 and IPv6, or one of them, for a firewall that
 * keeps them apart.
 */
export enum SecurityBlocklistFeedFamily {
  Both = "Both",
  IPv4 = "IPv4",
  IPv6 = "IPv6",
}

export const SECURITY_BLOCKLIST_FEED_FAMILIES: ReadonlyArray<SecurityBlocklistFeedFamily> =
  [
    SecurityBlocklistFeedFamily.Both,
    SecurityBlocklistFeedFamily.IPv4,
    SecurityBlocklistFeedFamily.IPv6,
  ];

/*
 * What reads a feed: the firewall or proxy its setup steps are for, and the
 * format and authentication those steps use. Picked when the feed is made,
 * so its page opens on the right steps; any of them can read any feed.
 */
export enum SecurityBlocklistFeedFirewall {
  PaloAlto = "PaloAlto",
  FortiGate = "FortiGate",
  CheckPoint = "CheckPoint",
  Cisco = "Cisco",
  OPNsense = "OPNsense",
  PfSense = "PfSense",
  Nftables = "Nftables",
  Ipset = "Ipset",
  Nginx = "Nginx",
  HAProxy = "HAProxy",
  WindowsFirewall = "WindowsFirewall",
  Other = "Other",
}

// In the order the feed form and the feed page offer them.
export const SECURITY_BLOCKLIST_FEED_FIREWALLS: ReadonlyArray<SecurityBlocklistFeedFirewall> =
  [
    SecurityBlocklistFeedFirewall.PaloAlto,
    SecurityBlocklistFeedFirewall.FortiGate,
    SecurityBlocklistFeedFirewall.CheckPoint,
    SecurityBlocklistFeedFirewall.Cisco,
    SecurityBlocklistFeedFirewall.OPNsense,
    SecurityBlocklistFeedFirewall.PfSense,
    SecurityBlocklistFeedFirewall.Nftables,
    SecurityBlocklistFeedFirewall.Ipset,
    SecurityBlocklistFeedFirewall.Nginx,
    SecurityBlocklistFeedFirewall.HAProxy,
    SecurityBlocklistFeedFirewall.WindowsFirewall,
    SecurityBlocklistFeedFirewall.Other,
  ];

// Each firewall as its maker names it: what a feed made for it is called by default.
export const SECURITY_BLOCKLIST_FEED_FIREWALL_NAMES: Readonly<
  Record<SecurityBlocklistFeedFirewall, string>
> = {
  [SecurityBlocklistFeedFirewall.PaloAlto]: "Palo Alto Networks",
  [SecurityBlocklistFeedFirewall.FortiGate]: "FortiGate",
  [SecurityBlocklistFeedFirewall.CheckPoint]: "Check Point",
  [SecurityBlocklistFeedFirewall.Cisco]: "Cisco Secure Firewall",
  [SecurityBlocklistFeedFirewall.OPNsense]: "OPNsense",
  [SecurityBlocklistFeedFirewall.PfSense]: "pfSense",
  [SecurityBlocklistFeedFirewall.Nftables]: "nftables",
  [SecurityBlocklistFeedFirewall.Ipset]: "ipset and iptables",
  [SecurityBlocklistFeedFirewall.Nginx]: "nginx",
  [SecurityBlocklistFeedFirewall.HAProxy]: "HAProxy",
  [SecurityBlocklistFeedFirewall.WindowsFirewall]: "Windows Firewall",
  [SecurityBlocklistFeedFirewall.Other]: "Other",
};

export function isSecurityBlocklistFeedFamily(
  value: unknown,
): value is SecurityBlocklistFeedFamily {
  return (
    typeof value === "string" &&
    (SECURITY_BLOCKLIST_FEED_FAMILIES as ReadonlyArray<string>).includes(value)
  );
}

export function isSecurityBlocklistFeedFirewall(
  value: unknown,
): value is SecurityBlocklistFeedFirewall {
  return (
    typeof value === "string" &&
    (SECURITY_BLOCKLIST_FEED_FIREWALLS as ReadonlyArray<string>).includes(value)
  );
}

// ---------- The secret ----------

/*
 * How long the secret a rotation replaced keeps working: a day, so every
 * firewall that reads the feed can be given the new one without a gap.
 * Revoking ends both at once.
 */
export const SECURITY_BLOCKLIST_FEED_SECRET_GRACE_IN_MS: number =
  24 * 60 * 60 * 1000;

/*
 * A feed's secret: 32 random bytes as 64 lower-case hex digits
 * (PresentedKey.generate). Anything else presented is no secret at all, and
 * is refused before it is hashed.
 */
export const SECURITY_BLOCKLIST_FEED_SECRET_PATTERN: RegExp = /^[0-9a-f]{64}$/;

// What a feed's page shows in place of its secret: its last four characters.
export const SECURITY_BLOCKLIST_FEED_SECRET_HINT_LENGTH: number = 4;

export function isSecurityBlocklistFeedSecretShape(value: unknown): boolean {
  return (
    typeof value === "string" &&
    SECURITY_BLOCKLIST_FEED_SECRET_PATTERN.test(value)
  );
}

export function getSecurityBlocklistFeedSecretHint(secret: string): string {
  return secret.slice(-SECURITY_BLOCKLIST_FEED_SECRET_HINT_LENGTH);
}

/*
 * Whether the secret a rotation replaced still works at `now`: until its
 * grace ends. Never once revoked, which clears it.
 */
export function isPreviousSecurityBlocklistFeedSecretInGrace(data: {
  previousSecretExpiresAt: Date | string | null | undefined;
  now: Date;
}): boolean {
  if (!data.previousSecretExpiresAt) {
    return false;
  }

  const time: number = new Date(data.previousSecretExpiresAt).getTime();

  return Number.isFinite(time) && time > data.now.getTime();
}

// ---------- Who may read it ----------

// The most addresses and ranges a feed's source allowlist holds.
export const SECURITY_BLOCKLIST_FEED_MAX_ALLOWED_SOURCES: number = 50;

/*
 * Marks an English sentence as a key of the Dashboard's locales, as
 * SecurityBlock.ts does: the feed's form says what is wrong with an
 * allowlist in the reader's language, with the very sentences the server
 * answers an API client with in English.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

// A sentence with its values: the server fills it in English, the Dashboard in the reader's language.
export interface SecurityBlocklistFeedSentence {
  template: string;
  values: Record<string, string>;
}

export const SECURITY_BLOCKLIST_FEED_SENTENCES: {
  notAnAddress: string;
  tooMany: string;
} = {
  notAnAddress: translationKey(
    "{{value}} is not an IP address or a range. Write each as an address, such as 203.0.113.7, or a range, such as 203.0.113.0/24.",
  ),
  tooMany: translationKey(
    "A feed takes at most {{count}} source addresses and ranges. Use a range that holds several.",
  ),
};

// A sentence filled in English, as the server answers.
export function fillSecurityBlocklistFeedSentence(
  sentence: SecurityBlocklistFeedSentence,
): string {
  let text: string = sentence.template;

  for (const [key, value] of Object.entries(sentence.values)) {
    text = text.split(`{{${key}}}`).join(value);
  }

  return text;
}

// What an allowlist that cannot be read says.
export const SECURITY_BLOCKLIST_FEED_ALLOWLIST_PROBLEMS: {
  notAnAddress: (value: string) => SecurityBlocklistFeedSentence;
  tooMany: SecurityBlocklistFeedSentence;
} = {
  notAnAddress: (value: string): SecurityBlocklistFeedSentence => {
    return {
      template: SECURITY_BLOCKLIST_FEED_SENTENCES.notAnAddress,
      values: { value },
    };
  },
  tooMany: {
    template: SECURITY_BLOCKLIST_FEED_SENTENCES.tooMany,
    values: { count: String(SECURITY_BLOCKLIST_FEED_MAX_ALLOWED_SOURCES) },
  },
};

export interface SecurityBlocklistFeedAllowlist {
  // Each entry as it is kept: "203.0.113.7", "198.51.100.0/24".
  entries: Array<string>;
  blocks: Array<NetworkAddressBlock>;
  // What is wrong with it, or null.
  problem: SecurityBlocklistFeedSentence | null;
}

/*
 * A source allowlist as typed - addresses and ranges, one a line or
 * separated by commas or spaces - read the one way addresses are kept, each
 * once. Empty for no allowlist: then any address may read the feed with its
 * secret.
 */
export function readSecurityBlocklistFeedAllowlist(
  text: string | null | undefined,
): SecurityBlocklistFeedAllowlist {
  const entries: Array<string> = [];
  const blocks: Array<NetworkAddressBlock> = [];

  const parts: Array<string> = (text || "")
    .split(/[\s,;]+/)
    .map((part: string): string => {
      return part.trim();
    })
    .filter(Boolean);

  for (const part of parts) {
    const block: NetworkAddressBlock | null =
      NetworkAddressBlockUtil.parse(part);

    if (!block) {
      return {
        entries: [],
        blocks: [],
        problem: SECURITY_BLOCKLIST_FEED_ALLOWLIST_PROBLEMS.notAnAddress(
          part.slice(0, 60),
        ),
      };
    }

    if (entries.includes(block.text)) {
      continue;
    }

    entries.push(block.text);
    blocks.push(block);
  }

  if (entries.length > SECURITY_BLOCKLIST_FEED_MAX_ALLOWED_SOURCES) {
    return {
      entries: [],
      blocks: [],
      problem: SECURITY_BLOCKLIST_FEED_ALLOWLIST_PROBLEMS.tooMany,
    };
  }

  return { entries, blocks, problem: null };
}

/*
 * Whether a request from `clientIp` may read a feed with this allowlist:
 * always with none, else only from an address one of its entries holds. An
 * address that cannot be read is refused: with an allowlist set, only an
 * address known to be on it gets in.
 */
export function isSecurityBlocklistFeedSourceAllowed(data: {
  allowlist: ReadonlyArray<NetworkAddressBlock>;
  clientIp: string | null | undefined;
}): boolean {
  if (data.allowlist.length === 0) {
    return true;
  }

  const address: string | null = NetworkAddressBlockUtil.canonicalAddress(
    data.clientIp || "",
  );

  if (!address) {
    return false;
  }

  return data.allowlist.some((block: NetworkAddressBlock): boolean => {
    return NetworkAddressBlockUtil.contains(block, address);
  });
}

// ---------- What it serves ----------

// A block as a feed reads it.
export interface SecurityBlocklistFeedBlock {
  value?: string | undefined | null;
  action?: SecurityBlockAction | string | undefined | null;
  state?: string | undefined | null;
  expiresAt?: Date | string | undefined | null;
  // "OneUptime case CASE-123 until 2026-11-21 10:42 UTC", for the formats that keep comments.
  comment?: string | undefined | null;
}

// One line of a feed: an address or a range, as blocks are written.
export interface SecurityBlocklistFeedEntry {
  value: string;
  family: 4 | 6;
  block: NetworkAddressBlock;
  comment: string;
}

// Whether a value of `family` is one this feed serves.
export function isFamilyServedBySecurityBlocklistFeed(
  feedFamily: SecurityBlocklistFeedFamily | string | null | undefined,
  family: 4 | 6,
): boolean {
  if (feedFamily === SecurityBlocklistFeedFamily.IPv4) {
    return family === 4;
  }

  if (feedFamily === SecurityBlocklistFeedFamily.IPv6) {
    return family === 6;
  }

  return true;
}

// Orders two blocks by family, then address, then length: the order a feed lists them in.
export function compareSecurityBlocklistFeedBlocks(
  first: NetworkAddressBlock,
  second: NetworkAddressBlock,
): number {
  if (first.family !== second.family) {
    return first.family - second.family;
  }

  for (let index: number = 0; index < first.groups.length; index++) {
    const difference: number =
      (first.groups[index] || 0) - (second.groups[index] || 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return first.prefixLength - second.prefixLength;
}

/*
 * A comment kept to one line of printable text: a firewall reads a line
 * break in it as a line of its own.
 */
export function toSecurityBlocklistFeedComment(text: string): string {
  let kept: string = "";

  for (const character of text) {
    const code: number = character.codePointAt(0) || 0;

    // Control characters (C0, DEL and C1) and the Unicode line and paragraph separators.
    if (
      code < 32 ||
      (code >= 127 && code < 160) ||
      code === 0x2028 ||
      code === 0x2029
    ) {
      kept += " ";
      continue;
    }

    kept += character;
  }

  return kept.replace(/\s+/g, " ").trim().slice(0, 200);
}

/*
 * The lines a feed serves at `now`, from the project's blocks: every block
 * in force (active, and not past its expiry - an expired or lifted block is
 * gone from the very next fetch), that blocks (a firewall cannot challenge),
 * of a family the feed serves, each value once, in address order so the
 * same blocks always make the same list (and the same ETag). Protected
 * addresses are taken out before (SecurityBlocklistFeedProtection): a block
 * is never of one, but an address can become one after it was blocked.
 */
export function selectSecurityBlocklistFeedEntries(data: {
  blocks: ReadonlyArray<SecurityBlocklistFeedBlock>;
  family: SecurityBlocklistFeedFamily | string | null | undefined;
  now: Date;
}): Array<SecurityBlocklistFeedEntry> {
  const entries: Map<string, SecurityBlocklistFeedEntry> = new Map();

  for (const block of data.blocks) {
    if (
      (block.action || SecurityBlockAction.Block) !== SecurityBlockAction.Block
    ) {
      continue;
    }

    if (!isSecurityBlockInForce(block, data.now)) {
      continue;
    }

    const read: SecurityBlockValue | null = readSecurityBlockValue(block.value);

    if (
      !read ||
      !isFamilyServedBySecurityBlocklistFeed(data.family, read.block.family) ||
      entries.has(read.value)
    ) {
      continue;
    }

    entries.set(read.value, {
      value: read.value,
      family: read.block.family,
      block: read.block,
      comment: toSecurityBlocklistFeedComment(block.comment || ""),
    });
  }

  return Array.from(entries.values()).sort(
    (
      first: SecurityBlocklistFeedEntry,
      second: SecurityBlocklistFeedEntry,
    ): number => {
      return compareSecurityBlocklistFeedBlocks(first.block, second.block);
    },
  );
}

// An entry a feed holds back, and what protects it.
export interface SecurityBlocklistFeedWithheldEntry {
  entry: SecurityBlocklistFeedEntry;
  protection: SecurityAddressProtection;
}

/*
 * The entries a feed may serve, and those it holds back because they touch
 * a protected address or range: an address one protects, a range that holds
 * one, or an address or range inside one. A block is never made of a
 * protected address, but an address can become one after it was blocked -
 * a new host, an entry added to Protected Entities - and a feed never
 * serves it then.
 *
 * Protected addresses are looked up by their text, protected ranges are
 * walked (they are few: the ranges not on the internet, an edge's, the
 * project's own), so a feed of thousands of entries is held to thousands of
 * protected addresses in one pass.
 */
export function filterProtectedSecurityBlocklistFeedEntries(data: {
  entries: ReadonlyArray<SecurityBlocklistFeedEntry>;
  protections: ReadonlyArray<SecurityAddressProtection>;
}): {
  served: Array<SecurityBlocklistFeedEntry>;
  withheld: Array<SecurityBlocklistFeedWithheldEntry>;
} {
  const addresses: Map<
    string,
    { block: NetworkAddressBlock; protection: SecurityAddressProtection }
  > = new Map();
  const ranges: Array<{
    block: NetworkAddressBlock;
    protection: SecurityAddressProtection;
  }> = [];

  for (const protection of data.protections) {
    const block: NetworkAddressBlock | null = NetworkAddressBlockUtil.parse(
      protection.protectedValue,
    );

    if (!block) {
      continue;
    }

    if (NetworkAddressBlockUtil.isSingleAddress(block)) {
      if (!addresses.has(block.text)) {
        addresses.set(block.text, { block, protection });
      }
    } else {
      ranges.push({ block, protection });
    }
  }

  const served: Array<SecurityBlocklistFeedEntry> = [];
  const withheld: Array<SecurityBlocklistFeedWithheldEntry> = [];

  for (const entry of data.entries) {
    let found: SecurityAddressProtection | null = null;

    for (const range of ranges) {
      if (NetworkAddressBlockUtil.overlaps(range.block, entry.block)) {
        found = range.protection;
        break;
      }
    }

    if (!found && NetworkAddressBlockUtil.isSingleAddress(entry.block)) {
      found = addresses.get(entry.block.text)?.protection || null;
    } else if (!found) {
      for (const address of addresses.values()) {
        if (NetworkAddressBlockUtil.containsBlock(entry.block, address.block)) {
          found = address.protection;
          break;
        }
      }
    }

    if (found) {
      withheld.push({
        entry,
        protection: { ...found },
      });
    } else {
      served.push(entry);
    }
  }

  return { served, withheld };
}

/*
 * Whether a destination that serves this feed's family can hold a value,
 * and if not, why - in the words a block's row shows after "Not applied: ".
 */
export function getSecurityBlocklistFeedFamilyRefusal(data: {
  feedName: string;
  family: SecurityBlocklistFeedFamily | string | null | undefined;
  value: string;
}): string | null {
  const read: SecurityBlockValue | null = readSecurityBlockValue(data.value);

  if (!read) {
    return `${data.feedName} serves IP addresses and ranges only`;
  }

  if (isFamilyServedBySecurityBlocklistFeed(data.family, read.block.family)) {
    return null;
  }

  return data.family === SecurityBlocklistFeedFamily.IPv4
    ? `${data.feedName} serves IPv4 only`
    : `${data.feedName} serves IPv6 only`;
}

// ---------- Whether the firewall still reads it ----------

/*
 * How long the fetch log keeps a fetch: 30 days, enough to see how often a
 * firewall reads the feed and when it stopped.
 */
export const SECURITY_BLOCKLIST_FEED_FETCH_RETENTION_IN_DAYS: number = 30;

/*
 * How often a firewall should fetch the feed: every five minutes or more
 * often. A block counts as enforced at a feed for ten minutes after the
 * firewall last fetched a list that holds it
 * (SECURITY_BLOCK_CONFIRMATION_MAX_AGE_IN_MS), so a firewall that fetches
 * less often still blocks between fetches, but OneUptime cannot say so.
 */
export const SECURITY_BLOCKLIST_FEED_RECOMMENDED_REFRESH_IN_MINUTES: number = 5;

/*
 * A firewall has stopped reading a feed when it has not fetched it for
 * three times its usual interval - and never sooner than a block's
 * confirmation lasts (ten minutes): until then its blocks still count as
 * enforced, and saying it stopped would contradict them.
 */
export const SECURITY_BLOCKLIST_FEED_STOPPED_READING_INTERVALS: number = 3;
export const SECURITY_BLOCKLIST_FEED_STOPPED_READING_FLOOR_IN_MS: number =
  SECURITY_BLOCK_CONFIRMATION_MAX_AGE_IN_MS;

// The fetches the usual interval is worked out from: the latest ones.
export const SECURITY_BLOCKLIST_FEED_INTERVAL_SAMPLE_SIZE: number = 20;

/*
 * Fetches closer together than this are one poll - a firewall that fetches
 * the list and its MD5, or a retry - and say nothing of the interval.
 */
export const SECURITY_BLOCKLIST_FEED_SAME_POLL_IN_MS: number = 15 * 1000;

/*
 * How often the firewall fetches the feed, from when it fetched it: the
 * median gap between its latest fetches, so one slow or extra fetch does
 * not move it. Null with fewer than two polls to measure.
 */
export function getSecurityBlocklistFeedUsualIntervalInMs(
  fetchedAt: ReadonlyArray<Date | string>,
): number | null {
  const times: Array<number> = fetchedAt
    .map((value: Date | string): number => {
      return new Date(value).getTime();
    })
    .filter((time: number): boolean => {
      return Number.isFinite(time);
    })
    .sort((first: number, second: number): number => {
      return second - first;
    });

  // One time per poll: a fetch within moments of the poll before it is part of that poll.
  const polls: Array<number> = [];

  for (const time of times) {
    const last: number | undefined = polls[polls.length - 1];

    if (
      last === undefined ||
      last - time >= SECURITY_BLOCKLIST_FEED_SAME_POLL_IN_MS
    ) {
      polls.push(time);
    }

    if (polls.length > SECURITY_BLOCKLIST_FEED_INTERVAL_SAMPLE_SIZE) {
      break;
    }
  }

  const gaps: Array<number> = [];

  for (let index: number = 1; index < polls.length; index++) {
    gaps.push(polls[index - 1]! - polls[index]!);
  }

  if (gaps.length === 0) {
    return null;
  }

  gaps.sort((first: number, second: number): number => {
    return first - second;
  });

  const middle: number = Math.floor(gaps.length / 2);

  return gaps.length % 2 === 1
    ? gaps[middle]!
    : Math.round((gaps[middle - 1]! + gaps[middle]!) / 2);
}

/*
 * The shortest interval a firewall's maker lets it fetch a URL list at, for
 * the firewalls that cannot fetch every few minutes: OPNsense every hour,
 * pfSense every day.
 */
export const SECURITY_BLOCKLIST_FEED_SHORTEST_REFRESH_IN_MINUTES: Readonly<
  Partial<Record<SecurityBlocklistFeedFirewall, number>>
> = {
  [SecurityBlocklistFeedFirewall.OPNsense]: 60,
  [SecurityBlocklistFeedFirewall.PfSense]: 24 * 60,
};

/*
 * The interval a feed's fetches are held to: its usual one, once OneUptime
 * has seen two polls to measure it, and until then as often as its
 * firewall can fetch - every five minutes, as its steps say, every hour for
 * OPNsense and every day for pfSense. Without it, a firewall that fetches
 * every hour would be told stopped ten minutes after its first fetch.
 */
export function getSecurityBlocklistFeedExpectedIntervalInMs(data: {
  usualIntervalInMs: number | null;
  firewall?: SecurityBlocklistFeedFirewall | string | null | undefined;
}): number {
  if (data.usualIntervalInMs !== null && data.usualIntervalInMs > 0) {
    return data.usualIntervalInMs;
  }

  const minutes: number =
    SECURITY_BLOCKLIST_FEED_SHORTEST_REFRESH_IN_MINUTES[
      data.firewall as SecurityBlocklistFeedFirewall
    ] ?? SECURITY_BLOCKLIST_FEED_RECOMMENDED_REFRESH_IN_MINUTES;

  return minutes * 60 * 1000;
}

// How long without a fetch means the firewall stopped reading the feed.
export function getSecurityBlocklistFeedStoppedReadingAfterInMs(
  usualIntervalInMs: number | null,
): number {
  return Math.max(
    SECURITY_BLOCKLIST_FEED_STOPPED_READING_FLOOR_IN_MS,
    (usualIntervalInMs || 0) *
      SECURITY_BLOCKLIST_FEED_STOPPED_READING_INTERVALS,
  );
}

/*
 * Whether the firewall has stopped reading the feed at `now`: it fetched
 * it before, and not for three times its usual interval - or, before that
 * is known, three times the interval its firewall can fetch at. A feed
 * never fetched has not been set up yet, which its page says instead.
 */
export function hasSecurityBlocklistFeedStoppedReading(data: {
  lastFetchedAt: Date | string | null | undefined;
  usualIntervalInMs: number | null;
  firewall?: SecurityBlocklistFeedFirewall | string | null | undefined;
  now: Date;
}): boolean {
  if (!data.lastFetchedAt) {
    return false;
  }

  const last: number = new Date(data.lastFetchedAt).getTime();

  if (!Number.isFinite(last)) {
    return false;
  }

  return (
    data.now.getTime() - last >
    getSecurityBlocklistFeedStoppedReadingAfterInMs(
      getSecurityBlocklistFeedExpectedIntervalInMs({
        usualIntervalInMs: data.usualIntervalInMs,
        firewall: data.firewall,
      }),
    )
  );
}

/*
 * Where a feed stands, as its page and the Blocklist say it:
 *
 *   NotSetUp        no firewall has fetched it yet;
 *   Reading         a firewall fetches it;
 *   StoppedReading  a firewall fetched it, and stopped;
 *   Revoked         its secret was revoked: nothing can read it until a new one is made.
 */
export enum SecurityBlocklistFeedStatus {
  NotSetUp = "NotSetUp",
  Reading = "Reading",
  StoppedReading = "StoppedReading",
  Revoked = "Revoked",
}

export function getSecurityBlocklistFeedStatus(data: {
  hasSecret: boolean;
  lastFetchedAt: Date | string | null | undefined;
  usualIntervalInMs: number | null;
  firewall?: SecurityBlocklistFeedFirewall | string | null | undefined;
  now: Date;
}): SecurityBlocklistFeedStatus {
  if (!data.hasSecret) {
    return SecurityBlocklistFeedStatus.Revoked;
  }

  if (!data.lastFetchedAt) {
    return SecurityBlocklistFeedStatus.NotSetUp;
  }

  return hasSecurityBlocklistFeedStoppedReading(data)
    ? SecurityBlocklistFeedStatus.StoppedReading
    : SecurityBlocklistFeedStatus.Reading;
}
