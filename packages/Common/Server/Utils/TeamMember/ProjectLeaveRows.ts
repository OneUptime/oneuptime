import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import DatabaseService from "../../Services/DatabaseService";
import TeamMemberService from "../../Services/TeamMemberService";
import Query from "../../Types/Database/Query";
import logger, { LogAttributes } from "../Logger";
import ProjectMembership from "./ProjectMembership";

/*
 * What a removal of one person's rows removed, for logging and for the
 * tests. Keyed by table ("UserEmail", "McpOAuthGrant", ...); tables with
 * nothing to remove are left out. Every count is "as far as we got": a table
 * that failed is logged, listed in failedTables, and the rest still go.
 */
export interface ProjectLeaveRemovalResult {
  removedRowCounts: Dictionary<number>;
  failedTables: Array<string>;
}

/*
 * A per-project table of rows that belong to one person (projectId, userId)
 * and go when they leave the project.
 */
export interface PersonalTable {
  service: DatabaseService<DatabaseBaseModel>;
  /*
   * Extra conditions on top of (projectId, userId), as a query and as the
   * same condition in SQL for finding former members' rows. Only the email
   * rollup queue has one: its sent rows are the record of what went out,
   * like notification logs, and expire by themselves; the pending ones are
   * project mail still waiting to reach the person.
   */
  query?: Dictionary<unknown> | undefined;
  sqlCondition?: string | undefined;
}

/*
 * What a walk over former members' leftovers did: how many (project,
 * person) pairs it cleaned, how many rows went, and how many pairs failed
 * part way (logged; the walk goes on).
 */
export interface FormerMemberCleanupResult {
  cleanedPairCount: number;
  removedRowCount: number;
  failedPairCount: number;
}

export interface ProjectUserRow {
  projectId: string;
  userId: string;
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function personalTable<TModel extends DatabaseBaseModel>(
  service: DatabaseService<TModel>,
  extra?: { query: Dictionary<unknown>; sqlCondition: string },
): PersonalTable {
  return {
    service: service as unknown as DatabaseService<DatabaseBaseModel>,
    query: extra?.query,
    sqlCondition: extra?.sqlCondition,
  };
}

/*
 * The removal every leave cleanup of a person's own rows shares - their
 * notification settings (ProjectLeaveNotificationCleanup) and their access
 * to the project (ProjectLeaveAccessCleanup): remove one person's rows from
 * a list of per-project tables, and find and walk the people who already
 * left with rows still there.
 */
export default class ProjectLeaveRows {
  /*
   * Removes one person's rows in one project from each of `tables`, in
   * order, through each table's service as root, so each service's own
   * delete hooks still run. A table with nothing of theirs is not written
   * to; a table that fails is logged and named, and the others still go.
   */
  public static async removeRowsOf(data: {
    projectId: ObjectID;
    userId: ObjectID;
    tables: Array<PersonalTable>;
  }): Promise<ProjectLeaveRemovalResult> {
    const { projectId, userId } = data;

    const logAttributes: LogAttributes = {
      projectId: projectId.toString(),
      userId: userId.toString(),
    } as LogAttributes;

    const result: ProjectLeaveRemovalResult = {
      removedRowCounts: {},
      failedTables: [],
    };

    for (const table of data.tables) {
      const tableName: string = table.service.getModel().tableName || "";

      const query: Query<DatabaseBaseModel> = {
        ...(table.query || {}),
        projectId: projectId,
        userId: userId,
      } as unknown as Query<DatabaseBaseModel>;

      try {
        const count: PositiveNumber = await table.service.countBy({
          query: query,
          props: {
            isRoot: true,
          },
        });

        if (count.toNumber() === 0) {
          continue;
        }

        const removed: number = await table.service.deleteBy({
          query: query,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

        if (removed > 0) {
          result.removedRowCounts[tableName] = removed;
        }
      } catch (err) {
        result.failedTables.push(tableName);

        logger.error(
          `Error removing ${tableName} rows of a user who left the project (best-effort).`,
          logAttributes,
        );
        logger.error(err as Error, logAttributes);
      }
    }

    return result;
  }

  /*
   * Removes each pair's rows (`remove`) after re-checking, just before, that
   * the person still is not a member - somebody who joined again in between
   * keeps everything. A pair that fails is logged and the walk goes on.
   * Idempotent, and safe to run twice at once: it only ever removes rows of
   * people who are not members.
   */
  public static async walkFormerMembers(data: {
    pairs: Array<ProjectUserRow>;
    remove: (pair: {
      projectId: ObjectID;
      userId: ObjectID;
    }) => Promise<ProjectLeaveRemovalResult>;
  }): Promise<FormerMemberCleanupResult> {
    const result: FormerMemberCleanupResult = {
      cleanedPairCount: 0,
      removedRowCount: 0,
      failedPairCount: 0,
    };

    for (const pair of data.pairs) {
      const projectId: ObjectID = new ObjectID(pair.projectId);
      const userId: ObjectID = new ObjectID(pair.userId);

      try {
        if (
          await TeamMemberService.isUserMemberOfProject({
            projectId: projectId,
            userId: userId,
          })
        ) {
          continue;
        }

        const removed: ProjectLeaveRemovalResult = await data.remove({
          projectId: projectId,
          userId: userId,
        });

        result.cleanedPairCount += 1;

        for (const count of Object.values(removed.removedRowCounts)) {
          result.removedRowCount += count;
        }

        if (removed.failedTables.length > 0) {
          result.failedPairCount += 1;
        }
      } catch (err) {
        result.failedPairCount += 1;

        logger.error(
          err as Error,
          {
            projectId: pair.projectId,
            userId: pair.userId,
          } as LogAttributes,
        );
      }
    }

    return result;
  }

  /*
   * The (project, person) pairs, in key order, that hold rows in any of
   * `tables` but no accepted membership of the project (ProjectMembership's
   * rule, in SQL). One statement, one pass over each table: the pairs are
   * few - one per person who left a project and still has rows there - and
   * reading them a page at a time would make Postgres rebuild the whole
   * union for every page.
   */
  public static async getFormerMemberPairsIn(
    tables: Array<PersonalTable>,
  ): Promise<Array<ProjectUserRow>> {
    const sources: Array<string> = tables.map(
      (table: PersonalTable): string => {
        const tableName: string = table.service.getModel().tableName || "";

        return `SELECT "projectId", "userId" FROM ${quoteIdentifier(
          tableName,
        )} WHERE "deletedAt" IS NULL${
          table.sqlCondition ? ` AND ${table.sqlCondition}` : ""
        }`;
      },
    );

    if (sources.length === 0) {
      return [];
    }

    const rows: Array<ProjectUserRow> =
      await TeamMemberService.getRepository().manager.query(
        `SELECT personal."projectId", personal."userId"
           FROM (${sources.join(" UNION ")}) personal
          WHERE personal."projectId" IS NOT NULL
            AND personal."userId" IS NOT NULL
            AND NOT ${ProjectMembership.getMembershipExistsSql({
              projectIdSql: `personal."projectId"`,
              userIdSql: `personal."userId"`,
            })}
          ORDER BY personal."projectId" ASC, personal."userId" ASC`,
      );

    return rows || [];
  }
}
