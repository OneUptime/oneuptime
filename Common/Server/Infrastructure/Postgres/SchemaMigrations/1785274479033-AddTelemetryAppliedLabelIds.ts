import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * `telemetryAppliedLabelIds` records the label ids telemetry ingest has
 * already applied to a resource from its `oneuptime.label.*` resource
 * attributes, so ingest applies each declared label once instead of on every
 * batch. See Common/Server/Utils/Telemetry/TelemetryAutoLabels.ts.
 *
 * Deliberately left NULL for existing rows rather than backfilled: NULL means
 * "ingest has not applied telemetry labels here yet", and the first batch
 * after this migration converges it to whatever telemetry currently declares
 * without attaching anything that is already on the resource.
 */
export class AddTelemetryAppliedLabelIds1785274479033
  implements MigrationInterface
{
  public name = "AddTelemetryAppliedLabelIds1785274479033";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" ADD "telemetryAppliedLabelIds" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" ADD "telemetryAppliedLabelIds" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" ADD "telemetryAppliedLabelIds" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" ADD "telemetryAppliedLabelIds" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" ADD "telemetryAppliedLabelIds" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmCluster" ADD "telemetryAppliedLabelIds" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" ADD "telemetryAppliedLabelIds" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "telemetryAppliedLabelIds" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunction" ADD "telemetryAppliedLabelIds" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" ADD "telemetryAppliedLabelIds" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" ADD "telemetryAppliedLabelIds" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "Service" ADD "telemetryAppliedLabelIds" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Service" DROP COLUMN "telemetryAppliedLabelIds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RumApplication" DROP COLUMN "telemetryAppliedLabelIds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" DROP COLUMN "telemetryAppliedLabelIds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServerlessFunction" DROP COLUMN "telemetryAppliedLabelIds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Host" DROP COLUMN "telemetryAppliedLabelIds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" DROP COLUMN "telemetryAppliedLabelIds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerSwarmCluster" DROP COLUMN "telemetryAppliedLabelIds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxCluster" DROP COLUMN "telemetryAppliedLabelIds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CephCluster" DROP COLUMN "telemetryAppliedLabelIds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanHost" DROP COLUMN "telemetryAppliedLabelIds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerHost" DROP COLUMN "telemetryAppliedLabelIds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesCluster" DROP COLUMN "telemetryAppliedLabelIds"`,
    );
  }
}
