import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1773500000000 implements MigrationInterface {
  public name = "MigrationName1773500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "LogScrubRule" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "description" character varying(500), "patternType" character varying(100) NOT NULL, "customRegex" character varying(500), "scrubAction" character varying(100) NOT NULL DEFAULT 'redact', "fieldsToScrub" character varying(100) NOT NULL DEFAULT 'both', "isEnabled" boolean NOT NULL DEFAULT true, "sortOrder" integer NOT NULL DEFAULT '0', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_logscrub_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_logscrub_projectId" ON "LogScrubRule" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_logscrub_isEnabled" ON "LogScrubRule" ("isEnabled") `,
    );
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" ADD CONSTRAINT "FK_logscrub_projectId" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" ADD CONSTRAINT "FK_logscrub_createdByUserId" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" ADD CONSTRAINT "FK_logscrub_deletedByUserId" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" DROP CONSTRAINT "FK_logscrub_deletedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" DROP CONSTRAINT "FK_logscrub_createdByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogScrubRule" DROP CONSTRAINT "FK_logscrub_projectId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_logscrub_isEnabled"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_logscrub_projectId"`);
    await queryRunner.query(`DROP TABLE "LogScrubRule"`);
  }
}
