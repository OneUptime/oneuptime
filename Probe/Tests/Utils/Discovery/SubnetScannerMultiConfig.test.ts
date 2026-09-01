// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import SubnetScanner, {
  DiscoveredHost,
  SubnetScanConfig,
  SubnetScanResult,
  SubnetScanSnmpConfig,
} from "../../../Utils/Discovery/SubnetScanner";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpSystemInfo from "Common/Types/Monitor/SnmpMonitor/SnmpSystemInfo";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpV3Auth from "Common/Types/Monitor/SnmpMonitor/SnmpV3Auth";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

import { stubReverseDnsAsResolvingNothing } from "../../TestingUtils/StubReverseDns";

/*
 * A discovery scan carries an ORDERED LIST of SNMP credential sets, not one.
 *
 * Every estate of any size is mixed: the core switches on one v3 user, the
 * edge stack still on a v2c community, a vendor appliance on a third. Before
 * the list, discovering that estate meant running one scan per credential and
 * reconciling the results by hand — and a host that answered none of them was
 * indistinguishable from a host that answered the wrong one.
 *
 * The rules this file pins:
 *
 *   - Per host, the configs are tried IN SERIES and the sweep stops at the
 *     FIRST that answers. Firing them all in parallel would put a failed
 *     authentication on the wire against every real device for every
 *     credential the scan carries, which locks v3 users out on kit that
 *     counts failures.
 *   - The winning config's id is stamped on the discovered host, because the
 *     import path has to build the device with the credentials that ACTUALLY
 *     work for it rather than with the scan's first set.
 *   - Failures are accounted PER HOST, not per attempt: a single
 *     mis-credentialed device must not make a subnet look three times worse
 *     just because the scan carries three credentials.
 *   - The ORDER adapts: whichever configs have answered most so far are tried
 *     first, so a badly-ordered list costs one extra pass rather than N
 *     timeouts on every host.
 */

const V3_AUTH: SnmpV3Auth = {
  securityLevel: SnmpSecurityLevel.AuthPriv,
  username: "monitoring-v3",
  authProtocol: SnmpAuthProtocol.SHA256,
  authKey: "auth-passphrase",
  privProtocol: SnmpPrivProtocol.AES,
  privKey: "priv-passphrase",
};

/*
 * Three credential sets in declared order. They are told apart at the SNMP
 * layer by their community strings — which is also how a real agent tells
 * them apart — because MonitorStepSnmpMonitor carries no config id: the
 * scanner's job is to hand the layer a plain session config, and the id
 * exists only on the discovery side of the boundary.
 */
const CONFIG_A: SubnetScanSnmpConfig = {
  id: "config-a",
  label: "Config 1 (SNMP v2c, port 161)",
  snmpVersion: SnmpVersion.V2c,
  communityString: "community-a",
  port: 161,
};

const CONFIG_B: SubnetScanSnmpConfig = {
  id: "config-b",
  label: "Config 2 (SNMP v2c, port 161)",
  snmpVersion: SnmpVersion.V2c,
  communityString: "community-b",
  port: 161,
};

const CONFIG_C: SubnetScanSnmpConfig = {
  id: "config-c",
  label: "Config 3 (SNMP v2c, port 161)",
  snmpVersion: SnmpVersion.V2c,
  communityString: "community-c",
  port: 161,
};

const ALL_THREE: Array<SubnetScanSnmpConfig> = [CONFIG_A, CONFIG_B, CONFIG_C];

// A /29 sweeps six hosts: 10.0.0.1 .. 10.0.0.6.
const SIX_HOSTS: string = "10.0.0.0/29";

interface ProbeAttempt {
  host: string;
  configId: string;
  probeConfig: MonitorStepSnmpMonitor;
}

interface SnmpLayerBehaviour {
  /*
   * The system group this (host, config) pair answers with, or null for a
   * pair that stays silent.
   */
  respond?:
    | ((host: string, configId: string) => SnmpSystemInfo | null)
    | undefined;
  /*
   * The error message this (host, config) pair reports through the probe's
   * onError callback, or null for a pair that reports nothing.
   */
  fail?: ((host: string, configId: string) => string | null) | undefined;
}

function configIdFor(
  configs: Array<SubnetScanSnmpConfig>,
  probeConfig: MonitorStepSnmpMonitor,
): string {
  const match: SubnetScanSnmpConfig | undefined = configs.find(
    (config: SubnetScanSnmpConfig): boolean => {
      return config.communityString === probeConfig.communityString;
    },
  );

  /*
   * A probe carrying a community string no config declared would mean the
   * scanner invented a credential, so it is surfaced as an id no assertion
   * expects rather than quietly attributed to one of the real configs.
   */
  return match?.id || "unattributable-config";
}

function mockSnmpLayer(
  configs: Array<SubnetScanSnmpConfig>,
  behaviour: SnmpLayerBehaviour = {},
): Array<ProbeAttempt> {
  const attempts: Array<ProbeAttempt> = [];

  jest
    .spyOn(SnmpMonitor, "probeSystemInfo")
    .mockImplementation(
      async (
        probeConfig: MonitorStepSnmpMonitor,
        onError?: ((error: unknown) => void) | undefined,
      ) => {
        const host: string = probeConfig.hostname || "";
        const configId: string = configIdFor(configs, probeConfig);

        attempts.push({
          host: host,
          configId: configId,
          probeConfig: probeConfig,
        });

        const systemInfo: SnmpSystemInfo | null = behaviour.respond
          ? behaviour.respond(host, configId)
          : null;

        if (systemInfo) {
          return systemInfo;
        }

        const failure: string | null = behaviour.fail
          ? behaviour.fail(host, configId)
          : null;

        if (failure) {
          onError?.(new Error(failure));
        }

        return null;
      },
    );

  return attempts;
}

function mockPingAlive(aliveHosts: Array<string> | "all"): void {
  jest
    .spyOn(SubnetScanner, "isHostAliveByPing")
    .mockImplementation(async (host: string) => {
      return aliveHosts === "all" || aliveHosts.includes(host);
    });
}

function configIdsTriedFor(
  attempts: Array<ProbeAttempt>,
  host: string,
): Array<string> {
  return attempts
    .filter((attempt: ProbeAttempt): boolean => {
      return attempt.host === host;
    })
    .map((attempt: ProbeAttempt): string => {
      return attempt.configId;
    });
}

function hostAt(result: SubnetScanResult, ipAddress: string): DiscoveredHost {
  const host: DiscoveredHost | undefined = result.discoveredHosts.find(
    (discovered: DiscoveredHost): boolean => {
      return discovered.ipAddress === ipAddress;
    },
  );

  if (!host) {
    throw new Error(`Expected ${ipAddress} to have been discovered`);
  }

  return host;
}

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * Reverse DNS (issue #3529) is the sweep's third network seam, alongside ICMP
 * and SNMP, and is stubbed out for this whole file for the same reason those
 * are: nothing here is about naming, and a unit test must not ask the
 * machine's real resolver about 10.0.0.0/8. Hosts therefore come back with no
 * dnsHostname, exactly as they did before the feature existed.
 */
stubReverseDnsAsResolvingNothing();

describe("SubnetScanner multi-config sweep — the first config that answers wins", () => {
  /*
   * Serial-until-success is the whole contract. A host that answers the
   * second of three credentials must cost two attempts, not three, and must
   * never be offered the third — that third attempt would be a failed
   * authentication against a device that has already identified itself.
   */
  it("stops at the first config that answers and never tries the ones declared after it", async () => {
    mockPingAlive("all");
    const attempts: Array<ProbeAttempt> = mockSnmpLayer(ALL_THREE, {
      respond: (_host: string, configId: string): SnmpSystemInfo | null => {
        return configId === CONFIG_B.id ? { sysName: "edge-sw1" } : null;
      },
    });

    await SubnetScanner.scan({
      cidr: "10.0.0.5",
      snmpConfigs: ALL_THREE,
    });

    expect(configIdsTriedFor(attempts, "10.0.0.5")).toEqual([
      CONFIG_A.id,
      CONFIG_B.id,
    ]);
  });

  it("discovers the host exactly once and stamps it with the id of the config that answered", async () => {
    mockPingAlive("all");
    mockSnmpLayer(ALL_THREE, {
      respond: (_host: string, configId: string): SnmpSystemInfo | null => {
        return configId === CONFIG_B.id
          ? { sysName: "edge-sw1", sysDescr: "Cisco IOS" }
          : null;
      },
    });

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: "10.0.0.5",
      snmpConfigs: ALL_THREE,
    });

    /*
     * One row, not one per config tried. The id is what the import path reads
     * back through SnmpScanConfigUtil.resolveForHost to build the device with
     * working credentials.
     */
    expect(result.discoveredHosts).toEqual([
      {
        ipAddress: "10.0.0.5",
        sysName: "edge-sw1",
        sysDescr: "Cisco IOS",
        snmpReachable: true,
        snmpConfigId: CONFIG_B.id,
      },
    ]);
    expect(result.responderCountByConfigId).toEqual({
      [CONFIG_A.id]: 0,
      [CONFIG_B.id]: 1,
      [CONFIG_C.id]: 0,
    });
  });
});

describe("SubnetScanner multi-config sweep — one subnet, several credentials", () => {
  /*
   * The estate this feature exists for: the core switches on one credential,
   * an appliance on another, and unmanaged gear on none of them. All three
   * outcomes have to come out of a SINGLE sweep, each host carrying the
   * credential that actually worked for it.
   */
  it("matches each host with the config that answers it and splits the responder counts accordingly", async () => {
    mockPingAlive("all");
    mockSnmpLayer(ALL_THREE, {
      respond: (host: string, configId: string): SnmpSystemInfo | null => {
        if (
          configId === CONFIG_A.id &&
          ["10.0.0.1", "10.0.0.2"].includes(host)
        ) {
          return { sysName: `core-${host}` };
        }

        if (configId === CONFIG_C.id && host === "10.0.0.3") {
          return { sysName: `appliance-${host}` };
        }

        return null;
      },
    });

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      snmpConfigs: ALL_THREE,
    });

    expect(hostAt(result, "10.0.0.1").snmpConfigId).toBe(CONFIG_A.id);
    expect(hostAt(result, "10.0.0.2").snmpConfigId).toBe(CONFIG_A.id);
    expect(hostAt(result, "10.0.0.3").snmpConfigId).toBe(CONFIG_C.id);

    /*
     * The split is what the scan's status message reports back to the
     * operator as "Answered by credentials: ... on N", so it has to reflect
     * the real division rather than a total.
     */
    expect(result.responderCountByConfigId).toEqual({
      [CONFIG_A.id]: 2,
      [CONFIG_B.id]: 0,
      [CONFIG_C.id]: 1,
    });
  });

  it("records a host that no config answered as ping-only, with no config id at all", async () => {
    mockPingAlive(["10.0.0.1", "10.0.0.2"]);
    mockSnmpLayer(ALL_THREE, {
      respond: (host: string, configId: string): SnmpSystemInfo | null => {
        return configId === CONFIG_B.id && host === "10.0.0.1"
          ? { sysName: "sw1" }
          : null;
      },
    });

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      snmpConfigs: ALL_THREE,
    });

    /*
     * 10.0.0.2 answered ICMP and nothing else. Stamping it with a config id
     * would tell the import path to build the device with credentials that
     * were never shown to work for it, so the field must be absent — not the
     * id of the last config tried, and not the first in the list.
     */
    expect(result.discoveredHosts).toEqual([
      {
        ipAddress: "10.0.0.1",
        sysName: "sw1",
        snmpReachable: true,
        snmpConfigId: CONFIG_B.id,
      },
      { ipAddress: "10.0.0.2", snmpReachable: false },
    ]);
    expect(hostAt(result, "10.0.0.2").snmpConfigId).toBeUndefined();
  });

  it("does not record a host that no config answered when ICMP never saw it either", async () => {
    mockPingAlive(["10.0.0.1"]);
    mockSnmpLayer(ALL_THREE, {
      respond: (host: string, configId: string): SnmpSystemInfo | null => {
        return configId === CONFIG_B.id && host === "10.0.0.1"
          ? { sysName: "sw1" }
          : null;
      },
    });

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      snmpConfigs: ALL_THREE,
    });

    /*
     * Without an ICMP reply there is no evidence anything is at the address,
     * and "none of our three credentials answered" is not evidence either —
     * recording those would turn every dead address into a phantom endpoint,
     * multiplied by however many credentials the scan carries.
     */
    expect(
      result.discoveredHosts.map((host: DiscoveredHost): string => {
        return host.ipAddress;
      }),
    ).toEqual(["10.0.0.1"]);
  });
});

/*
 * Error accounting is the number the operator reads as "how much of this
 * subnet is mis-credentialed", so it has to be a count of HOSTS.
 *
 * With three configs, a single device that rejects all of them produces three
 * failures. Counting attempts would report that one device as three, and the
 * "most common error" histogram would give its message three votes — enough
 * for one badly-credentialed host to outvote two genuinely different ones and
 * point the operator at the wrong problem.
 */
describe("SubnetScanner multi-config sweep — errors are counted per host", () => {
  it("counts a host that failed every config with the same message once, not once per config", async () => {
    mockPingAlive("all");
    const attempts: Array<ProbeAttempt> = mockSnmpLayer(ALL_THREE, {
      fail: (host: string, configId: string): string | null => {
        if (host === "10.0.0.1") {
          /*
           * ONE mis-credentialed device that rejects all three credentials:
           * three failed attempts carrying the same message, and worth
           * exactly one error host and one vote.
           */
          return "Authentication failure";
        }

        if (["10.0.0.2", "10.0.0.3"].includes(host)) {
          // Two devices, one refusal each — genuinely the wider problem.
          return configId === CONFIG_B.id
            ? "Unknown user name"
            : "Request timed out";
        }

        return "Request timed out";
      },
    });

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      snmpConfigs: ALL_THREE,
    });

    // The host really was offered all three credentials.
    expect(configIdsTriedFor(attempts, "10.0.0.1")).toEqual([
      CONFIG_A.id,
      CONFIG_B.id,
      CONFIG_C.id,
    ]);

    /*
     * Three hosts failed, across five non-timeout attempts (3 + 1 + 1). A
     * count of 5 would be the per-attempt reading, and would report a subnet
     * as nearly twice as broken as it is.
     */
    expect(result.snmpErrorHostCount).toBe(3);

    /*
     * The discriminator. Per-host: "Unknown user name" 2, "Authentication
     * failure" 1 — two devices beat one. Per-attempt: "Authentication
     * failure" 3, "Unknown user name" 2 — the single mis-credentialed device
     * outvotes both real ones purely because the scan happens to carry three
     * credentials, and the operator is pointed at the wrong problem.
     */
    expect(result.mostCommonSnmpError).toBe("Unknown user name");
  });

  it("gives each of one host's distinct errors a single vote while still counting the host once", async () => {
    /*
     * 10.0.0.1 fails config-a with one message, config-b with another, and
     * times out on config-c. Its two distinct messages each get exactly one
     * vote, so the single vote cast by the witness host decides the
     * histogram 2-1 — run mirrored, because a scan that recorded only the
     * first (or only the last) of a host's errors would still win one of the
     * two halves and look correct.
     */
    const runWithWitnessError: (
      witnessMessage: string,
    ) => Promise<SubnetScanResult> = async (
      witnessMessage: string,
    ): Promise<SubnetScanResult> => {
      mockPingAlive("all");
      mockSnmpLayer(ALL_THREE, {
        fail: (host: string, configId: string): string | null => {
          if (host === "10.0.0.2") {
            /*
             * The witness casts exactly ONE vote — a single non-timeout
             * failure — so the arithmetic stays 2-1 rather than depending on
             * how many attempts a host is allowed to contribute.
             */
            return configId === CONFIG_A.id
              ? witnessMessage
              : "Request timed out";
          }

          if (configId === CONFIG_A.id) {
            return "Authentication failure";
          }

          if (configId === CONFIG_B.id) {
            return "Unknown user name";
          }

          return "Request timed out";
        },
      });

      const result: SubnetScanResult = await SubnetScanner.scan({
        cidr: "10.0.0.1-2",
        snmpConfigs: ALL_THREE,
      });

      jest.restoreAllMocks();

      return result;
    };

    const authWitness: SubnetScanResult = await runWithWitnessError(
      "Authentication failure",
    );
    // Two failing hosts: the one with two distinct errors, and the witness.
    expect(authWitness.snmpErrorHostCount).toBe(2);
    expect(authWitness.mostCommonSnmpError).toBe("Authentication failure");

    const userWitness: SubnetScanResult =
      await runWithWitnessError("Unknown user name");
    expect(userWitness.snmpErrorHostCount).toBe(2);
    expect(userWitness.mostCommonSnmpError).toBe("Unknown user name");
  });

  it("ignores timeouts entirely, however many configs time out on a host", async () => {
    mockPingAlive("all");
    mockSnmpLayer(ALL_THREE, {
      fail: (): string | null => {
        return "Request timed out";
      },
    });

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      snmpConfigs: ALL_THREE,
    });

    /*
     * An empty address answers nothing to every credential in the list. That
     * is the ordinary shape of a subnet sweep, not a diagnosis, and counting
     * it would drown the errors that are.
     */
    expect(result.snmpErrorHostCount).toBe(0);
    expect(result.mostCommonSnmpError).toBeUndefined();
  });

  it("counts a host whose configs mostly timed out but one of which was refused", async () => {
    mockPingAlive("all");
    mockSnmpLayer(ALL_THREE, {
      fail: (_host: string, configId: string): string | null => {
        return configId === CONFIG_B.id
          ? "Authentication failure"
          : "Request timed out";
      },
    });

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: "10.0.0.5",
      snmpConfigs: ALL_THREE,
    });

    /*
     * One credential got far enough to be refused — the host is running an
     * agent and the scan's credentials are wrong for it, which is a different
     * fix from "nothing is there" and must survive the two timeouts around it.
     */
    expect(result.snmpErrorHostCount).toBe(1);
    expect(result.mostCommonSnmpError).toBe("Authentication failure");
  });
});

describe("SubnetScanner multi-config sweep — the ports it reports", () => {
  it("reports the distinct ports across all configs, in ascending numeric order", async () => {
    const configs: Array<SubnetScanSnmpConfig> = [
      { ...CONFIG_A, port: 1161 },
      { ...CONFIG_B, port: 161 },
      { ...CONFIG_C, port: 10161 },
    ];

    mockPingAlive("all");
    mockSnmpLayer(configs);

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: "10.0.0.5",
      snmpConfigs: configs,
    });

    /*
     * Numeric, not lexicographic: a string sort would report
     * ["10161", "161", "1161"] and the summary would name the ports in an
     * order no operator would recognise.
     */
    expect(result.scannedPorts).toEqual([161, 1161, 10161]);
  });

  it("reports one port once when every config shares it", async () => {
    mockPingAlive("all");
    mockSnmpLayer(ALL_THREE);

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: "10.0.0.5",
      snmpConfigs: ALL_THREE,
    });

    /*
     * The overwhelmingly common case. "port 161" is what the summary should
     * say — not "ports 161, 161, 161".
     */
    expect(result.scannedPorts).toEqual([161]);
  });
});

describe("SubnetScanner multi-config sweep — the per-config responder counts", () => {
  it("keeps a zero entry for a config that answered nobody", async () => {
    mockPingAlive("all");
    mockSnmpLayer(ALL_THREE, {
      respond: (_host: string, configId: string): SnmpSystemInfo | null => {
        return configId === CONFIG_A.id ? { sysName: "sw" } : null;
      },
    });

    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: SIX_HOSTS,
      snmpConfigs: ALL_THREE,
    });

    /*
     * "This credential found nobody" is precisely what the operator needs
     * told — it is how a typo in the third community string becomes visible
     * — so the entry must be present and zero, never absent.
     */
    expect(Object.keys(result.responderCountByConfigId).sort()).toEqual([
      CONFIG_A.id,
      CONFIG_B.id,
      CONFIG_C.id,
    ]);
    expect(result.responderCountByConfigId[CONFIG_B.id]).toBe(0);
    expect(result.responderCountByConfigId[CONFIG_C.id]).toBe(0);
    expect(result.responderCountByConfigId[CONFIG_A.id]).toBe(6);
  });
});

describe("SubnetScanner.scan with no SNMP config at all", () => {
  it("refuses to sweep and tells the operator to add a config, rather than inventing one", async () => {
    mockPingAlive("all");
    const attempts: Array<ProbeAttempt> = mockSnmpLayer(ALL_THREE);

    const emptyScan: SubnetScanConfig = {
      cidr: SIX_HOSTS,
      snmpConfigs: [],
    };

    /*
     * Refused, not defaulted. Sweeping with an invented credential (a "public"
     * community nobody configured) would report the subnet as empty on the
     * strength of a guess, and the caller always resolves at least one config
     * from the scan row — so reaching this state means the row is broken in a
     * way the operator has to be told about.
     */
    await expect(SubnetScanner.scan(emptyScan)).rejects.toThrow(
      /add at least one SNMP config/i,
    );

    // And nothing was put on the wire on the way to that rejection.
    expect(attempts).toHaveLength(0);
  });
});

/*
 * The adaptive ordering, tested directly because it is the one piece of the
 * multi-credential sweep whose behaviour is not obvious from its call site,
 * and because the sweep calls it once per host from 32 concurrent workers —
 * anything stateful or mutating in here would make the sweep order depend on
 * scheduling.
 */
describe("SubnetScanner.orderConfigsBySuccess", () => {
  it("preserves the operator's declared order when nothing has answered yet", () => {
    const ordered: Array<SubnetScanSnmpConfig> =
      SubnetScanner.orderConfigsBySuccess(ALL_THREE, new Map<string, number>());

    expect(
      ordered.map((config: SubnetScanSnmpConfig): string => {
        return config.id;
      }),
    ).toEqual([CONFIG_A.id, CONFIG_B.id, CONFIG_C.id]);
  });

  it("puts the config that has answered most first", () => {
    const ordered: Array<SubnetScanSnmpConfig> =
      SubnetScanner.orderConfigsBySuccess(
        ALL_THREE,
        new Map<string, number>([
          [CONFIG_A.id, 1],
          [CONFIG_B.id, 0],
          [CONFIG_C.id, 9],
        ]),
      );

    expect(
      ordered.map((config: SubnetScanSnmpConfig): string => {
        return config.id;
      }),
    ).toEqual([CONFIG_C.id, CONFIG_A.id, CONFIG_B.id]);
  });

  it("breaks a tie on the declared order rather than on anything incidental", () => {
    /*
     * Two configs can legitimately share a label, and a sort that fell back
     * to one would reorder equally-successful credentials arbitrarily between
     * hosts — making the sweep's behaviour depend on data that means nothing.
     */
    const ordered: Array<SubnetScanSnmpConfig> =
      SubnetScanner.orderConfigsBySuccess(
        ALL_THREE,
        new Map<string, number>([
          [CONFIG_A.id, 4],
          [CONFIG_B.id, 4],
          [CONFIG_C.id, 4],
        ]),
      );

    expect(
      ordered.map((config: SubnetScanSnmpConfig): string => {
        return config.id;
      }),
    ).toEqual([CONFIG_A.id, CONFIG_B.id, CONFIG_C.id]);
  });

  it("treats a config the success map has never heard of as zero", () => {
    /*
     * The map is seeded with every config, but it is also read by 32 workers
     * while it is being written: a missing key has to mean "has not answered
     * yet", not NaN — which would poison the comparator and scramble the
     * order for every host after it.
     */
    const ordered: Array<SubnetScanSnmpConfig> =
      SubnetScanner.orderConfigsBySuccess(
        ALL_THREE,
        new Map<string, number>([[CONFIG_C.id, 2]]),
      );

    expect(
      ordered.map((config: SubnetScanSnmpConfig): string => {
        return config.id;
      }),
    ).toEqual([CONFIG_C.id, CONFIG_A.id, CONFIG_B.id]);
  });

  it("does not mutate the list it was given", () => {
    const declared: Array<SubnetScanSnmpConfig> = [
      CONFIG_A,
      CONFIG_B,
      CONFIG_C,
    ];

    const ordered: Array<SubnetScanSnmpConfig> =
      SubnetScanner.orderConfigsBySuccess(
        declared,
        new Map<string, number>([[CONFIG_C.id, 7]]),
      );

    /*
     * The caller's array is the scan's own config list, read once per host by
     * 32 concurrent workers. Sorting it in place would rewrite the operator's
     * declared order for the rest of the sweep — and with it the tie-break
     * every subsequent ordering depends on.
     */
    expect(declared).toEqual([CONFIG_A, CONFIG_B, CONFIG_C]);
    expect(ordered).not.toBe(declared);
    expect(ordered[0]).toBe(CONFIG_C);
  });
});

describe("SubnetScanner multi-config sweep — the ordering adapts as the sweep learns", () => {
  /*
   * The cost this exists to avoid: with the winning credential declared LAST,
   * a fixed order pays a full timeout for every losing credential on every
   * host — three attempts per host across a /25 instead of roughly one.
   *
   * The first wave of workers all start before anything has answered, so they
   * pay the full price; every host after that is tried with the credential
   * that has been working, first.
   */
  it("tries later hosts with the credential that has been answering, first", async () => {
    mockPingAlive("all");
    const attempts: Array<ProbeAttempt> = mockSnmpLayer(ALL_THREE, {
      respond: (host: string, configId: string): SnmpSystemInfo | null => {
        return configId === CONFIG_C.id ? { sysName: `device-${host}` } : null;
      },
    });

    // A /25 sweeps 126 hosts: 10.0.0.1 .. 10.0.0.126.
    const hostCount: number = 126;
    const result: SubnetScanResult = await SubnetScanner.scan({
      cidr: "10.0.0.0/25",
      snmpConfigs: ALL_THREE,
    });

    expect(result.discoveredHosts).toHaveLength(hostCount);
    expect(result.responderCountByConfigId[CONFIG_C.id]).toBe(hostCount);

    /*
     * Every host still costs at least one attempt, and a fixed declared order
     * would cost every host all three. The adaptive order collapses that to
     * roughly one attempt for everything after the opening wave: 190 attempts
     * against a worst case of 378, i.e. the 32 concurrent workers that all
     * started before anything had answered, plus one attempt each for the
     * remaining 94 hosts.
     *
     * Asserted as a fraction rather than as 190 exactly, because the exact
     * number is a function of the wave size and would turn a concurrency tweak
     * into a spurious failure. What must not change is the shape: far below
     * hosts x configs, and never below one attempt per host.
     */
    const worstCase: number = hostCount * ALL_THREE.length;
    expect(attempts.length).toBeGreaterThanOrEqual(hostCount);
    expect(attempts.length).toBeLessThan(worstCase * 0.6);

    // The very last address in the sweep is offered the winner immediately.
    expect(configIdsTriedFor(attempts, "10.0.0.126")).toEqual([CONFIG_C.id]);
  });
});

describe("SubnetScanner multi-config sweep — each config's own credentials reach the SNMP layer", () => {
  it("hands the SNMP layer a v3 session for the v3 config and a community session for the v2c one", async () => {
    const v3Config: SubnetScanSnmpConfig = {
      id: "config-v3",
      label: "Config 1 (SNMP v3, port 1161)",
      snmpVersion: SnmpVersion.V3,
      communityString: "community-unused-by-v3",
      snmpV3Auth: V3_AUTH,
      port: 1161,
    };

    const v2cConfig: SubnetScanSnmpConfig = {
      id: "config-v2c",
      label: "Config 2 (SNMP v2c, port 161)",
      snmpVersion: SnmpVersion.V2c,
      communityString: "private",
      port: 161,
    };

    mockPingAlive("all");
    // Nothing answers, so BOTH configs are tried against the single host.
    const attempts: Array<ProbeAttempt> = mockSnmpLayer([v3Config, v2cConfig]);

    await SubnetScanner.scan({
      cidr: "10.0.0.5",
      snmpConfigs: [v3Config, v2cConfig],
    });

    expect(attempts).toHaveLength(2);

    /*
     * Per-config, not per-scan. Flattening the credentials onto the sweep —
     * the shape this replaced — is what made a mixed estate impossible: one
     * v3 auth object was applied to every probe, so the v2c gear was polled
     * with a v3 session it could not answer, and vice versa.
     */
    const v3Probe: MonitorStepSnmpMonitor = attempts[0]!.probeConfig;
    expect(attempts[0]!.configId).toBe(v3Config.id);
    expect(v3Probe.snmpVersion).toBe(SnmpVersion.V3);
    expect(v3Probe.snmpV3Auth).toEqual(V3_AUTH);
    expect(v3Probe.port).toBe(1161);

    const v2cProbe: MonitorStepSnmpMonitor = attempts[1]!.probeConfig;
    expect(attempts[1]!.configId).toBe(v2cConfig.id);
    expect(v2cProbe.snmpVersion).toBe(SnmpVersion.V2c);
    // No v3 material leaks onto the v2c session.
    expect(v2cProbe.snmpV3Auth).toBeUndefined();
    expect(v2cProbe.communityString).toBe("private");
    expect(v2cProbe.port).toBe(161);
  });

  it("uses each config's own community string, so a per-config typo is visible", async () => {
    mockPingAlive("all");
    const attempts: Array<ProbeAttempt> = mockSnmpLayer(ALL_THREE);

    await SubnetScanner.scan({
      cidr: "10.0.0.5",
      snmpConfigs: ALL_THREE,
    });

    expect(
      attempts.map((attempt: ProbeAttempt): string | undefined => {
        return attempt.probeConfig.communityString;
      }),
    ).toEqual([
      CONFIG_A.communityString,
      CONFIG_B.communityString,
      CONFIG_C.communityString,
    ]);
  });
});
