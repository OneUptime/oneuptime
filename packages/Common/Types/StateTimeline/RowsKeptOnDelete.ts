/*
 * WHAT A DELETE BY QUERY KEEPS OF A STATE TIMELINE.
 *
 * A state timeline is the history of what a record has been: a monitor's
 * statuses, an incident's states. Readers turn it into what people see: the
 * status page's bars and uptime, a monitor's overview, an incident's current
 * state on a status page. When a record has no row left, or none for a span
 * of the history a reader shows, that reader has nothing to draw: a status
 * page paints the monitor grey ("no data"), and an active incident shows no
 * state at all.
 *
 * So a delete that names its rows by a query - a workflow's Delete Many,
 * OneUptime's own retention purge, anything but a delete of one row by its
 * id - never takes:
 *
 *   - a record's current row: the newest row of its timeline;
 *   - for a status timeline, which readers draw as continuous history, any
 *     row that still covers part of the last KEPT_STATUS_HISTORY_DAYS days,
 *     the longest history a status page, a monitor's overview or a network
 *     site's page shows.
 *
 * Those rows are left, the rest go, and the run says how many stayed. A
 * delete of one row by its id is the service's own to judge: it can refuse
 * it, or let the row's neighbours close the gap it leaves.
 *
 * DatabaseService applies the rule (keepRowsOnDeleteByQuery), with the SQL in
 * Server/Utils/Database/StateTimelineRowsKept. This file holds the words, so
 * the workflow steps' help and their run logs say the same thing.
 */

/*
 * How far back a status timeline keeps every row in effect: the longest
 * history any page draws from it. A status page's uptime bars and uptime
 * figure cover at most 90 days (Show the last ... days, 1 to 90, and the
 * uptime endpoint refuses a longer range), a monitor's overview draws 90 day
 * bars (MONITOR_UPTIME_HISTORY_DAYS) and a network site's Status Timeline
 * page shows its last 90 days. KeptStatusHistoryCoversReaders (Common Tests)
 * holds this to those numbers.
 */
export const KEPT_STATUS_HISTORY_DAYS: number = 90;

export interface RowsKeptOnDelete {
  // The column naming the record each row is a state of: "monitorId".
  parentColumn: string;
  /*
   * Whether every row that covers part of the last KEPT_STATUS_HISTORY_DAYS
   * days stays as well as the current one: true for a status timeline, read
   * as continuous history.
   */
  keepsHistoryInEffect: boolean;
  // What stays, in plain words: "each incident's current state".
  whatStays: string;
  // Why, when it is not plain from what stays: "so status pages never ...".
  why: string | null;
  /*
   * Whether a delete that names one row by its id can take a row a delete
   * by query keeps (it is then the service's own hook that judges it): true
   * where a person corrects the timeline by hand, false where OneUptime alone
   * writes it.
   */
  oneRowByIdCanGo: boolean;
}

/*
 * Every state timeline, by table name. StateTimelinesKeepRowsOnDelete
 * (Common Tests) holds each one's service to declaring the rule, and every
 * model shaped like a state timeline to being listed here.
 */
export const ROWS_KEPT_ON_DELETE_BY_QUERY: Readonly<
  Record<string, RowsKeptOnDelete>
> = {
  MonitorStatusTimeline: {
    parentColumn: "monitorId",
    keepsHistoryInEffect: true,
    whatStays: `each monitor's current status, and every status event that covers part of the last ${KEPT_STATUS_HISTORY_DAYS} days`,
    why: "so status pages never show a monitor grey",
    oneRowByIdCanGo: true,
  },
  NetworkSiteStatusTimeline: {
    parentColumn: "siteId",
    keepsHistoryInEffect: true,
    whatStays: `each site's current status, and every status event that covers part of the last ${KEPT_STATUS_HISTORY_DAYS} days`,
    why: "so a site's uptime never loses its data",
    oneRowByIdCanGo: false,
  },
  IncidentStateTimeline: {
    parentColumn: "incidentId",
    keepsHistoryInEffect: false,
    whatStays: "each incident's current state",
    why: "so status pages always show it",
    oneRowByIdCanGo: true,
  },
  AlertStateTimeline: {
    parentColumn: "alertId",
    keepsHistoryInEffect: false,
    whatStays: "each alert's current state",
    why: null,
    oneRowByIdCanGo: true,
  },
  ScheduledMaintenanceStateTimeline: {
    parentColumn: "scheduledMaintenanceId",
    keepsHistoryInEffect: false,
    whatStays: "each scheduled maintenance event's current state",
    why: "so status pages always show it",
    oneRowByIdCanGo: true,
  },
  IncidentEpisodeStateTimeline: {
    parentColumn: "incidentEpisodeId",
    keepsHistoryInEffect: false,
    whatStays: "each incident episode's current state",
    why: "so status pages always show it",
    oneRowByIdCanGo: true,
  },
  AlertEpisodeStateTimeline: {
    parentColumn: "alertEpisodeId",
    keepsHistoryInEffect: false,
    whatStays: "each alert episode's current state",
    why: null,
    oneRowByIdCanGo: true,
  },
};

// What a delete by query of this table keeps, or null for a table that keeps nothing.
export function getRowsKeptOnDelete(
  tableName: string | null | undefined,
): RowsKeptOnDelete | null {
  if (!tableName) {
    return null;
  }

  return Object.prototype.hasOwnProperty.call(
    ROWS_KEPT_ON_DELETE_BY_QUERY,
    tableName,
  )
    ? ROWS_KEPT_ON_DELETE_BY_QUERY[tableName]!
    : null;
}

/*
 * "a delete by query leaves each incident's current state, so status pages
 * always show it" - the rule as one clause, for help text and logs.
 */
export function describeRowsKeptOnDelete(kept: RowsKeptOnDelete): string {
  return `a delete by query leaves ${kept.whatStays}${kept.why ? `, ${kept.why}` : ""}`;
}

/*
 * The line a workflow step writes to its run's log when a delete by query
 * left rows it matched: "Kept 3 Monitor Status Events: a delete by query
 * leaves ... To delete one specific Monitor Status Event, query it by its ID."
 */
export function describeRowsKeptByDelete(data: {
  count: number;
  kept: RowsKeptOnDelete;
  // The model's names: "Monitor Status Event", "Monitor Status Events".
  one: string;
  many: string;
}): string {
  const rows: string = data.count === 1 ? data.one : data.many;

  const byId: string = data.kept.oneRowByIdCanGo
    ? ` To delete one specific ${data.one}, query it by its ID.`
    : "";

  return `Kept ${data.count} ${rows}: ${describeRowsKeptOnDelete(data.kept)}.${byId}`;
}
