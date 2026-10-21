import DatabaseService from "./DatabaseService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Model from "../../Models/DatabaseModels/ScheduledMaintenanceExternalCalendarEvent";
import ObjectID from "../../Types/ObjectID";
import { EXTERNAL_CALENDAR_MAX_TITLE_LENGTH } from "../../Types/ScheduledMaintenance/ExternalCalendar";
import { EntityManager } from "typeorm";

/*
 * The events of the calendars drawn on the maintenance calendar, as their
 * last read left them (ScheduledMaintenanceExternalCalendarEvent).
 *
 * Nobody creates, edits or deletes one through the API (every write list is
 * empty): a read of a calendar replaces all of its events at once, in one
 * transaction, so the calendar never shows half of an old read and half of
 * a new one. Up to 2,000 rows a calendar, written in a few multi-row INSERTs
 * rather than one CRUD create each.
 */

export interface ExternalCalendarEventRow {
  title: string;
  startsAt: Date;
  endsAt: Date;
  isAllDay: boolean;
}

// Rows per INSERT.
export const EXTERNAL_CALENDAR_EVENT_INSERT_CHUNK_SIZE: number = 500;

export const DELETE_EVENTS_OF_CALENDAR_SQL: string = `DELETE FROM "ScheduledMaintenanceExternalCalendarEvent" WHERE "scheduledMaintenanceExternalCalendarId" = $1`;

export const INSERT_EVENTS_SQL: string = `INSERT INTO "ScheduledMaintenanceExternalCalendarEvent" ("projectId", "scheduledMaintenanceExternalCalendarId", "title", "startsAt", "endsAt", "isAllDay", "version") SELECT $1::uuid, $2::uuid, "event"."title", "event"."startsAt", "event"."endsAt", "event"."isAllDay", 1 FROM unnest($3::text[], $4::timestamptz[], $5::timestamptz[], $6::boolean[]) AS "event"("title", "startsAt", "endsAt", "isAllDay")`;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Replaces every event of a calendar with `events`, in one transaction.
   * Titles are cut to their column's length here as well, so one title too
   * long never takes the rows written with it down.
   */
  @CaptureSpan()
  public async replaceEventsOfCalendar(data: {
    projectId: ObjectID;
    calendarId: ObjectID;
    events: Array<ExternalCalendarEventRow>;
  }): Promise<void> {
    await this.executeTransaction(
      async (manager: EntityManager): Promise<void> => {
        await manager.query(DELETE_EVENTS_OF_CALENDAR_SQL, [
          data.calendarId.toString(),
        ]);

        for (
          let start: number = 0;
          start < data.events.length;
          start += EXTERNAL_CALENDAR_EVENT_INSERT_CHUNK_SIZE
        ) {
          const chunk: Array<ExternalCalendarEventRow> = data.events.slice(
            start,
            start + EXTERNAL_CALENDAR_EVENT_INSERT_CHUNK_SIZE,
          );

          await manager.query(INSERT_EVENTS_SQL, [
            data.projectId.toString(),
            data.calendarId.toString(),
            chunk.map((event: ExternalCalendarEventRow): string => {
              return event.title.slice(0, EXTERNAL_CALENDAR_MAX_TITLE_LENGTH);
            }),
            chunk.map((event: ExternalCalendarEventRow): Date => {
              return event.startsAt;
            }),
            chunk.map((event: ExternalCalendarEventRow): Date => {
              return event.endsAt;
            }),
            chunk.map((event: ExternalCalendarEventRow): boolean => {
              return event.isAllDay;
            }),
          ]);
        }
      },
    );
  }

  // Forgets every event of a calendar: its link was replaced.
  @CaptureSpan()
  public async deleteEventsOfCalendar(calendarId: ObjectID): Promise<void> {
    await this.getRepository().manager.query(DELETE_EVENTS_OF_CALENDAR_SQL, [
      calendarId.toString(),
    ]);
  }
}

export default new Service();
