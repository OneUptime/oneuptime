import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Warehouse spend (DataWarehouseJob): each warehouse's jobs with what they
 * spent over the last day; and, on DataAsset, the write spend of each
 * table over the last day - two nullable columns.
 */
export class AddDataWarehouseSpend1808992400000 implements MigrationInterface {
  public name: string = "AddDataWarehouseSpend1808992400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DataWarehouseJob" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dataStoreId" uuid NOT NULL, "jobKey" character varying(100) NOT NULL, "name" character varying(500) NOT NULL, "userName" character varying(100), "warehouseName" character varying(100), "team" character varying(100), "runCount" integer, "failedRunCount" integer, "credits" numeric, "bytesBilled" bigint, "writtenTables" jsonb, "writesOnlyUnusedTables" boolean DEFAULT false, "lastRunAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_119249acc7c5a4da49b0f454d42" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bf61548fd8224e445c4c665a62" ON "DataWarehouseJob" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7dd500f0809402bba84dd0980a" ON "DataWarehouseJob" ("dataStoreId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_20c267fdab91e2c86a170625ab" ON "DataWarehouseJob" ("dataStoreId", "jobKey") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAsset" ADD "writeCredits" numeric`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAsset" ADD "writeBytesBilled" bigint`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataWarehouseJob" ADD CONSTRAINT "FK_bf61548fd8224e445c4c665a62a" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataWarehouseJob" ADD CONSTRAINT "FK_7dd500f0809402bba84dd0980a8" FOREIGN KEY ("dataStoreId") REFERENCES "DataStore"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataWarehouseJob" ADD CONSTRAINT "FK_6be63828134f7e2d3a7e11cb465" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataWarehouseJob" ADD CONSTRAINT "FK_623f74224dbfb2fd3dff1000bac" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataWarehouseJob" DROP CONSTRAINT "FK_623f74224dbfb2fd3dff1000bac"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataWarehouseJob" DROP CONSTRAINT "FK_6be63828134f7e2d3a7e11cb465"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataWarehouseJob" DROP CONSTRAINT "FK_7dd500f0809402bba84dd0980a8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataWarehouseJob" DROP CONSTRAINT "FK_bf61548fd8224e445c4c665a62a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAsset" DROP COLUMN "writeBytesBilled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataAsset" DROP COLUMN "writeCredits"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_20c267fdab91e2c86a170625ab"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7dd500f0809402bba84dd0980a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bf61548fd8224e445c4c665a62"`,
    );
    await queryRunner.query(`DROP TABLE "DataWarehouseJob"`);
  }
}
