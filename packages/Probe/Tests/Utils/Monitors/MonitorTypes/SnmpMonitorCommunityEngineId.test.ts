import "../../../TestingUtils/DiscoveryEnvironment";

import SnmpMonitor, {
  SnmpWalkResult,
} from "../../../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import SnmpEngineIdReader from "../../../../Utils/Snmp/SnmpEngineIdReader";
import RecordedSnmpAgent, {
  simulatorRecording,
} from "../../../TestingUtils/RecordedSnmpAgent";
import {
  SHARED_ADDRESS_DEVICES,
  SharedAddressDeviceKey,
} from "Common/Tests/Helpers/Snmp/SharedAddressSnmpV3Traps";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpSecurityLevel from "Common/Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import snmp from "net-snmp";

/*
 * A DEVICE POLLED OVER v1 OR v2c READS ITS SNMP ENGINE ID (OneUptime issue
 * #11405).
 *
 * The walk a network device's poll runs, against net-snmp's own agent
 * replaying the simulator's switch-a recording over a real socket, as the
 * agent of a device that sends its traps as SNMPv3 would answer: its
 * community's view with SNMP-FRAMEWORK-MIB's snmpEngine group in it, a view
 * that leaves it out, and no SNMPv3 at all. Before #11405 a v1 or v2c walk
 * read no engine ID at all, so devices that send SNMPv3 traps from one
 * address were told apart only once they were polled over SNMPv3.
 */

jest.setTimeout(60000);

const SWITCH_A: string = simulatorRecording("switch-a", "public.snmprec");
const ENGINE: string = "800000090300AABBCC114057";

// switch-a's sysName, as the recording has it.
const SWITCH_A_SYS_NAME: string = "switch-a";

const agents: Array<RecordedSnmpAgent> = [];

afterEach(async () => {
  await SnmpEngineIdReader.whenIdle();
  SnmpEngineIdReader.clear();

  for (const agent of agents.splice(0)) {
    agent.close();
  }
});

async function agent(
  options: Partial<Parameters<typeof RecordedSnmpAgent.start>[0]>,
): Promise<RecordedSnmpAgent> {
  const started: RecordedSnmpAgent = await RecordedSnmpAgent.start({
    recording: SWITCH_A,
    community: "public",
    engineId: ENGINE,
    ...options,
  });
  agents.push(started);
  return started;
}

function config(
  lab: RecordedSnmpAgent,
  overrides: Partial<MonitorStepSnmpMonitor> = {},
): MonitorStepSnmpMonitor {
  return {
    snmpVersion: SnmpVersion.V2c,
    hostname: "127.0.0.1",
    port: lab.port,
    communityString: "public",
    oids: [],
    timeout: 3000,
    retries: 0,
    monitorInterfaces: true,
    ...overrides,
  };
}

// A network device's poll: the walk asks for the engine ID.
function devicePoll(
  pollConfig: MonitorStepSnmpMonitor,
): Promise<SnmpWalkResult> {
  return SnmpMonitor.walkInterfaces(pollConfig, {
    timeout: 3000,
    readEngineId: true,
  });
}

// snmpEngineID.0's OID, as BER encodes it in a request.
const ENGINE_ID_OID_BER: Buffer = Buffer.from(
  "060a2b060106030a02010100",
  "hex",
);

function askedForEngineId(lab: RecordedSnmpAgent): number {
  return lab.requests.filter(
    (request: { isSnmpV3: boolean; datagram: Buffer }) => {
      return (
        !request.isSnmpV3 && request.datagram.indexOf(ENGINE_ID_OID_BER) >= 0
      );
    },
  ).length;
}

function snmpV3Sent(lab: RecordedSnmpAgent): number {
  return lab.requests.filter((request: { isSnmpV3: boolean }) => {
    return request.isSnmpV3;
  }).length;
}

describe("a v2c poll", () => {
  test("of an agent whose view includes snmpEngineID reads it over the device's own community, in the poll", async () => {
    const lab: RecordedSnmpAgent = await agent({ servesSnmpEngineGroup: true });

    const walk: SnmpWalkResult = await devicePoll(config(lab));

    expect(walk.systemInfo?.sysName).toBe(SWITCH_A_SYS_NAME);
    expect(walk.systemInfo?.snmpEngineId).toBe(ENGINE);
    expect(askedForEngineId(lab)).toBe(1);
    // No SNMPv3 sent: the community said it.
    expect(snmpV3Sent(lab)).toBe(0);
  });

  test("of an agent whose view leaves it out has it from the next poll on, by SNMPv3 discovery at its polling address", async () => {
    const lab: RecordedSnmpAgent = await agent({});

    const first: SnmpWalkResult = await devicePoll(config(lab));

    // The poll never waits for discovery.
    expect(first.systemInfo?.sysName).toBe(SWITCH_A_SYS_NAME);
    expect(first.systemInfo?.snmpEngineId).toBeUndefined();

    await SnmpEngineIdReader.whenIdle();

    const second: SnmpWalkResult = await devicePoll(config(lab));

    expect(second.systemInfo?.snmpEngineId).toBe(ENGINE);
    expect(snmpV3Sent(lab)).toBe(1);
    // The community is not asked again within the hour.
    expect(askedForEngineId(lab)).toBe(1);
  });

  test("of an agent with no SNMPv3 reads none, and sends it one discovery, not one a poll", async () => {
    const lab: RecordedSnmpAgent = await agent({ answersSnmpV3: false });

    for (let poll: number = 0; poll < 3; poll++) {
      const walk: SnmpWalkResult = await devicePoll(config(lab));

      expect(walk.systemInfo?.sysName).toBe(SWITCH_A_SYS_NAME);
      expect(walk.systemInfo?.snmpEngineId).toBeUndefined();

      await SnmpEngineIdReader.whenIdle();
    }

    expect(snmpV3Sent(lab)).toBe(1);
    expect(askedForEngineId(lab)).toBe(1);
  });

  test("for a monitor, not a device's poll, asks nothing more: no engine ID, no extra request", async () => {
    const lab: RecordedSnmpAgent = await agent({ servesSnmpEngineGroup: true });

    const walk: SnmpWalkResult = await SnmpMonitor.walkInterfaces(config(lab), {
      timeout: 3000,
    });

    expect(walk.systemInfo?.sysName).toBe(SWITCH_A_SYS_NAME);
    expect(walk.systemInfo?.snmpEngineId).toBeUndefined();
    expect(askedForEngineId(lab)).toBe(0);
    expect(snmpV3Sent(lab)).toBe(0);
  });
});

describe("a v1 poll", () => {
  test("reads it in a GET of its own, beside a system group read as before", async () => {
    const lab: RecordedSnmpAgent = await agent({ servesSnmpEngineGroup: true });

    const walk: SnmpWalkResult = await devicePoll(
      config(lab, { snmpVersion: SnmpVersion.V1 }),
    );

    expect(walk.systemInfo?.sysName).toBe(SWITCH_A_SYS_NAME);
    expect(walk.systemInfo?.snmpEngineId).toBe(ENGINE);
  });

  test("of an agent without it still reads its system group: an SNMPv1 agent fails a whole GET for an object it lacks", async () => {
    const lab: RecordedSnmpAgent = await agent({});

    const walk: SnmpWalkResult = await devicePoll(
      config(lab, { snmpVersion: SnmpVersion.V1 }),
    );

    expect(walk.systemInfo?.sysName).toBe(SWITCH_A_SYS_NAME);
    expect(walk.systemInfo?.sysDescr).toBeTruthy();
    expect(walk.interfaces.length).toBeGreaterThan(0);

    await SnmpEngineIdReader.whenIdle();

    expect(
      (await devicePoll(config(lab, { snmpVersion: SnmpVersion.V1 })))
        .systemInfo?.snmpEngineId,
    ).toBe(ENGINE);
  });
});

describe("an SNMPv3 poll, as before", () => {
  test("reads the engine from its own discovery, and asks nothing more", async () => {
    const lab: RecordedSnmpAgent = await agent({
      servesSnmpEngineGroup: true,
      users: [
        {
          name: "lab",
          level: snmp.SecurityLevel.authNoPriv,
          authProtocol: snmp.AuthProtocols.sha,
          authKey: "lab-auth-passphrase",
        },
      ],
    });

    const walk: SnmpWalkResult = await devicePoll(
      config(lab, {
        snmpVersion: SnmpVersion.V3,
        communityString: undefined,
        snmpV3Auth: {
          securityLevel: SnmpSecurityLevel.AuthNoPriv,
          username: "lab",
          authProtocol: SnmpAuthProtocol.SHA,
          authKey: "lab-auth-passphrase",
        },
      }),
    );

    expect(walk.systemInfo?.snmpEngineId).toBe(ENGINE);
    expect(askedForEngineId(lab)).toBe(0);
  });
});

describe("the two switches that share their site's default SNMPv3 user (#11172's recorded traps)", () => {
  /*
   * Polled over v2c, each reads the engine its recorded traps were sent as
   * (Common/Tests/Helpers/Snmp/SharedAddressSnmpV3Traps): what tells their
   * traps apart at the address they share
   * (App/Tests/Telemetry/ProcessSnmpTrapV2cPolledEngineIds).
   */
  test.each(["siteSwitch1", "siteSwitch2"] as Array<SharedAddressDeviceKey>)(
    "%s, polled over v2c, reads the engine its traps are sent as",
    async (key: SharedAddressDeviceKey) => {
      const lab: RecordedSnmpAgent = await agent({
        engineId: SHARED_ADDRESS_DEVICES[key].engineId,
        servesSnmpEngineGroup: true,
      });

      expect((await devicePoll(config(lab))).systemInfo?.snmpEngineId).toBe(
        SHARED_ADDRESS_DEVICES[key].engineId,
      );
    },
  );
});
