import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A vCenter's, a cluster's, an ESXi host's or a VM's own health rules, and
 * "for at least N minutes" (#11469): the VMwareHealthRuleOverride table (new,
 * so empty: its indexes and keys are made with it), each part's last
 * readings on its VMwareResource row (nullable, no default: no row is
 * rewritten), and a period per group of the project's rules (a constant
 * default: no row is rewritten either).
 */
export class AddVMwareHealthRuleOverridesAndEvaluationPeriods1809187811469
  implements MigrationInterface
{
  public name = "AddVMwareHealthRuleOverridesAndEvaluationPeriods1809187811469";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "VMwareHealthRuleOverride" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "vmwareVCenterId" uuid NOT NULL, "scope" character varying(100) NOT NULL, "resourceExternalId" character varying(100), "resourceName" character varying(100), "datacenterName" character varying(100), "clusterName" character varying(100), "hostName" character varying(100), "rules" jsonb, CONSTRAINT "PK_60c3458ea39ab55e8f76b79d157" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4d393f51e8c65cdc7ed9f6a1c6" ON "VMwareHealthRuleOverride" ("vmwareVCenterId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0bae8fd34b68764639052243d8" ON "VMwareHealthRuleOverride" ("projectId", "vmwareVCenterId", "scope") WHERE "deletedAt" IS NULL AND "resourceExternalId" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_6fc42ebeebeaec70215672b040" ON "VMwareHealthRuleOverride" ("projectId", "vmwareVCenterId", "scope", "resourceExternalId") WHERE "deletedAt" IS NULL AND "resourceExternalId" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" ADD "healthReadings" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareHealthSetting" ADD "hostEvaluationMinutes" integer DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareHealthSetting" ADD "datastoreEvaluationMinutes" integer DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareHealthSetting" ADD "vmSwapEvaluationMinutes" integer DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareHealthSetting" ADD "vmMemoryCpuEvaluationMinutes" integer DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareHealthSetting" ADD "resourcePoolEvaluationMinutes" integer DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareHealthRuleOverride" ADD CONSTRAINT "FK_b61526de471725a485224c11ffa" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareHealthRuleOverride" ADD CONSTRAINT "FK_4d393f51e8c65cdc7ed9f6a1c6e" FOREIGN KEY ("vmwareVCenterId") REFERENCES "VMwareVCenter"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "VMwareHealthRuleOverride" DROP CONSTRAINT "FK_4d393f51e8c65cdc7ed9f6a1c6e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareHealthRuleOverride" DROP CONSTRAINT "FK_b61526de471725a485224c11ffa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareHealthSetting" DROP COLUMN "resourcePoolEvaluationMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareHealthSetting" DROP COLUMN "vmMemoryCpuEvaluationMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareHealthSetting" DROP COLUMN "vmSwapEvaluationMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareHealthSetting" DROP COLUMN "datastoreEvaluationMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareHealthSetting" DROP COLUMN "hostEvaluationMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VMwareResource" DROP COLUMN "healthReadings"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6fc42ebeebeaec70215672b040"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0bae8fd34b68764639052243d8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4d393f51e8c65cdc7ed9f6a1c6"`,
    );
    await queryRunner.query(`DROP TABLE "VMwareHealthRuleOverride"`);
  }
}
