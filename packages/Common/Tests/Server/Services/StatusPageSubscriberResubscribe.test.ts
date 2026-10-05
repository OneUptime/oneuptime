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

let deleteOneBy: jest.SpyInstance;

function subscriber(): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row.projectId = PROJECT_ID;
  row.statusPageId = STATUS_PAGE_ID;
  row.subscriberEmail = new Email("ops@acme.test");
  row.isSubscriptionConfirmed = true;
  return row;
}

function existingSubscription(isUnsubscribed: boolean): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = OLD_SUBSCRIBER_ID.toString();
  row.isUnsubscribed = isUnsubscribed;
  return row;
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
  deleteOneBy = getJestSpyOn(
    StatusPageSubscriberService,
    "deleteOneBy",
  ).mockResolvedValue(1);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("onBeforeCreate", () => {
  test("a contact who cancelled is let through, and the cancelled row is not touched yet", async () => {
    getJestSpyOn(StatusPageSubscriberService, "findOneBy").mockResolvedValue(
      existingSubscription(true),
    );

    const result: OnCreate<StatusPageSubscriber> = await hooks.onBeforeCreate({
      data: subscriber(),
      props: { isRoot: true },
    });

    expect(deleteOneBy).not.toHaveBeenCalled();
    expect(
      (
        result.carryForward as { replacedSubscriberId: ObjectID | null }
      ).replacedSubscriberId?.toString(),
    ).toBe(OLD_SUBSCRIBER_ID.toString());
    expect(
      (result.carryForward as { statusPage: StatusPage }).statusPage.name,
    ).toBe("Acme Status");
  });

  test("a contact who is still subscribed is refused, and nothing is removed", async () => {
    getJestSpyOn(StatusPageSubscriberService, "findOneBy").mockResolvedValue(
      existingSubscription(false),
    );

    await expect(
      hooks.onBeforeCreate({ data: subscriber(), props: { isRoot: true } }),
    ).rejects.toThrow("You are already subscribed to this status page.");

    expect(deleteOneBy).not.toHaveBeenCalled();
  });

  test("a new contact replaces nothing", async () => {
    getJestSpyOn(StatusPageSubscriberService, "findOneBy").mockResolvedValue(
      null,
    );

    const result: OnCreate<StatusPageSubscriber> = await hooks.onBeforeCreate({
      data: subscriber(),
      props: { isRoot: true },
    });

    expect(
      (result.carryForward as { replacedSubscriberId: ObjectID | null })
        .replacedSubscriberId,
    ).toBeNull();
  });
});

describe("onCreateSuccess", () => {
  function created(): StatusPageSubscriber {
    const row: StatusPageSubscriber = subscriber();
    row._id = NEW_SUBSCRIBER_ID.toString();
    return row;
  }

  test("the cancelled row goes once the new subscription exists, and only a cancelled row of the same page and project", async () => {
    const row: StatusPageSubscriber = created();

    await hooks.onCreateSuccess(
      {
        createBy: { data: row, props: { isRoot: true } },
        carryForward: {
          statusPage: new StatusPage(),
          replacedSubscriberId: OLD_SUBSCRIBER_ID,
        },
      },
      row,
    );

    expect(deleteOneBy).toHaveBeenCalledTimes(1);
    const request: {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    } = deleteOneBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    };
    expect(request.query["_id"]).toBe(OLD_SUBSCRIBER_ID.toString());
    expect(String(request.query["projectId"])).toBe(PROJECT_ID.toString());
    expect(String(request.query["statusPageId"])).toBe(
      STATUS_PAGE_ID.toString(),
    );
    expect(request.query["isUnsubscribed"]).toBe(true);
    expect(request.props).toEqual({ ignoreHooks: true, isRoot: true });
  });

  test("a subscription that replaces nothing removes nothing", async () => {
    const row: StatusPageSubscriber = created();

    await hooks.onCreateSuccess(
      {
        createBy: { data: row, props: { isRoot: true } },
        carryForward: {
          statusPage: new StatusPage(),
          replacedSubscriberId: null,
        },
      },
      row,
    );

    expect(deleteOneBy).not.toHaveBeenCalled();
  });
});
