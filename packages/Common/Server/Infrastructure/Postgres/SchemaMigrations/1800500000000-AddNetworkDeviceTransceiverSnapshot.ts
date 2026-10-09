import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Transceiver health: each device keeps the optics (SFP, SFP+, QSFP) in its
 * ports - identity, readings against the device's thresholds, whether each
 * is still detected, and a month of daily received power averages. One
 * nullable jsonb column - adding it rewrites no rows and takes no long lock.
 */
export class AddNetworkDeviceTransceiverSnapshot1800500000000
  implements MigrationInterface
{
  public name = "AddNetworkDeviceTransceiverSnapshot1800500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "transceiverSnapshot" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "transceiverSnapshot"`,
    );
  }
}
