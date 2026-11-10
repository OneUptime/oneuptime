import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * How an on-call phone call ended - answered, not answered, busy or failed
 * - reaches OneUptime through Twilio's call status callback, as an SMS's
 * delivery does (AddDeliveryTrackingToSmsLog): each call log gets the
 * secret token its callback URL carries, and the on-call notification it
 * was made for, so the outcome can be written back onto that notification
 * and told in the record's feed.
 *
 * The two columns only, nullable with no default, so no row is rewritten.
 * The index and foreign key generated with them are built online, in
 * AddCallOutcomeTrackingToCallLogIndexAndKey1809090010000: "CallLog"
 * already holds every call a project made, and every call that goes out
 * writes to it. (This migration built both itself at first; a database
 * that ran it then has them already, and the online one leaves them be.)
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP COLUMN "userOnCallLogTimelineId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CallLog" DROP COLUMN "statusCallbackToken"`,
    );
  }
}
