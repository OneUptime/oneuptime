/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under
 * ts-jest (Buffer vs BinaryLike) that breaks every suite whose import
 * graph reaches it — including all full-loop telemetry suites. Nothing in
 * this suite touches password hashing; stub the module before the service
 * import graph drags it into compilation.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

import DatabaseCallEntityKeyResolver, {
  DATABASE_CLIENT_METRIC_PREFIX,
  DatabaseCallerSource,
} from "../../FeatureSet/Telemetry/Services/DatabaseCallEntityKeys";
import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import MetricPipelineRuleService, {
  MetricRulesForProject,
} from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import MetricPipelineRule from "Common/Models/DatabaseModels/MetricPipelineRule";
import MetricPipelineRuleType from "Common/Types/Metrics/MetricPipelineRuleType";
import {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
} from "Common/Types/Metrics/MetricPipelineRuleFilterCondition";
import { SpanKind } from "Common/Models/AnalyticsModels/Span";
import * as DatabaseEndpointModule from "Common/Types/DatabaseServer/DatabaseEndpoint";
import * as DatabaseTelemetryResolverModule from "Common/Types/DatabaseServer/DatabaseTelemetryResolver";
import * as EntityKeyModule from "Common/Utils/Telemetry/EntityKey";
import { keyForDatabaseEndpoint } from "Common/Utils/Telemetry/EntityKey";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONObject } from "Common/Types/JSON";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The per-ROW database keys: every CLIENT span that calls a database, and
 * every `db.client.*` datapoint that names one, gets that server's
 * endpoint key appended to its OWN entityKeys — so the Databases product
 * finds the queries applications send a database with the same
 * `hasAny(entityKeys, keys)` predicate it uses for everything else.
 *
 * The contract pinned here:
 *
 *   - the key is computed from the FINAL row (after drop / scrub /
 *     pipeline): a scrubbed server.address yields no key, a rewritten one
 *     yields the rewritten server's key;
 *   - it is added as a NEW array: the row's entityKeys is, until then, the
 *     resource's shared array — sibling rows, exception rows and the
 *     resource metadata itself must never see another row's database;
 *   - only CLIENT spans / `db.client.*` metrics with a system attribute
 *     qualify, and anything else costs no resolver or caller work at all;
 *   - the golden row shape (field order) is unchanged;
 *   - the endpoint is canonicalized against the CALLING resource
 *     (Kubernetes namespace / cluster), exactly like the discovery cron;
 *   - one request resolves each distinct call target once.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "orders-api";

const TRACE_ID_HEX: string = "0af7651916cd43dd8448eb211c80319c";
const START_MS: number = Date.UTC(2026, 7, 10, 10, 0, 0, 0);
const START_NANO: string = `${START_MS}000000`;
const END_NANO: string = `${START_MS + 25}000000`;

const DB_HOST: string = "orders-db.example.com";
const EXPECTED_KEY: string = keyForDatabaseEndpoint(PROJECT_ID.toString(), {
  host: DB_HOST,
  port: 5432,
});

// Resource-level keys the resolver stamped (service, host, …).
const RESOURCE_KEYS: Array<string> = ["0123456789abcdef", "fedcba9876543210"];

const EXPECTED_SPAN_ROW_KEY_ORDER: Array<string> = [
  "_id",
  "createdAt",
  "projectId",
  "primaryEntityId",
  "primaryEntityType",
  "entityKeys",
  "serviceEntityKey",
  "hostEntityKey",
  "k8sPodEntityKey",
  "k8sNodeEntityKey",
  "k8sClusterEntityKey",
  "containerEntityKey",
  "startTime",
  "endTime",
  "startTimeUnixNano",
  "endTimeUnixNano",
  "durationUnixNano",
  "traceId",
  "spanId",
  "sessionId",
  "parentSpanId",
  "traceState",
  "attributes",
  "attributeKeys",
  "statusCode",
  "statusMessage",
  "name",
  "kind",
  "events",
  "links",
  "hasException",
  "isRootSpan",
  "isLlmSpan",
  "llmSystem",
  "llmOperation",
  "llmRequestModel",
  "llmResponseModel",
  "llmAgentName",
  "llmToolName",
  "llmInputTokens",
  "llmOutputTokens",
  "llmTotalTokens",
  "llmCost",
  "llmConversationId",
  "llmUserId",
  "llmUserEmail",
  "llmTeam",
  "retentionDate",
];

const EXPECTED_METRIC_ROW_KEY_ORDER: Array<string> = [
  "_id",
  "createdAt",
  "projectId",
  "primaryEntityId",
  "primaryEntityType",
  "entityKeys",
  "serviceEntityKey",
  "hostEntityKey",
  "k8sPodEntityKey",
  "k8sNodeEntityKey",
  "k8sClusterEntityKey",
  "containerEntityKey",
  "name",
  "time",
  "timeUnixNano",
  "metricPointType",
  "aggregationTemporality",
  "isMonotonic",
  "attributes",
  "attributeKeys",
  "value",
  "count",
  "sum",
  "min",
  "max",
  "bucketCounts",
  "explicitBounds",
  "scale",
  "zeroCount",
  "positiveOffset",
  "positiveBucketCounts",
  "negativeOffset",
  "negativeBucketCounts",
  "summaryQuantiles",
  "summaryValues",
  "traceId",
  "spanId",
  "retentionDate",
  "startTime",
  "startTimeUnixNano",
];

type OtlpAttribute = {
  key: string;
  value: { stringValue: string } | { intValue: number };
};

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

function intAttribute(key: string, value: number): OtlpAttribute {
  return { key: key, value: { intValue: value } };
}

const POSTGRES_CALL: Array<OtlpAttribute> = [
  stringAttribute("db.system.name", "postgresql"),
  stringAttribute("server.address", DB_HOST),
  intAttribute("server.port", 5432),
  stringAttribute("db.operation.name", "SELECT"),
];

/*
 * The metadata the resolver hands back for the application resource. Its
 * entityKeys array is THE shared array every row of the resource starts
 * out pointing at.
 */
let sharedMetadata: TelemetryServiceMetadata;

function applicationMetadata(): TelemetryServiceMetadata {
  sharedMetadata = {
    serviceName: SERVICE_NAME,
    primaryEntityId: SERVICE_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    entityKeys: [...RESOURCE_KEYS],
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  };
  return sharedMetadata;
}

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * ---- The resolver on its own ---------------------------------------------
 */

describe("DatabaseCallEntityKeyResolver", () => {
  const CALLER: DatabaseCallerSource = new DatabaseCallerSource({
    "resource.service.name": SERVICE_NAME,
  });

  test.each<[string, unknown, boolean]>([
    ["db.system.name", { "db.system.name": "postgresql" }, true],
    ["legacy db.system", { "db.system": "redis" }, true],
    ["an empty system", { "db.system.name": "", "db.system": "" }, false],
    ["a null system", { "db.system.name": null }, false],
    ["no system", { "server.address": DB_HOST }, false],
    [
      "a RESOURCE-level system (a DB receiver's own resource, not a call)",
      { "resource.db.system.name": "postgresql" },
      false,
    ],
    ["no attributes", undefined, false],
    ["a non-object", "db.system.name", false],
  ])(
    "hasDatabaseSystem: %s",
    (_label: string, attributes: unknown, expected: boolean) => {
      expect(DatabaseCallEntityKeyResolver.hasDatabaseSystem(attributes)).toBe(
        expected,
      );
    },
  );

  test("isDatabaseClientMetricName matches only the db.client.* namespace", () => {
    expect(DATABASE_CLIENT_METRIC_PREFIX).toBe("db.client.");
    expect(
      DatabaseCallEntityKeyResolver.isDatabaseClientMetricName(
        "db.client.operation.duration",
      ),
    ).toBe(true);
    expect(
      DatabaseCallEntityKeyResolver.isDatabaseClientMetricName(
        "db.client.connection.count",
      ),
    ).toBe(true);
    for (const name of [
      "db.server.duration",
      "http.client.request.duration",
      "postgresql.backends",
      "db.client",
      undefined,
      42,
    ]) {
      expect(
        DatabaseCallEntityKeyResolver.isDatabaseClientMetricName(name),
      ).toBe(false);
    }
  });

  test("resolves the engine-agnostic endpoint key of a call", () => {
    const resolver: DatabaseCallEntityKeyResolver =
      new DatabaseCallEntityKeyResolver(PROJECT_ID);

    expect(
      resolver.getEntityKey(
        {
          "db.system.name": "postgresql",
          "server.address": DB_HOST,
          "server.port": 5432,
        },
        CALLER,
      ),
    ).toBe(EXPECTED_KEY);
    // CockroachDB clients say postgresql; the key is the endpoint's alone.
    expect(
      resolver.getEntityKey(
        {
          "db.system.name": "cockroachdb",
          "server.address": DB_HOST,
          "server.port": 5432,
        },
        CALLER,
      ),
    ).toBe(EXPECTED_KEY);
  });

  test.each<[string, Record<string, unknown>]>([
    ["no address", { "db.system.name": "postgresql" }],
    [
      "a loopback address (a per-caller sidecar or proxy)",
      { "db.system.name": "postgresql", "server.address": "127.0.0.1" },
    ],
    [
      "localhost",
      { "db.system.name": "postgresql", "server.address": "localhost" },
    ],
    [
      "a scrubbed address",
      { "db.system.name": "postgresql", "server.address": "[REDACTED]" },
    ],
    [
      "an empty engine name",
      { "db.system.name": "", "server.address": DB_HOST },
    ],
  ])("no key for %s", (_label: string, attributes: Record<string, unknown>) => {
    const resolver: DatabaseCallEntityKeyResolver =
      new DatabaseCallEntityKeyResolver(PROJECT_ID);
    expect(resolver.getEntityKey(attributes, CALLER)).toBeNull();
  });

  test("memoizes each distinct call target once per request", () => {
    const keySpy: jest.SpyInstance = jest.spyOn(
      EntityKeyModule,
      "keyForDatabaseEndpoint",
    );
    const resolveSpy: jest.SpyInstance = jest.spyOn(
      DatabaseTelemetryResolverModule,
      "resolveDatabaseCallTarget",
    );
    const resolver: DatabaseCallEntityKeyResolver =
      new DatabaseCallEntityKeyResolver(PROJECT_ID);
    const call: Record<string, unknown> = {
      "db.system.name": "postgresql",
      "server.address": DB_HOST,
      "server.port": 5432,
      "db.query.text": "SELECT 1",
    };

    for (let i: number = 0; i < 5; i++) {
      expect(
        resolver.getEntityKey(
          { ...call, "db.query.text": `SELECT ${i}` },
          CALLER,
        ),
      ).toBe(EXPECTED_KEY);
    }
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(keySpy).toHaveBeenCalledTimes(1);

    // A different port is a different server.
    resolver.getEntityKey({ ...call, "server.port": 6432 }, CALLER);
    expect(resolveSpy).toHaveBeenCalledTimes(2);

    // Negative answers are memoized too.
    resolver.getEntityKey({ ...call, "server.address": "localhost" }, CALLER);
    resolver.getEntityKey({ ...call, "server.address": "localhost" }, CALLER);
    expect(resolveSpy).toHaveBeenCalledTimes(3);

    // A new request starts cold.
    new DatabaseCallEntityKeyResolver(PROJECT_ID).getEntityKey(call, CALLER);
    expect(resolveSpy).toHaveBeenCalledTimes(4);
  });

  test("two SQL Server named instances on one host are two keys — the memo never merges them", () => {
    const resolveSpy: jest.SpyInstance = jest.spyOn(
      DatabaseTelemetryResolverModule,
      "resolveDatabaseCallTarget",
    );
    const resolver: DatabaseCallEntityKeyResolver =
      new DatabaseCallEntityKeyResolver(PROJECT_ID);
    const call: Record<string, unknown> = {
      "db.system.name": "microsoft.sql_server",
      "server.address": "sql1.corp.example.com",
    };

    const inst01: string | null = resolver.getEntityKey(
      { ...call, "db.mssql.instance_name": "INST01" },
      CALLER,
    );
    const inst02: string | null = resolver.getEntityKey(
      { ...call, "db.namespace": "INST02|orders" },
      CALLER,
    );
    const inst01Again: string | null = resolver.getEntityKey(
      { ...call, "db.mssql.instance_name": "INST01" },
      CALLER,
    );

    expect(inst01).not.toBeNull();
    expect(inst02).not.toBeNull();
    expect(inst01).not.toBe(inst02);
    expect(inst01Again).toBe(inst01);
    // Each distinct instance is resolved once; the repeat is memoized.
    expect(resolveSpy).toHaveBeenCalledTimes(2);
  });

  test("db.namespace never splits the memo for an engine that is not SQL Server", () => {
    const keySpy: jest.SpyInstance = jest.spyOn(
      EntityKeyModule,
      "keyForDatabaseEndpoint",
    );
    const resolveSpy: jest.SpyInstance = jest.spyOn(
      DatabaseTelemetryResolverModule,
      "resolveDatabaseCallTarget",
    );
    const resolver: DatabaseCallEntityKeyResolver =
      new DatabaseCallEntityKeyResolver(PROJECT_ID);

    // A database per tenant on one server: one server, one resolution.
    for (let tenant: number = 0; tenant < 50; tenant++) {
      expect(
        resolver.getEntityKey(
          {
            "db.system.name": "postgresql",
            "server.address": DB_HOST,
            "server.port": 5432,
            "db.namespace": `tenant_${tenant}`,
          },
          CALLER,
        ),
      ).toBe(EXPECTED_KEY);
    }
    // A stray instance attribute on another engine names no instance either.
    expect(
      resolver.getEntityKey(
        {
          "db.system": "postgres",
          "server.address": DB_HOST,
          "server.port": 5432,
          "db.mssql.instance_name": "INST01",
          "db.namespace": "INST02|orders",
        },
        CALLER,
      ),
    ).toBe(EXPECTED_KEY);
    expect(resolveSpy).toHaveBeenCalledTimes(2);
    expect(keySpy).toHaveBeenCalledTimes(2);

    const legacyResolver: DatabaseCallEntityKeyResolver =
      new DatabaseCallEntityKeyResolver(PROJECT_ID);
    for (let tenant: number = 0; tenant < 20; tenant++) {
      legacyResolver.getEntityKey(
        {
          "db.system": "redis",
          "server.address": "cache.example.com",
          "db.namespace": String(tenant),
        },
        CALLER,
      );
    }
    expect(resolveSpy).toHaveBeenCalledTimes(3);
  });

  test("SQL Server: the memo is keyed by the instance a call names, not by its database", () => {
    const resolveSpy: jest.SpyInstance = jest.spyOn(
      DatabaseTelemetryResolverModule,
      "resolveDatabaseCallTarget",
    );
    const resolver: DatabaseCallEntityKeyResolver =
      new DatabaseCallEntityKeyResolver(PROJECT_ID);
    const call: Record<string, unknown> = {
      "db.system": "mssql",
      "server.address": "sql1.corp.example.com",
    };

    const orders: string | null = resolver.getEntityKey(
      { ...call, "db.namespace": "INST01|orders" },
      CALLER,
    );
    const billing: string | null = resolver.getEntityKey(
      { ...call, "db.namespace": "INST01|billing" },
      CALLER,
    );
    const named: string | null = resolver.getEntityKey(
      { ...call, "db.mssql.instance_name": "INST01", "db.namespace": "audit" },
      CALLER,
    );
    const other: string | null = resolver.getEntityKey(
      { ...call, "db.namespace": "INST02|orders" },
      CALLER,
    );
    // The default instance: a db.namespace without "|" names no instance.
    const defaultOrders: string | null = resolver.getEntityKey(
      { ...call, "db.namespace": "orders" },
      CALLER,
    );
    const defaultBilling: string | null = resolver.getEntityKey(
      { ...call, "db.namespace": "billing" },
      CALLER,
    );

    expect(orders).not.toBeNull();
    expect(billing).toBe(orders);
    expect(named).toBe(orders);
    expect(other).not.toBeNull();
    expect(other).not.toBe(orders);
    expect(defaultOrders).not.toBeNull();
    expect(defaultOrders).not.toBe(orders);
    expect(defaultBilling).toBe(defaultOrders);
    // INST01, INST02 and the default instance: three resolutions.
    expect(resolveSpy).toHaveBeenCalledTimes(3);
  });

  test("an instance only a later system attribute would read never changes the key", () => {
    const resolver: DatabaseCallEntityKeyResolver =
      new DatabaseCallEntityKeyResolver(PROJECT_ID);
    // The resolver reads db.system.name first: this is a PostgreSQL call.
    for (const namespace of ["INST01|orders", "INST02|orders", "orders"]) {
      expect(
        resolver.getEntityKey(
          {
            "db.system.name": "postgresql",
            "db.system": "mssql",
            "server.address": DB_HOST,
            "server.port": 5432,
            "db.namespace": namespace,
          },
          CALLER,
        ),
      ).toBe(EXPECTED_KEY);
    }
  });

  test("a string port and a number port land on the same key", () => {
    const resolver: DatabaseCallEntityKeyResolver =
      new DatabaseCallEntityKeyResolver(PROJECT_ID);
    const asNumber: string | null = resolver.getEntityKey(
      {
        "db.system": "postgresql",
        "server.address": DB_HOST,
        "server.port": 5432,
      },
      CALLER,
    );
    const asString: string | null = resolver.getEntityKey(
      {
        "db.system": "postgresql",
        "server.address": DB_HOST,
        "server.port": "5432",
      },
      CALLER,
    );
    expect(asNumber).toBe(EXPECTED_KEY);
    expect(asString).toBe(EXPECTED_KEY);
  });

  test("the calling resource decides how a short name expands — never shared across callers", () => {
    const resolver: DatabaseCallEntityKeyResolver =
      new DatabaseCallEntityKeyResolver(PROJECT_ID);
    const call: Record<string, unknown> = {
      "db.system.name": "postgresql",
      "server.address": "postgres",
    };

    const shop: string | null = resolver.getEntityKey(
      call,
      new DatabaseCallerSource({
        "resource.k8s.namespace.name": "shop",
        "resource.k8s.cluster.name": "prod-eu",
      }),
    );
    const billing: string | null = resolver.getEntityKey(
      call,
      new DatabaseCallerSource({
        "resource.k8s.namespace.name": "billing",
        "resource.k8s.cluster.name": "prod-eu",
      }),
    );

    expect(shop).toBe(
      keyForDatabaseEndpoint(PROJECT_ID.toString(), {
        host: "postgres.shop.svc.cluster.local",
        port: 5432,
        kubernetesClusterName: "prod-eu",
      }),
    );
    expect(billing).toBe(
      keyForDatabaseEndpoint(PROJECT_ID.toString(), {
        host: "postgres.billing.svc.cluster.local",
        port: 5432,
        kubernetesClusterName: "prod-eu",
      }),
    );
    expect(shop).not.toBe(billing);
  });

  test("callers that differ only in runsInKubernetes never share a memo slot", () => {
    /*
     * buildDatabaseCallerContext leaves runsInKubernetes unset today, but
     * the canonicalizer reads it: from a caller known to run in Kubernetes,
     * a two-label name is `<service>.<namespace>`; from anything else it is
     * a domain. The fingerprint must tell the two callers apart.
     */
    const inKubernetes: DatabaseCallerSource = new DatabaseCallerSource({});
    const elsewhere: DatabaseCallerSource = new DatabaseCallerSource({});
    jest.spyOn(inKubernetes, "getContext").mockReturnValue({
      isEphemeral: true,
      runsInKubernetes: true,
    });
    jest.spyOn(elsewhere, "getContext").mockReturnValue({
      isEphemeral: true,
    });

    expect(inKubernetes.getFingerprint()).not.toBe(elsewhere.getFingerprint());

    const resolver: DatabaseCallEntityKeyResolver =
      new DatabaseCallEntityKeyResolver(PROJECT_ID);
    const call: Record<string, unknown> = {
      "db.system.name": "postgresql",
      "server.address": "orders.billing",
    };

    const fromKubernetes: string | null = resolver.getEntityKey(
      call,
      inKubernetes,
    );
    const fromElsewhere: string | null = resolver.getEntityKey(call, elsewhere);

    expect(fromKubernetes).toBe(
      keyForDatabaseEndpoint(PROJECT_ID.toString(), {
        host: "orders.billing.svc.cluster.local",
        port: 5432,
      }),
    );
    expect(fromElsewhere).toBe(
      keyForDatabaseEndpoint(PROJECT_ID.toString(), {
        host: "orders.billing",
        port: 5432,
      }),
    );
  });

  test("the caller context is built once per resource, and only when needed", () => {
    const contextSpy: jest.SpyInstance = jest.spyOn(
      DatabaseEndpointModule,
      "buildDatabaseCallerContext",
    );
    const caller: DatabaseCallerSource = new DatabaseCallerSource({
      "resource.k8s.namespace.name": "shop",
    });
    const resolver: DatabaseCallEntityKeyResolver =
      new DatabaseCallEntityKeyResolver(PROJECT_ID);

    resolver.getEntityKey({ "http.method": "GET" }, caller);
    expect(contextSpy).not.toHaveBeenCalled();

    resolver.getEntityKey(
      { "db.system.name": "postgresql", "server.address": DB_HOST },
      caller,
    );
    resolver.getEntityKey(
      { "db.system.name": "mysql", "server.address": "billing-db.example.com" },
      caller,
    );
    expect(contextSpy).toHaveBeenCalledTimes(1);
  });

  test("appendToClientSpanRow: CLIENT only, a NEW array, never a duplicate", () => {
    const resolver: DatabaseCallEntityKeyResolver =
      new DatabaseCallEntityKeyResolver(PROJECT_ID);
    const shared: Array<string> = [...RESOURCE_KEYS];
    const attributes: Record<string, unknown> = {
      "db.system.name": "postgresql",
      "server.address": DB_HOST,
    };

    const serverRow: JSONObject = {
      kind: SpanKind.Server,
      entityKeys: shared,
      attributes: attributes,
    } as JSONObject;
    expect(resolver.appendToClientSpanRow(serverRow, CALLER)).toBe(false);
    expect(serverRow["entityKeys"]).toBe(shared);

    const internalRow: JSONObject = {
      kind: SpanKind.Internal,
      entityKeys: shared,
      attributes: attributes,
    } as JSONObject;
    expect(resolver.appendToClientSpanRow(internalRow, CALLER)).toBe(false);

    const clientRow: JSONObject = {
      kind: SpanKind.Client,
      entityKeys: shared,
      attributes: attributes,
    } as JSONObject;
    expect(resolver.appendToClientSpanRow(clientRow, CALLER)).toBe(true);
    expect(clientRow["entityKeys"]).toEqual([...RESOURCE_KEYS, EXPECTED_KEY]);
    expect(clientRow["entityKeys"]).not.toBe(shared);
    expect(shared).toEqual(RESOURCE_KEYS);

    // Idempotent: a second pass adds nothing.
    const afterFirst: unknown = clientRow["entityKeys"];
    expect(resolver.appendToClientSpanRow(clientRow, CALLER)).toBe(false);
    expect(clientRow["entityKeys"]).toBe(afterFirst);
  });

  test("a row with no entityKeys yet gets exactly the database key", () => {
    const resolver: DatabaseCallEntityKeyResolver =
      new DatabaseCallEntityKeyResolver(PROJECT_ID);
    const row: JSONObject = {
      kind: SpanKind.Client,
      attributes: { "db.system": "postgresql", "server.address": DB_HOST },
    } as JSONObject;

    expect(resolver.appendToClientSpanRow(row, CALLER)).toBe(true);
    expect(row["entityKeys"]).toEqual([EXPECTED_KEY]);
  });

  test("appendToDatabaseClientMetricRow: db.client.* only", () => {
    const resolver: DatabaseCallEntityKeyResolver =
      new DatabaseCallEntityKeyResolver(PROJECT_ID);
    const attributes: Record<string, unknown> = {
      "db.system.name": "postgresql",
      "server.address": DB_HOST,
    };

    const httpRow: JSONObject = {
      name: "http.client.request.duration",
      entityKeys: [],
      attributes: attributes,
    } as JSONObject;
    expect(resolver.appendToDatabaseClientMetricRow(httpRow, CALLER)).toBe(
      false,
    );

    const dbRow: JSONObject = {
      name: "db.client.operation.duration",
      entityKeys: [],
      attributes: attributes,
    } as JSONObject;
    expect(resolver.appendToDatabaseClientMetricRow(dbRow, CALLER)).toBe(true);
    expect(dbRow["entityKeys"]).toEqual([EXPECTED_KEY]);
  });
});

/*
 * ---- Traces pillar: per-span keys -----------------------------------------
 */

const TRACE_AUTO_DISCOVERY_METHODS: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

type SpanInput = {
  spanId: string;
  name: string;
  kind: number;
  attributes: Array<OtlpAttribute>;
  events?: Array<JSONObject>;
};

type CapturedTraceRows = {
  spans: Array<JSONObject>;
  exceptions: Array<JSONObject>;
};

function setupTraceMocks(): CapturedTraceRows {
  const captured: CapturedTraceRows = { spans: [], exceptions: [] };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelTracesIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  for (const method of TRACE_AUTO_DISCOVERY_METHODS) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }

  jest
    .spyOn(service, "resolveTelemetryResource")
    .mockImplementation(async (): Promise<TelemetryServiceMetadata> => {
      return applicationMetadata();
    });

  jest
    .spyOn(service, "submitSpansBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
      captured.spans.push(...rows.splice(0, rows.length));
      return Promise.resolve();
    });
  jest
    .spyOn(service, "submitExceptionsBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
      captured.exceptions.push(...rows.splice(0, rows.length));
      return Promise.resolve();
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jest
    .spyOn(TraceDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as any);
  jest
    .spyOn(TraceScrubRuleService, "loadScrubRules")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
  jest
    .spyOn(TracePipelineService, "loadPipelines")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
  jest
    .spyOn(LlmModelPriceService, "loadModelPrices")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined);

  return captured;
}

function tracesRequest(data: {
  spans: Array<SpanInput>;
  resourceAttributes?: Array<OtlpAttribute>;
}): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: {
      resourceSpans: [
        {
          resource: {
            attributes: [
              stringAttribute("service.name", SERVICE_NAME),
              ...(data.resourceAttributes || []),
            ],
          },
          scopeSpans: [
            {
              scope: { name: "io.opentelemetry.jdbc", version: "2.9.0" },
              spans: data.spans.map((span: SpanInput) => {
                return {
                  traceId: TRACE_ID_HEX,
                  spanId: span.spanId,
                  parentSpanId: "",
                  name: span.name,
                  kind: span.kind,
                  startTimeUnixNano: START_NANO,
                  endTimeUnixNano: END_NANO,
                  status: { code: 0 },
                  attributes: span.attributes,
                  events: span.events || [],
                  links: [],
                };
              }),
            },
          ],
        },
      ],
    },
    headers: {},
  } as unknown as TelemetryRequest;
}

function spanById(rows: Array<JSONObject>, spanId: string): JSONObject {
  const row: JSONObject | undefined = rows.find((r: JSONObject) => {
    return r["spanId"] === spanId;
  });
  expect(row).toBeDefined();
  return row!;
}

// OTLP kinds on the wire: 2 = SERVER, 3 = CLIENT, 1 = INTERNAL.
const SERVER_KIND: number = 2;
const CLIENT_KIND: number = 3;
const INTERNAL_KIND: number = 1;

const SERVER_SPAN_ID: string = "b7ad6b7169203331";
const CLIENT_SPAN_ID: string = "c8be7c8279314442";
const OTHER_SPAN_ID: string = "d9cf8d938a425553";

describe("traces: per-span database keys", () => {
  test("two spans on one resource: only the DB CLIENT span carries the key, and the shared array is untouched", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest({
        spans: [
          {
            spanId: SERVER_SPAN_ID,
            name: "GET /orders",
            kind: SERVER_KIND,
            attributes: [stringAttribute("http.request.method", "GET")],
          },
          {
            spanId: CLIENT_SPAN_ID,
            name: "SELECT orders",
            kind: CLIENT_KIND,
            attributes: POSTGRES_CALL,
          },
        ],
      }),
    );

    expect(captured.spans).toHaveLength(2);
    const serverRow: JSONObject = spanById(captured.spans, SERVER_SPAN_ID);
    const clientRow: JSONObject = spanById(captured.spans, CLIENT_SPAN_ID);

    expect(clientRow["entityKeys"]).toEqual([...RESOURCE_KEYS, EXPECTED_KEY]);
    expect(serverRow["entityKeys"]).toEqual(RESOURCE_KEYS);

    // The resource's array was replaced on the client row, never pushed to.
    expect(serverRow["entityKeys"]).toBe(sharedMetadata.entityKeys);
    expect(clientRow["entityKeys"]).not.toBe(sharedMetadata.entityKeys);
    expect(sharedMetadata.entityKeys).toEqual(RESOURCE_KEYS);
  });

  test("the keyed row keeps the golden field order", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest({
        spans: [
          {
            spanId: CLIENT_SPAN_ID,
            name: "SELECT orders",
            kind: CLIENT_KIND,
            attributes: POSTGRES_CALL,
          },
        ],
      }),
    );

    const clientRow: JSONObject = spanById(captured.spans, CLIENT_SPAN_ID);
    expect(Object.keys(clientRow)).toEqual(EXPECTED_SPAN_ROW_KEY_ORDER);
    expect(clientRow["kind"]).toBe(SpanKind.Client);
  });

  test.each<[string, number, Array<OtlpAttribute>]>([
    ["a SERVER span with DB attributes", SERVER_KIND, POSTGRES_CALL],
    ["an INTERNAL span with DB attributes", INTERNAL_KIND, POSTGRES_CALL],
    [
      "a CLIENT span with no db.system",
      CLIENT_KIND,
      [
        stringAttribute("server.address", DB_HOST),
        intAttribute("server.port", 5432),
      ],
    ],
    [
      "a DB CLIENT span to a loopback address",
      CLIENT_KIND,
      [
        stringAttribute("db.system.name", "postgresql"),
        stringAttribute("server.address", "127.0.0.1"),
      ],
    ],
  ])(
    "no key for %s",
    async (
      _label: string,
      kind: number,
      spanAttributes: Array<OtlpAttribute>,
    ) => {
      const captured: CapturedTraceRows = setupTraceMocks();

      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [
            {
              spanId: OTHER_SPAN_ID,
              name: "work",
              kind: kind,
              attributes: spanAttributes,
            },
          ],
        }),
      );

      const row: JSONObject = spanById(captured.spans, OTHER_SPAN_ID);
      expect(row["entityKeys"]).toBe(sharedMetadata.entityKeys);
      expect(row["entityKeys"]).toEqual(RESOURCE_KEYS);
    },
  );

  test("spans without a system attribute cost no resolver or caller work", async () => {
    setupTraceMocks();
    const resolveSpy: jest.SpyInstance = jest.spyOn(
      DatabaseTelemetryResolverModule,
      "resolveDatabaseCallTarget",
    );
    const contextSpy: jest.SpyInstance = jest.spyOn(
      DatabaseEndpointModule,
      "buildDatabaseCallerContext",
    );

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest({
        spans: [
          {
            spanId: CLIENT_SPAN_ID,
            name: "GET /inventory",
            kind: CLIENT_KIND,
            attributes: [
              stringAttribute("server.address", "inventory.example.com"),
            ],
          },
          {
            spanId: SERVER_SPAN_ID,
            name: "GET /orders",
            kind: SERVER_KIND,
            attributes: [],
          },
        ],
      }),
    );

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(contextSpy).not.toHaveBeenCalled();
  });

  test("an exception row on a DB CLIENT span keeps the resource's keys", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest({
        spans: [
          {
            spanId: CLIENT_SPAN_ID,
            name: "SELECT orders",
            kind: CLIENT_KIND,
            attributes: POSTGRES_CALL,
            events: [
              {
                timeUnixNano: START_NANO,
                name: "exception",
                attributes: [
                  stringAttribute("exception.type", "PSQLException"),
                  stringAttribute(
                    "exception.message",
                    "relation orders does not exist",
                  ),
                  stringAttribute(
                    "exception.stacktrace",
                    "PSQLException: relation orders does not exist\n    at Driver.query(Driver.java:10)",
                  ),
                ],
              },
            ],
          },
        ],
      }),
    );

    const clientRow: JSONObject = spanById(captured.spans, CLIENT_SPAN_ID);
    expect(clientRow["entityKeys"]).toEqual([...RESOURCE_KEYS, EXPECTED_KEY]);

    expect(captured.exceptions).toHaveLength(1);
    expect(captured.exceptions[0]!["entityKeys"]).toEqual(RESOURCE_KEYS);
    expect(captured.exceptions[0]!["entityKeys"]).toBe(
      sharedMetadata.entityKeys,
    );
  });

  test("a scrubbed server.address yields no key (the FINAL row decides)", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();
    jest
      .spyOn(TraceScrubRuleService, "loadScrubRules")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([{}] as any);
    jest
      .spyOn(TraceScrubRuleService, "scrubSpan")
      .mockImplementation((row: JSONObject): JSONObject => {
        return {
          ...row,
          attributes: {
            ...(row["attributes"] as JSONObject),
            "server.address": "[REDACTED]",
          },
        };
      });

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest({
        spans: [
          {
            spanId: CLIENT_SPAN_ID,
            name: "SELECT orders",
            kind: CLIENT_KIND,
            attributes: POSTGRES_CALL,
          },
        ],
      }),
    );

    const clientRow: JSONObject = spanById(captured.spans, CLIENT_SPAN_ID);
    expect(clientRow["entityKeys"]).toEqual(RESOURCE_KEYS);
  });

  test("a pipeline that rewrites server.address keys the rewritten server", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();
    jest
      .spyOn(TracePipelineService, "loadPipelines")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([{}] as any);
    jest
      .spyOn(TracePipelineService, "processSpan")
      .mockImplementation((row: JSONObject): JSONObject => {
        (row["attributes"] as JSONObject)["server.address"] =
          "orders-db-replica.example.com";
        return row;
      });

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest({
        spans: [
          {
            spanId: CLIENT_SPAN_ID,
            name: "SELECT orders",
            kind: CLIENT_KIND,
            attributes: POSTGRES_CALL,
          },
        ],
      }),
    );

    const clientRow: JSONObject = spanById(captured.spans, CLIENT_SPAN_ID);
    expect(clientRow["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      keyForDatabaseEndpoint(PROJECT_ID.toString(), {
        host: "orders-db-replica.example.com",
        port: 5432,
      }),
    ]);
  });

  test("a short name is expanded with the CALLING pod's namespace and cluster", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest({
        resourceAttributes: [
          stringAttribute("k8s.namespace.name", "shop"),
          stringAttribute("k8s.cluster.name", "prod-eu"),
          stringAttribute("k8s.pod.name", "orders-api-5f7c9"),
        ],
        spans: [
          {
            spanId: CLIENT_SPAN_ID,
            name: "SELECT orders",
            kind: CLIENT_KIND,
            attributes: [
              stringAttribute("db.system.name", "postgresql"),
              stringAttribute("server.address", "postgres"),
            ],
          },
        ],
      }),
    );

    const clientRow: JSONObject = spanById(captured.spans, CLIENT_SPAN_ID);
    expect(clientRow["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      keyForDatabaseEndpoint(PROJECT_ID.toString(), {
        host: "postgres.shop.svc.cluster.local",
        port: 5432,
        kubernetesClusterName: "prod-eu",
      }),
    ]);
  });

  test("many spans to one database resolve the target once per request", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();
    const keySpy: jest.SpyInstance = jest.spyOn(
      EntityKeyModule,
      "keyForDatabaseEndpoint",
    );

    const spans: Array<SpanInput> = [];
    for (let i: number = 0; i < 20; i++) {
      spans.push({
        spanId: `${i.toString(16).padStart(2, "0")}be7c8279314442`,
        name: "SELECT orders",
        kind: CLIENT_KIND,
        attributes: POSTGRES_CALL,
      });
    }

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest({ spans: spans }),
    );

    expect(captured.spans).toHaveLength(20);
    for (const row of captured.spans) {
      expect(row["entityKeys"]).toEqual([...RESOURCE_KEYS, EXPECTED_KEY]);
    }
    expect(keySpy).toHaveBeenCalledTimes(1);
  });
});

/*
 * ---- Metrics pillar: per-datapoint keys -----------------------------------
 */

const METRIC_AUTO_DISCOVERY_METHODS: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverIoTFleet",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

type MetricInput = {
  name: string;
  datapoints: Array<Array<OtlpAttribute>>;
};

function noRules(): MetricRulesForProject {
  return { projectRules: [], rulesByServiceId: new Map() };
}

function setupMetricMocks(rules: MetricRulesForProject): Array<JSONObject> {
  const rows: Array<JSONObject> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelMetricsIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  jest.spyOn(service, "runBatchHostEnrichment").mockResolvedValue(undefined);
  jest
    .spyOn(service, "submitMetricsBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const buffer: Array<JSONObject> = args[0] as Array<JSONObject>;
      rows.push(...buffer.splice(0, buffer.length));
      return Promise.resolve();
    });
  for (const method of METRIC_AUTO_DISCOVERY_METHODS) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }
  jest
    .spyOn(service, "resolveTelemetryResource")
    .mockImplementation(async (): Promise<TelemetryServiceMetadata> => {
      return applicationMetadata();
    });
  jest.spyOn(MetricPipelineRuleService, "loadRules").mockResolvedValue(rules);
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue(undefined as any);

  return rows;
}

function metricsRequest(metrics: Array<MetricInput>): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: {
      resourceMetrics: [
        {
          resource: {
            attributes: [stringAttribute("service.name", SERVICE_NAME)],
          },
          scopeMetrics: [
            {
              scope: { name: "io.opentelemetry.jdbc", version: "2.9.0" },
              metrics: metrics.map((metric: MetricInput): JSONObject => {
                return {
                  name: metric.name,
                  unit: "s",
                  histogram: {
                    aggregationTemporality: 2,
                    dataPoints: metric.datapoints.map(
                      (dpAttributes: Array<OtlpAttribute>): JSONObject => {
                        return {
                          timeUnixNano: START_NANO,
                          startTimeUnixNano: START_NANO,
                          count: 3,
                          sum: 0.012,
                          bucketCounts: [3, 0],
                          explicitBounds: [0.1],
                          attributes: dpAttributes,
                        } as unknown as JSONObject;
                      },
                    ),
                  },
                };
              }),
            },
          ],
        },
      ],
    },
    headers: {},
  } as unknown as TelemetryRequest;
}

function rowsNamed(rows: Array<JSONObject>, name: string): Array<JSONObject> {
  return rows.filter((row: JSONObject) => {
    return row["name"] === name;
  });
}

describe("metrics: per-datapoint database keys (db.client.*)", () => {
  test("a db.client.* datapoint naming a server carries its key; other metrics with the same attributes do not", async () => {
    const rows: Array<JSONObject> = setupMetricMocks(noRules());

    await OtelMetricsIngestService.processMetricsFromQueue(
      metricsRequest([
        { name: "db.client.operation.duration", datapoints: [POSTGRES_CALL] },
        { name: "http.client.request.duration", datapoints: [POSTGRES_CALL] },
      ]),
    );

    const dbRow: JSONObject = rowsNamed(
      rows,
      "db.client.operation.duration",
    )[0]!;
    const httpRow: JSONObject = rowsNamed(
      rows,
      "http.client.request.duration",
    )[0]!;

    expect(dbRow["entityKeys"]).toEqual([...RESOURCE_KEYS, EXPECTED_KEY]);
    expect(dbRow["entityKeys"]).not.toBe(sharedMetadata.entityKeys);
    expect(httpRow["entityKeys"]).toBe(sharedMetadata.entityKeys);
    expect(sharedMetadata.entityKeys).toEqual(RESOURCE_KEYS);
  });

  test("the keyed metric row keeps the golden field order", async () => {
    const rows: Array<JSONObject> = setupMetricMocks(noRules());

    await OtelMetricsIngestService.processMetricsFromQueue(
      metricsRequest([
        { name: "db.client.operation.duration", datapoints: [POSTGRES_CALL] },
      ]),
    );

    const dbRow: JSONObject = rowsNamed(
      rows,
      "db.client.operation.duration",
    )[0]!;
    expect(Object.keys(dbRow)).toEqual(EXPECTED_METRIC_ROW_KEY_ORDER);
  });

  test("each datapoint is keyed by ITS server — two servers, two keys, one metric", async () => {
    const rows: Array<JSONObject> = setupMetricMocks(noRules());

    await OtelMetricsIngestService.processMetricsFromQueue(
      metricsRequest([
        {
          name: "db.client.operation.duration",
          datapoints: [
            POSTGRES_CALL,
            [
              stringAttribute("db.system.name", "redis"),
              stringAttribute("server.address", "cache.example.com"),
            ],
          ],
        },
      ]),
    );

    const dbRows: Array<JSONObject> = rowsNamed(
      rows,
      "db.client.operation.duration",
    );
    expect(dbRows).toHaveLength(2);
    const keys: Array<string> = dbRows.map((row: JSONObject): string => {
      const entityKeys: Array<string> = row["entityKeys"] as Array<string>;
      return entityKeys[entityKeys.length - 1]!;
    });
    expect(keys.sort()).toEqual(
      [
        EXPECTED_KEY,
        keyForDatabaseEndpoint(PROJECT_ID.toString(), {
          host: "cache.example.com",
          port: 6379,
        }),
      ].sort(),
    );
  });

  test("a pool metric with no server attribute gets no key", async () => {
    const rows: Array<JSONObject> = setupMetricMocks(noRules());

    await OtelMetricsIngestService.processMetricsFromQueue(
      metricsRequest([
        {
          name: "db.client.connection.count",
          datapoints: [
            [
              stringAttribute("db.system.name", "postgresql"),
              stringAttribute("db.client.connection.pool.name", "orders-pool"),
            ],
          ],
        },
      ]),
    );

    const row: JSONObject = rowsNamed(rows, "db.client.connection.count")[0]!;
    expect(row["entityKeys"]).toBe(sharedMetadata.entityKeys);
  });

  test("metric names are matched after the ingest lower-casing", async () => {
    const rows: Array<JSONObject> = setupMetricMocks(noRules());

    await OtelMetricsIngestService.processMetricsFromQueue(
      metricsRequest([
        { name: "DB.Client.Operation.Duration", datapoints: [POSTGRES_CALL] },
      ]),
    );

    const row: JSONObject = rowsNamed(rows, "db.client.operation.duration")[0]!;
    expect(row["entityKeys"]).toEqual([...RESOURCE_KEYS, EXPECTED_KEY]);
  });

  test("a rule that renames server.address away leaves no key (the FINAL row decides)", async () => {
    const renameAddress: MetricPipelineRule = new MetricPipelineRule();
    renameAddress.ruleType = MetricPipelineRuleType.RenameAttribute;
    renameAddress.renameFromKey = "server.address";
    renameAddress.renameToKey = "peer.redacted";
    renameAddress.filters = [
      {
        checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
        attributeKey: "server.address",
        conditionType: MetricPipelineRuleFilterConditionType.IsPresent,
      },
    ];
    const rows: Array<JSONObject> = setupMetricMocks({
      projectRules: [renameAddress],
      rulesByServiceId: new Map(),
    });

    await OtelMetricsIngestService.processMetricsFromQueue(
      metricsRequest([
        { name: "db.client.operation.duration", datapoints: [POSTGRES_CALL] },
      ]),
    );

    const row: JSONObject = rowsNamed(rows, "db.client.operation.duration")[0]!;
    expect((row["attributes"] as JSONObject)["server.address"]).toBeUndefined();
    expect(row["entityKeys"]).toBe(sharedMetadata.entityKeys);
  });

  test("a rule that renames the metric out of db.client.* leaves no key", async () => {
    const renameMetric: MetricPipelineRule = new MetricPipelineRule();
    renameMetric.ruleType = MetricPipelineRuleType.RenameMetric;
    renameMetric.renameToKey = "orders.sql.duration";
    renameMetric.filters = [
      {
        checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
        conditionType: MetricPipelineRuleFilterConditionType.EqualTo,
        value: "db.client.operation.duration",
      },
    ];
    const rows: Array<JSONObject> = setupMetricMocks({
      projectRules: [renameMetric],
      rulesByServiceId: new Map(),
    });

    await OtelMetricsIngestService.processMetricsFromQueue(
      metricsRequest([
        { name: "db.client.operation.duration", datapoints: [POSTGRES_CALL] },
      ]),
    );

    const row: JSONObject = rowsNamed(rows, "orders.sql.duration")[0]!;
    expect(row["entityKeys"]).toBe(sharedMetadata.entityKeys);
  });
});
