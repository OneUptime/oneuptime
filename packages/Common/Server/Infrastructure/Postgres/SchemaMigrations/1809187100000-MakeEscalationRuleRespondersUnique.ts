import OnlineDdl from "../OnlineDdl";
import logger from "../../../Utils/Logger";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * One row per person, team and schedule an escalation rule pages (#10411):
 * the newer copies of a responder a rule has twice are soft-deleted, then
 * each table gets the partial unique index its model declares.
 *
 * WHY
 *
 * Only the Dashboard and Ask AI looked for a row before adding one; the API,
 * Terraform, a workflow and two adds at the same moment wrote a second row
 * for the same person, team or schedule. Each row told the person again that
 * they were added and said so again in the policy's feed and channels, and
 * taking either row out told them they were removed and ended their on-call
 * time while the other still paged them
 * (Types/OnCallDutyPolicy/EscalationRuleResponderOnce).
 *
 * WHAT IT DOES, FOR EACH OF THE THREE TABLES
 *
 *   1. Soft-deletes the copies (softDeleteNewerCopies): of the rows not
 *      deleted that name the same rule and the same person - team; schedule,
 *      paged the same way - the oldest (createdAt, then _id) is kept and
 *      the others get a "deletedAt". A soft delete, as the model has one:
 *      the row keeps every column, nothing refers to these rows by a foreign
 *      key, so nothing cascades, and every read leaves a deleted row out, as
 *      does the index. The kept row pages the same person through the same
 *      rule, so the time OneUptime logs them on call there carries on, and
 *      nobody is told anything. Found with one GROUP BY of the table, so a
 *      table with no copies - nearly every one - is read once and written
 *      nowhere.
 *   2. Builds the index online (OnlineDdl.createIndex: CREATE UNIQUE INDEX
 *      CONCURRENTLY), so the people, teams and schedules of rules can be
 *      read and changed while it builds. These are the statements
 *      generate-postgres-migration wrote, as written.
 *
 * A server of the version before this one can add a copy in between: the
 * build then fails with unique_violation (23505), and the copies are
 * soft-deleted and the build run again, up to MAX_ATTEMPTS times.
 *
 * `transaction = false`: CREATE INDEX CONCURRENTLY cannot run in one, and
 * each soft delete is one statement, done as it runs. Safe to run again from
 * the start: a table with no copies is left as it is, and so is an index
 * already valid.
 *
 * down() drops the indexes. The copies stay deleted.
 */

export const MAX_ATTEMPTS: number = 5;

const UNIQUE_VIOLATION: string = "23505";

// A table of responders of rules, by the columns of its unique index.
export interface ResponderTable {
  table: string;
  // The rule's column first, then the responder's own.
  columns: ReadonlyArray<string>;
}

export const USER_RESPONDERS: ResponderTable = {
  table: "OnCallDutyPolicyEscalationRuleUser",
  columns: ["onCallDutyPolicyEscalationRuleId", "userId"],
};

export const TEAM_RESPONDERS: ResponderTable = {
  table: "OnCallDutyPolicyEscalationRuleTeam",
  columns: ["onCallDutyPolicyEscalationRuleId", "teamId"],
};

export const SCHEDULE_RESPONDERS: ResponderTable = {
  table: "OnCallDutyPolicyEscalationRuleSchedule",
  columns: [
    "onCallDutyPolicyEscalationRuleId",
    "onCallDutyPolicyScheduleId",
    "pageNextInRotation",
  ],
};

export class MakeEscalationRuleRespondersUnique1809187100000
  implements MigrationInterface
{
  public name: string = "MakeEscalationRuleRespondersUnique1809187100000";

  // CREATE INDEX CONCURRENTLY cannot run in a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.softDeleteCopiesAndBuild(
      queryRunner,
      SCHEDULE_RESPONDERS,
      async () => {
        await OnlineDdl.createIndex(
          queryRunner,
          `CREATE UNIQUE INDEX "IDX_OnCallDutyPolicyEscalationRuleSchedule_rule_schedule" ON "OnCallDutyPolicyEscalationRuleSchedule" ("onCallDutyPolicyEscalationRuleId", "onCallDutyPolicyScheduleId", "pageNextInRotation") WHERE "deletedAt" IS NULL`,
        );
      },
    );

    await this.softDeleteCopiesAndBuild(
      queryRunner,
      TEAM_RESPONDERS,
      async () => {
        await OnlineDdl.createIndex(
          queryRunner,
          `CREATE UNIQUE INDEX "IDX_OnCallDutyPolicyEscalationRuleTeam_rule_team" ON "OnCallDutyPolicyEscalationRuleTeam" ("onCallDutyPolicyEscalationRuleId", "teamId") WHERE "deletedAt" IS NULL`,
        );
      },
    );

    await this.softDeleteCopiesAndBuild(
      queryRunner,
      USER_RESPONDERS,
      async () => {
        await OnlineDdl.createIndex(
          queryRunner,
          `CREATE UNIQUE INDEX "IDX_OnCallDutyPolicyEscalationRuleUser_rule_user" ON "OnCallDutyPolicyEscalationRuleUser" ("onCallDutyPolicyEscalationRuleId", "userId") WHERE "deletedAt" IS NULL`,
        );
      },
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_OnCallDutyPolicyEscalationRuleUser_rule_user"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_OnCallDutyPolicyEscalationRuleTeam_rule_team"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_OnCallDutyPolicyEscalationRuleSchedule_rule_schedule"`,
    );
  }

  /*
   * Soft-deletes the table's copies, then builds its index - again, while a
   * build finds a copy added in between.
   */
  private async softDeleteCopiesAndBuild(
    queryRunner: QueryRunner,
    responders: ResponderTable,
    build: () => Promise<void>,
  ): Promise<void> {
    for (let attempt: number = 1; ; attempt++) {
      await softDeleteNewerCopies(queryRunner, responders);

      try {
        await build();
        return;
      } catch (error) {
        if (
          getErrorCode(error) !== UNIQUE_VIOLATION ||
          attempt >= MAX_ATTEMPTS
        ) {
          throw error;
        }

        logger.warn(
          `${responders.table}: a second row of a responder of an escalation rule was added while its unique index was being built; soft-deleting the copies again (attempt ${attempt + 1} of ${MAX_ATTEMPTS}).`,
        );
      }
    }
  }
}

/*
 * Soft-deletes every row of `responders.table` that a rule has twice - the
 * same rule and responder, neither deleted - but the oldest of them
 * (createdAt, then _id), in one statement. Hands back how many it deleted.
 * Rows that name no responder (a column of the index that is null) are no
 * copies: the index does not hold them either.
 */
export async function softDeleteNewerCopies(
  queryRunner: QueryRunner,
  responders: ResponderTable,
): Promise<number> {
  const columns: string = responders.columns
    .map((column: string): string => {
      return `"${column}"`;
    })
    .join(", ");
  const responderColumns: string = responders.columns
    .map((column: string): string => {
      return `responder."${column}"`;
    })
    .join(", ");
  const named: string = responders.columns
    .map((column: string): string => {
      return `"${column}" IS NOT NULL`;
    })
    .join(" AND ");

  const result: unknown = await queryRunner.query(
    `WITH "duplicated" AS (
      SELECT ${columns}
      FROM "${responders.table}"
      WHERE "deletedAt" IS NULL AND ${named}
      GROUP BY ${columns}
      HAVING COUNT(*) > 1
    ),
    "ranked" AS (
      SELECT responder."_id",
        ROW_NUMBER() OVER (
          PARTITION BY ${responderColumns}
          ORDER BY responder."createdAt" ASC, responder."_id" ASC
        ) AS "place"
      FROM "${responders.table}" responder
      INNER JOIN "duplicated" USING (${columns})
      WHERE responder."deletedAt" IS NULL
    )
    UPDATE "${responders.table}" newer
    SET "deletedAt" = now()
    FROM "ranked"
    WHERE newer."_id" = "ranked"."_id" AND "ranked"."place" > 1`,
  );

  const deleted: number = getAffectedRows(result);

  if (deleted > 0) {
    logger.info(
      `${responders.table}: soft-deleted ${deleted} ${deleted === 1 ? "copy" : "copies"} of responders that escalation rules had more than once, keeping the oldest row of each.`,
    );
  }

  return deleted;
}

/*
 * How many rows an UPDATE wrote: TypeORM hands back [rows, count] for one,
 * and a database that answers with the rows alone is read by their number.
 */
function getAffectedRows(result: unknown): number {
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === "number"
  ) {
    return result[1];
  }

  return Array.isArray(result) ? result.length : 0;
}

function getErrorCode(error: unknown): string | undefined {
  const code: unknown =
    (error as { code?: unknown } | null)?.code ??
    (error as { driverError?: { code?: unknown } } | null)?.driverError?.code;

  return typeof code === "string" ? code : undefined;
}
