import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #6443: a RUM application's own frustration signals are counted on
 * the session and chunk tables - customSignalCount,
 * customSignalFrustrationCount and customSignalNames. The ingest writes them
 * on every chunk, and an insert that names a column the table does not have
 * is refused, so until they exist no replay chunk would be stored.
 *
 * This migration is the non-cluster path's way of getting them there.
 * Pinned: it adds exactly those three columns to both tables, as the models
 * declare them; it is idempotent; a column a model does not declare is
 * skipped with a warning (the runner halts at the first failure); a real
 * failure is a failure that names the column; it is baselined on the
 * clustered schema; its rollback drops nothing; and it runs once, before
 * the last slot.
 */

jest.mock("Common/Server/Services/RumSessionService", () => {
  return {
    __esModule: true,
    default: {
      getColumnTypeInDatabase: jest.fn(),
      addColumnInDatabase: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/RumSessionChunkService", () => {
  return {
    __esModule: true,
    default: {
      getColumnTypeInDatabase: jest.fn(),
      addColumnInDatabase: jest.fn(),
    },
  };
});

/*
 * The real chunk model, with a switch to hide columns from it: the only way
 * to show what the migration does about a column the model does not declare
 * without editing the model.
 */
jest.mock("Common/Models/AnalyticsModels/RumSessionChunk", () => {
  type ColumnLike = { key: string };
  type ChunkLike = { tableColumns: Array<ColumnLike> };

  const actual: { default: new () => ChunkLike } = jest.requireActual(
    "Common/Models/AnalyticsModels/RumSessionChunk",
  ) as { default: new () => ChunkLike };

  const hiddenColumnKeys: Array<string> = [];

  class ChunkWithHiddenColumns extends actual.default {
    public constructor() {
      super();
      this.tableColumns = this.tableColumns.filter(
        (column: ColumnLike): boolean => {
          return !hiddenColumnKeys.includes(column.key);
        },
      );
    }
  }

  return {
    __esModule: true,
    default: ChunkWithHiddenColumns,
    hiddenColumnKeys,
  };
});

import RumSessionService from "Common/Server/Services/RumSessionService";
import RumSessionChunkService from "Common/Server/Services/RumSessionChunkService";
import RumSession from "Common/Models/AnalyticsModels/RumSession";
import RumSessionChunk from "Common/Models/AnalyticsModels/RumSessionChunk";
import logger from "Common/Server/Utils/Logger";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import DataMigrationBase from "../../../FeatureSet/Workers/DataMigrations/DataMigrationBase";
import AddSessionReplayCustomSignalColumns from "../../../FeatureSet/Workers/DataMigrations/AddSessionReplayCustomSignalColumns";

type MockFunction = ReturnType<typeof jest.fn>;

interface ServiceMock {
  getColumnTypeInDatabase: MockFunction;
  addColumnInDatabase: MockFunction;
}

const sessionService: ServiceMock = RumSessionService as unknown as ServiceMock;
const chunkService: ServiceMock =
  RumSessionChunkService as unknown as ServiceMock;

const hiddenChunkColumnKeys: Array<string> = (
  jest.requireMock("Common/Models/AnalyticsModels/RumSessionChunk") as {
    hiddenColumnKeys: Array<string>;
  }
).hiddenColumnKeys;

const COLUMN_KEYS: Array<string> = [
  "customSignalCount",
  "customSignalFrustrationCount",
  "customSignalNames",
];

/* What each table already has, by column key and logical type. */
let sessionTypes: Map<string, TableColumnType>;
let chunkTypes: Map<string, TableColumnType>;
let warnings: Array<string>;

function wire(service: ServiceMock, types: Map<string, TableColumnType>): void {
  service.getColumnTypeInDatabase.mockImplementation(((
    column: AnalyticsTableColumn,
  ) => {
    return Promise.resolve(types.get(column.key) ?? null);
  }) as never);
  service.addColumnInDatabase.mockImplementation(((
    column: AnalyticsTableColumn,
  ) => {
    types.set(column.key, column.type);
    return Promise.resolve(undefined);
  }) as never);
}

function addedKeys(service: ServiceMock): Array<string> {
  return service.addColumnInDatabase.mock.calls.map(
    (call: Array<unknown>): string => {
      return (call[0] as AnalyticsTableColumn).key;
    },
  );
}

beforeEach(() => {
  hiddenChunkColumnKeys.length = 0;
  sessionTypes = new Map<string, TableColumnType>();
  chunkTypes = new Map<string, TableColumnType>();
  warnings = [];

  sessionService.getColumnTypeInDatabase.mockReset();
  sessionService.addColumnInDatabase.mockReset();
  chunkService.getColumnTypeInDatabase.mockReset();
  chunkService.addColumnInDatabase.mockReset();
  wire(sessionService, sessionTypes);
  wire(chunkService, chunkTypes);

  jest.spyOn(logger, "info").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation(((message: unknown) => {
    warnings.push(String(message));
    return undefined;
  }) as never);
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  hiddenChunkColumnKeys.length = 0;
  jest.restoreAllMocks();
});

describe("AddSessionReplayCustomSignalColumns", () => {
  test("has a stable name and is baselined on the clustered schema", () => {
    const migration: AddSessionReplayCustomSignalColumns =
      new AddSessionReplayCustomSignalColumns();

    expect(migration).toBeInstanceOf(DataMigrationBase);
    expect(migration.name).toBe("AddSessionReplayCustomSignalColumns");
    expect(migration.runsInClusterMode()).toBe(false);
  });

  test("both models declare the three columns, with defaults every older row reads as no signals", () => {
    for (const model of [new RumSession(), new RumSessionChunk()]) {
      const byKey: Map<string, AnalyticsTableColumn> = new Map<
        string,
        AnalyticsTableColumn
      >(
        model.tableColumns.map(
          (column: AnalyticsTableColumn): [string, AnalyticsTableColumn] => {
            return [column.key, column];
          },
        ),
      );

      expect(byKey.get("customSignalCount")?.type).toBe(TableColumnType.Number);
      expect(byKey.get("customSignalCount")?.defaultValue).toBe(0);
      expect(byKey.get("customSignalFrustrationCount")?.type).toBe(
        TableColumnType.Number,
      );
      expect(byKey.get("customSignalFrustrationCount")?.defaultValue).toBe(0);
      expect(byKey.get("customSignalNames")?.type).toBe(
        TableColumnType.ArrayText,
      );
      expect(byKey.get("customSignalNames")?.defaultValue).toEqual([]);
      expect(byKey.get("customSignalNames")?.required).toBe(true);
    }

    /* The session's names are a bloom-pruned lookup, like its routes. */
    const names: AnalyticsTableColumn | undefined =
      new RumSession().tableColumns.find(
        (column: AnalyticsTableColumn): boolean => {
          return column.key === "customSignalNames";
        },
      );
    expect(names?.skipIndex?.name).toBe("idx_custom_signal_names");
  });

  test("adds exactly the three columns to both tables, as the models declare them", async () => {
    await new AddSessionReplayCustomSignalColumns().migrate();

    expect(addedKeys(sessionService)).toEqual(COLUMN_KEYS);
    expect(addedKeys(chunkService)).toEqual(COLUMN_KEYS);

    const declared: Array<AnalyticsTableColumn> = new RumSession().tableColumns;

    for (const call of sessionService.addColumnInDatabase.mock.calls) {
      const column: AnalyticsTableColumn = call[0] as AnalyticsTableColumn;
      const model: AnalyticsTableColumn | undefined = declared.find(
        (item: AnalyticsTableColumn): boolean => {
          return item.key === column.key;
        },
      );

      expect(column.type).toBe(model?.type);
      expect(column.defaultValue).toEqual(model?.defaultValue);
      expect(column.required).toBe(model?.required);
    }
  });

  test("is idempotent: a second run adds nothing", async () => {
    await new AddSessionReplayCustomSignalColumns().migrate();
    sessionService.addColumnInDatabase.mockClear();
    chunkService.addColumnInDatabase.mockClear();

    await new AddSessionReplayCustomSignalColumns().migrate();

    expect(sessionService.addColumnInDatabase).not.toHaveBeenCalled();
    expect(chunkService.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("a column already there at another type is a failure that names it, and the rest still run", async () => {
    sessionTypes.set("customSignalNames", TableColumnType.Text);

    await expect(
      new AddSessionReplayCustomSignalColumns().migrate(),
    ).rejects.toThrow(
      /RumSessionV1\.customSignalNames: exists with unexpected type/,
    );

    expect(addedKeys(sessionService)).toEqual([
      "customSignalCount",
      "customSignalFrustrationCount",
    ]);
    expect(addedKeys(chunkService)).toEqual(COLUMN_KEYS);
  });

  test("a failed ADD COLUMN is a failure that names the column", async () => {
    chunkService.addColumnInDatabase.mockImplementation((() => {
      return Promise.reject(new Error("TIMEOUT_EXCEEDED"));
    }) as never);

    await expect(
      new AddSessionReplayCustomSignalColumns().migrate(),
    ).rejects.toThrow(/RumSessionChunkV1\.customSignalCount: TIMEOUT_EXCEEDED/);
    expect(addedKeys(sessionService)).toEqual(COLUMN_KEYS);
  });

  test("a column the model does not declare is skipped with a warning, never thrown on", async () => {
    hiddenChunkColumnKeys.push("customSignalNames");

    await expect(
      new AddSessionReplayCustomSignalColumns().migrate(),
    ).resolves.toBeUndefined();

    expect(addedKeys(chunkService)).toEqual([
      "customSignalCount",
      "customSignalFrustrationCount",
    ]);
    expect(
      warnings.some((message: string): boolean => {
        return message.includes("does not declare customSignalNames");
      }),
    ).toBe(true);
  });

  test("its rollback drops nothing", async () => {
    await expect(
      new AddSessionReplayCustomSignalColumns().rollback(),
    ).resolves.toBeUndefined();
    expect(sessionService.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("runs once, before the slot AddAuditLogMcpClientColumns keeps for itself", () => {
    const index: string = fs
      .readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "FeatureSet",
          "Workers",
          "DataMigrations",
          "Index.ts",
        ),
        "utf8",
      )
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

    expect(index).toContain(
      'import AddSessionReplayCustomSignalColumns from "./AddSessionReplayCustomSignalColumns";',
    );

    const registered: Array<string> = Array.from(
      index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === "AddSessionReplayCustomSignalColumns";
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf("AddSessionReplayCustomSignalColumns")).toBe(
      registered.length - 2,
    );
    expect(
      registered.indexOf("AddSessionReplayCustomSignalColumns"),
    ).toBeGreaterThan(registered.indexOf("AddSessionReplayEngagementColumns"));
  });
});
