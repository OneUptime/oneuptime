import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A project's own setup for its security cases, as its incidents and alerts
 * have theirs (Security Events > Settings):
 *
 *   - SecurityCaseCustomField: the fields a project adds to its cases, and
 *     SecurityCase.customFields, each case's values of them by name;
 *   - SecurityCaseNoteTemplate: ready-made text a case's note composer
 *     offers;
 *   - Project.securityCaseNumberPrefix and securityCaseNumbersStartAt: the
 *     text in front of case numbers and where they start. The prefix's
 *     default is CASE-, so every project - those from before the column
 *     included - keeps numbering its cases CASE-1, CASE-2, ... until it
 *     chooses otherwise; a constant default is stored in the catalogue, not
 *     written into each row.
 *
 * The two tables are new, so their indexes and keys are built on empty
 * tables. The three columns are added nullable: adding them only changes
 * the catalogue, never rewrites a row or holds a long lock.
 */
export class AddSecurityCaseCustomFieldsNoteTemplatesAndNumbering1808871270000
  implements MigrationInterface
{
  public name: string =
    "AddSecurityCaseCustomFieldsNoteTemplatesAndNumbering1808871270000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "SecurityCaseNoteTemplate" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "templateName" character varying(100) NOT NULL, "templateDescription" character varying(500), "note" text NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_6e6e84dfdc4adac889133142caa" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c22ef5edff057162663ccf5d0e" ON "SecurityCaseNoteTemplate" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SecurityCaseCustomField" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "customFieldType" character varying(100), "dropdownOptions" text, "mapFromResourceType" character varying(100), "mapFromCustomFieldName" character varying(100), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_45aba00b95fd95cb11d6b3500fe" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6f55b5045fbc479c62f1d32823" ON "SecurityCaseCustomField" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "securityCaseNumberPrefix" character varying(100) DEFAULT 'CASE-'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "securityCaseNumbersStartAt" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "customFields" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseNoteTemplate" ADD CONSTRAINT "FK_c22ef5edff057162663ccf5d0e2" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseNoteTemplate" ADD CONSTRAINT "FK_b74feb8e3f2f75adac49edf12c4" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseNoteTemplate" ADD CONSTRAINT "FK_f6dacfc0899f929894b8e71f787" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseCustomField" ADD CONSTRAINT "FK_6f55b5045fbc479c62f1d328230" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseCustomField" ADD CONSTRAINT "FK_cf125f4030dfcbb7a854ab14d19" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseCustomField" ADD CONSTRAINT "FK_600a0302a57c5c8f259854acd18" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseCustomField" DROP CONSTRAINT "FK_600a0302a57c5c8f259854acd18"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseCustomField" DROP CONSTRAINT "FK_cf125f4030dfcbb7a854ab14d19"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseCustomField" DROP CONSTRAINT "FK_6f55b5045fbc479c62f1d328230"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseNoteTemplate" DROP CONSTRAINT "FK_f6dacfc0899f929894b8e71f787"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseNoteTemplate" DROP CONSTRAINT "FK_b74feb8e3f2f75adac49edf12c4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseNoteTemplate" DROP CONSTRAINT "FK_c22ef5edff057162663ccf5d0e2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "customFields"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "securityCaseNumbersStartAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "securityCaseNumberPrefix"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6f55b5045fbc479c62f1d32823"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityCaseCustomField"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c22ef5edff057162663ccf5d0e"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityCaseNoteTemplate"`);
  }
}
