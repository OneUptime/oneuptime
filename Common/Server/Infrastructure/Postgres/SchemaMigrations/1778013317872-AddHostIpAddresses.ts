import { MigrationInterface, QueryRunner } from "typeorm";

export class AddHostIpAddresses1778013317872 implements MigrationInterface {
  public name = "AddHostIpAddresses1778013317872";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Host" ADD "hostIpAddresses" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Host" DROP COLUMN "hostIpAddresses"`);
  }
}
