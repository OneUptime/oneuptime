import BadDataException from "../../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../../Types/JSON";
import MonitorStep, {
  SYNTHETIC_MONITOR_DEFAULT_BROWSER_TYPES,
  SYNTHETIC_MONITOR_DEFAULT_SCREEN_SIZE_TYPES,
} from "../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType from "../../Types/Monitor/MonitorType";
import BrowserType from "../../Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "../../Types/Monitor/SyntheticMonitors/ScreenSizeType";

/*
 * A Synthetic monitor's step runs its script once for each browser and
 * screen size it lists - the probe loops over both lists - so a step with
 * either list empty runs nothing and never fails: a monitor that looks
 * healthy forever.
 *
 * The Dashboard has refused such a step since #4964 (MonitorStep
 * .getValidationError), and a new step starts on Chromium at Desktop
 * (SYNTHETIC_MONITOR_DEFAULT_*). This is the rest of it:
 *
 *   - the server refuses a write that would leave a Synthetic monitor or
 *     template running nothing, so an API, Terraform, MCP or workflow
 *     caller cannot store one either (assertRunsSomewhere);
 *   - the steps stored that way before, which ran nothing, are given the
 *     defaults the form gives a new step, so each runs in Chromium at a
 *     desktop size (fillEmptyListsInJSON, run by the
 *     FillSyntheticMonitorBrowsersAndScreenSizes data migration).
 *
 * The server's words name the fields, since its readers are API callers:
 * the Dashboard asks for a pick before it ever sends a write.
 */

export const SYNTHETIC_STEP_NO_BROWSER_MESSAGE: string = `A Synthetic monitor step needs at least one browser in browserTypes (${Object.values(
  BrowserType,
).join(" or ")}). With none, its script never runs.`;

export const SYNTHETIC_STEP_NO_SCREEN_SIZE_MESSAGE: string = `A Synthetic monitor step needs at least one screen size in screenSizeTypes (${Object.values(
  ScreenSizeType,
).join(", ")}). With none, its script never runs.`;

export interface SyntheticListsFillResult {
  // The steps, as stored, with the empty lists filled in.
  monitorSteps: JSONObject;
  changed: boolean;
  // How many steps were missing a browser, a screen size or both.
  stepsFilled: number;
}

const isNonEmptyList: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  return Array.isArray(value) && value.length > 0;
};

const asObject: (value: unknown) => JSONObject | undefined = (
  value: unknown,
): JSONObject | undefined => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : undefined;
};

export default class SyntheticMonitorStepsUtil {
  /*
   * Why these steps would run nothing - the first step without a browser,
   * or without a screen size - or null when every step runs somewhere.
   * Steps that cannot be read say nothing here: their shape is refused
   * where they are parsed.
   */
  public static getRunsNothingError(
    monitorSteps: MonitorSteps | JSONObject | null | undefined,
  ): string | null {
    if (!monitorSteps) {
      return null;
    }

    let steps: Array<MonitorStep> = [];

    try {
      steps =
        MonitorSteps.fromJSON(monitorSteps as MonitorSteps | JSONObject).data
          ?.monitorStepsInstanceArray || [];
    } catch {
      return null;
    }

    for (const step of steps) {
      if (!isNonEmptyList(step.data?.browserTypes)) {
        return SYNTHETIC_STEP_NO_BROWSER_MESSAGE;
      }

      if (!isNonEmptyList(step.data?.screenSizeTypes)) {
        return SYNTHETIC_STEP_NO_SCREEN_SIZE_MESSAGE;
      }
    }

    return null;
  }

  /*
   * Refuses a Synthetic monitor's (or template's) steps that would run
   * nothing. Every other type has no browsers or screen sizes to pick.
   */
  public static assertRunsSomewhere(data: {
    monitorType: MonitorType | undefined | null;
    monitorSteps: MonitorSteps | JSONObject | null | undefined;
  }): void {
    if (data.monitorType !== MonitorType.SyntheticMonitor) {
      return;
    }

    const error: string | null = SyntheticMonitorStepsUtil.getRunsNothingError(
      data.monitorSteps,
    );

    if (error) {
      throw new BadDataException(error);
    }
  }

  /*
   * A Synthetic monitor's stored steps with every missing or empty browser
   * list set to Chromium, and every missing or empty screen size list to
   * Desktop - what a new step starts on. A list with something in it is
   * left exactly as it is, and so is everything else in the column: the
   * JSON is edited as stored, not parsed and written back.
   */
  public static fillEmptyListsInJSON(
    stored: JSONObject,
  ): SyntheticListsFillResult {
    const monitorSteps: JSONObject = JSON.parse(
      JSON.stringify(stored),
    ) as JSONObject;
    let stepsFilled: number = 0;

    const value: JSONObject | undefined = asObject(monitorSteps["value"]);
    const envelopes: JSONArray = Array.isArray(
      value?.["monitorStepsInstanceArray"],
    )
      ? (value!["monitorStepsInstanceArray"] as JSONArray)
      : [];

    for (const envelope of envelopes) {
      const step: JSONObject | undefined = asObject(
        asObject(envelope)?.["value"],
      );

      if (!step) {
        continue;
      }

      let filled: boolean = false;

      if (!isNonEmptyList(step["browserTypes"])) {
        step["browserTypes"] = [...SYNTHETIC_MONITOR_DEFAULT_BROWSER_TYPES];
        filled = true;
      }

      if (!isNonEmptyList(step["screenSizeTypes"])) {
        step["screenSizeTypes"] = [
          ...SYNTHETIC_MONITOR_DEFAULT_SCREEN_SIZE_TYPES,
        ];
        filled = true;
      }

      if (filled) {
        stepsFilled++;
      }
    }

    return {
      monitorSteps: monitorSteps,
      changed: stepsFilled > 0,
      stepsFilled: stepsFilled,
    };
  }
}
