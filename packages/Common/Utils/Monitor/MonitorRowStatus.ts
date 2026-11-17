import { Amber600, Gray500, Red500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import { translationKey } from "../../Types/Translator";
import MonitorFirstCheck, {
  MonitorFirstCheckFields,
  StartingStatusFlags,
} from "./MonitorFirstCheck";
import MonitorFirstCheckOverdue, {
  FirstCheckScheduleFields,
} from "./MonitorFirstCheckOverdue";
import MonitoringOff, { MonitoredFlags } from "./MonitoringOff";

/*
 * WHAT A ROW SAYS A MONITOR'S STATUS IS.
 *
 * The Monitors list's Monitor Status column, the dashboard Monitor List
 * widget's rows and its honeycomb's tiles - on a dashboard and on a public
 * one - draw a monitor's status from its row, and say the same thing as its
 * own page's hero (MonitorOverviewPresentationUtil) whenever the stored
 * status is not one a check stands behind:
 *
 *   - Archived: nothing checks it, and it has left every list but the
 *     Archived page.
 *   - Disabled: someone turned its monitoring off, so the status it holds is
 *     only what its last check saw (Utils/Monitor/MonitoringOff).
 *   - Probes Not Enabled, Probes Disconnected: no probe checks it.
 *   - Nothing has checked it yet (Utils/Monitor/MonitorFirstCheck, issue
 *     #8899), and it is still in the operational status it was created in:
 *       - Paused, while an incident declared by hand or a maintenance event
 *         holds its checks;
 *       - No results yet, once its first result is overdue
 *         (Utils/Monitor/MonitorFirstCheckOverdue);
 *       - Waiting for data, until then.
 *     The page draws the same badges, and leaves out its "Last recorded
 *     status" line for the same reason.
 *
 * Anything else is the monitor's own status, as stored: its name (looked up
 * by its list, Common/Utils/DefaultRecordNames) and its colour, pulsing as
 * a live status does.
 */

export enum MonitorRowStatusKind {
  Archived = "Archived",
  MonitoringOff = "MonitoringOff",
  NoProbeEnabled = "NoProbeEnabled",
  ProbesDisconnected = "ProbesDisconnected",
  // Never measured, and its checks held by an incident or maintenance.
  PausedBeforeFirstCheck = "PausedBeforeFirstCheck",
  // Never measured, and its first result is overdue.
  NoResultsYet = "NoResultsYet",
  // Never measured, and its first result not due yet (or never due).
  WaitingForData = "WaitingForData",
  // The monitor's own status.
  Status = "Status",
  // Read with no status at all.
  NoStatus = "NoStatus",
}

// OneUptime's words for each kind that is not the monitor's own status.
export const MONITOR_ROW_STATUS_WORDS: Record<
  Exclude<MonitorRowStatusKind, MonitorRowStatusKind.Status>,
  string
> = {
  [MonitorRowStatusKind.Archived]: translationKey("Archived"),
  [MonitorRowStatusKind.MonitoringOff]: translationKey("Disabled"),
  [MonitorRowStatusKind.NoProbeEnabled]: translationKey("Probes Not Enabled"),
  [MonitorRowStatusKind.ProbesDisconnected]: translationKey(
    "Probes Disconnected",
  ),
  [MonitorRowStatusKind.PausedBeforeFirstCheck]: translationKey("Paused"),
  [MonitorRowStatusKind.NoResultsYet]: translationKey("No results yet"),
  [MonitorRowStatusKind.WaitingForData]: translationKey("Waiting for data"),
  // The word the Monitors table has always drawn for a row with no status.
  [MonitorRowStatusKind.NoStatus]: translationKey("Unknown"),
};

/*
 * Gray for what says nothing about the monitor's health, red for no probe
 * checking it, amber for a first check that is late: the page's badge tones
 * (neutral, danger, warning).
 */
export const MONITOR_ROW_STATUS_COLORS: Record<
  Exclude<
    MonitorRowStatusKind,
    MonitorRowStatusKind.Status | MonitorRowStatusKind.NoStatus
  >,
  Color
> = {
  [MonitorRowStatusKind.Archived]: Gray500,
  [MonitorRowStatusKind.MonitoringOff]: Gray500,
  [MonitorRowStatusKind.NoProbeEnabled]: Red500,
  [MonitorRowStatusKind.ProbesDisconnected]: Red500,
  [MonitorRowStatusKind.PausedBeforeFirstCheck]: Gray500,
  [MonitorRowStatusKind.NoResultsYet]: Amber600,
  [MonitorRowStatusKind.WaitingForData]: Gray500,
};

export interface MonitorRowStatusFields
  extends MonitoredFlags,
    MonitorFirstCheckFields,
    FirstCheckScheduleFields {
  disableActiveMonitoringBecauseOfManualIncident?: boolean | null | undefined;
  disableActiveMonitoringBecauseOfScheduledMaintenanceEvent?:
    | boolean
    | null
    | undefined;
  isNoProbeEnabledOnThisMonitor?: boolean | null | undefined;
  isAllProbesDisconnectedFromThisMonitor?: boolean | null | undefined;
  currentMonitorStatus?:
    | (StartingStatusFlags & {
        name?: string | null | undefined;
        color?: Color | string | null | undefined;
      })
    | null
    | undefined;
}

/*
 * What a row is read with: every flag the rule reads, and the status with
 * what tells the one a monitor starts in. Spread into a list's select.
 */
export const MONITOR_ROW_STATUS_SELECT: {
  isArchived: true;
  disableActiveMonitoring: true;
  disableActiveMonitoringBecauseOfManualIncident: true;
  disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true;
  isNoProbeEnabledOnThisMonitor: true;
  isAllProbesDisconnectedFromThisMonitor: true;
  monitorType: true;
  firstMeasuredAt: true;
  createdAt: true;
  monitoringInterval: true;
  currentMonitorStatus: {
    name: true;
    color: true;
    isOperationalState: true;
    isOfflineState: true;
  };
} = {
  isArchived: true,
  disableActiveMonitoring: true,
  disableActiveMonitoringBecauseOfManualIncident: true,
  disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
  isNoProbeEnabledOnThisMonitor: true,
  isAllProbesDisconnectedFromThisMonitor: true,
  monitorType: true,
  firstMeasuredAt: true,
  createdAt: true,
  monitoringInterval: true,
  currentMonitorStatus: {
    name: true,
    color: true,
    isOperationalState: true,
    isOfflineState: true,
  },
};

export interface MonitorRowStatus {
  kind: MonitorRowStatusKind;
  /*
   * OneUptime's words, a key the row looks up in the reader's language
   * (isProductWords); otherwise the monitor's status name as stored.
   */
  text: string;
  // The colour of the dot (and of the words, where a row draws them in it).
  color: Color | null;
  // Whether text is OneUptime's words rather than a status's name.
  isProductWords: boolean;
  // Only a live status pulses.
  shouldAnimate: boolean;
}

const ownWords: (
  kind: Exclude<
    MonitorRowStatusKind,
    MonitorRowStatusKind.Status | MonitorRowStatusKind.NoStatus
  >,
) => MonitorRowStatus = (
  kind: Exclude<
    MonitorRowStatusKind,
    MonitorRowStatusKind.Status | MonitorRowStatusKind.NoStatus
  >,
): MonitorRowStatus => {
  return {
    kind: kind,
    text: MONITOR_ROW_STATUS_WORDS[kind],
    color: MONITOR_ROW_STATUS_COLORS[kind],
    isProductWords: true,
    shouldAnimate: false,
  };
};

const toColor: (color: Color | string | null | undefined) => Color | null = (
  color: Color | string | null | undefined,
): Color | null => {
  if (!color) {
    return null;
  }

  if (color instanceof Color) {
    return color;
  }

  try {
    return Color.fromString(color.toString());
  } catch {
    return null;
  }
};

export default class MonitorRowStatusUtil {
  /*
   * First match wins, in the page's own order: why nothing checks the
   * monitor (archived, monitoring off, no probe), then why nothing has yet
   * (paused, overdue, waiting), then its status. `now` decides whether a
   * first result is overdue; it defaults to the current time.
   */
  public static getRowStatus(
    monitor: MonitorRowStatusFields,
    now?: Date | undefined,
  ): MonitorRowStatus {
    if (monitor.isArchived === true) {
      return ownWords(MonitorRowStatusKind.Archived);
    }

    if (MonitoringOff.isOff(monitor)) {
      return ownWords(MonitorRowStatusKind.MonitoringOff);
    }

    if (monitor.isNoProbeEnabledOnThisMonitor === true) {
      return ownWords(MonitorRowStatusKind.NoProbeEnabled);
    }

    if (monitor.isAllProbesDisconnectedFromThisMonitor === true) {
      return ownWords(MonitorRowStatusKind.ProbesDisconnected);
    }

    if (MonitorFirstCheck.isStatusUnmeasured(monitor)) {
      if (
        monitor.disableActiveMonitoringBecauseOfManualIncident === true ||
        monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent ===
          true
      ) {
        return ownWords(MonitorRowStatusKind.PausedBeforeFirstCheck);
      }

      if (
        MonitorFirstCheckOverdue.isFirstCheckOverdue({
          monitor: monitor,
          now: now || new Date(),
        })
      ) {
        return ownWords(MonitorRowStatusKind.NoResultsYet);
      }

      return ownWords(MonitorRowStatusKind.WaitingForData);
    }

    if (!monitor.currentMonitorStatus) {
      return {
        kind: MonitorRowStatusKind.NoStatus,
        text: MONITOR_ROW_STATUS_WORDS[MonitorRowStatusKind.NoStatus],
        color: null,
        isProductWords: true,
        shouldAnimate: false,
      };
    }

    return {
      kind: MonitorRowStatusKind.Status,
      text:
        monitor.currentMonitorStatus.name ||
        MONITOR_ROW_STATUS_WORDS[MonitorRowStatusKind.NoStatus],
      color: toColor(monitor.currentMonitorStatus.color),
      isProductWords: !monitor.currentMonitorStatus.name,
      shouldAnimate: true,
    };
  }

  /*
   * Whether the row stands for the monitor's own status - what a status
   * filter matches it by - rather than for why it has none to show.
   */
  public static isOwnStatus(status: MonitorRowStatus): boolean {
    return status.kind === MonitorRowStatusKind.Status;
  }
}
