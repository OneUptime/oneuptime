import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A Kubernetes cluster's compliance follow-ups:
 *
 *   - An accepted finding (#9874): DataSecurityComplianceSetting.objectKind
 *     and objectName name the one Kubernetes object - a workload, a role, a
 *     binding, a namespace - whose failing finding a setting accepts, and
 *     expiresAt when it fails again.
 *   - Every cluster's hardening on one page (#9876):
 *     KubernetesCluster.complianceSummary, how the cluster stood when it was
 *     last scored, and complianceSummaryRefreshedAt, when that was.
 *
 * Generated with npm run generate-postgres-migration. Five nullable columns
 * with no default: adding them rewrites nothing and reads no row.
 */
export class AddKubernetesComplianceAcceptancesAndSummaries1809186710000
  implements MigrationInterface
{
  public name: string =
    "AddKubernetesComplianceAcceptancesAndSummaries1809186710000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD "complianceSummary" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD "complianceSummaryRefreshedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityComplianceSetting" ADD "objectKind" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityComplianceSetting" ADD "objectName" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityComplianceSetting" ADD "expiresAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataSecurityComplianceSetting" DROP COLUMN "expiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityComplianceSetting" DROP COLUMN "objectName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataSecurityComplianceSetting" DROP COLUMN "objectKind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP COLUMN "complianceSummaryRefreshedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP COLUMN "complianceSummary"`,
    );
  }
}
