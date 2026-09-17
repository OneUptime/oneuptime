import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1769802715014 implements MigrationInterface {
  public name = "MigrationName1769802715014";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentRole" ADD "canAssignMultipleUsers" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentRole" DROP COLUMN "canAssignMultipleUsers"`,
    );
  }
}
