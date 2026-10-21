import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import { KUBERNETES_AI_AGENT_JOB_LEASE_MS } from "../../../Server/Services/KubernetesAiAgentJobService";
import ResourceAiAgentJobService, {
  RESOURCE_AI_AGENT_JOB_LEASE_MS,
  Service as ResourceAiAgentJobServiceClass,
} from "../../../Server/Services/ResourceAiAgentJobService";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin, {
  AI_COMMAND_JOB_ORIGINS,
} from "../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../Types/Runbook/RunnerJobStatus";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ResourceAiAgentJobService.claimNextJob — the resource AI agent's only way
 * to lease work:
 *
 *  - only rows targeted at THIS agent (RunnerJob.targetResourceAiAgentId),
 *    in its project, Pending, before their claim deadline, not deleted;
 *  - only ResourceCommand, and only AI-composed (AI_COMMAND_JOB_ORIGINS) —
 *    never a runbook step, a Bash, SSH or kubectl command, whatever the
 *    agent asks for;
 *  - FOR UPDATE SKIP LOCKED, oldest first, one at a time;
 *  - the claim sets Claimed, assignedAgentId (the agent id, so
 *    RunnerJobService.heartbeatJob / submitResult serve it unchanged),
 *    claimedAt and a lease as long as a Runner's.
 *
 * Postgres is replaced by a captured query, so the statement and its
 * parameters are asserted exactly.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const AGENT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const JOB_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const RESOURCE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const AI_RUN_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

interface CapturedQuery {
  sql: string;
  params: Array<unknown>;
}

function claimedRow(overrides: JSONObject = {}): JSONObject {
  return {
    _id: JOB_ID.toString(),
    projectId: PROJECT_ID.toString(),
    origin: RunnerJobOrigin.AiInvestigation,
    aiRunId: AI_RUN_ID.toString(),
    autoRemediationSuggestionId: null,
    kubernetesClusterId: null,
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID.toString(),
    stepId: "resource-1",
    stepType: RunbookStepType.ResourceCommand,
    targetResourceAiAgentId: AGENT_ID.toString(),
    payload: {
      resourceType: AiResourceType.DockerHost,
      resourceId: RESOURCE_ID.toString(),
      resourceIdentifier: "web-1",
      program: "docker",
      args: ["ps", "-a"],
      displayCommand: "docker ps -a",
      tier: "Read",
    },
    timeoutInMs: 30000,
    status: RunnerJobStatus.Claimed,
    claimedAt: "2026-09-28T10:00:00.000Z",
    leaseExpiresAt: "2026-09-28T10:00:30.000Z",
    ...overrides,
  };
}

// Collapse whitespace so the assertions read like the statement.
function normalized(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

describe("ResourceAiAgentJobService.claimNextJob", () => {
  let queries: Array<CapturedQuery>;
  let answer: unknown;

  beforeEach(() => {
    queries = [];
    answer = [[claimedRow()], 1];

    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
      query: async (sql: string, params: Array<unknown>): Promise<unknown> => {
        queries.push({ sql, params });
        return answer;
      },
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function claim(leaseMs?: number): Promise<RunnerJob | null> {
    return ResourceAiAgentJobService.claimNextJob({
      projectId: PROJECT_ID,
      resourceAiAgentId: AGENT_ID,
      ...(leaseMs !== undefined ? { leaseMs } : {}),
    });
  }

  function onlyQuery(): CapturedQuery {
    expect(queries).toHaveLength(1);
    return queries[0]!;
  }

  test("selects only this agent's pending resource commands of AI origin, in its project, before their deadline", async () => {
    await claim();

    const sql: string = normalized(onlyQuery().sql);

    expect(sql).toContain('"projectId" = $1::uuid');
    expect(sql).toContain('"status" = $2');
    expect(sql).toContain('"targetResourceAiAgentId" = $3::uuid');
    expect(sql).toContain('"stepType" = $6');
    expect(sql).toContain('"origin" = ANY($7::text[])');
    expect(sql).toContain('"claimDeadlineAt" > NOW()');
    expect(sql).toContain('"deletedAt" IS NULL');
  });

  // Neither a Runner's nor the Kubernetes AI agent's target is how it finds work.
  test("never matches on a Runner or Kubernetes AI agent target", async () => {
    await claim();

    const sql: string = onlyQuery().sql;
    expect(sql).not.toContain('"targetAgentId"');
    expect(sql).not.toContain('"targetKubernetesAiAgentId"');
  });

  test("locks one row, oldest first, skipping rows another claim holds", async () => {
    await claim();

    expect(normalized(onlyQuery().sql)).toContain(
      'ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED',
    );
  });

  test("claims it: Claimed, assigned to the agent, claimed now, leased, versioned", async () => {
    await claim();

    const sql: string = normalized(onlyQuery().sql);

    expect(sql).toContain('SET "status" = $4');
    expect(sql).toContain('"assignedAgentId" = $3::uuid');
    expect(sql).toContain('"claimedAt" = NOW()');
    expect(sql).toContain(
      "\"leaseExpiresAt\" = NOW() + ($5 || ' milliseconds')::interval",
    );
    expect(sql).toContain('"version" = j."version" + 1');
    expect(sql).toContain('WHERE j."_id" = claimed."_id"');
  });

  test("binds exactly the project, Pending, the agent, Claimed, the lease, ResourceCommand and the AI origins", async () => {
    await claim();

    expect(onlyQuery().params).toEqual([
      PROJECT_ID.toString(),
      RunnerJobStatus.Pending,
      AGENT_ID.toString(),
      RunnerJobStatus.Claimed,
      String(RESOURCE_AI_AGENT_JOB_LEASE_MS),
      RunbookStepType.ResourceCommand,
      AI_COMMAND_JOB_ORIGINS,
    ]);
  });

  test("the AI origins are investigation and remediation — never Runbook", () => {
    expect([...AI_COMMAND_JOB_ORIGINS].sort()).toEqual(
      [RunnerJobOrigin.AiInvestigation, RunnerJobOrigin.AiRemediation].sort(),
    );
    expect(AI_COMMAND_JOB_ORIGINS).not.toContain(RunnerJobOrigin.Runbook);
  });

  test("a lease override is bound as given", async () => {
    await claim(45_000);

    expect(onlyQuery().params[4]).toBe("45000");
  });

  test("returns the claimed job the way the ingress needs it", async () => {
    const job: RunnerJob | null = await claim();

    expect(job).not.toBeNull();
    expect(job!.id!.toString()).toBe(JOB_ID.toString());
    expect(job!.projectId!.toString()).toBe(PROJECT_ID.toString());
    expect(job!.origin).toBe(RunnerJobOrigin.AiInvestigation);
    expect(job!.aiRunId!.toString()).toBe(AI_RUN_ID.toString());
    expect(job!.autoRemediationSuggestionId).toBeUndefined();
    expect(job!.kubernetesClusterId).toBeUndefined();
    expect(job!.resourceType).toBe(AiResourceType.DockerHost);
    expect(job!.resourceId!.toString()).toBe(RESOURCE_ID.toString());
    expect(job!.stepId).toBe("resource-1");
    expect(job!.stepType).toBe(RunbookStepType.ResourceCommand);
    expect(job!.targetResourceAiAgentId!.toString()).toBe(AGENT_ID.toString());
    expect(job!.assignedAgentId!.toString()).toBe(AGENT_ID.toString());
    expect(job!.payload).toEqual(claimedRow()["payload"]);
    expect(job!.timeoutInMs).toBe(30000);
    expect(job!.status).toBe(RunnerJobStatus.Claimed);
    expect(job!.claimedAt!.toISOString()).toBe("2026-09-28T10:00:00.000Z");
    expect(job!.leaseExpiresAt!.toISOString()).toBe("2026-09-28T10:00:30.000Z");
  });

  test("reads the RETURNING columns it maps, the resource columns included", async () => {
    await claim();

    const sql: string = normalized(onlyQuery().sql);

    for (const column of [
      "_id",
      "projectId",
      "origin",
      "aiRunId",
      "autoRemediationSuggestionId",
      "kubernetesClusterId",
      "resourceType",
      "resourceId",
      "stepId",
      "stepType",
      "targetResourceAiAgentId",
      "payload",
      "timeoutInMs",
      "status",
      "claimedAt",
      "leaseExpiresAt",
    ]) {
      expect(sql).toContain(`j."${column}"`);
    }
  });

  test("a remediation job keeps its suggestion id", async () => {
    answer = [
      [
        claimedRow({
          origin: RunnerJobOrigin.AiRemediation,
          aiRunId: null,
          autoRemediationSuggestionId: AI_RUN_ID.toString(),
        }),
      ],
      1,
    ];

    const job: RunnerJob | null = await claim();

    expect(job!.origin).toBe(RunnerJobOrigin.AiRemediation);
    expect(job!.aiRunId).toBeUndefined();
    expect(job!.autoRemediationSuggestionId!.toString()).toBe(
      AI_RUN_ID.toString(),
    );
  });

  test("a row that somehow names a cluster keeps it, so the ingress can refuse it", async () => {
    answer = [[claimedRow({ kubernetesClusterId: RESOURCE_ID.toString() })], 1];

    const job: RunnerJob | null = await claim();

    expect(job!.kubernetesClusterId!.toString()).toBe(RESOURCE_ID.toString());
  });

  test("a stored resource type this build does not know is left out, and a missing resource id too", async () => {
    answer = [[claimedRow({ resourceType: "Mainframe", resourceId: null })], 1];

    const job: RunnerJob | null = await claim();

    expect(job!.resourceType).toBeUndefined();
    expect(job!.resourceId).toBeUndefined();
  });

  test("a row whose target column is somehow empty is still this agent's", async () => {
    answer = [[claimedRow({ targetResourceAiAgentId: null })], 1];

    const job: RunnerJob | null = await claim();

    expect(job!.targetResourceAiAgentId!.toString()).toBe(AGENT_ID.toString());
  });

  test("an unknown origin reads as an investigation, and a non-object payload is dropped", async () => {
    answer = [[claimedRow({ origin: null, payload: "docker ps" })], 1];

    const job: RunnerJob | null = await claim();

    expect(job!.origin).toBe(RunnerJobOrigin.AiInvestigation);
    expect(job!.payload).toBeUndefined();
  });

  test("reads rows whichever shape the driver answers in", async () => {
    answer = [claimedRow()];

    const job: RunnerJob | null = await claim();

    expect(job!.id!.toString()).toBe(JOB_ID.toString());
  });

  test.each([
    ["an empty result", [[], 0]],
    ["no rows", []],
    ["nothing at all", undefined],
  ])("%s is no job", async (_label: string, result: unknown) => {
    answer = result;

    await expect(claim()).resolves.toBeNull();
  });

  test("a disconnected database is an error, not an empty queue", async () => {
    jest
      .spyOn(PostgresAppInstance, "getDataSource")
      .mockReturnValue(null as never);

    await expect(claim()).rejects.toBeInstanceOf(BadDataException);
  });

  test("the default export is an instance of the exported class", () => {
    expect(ResourceAiAgentJobService).toBeInstanceOf(
      ResourceAiAgentJobServiceClass,
    );
  });
});

describe("the claim matches RunnerJobService's", () => {
  const RUNNER_JOB_SERVICE_SOURCE: string = fs.readFileSync(
    path.join(__dirname, "../../../Server/Services/RunnerJobService.ts"),
    "utf-8",
  );

  /*
   * The job heartbeat and result go through RunnerJobService, which renews
   * leases by its own DEFAULT_LEASE_MS; a claim granting a different lease
   * would make the first renewal change the agent's deadline under it.
   */
  test("the lease is as long as a Runner's, and the Kubernetes AI agent's", () => {
    const match: RegExpMatchArray | null = RUNNER_JOB_SERVICE_SOURCE.match(
      /const DEFAULT_LEASE_MS: number = ([\d_]+);/,
    );

    expect(match).not.toBeNull();
    expect(Number(match![1]!.replace(/_/g, ""))).toBe(
      RESOURCE_AI_AGENT_JOB_LEASE_MS,
    );
    expect(RESOURCE_AI_AGENT_JOB_LEASE_MS).toBe(
      KUBERNETES_AI_AGENT_JOB_LEASE_MS,
    );
  });

  test("heartbeatJob and submitResult key on assignedAgentId, which the claim sets to the agent's id", () => {
    expect(RUNNER_JOB_SERVICE_SOURCE).toMatch(
      /public async heartbeatJob[\s\S]*?"assignedAgentId" = \$3::uuid/,
    );
    expect(RUNNER_JOB_SERVICE_SOURCE).toMatch(
      /public async submitResult[\s\S]*?"assignedAgentId" = \$6::uuid/,
    );
  });
});
