import { describe, expect, test } from "@jest/globals";
import {
  compareReconciliationValues,
  DataReconciliationMeasure,
  DataReconciliationMetricName,
  DataReconciliationOutcome,
  DataReconciliationSide,
  DataReconciliationStatus,
  DataReconciliationToleranceType,
  doesMeasureNeedColumn,
  getDataReconciliationError,
  getMeasureCheckType,
  reconcileSides,
} from "../../../../Types/DataObservability/DataReconciliation";
import {
  DataCheckType,
  isColumnCheckType,
} from "../../../../Types/DataObservability/DataCheckType";
import { buildDataCheckStatement } from "../../../../Server/Utils/DataObservability/DataCheckSql";
import { buildDataReconciliationMonitorStep } from "../../../../Types/Monitor/DataReconciliationMonitorStep";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { JSONObject } from "../../../../Types/JSON";
import { buildReconciliationMetricRow } from "../../../../Server/Utils/DataObservability/DataReconciliationCompare";
import { getReconciliationCheckName } from "../../../../Server/Utils/DataObservability/DataReconciliationSync";

/*
 * TWO COPIES OF THE SAME DATA, KEPT HONEST.
 *
 * One measure of two tables, each read by a check of its own, compared once
 * read together: within an absolute amount or a percentage of the source,
 * they are in step; beyond it, drifted, which alerts; a failed side fails
 * the reconciliation, and a side not read yet, or read too far from the
 * other, makes it wait.
 */

const NOW: Date = new Date("2026-11-04T10:00:00.000Z");

function side(
  value: number | null,
  minutesAgo: number | null,
  failed: boolean = false,
): DataReconciliationSide {
  return {
    value,
    readAt:
      minutesAgo === null
        ? null
        : new Date(NOW.getTime() - minutesAgo * 60 * 1000),
    failed,
    message: failed ? 'relation "orders" does not exist' : null,
  };
}

describe("comparing two values", () => {
  test("within a percentage of the source's value, or beyond it", () => {
    expect(
      compareReconciliationValues({
        sourceValue: 1000,
        targetValue: 996,
        toleranceType: DataReconciliationToleranceType.Percent,
        tolerance: 0.5,
      }),
    ).toEqual({ difference: -4, differencePercent: 0.4, isDrifted: false });
    expect(
      compareReconciliationValues({
        sourceValue: 1000,
        targetValue: 990,
        toleranceType: DataReconciliationToleranceType.Percent,
        tolerance: 0.5,
      }).isDrifted,
    ).toBe(true);
  });

  test("within an absolute amount, either way", () => {
    expect(
      compareReconciliationValues({
        sourceValue: 1000,
        targetValue: 1003,
        toleranceType: DataReconciliationToleranceType.Absolute,
        tolerance: 3,
      }).isDrifted,
    ).toBe(false);
    expect(
      compareReconciliationValues({
        sourceValue: 1000,
        targetValue: 996,
        toleranceType: DataReconciliationToleranceType.Absolute,
        tolerance: 3,
      }).isDrifted,
    ).toBe(true);
  });

  test("a tolerance of 0 means exactly; an empty source against anything is 100% apart", () => {
    expect(
      compareReconciliationValues({
        sourceValue: 5,
        targetValue: 5,
        toleranceType: DataReconciliationToleranceType.Absolute,
        tolerance: 0,
      }).isDrifted,
    ).toBe(false);
    expect(
      compareReconciliationValues({
        sourceValue: 0,
        targetValue: 0,
        toleranceType: DataReconciliationToleranceType.Percent,
        tolerance: 0,
      }).differencePercent,
    ).toBe(0);
    expect(
      compareReconciliationValues({
        sourceValue: 0,
        targetValue: 12,
        toleranceType: DataReconciliationToleranceType.Percent,
        tolerance: 50,
      }),
    ).toEqual({ difference: 12, differencePercent: 100, isDrifted: true });
  });
});

describe("reconciling the two sides", () => {
  const tolerance: {
    toleranceType: DataReconciliationToleranceType;
    tolerance: number;
  } = { toleranceType: DataReconciliationToleranceType.Percent, tolerance: 1 };

  test("two values read together are compared, as of the later of the two", () => {
    const outcome: DataReconciliationOutcome = reconcileSides({
      source: side(1000, 6),
      target: side(980, 2),
      ...tolerance,
    });

    expect(outcome.status).toBe(DataReconciliationStatus.Drifted);
    expect(
      outcome.status === DataReconciliationStatus.Drifted
        ? outcome.comparedAt
        : null,
    ).toEqual(new Date(NOW.getTime() - 2 * 60 * 1000));
  });

  test("a side read too far from the other, or not yet, makes it wait", () => {
    expect(
      reconcileSides({
        source: side(1000, 60),
        target: side(1000, 2),
        ...tolerance,
      }),
    ).toMatchObject({
      status: DataReconciliationStatus.Waiting,
      message: expect.stringContaining("58 minutes apart"),
    });
    expect(
      reconcileSides({
        source: side(null, null),
        target: side(1000, 2),
        ...tolerance,
      }).status,
    ).toBe(DataReconciliationStatus.Waiting);
  });

  test("a side whose check failed fails it, saying why", () => {
    expect(
      reconcileSides({
        source: side(1000, 2),
        target: side(null, 1, true),
        ...tolerance,
      }),
    ).toEqual({
      status: DataReconciliationStatus.Failed,
      message:
        'The target\'s check could not run: relation "orders" does not exist',
    });
  });
});

describe("a reconciliation, as saved", () => {
  const valid: Record<string, unknown> = {
    toleranceType: DataReconciliationToleranceType.Percent,
    tolerance: 0.5,
    sourceMeasure: DataReconciliationMeasure.RowCount,
    targetMeasure: DataReconciliationMeasure.Sum,
    targetColumnName: "amount",
  };

  test("needs a tolerance, and each side the column or query its measure reads", () => {
    expect(getDataReconciliationError(valid)).toBe(null);
    expect(getDataReconciliationError({ ...valid, tolerance: -1 })).toContain(
      "0 or more",
    );
    expect(getDataReconciliationError({ ...valid, tolerance: "" })).toContain(
      "0 or more",
    );
    expect(
      getDataReconciliationError({ ...valid, toleranceType: "Relative" }),
    ).toContain("Absolute or Percent");
    expect(
      getDataReconciliationError({ ...valid, targetColumnName: " " }),
    ).toContain("target's Sum needs a column");
    expect(
      getDataReconciliationError({
        ...valid,
        sourceMeasure: DataReconciliationMeasure.CustomSql,
      }),
    ).toContain("source's Custom SQL needs a query");
    expect(
      getDataReconciliationError({ ...valid, sourceMeasure: "Average" }),
    ).toContain("source's measure");
  });

  test("each measure is read by the check of that kind", () => {
    expect(getMeasureCheckType(DataReconciliationMeasure.RowCount)).toBe(
      DataCheckType.RowCount,
    );
    expect(getMeasureCheckType(DataReconciliationMeasure.Sum)).toBe(
      DataCheckType.Sum,
    );
    expect(getMeasureCheckType(DataReconciliationMeasure.DistinctCount)).toBe(
      DataCheckType.DistinctCount,
    );
    expect(getMeasureCheckType(DataReconciliationMeasure.CustomSql)).toBe(
      DataCheckType.CustomSql,
    );
    expect(doesMeasureNeedColumn(DataReconciliationMeasure.RowCount)).toBe(
      false,
    );
    expect(doesMeasureNeedColumn(DataReconciliationMeasure.Sum)).toBe(true);
  });

  test("its checks are named after it and the side they read, within a check's name", () => {
    expect(
      getReconciliationCheckName("Orders: app vs warehouse", "source"),
    ).toBe("Orders: app vs warehouse - source");
    expect(getReconciliationCheckName("x".repeat(200), "target")).toHaveLength(
      100,
    );
  });
});

describe("a Sum check", () => {
  test("reads one column, and adds up no rows to 0", () => {
    expect(isColumnCheckType(DataCheckType.Sum)).toBe(true);

    const statement: { sql: string; params: Array<string> } =
      buildDataCheckStatement("postgresql", {
        type: DataCheckType.Sum,
        schemaName: "public",
        tableName: "orders",
        columnName: "amount",
      });

    expect(statement.sql).toContain('COALESCE(SUM(CAST("amount" AS');
    expect(statement.sql).toContain(", 0)");
  });
});

describe("a reconciliation's monitor and metrics", () => {
  test("alerts on its own drifted metric, over a window holding its latest comparisons", () => {
    const step: MonitorStep = buildDataReconciliationMonitorStep({
      reconciliationId: "11111111-1111-4111-8111-111111111111",
      reconciliationName: "Orders: app vs warehouse",
      intervalInMinutes: 60,
      monitorName: "Orders: app vs warehouse - Reconciliation",
      onlineMonitorStatusId: new ObjectID(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ),
      offlineMonitorStatusId: new ObjectID(
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ),
      defaultIncidentSeverityId: new ObjectID(
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      ),
      defaultAlertSeverityId: new ObjectID(
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      ),
    });
    const text: string = JSON.stringify(step.toJSON());

    expect(text).toContain(DataReconciliationMetricName.Drifted);
    expect(text).toContain("11111111-1111-4111-8111-111111111111");
    expect(text).toContain(RollingTime.Past2Hours);
  });

  test("its rows are tagged with it, OneUptime's own operational data", () => {
    const row: JSONObject = buildReconciliationMetricRow({
      projectId: new ObjectID("22222222-2222-4222-8222-222222222222"),
      reconciliationId: new ObjectID("11111111-1111-4111-8111-111111111111"),
      reconciliationName: "Orders: app vs warehouse",
      metricName: DataReconciliationMetricName.Difference,
      value: -4,
      at: NOW,
      retentionDays: 15,
    });

    expect(row["name"]).toBe("oneuptime.data.reconciliation.difference");
    expect(row["primaryEntityType"]).toBe(ServiceType.DataReconciliation);
    expect(row["value"]).toBe(-4);
  });
});
