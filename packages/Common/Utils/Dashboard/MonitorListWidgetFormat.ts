import Includes from "../../Types/BaseDatabase/Includes";
import { Gray500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import { translationKey } from "../../Types/Translator";
import MonitoringOff, { MonitoringOffFlags } from "../Monitor/MonitoringOff";
import NotOperationalMonitorQuery from "../Monitor/NotOperationalMonitorQuery";

/*
 * The dashboard Monitor List widget's rules: which monitors a stored filter
 * lists, and what a row says a monitor's status is.
 *
 * The widget in the browser and the public-dashboard policy on the server
 * (Server/Utils/Dashboard/PublicDashboardResourceListPolicy) both build their
 * query from getMonitorListQuery, so a board and its public page cannot list
 * different monitors. React-free and server-safe.
 *
 * A monitor whose monitoring is turned off is not checked, so its status is
 * frozen at what its last check saw (Utils/Monitor/MonitoringOff). The list
 * keeps it - it is still one of the project's monitors - but says "Disabled"
 * instead of that status, as the Monitors table does, and a status filter
 * never matches it: "non-operational" would list a monitor nobody is
 * checking as down, and "operational" one as up. The SLO List widget treats
 * a disabled SLO the same way (Utils/Slo/SloListWidgetFormat).
 */

export const MONITOR_LIST_STATUS_FILTER_OPERATIONAL: string = "operational";
export const MONITOR_LIST_STATUS_FILTER_NON_OPERATIONAL: string =
  "non-operational";

// The values the widget's "Operational Status" setting stores, besides none.
export const MONITOR_LIST_STATUS_FILTER_VALUES: Array<string> = [
  MONITOR_LIST_STATUS_FILTER_OPERATIONAL,
  MONITOR_LIST_STATUS_FILTER_NON_OPERATIONAL,
];

// The word the Monitors table's status bubble puts on such a monitor.
export const MONITOR_LIST_MONITORING_OFF_STATUS_LABEL: string =
  translationKey("Disabled");

export const MONITOR_LIST_MONITORING_OFF_STATUS_COLOR: Color = Gray500;

// The same word the row has always drawn for a monitor read with no status.
export const MONITOR_LIST_NO_STATUS_LABEL: string = "Unknown";

export interface MonitorListFilter {
  // "operational", "non-operational", or none.
  statusFilter?: string | undefined | null;
  // The project's monitor statuses the list is kept to, if any.
  monitorStatusIds?: Array<string> | undefined | null;
}

/*
 * The stored status settings as query predicates.
 *
 * - Always: archived monitors are left out. Archiving retires a monitor and
 *   takes it out of every monitor list, and nothing checks it any more.
 * - "non-operational": NotOperationalMonitorQuery, the rule of every Not
 *   Operational list and count in the app.
 * - "operational": an operational status, among the monitors that are
 *   checked.
 * - Picked statuses: one of them, among the monitors that are checked.
 *
 * With no status setting a monitor whose monitoring is off stays listed, and
 * its row says Disabled (getMonitorListRowStatus).
 *
 * Validating the stored values is the caller's job: the public policy refuses
 * a status filter outside MONITOR_LIST_STATUS_FILTER_VALUES and a status id
 * that is not text, and the settings form offers nothing else.
 */
export type GetMonitorListQueryFunction = (
  filter: MonitorListFilter,
) => Record<string, unknown>;

export const getMonitorListQuery: GetMonitorListQueryFunction = (
  filter: MonitorListFilter,
): Record<string, unknown> => {
  const query: Record<string, unknown> = { isArchived: false };

  if (filter.statusFilter === MONITOR_LIST_STATUS_FILTER_NON_OPERATIONAL) {
    Object.assign(query, NotOperationalMonitorQuery.getQuery());
  } else if (filter.statusFilter === MONITOR_LIST_STATUS_FILTER_OPERATIONAL) {
    Object.assign(query, MonitoringOff.getMonitoredQuery(), {
      currentMonitorStatus: { isOperationalState: true },
    });
  }

  if (filter.monitorStatusIds && filter.monitorStatusIds.length > 0) {
    Object.assign(query, MonitoringOff.getMonitoredQuery(), {
      currentMonitorStatusId: new Includes(filter.monitorStatusIds),
    });
  }

  return query;
};

export interface MonitorListRowData extends MonitoringOffFlags {
  currentMonitorStatus?:
    | {
        name?: string | undefined | null;
        color?: Color | undefined | null;
      }
    | undefined
    | null;
}

export interface MonitorListRowStatus {
  /*
   * MONITOR_LIST_MONITORING_OFF_STATUS_LABEL, a key the widget looks up in
   * the reader's language, when monitoring is off; otherwise the project's
   * own status name, as stored.
   */
  text: string;
  // The status's colour, or null when the monitor was read with none.
  color: Color | null;
  isMonitoringOff: boolean;
}

/*
 * What a row (or a honeycomb tile) says a monitor's status is: Disabled, in
 * gray, for a monitor whose monitoring is off, whatever status it was frozen
 * at; otherwise its current status.
 */
export type GetMonitorListRowStatusFunction = (
  monitor: MonitorListRowData,
) => MonitorListRowStatus;

export const getMonitorListRowStatus: GetMonitorListRowStatusFunction = (
  monitor: MonitorListRowData,
): MonitorListRowStatus => {
  if (MonitoringOff.isOff(monitor)) {
    return {
      text: MONITOR_LIST_MONITORING_OFF_STATUS_LABEL,
      color: MONITOR_LIST_MONITORING_OFF_STATUS_COLOR,
      isMonitoringOff: true,
    };
  }

  return {
    text: monitor.currentMonitorStatus?.name || MONITOR_LIST_NO_STATUS_LABEL,
    color: monitor.currentMonitorStatus?.color || null,
    isMonitoringOff: false,
  };
};

/*
 * The fields a row draws. The public endpoint pins this same select
 * server-side (PublicDashboardResourceListPolicy), so the column that says
 * monitoring is off reaches a public page too.
 */
export const MONITOR_LIST_WIDGET_SELECT: {
  _id: true;
  name: true;
  monitorType: true;
  disableActiveMonitoring: true;
  currentMonitorStatus: { name: true; color: true };
} = {
  _id: true,
  name: true,
  monitorType: true,
  disableActiveMonitoring: true,
  currentMonitorStatus: { name: true, color: true },
};
