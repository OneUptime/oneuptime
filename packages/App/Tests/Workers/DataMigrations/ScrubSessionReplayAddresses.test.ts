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
 * #8490: Session Replay's headers and chunks keep a JSON Web Token, an
 * address escaped twice or a token in standard base64 that the scrubber kept
 * until #8385 and #8489, and the session list shows a session's entry and
 * exit page. They are redacted where they are stored.
 *
 * What is pinned:
 *
 *   - the two statements: a session's entryUrl, exitUrl and routes, and a
 *     chunk's url and routes, each address redacted only when it names
 *     someone (UrlScrubberSql), on the local storage tables, ON CLUSTER,
 *     queued without waiting (mutations_sync = 0); a chunk's recording is
 *     never named;
 *   - then the product analytics scrub again, for the base64 rule;
 *   - a table that does not exist is skipped, a statement that fails fails
 *     the migration, so it is tried again on the next boot;
 *   - its rollback does nothing, it runs on the clustered schema, and it is
 *     registered once, after ScrubProductAnalyticsAddresses and before the
 *     last slot.
 *
 * ScrubSessionReplayAddressesClickhouse.test.ts runs it against a real
 * ClickHouse server.
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
import {
  addressHasIdentifierSql,
  redactedAddressSql,
} from "Common/Server/Utils/AnalyticsDatabase/UrlScrubberSql";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import DataMigrationBase from "../../../FeatureSet/Workers/DataMigrations/DataMigrationBase";
import { MaterializeInBackgroundOptions } from "../../../FeatureSet/Workers/DataMigrations/MaterializeAttributeValuesIndex";
import ScrubProductAnalyticsAddresses from "../../../FeatureSet/Workers/DataMigrations/ScrubProductAnalyticsAddresses";
import ScrubSessionReplayAddresses from "../../../FeatureSet/Workers/DataMigrations/ScrubSessionReplayAddresses";

type MockFunction = ReturnType<typeof jest.fn>;
type MockSpy = ReturnType<typeof jest.spyOn>;

const metricService: { execute: MockFunction } = MetricService as unknown as {
  execute: MockFunction;
};

const migrationUtil: { tableExists: MockFunction } =
  ClickHouseMigrationUtil as unknown as { tableExists: MockFunction };

const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";
const MIGRATION_NAME: string = "ScrubSessionReplayAddresses";
const SESSIONS: string = "RumSessionV1Local";
const CHUNKS: string = "RumSessionChunkV1Local";

let savedClusterName: string | undefined;
let missing: Set<string>;
let failing: Error | null;
let infoSpy: MockSpy;

function executedStatements(): Array<string> {
  return metricService.execute.mock.calls.map((call: Array<unknown>) => {
    return call[0] as string;
  });
}

beforeEach(() => {
  savedClusterName = process.env[CLUSTER_ENV_KEY];
  delete process.env[CLUSTER_ENV_KEY];

  missing = new Set<string>();
  failing = null;

  metricService.execute.mockReset();
  metricService.execute.mockImplementation(async (): Promise<void> => {
    if (failing) {
      throw failing;
    }
  });

  migrationUtil.tableExists.mockReset();
  migrationUtil.tableExists.mockImplementation(
    async (table: unknown): Promise<boolean> => {
      return !missing.has(table as string);
    },
  );

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

describe("ScrubSessionReplayAddresses", () => {
  describe("what it is", () => {
    test("is a data migration recorded under its own name", () => {
      const migration: ScrubSessionReplayAddresses =
        new ScrubSessionReplayAddresses();

      expect(migration).toBeInstanceOf(DataMigrationBase);
      expect(migration.name).toBe(MIGRATION_NAME);
    });

    test("runs on the clustered schema instead of being baselined", () => {
      expect(new ScrubSessionReplayAddresses().runsInClusterMode()).toBe(true);
    });

    test("is registered once, after the product analytics scrub and before the last slot", () => {
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
      expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
        registered.indexOf("ScrubProductAnalyticsAddresses"),
      );
      expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
        registered.indexOf("AddAuditLogMcpClientColumns"),
      );
      expect(registered[registered.length - 1]).toBe(
        "AddAuditLogMcpClientColumns",
      );
    });
  });

  describe("the statements", () => {
    test("redact a session's entry and exit URLs and its routes, only where they name someone", () => {
      expect(ScrubSessionReplayAddresses.getScrubSessionsStatement()).toBe(
        `ALTER TABLE ${SESSIONS} ON CLUSTER 'oneuptime' UPDATE entryUrl = if(${addressHasIdentifierSql("entryUrl")}, ${redactedAddressSql("entryUrl")}, entryUrl), exitUrl = if(${addressHasIdentifierSql("exitUrl")}, ${redactedAddressSql("exitUrl")}, exitUrl), routes = arrayMap(paUrl -> if(${addressHasIdentifierSql("paUrl")}, ${redactedAddressSql("paUrl")}, paUrl), routes) WHERE ${addressHasIdentifierSql("entryUrl")} OR ${addressHasIdentifierSql("exitUrl")} OR arrayExists(paUrl -> ${addressHasIdentifierSql("paUrl")}, routes)`,
      );
    });

    test("redact a chunk's url and routes, and never name its recording", () => {
      const statement: string =
        ScrubSessionReplayAddresses.getScrubChunksStatement();

      expect(statement).toBe(
        `ALTER TABLE ${CHUNKS} ON CLUSTER 'oneuptime' UPDATE url = if(${addressHasIdentifierSql("url")}, ${redactedAddressSql("url")}, url), routes = arrayMap(paUrl -> if(${addressHasIdentifierSql("paUrl")}, ${redactedAddressSql("paUrl")}, paUrl), routes) WHERE ${addressHasIdentifierSql("url")} OR arrayExists(paUrl -> ${addressHasIdentifierSql("paUrl")}, routes)`,
      );
      expect(statement).not.toMatch(/\bpayload\b/);
    });

    test("queue the product analytics scrub after, as it is built now", () => {
      const steps: Array<{ table: string; statements: Array<string> }> =
        ScrubSessionReplayAddresses.getSteps();

      expect(
        steps.map((step: { table: string }): string => {
          return step.table;
        }),
      ).toEqual([
        SESSIONS,
        CHUNKS,
        ...ScrubProductAnalyticsAddresses.getSteps().map(
          (step: { table: string }): string => {
            return step.table;
          },
        ),
      ]);
      expect(steps.slice(2)).toEqual(ScrubProductAnalyticsAddresses.getSteps());
    });

    test("never names a request's value, and names the cluster it is given", () => {
      process.env[CLUSTER_ENV_KEY] = "analytics";

      for (const step of ScrubSessionReplayAddresses.getSteps()) {
        for (const statement of step.statements) {
          expect(statement).not.toMatch(/\{[A-Za-z_]+:[A-Za-z]+\}/);
          expect(statement.startsWith(`ALTER TABLE ${step.table} `)).toBe(true);
          expect(statement).toContain(" ON CLUSTER 'analytics' ");
        }
      }
    });
  });

  describe("running it", () => {
    test("queues every statement, in order, in the background", async () => {
      await new ScrubSessionReplayAddresses().migrate();

      expect(executedStatements()).toEqual(
        ScrubSessionReplayAddresses.getSteps().flatMap(
          (step: { statements: Array<string> }): Array<string> => {
            return step.statements;
          },
        ),
      );
      expect(executedStatements()[0]).toBe(
        ScrubSessionReplayAddresses.getScrubSessionsStatement(),
      );
      expect(executedStatements()[1]).toBe(
        ScrubSessionReplayAddresses.getScrubChunksStatement(),
      );

      for (const call of metricService.execute.mock.calls) {
        const options: ClickhouseExecuteOptions =
          call[1] as ClickhouseExecuteOptions;

        expect(options).toBe(MaterializeInBackgroundOptions);
        expect(options.clickhouseSettings?.["mutations_sync"]).toBe("0");
      }
    });

    test("skips a table that does not exist, and scrubs the others", async () => {
      missing.add(CHUNKS);

      await new ScrubSessionReplayAddresses().migrate();

      expect(executedStatements()).not.toContain(
        ScrubSessionReplayAddresses.getScrubChunksStatement(),
      );
      expect(executedStatements()).toContain(
        ScrubSessionReplayAddresses.getScrubSessionsStatement(),
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining(`${CHUNKS} does not exist`),
      );
    });

    test("fails when a statement cannot be queued, so it is tried again on the next boot", async () => {
      failing = new Error("too many mutations");

      await expect(new ScrubSessionReplayAddresses().migrate()).rejects.toThrow(
        "too many mutations",
      );
    });

    test("has nothing to roll back", async () => {
      await new ScrubSessionReplayAddresses().rollback();

      expect(metricService.execute).not.toHaveBeenCalled();
    });
  });
});
