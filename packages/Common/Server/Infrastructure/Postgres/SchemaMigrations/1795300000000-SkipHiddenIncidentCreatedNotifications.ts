import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Data fix: settle the 'incident created' subscriber notification of hidden
 * incidents that the worker left InProgress.
 *
 * Incident:SendNotificationToSubscribers used to mark an incident's 'created'
 * notification InProgress and then, when the incident was not visible on
 * status pages, move on without settling it. The job only ever picks up
 * Pending rows, so those rows stayed InProgress forever: the dashboard showed
 * "Notifications Being Sent" for good, and nothing could ever send them once
 * the incident was published. The worker now marks them Skipped with a
 * reason, and publishing such an incident can re-queue the notification (see
 * IncidentCreatedRenotify) - but only from Skipped. This moves the rows the old
 * worker stranded to the same Skipped state and reason, so they get that
 * option too.
 *
 * Only hidden incidents are touched. `IS NOT TRUE` also covers a NULL
 * visibility, which the worker treated as hidden. A visible incident that is
 * InProgress may really be sending right now, and is left alone.
 *
 * The message is written out rather than imported so the migration keeps
 * doing what it did when it shipped. It matches
 * IncidentCreatedRenotify.hiddenFromStatusPagesMessage, which is what the
 * worker writes, so migrated rows read exactly like newly skipped ones (a
 * test pins the two together).
 *
 * down() restores nothing: putting rows back into a state that nothing ever
 * leaves would only break them again.
 */
export const HIDDEN_FROM_STATUS_PAGES_MESSAGE: string =
  "Incident is not visible on status pages. Skipping notifications to subscribers.";

export class SkipHiddenIncidentCreatedNotifications1795300000000
  implements MigrationInterface
{
  public name: string = "SkipHiddenIncidentCreatedNotifications1795300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "Incident" SET "subscriberNotificationStatusOnIncidentCreated" = 'Skipped', "subscriberNotificationStatusMessage" = $1 WHERE "subscriberNotificationStatusOnIncidentCreated" = 'InProgress' AND "isVisibleOnStatusPage" IS NOT TRUE`,
      [HIDDEN_FROM_STATUS_PAGES_MESSAGE],
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Nothing to restore; see the note above.
  }
}
