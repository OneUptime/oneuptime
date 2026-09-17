import ExceptionMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/ExceptionMonitorCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import ExceptionMonitorResponse from "../../../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import DataToProcess from "../../../../../Server/Utils/Monitor/DataToProcess";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * ExceptionMonitorCriteria is the ExceptionCount analogue of
 * LogMonitorCriteria and shares the same fallback-fixed worker path
 * (monitorException). Covered here for parity across the count-based
 * telemetry criteria.
 */
function buildResponse(exceptionCount: number | undefined): DataToProcess {
  const response: Partial<ExceptionMonitorResponse> = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    exceptionCount: exceptionCount as number,
    exceptionQuery: {},
  };
  return response as DataToProcess;
}

function evaluate(
  exceptionCount: number | undefined,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return ExceptionMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: buildResponse(exceptionCount),
    criteriaFilter,
  });
}

describe("ExceptionMonitorCriteria.isMonitorInstanceCriteriaFilterMet", () => {
  test("ExceptionCount GreaterThan 0 → met when exceptions exist", async () => {
    expect(
      await evaluate(3, {
        checkOn: CheckOn.ExceptionCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      }),
    ).toBeTruthy();
  });

  test("ExceptionCount EqualTo 0 → met when there are none (default)", async () => {
    expect(
      await evaluate(0, {
        checkOn: CheckOn.ExceptionCount,
        filterType: FilterType.EqualTo,
        value: 0,
      }),
    ).toBeTruthy();
  });

  test("ExceptionCount GreaterThan → not met when none", async () => {
    expect(
      await evaluate(0, {
        checkOn: CheckOn.ExceptionCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      }),
    ).toBeNull();
  });

  test("a missing exceptionCount is treated as 0", async () => {
    expect(
      await evaluate(undefined, {
        checkOn: CheckOn.ExceptionCount,
        filterType: FilterType.EqualTo,
        value: 0,
      }),
    ).toBeTruthy();
  });

  test("a non-ExceptionCount checkOn returns null (unhandled)", async () => {
    expect(
      await evaluate(9, {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      }),
    ).toBeNull();
  });
});
