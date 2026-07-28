import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Crash-loop evidence on KubernetesContainer.
 *
 * Every ALTER here is additive and either nullable or defaulted, so all five
 * are metadata-only in Postgres and instant even on a large table.
 *
 * The index is the load-bearing part: KubernetesContainer previously carried
 * only (projectId), (kubernetesClusterId) and the 5-column unique index, so
 * the crash-loop detector's `reason = 'CrashLoopBackOff'` predicate would
 * scan the whole project slice every 15 minutes.
 */
export class AddKubernetesCrashLoopEvidence1785400000000
  implements MigrationInterface
{
  public name: string = "AddKubernetesCrashLoopEvidence1785400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "KubernetesContainer" ADD "lastTerminatedReason" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesContainer" ADD "lastTerminatedExitCode" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesContainer" ADD "lastTerminatedFinishedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesContainer" ADD "waitingMessage" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesContainer" ADD "isInitContainer" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_KubernetesContainer_projectId_reason" ON "KubernetesContainer" ("projectId", "reason") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_KubernetesContainer_projectId_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesContainer" DROP COLUMN "isInitContainer"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesContainer" DROP COLUMN "waitingMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesContainer" DROP COLUMN "lastTerminatedFinishedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesContainer" DROP COLUMN "lastTerminatedExitCode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesContainer" DROP COLUMN "lastTerminatedReason"`,
    );
  }
}
