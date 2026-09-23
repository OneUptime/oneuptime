import RemediationCommandToolkit, {
  MAX_AUTO_EXECUTED_COMMANDS_PER_RUN,
} from "../../../../Server/Utils/AI/Remediation/RemediationCommandTools";
import { ObservabilityAssistantExtraTool } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import AIRunService from "../../../../Server/Services/AIRunService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import RunnerService from "../../../../Server/Services/RunnerService";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import logger from "../../../../Server/Utils/Logger";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — what an unattended run makes of an inline kubectl
 * change's job once it ends (PR #3953 review, known follow-up 1):
 *
 * - the job is read the way every kubectl job is read
 *   (KubectlJobRunner.readFinishedJob: getRunState, with readClaimState for
 *   a TimedOut job), never by a copy of that reading;
 * - kubectl that certainly never RAN (NotRun: no Runner claimed the job,
 *   the enqueue refused it, or the Runner refused it before spawning
 *   kubectl) is a FAILED tool call: no citation, not an executed command
 *   (so the round never settles AutoExecuted or waits on verification for
 *   it), and off the durable record — its step id is never reused and it
 *   counts toward the run's command budget;
 * - a job a Runner took whose result never came back — or whose wait broke
 *   — MAY have run kubectl (Unknown): it keeps its job id and rollback on
 *   the record and among the executed commands, its citation says the
 *   result is unknown, and the model is told to check with a read before
 *   it reissues anything;
 * - the cluster's "Last error" records a success, and a failure only when
 *   it is about the cluster's ACCESS (never claimed, refused, timed out,
 *   unauthorized, unreachable) — never a kubectl that ran and failed on a
 *   name the model got wrong.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const SAFE_WRITE: string = "kubectl rollout restart deployment/web -n web";
const SAFE_UNDO: string = "kubectl rollout undo deployment/web -n web";

function cluster(): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID.toString(),
    clusterName: "prod-us",
    clusterIdentifier: "prod-us",
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

let enqueueKubectl: jest.SpyInstance;
let poll: jest.SpyInstance;
let claimRead: jest.SpyInstance;
let recordOutcome: jest.SpyInstance;
let persisted: Array<JSONObject>;

function jobRow(overrides: Record<string, unknown>): RunnerJob {
  const id: ObjectID = ObjectID.generate();
  return {
    id,
    _id: id.toString(),
    payload: { displayCommand: SAFE_WRITE },
    ...overrides,
  } as unknown as RunnerJob;
}

beforeEach(() => {
  persisted = [];
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockResolvedValue({
      id: SUGGESTION_ID,
      _id: SUGGESTION_ID.toString(),
      status: AutoRemediationSuggestionStatus.Planning,
    } as unknown as AutoRemediationSuggestion);
  jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockImplementation(async (args: unknown): Promise<never> => {
      persisted.push(
        (args as { data: { commandPlan: JSONObject } }).data.commandPlan,
      );
      return undefined as never;
    });
  jest
    .spyOn(RunnerJobService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  enqueueKubectl = jest
    .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
    .mockImplementation(async (): Promise<RunnerJob> => {
      return jobRow({ status: RunnerJobStatus.Pending });
    });
  poll = jest.spyOn(RunnerJobService, "pollUntilTerminal");
  // Each test says what the job's claim read returns; never the database.
  claimRead = jest
    .spyOn(RunnerJobService, "findOneById")
    .mockResolvedValue(null as never);
  jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(undefined as never);
  recordOutcome = jest
    .spyOn(KubernetesClusterAiAccessService, "recordCommandOutcome")
    .mockResolvedValue(undefined);
  jest
    .spyOn(RunnerService, "getOnlineAiCommandRunnersForProject")
    .mockResolvedValue([]);
  jest
    .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
    .mockResolvedValue(cluster());
  jest
    .spyOn(Semaphore, "lock")
    .mockResolvedValue({ id: "cluster-lock" } as unknown as SemaphoreMutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  jest
    .spyOn(AutoRemediationSuggestionService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest.spyOn(AutoRemediationSuggestionService, "findBy").mockResolvedValue([]);
  jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function toolkit(): RemediationCommandToolkit {
  return new RemediationCommandToolkit({
    projectId: PROJECT_ID,
    aiRunId: RUN_ID,
    suggestionId: SUGGESTION_ID,
    mode: "FullAuto",
    allowlistPatterns: [],
    allowedRunnerIds: [],
    clusterTargets: [cluster()],
    proposesRefusedCommands: true,
  });
}

function execute(
  target: RemediationCommandToolkit,
  command: string = SAFE_WRITE,
): Promise<ToolCallOutcome> {
  const tool: ObservabilityAssistantExtraTool | undefined = target
    .buildTools()
    .find((candidate: ObservabilityAssistantExtraTool) => {
      return candidate.definition.name === "execute_remediation_command";
    });
  return tool!.execute({
    stepType: "Kubectl",
    kubernetesClusterId: CLUSTER_ID.toString(),
    command,
    rationale: "web pods are crash-looping after a config change",
    expectedEffect: "fresh pods come up Running",
    rollbackCommand: SAFE_UNDO,
  } as JSONObject);
}

function lastPersistedCommands(): Array<Record<string, unknown>> {
  return persisted[persisted.length - 1]!["commands"] as unknown as Array<
    Record<string, unknown>
  >;
}

function enqueuedStepIds(): Array<string> {
  return enqueueKubectl.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as { stepId: string }).stepId;
  });
}

describe("RemediationCommandToolkit — an inline kubectl change whose job never reached kubectl", () => {
  it("a Runner refusal before spawning kubectl is a failed tool call: no citation, not executed, off the record — and it is an access failure", async () => {
    poll.mockResolvedValue(
      jobRow({
        status: RunnerJobStatus.Failed,
        errorMessage:
          'Refused by the Runner: "kubectl rollout restart deployment/web -n web" would change namespace "web", outside the namespaces this Runner lets OneUptime AI change.',
      }),
    );
    const target: RemediationCommandToolkit = toolkit();

    const outcome: ToolCallOutcome = await execute(target);

    expect(outcome.success).toBe(false);
    // A failed tool call carries no result, so nothing is cited.
    expect(outcome.result).toBeUndefined();
    expect(outcome.textForLlm).toContain("did NOT run on cluster");
    expect(outcome.textForLlm).toContain("Refused by the Runner");
    expect(outcome.textForLlm).toContain("Nothing changed on the cluster");
    expect(target.getExecutedCommands()).toHaveLength(0);
    // The Pending record written before the enqueue is taken back off.
    expect(lastPersistedCommands()).toHaveLength(0);
    expect(recordOutcome).toHaveBeenCalledTimes(1);
    expect(recordOutcome.mock.calls[0]![0]).toMatchObject({
      succeeded: false,
    });
  });

  it("a job no Runner claimed is a failed tool call that tells the model to stop sending to this cluster", async () => {
    poll.mockResolvedValue(
      jobRow({
        status: RunnerJobStatus.TimedOut,
        errorMessage:
          "No Runner picked up this step in time. Check that a Runner is connected, then try again.",
      }),
    );
    claimRead.mockResolvedValue(
      jobRow({ claimedAt: null, assignedAgentId: null }),
    );
    const target: RemediationCommandToolkit = toolkit();

    const outcome: ToolCallOutcome = await execute(target);

    expect(outcome.success).toBe(false);
    expect(outcome.result).toBeUndefined();
    expect(outcome.textForLlm).toContain(
      "The cluster's Runner did not pick up this kubectl command",
    );
    expect(outcome.textForLlm).toContain(
      "Do NOT send more commands to this cluster in this run",
    );
    // Runbook advice never reaches the model or the cluster's last error.
    expect(outcome.textForLlm).not.toContain("try again");
    expect(target.getExecutedCommands()).toHaveLength(0);
    expect(recordOutcome).toHaveBeenCalledTimes(1);
    expect(
      (recordOutcome.mock.calls[0]![0] as { errorMessage: string })
        .errorMessage,
    ).not.toContain("try again");
  });

  it("never reuses a never-ran command's step id, and counts it toward the run's command budget", async () => {
    poll
      .mockResolvedValueOnce(
        jobRow({
          status: RunnerJobStatus.Failed,
          errorMessage: "Refused by the Runner: kubectl could not be started.",
        }),
      )
      .mockResolvedValue(
        jobRow({
          status: RunnerJobStatus.Succeeded,
          exitCode: 0,
          output: "deployment.apps/web restarted",
        }),
      );
    const target: RemediationCommandToolkit = toolkit();

    expect((await execute(target)).success).toBe(false);
    const second: ToolCallOutcome = await execute(target);

    expect(second.success).toBe(true);
    expect(enqueuedStepIds()).toEqual(["ai-command-1", "ai-command-2"]);
    expect(target.getExecutedCommands()).toHaveLength(1);
    expect(target.getExecutedCommands()[0]!.sequence).toBe(2);
    expect(lastPersistedCommands()).toHaveLength(1);

    for (
      let sent: number = 2;
      sent < MAX_AUTO_EXECUTED_COMMANDS_PER_RUN;
      sent++
    ) {
      expect((await execute(target)).success).toBe(true);
    }

    const overBudget: ToolCallOutcome = await execute(target);
    expect(overBudget.success).toBe(false);
    expect(overBudget.textForLlm).toContain("command budget");
    expect(enqueueKubectl).toHaveBeenCalledTimes(
      MAX_AUTO_EXECUTED_COMMANDS_PER_RUN,
    );
  });
});

/*
 * A Runner took the job and no result came back: KubectlJobRunner's
 * Unknown run state. For a write that means "may have run" — never "did
 * not run": the command keeps its job id and its place among the executed
 * commands (so verification judges it and the rollback arm reads its job
 * again), and the model is told to check with a read before it reissues
 * anything.
 */
describe("RemediationCommandToolkit — an inline kubectl change that may have run", () => {
  function expectMayHaveRun(
    target: RemediationCommandToolkit,
    outcome: ToolCallOutcome,
  ): void {
    // The command reached a Runner: its call resolves and is on the record.
    expect(outcome.success).toBe(true);
    expect(target.getExecutedCommands()).toHaveLength(1);
    const execution: Record<string, unknown> = target.getExecutedCommands()[0]!
      .execution as unknown as Record<string, unknown>;
    expect(execution["status"]).toBe("Failed");
    expect(execution["runnerJobId"]).toEqual(expect.any(String));
    const recorded: Array<Record<string, unknown>> = lastPersistedCommands();
    expect(recorded).toHaveLength(1);
    expect(
      (recorded[0]!["execution"] as Record<string, unknown>)["runnerJobId"],
    ).toBe(execution["runnerJobId"]);
    // The rollback stays with it, for the rollback arm to judge.
    expect(recorded[0]!["rollbackCommand"]).toBe(SAFE_UNDO);

    // The model is told the result is unknown, and to check before resending.
    expect(outcome.textForLlm).toContain("RESULT UNKNOWN");
    expect(outcome.textForLlm).toContain("MAY have run");
    expect(outcome.textForLlm).toContain(
      "Before you reissue this command, or run anything that depends on it, check with a read",
    );
    expect(outcome.textForLlm).toContain("Do NOT resend it blindly");
    expect(outcome.textForLlm).not.toContain("did NOT run");
    expect(outcome.textForLlm).not.toContain("Nothing changed on the cluster");
    expect(outcome.textForLlm).not.toContain("try again");
    // Its citation says what is known: sent, result unknown.
    expect(outcome.result?.citationLabel).toBe(
      `Sent to cluster "prod-us", result unknown: ${SAFE_WRITE}`,
    );
  }

  it("a job a Runner CLAIMED and then went silent on may have run: it stays executed, with its job id, and the model is told to check before reissuing", async () => {
    /*
     * Changed in the round-three review: this was cited "Executed on
     * cluster" and described as an ordinary failure. The remediation lane
     * now reads the job through KubectlJobRunner.readFinishedJob, like the
     * investigation lane, and a lost result is Unknown.
     */
    poll.mockResolvedValue(
      jobRow({
        status: RunnerJobStatus.TimedOut,
        errorMessage:
          "No Runner picked up this step in time. Check that a Runner is connected, then try again.",
      }),
    );
    // Claimed, but no startedAt yet: kubectl may well have run.
    claimRead.mockResolvedValue(
      jobRow({ claimedAt: new Date(), assignedAgentId: RUNNER_ID }),
    );
    const target: RemediationCommandToolkit = toolkit();

    const outcome: ToolCallOutcome = await execute(target);

    expectMayHaveRun(target, outcome);
    // The kubectl-worded timeout reason, never the runbook one.
    expect(outcome.textForLlm).toContain(
      "The Runner took this kubectl command but did not report a result in time",
    );
    expect(target.getExecutedCommands()[0]!.execution?.errorMessage).toContain(
      "Whether it ran, and what it did, is unknown.",
    );
    // A timeout is about the access.
    expect(recordOutcome).toHaveBeenCalledTimes(1);
  });

  it("reads the claim through KubectlJobRunner.readClaimState — claimedAt, startedAt and assignedAgentId", async () => {
    poll.mockResolvedValue(jobRow({ status: RunnerJobStatus.TimedOut }));
    claimRead.mockResolvedValue(jobRow({ claimedAt: new Date() }));

    await execute(toolkit());

    expect(claimRead).toHaveBeenCalledTimes(1);
    expect(
      (claimRead.mock.calls[0]![0] as { select: Record<string, boolean> })
        .select,
    ).toEqual(
      expect.objectContaining({
        claimedAt: true,
        startedAt: true,
        assignedAgentId: true,
      }),
    );
  });

  it("a job the Runner started (startedAt) with no claim columns left may have run too", async () => {
    poll.mockResolvedValue(jobRow({ status: RunnerJobStatus.TimedOut }));
    claimRead.mockResolvedValue(
      jobRow({ claimedAt: null, assignedAgentId: null, startedAt: new Date() }),
    );
    const target: RemediationCommandToolkit = toolkit();

    expectMayHaveRun(target, await execute(target));
  });

  it("a claim state that cannot be read may have run — never 'did not run'", async () => {
    poll.mockResolvedValue(jobRow({ status: RunnerJobStatus.TimedOut }));
    claimRead.mockRejectedValue(new Error("db down"));
    const target: RemediationCommandToolkit = toolkit();

    const outcome: ToolCallOutcome = await execute(target);

    expectMayHaveRun(target, outcome);
    expect(outcome.textForLlm).toContain(
      "whether a Runner picked it up could not be read",
    );
  });

  it("a job row that is gone when its claim is read back may have run", async () => {
    poll.mockResolvedValue(jobRow({ status: RunnerJobStatus.TimedOut }));
    claimRead.mockResolvedValue(null as never);
    const target: RemediationCommandToolkit = toolkit();

    expectMayHaveRun(target, await execute(target));
  });

  it("a wait that breaks after the job was enqueued may have run: the job id stays, and the model checks before reissuing", async () => {
    poll.mockRejectedValue(new Error("RunnerJob disappeared while waiting."));
    const target: RemediationCommandToolkit = toolkit();

    const outcome: ToolCallOutcome = await execute(target);

    expectMayHaveRun(target, outcome);
    expect(outcome.textForLlm).toContain(
      "Waiting for its result failed: RunnerJob disappeared while waiting.",
    );
    expect(target.getExecutedCommands()[0]!.execution?.errorMessage).toBe(
      "RunnerJob disappeared while waiting.",
    );
  });

  it("without a rollbackCommand, the model is not promised an undo", async () => {
    poll.mockResolvedValue(jobRow({ status: RunnerJobStatus.TimedOut }));
    claimRead.mockResolvedValue(jobRow({ claimedAt: new Date() }));
    const target: RemediationCommandToolkit = toolkit();
    const tool: ObservabilityAssistantExtraTool = target
      .buildTools()
      .find((candidate: ObservabilityAssistantExtraTool) => {
        return candidate.definition.name === "execute_remediation_command";
      })!;

    const outcome: ToolCallOutcome = await tool.execute({
      stepType: "Kubectl",
      kubernetesClusterId: CLUSTER_ID.toString(),
      command: SAFE_WRITE,
      rationale: "web pods are crash-looping after a config change",
      expectedEffect: "fresh pods come up Running",
    } as JSONObject);

    expect(outcome.textForLlm).toContain("RESULT UNKNOWN");
    expect(outcome.textForLlm).not.toContain("rollbackCommand");
    expect(target.getExecutedCommands()).toHaveLength(1);
  });

  // Negative control: a kubectl that ran and failed is an ordinary outcome.
  it("a kubectl that ran and exited non-zero is described as run, not unknown", async () => {
    poll.mockResolvedValue(
      jobRow({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        output:
          '[stdout]\n\n[stderr]\nError from server (NotFound): deployments.apps "web" not found',
        errorMessage: "kubectl exited with code 1",
      }),
    );
    const target: RemediationCommandToolkit = toolkit();

    const outcome: ToolCallOutcome = await execute(target);

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain("FAILED (exit code: 1");
    expect(outcome.textForLlm).not.toContain("RESULT UNKNOWN");
    // kubectl finished and said why: nothing to check before a resend.
    expect(outcome.textForLlm).not.toContain("kubectl did not finish");
    expect(outcome.result?.citationLabel).toBe(
      `Executed on cluster "prod-us": ${SAFE_WRITE}`,
    );
  });

  /*
   * The Runner killed the kubectl it spawned: it ran (cited, executed), but
   * it never finished, so it may have applied the change before it was
   * stopped — the model checks before it resends it.
   */
  it("a kubectl the Runner killed at its timeout ran, and the model is told to check before reissuing", async () => {
    poll.mockResolvedValue(
      jobRow({
        status: RunnerJobStatus.Failed,
        errorMessage: "Killed (timeout after 60s)",
      }),
    );
    const target: RemediationCommandToolkit = toolkit();

    const outcome: ToolCallOutcome = await execute(target);

    expect(outcome.success).toBe(true);
    expect(outcome.result?.citationLabel).toBe(
      `Executed on cluster "prod-us": ${SAFE_WRITE}`,
    );
    expect(outcome.textForLlm).toContain("FAILED (exit code: n/a");
    expect(outcome.textForLlm).toContain("kubectl did not finish");
    expect(outcome.textForLlm).toContain("Do NOT resend it blindly");
    expect(outcome.textForLlm).not.toContain("RESULT UNKNOWN");
    expect(outcome.textForLlm).not.toContain("did NOT run");
    expect(target.getExecutedCommands()).toHaveLength(1);
  });
});

describe("RemediationCommandToolkit — an inline kubectl change the enqueue refused", () => {
  it("is a failed tool call off the record: no job exists, so nothing ran", async () => {
    enqueueKubectl.mockRejectedValue(
      new Error(
        'cluster "prod-us" no longer allows AI remediation: AI remediation is turned off for this cluster',
      ),
    );
    const target: RemediationCommandToolkit = toolkit();

    const outcome: ToolCallOutcome = await execute(target);

    expect(outcome.success).toBe(false);
    expect(outcome.result).toBeUndefined();
    expect(outcome.textForLlm).toContain("did NOT run on cluster");
    expect(outcome.textForLlm).toContain("no longer allows AI remediation");
    expect(outcome.textForLlm).toContain("nothing was recorded as executed");
    expect(outcome.textForLlm).not.toContain("FAILED before completion");
    expect(target.getExecutedCommands()).toHaveLength(0);
    // The Pending record written before the enqueue is taken back off.
    expect(lastPersistedCommands()).toHaveLength(0);
    // Nothing waited on, nothing read, nothing recorded on the cluster.
    expect(poll).not.toHaveBeenCalled();
    expect(recordOutcome).not.toHaveBeenCalled();
  });

  it("its step id is never reused and it counts toward the command budget", async () => {
    enqueueKubectl.mockRejectedValueOnce(new Error("queue unavailable"));
    poll.mockResolvedValue(
      jobRow({
        status: RunnerJobStatus.Succeeded,
        exitCode: 0,
        output: "deployment.apps/web restarted",
      }),
    );
    const target: RemediationCommandToolkit = toolkit();

    expect((await execute(target)).success).toBe(false);
    expect((await execute(target)).success).toBe(true);

    expect(enqueuedStepIds()).toEqual(["ai-command-1", "ai-command-2"]);
    expect(target.getExecutedCommands()[0]!.sequence).toBe(2);
  });
});

describe("RemediationCommandToolkit — the cluster's last error records only access failures", () => {
  it("a kubectl that ran and failed on a wrong name is a real outcome, but not the cluster's last error", async () => {
    poll.mockResolvedValue(
      jobRow({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        output:
          '[stdout]\n\n[stderr]\nError from server (NotFound): deployments.apps "web" not found',
        errorMessage: "kubectl exited with code 1",
      }),
    );
    const target: RemediationCommandToolkit = toolkit();

    const outcome: ToolCallOutcome = await execute(target);

    expect(outcome.success).toBe(true);
    expect(target.getExecutedCommands()).toHaveLength(1);
    expect(recordOutcome).not.toHaveBeenCalled();
  });

  it("a kubectl the API server refused (Forbidden) is an access failure and is recorded", async () => {
    poll.mockResolvedValue(
      jobRow({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        output:
          '[stdout]\n\n[stderr]\nError from server (Forbidden): deployments.apps "web" is forbidden: User "system:serviceaccount:oneuptime:agent" cannot patch resource',
        errorMessage: "kubectl exited with code 1",
      }),
    );
    const target: RemediationCommandToolkit = toolkit();

    await execute(target);

    expect(recordOutcome).toHaveBeenCalledTimes(1);
    expect(recordOutcome.mock.calls[0]![0]).toMatchObject({
      succeeded: false,
    });
  });

  it("negative control: a success is recorded, proving the access works", async () => {
    poll.mockResolvedValue(
      jobRow({
        status: RunnerJobStatus.Succeeded,
        exitCode: 0,
        output: "deployment.apps/web restarted",
      }),
    );
    const target: RemediationCommandToolkit = toolkit();

    const outcome: ToolCallOutcome = await execute(target);

    expect(outcome.success).toBe(true);
    expect(recordOutcome).toHaveBeenCalledTimes(1);
    expect(recordOutcome.mock.calls[0]![0]).toMatchObject({
      succeeded: true,
    });
  });
});
