import AIRunService from "../../../Services/AIRunService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import { CodeFixTaskTypeHelper } from "../../../../Types/AI/CodeFixTaskType";
import { CodeRepositoryTaskStatsJSON } from "../../../../Types/AI/CodeTask";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHAT CODE'S FIRST PAGE SAYS OF EACH REPOSITORY AT A GLANCE: how many of its
 * tasks AI is working on, how many wait for the person's answer, its open
 * pull requests from AI, how many tasks it has, and when anything last
 * happened in it.
 *
 * Three grouped reads for every repository on the page at once, as root and
 * pinned to the project - the caller was allowed to read these repositories
 * before their ids got here. Every value is a bound parameter.
 *
 * A pull request's production review is not one of a repository's tasks
 * here: it is OneUptime's, it has its own page, and a review in progress is
 * not AI working for someone.
 */

// The recipes left out of a repository's tasks: the server's own.
const NOT_TASKS: Array<string> = CodeFixTaskTypeHelper.getServerRunTaskTypes();

// The statuses of a turn still in progress.
export const WORKING_STATUSES: Array<AIRunStatus> = [
  AIRunStatus.Queued,
  AIRunStatus.Running,
  AIRunStatus.WaitingForApproval,
];

type QueryRows = Array<Record<string, unknown>>;

export default class CodeTaskStats {
  @CaptureSpan()
  public static async getRepositoryStats(data: {
    projectId: ObjectID;
    repositoryIds: Array<ObjectID>;
  }): Promise<Map<string, CodeRepositoryTaskStatsJSON>> {
    const stats: Map<string, CodeRepositoryTaskStatsJSON> = new Map<
      string,
      CodeRepositoryTaskStatsJSON
    >();

    const repositoryIds: Array<string> = data.repositoryIds.map(
      (id: ObjectID): string => {
        return id.toString();
      },
    );

    for (const repositoryId of repositoryIds) {
      stats.set(repositoryId, CodeTaskStats.empty());
    }

    if (repositoryIds.length === 0) {
      return stats;
    }

    const query: (
      sql: string,
      parameters: Array<unknown>,
    ) => Promise<QueryRows> = async (
      sql: string,
      parameters: Array<unknown>,
    ): Promise<QueryRows> => {
      return (await AIRunService.getRepository().manager.query(
        sql,
        parameters,
      )) as QueryRows;
    };

    const projectId: string = data.projectId.toString();

    const [runRows, waitingRows, pullRequestRows]: [
      QueryRows,
      QueryRows,
      QueryRows,
    ] = await Promise.all([
      query(
        `SELECT "codeRepositoryId",
          COUNT(*) FILTER (WHERE "status" = ANY($3::text[]))::int AS "working",
          COUNT(*) FILTER (WHERE "codeTaskId" IS NULL)::int AS "taskCount",
          MAX(GREATEST("createdAt", COALESCE("completedAt", "createdAt"))) AS "lastActivityAt"
        FROM "AIRun"
        WHERE "projectId" = $1 AND "runType" = $4 AND "deletedAt" IS NULL
          AND "codeRepositoryId" = ANY($2::uuid[])
          AND ("codeFixTaskType" IS NULL OR "codeFixTaskType" <> ALL($5::text[]))
        GROUP BY "codeRepositoryId"`,
        [
          projectId,
          repositoryIds,
          WORKING_STATUSES,
          AIRunType.CodeFix,
          NOT_TASKS,
        ],
      ),
      /*
       * A task waits for its person when its LATEST turn ended asking them
       * something: the newest run of each task (its first run and its
       * replies share COALESCE("codeTaskId", "_id")).
       */
      query(
        `SELECT "latest"."codeRepositoryId", COUNT(*)::int AS "waitingForYou"
        FROM (
          SELECT DISTINCT ON (COALESCE("codeTaskId", "_id"))
            "codeRepositoryId", "status", "needsUserInput"
          FROM "AIRun"
          WHERE "projectId" = $1 AND "runType" = $3 AND "deletedAt" IS NULL
            AND "codeRepositoryId" = ANY($2::uuid[])
            AND ("codeFixTaskType" IS NULL OR "codeFixTaskType" <> ALL($5::text[]))
          ORDER BY COALESCE("codeTaskId", "_id"), "createdAt" DESC
        ) AS "latest"
        WHERE "latest"."status" = $4 AND "latest"."needsUserInput" = true
        GROUP BY "latest"."codeRepositoryId"`,
        [
          projectId,
          repositoryIds,
          AIRunType.CodeFix,
          AIRunStatus.Completed,
          NOT_TASKS,
        ],
      ),
      query(
        `SELECT "codeRepositoryId", COUNT(*)::int AS "openPullRequests"
        FROM "AIAgentTaskPullRequest"
        WHERE "projectId" = $1 AND "deletedAt" IS NULL
          AND "pullRequestState" = $3
          AND "codeRepositoryId" = ANY($2::uuid[])
        GROUP BY "codeRepositoryId"`,
        [projectId, repositoryIds, PullRequestState.Open],
      ),
    ]);

    for (const row of runRows) {
      const entry: CodeRepositoryTaskStatsJSON | undefined = stats.get(
        String(row["codeRepositoryId"]),
      );

      if (!entry) {
        continue;
      }

      entry.working = CodeTaskStats.toCount(row["working"]);
      entry.taskCount = CodeTaskStats.toCount(row["taskCount"]);

      const lastActivityAt: unknown = row["lastActivityAt"];

      if (lastActivityAt) {
        entry.lastActivityAt = new Date(
          lastActivityAt as string | Date,
        ).toISOString();
      }
    }

    for (const row of waitingRows) {
      const entry: CodeRepositoryTaskStatsJSON | undefined = stats.get(
        String(row["codeRepositoryId"]),
      );

      if (entry) {
        entry.waitingForYou = CodeTaskStats.toCount(row["waitingForYou"]);
      }
    }

    for (const row of pullRequestRows) {
      const entry: CodeRepositoryTaskStatsJSON | undefined = stats.get(
        String(row["codeRepositoryId"]),
      );

      if (entry) {
        entry.openPullRequests = CodeTaskStats.toCount(row["openPullRequests"]);
      }
    }

    return stats;
  }

  // How many tasks have no repository (Code lists them as Other tasks).
  @CaptureSpan()
  public static async countTasksWithoutRepository(
    projectId: ObjectID,
  ): Promise<number> {
    return (
      await AIRunService.countBy({
        query: {
          projectId: projectId,
          runType: AIRunType.CodeFix,
          codeTaskId: QueryHelper.isNull(),
          codeRepositoryId: QueryHelper.isNull(),
        },
        props: { isRoot: true },
      })
    ).toNumber();
  }

  public static empty(): CodeRepositoryTaskStatsJSON {
    return {
      working: 0,
      waitingForYou: 0,
      openPullRequests: 0,
      taskCount: 0,
    };
  }

  private static toCount(value: unknown): number {
    const count: number = Number(value);

    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  }
}
