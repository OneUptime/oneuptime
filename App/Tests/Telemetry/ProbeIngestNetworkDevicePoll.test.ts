import { mockRouter } from "Common/Tests/Server/API/Helpers";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import NetworkDeviceOidTemplateService from "Common/Server/Services/NetworkDeviceOidTemplateService";
import NetworkDeviceOidTemplate from "Common/Models/DatabaseModels/NetworkDeviceOidTemplate";
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

jest.mock("Common/Server/Services/NetworkDeviceOidTemplateService", () => {
  return {
    __esModule: true,
    default: {
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

const oidTemplateService: { findBy: jest.Mock } =
  NetworkDeviceOidTemplateService as unknown as { findBy: jest.Mock };

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
  /*
   * Defaults to a v2c community so a device reads as SNMP-mode unless a
   * test says otherwise: pass `snmpCommunityString: undefined` explicitly
   * for a credential-less (ping-only) device.
   */
  snmpCommunityString?: string | undefined;
  snmpV3Username?: string | undefined;
  snmpPort?: number | undefined;
  oidTemplateId?: ObjectID | undefined;
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
  if ("snmpCommunityString" in data) {
    if (data.snmpCommunityString !== undefined) {
      device.snmpCommunityString = data.snmpCommunityString;
    }
  } else {
    device.snmpCommunityString = "public";
  }
  if (data.snmpV3Username !== undefined) {
    device.snmpV3Username = data.snmpV3Username;
  }
  if (data.snmpPort !== undefined) {
    device.snmpPort = data.snmpPort;
  }
  if (data.oidTemplateId !== undefined) {
    device.oidTemplateId = data.oidTemplateId;
  }

  return device;
}

function makeOidTemplate(data: {
  id: ObjectID;
  projectId: ObjectID;
  name: string;
  oids: Array<{ oid: string; name?: string | undefined }>;
}): NetworkDeviceOidTemplate {
  const template: NetworkDeviceOidTemplate = new NetworkDeviceOidTemplate(
    data.id,
  );
  template.projectId = data.projectId;
  template.name = data.name;
  template.oids = data.oids;
  return template;
}

function pollConfigOids(
  config: JSONObject,
): Array<{ oid: string; name?: string | undefined }> {
  const snmpMonitor: MonitorStepSnmpMonitor = config[
    "snmpMonitor"
  ] as unknown as MonitorStepSnmpMonitor;
  return snmpMonitor.oids as Array<{
    oid: string;
    name?: string | undefined;
  }>;
}

function respondedDevices(): Array<JSONObject> {
  expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  const payload: JSONObject = responseUtil.sendJsonObjectResponse.mock
    .calls[0]![2] as JSONObject;
  return payload["devices"] as Array<JSONObject>;
}

/*
 * What a ping-first probe puts in its default request body. An older probe
 * sends no `probeCapabilities` at all.
 */
const PING_CAPABLE_BODY: JSONObject = {
  probeCapabilities: ["networkDevicePing"],
};

describe("POST /probe/network-device/list", () => {
  const probeId: ObjectID = ObjectID.generate();
  const projectId: ObjectID = ObjectID.generate();

  beforeEach(() => {
    jest.clearAllMocks();
    deviceService.claimDevicesForPolling.mockResolvedValue([] as never);
    deviceService.findBy.mockResolvedValue([] as never);
    oidTemplateService.findBy.mockResolvedValue([] as never);
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
    // The ping target and the mode travel beside the SNMP config.
    expect(config["hostname"]).toBe("10.0.0.1");
    expect(config["pollMode"]).toBe("snmp");

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

  /*
   * Ping-first polling. A device is the unit; SNMP is an enrichment layered
   * on top when credentials exist. The list handler is where that decision
   * is made per device, and where an old probe is protected from a device
   * it would otherwise poll with a default community and report Down.
   */
  describe("poll mode and the ping capability gate", () => {
    test("a device with no usable credentials is handed out in ping mode: hostname and no snmpMonitor", async () => {
      const deviceId: ObjectID = ObjectID.generate();
      deviceService.claimDevicesForPolling.mockResolvedValue([
        deviceId,
      ] as never);
      deviceService.findBy.mockResolvedValue([
        makeDevice({
          id: deviceId,
          projectId: projectId,
          hostname: "10.0.0.9",
          snmpVersion: "V2c",
          snmpCommunityString: undefined,
          collectEndpoints: true,
        }),
      ] as never);

      await callListEndpoint(makeRequest({ probeId, body: PING_CAPABLE_BODY }));

      const devices: Array<JSONObject> = respondedDevices();
      expect(devices).toHaveLength(1);
      expect(devices[0]).toEqual({
        networkDeviceId: deviceId.toString(),
        projectId: projectId.toString(),
        hostname: "10.0.0.9",
        pollMode: "ping",
        collectEndpoints: true,
      });
      expect(devices[0]).not.toHaveProperty("snmpMonitor");
      expect(loggerMock.warn).not.toHaveBeenCalled();
    });

    test("a whitespace-only community string is not a credential: ping mode", async () => {
      const deviceId: ObjectID = ObjectID.generate();
      deviceService.claimDevicesForPolling.mockResolvedValue([
        deviceId,
      ] as never);
      deviceService.findBy.mockResolvedValue([
        makeDevice({
          id: deviceId,
          projectId: projectId,
          hostname: "10.0.0.9",
          snmpCommunityString: "   ",
        }),
      ] as never);

      await callListEndpoint(makeRequest({ probeId, body: PING_CAPABLE_BODY }));

      expect(respondedDevices()[0]!["pollMode"]).toBe("ping");
    });

    test("a v3 device is walked when it has a username and only pinged when it has none", async () => {
      const withUsername: ObjectID = ObjectID.generate();
      const withoutUsername: ObjectID = ObjectID.generate();
      deviceService.claimDevicesForPolling.mockResolvedValue([
        withUsername,
        withoutUsername,
      ] as never);
      deviceService.findBy.mockResolvedValue([
        makeDevice({
          id: withUsername,
          projectId: projectId,
          hostname: "10.0.0.1",
          snmpVersion: "V3",
          snmpCommunityString: undefined,
          snmpV3Username: "monitoring",
        }),
        makeDevice({
          id: withoutUsername,
          projectId: projectId,
          hostname: "10.0.0.2",
          snmpVersion: "V3",
          // A community string means nothing to v3.
          snmpCommunityString: "public",
        }),
      ] as never);

      await callListEndpoint(makeRequest({ probeId, body: PING_CAPABLE_BODY }));

      const devices: Array<JSONObject> = respondedDevices();
      expect(devices).toHaveLength(2);
      expect(devices[0]!["pollMode"]).toBe("snmp");
      expect(devices[0]!["snmpMonitor"]).toBeDefined();
      expect(
        (devices[0]!["snmpMonitor"] as unknown as MonitorStepSnmpMonitor)
          .snmpV3Auth?.username,
      ).toBe("monitoring");
      expect(devices[1]!["pollMode"]).toBe("ping");
      expect(devices[1]).not.toHaveProperty("snmpMonitor");
    });

    /*
     * The old probe's SnmpMonitor defaults the community to "public" and
     * would report every credential-less device Down. Those devices are
     * withheld from it - they stay Pending until the probe is upgraded -
     * and the batch says so once, naming the probe and the count.
     */
    test("a probe that does not advertise networkDevicePing is never handed a ping-mode device, and the batch warns once naming the probe and the count", async () => {
      const pingOnlyA: ObjectID = ObjectID.generate();
      const pingOnlyB: ObjectID = ObjectID.generate();
      const walkable: ObjectID = ObjectID.generate();
      deviceService.claimDevicesForPolling.mockResolvedValue([
        pingOnlyA,
        walkable,
        pingOnlyB,
      ] as never);
      deviceService.findBy.mockResolvedValue([
        makeDevice({
          id: pingOnlyA,
          projectId: projectId,
          hostname: "10.0.0.1",
          snmpCommunityString: undefined,
        }),
        makeDevice({
          id: walkable,
          projectId: projectId,
          hostname: "10.0.0.2",
        }),
        makeDevice({
          id: pingOnlyB,
          projectId: projectId,
          hostname: "10.0.0.3",
          snmpCommunityString: undefined,
        }),
      ] as never);

      // No probeCapabilities at all: an older probe.
      const { next } = await callListEndpoint(makeRequest({ probeId }));

      expect(next).not.toHaveBeenCalled();

      const devices: Array<JSONObject> = respondedDevices();
      expect(devices).toHaveLength(1);
      expect(devices[0]!["networkDeviceId"]).toBe(walkable.toString());
      expect(devices[0]!["pollMode"]).toBe("snmp");

      expect(loggerMock.warn).toHaveBeenCalledTimes(1);
      const warning: string = loggerMock.warn.mock.calls[0]![0] as string;
      expect(warning).toContain(probeId.toString());
      expect(warning).toContain("2 network device(s)");
      expect(warning).toContain("networkDevicePing");
    });

    test("only the networkDevicePing capability unlocks ping mode; other capabilities do not", async () => {
      const deviceId: ObjectID = ObjectID.generate();
      deviceService.claimDevicesForPolling.mockResolvedValue([
        deviceId,
      ] as never);
      deviceService.findBy.mockResolvedValue([
        makeDevice({
          id: deviceId,
          projectId: projectId,
          hostname: "10.0.0.1",
          snmpCommunityString: undefined,
        }),
      ] as never);

      await callListEndpoint(
        makeRequest({
          probeId,
          body: { probeCapabilities: ["somethingElse"] },
        }),
      );

      expect(respondedDevices()).toHaveLength(0);
      expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    });

    test("a batch with only SNMP-mode devices never warns about the capability, whatever the probe advertises", async () => {
      const deviceId: ObjectID = ObjectID.generate();
      deviceService.claimDevicesForPolling.mockResolvedValue([
        deviceId,
      ] as never);
      deviceService.findBy.mockResolvedValue([
        makeDevice({
          id: deviceId,
          projectId: projectId,
          hostname: "10.0.0.1",
        }),
      ] as never);

      await callListEndpoint(makeRequest({ probeId }));

      expect(respondedDevices()).toHaveLength(1);
      expect(loggerMock.warn).not.toHaveBeenCalled();
    });

    /*
     * A ping-only device polls no OIDs, so its OID Collection Template link
     * is irrelevant to the cycle: no query for it, and no skipping it when
     * the template lookup fails - it never needed the template.
     */
    test("template lookup is skipped for ping-mode devices, and a failed lookup does not withhold them", async () => {
      const templateId: ObjectID = ObjectID.generate();
      const pingOnlyLinked: ObjectID = ObjectID.generate();
      deviceService.claimDevicesForPolling.mockResolvedValue([
        pingOnlyLinked,
      ] as never);
      deviceService.findBy.mockResolvedValue([
        makeDevice({
          id: pingOnlyLinked,
          projectId: projectId,
          hostname: "10.0.0.1",
          snmpCommunityString: undefined,
          oidTemplateId: templateId,
        }),
      ] as never);

      await callListEndpoint(makeRequest({ probeId, body: PING_CAPABLE_BODY }));

      expect(oidTemplateService.findBy).not.toHaveBeenCalled();
      expect(respondedDevices()).toHaveLength(1);
      expect(respondedDevices()[0]!["pollMode"]).toBe("ping");

      // And with a walkable sibling forcing the lookup, which then fails...
      jest.clearAllMocks();
      const walkableLinked: ObjectID = ObjectID.generate();
      deviceService.claimDevicesForPolling.mockResolvedValue([
        walkableLinked,
        pingOnlyLinked,
      ] as never);
      deviceService.findBy.mockResolvedValue([
        makeDevice({
          id: walkableLinked,
          projectId: projectId,
          hostname: "10.0.0.2",
          oidTemplateId: templateId,
        }),
        makeDevice({
          id: pingOnlyLinked,
          projectId: projectId,
          hostname: "10.0.0.1",
          snmpCommunityString: undefined,
          oidTemplateId: templateId,
        }),
      ] as never);
      oidTemplateService.findBy.mockRejectedValue(
        new Error("db down") as never,
      );

      await callListEndpoint(makeRequest({ probeId, body: PING_CAPABLE_BODY }));

      // ...only the WALKABLE linked device is withheld this cycle.
      const devices: Array<JSONObject> = respondedDevices();
      expect(devices).toHaveLength(1);
      expect(devices[0]!["networkDeviceId"]).toBe(pingOnlyLinked.toString());
      expect(devices[0]!["pollMode"]).toBe("ping");
    });
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

  /*
   * OID Collection Templates (issue #3507).
   *
   * This handler is the ONLY place a template becomes real: nothing is ever
   * copied onto a device, so what the probe is handed here is the entire
   * propagation mechanism. If these break, editing a template stops changing
   * what linked devices collect.
   */
  describe("OID Collection Template resolution", () => {
    const templateId: ObjectID = ObjectID.generate();

    test("hands the probe the template's OIDs for a device with none of its own", async () => {
      const deviceId: ObjectID = ObjectID.generate();

      deviceService.claimDevicesForPolling.mockResolvedValue([
        deviceId,
      ] as never);
      deviceService.findBy.mockResolvedValue([
        makeDevice({
          id: deviceId,
          projectId: projectId,
          hostname: "10.0.0.1",
          oidTemplateId: templateId,
        }),
      ] as never);
      oidTemplateService.findBy.mockResolvedValue([
        makeOidTemplate({
          id: templateId,
          projectId: projectId,
          name: "Cisco Catalyst 9300",
          oids: [
            { oid: "1.3.6.1.4.1.9.1", name: "cpu" },
            { oid: "1.3.6.1.4.1.9.2", name: "memory" },
          ],
        }),
      ] as never);

      await callListEndpoint(makeRequest({ probeId }));

      expect(pollConfigOids(respondedDevices()[0]!)).toEqual([
        { oid: "1.3.6.1.4.1.9.1", name: "cpu" },
        { oid: "1.3.6.1.4.1.9.2", name: "memory" },
      ]);
    });

    /*
     * Template first, device additions after, and a shared OID appearing once
     * with the DEVICE's name at the TEMPLATE's position. Ordering is
     * load-bearing: the effective cap truncates from the end, so the shared
     * items a whole device type depends on must be the stable prefix.
     */
    test("merges template OIDs with the device's own, template first", async () => {
      const deviceId: ObjectID = ObjectID.generate();

      deviceService.claimDevicesForPolling.mockResolvedValue([
        deviceId,
      ] as never);
      deviceService.findBy.mockResolvedValue([
        makeDevice({
          id: deviceId,
          projectId: projectId,
          hostname: "10.0.0.1",
          oidTemplateId: templateId,
          snmpOids: [
            { oid: "1.3.6.1.4.1.9.1", name: "device-cpu" },
            { oid: "1.3.6.1.4.1.99.1", name: "local-sensor" },
          ],
        }),
      ] as never);
      oidTemplateService.findBy.mockResolvedValue([
        makeOidTemplate({
          id: templateId,
          projectId: projectId,
          name: "Cisco Catalyst 9300",
          oids: [
            { oid: "1.3.6.1.4.1.9.1", name: "template-cpu" },
            { oid: "1.3.6.1.4.1.9.2", name: "template-memory" },
          ],
        }),
      ] as never);

      await callListEndpoint(makeRequest({ probeId }));

      expect(pollConfigOids(respondedDevices()[0]!)).toEqual([
        { oid: "1.3.6.1.4.1.9.1", name: "device-cpu" },
        { oid: "1.3.6.1.4.1.9.2", name: "template-memory" },
        { oid: "1.3.6.1.4.1.99.1", name: "local-sensor" },
      ]);
    });

    test("looks templates up once per batch, however many devices share one", async () => {
      const firstDeviceId: ObjectID = ObjectID.generate();
      const secondDeviceId: ObjectID = ObjectID.generate();
      const unlinkedDeviceId: ObjectID = ObjectID.generate();

      deviceService.claimDevicesForPolling.mockResolvedValue([
        firstDeviceId,
        secondDeviceId,
        unlinkedDeviceId,
      ] as never);
      deviceService.findBy.mockResolvedValue([
        makeDevice({
          id: firstDeviceId,
          projectId: projectId,
          hostname: "10.0.0.1",
          oidTemplateId: templateId,
        }),
        makeDevice({
          id: secondDeviceId,
          projectId: projectId,
          hostname: "10.0.0.2",
          oidTemplateId: templateId,
        }),
        makeDevice({
          id: unlinkedDeviceId,
          projectId: projectId,
          hostname: "10.0.0.3",
        }),
      ] as never);
      oidTemplateService.findBy.mockResolvedValue([
        makeOidTemplate({
          id: templateId,
          projectId: projectId,
          name: "Branch Router",
          oids: [{ oid: "1.3.6.1.4.1.9.1", name: "cpu" }],
        }),
      ] as never);

      await callListEndpoint(makeRequest({ probeId }));

      expect(oidTemplateService.findBy).toHaveBeenCalledTimes(1);
      const findArgs: JSONObject = oidTemplateService.findBy.mock
        .calls[0]![0] as JSONObject;
      expect(findArgs["limit"] as number).toBe(1);
    });

    /*
     * The untouched path. A fleet with no templates must produce byte-identical
     * poll payloads and must not pay for a query it does not need.
     */
    test("issues no template query at all when no device in the batch is linked", async () => {
      const deviceId: ObjectID = ObjectID.generate();

      deviceService.claimDevicesForPolling.mockResolvedValue([
        deviceId,
      ] as never);
      deviceService.findBy.mockResolvedValue([
        makeDevice({
          id: deviceId,
          projectId: projectId,
          hostname: "10.0.0.1",
          snmpOids: [{ oid: "1.3.6.1.4.1.9.1", name: "cpu" }],
        }),
      ] as never);

      await callListEndpoint(makeRequest({ probeId }));

      expect(oidTemplateService.findBy).not.toHaveBeenCalled();
      expect(pollConfigOids(respondedDevices()[0]!)).toEqual([
        { oid: "1.3.6.1.4.1.9.1", name: "cpu" },
      ]);
    });

    /*
     * The template query runs isRoot, which bypasses the tenant column. A
     * device pointed at another project's template must contribute nothing —
     * shipping those OIDs to this project's probe would be a cross-tenant
     * leak, not merely wrong config.
     */
    test("ignores a template belonging to another project", async () => {
      const deviceId: ObjectID = ObjectID.generate();
      const otherProjectId: ObjectID = ObjectID.generate();

      deviceService.claimDevicesForPolling.mockResolvedValue([
        deviceId,
      ] as never);
      deviceService.findBy.mockResolvedValue([
        makeDevice({
          id: deviceId,
          projectId: projectId,
          hostname: "10.0.0.1",
          oidTemplateId: templateId,
          snmpOids: [{ oid: "1.3.6.1.4.1.99.1", name: "local" }],
        }),
      ] as never);
      oidTemplateService.findBy.mockResolvedValue([
        makeOidTemplate({
          id: templateId,
          projectId: otherProjectId,
          name: "Someone else's template",
          oids: [{ oid: "1.3.6.1.4.1.666.1", name: "leaked" }],
        }),
      ] as never);

      await callListEndpoint(makeRequest({ probeId }));

      expect(pollConfigOids(respondedDevices()[0]!)).toEqual([
        { oid: "1.3.6.1.4.1.99.1", name: "local" },
      ]);
    });

    /*
     * A failed template lookup must not poll a linked device with half its
     * configuration. Every template OID would come back absent, and an
     * "SNMP OID Exists / is False" criterion reads absent as BREACHING — so a
     * transient database blip would raise a real incident on every linked
     * device at once. Skipping the cycle is the cheaper failure, and claiming
     * has already paid for it by advancing nextPollAt.
     */
    test("skips template-linked devices when the template lookup fails", async () => {
      const linkedDeviceId: ObjectID = ObjectID.generate();
      const unlinkedDeviceId: ObjectID = ObjectID.generate();

      deviceService.claimDevicesForPolling.mockResolvedValue([
        linkedDeviceId,
        unlinkedDeviceId,
      ] as never);
      deviceService.findBy.mockResolvedValue([
        makeDevice({
          id: linkedDeviceId,
          projectId: projectId,
          hostname: "10.0.0.1",
          oidTemplateId: templateId,
          snmpOids: [{ oid: "1.3.6.1.4.1.99.1", name: "local" }],
        }),
        makeDevice({
          id: unlinkedDeviceId,
          projectId: projectId,
          hostname: "10.0.0.2",
          snmpOids: [{ oid: "1.3.6.1.4.1.99.2", name: "other" }],
        }),
      ] as never);
      oidTemplateService.findBy.mockRejectedValue(
        new Error("db down") as never,
      );

      const { next } = await callListEndpoint(makeRequest({ probeId }));

      // The batch is not dropped, and the request does not error...
      expect(next).not.toHaveBeenCalled();

      const devices: Array<JSONObject> = respondedDevices();

      // ...but only the UNLINKED device is handed out.
      expect(devices).toHaveLength(1);
      expect(devices[0]!["networkDeviceId"]).toBe(unlinkedDeviceId.toString());
      expect(pollConfigOids(devices[0]!)).toEqual([
        { oid: "1.3.6.1.4.1.99.2", name: "other" },
      ]);
    });

    /*
     * `description` is documentation for the operator and is never read by the
     * probe. It is stripped because this list is serialized once per device:
     * a shared template's prose would otherwise repeat 250 times in one
     * response.
     */
    test("does not ship OID descriptions to the probe", async () => {
      const deviceId: ObjectID = ObjectID.generate();

      deviceService.claimDevicesForPolling.mockResolvedValue([
        deviceId,
      ] as never);
      deviceService.findBy.mockResolvedValue([
        makeDevice({
          id: deviceId,
          projectId: projectId,
          hostname: "10.0.0.1",
          snmpOids: [
            {
              oid: "1.3.6.1.4.1.9.1",
              name: "cpu",
              description: "a long explanation nobody on the probe reads",
            },
          ],
        }),
      ] as never);

      await callListEndpoint(makeRequest({ probeId }));

      expect(pollConfigOids(respondedDevices()[0]!)).toEqual([
        { oid: "1.3.6.1.4.1.9.1", name: "cpu" },
      ]);
    });

    test("selects oidTemplateId so the link can be resolved at all", async () => {
      const deviceId: ObjectID = ObjectID.generate();

      deviceService.claimDevicesForPolling.mockResolvedValue([
        deviceId,
      ] as never);

      await callListEndpoint(makeRequest({ probeId }));

      const findArgs: JSONObject = deviceService.findBy.mock
        .calls[0]![0] as JSONObject;
      const select: JSONObject = findArgs["select"] as JSONObject;
      expect(select["oidTemplateId"]).toBe(true);
    });
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

  /*
   * Two probe generations post here: an old one sends only a walk, a
   * ping-first one sends a boolean device verdict (and a walk only when one
   * ran). Only a body with NEITHER says nothing about the device.
   */
  test("rejects a body carrying neither snmpResponse nor a boolean isOnline", async () => {
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

  test("a non-boolean isOnline with no walk is not a verdict: rejected", async () => {
    await callIngestEndpoint(
      makeRequest({
        probeId,
        body: {
          networkDeviceId: networkDeviceId.toString(),
          isOnline: "yes",
          pollMode: "ping",
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

  function queuedWalkBody(): JSONObject {
    expect(queueService.addNetworkDeviceWalkJob).toHaveBeenCalledTimes(1);
    const jobArgs: JSONObject = queueService.addNetworkDeviceWalkJob.mock
      .calls[0]![0] as JSONObject;
    return jobArgs["walkRequestBody"] as JSONObject;
  }

  test("an old probe's walk-only body is queued as received, with nothing invented for the fields it does not know", async () => {
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

    const walkRequestBody: JSONObject = queuedWalkBody();

    expect(walkRequestBody["probeId"]).toBe(probeId.toString());
    expect(walkRequestBody["networkDeviceId"]).toBe(networkDeviceId.toString());
    expect(walkRequestBody["snmpResponse"]).toEqual(snmpResponse);
    expect(walkRequestBody["monitoredAt"]).toBe(monitoredAt);
    /*
     * The processor derives these (pollMode "snmp", isOnline from the
     * walk); the handler must not guess on its behalf.
     */
    expect(walkRequestBody["isOnline"]).toBeUndefined();
    expect(walkRequestBody["pollMode"]).toBeUndefined();
    expect(walkRequestBody["pingResponse"]).toBeUndefined();

    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      { result: "ok" },
    );
  });

  test("a ping-first probe's ping-mode body is queued with the verdict, the mode and the ping, and no walk", async () => {
    const pingResponse: JSONObject = {
      isOnline: true,
      avgRttMs: 2.5,
      packetLossPercent: 0,
    };

    await callIngestEndpoint(
      makeRequest({
        probeId,
        body: {
          networkDeviceId: networkDeviceId.toString(),
          isOnline: true,
          pollMode: "ping",
          pingResponse: pingResponse,
          monitoredAt: "2026-07-25T10:00:00.000Z",
        },
      }),
    );

    const walkRequestBody: JSONObject = queuedWalkBody();

    expect(walkRequestBody["isOnline"]).toBe(true);
    expect(walkRequestBody["pollMode"]).toBe("ping");
    expect(walkRequestBody["pingResponse"]).toEqual(pingResponse);
    // Never synthesized: a ping-only poll ran no walk.
    expect(walkRequestBody["snmpResponse"]).toBeUndefined();

    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      mockResponse,
      { result: "ok" },
    );
  });

  test("a ping-first probe's snmp-mode body carries the walk AND the ping, on success and on failure alike", async () => {
    const pingResponse: JSONObject = {
      isOnline: true,
      avgRttMs: 1.1,
      packetLossPercent: 0,
    };

    await callIngestEndpoint(
      makeRequest({
        probeId,
        body: {
          networkDeviceId: networkDeviceId.toString(),
          isOnline: true,
          pollMode: "snmp",
          pingResponse: pingResponse,
          snmpResponse: snmpResponse,
        },
      }),
    );

    const success: JSONObject = queuedWalkBody();
    expect(success["isOnline"]).toBe(true);
    expect(success["pollMode"]).toBe("snmp");
    expect(success["pingResponse"]).toEqual(pingResponse);
    expect(success["snmpResponse"]).toEqual(snmpResponse);

    jest.clearAllMocks();

    const failedWalk: JSONObject = {
      isOnline: false,
      responseTimeInMs: 0,
      failureCause: "SNMP timed out after 3 attempts",
      oidResponses: [],
    };
    const failedPing: JSONObject = {
      isOnline: false,
      packetLossPercent: 100,
      failureCause: "Request timed out",
    };

    await callIngestEndpoint(
      makeRequest({
        probeId,
        body: {
          networkDeviceId: networkDeviceId.toString(),
          isOnline: false,
          pollMode: "snmp",
          pingResponse: failedPing,
          snmpResponse: failedWalk,
        },
      }),
    );

    const failure: JSONObject = queuedWalkBody();
    // A boolean false is a verdict, not a missing field.
    expect(failure["isOnline"]).toBe(false);
    expect(failure["pollMode"]).toBe("snmp");
    expect(failure["pingResponse"]).toEqual(failedPing);
    expect(failure["snmpResponse"]).toEqual(failedWalk);
  });

  test("a pollMode that is not a string is dropped rather than forwarded", async () => {
    await callIngestEndpoint(
      makeRequest({
        probeId,
        body: {
          networkDeviceId: networkDeviceId.toString(),
          isOnline: true,
          pollMode: 42,
        },
      }),
    );

    expect(queuedWalkBody()["pollMode"]).toBeUndefined();
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
