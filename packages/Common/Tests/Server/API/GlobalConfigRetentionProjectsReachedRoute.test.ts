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

import GlobalConfigAPI from "../../../Server/API/GlobalConfigAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ResolvedRecordRetention from "../../../Server/Utils/Retention/ResolvedRecordRetention";
import { ExpressRouter } from "../../../Server/Utils/Express";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import { ResolvedRecordKind } from "../../../Types/Retention/ResolvedRecordRetention";
import { RESOLVED_RECORD_RETENTION_PROJECTS_REACHED_ROUTE } from "../../../Types/Retention/ResolvedRecordRetentionAnswers";
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
import http from "http";
import { AddressInfo } from "net";
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
 * GET /global-config/resolved-record-retention/projects-reached, over HTTP
 * (issue #6941): how many projects a server maximum on resolved incidents
 * (alerts) holds to a shorter length than they keep them for now - what Admin
 * Dashboard > Settings > Data Retention says before it sets one. A master
 * admin's only: it reads every project on the server.
 */

const ROUTE: string = `/api/global-config/${RESOLVED_RECORD_RETENTION_PROJECTS_REACHED_ROUTE}`;

interface HttpResult {
  status: number;
  body: JSONObject | null;
}

function request(port: number, query: string): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const outgoing: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          path: `${ROUTE}${query}`,
          method: "GET",
          headers: { "content-type": "application/json" },
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            const raw: string = Buffer.concat(chunks).toString("utf8");
            let body: JSONObject | null = null;

            try {
              body = raw ? (JSON.parse(raw) as JSONObject) : null;
            } catch {
              body = null;
            }

            resolve({ status: response.statusCode || 0, body });
          });
        },
      );

      outgoing.on("error", reject);
      outgoing.end();
    },
  );
}

function session(isMasterAdmin: boolean): JSONWebTokenData {
  return {
    userId: ObjectID.generate(),
    email: new Email("admin@example.com"),
    isMasterAdmin: isMasterAdmin,
    isGlobalLogin: true,
  } as JSONWebTokenData;
}

describe("how many projects a server maximum reaches, over HTTP", () => {
  let server: http.Server;
  let port: number;
  let countSpy: jest.SpyInstance;

  beforeAll(async () => {
    const app: express.Express = express();
    app.use(express.json());
    const router: ExpressRouter = express.Router();
    router.use(new GlobalConfigAPI().getRouter());
    app.use("/api", router);
    app.use(expressErrorHandler);

    server = http.createServer(app);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  beforeEach(() => {
    countSpy = jest
      .spyOn(ResolvedRecordRetention, "countProjectsReachedByMaximum")
      .mockResolvedValue(12);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is the route the Admin Dashboard asks", () => {
    expect(ROUTE).toBe(
      "/api/global-config/resolved-record-retention/projects-reached",
    );
  });

  test("a request with no session is refused, and counts nothing", async () => {
    jest
      .spyOn(UserMiddleware, "readRequestSession")
      .mockResolvedValue({ kind: "none" });

    const result: HttpResult = await request(
      port,
      "?kind=Incident&maximumInDays=365",
    );

    expect(result.status).toBe(401);
    expect(countSpy).not.toHaveBeenCalled();
  });

  test("a signed-in person who is not a master admin is refused, and counts nothing", async () => {
    jest
      .spyOn(UserMiddleware, "readRequestSession")
      .mockResolvedValue({ kind: "user", session: session(false) });

    const result: HttpResult = await request(
      port,
      "?kind=Incident&maximumInDays=365",
    );

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
    expect(countSpy).not.toHaveBeenCalled();
  });

  describe("for a master admin", () => {
    beforeEach(() => {
      jest
        .spyOn(UserMiddleware, "readRequestSession")
        .mockResolvedValue({ kind: "user", session: session(true) });
    });

    test("answers how many projects the maximum reaches, for the kind asked", async () => {
      const result: HttpResult = await request(
        port,
        "?kind=Alert&maximumInDays=90",
      );

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ count: 12 });
      expect(countSpy).toHaveBeenCalledWith({
        kind: ResolvedRecordKind.Alert,
        maximumInDays: 90,
      });
    });

    test.each([
      "",
      "?kind=Incident",
      "?maximumInDays=365",
      "?kind=Monitor&maximumInDays=365",
      "?kind=Incident&maximumInDays=45",
      "?kind=Incident&maximumInDays=0",
    ])(
      "a question that is not one (%s) is refused, counting nothing",
      async (query: string) => {
        const result: HttpResult = await request(port, query);

        expect(result.status).toBe(400);
        expect(countSpy).not.toHaveBeenCalled();
      },
    );
  });
});
