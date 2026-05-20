import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTelemetryRetentionToHostDockerKubernetes1779282769946
  implements MigrationInterface
{
  public name: string =
    "AddTelemetryRetentionToHostDockerKubernetes1779282769946";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "retainTelemetryDataForDays" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "telemetryRetentionConfig" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" ADD "retainTelemetryDataForDays" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" ADD "telemetryRetentionConfig" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD "retainTelemetryDataForDays" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD "telemetryRetentionConfig" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP COLUMN "telemetryRetentionConfig"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP COLUMN "retainTelemetryDataForDays"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" DROP COLUMN "telemetryRetentionConfig"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" DROP COLUMN "retainTelemetryDataForDays"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "telemetryRetentionConfig"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "retainTelemetryDataForDays"`,
    );
  }
}
