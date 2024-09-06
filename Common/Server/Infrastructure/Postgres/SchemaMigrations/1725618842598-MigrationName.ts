import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1725618842598 implements MigrationInterface {
  public name = "MigrationName1725618842598";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" ALTER COLUMN "endAnnouncementAt" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageAnnouncement" ALTER COLUMN "endAnnouncementAt" SET NOT NULL`,
    );
  }
}
