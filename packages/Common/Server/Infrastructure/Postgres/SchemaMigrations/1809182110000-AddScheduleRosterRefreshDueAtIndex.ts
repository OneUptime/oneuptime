import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddScheduleRosterRefreshDueAt1809182100000, and moved into a migration of
 * its own: "OnCallDutyPolicySchedule" already holds rows, and every roster
 * hand-off writes them, so its index is built online, without blocking the
 * schedules written meanwhile. Partial - only the schedules whose change
 * made through the API waits to be told, a handful for half a minute each -
 * so it stays as small as what the Workers find in it every minute
 * (OnCallDutySchedule:TellLayerChanges). Safe to run again after a stop
 * part way.
 */
export class AddScheduleRosterRefreshDueAtIndex1809182110000
  implements MigrationInterface
{
  public name: string = "AddScheduleRosterRefreshDueAtIndex1809182110000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_d242a03092195f79e2e425ea62" ON "OnCallDutyPolicySchedule" ("rosterRefreshDueAt") WHERE "rosterRefreshDueAt" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_d242a03092195f79e2e425ea62"`,
    );
  }
}
