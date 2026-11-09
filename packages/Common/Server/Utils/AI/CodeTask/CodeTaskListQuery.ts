import AIRunService from "../../../Services/AIRunService";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { WORKING_STATUSES } from "./CodeTaskStats";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "../../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskListCountsJSON,
  CodeTaskListFilter,
  MAX_CODE_TASK_SEARCH_LENGTH,
} from "../../../../Types/AI/CodeTask";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import ObjectID from "../../../../Types/ObjectID";

/*
 * A TASK LIST'S FILTERS, SEARCH AND COUNTS, AS SQL.
 *
 * Every task (a code-fix run with no codeTaskId) of the list's scope falls
 * in exactly one filter (CodeTaskListFilter), read from its latest turn and
 * its pull requests, in this order:
 *
 *   - In progress: the latest turn is queued (also waiting to be tried
 *     again by itself), running or waiting for an approval;
 *   - Waiting for you: it finished asking the person something;
 *   - Pull request open: any turn's pull request is open (a pull request
 *     recorded without a state is open, as the conversation reads it);
 *   - Failed: the latest turn failed;
 *   - Done: everything else - finished, stopped, its pull request merged
 *     or closed.
 *
 * A search matches the task's title, as written (case aside), or its
 * number ("12", "#12"). Its words are matched as text: LIKE's wildcards
 * in it are escaped, and nothing in it is ever a pattern.
 */

export interface CodeTaskListScopeFacts {
  projectId: ObjectID;
  // The repositories whose tasks are listed.
  repositoryIds: Array<ObjectID>;
  // And the tasks with no repository.
  includeWithoutRepository: boolean;
  // A repository's pull requests' production reviews, instead of its tasks.
  isProductionReviews: boolean;
  search?: string | undefined;
}

export interface CodeTaskListStatement {
  sql: string;
  parameters: Array<unknown>;
}

type QueryRows = Array<Record<string, unknown>>;

export default class CodeTaskListQuery {
  // A search as the list reads it: trimmed, cut, "" for none.
  public static readSearch(raw: unknown): string {
    if (typeof raw !== "string") {
      return "";
    }

    return raw.trim().substring(0, MAX_CODE_TASK_SEARCH_LENGTH);
  }

  public static readFilter(raw: unknown): CodeTaskListFilter {
    return (Object.values(CodeTaskListFilter) as Array<unknown>).includes(raw)
      ? (raw as CodeTaskListFilter)
      : CodeTaskListFilter.All;
  }

  // The page of task ids a filter shows, newest first (rows of "_id").
  public static getPageStatement(
    facts: CodeTaskListScopeFacts & {
      filter: CodeTaskListFilter;
      limit: number;
      skip: number;
    },
  ): CodeTaskListStatement {
    const statement: CodeTaskListStatement =
      CodeTaskListQuery.getBucketedTasks(facts);
    const parameters: Array<unknown> = statement.parameters;

    const where: string =
      facts.filter === CodeTaskListFilter.All
        ? ""
        : ` WHERE "bucket" = $${parameters.push(facts.filter)}`;

    const limit: string = `$${parameters.push(Math.max(1, Math.floor(facts.limit)))}`;
    const skip: string = `$${parameters.push(Math.max(0, Math.floor(facts.skip)))}`;

    return {
      sql: `${statement.sql} SELECT "_id" FROM "bucketed"${where} ORDER BY "createdAt" DESC, "_id" DESC LIMIT ${limit} OFFSET ${skip}`,
      parameters,
    };
  }

  // How many tasks each filter shows (rows of "bucket" and "count").
  public static getCountsStatement(
    facts: CodeTaskListScopeFacts,
  ): CodeTaskListStatement {
    const statement: CodeTaskListStatement =
      CodeTaskListQuery.getBucketedTasks(facts);

    return {
      sql: `${statement.sql} SELECT "bucket", COUNT(*)::int AS "count" FROM "bucketed" GROUP BY "bucket"`,
      parameters: statement.parameters,
    };
  }

  @CaptureSpan()
  public static async readPage(
    facts: CodeTaskListScopeFacts & {
      filter: CodeTaskListFilter;
      limit: number;
      skip: number;
    },
  ): Promise<Array<string>> {
    const statement: CodeTaskListStatement =
      CodeTaskListQuery.getPageStatement(facts);

    const rows: QueryRows = (await AIRunService.getRepository().manager.query(
      statement.sql,
      statement.parameters,
    )) as QueryRows;

    return rows.map((row: Record<string, unknown>): string => {
      return String(row["_id"]);
    });
  }

  @CaptureSpan()
  public static async readCounts(
    facts: CodeTaskListScopeFacts,
  ): Promise<CodeTaskListCountsJSON> {
    const statement: CodeTaskListStatement =
      CodeTaskListQuery.getCountsStatement(facts);

    const rows: QueryRows = (await AIRunService.getRepository().manager.query(
      statement.sql,
      statement.parameters,
    )) as QueryRows;

    return CodeTaskListQuery.toCounts(rows);
  }

  // The counts from the rows of getCountsStatement; All adds them up.
  public static toCounts(rows: QueryRows): CodeTaskListCountsJSON {
    const counts: CodeTaskListCountsJSON = {
      [CodeTaskListFilter.All]: 0,
      [CodeTaskListFilter.InProgress]: 0,
      [CodeTaskListFilter.WaitingForYou]: 0,
      [CodeTaskListFilter.PullRequestOpen]: 0,
      [CodeTaskListFilter.Failed]: 0,
      [CodeTaskListFilter.Done]: 0,
    };

    for (const row of rows) {
      const bucket: CodeTaskListFilter = CodeTaskListQuery.readFilter(
        row["bucket"],
      );
      const count: number = Math.max(0, Math.floor(Number(row["count"]) || 0));

      if (bucket === CodeTaskListFilter.All) {
        continue;
      }

      counts[bucket] += count;
      counts[CodeTaskListFilter.All] += count;
    }

    return counts;
  }

  /*
   * LIKE's own characters in a search, escaped (backslash is LIKE's escape
   * character), so the search is matched as the text it is.
   */
  public static escapeLike(text: string): string {
    let escaped: string = "";

    for (const character of text) {
      if (character === "\\" || character === "%" || character === "_") {
        escaped += "\\";
      }

      escaped += character;
    }

    return escaped;
  }

  // A task number in a search: "12" or "#12", nothing else.
  public static readTaskNumber(search: string): number | null {
    const text: string = search.startsWith("#") ? search.substring(1) : search;

    if (text.length === 0 || text.length > 9) {
      return null;
    }

    for (const character of text) {
      if (character < "0" || character > "9") {
        return null;
      }
    }

    return Number(text);
  }

  /*
   * The scope's tasks, each with its filter ("bucket"), as the CTEs a
   * statement ends with its own SELECT on "bucketed".
   */
  private static getBucketedTasks(
    facts: CodeTaskListScopeFacts,
  ): CodeTaskListStatement {
    const parameters: Array<unknown> = [
      facts.projectId.toString(),
      AIRunType.CodeFix,
    ];

    const add: (value: unknown) => string = (value: unknown): string => {
      return `$${parameters.push(value)}`;
    };

    const repositoryIds: Array<string> = facts.repositoryIds.map(
      (id: ObjectID): string => {
        return id.toString();
      },
    );

    const repositoryConditions: Array<string> = [];

    if (repositoryIds.length > 0) {
      repositoryConditions.push(
        `"codeRepositoryId" = ANY(${add(repositoryIds)}::uuid[])`,
      );
    }

    if (facts.includeWithoutRepository) {
      repositoryConditions.push(`"codeRepositoryId" IS NULL`);
    }

    const taskConditions: Array<string> = [
      `"projectId" = $1`,
      `"runType" = $2`,
      `"deletedAt" IS NULL`,
      `"codeTaskId" IS NULL`,
      repositoryConditions.length > 0
        ? `(${repositoryConditions.join(" OR ")})`
        : "false",
      facts.isProductionReviews
        ? `"codeFixTaskType" = ${add(CodeFixTaskType.GitHubPullRequestProductionReview)}`
        : `("codeFixTaskType" IS NULL OR "codeFixTaskType" <> ALL(${add(
            CodeFixTaskTypeHelper.getServerRunTaskTypes(),
          )}::text[]))`,
    ];

    const search: string = CodeTaskListQuery.readSearch(facts.search);

    if (search) {
      const titleMatches: string = `"title" ILIKE ${add(
        `%${CodeTaskListQuery.escapeLike(search)}%`,
      )}`;
      const taskNumber: number | null =
        CodeTaskListQuery.readTaskNumber(search);

      taskConditions.push(
        taskNumber === null
          ? titleMatches
          : `(${titleMatches} OR "taskNumber" = ${add(taskNumber)})`,
      );
    }

    const working: string = add(WORKING_STATUSES);
    const completed: string = add(AIRunStatus.Completed);
    const failed: string = add([AIRunStatus.Error, AIRunStatus.Stale]);
    const open: string = add(PullRequestState.Open);

    const sql: string = `WITH "task" AS (
  SELECT "_id", "createdAt" FROM "AIRun" WHERE ${taskConditions.join(" AND ")}
), "latest" AS (
  SELECT DISTINCT ON (COALESCE("codeTaskId", "_id")) COALESCE("codeTaskId", "_id") AS "taskId", "status", "needsUserInput"
  FROM "AIRun"
  WHERE "projectId" = $1 AND "runType" = $2 AND "deletedAt" IS NULL
    AND COALESCE("codeTaskId", "_id") IN (SELECT "_id" FROM "task")
  ORDER BY COALESCE("codeTaskId", "_id"), "createdAt" DESC
), "bucketed" AS (
  SELECT "task"."_id", "task"."createdAt",
    CASE
      WHEN "latest"."status" = ANY(${working}::text[]) THEN '${CodeTaskListFilter.InProgress}'
      WHEN "latest"."status" = ${completed} AND "latest"."needsUserInput" = true THEN '${CodeTaskListFilter.WaitingForYou}'
      WHEN EXISTS (
        SELECT 1 FROM "AIAgentTaskPullRequest" AS "pullRequest"
        JOIN "AIRun" AS "turn" ON "turn"."_id" = "pullRequest"."aiRunId"
        WHERE "pullRequest"."deletedAt" IS NULL
          AND COALESCE("pullRequest"."pullRequestState", ${open}) = ${open}
          AND COALESCE("turn"."codeTaskId", "turn"."_id") = "task"."_id"
      ) THEN '${CodeTaskListFilter.PullRequestOpen}'
      WHEN "latest"."status" = ANY(${failed}::text[]) THEN '${CodeTaskListFilter.Failed}'
      ELSE '${CodeTaskListFilter.Done}'
    END AS "bucket"
  FROM "task" LEFT JOIN "latest" ON "latest"."taskId" = "task"."_id"
)`;

    return { sql, parameters };
  }
}
