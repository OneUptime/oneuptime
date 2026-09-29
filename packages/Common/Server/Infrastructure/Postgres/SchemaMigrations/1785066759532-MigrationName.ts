import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1785066759532 implements MigrationInterface {
  public name = "MigrationName1785066759532";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * 1784200000000 added these two as `text`, but the entity declares them
     * ColumnType.LongText, which maps to `varchar`. The generator wants to
     * DROP and re-ADD the columns; an in-place TYPE change reaches the same
     * schema without discarding the SNMP v3 credentials already stored on
     * existing discovery scans.
     */
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ALTER COLUMN "snmpV3AuthKey" TYPE character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ALTER COLUMN "snmpV3PrivKey" TYPE character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ALTER COLUMN "snmpV3PrivKey" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceDiscoveryScan" ALTER COLUMN "snmpV3AuthKey" TYPE text`,
    );
  }
}
