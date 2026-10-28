import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * POST /network-traffic/find-address (issue #5340): "find an address" by its
 * name, behind the same middleware as the Traffic page's summary. The
 * request is parsed before anything is read - nothing typed, or a scope the
 * server would refuse, is the caller's error and searches nothing - and the
 * answer is NetworkTrafficSummaryUtil.find's, with the caller's own props.
 * `jest` is the global one.
 */

type Handler = (req: unknown, res: unknown, next: jest.Mock) => Promise<void>;
const mockRoutes: Array<{ uri: string; handlers: Array<Handler> }> = [];
const mockFind: jest.Mock = jest.fn();
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

jest.mock("Common/Server/Utils/NetworkFlow/NetworkTrafficSummary", () => {
  const actual: {
    default: { parseRequest: unknown; parseFindRequest: unknown };
  } = jest.requireActual(
    "Common/Server/Utils/NetworkFlow/NetworkTrafficSummary",
  );

  return {
    __esModule: true,
    default: {
      parseRequest: actual.default.parseRequest,
      parseFindRequest: actual.default.parseFindRequest,
      build: jest.fn(),
      find: mockFind,
    },
  };
});

import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import NetworkTrafficAPI from "../../FeatureSet/BaseAPI/API/NetworkTraffic";

const PROPS: { tenantId: ObjectID } = {
  tenantId: new ObjectID("11111111-1111-4111-8111-111111111111"),
};

function route(uri: string): { uri: string; handlers: Array<Handler> } {
  const found: { uri: string; handlers: Array<Handler> } | undefined =
    mockRoutes.find((item: { uri: string }) => {
      return item.uri === uri;
    });
  expect(found).toBeDefined();
  return found!;
}

new NetworkTrafficAPI().getRouter();

beforeEach(() => {
  mockFind.mockReset();
  mockFind.mockResolvedValue({
    matches: [
      { address: "10.0.0.5", name: "mumbai-fs01", source: "host", octets: 9 },
    ],
  } as never);
  mockSend.mockReset();
  mockProps.mockReset();
  mockProps.mockResolvedValue(PROPS as never);
});

describe("POST /network-traffic/find-address", () => {
  test("behind the same middleware as the Traffic page's summary", () => {
    expect(route("/network-traffic/find-address").handlers[0]).toBe(
      UserMiddleware.getUserMiddleware,
    );
  });

  test("answers with what find found, searched with the caller's own props", async () => {
    const next: jest.Mock = jest.fn();
    const req: { body: unknown } = {
      body: {
        networkSiteId: "22222222-2222-4222-8222-222222222222",
        startTime: "2026-10-28T11:00:00.000Z",
        endTime: "2026-10-28T12:00:00.000Z",
        query: "  mumbai ",
      },
    };

    await route("/network-traffic/find-address").handlers[1]!(req, {}, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockFind).toHaveBeenCalledTimes(1);
    const found: {
      props: unknown;
      request: { query: string; networkSiteId: ObjectID; startTime: Date };
    } = mockFind.mock.calls[0]![0] as never;
    expect(found.props).toBe(PROPS);
    expect(found.request.query).toBe("mumbai");
    expect(found.request.networkSiteId.toString()).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(found.request.startTime).toEqual(
      new Date("2026-10-28T11:00:00.000Z"),
    );
    expect(mockSend.mock.calls[0]![2]).toEqual({
      matches: [
        {
          address: "10.0.0.5",
          name: "mumbai-fs01",
          source: "host",
          octets: 9,
        },
      ],
    });
  });

  test("nothing typed is an error, and nothing is searched", async () => {
    const next: jest.Mock = jest.fn();

    await route("/network-traffic/find-address").handlers[1]!(
      { body: { query: "   " } },
      {},
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(mockFind).not.toHaveBeenCalled();
  });

  test("a scope the server would refuse is an error, and nothing is searched", async () => {
    const next: jest.Mock = jest.fn();

    await route("/network-traffic/find-address").handlers[1]!(
      {
        body: {
          query: "fs01",
          networkDeviceId: "33333333-3333-4333-8333-333333333333",
          networkSiteId: "22222222-2222-4222-8222-222222222222",
        },
      },
      {},
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(mockFind).not.toHaveBeenCalled();
  });

  test("a failure while searching is passed on", async () => {
    const next: jest.Mock = jest.fn();
    const failure: Error = new Error("ClickHouse went away");
    mockFind.mockRejectedValue(failure as never);

    await route("/network-traffic/find-address").handlers[1]!(
      { body: { query: "fs01" } },
      {},
      next,
    );

    expect(next).toHaveBeenCalledWith(failure);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
