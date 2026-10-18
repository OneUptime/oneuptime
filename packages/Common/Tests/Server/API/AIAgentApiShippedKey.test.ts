import { mockRouter } from "./Helpers";
import AIAgentAPI from "../../../Server/API/AIAgentAPI";
import AIAgentService from "../../../Server/Services/AIAgentService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

jest.mock("../../../Server/Utils/Logger");

/*
 * The global AI agent's key is the in-cluster Runner's ONEUPTIME_RUNNER_KEY.
 * A value the repository ships for it is public, so the AI agent routes
 * refuse it: the heartbeat (/alive) never admits it, and registration
 * (/register) never stores an agent under it. Only OneUptime's own Runner,
 * with the installation's own key, is one of these.
 */

const REGISTER_ROUTE: string = "/ai-agent/register";
const ALIVE_ROUTE: string = "/ai-agent/alive";

const SHIPPED_KEYS: Array<[string, string]> = [
  ["the old fallback", "secret"],
  ["the bare placeholder", "please-change-this-to-random-value"],
  ["a partially edited placeholder", "please-change-this-to-random-value-3"],
  ["a blank key", "   "],
];

const mockResponse: ExpressResponse = {} as ExpressResponse;

async function call(route: string, body: JSONObject): Promise<void> {
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  await mockRouter
    .match("post", route)
    .handlerFunction({ body } as unknown as ExpressRequest, mockResponse, next);
}

const responseUtil: {
  sendErrorResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
  sendEmptySuccessResponse: jest.Mock;
} = Response as unknown as {
  sendErrorResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
  sendEmptySuccessResponse: jest.Mock;
};

describe("the AI agent routes refuse a shipped agent key", () => {
  beforeAll(() => {
    mockRouter.routes.length = 0;
    new AIAgentAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("POST /register", () => {
    test.each(SHIPPED_KEYS)(
      "refuses %s and creates no agent",
      async (_label: string, shippedKey: string) => {
        const findOneBy: jest.SpyInstance = jest.spyOn(
          AIAgentService,
          "findOneBy",
        );
        const create: jest.SpyInstance = jest.spyOn(AIAgentService, "create");

        await call(REGISTER_ROUTE, { aiAgentKey: shippedKey });

        expect(responseUtil.sendErrorResponse).toHaveBeenCalledTimes(1);
        const error: unknown = (responseUtil.sendErrorResponse as jest.Mock)
          .mock.calls[0]![2];
        expect(error).toBeInstanceOf(BadDataException);
        expect((error as BadDataException).message).toContain(
          "value the OneUptime repository ships",
        );
        expect(findOneBy).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
      },
    );

    test("lets a real random key through to the registry", async () => {
      const findOneBy: jest.SpyInstance = jest
        .spyOn(AIAgentService, "findOneBy")
        .mockResolvedValue(null as never);
      jest.spyOn(AIAgentService, "create").mockResolvedValue({
        _id: ObjectID.generate(),
      } as never);

      await call(REGISTER_ROUTE, {
        aiAgentKey: ObjectID.generate().toString(),
      });

      expect(findOneBy).toHaveBeenCalledTimes(1);
      expect(responseUtil.sendErrorResponse).not.toHaveBeenCalled();
    });
  });

  describe("POST /alive", () => {
    test.each(SHIPPED_KEYS)(
      "refuses %s and reads no agent",
      async (_label: string, shippedKey: string) => {
        const findOneBy: jest.SpyInstance = jest.spyOn(
          AIAgentService,
          "findOneBy",
        );

        await call(ALIVE_ROUTE, {
          aiAgentId: ObjectID.generate().toString(),
          aiAgentKey: shippedKey,
        });

        expect(responseUtil.sendErrorResponse).toHaveBeenCalledTimes(1);
        const error: unknown = (responseUtil.sendErrorResponse as jest.Mock)
          .mock.calls[0]![2];
        expect(error).toBeInstanceOf(BadDataException);
        expect((error as BadDataException).message).toContain(
          "value the OneUptime repository ships",
        );
        expect(findOneBy).not.toHaveBeenCalled();
        expect(responseUtil.sendEmptySuccessResponse).not.toHaveBeenCalled();
      },
    );

    test("lets a real random key through to the registry", async () => {
      const findOneBy: jest.SpyInstance = jest
        .spyOn(AIAgentService, "findOneBy")
        .mockResolvedValue(null as never);

      await call(ALIVE_ROUTE, {
        aiAgentId: ObjectID.generate().toString(),
        aiAgentKey: ObjectID.generate().toString(),
      });

      expect(findOneBy).toHaveBeenCalledTimes(1);
    });
  });
});
