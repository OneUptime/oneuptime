import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with TypeORM's migration:generate (the statements it generates
 * for the models), then renumbered after the last registered migration.
 *
 * Telemetry the ingest endpoints refused, counted per ingestion key, reason
 * and surface (issue #6378): TelemetryIngestionKeyRefusal, one row per
 * (key, reason, surface) under a unique index, which each ingest process
 * adds batches of refusals to, at most twice per five minutes. A new, empty
 * table: its own indexes and foreign keys are built in the same migration,
 * at once. Each row goes with its key and its project (ON DELETE CASCADE).
 */
export class AddTelemetryIngestionKeyRefusals1809071100000
  implements MigrationInterface
{
  public name: string = "AddTelemetryIngestionKeyRefusals1809071100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "TelemetryIngestionKeyRefusal" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "telemetryIngestionKeyId" uuid NOT NULL, "reason" character varying(100) NOT NULL, "surface" character varying(100) NOT NULL, "refusedCount" integer NOT NULL, "firstRefusedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastRefusedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_31a203a83c74557e82ad271e606" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1779ed037ba0d8f04e31b32821" ON "TelemetryIngestionKeyRefusal" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2f21bd83a4fc7441102a280ab6" ON "TelemetryIngestionKeyRefusal" ("telemetryIngestionKeyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_53ee299cb9e688811437f286bc" ON "TelemetryIngestionKeyRefusal" ("lastRefusedAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_40ae0b30e14277ab6f80ab190c" ON "TelemetryIngestionKeyRefusal" ("telemetryIngestionKeyId", "reason", "surface") `,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKeyRefusal" ADD CONSTRAINT "FK_1779ed037ba0d8f04e31b32821b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKeyRefusal" ADD CONSTRAINT "FK_2f21bd83a4fc7441102a280ab65" FOREIGN KEY ("telemetryIngestionKeyId") REFERENCES "TelemetryIngestionKey"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKeyRefusal" ADD CONSTRAINT "FK_f903533fcd5a66149ad26ee64cf" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKeyRefusal" DROP CONSTRAINT "FK_f903533fcd5a66149ad26ee64cf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKeyRefusal" DROP CONSTRAINT "FK_2f21bd83a4fc7441102a280ab65"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKeyRefusal" DROP CONSTRAINT "FK_1779ed037ba0d8f04e31b32821b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_40ae0b30e14277ab6f80ab190c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_53ee299cb9e688811437f286bc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2f21bd83a4fc7441102a280ab6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1779ed037ba0d8f04e31b32821"`,
    );
    await queryRunner.query(`DROP TABLE "TelemetryIngestionKeyRefusal"`);
  }
}
