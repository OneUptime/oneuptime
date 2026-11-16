"use strict";

/**
 * Utils/WorkflowExpression.js: the reader of GitHub's `${{ }}` expressions
 * that the workflow tests work out a run with. stepRuns and playJob decide
 * whether each step of a job runs, so the tests that read a job through them
 * (EnterpriseEditionBuild.test.js plays Enterprise Edition Test's failures)
 * are only as right as this is: each rule here is GitHub's, as its
 * expressions and status-check functions documentation states it.
 */

const {
  evaluateExpressions,
  stepRuns,
  stepIdsReadBy,
  playJob,
} = require("./Utils/WorkflowExpression");

function stepsContext(outcomes) {
  return {
    steps: Object.fromEntries(
      Object.entries(outcomes).map(([id, outcome]) => {
        return [id, { outcome, conclusion: outcome }];
      }),
    ),
  };
}

describe("evaluateExpressions", () => {
  test("writes each context path's value, the first truthy one of an ||", () => {
    expect(
      evaluateExpressions(
        "${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}",
        {
          github: {
            workflow: "Compile",
            ref: "refs/heads/main",
            event: {},
          },
        },
      ),
    ).toBe("Compile-refs/heads/main");
  });

  test("throws on what it does not read", () => {
    expect(() => {
      return evaluateExpressions("${{ format('{0}', github.ref) }}", {});
    }).toThrow(/cannot evaluate/);
  });
});

describe("stepRuns", () => {
  test("no if is success(): the step runs until a step before it fails", () => {
    expect(stepRuns(undefined, { failed: false })).toBe(true);
    expect(stepRuns(undefined, { failed: true })).toBe(false);
    expect(stepRuns(undefined, { cancelled: true })).toBe(false);
  });

  test("an if that calls no status function is held to success() as well", () => {
    const context = stepsContext({ build: "success" });
    const condition = "${{ steps.build.outcome == 'success' }}";

    expect(stepRuns(condition, { contexts: context })).toBe(true);
    expect(stepRuns(condition, { contexts: context, failed: true })).toBe(
      false,
    );
  });

  test("!cancelled() replaces that success(): the step runs after a failure, not after a cancel", () => {
    expect(stepRuns("${{ !cancelled() }}", { failed: true })).toBe(true);
    expect(stepRuns("${{ !cancelled() }}", { cancelled: true })).toBe(false);
  });

  test("failure() and always()", () => {
    expect(stepRuns("${{ failure() }}", { failed: true })).toBe(true);
    expect(stepRuns("${{ failure() }}", { failed: false })).toBe(false);
    expect(stepRuns("always()", { failed: true, cancelled: true })).toBe(true);
  });

  test("an if may leave out the ${{ }}", () => {
    expect(stepRuns("!cancelled()", { failed: true })).toBe(true);
    expect(
      stepRuns("steps.build.outcome == 'success'", {
        contexts: stepsContext({ build: "failure" }),
      }),
    ).toBe(false);
  });

  test("&& binds tighter than ||, and ! tighter than ==", () => {
    const contexts = stepsContext({ a: "failure", b: "success" });

    // (true && false) || true
    expect(
      stepRuns(
        "${{ always() && steps.a.outcome == 'success' || steps.b.outcome == 'success' }}",
        { contexts },
      ),
    ).toBe(true);
    // true && (false || false)
    expect(
      stepRuns(
        "${{ always() && (steps.a.outcome == 'success' || steps.b.outcome == 'failure') }}",
        { contexts },
      ),
    ).toBe(false);
    // (!null) == true
    expect(
      stepRuns("${{ always() && !steps.missing.outcome == true }}", {}),
    ).toBe(true);
  });

  test("== compares strings ignoring case, and != is its negation", () => {
    const contexts = stepsContext({ build: "Success" });

    expect(
      stepRuns("${{ steps.build.outcome == 'success' }}", { contexts }),
    ).toBe(true);
    expect(
      stepRuns("${{ steps.build.outcome != 'success' }}", { contexts }),
    ).toBe(false);
  });

  test("a step id that no step has reads as null, so its condition is false", () => {
    expect(
      stepRuns("${{ !cancelled() && steps.instal-app.outcome == 'success' }}", {
        contexts: stepsContext({ "install-app": "success" }),
      }),
    ).toBe(false);
  });

  test("a skipped step's outcome is 'skipped', not 'success'", () => {
    expect(
      stepRuns("${{ !cancelled() && steps.install.outcome == 'success' }}", {
        contexts: stepsContext({ install: "skipped" }),
      }),
    ).toBe(false);
  });

  test("reads 'strings' with '' inside them, numbers, true, false and null", () => {
    expect(stepRuns("${{ always() && 'it''s' == 'IT''S' }}", {})).toBe(true);
    expect(stepRuns("${{ always() && 1 == 1.0 }}", {})).toBe(true);
    expect(stepRuns("${{ always() && false }}", {})).toBe(false);
    expect(stepRuns("${{ always() && null }}", {})).toBe(false);
    expect(stepRuns("${{ always() && '' }}", {})).toBe(false);
    expect(stepRuns("${{ always() && 0 }}", {})).toBe(false);
  });

  test.each([
    "${{ contains(github.ref, 'main') }}",
    "${{ github.event.commits[0].message }}",
    "${{ steps.a.outcome < 'b' }}",
    "${{ success() }} && ${{ always() }}",
    "${{ always() && }}",
    "${{ (always() }}",
  ])("throws on what it does not read: %s", (condition) => {
    expect(() => {
      return stepRuns(condition, {});
    }).toThrow();
  });
});

describe("stepIdsReadBy", () => {
  test("names every step an if reads", () => {
    expect(
      stepIdsReadBy(
        "${{ !cancelled() && steps.install-common.outcome == 'success' && steps.install-app.conclusion == 'success' }}",
      ),
    ).toEqual(["install-common", "install-app"]);
  });

  test("none for no if, a boolean, or an if that reads no step", () => {
    expect(stepIdsReadBy(undefined)).toEqual([]);
    expect(stepIdsReadBy(true)).toEqual([]);
    expect(stepIdsReadBy("${{ !cancelled() }}")).toEqual([]);
  });
});

describe("playJob", () => {
  const steps = [
    { id: "install", run: "npm ci" },
    {
      name: "guard",
      if: "${{ !cancelled() && steps.install.outcome == 'success' }}",
      run: "jest guard",
    },
    {
      name: "tests",
      if: "${{ !cancelled() && steps.install.outcome == 'success' }}",
      run: "jest",
    },
    { name: "report", run: "echo done" },
    { name: "on failure", if: "${{ failure() }}", run: "echo failed" },
  ];

  test("with nothing failing, every step but the failure() one runs, and the job passes", () => {
    expect(playJob(steps)).toEqual({
      outcomes: ["success", "success", "success", "success", "skipped"],
      result: "success",
    });
  });

  test("a failed step skips the success() steps after it, not the !cancelled() ones, and fails the job", () => {
    expect(
      playJob(steps, {
        outcomeOf: (step) => {
          return step.name === "guard" ? "failure" : "success";
        },
      }),
    ).toEqual({
      outcomes: ["success", "failure", "success", "skipped", "success"],
      result: "failure",
    });
  });

  test("a failed install skips the steps that read its outcome", () => {
    expect(
      playJob(steps, {
        outcomeOf: (step) => {
          return step.id === "install" ? "failure" : "success";
        },
      }),
    ).toEqual({
      outcomes: ["failure", "skipped", "skipped", "skipped", "success"],
      result: "failure",
    });
  });

  test("a failed step with continue-on-error concludes as a success: the job passes", () => {
    const lenient = steps.map((step) => {
      return step.name === "guard"
        ? { ...step, "continue-on-error": true }
        : step;
    });

    expect(
      playJob(lenient, {
        outcomeOf: (step) => {
          return step.name === "guard" ? "failure" : "success";
        },
      }),
    ).toEqual({
      outcomes: ["success", "failure", "success", "success", "skipped"],
      result: "success",
    });
  });

  test("a cancelled run runs only the always() steps", () => {
    expect(
      playJob(
        [
          { run: "a" },
          { if: "${{ !cancelled() }}", run: "b" },
          { if: "always()", run: "c" },
        ],
        { cancelled: true },
      ).outcomes,
    ).toEqual(["skipped", "skipped", "success"]);
  });
});
