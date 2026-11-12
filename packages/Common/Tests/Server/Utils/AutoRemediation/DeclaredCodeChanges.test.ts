import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import AIRunService from "../../../../Server/Services/AIRunService";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import CodeTaskAccess from "../../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import CodeTaskContextBuilder from "../../../../Server/Utils/AI/CodeTask/CodeTaskContextBuilder";
import CodeTaskGate from "../../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import CodeTaskListRows, {
  CodeTaskRepliesRead,
} from "../../../../Server/Utils/AI/CodeTask/CodeTaskListRows";
import CodeTaskRuns from "../../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import DeclaredCodeOwner, {
  DeclaredCodeOwnerCandidate,
} from "../../../../Server/Utils/AI/Remediation/DeclaredCodeOwner";
import CloudAiTargets from "../../../../Server/Utils/AI/ResourceAccess/CloudAiTargets";
import ProductBrandingText from "../../../../Server/Utils/ProductBrandingText";
import DeclaredCodeChanges, {
  DECLARED_CODE_NOT_DECLARED_MESSAGE,
  DECLARED_CODE_NOT_LASTING_MESSAGE,
  DECLARED_CODE_STEP_NOT_FOUND_MESSAGE,
} from "../../../../Server/Utils/AutoRemediation/DeclaredCodeChanges";
import URL from "../../../../Types/API/URL";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import { CodeTaskContextType } from "../../../../Types/AI/CodeTask";
import {
  AiRemediationCommand,
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPolicyVerdict,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import {
  DeclaredCodeChangeState,
  DeclaredCodeKind,
  DeclaredCodeOwnerJSON,
  DeclaredCodeOwnerReason,
} from "../../../../Utils/AiRemediation/DeclaredCodeChange";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Server/Utils/AutoRemediation/DeclaredCodeChanges - a fix that lasts: a
 * step of OneUptime AI's fix that changes a cloud resource declared as code
 * becomes a pull request to that code, when a person asks.
 *
 *   - getOwner: the repositories that may hold the code, only those the
 *     reader may read, each with whether they may ask in it;
 *   - start: a Code task asked as Code asks one (permission, gate), the
 *     request written from the change, the incident as context, the task
 *     linked to the fix and its step; the same step asked again gets the
 *     task already on its way; the incident's feed - and its chat channels -
 *     say who asked;
 *   - list: each step's task as it stands - its newest turn, however many
 *     it has (issue #7131) - the pull request named only to a reader of
 *     its repository;
 *   - onPullRequestOpened: the pull request on the incident's feed and
 *     channels, for a task asked from a fix, from any of its turns.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CLOUD_ACCOUNT_ID: string = "55555555-5555-4555-8555-555555555555";
const REPOSITORY_ID: string = "66666666-6666-4666-8666-666666666666";
const OTHER_REPOSITORY_ID: string = "77777777-7777-4777-8777-777777777777";
const TASK_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
} as DatabaseCommonInteractionProps;

function step(
  overrides: Partial<AiRemediationCommand> = {},
): AiRemediationCommand {
  return {
    sequence: 1,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: ObjectID.generate().toString(),
    runnerNameSnapshot: "Cloud AI agent",
    resourceType: AiResourceType.AwsAccount,
    resourceId: CLOUD_ACCOUNT_ID,
    resourceNameSnapshot: "prod",
    resourceCommandTier: ResourceCommandTier.SafeWrite,
    managedAsCode: "Terraform",
    command: `cloud scale-out ${ECS} --count 4`,
    timeoutInMs: 60000,
    rationale: "Too few tasks for the load.",
    expectedEffect: "Latency falls.",
    policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
    ...overrides,
  } as AiRemediationCommand;
}

function suggestion(
  commands: Array<AiRemediationCommand>,
): AutoRemediationSuggestion {
  const row: AutoRemediationSuggestion = new AutoRemediationSuggestion();
  row.id = SUGGESTION_ID;
  row.projectId = PROJECT_ID;
  row.incidentId = INCIDENT_ID;
  row.commandPlan = { commands } as unknown as JSONObject;
  return row;
}

function codeRepository(id: string, name: string): CodeRepository {
  const row: CodeRepository = new CodeRepository();
  row.id = new ObjectID(id);
  row.name = name;
  row.organizationName = "acme";
  row.repositoryName = name;
  return row;
}

function candidate(
  id: string,
  name: string,
  reason: DeclaredCodeOwnerReason,
  score: number,
): DeclaredCodeOwnerCandidate {
  return {
    repository: {
      id,
      name,
      organizationName: "acme",
      repositoryName: name,
      mainBranchName: "main",
      gitHubAppInstallationId: "1",
    },
    reason,
    matchedPaths:
      reason === DeclaredCodeOwnerReason.HasNamedFile ? ["web/main.tf"] : [],
    score,
  };
}

function task(data: {
  id?: ObjectID;
  status: AIRunStatus;
  sequence?: number;
  needsUserInput?: boolean;
  repositoryId?: string;
}): AIRun {
  const run: AIRun = new AIRun();
  run.id = data.id || TASK_ID;
  run.status = data.status;
  run.needsUserInput = data.needsUserInput || false;
  run.codeRepositoryId = new ObjectID(data.repositoryId || REPOSITORY_ID);
  run.taskContext = {
    declaredCodeChange: {
      suggestionId: SUGGESTION_ID.toString(),
      sequence: data.sequence || 1,
      resourceType: AiResourceType.AwsAccount,
      resourceId: CLOUD_ACCOUNT_ID,
      command: `cloud scale-out ${ECS} --count 4`,
      managedAsCode: "Terraform",
    },
  } as never;
  return run;
}

describe("DeclaredCodeChanges", () => {
  let userRead: SpyInstance<
    typeof AutoRemediationSuggestionService.findOneById
  >;
  let rootRead: SpyInstance<typeof AutoRemediationSuggestionService.findOneBy>;
  let targetRead: SpyInstance<typeof CloudAiTargets.findChangeTarget>;
  let candidates: SpyInstance<typeof DeclaredCodeOwner.findCandidates>;
  let readable: SpyInstance<typeof CodeTaskAccess.listReadableRepositories>;
  let canAsk: SpyInstance<typeof CodeTaskAccess.canAskInRepository>;
  let getRepository: SpyInstance<typeof CodeTaskAccess.getReadableRepository>;
  let gate: SpyInstance<typeof CodeTaskGate.assertCanStart>;
  let contextBuild: SpyInstance<typeof CodeTaskContextBuilder.build>;
  let startTask: SpyInstance<typeof CodeTaskRuns.start>;
  let findRuns: SpyInstance<typeof AIRunService.findBy>;
  let findRun: SpyInstance<typeof AIRunService.findOneBy>;
  let replies: SpyInstance<typeof CodeTaskListRows.readReplies>;
  let pullRequests: SpyInstance<typeof CodeTaskListRows.readPullRequests>;
  let incidentFeed: SpyInstance<
    typeof IncidentFeedService.createIncidentFeedItem
  >;
  let alertFeed: SpyInstance<typeof AlertFeedService.createAlertFeedItem>;

  beforeEach(() => {
    userRead = jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockResolvedValue(suggestion([step()]));
    rootRead = jest
      .spyOn(AutoRemediationSuggestionService, "findOneBy")
      .mockResolvedValue(suggestion([step()]));
    targetRead = jest
      .spyOn(CloudAiTargets, "findChangeTarget")
      .mockResolvedValue({
        cloudResourceId: ObjectID.generate(),
        name: "web",
        providerResourceId: ECS,
        cloudTags: { team: "payments", "managed-by": "terraform" },
        managedAsCode: "Terraform",
      });
    candidates = jest
      .spyOn(DeclaredCodeOwner, "findCandidates")
      .mockResolvedValue([
        candidate(
          REPOSITORY_ID,
          "platform",
          DeclaredCodeOwnerReason.HasNamedFile,
          65,
        ),
        candidate(
          OTHER_REPOSITORY_ID,
          "checkout-app",
          DeclaredCodeOwnerReason.NoEvidence,
          0,
        ),
        candidate(
          ObjectID.generate().toString(),
          "secret-infra",
          DeclaredCodeOwnerReason.HasCodeOfKind,
          40,
        ),
      ]);
    readable = jest
      .spyOn(CodeTaskAccess, "listReadableRepositories")
      .mockResolvedValue([
        codeRepository(REPOSITORY_ID, "platform"),
        codeRepository(OTHER_REPOSITORY_ID, "checkout-app"),
      ]);
    canAsk = jest
      .spyOn(CodeTaskAccess, "canAskInRepository")
      .mockImplementation(
        async (data: { repositoryId: ObjectID }): Promise<boolean> => {
          return data.repositoryId.toString() === REPOSITORY_ID;
        },
      );
    getRepository = jest
      .spyOn(CodeTaskAccess, "getReadableRepository")
      .mockResolvedValue(codeRepository(REPOSITORY_ID, "platform"));
    gate = jest
      .spyOn(CodeTaskGate, "assertCanStart")
      .mockResolvedValue(undefined);
    contextBuild = jest
      .spyOn(CodeTaskContextBuilder, "build")
      .mockResolvedValue([
        {
          type: CodeTaskContextType.Incident,
          label: "Incident #12",
          recordId: INCIDENT_ID.toString(),
        },
      ]);
    startTask = jest
      .spyOn(CodeTaskRuns, "start")
      .mockImplementation(async () => {
        const run: AIRun = new AIRun();
        run.id = TASK_ID;
        return run;
      });
    findRuns = jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);
    findRun = jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
    replies = jest
      .spyOn(CodeTaskListRows, "readReplies")
      .mockResolvedValue(new Map());
    pullRequests = jest
      .spyOn(CodeTaskListRows, "readPullRequests")
      .mockResolvedValue(new Map());
    incidentFeed = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue({} as never);
    alertFeed = jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue({} as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getOwner", () => {
    test("the repositories that may hold the code, only the readable ones, the best chosen", async () => {
      const owner: DeclaredCodeOwnerJSON = await DeclaredCodeChanges.getOwner({
        props: PROPS,
        tenantId: PROJECT_ID,
        suggestionId: SUGGESTION_ID.toString(),
        sequence: 1,
      });

      expect(owner).toEqual({
        sequence: 1,
        managedAsCode: "Terraform",
        codeKind: DeclaredCodeKind.Terraform,
        sentence: "Scale the ECS service web out to 4 tasks",
        target: { resourceType: "aws_ecs_service", attribute: "desired_count" },
        candidates: [
          {
            repositoryId: REPOSITORY_ID,
            name: "platform",
            fullName: "acme/platform",
            reason: DeclaredCodeOwnerReason.HasNamedFile,
            matchedPaths: ["web/main.tf"],
            isBest: true,
            canAsk: true,
          },
          {
            repositoryId: OTHER_REPOSITORY_ID,
            name: "checkout-app",
            fullName: "acme/checkout-app",
            reason: DeclaredCodeOwnerReason.NoEvidence,
            matchedPaths: [],
            isBest: false,
            canAsk: false,
          },
        ],
      });
      // The resource's own name and tags, and the code its tags name.
      expect(candidates.mock.calls[0]![0]).toMatchObject({
        projectId: PROJECT_ID,
        resource: {
          name: "web",
          tags: { team: "payments", "managed-by": "terraform" },
        },
      });
      // Whether they may ask, for each repository they may read - with their own props.
      expect(
        canAsk.mock.calls.map((call: Array<unknown>): string => {
          return String((call[0] as { repositoryId: ObjectID }).repositoryId);
        }),
      ).toEqual([REPOSITORY_ID, OTHER_REPOSITORY_ID]);
      expect(canAsk.mock.calls[0]![0]).toMatchObject({ props: PROPS });
      // Read with the reader's own permissions.
      expect(userRead.mock.calls[0]![0]).toMatchObject({ props: PROPS });
      expect(readable.mock.calls[0]![0]).toMatchObject({ props: PROPS });
      expect(targetRead.mock.calls[0]![0]).toMatchObject({
        providerResourceId: ECS,
        cloudAccountId: new ObjectID(CLOUD_ACCOUNT_ID),
      });
    });

    test.each([
      [
        "a step that is not there",
        2,
        DECLARED_CODE_STEP_NOT_FOUND_MESSAGE,
        [step()],
      ],
      [
        "a resource no code declares",
        1,
        DECLARED_CODE_NOT_DECLARED_MESSAGE,
        [step({ managedAsCode: undefined })],
      ],
      [
        "code no pull request can go to",
        1,
        DECLARED_CODE_NOT_DECLARED_MESSAGE,
        [step({ managedAsCode: "Ansible" })],
      ],
      [
        "a change the code does not declare",
        1,
        DECLARED_CODE_NOT_LASTING_MESSAGE,
        [step({ command: `cloud restart-service ${ECS}` })],
      ],
      [
        "a step that is not a cloud change",
        1,
        DECLARED_CODE_NOT_DECLARED_MESSAGE,
        [step({ resourceType: AiResourceType.DockerHost })],
      ],
    ])(
      "%s is refused",
      async (
        _name: string,
        sequence: number,
        message: string,
        commands: Array<AiRemediationCommand>,
      ) => {
        rootRead.mockResolvedValue(suggestion(commands));

        await expect(
          DeclaredCodeChanges.getOwner({
            props: PROPS,
            tenantId: PROJECT_ID,
            suggestionId: SUGGESTION_ID.toString(),
            sequence,
          }),
        ).rejects.toThrow(message);
        expect(candidates).not.toHaveBeenCalled();
      },
    );

    test("a fix the reader may not read reads as missing", async () => {
      userRead.mockResolvedValue(null);

      await expect(
        DeclaredCodeChanges.getOwner({
          props: PROPS,
          tenantId: PROJECT_ID,
          suggestionId: SUGGESTION_ID.toString(),
          sequence: 1,
        }),
      ).rejects.toThrow(BadDataException);
      expect(rootRead).not.toHaveBeenCalled();
    });

    test("another tenant's fix reads as missing", async () => {
      rootRead.mockResolvedValue(null);

      await expect(
        DeclaredCodeChanges.getOwner({
          props: PROPS,
          tenantId: OTHER_PROJECT,
          suggestionId: SUGGESTION_ID.toString(),
          sequence: 1,
        }),
      ).rejects.toThrow("Auto-remediation suggestion not found");
      expect(
        (rootRead.mock.calls[0]![0] as { query: Record<string, unknown> })
          .query["projectId"],
      ).toEqual(OTHER_PROJECT);
    });

    test.each([[0], [-1], ["one"], [null], [1.5]])(
      "a sequence %j is refused",
      async (sequence: unknown) => {
        await expect(
          DeclaredCodeChanges.getOwner({
            props: PROPS,
            tenantId: PROJECT_ID,
            suggestionId: SUGGESTION_ID.toString(),
            sequence,
          }),
        ).rejects.toThrow("sequence must be a step of the fix.");
      },
    );

    test("a resource the inventory no longer lists is named from the command", async () => {
      targetRead.mockResolvedValue(null);

      await DeclaredCodeChanges.getOwner({
        props: PROPS,
        tenantId: PROJECT_ID,
        suggestionId: SUGGESTION_ID.toString(),
        sequence: 1,
      });

      expect(candidates.mock.calls[0]![0]).toMatchObject({
        resource: { name: "web", tags: {} },
      });
    });
  });

  describe("start", () => {
    async function start(
      codeRepositoryId: unknown = REPOSITORY_ID,
    ): Promise<{ taskId: string; wasAlreadyAsked: boolean }> {
      return await DeclaredCodeChanges.start({
        props: PROPS,
        tenantId: PROJECT_ID,
        suggestionId: SUGGESTION_ID.toString(),
        sequence: 1,
        codeRepositoryId,
      });
    }

    test("a Code task in the repository, asked as Code asks one, linked to the fix and its step", async () => {
      expect(await start()).toEqual({
        taskId: TASK_ID.toString(),
        wasAlreadyAsked: false,
      });

      expect(getRepository).toHaveBeenCalledWith({
        props: PROPS,
        projectId: PROJECT_ID,
        repositoryId: new ObjectID(REPOSITORY_ID),
      });
      expect(gate.mock.calls[0]![0]).toMatchObject({
        props: PROPS,
        projectId: PROJECT_ID,
        canAsk: true,
      });

      const asked: Record<string, unknown> = startTask.mock
        .calls[0]![0] as Record<string, unknown>;

      expect(asked["userId"]).toEqual(USER_ID);
      expect(asked["projectId"]).toEqual(PROJECT_ID);
      expect(asked["declaredCodeChange"]).toEqual({
        suggestionId: SUGGESTION_ID.toString(),
        sequence: 1,
        resourceType: AiResourceType.AwsAccount,
        resourceId: CLOUD_ACCOUNT_ID,
        command: `cloud scale-out ${ECS} --count 4`,
        managedAsCode: "Terraform",
      });
      expect(String(asked["message"])).toContain(
        "In Terraform or OpenTofu, the value is most likely the `desired_count` of the `aws_ecs_service` that declares this resource: set it to 4.",
      );
      expect(String(asked["message"])).toContain(
        "OneUptime AI proposed this change",
      );
      // The incident, read as the person may read it, is the task's context.
      expect(contextBuild).toHaveBeenCalledWith({
        inputs: [
          { type: CodeTaskContextType.Incident, id: INCIDENT_ID.toString() },
        ],
        projectId: PROJECT_ID,
        props: PROPS,
      });
      expect(asked["context"]).toEqual([
        {
          type: CodeTaskContextType.Incident,
          label: "Incident #12",
          recordId: INCIDENT_ID.toString(),
        },
      ]);
    });

    test("the incident's feed, and so its channels, say who asked, with the task's link", async () => {
      await start();

      const item: Record<string, unknown> = incidentFeed.mock
        .calls[0]![0] as Record<string, unknown>;

      expect(item["incidentId"]).toEqual(INCIDENT_ID);
      expect(item["userId"]).toEqual(USER_ID);
      expect(item["workspaceNotification"]).toEqual({
        sendWorkspaceNotification: true,
        leadWithAuthor: true,
      });
      const markdown: string = String(item["feedInfoInMarkdown"]);

      expect(markdown).toContain(
        "asked OneUptime AI for a pull request to the Terraform code in acme/platform: Scale",
      );
      /*
       * The change names its resource, so the note names it once: it was
       * "...code that declares the ECS service web, in ...: Scale the ECS
       * service web ..." on a phone's three lines.
       */
      expect(markdown.split("service web").length - 1).toBe(1);
      expect(markdown).not.toContain("that declares");
      expect(markdown).toContain(`/code/tasks/${TASK_ID.toString()})`);
      expect(alertFeed).not.toHaveBeenCalled();
    });

    test("the note names the product as the installation does: it reaches Slack and Teams as written", async () => {
      jest
        .spyOn(ProductBrandingText, "getProductName")
        .mockReturnValue("Acme Ops");

      await start();

      const item: Record<string, unknown> = incidentFeed.mock
        .calls[0]![0] as Record<string, unknown>;

      expect(String(item["feedInfoInMarkdown"])).toContain(
        "asked Acme Ops AI for a pull request to the Terraform code in acme/platform",
      );
      expect(String(item["feedInfoInMarkdown"])).not.toContain("OneUptime");
    });

    test("a fix of an alert: the alert's feed", async () => {
      // An alert's fix: no incident (an optional field is never set to undefined).
      const alertId: ObjectID = ObjectID.generate();
      const row: AutoRemediationSuggestion = Object.assign(
        suggestion([step()]),
        { incidentId: undefined, alertId },
      );
      rootRead.mockResolvedValue(row);

      await start();

      expect(alertFeed).toHaveBeenCalledTimes(1);
      expect(incidentFeed).not.toHaveBeenCalled();
      expect(contextBuild.mock.calls[0]![0]).toMatchObject({
        inputs: [{ type: CodeTaskContextType.Alert, id: alertId.toString() }],
      });
    });

    test("a change that ran: the request says so, with the value it replaced", async () => {
      rootRead.mockResolvedValue(
        suggestion([
          step({
            execution: {
              status: AiRemediationCommandExecutionStatus.Succeeded,
              output: 'oneuptime-replaced: {"count":"2"}\nScaled.',
            },
          }),
        ]),
      );

      await start();

      expect(
        String(
          (startTask.mock.calls[0]![0] as Record<string, unknown>)["message"],
        ),
      ).toContain("OneUptime AI made this change on the live resource");
    });

    test("the same step asked again while its task is on its way: that task, nothing new", async () => {
      findRuns.mockResolvedValue([task({ status: AIRunStatus.Running })]);

      expect(await start()).toEqual({
        taskId: TASK_ID.toString(),
        wasAlreadyAsked: true,
      });
      expect(startTask).not.toHaveBeenCalled();
      expect(incidentFeed).not.toHaveBeenCalled();
    });

    test.each([
      [AIRunStatus.Error],
      [AIRunStatus.Cancelled],
      [AIRunStatus.Stale],
    ])(
      "a step whose task ended %s may be asked again",
      async (status: AIRunStatus) => {
        findRuns.mockResolvedValue([task({ status })]);

        expect((await start()).wasAlreadyAsked).toBe(false);
        expect(startTask).toHaveBeenCalledTimes(1);
      },
    );

    test("another step's task does not count", async () => {
      findRuns.mockResolvedValue([
        task({ status: AIRunStatus.Running, sequence: 2 }),
      ]);

      expect((await start()).wasAlreadyAsked).toBe(false);
    });

    test("Code's refusal stands: no task, no feed", async () => {
      gate.mockRejectedValue(
        new NotAuthorizedException("You may not ask AI here."),
      );

      await expect(start()).rejects.toThrow("You may not ask AI here.");
      expect(startTask).not.toHaveBeenCalled();
      expect(incidentFeed).not.toHaveBeenCalled();
    });

    test.each([[null], [""], ["not-an-id"], [42]])(
      "a repository %j is refused",
      async (value: unknown) => {
        await expect(start(value)).rejects.toThrow(
          "Choose the repository the pull request goes to.",
        );
        expect(startTask).not.toHaveBeenCalled();
      },
    );

    test("a record that cannot be read still asks: the request says what to change", async () => {
      contextBuild.mockRejectedValue(new Error("gone"));

      await start();

      expect(
        (startTask.mock.calls[0]![0] as Record<string, unknown>)["context"],
      ).toEqual([]);
    });
  });

  describe("list", () => {
    async function list(): Promise<Array<Record<string, unknown>>> {
      return (
        await DeclaredCodeChanges.list({
          props: PROPS,
          tenantId: PROJECT_ID,
          suggestionId: SUGGESTION_ID.toString(),
        })
      ).changes as unknown as Array<Record<string, unknown>>;
    }

    function pullRequest(
      runId: ObjectID,
      state: PullRequestState = PullRequestState.Open,
    ): AIAgentTaskPullRequest {
      const row: AIAgentTaskPullRequest = new AIAgentTaskPullRequest();
      row.aiRunId = runId;
      row.pullRequestUrl = URL.fromString(
        "https://github.com/acme/platform/pull/7",
      );
      row.pullRequestNumber = 7;
      row.pullRequestState = state;
      return row;
    }

    test("no tasks: nothing", async () => {
      expect(await list()).toEqual([]);
      // The fix's own tasks: its first turns, in this tenant.
      const query: Record<string, unknown> = (
        findRuns.mock.calls[0]![0] as {
          query: Record<string, unknown>;
        }
      ).query;
      expect(query["projectId"]).toEqual(PROJECT_ID);
      expect(query["triggeredByAutoRemediationSuggestionId"]).toEqual(
        SUGGESTION_ID,
      );
    });

    test.each([
      [AIRunStatus.Queued, false, DeclaredCodeChangeState.Writing],
      [AIRunStatus.Running, false, DeclaredCodeChangeState.Writing],
      [AIRunStatus.Completed, false, DeclaredCodeChangeState.Ended],
      // It stopped to ask the person: said apart from "nothing to change".
      [AIRunStatus.Completed, true, DeclaredCodeChangeState.WaitingForYou],
      [AIRunStatus.NoFixFound, false, DeclaredCodeChangeState.Ended],
      [AIRunStatus.Error, false, DeclaredCodeChangeState.Failed],
      [AIRunStatus.Cancelled, false, DeclaredCodeChangeState.Failed],
    ])(
      "a task %s (asking: %s) reads %s",
      async (
        status: AIRunStatus,
        needsUserInput: boolean,
        state: DeclaredCodeChangeState,
      ) => {
        findRuns.mockResolvedValue([task({ status, needsUserInput })]);

        expect(await list()).toEqual([
          {
            sequence: 1,
            taskId: TASK_ID.toString(),
            repositoryName: "acme/platform",
            state,
          },
        ]);
      },
    );

    // The pull request each task shows, by task (CodeTaskListRows).
    function shown(
      pullRequestOf: AIAgentTaskPullRequest,
    ): Map<string, AIAgentTaskPullRequest> {
      return new Map([[CodeTaskListRows.key(TASK_ID), pullRequestOf]]);
    }

    // The task's replies as read: how many, and the newest.
    function newestReply(
      newest: AIRun,
      count: number = 1,
    ): Map<string, CodeTaskRepliesRead> {
      return new Map([[CodeTaskListRows.key(TASK_ID), { count, newest }]]);
    }

    test("a task that opened a pull request reads opened, with its link", async () => {
      findRuns.mockResolvedValue([task({ status: AIRunStatus.Completed })]);
      pullRequests.mockResolvedValue(shown(pullRequest(TASK_ID)));

      expect(await list()).toEqual([
        {
          sequence: 1,
          taskId: TASK_ID.toString(),
          repositoryName: "acme/platform",
          state: DeclaredCodeChangeState.Opened,
          pullRequestUrl: "https://github.com/acme/platform/pull/7",
          pullRequestNumber: 7,
        },
      ]);
    });

    test("a pull request a reply opened is the task's", async () => {
      const replyId: ObjectID = ObjectID.generate();
      const reply: AIRun = new AIRun();
      reply.id = replyId;
      reply.codeTaskId = TASK_ID;
      reply.status = AIRunStatus.Running;
      findRuns.mockResolvedValue([task({ status: AIRunStatus.Completed })]);
      replies.mockResolvedValue(newestReply(reply));
      pullRequests.mockResolvedValue(shown(pullRequest(replyId)));

      expect((await list())[0]!["state"]).toBe(DeclaredCodeChangeState.Opened);
    });

    /*
     * A task kept open as a working thread for months: its newest turn says
     * how it stands, however many came before it. The list read a page of
     * tasks' replies oldest first, cut at 10,000 - so a task past that read
     * as it stood when its 10,000th reply was asked (issue #7131).
     */
    test.each([
      [AIRunStatus.Running, false, DeclaredCodeChangeState.Writing],
      [AIRunStatus.Completed, true, DeclaredCodeChangeState.WaitingForYou],
      [AIRunStatus.Error, false, DeclaredCodeChangeState.Failed],
    ])(
      "a task of 12,000 turns whose newest is %s (asking: %s) reads %s - not as its first turn stood",
      async (
        status: AIRunStatus,
        needsUserInput: boolean,
        state: DeclaredCodeChangeState,
      ) => {
        const newest: AIRun = new AIRun();
        newest.id = ObjectID.generate();
        newest.codeTaskId = TASK_ID;
        newest.status = status;
        newest.needsUserInput = needsUserInput;
        findRuns.mockResolvedValue([task({ status: AIRunStatus.Completed })]);
        replies.mockResolvedValue(newestReply(newest, 11999));

        expect((await list())[0]!["state"]).toBe(state);
      },
    );

    test("negative control: a task nobody replied to reads as its first turn stands - another task's newest turn is not its", async () => {
      const otherTask: ObjectID = ObjectID.generate();
      const othersNewest: AIRun = new AIRun();
      othersNewest.id = ObjectID.generate();
      othersNewest.codeTaskId = otherTask;
      othersNewest.status = AIRunStatus.Running;
      findRuns.mockResolvedValue([task({ status: AIRunStatus.Error })]);
      replies.mockResolvedValue(
        new Map([
          [CodeTaskListRows.key(otherTask), { count: 3, newest: othersNewest }],
        ]),
      );

      expect((await list())[0]!["state"]).toBe(DeclaredCodeChangeState.Failed);
    });

    test("each step's newest task is read per task, in this tenant - never every reply of every task", async () => {
      const older: ObjectID = ObjectID.generate();
      const second: ObjectID = ObjectID.generate();
      findRuns.mockResolvedValue([
        task({ status: AIRunStatus.Running }),
        task({ id: older, status: AIRunStatus.Error }),
        task({ id: second, status: AIRunStatus.Completed, sequence: 2 }),
      ]);

      await list();

      for (const read of [replies, pullRequests]) {
        expect(read).toHaveBeenCalledTimes(1);
        const asked: { projectId: ObjectID; taskIds: Array<ObjectID> } = read
          .mock.calls[0]![0] as never;
        expect(asked.projectId).toEqual(PROJECT_ID);
        // The step asked again is read; the older task it replaced is not.
        expect(
          asked.taskIds.map((id: ObjectID): string => {
            return id.toString();
          }),
        ).toEqual([TASK_ID.toString(), second.toString()]);
      }

      // One read of runs: the fix's tasks. No reply is read one by one.
      expect(findRuns).toHaveBeenCalledTimes(1);
    });

    test("a reader who may not read the repository is not given the pull request", async () => {
      findRuns.mockResolvedValue([task({ status: AIRunStatus.Completed })]);
      pullRequests.mockResolvedValue(shown(pullRequest(TASK_ID)));
      readable.mockResolvedValue([]);

      expect(await list()).toEqual([
        {
          sequence: 1,
          taskId: TASK_ID.toString(),
          repositoryName: "",
          state: DeclaredCodeChangeState.Opened,
        },
      ]);
    });

    test("each step's newest task", async () => {
      const older: ObjectID = ObjectID.generate();
      findRuns.mockResolvedValue([
        task({ status: AIRunStatus.Running }),
        task({ id: older, status: AIRunStatus.Error }),
        task({
          id: ObjectID.generate(),
          status: AIRunStatus.Completed,
          sequence: 2,
        }),
      ]);

      const changes: Array<Record<string, unknown>> = await list();

      expect(
        changes.map((change: Record<string, unknown>) => {
          return [change["sequence"], change["taskId"], change["state"]];
        }),
      ).toEqual([
        [1, TASK_ID.toString(), DeclaredCodeChangeState.Writing],
        [2, expect.any(String), DeclaredCodeChangeState.Ended],
      ]);
    });

    test("a fix the reader may not read reads as missing", async () => {
      userRead.mockResolvedValue(null);

      await expect(list()).rejects.toThrow(BadDataException);
      expect(findRuns).not.toHaveBeenCalled();
    });
  });

  describe("onPullRequestOpened", () => {
    function linkedRun(data: { codeTaskId?: ObjectID } = {}): AIRun {
      const run: AIRun = task({ status: AIRunStatus.Completed });
      run.triggeredByAutoRemediationSuggestionId = SUGGESTION_ID;
      if (data.codeTaskId) {
        run.codeTaskId = data.codeTaskId;
      }
      return run;
    }

    test("a task asked from a fix: the pull request on the incident's feed and channels", async () => {
      findRun.mockResolvedValue(linkedRun());

      await DeclaredCodeChanges.onPullRequestOpened({
        projectId: PROJECT_ID,
        aiRunId: TASK_ID,
        pullRequestUrl: "https://github.com/acme/platform/pull/7",
        title: "Scale web to 4 tasks",
      });

      const item: Record<string, unknown> = incidentFeed.mock
        .calls[0]![0] as Record<string, unknown>;

      expect(String(item["feedInfoInMarkdown"])).toBe(
        "OneUptime AI opened a pull request to the Terraform code that declares the ECS service web, so the next apply keeps the fix: [Scale web to 4 tasks](https://github.com/acme/platform/pull/7)",
      );
      expect(item["workspaceNotification"]).toEqual({
        sendWorkspaceNotification: true,
        leadWithAuthor: false,
      });
      expect(item["userId"]).toBeUndefined();
    });

    test("the opened note names the product as the installation does", async () => {
      jest
        .spyOn(ProductBrandingText, "getProductName")
        .mockReturnValue("Acme Ops");
      findRun.mockResolvedValue(linkedRun());

      await DeclaredCodeChanges.onPullRequestOpened({
        projectId: PROJECT_ID,
        aiRunId: TASK_ID,
        pullRequestUrl: "https://github.com/acme/platform/pull/7",
        title: "Scale web to 4 tasks",
      });

      expect(
        String(
          (incidentFeed.mock.calls[0]![0] as Record<string, unknown>)[
            "feedInfoInMarkdown"
          ],
        ),
      ).toBe(
        "Acme Ops AI opened a pull request to the Terraform code that declares the ECS service web, so the next apply keeps the fix: [Scale web to 4 tasks](https://github.com/acme/platform/pull/7)",
      );
    });

    test("an address that is not a web one is named, never linked", async () => {
      findRun.mockResolvedValue(linkedRun());

      await DeclaredCodeChanges.onPullRequestOpened({
        projectId: PROJECT_ID,
        aiRunId: TASK_ID,
        pullRequestUrl: "javascript:alert(1)",
        title: "Scale web to 4 tasks",
      });

      const markdown: string = String(
        (incidentFeed.mock.calls[0]![0] as Record<string, unknown>)[
          "feedInfoInMarkdown"
        ],
      );

      expect(markdown).toContain(
        "so the next apply keeps the fix: Scale web to 4 tasks",
      );
      expect(markdown).not.toContain("javascript:");
    });

    test("a reply's pull request: read from its task's first turn", async () => {
      const replyId: ObjectID = ObjectID.generate();
      const reply: AIRun = new AIRun();
      reply.id = replyId;
      reply.codeTaskId = TASK_ID;
      findRun.mockImplementation(async (data: unknown) => {
        const id: unknown = (data as { query: Record<string, unknown> }).query[
          "_id"
        ];
        return id === replyId.toString() ? reply : linkedRun();
      });

      await DeclaredCodeChanges.onPullRequestOpened({
        projectId: PROJECT_ID,
        aiRunId: replyId,
        pullRequestUrl: "https://github.com/acme/platform/pull/8",
        title: "Scale web",
      });

      expect(incidentFeed).toHaveBeenCalledTimes(1);
    });

    test("any other task's pull request says nothing here", async () => {
      const run: AIRun = new AIRun();
      run.id = TASK_ID;
      findRun.mockResolvedValue(run);

      await DeclaredCodeChanges.onPullRequestOpened({
        projectId: PROJECT_ID,
        aiRunId: TASK_ID,
        pullRequestUrl: "https://github.com/acme/platform/pull/7",
        title: "Anything",
      });

      expect(incidentFeed).not.toHaveBeenCalled();
      expect(rootRead).not.toHaveBeenCalled();
    });

    test("never throws", async () => {
      findRun.mockRejectedValue(new Error("the database went away"));

      await expect(
        DeclaredCodeChanges.onPullRequestOpened({
          projectId: PROJECT_ID,
          aiRunId: TASK_ID,
          pullRequestUrl: "https://github.com/acme/platform/pull/7",
          title: "x",
        }),
      ).resolves.toBeUndefined();
    });
  });
});
