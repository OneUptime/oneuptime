import RunbookStepType, {
  RUNNER_EXECUTED_STEP_TYPES,
} from "Common/Types/Runbook/RunbookStepType";
import BadDataException from "Common/Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — a Runner can never ask to be handed a
 * ResourceCommand job.
 *
 * ResourceCommand is the step type of a command for an infrastructure
 * resource's own AI agent. A Runner's claim may narrow what it is served
 * with `stepTypes`, and that list may only name Runner-executed types: a
 * Runner asking for ResourceCommand is a misbuilt (or hostile) Runner and
 * gets a 400 naming the problem, never the job.
 */

/*
 * The secrets util imports VMUtil -> isolated-vm, a native binding that is
 * not installed for this suite (and not under test).
 */
jest.mock("../../FeatureSet/Runbook/Utils/Secrets", () => {
  return {
    __esModule: true,
    default: {
      loadForAgent: jest.fn(),
      populateInScript: jest.fn(),
    },
  };
});

// Import AFTER the jest.mock calls above (they are hoisted by jest).
import RunnerIngressAPI from "../../FeatureSet/Runbook/API/RunnerIngress";

describe("RunnerIngressAPI.parseRequestedStepTypes refuses ResourceCommand", () => {
  test.each([
    [[RunbookStepType.ResourceCommand]],
    [[RunbookStepType.Kubectl, RunbookStepType.ResourceCommand]],
    [[...RUNNER_EXECUTED_STEP_TYPES, RunbookStepType.ResourceCommand]],
  ])("%p is refused", (stepTypes: Array<RunbookStepType>) => {
    let caught: unknown = null;

    try {
      RunnerIngressAPI.parseRequestedStepTypes(stepTypes);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BadDataException);
    expect((caught as Error).message).toContain(
      "stepTypes may only name runner step types",
    );
    expect((caught as Error).message).toContain('"ResourceCommand"');
    expect((caught as Error).message).not.toContain(
      `(${RUNNER_EXECUTED_STEP_TYPES.join(", ")}, ResourceCommand)`,
    );
  });

  test("negative control: every Runner-executed type is still accepted", () => {
    expect(
      RunnerIngressAPI.parseRequestedStepTypes([...RUNNER_EXECUTED_STEP_TYPES]),
    ).toEqual(RUNNER_EXECUTED_STEP_TYPES);
  });
});
