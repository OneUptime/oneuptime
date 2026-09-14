import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMacAddressToNetworkDevice1791700000000
  implements MigrationInterface
{
  public name: string = "AddMacAddressToNetworkDevice1791700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "macAddress" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "isMacAddressLearned" boolean DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "isMacAddressLearned"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "macAddress"`,
    );
  }
}
