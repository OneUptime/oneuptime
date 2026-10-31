import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A form's own domains (Models/DatabaseModels/FormDomain): report.acme.com
 * answering with a form, verified and served over HTTPS, as a status page's
 * and a dashboard's custom domains are. One row per domain, with the same
 * columns as "StatusPageDomain" and "DashboardDomain", deleted with its
 * form, its project or its parent domain. Read by its name (fullDomain)
 * whenever a visit to a custom domain is served.
 *
 * The table is new and empty, so its indexes and foreign keys are built
 * here. Nothing is added to an existing table.
 */
export class AddFormDomain1808712000000 implements MigrationInterface {
  public name: string = "AddFormDomain1808712000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "FormDomain" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "domainId" uuid NOT NULL, "formId" uuid NOT NULL, "subdomain" character varying(100) NOT NULL, "fullDomain" character varying(100) NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "cnameVerificationToken" character varying(100) NOT NULL, "isCnameVerified" boolean NOT NULL DEFAULT false, "isSslOrdered" boolean NOT NULL DEFAULT false, "isSslProvisioned" boolean NOT NULL DEFAULT false, "customCertificate" text, "customCertificateKey" text, "isCustomCertificate" boolean NOT NULL DEFAULT false, "certificateReissueRequestedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_5a0ea1ba5c7db8c325322ccdb90" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c9f2a3983c9b37606f657901aa" ON "FormDomain" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_238a57509e819f2ec828dd3df4" ON "FormDomain" ("domainId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3704dae1ae20f6380fdaad67b4" ON "FormDomain" ("formId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c36cf400c08ed922e3481518a4" ON "FormDomain" ("fullDomain") `,
    );
    await queryRunner.query(
      `ALTER TABLE "FormDomain" ADD CONSTRAINT "FK_c9f2a3983c9b37606f657901aab" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormDomain" ADD CONSTRAINT "FK_238a57509e819f2ec828dd3df47" FOREIGN KEY ("domainId") REFERENCES "Domain"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormDomain" ADD CONSTRAINT "FK_3704dae1ae20f6380fdaad67b49" FOREIGN KEY ("formId") REFERENCES "Form"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormDomain" ADD CONSTRAINT "FK_e4521b8353105a19092ac740cb7" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormDomain" ADD CONSTRAINT "FK_78b2e2dfcdf116a4e3523f3cdc0" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "FormDomain" DROP CONSTRAINT "FK_78b2e2dfcdf116a4e3523f3cdc0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormDomain" DROP CONSTRAINT "FK_e4521b8353105a19092ac740cb7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormDomain" DROP CONSTRAINT "FK_3704dae1ae20f6380fdaad67b49"`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormDomain" DROP CONSTRAINT "FK_238a57509e819f2ec828dd3df47"`,
    );
    await queryRunner.query(
      `ALTER TABLE "FormDomain" DROP CONSTRAINT "FK_c9f2a3983c9b37606f657901aab"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c36cf400c08ed922e3481518a4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3704dae1ae20f6380fdaad67b4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_238a57509e819f2ec828dd3df4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c9f2a3983c9b37606f657901aa"`,
    );
    await queryRunner.query(`DROP TABLE "FormDomain"`);
  }
}
