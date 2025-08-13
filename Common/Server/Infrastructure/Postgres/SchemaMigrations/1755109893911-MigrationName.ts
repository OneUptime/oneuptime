import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1755109893911 implements MigrationInterface {
  public name = "MigrationName1755109893911";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" ADD "deviceName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ALTER COLUMN "actionType" SET DEFAULT 'SendMessage'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkspaceNotificationLog" ALTER COLUMN "actionType" SET DEFAULT 'MessageSent'`,
    );
    await queryRunner.query(
      `ALTER TABLE "PushNotificationLog" DROP COLUMN "deviceName"`,
    );
  }
}
