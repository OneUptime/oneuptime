import AlertOnCallRule from "../../../Models/DatabaseModels/AlertOnCallRule";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Project from "../../../Models/DatabaseModels/Project";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import { IsBillingEnabled } from "../../../Server/EnvironmentConfig";
import AlertOnCallRuleEngineService from "../../../Server/Services/AlertOnCallRuleEngineService";
import AlertOnCallRuleService from "../../../Server/Services/AlertOnCallRuleService";
import AlertOwnerRuleService from "../../../Server/Services/AlertOwnerRuleService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import IncidentOnCallRuleEngineService from "../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentOnCallRuleService from "../../../Server/Services/IncidentOnCallRuleService";
import IncidentOwnerRuleService from "../../../Server/Services/IncidentOwnerRuleService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallReadinessService, {
  ReadinessStatus,
  UserReadiness,
} from "../../../Server/Services/OnCallReadinessService";
import OnCallTestPageService from "../../../Server/Services/OnCallTestPageService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import WhoIsToldService, {
  canServerSendBy,
  getMonitorCriteriaInstances,
  pickSeverity,
} from "../../../Server/Services/WhoIsToldService";
import ServerSendingStatus from "../../../Server/Utils/ServerSending/ServerSendingStatus";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import {
  WhoIsToldBreak,
  WhoIsToldBreakKind,
  WhoIsToldEvent,
  WhoIsToldOwnersSource,
  WhoIsToldPersonProblem,
  WhoIsToldResult,
  WhoIsToldServerChannel,
} from "../../../Types/Monitor/WhoIsTold";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPagePreviewPerson,
  OnCallTestPageRecordKind,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingState,
} from "../../../Types/ServerSending/ServerSendingStatus";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE RESOLVER (WhoIsToldService, #6810): from a monitor's criteria to the
 * people they reach, read without sending or changing anything, and handed
 * to each caller as they may see it.
 *
 * Every read is stubbed with the project's records: the criteria, the
 * severities and statuses, the rules the engines' matching returns, each
 * policy's first level (as a test of the policy reads it), each person's
 * rules and verified methods, the project's channels and the server's.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "68101111-0000-4000-8000-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "68101111-0000-4000-8000-000000000002",
);
const CRITICAL: string = "68101111-0000-4000-8000-0000000000b1";
const MINOR: string = "68101111-0000-4000-8000-0000000000b2";
const ARCHIVED_SEVERITY: string = "68101111-0000-4000-8000-0000000000b0";
const ALERT_WARNING: string = "68101111-0000-4000-8000-0000000000e1";
const OFFLINE: string = "68101111-0000-4000-8000-0000000000f1";
const ONLINE: string = "68101111-0000-4000-8000-0000000000f2";
const PRIMARY: string = "68101111-0000-4000-8000-0000000000a1";
const SECONDARY: string = "68101111-0000-4000-8000-0000000000a2";
const ELSEWHERE_POLICY: string = "68101111-0000-4000-8000-0000000000a9";
const RULE: string = "68101111-0000-4000-8000-0000000000c1";
const ANA: string = "68101111-0000-4000-8000-0000000000d1";
const BEN: string = "68101111-0000-4000-8000-0000000000d2";
const STATUS_PAGE: string = "68101111-0000-4000-8000-000000000051";

const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("68101111-0000-4000-8000-0000000000ff"),
};

function withId<T extends { _id?: string | undefined }>(
  item: T,
  id: string,
): T {
  item._id = id;
  return item;
}

function criteriaInstance(
  data: Record<string, unknown>,
): MonitorCriteriaInstance {
  return {
    data: {
      filterCondition: "All",
      filters: [],
      incidents: [],
      alerts: [],
      description: "",
      ...data,
    },
  } as unknown as MonitorCriteriaInstance;
}

function stepsOf(
  ...steps: Array<Array<MonitorCriteriaInstance>>
): MonitorSteps {
  return {
    data: {
      monitorStepsInstanceArray: steps.map(
        (instances: Array<MonitorCriteriaInstance>): unknown => {
          return {
            data: {
              monitorCriteria: {
                data: { monitorCriteriaInstanceArray: instances },
              },
            },
          };
        },
      ),
    },
  } as unknown as MonitorSteps;
}

const ONLINE_CRITERIA: MonitorCriteriaInstance = criteriaInstance({
  id: "online",
  name: "Online",
  monitorStatusId: new ObjectID(ONLINE),
  changeMonitorStatus: true,
});

function offlineCriteria(
  overrides: Record<string, unknown> = {},
): MonitorCriteriaInstance {
  return criteriaInstance({
    id: "offline",
    name: "Offline",
    monitorStatusId: new ObjectID(OFFLINE),
    changeMonitorStatus: true,
    createIncidents: true,
    incidents: [
      {
        id: "incident-template",
        title: "Checkout API is down",
        description: "",
        incidentSeverityId: new ObjectID(CRITICAL),
      },
    ],
    ...overrides,
  });
}

function user(name: string, email: string): User {
  const item: User = new User();
  item.name = name as never;
  item.email = email as never;
  return item;
}

function preview(
  overrides: Partial<OnCallTestPagePreviewPerson>,
): OnCallTestPagePreviewPerson {
  return {
    userId: ANA,
    userName: "Ana Lopez",
    methods: [],
    hasNoRule: false,
    isOptedOut: false,
    warnings: [],
    ...overrides,
  };
}

function readiness(userId: string, verified: Array<string>): UserReadiness {
  return {
    userId: new ObjectID(userId),
    userName: "",
    userEmail: "",
    status: ReadinessStatus.Ready,
    methods: verified.map((methodType: string) => {
      return {
        methodId: ObjectID.generate(),
        methodType: methodType,
        maskedIdentifier: "•••",
        isVerified: true,
      };
    }),
    coverage: [],
    reasons: [],
    reachedVia: [],
    teams: [],
  };
}

interface World {
  monitorSteps: MonitorSteps;
  project: Partial<Project>;
  incidentRules: Array<IncidentOnCallRule>;
  alertRules: Array<AlertOnCallRule>;
  incidentRuleCount: number;
  alertRuleCount: number;
  incidentOwnerRuleCount: number;
  levels: Record<
    string,
    {
      targets: Array<{ userId: ObjectID; reachedThrough?: string }>;
      notPaged: Array<string>;
      levelCount: number;
    }
  >;
  previews: Record<string, OnCallTestPagePreviewPerson>;
  verified: Record<string, Array<string>>;
  serverStatuses: Array<ServerChannelStatus>;
  // What the caller may read.
  callerReadsMonitor: boolean;
  callerPolicies: Array<string> | "refused";
  callerIncidentRules: Array<string> | "refused";
}

function serverStatus(
  channel: ServerSendingChannel,
  state: ServerSendingState,
): ServerChannelStatus {
  return {
    channel: channel,
    state: state,
    hasWorked: state === ServerSendingState.Working,
    lastWorkedAt: null,
    failingSince: null,
    lastFailure: null,
    setUpProblem: null,
  };
}

function rule(
  id: string,
  name: string,
  policyIds: Array<string>,
): IncidentOnCallRule {
  const item: IncidentOnCallRule = withId(new IncidentOnCallRule(), id);
  item.name = name;
  item.onCallDutyPolicies = policyIds.map(
    (policyId: string): OnCallDutyPolicy => {
      return withId(new OnCallDutyPolicy(), policyId);
    },
  );
  return item;
}

function defaultWorld(): World {
  return {
    monitorSteps: stepsOf([ONLINE_CRITERIA, offlineCriteria()]),
    project: {
      enableSmsNotifications: true,
      enableCallNotifications: true,
      enableWhatsAppNotifications: true,
      enableTelegramNotifications: true,
      disableOnCallNotificationFallback: false,
      smsOrCallCurrentBalanceInUSDCents: 1000,
      enableAutoRechargeSmsOrCallBalance: false,
    },
    incidentRules: [rule(RULE, "Every incident", [PRIMARY])],
    alertRules: [],
    incidentRuleCount: 1,
    alertRuleCount: 0,
    incidentOwnerRuleCount: 0,
    levels: {
      [PRIMARY]: {
        targets: [
          { userId: new ObjectID(ANA) },
          { userId: new ObjectID(BEN), reachedThrough: "Schedule Primary" },
        ],
        notPaged: [],
        levelCount: 2,
      },
      [SECONDARY]: { targets: [], notPaged: [], levelCount: 0 },
    },
    previews: {
      [ANA]: preview({
        methods: [
          {
            channel: OnCallPageChannel.SMS,
            notifyAfterMinutes: 0,
            isVerified: true,
            canAcknowledge: true,
          },
          {
            channel: OnCallPageChannel.Email,
            notifyAfterMinutes: 5,
            isVerified: true,
            canAcknowledge: true,
          },
        ],
      }),
      [BEN]: preview({ userId: BEN, userName: "Ben Ito", hasNoRule: true }),
    },
    verified: { [ANA]: ["SMS", "Email"], [BEN]: ["Push"] },
    serverStatuses: [
      serverStatus(ServerSendingChannel.Email, ServerSendingState.Working),
      serverStatus(ServerSendingChannel.SMS, ServerSendingState.Working),
      serverStatus(ServerSendingChannel.Call, ServerSendingState.Working),
    ],
    callerReadsMonitor: true,
    callerPolicies: [PRIMARY, SECONDARY],
    callerIncidentRules: [RULE],
  };
}

let world: World;

function count(value: number): PositiveNumber {
  return new PositiveNumber(value);
}

// The ids a QueryHelper.any read asks for: the parameters of its Raw IN.
function idsIn(query: unknown): Array<string> {
  const id: unknown = (query as { _id?: unknown })?._id;
  const parameters: Record<string, unknown> =
    ((id as { objectLiteralParameters?: Record<string, unknown> })
      ?.objectLiteralParameters as Record<string, unknown>) || {};
  const values: unknown = Object.values(parameters)[0];

  return (Array.isArray(values) ? values : []).map((value: unknown): string => {
    return String(value);
  });
}

function stubWorld(): void {
  jest.spyOn(MonitorService, "findOneBy").mockImplementation((async (args: {
    props: DatabaseCommonInteractionProps;
  }) => {
    if (!args.props.isRoot && !world.callerReadsMonitor) {
      return null;
    }

    const monitor: Monitor = withId(new Monitor(), MONITOR_ID.toString());
    monitor.name = "Checkout API";
    monitor.projectId = PROJECT_ID;
    monitor.monitorSteps = world.monitorSteps;
    monitor.labels = [];
    return monitor;
  }) as never);

  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    return Object.assign(new Project(), world.project);
  }) as never);

  jest
    .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockImplementation((async () => {
      const archived: IncidentSeverity = withId(
        new IncidentSeverity(),
        ARCHIVED_SEVERITY,
      );
      archived.name = "Retired";
      archived.isArchived = true;
      const critical: IncidentSeverity = withId(
        new IncidentSeverity(),
        CRITICAL,
      );
      critical.name = "Critical";
      const minor: IncidentSeverity = withId(new IncidentSeverity(), MINOR);
      minor.name = "Minor";
      return [archived, critical, minor];
    }) as never);

  jest.spyOn(AlertSeverityService, "findBy").mockImplementation((async () => {
    const warning: AlertSeverity = withId(new AlertSeverity(), ALERT_WARNING);
    warning.name = "Warning";
    return [warning];
  }) as never);

  jest.spyOn(MonitorStatusService, "findBy").mockImplementation((async () => {
    const offline: MonitorStatus = withId(new MonitorStatus(), OFFLINE);
    offline.name = "Offline";
    const online: MonitorStatus = withId(new MonitorStatus(), ONLINE);
    online.name = "Operational";
    return [offline, online];
  }) as never);

  jest
    .spyOn(OnCallDutyPolicyService, "findBy")
    .mockImplementation((async (args: {
      query: unknown;
      props: DatabaseCommonInteractionProps;
    }) => {
      if (args.props.isRoot) {
        return [
          [PRIMARY, "Primary"],
          [SECONDARY, "Secondary"],
        ].map(([id, name]: Array<string>): OnCallDutyPolicy => {
          const item: OnCallDutyPolicy = withId(new OnCallDutyPolicy(), id!);
          item.name = name!;
          return item;
        });
      }

      if (world.callerPolicies === "refused") {
        throw new NotAuthorizedException("You may not read on-call policies.");
      }

      const readable: Array<string> = world.callerPolicies;

      return idsIn(args.query)
        .filter((id: string): boolean => {
          return readable.includes(id);
        })
        .map((id: string): OnCallDutyPolicy => {
          return withId(new OnCallDutyPolicy(), id);
        });
    }) as never);

  jest
    .spyOn(IncidentOnCallRuleService, "findBy")
    .mockImplementation((async (args: { query: unknown }) => {
      if (world.callerIncidentRules === "refused") {
        throw new NotAuthorizedException("You may not read on-call rules.");
      }

      const readable: Array<string> = world.callerIncidentRules;

      return idsIn(args.query)
        .filter((id: string): boolean => {
          return readable.includes(id);
        })
        .map((id: string): IncidentOnCallRule => {
          return withId(new IncidentOnCallRule(), id);
        });
    }) as never);

  jest.spyOn(AlertOnCallRuleService, "findBy").mockResolvedValue([] as never);

  jest
    .spyOn(IncidentOnCallRuleService, "countBy")
    .mockImplementation((async () => {
      return count(world.incidentRuleCount);
    }) as never);
  jest
    .spyOn(AlertOnCallRuleService, "countBy")
    .mockImplementation((async () => {
      return count(world.alertRuleCount);
    }) as never);
  jest
    .spyOn(IncidentOwnerRuleService, "countBy")
    .mockImplementation((async () => {
      return count(world.incidentOwnerRuleCount);
    }) as never);
  jest
    .spyOn(AlertOwnerRuleService, "countBy")
    .mockResolvedValue(count(0) as never);

  jest
    .spyOn(IncidentOnCallRuleEngineService, "getMatchingRules")
    .mockImplementation((async () => {
      return world.incidentRules;
    }) as never);
  jest
    .spyOn(AlertOnCallRuleEngineService, "getMatchingRules")
    .mockImplementation((async () => {
      return world.alertRules;
    }) as never);

  jest
    .spyOn(StatusPageResourceService, "findBy")
    .mockImplementation((async () => {
      const resource: StatusPageResource = new StatusPageResource();
      resource.statusPageId = new ObjectID(STATUS_PAGE);
      resource.statusPage = new StatusPage();
      resource.statusPage.name = "Public status";
      return [resource, resource];
    }) as never);

  jest
    .spyOn(ProjectService, "getOwners")
    .mockResolvedValue([user("Owner One", "owner@example.com")] as never);
  jest.spyOn(MonitorService, "findOwners").mockResolvedValue([] as never);

  jest.spyOn(UserService, "findBy").mockImplementation((async () => {
    return [user("Named Person", "named@example.com")];
  }) as never);
  jest.spyOn(TeamService, "findBy").mockImplementation((async () => {
    const team: Team = new Team();
    team.name = "Platform";
    return [team];
  }) as never);

  jest
    .spyOn(OnCallTestPageService, "readFirstLevel")
    .mockImplementation((async (args: { policyId: ObjectID }) => {
      return world.levels[args.policyId.toString()]!;
    }) as never);

  jest
    .spyOn(OnCallTestPageService, "getPersonPreview")
    .mockImplementation((async (args: { userId: ObjectID }) => {
      return world.previews[args.userId.toString()]!;
    }) as never);

  jest
    .spyOn(OnCallReadinessService, "getReadinessForUsers")
    .mockImplementation((async (userIds: Array<ObjectID>) => {
      return userIds.map((userId: ObjectID): UserReadiness => {
        return readiness(
          userId.toString(),
          world.verified[userId.toString()] || [],
        );
      });
    }) as never);

  jest
    .spyOn(ServerSendingStatus, "getStatuses")
    .mockImplementation((async () => {
      return world.serverStatuses;
    }) as never);
}

async function resolve(): Promise<WhoIsToldResult> {
  return await WhoIsToldService.resolve({
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    refresh: true,
  });
}

function firstEvent(result: WhoIsToldResult): WhoIsToldEvent {
  const item: WhoIsToldResult["criteria"][number] | undefined =
    result.criteria.find((entry: WhoIsToldResult["criteria"][number]) => {
      return entry.events.length > 0;
    });

  return item!.events[0]!;
}

function kinds(result: WhoIsToldResult): Array<WhoIsToldBreakKind> {
  return result.breaks.map((brk: WhoIsToldBreak): WhoIsToldBreakKind => {
    return brk.kind;
  });
}

describe("WhoIsToldService", () => {
  beforeEach(() => {
    world = defaultWorld();
    WhoIsToldService.clearCache();
    stubWorld();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    WhoIsToldService.clearCache();
  });

  test("reads the whole chain of a monitor that goes Offline and opens a Critical incident", async () => {
    const result: WhoIsToldResult = await resolve();

    expect(result.monitorId).toBe(MONITOR_ID.toString());
    expect(result.monitorName).toBe("Checkout API");
    expect(
      result.criteria.map((item: WhoIsToldResult["criteria"][number]) => {
        return [item.name, item.statusName, item.events.length];
      }),
    ).toEqual([
      ["Online", "Operational", 0],
      ["Offline", "Offline", 1],
    ]);

    const event: WhoIsToldEvent = firstEvent(result);

    expect(event.kind).toBe(OnCallTestPageRecordKind.Incident);
    expect(event.severityName).toBe("Critical");
    expect(event.owners).toEqual({
      source: WhoIsToldOwnersSource.ProjectOwners,
      userNames: ["Owner One"],
      teamNames: [],
      hasOwnerRules: false,
    });
    expect(event.rules).toEqual([{ id: RULE, name: "Every incident" }]);
    expect(event.policies).toHaveLength(1);
    expect(event.policies[0]).toMatchObject({
      id: PRIMARY,
      name: "Primary",
      isHidden: false,
      isNamedByCriteria: false,
      ruleIds: [RULE],
      levelCount: 2,
    });
    expect(event.policies[0]!.people).toEqual([
      {
        userId: ANA,
        name: "Ana Lopez",
        channels: [OnCallPageChannel.SMS, OnCallPageChannel.Email],
        isFallback: false,
        isReachable: true,
      },
      {
        userId: BEN,
        name: "Ben Ito",
        reachedThrough: "Schedule Primary",
        channels: [OnCallPageChannel.Push],
        isFallback: true,
        isReachable: true,
      },
    ]);
    // The status page is listed once, though two of its resources show the monitor.
    expect(event.statusPages).toEqual([
      { id: STATUS_PAGE, name: "Public status" },
    ]);
    expect(result.breaks).toEqual([]);
  });

  test("a status change emails the monitor's owners, or the project's when it has none", async () => {
    let result: WhoIsToldResult = await resolve();

    expect(result.criteria[0]!.statusOwners).toEqual({
      source: WhoIsToldOwnersSource.ProjectOwners,
      userNames: ["Owner One"],
      teamNames: [],
      hasOwnerRules: false,
    });

    jest
      .spyOn(MonitorService, "findOwners")
      .mockResolvedValue([user("", "watcher@example.com")] as never);

    result = await resolve();

    expect(result.criteria[0]!.statusOwners).toMatchObject({
      source: WhoIsToldOwnersSource.MonitorOwners,
      userNames: ["watcher@example.com"],
    });
  });

  test("owners the criteria names are emailed instead of the project's, and owner rules are said", async () => {
    world.incidentOwnerRuleCount = 2;
    world.monitorSteps = stepsOf([
      offlineCriteria({
        incidents: [
          {
            id: "t",
            title: "Down",
            description: "",
            incidentSeverityId: new ObjectID(CRITICAL),
            ownerUserIds: [new ObjectID(ANA)],
            ownerTeamIds: [ObjectID.generate()],
          },
        ],
      }),
    ]);

    const event: WhoIsToldEvent = firstEvent(await resolve());

    expect(event.owners).toEqual({
      source: WhoIsToldOwnersSource.Named,
      userNames: ["Named Person"],
      teamNames: ["Platform"],
      hasOwnerRules: true,
    });
  });

  test("no on-call rule matches and the criteria names no policy: nobody is paged", async () => {
    world.incidentRules = [];

    const result: WhoIsToldResult = await resolve();

    expect(firstEvent(result).policies).toEqual([]);
    expect(kinds(result)).toEqual([WhoIsToldBreakKind.NobodyPaged]);
  });

  test("a policy the criteria names is run, and one of another project, or gone, is dropped", async () => {
    world.incidentRules = [];
    world.monitorSteps = stepsOf([
      offlineCriteria({
        incidents: [
          {
            id: "t",
            title: "Down",
            description: "",
            incidentSeverityId: new ObjectID(CRITICAL),
            onCallPolicyIds: [
              new ObjectID(ELSEWHERE_POLICY),
              new ObjectID(PRIMARY),
            ],
          },
        ],
      }),
    ]);

    const event: WhoIsToldEvent = firstEvent(await resolve());

    expect(
      event.policies.map((policy: WhoIsToldEvent["policies"][number]) => {
        return [policy.id, policy.isNamedByCriteria, policy.ruleIds];
      }),
    ).toEqual([[PRIMARY, true, []]]);
  });

  test("a policy both the criteria and a rule run is shown once, with the rule", async () => {
    world.monitorSteps = stepsOf([
      offlineCriteria({
        incidents: [
          {
            id: "t",
            title: "Down",
            description: "",
            incidentSeverityId: new ObjectID(CRITICAL),
            onCallPolicyIds: [new ObjectID(PRIMARY)],
          },
        ],
      }),
    ]);

    const event: WhoIsToldEvent = firstEvent(await resolve());

    expect(event.policies).toHaveLength(1);
    expect(event.policies[0]).toMatchObject({
      id: PRIMARY,
      isNamedByCriteria: true,
      ruleIds: [RULE],
    });
  });

  test("a monitor that opens an alert while only incidents have on-call rules says so", async () => {
    world.monitorSteps = stepsOf([
      criteriaInstance({
        id: "offline",
        name: "Offline",
        createAlerts: true,
        alerts: [
          {
            id: "a",
            title: "Down",
            description: "",
            alertSeverityId: new ObjectID(ALERT_WARNING),
          },
        ],
      }),
    ]);

    const result: WhoIsToldResult = await resolve();
    const event: WhoIsToldEvent = firstEvent(result);

    expect(event.kind).toBe(OnCallTestPageRecordKind.Alert);
    expect(event.severityName).toBe("Warning");
    // An alert is never public.
    expect(event.statusPages).toEqual([]);
    expect(kinds(result)).toEqual([WhoIsToldBreakKind.OnlyIncidentsHaveRules]);
  });

  test("a policy with no escalation rules is the policy's break, and nobody of it is read", async () => {
    world.incidentRules = [rule(RULE, "Every incident", [SECONDARY])];

    const result: WhoIsToldResult = await resolve();

    expect(firstEvent(result).policies[0]).toMatchObject({
      id: SECONDARY,
      levelCount: 0,
      people: [],
    });
    expect(kinds(result)).toEqual([WhoIsToldBreakKind.PolicyHasNoLevels]);
    expect(OnCallTestPageService.getPersonPreview).not.toHaveBeenCalled();
  });

  test("a schedule with nobody on call: the first level reaches nobody, and says why", async () => {
    world.levels[PRIMARY] = {
      targets: [],
      notPaged: ["Nobody is on call in schedule Primary now."],
      levelCount: 1,
    };

    const result: WhoIsToldResult = await resolve();

    expect(firstEvent(result).policies[0]!.notPaged).toEqual([
      "Nobody is on call in schedule Primary now.",
    ]);
    expect(kinds(result)).toEqual([WhoIsToldBreakKind.PolicyReachesNobody]);
  });

  test("a person with no rule for the severity, in a project that doesn't fall back, can't be paged", async () => {
    world.project.disableOnCallNotificationFallback = true;

    const result: WhoIsToldResult = await resolve();
    const ben: WhoIsToldEvent["policies"][number]["people"][number] =
      firstEvent(result).policies[0]!.people[1]!;

    expect(ben).toMatchObject({
      userId: BEN,
      isReachable: false,
      problem: WhoIsToldPersonProblem.NoRuleNoFallback,
    });
    expect(kinds(result)).toEqual([WhoIsToldBreakKind.PersonUnreachable]);
    expect(result.breaks[0]!.userName).toBe("Ben Ito");
  });

  test("SMS switched off for the project, for somebody reached only by SMS, is the switch's break", async () => {
    world.project.enableSmsNotifications = false;
    world.previews[ANA] = preview({
      methods: [
        {
          channel: OnCallPageChannel.SMS,
          notifyAfterMinutes: 0,
          isVerified: true,
          canAcknowledge: true,
        },
      ],
    });

    const result: WhoIsToldResult = await resolve();

    expect(result.channels.isSmsOn).toBe(false);
    expect(kinds(result)).toEqual([WhoIsToldBreakKind.ChannelOff]);
  });

  test("a criteria severity the project does not have falls back to its first that is not archived", async () => {
    world.monitorSteps = stepsOf([
      offlineCriteria({
        incidents: [
          {
            id: "t",
            title: "Down",
            description: "",
            incidentSeverityId: ObjectID.generate(),
          },
        ],
      }),
    ]);

    expect(firstEvent(await resolve()).severityName).toBe("Critical");
  });

  test("a switched-off criteria, and one that does nothing, tell nobody and are left out", async () => {
    world.monitorSteps = stepsOf([
      criteriaInstance({ id: "idle", name: "Idle" }),
      offlineCriteria({ isEnabled: false }),
    ]);

    const result: WhoIsToldResult = await resolve();

    expect(result.criteria).toEqual([]);
    expect(kinds(result)).toEqual([WhoIsToldBreakKind.NothingHappens]);
  });

  test("an incident kept off status pages is not said to be public", async () => {
    world.monitorSteps = stepsOf([
      offlineCriteria({
        incidents: [
          {
            id: "t",
            title: "Down",
            description: "",
            incidentSeverityId: new ObjectID(CRITICAL),
            showIncidentOnStatusPage: false,
          },
        ],
      }),
    ]);

    expect(firstEvent(await resolve()).statusPages).toEqual([]);
  });

  test("the project's channels, and on a self-hosted server what it can send", async () => {
    world.serverStatuses = [
      serverStatus(ServerSendingChannel.Email, ServerSendingState.NotSetUp),
      serverStatus(ServerSendingChannel.SMS, ServerSendingState.Failing),
      serverStatus(ServerSendingChannel.Call, ServerSendingState.Untested),
    ];

    const result: WhoIsToldResult = await resolve();

    expect(result.channels.isBillingEnabled).toBe(IsBillingEnabled);

    if (IsBillingEnabled) {
      // OneUptime Cloud: the balance, and the server is not asked.
      expect(result.channels.balanceInUSDCents).toBe(1000);
      expect(result.channels.serverCanSendEmail).toBeNull();
      expect(kinds(result)).toEqual([]);
      return;
    }

    expect(result.channels.serverCanSendEmail).toBe(false);
    expect(result.channels.serverCanSendSms).toBe(false);
    expect(result.channels.serverCanCall).toBe(true);
    expect(result.breaks).toHaveLength(2);
    expect(
      result.breaks.map((brk: WhoIsToldBreak): unknown => {
        return [brk.kind, brk.channel];
      }),
    ).toEqual([
      [WhoIsToldBreakKind.ServerCannotSend, WhoIsToldServerChannel.Email],
      [WhoIsToldBreakKind.ServerCannotSend, WhoIsToldServerChannel.SMS],
    ]);
  });

  test("a person met through two policies is read once", async () => {
    world.incidentRules = [
      rule(RULE, "Every incident", [PRIMARY]),
      rule(ObjectID.generate().toString(), "Again", [PRIMARY]),
    ];

    await resolve();

    expect(OnCallTestPageService.readFirstLevel).toHaveBeenCalledTimes(1);
    expect(OnCallTestPageService.getPersonPreview).toHaveBeenCalledTimes(2);
    expect(OnCallReadinessService.getReadinessForUsers).toHaveBeenCalledTimes(
      1,
    );
  });

  test("an answer is kept a minute, and a refresh works it out again", async () => {
    const reads: jest.SpiedFunction<typeof MonitorService.findOneBy> =
      MonitorService.findOneBy as unknown as jest.SpiedFunction<
        typeof MonitorService.findOneBy
      >;

    await WhoIsToldService.resolve({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
    });
    await WhoIsToldService.resolve({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
    });

    expect(reads).toHaveBeenCalledTimes(1);

    await WhoIsToldService.resolve({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      refresh: true,
    });

    expect(reads).toHaveBeenCalledTimes(2);
  });

  test("reads only: nothing is created, updated or deleted", async () => {
    const writes: Array<
      jest.SpiedFunction<(...args: Array<never>) => unknown>
    > = [
      jest.spyOn(MonitorService, "updateOneById"),
      jest.spyOn(OnCallDutyPolicyService, "create"),
      jest.spyOn(ProjectService, "updateOneById"),
    ] as unknown as Array<
      jest.SpiedFunction<(...args: Array<never>) => unknown>
    >;

    await resolve();

    for (const write of writes) {
      expect(write).not.toHaveBeenCalled();
    }
  });

  describe("for one caller", () => {
    async function forCaller(): Promise<WhoIsToldResult> {
      return await WhoIsToldService.getForMonitor({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        props: CALLER,
      });
    }

    test("somebody who may read the monitor and its policies is told the whole chain", async () => {
      const result: WhoIsToldResult = await forCaller();

      expect(firstEvent(result).policies[0]!.name).toBe("Primary");
      expect(firstEvent(result).policies[0]!.people).toHaveLength(2);
      expect(firstEvent(result).rules[0]!.name).toBe("Every incident");
    });

    test("somebody who may not read the monitor is told it is not found", async () => {
      world.callerReadsMonitor = false;

      await expect(forCaller()).rejects.toThrow("Monitor not found.");
    });

    test("somebody who may read the monitor but no policy learns paging is set up, and nothing of who", async () => {
      world.callerPolicies = "refused";
      world.callerIncidentRules = "refused";

      const result: WhoIsToldResult = await forCaller();
      const policy: WhoIsToldEvent["policies"][number] =
        firstEvent(result).policies[0]!;

      expect(policy.isHidden).toBe(true);
      expect(policy.name).toBe("");
      expect(policy.people).toEqual([]);
      expect(firstEvent(result).rules).toEqual([{ id: RULE, name: "" }]);
      expect(JSON.stringify(result)).not.toContain("Ana Lopez");
      expect(JSON.stringify(result)).not.toContain("Every incident");
    });

    test("only the policies the caller may not read are hidden", async () => {
      world.incidentRules = [
        rule(RULE, "Every incident", [PRIMARY, SECONDARY]),
      ];
      world.callerPolicies = [SECONDARY];

      const result: WhoIsToldResult = await forCaller();

      expect(
        firstEvent(result).policies.map(
          (policy: WhoIsToldEvent["policies"][number]) => {
            return [policy.id, policy.isHidden];
          },
        ),
      ).toEqual([
        [PRIMARY, true],
        [SECONDARY, false],
      ]);
      // Secondary's own break is still told: the caller may read it.
      expect(kinds(result)).toEqual([WhoIsToldBreakKind.PolicyHasNoLevels]);
      expect(result.breaks[0]!.policyName).toBe("Secondary");
    });

    test("the cached answer is the same for every caller, and each is handed their own view of it", async () => {
      await forCaller();
      world.callerPolicies = "refused";

      const hidden: WhoIsToldResult = await forCaller();

      expect(firstEvent(hidden).policies[0]!.isHidden).toBe(true);

      world.callerPolicies = [PRIMARY];

      const shown: WhoIsToldResult = await forCaller();

      expect(firstEvent(shown).policies[0]!.isHidden).toBe(false);
    });
  });
});

describe("the resolver's pure helpers", () => {
  test("every step's criteria, each once, in the order they are checked", () => {
    const first: MonitorCriteriaInstance = criteriaInstance({
      id: "a",
      name: "A",
    });
    const second: MonitorCriteriaInstance = criteriaInstance({
      id: "b",
      name: "B",
    });

    expect(
      getMonitorCriteriaInstances(stepsOf([first, second], [first])).map(
        (instance: MonitorCriteriaInstance): string => {
          return instance.data!.id;
        },
      ),
    ).toEqual(["a", "b"]);
    expect(getMonitorCriteriaInstances(undefined)).toEqual([]);
    expect(getMonitorCriteriaInstances(stepsOf())).toEqual([]);
  });

  test("the criteria's severity when the project has it, else the first not archived", () => {
    const archived: IncidentSeverity = withId(new IncidentSeverity(), "x");
    archived.isArchived = true;
    const critical: IncidentSeverity = withId(new IncidentSeverity(), CRITICAL);
    const minor: IncidentSeverity = withId(new IncidentSeverity(), MINOR);
    const all: Array<IncidentSeverity> = [archived, critical, minor];

    expect(pickSeverity(all, new ObjectID(MINOR))).toBe(minor);
    expect(pickSeverity(all, ObjectID.generate())).toBe(critical);
    expect(pickSeverity(all, undefined)).toBe(critical);
    expect(pickSeverity(all, new ObjectID(""))).toBe(critical);
    expect(pickSeverity([archived], undefined)).toBeNull();
  });

  test("the server can send by a channel unless it is not set up or failing", () => {
    const statuses: Array<ServerChannelStatus> = [
      serverStatus(ServerSendingChannel.Email, ServerSendingState.Working),
      serverStatus(ServerSendingChannel.SMS, ServerSendingState.NotSetUp),
      serverStatus(ServerSendingChannel.Call, ServerSendingState.Failing),
      serverStatus(ServerSendingChannel.Push, ServerSendingState.Untested),
    ];

    expect(canServerSendBy(statuses, ServerSendingChannel.Email)).toBe(true);
    expect(canServerSendBy(statuses, ServerSendingChannel.SMS)).toBe(false);
    expect(canServerSendBy(statuses, ServerSendingChannel.Call)).toBe(false);
    expect(canServerSendBy(statuses, ServerSendingChannel.Push)).toBe(true);
    expect(canServerSendBy([], ServerSendingChannel.Email)).toBeNull();
  });
});
