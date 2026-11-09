import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #5762's four routes, beside the Traffic pages' summaries and behind
 * the same middleware:
 *
 *   POST /network-traffic/usage-list         a page of a whole list
 *   POST /network-traffic/usage-appliances   the appliances to link to
 *   POST /network-traffic/link-appliance     link a device to one
 *   POST /network-traffic/unlink-appliance   undo it
 *
 * Every request is parsed before anything is read or written - a bad one is
 * the caller's error, never a page of everything nor a write of anything -
 * and handed on with the caller's own props. `jest` is the global one.
 */

type Handler = (req: unknown, res: unknown, next: jest.Mock) => Promise<void>;
const mockRoutes: Array<{ uri: string; handlers: Array<Handler> }> = [];
const mockList: jest.Mock = jest.fn();
const mockListAppliances: jest.Mock = jest.fn();
const mockLink: jest.Mock = jest.fn();
const mockUnlink: jest.Mock = jest.fn();
const mockSend: jest.Mock = jest.fn();
const mockProps: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return {
          post: (uri: string, ...handlers: Array<Handler>): void => {
            mockRoutes.push({ uri, handlers });
          },
          get: jest.fn(),
        };
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return { __esModule: true, default: { sendJsonObjectResponse: mockSend } };
});

jest.mock("Common/Server/API/CommonAPI", () => {
  return {
    __esModule: true,
    default: { getDatabaseCommonInteractionProps: mockProps },
  };
});

jest.mock("Common/Server/Utils/NetworkFlow/NetworkTrafficUsageSummary", () => {
  const actual: {
    default: { parseRequest: unknown; parseListRequest: unknown };
  } = jest.requireActual(
    "Common/Server/Utils/NetworkFlow/NetworkTrafficUsageSummary",
  );

  return {
    __esModule: true,
    default: {
      parseRequest: actual.default.parseRequest,
      parseListRequest: actual.default.parseListRequest,
      list: mockList,
    },
  };
});

jest.mock(
  "Common/Server/Utils/NetworkController/NetworkControllerApplianceLink",
  () => {
    return {
      __esModule: true,
      default: {
        listAppliances: mockListAppliances,
        link: mockLink,
        unlink: mockUnlink,
      },
    };
  },
);

import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import NetworkTrafficAPI from "../../FeatureSet/BaseAPI/API/NetworkTraffic";

const PROPS: { tenantId: ObjectID } = {
  tenantId: new ObjectID("11111111-1111-4111-8111-111111111111"),
};
const ROUTER: string = "40000000-0000-4000-8000-000000000002";

function route(uri: string): { uri: string; handlers: Array<Handler> } {
  const found: { uri: string; handlers: Array<Handler> } | undefined =
    mockRoutes.find((item: { uri: string }) => {
      return item.uri === uri;
    });
  expect(found).toBeDefined();
  return found!;
}

async function call(uri: string, body: unknown): Promise<jest.Mock> {
  const next: jest.Mock = jest.fn();
  await route(uri).handlers[1]!({ body }, {}, next);
  return next;
}

new NetworkTrafficAPI().getRouter();

beforeEach(() => {
  for (const mock of [mockList, mockListAppliances, mockLink, mockUnlink]) {
    mock.mockReset();
    mock.mockResolvedValue({ answered: true } as never);
  }

  mockSend.mockReset();
  mockProps.mockReset();
  mockProps.mockResolvedValue(PROPS as never);
});

describe("the four routes", () => {
  test.each([
    ["/network-traffic/usage-list"],
    ["/network-traffic/usage-appliances"],
    ["/network-traffic/link-appliance"],
    ["/network-traffic/unlink-appliance"],
  ])("%s is a POST behind the dashboard's user middleware", (uri: string) => {
    expect(route(uri).handlers[0]).toBe(UserMiddleware.getUserMiddleware);
    expect(route(uri).handlers).toHaveLength(2);
  });
});

describe("POST /network-traffic/usage-list", () => {
  test("a page of a list, read with the caller's own props", async () => {
    const next: jest.Mock = await call("/network-traffic/usage-list", {
      startTime: "2026-10-24T11:00:00.000Z",
      endTime: "2026-10-24T12:00:00.000Z",
      list: "networks",
      search: "store",
      sortBy: "in",
      skip: 25,
      limit: 25,
    });

    expect(next).not.toHaveBeenCalled();
    const asked: {
      props: unknown;
      request: { list: string; search: string; sortBy: string; skip: number };
    } = mockList.mock.calls[0]![0] as never;
    expect(asked.props).toBe(PROPS);
    expect(asked.request.list).toBe("networks");
    expect(asked.request.search).toBe("store");
    expect(asked.request.sortBy).toBe("in");
    expect(asked.request.skip).toBe(25);
    expect(mockSend.mock.calls[0]![2]).toEqual({ answered: true });
  });

  test.each([
    [{ list: "uplinks" }],
    [{ list: "networks", limit: 5000 }],
    [{ list: "networks", networkDeviceId: "router-1" }],
  ])("%p is refused, and nothing is read", async (body: unknown) => {
    const next: jest.Mock = await call("/network-traffic/usage-list", body);

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(mockList).not.toHaveBeenCalled();
  });
});

describe("POST /network-traffic/usage-appliances", () => {
  test("the appliances for the device and the search, with the caller's own props", async () => {
    const next: jest.Mock = await call("/network-traffic/usage-appliances", {
      networkDeviceId: ROUTER,
      search: " lds ",
    });

    expect(next).not.toHaveBeenCalled();
    const asked: {
      props: unknown;
      request: { networkDeviceId: ObjectID; search: string };
      now: Date;
    } = mockListAppliances.mock.calls[0]![0] as never;
    expect(asked.props).toBe(PROPS);
    expect(asked.request.networkDeviceId.toString()).toBe(ROUTER);
    expect(asked.request.search).toBe("lds");
    expect(asked.now).toBeInstanceOf(Date);
  });

  test("no device: refused, and nothing is read", async () => {
    const next: jest.Mock = await call("/network-traffic/usage-appliances", {
      search: "lds",
    });

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(mockListAppliances).not.toHaveBeenCalled();
  });
});

describe("POST /network-traffic/link-appliance and /unlink-appliance", () => {
  test("a link: the device and the appliance's serial number, as the caller", async () => {
    const next: jest.Mock = await call("/network-traffic/link-appliance", {
      networkDeviceId: ROUTER,
      deviceSerial: "q2pn-lds0-0012",
    });

    expect(next).not.toHaveBeenCalled();
    const asked: {
      props: unknown;
      request: { networkDeviceId: ObjectID; deviceSerial: string };
    } = mockLink.mock.calls[0]![0] as never;
    expect(asked.props).toBe(PROPS);
    expect(asked.request.deviceSerial).toBe("Q2PN-LDS0-0012");
    expect(mockSend.mock.calls[0]![2]).toEqual({ answered: true });
  });

  test.each([
    [{ networkDeviceId: ROUTER }],
    [{ networkDeviceId: ROUTER, deviceSerial: "Q2PN'; DROP TABLE x" }],
    [{ deviceSerial: "Q2PN-LDS0-0012" }],
  ])(
    "a link of %p is refused, and nothing is written",
    async (body: unknown) => {
      const next: jest.Mock = await call(
        "/network-traffic/link-appliance",
        body,
      );

      expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
      expect(mockLink).not.toHaveBeenCalled();
    },
  );

  test("an unlink: the device alone, as the caller", async () => {
    const next: jest.Mock = await call("/network-traffic/unlink-appliance", {
      networkDeviceId: ROUTER,
    });

    expect(next).not.toHaveBeenCalled();
    expect(
      (
        mockUnlink.mock.calls[0]![0] as {
          request: { networkDeviceId: ObjectID };
        }
      ).request.networkDeviceId.toString(),
    ).toBe(ROUTER);

    const refused: jest.Mock = await call(
      "/network-traffic/unlink-appliance",
      {},
    );
    expect(refused).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(mockUnlink).toHaveBeenCalledTimes(1);
  });

  test("a refusal from the link itself goes to the error handler", async () => {
    mockLink.mockRejectedValueOnce(
      new BadDataException(
        "This appliance is linked to another device already. Unlink it there first.",
      ) as never,
    );

    const next: jest.Mock = await call("/network-traffic/link-appliance", {
      networkDeviceId: ROUTER,
      deviceSerial: "Q2PN-LDS0-0012",
    });

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(mockSend).not.toHaveBeenCalled();
  });
});
