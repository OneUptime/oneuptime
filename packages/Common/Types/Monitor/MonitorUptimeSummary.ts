import ObjectID from "../ObjectID";
import {
  UptimeDayBucket,
  UptimeStatusDuration,
} from "../StatusPage/UptimeDailyAggregate";

/*
 * The uptime history of ONE monitor, as the monitor overview reads it from
 * GET /api/monitor/uptime-summary/:monitorId.
 *
 * WHY IT IS A SERVER AGGREGATE
 *
 * The overview used to fetch the monitor's 90-day MonitorStatusTimeline rows
 * under a 10,000-row cap and add them up in the browser. A flapping monitor
 * blows through that cap in days, and the rows that fall off are the OLD ones,
 * so the oldest bars were painted from nothing - and "nothing" rendered as
 * 100% uptime. The aggregate is sized by days x statuses, not by status
 * changes, so a flapping monitor cannot truncate it.
 *
 * Every window carries `coveredSeconds` next to `windowSeconds`. A window
 * with no recorded time is "No data", never 100%.
 */

/*
 * One bar per calendar day. The server starts the strip at local midnight
 * 89 days before now, so the strip is exactly this many buckets and the last
 * bar is today.
 */
export const MONITOR_UPTIME_HISTORY_DAYS: number = 90;

export enum MonitorUptimeWindowKey {
  Last24Hours = "24h",
  Last7Days = "7d",
  Last30Days = "30d",
  Last90Days = "90d",
}

export interface MonitorUptimeRollingWindow {
  key: MonitorUptimeWindowKey;
  seconds: number;
  label: string;
}

/*
 * The rolling windows the stat bar shows. They end at now and are exact
 * (86,400 seconds is 24 hours, not "since midnight"). The 90-day figure is
 * not here: it is summed from the bars so it always agrees with the strip.
 */
export const MONITOR_UPTIME_ROLLING_WINDOWS: Array<MonitorUptimeRollingWindow> =
  [
    {
      key: MonitorUptimeWindowKey.Last24Hours,
      seconds: 86400,
      label: "24 hours",
    },
    {
      key: MonitorUptimeWindowKey.Last7Days,
      seconds: 604800,
      label: "7 days",
    },
    {
      key: MonitorUptimeWindowKey.Last30Days,
      seconds: 2592000,
      label: "30 days",
    },
  ];

export interface MonitorUptimeWindowTotal {
  key: MonitorUptimeWindowKey;
  startDate: Date;
  endDate: Date;
  // Wall-clock seconds in the window.
  windowSeconds: number;
  // Seconds of the window actually covered by a timeline row.
  coveredSeconds: number;
  // Seconds per status, largest first.
  statusDurations: Array<UptimeStatusDuration>;
}

/*
 * The project's statuses, shipped with the summary so the page does not need
 * a MonitorStatus list request (a ReadMonitorStatusTimeline holder may not be
 * able to read that table directly, but the timeline already exposes these
 * columns).
 */
export interface MonitorUptimeSummaryStatus {
  id: ObjectID;
  name: string;
  color: string;
  isOperationalState: boolean;
  isOfflineState: boolean;
  priority: number | null;
}

export interface MonitorUptimeSummary {
  monitorId: ObjectID;
  // The IANA zone the day buckets were cut in.
  timezone: string;
  generatedAt: Date;
  // Start of the first bar (local midnight, 89 days before now).
  startDate: Date;
  // Now, when the summary was generated.
  endDate: Date;
  buckets: Array<UptimeDayBucket>;
  windows: Array<MonitorUptimeWindowTotal>;
  /*
   * False when the server could not vouch for the whole strip. Bars before
   * `completeFrom` are then shown as incomplete rather than guessed at.
   */
  isComplete: boolean;
  completeFrom: Date | null;
  statuses: Array<MonitorUptimeSummaryStatus>;
}
