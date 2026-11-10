import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * How an on-call phone call ended - answered, not answered, busy or failed
 * - reaches OneUptime through Twilio's call status callback, as an SMS's
 * delivery does (AddDeliveryTrackingToSmsLog): each call log gets the
 * secret token its callback URL carries, and the on-call notification it
 * was made for, so the outcome can be written back onto that notification
 * and told in the record's feed. Index and foreign key names are TypeORM's
 * own, so the schema drift check finds nothing to change.
 */
export class AddCallOutcomeTrackingToCallLog1809090000000
  implements MigrationInterface
{
  public name: string = "AddCallOutcomeTrackingToCallLog1809090000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD "statusCallbackToken" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD "userOnCallLogTimelineId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_30706ded4048de3ce84e66b536" ON "CallLog" ("userOnCallLogTimelineId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" ADD CONSTRAINT "FK_30706ded4048de3ce84e66b5369" FOREIGN KEY ("userOnCallLogTimelineId") REFERENCES "UserOnCallLogTimeline"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP CONSTRAINT "FK_30706ded4048de3ce84e66b5369"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_30706ded4048de3ce84e66b536"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP COLUMN "userOnCallLogTimelineId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP COLUMN "statusCallbackToken"`,
    );
  }
}
