import { mockRouter } from "./Helpers";
import AIAgentAPI from "../../../Server/API/AIAgentAPI";
import AIAgentService from "../../../Server/Services/AIAgentService";
import WrongComponentKeyLimit from "../../../Server/Utils/RateLimit/WrongComponentKeyLimit";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AIAgent from "../../../Models/DatabaseModels/AIAgent";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { GLOBAL_AI_AGENT_GONE_MESSAGE } from "../../../Types/Runner/GlobalAIAgentsGone";
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
 * A GLOBAL AI AGENT'S HEARTBEAT IS TOLD WHAT TO START INSTEAD.
 *
 * Global AI agents - an AI agent with no project: the shared Runner's
 * registration, or one a master admin added on the Admin Dashboard's
 * removed Global AI Agents page and started a Runner with - are what global
 * Runners replaced. Their rows stay, but their id and key prove nothing on
 * the code-fix routes (CodeFixAgentAuth). A Runner started with them checks
 * in here (RegisterRunner's fallback for credentials from before Runners):
 * it is refused with GLOBAL_AI_AGENT_GONE_MESSAGE, which it logs, rather
 * than coming up to fail every request it makes. Its key is right, so it is
 * never counted as a wrong one. An AI agent a project created before
 * Runners keeps checking in as before.
 */

const ALIVE_ROUTE: string = "/ai-agent/alive";
const PROJECT_ID: ObjectID = new ObjectID(
  "2d3e4f5a-1111-4b6c-8d7e-8f9a0b1c2d3e",
);

const responseUtil: {
  sendErrorResponse: jest.Mock;
  sendEmptySuccessResponse: jest.Mock;
} = Response as unknown as {
  sendErrorResponse: jest.Mock;
  sendEmptySuccessResponse: jest.Mock;
};

let storedAgent: AIAgent | null;
let updateLastAlive: jest.SpyInstance;
let checkComponentKey: jest.SpyInstance;
let findOneBy: jest.SpyInstance;

async function heartbeat(): Promise<void> {
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await mockRouter.match("post", ALIVE_ROUTE).handlerFunction(
    {
      body: {
        aiAgentId: ObjectID.generate().toString(),
        aiAgentKey: ObjectID.generate().toString(),
      } as JSONObject,
      headers: {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next,
  );

  expect(next).not.toHaveBeenCalled();
}

function refusal(): Error | undefined {
  return responseUtil.sendErrorResponse.mock.calls[0]?.[2] as Error | undefined;
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new AIAgentAPI();
});

beforeEach(() => {
  jest.clearAllMocks();
  storedAgent = null;

  findOneBy = jest
    .spyOn(AIAgentService, "findOneBy")
    .mockImplementation(async () => {
      return storedAgent as never;
    });
  updateLastAlive = jest
    .spyOn(AIAgentService, "updateLastAlive")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(WrongComponentKeyLimit, "checkBeforeLookup")
    .mockResolvedValue(null);
  checkComponentKey = jest
    .spyOn(WrongComponentKeyLimit, "checkComponentKey")
    .mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /ai-agent/alive", () => {
  test("an AI agent a project created before Runners checks in as before", async () => {
    storedAgent = new AIAgent();
    storedAgent._id = ObjectID.generate().toString();
    storedAgent.projectId = PROJECT_ID;

    await heartbeat();

    expect(refusal()).toBeUndefined();
    expect(updateLastAlive).toHaveBeenCalledTimes(1);
    expect(responseUtil.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
  });

  test("a global AI agent is told global Runners replaced it, and what to start instead", async () => {
    storedAgent = new AIAgent();
    storedAgent._id = ObjectID.generate().toString();

    await heartbeat();

    expect(refusal()).toBeInstanceOf(BadDataException);
    expect(refusal()?.message).toBe(GLOBAL_AI_AGENT_GONE_MESSAGE);
    expect(GLOBAL_AI_AGENT_GONE_MESSAGE).toContain("Settings > Global Runners");
    // It is no longer shown alive anywhere.
    expect(updateLastAlive).not.toHaveBeenCalled();
    expect(responseUtil.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });

  test("a global AI agent's key is right, so it is never counted as a wrong one", async () => {
    storedAgent = new AIAgent();
    storedAgent._id = ObjectID.generate().toString();

    await heartbeat();

    expect(checkComponentKey).toHaveBeenCalledTimes(1);
    expect(
      (checkComponentKey.mock.calls[0]![0] as { isKeyRight: boolean })
        .isKeyRight,
    ).toBe(true);
  });

  test("an id and key that match no AI agent are refused as before, and counted", async () => {
    await heartbeat();

    expect(refusal()?.message).toBe("Invalid AI Agent ID or AI Agent Key");
    expect(
      (checkComponentKey.mock.calls[0]![0] as { isKeyRight: boolean })
        .isKeyRight,
    ).toBe(false);
    expect(updateLastAlive).not.toHaveBeenCalled();
  });

  test("the agent is read with its project, which says whether it is a global one", async () => {
    await heartbeat();

    const read: { select: JSONObject } = findOneBy.mock.calls[0]![0] as never;

    expect(read.select["projectId"]).toBe(true);
  });
});
