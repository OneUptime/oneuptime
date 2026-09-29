import RemediationCommandToolkit, {
  AI_COMMAND_CLAIM_TIMEOUT_MS,
  MAX_AUTO_EXECUTED_COMMANDS_PER_RUN,
  MAX_AI_COMMAND_JOBS_PER_PROJECT_PER_HOUR,
  RemediationCommandToolkitOptions,
} from "../../../../Server/Utils/AI/Remediation/RemediationCommandTools";
import { ObservabilityAssistantExtraTool } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import AIRunService from "../../../../Server/Services/AIRunService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import RunbookCredentialService from "../../../../Server/Services/RunbookCredentialService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import RunnerService from "../../../../Server/Services/RunnerService";
import logger from "../../../../Server/Utils/Logger";
import Runner from "../../../../Models/DatabaseModels/Runner";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import RunbookCredential from "../../../../Models/DatabaseModels/RunbookCredential";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import {
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlan,
  AiRemediationCommandPolicyVerdict,
  DEFAULT_COMMAND_TIMEOUT_MS,
  MAX_PLAN_COMMANDS,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the run-scoped command toolkit:
 *
 * - Suggest mode never exposes the execute tool and FullAuto never exposes
 *   the propose tool — the mode split is the product's safety boundary;
 * - a command only auto-executes when the FULL policy auto-approves it
 *   (denylist, structural chain guard, operator allowlist) AND the per-run
 *   and per-project-per-hour brakes have headroom AND the suggestion is
 *   still Planning (a human dismissal mid-run is a kill switch);
 * - every executed command is persisted onto the suggestion BEFORE the
 *   RunnerJob is enqueued, so a crash cannot hide a side effect;
 * - propose_remediation_commands is all-or-nothing: any invalid command
 *   rejects the whole plan with every problem listed, and a later valid
 *   call replaces the earlier plan wholesale.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CREDENTIAL_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const JOB_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

function buildToolkit(
  overrides: Partial<RemediationCommandToolkitOptions> = {},
): RemediationCommandToolkit {
  return new RemediationCommandToolkit({
    projectId: PROJECT_ID,
    aiRunId: RUN_ID,
    suggestionId: SUGGESTION_ID,
    mode: "FullAuto",
    allowlistPatterns: ["systemctl restart *"],
    allowedRunnerIds: null,
    ...overrides,
  });
}

function getTool(
  toolkit: RemediationCommandToolkit,
  name: string,
): ObservabilityAssistantExtraTool {
  const tool: ObservabilityAssistantExtraTool | undefined = toolkit
    .buildTools()
    .find((candidate: ObservabilityAssistantExtraTool) => {
      return candidate.definition.name === name;
    });
  if (!tool) {
    throw new Error(`Tool ${name} not offered by this toolkit.`);
  }
  return tool;
}

function toolNames(toolkit: RemediationCommandToolkit): Array<string> {
  return toolkit.buildTools().map((tool: ObservabilityAssistantExtraTool) => {
    return tool.definition.name;
  });
}

function fakeRunner(
  id: ObjectID,
  overrides: Partial<Record<string, unknown>> = {},
): Runner {
  return {
    id,
    _id: id.toString(),
    name: "prod-runner-1",
    description: "primary host",
    ...overrides,
  } as unknown as Runner;
}

function fakeSshCredential(
  overrides: Partial<Record<string, unknown>> = {},
): RunbookCredential {
  return {
    id: CREDENTIAL_ID,
    _id: CREDENTIAL_ID.toString(),
    name: "db ssh",
    credentialType: "SSH",
    sshHostname: "db01",
    sshUsername: "root",
    ...overrides,
  } as unknown as RunbookCredential;
}

function fakeTerminalJob(
  overrides: Partial<Record<string, unknown>> = {},
): RunnerJob {
  return {
    id: JOB_ID,
    _id: JOB_ID.toString(),
    status: RunnerJobStatus.Succeeded,
    exitCode: 0,
    output: "nginx restarted",
    ...overrides,
  } as unknown as RunnerJob;
}

function bashArgs(
  overrides: Partial<Record<string, unknown>> = {},
): JSONObject {
  return {
    runnerId: RUNNER_ID.toString(),
    stepType: "Bash",
    command: "systemctl restart nginx",
    rationale: "nginx is wedged",
    expectedEffect: "nginx serves traffic again",
    ...overrides,
  } as JSONObject;
}

function mockSuggestionStatus(status: AutoRemediationSuggestionStatus): void {
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockResolvedValue({
      id: SUGGESTION_ID,
      _id: SUGGESTION_ID.toString(),
      status,
    } as unknown as AutoRemediationSuggestion);
}

/*
 * Baseline happy path for one auto-executed Bash command; individual tests
 * re-mock the piece they are exercising.
 */
function mockHappyExecution(): void {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  mockSuggestionStatus(AutoRemediationSuggestionStatus.Planning);
  jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(RunnerService, "findOneBy")
    .mockResolvedValue(fakeRunner(RUNNER_ID));
  jest
    .spyOn(RunbookCredentialService, "findOneBy")
    .mockResolvedValue(fakeSshCredential());
  jest
    .spyOn(RunnerJobService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest
    .spyOn(RunnerJobService, "enqueueAiCommand")
    .mockResolvedValue(fakeTerminalJob());
  jest
    .spyOn(RunnerJobService, "pollUntilTerminal")
    .mockResolvedValue(fakeTerminalJob());
  jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(undefined as never);
}

describe("RemediationCommandToolkit.buildTools", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("offers list + propose in Suggest mode — never the execute tool", () => {
    const names: Array<string> = toolNames(buildToolkit({ mode: "Suggest" }));

    expect(names).toEqual([
      "list_command_targets",
      "propose_remediation_commands",
    ]);
  });

  it("offers list + execute in FullAuto mode — never the propose tool", () => {
    const names: Array<string> = toolNames(buildToolkit({ mode: "FullAuto" }));

    expect(names).toEqual([
      "list_command_targets",
      "execute_remediation_command",
    ]);
  });
});

describe("RemediationCommandToolkit list_command_targets", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reports zero targets with an explanation when no opted-in Runner is online", async () => {
    jest
      .spyOn(RunnerService, "getOnlineAiCommandRunnersForProject")
      .mockResolvedValue([]);

    const outcome: ToolCallOutcome = await getTool(
      buildToolkit(),
      "list_command_targets",
    ).execute({});

    expect(outcome.success).toBe(true);
    expect(outcome.result?.rowCount).toBe(0);
    expect(outcome.textForLlm).toContain("No online Runner");
    expect(outcome.textForLlm).toContain("cannot run or propose commands");
  });

  it("excludes online Runners the rule did not pin as targets", async () => {
    jest
      .spyOn(RunnerService, "getOnlineAiCommandRunnersForProject")
      .mockResolvedValue([
        fakeRunner(RUNNER_ID, { name: "allowed-runner" }),
        fakeRunner(OTHER_RUNNER_ID, { name: "forbidden-runner" }),
      ]);
    jest.spyOn(RunbookCredentialService, "findBy").mockResolvedValue([]);

    const outcome: ToolCallOutcome = await getTool(
      buildToolkit({ allowedRunnerIds: [RUNNER_ID.toString()] }),
      "list_command_targets",
    ).execute({});

    expect(outcome.result?.rowCount).toBe(1);
    expect(outcome.textForLlm).toContain("allowed-runner");
    expect(outcome.textForLlm).not.toContain("forbidden-runner");
  });

  it("lists SSH credentials as id/name/user@host and drops non-SSH credentials", async () => {
    jest
      .spyOn(RunnerService, "getOnlineAiCommandRunnersForProject")
      .mockResolvedValue([fakeRunner(RUNNER_ID)]);
    jest.spyOn(RunbookCredentialService, "findBy").mockResolvedValue([
      fakeSshCredential(),
      fakeSshCredential({
        id: OTHER_RUNNER_ID,
        _id: OTHER_RUNNER_ID.toString(),
        name: "an api key",
        credentialType: "APIKey",
      }),
    ]);

    const outcome: ToolCallOutcome = await getTool(
      buildToolkit(),
      "list_command_targets",
    ).execute({});

    expect(outcome.result?.rowCount).toBe(1);
    expect(outcome.textForLlm).toContain(CREDENTIAL_ID.toString());
    expect(outcome.textForLlm).toContain("db ssh");
    expect(outcome.textForLlm).toContain("root@db01");
    expect(outcome.textForLlm).not.toContain("an api key");
  });
});

describe("RemediationCommandToolkit execute_remediation_command", () => {
  beforeEach(() => {
    mockHappyExecution();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("executes an allowlisted Bash command: persists BEFORE enqueue, reports SUCCEEDED, records the execution", async () => {
    const persist: jest.SpyInstance = jest.spyOn(
      AutoRemediationSuggestionService,
      "updateOneById",
    );
    const enqueue: jest.SpyInstance = jest.spyOn(
      RunnerJobService,
      "enqueueAiCommand",
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(bashArgs());

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        autoRemediationSuggestionId: SUGGESTION_ID,
        stepId: "ai-command-1",
        stepType: RunbookStepType.Bash,
        targetAgentId: RUNNER_ID,
        command: "systemctl restart nginx",
        credentialId: undefined,
        timeoutInMs: DEFAULT_COMMAND_TIMEOUT_MS,
        claimTimeoutInMs: AI_COMMAND_CLAIM_TIMEOUT_MS,
      }),
    );

    // The durable record lands before the side effect can happen.
    const firstPersistOrder: number = persist.mock.invocationCallOrder[0]!;
    const enqueueOrder: number = enqueue.mock.invocationCallOrder[0]!;
    expect(firstPersistOrder).toBeLessThan(enqueueOrder);
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        id: SUGGESTION_ID,
        data: expect.objectContaining({
          commandPlan: expect.objectContaining({
            commands: [
              expect.objectContaining({
                command: "systemctl restart nginx",
                wasAutoExecuted: true,
              }),
            ],
          }),
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain("SUCCEEDED");
    expect(outcome.textForLlm).toContain(
      '<tool_result source="untrusted_command_output">',
    );
    expect(outcome.textForLlm).toContain("nginx restarted");
    expect(outcome.textForLlm).toContain("</tool_result>");

    const executed: AiRemediationCommandPlan = {
      commands: toolkit.getExecutedCommands(),
    };
    expect(executed.commands).toHaveLength(1);
    expect(executed.commands[0]).toEqual(
      expect.objectContaining({
        sequence: 1,
        wasAutoExecuted: true,
        policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
        execution: expect.objectContaining({
          status: AiRemediationCommandExecutionStatus.Succeeded,
          exitCode: 0,
          runnerJobId: JOB_ID.toString(),
        }),
      }),
    );
  });

  it("passes the credential through for an SSH command and snapshots its name", async () => {
    const enqueue: jest.SpyInstance = jest.spyOn(
      RunnerJobService,
      "enqueueAiCommand",
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(
      bashArgs({ stepType: "SSH", credentialId: CREDENTIAL_ID.toString() }),
    );

    expect(outcome.success).toBe(true);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        stepType: RunbookStepType.SSH,
        credentialId: CREDENTIAL_ID.toString(),
      }),
    );
    expect(toolkit.getExecutedCommands()[0]).toEqual(
      expect.objectContaining({
        credentialId: CREDENTIAL_ID.toString(),
        credentialNameSnapshot: "db ssh",
      }),
    );
  });

  it("reports FAILED with the job's error when the RunnerJob fails", async () => {
    jest.spyOn(RunnerJobService, "pollUntilTerminal").mockResolvedValue(
      fakeTerminalJob({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        output: "unit not found",
        errorMessage: "exit code 1",
      }),
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(bashArgs());

    expect(outcome.textForLlm).toContain("FAILED");
    expect(outcome.textForLlm).toContain("exit code 1");
    expect(toolkit.getExecutedCommands()[0]?.execution).toEqual(
      expect.objectContaining({
        status: AiRemediationCommandExecutionStatus.Failed,
        errorMessage: "exit code 1",
      }),
    );
  });

  it("records a Failed execution and resolves when the enqueue itself throws", async () => {
    jest
      .spyOn(RunnerJobService, "enqueueAiCommand")
      .mockRejectedValue(new Error("queue unavailable"));
    const persist: jest.SpyInstance = jest.spyOn(
      AutoRemediationSuggestionService,
      "updateOneById",
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(bashArgs());

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain(
      "Command FAILED before completion: queue unavailable",
    );
    expect(toolkit.getExecutedCommands()[0]?.execution).toEqual(
      expect.objectContaining({
        status: AiRemediationCommandExecutionStatus.Failed,
        errorMessage: "queue unavailable",
      }),
    );
    // The post-attempt persist still records the failure durably.
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("refuses the command after the per-run budget is spent", async () => {
    const enqueue: jest.SpyInstance = jest.spyOn(
      RunnerJobService,
      "enqueueAiCommand",
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();
    const tool: ObservabilityAssistantExtraTool = getTool(
      toolkit,
      "execute_remediation_command",
    );

    for (let i: number = 0; i < MAX_AUTO_EXECUTED_COMMANDS_PER_RUN; i++) {
      const outcome: ToolCallOutcome = await tool.execute(bashArgs());
      expect(outcome.success).toBe(true);
    }

    const refused: ToolCallOutcome = await tool.execute(bashArgs());

    expect(refused.success).toBe(false);
    expect(refused.textForLlm).toContain(
      `budget (${MAX_AUTO_EXECUTED_COMMANDS_PER_RUN})`,
    );
    expect(enqueue).toHaveBeenCalledTimes(MAX_AUTO_EXECUTED_COMMANDS_PER_RUN);
  });

  it("kill switch: a suggestion no longer Planning stops execution and tells the model to stop", async () => {
    mockSuggestionStatus(AutoRemediationSuggestionStatus.Dismissed);
    const enqueue: jest.SpyInstance = jest.spyOn(
      RunnerJobService,
      "enqueueAiCommand",
    );

    const outcome: ToolCallOutcome = await getTool(
      buildToolkit(),
      "execute_remediation_command",
    ).execute(bashArgs());

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("Do NOT run any further commands");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("rejects an unknown stepType", async () => {
    const outcome: ToolCallOutcome = await getTool(
      buildToolkit(),
      "execute_remediation_command",
    ).execute(bashArgs({ stepType: "Kubernetes" }));

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("stepType must be one of");
  });

  it("rejects a missing command", async () => {
    const outcome: ToolCallOutcome = await getTool(
      buildToolkit(),
      "execute_remediation_command",
    ).execute(bashArgs({ command: undefined }));

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("command is required");
  });

  it("refuses a denylisted command outright — it can never run", async () => {
    const enqueue: jest.SpyInstance = jest.spyOn(
      RunnerJobService,
      "enqueueAiCommand",
    );

    const outcome: ToolCallOutcome = await getTool(
      buildToolkit(),
      "execute_remediation_command",
    ).execute(bashArgs({ command: "rm -rf /var/lib/postgresql" }));

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("never run");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses a denylisted rollbackCommand even when the forward command is clean", async () => {
    const outcome: ToolCallOutcome = await getTool(
      buildToolkit(),
      "execute_remediation_command",
    ).execute(bashArgs({ rollbackCommand: "shutdown -h now" }));

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("rollbackCommand");
  });

  it("rejects a missing runnerId", async () => {
    const outcome: ToolCallOutcome = await getTool(
      buildToolkit(),
      "execute_remediation_command",
    ).execute(bashArgs({ runnerId: undefined }));

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("runnerId is required");
  });

  it("rejects a Runner outside the rule's pinned targets without a lookup", async () => {
    const findRunner: jest.SpyInstance = jest.spyOn(RunnerService, "findOneBy");

    const outcome: ToolCallOutcome = await getTool(
      buildToolkit({ allowedRunnerIds: [OTHER_RUNNER_ID.toString()] }),
      "execute_remediation_command",
    ).execute(bashArgs());

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("restricts which Runners");
    expect(findRunner).not.toHaveBeenCalled();
  });

  it("rejects a Runner that is missing or has not opted into AI commands", async () => {
    const findRunner: jest.SpyInstance = jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(null);

    const outcome: ToolCallOutcome = await getTool(
      buildToolkit(),
      "execute_remediation_command",
    ).execute(bashArgs());

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("does not accept AI commands");
    // The capability is part of the lookup, not a post-filter.
    expect(findRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ canRunAiCommands: true }),
      }),
    );
  });

  it("rejects an SSH command without a credentialId", async () => {
    const outcome: ToolCallOutcome = await getTool(
      buildToolkit(),
      "execute_remediation_command",
    ).execute(bashArgs({ stepType: "SSH" }));

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      "SSH commands need a valid credentialId",
    );
  });

  it("rejects a credential that is not assigned to the target Runner", async () => {
    jest.spyOn(RunbookCredentialService, "findOneBy").mockResolvedValue(null);

    const outcome: ToolCallOutcome = await getTool(
      buildToolkit(),
      "execute_remediation_command",
    ).execute(
      bashArgs({ stepType: "SSH", credentialId: CREDENTIAL_ID.toString() }),
    );

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      "not an SSH credential assigned to that Runner",
    );
  });

  it("refuses a clean-but-unallowlisted command without enqueueing anything", async () => {
    const enqueue: jest.SpyInstance = jest.spyOn(
      RunnerJobService,
      "enqueueAiCommand",
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(bashArgs({ command: "systemctl stop nginx" }));

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("allowlist");
    expect(outcome.textForLlm).toContain("NOT executed");
    expect(enqueue).not.toHaveBeenCalled();
    expect(toolkit.getExecutedCommands()).toHaveLength(0);
  });

  it("refuses when the project's hourly AI-command job cap is hit", async () => {
    jest
      .spyOn(RunnerJobService, "countBy")
      .mockResolvedValue(
        new PositiveNumber(MAX_AI_COMMAND_JOBS_PER_PROJECT_PER_HOUR),
      );
    const enqueue: jest.SpyInstance = jest.spyOn(
      RunnerJobService,
      "enqueueAiCommand",
    );

    const outcome: ToolCallOutcome = await getTool(
      buildToolkit(),
      "execute_remediation_command",
    ).execute(bashArgs());

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("hourly AI-command limit");
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("RemediationCommandToolkit propose_remediation_commands", () => {
  beforeEach(() => {
    jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(fakeRunner(RUNNER_ID));
    jest
      .spyOn(RunbookCredentialService, "findOneBy")
      .mockResolvedValue(fakeSshCredential());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function proposeTool(
    toolkit: RemediationCommandToolkit,
  ): ObservabilityAssistantExtraTool {
    return getTool(toolkit, "propose_remediation_commands");
  }

  it("refuses a missing or empty commands array", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });

    const missing: ToolCallOutcome = await proposeTool(toolkit).execute({});
    const empty: ToolCallOutcome = await proposeTool(toolkit).execute({
      commands: [],
    });

    expect(missing.success).toBe(false);
    expect(empty.success).toBe(false);
    expect(empty.textForLlm).toContain("non-empty 'commands' array");
    expect(toolkit.getProposedPlan()).toBeNull();
  });

  it("refuses a plan larger than the hard cap", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });
    const commands: Array<JSONObject> = [];
    for (let i: number = 0; i < MAX_PLAN_COMMANDS + 1; i++) {
      commands.push(bashArgs());
    }

    const outcome: ToolCallOutcome = await proposeTool(toolkit).execute({
      commands,
    } as unknown as JSONObject);

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      `at most ${MAX_PLAN_COMMANDS} commands`,
    );
    expect(toolkit.getProposedPlan()).toBeNull();
  });

  it("aggregates every per-command problem into ONE refusal and records nothing", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });

    const outcome: ToolCallOutcome = await proposeTool(toolkit).execute({
      commands: [
        bashArgs({ stepType: "Kubernetes" }),
        bashArgs({ command: undefined }),
        bashArgs({ command: "rm -rf /tmp/cache" }),
      ],
    } as unknown as JSONObject);

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("The plan was NOT recorded");
    expect(outcome.textForLlm).toContain("Command 1: stepType must be one of");
    expect(outcome.textForLlm).toContain("Command 2: command is required");
    expect(outcome.textForLlm).toContain(
      "Command 3: Denied by the remediation command policy",
    );
    expect(toolkit.getProposedPlan()).toBeNull();
  });

  it("records a valid plan with per-command informational verdicts", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });

    const outcome: ToolCallOutcome = await proposeTool(toolkit).execute({
      commands: [
        // Matches "systemctl restart *" and is chain-free.
        bashArgs(),
        // Clean but not allowlisted.
        bashArgs({ command: "df -h" }),
      ],
    } as unknown as JSONObject);

    expect(outcome.success).toBe(true);
    expect(outcome.result?.rowCount).toBe(2);

    const plan: AiRemediationCommandPlan | null = toolkit.getProposedPlan();
    expect(plan?.commands).toHaveLength(2);
    expect(plan?.commands[0]).toEqual(
      expect.objectContaining({
        sequence: 1,
        command: "systemctl restart nginx",
        runnerNameSnapshot: "prod-runner-1",
        policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
      }),
    );
    expect(plan?.commands[1]).toEqual(
      expect.objectContaining({
        sequence: 2,
        command: "df -h",
        policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
      }),
    );
  });

  it("replaces the earlier plan wholesale on a second call", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });

    const first: ToolCallOutcome = await proposeTool(toolkit).execute({
      commands: [bashArgs()],
    } as unknown as JSONObject);
    const second: ToolCallOutcome = await proposeTool(toolkit).execute({
      commands: [bashArgs({ command: "systemctl restart redis" })],
    } as unknown as JSONObject);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    const plan: AiRemediationCommandPlan | null = toolkit.getProposedPlan();
    expect(plan?.commands).toHaveLength(1);
    expect(plan?.commands[0]?.command).toBe("systemctl restart redis");
  });
});

/*
 * Contract under test — the rollbackCommand policy gate:
 *
 * A rollback is never reviewed at the moment it runs: the verifier fires it
 * unattended, long after any human looked at the plan. So it clears a bar of
 * its own, which differs by mode:
 *
 * - BOTH modes: denylist AND the structural guard (no chaining, pipes,
 *   redirection, substitution, newlines) — enforced during argument parsing,
 *   so a bad rollback rejects the command before any Runner is touched;
 * - FullAuto ONLY: the rule's operator allowlist on top, because nothing
 *   shows a FullAuto plan to a human. A forward command that is allowlisted
 *   does NOT lend its approval to its rollback — a simple, non-denylisted but
 *   non-allowlisted rollback is still refused, with nothing enqueued and
 *   nothing recorded as executed;
 * - Suggest mode deliberately stops at denylist + structural: a human
 *   approves the whole plan, so an unallowlisted rollback is legitimate.
 *
 * Also covered: persistPlanProgress failing FAILS CLOSED — no RunnerJob is
 * enqueued and the recorded command is marked Failed, because a side effect
 * with no durable record is how the same command runs twice.
 */
describe("RemediationCommandToolkit rollback policy gate (FullAuto)", () => {
  beforeEach(() => {
    mockHappyExecution();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("executes when the forward command AND its simple rollback both match the allowlist", async () => {
    const enqueue: jest.SpyInstance = jest.spyOn(
      RunnerJobService,
      "enqueueAiCommand",
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(bashArgs({ rollbackCommand: "systemctl restart nginx-legacy" }));

    expect(outcome.success).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(toolkit.getExecutedCommands()[0]).toEqual(
      expect.objectContaining({
        command: "systemctl restart nginx",
        rollbackCommand: "systemctl restart nginx-legacy",
        policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
      }),
    );
  });

  it("refuses a CHAINED rollback even though the forward command is allowlisted", async () => {
    const enqueue: jest.SpyInstance = jest.spyOn(
      RunnerJobService,
      "enqueueAiCommand",
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(bashArgs({ rollbackCommand: "systemctl start x; curl evil" }));

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("rollbackCommand");
    expect(outcome.textForLlm).toContain("single simple command");
    expect(enqueue).not.toHaveBeenCalled();
    expect(toolkit.getExecutedCommands()).toHaveLength(0);
  });

  it("refuses a simple-but-unallowlisted rollback — the forward allowlist match does not cover it", async () => {
    const enqueue: jest.SpyInstance = jest.spyOn(
      RunnerJobService,
      "enqueueAiCommand",
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();

    /*
     * "service nginx start" is denylist-clean and structurally simple, but
     * the rule's only pattern is "systemctl restart *".
     */
    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(bashArgs({ rollbackCommand: "service nginx start" }));

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      "The rollbackCommand does not qualify for automatic execution",
    );
    expect(outcome.textForLlm).toContain("allowlist");
    expect(outcome.textForLlm).toContain("Nothing was executed");
    expect(enqueue).not.toHaveBeenCalled();
    expect(toolkit.getExecutedCommands()).toHaveLength(0);
  });

  it("refuses a DENYLISTED rollback with nothing enqueued and nothing recorded", async () => {
    const enqueue: jest.SpyInstance = jest.spyOn(
      RunnerJobService,
      "enqueueAiCommand",
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(bashArgs({ rollbackCommand: "shutdown -h now" }));

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain(
      "The rollbackCommand is denied by the remediation command policy",
    );
    expect(enqueue).not.toHaveBeenCalled();
    expect(toolkit.getExecutedCommands()).toHaveLength(0);
  });
});

describe("RemediationCommandToolkit fails closed when the audit record cannot be saved", () => {
  beforeEach(() => {
    mockHappyExecution();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does NOT enqueue and marks the command Failed when persisting the plan rejects", async () => {
    jest
      .spyOn(AutoRemediationSuggestionService, "updateOneById")
      .mockRejectedValue(new Error("database unavailable") as never);
    const enqueue: jest.SpyInstance = jest.spyOn(
      RunnerJobService,
      "enqueueAiCommand",
    );
    const toolkit: RemediationCommandToolkit = buildToolkit();

    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(bashArgs());

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("it was NOT executed");
    expect(enqueue).not.toHaveBeenCalled();
    expect(toolkit.getExecutedCommands()).toHaveLength(1);
    expect(toolkit.getExecutedCommands()[0]?.execution).toEqual(
      expect.objectContaining({
        status: AiRemediationCommandExecutionStatus.Failed,
      }),
    );
  });
});

describe("RemediationCommandToolkit rollback policy gate (Suggest)", () => {
  beforeEach(() => {
    jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue(fakeRunner(RUNNER_ID));
    jest
      .spyOn(RunbookCredentialService, "findOneBy")
      .mockResolvedValue(fakeSshCredential());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects the whole plan when a proposed command's rollback is CHAINED", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });

    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "propose_remediation_commands",
    ).execute({
      commands: [bashArgs({ rollbackCommand: "systemctl start x; curl evil" })],
    } as unknown as JSONObject);

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("The plan was NOT recorded");
    expect(outcome.textForLlm).toContain(
      "Command 1: The rollbackCommand must be a single simple command",
    );
    expect(toolkit.getProposedPlan()).toBeNull();
  });

  it("accepts a simple rollback that does not match the allowlist — a human approves the plan", async () => {
    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });

    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "propose_remediation_commands",
    ).execute({
      commands: [bashArgs({ rollbackCommand: "service nginx start" })],
    } as unknown as JSONObject);

    expect(outcome.success).toBe(true);

    const plan: AiRemediationCommandPlan | null = toolkit.getProposedPlan();
    expect(plan?.commands).toHaveLength(1);
    expect(plan?.commands[0]).toEqual(
      expect.objectContaining({
        command: "systemctl restart nginx",
        rollbackCommand: "service nginx start",
        policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
      }),
    );
  });
});

describe("RemediationCommandToolkit persists the job id before waiting (Bash)", () => {
  beforeEach(() => {
    mockHappyExecution();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  type PersistedCommand = AiRemediationCommandPlan["commands"][number];

  function lastPersistedCommand(persist: jest.SpyInstance): PersistedCommand {
    const call: { data: { commandPlan: AiRemediationCommandPlan } } = persist
      .mock.calls[persist.mock.calls.length - 1]![0] as {
      data: { commandPlan: AiRemediationCommandPlan };
    };
    return call.data.commandPlan.commands[0]!;
  }

  it("records runnerJobId on the Pending command between the enqueue and the wait, then the outcome", async () => {
    const persist: jest.SpyInstance = jest.spyOn(
      AutoRemediationSuggestionService,
      "updateOneById",
    );
    const enqueue: jest.SpyInstance = jest.spyOn(
      RunnerJobService,
      "enqueueAiCommand",
    );
    const poll: jest.SpyInstance = jest.spyOn(
      RunnerJobService,
      "pollUntilTerminal",
    );

    let recordAtPollStart: PersistedCommand | undefined = undefined;
    poll.mockImplementation(async (): Promise<RunnerJob> => {
      recordAtPollStart = lastPersistedCommand(persist);
      return fakeTerminalJob();
    });

    const outcome: ToolCallOutcome = await getTool(
      buildToolkit(),
      "execute_remediation_command",
    ).execute(bashArgs());

    expect(outcome.success).toBe(true);
    expect(persist).toHaveBeenCalledTimes(3);

    // audit record < enqueue < job id < poll < outcome
    expect(persist.mock.invocationCallOrder[0]).toBeLessThan(
      enqueue.mock.invocationCallOrder[0]!,
    );
    expect(enqueue.mock.invocationCallOrder[0]).toBeLessThan(
      persist.mock.invocationCallOrder[1]!,
    );
    expect(persist.mock.invocationCallOrder[1]).toBeLessThan(
      poll.mock.invocationCallOrder[0]!,
    );
    expect(poll.mock.invocationCallOrder[0]).toBeLessThan(
      persist.mock.invocationCallOrder[2]!,
    );

    /*
     * At the moment the wait starts, the durable record already names the
     * job — a Worker death during the wait leaves a Pending command the
     * rollback arm can resolve against its RunnerJob.
     */
    expect(recordAtPollStart!.execution).toEqual(
      expect.objectContaining({
        status: AiRemediationCommandExecutionStatus.Pending,
        runnerJobId: JOB_ID.toString(),
      }),
    );

    expect(lastPersistedCommand(persist).execution).toEqual(
      expect.objectContaining({
        status: AiRemediationCommandExecutionStatus.Succeeded,
        runnerJobId: JOB_ID.toString(),
      }),
    );
  });

  it("keeps the job id on a Bash command whose wait throws", async () => {
    const persist: jest.SpyInstance = jest.spyOn(
      AutoRemediationSuggestionService,
      "updateOneById",
    );
    jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockRejectedValue(new Error("lease lost"));

    const toolkit: RemediationCommandToolkit = buildToolkit();
    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(bashArgs());

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain("FAILED before completion");
    expect(lastPersistedCommand(persist).execution).toEqual(
      expect.objectContaining({
        status: AiRemediationCommandExecutionStatus.Failed,
        runnerJobId: JOB_ID.toString(),
        errorMessage: "lease lost",
      }),
    );
  });
});

/*
 * The in-cluster kubectl agent a kubernetes-agent chart registers is an
 * AI-command Runner (it runs kubectl for its cluster), but it only ever
 * claims Kubectl jobs. As a Bash or SSH target it could never serve the
 * job: it would wait out its claim timeout and fail — after a human's
 * approval, or burning a FullAuto run's budget. So it is neither listed nor
 * accepted as a host target, whether it is known by its server-owned row
 * name or by the posture the claim path narrows to Kubectl.
 */
describe("RemediationCommandToolkit never offers or accepts the in-cluster kubectl agent as a Bash/SSH target", () => {
  const AGENT_RUNNER_ID: ObjectID = new ObjectID(
    "abababab-abab-4bab-8bab-abababababab",
  );
  const POSTURE_AGENT_ID: ObjectID = new ObjectID(
    "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
  );

  function agentByName(): Runner {
    return fakeRunner(AGENT_RUNNER_ID, {
      name: "kubernetes-agent/prod-us",
      description: "in-cluster kubectl agent",
    });
  }

  function agentByPosture(): Runner {
    return fakeRunner(POSTURE_AGENT_ID, {
      name: "renamed-in-cluster-runner",
      hostInfo: {
        kubernetes: { inCluster: true, clusterIdentifier: "prod-us" },
      },
    });
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("lists only the ordinary host Runner, never the agent — whether known by name or by posture", async () => {
    jest
      .spyOn(RunnerService, "getOnlineAiCommandRunnersForProject")
      .mockResolvedValue([
        fakeRunner(RUNNER_ID, { name: "ops-bastion" }),
        agentByName(),
        agentByPosture(),
      ]);
    const credentialLookup: jest.SpyInstance = jest
      .spyOn(RunbookCredentialService, "findBy")
      .mockResolvedValue([]);

    const outcome: ToolCallOutcome = await getTool(
      buildToolkit(),
      "list_command_targets",
    ).execute({});

    expect(outcome.result?.rowCount).toBe(1);
    expect(outcome.textForLlm).toContain("ops-bastion");
    expect(outcome.textForLlm).not.toContain(AGENT_RUNNER_ID.toString());
    expect(outcome.textForLlm).not.toContain(POSTURE_AGENT_ID.toString());
    expect(outcome.textForLlm).not.toContain("kubernetes-agent/prod-us");
    // No credential lookups for a Runner that is not a target.
    expect(credentialLookup).toHaveBeenCalledTimes(1);
  });

  it("negative control: an ordinary Runner that merely runs in a pod (no cluster identity) is still a host target", async () => {
    jest
      .spyOn(RunnerService, "getOnlineAiCommandRunnersForProject")
      .mockResolvedValue([
        fakeRunner(RUNNER_ID, {
          name: "runner-in-a-pod",
          hostInfo: { kubernetes: { inCluster: true } },
        }),
        fakeRunner(OTHER_RUNNER_ID, {
          name: "runner-in-a-pod-2",
          hostInfo: {
            kubernetes: { inCluster: true, clusterIdentifier: "  " },
          },
        }),
      ]);
    jest.spyOn(RunbookCredentialService, "findBy").mockResolvedValue([]);

    const outcome: ToolCallOutcome = await getTool(
      buildToolkit(),
      "list_command_targets",
    ).execute({});

    expect(outcome.result?.rowCount).toBe(2);
    expect(outcome.textForLlm).toContain("runner-in-a-pod");
    expect(outcome.textForLlm).toContain("Bash, SSH");
  });

  it("reports no targets when the only online AI Runner is the agent", async () => {
    jest
      .spyOn(RunnerService, "getOnlineAiCommandRunnersForProject")
      .mockResolvedValue([agentByName()]);

    const outcome: ToolCallOutcome = await getTool(
      buildToolkit(),
      "list_command_targets",
    ).execute({});

    expect(outcome.result?.rowCount).toBe(0);
    expect(outcome.textForLlm).toContain("No online Runner");
  });

  it.each([
    ["Bash", undefined],
    ["SSH", CREDENTIAL_ID.toString()],
  ])(
    "FullAuto refuses a %s step on the agent Runner before any job, brake count or credential lookup",
    async (stepType: string, credentialId: string | undefined) => {
      mockHappyExecution();
      const runnerLookup: jest.SpyInstance = jest
        .spyOn(RunnerService, "findOneBy")
        .mockResolvedValue(agentByName());
      const credentialLookup: jest.SpyInstance = jest.spyOn(
        RunbookCredentialService,
        "findOneBy",
      );

      const toolkit: RemediationCommandToolkit = buildToolkit();
      const outcome: ToolCallOutcome = await getTool(
        toolkit,
        "execute_remediation_command",
      ).execute(
        bashArgs({
          stepType,
          runnerId: AGENT_RUNNER_ID.toString(),
          credentialId,
        }),
      );

      expect(outcome.success).toBe(false);
      expect(outcome.textForLlm).toContain("in-cluster kubectl agent");
      expect(outcome.textForLlm).toContain("stepType Kubectl");
      expect(outcome.textForLlm).toContain("kubernetesClusterId");
      // The lookup that found it asked for what identifies an agent.
      expect(
        (runnerLookup.mock.calls[0]![0] as { select: Record<string, boolean> })
          .select,
      ).toEqual(expect.objectContaining({ name: true, hostInfo: true }));
      expect(credentialLookup).not.toHaveBeenCalled();
      expect(RunnerJobService.countBy).not.toHaveBeenCalled();
      expect(RunnerJobService.enqueueAiCommand).not.toHaveBeenCalled();
      expect(
        AutoRemediationSuggestionService.updateOneById,
      ).not.toHaveBeenCalled();
      expect(toolkit.getExecutedCommands()).toHaveLength(0);
    },
  );

  it("FullAuto refuses a Bash step on a Runner whose posture says it is a cluster's agent, whatever its name", async () => {
    mockHappyExecution();
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(agentByPosture());

    const outcome: ToolCallOutcome = await getTool(
      buildToolkit(),
      "execute_remediation_command",
    ).execute(bashArgs({ runnerId: POSTURE_AGENT_ID.toString() }));

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("in-cluster kubectl agent");
    expect(RunnerJobService.enqueueAiCommand).not.toHaveBeenCalled();
  });

  it("Suggest rejects the whole plan when a Bash step names the agent Runner, and records nothing", async () => {
    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue(agentByName());

    const toolkit: RemediationCommandToolkit = buildToolkit({
      mode: "Suggest",
    });
    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "propose_remediation_commands",
    ).execute({
      commands: [bashArgs({ runnerId: AGENT_RUNNER_ID.toString() })],
    });

    expect(outcome.success).toBe(false);
    expect(outcome.textForLlm).toContain("Command 1");
    expect(outcome.textForLlm).toContain("in-cluster kubectl agent");
    expect(toolkit.getProposedPlan()).toBeNull();
  });

  it("negative control: the same Bash step on an ordinary Runner executes", async () => {
    mockHappyExecution();

    const toolkit: RemediationCommandToolkit = buildToolkit();
    const outcome: ToolCallOutcome = await getTool(
      toolkit,
      "execute_remediation_command",
    ).execute(bashArgs());

    expect(outcome.success).toBe(true);
    expect(RunnerJobService.enqueueAiCommand).toHaveBeenCalledTimes(1);
  });
});
