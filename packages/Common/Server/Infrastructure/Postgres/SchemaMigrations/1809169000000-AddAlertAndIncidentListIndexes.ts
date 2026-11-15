import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration after the Alert and
 * Incident models gained ("projectId", "createdAt") and lost their bare
 * ("projectId").
 *
 * The Alerts and Incidents lists read newest first - the order every read
 * of them takes when it asks for none - and are live: a visible tab reads
 * its page again as often as every five seconds. With no index in that
 * order, Postgres read every alert of the project and sorted them to keep
 * ten; on a project that keeps its alerts for ever that is the whole
 * table's share of it, each time. ("projectId", "createdAt") hands the page
 * over in order. It also leads with "projectId", as the bare index did, so
 * it serves every read by project and the ON DELETE CASCADE of a project:
 * the bare index went, one index write fewer on every insert and state
 * change.
 *
 * Online, outside a transaction: alerts and incidents are written all the
 * time. Each new index is built before the old one goes, so reads by
 * project always have one. Safe to run again after a stop part way.
 */
export class AddAlertAndIncidentListIndexes1809169000000
  implements MigrationInterface
{
  public name: string = "AddAlertAndIncidentListIndexes1809169000000";

  // CREATE / DROP INDEX CONCURRENTLY run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_c8cf4648f795d5de4ac54adbcf" ON "Alert" ("projectId", "createdAt") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_fe5d23f2b3b026877c45c14027" ON "Incident" ("projectId", "createdAt") `,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_3e36243cde1e1a428f6849b04a"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_eccbc31fa1f58bd051b6f7e108"`,
    );
  }

  /*
   * TypeORM reverts a migration inside a transaction whatever its
   * `transaction` says, where an index cannot be built online, so the
   * builds are plain ones. The old indexes come back before the new ones
   * go.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_eccbc31fa1f58bd051b6f7e108" ON "Incident" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3e36243cde1e1a428f6849b04a" ON "Alert" ("projectId") `,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_fe5d23f2b3b026877c45c14027"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_c8cf4648f795d5de4ac54adbcf"`,
    );
  }
}
