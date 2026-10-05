import AlertEpisodeStateTimelineService from "../../../Server/Services/AlertEpisodeStateTimelineService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import IncidentEpisodeStateTimelineService from "../../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import MonitorProbeService from "../../../Server/Services/MonitorProbeService";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import NetworkDeviceLinkService from "../../../Server/Services/NetworkDeviceLinkService";
import NetworkSiteAssignmentRuleService from "../../../Server/Services/NetworkSiteAssignmentRuleService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyScheduleLayerUserService from "../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import ProbeService from "../../../Server/Services/ProbeService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import ServiceLevelObjectiveMonitorRuleService from "../../../Server/Services/ServiceLevelObjectiveMonitorRuleService";
import StatusPageMonitorRuleService from "../../../Server/Services/StatusPageMonitorRuleService";
import StatusPageSubscriberNotificationTemplateStatusPageService from "../../../Server/Services/StatusPageSubscriberNotificationTemplateStatusPageService";
import UserService from "../../../Server/Services/UserService";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import RelationIdUtil from "../../../Server/Utils/Database/RelationIdUtil";
import BadDataException from "../../../Types/Exception/BadDataException";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * Every other service that reads a reference off a write to check it or act
 * on it - a timeline's state, a rule's page or site, a probe attached to a
 * monitor, the people an on-call override swaps, the ends of a network link
 * - reads it under both of its names (RelationIdUtil.readConsistent): the
 * write may use either, the two are one database column, and a write whose
 * two names disagree is refused before the service reads anything. The
 * services' own hooks run here; which records the project has is a stand-in.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-07e5-4aaa-8bbb-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-07e5-4aaa-8bbb-0000000000e1");
const ID_A: string = "0193c0de-07e5-4aaa-8bbb-0000000000a1";
const ID_B: string = "0193c0de-07e5-4aaa-8bbb-0000000000b2";
const PARENT_ID: string = "0193c0de-07e5-4aaa-8bbb-0000000000c3";

interface ConflictCase {
  name: string;
  service: unknown;
  // A create payload valid in every way but the reference under test.
  newRecord: () => Record<string, unknown>;
  idColumn: string;
  relation: string;
  title: string;
  props?: Record<string, unknown> | undefined;
}

function hourFromNow(hours: number): Date {
  return OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), hours);
}

const CONFLICT_CASES: Array<ConflictCase> = [
  {
    name: "an incident state timeline's state",
    service: IncidentStateTimelineService,
    newRecord: () => {
      return { incidentId: PARENT_ID, projectId: PROJECT_ID };
    },
    idColumn: "incidentStateId",
    relation: "incidentState",
    title: "Incident State",
  },
  {
    name: "an alert state timeline's state",
    service: AlertStateTimelineService,
    newRecord: () => {
      return { alertId: PARENT_ID, projectId: PROJECT_ID };
    },
    idColumn: "alertStateId",
    relation: "alertState",
    title: "Alert State",
  },
  {
    name: "an incident episode state timeline's state",
    service: IncidentEpisodeStateTimelineService,
    newRecord: () => {
      return { incidentEpisodeId: PARENT_ID, projectId: PROJECT_ID };
    },
    idColumn: "incidentStateId",
    relation: "incidentState",
    title: "Incident State",
  },
  {
    name: "an alert episode state timeline's state",
    service: AlertEpisodeStateTimelineService,
    newRecord: () => {
      return { alertEpisodeId: PARENT_ID, projectId: PROJECT_ID };
    },
    idColumn: "alertStateId",
    relation: "alertState",
    title: "Alert State",
  },
  {
    name: "a monitor status timeline's status",
    service: MonitorStatusTimelineService,
    newRecord: () => {
      return { monitorId: PARENT_ID, projectId: PROJECT_ID };
    },
    idColumn: "monitorStatusId",
    relation: "monitorStatus",
    title: "Monitor Status",
  },
  {
    name: "a scheduled maintenance state timeline's state",
    service: ScheduledMaintenanceStateTimelineService,
    newRecord: () => {
      return { scheduledMaintenanceId: PARENT_ID, projectId: PROJECT_ID };
    },
    idColumn: "scheduledMaintenanceStateId",
    relation: "scheduledMaintenanceState",
    title: "Scheduled Maintenance State",
  },
  {
    name: "a status page monitor rule's page",
    service: StatusPageMonitorRuleService,
    newRecord: () => {
      return { projectId: PROJECT_ID, monitorNamePattern: ".*" };
    },
    idColumn: "statusPageId",
    relation: "statusPage",
    title: "Status Page",
  },
  {
    name: "a status page monitor rule's group",
    service: StatusPageMonitorRuleService,
    newRecord: () => {
      return {
        projectId: PROJECT_ID,
        statusPageId: new ObjectID(PARENT_ID),
        monitorNamePattern: ".*",
      };
    },
    idColumn: "statusPageGroupId",
    relation: "statusPageGroup",
    title: "Status Page Group",
  },
  {
    name: "an SLO monitor rule's SLO",
    service: ServiceLevelObjectiveMonitorRuleService,
    newRecord: () => {
      return { projectId: PROJECT_ID, monitorNamePattern: ".*" };
    },
    idColumn: "serviceLevelObjectiveId",
    relation: "serviceLevelObjective",
    title: "Service Level Objective",
  },
  {
    name: "a network site assignment rule's site",
    service: NetworkSiteAssignmentRuleService,
    newRecord: () => {
      return { projectId: PROJECT_ID, subnetCidr: "10.0.0.0/24" };
    },
    idColumn: "siteId",
    relation: "site",
    title: "Network Site",
  },
  {
    name: "a monitor probe's probe",
    service: MonitorProbeService,
    newRecord: () => {
      return { projectId: PROJECT_ID, monitorId: new ObjectID(PARENT_ID) };
    },
    idColumn: "probeId",
    relation: "probe",
    title: "Probe",
  },
  {
    name: "a monitor probe's monitor",
    service: MonitorProbeService,
    newRecord: () => {
      return { projectId: PROJECT_ID, probeId: new ObjectID(PARENT_ID) };
    },
    idColumn: "monitorId",
    relation: "monitor",
    title: "Monitor",
  },
  {
    name: "an on-call override's person away",
    service: OnCallDutyPolicyUserOverrideService,
    newRecord: () => {
      return {
        projectId: PROJECT_ID,
        startsAt: hourFromNow(1),
        endsAt: hourFromNow(2),
        routeAlertsToUserId: new ObjectID(PARENT_ID),
      };
    },
    idColumn: "overrideUserId",
    relation: "overrideUser",
    title: "Override User",
  },
  {
    name: "an on-call override's person covering",
    service: OnCallDutyPolicyUserOverrideService,
    newRecord: () => {
      return {
        projectId: PROJECT_ID,
        startsAt: hourFromNow(1),
        endsAt: hourFromNow(2),
        overrideUserId: new ObjectID(PARENT_ID),
      };
    },
    idColumn: "routeAlertsToUserId",
    relation: "routeAlertsToUser",
    title: "Route Alerts To User",
  },
  {
    name: "an on-call layer's person",
    service: OnCallDutyPolicyScheduleLayerUserService,
    newRecord: () => {
      return {
        projectId: PROJECT_ID,
        onCallDutyPolicyScheduleLayerId: new ObjectID(PARENT_ID),
      };
    },
    idColumn: "userId",
    relation: "user",
    title: "User",
  },
  {
    name: "a network link's first end",
    service: NetworkDeviceLinkService,
    newRecord: () => {
      return { projectId: PROJECT_ID, toDeviceId: new ObjectID(PARENT_ID) };
    },
    idColumn: "fromDeviceId",
    relation: "fromDevice",
    title: "From Device",
  },
  {
    name: "a network link's other end",
    service: NetworkDeviceLinkService,
    newRecord: () => {
      return { projectId: PROJECT_ID, fromDeviceId: new ObjectID(PARENT_ID) };
    },
    idColumn: "toDeviceId",
    relation: "toDevice",
    title: "To Device",
  },
  {
    name: "a status page's subscriber notification template",
    service: StatusPageSubscriberNotificationTemplateStatusPageService,
    newRecord: () => {
      return { projectId: PROJECT_ID, statusPageId: new ObjectID(PARENT_ID) };
    },
    idColumn: "statusPageSubscriberNotificationTemplateId",
    relation: "statusPageSubscriberNotificationTemplate",
    title: "Status Page Subscriber Notification Template",
    // A person's link is the one the service checks.
    props: { tenantId: PROJECT_ID, userId: USER_ID },
  },
];

beforeEach(() => {
  stubProjectDirectory({});

  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue("a teammate" as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function onBeforeCreate(
  service: unknown,
  data: Record<string, unknown>,
  props: Record<string, unknown>,
): Promise<unknown> {
  return (
    service as {
      onBeforeCreate: (createBy: unknown) => Promise<unknown>;
    }
  )
    .onBeforeCreate({ data: data, props: props })
    .then(
      () => {
        return "went on";
      },
      (error: unknown) => {
        return error;
      },
    );
}

describe.each(CONFLICT_CASES)("$name", (testCase: ConflictCase) => {
  test("named under its two names, differently, is refused, naming both fields", async () => {
    const outcome: unknown = await onBeforeCreate(
      testCase.service,
      {
        ...testCase.newRecord(),
        [testCase.idColumn]: new ObjectID(ID_A),
        [testCase.relation]: { _id: ID_B },
      },
      testCase.props || { isRoot: true },
    );

    expect(outcome).toBeInstanceOf(BadDataException);
    expect((outcome as Error).message).toBe(
      RelationIdUtil.getConflictMessage(testCase.title, [
        testCase.idColumn,
        testCase.relation,
      ]),
    );
  });

  test("named under its two names, the same, goes on", async () => {
    const outcome: unknown = await onBeforeCreate(
      testCase.service,
      {
        ...testCase.newRecord(),
        [testCase.idColumn]: new ObjectID(ID_A.toUpperCase()),
        [testCase.relation]: { _id: ID_A },
      },
      testCase.props || { isRoot: true },
    );

    // Whatever else the hook goes on to say, it is not about the two names.
    expect((outcome as Error)?.message || "").not.toContain(
      "references were provided",
    );
  });

  test("named under a clear and an id is refused the same way", async () => {
    const outcome: unknown = await onBeforeCreate(
      testCase.service,
      {
        ...testCase.newRecord(),
        [testCase.idColumn]: null,
        [testCase.relation]: { _id: ID_B },
      },
      testCase.props || { isRoot: true },
    );

    expect((outcome as Error)?.message).toBe(
      RelationIdUtil.getConflictMessage(testCase.title, [
        testCase.idColumn,
        testCase.relation,
      ]),
    );
  });
});

describe("a reference named under the relation alone is the one the service acts on", () => {
  test("a timeline's state is the one the service checks", async () => {
    const validate: jest.SpyInstance = jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentStateTimelineService, "findOneBy")
      .mockResolvedValue(null as never);

    await onBeforeCreate(
      IncidentStateTimelineService,
      {
        incidentId: PARENT_ID,
        projectId: PROJECT_ID,
        incidentState: { _id: ID_A },
      },
      { isRoot: true },
    );

    // The service's own check names the state alone.
    const ownCheck: { references: Array<{ modelName: string; id: unknown }> } =
      validate.mock.calls
        .map((call: Array<unknown>) => {
          return call[0] as {
            references: Array<{ modelName: string; id: unknown }>;
          };
        })
        .find(
          (data: {
            references: Array<{ modelName: string; id: unknown }>;
          }): boolean => {
            return (
              data.references.length === 1 &&
              data.references[0]!.modelName === "Incident State"
            );
          },
        )!;

    expect(String(ownCheck.references[0]!.id)).toBe(ID_A);
  });

  test("a monitor probe's probe is the one checked as attachable to the project", async () => {
    const attachable: jest.SpyInstance = jest
      .spyOn(ProbeService, "isProbeAttachableToProject")
      .mockResolvedValue(false as never);
    jest
      .spyOn(MonitorProbeService, "findOneBy")
      .mockResolvedValue(null as never);

    const outcome: unknown = await onBeforeCreate(
      MonitorProbeService,
      {
        projectId: PROJECT_ID,
        monitorId: new ObjectID(PARENT_ID),
        probe: { _id: ID_A },
      },
      { tenantId: PROJECT_ID },
    );

    expect(String(attachable.mock.calls[0]![0].probeId)).toBe(ID_A);
    expect((outcome as Error).message).toBe(
      "Probe not found or it does not belong to this project.",
    );
  });

  test("a status page monitor rule's page satisfies the page it requires", async () => {
    const validate: jest.SpyInstance = jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockRejectedValue(new Error("past the check") as never);

    const outcome: unknown = await onBeforeCreate(
      StatusPageMonitorRuleService,
      {
        projectId: PROJECT_ID,
        monitorNamePattern: ".*",
        statusPage: { _id: ID_A },
      },
      { tenantId: PROJECT_ID },
    );

    expect((outcome as Error).message).toBe("past the check");

    const references: Array<{ modelName: string; id: unknown }> = (
      validate.mock.calls[validate.mock.calls.length - 1]![0] as {
        references: Array<{ modelName: string; id: unknown }>;
      }
    ).references;

    expect(
      String(
        references.find((reference: { modelName: string }): boolean => {
          return reference.modelName === "Status Page";
        })!.id,
      ),
    ).toBe(ID_A);
  });
});

describe("an on-call policy execution is triggered by the person making the request", () => {
  test("a triggeredByUser relation sent beside the stamp is not stored over it", async () => {
    const data: Record<string, unknown> = {
      projectId: PROJECT_ID,
      onCallDutyPolicyId: new ObjectID(PARENT_ID),
      triggeredByUser: { _id: ID_B },
    };

    await onBeforeCreate(OnCallDutyPolicyExecutionLogService, data, {
      tenantId: PROJECT_ID,
      userId: USER_ID,
    });

    expect(String(data["triggeredByUserId"])).toBe(USER_ID.toString());
    expect(Object.prototype.hasOwnProperty.call(data, "triggeredByUser")).toBe(
      false,
    );
  });
});
