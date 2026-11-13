import Entities from "../../../Models/DatabaseModels/Index";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import DatabaseService from "../../../Server/Services/DatabaseService";
import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import CreateLimit from "../../../Server/Types/Database/CreateLimit";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import UpdateLimit from "../../../Server/Types/Database/UpdateLimit";
import logger from "../../../Server/Utils/Logger";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";
import { dropSchemaOneTableAtATime } from "../../Helpers/DropSchemaOneTableAtATime";

/*
 * ONE PERSON'S OVERRIDES MAY NOT OVERLAP IN ONE SCOPE, HELD BY A REAL,
 * MIGRATED POSTGRES (issue #7630).
 *
 * The server refuses an override - added, or with its times moved - that
 * overlaps another override of the same person on the same policy, or
 * when both are global. Each check is made with its write, in one
 * transaction under the project's lock on override times
 * (ProjectLimitLock, "user-override-times"): an add's through
 * getCreateLimit, an edit's through getUpdateLimit. Two writes that each
 * checked before the other had written would otherwise both pass. Only
 * Postgres can show that this holds when they race:
 *
 *  - twelve adds of one person's overlapping overrides - on one policy, or
 *    all global - held until every one has passed its checks and hooks,
 *    save exactly one; each of the others is refused, naming the one
 *    saved;
 *  - an add and an edit, or two edits, that overlap only with each other
 *    cannot both pass;
 *  - the lock refuses nothing the rule allows: back-to-back overrides,
 *    other people, another policy, a global override beside a policy's,
 *    and another project's overrides all save, racing as they may.
 *
 * Every add and edit goes through the real
 * OnCallDutyPolicyUserOverrideService as OneUptime's own engines make them
 * (root, with the project as tenant). What a write does once it has
 * written - the policy's feed, the rosters, shift notices - is stood in
 * for, and so are live updates, workflows and Redis' locks.
 *
 * Opt in with RUN_POSTGRES_USER_OVERRIDE_OVERLAP_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database, right after its drift check. Every table's
 * STRUCTURE is cloned into a unique schema (first on the search_path),
 * dropped afterwards, so nothing lands in the database's own tables.
 * Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * USER_OVERRIDE_OVERLAP_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * USER_OVERRIDE_OVERLAP_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_USER_OVERRIDE_OVERLAP_TESTS"] === "true"
    ? describe
    : describe.skip;

const SCHEMA_NAME_DASHES: RegExp = /-/g;

// More writes at once than the connection pool has connections.
const RACING_ADDS: number = 12;
const POOL_SIZE: number = 10;

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

interface Person {
  id: string;
  name: string;
}

// A saved override, as the table holds it.
interface OverrideRow {
  id: string;
  overrideUserId: string;
  routeAlertsToUserId: string | null;
  onCallDutyPolicyId: string | null;
  startsAt: Date;
  endsAt: Date;
}

// The service's hooks this holds its writes at, and stands in for.
interface WriteHooks {
  getCreateLimit: (
    createBy: CreateBy<OnCallDutyPolicyUserOverride>,
  ) => Promise<CreateLimit | null>;
  getUpdateLimit: (
    updateBy: UpdateBy<OnCallDutyPolicyUserOverride>,
  ) => Promise<UpdateLimit | null>;
  onCreateSuccess: (
    onCreate: unknown,
    createdItem: OnCallDutyPolicyUserOverride,
  ) => Promise<OnCallDutyPolicyUserOverride>;
  onUpdateSuccess: (
    onUpdate: unknown,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<unknown>;
}

interface Outcome {
  passed: number;
  refusals: Array<string>;
}

describePostgres(
  "one person's overrides in one scope, on a migrated Postgres",
  () => {
    const schema: string = `user_override_overlap_${ObjectID.generate()
      .toString()
      .replace(SCHEMA_NAME_DASHES, "")}`;

    const service: WriteHooks =
      OnCallDutyPolicyUserOverrideService as unknown as WriteHooks;

    // Users are no project's: the same four people in every test.
    const jane: Person = {
      id: ObjectID.generate().toString(),
      name: "Jane Doe",
    };
    const bob: Person = { id: ObjectID.generate().toString(), name: "Bob Lee" };
    const carol: Person = {
      id: ObjectID.generate().toString(),
      name: "Carol Ng",
    };
    const kim: Person = { id: ObjectID.generate().toString(), name: "Kim Ito" };

    let database: DataSource;
    let projectId: string;
    let policyId: string;
    let otherPolicyId: string;
    // Midnight UTC three days ahead: every override is to come, so an edit may move either time.
    let day: Date;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["USER_OVERRIDE_OVERLAP_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["USER_OVERRIDE_OVERLAP_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["USER_OVERRIDE_OVERLAP_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: {
          options: `-c search_path=${schema},public`,
          max: POOL_SIZE,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      /*
       * Every table, so whatever an add or an edit touches lands here and
       * never in the database's own tables. Defaults, NOT NULL and CHECK
       * constraints and every index come with them; foreign keys do not.
       */
      const tables: Array<string> = (
        await database.query(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'migrations'`,
        )
      ).map((row: { table_name: string }): string => {
        return row.table_name;
      });

      for (const table of tables) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      expect(
        (await database.query("SELECT current_schema()"))[0].current_schema,
      ).toBe(schema);

      for (const person of [jane, bob, carol, kim]) {
        await database.query(
          `INSERT INTO "${schema}"."User" ("_id", "version", "name", "email", "slug", "timezone") VALUES ($1, 1, $2, $3, $4, 'UTC')`,
          [
            person.id,
            person.name,
            `${person.id}@example.com`,
            `user-${person.id}`,
          ],
        );
      }
    }, 300000);

    afterAll(async () => {
      if (database?.isInitialized) {
        await dropSchemaOneTableAtATime(database, schema);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      for (const level of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      // Live updates and workflows are not what this is about.
      jest
        .spyOn(DatabaseService.prototype, "onTriggerRealtime")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);

      // Redis' locks: none of them is the rule's (that one is Postgres').
      jest.spyOn(Semaphore, "lock").mockImplementation((async () => {
        return {} as SemaphoreMutex;
      }) as never);
      jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);

      // What a write does once it has written: the feed, rosters and shift notices.
      jest
        .spyOn(service, "onCreateSuccess")
        .mockImplementation(
          async (
            _onCreate: unknown,
            createdItem: OnCallDutyPolicyUserOverride,
          ): Promise<OnCallDutyPolicyUserOverride> => {
            return createdItem;
          },
        );
      jest
        .spyOn(service, "onUpdateSuccess")
        .mockImplementation(async (onUpdate: unknown): Promise<unknown> => {
          return onUpdate;
        });

      // A project of its own per test, with two policies.
      projectId = await insertProject();
      policyId = await insertPolicy(projectId, "Primary");
      otherPolicyId = await insertPolicy(projectId, "Secondary");

      day = new Date(
        Math.floor(OneUptimeDate.getCurrentDate().getTime() / DAY) * DAY +
          3 * DAY,
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    // A project whose one team has all four people in it: an override names only the project's members.
    async function insertProject(): Promise<string> {
      const id: string = ObjectID.generate().toString();
      const teamId: string = ObjectID.generate().toString();

      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "version", "name", "slug") VALUES ($1, 1, 'On-call team', $2)`,
        [id, `on-call-team-${id}`],
      );
      await database.query(
        `INSERT INTO "${schema}"."Team" ("_id", "version", "projectId", "name", "slug") VALUES ($1, 1, $2, 'Responders', $3)`,
        [teamId, id, `responders-${teamId}`],
      );

      for (const person of [jane, bob, carol, kim]) {
        await database.query(
          `INSERT INTO "${schema}"."TeamMember" ("_id", "version", "projectId", "teamId", "userId", "hasAcceptedInvitation") VALUES ($1, 1, $2, $3, $4, true)`,
          [ObjectID.generate().toString(), id, teamId, person.id],
        );
      }

      return id;
    }

    async function insertPolicy(
      project: string,
      name: string,
    ): Promise<string> {
      const id: string = ObjectID.generate().toString();

      await database.query(
        `INSERT INTO "${schema}"."OnCallDutyPolicy" ("_id", "version", "projectId", "name", "slug") VALUES ($1, 1, $2, $3, $4)`,
        [id, project, name, `${name.toLowerCase()}-${id}`],
      );

      return id;
    }

    // "13:00" or "13:30" on the test's day.
    function at(time: string): Date {
      const [hours, minutes] = time.split(":").map(Number) as [number, number];

      return new Date(day.getTime() + hours * HOUR + minutes * MINUTE);
    }

    // A time as the refusal says it: in UTC, for a caller who is no user.
    function said(date: Date): string {
      return OneUptimeDate.getDateAsFormattedStringInTimezone({
        date: date,
        timezone: Timezone.UTC,
      });
    }

    // An override, added as OneUptime's own engines add one.
    async function add(data: {
      away: Person;
      cover: Person | null;
      policy: string | null;
      from: string;
      until: string;
      project?: string | undefined;
    }): Promise<OnCallDutyPolicyUserOverride> {
      const project: string = data.project || projectId;
      const override: OnCallDutyPolicyUserOverride =
        new OnCallDutyPolicyUserOverride();
      override.projectId = new ObjectID(project);
      override.overrideUserId = new ObjectID(data.away.id);

      if (data.cover) {
        override.routeAlertsToUserId = new ObjectID(data.cover.id);
      }

      if (data.policy) {
        override.onCallDutyPolicyId = new ObjectID(data.policy);
      }

      override.startsAt = at(data.from);
      override.endsAt = at(data.until);

      return await OnCallDutyPolicyUserOverrideService.create({
        data: override,
        props: { isRoot: true, tenantId: new ObjectID(project) },
      });
    }

    // An override's times, moved as the Edit dialog moves them.
    async function edit(
      override: OnCallDutyPolicyUserOverride,
      times: { from?: string; until?: string },
    ): Promise<void> {
      const data: Record<string, unknown> = {};

      if (times.from) {
        data["startsAt"] = at(times.from);
      }

      if (times.until) {
        data["endsAt"] = at(times.until);
      }

      await OnCallDutyPolicyUserOverrideService.updateOneById({
        id: override.id!,
        data: data as never,
        props: { isRoot: true, tenantId: new ObjectID(projectId) },
      });
    }

    /*
     * Holds every add and edit once its own checks and hooks have passed -
     * where it asks for the rule its write is decided with - until `count`
     * of them have got there, then lets them all go at once. Past it, only
     * the check made with the write, under the lock, stands between them
     * and an overlap.
     */
    function holdWritesUntilAllPassedTheirChecks(count: number): void {
      let arrived: number = 0;
      let release: () => void = (): void => {
        return;
      };
      const allArrived: Promise<void> = new Promise<void>(
        (resolve: () => void) => {
          release = resolve;
        },
      );

      const arrive: () => Promise<void> = async (): Promise<void> => {
        arrived++;

        if (arrived === count) {
          release();
        }

        await allArrived;
      };

      const getCreateLimit: WriteHooks["getCreateLimit"] =
        service.getCreateLimit.bind(service);
      const getUpdateLimit: WriteHooks["getUpdateLimit"] =
        service.getUpdateLimit.bind(service);

      jest
        .spyOn(service, "getCreateLimit")
        .mockImplementation(
          async (
            createBy: CreateBy<OnCallDutyPolicyUserOverride>,
          ): Promise<CreateLimit | null> => {
            await arrive();
            return await getCreateLimit(createBy);
          },
        );
      jest
        .spyOn(service, "getUpdateLimit")
        .mockImplementation(
          async (
            updateBy: UpdateBy<OnCallDutyPolicyUserOverride>,
          ): Promise<UpdateLimit | null> => {
            await arrive();
            return await getUpdateLimit(updateBy);
          },
        );
    }

    /*
     * The other way round from the race above: the `first` kind of write
     * (an add, or an edit) is held INSIDE its lock - checked, not yet
     * written - until a write of the other kind has asked for its rule and
     * had a moment to try its own write, then writes and commits. A second
     * write decided without the lock, or not decided at all, is written
     * while the first is held; under the lock it waits for the first to
     * commit and is then decided with it in the table.
     */
    function holdFirstInItsLockUntilTheOtherTries(first: "add" | "edit"): {
      firstChecked: Promise<void>;
    } {
      let markChecked: () => void = (): void => {
        return;
      };
      let markOtherAsked: () => void = (): void => {
        return;
      };
      const firstChecked: Promise<void> = new Promise<void>(
        (resolve: () => void) => {
          markChecked = resolve;
        },
      );
      const otherAsked: Promise<void> = new Promise<void>(
        (resolve: () => void) => {
          markOtherAsked = resolve;
        },
      );

      // Inside the lock, once the check has passed: wait for the other, then write.
      function holdAfterCheck<Args extends Array<unknown>>(
        check: (...args: Args) => Promise<void>,
      ): (...args: Args) => Promise<void> {
        return async (...args: Args): Promise<void> => {
          await check(...args);
          markChecked();
          await otherAsked;
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 500);
          });
        };
      }

      const getCreateLimit: WriteHooks["getCreateLimit"] =
        service.getCreateLimit.bind(service);
      const getUpdateLimit: WriteHooks["getUpdateLimit"] =
        service.getUpdateLimit.bind(service);

      jest
        .spyOn(service, "getCreateLimit")
        .mockImplementation(
          async (
            createBy: CreateBy<OnCallDutyPolicyUserOverride>,
          ): Promise<CreateLimit | null> => {
            const limit: CreateLimit | null = await getCreateLimit(createBy);

            if (first === "edit") {
              markOtherAsked();
              return limit;
            }

            const rule: CreateLimit = heldToARule(limit);

            return { ...rule, check: holdAfterCheck(rule.check) };
          },
        );
      jest
        .spyOn(service, "getUpdateLimit")
        .mockImplementation(
          async (
            updateBy: UpdateBy<OnCallDutyPolicyUserOverride>,
          ): Promise<UpdateLimit | null> => {
            const limit: UpdateLimit | null = await getUpdateLimit(updateBy);

            if (first === "add") {
              markOtherAsked();
              return limit;
            }

            const rule: UpdateLimit = heldToARule(limit);

            return { ...rule, check: holdAfterCheck(rule.check) };
          },
        );

      /*
       * A first write held to no rule would be written unchecked, and
       * never reach the hold: it fails here, rather than leave the test
       * waiting for it.
       */
      function heldToARule<Limit>(limit: Limit | null): Limit {
        if (!limit) {
          markChecked();
          throw new Error(
            `The ${first} asked for no rule: it would be written unchecked.`,
          );
        }

        return limit;
      }

      return { firstChecked: firstChecked };
    }

    // How many writes passed, and each refusal's words: a refusal, never another failure.
    async function settle(writes: Array<Promise<unknown>>): Promise<Outcome> {
      const results: Array<PromiseSettledResult<unknown>> =
        await Promise.allSettled(writes);

      const refusals: Array<string> = [];

      for (const result of results) {
        if (result.status === "rejected") {
          expect(result.reason).toBeInstanceOf(BadDataException);
          refusals.push((result.reason as Error).message);
        }
      }

      return {
        passed: results.length - refusals.length,
        refusals: refusals,
      };
    }

    // A person's overrides in one scope, as the table holds them.
    async function overridesOf(data: {
      away: Person;
      policy: string | null;
      project?: string | undefined;
    }): Promise<Array<OverrideRow>> {
      const rows: Array<OverrideRow> = await database.query(
        `SELECT "_id" AS "id", "overrideUserId", "routeAlertsToUserId", "onCallDutyPolicyId", "startsAt", "endsAt" FROM "${schema}"."OnCallDutyPolicyUserOverride" WHERE "projectId" = $1 AND "overrideUserId" = $2 AND "deletedAt" IS NULL ORDER BY "startsAt" ASC`,
        [data.project || projectId, data.away.id],
      );

      return rows.filter((row: OverrideRow): boolean => {
        return (row.onCallDutyPolicyId || null) === (data.policy || null);
      });
    }

    // Times and who covers, "09:00-15:00 Bob Lee": what a test reads a row by.
    function described(row: OverrideRow): string {
      const time: (date: Date) => string = (date: Date): string => {
        const minutes: number = Math.round(
          (new Date(date).getTime() - day.getTime()) / MINUTE,
        );

        return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
          minutes % 60,
        ).padStart(2, "0")}`;
      };

      const cover: Person | undefined = [jane, bob, carol, kim].find(
        (person: Person): boolean => {
          return (
            person.id.toLowerCase() ===
            (row.routeAlertsToUserId || "").toLowerCase()
          );
        },
      );

      return `${time(row.startsAt)}-${time(row.endsAt)} ${
        cover ? cover.name : "skip"
      }`;
    }

    // Pairs of `rows` that overlap: worked out here, never by the rule under test.
    function overlaps(rows: Array<OverrideRow>): number {
      let pairs: number = 0;

      for (let first: number = 0; first < rows.length; first++) {
        for (let second: number = first + 1; second < rows.length; second++) {
          if (
            new Date(rows[first]!.startsAt).getTime() <
              new Date(rows[second]!.endsAt).getTime() &&
            new Date(rows[second]!.startsAt).getTime() <
              new Date(rows[first]!.endsAt).getTime()
          ) {
            pairs++;
          }
        }
      }

      return pairs;
    }

    describe("adds that race", () => {
      test("twelve adds of one person on one policy, all overlapping, save exactly one: each of the rest is refused naming it", async () => {
        holdWritesUntilAllPassedTheirChecks(RACING_ADDS);

        const outcome: Outcome = await settle(
          Array.from(
            { length: RACING_ADDS },
            (_value: unknown, index: number) => {
              return add({
                away: jane,
                cover: index % 2 === 0 ? bob : carol,
                policy: policyId,
                from: `${12 + (index % 3)}:00`,
                until: "18:00",
              });
            },
          ),
        );

        expect(outcome.passed).toBe(1);
        expect(outcome.refusals).toHaveLength(RACING_ADDS - 1);

        const rows: Array<OverrideRow> = await overridesOf({
          away: jane,
          policy: policyId,
        });

        expect(rows).toHaveLength(1);

        const saved: OverrideRow = rows[0]!;
        const coverName: string = described(saved)
          .split(" ")
          .slice(1)
          .join(" ");

        expect(["Bob Lee", "Carol Ng"]).toContain(coverName);

        for (const refusal of outcome.refusals) {
          expect(refusal).toBe(
            `Jane Doe is already covered by ${coverName} on this policy from ${said(new Date(saved.startsAt))} to ${said(new Date(saved.endsAt))}. Change the times, or edit that override.`,
          );
        }
      }, 120000);

      test("twelve global adds of one person, all overlapping, save exactly one", async () => {
        holdWritesUntilAllPassedTheirChecks(RACING_ADDS);

        const outcome: Outcome = await settle(
          Array.from(
            { length: RACING_ADDS },
            (_value: unknown, index: number) => {
              return add({
                away: jane,
                // Every third a skip: nobody named to cover.
                cover: index % 3 === 0 ? null : bob,
                policy: null,
                from: "09:00",
                until: `${17 + (index % 4)}:00`,
              });
            },
          ),
        );

        expect(outcome.passed).toBe(1);
        expect(outcome.refusals).toHaveLength(RACING_ADDS - 1);

        const rows: Array<OverrideRow> = await overridesOf({
          away: jane,
          policy: null,
        });

        expect(rows).toHaveLength(1);

        for (const refusal of outcome.refusals) {
          expect(refusal).toMatch(
            /^Jane Doe is already (covered by Bob Lee|away) on every policy from .+ to .+\. Change the times, or edit that override\.$/,
          );
          expect(refusal).toContain(said(new Date(rows[0]!.endsAt)));
        }
      }, 120000);

      test("the lock refuses nothing the rule allows: back to back, other people, another policy, global beside a policy's, another project", async () => {
        const otherProjectId: string = await insertProject();
        const otherProjectPolicyId: string = await insertPolicy(
          otherProjectId,
          "Primary",
        );

        const writes: Array<() => Promise<OnCallDutyPolicyUserOverride>> = [
          // Back to back: one ends as the next starts.
          (): Promise<OnCallDutyPolicyUserOverride> => {
            return add({
              away: jane,
              cover: bob,
              policy: policyId,
              from: "09:00",
              until: "10:00",
            });
          },
          (): Promise<OnCallDutyPolicyUserOverride> => {
            return add({
              away: jane,
              cover: carol,
              policy: policyId,
              from: "10:00",
              until: "11:00",
            });
          },
          (): Promise<OnCallDutyPolicyUserOverride> => {
            return add({
              away: jane,
              cover: null,
              policy: policyId,
              from: "11:00",
              until: "12:00",
            });
          },
          (): Promise<OnCallDutyPolicyUserOverride> => {
            return add({
              away: jane,
              cover: kim,
              policy: policyId,
              from: "12:00",
              until: "13:00",
            });
          },
          // The same hours on another policy, and globally.
          (): Promise<OnCallDutyPolicyUserOverride> => {
            return add({
              away: jane,
              cover: bob,
              policy: otherPolicyId,
              from: "09:00",
              until: "13:00",
            });
          },
          (): Promise<OnCallDutyPolicyUserOverride> => {
            return add({
              away: jane,
              cover: carol,
              policy: null,
              from: "09:00",
              until: "13:00",
            });
          },
          // Other people, at the same hours.
          (): Promise<OnCallDutyPolicyUserOverride> => {
            return add({
              away: bob,
              cover: carol,
              policy: policyId,
              from: "09:00",
              until: "13:00",
            });
          },
          (): Promise<OnCallDutyPolicyUserOverride> => {
            return add({
              away: kim,
              cover: null,
              policy: null,
              from: "09:00",
              until: "13:00",
            });
          },
          // The same person, in another project.
          (): Promise<OnCallDutyPolicyUserOverride> => {
            return add({
              away: jane,
              cover: bob,
              policy: otherProjectPolicyId,
              from: "09:00",
              until: "13:00",
              project: otherProjectId,
            });
          },
        ];

        holdWritesUntilAllPassedTheirChecks(writes.length);

        const outcome: Outcome = await settle(
          writes.map(
            (
              write: () => Promise<OnCallDutyPolicyUserOverride>,
            ): Promise<OnCallDutyPolicyUserOverride> => {
              return write();
            },
          ),
        );

        expect(outcome).toEqual({ passed: writes.length, refusals: [] });

        expect(
          (await overridesOf({ away: jane, policy: policyId })).map(described),
        ).toEqual([
          "09:00-10:00 Bob Lee",
          "10:00-11:00 Carol Ng",
          "11:00-12:00 skip",
          "12:00-13:00 Kim Ito",
        ]);
        expect(
          (await overridesOf({ away: jane, policy: otherPolicyId })).map(
            described,
          ),
        ).toEqual(["09:00-13:00 Bob Lee"]);
        expect(
          (await overridesOf({ away: jane, policy: null })).map(described),
        ).toEqual(["09:00-13:00 Carol Ng"]);
        expect(
          (await overridesOf({ away: bob, policy: policyId })).map(described),
        ).toEqual(["09:00-13:00 Carol Ng"]);
        expect(
          (await overridesOf({ away: kim, policy: null })).map(described),
        ).toEqual(["09:00-13:00 skip"]);
        expect(
          (
            await overridesOf({
              away: jane,
              policy: otherProjectPolicyId,
              project: otherProjectId,
            })
          ).map(described),
        ).toEqual(["09:00-13:00 Bob Lee"]);
      }, 120000);
    });

    describe("edits that race", () => {
      test("an add and an edit that overlap only with each other cannot both pass", async () => {
        const early: OnCallDutyPolicyUserOverride = await add({
          away: jane,
          cover: bob,
          policy: policyId,
          from: "09:00",
          until: "10:00",
        });

        holdWritesUntilAllPassedTheirChecks(2);

        const outcome: Outcome = await settle([
          edit(early, { until: "15:00" }),
          add({
            away: jane,
            cover: carol,
            policy: policyId,
            from: "14:00",
            until: "16:00",
          }),
        ]);

        expect(outcome.passed).toBe(1);
        expect(outcome.refusals).toHaveLength(1);

        const rows: Array<OverrideRow> = await overridesOf({
          away: jane,
          policy: policyId,
        });

        expect(overlaps(rows)).toBe(0);
        // Whichever was decided first is what the table holds.
        expect([
          ["09:00-15:00 Bob Lee"],
          ["09:00-10:00 Bob Lee", "14:00-16:00 Carol Ng"],
        ]).toContainEqual(rows.map(described));
        expect(outcome.refusals[0]).toBe(
          rows.length === 1
            ? `Jane Doe is already covered by Bob Lee on this policy from ${said(at("09:00"))} to ${said(at("15:00"))}. Change the times, or edit that override.`
            : `Jane Doe is already covered by Carol Ng on this policy from ${said(at("14:00"))} to ${said(at("16:00"))}. Change the times, or edit that override.`,
        );
      }, 120000);

      test("an edit made while an add it would overlap is being written waits for the add, and is refused naming it", async () => {
        const early: OnCallDutyPolicyUserOverride = await add({
          away: jane,
          cover: bob,
          policy: policyId,
          from: "09:00",
          until: "10:00",
        });

        const held: { firstChecked: Promise<void> } =
          holdFirstInItsLockUntilTheOtherTries("add");

        const adding: Promise<OnCallDutyPolicyUserOverride> = add({
          away: jane,
          cover: carol,
          policy: policyId,
          from: "14:00",
          until: "16:00",
        });

        await held.firstChecked;

        const outcome: Outcome = await settle([
          adding,
          edit(early, { until: "15:00" }),
        ]);

        expect(outcome).toEqual({
          passed: 1,
          refusals: [
            `Jane Doe is already covered by Carol Ng on this policy from ${said(at("14:00"))} to ${said(at("16:00"))}. Change the times, or edit that override.`,
          ],
        });
        expect(
          (await overridesOf({ away: jane, policy: policyId })).map(described),
        ).toEqual(["09:00-10:00 Bob Lee", "14:00-16:00 Carol Ng"]);
      }, 120000);

      test("an add made while an edit it would overlap is being written waits for the edit, and is refused naming it", async () => {
        const early: OnCallDutyPolicyUserOverride = await add({
          away: jane,
          cover: bob,
          policy: policyId,
          from: "09:00",
          until: "10:00",
        });

        const held: { firstChecked: Promise<void> } =
          holdFirstInItsLockUntilTheOtherTries("edit");

        const editing: Promise<void> = edit(early, { until: "15:00" });

        await held.firstChecked;

        const outcome: Outcome = await settle([
          editing,
          add({
            away: jane,
            cover: carol,
            policy: policyId,
            from: "14:00",
            until: "16:00",
          }),
        ]);

        expect(outcome).toEqual({
          passed: 1,
          refusals: [
            `Jane Doe is already covered by Bob Lee on this policy from ${said(at("09:00"))} to ${said(at("15:00"))}. Change the times, or edit that override.`,
          ],
        });
        expect(
          (await overridesOf({ away: jane, policy: policyId })).map(described),
        ).toEqual(["09:00-15:00 Bob Lee"]);
      }, 120000);

      test("two edits that overlap only with each other cannot both pass", async () => {
        const morning: OnCallDutyPolicyUserOverride = await add({
          away: jane,
          cover: bob,
          policy: policyId,
          from: "09:00",
          until: "10:00",
        });
        const afternoon: OnCallDutyPolicyUserOverride = await add({
          away: jane,
          cover: carol,
          policy: policyId,
          from: "14:00",
          until: "15:00",
        });

        holdWritesUntilAllPassedTheirChecks(2);

        const outcome: Outcome = await settle([
          edit(morning, { until: "13:00" }),
          edit(afternoon, { from: "12:00" }),
        ]);

        expect(outcome.passed).toBe(1);
        expect(outcome.refusals).toHaveLength(1);

        const rows: Array<OverrideRow> = await overridesOf({
          away: jane,
          policy: policyId,
        });

        expect(rows).toHaveLength(2);
        expect(overlaps(rows)).toBe(0);
        expect([
          ["09:00-13:00 Bob Lee", "14:00-15:00 Carol Ng"],
          ["09:00-10:00 Bob Lee", "12:00-15:00 Carol Ng"],
        ]).toContainEqual(rows.map(described));
      }, 120000);

      test("edits that keep apart all pass, racing as they may", async () => {
        const overrides: Array<OnCallDutyPolicyUserOverride> = [];

        for (const hour of [9, 11, 13, 15]) {
          overrides.push(
            await add({
              away: jane,
              cover: bob,
              policy: policyId,
              from: `${hour}:00`,
              until: `${hour}:30`,
            }),
          );
        }

        holdWritesUntilAllPassedTheirChecks(overrides.length);

        // Each grows to the next one's start: back to back, never over it.
        const outcome: Outcome = await settle(
          overrides.map(
            (
              override: OnCallDutyPolicyUserOverride,
              index: number,
            ): Promise<void> => {
              return edit(override, { until: `${11 + index * 2}:00` });
            },
          ),
        );

        expect(outcome).toEqual({ passed: overrides.length, refusals: [] });
        expect(
          (await overridesOf({ away: jane, policy: policyId })).map(described),
        ).toEqual([
          "09:00-11:00 Bob Lee",
          "11:00-13:00 Bob Lee",
          "13:00-15:00 Bob Lee",
          "15:00-17:00 Bob Lee",
        ]);
      }, 120000);
    });
  },
);
