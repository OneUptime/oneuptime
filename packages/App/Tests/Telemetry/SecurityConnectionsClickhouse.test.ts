import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { ClickHouseSettings } from "Common/Server/Services/AnalyticsDatabaseService";
import SecurityEventService, {
  SecurityEventLogResource,
  SecurityEventsNamingSummary,
} from "Common/Server/Services/SecurityEventService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
} from "Common/Types/SecurityCase/SecurityConnection";
import {
  getLogAttributeSearchValues,
  getObservableSearchValues,
} from "Common/Utils/SecurityCase/SecurityConnectionMatch";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import { buildSecurityEventDbRow } from "Common/Server/Utils/SecurityEvent/SecurityEventRow";
import MicrosoftDefenderXdrNormalizer from "Common/Utils/SecurityEvent/Connectors/MicrosoftDefenderXdrNormalizer";
import SecurityEventNormalizer from "Common/Utils/SecurityEvent/SecurityEventNormalizer";
import SecurityLogParser from "Common/Utils/SecurityEvent/LogParsers/SecurityLogParser";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * The security-event reads behind Security Events' connections, against a
 * real ClickHouse server, under its current analyzer and the older one:
 *
 *   countEventsNaming        a record page's Security card: the events and
 *                            findings naming its identities (in the
 *                            usual spellings), or read from its logs
 *   findLogResourcesNaming   the records the logs behind a case's events
 *                            were sent under
 *   hasEventsSince           whether a project uses Security Events at all
 *
 * Each is run through SecurityEventService, on a table built from the
 * SecurityEvent model (its columns, skip indexes and projection), with the
 * rows of the project read, of another project that must never be read,
 * and of times outside the window.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server,
 * credentials in the URL:
 *
 *   docker run -d --rm --name security-connected-ch -p 18125:8123 \
 *     -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18125 \
 *     npx jest Tests/Telemetry/SecurityConnectionsClickhouse.test.ts
 *
 * The suite creates and drops only its own uniquely named database. The
 * App Test workflow provides the server, and the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
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

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `security_connections_test_${process.pid}_${Date.now()}`;

const HOUR: number = 60 * 60 * 1000;

/*
 * The week the reads look at, ending at a fixed moment so every run reads
 * the same rows: the rows are written around it.
 */
const END: Date = new Date(
  Math.floor(Date.now() / (24 * HOUR)) * 24 * HOUR - 12 * HOUR,
);
const START: Date = new Date(END.getTime() - 7 * 24 * HOUR);

interface Connection {
  name: string;
  database: ClickhouseDatabase;
  client: ClickhouseClient;
  olderAnalyzerSetting: string | null;
}

async function readJson<T>(
  client: ClickhouseClient,
  query: string,
): Promise<Array<T>> {
  const result: { json: () => Promise<unknown> } = await client.query({
    query: query,
    format: "JSONEachRow",
  });

  return (await result.json()) as Array<T>;
}

// The model's own table under a plain MergeTree (no Keeper on a disposable server).
async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
  modelType: { new (): AnalyticsBaseModel },
): Promise<void> {
  const model: AnalyticsBaseModel = new modelType();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: modelType,
      database: clickhouse,
    });
  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

function eventRow(data: {
  projectId: ObjectID;
  time: Date;
  observables: Array<string>;
  classUid?: number | undefined;
  severityId?: number | undefined;
  attributes?: Record<string, string> | undefined;
}): JSONObject {
  const attributes: Record<string, string> = data.attributes || {};

  return {
    _id: ObjectID.generate().toString(),
    projectId: data.projectId.toString(),
    primaryEntityId: ObjectID.generate().toString(),
    primaryEntityType: ServiceType.OpenTelemetry,
    time: OneUptimeDate.toClickhouseDateTime64(data.time),
    createdAt: OneUptimeDate.toClickhouseDateTime(data.time),
    eventUid: ObjectID.generate().toString(),
    classUid: data.classUid ?? 3002,
    className: data.classUid === 2004 ? "Detection Finding" : "Authentication",
    severityId: data.severityId ?? 1,
    message: "test event",
    observables: data.observables,
    attributes: attributes,
    attributeKeys: Object.keys(attributes),
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), 30),
    ),
  };
}

type ConnectableService = {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
};

const service: ConnectableService =
  SecurityEventService as unknown as ConnectableService;

integration("Security Events' connections against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let options: ClickHouseClientConfigOptions;
  const connections: Array<Connection> = [];
  let original: ConnectableService | null = null;

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    options = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 120000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    await createTable(client, clickhouse, SecurityEvent);

    connections.push({
      name: "the current analyzer",
      database: clickhouse,
      client: client,
      olderAnalyzerSetting: null,
    });

    const [setting] = await readJson<{ name: string }>(
      client,
      "SELECT name FROM system.settings WHERE name IN ('enable_analyzer', 'allow_experimental_analyzer') ORDER BY name = 'enable_analyzer' DESC LIMIT 1",
    );

    if (setting) {
      const olderOptions: ClickHouseClientConfigOptions = {
        ...options,
        clickhouse_settings: { [setting.name]: 0 } as ClickHouseSettings,
      };
      const olderDatabase: ClickhouseDatabase = new ClickhouseDatabase(
        olderOptions,
      );
      const olderClient: ClickhouseClient =
        await olderDatabase.connect(olderOptions);

      connections.push({
        name: "the older analyzer",
        database: olderDatabase,
        client: olderClient,
        olderAnalyzerSetting: setting.name,
      });
    }

    original = {
      database: service.database,
      databaseClient: service.databaseClient,
    };
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(service, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    for (const connection of connections) {
      await connection.database.disconnect();
    }
  });

  test("the server knows the older analyzer, so both are run", () => {
    expect(
      connections.map((connection: Connection): string => {
        return connection.name;
      }),
    ).toEqual(["the current analyzer", "the older analyzer"]);
  });

  test("the older connection reads with the older analyzer", async () => {
    const older: Connection | undefined = connections[1];

    expect(older?.olderAnalyzerSetting).toBeTruthy();

    const [row] = await readJson<{ analyzer: string | number }>(
      older!.client,
      `SELECT toUInt8(getSetting('${older!.olderAnalyzerSetting}')) AS analyzer`,
    );

    expect(Number(row!.analyzer)).toBe(0);
  });

  describe.each([
    ["the current analyzer", 0],
    ["the older analyzer (enable_analyzer = 0)", 1],
  ])("through %s", (_name: string, position: number) => {
    // A project of each run's own, so the two runs never read each other's rows.
    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const quietProjectId: ObjectID = ObjectID.generate();
    const hostId: ObjectID = ObjectID.generate();
    const serviceId: ObjectID = ObjectID.generate();

    beforeAll(async (): Promise<void> => {
      const connection: Connection = connections[position]!;

      service.database = connection.database;
      service.databaseClient = connection.client;

      const inside: (hours: number) => Date = (hours: number): Date => {
        return new Date(END.getTime() - hours * HOUR);
      };
      const fromHostLogs: Record<string, string> = {
        [SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]: hostId.toString(),
        [SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE]: ServiceType.Host,
      };
      const fromServiceLogs: Record<string, string> = {
        [SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]: serviceId.toString(),
        [SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE]: ServiceType.OpenTelemetry,
      };

      await client.insert({
        table: `${database}.${new SecurityEvent().tableName}`,
        format: "JSONEachRow",
        values: [
          // web-1, as its own logs say: in the week.
          eventRow({
            projectId,
            time: inside(2),
            observables: ["web-1", "203.0.113.7"],
            attributes: fromHostLogs,
          }),
          eventRow({
            projectId,
            time: inside(30),
            observables: ["web-1"],
            attributes: fromHostLogs,
          }),
          // WEB-1, as an EDR spells it: a High finding, the latest of the week.
          eventRow({
            projectId,
            time: inside(1),
            observables: ["WEB-1", "k.morgan@acme.example"],
            classUid: 2004,
            severityId: 4,
          }),
          // Its public address alone.
          eventRow({
            projectId,
            time: inside(50),
            observables: ["203.0.113.9"],
            classUid: 2004,
            severityId: 2,
          }),
          // A web attack read from a service's logs, naming the attacker only.
          eventRow({
            projectId,
            time: inside(3),
            observables: ["198.51.100.4"],
            attributes: fromServiceLogs,
          }),
          // Before the week: never counted.
          eventRow({
            projectId,
            time: new Date(START.getTime() - HOUR),
            observables: ["web-1"],
            attributes: fromHostLogs,
          }),
          // After the window: never counted.
          eventRow({
            projectId,
            time: new Date(END.getTime() + HOUR),
            observables: ["web-1"],
          }),
          // Another project's web-1: never read.
          eventRow({
            projectId: otherProjectId,
            time: inside(2),
            observables: ["web-1"],
            classUid: 2004,
            severityId: 5,
            attributes: fromHostLogs,
          }),
        ],
        clickhouse_settings: { wait_for_async_insert: 1 },
      });
    });

    test("the events and findings naming a host's name or its address, in the usual spellings, over the week", async () => {
      const summary: SecurityEventsNamingSummary =
        await SecurityEventService.countEventsNaming({
          projectId,
          values: getObservableSearchValues(["web-1", "203.0.113.9"]),
          startTime: START,
          endTime: END,
        });

      expect(summary.eventCount).toBe(4);
      expect(summary.findingCount).toBe(2);
      expect(summary.maxSeverityId).toBe(4);
      expect(summary.lastSeen?.getTime()).toBe(END.getTime() - HOUR);
    });

    test("exactly the spellings given: web-1 alone does not find an EDR's WEB-1", async () => {
      const summary: SecurityEventsNamingSummary =
        await SecurityEventService.countEventsNaming({
          projectId,
          values: ["web-1"],
          startTime: START,
          endTime: END,
        });

      expect(summary.eventCount).toBe(2);
    });

    test("a service's events: the ones read from its logs", async () => {
      const summary: SecurityEventsNamingSummary =
        await SecurityEventService.countEventsNaming({
          projectId,
          values: [],
          logResourceId: serviceId,
          startTime: START,
          endTime: END,
        });

      expect(summary.eventCount).toBe(1);
      expect(summary.findingCount).toBe(0);
    });

    test("the values or the logs: an event that is both is counted once", async () => {
      const summary: SecurityEventsNamingSummary =
        await SecurityEventService.countEventsNaming({
          projectId,
          values: ["web-1"],
          logResourceId: hostId,
          startTime: START,
          endTime: END,
        });

      expect(summary.eventCount).toBe(2);
    });

    test("a value nothing names: nothing, and no time it was seen", async () => {
      expect(
        await SecurityEventService.countEventsNaming({
          projectId,
          values: ["nobody.example"],
          startTime: START,
          endTime: END,
        }),
      ).toEqual({
        eventCount: 0,
        findingCount: 0,
        maxSeverityId: 0,
        lastSeen: null,
      });
    });

    test("the records the logs behind events naming a value were sent under, the most named first, this project's only", async () => {
      const resources: Array<SecurityEventLogResource> =
        await SecurityEventService.findLogResourcesNaming({
          projectId,
          values: ["web-1", "198.51.100.4", "WEB-1"],
          startTime: START,
          endTime: END,
          limit: 20,
        });

      expect(resources).toEqual([
        { type: ServiceType.Host, id: hostId.toString(), eventCount: 2 },
        {
          type: ServiceType.OpenTelemetry,
          id: serviceId.toString(),
          eventCount: 1,
        },
      ]);
    });

    test("at most the limit asked for", async () => {
      expect(
        (
          await SecurityEventService.findLogResourcesNaming({
            projectId,
            values: ["web-1", "198.51.100.4"],
            startTime: START,
            endTime: END,
            limit: 1,
          })
        ).length,
      ).toBe(1);
    });

    test("whether a project uses Security Events: this one does, a quiet one and a later window do not", async () => {
      expect(
        await SecurityEventService.hasEventsSince({
          projectId,
          startTime: START,
        }),
      ).toBe(true);
      expect(
        await SecurityEventService.hasEventsSince({
          projectId: quietProjectId,
          startTime: START,
        }),
      ).toBe(false);
      expect(
        await SecurityEventService.hasEventsSince({
          projectId,
          startTime: new Date(END.getTime() + 2 * HOUR),
        }),
      ).toBe(false);
    });
  });
});

/*
 * #10034: an Azure resource ID from any source, whatever its case. Every
 * row keeps an Azure ID by its key, in lower case (SecurityEventRow), so a
 * cloud resource's card finds each source's event by that one spelling -
 * through the observables' bloom index and the attribute keys' one, which
 * ClickHouse combines for the card's OR. A search that folded each stored
 * observable instead would read every granule.
 */
const AZURE_VAULT_ID: string =
  "/subscriptions/6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b/resourceGroups/rg-Payments-Prod/providers/Microsoft.KeyVault/vaults/kv-Payments";

const AZURE_NEAR_MISSES: Array<string> = [
  "/subscriptions/0f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b/resourceGroups/rg-Payments-Prod/providers/Microsoft.KeyVault/vaults/kv-Payments",
  "/subscriptions/6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b/resourceGroups/rg-Payments-Prod/providers/Microsoft.KeyVault/vaults/kv-Payments2",
  "/subscriptions/6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b/resourceGroups/rg-Payments-Test/providers/Microsoft.KeyVault/vaults/kv-Payments",
];

const ORDERS_TABLE: string =
  "arn:aws:dynamodb:us-east-1:111122223333:table/Orders";

// The granules a plan's skip indexes leave of a part's, from EXPLAIN indexes = 1.
function skipIndexGranules(
  plan: string,
): Array<{ name: string; read: number; of: number }> {
  const lines: Array<string> = plan.split("\n").map((line: string) => {
    return line.trim();
  });
  const found: Array<{ name: string; read: number; of: number }> = [];

  for (let index: number = 0; index < lines.length; index++) {
    if (lines[index] !== "Skip") {
      continue;
    }

    const name: string = (lines[index + 1] || "").replace("Name: ", "");
    const granules: string | undefined = lines
      .slice(index + 1, index + 6)
      .find((line: string): boolean => {
        return line.startsWith("Granules: ");
      });
    const [read, of] = (granules || "Granules: 0/0")
      .replace("Granules: ", "")
      .split("/")
      .map(Number);

    found.push({ name, read: read!, of: of! });
  }

  return found;
}

integration(
  "an Azure resource ID from any source, whatever its case (#10034)",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    let original: ConnectableService | null = null;
    const azureDatabase: string = `${database}_azure`;
    const projectId: ObjectID = ObjectID.generate();
    const serviceMetadata: TelemetryServiceMetadata = {
      primaryEntityId: ObjectID.generate(),
      primaryEntityType: ServiceType.OpenTelemetry,
    } as unknown as TelemetryServiceMetadata;
    // One day, so every row is in one partition: only the skip indexes narrow it.
    const DAY_START: Date = new Date(END.getTime() - 20 * HOUR);

    function rowOf(event: NormalizedSecurityEvent): JSONObject {
      return buildSecurityEventDbRow({
        normalized: { ...event, time: new Date(DAY_START.getTime() + HOUR) },
        projectId,
        serviceMetadata,
        retentionDays: 30,
      });
    }

    // Microsoft Defender XDR's alert, its evidence naming a resource as it received it.
    function defenderAlert(
      resourceId: string,
      id: string,
    ): NormalizedSecurityEvent {
      return MicrosoftDefenderXdrNormalizer.normalize({
        "@odata.type": "#microsoft.graph.security.alert",
        id,
        title: "Suspicious secret access from an unusual location",
        severity: "high",
        status: "new",
        createdDateTime: "2026-11-18T09:12:44.000Z",
        evidence: [
          {
            "@odata.type": "#microsoft.graph.security.azureResourceEvidence",
            roles: [],
            resourceId,
            resourceName: "kv-Payments",
          },
        ],
      });
    }

    // A pipeline's OCSF record, in its sender's spelling.
    function ocsfRecord(
      resourceId: string,
      uid: string,
    ): NormalizedSecurityEvent {
      return SecurityEventNormalizer.normalize({
        class_uid: 6003,
        activity_name: "Update",
        severity_id: 3,
        time: DAY_START.getTime(),
        message: "Purge protection turned off on a key vault",
        metadata: { uid, product: { name: "Acme SIEM Forwarder" } },
        observables: [{ name: "resources.uid", value: resourceId }],
      })!;
    }

    beforeAll(async (): Promise<void> => {
      const url: URL = new URL(endpoint!);
      const options: ClickHouseClientConfigOptions = {
        url: `${url.protocol}//${url.host}`,
        username: decodeURIComponent(url.username) || "default",
        password: decodeURIComponent(url.password),
        database: azureDatabase,
        request_timeout: 120000,
      };

      clickhouse = new ClickhouseDatabase(options);
      client = await clickhouse.connect(options);

      await client.command({
        query: `CREATE DATABASE IF NOT EXISTS ${azureDatabase}`,
      });

      const model: SecurityEvent = new SecurityEvent();
      const generator: StatementGenerator<SecurityEvent> =
        new StatementGenerator<SecurityEvent>({
          modelType: SecurityEvent,
          database: clickhouse,
        });
      const columns: Statement = generator.toColumnsCreateStatement(
        model.tableColumns,
      );

      await client.command({
        query: `CREATE TABLE ${azureDatabase}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
        query_params: columns.query_params,
      });

      original = {
        database: service.database,
        databaseClient: service.databaseClient,
      };
      service.database = clickhouse;
      service.databaseClient = client;

      const sources: Array<NormalizedSecurityEvent> = [
        // Defender XDR's evidence, in mixed case.
        defenderAlert(
          "/Subscriptions/6F1C2A3B-4D5E-4F60-8A7B-9C0D1E2F3A4B/ResourceGroups/RG-PAYMENTS-PROD/Providers/microsoft.keyvault/Vaults/KV-PAYMENTS",
          "da-1",
        ),
        // A pipeline's OCSF record, in capitals.
        ocsfRecord(AZURE_VAULT_ID.toUpperCase(), "ocsf-1"),
        // The Activity Log's export, in capitals, read from a log line.
        ...SecurityLogParser.parse({
          body: JSON.stringify({
            records: [
              {
                time: DAY_START.toISOString(),
                resourceId: AZURE_VAULT_ID.toUpperCase(),
                operationName: "MICROSOFT.KEYVAULT/VAULTS/WRITE",
                category: "Administrative",
                resultType: "Success",
                correlationId: "4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d",
                callerIpAddress: "203.0.113.40",
              },
            ],
          }),
          attributes: {},
          time: DAY_START,
          logId: ObjectID.generate().toString(),
        }),
        // The vault's own logs, stamped by a collector in capitals: by the attribute alone.
        ...SecurityLogParser.parse({
          body: "sshd[2210]: Failed password for invalid user admin from 203.0.113.7 port 52314 ssh2",
          attributes: {
            "resource.cloud.resource_id": AZURE_VAULT_ID.toUpperCase(),
          },
          time: DAY_START,
          logId: ObjectID.generate().toString(),
        }),
      ];

      expect(sources).toHaveLength(4);

      const nearMisses: Array<NormalizedSecurityEvent> = [
        ...AZURE_NEAR_MISSES.map((id: string, index: number) => {
          return defenderAlert(id.toUpperCase(), `da-miss-${index}`);
        }),
        // A DynamoDB table "orders" is not "Orders".
        ocsfRecord(ORDERS_TABLE.toLowerCase(), "ocsf-miss-table"),
      ];

      /*
       * Thousands of other events of the project that day, so a granule the
       * skip indexes leave out is one a search does not read.
       */
      const filler: Array<JSONObject> = [];

      for (let index: number = 0; index < 60000; index++) {
        filler.push(
          eventRow({
            projectId,
            time: new Date(DAY_START.getTime() + (index % 36000) * 1000),
            observables: [
              `host-${index % 5000}`,
              `10.0.${index % 250}.${index % 200}`,
            ],
            attributes: { "oneuptime.log.source": "logs" },
          }),
        );
      }

      await client.insert({
        table: `${azureDatabase}.${model.tableName}`,
        format: "JSONEachRow",
        values: [...filler, ...sources.map(rowOf), ...nearMisses.map(rowOf)],
        clickhouse_settings: { wait_for_async_insert: 1 },
      });
      await client.command({
        query: `OPTIMIZE TABLE ${azureDatabase}.${model.tableName} FINAL`,
      });
    });

    afterAll(async (): Promise<void> => {
      if (original) {
        Object.assign(service, original);
      }

      if (client) {
        await client.command({
          query: `DROP DATABASE IF EXISTS ${azureDatabase}`,
        });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }
    });

    // What the vault's card searches for, from its own row (ResourceSecurity).
    function vaultSearch(): {
      values: Array<string>;
      attribute: { key: string; values: Array<string> };
    } {
      return {
        values: getObservableSearchValues([AZURE_VAULT_ID]),
        attribute: {
          key: SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE,
          values: getLogAttributeSearchValues({
            key: SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE,
            value: AZURE_VAULT_ID,
          }),
        },
      };
    }

    test("the vault's card counts each source's event, in whatever case it wrote the ID - and no near miss", async () => {
      const summary: SecurityEventsNamingSummary =
        await SecurityEventService.countEventsNaming({
          projectId,
          ...vaultSearch(),
          startTime: START,
          endTime: END,
        });

      expect(summary.eventCount).toBe(4);
    });

    test("an ARN is matched as written: the table Orders is not orders", async () => {
      expect(
        (
          await SecurityEventService.countEventsNaming({
            projectId,
            values: getObservableSearchValues([ORDERS_TABLE]),
            startTime: START,
            endTime: END,
          })
        ).eventCount,
      ).toBe(0);
      expect(
        (
          await SecurityEventService.countEventsNaming({
            projectId,
            values: getObservableSearchValues([ORDERS_TABLE.toLowerCase()]),
            startTime: START,
            endTime: END,
          })
        ).eventCount,
      ).toBe(1);
    });

    test("the card's own statement reads the granules its skip indexes leave, not the day", async () => {
      const spy: jest.SpiedFunction<typeof SecurityEventService.executeQuery> =
        jest.spyOn(SecurityEventService, "executeQuery");

      await SecurityEventService.countEventsNaming({
        projectId,
        ...vaultSearch(),
        startTime: START,
        endTime: END,
      });

      const statement: Statement = spy.mock.calls[0]![0] as Statement;

      spy.mockRestore();

      const result: { text: () => Promise<string> } = await client.query({
        query: `EXPLAIN indexes = 1 ${statement.query}`,
        query_params: statement.query_params,
        format: "TabSeparatedRaw",
      });
      const plan: string = await result.text();
      const skips: Array<{ name: string; read: number; of: number }> =
        skipIndexGranules(plan);
      // The last word on what is read: the combined set for an OR, else the one index.
      const finalSkip: { name: string; read: number; of: number } =
        skips[skips.length - 1]!;

      expect(
        skips.map((skip: { name: string }): string => {
          return skip.name;
        }),
      ).toEqual(
        expect.arrayContaining(["idx_observables", "idx_attribute_keys"]),
      );
      expect(finalSkip.of).toBeGreaterThan(4);
      expect(finalSkip.read).toBeLessThan(finalSkip.of);
      // The page reads the same: a scoped read compiles the same OR.
    });

    test("a search that folded each stored value instead would read every granule: why the key is stored", async () => {
      const result: { text: () => Promise<string> } = await client.query({
        query: `EXPLAIN indexes = 1 SELECT count() FROM ${azureDatabase}.${new SecurityEvent().tableName} WHERE projectId = {projectId:String} AND arrayExists(observable -> lower(observable) = {key:String}, observables)`,
        query_params: {
          projectId: projectId.toString(),
          key: AZURE_VAULT_ID.toLowerCase(),
        },
        format: "TabSeparatedRaw",
      });
      const plan: string = await result.text();

      expect(
        skipIndexGranules(plan).some((skip: { read: number; of: number }) => {
          return skip.read < skip.of;
        }),
      ).toBe(false);
    });
  },
);

describe("Security Events' connections ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
