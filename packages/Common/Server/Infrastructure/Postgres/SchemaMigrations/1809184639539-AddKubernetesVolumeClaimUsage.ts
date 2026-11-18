import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A persistent volume claim's used, free and capacity (#9539): the latest
 * k8s.volume.* point the kubernetes-agent reports for the claim, mirrored
 * onto its KubernetesResource row by OtelMetricsIngestService. Nullable
 * columns with no default: adding them rewrites nothing.
 */
export class AddKubernetesVolumeClaimUsage1809184639539
  implements MigrationInterface
{
  public name: string = "AddKubernetesVolumeClaimUsage1809184639539";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD "latestVolumeCapacityBytes" bigint`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD "latestVolumeAvailableBytes" bigint`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD "latestVolumeInodes" bigint`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD "latestVolumeInodesFree" bigint`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP COLUMN "latestVolumeInodesFree"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP COLUMN "latestVolumeInodes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP COLUMN "latestVolumeAvailableBytes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP COLUMN "latestVolumeCapacityBytes"`,
    );
  }
}
