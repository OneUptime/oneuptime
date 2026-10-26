import AIRunService from "../../../Server/Services/AIRunService";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import ObjectID from "../../../Types/ObjectID";
import {
  CodeWorker,
  CodeWorkerKind,
} from "../../../Types/Runner/CodeRepositoryRunner";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — code-fix claim tenancy.
 *
 * The OneUptime Runner is installed by customers with a PROJECT-SCOPED
 * credential, so its claim must be filtered to that project: without the
 * filter a Runner would claim the oldest queued code-fix run in the whole
 * deployment and work in another tenant's repository. A global Runner
 * carries no projectId — it keeps serving every project that uses global
 * Runners, which is why the filter is conditional rather than mandatory.
 *
 * The candidate is read by SQL built from who claims (CodeFixClaimQuery,
 * whose conditions have their own suite), then read again by id, still
 * Queued and still in the claimer's project, before it is claimed.
 */

const AGENT_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const PROJECT_RUNNER: CodeWorker = {
  kind: CodeWorkerKind.ProjectRunner,
  id: AGENT_ID,
};

const GLOBAL_RUNNER: CodeWorker = {
  kind: CodeWorkerKind.GlobalRunner,
  id: AGENT_ID,
};

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

// The candidate query's statements, answered with these rows.
function mockCandidateQuery(
  rows: Array<Record<string, unknown>>,
): Array<Statement> {
  const statements: Array<Statement> = [];

  jest.spyOn(AIRunService, "getRepository").mockReturnValue({
    manager: {
      query: async (
        sql: string,
        parameters: Array<unknown>,
      ): Promise<Array<Record<string, unknown>>> => {
        statements.push({ sql, parameters });
        return rows;
      },
    },
  } as unknown as ReturnType<typeof AIRunService.getRepository>);

  return statements;
}

describe("AIRunService.claimNextQueuedCodeFixRun — tenancy scoping", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("scopes the candidate query to the agent's project when it has one", async () => {
    const statements: Array<Statement> = mockCandidateQuery([]);
    const read: jest.SpyInstance = jest.spyOn(AIRunService, "findOneBy");

    expect(
      await AIRunService.claimNextQueuedCodeFixRun({
        aiAgentId: AGENT_ID,
        projectId: PROJECT_ID,
        worker: PROJECT_RUNNER,
      }),
    ).toBeNull();

    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).toContain(`"run"."projectId" = $4::uuid`);
    expect(statements[0]!.parameters[0]).toBe(AIRunType.CodeFix);
    expect(statements[0]!.parameters[1]).toBe(AIRunStatus.Queued);
    expect(statements[0]!.parameters[3]).toBe(PROJECT_ID.toString());
    /*
     * ...and to the repositories that pick this Runner, or none known yet -
     * or, while it is the project's default Runner, that follow it.
     */
    expect(statements[0]!.sql).toContain(
      `("repository"."runnerId" = $5::uuid OR "repository"."_id" IS NULL OR (`,
    );
    expect(statements[0]!.sql).toContain(
      `"defaultRunner"."_id" = $5::uuid AND "defaultRunner"."projectId" = "run"."projectId"`,
    );
    expect(statements[0]!.parameters[4]).toBe(AGENT_ID.toString());
    // No candidate: nothing is read or claimed.
    expect(read).not.toHaveBeenCalled();
  });

  it("leaves the query unscoped for a global Runner (no projectId)", async () => {
    const statements: Array<Statement> = mockCandidateQuery([]);

    await AIRunService.claimNextQueuedCodeFixRun({
      aiAgentId: AGENT_ID,
      worker: GLOBAL_RUNNER,
    });

    expect(statements[0]!.sql).not.toContain(`"run"."projectId" =`);
    // Every project that uses global Runners, and repositories picking none.
    expect(statements[0]!.sql).toContain(`"project"."useGlobalRunners" = true`);
    expect(statements[0]!.sql).toContain(`"repository"."runnerId" IS NULL`);
  });

  it("a project's Runner without a project takes nothing", async () => {
    const statements: Array<Statement> = mockCandidateQuery([]);

    expect(
      await AIRunService.claimNextQueuedCodeFixRun({
        aiAgentId: AGENT_ID,
        worker: PROJECT_RUNNER,
      }),
    ).toBeNull();

    expect(statements[0]!.sql).toContain(" AND false");
  });

  it("still claims a matching run in the agent's own project", async () => {
    mockCandidateQuery([{ _id: RUN_ID.toString() }]);

    const read: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue({
        id: RUN_ID,
        _id: RUN_ID.toString(),
        projectId: PROJECT_ID,
        attemptCount: 0,
        triggeredByTelemetryExceptionId: new ObjectID(
          "44444444-4444-4444-8444-444444444444",
        ),
      } as unknown as AIRun);
    const claim: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);

    await AIRunService.claimNextQueuedCodeFixRun({
      aiAgentId: AGENT_ID,
      projectId: PROJECT_ID,
      worker: PROJECT_RUNNER,
    });

    // The candidate is read again by id, still Queued, in the project.
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          _id: RUN_ID.toString(),
          runType: AIRunType.CodeFix,
          status: AIRunStatus.Queued,
          projectId: PROJECT_ID,
        }),
      }),
    );

    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId: RUN_ID,
        fromStatus: AIRunStatus.Queued,
        set: expect.objectContaining({
          status: AIRunStatus.Running,
          aiAgentId: AGENT_ID.toString(),
        }),
      }),
    );
  });

  it("a global Runner's candidate is read again without a project", async () => {
    mockCandidateQuery([{ _id: RUN_ID.toString() }]);

    const read: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(null);

    await AIRunService.claimNextQueuedCodeFixRun({
      aiAgentId: AGENT_ID,
      worker: GLOBAL_RUNNER,
    });

    const query: Record<string, unknown> = (
      read.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query["_id"]).toBe(RUN_ID.toString());
    expect(query["status"]).toBe(AIRunStatus.Queued);
    expect(query["projectId"]).toBeUndefined();
  });
});
