import { jest } from "@jest/globals";
import User from "../../Models/DatabaseModels/User";
import OwnerNotificationDeliveryService, {
  OwnerNotificationDeliveryRow,
  OwnerNotificationEvent,
  OwnerToTell,
} from "../../Server/Services/OwnerNotificationDeliveryService";
import { JSONObject } from "../../Types/JSON";
import {
  OwnerNotificationDeliveryStatus,
  OwnerNotificationKind,
} from "../../Types/Notification/OwnerNotificationDelivery";
import ObjectID from "../../Types/ObjectID";

/*
 * THE OWNERNOTIFICATIONDELIVERY TABLE, IN MEMORY, FOR SUITES THAT RUN THE
 * OWNER NOTIFICATION JOBS (issue #8199).
 *
 * The jobs write who they are about to tell before they take a record, and
 * tell each owner through one statement that only one run can win
 * (OwnerNotificationDeliveries). Suites that drive the real jobs without a
 * database put this table in their place: each of the service's statements
 * is answered from rows held here, with what Postgres guarantees of it - one
 * row per notification and owner, an owner moved from to be told to being
 * told by one run alone, what a stopped run left taken up by one run alone.
 * OwnerNotificationDeliveryPostgres holds the real statements to the same.
 *
 * And it stops a run where a suite says, as a worker killed there would
 * stop: the statement never answers, so nothing after it in that run ever
 * happens (stopAt). A suite then runs the job again - the worker started
 * again - on the same rows.
 *
 * Call it in a beforeEach: the spies are restored with jest.restoreAllMocks.
 */

export interface InMemoryDeliveryRow {
  id: string;
  kind: OwnerNotificationKind;
  projectId: string;
  resourceId: string;
  eventId: string;
  occurrence: number;
  userId: string;
  isProjectOwner: boolean;
  status: OwnerNotificationDeliveryStatus;
  attempts: number;
  attemptedAt: Date;
  // The order the rows were written in.
  written: number;
}

export type DeliveryStatement =
  | "writeOwnersToTell"
  | "findRowsOf"
  | "startTelling"
  | "finishTelling"
  | "giveUpTelling"
  | "findLeftPartWay"
  | "takeUpLeftPartWay";

export interface DeliveryStopPoint {
  statement: DeliveryStatement;
  // startTelling and finishTelling only: the statement about this owner.
  userId?: string | undefined;
  /*
   * "before": the run stops as it sends the statement, which never reaches
   * the database. "after": the statement takes effect, and the run stops
   * before its answer comes back. Before, when left out.
   */
  when?: "before" | "after" | undefined;
}

export interface InMemoryOwnerNotificationDeliveries {
  rows: Array<InMemoryDeliveryRow>;
  // Each owner's status, of the notification whose record this is.
  statusesOf: (
    eventId: ObjectID | string,
    occurrence?: number,
  ) => Record<string, OwnerNotificationDeliveryStatus>;
  /*
   * The next run to send the statement stops there for good: it is never
   * answered, as a worker killed then never hears back. Once.
   */
  stopAt: (point: DeliveryStopPoint) => void;
  // How many runs have stopped at a stop point.
  stops: () => number;
  // The statement refuses, as a database that cannot be reached does.
  failWith: (statement: DeliveryStatement, error: Error | null) => void;
  /*
   * Every statement waits for the other runs going at the same moment
   * before it takes effect, so two runs of a job interleave as two workers
   * would.
   */
  interleave: (isOn: boolean) => void;
  // The statements sent, in order, with the owner each was about.
  statements: Array<{ statement: DeliveryStatement; userId?: string }>;
}

const NEVER: Promise<never> = new Promise<never>(() => {
  // A stopped worker hears nothing back.
});

function key(value: ObjectID | string): string {
  return value.toString().toLowerCase();
}

function sameNotification(
  row: InMemoryDeliveryRow,
  event: OwnerNotificationEvent,
): boolean {
  return (
    row.kind === event.kind &&
    row.eventId === key(event.eventId) &&
    row.occurrence === event.occurrence
  );
}

function toRow(row: InMemoryDeliveryRow): OwnerNotificationDeliveryRow {
  return {
    id: new ObjectID(row.id),
    userId: new ObjectID(row.userId),
    isProjectOwner: row.isProjectOwner,
    status: row.status,
    attempts: row.attempts,
    attemptedAt: new Date(row.attemptedAt.getTime()),
  };
}

export function useInMemoryOwnerNotificationDeliveries(): InMemoryOwnerNotificationDeliveries {
  const rows: Array<InMemoryDeliveryRow> = [];
  const statements: Array<{ statement: DeliveryStatement; userId?: string }> =
    [];
  const failures: Map<DeliveryStatement, Error> = new Map();
  let stopPoints: Array<DeliveryStopPoint> = [];
  let stopped: number = 0;
  let isInterleaving: boolean = false;
  let written: number = 0;

  const userOfRow: (id: ObjectID | string) => string | undefined = (
    id: ObjectID | string,
  ): string | undefined => {
    return rows.find((row: InMemoryDeliveryRow): boolean => {
      return row.id === key(id);
    })?.userId;
  };

  /*
   * Sends one statement: waits its turn when interleaving, stops where a
   * stop point says, and otherwise takes effect at once - one statement is
   * one moment, as it is in the database.
   */
  const send: <T>(
    statement: DeliveryStatement,
    userId: string | undefined,
    effect: () => T,
  ) => Promise<T> = async <T>(
    statement: DeliveryStatement,
    userId: string | undefined,
    effect: () => T,
  ): Promise<T> => {
    statements.push({ statement, ...(userId ? { userId } : {}) });

    if (isInterleaving) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }

    const failure: Error | undefined = failures.get(statement);

    if (failure) {
      throw failure;
    }

    const point: DeliveryStopPoint | undefined = stopPoints.find(
      (each: DeliveryStopPoint): boolean => {
        return (
          each.statement === statement &&
          (each.userId === undefined ||
            (userId !== undefined && key(each.userId) === userId))
        );
      },
    );

    if (point) {
      stopPoints = stopPoints.filter((each: DeliveryStopPoint): boolean => {
        return each !== point;
      });
      stopped++;

      if (point.when === "after") {
        effect();
      }

      return await NEVER;
    }

    return effect();
  };

  const rowsOf: (
    event: OwnerNotificationEvent,
  ) => Array<OwnerNotificationDeliveryRow> = (
    event: OwnerNotificationEvent,
  ): Array<OwnerNotificationDeliveryRow> => {
    return rows
      .filter((row: InMemoryDeliveryRow): boolean => {
        return sameNotification(row, event);
      })
      .sort((a: InMemoryDeliveryRow, b: InMemoryDeliveryRow): number => {
        return a.written - b.written;
      })
      .map(toRow);
  };

  jest
    .spyOn(OwnerNotificationDeliveryService, "writeOwnersToTell")
    .mockImplementation(
      async (data: {
        event: OwnerNotificationEvent;
        owners: Array<OwnerToTell>;
        at: Date;
      }): Promise<Array<OwnerNotificationDeliveryRow>> => {
        return await send("writeOwnersToTell", undefined, () => {
          for (const owner of data.owners) {
            const userId: string = key(owner.userId);

            const exists: boolean = rows.some(
              (row: InMemoryDeliveryRow): boolean => {
                return (
                  sameNotification(row, data.event) && row.userId === userId
                );
              },
            );

            if (exists) {
              continue;
            }

            rows.push({
              id: key(ObjectID.generate()),
              kind: data.event.kind,
              projectId: key(data.event.projectId),
              resourceId: key(data.event.resourceId),
              eventId: key(data.event.eventId),
              occurrence: data.event.occurrence,
              userId: userId,
              isProjectOwner: owner.isProjectOwner,
              status: OwnerNotificationDeliveryStatus.Pending,
              attempts: 1,
              attemptedAt: new Date(data.at.getTime()),
              written: written++,
            });
          }

          return rowsOf(data.event);
        });
      },
    );

  jest
    .spyOn(OwnerNotificationDeliveryService, "findRowsOf")
    .mockImplementation(
      async (
        event: OwnerNotificationEvent,
      ): Promise<Array<OwnerNotificationDeliveryRow>> => {
        return await send("findRowsOf", undefined, () => {
          return rowsOf(event);
        });
      },
    );

  jest
    .spyOn(OwnerNotificationDeliveryService, "startTelling")
    .mockImplementation(async (id: ObjectID): Promise<boolean> => {
      return await send("startTelling", userOfRow(id), () => {
        const row: InMemoryDeliveryRow | undefined = rows.find(
          (each: InMemoryDeliveryRow): boolean => {
            return (
              each.id === key(id) &&
              each.status === OwnerNotificationDeliveryStatus.Pending
            );
          },
        );

        if (!row) {
          return false;
        }

        row.status = OwnerNotificationDeliveryStatus.Sending;
        return true;
      });
    });

  jest
    .spyOn(OwnerNotificationDeliveryService, "finishTelling")
    .mockImplementation(
      async (data: {
        id: ObjectID;
        status:
          | OwnerNotificationDeliveryStatus.Sent
          | OwnerNotificationDeliveryStatus.Failed;
      }): Promise<boolean> => {
        return await send("finishTelling", userOfRow(data.id), () => {
          const row: InMemoryDeliveryRow | undefined = rows.find(
            (each: InMemoryDeliveryRow): boolean => {
              return (
                each.id === key(data.id) &&
                each.status === OwnerNotificationDeliveryStatus.Sending
              );
            },
          );

          if (!row) {
            return false;
          }

          row.status = data.status;
          return true;
        });
      },
    );

  jest
    .spyOn(OwnerNotificationDeliveryService, "giveUpTelling")
    .mockImplementation(
      async (
        ids: Array<ObjectID>,
      ): Promise<Array<OwnerNotificationDeliveryRow>> => {
        return await send("giveUpTelling", undefined, () => {
          const given: Array<string> = ids.map(key);
          const marked: Array<InMemoryDeliveryRow> = rows.filter(
            (row: InMemoryDeliveryRow): boolean => {
              return (
                given.includes(row.id) &&
                row.status === OwnerNotificationDeliveryStatus.Pending
              );
            },
          );

          for (const row of marked) {
            row.status = OwnerNotificationDeliveryStatus.Failed;
          }

          return marked.map(toRow);
        });
      },
    );

  jest
    .spyOn(OwnerNotificationDeliveryService, "findLeftPartWay")
    .mockImplementation(
      async (data: {
        kinds: Array<OwnerNotificationKind>;
        attemptedBefore: Date;
        limit: number;
      }): Promise<Array<OwnerNotificationEvent>> => {
        return await send("findLeftPartWay", undefined, () => {
          const groups: Map<
            string,
            { event: OwnerNotificationEvent; since: number }
          > = new Map();

          for (const row of rows) {
            if (
              row.status !== OwnerNotificationDeliveryStatus.Pending ||
              !data.kinds.includes(row.kind) ||
              row.attemptedAt.getTime() > data.attemptedBefore.getTime()
            ) {
              continue;
            }

            const groupKey: string = `${row.kind}|${row.eventId}|${row.occurrence}`;
            const group:
              | { event: OwnerNotificationEvent; since: number }
              | undefined = groups.get(groupKey);

            if (group) {
              group.since = Math.min(group.since, row.attemptedAt.getTime());
              continue;
            }

            groups.set(groupKey, {
              event: {
                kind: row.kind,
                projectId: new ObjectID(row.projectId),
                resourceId: new ObjectID(row.resourceId),
                eventId: new ObjectID(row.eventId),
                occurrence: row.occurrence,
              },
              since: row.attemptedAt.getTime(),
            });
          }

          return [...groups.values()]
            .sort((a: { since: number }, b: { since: number }): number => {
              return a.since - b.since;
            })
            .slice(0, data.limit)
            .map((group: { event: OwnerNotificationEvent }) => {
              return group.event;
            });
        });
      },
    );

  jest
    .spyOn(OwnerNotificationDeliveryService, "takeUpLeftPartWay")
    .mockImplementation(
      async (data: {
        event: OwnerNotificationEvent;
        attemptedBefore: Date;
        at: Date;
      }): Promise<Array<OwnerNotificationDeliveryRow>> => {
        return await send("takeUpLeftPartWay", undefined, () => {
          const takenUp: Array<InMemoryDeliveryRow> = rows.filter(
            (row: InMemoryDeliveryRow): boolean => {
              return (
                sameNotification(row, data.event) &&
                row.status === OwnerNotificationDeliveryStatus.Pending &&
                row.attemptedAt.getTime() <= data.attemptedBefore.getTime()
              );
            },
          );

          for (const row of takenUp) {
            row.attempts++;
            row.attemptedAt = new Date(data.at.getTime());
          }

          return takenUp
            .sort((a: InMemoryDeliveryRow, b: InMemoryDeliveryRow): number => {
              return a.written - b.written;
            })
            .map(toRow);
        });
      },
    );

  return {
    rows: rows,
    statusesOf: (
      eventId: ObjectID | string,
      occurrence?: number,
    ): Record<string, OwnerNotificationDeliveryStatus> => {
      const statuses: Record<string, OwnerNotificationDeliveryStatus> = {};

      for (const row of rows) {
        if (
          row.eventId === key(eventId) &&
          (occurrence === undefined || row.occurrence === occurrence)
        ) {
          statuses[row.userId] = row.status;
        }
      }

      return statuses;
    },
    stopAt: (point: DeliveryStopPoint): void => {
      stopPoints.push(point);
    },
    stops: (): number => {
      return stopped;
    },
    failWith: (statement: DeliveryStatement, error: Error | null): void => {
      if (error) {
        failures.set(statement, error);
      } else {
        failures.delete(statement);
      }
    },
    interleave: (isOn: boolean): void => {
      isInterleaving = isOn;
    },
    statements: statements,
  };
}

/*
 * What UserService.findBy answers the owners' users with, read back by the
 * runs that take up what a stopped run left: the users of `directory` its
 * query names by id (QueryHelper.any's values).
 */
export function usersNamedBy(
  directory: Array<User>,
  query: JSONObject,
): Array<User> {
  const value: unknown = query["_id"];
  const parameters: JSONObject | undefined = (
    value as { objectLiteralParameters?: JSONObject } | undefined
  )?.objectLiteralParameters;

  const ids: Array<string> = Object.values(parameters || {})
    .flatMap((entry: unknown): Array<unknown> => {
      return Array.isArray(entry) ? entry : [entry];
    })
    .map((entry: unknown): string => {
      return String(entry).toLowerCase();
    });

  return directory.filter((user: User): boolean => {
    return ids.includes((user.id?.toString() || "").toLowerCase());
  });
}
