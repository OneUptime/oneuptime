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

import UserAPI from "../../../Server/API/UserAPI";
import UserTotpAuthAPI from "../../../Server/API/UserTotpAuthAPI";
import UserWebAuthnAPI from "../../../Server/API/UserWebAuthnAPI";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import UserSessionService from "../../../Server/Services/UserSessionService";
import UserTotpAuthService from "../../../Server/Services/UserTotpAuthService";
import UserTwoFactorBackupCodeService from "../../../Server/Services/UserTwoFactorBackupCodeService";
import UserWebAuthnService from "../../../Server/Services/UserWebAuthnService";
import CookieUtil from "../../../Server/Utils/Cookie";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import Reauthentication from "../../../Server/Utils/Reauthentication/Reauthentication";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import TwoFactorWrongCodes from "../../../Server/Utils/TwoFactorWrongCodes";
import {
  REAUTHENTICATION_REQUIRED_MESSAGES,
  REAUTHENTICATION_REQUIRED_REFUSAL_CODE,
  ReauthenticationPurpose,
} from "../../../Types/Accounts/Reauthentication";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Email from "../../../Types/Email";
import ReauthenticationRequiredException from "../../../Types/Exception/ReauthenticationRequiredException";
import { REFUSAL_CODE_FIELD } from "../../../Types/Exception/NameTakenException";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
} from "../../../Types/Permission";
import {
  TWO_FACTOR_AUTH_LAST_METHOD_MESSAGE,
  TWO_FACTOR_AUTH_STATUS_API_ROUTE,
} from "../../../Types/TwoFactorAuthSetup";
import TwoFactorAuthStatus from "../../../Types/TwoFactorAuthStatus";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { treatEverySessionAsLive } from "../TestingUtils/LiveSessions";
import { confirmEverySession } from "../TestingUtils/ReauthenticationConfirmed";
import {
  managingProject,
  MemberProjectsStandIn,
  standInMemberProjects,
} from "../TestingUtils/SsoManagedProjects";
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
import type { SpyInstance } from "jest-mock";
import CookieParser from "cookie-parser";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";

/*
 * THE LAST SECOND STEP STAYS WHILE TWO-FACTOR AUTHENTICATION IS ON, OVER HTTP
 * (#6652, #9666).
 *
 * #6638 began with "I accidentally deactivated my two-factor authentication":
 * the last authenticator app went, the account was left required to use two
 * factors with nothing set up, and the setup screen its next sign-in sent it
 * to could not draw its QR code. Removing the last second step - an
 * authenticator app, a security key or a passkey - while two-factor
 * authentication is on is refused now, with what to do instead: add another
 * one, or turn two-factor authentication off, which its owner always may.
 * Nobody is left in a state they cannot sign in from, and nobody holding
 * only the password gets to enrol the second factor of their choosing.
 *
 * Every way two-factor authentication comes to be required of a person is
 * the one switch on their account (User.enableTwoFactorAuth): turned on by
 * themselves, or required by a master admin (Admin Dashboard > Users). A
 * project or the whole server requiring single sign-on manages sign-in
 * instead - those people sign in through their organization - and opens no
 * way around the rule, for a master admin who still signs in with a
 * password while the server requires SSO, or for someone a project manages
 * whose switch was on before it did. Each is held here, for each kind of
 * second step a person removes from the Dashboard:
 *
 *   - Security > Two-factor authentication: authenticator apps
 *     (DELETE /api/user-totp-auth/:id) and security keys
 *     (DELETE /api/user-webauthn/:id);
 *   - Security > Passkeys: passkeys (DELETE /api/user-webauthn/:id), and a
 *     key from before purposes were recorded, which either list shows.
 *
 * SMS, phone calls and Telegram are ways OneUptime reaches someone on call,
 * not steps of a sign-in, and backup codes are a way back in, never a second
 * step (UserService.countVerifiedTwoFactorAuthMethods): none of them counts
 * here, and removing them changes nobody's sign-in.
 *
 * Each case is a real HTTP request to a real Express app - cookie parsing,
 * the JSON body parser, the real UserAPI, UserTotpAuthAPI and
 * UserWebAuthnAPI routers with the real session middleware in front of
 * them, and the production error handler - carrying sessions signed for
 * real (JSONWebToken). Accounts, authenticator apps and keys are rows of
 * tables held in memory behind the real UserService, UserTotpAuthService and
 * UserWebAuthnService, so every delete runs through their real hooks and
 * permission checks, and every answer is what the Dashboard reads.
 */

// A real Express app needs setImmediate, which Common's jsdom environment lacks.
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

// The kinds of second step a person removes from the Dashboard.
enum SecondStepKind {
  AuthenticatorApp = "authenticator app",
  SecurityKey = "security key",
  Passkey = "passkey",
  // A key registered before purposes were recorded: isPasskey is null.
  KeyOfOld = "key with no recorded purpose",
}

const SECOND_STEP_KINDS: Array<SecondStepKind> = [
  SecondStepKind.AuthenticatorApp,
  SecondStepKind.SecurityKey,
  SecondStepKind.Passkey,
  SecondStepKind.KeyOfOld,
];

// How two-factor authentication came to be required of the person.
enum Requirement {
  OwnSetting = "turned on by its owner",
  MasterAdmin = "required by a master admin",
  ProjectSso = "on before a project that requires SSO managed their sign-in",
  ServerSso = "on for a master admin while the whole server requires SSO",
}

const REQUIREMENTS: Array<Requirement> = [
  Requirement.OwnSetting,
  Requirement.MasterAdmin,
  Requirement.ProjectSso,
  Requirement.ServerSso,
];

interface Person {
  id: ObjectID;
  sessionId: ObjectID;
  isMasterAdmin: boolean;
}

interface SecondStep {
  id: string;
  kind: SecondStepKind;
}

interface HttpResult {
  status: number;
  body: JSONObject | JSONArray | null;
  text: string;
}

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

let users: InMemoryTable;
let authenticatorApps: InMemoryTable;
let keys: InMemoryTable;
let memberProjects: MemberProjectsStandIn;
let serverRequiresSso: boolean;
let confirmation: SpyInstance<typeof Reauthentication.assertConfirmed>;

// A master admin of the server, for Admin Dashboard > Users.
let admin: Person;

let server: http.Server | null = null;
let port: number = 0;

function userRow(person: Person): StoredRow {
  return {
    _id: person.id.toString(),
    name: person.isMasterAdmin ? "Ada Admin" : "River Person",
    email: `${person.id.toString()}@example.com`,
    isMasterAdmin: person.isMasterAdmin,
    isBlocked: false,
    isEmailVerified: true,
    enableTwoFactorAuth: false,
    password: "stored-hash",
    passwordSalt: "salt",
  };
}

function newPerson(data: { isMasterAdmin: boolean }): Person {
  const person: Person = {
    id: ObjectID.generate(),
    sessionId: ObjectID.generate(),
    isMasterAdmin: data.isMasterAdmin,
  };

  users.rows.push(userRow(person));

  return person;
}

// A session's access token, as every sign-in and every renewal gives it.
function sessionOf(person: Person): string {
  return JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: person.id,
      email: new Email(`${person.id.toString()}@example.com`),
      name: new Name(person.isMasterAdmin ? "Ada Admin" : "River Person"),
      timezone: null,
      isMasterAdmin: person.isMasterAdmin,
      isGlobalLogin: true,
      sessionId: person.sessionId,
    },
    expiresInSeconds: 15 * 60,
  });
}

function send(data: {
  method: HttpMethod;
  path: string;
  as: Person;
  body?: JSONObject | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string = data.body ? JSON.stringify(data.body) : "";

      const headers: http.OutgoingHttpHeaders = {
        cookie: `${CookieUtil.getUserTokenKey()}=${sessionOf(data.as)}`,
        ...(payload
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload),
            }
          : {}),
      };

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

// A second step of `kind` set up for `person`: finished unless it says not.
function addSecondStep(
  person: Person,
  kind: SecondStepKind,
  options: { isVerified?: boolean } = {},
): SecondStep {
  const id: string = ObjectID.generate().toString();
  const isVerified: boolean = options.isVerified ?? true;

  if (kind === SecondStepKind.AuthenticatorApp) {
    authenticatorApps.rows.push({
      _id: id,
      userId: person.id.toString(),
      name: "Phone",
      isVerified: isVerified,
      twoFactorSecret: "MTEA5EMEV46EOK5MXD7E3ES7YSRRR6LQ",
      twoFactorOtpUrl:
        "otpauth://totp/OneUptime:river%40example.com?issuer=OneUptime&secret=MTEA5EMEV46EOK5MXD7E3ES7YSRRR6LQ&algorithm=SHA1&digits=6&period=30",
    });
  } else {
    keys.rows.push({
      _id: id,
      userId: person.id.toString(),
      name: kind === SecondStepKind.Passkey ? "Laptop" : "Work key",
      credentialId: `credential-${id}`,
      publicKey: "public-key",
      counter: "0",
      isVerified: isVerified,
      isPasskey:
        kind === SecondStepKind.Passkey
          ? true
          : kind === SecondStepKind.SecurityKey
            ? false
            : null,
    });
  }

  return { id, kind };
}

// What the Dashboard's Delete sends for the second step.
function removeSecondStep(
  person: Person,
  secondStep: SecondStep,
): Promise<HttpResult> {
  return send({
    method: "DELETE",
    path:
      secondStep.kind === SecondStepKind.AuthenticatorApp
        ? `/api/user-totp-auth/${secondStep.id}`
        : `/api/user-webauthn/${secondStep.id}`,
    as: person,
  });
}

function isStillThere(secondStep: SecondStep): boolean {
  const table: InMemoryTable =
    secondStep.kind === SecondStepKind.AuthenticatorApp
      ? authenticatorApps
      : keys;

  return Boolean(table.get(secondStep.id));
}

// What the person's two-factor card reads (TwoFactorStatus, TwoFactorAuthSetupState).
async function statusOf(
  person: Person,
): Promise<{ status: unknown; verifiedMethodCount: unknown }> {
  const result: HttpResult = await send({
    method: "GET",
    path: `/api${TWO_FACTOR_AUTH_STATUS_API_ROUTE}`,
    as: person,
  });

  expect(result.status).toBe(200);

  return {
    status: bodyOf(result)["status"],
    verifiedMethodCount: bodyOf(result)["verifiedMethodCount"],
  };
}

// The owner's own switch on the two-factor card (TwoFactorStatus).
function switchOwnTwoFactorAuth(
  person: Person,
  isOn: boolean,
): Promise<HttpResult> {
  return send({
    method: "PUT",
    path: `/api/user/${person.id.toString()}`,
    as: person,
    body: { data: { enableTwoFactorAuth: isOn } },
  });
}

/*
 * Two-factor authentication required of `person`, as `requirement` says it
 * came to be: through the very routes the Dashboard and the Admin Dashboard
 * send. Their second steps are set up first, as each of these asks.
 */
async function requireTwoFactorAuth(
  person: Person,
  requirement: Requirement,
): Promise<void> {
  if (requirement === Requirement.MasterAdmin) {
    const required: HttpResult = await send({
      method: "POST",
      path: `/api/user/${person.id.toString()}/set-two-factor-auth-required`,
      as: admin,
      body: { isRequired: true },
    });

    expect(required.status).toBe(200);
  } else {
    expect((await switchOwnTwoFactorAuth(person, true)).status).toBe(200);
  }

  if (requirement === Requirement.ProjectSso) {
    // A project that requires SSO and manages their sign-in, from now on.
    memberProjects.setProjects([managingProject("Acme")]);
  }

  expect(users.get(person.id)?.["enableTwoFactorAuth"]).toBe(true);
}

function personFor(requirement: Requirement): Person {
  if (requirement === Requirement.ServerSso) {
    // The only people who still sign in with a password while it does.
    serverRequiresSso = true;
    return newPerson({ isMasterAdmin: true });
  }

  return newPerson({ isMasterAdmin: false });
}

// The refusal the Dashboard shows in place of removing the last one.
function expectLastSecondStepRefusal(result: HttpResult): void {
  expect(result.status).toBe(400);
  expect(messageOf(result)).toBe(TWO_FACTOR_AUTH_LAST_METHOD_MESSAGE);
  // Never the Confirm It's You prompt, for a delete that cannot happen.
  expect(bodyOf(result)[REFUSAL_CODE_FIELD]).toBeUndefined();
}

beforeAll(async () => {
  const app: express.Express = express();
  app.use(CookieParser());
  app.use(express.json());
  app.use("/api", new UserAPI().getRouter());
  app.use("/api", new UserTotpAuthAPI().getRouter());
  app.use("/api", new UserWebAuthnAPI().getRouter());
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
  serverRequiresSso = false;

  /*
   * Every session here has confirmed it's its person's (#10155) unless a
   * test says otherwise; the spy says whether the check was asked at all.
   */
  confirmation = confirmEverySession();

  // The sessions these tokens name are live: what an ended one does is EndedSessionAccessToken.test.ts.
  treatEverySessionAsLive();
  jest
    .spyOn(UserService, "updateLastActive")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(GlobalConfigService, "getRequireSsoForLogin")
    .mockImplementation((async (): Promise<boolean> => {
      return serverRequiresSso;
    }) as never);
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  } as never);
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

  // In no project unless a test says: SSO manages nobody's sign-in.
  memberProjects = standInMemberProjects([]);

  // What requiring and resetting it also do: end sessions, void codes.
  jest
    .spyOn(UserSessionService, "revokeAllSessionsByUserId")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(UserTwoFactorBackupCodeService, "deleteAllForUser")
    .mockResolvedValue(undefined as never);
  jest.spyOn(TwoFactorWrongCodes, "forget").mockResolvedValue(undefined);

  users = useInMemoryTable(UserService, []);
  authenticatorApps = useInMemoryTable(UserTotpAuthService, []);
  keys = useInMemoryTable(UserWebAuthnService, []);

  admin = newPerson({ isMasterAdmin: true });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the last second step, while two-factor authentication is on", () => {
  const cases: Array<[Requirement, SecondStepKind]> = REQUIREMENTS.flatMap(
    (requirement: Requirement): Array<[Requirement, SecondStepKind]> => {
      return SECOND_STEP_KINDS.map(
        (kind: SecondStepKind): [Requirement, SecondStepKind] => {
          return [requirement, kind];
        },
      );
    },
  );

  test.each(cases)(
    "%s: the last %s is refused, with what to do, and stays",
    async (requirement: Requirement, kind: SecondStepKind) => {
      const person: Person = personFor(requirement);
      const secondStep: SecondStep = addSecondStep(person, kind);

      await requireTwoFactorAuth(person, requirement);
      confirmation.mockClear();

      expectLastSecondStepRefusal(await removeSecondStep(person, secondStep));

      expect(isStillThere(secondStep)).toBe(true);
      expect(authenticatorApps.deletes).toEqual([]);
      expect(keys.deletes).toEqual([]);
      // Nobody is asked to confirm for a delete that is refused anyway.
      expect(confirmation).not.toHaveBeenCalled();

      // The card still says Enabled over it, and the Dashboard keeps it locked.
      expect(await statusOf(person)).toEqual({
        status: TwoFactorAuthStatus.EnabledConfigured,
        verifiedMethodCount: 1,
      });
    },
  );

  test.each(REQUIREMENTS)(
    "%s: turning it off is always the owner's to do, and the last one then goes",
    async (requirement: Requirement) => {
      const person: Person = personFor(requirement);
      const secondStep: SecondStep = addSecondStep(
        person,
        SecondStepKind.AuthenticatorApp,
      );

      await requireTwoFactorAuth(person, requirement);

      expectLastSecondStepRefusal(await removeSecondStep(person, secondStep));

      // The advice the refusal gives can be followed, whoever required it.
      expect((await switchOwnTwoFactorAuth(person, false)).status).toBe(200);
      expect(users.get(person.id)?.["enableTwoFactorAuth"]).toBe(false);

      const removed: HttpResult = await removeSecondStep(person, secondStep);

      expect(removed.status).toBe(200);
      expect(isStillThere(secondStep)).toBe(false);
      expect(await statusOf(person)).toEqual({
        status: TwoFactorAuthStatus.NotEnabled,
        verifiedMethodCount: 0,
      });
    },
  );
});

describe("what may go while it is on", () => {
  test.each(SECOND_STEP_KINDS)(
    "a %s goes while another kind of second step stays, and the one left is then refused",
    async (kind: SecondStepKind) => {
      const person: Person = newPerson({ isMasterAdmin: false });
      const leaving: SecondStep = addSecondStep(person, kind);
      const staying: SecondStep = addSecondStep(
        person,
        kind === SecondStepKind.AuthenticatorApp
          ? SecondStepKind.Passkey
          : SecondStepKind.AuthenticatorApp,
      );

      await requireTwoFactorAuth(person, Requirement.OwnSetting);

      const removed: HttpResult = await removeSecondStep(person, leaving);

      expect(removed.status).toBe(200);
      expect(isStillThere(leaving)).toBe(false);
      expect(await statusOf(person)).toEqual({
        status: TwoFactorAuthStatus.EnabledConfigured,
        verifiedMethodCount: 1,
      });

      expectLastSecondStepRefusal(await removeSecondStep(person, staying));
      expect(isStillThere(staying)).toBe(true);
    },
  );

  test("however many second steps of whichever kinds, removed in any order, each goes until the last, which stays", async () => {
    const random: SeededRandom = seededRandom(6652);

    for (let round: number = 0; round < 12; round++) {
      const person: Person = newPerson({ isMasterAdmin: random(2) === 1 });
      const count: number = 2 + random(5);
      const secondSteps: Array<SecondStep> = [];

      for (let index: number = 0; index < count; index++) {
        secondSteps.push(
          addSecondStep(
            person,
            SECOND_STEP_KINDS[random(SECOND_STEP_KINDS.length)]!,
          ),
        );
      }

      // An unfinished app beside them counts for nothing.
      const unfinished: SecondStep = addSecondStep(
        person,
        SecondStepKind.AuthenticatorApp,
        { isVerified: false },
      );

      await requireTwoFactorAuth(
        person,
        random(2) === 1 ? Requirement.MasterAdmin : Requirement.OwnSetting,
      );

      const order: Array<SecondStep> = shuffled(secondSteps, random);

      for (const secondStep of order.slice(0, -1)) {
        expect({
          round,
          kind: secondStep.kind,
          status: (await removeSecondStep(person, secondStep)).status,
        }).toEqual({ round, kind: secondStep.kind, status: 200 });
      }

      const last: SecondStep = order[order.length - 1]!;

      expectLastSecondStepRefusal(await removeSecondStep(person, last));
      expect({
        round,
        kind: last.kind,
        isStillThere: isStillThere(last),
      }).toEqual({ round, kind: last.kind, isStillThere: true });
      expect(await statusOf(person)).toEqual({
        status: TwoFactorAuthStatus.EnabledConfigured,
        verifiedMethodCount: 1,
      });

      // And the unfinished app can still go: no sign-in could ask for it.
      expect((await removeSecondStep(person, unfinished)).status).toBe(200);
    }
  });

  test("an unfinished authenticator app goes even with nothing else set up, and nobody is asked to confirm for it", async () => {
    const person: Person = newPerson({ isMasterAdmin: false });
    const unfinished: SecondStep = addSecondStep(
      person,
      SecondStepKind.AuthenticatorApp,
      { isVerified: false },
    );

    // A master admin's requirement over nothing: Setup needed.
    await requireTwoFactorAuth(person, Requirement.MasterAdmin);
    confirmation.mockClear();

    expect(await statusOf(person)).toEqual({
      status: TwoFactorAuthStatus.EnabledPendingSetup,
      verifiedMethodCount: 0,
    });

    expect((await removeSecondStep(person, unfinished)).status).toBe(200);
    expect(isStillThere(unfinished)).toBe(false);
    expect(confirmation).not.toHaveBeenCalled();
  });

  test.each(SECOND_STEP_KINDS)(
    "with two-factor authentication off, the last %s goes, once the session has confirmed it's theirs",
    async (kind: SecondStepKind) => {
      const person: Person = newPerson({ isMasterAdmin: false });
      const secondStep: SecondStep = addSecondStep(person, kind);

      const removed: HttpResult = await removeSecondStep(person, secondStep);

      expect(removed.status).toBe(200);
      expect(isStillThere(secondStep)).toBe(false);
      expect(confirmation).toHaveBeenCalled();
    },
  );
});

describe("Confirm It's You (#10155)", () => {
  test("a session that has not confirmed is told why the last one stays, never asked to confirm for it", async () => {
    const person: Person = newPerson({ isMasterAdmin: false });
    const secondStep: SecondStep = addSecondStep(
      person,
      SecondStepKind.SecurityKey,
    );

    await requireTwoFactorAuth(person, Requirement.OwnSetting);

    // From here on, this session has not confirmed.
    confirmation.mockRejectedValue(new ReauthenticationRequiredException());

    expectLastSecondStepRefusal(await removeSecondStep(person, secondStep));
    expect(isStillThere(secondStep)).toBe(true);
  });

  test("one that may go waits for the session to confirm, and nothing is removed until it has", async () => {
    const person: Person = newPerson({ isMasterAdmin: false });
    const leaving: SecondStep = addSecondStep(person, SecondStepKind.Passkey);
    addSecondStep(person, SecondStepKind.AuthenticatorApp);

    await requireTwoFactorAuth(person, Requirement.OwnSetting);

    confirmation.mockRejectedValue(new ReauthenticationRequiredException());

    const refused: HttpResult = await removeSecondStep(person, leaving);

    expect(refused.status).toBe(400);
    expect(bodyOf(refused)[REFUSAL_CODE_FIELD]).toBe(
      REAUTHENTICATION_REQUIRED_REFUSAL_CODE,
    );
    expect(messageOf(refused)).toBe(
      REAUTHENTICATION_REQUIRED_MESSAGES[ReauthenticationPurpose.OwnSignIn],
    );
    expect(isStillThere(leaving)).toBe(true);

    // Confirmed: the same delete goes through.
    confirmation.mockResolvedValue(undefined);

    expect((await removeSecondStep(person, leaving)).status).toBe(200);
    expect(isStillThere(leaving)).toBe(false);
  });
});

describe("a master admin's Reset two-factor authentication, for a lost device", () => {
  test("removes every second step and keeps the requirement: Setup needed, never a lockout", async () => {
    const person: Person = newPerson({ isMasterAdmin: false });
    const secondSteps: Array<SecondStep> = SECOND_STEP_KINDS.map(
      (kind: SecondStepKind): SecondStep => {
        return addSecondStep(person, kind);
      },
    );

    await requireTwoFactorAuth(person, Requirement.MasterAdmin);

    const reset: HttpResult = await send({
      method: "POST",
      path: `/api/user/${person.id.toString()}/reset-two-factor-auth`,
      as: admin,
    });

    expect(reset.status).toBe(200);

    for (const secondStep of secondSteps) {
      expect({
        kind: secondStep.kind,
        isStillThere: isStillThere(secondStep),
      }).toEqual({ kind: secondStep.kind, isStillThere: false });
    }

    // Still required: their next sign-in walks them through setting one up.
    expect(users.get(person.id)?.["enableTwoFactorAuth"]).toBe(true);
    expect(await statusOf(person)).toEqual({
      status: TwoFactorAuthStatus.EnabledPendingSetup,
      verifiedMethodCount: 0,
    });
  });
});

describe("whose second steps are counted", () => {
  test("only the caller's own: another person's never keep the caller's last one company", async () => {
    const person: Person = newPerson({ isMasterAdmin: false });
    const someoneElse: Person = newPerson({ isMasterAdmin: false });
    const secondStep: SecondStep = addSecondStep(
      person,
      SecondStepKind.AuthenticatorApp,
    );

    for (const kind of SECOND_STEP_KINDS) {
      addSecondStep(someoneElse, kind);
    }

    await requireTwoFactorAuth(person, Requirement.OwnSetting);

    expectLastSecondStepRefusal(await removeSecondStep(person, secondStep));
    expect(isStillThere(secondStep)).toBe(true);
  });

  test("another person's last second step is not the caller's to remove, and stays", async () => {
    const person: Person = newPerson({ isMasterAdmin: false });
    const someoneElse: Person = newPerson({ isMasterAdmin: false });
    addSecondStep(person, SecondStepKind.AuthenticatorApp);
    addSecondStep(person, SecondStepKind.Passkey);
    const theirs: SecondStep = addSecondStep(
      someoneElse,
      SecondStepKind.SecurityKey,
    );

    await requireTwoFactorAuth(someoneElse, Requirement.OwnSetting);

    const result: HttpResult = await removeSecondStep(person, theirs);

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
    expect(isStillThere(theirs)).toBe(true);
  });
});
