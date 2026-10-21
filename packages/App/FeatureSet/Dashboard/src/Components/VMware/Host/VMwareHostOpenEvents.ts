import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import AlertStateUtil from "../../../Utils/AlertState";
import IncidentStateUtil from "../../../Utils/IncidentState";
import { seriesLabelsNameVMwareHost } from "../../../Pages/VMware/Utils/VMwareHostData";

/*
 * The unresolved incidents and alerts that are about one ESXi host.
 *
 * A VMware monitor watches the whole vCenter: the record it opens links to
 * the vCenter, and only its series labels say which host crossed the line
 * (the host templates group by resource.vcenter.host.name). So this reads
 * the vCenter's unresolved records - few at any one time - and keeps the
 * ones whose labels name the host.
 */

// How many unresolved records of each kind are read for one vCenter.
export const VMWARE_HOST_OPEN_EVENTS_READ_LIMIT: number = 100;

export enum VMwareHostOpenEventKind {
  Incident = "Incident",
  Alert = "Alert",
}

export interface VMwareHostOpenEvent {
  kind: VMwareHostOpenEventKind;
  id: ObjectID;
  title: string;
  // "#12", or the project's own prefix ("INC-12").
  number: string;
  severityName: string;
  severityColor: Color | null;
  stateName: string;
  createdAt: Date | null;
}

export interface VMwareHostOpenEvents {
  // Null when they could not be read (a role without access to them).
  incidents: Array<VMwareHostOpenEvent> | null;
  alerts: Array<VMwareHostOpenEvent> | null;
}

function toDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  const date: Date = new Date(value as Date);

  return Number.isFinite(date.getTime()) ? date : null;
}

function toColor(value: unknown): Color | null {
  if (value instanceof Color) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    return new Color(value.trim());
  }

  if (value && typeof value === "object") {
    const raw: unknown = (value as JSONObject)["value"];

    if (typeof raw === "string" && raw.trim()) {
      return new Color(raw.trim());
    }
  }

  return null;
}

function formatNumber(
  withPrefix: string | undefined,
  number: number | undefined,
): string {
  if (withPrefix) {
    return withPrefix;
  }

  return number !== undefined && number !== null ? `#${number}` : "";
}

export function toVMwareHostOpenIncident(
  incident: Incident,
): VMwareHostOpenEvent | null {
  if (!incident.id) {
    return null;
  }

  return {
    kind: VMwareHostOpenEventKind.Incident,
    id: incident.id,
    title: incident.title || "",
    number: formatNumber(
      incident.incidentNumberWithPrefix,
      incident.incidentNumber,
    ),
    severityName: incident.incidentSeverity?.name || "",
    severityColor: toColor(incident.incidentSeverity?.color),
    stateName: incident.currentIncidentState?.name || "",
    createdAt: toDate(incident.declaredAt || incident.createdAt),
  };
}

export function toVMwareHostOpenAlert(
  alert: Alert,
): VMwareHostOpenEvent | null {
  if (!alert.id) {
    return null;
  }

  return {
    kind: VMwareHostOpenEventKind.Alert,
    id: alert.id,
    title: alert.title || "",
    number: formatNumber(alert.alertNumberWithPrefix, alert.alertNumber),
    severityName: alert.alertSeverity?.name || "",
    severityColor: toColor(alert.alertSeverity?.color),
    stateName: alert.currentAlertState?.name || "",
    createdAt: toDate(alert.createdAt),
  };
}

/*
 * Newest first, incidents and alerts together, so the card reads as one
 * timeline of what is wrong with the host.
 */
export function sortVMwareHostOpenEvents(
  events: Array<VMwareHostOpenEvent>,
): Array<VMwareHostOpenEvent> {
  return [...events].sort(
    (a: VMwareHostOpenEvent, b: VMwareHostOpenEvent): number => {
      const aTime: number = a.createdAt ? a.createdAt.getTime() : 0;
      const bTime: number = b.createdAt ? b.createdAt.getTime() : 0;

      if (aTime !== bTime) {
        return bTime - aTime;
      }

      return a.title.localeCompare(b.title);
    },
  );
}

async function loadOpenIncidents(data: {
  projectId: ObjectID;
  vcenterId: ObjectID;
  hostName: string;
}): Promise<Array<VMwareHostOpenEvent>> {
  const states: Array<IncidentState> =
    await IncidentStateUtil.getUnresolvedIncidentStates(data.projectId);

  if (states.length === 0) {
    return [];
  }

  const result: ListResult<Incident> = await ModelAPI.getList<Incident>({
    modelType: Incident,
    query: {
      projectId: data.projectId,
      vmwareVCenters: new Includes([data.vcenterId]),
      currentIncidentStateId: new Includes(
        states.map((state: IncidentState) => {
          return state.id!;
        }),
      ),
    },
    select: {
      _id: true,
      title: true,
      incidentNumber: true,
      incidentNumberWithPrefix: true,
      declaredAt: true,
      createdAt: true,
      seriesLabels: true,
      incidentSeverity: {
        name: true,
        color: true,
      },
      currentIncidentState: {
        name: true,
      },
    },
    sort: {
      createdAt: SortOrder.Descending,
    },
    limit: VMWARE_HOST_OPEN_EVENTS_READ_LIMIT,
    skip: 0,
  });

  return result.data
    .filter((incident: Incident): boolean => {
      return seriesLabelsNameVMwareHost(
        incident.seriesLabels as JSONObject | undefined,
        data.hostName,
      );
    })
    .map(toVMwareHostOpenIncident)
    .filter(
      (event: VMwareHostOpenEvent | null): event is VMwareHostOpenEvent => {
        return event !== null;
      },
    );
}

async function loadOpenAlerts(data: {
  projectId: ObjectID;
  vcenterId: ObjectID;
  hostName: string;
}): Promise<Array<VMwareHostOpenEvent>> {
  const states: Array<AlertState> =
    await AlertStateUtil.getUnresolvedAlertStates(data.projectId);

  if (states.length === 0) {
    return [];
  }

  const result: ListResult<Alert> = await ModelAPI.getList<Alert>({
    modelType: Alert,
    query: {
      projectId: data.projectId,
      vmwareVCenters: new Includes([data.vcenterId]),
      currentAlertStateId: new Includes(
        states.map((state: AlertState) => {
          return state.id!;
        }),
      ),
    },
    select: {
      _id: true,
      title: true,
      alertNumber: true,
      alertNumberWithPrefix: true,
      createdAt: true,
      seriesLabels: true,
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
    limit: VMWARE_HOST_OPEN_EVENTS_READ_LIMIT,
    skip: 0,
  });

  return result.data
    .filter((alert: Alert): boolean => {
      return seriesLabelsNameVMwareHost(
        alert.seriesLabels as JSONObject | undefined,
        data.hostName,
      );
    })
    .map(toVMwareHostOpenAlert)
    .filter(
      (event: VMwareHostOpenEvent | null): event is VMwareHostOpenEvent => {
        return event !== null;
      },
    );
}

/*
 * Both kinds, each on its own: a role that may read alerts but not
 * incidents still sees its alerts.
 */
export async function loadVMwareHostOpenEvents(data: {
  projectId: ObjectID;
  vcenterId: ObjectID;
  hostName: string;
}): Promise<VMwareHostOpenEvents> {
  const [incidents, alerts]: [
    Array<VMwareHostOpenEvent> | null,
    Array<VMwareHostOpenEvent> | null,
  ] = await Promise.all([
    loadOpenIncidents(data).catch(() => {
      return null;
    }),
    loadOpenAlerts(data).catch(() => {
      return null;
    }),
  ]);

  return { incidents: incidents, alerts: alerts };
}
