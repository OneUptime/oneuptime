import AIRunService from "../../../Services/AIRunService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import AIRunOutputReadFilter from "../AIRunOutputReadFilter";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
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
 * before their ids got here - and to what the reader may read of them: a
 * task about or carrying a private incident or alert they do not see, and
 * its pull requests, count for none of theirs (AIRunOutputReadFilter,
 * #9165, #9186), nor does a pull request a chat about one opened. Every
 * value is a bound parameter.
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

/*
 * When anything last happened in a repository: its newest run's start, or
 * its end once it ended - the same moment getRepositoryStats says and
 * getLastActivity orders Code's Repositories page by.
 */
const LAST_ACTIVITY_SQL: string = `MAX(GREATEST("createdAt", COALESCE("completedAt", "createdAt")))`;

export default class CodeTaskStats {
  /*
   * When anything last happened in each repository, by id (lower-cased),
   * as getRepositoryStats says it - one grouped read for every repository
   * at once, so Code's Repositories page orders all the reader's
   * repositories by it, not only one page of them (#10764). A repository
   * nothing happened in is left out. What the reader may not read counts
   * for nothing, as in getRepositoryStats.
   */
  @CaptureSpan()
  public static async getLastActivity(data: {
    projectId: ObjectID;
    repositoryIds: Array<ObjectID>;
    reader: DatabaseCommonInteractionProps;
  }): Promise<Map<string, Date>> {
    const lastActivity: Map<string, Date> = new Map<string, Date>();

    if (data.repositoryIds.length === 0) {
      return lastActivity;
    }

    const parameters: Array<unknown> = [
      data.projectId.toString(),
      data.repositoryIds.map((id: ObjectID): string => {
        return id.toString();
      }),
      AIRunType.CodeFix,
      NOT_TASKS,
    ];
    const readable: string | null = AIRunOutputReadFilter.getRunAboutSql({
      alias: "AIRun",
      props: data.reader,
      parameters,
    });

    const rows: QueryRows = (await AIRunService.getRepository().manager.query(
      `SELECT "codeRepositoryId", ${LAST_ACTIVITY_SQL} AS "lastActivityAt"
        FROM "AIRun"
        WHERE "projectId" = $1 AND "runType" = $3 AND "deletedAt" IS NULL
          AND "codeRepositoryId" = ANY($2::uuid[])
          AND ("codeFixTaskType" IS NULL OR "codeFixTaskType" <> ALL($4::text[]))${
            readable ? ` AND ${readable}` : ""
          }
        GROUP BY "codeRepositoryId"`,
      parameters,
    )) as QueryRows;

    for (const row of rows) {
      const value: unknown = row["lastActivityAt"];

      if (!row["codeRepositoryId"] || !value) {
        continue;
      }

      const time: Date = new Date(value as string | Date);

      if (!Number.isNaN(time.getTime())) {
        lastActivity.set(String(row["codeRepositoryId"]).toLowerCase(), time);
      }
    }

    return lastActivity;
  }

  @CaptureSpan()
  public static async getRepositoryStats(data: {
    projectId: ObjectID;
    repositoryIds: Array<ObjectID>;
    // Who the page is for: what they may not read counts for nothing.
    reader: DatabaseCommonInteractionProps;
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

    // The reader's rule on a statement's runs: "AND ...", or nothing.
    const readableRuns: (parameters: Array<unknown>) => string = (
      parameters: Array<unknown>,
    ): string => {
      const readable: string | null = AIRunOutputReadFilter.getRunAboutSql({
        alias: "AIRun",
        props: data.reader,
        parameters,
      });

      return readable ? ` AND ${readable}` : "";
    };

    const runParameters: Array<unknown> = [
      projectId,
      repositoryIds,
      WORKING_STATUSES,
      AIRunType.CodeFix,
      NOT_TASKS,
    ];
    const runsReadable: string = readableRuns(runParameters);

    const waitingParameters: Array<unknown> = [
      projectId,
      repositoryIds,
      AIRunType.CodeFix,
      AIRunStatus.Completed,
      NOT_TASKS,
    ];
    const waitingReadable: string = readableRuns(waitingParameters);

    const pullRequestParameters: Array<unknown> = [
      projectId,
      repositoryIds,
      PullRequestState.Open,
    ];
    /*
     * A pull request is the reader's when the run that opened it is, and -
     * one a chat opened - when they may read what it carries (#9186).
     */
    const pullRequestReadable: string | null =
      [
        AIRunOutputReadFilter.getReadableRunsSql({
          key: `"AIAgentTaskPullRequest"."aiRunId"`,
          props: data.reader,
          parameters: pullRequestParameters,
        }),
        AIRunOutputReadFilter.getCarriedRecordsSql({
          alias: "AIAgentTaskPullRequest",
          props: data.reader,
          parameters: pullRequestParameters,
        }),
      ]
        .filter((condition: string | null): condition is string => {
          return Boolean(condition);
        })
        .join(" AND ") || null;

    const [runRows, waitingRows, pullRequestRows]: [
      QueryRows,
      QueryRows,
      QueryRows,
    ] = await Promise.all([
      query(
        `SELECT "codeRepositoryId",
          COUNT(*) FILTER (WHERE "status" = ANY($3::text[]))::int AS "working",
          COUNT(*) FILTER (WHERE "codeTaskId" IS NULL)::int AS "taskCount",
          ${LAST_ACTIVITY_SQL} AS "lastActivityAt"
        FROM "AIRun"
        WHERE "projectId" = $1 AND "runType" = $4 AND "deletedAt" IS NULL
          AND "codeRepositoryId" = ANY($2::uuid[])
          AND ("codeFixTaskType" IS NULL OR "codeFixTaskType" <> ALL($5::text[]))${runsReadable}
        GROUP BY "codeRepositoryId"`,
        runParameters,
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
            AND ("codeFixTaskType" IS NULL OR "codeFixTaskType" <> ALL($5::text[]))${waitingReadable}
          ORDER BY COALESCE("codeTaskId", "_id"), "createdAt" DESC
        ) AS "latest"
        WHERE "latest"."status" = $4 AND "latest"."needsUserInput" = true
        GROUP BY "latest"."codeRepositoryId"`,
        waitingParameters,
      ),
      query(
        `SELECT "codeRepositoryId", COUNT(*)::int AS "openPullRequests"
        FROM "AIAgentTaskPullRequest"
        WHERE "projectId" = $1 AND "deletedAt" IS NULL
          AND "pullRequestState" = $3
          AND "codeRepositoryId" = ANY($2::uuid[])${
            pullRequestReadable ? ` AND ${pullRequestReadable}` : ""
          }
        GROUP BY "codeRepositoryId"`,
        pullRequestParameters,
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

  /*
   * How many tasks have no repository (Code lists them as Other tasks) that
   * the reader may read: none about a private incident or alert they do not
   * see.
   */
  @CaptureSpan()
  public static async countTasksWithoutRepository(data: {
    projectId: ObjectID;
    reader: DatabaseCommonInteractionProps;
  }): Promise<number> {
    return (
      await AIRunService.countBy({
        query: AIRunOutputReadFilter.applyToRunRow(
          {
            projectId: data.projectId,
            runType: AIRunType.CodeFix,
            codeTaskId: QueryHelper.isNull(),
            codeRepositoryId: QueryHelper.isNull(),
          },
          data.reader,
        ),
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
