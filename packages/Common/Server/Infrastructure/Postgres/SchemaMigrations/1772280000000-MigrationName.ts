import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1772280000000 implements MigrationInterface {
  public name = "MigrationName1772280000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "User" ADD "webauthnChallenge" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" ADD "webauthnChallengeExpiresAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "User" DROP COLUMN "webauthnChallengeExpiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "User" DROP COLUMN "webauthnChallenge"`,
    );
  }
}
