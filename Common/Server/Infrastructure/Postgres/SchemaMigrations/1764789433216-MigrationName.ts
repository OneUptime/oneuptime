import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1764789433216 implements MigrationInterface {
  public name = "MigrationName1764789433216";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "subscriberNotificationStatusOnPostmortemPublished" character varying NOT NULL DEFAULT 'Pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "subscriberNotificationStatusMessageOnPostmortemPublished" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "notifySubscribersOnPostmortemPublished" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "notifySubscribersOnPostmortemPublished"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "subscriberNotificationStatusMessageOnPostmortemPublished"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "subscriberNotificationStatusOnPostmortemPublished"`,
    );
  }
}
