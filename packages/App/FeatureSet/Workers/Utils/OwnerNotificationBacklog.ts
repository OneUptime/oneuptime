import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import Query from "Common/Server/Types/Database/Query";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Select from "Common/Server/Types/Database/Select";
import Sort from "Common/Server/Types/Database/Sort";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
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
 *
 * Every owner notification job goes through it (issue #8862): the state
 * changes, the records created, the notes posted, the owners added and the
 * members added. Two kinds of job tell of several rows together, as one
 * notification or with one another in mind: an owner-added job tells each
 * person a record's new owner rows name once, team row and user row alike,
 * and an episode's members-added job tells its owners of every alert or
 * incident added since its last run in one notification (a batch). Those go
 * through forEachGroupToNotify: the rows are read a page at a time as any
 * other, and the first of a record's rows a run reaches brings every row of
 * the record still to tell - of each table - to the job together (the
 * group), each taken by its own compare-and-set. A run stops between groups,
 * never inside one, so a deadline never splits what one run would have told
 * together.
 *
 * The reminder jobs (issue #9019) - an incident, an alert or a maintenance
 * event still open - go through forEachDue: what they tell of is not marked
 * once, it comes due again and again (nextReminderNotificationAt). They read
 * every record due at once, with no deadline, and moved each reminder on
 * through updateOneById: a read, the write, a realtime event and a workflow
 * trigger for what is the job's own bookkeeping, so an On Update workflow
 * that watches no fields ran at every reminder. Now a run reads what is due
 * a page at a time, the longest due first, stops at its deadline, and the
 * job moves each record on - its next reminder, or none - with one
 * compare-and-set expecting what it read: of two runs at once, one moves a
 * reminder, and tells of it.
 */

export const OWNER_NOTIFICATION_PAGE_SIZE: number = 100;

/*
 * How many records one run may read and fail to take before it stops: each
 * is left out of the pages after it by id. A run that fails this often is
 * failing on every record (the database is down); the next run tries again.
 */
export const OWNER_NOTIFICATION_LEFT_OUT_AT_MOST: number = 1000;

/*
 * How many of one table's rows a group holds at most (forEachGroupToNotify),
 * oldest first. A record with more still to tell has the rest told as a
 * group of their own, when the run reaches them.
 */
export const OWNER_NOTIFICATION_GROUP_ROWS_AT_MOST: number = LIMIT_MAX;

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
 * A table whose rows a job tells of together, as the record they name has
 * them (forEachGroupToNotify): its service, the mark of a row still to tell
 * and of one told, and what its rows are read with.
 */
export interface OwnerNotificationGroupTable {
  service: DatabaseService<BaseModel>;
  notYetNotified: PartialEntity<BaseModel>;
  notified: PartialEntity<BaseModel>;
  select: Select<BaseModel>;
}

/*
 * The rows of one record a job tells of together: every one still to tell
 * when the run reached the record, of each table.
 */
export interface OwnerNotificationGroup {
  // The record the rows name: an incident, an episode, a monitor...
  recordId: ObjectID;
  // Table by table, in the order the tables were given, each oldest first.
  rows: Array<Array<BaseModel>>;
}

export interface OwnerNotificationGroupResult {
  // How each table's backlog went, in the order the tables were given.
  tables: Array<OwnerNotificationBacklogResult>;
  // The groups handed to the job.
  groups: number;
  // Whether the run's deadline stopped it before it read everything.
  stoppedAtDeadline: boolean;
}

/*
 * How a reminder job moves a record on (forEachDue): `moved` written where
 * the record still holds `expected`, as the job read it.
 */
export interface OwnerNotificationMove<TRecord extends BaseModel> {
  expected: PartialEntity<TRecord>;
  moved: PartialEntity<TRecord>;
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
      /*
       * Says the record was taken already, with others it was told of
       * together (forEachGroupToNotify): by this run (true) or found taken
       * by another (false). Makes no statement; take() answers the same
       * after it.
       */
      alreadyTaken?: ((byThisRun: boolean) => void) | undefined;
    }) => Promise<void>;
  }): Promise<OwnerNotificationBacklogResult> {
    return await this.readPages<TRecord>({
      jobName: data.jobName,
      service: data.service,
      query: data.notYetNotified as Query<TRecord>,
      // Oldest first; ties broken by id (DatabaseService adds it).
      sort: {
        createdAt: SortOrder.Ascending,
      } as Sort<TRecord>,
      select: data.select,
      deadline: data.deadline,
      pageSize: data.pageSize,
      readPage: data.readPage,
      /*
       * Taken by another run, it is marked, and no page reads it again:
       * only a record never taken is left out by id.
       */
      leftOutWhen: [TakeOutcome.NotTaken],
      notify: async (input: {
        record: TRecord;
        page: OwnerNotificationPage;
        id: ObjectID;
        takes: Array<Promise<boolean>>;
      }): Promise<void> => {
        // The take, once the job asks for it: made at most once per record.
        const taking: { take: Promise<boolean> | null } = { take: null };

        const take: () => Promise<boolean> = (): Promise<boolean> => {
          if (!taking.take) {
            taking.take = OwnerNotificationBacklog.take({
              service: data.service,
              id: input.id,
              notYetNotified: data.notYetNotified,
              notified: data.notified,
            });
            input.takes.push(taking.take);
          }

          return taking.take;
        };

        const alreadyTaken: (byThisRun: boolean) => void = (
          byThisRun: boolean,
        ): void => {
          if (!taking.take) {
            taking.take = Promise.resolve(byThisRun);
            input.takes.push(taking.take);
          }
        };

        await data.notify({
          record: input.record,
          page: input.page,
          take: take,
          alreadyTaken: alreadyTaken,
        });
      },
    });
  }

  /*
   * Goes through the records of `service` that `due` finds - a reminder job's
   * records whose reminder is due (see the top of this file) - a page at a
   * time, in `sort`'s order, the longest due first. For each, `notify` is
   * handed the record, its page and `take`: the job decides what becomes of
   * the record - its next reminder, or none - and moves it on with take(),
   * one hook-free compare-and-set that writes `moved` only where the record
   * still holds `expected`, what the job read. It answers true for the run
   * whose write moved it. A job may take a second time, expecting what it
   * read again after the first take found the record changed. A record this
   * run read and did not move - another writer moved it first, or its job
   * failed - is left out of the pages after it by id, and the next run reads
   * it again if it is still due. Never throws for one record.
   */
  public static async forEachDue<TRecord extends BaseModel>(data: {
    jobName: string;
    service: DatabaseService<TRecord>;
    /*
     * What is due, as of the run's start:
     * { nextReminderNotificationAt: QueryHelper.lessThan(now) }.
     */
    due: Query<TRecord>;
    // The longest due first: { nextReminderNotificationAt: SortOrder.Ascending }.
    sort: Sort<TRecord>;
    select: Select<TRecord>;
    deadline?: JobDeadline | undefined;
    pageSize?: number | undefined;
    notify: (input: {
      record: TRecord;
      page: OwnerNotificationPage;
      take: (move: OwnerNotificationMove<TRecord>) => Promise<boolean>;
    }) => Promise<void>;
  }): Promise<OwnerNotificationBacklogResult> {
    return await this.readPages<TRecord>({
      jobName: data.jobName,
      service: data.service,
      query: data.due,
      sort: data.sort,
      select: data.select,
      deadline: data.deadline,
      pageSize: data.pageSize,
      /*
       * Moved by another writer, a record may still be due; moved by this
       * run, it never is - its next reminder is put after the run's start,
       * or taken away. So whatever this run did not move is left out by id,
       * and no page hands the job a record twice in one run.
       */
      leftOutWhen: [TakeOutcome.NotTaken, TakeOutcome.TakenElsewhere],
      notify: async (input: {
        record: TRecord;
        page: OwnerNotificationPage;
        id: ObjectID;
        takes: Array<Promise<boolean>>;
      }): Promise<void> => {
        const take: (
          move: OwnerNotificationMove<TRecord>,
        ) => Promise<boolean> = (
          move: OwnerNotificationMove<TRecord>,
        ): Promise<boolean> => {
          const taking: Promise<boolean> = OwnerNotificationBacklog.move({
            service: data.service,
            id: input.id,
            move: move,
          });

          input.takes.push(taking);

          return taking;
        };

        await data.notify({
          record: input.record,
          page: input.page,
          take: take,
        });
      },
    });
  }

  /*
   * The pages a backlog's run reads, and what the job did with each record
   * (forEachToNotify, forEachDue): a page at a time, in `sort`'s order, every
   * record the run read and left as `leftOutWhen` says left out of the pages
   * after it by id. Stops between records once the deadline passes. A record
   * is handed to the job once a run: should one come back - moved by this
   * run to where `query` finds it again - it is passed over, and a page that
   * brings nothing new ends the run.
   */
  private static async readPages<TRecord extends BaseModel>(data: {
    jobName: string;
    service: DatabaseService<TRecord>;
    query: Query<TRecord>;
    sort: Sort<TRecord>;
    select: Select<TRecord>;
    deadline?: JobDeadline | undefined;
    pageSize?: number | undefined;
    readPage?:
      | ((
          records: Array<TRecord>,
          page: OwnerNotificationPage,
        ) => Promise<void>)
      | undefined;
    leftOutWhen: ReadonlyArray<TakeOutcome>;
    /*
     * The job, for one record: each take it makes goes into `takes`, which
     * say what became of the record, whether the job threw or not.
     */
    notify: (input: {
      record: TRecord;
      page: OwnerNotificationPage;
      id: ObjectID;
      takes: Array<Promise<boolean>>;
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

    // Every record handed to the job this run.
    const handed: Set<string> = new Set<string>();

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
          ...data.query,
          ...(leftOut.length > 0 ? { _id: QueryHelper.notIn(leftOut) } : {}),
        } as Query<TRecord>,
        select: {
          ...data.select,
          _id: true,
        } as Select<TRecord>,
        sort: data.sort,
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

      let isAnyNew: boolean = false;

      for (const record of records) {
        if (data.deadline?.hasPassed()) {
          result.stoppedAtDeadline = true;
          break pages;
        }

        const id: ObjectID | null = record.id;

        if (!id) {
          continue;
        }

        const key: string = id.toString().toLowerCase();

        if (handed.has(key)) {
          continue;
        }

        handed.add(key);
        isAnyNew = true;

        const takes: Array<Promise<boolean>> = [];

        try {
          await data.notify({
            record: record,
            page: page,
            id: id,
            takes: takes,
          });
        } catch (error) {
          result.failed++;
          logger.error(
            `${data.jobName}: notifying the owners of ${id.toString()} failed.`,
          );
          logger.error(error);
        }

        const outcome: TakeOutcome =
          await OwnerNotificationBacklog.outcomeOf(takes);

        if (outcome === TakeOutcome.Taken) {
          result.taken++;
        } else if (outcome === TakeOutcome.TakenElsewhere) {
          result.takenElsewhere++;
        }

        if (data.leftOutWhen.includes(outcome)) {
          // Not again this run.
          leftOut.push(id);
        }
      }

      if (!isAnyNew || records.length < pageSize) {
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

  /*
   * Goes through the rows of `tables` still to tell, table by table - each a
   * page at a time, oldest first, as forEachToNotify does - and hands the job
   * every row of a record still to tell, of every table, together: the
   * first of a record's rows the run reaches brings its group (see the top
   * of this file). The job plans whom the group tells, calls take() - which
   * takes each of its rows by its own compare-and-set, and answers the rows
   * this run took, table by table - and tells of the rows it took. The rows
   * a group took are not handed to the job again, however many pages they
   * are on. Never throws for one group: a group whose job throws is logged,
   * and the rows it did not take are left for a later group.
   */
  public static async forEachGroupToNotify(data: {
    jobName: string;
    // The column each table's rows name their record by: "incidentId".
    recordIdColumn: string;
    tables: Array<OwnerNotificationGroupTable>;
    deadline?: JobDeadline | undefined;
    pageSize?: number | undefined;
    // How many of one table's rows a group holds at most.
    groupRowsAtMost?: number | undefined;
    // Reads what every group of the page needs, once, before them.
    readPage?:
      | ((
          recordIds: Array<ObjectID>,
          page: OwnerNotificationPage,
        ) => Promise<void>)
      | undefined;
    notify: (input: {
      group: OwnerNotificationGroup;
      page: OwnerNotificationPage;
      take: () => Promise<Array<Array<BaseModel>>>;
    }) => Promise<void>;
  }): Promise<OwnerNotificationGroupResult> {
    const result: OwnerNotificationGroupResult = {
      tables: [],
      groups: 0,
      stoppedAtDeadline: false,
    };

    const rowsAtMost: number =
      data.groupRowsAtMost || OWNER_NOTIFICATION_GROUP_ROWS_AT_MOST;

    /*
     * The rows a group of this run set out to take, by table and id: whether
     * this run took each. Handed to the job no more.
     */
    const takenWithGroup: Map<string, boolean> = new Map<string, boolean>();

    for (
      let tableIndex: number = 0;
      tableIndex < data.tables.length;
      tableIndex++
    ) {
      const table: OwnerNotificationGroupTable = data.tables[tableIndex]!;

      if (data.deadline?.hasPassed()) {
        result.stoppedAtDeadline = true;
        break;
      }

      const tableResult: OwnerNotificationBacklogResult =
        await this.forEachToNotify<BaseModel>({
          jobName: data.jobName,
          service: table.service,
          notYetNotified: table.notYetNotified,
          notified: table.notified,
          select: {
            ...table.select,
            [data.recordIdColumn]: true,
          } as Select<BaseModel>,
          deadline: data.deadline,
          pageSize: data.pageSize,
          readPage: async (
            records: Array<BaseModel>,
            page: OwnerNotificationPage,
          ): Promise<void> => {
            const recordIds: Array<ObjectID> = this.recordIdsOf(
              records,
              data.recordIdColumn,
            );

            await this.readGroupsOfPage({
              tables: data.tables,
              recordIdColumn: data.recordIdColumn,
              recordIds: recordIds,
              rowsAtMost: rowsAtMost,
              page: page,
            });

            if (data.readPage && recordIds.length > 0) {
              await data.readPage(recordIds, page);
            }
          },
          notify: async (input: {
            record: BaseModel;
            page: OwnerNotificationPage;
            take: () => Promise<boolean>;
            alreadyTaken?: ((byThisRun: boolean) => void) | undefined;
          }): Promise<void> => {
            const rowKey: string = groupRowKey(tableIndex, input.record.id!);
            const takenEarlier: boolean | undefined =
              takenWithGroup.get(rowKey);

            // Taken with its group already: told of with it.
            if (takenEarlier !== undefined) {
              if (input.alreadyTaken) {
                input.alreadyTaken(takenEarlier);
              } else {
                await input.take();
              }
              return;
            }

            const recordId: ObjectID | null = toObjectID(
              columnOf(input.record, data.recordIdColumn),
            );

            /*
             * It names no record: there is nobody to tell of it. Taken all
             * the same, so no run reads it again.
             */
            if (!recordId) {
              await input.take();
              return;
            }

            const readGroup: () => Promise<
              Array<Array<BaseModel>>
            > = (): Promise<Array<Array<BaseModel>>> => {
              return this.readGroup({
                tables: data.tables,
                recordIdColumn: data.recordIdColumn,
                recordId: recordId,
                rowsAtMost: rowsAtMost,
              });
            };

            const isInGroup: (rows: Array<Array<BaseModel>>) => boolean = (
              rows: Array<Array<BaseModel>>,
            ): boolean => {
              return (rows[tableIndex] || []).some(
                (row: BaseModel): boolean => {
                  return sameId(row.id, input.record.id);
                },
              );
            };

            // The record's group as read with the page, or for a row before.
            let rows: Array<Array<BaseModel>> = await input.page.once(
              groupKey(recordId),
              readGroup,
            );

            if (!isInGroup(rows)) {
              /*
               * Not in the group read before it: that group was full to its
               * limit, or another run took the row since. Read again, it is
               * in the group of what is left - or it was taken, if that read
               * holds every row of its table still to tell. A read full to
               * its limit may have left it behind older rows still to tell
               * (their job failed): then it is left as it is, for a later
               * run - its take is never made without it being told of.
               */
              rows = await readGroup();
              input.page.prime<Array<Array<BaseModel>>>(
                groupKey(recordId),
                rows,
              );

              if (!isInGroup(rows)) {
                if ((rows[tableIndex] || []).length < rowsAtMost) {
                  // Taken by another run, which tells of it with its group.
                  if (input.alreadyTaken) {
                    input.alreadyTaken(false);
                  } else {
                    await input.take();
                  }
                }

                return;
              }
            }

            const group: Array<Array<BaseModel>> = rows;

            // The group's take, once the job asks for it: made at most once.
            const taking: { take: Promise<Array<Array<BaseModel>>> | null } = {
              take: null,
            };

            const take: () => Promise<Array<Array<BaseModel>>> = (): Promise<
              Array<Array<BaseModel>>
            > => {
              if (!taking.take) {
                taking.take = this.takeGroup({
                  jobName: data.jobName,
                  tables: data.tables,
                  rows: group,
                  current: {
                    tableIndex: tableIndex,
                    id: input.record.id!,
                    take: input.take,
                  },
                  takenWithGroup: takenWithGroup,
                });
              }

              return taking.take;
            };

            result.groups++;

            await data.notify({
              group: { recordId: recordId, rows: group },
              page: input.page,
              take: take,
            });
          },
        });

      result.tables.push(tableResult);

      if (tableResult.stoppedAtDeadline) {
        result.stoppedAtDeadline = true;
        break;
      }
    }

    return result;
  }

  /*
   * A table for forEachGroupToNotify, its mark and what it is read with
   * checked against its own model.
   */
  public static groupTable<TRow extends BaseModel>(table: {
    service: DatabaseService<TRow>;
    notYetNotified: PartialEntity<TRow>;
    notified: PartialEntity<TRow>;
    select: Select<TRow>;
  }): OwnerNotificationGroupTable {
    return table as unknown as OwnerNotificationGroupTable;
  }

  // The distinct records a page's rows name.
  private static recordIdsOf(
    records: Array<BaseModel>,
    recordIdColumn: string,
  ): Array<ObjectID> {
    const recordIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const record of records) {
      const recordId: ObjectID | null = toObjectID(
        columnOf(record, recordIdColumn),
      );

      if (recordId) {
        recordIds.set(recordId.toString().toLowerCase(), recordId);
      }
    }

    return Array.from(recordIds.values());
  }

  /*
   * The groups of every record a page's rows name, read with one query per
   * table instead of one per record, and handed to each record's first row
   * (OwnerNotificationPage.prime). A read that comes back full may have left
   * rows out: then nothing is primed, and each record reads its own group.
   */
  private static async readGroupsOfPage(data: {
    tables: Array<OwnerNotificationGroupTable>;
    recordIdColumn: string;
    recordIds: Array<ObjectID>;
    rowsAtMost: number;
    page: OwnerNotificationPage;
  }): Promise<void> {
    if (data.recordIds.length === 0) {
      return;
    }

    const rowsByTable: Array<Array<BaseModel>> = [];

    for (const table of data.tables) {
      const rows: Array<BaseModel> = await this.readRowsStillToTell({
        table: table,
        recordIdColumn: data.recordIdColumn,
        recordIds: data.recordIds,
        rowsAtMost: data.rowsAtMost,
      });

      if (rows.length >= data.rowsAtMost) {
        return;
      }

      rowsByTable.push(rows);
    }

    for (const recordId of data.recordIds) {
      data.page.prime<Array<Array<BaseModel>>>(
        groupKey(recordId),
        rowsByTable.map((rows: Array<BaseModel>): Array<BaseModel> => {
          return rows.filter((row: BaseModel): boolean => {
            return sameId(
              toObjectID(columnOf(row, data.recordIdColumn)),
              recordId,
            );
          });
        }),
      );
    }
  }

  // One record's group, read on its own: table by table.
  private static async readGroup(data: {
    tables: Array<OwnerNotificationGroupTable>;
    recordIdColumn: string;
    recordId: ObjectID;
    rowsAtMost: number;
  }): Promise<Array<Array<BaseModel>>> {
    const rows: Array<Array<BaseModel>> = [];

    for (const table of data.tables) {
      rows.push(
        await this.readRowsStillToTell({
          table: table,
          recordIdColumn: data.recordIdColumn,
          recordIds: [data.recordId],
          rowsAtMost: data.rowsAtMost,
        }),
      );
    }

    return rows;
  }

  // A table's rows still to tell of the records given, oldest first.
  private static async readRowsStillToTell<TRow extends BaseModel>(data: {
    table: {
      service: DatabaseService<TRow>;
      notYetNotified: PartialEntity<TRow>;
      select: Select<TRow>;
    };
    recordIdColumn: string;
    recordIds: Array<ObjectID>;
    rowsAtMost: number;
  }): Promise<Array<TRow>> {
    return await data.table.service.findBy({
      query: {
        ...data.table.notYetNotified,
        [data.recordIdColumn]:
          data.recordIds.length === 1
            ? data.recordIds[0]!
            : QueryHelper.any(data.recordIds),
      } as Query<TRow>,
      select: {
        ...data.table.select,
        _id: true,
        [data.recordIdColumn]: true,
      } as Select<TRow>,
      // Oldest first; ties broken by id (DatabaseService adds it).
      sort: {
        createdAt: SortOrder.Ascending,
      } as Sort<TRow>,
      limit: data.rowsAtMost,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * Takes every row of a group, each by its own compare-and-set - the row
   * its backlog reached through that backlog's own take - and answers the
   * rows this run took, table by table. A take that fails is logged and its
   * row left for a later group: it is not told of now. Never throws.
   */
  private static async takeGroup(data: {
    jobName: string;
    tables: Array<OwnerNotificationGroupTable>;
    rows: Array<Array<BaseModel>>;
    current: {
      tableIndex: number;
      id: ObjectID;
      take: () => Promise<boolean>;
    };
    takenWithGroup: Map<string, boolean>;
  }): Promise<Array<Array<BaseModel>>> {
    const taken: Array<Array<BaseModel>> = data.tables.map(
      (): Array<BaseModel> => {
        return [];
      },
    );

    for (
      let tableIndex: number = 0;
      tableIndex < data.tables.length;
      tableIndex++
    ) {
      const table: OwnerNotificationGroupTable = data.tables[tableIndex]!;

      for (const row of data.rows[tableIndex] || []) {
        if (!row.id) {
          continue;
        }

        const isCurrent: boolean =
          tableIndex === data.current.tableIndex &&
          sameId(row.id, data.current.id);

        let isThisRuns: boolean = false;

        try {
          isThisRuns = isCurrent
            ? await data.current.take()
            : await this.take({
                service: table.service,
                id: row.id,
                notYetNotified: table.notYetNotified,
                notified: table.notified,
              });
        } catch (error) {
          logger.error(
            `${data.jobName}: could not take ${row.id.toString()} with the rows told of with it; a later run tells of it.`,
          );
          logger.error(error);
          continue;
        }

        data.takenWithGroup.set(groupRowKey(tableIndex, row.id), isThisRuns);

        if (isThisRuns) {
          taken[tableIndex]!.push(row);
        }
      }
    }

    return taken;
  }

  /*
   * What became of a record, once its job is done with it: taken when one of
   * its takes moved it, taken elsewhere when a take found it moved or gone,
   * not taken when it made none - or none answered.
   */
  private static async outcomeOf(
    takes: Array<Promise<boolean>>,
  ): Promise<TakeOutcome> {
    let outcome: TakeOutcome = TakeOutcome.NotTaken;

    for (const taking of takes) {
      try {
        if (await taking) {
          return TakeOutcome.Taken;
        }

        outcome = TakeOutcome.TakenElsewhere;
      } catch {
        // The job awaited it, so its failure is logged with the job's.
      }
    }

    return outcome;
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

  /*
   * Moves one record on (forEachDue) - true for the run whose write did,
   * false where the record no longer holds what the job read, or is gone.
   * One hook-free statement, for the job's own bookkeeping, as take() is.
   */
  public static async move<TRecord extends BaseModel>(data: {
    service: DatabaseService<TRecord>;
    id: ObjectID;
    move: OwnerNotificationMove<TRecord>;
  }): Promise<boolean> {
    return await data.service.compareAndSetColumnsByIdWithoutHooks({
      id: data.id,
      data: data.move.moved,
      expectedData: data.move.expected,
    });
  }
}

// The key a record's group is read once per page by.
function groupKey(recordId: ObjectID): string {
  return `ownerNotificationGroup:${recordId.toString().toLowerCase()}`;
}

// A row of a group, by its table and id.
function groupRowKey(tableIndex: number, id: ObjectID): string {
  return `${tableIndex}:${id.toString().toLowerCase()}`;
}

function sameId(
  a: ObjectID | null | undefined,
  b: ObjectID | null | undefined,
): boolean {
  return Boolean(
    a && b && a.toString().toLowerCase() === b.toString().toLowerCase(),
  );
}

// A column of a row, as the row holds it.
function columnOf(row: BaseModel, column: string): unknown {
  return (row as unknown as Record<string, unknown>)[column];
}

// A record id as a row holds it: an ObjectID, or its text.
function toObjectID(value: unknown): ObjectID | null {
  if (!value) {
    return null;
  }

  if (value instanceof ObjectID) {
    return value;
  }

  const text: string = value.toString();

  return text ? new ObjectID(text) : null;
}
