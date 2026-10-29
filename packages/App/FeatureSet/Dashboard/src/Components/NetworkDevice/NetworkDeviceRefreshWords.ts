import Select from "Common/Types/BaseDatabase/Select";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import {
  NetworkDeviceRefreshAnswer,
  NetworkDeviceRefreshProgress,
  NetworkDeviceRefreshStanding,
} from "Common/Utils/NetworkDevice/NetworkDeviceRefresh";
import {
  TemplateValues,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What Refresh says, on a network device's Inventory card and on its
 * Inventory item's Asset Details card (Common/Utils/NetworkDevice/
 * NetworkDeviceRefresh says what a refresh reads, and why).
 *
 * React-free, so App's tests read it: every sentence is a translation key,
 * a probe's or a connection's name goes in as it is.
 */

// The button, and what it says while the device is being read again.
export const REFRESH_TITLE: string = translationKey("Refresh");
export const REFRESHING_TITLE: string = translationKey("Refreshing…");

// While the readers are at it.
export const WAITING_FOR_PROBE: string = translationKey(
  "Its probe reads it again within a minute.",
);
export const WAITING_FOR_CONTROLLER: string = translationKey(
  "The Meraki dashboard is read again within a minute.",
);
export const WAITING_FOR_BOTH: string = translationKey(
  "Its probe and the Meraki dashboard read it again within a minute.",
);

// Done.
export const READ_AGAIN: string = translationKey("Read again just now.");
export const PROBE_COULD_NOT_REACH: string = translationKey(
  "Its probe could not reach it just now. Its details are as it last read them.",
);

// A reader that has not answered in the time a read takes.
export const PROBE_LATE: string = translationKey(
  "Its probe ({{probe}}) has not read it yet. Check that the probe is online.",
);
export const PROBE_LATE_UNNAMED: string = translationKey(
  "Its probe has not read it yet. Check that the probe is online.",
);
export const CONTROLLER_LATE: string = translationKey(
  "The Meraki dashboard has not been read yet. The connection's status is on the network's Traffic page.",
);

export type RefreshStatusTone = "progress" | "done" | "warning" | "error";

export interface RefreshStatusWords {
  tone: RefreshStatusTone;
  template: string;
  values: TemplateValues;
}

/*
 * What the status line under a refreshed card says, from where the refresh
 * stands - or undefined when there is nothing to say.
 */
export function getRefreshStatusWords(data: {
  answer: NetworkDeviceRefreshAnswer | undefined;
  standing: NetworkDeviceRefreshStanding | undefined;
}): RefreshStatusWords | undefined {
  const answer: NetworkDeviceRefreshAnswer | undefined = data.answer;
  const standing: NetworkDeviceRefreshStanding | undefined = data.standing;

  if (!answer || !standing) {
    return undefined;
  }

  switch (standing.progress) {
    case NetworkDeviceRefreshProgress.Read:
      return { tone: "done", template: READ_AGAIN, values: {} };
    case NetworkDeviceRefreshProgress.Unreachable:
      return { tone: "warning", template: PROBE_COULD_NOT_REACH, values: {} };
    case NetworkDeviceRefreshProgress.Late:
      if (standing.isProbePending) {
        return answer.probeName
          ? {
              tone: "warning",
              template: PROBE_LATE,
              values: { probe: answer.probeName },
            }
          : { tone: "warning", template: PROBE_LATE_UNNAMED, values: {} };
      }

      return { tone: "warning", template: CONTROLLER_LATE, values: {} };
    case NetworkDeviceRefreshProgress.Waiting:
    default:
      return {
        tone: "progress",
        template:
          answer.isProbeReading && answer.isControllerReading
            ? WAITING_FOR_BOTH
            : answer.isProbeReading
              ? WAITING_FOR_PROBE
              : WAITING_FOR_CONTROLLER,
        values: {},
      };
  }
}

/*
 * The columns a refresh is decided and followed by: who reads the device
 * (its probe, polling, how it is monitored, its address, its controller
 * reading) and where its last poll and ask stand.
 */
export const NETWORK_DEVICE_REFRESH_COLUMNS: Select<NetworkDevice> = {
  probeId: true,
  isPollingEnabled: true,
  monitoringMethod: true,
  hostname: true,
  discoveredDetails: true,
  refreshRequestedAt: true,
  lastPolledAt: true,
  isReachable: true,
};

// How often a card asks for the device again while it is being read.
export const REFRESH_FOLLOW_INTERVAL_MS: number = 5000;
