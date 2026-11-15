import Entities from "../../../Models/DatabaseModels/Index";
import User from "../../../Models/DatabaseModels/User";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import OwnerNotificationDeliveryService, {
  OWNER_NOTIFICATION_DELIVERY_RETENTION_IN_DAYS,
  OwnerNotificationDeliveryRow,
  OwnerNotificationEvent,
} from "../../../Server/Services/OwnerNotificationDeliveryService";
import UserService from "../../../Server/Services/UserService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import logger from "../../../Server/Utils/Logger";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "../../../Server/Utils/Notification/OwnerNotificationDeliveries";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import {
  OwnerNotificationDeliveryStatus,
  OwnerNotificationKind,
} from "../../../Types/Notification/OwnerNotificationDelivery";
import ObjectID from "../../../Types/ObjectID";
import { usersNamedBy } from "../../Helpers/InMemoryOwnerNotificationDeliveries";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * WHO EACH OWNER NOTIFICATION TELLS, ON A REAL POSTGRES (issue #8199).
 *
 * The owner notification jobs of incidents and alerts write a row per owner
 * before they take their record, and tell each owner through statements
 * whose guarantees are their own (OwnerNotificationDeliveryService): one row
 * per notification and owner however often and however many runs write it,
 * one run alone moving an owner from to be told to being told, one run
 * alone taking up what a stopped run left. Here the real service runs them
 * against a copy of the migrated OwnerNotificationDelivery table, and the
 * races run on several connections at once; then the real
 * OwnerNotificationDeliveries is stopped part way and started again, and
 * two of it run at once, on the same rows. App's OwnerNotificationJobsPostgres
 * runs the real jobs on it.
 *
 * Opt in with RUN_POSTGRES_OWNER_NOTIFICATION_DELIVERY_TESTS=true and a
 * migrated database (OWNER_NOTIFICATION_DELIVERY_TEST_DATABASE_HOST, _PORT,
 * _NAME; DATABASE_USERNAME, DATABASE_PASSWORD). Every write is to a schema
 * of its own; only the table's structure is copied, never its rows.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_OWNER_NOTIFICATION_DELIVERY_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECT_ID: ObjectID = ObjectID.generate();
const INCIDENT_ID: ObjectID = ObjectID.generate();

function makeUser(): User {
  const user: User = new User(ObjectID.generate());
  user.name = new Name("An owner");
  user.email = new Email(`${user.id!.toString()}@acme.test`);
  return user;
}

function idOf(user: User): string {
  return user.id!.toString();
}

const NEVER: Promise<never> = new Promise<never>(() => {
  // a stopped worker hears nothing back
});

describePostgres("who each owner notification tells, against Postgres", () => {
  const schema: string = `owner_delivery_test_${ObjectID.generate().toString().replace(/-/g, "")}`;
  let database: DataSource;
  let directory: Array<User> = [];

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["OWNER_NOTIFICATION_DELIVERY_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["OWNER_NOTIFICATION_DELIVERY_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["OWNER_NOTIFICATION_DELIVERY_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      // Several connections: the races below run their statements side by side.
      extra: { options: `-c search_path=${schema},public`, max: 6 },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."OwnerNotificationDelivery" (LIKE public."OwnerNotificationDelivery" INCLUDING ALL)`,
    );

    const currentSchema: Array<{ current_schema: string }> =
      await database.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    await database.query(`DELETE FROM "${schema}"."OwnerNotificationDelivery"`);
    directory = [];

    jest.spyOn(logger, "warn").mockImplementation((() => {
      // quiet
    }) as never);
    jest.spyOn(logger, "error").mockImplementation((() => {
      // quiet
    }) as never);
    jest.spyOn(UserService, "findBy").mockImplementation((async (data: {
      query: JSONObject;
    }) => {
      return usersNamedBy(directory, data.query);
    }) as never);
  });

  function notification(
    overrides: Partial<OwnerNotificationEvent> = {},
  ): OwnerNotificationEvent {
    return {
      kind: OwnerNotificationKind.IncidentCreated,
      projectId: PROJECT_ID,
      resourceId: INCIDENT_ID,
      eventId: INCIDENT_ID,
      occurrence: 1,
      ...overrides,
    };
  }

  function owners(count: number): Array<User> {
    const made: Array<User> = [];

    for (let index: number = 0; index < count; index++) {
      made.push(makeUser());
    }

    directory.push(...made);
    return made;
  }

  async function rowsOf(
    event: OwnerNotificationEvent,
  ): Promise<Array<Record<string, unknown>>> {
    return await database.query(
      `SELECT "userId", "status", "attempts", "attemptedAt", "isProjectOwner", "projectId", "resourceId", "version" FROM "${schema}"."OwnerNotificationDelivery" WHERE "kind" = $1 AND "eventId" = $2 AND "occurrence" = $3 ORDER BY "createdAt"`,
      [event.kind, event.eventId.toString(), event.occurrence],
    );
  }

  async function statusesOf(
    event: OwnerNotificationEvent,
  ): Promise<Record<string, string>> {
    const statuses: Record<string, string> = {};

    for (const row of await rowsOf(event)) {
      statuses[String(row["userId"])] = String(row["status"]);
    }

    return statuses;
  }

  async function write(
    event: OwnerNotificationEvent,
    users: Array<User>,
    at: Date = new Date(),
    writesFeedItem: boolean = false,
  ): Promise<Array<OwnerNotificationDeliveryRow>> {
    return await OwnerNotificationDeliveryService.writeOwnersToTell({
      event: event,
      owners: users.map((user: User) => {
        return { userId: user.id!, isProjectOwner: false };
      }),
      at: at,
      writesFeedItem: writesFeedItem,
    });
  }

  test("is kept as the migration made it: its columns, one row per notification and owner, and an index of the owners still to be told only", async () => {
    const columns: Array<Record<string, unknown>> = await database.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'OwnerNotificationDelivery' ORDER BY column_name`,
      [schema],
    );

    const byName: Record<string, { type: string; nullable: string }> = {};

    for (const column of columns) {
      byName[String(column["column_name"])] = {
        type: String(column["data_type"]),
        nullable: String(column["is_nullable"]),
      };
    }

    expect(byName).toMatchObject({
      projectId: { type: "uuid", nullable: "NO" },
      kind: { type: "character varying", nullable: "NO" },
      resourceId: { type: "uuid", nullable: "NO" },
      eventId: { type: "uuid", nullable: "NO" },
      occurrence: { type: "integer", nullable: "NO" },
      userId: { type: "uuid", nullable: "NO" },
      isProjectOwner: { type: "boolean", nullable: "NO" },
      status: { type: "character varying", nullable: "NO" },
      attempts: { type: "integer", nullable: "NO" },
      attemptedAt: { type: "timestamp with time zone", nullable: "NO" },
    });

    const indexes: Array<{ indexdef: string }> = await database.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'OwnerNotificationDelivery'`,
      [schema],
    );
    // As Postgres prints them, with the quotes it needs left out.
    const definitions: Array<string> = indexes.map(
      (index: { indexdef: string }): string => {
        return index.indexdef.replace(/"/g, "");
      },
    );

    expect(
      definitions.some((definition: string): boolean => {
        return (
          definition.includes("UNIQUE INDEX") &&
          definition.includes("(kind, eventId, occurrence, userId)")
        );
      }),
    ).toBe(true);
    expect(
      definitions.some((definition: string): boolean => {
        return (
          definition.includes("(kind, attemptedAt)") &&
          definition.includes("WHERE ((status)::text = 'Pending'::text)")
        );
      }),
    ).toBe(true);
  });

  test("writes a row per owner, to be told, once however often it is written", async () => {
    const [first, second, third] = owners(3);
    const at: Date = new Date("2026-11-15T10:00:00.123Z");

    const rows: Array<OwnerNotificationDeliveryRow> = await write(
      notification(),
      [first!, second!, first!],
      at,
    );

    expect(rows).toHaveLength(2);
    expect(
      rows.every((row: OwnerNotificationDeliveryRow): boolean => {
        return (
          row.status === OwnerNotificationDeliveryStatus.Pending &&
          row.attempts === 1 &&
          row.attemptedAt.getTime() === at.getTime() &&
          row.isProjectOwner === false
        );
      }),
    ).toBe(true);

    // Again, with one more: only the new one is written, and every row comes back.
    const again: Array<OwnerNotificationDeliveryRow> = await write(
      notification(),
      [second!, third!],
      new Date(at.getTime() + 60000),
    );

    expect(
      again
        .map((row: OwnerNotificationDeliveryRow): string => {
          return row.userId.toString();
        })
        .sort(),
    ).toEqual([idOf(first!), idOf(second!), idOf(third!)].sort());

    const stored: Array<Record<string, unknown>> = await rowsOf(notification());
    expect(stored).toHaveLength(3);
    expect(stored[0]!["projectId"]).toBe(PROJECT_ID.toString());
    expect(stored[0]!["resourceId"]).toBe(INCIDENT_ID.toString());
    expect(stored[0]!["version"]).toBe(1);

    // The first two keep when they were written.
    expect(
      stored
        .filter((row: Record<string, unknown>): boolean => {
          return String(row["userId"]) !== idOf(third!);
        })
        .every((row: Record<string, unknown>): boolean => {
          return (row["attemptedAt"] as Date).getTime() === at.getTime();
        }),
    ).toBe(true);
  });

  test("another kind, another reminder, another record: another notification", async () => {
    const [owner] = owners(1);

    await write(notification(), [owner!]);
    await write(
      notification({ kind: OwnerNotificationKind.IncidentReminder }),
      [owner!],
    );
    await write(
      notification({
        kind: OwnerNotificationKind.IncidentReminder,
        occurrence: 2,
      }),
      [owner!],
    );
    await write(notification({ eventId: ObjectID.generate() }), [owner!]);

    const count: Array<{ count: string }> = await database.query(
      `SELECT COUNT(*) AS "count" FROM "${schema}"."OwnerNotificationDelivery"`,
    );
    expect(Number(count[0]!.count)).toBe(4);
  });

  test("two runs writing the same owners at once write one row each, and neither fails", async () => {
    for (let round: number = 0; round < 10; round++) {
      const event: OwnerNotificationEvent = notification({
        eventId: ObjectID.generate(),
      });
      const people: Array<User> = owners(5);

      const results: Array<Array<OwnerNotificationDeliveryRow>> =
        await Promise.all([
          write(event, people),
          write(event, [...people].reverse()),
          write(event, people.slice(2)),
        ]);

      expect(await rowsOf(event)).toHaveLength(5);

      for (const result of results) {
        expect(result.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  test("one run alone moves an owner from to be told to being told, then told or not told", async () => {
    const [owner] = owners(1);
    const [row] = await write(notification(), [owner!]);

    // Told is reached only through being told.
    expect(
      await OwnerNotificationDeliveryService.finishTelling({
        id: row!.id,
        status: OwnerNotificationDeliveryStatus.Sent,
        at: new Date(),
      }),
    ).toBe(false);

    expect(await OwnerNotificationDeliveryService.startTelling(row!.id, new Date())).toBe(
      true,
    );
    expect(await OwnerNotificationDeliveryService.startTelling(row!.id, new Date())).toBe(
      false,
    );
    expect(await statusesOf(notification())).toEqual({
      [idOf(owner!)]: OwnerNotificationDeliveryStatus.Sending,
    });

    expect(
      await OwnerNotificationDeliveryService.finishTelling({
        id: row!.id,
        status: OwnerNotificationDeliveryStatus.Sent,
        at: new Date(),
      }),
    ).toBe(true);
    expect(
      await OwnerNotificationDeliveryService.finishTelling({
        id: row!.id,
        status: OwnerNotificationDeliveryStatus.Failed,
        at: new Date(),
      }),
    ).toBe(false);
    expect(await statusesOf(notification())).toEqual({
      [idOf(owner!)]: OwnerNotificationDeliveryStatus.Sent,
    });

    // A row that is gone is told by nobody.
    expect(
      await OwnerNotificationDeliveryService.startTelling(ObjectID.generate(), new Date()),
    ).toBe(false);
  });

  test("two runs starting to tell the same owner at once: one does", async () => {
    for (let round: number = 0; round < 20; round++) {
      const [owner] = owners(1);
      const [row] = await write(
        notification({ eventId: ObjectID.generate() }),
        [owner!],
      );

      const starts: Array<boolean> = await Promise.all([
        OwnerNotificationDeliveryService.startTelling(row!.id, new Date()),
        OwnerNotificationDeliveryService.startTelling(row!.id, new Date()),
        OwnerNotificationDeliveryService.startTelling(row!.id, new Date()),
      ]);

      expect(starts.filter(Boolean)).toHaveLength(1);
    }
  });

  test("giving up marks only the owners still to be told", async () => {
    const [told, beingTold, toBeTold] = owners(3);
    const rows: Array<OwnerNotificationDeliveryRow> = await write(
      notification(),
      [told!, beingTold!, toBeTold!],
    );

    const rowOf: (user: User) => OwnerNotificationDeliveryRow = (
      user: User,
    ): OwnerNotificationDeliveryRow => {
      return rows.find((row: OwnerNotificationDeliveryRow): boolean => {
        return row.userId.toString() === idOf(user);
      })!;
    };

    await OwnerNotificationDeliveryService.startTelling(rowOf(told!).id, new Date());
    await OwnerNotificationDeliveryService.finishTelling({
      id: rowOf(told!).id,
      status: OwnerNotificationDeliveryStatus.Sent,
      at: new Date(),
    });
    await OwnerNotificationDeliveryService.startTelling(rowOf(beingTold!).id, new Date());

    const givenUp: Array<OwnerNotificationDeliveryRow> =
      await OwnerNotificationDeliveryService.giveUpTelling(
        rows.map((row: OwnerNotificationDeliveryRow): ObjectID => {
          return row.id;
        }),
        new Date(),
      );

    expect(
      givenUp.map((row: OwnerNotificationDeliveryRow): string => {
        return row.userId.toString();
      }),
    ).toEqual([idOf(toBeTold!)]);
    expect(await statusesOf(notification())).toEqual({
      [idOf(told!)]: OwnerNotificationDeliveryStatus.Sent,
      [idOf(beingTold!)]: OwnerNotificationDeliveryStatus.Sending,
      [idOf(toBeTold!)]: OwnerNotificationDeliveryStatus.Failed,
    });
    expect(await OwnerNotificationDeliveryService.giveUpTelling([], new Date())).toEqual(
      [],
    );
  });

  test("reads the notifications a stopped run left: owners still to be told, of its kinds, not set out to be told since the time asked, the longest waiting first", async () => {
    const now: Date = new Date("2026-11-15T12:00:00.000Z");
    const minutesAgo: (minutes: number) => Date = (minutes: number): Date => {
      return new Date(now.getTime() - minutes * 60000);
    };

    const longest: OwnerNotificationEvent = notification({
      eventId: ObjectID.generate(),
    });
    const later: OwnerNotificationEvent = notification({
      eventId: ObjectID.generate(),
    });
    const tooRecent: OwnerNotificationEvent = notification({
      eventId: ObjectID.generate(),
    });
    const otherKind: OwnerNotificationEvent = notification({
      kind: OwnerNotificationKind.AlertCreated,
      eventId: ObjectID.generate(),
    });
    const everyoneTold: OwnerNotificationEvent = notification({
      eventId: ObjectID.generate(),
    });

    await write(longest, owners(2), minutesAgo(30));
    await write(later, owners(1), minutesAgo(10));
    await write(tooRecent, owners(1), minutesAgo(1));
    await write(otherKind, owners(1), minutesAgo(30));
    const [toldRow] = await write(everyoneTold, owners(1), minutesAgo(30));
    await OwnerNotificationDeliveryService.startTelling(toldRow!.id, new Date());

    const left: Array<OwnerNotificationEvent> =
      await OwnerNotificationDeliveryService.findLeftPartWay({
        kinds: [OwnerNotificationKind.IncidentCreated],
        attemptedBefore: minutesAgo(2),
        limit: 10,
      });

    expect(
      left.map((event: OwnerNotificationEvent): string => {
        return event.eventId.toString();
      }),
    ).toEqual([longest.eventId.toString(), later.eventId.toString()]);
    expect(left[0]).toEqual(longest);

    // At most as many as asked.
    expect(
      await OwnerNotificationDeliveryService.findLeftPartWay({
        kinds: [OwnerNotificationKind.IncidentCreated],
        attemptedBefore: minutesAgo(2),
        limit: 1,
      }),
    ).toEqual([longest]);

    // Of every kind asked.
    expect(
      (
        await OwnerNotificationDeliveryService.findLeftPartWay({
          kinds: [
            OwnerNotificationKind.IncidentCreated,
            OwnerNotificationKind.AlertCreated,
          ],
          attemptedBefore: minutesAgo(2),
          limit: 10,
        })
      ).length,
    ).toBe(3);

    expect(
      await OwnerNotificationDeliveryService.findLeftPartWay({
        kinds: [],
        attemptedBefore: minutesAgo(2),
        limit: 10,
      }),
    ).toEqual([]);
  });

  test("takes up what a stopped run left for one run alone, counting its attempt", async () => {
    const event: OwnerNotificationEvent = notification({
      eventId: ObjectID.generate(),
    });
    const people: Array<User> = owners(3);
    const writtenAt: Date = new Date("2026-11-15T10:00:00.000Z");
    const rows: Array<OwnerNotificationDeliveryRow> = await write(
      event,
      people,
      writtenAt,
    );

    // One of them is being told already: it is not taken up.
    await OwnerNotificationDeliveryService.startTelling(rows[0]!.id, new Date());

    const at: Date = new Date("2026-11-15T10:05:00.000Z");
    const attemptedBefore: Date = new Date("2026-11-15T10:03:00.000Z");

    const takenUp: Array<OwnerNotificationDeliveryRow> =
      await OwnerNotificationDeliveryService.takeUpLeftPartWay({
        event: event,
        attemptedBefore: attemptedBefore,
        at: at,
      });

    expect(takenUp).toHaveLength(2);
    expect(
      takenUp.every((row: OwnerNotificationDeliveryRow): boolean => {
        return row.attempts === 2 && row.attemptedAt.getTime() === at.getTime();
      }),
    ).toBe(true);

    // Taken up already: a second run asking the same finds nothing.
    expect(
      await OwnerNotificationDeliveryService.takeUpLeftPartWay({
        event: event,
        attemptedBefore: attemptedBefore,
        at: at,
      }),
    ).toEqual([]);
  });

  test("two runs taking up the same notification at once: one does", async () => {
    for (let round: number = 0; round < 20; round++) {
      const event: OwnerNotificationEvent = notification({
        eventId: ObjectID.generate(),
      });
      await write(event, owners(3), new Date("2026-11-15T10:00:00.000Z"));

      const at: Date = new Date("2026-11-15T10:05:00.000Z");
      const attemptedBefore: Date = new Date("2026-11-15T10:03:00.000Z");

      const takes: Array<Array<OwnerNotificationDeliveryRow>> =
        await Promise.all([
          OwnerNotificationDeliveryService.takeUpLeftPartWay({
            event,
            attemptedBefore,
            at,
          }),
          OwnerNotificationDeliveryService.takeUpLeftPartWay({
            event,
            attemptedBefore,
            at,
          }),
          OwnerNotificationDeliveryService.takeUpLeftPartWay({
            event,
            attemptedBefore,
            at,
          }),
        ]);

      expect(
        takes
          .map((take: Array<OwnerNotificationDeliveryRow>): number => {
            return take.length;
          })
          .sort(),
      ).toEqual([0, 0, 3]);
      expect(
        (await rowsOf(event)).every((row: Record<string, unknown>): boolean => {
          return row["attempts"] === 2;
        }),
      ).toBe(true);
    }
  });

  test("the read of what a stopped run left goes through the index of the owners still to be told", async () => {
    const queryRunner: ReturnType<DataSource["createQueryRunner"]> =
      database.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.query("SET enable_seqscan = off");

      const plan: Array<Record<string, string>> = await queryRunner.query(
        `EXPLAIN SELECT "kind", "projectId", "resourceId", "eventId", "occurrence" FROM "OwnerNotificationDelivery" WHERE "status" = 'Pending' AND "kind" = ANY($1::varchar[]) AND "attemptedAt" <= $2::timestamptz GROUP BY "kind", "projectId", "resourceId", "eventId", "occurrence"`,
        [[OwnerNotificationKind.IncidentCreated], new Date()],
      );
      const text: string = plan
        .map((row: Record<string, string>): string => {
          return Object.values(row).join(" ");
        })
        .join("\n");

      const indexes: Array<{ indexname: string }> = await queryRunner.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'OwnerNotificationDelivery' AND indexdef LIKE '%attemptedAt%'`,
        [schema],
      );

      expect(indexes).toHaveLength(1);
      expect(text).toContain(indexes[0]!.indexname);
    } finally {
      await queryRunner.release();
    }
  });

  test("rows past their retention are what the daily clean-up deletes", async () => {
    expect(OwnerNotificationDeliveryService.hardDeleteItemByColumnName).toBe(
      "createdAt",
    );
    expect(OwnerNotificationDeliveryService.hardDeleteItemsOlderThanDays).toBe(
      OWNER_NOTIFICATION_DELIVERY_RETENTION_IN_DAYS,
    );

    const old: OwnerNotificationEvent = notification({
      eventId: ObjectID.generate(),
    });
    const recent: OwnerNotificationEvent = notification({
      eventId: ObjectID.generate(),
    });
    await write(old, owners(2));
    await write(recent, owners(1));
    await database.query(
      `UPDATE "${schema}"."OwnerNotificationDelivery" SET "createdAt" = now() - interval '8 days' WHERE "eventId" = $1`,
      [old.eventId.toString()],
    );

    // As HardDelete:HardDeleteOlderItemsInDatabase asks it.
    await OwnerNotificationDeliveryService.hardDeleteBy({
      query: {
        createdAt: QueryHelper.lessThan(
          OneUptimeDate.getSomeDaysAgo(
            OwnerNotificationDeliveryService.hardDeleteItemsOlderThanDays,
          ),
        ),
      },
      props: {
        isRoot: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
    });

    expect(await rowsOf(old)).toEqual([]);
    expect(await rowsOf(recent)).toHaveLength(1);
  });

  describe("OwnerNotificationDeliveries, stopped part way and started again", () => {
    function minutesAfter(at: Date, minutes: number): Date {
      return new Date(at.getTime() + minutes * 60000);
    }

    // Tells every owner of a delivery, each send recorded in `sent`.
    async function tellEveryone(
      delivery: OwnerNotificationDelivery,
      sent: Array<string>,
      sendOf?: (user: User) => Promise<void>,
    ): Promise<void> {
      for (const owner of delivery.owners) {
        await delivery.tell(owner, async (): Promise<void> => {
          sent.push(idOf(owner));

          if (sendOf) {
            await sendOf(owner);
          }
        });
      }
    }

    function counts(sent: Array<string>): Record<string, number> {
      const byOwner: Record<string, number> = {};

      for (const userId of sent) {
        byOwner[userId] = (byOwner[userId] || 0) + 1;
      }

      return byOwner;
    }

    async function untilSent(
      sent: Array<string>,
      count: number,
    ): Promise<void> {
      for (let turn: number = 0; turn < 500; turn++) {
        if (sent.length >= count) {
          return;
        }

        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 5);
        });
      }

      throw new Error("The run never got as far as it was to stop.");
    }

    test("stopped in the second owner's send: the restarted worker tells the third, and never the second again", async () => {
      const people: Array<User> = owners(3);
      const started: Date = new Date();
      jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(started);

      const event: OwnerNotificationEvent = notification({
        eventId: ObjectID.generate(),
      });
      const sent: Array<string> = [];

      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.plan({
          notification: event,
          owners: people,
          isProjectOwners: false,
        });

      // The worker is killed in the second owner's send.
      void tellEveryone(delivery, sent, async (user: User): Promise<void> => {
        if (idOf(user) === idOf(people[1]!)) {
          await NEVER;
        }
      });
      await untilSent(sent, 2);

      expect(await statusesOf(event)).toEqual({
        [idOf(people[0]!)]: OwnerNotificationDeliveryStatus.Sent,
        [idOf(people[1]!)]: OwnerNotificationDeliveryStatus.Sending,
        [idOf(people[2]!)]: OwnerNotificationDeliveryStatus.Pending,
      });

      // Started again, minutes later.
      jest
        .spyOn(OneUptimeDate, "getCurrentDate")
        .mockReturnValue(
          minutesAfter(
            started,
            OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
          ),
        );

      const resumed: Array<OwnerNotificationDelivery> = [];

      await OwnerNotificationDeliveries.resume({
        kinds: [OwnerNotificationKind.IncidentCreated],
        notify: async (each: OwnerNotificationDelivery): Promise<void> => {
          if (
            each.notification.eventId.toString() !== event.eventId.toString()
          ) {
            return;
          }

          resumed.push(each);
          await tellEveryone(each, sent);
        },
      });

      expect(resumed).toHaveLength(1);
      expect(
        resumed[0]!.owners.map((user: User): string => {
          return idOf(user);
        }),
      ).toEqual([idOf(people[2]!)]);
      expect(
        resumed[0]!.toldEarlier.map((user: User): string => {
          return idOf(user);
        }),
      ).toEqual([idOf(people[0]!)]);
      expect(counts(sent)).toEqual({
        [idOf(people[0]!)]: 1,
        [idOf(people[1]!)]: 1,
        [idOf(people[2]!)]: 1,
      });
      expect(await statusesOf(event)).toEqual({
        [idOf(people[0]!)]: OwnerNotificationDeliveryStatus.Sent,
        [idOf(people[1]!)]: OwnerNotificationDeliveryStatus.Sending,
        [idOf(people[2]!)]: OwnerNotificationDeliveryStatus.Sent,
      });
    });

    test("two workers telling the same notification at once tell each owner once between them", async () => {
      for (let round: number = 0; round < 5; round++) {
        const people: Array<User> = owners(6);
        const event: OwnerNotificationEvent = notification({
          eventId: ObjectID.generate(),
        });
        const sent: Array<string> = [];

        const [first, second] = await Promise.all([
          OwnerNotificationDeliveries.plan({
            notification: event,
            owners: people,
            isProjectOwners: false,
          }),
          OwnerNotificationDeliveries.plan({
            notification: event,
            owners: [...people].reverse(),
            isProjectOwners: false,
          }),
        ]);

        await Promise.all([
          tellEveryone(first!, sent),
          tellEveryone(second!, sent),
        ]);

        const expected: Record<string, number> = {};

        for (const person of people) {
          expected[idOf(person)] = 1;
        }

        expect(counts(sent)).toEqual(expected);
        expect(
          Object.values(await statusesOf(event)).every(
            (status: string): boolean => {
              return status === OwnerNotificationDeliveryStatus.Sent;
            },
          ),
        ).toBe(true);
      }
    });

    test("two restarted workers taking up the same notification: one tells its owners", async () => {
      const people: Array<User> = owners(4);
      const started: Date = new Date();
      jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(started);

      const event: OwnerNotificationEvent = notification({
        eventId: ObjectID.generate(),
      });

      // Written down, taken, and stopped before anyone was told.
      await OwnerNotificationDeliveries.plan({
        notification: event,
        owners: people,
        isProjectOwners: true,
      });

      jest
        .spyOn(OneUptimeDate, "getCurrentDate")
        .mockReturnValue(minutesAfter(started, 10));

      const sent: Array<string> = [];
      let notified: number = 0;

      const notify: (
        delivery: OwnerNotificationDelivery,
      ) => Promise<void> = async (
        delivery: OwnerNotificationDelivery,
      ): Promise<void> => {
        if (
          delivery.notification.eventId.toString() !== event.eventId.toString()
        ) {
          return;
        }

        notified++;
        expect(delivery.isProjectOwners).toBe(true);
        await tellEveryone(delivery, sent);
      };

      await Promise.all([
        OwnerNotificationDeliveries.resume({
          kinds: [OwnerNotificationKind.IncidentCreated],
          notify,
        }),
        OwnerNotificationDeliveries.resume({
          kinds: [OwnerNotificationKind.IncidentCreated],
          notify,
        }),
      ]);

      expect(notified).toBe(1);
      expect(Object.values(counts(sent))).toEqual([1, 1, 1, 1]);
    });
  });
});
