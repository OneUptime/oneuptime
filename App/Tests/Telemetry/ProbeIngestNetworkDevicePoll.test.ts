import { mockRouter } from "Common/Tests/Server/API/Helpers";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Probe from "Common/Models/DatabaseModels/Probe";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import TelemetryQueueService from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

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

jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      claimDevicesForPolling: jest.fn(),
      findBy: jest.fn(),
    },
  };
});

jest.mock("../../FeatureSet/Telemetry/Middleware/ProbeAuthorization", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: jest.fn(),
    },
  };
});

/*
 * The queue module pulls in BullMQ at import time; the contract under test
 * is only "what job body is enqueued".
 */
jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addNetworkDeviceWalkJob: jest.fn(),
      },
    };
  },
);

/*
 * Importing the router module registers its routes on the mocked router so
 * each handler can be invoked directly. The probe-auth middleware is mocked
 * out; tests attach `req.probe` themselves, exactly what the middleware
 * does after validating probeId + probeKey.
 */
import "../../FeatureSet/Telemetry/API/ProbeIngest/NetworkDevicePoll";

const deviceService: {
  claimDevicesForPolling: jest.Mock;
  findBy: jest.Mock;
} = NetworkDeviceService as unknown as {
  claimDevicesForPolling: jest.Mock;
  findBy: jest.Mock;
};

const queueService: { addNetworkDeviceWalkJob: jest.Mock } =
  TelemetryQueueService as unknown as { addNetworkDeviceWalkJob: jest.Mock };

const responseUtil: {
  sendErrorResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
} = Response as unknown as {
  sendErrorResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
};

const loggerMock: { warn: jest.Mock; debug: jest.Mock } = logger as unknown as {
  warn: jest.Mock;
  debug: jest.Mock;
};

/*
 * The claim batch size, restated here rather than imported: it is not
 * exported, and it is precisely the number these tests exist to hold
 * still. It is also the ceiling on how fast one probe's fleet can be
 * polled — the probe fetches once a minute, so a probe can never poll more
 * than this many devices per minute (see the constant's comment in
 * NetworkDevicePoll.ts and issue #3220).
 */
const DEVICE_POLL_FETCH_LIMIT: number = 250;

function makeRequest(data: {
  probeId?: ObjectID | undefined;
  body?: JSONObject | undefined;
}): ExpressRequest {
  const req: JSONObject = {
    body: data.body || {},
  };

  if (data.probeId) {
    req["probe"] = new Probe(data.probeId);
  }

  return req as unknown as ExpressRequest;
}

const mockResponse: ExpressResponse = {} as ExpressResponse;

type CallEndpointFunction = (
  req: ExpressRequest,
) => Promise<{ next: NextFunction }>;

function endpointCaller(uri: string): CallEndpointFunction {
  return async (req: ExpressRequest): Promise<{ next: NextFunction }> => {
    const next: NextFunction = jest.fn() as unknown as NextFunction;
    await mockRouter
      .match("post", uri)
      .handlerFunction(req, mockResponse, next);
    return { next };
  };
}

const callListEndpoint: CallEndpointFunction = endpointCaller(
  "/probe/network-device/list",
);
const callIngestEndpoint: CallEndpointFunction = endpointCaller(
  "/probe/network-device/response/ingest",
);

function makeDevice(data: {
  id: ObjectID;
  projectId?: ObjectID | undefined;
  hostname?: string | undefined;
  walkInterfaces?: boolean | undefined;
  collectEndpoints?: boolean | undefined;
  snmpOids?:
    | Array<{
        oid: string;
        name?: string | undefined;
        description?: string | undefined;
      }>
    | undefined;
  snmpVersion?: string | undefined;
  snmpCommunityString?: string | undefined;
  snmpPort?: number | undefined;
}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(data.id);

  if (data.projectId) {
    device.projectId = data.projectId;
  }
  if (data.hostname !== undefined) {
    device.hostname = data.hostname;
  }
  if (data.walkInterfaces !== undefined) {
    device.walkInterfaces = data.walkInterfaces;
  }
  if (data.collectEndpoints !== undefined) {
    device.collectEndpoints = data.collectEndpoints;
  }
  if (data.snmpOids !== undefined) {
    device.snmpOids = data.snmpOids;
  }
  if (data.snmpVersion !== undefined) {
    device.snmpVersion = data.snmpVersion;
  }
  if (data.snmpCommunityString !== undefined) {
    device.snmpCommunityString = data.snmpCommunityString;
  }
  if (data.snmpPort !== undefined) {
    device.snmpPort = data.snmpPort;
  }

  return device;
}

function respondedDevices(): Array<JSONObject> {
  expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  const payload: JSONObject = responseUtil.sendJsonObjectResponse.mock
    .calls[0]![2] as JSONObject;
  return payload["devices"] as Array<JSONObject>;
}

describe("POST /probe/network-device/list", () => {
  const probeId: ObjectID = ObjectID.generate();
  const projectId: ObjectID = ObjectID.generate();

  beforeEach(() => {
    jest.clearAllMocks();
    deviceService.claimDevicesForPolling.mockResolvedValue([] as never);
    deviceService.findBy.mockResolvedValue([] as never);
  });

  test("rejects a request with no authenticated probe", async () => {
    await callListEndpoint(makeRequest({}));

    expect(deviceService.claimDevicesForPolling).not.toHaveBeenCalled();
    expect(deviceService.findBy).not.toHaveBeenCalled();
    expect(responseUtil.sendErrorResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      expect.any(BadDataException),
    );
  });

  test("claims for the requesting probe with the batch limit, and an empty claim responds {devices: []} without fetching", async () => {
    const { next } = await callListEndpoint(makeRequest({ probeId }));

    expect(next).not.toHaveBeenCalled();

    expect(deviceService.claimDevicesForPolling).toHaveBeenCalledTimes(1);
    const claimArgs: JSONObject = deviceService.claimDevicesForPolling.mock
      .calls[0]![0] as JSONObject;
    expect((claimArgs["probeId"] as ObjectID).toString()).toBe(
      probeId.toString(),
    );
    expect(claimArgs["limit"]).toBe(DEVICE_POLL_FETCH_LIMIT);

    // Nothing claimed: no device fetch, and the probe gets an empty batch.
    expect(deviceService.findBy).not.toHaveBeenCalled();
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      { devices: [] },
    );
  });

  /*
   * Issue #3220's underlying cause. The batch size is a per-minute ceiling
   * on poll throughput, and at the old value of 50 a probe with 980 devices
   * took ~20 minutes to get round its fleet however short the devices'
   * configured intervals were. Nothing surfaced that: the fleet simply
   * polled five times slower than it was configured to, and the UI called
   * the result an outage.
   */
  describe("the claim batch is the fleet's poll-rate ceiling", () => {
    test("one probe can be handed at least 250 devices a minute", () => {
      /*
       * 250/minute clears a 1000-device fleet on a 5-minute interval, which
       * needs 200/minute. The old 50 could not clear 250 devices.
       */
      expect(DEVICE_POLL_FETCH_LIMIT).toBeGreaterThanOrEqual(250);
    });

    test("a full batch warns that the cap, not the interval, is setting the cadence", async () => {
      const claimed: Array<ObjectID> = Array.from(
        { length: DEVICE_POLL_FETCH_LIMIT },
        () => {
          return ObjectID.generate();
        },
      );
      deviceService.claimDevicesForPolling.mockResolvedValue(claimed as never);
      deviceService.findBy.mockResolvedValue([] as never);

      await callListEndpoint(makeRequest({ probeId }));

      expect(loggerMock.warn).toHaveBeenCalledTimes(1);
      const warning: string = loggerMock.warn.mock.calls[0]![0] as string;

      // Names the condition and the knob, or it is not actionable.
      expect(warning).toContain("polling slower than its configured intervals");
      expect(warning).toContain("NETWORK_DEVICE_POLL_FETCH_LIMIT");
      expect(warning).toContain("PROBE_NETWORK_DEVICE_POLL_CONCURRENCY");
    });

    test("a partial batch is the healthy case and warns about nothing", async () => {
      deviceService.claimDevicesForPolling.mockResolvedValue([
        ObjectID.generate(),
      ] as never);
      deviceService.findBy.mockResolvedValue([] as never);

      await callListEndpoint(makeRequest({ probeId }));

      expect(loggerMock.warn).not.toHaveBeenCalled();
    });

    test("an empty claim warns about nothing either", async () => {
      deviceService.claimDevicesForPolling.mockResolvedValue([] as never);

      await callListEndpoint(makeRequest({ probeId }));

      expect(loggerMock.warn).not.toHaveBeenCalled();
    });
  });

  test("fetches claimed devices with every column a probe-executable SNMP config needs", async () => {
    const deviceId: ObjectID = ObjectID.generate();
    deviceService.claimDevicesForPolling.mockResolvedValue([deviceId] as never);
    deviceService.findBy.mockResolvedValue([] as never);

    await callListEndpoint(makeRequest({ probeId }));

    expect(deviceService.findBy).toHaveBeenCalledTimes(1);
    const findArgs: JSONObject = deviceService.findBy.mock
      .calls[0]![0] as JSONObject;
    const select: JSONObject = findArgs["select"] as JSONObject;

    for (const column of [
      // Connection identity + credentials (snmpConfigSelect).
      "_id",
      "hostname",
      "snmpVersion",
      "snmpCommunityString",
      "snmpPort",
      "snmpV3Auth",
      "snmpV3SecurityLevel",
      "snmpV3Username",
      "snmpV3AuthProtocol",
      "snmpV3AuthKey",
      "snmpV3PrivProtocol",
      "snmpV3PrivKey",
      // Device-owned collection options.
      "projectId",
      "walkInterfaces",
      "collectEndpoints",
      "snmpOids",
    ]) {
      expect(select[column]).toBe(true);
    }

    expect((findArgs["props"] as JSONObject)["isRoot"]).toBe(true);
  });

  test("hydrates a claimed device into a concrete poll config", async () => {
    const deviceId: ObjectID = ObjectID.generate();
    const oids: Array<{ oid: string; name?: string | undefined }> = [
      { oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.7.1", name: "cpu5min" },
    ];

    deviceService.claimDevicesForPolling.mockResolvedValue([deviceId] as never);
    deviceService.findBy.mockResolvedValue([
      makeDevice({
        id: deviceId,
        projectId: projectId,
        hostname: "10.0.0.1",
        snmpVersion: "V2c",
        snmpCommunityString: "public",
        snmpPort: 1661,
        walkInterfaces: true,
        collectEndpoints: true,
        snmpOids: oids,
      }),
    ] as never);

    await callListEndpoint(makeRequest({ probeId }));

    const devices: Array<JSONObject> = respondedDevices();
    expect(devices.length).toBe(1);

    const config: JSONObject = devices[0]!;
    expect(config["networkDeviceId"]).toBe(deviceId.toString());
    expect(config["projectId"]).toBe(projectId.toString());
    expect(config["collectEndpoints"]).toBe(true);

    const snmpMonitor: MonitorStepSnmpMonitor = config[
      "snmpMonitor"
    ] as unknown as MonitorStepSnmpMonitor;
    expect(snmpMonitor.hostname).toBe("10.0.0.1");
    expect(snmpMonitor.port).toBe(1661);
    expect(snmpMonitor.snmpVersion).toBe(SnmpVersion.V2c);
    expect(snmpMonitor.communityString).toBe("public");
    expect(snmpMonitor.oids).toEqual(oids);
    expect(snmpMonitor.monitorInterfaces).toBe(true);
  });

  test("walkInterfaces left unset means interface walking stays ON (only explicit false turns it off)", async () => {
    const deviceId: ObjectID = ObjectID.generate();
    deviceService.claimDevicesForPolling.mockResolvedValue([deviceId] as never);
    deviceService.findBy.mockResolvedValue([
      makeDevice({
        id: deviceId,
        projectId: projectId,
        hostname: "10.0.0.1",
        snmpOids: [{ oid: "1.3.6.1.2.1.1.3.0", name: "sysUpTime" }],
      }),
    ] as never);

    await callListEndpoint(makeRequest({ probeId }));

    const snmpMonitor: MonitorStepSnmpMonitor = respondedDevices()[0]![
      "snmpMonitor"
    ] as unknown as MonitorStepSnmpMonitor;
    expect(snmpMonitor.monitorInterfaces).toBe(true);
  });

  test("collectEndpoints is opt-in: only an explicit true survives hydration", async () => {
    const explicitTrue: ObjectID = ObjectID.generate();
    const explicitFalse: ObjectID = ObjectID.generate();
    const unset: ObjectID = ObjectID.generate();

    deviceService.claimDevicesForPolling.mockResolvedValue([
      explicitTrue,
      explicitFalse,
      unset,
    ] as never);
    deviceService.findBy.mockResolvedValue([
      makeDevice({
        id: explicitTrue,
        projectId: projectId,
        hostname: "10.0.0.1",
        collectEndpoints: true,
      }),
      makeDevice({
        id: explicitFalse,
        projectId: projectId,
        hostname: "10.0.0.2",
        collectEndpoints: false,
      }),
      makeDevice({
        id: unset,
        projectId: projectId,
        hostname: "10.0.0.3",
      }),
    ] as never);

    await callListEndpoint(makeRequest({ probeId }));

    const devices: Array<JSONObject> = respondedDevices();
    expect(devices.length).toBe(3);
    expect(devices[0]!["collectEndpoints"]).toBe(true);
    expect(devices[1]!["collectEndpoints"]).toBe(false);
    expect(devices[2]!["collectEndpoints"]).toBe(false);
  });

  test("a device with no hostname is skipped — the probe cannot poll it", async () => {
    const withHostname: ObjectID = ObjectID.generate();
    const withoutHostname: ObjectID = ObjectID.generate();

    deviceService.claimDevicesForPolling.mockResolvedValue([
      withHostname,
      withoutHostname,
    ] as never);
    deviceService.findBy.mockResolvedValue([
      makeDevice({
        id: withHostname,
        projectId: projectId,
        hostname: "10.0.0.1",
      }),
      makeDevice({ id: withoutHostname, projectId: projectId }),
    ] as never);

    await callListEndpoint(makeRequest({ probeId }));

    const devices: Array<JSONObject> = respondedDevices();
    expect(devices.length).toBe(1);
    expect(devices[0]!["networkDeviceId"]).toBe(withHostname.toString());
  });

  /*
   * A device with interface walking off and no health OIDs still needs
   * SOMETHING to poll, or the probe would report "No OIDs configured"
   * instead of reachability. sysDescr is the universal fallback.
   */
  test("walkInterfaces=false with no snmpOids falls back to the sysDescr OID", async () => {
    const deviceId: ObjectID = ObjectID.generate();
    deviceService.claimDevicesForPolling.mockResolvedValue([deviceId] as never);
    deviceService.findBy.mockResolvedValue([
      makeDevice({
        id: deviceId,
        projectId: projectId,
        hostname: "10.0.0.1",
        walkInterfaces: false,
      }),
    ] as never);

    await callListEndpoint(makeRequest({ probeId }));

    const snmpMonitor: MonitorStepSnmpMonitor = respondedDevices()[0]![
      "snmpMonitor"
    ] as unknown as MonitorStepSnmpMonitor;
    expect(snmpMonitor.monitorInterfaces).toBe(false);
    expect(snmpMonitor.oids).toEqual([
      { oid: "1.3.6.1.2.1.1.1.0", name: "sysDescr" },
    ]);
  });

  test("walkInterfaces=false with configured snmpOids keeps them — no sysDescr fallback", async () => {
    const deviceId: ObjectID = ObjectID.generate();
    const oids: Array<{ oid: string; name?: string | undefined }> = [
      { oid: "1.3.6.1.2.1.1.3.0", name: "sysUpTime" },
    ];

    deviceService.claimDevicesForPolling.mockResolvedValue([deviceId] as never);
    deviceService.findBy.mockResolvedValue([
      makeDevice({
        id: deviceId,
        projectId: projectId,
        hostname: "10.0.0.1",
        walkInterfaces: false,
        snmpOids: oids,
      }),
    ] as never);

    await callListEndpoint(makeRequest({ probeId }));

    const snmpMonitor: MonitorStepSnmpMonitor = respondedDevices()[0]![
      "snmpMonitor"
    ] as unknown as MonitorStepSnmpMonitor;
    expect(snmpMonitor.oids).toEqual(oids);
  });

  test("passes service failures to the error handler", async () => {
    const boom: Error = new Error("db down");
    deviceService.claimDevicesForPolling.mockRejectedValue(boom as never);

    const { next } = await callListEndpoint(makeRequest({ probeId }));

    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe("POST /probe/network-device/response/ingest", () => {
  const probeId: ObjectID = ObjectID.generate();
  const networkDeviceId: ObjectID = ObjectID.generate();
  const snmpResponse: JSONObject = {
    oidResults: [{ oid: "1.3.6.1.2.1.1.1.0", value: "Cisco IOS" }],
    isOnline: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    queueService.addNetworkDeviceWalkJob.mockResolvedValue(undefined as never);
  });

  test("rejects a request with no authenticated probe", async () => {
    await callIngestEndpoint(
      makeRequest({
        body: {
          networkDeviceId: networkDeviceId.toString(),
          snmpResponse: snmpResponse,
        },
      }),
    );

    expect(queueService.addNetworkDeviceWalkJob).not.toHaveBeenCalled();
    expect(responseUtil.sendErrorResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      expect.any(BadDataException),
    );
  });

  test("rejects a walk with no networkDeviceId", async () => {
    await callIngestEndpoint(
      makeRequest({ probeId, body: { snmpResponse: snmpResponse } }),
    );

    expect(queueService.addNetworkDeviceWalkJob).not.toHaveBeenCalled();
    expect(responseUtil.sendErrorResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      expect.any(BadDataException),
    );
  });

  test("rejects a walk with no snmpResponse", async () => {
    await callIngestEndpoint(
      makeRequest({
        probeId,
        body: { networkDeviceId: networkDeviceId.toString() },
      }),
    );

    expect(queueService.addNetworkDeviceWalkJob).not.toHaveBeenCalled();
    expect(responseUtil.sendErrorResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      expect.any(BadDataException),
    );
  });

  test("queues the walk with device id, response and monitoredAt, then acks", async () => {
    const monitoredAt: string = "2026-07-25T10:00:00.000Z";

    const { next } = await callIngestEndpoint(
      makeRequest({
        probeId,
        body: {
          networkDeviceId: networkDeviceId.toString(),
          snmpResponse: snmpResponse,
          monitoredAt: monitoredAt,
        },
      }),
    );

    expect(next).not.toHaveBeenCalled();
    expect(queueService.addNetworkDeviceWalkJob).toHaveBeenCalledTimes(1);

    const jobArgs: JSONObject = queueService.addNetworkDeviceWalkJob.mock
      .calls[0]![0] as JSONObject;
    const walkRequestBody: JSONObject = jobArgs[
      "walkRequestBody"
    ] as JSONObject;

    expect(walkRequestBody["probeId"]).toBe(probeId.toString());
    expect(walkRequestBody["networkDeviceId"]).toBe(networkDeviceId.toString());
    expect(walkRequestBody["snmpResponse"]).toEqual(snmpResponse);
    expect(walkRequestBody["monitoredAt"]).toBe(monitoredAt);

    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      { result: "ok" },
    );
  });

  /*
   * The security property of this endpoint: probeId is stamped from the
   * AUTHENTICATED request, never read from the body — a probe can only
   * ever report walks as itself.
   */
  test("a body-supplied probeId is ignored in favor of the authenticated probe", async () => {
    const spoofedProbeId: ObjectID = ObjectID.generate();

    await callIngestEndpoint(
      makeRequest({
        probeId,
        body: {
          probeId: spoofedProbeId.toString(),
          networkDeviceId: networkDeviceId.toString(),
          snmpResponse: snmpResponse,
        },
      }),
    );

    const jobArgs: JSONObject = queueService.addNetworkDeviceWalkJob.mock
      .calls[0]![0] as JSONObject;
    const walkRequestBody: JSONObject = jobArgs[
      "walkRequestBody"
    ] as JSONObject;

    expect(walkRequestBody["probeId"]).toBe(probeId.toString());
    expect(walkRequestBody["probeId"]).not.toBe(spoofedProbeId.toString());
  });

  test("an omitted monitoredAt is queued as undefined so the processor stamps its own time", async () => {
    await callIngestEndpoint(
      makeRequest({
        probeId,
        body: {
          networkDeviceId: networkDeviceId.toString(),
          snmpResponse: snmpResponse,
        },
      }),
    );

    const jobArgs: JSONObject = queueService.addNetworkDeviceWalkJob.mock
      .calls[0]![0] as JSONObject;
    const walkRequestBody: JSONObject = jobArgs[
      "walkRequestBody"
    ] as JSONObject;

    expect(walkRequestBody["monitoredAt"]).toBeUndefined();
  });

  test("passes queue failures to the error handler", async () => {
    const boom: Error = new Error("queue down");
    queueService.addNetworkDeviceWalkJob.mockRejectedValue(boom as never);

    const { next } = await callIngestEndpoint(
      makeRequest({
        probeId,
        body: {
          networkDeviceId: networkDeviceId.toString(),
          snmpResponse: snmpResponse,
        },
      }),
    );

    expect(next).toHaveBeenCalledWith(boom);
  });
});
