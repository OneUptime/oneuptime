import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Reconciliations (DataReconciliation): one measure of two tables compared
 * with a tolerance - a new table, its indexes and keys built with it - and,
 * on DataCheck, the reconciliation a check reads a side of: a nullable
 * column, a catalogue change, indexed on a table of one row per check.
 */
export class AddDataReconciliations1808992200000 implements MigrationInterface {
  public name: string = "AddDataReconciliations1808992200000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DataReconciliation" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "intervalInMinutes" integer, "toleranceType" character varying(100) NOT NULL, "tolerance" numeric NOT NULL, "sourceDataAssetId" uuid, "sourceMeasure" character varying(100) NOT NULL, "sourceColumnName" character varying(100), "sourceCustomSql" text, "sourceDataCheckId" uuid, "sourceValue" numeric, "targetDataAssetId" uuid, "targetMeasure" character varying(100) NOT NULL, "targetColumnName" character varying(100), "targetCustomSql" text, "targetDataCheckId" uuid, "targetValue" numeric, "difference" numeric, "differencePercent" numeric, "status" character varying(100), "statusMessage" character varying(500), "comparedAt" TIMESTAMP WITH TIME ZONE, "statusChangedAt" TIMESTAMP WITH TIME ZONE, "monitorId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_446cac1455cc95690e5617ca053" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7ab6f0fd1e8bd5f14197d5bd0b" ON "DataReconciliation" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_35bf9a1fa28fe910c415b4bafa" ON "DataReconciliation" ("sourceDataAssetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b80f12dbc4404c2b054bf47331" ON "DataReconciliation" ("sourceDataCheckId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_836db297d0559715c0568bc6f6" ON "DataReconciliation" ("targetDataAssetId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9dde560d2478c69d2a9dbe14f0" ON "DataReconciliation" ("targetDataCheckId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bad8e6dcb8e9382acaa747ea9d" ON "DataReconciliation" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c1a1dcd0983ab389e1d0f14d97" ON "DataReconciliation" ("projectId", "name") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DataCheck" ADD "dataReconciliationId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e4cb27aa7170e1f4419363439e" ON "DataCheck" ("dataReconciliationId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DataReconciliation" ADD CONSTRAINT "FK_7ab6f0fd1e8bd5f14197d5bd0b7" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataReconciliation" ADD CONSTRAINT "FK_35bf9a1fa28fe910c415b4bafaf" FOREIGN KEY ("sourceDataAssetId") REFERENCES "DataAsset"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataReconciliation" ADD CONSTRAINT "FK_b80f12dbc4404c2b054bf47331b" FOREIGN KEY ("sourceDataCheckId") REFERENCES "DataCheck"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataReconciliation" ADD CONSTRAINT "FK_836db297d0559715c0568bc6f6d" FOREIGN KEY ("targetDataAssetId") REFERENCES "DataAsset"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataReconciliation" ADD CONSTRAINT "FK_9dde560d2478c69d2a9dbe14f02" FOREIGN KEY ("targetDataCheckId") REFERENCES "DataCheck"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataReconciliation" ADD CONSTRAINT "FK_bad8e6dcb8e9382acaa747ea9d8" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataReconciliation" ADD CONSTRAINT "FK_b9c7db65fb2d4762e85f6156cb1" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataReconciliation" ADD CONSTRAINT "FK_1d412c00db6987bfc818b5e4c54" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataReconciliation" DROP CONSTRAINT "FK_1d412c00db6987bfc818b5e4c54"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataReconciliation" DROP CONSTRAINT "FK_b9c7db65fb2d4762e85f6156cb1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataReconciliation" DROP CONSTRAINT "FK_bad8e6dcb8e9382acaa747ea9d8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataReconciliation" DROP CONSTRAINT "FK_9dde560d2478c69d2a9dbe14f02"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataReconciliation" DROP CONSTRAINT "FK_836db297d0559715c0568bc6f6d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataReconciliation" DROP CONSTRAINT "FK_b80f12dbc4404c2b054bf47331b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataReconciliation" DROP CONSTRAINT "FK_35bf9a1fa28fe910c415b4bafaf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataReconciliation" DROP CONSTRAINT "FK_7ab6f0fd1e8bd5f14197d5bd0b7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e4cb27aa7170e1f4419363439e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataCheck" DROP COLUMN "dataReconciliationId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c1a1dcd0983ab389e1d0f14d97"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bad8e6dcb8e9382acaa747ea9d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9dde560d2478c69d2a9dbe14f0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_836db297d0559715c0568bc6f6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b80f12dbc4404c2b054bf47331"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_35bf9a1fa28fe910c415b4bafa"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7ab6f0fd1e8bd5f14197d5bd0b"`,
    );
    await queryRunner.query(`DROP TABLE "DataReconciliation"`);
  }
}
