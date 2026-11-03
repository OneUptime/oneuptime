import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Data checks (DataCheck): a check on the values of one table, run with its
 * store's collection. A new table: its indexes and foreign keys are made
 * with it, before it holds a row.
 */
export class AddDataChecks1808991400000 implements MigrationInterface {
  public name: string = "AddDataChecks1808991400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DataCheck" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "dataAssetId" uuid NOT NULL, "dataStoreId" uuid, "name" character varying(100) NOT NULL, "description" character varying(500), "checkType" character varying(100) NOT NULL, "columnName" character varying(100), "segmentColumn" character varying(100), "acceptedValues" jsonb, "pattern" character varying(500), "referenceTableKey" character varying(100), "referenceColumnName" character varying(100), "customSql" text, "intervalInMinutes" integer NOT NULL DEFAULT '60', "isEnabled" boolean NOT NULL DEFAULT true, "alertCondition" character varying(100), "alertThreshold" numeric, "monitorId" uuid, "lastRunAt" TIMESTAMP WITH TIME ZONE, "lastRunStatus" character varying(100), "lastRunMessage" character varying(500), "lastValue" numeric, "lastSegmentCount" integer, "nextRunAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_a7287ad89b556e88fa25558fac2" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8830fb175b0c0aa3bd36146305" ON "DataCheck" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fe388425e208479e78bfd9424c" ON "DataCheck" ("dataAssetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_048397f481eddfe88a661dceca" ON "DataCheck" ("dataStoreId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e2e8ecb9abae5bddcb629d075a" ON "DataCheck" ("nextRunAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_4b999ec3c068b7d48d7bc6a1a7" ON "DataCheck" ("dataAssetId", "name") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DataCheck" ADD CONSTRAINT "FK_8830fb175b0c0aa3bd36146305e" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataCheck" ADD CONSTRAINT "FK_fe388425e208479e78bfd9424c4" FOREIGN KEY ("dataAssetId") REFERENCES "DataAsset"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataCheck" ADD CONSTRAINT "FK_dfdde7e9057030a51a753883f8c" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataCheck" ADD CONSTRAINT "FK_620559d3f5b789ad726b3c3595f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataCheck" ADD CONSTRAINT "FK_474e76023c97bbcff19e1aa4007" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataCheck" DROP CONSTRAINT "FK_474e76023c97bbcff19e1aa4007"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataCheck" DROP CONSTRAINT "FK_620559d3f5b789ad726b3c3595f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataCheck" DROP CONSTRAINT "FK_dfdde7e9057030a51a753883f8c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataCheck" DROP CONSTRAINT "FK_fe388425e208479e78bfd9424c4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataCheck" DROP CONSTRAINT "FK_8830fb175b0c0aa3bd36146305e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4b999ec3c068b7d48d7bc6a1a7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e2e8ecb9abae5bddcb629d075a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_048397f481eddfe88a661dceca"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fe388425e208479e78bfd9424c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8830fb175b0c0aa3bd36146305"`,
    );
    await queryRunner.query(`DROP TABLE "DataCheck"`);
  }
}
