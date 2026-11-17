import OwnerNotificationBacklog, {
  OwnerNotificationBacklogResult,
  OwnerNotificationMove,
  OwnerNotificationPage,
} from "./OwnerNotificationBacklog";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import Query from "Common/Server/Types/Database/Query";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Select from "Common/Server/Types/Database/Select";
import Sort from "Common/Server/Types/Database/Sort";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import PartialEntity from "Common/Types/Database/PartialEntity";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import { HEARD_ONLY_WHERE_WATCHED_KEY } from "Common/Types/Workflow/WatchedFields";

/*
 * HOW A REMINDER JOB GOES THROUGH THE REMINDERS DUE (issue #9019).
 *
 * An incident, an alert or a maintenance event a reminder rule matches
 * reminds its owners every interval while it is open: its next reminder is
 * nextReminderNotificationAt, and reminderNotificationSentCount counts the
 * ones sent. The three reminder jobs (IncidentOwners, AlertOwners,
 * ScheduledMaintenanceOwners: SendUnresolvedReminderNotification) read
 * every record with a reminder due at once, with no deadline, and moved each
 * one on with updateOneById: a read of the row, the write, a realtime event,
 * an audit entry and an On Update workflow trigger, for what is the job's
 * own bookkeeping. Both columns change at every reminder, so an On Update
 * workflow on incidents that watches no fields ran every time a reminder
 * went out.
 *
 * Now a run, for one such job (forEachDue):
 *
 *   - Reads what is due as of its start a page at a time, the longest due
 *     first (OwnerNotificationBacklog.forEachDue), and stops between records
 *     once its deadline passes - its time limit, or its lease lost: what it
 *     did not reach is still due, and the next run starts with it.
 *   - Moves each record on with one hook-free compare-and-set that expects
 *     both columns as it read them (DueReminder): the next reminder an
 *     interval on and the count one up when a reminder goes out (send), the
 *     next one later with none sent (putOffUntil), or none at all (stop).
 *     Of two runs at once, one moves a reminder and tells of it; the other
 *     finds it moved and tells nobody. A reminder whose schedule an edit of
 *     the record moved since the read - a new severity, its labels, a rule
 *     changed - is read again, and still goes out: it was due, and the run
 *     asked again just now whether it still is (the job's rule and state
 *     checks). One whose reminders were taken away since is not.
 *   - Whom each reminder tells is written down before the move, with the
 *     reminder's number as its occurrence (OwnerNotificationDeliveries.plan):
 *     a run stopped before the move leaves the reminder due, one stopped
 *     after leaves its owners to a later run (resume), and nobody is
 *     reminded twice.
 *
 * A reminder moved on still starts the record's On Update workflows that
 * watch one of the two columns - a workflow that escalates at the third
 * reminder - and only those (startWorkflowsWatching): an update people and
 * integrations make reaches every workflow, a reminder only the ones that
 * ask for it.
 */

// A record a reminder rule reminds its owners of: an incident, an alert, an event.
export type ReminderRecord = BaseModel & {
  projectId?: ObjectID | undefined;
  nextReminderNotificationAt?: Date | undefined;
  reminderNotificationSentCount?: number | undefined;
};

// What a record's reminder columns were read as, compared by a move.
interface ReminderColumns {
  nextReminderNotificationAt: Date | null;
  reminderNotificationSentCount: number | null;
}

function columnsOf(record: ReminderRecord): ReminderColumns {
  return {
    nextReminderNotificationAt: record.nextReminderNotificationAt || null,
    reminderNotificationSentCount:
      record.reminderNotificationSentCount === undefined ||
      record.reminderNotificationSentCount === null
        ? null
        : record.reminderNotificationSentCount,
  };
}

/*
 * One record whose reminder is due, as the run read it: what the job does
 * with it - send the reminder, put it off, or stop the reminders - each one
 * compare-and-set from what was read. Each answers true for the run whose
 * write moved the record on.
 */
export class DueReminder<TRecord extends ReminderRecord> {
  private readonly service: DatabaseService<TRecord>;
  private readonly record: TRecord;
  private readonly take: (
    move: OwnerNotificationMove<TRecord>,
  ) => Promise<boolean>;

  public constructor(data: {
    service: DatabaseService<TRecord>;
    record: TRecord;
    take: (move: OwnerNotificationMove<TRecord>) => Promise<boolean>;
  }) {
    this.service = data.service;
    this.record = data.record;
    this.take = data.take;
  }

  /*
   * The reminder's number: one more than the reminders sent. Whom it tells
   * is planned under it (OwnerNotificationDeliveries' occurrence).
   */
  public get number(): number {
    return (columnsOf(this.record).reminderNotificationSentCount || 0) + 1;
  }

  /*
   * The reminder goes out: the next one `intervalInMinutes` on, and counted.
   * Made before the owners are told, after whom it tells is written down. A
   * record whose schedule was moved since the run read it, with no reminder
   * sent - an edit refreshed it - is read again and moved from there: the
   * reminder was due, and is sent. False when another run sent this
   * reminder, the reminders stopped since, or the record is gone: this run
   * then tells nobody.
   */
  public async send(intervalInMinutes: number): Promise<boolean> {
    const moved: PartialEntity<TRecord> = {
      nextReminderNotificationAt: OneUptimeDate.addRemoveMinutes(
        OneUptimeDate.getCurrentDate(),
        intervalInMinutes,
      ),
      reminderNotificationSentCount: this.number,
    } as unknown as PartialEntity<TRecord>;

    const asRead: ReminderColumns = columnsOf(this.record);

    if (await this.moveFrom(asRead, moved)) {
      return true;
    }

    const now: TRecord | null = await this.service.findOneById({
      id: this.record.id!,
      select: {
        nextReminderNotificationAt: true,
        reminderNotificationSentCount: true,
      } as Select<TRecord>,
      props: {
        isRoot: true,
      },
    });

    if (!now) {
      return false;
    }

    const asNow: ReminderColumns = columnsOf(now);

    if (
      asNow.reminderNotificationSentCount !==
        asRead.reminderNotificationSentCount ||
      !asNow.nextReminderNotificationAt
    ) {
      // Sent by another run, or the reminders stopped since.
      return false;
    }

    return await this.moveFrom(asNow, moved);
  }

  // No reminder is sent now, and the next one is due at `at`.
  public async putOffUntil(at: Date): Promise<boolean> {
    return await this.moveFrom(columnsOf(this.record), {
      nextReminderNotificationAt: at,
    } as unknown as PartialEntity<TRecord>);
  }

  /*
   * The record is not to be reminded of any more - no rule matches it, its
   * reminders are off, it is over: its next reminder is taken away. An edit
   * that moved its schedule since the read stands.
   */
  public async stop(): Promise<boolean> {
    return await this.moveFrom(columnsOf(this.record), {
      nextReminderNotificationAt: null,
    } as unknown as PartialEntity<TRecord>);
  }

  private async moveFrom(
    expected: ReminderColumns,
    moved: PartialEntity<TRecord>,
  ): Promise<boolean> {
    const isMoved: boolean = await this.take({
      expected: expected as unknown as PartialEntity<TRecord>,
      moved: moved,
    });

    if (isMoved) {
      await OwnerReminderBacklog.startWorkflowsWatching({
        service: this.service,
        record: this.record,
        moved: moved,
      });
    }

    return isMoved;
  }
}

export default class OwnerReminderBacklog {
  /*
   * Goes through the records of `service` whose reminder is due as of now
   * (see the top of this file), a page at a time, the longest due first,
   * and hands each to `remind` with its DueReminder. `select` is what a
   * reminder is made of: the reminder columns, compared by the move, are
   * read with it.
   */
  public static async forEachDue<TRecord extends ReminderRecord>(data: {
    jobName: string;
    service: DatabaseService<TRecord>;
    select: Select<TRecord>;
    deadline?: JobDeadline | undefined;
    pageSize?: number | undefined;
    remind: (input: {
      record: TRecord;
      reminder: DueReminder<TRecord>;
      page: OwnerNotificationPage;
    }) => Promise<void>;
  }): Promise<OwnerNotificationBacklogResult> {
    // Due as of the run's start: a reminder this run moves on never is again.
    const now: Date = OneUptimeDate.getCurrentDate();

    return await OwnerNotificationBacklog.forEachDue<TRecord>({
      jobName: data.jobName,
      service: data.service,
      due: {
        nextReminderNotificationAt: QueryHelper.lessThan(now),
      } as Query<TRecord>,
      // The longest due first; ties broken by id (DatabaseService adds it).
      sort: {
        nextReminderNotificationAt: SortOrder.Ascending,
      } as Sort<TRecord>,
      select: {
        ...data.select,
        projectId: true,
        nextReminderNotificationAt: true,
        reminderNotificationSentCount: true,
      } as Select<TRecord>,
      deadline: data.deadline,
      pageSize: data.pageSize,
      notify: async (input: {
        record: TRecord;
        page: OwnerNotificationPage;
        take: (move: OwnerNotificationMove<TRecord>) => Promise<boolean>;
      }): Promise<void> => {
        await data.remind({
          record: input.record,
          page: input.page,
          reminder: new DueReminder<TRecord>({
            service: data.service,
            record: input.record,
            take: input.take,
          }),
        });
      },
    });
  }

  /*
   * Starts the record's On Update workflows that watch a column the move
   * changed - and only those (HEARD_ONLY_WHERE_WATCHED_KEY): what the
   * updateOneById a reminder was moved on with used to start for every one
   * of them, watching or not. Posted only when a workflow of the project
   * listens to the record's updates (DatabaseService.onTriggerWorkflow).
   * Never throws: the reminder was moved on, and its owners are told.
   */
  public static async startWorkflowsWatching<
    TRecord extends ReminderRecord,
  >(data: {
    service: DatabaseService<TRecord>;
    record: TRecord;
    moved: PartialEntity<TRecord>;
  }): Promise<void> {
    if (!data.record.id || !data.record.projectId) {
      return;
    }

    try {
      await data.service.onTriggerWorkflow(
        data.record.id,
        data.record.projectId,
        "on-update",
        {
          updatedFields: JSONFunctions.serialize(
            data.moved as unknown as JSONObject,
          ),
          [HEARD_ONLY_WHERE_WATCHED_KEY]: true,
        },
      );
    } catch (error) {
      logger.error(
        `Could not start the workflows that watch the reminders of ${data.record.id.toString()}: ${error}`,
        { projectId: data.record.projectId.toString() },
      );
    }
  }
}
