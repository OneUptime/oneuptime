import TraceMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/TraceMonitorCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import TraceMonitorResponse from "../../../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import DataToProcess from "../../../../../Server/Utils/Monitor/DataToProcess";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * TraceMonitorCriteria is the SpanCount analogue of LogMonitorCriteria and
 * shares the same fallback-fixed worker path (monitorTrace). Covered here for
 * parity so the two count-based telemetry criteria stay in lock-step.
 */
function buildResponse(spanCount: number | undefined): DataToProcess {
  const response: Partial<TraceMonitorResponse> = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    spanCount: spanCount as number,
    spanQuery: {},
  };
  return response as DataToProcess;
}

function evaluate(
  spanCount: number | undefined,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: buildResponse(spanCount),
    criteriaFilter,
  });
}

describe("TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet", () => {
  test("SpanCount GreaterThan → met when above threshold", async () => {
    expect(
      await evaluate(9, {
        checkOn: CheckOn.SpanCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      }),
    ).toBeTruthy();
  });

  test("SpanCount EqualTo 0 → met when no spans (offline)", async () => {
    expect(
      await evaluate(0, {
        checkOn: CheckOn.SpanCount,
        filterType: FilterType.EqualTo,
        value: 0,
      }),
    ).toBeTruthy();
  });

  test("SpanCount GreaterThan → not met at/below threshold", async () => {
    expect(
      await evaluate(0, {
        checkOn: CheckOn.SpanCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      }),
    ).toBeNull();
  });

  test("a missing spanCount is treated as 0", async () => {
    expect(
      await evaluate(undefined, {
        checkOn: CheckOn.SpanCount,
        filterType: FilterType.EqualTo,
        value: 0,
      }),
    ).toBeTruthy();
  });

  test("a non-SpanCount checkOn returns null (unhandled)", async () => {
    expect(
      await evaluate(50, {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      }),
    ).toBeNull();
  });
});
