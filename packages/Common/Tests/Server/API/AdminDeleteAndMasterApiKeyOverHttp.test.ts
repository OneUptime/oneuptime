jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
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
      getLogLevel: jest.fn().mockReturnValue("ERROR"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import GlobalConfigAPI from "../../../Server/API/GlobalConfigAPI";
import UserAPI from "../../../Server/API/UserAPI";
import IdentityRateLimit, {
  IdentityRateLimitOutcome,
} from "../../../Server/Middleware/IdentityRateLimit";
import ProjectMiddleware from "../../../Server/Middleware/ProjectAuthorization";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService, {
  SOMEONES_ACCOUNT_IN_A_PROJECT_MESSAGE,
} from "../../../Server/Services/UserService";
import UserSessionService from "../../../Server/Services/UserSessionService";
import UserTotpAuthService from "../../../Server/Services/UserTotpAuthService";
import UserWebAuthnService from "../../../Server/Services/UserWebAuthnService";
import CookieUtil from "../../../Server/Utils/Cookie";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import logger from "../../../Server/Utils/Logger";
import MasterApiKey from "../../../Server/Utils/MasterApiKey";
import Reauthentication from "../../../Server/Utils/Reauthentication/Reauthentication";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import {
  REAUTHENTICATION_FIELDS,
  REAUTHENTICATION_NOT_FROM_A_SESSION_MESSAGES,
  REAUTHENTICATION_PURPOSE_FIELD,
  REAUTHENTICATION_REQUIRED_MESSAGES,
  REAUTHENTICATION_REQUIRED_REFUSAL_CODE,
  REAUTHENTICATION_ROUTE,
  REAUTHENTICATION_WINDOW_IN_MINUTES,
  ReauthenticationPurpose,
} from "../../../Types/Accounts/Reauthentication";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import { REFUSAL_CODE_FIELD } from "../../../Types/Exception/NameTakenException";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
} from "../../../Types/Permission";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { treatEverySessionAsLive } from "../TestingUtils/LiveSessions";
import {
  MINUTE_IN_MS,
  StandInValkey,
  confirmedKeyOf,
} from "../TestingUtils/ReauthenticationStandIns";
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
import CookieParser from "cookie-parser";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";

/*
 * A MASTER ADMIN DELETING SOMEONE ELSE'S ACCOUNT, OR TURNING THE MASTER API
 * KEY BACK ON, CONFIRMS IT'S THEM FIRST (#10330) - over HTTP.
 *
 * Whoever held a master admin's session - a laptop left unlocked, a stolen
 * cookie - could delete any account that is in no project (Admin Dashboard
 * > Users > Delete), or turn the master API key back on once it was off
 * (Admin Dashboard > Settings > API Key), without the master admin's
 * password. Each now waits for the master admin's own session to confirm
 * it's them, as their other changes to how someone signs in have since
 * #10216.
 *
 * Each case is a real HTTP request to a real Express app - cookie parsing,
 * the JSON body parser, the real UserAPI and GlobalConfigAPI routers (the
 * generic DELETE /api/user/:id and PUT /api/global-config/:id the Admin
 * Dashboard sends, and the POST /api/user/reauthentication its prompt
 * sends) and the production error handler - carrying sessions signed for
 * real (JSONWebToken). The accounts and the server's settings are rows of
 * tables held in memory behind the real UserService and GlobalConfigService,
 * so every write runs through their real hooks, and the check is the real
 * one (Server/Utils/Reauthentication), its confirmations kept in Valkey in
 * memory. Each change is:
 *
 *   - refused, with the code the Admin Dashboard's prompt acts on and what
 *     it is for (AdminChange), and nothing changed, until the master admin's
 *     session has confirmed with their own password;
 *   - let through once it has, inside the window, and refused again after
 *     it;
 *   - refused, with what to do, for the master API key, which has no
 *     session, and so for nobody to confirm;
 *   - recorded in the server's log with who did it.
 */

/*
 * A real Express app: an error that walks the routes registered after the
 * one that threw is deferred with setImmediate, which Common's jsdom
 * environment does not expose. Lend it Node's.
 */
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

// The instance-wide master API key (Admin Dashboard > Settings > API Key).
const MASTER_API_KEY: string = "6c000000-0000-4000-8000-0000000000c1";

// What the server's settings row holds of it: its hash (#7901).
const MASTER_API_KEY_HASH: string = MasterApiKey.hash(MASTER_API_KEY);

// The server's own settings: the one GlobalConfig row.
const GLOBAL_CONFIG_ID: ObjectID = ObjectID.getZeroObjectID();

const RIGHT_PASSWORD: string = "the master admin's own password, 2026";

// Each test has accounts and sessions of its own.
interface People {
  // The master admin, and the session they are signed in with.
  admin: ObjectID;
  adminSessionId: ObjectID;
  // Someone in no project, whose account the master admin deletes.
  someone: ObjectID;
  // Someone else in no project.
  another: ObjectID;
}

let people: People;
let users: InMemoryTable;
let globalConfigs: InMemoryTable;
let valkey: StandInValkey;
// The projects each account is a member of, by its id.
let memberships: Dictionary<number>;

let server: http.Server | null = null;
let port: number = 0;

function userRow(id: ObjectID, isMasterAdmin: boolean): StoredRow {
  return {
    _id: id.toString(),
    name: isMasterAdmin ? "Ada Admin" : "Sam Someone",
    email: `${id.toString()}@example.com`,
    isMasterAdmin: isMasterAdmin,
    isBlocked: false,
    isEmailVerified: true,
    enableTwoFactorAuth: false,
    // A password the master admin signs in with; its check is stubbed below.
    password: "stored-hash",
    passwordSalt: "salt",
  };
}

// A session's access token, as every sign-in and every renewal gives it.
function sessionOf(userId: ObjectID, sessionId: ObjectID): string {
  return JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: userId,
      email: new Email(`${userId.toString()}@example.com`),
      name: new Name("Ada Admin"),
      timezone: null,
      isMasterAdmin: true,
      isGlobalLogin: true,
      sessionId: sessionId,
    },
    expiresInSeconds: 15 * 60,
  });
}

function adminSession(): string {
  return sessionOf(people.admin, people.adminSessionId);
}

interface HttpResult {
  status: number;
  body: JSONObject | JSONArray | null;
  text: string;
}

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

function send(data: {
  method: HttpMethod;
  path: string;
  token?: string | undefined;
  headers?: Dictionary<string> | undefined;
  body?: JSONObject | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string = data.body ? JSON.stringify(data.body) : "";

      const headers: http.OutgoingHttpHeaders = {
        ...(payload
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload),
            }
          : {}),
        ...(data.headers || {}),
      };

      if (data.token) {
        headers["cookie"] = `${CookieUtil.getUserTokenKey()}=${data.token}`;
      }

      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          path: data.path,
          method: data.method,
          headers,
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            const text: string = Buffer.concat(chunks).toString("utf8");
            let body: JSONObject | JSONArray | null = null;

            try {
              body = text ? (JSON.parse(text) as JSONObject | JSONArray) : null;
            } catch {
              body = null;
            }

            resolve({ status: response.statusCode || 0, body, text });
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

function bodyOf(result: HttpResult): JSONObject {
  return result.body && !Array.isArray(result.body) ? result.body : {};
}

// The message of an error answer: `message` from a route, `error` from the handler.
function messageOf(result: HttpResult): string | undefined {
  const body: JSONObject = bodyOf(result);

  for (const field of ["message", "error"]) {
    if (typeof body[field] === "string") {
      return body[field] as string;
    }
  }

  return undefined;
}

// The refusal the Admin Dashboard's prompt acts on: its code, and what it is for.
function expectAdminRefusal(result: HttpResult): void {
  expect(result.status).toBe(400);
  expect(bodyOf(result)[REFUSAL_CODE_FIELD]).toBe(
    REAUTHENTICATION_REQUIRED_REFUSAL_CODE,
  );
  expect(bodyOf(result)[REAUTHENTICATION_PURPOSE_FIELD]).toBe(
    ReauthenticationPurpose.AdminChange,
  );
  expect(messageOf(result)).toBe(
    REAUTHENTICATION_REQUIRED_MESSAGES[ReauthenticationPurpose.AdminChange],
  );
}

// What a request with no session is told: it cannot make the change at all.
function expectNoSessionRefusal(result: HttpResult): void {
  expect(result.status).toBe(400);
  expect(bodyOf(result)[REFUSAL_CODE_FIELD]).toBeUndefined();
  expect(messageOf(result)).toBe(
    REAUTHENTICATION_NOT_FROM_A_SESSION_MESSAGES[
      ReauthenticationPurpose.AdminChange
    ],
  );
}

// What the Admin Dashboard sends for Users > Delete and the bulk Delete.
function deleteAccount(
  accountId: ObjectID,
  credential: { token?: string; headers?: Dictionary<string> },
): Promise<HttpResult> {
  return send({
    method: "DELETE",
    path: `/api/user/${accountId.toString()}`,
    ...credential,
  });
}

// What the Admin Dashboard's Enabled switch sends (ModelSwitchRow, AdminModelAPI).
function switchMasterApiKey(
  isOn: unknown,
  credential: { token?: string; headers?: Dictionary<string> },
): Promise<HttpResult> {
  return send({
    method: "PUT",
    path: `/api/global-config/${GLOBAL_CONFIG_ID.toString()}`,
    body: { data: { isMasterApiKeyEnabled: isOn } as JSONObject },
    ...credential,
  });
}

/*
 * What the Admin Dashboard's prompt sends, Confirm It's You: the master
 * admin's own password, from the session they are signed in with.
 */
function confirmItsYou(password: string, token?: string): Promise<HttpResult> {
  return send({
    method: "POST",
    path: `/api${REAUTHENTICATION_ROUTE}`,
    token: token || adminSession(),
    body: { [REAUTHENTICATION_FIELDS.password]: password },
  });
}

function masterApiKeyHeader(): { headers: Dictionary<string> } {
  return { headers: { apikey: MASTER_API_KEY } };
}

function infoLines(): Array<string> {
  return jest
    .mocked(logger.info)
    .mock.calls.map((call: Array<unknown>): string => {
      return String(call[0]);
    });
}

function minutesPass(minutes: number): void {
  jest.setSystemTime(Date.now() + minutes * MINUTE_IN_MS);
}

beforeAll(async () => {
  const app: express.Express = express();
  app.use(CookieParser());
  app.use(express.json());
  app.use("/api", new UserAPI().getRouter());
  app.use("/api", new GlobalConfigAPI().getRouter());
  app.use(expressErrorHandler);

  const startedServer: http.Server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    startedServer.listen(0, "127.0.0.1", resolve);
  });

  server = startedServer;
  port = (startedServer.address() as AddressInfo).port;
});

afterAll(async () => {
  const startedServer: http.Server | null = server;
  server = null;

  if (startedServer) {
    await new Promise<void>((resolve: () => void) => {
      startedServer.close(() => {
        resolve();
      });
    });
  }
});

beforeEach(() => {
  people = {
    admin: ObjectID.generate(),
    adminSessionId: ObjectID.generate(),
    someone: ObjectID.generate(),
    another: ObjectID.generate(),
  };
  memberships = {};
  valkey = new StandInValkey();

  jest.mocked(logger.info).mockClear();

  /*
   * The check and the confirmation as they run, against Valkey in memory:
   * only Server/Utils/Reauthentication reads it here, so everything else
   * still sees Valkey down, as it does in the suites beside this one.
   */
  jest
    .spyOn(
      Reauthentication as unknown as { getStore: () => unknown },
      "getStore",
    )
    .mockImplementation(() => {
      return valkey;
    });
  jest
    .spyOn(IdentityRateLimit, "consume")
    .mockResolvedValue({ outcome: IdentityRateLimitOutcome.Allowed });
  // The password, checked against the master admin's own as a sign-in checks it.
  jest
    .spyOn(UserService, "verifyHashedColumnValue")
    .mockImplementation((async (data: { plainValue: string }) => {
      return data.plainValue === RIGHT_PASSWORD;
    }) as never);
  // No authenticator app, security key or passkey: the password confirms.
  jest.spyOn(UserTotpAuthService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(UserWebAuthnService, "findBy").mockResolvedValue([] as never);

  // The sessions these tokens name are live: what an ended one does is EndedSessionAccessToken.test.ts.
  treatEverySessionAsLive();
  jest
    .spyOn(UserService, "updateLastActive")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(GlobalConfigService, "getRequireSsoForLogin")
    .mockResolvedValue(false as never);
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  } as never);

  /*
   * No project has an API key of that value, so the request's key is
   * checked as the master API key - and only the master API key is one.
   */
  jest.spyOn(ApiKeyService, "findApiKey").mockResolvedValue(null as never);
  jest.spyOn(ProjectMiddleware, "isMasterApiKey").mockImplementation((async (
    apiKey: ObjectID,
  ): Promise<boolean> => {
    return apiKey.toString() === MASTER_API_KEY;
  }) as never);

  jest
    .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
    .mockImplementation((async (): Promise<UserGlobalAccessPermission> => {
      return {
        _type: "UserGlobalAccessPermission",
        projectIds: [],
        globalPermissions: [Permission.Public, Permission.User],
      } as UserGlobalAccessPermission;
    }) as never);
  jest
    .spyOn(TeamMemberService, "getTeamIdsForUser")
    .mockResolvedValue([] as never);

  // The projects an account is a member of: none, unless a test says.
  jest.spyOn(TeamMemberService, "findBy").mockImplementation((async (data: {
    query: { userId?: ObjectID };
  }): Promise<Array<TeamMember>> => {
    const count: number = memberships[data.query.userId?.toString() || ""] || 0;

    return Array.from({ length: count }).map((): TeamMember => {
      const member: TeamMember = new TeamMember();
      member._id = ObjectID.generate().toString();
      return member;
    });
  }) as never);

  jest
    .spyOn(UserSessionService, "revokeAllSessionsByUserId")
    .mockResolvedValue(undefined as never);

  users = useInMemoryTable(UserService, [
    userRow(people.admin, true),
    userRow(people.someone, false),
    userRow(people.another, false),
  ]);

  // Answering only what a read selects, as Postgres does.
  globalConfigs = useInMemoryTable(
    GlobalConfigService,
    [
      {
        _id: GLOBAL_CONFIG_ID.toString(),
        // Turned off: the key's owner cannot use it until it is on again.
        isMasterApiKeyEnabled: false,
        masterApiKey: MASTER_API_KEY_HASH,
      },
    ],
    { answersOnlySelectedColumns: true },
  );
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("deleting someone else's account (Admin Dashboard > Users > Delete)", () => {
  test("refused until the master admin's own session confirms it's them: nothing is deleted", async () => {
    const refused: HttpResult = await deleteAccount(people.someone, {
      token: adminSession(),
    });

    expectAdminRefusal(refused);
    expect(users.get(people.someone)).toBeDefined();
    expect(users.deletes).toEqual([]);
    // Nothing deleted, nothing recorded as deleted.
    expect(
      infoLines().filter((line: string): boolean => {
        return line.includes("deleted by");
      }),
    ).toEqual([]);
  });

  test("once they confirm with their own password, the same delete goes through, and it is recorded with who did it", async () => {
    expectAdminRefusal(
      await deleteAccount(people.someone, { token: adminSession() }),
    );

    const confirmed: HttpResult = await confirmItsYou(RIGHT_PASSWORD);

    expect(confirmed.status).toBe(200);
    expect(typeof bodyOf(confirmed)["confirmedUntil"]).toBe("string");

    const deleted: HttpResult = await deleteAccount(people.someone, {
      token: adminSession(),
    });

    expect(deleted.status).toBe(200);
    expect(users.get(people.someone)).toBeUndefined();
    expect(infoLines()).toContain(
      `Account of user ${people.someone.toString()} deleted by master admin ${people.admin.toString()}.`,
    );
    // By ids: never an address.
    expect(
      infoLines().find((line: string): boolean => {
        return line.includes("deleted by");
      }),
    ).not.toContain("@");
  });

  test("a wrong password confirms nothing: the delete stays refused", async () => {
    const wrong: HttpResult = await confirmItsYou("a guess at it");

    expect(wrong.status).toBe(400);

    expectAdminRefusal(
      await deleteAccount(people.someone, { token: adminSession() }),
    );
    expect(users.get(people.someone)).toBeDefined();
  });

  test("a confirmation holds for the window, and a delete after it is refused again", async () => {
    jest.useFakeTimers({
      doNotFake: [
        "nextTick",
        "setImmediate",
        "setTimeout",
        "setInterval",
        "clearTimeout",
        "clearInterval",
        "queueMicrotask",
      ],
    });

    expect((await confirmItsYou(RIGHT_PASSWORD)).status).toBe(200);

    minutesPass(REAUTHENTICATION_WINDOW_IN_MINUTES - 1);

    expect(
      (await deleteAccount(people.someone, { token: adminSession() })).status,
    ).toBe(200);

    minutesPass(2);

    expectAdminRefusal(
      await deleteAccount(people.another, { token: adminSession() }),
    );
    expect(users.get(people.another)).toBeDefined();
  });

  test("another session of the same master admin's that confirmed does not count: only this one's", async () => {
    const otherSession: string = sessionOf(people.admin, ObjectID.generate());

    expect((await confirmItsYou(RIGHT_PASSWORD, otherSession)).status).toBe(
      200,
    );

    expectAdminRefusal(
      await deleteAccount(people.someone, { token: adminSession() }),
    );
    expect(users.get(people.someone)).toBeDefined();
  });

  test("the master API key is refused, with what to do: nobody signed in to it can confirm", async () => {
    // A key that is on, and the master admin it acts as confirmed in their own session.
    globalConfigs.get(GLOBAL_CONFIG_ID)!["isMasterApiKeyEnabled"] = true;
    expect((await confirmItsYou(RIGHT_PASSWORD)).status).toBe(200);

    const result: HttpResult = await deleteAccount(
      people.someone,
      masterApiKeyHeader(),
    );

    expectNoSessionRefusal(result);
    expect(users.get(people.someone)).toBeDefined();
  });

  test("an account still in a project is told whose it is, and the master admin is asked nothing", async () => {
    memberships[people.someone.toString()] = 1;

    const result: HttpResult = await deleteAccount(people.someone, {
      token: adminSession(),
    });

    expect(result.status).toBe(400);
    expect(messageOf(result)).toBe(SOMEONES_ACCOUNT_IN_A_PROJECT_MESSAGE);
    expect(bodyOf(result)[REFUSAL_CODE_FIELD]).toBeUndefined();
    expect(users.get(people.someone)).toBeDefined();
  });
});

describe("turning the master API key back on (Admin Dashboard > Settings > API Key)", () => {
  test("refused until the master admin's own session confirms it's them: it stays off", async () => {
    expectAdminRefusal(
      await switchMasterApiKey(true, { token: adminSession() }),
    );

    expect(globalConfigs.get(GLOBAL_CONFIG_ID)?.["isMasterApiKeyEnabled"]).toBe(
      false,
    );
    expect(globalConfigs.updates).toEqual([]);
  });

  test("once they confirm with their own password, the same switch goes through, and it is recorded with who did it", async () => {
    expectAdminRefusal(
      await switchMasterApiKey(true, { token: adminSession() }),
    );

    expect((await confirmItsYou(RIGHT_PASSWORD)).status).toBe(200);

    const switched: HttpResult = await switchMasterApiKey(true, {
      token: adminSession(),
    });

    expect(switched.status).toBe(200);
    expect(globalConfigs.get(GLOBAL_CONFIG_ID)?.["isMasterApiKeyEnabled"]).toBe(
      true,
    );
    expect(infoLines()).toContain(
      `The master API key was turned on by master admin ${people.admin.toString()}.`,
    );
  });

  test("a switch sent as text the database reads as on is asked as on is", async () => {
    expectAdminRefusal(
      await switchMasterApiKey("true", { token: adminSession() }),
    );
    expect(globalConfigs.get(GLOBAL_CONFIG_ID)?.["isMasterApiKeyEnabled"]).toBe(
      false,
    );
  });

  test("a confirmation from before the window is no confirmation: refused again", async () => {
    jest.useFakeTimers({
      doNotFake: [
        "nextTick",
        "setImmediate",
        "setTimeout",
        "setInterval",
        "clearTimeout",
        "clearInterval",
        "queueMicrotask",
      ],
    });

    expect((await confirmItsYou(RIGHT_PASSWORD)).status).toBe(200);
    expect(valkey.values.has(confirmedKeyOf(people.adminSessionId))).toBe(true);

    minutesPass(REAUTHENTICATION_WINDOW_IN_MINUTES + 1);

    expectAdminRefusal(
      await switchMasterApiKey(true, { token: adminSession() }),
    );
    expect(globalConfigs.get(GLOBAL_CONFIG_ID)?.["isMasterApiKeyEnabled"]).toBe(
      false,
    );
  });

  test("turning it off asks nothing, and is recorded too", async () => {
    globalConfigs.get(GLOBAL_CONFIG_ID)!["isMasterApiKeyEnabled"] = true;

    const switched: HttpResult = await switchMasterApiKey(false, {
      token: adminSession(),
    });

    expect(switched.status).toBe(200);
    expect(globalConfigs.get(GLOBAL_CONFIG_ID)?.["isMasterApiKeyEnabled"]).toBe(
      false,
    );
    expect(infoLines()).toContain(
      `The master API key was turned off by master admin ${people.admin.toString()}.`,
    );
  });

  test("the master API key cannot be turned on with itself: refused, with what to do", async () => {
    globalConfigs.get(GLOBAL_CONFIG_ID)!["isMasterApiKeyEnabled"] = true;

    expectNoSessionRefusal(
      await switchMasterApiKey(true, masterApiKeyHeader()),
    );
  });

  test("the master API key can still turn itself off, and that is recorded as the key's own doing", async () => {
    globalConfigs.get(GLOBAL_CONFIG_ID)!["isMasterApiKeyEnabled"] = true;

    const switched: HttpResult = await switchMasterApiKey(
      false,
      masterApiKeyHeader(),
    );

    expect(switched.status).toBe(200);
    expect(globalConfigs.get(GLOBAL_CONFIG_ID)?.["isMasterApiKeyEnabled"]).toBe(
      false,
    );
    expect(infoLines()).toContain(
      'The master API key was turned off by the API key "Master API Key".',
    );
  });
});
