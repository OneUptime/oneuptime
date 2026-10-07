import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Log recording rules: the LogRecordingRule table, one row per rule that
 * turns logs into a metric (Models/DatabaseModels/LogRecordingRule). A new,
 * empty table, so its indexes and foreign keys are built in the same
 * migration.
 */

export class AddLogRecordingRule1799600000000 implements MigrationInterface {
  public name: string = "AddLogRecordingRule1799600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "LogRecordingRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "description" character varying(500), "outputMetricName" character varying(100) NOT NULL, "definition" jsonb NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "computedUntil" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_8839779b48c2e74b1c2ee8b2b21" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b2ff7a6640df51638d2f1a59c7" ON "LogRecordingRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_083d2b0ce54b0c443f942311c9" ON "LogRecordingRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `ALTER TABLE "LogRecordingRule" ADD CONSTRAINT "FK_b2ff7a6640df51638d2f1a59c71" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogRecordingRule" ADD CONSTRAINT "FK_20dcf156cb71b1894ac9f087af7" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogRecordingRule" ADD CONSTRAINT "FK_d1069076b1841e5720b7d6e0df4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LogRecordingRule" DROP CONSTRAINT "FK_d1069076b1841e5720b7d6e0df4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogRecordingRule" DROP CONSTRAINT "FK_20dcf156cb71b1894ac9f087af7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogRecordingRule" DROP CONSTRAINT "FK_b2ff7a6640df51638d2f1a59c71"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_083d2b0ce54b0c443f942311c9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b2ff7a6640df51638d2f1a59c7"`,
    );
    await queryRunner.query(`DROP TABLE "LogRecordingRule"`);
  }
}
