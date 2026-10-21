import CommandPlanExecutor, {
  CommandPlanRollbackOutcome,
} from "../../../../Server/Utils/AutoRemediation/CommandPlanExecutor";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import ResourceAiAccessService from "../../../../Server/Services/ResourceAiAccessService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import logger from "../../../../Server/Utils/Logger";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import { AiRemediationRollbackStatus } from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiAgentPosture,
  ResourceAiRemediationMode,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the approved-plan executor and the rollback arm for
 * ResourceCommand steps (a command on a Docker or Podman host, a Docker
 * Swarm, Proxmox, VMware or Ceph cluster, a database server or a host,
 * through its resource AI agent), mirroring the kubectl branches:
 *
 * - a command is enqueued through enqueueAiResourceCommand — never a Runner
 *   lane — for the plan's resource and the agent it was composed for, with
 *   the approved (or rollback) step id;
 * - right before it is enqueued the resource's AI page is read again: a
 *   resource deleted, not ready, reached through another agent, or whose
 *   agent's write scope refuses the command stops it (Failed, never sent);
 *   a status that cannot be read stops it too; the policy's Denied tier is
 *   the execution-time floor (never the bash denylist);
 * - the resource's "Last error" records a success, or a failure about its
 *   access only;
 * - rollbacks run in REVERSE order and must be allowed unattended under the
 *   resource's CURRENT mode and allowlist, else they are left for a human;
 * - a resource command recorded as failed that may nonetheless have run is
 *   read back from its job: succeeded-after-all is rolled back, unknown is
 *   left for a human, never-ran owes nothing.
 */

const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const AI_RUN_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const RESOURCE_ID: string = "33333333-3333-4333-8333-333333333333";
const AGENT_ID: string = "44444444-4444-4444-8444-444444444444";
const OTHER_AGENT_ID: string = "45454545-4545-4545-8545-454545454545";
const JOB_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const FORWARD_JOB_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function posture(
  overrides: Partial<ResourceAiAgentPosture> = {},
): ResourceAiAgentPosture {
  return {
    resourceType: AiResourceType.DockerHost,
    resourceIdentifier: "web-1",
    allowWrites: true,
    writeTargets: [],
    protectedTargets: [],
    reachable: true,
    ...overrides,
  };
}

function resource(
  overrides: Partial<ResourceAiAccessStatus> = {},
  postureOverrides: Partial<ResourceAiAgentPosture> = {},
): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID,
    resourceName: "web-1",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    aiCommandAllowlist: [],
    agent: {
      agentId: AGENT_ID,
      connectionStatus: "connected",
      isOnline: true,
      posture: posture(postureOverrides),
    },
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
    ...overrides,
  };
}

function resourceCommand(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    sequence: 1,
    stepType: "ResourceCommand",
    runnerId: AGENT_ID,
    runnerNameSnapshot: "Docker AI agent",
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID,
    resourceNameSnapshot: "web-1",
    resourceCommandTier: "SafeWrite",
    command: "docker restart web",
    rollbackCommand: "docker start web",
    timeoutInMs: 30000,
    rationale: "the web container is wedged",
    expectedEffect: "web serves again",
    policyVerdict: "RequiresApproval",
    ...overrides,
  };
}

function approvedSuggestion(
  commands: Array<Record<string, unknown>>,
): AutoRemediationSuggestion {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    aiRunId: AI_RUN_ID,
    status: AutoRemediationSuggestionStatus.Approved,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    verificationStatus: AutoRemediationVerificationStatus.Pending,
    verificationDeadlineAt: new Date(Date.now() + 15 * 60 * 1000),
    ruleNameSnapshot: 'AI remediation for Docker host "web-1"',
    resourceType: AiResourceType.DockerHost,
    resourceId: new ObjectID(RESOURCE_ID),
    commandPlan: { commands, executionStatus: "NotStarted" },
  } as unknown as AutoRemediationSuggestion;
}

function failedSuggestion(
  commands: Array<Record<string, unknown>>,
): AutoRemediationSuggestion {
  return {
    ...(approvedSuggestion(commands) as unknown as Record<string, unknown>),
    status: AutoRemediationSuggestionStatus.AutoExecuted,
    verificationStatus: AutoRemediationVerificationStatus.Failed,
    commandPlan: { commands, executionStatus: "Completed" },
  } as unknown as AutoRemediationSuggestion;
}

let update: jest.SpyInstance;
let resourceEnqueue: jest.SpyInstance;
let kubectlEnqueue: jest.SpyInstance;
let bashEnqueue: jest.SpyInstance;
let poll: jest.SpyInstance;
let liveStatus: jest.SpyInstance;
let recordOutcome: jest.SpyInstance;
let jobRead: jest.SpyInstance;
let feed: jest.SpyInstance;

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest
    .spyOn(Semaphore, "lock")
    .mockResolvedValue({ id: "plan-lock" } as unknown as SemaphoreMutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneBy")
    .mockResolvedValue(null);
  update = jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockResolvedValue(undefined as never);
  resourceEnqueue = jest
    .spyOn(RunnerJobService, "enqueueAiResourceCommand")
    .mockResolvedValue({
      id: JOB_ID,
      _id: JOB_ID.toString(),
      status: RunnerJobStatus.Pending,
    } as unknown as RunnerJob);
  kubectlEnqueue = jest.spyOn(RunnerJobService, "enqueueAiKubectlCommand");
  bashEnqueue = jest.spyOn(RunnerJobService, "enqueueAiCommand");
  poll = jest.spyOn(RunnerJobService, "pollUntilTerminal").mockResolvedValue({
    id: JOB_ID,
    _id: JOB_ID.toString(),
    status: RunnerJobStatus.Succeeded,
    exitCode: 0,
    output: "web",
  } as unknown as RunnerJob);
  liveStatus = jest
    .spyOn(ResourceAiAccessService, "getStatusForResource")
    .mockResolvedValue(resource());
  recordOutcome = jest
    .spyOn(ResourceAiAccessService, "recordCommandOutcome")
    .mockResolvedValue(undefined);
  jobRead = jest.spyOn(RunnerJobService, "findOneById");
  feed = jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function lastPlan(): Record<string, unknown> {
  const call: Record<string, unknown> = update.mock.calls[
    update.mock.calls.length - 1
  ]![0] as Record<string, unknown>;
  return (call["data"] as Record<string, unknown>)["commandPlan"] as Record<
    string,
    unknown
  >;
}

function commandAt(index: number): Record<string, unknown> {
  return (lastPlan()["commands"] as Array<Record<string, unknown>>)[index]!;
}

function lastFeedMarkdown(): string {
  return (
    feed.mock.calls[feed.mock.calls.length - 1]![0] as {
      feedInfoInMarkdown: string;
    }
  ).feedInfoInMarkdown;
}

async function executeApproved(
  commands: Array<Record<string, unknown>>,
): Promise<void> {
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockResolvedValue(approvedSuggestion(commands));

  await CommandPlanExecutor.executeApprovedPlan({
    suggestionId: SUGGESTION_ID,
  });
}

describe("CommandPlanExecutor.executeApprovedPlan — resource commands", () => {
  it("enqueues each command through the resource chokepoint, for the plan's resource and agent", async () => {
    await executeApproved([
      resourceCommand(),
      resourceCommand({ sequence: 2, command: "docker restart api" }),
    ]);

    expect(bashEnqueue).not.toHaveBeenCalled();
    expect(kubectlEnqueue).not.toHaveBeenCalled();
    expect(resourceEnqueue).toHaveBeenCalledTimes(2);
    expect(resourceEnqueue.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      aiRunId: AI_RUN_ID,
      origin: RunnerJobOrigin.AiRemediation,
      autoRemediationSuggestionId: SUGGESTION_ID,
      resourceType: AiResourceType.DockerHost,
      resourceId: new ObjectID(RESOURCE_ID),
      stepId: "ai-approved-1",
      targetResourceAiAgentId: new ObjectID(AGENT_ID),
      command: "docker restart web",
      timeoutInMs: 30000,
      claimTimeoutInMs: 60000,
    });
    expect(resourceEnqueue.mock.calls[1]![0]).toMatchObject({
      stepId: "ai-approved-2",
      command: "docker restart api",
    });

    expect(commandAt(0)["execution"]).toMatchObject({
      status: "Succeeded",
      runnerJobId: JOB_ID.toString(),
    });
    expect(lastPlan()["executionStatus"]).toBe("Completed");
    expect(recordOutcome).toHaveBeenCalledWith({
      resourceType: AiResourceType.DockerHost,
      resourceId: new ObjectID(RESOURCE_ID),
      succeeded: true,
      errorMessage: undefined,
    });
    expect(lastFeedMarkdown()).toContain("Approved AI command plan executed");
  });

  it("stores the output through the resource redaction", async () => {
    poll.mockResolvedValue({
      id: JOB_ID,
      status: RunnerJobStatus.Succeeded,
      exitCode: 0,
      output:
        '[{"Config":{"Env":["DB_PASSWORD=hunter2hunter2","PATH=/usr/bin"]}}]',
    } as unknown as RunnerJob);

    await executeApproved([
      resourceCommand({ command: "docker container inspect web" }),
    ]);

    const output: string = String(
      (commandAt(0)["execution"] as Record<string, unknown>)["output"],
    );
    expect(output).not.toContain("hunter2hunter2");
  });

  it.each([
    [
      "deleted",
      null,
      'Refused at execution time: Docker host "web-1" no longer exists in this project.',
    ],
    [
      "no longer ready",
      resource({
        isRemediationReady: false,
        gaps: [
          {
            code: "ai_agent_offline",
            title: "The Docker AI agent is offline",
            nextStep: "Check it.",
            blocksInvestigation: true,
            blocksRemediation: true,
          },
        ],
      }),
      'Docker host "web-1" no longer allows AI remediation (The Docker AI agent is offline)',
    ],
    [
      "reached through another agent",
      resource({
        agent: {
          agentId: OTHER_AGENT_ID,
          connectionStatus: "connected",
          isOnline: true,
          posture: posture(),
        },
      }),
      "is no longer reached through the Docker AI agent this plan was composed for",
    ],
    [
      "guarded by an agent whose write scope refuses the command",
      resource({}, { protectedTargets: ["web"] }),
      "the Docker AI agent would refuse it:",
    ],
  ])(
    "refuses a command whose resource is %s — never sent, the rest skipped",
    async (
      _label: string,
      status: ResourceAiAccessStatus | null,
      expected: string,
    ) => {
      liveStatus.mockResolvedValue(status);

      await executeApproved([
        resourceCommand(),
        resourceCommand({ sequence: 2, command: "docker restart api" }),
      ]);

      expect(resourceEnqueue).not.toHaveBeenCalled();
      const execution: Record<string, unknown> = commandAt(0)[
        "execution"
      ] as Record<string, unknown>;
      expect(execution["status"]).toBe("Failed");
      expect(execution["errorMessage"]).toContain(expected);
      expect(
        (commandAt(1)["execution"] as Record<string, unknown>)["status"],
      ).toBe("Skipped");
      expect(lastPlan()["executionStatus"]).toBe("Failed");
      // A refusal before the enqueue never becomes the resource's last error.
      expect(recordOutcome).not.toHaveBeenCalled();
    },
  );

  it("refuses when the resource's status cannot be read (fail closed)", async () => {
    liveStatus.mockRejectedValue(new Error("db down"));

    await executeApproved([resourceCommand()]);

    expect(resourceEnqueue).not.toHaveBeenCalled();
    expect(
      (commandAt(0)["execution"] as Record<string, unknown>)["errorMessage"],
    ).toContain(
      'could not confirm that Docker host "web-1" still allows AI remediation',
    );
  });

  it("refuses a command the resource policy denies now — the Denied tier is the floor, never the bash denylist", async () => {
    await executeApproved([resourceCommand({ command: "docker exec web sh" })]);

    expect(resourceEnqueue).not.toHaveBeenCalled();
    expect(
      (commandAt(0)["execution"] as Record<string, unknown>)["errorMessage"],
    ).toContain("Refused by the remediation command policy at execution time");
  });

  it("records only an ACCESS failure as the resource's last error", async () => {
    poll.mockResolvedValue({
      id: JOB_ID,
      status: RunnerJobStatus.Failed,
      exitCode: 1,
      output:
        "[stderr]\nCannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?",
      errorMessage: "Exit code 1",
    } as unknown as RunnerJob);

    await executeApproved([resourceCommand()]);

    expect(recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ succeeded: false }),
    );

    recordOutcome.mockClear();
    poll.mockResolvedValue({
      id: JOB_ID,
      status: RunnerJobStatus.Failed,
      exitCode: 1,
      output: "[stderr]\nError response from daemon: No such container: web",
      errorMessage: "Exit code 1",
    } as unknown as RunnerJob);

    await executeApproved([resourceCommand()]);

    expect(recordOutcome).not.toHaveBeenCalled();
  });

  it("a Kubernetes plan never reads a resource status", async () => {
    jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
      .mockResolvedValue(null);

    await executeApproved([
      {
        sequence: 1,
        stepType: "Kubectl",
        runnerId: AGENT_ID,
        runnerNameSnapshot: "Kubernetes AI agent",
        kubernetesClusterId: RESOURCE_ID,
        kubernetesClusterNameSnapshot: "prod-us",
        command: "kubectl rollout restart deployment/web -n web",
        timeoutInMs: 30000,
        rationale: "r",
        expectedEffect: "e",
        policyVerdict: "RequiresApproval",
      },
    ]);

    expect(liveStatus).not.toHaveBeenCalled();
    expect(resourceEnqueue).not.toHaveBeenCalled();
  });
});

describe("CommandPlanExecutor.executeRollback — resource commands", () => {
  function executed(
    overrides: Partial<Record<string, unknown>> = {},
  ): Record<string, unknown> {
    return resourceCommand({
      wasAutoExecuted: true,
      policyVerdict: "AutoApproved",
      execution: {
        status: "Succeeded",
        runnerJobId: FORWARD_JOB_ID.toString(),
        exitCode: 0,
      },
      ...overrides,
    });
  }

  async function rollBack(
    commands: Array<Record<string, unknown>>,
  ): Promise<CommandPlanRollbackOutcome> {
    return CommandPlanExecutor.executeRollback({
      suggestion: failedSuggestion(commands),
    });
  }

  it("runs the undos in REVERSE order through the resource chokepoint with rollback step ids", async () => {
    const outcome: CommandPlanRollbackOutcome = await rollBack([
      executed({
        command: "docker stop web",
        rollbackCommand: "docker start web",
      }),
      executed({
        sequence: 2,
        command: "docker pause api",
        rollbackCommand: "docker unpause api",
      }),
    ]);

    expect(resourceEnqueue).toHaveBeenCalledTimes(2);
    expect(resourceEnqueue.mock.calls[0]![0]).toMatchObject({
      stepId: "ai-rollback-2",
      command: "docker unpause api",
      resourceType: AiResourceType.DockerHost,
      targetResourceAiAgentId: new ObjectID(AGENT_ID),
    });
    expect(resourceEnqueue.mock.calls[1]![0]).toMatchObject({
      stepId: "ai-rollback-1",
      command: "docker start web",
    });
    expect(outcome.rollbackStatus).toBe(AiRemediationRollbackStatus.Completed);
    expect(outcome.rolledBack).toBe(2);
  });

  it("leaves a riskier undo for a human once the resource no longer bypasses approvals", async () => {
    // The plan ran under Bypass approval; the operator has since moved to Automatic.
    liveStatus.mockResolvedValue(
      resource({ aiRemediationMode: ResourceAiRemediationMode.Automatic }),
    );

    const outcome: CommandPlanRollbackOutcome = await rollBack([
      executed({
        command: "docker start web",
        rollbackCommand: "docker stop web",
      }),
    ]);

    expect(resourceEnqueue).not.toHaveBeenCalled();
    const rollback: Record<string, unknown> = commandAt(0)[
      "rollbackExecution"
    ] as Record<string, unknown>;
    expect(rollback["status"]).toBe("Skipped");
    expect(rollback["errorMessage"]).toContain(
      'Docker host "web-1" no longer allows this change unattended (its AI remediation mode is now Automatic)',
    );
    expect(rollback["errorMessage"]).toContain(
      "Undo it manually: docker stop web",
    );
    expect(outcome.rollbackStatus).toBe(AiRemediationRollbackStatus.Failed);
    expect(outcome.leftForHuman).toBe(1);
    expect(lastFeedMarkdown()).toContain(
      "the Docker host no longer allows them unattended",
    );
  });

  it("runs a riskier undo the resource still allows unattended (Bypass approval)", async () => {
    liveStatus.mockResolvedValue(
      resource({ aiRemediationMode: ResourceAiRemediationMode.BypassApproval }),
    );

    const outcome: CommandPlanRollbackOutcome = await rollBack([
      executed({
        command: "docker start web",
        rollbackCommand: "docker stop web",
      }),
    ]);

    expect(resourceEnqueue).toHaveBeenCalledTimes(1);
    expect(outcome.rollbackStatus).toBe(AiRemediationRollbackStatus.Completed);
  });

  it("leaves every undo for a human when the resource stopped allowing remediation", async () => {
    liveStatus.mockResolvedValue(resource({ isRemediationReady: false }));

    const outcome: CommandPlanRollbackOutcome = await rollBack([executed()]);

    expect(resourceEnqueue).not.toHaveBeenCalled();
    expect(
      (commandAt(0)["rollbackExecution"] as Record<string, unknown>)[
        "errorMessage"
      ],
    ).toContain('Docker host "web-1" no longer allows AI remediation');
    expect(outcome.leftForHuman).toBe(1);
  });

  it("refuses an undo the resource policy denies", async () => {
    const outcome: CommandPlanRollbackOutcome = await rollBack([
      executed({ rollbackCommand: "docker rm -f web" }),
    ]);

    expect(resourceEnqueue).not.toHaveBeenCalled();
    expect(
      commandAt(0)["rollbackExecution"] as Record<string, unknown>,
    ).toMatchObject({ status: "Failed" });
    expect(outcome.failed).toBe(1);
  });

  describe("a failed resource command that may have run", () => {
    function failedForward(
      overrides: Partial<Record<string, unknown>> = {},
    ): Record<string, unknown> {
      return executed({
        execution: {
          status: "Failed",
          runnerJobId: FORWARD_JOB_ID.toString(),
          errorMessage:
            "The Docker AI agent took this command but did not report a result in time.",
        },
        ...overrides,
      });
    }

    it("leaves the undo of a job the agent claimed and went silent on for a human", async () => {
      jobRead.mockResolvedValue({
        id: FORWARD_JOB_ID,
        status: RunnerJobStatus.TimedOut,
        claimedAt: new Date(),
      } as unknown as RunnerJob);

      const outcome: CommandPlanRollbackOutcome = await rollBack([
        failedForward(),
      ]);

      expect(resourceEnqueue).not.toHaveBeenCalled();
      const rollback: Record<string, unknown> = commandAt(0)[
        "rollbackExecution"
      ] as Record<string, unknown>;
      expect(rollback["status"]).toBe("Skipped");
      expect(rollback["errorMessage"]).toContain(
        "the command reached the resource's AI agent but it did not report a finished result, so whether it changed the Docker host is unknown",
      );
      expect(rollback["errorMessage"]).toContain(
        "undo it manually: docker start web",
      );
      expect(outcome.rollbackStatus).toBe(AiRemediationRollbackStatus.Failed);
      // Read with the claim columns.
      expect(
        (jobRead.mock.calls[0]![0] as { select: Record<string, unknown> })
          .select,
      ).toEqual(
        expect.objectContaining({
          claimedAt: true,
          startedAt: true,
          assignedAgentId: true,
        }),
      );
    });

    it("leaves the undo of a program the agent killed at its timeout for a human", async () => {
      jobRead.mockResolvedValue({
        id: FORWARD_JOB_ID,
        status: RunnerJobStatus.Failed,
        errorMessage: "Killed (timeout 30s)",
        claimedAt: new Date(),
      } as unknown as RunnerJob);

      const outcome: CommandPlanRollbackOutcome = await rollBack([
        failedForward(),
      ]);

      expect(resourceEnqueue).not.toHaveBeenCalled();
      expect(outcome.leftForHuman).toBe(1);
    });

    it("rolls back a job that succeeded after all", async () => {
      jobRead.mockResolvedValue({
        id: FORWARD_JOB_ID,
        status: RunnerJobStatus.Succeeded,
        exitCode: 0,
        output: "web",
      } as unknown as RunnerJob);

      const outcome: CommandPlanRollbackOutcome = await rollBack([
        failedForward(),
      ]);

      expect(resourceEnqueue).toHaveBeenCalledTimes(1);
      expect(resourceEnqueue.mock.calls[0]![0]).toMatchObject({
        stepId: "ai-rollback-1",
        command: "docker start web",
      });
      expect(outcome.rollbackStatus).toBe(
        AiRemediationRollbackStatus.Completed,
      );
    });

    it.each([
      ["never claimed", { status: RunnerJobStatus.TimedOut }],
      [
        "refused before the program started",
        {
          status: RunnerJobStatus.Failed,
          errorMessage: "Refused: the agent is read-only.",
          claimedAt: new Date(),
        },
      ],
      [
        "finished with an exit code",
        {
          status: RunnerJobStatus.Failed,
          exitCode: 1,
          output: "[stderr]\nNo such container: web",
          claimedAt: new Date(),
        },
      ],
    ])(
      "owes no undo for a job that %s",
      async (_label: string, job: Record<string, unknown>) => {
        jobRead.mockResolvedValue({
          id: FORWARD_JOB_ID,
          ...job,
        } as unknown as RunnerJob);

        const outcome: CommandPlanRollbackOutcome = await rollBack([
          failedForward(),
        ]);

        expect(resourceEnqueue).not.toHaveBeenCalled();
        expect(commandAt(0)["rollbackExecution"]).toBeUndefined();
        expect(outcome.rollbackStatus).toBe(
          AiRemediationRollbackStatus.NotApplicable,
        );
      },
    );
  });
});
