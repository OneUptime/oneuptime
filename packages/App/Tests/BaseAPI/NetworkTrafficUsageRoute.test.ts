import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * POST /network-traffic/usage-summary (issue #5140): the Meraki side of a
 * Traffic page, beside the flows' /network-traffic/summary and behind the
 * same middleware. The request is parsed before anything is read - a bad
 * one is the caller's error, never a page of everything - and the answer is
 * NetworkTrafficUsageSummaryUtil's, with the caller's own props. `jest` is
 * the global one.
 */

type Handler = (req: unknown, res: unknown, next: jest.Mock) => Promise<void>;
const mockRoutes: Array<{ uri: string; handlers: Array<Handler> }> = [];
const mockBuild: jest.Mock = jest.fn();
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
  const actual: { default: { parseRequest: unknown } } = jest.requireActual(
    "Common/Server/Utils/NetworkFlow/NetworkTrafficUsageSummary",
  );

  return {
    __esModule: true,
    default: { parseRequest: actual.default.parseRequest, build: mockBuild },
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
  mockBuild.mockReset();
  mockBuild.mockResolvedValue({ isAvailable: false } as never);
  mockSend.mockReset();
  mockProps.mockReset();
  mockProps.mockResolvedValue(PROPS as never);
});

describe("POST /network-traffic/usage-summary", () => {
  test("behind the same middleware as the flows' summary", () => {
    expect(route("/network-traffic/usage-summary").handlers[0]).toBe(
      UserMiddleware.getUserMiddleware,
    );
    expect(route("/network-traffic/summary").handlers[0]).toBe(
      UserMiddleware.getUserMiddleware,
    );
  });

  test("answers with the summary, built with the caller's own props", async () => {
    const next: jest.Mock = jest.fn();
    const req: { body: unknown } = {
      body: {
        startTime: "2026-10-24T11:00:00.000Z",
        endTime: "2026-10-24T12:00:00.000Z",
        filters: { controllerNetworkId: "L_1000" },
      },
    };

    await route("/network-traffic/usage-summary").handlers[1]!(req, {}, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockBuild).toHaveBeenCalledTimes(1);
    const built: {
      props: unknown;
      request: { filters: unknown; startTime: Date };
    } = mockBuild.mock.calls[0]![0] as never;
    expect(built.props).toBe(PROPS);
    expect(built.request.filters).toEqual({ controllerNetworkId: "L_1000" });
    expect(built.request.startTime).toEqual(
      new Date("2026-10-24T11:00:00.000Z"),
    );
    expect(mockSend.mock.calls[0]![2]).toEqual({ isAvailable: false });
  });

  test("a request the server would refuse is an error, and nothing is read", async () => {
    const next: jest.Mock = jest.fn();

    await route("/network-traffic/usage-summary").handlers[1]!(
      { body: { filters: { controllerNetworkId: "L_1' OR 1=1 --" } } },
      {},
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(mockBuild).not.toHaveBeenCalled();
  });
});
