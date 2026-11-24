import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import ManagedDevice from "Common/Models/DatabaseModels/ManagedDevice";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import {
  getManagedDeviceSeriesNames,
  getManagedDeviceSeriesQuery,
  mayMonitorAlertOnManagedDevice,
} from "Common/Types/DeviceManagement/ManagedDeviceAlertScope";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import AlertStateUtil from "../../Utils/AlertState";
import IncidentStateUtil from "../../Utils/IncidentState";

/*
 * THE ALERTS AND INCIDENTS ABOUT ONE MANAGED DEVICE (#10007).
 *
 * A device manager's monitors raise one alert (or incident) per device,
 * and the record's series names the device by its readings' name. A device
 * the Android agent does not report has no Host row, so nothing else ties
 * the record to the device's Inventory item: its page finds them here,
 * by the names the device's readings carry
 * (ManagedDeviceAlertScope.getManagedDeviceSeriesNames) and the monitors
 * that may be about it - those of its own connection, or of none in
 * particular, never another connection's (mayMonitorAlertOnManagedDevice).
 *
 * Two reads find the monitors: the device's records' monitors, then those
 * monitors' steps, kept when they read the device's connection. The scope
 * found is then a plain query any alerts or incidents list takes.
 */

// What a device is named by, and its connection.
export interface ManagedDeviceAlertSubject {
  connectionId: ObjectID | string;
  deviceName?: string | undefined;
  serialNumber?: string | undefined;
  providerDeviceId?: string | undefined;
}

export interface ManagedDeviceAlertScope {
  // The names the device's readings carry it by.
  seriesNames: Array<string>;
  // The monitors whose records naming the device may be about it.
  monitorIds: Array<ObjectID>;
}

export type ManagedDeviceRecordKind = "alert" | "incident";

// The most of the device's records read to find the monitors that raised them.
const RECORDS_READ_FOR_MONITORS: number = LIMIT_PER_PROJECT;

// What a device's row is read with, to know it by its readings' names.
export const MANAGED_DEVICE_ALERT_SUBJECT_SELECT: {
  connectionId: true;
  deviceName: true;
  serialNumber: true;
  providerDeviceId: true;
} = {
  connectionId: true,
  deviceName: true,
  serialNumber: true,
  providerDeviceId: true,
};

export function toManagedDeviceAlertSubject(
  device: ManagedDevice,
): ManagedDeviceAlertSubject | null {
  if (!device.connectionId) {
    return null;
  }

  return {
    connectionId: device.connectionId,
    deviceName: device.deviceName,
    serialNumber: device.serialNumber,
    providerDeviceId: device.providerDeviceId,
  };
}

function uniqueIds(ids: Array<ObjectID | undefined>): Array<ObjectID> {
  const seen: Map<string, ObjectID> = new Map<string, ObjectID>();

  for (const id of ids) {
    if (id) {
      seen.set(id.toString(), new ObjectID(id.toString()));
    }
  }

  return Array.from(seen.values());
}

// The monitors the device's records of a kind were raised by.
async function loadRaisingMonitorIds(data: {
  kind: ManagedDeviceRecordKind;
  projectId: ObjectID;
  seriesNames: Array<string>;
}): Promise<Array<ObjectID>> {
  const seriesLabels: JSONObject = getManagedDeviceSeriesQuery(
    data.seriesNames,
  );

  if (data.kind === "alert") {
    const alerts: ListResult<Alert> = await ModelAPI.getList<Alert>({
      modelType: Alert,
      query: { projectId: data.projectId, seriesLabels } as Query<Alert>,
      select: { monitorId: true },
      sort: { createdAt: SortOrder.Descending },
      skip: 0,
      limit: RECORDS_READ_FOR_MONITORS,
    });

    return uniqueIds(
      alerts.data.map((alert: Alert): ObjectID | undefined => {
        return alert.monitorId;
      }),
    );
  }

  const incidents: ListResult<Incident> = await ModelAPI.getList<Incident>({
    modelType: Incident,
    query: { projectId: data.projectId, seriesLabels } as Query<Incident>,
    select: { monitors: { _id: true } },
    sort: { createdAt: SortOrder.Descending },
    skip: 0,
    limit: RECORDS_READ_FOR_MONITORS,
  });

  return uniqueIds(
    incidents.data.flatMap(
      (incident: Incident): Array<ObjectID | undefined> => {
        return (incident.monitors || []).map(
          (monitor: Monitor): ObjectID | undefined => {
            return monitor.id || undefined;
          },
        );
      },
    ),
  );
}

/*
 * The device's scope: the names its readings carry, and the monitors whose
 * records naming it may be about it. No monitor when no record names it.
 */
export async function loadManagedDeviceAlertScope(data: {
  kind: ManagedDeviceRecordKind;
  projectId: ObjectID;
  device: ManagedDeviceAlertSubject;
}): Promise<ManagedDeviceAlertScope> {
  const seriesNames: Array<string> = getManagedDeviceSeriesNames(data.device);

  if (seriesNames.length === 0) {
    return { seriesNames, monitorIds: [] };
  }

  const raisedBy: Array<ObjectID> = await loadRaisingMonitorIds({
    kind: data.kind,
    projectId: data.projectId,
    seriesNames,
  });

  if (raisedBy.length === 0) {
    return { seriesNames, monitorIds: [] };
  }

  const monitors: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
    modelType: Monitor,
    query: { _id: new Includes(raisedBy) } as Query<Monitor>,
    select: { _id: true, monitorSteps: true },
    sort: {},
    skip: 0,
    limit: raisedBy.length,
  });
  const connectionId: string = data.device.connectionId.toString();

  return {
    seriesNames,
    monitorIds: uniqueIds(
      monitors.data
        .filter((monitor: Monitor): boolean => {
          return mayMonitorAlertOnManagedDevice({
            monitorSteps: monitor.monitorSteps,
            connectionId,
          });
        })
        .map((monitor: Monitor): ObjectID | undefined => {
          return monitor.id || undefined;
        }),
    ),
  };
}

// Whether the scope can name any record at all.
export function hasManagedDeviceRecords(
  scope: ManagedDeviceAlertScope,
): boolean {
  return scope.seriesNames.length > 0 && scope.monitorIds.length > 0;
}

// The device's alerts, as an alerts list queries them.
export function getManagedDeviceAlertQuery(data: {
  projectId: ObjectID;
  scope: ManagedDeviceAlertScope;
}): Query<Alert> {
  return {
    projectId: data.projectId,
    seriesLabels: getManagedDeviceSeriesQuery(data.scope.seriesNames),
    monitorId: new Includes(data.scope.monitorIds),
  } as Query<Alert>;
}

// The device's incidents, as an incidents list queries them.
export function getManagedDeviceIncidentQuery(data: {
  projectId: ObjectID;
  scope: ManagedDeviceAlertScope;
}): Query<Incident> {
  return {
    projectId: data.projectId,
    seriesLabels: getManagedDeviceSeriesQuery(data.scope.seriesNames),
    monitors: new Includes(data.scope.monitorIds),
  } as Query<Incident>;
}

// How many open records a device's card lists: the newest first.
export const MANAGED_DEVICE_OPEN_RECORDS_SHOWN: number = 5;

export interface ManagedDeviceOpenRecords {
  alerts: Array<Alert>;
  alertCount: number;
  incidents: Array<Incident>;
  incidentCount: number;
}

/*
 * The device's open alerts and incidents, the newest first: what its card
 * says it is alerting with. None while nothing names it.
 */
export async function fetchManagedDeviceOpenRecords(data: {
  projectId: ObjectID;
  device: ManagedDeviceAlertSubject;
}): Promise<ManagedDeviceOpenRecords> {
  const [alertScope, incidentScope]: [
    ManagedDeviceAlertScope,
    ManagedDeviceAlertScope,
  ] = await Promise.all([
    loadManagedDeviceAlertScope({
      kind: "alert",
      projectId: data.projectId,
      device: data.device,
    }),
    loadManagedDeviceAlertScope({
      kind: "incident",
      projectId: data.projectId,
      device: data.device,
    }),
  ]);

  const open: ManagedDeviceOpenRecords = {
    alerts: [],
    alertCount: 0,
    incidents: [],
    incidentCount: 0,
  };

  if (hasManagedDeviceRecords(alertScope)) {
    const unresolved: Array<AlertState> =
      await AlertStateUtil.getUnresolvedAlertStates(data.projectId);
    const alerts: ListResult<Alert> = await ModelAPI.getList<Alert>({
      modelType: Alert,
      query: {
        ...getManagedDeviceAlertQuery({
          projectId: data.projectId,
          scope: alertScope,
        }),
        currentAlertStateId: new Includes(
          unresolved.map((state: AlertState): ObjectID => {
            return state.id!;
          }),
        ),
      } as Query<Alert>,
      select: {
        _id: true,
        title: true,
        alertNumberWithPrefix: true,
        createdAt: true,
        alertSeverity: { name: true, color: true },
      },
      sort: { createdAt: SortOrder.Descending },
      skip: 0,
      limit: MANAGED_DEVICE_OPEN_RECORDS_SHOWN,
    });

    open.alerts = alerts.data;
    open.alertCount = alerts.count;
  }

  if (hasManagedDeviceRecords(incidentScope)) {
    const unresolved: Array<IncidentState> =
      await IncidentStateUtil.getUnresolvedIncidentStates(data.projectId);
    const incidents: ListResult<Incident> = await ModelAPI.getList<Incident>({
      modelType: Incident,
      query: {
        ...getManagedDeviceIncidentQuery({
          projectId: data.projectId,
          scope: incidentScope,
        }),
        currentIncidentStateId: new Includes(
          unresolved.map((state: IncidentState): ObjectID => {
            return state.id!;
          }),
        ),
      } as Query<Incident>,
      select: {
        _id: true,
        title: true,
        incidentNumberWithPrefix: true,
        createdAt: true,
        incidentSeverity: { name: true, color: true },
      },
      sort: { createdAt: SortOrder.Descending },
      skip: 0,
      limit: MANAGED_DEVICE_OPEN_RECORDS_SHOWN,
    });

    open.incidents = incidents.data;
    open.incidentCount = incidents.count;
  }

  return open;
}
