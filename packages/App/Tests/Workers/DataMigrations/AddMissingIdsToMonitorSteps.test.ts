import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorTemplateService from "Common/Server/Services/MonitorTemplateService";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import AddMissingIdsToMonitorSteps, {
  PAGE_SIZE,
} from "../../../FeatureSet/Workers/DataMigrations/AddMissingIdsToMonitorSteps";
import fs from "fs";
import path from "path";

/*
 * The at-rest half of the "No check has completed yet" report: monitors and
 * templates the Terraform provider wrote were stored with steps (and incident
 * and alert templates) that had no id. The server gives them ids on every
 * write now; this migration fills in the ones already stored.
 *
 * No Postgres here: what is pinned is which rows are written, with what, and
 * that a row is only written while it still holds what was read.
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

const MIGRATION_NAME: string = "AddMissingIdsToMonitorSteps";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const mockedLogger: { error: jest.Mock; info: jest.Mock } =
  logger as unknown as { error: jest.Mock; info: jest.Mock };

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// A step as the Terraform provider stored it: no ids but the criteria's.
function terraformWrittenSteps(): JSONObject {
  return {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: [
        {
          _type: "MonitorStep",
          value: {
            retryCount: 2,
            requestType: "GET",
            monitorDestination: {
              _type: "URL",
              value: "https://npr.example.com/health",
            },
            monitorCriteria: {
              _type: "MonitorCriteria",
              value: {
                monitorCriteriaInstanceArray: [
                  {
                    _type: "MonitorCriteriaInstance",
                    value: {
                      id: "6c8cf9ad-16cf-4ae5-8443-8afc4d462277",
                      name: "Check if NPR is offline",
                      filters: [{ checkOn: "Is Online", filterType: "False" }],
                      incidents: [
                        {
                          title: "NPR is offline",
                          description: "NPR is currently offline.",
                          autoResolveIncident: true,
                        },
                      ],
                      alerts: [],
                      filterCondition: "Any",
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  };
}

// A step the dashboard wrote: every id present.
function completeSteps(): JSONObject {
  const steps: JSONObject = terraformWrittenSteps();
  const step: JSONObject = (
    (steps["value"] as JSONObject)[
      "monitorStepsInstanceArray"
    ] as Array<JSONObject>
  )[0]!["value"] as JSONObject;
  step["id"] = "0b9b1f47-1e8e-4a8b-9f43-3d2b8f4c1a11";
  const criteria: JSONObject = (
    ((step["monitorCriteria"] as JSONObject)["value"] as JSONObject)[
      "monitorCriteriaInstanceArray"
    ] as Array<JSONObject>
  )[0]!["value"] as JSONObject;
  (criteria["incidents"] as Array<JSONObject>)[0]!["id"] =
    "5d0d6f1e-4f6a-4a51-9b3e-6f2a1c9d7e22";
  return steps;
}

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

interface StubbedTable {
  statements: Array<Statement>;
  rows: Array<{ _id: string; monitorSteps: unknown }>;
  failUpdatesFor: Set<string>;
}

/*
 * Answers the migration's SELECT from `rows`, paged as Postgres would page
 * it, and records every statement.
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
        const after: string | undefined = statement.parameters[1] as
          | string
          | undefined;

        return table.rows
          .filter((row: { _id: string }) => {
            return !after || row._id > after;
          })
          .sort((a: { _id: string }, b: { _id: string }) => {
            return a._id < b._id ? -1 : 1;
          })
          .slice(0, limit);
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

function stepOf(monitorSteps: JSONObject): JSONObject {
  return (
    (monitorSteps["value"] as JSONObject)[
      "monitorStepsInstanceArray"
    ] as Array<JSONObject>
  )[0]!["value"] as JSONObject;
}

function firstCriteriaOf(monitorSteps: JSONObject): JSONObject {
  return (
    (
      (stepOf(monitorSteps)["monitorCriteria"] as JSONObject)[
        "value"
      ] as JSONObject
    )["monitorCriteriaInstanceArray"] as Array<JSONObject>
  )[0]!["value"] as JSONObject;
}

describe("AddMissingIdsToMonitorSteps", () => {
  const migration: AddMissingIdsToMonitorSteps =
    new AddMissingIdsToMonitorSteps();

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

    test("is imported and instantiated in DataMigrations/Index.ts", () => {
      expect(indexSource).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );
      expect(indexSource).toContain(`new ${MIGRATION_NAME}()`);
    });

    test("sits before the last slot, which AddAuditLogMcpClientColumns keeps", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(instantiations[instantiations.length - 1]).toBe(
        "AddAuditLogMcpClientColumns",
      );
      expect(instantiations.indexOf(MIGRATION_NAME)).toBeLessThan(
        instantiations.length - 1,
      );
    });

    test("is registered exactly once", () => {
      expect(
        registeredMigrations().filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }).length,
      ).toBe(1);
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(migration.name).toBe(MIGRATION_NAME);
    });
  });

  describe("what it writes", () => {
    test("adds the missing step and template ids and keeps the criteria id", async () => {
      monitors.rows = [
        {
          _id: "850bccad-488f-41d5-9c0f-77a146fc6ba0",
          monitorSteps: terraformWrittenSteps(),
        },
      ];

      await migration.migrate();

      const updates: Array<Statement> = updatesOf(monitors);
      expect(updates).toHaveLength(1);

      const written: JSONObject = JSON.parse(
        updates[0]!.parameters[0] as string,
      ) as JSONObject;

      expect(stepOf(written)["id"]).toMatch(UUID_PATTERN);
      expect(firstCriteriaOf(written)["id"]).toBe(
        "6c8cf9ad-16cf-4ae5-8443-8afc4d462277",
      );
      expect(
        (firstCriteriaOf(written)["incidents"] as Array<JSONObject>)[0]!["id"],
      ).toMatch(UUID_PATTERN);
      expect(updates[0]!.parameters[1]).toBe(
        "850bccad-488f-41d5-9c0f-77a146fc6ba0",
      );
    });

    test("changes nothing but the missing ids", async () => {
      const stored: JSONObject = terraformWrittenSteps();
      monitors.rows = [{ _id: "a", monitorSteps: stored }];

      await migration.migrate();

      const written: JSONObject = JSON.parse(
        updatesOf(monitors)[0]!.parameters[0] as string,
      ) as JSONObject;

      const withoutIds: (value: unknown) => unknown = (
        value: unknown,
      ): unknown => {
        return JSON.parse(
          JSON.stringify(value, (key: string, item: unknown) => {
            return key === "id" ? undefined : item;
          }),
        );
      };

      expect(withoutIds(written)).toEqual(withoutIds(stored));
      // The default monitor status is the owner's call, not the migration's.
      expect(
        (written["value"] as JSONObject)["defaultMonitorStatusId"],
      ).toBeUndefined();
    });

    test("writes a row only while it still holds what was read", async () => {
      const stored: JSONObject = terraformWrittenSteps();
      monitors.rows = [{ _id: "a", monitorSteps: stored }];

      await migration.migrate();

      const update: Statement = updatesOf(monitors)[0]!;
      expect(update.sql).toBe(
        `UPDATE "Monitor" SET "monitorSteps" = $1 WHERE "_id" = $2 AND "monitorSteps" = $3::jsonb`,
      );
      expect(JSON.parse(update.parameters[2] as string)).toEqual(stored);
    });

    test("leaves rows that already have every id alone", async () => {
      monitors.rows = [{ _id: "a", monitorSteps: completeSteps() }];

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(0);
    });

    test("reads a column handed back as text", async () => {
      monitors.rows = [
        { _id: "a", monitorSteps: JSON.stringify(terraformWrittenSteps()) },
      ];

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(1);
    });

    test("skips values that are not monitor steps", async () => {
      monitors.rows = [
        { _id: "a", monitorSteps: "not json" },
        { _id: "b", monitorSteps: "42" },
        { _id: "c", monitorSteps: {} },
      ];

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(0);
    });

    test("repairs monitor templates as well", async () => {
      templates.rows = [{ _id: "t", monitorSteps: terraformWrittenSteps() }];
      monitors.rows = [{ _id: "m", monitorSteps: terraformWrittenSteps() }];

      await migration.migrate();

      expect(updatesOf(templates)).toHaveLength(1);
      expect(updatesOf(templates)[0]!.sql).toContain(`"MonitorTemplate"`);
      expect(updatesOf(monitors)).toHaveLength(1);
    });
  });

  describe("how it walks the table", () => {
    test("pages by id until a short page", async () => {
      monitors.rows = Array.from(
        { length: PAGE_SIZE + 3 },
        (_value: unknown, index: number) => {
          return {
            _id: `row-${String(index).padStart(5, "0")}`,
            monitorSteps: terraformWrittenSteps(),
          };
        },
      );

      await migration.migrate();

      const selects: Array<Statement> = monitors.statements.filter(
        (statement: Statement) => {
          return statement.sql.startsWith("SELECT");
        },
      );

      expect(selects).toHaveLength(2);
      expect(selects[0]!.parameters).toEqual([PAGE_SIZE]);
      expect(selects[1]!.parameters).toEqual([
        PAGE_SIZE,
        `row-${String(PAGE_SIZE - 1).padStart(5, "0")}`,
      ]);
      expect(updatesOf(monitors)).toHaveLength(PAGE_SIZE + 3);
    });

    test("keeps going after a row it cannot write", async () => {
      monitors.rows = [
        { _id: "a", monitorSteps: terraformWrittenSteps() },
        { _id: "b", monitorSteps: terraformWrittenSteps() },
      ];
      monitors.failUpdatesFor.add("a");

      await expect(migration.migrate()).resolves.toBeUndefined();

      expect(updatesOf(monitors)).toHaveLength(2);
      expect(mockedLogger.error).toHaveBeenCalled();
    });

    test("a second run writes nothing", async () => {
      monitors.rows = [{ _id: "a", monitorSteps: terraformWrittenSteps() }];

      await migration.migrate();

      // What the first run wrote is what the table now holds.
      monitors.rows = [
        {
          _id: "a",
          monitorSteps: JSON.parse(
            updatesOf(monitors)[0]!.parameters[0] as string,
          ),
        },
      ];
      monitors.statements = [];

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(0);
    });
  });
});
