import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1759232954703 implements MigrationInterface {
  public name = "MigrationName1759232954703";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "User" DROP COLUMN "twoFactorSecretCode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" DROP COLUMN "twoFactorAuthUrl"`,
    );
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "backupCodes"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" ADD "backupCodes" text`);
    await queryRunner.query(
      `ALTER TABLE "User" ADD "twoFactorAuthUrl" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" ADD "twoFactorSecretCode" character varying(100)`,
    );
  }
}
