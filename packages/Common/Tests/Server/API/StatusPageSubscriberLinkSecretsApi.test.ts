import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT THIS FILE DEFENDS
 *
 * A status page subscription's unsubscribe link and its manage link carry
 * the subscription's token ({subscriberId}-{token}), and the pages they
 * open change or cancel the subscription for whoever holds the link - which
 * is only safe while the token reaches nobody but the subscription's own
 * contact. The id is no secret: every project member who may read
 * subscribers sees it. So the token must never come back through the
 * dashboard API, to any role, in any shape:
 *
 *   - not in a list or a single subscriber, whatever the select names;
 *   - not one comparison at a time either: a filter on the token answers
 *     "does this subscriber's token equal / start with / contain this?",
 *     which reads it as surely as a select, one guess after another.
 *
 * The confirmation code of a new email sign-up is held the same way.
 *
 * These ask the dashboard API's own routes, with the server's own permission
 * checks, as every project role and as API keys; only the table is held in
 * memory.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import Search from "../../../Types/BaseDatabase/Search";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "./CustomDomainCallers";
import {
  InMemoryTable,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-000000000001",
);
const STATUS_PAGE_ID: string = "7b000000-0000-4000-8000-000000000001";
const SUBSCRIBER_ID: string = "7c000000-0000-4000-8000-000000000001";

const TOKEN: string = "9d".repeat(32);
const CODE: string = "731904";

/*
 * Every project role, and API keys: the token is nobody's to read, the
 * owner's included - an owner who may change the subscription has no need
 * of it, and a token in an answer is a token in a browser, a log or a
 * script.
 */
const CALLERS: Array<[string, Array<Permission>, boolean]> = [
  ["a project owner", [Permission.ProjectOwner], false],
  ["a project admin", [Permission.ProjectAdmin], false],
  ["a project member", [Permission.ProjectMember], false],
  ["a status page admin", [Permission.StatusPageAdmin], false],
  ["a status page member", [Permission.StatusPageMember], false],
  ["a viewer", [Permission.Viewer], false],
  ["a status page viewer", [Permission.StatusPageViewer], false],
  [
    "a member given Read Status Page Subscriber",
    [Permission.ReadProjectStatusPage, Permission.ReadStatusPageSubscriber],
    false,
  ],
  ["a member given Read SMS Log only", [Permission.ReadSmsLog], false],
  [
    "an API key that reads subscribers",
    [Permission.ReadProjectStatusPage, Permission.ReadStatusPageSubscriber],
    true,
  ],
  ["an owner's API key", [Permission.ProjectOwner], true],
];

// Filters that would each answer one guess about the token or the code.
const SECRET_FILTERS: Array<[string, JSONObject]> = [
  ["the token itself", { unsubscribeToken: TOKEN }],
  [
    "the token's first characters",
    { unsubscribeToken: new StartsWith(TOKEN.slice(0, 2)).toJSON() },
  ],
  [
    "a search through the token",
    { unsubscribeToken: new Search(TOKEN.slice(0, 2)).toJSON() },
  ],
  [
    "a search over several columns, the token among them",
    {
      statusPageId: STATUS_PAGE_ID,
      anything: new MultiSearch({
        fields: ["subscriberEmail", "unsubscribeToken"],
        value: TOKEN.slice(0, 2),
      }).toJSON(),
    },
  ],
  ["the confirmation code", { subscriptionConfirmationToken: CODE }],
  [
    "the confirmation code's first digits",
    {
      subscriptionConfirmationToken: new StartsWith(CODE.slice(0, 1)).toJSON(),
    },
  ],
];

let props: DatabaseCommonInteractionProps;
let subscribers: InMemoryTable;

function callerProps(
  permissions: Array<Permission>,
  isApiKey: boolean,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions: permissions,
      projectId: PROJECT_ID,
      isApiKey: isApiKey,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

interface Answer {
  error: Error | undefined;
  // Everything the route sent back, as text.
  sent: string;
}

async function callRoute(
  method: string,
  route: string,
  data: {
    params?: Record<string, string>;
    body?: JSONObject;
  },
): Promise<Answer> {
  jest.clearAllMocks();

  const req: ExpressRequest = {
    params: data.params || {},
    query: { skip: "0", limit: "10" },
    headers: {},
    cookies: {},
    socket: {},
    ips: [],
    body: data.body || {},
  } as unknown as ExpressRequest;
  const next: MockedFn = jest.fn();

  await mockRouter
    .match(method, route)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  const sent: Array<unknown> = [
    ...(Response.sendEntityArrayResponse as unknown as MockedFn).mock.calls,
    ...(Response.sendEntityResponse as unknown as MockedFn).mock.calls,
    ...(Response.sendJsonObjectResponse as unknown as MockedFn).mock.calls,
  ].map((call: Array<unknown>): unknown => {
    return [call[2], call[3]];
  });

  return {
    error: next.mock.calls[0]?.[0] as Error | undefined,
    sent: JSON.stringify(sent),
  };
}

// The columns the last read asked the database for.
function columnsAskedFor(): Array<string> {
  const calls: Array<Array<unknown>> = subscribers.repository.find.mock
    .calls as Array<Array<unknown>>;
  const options: { select?: Record<string, unknown> } | undefined = calls[
    calls.length - 1
  ]?.[0] as { select?: Record<string, unknown> } | undefined;

  return Object.keys(options?.select || {});
}

// Refused outright - no rows, matched or not - and the secret nowhere.
function expectRefusedWithNoSecret(answer: Answer): void {
  expect(answer.error).toBeInstanceOf(NotAuthorizedException);
  expect(answer.sent).toBe("[]");
  expect(String(answer.error?.message || "")).not.toContain(TOKEN);
  expect(String(answer.error?.message || "")).not.toContain(CODE);
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new BaseAPI<StatusPageSubscriber, DatabaseService<StatusPageSubscriber>>(
    StatusPageSubscriber,
    StatusPageSubscriberService,
  );
});

beforeEach(() => {
  stubProjectDirectory({});

  subscribers = useInMemoryTable(StatusPageSubscriberService, [
    {
      _id: SUBSCRIBER_ID,
      projectId: PROJECT_ID.toString(),
      statusPageId: STATUS_PAGE_ID,
      subscriberEmail: "reader@example.com",
      unsubscribeToken: TOKEN,
      subscriptionConfirmationToken: CODE,
      isSubscriptionConfirmed: true,
      isUnsubscribed: false,
      createdAt: new Date("2026-10-01T09:00:00.000Z"),
    },
  ]);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the link's secrets never come back through the dashboard API", () => {
  test("the table holds them: the checks below are about the answer, not an empty table", () => {
    expect(subscribers.get(SUBSCRIBER_ID)!["unsubscribeToken"]).toBe(TOKEN);
    expect(
      subscribers.get(SUBSCRIBER_ID)!["subscriptionConfirmationToken"],
    ).toBe(CODE);
  });

  test("the same list without them answers a reader: the refusals below are about the secrets", async () => {
    props = callerProps([Permission.Viewer], false);

    const answer: Answer = await callRoute(
      "POST",
      "/status-page-subscriber/get-list",
      {
        body: {
          query: { statusPageId: STATUS_PAGE_ID },
          select: { _id: true, subscriberEmail: true },
        },
      },
    );

    expect(answer.error).toBeUndefined();
    expect(answer.sent).toContain(SUBSCRIBER_ID);
    expect(answer.sent).toContain("reader@example.com");

    // And the database is not even asked for them.
    expect(columnsAskedFor()).toEqual(
      expect.arrayContaining(["_id", "subscriberEmail"]),
    );
    expect(columnsAskedFor()).not.toContain("unsubscribeToken");
    expect(columnsAskedFor()).not.toContain("subscriptionConfirmationToken");
  });

  test.each(CALLERS)(
    "%s gets no token back from a list sorted by it",
    async (_who: string, permissions: Array<Permission>, isApiKey: boolean) => {
      props = callerProps(permissions, isApiKey);

      const answer: Answer = await callRoute(
        "POST",
        "/status-page-subscriber/get-list",
        {
          body: {
            query: { statusPageId: STATUS_PAGE_ID },
            select: { _id: true },
            sort: { unsubscribeToken: "ASC" },
          },
        },
      );

      expect(answer.sent).not.toContain(TOKEN);
      expect(String(answer.error?.message || "")).not.toContain(TOKEN);
    },
  );

  test.each(CALLERS)(
    "%s gets neither from a list that names them in its select",
    async (_who: string, permissions: Array<Permission>, isApiKey: boolean) => {
      props = callerProps(permissions, isApiKey);

      const answer: Answer = await callRoute(
        "POST",
        "/status-page-subscriber/get-list",
        {
          body: {
            query: { statusPageId: STATUS_PAGE_ID },
            select: {
              _id: true,
              subscriberEmail: true,
              unsubscribeToken: true,
              subscriptionConfirmationToken: true,
            },
          },
        },
      );

      expectRefusedWithNoSecret(answer);
    },
  );

  test.each(CALLERS)(
    "%s gets neither from the one subscriber, whatever the select names",
    async (_who: string, permissions: Array<Permission>, isApiKey: boolean) => {
      props = callerProps(permissions, isApiKey);

      const answer: Answer = await callRoute(
        "POST",
        "/status-page-subscriber/:id/get-item",
        {
          params: { id: SUBSCRIBER_ID },
          body: {
            select: {
              _id: true,
              unsubscribeToken: true,
              subscriptionConfirmationToken: true,
            },
          },
        },
      );

      expectRefusedWithNoSecret(answer);
    },
  );

  test.each(CALLERS)(
    "%s cannot filter on either, one guess at a time, in a list or a count",
    async (_who: string, permissions: Array<Permission>, isApiKey: boolean) => {
      props = callerProps(permissions, isApiKey);

      for (const [label, query] of SECRET_FILTERS) {
        for (const route of [
          "/status-page-subscriber/get-list",
          "/status-page-subscriber/count",
        ]) {
          const answer: Answer = await callRoute("POST", route, {
            body: { query: query, select: { _id: true } },
          });

          // Refused outright: no answer at all, matched or not.
          expect([label, route, answer.error]).toEqual([
            label,
            route,
            expect.any(NotAuthorizedException),
          ]);
          expectRefusedWithNoSecret(answer);
        }
      }
    },
  );
});
