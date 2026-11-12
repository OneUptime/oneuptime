/** @timezone America/New_York */

import describeChartSlotsInConfiguredZone from "./ChartSlotsInConfiguredZoneCases";

/*
 * A chart's slots in the reader's configured zone (see
 * ChartSlotsInConfiguredZoneCases) with the browser in New York, whose
 * clocks change on 8 March and 1 November 2026, a week after London's in
 * the autumn: between the two, a London reader's day and the browser's are
 * an hour further apart than the rest of the year.
 */

describeChartSlotsInConfiguredZone("America/New_York");
