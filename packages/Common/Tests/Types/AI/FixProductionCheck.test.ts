import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import FixProductionCheck, {
  FixProductionCheckHelper,
} from "../../../Types/AI/FixProductionCheck";
import { describe, expect, test } from "@jest/globals";

/*
 * Which merged AI fixes production is watched for, and with which check.
 * A recipe whose effect production cannot show is never watched: a merged
 * regression test, a review or a request in Code is not "fixed" by running.
 */

describe("FixProductionCheckHelper.forTaskType", () => {
  test("every recipe that fixes or improves something production shows has its check", () => {
    expect(
      FixProductionCheckHelper.forTaskType(CodeFixTaskType.FixException),
    ).toBe(FixProductionCheck.Exception);
    expect(
      FixProductionCheckHelper.forTaskType(CodeFixTaskType.FixPerformance),
    ).toBe(FixProductionCheck.Performance);
    expect(
      FixProductionCheckHelper.forTaskType(CodeFixTaskType.FixFromIncident),
    ).toBe(FixProductionCheck.Recurrence);

    for (const taskType of [
      CodeFixTaskType.ImproveInstrumentation,
      CodeFixTaskType.ImproveLogging,
      CodeFixTaskType.ImproveTracing,
    ]) {
      expect(FixProductionCheckHelper.forTaskType(taskType)).toBe(
        FixProductionCheck.Telemetry,
      );
    }
  });

  test("the rest are not watched", () => {
    const watched: Array<CodeFixTaskType> = [
      CodeFixTaskType.FixException,
      CodeFixTaskType.FixPerformance,
      CodeFixTaskType.FixFromIncident,
      CodeFixTaskType.ImproveInstrumentation,
      CodeFixTaskType.ImproveLogging,
      CodeFixTaskType.ImproveTracing,
    ];

    for (const taskType of Object.values(CodeFixTaskType)) {
      if (!watched.includes(taskType)) {
        expect(FixProductionCheckHelper.forTaskType(taskType)).toBeNull();
      }
    }

    // A new recipe is not watched until someone says how.
    expect(
      Object.values(CodeFixTaskType)
        .filter((taskType: CodeFixTaskType) => {
          return FixProductionCheckHelper.forTaskType(taskType) !== null;
        })
        .sort(),
    ).toEqual([...watched].sort());
  });
});

describe("FixProductionCheckHelper.fromDatabaseValue", () => {
  test("a stored check reads as itself", () => {
    for (const check of Object.values(FixProductionCheck)) {
      expect(FixProductionCheckHelper.fromDatabaseValue(check)).toBe(check);
    }
  });

  test("none is an exception fix, watched before the column existed", () => {
    expect(FixProductionCheckHelper.fromDatabaseValue(null)).toBe(
      FixProductionCheck.Exception,
    );
    expect(FixProductionCheckHelper.fromDatabaseValue(undefined)).toBe(
      FixProductionCheck.Exception,
    );
    expect(FixProductionCheckHelper.fromDatabaseValue("")).toBe(
      FixProductionCheck.Exception,
    );
  });

  test("one this server does not know is not read as one it does", () => {
    expect(
      FixProductionCheckHelper.fromDatabaseValue("FasterQueries"),
    ).toBeUndefined();
    expect(FixProductionCheckHelper.fromDatabaseValue(7)).toBeUndefined();
  });

  test("the stored values are a wire contract", () => {
    expect(Object.values(FixProductionCheck)).toEqual([
      "Exception",
      "Performance",
      "Recurrence",
      "Telemetry",
    ]);
  });
});
