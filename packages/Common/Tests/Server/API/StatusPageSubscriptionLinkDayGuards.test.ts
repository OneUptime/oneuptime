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
 * THE DAY A LINK TO CONFIRM A SUBSCRIPTION WORKS IS THE SERVER'S, AND A
 * SUBSCRIPTION IS REPLACED ONLY BY A NEW ONE OF ITS OWN CONTACT.
 *
 * A link to confirm a subscription works for a day from when its
 * subscription was created (StatusPageSubscriberConfirmationCode). While it
 * works it holds its contact on its page; once it has run out, the
 * contact's next subscription there replaces it
 * (StatusPageSubscriptionLinkExpiry.test.ts drives that rule itself).
 *
 * These hold the rule's edges, through the real routes (SubscriberWorld):
 *
 *  - a sign-up says nothing about its own day, its code or its state: what
 *    it sends of them is never taken - and the team's create mints its own
 *    code too;
 *  - nothing else done to a waiting subscription - a manage link asked
 *    for, its manage page saved, the team's note on it - moves its day on;
 *  - a new subscription replaces only a subscription of its own contact,
 *    on its own page, whose link has run out - never another contact's,
 *    another page's or a confirmed one - and a create that is refused, for
 *    whatever reason, replaces nothing;
 *  - every role that may add subscribers replaces a run-out sign-up, and
 *    is refused, never told to come back later, while its link works;
 *  - the check made again with the INSERT, under the page's lock, reads
 *    what the page holds by then: a run-out subscription the team marked
 *    Subscribed in the meantime holds its contact, and so does the new
 *    subscription another create made of it first.
 */

jest.mock("../../../Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
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
      sendEntityArrayResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
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
      getLogLevel: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

import StatusPageSubscriberService, {
  ALREADY_SUBSCRIBED_MESSAGE,
  CONFIRMATION_LINK_SENT_TO_EMAIL_MESSAGE,
  CONTACT_ALREADY_SUBSCRIBED_MESSAGE,
} from "../../../Server/Services/StatusPageSubscriberService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import PublicMessageRateLimit, {
  PublicMessageKind,
} from "../../../Server/Utils/RateLimit/PublicMessageRateLimit";
import StatusPageSubscriberConfirmationCode from "../../../Server/Utils/StatusPage/StatusPageSubscriberConfirmationCode";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { customDomainCaller } from "./CustomDomainCallers";
import { StoredRow } from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  Answer,
  MANAGE_ROUTE,
  SubscriberWorld,
  WORLD_PAGE_ID,
  WORLD_PROJECT_ID,
  callRoute,
  confirm,
  pageIdOf,
  registerSubscriberRoutes,
  rowsOf,
  setUpSubscriberWorld,
  signUp,
  teamAdd,
  teamCaller,
  teamUpdate,
} from "./SubscriberWorld";

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const EMAIL: string = "owner@example.com";
const OTHER_EMAIL: string = "someone@example.com";

const SOMEONE_ELSE: string = "198.51.100.66";
const THE_OWNER: string = "203.0.113.5";

// The visitor's own manage page, saving a change.
const MANAGE_UPDATE_ROUTE: string =
  "/status-page/update-subscription/:statusPageId/:subscriberId/:token";

let world: SubscriberWorld;

beforeAll(() => {
  registerSubscriberRoutes();
});

beforeEach(() => {
  world = setUpSubscriberWorld();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The links to confirm a subscription that were emailed, in order.
function confirmationEmailsSent(): number {
  return world.emails.mock.calls.filter((call: Array<unknown>): boolean => {
    return (
      (call[0] as { templateType: EmailTemplateType }).templateType ===
      EmailTemplateType.ConfirmStatusPageSubscription
    );
  }).length;
}

// Every message sent on any channel.
function messagesSent(): number {
  return (
    world.emails.mock.calls.length +
    world.texts.mock.calls.length +
    world.webhookCalls.mock.calls.length +
    world.slackPosts.mock.calls.length +
    world.teamsPosts.mock.calls.length
  );
}

function createdAtOf(row: StoredRow): number {
  return new Date(row["createdAt"] as Date | string).getTime();
}

/*
 * A subscription of `email` on `pageId`, stored as a row of its own: one
 * waiting for its confirmation since `sentAgo`, or confirmed then.
 */
function stored(data: {
  email: string;
  pageId?: string;
  sentAgo: number;
  isSubscriptionConfirmed?: boolean;
}): StoredRow {
  const row: StoredRow = {
    _id: ObjectID.generate().toString(),
    projectId: WORLD_PROJECT_ID,
    statusPageId: data.pageId || WORLD_PAGE_ID,
    subscriberEmail: data.email,
    isUnsubscribed: false,
    isSubscriptionConfirmed: data.isSubscriptionConfirmed === true,
    subscriptionConfirmationToken:
      StatusPageSubscriberConfirmationCode.generate(),
    sendYouHaveSubscribedMessage: true,
    unsubscribeToken: StatusPageSubscriberConfirmationCode.generate(),
    isAddedByTeam: false,
    version: 1,
    createdAt: new Date(Date.now() - data.sentAgo),
  };

  world.subscribers.rows.push(row);

  return row;
}

function isStored(row: StoredRow): boolean {
  return world.subscribers.get(String(row["_id"])) !== undefined;
}

describe("what a sign-up sends about its own day, code and state is not taken", () => {
  test.each([
    ["a year ahead", 365 * DAY],
    ["a year back", -365 * DAY],
  ])(
    "a sign-up naming its Created At %s, its own code and token, a confirmed state and the team as its adder: it waits from the moment it is created, with a code of its own, and holds its contact for that one day",
    async (_label: string, offset: number) => {
      const signedUpAt: number = Date.now();
      const givenId: string = ObjectID.generate().toString();

      const answer: Answer = await signUp(SOMEONE_ELSE, {
        subscriberEmail: EMAIL,
        createdAt: new Date(signedUpAt + offset).toISOString(),
        isSubscriptionConfirmed: true,
        subscriptionConfirmationToken: "482913",
        unsubscribeToken: "ab".repeat(32),
        isAddedByTeam: true,
        isUnsubscribed: false,
        _id: givenId,
        version: 99,
      } as JSONObject);

      expect(answer.error).toBeUndefined();

      const rows: Array<StoredRow> = rowsOf(world);
      expect(rows).toHaveLength(1);

      const row: StoredRow = rows[0]!;

      // Its day starts when it was created, by the server's clock.
      expect(createdAtOf(row)).toBe(signedUpAt);
      expect(row["isSubscriptionConfirmed"]).toBe(false);
      expect(row["isAddedByTeam"]).toBe(false);
      expect(String(row["_id"])).not.toBe(givenId);

      const code: unknown = row["subscriptionConfirmationToken"];
      expect(StatusPageSubscriberConfirmationCode.isCurrent(code)).toBe(true);
      expect(row["unsubscribeToken"]).not.toBe("ab".repeat(32));
      expect(confirmationEmailsSent()).toBe(1);

      // The code it named confirms nothing.
      jest.mocked(Response.sendErrorResponse).mockClear();
      await confirm(String(row["_id"]), "482913");
      expect(
        (
          jest.mocked(Response.sendErrorResponse).mock.calls[0]?.[2] as
            | Exception
            | undefined
        )?.message,
      ).toBe("Subscriber not found or confirmation token is invalid");
      expect(row["isSubscriptionConfirmed"]).toBe(false);

      // It holds the contact for a day from its creation, to the second.
      world.advance(DAY - HOUR);

      const held: Answer = await signUp(THE_OWNER, { subscriberEmail: EMAIL });
      expect(held.error?.message).toBe(CONFIRMATION_LINK_SENT_TO_EMAIL_MESSAGE);
      expect(held.retryAfter).toBe(String(HOUR / 1000));

      // And no longer than that.
      world.advance(HOUR);

      expect(
        (await signUp(THE_OWNER, { subscriberEmail: EMAIL })).error,
      ).toBeUndefined();
      expect(world.subscribers.get(String(row["_id"]))).toBeUndefined();
      expect(confirmationEmailsSent()).toBe(2);
    },
  );
});

describe("what the team sends of a code is not taken either", () => {
  test("a subscriber the team asks to confirm first, created with a code of the team's: it gets a code of its own, and the team's confirms nothing", async () => {
    expect(
      (
        await teamAdd({
          subscriberEmail: EMAIL,
          isSubscriptionConfirmed: false,
          subscriptionConfirmationToken: "482913",
        })
      ).error,
    ).toBeUndefined();

    const rows: Array<StoredRow> = rowsOf(world);
    expect(rows).toHaveLength(1);

    const row: StoredRow = rows[0]!;
    const code: unknown = row["subscriptionConfirmationToken"];

    expect(code).not.toBe("482913");
    expect(StatusPageSubscriberConfirmationCode.isCurrent(code)).toBe(true);
    expect(confirmationEmailsSent()).toBe(1);

    jest.mocked(Response.sendErrorResponse).mockClear();
    await confirm(String(row["_id"]), "482913");
    expect(
      (
        jest.mocked(Response.sendErrorResponse).mock.calls[0]?.[2] as
          | Exception
          | undefined
      )?.message,
    ).toBe("Subscriber not found or confirmation token is invalid");
    expect(row["isSubscriptionConfirmed"]).toBe(false);

    // The link the email carries confirms it.
    jest.mocked(Response.sendErrorResponse).mockClear();
    await confirm(String(row["_id"]), String(code));
    expect(Response.sendErrorResponse).not.toHaveBeenCalled();
    expect(row["isSubscriptionConfirmed"]).toBe(true);
  });
});

describe("nothing done to a waiting subscription moves its day on", () => {
  test("asking for a manage link, saving its manage page and the team's note on it leave its day where it began", async () => {
    const signedUpAt: number = Date.now();

    expect(
      (await signUp(SOMEONE_ELSE, { subscriberEmail: EMAIL })).error,
    ).toBeUndefined();

    const row: StoredRow = rowsOf(world)[0]!;

    world.advance(23 * HOUR);

    // A manage link asked for, by the contact.
    expect(
      (
        await callRoute("post", MANAGE_ROUTE, {
          from: THE_OWNER,
          params: { statusPageId: WORLD_PAGE_ID },
          body: { data: { subscriberEmail: EMAIL } },
        })
      ).error,
    ).toBeUndefined();

    // Its manage page saved.
    expect(
      (
        await callRoute("put", MANAGE_UPDATE_ROUTE, {
          from: THE_OWNER,
          params: {
            statusPageId: WORLD_PAGE_ID,
            subscriberId: String(row["_id"]),
            token: String(row["unsubscribeToken"]),
          },
          body: { data: { isUnsubscribed: false } },
        })
      ).error,
    ).toBeUndefined();

    // The team's note on it.
    expect(
      (
        await teamUpdate(String(row["_id"]), {
          internalNote: "Asked us about the outage.",
        })
      ).error,
    ).toBeUndefined();
    expect(row["internalNote"]).toBe("Asked us about the outage.");

    // Its day is where it began: an hour left of it.
    expect(createdAtOf(row)).toBe(signedUpAt);
    expect(row["isSubscriptionConfirmed"]).toBe(false);

    const held: Answer = await signUp(THE_OWNER, { subscriberEmail: EMAIL });
    expect(held.error?.message).toBe(CONFIRMATION_LINK_SENT_TO_EMAIL_MESSAGE);
    expect(held.retryAfter).toBe(String(HOUR / 1000));

    world.advance(HOUR);

    expect(
      (await signUp(THE_OWNER, { subscriberEmail: EMAIL })).error,
    ).toBeUndefined();
    expect(isStored(row)).toBe(false);
  });
});

describe("a new subscription replaces only its own contact's run-out subscription, on its own page", () => {
  test("another contact's, another page's and a confirmed one stay, however old", async () => {
    /*
     * Run out too, newer and stored first: a removal that reached past the
     * contact's own subscriptions on the page would come to them first.
     */
    const otherContact: StoredRow = stored({
      email: OTHER_EMAIL,
      sentAgo: 2 * DAY,
    });
    const otherPage: StoredRow = stored({
      email: EMAIL,
      pageId: pageIdOf(1),
      sentAgo: 2 * DAY,
    });
    const replaced: StoredRow = stored({ email: EMAIL, sentAgo: 3 * DAY });
    const confirmedLongAgo: StoredRow = stored({
      email: EMAIL,
      pageId: pageIdOf(2),
      sentAgo: 400 * DAY,
      isSubscriptionConfirmed: true,
    });

    expect(
      (await signUp(THE_OWNER, { subscriberEmail: EMAIL })).error,
    ).toBeUndefined();

    expect(world.subscribers.deletes).toEqual([String(replaced["_id"])]);
    expect(isStored(otherContact)).toBe(true);
    expect(isStored(otherPage)).toBe(true);

    // On its page, the confirmed one is subscribed still: nothing replaces it.
    const refused: Answer = await signUp(
      THE_OWNER,
      { subscriberEmail: EMAIL },
      pageIdOf(2),
    );

    expect(refused.error?.message).toBe(ALREADY_SUBSCRIBED_MESSAGE);
    expect(refused.retryAfter).toBeUndefined();
    expect(isStored(confirmedLongAgo)).toBe(true);
    expect(confirmedLongAgo["isSubscriptionConfirmed"]).toBe(true);
    expect(world.subscribers.deletes).toEqual([String(replaced["_id"])]);
  });
});

describe("a create that is refused replaces nothing", () => {
  /*
   * Callers the team's REST create refuses: who may not add subscribers,
   * a member of another project, and nobody signed in at all.
   */
  const REFUSED_CALLERS: Array<[string, () => DatabaseCommonInteractionProps]> =
    [
      [
        "a Viewer",
        (): DatabaseCommonInteractionProps => {
          return teamCaller([Permission.Viewer]);
        },
      ],
      [
        "a Status Page Viewer",
        (): DatabaseCommonInteractionProps => {
          return teamCaller([Permission.StatusPageViewer]);
        },
      ],
      [
        "a member who may only read subscribers",
        (): DatabaseCommonInteractionProps => {
          return teamCaller([Permission.ReadStatusPageSubscriber]);
        },
      ],
      [
        "a member who may only edit subscribers",
        (): DatabaseCommonInteractionProps => {
          return teamCaller([Permission.EditStatusPageSubscriber]);
        },
      ],
      [
        "an API key that may only read subscribers",
        (): DatabaseCommonInteractionProps => {
          return teamCaller([Permission.ReadStatusPageSubscriber], {
            isApiKey: true,
          });
        },
      ],
      [
        "the owner of another project",
        (): DatabaseCommonInteractionProps => {
          return {
            ...customDomainCaller({
              permissions: [Permission.ProjectOwner],
              projectId: ObjectID.generate(),
            }),
            ...ON_HIGHEST_PLAN,
          };
        },
      ],
      [
        "nobody signed in, naming the project",
        (): DatabaseCommonInteractionProps => {
          return {
            userType: UserType.Public,
            tenantId: new ObjectID(WORLD_PROJECT_ID),
          };
        },
      ],
    ];

  test.each(REFUSED_CALLERS)(
    "%s adding the contact of a run-out sign-up through the REST create: refused, and the sign-up stays",
    async (_label: string, caller: () => DatabaseCommonInteractionProps) => {
      const runOut: StoredRow = stored({ email: EMAIL, sentAgo: 2 * DAY });

      // The page is the project's, and no other project's, as Postgres says.
      stubProjectDirectory({ projectId: new ObjectID(WORLD_PROJECT_ID) });

      world.teamProps = caller();

      const answer: Answer = await teamAdd({
        subscriberEmail: EMAIL,
        isSubscriptionConfirmed: true,
      });

      expect(answer.error).toBeDefined();
      expect(isStored(runOut)).toBe(true);
      expect(world.subscribers.deletes).toEqual([]);
      expect(rowsOf(world)).toHaveLength(1);
      expect(messagesSent()).toBe(0);
    },
  );

  test("a sign-up the page refuses once its contact was looked up - an address outside the domains the page takes - leaves the run-out sign-up as it was", async () => {
    const runOut: StoredRow = stored({ email: EMAIL, sentAgo: 2 * DAY });

    // The page now takes addresses at one domain only.
    await changePage({ allowedSubscriberEmailDomains: "acme.com" });

    const answer: Answer = await signUp(THE_OWNER, { subscriberEmail: EMAIL });

    expect(answer.error).toBeDefined();
    expect(isStored(runOut)).toBe(true);
    expect(world.subscribers.deletes).toEqual([]);
    expect(rowsOf(world)).toHaveLength(1);
    expect(messagesSent()).toBe(0);
  });
});

describe("every role that adds subscribers is held to the same day", () => {
  const ADDERS: Array<[string, () => DatabaseCommonInteractionProps]> = [
    [
      "a Project Owner",
      (): DatabaseCommonInteractionProps => {
        return teamCaller([Permission.ProjectOwner]);
      },
    ],
    [
      "a Project Admin",
      (): DatabaseCommonInteractionProps => {
        return teamCaller([Permission.ProjectAdmin]);
      },
    ],
    [
      "a Project Member",
      (): DatabaseCommonInteractionProps => {
        return teamCaller([Permission.ProjectMember]);
      },
    ],
    [
      "a Status Page Admin",
      (): DatabaseCommonInteractionProps => {
        return teamCaller([Permission.StatusPageAdmin]);
      },
    ],
    [
      "a Status Page Member",
      (): DatabaseCommonInteractionProps => {
        return teamCaller([Permission.StatusPageMember]);
      },
    ],
    [
      "a member who may read status pages and add subscribers",
      (): DatabaseCommonInteractionProps => {
        return teamCaller([
          Permission.ReadProjectStatusPage,
          Permission.CreateStatusPageSubscriber,
        ]);
      },
    ],
    [
      "an API key that may read status pages and add subscribers",
      (): DatabaseCommonInteractionProps => {
        return teamCaller(
          [
            Permission.ReadProjectStatusPage,
            Permission.CreateStatusPageSubscriber,
          ],
          { isApiKey: true },
        );
      },
    ],
  ];

  test.each(ADDERS)(
    "%s: refused while a sign-up's link works - told the rule, never to come back later - and replacing it once the link has run out",
    async (_label: string, caller: () => DatabaseCommonInteractionProps) => {
      expect(
        (await signUp(SOMEONE_ELSE, { subscriberEmail: EMAIL })).error,
      ).toBeUndefined();

      const signUpRow: StoredRow = rowsOf(world)[0]!;

      stubProjectDirectory({ projectId: new ObjectID(WORLD_PROJECT_ID) });

      world.teamProps = caller();
      world.advance(DAY - MINUTE);

      const refused: Answer = await teamAdd({
        subscriberEmail: EMAIL,
        isSubscriptionConfirmed: true,
      });

      expect(refused.error?.message).toBe(CONTACT_ALREADY_SUBSCRIBED_MESSAGE);
      expect(refused.retryAfter).toBeUndefined();
      expect(isStored(signUpRow)).toBe(true);

      world.advance(MINUTE);

      expect(
        (
          await teamAdd({
            subscriberEmail: EMAIL,
            isSubscriptionConfirmed: true,
          })
        ).error,
      ).toBeUndefined();

      expect(isStored(signUpRow)).toBe(false);

      const rows: Array<StoredRow> = rowsOf(world);
      expect(rows).toHaveLength(1);
      expect(rows[0]!["isSubscriptionConfirmed"]).toBe(true);
      expect(rows[0]!["isAddedByTeam"]).toBe(true);
    },
  );
});

describe("the INSERT is decided with what the page holds by then", () => {
  type CreateLimitReader = (createBy: unknown) => Promise<unknown>;

  /*
   * The create's check made again with its INSERT, under the page's lock
   * (getCreateLimit): `meanwhile` runs once a create has passed every early
   * check, right before that one is made.
   */
  function beforeTheInsert(meanwhile: () => Promise<void>): void {
    const service: { getCreateLimit: CreateLimitReader } =
      StatusPageSubscriberService as unknown as {
        getCreateLimit: CreateLimitReader;
      };
    const original: CreateLimitReader = service.getCreateLimit.bind(
      StatusPageSubscriberService,
    );

    jest
      .spyOn(service, "getCreateLimit")
      .mockImplementationOnce(async (createBy: unknown): Promise<unknown> => {
        await meanwhile();
        return await original(createBy);
      });
  }

  // A contact's sign-ups counted in this hour (PublicMessageRateLimit).
  function signUpsCountedFor(email: string): number {
    return world.redis.count(
      PublicMessageRateLimit.getContactCounterKey({
        counterName: PublicMessageKind.StatusPageSignUp,
        contact: PublicMessageRateLimit.forEmail(email),
      }),
    );
  }

  test("a run-out sign-up the team marks Subscribed while a new sign-up of its contact is on its way: the new one is refused at its INSERT, and the subscribed one stays", async () => {
    const runOut: StoredRow = stored({ email: EMAIL, sentAgo: 2 * DAY });

    beforeTheInsert(async (): Promise<void> => {
      expect(
        (
          await teamUpdate(String(runOut["_id"]), {
            isSubscriptionConfirmed: true,
          })
        ).error,
      ).toBeUndefined();
    });

    const answer: Answer = await signUp(THE_OWNER, { subscriberEmail: EMAIL });

    expect(answer.error?.message).toBe(ALREADY_SUBSCRIBED_MESSAGE);
    expect(answer.error?.code).toBe(400);
    expect(answer.retryAfter).toBeUndefined();

    expect(isStored(runOut)).toBe(true);
    expect(runOut["isSubscriptionConfirmed"]).toBe(true);
    expect(rowsOf(world)).toHaveLength(1);
    expect(world.subscribers.deletes).toEqual([]);
    expect(messagesSent()).toBe(0);
    // Nothing was sent to it: the contact's count is given back.
    expect(signUpsCountedFor(EMAIL)).toBe(0);
  });

  test("two sign-ups of a contact whose sign-up ran out, the second reaching its INSERT after the first is done: the first replaces it with a new link, the second is told that link was sent", async () => {
    const runOut: StoredRow = stored({ email: EMAIL, sentAgo: 2 * DAY });

    let first: Answer | undefined;

    // The second passed its early checks with the run-out one still there.
    beforeTheInsert(async (): Promise<void> => {
      first = await signUp(SOMEONE_ELSE, { subscriberEmail: EMAIL });
    });

    const second: Answer = await signUp(THE_OWNER, { subscriberEmail: EMAIL });

    expect(first?.error).toBeUndefined();

    expect(second.error?.message).toBe(CONFIRMATION_LINK_SENT_TO_EMAIL_MESSAGE);
    expect(second.error?.code).toBe(429);
    expect(second.retryAfter).toBe(String(DAY / 1000));

    // The first one's subscription, alone, with the one link it sent.
    expect(isStored(runOut)).toBe(false);
    expect(world.subscribers.deletes).toEqual([String(runOut["_id"])]);

    const rows: Array<StoredRow> = rowsOf(world);
    expect(rows).toHaveLength(1);
    expect(rows[0]!["isSubscriptionConfirmed"]).toBe(false);
    expect(confirmationEmailsSent()).toBe(1);
    expect(messagesSent()).toBe(1);

    // Only the sign-up that sent the link is counted against the contact.
    expect(signUpsCountedFor(EMAIL)).toBe(1);
  });

  test("the team adding a contact whose sign-up ran out, a visitor's sign-up of it reaching its INSERT first: the team is refused, saying the rule", async () => {
    const runOut: StoredRow = stored({ email: EMAIL, sentAgo: 2 * DAY });

    let visitor: Answer | undefined;

    beforeTheInsert(async (): Promise<void> => {
      visitor = await signUp(THE_OWNER, { subscriberEmail: EMAIL });
    });

    const team: Answer = await teamAdd({
      subscriberEmail: EMAIL,
      isSubscriptionConfirmed: true,
    });

    expect(visitor?.error).toBeUndefined();

    expect(team.error?.message).toBe(CONTACT_ALREADY_SUBSCRIBED_MESSAGE);
    expect(team.retryAfter).toBeUndefined();

    expect(isStored(runOut)).toBe(false);

    const rows: Array<StoredRow> = rowsOf(world);
    expect(rows).toHaveLength(1);
    expect(rows[0]!["isAddedByTeam"]).toBe(false);
    expect(rows[0]!["isSubscriptionConfirmed"]).toBe(false);
    expect(confirmationEmailsSent()).toBe(1);
  });
});

// Changes the page's own settings, as its settings page does.
async function changePage(set: StoredRow): Promise<void> {
  const repository: {
    update: (where: unknown, values: StoredRow) => Promise<unknown>;
  } = StatusPageService.getRepository() as unknown as {
    update: (where: unknown, values: StoredRow) => Promise<unknown>;
  };

  await repository.update({ _id: WORLD_PAGE_ID }, set);
}
