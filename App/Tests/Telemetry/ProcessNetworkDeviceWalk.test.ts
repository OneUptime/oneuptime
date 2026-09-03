import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import NetworkDeviceWalkUtil from "Common/Server/Utils/Monitor/NetworkDeviceWalkUtil";
import type { ProbeIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ProcessProbeIngest imports the whole probe-response pipeline (monitor
 * resource evaluation, services, trap log writer). Only the walk processor
 * is under test, so everything else is stubbed out to keep this a unit
 * suite with no database/queue graph behind it.
 */
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return {
    __esModule: true,
    default: { monitorResource: jest.fn() },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/MonitorTestService", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/ProbeService", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Utils/Monitor/NetworkDeviceWalkUtil", () => {
  return {
    __esModule: true,
    default: {
      processWalkResult: jest.fn(),
      findMonitorsWatchingDevices: jest.fn(),
    },
  };
});

jest.mock("../../FeatureSet/Telemetry/Services/SnmpTrapLogWriter", () => {
  return { __esModule: true, default: {} };
});

import { processNetworkDeviceWalkFromQueue } from "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessProbeIngest";

const walkUtil: { processWalkResult: jest.Mock } =
  NetworkDeviceWalkUtil as unknown as { processWalkResult: jest.Mock };

const probeId: ObjectID = ObjectID.generate();
const networkDeviceId: ObjectID = ObjectID.generate();

const snmpResponse: JSONObject = {
  isOnline: true,
  oidResults: [{ oid: "1.3.6.1.2.1.1.1.0", value: "Cisco IOS" }],
};

function makeJobData(walk: JSONObject | undefined): ProbeIngestJobData {
  return {
    jobType: "network-device-walk",
    ingestionTimestamp: new Date(),
    networkDeviceWalk: walk,
  } as ProbeIngestJobData;
}

function makeWalkBody(overrides?: JSONObject): JSONObject {
  return {
    probeId: probeId.toString(),
    networkDeviceId: networkDeviceId.toString(),
    snmpResponse: snmpResponse,
    ...(overrides || {}),
  };
}

function processedArgs(): JSONObject {
  expect(walkUtil.processWalkResult).toHaveBeenCalledTimes(1);
  return walkUtil.processWalkResult.mock.calls[0]![0] as JSONObject;
}

describe("processNetworkDeviceWalkFromQueue", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    walkUtil.processWalkResult.mockResolvedValue(undefined as never);
  });

  test("rejects a job carrying no networkDeviceWalk body", async () => {
    await expect(
      processNetworkDeviceWalkFromQueue(makeJobData(undefined)),
    ).rejects.toThrow(BadDataException);

    expect(walkUtil.processWalkResult).not.toHaveBeenCalled();
  });

  test("rejects a walk with no probeId", async () => {
    const body: JSONObject = makeWalkBody();
    delete body["probeId"];

    await expect(
      processNetworkDeviceWalkFromQueue(makeJobData(body)),
    ).rejects.toThrow(BadDataException);

    expect(walkUtil.processWalkResult).not.toHaveBeenCalled();
  });

  test("rejects a walk with no networkDeviceId", async () => {
    const body: JSONObject = makeWalkBody();
    delete body["networkDeviceId"];

    await expect(
      processNetworkDeviceWalkFromQueue(makeJobData(body)),
    ).rejects.toThrow(BadDataException);

    expect(walkUtil.processWalkResult).not.toHaveBeenCalled();
  });

  /*
   * The guard validates the RAW body fields — checking a deserialized
   * value would be dead code, since JSONFunctions.deserialize(undefined)
   * returns `{}`, a truthy object. Only a body with NEITHER a walk nor a
   * boolean device verdict is rejected: it says nothing about the device.
   */
  test("rejects a walk carrying neither snmpResponse nor a boolean isOnline", async () => {
    const body: JSONObject = makeWalkBody();
    delete body["snmpResponse"];

    await expect(
      processNetworkDeviceWalkFromQueue(makeJobData(body)),
    ).rejects.toThrow(BadDataException);

    expect(walkUtil.processWalkResult).not.toHaveBeenCalled();
  });

  test("a non-boolean isOnline is not a verdict: rejected when there is no walk either", async () => {
    const body: JSONObject = makeWalkBody({ isOnline: "true" });
    delete body["snmpResponse"];

    await expect(
      processNetworkDeviceWalkFromQueue(makeJobData(body)),
    ).rejects.toThrow(BadDataException);

    expect(walkUtil.processWalkResult).not.toHaveBeenCalled();
  });

  test("hands the walk to NetworkDeviceWalkUtil with ObjectID-wrapped ids and the reported time", async () => {
    const monitoredAt: string = "2026-07-25T10:15:30.000Z";

    await processNetworkDeviceWalkFromQueue(
      makeJobData(makeWalkBody({ monitoredAt: monitoredAt })),
    );

    const args: JSONObject = processedArgs();

    expect(args["probeId"]).toBeInstanceOf(ObjectID);
    expect((args["probeId"] as ObjectID).toString()).toBe(probeId.toString());

    expect(args["networkDeviceId"]).toBeInstanceOf(ObjectID);
    expect((args["networkDeviceId"] as ObjectID).toString()).toBe(
      networkDeviceId.toString(),
    );

    expect(args["snmpResponse"]).toEqual(snmpResponse);

    const stampedAt: Date = args["monitoredAt"] as Date;
    expect(stampedAt).toBeInstanceOf(Date);
    expect(stampedAt.toISOString()).toBe(monitoredAt);
  });

  /*
   * Probe skew. Two probe generations report here and the processor has to
   * hand the pipeline ONE shape whichever posted. Each body below is what a
   * real probe sends; the matrix is what the pipeline must receive.
   */
  describe("probe skew: what each body shape derives", () => {
    const failedWalk: JSONObject = {
      isOnline: false,
      responseTimeInMs: 0,
      failureCause: "SNMP timed out after 3 attempts",
      oidResponses: [],
    };
    const okPing: JSONObject = {
      isOnline: true,
      avgRttMs: 2.5,
      packetLossPercent: 0,
    };
    const failedPing: JSONObject = {
      isOnline: false,
      packetLossPercent: 100,
      failureCause: "Request timed out",
    };

    test("an old probe's successful walk: the walk verdict is the device verdict, mode snmp, no ping", async () => {
      await processNetworkDeviceWalkFromQueue(makeJobData(makeWalkBody()));

      const args: JSONObject = processedArgs();
      expect(args["isOnline"]).toBe(true);
      expect(args["pollMode"]).toBe("snmp");
      expect(args["pingResponse"]).toBeUndefined();
      expect(args["snmpResponse"]).toEqual(snmpResponse);
    });

    test("an old probe's failed walk: device verdict false, mode snmp", async () => {
      await processNetworkDeviceWalkFromQueue(
        makeJobData(makeWalkBody({ snmpResponse: failedWalk })),
      );

      const args: JSONObject = processedArgs();
      expect(args["isOnline"]).toBe(false);
      expect(args["pollMode"]).toBe("snmp");
      expect(args["snmpResponse"]).toEqual(failedWalk);
    });

    test("an old probe's walk with no verdict at all counts as answered (the inventory's convention)", async () => {
      await processNetworkDeviceWalkFromQueue(
        makeJobData(
          makeWalkBody({
            snmpResponse: { oidResponses: [], responseTimeInMs: 5 },
          }),
        ),
      );

      expect(processedArgs()["isOnline"]).toBe(true);
    });

    test("a ping-first probe's ping-mode poll: the body's verdict, mode ping, the ping, and NO walk", async () => {
      const body: JSONObject = makeWalkBody({
        isOnline: true,
        pollMode: "ping",
        pingResponse: okPing,
      });
      delete body["snmpResponse"];

      await processNetworkDeviceWalkFromQueue(makeJobData(body));

      const args: JSONObject = processedArgs();
      expect(args["isOnline"]).toBe(true);
      expect(args["pollMode"]).toBe("ping");
      expect(args["pingResponse"]).toEqual(okPing);
      // Never synthesized from the ping.
      expect(args["snmpResponse"]).toBeUndefined();
    });

    test("a ping-first probe's unreachable ping-mode poll: verdict false is a verdict, not a missing field", async () => {
      const body: JSONObject = makeWalkBody({
        isOnline: false,
        pollMode: "ping",
        pingResponse: failedPing,
      });
      delete body["snmpResponse"];

      await processNetworkDeviceWalkFromQueue(makeJobData(body));

      const args: JSONObject = processedArgs();
      expect(args["isOnline"]).toBe(false);
      expect(args["pollMode"]).toBe("ping");
      expect(args["pingResponse"]).toEqual(failedPing);
      expect(args["snmpResponse"]).toBeUndefined();
    });

    test("a ping-first probe's successful snmp-mode poll carries the ping AND the walk", async () => {
      await processNetworkDeviceWalkFromQueue(
        makeJobData(
          makeWalkBody({
            isOnline: true,
            pollMode: "snmp",
            pingResponse: okPing,
          }),
        ),
      );

      const args: JSONObject = processedArgs();
      expect(args["isOnline"]).toBe(true);
      expect(args["pollMode"]).toBe("snmp");
      expect(args["pingResponse"]).toEqual(okPing);
      expect(args["snmpResponse"]).toEqual(snmpResponse);
    });

    test("a ping-first probe's snmp-mode poll that failed both ways: verdict false, the failed walk kept as the real walk", async () => {
      await processNetworkDeviceWalkFromQueue(
        makeJobData(
          makeWalkBody({
            isOnline: false,
            pollMode: "snmp",
            pingResponse: failedPing,
            snmpResponse: failedWalk,
          }),
        ),
      );

      const args: JSONObject = processedArgs();
      expect(args["isOnline"]).toBe(false);
      expect(args["pollMode"]).toBe("snmp");
      expect(args["pingResponse"]).toEqual(failedPing);
      expect(args["snmpResponse"]).toEqual(failedWalk);
    });

    /*
     * ICMP-filtered SNMP gear: the ping fails but the walk succeeds, and
     * the probe reports the device reachable. The processor trusts the
     * probe's verdict rather than recomputing it from the ping.
     */
    test("the body's verdict is trusted over the ping: ping failed + walk ok stays reachable", async () => {
      await processNetworkDeviceWalkFromQueue(
        makeJobData(
          makeWalkBody({
            isOnline: true,
            pollMode: "snmp",
            pingResponse: failedPing,
          }),
        ),
      );

      expect(processedArgs()["isOnline"]).toBe(true);
    });

    test('only an explicit "ping" reads as ping mode; anything else is the snmp a walking probe implies', async () => {
      await processNetworkDeviceWalkFromQueue(
        makeJobData(makeWalkBody({ pollMode: "SNMPv3" })),
      );
      expect(processedArgs()["pollMode"]).toBe("snmp");

      jest.clearAllMocks();
      walkUtil.processWalkResult.mockResolvedValue(undefined as never);

      await processNetworkDeviceWalkFromQueue(
        makeJobData(makeWalkBody({ pollMode: 7 })),
      );
      expect(processedArgs()["pollMode"]).toBe("snmp");
    });
  });

  test("an unparseable monitoredAt falls back to now instead of poisoning the pipeline with Invalid Date", async () => {
    const before: number = Date.now();
    await processNetworkDeviceWalkFromQueue(
      makeJobData(makeWalkBody({ monitoredAt: "not-a-timestamp" })),
    );
    const after: number = Date.now();

    const stampedAt: Date = processedArgs()["monitoredAt"] as Date;
    expect(stampedAt).toBeInstanceOf(Date);
    expect(Number.isNaN(stampedAt.getTime())).toBe(false);
    expect(stampedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(stampedAt.getTime()).toBeLessThanOrEqual(after + 1000);
  });

  test("a missing monitoredAt is stamped with now — every walk carries a valid Date", async () => {
    const before: number = Date.now();
    await processNetworkDeviceWalkFromQueue(makeJobData(makeWalkBody()));
    const after: number = Date.now();

    const stampedAt: Date = processedArgs()["monitoredAt"] as Date;
    expect(stampedAt).toBeInstanceOf(Date);
    expect(stampedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(stampedAt.getTime()).toBeLessThanOrEqual(after + 1000);
  });
});
