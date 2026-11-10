import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A WhatsApp message's log keeps the on-call notification it was sent for,
 * as an SMS's and a call's logs do (AddDeliveryTrackingToSmsLog,
 * AddCallOutcomeTrackingToCallLog): Meta's status webhook reads it to tell
 * the platform's delivery metrics, as the send's own metric did, that the
 * message was an on-call page (notification.delivery.count, issue #6648).
 *
 * The column only, nullable with no default, so no row is rewritten. The
 * index and foreign key generated with it are built online, in
 * AddOnCallTimelineToWhatsAppLogIndexAndKey1809100612210: "WhatsAppLog"
 * already holds every WhatsApp message a project sent, and every message
 * that goes out writes to it.
 */
export class AddOnCallTimelineToWhatsAppLog1809100612200
  implements MigrationInterface
{
  public name: string = "AddOnCallTimelineToWhatsAppLog1809100612200";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WhatsAppLog" ADD "userOnCallLogTimelineId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WhatsAppLog" DROP COLUMN "userOnCallLogTimelineId"`,
    );
  }
}
