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

/*
 * PasswordHash carries a TS diagnostic that fails any suite whose require
 * graph reaches it (see HostServiceUpdateLastSeen.test.ts): replaced with a
 * factory, as there.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import HostLogSessionAPI, {
  NOT_A_SESSION_ID_MESSAGE,
} from "../../../Server/API/HostLogSessionAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ProjectService from "../../../Server/Services/ProjectService";
import HostLogSessionLines, {
  SESSION_NOT_FOUND_MESSAGE,
} from "../../../Server/Utils/Host/HostLogSessionLines";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { getHostLogSessionLinesRoute } from "../../../Types/Host/HostLogSession";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { HostLogSessionFile } from "../../../Utils/Host/HostLogSessionFile";
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
 * GET /host-log-session/:id/lines (#9966): a log session's lines as a file,
 * read with the caller's own props - so with their permissions, as viewing
 * them is - and answered as its name, its text and how much it holds. A
 * refusal answers no lines.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SESSION_ID: string = "6f1c2d0e-5a4b-4c3d-9e8f-0a1b2c3d4e5f";

const FILE: HostLogSessionFile = {
  fileName: "store-0412-kiosk-02-log-session-2026-11-19-14-02.txt",
  content:
    "--------- OneUptime log session\n11-19 14:03:07.123   580  1029 I ActivityManager: Start proc\n",
  lineCount: 1,
  isTruncated: false,
};

interface HttpResult {
  status: number;
  body: JSONObject | null;
}

function get(port: number, path: string): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      http
        .get(
          { host: "127.0.0.1", port: port, path: path },
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

              resolve({ status: response.statusCode || 0, body });
            });
          },
        )
        .on("error", reject);
    },
  );
}

describe("a log session's lines, over HTTP", () => {
  let server: http.Server;
  let port: number;
  let getFile: jest.SpyInstance;
  let signedInUserId: ObjectID;

  beforeAll(async () => {
    // The caller, as the user middleware leaves a signed-in member.
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

    // The project's plan, which every member's request reads where billing is on.
    jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: false,
    });

    const app: express.Express = express();
    app.use(express.json());
    const router: ExpressRouter = express.Router();
    router.use(new HostLogSessionAPI().getRouter());
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
    getFile = jest
      .spyOn(HostLogSessionLines, "getFile")
      .mockImplementation(async (): Promise<HostLogSessionFile> => {
        return FILE;
      });
  });

  afterEach(() => {
    getFile.mockRestore();
  });

  test("is the route the Dashboard calls", () => {
    expect(getHostLogSessionLinesRoute(SESSION_ID)).toBe(
      `/host-log-session/${SESSION_ID}/lines`,
    );
  });

  test("answers the session's file, read with the caller's own props", async () => {
    const result: HttpResult = await get(
      port,
      `/api${getHostLogSessionLinesRoute(SESSION_ID)}`,
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      fileName: FILE.fileName,
      content: FILE.content,
      lineCount: 1,
      isTruncated: false,
    });

    expect(getFile).toHaveBeenCalledTimes(1);
    const asked: {
      sessionId: ObjectID;
      props: DatabaseCommonInteractionProps;
    } = getFile.mock.calls[0]![0] as never;
    expect(asked.sessionId.toString()).toBe(SESSION_ID);
    expect(asked.props.tenantId?.toString()).toBe(PROJECT_ID.toString());
    expect(asked.props.userId?.toString()).toBe(signedInUserId.toString());
    expect(asked.props.isRoot).toBeFalsy();
  });

  test("a path that names no session is refused, saying where to download the lines, and nothing is read", async () => {
    const result: HttpResult = await get(
      port,
      `/api/host-log-session/not-a-session/lines`,
    );

    expect(result.status).toBe(400);
    expect(JSON.stringify(result.body)).toContain(NOT_A_SESSION_ID_MESSAGE);
    expect(getFile).not.toHaveBeenCalled();
  });

  test("a session the caller cannot see is not found, with no lines", async () => {
    getFile.mockImplementation(async (): Promise<HostLogSessionFile> => {
      throw new NotFoundException(SESSION_NOT_FOUND_MESSAGE);
    });

    const result: HttpResult = await get(
      port,
      `/api${getHostLogSessionLinesRoute(SESSION_ID)}`,
    );

    expect(result.status).toBe(404);
    expect(JSON.stringify(result.body)).toContain(SESSION_NOT_FOUND_MESSAGE);
    expect(JSON.stringify(result.body)).not.toContain("ActivityManager");
  });

  test("a caller who may not read logs is refused, with no lines", async () => {
    getFile.mockImplementation(async (): Promise<HostLogSessionFile> => {
      throw new NotAuthorizedException(
        "You do not have permission to read Logs.",
      );
    });

    const result: HttpResult = await get(
      port,
      `/api${getHostLogSessionLinesRoute(SESSION_ID)}`,
    );

    // Refused as every refusal of a permission is (the error handler's status for it), saying why.
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
    expect(JSON.stringify(result.body)).toContain(
      "You do not have permission to read Logs.",
    );
    expect(JSON.stringify(result.body)).not.toContain("ActivityManager");
  });
});
