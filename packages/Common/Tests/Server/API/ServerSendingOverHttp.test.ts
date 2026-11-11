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
 * Master admins are named by the request's x-test-master-admin header: the
 * session itself is the middleware's business, tested on its own. Anybody
 * else is refused as the real one refuses them.
 */
jest.mock("../../../Server/Middleware/MasterAdminAuthorization", () => {
  const NotAuthorizedExceptionType: new (message: string) => Error = (
    jest.requireActual("../../../Types/Exception/NotAuthorizedException") as {
      default: new (message: string) => Error;
    }
  ).default;
  const ResponseType: {
    sendErrorResponse: (req: unknown, res: unknown, err: Error) => void;
  } = (
    jest.requireActual("../../../Server/Utils/Response") as {
      default: {
        sendErrorResponse: (req: unknown, res: unknown, err: Error) => void;
      };
    }
  ).default;

  return {
    __esModule: true,
    default: {
      isAuthorizedMasterAdminMiddleware: (
        req: { headers: Record<string, unknown> },
        res: unknown,
        next: () => void,
      ): void => {
        if (req.headers["x-test-master-admin"] === "true") {
          next();
          return;
        }

        ResponseType.sendErrorResponse(
          req,
          res,
          new NotAuthorizedExceptionType(
            "You do not have permission to access this resource.",
          ),
        );
      },
    },
  };
});

import GlobalConfigAPI from "../../../Server/API/GlobalConfigAPI";
import TeamMemberAPI from "../../../Server/API/TeamMemberAPI";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProbeService from "../../../Server/Services/ProbeService";
import InvitationLink from "../../../Server/Utils/InvitationLink";
import { ExpressRouter } from "../../../Server/Utils/Express";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import GlobalConfig, {
  EmailServerType,
} from "../../../Models/DatabaseModels/GlobalConfig";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import ServerSendingStatusUtil, {
  ServerSendingChannel,
  ServerSendingState,
  ServerSendingStatusAnswer,
} from "../../../Types/ServerSending/ServerSendingStatus";
import {
  afterAll,
  afterEach,
  beforeAll,
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
 * CAN THIS SERVER SEND, AS THE BROWSER HEARS IT (#6825).
 *
 *   - GET /global-config/vars, which anybody reads before signing in, says
 *     canSendEmail - a yes or no only: false while email is not set up, or
 *     set up and never worked; true once it has worked, even while it fails.
 *     Never an address, a host, a key or why a send failed;
 *   - GET /global-config/sending-status says all of that, and the global
 *     probes, to master admins only;
 *   - POST /team-member/invitation-link hands the link an invitation email
 *     carries to master admins only: it claims the account at that address.
 */

const SECRET: string = "should-never-leave";

interface HttpResult {
  status: number;
  body: JSONObject | null;
}

function send(data: {
  port: number;
  method: "GET" | "POST";
  path: string;
  body?: JSONObject | undefined;
  isMasterAdmin?: boolean | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string =
        data.method === "POST" ? JSON.stringify(data.body || {}) : "";
      const headers: Record<string, string | number> = {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      };

      if (data.isMasterAdmin) {
        headers["x-test-master-admin"] = "true";
      }

      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: data.path,
          method: data.method,
          headers: headers,
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

      request.on("error", reject);

      if (payload) {
        request.write(payload);
      }

      request.end();
    },
  );
}

const EMAIL_SET_UP: Record<string, unknown> = {
  emailServerType: EmailServerType.CustomSMTP,
  smtpHost: `${SECRET}.example.com`,
  smtpPort: 587,
  smtpUsername: SECRET,
  smtpPassword: SECRET,
  smtpFromEmail: `${SECRET}@example.com`,
  smtpFromName: "OneUptime",
};

function remembered(data: {
  hasWorked: boolean;
  isFailing: boolean;
}): Record<string, unknown> {
  return {
    email: {
      lastSucceededAt: data.hasWorked ? "2026-11-10T10:00:00.000Z" : null,
      lastFailedAt: data.isFailing ? "2026-11-11T10:00:00.000Z" : null,
      failingSince: data.isFailing ? "2026-11-11T09:00:00.000Z" : null,
      lastFailure: data.isFailing ? `535 ${SECRET} rejected` : null,
    },
  };
}

let server: http.Server;
let port: number;

beforeAll(async () => {
  const app: express.Express = express();
  app.use(express.json());
  const router: ExpressRouter = express.Router();
  router.use(new GlobalConfigAPI().getRouter());
  router.use(new TeamMemberAPI().getRouter());
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

afterEach(() => {
  jest.restoreAllMocks();
});

function answerWith(row: Record<string, unknown> | null): void {
  jest
    .spyOn(GlobalConfigService, "findOneById")
    .mockResolvedValue(row as unknown as GlobalConfig);
}

describe("GET /global-config/vars: canSendEmail", () => {
  test.each([
    ["a fresh server, nothing set up", {}, false],
    ["email set up, nothing sent yet", EMAIL_SET_UP, true],
    [
      "email set up, the last send went out",
      {
        ...EMAIL_SET_UP,
        serverSendingHealth: remembered({ hasWorked: true, isFailing: false }),
      },
      true,
    ],
    [
      "email set up and never worked: it cannot send yet",
      {
        ...EMAIL_SET_UP,
        serverSendingHealth: remembered({ hasWorked: false, isFailing: true }),
      },
      false,
    ],
    [
      "email worked once and fails now: told to master admins only",
      {
        ...EMAIL_SET_UP,
        serverSendingHealth: remembered({ hasWorked: true, isFailing: true }),
      },
      true,
    ],
  ])("%s: %p", async (_name: string, row: Record<string, unknown>, expected: boolean) => {
    answerWith(row);

    const result: HttpResult = await send({
      port: port,
      method: "GET",
      path: "/api/global-config/vars",
    });

    expect(result.status).toBe(200);
    expect(result.body?.["canSendEmail"]).toBe(expected);
  });

  test("anybody is answered, and told nothing of the settings or of why a send failed", async () => {
    answerWith({
      ...EMAIL_SET_UP,
      serverSendingHealth: remembered({ hasWorked: true, isFailing: true }),
    });

    const result: HttpResult = await send({
      port: port,
      method: "GET",
      path: "/api/global-config/vars",
    });

    expect(result.status).toBe(200);
    expect(JSON.stringify(result.body)).not.toContain(SECRET);
    expect(JSON.stringify(result.body)).not.toContain("2026-11");
  });
});

describe("GET /global-config/sending-status", () => {
  test("is refused to anybody but a master admin", async () => {
    const read: jest.SpyInstance = jest.spyOn(
      GlobalConfigService,
      "findOneById",
    );

    const result: HttpResult = await send({
      port: port,
      method: "GET",
      path: "/api/global-config/sending-status",
    });

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(result.body)).not.toContain("channels");
    expect(read).not.toHaveBeenCalled();
  });

  test("tells a master admin every channel, since when email fails and why, and the probes", async () => {
    answerWith({
      ...EMAIL_SET_UP,
      serverSendingHealth: remembered({ hasWorked: true, isFailing: true }),
    });

    jest
      .spyOn(ProbeService, "countBy")
      .mockResolvedValueOnce(new PositiveNumber(1))
      .mockResolvedValueOnce(new PositiveNumber(0));

    const result: HttpResult = await send({
      port: port,
      method: "GET",
      path: "/api/global-config/sending-status",
      isMasterAdmin: true,
    });

    expect(result.status).toBe(200);

    const answer: ServerSendingStatusAnswer | null =
      ServerSendingStatusUtil.parseAnswer(result.body);

    expect(answer).not.toBeNull();
    expect(
      ServerSendingStatusUtil.getChannel(answer!, ServerSendingChannel.Email),
    ).toMatchObject({
      state: ServerSendingState.Failing,
      hasWorked: true,
      failingSince: "2026-11-11T09:00:00.000Z",
      lastFailure: `535 ${SECRET} rejected`,
    });
    expect(
      ServerSendingStatusUtil.getChannel(answer!, ServerSendingChannel.SMS)
        ?.state,
    ).toBe(ServerSendingState.NotSetUp);
    expect(answer!.globalProbes).toEqual({ total: 1, reporting: 0 });

    // What the server remembers, never its settings: no password, no username.
    expect(JSON.stringify(result.body)).not.toContain(`"${SECRET}"`);
  });
});

describe("POST /team-member/invitation-link", () => {
  const TEAM_MEMBER_ID: ObjectID = ObjectID.generate();

  test("is refused to anybody but a master admin, and mints nothing", async () => {
    const getLink: jest.SpyInstance = jest.spyOn(
      InvitationLink,
      "getForTeamMember",
    );

    const result: HttpResult = await send({
      port: port,
      method: "POST",
      path: "/api/team-member/invitation-link",
      body: { teamMemberId: TEAM_MEMBER_ID.toString() },
    });

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(result.body)).not.toContain("token");
    expect(getLink).not.toHaveBeenCalled();
  });

  test("hands a master admin the invitation's link", async () => {
    const getLink: jest.SpyInstance = jest
      .spyOn(InvitationLink, "getForTeamMember")
      .mockResolvedValue({
        link: "https://oneuptime.example.com/accounts/register?email=a%40example.com&token=t",
        isRegistered: false,
        email: "a@example.com",
      });

    const result: HttpResult = await send({
      port: port,
      method: "POST",
      path: "/api/team-member/invitation-link",
      body: { teamMemberId: TEAM_MEMBER_ID.toString() },
      isMasterAdmin: true,
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      link: "https://oneuptime.example.com/accounts/register?email=a%40example.com&token=t",
      isRegistered: false,
      email: "a@example.com",
    });
    expect((getLink.mock.calls[0]![0] as ObjectID).toString()).toBe(
      TEAM_MEMBER_ID.toString(),
    );
  });

  test.each([[{}], [{ teamMemberId: "not-an-id" }], [{ teamMemberId: 7 }]])(
    "a body of %j is refused before anything is read",
    async (body: JSONObject) => {
      const getLink: jest.SpyInstance = jest.spyOn(
        InvitationLink,
        "getForTeamMember",
      );

      const result: HttpResult = await send({
        port: port,
        method: "POST",
        path: "/api/team-member/invitation-link",
        body: body,
        isMasterAdmin: true,
      });

      expect(result.status).toBe(400);
      expect(getLink).not.toHaveBeenCalled();
    },
  );
});
