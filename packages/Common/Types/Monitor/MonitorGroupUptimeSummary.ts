import ObjectID from "../ObjectID";
import { UptimeDayBucket } from "../StatusPage/UptimeDailyAggregate";

/*
 * The uptime history of ONE monitor group for the Dashboard's monitor group
 * page, as GET /api/monitor-group/uptime-summary/:monitorGroupId answers it
 * (issue #6886).
 *
 * WHY IT IS A SERVER AGGREGATE
 *
 * The page used to fetch the group's 90-day MonitorStatusTimeline rows
 * (MonitorGroupService.getStatusTimeline) under a 10,000 row cap, oldest
 * first, and merge them in the browser. A group whose monitors wrote more
 * than 10,000 status changes in 90 days - one flapping monitor is enough -
 * lost its NEWEST rows: its latest days were drawn as no data and its
 * percentage covered only the oldest days. These are the group's days as the
 * database measures them from every row
 * (MonitorStatusTimelineService.getMonitorGroupDailyUptimeAggregate), the
 * same days a status page draws the group with: at every instant the worst
 * status among its monitors, the Dashboard's downtime statuses - every status
 * that is not operational - outranking the rest.
 */
export interface MonitorGroupUptimeSummary {
  monitorGroupId: ObjectID;
  // The IANA zone the day buckets were cut in.
  timezone: string;
  generatedAt: Date;
  // Start of the first bar: local midnight 89 days before now.
  startDate: Date;
  // Now, when the summary was generated.
  endDate: Date;
  // One per day: how long the group spent in each status that day.
  buckets: Array<UptimeDayBucket>;
  /*
   * Over every bucket: the time at least one of the group's monitors was
   * recorded, and the time at least one was in a downtime status - what
   * the page's percentage is read from, so it always agrees with the bars
   * beside it.
   */
  coveredSeconds: number;
  downtimeSeconds: number;
}
