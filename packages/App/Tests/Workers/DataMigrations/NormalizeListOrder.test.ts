import AllModelTypes from "Common/Models/DatabaseModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import logger from "Common/Server/Utils/Logger";
import NormalizeListOrder from "../../../FeatureSet/Workers/DataMigrations/NormalizeListOrder";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * NormalizeListOrder numbers the drag-ordered lists saved before the server
 * kept their numbers - every log pipeline was saved as 1, incident custom
 * fields could have none - so a drop on them lands where it is dropped.
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts (as text - an unregistered
 *      migration never runs), once, before the slot AddAuditLogMcpClientColumns
 *      keeps last;
 *   2. it covers exactly the models marked @ListOrderColumn: a list added
 *      later without being added here would never be healed;
 *   3. it asks each of their services to renumber its lists;
 *   4. one table's failure is logged and the rest still run - a data
 *      migration that throws halts every migration after it.
 */

const MIGRATION_NAME: string = "NormalizeListOrder";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

type ModelType = { new (): BaseModel };

describe("NormalizeListOrder", () => {
  const migration: NormalizeListOrder = new NormalizeListOrder();

  let calls: Array<string>;
  let failing: Set<string>;
  let errorLogs: Array<string>;

  beforeEach(() => {
    calls = [];
    failing = new Set<string>();
    errorLogs = [];

    jest.spyOn(logger, "error").mockImplementation((message: unknown): void => {
      errorLogs.push(String(message));
      return undefined;
    });
    jest.spyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });

    for (const service of NormalizeListOrder.getServices()) {
      jest
        .spyOn(service, "normalizeListOrders")
        .mockImplementation((async (): Promise<{
          lists: number;
          rowsChanged: number;
        }> => {
          const table: string = service.getModel().tableName || "";
          calls.push(table);

          if (failing.has(table)) {
            throw new Error(`${table} is locked`);
          }

          return { lists: 1, rowsChanged: 2 };
        }) as never);
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is named after itself, so it runs once", () => {
    expect(migration.name).toBe(MIGRATION_NAME);
  });

  test("is registered once, before the slot AddAuditLogMcpClientColumns keeps last", () => {
    const index: string = fs
      .readFileSync(path.join(DATA_MIGRATIONS_DIR, "Index.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

    expect(index).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

    const registered: Array<string> = Array.from(
      index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 1,
    );
  });

  test("covers exactly the lists that are put in order by dragging", () => {
    const listTables: Array<string> = (
      AllModelTypes as unknown as Array<ModelType>
    )
      .filter((modelType: ModelType) => {
        return Boolean(new modelType().getListOrder());
      })
      .map((modelType: ModelType) => {
        return new modelType().tableName || "";
      })
      .sort();

    const coveredTables: Array<string> = NormalizeListOrder.getServices()
      .map((service: DatabaseService<any>) => {
        return service.getModel().tableName || "";
      })
      .sort();

    expect(listTables.length).toBeGreaterThan(20);
    expect(coveredTables).toEqual(listTables);
  });

  test("asks every one of them to renumber its lists", async () => {
    await migration.migrate();

    expect(calls.sort()).toEqual(
      NormalizeListOrder.getServices()
        .map((service: DatabaseService<any>) => {
          return service.getModel().tableName || "";
        })
        .sort(),
    );
  });

  test("a table that cannot be renumbered is logged and the rest still are", async () => {
    failing.add("LogPipeline");

    await expect(migration.migrate()).resolves.toBeUndefined();

    expect(calls).toContain("LogPipeline");
    expect(calls).toContain("TracePipeline");
    expect(calls).toHaveLength(NormalizeListOrder.getServices().length);
    expect(errorLogs.join("\n")).toContain("LogPipeline is locked");
  });

  test("has nothing to roll back: the lists are shown in the same order as before", async () => {
    await expect(migration.rollback()).resolves.toBeUndefined();
  });
});
