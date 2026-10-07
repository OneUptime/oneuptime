import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import MailService from "../../../Server/Services/MailService";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
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
 * subscription, whichever row a database happens to return first.
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

function existingSubscription(
  isUnsubscribed: boolean,
  id: ObjectID = OLD_SUBSCRIBER_ID,
): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = id.toString();
  row.isUnsubscribed = isUnsubscribed;
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
    expect(String(request.query["subscriberEmail"])).toBe("ops@acme.test");
    expect(request.limit).toBeGreaterThan(1);
    expect(request.skip).toBe(0);
  });

  test("a contact who is still subscribed is refused, and nothing is removed", async () => {
    contactHas([existingSubscription(false)]);

    await expect(
      hooks.onBeforeCreate({ data: subscriber(), props: { isRoot: true } }),
    ).rejects.toThrow("You are already subscribed to this status page.");

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
      ).rejects.toThrow("You are already subscribed to this status page.");

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

  test("a new contact replaces nothing", async () => {
    contactHas([]);

    const result: OnCreate<StatusPageSubscriber> = await hooks.onBeforeCreate({
      data: subscriber(),
      props: { isRoot: true },
    });

    expect(replacedIds(result)).toEqual([]);
  });
});

describe("onCreateSuccess", () => {
  function created(): StatusPageSubscriber {
    const row: StatusPageSubscriber = subscriber();
    row._id = NEW_SUBSCRIBER_ID.toString();
    return row;
  }

  test("the cancelled rows go once the new subscription exists, and only cancelled rows of the same page and project", async () => {
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

    expect(deleteBy).toHaveBeenCalledTimes(1);
    const request: {
      query: Record<string, unknown>;
      limit: number;
      skip: number;
      props: Record<string, unknown>;
    } = deleteBy.mock.calls[0]![0] as {
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
    expect(request.query["isUnsubscribed"]).toBe(true);
    expect(request.limit).toBe(2);
    expect(request.skip).toBe(0);
    expect(request.props).toEqual({ ignoreHooks: true, isRoot: true });
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
