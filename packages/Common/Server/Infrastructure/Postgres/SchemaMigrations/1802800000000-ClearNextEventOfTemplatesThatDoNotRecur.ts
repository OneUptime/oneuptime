import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Data fix: a scheduled maintenance template with Recurring Event off has no
 * next event.
 *
 * Turning Recurring Event off on a template left the time its next event was
 * due ("scheduleNextEventAt") where it was, so the templates list went on
 * saying "Next event will be scheduled at ..." for a template that would
 * create no more events: the job that creates them (ScheduleRecurringEvents)
 * reads only templates whose switch is on. ScheduledMaintenanceTemplate-
 * Service now clears that time whenever an update leaves a template not
 * recurring, and keeps a time off a template created without the switch.
 * This clears it on the templates already stored that way, so the API and
 * Terraform read no next time for them either; the Dashboard shows a next
 * event only for a template whose switch is on in any case.
 *
 * Nothing else changes: the first event's times and the interval stay, so a
 * template turned back on is given its next time again, the schedule's next
 * time after now. A template whose switch is on is not touched. Written out
 * rather than generated (nothing in the schema changes), and run with the
 * schema migrations so the rows are right before any server reads them.
 * Running it twice changes nothing. down() restores nothing: no code reads
 * the time of a template that does not recur, the old code included.
 */
export const CLEAR_NEXT_EVENT_OF_TEMPLATES_THAT_DO_NOT_RECUR: string = `UPDATE "ScheduledMaintenanceTemplate" SET "scheduleNextEventAt" = NULL WHERE "isRecurringEvent" = false AND "scheduleNextEventAt" IS NOT NULL`;

export class ClearNextEventOfTemplatesThatDoNotRecur1802800000000
  implements MigrationInterface
{
  public name: string = "ClearNextEventOfTemplatesThatDoNotRecur1802800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(CLEAR_NEXT_EVENT_OF_TEMPLATES_THAT_DO_NOT_RECUR);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Nothing to restore; see the note above.
  }
}
