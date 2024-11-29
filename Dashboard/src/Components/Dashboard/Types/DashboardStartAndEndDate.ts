import InBetween from "Common/Types/BaseDatabase/InBetween";
import DashboardStartAndEndDateRange from "./DashboardStartAndEndDateRange";

export default interface DashboardStartAndEndDate {
  startAndEndDate?: InBetween<Date> | undefined;
  range: DashboardStartAndEndDateRange;
}
