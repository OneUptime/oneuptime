import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPerUserPasswordSalt1786018109307 implements MigrationInterface {
  public name = "AddPerUserPasswordSalt1786018109307";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "User" ADD "passwordSalt" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPagePrivateUser" ADD "passwordSalt" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPagePrivateUser" DROP COLUMN "passwordSalt"`,
    );
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "passwordSalt"`);
  }
}
