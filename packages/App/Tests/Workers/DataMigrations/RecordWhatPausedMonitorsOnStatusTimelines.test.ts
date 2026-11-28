import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import MonitorPausedBy from "Common/Types/Monitor/MonitorPausedBy";
import escapeRegExp from "Common/Utils/RegExpEscape";
import {
  MONITORING_PAUSED_BY_INCIDENTS,
  MONITORING_PAUSED_BY_INCIDENTS_AND_MAINTENANCE,
  MONITORING_PAUSED_FOR_MAINTENANCE,
  MONITORING_TURNED_OFF,
  PAUSING_INCIDENTS_SET_STATUS,
  writeStatusChangeNote,
} from "Common/Utils/Monitor/StatusChangeNotes";
import RecordWhatPausedMonitorsOnStatusTimelines, {
  PAGE_SIZE,
  PAUSED_BY_BOTH_NOTE_PART,
  PAUSED_FOR_MAINTENANCE_NOTE_PREFIX,
  PAUSED_NOTE_PREFIX,
  RECORD_WHAT_PAUSED_SQL,
} from "../../../FeatureSet/Workers/DataMigrations/RecordWhatPausedMonitorsOnStatusTimelines";
import fs from "fs";
import path from "path";

/*
 * RecordWhatPausedMonitorsOnStatusTimelines (issue #11433): fills in, on
 * every status event that left a monitor's time out of uptime because of a
 * pause, what paused it (MonitorStatusTimeline.pausedBy), from the note each
 * was written with - so time paused before the upgrade reads "paused" too.
 *
 * Here: where it is registered, how it pages, what its statement reads of
 * each note OneUptime writes, and that a failing page holds nothing back.
 * The statement runs against Postgres in MaintenancePausedTimeUptimePostgres.
 */

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

const MIGRATION_NAME: string = "RecordWhatPausedMonitorsOnStatusTimelines";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

function idOf(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

function registeredMigrations(): Array<string> {
  const index: string = fs.readFileSync(
    path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
    "utf8",
  );

  expect(index).toContain(
    `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
  );

  return Array.from(
    index.replace(/\/\*[\s\S]*?\*\//g, " ").matchAll(/new ([A-Za-z0-9]+)\(\)/g),
  ).map((match: RegExpMatchArray): string => {
    return match[1]!;
  });
}

function stubTable(data: {
  ids: Array<string>;
  failingPageStartsAt?: string | undefined;
}): Array<Statement> {
  const statements: Array<Statement> = [];

  const query: jest.Mock = jest.fn(
    async (sql: unknown, parameters: unknown): Promise<unknown> => {
      const statement: Statement = {
        sql: String(sql),
        parameters: (parameters as Array<unknown>) || [],
      };
      statements.push(statement);

      if (statement.sql === RECORD_WHAT_PAUSED_SQL) {
        const pageIds: Array<string> = statement.parameters[0] as Array<string>;

        if (
          data.failingPageStartsAt &&
          pageIds[0] === data.failingPageStartsAt
        ) {
          throw new Error("canceling statement due to lock timeout");
        }

        // Each monitor of the page had one mark to fill in.
        const written: Array<{ _id: string }> = pageIds.map(
          (_id: string): { _id: string } => {
            return { _id: _id };
          },
        );

        return [written, written.length];
      }

      const limit: number = statement.parameters[0] as number;
      const after: string | undefined = statement.parameters[1] as
        | string
        | undefined;

      return data.ids
        .filter((id: string): boolean => {
          return !after || id > after;
        })
        .sort()
        .slice(0, limit)
        .map((id: string): { _id: string } => {
          return { _id: id };
        });
    },
  ) as unknown as jest.Mock;

  jest
    .spyOn(
      MonitorService as unknown as DatabaseService<BaseModel>,
      "getRepository",
    )
    .mockReturnValue({
      metadata: { tableName: "Monitor" },
      manager: { query },
    } as never);

  return statements;
}

function updatesOf(statements: Array<Statement>): Array<Array<string>> {
  return statements
    .filter((statement: Statement): boolean => {
      return statement.sql === RECORD_WHAT_PAUSED_SQL;
    })
    .map((statement: Statement): Array<string> => {
      return statement.parameters[0] as Array<string>;
    });
}

/*
 * What the statement's CASE makes of a note: its LIKE patterns as regular
 * expressions (only % is a wildcard in them: they hold no _), tried in its
 * order.
 */
function likeToRegExp(pattern: string): RegExp {
  return new RegExp(
    `^${pattern
      .split("%")
      .map((part: string): string => {
        return escapeRegExp(part);
      })
      .join("[\\s\\S]*")}$`,
  );
}

function readByStatement(note: string): string | null {
  const patterns: Array<string> = Array.from(
    RECORD_WHAT_PAUSED_SQL.matchAll(/LIKE '([^']*)'/g),
  ).map((match: RegExpMatchArray): string => {
    return match[1]!;
  });
  // The WHERE's pattern is the last; the CASE's are before it.
  const [forMaintenance, byBoth, anyPause] = [
    patterns[0]!,
    patterns[1]!,
    patterns[2]!,
  ];

  if (!likeToRegExp(anyPause).test(note)) {
    return null;
  }

  if (likeToRegExp(forMaintenance).test(note)) {
    return MonitorPausedBy.ScheduledMaintenance;
  }

  if (likeToRegExp(byBoth).test(note)) {
    return MonitorPausedBy.IncidentAndScheduledMaintenance;
  }

  return MonitorPausedBy.Incident;
}

const INCIDENT_LINK: string = "[INC-12](https://oneuptime.example/incidents/1)";
const INCIDENTS_LINK: string =
  "[INC-12](https://oneuptime.example/incidents/1) and [INC-14](https://oneuptime.example/incidents/2)";
const EVENT_LINK: string =
  "[SM-3](https://oneuptime.example/scheduled-maintenance/1)";

describe("RecordWhatPausedMonitorsOnStatusTimelines", () => {
  const migration: RecordWhatPausedMonitorsOnStatusTimelines =
    new RecordWhatPausedMonitorsOnStatusTimelines();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.mocked(logger.error).mockClear();
  });

  test("is registered once, after the maintenance pause's own migration, before the two slots kept last", () => {
    const registered: Array<string> = registeredMigrations();

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      registered.indexOf("LeaveTimeOfMonitorsPausedForMaintenanceOutOfUptime"),
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 2,
    );
    expect(migration.name).toBe(MIGRATION_NAME);
  });

  test("the statement writes only marks of a pause with nothing filled in yet, of the page's monitors", () => {
    expect(RECORD_WHAT_PAUSED_SQL).toContain(
      `WHERE "timeline"."monitorId" = ANY($1::uuid[])`,
    );
    expect(RECORD_WHAT_PAUSED_SQL).toContain(
      `"timeline"."isMonitoringOff" = true`,
    );
    expect(RECORD_WHAT_PAUSED_SQL).toContain(`"timeline"."pausedBy" IS NULL`);
    expect(RECORD_WHAT_PAUSED_SQL).toContain(
      `"timeline"."rootCause" LIKE '${PAUSED_NOTE_PREFIX}%'`,
    );
    // No wildcard of LIKE's but % in its patterns.
    for (const pattern of [
      PAUSED_NOTE_PREFIX,
      PAUSED_FOR_MAINTENANCE_NOTE_PREFIX,
      PAUSED_BY_BOTH_NOTE_PART,
    ]) {
      expect(pattern).not.toContain("_");
      expect(pattern).not.toContain("'");
    }
  });

  test.each([
    [
      "an incident's pause",
      writeStatusChangeNote(MONITORING_PAUSED_BY_INCIDENTS, {
        incidents: INCIDENT_LINK,
      }),
      MonitorPausedBy.Incident,
    ],
    [
      "two incidents' pause",
      writeStatusChangeNote(MONITORING_PAUSED_BY_INCIDENTS, {
        incidents: INCIDENTS_LINK,
      }),
      MonitorPausedBy.Incident,
    ],
    [
      "maintenance's pause",
      writeStatusChangeNote(MONITORING_PAUSED_FOR_MAINTENANCE, {
        events: EVENT_LINK,
      }),
      MonitorPausedBy.ScheduledMaintenance,
    ],
    [
      "both at once",
      writeStatusChangeNote(MONITORING_PAUSED_BY_INCIDENTS_AND_MAINTENANCE, {
        incidents: INCIDENTS_LINK,
        events: EVENT_LINK,
      }),
      MonitorPausedBy.IncidentAndScheduledMaintenance,
    ],
    [
      "monitoring turned off",
      writeStatusChangeNote(MONITORING_TURNED_OFF, {}),
      null,
    ],
    [
      "the time counted again",
      writeStatusChangeNote(PAUSING_INCIDENTS_SET_STATUS, {
        incidents: INCIDENT_LINK,
      }),
      null,
    ],
    ["a note a person typed", "Paused it myself while we migrate", null],
  ] as Array<[string, string, string | null]>)(
    "the note of %s is read as what paused the monitor",
    (_label: string, note: string, pausedBy: string | null) => {
      expect(readByStatement(note)).toBe(pausedBy);
    },
  );

  test("pages through every monitor by id, one statement per page, and counts what it filled in", async () => {
    const ids: Array<string> = [];

    for (let index: number = 0; index < PAGE_SIZE * 2 + 3; index++) {
      ids.push(idOf(index));
    }

    const statements: Array<Statement> = stubTable({ ids: ids });

    await migration.migrate();

    const pages: Array<Array<string>> = updatesOf(statements);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toHaveLength(PAGE_SIZE);
    expect(pages[1]![0]).toBe(idOf(PAGE_SIZE));
    expect(pages[2]).toEqual([
      idOf(PAGE_SIZE * 2),
      idOf(PAGE_SIZE * 2 + 1),
      idOf(PAGE_SIZE * 2 + 2),
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(
        `recorded what paused ${PAGE_SIZE * 2 + 3} status event(s) of ${PAGE_SIZE * 2 + 3} monitor(s); 0 monitor(s) could not be read.`,
      ),
    );
  });

  test("a page that fails is logged, and the pages after it are still written", async () => {
    const ids: Array<string> = [];

    for (let index: number = 0; index < PAGE_SIZE + 2; index++) {
      ids.push(idOf(index));
    }

    const statements: Array<Statement> = stubTable({
      ids: ids,
      failingPageStartsAt: idOf(0),
    });

    await expect(migration.migrate()).resolves.toBeUndefined();

    expect(updatesOf(statements)).toHaveLength(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "their paused time keeps reading as monitoring off",
      ),
    );
  });

  test("no monitors: nothing written", async () => {
    const statements: Array<Statement> = stubTable({ ids: [] });

    await migration.migrate();

    expect(updatesOf(statements)).toEqual([]);
  });

  test("rollback changes nothing", async () => {
    await expect(migration.rollback()).resolves.toBeUndefined();
  });

  test("countRows reads either shape the driver answers with", () => {
    expect(
      RecordWhatPausedMonitorsOnStatusTimelines.countRows([[{ _id: "a" }], 1]),
    ).toBe(1);
    expect(
      RecordWhatPausedMonitorsOnStatusTimelines.countRows([
        { _id: "a" },
        { _id: "b" },
      ]),
    ).toBe(2);
    expect(RecordWhatPausedMonitorsOnStatusTimelines.countRows(null)).toBe(0);
  });
});
