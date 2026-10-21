/** @timezone America/New_York */

import { jest } from "@jest/globals";

/*
 * The Traffic bandwidth chart's one-point-per-bucket cases (sdn-1, see
 * FlowBandwidthAxisCases) on the America/New_York wall clock, a zone behind
 * UTC (UTC-4 in September): the viewer's days start hours after the UTC
 * days the API's buckets are aligned to.
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

describeFlowBandwidthAxis("America/New_York", -240);
