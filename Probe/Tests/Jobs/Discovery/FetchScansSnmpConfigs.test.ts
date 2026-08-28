// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import {
  DiscoveryScanSnmpConfig,
  LEGACY_SNMP_CONFIG_ID,
} from "Common/Utils/NetworkDiscovery/SnmpScanConfigUtil";
import SubnetScanner, {
  SubnetScanResult,
  SubnetScanSnmpConfig,
} from "../../../Utils/Discovery/SubnetScanner";
import {
  buildProbeSnmpConfigs,
  buildScanStatusMessage,
  buildSnmpV3Auth,
  runScan,
} from "../../../Jobs/Discovery/FetchScans";

/*
 * A discovery scan carries an ORDERED LIST of SNMP credential sets, and the
 * sweep tries them per host until one answers (OneUptime issue #3458).
 *
 * This file pins the seam between the two spellings of that list:
 *
 *   - what the SERVER stores — a jsonb array of loose, free-text fields, plus
 *     the nine flattened columns every scan written before this feature is
 *     still described by, and
 *   - what the PROBE sweeps with — parsed enum values, a resolved community
 *     string, an assembled v3 credential block and a non-secret label.
 *
 * Everything that can go wrong at that seam goes wrong SILENTLY, which is why
 * each conversion is asserted rather than sampled:
 *
 *   - a version left as the stored spelling ("V3") is not === SnmpVersion.V3
 *     ("3"), so a v3 session downgrades to v2c and the credentials go out in
 *     cleartext against a device that then refuses them;
 *   - a config whose protocol cannot be read would otherwise be blanked and
 *     sweep as v1/v2c, host after host, while the OTHER configs kept
 *     answering — a partial result nobody can tell from a complete one;
 *   - a label that leaked a community string would put it in statusMessage,
 *     which roles deliberately denied the credential columns can read.
 */

const scanId: ObjectID = ObjectID.generate();

/*
 * Real-looking secrets, held in constants so the "this never reaches a label
 * or a status message" assertions look for the SAME string the scan was built
 * with. A literal repeated by hand in both places is a test that keeps passing
 * after someone changes one of them.
 */
const ACCESS_COMMUNITY: string = "s3cret-community";
const V3_AUTH_KEY: string = "auth-passphrase-9f2";
const V3_PRIV_KEY: string = "priv-passphrase-4c8";

/*
 * A scan configured the OLD way: no snmpConfigs column, credentials in the
 * nine flattened columns. Most of the installed estate is still this shape,
 * and every one of these scans has to keep sweeping exactly as it did.
 */
function makeLegacyScan(
  overrides?: Record<string, unknown>,
): NetworkDeviceDiscoveryScan {
  return {
    id: scanId,
    name: "Region 1100 sweep",
    cidr: "10.0.0.0/24",
    ...overrides,
  } as unknown as NetworkDeviceDiscoveryScan;
}

/*
 * The shape this feature exists for: a mixed segment with the core on v3 and
 * an access layer on its own v2c community, listed in the order the operator
 * wants them tried. The two entries deliberately disagree about the port as
 * well as the version — an agent on 1161 beside the stock daemon on 161 is a
 * real estate, and it is what makes the sweep report two scanned ports.
 */
function makeMultiConfigScan(
  overrides?: Record<string, unknown>,
): NetworkDeviceDiscoveryScan {
  return {
    id: scanId,
    name: "Mixed segment",
    cidr: "10.0.0.0/24",
    snmpConfigs: [
      {
        id: "core",
        name: "Core switches",
        snmpVersion: "V3",
        snmpPort: 1161,
        snmpV3Username: "nms",
        snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
        snmpV3AuthProtocol: SnmpAuthProtocol.SHA,
        snmpV3AuthKey: V3_AUTH_KEY,
        snmpV3PrivProtocol: SnmpPrivProtocol.AES,
        snmpV3PrivKey: V3_PRIV_KEY,
      },
      {
        id: "access",
        name: "Access switches",
        snmpVersion: "V2c",
        snmpCommunityString: ACCESS_COMMUNITY,
      },
    ],
    ...overrides,
  } as unknown as NetworkDeviceDiscoveryScan;
}

/*
 * The two credential sets makeMultiConfigScan resolves to, written out in
 * full. This object IS the probe's half of the contract: the ids the sweep
 * stamps onto hosts, the parsed enum values the SNMP layer branches on, the
 * defaults a config that omitted a field falls back to, and the labels that
 * are allowed out into logs and status messages.
 */
const resolvedCoreConfig: SubnetScanSnmpConfig = {
  id: "core",
  label: "Core switches (V3)",
  snmpVersion: SnmpVersion.V3,
  // No community on the card; the sweep's own fallback, not a placeholder.
  communityString: "public",
  snmpV3Auth: {
    securityLevel: SnmpSecurityLevel.AuthPriv,
    username: "nms",
    authProtocol: SnmpAuthProtocol.SHA,
    authKey: V3_AUTH_KEY,
    privProtocol: SnmpPrivProtocol.AES,
    privKey: V3_PRIV_KEY,
  },
  port: 1161,
};

const resolvedAccessConfig: SubnetScanSnmpConfig = {
  id: "access",
  label: "Access switches (V2c)",
  snmpVersion: SnmpVersion.V2c,
  communityString: ACCESS_COMMUNITY,
  snmpV3Auth: undefined,
  port: 161,
};

function makeResult(overrides?: Partial<SubnetScanResult>): SubnetScanResult {
  return {
    discoveredHosts: [],
    scannedHostCount: 254,
    scannedPorts: [161],
    responderCountByConfigId: {},
    respondedToPingCount: 0,
    snmpErrorHostCount: 0,
    mostCommonSnmpError: undefined,
    icmpFilteredFallbackHostCount: 0,
    ...overrides,
  } as SubnetScanResult;
}

/*
 * The message a throwing call produced. Written out rather than leaning on
 * expect().toThrow(regex), because several assertions below check what is NOT
 * in the sentence — and a regex that fails to match proves nothing about a
 * message nobody has read.
 */
function messageFrom(work: () => unknown): string {
  try {
    work();
  } catch (err) {
    return (err as Error).message;
  }

  throw new Error("Expected the call to throw, but it returned normally.");
}

describe("buildProbeSnmpConfigs — a scan configured the old way", () => {
  /*
   * The list column is optional, so "this scan has no credentials" is a state
   * that must be impossible to reach by reading. A legacy row's flattened
   * columns ARE its one credential set, synthesized on every read rather than
   * migrated, and it carries a stable literal id because the probe stamps that
   * id onto discovered hosts and the importer looks it up again days later in
   * a different process.
   */
  test("a scan with no stored list still sweeps, with exactly one credential set", () => {
    const configs: Array<SubnetScanSnmpConfig> = buildProbeSnmpConfigs(
      makeLegacyScan({ snmpVersion: "V2c", snmpCommunityString: "public" }),
    );

    expect(configs).toHaveLength(1);
    expect(configs[0]!.id).toBe(LEGACY_SNMP_CONFIG_ID);
    // Pinned as a literal too: it is written into stored result rows.
    expect(LEGACY_SNMP_CONFIG_ID).toBe("legacy");
  });

  /*
   * The conversion this whole function exists for. The column holds the
   * DROPDOWN KEY ("V3"); SnmpMonitor branches on the enum VALUE ("3"). Casting
   * instead of parsing leaves "V3" unequal to SnmpVersion.V3, so a v3 scan
   * opens v2c sessions and the username goes out in cleartext.
   */
  test('a stored "V3" reaches the sweep as the v3 enum value, not the stored spelling', () => {
    expect(
      buildProbeSnmpConfigs(makeLegacyScan({ snmpVersion: "V3" }))[0]!
        .snmpVersion,
    ).toBe(SnmpVersion.V3);
  });

  test('a stored "V1" reaches the sweep as the v1 enum value', () => {
    expect(
      buildProbeSnmpConfigs(makeLegacyScan({ snmpVersion: "V1" }))[0]!
        .snmpVersion,
    ).toBe(SnmpVersion.V1);
  });

  /*
   * The other spelling, which a hand-written row or a direct API call really
   * does produce. It must land on v3 rather than falling through to the v2c
   * default — the fallback here is the insecure direction.
   */
  test('a hand-written "3" is also read as v3 rather than falling through to v2c', () => {
    expect(
      buildProbeSnmpConfigs(makeLegacyScan({ snmpVersion: "3" }))[0]!
        .snmpVersion,
    ).toBe(SnmpVersion.V3);
  });

  test("a scan with no version at all sweeps as v2c, the column's own default", () => {
    expect(buildProbeSnmpConfigs(makeLegacyScan())[0]!.snmpVersion).toBe(
      SnmpVersion.V2c,
    );
  });

  /*
   * "public" is the fallback the sweep has always used, and for discovery it
   * is a real answer rather than a placeholder — an enormous amount of gear
   * ships with it. Sweeping with an empty community would simply find nothing.
   */
  test("a scan with no community string sweeps with the discovery default", () => {
    expect(buildProbeSnmpConfigs(makeLegacyScan())[0]!.communityString).toBe(
      "public",
    );
  });

  test("a scan's own community string is used verbatim", () => {
    expect(
      buildProbeSnmpConfigs(
        makeLegacyScan({ snmpCommunityString: ACCESS_COMMUNITY }),
      )[0]!.communityString,
    ).toBe(ACCESS_COMMUNITY);
  });

  test("a scan with no port sweeps the SNMP default", () => {
    expect(buildProbeSnmpConfigs(makeLegacyScan())[0]!.port).toBe(161);
  });

  test("a scan's own port is used verbatim", () => {
    expect(
      buildProbeSnmpConfigs(makeLegacyScan({ snmpPort: 1161 }))[0]!.port,
    ).toBe(1161);
  });

  test("the v3 credential block is assembled from the flattened v3 columns", () => {
    const configs: Array<SubnetScanSnmpConfig> = buildProbeSnmpConfigs(
      makeLegacyScan({
        snmpVersion: "V3",
        snmpV3Username: "monitoring",
        snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
        snmpV3AuthProtocol: SnmpAuthProtocol.SHA,
        snmpV3AuthKey: V3_AUTH_KEY,
        snmpV3PrivProtocol: SnmpPrivProtocol.AES,
        snmpV3PrivKey: V3_PRIV_KEY,
      }),
    );

    expect(configs[0]!.snmpV3Auth).toEqual({
      securityLevel: SnmpSecurityLevel.AuthPriv,
      username: "monitoring",
      authProtocol: SnmpAuthProtocol.SHA,
      authKey: V3_AUTH_KEY,
      privProtocol: SnmpPrivProtocol.AES,
      privKey: V3_PRIV_KEY,
    });
  });

  /*
   * No username means no v3 session to configure. The rest of the v3 columns
   * are carried on the row regardless — an operator who switched a scan back
   * to v2c must not silently lose the keys they had typed — so "has a v3
   * block" has to be decided by the username alone.
   */
  test("a scan with no v3 username carries no v3 credential block at all", () => {
    const configs: Array<SubnetScanSnmpConfig> = buildProbeSnmpConfigs(
      makeLegacyScan({
        snmpVersion: "V2c",
        snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
        snmpV3PrivKey: V3_PRIV_KEY,
      }),
    );

    expect(configs[0]!.snmpV3Auth).toBeUndefined();
  });
});

describe("buildProbeSnmpConfigs — a scan that carries several credential sets", () => {
  /*
   * ORDER is the operator's own statement of which credential is most likely
   * to answer, and the sweep's first pass follows it exactly. Reordering the
   * list here would cost a timeout per host on every address of a subnet that
   * is mostly the first credential.
   */
  test("the credential sets reach the sweep in the order the operator declared", () => {
    const configs: Array<SubnetScanSnmpConfig> = buildProbeSnmpConfigs(
      makeMultiConfigScan(),
    );

    expect(configs).toHaveLength(2);
    expect(
      configs.map((config: SubnetScanSnmpConfig): string => {
        return config.id;
      }),
    ).toEqual(["core", "access"]);
  });

  /*
   * The ids are the operator's, not positions. The sweep stamps them onto
   * every host it finds and the importer resolves credentials back out of
   * them, so re-minting one here would re-point a stored result at a different
   * credential set the next time the scan runs.
   */
  test("each credential set keeps the id it was stored with", () => {
    const configs: Array<SubnetScanSnmpConfig> = buildProbeSnmpConfigs(
      makeMultiConfigScan(),
    );

    expect(configs[0]).toEqual(resolvedCoreConfig);
    expect(configs[1]).toEqual(resolvedAccessConfig);
  });

  test("a v3 set and a v2c set are parsed side by side, each with its own version", () => {
    const configs: Array<SubnetScanSnmpConfig> = buildProbeSnmpConfigs(
      makeMultiConfigScan(),
    );

    expect(configs[0]!.snmpVersion).toBe(SnmpVersion.V3);
    expect(configs[0]!.snmpV3Auth?.username).toBe("nms");
    expect(configs[1]!.snmpVersion).toBe(SnmpVersion.V2c);
    // A v2c set has nothing to authenticate with, and must not borrow the v3 one's.
    expect(configs[1]!.snmpV3Auth).toBeUndefined();
  });

  /*
   * Ports and communities are resolved PER SET, with each set falling back on
   * its own. Resolving them once for the scan — which is what the flattened
   * columns used to force — is precisely the bug: the access layer would be
   * dialled on the core's port and answer nothing.
   */
  test("port and community are resolved per credential set, not once for the scan", () => {
    const configs: Array<SubnetScanSnmpConfig> = buildProbeSnmpConfigs(
      makeMultiConfigScan(),
    );

    expect(configs[0]!.port).toBe(1161);
    expect(configs[1]!.port).toBe(161);
    expect(configs[0]!.communityString).toBe("public");
    expect(configs[1]!.communityString).toBe(ACCESS_COMMUNITY);
  });

  /*
   * Only reachable through an out-of-band write — the form mints an id per
   * card — but a set with no id has to keep its POSITION rather than be
   * dropped, or the scan would quietly sweep with fewer credentials than the
   * operator listed.
   */
  test("a stored set with no id still sweeps, under a positional id", () => {
    const configs: Array<SubnetScanSnmpConfig> = buildProbeSnmpConfigs(
      makeMultiConfigScan({
        snmpConfigs: [
          { name: "Printers", snmpVersion: "V1" },
          { id: "access", name: "Access switches", snmpVersion: "V2c" },
        ],
      }),
    );

    expect(configs).toHaveLength(2);
    expect(configs[0]!.id).toBe("config-1");
    expect(configs[1]!.id).toBe("access");
  });
});

/*
 * Labels travel to places the credential columns deliberately do not: the
 * probe's log, and the scan's statusMessage — which is readable by roles that
 * are denied the snmpConfigs column precisely because its entries carry
 * secrets. A label built from anything but the operator's name and the version
 * would undo that access control from the inside.
 */
describe("buildProbeSnmpConfigs — labels are safe to print", () => {
  test("a label is the operator's name and the version, and nothing else", () => {
    const configs: Array<SubnetScanSnmpConfig> = buildProbeSnmpConfigs(
      makeMultiConfigScan(),
    );

    expect(configs[0]!.label).toBe("Core switches (V3)");
    expect(configs[1]!.label).toBe("Access switches (V2c)");
  });

  test("no label carries a community string or either v3 key", () => {
    const configs: Array<SubnetScanSnmpConfig> = buildProbeSnmpConfigs(
      makeMultiConfigScan(),
    );

    for (const config of configs) {
      expect(config.label).not.toContain(ACCESS_COMMUNITY);
      expect(config.label).not.toContain(V3_AUTH_KEY);
      expect(config.label).not.toContain(V3_PRIV_KEY);
    }
  });

  /*
   * An unnamed set still needs something an operator can point at, or a
   * five-credential scan's status message reads "V2c, V2c, V2c".
   */
  test("an unnamed set is labelled by its position and version", () => {
    const configs: Array<SubnetScanSnmpConfig> = buildProbeSnmpConfigs(
      makeMultiConfigScan({
        snmpConfigs: [
          { id: "one", snmpVersion: "V2c", snmpCommunityString: "public" },
          { id: "two", snmpVersion: "V3", snmpV3Username: "nms" },
        ],
      }),
    );

    expect(configs[0]!.label).toBe("SNMP config 1 (V2c)");
    expect(configs[1]!.label).toBe("SNMP config 2 (V3)");
  });
});

/*
 * An unreadable v3 value is validated here, at build time, rather than deeper
 * in SnmpMonitor, because this runs inside runScan's try: the throw is
 * reported back as a failed scan the operator can read. Thrown per host
 * instead, it would land in the sweep's debug-level catch and the scan would
 * finish "successfully" having found nothing.
 *
 * With several credential sets the message has to name BOTH the scan and the
 * set. Naming only the scan leaves the operator with five cards on screen and
 * no idea which one to fix.
 */
describe("buildSnmpV3Auth — an unreadable value names the scan and the config", () => {
  const scanLabel: string = "Mixed segment (10.0.0.0/24)";

  function badConfig(
    overrides: Record<string, unknown>,
  ): DiscoveryScanSnmpConfig {
    return {
      id: "core",
      name: "Core switches",
      snmpVersion: "V3",
      snmpV3Username: "nms",
      snmpV3SecurityLevel: SnmpSecurityLevel.AuthPriv,
      snmpV3AuthProtocol: SnmpAuthProtocol.SHA,
      snmpV3AuthKey: V3_AUTH_KEY,
      snmpV3PrivProtocol: SnmpPrivProtocol.AES,
      snmpV3PrivKey: V3_PRIV_KEY,
      ...overrides,
    } as DiscoveryScanSnmpConfig;
  }

  /*
   * The most consequential of the three: an unrecognized security level's
   * silent fallback is not a weaker algorithm but no security at all.
   */
  test("an unrecognized security level throws, quoting the value", () => {
    expect(() => {
      return buildSnmpV3Auth(
        badConfig({ snmpV3SecurityLevel: "authpriv-typo" }),
        scanLabel,
      );
    }).toThrow(/security level "authpriv-typo".*not a recognized value/i);
  });

  test("an unrecognized authentication protocol throws, quoting the value", () => {
    expect(() => {
      return buildSnmpV3Auth(
        badConfig({ snmpV3AuthProtocol: "SHA3" }),
        scanLabel,
      );
    }).toThrow(/authentication protocol "SHA3".*not a recognized value/i);
  });

  test("an unrecognized privacy protocol throws, quoting the value", () => {
    expect(() => {
      return buildSnmpV3Auth(
        badConfig({ snmpV3PrivProtocol: "aes-256-gcm" }),
        scanLabel,
      );
    }).toThrow(/privacy protocol "aes-256-gcm".*not a recognized value/i);
  });

  test("the message names the scan AND the credential set, and lists what was expected", () => {
    const message: string = messageFrom(() => {
      return buildSnmpV3Auth(
        badConfig({ snmpV3PrivProtocol: "aes-256-gcm" }),
        scanLabel,
      );
    });

    expect(message).toContain(`discovery scan ${scanLabel}`);
    expect(message).toContain("Core switches (V3)");
    expect(message).toContain(SnmpPrivProtocol.AES256);
  });

  // The diagnosis must not become the leak.
  test("the message carries neither key, even though both were on the config", () => {
    const message: string = messageFrom(() => {
      return buildSnmpV3Auth(
        badConfig({ snmpV3PrivProtocol: "aes-256-gcm" }),
        scanLabel,
      );
    });

    expect(message).not.toContain(V3_AUTH_KEY);
    expect(message).not.toContain(V3_PRIV_KEY);
  });
});

/*
 * The failure mode that only exists once a scan carries a list: one unreadable
 * set among several. If the build swallowed it and swept with the remaining
 * ones, the scan would report SUCCESS with a partial result — every host that
 * only the broken credential could reach silently missing, and nothing
 * anywhere saying a credential had been dropped. That is strictly worse than
 * the single-config version of this bug, because the result looks complete.
 */
describe("buildProbeSnmpConfigs — one bad set fails the whole scan", () => {
  function scanWithBadSecondConfig(): NetworkDeviceDiscoveryScan {
    return makeMultiConfigScan({
      snmpConfigs: [
        {
          id: "access",
          name: "Access switches",
          snmpVersion: "V2c",
          snmpCommunityString: ACCESS_COMMUNITY,
        },
        {
          id: "vendor",
          name: "Vendor block",
          snmpVersion: "V3",
          snmpV3Username: "vendor-nms",
          snmpV3PrivProtocol: "aes-256-gcm",
        },
      ],
    });
  }

  test("a scan whose SECOND set is unreadable throws rather than sweeping with the first", () => {
    expect(() => {
      return buildProbeSnmpConfigs(scanWithBadSecondConfig());
    }).toThrow(/privacy protocol "aes-256-gcm"/);
  });

  test("the failure names the offending set, not merely the scan", () => {
    const message: string = messageFrom(() => {
      return buildProbeSnmpConfigs(scanWithBadSecondConfig());
    });

    expect(message).toContain("Vendor block (V3)");
    expect(message).toContain("discovery scan Mixed segment (10.0.0.0/24)");
    // The set that was fine is not implicated.
    expect(message).not.toContain("Access switches");
  });
});

describe("buildScanStatusMessage — which credentials actually answered", () => {
  /*
   * The half of a multi-credential sweep the operator cannot see any other
   * way. A credential that answered nobody is either wrong or aimed at gear
   * that is not on this range, and either way it is costing every silent
   * address another SNMP timeout on every run.
   */
  test("names each credential that answered, with how many hosts it found", () => {
    const message: string = buildScanStatusMessage(
      makeResult({
        respondedToPingCount: 9,
        scannedPorts: [161, 1161],
        responderCountByConfigId: { core: 4, access: 5 },
      }),
      9,
      [resolvedCoreConfig, resolvedAccessConfig],
    );

    expect(message).toContain(
      "Answered by credentials: Core switches (V3) on 4, Access switches (V2c) on 5.",
    );
    expect(message).not.toContain("No host answered:");
  });

  test("names the credentials that answered nobody", () => {
    const message: string = buildScanStatusMessage(
      makeResult({
        respondedToPingCount: 4,
        scannedPorts: [161, 1161],
        responderCountByConfigId: { core: 4, access: 0 },
      }),
      4,
      [resolvedCoreConfig, resolvedAccessConfig],
    );

    expect(message).toContain(
      "Answered by credentials: Core switches (V3) on 4.",
    );
    expect(message).toContain("No host answered: Access switches (V2c).");
  });

  /*
   * A scan with one credential set has nothing to disambiguate, and its
   * summary is exactly what it was before this feature. Adding "Answered by
   * credentials: SNMP config 1 (V2c) on 3" to every legacy scan's status
   * message would be noise in the one field an operator reads on the row.
   */
  test("a single-credential sweep says neither sentence", () => {
    const message: string = buildScanStatusMessage(
      makeResult({
        respondedToPingCount: 3,
        responderCountByConfigId: { legacy: 3 },
      }),
      3,
      [
        {
          id: LEGACY_SNMP_CONFIG_ID,
          label: "SNMP config 1 (V2c)",
          snmpVersion: SnmpVersion.V2c,
          communityString: "public",
          snmpV3Auth: undefined,
          port: 161,
        },
      ],
    );

    expect(message).not.toContain("Answered by credentials");
    expect(message).not.toContain("No host answered:");
    expect(message).toBe(
      "Swept 254 hosts: 3 answered ICMP ping, 3 answered SNMP.",
    );
  });

  /*
   * statusMessage is readable by roles the snmpConfigs column deliberately is
   * not. Naming a credential is the whole point of these sentences; printing
   * one is a credential disclosure.
   */
  test("no secret from any credential set reaches the status message", () => {
    const message: string = buildScanStatusMessage(
      makeResult({
        respondedToPingCount: 4,
        scannedPorts: [161, 1161],
        responderCountByConfigId: { core: 4, access: 0 },
      }),
      4,
      [resolvedCoreConfig, resolvedAccessConfig],
    );

    expect(message).not.toContain(ACCESS_COMMUNITY);
    expect(message).not.toContain(V3_AUTH_KEY);
    expect(message).not.toContain(V3_PRIV_KEY);
    expect(message).not.toContain("nms");
  });
});

/*
 * The checklist a sweep that found nothing ends with tells the operator which
 * UDP port to open. With several credential sets the sweep can legitimately
 * have dialled more than one, and naming only the first sends them to fix half
 * the problem and re-run to the same zero.
 */
describe("buildScanStatusMessage — the ports a multi-credential sweep dialled", () => {
  test("one port reads as a singular 'port'", () => {
    expect(
      buildScanStatusMessage(makeResult({ scannedPorts: [161] }), 0),
    ).toContain("Nothing answered SNMP on port 161.");
  });

  test("two ports read as a plural list, both of them named", () => {
    const message: string = buildScanStatusMessage(
      makeResult({ scannedPorts: [161, 1161] }),
      0,
    );

    expect(message).toContain("Nothing answered SNMP on ports 161, 1161.");
    expect(message).toContain("UDP/161, 1161 is permitted to it");
  });
});

describe("runScan — the resolved credentials reach the sweep and come back on the hosts", () => {
  // eslint-disable-next-line @typescript-eslint/typedef
  let fetchSpy = jest.spyOn(API, "fetch");
  // eslint-disable-next-line @typescript-eslint/typedef
  let scanSpy = jest.spyOn(SubnetScanner, "scan");

  beforeEach(() => {
    fetchSpy = jest
      .spyOn(API, "fetch")
      .mockResolvedValue({ data: [] } as never);
    scanSpy = jest.spyOn(SubnetScanner, "scan").mockResolvedValue(
      makeResult({
        discoveredHosts: [
          {
            ipAddress: "10.0.0.5",
            sysName: "core-1",
            snmpReachable: true,
            snmpConfigId: "core",
          },
          {
            ipAddress: "10.0.0.7",
            sysName: "access-1",
            snmpReachable: true,
            snmpConfigId: "access",
          },
          // Ping-only: no credential found it, so it carries no config id.
          { ipAddress: "10.0.0.9", snmpReachable: false },
        ],
        respondedToPingCount: 3,
        scannedPorts: [161, 1161],
        responderCountByConfigId: { core: 1, access: 1 },
      }) as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function uploadedBody(): JSONObject {
    const call: Array<unknown> = fetchSpy.mock.calls[0] as Array<unknown>;
    return (call[0] as JSONObject)["data"] as JSONObject;
  }

  function uploadedDevices(): Array<JSONObject> {
    return uploadedBody()["discoveredDevices"] as Array<JSONObject>;
  }

  /*
   * The sweep gets the WHOLE resolved list, parsed, in declared order — the
   * secrets included, because unlike the labels this is the one place that
   * legitimately needs them.
   */
  test("the sweep is handed every credential set the scan declared, already parsed", async () => {
    await runScan(makeMultiConfigScan());

    expect(scanSpy).toHaveBeenCalledWith({
      cidr: "10.0.0.0/24",
      snmpConfigs: [resolvedCoreConfig, resolvedAccessConfig],
    });
  });

  /*
   * The id is what lets the import path build each device with the credentials
   * that ACTUALLY answered it. Losing it on the way to the server would put
   * every discovered host back on the scan's first credential set — the exact
   * mis-import this id scheme exists to prevent.
   */
  test("each discovered host is uploaded with the id of the credential that found it", async () => {
    await runScan(makeMultiConfigScan());

    const devices: Array<JSONObject> = uploadedDevices();

    expect(devices).toHaveLength(3);
    expect(devices[0]!["snmpConfigId"]).toBe("core");
    expect(devices[1]!["snmpConfigId"]).toBe("access");
  });

  test("a ping-only host is uploaded without a credential id, because none found it", async () => {
    await runScan(makeMultiConfigScan());

    const devices: Array<JSONObject> = uploadedDevices();

    expect(devices[2]!["snmpReachable"]).toBe(false);
    expect(devices[2]!["snmpConfigId"]).toBeUndefined();
  });

  test("the uploaded status message names both credentials by their labels", async () => {
    await runScan(makeMultiConfigScan());

    const message: string = String(uploadedBody()["statusMessage"]);

    expect(message).toContain(
      "Answered by credentials: Core switches (V3) on 1, Access switches (V2c) on 1.",
    );
    expect(message).not.toContain(ACCESS_COMMUNITY);
    expect(message).not.toContain(V3_PRIV_KEY);
  });

  /*
   * The other half of "one bad set fails the whole scan": no sweep runs at
   * all, and the scan is reported Failed with the reason, rather than
   * completing with a partial result nobody can tell from a complete one.
   */
  test("an unreadable credential set stops the sweep before it starts and reports the reason", async () => {
    await runScan(
      makeMultiConfigScan({
        snmpConfigs: [
          {
            id: "access",
            name: "Access switches",
            snmpVersion: "V2c",
            snmpCommunityString: ACCESS_COMMUNITY,
          },
          {
            id: "vendor",
            name: "Vendor block",
            snmpVersion: "V3",
            snmpV3Username: "vendor-nms",
            snmpV3PrivProtocol: "aes-256-gcm",
          },
        ],
      }),
    );

    expect(scanSpy).not.toHaveBeenCalled();

    const body: JSONObject = uploadedBody();
    expect(body["success"]).toBe(false);
    expect(body["discoveredDevices"]).toEqual([]);
    expect(String(body["statusMessage"])).toContain("Vendor block (V3)");
    expect(String(body["statusMessage"])).toContain("aes-256-gcm");
  });

  /*
   * A legacy scan must reach the sweep unchanged by any of this: one config,
   * the flattened columns, and a summary with no per-credential sentences in
   * it. Every scan in the installed estate is this shape until someone opens
   * the form and saves it.
   */
  test("a legacy scan still sweeps with exactly one credential set", async () => {
    await runScan(
      makeLegacyScan({ snmpVersion: "V2c", snmpCommunityString: "public" }),
    );

    expect(scanSpy).toHaveBeenCalledWith({
      cidr: "10.0.0.0/24",
      snmpConfigs: [
        {
          id: LEGACY_SNMP_CONFIG_ID,
          label: "SNMP config 1 (V2c)",
          snmpVersion: SnmpVersion.V2c,
          communityString: "public",
          snmpV3Auth: undefined,
          port: 161,
        },
      ],
    });
    expect(String(uploadedBody()["statusMessage"])).not.toContain(
      "Answered by credentials",
    );
  });
});
