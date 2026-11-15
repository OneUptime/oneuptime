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
 * #8385, #8386: what product analytics stored before the scrubber caught
 * it - a JSON Web Token or an address escaped twice in a page, an email
 * beyond ASCII the earlier migration's ASCII rule left, an address-valued
 * property, user property or metric() attribute with its query and its
 * identifiers - scrubbed as the ingest scrubs it now.
 *
 * What is pinned:
 *
 *   - the statements, each a mutation on a local storage table, ON CLUSTER,
 *     queued without waiting (mutations_sync = 0), built from UrlScrubber's
 *     rule in SQL (UrlScrubberSql): page views with an identifier in their
 *     page deleted (the page is their name, in the sort key), the page of
 *     every other event redacted, address-valued properties and user
 *     properties scrubbed, a session's entry page and pages redacted, and
 *     the attributes of a RUM application's metric() points scrubbed - not
 *     those of its OpenTelemetry metrics, which carry resource attributes;
 *   - the events, then the sessions, then the metrics; a table that does
 *     not exist is skipped, and a statement that fails fails the migration,
 *     so it is tried again on the next boot;
 *   - its rollback does nothing, it runs on the clustered schema, and it is
 *     registered once, after the earlier page redaction and before the last
 *     slot.
 *
 * ScrubProductAnalyticsAddressesClickhouse.test.ts runs it against a real
 * ClickHouse server, and holds the SQL rule to the scrubber's.
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
  hasIdentifierSegmentSql,
  mapHasUnscrubbedAddressSql,
  redactedPathSql,
  scrubbedAddressSql,
  scrubbedMapSql,
} from "Common/Server/Utils/AnalyticsDatabase/UrlScrubberSql";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import DataMigrationBase from "../../../FeatureSet/Workers/DataMigrations/DataMigrationBase";
import { MaterializeInBackgroundOptions } from "../../../FeatureSet/Workers/DataMigrations/MaterializeAttributeValuesIndex";
import ScrubProductAnalyticsAddresses from "../../../FeatureSet/Workers/DataMigrations/ScrubProductAnalyticsAddresses";

type MockFunction = ReturnType<typeof jest.fn>;
type MockSpy = ReturnType<typeof jest.spyOn>;

const metricService: { execute: MockFunction } = MetricService as unknown as {
  execute: MockFunction;
};

const migrationUtil: { tableExists: MockFunction } =
  ClickHouseMigrationUtil as unknown as { tableExists: MockFunction };

const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";
const MIGRATION_NAME: string = "ScrubProductAnalyticsAddresses";
const EVENTS: string = "RumProductAnalyticsEventV1Local";
const SESSIONS: string = "RumProductAnalyticsSessionV1Local";
const METRICS: string = "MetricItemV3Local";

let savedClusterName: string | undefined;
let missing: Set<string>;
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

describe("ScrubProductAnalyticsAddresses", () => {
  describe("what it is", () => {
    test("is a data migration recorded under its own name", () => {
      const migration: ScrubProductAnalyticsAddresses =
        new ScrubProductAnalyticsAddresses();

      expect(migration).toBeInstanceOf(DataMigrationBase);
      expect(migration.name).toBe(MIGRATION_NAME);
    });

    test("runs on the clustered schema instead of being baselined", () => {
      expect(new ScrubProductAnalyticsAddresses().runsInClusterMode()).toBe(
        true,
      );
    });

    test("is registered once, after the earlier page redaction and before the last slot", () => {
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
        registered.indexOf("RedactPersonalDataInProductAnalyticsPages"),
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
    test("delete the page views named by a page with an identifier in it", () => {
      expect(ScrubProductAnalyticsAddresses.getDeletePageViewsStatement()).toBe(
        `ALTER TABLE ${EVENTS} ON CLUSTER 'oneuptime' DELETE WHERE kind = 'page' AND ${hasIdentifierSegmentSql("name")}`,
      );
    });

    test("redact the page of every other event, leaving the event", () => {
      expect(ScrubProductAnalyticsAddresses.getRedactPagesStatement()).toBe(
        `ALTER TABLE ${EVENTS} ON CLUSTER 'oneuptime' UPDATE page = ${redactedPathSql("page")} WHERE kind != 'page' AND ${hasIdentifierSegmentSql("page")}`,
      );
    });

    test("scrub the properties and user properties that are addresses, and only the rows that hold one", () => {
      expect(ScrubProductAnalyticsAddresses.getScrubPropertiesStatement()).toBe(
        `ALTER TABLE ${EVENTS} ON CLUSTER 'oneuptime' UPDATE properties = ${scrubbedMapSql("properties")}, userProperties = ${scrubbedMapSql("userProperties")} WHERE ${mapHasUnscrubbedAddressSql("properties")} OR ${mapHasUnscrubbedAddressSql("userProperties")}`,
      );
    });

    test("redact a session's entry page and the pages it visited", () => {
      expect(
        ScrubProductAnalyticsAddresses.getScrubSessionPagesStatement(),
      ).toBe(
        `ALTER TABLE ${SESSIONS} ON CLUSTER 'oneuptime' UPDATE entryPage = ${redactedPathSql("entryPage")}, pages = arrayMap(paUrl -> if(${addressHasIdentifierSql("paUrl")}, ${scrubbedAddressSql("paUrl")}, paUrl), pages) WHERE ${hasIdentifierSegmentSql("entryPage")} OR arrayExists(paUrl -> ${addressHasIdentifierSql("paUrl")}, pages)`,
      );
    });

    test("scrub the attributes of a RUM application's metric() points, not its OpenTelemetry metrics'", () => {
      const statement: string =
        ScrubProductAnalyticsAddresses.getScrubMetricAttributesStatement();

      expect(statement).toBe(
        `ALTER TABLE ${METRICS} ON CLUSTER 'oneuptime' UPDATE attributes = ${scrubbedMapSql("attributes")} WHERE primaryEntityType = 'RealUserMonitor' AND NOT arrayExists(paKey -> startsWith(paKey, 'resource.'), mapKeys(attributes)) AND ${mapHasUnscrubbedAddressSql("attributes")}`,
      );
    });

    test("never names a request's value, and never a table but the three it scrubs", () => {
      for (const step of ScrubProductAnalyticsAddresses.getSteps()) {
        for (const statement of step.statements) {
          expect(statement).not.toMatch(/\{[A-Za-z_]+:[A-Za-z]+\}/);
          expect(statement.startsWith(`ALTER TABLE ${step.table} `)).toBe(true);
        }
      }

      expect(
        ScrubProductAnalyticsAddresses.getSteps().map(
          (step: { table: string }): string => {
            return step.table;
          },
        ),
      ).toEqual([EVENTS, SESSIONS, METRICS]);
    });

    test("names the cluster it is given", () => {
      process.env[CLUSTER_ENV_KEY] = "analytics";

      for (const step of ScrubProductAnalyticsAddresses.getSteps()) {
        for (const statement of step.statements) {
          expect(statement).toContain(" ON CLUSTER 'analytics' ");
        }
      }
    });
  });

  describe("running it", () => {
    test("queues every statement, in order, in the background", async () => {
      await new ScrubProductAnalyticsAddresses().migrate();

      expect(executedStatements()).toEqual([
        ScrubProductAnalyticsAddresses.getDeletePageViewsStatement(),
        ScrubProductAnalyticsAddresses.getRedactPagesStatement(),
        ScrubProductAnalyticsAddresses.getScrubPropertiesStatement(),
        ScrubProductAnalyticsAddresses.getScrubSessionPagesStatement(),
        ScrubProductAnalyticsAddresses.getScrubMetricAttributesStatement(),
      ]);

      for (const options of executedOptions()) {
        expect(options).toBe(MaterializeInBackgroundOptions);
        expect(options.clickhouseSettings?.["mutations_sync"]).toBe("0");
      }
    });

    test("skips a table that does not exist, and scrubs the others", async () => {
      missing.add(SESSIONS);

      await new ScrubProductAnalyticsAddresses().migrate();

      expect(executedStatements()).toEqual([
        ScrubProductAnalyticsAddresses.getDeletePageViewsStatement(),
        ScrubProductAnalyticsAddresses.getRedactPagesStatement(),
        ScrubProductAnalyticsAddresses.getScrubPropertiesStatement(),
        ScrubProductAnalyticsAddresses.getScrubMetricAttributesStatement(),
      ]);
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining(`${SESSIONS} does not exist`),
      );
    });

    test("does nothing on an install with none of the tables", async () => {
      missing = new Set<string>([EVENTS, SESSIONS, METRICS]);

      await new ScrubProductAnalyticsAddresses().migrate();

      expect(metricService.execute).not.toHaveBeenCalled();
    });

    test("fails when a statement cannot be queued, so it is tried again on the next boot", async () => {
      failing = new Error("too many mutations");

      await expect(
        new ScrubProductAnalyticsAddresses().migrate(),
      ).rejects.toThrow("too many mutations");
    });

    test("has nothing to roll back", async () => {
      await new ScrubProductAnalyticsAddresses().rollback();

      expect(metricService.execute).not.toHaveBeenCalled();
    });
  });
});
