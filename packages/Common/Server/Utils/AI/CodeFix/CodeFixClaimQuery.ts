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
import { KUBERNETES_AGENT_RUNNER_NAME_PREFIX } from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";

/*
 * WHICH QUEUED CODE-FIX RUNS A WORKER MAY TAKE - the repository's Runner
 * choice (Types/Runner/CodeRepositoryRunner) as one SQL condition, so the
 * claim and the queue count a worker autoscales on read the same runs.
 *
 * A run is matched to its repository (joined, so the rule reads the
 * repository's Runner as it is now, not as it was when the run was queued):
 *
 *   - a project's Runner takes the runs of the repositories that pick it,
 *     in its own project - and, while it is the project's default Runner,
 *     those of the repositories that follow it (pick no Runner, and not the
 *     Global Runner);
 *   - an AI agent of a project's own takes its project's runs of
 *     repositories that pick no Runner;
 *   - a global Runner takes the runs of repositories that pick no Runner,
 *     of every project that uses global Runners - those that picked the
 *     Global Runner, and those that follow a project default the project
 *     does not have.
 *
 * The project's default Runner is read here as the rule of
 * Types/Runner/ProjectDefaultRunner reads it (PROJECT_DEFAULT_RUNNER_IS): a
 * project's Runner marked its default that is not a global Runner, runs
 * runbooks and is not the in-cluster Runner the Kubernetes agent chart
 * installed (by its server-owned name).
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

// A repository that follows its project's default Runner.
const REPOSITORY_FOLLOWS_PROJECT_DEFAULT: string = `"repository"."_id" IS NOT NULL AND "repository"."runnerId" IS NULL AND "repository"."isGlobalRunnerPicked" IS NOT TRUE`;

/*
 * The Runner row "defaultRunner" is its project's default Runner, by the
 * rule a default must meet (canBeProjectDefaultRunner). The name prefix is
 * the statement's parameter `namePattern` names.
 */
function getProjectDefaultRunnerIs(namePattern: string): string {
  return `"defaultRunner"."isProjectDefault" = true AND "defaultRunner"."deletedAt" IS NULL AND "defaultRunner"."isGlobalRunner" IS NOT TRUE AND "defaultRunner"."canRunRunbooks" IS NOT FALSE AND COALESCE(lower(btrim("defaultRunner"."name")), '') NOT LIKE ${namePattern}`;
}

// What the in-cluster Runner the Kubernetes agent chart installed is named.
export const KUBERNETES_AGENT_RUNNER_NAME_PATTERN: string = `${KUBERNETES_AGENT_RUNNER_NAME_PREFIX}/%`;

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

        const workerId: string = addParameter(facts.worker.id.toString());

        /*
         * The repositories that pick it, those that follow the project's
         * default Runner while it is that Runner, and runs whose
         * repository is not known yet.
         */
        conditions.push(
          `("repository"."runnerId" = ${workerId}::uuid OR "repository"."_id" IS NULL OR (${REPOSITORY_FOLLOWS_PROJECT_DEFAULT} AND EXISTS (SELECT 1 FROM "Runner" AS "defaultRunner" WHERE "defaultRunner"."_id" = ${workerId}::uuid AND "defaultRunner"."projectId" = "run"."projectId" AND ${getProjectDefaultRunnerIs(
            addParameter(KUBERNETES_AGENT_RUNNER_NAME_PATTERN),
          )})))`,
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

        /*
         * Never a repository that follows its project's default Runner
         * while the project has one: that Runner takes it.
         */
        conditions.push(
          `NOT (${REPOSITORY_FOLLOWS_PROJECT_DEFAULT} AND EXISTS (SELECT 1 FROM "Runner" AS "defaultRunner" WHERE "defaultRunner"."projectId" = "run"."projectId" AND ${getProjectDefaultRunnerIs(
            addParameter(KUBERNETES_AGENT_RUNNER_NAME_PATTERN),
          )}))`,
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
