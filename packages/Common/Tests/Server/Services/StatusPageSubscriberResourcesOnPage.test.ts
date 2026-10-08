import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import { ProjectScopedReferenceException } from "../../../Server/Utils/Database/ProjectScopedReferenceRefusal";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import SSRFProtection from "../../../Server/Utils/SSRFProtection";
import URL from "../../../Types/API/URL";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import { getJestSpyOn } from "../../Spy";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
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
 * A SUBSCRIPTION NAMES ONLY RESOURCES OF ITS OWN STATUS PAGE - ON EVERY
 * WRITE OF IT.
 *
 * The subscriber service holds every create and every change of a
 * subscription to its page's resources: a sign-up on the status page, the
 * team's dashboard, the API and a workflow alike, for every kind of
 * subscriber. Another page's resource - this project's or another one's -
 * is answered exactly as an id that matches nothing, after the project
 * check and before anything else the create reads. A change asks only
 * about the resources it adds, so what a subscription names already stays
 * nameable.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000001",
);
const PAGE_ID: ObjectID = new ObjectID("6a000000-0000-4000-8000-000000000002");
const OTHER_PAGE_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000003",
);
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000004",
);

const OWN_RESOURCE: string = "6b000000-0000-4000-8000-000000000001";
const OWN_ARCHIVED_MONITOR_RESOURCE: string =
  "6b000000-0000-4000-8000-000000000002";
const OTHER_PAGE_RESOURCE: string = "6b000000-0000-4000-8000-000000000003";
const OTHER_PROJECT_RESOURCE: string = "6b000000-0000-4000-8000-000000000004";

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

function refusalFor(ids: Array<string>): string {
  return ProjectScopedReferenceValidator.getRefusalMessage({
    subject: "status page subscriber",
    described: ids.map((id: string): string => {
      return `Subscribed to Resources "${id}"`;
    }),
  });
}

function resources(ids: Array<string>): Array<StatusPageResource> {
  return ids.map((id: string): StatusPageResource => {
    const resource: StatusPageResource = new StatusPageResource();
    resource._id = id;
    return resource;
  });
}

// Every kind of subscriber, as the status page and the dashboard create it.
const KINDS: Array<{
  kind: string;
  contact: (row: StatusPageSubscriber) => void;
}> = [
  {
    kind: "email",
    contact: (row: StatusPageSubscriber): void => {
      row.subscriberEmail = new Email("ops@example.com");
    },
  },
  {
    kind: "SMS",
    contact: (row: StatusPageSubscriber): void => {
      row.subscriberPhone = new Phone("+15555550100");
    },
  },
  {
    kind: "Slack",
    contact: (row: StatusPageSubscriber): void => {
      row.slackIncomingWebhookUrl = URL.fromString(
        "https://hooks.slack.com/services/T000/B000/XXXX",
      );
      row.slackWorkspaceName = "Example";
    },
  },
  {
    kind: "Microsoft Teams",
    contact: (row: StatusPageSubscriber): void => {
      row.microsoftTeamsIncomingWebhookUrl = URL.fromString(
        "https://example.webhook.office.com/webhookb2/abc",
      );
      row.microsoftTeamsWorkspaceName = "Example";
    },
  },
  {
    kind: "webhook",
    contact: (row: StatusPageSubscriber): void => {
      row.subscriberWebhook = URL.fromString("https://hooks.example.com/in");
    },
  },
];

function subscription(data: {
  contact: (row: StatusPageSubscriber) => void;
  resourceIds: Array<string>;
}): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row.projectId = PROJECT_ID;
  row.statusPageId = PAGE_ID;
  data.contact(row);
  row.isSubscribedToAllResources = false;
  row.statusPageResources = resources(data.resourceIds);
  return row;
}

let pageLookups: Array<string> = [];

/*
 * The page's resources, as the database has them: one resource of the
 * page, one of the page whose monitor is archived, one of another page.
 */
function standInForThePages(): void {
  const service: DatabaseService<StatusPageResource> =
    ProjectScopedReferenceValidator.getLookupService(StatusPageResource);

  const rows: Array<{ id: string; page: ObjectID; archived: boolean }> = [
    { id: OWN_RESOURCE, page: PAGE_ID, archived: false },
    { id: OWN_ARCHIVED_MONITOR_RESOURCE, page: PAGE_ID, archived: true },
    { id: OTHER_PAGE_RESOURCE, page: OTHER_PAGE_ID, archived: false },
  ];

  getJestSpyOn(service, "findBy").mockImplementation(
    async (findBy: any): Promise<Array<StatusPageResource>> => {
      const query: JSONObject = findBy.query as JSONObject;
      const pageId: string = (query["statusPageId"] as ObjectID).toString();
      const asked: Array<string> = Object.values(
        (query["_id"] as unknown as { objectLiteralParameters: JSONObject })
          .objectLiteralParameters,
      ).flat() as Array<string>;

      pageLookups.push(pageId);

      return rows
        .filter((row: { id: string; page: ObjectID }): boolean => {
          return asked.includes(row.id) && row.page.toString() === pageId;
        })
        .map((row: { id: string; archived: boolean }): StatusPageResource => {
          const resource: StatusPageResource = new StatusPageResource();
          resource._id = row.id;
          const monitor: Monitor = new Monitor();
          monitor.isArchived = row.archived;
          resource.monitor = monitor;
          return resource;
        });
    },
  );
}

let contactLookup: jest.SpyInstance;
let pagesLookup: jest.SpyInstance;

beforeEach(() => {
  pageLookups = [];
  standInForThePages();
  stubProjectDirectory({});

  contactLookup = getJestSpyOn(
    StatusPageSubscriberService,
    "findBy",
  ).mockResolvedValue([]);

  pagesLookup = getJestSpyOn(
    StatusPageSubscriberService,
    "getStatusPagesToSendNotification",
  ).mockImplementation(async (): Promise<Array<StatusPage>> => {
    const page: StatusPage = new StatusPage();
    page._id = PAGE_ID.toString();
    page.projectId = PROJECT_ID;
    return [page];
  });

  getJestSpyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: null,
    isSubscriptionUnpaid: false,
  } as never);
  getJestSpyOn(ProjectService, "isSMSNotificationsEnabled").mockResolvedValue(
    true,
  );
  // A webhook's address is checked by its own suites; no DNS here.
  getJestSpyOn(SSRFProtection, "validateWebhookTargetIsSafe").mockResolvedValue(
    undefined,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("StatusPageSubscriberService - a new subscription", () => {
  test.each(KINDS)(
    "a $kind subscription naming another page's resource is refused before anything else is read",
    async (kind: {
      kind: string;
      contact: (row: StatusPageSubscriber) => void;
    }) => {
      let thrown: unknown = null;

      try {
        await hooks.onBeforeCreate({
          data: subscription({
            contact: kind.contact,
            resourceIds: [OWN_RESOURCE, OTHER_PAGE_RESOURCE],
          }),
          props: { isRoot: true },
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ProjectScopedReferenceException);
      expect((thrown as Error).message).toBe(refusalFor([OTHER_PAGE_RESOURCE]));
      expect(pageLookups).toEqual([PAGE_ID.toString()]);
      expect(contactLookup).not.toHaveBeenCalled();
      expect(pagesLookup).not.toHaveBeenCalled();
    },
  );

  test.each(KINDS)(
    "a $kind subscription naming its own page's resources is let through",
    async (kind: {
      kind: string;
      contact: (row: StatusPageSubscriber) => void;
    }) => {
      const result: OnCreate<StatusPageSubscriber> = await hooks.onBeforeCreate(
        {
          data: subscription({
            contact: kind.contact,
            resourceIds: [OWN_RESOURCE],
          }),
          props: { isRoot: true },
        },
      );

      expect(
        (result.carryForward as { statusPage: StatusPage }).statusPage._id,
      ).toBe(PAGE_ID.toString());
      expect(pageLookups).toEqual([PAGE_ID.toString()]);
    },
  );

  test("the team may name a resource of the page whose monitor is archived", async () => {
    await expect(
      hooks.onBeforeCreate({
        data: subscription({
          contact: KINDS[0]!.contact,
          resourceIds: [OWN_ARCHIVED_MONITOR_RESOURCE],
        }),
        props: { isRoot: true },
      }),
    ).resolves.toBeDefined();
  });

  test("a subscription to every resource names none, and reads none", async () => {
    const row: StatusPageSubscriber = subscription({
      contact: KINDS[0]!.contact,
      resourceIds: [],
    });
    row.isSubscribedToAllResources = true;

    await hooks.onBeforeCreate({ data: row, props: { isRoot: true } });

    expect(pageLookups).toEqual([]);
  });

  test("another project's resource gets the same answer as another page's", async () => {
    /*
     * The project check answers another project's resource before this
     * check reads anything; both say it in the same words.
     */
    stubProjectDirectory({
      projectId: PROJECT_ID,
      records: {
        StatusPage: [PAGE_ID.toString(), OTHER_PAGE_ID.toString()],
        StatusPageResource: [
          OWN_RESOURCE,
          OWN_ARCHIVED_MONITOR_RESOURCE,
          OTHER_PAGE_RESOURCE,
        ],
      },
    });

    const answers: Array<string> = [];

    for (const id of [OTHER_PROJECT_RESOURCE, OTHER_PAGE_RESOURCE]) {
      try {
        await hooks.onBeforeCreate({
          data: subscription({
            contact: KINDS[0]!.contact,
            resourceIds: [id],
          }),
          props: { isRoot: true },
        });
      } catch (error) {
        answers.push((error as Error).message.split(id).join("<id>"));
      }
    }

    expect(answers).toHaveLength(2);
    expect(answers[0]).toBe(answers[1]);
  });
});

describe("StatusPageSubscriberService - a change to a subscription", () => {
  let subscriberRead: jest.SpyInstance;

  function subscriberHolding(held: Array<string>): void {
    const row: StatusPageSubscriber = new StatusPageSubscriber();
    row._id = SUBSCRIBER_ID.toString();
    row.projectId = PROJECT_ID;
    row.statusPageId = PAGE_ID;
    row.statusPageResources = resources(held);

    subscriberRead = contactLookup.mockResolvedValue([row]);
  }

  beforeEach(() => {
    // The project check is the reference suites' business; this is the page's.
    getJestSpyOn(ProjectReferenceCheck, "validateUpdate").mockResolvedValue(
      undefined,
    );
  });

  function change(
    resourceIds: Array<string>,
    props: JSONObject = { isRoot: true },
  ): UpdateBy<StatusPageSubscriber> {
    return {
      query: { _id: SUBSCRIBER_ID.toString() },
      data: {
        statusPageResources: resources(resourceIds),
      } as unknown as StatusPageSubscriber,
      props: props as never,
    } as unknown as UpdateBy<StatusPageSubscriber>;
  }

  test("a change that adds another page's resource is refused", async () => {
    subscriberHolding([OWN_RESOURCE]);

    await expect(
      hooks.onBeforeUpdate(change([OWN_RESOURCE, OTHER_PAGE_RESOURCE])),
    ).rejects.toThrow(refusalFor([OTHER_PAGE_RESOURCE]));
  });

  test("a change that keeps what the subscription names already is let through, asking nothing", async () => {
    // Saved before this check: it names another page's resource.
    subscriberHolding([OWN_RESOURCE, OTHER_PAGE_RESOURCE]);

    await expect(
      hooks.onBeforeUpdate(change([OWN_RESOURCE, OTHER_PAGE_RESOURCE])),
    ).resolves.toBeDefined();

    expect(pageLookups).toEqual([]);
  });

  test("a change that adds a resource of the page is let through", async () => {
    subscriberHolding([]);

    await expect(
      hooks.onBeforeUpdate(
        change([OWN_RESOURCE, OWN_ARCHIVED_MONITOR_RESOURCE]),
      ),
    ).resolves.toBeDefined();

    expect(pageLookups).toEqual([PAGE_ID.toString()]);
  });

  test("the subscribers are read through the update's own query, pinned to the caller's project", async () => {
    subscriberHolding([]);

    await hooks.onBeforeUpdate(
      change([OWN_RESOURCE], {
        tenantId: PROJECT_ID,
        userId: ObjectID.generate(),
      }),
    );

    const read: { query: JSONObject; props: JSONObject } = subscriberRead.mock
      .calls[0]![0] as { query: JSONObject; props: JSONObject };

    expect(read.query["_id"]).toBe(SUBSCRIBER_ID.toString());
    expect((read.query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(read.props["isRoot"]).toBe(true);
  });

  test("the subscribers are read in the update's own window - the rows it goes on to write", async () => {
    subscriberHolding([]);

    await hooks.onBeforeUpdate({
      ...change([OWN_RESOURCE]),
      skip: 20000,
      limit: 15000,
    } as unknown as UpdateBy<StatusPageSubscriber>);

    const read: { skip: number; limit: number } = subscriberRead.mock
      .calls[0]![0] as { skip: number; limit: number };

    expect(read.skip).toBe(20000);
    expect(read.limit).toBe(15000);
  });

  test("a change that names no resource reads nothing", async () => {
    subscriberHolding([]);

    await hooks.onBeforeUpdate({
      query: { _id: SUBSCRIBER_ID.toString() },
      data: {
        isSubscribedToAllResources: true,
      } as unknown as StatusPageSubscriber,
      props: { isRoot: true },
    } as unknown as UpdateBy<StatusPageSubscriber>);

    expect(subscriberRead).not.toHaveBeenCalled();
    expect(pageLookups).toEqual([]);
  });
});

describe("StatusPageSubscriberService - a visitor's subscription on the status page", () => {
  beforeEach(() => {
    // The project check is the reference suites' business; this is the page's.
    getJestSpyOn(ProjectReferenceCheck, "validateUpdate").mockResolvedValue(
      undefined,
    );
  });

  /*
   * The visitor's sign-up runs the real create hook: create() is stood in
   * for by the hook alone, with the very row the sign-up hands it.
   */
  function signUpRunsTheCreateHook(): jest.SpyInstance {
    return getJestSpyOn(
      StatusPageSubscriberService,
      "create",
    ).mockImplementation(
      async (
        createBy: CreateBy<StatusPageSubscriber>,
      ): Promise<StatusPageSubscriber> => {
        await hooks.onBeforeCreate(createBy);
        return createBy.data;
      },
    );
  }

  /*
   * The visitor's change runs the real update hook: updateBy() is stood in
   * for by the hook alone, with the very update the change builds.
   */
  function changeRunsTheUpdateHook(): jest.SpyInstance {
    return getJestSpyOn(
      StatusPageSubscriberService,
      "updateBy",
    ).mockImplementation(
      async (updateBy: UpdateBy<StatusPageSubscriber>): Promise<number> => {
        await hooks.onBeforeUpdate(updateBy);
        return 1;
      },
    );
  }

  function subscriberHolding(held: Array<string>): void {
    const row: StatusPageSubscriber = new StatusPageSubscriber();
    row._id = SUBSCRIBER_ID.toString();
    row.projectId = PROJECT_ID;
    row.statusPageId = PAGE_ID;
    row.statusPageResources = resources(held);

    contactLookup.mockResolvedValue([row]);
  }

  test.each(KINDS)(
    "a $kind sign-up naming a resource the page hides is refused as one that does not exist",
    async (kind: {
      kind: string;
      contact: (row: StatusPageSubscriber) => void;
    }) => {
      signUpRunsTheCreateHook();

      await expect(
        StatusPageSubscriberService.createFromStatusPageSignUp(
          subscription({
            contact: kind.contact,
            resourceIds: [OWN_RESOURCE, OWN_ARCHIVED_MONITOR_RESOURCE],
          }),
        ),
      ).rejects.toThrow(refusalFor([OWN_ARCHIVED_MONITOR_RESOURCE]));

      expect(pagesLookup).not.toHaveBeenCalled();
    },
  );

  test.each(KINDS)(
    "a $kind sign-up naming another page's resource is refused in the same words",
    async (kind: {
      kind: string;
      contact: (row: StatusPageSubscriber) => void;
    }) => {
      signUpRunsTheCreateHook();

      await expect(
        StatusPageSubscriberService.createFromStatusPageSignUp(
          subscription({
            contact: kind.contact,
            resourceIds: [OTHER_PAGE_RESOURCE],
          }),
        ),
      ).rejects.toThrow(refusalFor([OTHER_PAGE_RESOURCE]));
    },
  );

  test.each(KINDS)(
    "a $kind sign-up naming resources the page shows is created",
    async (kind: {
      kind: string;
      contact: (row: StatusPageSubscriber) => void;
    }) => {
      const create: jest.SpyInstance = signUpRunsTheCreateHook();

      await expect(
        StatusPageSubscriberService.createFromStatusPageSignUp(
          subscription({
            contact: kind.contact,
            resourceIds: [OWN_RESOURCE],
          }),
        ),
      ).resolves.toBeDefined();

      expect(create).toHaveBeenCalledTimes(1);
      expect(
        (create.mock.calls[0]![0] as CreateBy<StatusPageSubscriber>).props,
      ).toEqual({ isRoot: true });
    },
  );

  test("a sign-up asks once: the page is read once, with each resource's monitor", async () => {
    signUpRunsTheCreateHook();

    await StatusPageSubscriberService.createFromStatusPageSignUp(
      subscription({
        contact: KINDS[0]!.contact,
        resourceIds: [OWN_RESOURCE],
      }),
    );

    expect(pageLookups).toEqual([PAGE_ID.toString()]);
  });

  test("the team's create is not a visitor's, before or after a sign-up", async () => {
    signUpRunsTheCreateHook();

    await expect(
      StatusPageSubscriberService.createFromStatusPageSignUp(
        subscription({
          contact: KINDS[0]!.contact,
          resourceIds: [OWN_ARCHIVED_MONITOR_RESOURCE],
        }),
      ),
    ).rejects.toThrow();

    // The team may name it: the dashboard's picker lists every resource.
    await expect(
      hooks.onBeforeCreate({
        data: subscription({
          contact: KINDS[0]!.contact,
          resourceIds: [OWN_ARCHIVED_MONITOR_RESOURCE],
        }),
        props: { isRoot: true },
      }),
    ).resolves.toBeDefined();
  });

  test("a visitor's change is written as OneUptime, to that one subscriber", async () => {
    const update: jest.SpyInstance = getJestSpyOn(
      StatusPageSubscriberService,
      "updateBy",
    ).mockResolvedValue(1 as never);

    await expect(
      StatusPageSubscriberService.updateFromManageSubscriptionPage({
        subscriberId: SUBSCRIBER_ID,
        data: {
          isSubscribedToAllResources: true,
        } as unknown as UpdateBy<StatusPageSubscriber>["data"],
      }),
    ).resolves.toBe(1);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![0]).toEqual({
      query: { _id: SUBSCRIBER_ID.toString() },
      data: { isSubscribedToAllResources: true },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });
  });

  test("a visitor's change that adds a resource the page hides is refused", async () => {
    subscriberHolding([OWN_RESOURCE]);
    changeRunsTheUpdateHook();

    await expect(
      StatusPageSubscriberService.updateFromManageSubscriptionPage({
        subscriberId: SUBSCRIBER_ID,
        data: {
          statusPageResources: resources([
            OWN_RESOURCE,
            OWN_ARCHIVED_MONITOR_RESOURCE,
          ]),
        } as unknown as UpdateBy<StatusPageSubscriber>["data"],
      }),
    ).rejects.toThrow(refusalFor([OWN_ARCHIVED_MONITOR_RESOURCE]));
  });

  test("a visitor's change that adds another page's resource is refused", async () => {
    subscriberHolding([]);
    changeRunsTheUpdateHook();

    await expect(
      StatusPageSubscriberService.updateFromManageSubscriptionPage({
        subscriberId: SUBSCRIBER_ID,
        data: {
          statusPageResources: resources([OTHER_PAGE_RESOURCE]),
        } as unknown as UpdateBy<StatusPageSubscriber>["data"],
      }),
    ).rejects.toThrow(refusalFor([OTHER_PAGE_RESOURCE]));
  });

  test("a visitor keeps a hidden resource the subscription named before its monitor was archived", async () => {
    subscriberHolding([OWN_ARCHIVED_MONITOR_RESOURCE]);
    changeRunsTheUpdateHook();

    await expect(
      StatusPageSubscriberService.updateFromManageSubscriptionPage({
        subscriberId: SUBSCRIBER_ID,
        data: {
          statusPageResources: resources([
            OWN_ARCHIVED_MONITOR_RESOURCE,
            OWN_RESOURCE,
          ]),
        } as unknown as UpdateBy<StatusPageSubscriber>["data"],
      }),
    ).resolves.toBe(1);
  });

  test("the team's change is not a visitor's, before or after a visitor's", async () => {
    subscriberHolding([]);
    changeRunsTheUpdateHook();

    await expect(
      StatusPageSubscriberService.updateFromManageSubscriptionPage({
        subscriberId: SUBSCRIBER_ID,
        data: {
          statusPageResources: resources([OWN_ARCHIVED_MONITOR_RESOURCE]),
        } as unknown as UpdateBy<StatusPageSubscriber>["data"],
      }),
    ).rejects.toThrow();

    await expect(
      hooks.onBeforeUpdate({
        query: { _id: SUBSCRIBER_ID.toString() },
        data: {
          statusPageResources: resources([OWN_ARCHIVED_MONITOR_RESOURCE]),
        } as unknown as StatusPageSubscriber,
        props: { isRoot: true },
        skip: 0,
        limit: 1,
      } as unknown as UpdateBy<StatusPageSubscriber>),
    ).resolves.toBeDefined();
  });
});

describe("StatusPageSubscriberService - a change is held to the subscribers it checked", () => {
  beforeEach(() => {
    getJestSpyOn(ProjectReferenceCheck, "validateUpdate").mockResolvedValue(
      undefined,
    );
  });

  function subscriber(id: string, held: Array<string>): StatusPageSubscriber {
    const row: StatusPageSubscriber = new StatusPageSubscriber();
    row._id = id;
    row.projectId = PROJECT_ID;
    row.statusPageId = PAGE_ID;
    row.statusPageResources = resources(held);
    return row;
  }

  test("a change of one subscriber names it, in a window of one", async () => {
    contactLookup.mockResolvedValue([subscriber(SUBSCRIBER_ID.toString(), [])]);

    const updateBy: UpdateBy<StatusPageSubscriber> = {
      query: { _id: SUBSCRIBER_ID.toString() },
      data: {
        statusPageResources: resources([OWN_RESOURCE]),
      } as unknown as StatusPageSubscriber,
      props: { tenantId: PROJECT_ID, userId: ObjectID.generate() },
      skip: 0,
      limit: 1,
    } as unknown as UpdateBy<StatusPageSubscriber>;

    await hooks.onBeforeUpdate(updateBy);

    expect((updateBy.query as unknown as JSONObject)["_id"]).toBe(
      SUBSCRIBER_ID.toString(),
    );
    expect(updateBy.skip).toBe(0);
    expect(updateBy.limit).toBe(1);
  });

  test("a bulk change is held to the subscribers read in its window", async () => {
    const second: string = "6a000000-0000-4000-8000-000000000099";

    contactLookup.mockResolvedValue([
      subscriber(SUBSCRIBER_ID.toString(), []),
      subscriber(second, []),
    ]);

    const updateBy: UpdateBy<StatusPageSubscriber> = {
      query: { statusPageId: PAGE_ID },
      data: {
        statusPageResources: resources([OWN_RESOURCE]),
      } as unknown as StatusPageSubscriber,
      props: { tenantId: PROJECT_ID, userId: ObjectID.generate() },
      skip: 0,
      limit: 15000,
    } as unknown as UpdateBy<StatusPageSubscriber>;

    await hooks.onBeforeUpdate(updateBy);

    const query: JSONObject = updateBy.query as unknown as JSONObject;
    const named: Array<string> = Object.values(
      (query["_id"] as unknown as { objectLiteralParameters: JSONObject })
        .objectLiteralParameters,
    ).flat() as Array<string>;

    expect(named.sort()).toEqual([SUBSCRIBER_ID.toString(), second].sort());
    expect(query["statusPageId"]).toBe(PAGE_ID);
    expect(updateBy.limit).toBe(2);
  });

  test("a change that names no resource is left as it was sent", async () => {
    const updateBy: UpdateBy<StatusPageSubscriber> = {
      query: { statusPageId: PAGE_ID },
      data: {
        isSubscribedToAllEventTypes: true,
      } as unknown as StatusPageSubscriber,
      props: { isRoot: true },
      skip: 0,
      limit: 15000,
    } as unknown as UpdateBy<StatusPageSubscriber>;

    await hooks.onBeforeUpdate(updateBy);

    expect(updateBy.query).toEqual({ statusPageId: PAGE_ID });
    expect(updateBy.limit).toBe(15000);
  });
});
