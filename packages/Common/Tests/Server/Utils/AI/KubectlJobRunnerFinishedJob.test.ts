import KubectlJobRunner, {
  KUBECTL_CLAIM_TIMEOUT_MS,
  KubectlJobOutcome,
  KubectlRunState,
} from "../../../../Server/Utils/AI/ClusterAccess/KubectlJobRunner";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import logger from "../../../../Server/Utils/Logger";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the one reading of a finished kubectl job, shared
 * by the investigation lane (KubectlJobRunner.run) and the remediation
 * toolkit, which enqueues and waits itself (PR #3953 round-three review):
 *
 * - readFinishedJob reads the claim back from the row ONLY for a TimedOut
 *   job (readClaimState) and turns it into a run state: never claimed is
 *   NotRun, claimed/started/unreadable is Unknown — never NotRun;
 * - its reason for a TimedOut job is kubectl-worded, never the runbook
 *   one; any other failure keeps the Runner's reason, redacted;
 * - recordOutcomeOnCluster records a success and an access failure on the
 *   cluster's AI page, never a failure the model's command caused;
 * - getRunStateOfJobRow reads a row later (the rollback arm) the same way,
 *   and a job still in flight is Unknown.
 */

const JOB_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const EXECUTION_TIMEOUT_MS: number = 30_000;

// The kubectl-worded reasons for a TimedOut job whose claim is not "never".
const UNKNOWN_REASON_PATTERN: RegExp =
  /Whether it ran, and what it did, is unknown\.|What the command did is unknown\./;

// "[redacted]", or a kind-specific form such as "[redacted-jwt]".
const REDACTION_MARKER_PATTERN: RegExp = /\[redacted(?:-[a-z]+)?\]/;

const RUNBOOK_CLAIM_REASON: string =
  "No runbook agent picked up this step before the wait window expired. The agent may be offline — check that it is running and reachable, then try again.";

function enqueuedJob(payload: Record<string, unknown> | undefined): RunnerJob {
  return {
    id: JOB_ID,
    _id: JOB_ID.toString(),
    status: RunnerJobStatus.Pending,
    payload,
  } as unknown as RunnerJob;
}

function terminal(overrides: Partial<Record<string, unknown>>): RunnerJob {
  return {
    id: JOB_ID,
    _id: JOB_ID.toString(),
    ...overrides,
  } as unknown as RunnerJob;
}

let claimRead: jest.SpyInstance;

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  claimRead = jest.spyOn(RunnerJobService, "findOneById");
});

afterEach(() => {
  jest.restoreAllMocks();
});

function read(
  terminalJob: RunnerJob,
  payload: Record<string, unknown> | undefined = {
    displayCommand: "kubectl rollout restart deployment/web -n web",
  },
): Promise<KubectlJobOutcome> {
  return KubectlJobRunner.readFinishedJob({
    job: enqueuedJob(payload),
    terminalJob,
    command: "kubectl   rollout restart deployment/web -n web",
    claimTimeoutInMs: KUBECTL_CLAIM_TIMEOUT_MS,
    executionTimeoutInMs: EXECUTION_TIMEOUT_MS,
  });
}

describe("KubectlJobRunner.readFinishedJob", () => {
  it("a success ran, is not an access failure, and never reads the claim", async () => {
    const outcome: KubectlJobOutcome = await read(
      terminal({
        status: RunnerJobStatus.Succeeded,
        exitCode: 0,
        output: "[stdout]\ndeployment.apps/web restarted",
      }),
    );

    expect(outcome).toEqual(
      expect.objectContaining({
        jobId: JOB_ID.toString(),
        succeeded: true,
        exitCode: 0,
        errorMessage: undefined,
        displayCommand: "kubectl rollout restart deployment/web -n web",
        executed: true,
        runState: KubectlRunState.Ran,
        claimTimedOut: false,
        isAccessFailure: false,
      }),
    );
    expect(outcome.output).toContain("deployment.apps/web restarted");
    expect(claimRead).not.toHaveBeenCalled();
  });

  it("an unclaimed TimedOut job never ran: NotRun, claim timed out, kubectl-worded", async () => {
    claimRead.mockResolvedValue(
      terminal({ claimedAt: null, assignedAgentId: null, startedAt: null }),
    );

    const outcome: KubectlJobOutcome = await read(
      terminal({
        status: RunnerJobStatus.TimedOut,
        errorMessage: RUNBOOK_CLAIM_REASON,
      }),
    );

    expect(outcome.runState).toBe(KubectlRunState.NotRun);
    expect(outcome.executed).toBe(false);
    expect(outcome.claimTimedOut).toBe(true);
    expect(outcome.isAccessFailure).toBe(true);
    expect(outcome.errorMessage).toBe(
      `The cluster's Runner did not pick up this kubectl command within ${Math.round(
        KUBECTL_CLAIM_TIMEOUT_MS / 1000,
      )}s — it may be offline, restarting or busy with other work. Nothing was run on the cluster.`,
    );
    expect(outcome.errorMessage).not.toContain("try again");
    expect(claimRead).toHaveBeenCalledTimes(1);
  });

  it.each<[string, Record<string, unknown> | null | Error]>([
    ["claimed (claimedAt)", { claimedAt: new Date() }],
    ["claimed (assignedAgentId only)", { assignedAgentId: JOB_ID }],
    ["started only", { startedAt: new Date() }],
    ["a row that is gone", null],
    ["a claim read that throws", new Error("database unavailable")],
  ])(
    "a TimedOut job %s is Unknown — may have run, never NotRun",
    async (_label: string, row: Record<string, unknown> | null | Error) => {
      if (row instanceof Error) {
        claimRead.mockRejectedValue(row);
      } else {
        claimRead.mockResolvedValue(row === null ? null : terminal(row));
      }

      const outcome: KubectlJobOutcome = await read(
        terminal({
          status: RunnerJobStatus.TimedOut,
          errorMessage: RUNBOOK_CLAIM_REASON,
        }),
      );

      expect(outcome.runState).toBe(KubectlRunState.Unknown);
      expect(outcome.executed).toBe(true);
      expect(outcome.claimTimedOut).toBe(false);
      expect(outcome.isAccessFailure).toBe(true);
      expect(outcome.errorMessage).not.toContain("try again");
      expect(outcome.errorMessage).not.toContain("Nothing was run");
      expect(outcome.errorMessage).toMatch(UNKNOWN_REASON_PATTERN);
    },
  );

  it("a Runner refusal before spawn is NotRun, keeps the Runner's reason, and never reads the claim", async () => {
    const outcome: KubectlJobOutcome = await read(
      terminal({
        status: RunnerJobStatus.Failed,
        errorMessage: "Refused by the Runner: kubectl could not be started.",
      }),
    );

    expect(outcome.runState).toBe(KubectlRunState.NotRun);
    expect(outcome.claimTimedOut).toBe(false);
    expect(outcome.errorMessage).toBe(
      "Refused by the Runner: kubectl could not be started.",
    );
    expect(claimRead).not.toHaveBeenCalled();
  });

  it("a kubectl that exited non-zero on a wrong name ran, and is not about access", async () => {
    const outcome: KubectlJobOutcome = await read(
      terminal({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        output:
          '[stdout]\n\n[stderr]\nError from server (NotFound): deployments.apps "web" not found',
        errorMessage: "Exit code 1",
      }),
    );

    expect(outcome.runState).toBe(KubectlRunState.Ran);
    expect(outcome.isAccessFailure).toBe(false);
    expect(outcome.errorMessage).toBe("Exit code 1");
  });

  it("redacts a secret the Runner's reason echoes", async () => {
    const outcome: KubectlJobOutcome = await read(
      terminal({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        errorMessage:
          "Exit code 1: error: --token=eyJhbGciOiJSUzI1NiIsImtpZCI6IjEifQ.eyJzdWIiOiJzeXN0ZW06c2VydmljZWFjY291bnQifQ.c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWduYXR1cmU is invalid",
      }),
    );

    expect(outcome.errorMessage).not.toContain("eyJhbGciOiJSUzI1NiIsImtpZCI6");
    expect(outcome.errorMessage).toMatch(REDACTION_MARKER_PATTERN);
  });

  it("falls back to the command asked for when the payload has no display form", async () => {
    const outcome: KubectlJobOutcome = await read(
      terminal({ status: RunnerJobStatus.Succeeded, exitCode: 0 }),
      {},
    );

    expect(outcome.displayCommand).toBe(
      "kubectl   rollout restart deployment/web -n web",
    );
  });
});

describe("KubectlJobRunner.recordOutcomeOnCluster", () => {
  let recordOutcome: jest.SpyInstance;

  beforeEach(() => {
    recordOutcome = jest
      .spyOn(KubernetesClusterAiAccessService, "recordCommandOutcome")
      .mockResolvedValue(undefined);
  });

  function outcome(overrides: Partial<KubectlJobOutcome>): KubectlJobOutcome {
    return {
      jobId: JOB_ID.toString(),
      succeeded: false,
      output: "",
      displayCommand: "kubectl get pods -n web",
      ...overrides,
    };
  }

  it("records a success", async () => {
    await KubectlJobRunner.recordOutcomeOnCluster({
      clusterId: CLUSTER_ID,
      outcome: outcome({ succeeded: true }),
    });

    expect(recordOutcome).toHaveBeenCalledWith({
      clusterId: CLUSTER_ID,
      succeeded: true,
      errorMessage: undefined,
    });
  });

  it("records an access failure with its reason", async () => {
    await KubectlJobRunner.recordOutcomeOnCluster({
      clusterId: CLUSTER_ID,
      outcome: outcome({
        isAccessFailure: true,
        errorMessage: "Unable to connect to the server",
      }),
    });

    expect(recordOutcome).toHaveBeenCalledWith({
      clusterId: CLUSTER_ID,
      succeeded: false,
      errorMessage: "Unable to connect to the server",
    });
  });

  // Negative control: the model's own mistake says nothing about the access.
  it("never records a failure that is not about access", async () => {
    await KubectlJobRunner.recordOutcomeOnCluster({
      clusterId: CLUSTER_ID,
      outcome: outcome({ isAccessFailure: false, errorMessage: "NotFound" }),
    });

    expect(recordOutcome).not.toHaveBeenCalled();
  });
});

describe("KubectlJobRunner.getRunStateOfJobRow", () => {
  it.each<[string, Record<string, unknown>, KubectlRunState]>([
    ["succeeded", { status: RunnerJobStatus.Succeeded }, KubectlRunState.Ran],
    [
      "failed with an exit code",
      { status: RunnerJobStatus.Failed, exitCode: 1 },
      KubectlRunState.Ran,
    ],
    [
      "killed at the Runner's timeout",
      {
        status: RunnerJobStatus.Failed,
        errorMessage: "Killed (timeout after 60s)",
      },
      KubectlRunState.Ran,
    ],
    [
      "refused before spawn",
      { status: RunnerJobStatus.Failed, errorMessage: "Refused by the Runner" },
      KubectlRunState.NotRun,
    ],
    [
      "timed out, never claimed",
      { status: RunnerJobStatus.TimedOut, claimedAt: null },
      KubectlRunState.NotRun,
    ],
    [
      "timed out, claimed",
      { status: RunnerJobStatus.TimedOut, claimedAt: new Date() },
      KubectlRunState.Unknown,
    ],
    [
      "timed out, assigned to an agent",
      { status: RunnerJobStatus.TimedOut, assignedAgentId: JOB_ID },
      KubectlRunState.Unknown,
    ],
    [
      "timed out, started",
      { status: RunnerJobStatus.TimedOut, startedAt: new Date() },
      KubectlRunState.Unknown,
    ],
    [
      "still running",
      { status: RunnerJobStatus.Running, claimedAt: new Date() },
      KubectlRunState.Unknown,
    ],
    [
      "still pending",
      { status: RunnerJobStatus.Pending },
      KubectlRunState.Unknown,
    ],
  ])(
    "a job %s",
    (
      _label: string,
      row: Record<string, unknown>,
      expected: KubectlRunState,
    ) => {
      expect(KubectlJobRunner.getRunStateOfJobRow(terminal(row))).toBe(
        expected,
      );
    },
  );
});
