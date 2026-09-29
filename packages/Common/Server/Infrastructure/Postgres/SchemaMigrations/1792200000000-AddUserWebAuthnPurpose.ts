import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserWebAuthnPurpose1792200000000 implements MigrationInterface {
  public name = "AddUserWebAuthnPurpose1792200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserWebAuthn" ADD "isPasskey" boolean`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserWebAuthn" DROP COLUMN "isPasskey"`,
    );
  }
}
