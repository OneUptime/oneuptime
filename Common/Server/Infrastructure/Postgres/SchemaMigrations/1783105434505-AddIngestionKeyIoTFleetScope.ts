import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * TelemetryIngestionKey.iotFleetNames — optional IoT fleet scoping
 * for ingestion keys. Null/empty = unscoped (pre-existing behavior);
 * when set, telemetry authenticated with the key is only accepted for
 * OTLP resources whose iot.fleet.name is in this list, so one
 * compromised device key cannot spoof other fleets (or non-IoT
 * services).
 */
export class AddIngestionKeyIoTFleetScope1783105434505
  implements MigrationInterface
{
  public name = "AddIngestionKeyIoTFleetScope1783105434505";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" ADD "iotFleetNames" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionKey" DROP COLUMN "iotFleetNames"`,
    );
  }
}
