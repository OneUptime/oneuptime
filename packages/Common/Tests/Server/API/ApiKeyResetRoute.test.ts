jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import ApiKeyAPI from "../../../Server/API/ApiKeyAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ApiKeyService, {
  API_KEY_WRITTEN_HERE_MESSAGE,
  MadeApiKey,
} from "../../../Server/Services/ApiKeyService";
import ProjectService from "../../../Server/Services/ProjectService";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import {
  getResetApiKeyRoute,
  parseResetApiKeyAnswer,
  RESET_API_KEY_PATH,
} from "../../../Types/ApiKey/ApiKeyShownOnce";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import express from "express";
import fs from "fs";
import http from "http";
import { AddressInfo } from "net";
import path from "path";
import timers from "timers";

// jsdom has no setImmediate, and Express needs it.
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * A PROJECT'S API KEY OVER HTTP, NOW IT IS STORED HASHED (#8902).
 *
 *   - POST /api-key/:id/reset-key makes the key a new one and answers it
 *     once, with Cache-Control: no-store, through ApiKeyService.resetApiKey
 *     with the caller's own props (a member's, or an API key's: a script
 *     may rotate the key it holds); a refusal answers no key; nothing logs
 *     the key;
 *   - POST /api-key - the create - answers the new record with the key in
 *     it, the one time it is sent, with Cache-Control: no-store too;
 *   - a write of the key through the generic update is refused, saying
 *     where a key is made;
 *   - the /api-key routes are registered once (they were registered twice).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const KEY_ID: string = "22222222-2222-4222-8222-222222222222";
const NEW_KEY: string = "5f3b9c1e-7a2d-4e8f-b6c0-1d2e3f4a5b6c";

interface HttpResult {
  status: number;
  body: JSONObject | null;
  text: string;
  headers: http.IncomingHttpHeaders;
}

function request(data: {
  port: number;
  method: "POST" | "PUT";
  path: string;
  body?: JSONObject | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string = JSON.stringify(data.body || {});
      const outgoing: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: data.path,
          method: data.method,
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
          },
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            const text: string = Buffer.concat(chunks).toString("utf8");
            let body: JSONObject | null = null;

            try {
              body = text ? (JSON.parse(text) as JSONObject) : null;
            } catch {
              body = null;
            }

            resolve({
              status: response.statusCode || 0,
              body,
              text,
              headers: response.headers,
            });
          });
        },
      );

      outgoing.on("error", reject);
      outgoing.write(payload);
      outgoing.end();
    },
  );
}

describe("a project's API key, over HTTP", () => {
  let server: http.Server;
  let port: number;
  let reset: jest.SpyInstance;
  let signedInUserId: ObjectID;

  beforeAll(async () => {
    /*
     * The caller, as the user middleware leaves a signed-in member: in the
     * project, by their id. Stood in before the router is made, which
     * takes the middleware as its routes are registered.
     */
    jest.spyOn(UserMiddleware, "getUserMiddleware").mockImplementation((async (
      req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      (req as OneUptimeRequest).tenantId = PROJECT_ID;
      (req as OneUptimeRequest).userAuthorization = {
        userId: signedInUserId,
      } as never;
      next();
    }) as never);

    /*
     * The project's plan, as the database answers it. Where billing is on -
     * Common Test's config.env has BILLING_ENABLED=true - every request a
     * member makes in a project reads its project's plan
     * (CommonAPI.getDatabaseCommonInteractionProps, CallerPlan), and with
     * no database here that read answered 500 before the route ran.
     */
    jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: false,
    });

    const app: express.Express = express();
    app.use(express.json());
    const router: ExpressRouter = express.Router();
    router.use(new ApiKeyAPI().getRouter());
    app.use("/api", router);
    app.use(expressErrorHandler);

    server = http.createServer(app);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  beforeEach(() => {
    signedInUserId = ObjectID.generate();

    reset = jest
      .spyOn(ApiKeyService, "resetApiKey")
      .mockImplementation(async (): Promise<MadeApiKey> => {
        return { apiKey: NEW_KEY, apiKeyHint: NEW_KEY.slice(-4) };
      });
  });

  afterEach(() => {
    reset.mockRestore();
    jest.mocked(logger.error).mockClear();
  });

  describe("POST /api-key/:id/reset-key", () => {
    test("is the route the Dashboard calls", () => {
      expect(RESET_API_KEY_PATH).toBe("reset-key");
      expect(getResetApiKeyRoute(KEY_ID)).toBe(`/api-key/${KEY_ID}/reset-key`);
    });

    test("makes the key a new one with the caller's props, and answers it once", async () => {
      const result: HttpResult = await request({
        port,
        method: "POST",
        path: `/api${getResetApiKeyRoute(KEY_ID)}`,
      });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        apiKey: NEW_KEY,
        apiKeyHint: NEW_KEY.slice(-4),
      });
      expect(parseResetApiKeyAnswer(result.body)).toEqual({
        apiKey: NEW_KEY,
        apiKeyHint: NEW_KEY.slice(-4),
      });

      expect(reset).toHaveBeenCalledTimes(1);

      const call: {
        id: ObjectID;
        props: DatabaseCommonInteractionProps;
      } = reset.mock.calls[0]![0] as {
        id: ObjectID;
        props: DatabaseCommonInteractionProps;
      };

      expect(call.id.toString()).toBe(KEY_ID);
      // As the caller, in their project: never as OneUptime itself.
      expect(call.props.isRoot).toBeFalsy();
      expect(call.props.userId?.toString()).toBe(signedInUserId.toString());
      expect(call.props.tenantId?.toString()).toBe(PROJECT_ID.toString());
    });

    test("no cache may keep the answer that holds the key", async () => {
      const result: HttpResult = await request({
        port,
        method: "POST",
        path: `/api${getResetApiKeyRoute(KEY_ID)}`,
      });

      expect(result.headers["cache-control"]).toBe("no-store");
    });

    test("an id that is no id is refused, and no key is made", async () => {
      const result: HttpResult = await request({
        port,
        method: "POST",
        path: `/api/api-key/not-an-id/reset-key`,
      });

      expect(result.status).toBe(400);
      expect(reset).not.toHaveBeenCalled();
      expect(result.text).not.toContain(NEW_KEY);
    });

    test("a reset the service refuses answers why, and no key", async () => {
      reset.mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permission to update API Key.",
        ),
      );

      const result: HttpResult = await request({
        port,
        method: "POST",
        path: `/api${getResetApiKeyRoute(KEY_ID)}`,
      });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.status).toBeLessThan(500);
      expect(result.text).toContain(
        "You do not have permission to update API Key.",
      );
      expect(result.body?.["apiKey"]).toBeUndefined();
    });

    test("the key reaches no log", async () => {
      await request({
        port,
        method: "POST",
        path: `/api${getResetApiKeyRoute(KEY_ID)}`,
      });

      const logged: string = JSON.stringify(
        [logger.debug, logger.info, logger.warn, logger.error].map(
          (log: unknown): unknown => {
            return (log as jest.Mock).mock.calls;
          },
        ),
      );

      expect(logged).not.toContain(NEW_KEY);
    });
  });

  describe("POST /api-key", () => {
    test("answers the new record with the key in it - once - and no cache may keep it", async () => {
      const create: jest.SpyInstance = jest
        .spyOn(ApiKeyService, "create")
        .mockImplementation((async (
          createBy: CreateBy<ApiKey>,
        ): Promise<ApiKey> => {
          const created: ApiKey = Object.assign(new ApiKey(), {
            _id: KEY_ID,
            name: createBy.data.name,
            apiKeyHint: NEW_KEY.slice(-4),
          });

          // As ApiKeyService.onCreateSuccess hands it back: the key itself.
          created.apiKey = new HashedString(NEW_KEY);

          return created;
        }) as never);

      const result: HttpResult = await request({
        port,
        method: "POST",
        path: "/api/api-key",
        body: { data: { name: "Terraform" } },
      });

      create.mockRestore();

      expect(result.status).toBe(200);
      expect(result.headers["cache-control"]).toBe("no-store");
      expect(result.body?.["apiKey"]).toEqual({
        _type: "HashedString",
        value: NEW_KEY,
      });
      expect(result.body?.["apiKeyHint"]).toBe(NEW_KEY.slice(-4));
    });
  });

  /*
   * Through the generic update, a key of the caller's choosing is refused -
   * here by the update's own permission check, as this caller holds none;
   * with every permission, by ApiKeyService.assertKeyWrittenByOneUptime
   * (ApiKeyServiceHashedKeys, and HashProjectApiKeysPostgres on a real
   * database), with API_KEY_WRITTEN_HERE_MESSAGE.
   */
  describe("PUT /api-key/:id", () => {
    test("a key of the caller's choosing is refused, and never echoed", async () => {
      const result: HttpResult = await request({
        port,
        method: "PUT",
        path: `/api/api-key/${KEY_ID}`,
        body: {
          data: {
            apiKey: { _type: "HashedString", value: NEW_KEY },
            apiKeyHint: NEW_KEY.slice(-4),
          },
        },
      });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.status).toBeLessThan(500);
      expect(result.text).not.toContain(NEW_KEY);
      expect(API_KEY_WRITTEN_HERE_MESSAGE).toContain("reset-key");
    });
  });
});

describe("where the routes are registered", () => {
  test("once, by ApiKeyAPI: they were registered twice", () => {
    const index: string = fs.readFileSync(
      path.resolve(__dirname, "../../../../App/FeatureSet/BaseAPI/Index.ts"),
      "utf8",
    );

    expect(index.match(/new ApiKeyAPI\(\)/g)).toHaveLength(1);
    expect(index).not.toMatch(/new BaseAPI<ApiKey,/);
  });
});
