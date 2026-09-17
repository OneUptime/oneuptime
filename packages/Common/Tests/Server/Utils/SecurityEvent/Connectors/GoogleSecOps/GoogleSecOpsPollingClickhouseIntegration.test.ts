import {
  setTimeout as nodeSetTimeout,
  clearTimeout as nodeClearTimeout,
} from "timers";
import { createClient, ClickHouseClient } from "@clickhouse/client";
import {
  ClickhouseUsername,
  ClickhousePassword,
} from "../../../../../../Server/EnvironmentConfig";
import Semaphore from "../../../../../../Server/Infrastructure/Semaphore";
import OTelIngestService from "../../../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventConnectionService from "../../../../../../Server/Services/SecurityEventConnectionService";
import SecurityEventService from "../../../../../../Server/Services/SecurityEventService";
import { Statement } from "../../../../../../Server/Utils/AnalyticsDatabase/Statement";
import logger from "../../../../../../Server/Utils/Logger";
import SecurityEventConnectionPoller from "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionPoller";
import SecurityEventDedupe from "../../../../../../Server/Utils/SecurityEvent/SecurityEventDedupe";
import ThreatIntelEnricher from "../../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import OneUptimeDate from "../../../../../../Types/Date";
import { JSONObject } from "../../../../../../Types/JSON";
import ObjectID from "../../../../../../Types/ObjectID";
import { SecurityEventConnectionRunResult } from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import SecurityEventConnectorProvider from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  GoogleSecOpsTenant,
  MINUTE_MS,
  eventUidsOf,
  makeServiceMetadata,
  secOpsConnection,
} from "./GoogleSecOpsPollingFixtures";

/*
 * The Google SecOps duplicate lookup against a real ClickHouse server, now
 * that it is the shared SecurityEventDedupe scoped by the catalog's
 * Google / Google SecOps names, plus one real poll whose duplicate check
 * reads that server.
 *
 * Opt in against a local development ClickHouse server. The suite creates and
 * removes only its own uniquely named database, never application tables.
 * Load local credentials with DOTENV_CONFIG_PATH=../config.env node -r dotenv/config.
 * Set SECOPS_TEST_CLICKHOUSE_URL=http://localhost:8189 to enable the suite.
 */
const endpoint: string | undefined = process.env["SECOPS_TEST_CLICKHOUSE_URL"];
jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;
const database: string = `codex_secops_test_${process.pid}_${Date.now()}`;
const table: string = `${SecurityEventService.model.tableName}Local`;
const projectId: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const otherProjectId: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const GOOGLE: SecurityEventConnectorDefinition =
  getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.GoogleSecOps,
  )!;
const originalDatabase: string | undefined = process.env["CLICKHOUSE_DATABASE"];
let client: ClickHouseClient;

// The lookup a Google SecOps poll makes: scoped by the catalog's names.
function findExisting(ids: Array<string>): Promise<Set<string>> {
  return SecurityEventDedupe.findExistingEventUids({
    projectId,
    vendorName: GOOGLE.vendorName,
    productName: GOOGLE.productName,
    ids,
  });
}

integration("Google SecOps duplicate lookup against ClickHouse", () => {
  beforeAll(async (): Promise<void> => {
    /*
     * The default browser test environment returns numeric timer IDs; the real
     * ClickHouse HTTP client needs Node timers with unref().
     */
    jest.spyOn(globalThis, "setTimeout").mockImplementation(nodeSetTimeout);
    jest.spyOn(globalThis, "clearTimeout").mockImplementation(nodeClearTimeout);
    const url: URL = new URL(endpoint!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "This integration suite requires a local ClickHouse server.",
      );
    }
    client = createClient({
      url: endpoint!,
      username: ClickhouseUsername,
      password: ClickhousePassword,
      request_timeout: 120000,
    });
    await client.command({ query: `CREATE DATABASE ${database}` });
    await client.command({
      query: `CREATE TABLE ${database}.${table} (projectId String, eventUid String, vendorName String, productName String) ENGINE = MergeTree ORDER BY (projectId, eventUid)`,
    });
    process.env["CLICKHOUSE_DATABASE"] = database;
    jest
      .spyOn(SecurityEventService, "executeQuery")
      .mockImplementation(
        (
          statement: Statement | string,
        ): ReturnType<typeof SecurityEventService.executeQuery> => {
          return client.query({
            query: statement instanceof Statement ? statement.query : statement,
            query_params:
              statement instanceof Statement ? statement.query_params : {},
            format: "JSON",
          });
        },
      );
    const rows: Array<{
      projectId: string;
      eventUid: string;
      vendorName: string;
      productName: string;
    }> = [
      {
        projectId: projectId.toString(),
        eventUid: "existing",
        vendorName: "Google",
        productName: "Google SecOps",
      },
      {
        projectId: projectId.toString(),
        eventUid: "existing",
        vendorName: "Google",
        productName: "Google SecOps",
      },
      {
        projectId: otherProjectId.toString(),
        eventUid: "foreign",
        vendorName: "Google",
        productName: "Google SecOps",
      },
      {
        projectId: projectId.toString(),
        eventUid: "other-product",
        vendorName: "Google",
        productName: "Another source",
      },
      {
        projectId: projectId.toString(),
        eventUid: "other-vendor",
        vendorName: "Another vendor",
        productName: "Google SecOps",
      },
      {
        projectId: projectId.toString(),
        eventUid: "quote') OR 1=1 --",
        vendorName: "Google",
        productName: "Google SecOps",
      },
      {
        projectId: projectId.toString(),
        eventUid: "batch-1000",
        vendorName: "Google",
        productName: "Google SecOps",
      },
    ];
    await client.insert({
      table: `${database}.${table}`,
      values: rows,
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0 },
    });
  });

  afterAll(async (): Promise<void> => {
    if (originalDatabase === undefined) {
      delete process.env["CLICKHOUSE_DATABASE"];
    } else {
      process.env["CLICKHOUSE_DATABASE"] = originalDatabase;
    }
    if (client) {
      try {
        await client.command({
          query: `DROP DATABASE IF EXISTS ${database} SYNC`,
        });
      } finally {
        await client.close();
        jest.restoreAllMocks();
      }
    }
  });

  test("returns distinct persisted identifiers scoped to the project and source", async (): Promise<void> => {
    // The catalog's names are byte for byte what the retired poller stored.
    expect(GOOGLE.vendorName).toBe("Google");
    expect(GOOGLE.productName).toBe("Google SecOps");
    const found: Set<string> = await findExisting([
      "existing",
      "foreign",
      "other-product",
      "other-vendor",
      "absent",
    ]);
    expect(found).toEqual(new Set(["existing"]));
  });

  test("binds detection identifiers literally, including SQL punctuation", async (): Promise<void> => {
    expect(await findExisting(["quote') OR 1=1 --"])).toEqual(
      new Set(["quote') OR 1=1 --"]),
    );
    expect(await findExisting(["missing') OR 1=1 --"])).toEqual(new Set());
  });

  test("finds identifiers beyond the first bounded query batch", async (): Promise<void> => {
    const ids: Array<string> = Array.from(
      { length: 1001 },
      (_value: unknown, index: number): string => {
        return `batch-${index}`;
      },
    );
    expect(await findExisting(ids)).toEqual(new Set(["batch-1000"]));
  });

  test("a subsequent lookup sees acknowledged writes", async (): Promise<void> => {
    expect(await findExisting(["next-import"])).toEqual(new Set());
    await client.insert({
      table: `${database}.${table}`,
      values: [
        {
          projectId: projectId.toString(),
          eventUid: "next-import",
          vendorName: "Google",
          productName: "Google SecOps",
        },
      ],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0 },
    });
    expect(await findExisting(["next-import"])).toEqual(
      new Set(["next-import"]),
    );
  });

  /*
   * A real poll: the REAL shared poller and GoogleSecOpsConnector over a
   * simulated tenant, with the duplicate lookup reading this ClickHouse.
   * Only the lock, the telemetry service, enrichment, the insert and the
   * connection row write are stubbed, and restored afterwards so the lookup
   * spy above stays in place for the tests that follow.
   */
  test("a Google SecOps poll imports only the detections ClickHouse does not already hold", async (): Promise<void> => {
    const now: Date = new Date("2026-09-10T12:00:00.000Z");
    const inserted: Array<Array<JSONObject>> = [];
    const spies: Array<{ mockRestore: () => void }> = [
      jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(now),
      jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never),
      jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never),
      jest
        .spyOn(OTelIngestService, "telemetryServiceFromName")
        .mockResolvedValue(makeServiceMetadata() as never),
      jest
        .spyOn(ThreatIntelEnricher, "enrichNormalizedEvents")
        .mockResolvedValue({ eventsMatched: 0, valuesLookedUp: 0 } as never),
      jest.spyOn(SecurityEventService, "insertJsonRows").mockImplementation(((
        rows: Array<JSONObject>,
      ): Promise<void> => {
        inserted.push(rows);
        return Promise.resolve();
      }) as never),
      jest
        .spyOn(SecurityEventConnectionService, "updateOneById")
        .mockResolvedValue(undefined as never),
      jest.spyOn(logger, "warn").mockImplementation((() => {
        return undefined;
      }) as never),
    ];
    const tenant: GoogleSecOpsTenant = new GoogleSecOpsTenant();
    for (const id of ["existing", "fresh-detection"]) {
      tenant.add({
        id,
        createdMs: now.getTime() - 2 * MINUTE_MS,
        detectionMs: now.getTime() - 3 * MINUTE_MS,
      });
    }

    try {
      const result: SecurityEventConnectionRunResult =
        await SecurityEventConnectionPoller.executeConnection(
          secOpsConnection({
            projectId,
            cursor: "2026-09-10T11:55:00.000Z",
          }),
          { type: "poll" },
          tenant.overrides(),
        );

      expect(result.status).toBe("success");
      expect(result.duplicateCount).toBe(1);
      expect(result.ingestedCount).toBe(1);
      expect(inserted).toHaveLength(1);
      expect(eventUidsOf(inserted[0]!)).toEqual(["fresh-detection"]);
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });

  test("missing storage fails instead of returning an empty successful lookup", async (): Promise<void> => {
    await client.command({ query: `DROP TABLE ${database}.${table} SYNC` });
    await expect(findExisting(["existing"])).rejects.toThrow();
  });
});
