import MonitorCriteria from "../../Types/Monitor/MonitorCriteria";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";

/*
 * A MONITOR'S STEPS WITH THEIR CRITERIA CLEARED (OneUptime issue #11266).
 *
 * Unlink from Template's "Clear the template's criteria": the criteria a
 * template gave the monitor - what opens incidents and alerts, and what
 * status a check sets - are what kept firing after the template was gone.
 * They are taken off, and everything a step checks stays as it was: its
 * device, address or URL, its request and its settings, and the status it
 * goes back to. So the monitor keeps checking and keeps its history, and
 * raises nothing and changes no status until it is linked to a template
 * again or given criteria of its own.
 *
 * Pure: the steps handed in are never changed.
 */
export default class MonitorCriteriaClear {
  // A copy of the steps, each step with no criteria.
  public static clearCriteria(monitorSteps: MonitorSteps): MonitorSteps {
    const cleared: MonitorSteps = MonitorSteps.clone(monitorSteps);

    for (const step of cleared.data?.monitorStepsInstanceArray || []) {
      MonitorCriteriaClear.clearStep(step);
    }

    return cleared;
  }

  // Whether any step of the monitor has a criteria to clear.
  public static hasCriteria(
    monitorSteps: MonitorSteps | null | undefined,
  ): boolean {
    return (monitorSteps?.data?.monitorStepsInstanceArray || []).some(
      (step: MonitorStep): boolean => {
        return (
          (step?.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray
            ?.length || 0) > 0
        );
      },
    );
  }

  private static clearStep(step: MonitorStep): void {
    if (!step?.data) {
      return;
    }

    const criteria: MonitorCriteria = new MonitorCriteria();
    criteria.data = { monitorCriteriaInstanceArray: [] };
    step.data.monitorCriteria = criteria;
  }
}
