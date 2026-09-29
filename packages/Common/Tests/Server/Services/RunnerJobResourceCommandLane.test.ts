import RunnerJobService from "../../../Server/Services/RunnerJobService";
import RunnerService from "../../../Server/Services/RunnerService";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import RunbookStepType, {
  AI_AGENT_EXECUTED_STEP_TYPES,
  RUNNER_EXECUTED_STEP_TYPES,
} from "../../../Types/Runbook/RunbookStepType";
import { AI_COMMAND_STEP_TYPES } from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import logger from "../../../Server/Utils/Logger";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — a ResourceCommand job never reaches a Runner.
 *
 * ResourceCommand is the step type of a command for an infrastructure
 * resource's AI agent (a ResourceAiAgent row). It is an AI command step type
 * (AI_COMMAND_STEP_TYPES), so the generic AI-command lane must refuse it
 * explicitly: that lane writes targetAgentId — a Runner — and a Runner
 * must never be handed a resource command. The runbook lane (enqueue)
 * refuses it because it is not a runner-executed type. Both refusals happen
 * before any row is written.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

describe("ResourceCommand never enters a Runner lane", () => {
  let create: jest.SpyInstance;
  let runnerLookup: jest.SpyInstance;
  let countBy: jest.SpyInstance;

  beforeEach(() => {
    // @CaptureSpan logs the expected throws at error level.
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    create = jest
      .spyOn(RunnerJobService, "create")
      .mockImplementation(async (data: unknown): Promise<RunnerJob> => {
        return (data as { data: RunnerJob }).data;
      });
    runnerLookup = jest.spyOn(RunnerService, "findOneBy").mockResolvedValue({
      id: RUNNER_ID,
      _id: RUNNER_ID.toString(),
      projectId: PROJECT_ID,
      name: "office-runner",
    } as never);
    countBy = jest
      .spyOn(RunnerJobService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("is an AI command step type but not a Runner-executed one", () => {
    expect(AI_COMMAND_STEP_TYPES).toContain(RunbookStepType.ResourceCommand);
    expect(AI_AGENT_EXECUTED_STEP_TYPES).toContain(
      RunbookStepType.ResourceCommand,
    );
    expect(RUNNER_EXECUTED_STEP_TYPES).not.toContain(
      RunbookStepType.ResourceCommand,
    );
  });

  it("enqueue (the runbook lane) refuses it before writing a row", async () => {
    await expect(
      RunnerJobService.enqueue({
        projectId: PROJECT_ID,
        runbookExecutionId: new ObjectID(
          "33333333-3333-4333-8333-333333333333",
        ),
        stepId: "step-1",
        stepType: RunbookStepType.ResourceCommand,
        targetAgentId: RUNNER_ID,
        script: "",
        payload: { program: "docker", args: ["ps"] },
        timeoutInMs: 30000,
      }),
    ).rejects.toThrow(
      new BadDataException(
        'Runner does not execute step type "ResourceCommand".',
      ),
    );

    expect(create).not.toHaveBeenCalled();
  });

  it("enqueueAiCommand (the Runner AI-command lane) refuses it before looking anything up", async () => {
    let caught: unknown = null;

    try {
      await RunnerJobService.enqueueAiCommand({
        projectId: PROJECT_ID,
        aiRunId: new ObjectID("88888888-8888-4888-8888-888888888888"),
        autoRemediationSuggestionId: new ObjectID(
          "77777777-7777-4777-8777-777777777777",
        ),
        stepId: "ai-approved-1",
        stepType: RunbookStepType.ResourceCommand,
        targetAgentId: RUNNER_ID,
        command: "docker restart web",
        timeoutInMs: 30000,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BadDataException);
    expect((caught as Error).message).toContain("never on a Runner");
    expect((caught as Error).message).toContain("enqueueAiResourceCommand");
    expect(runnerLookup).not.toHaveBeenCalled();
    expect(countBy).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("negative control: a Bash command still goes through the same lane", async () => {
    await RunnerJobService.enqueueAiCommand({
      projectId: PROJECT_ID,
      aiRunId: new ObjectID("88888888-8888-4888-8888-888888888888"),
      autoRemediationSuggestionId: new ObjectID(
        "77777777-7777-4777-8777-777777777777",
      ),
      stepId: "ai-approved-1",
      stepType: RunbookStepType.Bash,
      targetAgentId: RUNNER_ID,
      command: "systemctl restart nginx",
      timeoutInMs: 30000,
    });

    expect(create).toHaveBeenCalledTimes(1);
  });
});
