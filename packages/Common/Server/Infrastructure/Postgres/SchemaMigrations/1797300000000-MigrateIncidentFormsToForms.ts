import { MigrationInterface, QueryRunner } from "typeorm";
import {
  ConvertedLegacyIncidentForm,
  convertLegacyIncidentForm,
  LegacyIncidentCustomFieldRow,
  LegacyIncidentFormRow,
} from "../../../../Types/Form/LegacyIncidentFormConversion";
import FormTargetType from "../../../../Types/Form/FormTargetType";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Forms (the Forms product) replace incident forms.
 *
 * Schema (generated): the Form and FormSubmission tables. A form builds its
 * own questions (fields) and decides what a submission creates (targetType,
 * targetSettings); a submission keeps every answer, and links the incident or
 * the scheduled maintenance event it created.
 *
 * Data (hand-added, between the two, before the old tables are dropped):
 *
 *   1. Every incident form becomes a form with the same id, link key, name,
 *      description, switch, success message, IP allowlist and creator, that
 *      creates incidents exactly as it did: its severity and template become
 *      the On Submit settings, and its questions become the form's - Title,
 *      Description (unless Hidden), Severity (when the reporter could choose
 *      one), the custom fields it asked, Your Name and Your Email - in the
 *      same order and as required as before (LegacyIncidentFormConversion).
 *      The link key is kept, so every link already shared keeps working: the
 *      Accounts app sends /accounts/incident-form/<key> on to
 *      /accounts/form/<key>.
 *   2. Every submission is kept, with its form, its incident and the
 *      reporter's name and email. Incident form submissions did not keep the
 *      answers themselves (those are on the incident), so they have none.
 *   3. Every team and API key that held an incident form permission holds
 *      the matching form permission instead.
 *
 * Schema (hand-added): the IncidentForm and IncidentFormSubmission tables
 * are dropped - TypeORM generates nothing for tables whose entity is gone.
 * IncidentTemplate.customFieldSettings, added by the same earlier migration,
 * is kept: incident templates still use it.
 *
 * down() puts the old tables back, empty, and the permissions back; it does
 * not move forms back into them.
 */

export const LEGACY_PERMISSION_RENAMES: Array<[string, string]> = [
  ["CreateIncidentForm", "CreateForm"],
  ["DeleteIncidentForm", "DeleteForm"],
  ["EditIncidentForm", "EditForm"],
  ["ReadIncidentForm", "ReadForm"],
  ["DeleteIncidentFormSubmission", "DeleteFormSubmission"],
  ["ReadIncidentFormSubmission", "ReadFormSubmission"],
];

export const PERMISSION_TABLES: Array<string> = [
  "TeamPermission",
  "ApiKeyPermission",
];

interface LegacyFormRow extends LegacyIncidentFormRow {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  projectId: string;
  description: string | null;
  isEnabled: boolean;
  shareKey: string;
  successMessage: string | null;
  ipWhitelist: string | null;
  createdByUserId: string | null;
}

interface LegacyCustomFieldRow extends LegacyIncidentCustomFieldRow {
  projectId: string;
}

export class MigrateIncidentFormsToForms1797300000000
  implements MigrationInterface
{
  public name: string = "MigrateIncidentFormsToForms1797300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Schema (generated).
    await queryRunner.query(
      `CREATE TABLE "Form" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" text, "isEnabled" boolean NOT NULL DEFAULT true, "shareKey" uuid NOT NULL, "targetType" character varying(100) NOT NULL DEFAULT 'Incident', "fields" jsonb, "targetSettings" jsonb, "successMessage" text, "ipWhitelist" text, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "UQ_71f815a4f3829269f45c2b854b1" UNIQUE ("shareKey"), CONSTRAINT "PK_7c744da2c60917584894e2bb7e6" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ce62d903b72de5f3b500dcfb19" ON "Form" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "FormSubmission" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "formId" uuid NOT NULL, "answers" jsonb, "submitterName" character varying(100), "submitterEmail" character varying(100), "targetType" character varying(100), "incidentId" uuid, "scheduledMaintenanceId" uuid, CONSTRAINT "PK_d9173aca580d4947db400781b8b" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e4c71e997777fbca4da4f4a00d" ON "FormSubmission" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b6d44a71039ad83c7223564b13" ON "FormSubmission" ("formId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_85b704a8f60cfda604883bba73" ON "FormSubmission" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_731309e1f6f3b8bb4ea4189823" ON "FormSubmission" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Form" ADD CONSTRAINT "FK_ce62d903b72de5f3b500dcfb194" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Form" ADD CONSTRAINT "FK_4415a95efb3ac8e88da34970871" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Form" ADD CONSTRAINT "FK_4e8a4b94e1bc1d6bec291cb1b64" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmission" ADD CONSTRAINT "FK_e4c71e997777fbca4da4f4a00d7" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmission" ADD CONSTRAINT "FK_b6d44a71039ad83c7223564b138" FOREIGN KEY ("formId") REFERENCES "Form"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmission" ADD CONSTRAINT "FK_85b704a8f60cfda604883bba739" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmission" ADD CONSTRAINT "FK_731309e1f6f3b8bb4ea41898236" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Data (hand-added): 1. the forms.
    const forms: Array<LegacyFormRow> = await queryRunner.query(
      `SELECT "_id", "createdAt", "updatedAt", "version", "projectId", "name", "description", "isEnabled", "shareKey", "incidentSeverityId", "allowReporterToChooseSeverity", "incidentTemplateId", "descriptionSetting", "customFieldSettings", "isReporterDetailsRequired", "successMessage", "ipWhitelist", "createdByUserId" FROM "IncidentForm"`,
    );

    const projectIds: Array<string> = Array.from(
      new Set<string>(
        forms.map((form: LegacyFormRow): string => {
          return String(form.projectId);
        }),
      ),
    );

    const customFields: Array<LegacyCustomFieldRow> =
      projectIds.length > 0
        ? await queryRunner.query(
            `SELECT "_id", "projectId", "name", "description", "variableKey", "sortOrder" FROM "IncidentCustomField" WHERE "projectId" = ANY($1::uuid[])`,
            [projectIds],
          )
        : [];

    for (const form of forms) {
      const projectCustomFields: Array<LegacyCustomFieldRow> =
        customFields.filter((field: LegacyCustomFieldRow): boolean => {
          return String(field.projectId) === String(form.projectId);
        });

      const converted: ConvertedLegacyIncidentForm = convertLegacyIncidentForm(
        {
          form: form,
          customFields: projectCustomFields,
          generateId: (): string => {
            return ObjectID.generate().toString();
          },
        },
      );

      await queryRunner.query(
        `INSERT INTO "Form" ("_id", "createdAt", "updatedAt", "version", "projectId", "name", "description", "isEnabled", "shareKey", "targetType", "fields", "targetSettings", "successMessage", "ipWhitelist", "createdByUserId") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15)`,
        [
          form._id,
          form.createdAt,
          form.updatedAt,
          form.version,
          form.projectId,
          form.name,
          form.description,
          form.isEnabled,
          form.shareKey,
          FormTargetType.Incident,
          JSON.stringify(converted.fields),
          JSON.stringify(converted.targetSettings),
          form.successMessage,
          form.ipWhitelist,
          form.createdByUserId,
        ],
      );
    }

    // 2. The submissions, with no answers of their own.
    await queryRunner.query(
      `INSERT INTO "FormSubmission" ("_id", "createdAt", "updatedAt", "version", "projectId", "formId", "answers", "submitterName", "submitterEmail", "targetType", "incidentId") SELECT "_id", "createdAt", "updatedAt", "version", "projectId", "incidentFormId", '[]'::jsonb, "reporterName", "reporterEmail", $1, "incidentId" FROM "IncidentFormSubmission"`,
      [FormTargetType.Incident],
    );

    // 3. The permissions.
    for (const table of PERMISSION_TABLES) {
      for (const [from, to] of LEGACY_PERMISSION_RENAMES) {
        await queryRunner.query(
          `UPDATE "${table}" SET "permission" = $2 WHERE "permission" = $1`,
          [from, to],
        );
      }
    }

    // Schema (hand-added): the incident form tables go.
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The incident form tables come back, empty.
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

    for (const table of PERMISSION_TABLES) {
      for (const [from, to] of LEGACY_PERMISSION_RENAMES) {
        await queryRunner.query(
          `UPDATE "${table}" SET "permission" = $1 WHERE "permission" = $2`,
          [from, to],
        );
      }
    }

    // Schema (generated).
    await queryRunner.query(
      `ALTER TABLE "FormSubmission" DROP CONSTRAINT "FK_731309e1f6f3b8bb4ea41898236"`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmission" DROP CONSTRAINT "FK_85b704a8f60cfda604883bba739"`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmission" DROP CONSTRAINT "FK_b6d44a71039ad83c7223564b138"`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormSubmission" DROP CONSTRAINT "FK_e4c71e997777fbca4da4f4a00d7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Form" DROP CONSTRAINT "FK_4e8a4b94e1bc1d6bec291cb1b64"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Form" DROP CONSTRAINT "FK_4415a95efb3ac8e88da34970871"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Form" DROP CONSTRAINT "FK_ce62d903b72de5f3b500dcfb194"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_731309e1f6f3b8bb4ea4189823"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_85b704a8f60cfda604883bba73"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b6d44a71039ad83c7223564b13"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e4c71e997777fbca4da4f4a00d"`,
    );
    await queryRunner.query(`DROP TABLE "FormSubmission"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ce62d903b72de5f3b500dcfb19"`,
    );
    await queryRunner.query(`DROP TABLE "Form"`);
  }
}
