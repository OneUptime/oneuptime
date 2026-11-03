import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The last time a Meraki connection was asked to add its organization's
 * devices as network devices (Add devices, NetworkControllerDeviceAddState):
 * what was asked for, by whom and when, how far the worker got and what it
 * could not add. Written by OneUptime only.
 *
 * Nullable, with no default and no row written: no connection was ever
 * asked, so every row stays as it was. Adding it is a catalogue change, not
 * a rewrite.
 */
export class AddNetworkControllerConnectionLastDeviceAdd1808900000000
  implements MigrationInterface
{
  public name = "AddNetworkControllerConnectionLastDeviceAdd1808900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkControllerConnection" ADD "lastDeviceAdd" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkControllerConnection" DROP COLUMN "lastDeviceAdd"`,
    );
  }
}
