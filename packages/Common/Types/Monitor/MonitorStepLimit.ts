import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";
import MonitorSteps from "./MonitorSteps";

/*
 * THE MOST STEPS A MONITOR - OR A "TEST MONITOR" RUN - MAY HAVE.
 *
 * A probe runs every step of a monitor, or of a test, and reports each one
 * back; each report is a queue job, and for a test it is also a rewrite of
 * the test's stored results, which grow with every step answered. With no
 * limit, one free project ran 1,238 tests of up to 5,000 steps each in an
 * hour through the API: 6.2 million step reports. They filled the telemetry
 * queue (1.2 million jobs), held Valkey at a full core and Postgres in row
 * locks, and every project's probe checks went unrecorded for hours.
 *
 * Nobody needs more: the busiest monitor on OneUptime Cloud has 8 steps, and
 * 99.9% have one. Checked on every write of a monitor's or a test's steps on
 * the server - the dashboard's own check (MonitorSteps.getValidationError)
 * does not run for a request made straight to the API.
 */
export const MAX_MONITOR_STEPS: number = 100;

export default class MonitorStepLimit {
  /*
   * How many steps `monitorSteps` has: a MonitorSteps, or the JSON of one as
   * the API and the database hold it ({ _type, value: { monitorStepsInstanceArray } }).
   * Anything else has none.
   */
  public static countSteps(
    monitorSteps: MonitorSteps | JSONObject | null | undefined,
  ): number {
    if (!monitorSteps) {
      return 0;
    }

    if (monitorSteps instanceof MonitorSteps) {
      return monitorSteps.data?.monitorStepsInstanceArray?.length || 0;
    }

    const value: unknown = (monitorSteps as JSONObject)["value"];
    const steps: unknown =
      value && typeof value === "object"
        ? (value as JSONObject)["monitorStepsInstanceArray"]
        : (monitorSteps as JSONObject)["monitorStepsInstanceArray"];

    return Array.isArray(steps) ? steps.length : 0;
  }

  // What is wrong with the number of steps, or null when nothing is.
  public static getLimitError(
    monitorSteps: MonitorSteps | JSONObject | null | undefined,
  ): string | null {
    const count: number = MonitorStepLimit.countSteps(monitorSteps);

    if (count > MAX_MONITOR_STEPS) {
      return `A monitor can have at most ${MAX_MONITOR_STEPS} steps, and this one has ${count}. Split the checks across more monitors.`;
    }

    return null;
  }

  // Refuses steps past the limit with the reason, as a bad request.
  public static assertWithinLimit(
    monitorSteps: MonitorSteps | JSONObject | null | undefined,
  ): void {
    const error: string | null = MonitorStepLimit.getLimitError(monitorSteps);

    if (error) {
      throw new BadDataException(error);
    }
  }
}
