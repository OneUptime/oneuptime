/** @timezone Pacific/Auckland */

import describeChartSlotsInConfiguredZone from "./ChartSlotsInConfiguredZoneCases";

/*
 * A chart's slots in the reader's configured zone (see
 * ChartSlotsInConfiguredZoneCases) with the browser in Auckland, a day ahead
 * of the readers in Europe and America, whose clocks go back in April and
 * forward in September: the other way round from theirs.
 */

describeChartSlotsInConfiguredZone("Pacific/Auckland");
