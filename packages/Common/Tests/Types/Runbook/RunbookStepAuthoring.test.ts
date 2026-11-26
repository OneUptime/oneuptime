import {
  RUNBOOK_STEP_TYPES_THAT_RUN_NOTHING,
  getStepsThatRunRefusal,
  holdsStepThatRuns,
  isStepThatRunsNothing,
} from "../../../Types/Runbook/RunbookStepAuthoring";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import { describe, expect, test } from "@jest/globals";

/*
 * Which steps of a runbook run something (GHSA-rfrx-38rq-44w6): every step
 * but a manual one, read so that nothing the server cannot read as manual is
 * taken for one. RunbookService holds the writing of these to whoever may
 * change a runbook's steps (RunbookStepsThatRunThroughTheWrite).
 */

function stepOf(type: unknown): Record<string, unknown> {
  return { id: "a", order: 0, type: type, title: "A step", config: {} };
}

describe("the step types that run nothing", () => {
  test("are manual steps alone", () => {
    expect([...RUNBOOK_STEP_TYPES_THAT_RUN_NOTHING]).toEqual([
      RunbookStepType.Manual,
    ]);
  });

  test("every other step type runs something, a type added later included", () => {
    for (const type of Object.values(RunbookStepType)) {
      expect(isStepThatRunsNothing(stepOf(type))).toBe(
        type === RunbookStepType.Manual,
      );
    }
  });
});

describe("isStepThatRunsNothing", () => {
  test("a manual step runs nothing, whatever else it holds", () => {
    expect(isStepThatRunsNothing(stepOf(RunbookStepType.Manual))).toBe(true);
    expect(
      isStepThatRunsNothing({
        ...stepOf(RunbookStepType.Manual),
        // A manual step's config is never run: dispatch is by its type.
        config: { script: "rm -rf /", agentId: "x" },
        requireApprovalBeforeRunning: true,
      }),
    ).toBe(true);
  });

  test.each([
    ["the type in another case", stepOf("manual")],
    ["the type with spaces", stepOf(" Manual ")],
    ["a type that is not text", stepOf(1)],
    ["no type", { title: "No type" }],
    ["null", null],
    ["undefined", undefined],
    ["a list", [RunbookStepType.Manual]],
    ["text", RunbookStepType.Manual],
    ["a number", 3],
  ])("%s is not a manual step", (_what: string, step: unknown) => {
    expect(isStepThatRunsNothing(step)).toBe(false);
  });
});

describe("holdsStepThatRuns", () => {
  test.each([
    ["nothing written", undefined],
    ["nothing", null],
    ["no steps", []],
    ["manual steps", [stepOf(RunbookStepType.Manual)]],
    [
      "several manual steps",
      [stepOf(RunbookStepType.Manual), stepOf(RunbookStepType.Manual)],
    ],
  ])("%s holds none", (_what: string, steps: unknown) => {
    expect(holdsStepThatRuns(steps)).toBe(false);
  });

  test.each([
    ["a Bash step", [stepOf(RunbookStepType.Bash)]],
    ["an HTTP request step", [stepOf(RunbookStepType.HttpRequest)]],
    ["a JavaScript step", [stepOf(RunbookStepType.JavaScript)]],
    ["an SSH step", [stepOf(RunbookStepType.SSH)]],
    ["a kubectl step", [stepOf(RunbookStepType.Kubernetes)]],
    ["an AI step", [stepOf(RunbookStepType.AI)]],
    [
      "one among manual steps",
      [
        stepOf(RunbookStepType.Manual),
        stepOf(RunbookStepType.Bash),
        stepOf(RunbookStepType.Manual),
      ],
    ],
    ["a step of a type this build does not know", [stepOf("Python")]],
    ["an entry that is no step", [null]],
    ["steps that are an object, not a list", stepOf(RunbookStepType.Manual)],
    ["steps that are text", "[]"],
    ["steps that are a switch", true],
  ])("%s holds one", (_what: string, steps: unknown) => {
    expect(holdsStepThatRuns(steps)).toBe(true);
  });
});

describe("getStepsThatRunRefusal", () => {
  const message: string = getStepsThatRunRefusal([
    "Project Owner",
    "Project Admin",
    "Edit Runbook",
    "Runbook Admin",
  ]);

  test("says which steps may not be written, why, who may, and what to do instead", () => {
    expect(message).toContain(
      "You may not write this runbook's JavaScript, HTTP request, Bash, SSH, kubectl or AI steps",
    );
    expect(message).toContain("on its Runners or from OneUptime");
    expect(message).toContain("with the runbook secrets they name");
    expect(message).toContain(
      "You need one of these permissions: Project Owner, Project Admin, Edit Runbook, Runbook Admin.",
    );
    expect(message).toContain("Create the runbook with manual steps only");
  });

  test("is a sentence: a capital first and a full stop last", () => {
    expect(message[0]).toBe(message[0]!.toUpperCase());
    expect(message.endsWith(".")).toBe(true);
  });
});
