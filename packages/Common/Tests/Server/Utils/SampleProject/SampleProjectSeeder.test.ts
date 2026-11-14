jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import DashboardService from "../../../../Server/Services/DashboardService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentInternalNoteService from "../../../../Server/Services/IncidentInternalNoteService";
import IncidentPostmortemStatusService from "../../../../Server/Services/IncidentPostmortemStatusService";
import IncidentPublicNoteService from "../../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import MetricTypeService from "../../../../Server/Services/MetricTypeService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyScheduleLayerService from "../../../../Server/Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService from "../../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import OpenTelemetryIngestService, {
  TelemetryServiceMetadata,
} from "../../../../Server/Services/OpenTelemetryIngestService";
import ProjectService from "../../../../Server/Services/ProjectService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../../Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "../../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import ServiceLevelObjectiveService from "../../../../Server/Services/ServiceLevelObjectiveService";
import ServiceService from "../../../../Server/Services/ServiceService";
import StatusPageGroupService from "../../../../Server/Services/StatusPageGroupService";
import StatusPageResourceService from "../../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import TeamService from "../../../../Server/Services/TeamService";
import UserOnCallLogService from "../../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../../Server/Services/UserOnCallLogTimelineService";
import UserService from "../../../../Server/Services/UserService";
import SampleProjectSeeder, {
  SampleProjectSeedResult,
} from "../../../../Server/Utils/SampleProject/SampleProjectSeeder";
import SampleProjectTelemetry from "../../../../Server/Utils/SampleProject/SampleProjectTelemetry";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import ObjectID from "../../../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  SAMPLE_PEOPLE,
  isSamplePersonEmail,
} from "../../../../Types/SampleProject/SampleProject";
import {
  MINUTES_IN_A_DAY,
  SAMPLE_ALERTS,
  SAMPLE_INCIDENTS,
  SAMPLE_MONITOR_HISTORY_DAYS,
  SAMPLE_MONITORS,
  SampleAlertState,
  SampleIncidentState,
  SampleMonitor,
} from "../../../../Types/SampleProject/SampleProjectContent";
import StatusPageSubscriberNotificationStatus from "../../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import UserNotificationExecutionStatus from "../../../../Types/UserNotification/UserNotificationExecutionStatus";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * FILLING A SAMPLE PROJECT (issue #6808), with every service stubbed.
 *
 * What matters most is what it never does: every record is written as
 * OneUptime WITHOUT HOOKS - so nothing pages, emails, posts, counts or bills
 * as a real record would - and every "notified" flag says done, so no job
 * picks one up later. Then what it makes: people who can never sign in,
 * ten monitors with thirty days, three incidents with their run, a private
 * status page, a maintenance window, the service with its telemetry, an SLO
 * and a dashboard.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5a3c0000-0000-4000-8000-0000000000a1",
);
const OWNER_ID: ObjectID = new ObjectID("5a3c0000-0000-4000-8000-0000000000b1");
const NOW: Date = new Date("2026-11-12T12:00:00.000Z");

const id: (name: string) => ObjectID = (name: string): ObjectID => {
  const hex: string = Buffer.from(name)
    .toString("hex")
    .padEnd(12, "0")
    .slice(0, 12);
  return new ObjectID(`5a3c0000-0000-4000-8000-${hex}`);
};

interface CreateCall {
  service: string;
  data: Record<string, unknown>;
  props: Record<string, unknown>;
}

const SERVICES: Record<string, unknown> = {
  AlertFeedService,
  AlertService,
  AlertStateTimelineService,
  DashboardService,
  IncidentFeedService,
  IncidentInternalNoteService,
  IncidentPublicNoteService,
  IncidentService,
  IncidentStateTimelineService,
  MetricTypeService,
  MonitorService,
  MonitorStatusTimelineService,
  OnCallDutyPolicyEscalationRuleScheduleService,
  OnCallDutyPolicyEscalationRuleService,
  OnCallDutyPolicyEscalationRuleUserService,
  OnCallDutyPolicyExecutionLogService,
  OnCallDutyPolicyExecutionLogTimelineService,
  OnCallDutyPolicyScheduleLayerService,
  OnCallDutyPolicyScheduleLayerUserService,
  OnCallDutyPolicyScheduleService,
  OnCallDutyPolicyService,
  ScheduledMaintenanceService,
  ScheduledMaintenanceStateTimelineService,
  ServiceLevelObjectiveService,
  StatusPageGroupService,
  StatusPageResourceService,
  StatusPageService,
  TeamMemberService,
  UserOnCallLogService,
  UserOnCallLogTimelineService,
  UserService,
};

let creates: Array<CreateCall>;
let backdates: Array<{ id: string; createdAt: Date }>;
let written: jest.SpyInstance;
let result: SampleProjectSeedResult;

const rowsOf: (service: string) => Array<Record<string, unknown>> = (
  service: string,
): Array<Record<string, unknown>> => {
  return creates
    .filter((call: CreateCall) => {
      return call.service === service;
    })
    .map((call: CreateCall) => {
      return call.data;
    });
};

const named: (
  rows: Array<{ name: string; id: ObjectID; [key: string]: unknown }>,
) => Array<unknown> = (
  rows: Array<{ name: string; id: ObjectID; [key: string]: unknown }>,
): Array<unknown> => {
  return rows.map(
    (row: { name: string; id: ObjectID; [key: string]: unknown }) => {
      return { ...row, _id: row.id.toString() };
    },
  );
};

// The flags that say whether a record's owners and subscribers were told.
const OWNER_NOTIFIED_KEY: RegExp = /^isOwnerNotified/;
const SUBSCRIBERS_TOLD_KEY: RegExp =
  /^shouldStatusPageSubscribersBeNotified|^notifySubscribers/;
const SUBSCRIBER_STATUS_KEY: RegExp =
  /^subscriberNotificationStatus(On[A-Za-z]+)?$/;

type CreateBy = {
  data: Record<string, unknown>;
  props: Record<string, unknown>;
};

type BackdateInput = {
  id: ObjectID;
  data: { createdAt?: Date };
};

beforeEach(async () => {
  creates = [];
  backdates = [];
  let counter: number = 0;

  /*
   * Each service's create, recorded under its name and answered with an id
   * of its own, and the write that back-dates a row: made here, outside the
   * loop over the services that installs them.
   */
  const createAs: (
    name: string,
  ) => (createBy: CreateBy) => Promise<{ id: ObjectID }> = (
    name: string,
  ): ((createBy: CreateBy) => Promise<{ id: ObjectID }>) => {
    return async (createBy: CreateBy): Promise<{ id: ObjectID }> => {
      creates.push({
        service: name,
        data: createBy.data,
        props: createBy.props,
      });
      counter++;
      return {
        id: new ObjectID(
          `5a3c0000-0000-4000-9000-${String(counter).padStart(12, "0")}`,
        ),
      };
    };
  };

  const backdate: (input: BackdateInput) => Promise<void> = async (
    input: BackdateInput,
  ): Promise<void> => {
    if (input.data.createdAt) {
      backdates.push({
        id: input.id.toString(),
        createdAt: input.data.createdAt,
      });
    }
  };

  for (const [name, service] of Object.entries(SERVICES)) {
    jest
      .spyOn(service as { create: () => Promise<unknown> }, "create")
      .mockImplementation(createAs(name) as never);

    jest
      .spyOn(
        service as { updateColumnsByIdWithoutHooks: () => Promise<void> },
        "updateColumnsByIdWithoutHooks",
      )
      .mockImplementation(backdate as never);
  }

  jest
    .spyOn(ServiceService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);

  jest.spyOn(MonitorStatusService, "findBy").mockResolvedValue(
    named([
      { name: "Operational", id: id("op"), isOperationalState: true },
      { name: "Degraded", id: id("dg") },
      { name: "Offline", id: id("of"), isOfflineState: true },
    ]) as never,
  );
  jest.spyOn(IncidentStateService, "findBy").mockResolvedValue(
    named([
      { name: "Identified", id: id("is1"), isCreatedState: true },
      { name: "Acknowledged", id: id("is2"), isAcknowledgedState: true },
      { name: "Resolved", id: id("is3"), isResolvedState: true },
    ]) as never,
  );
  jest.spyOn(IncidentSeverityService, "findBy").mockResolvedValue(
    named([
      { name: "Critical Incident", id: id("sv1") },
      { name: "Major Incident", id: id("sv2") },
      { name: "Minor Incident", id: id("sv3") },
    ]) as never,
  );
  jest.spyOn(AlertStateService, "findBy").mockResolvedValue(
    named([
      { name: "Identified", id: id("as1"), isCreatedState: true },
      { name: "Acknowledged", id: id("as2"), isAcknowledgedState: true },
      { name: "Resolved", id: id("as3"), isResolvedState: true },
    ]) as never,
  );
  jest.spyOn(AlertSeverityService, "findBy").mockResolvedValue(
    named([
      { name: "High", id: id("al1") },
      { name: "Low", id: id("al2") },
    ]) as never,
  );
  jest
    .spyOn(ScheduledMaintenanceStateService, "findBy")
    .mockResolvedValue(
      named([
        { name: "Scheduled", id: id("sm1"), isScheduledState: true },
      ]) as never,
    );
  jest.spyOn(IncidentPostmortemStatusService, "findBy").mockResolvedValue(
    named([
      { name: "Not Started", id: id("pm1"), isNotStartedStatus: true },
      { name: "Completed", id: id("pm2"), isCompletedStatus: true },
    ]) as never,
  );
  jest.spyOn(TeamService, "findBy").mockResolvedValue(
    named([
      { name: "Owners", id: id("tm1") },
      { name: "Members", id: id("tm2") },
    ]) as never,
  );

  let incidentNumber: number = 0;
  jest
    .spyOn(ProjectService, "incrementAndGetIncidentCounter")
    .mockImplementation(async () => {
      return { counter: ++incidentNumber, prefix: "INC-" };
    });
  jest
    .spyOn(ProjectService, "incrementAndGetAlertCounter")
    .mockResolvedValue({ counter: 1, prefix: "ALT-" });
  jest
    .spyOn(ProjectService, "incrementAndGetScheduledMaintenanceCounter")
    .mockResolvedValue({ counter: 1, prefix: "SM-" });

  jest
    .spyOn(OpenTelemetryIngestService, "telemetryServiceFromName")
    .mockResolvedValue({
      serviceName: "checkout-api",
      primaryEntityId: id("svc"),
      primaryEntityType: ServiceType.OpenTelemetry,
      entityKeys: ["service-key"],
    } as TelemetryServiceMetadata);

  written = jest
    .spyOn(SampleProjectTelemetry, "write")
    .mockResolvedValue(undefined);

  result = await SampleProjectSeeder.seed({
    projectId: PROJECT_ID,
    ownerUserId: OWNER_ID,
    now: NOW,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("it never does what a real record does", () => {
  test("every record is written as OneUptime, without hooks", () => {
    expect(creates.length).toBeGreaterThan(80);

    for (const call of creates) {
      expect({ service: call.service, props: call.props }).toEqual({
        service: call.service,
        props: { isRoot: true, ignoreHooks: true },
      });
    }
  });

  test("every record is the sample's", () => {
    for (const call of creates) {
      if (call.service === "UserService") {
        continue;
      }

      expect({
        service: call.service,
        projectId: call.data["projectId"],
      }).toEqual({ service: call.service, projectId: PROJECT_ID });
    }
  });

  test("every 'notified' flag says done, and no subscriber is ever told", () => {
    for (const call of creates) {
      for (const [key, value] of Object.entries(call.data)) {
        if (OWNER_NOTIFIED_KEY.test(key)) {
          expect({ service: call.service, key, value }).toEqual({
            service: call.service,
            key,
            value: true,
          });
        }

        if (SUBSCRIBERS_TOLD_KEY.test(key)) {
          expect({ service: call.service, key, value }).toEqual({
            service: call.service,
            key,
            value: false,
          });
        }

        if (SUBSCRIBER_STATUS_KEY.test(key) && value !== undefined) {
          expect({ service: call.service, key, value }).toEqual({
            service: call.service,
            key,
            value: StatusPageSubscriberNotificationStatus.Skipped,
          });
        }
      }
    }

    // A new incident and a new event tell no subscriber.
    for (const incident of rowsOf("IncidentService")) {
      expect(incident["subscriberNotificationStatusOnIncidentCreated"]).toBe(
        StatusPageSubscriberNotificationStatus.Skipped,
      );
      expect(
        incident["shouldStatusPageSubscribersBeNotifiedOnIncidentCreated"],
      ).toBe(false);
    }

    for (const maintenance of rowsOf("ScheduledMaintenanceService")) {
      expect(maintenance["subscriberNotificationStatusOnEventScheduled"]).toBe(
        StatusPageSubscriberNotificationStatus.Skipped,
      );
    }

    // The records a job would notify for carry the flags at all.
    for (const service of [
      "MonitorService",
      "IncidentService",
      "AlertService",
      "IncidentStateTimelineService",
      "ScheduledMaintenanceService",
      "StatusPageService",
    ]) {
      for (const row of rowsOf(service)) {
        expect(
          Object.keys(row).some((key: string) => {
            return OWNER_NOTIFIED_KEY.test(key);
          }),
        ).toBe(true);
      }
    }
  });

  test("the on-call run is finished, so no job carries it on", () => {
    const [executionLog] = rowsOf(
      "OnCallDutyPolicyExecutionLogService",
    ) as unknown as Array<OnCallDutyPolicyExecutionLog>;
    const [userLog] = rowsOf(
      "UserOnCallLogService",
    ) as unknown as Array<UserOnCallLog>;

    expect(executionLog!.status).toBe(OnCallDutyPolicyStatus.Completed);
    expect(executionLog!.acknowledgedAt).toBeInstanceOf(Date);
    expect(userLog!.status).toBe(UserNotificationExecutionStatus.Completed);
  });

  test("the telemetry is written once", () => {
    expect(written).toHaveBeenCalledTimes(1);
    expect(result.telemetryRowCount).toBeGreaterThan(1000);
  });
});

describe("the sample people can never sign in or be reached", () => {
  const users: Array<User> = [];

  beforeEach(() => {
    users.splice(
      0,
      users.length,
      ...(rowsOf("UserService") as unknown as Array<User>),
    );
  });

  test("one for each sample person, blocked, unverified, with no password, at the reserved domain", () => {
    expect(users).toHaveLength(SAMPLE_PEOPLE.length);

    for (const user of users) {
      expect(user.isBlocked).toBe(true);
      expect(user.isEmailVerified).toBe(false);
      expect(user.isMasterAdmin).toBe(false);
      expect(user.password).toBeUndefined();
      expect(isSamplePersonEmail(user.email)).toBe(true);
      expect(user.sampleProjectId).toEqual(PROJECT_ID);
    }

    expect(
      users.map((user: User) => {
        return user.name?.toString();
      }),
    ).toEqual(
      SAMPLE_PEOPLE.map((person: { name: string }) => {
        return person.name;
      }),
    );
  });

  test("members of the sample alone, of its Members team, without an invitation", () => {
    const members: Array<TeamMember> = rowsOf(
      "TeamMemberService",
    ) as unknown as Array<TeamMember>;

    expect(members).toHaveLength(SAMPLE_PEOPLE.length);

    for (const member of members) {
      expect(member.hasAcceptedInvitation).toBe(true);
      expect(member.teamId).toEqual(id("tm2"));
      expect(member.projectId).toEqual(PROJECT_ID);
    }

    expect(result.personIds).toHaveLength(SAMPLE_PEOPLE.length);
  });
});

describe("what it makes", () => {
  test("the monitors, the Degraded one Degraded, every one with criteria", () => {
    const monitors: Array<Monitor> = rowsOf(
      "MonitorService",
    ) as unknown as Array<Monitor>;

    expect(monitors).toHaveLength(SAMPLE_MONITORS.length);

    SAMPLE_MONITORS.forEach((sample: SampleMonitor, index: number) => {
      const isDegraded: boolean = sample.outages.some(
        (outage: { endsMinutesAgo: number | null }) => {
          return outage.endsMinutesAgo === null;
        },
      );

      expect(monitors[index]!.name).toBe(sample.name);
      expect(monitors[index]!.currentMonitorStatusId).toEqual(
        isDegraded ? id("dg") : id("op"),
      );
      expect(monitors[index]!.monitorSteps).toBeTruthy();
    });
  });

  test("thirty days of history for every monitor, from its creation, with no gap", () => {
    const timelines: Array<MonitorStatusTimeline> = rowsOf(
      "MonitorStatusTimelineService",
    ) as unknown as Array<MonitorStatusTimeline>;
    const historyStart: number =
      NOW.getTime() - SAMPLE_MONITOR_HISTORY_DAYS * MINUTES_IN_A_DAY * 60_000;

    const byMonitor: Map<string, Array<MonitorStatusTimeline>> = new Map();

    for (const timeline of timelines) {
      const key: string = timeline.monitorId!.toString();
      byMonitor.set(key, [...(byMonitor.get(key) || []), timeline]);
    }

    expect(byMonitor.size).toBe(SAMPLE_MONITORS.length);

    for (const periods of byMonitor.values()) {
      expect(periods[0]!.startsAt!.getTime()).toBe(historyStart);
      expect(periods[periods.length - 1]!.endsAt).toBeUndefined();

      for (let index: number = 1; index < periods.length; index++) {
        expect(periods[index]!.startsAt!.getTime()).toBe(
          periods[index - 1]!.endsAt!.getTime(),
        );
      }
    }

    // A monitor's own row reads as made thirty days ago.
    expect(
      backdates.some((backdate: { createdAt: Date }) => {
        return backdate.createdAt.getTime() === historyStart;
      }),
    ).toBe(true);
  });

  test("three incidents, numbered as the project numbers them, the open one paged", () => {
    const incidents: Array<Incident> = rowsOf(
      "IncidentService",
    ) as unknown as Array<Incident>;

    expect(incidents).toHaveLength(SAMPLE_INCIDENTS.length);
    expect(
      incidents.map((incident: Incident) => {
        return incident.incidentNumberWithPrefix;
      }),
    ).toEqual(["INC-1", "INC-2", "INC-3"]);

    const paged: Array<Incident> = incidents.filter((incident: Incident) => {
      return (incident.onCallDutyPolicies || []).length > 0;
    });

    expect(paged).toHaveLength(1);
    expect(paged[0]!.title).toBe(
      SAMPLE_INCIDENTS.find((incident: { isPagedByOnCall: boolean }) => {
        return incident.isPagedByOnCall;
      })!.title,
    );
    expect(
      incidents.filter((incident: Incident) => {
        return Boolean(incident.postmortemNote);
      }),
    ).toHaveLength(1);
  });

  test("a feed and notes for each incident, posted when they happened", () => {
    expect(rowsOf("IncidentFeedService").length).toBeGreaterThanOrEqual(10);
    expect(rowsOf("IncidentInternalNoteService").length).toBeGreaterThanOrEqual(
      3,
    );
    expect(rowsOf("IncidentPublicNoteService").length).toBeGreaterThanOrEqual(
      3,
    );

    for (const feed of rowsOf("IncidentFeedService")) {
      expect((feed["postedAt"] as Date).getTime()).toBeLessThanOrEqual(
        NOW.getTime(),
      );
    }
  });

  test("the on-call policy: two levels, a weekly rotation of three", () => {
    expect(rowsOf("OnCallDutyPolicyService")).toHaveLength(1);
    expect(rowsOf("OnCallDutyPolicyEscalationRuleService")).toHaveLength(2);
    expect(rowsOf("OnCallDutyPolicyScheduleLayerUserService")).toHaveLength(3);
    expect(rowsOf("OnCallDutyPolicyEscalationRuleUserService")).toHaveLength(1);
    expect(
      rowsOf("OnCallDutyPolicyEscalationRuleScheduleService"),
    ).toHaveLength(1);
  });

  test("a private status page, kept out of search results", () => {
    const [statusPage] = rowsOf(
      "StatusPageService",
    ) as unknown as Array<StatusPage>;

    expect(statusPage!.isPublicStatusPage).toBe(false);
    expect(statusPage!.enableSearchEngineIndexing).toBe(false);
    expect(rowsOf("StatusPageResourceService").length).toBeGreaterThanOrEqual(
      3,
    );
  });

  /*
   * Each record ends in the project's own state for it: THE acknowledged
   * and THE resolved state, picked as Acknowledge and Resolve pick them,
   * and THE scheduled state a new maintenance event is created in.
   */
  test("each incident, alert and maintenance event ends in the project's own state for it", () => {
    const incidentStateIdOf: Record<SampleIncidentState, string> = {
      [SampleIncidentState.Identified]: id("is1").toString(),
      [SampleIncidentState.Acknowledged]: id("is2").toString(),
      [SampleIncidentState.Resolved]: id("is3").toString(),
    };
    const alertStateIdOf: Record<SampleAlertState, string> = {
      [SampleAlertState.Identified]: id("as1").toString(),
      [SampleAlertState.Acknowledged]: id("as2").toString(),
      [SampleAlertState.Resolved]: id("as3").toString(),
    };

    expect(
      rowsOf("IncidentService").map((row: Record<string, unknown>) => {
        return String(row["currentIncidentStateId"]);
      }),
    ).toEqual(
      SAMPLE_INCIDENTS.map((sample: (typeof SAMPLE_INCIDENTS)[number]) => {
        return incidentStateIdOf[
          sample.states[sample.states.length - 1]!.state
        ];
      }),
    );
    expect(
      rowsOf("AlertService").map((row: Record<string, unknown>) => {
        return String(row["currentAlertStateId"]);
      }),
    ).toEqual(
      SAMPLE_ALERTS.map((sample: (typeof SAMPLE_ALERTS)[number]) => {
        return alertStateIdOf[sample.states[sample.states.length - 1]!.state];
      }),
    );

    const maintenance: Array<Record<string, unknown>> = rowsOf(
      "ScheduledMaintenanceService",
    );

    expect(maintenance.length).toBeGreaterThan(0);

    for (const row of maintenance) {
      expect(String(row["currentScheduledMaintenanceStateId"])).toBe(
        id("sm1").toString(),
      );
    }
  });

  test("a maintenance window to come", () => {
    const [maintenance] = rowsOf(
      "ScheduledMaintenanceService",
    ) as unknown as Array<ScheduledMaintenance>;

    expect(maintenance!.startsAt!.getTime()).toBeGreaterThan(NOW.getTime());
    expect(maintenance!.endsAt!.getTime()).toBeGreaterThan(
      maintenance!.startsAt!.getTime(),
    );
  });

  test("the service's metrics, an SLO and a dashboard", () => {
    expect(rowsOf("MetricTypeService").length).toBeGreaterThanOrEqual(5);
    expect(rowsOf("ServiceLevelObjectiveService")).toHaveLength(1);
    expect(rowsOf("DashboardService")).toHaveLength(1);
    expect(rowsOf("DashboardService")[0]!["dashboardViewConfig"]).toBeTruthy();
    expect(result.serviceId).toEqual(id("svc"));
  });
});

describe("its pieces", () => {
  test("a monitor's history is Operational but for its outages", () => {
    const checkout: SampleMonitor = SAMPLE_MONITORS.find(
      (monitor: SampleMonitor) => {
        return monitor.key === "checkout";
      },
    )!;

    const periods: Array<{ status: string; endsAt: Date | null }> =
      SampleProjectSeeder.getStatusPeriods({ sample: checkout, now: NOW });

    expect(
      periods.map((period: { status: string }) => {
        return period.status;
      }),
    ).toEqual(["Operational", "Offline", "Operational", "Degraded"]);
    expect(periods[periods.length - 1]!.endsAt).toBeNull();
  });

  test("a monitor with no outage is one Operational stretch", () => {
    const storefront: SampleMonitor = SAMPLE_MONITORS.find(
      (monitor: SampleMonitor) => {
        return monitor.outages.length === 0;
      },
    )!;

    expect(
      SampleProjectSeeder.getStatusPeriods({ sample: storefront, now: NOW }),
    ).toHaveLength(1);
  });
});
