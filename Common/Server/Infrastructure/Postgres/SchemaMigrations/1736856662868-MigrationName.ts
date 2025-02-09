import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1736856662868 implements MigrationInterface {
  public name = "MigrationName1736856662868";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" ADD "postedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertFeed" ADD "postedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceFeed" ADD "postedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceFeed" DROP COLUMN "postedAt"`,
    );
    await queryRunner.query(`ALTER TABLE "AlertFeed" DROP COLUMN "postedAt"`);
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" DROP COLUMN "postedAt"`,
    );
  }
}
