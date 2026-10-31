import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddTelemetryExceptionActivityAssigneeNotified1808670000000, and moved into
 * a migration of its own: "TelemetryExceptionActivity" already exists, and
 * every triage, assignment, merge and regression writes it, so its new index
 * is built online, without blocking those writes. Safe to run again after a
 * stop part way: an index that is already there is left as it is.
 *
 *   - a partial index of the assignments still to be told, which the
 *     Workers read every minute (ExceptionAssignmentNotifications): it holds
 *     those few rows only.
 */
export class AddTelemetryExceptionActivityAssigneeNotifiedIndex1808680000000
  implements MigrationInterface
{
  public name: string =
    "AddTelemetryExceptionActivityAssigneeNotifiedIndex1808680000000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_cca6d3cfd6372c5de7d53598f6" ON "TelemetryExceptionActivity" ("activityType", "createdAt") WHERE "isAssigneeNotified" = false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_cca6d3cfd6372c5de7d53598f6"`,
    );
  }
}
