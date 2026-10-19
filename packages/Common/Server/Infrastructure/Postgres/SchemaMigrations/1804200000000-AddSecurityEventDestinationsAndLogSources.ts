import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Two Security Events tables, both new:
 *
 *   - SecurityEventDestination: a SIEM (Google SecOps first) the project's
 *     detections, or all its security events, are sent to, with its
 *     write-only credentials and how the last send went.
 *   - SecurityLogSource: whether OneUptime looks for security events in the
 *     logs the project already sends it, and what the last look found.
 *
 * Generated with npm run generate-postgres-migration, then renumbered to a
 * slot above the registered migrations (SchemaMigrationsOrdering.test).
 * Both tables are new, so their indexes and foreign keys are built while
 * nothing writes to them.
 */
export class AddSecurityEventDestinationsAndLogSources1804200000000
  implements MigrationInterface
{
  public name: string =
    "AddSecurityEventDestinationsAndLogSources1804200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "SecurityEventDestination" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "description" character varying(500), "provider" character varying(100) NOT NULL, "config" jsonb, "secrets" text NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "sendScope" character varying(100) NOT NULL DEFAULT 'detections', "cursor" character varying(500), "lastAttemptAt" TIMESTAMP WITH TIME ZONE, "lastSentAt" TIMESTAMP WITH TIME ZONE, "lastSendResult" jsonb, "lastError" text, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_c84023eb0146bb25406dded4634" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_484528f212e33505c0a208ca4f" ON "SecurityEventDestination" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b5a0f9e5930b62d9f5b58278ba" ON "SecurityEventDestination" ("provider") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f09e7c26e2f8a26ad618315b25" ON "SecurityEventDestination" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SecurityLogSource" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "cursor" character varying(500), "lastScannedAt" TIMESTAMP WITH TIME ZONE, "lastEventFoundAt" TIMESTAMP WITH TIME ZONE, "lastScanResult" jsonb, "lastError" text, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_96f0e6104af9dcdf03635367fe7" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5fc77c5f517ffe52fd9261f81a" ON "SecurityLogSource" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d792d38edcf9bc462106411d5a" ON "SecurityLogSource" ("isEnabled") `,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventDestination" ADD CONSTRAINT "FK_484528f212e33505c0a208ca4f3" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventDestination" ADD CONSTRAINT "FK_c83da9c557e276c407f63e80059" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventDestination" ADD CONSTRAINT "FK_8ff11c9269d71cc36531ad8203b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityLogSource" ADD CONSTRAINT "FK_5fc77c5f517ffe52fd9261f81a2" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityLogSource" ADD CONSTRAINT "FK_cf74a509bc607d4e0e495d28009" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityLogSource" ADD CONSTRAINT "FK_befc1f196d1bec30fc2ac69a287" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityLogSource" DROP CONSTRAINT "FK_befc1f196d1bec30fc2ac69a287"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityLogSource" DROP CONSTRAINT "FK_cf74a509bc607d4e0e495d28009"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityLogSource" DROP CONSTRAINT "FK_5fc77c5f517ffe52fd9261f81a2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventDestination" DROP CONSTRAINT "FK_8ff11c9269d71cc36531ad8203b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventDestination" DROP CONSTRAINT "FK_c83da9c557e276c407f63e80059"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEventDestination" DROP CONSTRAINT "FK_484528f212e33505c0a208ca4f3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d792d38edcf9bc462106411d5a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5fc77c5f517ffe52fd9261f81a"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityLogSource"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f09e7c26e2f8a26ad618315b25"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b5a0f9e5930b62d9f5b58278ba"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_484528f212e33505c0a208ca4f"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityEventDestination"`);
  }
}
