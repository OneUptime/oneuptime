import logger from "../Logger";
import OneUptimeDate from "../../../Types/Date";
import MonitorCriteriaInstance, {
  MonitorCriteriaInstanceType,
} from "../../../Types/Monitor/MonitorCriteriaInstance";
import WorkingHours from "../../../Types/OnCallDutyPolicy/WorkingHours";

/**
 * WHEN A CRITERIA IS JUDGED AT ALL (#10355).
 *
 * A criteria can be judged only on some days and at some times: its active
 * hours (MonitorCriteriaInstance.activeHours), the days of the week and the
 * times of day an on-call rule's working hours are kept as, read on the
 * clock of its own time zone by the same rule (WorkingHours) - a window that
 * opens at 09:00 opens at 09:00 on the day the clocks change too, and one
 * that ends earlier than it starts ends the next morning. "Office access
 * points are unstable during business hours" is judged Monday to Friday,
 * 08:00 to 18:00, in Europe/Oslo, and skipped the rest of the week.
 *
 * Outside them the criteria is skipped as a criteria that is off is: it
 * matches nothing, so what it opened resolves when it stops matching, as
 * for any criteria. A project has no time zone of its own, so the hours
 * carry theirs, the editor's by default.
 *
 * Hours that never open - none picked, a time zone OneUptime does not know,
 * an end at the start - are refused when the criteria is saved
 * (MonitorCriteriaInstance.getActiveHoursError). Any that reach a check all
 * the same are not a reason to judge the criteria never: it is judged as if
 * it had none.
 */
export default class CriteriaActiveHours {
  public static isActive(input: {
    criteria: MonitorCriteriaInstanceType | undefined;
    at?: Date | undefined;
  }): boolean {
    if (
      !input.criteria ||
      !MonitorCriteriaInstance.hasActiveHours(input.criteria)
    ) {
      return true;
    }

    const problem: string | null = WorkingHours.getProblem({
      hours: input.criteria.activeHours,
      timezone: input.criteria.activeHoursTimezone,
    });

    if (problem) {
      logger.debug(
        `Criteria ${input.criteria.id} has active hours that cannot be read (${problem}); it is judged at every check.`,
      );
      return true;
    }

    return WorkingHours.isWithin({
      hours: input.criteria.activeHours,
      timezone: input.criteria.activeHoursTimezone,
      at: input.at || OneUptimeDate.getCurrentDate(),
    });
  }
}
