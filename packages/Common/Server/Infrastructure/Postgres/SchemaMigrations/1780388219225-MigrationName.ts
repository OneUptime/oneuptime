import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Make TelemetryException.serviceId polymorphic:
 *  - Drop the foreign key to Service. An exception's serviceId can be a
 *    Service, a Host / DockerHost / KubernetesCluster id, or the projectId
 *    for unattributed (Unknown) telemetry — a FK to Service rejected every
 *    non-Service exception and forced ingest to skip them.
 *  - Add a serviceType discriminator (OpenTelemetry / Host / DockerHost /
 *    KubernetesCluster / Unknown) so the Issues UI can attribute each issue
 *    to the kind of resource that produced it. Nullable; legacy rows (all
 *    real Services) are treated as OpenTelemetry on read.
 */
export class MigrationName1780388219225 implements MigrationInterface {
  public name = "MigrationName1780388219225";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP CONSTRAINT IF EXISTS "FK_08a0cfa9f184257b1e57da4cf50"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD COLUMN IF NOT EXISTS "serviceType" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" DROP COLUMN IF EXISTS "serviceType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" ADD CONSTRAINT "FK_08a0cfa9f184257b1e57da4cf50" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
