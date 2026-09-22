import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import MonitorCheckScheduleUtil from "Common/Utils/Monitor/MonitorCheckScheduleUtil";
import MonitorStatusHistoryUtil from "Common/Utils/Monitor/MonitorStatusHistoryUtil";
import { MutableRefObject, useEffect, useRef, useState } from "react";
import AlertStateUtil from "../../../Utils/AlertState";
import IncidentStateUtil from "../../../Utils/IncidentState";
import {
  OverviewSection,
  failSection,
  forbidSection,
  getLoadingSection,
  getSectionForSubject,
  resolveSection,
  shouldAttemptRead,
} from "../../../Utils/OverviewSection";
import {
  MonitorOpenWork,
  MonitorOpenWorkRow,
  MonitorOpenWorkSide,
} from "./MonitorOverviewTypes";

// The newest few of each kind; the count is the full total.
export const MONITOR_OPEN_WORK_ROW_LIMIT: number = 5;

export const MONITOR_OPEN_WORK_ACCESS_REASONS: {
  incidents: string;
  alerts: string;
} = {
  incidents: "You need permission to read incidents.",
  alerts: "You need permission to read alerts.",
};

export const MONITOR_OPEN_WORK_NO_PROJECT_MESSAGE: string =
  "Select a project to see what is open on this monitor.";

type StateIdsFunction = (
  states: Array<IncidentState | AlertState>,
) => Array<ObjectID>;

const getStateIds: StateIdsFunction = (
  states: Array<IncidentState | AlertState>,
): Array<ObjectID> => {
  const ids: Array<ObjectID> = [];

  for (const state of states || []) {
    if (state?.id) {
      ids.push(state.id);
    }
  }

  return ids;
};

type ToIncidentRowFunction = (incident: Incident) => MonitorOpenWorkRow | null;

const toIncidentRow: ToIncidentRowFunction = (
  incident: Incident,
): MonitorOpenWorkRow | null => {
  const id: string = incident._id?.toString() || "";

  if (!id) {
    return null;
  }

  return {
    key: `incident-${id}`,
    kind: "Incident",
    id: id,
    title: incident.title || "Untitled incident",
    // Declared is when the incident began; created is the fallback.
    startedAt:
      MonitorCheckScheduleUtil.parseDate(incident.declaredAt) ||
      MonitorCheckScheduleUtil.parseDate(incident.createdAt),
    severityName: incident.incidentSeverity?.name || undefined,
    severityColor: MonitorStatusHistoryUtil.normalizeColor(
      incident.incidentSeverity?.color,
    ),
    stateName: incident.currentIncidentState?.name || undefined,
  };
};

type ToAlertRowFunction = (alert: Alert) => MonitorOpenWorkRow | null;

const toAlertRow: ToAlertRowFunction = (
  alert: Alert,
): MonitorOpenWorkRow | null => {
  const id: string = alert._id?.toString() || "";

  if (!id) {
    return null;
  }

  return {
    key: `alert-${id}`,
    kind: "Alert",
    id: id,
    title: alert.title || "Untitled alert",
    startedAt: MonitorCheckScheduleUtil.parseDate(alert.createdAt),
    severityName: alert.alertSeverity?.name || undefined,
    severityColor: MonitorStatusHistoryUtil.normalizeColor(
      alert.alertSeverity?.color,
    ),
    stateName: alert.currentAlertState?.name || undefined,
  };
};

function toSide<T extends BaseModel>(data: {
  result: ListResult<T>;
  toRow: (item: T) => MonitorOpenWorkRow | null;
}): MonitorOpenWorkSide {
  const rows: Array<MonitorOpenWorkRow> = [];

  for (const item of data.result.data || []) {
    const row: MonitorOpenWorkRow | null = data.toRow(item);

    if (row) {
      rows.push(row);
    }
  }

  return {
    // The list's count is the total match count, not the rows returned.
    count:
      typeof data.result.count === "number" ? data.result.count : rows.length,
    rows: rows,
  };
}

/*
 * "What is on fire here": the monitor's unresolved incidents and alerts.
 *
 * "Unresolved" is every state before the project's first resolved state,
 * from the same cached state lists the header badges read. One list request
 * per kind gives both the newest rows and, in its count, the total. The two
 * sides are gated and loaded separately, so a MonitorViewer (who can read
 * neither) sees both as "no access", never as zero, and an incident
 * failure does not hide the alerts.
 *
 * Incidents link to monitors through the `monitors` relation; alerts carry
 * a single `monitorId` column.
 *
 * No timer: it reloads when `refreshToken` changes (the data hook's refresh
 * count). A failed reload keeps the last counts and records the failure.
 */
export const useMonitorOpenWork: (options: {
  monitorId: ObjectID;
  refreshToken: number;
}) => MonitorOpenWork = (options: {
  monitorId: ObjectID;
  refreshToken: number;
}): MonitorOpenWork => {
  const monitorIdString: string = options.monitorId.toString();

  const [incidents, setIncidents] =
    useState<OverviewSection<MonitorOpenWorkSide>>(
      getLoadingSection<MonitorOpenWorkSide>(),
    );
  const [alerts, setAlerts] =
    useState<OverviewSection<MonitorOpenWorkSide>>(
      getLoadingSection<MonitorOpenWorkSide>(),
    );

  const incidentsRef: MutableRefObject<OverviewSection<MonitorOpenWorkSide>> =
    useRef<OverviewSection<MonitorOpenWorkSide>>(incidents);
  const alertsRef: MutableRefObject<OverviewSection<MonitorOpenWorkSide>> =
    useRef<OverviewSection<MonitorOpenWorkSide>>(alerts);

  useEffect(() => {
    let cancelled: boolean = false;
    const subjectId: string = monitorIdString;
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    const commitIncidents: (
      section: OverviewSection<MonitorOpenWorkSide>,
    ) => void = (section: OverviewSection<MonitorOpenWorkSide>): void => {
      incidentsRef.current = section;
      setIncidents(section);
    };

    const commitAlerts: (
      section: OverviewSection<MonitorOpenWorkSide>,
    ) => void = (section: OverviewSection<MonitorOpenWorkSide>): void => {
      alertsRef.current = section;
      setAlerts(section);
    };

    // O1: open incidents on this monitor.
    const loadIncidents: () => Promise<void> = async (): Promise<void> => {
      if (
        !shouldAttemptRead(
          PermissionGate.check(new Incident(), ModelAction.Read),
        )
      ) {
        commitIncidents(
          forbidSection<MonitorOpenWorkSide>({
            reason: MONITOR_OPEN_WORK_ACCESS_REASONS.incidents,
            subjectId: subjectId,
          }),
        );
        return;
      }

      try {
        if (!projectId) {
          throw new Error(MONITOR_OPEN_WORK_NO_PROJECT_MESSAGE);
        }

        const stateIds: Array<ObjectID> = getStateIds(
          await IncidentStateUtil.getUnresolvedIncidentStates(projectId),
        );

        // A project with no unresolved states cannot have anything open.
        let side: MonitorOpenWorkSide = { count: 0, rows: [] };

        // An empty Includes is not a query worth sending.
        if (stateIds.length > 0) {
          const result: ListResult<Incident> = await ModelAPI.getList<Incident>(
            {
              modelType: Incident,
              query: {
                projectId: projectId,
                monitors: new Includes([options.monitorId]),
                currentIncidentStateId: new Includes(stateIds),
              },
              select: {
                _id: true,
                title: true,
                declaredAt: true,
                createdAt: true,
                incidentSeverity: {
                  name: true,
                  color: true,
                },
                currentIncidentState: {
                  name: true,
                },
              },
              sort: {
                declaredAt: SortOrder.Descending,
              },
              limit: MONITOR_OPEN_WORK_ROW_LIMIT,
              skip: 0,
            },
          );

          side = toSide<Incident>({ result: result, toRow: toIncidentRow });
        }

        if (cancelled) {
          return;
        }

        commitIncidents(resolveSection({ value: side, subjectId: subjectId }));
      } catch (err) {
        if (cancelled) {
          return;
        }

        commitIncidents(
          failSection({
            previous: incidentsRef.current,
            message: API.getFriendlyMessage(err),
            subjectId: subjectId,
          }),
        );
      }
    };

    // O2: open alerts on this monitor.
    const loadAlerts: () => Promise<void> = async (): Promise<void> => {
      if (
        !shouldAttemptRead(PermissionGate.check(new Alert(), ModelAction.Read))
      ) {
        commitAlerts(
          forbidSection<MonitorOpenWorkSide>({
            reason: MONITOR_OPEN_WORK_ACCESS_REASONS.alerts,
            subjectId: subjectId,
          }),
        );
        return;
      }

      try {
        if (!projectId) {
          throw new Error(MONITOR_OPEN_WORK_NO_PROJECT_MESSAGE);
        }

        const stateIds: Array<ObjectID> = getStateIds(
          await AlertStateUtil.getUnresolvedAlertStates(projectId),
        );

        let side: MonitorOpenWorkSide = { count: 0, rows: [] };

        if (stateIds.length > 0) {
          const result: ListResult<Alert> = await ModelAPI.getList<Alert>({
            modelType: Alert,
            query: {
              projectId: projectId,
              monitorId: options.monitorId,
              currentAlertStateId: new Includes(stateIds),
            },
            select: {
              _id: true,
              title: true,
              createdAt: true,
              alertSeverity: {
                name: true,
                color: true,
              },
              currentAlertState: {
                name: true,
              },
            },
            sort: {
              createdAt: SortOrder.Descending,
            },
            limit: MONITOR_OPEN_WORK_ROW_LIMIT,
            skip: 0,
          });

          side = toSide<Alert>({ result: result, toRow: toAlertRow });
        }

        if (cancelled) {
          return;
        }

        commitAlerts(resolveSection({ value: side, subjectId: subjectId }));
      } catch (err) {
        if (cancelled) {
          return;
        }

        commitAlerts(
          failSection({
            previous: alertsRef.current,
            message: API.getFriendlyMessage(err),
            subjectId: subjectId,
          }),
        );
      }
    };

    loadIncidents().catch(() => {
      // loadIncidents records its own errors.
    });
    loadAlerts().catch(() => {
      // loadAlerts records its own errors.
    });

    return () => {
      cancelled = true;
    };
  }, [monitorIdString, options.refreshToken]);

  return {
    incidents: getSectionForSubject(incidents, monitorIdString),
    alerts: getSectionForSubject(alerts, monitorIdString),
  };
};

export default useMonitorOpenWork;
