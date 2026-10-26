import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorTemplateService from "Common/Server/Services/MonitorTemplateService";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import MonitorType from "Common/Types/Monitor/MonitorType";
import FillSyntheticMonitorBrowsersAndScreenSizes, {
  PAGE_SIZE,
} from "../../../FeatureSet/Workers/DataMigrations/FillSyntheticMonitorBrowsersAndScreenSizes";
import fs from "fs";
import path from "path";

/*
 * Synthetic monitors and templates stored with a step that lists no browser
 * or no screen size ran nothing and never failed. This gives each such step
 * Chromium at Desktop - what a new step starts on - and nothing else.
 *
 * No Postgres here: what is pinned is which rows are read and written, with
 * what, and that a row is only written while it still holds what was read.
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

const MIGRATION_NAME: string = "FillSyntheticMonitorBrowsersAndScreenSizes";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const mockedLogger: { error: jest.Mock; info: jest.Mock } =
  logger as unknown as { error: jest.Mock; info: jest.Mock };

function syntheticSteps(lists: {
  browserTypes?: unknown;
  screenSizeTypes?: unknown;
}): JSONObject {
  const value: JSONObject = {
    id: "0b9b1f47-1e8e-4a8b-9f43-3d2b8f4c1a11",
    customCode: "await page.goto('https://shop.example.com');",
    retryCountOnError: 2,
    monitorCriteria: {
      _type: "MonitorCriteria",
      value: {
        monitorCriteriaInstanceArray: [
          {
            _type: "MonitorCriteriaInstance",
            value: {
              id: "6c8cf9ad-16cf-4ae5-8443-8afc4d462277",
              name: "Check if the journey fails",
              filters: [{ checkOn: "Error", filterType: "Is Not Empty" }],
              incidents: [],
              alerts: [],
              filterCondition: "Any",
            },
          },
        ],
      },
    },
  };

  if ("browserTypes" in lists) {
    value["browserTypes"] = lists.browserTypes as JSONObject;
  }

  if ("screenSizeTypes" in lists) {
    value["screenSizeTypes"] = lists.screenSizeTypes as JSONObject;
  }

  return {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: [{ _type: "MonitorStep", value: value }],
      defaultMonitorStatusId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
  };
}

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

interface StubbedRow {
  _id: string;
  monitorType: string;
  monitorSteps: unknown;
}

interface StubbedTable {
  statements: Array<Statement>;
  rows: Array<StubbedRow>;
  failUpdatesFor: Set<string>;
}

/*
 * Answers the migration's SELECT from `rows` - the rows of the type it asks
 * for, paged by id as Postgres would page them - and records every
 * statement.
 */
function stubTable(
  service: DatabaseService<BaseModel>,
  tableName: string,
): StubbedTable {
  const table: StubbedTable = {
    statements: [],
    rows: [],
    failUpdatesFor: new Set<string>(),
  };

  const query: jest.Mock = jest.fn(
    async (sql: unknown, parameters: unknown): Promise<unknown> => {
      const statement: Statement = {
        sql: String(sql),
        parameters: (parameters as Array<unknown>) || [],
      };
      table.statements.push(statement);

      if (statement.sql.startsWith("SELECT")) {
        const limit: number = statement.parameters[0] as number;
        const monitorType: string = statement.parameters[1] as string;
        const after: string | undefined = statement.parameters[2] as
          | string
          | undefined;

        return table.rows
          .filter((row: StubbedRow) => {
            return (
              row.monitorType === monitorType &&
              row.monitorSteps !== null &&
              (!after || row._id > after)
            );
          })
          .sort((a: StubbedRow, b: StubbedRow) => {
            return a._id < b._id ? -1 : 1;
          })
          .slice(0, limit)
          .map((row: StubbedRow) => {
            return { _id: row._id, monitorSteps: row.monitorSteps };
          });
      }

      if (table.failUpdatesFor.has(statement.parameters[1] as string)) {
        throw new Error("could not write");
      }

      return [];
    },
  ) as unknown as jest.Mock;

  jest.spyOn(service, "getRepository").mockReturnValue({
    metadata: { tableName },
    manager: { query },
  } as never);

  return table;
}

function updatesOf(table: StubbedTable): Array<Statement> {
  return table.statements.filter((statement: Statement) => {
    return statement.sql.startsWith("UPDATE");
  });
}

function writtenStep(update: Statement): JSONObject {
  const written: JSONObject = JSON.parse(
    update.parameters[0] as string,
  ) as JSONObject;

  return (
    (written["value"] as JSONObject)[
      "monitorStepsInstanceArray"
    ] as Array<JSONObject>
  )[0]!["value"] as JSONObject;
}

describe("FillSyntheticMonitorBrowsersAndScreenSizes", () => {
  const migration: FillSyntheticMonitorBrowsersAndScreenSizes =
    new FillSyntheticMonitorBrowsersAndScreenSizes();

  let monitors: StubbedTable;
  let templates: StubbedTable;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    monitors = stubTable(
      MonitorService as unknown as DatabaseService<BaseModel>,
      "Monitor",
    );
    templates = stubTable(
      MonitorTemplateService as unknown as DatabaseService<BaseModel>,
      "MonitorTemplate",
    );
  });

  describe("registration", () => {
    const indexSource: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    function registeredMigrations(): Array<string> {
      return Array.from(indexSource.matchAll(/new\s+(\w+)\(\)/g)).map(
        (match: RegExpMatchArray) => {
          return match[1]!;
        },
      );
    }

    test("is imported and instantiated in DataMigrations/Index.ts, exactly once", () => {
      expect(indexSource).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );
      expect(
        registeredMigrations().filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
    });

    test("sits above the runbook moves, which keep their places right before the last slot", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(instantiations[instantiations.length - 1]).toBe(
        "AddAuditLogMcpClientColumns",
      );
      expect(instantiations.indexOf(MIGRATION_NAME)).toBeLessThan(
        instantiations.indexOf("MoveRunbookApprovalsBeforeTheirSteps"),
      );
      expect(instantiations.indexOf(MIGRATION_NAME)).toBeGreaterThan(-1);
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(migration.name).toBe(MIGRATION_NAME);
    });
  });

  describe("what it reads", () => {
    test("asks each table for its Synthetic rows only, templates first", async () => {
      await migration.migrate();

      for (const table of [templates, monitors]) {
        const select: Statement = table.statements[0]!;

        expect(select.sql).toContain(`"monitorType" = $2`);
        expect(select.sql).toContain(`"monitorSteps" IS NOT NULL`);
        expect(select.parameters[1]).toBe(MonitorType.SyntheticMonitor);
      }

      expect(templates.statements[0]!.sql).toContain(`FROM "MonitorTemplate"`);
      expect(monitors.statements[0]!.sql).toContain(`FROM "Monitor"`);

      const templateCall: number = (
        (
          MonitorTemplateService.getRepository().manager.query as jest.Mock
        ).mock.invocationCallOrder as Array<number>
      )[0]!;
      const monitorCall: number = (
        (MonitorService.getRepository().manager.query as jest.Mock).mock
          .invocationCallOrder as Array<number>
      )[0]!;

      expect(templateCall).toBeLessThan(monitorCall);
    });

    test("never touches another type's steps, even with no browsers in them", async () => {
      monitors.rows = [
        {
          _id: "a",
          monitorType: MonitorType.CustomJavaScriptCode,
          monitorSteps: syntheticSteps({}),
        },
      ];

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(0);
    });

    test("pages through every row, however many there are", async () => {
      monitors.rows = Array.from(
        { length: PAGE_SIZE * 2 + 3 },
        (_value: unknown, index: number): StubbedRow => {
          return {
            _id: `row-${String(index).padStart(5, "0")}`,
            monitorType: MonitorType.SyntheticMonitor,
            monitorSteps: syntheticSteps({ browserTypes: [] }),
          };
        },
      );

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(PAGE_SIZE * 2 + 3);
      expect(
        monitors.statements.filter((statement: Statement) => {
          return statement.sql.startsWith("SELECT");
        }),
      ).toHaveLength(3);
    });
  });

  describe("what it writes", () => {
    test("gives a step stored with neither list Chromium at Desktop", async () => {
      monitors.rows = [
        {
          _id: "850bccad-488f-41d5-9c0f-77a146fc6ba0",
          monitorType: MonitorType.SyntheticMonitor,
          monitorSteps: syntheticSteps({}),
        },
      ];

      await migration.migrate();

      const updates: Array<Statement> = updatesOf(monitors);
      expect(updates).toHaveLength(1);
      expect(writtenStep(updates[0]!)["browserTypes"]).toEqual(["Chromium"]);
      expect(writtenStep(updates[0]!)["screenSizeTypes"]).toEqual(["Desktop"]);
      expect(updates[0]!.parameters[1]).toBe(
        "850bccad-488f-41d5-9c0f-77a146fc6ba0",
      );
    });

    test("fills only the empty list, and keeps a browser someone picked", async () => {
      templates.rows = [
        {
          _id: "t",
          monitorType: MonitorType.SyntheticMonitor,
          monitorSteps: syntheticSteps({
            browserTypes: ["Firefox"],
            screenSizeTypes: [],
          }),
        },
      ];

      await migration.migrate();

      const step: JSONObject = writtenStep(updatesOf(templates)[0]!);
      expect(step["browserTypes"]).toEqual(["Firefox"]);
      expect(step["screenSizeTypes"]).toEqual(["Desktop"]);
    });

    test("changes nothing but the empty lists", async () => {
      const stored: JSONObject = syntheticSteps({ browserTypes: null });
      monitors.rows = [
        {
          _id: "a",
          monitorType: MonitorType.SyntheticMonitor,
          monitorSteps: stored,
        },
      ];

      await migration.migrate();

      const written: JSONObject = JSON.parse(
        updatesOf(monitors)[0]!.parameters[0] as string,
      ) as JSONObject;
      const withoutLists: (value: unknown) => unknown = (
        value: unknown,
      ): unknown => {
        return JSON.parse(
          JSON.stringify(value, (key: string, item: unknown) => {
            return key === "browserTypes" || key === "screenSizeTypes"
              ? undefined
              : item;
          }),
        );
      };

      expect(withoutLists(written)).toEqual(withoutLists(stored));
    });

    test("leaves a step that already runs somewhere alone", async () => {
      monitors.rows = [
        {
          _id: "a",
          monitorType: MonitorType.SyntheticMonitor,
          monitorSteps: syntheticSteps({
            browserTypes: ["Chromium", "Firefox"],
            screenSizeTypes: ["Mobile"],
          }),
        },
      ];

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(0);
    });

    test("writes a row only while it still holds what was read", async () => {
      const stored: JSONObject = syntheticSteps({});
      monitors.rows = [
        {
          _id: "a",
          monitorType: MonitorType.SyntheticMonitor,
          monitorSteps: stored,
        },
      ];

      await migration.migrate();

      const update: Statement = updatesOf(monitors)[0]!;
      expect(update.sql).toBe(
        `UPDATE "Monitor" SET "monitorSteps" = $1 WHERE "_id" = $2 AND "monitorSteps" = $3::jsonb`,
      );
      expect(JSON.parse(update.parameters[2] as string)).toEqual(stored);
    });

    test("reads a column a driver hands back as text", async () => {
      monitors.rows = [
        {
          _id: "a",
          monitorType: MonitorType.SyntheticMonitor,
          monitorSteps: JSON.stringify(syntheticSteps({})),
        },
        {
          _id: "b",
          monitorType: MonitorType.SyntheticMonitor,
          monitorSteps: "not json",
        },
      ];

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(1);
      expect(writtenStep(updatesOf(monitors)[0]!)["browserTypes"]).toEqual([
        "Chromium",
      ]);
    });

    test("a row that cannot be written costs no other row its fix", async () => {
      monitors.rows = [
        {
          _id: "a",
          monitorType: MonitorType.SyntheticMonitor,
          monitorSteps: syntheticSteps({}),
        },
        {
          _id: "b",
          monitorType: MonitorType.SyntheticMonitor,
          monitorSteps: syntheticSteps({}),
        },
      ];
      monitors.failUpdatesFor.add("a");

      await expect(migration.migrate()).resolves.toBeUndefined();

      expect(updatesOf(monitors)).toHaveLength(2);
      expect(mockedLogger.error).toHaveBeenCalled();
      expect(
        mockedLogger.info.mock.calls.some((call: Array<unknown>): boolean => {
          return String(call[0]).includes("1 could not be written");
        }),
      ).toBe(true);
    });

    test("a second run finds nothing left to fill", async () => {
      const stored: JSONObject = syntheticSteps({});
      monitors.rows = [
        {
          _id: "a",
          monitorType: MonitorType.SyntheticMonitor,
          monitorSteps: stored,
        },
      ];

      await migration.migrate();
      monitors.rows[0]!.monitorSteps = JSON.parse(
        updatesOf(monitors)[0]!.parameters[0] as string,
      ) as JSONObject;
      monitors.statements = [];

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(0);
    });

    test("its rollback is a no-op", async () => {
      await expect(migration.rollback()).resolves.toBeUndefined();
      expect(monitors.statements).toHaveLength(0);
      expect(templates.statements).toHaveLength(0);
    });
  });
});
