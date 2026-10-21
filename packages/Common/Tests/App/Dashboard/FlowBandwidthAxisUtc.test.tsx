/** @timezone UTC */

import { jest } from "@jest/globals";

/*
 * The Traffic bandwidth chart's one-point-per-bucket cases (sdn-1, see
 * FlowBandwidthAxisCases) on the UTC wall clock, where the grid's steps and
 * the API's epoch-aligned buckets share their boundaries.
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

describeFlowBandwidthAxis("UTC", 0);
