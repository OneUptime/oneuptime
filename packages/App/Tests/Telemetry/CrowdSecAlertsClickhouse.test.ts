import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import SecurityEventConnection from "Common/Models/DatabaseModels/SecurityEventConnection";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import SecurityEventConnectionService from "Common/Server/Services/SecurityEventConnectionService";
import SecurityEventService from "Common/Server/Services/SecurityEventService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import SecurityConnectionCases from "Common/Server/Utils/SecurityCase/SecurityConnectionCases";
import PushedConnectionAlerts, {
  PushedAlertsResult,
} from "Common/Server/Utils/SecurityEvent/Connectors/PushedConnectionAlerts";
import RealTimeDetections from "Common/Server/Utils/SecurityEvent/RealTime/RealTimeDetections";
import ThreatIntelEnricher from "Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SECURITY_CONNECTION_ID_ATTRIBUTE } from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityEventFormat from "Common/Types/SecurityEvent/SecurityEventFormat";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import SecurityEventNormalizer from "Common/Utils/SecurityEvent/SecurityEventNormalizer";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ------------------------------------------------------------------
 * CrowdSec's alerts, as its notification plugin sends them to a CrowdSec
 * connection (#11158), stored in a real ClickHouse server: through
 * PushedConnectionAlerts.receive, which writes them with the shared
 * security-event row writer and reads the duplicate check
 * (SecurityEventDedupe) back from the table, on a layout like every
 * install's - a Distributed table over its local one, the check reading
 * every replica of the cluster.
 *
 *   - each alert is one row, a Detection Finding attributed to the
 *     connection, with CrowdSec's own fields kept;
 *   - an alert sent again - in the same batch, or a later one, as
 *     `cscli notifications reinject` sends it - is stored once;
 *   - the same alert in another project is that project's own;
 *   - only CrowdSec's own detections are handed on to open cases.
 *
 * What a case is, the real-time rules, threat intel and the telemetry
 * service are stood in for: their own suites hold them.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server,
 * credentials in the URL (its built-in "default" cluster is used):
 *
 *   docker run -d --rm --name crowdsec-alerts-ch -p 18311:8123 \
 *     -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18311 \
 *     npx jest Tests/Telemetry/CrowdSecAlertsClickhouse.test.ts
 *
 * The suite creates and drops only its own uniquely named database.
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

const database: string = `crowdsec_alerts_test_${process.pid}_${Date.now()}`;

// The cluster a disposable server ships with, which every read of replicas names.
const CLUSTER: string = "default";

const FIXTURES: string = path.resolve(
  __dirname,
  "../../../Common/Tests/Fixtures/CrowdSec",
);

// The body CrowdSec's http plugin posts: its alerts, as `{{.|toJson}}` renders them.
function docsNotification(): Array<JSONObject> {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURES, "docs-ssh-bf-notification.json"), {
      encoding: "utf8",
    }),
  ) as Array<JSONObject>;
}

// `cscli notifications test oneuptime`'s alert, as v1.8.2 builds it.
function testNotification(): JSONObject {
  return {
    capacity: 0,
    decisions: [
      {
        duration: "4h",
        origin: "cscli",
        scenario: "test alert",
        scope: "Ip",
        type: "ban",
        value: "10.10.10.10",
      },
    ],
    events: [],
    events_count: 1,
    leakspeed: "0",
    message: "test alert",
    scenario: "test alert",
    scenario_hash: "",
    scenario_version: "",
    simulated: false,
    source: { ip: "10.10.10.10", scope: "Ip", value: "10.10.10.10" },
    start_at: "2026-11-28T09:58:00Z",
    stop_at: "2026-11-28T09:58:00Z",
    created_at: "2026-11-28T09:58:00Z",
  };
}

function normalized(alerts: Array<JSONObject>): Array<NormalizedSecurityEvent> {
  return alerts.map((alert: JSONObject): NormalizedSecurityEvent => {
    const event: NormalizedSecurityEvent | null =
      SecurityEventNormalizer.normalize(
        JSON.parse(JSON.stringify(alert)) as JSONObject,
        SecurityEventFormat.CrowdSec,
      );

    if (!event) {
      throw new Error("An alert CrowdSec sends was not read.");
    }

    return event;
  });
}

function withUuid(alert: JSONObject, uuid: string): JSONObject {
  return { ...alert, uuid };
}

async function readJson<T>(
  client: ClickhouseClient,
  query: string,
  params: Record<string, unknown> = {},
): Promise<Array<T>> {
  const result: { json: () => Promise<unknown> } = await client.query({
    query: query,
    query_params: params,
    format: "JSONEachRow",
  });

  return (await result.json()) as Array<T>;
}

// The model's local table under a plain MergeTree, and the Distributed one in front of it.
async function createTables(
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
    query: `CREATE TABLE ${database}.${model.tableName}Local (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} AS ${database}.${model.tableName}Local ENGINE = Distributed('${CLUSTER}', '${database}', '${model.tableName}Local', rand())`,
  });
}

type ConnectableService = {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
};

const service: ConnectableService =
  SecurityEventService as unknown as ConnectableService;

integration(
  "CrowdSec's alerts, stored through their connection in ClickHouse",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    let original: ConnectableService | null = null;
    const savedEnvironment: Record<string, string | undefined> = {};
    let cased: Array<NormalizedSecurityEvent> = [];

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();

    function connection(project: ObjectID): SecurityEventConnection {
      const made: SecurityEventConnection = new SecurityEventConnection();
      made._id = ObjectID.generate().toString();
      made.projectId = project;
      made.name = "Edge CrowdSec";
      made.provider = SecurityEventConnectorProvider.CrowdSec;
      made.isEnabled = true;
      return made;
    }

    async function rowsOf(project: ObjectID): Promise<Array<JSONObject>> {
      return await readJson<JSONObject>(
        client,
        `SELECT eventUid, classUid, vendorName, productName, statusName, ruleId, principalIp, attributes['${SECURITY_CONNECTION_ID_ATTRIBUTE}'] AS connectionId, attributes['crowdsec.scenario'] AS scenario, attributes['crowdsec.alert_type'] AS alertType FROM ${database}.${new SecurityEvent().tableName}Local WHERE projectId = {projectId:String} ORDER BY eventUid`,
        { projectId: project.toString() },
      );
    }

    beforeAll(async (): Promise<void> => {
      const url: URL = new URL(endpoint!);

      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error(
          "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
        );
      }

      // The cluster and database the duplicate check names.
      for (const [key, value] of [
        ["CLICKHOUSE_CLUSTER_NAME", CLUSTER],
        ["CLICKHOUSE_DATABASE", database],
      ] as Array<[string, string]>) {
        savedEnvironment[key] = process.env[key];
        process.env[key] = value;
      }

      const options: ClickHouseClientConfigOptions = {
        url: `${url.protocol}//${url.host}`,
        username: decodeURIComponent(url.username) || "default",
        password: decodeURIComponent(url.password),
        request_timeout: 120000,
      };

      const bootstrap: ClickhouseDatabase = new ClickhouseDatabase(options);
      const bootstrapClient: ClickhouseClient =
        await bootstrap.connect(options);
      await bootstrapClient.command({
        query: `CREATE DATABASE IF NOT EXISTS ${database}`,
      });
      await bootstrap.disconnect();

      const databaseOptions: ClickHouseClientConfigOptions = {
        ...options,
        database: database,
      };

      clickhouse = new ClickhouseDatabase(databaseOptions);
      client = await clickhouse.connect(databaseOptions);

      await createTables(client, clickhouse, SecurityEvent);

      original = {
        database: service.database,
        databaseClient: service.databaseClient,
        ingestDatabase: service.ingestDatabase,
        ingestDatabaseClient: service.ingestDatabaseClient,
      };

      service.database = clickhouse;
      service.databaseClient = client;
      service.ingestDatabase = clickhouse;
      service.ingestDatabaseClient = client;
    });

    afterAll(async (): Promise<void> => {
      if (original) {
        Object.assign(service, original);
      }

      for (const [key, value] of Object.entries(savedEnvironment)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }
    });

    beforeEach((): void => {
      cased = [];
      PushedConnectionAlerts.clearCache();

      jest
        .spyOn(OTelIngestService, "telemetryServiceFromName")
        .mockImplementation((async () => {
          return {
            serviceName: "CrowdSec",
            primaryEntityId: new ObjectID(
              "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
            ),
            primaryEntityType: ServiceType.OpenTelemetry,
            entityKeys: [],
            serviceRetentionConfig: null,
            serviceRetentionInDays: null,
            projectRetentionConfig: null,
            projectRetentionInDays: 15,
          } as unknown as TelemetryServiceMetadata;
        }) as never);
      jest
        .spyOn(ThreatIntelEnricher, "enrichNormalizedEvents")
        .mockImplementation((async () => {
          return undefined;
        }) as never);
      jest.spyOn(RealTimeDetections, "screen").mockImplementation((async () => {
        return undefined;
      }) as never);
      jest
        .spyOn(SecurityConnectionCases, "recordImportedAlerts")
        .mockImplementation((async (data: {
          events: Array<NormalizedSecurityEvent>;
        }) => {
          cased.push(...data.events);
          return data.events.length;
        }) as never);
      jest
        .spyOn(SecurityEventConnectionService, "updateOneById")
        .mockImplementation((async () => {
          return undefined;
        }) as never);
    });

    afterEach((): void => {
      jest.restoreAllMocks();
    });

    test("each alert is one Detection Finding row, attributed to its connection", async () => {
      const crowdsec: SecurityEventConnection = connection(projectId);
      const alerts: Array<JSONObject> = [
        withUuid(
          docsNotification()[0]!,
          "11111111-aaaa-4bbb-8ccc-000000000001",
        ),
        withUuid(testNotification(), "11111111-aaaa-4bbb-8ccc-000000000002"),
      ];

      const result: PushedAlertsResult = await PushedConnectionAlerts.receive({
        projectId,
        connection: crowdsec,
        events: normalized(alerts),
      });

      expect(result).toMatchObject({ received: 2, duplicates: 0, stored: 2 });

      const rows: Array<JSONObject> = await rowsOf(projectId);

      expect(rows).toEqual([
        {
          eventUid: "crowdsec:11111111-aaaa-4bbb-8ccc-000000000001",
          classUid: 2004,
          vendorName: "CrowdSec",
          productName: "CrowdSec",
          statusName: "Blocked",
          ruleId: "crowdsecurity/ssh-bf",
          principalIp: "35.188.49.176",
          connectionId: crowdsec.id!.toString(),
          scenario: "crowdsecurity/ssh-bf",
          alertType: "detection",
        },
        {
          eventUid: "crowdsec:11111111-aaaa-4bbb-8ccc-000000000002",
          classUid: 2004,
          vendorName: "CrowdSec",
          productName: "CrowdSec",
          statusName: "Blocked",
          ruleId: "test alert",
          principalIp: "10.10.10.10",
          connectionId: crowdsec.id!.toString(),
          scenario: "test alert",
          alertType: "test",
        },
      ]);

      // CrowdSec's own detection is handed on to open a case; its test is not.
      expect(
        cased.map((event: NormalizedSecurityEvent): string => {
          return event.eventUid;
        }),
      ).toEqual(["crowdsec:11111111-aaaa-4bbb-8ccc-000000000001"]);
    });

    test("an alert sent again, in a later batch or twice in one, is stored once", async () => {
      const crowdsec: SecurityEventConnection = connection(projectId);
      const again: JSONObject = withUuid(
        docsNotification()[0]!,
        "11111111-aaaa-4bbb-8ccc-000000000001",
      );
      const fresh: JSONObject = withUuid(
        docsNotification()[0]!,
        "11111111-aaaa-4bbb-8ccc-000000000003",
      );

      const result: PushedAlertsResult = await PushedConnectionAlerts.receive({
        projectId,
        connection: crowdsec,
        events: normalized([again, fresh, fresh]),
      });

      expect(result).toMatchObject({ received: 3, duplicates: 2, stored: 1 });
      expect(
        (await rowsOf(projectId)).map((row: JSONObject): unknown => {
          return row["eventUid"];
        }),
      ).toEqual([
        "crowdsec:11111111-aaaa-4bbb-8ccc-000000000001",
        "crowdsec:11111111-aaaa-4bbb-8ccc-000000000002",
        "crowdsec:11111111-aaaa-4bbb-8ccc-000000000003",
      ]);
      // Nothing new to open a case from but the one alert stored.
      expect(cased).toHaveLength(1);
    });

    test("the same alert in another project is that project's own", async () => {
      const result: PushedAlertsResult = await PushedConnectionAlerts.receive({
        projectId: otherProjectId,
        connection: connection(otherProjectId),
        events: normalized([
          withUuid(
            docsNotification()[0]!,
            "11111111-aaaa-4bbb-8ccc-000000000001",
          ),
        ]),
      });

      expect(result).toMatchObject({ received: 1, duplicates: 0, stored: 1 });
      expect(await rowsOf(otherProjectId)).toHaveLength(1);
      expect(await rowsOf(projectId)).toHaveLength(3);
    });

    test("an alert without a uuid is stored once by its content", async () => {
      const crowdsec: SecurityEventConnection = connection(projectId);
      const unnamed: JSONObject = docsNotification()[0]!;

      const first: PushedAlertsResult = await PushedConnectionAlerts.receive({
        projectId,
        connection: crowdsec,
        events: normalized([unnamed]),
      });
      const second: PushedAlertsResult = await PushedConnectionAlerts.receive({
        projectId,
        connection: crowdsec,
        events: normalized([unnamed]),
      });

      expect(first).toMatchObject({ stored: 1, duplicates: 0 });
      expect(second).toMatchObject({ stored: 0, duplicates: 1 });
      expect(await rowsOf(projectId)).toHaveLength(4);
    });
  },
);

describe("CrowdSec's alerts ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
