import ScheduledMaintenanceExternalCalendarEventService from "../../../Services/ScheduledMaintenanceExternalCalendarEventService";
import ScheduledMaintenanceExternalCalendarService from "../../../Services/ScheduledMaintenanceExternalCalendarService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import ExternalCalendarExpansion, {
  ExternalCalendarExpansionResult,
} from "./ExternalCalendarExpansion";
import ExternalCalendarFetch, {
  ExternalCalendarFetchResult,
} from "./ExternalCalendarFetch";
import ScheduledMaintenanceExternalCalendar from "../../../../Models/DatabaseModels/ScheduledMaintenanceExternalCalendar";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../Types/ObjectID";
import {
  ExternalCalendarReadError,
  getNextExternalCalendarReadAt,
} from "../../../../Types/ScheduledMaintenance/ExternalCalendar";
import crypto from "crypto";

/*
 * Reads the calendars drawn on the maintenance calendar, and keeps what
 * they hold (issue #5084).
 *
 * The Workers' job (RefreshExternalCalendars) runs every minute and reads
 * each enabled calendar whose next read is due, oldest first, batch after
 * batch until none is left or the run's time is up; Read now on Calendar
 * Settings reads one at once. Either way, a calendar is first
 * CLAIMED - its next read moved past the read, in one compare-and-set - so
 * of two readers that reach it together, one reads it.
 *
 * A read: the link is fetched through the egress guard
 * (ExternalCalendarFetch), worked out in a worker thread
 * (ExternalCalendarExpansion), and its events replace the old ones in one
 * transaction; then what happened is written on the calendar - when, how
 * many events, or why it failed - with the next read one refresh interval
 * on (at least an hour on after a failure). A failed read keeps the events
 * of the last good one, so a calendar that is down for an hour does not
 * empty the maintenance calendar meanwhile.
 *
 * A calendar whose text and window are the same as at its last read is not
 * worked out and written again: most calendars change rarely, and are read
 * often.
 */

// Calendars asked for at a time.
export const EXTERNAL_CALENDAR_READ_BATCH_SIZE: number = 20;

/*
 * How long one run of the job goes on reading due calendars, batch after
 * batch, before it leaves the rest to the next run a minute later. A read
 * takes well under a second, so a run gets through many batches when many
 * calendars are due at once - one batch a minute would have read at most
 * 1,200 calendars an hour, and a larger backlog would only have grown. The
 * read under way when the time is up is finished; reads are one at a time,
 * so a run's memory never grows with the backlog.
 */
export const EXTERNAL_CALENDAR_READ_RUN_BUDGET_IN_SECONDS: number = 45;

// How long a claim holds a calendar: past it, a reader that died lets another read it.
export const EXTERNAL_CALENDAR_READ_LEASE_IN_MINUTES: number = 5;

// Read now waits this long after the last read began.
export const EXTERNAL_CALENDAR_READ_NOW_COOLDOWN_IN_SECONDS: number = 30;

export const EXTERNAL_CALENDAR_READ_TOO_SOON_MESSAGE: string =
  "This calendar was read a moment ago. Try again in a few seconds.";

export const EXTERNAL_CALENDAR_TURNED_OFF_MESSAGE: string =
  "This calendar is turned off. Turn it on to read it.";

// What a read that worked writes on its calendar.
interface ExternalCalendarSuccessColumns {
  lastReadAt: Date;
  lastReadAttemptAt: Date;
  lastReadError: string;
  lastReadHttpStatus: number;
  nextReadAt: Date;
}

export interface ExternalCalendarReadOutcome {
  read: boolean;
  error: ExternalCalendarReadError | null;
  eventCount: number | null;
}

// The steps a read takes, replaced in tests.
export interface ExternalCalendarRefresherSteps {
  fetch: (link: string) => Promise<ExternalCalendarFetchResult>;
  expand: (text: string, now: Date) => Promise<ExternalCalendarExpansionResult>;
}

export const DEFAULT_EXTERNAL_CALENDAR_REFRESHER_STEPS: ExternalCalendarRefresherSteps =
  {
    fetch: (link: string): Promise<ExternalCalendarFetchResult> => {
      return ExternalCalendarFetch.fetch(link);
    },
    expand: (
      text: string,
      now: Date,
    ): Promise<ExternalCalendarExpansionResult> => {
      return ExternalCalendarExpansion.expand(text, { now: now });
    },
  };

export default class ExternalCalendarRefresher {
  public static steps: ExternalCalendarRefresherSteps =
    DEFAULT_EXTERNAL_CALENDAR_REFRESHER_STEPS;

  // What a read worked out from: the calendar's text, and the window's first day.
  public static getContentDigest(text: string, now: Date): string {
    return crypto
      .createHash("sha256")
      .update(text)
      .update("\n")
      .update(ExternalCalendarExpansion.getWindow(now).start.toISOString())
      .digest("hex");
  }

  /*
   * Reads the calendars that are due, batch after batch, until none is left
   * or the run's time (EXTERNAL_CALENDAR_READ_RUN_BUDGET_IN_SECONDS) is up.
   * Returns how many were read.
   */
  @CaptureSpan()
  public static async readDueCalendars(): Promise<number> {
    const startedAt: number = OneUptimeDate.getCurrentDate().getTime();
    const budgetInMs: number =
      EXTERNAL_CALENDAR_READ_RUN_BUDGET_IN_SECONDS * 1000;

    /*
     * Each calendar is tried once a run: one whose claim another reader won,
     * or that stays due for any other reason, is not tried again and again.
     */
    const tried: Set<string> = new Set<string>();
    let readCount: number = 0;

    for (;;) {
      const due: Array<ScheduledMaintenanceExternalCalendar> =
        await ScheduledMaintenanceExternalCalendarService.findBy({
          query: {
            isEnabled: true,
            nextReadAt: QueryHelper.lessThanEqualToOrNull(
              OneUptimeDate.getCurrentDate(),
            ),
          },
          select: {
            _id: true,
            nextReadAt: true,
          },
          sort: {
            nextReadAt: SortOrder.Ascending,
          },
          skip: 0,
          limit: EXTERNAL_CALENDAR_READ_BATCH_SIZE,
          props: {
            isRoot: true,
          },
        });

      const untried: Array<ScheduledMaintenanceExternalCalendar> = due.filter(
        (calendar: ScheduledMaintenanceExternalCalendar): boolean => {
          return Boolean(calendar.id) && !tried.has(calendar.id!.toString());
        },
      );

      for (const calendar of untried) {
        if (
          OneUptimeDate.getCurrentDate().getTime() - startedAt >=
          budgetInMs
        ) {
          // The rest are read by the next run.
          return readCount;
        }

        tried.add(calendar.id!.toString());

        const isClaimed: boolean = await this.claim({
          id: calendar.id!,
          expectedNextReadAt: calendar.nextReadAt || null,
          now: OneUptimeDate.getCurrentDate(),
        });

        if (!isClaimed) {
          continue;
        }

        try {
          await this.readCalendar(calendar.id!);
          readCount++;
        } catch (error) {
          // One calendar that fails to be read never stops the rest.
          logger.error(error);
        }
      }

      /*
       * A batch shorter than a whole one held the last calendars due, and
       * one with nothing new in it holds only calendars this run tried.
       */
      if (
        due.length < EXTERNAL_CALENDAR_READ_BATCH_SIZE ||
        untried.length === 0
      ) {
        return readCount;
      }
    }
  }

  /*
   * Read now: reads one calendar at once, for someone who may update it
   * (the API checks that first). Refused while the calendar is off, and
   * within EXTERNAL_CALENDAR_READ_NOW_COOLDOWN_IN_SECONDS of the last read
   * beginning - a link is not to be fetched over and over on a click.
   */
  @CaptureSpan()
  public static async readNow(
    id: ObjectID,
  ): Promise<ExternalCalendarReadOutcome> {
    const now: Date = OneUptimeDate.getCurrentDate();

    const calendar: ScheduledMaintenanceExternalCalendar | null =
      await ScheduledMaintenanceExternalCalendarService.findOneById({
        id: id,
        select: {
          _id: true,
          isEnabled: true,
          nextReadAt: true,
          lastReadAttemptAt: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!calendar) {
      throw new NotFoundException("Calendar not found.");
    }

    if (calendar.isEnabled === false) {
      throw new BadDataException(EXTERNAL_CALENDAR_TURNED_OFF_MESSAGE);
    }

    if (
      calendar.lastReadAttemptAt &&
      now.getTime() -
        OneUptimeDate.fromString(calendar.lastReadAttemptAt).getTime() <
        EXTERNAL_CALENDAR_READ_NOW_COOLDOWN_IN_SECONDS * 1000
    ) {
      throw new BadDataException(EXTERNAL_CALENDAR_READ_TOO_SOON_MESSAGE);
    }

    const isClaimed: boolean = await this.claim({
      id: id,
      expectedNextReadAt: calendar.nextReadAt || null,
      now: now,
    });

    if (!isClaimed) {
      throw new BadDataException(EXTERNAL_CALENDAR_READ_TOO_SOON_MESSAGE);
    }

    return await this.readCalendar(id);
  }

  /*
   * Claims a calendar: its next read moves to the end of a lease, and its
   * read attempt is now - if nobody moved it since `expectedNextReadAt`.
   */
  private static async claim(data: {
    id: ObjectID;
    expectedNextReadAt: Date | null;
    now: Date;
  }): Promise<boolean> {
    const claimed: boolean =
      await ScheduledMaintenanceExternalCalendarService.claimForRead({
        id: data.id,
        expectedNextReadAt: data.expectedNextReadAt,
        leaseUntil: OneUptimeDate.addRemoveMinutes(
          data.now,
          EXTERNAL_CALENDAR_READ_LEASE_IN_MINUTES,
        ),
      });

    if (claimed) {
      await ScheduledMaintenanceExternalCalendarService.updateColumnsByIdWithoutHooks(
        {
          id: data.id,
          data: {
            lastReadAttemptAt: data.now,
          },
          skipUpdateDateColumn: true,
        },
      );
    }

    return claimed;
  }

  // Reads one claimed calendar and writes what happened.
  @CaptureSpan()
  public static async readCalendar(
    id: ObjectID,
  ): Promise<ExternalCalendarReadOutcome> {
    const calendar: ScheduledMaintenanceExternalCalendar | null =
      await ScheduledMaintenanceExternalCalendarService.findOneById({
        id: id,
        select: {
          _id: true,
          projectId: true,
          calendarUrl: true,
          refreshIntervalInMinutes: true,
          contentDigest: true,
          eventCount: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!calendar || !calendar.projectId || !calendar.calendarUrl) {
      return { read: false, error: null, eventCount: null };
    }

    const link: string = calendar.calendarUrl;
    const fetched: ExternalCalendarFetchResult = await this.steps.fetch(link);
    const now: Date = OneUptimeDate.getCurrentDate();

    if (!fetched.ok) {
      await this.writeFailure({
        calendar: calendar,
        now: now,
        error: fetched.error,
        httpStatus: fetched.httpStatus,
      });

      return { read: true, error: fetched.error, eventCount: null };
    }

    const digest: string = this.getContentDigest(fetched.body, now);

    if (digest === calendar.contentDigest) {
      // Nothing changed since the last read: it worked, and holds what it held.
      await ScheduledMaintenanceExternalCalendarService.updateColumnsByIdWithoutHooks(
        {
          id: id,
          data: this.getSuccessColumns({
            calendar: calendar,
            now: now,
          }),
        },
      );

      return {
        read: true,
        error: null,
        eventCount: calendar.eventCount ?? null,
      };
    }

    const expanded: ExternalCalendarExpansionResult = await this.steps.expand(
      fetched.body,
      now,
    );

    if (!expanded.ok) {
      await this.writeFailure({
        calendar: calendar,
        now: now,
        error: expanded.error,
        httpStatus: null,
      });

      return { read: true, error: expanded.error, eventCount: null };
    }

    /*
     * The link may have been replaced while it was read: what it held is
     * then not the calendar's any more, and the next read reads the new one.
     */
    const current: ScheduledMaintenanceExternalCalendar | null =
      await ScheduledMaintenanceExternalCalendarService.findOneById({
        id: id,
        select: {
          _id: true,
          calendarUrl: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!current || current.calendarUrl !== link) {
      return { read: false, error: null, eventCount: null };
    }

    await ScheduledMaintenanceExternalCalendarEventService.replaceEventsOfCalendar(
      {
        projectId: calendar.projectId,
        calendarId: id,
        events: expanded.events,
      },
    );

    await ScheduledMaintenanceExternalCalendarService.updateColumnsByIdWithoutHooks(
      {
        id: id,
        data: {
          ...this.getSuccessColumns({ calendar: calendar, now: now }),
          eventCount: expanded.events.length,
          hasMoreEvents: expanded.hasMoreEvents,
          contentDigest: digest,
        },
      },
    );

    return { read: true, error: null, eventCount: expanded.events.length };
  }

  private static getSuccessColumns(data: {
    calendar: ScheduledMaintenanceExternalCalendar;
    now: Date;
  }): ExternalCalendarSuccessColumns {
    return {
      lastReadAt: data.now,
      lastReadAttemptAt: data.now,
      lastReadError: null as unknown as string,
      lastReadHttpStatus: null as unknown as number,
      nextReadAt: getNextExternalCalendarReadAt({
        readAt: data.now,
        refreshIntervalInMinutes: data.calendar.refreshIntervalInMinutes,
        failed: false,
      }),
    };
  }

  private static async writeFailure(data: {
    calendar: ScheduledMaintenanceExternalCalendar;
    now: Date;
    error: ExternalCalendarReadError;
    httpStatus: number | null;
  }): Promise<void> {
    await ScheduledMaintenanceExternalCalendarService.updateColumnsByIdWithoutHooks(
      {
        id: data.calendar.id!,
        data: {
          lastReadAttemptAt: data.now,
          lastReadError: data.error,
          lastReadHttpStatus: data.httpStatus as number,
          nextReadAt: getNextExternalCalendarReadAt({
            readAt: data.now,
            refreshIntervalInMinutes: data.calendar.refreshIntervalInMinutes,
            failed: true,
          }),
        },
      },
    );
  }
}
