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

/*
 * Billing on, as on OneUptime Cloud: the only place the balances are sold.
 * The operator's Slack channel is a webhook the world catches.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return {
    ...actual,
    IsBillingEnabled: true,
    NotificationSlackWebhookOnCreateProject: "",
    NotificationSlackWebhookOnSubscriptionUpdate:
      "https://hooks.slack.com/services/T000/B000/auto-recharge-save-over-http",
  };
});

import ProjectAPI from "../../../Server/API/ProjectAPI";
import Redis from "../../../Server/Infrastructure/Redis";
import AIBillingService from "../../../Server/Services/AIBillingService";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import ApiKeyPermissionService, {
  ApiKeyPermissionRow,
} from "../../../Server/Services/ApiKeyPermissionService";
import ApiKeyService, {
  ResolvedApiKey,
} from "../../../Server/Services/ApiKeyService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import NotificationService from "../../../Server/Services/NotificationService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import PlanCutoffCredentialAccess from "../../../Server/Utils/Billing/PlanCutoffCredentialAccess";
import { getPaymentNotCompletedMessage } from "../../../Server/Utils/Billing/PaymentProviderRefusal";
import CookieUtil from "../../../Server/Utils/Cookie";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import ProjectBalanceType from "../../../Types/Billing/ProjectBalanceType";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
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
import {
  AutoRechargeSaveWorld,
  useAutoRechargeSaveWorld,
} from "../TestingUtils/AutoRechargeSaveWorld";
import { treatEverySessionAsLive } from "../TestingUtils/LiveSessions";
import {
  flushBackgroundWork,
  shownLines,
} from "../TestingUtils/SlackWebhookMessages";
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
 * SAVING AUTO RECHARGE, OVER HTTP, WHEN THE CARD CANNOT BE CHARGED (#11090).
 *
 * Auto Recharge is saved through the project's update route,
 * PUT /api/project/:id, by everyone who can set it:
 *
 *   - the Dashboard's Edit Auto Recharge, on Project Settings >
 *     Notifications > Notification Channels and on AI > AI Credits - a
 *     signed session cookie and the project's tenantid header;
 *   - the API and Terraform - a project API key in the apikey header.
 *
 * (The MCP server has no tool that updates a project, so it cannot.)
 *
 * Each request here goes as they send it, through Express's body parser, the
 * real request middleware (getUserMiddleware: the session or the API key,
 * and what its holder may do in the project), the real ProjectAPI router,
 * BaseAPI's update, ProjectService.updateOneById with its permission checks
 * and hooks, the real recharge services, and the error handler the server
 * answers with. Stubbed: the session, key and permission lookups the
 * middleware makes, and what the world holds in memory - the project, the
 * payment provider, the shared cache, the owners' emails
 * (TestingUtils/AutoRechargeSaveWorld).
 *
 * Saving Auto Recharge on while the balance is below its threshold tries
 * the card at once. When that fails - a declined card, no payment method, a
 * marketplace subscription that is not active - the save is answered 400
 * with why, in words the dialog, the API and Terraform show as they are,
 * and Auto Recharge stays as it was. No owner is emailed about it, the
 * day's owner-notice window is left to Auto Recharge's own failures, and
 * Auto Recharge does not wait an hour for it. A card that works is charged
 * once, with the amount saved, as before.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11090000-0000-4000-8000-0000000000c1",
);
const OWNER_ID: ObjectID = new ObjectID("11090000-0000-4000-8000-0000000000d1");
const BILLING_MANAGER_ID: ObjectID = new ObjectID(
  "11090000-0000-4000-8000-0000000000d2",
);
const PROJECT_ADMIN_ID: ObjectID = new ObjectID(
  "11090000-0000-4000-8000-0000000000d3",
);

// The project's API key, as Terraform and scripts call with it.
const API_KEY_ID: ObjectID = new ObjectID(
  "11090000-0000-4000-8000-0000000000e1",
);
const API_KEY_SECRET: string = "11090000-0000-4000-8000-0000000000f1";

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
  [BILLING_MANAGER_ID.toString(), [Permission.ManageProjectBilling]],
  [PROJECT_ADMIN_ID.toString(), [Permission.ProjectAdmin]],
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

// Who saves Auto Recharge, and the headers they send it with.
interface Caller {
  name: string;
  headers: () => http.OutgoingHttpHeaders;
}

// The Dashboard: the person's session, in the project they have open.
function dashboardOf(userId: ObjectID): http.OutgoingHttpHeaders {
  return {
    cookie: `${CookieUtil.getUserTokenKey()}=${sessionOf(userId)}`,
    tenantid: PROJECT_ID.toString(),
  };
}

const CALLERS: Array<Caller> = [
  {
    name: "the Dashboard, as a Project Owner",
    headers: (): http.OutgoingHttpHeaders => {
      return dashboardOf(OWNER_ID);
    },
  },
  {
    name: "the Dashboard, as someone with Manage Billing",
    headers: (): http.OutgoingHttpHeaders => {
      return dashboardOf(BILLING_MANAGER_ID);
    },
  },
  {
    name: "the API and Terraform, with a project API key",
    headers: (): http.OutgoingHttpHeaders => {
      return { apikey: API_KEY_SECRET, tenantid: PROJECT_ID.toString() };
    },
  },
];

const AS_OWNER: Caller = CALLERS[0]!;

interface HttpResult {
  status: number;
  body: JSONObject;
}

/*
 * What Edit Auto Recharge sends - the project's update, its columns under
 * "data" - and what the API and Terraform send alike.
 */
function saveAutoRecharge(data: {
  caller: Caller;
  values: JSONObject;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string = JSON.stringify({
        data: data.values,
        miscDataProps: {},
      });

      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          path: `/api/project/${PROJECT_ID.toString()}`,
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
            ...data.caller.headers(),
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

interface BalanceUnderTest {
  name: string;
  balance: ProjectBalanceType;
  balanceColumn: string;
  enableColumn: string;
  amountColumn: string;
  thresholdColumn: string;
  failedFlagColumn: string;
  failedSubject: string;
  // Auto Recharge's own try: a message, or an AI call, finds the balance low.
  autoRechargeOwnTry: () => Promise<number>;
}

const BALANCES: Array<BalanceUnderTest> = [
  {
    name: "the SMS and call balance (Notification Channels)",
    balance: ProjectBalanceType.SmsOrCall,
    balanceColumn: "smsOrCallCurrentBalanceInUSDCents",
    enableColumn: "enableAutoRechargeSmsOrCallBalance",
    amountColumn: "autoRechargeSmsOrCallByBalanceInUSD",
    thresholdColumn: "autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD",
    failedFlagColumn: "failedCallAndSMSBalanceChargeNotificationSentToOwners",
    failedSubject:
      "ACTION REQUIRED: SMS and Call Recharge Failed for project - Acme Production",
    autoRechargeOwnTry: (): Promise<number> => {
      return NotificationService.rechargeIfBalanceIsLow(PROJECT_ID);
    },
  },
  {
    name: "the AI credits (AI Credits)",
    balance: ProjectBalanceType.AI,
    balanceColumn: "aiCurrentBalanceInUSDCents",
    enableColumn: "enableAutoRechargeAiBalance",
    amountColumn: "autoAiRechargeByBalanceInUSD",
    thresholdColumn: "autoRechargeAiWhenCurrentBalanceFallsInUSD",
    failedFlagColumn: "failedAiBalanceChargeNotificationSentToOwners",
    failedSubject:
      "ACTION REQUIRED: AI Balance Recharge Failed for project - Acme Production",
    autoRechargeOwnTry: (): Promise<number> => {
      return AIBillingService.rechargeIfBalanceIsLow(PROJECT_ID);
    },
  },
];

beforeAll(async () => {
  const app: express.Express = express();
  app.use(CookieParser());
  app.use(express.json());
  app.use("/api", new ProjectAPI().getRouter());
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

  // The project: not blocked, no sign-in rules of its own, on the highest plan.
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
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  } as never);
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
        permissions: [Permission.ProjectUser, ...permissions].map(
          (permission: Permission) => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          },
        ),
      };
    }) as never);

  // The project's API key, which holds Project Owner, on a plan that sells keys.
  jest.spyOn(ApiKeyService, "findApiKey").mockImplementation((async (
    secret: ObjectID,
  ): Promise<ResolvedApiKey | null> => {
    return secret.toString().toLowerCase() === API_KEY_SECRET
      ? { id: API_KEY_ID, projectId: PROJECT_ID, name: "Terraform" }
      : null;
  }) as never);
  jest
    .spyOn(PlanCutoffCredentialAccess, "getRefusal")
    .mockResolvedValue(null as never);
  jest
    .spyOn(ApiKeyPermissionService, "findPermissionsByApiKeyId")
    .mockImplementation((async (
      apiKeyId: ObjectID,
    ): Promise<Array<ApiKeyPermissionRow>> => {
      return apiKeyId.toString() === API_KEY_ID.toString()
        ? [
            {
              permission: Permission.ProjectOwner,
              labelIds: [],
              isBlockPermission: false,
            },
          ]
        : [];
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  (Redis.getClient as unknown as ReturnType<typeof jest.fn>).mockReturnValue(
    null,
  );
  (Redis.isConnected as unknown as ReturnType<typeof jest.fn>).mockReturnValue(
    false,
  );
});

describe.each(BALANCES)(
  "PUT /api/project/:id saving Auto Recharge of $name",
  (balance: BalanceUnderTest) => {
    // The columns Edit Auto Recharge saves: on, how much to add, and when.
    function autoRechargeOn(data: {
      rechargeByInUSD: number;
      whenBalanceFallsToInUSD: number;
    }): JSONObject {
      return {
        [balance.enableColumn]: true,
        [balance.amountColumn]: data.rechargeByInUSD,
        [balance.thresholdColumn]: data.whenBalanceFallsToInUSD,
      };
    }

    // A project whose balance is 1 USD, with Auto Recharge off unless a test says otherwise.
    function setUp(values: JSONObject = {}): AutoRechargeSaveWorld {
      return useAutoRechargeSaveWorld(PROJECT_ID, {
        [balance.balanceColumn]: 100,
        ...values,
      });
    }

    // Nobody but the caller heard of the failure, and nothing waits for it.
    function expectNobodyElseTold(world: AutoRechargeSaveWorld): void {
      expect(world.ownerEmails).toEqual([]);
      expect(world.row()[balance.failedFlagColumn]).toBe(false);
      expect(world.noticeWindowsClaimed()).toEqual([]);
      expect(world.isAutoRechargeWaiting(balance.balance)).toBe(false);
    }

    test.each(CALLERS)(
      "$name: a declined card answers 400 in the payment provider's words, Auto Recharge stays off, and no owner is emailed",
      async (caller: Caller) => {
        const world: AutoRechargeSaveWorld = setUp();
        world.failChargesWith(cardDeclined("Your card was declined."));

        const result: HttpResult = await saveAutoRecharge({
          caller: caller,
          values: autoRechargeOn({
            rechargeByInUSD: 20,
            whenBalanceFallsToInUSD: 10,
          }),
        });

        expectNobodyElseTold(world);

        expect(result.status).toBe(400);
        expect(answerWords(result)).toBe(
          "Your payment could not be completed: Your card was declined. Please update your payment method in Project Settings > Billing and Invoices > Billing and try again.",
        );

        // Tried once, with the amount saved; nothing charged, nothing written.
        expect(world.chargesAsked).toEqual([20]);
        expect(world.charges).toEqual([]);
        expect(world.row()[balance.enableColumn]).toBe(false);
        expect(world.row()[balance.balanceColumn]).toBe(100);
        expect(world.projects.updates).toEqual([]);
      },
    );

    test("no payment method: 400 with why, nothing charged, and no owner emailed", async () => {
      const world: AutoRechargeSaveWorld = setUp();
      world.setHasPaymentMethods(false);

      const result: HttpResult = await saveAutoRecharge({
        caller: AS_OWNER,
        values: autoRechargeOn({
          rechargeByInUSD: 20,
          whenBalanceFallsToInUSD: 10,
        }),
      });

      expectNobodyElseTold(world);

      expect(result.status).toBe(400);
      expect(answerWords(result)).toBe(NO_PAYMENT_METHOD_MESSAGE);
      expect(world.chargesAsked).toEqual([]);
      expect(world.row()[balance.enableColumn]).toBe(false);
    });

    test("a cloud marketplace subscription that is not active: 400 with what to put right there, and no owner emailed", async () => {
      const world: AutoRechargeSaveWorld = setUp({
        billingMarketplace: CloudMarketplace.AWS,
      });
      world.refuseMarketplaceTopUpsWith(new BadDataException(INACTIVE_MESSAGE));

      const result: HttpResult = await saveAutoRecharge({
        caller: AS_OWNER,
        values: autoRechargeOn({
          rechargeByInUSD: 20,
          whenBalanceFallsToInUSD: 10,
        }),
      });

      expectNobodyElseTold(world);

      expect(result.status).toBe(400);
      expect(answerWords(result)).toBe(INACTIVE_MESSAGE);
      expect(world.chargesAsked).toEqual([]);
      expect(world.marketplaceTopUps).toEqual([]);
      expect(world.row()[balance.enableColumn]).toBe(false);
    });

    test("any amounts the API takes, saved by any caller and failing either way: 400 every time, and no owner emailed", async () => {
      const random: SeededRandom = seededRandom(
        balance.balance === ProjectBalanceType.AI ? 110904 : 110903,
      );
      const world: AutoRechargeSaveWorld = setUp();
      const amountsTried: Array<number> = [];

      for (let attempt: number = 0; attempt < 12; attempt++) {
        const rechargeByInUSD: number = 20 + random(981);
        const whenBalanceFallsToInUSD: number = 10 + random(991);
        const balanceInUSDCents: number = random(whenBalanceFallsToInUSD * 100);
        const hasPaymentMethod: boolean = random(2) === 0;
        const caller: Caller = CALLERS[random(CALLERS.length)]!;

        world.row()[balance.balanceColumn] = balanceInUSDCents;
        world.setHasPaymentMethods(hasPaymentMethod);
        world.failChargesWith(
          hasPaymentMethod ? cardDeclined("Your card has expired.") : null,
        );

        const result: HttpResult = await saveAutoRecharge({
          caller: caller,
          values: autoRechargeOn({ rechargeByInUSD, whenBalanceFallsToInUSD }),
        });

        expect(world.ownerEmails).toEqual([]);
        expect(`${caller.name}: ${result.status} ${answerWords(result)}`).toBe(
          `${caller.name}: 400 ${
            hasPaymentMethod
              ? getPaymentNotCompletedMessage("Your card has expired.")
              : NO_PAYMENT_METHOD_MESSAGE
          }`,
        );

        if (hasPaymentMethod) {
          amountsTried.push(rechargeByInUSD);
        }

        expect(world.row()[balance.enableColumn]).toBe(false);
        expect(world.row()[balance.balanceColumn]).toBe(balanceInUSDCents);
      }

      expect(world.chargesAsked).toEqual(amountsTried);
      expect(world.charges).toEqual([]);
      expect(world.projects.updates).toEqual([]);
      expectNobodyElseTold(world);
    });

    test("Auto Recharge's own failure right after still emails the owners, once: the day's window and the hour were left to it", async () => {
      // Auto Recharge is on, adding 20 USD below 10 USD; the owner saves new amounts.
      const world: AutoRechargeSaveWorld = setUp({
        [balance.enableColumn]: true,
      });
      world.setHasPaymentMethods(false);

      const result: HttpResult = await saveAutoRecharge({
        caller: AS_OWNER,
        values: autoRechargeOn({
          rechargeByInUSD: 50,
          whenBalanceFallsToInUSD: 25,
        }),
      });

      expect(result.status).toBe(400);
      expectNobodyElseTold(world);

      // The next message or AI call finds the balance low, and Auto Recharge cannot charge.
      await expect(balance.autoRechargeOwnTry()).rejects.toThrow(
        NO_PAYMENT_METHOD_MESSAGE,
      );

      expect(
        world.ownerEmails.map((email: { subject: string }) => {
          return email.subject;
        }),
      ).toEqual([balance.failedSubject]);
      expect(world.ownerEmails[0]!.body).toContain(
        "We could not find a payment method for the project.",
      );
      expect(world.isAutoRechargeWaiting(balance.balance)).toBe(true);

      // More of the storm: Auto Recharge waits its hour, and nobody is emailed again.
      await balance.autoRechargeOwnTry();
      expect(world.ownerEmails).toHaveLength(1);
    });

    test.each(CALLERS)(
      "$name: a card that works answers 200, charges the amount saved once, turns Auto Recharge on, and emails no owner, as before",
      async (caller: Caller) => {
        const world: AutoRechargeSaveWorld = setUp();

        const result: HttpResult = await saveAutoRecharge({
          caller: caller,
          values: autoRechargeOn({
            rechargeByInUSD: 50,
            whenBalanceFallsToInUSD: 25,
          }),
        });
        await flushBackgroundWork();

        expect(result.status).toBe(200);
        expect(world.charges).toEqual([50]);
        expect(world.row()[balance.balanceColumn]).toBe(5100);
        expect(world.row()[balance.enableColumn]).toBe(true);
        expect(world.row()[balance.amountColumn]).toBe(50);
        expect(world.row()[balance.thresholdColumn]).toBe(25);
        expect(world.ownerEmails).toEqual([]);

        // The operator's channel hears of it as the caller's own charge.
        expect(world.slack.messages).toHaveLength(1);
        expect(shownLines(world.slack.messages[0]?.text)).toContain(
          "*Recharge Type:* Manual",
        );
      },
    );

    test("a Project Admin, who may not change billing, is refused before anything is tried, and nobody is emailed", async () => {
      const world: AutoRechargeSaveWorld = setUp();
      world.setHasPaymentMethods(false);

      const result: HttpResult = await saveAutoRecharge({
        caller: {
          name: "the Dashboard, as a Project Admin",
          headers: (): http.OutgoingHttpHeaders => {
            return dashboardOf(PROJECT_ADMIN_ID);
          },
        },
        values: autoRechargeOn({
          rechargeByInUSD: 20,
          whenBalanceFallsToInUSD: 10,
        }),
      });

      expect(result.status).toBe(400);
      expect(answerWords(result)).toBe(
        `User is not allowed to update on ${balance.enableColumn} column of Project. You need one of these permissions: Project Owner, Manage Billing.`,
      );
      expect(world.chargesAsked).toEqual([]);
      expectNobodyElseTold(world);
    });
  },
);
