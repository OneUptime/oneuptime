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
 * #8197: the product analytics ingest stored the page a client sent as it
 * was sent, so a client that did not scrub it - the application's own code
 * posting with its ingestion key - could keep "/users/someone@example.com"
 * for months, in a table everyone who reads the application's analytics
 * reads. The ingest scrubs every page now; this migration scrubs the rows
 * stored before.
 *
 * What is pinned:
 *
 *   - the two statements: DELETE the page views named by a page with an
 *     identifier in it (the name is in the sort key, so it cannot be
 *     rewritten), then UPDATE the page of every other event - both on the
 *     local storage table, ON CLUSTER, through the migration connection,
 *     queued without waiting (mutations_sync = 0);
 *   - the rule in SQL is UrlScrubber's, spelled for ClickHouse;
 *   - a table that does not exist is skipped, and a statement that fails
 *     fails the migration, so it is tried again on the next boot;
 *   - its rollback does nothing, it runs on the clustered schema instead of
 *     being baselined, and it is registered once, before the last slot.
 *
 * RedactPersonalDataInProductAnalyticsPagesClickhouse.test.ts runs it
 * against a real ClickHouse server, and holds the SQL rule to the
 * scrubber's over thousands of segments.
 */

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { execute: jest.fn() },
  };
});

jest.mock(
  "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil",
  () => {
    return {
      __esModule: true,
      default: { tableExists: jest.fn() },
    };
  },
);

import { ClickhouseExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import DataMigrationBase from "../../../FeatureSet/Workers/DataMigrations/DataMigrationBase";
import { MaterializeInBackgroundOptions } from "../../../FeatureSet/Workers/DataMigrations/MaterializeAttributeValuesIndex";
import RedactPersonalDataInProductAnalyticsPages, {
  DECODED_SEGMENT_SQL,
  PAGE_SEGMENT_IDENTIFIER_PATTERN,
  hasIdentifierSegmentSql,
  redactedPathSql,
} from "../../../FeatureSet/Workers/DataMigrations/RedactPersonalDataInProductAnalyticsPages";

type MockFunction = ReturnType<typeof jest.fn>;
type MockSpy = ReturnType<typeof jest.spyOn>;

const metricService: { execute: MockFunction } = MetricService as unknown as {
  execute: MockFunction;
};

const migrationUtil: { tableExists: MockFunction } =
  ClickHouseMigrationUtil as unknown as { tableExists: MockFunction };

const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";
const MIGRATION_NAME: string = "RedactPersonalDataInProductAnalyticsPages";
const STORAGE_TABLE: string = "RumProductAnalyticsEventV1Local";

let savedClusterName: string | undefined;
let tableExists: boolean;
let failing: Error | null;
let infoSpy: MockSpy;

function executedStatements(): Array<string> {
  return metricService.execute.mock.calls.map((call: Array<unknown>) => {
    return call[0] as string;
  });
}

function executedOptions(): Array<ClickhouseExecuteOptions> {
  return metricService.execute.mock.calls.map((call: Array<unknown>) => {
    return call[1] as ClickhouseExecuteOptions;
  });
}

beforeEach(() => {
  savedClusterName = process.env[CLUSTER_ENV_KEY];
  delete process.env[CLUSTER_ENV_KEY];

  tableExists = true;
  failing = null;

  metricService.execute.mockReset();
  metricService.execute.mockImplementation(async (): Promise<void> => {
    if (failing) {
      throw failing;
    }
  });

  migrationUtil.tableExists.mockReset();
  migrationUtil.tableExists.mockImplementation(async (): Promise<boolean> => {
    return tableExists;
  });

  infoSpy = jest.spyOn(logger, "info").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  if (savedClusterName === undefined) {
    delete process.env[CLUSTER_ENV_KEY];
  } else {
    process.env[CLUSTER_ENV_KEY] = savedClusterName;
  }

  infoSpy.mockRestore();
});

describe("RedactPersonalDataInProductAnalyticsPages", () => {
  describe("what it is", () => {
    test("is a data migration recorded under its own name", () => {
      const migration: RedactPersonalDataInProductAnalyticsPages =
        new RedactPersonalDataInProductAnalyticsPages();

      expect(migration).toBeInstanceOf(DataMigrationBase);
      // The runner records it by this name: renaming it would run it again.
      expect(migration.name).toBe(MIGRATION_NAME);
    });

    test("runs on the clustered schema instead of being baselined", () => {
      expect(
        new RedactPersonalDataInProductAnalyticsPages().runsInClusterMode(),
      ).toBe(true);
    });

    test("is registered once, before the last slot", () => {
      const index: string = fs
        .readFileSync(
          path.resolve(
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
      expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
        registered.indexOf("AddAuditLogMcpClientColumns"),
      );
      expect(registered[registered.length - 1]).toBe(
        "AddAuditLogMcpClientColumns",
      );
    });
  });

  describe("the statements", () => {
    test("delete the page views whose name has an identifier in it, on the local table of every shard", () => {
      expect(
        RedactPersonalDataInProductAnalyticsPages.getDeletePageViewsStatement(),
      ).toBe(
        `ALTER TABLE ${STORAGE_TABLE} ON CLUSTER 'oneuptime' DELETE WHERE kind = 'page' AND ${hasIdentifierSegmentSql("name")}`,
      );
    });

    test("redact the page of every other event, leaving the event", () => {
      expect(
        RedactPersonalDataInProductAnalyticsPages.getRedactPagesStatement(),
      ).toBe(
        `ALTER TABLE ${STORAGE_TABLE} ON CLUSTER 'oneuptime' UPDATE page = ${redactedPathSql("page")} WHERE kind != 'page' AND ${hasIdentifierSegmentSql("page")}`,
      );
    });

    test("name the cluster the instance runs", () => {
      process.env[CLUSTER_ENV_KEY] = "analytics";

      for (const statement of [
        RedactPersonalDataInProductAnalyticsPages.getDeletePageViewsStatement(),
        RedactPersonalDataInProductAnalyticsPages.getRedactPagesStatement(),
      ]) {
        expect(statement).toContain(
          `ALTER TABLE ${STORAGE_TABLE} ON CLUSTER 'analytics' `,
        );
      }
    });

    test("read each segment as the scrubber does: split on '/', decoded unless an escape is cut short", () => {
      expect(hasIdentifierSegmentSql("page")).toBe(
        `arrayExists(segment -> match(${DECODED_SEGMENT_SQL}, '${PAGE_SEGMENT_IDENTIFIER_PATTERN}'), splitByChar('/', page))`,
      );
      expect(redactedPathSql("page")).toBe(
        `arrayStringConcat(arrayMap(segment -> if(match(${DECODED_SEGMENT_SQL}, '${PAGE_SEGMENT_IDENTIFIER_PATTERN}'), '[redacted]', segment), splitByChar('/', page)), '/')`,
      );
      expect(DECODED_SEGMENT_SQL).toBe(
        "if(match(segment, '%[0-9A-Fa-f]?([^0-9A-Fa-f]|$)'), segment, decodeURLComponent(segment))",
      );
    });

    /*
     * The pattern as ClickHouse reads it ("\\." in the literal is "\."),
     * run here as JavaScript: it is the scrubber's uuid, object id, digit
     * and token rules as they are, and its email rule in ASCII. The
     * ClickHouse suite runs it in ClickHouse against the scrubber itself.
     */
    const PATTERN: RegExp = new RegExp(
      PAGE_SEGMENT_IDENTIFIER_PATTERN.replace(/\\\\/g, "\\"),
    );

    test.each([
      "3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f",
      "3F1A9C7E-5B2D-4801-96A3-C9E7B1D5028F",
      "5f8d0d55b54764421b7156c9",
      "someone@example.com",
      "First.Last+news@Example.co.uk",
      "a@b.co",
      "123456789",
      "4111111111111111",
      "Zx8_kQ2-vT9mL4pR7sW1yB6nC3dF5gH0jK",
      "a".repeat(32),
    ])("takes %p for an identifier", (segment: string) => {
      expect(PATTERN.test(segment)).toBe(true);
    });

    test.each([
      "",
      "orders",
      "42",
      "12345678",
      "a".repeat(31),
      "[redacted]",
      "someone@example",
      "@example.com",
      "a b@example.com",
      "jörg@müller.de",
      // A part of a uuid, too short for a token.
      "3f1a9c7e-5b2d",
      "how-to-ship-on-friday",
    ])("keeps %p", (segment: string) => {
      expect(PATTERN.test(segment)).toBe(false);
    });

    test("never wait for the mutations, nor change what they are run with", () => {
      expect(MaterializeInBackgroundOptions.clickhouseSettings).toMatchObject({
        mutations_sync: "0",
      });
    });
  });

  describe("migrate()", () => {
    test("queues the delete, then the update, in the background", async () => {
      await new RedactPersonalDataInProductAnalyticsPages().migrate();

      expect(migrationUtil.tableExists).toHaveBeenCalledWith(STORAGE_TABLE);
      expect(executedStatements()).toEqual([
        RedactPersonalDataInProductAnalyticsPages.getDeletePageViewsStatement(),
        RedactPersonalDataInProductAnalyticsPages.getRedactPagesStatement(),
      ]);
      expect(executedOptions()).toEqual([
        MaterializeInBackgroundOptions,
        MaterializeInBackgroundOptions,
      ]);
    });

    test("does nothing on an install without the table", async () => {
      tableExists = false;

      await new RedactPersonalDataInProductAnalyticsPages().migrate();

      expect(executedStatements()).toEqual([]);
    });

    test("fails when a mutation cannot be queued, so it is tried again", async () => {
      failing = new Error("ClickHouse is down");

      await expect(
        new RedactPersonalDataInProductAnalyticsPages().migrate(),
      ).rejects.toThrow("ClickHouse is down");
    });

    test("queues the same mutations again when run again, which find nothing left", async () => {
      await new RedactPersonalDataInProductAnalyticsPages().migrate();
      await new RedactPersonalDataInProductAnalyticsPages().migrate();

      const statements: Array<string> = executedStatements();

      expect(statements).toHaveLength(4);
      expect(statements.slice(2)).toEqual(statements.slice(0, 2));
    });
  });

  test("rollback() does nothing", async () => {
    await new RedactPersonalDataInProductAnalyticsPages().rollback();

    expect(executedStatements()).toEqual([]);
  });
});
