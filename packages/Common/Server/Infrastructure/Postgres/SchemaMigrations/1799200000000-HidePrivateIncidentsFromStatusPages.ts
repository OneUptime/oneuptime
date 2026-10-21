import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Data fix: a private incident or incident episode is never shown on a
 * status page (StatusPageVisibility), and every write now keeps it so -
 * making a record private switches its Visible on Status Page off, and
 * turning the switch on leaves a private record hidden.
 *
 * Before that, a write of Visible on Status Page alone could leave a private
 * record with the switch on. Every status page read and subscriber job now
 * leaves such a record out by the rule itself; this switches the stored
 * visibility off too, so the record reads as hidden everywhere - on its
 * Settings page, to the API and to Terraform - and turning Private off
 * later does not put it on the status pages by surprise: showing it takes
 * turning Visible on Status Page on, as for any hidden record.
 *
 * Only the switch changes, and only on rows that are private with it on.
 * Nothing is queued or sent: the subscriber jobs read the status of each
 * notification, which this leaves as it is. (The images such a record made
 * public are made private again by the HideImagesOfPrivateIncidents data
 * migration.)
 *
 * down() changes nothing: which rows had the switch on is not kept, and
 * switching it back on would show private records again.
 */
export class HidePrivateIncidentsFromStatusPages1799200000000
  implements MigrationInterface
{
  public name: string = "HidePrivateIncidentsFromStatusPages1799200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "Incident" SET "isVisibleOnStatusPage" = false WHERE "isPrivate" IS TRUE AND "isVisibleOnStatusPage" IS TRUE`,
    );
    await queryRunner.query(
      `UPDATE "IncidentEpisode" SET "isVisibleOnStatusPage" = false WHERE "isPrivate" IS TRUE AND "isVisibleOnStatusPage" IS TRUE`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    return;
  }
}
