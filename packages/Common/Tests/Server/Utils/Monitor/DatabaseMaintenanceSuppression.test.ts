/*
 * PasswordHash fails to COMPILE under ts-jest (TS 5.9 + @types/node Buffer
 * mismatch) and DatabaseService (which every concrete service used below
 * extends) imports it. Nothing password-related is under test here, so the
 * module is replaced WITH A FACTORY — an automock would still require (and
 * type-check) the real file.
 */
jest.mock("../../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import DatabaseServer from "../../../../Models/DatabaseModels/DatabaseServer";
import Host from "../../../../Models/DatabaseModels/Host";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import Service from "../../../../Models/DatabaseModels/Service";
import DatabaseServerEndpointService from "../../../../Server/Services/DatabaseServerEndpointService";
import DatabaseServerService from "../../../../Server/Services/DatabaseServerService";
import HostService from "../../../../Server/Services/HostService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import MonitorMaintenanceSuppression, {
  MaintainedResourceKeys,
  MonitorMaintenanceSuppressionResult,
} from "../../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import { SeriesResolvedResourceIds } from "../../../../Server/Utils/Monitor/SeriesResourceLinker";
import { JSONObject } from "../../../../Types/JSON";
import {
  DatabaseAlertTemplate,
  getDatabaseAlertTemplateById,
} from "../../../../Types/Monitor/DatabaseAlertTemplates";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationEvent,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import SqlDatabaseType from "../../../../Types/Monitor/SqlDatabaseType";
import ObjectID from "../../../../Types/ObjectID";
import { PerSeriesCriteriaMatch } from "../../../../Types/Probe/ProbeApiIngestResponse";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A team attaches orders-db to a scheduled maintenance window to upgrade
 * PostgreSQL. The engine stops for fifteen minutes, and "Engine Metrics
 * Stopped" — Critical, opens an incident, pages on-call — must NOT page.
 *
 * Every monitor the database's Recommendations tab creates is UNGROUPED and
 * scoped by the `oneuptime.database.server.id` filter, and so is every
 * monitor built from a database chart; a Database Health or SQL Query probe
 * names its database by host:port. None of them has series labels, so the
 * per-series maintenance suppression (which reads a breaching series'
 * labels) never saw them, and the monitor-level flag only covers monitors
 * attached to the event itself. These tests pin the whole-monitor half:
 * the monitor's OWN configuration names the database, and a database under
 * maintenance silences it — while status tracking and the resolve path stay
 * untouched (the caller skips creation only).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const ORDERS_DB: string = "d0000000-0000-4000-8000-00000000000a";
const BILLING_DB: string = "d0000000-0000-4000-8000-00000000000b";
const CHECKOUT_SERVICE: string = "5e000000-0000-4000-8000-000000000001";
const WEB_HOST: string = "40000000-0000-4000-8000-000000000001";

function emptyMaintained(): MaintainedResourceKeys {
  return {
    hosts: { ids: new Set<string>(), names: new Set<string>() },
    dockerHosts: { ids: new Set<string>(), names: new Set<string>() },
    podmanHosts: { ids: new Set<string>(), names: new Set<string>() },
    kubernetesClusters: { ids: new Set<string>(), names: new Set<string>() },
    proxmoxClusters: { ids: new Set<string>(), names: new Set<string>() },
    vmwareVCenters: { ids: new Set<string>(), names: new Set<string>() },
    cephClusters: { ids: new Set<string>(), names: new Set<string>() },
    dockerSwarmClusters: { ids: new Set<string>(), names: new Set<string>() },
    iotFleets: { ids: new Set<string>(), names: new Set<string>() },
    services: { ids: new Set<string>(), names: new Set<string>() },
    databaseServers: { ids: new Set<string>(), names: new Set<string>() },
  };
}

function resolved(
  overrides: Partial<SeriesResolvedResourceIds>,
): SeriesResolvedResourceIds {
  return {
    ...MonitorResourceContextUtil.emptyContext(),
    ...overrides,
  };
}

function monitorWithStep(
  monitorType: MonitorType,
  stepData: JSONObject,
): Monitor {
  const step: MonitorStep = new MonitorStep();
  step.data = { ...step.data, ...stepData } as MonitorStep["data"];

  return monitorWithSteps(monitorType, [step]);
}

function monitorWithSteps(
  monitorType: MonitorType,
  steps: Array<MonitorStep>,
): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.monitorType = monitorType;
  monitor.projectId = PROJECT_ID;
  monitor.monitorSteps = new MonitorSteps();
  monitor.monitorSteps.data = {
    monitorStepsInstanceArray: steps,
    defaultMonitorStatusId: ObjectID.generate(),
  };
  return monitor;
}

// The monitor the Recommendations tab creates for a database.
function templateMonitor(
  templateId: string,
  databaseServerId: string,
): Monitor {
  const template: DatabaseAlertTemplate =
    getDatabaseAlertTemplateById(templateId)!;

  return monitorWithSteps(template.monitorType, [
    template.getMonitorStep({
      databaseServerId: databaseServerId,
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "PostgreSQL orders-db:5432",
    }),
  ]);
}

function ongoingEvent(input: {
  databaseServerIds?: Array<string>;
  serviceIds?: Array<string>;
  hostIds?: Array<string>;
}): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event._id = "e0000000-0000-4000-8000-000000000001";
  event.databaseServers = (input.databaseServerIds || []).map(
    (id: string): DatabaseServer => {
      const databaseServer: DatabaseServer = new DatabaseServer();
      databaseServer._id = id;
      return databaseServer;
    },
  );
  event.services = (input.serviceIds || []).map((id: string): Service => {
    const service: Service = new Service();
    service._id = id;
    service.name = "checkout";
    return service;
  });
  event.hosts = (input.hostIds || []).map((id: string): Host => {
    const host: Host = new Host();
    host._id = id;
    host.hostIdentifier = "web-1";
    return host;
  });
  return event;
}

describe("MonitorMaintenanceSuppression.getSuppressingDatabaseServerIds (pure)", () => {
  test("a monitor naming one database under maintenance is suppressed by it", () => {
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.databaseServers.ids.add(ORDERS_DB);

    expect(
      MonitorMaintenanceSuppression.getSuppressingDatabaseServerIds({
        resolved: resolved({ databaseServerIds: [ORDERS_DB] }),
        maintained: maintained,
      }),
    ).toEqual([ORDERS_DB]);
  });

  test("maintenance on ANOTHER database suppresses nothing", () => {
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.databaseServers.ids.add(BILLING_DB);

    expect(
      MonitorMaintenanceSuppression.getSuppressingDatabaseServerIds({
        resolved: resolved({ databaseServerIds: [ORDERS_DB] }),
        maintained: maintained,
      }),
    ).toEqual([]);
  });

  test("a monitor naming two databases is silenced only while BOTH are under maintenance", () => {
    /*
     * An ungrouped monitor cannot say which database breached: silencing it
     * for one would hide an outage on the other.
     */
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.databaseServers.ids.add(ORDERS_DB);

    expect(
      MonitorMaintenanceSuppression.getSuppressingDatabaseServerIds({
        resolved: resolved({ databaseServerIds: [ORDERS_DB, BILLING_DB] }),
        maintained: maintained,
      }),
    ).toEqual([]);

    maintained.databaseServers.ids.add(BILLING_DB);

    expect(
      MonitorMaintenanceSuppression.getSuppressingDatabaseServerIds({
        resolved: resolved({ databaseServerIds: [ORDERS_DB, BILLING_DB] }),
        maintained: maintained,
      }),
    ).toEqual([ORDERS_DB, BILLING_DB]);
  });

  test("a monitor that also names a resource NOT under maintenance keeps alerting", () => {
    // "Failed calls from checkout to orders-db": checkout is not in the window.
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.databaseServers.ids.add(ORDERS_DB);

    expect(
      MonitorMaintenanceSuppression.getSuppressingDatabaseServerIds({
        resolved: resolved({
          databaseServerIds: [ORDERS_DB],
          serviceIds: [CHECKOUT_SERVICE],
        }),
        maintained: maintained,
      }),
    ).toEqual([]);

    maintained.services.ids.add(CHECKOUT_SERVICE);

    expect(
      MonitorMaintenanceSuppression.getSuppressingDatabaseServerIds({
        resolved: resolved({
          databaseServerIds: [ORDERS_DB],
          serviceIds: [CHECKOUT_SERVICE],
        }),
        maintained: maintained,
      }),
    ).toEqual([ORDERS_DB]);
  });

  test("a monitor naming no database is left to the existing rules", () => {
    // Whole-monitor suppression is scoped to monitors that name a database.
    const maintained: MaintainedResourceKeys = emptyMaintained();
    maintained.hosts.ids.add(WEB_HOST);

    expect(
      MonitorMaintenanceSuppression.getSuppressingDatabaseServerIds({
        resolved: resolved({ hostIds: [WEB_HOST] }),
        maintained: maintained,
      }),
    ).toEqual([]);
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpyLike = any;

describe("MonitorMaintenanceSuppression.getMaintenanceSuppression", () => {
  let events: Array<ScheduledMaintenance>;
  let databaseRows: Array<{ _id: string }>;
  let endpointRows: Array<{ databaseServerId?: ObjectID | undefined }>;
  let maintenanceSpy: SpyLike;
  let databaseSpy: SpyLike;

  beforeEach(() => {
    events = [];
    databaseRows = [];
    endpointRows = [];

    maintenanceSpy = jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockImplementation((): Promise<never> => {
        return Promise.resolve(events as never);
      });

    databaseSpy = jest
      .spyOn(DatabaseServerService, "findBy")
      .mockImplementation((): Promise<never> => {
        return Promise.resolve(databaseRows as never);
      });

    jest
      .spyOn(DatabaseServerEndpointService, "findBy")
      .mockImplementation((): Promise<never> => {
        return Promise.resolve(endpointRows as never);
      });

    jest.spyOn(HostService, "findBy").mockImplementation((): Promise<never> => {
      return Promise.resolve([] as never);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    "database-postgresql-engine-metrics-stopped",
    "database-postgresql-connections-exhausted",
    "database-mysql-restarted",
  ])(
    "the recommended monitor %s is silenced by its database's maintenance",
    async (templateId: string) => {
      events = [ongoingEvent({ databaseServerIds: [ORDERS_DB] })];
      databaseRows = [{ _id: ORDERS_DB }];

      const result: MonitorMaintenanceSuppressionResult =
        await MonitorMaintenanceSuppression.getMaintenanceSuppression({
          monitor: templateMonitor(templateId, ORDERS_DB),
        });

      expect(result.suppressingDatabaseServerIds).toEqual([ORDERS_DB]);
      expect(MonitorMaintenanceSuppression.isMonitorSuppressed(result)).toBe(
        true,
      );
    },
  );

  test("maintenance on another database leaves the monitor alerting", async () => {
    events = [ongoingEvent({ databaseServerIds: [BILLING_DB] })];
    databaseRows = [{ _id: ORDERS_DB }];

    const result: MonitorMaintenanceSuppressionResult =
      await MonitorMaintenanceSuppression.getMaintenanceSuppression({
        monitor: templateMonitor(
          "database-postgresql-engine-metrics-stopped",
          ORDERS_DB,
        ),
      });

    expect(MonitorMaintenanceSuppression.isMonitorSuppressed(result)).toBe(
      false,
    );
  });

  test("a Database Health probe is silenced through the endpoint it connects to", async () => {
    events = [ongoingEvent({ databaseServerIds: [ORDERS_DB] })];
    endpointRows = [{ databaseServerId: new ObjectID(ORDERS_DB) }];

    const result: MonitorMaintenanceSuppressionResult =
      await MonitorMaintenanceSuppression.getMaintenanceSuppression({
        monitor: monitorWithStep(MonitorType.Database, {
          databaseMonitor: {
            databaseType: SqlDatabaseType.PostgreSQL,
            host: "orders-db.example.com",
            port: 5432,
            databaseName: "orders",
          },
        }),
      });

    expect(result.suppressingDatabaseServerIds).toEqual([ORDERS_DB]);
  });

  test("a database id that no longer resolves in this project suppresses nothing", async () => {
    // A deleted database, or an id pasted from another project.
    events = [ongoingEvent({ databaseServerIds: [ORDERS_DB] })];
    databaseRows = [];

    const result: MonitorMaintenanceSuppressionResult =
      await MonitorMaintenanceSuppression.getMaintenanceSuppression({
        monitor: templateMonitor(
          "database-postgresql-engine-metrics-stopped",
          ORDERS_DB,
        ),
      });

    expect(MonitorMaintenanceSuppression.isMonitorSuppressed(result)).toBe(
      false,
    );
  });

  test("costs no query at all for a monitor that names no database and has no series", async () => {
    const result: MonitorMaintenanceSuppressionResult =
      await MonitorMaintenanceSuppression.getMaintenanceSuppression({
        monitor: monitorWithStep(MonitorType.Host, {
          hostMonitor: { hostIdentifier: "web-1" },
        }),
      });

    expect(MonitorMaintenanceSuppression.isMonitorSuppressed(result)).toBe(
      false,
    );
    expect(result.suppressedSeriesFingerprints.size).toBe(0);
    expect(maintenanceSpy).not.toHaveBeenCalled();
    expect(databaseSpy).not.toHaveBeenCalled();
  });

  test("skips resolving the monitor's database when no database is under maintenance", async () => {
    events = [ongoingEvent({ hostIds: [WEB_HOST] })];

    const result: MonitorMaintenanceSuppressionResult =
      await MonitorMaintenanceSuppression.getMaintenanceSuppression({
        monitor: templateMonitor(
          "database-postgresql-engine-metrics-stopped",
          ORDERS_DB,
        ),
      });

    expect(MonitorMaintenanceSuppression.isMonitorSuppressed(result)).toBe(
      false,
    );
    expect(maintenanceSpy).toHaveBeenCalledTimes(1);
    expect(databaseSpy).not.toHaveBeenCalled();
  });

  test("a grouped evaluation keeps its per-series suppression, on the same single maintenance query", async () => {
    events = [ongoingEvent({ databaseServerIds: [BILLING_DB] })];

    const matchesPerSeries: Array<PerSeriesCriteriaMatch> = [
      {
        criteriaMetId: "criteria-1",
        fingerprint: "fp-billing",
        labels: { "oneuptime.database.server.id": BILLING_DB },
        rootCause: "breached",
      },
      {
        criteriaMetId: "criteria-1",
        fingerprint: "fp-orders",
        labels: { "oneuptime.database.server.id": ORDERS_DB },
        rootCause: "breached",
      },
    ];

    const result: MonitorMaintenanceSuppressionResult =
      await MonitorMaintenanceSuppression.getMaintenanceSuppression({
        monitor: monitorWithStep(MonitorType.Metrics, {
          metricMonitor: {
            metricViewConfig: {
              queryConfigs: [
                {
                  metricQueryData: {
                    filterData: {
                      metricName: "postgresql.backends",
                      attributes: {},
                    },
                    groupBy: { "oneuptime.database.server.id": true },
                  },
                },
              ],
              formulaConfigs: [],
            },
          },
        }),
        matchesPerSeries: matchesPerSeries,
      });

    expect(Array.from(result.suppressedSeriesFingerprints)).toEqual([
      "fp-billing",
    ]);
    // The monitor itself names no database: only the one series is silenced.
    expect(MonitorMaintenanceSuppression.isMonitorSuppressed(result)).toBe(
      false,
    );
    expect(maintenanceSpy).toHaveBeenCalledTimes(1);
  });

  test("a monitor whose step JSON cannot be read is never suppressed, and never throws", async () => {
    events = [ongoingEvent({ databaseServerIds: [ORDERS_DB] })];

    const monitor: Monitor = new Monitor();
    monitor.monitorType = MonitorType.Metrics;
    monitor.projectId = PROJECT_ID;
    monitor.monitorSteps = {
      data: { monitorStepsInstanceArray: [{ data: 42 }] },
    } as unknown as MonitorSteps;

    const result: MonitorMaintenanceSuppressionResult =
      await MonitorMaintenanceSuppression.getMaintenanceSuppression({
        monitor: monitor,
      });

    expect(MonitorMaintenanceSuppression.isMonitorSuppressed(result)).toBe(
      false,
    );
  });
});

describe("MonitorMaintenanceSuppression.recordMonitorSuppressed", () => {
  function criteria(input: {
    createIncidents: boolean;
    createAlerts: boolean;
  }): MonitorCriteriaInstance {
    const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
    instance.data = {
      ...instance.data!,
      id: "criteria-1",
      createIncidents: input.createIncidents,
      createAlerts: input.createAlerts,
    };
    return instance;
  }

  function summary(): MonitorEvaluationSummary {
    return { evaluatedAt: new Date(), criteriaResults: [], events: [] };
  }

  const suppression: MonitorMaintenanceSuppressionResult = {
    suppressedSeriesFingerprints: new Set<string>(),
    suppressingDatabaseServerIds: [ORDERS_DB],
  };

  test("records one skipped incident and one skipped alert, naming maintenance", () => {
    const evaluationSummary: MonitorEvaluationSummary = summary();

    MonitorMaintenanceSuppression.recordMonitorSuppressed({
      evaluationSummary: evaluationSummary,
      criteriaInstance: criteria({ createIncidents: true, createAlerts: true }),
      suppression: suppression,
    });

    expect(
      evaluationSummary.events.map((event: MonitorEvaluationEvent) => {
        return [event.type, event.relatedCriteriaId];
      }),
    ).toEqual([
      ["incident-skipped", "criteria-1"],
      ["alert-skipped", "criteria-1"],
    ]);

    for (const event of evaluationSummary.events) {
      expect(event.title).toMatch(/scheduled maintenance/i);
      expect(event.message).toMatch(/database/i);
      // Status tracking and the resolve path are not part of the skip.
      expect(event.message).toMatch(/still/i);
    }
  });

  test("records only what the criteria would have created", () => {
    const evaluationSummary: MonitorEvaluationSummary = summary();

    MonitorMaintenanceSuppression.recordMonitorSuppressed({
      evaluationSummary: evaluationSummary,
      criteriaInstance: criteria({
        createIncidents: false,
        createAlerts: true,
      }),
      suppression: suppression,
    });

    expect(
      evaluationSummary.events.map((event: MonitorEvaluationEvent) => {
        return event.type;
      }),
    ).toEqual(["alert-skipped"]);
  });

  test("tolerates a missing evaluation summary", () => {
    expect(() => {
      MonitorMaintenanceSuppression.recordMonitorSuppressed({
        evaluationSummary: undefined,
        criteriaInstance: criteria({
          createIncidents: true,
          createAlerts: true,
        }),
        suppression: suppression,
      });
    }).not.toThrow();
  });
});
