import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * What each data monitor's alert is about - a table, a pipeline or a whole
 * store - and the alert it is a consequence of (DataAlertCause), so a data
 * alert's cause upstream is found by lineage and a cause lists its impact.
 *
 * The table is new and empty, so its indexes and foreign keys are built
 * here; no existing table changes.
 */
export class AddDataAlerts1808991800000 implements MigrationInterface {
  public name: string = "AddDataAlerts1808991800000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DataAlert" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "alertId" uuid NOT NULL, "dataAssetId" uuid, "dataPipelineId" uuid, "dataStoreId" uuid, "causeAlertId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_5519b7b8a314e42d651e4cf89c9" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d8a4d63af86e165f335684da69" ON "DataAlert" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0c966759ccabffc8d4fdd5caa4" ON "DataAlert" ("alertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_39272a398aa4ec26fd09099183" ON "DataAlert" ("causeAlertId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9b7b17f4a16e4198283aefe8f8" ON "DataAlert" ("projectId", "dataStoreId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bfd44c26ccaf4f4f61a6dcbb14" ON "DataAlert" ("projectId", "dataPipelineId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d63faf347d15d9055582eed4dc" ON "DataAlert" ("projectId", "dataAssetId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAlert" ADD CONSTRAINT "FK_d8a4d63af86e165f335684da69c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAlert" ADD CONSTRAINT "FK_0c966759ccabffc8d4fdd5caa43" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAlert" ADD CONSTRAINT "FK_9c75460ad57a5726b0492db6868" FOREIGN KEY ("dataAssetId") REFERENCES "DataAsset"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAlert" ADD CONSTRAINT "FK_acbba4aedf675c68a52483c7f2d" FOREIGN KEY ("dataPipelineId") REFERENCES "DataPipeline"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAlert" ADD CONSTRAINT "FK_d7b09552369504c42cf61d9235b" FOREIGN KEY ("dataStoreId") REFERENCES "DataStore"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAlert" ADD CONSTRAINT "FK_39272a398aa4ec26fd09099183e" FOREIGN KEY ("causeAlertId") REFERENCES "Alert"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAlert" ADD CONSTRAINT "FK_3255de4d4d84d9095451c956be9" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAlert" ADD CONSTRAINT "FK_9e25f45882e3fa59125928d783a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataAlert" DROP CONSTRAINT "FK_9e25f45882e3fa59125928d783a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAlert" DROP CONSTRAINT "FK_3255de4d4d84d9095451c956be9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAlert" DROP CONSTRAINT "FK_39272a398aa4ec26fd09099183e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAlert" DROP CONSTRAINT "FK_d7b09552369504c42cf61d9235b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAlert" DROP CONSTRAINT "FK_acbba4aedf675c68a52483c7f2d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAlert" DROP CONSTRAINT "FK_9c75460ad57a5726b0492db6868"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAlert" DROP CONSTRAINT "FK_0c966759ccabffc8d4fdd5caa43"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAlert" DROP CONSTRAINT "FK_d8a4d63af86e165f335684da69c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d63faf347d15d9055582eed4dc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bfd44c26ccaf4f4f61a6dcbb14"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9b7b17f4a16e4198283aefe8f8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_39272a398aa4ec26fd09099183"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0c966759ccabffc8d4fdd5caa4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d8a4d63af86e165f335684da69"`,
    );
    await queryRunner.query(`DROP TABLE "DataAlert"`);
  }
}
