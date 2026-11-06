import AIRunService from "../../../../Server/Services/AIRunService";
import AIAgentTaskPullRequestService from "../../../../Server/Services/AIAgentTaskPullRequestService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import CodeRepositoryService from "../../../../Server/Services/CodeRepositoryService";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import CodeFixPullRequestRecord from "../../../../Server/Utils/AI/CodeFix/CodeFixPullRequestRecord";
import { CodeFixAgentSource } from "../../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import FixRunBudget from "../../../../Server/Utils/AI/CodeFix/FixRunBudget";
import CodeTaskRuns from "../../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import DeclaredCodeChanges from "../../../../Server/Utils/AutoRemediation/DeclaredCodeChanges";
import RemediationChatMessage from "../../../../Server/Utils/AutoRemediation/RemediationChatMessage";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import {
  AiRemediationCommand,
  AiRemediationCommandPolicyVerdict,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import ObjectID from "../../../../Types/ObjectID";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Where a fix that lasts touches what was there before:
 *
 *   - CodeTaskRuns.start links a task asked from a fix to it (the run's
 *     triggeredByAutoRemediationSuggestionId, and the step on its context);
 *   - CodeFixPullRequestRecord says so when such a task's pull request is
 *     recorded the first time, and only then;
 *   - the fix's Slack and Teams message says a change to a resource declared
 *     as code may be put back, and - for a change the code declares - that a
 *     pull request to that code can be asked for from OneUptime.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SUGGESTION_ID: string = "33333333-3333-4333-8333-333333333333";
const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";

function command(
  overrides: Partial<AiRemediationCommand> = {},
): AiRemediationCommand {
  return {
    sequence: 1,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: ObjectID.generate().toString(),
    runnerNameSnapshot: "Cloud AI agent",
    resourceType: AiResourceType.AwsAccount,
    resourceId: "55555555-5555-4555-8555-555555555555",
    resourceNameSnapshot: "prod",
    resourceCommandTier: ResourceCommandTier.SafeWrite,
    command: `cloud scale-out ${ECS} --count 4`,
    timeoutInMs: 60000,
    rationale: "Too few tasks.",
    expectedEffect: "Latency falls.",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    ...overrides,
  } as AiRemediationCommand;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CodeTaskRuns.start, asked from a fix", () => {
  test("the task is linked to the fix, and its step kept on its first turn", async () => {
    const created: Array<AIRun> = [];

    jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue(undefined);
    jest
      .spyOn(AIRunService, "create")
      .mockImplementation(async (data: { data: AIRun }): Promise<AIRun> => {
        created.push(data.data);
        return data.data;
      });

    const repository: CodeRepository = new CodeRepository();
    repository.id = ObjectID.generate();

    await CodeTaskRuns.start({
      projectId: PROJECT_ID,
      userId: ObjectID.generate(),
      repository,
      message:
        "Scale the ECS service web out to 4 tasks, in the Terraform code that declares it",
      context: [],
      declaredCodeChange: {
        suggestionId: SUGGESTION_ID,
        sequence: 1,
        resourceType: AiResourceType.AwsAccount,
        resourceId: "55555555-5555-4555-8555-555555555555",
        command: `cloud scale-out ${ECS} --count 4`,
        managedAsCode: "Terraform",
      },
    });

    expect(created[0]!.triggeredByAutoRemediationSuggestionId?.toString()).toBe(
      SUGGESTION_ID,
    );
    expect(created[0]!.taskContext).toEqual({
      request: {
        message:
          "Scale the ECS service web out to 4 tasks, in the Terraform code that declares it",
        context: [],
      },
      declaredCodeChange: {
        suggestionId: SUGGESTION_ID,
        sequence: 1,
        resourceType: AiResourceType.AwsAccount,
        resourceId: "55555555-5555-4555-8555-555555555555",
        command: `cloud scale-out ${ECS} --count 4`,
        managedAsCode: "Terraform",
      },
    });
  });

  test("a task asked in Code is linked to nothing", async () => {
    const created: Array<AIRun> = [];

    jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue(undefined);
    jest
      .spyOn(AIRunService, "create")
      .mockImplementation(async (data: { data: AIRun }): Promise<AIRun> => {
        created.push(data.data);
        return data.data;
      });

    const repository: CodeRepository = new CodeRepository();
    repository.id = ObjectID.generate();

    await CodeTaskRuns.start({
      projectId: PROJECT_ID,
      userId: ObjectID.generate(),
      repository,
      message: "Add retries",
      context: [],
    });

    expect(created[0]!.triggeredByAutoRemediationSuggestionId).toBeUndefined();
    expect(created[0]!.taskContext).not.toHaveProperty("declaredCodeChange");
  });
});

describe("CodeFixPullRequestRecord, for a task asked from a fix", () => {
  let opened: jest.SpiedFunction<
    typeof DeclaredCodeChanges.onPullRequestOpened
  >;
  let existing: AIAgentTaskPullRequest | null;

  beforeEach(() => {
    existing = null;
    opened = jest
      .spyOn(DeclaredCodeChanges, "onPullRequestOpened")
      .mockResolvedValue(undefined);

    const repository: CodeRepository = new CodeRepository();
    repository.id = ObjectID.generate();
    repository.projectId = PROJECT_ID;

    jest
      .spyOn(CodeRepositoryService, "findOneById")
      .mockResolvedValue(repository);
    jest
      .spyOn(AIAgentTaskPullRequestService, "findOneBy")
      .mockImplementation(async () => {
        return existing;
      });
    jest
      .spyOn(AIAgentTaskPullRequestService, "create")
      .mockImplementation(async (data: { data: AIAgentTaskPullRequest }) => {
        return data.data;
      });
    jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(1 as never);
    jest
      .spyOn(AIRunEventService, "appendEventToRun")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({ release: jest.fn() } as unknown as SemaphoreMutex);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  });

  async function record(): Promise<void> {
    await CodeFixPullRequestRecord.record({
      aiRunId: new ObjectID("88888888-8888-4888-8888-888888888888"),
      projectId: PROJECT_ID,
      aiAgent: {
        source: CodeFixAgentSource.Runner,
        id: ObjectID.generate(),
      } as never,
      fields: {
        codeRepositoryId: ObjectID.generate(),
        pullRequestUrl: "https://github.com/acme/platform/pull/7",
        pullRequestNumber: 7,
        title: "Scale web to 4 tasks",
      },
    });
  }

  test("a pull request recorded the first time is said where the fix is", async () => {
    await record();

    expect(opened).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      aiRunId: new ObjectID("88888888-8888-4888-8888-888888888888"),
      pullRequestUrl: "https://github.com/acme/platform/pull/7",
      title: "Scale web to 4 tasks",
    });
  });

  test("the same pull request reported again is said once", async () => {
    existing = new AIAgentTaskPullRequest();
    existing.id = ObjectID.generate();

    await record();

    expect(opened).not.toHaveBeenCalled();
  });
});

describe("the fix's chat message", () => {
  function parts(commands: Array<AiRemediationCommand>): string {
    return RemediationChatMessage.describeChangeParts(
      {
        suggestionId: new ObjectID(SUGGESTION_ID),
        projectId: PROJECT_ID,
        suggestionType: AutoRemediationSuggestionType.CommandPlan,
        commandPlan: { commands } as never,
      },
      { withDetails: false },
    )
      .map((part: { toString: () => string }): string => {
        return part.toString();
      })
      .join("\n\n");
  }

  test("a change the code declares: put back by the next apply, and a pull request can be asked for", () => {
    expect(parts([command({ managedAsCode: "Terraform" })])).toContain(
      "Declared as code by Terraform: the next apply may put the old value back. Open the fix in OneUptime to ask for a pull request to that code with the same change.",
    );
  });

  test("a restart of a declared resource: put back, and nothing to ask for", () => {
    const text: string = parts([
      command({
        managedAsCode: "Terraform",
        command: `cloud restart-service ${ECS}`,
      }),
    ]);

    expect(text).toContain(
      "Declared as code by Terraform: the next apply may put the old value back.",
    );
    expect(text).not.toContain("pull request");
  });

  test("a resource no code declares: no word of code", () => {
    expect(parts([command()])).not.toContain("Declared as code");
  });
});
