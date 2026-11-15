import User from "../../../Models/DatabaseModels/User";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import {
  OwnerNotificationDeliveryStatus,
  OwnerNotificationKind,
} from "../../../Types/Notification/OwnerNotificationDelivery";
import ObjectID from "../../../Types/ObjectID";
import OwnerNotificationDeliveryService, {
  OwnerNotificationDeliveryRow,
  OwnerNotificationEvent,
} from "../../Services/OwnerNotificationDeliveryService";
import UserService from "../../Services/UserService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";

/*
 * EVERY OWNER TOLD ONCE, HOWEVER THE WORKER STOPS (issue #8199).
 *
 * An owner notification job (IncidentOwners, AlertOwners) takes the record
 * it tells the owners of - marks the incident created, the state change,
 * the note, the owner row as notified, or moves a reminder on - so that a
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
 */

// Which notification: as OwnerNotificationEvent, with the occurrence left to 1.
export interface OwnerNotificationOf {
  kind: OwnerNotificationKind;
  projectId: ObjectID;
  // The incident or alert the owners are told of.
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

  private readonly toTell: Map<string, OwnerToTellNow>;
  private setOutToTell: number = 0;

  public constructor(data: {
    notification: OwnerNotificationEvent;
    isProjectOwners: boolean;
    owners: Array<OwnerToTellNow>;
    toldEarlier: Array<User>;
  }) {
    this.notification = data.notification;
    this.isProjectOwners = data.isProjectOwners;
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
   * The owners this run has not set out to tell yet are not told: their
   * notification can no longer reach them (the record it is about is gone).
   * Never throws.
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

    if (owners.length === 0) {
      return;
    }

    logger.warn(
      `Not telling ${owners.length} owner(s) of ${this.describe()}: ${reason}.`,
      this.logAttributes(),
    );

    try {
      await OwnerNotificationDeliveryService.giveUpTelling(rowIds);
    } catch (error) {
      logger.error(
        `Could not record that ${owners.length} owner(s) of ${this.describe()} are not told: ${error}.`,
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
        await OwnerNotificationDeliveryService.giveUpTelling(gone);
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
