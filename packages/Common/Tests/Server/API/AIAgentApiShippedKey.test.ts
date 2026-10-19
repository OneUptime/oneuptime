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

interface AIAgentRow {
  key?: string;
  isGlobalAIAgent?: boolean;
}

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
      jest.spyOn(AIAgentService, "findBy").mockResolvedValue([] as never);
      const create: jest.SpyInstance = jest
        .spyOn(AIAgentService, "create")
        .mockResolvedValue({
          _id: ObjectID.generate(),
        } as never);

      const next: NextFunction = jest.fn() as unknown as NextFunction;
      await mockRouter.match("post", REGISTER_ROUTE).handlerFunction(
        {
          body: { aiAgentKey: ObjectID.generate().toString() },
        } as unknown as ExpressRequest,
        mockResponse,
        next,
      );

      expect(findOneBy).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledTimes(1);
      expect(next).not.toHaveBeenCalled();
      expect(responseUtil.sendErrorResponse).not.toHaveBeenCalled();
    });
  });

  /*
   * A Runner that ran on the ONEUPTIME_RUNNER_KEY placeholder comes back
   * under the random key npm start gave it. It takes over the global agent
   * whose key is a shipped value - the agent it ran as, refused from then
   * on - so it stays the one global agent every project without its own
   * uses. A global agent whose key is the installation's own is never taken
   * over.
   */
  describe("POST /register with a key no global agent holds", () => {
    const NEW_KEY: string = "c0ffee5e6d7a4b8c9d0e1f2a3b4c5d6e";

    function globalAgents(
      ...rows: Array<{ key: string | null; lastAlive?: Date }>
    ): {
      ids: Array<ObjectID>;
      findBy: jest.SpyInstance;
      updateOneById: jest.SpyInstance;
      create: jest.SpyInstance;
    } {
      const ids: Array<ObjectID> = rows.map(() => {
        return ObjectID.generate();
      });

      jest.spyOn(AIAgentService, "findOneBy").mockResolvedValue(null as never);

      const findBy: jest.SpyInstance = jest
        .spyOn(AIAgentService, "findBy")
        .mockResolvedValue(
          rows.map(
            (each: { key: string | null; lastAlive?: Date }, index: number) => {
              return {
                _id: ids[index]!.toString(),
                id: ids[index],
                key: each.key,
                lastAlive: each.lastAlive,
              };
            },
          ) as never,
        );
      const updateOneById: jest.SpyInstance = jest
        .spyOn(AIAgentService, "updateOneById")
        .mockResolvedValue(undefined as never);
      const create: jest.SpyInstance = jest
        .spyOn(AIAgentService, "create")
        .mockResolvedValue({ _id: ObjectID.generate().toString() } as never);

      return { ids, findBy, updateOneById, create };
    }

    function answered(): JSONObject {
      expect(responseUtil.sendErrorResponse).not.toHaveBeenCalled();
      expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
      return (responseUtil.sendJsonObjectResponse as jest.Mock).mock
        .calls[0]![2] as JSONObject;
    }

    test("takes over the global agent whose key is the shipped placeholder, keeping its id", async () => {
      const agents: ReturnType<typeof globalAgents> = globalAgents({
        key: "please-change-this-to-random-value",
        lastAlive: new Date("2026-10-17T00:00:00Z"),
      });

      await call(REGISTER_ROUTE, { aiAgentKey: NEW_KEY });

      const body: JSONObject = answered();
      expect(body["_id"]).toBe(agents.ids[0]!.toString());
      expect(body["message"]).toBe("AI Agent already registered");

      expect(agents.updateOneById).toHaveBeenCalledTimes(1);
      const update: JSONObject = agents.updateOneById.mock
        .calls[0]![0] as JSONObject;
      expect((update["id"] as ObjectID).toString()).toBe(
        agents.ids[0]!.toString(),
      );
      expect((update["data"] as JSONObject)["key"]).toBe(NEW_KEY);
      expect(agents.create).not.toHaveBeenCalled();
    });

    test("looks only at the global agents, reading their keys", async () => {
      const agents: ReturnType<typeof globalAgents> = globalAgents({
        key: "please-change-this-to-random-value",
      });

      await call(REGISTER_ROUTE, { aiAgentKey: NEW_KEY });

      expect(agents.findBy).toHaveBeenCalledTimes(1);
      const findBy: JSONObject = agents.findBy.mock.calls[0]![0] as JSONObject;
      expect(findBy["query"]).toEqual({ isGlobalAIAgent: true });
      expect(findBy["select"]).toEqual({
        _id: true,
        key: true,
        lastAlive: true,
      });
    });

    test("never takes over a global agent whose key is the installation's own: it registers a new one", async () => {
      const agents: ReturnType<typeof globalAgents> = globalAgents({
        key: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
        lastAlive: new Date(),
      });

      await call(REGISTER_ROUTE, { aiAgentKey: NEW_KEY });

      expect(answered()["message"]).toBe("AI Agent registered successfully");
      expect(agents.updateOneById).not.toHaveBeenCalled();
      expect(agents.create).toHaveBeenCalledTimes(1);
      const created: AIAgentRow = (
        agents.create.mock.calls[0]![0] as { data: AIAgentRow }
      ).data;
      expect(created.key).toBe(NEW_KEY);
      expect(created.isGlobalAIAgent).toBe(true);
    });

    test("of a live global agent and a dead one, takes over only the dead one", async () => {
      const agents: ReturnType<typeof globalAgents> = globalAgents(
        { key: "a1b2c3d4e5f60718293a4b5c6d7e8f90", lastAlive: new Date() },
        { key: "please-change-this-to-random-value" },
      );

      await call(REGISTER_ROUTE, { aiAgentKey: NEW_KEY });

      expect(answered()["_id"]).toBe(agents.ids[1]!.toString());
      expect(agents.create).not.toHaveBeenCalled();
    });

    test("registers a new global agent when there is none", async () => {
      const agents: ReturnType<typeof globalAgents> = globalAgents();

      await call(REGISTER_ROUTE, { aiAgentKey: NEW_KEY });

      expect(answered()["message"]).toBe("AI Agent registered successfully");
      expect(agents.create).toHaveBeenCalledTimes(1);
      expect(agents.updateOneById).not.toHaveBeenCalled();
    });

    test("a Runner whose key a global agent holds is that agent: its key is left as it is, and nothing else is looked up", async () => {
      const id: ObjectID = ObjectID.generate();
      jest
        .spyOn(AIAgentService, "findOneBy")
        .mockResolvedValue({ _id: id.toString(), id } as never);
      const findBy: jest.SpyInstance = jest.spyOn(AIAgentService, "findBy");
      const updateOneById: jest.SpyInstance = jest
        .spyOn(AIAgentService, "updateOneById")
        .mockResolvedValue(undefined as never);

      await call(REGISTER_ROUTE, { aiAgentKey: NEW_KEY });

      expect(answered()["_id"]).toBe(id.toString());
      expect(findBy).not.toHaveBeenCalled();
      const update: JSONObject = updateOneById.mock.calls[0]![0] as JSONObject;
      expect(update["data"] as JSONObject).not.toHaveProperty("key");
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
