import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDeliveryTrackingToSmsLog1780317745887
  implements MigrationInterface
{
  public name: string = "AddDeliveryTrackingToSmsLog1780317745887";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD "errorCode" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD "statusCallbackToken" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD "userOnCallLogTimelineId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_SmsLog_userOnCallLogTimelineId" ON "SmsLog" ("userOnCallLogTimelineId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" ADD CONSTRAINT "FK_SmsLog_userOnCallLogTimelineId" FOREIGN KEY ("userOnCallLogTimelineId") REFERENCES "UserOnCallLogTimeline"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SmsLog" DROP CONSTRAINT "FK_SmsLog_userOnCallLogTimelineId"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_SmsLog_userOnCallLogTimelineId"`);
    await queryRunner.query(
      `ALTER TABLE "SmsLog" DROP COLUMN "userOnCallLogTimelineId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SmsLog" DROP COLUMN "statusCallbackToken"`,
    );
    await queryRunner.query(`ALTER TABLE "SmsLog" DROP COLUMN "errorCode"`);
  }
}
