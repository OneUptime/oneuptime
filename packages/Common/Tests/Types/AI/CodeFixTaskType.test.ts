import CodeFixTaskType, {
  CodeFixContextKind,
  CodeFixTaskTypeHelper,
} from "../../../Types/AI/CodeFixTaskType";

describe("CodeFixTaskTypeHelper", () => {
  describe("getUserTriggerableTaskTypes", () => {
    test("only exception-page recipes are user triggerable", () => {
      expect(CodeFixTaskTypeHelper.getUserTriggerableTaskTypes()).toEqual([
        CodeFixTaskType.FixException,
        CodeFixTaskType.WriteRegressionTest,
        CodeFixTaskType.ImproveExceptionHandling,
      ]);
    });
  });

  describe("isUserTriggerable", () => {
    test.each([
      CodeFixTaskType.FixException,
      CodeFixTaskType.WriteRegressionTest,
      CodeFixTaskType.ImproveExceptionHandling,
    ])("returns true for %s", (taskType: CodeFixTaskType) => {
      expect(CodeFixTaskTypeHelper.isUserTriggerable(taskType)).toBe(true);
    });

    test.each([
      CodeFixTaskType.ImproveInstrumentation,
      CodeFixTaskType.FixPerformance,
      CodeFixTaskType.FixFromIncident,
    ])(
      "returns false for %s (not exception-page triggered)",
      (taskType: CodeFixTaskType) => {
        expect(CodeFixTaskTypeHelper.isUserTriggerable(taskType)).toBe(false);
      },
    );
  });

  describe("getContextKind", () => {
    test.each([
      [CodeFixTaskType.FixException, CodeFixContextKind.TelemetryException],
      [
        CodeFixTaskType.WriteRegressionTest,
        CodeFixContextKind.TelemetryException,
      ],
      [
        CodeFixTaskType.ImproveInstrumentation,
        CodeFixContextKind.IncidentOrAlertSubject,
      ],
      [
        CodeFixTaskType.FixFromIncident,
        CodeFixContextKind.IncidentOrAlertSubject,
      ],
      [CodeFixTaskType.FixPerformance, CodeFixContextKind.TaskContext],
    ])(
      "maps %s to %s",
      (taskType: CodeFixTaskType, expected: CodeFixContextKind) => {
        expect(CodeFixTaskTypeHelper.getContextKind(taskType)).toBe(expected);
      },
    );

    test("every task type resolves to a known context kind", () => {
      for (const taskType of Object.values(CodeFixTaskType)) {
        expect(Object.values(CodeFixContextKind)).toContain(
          CodeFixTaskTypeHelper.getContextKind(taskType),
        );
      }
    });
  });

  describe("requiresTelemetryException", () => {
    test.each([
      CodeFixTaskType.FixException,
      CodeFixTaskType.WriteRegressionTest,
      CodeFixTaskType.ImproveExceptionHandling,
    ])("returns true for %s", (taskType: CodeFixTaskType) => {
      expect(CodeFixTaskTypeHelper.requiresTelemetryException(taskType)).toBe(
        true,
      );
    });

    test.each([
      CodeFixTaskType.ImproveInstrumentation,
      CodeFixTaskType.FixPerformance,
      CodeFixTaskType.FixFromIncident,
    ])("returns false for %s", (taskType: CodeFixTaskType) => {
      expect(CodeFixTaskTypeHelper.requiresTelemetryException(taskType)).toBe(
        false,
      );
    });

    test("stays in sync with getContextKind", () => {
      for (const taskType of Object.values(CodeFixTaskType)) {
        expect(CodeFixTaskTypeHelper.requiresTelemetryException(taskType)).toBe(
          CodeFixTaskTypeHelper.getContextKind(taskType) ===
            CodeFixContextKind.TelemetryException,
        );
      }
    });

    test("every user-triggerable recipe is exception-based", () => {
      for (const taskType of CodeFixTaskTypeHelper.getUserTriggerableTaskTypes()) {
        expect(CodeFixTaskTypeHelper.requiresTelemetryException(taskType)).toBe(
          true,
        );
      }
    });
  });

  describe("isValidTaskType", () => {
    test("accepts every enum value", () => {
      for (const taskType of Object.values(CodeFixTaskType)) {
        expect(CodeFixTaskTypeHelper.isValidTaskType(taskType)).toBe(true);
      }
    });

    test.each(["", "NotATaskType", "fixexception"])(
      "rejects %p",
      (value: string) => {
        expect(CodeFixTaskTypeHelper.isValidTaskType(value)).toBe(false);
      },
    );
  });

  describe("fromDatabaseValue", () => {
    test("normalizes a legacy null/undefined column to FixException", () => {
      expect(CodeFixTaskTypeHelper.fromDatabaseValue(null)).toBe(
        CodeFixTaskType.FixException,
      );
      expect(CodeFixTaskTypeHelper.fromDatabaseValue(undefined)).toBe(
        CodeFixTaskType.FixException,
      );
    });

    test.each(["", "NotATaskType"])(
      "falls back to FixException for the unrecognized value %p",
      (value: string) => {
        expect(CodeFixTaskTypeHelper.fromDatabaseValue(value)).toBe(
          CodeFixTaskType.FixException,
        );
      },
    );

    test("round-trips every valid task type", () => {
      for (const taskType of Object.values(CodeFixTaskType)) {
        expect(CodeFixTaskTypeHelper.fromDatabaseValue(taskType)).toBe(
          taskType,
        );
        // Also accepts the raw wire string.
        expect(
          CodeFixTaskTypeHelper.fromDatabaseValue(taskType.toString()),
        ).toBe(taskType);
      }
    });
  });
});
