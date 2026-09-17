import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1730209089495 implements MigrationInterface {
  public name = "MigrationName1730209089495";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "MonitorTest" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "monitorType" character varying(100) NOT NULL, "monitorSteps" jsonb, "probeId" uuid NOT NULL, "testedAt" TIMESTAMP WITH TIME ZONE, "lastMonitoringLog" jsonb, CONSTRAINT "PK_7ce3477c7bb3d7b8961c8465935" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6de87954a2a0587defe52aeb86" ON "MonitorTest" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fd6b1e330eb08de988307b6052" ON "MonitorTest" ("probeId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTest" ADD CONSTRAINT "FK_6de87954a2a0587defe52aeb86c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTest" ADD CONSTRAINT "FK_f94c5a7356b7b55785e3a3dac5b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTest" ADD CONSTRAINT "FK_b92a71b1f5f6c072455cd242ed6" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTest" ADD CONSTRAINT "FK_fd6b1e330eb08de988307b60524" FOREIGN KEY ("probeId") REFERENCES "Probe"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorTest" DROP CONSTRAINT "FK_fd6b1e330eb08de988307b60524"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTest" DROP CONSTRAINT "FK_b92a71b1f5f6c072455cd242ed6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTest" DROP CONSTRAINT "FK_f94c5a7356b7b55785e3a3dac5b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTest" DROP CONSTRAINT "FK_6de87954a2a0587defe52aeb86c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fd6b1e330eb08de988307b6052"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6de87954a2a0587defe52aeb86"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorTest"`);
  }
}
