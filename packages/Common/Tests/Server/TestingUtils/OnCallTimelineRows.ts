import { jest } from "@jest/globals";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import ObjectID from "../../../Types/ObjectID";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import { FindOperator } from "typeorm";

/*
 * ON-CALL NOTIFICATIONS (UserOnCallLogTimeline) HELD IN MEMORY, as the
 * senders, the providers' delivery reports, a page's failed request and the
 * stuck check reach them through OnCallNotificationStatus:
 *
 *   - findOneById reads a row as it is now, with its version;
 *   - updateOneBy names a row by id, at a status and a version, and lands
 *     only while the row still holds both - moving the version on, as
 *     Postgres does under DatabaseService's compare-and-set on the version;
 *   - findBy - stood in for only when asked (standIn's `find`) - reads the
 *     rows at a status, written within the createdAt window
 *     QueryHelper.inBetween names, not deleted, in createdAt order, as
 *     many as its limit: the stuck check's read (OnCallStuckNotifications).
 *     A condition it cannot read throws, so a changed read fails loudly.
 *   - the statement that settles the notifications written before the
 *     check's look-back straight to the table - stood in for only when
 *     asked (standIn's `settleStatement`), through the service's
 *     getRepository - reads the page as it says: the rows still Sending,
 *     not deleted, written before its cut-off, oldest first, as many as its
 *     limit; then writes Error and its message over each that still says
 *     Sending, moving the version on (settleNotificationsStuckBeforeTheCheck).
 *     A statement that does not say so throws.
 *
 * What landed is kept, in order (writes). A test can make something land
 * between a read and the write that follows it (whenRead): the person
 * acknowledging the page meanwhile, say.
 *
 * A caller that reads the notification whole first - with its user, its
 * record and its run: the acknowledge routes, a custom channel's actions -
 * is handed the model it reads, and writes to it through
 * updateNotificationWhileStill: the same compare-and-set, on that model.
 *
 * Used by Common's suites and App's (Common/Tests/Server/TestingUtils).
 */

export interface StoredOnCallNotification {
  status: UserNotificationStatus | null;
  statusMessage?: string | undefined;
  version: number;
  createdAt?: Date | undefined;
  deletedAt?: Date | undefined;
  // Written with an acknowledgement (OnCallNotificationStatus.recordAcknowledgement).
  isAcknowledged?: boolean | undefined;
  acknowledgedAt?: Date | undefined;
}

export interface OnCallNotificationWrite {
  id: string;
  data: {
    status?: UserNotificationStatus | undefined;
    statusMessage?: string | undefined;
    // Only when the write names them: an acknowledgement.
    isAcknowledged?: boolean | undefined;
    acknowledgedAt?: Date | undefined;
  };
}

export interface UpdateOneByInput {
  query: Record<string, unknown>;
  data: Record<string, unknown>;
}

export interface FindByInput {
  query: Record<string, unknown>;
  sort?: Record<string, unknown> | undefined;
  limit?: number | undefined;
  skip?: number | undefined;
}

// The reads and writes OnCallNotificationStatus makes, on the service.
interface TimelineService {
  findOneById: unknown;
  updateOneBy: unknown;
  findBy?: unknown;
  getRepository?: unknown;
}

// The statement that settles the notifications before the look-back, as sent.
export interface SettleStatement {
  sql: string;
  // The cut-off, how many a statement settles, and the message it writes.
  parameters: [Date, number, string];
}

// What the statement answers: how many its page found, and how many it wrote.
export interface SettleStatementAnswer {
  found: string;
  settled: string;
}

// The table the repository a stand-in hands out names.
export const ON_CALL_TIMELINE_TABLE_NAME: string = "UserOnCallLogTimeline";

/*
 * What the statement has to say, whitespace aside, for the stand-in to run
 * it: its page - Sending, not deleted, before the cut-off, the oldest
 * first, at most the limit - and its write - Error and the message, over
 * Sending only, before the same cut-off. Anything else throws, so a changed
 * statement fails loudly.
 */
export const SETTLE_STATEMENT_CLAUSES: ReadonlyArray<string> = [
  `SELECT "_id" FROM "${ON_CALL_TIMELINE_TABLE_NAME}" WHERE "status" = '${UserNotificationStatus.Sending}' AND "deletedAt" IS NULL AND "createdAt" < $1 ORDER BY "createdAt" ASC LIMIT $2`,
  `UPDATE "${ON_CALL_TIMELINE_TABLE_NAME}" AS "notification" SET "status" = '${UserNotificationStatus.Error}', "statusMessage" = $3, "version" = "notification"."version" + 1`,
  `WHERE "notification"."_id" = "page"."_id" AND "notification"."status" = '${UserNotificationStatus.Sending}' AND "notification"."deletedAt" IS NULL AND "notification"."createdAt" < $1`,
];

// Any run of whitespace, read as one space.
const WHITESPACE_RUN: RegExp = /\s+/g;

/*
 * An update by query, on one notification read whole (a model a test hands
 * its caller's findOneById): it lands only while the notification still
 * holds the status and the version the query names - as Postgres does
 * under DatabaseService's compare-and-set - writing what the update names
 * and moving the version on. A query naming another notification writes
 * nothing; a model with no id stands for whichever one is asked for. How
 * many rows it wrote, as updateOneBy answers.
 */
export function updateNotificationWhileStill(
  notification: UserOnCallLogTimeline,
  updateBy: UpdateOneByInput,
): number {
  if (notification._id && String(updateBy.query["_id"]) !== notification._id) {
    return 0;
  }

  if (
    "status" in updateBy.query &&
    notification.status !== updateBy.query["status"]
  ) {
    return 0;
  }

  if (
    "version" in updateBy.query &&
    notification.version !== updateBy.query["version"]
  ) {
    return 0;
  }

  Object.assign(notification, updateBy.data);
  notification.version = (notification.version || 0) + 1;

  return 1;
}

/*
 * The two dates a createdAt condition of QueryHelper.inBetween names:
 * `(createdAt >= :a and createdAt <= :b)`. Throws for any other condition.
 */
export function readCreatedAtBetween(condition: unknown): {
  from: Date;
  to: Date;
} {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  if (
    !(operator instanceof FindOperator) ||
    operator.type !== "raw" ||
    !operator.getSql ||
    !operator.objectLiteralParameters
  ) {
    throw new Error(
      `OnCallTimelineRows: a createdAt condition it cannot read: ${String(condition)}`,
    );
  }

  const sql: string = operator.getSql("createdAt");
  const betweenPattern: RegExp =
    /^\(createdAt >= :(\w+) and createdAt <= :(\w+)\)$/;
  const between: RegExpExecArray | null = betweenPattern.exec(sql);

  if (!between) {
    throw new Error(
      `OnCallTimelineRows: a createdAt condition it cannot read: ${sql}`,
    );
  }

  const parameters: Record<string, unknown> = operator.objectLiteralParameters;

  return {
    from: parameters[between[1]!] as Date,
    to: parameters[between[2]!] as Date,
  };
}

export default class OnCallTimelineRows {
  public readonly rows: Map<string, StoredOnCallNotification> = new Map<
    string,
    StoredOnCallNotification
  >();

  public readonly writes: Array<OnCallNotificationWrite> = [];

  // The settling statements run, in order (settleStatement).
  public readonly settleStatements: Array<SettleStatement> = [];

  private readonly afterReads: Array<(row: StoredOnCallNotification) => void> =
    [];

  // A notification, as written when its page went out.
  public add(
    id: ObjectID,
    status: UserNotificationStatus | null,
    data?: {
      statusMessage?: string | undefined;
      createdAt?: Date | undefined;
      deletedAt?: Date | undefined;
    },
  ): StoredOnCallNotification {
    const row: StoredOnCallNotification = {
      status: status,
      version: 1,
      ...(data?.statusMessage !== undefined
        ? { statusMessage: data.statusMessage }
        : {}),
      ...(data?.createdAt ? { createdAt: data.createdAt } : {}),
      ...(data?.deletedAt ? { deletedAt: data.deletedAt } : {}),
    };
    this.rows.set(id.toString(), row);
    return row;
  }

  public get(id: ObjectID): StoredOnCallNotification | undefined {
    return this.rows.get(id.toString());
  }

  /*
   * Runs `change` on the row right after the next read of it hands back
   * what it held: a write that lands between that read and the write that
   * follows it. The change moves the row's version on, as any write does.
   */
  public whenRead(change: (row: StoredOnCallNotification) => void): void {
    this.afterReads.push((row: StoredOnCallNotification): void => {
      change(row);
      row.version++;
    });
  }

  // A read: the row as it is now, as the select returns it.
  public read(input: { id: ObjectID }): UserOnCallLogTimeline | null {
    const row: StoredOnCallNotification | undefined = this.rows.get(
      input.id.toString(),
    );

    if (!row) {
      return null;
    }

    const notification: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    notification.id = new ObjectID(input.id.toString());
    notification.version = row.version;

    if (row.status !== null) {
      notification.status = row.status;
    }

    if (row.statusMessage !== undefined) {
      notification.statusMessage = row.statusMessage;
    }

    const afterRead: ((row: StoredOnCallNotification) => void) | undefined =
      this.afterReads.shift();

    if (afterRead) {
      afterRead(row);
    }

    return notification;
  }

  /*
   * An update by query: lands only while the row holds the status and the
   * version the query names, as one UPDATE ... WHERE would. How many rows
   * it wrote.
   */
  public update(input: UpdateOneByInput): number {
    const id: string = String(input.query["_id"]);
    const row: StoredOnCallNotification | undefined = this.rows.get(id);

    if (!row) {
      return 0;
    }

    if ("status" in input.query && row.status !== input.query["status"]) {
      return 0;
    }

    if ("version" in input.query && row.version !== input.query["version"]) {
      return 0;
    }

    const data: OnCallNotificationWrite["data"] = {};

    if (input.data["status"] !== undefined) {
      row.status = input.data["status"] as UserNotificationStatus;
      data.status = row.status;
    }

    if (input.data["statusMessage"] !== undefined) {
      row.statusMessage = input.data["statusMessage"] as string;
      data.statusMessage = row.statusMessage;
    }

    if (input.data["isAcknowledged"] !== undefined) {
      row.isAcknowledged = input.data["isAcknowledged"] as boolean;
      data.isAcknowledged = row.isAcknowledged;
    }

    if (input.data["acknowledgedAt"] !== undefined) {
      row.acknowledgedAt = input.data["acknowledgedAt"] as Date;
      data.acknowledgedAt = row.acknowledgedAt;
    }

    row.version++;
    this.writes.push({ id: id, data: data });

    return 1;
  }

  /*
   * A read of several: the rows at the status named, written within the
   * createdAt window named, not deleted - TypeORM leaves deleted rows out
   * of every read - sorted by createdAt, from `skip`, at most `limit`.
   * Only the ids are returned, as the stuck check selects them.
   */
  public find(input: FindByInput): Array<UserOnCallLogTimeline> {
    const knownConditions: Array<string> = ["status", "createdAt"];

    for (const key of Object.keys(input.query)) {
      if (!knownConditions.includes(key)) {
        throw new Error(
          `OnCallTimelineRows: a condition it cannot read: ${key}`,
        );
      }
    }

    const window: { from: Date; to: Date } | null =
      input.query["createdAt"] === undefined
        ? null
        : readCreatedAtBetween(input.query["createdAt"]);

    const found: Array<[string, StoredOnCallNotification]> = [
      ...this.rows.entries(),
    ].filter(([, row]: [string, StoredOnCallNotification]) => {
      if (row.deletedAt) {
        return false;
      }

      if ("status" in input.query && row.status !== input.query["status"]) {
        return false;
      }

      if (window) {
        if (!row.createdAt) {
          return false;
        }

        const createdAt: number = row.createdAt.getTime();

        if (
          createdAt < window.from.getTime() ||
          createdAt > window.to.getTime()
        ) {
          return false;
        }
      }

      return true;
    });

    const order: unknown = input.sort?.["createdAt"];

    if (order !== undefined) {
      found.sort(
        (
          [, a]: [string, StoredOnCallNotification],
          [, b]: [string, StoredOnCallNotification],
        ) => {
          const difference: number =
            (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0);

          return order === "DESC" ? -difference : difference;
        },
      );
    }

    const skip: number = input.skip || 0;
    const limit: number =
      input.limit === undefined ? found.length : input.limit;

    return found
      .slice(skip, skip + limit)
      .map(([id]: [string, StoredOnCallNotification]) => {
        const notification: UserOnCallLogTimeline = new UserOnCallLogTimeline();
        notification.id = new ObjectID(id);
        return notification;
      });
  }

  /*
   * The statement that settles the notifications written before the
   * check's look-back, as it says (see above): what its page found and what
   * it wrote, as Postgres hands COUNT(*) back - as text.
   */
  public settleStatement(
    sql: string,
    parameters: unknown,
  ): Array<SettleStatementAnswer> {
    const said: string = sql.replace(WHITESPACE_RUN, " ");

    for (const clause of SETTLE_STATEMENT_CLAUSES) {
      if (!said.includes(clause)) {
        throw new Error(
          `OnCallTimelineRows: a statement it cannot read, without: ${clause}`,
        );
      }
    }

    const [writtenBefore, limit, statusMessage] = parameters as [
      Date,
      number,
      string,
    ];

    if (
      !(writtenBefore instanceof Date) ||
      typeof limit !== "number" ||
      typeof statusMessage !== "string"
    ) {
      throw new Error(
        `OnCallTimelineRows: a statement's parameters it cannot read: ${String(parameters)}`,
      );
    }

    this.settleStatements.push({
      sql: sql,
      parameters: [writtenBefore, limit, statusMessage],
    });

    const page: Array<[string, StoredOnCallNotification]> = [
      ...this.rows.entries(),
    ]
      .filter(([, row]: [string, StoredOnCallNotification]) => {
        return (
          row.status === UserNotificationStatus.Sending &&
          !row.deletedAt &&
          row.createdAt !== undefined &&
          row.createdAt.getTime() < writtenBefore.getTime()
        );
      })
      .sort(
        (
          [, a]: [string, StoredOnCallNotification],
          [, b]: [string, StoredOnCallNotification],
        ) => {
          return (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0);
        },
      )
      .slice(0, limit);

    let settled: number = 0;

    for (const [id, row] of page) {
      if (row.status !== UserNotificationStatus.Sending || row.deletedAt) {
        continue;
      }

      row.status = UserNotificationStatus.Error;
      row.statusMessage = statusMessage;
      row.version++;
      settled++;

      this.writes.push({
        id: id,
        data: { status: row.status, statusMessage: row.statusMessage },
      });
    }

    return [{ found: String(page.length), settled: String(settled) }];
  }

  /*
   * Puts the rows behind the service's findOneById and updateOneBy - and,
   * with `find`, findBy; with `settleStatement`, getRepository, whose
   * manager runs the settling statement: its own jest.fn()s when the
   * service is a jest.mock of it, spies on the real one otherwise.
   */
  public standIn(
    service: TimelineService,
    options?: { find?: boolean; settleStatement?: boolean },
  ): void {
    const methods: Partial<
      Record<keyof TimelineService, (input: never) => unknown>
    > = {
      findOneById: (input: { id: ObjectID }): Promise<unknown> => {
        return Promise.resolve(this.read(input));
      },
      updateOneBy: (input: UpdateOneByInput): Promise<number> => {
        return Promise.resolve(this.update(input));
      },
      ...(options?.find
        ? {
            findBy: (
              input: FindByInput,
            ): Promise<Array<UserOnCallLogTimeline>> => {
              return Promise.resolve(this.find(input));
            },
          }
        : {}),
      ...(options?.settleStatement
        ? {
            getRepository: (): unknown => {
              return {
                metadata: { tableName: ON_CALL_TIMELINE_TABLE_NAME },
                manager: {
                  query: (
                    sql: string,
                    parameters: unknown,
                  ): Promise<Array<SettleStatementAnswer>> => {
                    return Promise.resolve(
                      this.settleStatement(sql, parameters),
                    );
                  },
                },
              };
            },
          }
        : {}),
    };

    for (const name of Object.keys(methods) as Array<keyof TimelineService>) {
      const existing: unknown = service[name];

      if (jest.isMockFunction(existing)) {
        existing.mockImplementation(methods[name] as never);
        continue;
      }

      jest
        .spyOn(service as unknown as Record<string, never>, name)
        .mockImplementation(methods[name] as never);
    }
  }
}
