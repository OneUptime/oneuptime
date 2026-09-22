import KubectlJobRunner, {
  KubectlJobOutcome,
  KubectlTerminalJobFacts,
} from "../../../../Server/Utils/AI/ClusterAccess/KubectlJobRunner";
import AIRunService from "../../../../Server/Services/AIRunService";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import { DEFAULT_KUBECTL_TIMEOUT_MS } from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * KubectlJobRunner decides three things about a finished kubectl job that
 * the rest of the product trusts:
 *
 * - did kubectl actually RUN on the cluster (executed)? Only then is the
 *   command evidence the investigation may cite and the panel may count;
 * - was the job never claimed (claimTimedOut)? That is the one signal that
 *   the cluster's Runner is unreachable, and it is read from the job row,
 *   never guessed from pollUntilTerminal's reason text;
 * - is a failure about the cluster's AI ACCESS? Only those become the
 *   cluster's "Last error" on its AI page. A pod the model guessed wrong
 *   (NotFound) or a bad flag says nothing about the Runner and must not
 *   send the operator debugging access that works.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const JOB_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

const RUNBOOK_CLAIM_REASON: string =
  "No runbook agent picked up this step before the wait window expired. The agent may be offline — check that it is running and reachable, then try again.";
const RUNBOOK_EXECUTION_REASON: string =
  "This step ran longer than the allowed execution window. Increase the timeout on the step or make the script complete faster.";

function stderr(text: string): string {
  return `[stderr]\n${text}`;
}

function fakeJob(overrides: Partial<Record<string, unknown>> = {}): RunnerJob {
  return {
    id: JOB_ID,
    _id: JOB_ID.toString(),
    status: RunnerJobStatus.Succeeded,
    exitCode: 0,
    output: "[stdout]\nNAME   READY\nweb-1  1/1",
    payload: { displayCommand: "kubectl get pods -n web" },
    ...overrides,
  } as unknown as RunnerJob;
}

describe("KubectlJobRunner.didKubectlRun", () => {
  it.each<[string, KubectlTerminalJobFacts, boolean]>([
    ["a job that succeeded", { status: RunnerJobStatus.Succeeded }, true],
    [
      "kubectl that exited non-zero",
      { status: RunnerJobStatus.Failed, exitCode: 1, output: "" },
      true,
    ],
    [
      "kubectl the Runner killed at its timeout",
      {
        status: RunnerJobStatus.Failed,
        errorMessage: "Killed (timeout 30000ms)",
        output: "",
      },
      true,
    ],
    [
      "a failure that still produced kubectl output",
      {
        status: RunnerJobStatus.Failed,
        errorMessage: "Exit code ?",
        output: stderr("error: unexpected EOF"),
      },
      true,
    ],
    [
      "a job the Runner reported running before it went silent",
      { status: RunnerJobStatus.TimedOut, wasStarted: true },
      true,
    ],
    [
      "a job no Runner ever claimed",
      {
        status: RunnerJobStatus.TimedOut,
        wasStarted: false,
        errorMessage: RUNBOOK_CLAIM_REASON,
      },
      false,
    ],
    [
      "a claim-time refusal by the server",
      {
        status: RunnerJobStatus.Failed,
        output: "",
        errorMessage:
          "The credential this step references is not available to this Runner.",
      },
      false,
    ],
    [
      "a refusal by the Runner before it spawned kubectl",
      {
        status: RunnerJobStatus.Failed,
        output: "",
        errorMessage: "Refused by the Runner: --kubeconfig is not allowed.",
      },
      false,
    ],
    [
      "a Runner without kubectl",
      {
        status: RunnerJobStatus.Failed,
        output: "",
        errorMessage: "kubectl is not installed on this Runner.",
      },
      false,
    ],
    [
      "a cancelled job",
      { status: RunnerJobStatus.Cancelled, output: "" },
      false,
    ],
  ])("%s", (_label: string, facts: KubectlTerminalJobFacts, ran: boolean) => {
    expect(KubectlJobRunner.didKubectlRun(facts)).toBe(ran);
  });

  it("does not trust the reason text of a TimedOut job", () => {
    // The execution-window reason reads like kubectl ran; the row decides.
    expect(
      KubectlJobRunner.didKubectlRun({
        status: RunnerJobStatus.TimedOut,
        errorMessage: RUNBOOK_EXECUTION_REASON,
        wasStarted: false,
      }),
    ).toBe(false);
  });
});

describe("KubectlJobRunner.isAccessFailure", () => {
  it.each<[string, KubectlTerminalJobFacts]>([
    [
      "an unclaimed job",
      { status: RunnerJobStatus.TimedOut, wasStarted: false },
    ],
    [
      "a Runner that went silent mid-run",
      { status: RunnerJobStatus.TimedOut, wasStarted: true },
    ],
    [
      "a Runner refusal",
      {
        status: RunnerJobStatus.Failed,
        output: "",
        errorMessage:
          'Refused by the Runner: this kubectl command targets cluster "prod-us" but this Runner is the Kubernetes agent of cluster "staging".',
      },
    ],
    [
      "a missing kubectl",
      {
        status: RunnerJobStatus.Failed,
        output: "",
        errorMessage: "kubectl is not installed on this Runner.",
      },
    ],
    [
      "a credential the Runner could not prepare",
      {
        status: RunnerJobStatus.Failed,
        output: "",
        errorMessage: "Could not prepare the Kubernetes credential: EACCES",
      },
    ],
    [
      "kubectl killed at its timeout",
      {
        status: RunnerJobStatus.Failed,
        output: "",
        errorMessage: "Killed (timeout 30000ms)",
      },
    ],
    [
      "RBAC Forbidden",
      {
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        errorMessage: "Exit code 1",
        output: stderr(
          'Error from server (Forbidden): pods is forbidden: User "system:serviceaccount:oneuptime:ai-runner" cannot list resource "pods" in API group "" in the namespace "web"',
        ),
      },
    ],
    [
      "an expired token",
      {
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        errorMessage: "Exit code 1",
        output: stderr(
          "error: You must be logged in to the server (Unauthorized)",
        ),
      },
    ],
    [
      "an unreachable API server",
      {
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        errorMessage: "Exit code 1",
        output: stderr(
          "Unable to connect to the server: dial tcp 10.0.0.1:443: i/o timeout",
        ),
      },
    ],
    [
      "a refused connection",
      {
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        errorMessage: "Exit code 1",
        output: stderr(
          "The connection to the server localhost:8080 was refused - did you specify the right host or port?",
        ),
      },
    ],
    [
      "an untrusted certificate",
      {
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        errorMessage: "Exit code 1",
        output: stderr(
          "Unable to connect to the server: x509: certificate signed by unknown authority",
        ),
      },
    ],
  ])(
    "treats %s as an access failure",
    (_label: string, facts: KubectlTerminalJobFacts) => {
      expect(KubectlJobRunner.isAccessFailure(facts)).toBe(true);
    },
  );

  it.each<[string, string]>([
    ["NotFound", 'Error from server (NotFound): pods "web-7d9f-abc" not found'],
    [
      "BadRequest",
      'Error from server (BadRequest): container "web" in pod "web-1" is waiting to start: ContainerCreating',
    ],
    [
      "an unknown resource type",
      'error: the server doesn\'t have a resource type "deploymnt"',
    ],
    ["an unknown flag", "error: unknown flag: --tial"],
    [
      "an invalid selector",
      'error: unable to parse requirement: invalid label key "app=="',
    ],
  ])(
    "treats %s (the model's command) as not an access failure",
    (_label: string, message: string) => {
      expect(
        KubectlJobRunner.isAccessFailure({
          status: RunnerJobStatus.Failed,
          exitCode: 1,
          errorMessage: "Exit code 1",
          output: stderr(message),
        }),
      ).toBe(false);
    },
  );

  it("never reads cluster output (stdout) as an access error", () => {
    // Pod logs say "connection refused" all the time.
    expect(
      KubectlJobRunner.isAccessFailure({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        errorMessage: "Exit code 1",
        output:
          "[stdout]\n2026-09-22T10:00:00Z dial tcp 10.0.0.9:5432: connection refused\n[stderr]\nerror: container web is not valid for pod web-1",
      }),
    ).toBe(false);
  });

  it("is never an access failure when the command succeeded", () => {
    expect(
      KubectlJobRunner.isAccessFailure({
        status: RunnerJobStatus.Succeeded,
        exitCode: 0,
        output: stderr("Warning: Unable to connect to the server"),
      }),
    ).toBe(false);
  });
});

describe("KubectlJobRunner.run", () => {
  let recordOutcome: jest.SpyInstance;
  let poll: jest.SpyInstance;
  let claimRead: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(AIRunService, "updateOneBy")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
      .mockResolvedValue(fakeJob());
    recordOutcome = jest
      .spyOn(KubernetesClusterAiAccessService, "recordCommandOutcome")
      .mockResolvedValue(undefined);
    poll = jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue(fakeJob());
    claimRead = jest
      .spyOn(RunnerJobService, "findOneById")
      .mockResolvedValue({ _id: JOB_ID.toString() } as unknown as RunnerJob);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function run(claimTimeoutInMs?: number): Promise<KubectlJobOutcome> {
    return KubectlJobRunner.run({
      projectId: PROJECT_ID,
      aiRunId: RUN_ID,
      origin: RunnerJobOrigin.AiInvestigation,
      kubernetesClusterId: CLUSTER_ID,
      targetRunnerId: RUNNER_ID,
      command: "kubectl get pods -n web",
      stepId: "ai-investigation-kubectl-1",
      timeoutInMs: DEFAULT_KUBECTL_TIMEOUT_MS,
      ...(claimTimeoutInMs !== undefined ? { claimTimeoutInMs } : {}),
    });
  }

  it("records a success, which proves the access and clears the last error", async () => {
    const outcome: KubectlJobOutcome = await run();

    expect(outcome.succeeded).toBe(true);
    expect(outcome.executed).toBe(true);
    expect(outcome.claimTimedOut).toBe(false);
    expect(outcome.isAccessFailure).toBe(false);
    expect(recordOutcome).toHaveBeenCalledWith({
      clusterId: CLUSTER_ID,
      succeeded: true,
      errorMessage: undefined,
    });
    expect(claimRead).not.toHaveBeenCalled();
  });

  /*
   * The finding's scenario: the model describes a pod that has since been
   * replaced. The cluster's AI page must not now say "Last error: Exit
   * code 1" next to "Connected".
   */
  it("does not record a NotFound the model's command caused", async () => {
    poll.mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        errorMessage: "Exit code 1",
        output: stderr(
          'Error from server (NotFound): pods "web-7d9f-abc" not found',
        ),
      }),
    );

    const outcome: KubectlJobOutcome = await run();

    expect(outcome.succeeded).toBe(false);
    expect(outcome.executed).toBe(true);
    expect(outcome.isAccessFailure).toBe(false);
    expect(recordOutcome).not.toHaveBeenCalled();
    // The model still reads the failure.
    expect(KubectlJobRunner.describeForLlm(outcome)).toContain("FAILED");
  });

  it("records an RBAC refusal from the API server", async () => {
    poll.mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        errorMessage: "Exit code 1",
        output: stderr(
          'Error from server (Forbidden): events is forbidden: User "system:serviceaccount:oneuptime:ai-runner" cannot list resource "events"',
        ),
      }),
    );

    const outcome: KubectlJobOutcome = await run();

    expect(outcome.isAccessFailure).toBe(true);
    expect(recordOutcome).toHaveBeenCalledWith({
      clusterId: CLUSTER_ID,
      succeeded: false,
      errorMessage: "Exit code 1",
    });
  });

  it("records a Runner refusal", async () => {
    poll.mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.Failed,
        exitCode: undefined,
        output: "",
        errorMessage:
          "Refused by the Runner: this Runner was installed read-only (ONEUPTIME_KUBECTL_ALLOW_WRITES=false).",
      }),
    );

    const outcome: KubectlJobOutcome = await run();

    expect(outcome.executed).toBe(false);
    expect(outcome.claimTimedOut).toBe(false);
    expect(recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        succeeded: false,
        errorMessage: expect.stringContaining("Refused by the Runner"),
      }),
    );
  });

  it("reports an unclaimed job in kubectl terms, reads the claim from the row and records it", async () => {
    poll.mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.TimedOut,
        exitCode: undefined,
        output: "",
        errorMessage: RUNBOOK_CLAIM_REASON,
      }),
    );

    const outcome: KubectlJobOutcome = await run(10_000);

    expect(outcome.executed).toBe(false);
    expect(outcome.claimTimedOut).toBe(true);
    expect(outcome.isAccessFailure).toBe(true);
    expect(claimRead).toHaveBeenCalledWith(
      expect.objectContaining({
        id: JOB_ID,
        props: { isRoot: true },
      }),
    );
    expect(outcome.errorMessage).toBe(
      "The cluster's Runner did not pick up this kubectl command within 10s — it may be offline, restarting or busy with other work. Nothing was run on the cluster.",
    );

    const recorded: string = (
      recordOutcome.mock.calls[0]![0] as { errorMessage: string }
    ).errorMessage;
    const forModel: string = KubectlJobRunner.describeForLlm(outcome);
    for (const text of [recorded, forModel]) {
      expect(text).not.toContain("runbook");
      expect(text).not.toContain("step");
      expect(text).not.toContain("try again");
    }
    expect(recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ succeeded: false }),
    );
  });

  it("reports a job a Runner claimed and lost as ran, not as unreachable", async () => {
    poll.mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.TimedOut,
        exitCode: undefined,
        output: "",
        errorMessage: RUNBOOK_EXECUTION_REASON,
      }),
    );
    claimRead.mockResolvedValue({
      _id: JOB_ID.toString(),
      claimedAt: new Date("2026-09-22T10:00:00.000Z"),
      assignedAgentId: RUNNER_ID,
      startedAt: new Date("2026-09-22T10:00:02.000Z"),
    } as unknown as RunnerJob);

    const outcome: KubectlJobOutcome = await run();

    expect(outcome.executed).toBe(true);
    expect(outcome.claimTimedOut).toBe(false);
    expect(outcome.isAccessFailure).toBe(true);
    expect(outcome.errorMessage).toContain(
      `kubectl outlived its ${Math.round(DEFAULT_KUBECTL_TIMEOUT_MS / 1000)}s timeout`,
    );
    expect(outcome.errorMessage).not.toContain(
      "Increase the timeout on the step",
    );
  });

  it("treats a claimed job that never started as not run, but not as unreachable", async () => {
    poll.mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.TimedOut,
        exitCode: undefined,
        output: "",
      }),
    );
    claimRead.mockResolvedValue({
      _id: JOB_ID.toString(),
      claimedAt: new Date("2026-09-22T10:00:00.000Z"),
    } as unknown as RunnerJob);

    const outcome: KubectlJobOutcome = await run();

    expect(outcome.executed).toBe(false);
    expect(outcome.claimTimedOut).toBe(false);
  });

  it("assumes nothing when the claim state cannot be read", async () => {
    poll.mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.TimedOut,
        exitCode: undefined,
        output: "",
      }),
    );
    claimRead.mockRejectedValue(new Error("database unavailable"));

    const outcome: KubectlJobOutcome = await run();

    expect(outcome.executed).toBe(false);
    expect(outcome.claimTimedOut).toBe(false);
    expect(outcome.isAccessFailure).toBe(true);
  });
});
