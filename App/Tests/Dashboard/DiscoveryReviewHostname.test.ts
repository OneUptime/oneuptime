import { describe, expect, test } from "@jest/globals";
import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  buildDeviceName,
  getDiscoveredHostDisplayName,
} from "Common/Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import { normalizeDiscoveredHosts } from "Common/Utils/NetworkDiscovery/DiscoveredHostUtil";
import fs from "fs";
import path from "path";

/*
 * WHY THIS FILE EXISTS
 *
 * OneUptime issue #3529 — "Network Discovery Scan should perform reverse DNS
 * lookup and display hostnames". The report is a screenshot of the Review
 * Discovered Devices dialog listing
 *
 *     10.18.166.51
 *     10.18.166.53
 *     10.18.166.54
 *     10.18.166.55
 *
 * on an estate where every one of those addresses has a DNS record. The rows
 * are hosts with no readable SNMP, and the dialog's name line was
 * `entry.sysName || entry.ipAddress` — with no sysName there was nothing left
 * to fall back to.
 *
 * The fix has a probe half (resolve the PTR record) and a dashboard half
 * (show it), and the dashboard half is the one that closes the loop the
 * reporter actually saw. This file pins that half.
 *
 * The App suite runs in a plain Node environment with no React renderer, so
 * the dialog cannot be mounted and read. So the file is in two parts, and
 * both are load-bearing:
 *
 *   - BEHAVIOUR, tested against the shared function the row now calls. That is
 *     where the naming rule actually lives, and it is real executable
 *     coverage rather than a source-level proxy.
 *   - SOURCE, following DiscoveryReviewCopy.test.ts and
 *     InventoryTableInvariants.test.ts: proof that the row calls that shared
 *     function instead of spelling the rule out a second time. Duplicated
 *     rules drift, and this exact rule drifting means the operator ticks a box
 *     next to one name and gets a device with another.
 */

const DISCOVERY_PAGE: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "NetworkDevice",
  "Discovery.tsx",
);

/*
 * Read once per run. The page is a file on disk that other processes edit —
 * another agent, an editor, a rebase — and an uncached read can hand two
 * halves of one test two different files, failing on a difference that never
 * existed in either.
 */
let cachedSource: string | null = null;

function readSource(): string {
  if (cachedSource === null) {
    cachedSource = fs.readFileSync(DISCOVERY_PAGE, "utf8");
  }

  return cachedSource;
}

/*
 * Comments stripped so that DESCRIBING a rule in prose never counts as
 * implementing it, and whitespace squashed so Prettier can reflow props
 * without making the test brittle.
 */
function readCode(): string {
  return readSource()
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");
}

/*
 * The reporter's four rows, as the probe now reports them: alive, no SNMP,
 * and each with the PTR record their estate publishes.
 */
function reportedHosts(): Array<DiscoveredNetworkDevice> {
  return [
    {
      ipAddress: "10.18.166.51",
      snmpReachable: false,
      dnsHostname: "core-gw.corp.example.com",
    },
    {
      ipAddress: "10.18.166.53",
      snmpReachable: false,
      dnsHostname: "printer-3.corp.example.com",
    },
    {
      ipAddress: "10.18.166.54",
      snmpReachable: false,
      dnsHostname: "cam-lobby.corp.example.com",
    },
    // No PTR record: this one keeps its address, which is the stated fallback.
    { ipAddress: "10.18.166.55", snmpReachable: false },
  ];
}

/*
 * What the dialog's name line renders, computed the way the row computes it:
 * normalise the jsonb, then ask the shared display-name function. Both steps
 * matter — the row is fed by getReviewHosts, which normalises first.
 */
function renderedNames(hosts: Array<DiscoveredNetworkDevice>): Array<string> {
  return normalizeDiscoveredHosts(hosts).map(
    (host: DiscoveredNetworkDevice) => {
      return getDiscoveredHostDisplayName(host);
    },
  );
}

describe("the Review dialog names hosts by their PTR record (issue #3529)", () => {
  test("the reported rows read as hostnames instead of addresses", () => {
    expect(renderedNames(reportedHosts())).toEqual([
      "core-gw.corp.example.com",
      "printer-3.corp.example.com",
      "cam-lobby.corp.example.com",
      // The stated fallback: no reverse record, so the address stands.
      "10.18.166.55",
    ]);
  });

  test("the address is still shown on every row", () => {
    /*
     * The name replaces the LABEL, never the address. An operator matching a
     * row against a firewall rule or a patch panel needs the address, and the
     * device that imports is keyed by it.
     */
    const addresses: Array<string> = normalizeDiscoveredHosts(
      reportedHosts(),
    ).map((host: DiscoveredNetworkDevice) => {
      return host.ipAddress;
    });

    expect(addresses).toEqual([
      "10.18.166.51",
      "10.18.166.53",
      "10.18.166.54",
      "10.18.166.55",
    ]);
  });

  test("an SNMP host keeps its sysName as the name line", () => {
    // Unchanged behaviour for every scan that already worked.
    expect(
      renderedNames([
        {
          ipAddress: "10.0.0.5",
          sysName: "core-switch-01",
          dnsHostname: "sw1.corp.example.com",
          snmpReachable: true,
        },
      ]),
    ).toEqual(["core-switch-01"]);
  });

  test("a scan stored before reverse DNS existed renders exactly as it did", () => {
    /*
     * Every scan result already in the database, and every result from a
     * probe that has not been upgraded, has no dnsHostname at all.
     */
    expect(
      renderedNames([
        { ipAddress: "10.0.0.5", sysName: "core-switch-01" },
        { ipAddress: "10.0.0.6" },
      ]),
    ).toEqual(["core-switch-01", "10.0.0.6"]);
  });

  test("a hostile PTR record renders as the address, not as itself", () => {
    /*
     * React escapes on render, so this is not about script execution — it is
     * about a scan of a subnet this project does not administer being able to
     * choose what an operator reads on a row they are about to tick.
     */
    expect(
      renderedNames([
        { ipAddress: "10.0.0.5", dnsHostname: "<script>alert(1)</script>" },
        { ipAddress: "10.0.0.6", dnsHostname: "Already added" },
        { ipAddress: "10.0.0.7", dnsHostname: "10.0.0.7" },
      ]),
    ).toEqual(["10.0.0.5", "10.0.0.6", "10.0.0.7"]);
    /*
     * The middle one is worth stating plainly: "Already added" is a single
     * label of letters and a space, and the space is what disqualifies it. A
     * PTR record that could render as one of the dialog's own badges would let
     * the scanned network lie to the operator about the dialog's state, and
     * the character rules are what make that unreachable.
     */
  });

  test("the row's name is the name the device gets", () => {
    /*
     * The contract the whole shared-function refactor exists for: the
     * operator ticks a box next to a name and gets a device with that name.
     */
    for (const host of normalizeDiscoveredHosts(reportedHosts())) {
      expect(buildDeviceName(host)).toBe(getDiscoveredHostDisplayName(host));
    }
  });
});

describe("Discovery.tsx wires the row to the shared recipe", () => {
  /*
   * Source-level, because the App suite cannot mount the dialog. What these
   * catch is the rule being spelled out twice — which is how the row and the
   * import drift apart.
   */

  test("the page imports the shared display-name function", () => {
    expect(readCode()).toContain("getDiscoveredHostDisplayName");
  });

  test("the row no longer re-spells the naming rule", () => {
    /*
     * `entry.sysName || entry.ipAddress` was the old name line AND the old
     * aria-label. Both are now the shared function, so neither spelling may
     * survive anywhere on the page — including in the checkbox label, which
     * is what a screen-reader user hears instead of the visible name.
     */
    const code: string = readCode();

    expect(code).not.toContain("entry.sysName || entry.ipAddress");
    expect(code).not.toContain("entry.sysName||entry.ipAddress");
  });

  test("the name line and the aria-label use the same computed value", () => {
    /*
     * One variable, used twice. A sighted operator and a screen-reader user
     * must be told the same thing about the same row.
     */
    const code: string = readCode();

    expect(code).toContain("getDiscoveredHostDisplayName(entry)");
    expect(code).toContain("ariaLabel={`Import ${displayName}");
    expect(code).toContain("{displayName}");
  });

  test("the row still renders the address alongside the name", () => {
    expect(readCode()).toContain("{entry.ipAddress}");
  });
});
