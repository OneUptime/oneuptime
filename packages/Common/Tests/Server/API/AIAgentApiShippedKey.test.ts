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
 * An AI agent a project created before Runners proves itself with the key the
 * server made for it, a long random value. A value the repository ships is
 * public, so the agent heartbeat (/alive) never admits it, and never reads
 * an agent for it. Nothing registers an agent any more: the shared Runner
 * that registered as the installation's global agent is gone.
 */

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
  sendEmptySuccessResponse: jest.Mock;
} = Response as unknown as {
  sendErrorResponse: jest.Mock;
  sendEmptySuccessResponse: jest.Mock;
};

describe("the AI agent heartbeat refuses a shipped agent key", () => {
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

  test("there is no registration to send one to", () => {
    expect(() => {
      return mockRouter.match("post", "/ai-agent/register");
    }).toThrow();
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
