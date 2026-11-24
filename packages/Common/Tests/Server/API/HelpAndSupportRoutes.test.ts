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

jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  const actual: { default: Record<string, unknown> } = jest.requireActual(
    "../../../Server/Middleware/UserAuthorization",
  ) as { default: Record<string, unknown> };

  const ObjectIdType: new (id: string) => unknown = (
    jest.requireActual("../../../Types/ObjectID") as {
      default: new (id: string) => unknown;
    }
  ).default;

  /*
   * The signed-in person, named by the request's x-test-user-id header: the
   * session itself is the middleware's business, tested on its own.
   */
  actual.default["getUserMiddleware"] = (
    req: { headers: Record<string, unknown>; userAuthorization?: unknown },
    _res: unknown,
    next: () => void,
  ): void => {
    const userId: unknown = req.headers["x-test-user-id"];

    if (typeof userId === "string" && userId) {
      req.userAuthorization = {
        userId: new ObjectIdType(userId),
        isMasterAdmin: false,
      };
    }

    next();
  };

  return actual;
});

import GlobalConfigAPI from "../../../Server/API/GlobalConfigAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import HelpAndSupportServerSettings from "../../../Server/Utils/HelpAndSupport/HelpAndSupportServerSettings";
import { ExpressRouter } from "../../../Server/Utils/Express";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import Email from "../../../Types/Email";
import {
  HELP_AND_SUPPORT_LINKS_ROUTE,
  HELP_AND_SUPPORT_SETTINGS_ROUTE,
  HelpAndSupportProblems,
  HelpAndSupportSettings,
  HelpChoice,
  HelpItem,
  getDefaultHelpAndSupportSettings,
} from "../../../Types/HelpAndSupport/HelpAndSupport";
import {
  HelpAndSupportAnswer,
  parseHelpAndSupportAnswer,
} from "../../../Types/HelpAndSupport/HelpAndSupportAnswer";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
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
 * WHERE THE SERVER SENDS ITS PEOPLE FOR HELP, OVER HTTP (#10864-#10866).
 *
 *   - GET /global-config/help-and-support: the settings page's answer, for
 *     a master admin, read fresh, never cached.
 *   - POST /global-config/help-and-support: one place changed, for a signed-
 *     in master admin only. Every value is checked here whatever the page
 *     checked: a javascript: link, an address with a name, HTML in the
 *     message - each is refused with why, and nothing is saved.
 *   - GET /global-config/help-and-support/links: the links a signed-in
 *     person sees, a chat invitation among them; nobody else gets them.
 */

interface HttpResult {
  status: number;
  raw: string;
  body: JSONObject | null;
  cacheControl: string | undefined;
}

function request(data: {
  port: number;
  path: string;
  method: "GET" | "POST";
  body?: JSONObject | undefined;
  userId?: string | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };

      if (data.userId) {
        headers["x-test-user-id"] = data.userId;
      }

      const outgoing: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: `/api${data.path}`,
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

      if (data.method === "POST") {
        outgoing.write(JSON.stringify(data.body || {}));
      }

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

describe("help and support, over HTTP", () => {
  let server: http.Server;
  let port: number;
  let stored: HelpAndSupportSettings;
  let save: ReturnType<typeof jest.spyOn>;

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
    stored = getDefaultHelpAndSupportSettings();
    stored[HelpItem.Chat] = {
      choice: HelpChoice.Link,
      value: "https://join.slack.com/t/acme/shared_invite/zt-secret",
    };
    stored[HelpItem.InviteMessage] = {
      choice: HelpChoice.Text,
      value: "Ask the IT service desk.",
    };

    jest
      .spyOn(HelpAndSupportServerSettings, "getSettings")
      .mockImplementation(async (): Promise<HelpAndSupportSettings> => {
        return stored;
      });

    save = jest
      .spyOn(HelpAndSupportServerSettings, "save")
      .mockImplementation(async (): Promise<HelpAndSupportSettings> => {
        return stored;
      });

    jest
      .spyOn(GlobalConfigService, "findOneById")
      .mockImplementation(async (): Promise<GlobalConfig> => {
        const config: GlobalConfig = new GlobalConfig();
        config.helpAndSupport = {
          chat: {
            choice: "link",
            value: "https://join.slack.com/t/acme/shared_invite/zt-secret",
          },
        };
        config.adminNotificationEmail = new Email("admins@example.com");
        return config;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function signedInAs(isMasterAdmin: boolean | null): void {
    jest
      .spyOn(UserMiddleware, "readRequestSession")
      .mockResolvedValue(
        isMasterAdmin === null
          ? { kind: "none" }
          : { kind: "user", session: session(isMasterAdmin) },
      );
  }

  describe("the settings page's answer", () => {
    test("a master admin reads every place, with what its defaults do, never cached", async () => {
      signedInAs(true);

      const result: HttpResult = await request({
        port,
        path: HELP_AND_SUPPORT_SETTINGS_ROUTE,
        method: "GET",
      });

      expect(result.status).toBe(200);
      expect(result.cacheControl).toContain("no-store");

      const answer: HelpAndSupportAnswer | null = parseHelpAndSupportAnswer(
        result.body,
      );

      expect(answer?.settings[HelpItem.Chat]).toEqual({
        choice: HelpChoice.Link,
        value: "https://join.slack.com/t/acme/shared_invite/zt-secret",
      });
      expect(answer?.adminNotificationEmail).toBe("admins@example.com");
      expect(answer?.isOneUptimeCloud).toBe(false);
      expect(typeof answer?.canSendEmail).toBe("boolean");
      expect(answer?.isProductRenamed).toBe(false);
    });

    test("someone who is not a master admin is refused, and told nothing", async () => {
      signedInAs(false);

      const result: HttpResult = await request({
        port,
        path: HELP_AND_SUPPORT_SETTINGS_ROUTE,
        method: "GET",
      });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.status).toBeLessThan(500);
      expect(result.raw).not.toContain("zt-secret");
    });
  });

  describe("changing one place", () => {
    test("a master admin saves an address of the server's own, kept as the rules keep it", async () => {
      signedInAs(true);

      const result: HttpResult = await request({
        port,
        path: HELP_AND_SUPPORT_SETTINGS_ROUTE,
        method: "POST",
        body: {
          item: "supportEmail",
          choice: "email",
          value: " IT-Help@Example.com ",
        },
      });

      expect(result.status).toBe(200);
      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0]![0]).toEqual({
        item: HelpItem.SupportEmail,
        setting: { choice: HelpChoice.Email, value: "it-help@example.com" },
      });
      expect(parseHelpAndSupportAnswer(result.body)).not.toBeNull();
    });

    test.each([
      [
        "a javascript: chat link",
        {
          item: "chat",
          choice: "link",
          value: "javascript:alert(document.cookie)",
        },
        HelpAndSupportProblems.linkScheme,
      ],
      [
        "a data: help page",
        { item: "helpLink", choice: "link", value: "data:text/html,hi" },
        HelpAndSupportProblems.linkScheme,
      ],
      [
        "an address with a name",
        {
          item: "supportEmail",
          choice: "email",
          value: "Alice <a@example.com>",
        },
        HelpAndSupportProblems.emailInvalid,
      ],
      [
        "HTML in the sign-in message",
        {
          item: "inviteMessage",
          choice: "text",
          value: "<script>alert(1)</script>",
        },
        HelpAndSupportProblems.textHtml,
      ],
      [
        "a link for Request Demo, which takes none",
        {
          item: "requestDemo",
          choice: "link",
          value: "https://demo.example.com",
        },
        HelpAndSupportProblems.unknownChoice,
      ],
      [
        "a place that does not exist",
        { item: "footer", choice: "hidden" },
        HelpAndSupportProblems.unknownItem,
      ],
    ])(
      "%s is refused with why, and nothing is saved",
      async (_why: string, body: JSONObject, message: string) => {
        signedInAs(true);

        const result: HttpResult = await request({
          port,
          path: HELP_AND_SUPPORT_SETTINGS_ROUTE,
          method: "POST",
          body: body,
        });

        expect(result.status).toBe(400);
        expect(result.raw).toContain(message);
        expect(save).not.toHaveBeenCalled();
      },
    );

    test("someone who is not a master admin is refused, and nothing is saved", async () => {
      signedInAs(false);

      const result: HttpResult = await request({
        port,
        path: HELP_AND_SUPPORT_SETTINGS_ROUTE,
        method: "POST",
        body: { item: "gitHub", choice: "hidden" },
      });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.status).toBeLessThan(500);
      expect(save).not.toHaveBeenCalled();
    });

    test("a request with no session is refused, and nothing is saved", async () => {
      signedInAs(null);

      const result: HttpResult = await request({
        port,
        path: HELP_AND_SUPPORT_SETTINGS_ROUTE,
        method: "POST",
        body: { item: "gitHub", choice: "hidden" },
      });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe("the links a signed-in person sees", () => {
    test("a signed-in person reads the places env.js carries, with their links", async () => {
      const result: HttpResult = await request({
        port,
        path: HELP_AND_SUPPORT_LINKS_ROUTE,
        method: "GET",
        userId: ObjectID.generate().toString(),
      });

      expect(result.status).toBe(200);
      expect(result.cacheControl).toContain("no-store");
      expect(result.body).toEqual({
        chat: {
          choice: "link",
          value: "https://join.slack.com/t/acme/shared_invite/zt-secret",
        },
      });
      // The sign-in message is the server's to show, not a link of this answer.
      expect(result.raw).not.toContain("Ask the IT service desk.");
    });

    test("nobody signed in reads them", async () => {
      const result: HttpResult = await request({
        port,
        path: HELP_AND_SUPPORT_LINKS_ROUTE,
        method: "GET",
      });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.status).toBeLessThan(500);
      expect(result.raw).not.toContain("zt-secret");
    });

    test("every place on its default reads as nothing to change", async () => {
      stored = getDefaultHelpAndSupportSettings();

      const result: HttpResult = await request({
        port,
        path: HELP_AND_SUPPORT_LINKS_ROUTE,
        method: "GET",
        userId: ObjectID.generate().toString(),
      });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({});
    });
  });
});
