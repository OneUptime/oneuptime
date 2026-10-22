import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "../../../../Types/AI/CodeFixTaskType";
import ObjectID from "../../../../Types/ObjectID";
import {
  CodeWorker,
  CodeWorkerKind,
} from "../../../../Types/Runner/CodeRepositoryRunner";

/*
 * WHICH QUEUED CODE-FIX RUNS A WORKER MAY TAKE - the repository's Runner
 * choice (Types/Runner/CodeRepositoryRunner) as one SQL condition, so the
 * claim and the queue count a worker autoscales on read the same runs.
 *
 * A run is matched to its repository (joined, so the rule reads the
 * repository's Runner as it is now, not as it was when the run was queued):
 *
 *   - a project's Runner takes the runs of the repositories that pick it,
 *     in its own project;
 *   - an AI agent of a project's own takes its project's runs of
 *     repositories that pick no Runner;
 *   - a global Runner takes the runs of repositories that pick no Runner,
 *     of every project that uses global Runners.
 *
 * A run whose repository is not known yet (one that finds it as it works,
 * queued before it could be decided) has no Runner to pick, so any worker
 * that may serve its project takes it; the repository token, which is the
 * only way into a repository, is then given only to the worker the
 * repository picks.
 */

export interface CodeFixClaimQueryFacts {
  worker: CodeWorker;
  // The worker's project; every worker but a global Runner has one.
  projectId?: ObjectID | undefined;
  // The recipes the worker has handlers for (a null recipe is FixException).
  claimableTaskTypes: Array<CodeFixTaskType>;
}

export interface CodeFixClaimCondition {
  // The WHERE condition, with "run" the AIRun and "repository" its CodeRepository.
  condition: string;
  parameters: Array<unknown>;
}

export interface CodeFixClaimStatement {
  sql: string;
  parameters: Array<unknown>;
}

// The join every statement reads the run's repository through.
const REPOSITORY_JOIN: string = `LEFT JOIN "CodeRepository" AS "repository" ON "repository"."_id" = "run"."codeRepositoryId" AND "repository"."deletedAt" IS NULL`;

export default class CodeFixClaimQuery {
  /*
   * The condition a queued code-fix run must meet for this worker to take
   * it. A worker that may take nothing (a project's Runner or agent with no
   * project) gets a condition no run meets.
   */
  public static getCondition(
    facts: CodeFixClaimQueryFacts,
  ): CodeFixClaimCondition {
    const parameters: Array<unknown> = [
      AIRunType.CodeFix,
      AIRunStatus.Queued,
      /*
       * Never a recipe the server runs itself (a production review), even
       * when the list handed in names one: no worker may take it.
       */
      facts.claimableTaskTypes
        .filter((taskType: CodeFixTaskType): boolean => {
          return !CodeFixTaskTypeHelper.isRunByServer(taskType);
        })
        .map((taskType: CodeFixTaskType): string => {
          return taskType;
        }),
    ];

    const conditions: Array<string> = [
      `"run"."runType" = $1`,
      `"run"."status" = $2`,
      `"run"."deletedAt" IS NULL`,
      `("run"."codeFixTaskType" IS NULL OR "run"."codeFixTaskType" = ANY($3::text[]))`,
    ];

    const addParameter: (value: unknown) => string = (
      value: unknown,
    ): string => {
      parameters.push(value);
      return `$${parameters.length}`;
    };

    switch (facts.worker.kind) {
      case CodeWorkerKind.ProjectRunner: {
        if (!facts.projectId) {
          conditions.push("false");
          break;
        }

        conditions.push(
          `"run"."projectId" = ${addParameter(facts.projectId.toString())}::uuid`,
        );
        conditions.push(
          `("repository"."runnerId" = ${addParameter(
            facts.worker.id.toString(),
          )}::uuid OR "repository"."_id" IS NULL)`,
        );
        break;
      }
      case CodeWorkerKind.ProjectAgent: {
        if (!facts.projectId) {
          conditions.push("false");
          break;
        }

        conditions.push(
          `"run"."projectId" = ${addParameter(facts.projectId.toString())}::uuid`,
        );
        conditions.push(`"repository"."runnerId" IS NULL`);
        break;
      }
      case CodeWorkerKind.GlobalRunner: {
        conditions.push(`"repository"."runnerId" IS NULL`);
        conditions.push(
          `EXISTS (SELECT 1 FROM "Project" AS "project" WHERE "project"."_id" = "run"."projectId" AND "project"."useGlobalRunners" = true AND "project"."deletedAt" IS NULL)`,
        );
        break;
      }
      default: {
        const unhandled: never = facts.worker.kind;
        conditions.push(`false /* ${String(unhandled)} */`);
      }
    }

    return {
      condition: conditions.join(" AND "),
      parameters,
    };
  }

  // The oldest run this worker may take, as its id (one row of "_id").
  public static getNextRunStatement(
    facts: CodeFixClaimQueryFacts,
  ): CodeFixClaimStatement {
    const query: CodeFixClaimCondition = CodeFixClaimQuery.getCondition(facts);

    return {
      sql: `SELECT "run"."_id" FROM "AIRun" AS "run" ${REPOSITORY_JOIN} WHERE ${query.condition} ORDER BY "run"."createdAt" ASC LIMIT 1`,
      parameters: query.parameters,
    };
  }

  // How many runs this worker may take now (one row of "count").
  public static getCountStatement(
    facts: CodeFixClaimQueryFacts,
  ): CodeFixClaimStatement {
    const query: CodeFixClaimCondition = CodeFixClaimQuery.getCondition(facts);

    return {
      sql: `SELECT COUNT(*)::int AS "count" FROM "AIRun" AS "run" ${REPOSITORY_JOIN} WHERE ${query.condition}`,
      parameters: query.parameters,
    };
  }
}
