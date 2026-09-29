import { MigrationInterface, QueryRunner } from "typeorm";

export class AddInstanceIdToGlobalConfig1783161406136
  implements MigrationInterface
{
  public name = "AddInstanceIdToGlobalConfig1783161406136";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "GlobalConfig" ADD "instanceId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD CONSTRAINT "UQ_d80c0e0c7aeb62d6f87f5781035" UNIQUE ("instanceId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP CONSTRAINT "UQ_d80c0e0c7aeb62d6f87f5781035"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "instanceId"`,
    );
  }
}
