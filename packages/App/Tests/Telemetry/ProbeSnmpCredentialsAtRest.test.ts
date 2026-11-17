import { mockRouter } from "Common/Tests/Server/API/Helpers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "Common/Tests/Server/TestingUtils/InMemoryRepository";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import DatabaseService from "Common/Server/Services/DatabaseService";
import Encryption from "Common/Server/Utils/Encryption";
import Response from "Common/Server/Utils/Response";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Probe from "Common/Models/DatabaseModels/Probe";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

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
      sendEntityArrayResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
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
 * THE PROBE IS HANDED THE SNMP CREDENTIALS AS WRITTEN, FROM ROWS THAT KEEP
 * THEM ENCRYPTED (#9014).
 *
 * The two routes a probe fetches its work from - the devices due for a poll
 * (/probe/network-device/list) and the discovery scans to sweep
 * (/probe/discovery-scan/list) - read through the real services, from
 * tables in memory that hold every credential as DatabaseService stores
 * it: encrypted, a scan's credential sets field by field. Each device's poll
 * config carries its community string and v3 keys as written, a scan its
 * whole credential list as written, and a scan's claim holds itself to the
 * version it read, never to a credential, which the row holds salted afresh
 * on every write. A row written before its column was encrypted reads the
 * same.
 */

import "../../FeatureSet/Telemetry/API/ProbeIngest/NetworkDevicePoll";
import "../../FeatureSet/Telemetry/API/ProbeIngest/DiscoveryScan";

const PROBE_ID: ObjectID = new ObjectID("90140000-0000-4000-8000-000000000101");
const PROJECT_ID: ObjectID = new ObjectID(
  "90140000-0000-4000-8000-000000000102",
);
const V2C_DEVICE_ID: string = "90140000-0000-4000-8000-000000000103";
const V3_DEVICE_ID: string = "90140000-0000-4000-8000-000000000104";
const PLAIN_DEVICE_ID: string = "90140000-0000-4000-8000-000000000105";
const SCAN_ID: string = "90140000-0000-4000-8000-000000000106";

const COMMUNITY: string = "s3cr3t-community";
const AUTH_KEY: string = "an auth passphrase";
const PRIV_KEY: string = "a privacy passphrase";

const SNMP_CONFIGS: Array<JSONObject> = [
  {
    id: "access",
    name: "Access switches",
    snmpVersion: "V2c",
    snmpCommunityString: COMMUNITY,
    snmpPort: 161,
  },
  {
    id: "core",
    snmpVersion: "V3",
    snmpV3SecurityLevel: "authPriv",
    snmpV3Username: "monitoring",
    snmpV3AuthProtocol: "SHA",
    snmpV3AuthKey: AUTH_KEY,
    snmpV3PrivProtocol: "AES",
    snmpV3PrivKey: PRIV_KEY,
  },
];

const mockResponse: ExpressResponse = {} as ExpressResponse;

async function callRoute(uri: string): Promise<void> {
  const req: JSONObject = {
    body: { probeCapabilities: ["networkDevicePing"] },
    probe: new Probe(PROBE_ID),
  };
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await mockRouter
    .match("post", uri)
    .handlerFunction(req as unknown as ExpressRequest, mockResponse, next);

  expect(next).not.toHaveBeenCalled();
}

// What DatabaseService stores for `value` in `column` of `model`.
async function stored(
  service: DatabaseService<NetworkDevice | NetworkDeviceDiscoveryScan>,
  values: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const record: Record<string, unknown> = { ...values };

  await (
    service as unknown as {
      encrypt: (data: unknown) => Promise<unknown>;
    }
  ).encrypt(record);

  return record;
}

let devices: InMemoryTable;
let scans: InMemoryTable;

beforeEach(async () => {
  devices = useInMemoryTable(NetworkDeviceService, [
    {
      _id: V2C_DEVICE_ID,
      projectId: PROJECT_ID,
      hostname: "10.0.0.1",
      walkInterfaces: true,
      ...(await stored(NetworkDeviceService as never, {
        snmpVersion: "V2c",
        snmpCommunityString: COMMUNITY,
      })),
    },
    {
      _id: V3_DEVICE_ID,
      projectId: PROJECT_ID,
      hostname: "10.0.0.2",
      walkInterfaces: true,
      ...(await stored(NetworkDeviceService as never, {
        snmpVersion: "V3",
        snmpV3SecurityLevel: "authPriv",
        snmpV3Username: "monitoring",
        snmpV3AuthProtocol: "SHA",
        snmpV3AuthKey: AUTH_KEY,
        snmpV3PrivProtocol: "AES",
        snmpV3PrivKey: PRIV_KEY,
      })),
    },
    // Written before the column was encrypted: read as it is.
    {
      _id: PLAIN_DEVICE_ID,
      projectId: PROJECT_ID,
      hostname: "10.0.0.3",
      walkInterfaces: true,
      snmpVersion: "V2c",
      snmpCommunityString: COMMUNITY,
    },
  ]);

  scans = useInMemoryTable(NetworkDeviceDiscoveryScanService, [
    {
      _id: SCAN_ID,
      projectId: PROJECT_ID,
      probeId: PROBE_ID,
      status: "Pending",
      cidr: "10.0.0.0/24",
      isSnmpEnabled: true,
      version: 4,
      snmpVersion: "V2c",
      snmpPort: 161,
      ...(await stored(NetworkDeviceDiscoveryScanService as never, {
        snmpConfigs: JSON.parse(JSON.stringify(SNMP_CONFIGS)),
        snmpCommunityString: COMMUNITY,
      })),
    },
  ]);

  jest
    .spyOn(NetworkDeviceService, "claimDevicesForPolling")
    .mockResolvedValue([
      new ObjectID(V2C_DEVICE_ID),
      new ObjectID(V3_DEVICE_ID),
      new ObjectID(PLAIN_DEVICE_ID),
    ]);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.mocked(Response.sendJsonObjectResponse).mockClear();
  jest.mocked(Response.sendEntityArrayResponse).mockClear();
});

describe("the devices a probe polls (/probe/network-device/list)", () => {
  test("the rows hold every credential encrypted", () => {
    expect(
      Encryption.looksEncrypted(
        String(devices.get(V2C_DEVICE_ID)!["snmpCommunityString"]),
      ),
    ).toBe(true);
    expect(
      Encryption.looksEncrypted(
        String(devices.get(V3_DEVICE_ID)!["snmpV3PrivKey"]),
      ),
    ).toBe(true);
  });

  test("hands the probe each device's community string and v3 keys as written", async () => {
    await callRoute("/probe/network-device/list");

    const answer: JSONObject = jest.mocked(Response.sendJsonObjectResponse)
      .mock.calls[0]![2] as JSONObject;
    const byId: Record<string, JSONObject> = {};

    for (const device of answer["devices"] as Array<JSONObject>) {
      byId[String(device["networkDeviceId"])] = device;
    }

    expect(Object.keys(byId).sort()).toEqual(
      [V2C_DEVICE_ID, V3_DEVICE_ID, PLAIN_DEVICE_ID].sort(),
    );

    for (const id of [V2C_DEVICE_ID, PLAIN_DEVICE_ID]) {
      expect(byId[id]!["pollMode"]).toBe("snmp");
      expect(
        (byId[id]!["snmpMonitor"] as JSONObject)["communityString"],
      ).toBe(COMMUNITY);
    }

    expect(byId[V3_DEVICE_ID]!["pollMode"]).toBe("snmp");
    expect(
      (byId[V3_DEVICE_ID]!["snmpMonitor"] as JSONObject)["snmpV3Auth"],
    ).toMatchObject({
      username: "monitoring",
      authKey: AUTH_KEY,
      privKey: PRIV_KEY,
    });

    // Nothing handed to the probe is a ciphertext.
    expect(JSON.stringify(answer)).not.toContain(
      Encryption.CIPHERTEXT_PREFIX,
    );
  });
});

describe("the discovery scans a probe sweeps (/probe/discovery-scan/list)", () => {
  test("hands the probe the scan's credential sets and flattened credentials as written, and claims it by its version", async () => {
    const claims: Array<JSONObject> = [];

    jest
      .spyOn(NetworkDeviceDiscoveryScanService, "updateColumnsByIdWithoutHooks")
      .mockImplementation((async (input: JSONObject): Promise<void> => {
        claims.push(input);
      }) as never);

    expect(
      Encryption.looksEncrypted(
        String(
          (scans.get(SCAN_ID)!["snmpConfigs"] as Array<JSONObject>)[0]![
            "snmpCommunityString"
          ],
        ),
      ),
    ).toBe(true);

    await callRoute("/probe/discovery-scan/list");

    const handed: Array<NetworkDeviceDiscoveryScan> = jest.mocked(
      Response.sendEntityArrayResponse,
    ).mock.calls[0]![2] as Array<NetworkDeviceDiscoveryScan>;

    expect(handed).toHaveLength(1);
    expect(handed[0]!.snmpConfigs).toEqual(SNMP_CONFIGS);
    expect(handed[0]!.snmpCommunityString).toBe(COMMUNITY);
    // Read for the claim's guard alone: the probe is not handed it.
    expect(handed[0]!.version).toBeUndefined();

    expect(claims).toHaveLength(1);

    const expected: JSONObject = claims[0]!["expectedData"] as JSONObject;

    expect(expected["version"]).toBe(4);
    expect(expected["status"]).toBe("Pending");

    for (const credential of [
      "snmpConfigs",
      "snmpCommunityString",
      "snmpV3AuthKey",
      "snmpV3PrivKey",
    ]) {
      expect(Object.keys(expected)).not.toContain(credential);
    }
  });

  test("a scan written before its credentials were encrypted is handed over the same", async () => {
    const row: StoredRow = scans.get(SCAN_ID)!;
    row["snmpConfigs"] = JSON.parse(JSON.stringify(SNMP_CONFIGS));
    row["snmpCommunityString"] = COMMUNITY;

    jest
      .spyOn(NetworkDeviceDiscoveryScanService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);

    await callRoute("/probe/discovery-scan/list");

    const handed: Array<NetworkDeviceDiscoveryScan> = jest.mocked(
      Response.sendEntityArrayResponse,
    ).mock.calls[0]![2] as Array<NetworkDeviceDiscoveryScan>;

    expect(handed[0]!.snmpConfigs).toEqual(SNMP_CONFIGS);
    expect(handed[0]!.snmpCommunityString).toBe(COMMUNITY);
  });
});
