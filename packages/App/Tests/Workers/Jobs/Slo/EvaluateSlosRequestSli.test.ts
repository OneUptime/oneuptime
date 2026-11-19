// Pinned before any import, as in EvaluateSlos.test.ts: these tests raise alerts.
process.env["DISABLE_AUTOMATIC_ALERT_CREATION"] = "false";

import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import Service from "Common/Models/DatabaseModels/Service";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import OneUptimeDate, { Moment } from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import SliType from "Common/Types/ServiceLevelObjective/SliType";
import SloMetricType from "Common/Types/ServiceLevelObjective/SloMetricType";
import SloStatus from "Common/Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import FeedMarkdown from "Common/Utils/Markdown/FeedMarkdown";
import { DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE } from "Common/Utils/Slo/SloBurnRateTemplate";
import {
  SLO_REQUEST_STEP_MILLISECONDS,
  SloRequestCounts,
} from "Common/Utils/Slo/SloRequestSli";

/*
 * The SLO evaluation worker on a REQUEST SLI - Request Success and Request
 * Latency - end to end through the captured cron handler, as
 * EvaluateSlos.test.ts drives a Monitor Uptime SLO.
 *
 * How the requests are counted (the spans, SloHistory, the plan) is
 * SloRequestCounting's, pinned in its own suite; here it is mocked, and these
 * tests pin what the worker asks it for and does with the counts: the
 * guards, the state it writes (numbers in requests, never seconds), the
 * cursors it keeps, how every surface words a budget of requests, and how
 * burn rate rules read their windows - a full long window of counts, and a
 * rule's Minimum Sample Count.
 */

type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ServiceLevelObjectiveService", () => {
  return {
    __esModule: true,
    default: {
      getDueSlos: jest.fn(),
      updateOneById: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
      resolveOpenBurnRateAlertsAndIncidentsForSlo: jest.fn(),
      findOwners: jest.fn(),
      getSloLinkInDashboard: jest.fn(),
      findOneById: jest.fn(),
      getSloMarkdownLink: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ServiceLevelObjectiveFeedService", () => {
  return {
    __esModule: true,
    default: { createServiceLevelObjectiveFeedItem: jest.fn() },
  };
});

jest.mock(
  "Common/Server/Services/ServiceLevelObjectiveBurnRateRuleService",
  () => {
    return {
      __esModule: true,
      default: {
        findBy: jest.fn(),
        updateOneById: jest.fn(),
        resolveOpenAlertsForRule: jest.fn(),
        resolveOpenIncidentsForRule: jest.fn(),
        resolveOpenAlertsAndIncidentsForRule: jest.fn(),
        getBurnRateFingerprint: jest.fn(),
      },
    };
  },
);

jest.mock(
  "Common/Server/Services/ServiceLevelObjectiveErrorBudgetPolicyTierService",
  () => {
    return {
      __esModule: true,
      default: {
        findBy: jest.fn(),
        updateOneById: jest.fn(),
        resolveOpenAlertsForTier: jest.fn(),
        resolveOpenIncidentsForTier: jest.fn(),
        getPolicyTierFingerprint: jest.fn(),
      },
    };
  },
);

jest.mock("Common/Server/Services/MonitorStatusTimelineService", () => {
  return { __esModule: true, default: { findAllBy: jest.fn() } };
});

jest.mock("Common/Server/Services/MonitorStatusService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

/*
 * Whether the upgrade has put Monitor.firstMeasuredAt right for history,
 * which a Monitor Uptime SLO's timelines are read after (issue #9031): not
 * yet, so its monitors count from the start. A request SLI reads no monitor.
 */
jest.mock("Common/Server/Services/DataMigrationService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(async () => {
        return null;
      }),
    },
  };
});

jest.mock("Common/Server/Services/SloHistoryService", () => {
  return { __esModule: true, default: { insertHistoryRows: jest.fn() } };
});

// The counting itself: SloRequestCounting.test.ts pins it.
jest.mock("Common/Server/Utils/Slo/SloRequestCounting", () => {
  return { __esModule: true, default: { measure: jest.fn() } };
});

jest.mock("Common/Server/Utils/Slo/SloMetricUtil", () => {
  return {
    __esModule: true,
    default: { saveSloMetrics: jest.fn(), saveSloGuardMetrics: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Slo/SloWorkspaceNotifications", () => {
  return {
    __esModule: true,
    default: {
      postPolicyChange: jest.fn(),
      // A request SLO's status reaches the channels as a monitor SLO's does (#6596).
      postStatusChange: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/AlertService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      create: jest.fn(),
      addOwners: jest.fn(),
      getAlertLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/AlertSeverityService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock("Common/Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      create: jest.fn(),
      addOwners: jest.fn(),
      getIncidentLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentSeverityService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock("Common/Server/Services/IncidentStateService", () => {
  return {
    __esModule: true,
    default: {
      getUnresolvedIncidentStateIds: jest.fn(async () => {
        return ["incident-state-open"];
      }),
    },
  };
});

jest.mock("Common/Server/Services/AlertStateService", () => {
  return {
    __esModule: true,
    default: {
      getUnresolvedAlertStateIds: jest.fn(async () => {
        return ["alert-state-open"];
      }),
    },
  };
});

jest.mock("Common/Server/Services/AlertOwnerUserService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/AlertOwnerTeamService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/IncidentOwnerUserService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/IncidentOwnerTeamService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return { __esModule: true, default: { getUsersInTeams: jest.fn() } };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { getOwners: jest.fn(), findOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/ScheduledMaintenanceService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/ScheduledMaintenanceStateService", () => {
  return {
    __esModule: true,
    default: { getInProgressScheduledMaintenanceStateIds: jest.fn() },
  };
});

jest.mock("Common/Server/Services/OnCallDutyPolicyService", () => {
  return { __esModule: true, default: { name: "OnCallDutyPolicyService" } };
});

jest.mock("Common/Server/Services/LabelService", () => {
  return { __esModule: true, default: { name: "LabelService" } };
});

jest.mock("Common/Server/Services/UserNotificationSettingService", () => {
  return {
    __esModule: true,
    default: {
      ensureSettingExistsForUser: jest.fn(),
      sendUserNotification: jest.fn(),
    },
  };
});

import Semaphore, {
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import AlertService from "Common/Server/Services/AlertService";
import AlertOwnerTeamService from "Common/Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "Common/Server/Services/AlertOwnerUserService";
import IncidentOwnerTeamService from "Common/Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "Common/Server/Services/IncidentOwnerUserService";
import IncidentService from "Common/Server/Services/IncidentService";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "Common/Server/Services/MonitorStatusTimelineService";
import ProjectService from "Common/Server/Services/ProjectService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "Common/Server/Services/ScheduledMaintenanceStateService";
import ServiceLevelObjectiveBurnRateRuleService from "Common/Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import ServiceLevelObjectiveErrorBudgetPolicyTierService from "Common/Server/Services/ServiceLevelObjectiveErrorBudgetPolicyTierService";
import ServiceLevelObjectiveFeedService from "Common/Server/Services/ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveService from "Common/Server/Services/ServiceLevelObjectiveService";
import SloHistoryService from "Common/Server/Services/SloHistoryService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import ProjectScopedReferenceValidator from "Common/Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "Common/Server/Utils/Logger";
import SloMetricUtil from "Common/Server/Utils/Slo/SloMetricUtil";
import SloRequestCounting, {
  SloRequestMeasurement,
} from "Common/Server/Utils/Slo/SloRequestCounting";
import SloWorkspaceNotifications from "Common/Server/Utils/Slo/SloWorkspaceNotifications";
import User from "Common/Models/DatabaseModels/User";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/Slo/EvaluateSlos";

type Mocked = jest.Mock;

const sloService: Record<string, Mocked> =
  ServiceLevelObjectiveService as unknown as Record<string, Mocked>;
const burnRuleService: Record<string, Mocked> =
  ServiceLevelObjectiveBurnRateRuleService as unknown as Record<string, Mocked>;
const tierService: Record<string, Mocked> =
  ServiceLevelObjectiveErrorBudgetPolicyTierService as unknown as Record<
    string,
    Mocked
  >;
const counting: { measure: Mocked } = SloRequestCounting as unknown as {
  measure: Mocked;
};
const historyService: { insertHistoryRows: Mocked } =
  SloHistoryService as unknown as { insertHistoryRows: Mocked };
const sloMetricUtil: Record<string, Mocked> =
  SloMetricUtil as unknown as Record<string, Mocked>;
const feedService: { createServiceLevelObjectiveFeedItem: Mocked } =
  ServiceLevelObjectiveFeedService as unknown as {
    createServiceLevelObjectiveFeedItem: Mocked;
  };
const alertService: Record<string, Mocked> = AlertService as unknown as Record<
  string,
  Mocked
>;
const incidentService: Record<string, Mocked> =
  IncidentService as unknown as Record<string, Mocked>;
const notificationService: Record<string, Mocked> =
  UserNotificationSettingService as unknown as Record<string, Mocked>;
const projectService: Record<string, Mocked> =
  ProjectService as unknown as Record<string, Mocked>;
const mockedLogger: Record<string, Mocked> = logger as unknown as Record<
  string,
  Mocked
>;
const semaphore: Record<string, Mocked> = Semaphore as unknown as Record<
  string,
  Mocked
>;

const SWEEP_MUTEX: SemaphoreMutex = {
  identifier: "sweep-mutex",
} as unknown as SemaphoreMutex;

// 12:07:30, so the newest settled step ends at 12:05 (two minutes to settle).
const NOW: Date = new Date("2026-07-19T12:07:30.000Z");
const COUNTED_UNTIL: Date = new Date("2026-07-19T12:05:00.000Z");

const MINUTE: number = 60 * 1000;
const DAY: number = 24 * 60 * MINUTE;

const PROJECT_ID: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-000000000001",
);
const SLO_ID: ObjectID = new ObjectID("7b000000-0000-4000-8000-000000000002");
const RULE_ID: ObjectID = new ObjectID("7b000000-0000-4000-8000-000000000003");
const SERVICE_A: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-0000000000aa",
);
const SERVICE_B: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-0000000000bb",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-0000000000c1",
);
const OWNER_ID: ObjectID = new ObjectID("7b000000-0000-4000-8000-0000000000d1");

const FINGERPRINT: string = "f".repeat(64);

function minutesBefore(date: Date, minutes: number): Date {
  return new Date(date.getTime() - minutes * MINUTE);
}

interface RequestSloOverrides {
  sliType?: SliType | undefined;
  services?: Array<Service> | undefined;
  latencyThresholdInMilliseconds?: number | undefined;
  targetPercentage?: number | undefined;
  windowType?: SloWindowType | undefined;
  windowDays?: number | undefined;
  sloStatus?: SloStatus | undefined;
  firstAccumulatedBucketStartAt?: Date | undefined;
  lastAccumulatedBucketEndAt?: Date | undefined;
  eventAccumulationFingerprint?: string | undefined;
  monitors?: Array<Monitor> | undefined;
  requestFilter?: string | undefined;
  // A Metric SLO's metric (#8445).
  metricQueryConfig?: Record<string, unknown> | undefined;
}

// A rolling 30-day, 99.9% Request Success SLO over two services.
function makeRequestSlo(
  overrides: RequestSloOverrides = {},
): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective(SLO_ID);
  slo.projectId = PROJECT_ID;
  slo.name = "Checkout requests";
  slo.sliType = overrides.sliType ?? SliType.RequestSuccess;
  slo.services = overrides.services ?? [
    new Service(SERVICE_A),
    new Service(SERVICE_B),
  ];
  slo.monitors = overrides.monitors ?? [];
  slo.targetPercentage = overrides.targetPercentage ?? 99.9;
  slo.windowType = overrides.windowType ?? SloWindowType.Rolling;
  slo.windowDays = overrides.windowDays ?? 30;
  slo.sloStatus = overrides.sloStatus ?? SloStatus.Healthy;
  slo.atRiskThresholdPercentage = 20;

  if (overrides.latencyThresholdInMilliseconds !== undefined) {
    slo.latencyThresholdInMilliseconds =
      overrides.latencyThresholdInMilliseconds;
  }

  if (overrides.firstAccumulatedBucketStartAt) {
    slo.firstAccumulatedBucketStartAt = overrides.firstAccumulatedBucketStartAt;
  }

  if (overrides.lastAccumulatedBucketEndAt) {
    slo.lastAccumulatedBucketEndAt = overrides.lastAccumulatedBucketEndAt;
  }

  if (overrides.requestFilter !== undefined) {
    slo.requestFilter = overrides.requestFilter;
  }

  if (overrides.metricQueryConfig !== undefined) {
    slo.metricQueryConfig = overrides.metricQueryConfig as JSONObject;
  }

  if (overrides.eventAccumulationFingerprint) {
    slo.eventAccumulationFingerprint = overrides.eventAccumulationFingerprint;
  }

  return slo;
}

interface RuleOverrides {
  burnRateThreshold?: number | undefined;
  longWindowInMinutes?: number | undefined;
  shortWindowInMinutes?: number | undefined;
  minimumSampleCount?: number | undefined;
  lastAlertCreatedAt?: Date | undefined;
}

// The fast burn rule: 14.4x over an hour, confirmed over 5 minutes.
function makeRule(
  overrides: RuleOverrides = {},
): ServiceLevelObjectiveBurnRateRule {
  const rule: ServiceLevelObjectiveBurnRateRule =
    new ServiceLevelObjectiveBurnRateRule(RULE_ID);
  rule.projectId = PROJECT_ID;
  rule.serviceLevelObjectiveId = SLO_ID;
  rule.name = "Fast burn";
  rule.isEnabled = true;
  rule.burnRateThreshold = overrides.burnRateThreshold ?? 14.4;
  rule.longWindowInMinutes = overrides.longWindowInMinutes ?? 60;
  rule.shortWindowInMinutes = overrides.shortWindowInMinutes ?? 5;
  rule.alertSeverityId = SEVERITY_ID;
  rule.onCallDutyPolicies = [];
  rule.incidentOnCallDutyPolicies = [];

  if (overrides.minimumSampleCount !== undefined) {
    rule.minimumSampleCount = overrides.minimumSampleCount;
  }

  if (overrides.lastAlertCreatedAt) {
    rule.lastAlertCreatedAt = overrides.lastAlertCreatedAt;
  }

  return rule;
}

interface MeasureArgs {
  projectId: ObjectID;
  sloId: ObjectID;
  config: {
    sliType: SliType;
    serviceIds: Array<ObjectID>;
    latencyThresholdInMilliseconds?: number | null;
    requestFilter?: string | null;
    metricQueryConfig?: JSONObject | null;
  };
  now: Date;
  neededFrom: Date;
  firstAccumulatedBucketStartAt?: Date | null;
  lastAccumulatedBucketEndAt?: Date | null;
  fingerprint?: string | null;
  windowStarts: Array<Date>;
}

/*
 * What SloRequestCounting answers: the window's counts first, then one count
 * per lookback the worker asked for, in its order - each looked up here by
 * how far back its start is from the newest counted step.
 */
function stubMeasurement(data: {
  window: SloRequestCounts;
  byLookbackMinutes?: Record<number, SloRequestCounts> | undefined;
  countedSince?: Date | undefined;
}): void {
  counting.measure.mockImplementation(
    async (args: MeasureArgs): Promise<SloRequestMeasurement> => {
      return {
        firstAccumulatedBucketStartAt:
          data.countedSince ?? new Date(COUNTED_UNTIL.getTime() - 40 * DAY),
        lastAccumulatedBucketEndAt: COUNTED_UNTIL,
        fingerprint: FINGERPRINT,
        isRestart: false,
        windowCounts: args.windowStarts.map(
          (start: Date, index: number): SloRequestCounts => {
            if (index === 0) {
              return data.window;
            }

            const minutes: number = Math.round(
              (COUNTED_UNTIL.getTime() - start.getTime()) / MINUTE,
            );

            return (
              data.byLookbackMinutes?.[minutes] || {
                goodCount: 0,
                totalCount: 0,
              }
            );
          },
        ),
      };
    },
  );
}

function measureArgs(): MeasureArgs {
  expect(counting.measure).toHaveBeenCalledTimes(1);
  return counting.measure.mock.calls[0]![0] as MeasureArgs;
}

function payloadsOf(mock: Mocked): Array<Record<string, unknown>> {
  return mock.mock.calls.map((args: Array<unknown>) => {
    return (args[0] as { data: Record<string, unknown> }).data;
  });
}

function stateUpdate(): Record<string, unknown> {
  const writes: Array<Record<string, unknown>> = payloadsOf(
    sloService["updateOneById"]!,
  ).filter((data: Record<string, unknown>): boolean => {
    return "currentSliPercentage" in data;
  });

  expect(writes).toHaveLength(1);
  return writes[0]!;
}

function statusWrites(): Array<unknown> {
  return payloadsOf(sloService["updateOneById"]!)
    .filter((data: Record<string, unknown>): boolean => {
      return "sloStatus" in data;
    })
    .map((data: Record<string, unknown>): unknown => {
      return data["sloStatus"];
    });
}

function feedTexts(): Array<string> {
  return feedService.createServiceLevelObjectiveFeedItem.mock.calls.map(
    (args: Array<unknown>): string => {
      const item: {
        feedInfoInMarkdown: string;
        moreInformationInMarkdown?: string;
      } = args[0] as {
        feedInfoInMarkdown: string;
        moreInformationInMarkdown?: string;
      };

      return `${item.feedInfoInMarkdown}\n${item.moreInformationInMarkdown || ""}`;
    },
  );
}

async function runWorkerTick(): Promise<void> {
  const handler: CronHandler | undefined = mockCapturedJobs["Slo:EvaluateSlos"];

  if (!handler) {
    throw new Error("Slo:EvaluateSlos did not register a cron handler.");
  }

  await handler();
}

describe("Slo:EvaluateSlos worker - request SLIs", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
    jest.spyOn(OneUptimeDate, "getCurrentMomentDate").mockImplementation(() => {
      return Moment(NOW);
    });

    semaphore["lock"]!.mockResolvedValue(SWEEP_MUTEX);
    semaphore["release"]!.mockResolvedValue(undefined);

    sloService["getDueSlos"]!.mockResolvedValue([]);
    sloService["updateOneById"]!.mockResolvedValue(undefined);
    sloService["updateColumnsByIdWithoutHooks"]!.mockResolvedValue(undefined);
    sloService[
      "resolveOpenBurnRateAlertsAndIncidentsForSlo"
    ]!.mockResolvedValue(undefined);
    sloService["findOwners"]!.mockResolvedValue([]);
    sloService["getSloLinkInDashboard"]!.mockResolvedValue(
      "https://oneuptime.com/dashboard/slo/slo-1",
    );
    sloService["findOneById"]!.mockImplementation(
      async (): Promise<ServiceLevelObjective> => {
        const current: ServiceLevelObjective = new ServiceLevelObjective(
          SLO_ID,
        );
        current.isEnabled = true;
        current.isArchived = false;
        return current;
      },
    );
    sloService["getSloMarkdownLink"]!.mockResolvedValue(
      FeedMarkdown.asMarkdown(
        "[SLO Checkout requests](https://oneuptime.com/dashboard/slo/slo-1)",
      ),
    );

    burnRuleService["findBy"]!.mockResolvedValue([]);
    burnRuleService["updateOneById"]!.mockResolvedValue(undefined);
    burnRuleService["resolveOpenAlertsForRule"]!.mockResolvedValue(undefined);
    burnRuleService["resolveOpenIncidentsForRule"]!.mockResolvedValue(
      undefined,
    );
    burnRuleService["getBurnRateFingerprint"]!.mockReturnValue(
      `slo:${SLO_ID.toString()}:burn-rule:${RULE_ID.toString()}`,
    );

    tierService["findBy"]!.mockResolvedValue([]);

    counting.measure.mockReset();
    historyService.insertHistoryRows.mockResolvedValue(undefined);
    sloMetricUtil["saveSloMetrics"]!.mockResolvedValue(undefined);
    sloMetricUtil["saveSloGuardMetrics"]!.mockResolvedValue(undefined);
    feedService.createServiceLevelObjectiveFeedItem.mockResolvedValue(
      undefined,
    );
    (
      SloWorkspaceNotifications as unknown as { postPolicyChange: Mocked }
    ).postPolicyChange.mockResolvedValue(true);

    alertService["findOneBy"]!.mockResolvedValue(null);
    alertService["create"]!.mockResolvedValue(new Alert());
    alertService["addOwners"]!.mockResolvedValue(undefined);
    alertService["getAlertLinkInDashboard"]!.mockResolvedValue(
      "https://oneuptime.com/dashboard/project-1/alerts/alert-1",
    );
    incidentService["findOneBy"]!.mockResolvedValue(null);
    incidentService["create"]!.mockResolvedValue(new Incident());

    for (const ownerService of [
      AlertOwnerUserService,
      AlertOwnerTeamService,
      IncidentOwnerUserService,
      IncidentOwnerTeamService,
    ]) {
      (ownerService as unknown as { findBy: Mocked }).findBy.mockResolvedValue(
        [],
      );
    }

    (
      TeamMemberService as unknown as { getUsersInTeams: Mocked }
    ).getUsersInTeams.mockResolvedValue([]);
    projectService["getOwners"]!.mockResolvedValue([]);
    projectService["findOneById"]!.mockResolvedValue(null);
    (
      ScheduledMaintenanceService as unknown as { findBy: Mocked }
    ).findBy.mockResolvedValue([]);
    (
      ScheduledMaintenanceStateService as unknown as {
        getInProgressScheduledMaintenanceStateIds: Mocked;
      }
    ).getInProgressScheduledMaintenanceStateIds.mockResolvedValue([]);
    notificationService["ensureSettingExistsForUser"]!.mockResolvedValue(
      undefined,
    );
    notificationService["sendUserNotification"]!.mockResolvedValue(undefined);

    jest
      .spyOn(ProjectScopedReferenceValidator, "filterUsableInProject")
      .mockImplementation(async (data: { ids: Array<ObjectID | string> }) => {
        return { usableIds: data.ids, droppedIds: [] };
      });
  });

  describe("what the worker asks the counting for", () => {
    test("the SLO's services and SLI type, its cursors, and every window it sums", async () => {
      burnRuleService["findBy"]!.mockResolvedValue([
        makeRule(),
        makeRule({ longWindowInMinutes: 360, shortWindowInMinutes: 30 }),
      ]);
      sloService["getDueSlos"]!.mockResolvedValue([
        makeRequestSlo({
          firstAccumulatedBucketStartAt: new Date(
            COUNTED_UNTIL.getTime() - 40 * DAY,
          ),
          lastAccumulatedBucketEndAt: minutesBefore(COUNTED_UNTIL, 5),
          eventAccumulationFingerprint: FINGERPRINT,
        }),
      ]);
      stubMeasurement({ window: { goodCount: 999, totalCount: 1000 } });

      await runWorkerTick();

      const args: MeasureArgs = measureArgs();

      expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(args.sloId.toString()).toBe(SLO_ID.toString());
      expect(args.config.sliType).toBe(SliType.RequestSuccess);
      expect(
        args.config.serviceIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      ).toEqual([SERVICE_A.toString(), SERVICE_B.toString()]);
      expect(args.config.latencyThresholdInMilliseconds).toBeNull();
      expect(args.now).toEqual(NOW);
      expect(args.fingerprint).toBe(FINGERPRINT);
      expect(args.lastAccumulatedBucketEndAt).toEqual(
        minutesBefore(COUNTED_UNTIL, 5),
      );

      // The rolling 30 days up to the newest counted step, then each lookback once.
      expect(args.windowStarts[0]).toEqual(
        new Date(COUNTED_UNTIL.getTime() - 30 * DAY),
      );
      expect(
        args.windowStarts.slice(1).map((start: Date): number => {
          return (COUNTED_UNTIL.getTime() - start.getTime()) / MINUTE;
        }),
      ).toEqual([60, 5, 360, 30]);

      // The window is the oldest thing it needs: older than any rule's lookback.
      expect(args.neededFrom).toEqual(
        new Date(COUNTED_UNTIL.getTime() - 30 * DAY),
      );

      // No monitor is read for a request SLI.
      expect(
        (MonitorService as unknown as { findBy: Mocked }).findBy,
      ).not.toHaveBeenCalled();
      expect(
        (MonitorStatusTimelineService as unknown as { findAllBy: Mocked })
          .findAllBy,
      ).not.toHaveBeenCalled();
    });

    test("a rule that looks back further than the window extends what is needed", async () => {
      burnRuleService["findBy"]!.mockResolvedValue([
        makeRule({
          longWindowInMinutes: 3 * 24 * 60,
          shortWindowInMinutes: 360,
        }),
      ]);
      sloService["getDueSlos"]!.mockResolvedValue([
        makeRequestSlo({ windowDays: 1 }),
      ]);
      stubMeasurement({ window: { goodCount: 999, totalCount: 1000 } });

      await runWorkerTick();

      expect(measureArgs().neededFrom).toEqual(
        new Date(COUNTED_UNTIL.getTime() - 3 * DAY),
      );
    });

    test("a Request Latency SLO hands over its threshold", async () => {
      sloService["getDueSlos"]!.mockResolvedValue([
        makeRequestSlo({
          sliType: SliType.RequestLatency,
          latencyThresholdInMilliseconds: 300,
        }),
      ]);
      stubMeasurement({ window: { goodCount: 950, totalCount: 1000 } });

      await runWorkerTick();

      expect(measureArgs().config).toEqual({
        sliType: SliType.RequestLatency,
        serviceIds: [new Service(SERVICE_A).id, new Service(SERVICE_B).id],
        latencyThresholdInMilliseconds: 300,
      });
    });

    // Which of the services' requests count (#8444), as written.
    test("a request filter is handed over as stored", async () => {
      sloService["getDueSlos"]!.mockResolvedValue([
        makeRequestSlo({
          requestFilter: "@http.route:/checkout* -@http.route:/health",
        }),
      ]);
      stubMeasurement({ window: { goodCount: 999, totalCount: 1000 } });

      await runWorkerTick();

      expect(measureArgs().config.requestFilter).toBe(
        "@http.route:/checkout* -@http.route:/health",
      );
    });

    test("a calendar month is summed from the start of the month", async () => {
      sloService["getDueSlos"]!.mockResolvedValue([
        makeRequestSlo({ windowType: SloWindowType.CalendarMonth }),
      ]);
      stubMeasurement({ window: { goodCount: 999, totalCount: 1000 } });

      await runWorkerTick();

      expect(measureArgs().windowStarts[0]).toEqual(
        new Date("2026-07-01T00:00:00.000Z"),
      );
    });

    test("the counting's cursors are kept at once, hookless", async () => {
      sloService["getDueSlos"]!.mockResolvedValue([makeRequestSlo()]);
      stubMeasurement({
        window: { goodCount: 999, totalCount: 1000 },
        countedSince: new Date(COUNTED_UNTIL.getTime() - DAY),
      });

      await runWorkerTick();

      expect(
        payloadsOf(sloService["updateColumnsByIdWithoutHooks"]!),
      ).toContainEqual({
        firstAccumulatedBucketStartAt: new Date(COUNTED_UNTIL.getTime() - DAY),
        lastAccumulatedBucketEndAt: COUNTED_UNTIL,
        eventAccumulationFingerprint: FINGERPRINT,
      });
    });
  });

  describe("measured", () => {
    test("writes the SLI and budget in requests, and no seconds", async () => {
      sloService["getDueSlos"]!.mockResolvedValue([makeRequestSlo()]);
      stubMeasurement({
        window: { goodCount: 99950, totalCount: 100000 },
        byLookbackMinutes: { 60: { goodCount: 1000, totalCount: 1000 } },
      });

      await runWorkerTick();

      const update: Record<string, unknown> = stateUpdate();

      expect(update["currentSliPercentage"]).toBeCloseTo(99.95, 9);
      expect(update["errorBudgetRemainingPercentage"]).toBeCloseTo(50, 6);
      expect(update["goodEventCount"]).toBe(99950);
      expect(update["totalEventCount"]).toBe(100000);
      expect(update["errorBudgetTotalEvents"]).toBeCloseTo(100, 6);
      expect(update["errorBudgetRemainingEvents"]).toBeCloseTo(50, 6);
      expect(update["errorBudgetRemainingSeconds"]).toBeNull();
      expect(update["errorBudgetTotalSeconds"]).toBeNull();
      expect(update["currentBurnRate"]).toBe(0);
      expect(update["sloStatus"]).toBe(SloStatus.Healthy);
    });

    test("the current burn rate is the last hour's counts", async () => {
      sloService["getDueSlos"]!.mockResolvedValue([makeRequestSlo()]);
      stubMeasurement({
        window: { goodCount: 99950, totalCount: 100000 },
        // 0.5% failed in the last hour, against 0.1% allowed: 5x.
        byLookbackMinutes: { 60: { goodCount: 995, totalCount: 1000 } },
      });

      await runWorkerTick();

      expect(stateUpdate()["currentBurnRate"]).toBeCloseTo(5, 6);
    });

    test("history rows and metrics are written, without a budget in seconds", async () => {
      sloService["getDueSlos"]!.mockResolvedValue([makeRequestSlo()]);
      stubMeasurement({ window: { goodCount: 99950, totalCount: 100000 } });

      await runWorkerTick();

      const rows: Array<{ metricName: string }> = historyService
        .insertHistoryRows.mock.calls[0]![0] as Array<{
        metricName: string;
      }>;

      expect(
        rows.map((row: { metricName: string }): string => {
          return row.metricName;
        }),
      ).toEqual(["sli.percent", "error.budget.remaining.percent", "burn.rate"]);

      const values: Record<string, unknown> = (
        sloMetricUtil["saveSloMetrics"]!.mock.calls[0]![0] as {
          values: Record<string, unknown>;
        }
      ).values;

      expect(values[SloMetricType.SliPercent]).toBeCloseTo(99.95, 9);
      expect(values[SloMetricType.ErrorBudgetRemainingSeconds]).toBeNull();
      expect(values[SloMetricType.ErrorBudgetRemainingPercent]).toBeCloseTo(
        50,
        6,
      );
    });

    test("a budget spent turns the SLO Budget Exhausted, and the feed says by how many requests", async () => {
      sloService["getDueSlos"]!.mockResolvedValue([makeRequestSlo()]);
      // 1,050 failed of 1,000,000 against 1,000 allowed: 50 over.
      stubMeasurement({ window: { goodCount: 998950, totalCount: 1000000 } });

      await runWorkerTick();

      expect(stateUpdate()["sloStatus"]).toBe(SloStatus.BudgetExhausted);
      expect(stateUpdate()["errorBudgetRemainingEvents"]).toBeCloseTo(-50, 6);

      const text: string = feedTexts().join("\n");

      expect(text).toContain("is now **Budget Exhausted**");
      expect(text).toContain("(over budget by 50 failed requests)");
      expect(text).not.toMatch(/over budget by \d+ (second|minute|hour|day)/);
    });

    test("a Request Latency SLO's budget is in slow requests", async () => {
      sloService["getDueSlos"]!.mockResolvedValue([
        makeRequestSlo({
          sliType: SliType.RequestLatency,
          latencyThresholdInMilliseconds: 300,
          targetPercentage: 99,
        }),
      ]);
      // 10,000 requests, 99% must be fast: 100 slow ones allowed, 85 used.
      stubMeasurement({ window: { goodCount: 9915, totalCount: 10000 } });

      await runWorkerTick();

      expect(stateUpdate()["sloStatus"]).toBe(SloStatus.AtRisk);
      expect(feedTexts().join("\n")).toContain("(15 slow requests)");
    });

    test("owners hear of the budget in requests, in every channel", async () => {
      const owner: User = new User(OWNER_ID);
      owner.email = "owner@example.com" as never;
      sloService["findOwners"]!.mockResolvedValue([owner]);
      sloService["getDueSlos"]!.mockResolvedValue([makeRequestSlo()]);
      stubMeasurement({ window: { goodCount: 998950, totalCount: 1000000 } });

      await runWorkerTick();

      expect(notificationService["sendUserNotification"]).toHaveBeenCalledTimes(
        1,
      );

      const sent: {
        emailEnvelope: { vars: Record<string, string> };
        smsMessage: { message: string };
        whatsAppMessage?: unknown;
      } = notificationService["sendUserNotification"]!.mock.calls[0]![0] as {
        emailEnvelope: { vars: Record<string, string> };
        smsMessage: { message: string };
        whatsAppMessage?: unknown;
      };

      expect(sent.emailEnvelope.vars["errorBudgetRemainingRequests"]).toBe(
        "-50 failed requests",
      );
      expect(sent.emailEnvelope.vars["errorBudgetRemainingMinutes"]).toBe(
        undefined,
      );
      expect(sent.smsMessage.message).toContain(
        "Error budget remaining: -5% (-50 failed requests)",
      );
      expect(sent.smsMessage.message).not.toContain("minutes");
      /*
       * No WhatsApp message: none is approved for an SLO's status, and the
       * plain body it used to be handed reached nobody (#9715).
       */
      expect(sent.whatsAppMessage).toBeUndefined();
    });
  });

  describe("guards", () => {
    test("no services: Misconfigured with the reason, and nothing is counted", async () => {
      sloService["getDueSlos"]!.mockResolvedValue([
        makeRequestSlo({ services: [] }),
      ]);

      await runWorkerTick();

      expect(counting.measure).not.toHaveBeenCalled();
      expect(statusWrites()).toEqual([SloStatus.Misconfigured]);
      expect(feedTexts().join("\n")).toContain("No services are chosen");
    });

    test("a Request Latency SLO without a threshold: Misconfigured with the reason", async () => {
      sloService["getDueSlos"]!.mockResolvedValue([
        makeRequestSlo({ sliType: SliType.RequestLatency }),
      ]);

      await runWorkerTick();

      expect(counting.measure).not.toHaveBeenCalled();
      expect(statusWrites()).toEqual([SloStatus.Misconfigured]);
      expect(feedTexts().join("\n")).toContain("has no latency threshold");
    });

    /*
     * The service refuses a filter it cannot read, so this one was stored
     * before a rule tightened (#8444): counting every request instead would
     * be a wrong SLI, so nothing is counted until it is fixed.
     */
    test("a request filter that cannot be read: Misconfigured with what is wrong, and nothing is counted", async () => {
      sloService["getDueSlos"]!.mockResolvedValue([
        makeRequestSlo({ requestFilter: "checkout" }),
      ]);

      await runWorkerTick();

      expect(counting.measure).not.toHaveBeenCalled();
      expect(statusWrites()).toEqual([SloStatus.Misconfigured]);
      expect(feedTexts().join("\n")).toContain(
        "This SLO's request filter cannot be read",
      );
      expect(feedTexts().join("\n")).toContain('"checkout" is neither');
    });

    test("a target out of range: Misconfigured", async () => {
      sloService["getDueSlos"]!.mockResolvedValue([
        makeRequestSlo({ targetPercentage: 100 }),
      ]);

      await runWorkerTick();

      expect(counting.measure).not.toHaveBeenCalled();
      expect(statusWrites()).toEqual([SloStatus.Misconfigured]);
    });

    test("no requests in the window: Misconfigured, never a healthy 100%, and the counting goes on", async () => {
      sloService["getDueSlos"]!.mockResolvedValue([makeRequestSlo()]);
      stubMeasurement({ window: { goodCount: 0, totalCount: 0 } });

      await runWorkerTick();

      expect(statusWrites()).toEqual([SloStatus.Misconfigured]);
      expect(feedTexts().join("\n")).toContain(
        "have not served a request in its window yet",
      );
      expect(historyService.insertHistoryRows).not.toHaveBeenCalled();
      // The cursors are kept: the next evaluation carries on counting.
      expect(
        payloadsOf(sloService["updateColumnsByIdWithoutHooks"]!).some(
          (data: Record<string, unknown>): boolean => {
            return "lastAccumulatedBucketEndAt" in data;
          },
        ),
      ).toBe(true);
    });

    test("a count that fails is logged, writes no state, and the SLO is measured again next time", async () => {
      sloService["getDueSlos"]!.mockResolvedValue([makeRequestSlo()]);
      counting.measure.mockRejectedValue(new Error("ClickHouse is down"));

      await runWorkerTick();

      expect(mockedLogger["error"]).toHaveBeenCalled();
      expect(sloService["updateOneById"]).not.toHaveBeenCalled();
      // The cadence was stamped first.
      expect(
        payloadsOf(sloService["updateColumnsByIdWithoutHooks"]!)[0],
      ).toHaveProperty("lastEvaluatedAt", NOW);
    });
  });

  describe("burn rate rules", () => {
    // 10% failed: 100x against 99.9%.
    const BURNING: SloRequestCounts = { goodCount: 900, totalCount: 1000 };

    function firingCounts(): void {
      stubMeasurement({
        window: { goodCount: 999000, totalCount: 1000000 },
        byLookbackMinutes: { 60: BURNING, 5: BURNING },
      });
    }

    test("fire on two burning windows the counts cover, and say the budget in requests", async () => {
      burnRuleService["findBy"]!.mockResolvedValue([makeRule()]);
      sloService["getDueSlos"]!.mockResolvedValue([makeRequestSlo()]);
      firingCounts();

      await runWorkerTick();

      expect(alertService["create"]).toHaveBeenCalledTimes(1);

      const alert: Alert = (
        alertService["create"]!.mock.calls[0]![0] as { data: Alert }
      ).data;

      expect(alert.description).toContain(
        "Error budget remaining: 0% (0 failed requests).",
      );
      expect(alert.description).not.toContain("minutes)");
    });

    test("a rule that stored the built-in description follows the request SLO's own", async () => {
      const rule: ServiceLevelObjectiveBurnRateRule = makeRule();
      // What the rule form fills in, and most rules keep.
      rule.alertDescriptionTemplate =
        DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE;
      burnRuleService["findBy"]!.mockResolvedValue([rule]);
      sloService["getDueSlos"]!.mockResolvedValue([makeRequestSlo()]);
      firingCounts();

      await runWorkerTick();

      const alert: Alert = (
        alertService["create"]!.mock.calls[0]![0] as { data: Alert }
      ).data;

      expect(alert.description).toContain("(0 failed requests).");
      expect(alert.description).not.toContain("( minutes)");
    });

    test("a rule's own description is rendered as written, {{errorBudgetRemaining}} in requests", async () => {
      const rule: ServiceLevelObjectiveBurnRateRule = makeRule();
      rule.alertDescriptionTemplate =
        "{{sloName}} has {{errorBudgetRemaining}} left; minutes: [{{errorBudgetRemainingMinutes}}]";
      burnRuleService["findBy"]!.mockResolvedValue([rule]);
      sloService["getDueSlos"]!.mockResolvedValue([makeRequestSlo()]);
      stubMeasurement({
        window: { goodCount: 999500, totalCount: 1000000 },
        byLookbackMinutes: { 60: BURNING, 5: BURNING },
      });

      await runWorkerTick();

      const alert: Alert = (
        alertService["create"]!.mock.calls[0]![0] as { data: Alert }
      ).data;

      expect(alert.description).toBe(
        "Checkout requests has 500 failed requests left; minutes: []",
      );
    });

    test("do not fire on a long window the counts do not cover yet", async () => {
      burnRuleService["findBy"]!.mockResolvedValue([makeRule()]);
      sloService["getDueSlos"]!.mockResolvedValue([makeRequestSlo()]);
      stubMeasurement({
        window: { goodCount: 900, totalCount: 1000 },
        byLookbackMinutes: { 60: BURNING, 5: BURNING },
        // Counting started 30 minutes ago: no hour of requests to judge.
        countedSince: minutesBefore(COUNTED_UNTIL, 30),
      });

      await runWorkerTick();

      expect(alertService["create"]).not.toHaveBeenCalled();
      expect(
        mockedLogger["debug"]!.mock.calls.some(
          (call: Array<unknown>): boolean => {
            return String(call[0]).includes(
              "not enough history to evaluate a 60-minute burn window",
            );
          },
        ),
      ).toBe(true);
    });

    test("a long window with fewer requests than the rule's minimum does not fire", async () => {
      burnRuleService["findBy"]!.mockResolvedValue([
        makeRule({ minimumSampleCount: 5000 }),
      ]);
      sloService["getDueSlos"]!.mockResolvedValue([makeRequestSlo()]);
      firingCounts();

      await runWorkerTick();

      expect(alertService["create"]).not.toHaveBeenCalled();
      // It holds: a burning long window is not a recovery either.
      expect(
        burnRuleService["resolveOpenAlertsForRule"],
      ).not.toHaveBeenCalled();
    });

    test("a long window with at least the rule's minimum fires", async () => {
      burnRuleService["findBy"]!.mockResolvedValue([
        makeRule({ minimumSampleCount: 1000 }),
      ]);
      sloService["getDueSlos"]!.mockResolvedValue([makeRequestSlo()]);
      firingCounts();

      await runWorkerTick();

      expect(alertService["create"]).toHaveBeenCalledTimes(1);
    });

    test("a rule recovers on a quiet long window", async () => {
      burnRuleService["findBy"]!.mockResolvedValue([
        makeRule({ lastAlertCreatedAt: minutesBefore(NOW, 90) }),
      ]);
      sloService["getDueSlos"]!.mockResolvedValue([makeRequestSlo()]);
      stubMeasurement({
        window: { goodCount: 999500, totalCount: 1000000 },
        byLookbackMinutes: {
          60: { goodCount: 1000, totalCount: 1000 },
          5: { goodCount: 100, totalCount: 100 },
        },
      });

      await runWorkerTick();

      expect(alertService["create"]).not.toHaveBeenCalled();
      expect(burnRuleService["resolveOpenAlertsForRule"]).toHaveBeenCalled();
    });
  });

  /*
   * A Metric SLO (#8445) is measured as a request SLO is - the same
   * counting plan, history, budget and burn rate rules - from its services'
   * metric in place of their traces, so it takes the same path, with its
   * metric handed to the counting and no request filter.
   */
  describe("a Metric SLO", () => {
    const COUNTER: Record<string, unknown> = {
      metricName: "http_requests_total",
      kind: "Counter",
      goodFilter: "@http.response.status_code:<500",
    };

    test("is counted from its metric, with its services, and no request filter", async () => {
      sloService["getDueSlos"]!.mockResolvedValue([
        makeRequestSlo({
          sliType: SliType.Metric,
          metricQueryConfig: COUNTER,
          // Left from a request SLI it was before: spans only.
          requestFilter: "@http.route:/checkout*",
        }),
      ]);
      stubMeasurement({ window: { goodCount: 999, totalCount: 1000 } });

      await runWorkerTick();

      const args: MeasureArgs = measureArgs();

      expect(args.config.sliType).toBe(SliType.Metric);
      expect(args.config.metricQueryConfig).toEqual(COUNTER);
      expect(args.config.requestFilter).toBeNull();
      expect(args.config.serviceIds).toHaveLength(2);
      // Measured: its status follows its budget, never a guard's.
      expect(statusWrites()).not.toContain(SloStatus.Misconfigured);
    });

    test("its budget is in events: the state write carries them, never seconds", async () => {
      sloService["getDueSlos"]!.mockResolvedValue([
        makeRequestSlo({ sliType: SliType.Metric, metricQueryConfig: COUNTER }),
      ]);
      stubMeasurement({ window: { goodCount: 999, totalCount: 1000 } });

      await runWorkerTick();

      expect(stateUpdate()).toMatchObject({
        goodEventCount: 999,
        totalEventCount: 1000,
      });
      expect(stateUpdate()["errorBudgetRemainingSeconds"]).toBeFalsy();
    });

    test("no services: Misconfigured, saying there is no metric to measure", async () => {
      sloService["getDueSlos"]!.mockResolvedValue([
        makeRequestSlo({
          sliType: SliType.Metric,
          metricQueryConfig: COUNTER,
          services: [],
        }),
      ]);

      await runWorkerTick();

      expect(counting.measure).not.toHaveBeenCalled();
      expect(statusWrites()).toEqual([SloStatus.Misconfigured]);
      expect(feedTexts().join(" ")).toContain(
        "so there is no metric to measure",
      );
    });

    test("a metric it cannot count: Misconfigured with what is wrong, and nothing is counted", async () => {
      sloService["getDueSlos"]!.mockResolvedValue([
        makeRequestSlo({
          sliType: SliType.Metric,
          metricQueryConfig: {
            metricName: "http_requests_total",
            kind: "Counter",
          },
        }),
      ]);

      await runWorkerTick();

      expect(counting.measure).not.toHaveBeenCalled();
      expect(statusWrites()).toEqual([SloStatus.Misconfigured]);
      expect(feedTexts().join(" ")).toContain(
        "This SLO's metric cannot be counted: Say which of the counter's events are good",
      );
    });

    test("no metric at all: Misconfigured, saying to choose one", async () => {
      sloService["getDueSlos"]!.mockResolvedValue([
        makeRequestSlo({ sliType: SliType.Metric }),
      ]);

      await runWorkerTick();

      expect(counting.measure).not.toHaveBeenCalled();
      expect(feedTexts().join(" ")).toContain(
        "Choose the metric this SLO counts",
      );
    });

    test("no events in the window: Misconfigured, waiting for its metric rather than for traces", async () => {
      sloService["getDueSlos"]!.mockResolvedValue([
        makeRequestSlo({ sliType: SliType.Metric, metricQueryConfig: COUNTER }),
      ]);
      stubMeasurement({ window: { goodCount: 0, totalCount: 0 } });

      await runWorkerTick();

      expect(statusWrites()).toEqual([SloStatus.Misconfigured]);
      expect(feedTexts().join(" ")).toContain(
        "have not sent an event of its metric in its window yet",
      );
      expect(feedTexts().join(" ")).not.toContain("traces");
    });
  });

  describe("an SLO that changed what it measures", () => {
    const MONITOR_ID: ObjectID = new ObjectID(
      "7b000000-0000-4000-8000-0000000000e1",
    );

    function monitorUptimeSloWithCountsLeft(): ServiceLevelObjective {
      const slo: ServiceLevelObjective = makeRequestSlo({
        sliType: SliType.MonitorUptime,
        monitors: [new Monitor(MONITOR_ID)],
      });
      slo.downtimeMonitorStatuses = [offlineStatus()];
      slo.goodEventCount = 10;
      slo.totalEventCount = 10;
      slo.errorBudgetTotalEvents = 0.01;
      slo.errorBudgetRemainingEvents = 0.01;
      return slo;
    }

    function offlineStatus(): MonitorStatus {
      const status: MonitorStatus = new MonitorStatus(
        new ObjectID("7b000000-0000-4000-8000-0000000000f1"),
      );
      status.name = "Offline";
      status.priority = 2;
      status.isOperationalState = false;
      return status;
    }

    function operationalStatus(): MonitorStatus {
      const status: MonitorStatus = new MonitorStatus(
        new ObjectID("7b000000-0000-4000-8000-0000000000f2"),
      );
      status.name = "Operational";
      status.priority = 1;
      status.isOperationalState = true;
      return status;
    }

    test("a Monitor Uptime SLO with request counts left from before clears them beside its seconds", async () => {
      sloService["getDueSlos"]!.mockResolvedValue([
        monitorUptimeSloWithCountsLeft(),
      ]);

      const enabledMonitor: Monitor = new Monitor(MONITOR_ID);
      enabledMonitor.disableActiveMonitoring = false;
      enabledMonitor.disableActiveMonitoringBecauseOfManualIncident = false;
      enabledMonitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent =
        false;
      (
        MonitorService as unknown as { findBy: Mocked }
      ).findBy.mockResolvedValue([enabledMonitor]);
      (
        MonitorStatusService as unknown as { findBy: Mocked }
      ).findBy.mockResolvedValue([offlineStatus()]);

      // Up for the whole window.
      const row: MonitorStatusTimeline = new MonitorStatusTimeline();
      row.monitorId = MONITOR_ID;
      row.monitorStatusId = operationalStatus().id!;
      row.monitorStatus = operationalStatus();
      row.startsAt = new Date(NOW.getTime() - 40 * DAY);
      (
        MonitorStatusTimelineService as unknown as { findAllBy: Mocked }
      ).findAllBy.mockResolvedValue([row]);

      await runWorkerTick();

      expect(counting.measure).not.toHaveBeenCalled();

      const update: Record<string, unknown> = stateUpdate();

      expect(update["currentSliPercentage"]).toBe(100);
      expect(typeof update["errorBudgetRemainingSeconds"]).toBe("number");
      expect(typeof update["errorBudgetTotalSeconds"]).toBe("number");
      expect(update["goodEventCount"]).toBeNull();
      expect(update["totalEventCount"]).toBeNull();
      expect(update["errorBudgetTotalEvents"]).toBeNull();
      expect(update["errorBudgetRemainingEvents"]).toBeNull();
    });
  });

  test("the steps the counting works in are 5 minutes", () => {
    expect(SLO_REQUEST_STEP_MILLISECONDS).toBe(5 * MINUTE);
  });
});
