import CodeFixClaimQuery, {
  CodeFixClaimCondition,
  CodeFixClaimStatement,
} from "../../../../../Server/Utils/AI/CodeFix/CodeFixClaimQuery";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import ObjectID from "../../../../../Types/ObjectID";
import { CodeWorkerKind } from "../../../../../Types/Runner/CodeRepositoryRunner";
import { describe, expect, test } from "@jest/globals";

/*
 * Which queued code-fix runs a worker may take, as SQL: the repository's
 * Runner choice read through the run's repository as it is now. The text is
 * pinned here; CodeFixClaimPostgres runs it on a real Postgres.
 */

const RUNNER_ID: ObjectID = new ObjectID(
  "0a1b2c3d-1111-4222-8333-944455556666",
);
const AGENT_ID: ObjectID = new ObjectID("0a1b2c3d-2222-4222-8333-944455556666");
const PROJECT_ID: ObjectID = new ObjectID(
  "0a1b2c3d-4444-4222-8333-944455556666",
);

const TASK_TYPES: Array<CodeFixTaskType> = [
  CodeFixTaskType.FixException,
  CodeFixTaskType.CodeRequest,
];

function conditionFor(
  kind: CodeWorkerKind,
  projectId?: ObjectID,
): CodeFixClaimCondition {
  return CodeFixClaimQuery.getCondition({
    worker: {
      kind,
      id: kind === CodeWorkerKind.ProjectRunner ? RUNNER_ID : AGENT_ID,
    },
    ...(projectId ? { projectId } : {}),
    claimableTaskTypes: TASK_TYPES,
  });
}

describe("CodeFixClaimQuery: never a recipe the server runs itself", () => {
  test("a production review named among a worker's recipes is left out of the claim", () => {
    for (const kind of Object.values(CodeWorkerKind)) {
      const condition: CodeFixClaimCondition = CodeFixClaimQuery.getCondition({
        worker: {
          kind,
          id: kind === CodeWorkerKind.ProjectRunner ? RUNNER_ID : AGENT_ID,
        },
        projectId: PROJECT_ID,
        claimableTaskTypes: [
          CodeFixTaskType.GitHubPullRequestProductionReview,
          CodeFixTaskType.FixException,
        ],
      });

      expect(condition.parameters[2]).toEqual([CodeFixTaskType.FixException]);
    }
  });

  test("so does the count a worker autoscales on", () => {
    const statement: CodeFixClaimStatement =
      CodeFixClaimQuery.getCountStatement({
        worker: { kind: CodeWorkerKind.GlobalRunner, id: AGENT_ID },
        claimableTaskTypes: [CodeFixTaskType.GitHubPullRequestProductionReview],
      });

    expect(statement.parameters[2]).toEqual([]);
  });
});

describe("CodeFixClaimQuery.getCondition", () => {
  test("every worker reads only queued code-fix runs of its recipes, not deleted", () => {
    for (const kind of Object.values(CodeWorkerKind)) {
      const condition: CodeFixClaimCondition = conditionFor(kind, PROJECT_ID);

      expect(condition.condition).toContain(`"run"."runType" = $1`);
      expect(condition.condition).toContain(`"run"."status" = $2`);
      expect(condition.condition).toContain(`"run"."deletedAt" IS NULL`);
      // A null recipe is FixException (rows from before recipes existed).
      expect(condition.condition).toContain(
        `("run"."codeFixTaskType" IS NULL OR "run"."codeFixTaskType" = ANY($3::text[]))`,
      );
      expect(condition.parameters.slice(0, 3)).toEqual([
        AIRunType.CodeFix,
        AIRunStatus.Queued,
        TASK_TYPES,
      ]);
    }
  });

  test("a project's Runner takes its own project's runs of the repositories that pick it, and runs with no repository yet", () => {
    const condition: CodeFixClaimCondition = conditionFor(
      CodeWorkerKind.ProjectRunner,
      PROJECT_ID,
    );

    expect(condition.condition).toContain(`"run"."projectId" = $4::uuid`);
    expect(condition.condition).toContain(
      `("repository"."runnerId" = $5::uuid OR "repository"."_id" IS NULL)`,
    );
    expect(condition.parameters[3]).toBe(PROJECT_ID.toString());
    expect(condition.parameters[4]).toBe(RUNNER_ID.toString());
    // Never a repository that picks none: those go to a global Runner.
    expect(condition.condition).not.toContain(`"runnerId" IS NULL`);
  });

  test("an AI agent of the project's own takes its project's runs of repositories that pick no Runner", () => {
    const condition: CodeFixClaimCondition = conditionFor(
      CodeWorkerKind.ProjectAgent,
      PROJECT_ID,
    );

    expect(condition.condition).toContain(`"run"."projectId" = $4::uuid`);
    expect(condition.condition).toContain(`"repository"."runnerId" IS NULL`);
    expect(condition.parameters).toHaveLength(4);
    // Whatever the project's switch says: it is the project's own.
    expect(condition.condition).not.toContain(`"useGlobalRunners"`);
  });

  test("a global Runner takes every project's runs of repositories that pick no Runner, while the project uses global Runners", () => {
    const condition: CodeFixClaimCondition = conditionFor(
      CodeWorkerKind.GlobalRunner,
    );

    expect(condition.condition).not.toContain(`"run"."projectId" =`);
    expect(condition.condition).toContain(`"repository"."runnerId" IS NULL`);
    expect(condition.condition).toContain(
      `EXISTS (SELECT 1 FROM "Project" AS "project" WHERE "project"."_id" = "run"."projectId" AND "project"."useGlobalRunners" = true AND "project"."deletedAt" IS NULL)`,
    );
    expect(condition.parameters).toHaveLength(3);
  });

  test("a project's Runner or agent with no project takes nothing", () => {
    for (const kind of [
      CodeWorkerKind.ProjectRunner,
      CodeWorkerKind.ProjectAgent,
    ]) {
      const condition: CodeFixClaimCondition = conditionFor(kind);

      expect(condition.condition.endsWith(" AND false")).toBe(true);
      expect(condition.parameters).toHaveLength(3);
    }
  });

  test("values only ever travel as parameters, never in the SQL text", () => {
    const condition: CodeFixClaimCondition = conditionFor(
      CodeWorkerKind.ProjectRunner,
      PROJECT_ID,
    );

    expect(condition.condition).not.toContain(RUNNER_ID.toString());
    expect(condition.condition).not.toContain(PROJECT_ID.toString());
    expect(condition.condition).not.toContain(CodeFixTaskType.FixException);
  });
});

describe("CodeFixClaimQuery statements", () => {
  test("the claim reads the oldest run the worker may take, through its repository", () => {
    const statement: CodeFixClaimStatement =
      CodeFixClaimQuery.getNextRunStatement({
        worker: { kind: CodeWorkerKind.GlobalRunner, id: AGENT_ID },
        claimableTaskTypes: TASK_TYPES,
      });

    expect(statement.sql).toContain(`SELECT "run"."_id" FROM "AIRun" AS "run"`);
    expect(statement.sql).toContain(
      `LEFT JOIN "CodeRepository" AS "repository" ON "repository"."_id" = "run"."codeRepositoryId" AND "repository"."deletedAt" IS NULL`,
    );
    expect(
      statement.sql.endsWith(`ORDER BY "run"."createdAt" ASC LIMIT 1`),
    ).toBe(true);
  });

  test("the queue count reads the same runs by the same condition", () => {
    const facts: Parameters<typeof CodeFixClaimQuery.getCountStatement>[0] = {
      worker: { kind: CodeWorkerKind.ProjectRunner, id: RUNNER_ID },
      projectId: PROJECT_ID,
      claimableTaskTypes: TASK_TYPES,
    };
    const count: CodeFixClaimStatement =
      CodeFixClaimQuery.getCountStatement(facts);
    const next: CodeFixClaimStatement =
      CodeFixClaimQuery.getNextRunStatement(facts);
    const condition: CodeFixClaimCondition =
      CodeFixClaimQuery.getCondition(facts);

    expect(count.sql).toContain(`SELECT COUNT(*)::int AS "count"`);
    expect(count.sql).toContain(`WHERE ${condition.condition}`);
    expect(next.sql).toContain(`WHERE ${condition.condition}`);
    expect(count.parameters).toEqual(next.parameters);
  });
});
