jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

/*
 * Billing per test: CI's config.env turns it on, a local run has it off,
 * and whether projects choose their call voice is never set from the
 * environment on OneUptime Cloud (#11462).
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  const flag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return flag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
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
import {
  SERVER_TWILIO_ENVIRONMENT_ROUTE,
  SERVER_TWILIO_CALL_VOICE_VARIABLE,
  SERVER_TWILIO_ENVIRONMENT_VARIABLES,
  SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE,
  ServerTwilioEnvironmentVariable,
} from "../../../Types/CallAndSMS/ServerTwilioEnvironment";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { TwilioConfigUse } from "../../../Types/CallAndSMS/TwilioConfigUse";
import Email from "../../../Types/Email";
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
 * GET /global-config/twilio-environment, over HTTP (#7515): whether the
 * GLOBAL_TWILIO_ environment variables set the server's Twilio account,
 * which Admin Dashboard > Settings > Call and SMS shows in place of the
 * saved one. A master admin's only, as the saved account is; and never the
 * auth token, to anyone - only whether one is set.
 */

const ROUTE: string = `/api${SERVER_TWILIO_ENVIRONMENT_ROUTE}`;
const TOKEN: string = "environment-auth-token-sentinel-7515";

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

/*
 * The account's variables, the voice's (#11064) and the switch's that lets
 * projects choose theirs (#11462), which the route says too.
 */
const VARIABLES: Array<string> = [
  ...SERVER_TWILIO_ENVIRONMENT_VARIABLES,
  SERVER_TWILIO_CALL_VOICE_VARIABLE,
  SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE,
];

function setEnvironment(
  values: Partial<Record<ServerTwilioEnvironmentVariable, string>>,
): void {
  for (const [variable, value] of Object.entries(values)) {
    process.env[variable] = value;
  }
}

describe("the server's Twilio account from environment variables, over HTTP", () => {
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
    setTestBillingEnabled(false);

    for (const variable of VARIABLES) {
      before[variable] = process.env[variable];
      delete process.env[variable];
    }

    // An account with its token: what nobody but the server may read.
    setEnvironment({
      [ServerTwilioEnvironmentVariable.AccountSid]:
        "AC22222222222222222222222222222222",
      [ServerTwilioEnvironmentVariable.AuthToken]: TOKEN,
      [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "+14155550100",
    });
  });

  afterEach(() => {
    for (const variable of VARIABLES) {
      if (before[variable] === undefined) {
        delete process.env[variable];
      } else {
        process.env[variable] = before[variable];
      }
    }

    jest.restoreAllMocks();
  });

  test("is the route the Admin Dashboard asks", () => {
    expect(ROUTE).toBe("/api/global-config/twilio-environment");
  });

  test("a request with no session is refused, and told nothing", async () => {
    jest
      .spyOn(UserMiddleware, "readRequestSession")
      .mockResolvedValue({ kind: "none" });

    const result: HttpResult = await request({ port: port });

    expect(result.status).toBe(401);
    expect(result.raw).not.toContain(TOKEN);
    expect(result.raw).not.toContain("AC22222222222222222222222222222222");
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
    expect(result.raw).not.toContain(TOKEN);
    expect(result.raw).not.toContain("AC22222222222222222222222222222222");
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

    test("set: the account the variables set, without its auth token", async () => {
      const result: HttpResult = await request({ port: port });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        isSetByEnvironment: true,
        usedFor: TwilioConfigUse.CallsAndSms,
        accountSid: "AC22222222222222222222222222222222",
        hasAuthToken: true,
        primaryPhoneNumber: "+14155550100",
        secondaryPhoneNumbers: null,
        smsPhoneNumbers: null,
        problems: [],
        isCallVoiceSetByEnvironment: false,
        callVoice: null,
        callVoiceProblem: null,
        isLetProjectsChooseCallVoiceSetByEnvironment: false,
        letProjectsChooseCallVoice: false,
        letProjectsChooseCallVoiceProblem: null,
      });
      expect(result.raw).not.toContain(TOKEN);
    });

    test("set with problems: each, by the variable's name, and still never the token", async () => {
      setEnvironment({
        [ServerTwilioEnvironmentVariable.UsedFor]: "sms-only",
        [ServerTwilioEnvironmentVariable.SmsPhoneNumbers]: "+6581234567, nope",
      });

      const result: HttpResult = await request({ port: port });

      expect(result.status).toBe(200);
      expect(result.body?.["isSetByEnvironment"]).toBe(true);
      expect(result.body?.["usedFor"]).toBe(TwilioConfigUse.SmsOnly);
      expect(result.body?.["problems"]).toEqual([
        expect.stringMatching(
          /^GLOBAL_TWILIO_SMS_PHONE_NUMBERS: "nope" is not a phone number\./,
        ),
      ]);
      expect(result.raw).not.toContain(TOKEN);
    });

    test("unset: no account, so the page shows the saved one", async () => {
      for (const variable of SERVER_TWILIO_ENVIRONMENT_VARIABLES) {
        delete process.env[variable];
      }

      const result: HttpResult = await request({ port: port });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        isSetByEnvironment: false,
        usedFor: null,
        accountSid: null,
        hasAuthToken: false,
        primaryPhoneNumber: null,
        secondaryPhoneNumbers: null,
        smsPhoneNumbers: null,
        problems: [],
        isCallVoiceSetByEnvironment: false,
        callVoice: null,
        callVoiceProblem: null,
        isLetProjectsChooseCallVoiceSetByEnvironment: false,
        letProjectsChooseCallVoice: false,
        letProjectsChooseCallVoiceProblem: null,
      });
    });

    test("the call voice GLOBAL_TWILIO_CALL_VOICE sets, beside the account (#11064)", async () => {
      process.env[SERVER_TWILIO_CALL_VOICE_VARIABLE] = "Polly.Matthew-Neural";

      const result: HttpResult = await request({ port: port });

      expect(result.status).toBe(200);
      expect(result.body?.["isSetByEnvironment"]).toBe(true);
      expect(result.body?.["isCallVoiceSetByEnvironment"]).toBe(true);
      expect(result.body?.["callVoice"]).toBe("Polly.Matthew-Neural");
      expect(result.body?.["callVoiceProblem"]).toBe(null);
      expect(result.raw).not.toContain(TOKEN);
    });

    test("the call voice without the account: no account, and the voice", async () => {
      for (const variable of SERVER_TWILIO_ENVIRONMENT_VARIABLES) {
        delete process.env[variable];
      }
      process.env[SERVER_TWILIO_CALL_VOICE_VARIABLE] = "Google.en-US-Neural2-J";

      const result: HttpResult = await request({ port: port });

      expect(result.status).toBe(200);
      expect(result.body?.["isSetByEnvironment"]).toBe(false);
      expect(result.body?.["problems"]).toEqual([]);
      expect(result.body?.["isCallVoiceSetByEnvironment"]).toBe(true);
      expect(result.body?.["callVoice"]).toBe("Google.en-US-Neural2-J");
    });

    test("a call voice OneUptime does not offer: set, no voice, and the problem by the variable's name - the account's problems untouched", async () => {
      process.env[SERVER_TWILIO_CALL_VOICE_VARIABLE] = "Polly.Joanna";

      const result: HttpResult = await request({ port: port });

      expect(result.status).toBe(200);
      expect(result.body?.["problems"]).toEqual([]);
      expect(result.body?.["isCallVoiceSetByEnvironment"]).toBe(true);
      expect(result.body?.["callVoice"]).toBe(null);
      expect(result.body?.["callVoiceProblem"]).toEqual(
        expect.stringMatching(
          /^GLOBAL_TWILIO_CALL_VOICE: "Polly\.Joanna" is not a voice OneUptime offers/,
        ),
      );
    });

    test("whether projects choose their call voice, as GLOBAL_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE sets it beside the account (#11462)", async () => {
      process.env[SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE] =
        "true";

      const result: HttpResult = await request({ port: port });

      expect(result.status).toBe(200);
      expect(result.body?.["isSetByEnvironment"]).toBe(true);
      expect(result.body?.["problems"]).toEqual([]);
      expect(
        result.body?.["isLetProjectsChooseCallVoiceSetByEnvironment"],
      ).toBe(true);
      expect(result.body?.["letProjectsChooseCallVoice"]).toBe(true);
      expect(result.body?.["letProjectsChooseCallVoiceProblem"]).toBe(null);
      // The voice's variable is its own: not set by this one.
      expect(result.body?.["isCallVoiceSetByEnvironment"]).toBe(false);
      expect(result.raw).not.toContain(TOKEN);
    });

    test("false is as much the switch as true: set, and off", async () => {
      process.env[SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE] =
        "FALSE";

      const result: HttpResult = await request({ port: port });

      expect(
        result.body?.["isLetProjectsChooseCallVoiceSetByEnvironment"],
      ).toBe(true);
      expect(result.body?.["letProjectsChooseCallVoice"]).toBe(false);
      expect(result.body?.["letProjectsChooseCallVoiceProblem"]).toBe(null);
    });

    test("the switch without the account: no account, and the switch", async () => {
      for (const variable of SERVER_TWILIO_ENVIRONMENT_VARIABLES) {
        delete process.env[variable];
      }
      process.env[SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE] =
        "true";

      const result: HttpResult = await request({ port: port });

      expect(result.status).toBe(200);
      expect(result.body?.["isSetByEnvironment"]).toBe(false);
      expect(result.body?.["problems"]).toEqual([]);
      expect(
        result.body?.["isLetProjectsChooseCallVoiceSetByEnvironment"],
      ).toBe(true);
      expect(result.body?.["letProjectsChooseCallVoice"]).toBe(true);
    });

    test("a value that is neither true nor false: set, off, and the problem by the variable's name - the account's problems untouched", async () => {
      process.env[SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE] =
        "yes";

      const result: HttpResult = await request({ port: port });

      expect(result.status).toBe(200);
      expect(result.body?.["problems"]).toEqual([]);
      expect(
        result.body?.["isLetProjectsChooseCallVoiceSetByEnvironment"],
      ).toBe(true);
      expect(result.body?.["letProjectsChooseCallVoice"]).toBe(false);
      expect(result.body?.["letProjectsChooseCallVoiceProblem"]).toEqual(
        expect.stringMatching(
          /^GLOBAL_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE: "yes" is neither true nor false/,
        ),
      );
    });

    test("on OneUptime Cloud the variable is never the switch, and the answer says it is ignored", async () => {
      setTestBillingEnabled(true);
      process.env[SERVER_TWILIO_LET_PROJECTS_CHOOSE_CALL_VOICE_VARIABLE] =
        "true";

      const result: HttpResult = await request({ port: port });

      expect(result.status).toBe(200);
      expect(
        result.body?.["isLetProjectsChooseCallVoiceSetByEnvironment"],
      ).toBe(false);
      expect(result.body?.["letProjectsChooseCallVoice"]).toBe(false);
      expect(
        String(result.body?.["letProjectsChooseCallVoiceProblem"]),
      ).toContain("is ignored");
    });

    test("variables set without the account SID: no account, and that nothing reads them", async () => {
      delete process.env[ServerTwilioEnvironmentVariable.AccountSid];

      const result: HttpResult = await request({ port: port });

      expect(result.status).toBe(200);
      expect(result.body?.["isSetByEnvironment"]).toBe(false);
      expect(result.body?.["hasAuthToken"]).toBe(false);
      expect(result.body?.["problems"]).toEqual([
        expect.stringContaining(
          "GLOBAL_TWILIO_AUTH_TOKEN and GLOBAL_TWILIO_PRIMARY_PHONE_NUMBER are set, but GLOBAL_TWILIO_ACCOUNT_SID is not",
        ),
      ]);
      expect(result.raw).not.toContain(TOKEN);
    });
  });
});
