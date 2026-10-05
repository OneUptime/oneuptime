import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import DashboardDomainService from "../../../Server/Services/DashboardDomainService";
import DomainService from "../../../Server/Services/DomainService";
import GlobalOidcProjectService from "../../../Server/Services/GlobalOidcProjectService";
import GlobalSsoProjectService from "../../../Server/Services/GlobalSsoProjectService";
import IncidentEpisodeRoleMemberService from "../../../Server/Services/IncidentEpisodeRoleMemberService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusTimelineService, {
  MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE,
} from "../../../Server/Services/MonitorStatusTimelineService";
import OnCallDutyPolicyScheduleCalendarFeedService from "../../../Server/Services/OnCallDutyPolicyScheduleCalendarFeedService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import RumSessionErasureRequestService from "../../../Server/Services/RumSessionErasureRequestService";
import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import StatusPagePrivateUserService from "../../../Server/Services/StatusPagePrivateUserService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "../../../Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberNotificationTemplateStatusPageService from "../../../Server/Services/StatusPageSubscriberNotificationTemplateStatusPageService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import UserIncomingCallNumberService from "../../../Server/Services/UserIncomingCallNumberService";
import UserPushService from "../../../Server/Services/UserPushService";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import MonitorStepsProjectValidator from "../../../Server/Utils/Monitor/MonitorStepsProjectValidator";
import RelationIdUtil from "../../../Server/Utils/Database/RelationIdUtil";
import SubscriberTemplateIncidentRecordAccess from "../../../Server/Utils/StatusPage/SubscriberTemplateIncidentRecordAccess";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Team from "../../../Models/DatabaseModels/Team";
import { RumSessionErasureRequestType } from "../../../Models/DatabaseModels/RumSessionErasureRequest";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import ServerException from "../../../Types/Exception/ServerException";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A record's reference has two names a write can use - its ID column
 * (`statusPageId`) and the relation (`statusPage: { _id }`, which the
 * dashboard's forms post) - and they are one database column. Every rule
 * below reads the reference of a write under both names, so it holds
 * whichever one a write uses; a write naming the reference only by the
 * relation used to reach each of them as a write that names nothing. Two
 * names that disagree are refused with the words every reference is
 * refused with. The services' own hooks run here; which records a project
 * has is a stand-in.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-b0b0-4aaa-8bbb-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-b0b0-4aaa-8bbb-000000000002",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-b0b0-4aaa-8bbb-0000000000e1");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "0193c0de-b0b0-4aaa-8bbb-0000000000e2",
);
const ID_A: string = "0193c0de-b0b0-4aaa-8bbb-0000000000a1";
const ID_B: string = "0193c0de-b0b0-4aaa-8bbb-0000000000b2";

type Hooks = {
  onBeforeCreate: (createBy: unknown) => Promise<unknown>;
  onBeforeUpdate: (updateBy: unknown) => Promise<unknown>;
};

function hooks(service: unknown): Hooks {
  return service as Hooks;
}

// What a hook answered: "went on", or the error it threw.
function settle(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => {
      return "went on";
    },
    (error: unknown) => {
      return error;
    },
  );
}

function firstCallArgument(spy: {
  mock: { calls: Array<Array<unknown>> };
}): Record<string, unknown> {
  return spy.mock.calls[0]![0] as Record<string, unknown>;
}

function conflict(title: string, keys: Array<string>): string {
  return RelationIdUtil.getConflictMessage(title, keys);
}

beforeEach(() => {
  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a status page invitation is refused once the page has invited the address", () => {
  const STATUS_PAGE_ID: ObjectID = new ObjectID(ID_A);

  function invite(data: Record<string, unknown>): Promise<unknown> {
    return settle(
      hooks(StatusPagePrivateUserService).onBeforeCreate({
        data: {
          email: new Email("ada@example.com"),
          projectId: PROJECT_ID,
          ...data,
        },
        props: { tenantId: PROJECT_ID, userId: USER_ID },
      }),
    );
  }

  test("for a page named by the relation", async () => {
    const findOneBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(StatusPagePrivateUserService, "findOneBy")
      .mockResolvedValue({ _id: ID_B } as never);

    const outcome: unknown = await invite({
      statusPage: { _id: STATUS_PAGE_ID.toString() },
    });

    expect((outcome as Error).message).toBe(
      "This user is already invited to this status page.",
    );
    expect(
      String(
        (firstCallArgument(findOneBy)["query"] as Record<string, unknown>)[
          "statusPageId"
        ],
      ),
    ).toBe(STATUS_PAGE_ID.toString());
  });

  test("for a page named by its ID column", async () => {
    jest
      .spyOn(StatusPagePrivateUserService, "findOneBy")
      .mockResolvedValue({ _id: ID_B } as never);

    expect(
      ((await invite({ statusPageId: STATUS_PAGE_ID })) as Error).message,
    ).toBe("This user is already invited to this status page.");
  });

  test("keeps a page named by the relation in its ID column, for the invitation mail", async () => {
    jest
      .spyOn(StatusPagePrivateUserService, "findOneBy")
      .mockResolvedValue(null as never);

    const data: Record<string, unknown> = {
      email: new Email("ada@example.com"),
      projectId: PROJECT_ID,
      statusPage: { _id: STATUS_PAGE_ID.toString() },
    };

    await hooks(StatusPagePrivateUserService).onBeforeCreate({
      data: data,
      props: { tenantId: PROJECT_ID, userId: USER_ID },
    });

    expect(String(data["statusPageId"])).toBe(STATUS_PAGE_ID.toString());
  });

  test("refuses a page named differently under its two names", async () => {
    const findOneBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      StatusPagePrivateUserService,
      "findOneBy",
    );

    const outcome: unknown = await invite({
      statusPageId: STATUS_PAGE_ID,
      statusPage: { _id: ID_B },
    });

    expect((outcome as Error).message).toBe(
      conflict("Status Page", ["statusPageId", "statusPage"]),
    );
    expect(findOneBy).not.toHaveBeenCalled();
  });
});

describe("moving a subscriber template link is checked under either name", () => {
  const TEMPLATE_ID: string = ID_A;
  const LINKED_TEMPLATE_ID: string = ID_B;

  function update(data: Record<string, unknown>): Promise<unknown> {
    return settle(
      hooks(
        StatusPageSubscriberNotificationTemplateStatusPageService,
      ).onBeforeUpdate({
        data: data,
        query: { _id: "0193c0de-b0b0-4aaa-8bbb-0000000000c1" },
        props: { tenantId: PROJECT_ID, userId: USER_ID },
      }),
    );
  }

  beforeEach(() => {
    jest
      .spyOn(StatusPageSubscriberNotificationTemplateStatusPageService, "findBy")
      .mockResolvedValue([
        { statusPageSubscriberNotificationTemplateId: LINKED_TEMPLATE_ID },
      ] as never);

    jest
      .spyOn(SubscriberTemplateIncidentRecordAccess, "assertCanPlace")
      .mockImplementation(() => {
        throw new BadDataException("past the placement check");
      });
  });

  test("a template named by the relation is checked as placed", async () => {
    const held: ReturnType<typeof jest.spyOn> = jest
      .spyOn(
        StatusPageSubscriberNotificationTemplateService,
        "getIncidentRecordPlaceholdersHeld",
      )
      .mockResolvedValue([] as never);

    const outcome: unknown = await update({
      statusPageSubscriberNotificationTemplate: { _id: TEMPLATE_ID },
    });

    expect((outcome as Error).message).toBe("past the placement check");
    expect(
      (firstCallArgument(held)["templateIds"] as Array<ObjectID>).map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual([TEMPLATE_ID]);
  });

  test("a link moved to a page named by the relation checks the templates it already holds", async () => {
    const held: ReturnType<typeof jest.spyOn> = jest
      .spyOn(
        StatusPageSubscriberNotificationTemplateService,
        "getIncidentRecordPlaceholdersHeld",
      )
      .mockResolvedValue([] as never);

    const outcome: unknown = await update({
      statusPage: { _id: ID_A },
    });

    expect((outcome as Error).message).toBe("past the placement check");
    expect(
      (firstCallArgument(held)["templateIds"] as Array<unknown>).map(
        (id: unknown): string => {
          return String(id);
        },
      ),
    ).toEqual([LINKED_TEMPLATE_ID]);
  });

  test("an update naming the template differently under its two names is refused", async () => {
    const outcome: unknown = await update({
      statusPageSubscriberNotificationTemplateId: new ObjectID(TEMPLATE_ID),
      statusPageSubscriberNotificationTemplate: { _id: LINKED_TEMPLATE_ID },
    });

    expect((outcome as Error).message).toContain(
      "Conflicting Status Page Subscriber Notification Template references were provided.",
    );
  });

  test("an update touching neither is not checked", async () => {
    const held: ReturnType<typeof jest.spyOn> = jest.spyOn(
      StatusPageSubscriberNotificationTemplateService,
      "getIncidentRecordPlaceholdersHeld",
    );

    expect(await update({ name: "Renamed" })).toBe("went on");
    expect(held).not.toHaveBeenCalled();
  });
});

describe.each([
  ["a dashboard's custom domain", DashboardDomainService],
  ["a status page's custom domain", StatusPageDomainService],
])(
  "%s is checked on the domain named under either name",
  (_name: string, service: unknown) => {
    function create(data: Record<string, unknown>): Promise<unknown> {
      return settle(
        hooks(service).onBeforeCreate({
          data: { subdomain: "status", projectId: PROJECT_ID, ...data },
          props: { tenantId: PROJECT_ID, userId: USER_ID },
        }),
      );
    }

    test("a domain named by the relation is the one looked up", async () => {
      const findOneBy: ReturnType<typeof jest.spyOn> = jest
        .spyOn(DomainService, "findOneBy")
        .mockResolvedValue({ isVerified: false } as never);

      const outcome: unknown = await create({ domain: { _id: ID_A } });

      expect((outcome as Error).message).toBe(
        "This domain is not verified. Please verify it by going to Settings > Domains",
      );
      expect(
        (firstCallArgument(findOneBy)["query"] as Record<string, unknown>)[
          "_id"
        ],
      ).toBe(ID_A);
    });

    test("a domain named differently under its two names is refused before it is looked up", async () => {
      const findOneBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        DomainService,
        "findOneBy",
      );

      const outcome: unknown = await create({
        domainId: new ObjectID(ID_A),
        domain: { _id: ID_B },
      });

      expect((outcome as Error).message).toBe(
        conflict("Domain", ["domainId", "domain"]),
      );
      expect(findOneBy).not.toHaveBeenCalled();
    });
  },
);

describe("an episode role is held only by a member of the project, named either way", () => {
  function assign(
    data: Record<string, unknown>,
    props: Record<string, unknown> = { tenantId: PROJECT_ID, userId: USER_ID },
  ): Promise<unknown> {
    return settle(
      hooks(IncidentEpisodeRoleMemberService).onBeforeCreate({
        data: { projectId: PROJECT_ID, ...data },
        props: props,
      }),
    );
  }

  test("a person named by the relation who is not a member is refused", async () => {
    const isMember: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TeamMemberService, "isUserMemberOfProject")
      .mockResolvedValue(false as never);

    const outcome: unknown = await assign({
      user: { _id: OTHER_USER_ID.toString() },
    });

    expect((outcome as Error).message).toBe(
      "This user is not a member of this project and cannot be assigned a role on this episode.",
    );
    expect(String(firstCallArgument(isMember)["userId"])).toBe(
      OTHER_USER_ID.toString(),
    );
  });

  test("membership is asked of the project the role is saved in", async () => {
    const isMember: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TeamMemberService, "isUserMemberOfProject")
      .mockResolvedValue(true as never);

    await assign({
      projectId: OTHER_PROJECT_ID,
      userId: OTHER_USER_ID,
    });

    expect(String(firstCallArgument(isMember)["projectId"])).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("a person named differently under the two names is refused", async () => {
    const outcome: unknown = await assign({
      userId: USER_ID,
      user: { _id: OTHER_USER_ID.toString() },
    });

    expect((outcome as Error).message).toBe(
      conflict("User", ["userId", "user"]),
    );
  });
});

describe("an API key permission's duplicate check reads the key under either name", () => {
  test("a key named by the relation is the key the duplicate is looked for on", async () => {
    jest
      .spyOn(ApiKeyService, "findOneBy")
      .mockResolvedValue({ _id: ID_A } as never);
    const findOneBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ApiKeyPermissionService, "findOneBy")
      .mockResolvedValue({ _id: ID_B } as never);

    const outcome: unknown = await settle(
      hooks(ApiKeyPermissionService).onBeforeCreate({
        data: {
          apiKey: { _id: ID_A },
          permission: Permission.ReadProjectMonitor,
        },
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    );

    expect((outcome as Error).message).toBe(
      "This permission is already assigned to this API Key",
    );

    const query: Record<string, unknown> = firstCallArgument(findOneBy)[
      "query"
    ] as Record<string, unknown>;

    expect(String(query["apiKeyId"])).toBe(ID_A);
    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
  });
});

describe("a device or phone number is looked for among the owner's, named either way", () => {
  test("a push device whose owner is named by the relation is looked for among theirs", async () => {
    const countBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(UserPushService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);

    const outcome: unknown = await settle(
      hooks(UserPushService).onBeforeCreate({
        data: {
          deviceToken: "token-1",
          deviceType: Object.values(PushDeviceType)[0],
          projectId: PROJECT_ID,
          user: { _id: USER_ID.toString() },
        },
        props: { userId: USER_ID, tenantId: PROJECT_ID },
      }),
    );

    expect((outcome as Error).message).toBe(
      "This device is already registered for push notifications",
    );
    expect(
      String(
        (firstCallArgument(countBy)["query"] as Record<string, unknown>)[
          "userId"
        ],
      ),
    ).toBe(USER_ID.toString());
  });

  test("a push device that names no owner is looked for among the person registering it", async () => {
    const countBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(UserPushService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    await hooks(UserPushService).onBeforeCreate({
      data: {
        deviceToken: "token-1",
        deviceType: Object.values(PushDeviceType)[0],
        projectId: PROJECT_ID,
      },
      props: { userId: USER_ID, tenantId: PROJECT_ID },
    });

    expect(
      String(
        (firstCallArgument(countBy)["query"] as Record<string, unknown>)[
          "userId"
        ],
      ),
    ).toBe(USER_ID.toString());
  });

  test("an incoming call number whose owner is named by the relation is checked against theirs", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      enableSmsNotifications: true,
      smsOrCallCurrentBalanceInUSDCents: 100000,
    } as never);
    jest
      .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
      .mockResolvedValue(undefined as never);
    const findOneBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(UserIncomingCallNumberService, "findOneBy")
      .mockResolvedValue({ _id: ID_A } as never);

    const outcome: unknown = await settle(
      hooks(UserIncomingCallNumberService).onBeforeCreate({
        data: {
          projectId: PROJECT_ID,
          user: { _id: OTHER_USER_ID.toString() },
        },
        props: { userId: USER_ID, tenantId: PROJECT_ID },
      }),
    );

    expect((outcome as Error).message).toContain(
      "You already have a verified phone number for this project.",
    );
    expect(
      String(
        (firstCallArgument(findOneBy)["query"] as Record<string, unknown>)[
          "userId"
        ],
      ),
    ).toBe(OTHER_USER_ID.toString());
  });
});

describe("a schedule's shared calendar feed reads the schedule under either name", () => {
  test("a schedule named by the relation is the one looked for in the project", async () => {
    const findSchedule: ReturnType<typeof jest.spyOn> = jest
      .spyOn(OnCallDutyPolicyScheduleService, "findOneBy")
      .mockResolvedValue(null as never);

    const data: Record<string, unknown> = {
      onCallDutyPolicySchedule: { _id: ID_A },
    };

    const outcome: unknown = await settle(
      hooks(OnCallDutyPolicyScheduleCalendarFeedService).onBeforeCreate({
        data: data,
        props: { tenantId: PROJECT_ID, userId: USER_ID },
      }),
    );

    expect((outcome as Error).message).toBe(
      "On-call schedule not found in this project.",
    );

    const query: Record<string, unknown> = firstCallArgument(findSchedule)[
      "query"
    ] as Record<string, unknown>;

    expect(String(query["_id"])).toBe(ID_A);
    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
    expect(String(data["onCallDutyPolicyScheduleId"])).toBe(ID_A);
  });

  test("the feed is checked in the request's project, whatever the payload names", async () => {
    const findSchedule: ReturnType<typeof jest.spyOn> = jest
      .spyOn(OnCallDutyPolicyScheduleService, "findOneBy")
      .mockResolvedValue(null as never);

    await settle(
      hooks(OnCallDutyPolicyScheduleCalendarFeedService).onBeforeCreate({
        data: {
          projectId: OTHER_PROJECT_ID,
          onCallDutyPolicyScheduleId: new ObjectID(ID_A),
        },
        props: { tenantId: PROJECT_ID, userId: USER_ID },
      }),
    );

    expect(
      String(
        (firstCallArgument(findSchedule)["query"] as Record<string, unknown>)[
          "projectId"
        ],
      ),
    ).toBe(PROJECT_ID.toString());
  });
});

describe("a monitor status change locks the monitor named under either name", () => {
  test("a monitor named by the relation is the one locked", async () => {
    const lock: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Semaphore, "lock")
      .mockRejectedValue(new Error("lock unavailable") as never);

    const data: Record<string, unknown> = {
      projectId: PROJECT_ID,
      monitor: { _id: ID_A },
      monitorStatusId: new ObjectID(ID_B),
    };

    const outcome: unknown = await settle(
      MonitorStatusTimelineService.create({
        data: data as never,
        props: { isRoot: true },
      }),
    );

    expect(outcome).toBeInstanceOf(ServerException);
    expect((outcome as Error).message).toBe(
      MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE,
    );
    expect(firstCallArgument(lock)["key"]).toBe(ID_A);
    expect(String(data["monitorId"])).toBe(ID_A);
  });

  test("a monitor named differently under its two names is refused before anything is locked", async () => {
    const lock: ReturnType<typeof jest.spyOn> = jest.spyOn(Semaphore, "lock");

    const outcome: unknown = await settle(
      MonitorStatusTimelineService.create({
        data: {
          projectId: PROJECT_ID,
          monitorId: new ObjectID(ID_A),
          monitor: { _id: ID_B },
        } as never,
        props: { isRoot: true },
      }),
    );

    expect((outcome as Error).message).toBe(
      conflict("Monitor", ["monitorId", "monitor"]),
    );
    expect(lock).not.toHaveBeenCalled();
  });
});

describe("a status page subscriber names its page either way", () => {
  test("a page named by the relation alone gets past the required page", async () => {
    jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: false,
      isFreePlan: false,
    } as never);
    jest
      .spyOn(StatusPageSubscriberService, "findBy")
      .mockResolvedValue([] as never);
    const pages: ReturnType<typeof jest.spyOn> = jest
      .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
      .mockResolvedValue([] as never);
    jest
      .spyOn(StatusPageService, "isStatusPageArchived")
      .mockResolvedValue(false as never);

    const data: Record<string, unknown> = {
      projectId: PROJECT_ID,
      statusPage: { _id: ID_A },
      subscriberEmail: new Email("ada@example.com"),
    };

    const outcome: unknown = await settle(
      hooks(StatusPageSubscriberService).onBeforeCreate({
        data: data,
        props: { isRoot: true },
      }),
    );

    // Past "Status Page ID is required.", to the page the write named.
    expect((outcome as Error).message).toBe("Status Page not found");
    expect(String((pages.mock.calls[0]![0] as Array<unknown>)[0])).toBe(ID_A);
    expect(String(data["statusPageId"])).toBe(ID_A);
  });

  test("a subscriber naming no page is still refused", async () => {
    const outcome: unknown = await settle(
      hooks(StatusPageSubscriberService).onBeforeCreate({
        data: { projectId: PROJECT_ID },
        props: { isRoot: true },
      }),
    );

    expect((outcome as Error).message).toBe("Status Page ID is required.");
  });
});

describe.each([
  ["a global SSO provider", GlobalSsoProjectService],
  ["a global OIDC provider", GlobalOidcProjectService],
])(
  "%s's default teams are checked against the project an update names either way",
  (_name: string, service: unknown) => {
    function teamIn(projectId: ObjectID): Team {
      const team: Team = new Team();
      team._id = ID_B;
      team.projectId = projectId;
      return team;
    }

    test("teams of another project than the one named by the relation are refused", async () => {
      jest
        .spyOn(TeamService, "findBy")
        .mockResolvedValue([teamIn(OTHER_PROJECT_ID)] as never);

      const outcome: unknown = await settle(
        hooks(service).onBeforeUpdate({
          data: {
            teams: [{ _id: ID_B }],
            project: { _id: PROJECT_ID.toString() },
          },
          query: { _id: ID_A },
          props: { isMasterAdmin: true, userId: USER_ID },
        }),
      );

      expect((outcome as Error).message).toBe(
        "All selected teams must belong to the project this provider is attached to.",
      );
    });

    test("teams of the project named by the relation go on", async () => {
      jest
        .spyOn(TeamService, "findBy")
        .mockResolvedValue([teamIn(PROJECT_ID)] as never);

      expect(
        await settle(
          hooks(service).onBeforeUpdate({
            data: {
              teams: [{ _id: ID_B }],
              project: { _id: PROJECT_ID.toString() },
            },
            query: { _id: ID_A },
            props: { isMasterAdmin: true, userId: USER_ID },
          }),
        ),
      ).toBe("went on");
    });
  },
);

describe("an auto-provisioned monitor is checked when its device is named by the relation", () => {
  test("it must be linked to a monitor template", async () => {
    jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: false,
      isFreePlan: false,
    } as never);
    jest
      .spyOn(
        MonitorStepsProjectValidator,
        "validateMonitorStepsBelongToProject",
      )
      .mockResolvedValue(undefined as never);

    const monitor: Monitor = new Monitor();
    monitor.name = "Core switch";
    monitor.monitorType = MonitorType.Manual;
    (monitor as unknown as Record<string, unknown>)[
      "autoProvisionedNetworkDevice"
    ] = { _id: ID_A };

    const outcome: unknown = await settle(
      hooks(MonitorService).onBeforeCreate({
        data: monitor,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    );

    expect((outcome as Error).message).toBe(
      "An auto-provisioned Network Device monitor must be linked to a monitor template.",
    );
    expect(String(monitor.autoProvisionedNetworkDeviceId)).toBe(ID_A);
  });
});

describe("a session replay erasure request keeps its application under its ID column", () => {
  test("an application named by the relation is kept in the ID column", async () => {
    const data: Record<string, unknown> = {
      projectId: PROJECT_ID,
      requestType: RumSessionErasureRequestType.ByRumApplication,
      targetValue: ID_A,
      rumApplication: { _id: ID_A },
    };

    await hooks(RumSessionErasureRequestService).onBeforeCreate({
      data: data,
      props: { tenantId: PROJECT_ID, userId: USER_ID },
    });

    expect(String(data["rumApplicationId"])).toBe(ID_A);
  });

  test("an application named differently under its two names is refused", async () => {
    const outcome: unknown = await settle(
      hooks(RumSessionErasureRequestService).onBeforeCreate({
        data: {
          projectId: PROJECT_ID,
          requestType: RumSessionErasureRequestType.ByRumApplication,
          targetValue: ID_A,
          rumApplicationId: new ObjectID(ID_A),
          rumApplication: { _id: ID_B },
        },
        props: { tenantId: PROJECT_ID, userId: USER_ID },
      }),
    );

    expect((outcome as Error).message).toBe(
      conflict("RUM Application", ["rumApplicationId", "rumApplication"]),
    );
  });
});
