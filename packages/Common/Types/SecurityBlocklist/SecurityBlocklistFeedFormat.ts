import NetworkAddressBlockUtil from "../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  SecurityBlocklistFeedEntry,
  SecurityBlocklistFeedFamily,
} from "./SecurityBlocklistFeed";

/*
 * WHAT A BLOCKLIST FEED SERVES, IN THE FORMAT EACH READER TAKES (#10345).
 *
 * One list of entries (selectSecurityBlocklistFeedEntries), written three
 * ways, each checked against the reader's own documentation:
 *
 *   blocklist.txt   one address or CIDR range a line, IPv4 and IPv6, and
 *                   nothing else: what every firewall reads.
 *                   - Palo Alto External Dynamic List, IP List: "Enter each
 *                     IP address/range/subnet in a new line" (PAN-OS 11.1,
 *                     Formatting Guidelines, IP Address List). It documents
 *                     a comment only after the address and a space, never a
 *                     line of its own, so Palo Alto gets the list alone.
 *                   - FortiGate IP address threat feed: "one IPv4 or IPv6
 *                     address, address range, or subnet per line", and
 *                     "Comments can be added by using the number sign"
 *                     (FortiOS 7.6, Threat feeds).
 *                   - Check Point Network Feed, Flat list, which ignores
 *                     lines that start with "#" by default (R82, External
 *                     Network Feeds; add-network-feed).
 *                   - Cisco Security Intelligence custom feed: a .txt file
 *                     with "one entry or comment per line", comment lines
 *                     starting with "#" (cdFMC, List custom lists and feeds
 *                     requirements).
 *                   - OPNsense URL Table (IPs): "one IPv[4|6] address per
 *                     line", lines starting with "#" ignored (Aliases).
 *                   - pfSense URL Table (IPs): "IP addresses, CIDR masked
 *                     network entries" (Alias Types).
 *                   - An HAProxy ACL file, and a Windows Firewall rule's
 *                     remote addresses, read by a script.
 *                   No vendor documents a range written as two addresses
 *                   the same way, so ranges are always CIDR, which every
 *                   blocklist range is. With ?comments=1, each entry
 *                   follows a "# " line saying why it is there, for the
 *                   readers above that skip those lines.
 *   nftables.nft    an nft script that fills two sets - one of IPv4, one of
 *                   IPv6 - in one transaction: `nft -f` it every minute,
 *                   and the one rule that drops what they hold never
 *                   changes.
 *   nginx.conf      a `deny` a line, to include in nginx's http, server or
 *                   location block and reload.
 *
 * And the MD5 of each (blocklist.txt.md5), which Cisco asks for before the
 * list when it fetches it every 30 minutes or more often: "For feed update
 * intervals of 30 minutes or less, you must provide an MD5 URL".
 *
 * A list says nothing of when it was made - no date, no count of seconds -
 * so the same blocks always make the same bytes: a firewall that asks
 * whether anything changed (If-None-Match) is told no, and Cisco's MD5
 * stays the same.
 *
 * Pure: the server serves these, and the Dashboard shows what a feed would
 * serve with the very same functions.
 */

export enum SecurityBlocklistFeedFormat {
  Plain = "Plain",
  Nftables = "Nftables",
  Nginx = "Nginx",
}

export const SECURITY_BLOCKLIST_FEED_FORMATS: ReadonlyArray<SecurityBlocklistFeedFormat> =
  [
    SecurityBlocklistFeedFormat.Plain,
    SecurityBlocklistFeedFormat.Nftables,
    SecurityBlocklistFeedFormat.Nginx,
  ];

// The file each format is served as: the last segment of the feed's URL.
export const SECURITY_BLOCKLIST_FEED_FILE_NAMES: Readonly<
  Record<SecurityBlocklistFeedFormat, string>
> = {
  [SecurityBlocklistFeedFormat.Plain]: "blocklist.txt",
  [SecurityBlocklistFeedFormat.Nftables]: "nftables.nft",
  [SecurityBlocklistFeedFormat.Nginx]: "nginx.conf",
};

// What follows a file's name to ask for its MD5 instead: blocklist.txt.md5.
export const SECURITY_BLOCKLIST_FEED_MD5_SUFFIX: string = ".md5";

// The query that adds a "# " line of why before each entry of the plain list.
export const SECURITY_BLOCKLIST_FEED_COMMENTS_QUERY: string = "comments=1";

// Every format is text, served as UTF-8 (it is ASCII: addresses, and comments kept to one line).
export const SECURITY_BLOCKLIST_FEED_CONTENT_TYPE: string =
  "text/plain; charset=utf-8";

/*
 * The nftables table and sets the script fills. An inet table, so one rule
 * pair sees IPv4 and IPv6; sets with `flags interval`, so they hold ranges
 * as well as single addresses.
 */
export const SECURITY_BLOCKLIST_NFTABLES_TABLE: string = "oneuptime";
export const SECURITY_BLOCKLIST_NFTABLES_IPV4_SET: string = "blocklist_v4";
export const SECURITY_BLOCKLIST_NFTABLES_IPV6_SET: string = "blocklist_v6";

export interface SecurityBlocklistFeedFile {
  format: SecurityBlocklistFeedFormat;
  // The MD5 of the file, not the file.
  isMd5: boolean;
}

// The file a URL's last segment asks for, or null for none a feed serves.
export function readSecurityBlocklistFeedFile(
  fileName: string | null | undefined,
): SecurityBlocklistFeedFile | null {
  const name: string = (fileName || "").trim();
  const isMd5: boolean = name.endsWith(SECURITY_BLOCKLIST_FEED_MD5_SUFFIX);
  const base: string = isMd5
    ? name.slice(0, -SECURITY_BLOCKLIST_FEED_MD5_SUFFIX.length)
    : name;

  for (const format of SECURITY_BLOCKLIST_FEED_FORMATS) {
    if (SECURITY_BLOCKLIST_FEED_FILE_NAMES[format] === base) {
      return { format, isMd5 };
    }
  }

  return null;
}

/*
 * Whether the request asked for the plain list's comments: ?comments=1 (or
 * true, or yes). Any other value, or none, is the list alone.
 */
export function readSecurityBlocklistFeedComments(value: unknown): boolean {
  const first: unknown = Array.isArray(value) ? value[0] : value;

  if (typeof first !== "string") {
    return false;
  }

  return ["1", "true", "yes"].includes(first.trim().toLowerCase());
}

/*
 * The entries with every one a range of the same family already holds left
 * out: 10.0.0.5 goes when 10.0.0.0/24 is listed. The firewall blocks it all
 * the same, and an nftables interval set refuses two elements that overlap.
 * Entries come in feed order, in which a range always comes before what it
 * holds, so the last range kept is the only one to check.
 */
export function withoutCoveredSecurityBlocklistFeedEntries(
  entries: ReadonlyArray<SecurityBlocklistFeedEntry>,
): Array<SecurityBlocklistFeedEntry> {
  const kept: Array<SecurityBlocklistFeedEntry> = [];
  let last: SecurityBlocklistFeedEntry | null = null;

  for (const entry of entries) {
    if (
      last &&
      last.family === entry.family &&
      NetworkAddressBlockUtil.containsBlock(last.block, entry.block)
    ) {
      continue;
    }

    kept.push(entry);
    last = entry;
  }

  return kept;
}

// One line of text a firewall reads, ended the way every reader takes: "\n".
function linesToText(lines: ReadonlyArray<string>): string {
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/*
 * WHAT THE PLAIN LIST HOLDS WHEN NOTHING IS BLOCKED: one documentation
 * address, never an empty list. Palo Alto keeps the last list it fetched
 * when a list is empty - "If the list does not contain any entries, the
 * firewall fails to refresh the list and continues to use the last
 * information it retrieved" (PAN-OS 11.1, External Dynamic List) - and
 * Cisco keeps its previous feed data when a feed holds nothing it
 * recognizes (cdFMC, List and Feed Updates for Security Intelligence). So
 * lifting the last block would leave those firewalls blocking it. The
 * address is one of those set aside for documentation, which no internet
 * traffic comes from: 192.0.2.1 (RFC 5737), or 2001:db8::1 (RFC 3849) for a
 * feed that serves IPv6 only. It is no block: a feed's destination never
 * reads it back as one.
 */
export const SECURITY_BLOCKLIST_FEED_EMPTY_IPV4_PLACEHOLDER: string =
  "192.0.2.1";
export const SECURITY_BLOCKLIST_FEED_EMPTY_IPV6_PLACEHOLDER: string =
  "2001:db8::1";

// The documentation address an empty plain list holds, for what the feed serves.
export function getSecurityBlocklistFeedEmptyPlaceholder(
  family: SecurityBlocklistFeedFamily | string | null | undefined,
): string {
  return family === SecurityBlocklistFeedFamily.IPv6
    ? SECURITY_BLOCKLIST_FEED_EMPTY_IPV6_PLACEHOLDER
    : SECURITY_BLOCKLIST_FEED_EMPTY_IPV4_PLACEHOLDER;
}

/*
 * The plain list: one address or range a line, and nothing else. With
 * comments, each entry follows a "# " line saying why it is blocked. With
 * nothing blocked, the one documentation address above.
 */
export function renderSecurityBlocklistPlainList(data: {
  entries: ReadonlyArray<SecurityBlocklistFeedEntry>;
  withComments: boolean;
  family: SecurityBlocklistFeedFamily | string | null | undefined;
}): string {
  const lines: Array<string> = [];

  if (data.entries.length === 0) {
    const placeholder: string = getSecurityBlocklistFeedEmptyPlaceholder(
      data.family,
    );

    if (data.withComments) {
      lines.push(
        `# Nothing is blocked. ${placeholder} is a documentation address that no internet traffic comes from, listed because some firewalls keep their last list when a list is empty.`,
      );
    }

    lines.push(placeholder);

    return linesToText(lines);
  }

  for (const entry of data.entries) {
    if (data.withComments && entry.comment) {
      lines.push(`# ${entry.comment}`);
    }

    lines.push(entry.value);
  }

  return linesToText(lines);
}

/*
 * What a feed's MD5 file holds: the MD5 of the list, as 32 lower-case hex
 * digits and nothing else - "The file should contain only the checksum. Do
 * not add comments to the file." (cdFMC, List custom lists and feeds
 * requirements).
 */
export function renderSecurityBlocklistFeedMd5(md5Hex: string): string {
  return md5Hex.trim().toLowerCase();
}

/*
 * An nft script (nft -f) that keeps the two sets holding exactly the feed's
 * entries. Its table and sets are declared first, which does nothing when
 * they exist, then each set is flushed and filled: nft applies a file as one
 * transaction, so a set is never seen half full, and a file nft refuses
 * changes nothing. It declares no chain and no rule: those are made once
 * (the setup's), as a rule loaded again would be added again.
 */
export function renderSecurityBlocklistNftables(data: {
  entries: ReadonlyArray<SecurityBlocklistFeedEntry>;
}): string {
  const entries: Array<SecurityBlocklistFeedEntry> =
    withoutCoveredSecurityBlocklistFeedEntries(data.entries);

  const ipv4: Array<string> = entries
    .filter((entry: SecurityBlocklistFeedEntry): boolean => {
      return entry.family === 4;
    })
    .map((entry: SecurityBlocklistFeedEntry): string => {
      return entry.value;
    });

  const ipv6: Array<string> = entries
    .filter((entry: SecurityBlocklistFeedEntry): boolean => {
      return entry.family === 6;
    })
    .map((entry: SecurityBlocklistFeedEntry): string => {
      return entry.value;
    });

  const table: string = `inet ${SECURITY_BLOCKLIST_NFTABLES_TABLE}`;

  const lines: Array<string> = [
    "#!/usr/sbin/nft -f",
    `# OneUptime blocklist: ${ipv4.length} IPv4 and ${ipv6.length} IPv6 entries.`,
    `table ${table} {`,
    `  set ${SECURITY_BLOCKLIST_NFTABLES_IPV4_SET} {`,
    "    type ipv4_addr",
    "    flags interval",
    "  }",
    `  set ${SECURITY_BLOCKLIST_NFTABLES_IPV6_SET} {`,
    "    type ipv6_addr",
    "    flags interval",
    "  }",
    "}",
    `flush set ${table} ${SECURITY_BLOCKLIST_NFTABLES_IPV4_SET}`,
    `flush set ${table} ${SECURITY_BLOCKLIST_NFTABLES_IPV6_SET}`,
  ];

  // An empty element list is not nft syntax: a set with nothing to hold is only flushed.
  if (ipv4.length > 0) {
    lines.push(
      `add element ${table} ${SECURITY_BLOCKLIST_NFTABLES_IPV4_SET} { ${ipv4.join(", ")} }`,
    );
  }

  if (ipv6.length > 0) {
    lines.push(
      `add element ${table} ${SECURITY_BLOCKLIST_NFTABLES_IPV6_SET} { ${ipv6.join(", ")} }`,
    );
  }

  return linesToText(lines);
}

/*
 * An nginx include: `deny` a line (ngx_http_access_module), each followed
 * by its address or range. nginx reads the rules in order and stops at the
 * first that matches, so the include goes before any `allow all`.
 */
export function renderSecurityBlocklistNginx(data: {
  entries: ReadonlyArray<SecurityBlocklistFeedEntry>;
}): string {
  const lines: Array<string> = [
    `# OneUptime blocklist: ${data.entries.length} entries. Include it in an http, server or location block.`,
  ];

  for (const entry of data.entries) {
    lines.push(`deny ${entry.value};`);
  }

  return linesToText(lines);
}

// A feed's file, as served.
export function renderSecurityBlocklistFeed(data: {
  format: SecurityBlocklistFeedFormat;
  entries: ReadonlyArray<SecurityBlocklistFeedEntry>;
  withComments: boolean;
  family: SecurityBlocklistFeedFamily | string | null | undefined;
}): string {
  switch (data.format) {
    case SecurityBlocklistFeedFormat.Nftables:
      return renderSecurityBlocklistNftables({ entries: data.entries });
    case SecurityBlocklistFeedFormat.Nginx:
      return renderSecurityBlocklistNginx({ entries: data.entries });
    default:
      return renderSecurityBlocklistPlainList({
        entries: data.entries,
        withComments: data.withComments,
        family: data.family,
      });
  }
}
