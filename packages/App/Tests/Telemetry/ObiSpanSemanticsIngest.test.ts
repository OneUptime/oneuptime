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

import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import TraceDropFilterService, {
  LoadedTraceDropFilter,
} from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import { compileFilter } from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TraceDropFilter from "Common/Models/DatabaseModels/TraceDropFilter";
import TraceDropFilterAction from "Common/Types/Trace/TraceDropFilterAction";
import { SpanKind } from "Common/Models/AnalyticsModels/Span";
import {
  DatabaseEndpoint,
  buildDatabaseCallerContext,
} from "Common/Types/DatabaseServer/DatabaseEndpoint";
import { resolveDatabaseCallTarget } from "Common/Types/DatabaseServer/DatabaseTelemetryResolver";
import {
  DiscoveredDatabaseEndpoint,
  getDatabaseEndpointCallerContextNeeds,
  resolveDatabaseEndpointRows,
} from "Common/Server/Utils/Telemetry/DatabaseEndpointDiscovery";
import {
  ClientSpanDependencyRow,
  DependencyTarget,
  resolveClientSpanTarget,
} from "Common/Server/Utils/Telemetry/ServiceDependencyDiscovery";
import { MESSAGING_RESOLVER_INPUT_ATTRIBUTES } from "Common/Types/MessageQueue/MessagingTelemetryResolver";
import {
  DiscoveredMessageQueue,
  MessagingSpanDiscoveryRow,
  getMessagingDiscoveryColumn,
  resolveMessagingSpanDiscoveryRows,
} from "Common/Server/Utils/Telemetry/MessageQueueDiscovery";
import {
  toStoredColumns,
  toStoredKind,
} from "Common/Tests/Types/MessageQueue/MessagingTelemetryFixtures";
import {
  MessageQueueIdentity,
  toMessageQueueIdentity,
} from "Common/Types/MessageQueue/MessageQueueIdentity";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  keyForDatabaseEndpoint,
  keyForMessageQueue,
} from "Common/Utils/Telemetry/EntityKey";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONObject } from "Common/Types/JSON";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * OBI records a ClickHouse statement sent over HTTP as a bare `POST /` and
 * BullMQ's queue operations as bare Redis calls (`evalsha`, `bzpopmin`), and
 * writes its own span.metrics.skip note on its spans. Through the real
 * ingest service, pinned here with the attributes OBI v0.14 sent from
 * production:
 *
 *   - the ClickHouse insert is stored as `INSERT LogItemV3` with ClickHouse's
 *     database attributes and its HTTP ones, keyed to its ClickHouse
 *     endpoint; database discovery finds that endpoint from the stored row,
 *     and the service map reads it as a ClickHouse database; the health
 *     check `GET /` is stored as it came;
 *   - BullMQ's publish, receives and settle are stored with the Telemetry
 *     queue's messaging attributes, names and keys — the publish and the
 *     receives as CLIENT calls that still count towards Redis, the settle as
 *     the queue's CONSUMER span — and the queue is discovered from them
 *     once; BullMQ's other scripts stay plain Redis calls;
 *   - span.metrics.skip is stored on no OBI span, in either spelling;
 *   - an SDK's spans of the very same shape, and the SERVER spans OBI
 *     records inside ClickHouse and Redis, are stored as they came;
 *   - all of it is decided before the evaluation row: drop filters, scrub
 *     rules and pipelines see the stored span.
 *
 * The harness is ObiReceivingSideMessagingSpanIngest.test.ts's.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

const TRACE_ID_HEX: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const START_MS: number = Date.UTC(2026, 9, 27, 10, 0, 0, 0);
const START_NANO: string = `${START_MS}000000`;
const END_NANO: string = `${START_MS + 3}000000`;

// Resource-level keys the resolver stamped (service, pod, cluster, …).
const RESOURCE_KEYS: Array<string> = ["0123456789abcdef", "fedcba9876543210"];

const OBI_DISTRO: string = "opentelemetry-ebpf-instrumentation";
const SDK_DISTRO: string = "opentelemetry-js-instrumentation";
const NAMESPACE: string = "default";
const CLUSTER: string = "oneuptime-prod";

type OtlpAttribute = {
  key: string;
  value: JSONObject;
};

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

// OTLP/JSON writes an int64 as its decimal string, as OBI's exports do.
function intAttribute(key: string, value: number): OtlpAttribute {
  return { key: key, value: { intValue: String(value) } };
}

function boolAttribute(key: string, value: boolean): OtlpAttribute {
  return { key: key, value: { boolValue: value } };
}

/*
 * A resource as OBI v0.14 sends it from the agent, with span.metrics.skip on
 * the resource too, the spelling a span shows as
 * `resource.span.metrics.skip`.
 */
function obiResourceAttributes(
  distro: string = OBI_DISTRO,
): Array<OtlpAttribute> {
  return [
    stringAttribute("telemetry.sdk.language", "nodejs"),
    stringAttribute("telemetry.sdk.name", "opentelemetry"),
    stringAttribute("telemetry.distro.name", distro),
    stringAttribute("telemetry.distro.version", "v0.14.0"),
    stringAttribute("k8s.namespace.name", NAMESPACE),
    stringAttribute("k8s.cluster.name", CLUSTER),
    stringAttribute("k8s.deployment.name", "oneuptime-app"),
    boolAttribute("span.metrics.skip", true),
  ];
}

let issuedMetadata: Array<TelemetryServiceMetadata> = [];

function metadataFor(serviceName: string): TelemetryServiceMetadata {
  const metadata: TelemetryServiceMetadata = {
    serviceName: serviceName,
    primaryEntityId: ObjectID.generate(),
    primaryEntityType: ServiceType.OpenTelemetry,
    entityKeys: [...RESOURCE_KEYS],
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  };
  issuedMetadata.push(metadata);
  return metadata;
}

afterEach(() => {
  jest.restoreAllMocks();
  issuedMetadata = [];
});

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
};

type CapturedTraceRows = {
  spans: Array<JSONObject>;
};

function setupTraceMocks(): CapturedTraceRows {
  const captured: CapturedTraceRows = { spans: [] };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelTracesIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  for (const method of TRACE_AUTO_DISCOVERY_METHODS) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }

  // One Service per resource, named by its service.name.
  jest
    .spyOn(service, "resolveTelemetryResource")
    .mockImplementation(
      async (...args: Array<unknown>): Promise<TelemetryServiceMetadata> => {
        const attributes: Array<OtlpAttribute> = (
          args[0] as { attributes: Array<OtlpAttribute> }
        ).attributes;
        const serviceName: OtlpAttribute | undefined = attributes.find(
          (attribute: OtlpAttribute): boolean => {
            return attribute.key === "service.name";
          },
        );
        return metadataFor(
          String(
            (serviceName?.value as { stringValue?: string } | undefined)
              ?.stringValue || "",
          ),
        );
      },
    );

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
      (args[0] as Array<JSONObject>).splice(0);
      return Promise.resolve();
    });

  jest
    .spyOn(TraceDropFilterService, "loadDropFilters")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

type ResourceSpansInput = {
  serviceName: string;
  resourceAttributes: Array<OtlpAttribute>;
  spans: Array<SpanInput>;
};

function tracesRequest(resources: Array<ResourceSpansInput>): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: {
      resourceSpans: resources.map(
        (resource: ResourceSpansInput): JSONObject => {
          return {
            resource: {
              attributes: [
                stringAttribute("service.name", resource.serviceName),
                ...resource.resourceAttributes,
              ],
            },
            scopeSpans: [
              {
                scope: { name: "go.opentelemetry.io/obi" },
                spans: resource.spans.map((span: SpanInput): JSONObject => {
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
                    events: [],
                    links: [],
                  } as unknown as JSONObject;
                }),
              },
            ],
          } as unknown as JSONObject;
        },
      ),
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

function attributesOf(row: JSONObject): JSONObject {
  return row["attributes"] as JSONObject;
}

// OTLP kinds on the wire.
const SERVER_KIND: number = 2;
const CLIENT_KIND: number = 3;

// ---- the spans, from production -----------------------------------------

const CLICKHOUSE_QUERY_STRING: string =
  "query_id=1472fec1-bab2-4dbf-b613-b94c6d8bc0e2&async_insert=1&wait_for_async_insert=0&async_insert_deduplicate=1&insert_deduplication_token=fanin%3ALogItemV3%3A01a17c37-62b6-7a50-a87a-adb5cc36ec4b&database=oneuptime&query=INSERT+INTO+LogItemV3+FORMAT";

const SHA: string = "d898c9a1b24ab7ed9510995fa28eb5874d0cf10e";

const ADD_STANDARD_JOB_TEXT: string = `evalsha ${SHA} 9 bull:Telemetry:wait bull:Telemetry:paused bull:Telemetry:meta bull:Telemetry:id bull:Telemetry:completed bull:Telemetry:delayed`;
const MOVE_TO_ACTIVE_TEXT: string = `evalsha 8e8b1d4c4b1bd76c3c3d1a3b0f2a6e5d4c3b2a19 11 bull:Telemetry:wait bull:Telemetry:active bull:Telemetry:prioritized bull:Telemetry:events bull:Telemetry:stalled bull:Telemetry:limiter bull:Telemetry:delayed bull:Telemetry:pau`;
const BLOCKING_POP_TEXT: string = "bzpopmin bull:Telemetry:marker 5";
const MOVE_TO_FINISHED_TEXT: string = `evalsha 0c1b2a3d4e5f60718293a4b5c6d7e8f901234567 14 bull:Telemetry:wait bull:Telemetry:active bull:Telemetry:prioritized bull:Telemetry:events bull:Telemetry:stalled bull:Telemetry:limiter bull:Telemetry:delayed`;
const EXTEND_LOCK_TEXT: string = `evalsha 5f2b1a0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a 2 bull:Telemetry:1042:lock bull:Telemetry:stalled 6c3a 30000 1042`;

const CLICKHOUSE_INSERT_SPAN_ID: string = "a1b2c3d4e5f60718";
const CLICKHOUSE_HEALTH_SPAN_ID: string = "b2c3d4e5f6071829";
const BULLMQ_PUBLISH_SPAN_ID: string = "c3d4e5f60718293a";
const BULLMQ_RECEIVE_SPAN_ID: string = "d4e5f60718293a4b";
const BULLMQ_WAIT_SPAN_ID: string = "e5f60718293a4b5c";
const BULLMQ_SETTLE_SPAN_ID: string = "f60718293a4b5c6d";
const BULLMQ_EXTEND_LOCK_SPAN_ID: string = "0718293a4b5c6d7e";
const APP_REQUEST_SPAN_ID: string = "18293a4b5c6d7e8f";
const CLICKHOUSE_SERVER_SPAN_ID: string = "293a4b5c6d7e8f90";
const VALKEY_SERVER_SPAN_ID: string = "3a4b5c6d7e8f9001";

// The span ids of the SDK resource's copies.
function sdkSpanId(spanId: string): string {
  return `${spanId.slice(0, 14)}ff`;
}

// The fan-in writer's insert, as OBI recorded it.
function clickHouseInsertAttributes(): Array<OtlpAttribute> {
  return [
    stringAttribute("server.address", "oneuptime-clickhouse"),
    intAttribute("server.port", 4129),
    stringAttribute("service.peer.name", "oneuptime-clickhouse"),
    stringAttribute("http.request.method", "POST"),
    intAttribute("http.response.status_code", 200),
    stringAttribute("url.scheme", "http"),
    stringAttribute("url.full", `/?${CLICKHOUSE_QUERY_STRING}`),
    stringAttribute("url.query", CLICKHOUSE_QUERY_STRING),
    stringAttribute("network.peer.address", "10.96.14.201"),
    intAttribute("network.peer.port", 4129),
    boolAttribute("span.metrics.skip", true),
  ];
}

function clickHouseHealthAttributes(): Array<OtlpAttribute> {
  return [
    stringAttribute("server.address", "oneuptime-clickhouse"),
    intAttribute("server.port", 4129),
    stringAttribute("service.peer.name", "oneuptime-clickhouse"),
    stringAttribute("http.request.method", "GET"),
    intAttribute("http.response.status_code", 200),
    stringAttribute("url.scheme", "http"),
    stringAttribute(
      "url.full",
      "http://oneuptime-clickhouse.default.svc.cluster.local/",
    ),
    boolAttribute("span.metrics.skip", true),
  ];
}

function redisAttributes(queryText: string): Array<OtlpAttribute> {
  return [
    stringAttribute("server.address", "oneuptime-valkey-master"),
    intAttribute("server.port", 6379),
    stringAttribute("service.peer.name", "oneuptime-valkey-master"),
    stringAttribute("db.system.name", "redis"),
    stringAttribute("db.operation.name", queryText.split(" ")[0]!),
    stringAttribute("db.query.text", queryText),
    stringAttribute("network.peer.address", "10.96.100.12"),
    intAttribute("network.peer.port", 6379),
    boolAttribute("span.metrics.skip", true),
  ];
}

// What the App's pod sends: its calls, and a request it served.
function appSpans(spanIdOf: (spanId: string) => string): Array<SpanInput> {
  return [
    {
      spanId: spanIdOf(CLICKHOUSE_INSERT_SPAN_ID),
      name: "POST /",
      kind: CLIENT_KIND,
      attributes: clickHouseInsertAttributes(),
    },
    {
      spanId: spanIdOf(CLICKHOUSE_HEALTH_SPAN_ID),
      name: "GET /",
      kind: CLIENT_KIND,
      attributes: clickHouseHealthAttributes(),
    },
    {
      spanId: spanIdOf(BULLMQ_PUBLISH_SPAN_ID),
      name: "evalsha",
      kind: CLIENT_KIND,
      attributes: redisAttributes(ADD_STANDARD_JOB_TEXT),
    },
    {
      spanId: spanIdOf(BULLMQ_RECEIVE_SPAN_ID),
      name: "evalsha",
      kind: CLIENT_KIND,
      attributes: redisAttributes(MOVE_TO_ACTIVE_TEXT),
    },
    {
      spanId: spanIdOf(BULLMQ_WAIT_SPAN_ID),
      name: "bzpopmin",
      kind: CLIENT_KIND,
      attributes: redisAttributes(BLOCKING_POP_TEXT),
    },
    {
      spanId: spanIdOf(BULLMQ_SETTLE_SPAN_ID),
      name: "evalsha",
      kind: CLIENT_KIND,
      attributes: redisAttributes(MOVE_TO_FINISHED_TEXT),
    },
    {
      spanId: spanIdOf(BULLMQ_EXTEND_LOCK_SPAN_ID),
      name: "evalsha",
      kind: CLIENT_KIND,
      attributes: redisAttributes(EXTEND_LOCK_TEXT),
    },
    {
      spanId: spanIdOf(APP_REQUEST_SPAN_ID),
      name: "GET /status/ready",
      kind: SERVER_KIND,
      attributes: [
        intAttribute("server.port", 3002),
        stringAttribute("http.request.method", "GET"),
        intAttribute("http.response.status_code", 200),
        stringAttribute("url.path", "/status/ready"),
        stringAttribute("http.route", "/status/ready"),
        boolAttribute("span.metrics.skip", true),
      ],
    },
  ];
}

function sameSpanId(spanId: string): string {
  return spanId;
}

function appResource(): ResourceSpansInput {
  return {
    serviceName: "oneuptime-app",
    resourceAttributes: obiResourceAttributes(),
    spans: appSpans(sameSpanId),
  };
}

// The same spans from an application's own SDK: none of OBI's.
function sdkResource(): ResourceSpansInput {
  return {
    serviceName: "oneuptime-app-sdk",
    resourceAttributes: obiResourceAttributes(SDK_DISTRO),
    spans: appSpans(sdkSpanId),
  };
}

// The spans OBI records inside ClickHouse and Redis for those calls.
function serverResources(): Array<ResourceSpansInput> {
  return [
    {
      serviceName: "oneuptime-clickhouse",
      resourceAttributes: obiResourceAttributes(),
      spans: [
        {
          spanId: CLICKHOUSE_SERVER_SPAN_ID,
          name: "POST /",
          kind: SERVER_KIND,
          attributes: clickHouseInsertAttributes(),
        },
      ],
    },
    {
      serviceName: "oneuptime-valkey",
      resourceAttributes: obiResourceAttributes(),
      spans: [
        {
          spanId: VALKEY_SERVER_SPAN_ID,
          name: "evalsha",
          kind: SERVER_KIND,
          attributes: redisAttributes(ADD_STANDARD_JOB_TEXT),
        },
      ],
    },
  ];
}

function everyResource(): Array<ResourceSpansInput> {
  return [appResource(), sdkResource(), ...serverResources()];
}

// ---- what the rows should carry -----------------------------------------

/*
 * The database endpoint a call to `system` at address:port resolves to from
 * the caller a stored row names (its `resource.`-prefixed attributes): what
 * DatabaseCallEntityKeys keys a CLIENT call to.
 */
function databaseEndpoint(
  row: JSONObject,
  system: string,
  address: string,
  port: number,
): DatabaseEndpoint {
  const call: Record<string, unknown> = {
    "db.system.name": system,
    "server.address": address,
    "server.port": String(port),
  };
  const target: { endpoint: DatabaseEndpoint } | null =
    resolveDatabaseCallTarget({
      getAttribute: (key: string): unknown => {
        return call[key];
      },
      caller: buildDatabaseCallerContext(attributesOf(row)),
    });
  expect(target).not.toBeNull();
  return target!.endpoint;
}

function clickHouseEndpointKey(row: JSONObject): string {
  return keyForDatabaseEndpoint(
    PROJECT_ID.toString(),
    databaseEndpoint(row, "clickhouse", "oneuptime-clickhouse", 4129),
  );
}

function redisEndpointKey(row: JSONObject): string {
  return keyForDatabaseEndpoint(
    PROJECT_ID.toString(),
    databaseEndpoint(row, "redis", "oneuptime-valkey-master", 6379),
  );
}

function queueKey(system: string, destination: string): string {
  const identity: MessageQueueIdentity | null = toMessageQueueIdentity({
    system: system,
    brokerScope: "",
    destination: destination,
  });
  if (!identity) {
    throw new Error(`Not a queue identity: ${system}|${destination}`);
  }
  return keyForMessageQueue(PROJECT_ID.toString(), identity);
}

const TELEMETRY_QUEUE_KEY: string = queueKey("bullmq", "Telemetry");

/*
 * What the queue discovery cron reads back for ONE stored span row: the
 * resolver input attributes as the ClickHouse columns hold them, and the
 * kind column's text.
 */
function messagingDiscoveryRowFor(row: JSONObject): MessagingSpanDiscoveryRow {
  const stored: Record<string, string> = toStoredColumns(
    attributesOf(row),
    MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
  );
  const queryRow: MessagingSpanDiscoveryRow = {
    kind: toStoredKind(row["kind"]),
    spanCount: "1",
    errorCount: "0",
    lastSeenUnixMs: String(START_MS),
  };
  MESSAGING_RESOLVER_INPUT_ATTRIBUTES.forEach(
    (attribute: string, column: number): void => {
      queryRow[getMessagingDiscoveryColumn(column)] = stored[attribute];
    },
  );
  return queryRow;
}

function text(value: unknown): string {
  return typeof value === "string"
    ? value
    : value === undefined
      ? ""
      : String(value);
}

function dropFilter(filterQuery: string): LoadedTraceDropFilter {
  /*
   * No id on the model on purpose: recordDrop() short-circuits without one,
   * keeping the drop-recorder (and its Redis surface) out of this suite.
   */
  const filter: TraceDropFilter = new TraceDropFilter();
  filter.action = TraceDropFilterAction.Drop;

  return {
    filter: filter,
    compiledFilter: compileFilter(filterQuery, { emptyQueryMatches: false }),
    projectId: PROJECT_ID,
  };
}

async function ingest(resources: Array<ResourceSpansInput>): Promise<void> {
  await OtelTracesIngestService.processTracesFromQueue(
    tracesRequest(resources),
  );
}

describe("an OBI ClickHouse insert over HTTP at ingest", () => {
  test("is stored as `INSERT LogItemV3`, CLIENT, with ClickHouse's database attributes beside every HTTP one OBI wrote", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await ingest([appResource()]);

    const row: JSONObject = spanById(captured.spans, CLICKHOUSE_INSERT_SPAN_ID);
    expect(row["name"]).toBe("INSERT LogItemV3");
    expect(row["kind"]).toBe(SpanKind.Client);
    expect(attributesOf(row)).toMatchObject({
      "db.system.name": "clickhouse",
      "db.namespace": "oneuptime",
      "db.query.text": "INSERT INTO LogItemV3 FORMAT",
      "db.operation.name": "INSERT",
      "db.collection.name": "LogItemV3",
      "server.address": "oneuptime-clickhouse",
      "server.port": "4129",
      "service.peer.name": "oneuptime-clickhouse",
      "http.request.method": "POST",
      "url.full": `/?${CLICKHOUSE_QUERY_STRING}`,
      "url.query": CLICKHOUSE_QUERY_STRING,
    });
    expect(row["attributeKeys"]).toEqual(
      expect.arrayContaining([
        "db.system.name",
        "db.namespace",
        "db.query.text",
        "db.operation.name",
        "db.collection.name",
        "server.address",
      ]),
    );
  });

  test("is keyed to its ClickHouse endpoint, which database discovery finds from the stored row", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await ingest([appResource()]);

    const row: JSONObject = spanById(captured.spans, CLICKHOUSE_INSERT_SPAN_ID);
    const endpoint: DatabaseEndpoint = databaseEndpoint(
      row,
      "clickhouse",
      "oneuptime-clickhouse",
      4129,
    );
    expect(endpoint).toEqual({
      host: `oneuptime-clickhouse.${NAMESPACE}.svc.cluster.local`,
      port: 4129,
      kubernetesClusterName: CLUSTER,
    });
    expect(row["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      clickHouseEndpointKey(row),
    ]);

    /*
     * The discovery query's row for it: CLIENT spans whose attribute keys
     * name a system and an address, grouped on what the resolver reads,
     * with the caller context its address needs.
     */
    const attributes: JSONObject = attributesOf(row);
    const keys: Array<string> = row["attributeKeys"] as Array<string>;
    expect(row["kind"]).toBe(SpanKind.Client);
    expect(keys).toEqual(
      expect.arrayContaining(["db.system.name", "server.address"]),
    );
    const address: string = text(attributes["server.address"]);
    const needs: { namespace: boolean; kubernetes: boolean; cluster: boolean } =
      getDatabaseEndpointCallerContextNeeds(address);
    const discovered: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows([
        {
          dbSystem: text(attributes["db.system.name"]),
          serverAddress: address,
          serverPort: text(attributes["server.port"]),
          dbInstance: "",
          callerNamespace: needs.namespace
            ? text(attributes["resource.k8s.namespace.name"])
            : "",
          callerInKubernetes: needs.kubernetes ? 1 : 0,
          callerCluster: needs.cluster
            ? text(attributes["resource.k8s.cluster.name"])
            : "",
          callCount: 1,
        },
      ]);
    expect(discovered).toHaveLength(1);
    expect(discovered[0]!.system).toBe("clickhouse");
    expect(discovered[0]!.endpoint).toEqual(endpoint);
    expect(
      keyForDatabaseEndpoint(PROJECT_ID.toString(), discovered[0]!.endpoint),
    ).toBe(clickHouseEndpointKey(row));
  });

  test("is drawn on the service map as a ClickHouse database, whatever HTTP attributes it keeps", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await ingest([appResource()]);

    const attributes: JSONObject = attributesOf(
      spanById(captured.spans, CLICKHOUSE_INSERT_SPAN_ID),
    );
    // What the unanswered-client-span query reads for this row.
    const dependencyRow: ClientSpanDependencyRow = {
      callerServiceId: "caller",
      dbSystem: text(attributes["db.system.name"]),
      dbNamespace: text(attributes["db.namespace"]),
      messagingSystem: text(attributes["messaging.system"]),
      peerService: text(attributes["service.peer.name"]),
      rpcSystem: "",
      rpcService: "",
      serverAddress: text(attributes["server.address"]),
      isHttp: attributes["http.request.method"] ? 1 : 0,
      dbTargets: [
        [
          text(attributes["server.address"]),
          text(attributes["server.port"]),
          "",
          NAMESPACE,
          "1",
          CLUSTER,
        ],
      ],
      callCount: 1,
      errorCount: 0,
      avgDurationNano: 3_000_000,
    };
    expect(dependencyRow.isHttp).toBe(1);

    // Even with ClickHouse's own pod a known service (OBI traces it too).
    for (const known of [
      new Set<string>(),
      new Set<string>(["oneuptime-clickhouse"]),
    ]) {
      const target: DependencyTarget | null = resolveClientSpanTarget(
        dependencyRow,
        known,
      );
      expect(target).toMatchObject({
        kind: "dependency",
        entity: {
          entityType: EntityType.Database,
          identifyingAttributes: {
            "db.system.name": "clickhouse",
            "server.address": "oneuptime-clickhouse",
            "db.namespace": "oneuptime",
          },
        },
      });
    }
  });

  test("the health check `GET /` carries no statement and is stored as it came", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await ingest([appResource()]);

    const row: JSONObject = spanById(captured.spans, CLICKHOUSE_HEALTH_SPAN_ID);
    expect(row["name"]).toBe("GET /");
    expect(row["kind"]).toBe(SpanKind.Client);
    expect(attributesOf(row)).not.toHaveProperty("db.system.name");
    expect(row["entityKeys"]).toEqual(RESOURCE_KEYS);
  });
});

describe("OBI's BullMQ calls at ingest", () => {
  test("the publish, the receives and the settle get the Telemetry queue: names, kinds and attributes", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await ingest([appResource()]);

    const expected: Array<{
      spanId: string;
      name: string;
      kind: SpanKind;
      type: string;
      operation: string;
      queryText: string;
    }> = [
      {
        spanId: BULLMQ_PUBLISH_SPAN_ID,
        name: "publish Telemetry",
        kind: SpanKind.Client,
        type: "send",
        operation: "publish",
        queryText: ADD_STANDARD_JOB_TEXT,
      },
      {
        spanId: BULLMQ_RECEIVE_SPAN_ID,
        name: "receive Telemetry",
        kind: SpanKind.Client,
        type: "receive",
        operation: "receive",
        queryText: MOVE_TO_ACTIVE_TEXT,
      },
      {
        spanId: BULLMQ_WAIT_SPAN_ID,
        name: "receive Telemetry",
        kind: SpanKind.Client,
        type: "receive",
        operation: "receive",
        queryText: BLOCKING_POP_TEXT,
      },
      {
        spanId: BULLMQ_SETTLE_SPAN_ID,
        name: "settle Telemetry",
        kind: SpanKind.Consumer,
        type: "settle",
        operation: "settle",
        queryText: MOVE_TO_FINISHED_TEXT,
      },
    ];

    for (const span of expected) {
      const row: JSONObject = spanById(captured.spans, span.spanId);
      expect({
        spanId: span.spanId,
        name: row["name"],
        kind: row["kind"],
      }).toEqual({ spanId: span.spanId, name: span.name, kind: span.kind });
      expect(attributesOf(row)).toMatchObject({
        "messaging.system": "bullmq",
        "messaging.destination.name": "Telemetry",
        "messaging.operation.type": span.type,
        "messaging.operation.name": span.operation,
        "db.system.name": "redis",
        "db.query.text": span.queryText,
        "server.address": "oneuptime-valkey-master",
      });
      expect(row["attributeKeys"]).toEqual(
        expect.arrayContaining([
          "messaging.system",
          "messaging.destination.name",
          "messaging.operation.type",
          "messaging.operation.name",
        ]),
      );
    }
  });

  test("each is keyed to the queue; the CLIENT ones are still Redis calls, the CONSUMER settle is not", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await ingest([appResource()]);

    for (const spanId of [
      BULLMQ_PUBLISH_SPAN_ID,
      BULLMQ_RECEIVE_SPAN_ID,
      BULLMQ_WAIT_SPAN_ID,
    ]) {
      const row: JSONObject = spanById(captured.spans, spanId);
      expect({ spanId: spanId, entityKeys: row["entityKeys"] }).toEqual({
        spanId: spanId,
        entityKeys: [
          ...RESOURCE_KEYS,
          redisEndpointKey(row),
          TELEMETRY_QUEUE_KEY,
        ],
      });
    }
    expect(
      spanById(captured.spans, BULLMQ_SETTLE_SPAN_ID)["entityKeys"],
    ).toEqual([...RESOURCE_KEYS, TELEMETRY_QUEUE_KEY]);
  });

  test("another script of BullMQ's stays a plain Redis call", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await ingest([appResource()]);

    const row: JSONObject = spanById(
      captured.spans,
      BULLMQ_EXTEND_LOCK_SPAN_ID,
    );
    expect(row["name"]).toBe("evalsha");
    expect(row["kind"]).toBe(SpanKind.Client);
    expect(attributesOf(row)).not.toHaveProperty("messaging.system");
    expect(row["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      redisEndpointKey(row),
    ]);
  });

  test("the queue is discovered once, from the four calls, by the direction each names", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await ingest(everyResource());

    const discovered: Array<DiscoveredMessageQueue> =
      resolveMessagingSpanDiscoveryRows(
        captured.spans.map(messagingDiscoveryRowFor),
      );
    expect(discovered).toHaveLength(1);
    expect(
      keyForMessageQueue(PROJECT_ID.toString(), discovered[0]!.identity),
    ).toBe(TELEMETRY_QUEUE_KEY);
    expect(discovered[0]!.system).toBe("bullmq");
    expect(discovered[0]!.destination).toBe("Telemetry");
    expect(discovered[0]!.spans?.count).toBe(4);
    expect(discovered[0]!.spans?.directions).toEqual({
      publish: 1,
      consume: 2,
      settle: 1,
      unknown: 0,
    });
  });

  test("the queue's page reads the publish as the App's send and the settle as its one consumed job", async () => {
    /*
     * MessageQueueTelemetryQueries' populations, over the queue's key:
     * PRODUCER spans, or CLIENT spans whose operation is a send, are
     * publishes (the latter counted for a service that records no
     * PRODUCER span); CONSUMER spans are messages consumed.
     */
    const captured: CapturedTraceRows = setupTraceMocks();

    await ingest(everyResource());

    const queueRows: Array<JSONObject> = captured.spans.filter(
      (row: JSONObject): boolean => {
        return (row["entityKeys"] as Array<string>).includes(
          TELEMETRY_QUEUE_KEY,
        );
      },
    );
    const spanIdsOf: (rows: Array<JSONObject>) => Array<string> = (
      rows: Array<JSONObject>,
    ): Array<string> => {
      return rows
        .map((row: JSONObject): string => {
          return row["spanId"] as string;
        })
        .sort();
    };

    expect(spanIdsOf(queueRows)).toEqual(
      [
        BULLMQ_PUBLISH_SPAN_ID,
        BULLMQ_RECEIVE_SPAN_ID,
        BULLMQ_WAIT_SPAN_ID,
        BULLMQ_SETTLE_SPAN_ID,
      ].sort(),
    );
    expect(
      spanIdsOf(
        queueRows.filter((row: JSONObject): boolean => {
          return (
            row["kind"] === SpanKind.Producer ||
            (row["kind"] === SpanKind.Client &&
              ["send", "publish"].includes(
                text(attributesOf(row)["messaging.operation.type"]),
              ))
          );
        }),
      ),
    ).toEqual([BULLMQ_PUBLISH_SPAN_ID]);
    expect(
      spanIdsOf(
        queueRows.filter((row: JSONObject): boolean => {
          return row["kind"] === SpanKind.Consumer;
        }),
      ),
    ).toEqual([BULLMQ_SETTLE_SPAN_ID]);
  });
});

describe("OBI's span.metrics.skip at ingest", () => {
  test("no OBI span stores it, from its span or its resource, among its attributes or their keys", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await ingest([appResource(), ...serverResources()]);

    expect(captured.spans).toHaveLength(10);
    for (const row of captured.spans) {
      expect({
        spanId: row["spanId"],
        skip: Object.keys(attributesOf(row)).filter((key: string): boolean => {
          return key.endsWith("span.metrics.skip");
        }),
        keys: (row["attributeKeys"] as Array<string>).filter(
          (key: string): boolean => {
            return key.endsWith("span.metrics.skip");
          },
        ),
      }).toEqual({ spanId: row["spanId"], skip: [], keys: [] });
    }
  });
});

describe("what is left as it came", () => {
  test("an SDK's spans of the very same shape: names, kinds, attributes, span.metrics.skip", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await ingest([sdkResource()]);

    const names: Record<string, unknown> = {};
    for (const row of captured.spans) {
      names[row["spanId"] as string] = row["name"];
      expect(row["kind"]).not.toBe(SpanKind.Consumer);
      expect(attributesOf(row)).not.toHaveProperty("messaging.system");
      expect(attributesOf(row)["db.system.name"]).not.toBe("clickhouse");
      expect(attributesOf(row)["span.metrics.skip"]).toBe(true);
      expect(attributesOf(row)["resource.span.metrics.skip"]).toBe(true);
    }
    expect(names).toEqual({
      [sdkSpanId(CLICKHOUSE_INSERT_SPAN_ID)]: "POST /",
      [sdkSpanId(CLICKHOUSE_HEALTH_SPAN_ID)]: "GET /",
      [sdkSpanId(BULLMQ_PUBLISH_SPAN_ID)]: "evalsha",
      [sdkSpanId(BULLMQ_RECEIVE_SPAN_ID)]: "evalsha",
      [sdkSpanId(BULLMQ_WAIT_SPAN_ID)]: "bzpopmin",
      [sdkSpanId(BULLMQ_SETTLE_SPAN_ID)]: "evalsha",
      [sdkSpanId(BULLMQ_EXTEND_LOCK_SPAN_ID)]: "evalsha",
      [sdkSpanId(APP_REQUEST_SPAN_ID)]: "GET /status/ready",
    });
  });

  test("the SERVER spans OBI records inside ClickHouse and Redis", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await ingest(serverResources());

    const clickHouse: JSONObject = spanById(
      captured.spans,
      CLICKHOUSE_SERVER_SPAN_ID,
    );
    expect(clickHouse["name"]).toBe("POST /");
    expect(clickHouse["kind"]).toBe(SpanKind.Server);
    expect(attributesOf(clickHouse)).not.toHaveProperty("db.system.name");

    const valkey: JSONObject = spanById(captured.spans, VALKEY_SERVER_SPAN_ID);
    expect(valkey["name"]).toBe("evalsha");
    expect(valkey["kind"]).toBe(SpanKind.Server);
    expect(attributesOf(valkey)).not.toHaveProperty("messaging.system");
    expect(valkey["entityKeys"]).toEqual(RESOURCE_KEYS);
  });
});

describe("decided before the evaluation row", () => {
  test("drop filters match the stored name and kind", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();
    jest
      .spyOn(TraceDropFilterService, "loadDropFilters")
      .mockResolvedValue([
        dropFilter("name = 'INSERT LogItemV3'"),
        dropFilter("kind = 'SPAN_KIND_CONSUMER'"),
      ]);

    await ingest([appResource()]);

    const stored: Array<string> = captured.spans.map(
      (row: JSONObject): string => {
        return row["spanId"] as string;
      },
    );
    expect(stored).not.toContain(CLICKHOUSE_INSERT_SPAN_ID);
    expect(stored).not.toContain(BULLMQ_SETTLE_SPAN_ID);
    expect(stored).toContain(BULLMQ_PUBLISH_SPAN_ID);
    expect(stored).toHaveLength(6);
  });

  test("drop filters, scrub rules and pipelines see the stored span, and never span.metrics.skip", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();
    const seen: Array<{ step: string; row: JSONObject }> = [];
    jest
      .spyOn(TraceDropFilterService, "loadDropFilters")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([{}] as any);
    jest
      .spyOn(TraceScrubRuleService, "loadScrubRules")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([{}] as any);
    jest
      .spyOn(TracePipelineService, "loadPipelines")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([{}] as any);
    jest
      .spyOn(TraceDropFilterService, "shouldDropSpan")
      .mockImplementation((row: JSONObject): boolean => {
        seen.push({ step: "dropFilter", row: row });
        return false;
      });
    jest
      .spyOn(TraceScrubRuleService, "scrubSpan")
      .mockImplementation((row: JSONObject): JSONObject => {
        seen.push({ step: "scrubRule", row: row });
        return row;
      });
    jest
      .spyOn(TracePipelineService, "processSpan")
      .mockImplementation((row: JSONObject): JSONObject => {
        seen.push({ step: "pipeline", row: row });
        return row;
      });

    await ingest([appResource()]);

    expect(captured.spans).toHaveLength(8);
    for (const step of ["dropFilter", "scrubRule", "pipeline"]) {
      const rows: Array<JSONObject> = seen
        .filter((entry: { step: string; row: JSONObject }): boolean => {
          return entry.step === step;
        })
        .map((entry: { step: string; row: JSONObject }): JSONObject => {
          return entry.row;
        });
      expect(rows).toHaveLength(8);

      const insert: JSONObject = spanById(rows, CLICKHOUSE_INSERT_SPAN_ID);
      expect({ step: step, name: insert["name"] }).toEqual({
        step: step,
        name: "INSERT LogItemV3",
      });
      expect(attributesOf(insert)["db.system.name"]).toBe("clickhouse");

      const settle: JSONObject = spanById(rows, BULLMQ_SETTLE_SPAN_ID);
      expect({
        step: step,
        name: settle["name"],
        kind: settle["kind"],
      }).toEqual({
        step: step,
        name: "settle Telemetry",
        kind: SpanKind.Consumer,
      });

      for (const row of rows) {
        expect(attributesOf(row)).not.toHaveProperty("span.metrics.skip");
        expect(attributesOf(row)).not.toHaveProperty(
          "resource.span.metrics.skip",
        );
      }
    }
  });
});

describe("where the step sits in the ingest service", () => {
  /*
   * Read from the source, comments stripped and whitespace collapsed (as
   * ObiReceivingSideMessagingSpanIngest.test.ts does): the behavioural tests
   * above prove what is stored; this pins that the step runs once per span,
   * after the inspector drop and before the attribute keys, LLM extraction
   * and the evaluation row, which reads its name and kind.
   */
  function readTracesService(): string {
    return fs
      .readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "FeatureSet",
          "Telemetry",
          "Services",
          "OtelTracesIngestService.ts",
        ),
        "utf8",
      )
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .replace(/\s+/g, " ");
  }

  test("applyObiSpanSemantics runs once, after the kind and the inspector drop, before the attribute keys, LLM extraction and the evaluation row", () => {
    const source: string = readTracesService();
    const step: string =
      "const obiSpan: ObiStoredSpan = applyObiSpanSemantics({ name: spanName, kind: spanKind, attributes: spanAttributes, });";
    const attributeKeys: string =
      "const attributeKeys: Array<string> = Object.keys(spanAttributes);";

    expect(source.split(step)).toHaveLength(2);
    expect(source.split("applyObiSpanSemantics(")).toHaveLength(2);
    expect(source.split(attributeKeys)).toHaveLength(2);

    const at: number = source.indexOf(step);
    expect(at).toBeGreaterThan(source.indexOf("const spanKind: SpanKind ="));
    expect(at).toBeGreaterThan(
      source.indexOf("obiNodeInspectorSpansDropped++; continue;"),
    );
    expect(at).toBeLessThan(source.indexOf(attributeKeys));
    expect(source.indexOf(attributeKeys)).toBeLessThan(
      source.indexOf("LlmSpanUtil.extract("),
    );
    expect(source.indexOf(attributeKeys)).toBeLessThan(
      source.indexOf("this.buildSpanEvaluationRow({"),
    );
    expect(source).toContain("name: obiSpan.name, kind: obiSpan.kind,");
  });
});
