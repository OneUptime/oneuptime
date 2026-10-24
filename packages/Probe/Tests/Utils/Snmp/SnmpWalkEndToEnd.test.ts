// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import dgram from "dgram";
import snmp from "net-snmp";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpDataType from "Common/Types/Monitor/SnmpMonitor/SnmpDataType";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import {
  NetworkDeviceDiagnosticSnmpWalkResult,
  NetworkDeviceSnmpWalkRequest,
  SNMP_WALK_DEFAULT_ROOT_OID,
  SNMP_WALK_MAX_OIDS,
  SNMP_WALK_MAX_REPETITIONS,
  SnmpWalkAuthenticationReason,
  SnmpWalkFailureKind,
  SnmpWalkRow,
  SnmpWalkStopReason,
} from "Common/Types/NetworkDevice/NetworkDeviceSnmpWalk";
import SnmpWalkResultUtil from "Common/Utils/NetworkDevice/SnmpWalkResultUtil";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";

/*
 * Issue #5184 over a real UDP socket: a net-snmp agent on loopback, set up
 * as a small switch would be - its system group, an interface table with a
 * binary MAC address and a 64-bit counter, an IP address, and a vendor CPU
 * gauge under enterprises - walked by the probe's own SnmpMonitor.walkOidTree
 * with configs shaped the way the server hands them over (credentials the
 * device carries, oids empty), over SNMP v1, v2c, v3 with authentication,
 * and v3 with privacy.
 *
 * Every refusal the dashboard explains is produced for real here too: a
 * wrong community (silence), an unknown v3 user, a wrong authentication
 * password, a wrong privacy password, nothing listening, and a name that
 * does not resolve.
 */

const COMMUNITY: string = "oneuptime-walk";

const AUTH_USER: snmp.User = {
  name: "walker",
  level: snmp.SecurityLevel.authNoPriv,
  authProtocol: snmp.AuthProtocols.sha,
  authKey: "walker-auth-passphrase",
};

const PRIV_USER: snmp.User = {
  name: "private-walker",
  level: snmp.SecurityLevel.authPriv,
  authProtocol: snmp.AuthProtocols.sha256,
  authKey: "private-auth-passphrase",
  privProtocol: snmp.PrivProtocols.aes,
  privKey: "private-priv-passphrase",
};

const SYS_DESCR: string = "Edge switch ES-24, firmware 3.2.1";
const SYS_OBJECT_ID: string = "1.3.6.1.4.1.9.1.2134";
const SYS_UP_TIME_TICKS: number = 104524500;
// cpmCPUTotal5minRev of the first CPU, as the Cisco template names it.
const CPU_OID: string = "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1";
// ipAdEntAddr of an address row (indexed by a number here, not the address).
const IP_ADDRESS_OID: string = "1.3.6.1.2.1.4.20.1.1.1";

// 2^64 - 1: a Counter64 past every JavaScript safe integer.
const MAX_COUNTER64: Buffer = Buffer.from("ffffffffffffffff", "hex");

const INTERFACES: Array<{
  index: number;
  descr: string;
  mac: Buffer;
  operStatus: number;
  hcInOctets: Buffer;
}> = [
  {
    index: 1,
    descr: "GigabitEthernet0/1",
    mac: Buffer.from([0x00, 0x1a, 0x2b, 0x3c, 0x4d, 0x5e]),
    operStatus: 1,
    hcInOctets: MAX_COUNTER64,
  },
  {
    index: 2,
    descr: "GigabitEthernet0/2",
    mac: Buffer.from([0x00, 0x1a, 0x2b, 0x3c, 0x4d, 0x5f]),
    operStatus: 2,
    hcInOctets: Buffer.from("0000000000000400", "hex"),
  },
  {
    index: 3,
    descr: "Vlan100",
    mac: Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
    operStatus: 1,
    hcInOctets: Buffer.from("0000000000000000", "hex"),
  },
];

type SnmpAgent = {
  getAuthorizer: () => {
    addCommunity: (community: string) => void;
    addUser: (user: snmp.User) => void;
  };
  getMib: () => {
    registerProvider: (provider: unknown) => void;
    setScalarValue: (name: string, value: unknown) => void;
    addTableRow: (name: string, row: Array<unknown>) => void;
  };
  close: () => void;
};

let agent: SnmpAgent | undefined = undefined;
let agentPort: number = 0;

function findFreeUdpPort(): Promise<number> {
  return new Promise(
    (resolve: (port: number) => void, reject: (reason?: Error) => void) => {
      const socket: dgram.Socket = dgram.createSocket("udp4");

      socket.once("error", (error: Error) => {
        reject(error);
      });

      socket.bind(0, "127.0.0.1", () => {
        const port: number = socket.address().port;
        socket.close(() => {
          resolve(port);
        });
      });
    },
  );
}

function scalar(data: {
  name: string;
  oid: string;
  type: number;
  value: unknown;
}): void {
  agent!.getMib().registerProvider({
    name: data.name,
    type: snmp.MibProviderType.Scalar,
    oid: data.oid,
    scalarType: data.type,
    maxAccess: snmp.MaxAccess["read-only"],
  });
  agent!.getMib().setScalarValue(data.name, data.value);
}

function column(
  number: number,
  name: string,
  type: number,
  maxAccess: number = snmp.MaxAccess["read-only"],
): Record<string, unknown> {
  return {
    number: number,
    name: name,
    type: type,
    maxAccess: maxAccess,
  };
}

beforeAll(async () => {
  agentPort = await findFreeUdpPort();

  agent = snmp.createAgent(
    { port: agentPort, disableAuthorization: false },
    () => {
      // Agent-side errors surface to the client as a timeout.
    },
  ) as unknown as SnmpAgent;

  agent.getAuthorizer().addCommunity(COMMUNITY);
  agent.getAuthorizer().addUser(AUTH_USER);
  agent.getAuthorizer().addUser(PRIV_USER);

  scalar({
    name: "sysDescr",
    oid: "1.3.6.1.2.1.1.1",
    type: snmp.ObjectType.OctetString,
    value: SYS_DESCR,
  });
  scalar({
    name: "sysObjectID",
    oid: "1.3.6.1.2.1.1.2",
    type: snmp.ObjectType.OID,
    value: SYS_OBJECT_ID,
  });
  scalar({
    name: "sysUpTime",
    oid: "1.3.6.1.2.1.1.3",
    type: snmp.ObjectType.TimeTicks,
    value: SYS_UP_TIME_TICKS,
  });
  scalar({
    name: "sysName",
    oid: "1.3.6.1.2.1.1.5",
    type: snmp.ObjectType.OctetString,
    value: "edge-sw-01",
  });
  scalar({
    name: "sysLocation",
    oid: "1.3.6.1.2.1.1.6",
    type: snmp.ObjectType.OctetString,
    // A location written in German, as UTF-8: text, not hex.
    value: Buffer.from("Büro 2. Stock", "utf8"),
  });

  agent.getMib().registerProvider({
    name: "ifEntry",
    type: snmp.MibProviderType.Table,
    oid: "1.3.6.1.2.1.2.2.1",
    maxAccess: snmp.MaxAccess["not-accessible"],
    tableColumns: [
      column(
        1,
        "ifIndex",
        snmp.ObjectType.Integer,
        snmp.MaxAccess["not-accessible"],
      ),
      column(2, "ifDescr", snmp.ObjectType.OctetString),
      column(6, "ifPhysAddress", snmp.ObjectType.OctetString),
      column(8, "ifOperStatus", snmp.ObjectType.Integer),
    ],
    tableIndex: [{ columnName: "ifIndex" }],
  });

  agent.getMib().registerProvider({
    name: "ifXEntry",
    type: snmp.MibProviderType.Table,
    oid: "1.3.6.1.2.1.31.1.1.1",
    maxAccess: snmp.MaxAccess["not-accessible"],
    tableColumns: [
      column(6, "ifHCInOctets", snmp.ObjectType.Counter64),
      column(
        100,
        "ifXIndex",
        snmp.ObjectType.Integer,
        snmp.MaxAccess["not-accessible"],
      ),
    ],
    tableIndex: [{ columnName: "ifXIndex" }],
  });

  for (const entry of INTERFACES) {
    agent
      .getMib()
      .addTableRow("ifEntry", [
        entry.index,
        entry.descr,
        entry.mac,
        entry.operStatus,
      ]);
    agent.getMib().addTableRow("ifXEntry", [entry.hcInOctets, entry.index]);
  }

  agent.getMib().registerProvider({
    name: "ipAddrEntry",
    type: snmp.MibProviderType.Table,
    oid: "1.3.6.1.2.1.4.20.1",
    maxAccess: snmp.MaxAccess["not-accessible"],
    tableColumns: [
      column(1, "ipAdEntAddr", snmp.ObjectType.IpAddress),
      column(
        100,
        "ipAddrRow",
        snmp.ObjectType.Integer,
        snmp.MaxAccess["not-accessible"],
      ),
    ],
    tableIndex: [{ columnName: "ipAddrRow" }],
  });
  agent.getMib().addTableRow("ipAddrEntry", ["10.20.0.2", 1]);

  agent.getMib().registerProvider({
    name: "cpmCPUTotalEntry",
    type: snmp.MibProviderType.Table,
    oid: "1.3.6.1.4.1.9.9.109.1.1.1.1",
    maxAccess: snmp.MaxAccess["not-accessible"],
    tableColumns: [
      column(
        1,
        "cpmCPUTotalIndex",
        snmp.ObjectType.Integer,
        snmp.MaxAccess["not-accessible"],
      ),
      column(8, "cpmCPUTotal5minRev", snmp.ObjectType.Gauge32),
    ],
    tableIndex: [{ columnName: "cpmCPUTotalIndex" }],
  });
  agent.getMib().addTableRow("cpmCPUTotalEntry", [1, 37]);
});

afterAll(() => {
  agent?.close();
});

function v2cConfig(
  overrides: Partial<MonitorStepSnmpMonitor> = {},
): MonitorStepSnmpMonitor {
  return {
    snmpVersion: SnmpVersion.V2c,
    hostname: "127.0.0.1",
    port: agentPort,
    communityString: COMMUNITY,
    oids: [],
    timeout: 1000,
    monitorInterfaces: false,
    ...overrides,
  };
}

function v3Config(data: {
  username: string;
  securityLevel: SnmpSecurityLevel;
  authProtocol?: SnmpAuthProtocol;
  authKey?: string;
  privProtocol?: SnmpPrivProtocol;
  privKey?: string;
}): MonitorStepSnmpMonitor {
  return {
    snmpVersion: SnmpVersion.V3,
    hostname: "127.0.0.1",
    port: agentPort,
    snmpV3Auth: {
      securityLevel: data.securityLevel,
      username: data.username,
      ...(data.authProtocol ? { authProtocol: data.authProtocol } : {}),
      ...(data.authKey ? { authKey: data.authKey } : {}),
      ...(data.privProtocol ? { privProtocol: data.privProtocol } : {}),
      ...(data.privKey ? { privKey: data.privKey } : {}),
    },
    oids: [],
    timeout: 1000,
    monitorInterfaces: false,
  };
}

function walkRequest(
  overrides: Partial<NetworkDeviceSnmpWalkRequest> = {},
): NetworkDeviceSnmpWalkRequest {
  return {
    rootOid: SNMP_WALK_DEFAULT_ROOT_OID,
    maxOids: SNMP_WALK_MAX_OIDS,
    timeBudgetInMs: 20000,
    // Short: the refusals below are timeouts, and the suite waits for them.
    requestTimeoutInMs: 700,
    maxRepetitions: SNMP_WALK_MAX_REPETITIONS,
    pauseBetweenRequestsInMs: 0,
    ...overrides,
  };
}

function rowFor(
  result: NetworkDeviceDiagnosticSnmpWalkResult,
  oid: string,
): SnmpWalkRow | undefined {
  return result.rows.find((row: SnmpWalkRow): boolean => {
    return row.oid === oid;
  });
}

function oidsOf(result: NetworkDeviceDiagnosticSnmpWalkResult): Array<string> {
  return result.rows.map((row: SnmpWalkRow): string => {
    return row.oid;
  });
}

const ALL_OIDS: Array<string> = [
  "1.3.6.1.2.1.1.1.0",
  "1.3.6.1.2.1.1.2.0",
  "1.3.6.1.2.1.1.3.0",
  "1.3.6.1.2.1.1.5.0",
  "1.3.6.1.2.1.1.6.0",
  "1.3.6.1.2.1.2.2.1.2.1",
  "1.3.6.1.2.1.2.2.1.2.2",
  "1.3.6.1.2.1.2.2.1.2.3",
  "1.3.6.1.2.1.2.2.1.6.1",
  "1.3.6.1.2.1.2.2.1.6.2",
  "1.3.6.1.2.1.2.2.1.6.3",
  "1.3.6.1.2.1.2.2.1.8.1",
  "1.3.6.1.2.1.2.2.1.8.2",
  "1.3.6.1.2.1.2.2.1.8.3",
  IP_ADDRESS_OID,
  "1.3.6.1.2.1.31.1.1.1.6.1",
  "1.3.6.1.2.1.31.1.1.1.6.2",
  "1.3.6.1.2.1.31.1.1.1.6.3",
  CPU_OID,
];

describe("an SNMP v2c walk of the whole tree", () => {
  let result: NetworkDeviceDiagnosticSnmpWalkResult;

  beforeAll(async () => {
    result = await SnmpMonitor.walkOidTree(v2cConfig(), walkRequest());
  });

  test("reads every OID the agent exposes, in OID order, and says it is complete", () => {
    /*
     * The agent exposes the ifIndex column as not-accessible (it is the
     * index), so a walk never returns it - as on a real switch.
     */
    expect(oidsOf(result)).toEqual(ALL_OIDS);
    expect(result.stopReason).toBe(SnmpWalkStopReason.Complete);
    expect(result.nextOid).toBeUndefined();
    expect(result.failure).toBeUndefined();
    expect(result.rootOid).toBe("1.3.6.1");
    expect(result.snmpVersion).toBe(SnmpVersion.V2c);
  });

  test("goes back for more: a bulk request at a time, not one per OID", () => {
    expect(result.requestCount).toBeGreaterThan(0);
    expect(result.requestCount).toBeLessThan(ALL_OIDS.length);
    expect(result.durationInMs).toBeGreaterThanOrEqual(0);
  });

  test("reads text as text, UTF-8 included", () => {
    expect(rowFor(result, "1.3.6.1.2.1.1.1.0")).toEqual({
      oid: "1.3.6.1.2.1.1.1.0",
      type: SnmpDataType.OctetString,
      value: SYS_DESCR,
    });
    expect(rowFor(result, "1.3.6.1.2.1.1.6.0")?.value).toBe("Büro 2. Stock");
  });

  test("reads an OID value as its OID, and timeticks as a number", () => {
    expect(rowFor(result, "1.3.6.1.2.1.1.2.0")).toEqual({
      oid: "1.3.6.1.2.1.1.2.0",
      type: SnmpDataType.ObjectIdentifier,
      value: SYS_OBJECT_ID,
    });
    expect(rowFor(result, "1.3.6.1.2.1.1.3.0")).toEqual({
      oid: "1.3.6.1.2.1.1.3.0",
      type: SnmpDataType.TimeTicks,
      value: SYS_UP_TIME_TICKS,
    });
  });

  test("reads a MAC address as hex octets, a zero one included", () => {
    expect(rowFor(result, "1.3.6.1.2.1.2.2.1.6.1")).toEqual({
      oid: "1.3.6.1.2.1.2.2.1.6.1",
      type: SnmpDataType.OctetString,
      value: "00 1A 2B 3C 4D 5E",
      isHex: true,
    });
    expect(rowFor(result, "1.3.6.1.2.1.2.2.1.6.3")?.value).toBe(
      "00 00 00 00 00 00",
    );
  });

  test("reads a 64-bit counter past 2^53 to its last digit", () => {
    expect(rowFor(result, "1.3.6.1.2.1.31.1.1.1.6.1")).toEqual({
      oid: "1.3.6.1.2.1.31.1.1.1.6.1",
      type: SnmpDataType.Counter64,
      value: "18446744073709551615",
    });
    expect(rowFor(result, "1.3.6.1.2.1.31.1.1.1.6.2")?.value).toBe("1024");
  });

  test("reads integers, gauges and IP addresses", () => {
    expect(rowFor(result, "1.3.6.1.2.1.2.2.1.8.2")).toEqual({
      oid: "1.3.6.1.2.1.2.2.1.8.2",
      type: SnmpDataType.Integer,
      value: 2,
    });
    expect(rowFor(result, CPU_OID)).toEqual({
      oid: CPU_OID,
      type: SnmpDataType.Gauge32,
      value: 37,
    });
    expect(rowFor(result, IP_ADDRESS_OID)).toEqual({
      oid: IP_ADDRESS_OID,
      type: SnmpDataType.IpAddress,
      value: "10.20.0.2",
    });
  });

  test("is what the server stores, unchanged", () => {
    expect(
      SnmpWalkResultUtil.sanitize(JSON.parse(JSON.stringify(result))),
    ).toEqual(JSON.parse(JSON.stringify(result)));
  });
});

describe("walking a subtree", () => {
  test("reads only what sits under the starting OID", async () => {
    const result: NetworkDeviceDiagnosticSnmpWalkResult =
      await SnmpMonitor.walkOidTree(
        v2cConfig(),
        walkRequest({ rootOid: "1.3.6.1.2.1.2" }),
      );

    expect(oidsOf(result)).toEqual(
      ALL_OIDS.filter((oid: string): boolean => {
        return oid.startsWith("1.3.6.1.2.1.2.");
      }),
    );
    expect(result.stopReason).toBe(SnmpWalkStopReason.Complete);
    expect(result.rootOid).toBe("1.3.6.1.2.1.2");
  });

  test("an arc that only shares digits with the root is not under it", async () => {
    // 1.3.6.1.2.1.31 starts with "1.3.6.1.2.1.3" but is not inside it.
    const result: NetworkDeviceDiagnosticSnmpWalkResult =
      await SnmpMonitor.walkOidTree(
        v2cConfig(),
        walkRequest({ rootOid: "1.3.6.1.2.1.3" }),
      );

    expect(result.rows).toEqual([]);
    expect(result.stopReason).toBe(SnmpWalkStopReason.Complete);
  });

  test("a subtree the device does not implement is complete and empty, not a failure", async () => {
    const result: NetworkDeviceDiagnosticSnmpWalkResult =
      await SnmpMonitor.walkOidTree(
        v2cConfig(),
        walkRequest({ rootOid: "1.3.6.1.2.1.25" }),
      );

    expect(result.rows).toEqual([]);
    expect(result.stopReason).toBe(SnmpWalkStopReason.Complete);
    expect(result.failure).toBeUndefined();
  });

  test("starting on an object reads that object, as snmpwalk does", async () => {
    const result: NetworkDeviceDiagnosticSnmpWalkResult =
      await SnmpMonitor.walkOidTree(
        v2cConfig(),
        walkRequest({ rootOid: "1.3.6.1.2.1.1.3.0" }),
      );

    expect(result.rows).toEqual([
      {
        oid: "1.3.6.1.2.1.1.3.0",
        type: SnmpDataType.TimeTicks,
        value: SYS_UP_TIME_TICKS,
      },
    ]);
    expect(result.stopReason).toBe(SnmpWalkStopReason.Complete);
  });
});

describe("the OID limit, and continuing", () => {
  test("stops at the limit, says where it stopped, and the next walk reads the rest exactly once", async () => {
    const first: NetworkDeviceDiagnosticSnmpWalkResult =
      await SnmpMonitor.walkOidTree(v2cConfig(), walkRequest({ maxOids: 7 }));

    expect(oidsOf(first)).toEqual(ALL_OIDS.slice(0, 7));
    expect(first.stopReason).toBe(SnmpWalkStopReason.OidLimit);
    expect(first.nextOid).toBe(ALL_OIDS[6]);

    const second: NetworkDeviceDiagnosticSnmpWalkResult =
      await SnmpMonitor.walkOidTree(
        v2cConfig(),
        walkRequest({ maxOids: 7, afterOid: first.nextOid }),
      );

    expect(second.afterOid).toBe(ALL_OIDS[6]);
    expect(oidsOf(second)).toEqual(ALL_OIDS.slice(7, 14));
    expect(second.stopReason).toBe(SnmpWalkStopReason.OidLimit);

    const third: NetworkDeviceDiagnosticSnmpWalkResult =
      await SnmpMonitor.walkOidTree(
        v2cConfig(),
        walkRequest({ maxOids: 7, afterOid: second.nextOid }),
      );

    expect(oidsOf(third)).toEqual(ALL_OIDS.slice(14));
    expect(third.stopReason).toBe(SnmpWalkStopReason.Complete);
    expect(third.nextOid).toBeUndefined();
  });

  test("never asks a device for more OIDs per request than the bulk size", async () => {
    const result: NetworkDeviceDiagnosticSnmpWalkResult =
      await SnmpMonitor.walkOidTree(
        v2cConfig(),
        walkRequest({ maxRepetitions: 4 }),
      );

    expect(oidsOf(result)).toEqual(ALL_OIDS);
    /*
     * 19 OIDs four at a time: the fifth answer carries the last three and
     * the end of the agent's MIB view, so no sixth request is needed.
     */
    expect(result.requestCount).toBe(Math.ceil(ALL_OIDS.length / 4));
  });

  test("pauses between requests", async () => {
    const startedAt: number = Date.now();

    const result: NetworkDeviceDiagnosticSnmpWalkResult =
      await SnmpMonitor.walkOidTree(
        v2cConfig(),
        walkRequest({ maxRepetitions: 4, pauseBetweenRequestsInMs: 40 }),
      );

    expect(oidsOf(result)).toEqual(ALL_OIDS);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(
      (result.requestCount - 1) * 40 - 5,
    );
  });
});

describe("SNMP v1", () => {
  test("walks with GETNEXT, one OID at a time, to the end of the subtree", async () => {
    const result: NetworkDeviceDiagnosticSnmpWalkResult =
      await SnmpMonitor.walkOidTree(
        v2cConfig({ snmpVersion: SnmpVersion.V1 }),
        walkRequest({ rootOid: "1.3.6.1.2.1.1" }),
      );

    expect(oidsOf(result)).toEqual(ALL_OIDS.slice(0, 5));
    expect(result.requestCount).toBe(6);
    expect(result.stopReason).toBe(SnmpWalkStopReason.Complete);
    expect(result.snmpVersion).toBe(SnmpVersion.V1);
  });
});

describe("SNMP v3", () => {
  test("walks with authentication", async () => {
    const result: NetworkDeviceDiagnosticSnmpWalkResult =
      await SnmpMonitor.walkOidTree(
        v3Config({
          username: "walker",
          securityLevel: SnmpSecurityLevel.AuthNoPriv,
          authProtocol: SnmpAuthProtocol.SHA,
          authKey: "walker-auth-passphrase",
        }),
        walkRequest({ rootOid: "1.3.6.1.2.1.1" }),
      );

    expect(result.failure).toBeUndefined();
    expect(oidsOf(result)).toEqual(ALL_OIDS.slice(0, 5));
    expect(result.snmpVersion).toBe(SnmpVersion.V3);
  });

  test("walks with authentication and privacy", async () => {
    const result: NetworkDeviceDiagnosticSnmpWalkResult =
      await SnmpMonitor.walkOidTree(
        v3Config({
          username: "private-walker",
          securityLevel: SnmpSecurityLevel.AuthPriv,
          authProtocol: SnmpAuthProtocol.SHA256,
          authKey: "private-auth-passphrase",
          privProtocol: SnmpPrivProtocol.AES,
          privKey: "private-priv-passphrase",
        }),
        walkRequest(),
      );

    expect(result.failure).toBeUndefined();
    expect(oidsOf(result)).toEqual(ALL_OIDS);
  });

  test("a user the device does not know is an authentication failure naming why", async () => {
    const result: NetworkDeviceDiagnosticSnmpWalkResult =
      await SnmpMonitor.walkOidTree(
        v3Config({
          username: "nobody",
          securityLevel: SnmpSecurityLevel.AuthNoPriv,
          authProtocol: SnmpAuthProtocol.SHA,
          authKey: "walker-auth-passphrase",
        }),
        walkRequest(),
      );

    expect(result.rows).toEqual([]);
    expect(result.stopReason).toBe(SnmpWalkStopReason.Failed);
    expect(result.failure?.kind).toBe(SnmpWalkFailureKind.Authentication);
    expect(result.failure?.authenticationReason).toBe(
      SnmpWalkAuthenticationReason.UnknownUser,
    );
  });

  /*
   * The agent's usmStats report travels the whole way: net-snmp's agent
   * answers a request for a user that needs authentication, sent without
   * it, with usmStatsWrongDigests.
   */
  test("a request below the user's security level is refused with the agent's report, naming why", async () => {
    const result: NetworkDeviceDiagnosticSnmpWalkResult =
      await SnmpMonitor.walkOidTree(
        v3Config({
          username: "walker",
          securityLevel: SnmpSecurityLevel.NoAuthNoPriv,
        }),
        walkRequest(),
      );

    expect(result.rows).toEqual([]);
    expect(result.stopReason).toBe(SnmpWalkStopReason.Failed);
    expect(result.failure?.kind).toBe(SnmpWalkFailureKind.Authentication);
    expect(result.failure?.authenticationReason).toBe(
      SnmpWalkAuthenticationReason.WrongDigest,
    );
  });

  test("a wrong authentication password does not walk", async () => {
    const result: NetworkDeviceDiagnosticSnmpWalkResult =
      await SnmpMonitor.walkOidTree(
        v3Config({
          username: "walker",
          securityLevel: SnmpSecurityLevel.AuthNoPriv,
          authProtocol: SnmpAuthProtocol.SHA,
          authKey: "not-the-passphrase",
        }),
        walkRequest(),
      );

    expect(result.rows).toEqual([]);
    expect(result.stopReason).toBe(SnmpWalkStopReason.Failed);
    /*
     * Net-SNMP's snmpd and most agents answer a wrong digest with
     * usmStatsWrongDigests (SnmpWalkErrorClassifier's tests read that
     * report); net-snmp's own agent drops the request, so here it is
     * silence. Either way nothing is read with a password that is not the
     * device's.
     */
    expect([
      SnmpWalkFailureKind.Authentication,
      SnmpWalkFailureKind.Timeout,
    ]).toContain(result.failure?.kind);
  });

  test("a wrong privacy password does not walk", async () => {
    const result: NetworkDeviceDiagnosticSnmpWalkResult =
      await SnmpMonitor.walkOidTree(
        v3Config({
          username: "private-walker",
          securityLevel: SnmpSecurityLevel.AuthPriv,
          authProtocol: SnmpAuthProtocol.SHA256,
          authKey: "private-auth-passphrase",
          privProtocol: SnmpPrivProtocol.AES,
          privKey: "not-the-privacy-passphrase",
        }),
        walkRequest(),
      );

    expect(result.rows).toEqual([]);
    expect(result.stopReason).toBe(SnmpWalkStopReason.Failed);
    /*
     * An agent that cannot decrypt the request reports a decryption error,
     * or - net-snmp's - drops it; either way nothing is read with a privacy
     * password that is not the device's.
     */
    expect([
      SnmpWalkFailureKind.Authentication,
      SnmpWalkFailureKind.Timeout,
    ]).toContain(result.failure?.kind);
  });

  test("a v3 config with no user name never sends a request", async () => {
    const result: NetworkDeviceDiagnosticSnmpWalkResult =
      await SnmpMonitor.walkOidTree(
        v3Config({
          username: "",
          securityLevel: SnmpSecurityLevel.NoAuthNoPriv,
        }),
        walkRequest(),
      );

    expect(result.requestCount).toBe(0);
    expect(result.failure?.kind).toBe(SnmpWalkFailureKind.Configuration);
  });
});

describe("a walk that cannot read the device", () => {
  test("a wrong community is silence: a timeout, which the dashboard explains as a likely community", async () => {
    const result: NetworkDeviceDiagnosticSnmpWalkResult =
      await SnmpMonitor.walkOidTree(
        v2cConfig({ communityString: "not-the-community" }),
        walkRequest(),
      );

    expect(result.rows).toEqual([]);
    expect(result.stopReason).toBe(SnmpWalkStopReason.Failed);
    expect(result.failure?.kind).toBe(SnmpWalkFailureKind.Timeout);
  });

  test("a v2c config with no community is refused, never walked as public", async () => {
    const result: NetworkDeviceDiagnosticSnmpWalkResult =
      await SnmpMonitor.walkOidTree(
        v2cConfig({ communityString: "" }),
        walkRequest(),
      );

    expect(result.requestCount).toBe(0);
    expect(result.failure?.kind).toBe(SnmpWalkFailureKind.Configuration);
  });

  test("nothing listening is a timeout", async () => {
    const closedPort: number = await findFreeUdpPort();

    const result: NetworkDeviceDiagnosticSnmpWalkResult =
      await SnmpMonitor.walkOidTree(
        v2cConfig({ port: closedPort }),
        walkRequest(),
      );

    expect(result.rows).toEqual([]);
    expect(result.failure?.kind).toBe(SnmpWalkFailureKind.Timeout);
  });

  test("a name that does not resolve is unreachable", async () => {
    const result: NetworkDeviceDiagnosticSnmpWalkResult =
      await SnmpMonitor.walkOidTree(
        v2cConfig({ hostname: "no-such-device.invalid" }),
        walkRequest(),
      );

    expect(result.rows).toEqual([]);
    expect(result.stopReason).toBe(SnmpWalkStopReason.Failed);
    expect(result.failure?.kind).toBe(SnmpWalkFailureKind.Unreachable);
  });
});
