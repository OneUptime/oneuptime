import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import AlertReminderRule from "Common/Models/DatabaseModels/AlertReminderRule";
import IncidentReminderRule from "Common/Models/DatabaseModels/IncidentReminderRule";
import ScheduledMaintenanceReminderRule from "Common/Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import AlertReminderRuleService from "Common/Server/Services/AlertReminderRuleService";
import IncidentReminderRuleService from "Common/Server/Services/IncidentReminderRuleService";
import ScheduledMaintenanceReminderRuleService from "Common/Server/Services/ScheduledMaintenanceReminderRuleService";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";
import ScheduleRemindersMissedByReminderRuleLookup from "../../../FeatureSet/Workers/DataMigrations/ScheduleRemindersMissedByReminderRuleLookup";
import fs from "fs";
import path from "path";

/*
 * The data half of issue #4030.
 *
 * From 13.0.3 until the fix, every read of a reminder rule by isEnabled failed
 * in Postgres, so refreshReminderSchedule threw before writing
 * nextReminderNotificationAt and every subject opened in that window was left
 * NULL. The reminder workers only ever pick up a timestamp in the past, so
 * those subjects are never reminded again on their own. This migration is
 * what reaches them.
 *
 * What is pinned here is the shape of the walk: every project with an
 * enabled rule of a kind is refreshed exactly once, only for its subjects
 * with NO timestamp (a subject that has one must keep it); the rule table is
 * read in bounded, `_id`-cursored pages that always terminate; and one bad
 * project or one unreadable kind cannot cost the rest their reminders, nor
 * halt the migrations queued behind this one.
 */
jest.mock("Common/Server/Services/IncidentReminderRuleService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      refreshSchedulesForOpenIncidents: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/AlertReminderRuleService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      refreshSchedulesForOpenAlerts: jest.fn(),
    },
  };
});

jest.mock(
  "Common/Server/Services/ScheduledMaintenanceReminderRuleService",
  () => {
    return {
      __esModule: true,
      default: {
        findBy: jest.fn(),
        refreshSchedulesForOpenScheduledMaintenances: jest.fn(),
      },
    };
  },
);

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const MIGRATION_NAME: string = "ScheduleRemindersMissedByReminderRuleLookup";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const mockedLogger: { info: jest.Mock; error: jest.Mock } =
  logger as unknown as { info: jest.Mock; error: jest.Mock };

type ReminderRule =
  | IncidentReminderRule
  | AlertReminderRule
  | ScheduledMaintenanceReminderRule;

interface KindUnderTest {
  label: string;
  findBy: jest.Mock;
  refresh: jest.Mock;
  makeRule: (id: ObjectID) => ReminderRule;
}

const incidentRules: {
  findBy: jest.Mock;
  refreshSchedulesForOpenIncidents: jest.Mock;
} = IncidentReminderRuleService as unknown as {
  findBy: jest.Mock;
  refreshSchedulesForOpenIncidents: jest.Mock;
};

const alertRules: {
  findBy: jest.Mock;
  refreshSchedulesForOpenAlerts: jest.Mock;
} = AlertReminderRuleService as unknown as {
  findBy: jest.Mock;
  refreshSchedulesForOpenAlerts: jest.Mock;
};

const scheduledMaintenanceRules: {
  findBy: jest.Mock;
  refreshSchedulesForOpenScheduledMaintenances: jest.Mock;
} = ScheduledMaintenanceReminderRuleService as unknown as {
  findBy: jest.Mock;
  refreshSchedulesForOpenScheduledMaintenances: jest.Mock;
};

const INCIDENT: KindUnderTest = {
  label: "incident",
  findBy: incidentRules.findBy,
  refresh: incidentRules.refreshSchedulesForOpenIncidents,
  makeRule: (id: ObjectID): ReminderRule => {
    return new IncidentReminderRule(id);
  },
};

const ALERT: KindUnderTest = {
  label: "alert",
  findBy: alertRules.findBy,
  refresh: alertRules.refreshSchedulesForOpenAlerts,
  makeRule: (id: ObjectID): ReminderRule => {
    return new AlertReminderRule(id);
  },
};

const SCHEDULED_MAINTENANCE: KindUnderTest = {
  label: "scheduled maintenance",
  findBy: scheduledMaintenanceRules.findBy,
  refresh:
    scheduledMaintenanceRules.refreshSchedulesForOpenScheduledMaintenances,
  makeRule: (id: ObjectID): ReminderRule => {
    return new ScheduledMaintenanceReminderRule(id);
  },
};

const KINDS: Array<KindUnderTest> = [INCIDENT, ALERT, SCHEDULED_MAINTENANCE];

/*
 * One rule per entry, in `_id` order, owned by the project at the same index
 * (undefined for a rule with no project). Ids are generated first and sorted,
 * so the order the fake serves is the order Postgres would.
 */
function makeRules(
  kind: KindUnderTest,
  projectIds: Array<ObjectID | undefined>,
): Array<ReminderRule> {
  const ids: Array<ObjectID> = projectIds
    .map((): ObjectID => {
      return ObjectID.generate();
    })
    .sort((a: ObjectID, b: ObjectID): number => {
      return a.toString() < b.toString() ? -1 : 1;
    });

  return projectIds.map(
    (projectId: ObjectID | undefined, index: number): ReminderRule => {
      const rule: ReminderRule = kind.makeRule(ids[index]!);
      if (projectId) {
        rule.projectId = projectId;
      }
      return rule;
    },
  );
}

/*
 * `count` rules cycling through `projectIds`, so every project turns up on
 * every page and the walk has to de-duplicate across pages, not just within
 * one.
 */
function rulesCycling(
  kind: KindUnderTest,
  projectIds: Array<ObjectID>,
  count: number,
): Array<ReminderRule> {
  return makeRules(
    kind,
    Array.from(
      { length: count },
      (_value: unknown, index: number): ObjectID => {
        return projectIds[index % projectIds.length]!;
      },
    ),
  );
}

/*
 * What the fake saw of each call's `_id` filter, or of a filter it could not
 * read. Checked after every test: an unreadable cursor answers [] (which
 * would otherwise just look like a finished walk), so it must fail loudly
 * here instead.
 */
const cursorsSeen: Map<jest.Mock, Array<string | null>> = new Map<
  jest.Mock,
  Array<string | null>
>();
const unreadableCursors: Array<string> = [];

const ID_ALIAS: string = '"ReminderRule"."_id"';

interface RawOperator {
  type: string;
  objectLiteralParameters: Record<string, unknown>;
  getSql: (aliasPath: string) => string;
}

/*
 * The cursor the migration sent, read the way Postgres would read it: a
 * TypeORM Raw rendering a STRICT `_id > :param` with the id bound. Anything
 * else is recorded as unreadable.
 */
function readCursor(query: JSONObject): string | null {
  if (!("_id" in query)) {
    return null;
  }

  const operator: RawOperator = query["_id"] as unknown as RawOperator;
  const params: Array<string> = Object.keys(
    operator?.objectLiteralParameters || {},
  );

  if (
    operator?.type !== "raw" ||
    params.length !== 1 ||
    operator.getSql(ID_ALIAS) !== `(${ID_ALIAS} > :${params[0]})` ||
    typeof operator.objectLiteralParameters[params[0]!] !== "string"
  ) {
    unreadableCursors.push(JSON.stringify(query["_id"]));
    return "unreadable";
  }

  return operator.objectLiteralParameters[params[0]!] as string;
}

/*
 * A findBy that serves `rules` the way Postgres would for this query: rows
 * whose id sorts after the cursor, `_id` ascending, at most `limit` of them.
 * A migration that forgot the cursor would be served page one forever; one
 * that forgot the limit would get the whole table in one read.
 */
function serveRules(kind: KindUnderTest, rules: Array<ReminderRule>): void {
  cursorsSeen.set(kind.findBy, []);

  kind.findBy.mockImplementation((...callArgs: Array<unknown>) => {
    const input: JSONObject = callArgs[0] as JSONObject;
    const cursor: string | null = readCursor(input["query"] as JSONObject);
    cursorsSeen.get(kind.findBy)!.push(cursor);

    if (cursor === "unreadable") {
      return Promise.resolve([]);
    }

    const limit: number = input["limit"] as number;

    return Promise.resolve(
      rules
        .filter((rule: ReminderRule): boolean => {
          return cursor === null || rule.id!.toString() > cursor;
        })
        .slice(0, limit),
    );
  });
}

function refreshedProjectIds(kind: KindUnderTest): Array<string> {
  return kind.refresh.mock.calls.map((callArgs: Array<unknown>): string => {
    return (callArgs[0] as ObjectID).toString();
  });
}

function sorted(ids: Array<ObjectID | string>): Array<string> {
  return ids
    .map((id: ObjectID | string): string => {
      return id.toString();
    })
    .sort();
}

describe("ScheduleRemindersMissedByReminderRuleLookup", () => {
  const migration: ScheduleRemindersMissedByReminderRuleLookup =
    new ScheduleRemindersMissedByReminderRuleLookup();

  beforeEach(() => {
    jest.clearAllMocks();
    cursorsSeen.clear();
    unreadableCursors.length = 0;

    for (const kind of KINDS) {
      serveRules(kind, []);
      kind.refresh.mockResolvedValue(undefined as never);
    }
  });

  afterEach(() => {
    expect(unreadableCursors).toEqual([]);
  });

  describe("registration", () => {
    /*
     * Comments stripped first, so a migration only NAMED in a neighbour's
     * block comment does not count as registered.
     */
    const indexSource: string = fs
      .readFileSync(path.join(DATA_MIGRATIONS_DIR, "Index.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

    function registeredMigrations(): Array<string> {
      const arrayStart: number = indexSource.indexOf(
        "const DataMigrations: Array<DataMigrationBase> = [",
      );
      const arrayEnd: number = indexSource.indexOf("];", arrayStart);

      expect(arrayStart).toBeGreaterThanOrEqual(0);
      expect(arrayEnd).toBeGreaterThan(arrayStart);

      return Array.from(
        indexSource
          .slice(arrayStart, arrayEnd)
          .matchAll(/new\s+([A-Za-z0-9_]+)\(\)/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      });
    }

    test("is imported into DataMigrations/Index.ts", () => {
      expect(indexSource).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );
    });

    test("is registered exactly once in the array the runner walks", () => {
      expect(indexSource).toContain("export default DataMigrations;");

      expect(
        registeredMigrations().filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
    });

    /*
     * The runner records a migration by name and runs the list in order, so
     * what is pinned is this migration's INDEX as of this change, the end of
     * the list. Appending the next migration leaves it alone; inserting one
     * above it does not, and fails here.
     */
    const REGISTERED_POSITION: number = 115;

    test("was appended at the end of the list, and keeps that position", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(instantiations.indexOf(MIGRATION_NAME)).toBe(REGISTERED_POSITION);
      expect(instantiations.indexOf(MIGRATION_NAME)).toBeGreaterThan(
        instantiations.indexOf("NormalizeMonitoringInterval"),
      );
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(migration.name).toBe(MIGRATION_NAME);
    });
  });

  describe.each(KINDS)("the $label rule walk", (kind: KindUnderTest) => {
    /*
     * isEnabled: true is the effective-enabled filter findMatchingRule reads
     * (it is the read #4030 broke, fixed now), so a project is refreshed
     * exactly when a rule could match there. Only the project is needed, so
     * only the project is read, as root: a data migration has no tenant.
     */
    test("reads enabled rules as root, selecting only the project, in _id order", async () => {
      await migration.migrate();

      expect(kind.findBy).toHaveBeenCalledTimes(1);

      const args: JSONObject = kind.findBy.mock.calls[0]![0] as JSONObject;

      expect(args["query"]).toEqual({ isEnabled: true });
      expect(args["select"]).toEqual({ _id: true, projectId: true });
      expect(args["sort"]).toEqual({ _id: SortOrder.Ascending });
      expect(args["skip"]).toBe(0);
      expect(args["limit"]).toBe(LIMIT_MAX);
      expect((args["props"] as JSONObject)["isRoot"]).toBe(true);
    });

    test("refreshes nothing when there are no enabled rules", async () => {
      await migration.migrate();

      expect(kind.refresh).not.toHaveBeenCalled();
    });

    test("refreshes each project once, across pages, and only its subjects without a reminder", async () => {
      const projectIds: Array<ObjectID> = [
        ObjectID.generate(),
        ObjectID.generate(),
        ObjectID.generate(),
      ];

      // Two full pages and a partial third, every project on every page.
      serveRules(kind, rulesCycling(kind, projectIds, 2 * LIMIT_MAX + 7));

      await migration.migrate();

      expect(kind.findBy).toHaveBeenCalledTimes(3);
      expect(kind.refresh).toHaveBeenCalledTimes(3);
      expect(sorted(refreshedProjectIds(kind))).toEqual(sorted(projectIds));

      for (const callArgs of kind.refresh.mock.calls) {
        expect(callArgs).toHaveLength(2);
        expect(callArgs[0]).toBeInstanceOf(ObjectID);
        expect(callArgs[1]).toEqual({ onlyWithoutNextReminder: true });
      }
    });

    test("pages by an _id cursor from the last row of the previous page, never by offset", async () => {
      const rules: Array<ReminderRule> = rulesCycling(
        kind,
        [ObjectID.generate()],
        LIMIT_MAX + 1,
      );
      serveRules(kind, rules);

      await migration.migrate();

      expect(cursorsSeen.get(kind.findBy)).toEqual([
        null,
        rules[LIMIT_MAX - 1]!.id!.toString(),
      ]);

      for (const callArgs of kind.findBy.mock.calls) {
        const args: JSONObject = callArgs[0] as JSONObject;
        expect(args["skip"]).toBe(0);
        expect(args["limit"]).toBe(LIMIT_MAX);
        expect((args["query"] as JSONObject)["isEnabled"]).toBe(true);
      }
    });

    test("stops after an exactly-full last page, on the empty page that follows it", async () => {
      const projectIds: Array<ObjectID> = [
        ObjectID.generate(),
        ObjectID.generate(),
      ];
      serveRules(kind, rulesCycling(kind, projectIds, 2 * LIMIT_MAX));

      await migration.migrate();

      expect(kind.findBy).toHaveBeenCalledTimes(3);
      expect(cursorsSeen.get(kind.findBy)![2]).not.toBeNull();
      expect(sorted(refreshedProjectIds(kind))).toEqual(sorted(projectIds));
    });

    test("stops after a single partial page without asking for another", async () => {
      const projectId: ObjectID = ObjectID.generate();
      serveRules(kind, rulesCycling(kind, [projectId], 3));

      await migration.migrate();

      expect(kind.findBy).toHaveBeenCalledTimes(1);
      expect(refreshedProjectIds(kind)).toEqual([projectId.toString()]);
    });

    /*
     * Not reachable with a real `_id ASC` + `_id > cursor` read, but a full
     * page that does not move the cursor would be read forever, and this
     * runs in the migrate Job ahead of every later migration.
     */
    test("stops, logs, and still refreshes what it found if a full page does not advance the cursor", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const page: Array<ReminderRule> = rulesCycling(
        kind,
        [projectId],
        LIMIT_MAX,
      );
      kind.findBy.mockResolvedValue(page as never);

      await migration.migrate();

      expect(kind.findBy).toHaveBeenCalledTimes(2);
      expect(refreshedProjectIds(kind)).toEqual([projectId.toString()]);
      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("did not advance its _id cursor"),
      );
    });

    test("skips a rule with no project", async () => {
      const projectId: ObjectID = ObjectID.generate();
      serveRules(kind, makeRules(kind, [undefined, projectId, undefined]));

      await migration.migrate();

      expect(refreshedProjectIds(kind)).toEqual([projectId.toString()]);
    });

    /*
     * The real refresh logs and swallows its own failures, so nothing is
     * expected to escape it. This pins the backstop for whatever does.
     */
    test("logs a throw that escapes one project's refresh, with the project, and carries on to the others", async () => {
      const failing: ObjectID = ObjectID.generate();
      const healthy: Array<ObjectID> = [
        ObjectID.generate(),
        ObjectID.generate(),
      ];
      serveRules(kind, makeRules(kind, [healthy[0], failing, healthy[1]]));

      kind.refresh.mockImplementation((...callArgs: Array<unknown>) => {
        if ((callArgs[0] as ObjectID).toString() === failing.toString()) {
          return Promise.reject(new Error("refresh exploded"));
        }
        return Promise.resolve(undefined);
      });

      await expect(migration.migrate()).resolves.toBeUndefined();

      expect(sorted(refreshedProjectIds(kind))).toEqual(
        sorted([...healthy, failing]),
      );

      const failureLog: Array<unknown> | undefined =
        mockedLogger.error.mock.calls.find((callArgs: Array<unknown>) => {
          return String(callArgs[0]).includes(failing.toString());
        });

      expect(failureLog).toBeDefined();
      expect(String(failureLog![0])).toContain("refresh exploded");
      expect(failureLog![1]).toEqual({ projectId: failing.toString() });
      expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    });

    test("still refreshes the projects read before a later page failed", async () => {
      const firstPageProject: ObjectID = ObjectID.generate();
      const firstPage: Array<ReminderRule> = rulesCycling(
        kind,
        [firstPageProject],
        LIMIT_MAX,
      );

      kind.findBy
        .mockResolvedValueOnce(firstPage as never)
        .mockRejectedValueOnce(new Error("connection reset") as never);

      await expect(migration.migrate()).resolves.toBeUndefined();

      expect(refreshedProjectIds(kind)).toEqual([firstPageProject.toString()]);
      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("connection reset"),
      );
    });
  });

  describe("across kinds", () => {
    test("refreshes each kind only for the projects that have that kind's rules", async () => {
      const incidentOnly: ObjectID = ObjectID.generate();
      const alertOnly: ObjectID = ObjectID.generate();
      const both: ObjectID = ObjectID.generate();
      const maintenanceOnly: ObjectID = ObjectID.generate();

      serveRules(INCIDENT, makeRules(INCIDENT, [incidentOnly, both, both]));
      serveRules(ALERT, makeRules(ALERT, [both, alertOnly]));
      serveRules(
        SCHEDULED_MAINTENANCE,
        makeRules(SCHEDULED_MAINTENANCE, [maintenanceOnly]),
      );

      await migration.migrate();

      expect(sorted(refreshedProjectIds(INCIDENT))).toEqual(
        sorted([incidentOnly, both]),
      );
      expect(sorted(refreshedProjectIds(ALERT))).toEqual(
        sorted([alertOnly, both]),
      );
      expect(refreshedProjectIds(SCHEDULED_MAINTENANCE)).toEqual([
        maintenanceOnly.toString(),
      ]);
      expect(mockedLogger.error).not.toHaveBeenCalled();
    });

    test.each(KINDS)(
      "the other kinds still run when the $label rules cannot be read at all",
      async (broken: KindUnderTest) => {
        const projectId: ObjectID = ObjectID.generate();

        for (const kind of KINDS) {
          serveRules(kind, makeRules(kind, [projectId]));
        }

        broken.findBy.mockRejectedValue(
          new Error("relation does not exist") as never,
        );

        await expect(migration.migrate()).resolves.toBeUndefined();

        for (const kind of KINDS) {
          if (kind === broken) {
            expect(kind.refresh).not.toHaveBeenCalled();
          } else {
            expect(refreshedProjectIds(kind)).toEqual([projectId.toString()]);
          }
        }

        expect(mockedLogger.error).toHaveBeenCalledTimes(1);
        expect(mockedLogger.error).toHaveBeenCalledWith(
          expect.stringContaining(`enabled ${broken.label} reminder rule`),
        );
      },
    );

    /*
     * No failure count: the refresh logs its own failures and never lets
     * one escape, so a count kept here would always read zero and tell an
     * operator that nothing failed when it cannot know.
     */
    test("logs one summary per kind, with the number of projects walked and no failure count", async () => {
      serveRules(
        INCIDENT,
        makeRules(INCIDENT, [ObjectID.generate(), ObjectID.generate()]),
      );

      await migration.migrate();

      const summaries: Array<string> = mockedLogger.info.mock.calls.map(
        (callArgs: Array<unknown>): string => {
          return String(callArgs[0]);
        },
      );

      expect(summaries).toHaveLength(3);
      expect(summaries[0]).toContain("open incident reminders of 2 project(s)");
      expect(summaries[1]).toContain("open alert reminders of 0 project(s)");
      expect(summaries[2]).toContain(
        "open scheduled maintenance reminders of 0 project(s)",
      );

      for (const summary of summaries) {
        expect(summary).not.toMatch(/\d+ failed/);
        expect(summary).toContain(
          "Failures are not counted here: the refresh logs each",
        );
        expect(summary).toContain("with the projectId");
      }
    });
  });

  test("rollback touches nothing", async () => {
    await expect(migration.rollback()).resolves.toBeUndefined();

    for (const kind of KINDS) {
      expect(kind.findBy).not.toHaveBeenCalled();
      expect(kind.refresh).not.toHaveBeenCalled();
    }
  });
});
