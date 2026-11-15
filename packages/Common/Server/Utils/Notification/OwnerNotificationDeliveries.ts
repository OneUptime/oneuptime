import User from "../../../Models/DatabaseModels/User";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import {
  OwnerNotificationDeliveryStatus,
  OwnerNotificationFeedStatus,
  OwnerNotificationKind,
} from "../../../Types/Notification/OwnerNotificationDelivery";
import ObjectID from "../../../Types/ObjectID";
import OwnerNotificationDeliveryService, {
  OwnerNotificationDeliveryRow,
  OwnerNotificationEvent,
} from "../../Services/OwnerNotificationDeliveryService";
import ProjectService from "../../Services/ProjectService";
import UserService from "../../Services/UserService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";

/*
 * EVERY OWNER TOLD ONCE, HOWEVER THE WORKER STOPS (issues #8199, #8509).
 *
 * An owner notification job (IncidentOwners, AlertOwners, and those of
 * episodes, monitors, scheduled maintenance, status pages, SLOs and network
 * devices) takes the record it tells the owners of - marks the incident
 * created, the state change, the note, the owner row as notified, or moves
 * a reminder on - so that a
 * record whose notification keeps failing is never read again on every
 * run. Then it tells each owner. A worker stopped hard in between - an
 * out-of-memory kill, a node lost - used to leave every owner it had not
 * reached yet untold for good, and nothing said so.
 *
 * Now, per record:
 *
 *   1. Before the take, the job writes who it is about to tell: a row per
 *      owner, to be told (plan). A stop before the take leaves the record
 *      as it was, so a later run reads it again.
 *   2. It takes the record, as before.
 *   3. It tells each owner through tell(): one run alone moves the owner's
 *      row from to be told to being told, sends, and records it sent.
 *
 * And at the start of every run, it tells the owners a stopped run left to
 * be told (resume): every notification of its kinds with owners still to be
 * told whom no run set out to tell for RESUME_AFTER_MINUTES, taken up by one
 * run alone, the record read again and exactly those owners told.
 *
 * So wherever the worker stops:
 *
 *   - before an owner's send: the owner is still to be told, and is;
 *   - during it, or after it before it was recorded: nobody can know
 *     whether it went out, so the owner is never told again - told once at
 *     most, and every other owner exactly once;
 *   - after it was recorded: told, and never again.
 *
 * Two runs at once - one lost its lock (CronLock) and went on - tell each
 * owner once between them: only one moves an owner's row on. A failure
 * that is not a stop keeps to what each job did before: an owner whose send
 * fails is not told again, nor is one whose record is gone. A record whose
 * notification fails to build before anyone is told is tried again by a
 * later run, and given up after ATTEMPTS_AT_MOST runs set out to tell its
 * owners - so a record that stops the worker every time cannot stop it for
 * ever.
 *
 * Should the rows themselves not be written - the database refused them -
 * the job tells its owners as it did before they were kept: once, and lost
 * to a stop.
 *
 * THE FEED ITEM (#8510). A job whose notification writes a feed item on its
 * record - the entry naming whom it reached - says so when it plans
 * (writesFeedItem), and the rows keep it as still to write until the job
 * says it is written (feedItemWritten). A run that told its last owner and
 * stopped before the feed item leaves it so, and resume() hands it to a
 * later run - one alone, once no row of the notification moved for
 * RESUME_AFTER_MINUTES - to write from whom the rows say was told. It is
 * written at least once rather than at most: a stop between the feed item
 * and saying so writes it again, which is better than a feed that never
 * says who was told.
 */

// Which notification: as OwnerNotificationEvent, with the occurrence left to 1.
export interface OwnerNotificationOf {
  kind: OwnerNotificationKind;
  projectId: ObjectID;
  // The record the owners are told of: an incident, an alert, a monitor...
  resourceId: ObjectID;
  // The record whose notification it is.
  eventId: ObjectID;
  // A reminder's number; 1, the default, for every other notification.
  occurrence?: number | undefined;
}

interface OwnerToTellNow {
  user: User;
  // Its row; none when the rows could not be written.
  rowId: ObjectID | null;
}

/*
 * One notification's owners, for one run of its job: whom it is to tell
 * (owners), whom a run before it told (toldEarlier), and tell() for each.
 */
export class OwnerNotificationDelivery {
  public readonly notification: OwnerNotificationEvent;

  /*
   * Whether the owners are the project's owners, told in the place of a
   * record with no owners of its own.
   */
  public readonly isProjectOwners: boolean;

  // Whom this run is to tell, in the order they were planned.
  public readonly owners: Array<User>;

  // Whom a run before this one told already: it stopped before it was done.
  public readonly toldEarlier: Array<User>;

  /*
   * Taken up only to write the feed item a run that told every owner
   * stopped before writing (#8510): nobody is to be told, and the feed item
   * names whom the rows say was told (toldEarlier).
   */
  public readonly isFeedLeftUnwritten: boolean;

  private readonly toTell: Map<string, OwnerToTellNow>;
  private setOutToTell: number = 0;
  // Whether the rows keep the feed item as still to write.
  private isFeedTracked: boolean;

  public constructor(data: {
    notification: OwnerNotificationEvent;
    isProjectOwners: boolean;
    owners: Array<OwnerToTellNow>;
    toldEarlier: Array<User>;
    feedStatus?: OwnerNotificationFeedStatus | null | undefined;
    isFeedLeftUnwritten?: boolean | undefined;
  }) {
    this.notification = data.notification;
    this.isProjectOwners = data.isProjectOwners;
    this.isFeedTracked = data.feedStatus === OwnerNotificationFeedStatus.Pending;
    this.isFeedLeftUnwritten = Boolean(data.isFeedLeftUnwritten);
    this.owners = data.owners.map((owner: OwnerToTellNow): User => {
      return owner.user;
    });
    this.toldEarlier = data.toldEarlier;
    this.toTell = new Map<string, OwnerToTellNow>();

    for (const owner of data.owners) {
      this.toTell.set(userKey(owner.user), owner);
    }
  }

  /*
   * Whether this run set out to tell any owner: what the job's feed item,
   * naming whom the notification reached, is written for. A run that finds
   * every owner told already writes none - the run that told them did.
   */
  public get hasSetOutToTellAnyone(): boolean {
    return this.setOutToTell > 0;
  }

  /*
   * Whether this run has anything to do for the notification: owners to
   * tell, or the feed item a stopped run left unwritten.
   */
  public get hasWorkToDo(): boolean {
    return this.owners.length > 0 || this.isFeedLeftUnwritten;
  }

  /*
   * Whether this run writes the notification's feed item: it set out to tell
   * an owner, or it took up the feed item a stopped run left unwritten.
   */
  public get isFeedItemToWrite(): boolean {
    return this.hasSetOutToTellAnyone || this.isFeedLeftUnwritten;
  }

  /*
   * Says the job wrote the notification's feed item, so no later run writes
   * it again (#8510). Never throws: should it not be said, a later run
   * writes the feed item a second time.
   */
  public async feedItemWritten(): Promise<void> {
    await this.settleFeedItem(OwnerNotificationFeedStatus.Written);
  }

  /*
   * Tells one of the owners: true when `send` sent them the notification.
   * Only one run ever sends it to an owner, and only once: false, without
   * sending, for an owner another run told or is telling, or one this run
   * told already. A `send` that throws is logged and the owner is not told
   * again, as before. Never throws.
   */
  public async tell(owner: User, send: () => Promise<void>): Promise<boolean> {
    const key: string = userKey(owner);
    const toTell: OwnerToTellNow | undefined = this.toTell.get(key);

    if (!toTell) {
      return false;
    }

    this.toTell.delete(key);

    if (toTell.rowId) {
      let isThisRuns: boolean = false;

      try {
        isThisRuns = await OwnerNotificationDeliveryService.startTelling(
          toTell.rowId,
          OneUptimeDate.getCurrentDate(),
        );
      } catch (error) {
        logger.error(
          `Could not say that this run is telling an owner of ${this.describe()}: ${error}. They are told by a later run.`,
          this.logAttributes(owner),
        );
        return false;
      }

      if (!isThisRuns) {
        return false;
      }
    }

    this.setOutToTell++;

    let isSent: boolean = true;

    try {
      await send();
    } catch (error) {
      isSent = false;
      logger.error(
        `Telling an owner of ${this.describe()} failed: ${error}`,
        this.logAttributes(owner),
      );
      logger.error(error, this.logAttributes(owner));
    }

    if (toTell.rowId) {
      try {
        await OwnerNotificationDeliveryService.finishTelling({
          id: toTell.rowId,
          status: isSent
            ? OwnerNotificationDeliveryStatus.Sent
            : OwnerNotificationDeliveryStatus.Failed,
          at: OneUptimeDate.getCurrentDate(),
        });
      } catch (error) {
        // Left as being told: never told again, so told once at most.
        logger.error(
          `Could not record how telling an owner of ${this.describe()} ended: ${error}. They are not told again.`,
          this.logAttributes(owner),
        );
      }
    }

    return isSent;
  }

  /*
   * The owners this run has not set out to tell yet are not told, and the
   * feed item still to write is not written: the notification can no longer
   * reach them (the record it is about is gone). Never throws.
   */
  public async giveUp(reason: string): Promise<void> {
    const owners: Array<OwnerToTellNow> = [...this.toTell.values()];

    this.toTell.clear();

    const rowIds: Array<ObjectID> = owners
      .map((owner: OwnerToTellNow): ObjectID | null => {
        return owner.rowId;
      })
      .filter((rowId: ObjectID | null): rowId is ObjectID => {
        return rowId !== null;
      });

    if (owners.length > 0) {
      logger.warn(
        `Not telling ${owners.length} owner(s) of ${this.describe()}: ${reason}.`,
        this.logAttributes(),
      );

      try {
        await OwnerNotificationDeliveryService.giveUpTelling(
          rowIds,
          OneUptimeDate.getCurrentDate(),
        );
      } catch (error) {
        logger.error(
          `Could not record that ${owners.length} owner(s) of ${this.describe()} are not told: ${error}.`,
          this.logAttributes(),
        );
      }
    } else if (this.isFeedLeftUnwritten) {
      logger.warn(
        `Not writing the feed item of ${this.describe()}: ${reason}.`,
        this.logAttributes(),
      );
    }

    await this.settleFeedItem(OwnerNotificationFeedStatus.NotWritten);
  }

  private async settleFeedItem(
    feedStatus:
      | OwnerNotificationFeedStatus.Written
      | OwnerNotificationFeedStatus.NotWritten,
  ): Promise<void> {
    if (!this.isFeedTracked) {
      return;
    }

    this.isFeedTracked = false;

    try {
      await OwnerNotificationDeliveryService.settleFeedItem({
        event: this.notification,
        feedStatus: feedStatus,
        at: OneUptimeDate.getCurrentDate(),
      });
    } catch (error) {
      logger.error(
        `Could not record that the feed item of ${this.describe()} is ${feedStatus === OwnerNotificationFeedStatus.Written ? "written" : "not written"}: ${error}.${feedStatus === OwnerNotificationFeedStatus.Written ? " A later run writes it again." : ""}`,
        this.logAttributes(),
      );
    }
  }

  private describe(): string {
    return `${this.notification.kind} ${this.notification.eventId.toString()}`;
  }

  private logAttributes(owner?: User | undefined): LogAttributes {
    return {
      projectId: this.notification.projectId.toString(),
      ownerNotificationKind: this.notification.kind,
      resourceId: this.notification.resourceId.toString(),
      eventId: this.notification.eventId.toString(),
      ...(owner?.id ? { userId: owner.id.toString() } : {}),
    };
  }
}

export default class OwnerNotificationDeliveries {
  /*
   * How long owners still to be told wait, after a run set out to tell
   * them, before a later run takes them up: a run that has not told them by
   * then stopped (one run of a job goes at a time, CronLock). Should it
   * still be going - it lost its lock - each owner is told once all the
   * same.
   */
  public static readonly RESUME_AFTER_MINUTES: number = 2;

  /*
   * How many runs set out to tell an owner at most - the one that wrote
   * their row and two more - before they are given up on: a record that
   * stops the worker every time it is told of is told of no more.
   */
  public static readonly ATTEMPTS_AT_MOST: number = 3;

  // How many notifications a stopped run left one run takes up, at most.
  public static readonly TAKEN_UP_PER_RUN_AT_MOST: number = 100;

  /*
   * Writes who a record's notification is to tell, before the job takes the
   * record (see the top of this file), and hands back whom this run is to
   * tell - each owner who was not told or set out to be told already, in the
   * order given - and whom a run before it told. Never throws: should the
   * rows not be written, every owner given is to be told, as before.
   */
  public static async plan(data: {
    notification: OwnerNotificationOf;
    owners: Array<User>;
    isProjectOwners: boolean;
    /*
     * Whether the job writes a feed item naming whom the notification
     * reached: its rows then keep it as still to write, so a later run
     * writes it should this one stop before it does (#8510).
     */
    writesFeedItem: boolean;
  }): Promise<OwnerNotificationDelivery> {
    const notification: OwnerNotificationEvent = toEvent(data.notification);
    const owners: Array<User> = onceEach(data.owners);

    if (owners.length === 0) {
      return new OwnerNotificationDelivery({
        notification: notification,
        isProjectOwners: data.isProjectOwners,
        owners: [],
        toldEarlier: [],
      });
    }

    let rows: Array<OwnerNotificationDeliveryRow>;

    try {
      rows = await OwnerNotificationDeliveryService.writeOwnersToTell({
        event: notification,
        owners: owners.map((user: User) => {
          return {
            userId: user.id!,
            isProjectOwner: data.isProjectOwners,
          };
        }),
        at: OneUptimeDate.getCurrentDate(),
        writesFeedItem: data.writesFeedItem,
      });
    } catch (error) {
      logger.error(
        `Could not write whom ${notification.kind} ${notification.eventId.toString()} is to tell: ${error}. Telling them without: a stop part way loses the rest.`,
        { projectId: notification.projectId.toString() } as LogAttributes,
      );

      return new OwnerNotificationDelivery({
        notification: notification,
        isProjectOwners: data.isProjectOwners,
        owners: owners.map((user: User): OwnerToTellNow => {
          return { user: user, rowId: null };
        }),
        toldEarlier: [],
      });
    }

    return await this.deliveryOf({
      notification: notification,
      isProjectOwners: data.isProjectOwners,
      toTell: rows.filter((row: OwnerNotificationDeliveryRow): boolean => {
        return row.status === OwnerNotificationDeliveryStatus.Pending;
      }),
      rows: rows,
      known: owners,
      isFeedLeftUnwritten: false,
    });
  }

  /*
   * plan(), for the record's owners as `findOwners` reads them - or the
   * project's owners, told in their place, when it reads none. A failure to
   * read them tells nobody, as it did when it came after the take, and says
   * so. Never throws.
   */
  public static async planForOwnersOf(data: {
    notification: OwnerNotificationOf;
    findOwners: () => Promise<Array<User>>;
    writesFeedItem: boolean;
  }): Promise<OwnerNotificationDelivery> {
    let owners: Array<User> = [];
    let isProjectOwners: boolean = false;

    try {
      owners = await data.findOwners();

      if (owners.length === 0) {
        isProjectOwners = true;
        owners = await ProjectService.getOwners(data.notification.projectId);
      }
    } catch (error) {
      logger.error(
        `Could not read whom ${data.notification.kind} ${data.notification.eventId.toString()} is to tell: ${error}. Telling nobody.`,
        {
          projectId: data.notification.projectId.toString(),
          ownerNotificationKind: data.notification.kind,
          resourceId: data.notification.resourceId.toString(),
          eventId: data.notification.eventId.toString(),
        } as LogAttributes,
      );
      owners = [];
      isProjectOwners = false;
    }

    return await this.plan({
      notification: data.notification,
      owners: owners,
      isProjectOwners: isProjectOwners,
      writesFeedItem: data.writesFeedItem,
    });
  }

  /*
   * Tells the owners a stopped run left to be told, for the job whose
   * notifications are of `kinds` (see the top of this file): `notify` is
   * handed each notification taken up, reads its record again and tells its
   * owners as the job does. Never throws: what fails is logged, and a later
   * run takes it up again, ATTEMPTS_AT_MOST times in all.
   */
  public static async resume(data: {
    kinds: Array<OwnerNotificationKind>;
    notify: (delivery: OwnerNotificationDelivery) => Promise<void>;
  }): Promise<void> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const attemptedBefore: Date = OneUptimeDate.addRemoveMinutes(
      now,
      -this.RESUME_AFTER_MINUTES,
    );

    let notifications: Array<OwnerNotificationEvent> = [];

    try {
      notifications = await OwnerNotificationDeliveryService.findLeftPartWay({
        kinds: data.kinds,
        attemptedBefore: attemptedBefore,
        limit: this.TAKEN_UP_PER_RUN_AT_MOST,
      });
    } catch (error) {
      logger.error(
        `Could not read the owners a stopped run of ${data.kinds.join(", ")} left to be told: ${error}`,
      );
      return;
    }

    for (const notification of notifications) {
      const attributes: LogAttributes = {
        projectId: notification.projectId.toString(),
        ownerNotificationKind: notification.kind,
        resourceId: notification.resourceId.toString(),
        eventId: notification.eventId.toString(),
      };

      try {
        const takenUp: Array<OwnerNotificationDeliveryRow> =
          await OwnerNotificationDeliveryService.takeUpLeftPartWay({
            event: notification,
            attemptedBefore: attemptedBefore,
            at: now,
          });

        // Another run took them up first.
        if (takenUp.length === 0) {
          continue;
        }

        const exhausted: Array<OwnerNotificationDeliveryRow> = takenUp.filter(
          (row: OwnerNotificationDeliveryRow): boolean => {
            return row.attempts > this.ATTEMPTS_AT_MOST;
          },
        );

        if (exhausted.length > 0) {
          await OwnerNotificationDeliveryService.giveUpTelling(
            exhausted.map((row: OwnerNotificationDeliveryRow): ObjectID => {
              return row.id;
            }),
            now,
          );

          logger.error(
            `Gave up telling ${exhausted.length} owner(s) of ${notification.kind} ${notification.eventId.toString()}: each of the ${this.ATTEMPTS_AT_MOST} runs that set out to tell them stopped before it did.`,
            attributes,
          );
        }

        const toTell: Array<OwnerNotificationDeliveryRow> = takenUp.filter(
          (row: OwnerNotificationDeliveryRow): boolean => {
            return row.attempts <= this.ATTEMPTS_AT_MOST;
          },
        );

        if (toTell.length === 0) {
          continue;
        }

        const rows: Array<OwnerNotificationDeliveryRow> =
          await OwnerNotificationDeliveryService.findRowsOf(notification);

        const beingTold: number = rows.filter(
          (row: OwnerNotificationDeliveryRow): boolean => {
            return row.status === OwnerNotificationDeliveryStatus.Sending;
          },
        ).length;

        logger.warn(
          `A run of the owner notifications stopped part way through ${notification.kind} ${notification.eventId.toString()}: telling the ${toTell.length} owner(s) it left to be told.${beingTold > 0 ? ` ${beingTold} owner(s) were being told as it stopped: whether they were, nobody knows, and they are not told again.` : ""}`,
          attributes,
        );

        const delivery: OwnerNotificationDelivery = await this.deliveryOf({
          notification: notification,
          isProjectOwners: toTell.every(
            (row: OwnerNotificationDeliveryRow): boolean => {
              return row.isProjectOwner;
            },
          ),
          toTell: toTell,
          rows: rows,
          known: [],
          isFeedLeftUnwritten: false,
        });

        await data.notify(delivery);
      } catch (error) {
        logger.error(
          `Telling the owners a stopped run left to be told of ${notification.kind} ${notification.eventId.toString()} failed: ${error}. A later run tries again.`,
          attributes,
        );
        logger.error(error, attributes);
      }
    }

    await this.resumeFeedItems({
      kinds: data.kinds,
      notify: data.notify,
      now: now,
      attemptedBefore: attemptedBefore,
    });
  }

  /*
   * Writes the feed items a stopped run left unwritten after telling every
   * owner (#8510): each taken up by one run alone, once no row of its
   * notification moved for RESUME_AFTER_MINUTES, and handed to `notify` with
   * nobody to tell and whom the rows say was told. Never throws.
   */
  private static async resumeFeedItems(data: {
    kinds: Array<OwnerNotificationKind>;
    notify: (delivery: OwnerNotificationDelivery) => Promise<void>;
    now: Date;
    attemptedBefore: Date;
  }): Promise<void> {
    let notifications: Array<OwnerNotificationEvent> = [];

    try {
      notifications =
        await OwnerNotificationDeliveryService.findFeedItemsLeftUnwritten({
          kinds: data.kinds,
          attemptedBefore: data.attemptedBefore,
          limit: this.TAKEN_UP_PER_RUN_AT_MOST,
        });
    } catch (error) {
      logger.error(
        `Could not read the feed items a stopped run of ${data.kinds.join(", ")} left unwritten: ${error}`,
      );
      return;
    }

    for (const notification of notifications) {
      const attributes: LogAttributes = {
        projectId: notification.projectId.toString(),
        ownerNotificationKind: notification.kind,
        resourceId: notification.resourceId.toString(),
        eventId: notification.eventId.toString(),
      };

      try {
        const rows: Array<OwnerNotificationDeliveryRow> =
          await OwnerNotificationDeliveryService.takeUpFeedItemLeftUnwritten({
            event: notification,
            attemptedBefore: data.attemptedBefore,
            at: data.now,
          });

        // Another run took it up first, or one is still at it.
        if (rows.length === 0) {
          continue;
        }

        const told: Array<OwnerNotificationDeliveryRow> = rows.filter(
          (row: OwnerNotificationDeliveryRow): boolean => {
            return row.status === OwnerNotificationDeliveryStatus.Sent;
          },
        );

        const isExhausted: boolean = rows.some(
          (row: OwnerNotificationDeliveryRow): boolean => {
            return row.attempts > this.ATTEMPTS_AT_MOST;
          },
        );

        if (isExhausted || told.length === 0) {
          await OwnerNotificationDeliveryService.settleFeedItem({
            event: notification,
            feedStatus: OwnerNotificationFeedStatus.NotWritten,
            at: data.now,
          });

          if (isExhausted) {
            logger.error(
              `Gave up writing the feed item of ${notification.kind} ${notification.eventId.toString()}: each of the ${this.ATTEMPTS_AT_MOST} runs that set out to notify its owners stopped before it was written.`,
              attributes,
            );
          }

          continue;
        }

        logger.warn(
          `A run of the owner notifications stopped after telling the owners of ${notification.kind} ${notification.eventId.toString()} and before writing its feed item: writing it, naming the ${told.length} owner(s) it told.`,
          attributes,
        );

        const delivery: OwnerNotificationDelivery = await this.deliveryOf({
          notification: notification,
          isProjectOwners: rows.every(
            (row: OwnerNotificationDeliveryRow): boolean => {
              return row.isProjectOwner;
            },
          ),
          toTell: [],
          rows: rows,
          known: [],
          isFeedLeftUnwritten: true,
        });

        await data.notify(delivery);
      } catch (error) {
        logger.error(
          `Writing the feed item a stopped run left unwritten of ${notification.kind} ${notification.eventId.toString()} failed: ${error}. A later run tries again.`,
          attributes,
        );
        logger.error(error, attributes);
      }
    }
  }

  /*
   * The delivery of a notification whose rows are `rows`, telling the
   * owners of `toTell`: each owner's user taken from `known` when it is
   * there, read otherwise. An owner whose user is gone is not told.
   */
  private static async deliveryOf(data: {
    notification: OwnerNotificationEvent;
    isProjectOwners: boolean;
    toTell: Array<OwnerNotificationDeliveryRow>;
    rows: Array<OwnerNotificationDeliveryRow>;
    known: Array<User>;
    isFeedLeftUnwritten: boolean;
  }): Promise<OwnerNotificationDelivery> {
    const told: Array<OwnerNotificationDeliveryRow> = data.rows.filter(
      (row: OwnerNotificationDeliveryRow): boolean => {
        return row.status === OwnerNotificationDeliveryStatus.Sent;
      },
    );

    const users: Map<string, User> = new Map<string, User>();

    for (const user of data.known) {
      users.set(userKey(user), user);
    }

    const toRead: Array<ObjectID> = [...data.toTell, ...told]
      .map((row: OwnerNotificationDeliveryRow): ObjectID => {
        return row.userId;
      })
      .filter((userId: ObjectID): boolean => {
        return !users.has(userId.toString().toLowerCase());
      });

    if (toRead.length > 0) {
      for (const user of await this.readUsers(toRead)) {
        users.set(userKey(user), user);
      }
    }

    // In the order the owners were given, then the order their rows were written.
    const order: Map<string, number> = new Map<string, number>();

    data.known.forEach((user: User, index: number): void => {
      order.set(userKey(user), index);
    });

    const inOrder: (
      rows: Array<OwnerNotificationDeliveryRow>,
    ) => Array<OwnerNotificationDeliveryRow> = (
      rows: Array<OwnerNotificationDeliveryRow>,
    ): Array<OwnerNotificationDeliveryRow> => {
      return rows
        .map((row: OwnerNotificationDeliveryRow, index: number) => {
          const key: string = row.userId.toString().toLowerCase();
          return {
            row: row,
            rank: order.has(key) ? order.get(key)! : data.known.length + index,
          };
        })
        .sort((a: { rank: number }, b: { rank: number }): number => {
          return a.rank - b.rank;
        })
        .map((each: { row: OwnerNotificationDeliveryRow }) => {
          return each.row;
        });
    };

    const owners: Array<OwnerToTellNow> = [];
    const gone: Array<ObjectID> = [];

    for (const row of inOrder(data.toTell)) {
      const user: User | undefined = users.get(
        row.userId.toString().toLowerCase(),
      );

      if (!user) {
        gone.push(row.id);
        continue;
      }

      owners.push({ user: user, rowId: row.id });
    }

    if (gone.length > 0) {
      logger.warn(
        `Not telling ${gone.length} owner(s) of ${data.notification.kind} ${data.notification.eventId.toString()}: their user is gone.`,
        { projectId: data.notification.projectId.toString() } as LogAttributes,
      );

      try {
        await OwnerNotificationDeliveryService.giveUpTelling(
          gone,
          OneUptimeDate.getCurrentDate(),
        );
      } catch (error) {
        logger.error(
          `Could not record that ${gone.length} owner(s) whose user is gone are not told: ${error}.`,
          {
            projectId: data.notification.projectId.toString(),
          } as LogAttributes,
        );
      }
    }

    return new OwnerNotificationDelivery({
      notification: data.notification,
      isProjectOwners: data.isProjectOwners,
      owners: owners,
      // Alike on every row of the notification.
      feedStatus:
        data.rows.find((row: OwnerNotificationDeliveryRow): boolean => {
          return row.feedStatus === OwnerNotificationFeedStatus.Pending;
        })?.feedStatus || null,
      isFeedLeftUnwritten: data.isFeedLeftUnwritten,
      toldEarlier: inOrder(told)
        .map((row: OwnerNotificationDeliveryRow): User | undefined => {
          return users.get(row.userId.toString().toLowerCase());
        })
        .filter((user: User | undefined): user is User => {
          return Boolean(user);
        }),
    });
  }

  // The owners' users, as the owner notification jobs read them.
  private static async readUsers(
    userIds: Array<ObjectID>,
  ): Promise<Array<User>> {
    return await UserService.findBy({
      query: {
        _id: QueryHelper.any(userIds),
      },
      select: {
        _id: true,
        name: true,
        email: true,
        timezone: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }
}

function toEvent(notification: OwnerNotificationOf): OwnerNotificationEvent {
  return {
    kind: notification.kind,
    projectId: notification.projectId,
    resourceId: notification.resourceId,
    eventId: notification.eventId,
    occurrence: notification.occurrence ?? 1,
  };
}

function userKey(user: User): string {
  return (user.id?.toString() || "").toLowerCase();
}

// Each user once, the first time it is named; a user with no id is no owner.
function onceEach(users: Array<User>): Array<User> {
  const seen: Set<string> = new Set<string>();

  return users.filter((user: User): boolean => {
    const key: string = userKey(user);

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
