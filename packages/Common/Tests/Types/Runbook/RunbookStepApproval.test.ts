import { RunbookStep } from "../../../Types/Runbook/RunbookStep";
import {
  APPROVAL_AFTER_LAST_STEP_DESCRIPTION,
  APPROVAL_AFTER_LAST_STEP_FALLBACK_ID,
  APPROVAL_AFTER_LAST_STEP_TITLE,
  RunbookStepWait,
  StepsWithApprovalsBeforeTheirSteps,
  canStepTypeRequireApproval,
  getApprovalAfterLastStepId,
  getRunbookStepWait,
  getStepsWithApprovalsBeforeTheirSteps,
  hasApprovalAfterStep,
  hasApprovalsAfterSteps,
  hasOldApprovalFlags,
  isApprovalNeededBeforeRunning,
  isStepAStopForAPerson,
  moveApprovalsBeforeTheirSteps,
  stepRequiresApprovalBeforeRunning,
} from "../../../Types/Runbook/RunbookStepApproval";
import { RunbookStepExecutionState } from "../../../Types/Runbook/RunbookStepExecution";
import RunbookStepExecutionStatus from "../../../Types/Runbook/RunbookStepExecutionStatus";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * A STEP ASKS FOR APPROVAL BEFORE IT RUNS.
 *
 * The maintainer: "Instead of saying 'require approval before running next
 * step', you can actually say this in the next step, which would say
 * 'require approval before running this step'." The switch moved to the step
 * it holds back (requireApprovalBeforeRunning); the old flag (requireApproval,
 * "after this step") is still read wherever steps are read, and means what
 * it meant. Pinned here: the one reading of the old flag (an approval after
 * step N is one before step N+1, a Manual step next is its own stop, one
 * after the last step becomes a Manual step at the end, the flag on a Manual
 * step never meant anything), that nothing else of a step changes, that the
 * reading is idempotent, and - over a few thousand seeded runbooks - that a
 * runbook read this way asks a person at exactly the points the old loop
 * did.
 */

const AUTOMATED_TYPES: Array<RunbookStepType> = [
  RunbookStepType.JavaScript,
  RunbookStepType.HttpRequest,
  RunbookStepType.Bash,
  RunbookStepType.SSH,
  RunbookStepType.Kubernetes,
  RunbookStepType.AI,
];

function step(
  id: string,
  type: RunbookStepType,
  order: number,
  overrides: Partial<RunbookStep> = {},
): RunbookStep {
  return {
    id,
    order,
    type,
    title: `Step ${id}`,
    config: {} as RunbookStep["config"],
    ...overrides,
  };
}

function read(steps: unknown): StepsWithApprovalsBeforeTheirSteps {
  return getStepsWithApprovalsBeforeTheirSteps(steps);
}

function byId(steps: Array<RunbookStep>, id: string): RunbookStep {
  const found: RunbookStep | undefined = steps.find((candidate: RunbookStep) => {
    return candidate.id === id;
  });

  if (!found) {
    throw new Error(`No step ${id}`);
  }

  return found;
}

function hasKey(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

// A step as it is apart from its approval flags, old and new.
function withoutApprovalFlags(each: RunbookStep): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...each };

  delete copy["requireApproval"];
  delete copy["requireApprovalBeforeRunning"];

  return copy;
}

describe("which steps can ask for approval", () => {
  test("every automated type can; a Manual step stops the run for a person already", () => {
    for (const type of AUTOMATED_TYPES) {
      expect({ type, can: canStepTypeRequireApproval(type) }).toEqual({
        type,
        can: true,
      });
    }

    // OneUptime AI's own command steps are automated too.
    expect(canStepTypeRequireApproval(RunbookStepType.Kubectl)).toBe(true);
    expect(canStepTypeRequireApproval(RunbookStepType.ResourceCommand)).toBe(
      true,
    );
    expect(canStepTypeRequireApproval(RunbookStepType.Manual)).toBe(false);
    expect(canStepTypeRequireApproval(undefined)).toBe(false);
    expect(canStepTypeRequireApproval("")).toBe(false);
  });

  test("a step asks for approval before it runs only with the new flag on, true and automated", () => {
    expect(
      stepRequiresApprovalBeforeRunning(
        step("a", RunbookStepType.Bash, 0, {
          requireApprovalBeforeRunning: true,
        }),
      ),
    ).toBe(true);

    for (const value of [false, undefined]) {
      expect(
        stepRequiresApprovalBeforeRunning(
          step("a", RunbookStepType.Bash, 0, {
            ...(value === undefined
              ? {}
              : { requireApprovalBeforeRunning: value }),
          }),
        ),
      ).toBe(false);
    }

    // A string is not true: the flag comes from an unvalidated JSON column.
    expect(
      stepRequiresApprovalBeforeRunning({
        ...step("a", RunbookStepType.Bash, 0),
        requireApprovalBeforeRunning: "true" as unknown as boolean,
      }),
    ).toBe(false);

    // On a Manual step the flag means nothing.
    expect(
      stepRequiresApprovalBeforeRunning(
        step("m", RunbookStepType.Manual, 0, {
          requireApprovalBeforeRunning: true,
        }),
      ),
    ).toBe(false);

    // The old flag alone does not stop the run before the step itself.
    expect(
      stepRequiresApprovalBeforeRunning(
        step("a", RunbookStepType.Bash, 0, { requireApproval: true }),
      ),
    ).toBe(false);

    expect(stepRequiresApprovalBeforeRunning(undefined)).toBe(false);
    expect(stepRequiresApprovalBeforeRunning(null)).toBe(false);
  });

  test("the old flag is live only true, on an automated step", () => {
    expect(
      hasApprovalAfterStep(
        step("a", RunbookStepType.HttpRequest, 0, { requireApproval: true }),
      ),
    ).toBe(true);
    expect(
      hasApprovalAfterStep(
        step("a", RunbookStepType.HttpRequest, 0, { requireApproval: false }),
      ),
    ).toBe(false);
    expect(
      hasApprovalAfterStep(
        step("m", RunbookStepType.Manual, 0, { requireApproval: true }),
      ),
    ).toBe(false);
    expect(hasApprovalAfterStep(undefined)).toBe(false);

    expect(
      hasApprovalsAfterSteps([
        step("a", RunbookStepType.Bash, 0),
        step("b", RunbookStepType.Bash, 1, { requireApproval: true }),
      ]),
    ).toBe(true);
    expect(
      hasApprovalsAfterSteps([
        step("m", RunbookStepType.Manual, 0, { requireApproval: true }),
        step("b", RunbookStepType.Bash, 1, { requireApproval: false }),
      ]),
    ).toBe(false);
    expect(hasApprovalsAfterSteps(undefined)).toBe(false);
    expect(hasApprovalsAfterSteps("steps")).toBe(false);

    expect(
      hasOldApprovalFlags([
        step("b", RunbookStepType.Bash, 1, { requireApproval: false }),
      ]),
    ).toBe(true);
    expect(hasOldApprovalFlags([step("b", RunbookStepType.Bash, 1)])).toBe(
      false,
    );
  });
});

describe("an approval after a step is an approval before the step it held back", () => {
  test("after the first step: the second step asks for approval", () => {
    const moved: StepsWithApprovalsBeforeTheirSteps = read([
      step("a", RunbookStepType.Bash, 0, { requireApproval: true }),
      step("b", RunbookStepType.Kubernetes, 1),
      step("c", RunbookStepType.HttpRequest, 2),
    ]);

    expect(moved.isMoved).toBe(true);
    expect(moved.steps).toHaveLength(3);
    expect(hasKey(moved.steps[0]!, "requireApproval")).toBe(false);
    expect(moved.steps[0]!.requireApprovalBeforeRunning).toBeUndefined();
    expect(moved.steps[1]!.requireApprovalBeforeRunning).toBe(true);
    expect(moved.steps[2]!.requireApprovalBeforeRunning).toBeUndefined();
  });

  test("after a middle step: the step after it asks, and no other", () => {
    const moved: Array<RunbookStep> = moveApprovalsBeforeTheirSteps([
      step("a", RunbookStepType.Bash, 0),
      step("b", RunbookStepType.AI, 1, { requireApproval: true }),
      step("c", RunbookStepType.SSH, 2),
      step("d", RunbookStepType.HttpRequest, 3),
    ]);

    expect(
      moved.map((each: RunbookStep) => {
        return [each.id, stepRequiresApprovalBeforeRunning(each)];
      }),
    ).toEqual([
      ["a", false],
      ["b", false],
      ["c", true],
      ["d", false],
    ]);
  });

  test("two approvals in a row move one step each", () => {
    const moved: Array<RunbookStep> = moveApprovalsBeforeTheirSteps([
      step("a", RunbookStepType.Bash, 0, { requireApproval: true }),
      step("b", RunbookStepType.Bash, 1, { requireApproval: true }),
      step("c", RunbookStepType.Bash, 2),
    ]);

    expect(
      moved.map((each: RunbookStep) => {
        return stepRequiresApprovalBeforeRunning(each);
      }),
    ).toEqual([false, true, true]);
  });

  test("before a Manual step, the Manual step's own stop is the approval: nothing is added", () => {
    const moved: StepsWithApprovalsBeforeTheirSteps = read([
      step("a", RunbookStepType.Bash, 0, { requireApproval: true }),
      step("check", RunbookStepType.Manual, 1),
      step("c", RunbookStepType.Bash, 2),
    ]);

    // An approval was there to move, so the runbook is written once.
    expect(moved.isMoved).toBe(true);
    expect(moved.steps).toHaveLength(3);
    expect(hasKey(moved.steps[0]!, "requireApproval")).toBe(false);
    for (const each of moved.steps) {
      expect(hasKey(each, "requireApprovalBeforeRunning")).toBe(false);
    }
  });

  test("after the last step: a Manual step at the end, 'Approve the result', stops the run in the same place", () => {
    const moved: StepsWithApprovalsBeforeTheirSteps = read([
      step("a", RunbookStepType.Bash, 0),
      step("restart", RunbookStepType.Kubernetes, 1, {
        requireApproval: true,
      }),
    ]);

    expect(moved.isMoved).toBe(true);
    expect(moved.steps).toHaveLength(3);
    expect(hasKey(moved.steps[1]!, "requireApproval")).toBe(false);
    expect(moved.steps[2]).toEqual({
      id: "restart-approval",
      order: 2,
      type: RunbookStepType.Manual,
      title: APPROVAL_AFTER_LAST_STEP_TITLE,
      description: APPROVAL_AFTER_LAST_STEP_DESCRIPTION,
      config: {},
    });
    expect(APPROVAL_AFTER_LAST_STEP_TITLE).toBe("Approve the result");
    expect(APPROVAL_AFTER_LAST_STEP_DESCRIPTION).toBe(
      "Check what the steps above did, then mark this step complete to finish the run.",
    );
  });

  test("a runbook of one step that asked for approval after it", () => {
    const moved: Array<RunbookStep> = moveApprovalsBeforeTheirSteps([
      step("only", RunbookStepType.HttpRequest, 0, { requireApproval: true }),
    ]);

    expect(
      moved.map((each: RunbookStep) => {
        return [each.id, each.type, each.order];
      }),
    ).toEqual([
      ["only", RunbookStepType.HttpRequest, 0],
      ["only-approval", RunbookStepType.Manual, 1],
    ]);
  });

  test("the old flag on a Manual step never did anything, and still does not", () => {
    const moved: StepsWithApprovalsBeforeTheirSteps = read([
      step("check", RunbookStepType.Manual, 0, { requireApproval: true }),
      step("b", RunbookStepType.Bash, 1),
      step("last", RunbookStepType.Manual, 2, { requireApproval: true }),
    ]);

    expect(moved.isMoved).toBe(false);
    expect(moved.steps).toHaveLength(3);
    expect(moved.steps[1]!.requireApprovalBeforeRunning).toBeUndefined();
    for (const each of moved.steps) {
      expect(hasKey(each, "requireApproval")).toBe(false);
    }
  });

  test("an old flag that is false asks for nothing: dropped, not a move", () => {
    const original: Array<RunbookStep> = [
      step("a", RunbookStepType.Bash, 0, { requireApproval: false }),
      step("b", RunbookStepType.Bash, 1, { requireApproval: false }),
    ];
    const moved: StepsWithApprovalsBeforeTheirSteps = read(original);

    expect(moved.isMoved).toBe(false);
    expect(moved.steps).toEqual([
      step("a", RunbookStepType.Bash, 0),
      step("b", RunbookStepType.Bash, 1),
    ]);
    // The steps it was given are not changed.
    expect(original[0]!.requireApproval).toBe(false);
  });

  test("an approval a client also wrote the new way is one approval, not two", () => {
    const moved: Array<RunbookStep> = moveApprovalsBeforeTheirSteps([
      step("a", RunbookStepType.Bash, 0, { requireApproval: true }),
      step("b", RunbookStepType.Bash, 1, {
        requireApprovalBeforeRunning: true,
      }),
    ]);

    expect(moved).toHaveLength(2);
    expect(moved[1]!.requireApprovalBeforeRunning).toBe(true);
  });

  test("an old approval wins over a new flag a client left off: the client asked for it", () => {
    const moved: Array<RunbookStep> = moveApprovalsBeforeTheirSteps([
      step("a", RunbookStepType.Bash, 0, { requireApproval: true }),
      step("b", RunbookStepType.Bash, 1, {
        requireApprovalBeforeRunning: false,
      }),
    ]);

    expect(moved[1]!.requireApprovalBeforeRunning).toBe(true);
  });

  test("the step after is the next by `order`, whatever the array's order; the array keeps its order", () => {
    const moved: Array<RunbookStep> = moveApprovalsBeforeTheirSteps([
      step("third", RunbookStepType.Bash, 2),
      step("first", RunbookStepType.Bash, 0, { requireApproval: true }),
      step("second", RunbookStepType.Bash, 1, { requireApproval: true }),
    ]);

    expect(
      moved.map((each: RunbookStep) => {
        return each.id;
      }),
    ).toEqual(["third", "first", "second"]);
    expect(byId(moved, "first").requireApprovalBeforeRunning).toBeUndefined();
    expect(byId(moved, "second").requireApprovalBeforeRunning).toBe(true);
    expect(byId(moved, "third").requireApprovalBeforeRunning).toBe(true);
  });

  test("steps written without an order run in the array's order, and the added step goes last", () => {
    const moved: Array<RunbookStep> = moveApprovalsBeforeTheirSteps([
      { ...step("a", RunbookStepType.Bash, 0), order: undefined as never },
      {
        ...step("b", RunbookStepType.Bash, 0, { requireApproval: true }),
        order: "x" as never,
      },
    ]);

    expect(moved).toHaveLength(3);
    expect(moved[2]!.id).toBe("b-approval");
    expect(moved[2]!.order).toBe(2);
  });

  test("the added step comes after the highest order, however far apart the orders are", () => {
    const moved: Array<RunbookStep> = moveApprovalsBeforeTheirSteps([
      step("a", RunbookStepType.Bash, 10),
      step("b", RunbookStepType.Bash, 30, { requireApproval: true }),
    ]);

    expect(moved[2]!.order).toBe(31);
  });

  test("an id the added step would take that is taken already gets a number", () => {
    expect(
      getApprovalAfterLastStepId({
        lastStepId: "a",
        takenIds: ["a", "a-approval", "a-approval-2"],
      }),
    ).toBe("a-approval-3");
    expect(
      getApprovalAfterLastStepId({ lastStepId: "", takenIds: [] }),
    ).toBe(APPROVAL_AFTER_LAST_STEP_FALLBACK_ID);
    expect(
      getApprovalAfterLastStepId({ lastStepId: undefined, takenIds: [] }),
    ).toBe("approval-after-last-step");

    const moved: Array<RunbookStep> = moveApprovalsBeforeTheirSteps([
      step("a-approval", RunbookStepType.Bash, 0),
      step("a", RunbookStepType.Bash, 1, { requireApproval: true }),
    ]);

    expect(moved[2]!.id).toBe("a-approval-2");
  });

  test("nothing else of a step changes: its config, title, description and switches stay", () => {
    const rich: RunbookStep = step("a", RunbookStepType.SSH, 0, {
      title: "Stop writes",
      description: "On the **old** primary.",
      continueOnFailure: true,
      requireApproval: true,
      config: {
        host: "10.0.4.21",
        username: "deploy",
        signIn: "{{global.variables.KEY}}",
        script: "sudo systemctl stop pgbouncer",
        agentId: "40000000-0000-4000-8000-0000000000d1",
        timeoutInMs: 60000,
      },
    });
    const next: RunbookStep = step("b", RunbookStepType.Kubernetes, 1, {
      title: "Promote",
      continueOnFailure: false,
      config: {
        kubeconfig: "{{global.variables.KUBECONFIG}}",
        script: "kubectl get pods",
        agentId: "40000000-0000-4000-8000-0000000000d1",
      },
    });

    const moved: Array<RunbookStep> = moveApprovalsBeforeTheirSteps([
      rich,
      next,
    ]);

    expect(moved[0]).toEqual(withoutApprovalFlags(rich));
    expect(moved[1]).toEqual({ ...next, requireApprovalBeforeRunning: true });
    // A copy: the step it was given still says what it said.
    expect(rich.requireApproval).toBe(true);
    expect(next.requireApprovalBeforeRunning).toBeUndefined();
  });

  test("steps with no old flag come back as they were, the same objects", () => {
    const steps: Array<RunbookStep> = [
      step("a", RunbookStepType.Bash, 0),
      step("b", RunbookStepType.Bash, 1, {
        requireApprovalBeforeRunning: true,
      }),
    ];
    const moved: StepsWithApprovalsBeforeTheirSteps = read(steps);

    expect(moved.isMoved).toBe(false);
    expect(moved.steps[0]).toBe(steps[0]);
    expect(moved.steps[1]).toBe(steps[1]);
  });

  test("what is not a list of steps reads as no steps; entries that are not steps are left out", () => {
    expect(moveApprovalsBeforeTheirSteps(undefined)).toEqual([]);
    expect(moveApprovalsBeforeTheirSteps(null)).toEqual([]);
    expect(moveApprovalsBeforeTheirSteps("steps")).toEqual([]);
    expect(moveApprovalsBeforeTheirSteps({ steps: [] })).toEqual([]);

    const moved: Array<RunbookStep> = moveApprovalsBeforeTheirSteps([
      null,
      "x",
      7,
      [],
      step("a", RunbookStepType.Bash, 0, { requireApproval: true }),
      step("b", RunbookStepType.Bash, 1),
    ]);

    expect(
      moved.map((each: RunbookStep) => {
        return each.id;
      }),
    ).toEqual(["a", "b"]);
    expect(moved[1]!.requireApprovalBeforeRunning).toBe(true);
  });

  test("reading steps that were read already changes nothing", () => {
    const once: Array<RunbookStep> = moveApprovalsBeforeTheirSteps([
      step("a", RunbookStepType.Bash, 0, { requireApproval: true }),
      step("check", RunbookStepType.Manual, 1),
      step("c", RunbookStepType.Bash, 2, { requireApproval: true }),
      step("d", RunbookStepType.AI, 3, { requireApproval: true }),
    ]);
    const twice: StepsWithApprovalsBeforeTheirSteps = read(once);

    expect(twice.isMoved).toBe(false);
    expect(twice.steps).toEqual(once);
  });
});

/*
 * ---------------------------------------------------------------------------
 * EVERY RUNBOOK RUNS EXACTLY AS BEFORE.
 *
 * Both loops replayed with every step succeeding, as the moments something
 * runs and the moments the run waits for a person. The old loop ran an
 * automated step and then stopped if it asked for an approval after it; a
 * Manual step stopped the run. The new loop stops before a step that asks
 * for approval, then runs it. Back-to-back stops are one wait for a person:
 * an approval after a step, then a Manual step, asked twice where the moved
 * runbook asks once - and nothing ran between them either way.
 * ---------------------------------------------------------------------------
 */

const PERSON: string = "a person decides";

function inRunOrder(steps: Array<RunbookStep>): Array<RunbookStep> {
  return steps
    .map((each: RunbookStep, index: number) => {
      return { each, index };
    })
    .sort(
      (
        a: { each: RunbookStep; index: number },
        b: { each: RunbookStep; index: number },
      ): number => {
        return a.each.order - b.each.order || a.index - b.index;
      },
    )
    .map((entry: { each: RunbookStep; index: number }) => {
      return entry.each;
    });
}

function withoutRepeatedWaits(events: Array<string>): Array<string> {
  return events.filter((event: string, index: number): boolean => {
    return !(event === PERSON && events[index - 1] === PERSON);
  });
}

// The loop before approvals moved (RunRunbook as it was), every step succeeding.
function oldRun(steps: Array<RunbookStep>): Array<string> {
  const events: Array<string> = [];

  for (const each of inRunOrder(steps)) {
    if (each.type === RunbookStepType.Manual) {
      events.push(PERSON);
      continue;
    }

    events.push(`runs ${each.id}`);

    if (each.requireApproval === true) {
      events.push(PERSON);
    }
  }

  return withoutRepeatedWaits(events);
}

// The loop now, every step succeeding.
function newRun(steps: Array<RunbookStep>): Array<string> {
  const events: Array<string> = [];

  for (const each of inRunOrder(steps)) {
    if (each.type === RunbookStepType.Manual) {
      events.push(PERSON);
      continue;
    }

    if (stepRequiresApprovalBeforeRunning(each)) {
      events.push(PERSON);
    }

    events.push(`runs ${each.id}`);
  }

  return withoutRepeatedWaits(events);
}

const ALL_TYPES: Array<RunbookStepType> = [
  RunbookStepType.Manual,
  ...AUTOMATED_TYPES,
];

function randomRunbook(random: SeededRandom): Array<RunbookStep> {
  const count: number = random(9);
  const steps: Array<RunbookStep> = [];

  for (let index: number = 0; index < count; index++) {
    const type: RunbookStepType = ALL_TYPES[random(ALL_TYPES.length)]!;
    const flag: number = random(4);

    steps.push(
      step(`s${index}`, type, index, {
        // Old runbooks: true, false, or no flag at all - Manual steps too.
        ...(flag === 0 ? { requireApproval: true } : {}),
        ...(flag === 1 ? { requireApproval: false } : {}),
        ...(random(3) === 0 ? { continueOnFailure: true } : {}),
      }),
    );
  }

  // Stored in any order: `order` says how the run goes.
  for (let index: number = steps.length - 1; index > 0; index--) {
    const other: number = random(index + 1);
    const swap: RunbookStep = steps[index]!;
    steps[index] = steps[other]!;
    steps[other] = swap;
  }

  return steps;
}

describe("every runbook runs exactly as before, over seeded runbooks", () => {
  test("a person is asked at the same points, and the same steps run in the same order", () => {
    const random: SeededRandom = seededRandom(5113);
    let withApprovals: number = 0;
    let withApprovalAfterLast: number = 0;

    for (let round: number = 0; round < 4000; round++) {
      const steps: Array<RunbookStep> = randomRunbook(random);
      const moved: StepsWithApprovalsBeforeTheirSteps = read(steps);

      if (moved.isMoved) {
        withApprovals++;
      }

      if (moved.steps.length > steps.length) {
        withApprovalAfterLast++;
      }

      expect({ round, events: newRun(moved.steps) }).toEqual({
        round,
        events: oldRun(steps),
      });
    }

    // The sweep reached the cases it is about.
    expect(withApprovals).toBeGreaterThan(1000);
    expect(withApprovalAfterLast).toBeGreaterThan(100);
  });

  test("moved steps hold no old flag, keep every other field, and moving them again changes nothing", () => {
    const random: SeededRandom = seededRandom(20261020);

    for (let round: number = 0; round < 2000; round++) {
      const steps: Array<RunbookStep> = randomRunbook(random);
      const moved: Array<RunbookStep> = moveApprovalsBeforeTheirSteps(steps);

      for (const each of moved) {
        expect(hasKey(each, "requireApproval")).toBe(false);
      }

      // Each given step is still there, as it was but for the two flags.
      steps.forEach((original: RunbookStep, index: number) => {
        expect(withoutApprovalFlags(moved[index]!)).toEqual(
          withoutApprovalFlags(original),
        );
      });

      // At most one step is added, and only a Manual one at the end.
      expect(moved.length - steps.length).toBeGreaterThanOrEqual(0);
      expect(moved.length - steps.length).toBeLessThanOrEqual(1);

      if (moved.length > steps.length) {
        expect(moved[moved.length - 1]!.type).toBe(RunbookStepType.Manual);
      }

      const again: StepsWithApprovalsBeforeTheirSteps = read(moved);

      expect(again.isMoved).toBe(false);
      expect(again.steps).toEqual(moved);
    }
  });

  test("a step that fails and may fail no longer skips the stop after it: the stop holds, never the other way", () => {
    /*
     * The one place the loops differ, on purpose: the old loop stopped
     * after a step only when it succeeded, so a step allowed to fail let
     * the next step run unasked. Now the next step asks whatever happened
     * before it. Every stop the old loop made, the new one makes too.
     */
    const steps: Array<RunbookStep> = [
      step("try", RunbookStepType.Bash, 0, {
        requireApproval: true,
        continueOnFailure: true,
      }),
      step("fix", RunbookStepType.Kubernetes, 1),
    ];
    const moved: Array<RunbookStep> = moveApprovalsBeforeTheirSteps(steps);

    expect(stepRequiresApprovalBeforeRunning(moved[1])).toBe(true);
  });
});

describe("why a run waits on a step", () => {
  function waiting(
    stepOverrides: Partial<RunbookStep>,
    type: RunbookStepType,
    extra: Partial<RunbookStepExecutionState> = {},
  ): RunbookStepExecutionState {
    return {
      step: step("w", type, 0, stepOverrides),
      status: RunbookStepExecutionStatus.WaitingForUser,
      ...extra,
    };
  }

  test("a Manual step waits for someone to do it", () => {
    expect(getRunbookStepWait(waiting({}, RunbookStepType.Manual))).toBe(
      RunbookStepWait.Manual,
    );
    // Whatever flags it carries.
    expect(
      getRunbookStepWait(
        waiting(
          { requireApprovalBeforeRunning: true, requireApproval: true },
          RunbookStepType.Manual,
        ),
      ),
    ).toBe(RunbookStepWait.Manual);
  });

  test("a step that asks for approval before it runs, not yet approved, waits to run", () => {
    expect(
      getRunbookStepWait(
        waiting({ requireApprovalBeforeRunning: true }, RunbookStepType.Bash),
      ),
    ).toBe(RunbookStepWait.ApprovalToRun);
  });

  test("a step of a run started before approvals moved waits to let the run go on", () => {
    expect(
      getRunbookStepWait(
        waiting({ requireApproval: true }, RunbookStepType.HttpRequest, {
          output: "HTTP 202",
        }),
      ),
    ).toBe(RunbookStepWait.ApprovalToContinue);
  });

  test("a step that is not WaitingForUser is not waited on", () => {
    for (const status of Object.values(RunbookStepExecutionStatus)) {
      if (status === RunbookStepExecutionStatus.WaitingForUser) {
        continue;
      }

      expect(
        getRunbookStepWait({
          step: step("w", RunbookStepType.Bash, 0, {
            requireApprovalBeforeRunning: true,
          }),
          status,
        }),
      ).toBeUndefined();
    }

    expect(getRunbookStepWait(undefined)).toBeUndefined();
  });

  test("the loop stops before a step that asks, until it is approved", () => {
    const asks: RunbookStepExecutionState = {
      step: step("w", RunbookStepType.Bash, 0, {
        requireApprovalBeforeRunning: true,
      }),
      status: RunbookStepExecutionStatus.Pending,
    };

    expect(isApprovalNeededBeforeRunning(asks)).toBe(true);
    expect(
      isApprovalNeededBeforeRunning({
        ...asks,
        approvedAt: "2026-10-20T10:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      isApprovalNeededBeforeRunning({
        ...asks,
        step: step("w", RunbookStepType.Bash, 0),
      }),
    ).toBe(false);
    expect(
      isApprovalNeededBeforeRunning({
        ...asks,
        step: step("w", RunbookStepType.Manual, 0, {
          requireApprovalBeforeRunning: true,
        }),
      }),
    ).toBe(false);
  });

  test("Manual steps and steps that ask for approval, before or after, are stops for a person", () => {
    expect(isStepAStopForAPerson(step("m", RunbookStepType.Manual, 0))).toBe(
      true,
    );
    expect(
      isStepAStopForAPerson(
        step("b", RunbookStepType.Bash, 0, {
          requireApprovalBeforeRunning: true,
        }),
      ),
    ).toBe(true);
    expect(
      isStepAStopForAPerson(
        step("b", RunbookStepType.Bash, 0, { requireApproval: true }),
      ),
    ).toBe(true);
    expect(isStepAStopForAPerson(step("b", RunbookStepType.Bash, 0))).toBe(
      false,
    );
    expect(isStepAStopForAPerson(undefined)).toBe(false);
  });
});
