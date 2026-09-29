// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import {
  NETBIOS_QUERY_ALLOWED_RANGES,
  isNetbiosQueryAddressAllowed,
} from "../../../Utils/Discovery/NetbiosNameResolver";
import { isNetbiosQueryableIPv4Address } from "Common/Utils/NetworkDiscovery/NetbiosNameUtil";
import { describe, expect, it } from "@jest/globals";

/*
 * OneUptime issue #3916 — the dashboard and the probe must agree on which
 * addresses a NetBIOS lookup would ever query.
 *
 * The probe's rule is isNetbiosQueryAddressAllowed: Node's `net.isIPv4`, then
 * NETBIOS_QUERY_ALLOWED_RANGES (RFC 1918 private and RFC 6598 CGNAT). Every
 * other address is refused whoever asks. The Review dialog cannot import it —
 * it leans on Node's `net`, and Common is bundled into the browser — so it
 * asks a copy in Common, isNetbiosQueryableIPv4Address, before it tells an
 * unnamed host that "NetBIOS lookup asks Windows hosts for their own name".
 * Before that copy existed the tip was shown for public and IPv6 addresses
 * too, and following it bought a rescan whose only news was "not asked".
 *
 * A copy drifts. This file is what stops it: the two functions are asked
 * about the same addresses — every range edge and its neighbours, every
 * first-and-second-octet pair, a seeded random sweep, and the malformed
 * spellings `net.isIPv4` refuses — and must give the same answer to every
 * one. The edges are worked out from the probe's own range list, so a range
 * added to or changed in the probe moves the edges this checks with it.
 */

interface Disagreement {
  value: string;
  probe: boolean;
  common: boolean;
}

function describeValue(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/*
 * The values the two functions answer differently, as a list, so a failure
 * prints the offending addresses rather than stopping at the first.
 */
function findDisagreements(values: Iterable<unknown>): Array<Disagreement> {
  const disagreements: Array<Disagreement> = [];

  for (const value of values) {
    const probe: boolean = isNetbiosQueryAddressAllowed(value);
    const common: boolean = isNetbiosQueryableIPv4Address(value);

    if (probe !== common) {
      disagreements.push({
        value: describeValue(value),
        probe: probe,
        common: common,
      });
    }
  }

  return disagreements;
}

function toDottedQuad(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".");
}

function fromDottedQuad(address: string): number {
  return (
    address.split(".").reduce((total: number, octet: string): number => {
      return total * 256 + parseInt(octet, 10);
    }, 0) >>> 0
  );
}

/*
 * For each of the probe's ranges: its first and last address, the ones just
 * outside, and one step in from each end. Derived from the probe's list, not
 * written out, so it follows any change to it.
 */
function rangeEdgeAddresses(): Array<string> {
  const edges: Array<string> = [];

  for (const cidr of NETBIOS_QUERY_ALLOWED_RANGES) {
    const [base, prefixText] = cidr.split("/") as [string, string];
    const prefixLength: number = parseInt(prefixText, 10);
    const size: number = 2 ** (32 - prefixLength);
    const first: number = fromDottedQuad(base);
    const last: number = first + size - 1;

    for (const value of [
      first - 1,
      first,
      first + 1,
      last - 1,
      last,
      last + 1,
    ]) {
      if (value >= 0 && value <= 0xffffffff) {
        edges.push(toDottedQuad(value));
      }
    }
  }

  return edges;
}

/*
 * Spellings of an address that are not the one the sweep reports. The probe
 * refuses each through `net.isIPv4`; the copy must refuse each on its own.
 */
function malformedSpellingsOf(address: string): Array<string> {
  const octets: Array<string> = address.split(".");
  const spellings: Array<string> = [
    ` ${address}`,
    `${address} `,
    `\t${address}`,
    `${address}\n`,
    `${address}\r\n`,
    `${address}\u0000`,
    `\u00a0${address}`,
    `${address}.`,
    `.${address}`,
    `${address}/32`,
    `${address}:137`,
    `::ffff:${address}`,
    `+${address}`,
    octets.slice(0, 3).join("."),
    `${address}.0`,
  ];

  // A leading zero on each octet in turn: "010.0.0.1", "10.00.0.1", ...
  for (let index: number = 0; index < 4; index++) {
    spellings.push(
      octets
        .map((octet: string, position: number): string => {
          return position === index ? `0${octet}` : octet;
        })
        .join("."),
    );
  }

  return spellings;
}

describe("isNetbiosQueryableIPv4Address agrees with the probe's isNetbiosQueryAddressAllowed", () => {
  it("on the documented edges of every range, written out", () => {
    const values: Array<string> = [
      "9.255.255.255",
      "10.0.0.0",
      "10.0.0.1",
      "10.255.255.255",
      "11.0.0.0",
      "172.15.255.255",
      "172.16.0.0",
      "172.31.255.255",
      "172.32.0.0",
      "192.167.255.255",
      "192.168.0.0",
      "192.168.255.255",
      "192.169.0.0",
      "100.63.255.255",
      "100.64.0.0",
      "100.127.255.255",
      "100.128.0.0",
      "10.16.42.51",
      "10.18.167.31",
      "8.8.8.8",
      "203.0.113.7",
      "127.0.0.1",
      "169.254.169.254",
      "0.0.0.0",
      "255.255.255.255",
      "224.0.0.251",
    ];

    expect(findDisagreements(values)).toEqual([]);

    /*
     * And the edges really are edges: both ends inside, both neighbours
     * outside. Without this, two functions that both returned false for
     * everything would agree perfectly.
     */
    expect(
      values.filter((value: string): boolean => {
        return isNetbiosQueryAddressAllowed(value);
      }),
    ).toEqual([
      "10.0.0.0",
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.0",
      "172.31.255.255",
      "192.168.0.0",
      "192.168.255.255",
      "100.64.0.0",
      "100.127.255.255",
      "10.16.42.51",
      "10.18.167.31",
    ]);
  });

  it("on the edges of every range in the probe's own list", () => {
    const edges: Array<string> = rangeEdgeAddresses();

    // Six per range, none of the probe's ranges touching 0.0.0.0 or the top.
    expect(edges.length).toBe(NETBIOS_QUERY_ALLOWED_RANGES.length * 6);
    expect(findDisagreements(edges)).toEqual([]);
  });

  it("on every first and second octet, at both ends of each /16", () => {
    /*
     * No range is narrower than a /16, so this reaches every edge there is;
     * the random sweep below covers anything narrower being added.
     */
    const values: Array<string> = [];

    for (let first: number = 0; first <= 255; first++) {
      for (let second: number = 0; second <= 255; second++) {
        values.push(`${first}.${second}.0.0`, `${first}.${second}.255.255`);
      }
    }

    const disagreements: Array<Disagreement> = findDisagreements(values);

    expect(disagreements.slice(0, 10)).toEqual([]);
    expect(disagreements.length).toBe(0);

    // 256 + 16 + 1 + 64 second octets are inside, at both ends of each.
    expect(
      values.filter((value: string): boolean => {
        return isNetbiosQueryAddressAllowed(value);
      }).length,
    ).toBe((256 + 16 + 1 + 64) * 2);
  });

  it("on a seeded random sweep of the whole address space", () => {
    /*
     * A deterministic LCG, not Math.random, as in NetbiosNameUtil.test.ts: a
     * parity check that fails one run in a thousand gets deleted.
     */
    let seed: number = 0x3916;

    const nextAddress: () => string = (): string => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return toDottedQuad(seed);
    };

    const values: Array<string> = [];

    for (let index: number = 0; index < 50000; index++) {
      values.push(nextAddress());
    }

    expect(findDisagreements(values).slice(0, 10)).toEqual([]);
  });

  it("on every malformed spelling of every edge address", () => {
    const values: Array<string> = [];

    for (const address of rangeEdgeAddresses()) {
      values.push(...malformedSpellingsOf(address));
    }

    expect(findDisagreements(values)).toEqual([]);

    // Every one refused, by both: none is the spelling the sweep reports.
    expect(
      values.filter((value: string): boolean => {
        return isNetbiosQueryableIPv4Address(value);
      }),
    ).toEqual([]);
  });

  it("on other strings that are not a strict dotted quad", () => {
    expect(
      findDisagreements([
        "",
        ".",
        "...",
        "10..0.1",
        "10.0.0.256",
        "10.0.0.-1",
        "0x0a.0.0.1",
        "1e1.0.0.1",
        "10.0.0.a",
        "::1",
        "fd00::1",
        "fe80::1",
        "2001:db8::5",
        "::ffff:a00:1",
        "host.corp.example.com",
        "\uff11\uff10.0.0.1",
        "\u0661\u0660.0.0.1",
        "\u200b10.0.0.1",
        "\ufeff10.0.0.1",
        `${"1".repeat(1000)}.0.0.1`,
      ]),
    ).toEqual([]);
  });

  it("on values that are not strings", () => {
    expect(
      findDisagreements([
        undefined,
        null,
        167772161,
        Number.NaN,
        true,
        ["10.0.0.1"],
        {
          toString: (): string => {
            return "10.0.0.1";
          },
        },
      ]),
    ).toEqual([]);
  });
});
