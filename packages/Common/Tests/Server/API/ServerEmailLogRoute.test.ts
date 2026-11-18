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
import ProjectService from "../../../Server/Services/ProjectService";
import ServerEmailLogService from "../../../Server/Services/ServerEmailLogService";
import { ExpressRouter } from "../../../Server/Utils/Express";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Project from "../../../Models/DatabaseModels/Project";
import ServerEmailLog from "../../../Models/DatabaseModels/ServerEmailLog";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Email from "../../../Types/Email";
import ServerEmailLogUtil, {
  SERVER_EMAIL_LOG_PAGE_SIZE,
  SERVER_EMAIL_LOG_RETENTION_IN_DAYS,
  SERVER_EMAIL_LOG_ROUTE,
  ServerEmailLogAnswer,
  ServerEmailLogStatus,
} from "../../../Types/Email/ServerEmailLog";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import MailStatus from "../../../Types/Mail/MailStatus";
import ObjectID from "../../../Types/ObjectID";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
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
 * THE SERVER'S EMAIL LOG, OVER HTTP (#6878).
 *
 * GET /global-config/email-log answers one page of the log, newest first -
 * every email, or the failed ones only - with the name of each email's
 * project while it exists. Master admins only: anyone else, signed in to a
 * project or not, is refused before a row is read, and reads no address.
 * The answer is never cached. No project can read a row: the table grants
 * no read to anyone, and has no API of its own.
 */

interface HttpResult {
  status: number;
  raw: string;
  body: JSONObject | null;
  cacheControl: string | undefined;
}

function request(data: { port: number; path: string }): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const outgoing: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: `/api${data.path}`,
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

            resolve({
              status: response.statusCode || 0,
              raw,
              body,
              cacheControl: response.headers["cache-control"] as
                | string
                | undefined,
            });
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
    email: new Email("someone@example.com"),
    isMasterAdmin: isMasterAdmin,
    isGlobalLogin: true,
  } as JSONWebTokenData;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "68780000-0000-4000-8000-000000000011",
);
const GONE_PROJECT_ID: ObjectID = new ObjectID(
  "68780000-0000-4000-8000-000000000012",
);

function row(data: {
  id: string;
  to: string;
  status: MailStatus;
  subject?: string;
  templateType?: string;
  statusMessage?: string;
  projectId?: ObjectID;
  at: string;
}): ServerEmailLog {
  const log: ServerEmailLog = new ServerEmailLog();

  log._id = data.id;
  log.createdAt = new Date(data.at);
  log.toEmail = new Email(data.to);
  log.status = data.status;

  if (data.subject) {
    log.subject = data.subject;
  }

  if (data.templateType) {
    log.templateType = data.templateType;
  }

  if (data.statusMessage) {
    log.statusMessage = data.statusMessage;
  }

  if (data.projectId) {
    log.projectId = data.projectId;
  }

  return log;
}

const ROWS: Array<ServerEmailLog> = [
  row({
    id: "68780000-0000-4000-8000-0000000000a1",
    to: "alice@example.test",
    status: MailStatus.Success,
    subject: "Password Reset Request for OneUptime",
    templateType: "ForgotPassword.hbs",
    statusMessage: "Email sent.",
    at: "2026-11-17T10:00:00.000Z",
  }),
  row({
    id: "68780000-0000-4000-8000-0000000000a2",
    to: "bob@example.test",
    status: MailStatus.Error,
    templateType: "IncidentCreated.hbs",
    statusMessage: "535 5.7.8 Authentication failed",
    projectId: PROJECT_ID,
    at: "2026-11-17T09:00:00.000Z",
  }),
  row({
    id: "68780000-0000-4000-8000-0000000000a3",
    to: "carol@example.test",
    status: MailStatus.Error,
    templateType: "AlertCreated.hbs",
    statusMessage: "421 Try again later",
    projectId: GONE_PROJECT_ID,
    at: "2026-11-17T08:00:00.000Z",
  }),
];

describe("the server's email log, over HTTP", () => {
  let server: http.Server;
  let port: number;
  let findRows: ReturnType<typeof jest.spyOn>;
  let findProjects: ReturnType<typeof jest.spyOn>;

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
    findRows = jest
      .spyOn(ServerEmailLogService, "findBy")
      .mockResolvedValue(ROWS as never);

    const project: Project = new Project();
    project._id = PROJECT_ID.toString();
    project.name = "Checkout";

    findProjects = jest
      .spyOn(ProjectService, "findBy")
      .mockResolvedValue([project] as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function signedInAs(isMasterAdmin: boolean): void {
    jest
      .spyOn(UserMiddleware, "readRequestSession")
      .mockResolvedValue({ kind: "user", session: session(isMasterAdmin) });
  }

  test("is the route the Admin Dashboard asks", () => {
    expect(SERVER_EMAIL_LOG_ROUTE).toBe("/global-config/email-log");
  });

  describe("a master admin", () => {
    test("reads a page, newest first, with each email's project, and it is never cached", async () => {
      signedInAs(true);

      const result: HttpResult = await request({
        port,
        path: SERVER_EMAIL_LOG_ROUTE,
      });

      expect(result.status).toBe(200);
      expect(result.cacheControl).toContain("no-store");

      const answer: ServerEmailLogAnswer | null =
        ServerEmailLogUtil.parseAnswer(result.body);

      expect(answer).toEqual({
        entries: [
          {
            id: "68780000-0000-4000-8000-0000000000a1",
            at: "2026-11-17T10:00:00.000Z",
            toEmail: "alice@example.test",
            subject: "Password Reset Request for OneUptime",
            templateName: "ForgotPassword",
            status: ServerEmailLogStatus.Sent,
            statusMessage: "Email sent.",
            projectId: null,
            projectName: null,
          },
          {
            id: "68780000-0000-4000-8000-0000000000a2",
            at: "2026-11-17T09:00:00.000Z",
            toEmail: "bob@example.test",
            subject: null,
            templateName: "IncidentCreated",
            status: ServerEmailLogStatus.Failed,
            statusMessage: "535 5.7.8 Authentication failed",
            projectId: PROJECT_ID.toString(),
            projectName: "Checkout",
          },
          {
            id: "68780000-0000-4000-8000-0000000000a3",
            at: "2026-11-17T08:00:00.000Z",
            toEmail: "carol@example.test",
            subject: null,
            templateName: "AlertCreated",
            status: ServerEmailLogStatus.Failed,
            statusMessage: "421 Try again later",
            projectId: GONE_PROJECT_ID.toString(),
            projectName: null,
          },
        ],
        hasMore: false,
        retentionInDays: SERVER_EMAIL_LOG_RETENTION_IN_DAYS,
      });

      // One page and one more, newest first, read as root.
      expect(findRows).toHaveBeenCalledTimes(1);
      expect(findRows.mock.calls[0]![0]).toMatchObject({
        query: {},
        sort: { createdAt: SortOrder.Descending },
        skip: 0,
        limit: SERVER_EMAIL_LOG_PAGE_SIZE + 1,
        props: { isRoot: true },
      });

      // The names of the projects named, and only those.
      expect(findProjects).toHaveBeenCalledTimes(1);
      expect(
        JSON.stringify(
          (findProjects.mock.calls[0]![0] as { select: JSONObject }).select,
        ),
      ).toBe(JSON.stringify({ _id: true, name: true }));
    });

    test("the failed emails only, and the page after the first", async () => {
      signedInAs(true);

      await request({
        port,
        path: `${SERVER_EMAIL_LOG_ROUTE}?failedOnly=true&skip=25`,
      });

      expect(findRows.mock.calls[0]![0]).toMatchObject({
        query: { status: MailStatus.Error },
        skip: 25,
      });
    });

    test("a page more than full says there is more, and holds a page", async () => {
      signedInAs(true);

      findRows.mockResolvedValue(
        Array.from(Array(SERVER_EMAIL_LOG_PAGE_SIZE + 1).keys()).map(
          (index: number): ServerEmailLog => {
            return row({
              id: ObjectID.generate().toString(),
              to: `person${index}@example.test`,
              status: MailStatus.Success,
              at: "2026-11-17T10:00:00.000Z",
            });
          },
        ) as never,
      );

      const result: HttpResult = await request({
        port,
        path: SERVER_EMAIL_LOG_ROUTE,
      });

      const answer: ServerEmailLogAnswer | null =
        ServerEmailLogUtil.parseAnswer(result.body);

      expect(answer?.hasMore).toBe(true);
      expect(answer?.entries).toHaveLength(SERVER_EMAIL_LOG_PAGE_SIZE);
    });

    test("a query that is not a page reads the first page of every email", async () => {
      signedInAs(true);

      await request({
        port,
        path: `${SERVER_EMAIL_LOG_ROUTE}?failedOnly=yes&skip=-5`,
      });

      expect(findRows.mock.calls[0]![0]).toMatchObject({
        query: {},
        skip: 0,
      });
    });
  });

  describe("anyone else", () => {
    test("someone signed in who is not a master admin is refused, and reads no address", async () => {
      signedInAs(false);

      const result: HttpResult = await request({
        port,
        path: SERVER_EMAIL_LOG_ROUTE,
      });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.status).toBeLessThan(500);
      expect(result.raw).toContain(
        "Only master admins can perform this action.",
      );
      expect(result.raw).not.toContain("@example.test");
      expect(findRows).not.toHaveBeenCalled();
    });

    test("a request with no session is refused before a row is read", async () => {
      jest
        .spyOn(UserMiddleware, "readRequestSession")
        .mockResolvedValue({ kind: "none" });

      const result: HttpResult = await request({
        port,
        path: SERVER_EMAIL_LOG_ROUTE,
      });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.raw).not.toContain("@example.test");
      expect(findRows).not.toHaveBeenCalled();
    });
  });
});

describe("no project can read the log", () => {
  test("the table grants no read, write or delete to anyone", () => {
    const model: ServerEmailLog = new ServerEmailLog();

    expect(model.readRecordPermissions).toEqual([]);
    expect(model.createRecordPermissions).toEqual([]);
    expect(model.updateRecordPermissions).toEqual([]);
    expect(model.deleteRecordPermissions).toEqual([]);
  });

  test("nor does any of its columns", () => {
    const model: ServerEmailLog = new ServerEmailLog();

    for (const column of [
      "toEmail",
      "subject",
      "templateType",
      "status",
      "statusMessage",
      "projectId",
    ]) {
      expect(model.getColumnAccessControlFor(column)).toEqual({
        create: [],
        read: [],
        update: [],
      });
    }
  });

  test("it has no API of its own, and no tenant to read it by", () => {
    const model: ServerEmailLog = new ServerEmailLog();

    expect(model.getCrudApiPath()).toBeFalsy();
    expect(model.getTenantColumn()).toBeFalsy();
  });
});
