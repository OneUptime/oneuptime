import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import User from "../../../Models/DatabaseModels/User";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import MailService from "../../../Server/Services/MailService";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import { StatusPageSubscriberUnsubscribeSource } from "../../../Server/Utils/StatusPage/StatusPageSubscriberUnsubscribeNotice";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import Phone from "../../../Types/Phone";
import StatusPageSubscriberUnsubscribe, {
  StatusPageSubscriberUnsubscribeChannel,
  StatusPageSubscriberUnsubscribeDetails,
  StatusPageSubscriberUnsubscribeState,
} from "../../../Types/StatusPage/StatusPageSubscriberUnsubscribe";
import getJestMockFunction, { MockFunction } from "../../MockType";
import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Unsubscribing from a status page without signing in: the token every
 * subscriber gets, the link built from it, what the unsubscribe page's GET
 * and POST do with it, Unsubscribed At, and the email a status page's team
 * gets when a subscriber it added leaves.
 *
 * The database is stubbed: the service's own lookups are faked per test and
 * its hand-written SQL is recorded (StatusPageSubscriberUnsubscribePostgres
 * runs that SQL against a real Postgres).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);
const OTHER_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000003",
);
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-000000000004",
);
const CREATOR_ID: ObjectID = new ObjectID(
  "40000000-0000-4000-8000-000000000005",
);
const OWNER_ID: ObjectID = new ObjectID("40000000-0000-4000-8000-000000000006");
const TEAM_OWNER_ID: ObjectID = new ObjectID(
  "40000000-0000-4000-8000-000000000007",
);

const TOKEN: string =
  "3f9a1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8";
const WRONG_TOKEN: string = `${TOKEN.slice(0, 63)}0`;

const STATUS_PAGE_URL: string = "https://site03.status.acme.com";
const DASHBOARD_URL: string = `https://oneuptime.acme.com/dashboard/${PROJECT_ID.toString()}/status-pages/${STATUS_PAGE_ID.toString()}`;

let query: MockFunction;
let storedSubscriber: StatusPageSubscriber | null;

function subscriberRow(overrides?: {
  isUnsubscribed?: boolean;
  createdByUserId?: ObjectID | null;
  unsubscribeToken?: string | null;
  statusPageId?: ObjectID;
}): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = SUBSCRIBER_ID.toString();
  row.projectId = PROJECT_ID;
  row.statusPageId = overrides?.statusPageId || STATUS_PAGE_ID;
  row.subscriberEmail = new Email("site03-all@acme.com");
  row.isUnsubscribed = overrides?.isUnsubscribed ?? false;
  row.createdAt = new Date("2026-01-05T08:00:00.000Z");

  if (overrides?.unsubscribeToken !== null) {
    row.unsubscribeToken = overrides?.unsubscribeToken || TOKEN;
  }

  if (overrides?.createdByUserId !== null) {
    row.createdByUserId = overrides?.createdByUserId || CREATOR_ID;
  }

  return row;
}

function user(id: ObjectID, name: string, email: string): User {
  const row: User = new User();
  row._id = id.toString();
  row.name = new Name(name);
  row.email = new Email(email);
  return row;
}

/*
 * Stands in for the database: the subscriber comes back only when the query
 * names it and its own status page - exactly the scoping the service must
 * apply.
 */
function findOneByFake(findBy: {
  query: JSONObject;
}): Promise<StatusPageSubscriber | null> {
  const lookup: JSONObject = findBy.query;

  if (
    !storedSubscriber ||
    lookup["_id"]?.toString() !== storedSubscriber._id ||
    (lookup["statusPageId"] &&
      lookup["statusPageId"].toString() !==
        storedSubscriber.statusPageId?.toString())
  ) {
    return Promise.resolve(null);
  }

  return Promise.resolve(storedSubscriber);
}

function sqlCalls(): Array<{ sql: string; params: Array<unknown> }> {
  return query.mock.calls.map((call: Array<unknown>) => {
    return {
      sql: (call[0] as string).replace(/\s+/g, " ").trim(),
      params: call[1] as Array<unknown>,
    };
  });
}

function sentMail(): Array<{ mail: JSONObject; options: JSONObject }> {
  return (MailService.sendMail as unknown as jest.Mock).mock.calls.map(
    (call: Array<unknown>) => {
      return {
        mail: call[0] as JSONObject,
        options: call[1] as JSONObject,
      };
    },
  );
}

function linkData(token: string = TOKEN): {
  statusPageId: string;
  subscriberId: string;
  token: string;
} {
  return {
    statusPageId: STATUS_PAGE_ID.toString(),
    subscriberId: SUBSCRIBER_ID.toString(),
    token: token,
  };
}

beforeEach(() => {
  storedSubscriber = subscriberRow();

  query = getJestMockFunction();
  // An UPDATE ... RETURNING through the postgres driver: [rows, rowCount].
  query.mockResolvedValue([
    [{ _id: SUBSCRIBER_ID.toString(), projectId: PROJECT_ID.toString() }],
    1,
  ] as never);

  jest.spyOn(StatusPageSubscriberService, "getRepository").mockReturnValue({
    manager: { query: query },
  } as never);

  jest
    .spyOn(StatusPageSubscriberService, "findOneBy")
    .mockImplementation(findOneByFake as never);
  jest
    .spyOn(StatusPageSubscriberService, "findOneById")
    .mockImplementation((() => {
      return Promise.resolve(storedSubscriber);
    }) as never);
  jest
    .spyOn(StatusPageSubscriberService, "updateOneBy")
    .mockResolvedValue(1 as never);
  jest
    .spyOn(StatusPageSubscriberService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(StatusPageSubscriberService, "onTriggerWorkflow")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(StatusPageSubscriberService, "onTriggerRealtime")
    .mockResolvedValue(undefined as never);

  jest.spyOn(StatusPageService, "findOneById").mockImplementation((() => {
    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID.toString();
    page.name = "Site 03";
    page.pageTitle = "Site 03 Status";
    return Promise.resolve(page);
  }) as never);
  jest
    .spyOn(StatusPageService, "findOwners")
    .mockResolvedValue([
      user(OWNER_ID, "Olga Owner", "olga@acme.com"),
      user(TEAM_OWNER_ID, "Tom Teamowner", "tom@acme.com"),
    ] as never);
  jest
    .spyOn(StatusPageService, "getStatusPageLinkInDashboard")
    .mockResolvedValue(URL.fromString(DASHBOARD_URL) as never);

  jest
    .spyOn(UserService, "findOneById")
    .mockResolvedValue(
      user(CREATOR_ID, "Dana Admin", "dana@acme.com") as never,
    );

  // Everyone asked about is a member, unless a test says otherwise.
  jest
    .spyOn(TeamMemberService, "filterUsersToProjectMembers")
    .mockImplementation(((data: { users: Array<User> }) => {
      return Promise.resolve(data.users);
    }) as never);

  jest.spyOn(MailService, "sendMail").mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a subscriber's unsubscribe token, minted on create", () => {
  const makeProps: (
    permissions: Array<Permission>,
  ) => DatabaseCommonInteractionProps = (
    permissions: Array<Permission>,
  ): DatabaseCommonInteractionProps => {
    const userId: ObjectID = ObjectID.generate();
    const tenantPermission: UserTenantAccessPermission = {
      projectId: PROJECT_ID,
      _type: "UserTenantAccessPermission",
      permissions: permissions.map((permission: Permission) => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: false,
        };
      }),
    };

    return {
      userId: userId,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: tenantPermission,
      },
    };
  };

  async function runOnBeforeCreate(
    data: StatusPageSubscriber,
    props: DatabaseCommonInteractionProps,
  ): Promise<StatusPageSubscriber> {
    jest
      .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
      .mockImplementation((() => {
        const page: StatusPage = new StatusPage();
        page._id = STATUS_PAGE_ID.toString();
        page.projectId = PROJECT_ID;
        page.name = "Site 03";
        return Promise.resolve([page]);
      }) as never);
    jest
      .spyOn(ProjectService, "getCurrentPlan")
      .mockResolvedValue({ plan: null, isSubscriptionUnpaid: false } as never);
    // Nobody is subscribed with this address yet.
    jest
      .spyOn(StatusPageSubscriberService, "findOneBy")
      .mockResolvedValue(null as never);

    const onCreate: OnCreate<StatusPageSubscriber> = await (
      StatusPageSubscriberService as unknown as {
        onBeforeCreate: (
          createBy: CreateBy<StatusPageSubscriber>,
        ) => Promise<OnCreate<StatusPageSubscriber>>;
      }
    ).onBeforeCreate({ data: data, props: props });

    return onCreate.createBy.data;
  }

  function newSubscriber(): StatusPageSubscriber {
    const row: StatusPageSubscriber = new StatusPageSubscriber();
    row.projectId = PROJECT_ID;
    row.statusPageId = STATUS_PAGE_ID;
    row.subscriberEmail = new Email("site03-all@acme.com");
    row.isSubscriptionConfirmed = true;
    return row;
  }

  test("a teammate's dashboard create (Add in Bulk) gets a fresh token", async () => {
    const created: StatusPageSubscriber = await runOnBeforeCreate(
      newSubscriber(),
      makeProps([Permission.ProjectAdmin]),
    );

    expect(
      StatusPageSubscriberUnsubscribe.isWellFormedToken(
        created.unsubscribeToken,
      ),
    ).toBe(true);
  });

  test("a sign-up on the status page (created as root) gets one too", async () => {
    const created: StatusPageSubscriber = await runOnBeforeCreate(
      newSubscriber(),
      { isRoot: true },
    );

    expect(
      StatusPageSubscriberUnsubscribe.isWellFormedToken(
        created.unsubscribeToken,
      ),
    ).toBe(true);
  });

  test("a token the client sent is replaced, never kept", async () => {
    const data: StatusPageSubscriber = newSubscriber();
    data.unsubscribeToken = TOKEN;

    const created: StatusPageSubscriber = await runOnBeforeCreate(
      data,
      makeProps([Permission.ProjectAdmin]),
    );

    expect(created.unsubscribeToken).not.toBe(TOKEN);
    expect(
      StatusPageSubscriberUnsubscribe.isWellFormedToken(
        created.unsubscribeToken,
      ),
    ).toBe(true);
  });

  test("every subscriber gets its own token", async () => {
    const first: StatusPageSubscriber = await runOnBeforeCreate(
      newSubscriber(),
      { isRoot: true },
    );
    const second: StatusPageSubscriber = await runOnBeforeCreate(
      newSubscriber(),
      { isRoot: true },
    );

    expect(first.unsubscribeToken).not.toBe(second.unsubscribeToken);
  });

  test("the stamped create still passes the column check for a teammate (the column is computed)", async () => {
    const created: StatusPageSubscriber = await runOnBeforeCreate(
      newSubscriber(),
      makeProps([Permission.ProjectAdmin]),
    );

    /*
     * DatabaseService.create runs the hook first and the column check on
     * what it stamped. Without `computed`, the token - which grants nobody
     * create - would refuse every Add in Bulk from the dashboard.
     */
    expect(() => {
      ColumnPermissions.checkDataColumnPermissions(
        StatusPageSubscriber,
        created,
        makeProps([Permission.ProjectAdmin]),
        DatabaseRequestType.Create,
      );
    }).not.toThrow();
  });

  test("a client-sent Unsubscribed At is dropped; a subscriber created unsubscribed is dated now", async () => {
    const data: StatusPageSubscriber = newSubscriber();
    data.unsubscribedAt = new Date("2001-01-01T00:00:00.000Z");

    const created: StatusPageSubscriber = await runOnBeforeCreate(
      data,
      makeProps([Permission.ProjectAdmin]),
    );

    expect(created.unsubscribedAt).toBeUndefined();

    const cancelled: StatusPageSubscriber = newSubscriber();
    cancelled.isUnsubscribed = true;
    cancelled.unsubscribedAt = new Date("2001-01-01T00:00:00.000Z");

    const before: number = Date.now();
    const createdCancelled: StatusPageSubscriber = await runOnBeforeCreate(
      cancelled,
      makeProps([Permission.ProjectAdmin]),
    );

    expect(createdCancelled.unsubscribedAt!.getTime()).toBeGreaterThanOrEqual(
      before,
    );
  });
});

describe("StatusPageSubscriberService.getUnsubscribeLink", () => {
  test("builds the token link from the subscriber row", () => {
    expect(
      StatusPageSubscriberService.getUnsubscribeLink(
        URL.fromString(STATUS_PAGE_URL),
        subscriberRow(),
      ).toString(),
    ).toBe(
      `${STATUS_PAGE_URL}/unsubscribe/${SUBSCRIBER_ID.toString()}-${TOKEN}`,
    );
  });

  test("a subscriber without a token still gets a link - to the out-of-date page - and it is logged", () => {
    const error: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {});

    const link: string = StatusPageSubscriberService.getUnsubscribeLink(
      URL.fromString(STATUS_PAGE_URL),
      subscriberRow({ unsubscribeToken: null }),
    ).toString();

    expect(link).toBe(
      `${STATUS_PAGE_URL}/unsubscribe/${SUBSCRIBER_ID.toString()}`,
    );
    expect(error).toHaveBeenCalled();
  });

  test("the manage link is still the Update Subscription page", () => {
    expect(
      StatusPageSubscriberService.getManageSubscriptionLink(
        URL.fromString(STATUS_PAGE_URL),
        SUBSCRIBER_ID,
      ).toString(),
    ).toBe(
      `${STATUS_PAGE_URL}/update-subscription/${SUBSCRIBER_ID.toString()}`,
    );
  });
});

describe("StatusPageSubscriberService.getSubscribersByStatusPage", () => {
  test("reads each subscriber's token and creator, for the links and the team notice", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(StatusPageSubscriberService, "findBy")
      .mockResolvedValue([subscriberRow()] as never);

    await StatusPageSubscriberService.getSubscribersByStatusPage(
      STATUS_PAGE_ID,
      { isRoot: true, ignoreHooks: true },
    );

    const select: JSONObject = (
      findBy.mock.calls[0]![0] as unknown as { select: JSONObject }
    ).select;

    expect(select["unsubscribeToken"]).toBe(true);
    expect(select["createdByUserId"]).toBe(true);
    // Rows with a token are left alone.
    expect(query).not.toHaveBeenCalled();
  });

  test("a subscriber without a token is given one before any link is built", async () => {
    const withoutToken: StatusPageSubscriber = subscriberRow({
      unsubscribeToken: null,
    });

    jest
      .spyOn(StatusPageSubscriberService, "findBy")
      .mockResolvedValue([withoutToken] as never);

    storedSubscriber = subscriberRow({ unsubscribeToken: TOKEN });

    const subscribers: Array<StatusPageSubscriber> =
      await StatusPageSubscriberService.getSubscribersByStatusPage(
        STATUS_PAGE_ID,
        { isRoot: true, ignoreHooks: true },
      );

    const writes: Array<{ sql: string; params: Array<unknown> }> = sqlCalls();

    expect(writes).toHaveLength(1);
    // Only an empty column is filled, so two racing senders agree on one token.
    expect(writes[0]!.sql).toBe(
      'UPDATE "StatusPageSubscriber" SET "unsubscribeToken" = $1 WHERE "_id" = $2 AND "unsubscribeToken" IS NULL',
    );
    expect(
      StatusPageSubscriberUnsubscribe.isWellFormedToken(writes[0]!.params[0]),
    ).toBe(true);
    expect(writes[0]!.params[1]).toBe(SUBSCRIBER_ID.toString());

    // What the database holds - the winner's token - is what the link uses.
    expect(subscribers[0]!.unsubscribeToken).toBe(TOKEN);
  });
});

describe("opening an unsubscribe link (GET) changes nothing", () => {
  test("a good link describes the subscription and writes nothing", async () => {
    const details: StatusPageSubscriberUnsubscribeDetails =
      await StatusPageSubscriberService.getUnsubscribeLinkDetails(linkData());

    expect(details).toEqual({
      state: StatusPageSubscriberUnsubscribeState.Subscribed,
      channel: StatusPageSubscriberUnsubscribeChannel.Email,
      contact: "site03-all@acme.com",
      wasAddedByTeam: true,
    });

    expect(query).not.toHaveBeenCalled();
    expect(StatusPageSubscriberService.updateOneBy).not.toHaveBeenCalled();
    expect(StatusPageSubscriberService.updateOneById).not.toHaveBeenCalled();
    expect(MailService.sendMail).not.toHaveBeenCalled();
  });

  test("never hands out the token", async () => {
    const details: StatusPageSubscriberUnsubscribeDetails =
      await StatusPageSubscriberService.getUnsubscribeLinkDetails(linkData());

    expect(JSON.stringify(details)).not.toContain(TOKEN);
  });

  test("looks the subscriber up by id and its own status page, never by the token", async () => {
    await StatusPageSubscriberService.getUnsubscribeLinkDetails(linkData());

    const lookup: JSONObject = (
      (StatusPageSubscriberService.findOneBy as unknown as jest.Mock).mock
        .calls[0]![0] as { query: JSONObject }
    ).query;

    expect(Object.keys(lookup).sort()).toEqual(["_id", "statusPageId"]);
    expect(lookup["_id"]).toBe(SUBSCRIBER_ID.toString());
    expect(lookup["statusPageId"]?.toString()).toBe(STATUS_PAGE_ID.toString());
  });

  test("a subscriber that signed up itself is not described as added by the team", async () => {
    storedSubscriber = subscriberRow({ createdByUserId: null });

    const details: StatusPageSubscriberUnsubscribeDetails =
      await StatusPageSubscriberService.getUnsubscribeLinkDetails(linkData());

    expect(details.wasAddedByTeam).toBe(false);
  });

  test("a cancelled subscription reads as Unsubscribed", async () => {
    storedSubscriber = subscriberRow({ isUnsubscribed: true });

    const details: StatusPageSubscriberUnsubscribeDetails =
      await StatusPageSubscriberService.getUnsubscribeLinkDetails(linkData());

    expect(details.state).toBe(
      StatusPageSubscriberUnsubscribeState.Unsubscribed,
    );
  });

  test("a wrong token, a deleted subscriber and another page's link all get the same answer", async () => {
    const wrongToken: StatusPageSubscriberUnsubscribeDetails =
      await StatusPageSubscriberService.getUnsubscribeLinkDetails(
        linkData(WRONG_TOKEN),
      );

    storedSubscriber = subscriberRow({ statusPageId: OTHER_STATUS_PAGE_ID });
    const otherPage: StatusPageSubscriberUnsubscribeDetails =
      await StatusPageSubscriberService.getUnsubscribeLinkDetails(linkData());

    storedSubscriber = null;
    const deleted: StatusPageSubscriberUnsubscribeDetails =
      await StatusPageSubscriberService.getUnsubscribeLinkDetails(linkData());

    const invalid: StatusPageSubscriberUnsubscribeDetails = {
      state: StatusPageSubscriberUnsubscribeState.Invalid,
    };

    expect(wrongToken).toEqual(invalid);
    expect(otherPage).toEqual(invalid);
    expect(deleted).toEqual(invalid);
  });

  test("a malformed link is refused without a lookup", async () => {
    const details: StatusPageSubscriberUnsubscribeDetails =
      await StatusPageSubscriberService.getUnsubscribeLinkDetails({
        statusPageId: "not-a-uuid",
        subscriberId: "' OR 1=1 --",
        token: TOKEN,
      });

    expect(details).toEqual({
      state: StatusPageSubscriberUnsubscribeState.Invalid,
    });
    expect(StatusPageSubscriberService.findOneBy).not.toHaveBeenCalled();
  });

  test("the token is compared in constant time, even when there is no subscriber", async () => {
    const timingSafeEqual: jest.SpyInstance = jest.spyOn(
      crypto,
      "timingSafeEqual",
    );

    await StatusPageSubscriberService.getUnsubscribeLinkDetails(
      linkData(WRONG_TOKEN),
    );
    storedSubscriber = null;
    await StatusPageSubscriberService.getUnsubscribeLinkDetails(linkData());

    expect(timingSafeEqual).toHaveBeenCalledTimes(2);
  });
});

describe("confirming an unsubscribe link (POST)", () => {
  test("cancels the subscription the link belongs to", async () => {
    const state: StatusPageSubscriberUnsubscribeState =
      await StatusPageSubscriberService.unsubscribeWithLink(linkData());

    expect(state).toBe(StatusPageSubscriberUnsubscribeState.Unsubscribed);

    const writes: Array<{ sql: string; params: Array<unknown> }> = sqlCalls();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.sql).toContain('SET "isUnsubscribed" = true');
    expect(writes[0]!.params[1]).toBe(SUBSCRIBER_ID.toString());
  });

  test("a wrong token, a deleted subscriber and another page's link are refused alike, and write nothing", async () => {
    const wrongToken: StatusPageSubscriberUnsubscribeState =
      await StatusPageSubscriberService.unsubscribeWithLink(
        linkData(WRONG_TOKEN),
      );

    storedSubscriber = subscriberRow({ statusPageId: OTHER_STATUS_PAGE_ID });
    const otherPage: StatusPageSubscriberUnsubscribeState =
      await StatusPageSubscriberService.unsubscribeWithLink(linkData());

    storedSubscriber = null;
    const deleted: StatusPageSubscriberUnsubscribeState =
      await StatusPageSubscriberService.unsubscribeWithLink(linkData());

    expect(wrongToken).toBe(StatusPageSubscriberUnsubscribeState.Invalid);
    expect(otherPage).toBe(StatusPageSubscriberUnsubscribeState.Invalid);
    expect(deleted).toBe(StatusPageSubscriberUnsubscribeState.Invalid);
    expect(query).not.toHaveBeenCalled();
    expect(MailService.sendMail).not.toHaveBeenCalled();
  });

  test("is idempotent: a subscription already cancelled answers Unsubscribed and changes nothing", async () => {
    storedSubscriber = subscriberRow({ isUnsubscribed: true });

    const state: StatusPageSubscriberUnsubscribeState =
      await StatusPageSubscriberService.unsubscribeWithLink(linkData());

    expect(state).toBe(StatusPageSubscriberUnsubscribeState.Unsubscribed);
    expect(query).not.toHaveBeenCalled();
    expect(MailService.sendMail).not.toHaveBeenCalled();
  });

  test("works whatever the status page's visibility - it never asks for read access", async () => {
    const hasReadAccess: jest.SpyInstance = jest.spyOn(
      StatusPageService,
      "hasReadAccess",
    );

    await StatusPageSubscriberService.unsubscribeWithLink(linkData());

    expect(hasReadAccess).not.toHaveBeenCalled();
  });
});

describe("StatusPageSubscriberService.unsubscribe - the one write that cancels", () => {
  test("one guarded statement: only a live, undeleted subscription is cancelled, and it says whether it was", async () => {
    const changed: boolean = await StatusPageSubscriberService.unsubscribe({
      subscriberId: SUBSCRIBER_ID,
      source: StatusPageSubscriberUnsubscribeSource.UnsubscribeLink,
    });

    expect(changed).toBe(true);

    const writes: Array<{ sql: string; params: Array<unknown> }> = sqlCalls();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.sql).toBe(
      'UPDATE "StatusPageSubscriber" SET "isUnsubscribed" = true, "unsubscribedAt" = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE "_id" = $2 AND "isUnsubscribed" = false AND "deletedAt" IS NULL RETURNING "_id", "projectId"',
    );
    expect(writes[0]!.params[0]).toBeInstanceOf(Date);
    expect(writes[0]!.params[1]).toBe(SUBSCRIBER_ID.toString());
  });

  test("fires the update workflow trigger and the realtime event it bypassed", async () => {
    await StatusPageSubscriberService.unsubscribe({
      subscriberId: SUBSCRIBER_ID,
      source: StatusPageSubscriberUnsubscribeSource.UnsubscribeLink,
    });

    expect(StatusPageSubscriberService.onTriggerWorkflow).toHaveBeenCalledTimes(
      1,
    );
    const workflowCall: Array<unknown> = (
      StatusPageSubscriberService.onTriggerWorkflow as unknown as jest.Mock
    ).mock.calls[0]!;
    expect((workflowCall[0] as ObjectID).toString()).toBe(
      SUBSCRIBER_ID.toString(),
    );
    expect((workflowCall[1] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(workflowCall[2]).toBe("on-update");
    expect(
      ((workflowCall[3] as JSONObject)["updatedFields"] as JSONObject)[
        "isUnsubscribed"
      ],
    ).toBe(true);
    expect(StatusPageSubscriberService.onTriggerRealtime).toHaveBeenCalledTimes(
      1,
    );
  });

  test("a subscription that was already cancelled (or is gone) is left alone, and nobody is told", async () => {
    query.mockResolvedValue([[], 0] as never);

    const changed: boolean = await StatusPageSubscriberService.unsubscribe({
      subscriberId: SUBSCRIBER_ID,
      source: StatusPageSubscriberUnsubscribeSource.UnsubscribeLink,
    });

    expect(changed).toBe(false);
    expect(
      StatusPageSubscriberService.onTriggerWorkflow,
    ).not.toHaveBeenCalled();
    expect(MailService.sendMail).not.toHaveBeenCalled();
  });

  test("an unrecognisable driver answer reads as nothing cancelled", async () => {
    query.mockResolvedValue(undefined as never);

    expect(
      await StatusPageSubscriberService.unsubscribe({
        subscriberId: SUBSCRIBER_ID,
        source: StatusPageSubscriberUnsubscribeSource.UnsubscribeLink,
      }),
    ).toBe(false);
  });

  test("a failure to tell the team does not undo or fail the unsubscribe", async () => {
    jest.spyOn(logger, "error").mockImplementation(() => {});
    jest
      .spyOn(StatusPageService, "findOwners")
      .mockRejectedValue(new Error("owners unavailable") as never);

    await expect(
      StatusPageSubscriberService.unsubscribe({
        subscriberId: SUBSCRIBER_ID,
        source: StatusPageSubscriberUnsubscribeSource.UnsubscribeLink,
      }),
    ).resolves.toBe(true);
  });
});

describe("telling the team when a subscriber it added unsubscribes", () => {
  async function unsubscribeNow(): Promise<void> {
    await StatusPageSubscriberService.unsubscribe({
      subscriberId: SUBSCRIBER_ID,
      source: StatusPageSubscriberUnsubscribeSource.UnsubscribeLink,
    });
  }

  function recipients(): Array<string> {
    return sentMail()
      .map((sent: { mail: JSONObject }) => {
        return sent.mail["toEmail"]!.toString();
      })
      .sort();
  }

  test("emails the page's owners and the teammate who added it, each once", async () => {
    // The creator also owns the page: still one email.
    jest
      .spyOn(StatusPageService, "findOwners")
      .mockResolvedValue([
        user(OWNER_ID, "Olga Owner", "olga@acme.com"),
        user(CREATOR_ID, "Dana Admin", "dana@acme.com"),
        user(TEAM_OWNER_ID, "Tom Teamowner", "tom@acme.com"),
      ] as never);

    await unsubscribeNow();

    expect(recipients()).toEqual([
      "dana@acme.com",
      "olga@acme.com",
      "tom@acme.com",
    ]);
  });

  test("sends one plain email that names the subscriber, the page and who added it", async () => {
    await unsubscribeNow();

    const { mail, options } = sentMail()[0]!;

    expect(mail["templateType"]).toBe(EmailTemplateType.SimpleMessage);
    expect(mail["subject"]).toBe(
      "A subscriber your team added unsubscribed from Site 03",
    );
    expect(mail["isSubjectLiteral"]).toBe(true);

    const vars: JSONObject = mail["vars"] as JSONObject;
    expect(vars["subject"]).toBe(mail["subject"]);
    expect(vars["message"]).toContain("site03-all@acme.com");
    expect(vars["message"]).toContain("Dana Admin added this subscriber");
    expect(vars["message"]).toContain(`${DASHBOARD_URL}/email-subscribers`);

    expect(options["projectId"]?.toString()).toBe(PROJECT_ID.toString());
  });

  test("never for a subscriber that signed up itself", async () => {
    storedSubscriber = subscriberRow({ createdByUserId: null });

    await unsubscribeNow();

    expect(MailService.sendMail).not.toHaveBeenCalled();
    expect(StatusPageService.findOwners).not.toHaveBeenCalled();
  });

  test("a page with no owners tells only the teammate who added the subscriber", async () => {
    jest.spyOn(StatusPageService, "findOwners").mockResolvedValue([] as never);

    await unsubscribeNow();

    expect(recipients()).toEqual(["dana@acme.com"]);
  });

  test("only people who are still members of the project are told", async () => {
    jest
      .spyOn(TeamMemberService, "filterUsersToProjectMembers")
      .mockImplementation(((data: { users: Array<User> }) => {
        return Promise.resolve(
          data.users.filter((candidate: User): boolean => {
            return candidate.id!.toString() !== CREATOR_ID.toString();
          }),
        );
      }) as never);

    await unsubscribeNow();

    expect(recipients()).toEqual(["olga@acme.com", "tom@acme.com"]);
    expect(
      (TeamMemberService.filterUsersToProjectMembers as unknown as jest.Mock)
        .mock.calls[0]![0],
    ).toEqual(expect.objectContaining({ projectId: PROJECT_ID }));
  });

  test("names an SMS subscriber by its full number for the team", async () => {
    const smsSubscriber: StatusPageSubscriber = subscriberRow();
    delete smsSubscriber.subscriberEmail;
    smsSubscriber.subscriberPhone = new Phone("+15555550123");
    storedSubscriber = smsSubscriber;

    await unsubscribeNow();

    const message: string = (sentMail()[0]!.mail["vars"] as JSONObject)[
      "message"
    ] as string;
    expect(message).toContain("+15555550123");
    expect(message).toContain(`${DASHBOARD_URL}/sms-subscribers`);
  });

  test("the manage page's cancellation is reported as such", async () => {
    await StatusPageSubscriberService.unsubscribe({
      subscriberId: SUBSCRIBER_ID,
      source: StatusPageSubscriberUnsubscribeSource.ManageSubscriptionPage,
    });

    expect(
      (sentMail()[0]!.mail["vars"] as JSONObject)["message"] as string,
    ).toContain("Update Subscription page");
  });
});

describe("Unsubscribed At follows Is Unsubscribed on every other write", () => {
  const hooks: {
    onBeforeUpdate: (
      updateBy: UpdateBy<StatusPageSubscriber>,
    ) => Promise<OnUpdate<StatusPageSubscriber>>;
    onUpdateSuccess: (
      onUpdate: OnUpdate<StatusPageSubscriber>,
      ids: Array<ObjectID>,
    ) => Promise<OnUpdate<StatusPageSubscriber>>;
  } = StatusPageSubscriberService as unknown as {
    onBeforeUpdate: (
      updateBy: UpdateBy<StatusPageSubscriber>,
    ) => Promise<OnUpdate<StatusPageSubscriber>>;
    onUpdateSuccess: (
      onUpdate: OnUpdate<StatusPageSubscriber>,
      ids: Array<ObjectID>,
    ) => Promise<OnUpdate<StatusPageSubscriber>>;
  };

  const ALREADY_CANCELLED_ID: ObjectID = new ObjectID(
    "30000000-0000-4000-8000-000000000009",
  );

  function matchedRows(): Array<StatusPageSubscriber> {
    const live: StatusPageSubscriber = subscriberRow();
    const cancelled: StatusPageSubscriber = subscriberRow({
      isUnsubscribed: true,
    });
    cancelled._id = ALREADY_CANCELLED_ID.toString();
    return [live, cancelled];
  }

  function updateBy(data: JSONObject): UpdateBy<StatusPageSubscriber> {
    return {
      query: { statusPageId: STATUS_PAGE_ID },
      data: data as never,
      limit: 100,
      skip: 0,
      props: { isRoot: true },
    };
  }

  test("a teammate cancelling subscriptions dates only the ones that were live", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(StatusPageSubscriberService, "findBy")
      .mockResolvedValue(matchedRows() as never);

    const onUpdate: OnUpdate<StatusPageSubscriber> = await hooks.onBeforeUpdate(
      updateBy({ isUnsubscribed: true }),
    );

    // The rows are read with the update's own query, before it runs.
    expect(
      (findBy.mock.calls[0]![0] as unknown as { query: JSONObject }).query,
    ).toEqual({ statusPageId: STATUS_PAGE_ID });

    await hooks.onUpdateSuccess(onUpdate, [
      SUBSCRIBER_ID,
      ALREADY_CANCELLED_ID,
    ]);

    const writes: Array<{ sql: string; params: Array<unknown> }> = sqlCalls();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.sql).toBe(
      'UPDATE "StatusPageSubscriber" SET "unsubscribedAt" = $1 WHERE "_id" = ANY($2::uuid[]) AND "isUnsubscribed" = true AND "unsubscribedAt" IS NULL',
    );
    expect(writes[0]!.params[1]).toEqual([SUBSCRIBER_ID.toString()]);
  });

  test("a row the update did not reach is not dated", async () => {
    jest
      .spyOn(StatusPageSubscriberService, "findBy")
      .mockResolvedValue(matchedRows() as never);

    const onUpdate: OnUpdate<StatusPageSubscriber> = await hooks.onBeforeUpdate(
      updateBy({ isUnsubscribed: true }),
    );

    await hooks.onUpdateSuccess(onUpdate, []);

    expect(query).not.toHaveBeenCalled();
  });

  test("subscribing again clears the date", async () => {
    const findBy: jest.SpyInstance = jest.spyOn(
      StatusPageSubscriberService,
      "findBy",
    );

    const onUpdate: OnUpdate<StatusPageSubscriber> = await hooks.onBeforeUpdate(
      updateBy({ isUnsubscribed: false }),
    );

    expect(findBy).not.toHaveBeenCalled();

    await hooks.onUpdateSuccess(onUpdate, [SUBSCRIBER_ID]);

    const writes: Array<{ sql: string; params: Array<unknown> }> = sqlCalls();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.sql).toBe(
      'UPDATE "StatusPageSubscriber" SET "unsubscribedAt" = NULL WHERE "_id" = ANY($1::uuid[]) AND "isUnsubscribed" = false AND "unsubscribedAt" IS NOT NULL',
    );
    expect(writes[0]!.params[0]).toEqual([SUBSCRIBER_ID.toString()]);
  });

  test("a write that does not touch Is Unsubscribed leaves the date alone", async () => {
    const findBy: jest.SpyInstance = jest.spyOn(
      StatusPageSubscriberService,
      "findBy",
    );

    const onUpdate: OnUpdate<StatusPageSubscriber> = await hooks.onBeforeUpdate(
      updateBy({ internalNote: "Site 03's list" }),
    );
    await hooks.onUpdateSuccess(onUpdate, [SUBSCRIBER_ID]);

    expect(findBy).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  test("a teammate's toggle on the dashboard does not email the team", async () => {
    jest
      .spyOn(StatusPageSubscriberService, "findBy")
      .mockResolvedValue(matchedRows() as never);

    const onUpdate: OnUpdate<StatusPageSubscriber> = await hooks.onBeforeUpdate(
      updateBy({ isUnsubscribed: true }),
    );
    await hooks.onUpdateSuccess(onUpdate, [SUBSCRIBER_ID]);

    expect(MailService.sendMail).not.toHaveBeenCalled();
  });
});
