import Monitor from "Common/Models/DatabaseModels/Monitor";
import Includes from "Common/Types/BaseDatabase/Includes";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { ObjectType } from "Common/Types/JSON";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepHostMonitor from "Common/Types/Monitor/MonitorStepHostMonitor";
import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "Common/Types/Monitor/MonitorStepMetricMonitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { MONITOR_PAUSE_FLAGS_SELECT } from "Common/Utils/Monitor/MonitorPauseState";
import { canonicalizeEntityValue } from "Common/Utils/Telemetry/EntityKey";
import { HOST_NAME_ATTR } from "../Pages/Host/Utils/SystemdUnits";
import {
  HOST_SERVICE_STATES,
  HostServiceKind,
  HostServiceStateDefinition,
} from "./HostServiceMonitorPrefill";

/*
 * WHICH MONITORS ALREADY WATCH A SERVICE ON A HOST (#10296).
 *
 * A service's page lists them, with links, so nobody makes a second one by
 * accident - and its Create Monitor says so when there is one. A monitor
 * watches the service when one of its steps reads the service's state on
 * the host:
 *
 *   - a Host monitor of this host (bound to it by id, else by its host name
 *     as ingest stores it: trimmed, lower case), or a Metrics monitor whose
 *     query names this host or no host at all;
 *   - with a query of the service's state metric (windows.service.status,
 *     systemd.unit.state) that names this service, or names none - one that
 *     groups by every service, as the host's Systemd Unit Failed alert does,
 *     watches this one too. A query that names another service does not.
 *
 * What a person typed as a filter is compared as it is stored: a name, or a
 * list of names. A PromQL step is not read: its expression is not parsed
 * here, so such a monitor is not listed.
 */

// What the list is read with: a link, a status and the steps to match.
export const HOST_SERVICE_MONITOR_SELECT: Select<Monitor> = {
  _id: true,
  name: true,
  monitorType: true,
  monitorSteps: true,
  currentMonitorStatus: {
    name: true,
    color: true,
  },
  ...MONITOR_PAUSE_FLAGS_SELECT,
};

// The kinds of monitor that can read a service's state.
export const HOST_SERVICE_MONITOR_TYPES: Array<MonitorType> = [
  MonitorType.Host,
  MonitorType.Metrics,
];

export interface HostServiceMonitorSubject {
  kind: HostServiceKind;
  // As the host's collector reports it.
  serviceName: string;
  hostId: string;
  hostIdentifier: string;
}

export interface HostServiceMonitorMatch {
  monitor: Monitor;
  /*
   * The monitor names this service. False for one that reads every service
   * (it groups by them, or names none), which watches this one among them.
   */
  isForThisService: boolean;
}

// The words of the service page's Monitors card.
export interface HostServiceMonitorsCopy {
  description: string;
  empty: string;
  readFailed: string;
}

export const HOST_SERVICE_MONITORS_TITLE: string = translationKey("Monitors");

export const CREATE_MONITOR: string = translationKey("Create Monitor");

// What Create Monitor says while a monitor already watches the service.
export const CREATE_ANOTHER_MONITOR: string = translationKey(
  "Create Another Monitor",
);

export const HOST_SERVICE_MONITORS_COPY: Record<
  HostServiceKind,
  HostServiceMonitorsCopy
> = {
  [HostServiceKind.WindowsService]: {
    description: translationKey(
      "Monitors that watch this service and open an incident when it stops running.",
    ),
    empty: translationKey("No monitor watches this service yet."),
    readFailed: translationKey(
      "Couldn't read the monitors that watch this service.",
    ),
  },
  [HostServiceKind.SystemdUnit]: {
    description: translationKey(
      "Monitors that watch this unit and open an incident when it stops being active.",
    ),
    empty: translationKey("No monitor watches this unit yet."),
    readFailed: translationKey(
      "Couldn't read the monitors that watch this unit.",
    ),
  },
};

// How a filter's value compares with a name: equal, another, or none at all.
enum FilterMatch {
  Named = "Named",
  Other = "Other",
  None = "None",
}

function readFilterValues(value: unknown): Array<string> | null {
  if (typeof value === "string") {
    return [value];
  }

  if (value instanceof Includes) {
    return value.values.map((item: unknown): string => {
      return String(item);
    });
  }

  if (
    value &&
    typeof value === "object" &&
    (value as { _type?: unknown })._type === ObjectType.Includes &&
    Array.isArray((value as { value?: unknown }).value)
  ) {
    return ((value as { value: Array<unknown> }).value || []).map(
      (item: unknown): string => {
        return String(item);
      },
    );
  }

  return null;
}

function matchFilter(data: {
  value: unknown;
  name: string;
  isSameName: (a: string, b: string) => boolean;
}): FilterMatch {
  if (data.value === undefined || data.value === null || data.value === "") {
    return FilterMatch.None;
  }

  const values: Array<string> | null = readFilterValues(data.value);

  // A filter this cannot read (a search, say) is not counted as this one.
  if (!values) {
    return FilterMatch.Other;
  }

  return values.some((value: string): boolean => {
    return data.isSameName(value, data.name);
  })
    ? FilterMatch.Named
    : FilterMatch.Other;
}

// Host names as ingest stores them: trimmed, in lower case.
function isSameHostName(a: string, b: string): boolean {
  return (
    canonicalizeEntityValue(a) !== "" &&
    canonicalizeEntityValue(a) === canonicalizeEntityValue(b)
  );
}

// A service's name exactly as the collector reports it.
function isSameServiceName(a: string, b: string): boolean {
  return a === b;
}

function isHostMonitorOfHost(
  hostMonitor: MonitorStepHostMonitor,
  subject: HostServiceMonitorSubject,
): boolean {
  const resourceId: string = String(hostMonitor.resourceId || "").trim();

  // Bound by id: the worker follows the host by it, whatever its name.
  if (resourceId) {
    return resourceId.toLowerCase() === subject.hostId.trim().toLowerCase();
  }

  return isSameHostName(
    String(hostMonitor.hostIdentifier || ""),
    subject.hostIdentifier,
  );
}

/*
 * Whether one query reads the service's state, and whether it names the
 * service: null when it does not read it.
 */
function readsServiceState(data: {
  queryConfig: MetricQueryConfigData;
  state: HostServiceStateDefinition;
  subject: HostServiceMonitorSubject;
  // A Metrics monitor names its host in the query; a Host monitor does not.
  isHostInQuery: boolean;
}): { isForThisService: boolean } | null {
  const filterData: Record<string, unknown> = (data.queryConfig.metricQueryData
    ?.filterData || {}) as unknown as Record<string, unknown>;

  if (String(filterData["metricName"] || "") !== data.state.metricName) {
    return null;
  }

  const attributes: Record<string, unknown> =
    (filterData["attributes"] as Record<string, unknown> | undefined) || {};

  if (
    data.isHostInQuery &&
    matchFilter({
      value: attributes[HOST_NAME_ATTR],
      name: data.subject.hostIdentifier,
      isSameName: isSameHostName,
    }) === FilterMatch.Other
  ) {
    return null;
  }

  const service: FilterMatch = matchFilter({
    value: attributes[data.state.nameAttribute],
    name: data.subject.serviceName,
    isSameName: isSameServiceName,
  });

  if (service === FilterMatch.Other) {
    return null;
  }

  return { isForThisService: service === FilterMatch.Named };
}

// Whether one step reads the service's state on the host, and how.
function stepWatchesService(
  step: MonitorStep,
  subject: HostServiceMonitorSubject,
): { isForThisService: boolean } | null {
  const state: HostServiceStateDefinition = HOST_SERVICE_STATES[subject.kind];
  const hostMonitor: MonitorStepHostMonitor | undefined =
    step.data?.hostMonitor;
  const metricMonitor: MonitorStepMetricMonitor | undefined =
    step.data?.metricMonitor;

  let queryConfigs: Array<MetricQueryConfigData> = [];
  let isHostInQuery: boolean = false;

  if (hostMonitor) {
    if (!isHostMonitorOfHost(hostMonitor, subject)) {
      return null;
    }

    queryConfigs = hostMonitor.metricViewConfig?.queryConfigs || [];
  } else if (
    metricMonitor &&
    !MonitorStepMetricMonitorUtil.isPromQL(metricMonitor)
  ) {
    queryConfigs = metricMonitor.metricViewConfig?.queryConfigs || [];
    isHostInQuery = true;
  } else {
    return null;
  }

  let found: { isForThisService: boolean } | null = null;

  for (const queryConfig of queryConfigs) {
    const reads: { isForThisService: boolean } | null = readsServiceState({
      queryConfig: queryConfig,
      state: state,
      subject: subject,
      isHostInQuery: isHostInQuery,
    });

    if (reads && (!found || reads.isForThisService)) {
      found = reads;
    }
  }

  return found;
}

/*
 * The monitors, of those handed in, that watch the service on the host, in
 * the order they were handed in.
 */
export function findMonitorsWatchingHostService(data: {
  monitors: Array<Monitor>;
  subject: HostServiceMonitorSubject;
}): Array<HostServiceMonitorMatch> {
  const matches: Array<HostServiceMonitorMatch> = [];

  for (const monitor of data.monitors) {
    if (
      !monitor.monitorType ||
      !HOST_SERVICE_MONITOR_TYPES.includes(monitor.monitorType)
    ) {
      continue;
    }

    let found: { isForThisService: boolean } | null = null;

    for (const step of monitor.monitorSteps?.data?.monitorStepsInstanceArray ||
      []) {
      const watches: { isForThisService: boolean } | null = stepWatchesService(
        step,
        data.subject,
      );

      if (watches && (!found || watches.isForThisService)) {
        found = watches;
      }
    }

    if (found) {
      matches.push({
        monitor: monitor,
        isForThisService: found.isForThisService,
      });
    }
  }

  return matches;
}

/*
 * The project's Host and Metrics monitors that are not archived, by name,
 * and of them the ones that watch the service.
 */
export async function loadMonitorsWatchingHostService(
  subject: HostServiceMonitorSubject,
): Promise<Array<HostServiceMonitorMatch>> {
  const result: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
    modelType: Monitor,
    query: {
      monitorType: new Includes(HOST_SERVICE_MONITOR_TYPES),
      isArchived: false,
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    select: HOST_SERVICE_MONITOR_SELECT,
    sort: {
      name: SortOrder.Ascending,
    },
  });

  return findMonitorsWatchingHostService({
    monitors: result.data,
    subject: subject,
  });
}
