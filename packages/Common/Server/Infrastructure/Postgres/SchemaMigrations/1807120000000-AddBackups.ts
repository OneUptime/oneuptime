import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration.
 *
 * Backups (OneUptime Enterprise, Admin Dashboard > Settings > Backups):
 *
 *   - "BackupSetting" holds where the instance's backups go (an S3 bucket,
 *     S3-compatible storage, Google Cloud Storage or Azure Blob Storage),
 *     with its settings, its credentials (encrypted), the schedule, how many
 *     days backups are kept, whether ClickHouse is in them, and the
 *     scheduler's bookkeeping (Models/DatabaseModels/BackupSetting);
 *   - "BackupRun" holds each backup and each restore: what started it, its
 *     status and steps, its sizes, its manifest and why it failed
 *     (Models/DatabaseModels/BackupRun).
 *
 * Both tables are new and empty, so their indexes and foreign keys are
 * built here.
 */
export class AddBackups1807120000000 implements MigrationInterface {
  public name: string = "AddBackups1807120000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "BackupSetting" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "destinationType" character varying(100) NOT NULL, "destinationProvider" character varying(100), "config" jsonb, "secrets" text, "isEnabled" boolean NOT NULL DEFAULT true, "frequency" character varying(100) NOT NULL DEFAULT 'daily', "timeOfDay" character varying(100) NOT NULL DEFAULT '02:00', "dayOfWeek" integer NOT NULL DEFAULT '0', "retentionInDays" integer NOT NULL DEFAULT '30', "includesClickhouse" boolean NOT NULL DEFAULT true, "nextBackupAt" TIMESTAMP WITH TIME ZONE, "lastFailureNotifiedAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_6c254a0317c087a6ccd0834574e" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "BackupRun" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "kind" character varying(100) NOT NULL, "trigger" character varying(100) NOT NULL, "status" character varying(100) NOT NULL DEFAULT 'queued', "includesPostgres" boolean NOT NULL DEFAULT true, "includesClickhouse" boolean NOT NULL DEFAULT false, "name" character varying(100), "location" text, "destinationType" character varying(100), "destinationFingerprint" character varying(100), "steps" jsonb, "startedAt" TIMESTAMP WITH TIME ZONE, "finishedAt" TIMESTAMP WITH TIME ZONE, "heartbeatAt" TIMESTAMP WITH TIME ZONE, "cancelRequestedAt" TIMESTAMP WITH TIME ZONE, "postgresSizeInBytes" bigint, "clickhouseSizeInBytes" bigint, "manifest" jsonb, "error" text, "restoredBackupRunId" uuid, "safetyBackupRunId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_75b64029ebbb0ce404ad96668e5" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_572342263a29e2ada5d35da655" ON "BackupRun" ("kind") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cc06890f788c1ba60fd5e7c618" ON "BackupRun" ("status") `,
    );
    await queryRunner.query(
      `ALTER TABLE "BackupSetting" ADD CONSTRAINT "FK_b356022313362907a1efd8e1d62" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "BackupSetting" ADD CONSTRAINT "FK_dd2390a74a64595753cb142143b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "BackupRun" ADD CONSTRAINT "FK_3c2679cbf8332c90fff2b406adb" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "BackupRun" ADD CONSTRAINT "FK_64bdabd3ae0432c9cee431e537d" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "BackupRun" DROP CONSTRAINT "FK_64bdabd3ae0432c9cee431e537d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "BackupRun" DROP CONSTRAINT "FK_3c2679cbf8332c90fff2b406adb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "BackupSetting" DROP CONSTRAINT "FK_dd2390a74a64595753cb142143b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "BackupSetting" DROP CONSTRAINT "FK_b356022313362907a1efd8e1d62"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cc06890f788c1ba60fd5e7c618"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_572342263a29e2ada5d35da655"`,
    );
    await queryRunner.query(`DROP TABLE "BackupRun"`);
    await queryRunner.query(`DROP TABLE "BackupSetting"`);
  }
}
