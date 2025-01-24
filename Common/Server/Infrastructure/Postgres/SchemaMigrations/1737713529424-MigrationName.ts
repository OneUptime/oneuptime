import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1737713529424 implements MigrationInterface {
  public name = "MigrationName1737713529424";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ADD "subscriberEmailNotificationFooterText" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" DROP COLUMN "subscriberEmailNotificationFooterText"`,
    );
  }
}
