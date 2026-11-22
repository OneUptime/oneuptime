import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useState } from "react";
import AlertStateUtil from "../../../Utils/AlertState";
import IncidentStateUtil from "../../../Utils/IncidentState";
import { shouldAttemptRead } from "../../../Utils/OverviewSection";

// An incident or alert open for one series of a grouped monitor.
export interface MonitorSeriesOpenRecord {
  kind: "Incident" | "Alert";
  id: string;
  // Its number as the project writes it: "INC-12", "#12".
  number: string;
}

// A record as it was read, with the series it is open for.
interface ReadRecord extends MonitorSeriesOpenRecord {
  fingerprint: string;
}

/*
 * How many open records of one kind are read for each listed series: one
 * per criteria that opens them is the most there can be, in one request for
 * every series, never the whole project's.
 */
const RECORDS_READ_PER_SERIES: number = 4;

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

type NumberOfFunction = (data: {
  numberWithPrefix: string | undefined;
  number: number | undefined;
}) => string;

const numberOf: NumberOfFunction = (data: {
  numberWithPrefix: string | undefined;
  number: number | undefined;
}): string => {
  if (data.numberWithPrefix) {
    return data.numberWithPrefix;
  }

  return data.number !== undefined && data.number !== null
    ? `#${data.number}`
    : "";
};

type ReadOpenIncidentsFunction = (data: {
  projectId: ObjectID;
  monitorId: ObjectID;
  fingerprints: Array<string>;
}) => Promise<Array<ReadRecord>>;

const readOpenIncidents: ReadOpenIncidentsFunction = async (data: {
  projectId: ObjectID;
  monitorId: ObjectID;
  fingerprints: Array<string>;
}): Promise<Array<ReadRecord>> => {
  if (!shouldAttemptRead(PermissionGate.check(new Incident(), ModelAction.Read))) {
    return [];
  }

  const stateIds: Array<ObjectID> = getStateIds(
    await IncidentStateUtil.getUnresolvedIncidentStates(data.projectId),
  );

  // An empty Includes is not a query worth sending.
  if (stateIds.length === 0) {
    return [];
  }

  const result: ListResult<Incident> = await ModelAPI.getList<Incident>({
    modelType: Incident,
    query: {
      projectId: data.projectId,
      monitors: new Includes([data.monitorId]),
      currentIncidentStateId: new Includes(stateIds),
      seriesFingerprint: new Includes(data.fingerprints),
    },
    select: {
      _id: true,
      incidentNumber: true,
      incidentNumberWithPrefix: true,
      seriesFingerprint: true,
    },
    sort: {
      createdAt: SortOrder.Descending,
    },
    limit: data.fingerprints.length * RECORDS_READ_PER_SERIES,
    skip: 0,
  });

  return (result.data || []).map((incident: Incident): ReadRecord => {
    return {
      kind: "Incident",
      id: incident._id?.toString() || "",
      number: numberOf({
        numberWithPrefix: incident.incidentNumberWithPrefix,
        number: incident.incidentNumber,
      }),
      fingerprint: incident.seriesFingerprint || "",
    };
  });
};

type ReadOpenAlertsFunction = (data: {
  projectId: ObjectID;
  monitorId: ObjectID;
  fingerprints: Array<string>;
}) => Promise<Array<ReadRecord>>;

const readOpenAlerts: ReadOpenAlertsFunction = async (data: {
  projectId: ObjectID;
  monitorId: ObjectID;
  fingerprints: Array<string>;
}): Promise<Array<ReadRecord>> => {
  if (!shouldAttemptRead(PermissionGate.check(new Alert(), ModelAction.Read))) {
    return [];
  }

  const stateIds: Array<ObjectID> = getStateIds(
    await AlertStateUtil.getUnresolvedAlertStates(data.projectId),
  );

  if (stateIds.length === 0) {
    return [];
  }

  const result: ListResult<Alert> = await ModelAPI.getList<Alert>({
    modelType: Alert,
    query: {
      projectId: data.projectId,
      monitorId: data.monitorId,
      currentAlertStateId: new Includes(stateIds),
      seriesFingerprint: new Includes(data.fingerprints),
    },
    select: {
      _id: true,
      alertNumber: true,
      alertNumberWithPrefix: true,
      seriesFingerprint: true,
    },
    sort: {
      createdAt: SortOrder.Descending,
    },
    limit: data.fingerprints.length * RECORDS_READ_PER_SERIES,
    skip: 0,
  });

  return (result.data || []).map((alert: Alert): ReadRecord => {
    return {
      kind: "Alert",
      id: alert._id?.toString() || "",
      number: numberOf({
        numberWithPrefix: alert.alertNumberWithPrefix,
        number: alert.alertNumber,
      }),
      fingerprint: alert.seriesFingerprint || "",
    };
  });
};

// A kind that could not be read adds nothing; the other still shows.
const settle: (
  read: Promise<Array<ReadRecord>>,
) => Promise<Array<ReadRecord>> = async (
  read: Promise<Array<ReadRecord>>,
): Promise<Array<ReadRecord>> => {
  try {
    return await read;
  } catch {
    return [];
  }
};

/*
 * The open incidents and alerts of a grouped monitor's listed series
 * (#10062), by series fingerprint: what the Series card shows beside each
 * series. "Open" is every state before the project's first resolved state,
 * as the Open incidents & alerts card reads them. A kind the reader may not
 * read, or that could not be read, adds nothing: the card shows its quiet
 * dash for it. Read again when the refresh token or the series change.
 */
export const useMonitorSeriesOpenRecords: (options: {
  monitorId: ObjectID;
  fingerprints: Array<string>;
  refreshToken: string;
}) => Map<string, Array<MonitorSeriesOpenRecord>> = (options: {
  monitorId: ObjectID;
  fingerprints: Array<string>;
  refreshToken: string;
}): Map<string, Array<MonitorSeriesOpenRecord>> => {
  const [records, setRecords] = useState<
    Map<string, Array<MonitorSeriesOpenRecord>>
  >(new Map<string, Array<MonitorSeriesOpenRecord>>());

  const monitorIdString: string = options.monitorId.toString();
  const fingerprintsKey: string = options.fingerprints.join(",");

  useEffect(() => {
    let cancelled: boolean = false;
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    const fingerprints: Array<string> = options.fingerprints;

    if (!projectId || fingerprints.length === 0) {
      setRecords(new Map<string, Array<MonitorSeriesOpenRecord>>());
      return;
    }

    const query: {
      projectId: ObjectID;
      monitorId: ObjectID;
      fingerprints: Array<string>;
    } = {
      projectId: projectId,
      monitorId: options.monitorId,
      fingerprints: fingerprints,
    };

    Promise.all([
      settle(readOpenIncidents(query)),
      settle(readOpenAlerts(query)),
    ])
      .then(([incidents, alerts]: [Array<ReadRecord>, Array<ReadRecord>]) => {
        if (cancelled) {
          return;
        }

        const bySeries: Map<string, Array<MonitorSeriesOpenRecord>> = new Map<
          string,
          Array<MonitorSeriesOpenRecord>
        >();

        for (const record of [...incidents, ...alerts]) {
          if (!record.id || !record.fingerprint) {
            continue;
          }

          const forSeries: Array<MonitorSeriesOpenRecord> =
            bySeries.get(record.fingerprint) || [];

          forSeries.push({
            kind: record.kind,
            id: record.id,
            number: record.number,
          });
          bySeries.set(record.fingerprint, forSeries);
        }

        setRecords(bySeries);
      })
      .catch(() => {
        // settle never rejects; nothing else here can throw.
      });

    return () => {
      cancelled = true;
    };
  }, [monitorIdString, fingerprintsKey, options.refreshToken]);

  return records;
};

export default useMonitorSeriesOpenRecords;
