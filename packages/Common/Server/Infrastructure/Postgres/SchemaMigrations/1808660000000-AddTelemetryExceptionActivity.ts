import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 *   - "TelemetryExceptionActivity": an exception's activity timeline - who
 *     resolved, reopened, archived, assigned, merged or unmerged it and when,
 *     and when it came back after it was resolved.
 *
 * A new table: its indexes and foreign keys are built while it is still
 * empty, so they need no online DDL.
 */
export class AddTelemetryExceptionActivity1808660000000
  implements MigrationInterface
{
  public name: string = "AddTelemetryExceptionActivity1808660000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "TelemetryExceptionActivity" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "telemetryExceptionId" uuid NOT NULL, "activityType" character varying(100) NOT NULL, "userId" uuid, "apiKeyName" character varying(100), "assigneeUserId" uuid, "assigneeTeamId" uuid, "relatedTelemetryExceptionId" uuid, "release" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_04faa16b813e69a270eb0100cf3" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c64b01d85bf1b082dacce1dcc6" ON "TelemetryExceptionActivity" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6fd6398b8fcc4c79a1e9160c71" ON "TelemetryExceptionActivity" ("telemetryExceptionId", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryExceptionActivity" ADD CONSTRAINT "FK_c64b01d85bf1b082dacce1dcc68" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryExceptionActivity" ADD CONSTRAINT "FK_c2d0673ec30410b9120c82227fd" FOREIGN KEY ("telemetryExceptionId") REFERENCES "TelemetryException"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryExceptionActivity" ADD CONSTRAINT "FK_c1f796d7a32f586ebe4da4eada3" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryExceptionActivity" ADD CONSTRAINT "FK_230999cf35c2b24779e69636d8b" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryExceptionActivity" ADD CONSTRAINT "FK_492126789597a1ed0df635de577" FOREIGN KEY ("assigneeTeamId") REFERENCES "Team"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryExceptionActivity" ADD CONSTRAINT "FK_f2bc34fb922e8749b92d0f61292" FOREIGN KEY ("relatedTelemetryExceptionId") REFERENCES "TelemetryException"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryExceptionActivity" ADD CONSTRAINT "FK_301a5251a5b82a9873d9d8ad818" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryExceptionActivity" ADD CONSTRAINT "FK_ac5772f0bf5fbe87e5f74663984" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryExceptionActivity" DROP CONSTRAINT "FK_ac5772f0bf5fbe87e5f74663984"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryExceptionActivity" DROP CONSTRAINT "FK_301a5251a5b82a9873d9d8ad818"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryExceptionActivity" DROP CONSTRAINT "FK_f2bc34fb922e8749b92d0f61292"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryExceptionActivity" DROP CONSTRAINT "FK_492126789597a1ed0df635de577"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryExceptionActivity" DROP CONSTRAINT "FK_230999cf35c2b24779e69636d8b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryExceptionActivity" DROP CONSTRAINT "FK_c1f796d7a32f586ebe4da4eada3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryExceptionActivity" DROP CONSTRAINT "FK_c2d0673ec30410b9120c82227fd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryExceptionActivity" DROP CONSTRAINT "FK_c64b01d85bf1b082dacce1dcc68"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6fd6398b8fcc4c79a1e9160c71"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c64b01d85bf1b082dacce1dcc6"`,
    );
    await queryRunner.query(`DROP TABLE "TelemetryExceptionActivity"`);
  }
}
