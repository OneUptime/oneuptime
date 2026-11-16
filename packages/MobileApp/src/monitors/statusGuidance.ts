import type { Ionicons } from "@expo/vector-icons";
import type { StatusTone } from "../components/StatusPill";
import type { ColorTokens } from "../theme";
import type { ColorField } from "../api/types";
import { rgbToHex } from "../utils/color";
import { formatRelativeTime } from "../utils/date";
import { getMonitorFamily } from "../utils/monitorFirstCheck";
import type {
  MonitorHealthFields,
  MonitorRowStatus,
  MonitorRowStatusTone,
} from "../utils/monitorHealth";

type IconName = keyof typeof Ionicons.glyphMap;

/*
 * HOW THE APP DRAWS WHAT A MONITOR'S ROW SAYS (utils/monitorHealth), on the
 * Monitors screen's rows and on the monitor's own screen.
 *
 * The words come from the web's row rule; the colour repeats them. And
 * where the words stand in for the monitor's status - nothing checks it, or
 * nothing has yet - the monitor's screen says why, and what happens next,
 * in a banner under its name: the explanations the monitor's page on the
 * web gives (MonitorOverviewPresentationUtil), in a sentence or two.
 */

const TONE_TOKENS: Record<MonitorRowStatusTone, keyof ColorTokens> = {
  // Says nothing about the monitor's health: Disabled, Paused, Waiting.
  neutral: "textTertiary",
  // No probe checks it.
  danger: "statusError",
  // Its first result is late.
  warning: "statusWarning",
};

/*
 * The colour of a row's dot and of the detail screen's: OneUptime's words
 * in their tone, the monitor's own status in its colour, and the muted one
 * for a status with no colour, or none at all.
 */
export function getMonitorStatusColor(
  colors: ColorTokens,
  rowStatus: MonitorRowStatus,
  statusColor: ColorField | null | undefined,
): string {
  if (rowStatus.tone) {
    return colors[TONE_TOKENS[rowStatus.tone]];
  }

  return statusColor ? rgbToHex(statusColor) : colors.textTertiary;
}

export interface MonitorStatusGuidance {
  tone: StatusTone;
  icon: IconName;
  title: string;
  message: string;
  testID: string;
}

/*
 * The first result a monitor waits for, by what checks it: the headline and
 * the next step the web's page gives a monitor nothing has measured yet.
 */
function getWaitingGuidance(
  monitorType: string | null | undefined,
): Pick<MonitorStatusGuidance, "title" | "message"> {
  switch (monitorType) {
    case "Incoming Request":
      return {
        title: "Waiting for the first heartbeat",
        message:
          "Send a GET or POST request to this monitor's heartbeat URL to start tracking it.",
      };
    case "Incoming Email":
      return {
        title: "Waiting for the first email",
        message:
          "Send an email to this monitor's address to start tracking it.",
      };
    case "Server":
      return {
        title: "Waiting for the agent to report",
        message: "Install the server agent to start sending reports.",
      };
    case "Network Device":
      return {
        title: "Waiting for the first poll",
        message:
          "No poll or trap from this device has been evaluated yet. Check that a probe is assigned to poll it.",
      };
    case "Probe Status":
      return {
        title: "Waiting for the first evaluation",
        message:
          "This monitor checks the probes it watches every minute. The first result arrives within a minute or two.",
      };
    default:
      break;
  }

  if (getMonitorFamily(monitorType) === "ProbeCheck") {
    return {
      title: "Waiting for the first check",
      message: "The first result usually arrives within a few minutes.",
    };
  }

  return {
    title: "Waiting for the first evaluation",
    message: "Its status shows here once the first evaluation has run.",
  };
}

/*
 * What the monitor's screen says under its name about why no check stands
 * behind its status, or null when its status is its own. Disabled keeps the
 * words it always had.
 */
export function getMonitorStatusGuidance(data: {
  monitor: MonitorHealthFields;
  rowStatus: MonitorRowStatus;
}): MonitorStatusGuidance | null {
  const monitor: MonitorHealthFields = data.monitor;

  switch (data.rowStatus.kind) {
    case "MonitoringOff":
      return {
        tone: "warning",
        icon: "pause-circle",
        title: "Monitoring is paused",
        message:
          "Active checks are disabled. The last recorded status may not reflect this service's current health.",
        testID: "monitor-paused-banner",
      };
    case "Archived":
      return {
        tone: "neutral",
        icon: "archive-outline",
        title: "This monitor is archived",
        message:
          "No checks run while the monitor is archived, so the status stays at the last one recorded.",
        testID: "monitor-archived-banner",
      };
    case "NoProbeEnabled":
      return {
        tone: "danger",
        icon: "alert-circle",
        title: "Nothing is checking this monitor",
        message: "No probe is enabled for this monitor, so no checks run.",
        testID: "monitor-no-probe-banner",
      };
    case "ProbesDisconnected":
      return {
        tone: "danger",
        icon: "cloud-offline-outline",
        title: "Every probe checking this monitor is disconnected",
        message: "No checks run until a probe reconnects.",
        testID: "monitor-probes-disconnected-banner",
      };
    case "PausedBeforeFirstCheck":
      // An incident first, as the web's page puts it first.
      return monitor.disableActiveMonitoringBecauseOfManualIncident === true
        ? {
            tone: "neutral",
            icon: "pause-circle",
            title: "Monitoring is paused by an incident",
            message:
              "Nothing has checked this monitor yet. Checks resume when the incident that paused this monitor is resolved.",
            testID: "monitor-first-check-paused-banner",
          }
        : {
            tone: "neutral",
            icon: "pause-circle",
            title: "Monitoring is paused for scheduled maintenance",
            message:
              "Nothing has checked this monitor yet. Checks resume automatically when the maintenance event ends.",
            testID: "monitor-first-check-paused-banner",
          };
    case "NoResultsYet": {
      const createdAgo: string = formatRelativeTime(
        typeof monitor.createdAt === "string"
          ? monitor.createdAt
          : monitor.createdAt?.toISOString() ?? "",
      );

      return getMonitorFamily(monitor.monitorType) === "ProbeCheck"
        ? {
            tone: "warning",
            icon: "time-outline",
            title: "No check has completed yet",
            message: `No check result has arrived since this monitor was created ${createdAgo}.`,
            testID: "monitor-no-results-banner",
          }
        : {
            tone: "warning",
            icon: "time-outline",
            title: "No evaluation has completed yet",
            message: `No evaluation has run since this monitor was created ${createdAgo}.`,
            testID: "monitor-no-results-banner",
          };
    }
    case "WaitingForData":
      return {
        tone: "info",
        icon: "hourglass-outline",
        ...getWaitingGuidance(monitor.monitorType),
        testID: "monitor-waiting-banner",
      };
    default:
      return null;
  }
}
