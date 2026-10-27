import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * "Your OneUptime data" as security sources: "SecurityTelemetrySource", one
 * row per project and kind of telemetry beyond logs - traces, network flows,
 * the audit log, session replays - with whether it is read, where the scan
 * is up to (cursor) and what its last scan found or why it failed. Written
 * by the Security tiers' switches and, for its cursor and results, by
 * OneUptime alone (Server/Utils/SecurityEvent/TelemetryScan).
 *
 * The table is new and empty, so its indexes and foreign keys are built
 * here.
 */
export class AddSecurityTelemetrySource1807910000000
  implements MigrationInterface
{
  public name: string = "AddSecurityTelemetrySource1807910000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "SecurityTelemetrySource" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "kind" character varying(100) NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "cursor" character varying(500), "lastScannedAt" TIMESTAMP WITH TIME ZONE, "lastEventFoundAt" TIMESTAMP WITH TIME ZONE, "lastScanResult" jsonb, "lastError" text, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_5871f4b50bd034b41d132d0c7a6" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8390fa95a4516bea81d98002cd" ON "SecurityTelemetrySource" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6bb77026cd00e281ee9c2b9587" ON "SecurityTelemetrySource" ("kind") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_97c01d816ddee35248e83dcea3" ON "SecurityTelemetrySource" ("isEnabled") `,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityTelemetrySource" ADD CONSTRAINT "FK_8390fa95a4516bea81d98002cdf" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityTelemetrySource" ADD CONSTRAINT "FK_7fe1ef7f5604ed23391b1599ae5" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityTelemetrySource" ADD CONSTRAINT "FK_ca3739ab048f25e965cf70658ef" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityTelemetrySource" DROP CONSTRAINT "FK_ca3739ab048f25e965cf70658ef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityTelemetrySource" DROP CONSTRAINT "FK_7fe1ef7f5604ed23391b1599ae5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityTelemetrySource" DROP CONSTRAINT "FK_8390fa95a4516bea81d98002cdf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_97c01d816ddee35248e83dcea3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6bb77026cd00e281ee9c2b9587"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8390fa95a4516bea81d98002cd"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityTelemetrySource"`);
  }
}
