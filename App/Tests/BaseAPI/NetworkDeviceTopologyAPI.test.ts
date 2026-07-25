import { mockRouter } from "Common/Tests/Server/API/Helpers";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import NetworkInterfaceService from "Common/Server/Services/NetworkInterfaceService";
import NetworkEndpointService from "Common/Server/Services/NetworkEndpointService";
import CommonAPI from "Common/Server/API/CommonAPI";
import Response from "Common/Server/Utils/Response";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkInterface from "Common/Models/DatabaseModels/NetworkInterface";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
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
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
    },
  };
});

jest.mock("Common/Server/API/CommonAPI", () => {
  return {
    __esModule: true,
    default: {
      getDatabaseCommonInteractionProps: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/NetworkInterfaceService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/NetworkEndpointService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

/*
 * Importing the API module registers its route on the mocked router so the
 * handler can be invoked directly, with every service call observable.
 */
import NetworkDeviceTopologyAPI from "../../FeatureSet/BaseAPI/API/NetworkDeviceTopology";

new NetworkDeviceTopologyAPI().getRouter();

const projectId: ObjectID = ObjectID.generate();

const commonAPI: { getDatabaseCommonInteractionProps: jest.Mock } =
  CommonAPI as unknown as { getDatabaseCommonInteractionProps: jest.Mock };
const deviceService: { findBy: jest.Mock } =
  NetworkDeviceService as unknown as { findBy: jest.Mock };
const interfaceService: { findBy: jest.Mock } =
  NetworkInterfaceService as unknown as { findBy: jest.Mock };
const endpointService: { findBy: jest.Mock } =
  NetworkEndpointService as unknown as { findBy: jest.Mock };
const responseUtil: { sendJsonObjectResponse: jest.Mock } =
  Response as unknown as { sendJsonObjectResponse: jest.Mock };

const mockResponse: ExpressResponse = {} as ExpressResponse;

type CallTopologyFunction = (body: JSONObject) => Promise<NextFunction>;

const callTopology: CallTopologyFunction = async (
  body: JSONObject,
): Promise<NextFunction> => {
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  const req: ExpressRequest = { body: body } as unknown as ExpressRequest;
  await mockRouter
    .match("post", "/network-device/topology")
    .handlerFunction(req, mockResponse, next);
  return next;
};

function makeDevice(name: string): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(ObjectID.generate());
  device.name = name;
  return device;
}

function makeInterface(deviceId: ObjectID, index: number): NetworkInterface {
  const row: NetworkInterface = new NetworkInterface(ObjectID.generate());
  row.networkDeviceId = deviceId;
  row.interfaceIndex = index;
  row.name = `Gi0/${index}`;
  row.isOperationallyUp = true;
  return row;
}

function lastInterfaceQuery(): JSONObject {
  return interfaceService.findBy.mock.calls[0]![0] as JSONObject;
}

function lastResponseBody(): JSONObject {
  expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  return responseUtil.sendJsonObjectResponse.mock.calls[0]![2] as JSONObject;
}

/*
 * QueryHelper.any() compiles to a TypeORM Raw operator whose object-literal
 * parameters carry the id list; this digs the list back out so a test can
 * pin exactly which device ids the query was scoped to.
 */
function idsInAnyOperator(operator: unknown): Array<string> {
  const parameters: JSONObject = (operator as JSONObject)[
    "objectLiteralParameters"
  ] as JSONObject;
  return Object.values(parameters)[0] as Array<string>;
}

describe("POST /network-device/topology", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue({
      tenantId: projectId,
    } as never);
    deviceService.findBy.mockResolvedValue([] as never);
    interfaceService.findBy.mockResolvedValue([] as never);
    endpointService.findBy.mockResolvedValue([] as never);
  });

  /*
   * Regression: the interface query used to be project-wide with a 10,000
   * row cap, so a site-scoped request could spend the whole cap on devices
   * that are not on the map and come back with none of its own interfaces —
   * every edge rendering with no up/down state, port name or utilization.
   */
  test("scopes the interface query to the devices actually in the graph", async () => {
    const siteId: ObjectID = ObjectID.generate();
    const deviceA: NetworkDevice = makeDevice("store-sw1");
    const deviceB: NetworkDevice = makeDevice("store-sw2");
    deviceService.findBy.mockResolvedValue([deviceA, deviceB] as never);

    const next: NextFunction = await callTopology({
      siteId: siteId.toString(),
    });
    expect(next).not.toHaveBeenCalled();

    // The device query is site-scoped...
    const deviceQuery: JSONObject = (
      deviceService.findBy.mock.calls[0]![0] as JSONObject
    )["query"] as JSONObject;
    expect((deviceQuery["siteId"] as ObjectID).toString()).toBe(
      siteId.toString(),
    );

    // ...and the interface query follows it, rather than staying project-wide.
    const interfaceQuery: JSONObject = lastInterfaceQuery()[
      "query"
    ] as JSONObject;
    expect((interfaceQuery["projectId"] as ObjectID).toString()).toBe(
      projectId.toString(),
    );
    expect(idsInAnyOperator(interfaceQuery["networkDeviceId"])).toEqual([
      deviceA.id!.toString(),
      deviceB.id!.toString(),
    ]);
  });

  test("skips the interface query entirely when the graph has no devices", async () => {
    deviceService.findBy.mockResolvedValue([] as never);

    await callTopology({});

    expect(interfaceService.findBy).not.toHaveBeenCalled();
    expect(endpointService.findBy).not.toHaveBeenCalled();
  });

  test("enriches nodes with the interface rows the scoped query returned", async () => {
    const device: NetworkDevice = makeDevice("store-sw1");
    deviceService.findBy.mockResolvedValue([device] as never);
    interfaceService.findBy.mockResolvedValue([
      makeInterface(device.id!, 1),
    ] as never);

    await callTopology({ siteId: ObjectID.generate().toString() });

    const body: JSONObject = lastResponseBody();
    expect((body["nodes"] as Array<JSONObject>).length).toBe(1);
    expect((body["nodes"] as Array<JSONObject>)[0]!["name"]).toBe("store-sw1");
  });

  /*
   * isTruncated drives a "only part of it is shown, use search to narrow it
   * down" banner — a statement about missing DEVICES. Interface-cap loss
   * leaves every node and edge present and search cannot fix it, so it must
   * not raise that flag.
   */
  test("a full interface page does not set isTruncated, it sets interfacesTruncated", async () => {
    const device: NetworkDevice = makeDevice("core-sw1");
    deviceService.findBy.mockResolvedValue([device] as never);

    const rows: Array<NetworkInterface> = [];
    for (let index: number = 0; index < LIMIT_PER_PROJECT; index++) {
      rows.push(makeInterface(device.id!, index));
    }
    interfaceService.findBy.mockResolvedValue(rows as never);

    await callTopology({ siteId: ObjectID.generate().toString() });

    const body: JSONObject = lastResponseBody();
    expect(body["isTruncated"]).toBe(false);
    expect(body["interfacesTruncated"]).toBe(true);
  });

  test("a full device page sets isTruncated and leaves interfacesTruncated false", async () => {
    const devices: Array<NetworkDevice> = [];
    for (let index: number = 0; index < LIMIT_PER_PROJECT; index++) {
      devices.push(makeDevice(`sw-${index}`));
    }
    deviceService.findBy.mockResolvedValue(devices as never);
    interfaceService.findBy.mockResolvedValue([] as never);

    await callTopology({});

    const body: JSONObject = lastResponseBody();
    expect(body["isTruncated"]).toBe(true);
    expect(body["interfacesTruncated"]).toBe(false);
  });

  test("neither flag is set for a small graph", async () => {
    deviceService.findBy.mockResolvedValue([makeDevice("sw1")] as never);

    await callTopology({});

    const body: JSONObject = lastResponseBody();
    expect(body["isTruncated"]).toBe(false);
    expect(body["interfacesTruncated"]).toBe(false);
  });
});
