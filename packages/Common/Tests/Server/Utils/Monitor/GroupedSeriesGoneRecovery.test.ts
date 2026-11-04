/*
 * MonitorResource reaches the native isolated-vm addon through the criteria
 * evaluator's sandbox runner. Nothing here runs a sandbox, and the prebuilt
 * binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorLogUtil from "../../../../Server/Utils/Monitor/MonitorLogUtil";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import MonitorSummaryCapture from "../../../../Server/Utils/Monitor/MonitorSummaryCapture";
import MonitorMaintenanceSuppression from "../../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import MonitorDependencySuppression from "../../../../Server/Utils/Monitor/MonitorDependencySuppression";
import GroupedSeriesGone, {
  GROUPED_SERIES_GONE_MET_NOTE,
  GROUPED_SERIES_GONE_NOT_MET_MESSAGE,
} from "../../../../Server/Utils/Monitor/GroupedSeriesGone";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import MonitorProbeService from "../../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import ProjectService from "../../../../Server/Services/ProjectService";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "../../../../Server/Utils/Logger";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import MetricsAggregationType from "../../../../Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import { getCephAlertTemplateById } from "../../../../Types/Monitor/CephAlertTemplates";
import {
  CriteriaFilter,
  FilterType,
  NoDataPolicy,
} from "../../../../Types/Monitor/CriteriaFilter";
import { getIoTAlertTemplateById } from "../../../../Types/Monitor/IotAlertTemplates";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import { MonitorEvaluationCriteriaResult } from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import { MonitorStepMetricMonitorUtil } from "../../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import {
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
} from "../../../../Types/Monitor/Recommendation/RecommendationCriteriaBuilder";
import { getStorageArrayAlertTemplateById } from "../../../../Types/Monitor/StorageArrayAlertTemplates";
import { getVMwareAlertTemplateById } from "../../../../Types/Monitor/VMwareAlertTemplates";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../../Types/RollingTime/RollingTimeUtil";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import { mockProjectStates } from "../../TestingUtils/Services/ProjectStatesHelper";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A grouped criteria that counts missing data as zero, once every series of
 * the group is gone, on the path every telemetry check takes: the worker's
 * answer goes into MonitorResourceUtil.monitorResource, through the real
 * criteria evaluator, the real status timeline and the real resolve pass.
 * Postgres and Redis are stood in for, and creating an incident or an alert is
 * stood in for by adding it to the open ones the next check reads.
 *
 * A state in a label - `status = red`, `type = SLOW_OPS`, `severity = critical`
 * - has a series only while something is in that state, so these templates
 * fire above 0 and recover at 0 with Treat As Zero: the last red host turning
 * green leaves no series at all. Such a recovery criteria held of the empty
 * window and still never matched, because a grouped monitor acts on the series
 * a criteria names, and this one names none: the incident stayed open for ever.
 *
 * A window with no series is also what a stopped collector looks like, and
 * silence is not recovery, so on an infrastructure monitor the difference is
 * what the worker read of the resource's heartbeat: resourceStillReporting.
 * What it reads is held in MonitorTelemetryMonitorResourceStillReporting.test.ts.
 */

const NOW: Date = new Date(Date.UTC(2026, 9, 30, 12, 10, 30));
const FIRST_BUCKET_MS: number = Date.UTC(2026, 9, 30, 12, 5, 0);
const MINUTE_MS: number = 60_000;

const ONLINE: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OFFLINE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const RESOLVED_STATE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const STEP_ARGS: {
  vcenterIdentifier: string;
  clusterIdentifier: string;
  arrayIdentifier: string;
  fleetIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
} = {
  vcenterIdentifier: "vcenter-01",
  clusterIdentifier: "ceph-01",
  arrayIdentifier: "array-01",
  fleetIdentifier: "fleet-01",
  onlineMonitorStatusId: ONLINE,
  offlineMonitorStatusId: OFFLINE,
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "Grouped check",
};

interface GroupedTemplateCase {
  name: string;
  monitorType: MonitorType;
  step: () => MonitorStep;
  // The labels of the one series that fires, then goes.
  labels: JSONObject;
}

// The templates named in the report, and the storage arrays', the other product with them.
const VMWARE_CASE: GroupedTemplateCase = {
  name: "VMware Datacenter Hosts Unhealthy",
  monitorType: MonitorType.VMware,
  step: (): MonitorStep => {
    return getVMwareAlertTemplateById(
      "vmware-datacenter-hosts-unhealthy",
    )!.getMonitorStep(STEP_ARGS);
  },
  labels: { "resource.vcenter.datacenter.name": "dc-01" },
};

const CEPH_CASE: GroupedTemplateCase = {
  name: "Ceph Daemon Slow Operations",
  monitorType: MonitorType.Ceph,
  step: (): MonitorStep => {
    return getCephAlertTemplateById("ceph-daemon-slow-ops")!.getMonitorStep(
      STEP_ARGS,
    );
  },
  labels: { ceph_daemon: "osd.3" },
};

const STORAGE_ARRAY_CASE: GroupedTemplateCase = {
  name: "Pure FlashArray Critical Array Alert",
  monitorType: MonitorType.StorageArray,
  step: (): MonitorStep => {
    return getStorageArrayAlertTemplateById(
      "purefa-critical-alerts",
    )!.getMonitorStep(STEP_ARGS);
  },
  labels: { summary: "Controller failed" },
};

const CASE_ROWS: Array<[string, GroupedTemplateCase]> = [
  VMWARE_CASE,
  CEPH_CASE,
  STORAGE_ARRAY_CASE,
].map((testCase: GroupedTemplateCase): [string, GroupedTemplateCase] => {
  return [testCase.name, testCase];
});

let monitor: Monitor;
let step: MonitorStep;
let openIncidents: Array<Incident>;
let openAlerts: Array<Alert>;
let incidentRootCauses: Array<string | undefined>;
let alertRootCauses: Array<string | undefined>;
let statusChangeRootCauses: Array<string | undefined>;

function useMonitor(monitorType: MonitorType, monitorStep: MonitorStep): void {
  step = monitorStep;
  monitor = new Monitor();
  monitor.id = MONITOR_ID;
  monitor.projectId = PROJECT_ID;
  monitor.name = "Grouped check";
  monitor.monitorType = monitorType;
  monitor.currentMonitorStatusId = ONLINE;

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE,
  };
  monitor.monitorSteps = monitorSteps;
}

function fireCriteria(): MonitorCriteriaInstance {
  return step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!;
}

function recoverCriteria(): MonitorCriteriaInstance {
  return step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[1]!;
}

// A value for every minute of the 5-minute window, so "All Values" is covered.
function buildPoints(value: number): Array<AggregateModel> {
  return [0, 1, 2, 3, 4, 5].map((minute: number): AggregateModel => {
    return {
      timestamp: new Date(FIRST_BUCKET_MS + minute * MINUTE_MS),
      value: value,
    } as AggregateModel;
  });
}

function buildSeries(labels: JSONObject, value: number): MetricSeriesResult {
  return {
    fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
    labels: labels,
    aggregatedResults: [{ data: buildPoints(value) }],
  };
}

// A grouped check that read these series, as the worker hands it over.
function check(
  series: Array<MetricSeriesResult>,
  extra?: Partial<MetricMonitorResponse>,
): MetricMonitorResponse {
  const view: MetricsViewConfig = MonitorStep.getMetricsViewConfig(step)!;

  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    metricViewConfig: view,
    metricResult: view.queryConfigs.map((): AggregatedResult => {
      return {
        data: series.flatMap(
          (entry: MetricSeriesResult): Array<AggregateModel> => {
            return entry.aggregatedResults[0]!.data;
          },
        ),
      };
    }),
    seriesBreakdown: series,
    startAndEndDate: RollingTimeUtil.convertToStartAndEndDate(
      RollingTime.Past5Minutes,
      NOW,
    ),
    ...extra,
  };
}

function firingCheck(labels: JSONObject): MetricMonitorResponse {
  return check([buildSeries(labels, 1)]);
}

// Every series gone, and what the worker found of the resource's heartbeat.
function goneCheck(extra: {
  resourceStillReporting?: boolean | undefined;
}): MetricMonitorResponse {
  return check([], extra);
}

async function ingest(
  response: MetricMonitorResponse,
): Promise<ProbeApiIngestResponse> {
  return MonitorResourceUtil.monitorResource(response);
}

function expectOffline(): void {
  expect(monitor.currentMonitorStatusId!.toString()).toBe(OFFLINE.toString());
}

function expectOnline(): void {
  expect(monitor.currentMonitorStatusId!.toString()).toBe(ONLINE.toString());
}

function resultOf(
  response: ProbeApiIngestResponse,
  criteria: MonitorCriteriaInstance,
): MonitorEvaluationCriteriaResult {
  return response.evaluationSummary!.criteriaResults.find(
    (result: MonitorEvaluationCriteriaResult) => {
      return result.criteriaId === criteria.data!.id;
    },
  )!;
}

function buildIncident(input: {
  criteria: MonitorCriteriaInstance;
  match?: PerSeriesCriteriaMatch | undefined;
}): Incident {
  const incident: Incident = new Incident();
  incident._id = ObjectID.generate().toString();
  incident.projectId = PROJECT_ID;
  incident.title = "Opened";
  incident.createdCriteriaId = input.criteria.data!.id!;
  incident.createdIncidentTemplateId = input.criteria.data!.incidents[0]!.id!;

  if (input.match) {
    incident.seriesFingerprint = input.match.fingerprint;
    incident.seriesLabels = input.match.labels;
  }

  return incident;
}

function buildAlert(input: {
  criteria: MonitorCriteriaInstance;
  match?: PerSeriesCriteriaMatch | undefined;
}): Alert {
  const alert: Alert = new Alert();
  alert._id = ObjectID.generate().toString();
  alert.projectId = PROJECT_ID;
  alert.title = "Opened";
  alert.createdCriteriaId = input.criteria.data!.id!;

  if (input.match) {
    alert.seriesFingerprint = input.match.fingerprint;
    alert.seriesLabels = input.match.labels;
  }

  return alert;
}

interface CreatorInput {
  criteriaInstance: MonitorCriteriaInstance;
  matchesPerSeries?: Array<PerSeriesCriteriaMatch> | undefined;
}

describe("A grouped criteria that counts missing data as zero, once every series is gone", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    mockProjectStates();
    openIncidents = [];
    openAlerts = [];
    incidentRootCauses = [];
    alertRootCauses = [];
    statusChangeRootCauses = [];

    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
    jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
    jest.spyOn(MonitorService, "findOneById").mockImplementation(() => {
      return Promise.resolve(monitor) as never;
    });
    jest
      .spyOn(MonitorService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    jest.spyOn(MonitorProbeService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(MonitorStatusService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
      .mockResolvedValue(true);
    jest
      .spyOn(MonitorMetricUtil, "saveMonitorMetrics")
      .mockResolvedValue(undefined);
    jest.spyOn(MonitorLogUtil, "saveMonitorLog").mockReturnValue(undefined);
    jest
      .spyOn(MonitorMaintenanceSuppression, "getMaintenanceSuppression")
      .mockResolvedValue({
        suppressedSeriesFingerprints: new Set<string>(),
        suppressingDatabaseServerIds: [],
      } as never);
    jest
      .spyOn(MonitorDependencySuppression, "getDependencySuppression")
      .mockResolvedValue({ isSuppressed: false } as never);
    jest
      .spyOn(MonitorSummaryCapture, "capture")
      .mockResolvedValue(null as never);
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });

    // The monitor's status, as its timeline keeps it.
    jest
      .spyOn(MonitorStatusTimelineService, "findOneBy")
      .mockImplementation(() => {
        const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
        timeline.monitorStatusId = monitor.currentMonitorStatusId!;
        return Promise.resolve(timeline) as never;
      });
    jest
      .spyOn(MonitorStatusTimelineService, "create")
      .mockImplementation((createBy: unknown) => {
        const data: { monitorStatusId: ObjectID; rootCause?: string } = (
          createBy as {
            data: { monitorStatusId: ObjectID; rootCause?: string };
          }
        ).data;
        monitor.currentMonitorStatusId = data.monitorStatusId;
        statusChangeRootCauses.push(data.rootCause);
        return Promise.resolve(new MonitorStatusTimeline()) as never;
      });

    // The records a check reads as open: what earlier checks opened.
    jest.spyOn(IncidentService, "findBy").mockImplementation(() => {
      return Promise.resolve([...openIncidents]) as never;
    });
    jest.spyOn(AlertService, "findBy").mockImplementation(() => {
      return Promise.resolve([...openAlerts]) as never;
    });

    // Resolving takes a record off the open ones.
    jest
      .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(RESOLVED_STATE_ID);
    jest
      .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(RESOLVED_STATE_ID);
    jest
      .spyOn(IncidentStateTimelineService, "create")
      .mockImplementation((createBy: unknown) => {
        const data: { incidentId: ObjectID; rootCause?: string } = (
          createBy as { data: { incidentId: ObjectID; rootCause?: string } }
        ).data;
        incidentRootCauses.push(data.rootCause);
        openIncidents = openIncidents.filter((incident: Incident) => {
          return incident.id!.toString() !== data.incidentId.toString();
        });
        return Promise.resolve(undefined) as never;
      });
    jest
      .spyOn(AlertStateTimelineService, "create")
      .mockImplementation((createBy: unknown) => {
        const data: { alertId: ObjectID; rootCause?: string } = (
          createBy as { data: { alertId: ObjectID; rootCause?: string } }
        ).data;
        alertRootCauses.push(data.rootCause);
        openAlerts = openAlerts.filter((alert: Alert) => {
          return alert.id!.toString() !== data.alertId.toString();
        });
        return Promise.resolve(undefined) as never;
      });

    /*
     * Creating adds to the open ones: one per series not open yet, or one for
     * the whole monitor when the check is not split into series.
     */
    jest
      .spyOn(
        MonitorIncident,
        "criteriaMetCreateIncidentsAndUpdateMonitorStatus",
      )
      .mockImplementation((input: unknown) => {
        const created: CreatorInput = input as CreatorInput;

        if (created.criteriaInstance.data?.createIncidents) {
          for (const match of created.matchesPerSeries ?? [undefined]) {
            const isAlreadyOpen: boolean = openIncidents.some(
              (incident: Incident) => {
                return (
                  (incident.seriesFingerprint || undefined) ===
                  match?.fingerprint
                );
              },
            );

            if (!isAlreadyOpen) {
              openIncidents.push(
                buildIncident({
                  criteria: created.criteriaInstance,
                  match: match,
                }),
              );
            }
          }
        }

        return Promise.resolve(undefined) as never;
      });
    jest
      .spyOn(MonitorAlert, "criteriaMetCreateAlertsAndUpdateMonitorStatus")
      .mockImplementation((input: unknown) => {
        const created: CreatorInput = input as CreatorInput;

        if (created.criteriaInstance.data?.createAlerts) {
          for (const match of created.matchesPerSeries ?? [undefined]) {
            const isAlreadyOpen: boolean = openAlerts.some((alert: Alert) => {
              return (
                (alert.seriesFingerprint || undefined) === match?.fingerprint
              );
            });

            if (!isAlreadyOpen) {
              openAlerts.push(
                buildAlert({
                  criteria: created.criteriaInstance,
                  match: match,
                }),
              );
            }
          }
        }

        return Promise.resolve(undefined) as never;
      });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("every series gone while the resource still reports", () => {
    test.each(CASE_ROWS)(
      "%s: the series firing opens the incident and alert, and all of them gone closes both and puts the monitor back online",
      async (_name: string, testCase: GroupedTemplateCase) => {
        useMonitor(testCase.monitorType, testCase.step());

        const firing: ProbeApiIngestResponse = await ingest(
          firingCheck(testCase.labels),
        );

        expect(firing.criteriaMetId).toBe(fireCriteria().data!.id);
        expect(openIncidents).toHaveLength(1);
        expect(openAlerts).toHaveLength(1);
        expectOffline();

        const gone: ProbeApiIngestResponse = await ingest(
          goneCheck({ resourceStillReporting: true }),
        );

        expect(gone.criteriaMetId).toBe(recoverCriteria().data!.id);
        expect(resultOf(gone, recoverCriteria()).met).toBe(true);
        expect(openIncidents).toHaveLength(0);
        expect(openAlerts).toHaveLength(0);
        expectOnline();
      },
    );

    test("what closed says which series recovered, and the status change why it counted as 0", async () => {
      useMonitor(CEPH_CASE.monitorType, CEPH_CASE.step());

      await ingest(firingCheck(CEPH_CASE.labels));
      await ingest(goneCheck({ resourceStillReporting: true }));

      expect(incidentRootCauses).toHaveLength(1);
      expect(incidentRootCauses[0]).toContain("osd.3");
      expect(incidentRootCauses[0]).toContain("Daemon Slow Ops");
      expect(alertRootCauses[0]).toContain("osd.3");

      // Offline, then online again.
      expect(statusChangeRootCauses).toHaveLength(2);
      expect(statusChangeRootCauses[1]).toContain(recoverCriteria().data!.name);
      expect(statusChangeRootCauses[1]).toContain(GROUPED_SERIES_GONE_MET_NOTE);
    });

    test("it publishes no series, so nothing is opened for them and the next firing series is judged on its own", async () => {
      useMonitor(CEPH_CASE.monitorType, CEPH_CASE.step());

      await ingest(firingCheck(CEPH_CASE.labels));

      const gone: ProbeApiIngestResponse = await ingest(
        goneCheck({ resourceStillReporting: true }),
      );

      expect(gone.perSeriesMatches).toEqual([]);
      expect(gone.matchedCriteria).toEqual([
        expect.objectContaining({
          criteriaId: recoverCriteria().data!.id,
          perSeriesMatches: [],
        }),
      ]);

      await ingest(firingCheck({ ceph_daemon: "osd.7" }));

      expect(openIncidents).toHaveLength(1);
      expect(openIncidents[0]!.seriesLabels).toEqual({
        ceph_daemon: "osd.7",
      });
      expectOffline();
    });

    test("a monitor that never had a series stays online and opens nothing", async () => {
      useMonitor(VMWARE_CASE.monitorType, VMWARE_CASE.step());

      const healthy: ProbeApiIngestResponse = await ingest(
        goneCheck({ resourceStillReporting: true }),
      );

      expect(healthy.criteriaMetId).toBe(recoverCriteria().data!.id);
      expect(openIncidents).toHaveLength(0);
      expect(openAlerts).toHaveLength(0);
      expect(statusChangeRootCauses).toHaveLength(0);
      expectOnline();
    });

    test("an incident opened for the whole monitor before it was grouped closes too", async () => {
      useMonitor(CEPH_CASE.monitorType, CEPH_CASE.step());
      monitor.currentMonitorStatusId = OFFLINE;
      openIncidents.push(buildIncident({ criteria: fireCriteria() }));

      await ingest(goneCheck({ resourceStillReporting: true }));

      expect(openIncidents).toHaveLength(0);
      expectOnline();
    });
  });

  describe("every series gone because nothing arrives", () => {
    test.each(CASE_ROWS)(
      "%s: a collector that stopped closes nothing, however long it stays stopped",
      async (_name: string, testCase: GroupedTemplateCase) => {
        useMonitor(testCase.monitorType, testCase.step());

        await ingest(firingCheck(testCase.labels));

        for (let minute: number = 0; minute < 20; minute++) {
          const silent: ProbeApiIngestResponse = await ingest(
            goneCheck({ resourceStillReporting: false }),
          );

          expect(silent.criteriaMetId).toBeFalsy();
        }

        expect(openIncidents).toHaveLength(1);
        expect(openAlerts).toHaveLength(1);
        expectOffline();
        // The one status change is the firing check's.
        expect(statusChangeRootCauses).toHaveLength(1);
      },
    );

    test("the evaluation log says why nothing recovered", async () => {
      useMonitor(CEPH_CASE.monitorType, CEPH_CASE.step());

      await ingest(firingCheck(CEPH_CASE.labels));

      const silent: ProbeApiIngestResponse = await ingest(
        goneCheck({ resourceStillReporting: false }),
      );

      expect(resultOf(silent, recoverCriteria())).toEqual(
        expect.objectContaining({
          met: false,
          message: GROUPED_SERIES_GONE_NOT_MET_MESSAGE,
        }),
      );
    });

    test("a check that could not read the heartbeat closes nothing either", async () => {
      useMonitor(VMWARE_CASE.monitorType, VMWARE_CASE.step());

      await ingest(firingCheck(VMWARE_CASE.labels));

      const unknown: ProbeApiIngestResponse = await ingest(goneCheck({}));

      expect(unknown.criteriaMetId).toBeFalsy();
      expect(openIncidents).toHaveLength(1);
      expect(openAlerts).toHaveLength(1);
      expectOffline();
    });

    test("the collector coming back with the series still there keeps the same incident and alert", async () => {
      useMonitor(CEPH_CASE.monitorType, CEPH_CASE.step());

      await ingest(firingCheck(CEPH_CASE.labels));

      const incidentId: string = openIncidents[0]!.id!.toString();
      const alertId: string = openAlerts[0]!.id!.toString();

      await ingest(goneCheck({ resourceStillReporting: false }));
      await ingest(firingCheck(CEPH_CASE.labels));

      expect(
        openIncidents.map((incident: Incident) => {
          return incident.id!.toString();
        }),
      ).toEqual([incidentId]);
      expect(
        openAlerts.map((alert: Alert) => {
          return alert.id!.toString();
        }),
      ).toEqual([alertId]);
      expectOffline();
    });

    test("the collector coming back without the series closes them", async () => {
      useMonitor(CEPH_CASE.monitorType, CEPH_CASE.step());

      await ingest(firingCheck(CEPH_CASE.labels));
      await ingest(goneCheck({ resourceStillReporting: false }));
      await ingest(goneCheck({ resourceStillReporting: true }));

      expect(openIncidents).toHaveLength(0);
      expect(openAlerts).toHaveLength(0);
      expectOnline();
    });
  });

  describe("what this leaves as it was", () => {
    test("one series gone beside another still firing closes its own, whatever the heartbeat says", async () => {
      useMonitor(CEPH_CASE.monitorType, CEPH_CASE.step());

      const going: JSONObject = { ceph_daemon: "osd.3" };
      const staying: JSONObject = { ceph_daemon: "osd.7" };

      await ingest(check([buildSeries(going, 1), buildSeries(staying, 1)]));

      expect(openIncidents).toHaveLength(2);

      await ingest(check([buildSeries(staying, 1)]));

      expect(
        openIncidents.map((incident: Incident) => {
          return incident.seriesLabels;
        }),
      ).toEqual([staying]);
      expect(openAlerts).toHaveLength(1);
      expectOffline();
    });

    test("a criteria that opens records does not act on no series, whatever it reads a missing series as", async () => {
      useMonitor(
        MonitorType.IoTDevice,
        getIoTAlertTemplateById("iot-device-offline")!.getMonitorStep(
          STEP_ARGS,
        ),
      );

      const gone: ProbeApiIngestResponse = await ingest(
        goneCheck({ resourceStillReporting: true }),
      );

      expect(
        fireCriteria().data!.filters[0]!.metricMonitorOptions?.onNoDataPolicy,
      ).toBe(NoDataPolicy.TreatAsZero);
      expect(gone.criteriaMetId).toBeFalsy();
      expect(openIncidents).toHaveLength(0);
      expect(openAlerts).toHaveLength(0);
      expectOnline();
    });

    test("a recovery criteria that does not count a missing series as zero does not match it", async () => {
      useMonitor(
        MonitorType.VMware,
        getVMwareAlertTemplateById(
          "vmware-host-cpu-saturation",
        )!.getMonitorStep(STEP_ARGS),
      );
      monitor.currentMonitorStatusId = OFFLINE;
      openIncidents.push(
        buildIncident({
          criteria: fireCriteria(),
          match: {
            criteriaMetId: fireCriteria().data!.id!,
            fingerprint: "esx-01",
            labels: { "resource.vcenter.host.name": "esx-01" },
            rootCause: "Opened",
          },
        }),
      );

      const gone: ProbeApiIngestResponse = await ingest(
        goneCheck({ resourceStillReporting: true }),
      );

      expect(gone.criteriaMetId).toBeFalsy();
      expect(openIncidents).toHaveLength(1);
      expectOffline();
    });

    test("every filter of an All criteria has to hold: one that ignores no data keeps it from matching", async () => {
      useMonitor(CEPH_CASE.monitorType, CEPH_CASE.step());

      const recover: MonitorCriteriaInstance = recoverCriteria();
      const filter: CriteriaFilter = recover.data!.filters[0]!;

      recover.data!.filterCondition = FilterCondition.All;
      recover.data!.filters.push({
        ...filter,
        metricMonitorOptions: {
          ...filter.metricMonitorOptions,
          onNoDataPolicy: NoDataPolicy.Ignore,
        },
      });

      await ingest(firingCheck(CEPH_CASE.labels));

      const gone: ProbeApiIngestResponse = await ingest(
        goneCheck({ resourceStillReporting: true }),
      );

      expect(gone.criteriaMetId).toBeFalsy();
      expect(openIncidents).toHaveLength(1);
      expectOffline();
    });

    test("an ungrouped health check goes on reading its silent window as healthy, as its docs say, with no heartbeat asked", async () => {
      useMonitor(
        MonitorType.Ceph,
        getCephAlertTemplateById("ceph-osd-nearfull")!.getMonitorStep(
          STEP_ARGS,
        ),
      );

      const view: MetricsViewConfig = MonitorStep.getMetricsViewConfig(step)!;
      const wholeMonitorCheck: (values: Array<number>) => MetricMonitorResponse =
        (values: Array<number>): MetricMonitorResponse => {
          return {
            projectId: PROJECT_ID,
            monitorId: MONITOR_ID,
            metricViewConfig: view,
            metricResult: [
              {
                data: values.map((value: number, minute: number) => {
                  return {
                    timestamp: new Date(FIRST_BUCKET_MS + minute * MINUTE_MS),
                    value: value,
                  } as AggregateModel;
                }),
              },
            ],
            startAndEndDate: RollingTimeUtil.convertToStartAndEndDate(
              RollingTime.Past5Minutes,
              NOW,
            ),
          };
        };

      await ingest(wholeMonitorCheck([1, 1, 1, 1, 1, 1]));

      expect(openIncidents).toHaveLength(1);
      expectOffline();

      const silent: ProbeApiIngestResponse = await ingest(
        wholeMonitorCheck([]),
      );

      expect(silent.criteriaMetId).toBe(recoverCriteria().data!.id);
      expect(openIncidents).toHaveLength(0);
      expectOnline();
    });
  });

  describe("a Metrics monitor, whose silence keeps its old meaning", () => {
    function metricsStep(input: {
      firingChangesStatus: boolean;
    }): MonitorStep {
      const fire: MonitorCriteriaInstance = buildUnhealthyCriteriaInstance({
        offlineMonitorStatusId: OFFLINE,
        incidentSeverityId: ObjectID.generate(),
        alertSeverityId: ObjectID.generate(),
        monitorName: "Grouped check",
        metricAlias: "a",
        filterType: FilterType.GreaterThan,
        value: 0,
      });

      fire.data!.changeMonitorStatus = input.firingChangesStatus;

      const criteria: MonitorCriteria = new MonitorCriteria();
      criteria.data = {
        monitorCriteriaInstanceArray: [
          fire,
          buildHealthyCriteriaInstance({
            onlineMonitorStatusId: ONLINE,
            metricAlias: "a",
            filterType: FilterType.EqualTo,
            value: 0,
            treatNoDataAsZero: true,
          }),
        ],
      };

      const monitorStep: MonitorStep = new MonitorStep().setMetricMonitor({
        ...MonitorStepMetricMonitorUtil.getDefault(),
        metricViewConfig: {
          queryConfigs: [
            {
              metricAliasData: {
                metricVariable: "a",
                title: "a",
                description: "a",
                legend: "a",
                legendUnit: undefined,
              },
              metricQueryData: {
                filterData: {
                  metricName: "queue.oldest.message.age",
                  attributes: {},
                  aggegationType: MetricsAggregationType.Max,
                  aggregateBy: {},
                },
                groupByAttributeKeys: ["queue.name"],
              },
            },
          ],
          formulaConfigs: [],
        },
        rollingTime: RollingTime.Past5Minutes,
      });

      monitorStep.setMonitorCriteria(criteria);

      return monitorStep;
    }

    test("every series gone recovers with no heartbeat to read", async () => {
      useMonitor(
        MonitorType.Metrics,
        metricsStep({ firingChangesStatus: true }),
      );

      await ingest(firingCheck({ "queue.name": "orders" }));

      expect(openAlerts).toHaveLength(1);
      expectOffline();

      const gone: ProbeApiIngestResponse = await ingest(goneCheck({}));

      expect(gone.criteriaMetId).toBe(recoverCriteria().data!.id);
      expect(openIncidents).toHaveLength(0);
      expect(openAlerts).toHaveLength(0);
      expectOnline();
    });

    test("so does an alert that never moved the monitor off its default status, which no criteria met would leave open", async () => {
      useMonitor(
        MonitorType.Metrics,
        metricsStep({ firingChangesStatus: false }),
      );

      await ingest(firingCheck({ "queue.name": "orders" }));

      expect(openAlerts).toHaveLength(1);
      expectOnline();

      await ingest(goneCheck({}));

      expect(openIncidents).toHaveLength(0);
      expect(openAlerts).toHaveLength(0);
      expectOnline();
    });
  });
});

describe("GroupedSeriesGone", () => {
  function response(
    input: Partial<MetricMonitorResponse>,
  ): MetricMonitorResponse {
    return {
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
      metricResult: [{ data: [] }],
      ...input,
    };
  }

  const POINT: AggregateModel = {
    timestamp: new Date(FIRST_BUCKET_MS),
    value: 0,
  } as AggregateModel;

  function recover(treatNoDataAsZero: boolean): MonitorCriteriaInstance {
    return buildHealthyCriteriaInstance({
      onlineMonitorStatusId: ONLINE,
      metricAlias: "a",
      filterType: FilterType.EqualTo,
      value: 0,
      treatNoDataAsZero: treatNoDataAsZero,
    });
  }

  function fire(treatNoDataAsZero: boolean): MonitorCriteriaInstance {
    return buildUnhealthyCriteriaInstance({
      offlineMonitorStatusId: OFFLINE,
      incidentSeverityId: ObjectID.generate(),
      alertSeverityId: ObjectID.generate(),
      monitorName: "Grouped check",
      metricAlias: "a",
      filterType: FilterType.LessThan,
      value: 1,
      treatNoDataAsZero: treatNoDataAsZero,
    });
  }

  describe("hasNoSeries", () => {
    test("a grouped check that read nothing", () => {
      expect(
        GroupedSeriesGone.hasNoSeries(response({ seriesBreakdown: [] })),
      ).toBe(true);
    });

    test("not an ungrouped check, which has no breakdown", () => {
      expect(GroupedSeriesGone.hasNoSeries(response({}))).toBe(false);
    });

    test("not a check with a series, even one with no data", () => {
      expect(
        GroupedSeriesGone.hasNoSeries(
          response({
            seriesBreakdown: [
              {
                fingerprint: "absent-host",
                labels: { "resource.host.name": "web-01" },
                aggregatedResults: [{ data: [] }],
              },
            ],
          }),
        ),
      ).toBe(false);
    });

    test("not a check whose data did not reach a breakdown", () => {
      expect(
        GroupedSeriesGone.hasNoSeries(
          response({
            seriesBreakdown: [],
            metricResult: [{ data: [] }, { data: [POINT] }],
          }),
        ),
      ).toBe(false);
    });

    test("not something other than a metric check", () => {
      expect(
        GroupedSeriesGone.hasNoSeries({
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          logCount: 0,
        } as never),
      ).toBe(false);
    });
  });

  describe("countsMissingSeriesAsZero", () => {
    test("a recovery criteria reading a missing series as 0", () => {
      expect(GroupedSeriesGone.countsMissingSeriesAsZero(recover(true))).toBe(
        true,
      );
    });

    test("not one that ignores no data", () => {
      expect(GroupedSeriesGone.countsMissingSeriesAsZero(recover(false))).toBe(
        false,
      );
    });

    test("not one that opens an incident or an alert", () => {
      expect(GroupedSeriesGone.countsMissingSeriesAsZero(fire(true))).toBe(
        false,
      );
    });

    test("one switched on to open records with none to open opens nothing", () => {
      const criteria: MonitorCriteriaInstance = recover(true);
      criteria.data!.createIncidents = true;
      criteria.data!.createAlerts = true;

      expect(GroupedSeriesGone.countsMissingSeriesAsZero(criteria)).toBe(true);
    });
  });

  describe("needsResourceReport", () => {
    function stepWith(
      instances: Array<MonitorCriteriaInstance>,
    ): MonitorStep {
      const criteria: MonitorCriteria = new MonitorCriteria();
      criteria.data = { monitorCriteriaInstanceArray: instances };

      const monitorStep: MonitorStep = new MonitorStep();
      monitorStep.setMonitorCriteria(criteria);

      return monitorStep;
    }

    test("an infrastructure check with no series and such a criteria", () => {
      expect(
        GroupedSeriesGone.needsResourceReport({
          monitorType: MonitorType.Ceph,
          monitorStep: stepWith([fire(false), recover(true)]),
          dataToProcess: response({ seriesBreakdown: [] }),
        }),
      ).toBe(true);
    });

    test("not a Metrics monitor, not a check with data, and not a step without such a criteria", () => {
      expect(
        GroupedSeriesGone.needsResourceReport({
          monitorType: MonitorType.Metrics,
          monitorStep: stepWith([recover(true)]),
          dataToProcess: response({ seriesBreakdown: [] }),
        }),
      ).toBe(false);
      expect(
        GroupedSeriesGone.needsResourceReport({
          monitorType: MonitorType.Ceph,
          monitorStep: stepWith([recover(true)]),
          dataToProcess: response({
            seriesBreakdown: [],
            metricResult: [{ data: [POINT] }],
          }),
        }),
      ).toBe(false);
      expect(
        GroupedSeriesGone.needsResourceReport({
          monitorType: MonitorType.Ceph,
          monitorStep: stepWith([fire(true), recover(false)]),
          dataToProcess: response({ seriesBreakdown: [] }),
        }),
      ).toBe(false);
    });
  });

  describe("isCriteriaMet and isWaitingForResource", () => {
    function verdict(input: {
      monitorType: MonitorType;
      criteria: MonitorCriteriaInstance;
      resourceStillReporting?: boolean | undefined;
    }): { isMet: boolean; isWaiting: boolean } {
      const data: {
        monitorType: MonitorType;
        criteriaInstance: MonitorCriteriaInstance;
        dataToProcess: MetricMonitorResponse;
      } = {
        monitorType: input.monitorType,
        criteriaInstance: input.criteria,
        dataToProcess: response({
          seriesBreakdown: [],
          resourceStillReporting: input.resourceStillReporting,
        }),
      };

      return {
        isMet: GroupedSeriesGone.isCriteriaMet(data),
        isWaiting: GroupedSeriesGone.isWaitingForResource(data),
      };
    }

    test("an infrastructure monitor needs the resource to have reported", () => {
      expect(
        verdict({
          monitorType: MonitorType.Ceph,
          criteria: recover(true),
          resourceStillReporting: true,
        }),
      ).toEqual({ isMet: true, isWaiting: false });
      expect(
        verdict({
          monitorType: MonitorType.Ceph,
          criteria: recover(true),
          resourceStillReporting: false,
        }),
      ).toEqual({ isMet: false, isWaiting: true });
      expect(
        verdict({ monitorType: MonitorType.Ceph, criteria: recover(true) }),
      ).toEqual({ isMet: false, isWaiting: true });
    });

    test("a Metrics monitor does not", () => {
      expect(
        verdict({ monitorType: MonitorType.Metrics, criteria: recover(true) }),
      ).toEqual({ isMet: true, isWaiting: false });
    });

    test("no other monitor type, and no other criteria, is about gone series at all", () => {
      expect(
        verdict({
          monitorType: MonitorType.Logs,
          criteria: recover(true),
          resourceStillReporting: true,
        }),
      ).toEqual({ isMet: false, isWaiting: false });
      expect(
        verdict({
          monitorType: MonitorType.Ceph,
          criteria: fire(true),
          resourceStillReporting: true,
        }),
      ).toEqual({ isMet: false, isWaiting: false });
    });
  });
});
