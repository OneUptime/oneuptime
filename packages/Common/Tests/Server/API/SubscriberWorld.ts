import { mockRouter } from "./Helpers";
import { customDomainCaller } from "./CustomDomainCallers";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import StatusPageSubscriberAPI from "../../../Server/API/StatusPageSubscriberAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import Redis from "../../../Server/Infrastructure/Redis";
import MailService from "../../../Server/Services/MailService";
import ProjectService from "../../../Server/Services/ProjectService";
import SmsService from "../../../Server/Services/SmsService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "../../../Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import SSRFProtection from "../../../Server/Utils/SSRFProtection";
import StatusPageSubscriberWebhookUtil from "../../../Server/Utils/StatusPageSubscriberWebhook";
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import FakeCounterRedis from "../TestingUtils/Redis/FakeCounterRedis";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { LimitTransactions } from "../TestingUtils/LimitTransactionsInMemory";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { useInMemorySubscriberCreates } from "../TestingUtils/SubscriberCreatesInMemory";
import { jest } from "@jest/globals";

/*
 * A STATUS PAGE'S SUBSCRIBERS, END TO END, FOR A SUITE.
 *
 * The routes a visitor signs up, confirms and asks for a manage link with
 * (StatusPageAPI), and the ones the team adds, changes and removes
 * subscribers with (StatusPageSubscriberAPI's CRUD), driven as their callers
 * drive them: the real routes, the real subscriber service - its hooks, its
 * checks, the transaction its INSERT is decided in and its messages - and
 * the real permission layer for the team, with the tables held in memory, a
 * counter store that counts as Redis does, and every sender recorded rather
 * than called.
 *
 * A suite mocks Express (getRouter), Response, Logger and Redis itself, as
 * StatusPageSubscriberMessageLimits.test.ts does, registers the routes once
 * (registerSubscriberRoutes) and sets the world up before each test.
 */

type MockedFn = ReturnType<typeof jest.fn>;

export const WORLD_PROJECT_ID: string = "61000000-0000-4000-8000-000000000001";

// Page `index` of the project's public status pages.
export function pageIdOf(index: number): string {
  return `61000000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`;
}

export const WORLD_PAGE_ID: string = pageIdOf(0);
export const WORLD_PAGE_COUNT: number = 15;

export const SUBSCRIBE_ROUTE: string = "/status-page/subscribe/:statusPageId";
export const CONFIRM_ROUTE: string =
  "/status-page/confirm-subscription/:statusPageSubscriberId";
export const MANAGE_ROUTE: string =
  "/status-page/manage-subscription/:statusPageId";
export const TEAM_CREATE_ROUTE: string = "/status-page-subscriber";
export const TEAM_ITEM_ROUTE: string = "/status-page-subscriber/:id";

export interface Answer {
  error: Exception | undefined;
  retryAfter: string | undefined;
}

export interface SubscriberWorld {
  redis: FakeCounterRedis;
  subscribers: InMemoryTable;
  transactions: LimitTransactions;
  texts: MockedFn;
  emails: MockedFn;
  webhookCalls: MockedFn;
  slackPosts: MockedFn;
  teamsPosts: MockedFn;
  // The props the team's requests are made with (setTeamCaller).
  teamProps: DatabaseCommonInteractionProps;
  // Moves the clock on.
  advance: (milliseconds: number) => void;
}

let worldIndex: number = 0;

function pageRow(id: string): StoredRow {
  return {
    _id: id,
    projectId: WORLD_PROJECT_ID,
    name: `Acme ${id.slice(-3)}`,
    pageTitle: "Acme Status",
    isPublicStatusPage: true,
    showSubscriberPageOnStatusPage: true,
    enableEmailSubscribers: true,
    enableSmsSubscribers: true,
    enableSlackSubscribers: true,
    enableMicrosoftTeamsSubscribers: true,
    enableWebhookSubscribers: true,
    allowSubscribersToChooseResources: false,
    allowSubscribersToChooseEventTypes: false,
    limitSubscribersToPrivateUsers: false,
    isArchived: false,
    version: 1,
  };
}

export function registerSubscriberRoutes(): void {
  mockRouter.routes.length = 0;
  new StatusPageAPI();
  new StatusPageSubscriberAPI();
}

// A member of the project, holding `permissions` there, on the highest plan.
export function teamCaller(
  permissions: Array<Permission> = [Permission.ProjectMember],
  options: { isApiKey?: boolean } = {},
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions: permissions,
      projectId: new ObjectID(WORLD_PROJECT_ID),
      isApiKey: options.isApiKey,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

export function setUpSubscriberWorld(): SubscriberWorld {
  jest.clearAllMocks();
  stubProjectDirectory({});

  const redis: FakeCounterRedis = new FakeCounterRedis();
  (Redis.getClient as unknown as MockedFn).mockReturnValue(redis);
  (Redis.isConnected as unknown as MockedFn).mockReturnValue(true);

  /*
   * The start of an hour (every window divides one), a day further on for
   * each world, so no window carries over.
   */
  worldIndex++;
  let currentTime: number =
    Date.UTC(2032, 0, 1) + worldIndex * 24 * 60 * 60 * 1000;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return currentTime;
  });

  const pages: Array<StoredRow> = [];

  for (let index: number = 0; index < WORLD_PAGE_COUNT; index++) {
    pages.push(pageRow(pageIdOf(index)));
  }

  useInMemoryTable(StatusPageService, pages);
  const subscribers: InMemoryTable = useInMemoryTable(
    StatusPageSubscriberService,
    [],
  );

  // The statements an update writes Unsubscribed At with, answered as no rows.
  (subscribers.repository as unknown as { manager: unknown }).manager = {
    query: jest.fn(async (): Promise<unknown> => {
      return [[], 0];
    }),
  };

  const transactions: LimitTransactions =
    useInMemorySubscriberCreates(subscribers);

  jest
    .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
    .mockImplementation(async (ids: Array<unknown>): Promise<any> => {
      return await StatusPageService.findBy({
        query: { _id: String(ids[0]) },
        select: {
          _id: true,
          projectId: true,
          name: true,
          pageTitle: true,
          isPublicStatusPage: true,
        },
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      });
    });

  jest
    .spyOn(
      StatusPageService as unknown as {
        findSignedInSession: () => Promise<unknown>;
      },
      "findSignedInSession",
    )
    .mockResolvedValue(null as never);
  jest
    .spyOn(StatusPageService, "getStatusPageURL")
    .mockResolvedValue("https://status.acme.com");
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: null,
    isSubscriptionUnpaid: false,
  } as never);
  jest
    .spyOn(ProjectService, "isSMSNotificationsEnabled")
    .mockResolvedValue(true);
  jest
    .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
    .mockResolvedValue(undefined);
  jest
    .spyOn(
      StatusPageSubscriberNotificationTemplateService,
      "getTemplateForStatusPage",
    )
    .mockResolvedValue(null);
  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.example.com"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);

  const world: SubscriberWorld = {
    redis: redis,
    subscribers: subscribers,
    transactions: transactions,
    texts: jest
      .spyOn(SmsService, "sendSms")
      .mockResolvedValue(undefined as never) as unknown as MockedFn,
    emails: jest
      .spyOn(MailService, "sendMail")
      .mockResolvedValue(undefined as never) as unknown as MockedFn,
    webhookCalls: jest
      .spyOn(StatusPageSubscriberWebhookUtil, "sendWebhookNotification")
      .mockResolvedValue(undefined as never) as unknown as MockedFn,
    slackPosts: jest
      .spyOn(SlackUtil, "sendMessageToChannelViaIncomingWebhook")
      .mockResolvedValue(undefined as never) as unknown as MockedFn,
    teamsPosts: jest
      .spyOn(MicrosoftTeamsUtil, "sendMessageToChannelViaIncomingWebhook")
      .mockResolvedValue(undefined as never) as unknown as MockedFn,
    teamProps: teamCaller(),
    advance: (milliseconds: number): void => {
      currentTime += milliseconds;
    },
  };

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return world.teamProps;
    });

  return world;
}

// Lets what a route sends in the background go out.
export async function settle(): Promise<void> {
  for (let tick: number = 0; tick < 3; tick++) {
    await new Promise((resolve: (value: unknown) => void): void => {
      setTimeout(resolve, 0);
    });
  }
}

// A request as the status page, or the dashboard, sends it.
export async function callRoute(
  method: string,
  route: string,
  data: {
    from?: string | undefined;
    params?: Record<string, string> | undefined;
    query?: Record<string, string> | undefined;
    body?: JSONObject | undefined;
  },
): Promise<Answer> {
  const headers: Record<string, string> = {};
  const next: MockedFn = jest.fn();
  const req: ExpressRequest = {
    params: data.params || {},
    body: data.body || {},
    query: data.query || {},
    cookies: {},
    headers: { "x-forwarded-for": data.from || "203.0.113.7" },
    socket: { remoteAddress: "10.0.0.2" },
    ips: [],
    get: (): undefined => {
      return undefined;
    },
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {
    setHeader: (name: string, value: string): void => {
      headers[name] = value;
    },
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
    json: jest.fn(),
  } as unknown as ExpressResponse;

  await mockRouter
    .match(method, route)
    .handlerFunction(req, res, next as unknown as NextFunction);

  await settle();

  return {
    error: next.mock.calls[0]?.[0] as Exception | undefined,
    retryAfter: headers["Retry-After"],
  };
}

// A visitor signing up on the status page.
export async function signUp(
  from: string,
  body: JSONObject,
  pageId: string = WORLD_PAGE_ID,
): Promise<Answer> {
  return await callRoute("post", SUBSCRIBE_ROUTE, {
    from: from,
    params: { statusPageId: pageId },
    body: { data: body },
  });
}

// The link a confirmation carries, opened.
export async function confirm(
  subscriberId: string,
  code: string,
): Promise<Answer> {
  return await callRoute("get", CONFIRM_ROUTE, {
    params: { statusPageSubscriberId: subscriberId },
    query: { "verification-token": code },
  });
}

// The team adding a subscriber: Add Subscriber, Add in Bulk, an API key.
export async function teamAdd(
  data: JSONObject,
  pageId: string = WORLD_PAGE_ID,
): Promise<Answer> {
  return await callRoute("post", TEAM_CREATE_ROUTE, {
    body: { data: { statusPageId: pageId, ...data } },
  });
}

// The team changing a subscriber.
export async function teamUpdate(
  subscriberId: string,
  data: JSONObject,
): Promise<Answer> {
  return await callRoute("put", TEAM_ITEM_ROUTE, {
    params: { id: subscriberId },
    body: { data: data },
  });
}

// The team removing a subscriber.
export async function teamDelete(subscriberId: string): Promise<Answer> {
  return await callRoute("delete", TEAM_ITEM_ROUTE, {
    params: { id: subscriberId },
  });
}

// The rows of one page, in the order they were written.
export function rowsOf(
  world: SubscriberWorld,
  pageId: string = WORLD_PAGE_ID,
): Array<StoredRow> {
  return world.subscribers.rows.filter((row: StoredRow): boolean => {
    return String(row["statusPageId"]).toLowerCase() === pageId.toLowerCase();
  });
}

type RowUpdate = (
  where: unknown,
  set: StoredRow,
) => Promise<{ affected: number }>;

/*
 * The subscriber table keeping `row`'s version as Postgres does: an UPDATE
 * that names a version writes the row only while it still holds that
 * version, and moves it on in the same step, under the row's lock
 * (DatabaseService's compare-and-set, and the statement that gives up a
 * short confirmation code). The in-memory table keeps no version of its
 * own; the row starts at version 1.
 */
export function keepVersionsAsPostgresDoes(
  world: SubscriberWorld,
  row: StoredRow,
): void {
  row["version"] = 1;

  const update: RowUpdate =
    world.subscribers.repository.update.getMockImplementation() as RowUpdate;

  world.subscribers.repository.update.mockImplementation(
    async (where: unknown, set: StoredRow): Promise<{ affected: number }> => {
      const { version, ...rowOf } = where as StoredRow;
      const target: StoredRow | undefined = world.subscribers.get(
        String(rowOf["_id"]),
      );

      if (target && version !== undefined) {
        // Decided and moved on at once, as one UPDATE statement does.
        if (target["version"] !== version) {
          return { affected: 0 };
        }

        target["version"] = Number(version) + 1;
      }

      return await update(rowOf, set);
    },
  );
}

// What each text sent said, in order.
export function textsSent(
  world: SubscriberWorld,
): Array<{ to: string; message: string }> {
  return world.texts.mock.calls.map(
    (call: Array<unknown>): { to: string; message: string } => {
      const sms: { to: unknown; message: string } = call[0] as {
        to: unknown;
        message: string;
      };

      return { to: String(sms.to), message: sms.message };
    },
  );
}
