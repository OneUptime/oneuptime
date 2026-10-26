import CodeFixClaimQuery, {
  CodeFixClaimCondition,
  CodeFixClaimStatement,
  KUBERNETES_AGENT_RUNNER_NAME_PATTERN,
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

// A repository that follows its project's default Runner, in the SQL.
const FOLLOWS_PROJECT_DEFAULT: string = `"repository"."_id" IS NOT NULL AND "repository"."runnerId" IS NULL AND "repository"."isGlobalRunnerPicked" IS NOT TRUE`;

// The project's default Runner, by the rule a default must meet.
function projectDefaultIs(namePattern: string): string {
  return `"defaultRunner"."isProjectDefault" = true AND "defaultRunner"."deletedAt" IS NULL AND "defaultRunner"."isGlobalRunner" IS NOT TRUE AND "defaultRunner"."canRunRunbooks" IS NOT FALSE AND COALESCE(lower(btrim("defaultRunner"."name")), '') NOT LIKE ${namePattern}`;
}

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
      `("repository"."runnerId" = $5::uuid OR "repository"."_id" IS NULL OR (`,
    );
    expect(condition.parameters[3]).toBe(PROJECT_ID.toString());
    expect(condition.parameters[4]).toBe(RUNNER_ID.toString());
  });

  /*
   * A repository that picks no Runner follows the project's default Runner
   * (Types/Runner/CodeRepositoryRunner): the default takes its runs - read
   * as the default is now, so making another Runner the default moves them
   * - and no other Runner of the project does.
   */
  test("a project's Runner takes the runs of the repositories that follow it while it is the project's default Runner", () => {
    const condition: CodeFixClaimCondition = conditionFor(
      CodeWorkerKind.ProjectRunner,
      PROJECT_ID,
    );

    expect(condition.condition).toContain(
      `("repository"."runnerId" = $5::uuid OR "repository"."_id" IS NULL OR (${FOLLOWS_PROJECT_DEFAULT} AND EXISTS (SELECT 1 FROM "Runner" AS "defaultRunner" WHERE "defaultRunner"."_id" = $5::uuid AND "defaultRunner"."projectId" = "run"."projectId" AND ${projectDefaultIs("$6")})))`,
    );
    expect(condition.parameters[5]).toBe(KUBERNETES_AGENT_RUNNER_NAME_PATTERN);
    expect(KUBERNETES_AGENT_RUNNER_NAME_PATTERN).toBe("kubernetes-agent/%");
    expect(condition.parameters).toHaveLength(6);
    // A repository that picked the Global Runner is never one of them.
    expect(condition.condition).toContain(
      `"repository"."isGlobalRunnerPicked" IS NOT TRUE`,
    );
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
    expect(condition.parameters).toHaveLength(4);
  });

  test("a global Runner never takes a run of a repository that follows a default Runner its project has", () => {
    const condition: CodeFixClaimCondition = conditionFor(
      CodeWorkerKind.GlobalRunner,
    );

    expect(condition.condition).toContain(
      `NOT (${FOLLOWS_PROJECT_DEFAULT} AND EXISTS (SELECT 1 FROM "Runner" AS "defaultRunner" WHERE "defaultRunner"."projectId" = "run"."projectId" AND ${projectDefaultIs("$4")}))`,
    );
    expect(condition.parameters[3]).toBe(KUBERNETES_AGENT_RUNNER_NAME_PATTERN);
  });

  test("a legacy AI agent of the project's own is not held to the default: it serves every repository that picks no Runner", () => {
    const condition: CodeFixClaimCondition = conditionFor(
      CodeWorkerKind.ProjectAgent,
      PROJECT_ID,
    );

    expect(condition.condition).not.toContain(`"defaultRunner"`);
    expect(condition.condition).not.toContain(`"isGlobalRunnerPicked"`);
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
