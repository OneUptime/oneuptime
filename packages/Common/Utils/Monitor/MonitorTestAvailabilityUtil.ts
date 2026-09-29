import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType, {
  MonitorTypeHelper,
} from "../../Types/Monitor/MonitorType";

/*
 * Whether "Test Monitor" can do anything for the monitor being looked at.
 *
 * Every one of these three conditions produces the SAME symptom when it is not
 * checked before the button is offered - a dead end the user only discovers
 * after committing to the flow:
 *
 *   - a monitor type no probe runs: the form renders nothing at all, so the
 *     caller is left with an empty slot in a card header;
 *   - no monitor steps: the row is accepted by the database, but the probe
 *     returns before reporting anything (Probe/Utils/Monitors/Monitor.ts checks
 *     `!monitorTest.monitorSteps || ...length === 0`), so the dashboard polls
 *     for two and a half minutes and then blames a timeout;
 *   - no probes: the modal opens on a required "Select Probe" dropdown with
 *     zero options, which cannot be submitted at all.
 *
 * The rule lives here, rather than as a boolean expression at the call site,
 * because it is the kind of thing that is easy to get right on one page and
 * forget on the next - and because the reason matters: a caller that wants to
 * explain itself needs to know WHICH of the three it was.
 */

export enum MonitorTestAvailability {
  // The test can be offered.
  Available = "Available",
  // No probe runs this kind of monitor, so there is nothing to test with.
  MonitorTypeNotProbeable = "MonitorTypeNotProbeable",
  // The monitor has no steps, so a test would have nothing to execute.
  NoMonitorSteps = "NoMonitorSteps",
  // Nothing is attached to run the test on.
  NoProbesAttached = "NoProbesAttached",
}

export interface MonitorTestAvailabilityInput {
  /*
   * Undefined while the monitor is still loading. Treated exactly like a
   * non-probeable type: not yet an answer, so do not offer the action.
   */
  monitorType?: MonitorType | undefined;
  monitorSteps?: MonitorSteps | undefined | null;
  // How many probes the caller can actually offer in the picker.
  attachedProbeCount: number;
}

export default class MonitorTestAvailabilityUtil {
  public static getAvailability(
    data: MonitorTestAvailabilityInput,
  ): MonitorTestAvailability {
    if (!data.monitorType) {
      return MonitorTestAvailability.MonitorTypeNotProbeable;
    }

    if (!MonitorTypeHelper.isProbableMonitor(data.monitorType)) {
      return MonitorTestAvailability.MonitorTypeNotProbeable;
    }

    if (this.getMonitorStepCount(data.monitorSteps) === 0) {
      return MonitorTestAvailability.NoMonitorSteps;
    }

    /*
     * Negative counts cannot happen from an array length, but a caller that
     * computes this from something else should not be able to smuggle one in.
     */
    if (!data.attachedProbeCount || data.attachedProbeCount <= 0) {
      return MonitorTestAvailability.NoProbesAttached;
    }

    return MonitorTestAvailability.Available;
  }

  public static isAvailable(data: MonitorTestAvailabilityInput): boolean {
    return this.getAvailability(data) === MonitorTestAvailability.Available;
  }

  /*
   * How many steps a test would run. Kept here so that every caller agrees on
   * what an "empty" MonitorSteps is: the property is optional at three levels
   * (the object, its `data`, and the array), and only the innermost one is the
   * question actually being asked.
   */
  public static getMonitorStepCount(
    monitorSteps?: MonitorSteps | undefined | null,
  ): number {
    return monitorSteps?.data?.monitorStepsInstanceArray?.length || 0;
  }
}
