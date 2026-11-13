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
import { ExpressRouter } from "../../../Server/Utils/Express";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import { EmailServerType } from "../../../Models/DatabaseModels/GlobalConfig";
import Email from "../../../Types/Email";
import ServerEmailEnvironment, {
  SERVER_EMAIL_ENVIRONMENT_ROUTE,
  SERVER_EMAIL_ENVIRONMENT_VARIABLES,
  ServerEmailEnvironmentAnswer,
  ServerEmailEnvironmentVariable,
} from "../../../Types/Email/ServerEmailEnvironment";
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
 * GET /global-config/email-environment, over HTTP (#7738): whether the
 * GLOBAL_EMAIL_ environment variables set the server's email settings,
 * which Admin Dashboard > Settings > Emails shows in place of the saved
 * ones. A master admin's only, as the saved settings are; and never a
 * password or a key, to anyone - only whether each is set.
 */

const V: typeof ServerEmailEnvironmentVariable = ServerEmailEnvironmentVariable;

const ROUTE: string = `/api${SERVER_EMAIL_ENVIRONMENT_ROUTE}`;
const PASSWORD: string = "environment-smtp-password-sentinel-7738";
const CLIENT_SECRET: string = "environment-client-secret-sentinel-7738";
const SES_SECRET: string = "environment-ses-secret-sentinel-7738";

interface HttpResult {
  status: number;
  raw: string;
  body: JSONObject | null;
}

function request(data: {
  port: number;
  method?: "GET" | "POST" | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const outgoing: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: ROUTE,
          method: data.method || "GET",
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

            resolve({ status: response.statusCode || 0, raw, body });
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

const before: Record<string, string | undefined> = {};

function setEnvironment(
  values: Partial<Record<ServerEmailEnvironmentVariable, string | undefined>>,
): void {
  for (const [variable, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = value;
    }
  }
}

function expectNoSecret(raw: string): void {
  expect(raw).not.toContain(PASSWORD);
  expect(raw).not.toContain(CLIENT_SECRET);
  expect(raw).not.toContain(SES_SECRET);
}

describe("the server's email settings from environment variables, over HTTP", () => {
  let server: http.Server;
  let port: number;

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
    for (const variable of SERVER_EMAIL_ENVIRONMENT_VARIABLES) {
      before[variable] = process.env[variable];
      delete process.env[variable];
    }

    // A mail server with its password: what nobody but the server may read.
    setEnvironment({
      [V.ServerType]: "custom-smtp",
      [V.SmtpHost]: "smtp.example.com",
      [V.SmtpPort]: "587",
      [V.SmtpUsername]: "mailer",
      [V.SmtpPassword]: PASSWORD,
      [V.FromEmail]: "alerts@example.com",
      [V.FromName]: "Alerts",
    });
  });

  afterEach(() => {
    for (const variable of SERVER_EMAIL_ENVIRONMENT_VARIABLES) {
      if (before[variable] === undefined) {
        delete process.env[variable];
      } else {
        process.env[variable] = before[variable];
      }
    }

    jest.restoreAllMocks();
  });

  test("is the route the Admin Dashboard asks", () => {
    expect(ROUTE).toBe("/api/global-config/email-environment");
  });

  test("a request with no session is refused, and told nothing", async () => {
    jest
      .spyOn(UserMiddleware, "readRequestSession")
      .mockResolvedValue({ kind: "none" });

    const result: HttpResult = await request({ port: port });

    expect(result.status).toBe(401);
    expectNoSecret(result.raw);
    expect(result.raw).not.toContain("smtp.example.com");
    expect(result.raw).not.toContain("mailer");
  });

  test("a session that cannot be read is refused", async () => {
    jest
      .spyOn(UserMiddleware, "readRequestSession")
      .mockResolvedValue({ kind: "invalid", error: new Error("expired") });

    const result: HttpResult = await request({ port: port });

    expect(result.status).toBe(401);
  });

  test("a signed-in person who is not a master admin is refused, and told nothing", async () => {
    jest
      .spyOn(UserMiddleware, "readRequestSession")
      .mockResolvedValue({ kind: "user", session: session(false) });

    const result: HttpResult = await request({ port: port });

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
    expect(result.raw).toContain("Only master admins can perform this action.");
    expectNoSecret(result.raw);
    expect(result.raw).not.toContain("smtp.example.com");
  });

  test("a blocked master admin is refused", async () => {
    jest
      .spyOn(UserMiddleware, "readRequestSession")
      .mockResolvedValue({ kind: "blocked", session: session(true) });

    const result: HttpResult = await request({ port: port });

    expect(result.status).toBe(401);
  });

  describe("for a master admin", () => {
    beforeEach(() => {
      jest
        .spyOn(UserMiddleware, "readRequestSession")
        .mockResolvedValue({ kind: "user", session: session(true) });
    });

    test("set: the settings the variables set, without the password", async () => {
      const result: HttpResult = await request({ port: port });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        isSetByEnvironment: true,
        serverType: EmailServerType.CustomSMTP,
        fields: [
          {
            variable: V.ServerType,
            value: "custom-smtp",
            isSecret: false,
            isSet: true,
          },
          {
            variable: V.SmtpTransport,
            value: null,
            isSecret: false,
            isSet: false,
          },
          {
            variable: V.SmtpHost,
            value: "smtp.example.com",
            isSecret: false,
            isSet: true,
          },
          { variable: V.SmtpPort, value: "587", isSecret: false, isSet: true },
          {
            variable: V.SmtpRequireTls,
            value: null,
            isSecret: false,
            isSet: false,
          },
          {
            variable: V.SmtpAuthType,
            value: null,
            isSecret: false,
            isSet: false,
          },
          {
            variable: V.SmtpUsername,
            value: "mailer",
            isSecret: false,
            isSet: true,
          },
          {
            variable: V.SmtpPassword,
            value: null,
            isSecret: true,
            isSet: true,
          },
          {
            variable: V.FromEmail,
            value: "alerts@example.com",
            isSecret: false,
            isSet: true,
          },
          {
            variable: V.FromName,
            value: "Alerts",
            isSecret: false,
            isSet: true,
          },
        ],
        problems: [],
        ignored: [],
      });
      expectNoSecret(result.raw);
    });

    test("what the Admin Dashboard reads back is what was sent", async () => {
      const result: HttpResult = await request({ port: port });

      const answer: ServerEmailEnvironmentAnswer =
        ServerEmailEnvironment.answerFromJSON(result.body);

      expect(answer).toEqual(result.body);
    });

    test("Microsoft Graph: the OAuth app without its client secret", async () => {
      setEnvironment({
        [V.SmtpTransport]: "microsoft-graph",
        [V.SmtpHost]: undefined,
        [V.SmtpPort]: undefined,
        [V.SmtpUsername]: undefined,
        [V.SmtpPassword]: undefined,
        [V.SmtpOAuthClientId]: "client-id",
        [V.SmtpOAuthClientSecret]: CLIENT_SECRET,
        [V.SmtpOAuthTokenUrl]:
          "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
        [V.SmtpOAuthScope]: "https://graph.microsoft.com/.default",
      });

      const result: HttpResult = await request({ port: port });

      expect(result.status).toBe(200);
      expect(result.body?.["problems"]).toEqual([]);
      expect(
        (result.body?.["fields"] as Array<JSONObject>).map(
          (field: JSONObject) => {
            return [field["variable"], field["value"]];
          },
        ),
      ).toEqual([
        [V.ServerType, "custom-smtp"],
        [V.SmtpTransport, "microsoft-graph"],
        [V.SmtpOAuthClientId, "client-id"],
        [V.SmtpOAuthClientSecret, null],
        [
          V.SmtpOAuthTokenUrl,
          "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
        ],
        [V.SmtpOAuthScope, "https://graph.microsoft.com/.default"],
        [V.FromEmail, "alerts@example.com"],
        [V.FromName, "Alerts"],
      ]);
      expectNoSecret(result.raw);
    });

    test("Amazon SES with access keys: the key ID, never the secret", async () => {
      setEnvironment({
        [V.ServerType]: "amazon-ses",
        [V.SmtpHost]: undefined,
        [V.SmtpPort]: undefined,
        [V.SmtpUsername]: undefined,
        [V.SmtpPassword]: undefined,
        [V.AmazonSesAccessKeyId]: "AKIAEXAMPLE",
        [V.AmazonSesSecretAccessKey]: SES_SECRET,
        [V.AmazonSesRegion]: "eu-west-1",
      });

      const result: HttpResult = await request({ port: port });

      expect(result.status).toBe(200);
      expect(result.body?.["serverType"]).toBe(EmailServerType.AmazonSES);
      expect(result.body?.["problems"]).toEqual([]);
      expect(result.raw).toContain("AKIAEXAMPLE");
      expectNoSecret(result.raw);
    });

    test("set with problems: each, by the variable's name, and still never the password", async () => {
      setEnvironment({
        [V.SmtpPort]: "70000",
        [V.SmtpHost]: undefined,
      });

      const result: HttpResult = await request({ port: port });

      expect(result.status).toBe(200);
      expect(result.body?.["isSetByEnvironment"]).toBe(true);
      expect(result.body?.["problems"]).toEqual([
        "GLOBAL_EMAIL_SMTP_HOST is not set: email goes out through that mail server, such as smtp.example.com.",
        'GLOBAL_EMAIL_SMTP_PORT: "70000" is not a port, a number from 1 to 65535 such as 587.',
      ]);
      expectNoSecret(result.raw);
    });

    test("a password set where it is not read: listed as ignored, still not said", async () => {
      setEnvironment({
        [V.ServerType]: "sendgrid",
        [V.SendgridApiKey]: "SG.environment-key",
      });

      const result: HttpResult = await request({ port: port });

      expect(result.status).toBe(200);
      expect(result.body?.["problems"]).toEqual([]);
      expect(result.body?.["ignored"]).toEqual([
        V.SmtpHost,
        V.SmtpPort,
        V.SmtpUsername,
        V.SmtpPassword,
      ]);
      expectNoSecret(result.raw);
      expect(result.raw).not.toContain("SG.environment-key");
    });

    test("a type that is not one: that, and nothing else", async () => {
      setEnvironment({ [V.ServerType]: "gmail" });

      const result: HttpResult = await request({ port: port });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        isSetByEnvironment: true,
        serverType: null,
        fields: [
          {
            variable: V.ServerType,
            value: "gmail",
            isSecret: false,
            isSet: true,
          },
        ],
        problems: [
          'GLOBAL_EMAIL_SERVER_TYPE must be custom-smtp, sendgrid, amazon-ses, mailgun, postmark or resend, not "gmail".',
        ],
        ignored: [],
      });
      expectNoSecret(result.raw);
    });

    test("unset: no settings, so the page shows the saved ones", async () => {
      for (const variable of SERVER_EMAIL_ENVIRONMENT_VARIABLES) {
        delete process.env[variable];
      }

      const result: HttpResult = await request({ port: port });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        isSetByEnvironment: false,
        serverType: null,
        fields: [],
        problems: [],
        ignored: [],
      });
    });

    test("variables set without the type: no settings, and that nothing reads them", async () => {
      delete process.env[V.ServerType];

      const result: HttpResult = await request({ port: port });

      expect(result.status).toBe(200);
      expect(result.body?.["isSetByEnvironment"]).toBe(false);
      expect(result.body?.["fields"]).toEqual([]);
      expect(result.body?.["problems"]).toEqual([
        expect.stringContaining(
          "GLOBAL_EMAIL_FROM_EMAIL, GLOBAL_EMAIL_FROM_NAME, GLOBAL_EMAIL_SMTP_HOST, GLOBAL_EMAIL_SMTP_PORT, GLOBAL_EMAIL_SMTP_USERNAME and GLOBAL_EMAIL_SMTP_PASSWORD are set, but GLOBAL_EMAIL_SERVER_TYPE is not",
        ),
      ]);
      expectNoSecret(result.raw);
    });

    test("a POST is not this route", async () => {
      const result: HttpResult = await request({ port: port, method: "POST" });

      expectNoSecret(result.raw);
      expect(result.body?.["isSetByEnvironment"]).toBeUndefined();
    });
  });
});
