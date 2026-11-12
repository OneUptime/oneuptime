/** @timezone UTC */

import describeChartSlotsInConfiguredZone from "./ChartSlotsInConfiguredZoneCases";

/*
 * A chart's slots in the reader's configured zone (see
 * ChartSlotsInConfiguredZoneCases) with the browser in UTC, where it never
 * changes its clocks: every change in a window is the reader's. Stepped on
 * this clock, a London reader's thirty days from 12 Oct read "25 Oct" twice
 * and had no slot for 10 Nov (issue #7127).
 */

describeChartSlotsInConfiguredZone("UTC");
