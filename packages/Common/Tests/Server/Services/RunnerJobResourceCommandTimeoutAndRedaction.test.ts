import RunnerJobService, {
  RunnerJobTimeoutKind,
  Service as RunnerJobServiceClass,
  describeRunnerJobTimeout,
} from "../../../Server/Services/RunnerJobService";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../Types/Runbook/RunnerJobStatus";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the two RunnerJobService readings of a resource
 * command job's row besides its enqueue:
 *
 * - a timed-out ResourceCommand job is worded for the resource's AI agent
 *   ("the Docker AI agent did not pick up the command in time ... Nothing
 *   was run on the Docker host"), on the row, while every Kubectl and
 *   runbook reason stays exactly what it was;
 * - submitResult, given the job's resource type and program, stores the
 *   output through the resource command redactor as well, and without them
 *   stores exactly what it always has.
 */

const JOB_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const AGENT_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CLAIM_TIMEOUT_MS: number = 60_000;
const EXECUTION_TIMEOUT_MS: number = 30_000;

function reason(data: {
  kind: RunnerJobTimeoutKind;
  wasClaimed?: boolean | undefined;
  origin?: RunnerJobOrigin | undefined;
  stepType?: RunbookStepType | undefined;
  resourceType?: AiResourceType | null | undefined;
  isForKubernetesAiAgent?: boolean | undefined;
}): string {
  return describeRunnerJobTimeout({
    kind: data.kind,
    wasClaimed: data.wasClaimed,
    origin: data.origin ?? RunnerJobOrigin.AiInvestigation,
    stepType: data.stepType ?? RunbookStepType.ResourceCommand,
    claimTimeoutInMs: CLAIM_TIMEOUT_MS,
    executionTimeoutInMs: EXECUTION_TIMEOUT_MS,
    isForKubernetesAiAgent: data.isForKubernetesAiAgent,
    resourceType: data.resourceType,
  });
}

describe("describeRunnerJobTimeout for a resource command", () => {
  it("says the agent did not pick up the command in time, and that nothing ran", () => {
    expect(
      reason({ kind: "unclaimed", resourceType: AiResourceType.DockerHost }),
    ).toBe(
      "The Docker AI agent did not pick up the command in time (within 60s) — it may be offline, restarting or busy with other work. Nothing was run on the Docker host.",
    );
  });

  it("names each type's agent and resource", () => {
    expect(
      reason({ kind: "unclaimed", resourceType: AiResourceType.Host }),
    ).toContain("The Host AI agent did not pick up the command in time");
    expect(
      reason({ kind: "unclaimed", resourceType: AiResourceType.Host }),
    ).toContain("Nothing was run on the host.");
    expect(
      reason({
        kind: "unclaimed",
        resourceType: AiResourceType.DatabaseServer,
      }),
    ).toContain("Nothing was run on the database server.");
    expect(
      reason({
        kind: "unclaimed",
        resourceType: AiResourceType.VMwareVCenter,
      }),
    ).toContain("The VMware AI agent did not pick up the command in time");
  });

  it("reads a job still Pending at the overall deadline as never picked up", () => {
    expect(
      reason({
        kind: "overall",
        wasClaimed: false,
        resourceType: AiResourceType.CephCluster,
      }),
    ).toContain("The Ceph AI agent did not pick up the command in time");
  });

  it("says what a command the agent took did is unknown", () => {
    expect(
      reason({
        kind: "lease_expired",
        wasClaimed: true,
        resourceType: AiResourceType.ProxmoxCluster,
      }),
    ).toBe(
      "The Proxmox AI agent stopped responding while this command was running — it may have restarted or lost its connection. What the command did is unknown.",
    );
    expect(
      reason({
        kind: "overall",
        wasClaimed: true,
        resourceType: AiResourceType.ProxmoxCluster,
      }),
    ).toBe(
      "The Proxmox AI agent did not report a result for this command in time — the command may have outlived its 30s timeout. What the command did is unknown.",
    );
  });

  it("tells a remediation to check the resource before running a change again", () => {
    for (const kind of [
      "lease_expired",
      "overall",
    ] as Array<RunnerJobTimeoutKind>) {
      expect(
        reason({
          kind,
          wasClaimed: true,
          origin: RunnerJobOrigin.AiRemediation,
          resourceType: AiResourceType.DockerSwarmCluster,
        }),
      ).toContain(
        "Check the Docker Swarm cluster before running a change again.",
      );
    }

    // Nothing ran: nothing to check.
    expect(
      reason({
        kind: "unclaimed",
        origin: RunnerJobOrigin.AiRemediation,
        resourceType: AiResourceType.DockerSwarmCluster,
      }),
    ).not.toContain("Check the");
  });

  it("falls back to generic words for a row without a readable type", () => {
    expect(reason({ kind: "unclaimed", resourceType: null })).toBe(
      "The resource's AI agent did not pick up the command in time (within 60s) — it may be offline, restarting or busy with other work. Nothing was run on the resource.",
    );
  });

  it("leaves the kubectl wording exactly as it was", () => {
    expect(
      reason({
        kind: "unclaimed",
        stepType: RunbookStepType.Kubectl,
        isForKubernetesAiAgent: true,
        resourceType: AiResourceType.DockerHost,
      }),
    ).toBe(
      "The cluster's Kubernetes AI agent did not pick up this kubectl command within 60s — it may be offline, restarting or busy with other work. Nothing was run on the cluster.",
    );
    expect(
      reason({ kind: "unclaimed", stepType: RunbookStepType.Kubectl }),
    ).toBe(
      "The cluster's Runner did not pick up this kubectl command within 60s — it may be offline, restarting or busy with other work. Nothing was run on the cluster.",
    );
  });

  it("leaves a runbook step's wording as it was", () => {
    expect(
      reason({
        kind: "unclaimed",
        origin: RunnerJobOrigin.Runbook,
        stepType: RunbookStepType.Bash,
      }),
    ).toBe(
      "No runbook agent picked up this step before the wait window expired. The agent may be offline — check that it is running and reachable, then try again.",
    );
  });
});

describe("RunnerJobService.pollUntilTerminal on a resource command", () => {
  let row: Record<string, unknown>;
  let findOneById: jest.SpyInstance;
  let timeoutSpy: jest.SpyInstance;

  beforeEach(() => {
    row = {};
    findOneById = jest
      .spyOn(RunnerJobService, "findOneById")
      .mockImplementation(async (): Promise<RunnerJob> => {
        return row as unknown as RunnerJob;
      });
    timeoutSpy = jest
      .spyOn(RunnerJobService, "timeoutJob")
      .mockImplementation(
        async (data: { reason: string }): Promise<RunnerJob> => {
          return {
            status: RunnerJobStatus.TimedOut,
            errorMessage: data.reason,
          } as unknown as RunnerJob;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads the resource agent and its type off the row and words the timeout", async () => {
    row = {
      status: RunnerJobStatus.Pending,
      origin: RunnerJobOrigin.AiInvestigation,
      stepType: RunbookStepType.ResourceCommand,
      targetResourceAiAgentId: AGENT_ID,
      resourceType: AiResourceType.PodmanHost,
      claimDeadlineAt: new Date(Date.now() - 1000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
    };

    const job: RunnerJob = await RunnerJobService.pollUntilTerminal({
      jobId: JOB_ID,
      claimTimeoutInMs: CLAIM_TIMEOUT_MS,
      executionTimeoutInMs: EXECUTION_TIMEOUT_MS,
    });

    const select: Record<string, unknown> = (
      findOneById.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;

    expect(select["targetResourceAiAgentId"]).toBe(true);
    expect(select["resourceType"]).toBe(true);
    // The Kubernetes target is still read for kubectl rows.
    expect(select["targetKubernetesAiAgentId"]).toBe(true);
    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    expect(job.errorMessage).toContain(
      "The Podman AI agent did not pick up the command in time",
    );
  });

  it("returns a terminal resource job as it is", async () => {
    row = {
      status: RunnerJobStatus.Succeeded,
      stepType: RunbookStepType.ResourceCommand,
      output: "[stdout]\nok",
    };

    const job: RunnerJob = await RunnerJobService.pollUntilTerminal({
      jobId: JOB_ID,
      claimTimeoutInMs: CLAIM_TIMEOUT_MS,
      executionTimeoutInMs: EXECUTION_TIMEOUT_MS,
    });

    expect(job.status).toBe(RunnerJobStatus.Succeeded);
    expect(timeoutSpy).not.toHaveBeenCalled();
  });
});

describe("RunnerJobService.submitResult with the job's resource command", () => {
  let queries: Array<{ sql: string; params: Array<unknown> }>;

  beforeEach(() => {
    queries = [];
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
      query: jest
        .fn()
        .mockImplementation(
          async (sql: string, params: Array<unknown>): Promise<unknown> => {
            queries.push({ sql, params });
            return [[{ _id: JOB_ID.toString() }], 1];
          },
        ),
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const INSPECT_OUTPUT: string =
    '[stdout]\n[{"Id":"abc","Config":{"Env":["FOO_SETTING=plainvalue42","PATH=/usr/bin"]}}]';

  // $10 is the AI-origin output, $11 the AI-origin error (see the UPDATE).
  function aiOriginOutput(): string {
    return queries[queries.length - 1]!.params[9] as string;
  }

  function aiOriginError(): string {
    return queries[queries.length - 1]!.params[10] as string;
  }

  function verbatimOutput(): string {
    return queries[queries.length - 1]!.params[1] as string;
  }

  it("masks every docker inspect environment value for a Docker host's job", async () => {
    await RunnerJobService.submitResult({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: true,
      exitCode: 0,
      output: INSPECT_OUTPUT,
      resourceCommand: {
        resourceType: AiResourceType.DockerHost,
        program: "docker",
      },
    });

    expect(aiOriginOutput()).not.toContain("plainvalue42");
    expect(aiOriginOutput()).toContain("FOO_SETTING=[redacted]");
    // The runbook branch of the CASE keeps the raw text, as always.
    expect(verbatimOutput()).toBe(INSPECT_OUTPUT);
  });

  it("redacts the error message the same way", async () => {
    await RunnerJobService.submitResult({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: false,
      errorMessage:
        '{"query":"SELECT * FROM users WHERE email = \'bob@example.com\' AND pin = 1234"}',
      resourceCommand: {
        resourceType: AiResourceType.DatabaseServer,
        program: "db",
      },
    });

    expect(aiOriginError()).not.toContain("bob@example.com");
    expect(aiOriginError()).not.toContain("1234");
  });

  it("stores exactly what it always has without a resource command", async () => {
    await RunnerJobService.submitResult({
      jobId: JOB_ID,
      agentId: AGENT_ID,
      success: true,
      exitCode: 0,
      output: INSPECT_OUTPUT,
    });

    expect(aiOriginOutput()).toBe(
      RunnerJobServiceClass.redactAiJobText(INSPECT_OUTPUT),
    );
    expect(aiOriginOutput()).toContain("plainvalue42");
  });

  it("redactResourceCommandText is the identity without a resource command", () => {
    expect(RunnerJobServiceClass.redactResourceCommandText("x=1")).toBe("x=1");
    expect(
      RunnerJobServiceClass.redactResourceCommandText(INSPECT_OUTPUT, {
        resourceType: AiResourceType.PodmanHost,
        program: "docker",
      }),
    ).toContain("FOO_SETTING=[redacted]");
  });
});
