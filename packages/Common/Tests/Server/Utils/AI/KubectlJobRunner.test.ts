import KubectlJobRunner, {
  KUBECTL_OUTPUT_TRUNCATED_SUFFIX,
  KUBECTL_STDERR_CHARS_FOR_LLM,
  KubectlJobOutcome,
  KubectlRunState,
  KubectlTerminalJobFacts,
  RedactedKubectlOutput,
} from "../../../../Server/Utils/AI/ClusterAccess/KubectlJobRunner";
import AIRunService from "../../../../Server/Services/AIRunService";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import {
  DEFAULT_KUBECTL_TIMEOUT_MS,
  MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
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
  /*
   * didKubectlRun answers "could kubectl have run?": false ONLY when it
   * certainly did not, so a caller that must not forget or repeat a
   * command can read false as "nothing happened". getRunState (below)
   * separates Ran from Unknown.
   */
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
      "a job the Runner heartbeated before it went silent",
      { status: RunnerJobStatus.TimedOut, wasClaimed: true, wasStarted: true },
      true,
    ],
    /*
     * The finding: a claimed job whose start heartbeat never landed (the
     * Runner's one best-effort heartbeat before the step runs got no
     * answer, or an older Runner's fast kubectl finished before its first
     * heartbeat, 10 s in) and whose result was lost leaves claimedAt set
     * and startedAt null. It may well have run — for a write, it may have
     * been applied.
     */
    [
      "a job a Runner claimed and never heartbeated",
      {
        status: RunnerJobStatus.TimedOut,
        wasClaimed: true,
        wasStarted: false,
        errorMessage: RUNBOOK_EXECUTION_REASON,
      },
      true,
    ],
    [
      "a TimedOut job whose claim could not be read",
      { status: RunnerJobStatus.TimedOut },
      true,
    ],
    [
      "a job no Runner ever claimed",
      {
        status: RunnerJobStatus.TimedOut,
        wasClaimed: false,
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
    /*
     * The execution-window reason reads like kubectl ran; the row says no
     * Runner ever claimed it, and the row decides.
     */
    expect(
      KubectlJobRunner.didKubectlRun({
        status: RunnerJobStatus.TimedOut,
        errorMessage: RUNBOOK_EXECUTION_REASON,
        wasClaimed: false,
        wasStarted: false,
      }),
    ).toBe(false);
  });
});

describe("KubectlJobRunner.getRunState", () => {
  it.each<[string, KubectlTerminalJobFacts, KubectlRunState]>([
    [
      "a job that succeeded",
      { status: RunnerJobStatus.Succeeded },
      KubectlRunState.Ran,
    ],
    [
      "kubectl that exited non-zero",
      { status: RunnerJobStatus.Failed, exitCode: 1, output: "" },
      KubectlRunState.Ran,
    ],
    [
      "kubectl the Runner killed at its timeout",
      {
        status: RunnerJobStatus.Failed,
        output: "",
        errorMessage: "Killed (timeout 30000ms)",
      },
      KubectlRunState.Ran,
    ],
    [
      "a TimedOut row that still carries kubectl output",
      {
        status: RunnerJobStatus.TimedOut,
        wasClaimed: true,
        output: stderr("error: unexpected EOF"),
      },
      KubectlRunState.Ran,
    ],
    [
      "a job no Runner claimed",
      { status: RunnerJobStatus.TimedOut, wasClaimed: false },
      KubectlRunState.NotRun,
    ],
    [
      "a job a Runner claimed and never heartbeated (its start heartbeat and its result both lost)",
      { status: RunnerJobStatus.TimedOut, wasClaimed: true, wasStarted: false },
      KubectlRunState.Unknown,
    ],
    [
      "a job a Runner heartbeated and then went silent",
      { status: RunnerJobStatus.TimedOut, wasClaimed: true, wasStarted: true },
      KubectlRunState.Unknown,
    ],
    [
      "a TimedOut job whose claim could not be read",
      {
        status: RunnerJobStatus.TimedOut,
        wasClaimed: undefined,
        wasStarted: undefined,
      },
      KubectlRunState.Unknown,
    ],
    [
      "a refusal by the Runner before it spawned kubectl",
      {
        status: RunnerJobStatus.Failed,
        output: "",
        errorMessage: "Refused by the Runner: --kubeconfig is not allowed.",
      },
      KubectlRunState.NotRun,
    ],
  ])(
    "reads %s",
    (
      _label: string,
      facts: KubectlTerminalJobFacts,
      state: KubectlRunState,
    ) => {
      expect(KubectlJobRunner.getRunState(facts)).toBe(state);
      // didKubectlRun is false exactly when kubectl certainly did not run.
      expect(KubectlJobRunner.didKubectlRun(facts)).toBe(
        state !== KubectlRunState.NotRun,
      );
    },
  );
});

describe("KubectlJobRunner.isAccessFailure", () => {
  /*
   * What the Runner sends for a kubectl that exited 1 (KubectlExecutor):
   * stderr in its own section of the output, and its last line again on
   * the errorMessage after "Exit code 1: ". Both are read, a line at a
   * time.
   */
  function ranAndFailed(line: string): KubectlTerminalJobFacts {
    return {
      status: RunnerJobStatus.Failed,
      exitCode: 1,
      output: stderr(`${line}\n`),
      errorMessage: `Exit code 1: ${line}`,
    };
  }

  it.each<[string, KubectlTerminalJobFacts]>([
    [
      "an unclaimed job",
      { status: RunnerJobStatus.TimedOut, wasClaimed: false },
    ],
    [
      "a Runner that took the job and went silent",
      { status: RunnerJobStatus.TimedOut, wasClaimed: true, wasStarted: false },
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
  ])(
    "treats %s as an access failure",
    (_label: string, facts: KubectlTerminalJobFacts) => {
      expect(KubectlJobRunner.isAccessFailure(facts)).toBe(true);
    },
  );

  // Positive controls, in the shape the Runner really sends.
  it.each<[string, string]>([
    [
      "RBAC Forbidden",
      'Error from server (Forbidden): pods is forbidden: User "system:serviceaccount:oneuptime:ai-runner" cannot list resource "pods" in API group "" in the namespace "web"',
    ],
    [
      "an expired token",
      "error: You must be logged in to the server (Unauthorized)",
    ],
    [
      "an unreachable API server",
      "Unable to connect to the server: dial tcp 10.96.0.1:443: i/o timeout",
    ],
    [
      "a refused connection to the API server",
      "The connection to the server 10.96.0.1:443 was refused - did you specify the right host or port?",
    ],
    [
      "an untrusted API server certificate",
      "Unable to connect to the server: x509: certificate signed by unknown authority",
    ],
    [
      "kubectl's discovery failing to reach the API server",
      'E0923 10:00:00.123456      12 memcache.go:265] couldn\'t get current server API group list: Get "https://10.96.0.1:443/api?timeout=32s": dial tcp 10.96.0.1:443: connect: connection refused',
    ],
  ])("treats %s as an access failure", (_label: string, line: string) => {
    expect(KubectlJobRunner.isAccessFailure(ranAndFailed(line))).toBe(true);
  });

  /*
   * The finding: the API server answered — it authenticated and authorized
   * the request — and a component behind it failed. kubectl logs for a pod
   * on a NotReady node is exactly what an investigation runs. None of this
   * is about the AI's access, and none of it may become the cluster's
   * "Last error".
   */
  it.each<[string, string]>([
    [
      "kubectl logs for a pod whose node refuses the kubelet connection",
      'Error from server: Get "https://10.0.1.23:10250/containerLogs/web/web-7d9f/web?tailLines=100": dial tcp 10.0.1.23:10250: connect: connection refused',
    ],
    [
      "kubectl logs for a pod whose kubelet times out",
      'Error from server: Get "https://10.0.1.23:10250/containerLogs/web/web-7d9f/web?tailLines=100": dial tcp 10.0.1.23:10250: i/o timeout',
    ],
    [
      "the API server failing to dial the kubelet",
      "Error from server: error dialing backend: dial tcp 10.0.1.23:10250: connect: no route to host",
    ],
    [
      "a kubelet serving certificate the API server rejects",
      'Error from server: Get "https://10.0.1.23:10250/containerLogs/a/b/c": x509: certificate has expired or is not yet valid',
    ],
    [
      "a conversion webhook the API server cannot reach",
      'Error from server: conversion webhook for example.com/v1, Kind=Foo failed: Post "https://foo-webhook.foo.svc:443/convert": dial tcp 10.96.1.2:443: connect: connection refused',
    ],
    [
      "the kubelet refusing the API server itself",
      "Error from server (Forbidden): Forbidden (user=kube-apiserver, verb=get, resource=nodes, subresource=proxy) ( pods/log web-7d9f)",
    ],
    [
      "a gone container on an upgraded connection",
      'error: unable to upgrade connection: container not found ("web")',
    ],
    [
      "an upgraded connection the kubelet refused",
      "error: error upgrading connection: error dialing backend: dial tcp 10.0.1.23:10250: connect: connection refused",
    ],
    ["NotFound", 'Error from server (NotFound): pods "web-7d9f-abc" not found'],
    [
      "BadRequest",
      'Error from server (BadRequest): container "web" in pod "web-1" is waiting to start: ContainerCreating',
    ],
    [
      "a metrics API that is not serving",
      "Error from server (ServiceUnavailable): the server is currently unable to handle the request (get pods.metrics.k8s.io)",
    ],
    [
      "an admission webhook rejecting the change",
      'Error from server (Forbidden): admission webhook "validate.kyverno.svc" denied the request: image tag latest is not allowed',
    ],
    [
      "Pod Security rejecting the change",
      'Error from server (Forbidden): pods "web-1" is forbidden: violates PodSecurity "restricted:latest": allowPrivilegeEscalation != false',
    ],
    [
      "a quota rejecting the change",
      'Error from server (Forbidden): pods "web-1" is forbidden: exceeded quota: compute, requested: cpu=2, used: cpu=8, limited: cpu=8',
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
  ])("treats %s as not an access failure", (_label: string, line: string) => {
    expect(KubectlJobRunner.isAccessFailure(ranAndFailed(line))).toBe(false);
  });

  it("reads each stderr line on its own", () => {
    /*
     * A kubelet error and an unrelated line mentioning the server must not
     * combine into an access failure.
     */
    expect(
      KubectlJobRunner.isAccessFailure({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        output: stderr(
          'Error from server: Get "https://10.0.1.23:10250/containerLogs/web/web-1/web": dial tcp 10.0.1.23:10250: connect: connection refused\nhint: check the node web-1 runs on\n',
        ),
        errorMessage: "Exit code 1: hint: check the node web-1 runs on",
      }),
    ).toBe(false);

    // One access line among others is still access.
    expect(
      KubectlJobRunner.isAccessFailure({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        output: stderr(
          "W0923 10:00:00.000000 1 loader.go:222] Config not found\nUnable to connect to the server: dial tcp 10.96.0.1:443: i/o timeout\n",
        ),
        errorMessage:
          "Exit code 1: Unable to connect to the server: dial tcp 10.96.0.1:443: i/o timeout",
      }),
    ).toBe(true);
  });

  it("reads the errorMessage even when stderr was not captured", () => {
    expect(
      KubectlJobRunner.isAccessFailure({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        output: "",
        errorMessage:
          "Exit code 1: Unable to connect to the server: dial tcp 10.96.0.1:443: i/o timeout",
      }),
    ).toBe(true);

    expect(
      KubectlJobRunner.isAccessFailure({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        output: "",
        errorMessage:
          'Exit code 1: Error from server: Get "https://10.0.1.23:10250/containerLogs/web/web-1/web": dial tcp 10.0.1.23:10250: i/o timeout',
      }),
    ).toBe(false);
  });

  it("never reads cluster output (stdout) as an access error", () => {
    // Pod logs say "connection refused" all the time.
    expect(
      KubectlJobRunner.isAccessFailure({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        errorMessage:
          "Exit code 1: error: container web is not valid for pod web-1",
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
  let enqueue: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(AIRunService, "updateOneBy")
      .mockResolvedValue(undefined as never);
    enqueue = jest
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
    expect(outcome.runState).toBe(KubectlRunState.NotRun);
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

  /*
   * The finding (IP-1): the Runner claims the job, kubectl finishes in 2 s,
   * and the result POST is lost (a 502, an OOM-killed pod). The Runner
   * announces a step with one best-effort heartbeat (capped at 5 s) right
   * before handing it to its executor, and runs it anyway when that gets
   * no answer — and an older Runner's first heartbeat came 10 s in — so
   * startedAt may never have been written: the row has claimedAt and
   * assignedAgentId and nothing else. The command may well have run, so it
   * must never read as "not run".
   */
  it("reports a kubectl a Runner claimed, with no start heartbeat and no result, as unknown, never as not run", async () => {
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
      startedAt: null,
    } as unknown as RunnerJob);

    const outcome: KubectlJobOutcome = await run();

    expect(outcome.runState).toBe(KubectlRunState.Unknown);
    expect(outcome.executed).not.toBe(false);
    expect(outcome.claimTimedOut).toBe(false);
    expect(outcome.isAccessFailure).toBe(true);
    expect(outcome.errorMessage).toContain(
      "The Runner took this kubectl command but did not report a result in time",
    );
    expect(outcome.errorMessage).toContain(
      `kubectl outlived its ${Math.round(DEFAULT_KUBECTL_TIMEOUT_MS / 1000)}s timeout`,
    );
    expect(outcome.errorMessage).toContain("Whether it ran");
    expect(outcome.errorMessage).not.toContain("Nothing was run");
    expect(outcome.errorMessage).not.toContain(
      "Increase the timeout on the step",
    );
  });

  it("reads assignedAgentId alone as a claim", async () => {
    poll.mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.TimedOut,
        exitCode: undefined,
        output: "",
      }),
    );
    claimRead.mockResolvedValue({
      _id: JOB_ID.toString(),
      assignedAgentId: RUNNER_ID,
    } as unknown as RunnerJob);

    const outcome: KubectlJobOutcome = await run();

    expect(outcome.runState).toBe(KubectlRunState.Unknown);
    expect(outcome.executed).toBe(true);
    expect(outcome.claimTimedOut).toBe(false);
  });

  it("reports a job the Runner heartbeated and then lost as unknown too", async () => {
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
      assignedAgentId: RUNNER_ID,
      startedAt: new Date("2026-09-22T10:00:10.000Z"),
    } as unknown as RunnerJob);

    const outcome: KubectlJobOutcome = await run();

    // No output came back either way: nothing to cite, and nothing "not run".
    expect(outcome.runState).toBe(KubectlRunState.Unknown);
    expect(outcome.executed).toBe(true);
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

    // Neither "nothing ran" nor "the Runner is unreachable".
    expect(outcome.runState).toBe(KubectlRunState.Unknown);
    expect(outcome.executed).toBe(true);
    expect(outcome.claimTimedOut).toBe(false);
    expect(outcome.isAccessFailure).toBe(true);
    expect(outcome.errorMessage).toContain(
      "whether a Runner picked it up could not be read",
    );
  });

  it("assumes nothing when the job row is gone", async () => {
    poll.mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.TimedOut,
        exitCode: undefined,
        output: "",
      }),
    );
    claimRead.mockResolvedValue(null);

    const outcome: KubectlJobOutcome = await run();

    expect(outcome.runState).toBe(KubectlRunState.Unknown);
    expect(outcome.claimTimedOut).toBe(false);
  });

  /*
   * IP-2 end to end: kubectl logs for a pod on a NotReady node. The API
   * server answered; the kubelet behind it did not. The cluster's AI page
   * must not now show that as its "Last error".
   */
  it("does not record a kubelet error the API server passed back", async () => {
    const kubeletError: string =
      'Error from server: Get "https://10.0.1.23:10250/containerLogs/web/web-7d9f/web?tailLines=100": dial tcp 10.0.1.23:10250: connect: connection refused';
    poll.mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        errorMessage: `Exit code 1: ${kubeletError}`,
        output: stderr(`${kubeletError}\n`),
      }),
    );

    const outcome: KubectlJobOutcome = await run();

    expect(outcome.executed).toBe(true);
    expect(outcome.runState).toBe(KubectlRunState.Ran);
    expect(outcome.isAccessFailure).toBe(false);
    expect(recordOutcome).not.toHaveBeenCalled();
  });

  it("records an API server it could not reach (negative control)", async () => {
    const unreachable: string =
      "Unable to connect to the server: dial tcp 10.96.0.1:443: i/o timeout";
    poll.mockResolvedValue(
      fakeJob({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        errorMessage: `Exit code 1: ${unreachable}`,
        output: stderr(`${unreachable}\n`),
      }),
    );

    const outcome: KubectlJobOutcome = await run();

    expect(outcome.isAccessFailure).toBe(true);
    // Recorded redacted (the address is masked), as every error message is.
    expect(recordOutcome).toHaveBeenCalledWith({
      clusterId: CLUSTER_ID,
      succeeded: false,
      errorMessage: expect.stringContaining(
        "Exit code 1: Unable to connect to the server: dial tcp",
      ),
    });
  });

  describe("the cluster AI page's access test", () => {
    function runAccessTest(): Promise<KubectlJobOutcome> {
      return KubectlJobRunner.run({
        projectId: PROJECT_ID,
        origin: RunnerJobOrigin.AiInvestigation,
        kubernetesClusterId: CLUSTER_ID,
        targetRunnerId: RUNNER_ID,
        command: "kubectl version",
        stepId: "ai-access-test-1",
        timeoutInMs: DEFAULT_KUBECTL_TIMEOUT_MS,
        isAccessTest: true,
      });
    }

    it("enqueues an access test with no AI run", async () => {
      await runAccessTest();

      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ isAccessTest: true, aiRunId: undefined }),
      );
    });

    it("never marks an investigation's command as an access test (negative control)", async () => {
      await run();

      expect(
        (enqueue.mock.calls[0]![0] as Record<string, unknown>)["isAccessTest"],
      ).toBeUndefined();
    });

    /*
     * The first access-test command goes unclaimed. Both what the test
     * reports and what the cluster's page records as its last error are
     * worded for kubectl, not for a runbook step.
     */
    it("words an unclaimed access test in kubectl terms, for the result and the recorded last error", async () => {
      poll.mockResolvedValue(
        fakeJob({
          status: RunnerJobStatus.TimedOut,
          exitCode: undefined,
          output: "",
          errorMessage: RUNBOOK_CLAIM_REASON,
        }),
      );

      const outcome: KubectlJobOutcome = await runAccessTest();

      expect(outcome.claimTimedOut).toBe(true);
      const recorded: string = (
        recordOutcome.mock.calls[0]![0] as { errorMessage: string }
      ).errorMessage;

      for (const text of [outcome.errorMessage || "", recorded]) {
        expect(text).toContain("did not pick up this kubectl command");
        expect(text).not.toContain("runbook");
        expect(text).not.toContain("step");
      }
    });
  });
});

/*
 * Known follow-up 4: the output the model sees is capped, and kubectl says
 * why it failed at the END. The cap keeps the Runner's "[stderr]" section
 * (its tail, when it is itself too long) and spends the rest on stdout.
 */
describe("KubectlJobRunner.redactAndCap keeps kubectl's stderr", () => {
  const STDERR_REASON: string =
    'Error from server (Forbidden): pods "web-1" is forbidden: User "system:serviceaccount:oneuptime:ai-runner" cannot get resource "pods/log"';

  function bigTable(chars: number): string {
    return "web-1  1/1  Running  0  10d\n".repeat(Math.ceil(chars / 28));
  }

  it("keeps the whole stderr section when a large stdout does not fit", () => {
    const output: string = `[stdout]\n${bigTable(
      MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM * 2,
    )}\n[stderr]\n${STDERR_REASON}\n`;

    const result: RedactedKubectlOutput = KubectlJobRunner.redactAndCap(output);

    expect(result.isTruncated).toBe(true);
    expect(result.text.endsWith(`[stderr]\n${STDERR_REASON}\n`)).toBe(true);
    expect(result.text.startsWith("[stdout]\nweb-1")).toBe(true);
    expect(result.text).toContain(KUBECTL_OUTPUT_TRUNCATED_SUFFIX);
    expect(result.text.length).toBeLessThanOrEqual(
      MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM + KUBECTL_OUTPUT_TRUNCATED_SUFFIX.length,
    );
    // stdout gets the rest of the cap, not a token share.
    expect(result.text.length).toBeGreaterThan(
      MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM - 100,
    );
  });

  it("keeps the tail of a stderr longer than its share, and says it was cut", () => {
    const noise: string = "W0923 warning line about a deprecated API\n".repeat(
      200,
    );
    const output: string = `[stdout]\n${bigTable(
      MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM * 2,
    )}\n[stderr]\n${noise}${STDERR_REASON}\n`;

    const result: RedactedKubectlOutput = KubectlJobRunner.redactAndCap(output);
    const stderrStart: number = result.text.lastIndexOf("[stderr]\n");

    expect(result.isTruncated).toBe(true);
    expect(result.text.endsWith(`${STDERR_REASON}\n`)).toBe(true);
    expect(result.text).toContain("[stderr]\n... [earlier stderr truncated]\n");
    expect(result.text.length - stderrStart).toBeLessThanOrEqual(
      KUBECTL_STDERR_CHARS_FOR_LLM,
    );
    // stdout still gets the rest.
    expect(stderrStart).toBeGreaterThan(
      MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM - KUBECTL_STDERR_CHARS_FOR_LLM - 100,
    );
  });

  it("lets a long stderr use the room a short stdout leaves", () => {
    const noise: string = "W0923 warning line about a deprecated API\n".repeat(
      400,
    );
    const output: string = `[stdout]\nNAME\n[stderr]\n${noise}${STDERR_REASON}\n`;

    const result: RedactedKubectlOutput = KubectlJobRunner.redactAndCap(output);

    expect(result.isTruncated).toBe(true);
    expect(result.text.startsWith("[stdout]\nNAME\n[stderr]\n")).toBe(true);
    expect(result.text.endsWith(`${STDERR_REASON}\n`)).toBe(true);
    expect(result.text.length).toBeGreaterThan(
      MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM - 100,
    );
    expect(result.text.length).toBeLessThanOrEqual(
      MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM,
    );
  });

  it("caps a stderr-only output from its tail", () => {
    const noise: string = "W0923 warning line about a deprecated API\n".repeat(
      400,
    );

    const result: RedactedKubectlOutput = KubectlJobRunner.redactAndCap(
      `[stderr]\n${noise}${STDERR_REASON}\n`,
    );

    expect(result.isTruncated).toBe(true);
    expect(
      result.text.startsWith("[stderr]\n... [earlier stderr truncated]\n"),
    ).toBe(true);
    expect(result.text.endsWith(`${STDERR_REASON}\n`)).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(
      MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM,
    );
  });

  it("redacts stderr before it is kept", () => {
    const output: string = `[stdout]\n${bigTable(
      MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM * 2,
    )}\n[stderr]\nerror: request with Authorization: Bearer abcdef0123456789secret was rejected\n`;

    const result: RedactedKubectlOutput = KubectlJobRunner.redactAndCap(output);

    expect(result.text).not.toContain("abcdef0123456789secret");
    expect(result.text).toContain(
      "[stderr]\nerror: request with Authorization",
    );
  });

  // Negative controls: nothing changes when the output fits or has no stderr.
  it("leaves an output that fits untouched", () => {
    const output: string = `[stdout]\nNAME\n[stderr]\n${STDERR_REASON}\n`;

    expect(KubectlJobRunner.redactAndCap(output)).toEqual({
      text: output,
      redactionCount: 0,
      isTruncated: false,
    });
  });

  it("cuts an output without a stderr section from the top, as before", () => {
    const table: string = bigTable(MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM * 2);

    const result: RedactedKubectlOutput = KubectlJobRunner.redactAndCap(
      `[stdout]\n${table}`,
    );

    expect(result.isTruncated).toBe(true);
    expect(result.text).toBe(
      `${`[stdout]\n${table}`.slice(0, MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM)}${KUBECTL_OUTPUT_TRUNCATED_SUFFIX}`,
    );
  });

  it("does not treat a stderr marker inside stdout as the stderr section", () => {
    // Cluster data that happens to contain the marker mid-line.
    const table: string = `pod-a says [stderr]\n${bigTable(
      MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM * 2,
    )}`;

    const result: RedactedKubectlOutput = KubectlJobRunner.redactAndCap(
      `[stdout]\n${table}`,
    );

    expect(result.text.endsWith(KUBECTL_OUTPUT_TRUNCATED_SUFFIX)).toBe(true);
  });
});
