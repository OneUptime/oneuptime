import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddHostCollectorManagement1805200000000, and moved into a migration of its
 * own: projects already have rows in "Host", so the indexes on its new
 * collector columns are built online, and its foreign keys to the new
 * Collector Config tables are added NOT VALID and then validated, without
 * blocking the writes hosts get from telemetry meanwhile. Every existing
 * host holds no config or version, so the validation finds nothing to
 * refuse. Safe to run again after a stop part way.
 */
export class AddHostCollectorManagementIndexesAndKeys1805250000000
  implements MigrationInterface
{
  public name: string = "AddHostCollectorManagementIndexesAndKeys1805250000000";

  // CREATE INDEX CONCURRENTLY and the validations run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_480c9e7ca43f321e9f058d66bf" ON "Host" ("collectorInstanceUid") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_f5cbc62964363d06f038ce8c0f" ON "Host" ("collectorConfigId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_6f8bd01e329a03746737ced86d" ON "Host" ("collectorRegisteredAt") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "Host" ADD CONSTRAINT "FK_f5cbc62964363d06f038ce8c0f7" FOREIGN KEY ("collectorConfigId") REFERENCES "HostCollectorConfig"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "Host" ADD CONSTRAINT "FK_a9e31a74701da2766348096d21c" FOREIGN KEY ("collectorConfigVersionId") REFERENCES "HostCollectorConfigVersion"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Host" DROP CONSTRAINT "FK_a9e31a74701da2766348096d21c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP CONSTRAINT "FK_f5cbc62964363d06f038ce8c0f7"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_6f8bd01e329a03746737ced86d"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_f5cbc62964363d06f038ce8c0f"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_480c9e7ca43f321e9f058d66bf"`,
    );
  }
}
