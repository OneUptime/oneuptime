// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import dgram from "dgram";
import snmp from "net-snmp";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpHardwareIdentity from "Common/Types/Monitor/SnmpMonitor/SnmpHardwareIdentity";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpSystemInfo from "Common/Types/Monitor/SnmpMonitor/SnmpSystemInfo";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";

/*
 * What a discovery scan asks a host next, over a real UDP socket: a net-snmp
 * agent on loopback set up as a FortiGate would be, read by the probe's own
 * SnmpMonitor.probeHardwareIdentity with a config shaped the way the scanner
 * builds it, over SNMP v1, v2c and v3.
 *
 * The other half is what the session really does when a device stops answering,
 * which a scripted session can only be told: a relay in front of the agent
 * drops every request for ENTITY-MIB, as a Meraki device does ("fails to
 * respond"), and a socket that answers nothing stands in for a host that went
 * silent after its system group.
 */

const COMMUNITY: string = "oneuptime-scan";

const USER: snmp.User = {
  name: "scanner",
  level: snmp.SecurityLevel.authNoPriv,
  authProtocol: snmp.AuthProtocols.sha,
  authKey: "scanner-auth-passphrase",
};

const SYS_OBJECT_ID: string = "1.3.6.1.4.1.12356.101.1.60";

const SERIAL_NUMBER: string = "FG100FTK20012345";
const FIRMWARE: string = "v7.2.6,build1575,230926 (GA.F)";

// A short timeout: these wait out real ones.
const TIMEOUT_IN_MS: number = 150;

// 1.3.6.1.2.1.47, as it sits on the wire inside any request for ENTITY-MIB.
const ENTITY_MIB_ON_THE_WIRE: Buffer = Buffer.from([
  0x2b, 0x06, 0x01, 0x02, 0x01, 0x2f,
]);

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

let relay: dgram.Socket | undefined = undefined;
let relayPort: number = 0;
// Requests for ENTITY-MIB the relay has dropped.
let droppedRequests: number = 0;

let silentSocket: dgram.Socket | undefined = undefined;
let silentPort: number = 0;

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

function bindSocket(socket: dgram.Socket): Promise<number> {
  return new Promise((resolve: (port: number) => void) => {
    socket.bind(0, "127.0.0.1", () => {
      resolve(socket.address().port);
    });
  });
}

function column(
  number: number,
  name: string,
  type: number,
  maxAccess: number = snmp.MaxAccess["read-only"],
): Record<string, unknown> {
  return { number: number, name: name, type: type, maxAccess: maxAccess };
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

function config(
  overrides: Partial<MonitorStepSnmpMonitor> = {},
): MonitorStepSnmpMonitor {
  return {
    snmpVersion: SnmpVersion.V2c,
    hostname: "127.0.0.1",
    port: agentPort,
    communityString: COMMUNITY,
    oids: [],
    timeout: 2000,
    retries: 0,
    ...overrides,
  } as MonitorStepSnmpMonitor;
}

const EVERYTHING: SnmpHardwareIdentity = {
  scannedMacAddress: "70:4c:a5:12:34:56",
  model: "FortiGate-100F",
  serialNumber: SERIAL_NUMBER,
  firmwareVersion: FIRMWARE,
  softwareVersion: "7.2.6",
};

beforeAll(async () => {
  agentPort = await findFreeUdpPort();

  agent = snmp.createAgent(
    { port: agentPort, disableAuthorization: false },
    () => {
      // Agent-side errors surface to the client as a timeout.
    },
  ) as unknown as SnmpAgent;

  agent.getAuthorizer().addCommunity(COMMUNITY);
  agent.getAuthorizer().addUser(USER);

  scalar({
    name: "sysObjectID",
    oid: "1.3.6.1.2.1.1.2",
    type: snmp.ObjectType.OID,
    value: SYS_OBJECT_ID,
  });
  scalar({
    name: "sysName",
    oid: "1.3.6.1.2.1.1.5",
    type: snmp.ObjectType.OctetString,
    value: "fw-branch-12",
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
      column(3, "ifType", snmp.ObjectType.Integer),
      column(6, "ifPhysAddress", snmp.ObjectType.OctetString),
    ],
    tableIndex: [{ columnName: "ifIndex" }],
  });

  // A loopback, then the first Ethernet port, then the second.
  agent.getMib().addTableRow("ifEntry", [1, 24, Buffer.alloc(0)]);
  agent
    .getMib()
    .addTableRow("ifEntry", [
      2,
      6,
      Buffer.from([0x70, 0x4c, 0xa5, 0x12, 0x34, 0x56]),
    ]);
  agent
    .getMib()
    .addTableRow("ifEntry", [
      3,
      6,
      Buffer.from([0x70, 0x4c, 0xa5, 0x12, 0x34, 0x57]),
    ]);

  agent.getMib().registerProvider({
    name: "entPhysicalEntry",
    type: snmp.MibProviderType.Table,
    oid: "1.3.6.1.2.1.47.1.1.1.1",
    maxAccess: snmp.MaxAccess["not-accessible"],
    tableColumns: [
      column(
        1,
        "entPhysicalIndex",
        snmp.ObjectType.Integer,
        snmp.MaxAccess["not-accessible"],
      ),
      column(5, "entPhysicalClass", snmp.ObjectType.Integer),
      column(11, "entPhysicalSerialNum", snmp.ObjectType.OctetString),
      column(13, "entPhysicalModelName", snmp.ObjectType.OctetString),
    ],
    tableIndex: [{ columnName: "entPhysicalIndex" }],
  });

  // A power supply below the chassis in the table, with a serial of its own.
  agent
    .getMib()
    .addTableRow("entPhysicalEntry", [1, 6, "PSU-0001", "PWR-100F"]);
  agent
    .getMib()
    .addTableRow("entPhysicalEntry", [2, 3, SERIAL_NUMBER, "FortiGate-100F"]);

  scalar({
    name: "fgSysVersion",
    oid: "1.3.6.1.4.1.12356.101.4.1.1",
    type: snmp.ObjectType.OctetString,
    value: FIRMWARE,
  });

  /*
   * In front of the agent: forwards every datagram both ways except a request
   * for ENTITY-MIB, which it drops, so a client sees a device that fails to
   * respond rather than an empty table.
   */
  relay = dgram.createSocket("udp4");

  const clientByUpstream: Map<number, { port: number; address: string }> =
    new Map();

  relay.on("message", (message: Buffer, from: dgram.RemoteInfo) => {
    if (from.port === agentPort) {
      const client: { port: number; address: string } | undefined =
        clientByUpstream.get(from.port);

      if (client) {
        relay!.send(message, client.port, client.address);
      }
      return;
    }

    if (message.includes(ENTITY_MIB_ON_THE_WIRE)) {
      droppedRequests++;
      return;
    }

    clientByUpstream.set(agentPort, {
      port: from.port,
      address: from.address,
    });
    relay!.send(message, agentPort, "127.0.0.1");
  });

  relayPort = await bindSocket(relay);

  silentSocket = dgram.createSocket("udp4");
  silentPort = await bindSocket(silentSocket);
});

afterAll(() => {
  agent?.close();
  relay?.close();
  silentSocket?.close();
});

describe("a real agent answering a scan's follow-up read", () => {
  test("the host's system group, as a sweep reads it first", async () => {
    const systemInfo: SnmpSystemInfo | null =
      await SnmpMonitor.probeSystemInfo(config());

    expect(systemInfo?.sysObjectId).toBe(SYS_OBJECT_ID);
  });

  test("over SNMP v2c: its first Ethernet port, its chassis row and its vendor's MIB", async () => {
    await expect(
      SnmpMonitor.probeHardwareIdentity(config(), SYS_OBJECT_ID),
    ).resolves.toEqual(EVERYTHING);
  });

  test("over SNMP v1, which walks with GETNEXT", async () => {
    await expect(
      SnmpMonitor.probeHardwareIdentity(
        config({ snmpVersion: SnmpVersion.V1 }),
        SYS_OBJECT_ID,
      ),
    ).resolves.toEqual(EVERYTHING);
  });

  test("over SNMP v3, whose first request is engine discovery", async () => {
    await expect(
      SnmpMonitor.probeHardwareIdentity(
        config({
          snmpVersion: SnmpVersion.V3,
          communityString: "",
          snmpV3Auth: {
            securityLevel: SnmpSecurityLevel.AuthNoPriv,
            username: USER.name,
            authProtocol: SnmpAuthProtocol.SHA,
            authKey: USER.authKey as string,
          },
        }),
        SYS_OBJECT_ID,
      ),
    ).resolves.toEqual(EVERYTHING);
  });

  test("a host of no listed platform is read no further than the standard MIBs", async () => {
    await expect(
      SnmpMonitor.probeHardwareIdentity(config(), "1.3.6.1.4.1.9.1.1208"),
    ).resolves.toEqual({
      scannedMacAddress: "70:4c:a5:12:34:56",
      model: "FortiGate-100F",
      serialNumber: SERIAL_NUMBER,
    });
  });
});

describe("a real session when a device stops answering", () => {
  test("a device that fails to respond about ENTITY-MIB keeps the MAC it gave", async () => {
    droppedRequests = 0;

    await expect(
      SnmpMonitor.probeHardwareIdentity(
        config({ port: relayPort, timeout: TIMEOUT_IN_MS }),
        "1.3.6.1.4.1.29671.2.111",
      ),
    ).resolves.toEqual({ scannedMacAddress: "70:4c:a5:12:34:56" });

    // One timeout, not one per column: silence ends the ENTITY-MIB part.
    expect(droppedRequests).toBe(1);
  });

  test("the same device on a listed platform still answers its vendor's MIB", async () => {
    await expect(
      SnmpMonitor.probeHardwareIdentity(
        config({ port: relayPort, timeout: TIMEOUT_IN_MS }),
        SYS_OBJECT_ID,
      ),
    ).resolves.toEqual({
      scannedMacAddress: "70:4c:a5:12:34:56",
      firmwareVersion: FIRMWARE,
      softwareVersion: "7.2.6",
    });
  });

  test("a host that goes silent reads as nothing, and the read ends", async () => {
    await expect(
      SnmpMonitor.probeHardwareIdentity(
        config({ port: silentPort, timeout: TIMEOUT_IN_MS }),
        "1.3.6.1.4.1.9.1.1208",
      ),
    ).resolves.toEqual({});
  });

  test("a wrong community is silence too", async () => {
    await expect(
      SnmpMonitor.probeHardwareIdentity(
        config({ communityString: "wrong", timeout: TIMEOUT_IN_MS }),
        SYS_OBJECT_ID,
      ),
    ).resolves.toEqual({});
  });

  test("the scan's abort ends a request in flight, at once", async () => {
    const controller: AbortController = new AbortController();
    const reason: Error = new Error("sweep deadline");
    const startedAt: number = Date.now();

    const reading: Promise<SnmpHardwareIdentity> =
      SnmpMonitor.probeHardwareIdentity(
        config({ port: silentPort, timeout: 60000 }),
        SYS_OBJECT_ID,
        controller.signal,
      );

    setTimeout(() => {
      controller.abort(reason);
    }, 50);

    await expect(reading).rejects.toBe(reason);
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });
});
