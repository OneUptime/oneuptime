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

  /*
   * A production review is a code-fix run so it lives in Code with the
   * rest, but the SERVER carries it out: no Runner may ever be handed one -
   * not one that names it among what it can do, not one that names nothing,
   * and not the queue's count a Runner autoscales on.
   */
  describe("recipes the server runs itself", () => {
    test("the production review is the one, and the only one", () => {
      expect(CodeFixTaskTypeHelper.getServerRunTaskTypes()).toEqual([
        CodeFixTaskType.GitHubPullRequestProductionReview,
      ]);

      for (const taskType of Object.values(CodeFixTaskType)) {
        expect(CodeFixTaskTypeHelper.isRunByServer(taskType)).toBe(
          taskType === CodeFixTaskType.GitHubPullRequestProductionReview,
        );
      }

      expect(CodeFixTaskTypeHelper.isRunByServer(null)).toBe(false);
      expect(CodeFixTaskTypeHelper.isRunByServer(undefined)).toBe(false);
      expect(CodeFixTaskTypeHelper.isRunByServer("SomethingElse")).toBe(false);
    });

    test("a Runner may be handed every recipe but those", () => {
      expect(CodeFixTaskTypeHelper.getRunnerTaskTypes()).toEqual(
        Object.values(CodeFixTaskType).filter((taskType: CodeFixTaskType) => {
          return taskType !== CodeFixTaskType.GitHubPullRequestProductionReview;
        }),
      );
      expect(
        CodeFixTaskTypeHelper.getTaskTypesForRunnersThatDoNotSay(),
      ).not.toContain(CodeFixTaskType.GitHubPullRequestProductionReview);
    });

    test("a Runner that says it can review against production is not believed", () => {
      expect(
        CodeFixTaskTypeHelper.readSupportedTaskTypes([
          CodeFixTaskType.GitHubPullRequestProductionReview,
          CodeFixTaskType.FixException,
        ]),
      ).toEqual([CodeFixTaskType.FixException]);
    });

    test("it carries its context in the run, opens no pull request, and is not a GitHub agent recipe", () => {
      expect(
        CodeFixTaskTypeHelper.getContextKind(
          CodeFixTaskType.GitHubPullRequestProductionReview,
        ),
      ).toBe(CodeFixContextKind.TaskContext);
      expect(
        CodeFixTaskTypeHelper.opensNewPullRequest(
          CodeFixTaskType.GitHubPullRequestProductionReview,
        ),
      ).toBe(false);
      expect(
        CodeFixTaskTypeHelper.isGitHubTaskType(
          CodeFixTaskType.GitHubPullRequestProductionReview,
        ),
      ).toBe(false);
      expect(
        CodeFixTaskTypeHelper.isUserTriggerable(
          CodeFixTaskType.GitHubPullRequestProductionReview,
        ),
      ).toBe(false);
    });

    test("isProductionReview names it, and nothing else", () => {
      expect(
        CodeFixTaskTypeHelper.isProductionReview(
          CodeFixTaskType.GitHubPullRequestProductionReview,
        ),
      ).toBe(true);
      expect(
        CodeFixTaskTypeHelper.isProductionReview(
          CodeFixTaskType.GitHubPullRequestReview,
        ),
      ).toBe(false);
      expect(CodeFixTaskTypeHelper.isProductionReview(null)).toBe(false);
    });

    test("its wire value never changes", () => {
      expect(CodeFixTaskType.GitHubPullRequestProductionReview).toBe(
        "GitHubPullRequestProductionReview",
      );
    });
  });

  /*
   * Which recipes' failed or stopped turns are asked again from Code (Try
   * again, Retry selected, #6509): every recipe is decided, so a new one is
   * a decision too.
   */
  describe("canBeAskedAgain", () => {
    const NOT_ASKED_AGAIN_IN_CODE: Record<string, string> = {
      [CodeFixTaskType.GitHubIssueFix]:
        "Asked for on GitHub: its answer goes back to the issue.",
      [CodeFixTaskType.GitHubPullRequestRevision]:
        "Asked for on GitHub: its answer goes back to the pull request.",
      [CodeFixTaskType.GitHubPullRequestReview]:
        "Asked for on GitHub: its review goes back to the pull request.",
      [CodeFixTaskType.GitHubPullRequestProductionReview]:
        "Reviewed again in place, with Review again.",
    };

    test("every recipe is asked again from Code, or is listed here with why not", () => {
      for (const recipe of Object.values(CodeFixTaskType)) {
        expect({
          recipe,
          decided:
            CodeFixTaskTypeHelper.canBeAskedAgain(recipe) !==
            Boolean(NOT_ASKED_AGAIN_IN_CODE[recipe]),
        }).toEqual({ recipe, decided: true });
      }
    });

    test("a request, and every fix OneUptime starts", () => {
      expect(CodeFixTaskTypeHelper.getTaskTypesAskedAgain()).toEqual([
        CodeFixTaskType.CodeRequest,
        CodeFixTaskType.FixException,
        CodeFixTaskType.WriteRegressionTest,
        CodeFixTaskType.ImproveExceptionHandling,
        CodeFixTaskType.ImproveInstrumentation,
        CodeFixTaskType.FixPerformance,
        CodeFixTaskType.ImproveLogging,
        CodeFixTaskType.ImproveTracing,
        CodeFixTaskType.FixFromIncident,
      ]);
    });

    test("a legacy null recipe is an exception fix: asked again as one", () => {
      expect(CodeFixTaskTypeHelper.canBeAskedAgain(null)).toBe(true);
      expect(CodeFixTaskTypeHelper.isFixAskedAgain(null)).toBe(true);
    });

    test("a fix is asked again with its context; a request in its words", () => {
      expect(
        CodeFixTaskTypeHelper.isFixAskedAgain(CodeFixTaskType.FixException),
      ).toBe(true);
      expect(
        CodeFixTaskTypeHelper.isFixAskedAgain(CodeFixTaskType.CodeRequest),
      ).toBe(false);
      expect(
        CodeFixTaskTypeHelper.isFixAskedAgain(CodeFixTaskType.GitHubIssueFix),
      ).toBe(false);
    });
  });
});
