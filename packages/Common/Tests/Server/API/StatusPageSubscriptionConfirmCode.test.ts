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
 * Someone who signs an email address up on a public status page does not
 * get notifications sent to it until the address confirms: the confirmation
 * email carries {statusPageUrl}/confirm-subscription/{id}?verification-token=
 * {code}, and the page's GET .../confirm-subscription/:statusPageSubscriberId
 * route confirms the sign-up only for its code. The code is the whole of what
 * proves the request came from the address's own inbox - the subscriber id
 * is no secret: every project member who may read subscribers sees it,
 * read-only roles included.
 *
 * The route read the code straight into its query. A request with no code
 * left the query's code undefined, and a filter on undefined is no filter -
 * the database looked the subscriber up by its id alone, so the id alone
 * confirmed the sign-up and started the notifications to an address that
 * never asked for them. Now the code must be text, and only the
 * subscription's own code confirms it.
 *
 * These walk the route as it runs, against the subscriber service's real
 * lookup; only the table is held in memory. Each sign-up's link was sent an
 * hour ago, well inside the day it works for; a link that has run out, and
 * a six-digit code from before codes were 32 characters, have their own
 * suite (StatusPageSubscriptionLinkExpiry.test.ts).
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

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "./CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

type MockedFn = ReturnType<typeof jest.fn>;

const CONFIRM_ROUTE: string =
  "/status-page/confirm-subscription/:statusPageSubscriberId";

const PROJECT_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000001",
);
const STATUS_PAGE_ID: string = "6b000000-0000-4000-8000-000000000001";

// Two sign-ups that have not confirmed yet, each with its own code.
const PENDING_ID: string = "6c000000-0000-4000-8000-000000000001";
const OTHER_PENDING_ID: string = "6c000000-0000-4000-8000-000000000002";

const CODE: string = "3f1c9a7be2d84f0a9c6b5e4d3a2f1e0d";
const OTHER_CODE: string = "8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d";

const NOT_FOUND_MESSAGE: string =
  "Subscriber not found or confirmation token is invalid";

/*
 * Every verification-token someone without the confirmation email could
 * send, as Express hands the query over: none at all, an empty one, the
 * parameter repeated (an array) or bracketed (an object), another
 * sign-up's code, a guess, the code with more around it, and the id.
 */
const CODES_WITHOUT_THE_EMAIL: Array<[string, Record<string, unknown>]> = [
  ["no code", {}],
  ["an empty code", { "verification-token": "" }],
  ["the code parameter repeated", { "verification-token": [CODE, CODE] }],
  ["an empty repeated parameter", { "verification-token": [] }],
  ["a bracketed parameter", { "verification-token": { $ne: "" } }],
  ["another sign-up's code", { "verification-token": OTHER_CODE }],
  ["a guess", { "verification-token": "000000" }],
  ["the code with a space after it", { "verification-token": `${CODE} ` }],
  ["the subscriber id", { "verification-token": PENDING_ID }],
];

// Every project role that can read subscribers, and so their ids.
const SUBSCRIBER_READERS: Array<[string, Array<Permission>, boolean]> = [
  ["a viewer", [Permission.Viewer], false],
  ["a status page viewer", [Permission.StatusPageViewer], false],
  [
    "a member given Read Status Page Subscriber",
    [Permission.ReadProjectStatusPage, Permission.ReadStatusPageSubscriber],
    false,
  ],
  [
    "an API key that reads subscribers",
    [Permission.ReadProjectStatusPage, Permission.ReadStatusPageSubscriber],
    true,
  ],
];

let props: DatabaseCommonInteractionProps;
let subscribers: InMemoryTable;

function pendingRow(data: { id: string; code: string }): StoredRow {
  return {
    _id: data.id,
    projectId: PROJECT_ID.toString(),
    statusPageId: STATUS_PAGE_ID,
    subscriberEmail: `${data.code}@example.com`,
    isSubscriptionConfirmed: false,
    subscriptionConfirmationToken: data.code,
    unsubscribeToken: "7b".repeat(32),
    isUnsubscribed: false,
    // Sent an hour ago: its link works for a day.
    createdAt: new Date(Date.now() - 60 * 60 * 1000),
  };
}

async function confirm(data: {
  subscriberId?: string;
  query: Record<string, unknown>;
}): Promise<Error | undefined> {
  const req: ExpressRequest = {
    params: { statusPageSubscriberId: data.subscriberId || PENDING_ID },
    query: data.query,
    headers: {},
    cookies: {},
    socket: {},
    ips: [],
    body: {},
  } as unknown as ExpressRequest;
  const next: MockedFn = jest.fn();

  await mockRouter
    .match("GET", CONFIRM_ROUTE)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  // The route answers a bad link itself, or hands an error on.
  const sent: unknown = (Response.sendErrorResponse as unknown as MockedFn).mock
    .calls[0]?.[2];

  return (sent as Error | undefined) || (next.mock.calls[0]?.[0] as Error);
}

function isConfirmed(subscriberId: string): boolean {
  return subscribers.get(subscriberId)!["isSubscriptionConfirmed"] === true;
}

function expectRefusedAsNotFound(error: Error | undefined): void {
  expect(error).toBeInstanceOf(NotFoundException);
  expect(error!.message).toBe(NOT_FOUND_MESSAGE);
}

// The ids a caller's subscriber list hands them, through the dashboard API.
async function subscriberIdsListedTo(
  caller: DatabaseCommonInteractionProps,
): Promise<Array<string>> {
  props = caller;
  (Response.sendEntityArrayResponse as unknown as MockedFn).mockClear();

  const req: ExpressRequest = {
    params: {},
    query: { skip: "0", limit: "10" },
    headers: {},
    cookies: {},
    socket: {},
    ips: [],
    body: {
      query: { statusPageId: STATUS_PAGE_ID },
      select: { _id: true, subscriberEmail: true },
    },
  } as unknown as ExpressRequest;
  const next: MockedFn = jest.fn();

  await mockRouter
    .match("POST", "/status-page-subscriber/get-list")
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  expect(next).not.toHaveBeenCalled();

  return (
    ((Response.sendEntityArrayResponse as unknown as MockedFn).mock
      .calls[0]?.[2] as Array<BaseModel>) || []
  ).map((row: BaseModel): string => {
    return row.id!.toString();
  });
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new StatusPageAPI();
  new BaseAPI<StatusPageSubscriber, DatabaseService<StatusPageSubscriber>>(
    StatusPageSubscriber,
    StatusPageSubscriberService,
  );
});

beforeEach(() => {
  jest.clearAllMocks();
  stubProjectDirectory({});

  subscribers = useInMemoryTable(StatusPageSubscriberService, [
    pendingRow({ id: PENDING_ID, code: CODE }),
    pendingRow({ id: OTHER_PENDING_ID, code: OTHER_CODE }),
  ]);

  // The welcome message a confirmation sends: its own suites cover it.
  jest
    .spyOn(StatusPageSubscriberService, "sendYouHaveSubscribedEmail")
    .mockResolvedValue(undefined as never);

  props = {
    ...customDomainCaller({
      permissions: [Permission.Viewer],
      projectId: PROJECT_ID,
    }),
    ...ON_HIGHEST_PLAN,
  };

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a sign-up is confirmed only with its own code", () => {
  test("the confirmation email's link confirms it, once", async () => {
    expect(
      await confirm({ query: { "verification-token": CODE } }),
    ).toBeUndefined();

    expect(isConfirmed(PENDING_ID)).toBe(true);
    expect(isConfirmed(OTHER_PENDING_ID)).toBe(false);
    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(
      StatusPageSubscriberService.sendYouHaveSubscribedEmail,
    ).toHaveBeenCalledTimes(1);

    // Opening the link again changes nothing more and sends nothing more.
    expect(
      await confirm({ query: { "verification-token": CODE } }),
    ).toBeUndefined();
    expect(
      StatusPageSubscriberService.sendYouHaveSubscribedEmail,
    ).toHaveBeenCalledTimes(1);
  });

  test.each(CODES_WITHOUT_THE_EMAIL)(
    "regression: the subscriber id with %s confirms nothing and sends nothing",
    async (_label: string, query: Record<string, unknown>) => {
      expectRefusedAsNotFound(await confirm({ query: query }));

      expect(isConfirmed(PENDING_ID)).toBe(false);
      expect(isConfirmed(OTHER_PENDING_ID)).toBe(false);
      expect(subscribers.updates).toEqual([]);
      expect(
        StatusPageSubscriberService.sendYouHaveSubscribedEmail,
      ).not.toHaveBeenCalled();
    },
  );

  test("a sign-up's code confirms no other sign-up", async () => {
    expectRefusedAsNotFound(
      await confirm({
        subscriberId: OTHER_PENDING_ID,
        query: { "verification-token": CODE },
      }),
    );

    expect(isConfirmed(OTHER_PENDING_ID)).toBe(false);
    expect(isConfirmed(PENDING_ID)).toBe(false);
  });

  test("an id that matches nothing and a malformed id get the same answer", async () => {
    expectRefusedAsNotFound(
      await confirm({
        subscriberId: ObjectID.generate().toString(),
        query: { "verification-token": CODE },
      }),
    );

    (Response.sendErrorResponse as unknown as MockedFn).mockClear();

    expectRefusedAsNotFound(
      await confirm({
        subscriberId: "' OR 1=1 --",
        query: { "verification-token": CODE },
      }),
    );

    expect(isConfirmed(PENDING_ID)).toBe(false);
  });

  test("a sign-up without a code on record is confirmed by no request", async () => {
    subscribers.get(PENDING_ID)!["subscriptionConfirmationToken"] = null;

    for (const [, query] of CODES_WITHOUT_THE_EMAIL) {
      (Response.sendErrorResponse as unknown as MockedFn).mockClear();
      expectRefusedAsNotFound(await confirm({ query: query }));
    }

    expect(isConfirmed(PENDING_ID)).toBe(false);
  });
});

describe("who can read about a sign-up cannot confirm it with what they read", () => {
  test.each(SUBSCRIBER_READERS)(
    "%s lists the pending sign-up's id, and cannot confirm it with the id",
    async (_who: string, permissions: Array<Permission>, isApiKey: boolean) => {
      const ids: Array<string> = await subscriberIdsListedTo({
        ...customDomainCaller({
          permissions: permissions,
          projectId: PROJECT_ID,
          isApiKey: isApiKey,
        }),
        ...ON_HIGHEST_PLAN,
      });

      // The premise: the id is theirs to read.
      expect(ids).toContain(PENDING_ID);

      for (const [, query] of CODES_WITHOUT_THE_EMAIL) {
        (Response.sendErrorResponse as unknown as MockedFn).mockClear();
        expectRefusedAsNotFound(
          await confirm({ subscriberId: PENDING_ID, query: query }),
        );
      }

      expect(isConfirmed(PENDING_ID)).toBe(false);
      expect(
        StatusPageSubscriberService.sendYouHaveSubscribedEmail,
      ).not.toHaveBeenCalled();
    },
  );

  test("the confirmation code is never handed to them either", async () => {
    props = {
      ...customDomainCaller({
        permissions: [Permission.ProjectOwner],
        projectId: PROJECT_ID,
      }),
      ...ON_HIGHEST_PLAN,
    };

    const req: ExpressRequest = {
      params: {},
      query: { skip: "0", limit: "10" },
      headers: {},
      cookies: {},
      socket: {},
      ips: [],
      body: {
        query: { statusPageId: STATUS_PAGE_ID },
        select: { _id: true, subscriptionConfirmationToken: true },
      },
    } as unknown as ExpressRequest;
    const next: MockedFn = jest.fn();

    await mockRouter
      .match("POST", "/status-page-subscriber/get-list")
      .handlerFunction(
        req,
        {} as ExpressResponse,
        next as unknown as NextFunction,
      );

    const listed: Array<BaseModel> =
      ((Response.sendEntityArrayResponse as unknown as MockedFn).mock
        .calls[0]?.[2] as Array<BaseModel>) || [];

    expect(JSON.stringify(listed)).not.toContain(CODE);
    expect(
      JSON.stringify((next.mock.calls[0]?.[0] as JSONObject) || {}),
    ).not.toContain(CODE);
  });
});
