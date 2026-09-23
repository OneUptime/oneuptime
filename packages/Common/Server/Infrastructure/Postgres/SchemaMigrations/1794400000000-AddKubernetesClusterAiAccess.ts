import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then trimmed to this
 * change. OneUptime AI access to a Kubernetes cluster: the cluster binds the
 * Runner (and optional Kubernetes credential) AI uses for kubectl, plus its
 * investigation switch, remediation mode and allowlist. RunnerJob and
 * AutoRemediationSuggestion gain the cluster a kubectl command ran against
 * so the cluster's AI page can list every command AI ran on it.
 */
export class AddKubernetesClusterAiAccess1794400000000
  implements MigrationInterface
{
  public name: string = "AddKubernetesClusterAiAccess1794400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD "aiAccessRunnerId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD "aiAccessCredentialId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD "isAiInvestigationEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD "aiRemediationMode" character varying(100) NOT NULL DEFAULT 'Disabled'`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD "aiKubectlCommandAllowlist" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD "aiAccessLastVerifiedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD "aiAccessLastError" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD "aiAccessConfiguredAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD "aiAccessRunnerBoundAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" ADD "kubernetesClusterId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD "kubernetesClusterId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9cfdcee74d277dcb577dd5889d" ON "KubernetesCluster" ("aiAccessRunnerId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d3aac9a59774cca6c0f0299992" ON "RunnerJob" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8730770e8d450cbfa54236ed13" ON "AutoRemediationSuggestion" ("kubernetesClusterId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD CONSTRAINT "FK_9cfdcee74d277dcb577dd5889d5" FOREIGN KEY ("aiAccessRunnerId") REFERENCES "Runner"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD CONSTRAINT "FK_b4a0ae50ee63ca22e46e396ca3e" FOREIGN KEY ("aiAccessCredentialId") REFERENCES "RunbookCredential"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" ADD CONSTRAINT "FK_d3aac9a59774cca6c0f0299992a" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD CONSTRAINT "FK_8730770e8d450cbfa54236ed13a" FOREIGN KEY ("kubernetesClusterId") REFERENCES "KubernetesCluster"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP CONSTRAINT "FK_8730770e8d450cbfa54236ed13a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" DROP CONSTRAINT "FK_d3aac9a59774cca6c0f0299992a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP CONSTRAINT "FK_b4a0ae50ee63ca22e46e396ca3e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP CONSTRAINT "FK_9cfdcee74d277dcb577dd5889d5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8730770e8d450cbfa54236ed13"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d3aac9a59774cca6c0f0299992"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9cfdcee74d277dcb577dd5889d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "kubernetesClusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunnerJob" DROP COLUMN "kubernetesClusterId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP COLUMN "aiAccessRunnerBoundAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP COLUMN "aiAccessConfiguredAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP COLUMN "aiAccessLastError"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP COLUMN "aiAccessLastVerifiedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP COLUMN "aiKubectlCommandAllowlist"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP COLUMN "aiRemediationMode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP COLUMN "isAiInvestigationEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP COLUMN "aiAccessCredentialId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP COLUMN "aiAccessRunnerId"`,
    );
  }
}
