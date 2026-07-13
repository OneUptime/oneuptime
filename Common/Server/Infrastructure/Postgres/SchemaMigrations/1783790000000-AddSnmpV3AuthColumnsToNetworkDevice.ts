import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSnmpV3AuthColumnsToNetworkDevice1783790000000
  implements MigrationInterface
{
  public name = "AddSnmpV3AuthColumnsToNetworkDevice1783790000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "snmpV3SecurityLevel" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "snmpV3Username" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "snmpV3AuthProtocol" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "snmpV3AuthKey" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "snmpV3PrivProtocol" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "snmpV3PrivKey" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "snmpV3PrivKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "snmpV3PrivProtocol"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "snmpV3AuthKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "snmpV3AuthProtocol"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "snmpV3Username"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "snmpV3SecurityLevel"`,
    );
  }
}
