import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import MailService from "../../../Server/Services/MailService";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService, {
  CONTACT_ALREADY_SUBSCRIBED_MESSAGE,
} from "../../../Server/Services/StatusPageSubscriberService";
import StatusPageSubscriberConfirmationCode from "../../../Server/Utils/StatusPage/StatusPageSubscriberConfirmationCode";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { rowMatchesWhere } from "../TestingUtils/InMemoryRepository";

/*
 * The records these tests name are their project's own: the services check
 * every reference against the project (ProjectReferencesService).
 */
beforeEach(() => {
  stubProjectDirectory({});
});

jest.mock("../../../Server/Utils/Logger");

/*
 * SUBSCRIBING AGAIN REPLACES A CANCELLED SUBSCRIPTION ONLY ONCE THE NEW ONE
 * EXISTS.
 *
 * Someone who cancelled their subscription to a status page and subscribes
 * again gets a new subscription - with a new unsubscribe token, so links to
 * the old one stop working - and the cancelled row is removed. That removal
 * used to happen in onBeforeCreate, before the permission check and before
 * the new row was saved. It now happens in onCreateSuccess, only for a
 * cancelled row of the same status page and project as the new subscriber.
 *
 * Until it does, the contact has both rows, so onBeforeCreate reads all of
 * the contact's rows on the page: any active one refuses the new
 * subscription, whichever row a database happens to return first. The team
 * is told which rule it runs into (a visitor signing up is told they are
 * subscribed already: StatusPageSubscriberContactOnce.test.ts).
 *
 * A subscription still waiting for its confirmation is active while the
 * link to it works - a day after it was sent - and is replaced like a
 * cancelled one once the link has run out
 * (StatusPageSubscriptionLinkExpiry.test.ts walks it through the routes).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1e000000-0000-4000-8000-000000000001",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "1e000000-0000-4000-8000-000000000002",
);
const OLD_SUBSCRIBER_ID: ObjectID = new ObjectID(
  "1e000000-0000-4000-8000-000000000003",
);
const NEW_SUBSCRIBER_ID: ObjectID = new ObjectID(
  "1e000000-0000-4000-8000-000000000004",
);
const OLDER_SUBSCRIBER_ID: ObjectID = new ObjectID(
  "1e000000-0000-4000-8000-000000000005",
);

type BeforeCreate = (
  createBy: CreateBy<StatusPageSubscriber>,
) => Promise<OnCreate<StatusPageSubscriber>>;

type CreateSuccess = (
  onCreate: OnCreate<StatusPageSubscriber>,
  createdItem: StatusPageSubscriber,
) => Promise<StatusPageSubscriber>;

const hooks: { onBeforeCreate: BeforeCreate; onCreateSuccess: CreateSuccess } =
  StatusPageSubscriberService as unknown as {
    onBeforeCreate: BeforeCreate;
    onCreateSuccess: CreateSuccess;
  };

let deleteBy: jest.SpyInstance;

function subscriber(): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row.projectId = PROJECT_ID;
  row.statusPageId = STATUS_PAGE_ID;
  row.subscriberEmail = new Email("ops@acme.test");
  row.isSubscriptionConfirmed = true;
  return row;
}

const HOUR: number = 60 * 60 * 1000;

// A subscription of the contact, confirmed a week ago: on, or cancelled since.
function existingSubscription(
  isUnsubscribed: boolean,
  id: ObjectID = OLD_SUBSCRIBER_ID,
): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = id.toString();
  row.isUnsubscribed = isUnsubscribed;
  row.isSubscriptionConfirmed = true;
  row.createdAt = new Date(Date.now() - 7 * 24 * HOUR);
  return row;
}

// A subscription of the contact waiting for its confirmation, sent `hoursAgo`.
function waitingSubscription(
  hoursAgo: number,
  id: ObjectID = OLD_SUBSCRIBER_ID,
): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = id.toString();
  row.isUnsubscribed = false;
  row.isSubscriptionConfirmed = false;
  row.createdAt = new Date(Date.now() - hoursAgo * HOUR);
  return row;
}

// The contact's rows on the page, as the lookup returns them.
function contactHas(rows: Array<StatusPageSubscriber>): jest.SpyInstance {
  return getJestSpyOn(StatusPageSubscriberService, "findBy").mockResolvedValue(
    rows,
  );
}

function replacedIds(result: OnCreate<StatusPageSubscriber>): Array<string> {
  return (
    result.carryForward as { replacedSubscriberIds: Array<ObjectID> }
  ).replacedSubscriberIds.map((id: ObjectID): string => {
    return id.toString();
  });
}

beforeEach(() => {
  getJestSpyOn(
    StatusPageSubscriberService,
    "getStatusPagesToSendNotification",
  ).mockImplementation(async (): Promise<Array<StatusPage>> => {
    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID.toString();
    page.projectId = PROJECT_ID;
    page.name = "Acme Status";
    return [page];
  });
  getJestSpyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: null,
    isSubscriptionUnpaid: false,
  } as never);
  getJestSpyOn(StatusPageService, "getStatusPageURL").mockResolvedValue(
    "https://status.acme.test",
  );
  getJestSpyOn(MailService, "sendMail").mockResolvedValue(undefined);
  deleteBy = getJestSpyOn(
    StatusPageSubscriberService,
    "deleteBy",
  ).mockResolvedValue(1);
  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("onBeforeCreate", () => {
  test("a contact who cancelled is let through, and the cancelled row is not touched yet", async () => {
    contactHas([existingSubscription(true)]);

    const result: OnCreate<StatusPageSubscriber> = await hooks.onBeforeCreate({
      data: subscriber(),
      props: { isRoot: true },
    });

    expect(deleteBy).not.toHaveBeenCalled();
    expect(replacedIds(result)).toEqual([OLD_SUBSCRIBER_ID.toString()]);
    expect(
      (result.carryForward as { statusPage: StatusPage }).statusPage.name,
    ).toBe("Acme Status");
  });

  test("it reads every row the contact has on the page, not just one", async () => {
    const findBy: jest.SpyInstance = contactHas([]);

    await hooks.onBeforeCreate({ data: subscriber(), props: { isRoot: true } });

    expect(findBy).toHaveBeenCalledTimes(1);
    const request: {
      query: Record<string, unknown>;
      limit: number;
      skip: number;
    } = findBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      limit: number;
      skip: number;
    };
    expect(String(request.query["statusPageId"])).toBe(
      STATUS_PAGE_ID.toString(),
    );
    // Only the subscriber's own project's rows: the page id alone pins nothing.
    expect(String(request.query["projectId"])).toBe(PROJECT_ID.toString());
    // The address, however it is written (case aside: Email stores lower case).
    expect(
      rowMatchesWhere(
        { subscriberEmail: "OPS@Acme.test" },
        { subscriberEmail: request.query["subscriberEmail"] },
      ),
    ).toBe(true);
    expect(
      rowMatchesWhere(
        { subscriberEmail: "other@acme.test" },
        { subscriberEmail: request.query["subscriberEmail"] },
      ),
    ).toBe(false);
    expect(request.limit).toBeGreaterThan(1);
    expect(request.skip).toBe(0);
  });

  test("a contact who is still subscribed is refused, and nothing is removed", async () => {
    contactHas([existingSubscription(false)]);

    await expect(
      hooks.onBeforeCreate({ data: subscriber(), props: { isRoot: true } }),
    ).rejects.toThrow(CONTACT_ALREADY_SUBSCRIBED_MESSAGE);

    expect(deleteBy).not.toHaveBeenCalled();
  });

  test.each([
    ["the cancelled row first", [true, false]],
    ["the active row first", [false, true]],
  ])(
    "a contact with a cancelled and an active row is refused, with %s",
    async (_order: string, unsubscribed: Array<boolean>) => {
      contactHas([
        existingSubscription(unsubscribed[0]!, OLD_SUBSCRIBER_ID),
        existingSubscription(unsubscribed[1]!, NEW_SUBSCRIBER_ID),
      ]);

      await expect(
        hooks.onBeforeCreate({ data: subscriber(), props: { isRoot: true } }),
      ).rejects.toThrow(CONTACT_ALREADY_SUBSCRIBED_MESSAGE);

      expect(deleteBy).not.toHaveBeenCalled();
    },
  );

  test("every cancelled row of the contact is replaced", async () => {
    contactHas([
      existingSubscription(true, OLD_SUBSCRIBER_ID),
      existingSubscription(true, OLDER_SUBSCRIBER_ID),
    ]);

    const result: OnCreate<StatusPageSubscriber> = await hooks.onBeforeCreate({
      data: subscriber(),
      props: { isRoot: true },
    });

    expect(replacedIds(result)).toEqual([
      OLD_SUBSCRIBER_ID.toString(),
      OLDER_SUBSCRIBER_ID.toString(),
    ]);
  });

  test("a contact whose subscription waits for its confirmation, its link sent an hour ago, is refused, and nothing is removed", async () => {
    contactHas([waitingSubscription(1)]);

    await expect(
      hooks.onBeforeCreate({ data: subscriber(), props: { isRoot: true } }),
    ).rejects.toThrow(CONTACT_ALREADY_SUBSCRIBED_MESSAGE);

    expect(deleteBy).not.toHaveBeenCalled();
  });

  test.each([
    ["a day ago", 24],
    ["two days ago", 48],
    ["a year ago", 365 * 24],
  ])(
    "a contact whose subscription waited for its confirmation since %s, its link run out, is let through, and that subscription is replaced",
    async (_when: string, hoursAgo: number) => {
      contactHas([waitingSubscription(hoursAgo)]);

      const result: OnCreate<StatusPageSubscriber> = await hooks.onBeforeCreate(
        {
          data: subscriber(),
          props: { isRoot: true },
        },
      );

      expect(replacedIds(result)).toEqual([OLD_SUBSCRIBER_ID.toString()]);
      // Not yet: only once the new subscription exists (onCreateSuccess).
      expect(deleteBy).not.toHaveBeenCalled();
    },
  );

  test("a waiting subscription whose age cannot be told is taken as run out", async () => {
    const row: StatusPageSubscriber = waitingSubscription(1);
    delete (row as unknown as Record<string, unknown>)["createdAt"];
    contactHas([row]);

    const result: OnCreate<StatusPageSubscriber> = await hooks.onBeforeCreate({
      data: subscriber(),
      props: { isRoot: true },
    });

    expect(replacedIds(result)).toEqual([OLD_SUBSCRIBER_ID.toString()]);
  });

  test("a run-out waiting subscription beside a confirmed one still refuses: the confirmed one holds the contact", async () => {
    contactHas([
      waitingSubscription(48, OLD_SUBSCRIBER_ID),
      existingSubscription(false, OLDER_SUBSCRIBER_ID),
    ]);

    await expect(
      hooks.onBeforeCreate({ data: subscriber(), props: { isRoot: true } }),
    ).rejects.toThrow(CONTACT_ALREADY_SUBSCRIBED_MESSAGE);
  });

  test("a cancelled subscription and a run-out waiting one are both replaced", async () => {
    contactHas([
      existingSubscription(true, OLD_SUBSCRIBER_ID),
      waitingSubscription(30, OLDER_SUBSCRIBER_ID),
    ]);

    const result: OnCreate<StatusPageSubscriber> = await hooks.onBeforeCreate({
      data: subscriber(),
      props: { isRoot: true },
    });

    expect(replacedIds(result)).toEqual([
      OLD_SUBSCRIBER_ID.toString(),
      OLDER_SUBSCRIBER_ID.toString(),
    ]);
  });

  test("a new contact replaces nothing", async () => {
    contactHas([]);

    const result: OnCreate<StatusPageSubscriber> = await hooks.onBeforeCreate({
      data: subscriber(),
      props: { isRoot: true },
    });

    expect(replacedIds(result)).toEqual([]);
  });
});

describe("holdsItsContact", () => {
  const NOW: number = Date.UTC(2032, 5, 1, 12);

  test.each([
    ["on and confirmed, a year ago", false, true, 365 * 24, true],
    [
      "on and confirmed, at an age that cannot be told",
      false,
      true,
      null,
      true,
    ],
    ["on and waiting, its link sent an hour ago", false, false, 1, true],
    [
      "on and waiting, its link sent a minute short of a day ago",
      false,
      false,
      24 - 1 / 60,
      true,
    ],
    ["on and waiting, its link sent a day ago", false, false, 24, false],
    ["on and waiting, its link sent a year ago", false, false, 365 * 24, false],
    [
      "on and waiting, at an age that cannot be told",
      false,
      false,
      null,
      false,
    ],
    ["cancelled, confirmed", true, true, 1, false],
    ["cancelled, waiting, its link sent an hour ago", true, false, 1, false],
  ])(
    "%s: %s",
    (
      _label: string,
      isUnsubscribed: boolean,
      isSubscriptionConfirmed: boolean,
      hoursAgo: number | null,
      holds: boolean,
    ) => {
      expect(
        StatusPageSubscriberService.holdsItsContact(
          {
            isUnsubscribed: isUnsubscribed,
            isSubscriptionConfirmed: isSubscriptionConfirmed,
            ...(hoursAgo === null
              ? {}
              : { createdAt: new Date(NOW - hoursAgo * HOUR) }),
          },
          NOW,
        ),
      ).toBe(holds);
    },
  );
});

describe("onCreateSuccess", () => {
  function created(): StatusPageSubscriber {
    const row: StatusPageSubscriber = subscriber();
    row._id = NEW_SUBSCRIBER_ID.toString();
    return row;
  }

  test("the rows it replaces go once the new subscription exists: cancelled ones, and waiting ones whose link has run out, of the same page and project", async () => {
    // One moment for the delete and for the rows it is asked about.
    const now: number = Date.UTC(2032, 5, 1, 12);
    jest.spyOn(Date, "now").mockReturnValue(now);

    const row: StatusPageSubscriber = created();

    await hooks.onCreateSuccess(
      {
        createBy: { data: row, props: { isRoot: true } },
        carryForward: {
          statusPage: new StatusPage(),
          replacedSubscriberIds: [OLD_SUBSCRIBER_ID, OLDER_SUBSCRIBER_ID],
        },
      },
      row,
    );

    // The cancelled ones, then the waiting ones whose link has run out.
    expect(deleteBy).toHaveBeenCalledTimes(2);

    for (const call of deleteBy.mock.calls) {
      const request: {
        query: Record<string, unknown>;
        limit: number;
        skip: number;
        props: Record<string, unknown>;
      } = call[0] as {
        query: Record<string, unknown>;
        limit: number;
        skip: number;
        props: Record<string, unknown>;
      };
      // QueryHelper.any: the ids are its one parameter, under a random name.
      const pinned: FindOperator<unknown> = request.query[
        "_id"
      ] as FindOperator<unknown>;
      expect(pinned).toBeInstanceOf(FindOperator);
      expect(Object.values(pinned.objectLiteralParameters || {})).toEqual([
        [OLD_SUBSCRIBER_ID.toString(), OLDER_SUBSCRIBER_ID.toString()],
      ]);
      expect(String(request.query["projectId"])).toBe(PROJECT_ID.toString());
      expect(String(request.query["statusPageId"])).toBe(
        STATUS_PAGE_ID.toString(),
      );
      expect(request.limit).toBe(2);
      expect(request.skip).toBe(0);
      expect(request.props).toEqual({ ignoreHooks: true, isRoot: true });
    }

    const cancelled: Record<string, unknown> = (
      deleteBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(cancelled["isUnsubscribed"]).toBe(true);
    expect(cancelled["isSubscriptionConfirmed"]).toBeUndefined();
    expect(cancelled["createdAt"]).toBeUndefined();

    const runOut: Record<string, unknown> = (
      deleteBy.mock.calls[1]![0] as { query: Record<string, unknown> }
    ).query;
    // Cancelled or not: a waiting subscription whose link ran out holds nothing.
    expect(runOut["isUnsubscribed"]).toBeUndefined();
    expect(runOut["isSubscriptionConfirmed"]).toBe(false);

    // Sent at least a day ago, asked as each row is deleted.
    const sentAt: (hoursAgo: number) => { createdAt: Date } = (
      hoursAgo: number,
    ): { createdAt: Date } => {
      return { createdAt: new Date(Date.now() - hoursAgo * HOUR) };
    };

    expect(
      rowMatchesWhere(sentAt(24), { createdAt: runOut["createdAt"] }),
    ).toBe(true);
    expect(
      rowMatchesWhere(sentAt(500), { createdAt: runOut["createdAt"] }),
    ).toBe(true);
    expect(
      rowMatchesWhere(sentAt(23.9), { createdAt: runOut["createdAt"] }),
    ).toBe(false);
    expect(rowMatchesWhere(sentAt(0), { createdAt: runOut["createdAt"] })).toBe(
      false,
    );
    expect(StatusPageSubscriberConfirmationCode.VALID_FOR_HOURS).toBe(24);
  });

  test("a subscription that replaces nothing removes nothing", async () => {
    const row: StatusPageSubscriber = created();

    await hooks.onCreateSuccess(
      {
        createBy: { data: row, props: { isRoot: true } },
        carryForward: {
          statusPage: new StatusPage(),
          replacedSubscriberIds: [],
        },
      },
      row,
    );

    expect(deleteBy).not.toHaveBeenCalled();
  });
});
