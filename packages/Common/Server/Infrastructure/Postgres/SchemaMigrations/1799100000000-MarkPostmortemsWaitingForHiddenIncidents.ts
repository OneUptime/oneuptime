import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Data fix: a postmortem published while its incident is hidden from status
 * pages is sent when the incident is shown (IncidentPostmortemPublication
 * .isShownByUpdate). The send job skips such a postmortem with words that say
 * it waits for the incident, and the update that shows the incident queues
 * exactly that skip (isHiddenIncidentSkip).
 *
 * Before that, the job skipped it as "Incident is not visible on status
 * page. Skipping notifications to subscribers.", and nothing ever sent it
 * (found in #4429). Those rows are of two kinds, told apart by where the
 * incident is today:
 *
 * - still hidden: nobody was told, and the status page does not show the
 *   postmortem. They get the new words, so showing the incident sends it, as
 *   it does for a postmortem skipped from now on. (Nothing records whether
 *   such an incident was shown for a while in between and hidden again, so
 *   one that was is treated the same: showing it sends the postmortem, once.)
 * - shown since: the status page has shown the postmortem for a while
 *   without anyone being told. They keep the old words, so they are never
 *   recognised as waiting: hiding such an incident and showing it again does
 *   not email an old postmortem out of the blue.
 *
 * Only the message changes; the status stays Skipped, and nothing is sent by
 * this migration. "Hidden" is the incident's switch off - `IS NOT TRUE` also
 * covers a NULL, which the job reads as hidden - or the incident private,
 * which hides it from every status page.
 *
 * Both texts are written out rather than imported, so the migration keeps
 * doing what it did when it shipped. The new one matches
 * IncidentPostmortemPublication.hiddenIncidentMessage (a test pins the two
 * together).
 *
 * down() gives the waiting rows the old words back: the code before this
 * release never reads them.
 */
export const EARLIER_HIDDEN_INCIDENT_MESSAGE: string =
  "Incident is not visible on status page. Skipping notifications to subscribers.";

export const POSTMORTEM_WAITING_FOR_INCIDENT_MESSAGE: string =
  "Incident is hidden from status pages. Subscribers will be sent the postmortem when the incident is made visible on status pages.";

export class MarkPostmortemsWaitingForHiddenIncidents1799100000000
  implements MigrationInterface
{
  public name: string = "MarkPostmortemsWaitingForHiddenIncidents1799100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "Incident" SET "subscriberNotificationStatusMessageOnPostmortemPublished" = $1 WHERE "subscriberNotificationStatusOnPostmortemPublished" = 'Skipped' AND "subscriberNotificationStatusMessageOnPostmortemPublished" = $2 AND ("isVisibleOnStatusPage" IS NOT TRUE OR "isPrivate" IS TRUE)`,
      [
        POSTMORTEM_WAITING_FOR_INCIDENT_MESSAGE,
        EARLIER_HIDDEN_INCIDENT_MESSAGE,
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "Incident" SET "subscriberNotificationStatusMessageOnPostmortemPublished" = $1 WHERE "subscriberNotificationStatusOnPostmortemPublished" = 'Skipped' AND "subscriberNotificationStatusMessageOnPostmortemPublished" = $2`,
      [
        EARLIER_HIDDEN_INCIDENT_MESSAGE,
        POSTMORTEM_WAITING_FOR_INCIDENT_MESSAGE,
      ],
    );
  }
}
