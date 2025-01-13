import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1736787495707 implements MigrationInterface {
  public name = "MigrationName1736787495707";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" ALTER COLUMN "moreInformationInMarkdown" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertFeed" ALTER COLUMN "moreInformationInMarkdown" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceFeed" ALTER COLUMN "moreInformationInMarkdown" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceFeed" ALTER COLUMN "moreInformationInMarkdown" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertFeed" ALTER COLUMN "moreInformationInMarkdown" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" ALTER COLUMN "moreInformationInMarkdown" SET NOT NULL`,
    );
  }
}
