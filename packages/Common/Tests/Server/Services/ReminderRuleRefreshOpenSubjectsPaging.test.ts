import AlertReminderRuleService from "../../../Server/Services/AlertReminderRuleService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import IncidentReminderRuleService from "../../../Server/Services/IncidentReminderRuleService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import ScheduledMaintenanceReminderRuleService from "../../../Server/Services/ScheduledMaintenanceReminderRuleService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import logger from "../../../Server/Utils/Logger";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * How the three reminder rule services' refreshSchedulesForOpen* read a
 * project's open subjects, with the reads and the per-subject refresh faked.
 *
 * Without options the refresh runs inside API requests (the rule create,
 * update and delete hooks), so it must stay the read it has always been: one
 * read of at most LIMIT_MAX, in the default order, with no cursor, even when
 * that read comes back full.
 *
 * With onlyWithoutNextReminder it is the backfill of issue #4030 (the
 * ScheduleRemindersMissedByReminderRuleLookup data migration calls it once
 * per project), so it must reach every open subject with no reminder,
 * however many: a noisy alert project can hold more than LIMIT_MAX of them,
 * and the ones no rule matches stay NULL. It pages by an `_id` cursor, stops
 * on a short page, and cannot loop on a page that does not advance.
 *
 * The SQL these reads produce is run against a migrated Postgres in
 * ReminderRuleLookupPostgres.test.ts.
 */

type RefreshOptions = Parameters<
  typeof IncidentReminderRuleService.refreshSchedulesForOpenIncidents
>[1];

// A state or subject row as the faked reads return it: the id is all read.
interface FakeRow {
  id: ObjectID | null;
}

// What a subject service's refreshReminderSchedule was handed.
interface RefreshCall {
  subjectId: string;
  projectId: string;
}

interface Fakes {
  readStates: (args: JSONObject) => Promise<Array<FakeRow>>;
  readSubjects: (args: JSONObject) => Promise<Array<FakeRow>>;
  refreshSubject: (call: RefreshCall) => Promise<void>;
}

interface KindUnderTest {
  name: string;
  pluralName: string;
  // The subject column holding its current state.
  stateColumn: string;
  refreshOpenSubjects: (
    projectId: ObjectID,
    options?: RefreshOptions,
  ) => Promise<void>;
  // Spies on the real state and subject service singletons.
  fake: (fakes: Fakes) => void;
}

const KINDS: Array<KindUnderTest> = [
  {
    name: "incident",
    pluralName: "incidents",
    stateColumn: "currentIncidentStateId",
    refreshOpenSubjects: (
      projectId: ObjectID,
      options?: RefreshOptions,
    ): Promise<void> => {
      return IncidentReminderRuleService.refreshSchedulesForOpenIncidents(
        projectId,
        options,
      );
    },
    fake: (fakes: Fakes): void => {
      jest.spyOn(IncidentStateService, "findBy").mockImplementation(((
        args: JSONObject,
      ): Promise<Array<FakeRow>> => {
        return fakes.readStates(args);
      }) as never);
      jest.spyOn(IncidentService, "findBy").mockImplementation(((
        args: JSONObject,
      ): Promise<Array<FakeRow>> => {
        return fakes.readSubjects(args);
      }) as never);
      jest
        .spyOn(IncidentService, "refreshReminderSchedule")
        .mockImplementation(((data: {
          incidentId: ObjectID;
          projectId: ObjectID;
        }): Promise<void> => {
          return fakes.refreshSubject({
            subjectId: data.incidentId.toString(),
            projectId: data.projectId.toString(),
          });
        }) as never);
    },
  },
  {
    name: "alert",
    pluralName: "alerts",
    stateColumn: "currentAlertStateId",
    refreshOpenSubjects: (
      projectId: ObjectID,
      options?: RefreshOptions,
    ): Promise<void> => {
      return AlertReminderRuleService.refreshSchedulesForOpenAlerts(
        projectId,
        options,
      );
    },
    fake: (fakes: Fakes): void => {
      jest.spyOn(AlertStateService, "findBy").mockImplementation(((
        args: JSONObject,
      ): Promise<Array<FakeRow>> => {
        return fakes.readStates(args);
      }) as never);
      jest.spyOn(AlertService, "findBy").mockImplementation(((
        args: JSONObject,
      ): Promise<Array<FakeRow>> => {
        return fakes.readSubjects(args);
      }) as never);
      jest
        .spyOn(AlertService, "refreshReminderSchedule")
        .mockImplementation(((data: {
          alertId: ObjectID;
          projectId: ObjectID;
        }): Promise<void> => {
          return fakes.refreshSubject({
            subjectId: data.alertId.toString(),
            projectId: data.projectId.toString(),
          });
        }) as never);
    },
  },
  {
    name: "scheduled maintenance",
    pluralName: "scheduled maintenances",
    stateColumn: "currentScheduledMaintenanceStateId",
    refreshOpenSubjects: (
      projectId: ObjectID,
      options?: RefreshOptions,
    ): Promise<void> => {
      return ScheduledMaintenanceReminderRuleService.refreshSchedulesForOpenScheduledMaintenances(
        projectId,
        options,
      );
    },
    fake: (fakes: Fakes): void => {
      jest
        .spyOn(ScheduledMaintenanceStateService, "findBy")
        .mockImplementation(((args: JSONObject): Promise<Array<FakeRow>> => {
          return fakes.readStates(args);
        }) as never);
      jest.spyOn(ScheduledMaintenanceService, "findBy").mockImplementation(((
        args: JSONObject,
      ): Promise<Array<FakeRow>> => {
        return fakes.readSubjects(args);
      }) as never);
      jest
        .spyOn(ScheduledMaintenanceService, "refreshReminderSchedule")
        .mockImplementation(((data: {
          scheduledMaintenanceId: ObjectID;
          projectId: ObjectID;
        }): Promise<void> => {
          return fakes.refreshSubject({
            subjectId: data.scheduledMaintenanceId.toString(),
            projectId: data.projectId.toString(),
          });
        }) as never);
    },
  },
];

interface RawFilter {
  type: string;
  objectLiteralParameters: Record<string, unknown> | undefined;
  getSql: (aliasPath: string) => string;
}

interface RenderedFilter {
  sql: string;
  parameters: Array<unknown>;
}

/*
 * A TypeORM Raw filter as Postgres would receive it on `column`, with its
 * randomly named parameters renamed to `param` so it can be compared.
 */
function renderFilter(filter: unknown): RenderedFilter {
  const raw: RawFilter = filter as RawFilter;

  expect(raw?.type).toBe("raw");

  const names: Array<string> = Object.keys(raw.objectLiteralParameters || {});
  let sql: string = raw.getSql("column");

  for (const name of names) {
    sql = sql
      .split(`:...${name}`)
      .join(":...param")
      .split(`:${name}`)
      .join(":param");
  }

  return {
    sql: sql,
    parameters: names.map((name: string): unknown => {
      return raw.objectLiteralParameters![name];
    }),
  };
}

/*
 * The cursor a subject read carries: null when it has no `_id` filter,
 * otherwise the id of a STRICT `_id > :param` filter.
 */
function readCursor(read: JSONObject): string | null {
  const query: JSONObject = read["query"] as JSONObject;

  if (!("_id" in query)) {
    return null;
  }

  const cursor: RenderedFilter = renderFilter(query["_id"]);

  expect(cursor.sql).toBe("(column > :param)");
  expect(cursor.parameters).toHaveLength(1);
  expect(typeof cursor.parameters[0]).toBe("string");

  return cursor.parameters[0] as string;
}

/*
 * `count` subjects whose ids sort in the order they are listed, as an
 * `_id ASC` read returns them. Plain objects: a page is LIMIT_MAX of them.
 */
function makeSubjects(count: number): Array<FakeRow> {
  return Array.from(
    { length: count },
    (_value: unknown, index: number): FakeRow => {
      return {
        id: new ObjectID(
          `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
        ),
      };
    },
  );
}

function idsOf(rows: Array<FakeRow>): Array<string> {
  return rows.map((row: FakeRow): string => {
    return row.id!.toString();
  });
}

describe.each(KINDS)(
  "refreshing the open $pluralName of a project",
  (kind: KindUnderTest) => {
    const projectId: ObjectID = new ObjectID(
      "11111111-1111-4111-8111-111111111111",
    );
    const unresolvedStateIds: Array<ObjectID> = [
      new ObjectID("22222222-2222-4222-8222-222222222222"),
      new ObjectID("33333333-3333-4333-8333-333333333333"),
    ];

    let states: Array<FakeRow> = [];
    let serveSubjects: (read: JSONObject) => Promise<Array<FakeRow>>;
    let failingSubjectIds: Set<string> = new Set<string>();

    let stateReads: Array<JSONObject> = [];
    let subjectReads: Array<JSONObject> = [];
    let refreshCalls: Array<RefreshCall> = [];
    let loggedErrors: Array<{ message: string; attributes: unknown }> = [];

    /*
     * Serves `subjects` the way Postgres would for the read sent: the rows
     * after its cursor, if it has one, and at most `limit` of them.
     */
    function servePaged(subjects: Array<FakeRow>): void {
      serveSubjects = (read: JSONObject): Promise<Array<FakeRow>> => {
        const cursor: string | null = readCursor(read);

        return Promise.resolve(
          subjects
            .filter((row: FakeRow): boolean => {
              return cursor === null || row.id!.toString() > cursor;
            })
            .slice(0, read["limit"] as number),
        );
      };
    }

    function refreshedIds(): Array<string> {
      return refreshCalls.map((call: RefreshCall): string => {
        return call.subjectId;
      });
    }

    // The part of every subject read that says what an open subject is.
    function expectOpenSubjectRead(read: JSONObject): void {
      const query: JSONObject = read["query"] as JSONObject;

      expect(query["projectId"]).toBe(projectId);
      expect(renderFilter(query[kind.stateColumn])).toEqual({
        sql: "(column IN (:...param))",
        parameters: [
          unresolvedStateIds.map((id: ObjectID): string => {
            return id.toString();
          }),
        ],
      });
      expect(read["select"]).toEqual({ _id: true });
      expect(read["limit"]).toBe(LIMIT_MAX);
      expect(read["skip"]).toBe(0);
      expect(read["props"]).toEqual({ isRoot: true });
    }

    // A read of the backfill: only subjects with no reminder, `_id` ascending.
    function expectBackfillRead(read: JSONObject): void {
      expectOpenSubjectRead(read);

      const query: JSONObject = read["query"] as JSONObject;

      expect(renderFilter(query["nextReminderNotificationAt"])).toEqual({
        sql: "(column IS NULL)",
        parameters: [],
      });
      expect(read["sort"]).toEqual({ _id: SortOrder.Ascending });
    }

    beforeEach(() => {
      states = unresolvedStateIds.map((id: ObjectID): FakeRow => {
        return { id: id };
      });
      servePaged([]);
      failingSubjectIds = new Set<string>();

      stateReads = [];
      subjectReads = [];
      refreshCalls = [];
      loggedErrors = [];

      kind.fake({
        readStates: (args: JSONObject): Promise<Array<FakeRow>> => {
          stateReads.push(args);
          return Promise.resolve(states);
        },
        readSubjects: (args: JSONObject): Promise<Array<FakeRow>> => {
          subjectReads.push(args);
          return serveSubjects(args);
        },
        refreshSubject: (call: RefreshCall): Promise<void> => {
          refreshCalls.push(call);

          if (failingSubjectIds.has(call.subjectId)) {
            return Promise.reject(new Error("refresh exploded"));
          }

          return Promise.resolve();
        },
      });

      jest.spyOn(logger, "error").mockImplementation(((
        message: unknown,
        attributes: unknown,
      ): void => {
        loggedErrors.push({ message: String(message), attributes });
      }) as never);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("reads the project's unresolved states as root", async () => {
      await kind.refreshOpenSubjects(projectId, {
        onlyWithoutNextReminder: true,
      });

      expect(stateReads).toHaveLength(1);
      expect(stateReads[0]!["query"]).toEqual({
        projectId: projectId,
        isResolvedState: false,
      });
      expect(stateReads[0]!["limit"]).toBe(LIMIT_PER_PROJECT);
      expect(stateReads[0]!["props"]).toEqual({ isRoot: true });
    });

    test.each([
      ["no options", undefined],
      ["onlyWithoutNextReminder", { onlyWithoutNextReminder: true }],
    ] as Array<[string, RefreshOptions]>)(
      "with %s, reads no subject when the project has no unresolved state",
      async (_label: string, options: RefreshOptions) => {
        states = [];
        servePaged(makeSubjects(3));

        await expect(
          kind.refreshOpenSubjects(projectId, options),
        ).resolves.toBeUndefined();

        expect(stateReads).toHaveLength(1);
        expect(subjectReads).toEqual([]);
        expect(refreshCalls).toEqual([]);
        expect(loggedErrors).toEqual([]);
      },
    );

    describe("without onlyWithoutNextReminder, as the rule hooks call it", () => {
      /*
       * More open subjects exist than one read returns, and the read comes
       * back full: still one read, exactly as before the backfill existed.
       */
      test.each([
        ["no options", undefined],
        ["an empty options object", {}],
        ["onlyWithoutNextReminder false", { onlyWithoutNextReminder: false }],
      ] as Array<[string, RefreshOptions]>)(
        "with %s, reads once, capped at LIMIT_MAX, with no cursor, NULL filter or sort, and refreshes every subject of that full read",
        async (_label: string, options: RefreshOptions) => {
          const subjects: Array<FakeRow> = makeSubjects(LIMIT_MAX + 5);
          servePaged(subjects);

          await kind.refreshOpenSubjects(projectId, options);

          expect(subjectReads).toHaveLength(1);

          const read: JSONObject = subjectReads[0]!;

          expect(Object.keys(read).sort()).toEqual([
            "limit",
            "props",
            "query",
            "select",
            "skip",
          ]);
          expect(Object.keys(read["query"] as JSONObject).sort()).toEqual(
            [kind.stateColumn, "projectId"].sort(),
          );
          expectOpenSubjectRead(read);

          expect(refreshedIds()).toEqual(idsOf(subjects.slice(0, LIMIT_MAX)));
          for (const call of refreshCalls) {
            expect(call.projectId).toBe(projectId.toString());
          }
          expect(loggedErrors).toEqual([]);
        },
      );

      test("logs a subject whose refresh fails, with the project, and refreshes the rest", async () => {
        const subjects: Array<FakeRow> = makeSubjects(3);
        servePaged(subjects);
        failingSubjectIds = new Set<string>([subjects[1]!.id!.toString()]);

        await expect(
          kind.refreshOpenSubjects(projectId),
        ).resolves.toBeUndefined();

        expect(refreshedIds()).toEqual(idsOf(subjects));
        expect(loggedErrors).toEqual([
          {
            message: `Failed to refresh reminder schedule for ${kind.name} ${subjects[1]!.id!.toString()}: Error: refresh exploded`,
            attributes: { projectId: projectId.toString() },
          },
        ]);
      });
    });

    describe("with onlyWithoutNextReminder, as the backfill calls it", () => {
      test("reads only the subjects with no reminder, `_id` ascending, with no cursor on the first read, and stops on a short page", async () => {
        const subjects: Array<FakeRow> = makeSubjects(3);
        servePaged(subjects);

        await kind.refreshOpenSubjects(projectId, {
          onlyWithoutNextReminder: true,
        });

        expect(subjectReads).toHaveLength(1);

        const read: JSONObject = subjectReads[0]!;

        expectBackfillRead(read);
        expect(readCursor(read)).toBeNull();
        expect(Object.keys(read["query"] as JSONObject).sort()).toEqual(
          [kind.stateColumn, "nextReminderNotificationAt", "projectId"].sort(),
        );

        expect(refreshedIds()).toEqual(idsOf(subjects));
        expect(loggedErrors).toEqual([]);
      });

      test("pages on after a full page, by an _id cursor from its last row, until a short page", async () => {
        const subjects: Array<FakeRow> = makeSubjects(LIMIT_MAX + 5);
        servePaged(subjects);

        await kind.refreshOpenSubjects(projectId, {
          onlyWithoutNextReminder: true,
        });

        expect(subjectReads).toHaveLength(2);
        expect(subjectReads.map(readCursor)).toEqual([
          null,
          subjects[LIMIT_MAX - 1]!.id!.toString(),
        ]);
        for (const read of subjectReads) {
          expectBackfillRead(read);
        }

        // Every subject once, in order, none skipped at the page boundary.
        expect(refreshedIds()).toEqual(idsOf(subjects));
        for (const call of refreshCalls) {
          expect(call.projectId).toBe(projectId.toString());
        }
        expect(loggedErrors).toEqual([]);
      });

      test("stops after an exactly-full last page, on the empty read that follows it", async () => {
        const subjects: Array<FakeRow> = makeSubjects(2 * LIMIT_MAX);
        servePaged(subjects);

        await kind.refreshOpenSubjects(projectId, {
          onlyWithoutNextReminder: true,
        });

        expect(subjectReads.map(readCursor)).toEqual([
          null,
          subjects[LIMIT_MAX - 1]!.id!.toString(),
          subjects[2 * LIMIT_MAX - 1]!.id!.toString(),
        ]);
        expect(refreshedIds()).toEqual(idsOf(subjects));
        expect(loggedErrors).toEqual([]);
      });

      /*
       * Not reachable with a real `_id ASC` + `_id > cursor` read, but a
       * full page that does not move the cursor would be read forever, and
       * the backfill runs in the migrate Job ahead of every later migration.
       */
      test("stops, and logs with the project, when a full page does not advance the cursor", async () => {
        const page: Array<FakeRow> = makeSubjects(LIMIT_MAX);
        /*
         * Capped so a missing guard fails the assertions below by name. An
         * endless run of resolved promises would starve jest's timeout
         * timer and take the worker down with the heap instead.
         */
        serveSubjects = (): Promise<Array<FakeRow>> => {
          if (subjectReads.length > 3) {
            return Promise.reject(new Error("the same page was read again"));
          }

          return Promise.resolve(page);
        };

        await expect(
          kind.refreshOpenSubjects(projectId, {
            onlyWithoutNextReminder: true,
          }),
        ).resolves.toBeUndefined();

        expect(subjectReads).toHaveLength(2);
        expect(loggedErrors).toEqual([
          {
            message: `Failed to refresh reminder schedules for open ${kind.pluralName}: Error: the open ${kind.name} page did not advance its _id cursor`,
            attributes: { projectId: projectId.toString() },
          },
        ]);
      });

      test("logs a subject whose refresh fails, with the project, and carries on with the rest and the next page", async () => {
        const subjects: Array<FakeRow> = makeSubjects(LIMIT_MAX + 5);
        servePaged(subjects);

        const failing: Array<string> = [
          subjects[1]!.id!.toString(),
          subjects[LIMIT_MAX - 1]!.id!.toString(),
          subjects[LIMIT_MAX + 2]!.id!.toString(),
        ];
        failingSubjectIds = new Set<string>(failing);

        await expect(
          kind.refreshOpenSubjects(projectId, {
            onlyWithoutNextReminder: true,
          }),
        ).resolves.toBeUndefined();

        // A failure on a page's last row still moves the cursor past it.
        expect(subjectReads.map(readCursor)).toEqual([
          null,
          subjects[LIMIT_MAX - 1]!.id!.toString(),
        ]);
        expect(refreshedIds()).toEqual(idsOf(subjects));
        expect(loggedErrors).toEqual(
          failing.map(
            (subjectId: string): { message: string; attributes: unknown } => {
              return {
                message: `Failed to refresh reminder schedule for ${kind.name} ${subjectId}: Error: refresh exploded`,
                attributes: { projectId: projectId.toString() },
              };
            },
          ),
        );
      });

      test("logs a page that cannot be read, with the project, and keeps what the earlier pages refreshed", async () => {
        const subjects: Array<FakeRow> = makeSubjects(LIMIT_MAX + 5);
        servePaged(subjects);

        const servePage: (read: JSONObject) => Promise<Array<FakeRow>> =
          serveSubjects;
        serveSubjects = (read: JSONObject): Promise<Array<FakeRow>> => {
          if (readCursor(read) !== null) {
            return Promise.reject(new Error("connection reset"));
          }
          return servePage(read);
        };

        await expect(
          kind.refreshOpenSubjects(projectId, {
            onlyWithoutNextReminder: true,
          }),
        ).resolves.toBeUndefined();

        expect(subjectReads).toHaveLength(2);
        expect(refreshedIds()).toEqual(idsOf(subjects.slice(0, LIMIT_MAX)));
        expect(loggedErrors).toEqual([
          {
            message: `Failed to refresh reminder schedules for open ${kind.pluralName}: Error: connection reset`,
            attributes: { projectId: projectId.toString() },
          },
        ]);
      });
    });
  },
);
