import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import {
  ChosenRunnerKind,
  RunnerChoiceDecision,
  RunnerChoiceFacts,
  RunnerChoiceRefusal,
  decideRunnerChoice,
  describeRunnerChoiceRefusal,
  getChosenRunnerId,
  isRunnerId,
} from "../../../Types/Runner/RunnerChoice";
import { describe, expect, test } from "@jest/globals";

/*
 * The one "global by default" rule: where a runbook step runs.
 *
 *   - a step that picked one of its project's own Runners runs on it, always
 *     (a custom pick wins, whatever the project's switch and the server's
 *     global Runners say);
 *   - a step that picked none (or a global Runner) runs on the global Runners
 *     when they can run its type (JavaScript), the project uses them, and the
 *     server has one;
 *   - otherwise it does not run, and its error says why in plain words.
 */

const PROJECT_RUNNER_ID: string = "0a1b2c3d-1111-4222-8333-944455556666";
const GLOBAL_RUNNER_ID: string = "0a1b2c3d-2222-4222-8333-944455556666";

// Every refusal ends on what to do: pick a Runner.
const PICK_SENTENCE_PATTERN: RegExp =
  /(Pick|pick) (one of your Runners|another Runner|its Runner again)/;

function facts(overrides: Partial<RunnerChoiceFacts>): RunnerChoiceFacts {
  return {
    stepType: RunbookStepType.JavaScript,
    chosenRunnerId: "",
    projectUsesGlobalRunners: true,
    hasGlobalRunner: true,
    ...overrides,
  };
}

function refusalOf(decision: RunnerChoiceDecision): RunnerChoiceRefusal {
  if (decision.kind !== "refused") {
    throw new Error(`Expected a refusal, got ${decision.kind}`);
  }

  return decision.refusal;
}

function messageOf(decision: RunnerChoiceDecision): string {
  if (decision.kind !== "refused") {
    throw new Error(`Expected a refusal, got ${decision.kind}`);
  }

  return decision.message;
}

describe("a step that picked a Runner of its own project", () => {
  test.each([
    RunbookStepType.JavaScript,
    RunbookStepType.Bash,
    RunbookStepType.SSH,
    RunbookStepType.Kubernetes,
  ])("a %s step runs on the Runner it picked", (stepType: string) => {
    expect(
      decideRunnerChoice(
        facts({
          stepType,
          chosenRunnerId: PROJECT_RUNNER_ID,
          chosenRunnerKind: ChosenRunnerKind.ProjectRunner,
        }),
      ),
    ).toEqual({ kind: "custom", runnerId: PROJECT_RUNNER_ID });
  });

  test("the custom pick wins even when the project turned global Runners off and the server has none", () => {
    expect(
      decideRunnerChoice(
        facts({
          chosenRunnerId: PROJECT_RUNNER_ID,
          chosenRunnerKind: ChosenRunnerKind.ProjectRunner,
          projectUsesGlobalRunners: false,
          hasGlobalRunner: false,
        }),
      ),
    ).toEqual({ kind: "custom", runnerId: PROJECT_RUNNER_ID });
  });

  test("the custom pick wins when global Runners could have run the step", () => {
    expect(
      decideRunnerChoice(
        facts({
          chosenRunnerId: PROJECT_RUNNER_ID,
          chosenRunnerKind: ChosenRunnerKind.ProjectRunner,
        }),
      ),
    ).toEqual({ kind: "custom", runnerId: PROJECT_RUNNER_ID });
  });

  test("the stored id is read trimmed", () => {
    expect(
      decideRunnerChoice(
        facts({
          chosenRunnerId: `  ${PROJECT_RUNNER_ID}  `,
          chosenRunnerKind: ChosenRunnerKind.ProjectRunner,
        }),
      ),
    ).toEqual({ kind: "custom", runnerId: PROJECT_RUNNER_ID });
  });
});

describe("a step that picked no Runner", () => {
  test("a JavaScript step runs on the global Runners", () => {
    expect(decideRunnerChoice(facts({}))).toEqual({ kind: "global" });
  });

  test("a JavaScript step with no stored Runner field at all runs on the global Runners", () => {
    expect(
      decideRunnerChoice(facts({ chosenRunnerId: undefined })),
    ).toEqual({ kind: "global" });
    expect(decideRunnerChoice(facts({ chosenRunnerId: null }))).toEqual({
      kind: "global",
    });
    expect(decideRunnerChoice(facts({ chosenRunnerId: "   " }))).toEqual({
      kind: "global",
    });
  });

  test.each([
    RunbookStepType.Bash,
    RunbookStepType.SSH,
    RunbookStepType.Kubernetes,
  ])(
    "a %s step never runs on a global Runner, even when there is one",
    (stepType: string) => {
      const decision: RunnerChoiceDecision = decideRunnerChoice(
        facts({ stepType }),
      );

      expect(refusalOf(decision)).toBe(RunnerChoiceRefusal.NeedsOwnRunner);
      expect(messageOf(decision)).toBe(
        `This ${stepType} step has no Runner. ${stepType} steps run on a Runner of your own, inside your network: global Runners run JavaScript steps only. Pick one of your Runners for the step, or add one under Runbooks → Runners.`,
      );
    },
  );

  test("a JavaScript step of a project that turned global Runners off does not run", () => {
    const decision: RunnerChoiceDecision = decideRunnerChoice(
      facts({ projectUsesGlobalRunners: false }),
    );

    expect(refusalOf(decision)).toBe(
      RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff,
    );
    expect(messageOf(decision)).toBe(
      "This JavaScript step has no Runner of its own, and this project does not use global Runners. Pick one of your Runners for the step, or turn global Runners on under Runbooks → Runners.",
    );
  });

  test("a JavaScript step on a server with no global Runner does not run (the existing refusal, worded plainly)", () => {
    const decision: RunnerChoiceDecision = decideRunnerChoice(
      facts({ hasGlobalRunner: false }),
    );

    expect(refusalOf(decision)).toBe(RunnerChoiceRefusal.NoGlobalRunner);
    expect(messageOf(decision)).toBe(
      "This JavaScript step has no Runner of its own, and there is no global Runner to run it. Pick one of your Runners for the step, or add one under Runbooks → Runners.",
    );
  });

  test("the project's switch is asked before whether the server has a global Runner", () => {
    expect(
      refusalOf(
        decideRunnerChoice(
          facts({ projectUsesGlobalRunners: false, hasGlobalRunner: false }),
        ),
      ),
    ).toBe(RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff);
  });

  test("whether global Runners can run the step is asked before the project's switch", () => {
    expect(
      refusalOf(
        decideRunnerChoice(
          facts({
            stepType: RunbookStepType.Bash,
            projectUsesGlobalRunners: false,
            hasGlobalRunner: false,
          }),
        ),
      ),
    ).toBe(RunnerChoiceRefusal.NeedsOwnRunner);
  });
});

describe("a step that picked a global Runner", () => {
  test("is held to the same rules as a step that picked none: it runs on the global Runners", () => {
    expect(
      decideRunnerChoice(
        facts({
          chosenRunnerId: GLOBAL_RUNNER_ID,
          chosenRunnerKind: ChosenRunnerKind.GlobalRunner,
        }),
      ),
    ).toEqual({ kind: "global" });
  });

  test("a Bash step that names a global Runner is refused like one that names none", () => {
    expect(
      refusalOf(
        decideRunnerChoice(
          facts({
            stepType: RunbookStepType.Bash,
            chosenRunnerId: GLOBAL_RUNNER_ID,
            chosenRunnerKind: ChosenRunnerKind.GlobalRunner,
          }),
        ),
      ),
    ).toBe(RunnerChoiceRefusal.NeedsOwnRunner);
  });

  test("a project that turned global Runners off cannot reach one by naming it", () => {
    expect(
      refusalOf(
        decideRunnerChoice(
          facts({
            chosenRunnerId: GLOBAL_RUNNER_ID,
            chosenRunnerKind: ChosenRunnerKind.GlobalRunner,
            projectUsesGlobalRunners: false,
          }),
        ),
      ),
    ).toBe(RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff);
  });
});

describe("a step that names a Runner that is not one", () => {
  test("an id that is not a Runner id is refused, quoted", () => {
    const decision: RunnerChoiceDecision = decideRunnerChoice(
      facts({ chosenRunnerId: "prod-runner" }),
    );

    expect(refusalOf(decision)).toBe(RunnerChoiceRefusal.InvalidRunnerId);
    expect(messageOf(decision)).toBe(
      'This JavaScript step names its Runner by "prod-runner", which is not a Runner ID. Open the step and pick its Runner again.',
    );
  });

  test("a long stored value is cut in the message, never echoed whole", () => {
    const long: string = "x".repeat(5000);
    const message: string = messageOf(
      decideRunnerChoice(facts({ chosenRunnerId: long })),
    );

    expect(message).toContain(`"${"x".repeat(80)}…"`);
    expect(message.length).toBeLessThan(250);
  });

  test("an invalid id is refused before anything else is asked, whatever the step type", () => {
    expect(
      refusalOf(
        decideRunnerChoice(
          facts({
            stepType: RunbookStepType.Bash,
            chosenRunnerId: "not-an-id",
            projectUsesGlobalRunners: false,
            hasGlobalRunner: false,
          }),
        ),
      ),
    ).toBe(RunnerChoiceRefusal.InvalidRunnerId);
  });

  test("a Runner that is not the project's (deleted, or another project's) is refused, not waited on", () => {
    const decision: RunnerChoiceDecision = decideRunnerChoice(
      facts({
        chosenRunnerId: PROJECT_RUNNER_ID,
        chosenRunnerKind: ChosenRunnerKind.NotFound,
      }),
    );

    expect(refusalOf(decision)).toBe(RunnerChoiceRefusal.RunnerNotFound);
    expect(messageOf(decision)).toBe(
      "This JavaScript step picked a Runner that is not one of this project's Runners any more. It may have been deleted. Open the step and pick another Runner.",
    );
  });

  test("a deleted Runner does not quietly fall back to the global Runners", () => {
    expect(
      decideRunnerChoice(
        facts({
          chosenRunnerId: PROJECT_RUNNER_ID,
          chosenRunnerKind: ChosenRunnerKind.NotFound,
        }),
      ).kind,
    ).toBe("refused");
  });
});

describe("every refusal", () => {
  test.each(Object.values(RunnerChoiceRefusal))(
    "%s names the step and says what to do",
    (refusal: RunnerChoiceRefusal) => {
      const message: string = describeRunnerChoiceRefusal({
        refusal,
        stepType: RunbookStepType.Bash,
        chosenRunnerId: "abc",
      });

      expect(message.startsWith("This Bash step")).toBe(true);
      expect(message).toMatch(PICK_SENTENCE_PATTERN);
      // Never the old "is missing a Runner" wording.
      expect(message).not.toContain("is missing a Runner");
    },
  );

  test("a refusal that sends people to the Runners page names it the way the Dashboard does", () => {
    for (const refusal of [
      RunnerChoiceRefusal.NeedsOwnRunner,
      RunnerChoiceRefusal.ProjectTurnedGlobalRunnersOff,
      RunnerChoiceRefusal.NoGlobalRunner,
    ]) {
      expect(
        describeRunnerChoiceRefusal({
          refusal,
          stepType: RunbookStepType.JavaScript,
        }),
      ).toContain("Runbooks → Runners");
    }
  });
});

describe("reading a stored Runner id", () => {
  test("getChosenRunnerId trims a string and reads anything else as none", () => {
    expect(getChosenRunnerId(` ${PROJECT_RUNNER_ID} `)).toBe(PROJECT_RUNNER_ID);
    expect(getChosenRunnerId(undefined)).toBe("");
    expect(getChosenRunnerId(null)).toBe("");
    expect(getChosenRunnerId(42)).toBe("");
    expect(getChosenRunnerId({ id: PROJECT_RUNNER_ID })).toBe("");
  });

  test("isRunnerId accepts a uuid only", () => {
    expect(isRunnerId(PROJECT_RUNNER_ID)).toBe(true);
    expect(isRunnerId("prod-runner")).toBe(false);
    expect(isRunnerId("")).toBe(false);
  });
});
