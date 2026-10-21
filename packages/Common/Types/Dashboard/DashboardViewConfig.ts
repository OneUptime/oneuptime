import { ObjectType } from "../JSON";
import TimeRange from "../Time/TimeRange";
import DashboardBaseComponent from "./DashboardComponents/DashboardBaseComponent";
import DashboardVariable from "./DashboardVariable";

export enum AutoRefreshInterval {
  OFF = "off",
  FIVE_SECONDS = "5s",
  TEN_SECONDS = "10s",
  THIRTY_SECONDS = "30s",
  ONE_MINUTE = "1m",
  FIVE_MINUTES = "5m",
  FIFTEEN_MINUTES = "15m",
}

export function getAutoRefreshIntervalInMs(
  interval: AutoRefreshInterval,
): number | null {
  switch (interval) {
    case AutoRefreshInterval.OFF:
      return null;
    case AutoRefreshInterval.FIVE_SECONDS:
      return 5000;
    case AutoRefreshInterval.TEN_SECONDS:
      return 10000;
    case AutoRefreshInterval.THIRTY_SECONDS:
      return 30000;
    case AutoRefreshInterval.ONE_MINUTE:
      return 60000;
    case AutoRefreshInterval.FIVE_MINUTES:
      return 300000;
    case AutoRefreshInterval.FIFTEEN_MINUTES:
      return 900000;
    default:
      return null;
  }
}

export function getAutoRefreshIntervalLabel(
  interval: AutoRefreshInterval,
): string {
  switch (interval) {
    case AutoRefreshInterval.OFF:
      return "Off";
    case AutoRefreshInterval.FIVE_SECONDS:
      return "5s";
    case AutoRefreshInterval.TEN_SECONDS:
      return "10s";
    case AutoRefreshInterval.THIRTY_SECONDS:
      return "30s";
    case AutoRefreshInterval.ONE_MINUTE:
      return "1m";
    case AutoRefreshInterval.FIVE_MINUTES:
      return "5m";
    case AutoRefreshInterval.FIFTEEN_MINUTES:
      return "15m";
    default:
      return "Off";
  }
}

export default interface DashboardViewConfig {
  _type: ObjectType.DashboardViewConfig;
  components: Array<DashboardBaseComponent>;
  heightInDashboardUnits: number;
  /*
   * The dashboard's own defaults: the time range and the auto-refresh
   * interval everyone who opens it starts on, set on purpose in edit mode
   * (Types/Dashboard/DashboardTimeRange.ts, DashboardAutoRefresh.ts). Left
   * out, a dashboard opens on the past hour, with auto-refresh off - what
   * every dashboard did before these settings. Each viewer may pick their
   * own, which their browser remembers.
   */
  timeRange?: TimeRange | undefined;
  refreshInterval?: AutoRefreshInterval | undefined;
  variables?: Array<DashboardVariable> | undefined;
}
