/*
 * Scheduled maintenance on a database, end to end through
 * MonitorResourceUtil.monitorResource.
 *
 * A team puts orders-db into a maintenance window to upgrade PostgreSQL. The
 * monitors its Recommendations tab created are UNGROUPED and scoped by the
 * `oneuptime.database.server.id` filter, so they carry no series labels for
 * the per-series maintenance suppression to match, and they are not attached
 * to the event themselves. MonitorMaintenanceSuppression decides the
 * whole-monitor half (DatabaseMaintenanceSuppression.test.ts pins the rule);
 * these tests pin its only call site: during the window the evaluation opens
 * no incident and no alert, while the status timeline and the resolve pass
 * still run — and the same breach opens both again once the window has
 * ended, or when the window covers something the monitor does not watch.
 *
 * Only the edges are stubbed: the criteria evaluator (native isolated-vm),
 * the monitor load, the per-monitor lock (Redis), metric and log writes
 * (ClickHouse) and the Postgres reads and writes the real incident and alert
 * creators make. The maintenance decision, the monitor's resource
 * resolution and both creators run for real, and what they create is read
 * off IncidentService.create / AlertService.create.
 */

jest.mock("isolated-vm", () => {
  return {};
});

jest.mock("../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator", () => {
  return {
    __esModule: true,
    default: {
      processMonitorStep: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Monitor/MonitorMetricUtil", () => {
  return {
    __esModule: true,
    default: {
      saveMonitorMetrics: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Monitor/MonitorLogUtil", () => {
  return {
    __esModule: true,
    default: {
      saveMonitorLog: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import Alert from "../../../../Models/DatabaseModels/Alert";
import DatabaseServer from "../../../../Models/DatabaseModels/DatabaseServer";
import Host from "../../../../Models/DatabaseModels/Host";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import AlertService from "../../../../Server/Services/AlertService";
import DatabaseServerEndpointService from "../../../../Server/Services/DatabaseServerEndpointService";
import DatabaseServerService from "../../../../Server/Services/DatabaseServerService";
import IncidentService from "../../../../Server/Services/IncidentService";
import MonitorService from "../../../../Server/Services/MonitorService";
import NetworkDeviceOwnerUserService from "../../../../Server/Services/NetworkDeviceOwnerUserService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import MonitorStatusTimelineUtil from "../../../../Server/Utils/Monitor/MonitorStatusTimeline";
import MonitorSummaryCapture from "../../../../Server/Utils/Monitor/MonitorSummaryCapture";
import Includes from "../../../../Types/BaseDatabase/Includes";
import {
  DATABASE_SERVER_ID_SCOPE_ATTRIBUTE,
  DatabaseAlertTemplate,
  getDatabaseAlertTemplateById,
} from "../../../../Types/Monitor/DatabaseAlertTemplates";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationEvent,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// The house workaround for @jest/globals vs @types/jest spy typing.
type SpyLike = {
  mock: { calls: Array<Array<unknown>> };
  mockRestore: () => void;
};

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";

const ORDERS_DB: string = "d0000000-0000-4000-8000-00000000000a";
const BILLING_DB: string = "d0000000-0000-4000-8000-00000000000b";
const WEB_HOST: string = "40000000-0000-4000-8000-000000000001";

const ENGINE_METRICS_STOPPED: string =
  "database-postgresql-engine-metrics-stopped";

type MaintenanceState = "scheduled" | "ongoing" | "ended";

interface FakeMaintenanceEvent {
  projectId: string;
  state: MaintenanceState;
  databaseServerIds: Array<string>;
  hostIds: Array<string>;
}

// The project's scheduled maintenance events, as the Postgres query sees them.
let maintenanceEvents: Array<FakeMaintenanceEvent> = [];

// The DatabaseServer table: which ids exist, in which project.
const DATABASE_ROWS: Array<{ _id: string; projectId: string }> = [
  { _id: ORDERS_DB, projectId: PROJECT_ID },
  { _id: BILLING_DB, projectId: PROJECT_ID },
];

let createdIncidents: Array<Incident> = [];
let createdAlerts: Array<Alert> = [];

let statusTimelineSpy: SpyLike;
let resolveIncidentsSpy: SpyLike;
let resolveAlertsSpy: SpyLike;

const processMonitorStepMock: jest.Mock =
  MonitorCriteriaEvaluator.processMonitorStep as unknown as jest.Mock;

const findOneByIdMock: jest.Mock =
  MonitorService.findOneById as unknown as jest.Mock;

const lockMock: jest.Mock = Semaphore.lock as unknown as jest.Mock;

function ongoingWindow(input: {
  databaseServerIds?: Array<string>;
  hostIds?: Array<string>;
  projectId?: string;
}): FakeMaintenanceEvent {
  return {
    projectId: input.projectId || PROJECT_ID,
    state: "ongoing",
    databaseServerIds: input.databaseServerIds || [],
    hostIds: input.hostIds || [],
  };
}

function toScheduledMaintenance(
  event: FakeMaintenanceEvent,
): ScheduledMaintenance {
  const model: ScheduledMaintenance = new ScheduledMaintenance();
  model._id = ObjectID.generate().toString();
  model.databaseServers = event.databaseServerIds.map(
    (id: string): DatabaseServer => {
      const databaseServer: DatabaseServer = new DatabaseServer();
      databaseServer._id = id;
      return databaseServer;
    },
  );
  model.hosts = event.hostIds.map((id: string): Host => {
    const host: Host = new Host();
    host._id = id;
    host.hostIdentifier = "web-1";
    return host;
  });
  return model;
}

function templateStep(input: {
  templateId: string;
  databaseServerId: string;
}): MonitorStep {
  const template: DatabaseAlertTemplate = getDatabaseAlertTemplateById(
    input.templateId,
  )!;

  return template.getMonitorStep({
    databaseServerId: input.databaseServerId,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "PostgreSQL orders-db:5432",
  });
}

/*
 * A fleet-wide monitor grouped by the database id and filtered on nothing:
 * each series names its own database, the monitor itself names none. It
 * borrows a template's criteria so it creates incidents and alerts exactly
 * the way a recommended monitor does.
 */
function groupedFleetStep(): MonitorStep {
  const criteria: MonitorCriteria = templateStep({
    templateId: ENGINE_METRICS_STOPPED,
    databaseServerId: ORDERS_DB,
  }).data!.monitorCriteria;

  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: "Every database's connections",
    monitorType: MonitorType.Metrics,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  });

  step.setMetricMonitor({
    rollingTime: RollingTime.Past5Minutes,
    metricViewConfig: {
      queryConfigs: [
        {
          metricAliasData: {
            metricVariable: "backends",
            title: "Backends",
            description: "Backends",
            legend: "Backends",
            legendUnit: undefined,
          },
          metricQueryData: {
            filterData: {
              metricName: "postgresql.backends",
              attributes: {},
            },
            groupByAttributeKeys: [DATABASE_SERVER_ID_SCOPE_ATTRIBUTE],
          },
        },
      ],
      formulaConfigs: [],
    },
  } as unknown as Parameters<MonitorStep["setMetricMonitor"]>[0]);

  step.setMonitorCriteria(criteria);

  return step;
}

function monitorWithStep(step: MonitorStep): Monitor {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    /*
     * Unset on purpose: every evaluation here meets a criteria, so the
     * revert-to-default branch (MonitorStatusTimelineService) is never due.
     */
    defaultMonitorStatusId: undefined,
  };

  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = new ObjectID(PROJECT_ID);
  monitor.monitorType = MonitorType.Metrics;
  monitor.name = "PostgreSQL orders-db:5432 - Engine Metrics Stopped";
  monitor.monitorSteps = monitorSteps;
  return monitor;
}

// The criteria that opens incidents and alerts (the template's first).
function breachCriteria(monitor: Monitor): MonitorCriteriaInstance {
  return monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!
    .monitorCriteria.data!.monitorCriteriaInstanceArray[0]!;
}

function metricResult(monitor: Monitor): MetricMonitorResponse {
  return {
    projectId: monitor.projectId!,
    monitorId: monitor.id!,
    metricResult: [],
    metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
  } as unknown as MetricMonitorResponse;
}

// The evaluator reports the breach criteria met, ungrouped.
function breachUngrouped(monitor: Monitor): void {
  const criteriaId: string = breachCriteria(monitor).data!.id;

  processMonitorStepMock.mockImplementation(
    (input: {
      probeApiIngestResponse: ProbeApiIngestResponse;
    }): Promise<ProbeApiIngestResponse> => {
      return Promise.resolve({
        ...input.probeApiIngestResponse,
        criteriaMetId: criteriaId,
        rootCause: "No PostgreSQL engine metric arrived for 10 minutes.",
      });
    },
  );
}

// The evaluator reports the breach criteria met by each database's series.
function breachPerDatabase(
  monitor: Monitor,
  databaseServerIds: Array<string>,
): void {
  const criteriaId: string = breachCriteria(monitor).data!.id;

  const matches: Array<PerSeriesCriteriaMatch> = databaseServerIds.map(
    (databaseServerId: string): PerSeriesCriteriaMatch => {
      return {
        criteriaMetId: criteriaId,
        fingerprint: `fp-${databaseServerId}`,
        labels: { [DATABASE_SERVER_ID_SCOPE_ATTRIBUTE]: databaseServerId },
        rootCause: `Breached on ${databaseServerId}.`,
      };
    },
  );

  processMonitorStepMock.mockImplementation(
    (input: {
      probeApiIngestResponse: ProbeApiIngestResponse;
    }): Promise<ProbeApiIngestResponse> => {
      return Promise.resolve({
        ...input.probeApiIngestResponse,
        criteriaMetId: criteriaId,
        rootCause: "Breached.",
        perSeriesMatches: matches,
        matchedCriteria: [
          {
            criteriaId: criteriaId,
            rootCause: "Breached.",
            perSeriesMatches: matches,
          },
        ],
        evaluatedCriteriaIds: [criteriaId],
      });
    },
  );
}

async function evaluate(monitor: Monitor): Promise<MonitorEvaluationSummary> {
  findOneByIdMock.mockResolvedValue(monitor);

  const response: ProbeApiIngestResponse =
    await MonitorResourceUtil.monitorResource(metricResult(monitor));

  return response.evaluationSummary!;
}

function eventTitles(summary: MonitorEvaluationSummary): Array<string> {
  return summary.events.map((event: MonitorEvaluationEvent): string => {
    return `${event.type}: ${event.title}`;
  });
}

function databaseIdsOf(model: Incident | Alert): Array<string> {
  return (model.databaseServers || []).map(
    (databaseServer: DatabaseServer): string => {
      return String(databaseServer._id || databaseServer.id);
    },
  );
}

describe("MonitorResourceUtil.monitorResource: scheduled maintenance on a database", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    maintenanceEvents = [];
    createdIncidents = [];
    createdAlerts = [];

    lockMock.mockResolvedValue({});

    /*
     * Honours the two parts of the maintenance query that decide the
     * outcome: the project, and whether the event is ongoing right now.
     */
    jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockImplementation((args: unknown): Promise<never> => {
        const query: {
          projectId?: ObjectID;
          currentScheduledMaintenanceState?: { isOngoingState?: boolean };
        } = (args as { query: Record<string, never> }).query;

        const onlyOngoing: boolean =
          query.currentScheduledMaintenanceState?.isOngoingState === true;

        return Promise.resolve(
          maintenanceEvents
            .filter((event: FakeMaintenanceEvent): boolean => {
              return (
                event.projectId === query.projectId?.toString() &&
                (!onlyOngoing || event.state === "ongoing")
              );
            })
            .map(toScheduledMaintenance) as never,
        );
      });

    // Project-scoped id lookups, as SeriesResourceLinker issues them.
    jest
      .spyOn(DatabaseServerService, "findBy")
      .mockImplementation((args: unknown): Promise<never> => {
        const query: { projectId?: ObjectID; _id?: unknown } = (
          args as { query: Record<string, never> }
        ).query;

        const wantedIds: Array<string> | null =
          query._id instanceof Includes
            ? (query._id.values as Array<unknown>).map(
                (value: unknown): string => {
                  return String(value);
                },
              )
            : null;

        return Promise.resolve(
          DATABASE_ROWS.filter(
            (row: { _id: string; projectId: string }): boolean => {
              return (
                row.projectId === query.projectId?.toString() &&
                (wantedIds === null || wantedIds.includes(row._id))
              );
            },
          ).map((row: { _id: string }): { _id: string } => {
            return { _id: row._id };
          }) as never,
        );
      });

    jest
      .spyOn(DatabaseServerEndpointService, "findBy")
      .mockResolvedValue([] as never);

    // The status keeps tracking reality during the window: recorded, not stubbed away.
    statusTimelineSpy = jest
      .spyOn(MonitorStatusTimelineUtil, "updateMonitorStatusTimeline")
      .mockResolvedValue(null) as unknown as SpyLike;

    jest.spyOn(MonitorSummaryCapture, "capture").mockResolvedValue(null);

    // The resolve pass runs for real; nothing is open.
    resolveIncidentsSpy = jest.spyOn(
      MonitorIncident,
      "checkOpenIncidentsAndCloseIfResolved",
    ) as unknown as SpyLike;
    resolveAlertsSpy = jest.spyOn(
      MonitorAlert,
      "checkOpenAlertsAndCloseIfResolved",
    ) as unknown as SpyLike;
    jest.spyOn(IncidentService, "findBy").mockResolvedValue([] as never);
    jest.spyOn(AlertService, "findBy").mockResolvedValue([] as never);

    jest
      .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
      .mockResolvedValue(true);

    jest
      .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
      .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] });

    jest
      .spyOn(IncidentService, "create")
      .mockImplementation(async (createBy: unknown): Promise<Incident> => {
        const incident: Incident = (createBy as { data: Incident }).data;
        incident._id = ObjectID.generate().toString();
        createdIncidents.push(incident);
        return incident;
      });

    jest
      .spyOn(AlertService, "create")
      .mockImplementation(async (createBy: unknown): Promise<Alert> => {
        const alert: Alert = (createBy as { data: Alert }).data;
        alert._id = ObjectID.generate().toString();
        createdAlerts.push(alert);
        return alert;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("a monitor filtered on oneuptime.database.server.id", () => {
    test.each([
      ENGINE_METRICS_STOPPED,
      "database-postgresql-connections-exhausted",
      "database-mysql-restarted",
    ])(
      "%s opens no incident and no alert while its database is in an ongoing maintenance window",
      async (templateId: string) => {
        maintenanceEvents = [ongoingWindow({ databaseServerIds: [ORDERS_DB] })];

        const monitor: Monitor = monitorWithStep(
          templateStep({ templateId: templateId, databaseServerId: ORDERS_DB }),
        );
        breachUngrouped(monitor);

        const summary: MonitorEvaluationSummary = await evaluate(monitor);

        expect(createdIncidents).toEqual([]);
        expect(createdAlerts).toEqual([]);

        // What the monitor did NOT create is on its evaluation summary.
        expect(eventTitles(summary)).toEqual(
          expect.arrayContaining([
            "incident-skipped: Incident suppressed by scheduled maintenance",
            "alert-skipped: Alert suppressed by scheduled maintenance",
          ]),
        );
        expect(
          summary.events.filter((event: MonitorEvaluationEvent): boolean => {
            return (
              event.type === "incident-created" ||
              event.type === "alert-created"
            );
          }),
        ).toEqual([]);
      },
    );

    test("only creation is silenced: the status timeline and the resolve pass still run", async () => {
      maintenanceEvents = [ongoingWindow({ databaseServerIds: [ORDERS_DB] })];

      const monitor: Monitor = monitorWithStep(
        templateStep({
          templateId: ENGINE_METRICS_STOPPED,
          databaseServerId: ORDERS_DB,
        }),
      );
      breachUngrouped(monitor);

      await evaluate(monitor);

      expect(createdIncidents).toEqual([]);
      expect(createdAlerts).toEqual([]);

      expect(statusTimelineSpy.mock.calls).toHaveLength(1);
      expect(
        (
          statusTimelineSpy.mock.calls[0]![0] as {
            criteriaInstance: MonitorCriteriaInstance;
          }
        ).criteriaInstance,
      ).toBe(breachCriteria(monitor));

      expect(resolveIncidentsSpy.mock.calls).toHaveLength(1);
      expect(resolveAlertsSpy.mock.calls).toHaveLength(1);
    });

    test("the same breach opens an incident and an alert once the window has ended", async () => {
      const window: FakeMaintenanceEvent = ongoingWindow({
        databaseServerIds: [ORDERS_DB],
      });
      maintenanceEvents = [window];

      const monitor: Monitor = monitorWithStep(
        templateStep({
          templateId: ENGINE_METRICS_STOPPED,
          databaseServerId: ORDERS_DB,
        }),
      );
      breachUngrouped(monitor);

      await evaluate(monitor);

      expect(createdIncidents).toHaveLength(0);
      expect(createdAlerts).toHaveLength(0);

      // The upgrade is done and the event moves to Ended.
      window.state = "ended";

      const summary: MonitorEvaluationSummary = await evaluate(monitor);

      expect(createdIncidents).toHaveLength(1);
      expect(createdAlerts).toHaveLength(1);

      // Created for, and attached to, the database the monitor watches.
      expect(databaseIdsOf(createdIncidents[0]!)).toEqual([ORDERS_DB]);
      expect(databaseIdsOf(createdAlerts[0]!)).toEqual([ORDERS_DB]);
      expect(createdIncidents[0]!.createdCriteriaId).toBe(
        breachCriteria(monitor).data!.id,
      );

      expect(eventTitles(summary)).not.toEqual(
        expect.arrayContaining([
          "incident-skipped: Incident suppressed by scheduled maintenance",
        ]),
      );
    });

    test("a window that has not started yet silences nothing", async () => {
      maintenanceEvents = [
        {
          ...ongoingWindow({ databaseServerIds: [ORDERS_DB] }),
          state: "scheduled",
        },
      ];

      const monitor: Monitor = monitorWithStep(
        templateStep({
          templateId: ENGINE_METRICS_STOPPED,
          databaseServerId: ORDERS_DB,
        }),
      );
      breachUngrouped(monitor);

      await evaluate(monitor);

      expect(createdIncidents).toHaveLength(1);
      expect(createdAlerts).toHaveLength(1);
    });

    test("maintenance on another database leaves it alerting", async () => {
      maintenanceEvents = [ongoingWindow({ databaseServerIds: [BILLING_DB] })];

      const monitor: Monitor = monitorWithStep(
        templateStep({
          templateId: ENGINE_METRICS_STOPPED,
          databaseServerId: ORDERS_DB,
        }),
      );
      breachUngrouped(monitor);

      await evaluate(monitor);

      expect(createdIncidents).toHaveLength(1);
      expect(createdAlerts).toHaveLength(1);
      expect(databaseIdsOf(createdIncidents[0]!)).toEqual([ORDERS_DB]);
    });

    test("maintenance on a resource of another type leaves it alerting", async () => {
      maintenanceEvents = [ongoingWindow({ hostIds: [WEB_HOST] })];

      const monitor: Monitor = monitorWithStep(
        templateStep({
          templateId: ENGINE_METRICS_STOPPED,
          databaseServerId: ORDERS_DB,
        }),
      );
      breachUngrouped(monitor);

      await evaluate(monitor);

      expect(createdIncidents).toHaveLength(1);
      expect(createdAlerts).toHaveLength(1);
    });

    test("the same database id under maintenance in another project leaves it alerting", async () => {
      maintenanceEvents = [
        ongoingWindow({
          databaseServerIds: [ORDERS_DB],
          projectId: OTHER_PROJECT_ID,
        }),
      ];

      const monitor: Monitor = monitorWithStep(
        templateStep({
          templateId: ENGINE_METRICS_STOPPED,
          databaseServerId: ORDERS_DB,
        }),
      );
      breachUngrouped(monitor);

      await evaluate(monitor);

      expect(createdIncidents).toHaveLength(1);
      expect(createdAlerts).toHaveLength(1);
    });

    test("a database's window does not silence the monitor of a database outside it", async () => {
      maintenanceEvents = [ongoingWindow({ databaseServerIds: [ORDERS_DB] })];

      const ordersMonitor: Monitor = monitorWithStep(
        templateStep({
          templateId: ENGINE_METRICS_STOPPED,
          databaseServerId: ORDERS_DB,
        }),
      );
      breachUngrouped(ordersMonitor);
      await evaluate(ordersMonitor);

      expect(createdIncidents).toHaveLength(0);

      const billingMonitor: Monitor = monitorWithStep(
        templateStep({
          templateId: ENGINE_METRICS_STOPPED,
          databaseServerId: BILLING_DB,
        }),
      );
      breachUngrouped(billingMonitor);
      await evaluate(billingMonitor);

      expect(createdIncidents).toHaveLength(1);
      expect(createdAlerts).toHaveLength(1);
      expect(databaseIdsOf(createdIncidents[0]!)).toEqual([BILLING_DB]);
      expect(databaseIdsOf(createdAlerts[0]!)).toEqual([BILLING_DB]);
    });
  });

  describe("a monitor grouped by oneuptime.database.server.id (names no database itself)", () => {
    test("keeps alerting on every database outside the window, series by series", async () => {
      maintenanceEvents = [ongoingWindow({ databaseServerIds: [ORDERS_DB] })];

      const monitor: Monitor = monitorWithStep(groupedFleetStep());
      breachPerDatabase(monitor, [ORDERS_DB, BILLING_DB]);

      const summary: MonitorEvaluationSummary = await evaluate(monitor);

      expect(
        createdIncidents.map((incident: Incident): string | undefined => {
          return incident.seriesFingerprint;
        }),
      ).toEqual([`fp-${BILLING_DB}`]);
      expect(
        createdAlerts.map((alert: Alert): string | undefined => {
          return alert.seriesFingerprint;
        }),
      ).toEqual([`fp-${BILLING_DB}`]);

      // The skip is the per-series one, not the whole-monitor one.
      expect(
        summary.events
          .filter((event: MonitorEvaluationEvent): boolean => {
            return (
              event.title === "Incident suppressed by scheduled maintenance"
            );
          })
          .map((event: MonitorEvaluationEvent): string | undefined => {
            return event.message;
          }),
      ).toEqual([
        "Skipped creating an incident because the resource for this series is under an active scheduled maintenance window.",
      ]);
    });

    test("alerts on every series once the window has ended", async () => {
      const window: FakeMaintenanceEvent = ongoingWindow({
        databaseServerIds: [ORDERS_DB],
      });
      window.state = "ended";
      maintenanceEvents = [window];

      const monitor: Monitor = monitorWithStep(groupedFleetStep());
      breachPerDatabase(monitor, [ORDERS_DB, BILLING_DB]);

      await evaluate(monitor);

      expect(
        createdIncidents
          .map((incident: Incident): string | undefined => {
            return incident.seriesFingerprint;
          })
          .sort(),
      ).toEqual([`fp-${ORDERS_DB}`, `fp-${BILLING_DB}`].sort());
      expect(createdAlerts).toHaveLength(2);
    });
  });
});
