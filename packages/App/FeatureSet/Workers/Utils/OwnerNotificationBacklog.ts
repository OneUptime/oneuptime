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
import ObjectID from "Common/Types/ObjectID";

/*
 * HOW AN OWNER NOTIFICATION JOB GOES THROUGH WHAT IT HAS STILL TO TELL
 * (issue #7974).
 *
 * The state change jobs - a monitor's status, an incident's, an alert's,
 * an episode's or a maintenance event's state - read every record not yet
 * marked notified, all of it, every run, newest first and with the monitor's
 * whole steps joined to each status change. Then, one record at a time,
 * they looked up its owners, marked it notified through updateOneById and
 * its every hook - for a state change a refresh of the record's metrics and
 * a recompute of its measurements (which the change's own create had run),
 * a workflow trigger posted to the app, whose handler reads the project's
 * workflows - and told the owners. A monitor flapping through thousands of
 * status changes paid all of it thousands of times a minute.
 *
 * Now a run, for one such job:
 *
 *   - Reads a page at a time, oldest first, of what is not marked yet: what
 *     this run took drops out of the next page by its mark, and what it read
 *     and could not take - its job failed before the take - is left out by
 *     id, so no page reads a record twice in one run. Told in the order they
 *     happened, too: a monitor that went down and came back is told so in
 *     that order.
 *   - Takes each record - marks it notified - with one hook-free statement
 *     that moves the mark only if it was not moved yet (a compare-and-set):
 *     after the job wrote whom it is about to tell
 *     (OwnerNotificationDeliveries.plan), before it tells them. The run whose
 *     write moved the mark tells the owners; a run that finds it moved - one
 *     going on beside this one, its lease lost - tells nobody, and its plan
 *     wrote nothing new (a plan is written once per owner, however often).
 *     So two runs at once take each record once, and each owner is told
 *     once: the delivery rows already made that true of every owner, and the
 *     take now makes it true of the whole record, feed item included.
 *   - Stops between records once its deadline passes - its time limit, or
 *     its lease lost (RunCron, CronLock): what it did not reach is still not
 *     marked, and the next run starts with it. A record it took and stopped
 *     telling part way is told by a later run, exactly those owners
 *     (OwnerNotificationDeliveries.resume).
 *
 * What a job reads for each record - its owners, the project's owners, the
 * record a state change is of, a state - it reads through the page
 * (OwnerNotificationPage.once): a monitor with fifty status changes on a
 * page has its owners looked up once, not fifty times. And readPage reads
 * what every record of the page needs in one query, before them.
 */

export const OWNER_NOTIFICATION_PAGE_SIZE: number = 100;

/*
 * How many records one run may read and fail to take before it stops: each
 * is left out of the pages after it by id. A run that fails this often is
 * failing on every record (the database is down); the next run tries again.
 */
export const OWNER_NOTIFICATION_LEFT_OUT_AT_MOST: number = 1000;

enum TakeOutcome {
  // This run marked it: its owners are this run's to tell.
  Taken = "Taken",
  // Marked first by another run, or gone.
  TakenElsewhere = "TakenElsewhere",
  // Not marked: its job failed before the take, or the take itself did.
  NotTaken = "NotTaken",
}

export interface OwnerNotificationBacklogResult {
  pages: number;
  // Records read.
  read: number;
  // Records this run took: their owners were this run's to tell.
  taken: number;
  // Records another run took first (it tells their owners), or that are gone.
  takenElsewhere: number;
  // Records whose job threw: logged, and left for the next run if not taken.
  failed: number;
  // Whether the run's deadline stopped it before it read everything.
  stoppedAtDeadline: boolean;
}

/*
 * The reads a job makes for the records of one page, each made once: the
 * first record to ask reads, every other is handed the same answer. A read
 * that fails is not kept - the next record to ask reads again.
 */
export class OwnerNotificationPage {
  private readonly reads: Map<string, Promise<unknown>> = new Map<
    string,
    Promise<unknown>
  >();

  public once<T>(key: string, read: () => Promise<T>): Promise<T> {
    const known: Promise<unknown> | undefined = this.reads.get(key);

    if (known) {
      return known as Promise<T>;
    }

    const reading: Promise<T> = read();

    this.reads.set(key, reading);

    reading.catch((): void => {
      if (this.reads.get(key) === reading) {
        this.reads.delete(key);
      }
    });

    return reading;
  }

  // Hands every record that asks for `key` this answer, read already.
  public prime<T>(key: string, value: T): void {
    this.reads.set(key, Promise.resolve(value));
  }

  public has(key: string): boolean {
    return this.reads.has(key);
  }
}

export default class OwnerNotificationBacklog {
  /*
   * Goes through the records of `service` still `notYetNotified`, a page at
   * a time, oldest first (see the top of this file). For each, `notify` is
   * handed the record, its page and `take`: the job plans whom it tells,
   * calls take() - which writes `notified` over `notYetNotified`, one run
   * alone - and tells them only when it answers true. Never throws for one
   * record: a record whose job throws is logged and, if it was not taken,
   * left for the next run.
   */
  public static async forEachToNotify<TRecord extends BaseModel>(data: {
    jobName: string;
    service: DatabaseService<TRecord>;
    // The mark of a record still to notify: { isOwnerNotified: false }.
    notYetNotified: PartialEntity<TRecord>;
    // The mark a run takes it with: { isOwnerNotified: true }.
    notified: PartialEntity<TRecord>;
    select: Select<TRecord>;
    deadline?: JobDeadline | undefined;
    pageSize?: number | undefined;
    // Reads what every record of the page needs, once, before them.
    readPage?:
      | ((
          records: Array<TRecord>,
          page: OwnerNotificationPage,
        ) => Promise<void>)
      | undefined;
    notify: (input: {
      record: TRecord;
      page: OwnerNotificationPage;
      take: () => Promise<boolean>;
    }) => Promise<void>;
  }): Promise<OwnerNotificationBacklogResult> {
    const pageSize: number = data.pageSize || OWNER_NOTIFICATION_PAGE_SIZE;

    const result: OwnerNotificationBacklogResult = {
      pages: 0,
      read: 0,
      taken: 0,
      takenElsewhere: 0,
      failed: 0,
      stoppedAtDeadline: false,
    };

    // Read by this run and not taken: left out of every page after.
    const leftOut: Array<ObjectID> = [];

    pages: for (;;) {
      if (data.deadline?.hasPassed()) {
        result.stoppedAtDeadline = true;
        break;
      }

      if (leftOut.length >= OWNER_NOTIFICATION_LEFT_OUT_AT_MOST) {
        logger.error(
          `${data.jobName}: ${leftOut.length} records could not be taken this run; stopping. The next run tries them again.`,
        );
        break;
      }

      const records: Array<TRecord> = await data.service.findBy({
        query: {
          ...data.notYetNotified,
          ...(leftOut.length > 0 ? { _id: QueryHelper.notIn(leftOut) } : {}),
        } as Query<TRecord>,
        select: {
          ...data.select,
          _id: true,
        } as Select<TRecord>,
        // Oldest first; ties broken by id (DatabaseService adds it).
        sort: {
          createdAt: SortOrder.Ascending,
        } as Sort<TRecord>,
        limit: pageSize,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      if (records.length === 0) {
        break;
      }

      result.pages++;
      result.read += records.length;

      const page: OwnerNotificationPage = new OwnerNotificationPage();

      if (data.readPage) {
        try {
          await data.readPage(records, page);
        } catch (error) {
          // Each record reads what it needs on its own instead.
          logger.error(
            `${data.jobName}: could not read a page's records together; reading them one by one.`,
          );
          logger.error(error);
        }
      }

      for (const record of records) {
        if (data.deadline?.hasPassed()) {
          result.stoppedAtDeadline = true;
          break pages;
        }

        const id: ObjectID | null = record.id;

        if (!id) {
          continue;
        }

        // The take, once the job asks for it: made at most once per record.
        const taking: { take: Promise<boolean> | null } = { take: null };

        const take: () => Promise<boolean> = (): Promise<boolean> => {
          if (!taking.take) {
            taking.take = OwnerNotificationBacklog.take({
              service: data.service,
              id: id,
              notYetNotified: data.notYetNotified,
              notified: data.notified,
            });
          }

          return taking.take;
        };

        try {
          await data.notify({ record: record, page: page, take: take });
        } catch (error) {
          result.failed++;
          logger.error(
            `${data.jobName}: notifying the owners of ${id.toString()} failed.`,
          );
          logger.error(error);
        }

        const outcome: TakeOutcome = await OwnerNotificationBacklog.outcomeOf(
          taking.take,
        );

        if (outcome === TakeOutcome.Taken) {
          result.taken++;
        } else if (outcome === TakeOutcome.TakenElsewhere) {
          result.takenElsewhere++;
        } else {
          // Never taken - its job failed before, or the take did: not again this run.
          leftOut.push(id);
        }
      }

      if (records.length < pageSize) {
        break;
      }
    }

    if (result.read > 0) {
      logger.debug(
        `${data.jobName}: read ${result.read} record(s) in ${result.pages} page(s); took ${result.taken}, ${result.takenElsewhere} taken by another run or gone, ${result.failed} failed${result.stoppedAtDeadline ? "; stopped at the job's deadline, the rest are the next run's" : ""}.`,
      );
    }

    return result;
  }

  // What became of a record's take, once its job is done with it.
  private static async outcomeOf(
    taking: Promise<boolean> | null,
  ): Promise<TakeOutcome> {
    if (!taking) {
      return TakeOutcome.NotTaken;
    }

    try {
      return (await taking) ? TakeOutcome.Taken : TakeOutcome.TakenElsewhere;
    } catch {
      // The job awaited it, so its failure is logged with the job's.
      return TakeOutcome.NotTaken;
    }
  }

  /*
   * Marks one record notified - true for the run whose write did, false for
   * every other (another run marked it first, or it is gone). One hook-free
   * statement: the mark is OneUptime's own bookkeeping, and the hooks of a
   * state change's update recompute its record's metrics and measurements,
   * post a workflow trigger and a realtime event, none of which the mark
   * changes anything for.
   */
  public static async take<TRecord extends BaseModel>(data: {
    service: DatabaseService<TRecord>;
    id: ObjectID;
    notYetNotified: PartialEntity<TRecord>;
    notified: PartialEntity<TRecord>;
  }): Promise<boolean> {
    return await data.service.compareAndSetColumnsByIdWithoutHooks({
      id: data.id,
      data: data.notified,
      expectedData: data.notYetNotified,
    });
  }
}
