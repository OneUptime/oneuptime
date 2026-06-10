import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Renames the polymorphic primary-entity columns on the two Postgres
 * telemetry tables from `serviceId`/`serviceType` to
 * `primaryEntityId`/`primaryEntityType`, mirroring the analytics-model
 * rename (see Internal/Docs/RenameServiceIdToPrimaryEntityId.md).
 *
 * Postgres `RENAME COLUMN` automatically updates dependent objects
 * (the `TelemetryException` unique index on
 * (projectId, serviceId, fingerprint) and the `TelemetryUsageBilling`
 * FK/JoinColumn), so no index/constraint drop+recreate is required.
 */
export class RenameTelemetryServiceIdToPrimaryEntityId1781100000001
  implements MigrationInterface
{
  public name = "RenameTelemetryServiceIdToPrimaryEntityId1781100000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" RENAME COLUMN "serviceId" TO "primaryEntityId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" RENAME COLUMN "serviceType" TO "primaryEntityType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" RENAME COLUMN "serviceId" TO "primaryEntityId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" RENAME COLUMN "serviceType" TO "primaryEntityType"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" RENAME COLUMN "primaryEntityType" TO "serviceType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryUsageBilling" RENAME COLUMN "primaryEntityId" TO "serviceId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" RENAME COLUMN "primaryEntityType" TO "serviceType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryException" RENAME COLUMN "primaryEntityId" TO "serviceId"`,
    );
  }
}
