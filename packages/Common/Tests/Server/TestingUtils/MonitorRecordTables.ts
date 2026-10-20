import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import NetworkDeviceOwnerUserService from "../../../Server/Services/NetworkDeviceOwnerUserService";
import ProjectService from "../../../Server/Services/ProjectService";
import logger from "../../../Server/Utils/Logger";
import MonitorDependencySuppression from "../../../Server/Utils/Monitor/MonitorDependencySuppression";
import MonitorLogUtil from "../../../Server/Utils/Monitor/MonitorLogUtil";
import MonitorMaintenanceSuppression from "../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import MonitorMetricUtil from "../../../Server/Utils/Monitor/MonitorMetricUtil";
import MonitorResourceContextUtil from "../../../Server/Utils/Monitor/MonitorResourceContext";
import MonitorStatusTimelineUtil from "../../../Server/Utils/Monitor/MonitorStatusTimeline";
import MonitorSummaryCapture from "../../../Server/Utils/Monitor/MonitorSummaryCapture";
import ReceivingSilence from "../../../Server/Utils/Monitor/ReceivingSilence";
import SeriesResourceLinker from "../../../Server/Utils/Monitor/SeriesResourceLinker";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  ALERT_STATE_IDS,
  INCIDENT_STATE_IDS,
  mockProjectStates,
} from "./Services/ProjectStatesHelper";
import { jest } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * The incident and alert tables one monitor's evaluations read and write,
 * kept in memory, for suites that drive MonitorResourceUtil.monitorResource
 * end to end - the path every check, request and agent report takes - with
 * the real criteria evaluator and the real incident and alert creators.
 * Records open, resolve and are found the way the database does it, so what
 * one evaluation opens is what the next one sees.
 *
 * Everything else an evaluation touches is stood in for: the monitor row
 * (whatever getMonitor returns), the lock, metrics, the monitor log,
 * maintenance and dependency suppression, the summary capture, resource
 * links and device owners. The monitor's status lives on the monitor
 * getMonitor returns: each change is recorded in statusSetBy, by the name of
 * the criteria that made it. Silence measures zero minutes unless a suite
 * mocks ReceivingSilence.measure again.
 *
 * Call it in beforeEach, and restore with jest.restoreAllMocks in afterEach.
 */
export interface MonitorRecordTables {
  incidents: Array<Incident>;
  alerts: Array<Alert>;
  /*
   * The criteria that set the monitor's status, by name, in order -
   * DEFAULT_STATUS for a check that matched none and moved it back.
   */
  statusSetBy: Array<string>;
}

export const DEFAULT_STATUS: string = "(back to the default status)";

function parameterOf(operator: unknown): unknown {
  return Object.values(
    (operator as FindOperator<unknown>).objectLiteralParameters || {},
  )[0];
}

function isIn(operator: unknown, value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return (parameterOf(operator) as Array<string>).includes(value);
}

// The records a findBy reads: the creators ask for the open ones only.
function readByState<T extends Incident | Alert>(
  table: Array<T>,
  stateColumn: "currentIncidentStateId" | "currentAlertStateId",
  query: JSONObject,
): Array<T> {
  return table.filter((record: T): boolean => {
    const state: unknown = query[stateColumn];
    const recordState: ObjectID | undefined = (
      record as unknown as Record<string, ObjectID | undefined>
    )[stateColumn];

    return state === undefined || isIn(state, recordState?.toString());
  });
}

export function isOpenIncident(incident: Incident): boolean {
  return (
    incident.currentIncidentStateId?.toString() !==
    INCIDENT_STATE_IDS.resolved.toString()
  );
}

export function isOpenAlert(alert: Alert): boolean {
  return (
    alert.currentAlertStateId?.toString() !==
    ALERT_STATE_IDS.resolved.toString()
  );
}

// Someone resolves the incident by hand.
export function resolveIncidentByHand(incident: Incident): void {
  incident.currentIncidentStateId = INCIDENT_STATE_IDS.resolved;
}

export function mockMonitorRecordTables(input: {
  getMonitor: () => Monitor;
  projectId: ObjectID;
  incidentSeverityId: ObjectID;
  alertSeverityId: ObjectID;
}): MonitorRecordTables {
  const tables: MonitorRecordTables = {
    incidents: [],
    alerts: [],
    statusSetBy: [],
  };

  let nextIncidentNumber: number = 1;
  let nextAlertNumber: number = 1;

  mockProjectStates();

  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
  jest.spyOn(MonitorService, "findOneById").mockImplementation((async () => {
    return input.getMonitor();
  }) as never);
  jest
    .spyOn(MonitorService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(MonitorMetricUtil, "saveMonitorMetrics")
    .mockResolvedValue(undefined);
  jest.spyOn(MonitorLogUtil, "saveMonitorLog").mockReturnValue(undefined);
  /*
   * The monitor's status: a matching criteria moves the monitor to its
   * status, and a check that matches none moves it back to the default -
   * the path that also resolves what the criteria opened.
   */
  jest
    .spyOn(MonitorStatusTimelineUtil, "updateMonitorStatusTimeline")
    .mockImplementation((async (statusInput: {
      monitor: Monitor;
      criteriaInstance: MonitorCriteriaInstance;
    }) => {
      tables.statusSetBy.push(statusInput.criteriaInstance.data?.name || "");

      const statusId: ObjectID | undefined =
        statusInput.criteriaInstance.data?.monitorStatusId;

      if (statusId) {
        statusInput.monitor.currentMonitorStatusId = new ObjectID(
          statusId.toString(),
        );
      }

      return null;
    }) as never);
  jest
    .spyOn(MonitorStatusTimelineService, "findOneBy")
    .mockImplementation((async (): Promise<MonitorStatusTimeline> => {
      const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
      timeline.monitorStatusId = input.getMonitor().currentMonitorStatusId!;
      return timeline;
    }) as never);
  jest
    .spyOn(MonitorStatusTimelineService, "create")
    .mockImplementation((async (createBy: {
      data: MonitorStatusTimeline;
    }): Promise<MonitorStatusTimeline> => {
      input.getMonitor().currentMonitorStatusId =
        createBy.data.monitorStatusId!;
      tables.statusSetBy.push(DEFAULT_STATUS);
      return createBy.data;
    }) as never);
  jest
    .spyOn(MonitorStatusService, "findOneBy")
    .mockImplementation((async (findBy: {
      query: JSONObject;
    }): Promise<MonitorStatus> => {
      const status: MonitorStatus = new MonitorStatus();
      status._id = String(findBy.query["_id"]);
      status.projectId = input.projectId;
      status.name = "Status";
      return status;
    }) as never);
  jest
    .spyOn(MonitorMaintenanceSuppression, "getMaintenanceSuppression")
    .mockResolvedValue({
      suppressedSeriesFingerprints: new Set<string>(),
      suppressingDatabaseServerIds: [],
    } as never);
  jest
    .spyOn(MonitorDependencySuppression, "getDependencySuppression")
    .mockResolvedValue({ isSuppressed: false } as never);
  jest.spyOn(MonitorSummaryCapture, "capture").mockResolvedValue(null as never);
  jest
    .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
    .mockResolvedValue(MonitorResourceContextUtil.emptyContext());
  jest
    .spyOn(MonitorResourceContextUtil, "resolveLinkedResourcesForMonitor")
    .mockResolvedValue(MonitorResourceContextUtil.emptyContext());
  jest
    .spyOn(SeriesResourceLinker, "linkSeriesResourcesToModel")
    .mockResolvedValue(undefined);
  jest
    .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
    .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] });
  jest.spyOn(ReceivingSilence, "measure").mockResolvedValue({
    wallMinutes: 0,
    receivingMinutes: 0,
    notReceivingMinutes: 0,
  });

  // Each criteria's severity belongs to the monitor's project.
  jest
    .spyOn(IncidentSeverityService, "findOneBy")
    .mockImplementation((async (): Promise<IncidentSeverity> => {
      const severity: IncidentSeverity = new IncidentSeverity();
      severity._id = input.incidentSeverityId.toString();
      severity.projectId = input.projectId;
      return severity;
    }) as never);
  jest
    .spyOn(AlertSeverityService, "findOneBy")
    .mockImplementation((async (): Promise<AlertSeverity> => {
      const severity: AlertSeverity = new AlertSeverity();
      severity._id = input.alertSeverityId.toString();
      severity.projectId = input.projectId;
      return severity;
    }) as never);

  // The incident table.
  jest.spyOn(IncidentService, "findBy").mockImplementation((async (findBy: {
    query: JSONObject;
  }): Promise<Array<Incident>> => {
    return readByState(
      tables.incidents,
      "currentIncidentStateId",
      findBy.query,
    );
  }) as never);
  jest.spyOn(IncidentService, "countBy").mockImplementation((async (countBy: {
    query: JSONObject;
  }): Promise<PositiveNumber> => {
    return new PositiveNumber(
      readByState(
        tables.incidents,
        "currentIncidentStateId",
        countBy.query,
      ).length,
    );
  }) as never);
  jest.spyOn(IncidentService, "create").mockImplementation((async (createBy: {
    data: Incident;
  }): Promise<Incident> => {
    const incident: Incident = createBy.data;
    incident.id = ObjectID.generate();
    incident.incidentNumber = nextIncidentNumber++;
    incident.createdAt = OneUptimeDate.getCurrentDate();
    incident.currentIncidentStateId = INCIDENT_STATE_IDS.created;
    tables.incidents.push(incident);
    return incident;
  }) as never);
  jest
    .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
    .mockResolvedValue(INCIDENT_STATE_IDS.resolved);
  jest
    .spyOn(IncidentStateTimelineService, "create")
    .mockImplementation((async (createBy: {
      data: IncidentStateTimeline;
    }): Promise<IncidentStateTimeline> => {
      const incident: Incident | undefined = tables.incidents.find(
        (candidate: Incident): boolean => {
          return (
            candidate.id!.toString() === createBy.data.incidentId!.toString()
          );
        },
      );

      incident!.currentIncidentStateId = createBy.data.incidentStateId!;
      return createBy.data;
    }) as never);

  // The alert table.
  jest.spyOn(AlertService, "findBy").mockImplementation((async (findBy: {
    query: JSONObject;
  }): Promise<Array<Alert>> => {
    return readByState(tables.alerts, "currentAlertStateId", findBy.query);
  }) as never);
  jest.spyOn(AlertService, "countBy").mockImplementation((async (countBy: {
    query: JSONObject;
  }): Promise<PositiveNumber> => {
    return new PositiveNumber(
      readByState(tables.alerts, "currentAlertStateId", countBy.query).length,
    );
  }) as never);
  jest.spyOn(AlertService, "create").mockImplementation((async (createBy: {
    data: Alert;
  }): Promise<Alert> => {
    const alert: Alert = createBy.data;
    alert.id = ObjectID.generate();
    alert.alertNumber = nextAlertNumber++;
    alert.createdAt = OneUptimeDate.getCurrentDate();
    alert.currentAlertStateId = ALERT_STATE_IDS.created;
    tables.alerts.push(alert);
    return alert;
  }) as never);
  jest
    .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
    .mockResolvedValue(ALERT_STATE_IDS.resolved);
  jest
    .spyOn(AlertStateTimelineService, "create")
    .mockImplementation((async (createBy: {
      data: AlertStateTimeline;
    }): Promise<AlertStateTimeline> => {
      const alert: Alert | undefined = tables.alerts.find(
        (candidate: Alert): boolean => {
          return candidate.id!.toString() === createBy.data.alertId!.toString();
        },
      );

      alert!.currentAlertStateId = createBy.data.alertStateId!;
      return createBy.data;
    }) as never);

  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });

  return tables;
}
