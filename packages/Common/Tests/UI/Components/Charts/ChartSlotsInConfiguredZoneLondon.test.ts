/** @timezone Europe/London */

import describeChartSlotsInConfiguredZone from "./ChartSlotsInConfiguredZoneCases";

/*
 * A chart's slots in the reader's configured zone (see
 * ChartSlotsInConfiguredZoneCases) with the browser in London, whose clocks
 * change on 29 March and 25 October 2026: a reader in New York, Auckland or
 * UTC must not see London's changes, and a reader in London (configured, or
 * the browser's zone because none is) sees them once.
 */

describeChartSlotsInConfiguredZone("Europe/London");
