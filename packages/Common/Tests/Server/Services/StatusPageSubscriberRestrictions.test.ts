import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPagePrivateUserService from "../../../Server/Services/StatusPagePrivateUserService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import SSRFProtection from "../../../Server/Utils/SSRFProtection";
import URL from "../../../Types/API/URL";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import {
  fillSubscriberRestrictionMessage,
  SubscriberRestrictionMessages,
} from "../../../Types/StatusPage/SubscriberRestrictions";
import { getJestSpyOn } from "../../Spy";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { stubRowsCallerMayWrite } from "../TestingUtils/RowsCallerMayWrite";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

jest.mock("../../../Server/Utils/Logger");

/*
 * WHO MAY BE A STATUS PAGE'S SUBSCRIBER, ON EVERY WRITE OF ONE: Only
 * Private Users Can Subscribe and Allowed Email Domains
 * (Types/StatusPage/SubscriberRestrictions), held by
 * StatusPageSubscriberService.
 *
 *   - a new subscriber - a visitor's sign-up, or the team's addition from
 *     the dashboard, the API or a workflow - is refused when its page does
 *     not take it, each told what they can do about it;
 *   - a change of a subscriber's contact is held to the same, with the
 *     contact as the change leaves it; a change of anything else is not, so
 *     a subscriber added before a setting can still be edited;
 *   - every send reads the page's subscribers with the page's rules as
 *     conditions of the same read (getSubscriberRestrictionQuery), and the
 *     audience summary counts with the same rules. Their SQL is pinned
 *     against Postgres in StatusPageSubscriberRestrictionsPostgres.test.ts.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000001",
);
const PAGE_ID: ObjectID = new ObjectID("5e000000-0000-4000-8000-000000000002");
const OTHER_PAGE_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000003",
);
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000004",
);

type BeforeCreate = (
  createBy: CreateBy<StatusPageSubscriber>,
) => Promise<OnCreate<StatusPageSubscriber>>;

type BeforeUpdate = (
  updateBy: UpdateBy<StatusPageSubscriber>,
) => Promise<OnUpdate<StatusPageSubscriber>>;

const hooks: { onBeforeCreate: BeforeCreate; onBeforeUpdate: BeforeUpdate } =
  StatusPageSubscriberService as unknown as {
    onBeforeCreate: BeforeCreate;
    onBeforeUpdate: BeforeUpdate;
  };

interface PageSettings {
  limitSubscribersToPrivateUsers?: boolean;
  allowedSubscriberEmailDomains?: string | undefined;
}

function page(settings: PageSettings, id: ObjectID = PAGE_ID): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = id.toString();
  statusPage.projectId = PROJECT_ID;
  statusPage.name = "Acme Status";
  statusPage.limitSubscribersToPrivateUsers =
    settings.limitSubscribersToPrivateUsers ?? false;
  if (settings.allowedSubscriberEmailDomains !== undefined) {
    statusPage.allowedSubscriberEmailDomains =
      settings.allowedSubscriberEmailDomains;
  }
  return statusPage;
}

interface Contact {
  email?: string;
  phone?: string;
  slack?: string;
  teams?: string;
  webhook?: string;
}

function subscriber(contact: Contact): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row.projectId = PROJECT_ID;
  row.statusPageId = PAGE_ID;
  row.isSubscriptionConfirmed = true;

  if (contact.email) {
    row.subscriberEmail = new Email(contact.email);
  }
  if (contact.phone) {
    row.subscriberPhone = new Phone(contact.phone);
  }
  if (contact.slack) {
    row.slackIncomingWebhookUrl = URL.fromString(contact.slack);
  }
  if (contact.teams) {
    row.microsoftTeamsIncomingWebhookUrl = URL.fromString(contact.teams);
  }
  if (contact.webhook) {
    row.subscriberWebhook = URL.fromString(contact.webhook);
  }

  return row;
}

// The private users of PAGE_ID, as the database has them.
let privateUsers: Array<string> = [];
let privateUserLookup: jest.SpyInstance;
let pagesForCreate: jest.SpyInstance;
let pagesForUpdate: jest.SpyInstance;
let subscriberRows: Array<StatusPageSubscriber> = [];
let pageSettings: PageSettings = {};

async function refusalOf(action: Promise<unknown>): Promise<string | null> {
  try {
    await action;
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(BadDataException);
    return (err as Error).message;
  }
}

beforeEach(() => {
  privateUsers = [];
  subscriberRows = [];
  pageSettings = {};
  stubProjectDirectory({});

  privateUserLookup = getJestSpyOn(
    StatusPagePrivateUserService,
    "isPrivateUserEmail",
  ).mockImplementation(
    async (data: {
      statusPageId: ObjectID;
      email: string;
    }): Promise<boolean> => {
      return (
        data.statusPageId.toString() === PAGE_ID.toString() &&
        privateUsers.includes(data.email.trim().toLowerCase())
      );
    },
  );

  // The contact's subscriptions on the page, and the rows an update writes.
  getJestSpyOn(StatusPageSubscriberService, "findBy").mockImplementation(
    async (): Promise<Array<StatusPageSubscriber>> => {
      return subscriberRows;
    },
  );
  stubRowsCallerMayWrite(
    StatusPageSubscriberService,
    async (): Promise<Array<unknown>> => {
      return subscriberRows;
    },
  );

  pagesForCreate = getJestSpyOn(
    StatusPageSubscriberService,
    "getStatusPagesToSendNotification",
  ).mockImplementation(async (): Promise<Array<StatusPage>> => {
    return [page(pageSettings)];
  });

  pagesForUpdate = getJestSpyOn(StatusPageService, "findBy").mockImplementation(
    async (): Promise<Array<StatusPage>> => {
      return [page(pageSettings), page({}, OTHER_PAGE_ID)];
    },
  );

  getJestSpyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: null,
    isSubscriptionUnpaid: false,
  } as never);
  getJestSpyOn(ProjectService, "isSMSNotificationsEnabled").mockResolvedValue(
    true,
  );
  getJestSpyOn(SSRFProtection, "validateWebhookTargetIsSafe").mockResolvedValue(
    undefined,
  );
  getJestSpyOn(ProjectReferenceCheck, "validateUpdate").mockResolvedValue(
    undefined,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("assertSubscriberAllowedOnPage", () => {
  const check: (
    settings: PageSettings,
    contact: Contact,
    isSignUp?: boolean,
  ) => Promise<string | null> = (
    settings: PageSettings,
    contact: Contact,
    isSignUp: boolean = true,
  ): Promise<string | null> => {
    return refusalOf(
      StatusPageSubscriberService.assertSubscriberAllowedOnPage({
        statusPage: page(settings),
        subscriber: subscriber(contact),
        isSignUp: isSignUp,
      }),
    );
  };

  test("a page with neither setting takes any subscriber, asking nothing", async () => {
    for (const contact of [
      { email: "anyone@example.com" },
      { phone: "+14155550100" },
      { slack: "https://hooks.slack.com/services/T/B/x" },
      { teams: "https://example.webhook.office.com/x" },
      { webhook: "https://hooks.example.com/1" },
    ]) {
      expect(await check({}, contact)).toBeNull();
    }

    expect(privateUserLookup).not.toHaveBeenCalled();
  });

  describe("Only Private Users Can Subscribe", () => {
    const settings: PageSettings = { limitSubscribersToPrivateUsers: true };

    beforeEach(() => {
      privateUsers = ["reader@acme.com"];
    });

    test("a private user's address is taken", async () => {
      expect(await check(settings, { email: "Reader@Acme.com" })).toBeNull();
      expect(privateUserLookup).toHaveBeenCalledWith({
        statusPageId: PAGE_ID,
        email: "reader@acme.com",
      });
    });

    test.each([
      [{ phone: "+14155550100" }],
      [{ slack: "https://hooks.slack.com/services/T/B/x" }],
      [{ teams: "https://example.webhook.office.com/x" }],
      [{ webhook: "https://hooks.example.com/1" }],
      [{ email: "reader@acme.com", phone: "+14155550100" }],
      [{}],
    ])("%j is refused: the page takes only email", async (contact: Contact) => {
      expect(await check(settings, contact)).toBe(
        SubscriberRestrictionMessages.emailOnly,
      );
      expect(privateUserLookup).not.toHaveBeenCalled();
    });

    test("a visitor whose address is not a private user's is told who can subscribe", async () => {
      expect(await check(settings, { email: "stranger@acme.com" })).toBe(
        SubscriberRestrictionMessages.notPrivateUser,
      );
    });

    test("the team is told which address, and how to let it in", async () => {
      expect(await check(settings, { email: "stranger@acme.com" }, false)).toBe(
        fillSubscriberRestrictionMessage(
          SubscriberRestrictionMessages.teamAddedNotPrivateUser,
          { email: "stranger@acme.com" },
        ),
      );
    });

    test("a page with no id has no private users", async () => {
      const statusPage: StatusPage = page(settings);
      delete (statusPage as unknown as Record<string, unknown>)["_id"];

      expect(
        await refusalOf(
          StatusPageSubscriberService.assertSubscriberAllowedOnPage({
            statusPage: statusPage,
            subscriber: subscriber({ email: "reader@acme.com" }),
            isSignUp: true,
          }),
        ),
      ).toBe(SubscriberRestrictionMessages.notPrivateUser);
    });
  });

  describe("Allowed Email Domains", () => {
    const settings: PageSettings = {
      allowedSubscriberEmailDomains: "acme.com\nacme.de",
    };

    test.each(["a@acme.com", "a@eu.acme.com", "a@acme.de"])(
      "%j is taken",
      async (email: string) => {
        expect(await check(settings, { email })).toBeNull();
      },
    );

    test.each(["a@evilacme.com", "a@acme.com.evil.com", "a@x.org"])(
      "%j is refused, naming the domains",
      async (email: string) => {
        for (const isSignUp of [true, false]) {
          expect(await check(settings, { email }, isSignUp)).toBe(
            "Only email addresses at acme.com or acme.de can subscribe to this status page.",
          );
        }
      },
    );

    test("a subscriber with no email has no domain, and is taken", async () => {
      expect(await check(settings, { phone: "+14155550100" })).toBeNull();
      expect(
        await check(settings, {
          webhook: "https://hooks.example.com/1",
        }),
      ).toBeNull();
    });

    test("an entry that is not a domain is no domain to subscribe at", async () => {
      expect(
        await check(
          { allowedSubscriberEmailDomains: "acme.com\nnot a domain" },
          { email: "a@acme.com" },
        ),
      ).toBeNull();
      expect(
        await check(
          { allowedSubscriberEmailDomains: "acme.com\nnot a domain" },
          { email: "a@x.org" },
        ),
      ).toBe(
        // Only the valid entry is named.
        "Only email addresses at acme.com can subscribe to this status page.",
      );
    });

    test("a list of no domain at all allows any domain", async () => {
      expect(
        await check(
          { allowedSubscriberEmailDomains: "  \n " },
          { email: "a@x.org" },
        ),
      ).toBeNull();
    });
  });

  test("both settings: a private user's address at an allowed domain", async () => {
    privateUsers = ["reader@acme.com", "partner@acme.de"];
    const settings: PageSettings = {
      limitSubscribersToPrivateUsers: true,
      allowedSubscriberEmailDomains: "acme.com",
    };

    expect(await check(settings, { email: "reader@acme.com" })).toBeNull();
    expect(await check(settings, { email: "partner@acme.de" })).toBe(
      "Only email addresses at acme.com can subscribe to this status page.",
    );
    expect(await check(settings, { email: "stranger@acme.com" })).toBe(
      SubscriberRestrictionMessages.notPrivateUser,
    );
  });
});

describe("a new subscriber", () => {
  /*
   * The visitor's sign-up runs the real create hook: create() is stood in
   * for by the hook alone, with the very row the sign-up hands it.
   */
  function signUpRunsTheCreateHook(): void {
    getJestSpyOn(StatusPageSubscriberService, "create").mockImplementation(
      async (
        createBy: CreateBy<StatusPageSubscriber>,
      ): Promise<StatusPageSubscriber> => {
        await hooks.onBeforeCreate(createBy);
        return createBy.data;
      },
    );
  }

  test("the page's settings are read with the page itself, in the read every create already makes", async () => {
    await hooks.onBeforeCreate({
      data: subscriber({ email: "anyone@example.com" }),
      props: { isRoot: true },
    });

    expect(pagesForCreate).toHaveBeenCalledTimes(1);
    expect(pagesForUpdate).not.toHaveBeenCalled();
  });

  test("a visitor's sign-up the page does not take is refused with what they can do", async () => {
    pageSettings = { limitSubscribersToPrivateUsers: true };
    signUpRunsTheCreateHook();

    expect(
      await refusalOf(
        StatusPageSubscriberService.createFromStatusPageSignUp(
          subscriber({ email: "stranger@acme.com" }),
        ),
      ),
    ).toBe(SubscriberRestrictionMessages.notPrivateUser);
  });

  test("a private user's sign-up is taken", async () => {
    pageSettings = { limitSubscribersToPrivateUsers: true };
    privateUsers = ["reader@acme.com"];
    signUpRunsTheCreateHook();

    expect(
      await refusalOf(
        StatusPageSubscriberService.createFromStatusPageSignUp(
          subscriber({ email: "reader@acme.com" }),
        ),
      ),
    ).toBeNull();
  });

  test("the team's addition the page does not take is refused with the setting to change", async () => {
    pageSettings = { limitSubscribersToPrivateUsers: true };

    expect(
      await refusalOf(
        hooks.onBeforeCreate({
          data: subscriber({ email: "stranger@acme.com" }),
          props: { isRoot: true },
        }),
      ),
    ).toBe(
      fillSubscriberRestrictionMessage(
        SubscriberRestrictionMessages.teamAddedNotPrivateUser,
        { email: "stranger@acme.com" },
      ),
    );
  });

  test("the team cannot add a phone, Slack, Microsoft Teams or webhook subscriber to a page that takes only its private users", async () => {
    pageSettings = { limitSubscribersToPrivateUsers: true };

    for (const contact of [
      { phone: "+14155550100" },
      { slack: "https://hooks.slack.com/services/T/B/x" },
      { teams: "https://example.webhook.office.com/x" },
      { webhook: "https://hooks.example.com/1" },
    ]) {
      expect(
        await refusalOf(
          hooks.onBeforeCreate({
            data: subscriber(contact),
            props: { isRoot: true },
          }),
        ),
      ).toBe(SubscriberRestrictionMessages.emailOnly);
    }
  });

  test("an address at another domain is refused, whoever adds it", async () => {
    pageSettings = { allowedSubscriberEmailDomains: "acme.com" };
    signUpRunsTheCreateHook();

    const message: string =
      "Only email addresses at acme.com can subscribe to this status page.";

    expect(
      await refusalOf(
        hooks.onBeforeCreate({
          data: subscriber({ email: "a@x.org" }),
          props: { isRoot: true },
        }),
      ),
    ).toBe(message);
    expect(
      await refusalOf(
        StatusPageSubscriberService.createFromStatusPageSignUp(
          subscriber({ email: "a@x.org" }),
        ),
      ),
    ).toBe(message);
    expect(
      await refusalOf(
        hooks.onBeforeCreate({
          data: subscriber({ email: "a@status.acme.com" }),
          props: { isRoot: true },
        }),
      ),
    ).toBeNull();
  });
});

describe("a change of a subscriber", () => {
  function existing(contact: Contact, statusPageId: ObjectID = PAGE_ID): void {
    const row: StatusPageSubscriber = subscriber(contact);
    row._id = SUBSCRIBER_ID.toString();
    row.statusPageId = statusPageId;
    subscriberRows = [row];
  }

  function change(
    data: JSONObject,
    props: JSONObject = { isRoot: true },
  ): UpdateBy<StatusPageSubscriber> {
    return {
      query: { _id: SUBSCRIBER_ID.toString() },
      data: data as unknown as StatusPageSubscriber,
      props: props as never,
    } as unknown as UpdateBy<StatusPageSubscriber>;
  }

  test("a change of no contact is never held to the page's settings, so an old subscriber can still be edited", async () => {
    pageSettings = {
      limitSubscribersToPrivateUsers: true,
      allowedSubscriberEmailDomains: "acme.com",
    };
    existing({ email: "added-before@x.org" });

    expect(
      await refusalOf(
        hooks.onBeforeUpdate(
          change({ isSubscribedToAllEventTypes: true, isUnsubscribed: true }),
        ),
      ),
    ).toBeNull();
    expect(pagesForUpdate).not.toHaveBeenCalled();
    expect(privateUserLookup).not.toHaveBeenCalled();
  });

  test("an email changed to one the page does not take is refused", async () => {
    pageSettings = { allowedSubscriberEmailDomains: "acme.com" };
    existing({ email: "a@acme.com" });

    expect(
      await refusalOf(
        hooks.onBeforeUpdate(change({ subscriberEmail: "a@x.org" })),
      ),
    ).toBe(
      "Only email addresses at acme.com can subscribe to this status page.",
    );
  });

  test("an email changed to one the page takes is let through", async () => {
    pageSettings = { allowedSubscriberEmailDomains: "acme.com" };
    existing({ email: "a@x.org" });

    expect(
      await refusalOf(
        hooks.onBeforeUpdate(change({ subscriberEmail: "b@acme.com" })),
      ),
    ).toBeNull();
  });

  test("on a page that takes only private users, the team is told which address to add as a private user", async () => {
    pageSettings = { limitSubscribersToPrivateUsers: true };
    privateUsers = ["reader@acme.com"];
    existing({ email: "reader@acme.com" });

    expect(
      await refusalOf(
        hooks.onBeforeUpdate(change({ subscriberEmail: "stranger@acme.com" })),
      ),
    ).toBe(
      fillSubscriberRestrictionMessage(
        SubscriberRestrictionMessages.teamAddedNotPrivateUser,
        { email: "stranger@acme.com" },
      ),
    );
  });

  test("a phone added to a private user's subscription is refused; one taken off is let through", async () => {
    pageSettings = { limitSubscribersToPrivateUsers: true };
    privateUsers = ["reader@acme.com"];

    existing({ email: "reader@acme.com" });
    expect(
      await refusalOf(
        hooks.onBeforeUpdate(change({ subscriberPhone: "+14155550100" })),
      ),
    ).toBe(SubscriberRestrictionMessages.emailOnly);

    existing({ email: "reader@acme.com", phone: "+14155550100" });
    expect(
      await refusalOf(hooks.onBeforeUpdate(change({ subscriberPhone: null }))),
    ).toBeNull();
  });

  test("a subscriber of a page with neither setting is let through, asking about no private user", async () => {
    existing({ email: "a@acme.com" }, OTHER_PAGE_ID);

    expect(
      await refusalOf(
        hooks.onBeforeUpdate(change({ subscriberEmail: "anyone@x.org" })),
      ),
    ).toBeNull();
    expect(privateUserLookup).not.toHaveBeenCalled();
  });

  test("the pages are read once, with only the two settings, for every subscriber the change writes", async () => {
    pageSettings = { allowedSubscriberEmailDomains: "acme.com" };
    existing({ email: "a@acme.com" });

    await hooks.onBeforeUpdate(change({ subscriberEmail: "b@acme.com" }));

    expect(pagesForUpdate).toHaveBeenCalledTimes(1);
    const read: { select: JSONObject; props: JSONObject } = pagesForUpdate.mock
      .calls[0]![0] as { select: JSONObject; props: JSONObject };
    expect(read.select).toEqual({
      _id: true,
      limitSubscribersToPrivateUsers: true,
      allowedSubscriberEmailDomains: true,
    });
    expect(read.props).toEqual({ isRoot: true });
  });

  test("a visitor's change on the manage subscription page is told what a visitor can do", async () => {
    pageSettings = { limitSubscribersToPrivateUsers: true };
    existing({ email: "reader@acme.com" });

    getJestSpyOn(StatusPageSubscriberService, "updateBy").mockImplementation(
      async (updateBy: UpdateBy<StatusPageSubscriber>): Promise<number> => {
        await hooks.onBeforeUpdate(updateBy);
        return 1;
      },
    );

    expect(
      await refusalOf(
        StatusPageSubscriberService.updateFromManageSubscriptionPage({
          subscriberId: SUBSCRIBER_ID,
          data: {
            subscriberEmail: "stranger@acme.com",
          } as unknown as UpdateBy<StatusPageSubscriber>["data"],
        }),
      ),
    ).toBe(SubscriberRestrictionMessages.notPrivateUser);
  });
});

describe("whom a send reads", () => {
  const COLUMNS: Array<string> = [
    "subscriberEmail",
    "subscriberPhone",
    "slackIncomingWebhookUrl",
    "microsoftTeamsIncomingWebhookUrl",
    "subscriberWebhook",
  ];

  test("a condition on every contact column, with the page bound, never inlined", () => {
    const query: Record<string, unknown> =
      StatusPageSubscriberService.getSubscriberRestrictionQuery(PAGE_ID);

    expect(Object.keys(query).sort()).toEqual([...COLUMNS].sort());

    for (const column of COLUMNS) {
      const condition: FindOperator<unknown> = query[
        column
      ] as FindOperator<unknown>;

      expect(condition).toBeInstanceOf(FindOperator);
      expect(condition.type).toBe("raw");
      expect(condition.objectLiteralParameters).toEqual({
        subscriberRestrictionStatusPageId: PAGE_ID.toString(),
      });

      const sql: string = condition.getSql!(`"subscriber"."${column}"`);

      expect(sql).toContain(`"subscriber"."${column}"`);
      expect(sql).toContain(
        `"restrictingPage"."_id" = CAST(:subscriberRestrictionStatusPageId AS uuid)`,
      );
      expect(sql).not.toContain(PAGE_ID.toString());
    }
  });

  test("the email condition reads the page's private users and domains; the others only whether it takes private users", () => {
    const query: Record<
      string,
      FindOperator<unknown>
    > = StatusPageSubscriberService.getSubscriberRestrictionQuery(
      PAGE_ID,
    ) as Record<string, FindOperator<unknown>>;

    const emailSql: string = query["subscriberEmail"]!.getSql!("e");

    expect(emailSql).toContain(`FROM "StatusPagePrivateUser" "privateUser"`);
    expect(emailSql).toContain(
      `"privateUser"."statusPageId" = CAST(:subscriberRestrictionStatusPageId AS uuid)`,
    );
    expect(emailSql).toContain(`"privateUser"."deletedAt" IS NULL`);
    expect(emailSql).toContain(`"allowedSubscriberEmailDomains"`);

    const phoneSql: string = query["subscriberPhone"]!.getSql!("p");

    expect(phoneSql).toContain(`"limitSubscribersToPrivateUsers"`);
    expect(phoneSql).not.toContain(`"StatusPagePrivateUser"`);
    expect(phoneSql).not.toContain(`"allowedSubscriberEmailDomains"`);
  });

  test("the subscriber loader asks it in the same read, beside the _id cursor", async () => {
    const findBy: jest.SpyInstance = getJestSpyOn(
      StatusPageSubscriberService,
      "findBy",
    ).mockResolvedValue([]);
    getJestSpyOn(
      StatusPageSubscriberService,
      "ensureUnsubscribeTokens",
    ).mockResolvedValue(undefined);

    const afterId: ObjectID = ObjectID.generate();

    await StatusPageSubscriberService.getSubscribersByStatusPage(
      PAGE_ID,
      { isRoot: true },
      { afterId: afterId, limit: 50 },
    );

    expect(findBy).toHaveBeenCalledTimes(1);
    const read: { query: Record<string, unknown>; limit: number } = findBy.mock
      .calls[0]![0] as { query: Record<string, unknown>; limit: number };

    expect(read.query["statusPageId"]).toBe(PAGE_ID);
    expect(read.query["_id"]).toBeInstanceOf(FindOperator);
    expect(read.limit).toBe(50);

    for (const column of COLUMNS) {
      expect([column, read.query[column] instanceof FindOperator]).toEqual([
        column,
        true,
      ]);
    }
  });
});
