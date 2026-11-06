import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddGroupingRuleMinimumCount1808994700000, and moved into a migration of its
 * own: "Incident" and "Alert" already hold rows, so their indexes are built
 * online, without blocking the incidents and alerts written meanwhile. Each
 * is partial - only the records a grouping rule holds back until enough of
 * their group are ongoing - so each stays as small as what it finds: the
 * grouping engine's read of a group's waiting records, newest first, when
 * the next record of the group arrives. Safe to run again after a stop part
 * way.
 */
export class AddGroupingWaitKeyIndexes1808994710000
  implements MigrationInterface
{
  public name: string = "AddGroupingWaitKeyIndexes1808994710000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_0e3a062eee0590da9f8b45bd85" ON "Incident" ("groupingWaitKey", "createdAt") WHERE "groupingWaitKey" IS NOT NULL AND "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_d4d29d92155c66bee78492d27d" ON "Alert" ("groupingWaitKey", "createdAt") WHERE "groupingWaitKey" IS NOT NULL AND "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_d4d29d92155c66bee78492d27d"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_0e3a062eee0590da9f8b45bd85"`,
    );
  }
}
