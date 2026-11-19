import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * What a resource turned off of a compliance framework (#9555,
 * Types/DataSecurity/ComplianceScope):
 *
 *   - "DataSecurityComplianceSetting": one row per framework, or one of its
 *     requirements, a Kubernetes cluster, a Docker or Podman host, a
 *     database, a cloud resource or a service turned off for its own data
 *     stores (deleted with its project), read together for one resource.
 *
 * The table is new and empty, so its indexes and foreign keys are built
 * here; no existing table changes.
 */
export class AddDataSecurityComplianceSettings1809184730000
  implements MigrationInterface
{
  public name: string = "AddDataSecurityComplianceSettings1809184730000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "DataSecurityComplianceSetting" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "resourceType" character varying(100) NOT NULL, "resourceId" uuid NOT NULL, "framework" character varying(100) NOT NULL, "requirement" character varying(100), "isEnabled" boolean NOT NULL DEFAULT false, "note" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_a6bb393ba33838b78728627277c" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_68013570ecc001a84b85011663" ON "DataSecurityComplianceSetting" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_822874655fd91a535404f23063" ON "DataSecurityComplianceSetting" ("projectId", "resourceType", "resourceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityComplianceSetting" ADD CONSTRAINT "FK_68013570ecc001a84b850116633" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityComplianceSetting" ADD CONSTRAINT "FK_859e4b0e32211d22dcaca67346e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityComplianceSetting" ADD CONSTRAINT "FK_ad80fa8e64544f907487abab43f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataSecurityComplianceSetting" DROP CONSTRAINT "FK_ad80fa8e64544f907487abab43f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityComplianceSetting" DROP CONSTRAINT "FK_859e4b0e32211d22dcaca67346e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityComplianceSetting" DROP CONSTRAINT "FK_68013570ecc001a84b850116633"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_822874655fd91a535404f23063"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_68013570ecc001a84b85011663"`,
    );
    await queryRunner.query(`DROP TABLE "DataSecurityComplianceSetting"`);
  }
}
