import { generateCustomFieldVariableKey } from "../../../../Types/CustomField/CustomFieldVariableKey";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Incident custom field settings for declaring incidents and for subscriber
 * emails (OneUptime/oneuptime#4035):
 *
 * - isRequiredOnCreate, sortOrder, showOnCreate and
 *   includeInSubscriberNotifications: plain settings. The three flags start
 *   off, and no field has an order, so every existing field behaves as it did.
 * - variableKey: the key templates reach a field by, {{customFields.<key>}}.
 *   Unique per project (the index), made from the name when a field is
 *   created and never changed afterwards. Nullable only because the table
 *   already has rows; the backfill below gives each of them a key.
 *
 * The backfill runs here, in the same transaction as the columns, rather than
 * in a batched data migration like the subscriber tokens: definition tables
 * hold a few dozen rows a project, and a key has to exist before anything
 * lists a field's template variable. Keys are made by the same generator the
 * service uses for a new field, so an existing field gets the key it would
 * have got had it been created today. Within a project the oldest field wins
 * the plain key and later ones get _2, _3, ...
 *
 * down() drops the columns and the index; the keys cannot be recovered, and
 * templates that use them stop filling in.
 */

// Rows written per UPDATE: two parameters each, well under Postgres' limit.
const BACKFILL_BATCH_SIZE: number = 500;

type BackfillQueryRunner = Pick<QueryRunner, "query">;

interface FieldRow {
  _id: string;
  projectId: string;
  name: string | null;
  variableKey: string | null;
}

/**
 * Give every incident custom field without a template key one. Idempotent:
 * a key already there is kept, and counted as taken for the others.
 * Returns how many fields it gave a key.
 */
export const backfillIncidentCustomFieldVariableKeys: (
  queryRunner: BackfillQueryRunner,
) => Promise<number> = async (
  queryRunner: BackfillQueryRunner,
): Promise<number> => {
  const rows: Array<FieldRow> = await queryRunner.query(
    `SELECT "_id", "projectId", "name", "variableKey" FROM "IncidentCustomField" ORDER BY "projectId" ASC, "createdAt" ASC, "_id" ASC`,
  );

  const takenByProject: Map<string, Set<string>> = new Map<
    string,
    Set<string>
  >();

  for (const row of rows) {
    const taken: Set<string> =
      takenByProject.get(row.projectId) || new Set<string>();

    if (row.variableKey) {
      taken.add(row.variableKey);
    }

    takenByProject.set(row.projectId, taken);
  }

  const assignments: Array<{ id: string; variableKey: string }> = [];

  for (const row of rows) {
    if (row.variableKey) {
      continue;
    }

    const taken: Set<string> = takenByProject.get(row.projectId)!;

    const variableKey: string = generateCustomFieldVariableKey({
      name: row.name || "",
      existingKeys: taken,
    });

    taken.add(variableKey);
    assignments.push({ id: row._id, variableKey: variableKey });
  }

  for (
    let start: number = 0;
    start < assignments.length;
    start += BACKFILL_BATCH_SIZE
  ) {
    const batch: Array<{ id: string; variableKey: string }> = assignments.slice(
      start,
      start + BACKFILL_BATCH_SIZE,
    );

    const values: Array<string> = [];
    const parameters: Array<string> = [];

    for (const assignment of batch) {
      parameters.push(assignment.id, assignment.variableKey);
      values.push(
        `($${parameters.length - 1}::uuid, $${parameters.length}::varchar)`,
      );
    }

    await queryRunner.query(
      `UPDATE "IncidentCustomField" AS "field" SET "variableKey" = "keys"."variableKey" FROM (VALUES ${values.join(
        ", ",
      )}) AS "keys"("_id", "variableKey") WHERE "field"."_id" = "keys"."_id" AND "field"."variableKey" IS NULL`,
      parameters,
    );
  }

  return assignments.length;
};

export class AddIncidentCustomFieldCreateAndNotificationSettings1795800000000
  implements MigrationInterface
{
  public name: string =
    "AddIncidentCustomFieldCreateAndNotificationSettings1795800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" ADD "isRequiredOnCreate" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" ADD "sortOrder" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" ADD "showOnCreate" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" ADD "includeInSubscriberNotifications" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" ADD "variableKey" character varying(100)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0a49bcb055baad4356af439169" ON "IncidentCustomField" ("projectId", "variableKey") `,
    );

    await backfillIncidentCustomFieldVariableKeys(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0a49bcb055baad4356af439169"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" DROP COLUMN "variableKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" DROP COLUMN "includeInSubscriberNotifications"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" DROP COLUMN "showOnCreate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" DROP COLUMN "sortOrder"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentCustomField" DROP COLUMN "isRequiredOnCreate"`,
    );
  }
}
