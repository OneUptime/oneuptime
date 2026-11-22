import {
  SecurityBlocklistFeedBlock,
  SecurityBlocklistFeedEntry,
  SecurityBlocklistFeedFamily,
  selectSecurityBlocklistFeedEntries,
} from "../../../Types/SecurityBlocklist/SecurityBlocklistFeed";
import {
  SECURITY_BLOCKLIST_FEED_EMPTY_IPV4_PLACEHOLDER,
  SECURITY_BLOCKLIST_FEED_EMPTY_IPV6_PLACEHOLDER,
  SECURITY_BLOCKLIST_FEED_FILE_NAMES,
  SecurityBlocklistFeedFormat,
  getSecurityBlocklistFeedEmptyPlaceholder,
  readSecurityBlocklistFeedComments,
  readSecurityBlocklistFeedFile,
  renderSecurityBlocklistFeed,
  renderSecurityBlocklistFeedMd5,
  renderSecurityBlocklistNftables,
  renderSecurityBlocklistNginx,
  renderSecurityBlocklistPlainList,
  withoutCoveredSecurityBlocklistFeedEntries,
} from "../../../Types/SecurityBlocklist/SecurityBlocklistFeedFormat";
import {
  SecurityBlockAction,
  SecurityBlockState,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import NetworkAddressBlockUtil from "../../../Utils/NetworkTraffic/NetworkAddressBlock";
import { describe, expect, test } from "@jest/globals";

/*
 * Each format a blocklist feed serves, read the way each reader's own
 * documentation says it reads a list (#10345). The readers below are
 * written from those pages, each cited, and every list the feed serves
 * must come out of the reader it is meant for as exactly the entries -
 * nothing dropped, nothing extra, no line it would refuse.
 */

const NOW: Date = new Date("2026-11-21T10:00:00.000Z");

// A line OPNsense skips: one that starts with a space, a comma, a semicolon, a pipe or a #.
const OPNSENSE_SKIPPED: RegExp = /^[\s,;|#]/;

// nginx's access module: deny address | CIDR;
const NGINX_DENY: RegExp = /^deny (\S+);$/;

function block(
  value: string,
  comment: string = "OneUptime case CASE-42 until 2026-11-22 10:00 UTC",
): SecurityBlocklistFeedBlock {
  return {
    value,
    action: SecurityBlockAction.Block,
    state: SecurityBlockState.Active,
    expiresAt: null,
    comment,
  };
}

const ENTRIES: Array<SecurityBlocklistFeedEntry> =
  selectSecurityBlocklistFeedEntries({
    blocks: [
      block("35.205.11.131"),
      block("198.51.100.0/24", "OneUptime blocklist until lifted"),
      block("2001:db8:7::/48"),
      block("2001:db8::9"),
    ],
    family: SecurityBlocklistFeedFamily.Both,
    now: NOW,
  });

const VALUES: Array<string> = [
  "35.205.11.131",
  "198.51.100.0/24",
  "2001:db8::9",
  "2001:db8:7::/48",
];

function linesOf(text: string): Array<string> {
  expect(text.endsWith("\n")).toBe(true);
  return text.slice(0, -1).split("\n");
}

// An address, a CIDR range, or a range of two addresses: what an entry may be.
function isAddressEntry(entry: string): boolean {
  if (NetworkAddressBlockUtil.parse(entry)) {
    return true;
  }

  const [start, end] = entry.split("-");

  return Boolean(
    start &&
      end &&
      NetworkAddressBlockUtil.canonicalAddress(start) &&
      NetworkAddressBlockUtil.canonicalAddress(end),
  );
}

/*
 * PAN-OS 11.1, Formatting Guidelines for an External Dynamic List, IP
 * Address List: "The syntax for each line in the list is [IP address,
 * IP/Mask, or IP start range-IP end range] [space] [comment]" - one entry a
 * line, a comment only after it. No line of its own is a comment.
 * https://docs.paloaltonetworks.com/pan-os/11-1/pan-os-admin/policy/use-an-external-dynamic-list-in-policy/formatting-guidelines-for-an-external-dynamic-list/ip-address-list
 */
function readAsPaloAlto(text: string): Array<string> {
  return linesOf(text).map((line: string): string => {
    const entry: string = line.split(" ")[0] || "";
    expect(isAddressEntry(entry)).toBe(true);
    return entry;
  });
}

/*
 * FortiOS 7.6, Threat feeds: "each URL list, IP address, domain name, or
 * malware hash occupying one line. Comments can be added by using the
 * number sign", the IP address "a single IP address, subnet address, or
 * address range", IPv4 or IPv6.
 * https://docs.fortinet.com/document/fortigate/7.6.0/administration-guide/9463/threat-feeds
 */
function readAsFortiGate(text: string): Array<string> {
  return linesOf(text)
    .filter((line: string): boolean => {
      return !line.startsWith("#");
    })
    .map((line: string): string => {
      expect(isAddressEntry(line)).toBe(true);
      return line;
    });
}

/*
 * Check Point R82, External Network Feeds, Flat list: one entry a line
 * (the delimiter's default is a new line), "Ignore lines with prefix",
 * "#" by default (add-network-feed: ignore-lines-that-start-with).
 * https://sc1.checkpoint.com/documents/R82/WebAdminGuides/EN/CP_R82_SecurityManagement_AdminGuide/Content/Topics-SECMG/Network_Feed.htm
 */
function readAsCheckPoint(text: string): Array<string> {
  return readAsFortiGate(text);
}

/*
 * Cisco cdFMC, List custom lists and feeds requirements: "Include one
 * entry or comment per line", "Comment lines must start with the pound (#)
 * character", netmasks 0 to 32 or 0 to 128, and never /0 in a feed.
 * https://docs.manage.security.cisco.com/cdfmc/r_custom-list-and-feed-requirements.html
 */
function readAsCisco(text: string): Array<string> {
  return linesOf(text)
    .filter((line: string): boolean => {
      return !line.startsWith("#");
    })
    .map((line: string): string => {
      expect(NetworkAddressBlockUtil.parse(line)).not.toBeNull();
      expect(line.endsWith("/0")).toBe(false);
      return line;
    });
}

/*
 * OPNsense, Aliases: "one IPv[4|6] address per line", and "lines that start
 * with a whitespace, colon (,), semicolon (;), pipe (|) or hash (#) will be
 * ignored"; its source keeps a line's first token.
 * https://docs.opnsense.org/manual/aliases.html
 */
function readAsOpnsense(text: string): Array<string> {
  return linesOf(text)
    .filter((line: string): boolean => {
      return (
        Boolean(line) && !OPNSENSE_SKIPPED.test(line) && !line.startsWith("//")
      );
    })
    .map((line: string): string => {
      const entry: string = line.split(/[\s,;|#]+/)[0] || "";
      expect(NetworkAddressBlockUtil.parse(entry)).not.toBeNull();
      return entry;
    });
}

/*
 * pfSense, Alias Types, URL Table (IPs): "IP addresses, CIDR masked network
 * entries, or FQDNs"; its source skips blank lines, drops what follows a
 * "#" and what follows the first space.
 * https://docs.netgate.com/pfsense/en/latest/firewall/aliases-types.html
 */
function readAsPfsense(text: string): Array<string> {
  return linesOf(text)
    .map((line: string): string => {
      return (line.split("#")[0] || "").split(" ")[0] || "";
    })
    .filter(Boolean)
    .map((entry: string): string => {
      expect(NetworkAddressBlockUtil.parse(entry)).not.toBeNull();
      return entry;
    });
}

describe("the plain list", () => {
  const plain: string = renderSecurityBlocklistPlainList({
    entries: ENTRIES,
    withComments: false,
    family: SecurityBlocklistFeedFamily.Both,
  });

  const commented: string = renderSecurityBlocklistPlainList({
    entries: ENTRIES,
    withComments: true,
    family: SecurityBlocklistFeedFamily.Both,
  });

  test("is one address or range a line, and nothing else", () => {
    expect(plain).toBe(
      "35.205.11.131\n198.51.100.0/24\n2001:db8::9\n2001:db8:7::/48\n",
    );
  });

  test("with comments, puts a '# ' line of why before each entry", () => {
    expect(commented).toBe(
      [
        "# OneUptime case CASE-42 until 2026-11-22 10:00 UTC",
        "35.205.11.131",
        "# OneUptime blocklist until lifted",
        "198.51.100.0/24",
        "# OneUptime case CASE-42 until 2026-11-22 10:00 UTC",
        "2001:db8::9",
        "# OneUptime case CASE-42 until 2026-11-22 10:00 UTC",
        "2001:db8:7::/48",
        "",
      ].join("\n"),
    );
  });

  test("Palo Alto reads the plain list as exactly the entries, and it holds no comment line", () => {
    expect(readAsPaloAlto(plain)).toEqual(VALUES);
    expect(
      linesOf(plain).some((line: string): boolean => {
        return line.startsWith("#");
      }),
    ).toBe(false);
  });

  test("pfSense reads the plain list, and the commented one, as exactly the entries", () => {
    expect(readAsPfsense(plain)).toEqual(VALUES);
    expect(readAsPfsense(commented)).toEqual(VALUES);
  });

  test("FortiGate, Check Point, Cisco and OPNsense read the commented list as exactly the entries", () => {
    expect(readAsFortiGate(commented)).toEqual(VALUES);
    expect(readAsCheckPoint(commented)).toEqual(VALUES);
    expect(readAsCisco(commented)).toEqual(VALUES);
    expect(readAsOpnsense(commented)).toEqual(VALUES);
  });

  test("every reader reads the plain list too", () => {
    for (const read of [
      readAsFortiGate,
      readAsCheckPoint,
      readAsCisco,
      readAsOpnsense,
    ]) {
      expect(read(plain)).toEqual(VALUES);
    }
  });

  test("a range is always CIDR, never two addresses: not every reader takes those", () => {
    for (const line of linesOf(plain)) {
      expect(line).not.toContain("-");
      expect(line).not.toContain(" ");
    }
  });

  test("with nothing blocked, holds one documentation address, never nothing: Palo Alto and Cisco keep their last list when a list is empty", () => {
    expect(
      renderSecurityBlocklistPlainList({
        entries: [],
        withComments: false,
        family: SecurityBlocklistFeedFamily.Both,
      }),
    ).toBe("192.0.2.1\n");
    expect(
      renderSecurityBlocklistPlainList({
        entries: [],
        withComments: false,
        family: SecurityBlocklistFeedFamily.IPv4,
      }),
    ).toBe("192.0.2.1\n");
    expect(
      renderSecurityBlocklistPlainList({
        entries: [],
        withComments: false,
        family: SecurityBlocklistFeedFamily.IPv6,
      }),
    ).toBe("2001:db8::1\n");

    const commentedEmpty: string = renderSecurityBlocklistPlainList({
      entries: [],
      withComments: true,
      family: SecurityBlocklistFeedFamily.Both,
    });

    expect(commentedEmpty).toBe(
      "# Nothing is blocked. 192.0.2.1 is a documentation address that no internet traffic comes from, listed because some firewalls keep their last list when a list is empty.\n192.0.2.1\n",
    );
    expect(readAsFortiGate(commentedEmpty)).toEqual(["192.0.2.1"]);
    expect(readAsPaloAlto("192.0.2.1\n")).toEqual(["192.0.2.1"]);
  });

  test("the documentation addresses are the ones RFC 5737 and RFC 3849 set aside", () => {
    expect(SECURITY_BLOCKLIST_FEED_EMPTY_IPV4_PLACEHOLDER).toBe("192.0.2.1");
    expect(SECURITY_BLOCKLIST_FEED_EMPTY_IPV6_PLACEHOLDER).toBe("2001:db8::1");
    expect(
      NetworkAddressBlockUtil.contains(
        NetworkAddressBlockUtil.parse("192.0.2.0/24")!,
        getSecurityBlocklistFeedEmptyPlaceholder(
          SecurityBlocklistFeedFamily.Both,
        ),
      ),
    ).toBe(true);
    expect(
      NetworkAddressBlockUtil.contains(
        NetworkAddressBlockUtil.parse("2001:db8::/32")!,
        getSecurityBlocklistFeedEmptyPlaceholder(
          SecurityBlocklistFeedFamily.IPv6,
        ),
      ),
    ).toBe(true);
  });

  test("the same blocks always make the same bytes: no date, no count of anything that moves", () => {
    expect(
      renderSecurityBlocklistPlainList({
        entries: ENTRIES,
        withComments: true,
        family: SecurityBlocklistFeedFamily.Both,
      }),
    ).toBe(commented);
  });
});

describe("Cisco's MD5", () => {
  test("is the checksum alone, 32 lower-case hex digits, with no comment and no line break", () => {
    expect(
      renderSecurityBlocklistFeedMd5(" 0CC175B9C0F1B6A831C399E269772661\n"),
    ).toBe("0cc175b9c0f1b6a831c399e269772661");
  });
});

describe("the nftables script", () => {
  const script: string = renderSecurityBlocklistNftables({ entries: ENTRIES });

  test("declares the table and its two interval sets, flushes them and fills them, in one file nft -f loads as one transaction", () => {
    expect(script).toBe(
      [
        "#!/usr/sbin/nft -f",
        "# OneUptime blocklist: 2 IPv4 and 2 IPv6 entries.",
        "table inet oneuptime {",
        "  set blocklist_v4 {",
        "    type ipv4_addr",
        "    flags interval",
        "  }",
        "  set blocklist_v6 {",
        "    type ipv6_addr",
        "    flags interval",
        "  }",
        "}",
        "flush set inet oneuptime blocklist_v4",
        "flush set inet oneuptime blocklist_v6",
        "add element inet oneuptime blocklist_v4 { 35.205.11.131, 198.51.100.0/24 }",
        "add element inet oneuptime blocklist_v6 { 2001:db8::9, 2001:db8:7::/48 }",
        "",
      ].join("\n"),
    );
  });

  test("declares no chain and no rule: loaded every minute, a rule would be added again each time", () => {
    expect(script).not.toMatch(/\bchain\b/);
    expect(script).not.toMatch(/\bdrop\b/);
    expect(script).not.toMatch(/\brule\b/);
  });

  test("with nothing blocked, only flushes: an empty element list is not nft syntax", () => {
    const empty: string = renderSecurityBlocklistNftables({ entries: [] });

    expect(empty).toContain("flush set inet oneuptime blocklist_v4\n");
    expect(empty).toContain("flush set inet oneuptime blocklist_v6\n");
    expect(empty).not.toContain("add element");
    expect(empty).not.toContain("{ }");
  });

  test("an address a listed range holds is left out: an interval set refuses two elements that overlap", () => {
    const overlapping: Array<SecurityBlocklistFeedEntry> =
      selectSecurityBlocklistFeedEntries({
        blocks: [
          block("10.0.0.5"),
          block("10.0.0.0/24"),
          block("10.0.0.0/16"),
          block("10.1.0.1"),
          block("2001:db8::1"),
          block("2001:db8::/48"),
        ],
        family: SecurityBlocklistFeedFamily.Both,
        now: NOW,
      });

    expect(
      withoutCoveredSecurityBlocklistFeedEntries(overlapping).map(
        (entry: SecurityBlocklistFeedEntry): string => {
          return entry.value;
        },
      ),
    ).toEqual(["10.0.0.0/16", "10.1.0.1", "2001:db8::/48"]);

    expect(renderSecurityBlocklistNftables({ entries: overlapping })).toContain(
      "add element inet oneuptime blocklist_v4 { 10.0.0.0/16, 10.1.0.1 }",
    );
  });
});

describe("the nginx include", () => {
  test("is a deny a line (ngx_http_access_module: deny address | CIDR | unix: | all;), after one comment line", () => {
    const include: string = renderSecurityBlocklistNginx({ entries: ENTRIES });

    expect(include).toBe(
      [
        "# OneUptime blocklist: 4 entries. Include it in an http, server or location block.",
        "deny 35.205.11.131;",
        "deny 198.51.100.0/24;",
        "deny 2001:db8::9;",
        "deny 2001:db8:7::/48;",
        "",
      ].join("\n"),
    );

    for (const line of linesOf(include).slice(1)) {
      const match: RegExpExecArray | null = NGINX_DENY.exec(line);
      expect(match).not.toBeNull();
      expect(NetworkAddressBlockUtil.parse(match![1])).not.toBeNull();
    }
  });

  test("with nothing blocked, is its comment alone, which nginx reads as nothing", () => {
    expect(renderSecurityBlocklistNginx({ entries: [] })).toBe(
      "# OneUptime blocklist: 0 entries. Include it in an http, server or location block.\n",
    );
  });
});

describe("the files a feed serves", () => {
  test("each format by its file name, and its MD5 by .md5 after it", () => {
    expect(readSecurityBlocklistFeedFile("blocklist.txt")).toEqual({
      format: SecurityBlocklistFeedFormat.Plain,
      isMd5: false,
    });
    expect(readSecurityBlocklistFeedFile("blocklist.txt.md5")).toEqual({
      format: SecurityBlocklistFeedFormat.Plain,
      isMd5: true,
    });
    expect(readSecurityBlocklistFeedFile("nftables.nft")).toEqual({
      format: SecurityBlocklistFeedFormat.Nftables,
      isMd5: false,
    });
    expect(readSecurityBlocklistFeedFile("nginx.conf")).toEqual({
      format: SecurityBlocklistFeedFormat.Nginx,
      isMd5: false,
    });
    expect(
      SECURITY_BLOCKLIST_FEED_FILE_NAMES[SecurityBlocklistFeedFormat.Plain],
    ).toBe("blocklist.txt");
  });

  test("Cisco's list file ends in .txt, as its feeds must", () => {
    expect(
      SECURITY_BLOCKLIST_FEED_FILE_NAMES[
        SecurityBlocklistFeedFormat.Plain
      ].endsWith(".txt"),
    ).toBe(true);
  });

  test("anything else is no file", () => {
    for (const name of [
      "",
      null,
      undefined,
      "blocklist",
      "blocklist.TXT",
      "../blocklist.txt",
      ".md5",
      "blocklist.txt.md5.md5",
      "index.html",
    ]) {
      expect(readSecurityBlocklistFeedFile(name)).toBeNull();
    }
  });

  test("?comments=1 (or true, or yes) asks for the comments; anything else does not", () => {
    for (const value of ["1", "true", "yes", "YES", [" 1 "]]) {
      expect(readSecurityBlocklistFeedComments(value)).toBe(true);
    }

    for (const value of ["0", "", "false", undefined, null, 1, ["no"]]) {
      expect(readSecurityBlocklistFeedComments(value)).toBe(false);
    }
  });

  test("a file is rendered the way its format says", () => {
    expect(
      renderSecurityBlocklistFeed({
        format: SecurityBlocklistFeedFormat.Nginx,
        entries: ENTRIES,
        withComments: true,
        family: SecurityBlocklistFeedFamily.Both,
      }),
    ).toBe(renderSecurityBlocklistNginx({ entries: ENTRIES }));
    expect(
      renderSecurityBlocklistFeed({
        format: SecurityBlocklistFeedFormat.Nftables,
        entries: ENTRIES,
        withComments: true,
        family: SecurityBlocklistFeedFamily.Both,
      }),
    ).toBe(renderSecurityBlocklistNftables({ entries: ENTRIES }));
    expect(
      renderSecurityBlocklistFeed({
        format: SecurityBlocklistFeedFormat.Plain,
        entries: ENTRIES,
        withComments: false,
        family: SecurityBlocklistFeedFamily.Both,
      }),
    ).toBe(
      renderSecurityBlocklistPlainList({
        entries: ENTRIES,
        withComments: false,
        family: SecurityBlocklistFeedFamily.Both,
      }),
    );
  });
});
