import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration.
 *
 * Audit log export (OneUptime Enterprise): "AuditLogExport" holds where the
 * audit log is sent - an S3 or S3-compatible bucket, Google Cloud Storage,
 * Azure Blob Storage, a webhook or a syslog receiver - with its settings,
 * its credentials (encrypted) and the exporter's bookkeeping: the cursor
 * (the time and id of the last entry delivered), how many entries were
 * delivered, and while a destination fails, why, since when and when it is
 * tried again (Models/DatabaseModels/AuditLogExport).
 *
 * A row with a projectId exports that project; one without exports the
 * whole instance (master admins only).
 *
 * The new table is empty, so its indexes and foreign keys are built here.
 */
export class AddAuditLogExport1807110000000 implements MigrationInterface {
  public name: string = "AddAuditLogExport1807110000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "AuditLogExport" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid, "name" character varying(50) NOT NULL, "destinationType" character varying(100) NOT NULL, "config" jsonb, "secrets" text, "isEnabled" boolean NOT NULL DEFAULT true, "startsAt" TIMESTAMP WITH TIME ZONE, "cursorCreatedAt" TIMESTAMP WITH TIME ZONE, "cursorEntryId" uuid, "exportedEntryCount" integer NOT NULL DEFAULT '0', "lastExportedAt" TIMESTAMP WITH TIME ZONE, "lastAttemptAt" TIMESTAMP WITH TIME ZONE, "lastError" text, "failingSince" TIMESTAMP WITH TIME ZONE, "consecutiveFailureCount" integer NOT NULL DEFAULT '0', "nextAttemptAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_6268fa3399a727b194386cc50e7" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d0744b25c10bda357002d0c115" ON "AuditLogExport" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ba6e0ea1cb8f5949b48e8b1e4d" ON "AuditLogExport" ("isEnabled") `,
    );
    await queryRunner.query(
      `ALTER TABLE "AuditLogExport" ADD CONSTRAINT "FK_d0744b25c10bda357002d0c1153" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AuditLogExport" ADD CONSTRAINT "FK_8605312c6db19554061c152e790" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AuditLogExport" ADD CONSTRAINT "FK_210bbfdefa3fa470f60ac755de9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AuditLogExport" DROP CONSTRAINT "FK_210bbfdefa3fa470f60ac755de9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AuditLogExport" DROP CONSTRAINT "FK_8605312c6db19554061c152e790"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AuditLogExport" DROP CONSTRAINT "FK_d0744b25c10bda357002d0c1153"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ba6e0ea1cb8f5949b48e8b1e4d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d0744b25c10bda357002d0c115"`,
    );
    await queryRunner.query(`DROP TABLE "AuditLogExport"`);
  }
}
