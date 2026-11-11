import { JSONArray, JSONObject, JSONValue } from "../../Types/JSON";

/*
 * A STATE CHANGE'S LOG KEEPS NO SCREENSHOTS (OneUptime issue #6903).
 *
 * The check that opened or resolved an incident or an alert is kept with the
 * state change it caused (IncidentStateTimeline.stateChangeLog,
 * AlertStateTimeline.stateChangeLog), and a Synthetic monitor's check
 * carries a base64 screenshot for every browser and screen size it ran on:
 * megabytes a row, which is how one installation's incident state timeline
 * grew to 13 GB for 46 thousand rows. The log is shown as JSON text (State
 * Timeline -> View Logs), where a screenshot is pages of base64 no one can
 * look at. The screenshots are shown where they can be seen: the incident's
 * or alert's Monitor Summary card (Incident.monitorSummary) and the
 * monitor's own logs.
 *
 * So a state change's log keeps everything but them - the script's log
 * lines, its result, its error, the evaluation - and every run that had
 * screenshots says it left them out (areScreenshotsOmitted), so a reader of
 * the log knows there were some.
 *
 * Only the screenshots of a Synthetic monitor's runs are left out
 * (syntheticMonitorResponse[].screenshots, SyntheticMonitorResponse): what a
 * Custom Code script returned is the script's, whatever its keys are named.
 */

// Where a check keeps a Synthetic monitor's runs.
const SYNTHETIC_RUNS_FIELD: string = "syntheticMonitorResponse";

// A run's screenshots: base64 images, by name.
const SCREENSHOTS_FIELD: string = "screenshots";

// What a run whose screenshots were left out says.
export const SCREENSHOTS_OMITTED_FIELD: string = "areScreenshotsOmitted";

// Deep enough for any check kept, shallow enough to bound the walk.
const MAX_DEPTH: number = 12;

function isPlainObject(value: unknown): value is JSONObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Whether a run's screenshots hold anything: a name with an image.
function hasScreenshots(value: unknown): boolean {
  if (!isPlainObject(value)) {
    return false;
  }

  return Object.keys(value).length > 0;
}

export default class StateChangeLogScreenshots {
  /*
   * The log as a state change keeps it: a copy without a Synthetic monitor's
   * screenshots, each run that had some saying so. A log with none comes
   * back as it was given - the same object.
   */
  public static leaveOut<T extends JSONObject | undefined | null>(log: T): T {
    if (!isPlainObject(log) || !this.hasAny(log, 0)) {
      return log;
    }

    return this.copyWithout(log, 0) as T;
  }

  // Whether a log carries a Synthetic monitor's screenshots anywhere.
  public static hasAny(value: JSONValue | undefined, depth: number): boolean {
    if (depth > MAX_DEPTH || value === null || typeof value !== "object") {
      return false;
    }

    if (Array.isArray(value)) {
      return value.some((item: JSONValue): boolean => {
        return this.hasAny(item, depth + 1);
      });
    }

    for (const key of Object.keys(value)) {
      const child: JSONValue = (value as JSONObject)[key] as JSONValue;

      if (key === SYNTHETIC_RUNS_FIELD && Array.isArray(child)) {
        for (const run of child) {
          if (isPlainObject(run) && hasScreenshots(run[SCREENSHOTS_FIELD])) {
            return true;
          }
        }
      }

      if (this.hasAny(child, depth + 1)) {
        return true;
      }
    }

    return false;
  }

  private static copyWithout(value: JSONValue, depth: number): JSONValue {
    if (depth > MAX_DEPTH || value === null || typeof value !== "object") {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item: JSONValue): JSONValue => {
        return this.copyWithout(item, depth + 1);
      }) as JSONArray;
    }

    const copy: JSONObject = {};

    for (const key of Object.keys(value)) {
      const child: JSONValue = (value as JSONObject)[key] as JSONValue;

      copy[key] =
        key === SYNTHETIC_RUNS_FIELD && Array.isArray(child)
          ? (child.map((run: JSONValue): JSONValue => {
              return this.runWithout(run, depth + 2);
            }) as JSONArray)
          : this.copyWithout(child, depth + 1);
    }

    return copy;
  }

  // One Synthetic run, its screenshots left out when it had some.
  private static runWithout(run: JSONValue, depth: number): JSONValue {
    if (!isPlainObject(run)) {
      return this.copyWithout(run, depth);
    }

    const copy: JSONObject = this.copyWithout(run, depth) as JSONObject;

    if (hasScreenshots(run[SCREENSHOTS_FIELD])) {
      delete copy[SCREENSHOTS_FIELD];
      copy[SCREENSHOTS_OMITTED_FIELD] = true;
    }

    return copy;
  }
}
