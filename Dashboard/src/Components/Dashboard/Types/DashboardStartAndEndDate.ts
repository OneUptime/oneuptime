import InBetween from "Common/Types/BaseDatabase/InBetween";
import DashboardStartAndEndDateRange from "./DashboardStartAndEndDateRange";
import OneUptimeDate from "Common/Types/Date";

export default interface DashboardStartAndEndDate {
  startAndEndDate?: InBetween<Date> | undefined;
  range: DashboardStartAndEndDateRange;
}

export class DashboardStartAndEndDateUtil { 
  public static getStartAndEndDate(dashboardStartAndEndDate: DashboardStartAndEndDate): InBetween<Date> {
    const currentDate: Date = OneUptimeDate.getCurrentDate(); 
    
    // 30 mins. 
    if(dashboardStartAndEndDate.range === DashboardStartAndEndDateRange.PAST_THIRTY_MINS) {
      return new InBetween<Date>(OneUptimeDate.addRemoveMinutes(currentDate, -30), currentDate);
    }

    if(dashboardStartAndEndDate.range === DashboardStartAndEndDateRange.PAST_ONE_HOUR) {
      return new InBetween<Date>(OneUptimeDate.addRemoveHours(currentDate, -1), currentDate);
    }

    // two hours. 
    if(dashboardStartAndEndDate.range === DashboardStartAndEndDateRange.PAST_TWO_HOURS) {
      return new InBetween<Date>(OneUptimeDate.addRemoveHours(currentDate, -2), currentDate);
    }

    // three hours 
    if(dashboardStartAndEndDate.range === DashboardStartAndEndDateRange.PAST_THREE_HOURS) {
      return new InBetween<Date>(OneUptimeDate.addRemoveHours(currentDate, -3), currentDate);
    }

    if(dashboardStartAndEndDate.range === DashboardStartAndEndDateRange.PAST_ONE_DAY) {
      return new InBetween<Date>(OneUptimeDate.addRemoveDays(currentDate, -1), currentDate);
    }

    // two days .
    if(dashboardStartAndEndDate.range === DashboardStartAndEndDateRange.PAST_TWO_DAYS) {
      return new InBetween<Date>(OneUptimeDate.addRemoveDays(currentDate, -2), currentDate);
    }

    if(dashboardStartAndEndDate.range === DashboardStartAndEndDateRange.PAST_ONE_WEEK) {
      return new InBetween<Date>(OneUptimeDate.addRemoveDays(currentDate, -7), currentDate);
    }

    // two weeks. 
    if(dashboardStartAndEndDate.range === DashboardStartAndEndDateRange.PAST_TWO_WEEKS) {
      return new InBetween<Date>(OneUptimeDate.addRemoveDays(currentDate, -14), currentDate);
    }

    if(dashboardStartAndEndDate.range === DashboardStartAndEndDateRange.PAST_ONE_MONTH) {
      return new InBetween<Date>(OneUptimeDate.addRemoveMonths(currentDate, -1), currentDate);
    }

    // three months.
    if(dashboardStartAndEndDate.range === DashboardStartAndEndDateRange.PAST_THREE_MONTHS) {
      return new InBetween<Date>(OneUptimeDate.addRemoveMonths(currentDate, -3), currentDate);
    }

    // custom
    return dashboardStartAndEndDate.startAndEndDate || new InBetween<Date>(currentDate, currentDate);
    
  }
}