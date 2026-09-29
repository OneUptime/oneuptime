import "../../TestingUtils/DiscoveryEnvironment";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import SubnetScanner, {
  DiscoveredHost,
  type NetbiosNamingOutcome,
  type ReverseDnsNamingOutcome,
} from "../../../Utils/Discovery/SubnetScanner";
import { ReverseDnsResolution } from "../../../Utils/Discovery/ReverseDnsResolver";
import { NetbiosNameResolution } from "../../../Utils/Discovery/NetbiosNameResolver";
import {
  DiscoveredHostNetbiosStatus,
  DiscoveredHostReverseDnsStatus,
} from "Common/Types/NetworkDevice/DiscoveredHostNamingStatus";
import logger from "Common/Server/Utils/Logger";
import {
  installReverseDnsStub,
  stubReverseDnsAsResolvingNothing,
} from "../../TestingUtils/StubReverseDns";

/*
 * OneUptime issue #3916 — why a discovered host has no name, stamped on the
 * host itself.
 *
 * The reported scan named four of twelve kitchen displays and listed the rest
 * by address, and nothing anywhere said whether those eight had no PTR record,
 * or the probe's DNS server had not answered, or NetBIOS had never been asked.
 * The resolvers now report a code per address (DiscoveredHostNamingStatus.ts),
 * and the two naming passes put that code on each host they leave unnamed —
 * `dnsHostnameStatus` and `netbiosNameStatus` — for the Review dialog's
 * tooltip.
 *
 * This file pins the stamping itself, directly against the two public passes
 * with their resolver seams replaced. The rules it holds them to:
 *
 *   1. ONLY hosts left without a name get a code. A host named by SNMP, by
 *      its PTR record or by NetBIOS needs no explanation, and a code on it
 *      would be thousands of bytes of nothing on a big sweep.
 *   2. NetBIOS codes go only on hosts NetBIOS was asked about.
 *   3. Only a code the resolver REPORTED, and only one on the whitelist. No
 *      default is ever invented: a host the resolver said nothing about keeps
 *      no key at all, which is what keeps every host literal written before
 *      the codes existed describing the same object. The seams are public and
 *      spied on, so a double handing back a plain object, a misspelt code or a
 *      code from the other enum must change nothing.
 *   4. Neither pass ever throws on the way to a finished sweep's upload.
 *
 * Both seams are replaced for every test (stubReverseDnsAsResolvingNothing
 * installs the NetBIOS stub too), so no DNS query or UDP datagram leaves the
 * process; ReverseDnsStubIntegrity.test.ts enforces that for this file too.
 */

/*
 * The per-address codes a resolution may carry, typed loosely on purpose: the
 * tests below hand the scanner exactly the junk a careless double would.
 */
type LooseStatusTable = Map<unknown, unknown> | Record<string, unknown>;

type ReverseDnsDouble = {
  names?: Record<string, string>;
  statuses?: LooseStatusTable | unknown;
  failedAddressCount?: unknown;
  notLookedUpCount?: unknown;
  isTimeBudgetExhausted?: unknown;
  isReverseDnsAvailable?: unknown;
};

// Replaces the reverse-DNS seam with a resolution built from these parts.
function mockReverseDns(double: ReverseDnsDouble): void {
  jest
    .spyOn(SubnetScanner, "resolveReverseDnsHostnames")
    .mockImplementation(
      async (ipAddresses: Array<string>): Promise<ReverseDnsResolution> => {
        const resolution: Record<string, unknown> = {
          hostnameByIpAddress: new Map<string, string>(
            Object.entries(double.names || {}),
          ),
          isReverseDnsAvailable: double.isReverseDnsAvailable ?? true,
          isTimeBudgetExhausted: double.isTimeBudgetExhausted ?? false,
          lookedUpCount: new Set<string>(ipAddresses).size,
          notLookedUpCount: double.notLookedUpCount ?? 0,
          totalBudgetInMs: 60000,
        };

        if ("statuses" in double) {
          resolution["statusByIpAddress"] = double.statuses;
        }

        if ("failedAddressCount" in double) {
          resolution["failedAddressCount"] = double.failedAddressCount;
        }

        return resolution as unknown as ReverseDnsResolution;
      },
    );
}

type NetbiosDouble = {
  names?: Record<string, string>;
  statuses?: LooseStatusTable | unknown;
};

// Replaces the NetBIOS seam, recording every address list it is handed.
function mockNetbios(double: NetbiosDouble): Array<Array<string>> {
  const asked: Array<Array<string>> = [];

  jest
    .spyOn(SubnetScanner, "resolveNetbiosNames")
    .mockImplementation(
      async (ipAddresses: Array<string>): Promise<NetbiosNameResolution> => {
        asked.push([...ipAddresses]);

        const resolution: Record<string, unknown> = {
          nameByIpAddress: new Map<string, string>(
            Object.entries(double.names || {}),
          ),
          queriedCount: new Set<string>(ipAddresses).size,
          skippedCount: 0,
          isTimeBudgetExhausted: false,
          isHostCapReached: false,
          eligibleCount: new Set<string>(ipAddresses).size,
          maxHosts: 2000,
          totalBudgetInMs: 30000,
        };

        if ("statuses" in double) {
          resolution["statusByIpAddress"] = double.statuses;
        }

        return resolution as unknown as NetbiosNameResolution;
      },
    );

  return asked;
}

function pingOnly(ipAddress: string): DiscoveredHost {
  return { ipAddress: ipAddress, snmpReachable: false };
}

function snmpHost(ipAddress: string, sysName: string): DiscoveredHost {
  return {
    ipAddress: ipAddress,
    sysName: sysName,
    sysDescr: "Cisco IOS",
    snmpReachable: true,
    snmpConfigId: "config-1",
  };
}

function reverseDnsStatuses(
  entries: Record<string, DiscoveredHostReverseDnsStatus>,
): Map<string, DiscoveredHostReverseDnsStatus> {
  return new Map<string, DiscoveredHostReverseDnsStatus>(
    Object.entries(entries),
  );
}

function netbiosStatuses(
  entries: Record<string, DiscoveredHostNetbiosStatus>,
): Map<string, DiscoveredHostNetbiosStatus> {
  return new Map<string, DiscoveredHostNetbiosStatus>(Object.entries(entries));
}

// Keeps the test output readable. Re-applied after every mid-test restore.
function silenceLogger(): void {
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
}

/*
 * Both seams stubbed for every test; each test installs its own double on
 * top. The few loops that need a clean slate between iterations restore every
 * mock and put the stubs straight back with installReverseDnsStub(), which is
 * what ReverseDnsStubIntegrity.test.ts requires of a mid-test restore.
 */
stubReverseDnsAsResolvingNothing();

beforeEach(() => {
  silenceLogger();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("attachReverseDnsHostnames — a code on every host it leaves unnamed", () => {
  it("stamps the reported code on unnamed hosts, and nothing on the named ones", async () => {
    /*
     * The reported scan in miniature: one host named, one with no record, one
     * whose lookup timed out even on its retry. Three different rows in the
     * Review dialog, where before the fix two of them were indistinguishable.
     */
    const hosts: Array<DiscoveredHost> = [
      pingOnly("10.16.42.51"),
      pingOnly("10.16.42.52"),
      pingOnly("10.16.42.53"),
    ];

    mockReverseDns({
      names: { "10.16.42.52": "WB0024KDS02.wbhq.com" },
      statuses: reverseDnsStatuses({
        "10.16.42.51": DiscoveredHostReverseDnsStatus.NoRecord,
        "10.16.42.53": DiscoveredHostReverseDnsStatus.Timeout,
      }),
      failedAddressCount: 1,
    });

    const outcome: ReverseDnsNamingOutcome =
      await SubnetScanner.attachReverseDnsHostnames(hosts);

    expect(hosts).toStrictEqual([
      {
        ipAddress: "10.16.42.51",
        snmpReachable: false,
        dnsHostnameStatus: "no-record",
      },
      {
        ipAddress: "10.16.42.52",
        snmpReachable: false,
        dnsHostname: "WB0024KDS02.wbhq.com",
      },
      {
        ipAddress: "10.16.42.53",
        snmpReachable: false,
        dnsHostnameStatus: "timeout",
      },
    ]);
    expect(outcome.failedAddressCount).toBe(1);
    expect(outcome.namedAddressCount).toBe(1);
  });

  it("never stamps a host with a sysName, even when the resolver reported a code for its address", async () => {
    /*
     * Reverse DNS asks about every host, SNMP-named or not, so the resolver
     * DOES report a code for a switch that has no PTR record. The switch is
     * named by its sysName; the dialog shows it no hint; a code on it would be
     * a status nobody reads.
     */
    const hosts: Array<DiscoveredHost> = [
      snmpHost("10.0.0.1", "core-switch-01"),
      pingOnly("10.0.0.2"),
    ];

    mockReverseDns({
      statuses: reverseDnsStatuses({
        "10.0.0.1": DiscoveredHostReverseDnsStatus.NoRecord,
        "10.0.0.2": DiscoveredHostReverseDnsStatus.NoRecord,
      }),
    });

    await SubnetScanner.attachReverseDnsHostnames(hosts);

    expect(hosts[0]).not.toHaveProperty("dnsHostnameStatus");
    expect(hosts[1]!.dnsHostnameStatus).toBe(
      DiscoveredHostReverseDnsStatus.NoRecord,
    );
  });

  it("treats a blank or whitespace sysName as no name, the way NetBIOS and the dashboard do", async () => {
    const hosts: Array<DiscoveredHost> = [
      { ipAddress: "10.0.0.1", sysName: "", snmpReachable: true },
      { ipAddress: "10.0.0.2", sysName: "   ", snmpReachable: true },
    ];

    mockReverseDns({
      statuses: reverseDnsStatuses({
        "10.0.0.1": DiscoveredHostReverseDnsStatus.ServerFailure,
        "10.0.0.2": DiscoveredHostReverseDnsStatus.Refused,
      }),
    });

    await SubnetScanner.attachReverseDnsHostnames(hosts);

    expect(hosts[0]!.dnsHostnameStatus).toBe("server-failure");
    expect(hosts[1]!.dnsHostnameStatus).toBe("refused");
  });

  it("never stamps a host it named, even when an inconsistent double also reports a code for it", async () => {
    // The name wins: a named host is not unnamed, whatever else was said.
    const hosts: Array<DiscoveredHost> = [pingOnly("10.0.0.1")];

    mockReverseDns({
      names: { "10.0.0.1": "gw.corp.example.com" },
      statuses: reverseDnsStatuses({
        "10.0.0.1": DiscoveredHostReverseDnsStatus.Timeout,
      }),
    });

    await SubnetScanner.attachReverseDnsHostnames(hosts);

    expect(hosts[0]).toStrictEqual({
      ipAddress: "10.0.0.1",
      snmpReachable: false,
      dnsHostname: "gw.corp.example.com",
    });
  });

  it("never stamps a host that arrived already carrying a PTR name", async () => {
    const hosts: Array<DiscoveredHost> = [
      {
        ipAddress: "10.0.0.1",
        snmpReachable: false,
        dnsHostname: "legacy.corp.example.com",
      },
    ];

    mockReverseDns({
      statuses: reverseDnsStatuses({
        "10.0.0.1": DiscoveredHostReverseDnsStatus.NoRecord,
      }),
    });

    await SubnetScanner.attachReverseDnsHostnames(hosts);

    expect(hosts[0]).not.toHaveProperty("dnsHostnameStatus");
  });

  it("leaves the key ABSENT for an address the resolver reported nothing about", async () => {
    /*
     * No default. "No PTR record" is a claim about the address, and a pass
     * that did not make it must not have it made on its behalf — which is
     * also what keeps every pre-existing host literal equal.
     */
    const hosts: Array<DiscoveredHost> = [
      pingOnly("10.0.0.1"),
      pingOnly("10.0.0.2"),
    ];

    mockReverseDns({
      statuses: reverseDnsStatuses({
        "10.0.0.1": DiscoveredHostReverseDnsStatus.NoRecord,
        // An address the sweep never found: ignored.
        "10.0.0.99": DiscoveredHostReverseDnsStatus.Timeout,
      }),
    });

    await SubnetScanner.attachReverseDnsHostnames(hosts);

    expect(hosts[1]).toStrictEqual({
      ipAddress: "10.0.0.2",
      snmpReachable: false,
    });
    expect(hosts).toHaveLength(2);
  });

  it("stamps nothing at all when the resolution carries no status table", async () => {
    // Every resolution written before the codes existed, and every stub here.
    const hosts: Array<DiscoveredHost> = [
      pingOnly("10.0.0.1"),
      pingOnly("10.0.0.2"),
    ];

    mockReverseDns({});

    await SubnetScanner.attachReverseDnsHostnames(hosts);

    expect(hosts).toStrictEqual([pingOnly("10.0.0.1"), pingOnly("10.0.0.2")]);
  });

  it("reads anything but a real Map as no status table", async () => {
    /*
     * A plain object keyed by address LOOKS like a table, and an array of
     * pairs looks like one to `new Map`. Neither is what the resolver
     * returns, and neither may be read as one.
     */
    const tables: Array<unknown> = [
      undefined,
      null,
      { "10.0.0.1": DiscoveredHostReverseDnsStatus.NoRecord },
      [["10.0.0.1", DiscoveredHostReverseDnsStatus.NoRecord]],
      "no-record",
      42,
      new Set<string>(["10.0.0.1"]),
      {
        get: (): string => {
          return DiscoveredHostReverseDnsStatus.NoRecord;
        },
      },
    ];

    for (const table of tables) {
      jest.restoreAllMocks();
      installReverseDnsStub();
      silenceLogger();

      const hosts: Array<DiscoveredHost> = [pingOnly("10.0.0.1")];

      mockReverseDns({ statuses: table });

      const outcome: ReverseDnsNamingOutcome =
        await SubnetScanner.attachReverseDnsHostnames(hosts);

      expect(hosts[0]).toStrictEqual(pingOnly("10.0.0.1"));
      // And the pass is otherwise healthy: nothing threw on the way.
      expect(outcome.error).toBeUndefined();
    }
  });

  it("ignores a code that is not exactly one of the reverse-DNS codes", async () => {
    const junk: Array<unknown> = [
      "NoRecord",
      "no_record",
      "NO-RECORD",
      " no-record ",
      "no-record\n",
      "",
      42,
      true,
      null,
      {},
      ["no-record"],
      // A NetBIOS code is not a reverse-DNS code.
      DiscoveredHostNetbiosStatus.NoReply,
      DiscoveredHostNetbiosStatus.SkippedGlobalProbe,
    ];
    const hosts: Array<DiscoveredHost> = junk.map(
      (_value: unknown, index: number): DiscoveredHost => {
        return pingOnly(`10.0.1.${index + 1}`);
      },
    );
    const statuses: Map<string, unknown> = new Map<string, unknown>();

    junk.forEach((value: unknown, index: number) => {
      statuses.set(`10.0.1.${index + 1}`, value);
    });

    mockReverseDns({ statuses: statuses });

    await SubnetScanner.attachReverseDnsHostnames(hosts);

    for (const host of hosts) {
      expect(host).not.toHaveProperty("dnsHostnameStatus");
    }
  });

  it("carries every reverse-DNS code through unchanged", async () => {
    const codes: Array<DiscoveredHostReverseDnsStatus> = Object.values(
      DiscoveredHostReverseDnsStatus,
    );
    const hosts: Array<DiscoveredHost> = codes.map(
      (
        _code: DiscoveredHostReverseDnsStatus,
        index: number,
      ): DiscoveredHost => {
        return pingOnly(`10.0.2.${index + 1}`);
      },
    );
    const statuses: Map<string, DiscoveredHostReverseDnsStatus> = new Map<
      string,
      DiscoveredHostReverseDnsStatus
    >();

    codes.forEach((code: DiscoveredHostReverseDnsStatus, index: number) => {
      statuses.set(`10.0.2.${index + 1}`, code);
    });

    mockReverseDns({ statuses: statuses });

    await SubnetScanner.attachReverseDnsHostnames(hosts);

    expect(
      hosts.map((host: DiscoveredHost) => {
        return host.dnsHostnameStatus;
      }),
    ).toEqual(codes);
    // Guard on the guard: the enum is not empty, so the loop checked something.
    expect(codes.length).toBeGreaterThanOrEqual(9);
  });

  it("stamps every entry for an address the sweep reported twice, unless that entry has a sysName", async () => {
    /*
     * The SNMP path can list an address twice. Each entry is its own row, so
     * each gets the code — except the one SNMP named, for rule 1.
     */
    const hosts: Array<DiscoveredHost> = [
      pingOnly("10.0.0.5"),
      pingOnly("10.0.0.5"),
      snmpHost("10.0.0.5", "dup-switch"),
    ];

    mockReverseDns({
      statuses: reverseDnsStatuses({
        "10.0.0.5": DiscoveredHostReverseDnsStatus.Timeout,
      }),
      failedAddressCount: 1,
    });

    const outcome: ReverseDnsNamingOutcome =
      await SubnetScanner.attachReverseDnsHostnames(hosts);

    expect(hosts[0]!.dnsHostnameStatus).toBe("timeout");
    expect(hosts[1]!.dnsHostnameStatus).toBe("timeout");
    expect(hosts[2]).not.toHaveProperty("dnsHostnameStatus");
    // One distinct address failed, however many entries it has.
    expect(outcome.failedAddressCount).toBe(1);
  });
});

describe("attachReverseDnsHostnames — failedAddressCount on the verdict", () => {
  function unnamedHosts(count: number): Array<DiscoveredHost> {
    const hosts: Array<DiscoveredHost> = [];

    for (let index: number = 0; index < count; index++) {
      hosts.push(pingOnly(`10.0.3.${index + 1}`));
    }

    return hosts;
  }

  it("carries the resolver's count", async () => {
    mockReverseDns({ failedAddressCount: 2 });

    const outcome: ReverseDnsNamingOutcome =
      await SubnetScanner.attachReverseDnsHostnames(unnamedHosts(12));

    expect(outcome.failedAddressCount).toBe(2);
  });

  it("keeps a reported zero as zero", async () => {
    mockReverseDns({ failedAddressCount: 0 });

    const outcome: ReverseDnsNamingOutcome =
      await SubnetScanner.attachReverseDnsHostnames(unnamedHosts(3));

    expect(outcome).toHaveProperty("failedAddressCount", 0);
  });

  it("leaves the key absent when the resolver did not report one", async () => {
    /*
     * Absent rather than zero, so a verdict from a resolver that never counted
     * failures is the very object it always was — the toEqual literals in
     * DiscoveryReverseDns.test.ts depend on that.
     */
    mockReverseDns({});

    const outcome: ReverseDnsNamingOutcome =
      await SubnetScanner.attachReverseDnsHostnames(unnamedHosts(3));

    expect(outcome).not.toHaveProperty("failedAddressCount");
  });

  it("reads a nonsense count as not reported, and floors a fractional one", async () => {
    for (const reported of [NaN, -1, Infinity, "2", null, true, {}]) {
      jest.restoreAllMocks();
      installReverseDnsStub();
      silenceLogger();
      mockReverseDns({ failedAddressCount: reported });

      const outcome: ReverseDnsNamingOutcome =
        await SubnetScanner.attachReverseDnsHostnames(unnamedHosts(3));

      expect(`${String(reported)}: ${"failedAddressCount" in outcome}`).toBe(
        `${String(reported)}: false`,
      );
    }

    jest.restoreAllMocks();
    installReverseDnsStub();
    silenceLogger();
    mockReverseDns({ failedAddressCount: 2.7 });

    expect(
      (await SubnetScanner.attachReverseDnsHostnames(unnamedHosts(3)))
        .failedAddressCount,
    ).toBe(2);
  });

  it("is clamped to the DISTINCT addresses left unnamed", async () => {
    /*
     * Four entries, two distinct addresses, one of them named: one address
     * could have failed, whatever the double claims. Clamping to entries, or
     * to all addresses, would let "8 of 2 hosts" reach the message.
     */
    mockReverseDns({
      names: { "10.0.0.1": "gw.corp.example.com" },
      failedAddressCount: 8,
    });

    const outcome: ReverseDnsNamingOutcome =
      await SubnetScanner.attachReverseDnsHostnames([
        pingOnly("10.0.0.1"),
        pingOnly("10.0.0.2"),
        pingOnly("10.0.0.2"),
        pingOnly("10.0.0.2"),
      ]);

    expect(outcome.addressCount).toBe(2);
    expect(outcome.failedAddressCount).toBe(1);
  });

  it("is clamped to zero when every address was named", async () => {
    mockReverseDns({
      names: { "10.0.0.1": "a.corp.example.com" },
      failedAddressCount: 3,
    });

    const outcome: ReverseDnsNamingOutcome =
      await SubnetScanner.attachReverseDnsHostnames([pingOnly("10.0.0.1")]);

    expect(outcome.failedAddressCount).toBe(0);
  });

  it("is not read at all for an empty host list", async () => {
    mockReverseDns({ failedAddressCount: 5 });

    const outcome: ReverseDnsNamingOutcome =
      await SubnetScanner.attachReverseDnsHostnames([]);

    expect(outcome).not.toHaveProperty("failedAddressCount");
    expect(SubnetScanner.resolveReverseDnsHostnames).not.toHaveBeenCalled();
  });

  it("mentions the failures on the probe's debug line", async () => {
    mockReverseDns({ failedAddressCount: 2 });

    await SubnetScanner.attachReverseDnsHostnames(unnamedHosts(12));

    const logged: string = (
      logger.debug as unknown as { mock: { calls: Array<Array<unknown>> } }
    ).mock.calls
      .map((call: Array<unknown>) => {
        return String(call[0]);
      })
      .join("\n");

    expect(logged).toContain("with 2 address(es) whose lookup failed");
  });
});

describe("attachReverseDnsHostnames — when the pass throws", () => {
  it("stamps nothing when the seam rejects", async () => {
    const hosts: Array<DiscoveredHost> = [pingOnly("10.0.0.1")];

    jest
      .spyOn(SubnetScanner, "resolveReverseDnsHostnames")
      .mockRejectedValue(new Error("resolver blew up"));

    const outcome: ReverseDnsNamingOutcome =
      await SubnetScanner.attachReverseDnsHostnames(hosts);

    expect(outcome.error).toBe("resolver blew up");
    expect(outcome).not.toHaveProperty("failedAddressCount");
    expect(hosts[0]).toStrictEqual(pingOnly("10.0.0.1"));
  });

  it("keeps the codes already stamped when the status table throws part-way", async () => {
    /*
     * The catch path leaves statuses as they are: a code stamped before the
     * throw is what the resolver said about that address, and it is uploaded
     * either way. The verdict is the throw's.
     */
    const statuses: Map<string, DiscoveredHostReverseDnsStatus> =
      reverseDnsStatuses({
        "10.0.0.1": DiscoveredHostReverseDnsStatus.NoRecord,
        "10.0.0.2": DiscoveredHostReverseDnsStatus.Timeout,
      });
    let reads: number = 0;

    statuses.get = (
      ipAddress: string,
    ): DiscoveredHostReverseDnsStatus | undefined => {
      reads++;

      if (reads > 1) {
        throw new Error("status table went away");
      }

      return Map.prototype.get.call(statuses, ipAddress) as
        | DiscoveredHostReverseDnsStatus
        | undefined;
    };

    const hosts: Array<DiscoveredHost> = [
      pingOnly("10.0.0.1"),
      pingOnly("10.0.0.2"),
    ];

    mockReverseDns({ statuses: statuses, failedAddressCount: 1 });

    const outcome: ReverseDnsNamingOutcome =
      await SubnetScanner.attachReverseDnsHostnames(hosts);

    expect(hosts[0]!.dnsHostnameStatus).toBe("no-record");
    expect(hosts[1]).not.toHaveProperty("dnsHostnameStatus");
    expect(outcome.error).toBe("status table went away");
    expect(outcome).not.toHaveProperty("failedAddressCount");
  });

  it("drops a failure count already read when the pass throws after reading it", async () => {
    /*
     * The only step after the count is the debug line. Made to throw, it
     * sends the pass down the catch with the count already on the verdict —
     * and the throw path's verdict is `error` alone, so the count goes with
     * it rather than giving the note a second explanation. The code stamped
     * before the throw stays.
     */
    jest.spyOn(logger, "debug").mockImplementation(() => {
      throw new Error("log sink went away");
    });

    const hosts: Array<DiscoveredHost> = [pingOnly("10.0.0.1")];

    mockReverseDns({
      statuses: reverseDnsStatuses({
        "10.0.0.1": DiscoveredHostReverseDnsStatus.Timeout,
      }),
      failedAddressCount: 1,
    });

    const outcome: ReverseDnsNamingOutcome =
      await SubnetScanner.attachReverseDnsHostnames(hosts);

    expect(outcome.error).toBe("log sink went away");
    expect(outcome).not.toHaveProperty("failedAddressCount");
    expect(hosts[0]!.dnsHostnameStatus).toBe("timeout");
  });
});

describe("attachNetbiosNames — a code on every host it was asked about and left unnamed", () => {
  it("stamps the reported code only on the hosts it was handed", async () => {
    /*
     * The lookup is handed only hosts SNMP and reverse DNS left unnamed. The
     * double reports codes for the others too — as a careless one would — and
     * those must not land: NetBIOS was never those hosts' business.
     */
    const hosts: Array<DiscoveredHost> = [
      snmpHost("10.0.0.1", "core-switch-01"),
      {
        ipAddress: "10.0.0.2",
        snmpReachable: false,
        dnsHostname: "printer.corp.example.com",
      },
      pingOnly("10.0.0.3"),
      pingOnly("10.0.0.4"),
    ];
    const asked: Array<Array<string>> = mockNetbios({
      names: { "10.0.0.4": "kds04" },
      statuses: netbiosStatuses({
        "10.0.0.1": DiscoveredHostNetbiosStatus.NoReply,
        "10.0.0.2": DiscoveredHostNetbiosStatus.NoReply,
        "10.0.0.3": DiscoveredHostNetbiosStatus.NoReply,
      }),
    });

    await SubnetScanner.attachNetbiosNames(hosts);

    expect(asked).toEqual([["10.0.0.3", "10.0.0.4"]]);
    expect(hosts[0]).not.toHaveProperty("netbiosNameStatus");
    expect(hosts[1]).not.toHaveProperty("netbiosNameStatus");
    expect(hosts[2]).toStrictEqual({
      ipAddress: "10.0.0.3",
      snmpReachable: false,
      netbiosNameStatus: "no-reply",
    });
    // Named by NetBIOS: a name, and no code.
    expect(hosts[3]).toStrictEqual({
      ipAddress: "10.0.0.4",
      snmpReachable: false,
      netbiosName: "kds04",
    });
  });

  it("never stamps a host it named, even when an inconsistent double also reports a code for it", async () => {
    /*
     * The NetBIOS twin of the reverse-DNS rule above: the name wins. The real
     * resolver never reports both for one address (describeUnnamedAddresses
     * skips every address it named), so only the guard in attachNetbiosNames
     * stands between an inconsistent double — or a future resolver — and a
     * named host uploaded with "NetBIOS: no reply" beside its name.
     */
    const hosts: Array<DiscoveredHost> = [pingOnly("10.0.0.4")];

    mockNetbios({
      names: { "10.0.0.4": "kds04" },
      statuses: netbiosStatuses({
        "10.0.0.4": DiscoveredHostNetbiosStatus.NoReply,
      }),
    });

    await SubnetScanner.attachNetbiosNames(hosts);

    expect(hosts[0]).toStrictEqual({
      ipAddress: "10.0.0.4",
      snmpReachable: false,
      netbiosName: "kds04",
    });
  });

  it("never stamps a host that arrived already carrying a NetBIOS name", async () => {
    /*
     * The same guard, reached the other way: a host with no sysName and no
     * PTR name is handed to the lookup whatever NetBIOS name it already
     * has, and the lookup naming nothing this time does not make it unnamed.
     */
    const hosts: Array<DiscoveredHost> = [
      { ipAddress: "10.0.0.4", snmpReachable: false, netbiosName: "OLD" },
    ];

    mockNetbios({
      statuses: netbiosStatuses({
        "10.0.0.4": DiscoveredHostNetbiosStatus.NoReply,
      }),
    });

    await SubnetScanner.attachNetbiosNames(hosts);

    expect(hosts[0]).toStrictEqual({
      ipAddress: "10.0.0.4",
      snmpReachable: false,
      netbiosName: "OLD",
    });
  });

  it("stamps a code on a host whose reported name normalises to nothing", async () => {
    /*
     * The name the double reported is not usable, so the host is still
     * unnamed — and the code the resolver gave for it is the explanation.
     */
    const hosts: Array<DiscoveredHost> = [pingOnly("10.0.0.3")];

    mockNetbios({
      names: { "10.0.0.3": "BAD NAME" },
      statuses: netbiosStatuses({
        "10.0.0.3": DiscoveredHostNetbiosStatus.NoUsableName,
      }),
    });

    await SubnetScanner.attachNetbiosNames(hosts);

    expect(hosts[0]).toStrictEqual({
      ipAddress: "10.0.0.3",
      snmpReachable: false,
      netbiosNameStatus: "no-usable-name",
    });
  });

  it("carries every NetBIOS code through unchanged", async () => {
    const codes: Array<DiscoveredHostNetbiosStatus> = Object.values(
      DiscoveredHostNetbiosStatus,
    );
    const hosts: Array<DiscoveredHost> = codes.map(
      (_code: DiscoveredHostNetbiosStatus, index: number): DiscoveredHost => {
        return pingOnly(`10.0.4.${index + 1}`);
      },
    );
    const statuses: Map<string, DiscoveredHostNetbiosStatus> = new Map<
      string,
      DiscoveredHostNetbiosStatus
    >();

    codes.forEach((code: DiscoveredHostNetbiosStatus, index: number) => {
      statuses.set(`10.0.4.${index + 1}`, code);
    });

    mockNetbios({ statuses: statuses });

    await SubnetScanner.attachNetbiosNames(hosts);

    expect(
      hosts.map((host: DiscoveredHost) => {
        return host.netbiosNameStatus;
      }),
    ).toEqual(codes);
    expect(codes.length).toBeGreaterThanOrEqual(7);
  });

  it("ignores a code that is not exactly one of the NetBIOS codes, and anything but a real Map", async () => {
    const junk: Array<unknown> = [
      "NoReply",
      "no_reply",
      " no-reply",
      "",
      7,
      null,
      // A reverse-DNS code is not a NetBIOS code.
      DiscoveredHostReverseDnsStatus.NoRecord,
      DiscoveredHostReverseDnsStatus.Timeout,
    ];
    const hosts: Array<DiscoveredHost> = junk.map(
      (_value: unknown, index: number): DiscoveredHost => {
        return pingOnly(`10.0.5.${index + 1}`);
      },
    );
    const statuses: Map<string, unknown> = new Map<string, unknown>();

    junk.forEach((value: unknown, index: number) => {
      statuses.set(`10.0.5.${index + 1}`, value);
    });

    mockNetbios({ statuses: statuses });

    await SubnetScanner.attachNetbiosNames(hosts);

    for (const host of hosts) {
      expect(host).not.toHaveProperty("netbiosNameStatus");
    }

    for (const table of [
      { "10.0.5.1": DiscoveredHostNetbiosStatus.NoReply },
      [["10.0.5.1", DiscoveredHostNetbiosStatus.NoReply]],
      "no-reply",
    ]) {
      jest.restoreAllMocks();
      installReverseDnsStub();
      silenceLogger();

      const lone: Array<DiscoveredHost> = [pingOnly("10.0.5.1")];

      mockNetbios({ statuses: table });

      await SubnetScanner.attachNetbiosNames(lone);

      expect(lone[0]).toStrictEqual(pingOnly("10.0.5.1"));
    }
  });

  it("stamps nothing when the resolution carries no status table", async () => {
    const hosts: Array<DiscoveredHost> = [pingOnly("10.0.0.3")];

    mockNetbios({});

    await SubnetScanner.attachNetbiosNames(hosts);

    expect(hosts[0]).toStrictEqual(pingOnly("10.0.0.3"));
  });

  it("stamps every unnamed entry for a repeated address", async () => {
    const hosts: Array<DiscoveredHost> = [
      pingOnly("10.0.0.7"),
      pingOnly("10.0.0.7"),
    ];

    mockNetbios({
      statuses: netbiosStatuses({
        "10.0.0.7": DiscoveredHostNetbiosStatus.SkippedHostCap,
      }),
    });

    await SubnetScanner.attachNetbiosNames(hosts);

    expect(hosts[0]!.netbiosNameStatus).toBe("skipped-host-cap");
    expect(hosts[1]!.netbiosNameStatus).toBe("skipped-host-cap");
  });

  it("asks nothing and stamps nothing when every host already has a name", async () => {
    const hosts: Array<DiscoveredHost> = [snmpHost("10.0.0.1", "sw1")];
    const asked: Array<Array<string>> = mockNetbios({
      statuses: netbiosStatuses({
        "10.0.0.1": DiscoveredHostNetbiosStatus.NoReply,
      }),
    });

    await SubnetScanner.attachNetbiosNames(hosts);

    expect(asked).toEqual([]);
    expect(hosts[0]).not.toHaveProperty("netbiosNameStatus");
  });

  it("keeps a reverse-DNS code on a host NetBIOS then named, which the dialog never shows", async () => {
    /*
     * Reverse DNS left the host unnamed and said why; NetBIOS named it
     * afterwards. The reverse-DNS code stays — it is still true — and the
     * dialog shows no hint for a named host, so nothing reads it there.
     */
    const hosts: Array<DiscoveredHost> = [pingOnly("10.0.0.3")];

    mockReverseDns({
      statuses: reverseDnsStatuses({
        "10.0.0.3": DiscoveredHostReverseDnsStatus.NoRecord,
      }),
    });
    mockNetbios({ names: { "10.0.0.3": "kds03" } });

    await SubnetScanner.attachReverseDnsHostnames(hosts);
    await SubnetScanner.attachNetbiosNames(hosts);

    expect(hosts[0]).toStrictEqual({
      ipAddress: "10.0.0.3",
      snmpReachable: false,
      dnsHostnameStatus: "no-record",
      netbiosName: "kds03",
    });
  });

  it("keeps the codes already stamped when the status table throws part-way, and resolves with the error", async () => {
    const table: Map<string, DiscoveredHostNetbiosStatus> = netbiosStatuses({
      "10.0.0.3": DiscoveredHostNetbiosStatus.NoReply,
      "10.0.0.4": DiscoveredHostNetbiosStatus.NoReply,
    });
    let reads: number = 0;

    table.get = (
      ipAddress: string,
    ): DiscoveredHostNetbiosStatus | undefined => {
      reads++;

      if (reads > 1) {
        throw new Error("status table went away");
      }

      return Map.prototype.get.call(table, ipAddress) as
        | DiscoveredHostNetbiosStatus
        | undefined;
    };

    const hosts: Array<DiscoveredHost> = [
      pingOnly("10.0.0.3"),
      pingOnly("10.0.0.4"),
    ];

    mockNetbios({ statuses: table });

    const outcome: NetbiosNamingOutcome =
      await SubnetScanner.attachNetbiosNames(hosts);

    expect(outcome.error).toBe("status table went away");
    expect(hosts[0]!.netbiosNameStatus).toBe("no-reply");
    expect(hosts[1]).not.toHaveProperty("netbiosNameStatus");
  });
});

describe("stampNetbiosStatusOnUnnamedHosts — the global-probe skip, host by host", () => {
  it("stamps exactly the hosts NetBIOS would have been asked about, and counts them", () => {
    const hosts: Array<DiscoveredHost> = [
      snmpHost("10.0.0.1", "core-switch-01"),
      {
        ipAddress: "10.0.0.2",
        snmpReachable: false,
        dnsHostname: "printer.corp.example.com",
      },
      { ipAddress: "10.0.0.3", snmpReachable: false, netbiosName: "ws3" },
      pingOnly("10.0.0.4"),
      { ipAddress: "10.0.0.5", sysName: " ", snmpReachable: true },
      { ipAddress: "10.0.0.6", snmpReachable: false, dnsHostname: "" },
    ];

    const stamped: number = SubnetScanner.stampNetbiosStatusOnUnnamedHosts(
      hosts,
      DiscoveredHostNetbiosStatus.SkippedGlobalProbe,
    );

    expect(stamped).toBe(3);
    expect(
      hosts.map((host: DiscoveredHost) => {
        return host.netbiosNameStatus;
      }),
    ).toEqual([
      undefined,
      undefined,
      undefined,
      "skipped-global-probe",
      "skipped-global-probe",
      "skipped-global-probe",
    ]);
    expect(hosts[0]).not.toHaveProperty("netbiosNameStatus");
  });

  it("leaves every other field alone, and a reverse-DNS code beside it", () => {
    const hosts: Array<DiscoveredHost> = [
      {
        ipAddress: "10.0.0.4",
        snmpReachable: false,
        dnsHostnameStatus: DiscoveredHostReverseDnsStatus.Timeout,
      },
    ];

    SubnetScanner.stampNetbiosStatusOnUnnamedHosts(
      hosts,
      DiscoveredHostNetbiosStatus.SkippedGlobalProbe,
    );

    expect(hosts[0]).toStrictEqual({
      ipAddress: "10.0.0.4",
      snmpReachable: false,
      dnsHostnameStatus: "timeout",
      netbiosNameStatus: "skipped-global-probe",
    });
  });

  it("stamps nothing for a code that is not on the whitelist", () => {
    for (const junk of [
      "skipped_global_probe",
      "",
      DiscoveredHostReverseDnsStatus.NoRecord,
      undefined,
    ]) {
      const hosts: Array<DiscoveredHost> = [pingOnly("10.0.0.4")];

      expect(
        SubnetScanner.stampNetbiosStatusOnUnnamedHosts(
          hosts,
          junk as unknown as DiscoveredHostNetbiosStatus,
        ),
      ).toBe(0);
      expect(hosts[0]).toStrictEqual(pingOnly("10.0.0.4"));
    }
  });

  it("never throws: not for a list that is not a list, holes in it, or a host it cannot write to", () => {
    for (const notAList of [undefined, null, "hosts", 42, {}]) {
      expect(
        SubnetScanner.stampNetbiosStatusOnUnnamedHosts(
          notAList as unknown as Array<DiscoveredHost>,
          DiscoveredHostNetbiosStatus.SkippedGlobalProbe,
        ),
      ).toBe(0);
    }

    const withHoles: Array<DiscoveredHost> = [
      null as unknown as DiscoveredHost,
      "10.0.0.9" as unknown as DiscoveredHost,
      pingOnly("10.0.0.4"),
    ];

    expect(
      SubnetScanner.stampNetbiosStatusOnUnnamedHosts(
        withHoles,
        DiscoveredHostNetbiosStatus.SkippedGlobalProbe,
      ),
    ).toBe(1);

    /*
     * A frozen host cannot take the key, and strict mode makes the write
     * throw. The hosts before it keep their code and are counted; the probe
     * log says what happened.
     */
    const frozen: Array<DiscoveredHost> = [
      pingOnly("10.0.0.1"),
      Object.freeze(pingOnly("10.0.0.2")),
      pingOnly("10.0.0.3"),
    ];

    expect(
      SubnetScanner.stampNetbiosStatusOnUnnamedHosts(
        frozen,
        DiscoveredHostNetbiosStatus.SkippedGlobalProbe,
      ),
    ).toBe(1);
    expect(frozen[0]!.netbiosNameStatus).toBe("skipped-global-probe");
    expect(frozen[1]).not.toHaveProperty("netbiosNameStatus");
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("countUnnamedHostsWhoseReverseDnsFailed — the hosts the failure sentence points at", () => {
  /*
   * OneUptime issue #3916. The status message's "Reverse DNS lookups failed
   * for N of M hosts; hover the (i) beside an unnamed host" counts exactly the
   * hosts that END the naming with no name from any source and a code saying
   * their lookup FAILED — the hosts with an (i) that says so. scanWithDeadline
   * narrows the pass's own count to this once NetBIOS has run; the runScan
   * side is pinned in FetchScansNamingStatus.test.ts.
   */
  const FAILED_CODES: Array<DiscoveredHostReverseDnsStatus> = [
    DiscoveredHostReverseDnsStatus.Timeout,
    DiscoveredHostReverseDnsStatus.ServerFailure,
    DiscoveredHostReverseDnsStatus.Refused,
    DiscoveredHostReverseDnsStatus.Unreachable,
    DiscoveredHostReverseDnsStatus.Failed,
  ];

  function withReverseDnsStatus(
    host: DiscoveredHost,
    status: unknown,
  ): DiscoveredHost {
    return {
      ...host,
      dnsHostnameStatus: status as DiscoveredHostReverseDnsStatus,
    };
  }

  it("counts an unnamed host for every code that means the lookup failed, and for no other code", () => {
    const failed: Array<DiscoveredHost> = FAILED_CODES.map(
      (code: DiscoveredHostReverseDnsStatus, index: number): DiscoveredHost => {
        return withReverseDnsStatus(pingOnly(`10.0.1.${index + 1}`), code);
      },
    );

    expect(SubnetScanner.countUnnamedHostsWhoseReverseDnsFailed(failed)).toBe(
      5,
    );

    // The DNS server ANSWERED for these, or the pass never asked: no failure.
    const notFailed: Array<DiscoveredHost> = Object.values(
      DiscoveredHostReverseDnsStatus,
    )
      .filter((code: DiscoveredHostReverseDnsStatus) => {
        return !FAILED_CODES.includes(code);
      })
      .map(
        (
          code: DiscoveredHostReverseDnsStatus,
          index: number,
        ): DiscoveredHost => {
          return withReverseDnsStatus(pingOnly(`10.0.2.${index + 1}`), code);
        },
      );

    expect(notFailed.length).toBe(4);
    expect(
      SubnetScanner.countUnnamedHostsWhoseReverseDnsFailed(notFailed),
    ).toBe(0);
  });

  it("does not count a failed lookup on a host named by its sysName, its PTR record or NetBIOS", () => {
    const hosts: Array<DiscoveredHost> = [
      withReverseDnsStatus(snmpHost("10.0.0.1", "core-switch-01"), "timeout"),
      withReverseDnsStatus(
        {
          ipAddress: "10.0.0.2",
          snmpReachable: false,
          dnsHostname: "printer.corp.example.com",
        },
        "timeout",
      ),
      withReverseDnsStatus(
        { ipAddress: "10.0.0.3", snmpReachable: false, netbiosName: "kds03" },
        "server-failure",
      ),
      withReverseDnsStatus(pingOnly("10.0.0.4"), "refused"),
      // Blank names are no names: these two are unnamed, and counted.
      withReverseDnsStatus(
        { ipAddress: "10.0.0.5", sysName: " ", snmpReachable: true },
        "timeout",
      ),
      withReverseDnsStatus(
        { ipAddress: "10.0.0.6", snmpReachable: false, netbiosName: "" },
        "unreachable",
      ),
    ];

    expect(SubnetScanner.countUnnamedHostsWhoseReverseDnsFailed(hosts)).toBe(3);
  });

  it("counts a repeated address once, and a host with no code, or a junk one, not at all", () => {
    const hosts: Array<DiscoveredHost> = [
      withReverseDnsStatus(pingOnly("10.0.0.7"), "timeout"),
      withReverseDnsStatus(pingOnly("10.0.0.7"), "timeout"),
      pingOnly("10.0.0.8"),
      withReverseDnsStatus(pingOnly("10.0.0.9"), "Timeout"),
      withReverseDnsStatus(pingOnly("10.0.0.10"), " timeout"),
      withReverseDnsStatus(pingOnly("10.0.0.11"), 7),
      // A NetBIOS code is not a reverse-DNS code.
      withReverseDnsStatus(
        pingOnly("10.0.0.12"),
        DiscoveredHostNetbiosStatus.SendFailed,
      ),
    ];

    expect(SubnetScanner.countUnnamedHostsWhoseReverseDnsFailed(hosts)).toBe(1);
  });

  it("never throws: a list that is not one counts nothing, holes are skipped, and a host that throws keeps the count so far", () => {
    for (const notAList of [undefined, null, "10.0.0.1", 7, {}]) {
      expect(
        SubnetScanner.countUnnamedHostsWhoseReverseDnsFailed(
          notAList as unknown as Array<DiscoveredHost>,
        ),
      ).toBe(0);
    }

    expect(
      SubnetScanner.countUnnamedHostsWhoseReverseDnsFailed([
        null as unknown as DiscoveredHost,
        "10.0.0.9" as unknown as DiscoveredHost,
        withReverseDnsStatus(pingOnly("10.0.0.4"), "timeout"),
      ]),
    ).toBe(1);

    const exploding: DiscoveredHost = pingOnly("10.0.0.2");

    Object.defineProperty(exploding, "dnsHostnameStatus", {
      get: (): never => {
        throw new Error("host went away");
      },
    });

    expect(
      SubnetScanner.countUnnamedHostsWhoseReverseDnsFailed([
        withReverseDnsStatus(pingOnly("10.0.0.1"), "timeout"),
        exploding,
        withReverseDnsStatus(pingOnly("10.0.0.3"), "timeout"),
      ]),
    ).toBe(1);
    expect(logger.warn).toHaveBeenCalled();
  });
});
