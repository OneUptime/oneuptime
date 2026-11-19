import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The namespace a compliance setting is for (#9627):
 * DataSecurityComplianceSetting.namespace, which lets a Kubernetes cluster
 * turn its own frameworks - the Pod Security Standards and the CIS
 * Kubernetes Benchmark - or one of their controls off for one namespace, as
 * Pod Security Admission exempts a namespace. Empty for the whole resource.
 *
 * Generated with npm run generate-postgres-migration. One nullable column
 * with no default: adding it rewrites nothing and reads no row.
 */
export class AddComplianceSettingNamespace1809185400000
  implements MigrationInterface
{
  public name: string = "AddComplianceSettingNamespace1809185400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataSecurityComplianceSetting" ADD "namespace" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataSecurityComplianceSetting" DROP COLUMN "namespace"`,
    );
  }
}
