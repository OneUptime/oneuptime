import {
  RUNBOOK_STEP_CHANGE_LINE_LIMIT,
  RUNBOOK_STEP_TITLE_LIMIT,
  boundRunbookStepText,
  describeRunbookStep,
  describeRunbookStepChange,
  describeRunbookStepExecutions,
  describeRunbookStepStatus,
  getRunbookStepExecutionChanges,
  listRunbookStepExecutions,
  readRunbookStepExecutions,
  RunbookStepExecutionRead,
} from "../../../Utils/Runbook/RunbookStepExecutionChanges";
import {
  applyRunbookStepAction,
  RunbookStepAction,
} from "../../../Types/Runbook/RunbookStepAction";
import { RunbookStepExecutionState } from "../../../Types/Runbook/RunbookStepExecution";
import RunbookStepExecutionStatus from "../../../Types/Runbook/RunbookStepExecutionStatus";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import { RunbookStep } from "../../../Types/Runbook/RunbookStep";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import { seededRandom, SeededRandom } from "../../Helpers/SeededRandom";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";

/*
 * A RUN'S STEPS IN THE AUDIT LOG, AS WHAT HAPPENED TO THEM (issue #6283).
 *
 * Approving, completing and skipping a step wrote the run's step list round
 * DatabaseService's hooks, so nothing was recorded; recorded as a diff of
 * the list, an entry would have named array positions and copied every
 * step's output. These lines are what an entry says instead, and they never
 * quote what a step printed, its error, or a note someone typed.
 */

function step(data: {
  id?: string;
  title?: string;
  type?: RunbookStepType;
  requireApprovalBeforeRunning?: boolean;
  requireApproval?: boolean;
}): RunbookStep {
  return {
    id: data.id ?? "s",
    order: 0,
    type: data.type ?? RunbookStepType.Bash,
    title: data.title ?? "Step",
    config: {},
    ...(data.requireApprovalBeforeRunning
      ? { requireApprovalBeforeRunning: true }
      : {}),
    ...(data.requireApproval ? { requireApproval: true } : {}),
  } as unknown as RunbookStep;
}

function state(
  stepDefinition: RunbookStep,
  status: RunbookStepExecutionStatus,
  extra?: Partial<RunbookStepExecutionState>,
): RunbookStepExecutionState {
  return { step: stepDefinition, status, ...(extra || {}) };
}

function copy(list: Array<RunbookStepExecutionState>): JSONArray {
  return JSON.parse(JSON.stringify(list)) as JSONArray;
}

function read(
  data: Partial<RunbookStepExecutionRead>,
): RunbookStepExecutionRead {
  return {
    number: 1,
    id: "a",
    title: "Restart the API",
    type: RunbookStepType.Bash,
    status: RunbookStepExecutionStatus.Pending,
    isApproved: false,
    ...data,
  };
}

// A run as it waits: one step done, the next waiting, two after it.
function waitingRun(waiting: RunbookStep): Array<RunbookStepExecutionState> {
  return [
    state(
      step({ id: "check", title: "Check the dashboards" }),
      RunbookStepExecutionStatus.Completed,
      { output: "all green" },
    ),
    state(waiting, RunbookStepExecutionStatus.WaitingForUser),
    state(
      step({ id: "verify", title: "Verify the API" }),
      RunbookStepExecutionStatus.Pending,
    ),
    state(
      step({ id: "notify", title: "Notify customers" }),
      RunbookStepExecutionStatus.Pending,
    ),
  ];
}

// What the step routes write for an action, through the real rules.
function afterAction(data: {
  run: Array<RunbookStepExecutionState>;
  stepId: string;
  action: RunbookStepAction;
  notes?: string;
}): JSONArray {
  const after: Array<RunbookStepExecutionState> = JSON.parse(
    JSON.stringify(data.run),
  ) as Array<RunbookStepExecutionState>;

  applyRunbookStepAction({
    stepExecution: after.find((item: RunbookStepExecutionState) => {
      return item.step.id === data.stepId;
    })!,
    action: data.action,
    at: new Date("2026-11-08T10:00:00.000Z"),
    userId: "22222222-2222-4222-8222-222222222222",
    notes: data.notes,
  });

  return copy(after);
}

describe("what a person did to a step, through the step routes' own rules", () => {
  test("approving a step that waits for approval before it runs reads Approved", () => {
    const run: Array<RunbookStepExecutionState> = waitingRun(
      step({
        id: "restart",
        title: "Restart the API",
        requireApprovalBeforeRunning: true,
      }),
    );

    expect(
      getRunbookStepExecutionChanges({
        before: copy(run),
        after: afterAction({
          run,
          stepId: "restart",
          action: RunbookStepAction.Complete,
        }),
      }).lines,
    ).toEqual(['Approved "Restart the API" (step 2)']);
  });

  test("ticking off a Manual step reads Completed", () => {
    const run: Array<RunbookStepExecutionState> = waitingRun(
      step({
        id: "call",
        title: "Call the on-call lead",
        type: RunbookStepType.Manual,
      }),
    );

    expect(
      getRunbookStepExecutionChanges({
        before: copy(run),
        after: afterAction({
          run,
          stepId: "call",
          action: RunbookStepAction.Complete,
        }),
      }).lines,
    ).toEqual(['Completed "Call the on-call lead" (step 2)']);
  });

  test("approving a step of an older run that ran and waits reads Approved, as its button said", () => {
    const run: Array<RunbookStepExecutionState> = waitingRun(
      step({ id: "migrate", title: "Migrate", requireApproval: true }),
    );

    expect(
      getRunbookStepExecutionChanges({
        before: copy(run),
        after: afterAction({
          run,
          stepId: "migrate",
          action: RunbookStepAction.Complete,
        }),
      }).lines,
    ).toEqual(['Approved "Migrate" (step 2)']);
  });

  test("skipping the step the run waits on, or a later one ahead of time, reads Skipped", () => {
    const run: Array<RunbookStepExecutionState> = waitingRun(
      step({ id: "call", title: "Call", type: RunbookStepType.Manual }),
    );

    expect(
      getRunbookStepExecutionChanges({
        before: copy(run),
        after: afterAction({
          run,
          stepId: "call",
          action: RunbookStepAction.Skip,
        }),
      }).lines,
    ).toEqual(['Skipped "Call" (step 2)']);

    expect(
      getRunbookStepExecutionChanges({
        before: copy(run),
        after: afterAction({
          run,
          stepId: "notify",
          action: RunbookStepAction.Skip,
        }),
      }).lines,
    ).toEqual(['Skipped "Notify customers" (step 4)']);
  });

  test("the note written with an action is never quoted", () => {
    const run: Array<RunbookStepExecutionState> = waitingRun(
      step({ id: "call", title: "Call", type: RunbookStepType.Manual }),
    );
    const note: string = "rotated the key sk_live_9f8e7d6c5b4a";

    const changes: { lines: Array<string> } = getRunbookStepExecutionChanges({
      before: copy(run),
      after: afterAction({
        run,
        stepId: "call",
        action: RunbookStepAction.Complete,
        notes: note,
      }),
    });

    expect(JSON.stringify(changes)).not.toContain("sk_live");
    expect(JSON.stringify(changes)).not.toContain("rotated");
  });

  test("a cancelled run says which steps it stopped, and not the ones that had finished", () => {
    const run: Array<RunbookStepExecutionState> = waitingRun(
      step({ id: "call", title: "Call", type: RunbookStepType.Manual }),
    );
    const after: Array<RunbookStepExecutionState> = run.map(
      (item: RunbookStepExecutionState): RunbookStepExecutionState => {
        return item.status === RunbookStepExecutionStatus.Completed
          ? item
          : { ...item, status: RunbookStepExecutionStatus.Cancelled };
      },
    );

    expect(
      getRunbookStepExecutionChanges({ before: copy(run), after: copy(after) })
        .lines,
    ).toEqual([
      'Cancelled "Call" (step 2)',
      'Cancelled "Verify the API" (step 3)',
      'Cancelled "Notify customers" (step 4)',
    ]);
  });
});

describe("what OneUptime did while running the run", () => {
  test("a step it moved on reads as where it went", () => {
    expect(
      describeRunbookStepChange({
        before: read({ status: RunbookStepExecutionStatus.Pending }),
        after: read({ status: RunbookStepExecutionStatus.Running }),
      }),
    ).toBe('"Restart the API" (step 1) went from pending to running');

    expect(
      describeRunbookStepChange({
        before: read({ status: RunbookStepExecutionStatus.Running }),
        after: read({ status: RunbookStepExecutionStatus.Failed }),
      }),
    ).toBe('"Restart the API" (step 1) went from running to failed');

    expect(
      describeRunbookStepChange({
        before: read({ status: RunbookStepExecutionStatus.Running }),
        after: read({ status: RunbookStepExecutionStatus.WaitingForUser }),
      }),
    ).toBe(
      '"Restart the API" (step 1) went from running to waiting for a person',
    );
  });

  test("an untitled step is named by its place, capitalized at the start of a line", () => {
    expect(
      describeRunbookStepChange({
        before: read({ title: "", status: RunbookStepExecutionStatus.Running }),
        after: read({ title: "", status: RunbookStepExecutionStatus.Completed }),
      }),
    ).toBe("Step 1 went from running to done");
  });

  test("what a step printed, its error, or a note changing alone is no change", () => {
    const before: Array<RunbookStepExecutionState> = [
      state(step({ id: "a" }), RunbookStepExecutionStatus.Running),
    ];
    const after: Array<RunbookStepExecutionState> = [
      state(step({ id: "a" }), RunbookStepExecutionStatus.Running, {
        output: "deploying...",
        errorMessage: "warning: retrying",
        notes: "watching it",
        startedAt: "2026-11-08T10:00:00.000Z",
      }),
    ];

    expect(
      getRunbookStepExecutionChanges({
        before: copy(before),
        after: copy(after),
      }),
    ).toEqual({ lines: [], totalChanges: 0 });
  });

  test("a status OneUptime does not know is named as it is stored, bounded", () => {
    expect(describeRunbookStepStatus("Paused")).toBe("Paused");
    expect(describeRunbookStepStatus(null)).toBe("not started");
    expect(
      describeRunbookStepStatus("x".repeat(500)).length,
    ).toBeLessThanOrEqual(RUNBOOK_STEP_TITLE_LIMIT);
  });
});

describe("reading a run's step list", () => {
  test("anything that is not a list is no steps", () => {
    for (const value of [null, undefined, "steps", 5, { 0: {} }, true]) {
      expect(readRunbookStepExecutions(value)).toEqual([]);
    }
  });

  test("an entry that is not a step is passed over, keeping its place in the numbering", () => {
    expect(
      readRunbookStepExecutions([
        "not a step",
        { step: { id: " b ", title: "  Second  ", type: "Bash" } },
        null,
        { status: "Completed", approvedAt: "2026-11-08T10:00:00.000Z" },
      ]),
    ).toEqual([
      {
        number: 2,
        id: "b",
        title: "Second",
        type: "Bash",
        status: null,
        isApproved: false,
      },
      {
        number: 4,
        id: null,
        title: "",
        type: null,
        status: "Completed",
        isApproved: true,
      },
    ]);
  });

  test("steps are matched by their ids, and by their place when an id is missing or shared", () => {
    const before: JSONArray = [
      { step: { id: "a", title: "A" }, status: "Pending" },
      { step: { id: "dup", title: "B" }, status: "Pending" },
      { step: { id: "dup", title: "C" }, status: "Pending" },
      { step: { title: "D" }, status: "Pending" },
    ];
    const after: JSONArray = [
      { step: { id: "a", title: "A" }, status: "Running" },
      { step: { id: "dup", title: "B" }, status: "Pending" },
      { step: { id: "dup", title: "C" }, status: "Skipped" },
      { step: { title: "D" }, status: "Skipped" },
    ];

    expect(getRunbookStepExecutionChanges({ before, after }).lines).toEqual([
      '"A" (step 1) went from pending to running',
      'Skipped "C" (step 3)',
      'Skipped "D" (step 4)',
    ]);
  });

  test("a step the list before did not have says where it stands", () => {
    expect(
      getRunbookStepExecutionChanges({
        before: [],
        after: [{ step: { id: "a", title: "A" }, status: "Pending" }],
      }).lines,
    ).toEqual(['"A" (step 1) is pending']);
  });

  test("a long run is cut, counting the step changes left out", () => {
    const before: JSONArray = [];
    const after: JSONArray = [];

    for (let index: number = 0; index < 40; index++) {
      before.push({ step: { id: `s${index}` }, status: "Pending" });
      after.push({ step: { id: `s${index}` }, status: "Cancelled" });
    }

    const changes: { lines: Array<string>; totalChanges: number } =
      getRunbookStepExecutionChanges({ before, after });

    expect(changes.totalChanges).toBe(40);
    expect(changes.lines).toHaveLength(RUNBOOK_STEP_CHANGE_LINE_LIMIT);
    expect(changes.lines[RUNBOOK_STEP_CHANGE_LINE_LIMIT - 1]).toBe(
      `and ${40 - (RUNBOOK_STEP_CHANGE_LINE_LIMIT - 1)} more step changes`,
    );
  });
});

describe("a step's name", () => {
  test("is its title in quotes and its place, or its place alone", () => {
    expect(describeRunbookStep(read({ number: 3 }))).toBe(
      '"Restart the API" (step 3)',
    );
    expect(describeRunbookStep(read({ number: 3, title: "" }))).toBe(
      "step 3",
    );
  });

  test("a long title ends in an ellipsis, never halving a character", () => {
    const title: string = `${"a".repeat(RUNBOOK_STEP_TITLE_LIMIT - 2)}😀😀😀`;
    const bounded: string = boundRunbookStepText(
      title,
      RUNBOOK_STEP_TITLE_LIMIT,
    );

    expect(bounded.endsWith("…")).toBe(true);
    expect(Array.from(bounded).length).toBe(RUNBOOK_STEP_TITLE_LIMIT);
    expect(bounded).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(boundRunbookStepText("short", RUNBOOK_STEP_TITLE_LIMIT)).toBe(
      "short",
    );
  });
});

describe("where a run's steps stand, in a few words", () => {
  test("counts each status in one order, then any other in the order first met", () => {
    expect(
      describeRunbookStepExecutions([
        { step: {}, status: "Pending" },
        { step: {}, status: "Completed" },
        { step: {}, status: "Paused" },
        { step: {}, status: "WaitingForUser" },
        { step: {}, status: "Completed" },
      ]),
    ).toBe("5 steps: 2 done, 1 waiting for a person, 1 pending, 1 Paused");
    expect(describeRunbookStepExecutions([{ step: {}, status: "Skipped" }])).toBe(
      "1 step: 1 skipped",
    );
    expect(describeRunbookStepExecutions([])).toBe("No steps");
    expect(describeRunbookStepExecutions("nothing")).toBe("No steps");
  });

  test("a run created or deleted is its steps, one line each", () => {
    expect(
      listRunbookStepExecutions({
        value: [
          { step: { title: "Check" }, status: "Completed", output: "ok" },
          { step: {}, status: "Pending" },
        ],
      }),
    ).toEqual(['"Check" (step 1): done', "Step 2: pending"]);
  });
});

describe("no line ever quotes what a step printed, its error or a note (seeded sweep)", () => {
  const MARK: string = "QQSECRETQQ";
  const STATUSES: Array<string> = Object.values(RunbookStepExecutionStatus);
  const TEXTS: Array<string> = generatedTexts(400, 6283, [
    "deploy",
    " ",
    MARK,
    "\n",
    "token=",
    "🚀",
    "{",
    "}",
  ]);

  const randomStep: (random: SeededRandom, index: number) => JSONObject = (
    random: SeededRandom,
    index: number,
  ): JSONObject => {
    const entry: JSONObject = {
      step: {
        id: random(4) === 0 ? null : `step-${index}`,
        title: random(3) === 0 ? "" : `Step ${index}`,
        type:
          random(2) === 0 ? RunbookStepType.Manual : RunbookStepType.Bash,
      },
      status: STATUSES[random(STATUSES.length)]!,
      output: TEXTS[random(TEXTS.length)]!,
      errorMessage: TEXTS[random(TEXTS.length)]!,
      notes: TEXTS[random(TEXTS.length)]!,
    };

    if (random(3) === 0) {
      entry["approvedAt"] = "2026-11-08T10:00:00.000Z";
    }

    return entry;
  };

  test("across 2,000 pairs of lists", () => {
    const random: SeededRandom = seededRandom(6283);

    for (let round: number = 0; round < 2000; round++) {
      const size: number = random(8);
      const before: JSONArray = [];
      const after: JSONArray = [];

      for (let index: number = 0; index < size; index++) {
        before.push(randomStep(random, index));
        after.push(
          random(2) === 0 ? before[index]! : randomStep(random, index),
        );
      }

      const written: string = JSON.stringify([
        getRunbookStepExecutionChanges({ before, after }),
        describeRunbookStepExecutions(before),
        describeRunbookStepExecutions(after),
        listRunbookStepExecutions({ value: after }),
      ]);

      expect(written.includes(MARK)).toBe(false);
      expect(written.includes("token=")).toBe(false);
    }
  });

  test("a list written back as it was is no change, whatever it holds", () => {
    const random: SeededRandom = seededRandom(6284);

    for (let round: number = 0; round < 500; round++) {
      const list: JSONArray = [];
      const size: number = random(8);

      for (let index: number = 0; index < size; index++) {
        list.push(randomStep(random, index));
      }

      expect(
        getRunbookStepExecutionChanges({
          before: list,
          after: JSON.parse(JSON.stringify(list)) as JSONArray,
        }).lines,
      ).toEqual([]);
    }
  });
});
