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

// Billing on, as on OneUptime Cloud: the only place the balances are sold.
jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return { ...actual, IsBillingEnabled: true };
});

import AIBillingAPI from "../../../Server/API/AIBillingAPI";
import NotificationAPI from "../../../Server/API/NotificationAPI";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import AIBillingService from "../../../Server/Services/AIBillingService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import MarketplaceChargeService from "../../../Server/Services/MarketplaceChargeService";
import NotificationService from "../../../Server/Services/NotificationService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import CookieUtil from "../../../Server/Utils/Cookie";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import { getPaymentNotCompletedMessage } from "../../../Server/Utils/Billing/PaymentProviderRefusal";
import BadDataException from "../../../Types/Exception/BadDataException";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import CloudMarketplace from "../../../Types/Marketplace/CloudMarketplace";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { treatEverySessionAsLive } from "../TestingUtils/LiveSessions";
import {
  MessagingBalanceWorld,
  useMessagingBalanceWorld,
} from "../TestingUtils/MessagingBalanceWorld";
import {
  AiCreditsWorld,
  useAiCreditsWorld,
} from "../TestingUtils/AiCreditsWorld";
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

// jsdom has no setImmediate, and Express needs it.
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * ADD TO BALANCE BY HAND, OVER HTTP, WHEN IT FAILS (#11052).
 *
 * The Dashboard's Add to Balance - Project Settings > Notification Settings
 * and the on-call guided setup (POST /notification/recharge), AI Credits
 * (POST /ai/recharge) - runs here as the browser sends it: a signed session
 * cookie, a JSON body with the amount and the project, through Express's
 * body parser, the real request middleware (getUserMiddleware, which works
 * out who is asking and what they may do in the project, then
 * requireUserAuthentication), the route's own permission check, the real
 * recharge services, and the error handler the server answers with.
 * Stubbed: the session and permission lookups the middleware makes, and the
 * project, the payment provider and the shared cache, held in memory
 * (MessagingBalanceWorld, AiCreditsWorld).
 *
 * When the charge fails - no payment method, a declined card, a
 * marketplace subscription that is not active - the person who pressed Add
 * to Balance is answered with why, in words the dialog shows as they are:
 * a 400 with the sentence. No owner of the project is emailed about it: the
 * email said "We have tried to recharge your ... balance and failed", as if
 * OneUptime had tried on its own. And the day's notice window is left to
 * Auto Recharge, so its own failure still reaches the owners.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11052000-0000-4000-8000-0000000000a1",
);
const OWNER_ID: ObjectID = new ObjectID("11052000-0000-4000-8000-0000000000b1");
const MEMBER_ID: ObjectID = new ObjectID(
  "11052000-0000-4000-8000-0000000000b2",
);

const NO_PAYMENT_METHOD_MESSAGE: string =
  "No payment methods found for the project. Please add a payment method in Project Settings to continue.";
const INACTIVE_MESSAGE: string =
  "This project is billed through AWS Marketplace, and its subscription there is not active. Resolve it on AWS Marketplace, then try again.";

// What each person may do in the project, as the middleware works it out.
const PROJECT_PERMISSIONS: Map<string, Array<Permission>> = new Map<
  string,
  Array<Permission>
>([
  [OWNER_ID.toString(), [Permission.ProjectOwner]],
  [MEMBER_ID.toString(), [Permission.ProjectMember]],
]);

let server: http.Server | null = null;
let port: number = 0;

function sessionOf(userId: ObjectID): string {
  return JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: userId,
      email: new Email(`${userId.toString()}@example.com`),
      name: new Name("Someone"),
      timezone: null,
      isMasterAdmin: false,
      isGlobalLogin: true,
      sessionId: ObjectID.generate(),
    },
    expiresInSeconds: 15 * 60,
  });
}

interface HttpResult {
  status: number;
  body: JSONObject;
}

/*
 * What the Dashboard sends: the session cookie, and the amount with the
 * project as its API client writes it (an ObjectID's JSON).
 */
function addToBalance(data: {
  path: "/notification/recharge" | "/ai/recharge";
  as: ObjectID;
  amountInUSD: number;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string = JSON.stringify({
        amount: data.amountInUSD,
        projectId: PROJECT_ID,
      });

      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          path: "/api" + data.path,
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
            cookie: `${CookieUtil.getUserTokenKey()}=${sessionOf(data.as)}`,
          },
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            const text: string = Buffer.concat(chunks).toString("utf8");
            let body: JSONObject = {};

            try {
              body = text ? (JSON.parse(text) as JSONObject) : {};
            } catch {
              body = { raw: text };
            }

            resolve({ status: response.statusCode || 0, body });
          });
        },
      );

      request.on("error", reject);
      request.write(payload);
      request.end();
    },
  );
}

// What the server answered in words: the error handler's `error`, or a route's `message`.
function answerWords(result: HttpResult): string {
  return String(result.body["error"] || result.body["message"] || "");
}

// A declined card, as the payment provider's SDK throws it.
function cardDeclined(message: string): Error {
  return Object.assign(new Error(message), {
    type: "StripeCardError",
    code: "card_declined",
  });
}

beforeAll(async () => {
  const app: express.Express = express();
  app.use(CookieParser());
  app.use(express.json());
  app.use("/api", NotificationAPI);
  app.use("/api", AIBillingAPI);
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
  // The session, as the middleware reads it.
  jest
    .spyOn(UserService, "updateLastActive")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectService, "updateLastActive")
    .mockResolvedValue(undefined as never);
  jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(false as never);
  treatEverySessionAsLive();
  jest
    .spyOn(UserService, "isUserMasterAdmin")
    .mockResolvedValue(false as never);

  // The project: not blocked, no sign-in rules of its own.
  jest
    .spyOn(ProjectService, "isProjectBlocked")
    .mockResolvedValue(false as never);
  jest
    .spyOn(ProjectService, "getRequireSsoForLogin")
    .mockResolvedValue(false as never);
  jest
    .spyOn(ProjectService, "getRequireSsoWithSsoProviderId")
    .mockResolvedValue(null as never);
  jest
    .spyOn(GlobalConfigService, "getRequireSsoForLogin")
    .mockResolvedValue(false as never);
  jest
    .spyOn(TeamMemberService, "getTeamIdsForUser")
    .mockResolvedValue([] as never);

  // Who may do what in the project.
  jest
    .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
    .mockImplementation((async (
      userId: ObjectID,
    ): Promise<UserGlobalAccessPermission> => {
      return {
        _type: "UserGlobalAccessPermission",
        projectIds: PROJECT_PERMISSIONS.has(userId.toString())
          ? [PROJECT_ID]
          : [],
        globalPermissions: [Permission.Public, Permission.User],
      };
    }) as never);
  jest
    .spyOn(AccessTokenService, "getUserTenantAccessPermission")
    .mockImplementation((async (
      userId: ObjectID,
      projectId: ObjectID,
    ): Promise<UserTenantAccessPermission | null> => {
      const permissions: Array<Permission> | undefined =
        PROJECT_PERMISSIONS.get(userId.toString());

      if (!permissions || projectId.toString() !== PROJECT_ID.toString()) {
        return null;
      }

      return {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map((permission: Permission) => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          };
        }),
      };
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /notification/recharge (the SMS and call balance) that fails", () => {
  let world: MessagingBalanceWorld;

  beforeEach(() => {
    world = useMessagingBalanceWorld(PROJECT_ID, {
      smsOrCallCurrentBalanceInUSDCents: 0,
      enableAutoRechargeSmsOrCallBalance: true,
      autoRechargeSmsOrCallByBalanceInUSD: 20,
      autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10,
    });
  });

  test("no payment method: 400 with why, nothing charged, and no owner emailed", async () => {
    world.setHasPaymentMethods(false);

    const result: HttpResult = await addToBalance({
      path: "/notification/recharge",
      as: OWNER_ID,
      amountInUSD: 25,
    });

    expect(result.status).toBe(400);
    expect(answerWords(result)).toBe(NO_PAYMENT_METHOD_MESSAGE);
    expect(world.charges).toEqual([]);
    expect(world.ownerEmails).toEqual([]);
    expect(
      world.row.failedCallAndSMSBalanceChargeNotificationSentToOwners,
    ).toBe(false);
    expect(world.row.smsOrCallCurrentBalanceInUSDCents).toBe(0);
  });

  test("a declined card: 400 in the payment provider's words, with where to update the payment method, and no owner emailed", async () => {
    world.failChargesWith(cardDeclined("Your card was declined."));

    const result: HttpResult = await addToBalance({
      path: "/notification/recharge",
      as: OWNER_ID,
      amountInUSD: 25,
    });

    expect(result.status).toBe(400);
    expect(answerWords(result)).toBe(
      "Your payment could not be completed: Your card was declined. Please update your payment method in Project Settings > Billing and Invoices > Billing and try again.",
    );
    expect(world.ownerEmails).toEqual([]);
    expect(world.row.smsOrCallCurrentBalanceInUSDCents).toBe(0);
  });

  test("a marketplace subscription that is not active: 400 with what to put right there, and no owner emailed", async () => {
    world.row["billingMarketplace"] = CloudMarketplace.AWS;
    jest
      .spyOn(MarketplaceChargeService, "recordBalanceRecharge")
      .mockRejectedValue(new BadDataException(INACTIVE_MESSAGE));

    const result: HttpResult = await addToBalance({
      path: "/notification/recharge",
      as: OWNER_ID,
      amountInUSD: 25,
    });

    expect(result.status).toBe(400);
    expect(answerWords(result)).toBe(INACTIVE_MESSAGE);
    expect(world.charges).toEqual([]);
    expect(world.ownerEmails).toEqual([]);
  });

  test("any amount the route takes, failing either way, emails no owner", async () => {
    const random: SeededRandom = seededRandom(110521);

    for (let attempt: number = 0; attempt < 12; attempt++) {
      const amountInUSD: number = 20 + random(981);
      const hasPaymentMethod: boolean = random(2) === 0;

      world.setHasPaymentMethods(hasPaymentMethod);
      world.failChargesWith(
        hasPaymentMethod ? cardDeclined("Your card has expired.") : null,
      );

      const result: HttpResult = await addToBalance({
        path: "/notification/recharge",
        as: OWNER_ID,
        amountInUSD: amountInUSD,
      });

      expect(result.status).toBe(400);
      expect(answerWords(result)).toBe(
        hasPaymentMethod
          ? getPaymentNotCompletedMessage("Your card has expired.")
          : NO_PAYMENT_METHOD_MESSAGE,
      );
    }

    expect(world.ownerEmails).toEqual([]);
    expect(world.charges).toEqual([]);
  });

  test("Auto Recharge failing right after still tells the owners: the day's window was left to it", async () => {
    world.setHasPaymentMethods(false);

    const result: HttpResult = await addToBalance({
      path: "/notification/recharge",
      as: OWNER_ID,
      amountInUSD: 25,
    });

    expect(result.status).toBe(400);
    expect(world.ownerEmails).toEqual([]);

    // The next SMS finds the balance low, and Auto Recharge cannot charge.
    await expect(
      NotificationService.rechargeIfBalanceIsLow(PROJECT_ID),
    ).rejects.toThrow(NO_PAYMENT_METHOD_MESSAGE);

    expect(
      world.ownerEmails.map((email: { subject: string }) => {
        return email.subject;
      }),
    ).toEqual([
      "ACTION REQUIRED: SMS and Call Recharge Failed for project - Acme Production",
    ]);
  });

  test("with a card that works nothing changes: 200, the balance added and the owners' confirmation sent", async () => {
    const result: HttpResult = await addToBalance({
      path: "/notification/recharge",
      as: OWNER_ID,
      amountInUSD: 25,
    });

    expect(result.status).toBe(200);
    expect(world.charges).toEqual([25]);
    expect(world.row.smsOrCallCurrentBalanceInUSDCents).toBe(2500);
    expect(
      world.ownerEmails.map((email: { subject: string }) => {
        return email.subject;
      }),
    ).toEqual([
      "SMS and Call Recharge Successful for project - Acme Production",
    ]);
  });

  test("someone without Manage Billing is refused before anything is tried, and nobody is emailed", async () => {
    const result: HttpResult = await addToBalance({
      path: "/notification/recharge",
      as: MEMBER_ID,
      amountInUSD: 25,
    });

    expect(result.status).toBe(400);
    expect(answerWords(result)).toContain(
      "User does not have permission to recharge.",
    );
    expect(world.charges).toEqual([]);
    expect(world.ownerEmails).toEqual([]);
  });
});

describe("POST /ai/recharge (AI credits) that fails", () => {
  let world: AiCreditsWorld;

  beforeEach(() => {
    world = useAiCreditsWorld(PROJECT_ID, {
      aiCurrentBalanceInUSDCents: 0,
      enableAutoRechargeAiBalance: true,
      autoAiRechargeByBalanceInUSD: 20,
      autoRechargeAiWhenCurrentBalanceFallsInUSD: 10,
    });
  });

  test("no payment method: 400 with why, nothing charged, and no owner emailed", async () => {
    world.setHasPaymentMethods(false);

    const result: HttpResult = await addToBalance({
      path: "/ai/recharge",
      as: OWNER_ID,
      amountInUSD: 30,
    });

    expect(result.status).toBe(400);
    expect(answerWords(result)).toBe(NO_PAYMENT_METHOD_MESSAGE);
    expect(world.charges).toEqual([]);
    expect(world.ownerEmails).toEqual([]);
    expect(world.row.failedAiBalanceChargeNotificationSentToOwners).toBe(false);
    expect(world.row.aiCurrentBalanceInUSDCents).toBe(0);
  });

  test("a declined card: 400 in the payment provider's words, and no owner emailed", async () => {
    world.failChargesWith(cardDeclined("Your card has insufficient funds."));

    const result: HttpResult = await addToBalance({
      path: "/ai/recharge",
      as: OWNER_ID,
      amountInUSD: 30,
    });

    expect(result.status).toBe(400);
    expect(answerWords(result)).toBe(
      getPaymentNotCompletedMessage("Your card has insufficient funds."),
    );
    expect(world.ownerEmails).toEqual([]);
    expect(world.row.aiCurrentBalanceInUSDCents).toBe(0);
  });

  test("a marketplace subscription that is not active: 400 with what to put right there, and no owner emailed", async () => {
    world.row["billingMarketplace"] = CloudMarketplace.AWS;
    jest
      .spyOn(MarketplaceChargeService, "recordBalanceRecharge")
      .mockRejectedValue(new BadDataException(INACTIVE_MESSAGE));

    const result: HttpResult = await addToBalance({
      path: "/ai/recharge",
      as: OWNER_ID,
      amountInUSD: 30,
    });

    expect(result.status).toBe(400);
    expect(answerWords(result)).toBe(INACTIVE_MESSAGE);
    expect(world.ownerEmails).toEqual([]);
  });

  test("Auto Recharge failing right after still tells the owners: the day's window was left to it", async () => {
    world.failChargesWith(new Error("Your card was declined."));

    const result: HttpResult = await addToBalance({
      path: "/ai/recharge",
      as: OWNER_ID,
      amountInUSD: 30,
    });

    expect(result.status).toBe(500);
    expect(world.ownerEmails).toEqual([]);

    await expect(
      AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID),
    ).rejects.toThrow("Your card was declined.");

    expect(
      world.ownerEmails.map((email: { subject: string }) => {
        return email.subject;
      }),
    ).toEqual([
      "ACTION REQUIRED: AI Balance Recharge Failed for project - Acme Production",
    ]);
  });

  test("with a card that works nothing changes: 200, the credits added and the owners' confirmation sent", async () => {
    const result: HttpResult = await addToBalance({
      path: "/ai/recharge",
      as: OWNER_ID,
      amountInUSD: 30,
    });

    expect(result.status).toBe(200);
    expect(world.charges).toEqual([30]);
    expect(world.row.aiCurrentBalanceInUSDCents).toBe(3000);
    expect(
      world.ownerEmails.map((email: { subject: string }) => {
        return email.subject;
      }),
    ).toEqual(["AI Balance Recharge Successful for project - Acme Production"]);
  });
});
