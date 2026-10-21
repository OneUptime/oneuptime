/** @timezone Asia/Kolkata */

import { jest } from "@jest/globals";

/*
 * The Traffic bandwidth chart's one-point-per-bucket cases (sdn-1, see
 * FlowBandwidthAxisCases) on the Asia/Kolkata wall clock, half an hour off
 * the hour (UTC+5:30): the hour-based steps fall half-way through the API's
 * hour-aligned buckets, which is where the first bucket used to be dropped.
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

describeFlowBandwidthAxis("Asia/Kolkata", 330);
