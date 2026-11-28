import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Monitors an import, an auto import rule or an alert policy made can move to
 * another template, or be unlinked, one at a time or thousands at once
 * (issues #11260, #11266):
 *
 *   - Monitor "createdFromMonitorTemplateId": the template a monitor was
 *     created from, kept when a person moves it to another template or
 *     unlinks it, so nothing makes that template's monitor for its device
 *     again. Nullable, with no default: added without rewriting a row, and
 *     empty on every existing monitor - one still linked to the template it
 *     was made from is read by Monitor Template, and the first change of its
 *     template stamps it (MonitorTemplateChangeProvenance).
 *   - "MonitorTemplateChange": a change of many monitors' template, run by
 *     a worker with progress. A new table, so its indexes and keys are made
 *     while it is empty.
 */
export class AddMonitorTemplateChangesAndCreatedFromTemplate1809187801260
  implements MigrationInterface
{
  public name: string =
    "AddMonitorTemplateChangesAndCreatedFromTemplate1809187801260";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "MonitorTemplateChange" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "monitorTemplateId" uuid, "monitorTemplateName" character varying(100), "status" character varying(100) NOT NULL, "settings" jsonb NOT NULL, "monitorIds" jsonb NOT NULL, "results" jsonb NOT NULL, "progress" jsonb NOT NULL, "error" text, "stopRequestedAt" TIMESTAMP WITH TIME ZONE, "resumeCount" integer NOT NULL DEFAULT '0', "retryOfChangeId" uuid, "createdByUserId" uuid, "startedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_549c178cfcf30b54e8cee8a492b" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e1a95cac5e223bc87f6ddd3442" ON "MonitorTemplateChange" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_17b6bb040e1e60e556724381b0" ON "MonitorTemplateChange" ("projectId", "monitorTemplateId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b07cc61971c52bf8f464d4f4fa" ON "MonitorTemplateChange" ("projectId", "status") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "createdFromMonitorTemplateId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplateChange" ADD CONSTRAINT "FK_e1a95cac5e223bc87f6ddd34428" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplateChange" ADD CONSTRAINT "FK_668ac9825fd14b54edacb46e084" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplateChange" DROP CONSTRAINT "FK_668ac9825fd14b54edacb46e084"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplateChange" DROP CONSTRAINT "FK_e1a95cac5e223bc87f6ddd34428"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "createdFromMonitorTemplateId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b07cc61971c52bf8f464d4f4fa"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_17b6bb040e1e60e556724381b0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e1a95cac5e223bc87f6ddd3442"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorTemplateChange"`);
  }
}
