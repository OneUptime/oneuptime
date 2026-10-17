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
 * A status page subscription's manage page (Update Subscription) reads the
 * subscription's contact and choices, changes them, and cancels it. Its two
 * routes - get-subscription and update-subscription - are public: a
 * subscriber opens the page from a link in a message, signed in or not. So
 * the link is the whole of the authorisation, and it must be something only
 * the subscription's own contact is ever sent.
 *
 * The subscriber's id is not that. Every project member who may read
 * subscribers sees it on the dashboard and through the API - read-only roles
 * and read-only API keys included - and every log that names a subscription
 * keeps it. The routes used to take the id alone, so anyone who could read
 * about a subscription could change or cancel it: a role that "changes
 * nothing" changed what the project's customers hear about.
 *
 * Now the routes take the credential the manage link carries -
 * {subscriberId}-{token}, the subscription's own token, the same one its
 * unsubscribe link carries - and answer only for the subscription that token
 * belongs to. These walk the routes as they run in production, against the
 * subscriber service's real lookup and token comparison; only the tables are
 * held in memory, and the status page's read check runs for real.
 *
 *   - Every project role that can read subscribers gets their ids - and with
 *     an id, and anything else it could know, it can neither read nor change
 *     a subscription through these routes.
 *   - The link's holder, signed in or not, can - on a public page; on a
 *     private page the page's own sign-in still comes first.
 *   - Every link that does not open a subscription gets one answer.
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
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import StatusPageService from "../../../Server/Services/StatusPageService";
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
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import StatusPageSubscriberUnsubscribe, {
  MANAGE_SUBSCRIPTION_LINK_NOT_VALID_MESSAGE,
} from "../../../Types/StatusPage/StatusPageSubscriberUnsubscribe";
import { customDomainCaller } from "./CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

type MockedFn = ReturnType<typeof jest.fn>;

const GET_ROUTE: string =
  "/status-page/get-subscription/:statusPageId/:subscriberId/:token";
const UPDATE_ROUTE: string =
  "/status-page/update-subscription/:statusPageId/:subscriberId/:token";

const PROJECT_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000002",
);

// A public status page, a private one, and another public one.
const PUBLIC_PAGE_ID: string = "5b000000-0000-4000-8000-000000000001";
const PRIVATE_PAGE_ID: string = "5b000000-0000-4000-8000-000000000002";
const OTHER_PUBLIC_PAGE_ID: string = "5b000000-0000-4000-8000-000000000003";

// An SMS subscriber of each.
const SUBSCRIBER_ID: string = "5c000000-0000-4000-8000-000000000001";
const PRIVATE_SUBSCRIBER_ID: string = "5c000000-0000-4000-8000-000000000002";
const OTHER_SUBSCRIBER_ID: string = "5c000000-0000-4000-8000-000000000003";

const TOKEN: string = "4e".repeat(32);
const PRIVATE_TOKEN: string = "5f".repeat(32);
const OTHER_TOKEN: string = "6a".repeat(32);

const PHONE: string = "+15555550123";

/*
 * Every project role that can read a status page's subscribers, and so their
 * ids, without being allowed to change them. A read-only API key too.
 */
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

// Roles that may change subscribers - from the dashboard, never by the id here.
const SUBSCRIBER_EDITORS: Array<[string, Array<Permission>]> = [
  ["a project owner", [Permission.ProjectOwner]],
  ["a project admin", [Permission.ProjectAdmin]],
  ["a project member", [Permission.ProjectMember]],
  ["a status page admin", [Permission.StatusPageAdmin]],
];

/*
 * Every token someone without the subscriber's message could present: none,
 * what a log shows in its place, the token of another subscription, a guess,
 * a truncated or padded one, and the subscriber id itself.
 */
const TOKENS_WITHOUT_THE_MESSAGE: Array<[string, string]> = [
  ["no token", ""],
  ["the log's [redacted]", StatusPageSubscriberUnsubscribe.REDACTED_TOKEN],
  ["another subscription's token", OTHER_TOKEN],
  ["a guess", "0".repeat(64)],
  ["the token cut short", TOKEN.slice(0, 63)],
  ["the token with more on the end", `${TOKEN}0`],
  ["the subscriber id", SUBSCRIBER_ID],
];

let props: DatabaseCommonInteractionProps;
let subscribers: InMemoryTable;

function readerProps(
  permissions: Array<Permission>,
  isApiKey: boolean = false,
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

async function callRoute(
  method: string,
  route: string,
  data: {
    params?: Record<string, string>;
    body?: JSONObject;
    query?: Record<string, string>;
  } = {},
): Promise<Error | undefined> {
  const req: ExpressRequest = {
    params: data.params || {},
    query: data.query || {},
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

  return next.mock.calls[0]?.[0] as Error | undefined;
}

// get-subscription as the manage page asks it.
async function readSubscription(data: {
  statusPageId?: string;
  subscriberId?: string;
  token: string;
}): Promise<Error | undefined> {
  return await callRoute("POST", GET_ROUTE, {
    params: {
      statusPageId: data.statusPageId || PUBLIC_PAGE_ID,
      subscriberId: data.subscriberId || SUBSCRIBER_ID,
      token: data.token,
    },
    body: { select: {} },
  });
}

// update-subscription as the manage page sends a cancellation.
async function cancelSubscription(data: {
  statusPageId?: string;
  subscriberId?: string;
  token: string;
}): Promise<Error | undefined> {
  return await callRoute("PUT", UPDATE_ROUTE, {
    params: {
      statusPageId: data.statusPageId || PUBLIC_PAGE_ID,
      subscriberId: data.subscriberId || SUBSCRIBER_ID,
      token: data.token,
    },
    body: { data: { isUnsubscribed: true } },
  });
}

function sentSubscribers(): Array<StatusPageSubscriber> {
  return (Response.sendEntityResponse as unknown as MockedFn).mock.calls.map(
    (call: Array<unknown>): StatusPageSubscriber => {
      return call[2] as StatusPageSubscriber;
    },
  );
}

function isCancelled(subscriberId: string): boolean {
  return subscribers.get(subscriberId)!["isUnsubscribed"] === true;
}

// The ids a caller's subscriber list hands them, through the dashboard API.
async function subscriberIdsListedTo(
  caller: DatabaseCommonInteractionProps,
): Promise<Array<string>> {
  props = caller;
  (Response.sendEntityArrayResponse as unknown as MockedFn).mockClear();

  const error: Error | undefined = await callRoute(
    "POST",
    "/status-page-subscriber/get-list",
    {
      body: {
        query: { statusPageId: PUBLIC_PAGE_ID },
        select: { _id: true, subscriberPhone: true },
      },
      query: { skip: "0", limit: "10" },
    },
  );

  expect(error).toBeUndefined();

  return (
    ((Response.sendEntityArrayResponse as unknown as MockedFn).mock
      .calls[0]?.[2] as Array<BaseModel>) || []
  ).map((row: BaseModel): string => {
    return row.id!.toString();
  });
}

function expectRefusedAsAnInvalidLink(error: Error | undefined): void {
  expect(error).toBeInstanceOf(BadDataException);
  expect(error!.message).toBe(MANAGE_SUBSCRIPTION_LINK_NOT_VALID_MESSAGE);
}

function subscriberRow(data: {
  id: string;
  pageId: string;
  projectId: ObjectID;
  token: string;
}): StoredRow {
  return {
    _id: data.id,
    projectId: data.projectId.toString(),
    statusPageId: data.pageId,
    subscriberPhone: PHONE,
    unsubscribeToken: data.token,
    isUnsubscribed: false,
    isSubscribedToAllResources: true,
    isSubscribedToAllEventTypes: true,
    createdAt: new Date("2026-10-01T09:00:00.000Z"),
  };
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

  useInMemoryTable(StatusPageService, [
    {
      _id: PUBLIC_PAGE_ID,
      projectId: PROJECT_ID.toString(),
      name: "Acme Status",
      isPublicStatusPage: true,
      showSubscriberPageOnStatusPage: true,
      enableSmsSubscribers: true,
      allowSubscribersToChooseResources: false,
      allowSubscribersToChooseEventTypes: false,
      isArchived: false,
    },
    {
      _id: PRIVATE_PAGE_ID,
      projectId: PROJECT_ID.toString(),
      name: "Acme Internal",
      isPublicStatusPage: false,
      showSubscriberPageOnStatusPage: true,
      enableSmsSubscribers: true,
      allowSubscribersToChooseResources: false,
      allowSubscribersToChooseEventTypes: false,
      isArchived: false,
    },
    {
      _id: OTHER_PUBLIC_PAGE_ID,
      projectId: OTHER_PROJECT_ID.toString(),
      name: "Other Status",
      isPublicStatusPage: true,
      showSubscriberPageOnStatusPage: true,
      enableSmsSubscribers: true,
      allowSubscribersToChooseResources: false,
      allowSubscribersToChooseEventTypes: false,
      isArchived: false,
    },
  ]);

  subscribers = useInMemoryTable(StatusPageSubscriberService, [
    subscriberRow({
      id: SUBSCRIBER_ID,
      pageId: PUBLIC_PAGE_ID,
      projectId: PROJECT_ID,
      token: TOKEN,
    }),
    subscriberRow({
      id: PRIVATE_SUBSCRIBER_ID,
      pageId: PRIVATE_PAGE_ID,
      projectId: PROJECT_ID,
      token: PRIVATE_TOKEN,
    }),
    subscriberRow({
      id: OTHER_SUBSCRIBER_ID,
      pageId: OTHER_PUBLIC_PAGE_ID,
      projectId: OTHER_PROJECT_ID,
      token: OTHER_TOKEN,
    }),
  ]);

  /*
   * The cancellation itself is one guarded UPDATE of hand-written SQL
   * (its own suites run it against Postgres); here it is applied to the
   * table, so a test can tell whether it happened.
   */
  jest
    .spyOn(StatusPageSubscriberService, "unsubscribe")
    .mockImplementation((async (data: { subscriberId: ObjectID }) => {
      subscribers.get(data.subscriberId)!["isUnsubscribed"] = true;
      return true;
    }) as never);

  jest
    .spyOn(StatusPageSubscriberService, "updateFromManageSubscriptionPage")
    .mockImplementation((async (data: {
      subscriberId: ObjectID;
      data: JSONObject;
    }) => {
      Object.assign(subscribers.get(data.subscriberId)!, data.data);
      return 1;
    }) as never);

  props = readerProps([Permission.Viewer]);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the manage page's routes take the link's credential", () => {
  test("both routes are registered with the token, and not without it", () => {
    const paths: Array<string> = mockRouter.routes.map(
      (route: { method: string; uri: string }): string => {
        return `${route.method} ${route.uri}`;
      },
    );

    expect(paths).toContain(`POST ${GET_ROUTE}`);
    expect(paths).toContain(`PUT ${UPDATE_ROUTE}`);
    expect(paths).not.toContain(
      "POST /status-page/get-subscription/:statusPageId/:subscriberId",
    );
    expect(paths).not.toContain(
      "PUT /status-page/update-subscription/:statusPageId/:subscriberId",
    );
  });

  test("the link's holder reads the subscription - and never its token", async () => {
    const error: Error | undefined = await readSubscription({ token: TOKEN });

    expect(error).toBeUndefined();
    expect(sentSubscribers()).toHaveLength(1);

    const sent: StatusPageSubscriber = sentSubscribers()[0]!;
    expect(sent.id!.toString()).toBe(SUBSCRIBER_ID);
    expect(sent.subscriberPhone?.toString()).toBe(PHONE);
    expect(sent.unsubscribeToken).toBeUndefined();
    expect(JSON.stringify(sent)).not.toContain(TOKEN);

    // A token-bearing answer: a shared cache must not keep it.
    expect(Response.setNoCacheHeaders).toHaveBeenCalled();
  });

  test("the link's holder cancels the subscription, and subscribes again", async () => {
    expect(await cancelSubscription({ token: TOKEN })).toBeUndefined();
    expect(isCancelled(SUBSCRIBER_ID)).toBe(true);

    const again: Error | undefined = await callRoute("PUT", UPDATE_ROUTE, {
      params: {
        statusPageId: PUBLIC_PAGE_ID,
        subscriberId: SUBSCRIBER_ID,
        token: TOKEN,
      },
      body: { data: { isUnsubscribed: false } },
    });

    expect(again).toBeUndefined();
    expect(isCancelled(SUBSCRIBER_ID)).toBe(false);
  });

  test("a token whose case a mail client changed still works, and so does an id in capitals", async () => {
    expect(
      await readSubscription({
        subscriberId: SUBSCRIBER_ID.toUpperCase(),
        token: TOKEN.toUpperCase(),
      }),
    ).toBeUndefined();
  });

  test.each(TOKENS_WITHOUT_THE_MESSAGE)(
    "with the subscriber id and %s, nothing is read or changed",
    async (_label: string, token: string) => {
      expectRefusedAsAnInvalidLink(await readSubscription({ token }));
      expectRefusedAsAnInvalidLink(await cancelSubscription({ token }));

      expect(sentSubscribers()).toHaveLength(0);
      expect(isCancelled(SUBSCRIBER_ID)).toBe(false);
      expect(StatusPageSubscriberService.unsubscribe).not.toHaveBeenCalled();
      expect(
        StatusPageSubscriberService.updateFromManageSubscriptionPage,
      ).not.toHaveBeenCalled();
    },
  );

  test("a subscription's token does not open another subscription", async () => {
    // Another project's subscriber, with this subscription's token.
    expectRefusedAsAnInvalidLink(
      await readSubscription({
        statusPageId: OTHER_PUBLIC_PAGE_ID,
        subscriberId: OTHER_SUBSCRIBER_ID,
        token: TOKEN,
      }),
    );
    // This subscriber, named on another page with that page's token.
    expectRefusedAsAnInvalidLink(
      await cancelSubscription({
        statusPageId: OTHER_PUBLIC_PAGE_ID,
        token: OTHER_TOKEN,
      }),
    );
    // This subscriber, named on another page with its own token.
    expectRefusedAsAnInvalidLink(
      await cancelSubscription({
        statusPageId: OTHER_PUBLIC_PAGE_ID,
        token: TOKEN,
      }),
    );

    expect(isCancelled(SUBSCRIBER_ID)).toBe(false);
    expect(isCancelled(OTHER_SUBSCRIBER_ID)).toBe(false);
  });

  test("a deleted subscriber, an id that matches nothing and a malformed id all get the one answer", async () => {
    const answers: Array<Error | undefined> = [];

    answers.push(
      await readSubscription({
        subscriberId: ObjectID.generate().toString(),
        token: TOKEN,
      }),
    );
    answers.push(
      await readSubscription({
        subscriberId: "' OR 1=1 --",
        token: TOKEN,
      }),
    );
    answers.push(
      await readSubscription({
        subscriberId: `${SUBSCRIBER_ID}-${TOKEN}`,
        token: TOKEN,
      }),
    );

    subscribers.rows.splice(0, subscribers.rows.length);
    answers.push(await readSubscription({ token: TOKEN }));

    for (const answer of answers) {
      expectRefusedAsAnInvalidLink(answer);
    }
  });
});

describe("a private status page", () => {
  test("still asks for the page's own sign-in first, the link's token or not", async () => {
    for (const token of [PRIVATE_TOKEN, ""]) {
      const read: Error | undefined = await readSubscription({
        statusPageId: PRIVATE_PAGE_ID,
        subscriberId: PRIVATE_SUBSCRIBER_ID,
        token: token,
      });
      const cancel: Error | undefined = await cancelSubscription({
        statusPageId: PRIVATE_PAGE_ID,
        subscriberId: PRIVATE_SUBSCRIBER_ID,
        token: token,
      });

      expect(read).toBeInstanceOf(NotAuthenticatedException);
      expect(cancel).toBeInstanceOf(NotAuthenticatedException);
    }

    expect(isCancelled(PRIVATE_SUBSCRIBER_ID)).toBe(false);
  });

  test("a signed-in reader of the page needs the subscription's token too", async () => {
    // The page's sign-in, as StatusPageService checks it, passed.
    jest
      .spyOn(StatusPageService, "hasReadAccess")
      .mockResolvedValue({ hasReadAccess: true });

    expectRefusedAsAnInvalidLink(
      await cancelSubscription({
        statusPageId: PRIVATE_PAGE_ID,
        subscriberId: PRIVATE_SUBSCRIBER_ID,
        token: "",
      }),
    );
    expect(isCancelled(PRIVATE_SUBSCRIBER_ID)).toBe(false);

    expect(
      await cancelSubscription({
        statusPageId: PRIVATE_PAGE_ID,
        subscriberId: PRIVATE_SUBSCRIBER_ID,
        token: PRIVATE_TOKEN,
      }),
    ).toBeUndefined();
    expect(isCancelled(PRIVATE_SUBSCRIBER_ID)).toBe(true);
  });
});

/*
 * The project's roles, as they meet a subscription: every one that may read
 * subscribers is handed their ids by the subscriber list - and the id opens
 * nothing here, whatever the role.
 */
describe("who can read about a subscription cannot change it with what they read", () => {
  test.each(SUBSCRIBER_READERS)(
    "%s lists the subscribers' ids, and may not change one through the dashboard API",
    async (_who: string, permissions: Array<Permission>, isApiKey: boolean) => {
      const ids: Array<string> = await subscriberIdsListedTo(
        readerProps(permissions, isApiKey),
      );

      // The premise: the id is theirs to read.
      expect(ids).toEqual([SUBSCRIBER_ID]);

      const edit: Error | undefined = await callRoute(
        "PUT",
        "/status-page-subscriber/:id",
        {
          params: { id: SUBSCRIBER_ID },
          body: { data: { isUnsubscribed: true } },
        },
      );

      expect(edit).toBeDefined();
      expect(edit!.message).toContain(
        "You do not have permissions to update Status Page Subscriber",
      );
      expect(isCancelled(SUBSCRIBER_ID)).toBe(false);
    },
  );

  test.each(SUBSCRIBER_READERS)(
    "%s cannot read or cancel the subscription with its id through the manage page's routes",
    async (_who: string, permissions: Array<Permission>, isApiKey: boolean) => {
      const [id] = await subscriberIdsListedTo(
        readerProps(permissions, isApiKey),
      );

      for (const [, token] of TOKENS_WITHOUT_THE_MESSAGE) {
        expectRefusedAsAnInvalidLink(
          await readSubscription({ subscriberId: id!, token }),
        );
        expectRefusedAsAnInvalidLink(
          await cancelSubscription({ subscriberId: id!, token }),
        );
      }

      expect(sentSubscribers()).toHaveLength(0);
      expect(isCancelled(SUBSCRIBER_ID)).toBe(false);
    },
  );

  test.each(SUBSCRIBER_EDITORS)(
    "%s, who may change subscribers on the dashboard, gets no way around the token here either",
    async (_who: string, permissions: Array<Permission>) => {
      props = readerProps(permissions);

      for (const [, token] of TOKENS_WITHOUT_THE_MESSAGE) {
        expectRefusedAsAnInvalidLink(await cancelSubscription({ token }));
      }

      expect(isCancelled(SUBSCRIBER_ID)).toBe(false);
    },
  );

  test("a member of another project, who cannot list this project's subscribers, gets nothing with a guessed id", async () => {
    const outsider: DatabaseCommonInteractionProps = {
      ...customDomainCaller({
        permissions: [Permission.ProjectOwner],
        projectId: OTHER_PROJECT_ID,
      }),
      ...ON_HIGHEST_PLAN,
    };

    props = outsider;
    (Response.sendEntityArrayResponse as unknown as MockedFn).mockClear();

    await callRoute("POST", "/status-page-subscriber/get-list", {
      body: { query: {}, select: { _id: true } },
      query: { skip: "0", limit: "10" },
    });

    const listed: Array<BaseModel> =
      ((Response.sendEntityArrayResponse as unknown as MockedFn).mock
        .calls[0]?.[2] as Array<BaseModel>) || [];

    expect(
      listed.map((row: BaseModel): string => {
        return row.id!.toString();
      }),
    ).not.toContain(SUBSCRIBER_ID);

    expectRefusedAsAnInvalidLink(await cancelSubscription({ token: "" }));
    expect(isCancelled(SUBSCRIBER_ID)).toBe(false);
  });
});

/*
 * More ways around the link, each tried and refused: another subscription on
 * the same page, a subscription with no token on record, a token with
 * something around it - and what the link's holder can change.
 */
describe("the link opens its own subscription's choices, and nothing more", () => {
  const SAME_PAGE_SUBSCRIBER_ID: string =
    "5c000000-0000-4000-8000-000000000004";
  const SAME_PAGE_TOKEN: string = "7d".repeat(32);

  test("a token opens no other subscription on its own page", async () => {
    subscribers.rows.push(
      subscriberRow({
        id: SAME_PAGE_SUBSCRIBER_ID,
        pageId: PUBLIC_PAGE_ID,
        projectId: PROJECT_ID,
        token: SAME_PAGE_TOKEN,
      }),
    );

    // Each subscription's id with the other's token, both ways round.
    expectRefusedAsAnInvalidLink(
      await readSubscription({
        subscriberId: SAME_PAGE_SUBSCRIBER_ID,
        token: TOKEN,
      }),
    );
    expectRefusedAsAnInvalidLink(
      await cancelSubscription({
        subscriberId: SAME_PAGE_SUBSCRIBER_ID,
        token: TOKEN,
      }),
    );
    expectRefusedAsAnInvalidLink(
      await cancelSubscription({ token: SAME_PAGE_TOKEN }),
    );

    expect(sentSubscribers()).toHaveLength(0);
    expect(isCancelled(SUBSCRIBER_ID)).toBe(false);
    expect(isCancelled(SAME_PAGE_SUBSCRIBER_ID)).toBe(false);

    // Each with its own still opens.
    expect(
      await cancelSubscription({
        subscriberId: SAME_PAGE_SUBSCRIBER_ID,
        token: SAME_PAGE_TOKEN,
      }),
    ).toBeUndefined();
    expect(isCancelled(SAME_PAGE_SUBSCRIBER_ID)).toBe(true);
    expect(isCancelled(SUBSCRIBER_ID)).toBe(false);
  });

  test("a subscription with no token on record opens with nothing - not even the stand-in a refusal is compared with", async () => {
    subscribers.get(SUBSCRIBER_ID)!["unsubscribeToken"] = null;

    for (const token of [
      "",
      "0".repeat(64),
      StatusPageSubscriberUnsubscribe.REDACTED_TOKEN,
      "null",
      "undefined",
    ]) {
      expectRefusedAsAnInvalidLink(await readSubscription({ token }));
      expectRefusedAsAnInvalidLink(await cancelSubscription({ token }));
    }

    expect(sentSubscribers()).toHaveLength(0);
    expect(isCancelled(SUBSCRIBER_ID)).toBe(false);
  });

  test.each([
    ["a space before it", ` ${TOKEN}`],
    ["a space after it", `${TOKEN} `],
    ["a line break after it", `${TOKEN}\n`],
    ["a NUL after it", `${TOKEN}\u0000`],
    [
      "every character of it written as an escape",
      Array.from(TOKEN)
        .map((character: string): string => {
          return `%${character.charCodeAt(0).toString(16)}`;
        })
        .join(""),
    ],
    ["it twice", `${TOKEN}${TOKEN}`],
    ["the whole credential", `${SUBSCRIBER_ID}-${TOKEN}`],
  ])(
    "the token with %s opens nothing",
    async (_label: string, token: string) => {
      expectRefusedAsAnInvalidLink(await readSubscription({ token }));
      expectRefusedAsAnInvalidLink(await cancelSubscription({ token }));

      expect(sentSubscribers()).toHaveLength(0);
      expect(isCancelled(SUBSCRIBER_ID)).toBe(false);
    },
  );

  test("the link's holder changes what the subscription hears about - never where it goes, nor anything the team set", async () => {
    // A page that lets subscribers choose, and takes every channel.
    useInMemoryTable(StatusPageService, [
      {
        _id: PUBLIC_PAGE_ID,
        projectId: PROJECT_ID.toString(),
        name: "Acme Status",
        isPublicStatusPage: true,
        showSubscriberPageOnStatusPage: true,
        enableEmailSubscribers: true,
        enableSmsSubscribers: true,
        enableSlackSubscribers: true,
        enableMicrosoftTeamsSubscribers: true,
        enableWebhookSubscribers: true,
        allowSubscribersToChooseResources: true,
        allowSubscribersToChooseEventTypes: true,
        isArchived: false,
      },
    ]);

    const error: Error | undefined = await callRoute("PUT", UPDATE_ROUTE, {
      params: {
        statusPageId: PUBLIC_PAGE_ID,
        subscriberId: SUBSCRIBER_ID,
        token: TOKEN,
      },
      body: {
        data: {
          // The choices the page offers.
          isSubscribedToAllResources: false,
          statusPageResources: [],
          isSubscribedToAllEventTypes: false,
          statusPageEventTypes: [],
          // Everything else a request could name.
          subscriberEmail: "someone-else@example.com",
          subscriberPhone: "+15555550999",
          slackIncomingWebhookUrl:
            "https://hooks.slack.com/services/T000/B000/elsewhere",
          slackWorkspaceName: "Elsewhere",
          microsoftTeamsIncomingWebhookUrl:
            "https://example.webhook.office.com/webhookb2/elsewhere",
          microsoftTeamsWorkspaceName: "Elsewhere",
          subscriberWebhook: "https://example.com/elsewhere",
          statusPageId: OTHER_PUBLIC_PAGE_ID,
          projectId: OTHER_PROJECT_ID.toString(),
          unsubscribeToken: OTHER_TOKEN,
          isAddedByTeam: true,
          isSubscriptionConfirmed: false,
          sendYouHaveSubscribedMessage: false,
        },
      },
    });

    expect(error).toBeUndefined();

    const calls: Array<Array<unknown>> = (
      StatusPageSubscriberService.updateFromManageSubscriptionPage as unknown as MockedFn
    ).mock.calls as Array<Array<unknown>>;

    expect(calls).toHaveLength(1);

    const written: JSONObject = (calls[0]![0] as { data: JSONObject }).data;

    expect(Object.keys(written).sort()).toEqual(
      [
        "isSubscribedToAllEventTypes",
        "isSubscribedToAllResources",
        "isUnsubscribed",
        "statusPageEventTypes",
        "statusPageResources",
      ].sort(),
    );

    // The subscription itself, as stored: where it goes and what the team set.
    const stored: StoredRow = subscribers.get(SUBSCRIBER_ID)!;

    expect(stored["subscriberPhone"]).toBe(PHONE);
    expect(stored["subscriberEmail"]).toBeUndefined();
    expect(stored["subscriberWebhook"]).toBeUndefined();
    expect(stored["statusPageId"]).toBe(PUBLIC_PAGE_ID);
    expect(stored["projectId"]).toBe(PROJECT_ID.toString());
    expect(stored["unsubscribeToken"]).toBe(TOKEN);
  });
});
