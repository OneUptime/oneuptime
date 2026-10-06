import ObjectID from "Common/Types/ObjectID";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import {
  SQL,
  Statement,
} from "Common/Server/Utils/AnalyticsDatabase/Statement";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import {
  keyForKubernetesCluster,
  keyForService,
} from "Common/Utils/Telemetry/EntityKey";
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
 * Resource facet counts against a real ClickHouse server (issue #3251).
 *
 * The unit suites pin the SQL ResourceFacetCountQuery builds: a main part
 * over every row (id OR scalar key column) plus a legacy part over rows
 * without scalar keys (`serviceEntityKey = ''`, `NOT main AND full`). What
 * they cannot show is what that SQL COUNTS. This suite builds LogItemV3 and
 * SpanItemV3 from the real models, writes one row per representation a
 * Kubernetes cluster can have, and checks that the logs and traces facet
 * counts equal both the fixture's expected count and a plain
 * `countIf(<full filter predicate>)` over the same rows.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/ResourceFacetCountClickhouse.test.ts
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

import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import LogAggregationService, {
  ResourceFacetCountRequest,
} from "Common/Server/Services/LogAggregationService";
import TraceAggregationService from "Common/Server/Services/TraceAggregationService";
import ResourceEntityFilter, {
  renderResourceScope,
  ResourceEntityScope,
} from "Common/Server/Utils/Telemetry/ResourceEntityFilter";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `resource_facet_count_test_${process.pid}_${Date.now()}`;

const projectId: ObjectID = new ObjectID(
  "e1000000-0000-4000-8000-000000000001",
);
const otherProjectId: ObjectID = new ObjectID(
  "e2000000-0000-4000-8000-000000000002",
);
const clusterId: string = "f1000000-0000-4000-8000-000000000001";
const otherClusterId: string = "f2000000-0000-4000-8000-000000000002";
const serviceId: string = "f3000000-0000-4000-8000-000000000003";

const CLUSTER: string = "demo-cluster";
const OTHER_CLUSTER: string = "other-cluster";
const clusterKey: string = keyForKubernetesCluster(
  projectId.toString(),
  CLUSTER,
);
const otherClusterKey: string = keyForKubernetesCluster(
  projectId.toString(),
  OTHER_CLUSTER,
);
const serviceKey: string = keyForService(projectId.toString(), "checkout");

const WINDOW_START: Date = new Date("2026-10-01T00:00:00Z");
const WINDOW_END: Date = new Date("2026-10-01T01:00:00Z");
const ROW_TIME: string = "2026-10-01 00:30:00";

interface Fixture {
  proves: string;
  projectId?: ObjectID;
  primaryEntityType: string;
  primaryEntityId: string;
  serviceEntityKey: string;
  k8sClusterEntityKey: string;
  entityKeys: Array<string>;
  clusterName?: string;
}

/*
 * Every representation of demo-cluster, plus rows that must not count.
 * Rows with serviceEntityKey = '' predate the scalar key columns (or carry
 * no Service) and go through the legacy part.
 */
const FIXTURES: Array<Fixture> = [
  {
    proves: "modern OTLP: Service-primary, cluster only in its scalar key",
    primaryEntityType: "Service",
    primaryEntityId: serviceId,
    serviceEntityKey: serviceKey,
    k8sClusterEntityKey: clusterKey,
    entityKeys: [serviceKey, clusterKey],
    clusterName: CLUSTER,
  },
  {
    proves: "agent: cluster-primary, scalar key also matches, counts once",
    primaryEntityType: "KubernetesCluster",
    primaryEntityId: clusterId,
    serviceEntityKey: "",
    k8sClusterEntityKey: clusterKey,
    entityKeys: [clusterKey],
  },
  {
    proves: "legacy OTLP: no scalar keys, cluster in entityKeys",
    primaryEntityType: "Service",
    primaryEntityId: serviceId,
    serviceEntityKey: "",
    k8sClusterEntityKey: "",
    entityKeys: [serviceKey, clusterKey],
  },
  {
    proves: "legacy OTLP: no keys at all, cluster in the identifier attribute",
    primaryEntityType: "Service",
    primaryEntityId: serviceId,
    serviceEntityKey: "",
    k8sClusterEntityKey: "",
    entityKeys: [],
    clusterName: CLUSTER,
  },
  {
    proves: "overlap: id, scalar key, entityKeys and attribute all match",
    primaryEntityType: "KubernetesCluster",
    primaryEntityId: clusterId,
    serviceEntityKey: serviceKey,
    k8sClusterEntityKey: clusterKey,
    entityKeys: [serviceKey, clusterKey],
    clusterName: CLUSTER,
  },
  {
    proves: "unrelated modern row: other cluster",
    primaryEntityType: "Service",
    primaryEntityId: serviceId,
    serviceEntityKey: serviceKey,
    k8sClusterEntityKey: otherClusterKey,
    entityKeys: [serviceKey, otherClusterKey],
    clusterName: OTHER_CLUSTER,
  },
  {
    proves: "unrelated legacy row: other cluster",
    primaryEntityType: "Service",
    primaryEntityId: serviceId,
    serviceEntityKey: "",
    k8sClusterEntityKey: "",
    entityKeys: [otherClusterKey],
    clusterName: OTHER_CLUSTER,
  },
  {
    proves: "another project's row with the same cluster key",
    projectId: otherProjectId,
    primaryEntityType: "KubernetesCluster",
    primaryEntityId: clusterId,
    serviceEntityKey: "",
    k8sClusterEntityKey: clusterKey,
    entityKeys: [clusterKey],
    clusterName: CLUSTER,
  },
];

const EXPECTED: Record<string, number> = {
  [clusterId]: 5,
  [otherClusterId]: 2,
};

function toRow(fixture: Fixture, timeColumn: string): Record<string, unknown> {
  return {
    projectId: (fixture.projectId || projectId).toString(),
    [timeColumn]: ROW_TIME,
    primaryEntityType: fixture.primaryEntityType,
    primaryEntityId: fixture.primaryEntityId,
    serviceEntityKey: fixture.serviceEntityKey,
    k8sClusterEntityKey: fixture.k8sClusterEntityKey,
    entityKeys: fixture.entityKeys,
    attributes: fixture.clusterName
      ? { "resource.k8s.cluster.name": fixture.clusterName }
      : {},
    retentionDate: "2099-01-01 00:00:00",
  };
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
  modelType: { new (): AnalyticsBaseModel },
): Promise<string> {
  const model: AnalyticsBaseModel = new modelType();
  const columns: Statement = new StatementGenerator<AnalyticsBaseModel>({
    modelType,
    database: clickhouse,
  }).toColumnsCreateStatement(model.tableColumns);

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });

  return model.tableName;
}

const TABLES: Array<{
  name: string;
  modelType: { new (): AnalyticsBaseModel };
  timeColumn: string;
  count: typeof LogAggregationService.getResourceFacetValueCounts;
}> = [
  {
    name: "logs",
    modelType: Log as unknown as { new (): AnalyticsBaseModel },
    timeColumn: "time",
    count: (request: ResourceFacetCountRequest) => {
      return LogAggregationService.getResourceFacetValueCounts(request);
    },
  },
  {
    name: "traces",
    modelType: Span as unknown as { new (): AnalyticsBaseModel },
    timeColumn: "startTime",
    count: (request: ResourceFacetCountRequest) => {
      return TraceAggregationService.getResourceFacetValueCounts(request);
    },
  },
];

integration("Resource facet counts against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  const tableNames: Map<string, string> = new Map<string, string>();
  const originals: Array<[Record<string, unknown>, Record<string, unknown>]> =
    [];

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    const options: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 60000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    for (const service of [LogService, SpanService]) {
      originals.push([
        service as unknown as Record<string, unknown>,
        {
          database: service.database,
          databaseClient: service.databaseClient,
        },
      ]);
      service.database = clickhouse;
      service.databaseClient = client;
    }

    for (const table of TABLES) {
      const tableName: string = await createTable(
        client,
        clickhouse,
        table.modelType,
      );
      tableNames.set(table.name, tableName);
      await client.insert({
        table: `${database}.${tableName}`,
        values: FIXTURES.map((fixture: Fixture) => {
          return toRow(fixture, table.timeColumn);
        }),
        format: "JSONEachRow",
      });
    }

    // Postgres: the cluster rows the count resolves identifiers from.
    jest.spyOn(KubernetesClusterService, "findBy").mockResolvedValue([
      { _id: clusterId, clusterIdentifier: CLUSTER },
      { _id: otherClusterId, clusterIdentifier: OTHER_CLUSTER },
    ] as never);
  });

  afterAll(async (): Promise<void> => {
    jest.restoreAllMocks();

    for (const [service, original] of originals) {
      Object.assign(service, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test.each(
    TABLES.map((table: (typeof TABLES)[number]) => {
      return [table.name, table] as const;
    }),
  )(
    "%s: the two-part count equals the fixture and the full predicate",
    async (name: string, table: (typeof TABLES)[number]) => {
      const counts: Array<{ value: string; count: number }> = await table.count(
        {
          projectId,
          startTime: WINDOW_START,
          endTime: WINDOW_END,
          facetKey: "kubernetesClusterId",
          entityIds: [clusterId, otherClusterId],
        },
      );

      expect(counts).toEqual([
        { value: clusterId, count: EXPECTED[clusterId] },
        { value: otherClusterId, count: EXPECTED[otherClusterId] },
      ]);

      // The same rows counted by the full filter predicate in one countIf.
      const scopes: Map<string, ResourceEntityScope> =
        await ResourceEntityFilter.resolveCountScopes({
          projectId,
          facetKey: "kubernetesClusterId",
          ids: [clusterId, otherClusterId],
        });

      for (const id of [clusterId, otherClusterId]) {
        const scope: ResourceEntityScope = scopes.get(id)!;
        // The modern part has a scalar column to use, so both parts ran.
        expect(scope.entityKeyColumn).toBe("k8sClusterEntityKey");

        const statement: Statement = new Statement()
          .append("SELECT countIf(")
          .append(renderResourceScope(scope)!)
          .append(`) AS cnt FROM ${tableNames.get(name)!}`)
          .append(
            SQL` WHERE projectId = ${{
              type: TableColumnType.ObjectID,
              value: projectId,
            }}`,
          );

        const result: { json: () => Promise<unknown> } = (await client.query({
          query: statement.query,
          query_params: statement.query_params,
          format: "JSONEachRow",
        })) as { json: () => Promise<unknown> };
        const rows: Array<{ cnt: string }> = (await result.json()) as Array<{
          cnt: string;
        }>;

        expect(Number(rows[0]!.cnt)).toBe(EXPECTED[id]);
      }
    },
  );
});

describe("Resource facet count ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
