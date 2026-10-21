import { mockRouter } from "Common/Tests/Server/API/Helpers";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import NetworkDeviceOidTemplateService from "Common/Server/Services/NetworkDeviceOidTemplateService";
import NetworkDeviceOidTemplate from "Common/Models/DatabaseModels/NetworkDeviceOidTemplate";
import Response from "Common/Server/Utils/Response";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Probe from "Common/Models/DatabaseModels/Probe";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import {
  SnmpTableDefinition,
  SnmpTableWalkRequest,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTable";
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

const responseUtil: {
  sendErrorResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
} = Response as unknown as {
  sendErrorResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
};

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
  tables?: Array<SnmpTableDefinition> | undefined;
}): NetworkDeviceOidTemplate {
  const template: NetworkDeviceOidTemplate = new NetworkDeviceOidTemplate(
    data.id,
  );
  template.projectId = data.projectId;
  template.name = data.name;
  template.oids = data.oids;
  if (data.tables) {
    template.tables = data.tables;
  }
  return template;
}

function respondedDevices(): Array<JSONObject> {
  expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  const payload: JSONObject = responseUtil.sendJsonObjectResponse.mock
    .calls[0]![2] as JSONObject;
  return payload["devices"] as Array<JSONObject>;
}

/*
 * SNMP tables resolve the way health OIDs do - the template's, then the
 * device's own merged over them by key - and only the walk request (column
 * OIDs and a row limit) reaches the probe.
 */
const IPSEC_ENTRY: string = "1.3.6.1.4.1.2604.5.1.6.1.1.1.1";
const IPSEC_NAME: string = `${IPSEC_ENTRY}.2`;
const IPSEC_STATUS: string = `${IPSEC_ENTRY}.9`;
const RADIO_POWER: string = "1.3.6.1.4.1.17713.22.1.2.1.8";

const IPSEC_TABLE: SnmpTableDefinition = {
  key: "ipsec_tunnels",
  name: "IPsec Tunnels",
  description: "Prose that must never reach the probe",
  rowLabelColumnOids: [IPSEC_NAME],
  columns: [
    {
      oid: IPSEC_STATUS,
      name: "Status",
      valueLabels: { "0": "inactive", "1": "active" },
    },
  ],
  maxRows: 50,
};

const RADIO_TABLE: SnmpTableDefinition = {
  key: "wifi_radios",
  name: "Wi-Fi Radios",
  columns: [{ oid: RADIO_POWER, name: "TX Power", unit: "dBm" }],
};

function pollConfigTables(
  config: JSONObject,
): Array<SnmpTableWalkRequest> | undefined {
  return (config["snmpMonitor"] as unknown as MonitorStepSnmpMonitor).tables;
}

describe("POST /probe/network-device/list — SNMP tables", () => {
  const probeId: ObjectID = ObjectID.generate();
  const projectId: ObjectID = ObjectID.generate();
  const templateId: ObjectID = ObjectID.generate();

  beforeEach(() => {
    jest.clearAllMocks();
    deviceService.claimDevicesForPolling.mockResolvedValue([] as never);
    deviceService.findBy.mockResolvedValue([] as never);
    oidTemplateService.findBy.mockResolvedValue([] as never);
  });

  function claim(device: NetworkDevice): void {
    deviceService.claimDevicesForPolling.mockResolvedValue([
      device.id,
    ] as never);
    deviceService.findBy.mockResolvedValue([device] as never);
  }

  test("hands the probe a device's own tables as walk requests only", async () => {
    const device: NetworkDevice = makeDevice({
      id: ObjectID.generate(),
      projectId: projectId,
      hostname: "10.0.0.1",
    });
    device.snmpTables = [IPSEC_TABLE];
    claim(device);

    await callListEndpoint(makeRequest({ probeId }));

    expect(pollConfigTables(respondedDevices()[0]!)).toEqual([
      {
        key: "ipsec_tunnels",
        columnOids: [IPSEC_NAME, IPSEC_STATUS],
        maxRows: 50,
      },
    ]);
  });

  test("merges the template's tables with the device's own, template first", async () => {
    const device: NetworkDevice = makeDevice({
      id: ObjectID.generate(),
      projectId: projectId,
      hostname: "10.0.0.1",
      oidTemplateId: templateId,
    });
    device.snmpTables = [RADIO_TABLE];
    claim(device);
    oidTemplateService.findBy.mockResolvedValue([
      makeOidTemplate({
        id: templateId,
        projectId: projectId,
        name: "Sophos XGS",
        oids: [],
        tables: [IPSEC_TABLE],
      }),
    ] as never);

    await callListEndpoint(makeRequest({ probeId }));

    expect(
      (pollConfigTables(respondedDevices()[0]!) || []).map(
        (table: SnmpTableWalkRequest) => {
          return table.key;
        },
      ),
    ).toEqual(["ipsec_tunnels", "wifi_radios"]);
  });

  test("selects the device's tables and the template's tables", async () => {
    const device: NetworkDevice = makeDevice({
      id: ObjectID.generate(),
      projectId: projectId,
      hostname: "10.0.0.1",
      oidTemplateId: templateId,
    });
    claim(device);

    await callListEndpoint(makeRequest({ probeId }));

    const deviceSelect: JSONObject = (
      deviceService.findBy.mock.calls[0]![0] as { select: JSONObject }
    ).select;
    expect(deviceSelect["snmpTables"]).toBe(true);

    const templateSelect: JSONObject = (
      oidTemplateService.findBy.mock.calls[0]![0] as { select: JSONObject }
    ).select;
    expect(templateSelect["tables"]).toBe(true);
  });

  test("never ships another project's template tables", async () => {
    const device: NetworkDevice = makeDevice({
      id: ObjectID.generate(),
      projectId: projectId,
      hostname: "10.0.0.1",
      oidTemplateId: templateId,
    });
    claim(device);
    oidTemplateService.findBy.mockResolvedValue([
      makeOidTemplate({
        id: templateId,
        projectId: ObjectID.generate(),
        name: "Someone else's",
        oids: [],
        tables: [IPSEC_TABLE],
      }),
    ] as never);

    await callListEndpoint(makeRequest({ probeId }));

    expect(pollConfigTables(respondedDevices()[0]!)).toBeUndefined();
  });

  test("a device with no tables gets no tables field at all", async () => {
    claim(
      makeDevice({
        id: ObjectID.generate(),
        projectId: projectId,
        hostname: "10.0.0.1",
      }),
    );

    await callListEndpoint(makeRequest({ probeId }));

    expect(
      "tables" in (respondedDevices()[0]!["snmpMonitor"] as JSONObject),
    ).toBe(false);
  });

  test("a ping-mode device is never handed tables", async () => {
    const device: NetworkDevice = makeDevice({
      id: ObjectID.generate(),
      projectId: projectId,
      hostname: "10.0.0.1",
      snmpCommunityString: undefined,
    });
    device.snmpTables = [IPSEC_TABLE];
    claim(device);

    await callListEndpoint(
      makeRequest({
        probeId,
        body: { probeCapabilities: ["networkDevicePing"] },
      }),
    );

    expect(respondedDevices()[0]!["pollMode"]).toBe("ping");
    expect(respondedDevices()[0]!["snmpMonitor"]).toBeUndefined();
  });

  test("a stored table that no longer validates is dropped, not fatal", async () => {
    const device: NetworkDevice = makeDevice({
      id: ObjectID.generate(),
      projectId: projectId,
      hostname: "10.0.0.1",
    });
    device.snmpTables = [
      { key: "broken", name: "Broken", columns: [{ oid: "x", name: "x" }] },
      RADIO_TABLE,
    ];
    claim(device);

    await callListEndpoint(makeRequest({ probeId }));

    expect(
      (pollConfigTables(respondedDevices()[0]!) || []).map(
        (table: SnmpTableWalkRequest) => {
          return table.key;
        },
      ),
    ).toEqual(["wifi_radios"]);
  });
});
