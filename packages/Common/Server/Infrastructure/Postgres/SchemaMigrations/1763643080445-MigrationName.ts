import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1763643080445 implements MigrationInterface {
  public name = "MigrationName1763643080445";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "enableMasterPassword" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "masterPassword" character varying(64)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "masterPassword"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "enableMasterPassword"`,
    );
  }
}
