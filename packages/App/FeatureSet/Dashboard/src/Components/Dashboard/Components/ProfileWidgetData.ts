import Route from "Common/Types/API/Route";
import { DashboardProfileTopFunctionsRank } from "Common/Types/Dashboard/DashboardComponents/DashboardProfileTopFunctionsComponent";
import DashboardVariable, {
  DashboardVariableType,
} from "Common/Types/Dashboard/DashboardVariable";
import DashboardVariableInterpolation, {
  ResolvedVariableValue,
} from "Common/Utils/Dashboard/VariableInterpolation";
import { getShareOfWindow } from "Common/Utils/Profiles/ProfileHotspot";
import { ProfileCategory } from "Common/Utils/Profiles/ProfileTypes";
import {
  ProfileFunctionRow,
  getFunctionListSort,
  getShownFunctionRows,
} from "../../../Utils/ProfilesView";
import {
  MAX_PROFILES_WINDOW_MINUTES,
  buildProfilesRoute,
} from "../../../Utils/ProfilesUrlState";

/*
 * WHAT A PROFILE WIDGET READS, AND WHAT IT DRAWS FROM IT.
 *
 * The dashboard's Flame Graph and Top Functions widgets read the Profiler's
 * own reads - the kinds a scope has data for, then its flame graph or its
 * ranked functions - so a tile and the Profiler one click later agree to
 * the sample. What is left to decide is the dashboard's part, and it is
 * decided here, React-free, so App's tests pin each rule in plain Node:
 *
 *   - the window: the dashboard's time range, the newest 7 days of it at
 *     most - the Profiler's longest window, and a read that fits the
 *     server's interactive time limit;
 *   - the services: the one the widget is pinned to, else the ones the
 *     dashboard's service variable picks, else every profiled service;
 *   - the rows: the Profiler's ranking (getShownFunctionRows), each with
 *     its share of the window in the ranked measure;
 *   - the Profiler's address for the tile, or for one of its functions.
 */

const MINUTE_MS: number = 60 * 1000;

// The longest stretch a widget reads: the Profiler's longest window.
export const PROFILE_WIDGET_MAX_WINDOW_MS: number =
  MAX_PROFILES_WINDOW_MINUTES * MINUTE_MS;

export interface ProfileWidgetWindow {
  startTime: Date;
  endTime: Date;
  // True when the dashboard's range was longer and only its end is read.
  isCapped: boolean;
}

/*
 * The window a widget reads for the dashboard's range: all of it, or its
 * newest 7 days when it is longer. Null when the range is no window at
 * all (no start, no end, or an end before its start).
 */
export function getProfileWidgetWindow(data: {
  startTime: Date | undefined;
  endTime: Date | undefined;
}): ProfileWidgetWindow | null {
  const start: number | undefined = data.startTime?.getTime();
  const end: number | undefined = data.endTime?.getTime();

  if (
    start === undefined ||
    end === undefined ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start
  ) {
    return null;
  }

  if (end - start > PROFILE_WIDGET_MAX_WINDOW_MS) {
    return {
      startTime: new Date(end - PROFILE_WIDGET_MAX_WINDOW_MS),
      endTime: new Date(end),
      isCapped: true,
    };
  }

  return {
    startTime: new Date(start),
    endTime: new Date(end),
    isCapped: false,
  };
}

/*
 * The attribute keys a dashboard's service variable is bound to: the
 * resource attribute every OpenTelemetry SDK sends (the Metrics template's
 * variable), and the same key without its "resource." prefix.
 */
export const PROFILE_WIDGET_SERVICE_VARIABLE_KEYS: ReadonlyArray<string> = [
  "resource.service.name",
  "service.name",
];

/*
 * The service names the dashboard's service variables pick, each once, in
 * the order they are picked; null when none picks one (no such variable,
 * or every one of them on All). Read as every widget reads a variable
 * (DashboardVariableInterpolation.resolveValue): a multi-select's picks, a
 * single-select's pick or its default.
 */
export function getProfileWidgetServiceNames(
  variables: ReadonlyArray<DashboardVariable> | undefined,
): Array<string> | null {
  const names: Array<string> = [];

  for (const variable of variables || []) {
    if (
      variable.type !== DashboardVariableType.TelemetryAttribute ||
      !PROFILE_WIDGET_SERVICE_VARIABLE_KEYS.includes(
        (variable.attributeKey || "").trim(),
      )
    ) {
      continue;
    }

    const resolved: ResolvedVariableValue | undefined =
      DashboardVariableInterpolation.resolveValue(variable);

    const picked: Array<string> = resolved?.multi
      ? resolved.multi
      : resolved?.scalar !== undefined
        ? [resolved.scalar]
        : [];

    for (const value of picked) {
      const name: string = String(value).trim();

      if (name && !names.includes(name)) {
        names.push(name);
      }
    }
  }

  return names.length > 0 ? names : null;
}

/*
 * Which services a widget reads:
 *
 *   pinned          the one its settings name - a pick in the toolbar
 *                   does not move a tile someone pinned;
 *   variable        the ones the dashboard's service variable picks,
 *                   once their names are found (`variableServiceIds`);
 *   all             every profiled service.
 *
 * `serviceIds` is what the reads send: undefined for every service, and
 * an empty list when the picked names match no service - the widget then
 * says it has nothing, and reads nothing.
 */
export type ProfileWidgetScopeKind = "pinned" | "variable" | "all";

export interface ProfileWidgetScope {
  kind: ProfileWidgetScopeKind;
  serviceIds: Array<string> | undefined;
}

export function getProfileWidgetScope(data: {
  pinnedServiceId: string | null;
  variableServiceNames: Array<string> | null;
  variableServiceIds: Array<string> | null;
}): ProfileWidgetScope {
  if (data.pinnedServiceId) {
    return { kind: "pinned", serviceIds: [data.pinnedServiceId] };
  }

  if (data.variableServiceNames && data.variableServiceNames.length > 0) {
    return {
      kind: "variable",
      serviceIds: [...(data.variableServiceIds || [])],
    };
  }

  return { kind: "all", serviceIds: undefined };
}

/*
 * How many functions the Top Functions widget reads to rank: more than it
 * lists, so a ranking that leaves rows out (Your code lists only the
 * application's own functions) still fills the tile.
 */
export const PROFILE_WIDGET_FUNCTION_READ_LIMIT: number = 100;

// The server's sort for a ranking, as the Profiler sends it.
export function getProfileWidgetFunctionSort(
  rank: DashboardProfileTopFunctionsRank,
): "selfValue" | "totalValue" | "ownValue" {
  return getFunctionListSort(rank);
}

// One function as the Top Functions widget lists it.
export interface ProfileWidgetFunctionRow {
  functionName: string;
  fileName: string;
  lineNumber: number;
  frameType: string;
  // Its share of the window (0-100) in the measure the widget ranks by.
  share: number;
  // That measure's value, in the kind's unit.
  value: number;
}

function getRankedValue(
  row: ProfileFunctionRow,
  rank: DashboardProfileTopFunctionsRank,
): number {
  switch (rank) {
    case "total":
      return row.totalValue;
    case "own":
      return row.ownValue;
    default:
      return row.selfValue;
  }
}

/*
 * The rows the widget lists: the Profiler's ranking of the functions read
 * (getShownFunctionRows - Your code keeps the application's own), at most
 * `maxRows`, each with its share of the window's total.
 */
export function getProfileWidgetFunctionRows(data: {
  rows: ReadonlyArray<ProfileFunctionRow>;
  windowTotal: number;
  rank: DashboardProfileTopFunctionsRank;
  maxRows: number;
}): Array<ProfileWidgetFunctionRow> {
  return getShownFunctionRows(data.rows, data.rank, data.maxRows).map(
    (row: ProfileFunctionRow): ProfileWidgetFunctionRow => {
      const value: number = getRankedValue(row, data.rank);

      return {
        functionName: row.functionName,
        fileName: row.fileName,
        lineNumber: row.lineNumber,
        frameType: row.frameType,
        share: getShareOfWindow(value, data.windowTotal),
        value,
      };
    },
  );
}

/*
 * The Profiler, pointed at what a widget shows: its service (when it reads
 * one), its kind, and the window it read - with one function's panel open
 * when a row was picked. A widget reading several services (a multi-pick
 * of the service variable) opens the Profiler on every service, the scope
 * the Profiler can show at once.
 */
export function getProfileWidgetProfilerRoute(data: {
  serviceIds: Array<string> | undefined;
  kind: ProfileCategory;
  window: ProfileWidgetWindow;
  functionName?: string | undefined;
  fileName?: string | undefined;
}): Route {
  const serviceId: string | undefined =
    data.serviceIds && data.serviceIds.length === 1
      ? data.serviceIds[0]
      : undefined;

  return buildProfilesRoute({
    serviceId,
    profileType: data.kind,
    startTime: data.window.startTime,
    endTime: data.window.endTime,
    functionName: data.functionName || undefined,
    fileName: data.functionName ? data.fileName || undefined : undefined,
  });
}

/*
 * The services a widget reads, as one key: the same set in any order is
 * the same key, every service is "all", and no service at all - picked
 * names that match none - is "none".
 */
export function getProfileWidgetServicesKey(
  serviceIds: Array<string> | undefined,
): string {
  if (serviceIds === undefined) {
    return "all";
  }

  return serviceIds.length > 0 ? [...serviceIds].sort().join(",") : "none";
}

/*
 * Stable keys for a widget's reads: a setting that changes nothing it
 * reads must not read again, and one that does must.
 */
export function getProfileWidgetScopeKey(data: {
  window: ProfileWidgetWindow;
  serviceIds: Array<string> | undefined;
}): string {
  return [
    data.window.startTime.toISOString(),
    data.window.endTime.toISOString(),
    getProfileWidgetServicesKey(data.serviceIds),
  ].join("|");
}
