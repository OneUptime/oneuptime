import FixPullRequestCiStatus, {
  FixPullRequestCiStatusHelper,
} from "../../../Types/AI/FixPullRequestCiStatus";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "../../../Types/AI/CodeFixTaskType";
import { describe, expect, test } from "@jest/globals";

/*
 * B4 Tier 1: the CI-conclusion roll-up and the SHOULD-FAIL rule. These pin
 * the honesty contract: a repo without CI is NoCiConfigured (unverified,
 * never verified — G9), conclusions are only final once every check
 * completed, and a RED conclusion on a should-fail regression-test PR is the
 * desired signal.
 */

describe("FixPullRequestCiStatusHelper.rollUpConclusion", () => {
  test("zero check runs means NoCiConfigured — never Green", () => {
    expect(
      FixPullRequestCiStatusHelper.rollUpConclusion({
        total: 0,
        completed: 0,
        failed: 0,
        pending: 0,
      }),
    ).toBe(FixPullRequestCiStatus.NoCiConfigured);
  });

  test("any pending run means Pending", () => {
    expect(
      FixPullRequestCiStatusHelper.rollUpConclusion({
        total: 3,
        completed: 2,
        failed: 0,
        pending: 1,
      }),
    ).toBe(FixPullRequestCiStatus.Pending);
  });

  test("pending wins over failed — a conclusion is only final once every check completed", () => {
    expect(
      FixPullRequestCiStatusHelper.rollUpConclusion({
        total: 3,
        completed: 1,
        failed: 1,
        pending: 2,
      }),
    ).toBe(FixPullRequestCiStatus.Pending);
  });

  test("any failed run (all completed) means Red", () => {
    expect(
      FixPullRequestCiStatusHelper.rollUpConclusion({
        total: 4,
        completed: 4,
        failed: 1,
        pending: 0,
      }),
    ).toBe(FixPullRequestCiStatus.Red);
  });

  test("all completed and none failed means Green", () => {
    expect(
      FixPullRequestCiStatusHelper.rollUpConclusion({
        total: 4,
        completed: 4,
        failed: 0,
        pending: 0,
      }),
    ).toBe(FixPullRequestCiStatus.Green);
  });
});

describe("FixPullRequestCiStatusHelper.applyTaskType (the SHOULD-FAIL rule)", () => {
  test("WriteRegressionTest + Red maps to ExpectedFailureObserved", () => {
    expect(
      FixPullRequestCiStatusHelper.applyTaskType({
        conclusion: FixPullRequestCiStatus.Red,
        taskType: CodeFixTaskType.WriteRegressionTest,
      }),
    ).toBe(FixPullRequestCiStatus.ExpectedFailureObserved);
  });

  test("fix-type recipes keep Red as Red", () => {
    for (const taskType of [
      CodeFixTaskType.FixException,
      CodeFixTaskType.ImproveInstrumentation,
      CodeFixTaskType.FixPerformance,
      CodeFixTaskType.FixFromIncident,
    ]) {
      expect(
        FixPullRequestCiStatusHelper.applyTaskType({
          conclusion: FixPullRequestCiStatus.Red,
          taskType,
        }),
      ).toBe(FixPullRequestCiStatus.Red);
    }
  });

  test("legacy null task type normalizes to FixException, so Red stays Red", () => {
    expect(
      FixPullRequestCiStatusHelper.applyTaskType({
        conclusion: FixPullRequestCiStatus.Red,
        taskType: CodeFixTaskTypeHelper.fromDatabaseValue(null),
      }),
    ).toBe(FixPullRequestCiStatus.Red);
  });

  test("non-Red conclusions pass through unchanged even for WriteRegressionTest", () => {
    for (const conclusion of [
      FixPullRequestCiStatus.Green,
      FixPullRequestCiStatus.Pending,
      FixPullRequestCiStatus.NoCiConfigured,
    ]) {
      expect(
        FixPullRequestCiStatusHelper.applyTaskType({
          conclusion,
          taskType: CodeFixTaskType.WriteRegressionTest,
        }),
      ).toBe(conclusion);
    }
  });
});

describe("FixPullRequestCiStatusHelper.isVerified (the G9 predicate)", () => {
  test("only Green and ExpectedFailureObserved are verified", () => {
    expect(
      FixPullRequestCiStatusHelper.isVerified(FixPullRequestCiStatus.Green),
    ).toBe(true);
    expect(
      FixPullRequestCiStatusHelper.isVerified(
        FixPullRequestCiStatus.ExpectedFailureObserved,
      ),
    ).toBe(true);
  });

  test("absence of CI is NEVER verified — nor is pending, red, or unpolled null", () => {
    expect(
      FixPullRequestCiStatusHelper.isVerified(
        FixPullRequestCiStatus.NoCiConfigured,
      ),
    ).toBe(false);
    expect(
      FixPullRequestCiStatusHelper.isVerified(FixPullRequestCiStatus.Pending),
    ).toBe(false);
    expect(
      FixPullRequestCiStatusHelper.isVerified(FixPullRequestCiStatus.Red),
    ).toBe(false);
    expect(FixPullRequestCiStatusHelper.isVerified(null)).toBe(false);
    expect(FixPullRequestCiStatusHelper.isVerified(undefined)).toBe(false);
  });
});

describe("FixPullRequestCiStatusHelper.describeForProgressLog", () => {
  test("green line carries the check counts", () => {
    expect(
      FixPullRequestCiStatusHelper.describeForProgressLog({
        ciStatus: FixPullRequestCiStatus.Green,
        counts: { total: 4, completed: 4, failed: 0, pending: 0 },
      }),
    ).toBe("CI on the fix PR: Green (4/4 checks passed)");
  });

  test("expected-failure line says the failure is the desired signal", () => {
    expect(
      FixPullRequestCiStatusHelper.describeForProgressLog({
        ciStatus: FixPullRequestCiStatus.ExpectedFailureObserved,
        counts: { total: 3, completed: 3, failed: 1, pending: 0 },
      }),
    ).toContain("expected failure observed");
  });

  test("no-CI line says the fix is unverified", () => {
    expect(
      FixPullRequestCiStatusHelper.describeForProgressLog({
        ciStatus: FixPullRequestCiStatus.NoCiConfigured,
        counts: { total: 0, completed: 0, failed: 0, pending: 0 },
      }),
    ).toContain("unverified");
  });
});
