import SqlMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/SqlMonitorCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import SqlMonitorResponse from "../../../../../Types/Monitor/SqlMonitor/SqlMonitorResponse";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import ObjectID from "../../../../../Types/ObjectID";
import { JSONObject } from "../../../../../Types/JSON";

function buildDataToProcess(input: {
  isOnline?: boolean;
  responseTimeInMs?: number;
  rowCount?: number | null;
  scalarValue?: string | number | boolean | null;
  firstRow?: JSONObject | null;
  queryError?: string | null;
}): ProbeMonitorResponse {
  const sqlResponse: SqlMonitorResponse = {
    isOnline: input.isOnline ?? true,
    responseTimeInMs: input.responseTimeInMs ?? 42,
    failureCause: "",
    rowCount: input.rowCount === undefined ? 1 : input.rowCount,
    scalarValue: input.scalarValue === undefined ? null : input.scalarValue,
    firstRow: input.firstRow === undefined ? null : input.firstRow,
    queryError: input.queryError === undefined ? null : input.queryError,
  };

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    isOnline: input.isOnline ?? true,
    responseTimeInMs: input.responseTimeInMs ?? 42,
    sqlQueryMonitorResponse: sqlResponse,
    monitoredAt: new Date(),
  };
}

async function evaluate(
  dataToProcess: ProbeMonitorResponse,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return SqlMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess,
    criteriaFilter,
  });
}

describe("SqlMonitorCriteria.isMonitorInstanceCriteriaFilterMet", () => {
  describe("SqlIsOnline", () => {
    test("online + True → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ isOnline: true }),
        { checkOn: CheckOn.SqlIsOnline, filterType: FilterType.True, value: undefined },
      );
      expect(result).toBeTruthy();
    });

    test("online + False → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ isOnline: true }),
        { checkOn: CheckOn.SqlIsOnline, filterType: FilterType.False, value: undefined },
      );
      expect(result).toBeNull();
    });

    test("offline + False → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ isOnline: false }),
        { checkOn: CheckOn.SqlIsOnline, filterType: FilterType.False, value: undefined },
      );
      expect(result).toBeTruthy();
    });
  });

  describe("SqlQueryRowCount", () => {
    test("rowCount 120 > 50 → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ rowCount: 120 }),
        { checkOn: CheckOn.SqlQueryRowCount, filterType: FilterType.GreaterThan, value: "50" },
      );
      expect(result).toBeTruthy();
    });

    test("rowCount 10 > 50 → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ rowCount: 10 }),
        { checkOn: CheckOn.SqlQueryRowCount, filterType: FilterType.GreaterThan, value: "50" },
      );
      expect(result).toBeNull();
    });

    test("rowCount 0 EqualTo 0 → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ rowCount: 0 }),
        { checkOn: CheckOn.SqlQueryRowCount, filterType: FilterType.EqualTo, value: "0" },
      );
      expect(result).toBeTruthy();
    });

    test("rowCount null → not met (no data)", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ rowCount: null }),
        { checkOn: CheckOn.SqlQueryRowCount, filterType: FilterType.GreaterThan, value: "50" },
      );
      expect(result).toBeNull();
    });
  });

  describe("SqlQueryScalarValue", () => {
    test("numeric string scalar '150' > 50 → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ scalarValue: "150" }),
        { checkOn: CheckOn.SqlQueryScalarValue, filterType: FilterType.GreaterThan, value: "50" },
      );
      expect(result).toBeTruthy();
    });

    test("numeric scalar 3 EqualTo 3 → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ scalarValue: 3 }),
        { checkOn: CheckOn.SqlQueryScalarValue, filterType: FilterType.EqualTo, value: "3" },
      );
      expect(result).toBeTruthy();
    });

    test("string scalar 'CANCELLED' Contains 'CANCEL' → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ scalarValue: "CANCELLED" }),
        { checkOn: CheckOn.SqlQueryScalarValue, filterType: FilterType.Contains, value: "CANCEL" },
      );
      expect(result).toBeTruthy();
    });

    test("null scalar → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ scalarValue: null }),
        { checkOn: CheckOn.SqlQueryScalarValue, filterType: FilterType.GreaterThan, value: "50" },
      );
      expect(result).toBeNull();
    });
  });

  describe("SqlQueryExecutionTime", () => {
    test("executionTime 8000 > 5000 → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ responseTimeInMs: 8000 }),
        { checkOn: CheckOn.SqlQueryExecutionTime, filterType: FilterType.GreaterThan, value: "5000" },
      );
      expect(result).toBeTruthy();
    });

    test("executionTime 100 > 5000 → not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ responseTimeInMs: 100 }),
        { checkOn: CheckOn.SqlQueryExecutionTime, filterType: FilterType.GreaterThan, value: "5000" },
      );
      expect(result).toBeNull();
    });
  });

  describe("SqlQueryError", () => {
    test("error present + IsNotEmpty → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ queryError: "connection refused" }),
        { checkOn: CheckOn.SqlQueryError, filterType: FilterType.IsNotEmpty, value: undefined },
      );
      expect(result).toBeTruthy();
    });

    test("error null + IsEmpty → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ queryError: null }),
        { checkOn: CheckOn.SqlQueryError, filterType: FilterType.IsEmpty, value: undefined },
      );
      expect(result).toBeTruthy();
    });

    test("error 'timeout' Contains 'timeout' → met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ queryError: "canceling statement due to statement timeout" }),
        { checkOn: CheckOn.SqlQueryError, filterType: FilterType.Contains, value: "timeout" },
      );
      expect(result).toBeTruthy();
    });
  });

  test("unrelated checkOn → null", async () => {
    const result: string | null = await evaluate(buildDataToProcess({}), {
      checkOn: CheckOn.ResponseBody,
      filterType: FilterType.Contains,
      value: "x",
    });
    expect(result).toBeNull();
  });
});
