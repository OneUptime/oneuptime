import Includes from "../../Types/BaseDatabase/Includes";
import NotNull from "../../Types/BaseDatabase/NotNull";
import { Gray500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import ObjectID from "../../Types/ObjectID";
import { translationKey } from "../../Types/Translator";
import MonitoringOff from "../Monitor/MonitoringOff";
import MonitorRowStatusUtil, {
  MONITOR_ROW_STATUS_SELECT,
  MonitorRowStatus,
  MonitorRowStatusFields,
  MonitorRowStatusKind,
} from "../Monitor/MonitorRowStatus";
import NotOperationalMonitorQuery from "../Monitor/NotOperationalMonitorQuery";

/*
 * The dashboard Monitor List widget's rules: which monitors a stored filter
 * lists, and what a row says a monitor's status is.
 *
 * The widget in the browser and the public-dashboard policy on the server
 * (Server/Utils/Dashboard/PublicDashboardResourceListPolicy) both build their
 * query from getMonitorListQuery, so a board and its public page cannot list
 * different monitors. The board passes its project as well, which names the
 * same monitors and reads them differently (getMonitorListQuery). React-free
 * and server-safe.
 *
 * A monitor whose monitoring is turned off is not checked, so its status is
 * frozen at what its last check saw (Utils/Monitor/MonitoringOff). The list
 * keeps it - it is still one of the project's monitors - but says "Disabled"
 * instead of that status, as the Monitors table does, and a status filter
 * never matches it: "non-operational" would list a monitor nobody is
 * checking as down, and "operational" one as up. The SLO List widget treats
 * a disabled SLO the same way (Utils/Slo/SloListWidgetFormat).
 *
 * A row says what the Monitors table's row says, from the one rule both
 * read (Utils/Monitor/MonitorRowStatus): Disabled, No Probe Enabled or
 * Probes Disconnected where nothing checks the monitor, and Waiting for
 * data, No results yet or Paused where nothing has checked it yet and it
 * is still in the operational status it was created in (issue #8899).
 * "operational" lists none of those last: no check stands behind their
 * Operational, as none stands behind a turned-off monitor's.
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
 *   checked and have been measured (Monitor.firstMeasuredAt): a monitor
 *   nothing has checked yet holds the operational status it was created in,
 *   and its row says Waiting for data, not Operational. A manual monitor is
 *   stamped measured when it is created: its status is a person's word.
 * - Picked statuses: one of them, among the monitors that are checked. It
 *   asks for the stored status, as the Monitors list's Status filter does:
 *   a row it lists that nothing has checked yet still says so.
 *
 * With no status setting a monitor whose monitoring is off stays listed, and
 * its row says Disabled (getMonitorListRowStatus).
 *
 * Validating the stored values is the caller's job: the public policy refuses
 * a status filter outside MONITOR_LIST_STATUS_FILTER_VALUES and a status id
 * that is not text, and the settings form offers nothing else.
 *
 * Given the project the list is read in, "non-operational" asks for the
 * status in that project too (NotOperationalMonitorQuery, issue #8096): the
 * same monitors, but Postgres starts from the project's few statuses that
 * are not operational instead of reading every monitor of the project. That
 * pays where the read comes with a count, as the board's does (a list counts
 * what it lists), and the board passes its project. The public page's read
 * fetches a page and no count, and for a page alone the plain query is the
 * cheaper one in a big project, so its policy passes none. "operational" is
 * asked as before either way: most monitors hold an operational status, so
 * starting from the statuses would not narrow the read.
 */
export type GetMonitorListQueryFunction = (
  filter: MonitorListFilter,
  projectId?: ObjectID | string | null | undefined,
) => Record<string, unknown>;

export const getMonitorListQuery: GetMonitorListQueryFunction = (
  filter: MonitorListFilter,
  projectId?: ObjectID | string | null | undefined,
): Record<string, unknown> => {
  const query: Record<string, unknown> = { isArchived: false };

  if (filter.statusFilter === MONITOR_LIST_STATUS_FILTER_NON_OPERATIONAL) {
    Object.assign(query, NotOperationalMonitorQuery.getQuery(projectId));
  } else if (filter.statusFilter === MONITOR_LIST_STATUS_FILTER_OPERATIONAL) {
    Object.assign(query, MonitoringOff.getMonitoredQuery(), {
      currentMonitorStatus: { isOperationalState: true },
      firstMeasuredAt: new NotNull(),
    });
  }

  if (filter.monitorStatusIds && filter.monitorStatusIds.length > 0) {
    Object.assign(query, MonitoringOff.getMonitoredQuery(), {
      currentMonitorStatusId: new Includes(filter.monitorStatusIds),
    });
  }

  return query;
};

export type MonitorListRowData = MonitorRowStatusFields;

export interface MonitorListRowStatus extends MonitorRowStatus {
  /*
   * Whether the row says Disabled because the monitor's monitoring is off
   * (MonitorRowStatusKind.MonitoringOff), whatever status it was frozen at.
   */
  isMonitoringOff: boolean;
}

/*
 * What a row (or a honeycomb tile) says a monitor's status is: the rule the
 * Monitors table's rows read too (MonitorRowStatus). Disabled, in gray, for
 * a monitor whose monitoring is off, whatever status it was frozen at; the
 * page's words where nothing checks it or nothing has yet; otherwise its
 * current status. `now` decides whether a first result is overdue.
 */
export type GetMonitorListRowStatusFunction = (
  monitor: MonitorListRowData,
  now?: Date | undefined,
) => MonitorListRowStatus;

export const getMonitorListRowStatus: GetMonitorListRowStatusFunction = (
  monitor: MonitorListRowData,
  now?: Date | undefined,
): MonitorListRowStatus => {
  const status: MonitorRowStatus = MonitorRowStatusUtil.getRowStatus(
    monitor,
    now,
  );

  return {
    ...status,
    isMonitoringOff: status.kind === MonitorRowStatusKind.MonitoringOff,
  };
};

/*
 * The fields a row draws: everything the row rule reads
 * (MONITOR_ROW_STATUS_SELECT), beside the name and type, and the status's
 * priority, which orders a honeycomb's legend as Status sorts the list,
 * worst first (#7344). The public endpoint pins this same select
 * server-side (PublicDashboardResourceListPolicy), so a public page says
 * what the board says of each monitor.
 */
export const MONITOR_LIST_WIDGET_SELECT: Omit<
  typeof MONITOR_ROW_STATUS_SELECT,
  "currentMonitorStatus"
> & {
  _id: true;
  name: true;
  currentMonitorStatus: (typeof MONITOR_ROW_STATUS_SELECT)["currentMonitorStatus"] & {
    priority: true;
  };
} = {
  _id: true,
  name: true,
  ...MONITOR_ROW_STATUS_SELECT,
  currentMonitorStatus: {
    ...MONITOR_ROW_STATUS_SELECT.currentMonitorStatus,
    priority: true,
  },
};
