import LogMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/LogMonitorCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import LogMonitorResponse from "../../../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import DataToProcess from "../../../../../Server/Utils/Monitor/DataToProcess";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * LogMonitorCriteria is what turns the logCount the (now-fixed) worker
 * produces into an online/offline verdict. It only understands
 * CheckOn.LogCount — the sole check the Logs criteria UI offers — and defers
 * the numeric comparison to CompareCriteria.
 */
function buildResponse(logCount: number | undefined): DataToProcess {
  const response: Partial<LogMonitorResponse> = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    logCount: logCount as number,
    logQuery: {},
  };
  return response as DataToProcess;
}

function evaluate(
  logCount: number | undefined,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: buildResponse(logCount),
    criteriaFilter,
  });
}

describe("LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet", () => {
  describe("LogCount GreaterThan", () => {
    test("count above threshold → met", async () => {
      const result: string | null = await evaluate(5, {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      });
      expect(result).toBeTruthy();
      expect(result).toContain("Log Count");
    });

    test("count equal to threshold → not met", async () => {
      expect(
        await evaluate(3, {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.GreaterThan,
          value: 3,
        }),
      ).toBeNull();
    });

    test("count below threshold → not met", async () => {
      expect(
        await evaluate(0, {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.GreaterThan,
          value: 0,
        }),
      ).toBeNull();
    });
  });

  describe("LogCount EqualTo (the default offline criteria)", () => {
    test("zero logs equal to 0 → met (monitor goes offline)", async () => {
      const result: string | null = await evaluate(0, {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.EqualTo,
        value: 0,
      });
      expect(result).toBeTruthy();
    });

    test("some logs not equal to 0 → not met", async () => {
      expect(
        await evaluate(7, {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.EqualTo,
          value: 0,
        }),
      ).toBeNull();
    });
  });

  describe("other numeric comparators", () => {
    test("LessThan → met when below", async () => {
      expect(
        await evaluate(2, {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.LessThan,
          value: 5,
        }),
      ).toBeTruthy();
    });

    test("GreaterThanOrEqualTo → met at the boundary", async () => {
      expect(
        await evaluate(5, {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.GreaterThanOrEqualTo,
          value: 5,
        }),
      ).toBeTruthy();
    });

    test("LessThanOrEqualTo → met at the boundary", async () => {
      expect(
        await evaluate(5, {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.LessThanOrEqualTo,
          value: 5,
        }),
      ).toBeTruthy();
    });

    test("NotEqualTo → met when different", async () => {
      expect(
        await evaluate(4, {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.NotEqualTo,
          value: 0,
        }),
      ).toBeTruthy();
    });
  });

  describe("edge cases", () => {
    test("a missing logCount is treated as 0", async () => {
      // undefined logCount → 0; "equal to 0" is therefore met.
      expect(
        await evaluate(undefined, {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.EqualTo,
          value: 0,
        }),
      ).toBeTruthy();
    });

    test("a string threshold is coerced to a number", async () => {
      expect(
        await evaluate(10, {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.GreaterThan,
          value: "5",
        }),
      ).toBeTruthy();
    });

    test("a non-LogCount checkOn returns null (unhandled)", async () => {
      expect(
        await evaluate(100, {
          checkOn: CheckOn.SpanCount,
          filterType: FilterType.GreaterThan,
          value: 0,
        }),
      ).toBeNull();
    });
  });
});
