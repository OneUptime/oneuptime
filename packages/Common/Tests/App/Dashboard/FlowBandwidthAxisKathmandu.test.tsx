/** @timezone Asia/Kathmandu */

import { jest } from "@jest/globals";

/*
 * The Traffic bandwidth chart's one-point-per-bucket cases (sdn-1, see
 * FlowBandwidthAxisCases) on the Asia/Kathmandu wall clock, three quarters
 * of an hour off the hour (UTC+5:45): even the half-hour steps fall between
 * the API's bucket boundaries.
 */

jest.mock("../../../UI/Components/Charts/Area/AreaChart", () => {
  return {
    ...(jest.requireActual(
      "../../../UI/Components/Charts/Area/AreaChart",
    ) as Record<string, unknown>),
    __esModule: true,
    default: (jest.requireActual("./ChartZoomStandIn") as { default: unknown })
      .default,
  };
});

import describeFlowBandwidthAxis from "./FlowBandwidthAxisCases";

describeFlowBandwidthAxis("Asia/Kathmandu", 345);
