import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration. Incident forms and the per-template custom
 * field settings (issue #4114):
 *
 *   - IncidentForm: forms anyone with the link can fill in to declare an
 *     incident. shareKey is the key in the public link, unique across all
 *     projects (the unique constraint is also the index a visit is looked up
 *     by). incidentSeverityId is required by the app but nullable here:
 *     deleting a severity - or a template, for incidentTemplateId - clears
 *     it on the forms that use it, rather than being blocked by them or
 *     deleting them;
 *   - IncidentFormSubmission: one row per submission, deleted with its form
 *     and kept, with no incident, when its incident is deleted;
 *   - IncidentTemplate.customFieldSettings: which custom fields the Declare
 *     Incident form asks for when an incident is declared from a template.
 *     Nullable with no default, so every existing template keeps asking
 *     exactly what it asked before.
 */

export class AddIncidentForms1796400000000 implements MigrationInterface {
  public name: string = "AddIncidentForms1796400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "IncidentForm" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" text, "isEnabled" boolean NOT NULL DEFAULT true, "shareKey" uuid NOT NULL, "incidentSeverityId" uuid, "allowReporterToChooseSeverity" boolean NOT NULL DEFAULT false, "incidentTemplateId" uuid, "descriptionSetting" character varying(100) NOT NULL DEFAULT 'Optional', "customFieldSettings" jsonb, "isReporterDetailsRequired" boolean NOT NULL DEFAULT true, "successMessage" text, "ipWhitelist" text, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "UQ_9c11c2b692cea31727c95c28e98" UNIQUE ("shareKey"), CONSTRAINT "PK_21977001f0d4b88fbc0135c7dd0" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c7eb6e8981e8f6e9a2fe53b6bb" ON "IncidentForm" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_473919ea7b451ba0dfc871a4c6" ON "IncidentForm" ("incidentSeverityId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c94880b38a72f9b03328477c48" ON "IncidentForm" ("incidentTemplateId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncidentFormSubmission" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "incidentFormId" uuid NOT NULL, "incidentId" uuid, "reporterName" character varying(100), "reporterEmail" character varying(100), CONSTRAINT "PK_1b520515a97ed5403da203f4ab4" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_56fa38b3bc7c97117dac332110" ON "IncidentFormSubmission" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4fe1421ca5d762a0f1a8f78c68" ON "IncidentFormSubmission" ("incidentFormId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_44b1e21a80ccad4238d803c17d" ON "IncidentFormSubmission" ("incidentId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplate" ADD "customFieldSettings" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentForm" ADD CONSTRAINT "FK_c7eb6e8981e8f6e9a2fe53b6bb8" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentForm" ADD CONSTRAINT "FK_473919ea7b451ba0dfc871a4c6e" FOREIGN KEY ("incidentSeverityId") REFERENCES "IncidentSeverity"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentForm" ADD CONSTRAINT "FK_c94880b38a72f9b03328477c48c" FOREIGN KEY ("incidentTemplateId") REFERENCES "IncidentTemplate"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentForm" ADD CONSTRAINT "FK_850356f3fc192628a97681f9385" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentForm" ADD CONSTRAINT "FK_76e881e65b593b3980158fadf81" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentFormSubmission" ADD CONSTRAINT "FK_56fa38b3bc7c97117dac3321103" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentFormSubmission" ADD CONSTRAINT "FK_4fe1421ca5d762a0f1a8f78c687" FOREIGN KEY ("incidentFormId") REFERENCES "IncidentForm"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentFormSubmission" ADD CONSTRAINT "FK_44b1e21a80ccad4238d803c17da" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentFormSubmission" DROP CONSTRAINT "FK_44b1e21a80ccad4238d803c17da"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentFormSubmission" DROP CONSTRAINT "FK_4fe1421ca5d762a0f1a8f78c687"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentFormSubmission" DROP CONSTRAINT "FK_56fa38b3bc7c97117dac3321103"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentForm" DROP CONSTRAINT "FK_76e881e65b593b3980158fadf81"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentForm" DROP CONSTRAINT "FK_850356f3fc192628a97681f9385"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentForm" DROP CONSTRAINT "FK_c94880b38a72f9b03328477c48c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentForm" DROP CONSTRAINT "FK_473919ea7b451ba0dfc871a4c6e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentForm" DROP CONSTRAINT "FK_c7eb6e8981e8f6e9a2fe53b6bb8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentTemplate" DROP COLUMN "customFieldSettings"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_44b1e21a80ccad4238d803c17d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4fe1421ca5d762a0f1a8f78c68"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_56fa38b3bc7c97117dac332110"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentFormSubmission"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c94880b38a72f9b03328477c48"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_473919ea7b451ba0dfc871a4c6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c7eb6e8981e8f6e9a2fe53b6bb"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentForm"`);
  }
}
