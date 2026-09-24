import CommandPlanExecutor, {
  CommandPlanRollbackOutcome,
} from "../../../../Server/Utils/AutoRemediation/CommandPlanExecutor";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
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
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the rollback arm and a kubectl command recorded as
 * FAILED that may nonetheless have changed the cluster (PR #3953 round-three
 * review, the remediation adoption of KubectlJobRunner's run state).
 *
 * A Runner took the job and no result came back (Unknown), the wait for it
 * broke while it ran on, or kubectl was stopped before it finished: the
 * command is never read as "never ran". The rollback arm reads its job
 * again (with the claim columns, the way KubectlJobRunner reads every
 * kubectl job):
 *
 * - a job that Succeeded after all is settled Succeeded and rolled back
 *   like any other;
 * - a job whose run is Unknown (claimed or started and silent, still in
 *   flight, gone, unreadable) or that was killed before it finished is
 *   left for a human with its undo — never run blind, and the rollback is
 *   Failed so the follow-up round asks;
 * - a job that certainly never ran (never claimed; refused before spawn)
 *   or whose kubectl finished with an exit code owes no undo, as before;
 * - Bash/SSH commands and commands without a rollback are not read at all.
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
const RUNNER_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const FORWARD_JOB_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_FORWARD_JOB_ID: ObjectID = new ObjectID(
  "12121212-1212-4121-8121-121212121212",
);
const ROLLBACK_JOB_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

const KUBECTL_RESTART: string = "kubectl rollout restart deployment/web -n web";
const KUBECTL_UNDO: string = "kubectl rollout undo deployment/web -n web";

function kubectlCommand(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    sequence: 1,
    stepType: "Kubectl",
    runnerId: RUNNER_ID.toString(),
    runnerNameSnapshot: "kubernetes-agent/prod-us",
    kubernetesClusterId: CLUSTER_ID.toString(),
    kubernetesClusterNameSnapshot: "prod-us",
    kubectlTier: "SafeWrite",
    command: KUBECTL_RESTART,
    rollbackCommand: KUBECTL_UNDO,
    timeoutInMs: 5000,
    rationale: "The web pods are crash-looping.",
    expectedEffect: "Fresh pods come up Running.",
    policyVerdict: "AutoApproved",
    wasAutoExecuted: true,
    execution: {
      status: "Failed",
      runnerJobId: FORWARD_JOB_ID.toString(),
      errorMessage:
        "The Runner took this kubectl command but did not report a result in time.",
    },
    ...overrides,
  };
}

function suggestionWith(
  commands: Array<Record<string, unknown>>,
): AutoRemediationSuggestion {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    aiRunId: AI_RUN_ID,
    status: AutoRemediationSuggestionStatus.AutoExecuted,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    verificationStatus: AutoRemediationVerificationStatus.Failed,
    kubernetesClusterId: CLUSTER_ID,
    commandPlan: { commands, executionStatus: "Completed" },
  } as unknown as AutoRemediationSuggestion;
}

function clusterStatus(): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID.toString(),
    clusterName: "prod-us",
    runner: {
      id: RUNNER_ID.toString(),
      name: "kubernetes-agent/prod-us",
      isOnline: true,
      canRunAiCommands: true,
      posture: { inCluster: true, allowWrites: true },
    },
    accessMethod: "in_cluster",
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.Automatic,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
  };
}

// The forward job's row as the rollback arm reads it back.
function forwardJob(
  overrides: Partial<Record<string, unknown>> = {},
): RunnerJob {
  return {
    id: FORWARD_JOB_ID,
    _id: FORWARD_JOB_ID.toString(),
    ...overrides,
  } as unknown as RunnerJob;
}

let update: jest.SpyInstance;
let jobRead: jest.SpyInstance;
let kubectlEnqueue: jest.SpyInstance;
let bashEnqueue: jest.SpyInstance;
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
  // No stored plan to merge into: each write is the rollback arm's copy.
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneBy")
    .mockResolvedValue(null);
  update = jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jobRead = jest.spyOn(RunnerJobService, "findOneById");
  kubectlEnqueue = jest
    .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
    .mockResolvedValue({
      id: ROLLBACK_JOB_ID,
      _id: ROLLBACK_JOB_ID.toString(),
      status: RunnerJobStatus.Pending,
    } as unknown as RunnerJob);
  bashEnqueue = jest.spyOn(RunnerJobService, "enqueueAiCommand");
  jest.spyOn(RunnerJobService, "pollUntilTerminal").mockResolvedValue({
    id: ROLLBACK_JOB_ID,
    _id: ROLLBACK_JOB_ID.toString(),
    status: RunnerJobStatus.Succeeded,
    exitCode: 0,
    output: "deployment.apps/web rolled back",
  } as unknown as RunnerJob);
  jest
    .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
    .mockResolvedValue(clusterStatus());
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

function feedMarkdown(): string {
  expect(feed).toHaveBeenCalledTimes(1);
  return (feed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
    .feedInfoInMarkdown;
}

async function rollBack(
  commands: Array<Record<string, unknown>>,
): Promise<CommandPlanRollbackOutcome> {
  return CommandPlanExecutor.executeRollback({
    suggestion: suggestionWith(commands),
  });
}

function expectLeftForHuman(
  outcome: CommandPlanRollbackOutcome,
  runnerJobId: string = FORWARD_JOB_ID.toString(),
): void {
  // The undo is not run blind...
  expect(kubectlEnqueue).not.toHaveBeenCalled();
  // ...a human is told to check, with the command to run...
  const rollbackExecution: Record<string, unknown> = commandAt(0)[
    "rollbackExecution"
  ] as Record<string, unknown>;
  expect(rollbackExecution["status"]).toBe("Skipped");
  expect(rollbackExecution["errorMessage"]).toContain(
    "whether it changed the cluster is unknown",
  );
  expect(rollbackExecution["errorMessage"]).toContain(
    `undo it manually: ${KUBECTL_UNDO}`,
  );
  // ...and the rollback is not complete, so the follow-up round asks.
  expect(lastPlan()["rollbackStatus"]).toBe("Failed");
  expect(outcome.rollbackStatus).toBe(AiRemediationRollbackStatus.Failed);
  expect(outcome.leftForHuman).toBe(1);
  expect(outcome.summary).toContain("1 left for a human to undo");
  const markdown: string = feedMarkdown();
  expect(markdown).toContain("a human has to undo them");
  expect(markdown).toContain(KUBECTL_UNDO);
  // The forward record keeps what it said: the job id, Failed.
  expect(commandAt(0)["execution"]).toEqual(
    expect.objectContaining({
      status: "Failed",
      runnerJobId,
    }),
  );
}

function expectNothingOwed(outcome: CommandPlanRollbackOutcome): void {
  expect(kubectlEnqueue).not.toHaveBeenCalled();
  expect(commandAt(0)["rollbackExecution"]).toBeUndefined();
  expect(lastPlan()["rollbackStatus"]).toBe("NotApplicable");
  expect(outcome.rollbackStatus).toBe(
    AiRemediationRollbackStatus.NotApplicable,
  );
  expect(feed).not.toHaveBeenCalled();
}

describe("CommandPlanExecutor.executeRollback — a failed kubectl command that may have run", () => {
  it("leaves the undo of a job a Runner CLAIMED and went silent on for a human", async () => {
    jobRead.mockResolvedValue(
      forwardJob({
        status: RunnerJobStatus.TimedOut,
        claimedAt: new Date(),
        assignedAgentId: RUNNER_ID,
      }),
    );

    expectLeftForHuman(await rollBack([kubectlCommand()]));

    // The job is read with its claim columns, not guessed from the record.
    expect(jobRead).toHaveBeenCalledTimes(1);
    const read: Record<string, unknown> = jobRead.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect((read["id"] as ObjectID).toString()).toBe(FORWARD_JOB_ID.toString());
    expect(read["select"]).toEqual(
      expect.objectContaining({
        status: true,
        exitCode: true,
        output: true,
        errorMessage: true,
        claimedAt: true,
        startedAt: true,
        assignedAgentId: true,
      }),
    );
  });

  it("leaves the undo of a job the Runner STARTED (startedAt only) for a human", async () => {
    jobRead.mockResolvedValue(
      forwardJob({ status: RunnerJobStatus.TimedOut, startedAt: new Date() }),
    );

    expectLeftForHuman(await rollBack([kubectlCommand()]));
  });

  it("leaves the undo of a job still in flight for a human — it may yet run", async () => {
    jobRead.mockResolvedValue(
      forwardJob({ status: RunnerJobStatus.Running, claimedAt: new Date() }),
    );

    expectLeftForHuman(await rollBack([kubectlCommand()]));
  });

  it("leaves the undo for a human when the job row is gone", async () => {
    jobRead.mockResolvedValue(null as never);

    expectLeftForHuman(await rollBack([kubectlCommand()]));
  });

  it("leaves the undo for a human when the job row cannot be read, and logs it", async () => {
    jobRead.mockRejectedValue(new Error("database unavailable"));

    expectLeftForHuman(await rollBack([kubectlCommand()]));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not read whether command 1"),
    );
  });

  it("leaves the undo for a human when the record names no readable job id", async () => {
    expectLeftForHuman(
      await rollBack([
        kubectlCommand({
          execution: { status: "Failed", runnerJobId: "not-an-id" },
        }),
      ]),
      "not-an-id",
    );
    expect(jobRead).not.toHaveBeenCalled();
  });

  it("leaves the undo of a kubectl the Runner killed before it finished for a human — it ran, and may have applied its change", async () => {
    jobRead.mockResolvedValue(
      forwardJob({
        status: RunnerJobStatus.Failed,
        errorMessage: "Killed (timeout after 60s)",
        claimedAt: new Date(),
      }),
    );

    expectLeftForHuman(await rollBack([kubectlCommand()]));
  });

  it("rolls back a command whose job SUCCEEDED after its wait broke: the record is settled from the job, and the undo runs", async () => {
    jobRead.mockResolvedValue(
      forwardJob({
        status: RunnerJobStatus.Succeeded,
        exitCode: 0,
        output: "deployment.apps/web restarted",
        claimedAt: new Date(),
      }),
    );

    const outcome: CommandPlanRollbackOutcome = await rollBack([
      kubectlCommand({
        execution: {
          status: "Failed",
          runnerJobId: FORWARD_JOB_ID.toString(),
          errorMessage: "RunnerJob disappeared while waiting.",
        },
      }),
    ]);

    expect(kubectlEnqueue).toHaveBeenCalledTimes(1);
    expect(
      (kubectlEnqueue.mock.calls[0]![0] as Record<string, unknown>)["command"],
    ).toBe(KUBECTL_UNDO);
    expect(commandAt(0)["execution"]).toEqual(
      expect.objectContaining({
        status: "Succeeded",
        exitCode: 0,
        output: "deployment.apps/web restarted",
        runnerJobId: FORWARD_JOB_ID.toString(),
      }),
    );
    expect(lastPlan()["rollbackStatus"]).toBe("Completed");
    expect(outcome.rolledBack).toBe(1);
  });

  it("rolls back what it can and leaves the one that may have run for a human", async () => {
    jobRead.mockResolvedValue(
      forwardJob({
        status: RunnerJobStatus.TimedOut,
        claimedAt: new Date(),
        assignedAgentId: RUNNER_ID,
      }),
    );

    const outcome: CommandPlanRollbackOutcome = await rollBack([
      kubectlCommand({
        execution: {
          status: "Succeeded",
          exitCode: 0,
          runnerJobId: OTHER_FORWARD_JOB_ID.toString(),
        },
      }),
      kubectlCommand({ sequence: 2 }),
    ]);

    // Only the Failed command's job is read; the Succeeded one is undone.
    expect(jobRead).toHaveBeenCalledTimes(1);
    expect(kubectlEnqueue).toHaveBeenCalledTimes(1);
    expect(
      (commandAt(0)["rollbackExecution"] as Record<string, unknown>)["status"],
    ).toBe("Succeeded");
    expect(
      (commandAt(1)["rollbackExecution"] as Record<string, unknown>)["status"],
    ).toBe("Skipped");
    expect(outcome.rollbackStatus).toBe(AiRemediationRollbackStatus.Failed);
    expect(outcome.rolledBack).toBe(1);
    expect(outcome.leftForHuman).toBe(1);
  });
});

describe("CommandPlanExecutor.executeRollback — a failed kubectl command that owes no undo", () => {
  it("a job no Runner ever claimed never ran: nothing to undo", async () => {
    jobRead.mockResolvedValue(
      forwardJob({
        status: RunnerJobStatus.TimedOut,
        claimedAt: null,
        assignedAgentId: null,
        startedAt: null,
      }),
    );

    expectNothingOwed(await rollBack([kubectlCommand()]));
  });

  it("a job refused before kubectl was spawned never ran: nothing to undo", async () => {
    jobRead.mockResolvedValue(
      forwardJob({
        status: RunnerJobStatus.Failed,
        errorMessage:
          'Refused by the Runner: "kubectl rollout restart deployment/web -n web" would change namespace "web", outside the namespaces this Runner lets OneUptime AI change.',
        claimedAt: new Date(),
      }),
    );

    expectNothingOwed(await rollBack([kubectlCommand()]));
  });

  it("a kubectl that finished with an exit code reported its failure: nothing to undo", async () => {
    jobRead.mockResolvedValue(
      forwardJob({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        output:
          '[stdout]\n\n[stderr]\nError from server (NotFound): deployments.apps "web" not found',
        claimedAt: new Date(),
      }),
    );

    expectNothingOwed(await rollBack([kubectlCommand()]));
  });

  // Negative controls: nothing else is read.
  it("a command without a rollbackCommand is not read", async () => {
    expectNothingOwed(
      await rollBack([kubectlCommand({ rollbackCommand: undefined })]),
    );
    expect(jobRead).not.toHaveBeenCalled();
  });

  it("a Bash command recorded as failed is not read", async () => {
    expectNothingOwed(
      await rollBack([
        kubectlCommand({
          stepType: "Bash",
          command: "systemctl restart nginx",
          rollbackCommand: "systemctl stop nginx",
          kubernetesClusterId: undefined,
          kubernetesClusterNameSnapshot: undefined,
          kubectlTier: undefined,
        }),
      ]),
    );
    expect(jobRead).not.toHaveBeenCalled();
    expect(bashEnqueue).not.toHaveBeenCalled();
  });

  it("a failed kubectl command with no job id never reached a Runner and is not read", async () => {
    expectNothingOwed(
      await rollBack([
        kubectlCommand({
          execution: {
            status: "Failed",
            errorMessage: "Refused at execution time: x.",
          },
        }),
      ]),
    );
    expect(jobRead).not.toHaveBeenCalled();
  });
});
