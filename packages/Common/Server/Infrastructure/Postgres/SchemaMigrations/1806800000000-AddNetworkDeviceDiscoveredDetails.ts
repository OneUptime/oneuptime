import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A Network Device keeps what discovery found out about it (issue #5185): the
 * SNMP system information and the reverse-DNS and NetBIOS names a discovery
 * scan read at its address, the MAC a walked router's ARP table gave it and
 * the address its probe resolved its DNS name to, each with how, by whom and
 * when it was read (discoveredDetails).
 *
 * One nullable jsonb column on an existing table, with no default, no index
 * and no key: adding it rewrites nothing and blocks nothing. Nothing to
 * backfill - each device's next scan, poll and router walk fill it in.
 */
export class AddNetworkDeviceDiscoveredDetails1806800000000
  implements MigrationInterface
{
  public name: string = "AddNetworkDeviceDiscoveredDetails1806800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "discoveredDetails" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "discoveredDetails"`,
    );
  }
}
