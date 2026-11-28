import "../../TestingUtils/DiscoveryEnvironment";

import SnmpMonitor, {
  SnmpWalkResult,
} from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import SnmpEngineDiscovery from "../../../Utils/Snmp/SnmpEngineDiscovery";
import SnmpEngineIdReader from "../../../Utils/Snmp/SnmpEngineIdReader";
import {
  NetSnmpAgent,
  canStartNetSnmpAgent,
  startNetSnmpAgent,
} from "../../TestingUtils/NetSnmpAgent";
import { NET_SNMP_AGENT_ENGINE_ID } from "../../TestingUtils/NetSnmpEngineDiscoveryRecording";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A DEVICE POLLED OVER v1 OR v2c READS ITS ENGINE ID FROM NET-SNMP'S OWN
 * AGENT (OneUptime issue #11405).
 *
 * snmpd, set up as a device that sends SNMPv3 traps but is polled over
 * v1 or v2c: one community with a full view, and one with Net-SNMP's
 * `systemonly` view, which leaves snmpEngineID out. The probe's own walk
 * reads the engine ID over the first, and by SNMPv3 engine discovery at the
 * same address for the second - the engine the agent sends its traps as.
 *
 * Needs snmpd on PATH, or NET_SNMP_TOOLS_DOCKER_IMAGE naming an image that
 * has it (see TestingUtils/NetSnmpAgent). Without either, the suite is
 * skipped - the same exchanges are covered against net-snmp's own agent in
 * SnmpMonitorCommunityEngineId and against a recording of snmpd's answer in
 * SnmpEngineDiscovery.
 */

jest.setTimeout(180000);

const describeWithAgent: typeof describe.skip = canStartNetSnmpAgent()
  ? describe
  : describe.skip;

describeWithAgent("Net-SNMP's snmpd, polled over v1 and v2c", () => {
  let agent: NetSnmpAgent;

  beforeAll(async () => {
    agent = await startNetSnmpAgent([
      `exactEngineID 0x${NET_SNMP_AGENT_ENGINE_ID}`,
      "sysName engine-id-lab",
      "view systemonly included .1.3.6.1.2.1.1",
      "view systemonly included .1.3.6.1.2.1.25.1",
      "rocommunity public 127.0.0.1",
      "rocommunity restricted 127.0.0.1 -V systemonly",
      "createUser oneuptime-ro SHA authpass123 AES privpass123",
      "rouser oneuptime-ro authpriv",
    ]);
  });

  afterAll(() => {
    agent?.stop();
  });

  afterEach(async () => {
    await SnmpEngineIdReader.whenIdle();
    SnmpEngineIdReader.clear();
  });

  function config(
    version: SnmpVersion,
    community: string,
  ): MonitorStepSnmpMonitor {
    return {
      snmpVersion: version,
      hostname: "127.0.0.1",
      port: agent.port,
      communityString: community,
      oids: [],
      timeout: 5000,
      retries: 0,
      monitorInterfaces: true,
    };
  }

  function devicePoll(
    pollConfig: MonitorStepSnmpMonitor,
  ): Promise<SnmpWalkResult> {
    return SnmpMonitor.walkInterfaces(pollConfig, {
      timeout: 5000,
      readEngineId: true,
    });
  }

  test("over v2c with a full view: snmpEngineID over the device's own community", async () => {
    const walk: SnmpWalkResult = await devicePoll(
      config(SnmpVersion.V2c, "public"),
    );

    expect(walk.systemInfo?.sysName).toBe("engine-id-lab");
    expect(walk.systemInfo?.snmpEngineId).toBe(NET_SNMP_AGENT_ENGINE_ID);
  });

  test("over v1 with a full view, the same", async () => {
    expect(
      (await devicePoll(config(SnmpVersion.V1, "public"))).systemInfo
        ?.snmpEngineId,
    ).toBe(NET_SNMP_AGENT_ENGINE_ID);
  });

  test("over v2c with Net-SNMP's systemonly view: from the next poll on, by discovery", async () => {
    const first: SnmpWalkResult = await devicePoll(
      config(SnmpVersion.V2c, "restricted"),
    );

    expect(first.systemInfo?.sysName).toBe("engine-id-lab");
    expect(first.systemInfo?.snmpEngineId).toBeUndefined();

    await SnmpEngineIdReader.whenIdle();

    expect(
      (await devicePoll(config(SnmpVersion.V2c, "restricted"))).systemInfo
        ?.snmpEngineId,
    ).toBe(NET_SNMP_AGENT_ENGINE_ID);
  });

  test("over v1 with that view: a whole-PDU noSuchName for it costs the poll nothing", async () => {
    const first: SnmpWalkResult = await devicePoll(
      config(SnmpVersion.V1, "restricted"),
    );

    expect(first.systemInfo?.sysName).toBe("engine-id-lab");

    await SnmpEngineIdReader.whenIdle();

    expect(
      (await devicePoll(config(SnmpVersion.V1, "restricted"))).systemInfo
        ?.snmpEngineId,
    ).toBe(NET_SNMP_AGENT_ENGINE_ID);
  });

  test("discovery itself: snmpd's Report names its engine", async () => {
    expect(
      await SnmpEngineDiscovery.discover({
        host: "127.0.0.1",
        port: agent.port,
        timeoutMs: 5000,
      }),
    ).toBe(NET_SNMP_AGENT_ENGINE_ID);
  });
});
