import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Add TelemetryUsageBilling.serviceType — the resource-type discriminator
 * for a usage row (OpenTelemetry / Host / DockerHost / KubernetesCluster /
 * Unknown). Lets the usage breakdown attribute ingestion to the kind of
 * resource that produced it, now that non-Service telemetry is metered.
 * Nullable; legacy rows (all real Services) are treated as OpenTelemetry.
 */
export class MigrationName1780382837019 implements MigrationInterface {
  public name = "MigrationName1780382837019";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" ADD COLUMN IF NOT EXISTS "serviceType" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" DROP COLUMN IF EXISTS "serviceType"`,
    );
  }
}
