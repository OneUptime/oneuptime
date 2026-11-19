import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * What a Kubernetes claim's or node's disk reading needs beside the
 * latestVolume* columns (#9643, #9645), mirrored by OtelMetricsIngestService:
 *
 *   - latestVolumeMeasuredAt: when the reading was taken. Only a fresh one
 *     lists a disk under Needs attention, and a node's metricsUpdatedAt moves
 *     with its CPU and memory too.
 *   - latestVolumeUsedBaseline*: a claim's used bytes at an earlier reading,
 *     and when, for how fast it is filling.
 *   - latestImageFs*: a node's image filesystem, when it is a disk of its
 *     own.
 *
 * Nullable columns with no default: adding them rewrites nothing.
 */
export class AddKubernetesDiskReadings1809185300000
  implements MigrationInterface
{
  public name: string = "AddKubernetesDiskReadings1809185300000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD "latestVolumeMeasuredAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD "latestVolumeUsedBaselineBytes" bigint`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD "latestVolumeUsedBaselineAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD "latestImageFsCapacityBytes" bigint`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD "latestImageFsAvailableBytes" bigint`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP COLUMN "latestImageFsAvailableBytes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP COLUMN "latestImageFsCapacityBytes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP COLUMN "latestVolumeUsedBaselineAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP COLUMN "latestVolumeUsedBaselineBytes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP COLUMN "latestVolumeMeasuredAt"`,
    );
  }
}
