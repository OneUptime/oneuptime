import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Discovered devices nothing has seen for a while are removed (issue #6389).
 *
 *   - "Project"."discoveredDeviceRetentionInDays": how many days a
 *     discovered device stays once nothing sees it any more
 *     (Types/NetworkDevice/DiscoveredDeviceRetention). 30 unless the project
 *     picks 7, 14, 60, 90, 180 or 365, or 0 to keep every device, and every
 *     project starts at 30. A constant default is the table's metadata on
 *     Postgres 11 and later: no row is rewritten.
 *   - "NetworkEndpoint"."editedAt": when a person last added the device or
 *     changed its vendor, IP address or site. The server writes it
 *     (NetworkEndpointService), and a device that has one is never removed.
 *     Nullable with no default: no row is rewritten.
 *
 * Generated with npm run generate-postgres-migration, then numbered after
 * the last registered migration. The index the generator wrote with it is
 * built online in AddNetworkEndpointLastSeenIndex1809080463891, and the
 * devices people changed before this migration are marked edited in
 * KeepEditedDiscoveredDevices1809080463892.
 */
export class AddDiscoveredDeviceRetention1809080463890
  implements MigrationInterface
{
  public name: string = "AddDiscoveredDeviceRetention1809080463890";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "discoveredDeviceRetentionInDays" integer NOT NULL DEFAULT '30'`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" ADD "editedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkEndpoint" DROP COLUMN "editedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "discoveredDeviceRetentionInDays"`,
    );
  }
}
