import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserWebAuthnPurpose1789067310765 implements MigrationInterface {
  name = "AddUserWebAuthnPurpose1789067310765";

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
