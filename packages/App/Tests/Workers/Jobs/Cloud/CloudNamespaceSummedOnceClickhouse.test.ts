import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "Common/Types/Metrics/MetricsViewConfig";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import {
  CloudStreamSummary,
  getStreamedMetricKeys,
} from "Common/Types/CloudConnection/CloudStream";
import TimeRange from "Common/Types/Time/TimeRange";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepMetricMonitorUtil } from "Common/Types/Monitor/MonitorStepMetricMonitor";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "Common/Models/AnalyticsModels/Metric";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import {
  CloudMetricGroup,
  OtlpAttribute,
  buildMetricsPayloads,
  connectionResourceAttributes,
  stringAttribute,
} from "Common/Server/Utils/CloudConnection/CloudMetricPayload";
import { CloudStreamSighting } from "Common/Server/Utils/CloudConnection/CloudStreamActivity";
import {
  AzureStreamContext,
  AzureStreamMetricDefinition,
  AzureStreamResource,
} from "Common/Server/Utils/CloudConnection/CloudStreamReader";
import { withoutStreamedMetrics } from "Common/Server/Utils/CloudConnection/CloudStreamedMetrics";
import {
  CollectorMessagingQueues,
  withoutCollectorQueues,
} from "Common/Server/Utils/CloudConnection/CloudCollectorQueues";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
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
 * A Service Bus or Event Hubs namespace read two ways is summed once
 * (#6409), against a real ClickHouse server.
 *
 * Since #6456 a namespace's totals add up every series that carries its
 * resource id (CloudResourceMetricAggregation): its Metrics tab's rows, a
 * metric monitor of it, any reader that sums its series. A namespace can be
 * read two ways at once - by a collector's azure_monitor receiver or the
 * connection's read, and by a stream (diagnostic settings, whose metrics
 * Azure exports as one total per namespace) - and one queue's messages must
 * be added once. So every way writes what it writes through its REAL path,
 * into a table built from the REAL Metric model:
 *
 *   - the receiver's OTLP, through the REAL metrics ingest;
 *   - the stream's events, decoded by the REAL decoder
 *     (AzureDiagnosticRecords), through the same ingest;
 *   - the connection's read, through the read's REAL filters - what a
 *     stream writes in its place (withoutStreamedMetrics), what a
 *     collector delivered, looked up in these very rows
 *     (findCollectorMessagingQueues), and what is left to write
 *     (withoutCollectorQueues) - and the same ingest;
 *
 * and the totals are read back as the product reads them: the Metrics
 * tab's list (the REAL sparkline fetcher with the REAL scope helpers, every
 * request sent across the wire to the REAL MetricService), a metric
 * monitor (the REAL monitor reader), and a plain MetricService sum.
 *
 *   shop     a receiver splits orders and invoices; the read the rest; a
 *            stream sends the namespace's totals
 *   billing  a receiver sends the namespace's totals, split by no queue;
 *            the read splits it by queue
 *   ledger   the read, and a stream of its totals
 *   clicks   an Event Hubs namespace: the read, and a stream
 *   web-01   a virtual machine: a stream of its CPU, and the read of its
 *            network, which a diagnostic setting cannot export
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18125:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18125 \
 *     npx jest Tests/Workers/Jobs/Cloud/CloudNamespaceSummedOnceClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
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

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn(), getQueue: jest.fn() },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

// The monitor's module loads the native isolated-vm addon.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

/*
 * The dashboard's config reads a browser's injected env first; under Node
 * there is no `window`, and it reads the process's.
 */
jest.mock("Common/UI/Config", () => {
  (globalThis as { window?: unknown }).window = undefined;
  return jest.requireActual("Common/UI/Config");
});

// The dashboard's API client, answered by the real MetricService.
let mockAnswer: ((request: unknown) => Promise<unknown>) | null = null;

jest.mock("Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (request: unknown): Promise<unknown> => {
        if (!mockAnswer) {
          throw new Error("No backend picked for the aggregate request");
        }
        return mockAnswer(request);
      },
    },
  };
});

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import CloudConnectionPullRunner from "Common/Server/Utils/CloudConnection/CloudConnectionPullRunner";
import { findCollectorMessagingQueues } from "Common/Server/Utils/CloudConnection/CloudCollectorQueuesReader";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import ProjectUtil from "Common/UI/Utils/Project";
import OtelIngestBaseService from "../../../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import OtelMetricsIngestService from "../../../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService from "../../../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import ExceptionUtil from "../../../../FeatureSet/Telemetry/Utils/Exception";
import {
  AzureDiagnosticDecoded,
  decodeAzureDiagnosticEvents,
} from "../../../../FeatureSet/Telemetry/Utils/AzureEventHubs/AzureDiagnosticRecords";
import MetricUtil from "../../../../FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics";
import {
  CloudMonitoredResourceRowAggregation,
  getCloudMonitoredResourceAttributeFilters,
  getCloudMonitoredResourceRowAggregation,
} from "../../../../FeatureSet/Dashboard/src/Pages/Cloud/Utils/CloudMonitoredResourceScope";
import { monitorMetric } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `cloud_namespace_summed_once_test_${process.pid}_${Date.now()}`;

const MINUTE_MS: number = 60 * 1000;
// The newest stored minute: a whole minute before now, so it is complete.
const NEWEST_MINUTE_MS: number =
  Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS - MINUTE_MS;
const STORED_MINUTES: number = 20;
const NOW: Date = new Date(NEWEST_MINUTE_MS + 2 * MINUTE_MS);

const PROJECT_ID: ObjectID = ObjectID.generate();
const SUBSCRIPTION: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";
const CONNECTION_ID: string = "5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
const REGION: string = "westeurope";

const SERVICE_BUS: string = "Microsoft.ServiceBus/namespaces";
const EVENT_HUBS: string = "Microsoft.EventHub/namespaces";
const VIRTUAL_MACHINE: string = "Microsoft.Compute/virtualMachines";

const INCOMING: string = "azure_incomingmessages_total";
const WAITING: string = "azure_activemessages_average";
const CPU: string = "azure_percentage_cpu_average";
const NETWORK_IN: string = "azure_network_in_total_total";

function armId(type: string, name: string): string {
  return `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/${type}/${name}`;
}

// A resource's row in Cloud > All Resources, as the connection records it.
function cloudResource(type: string, name: string): JSONObject {
  return {
    cloudResourceKind: CloudResourceKind.Resource,
    cloudProvider: CloudProvider.Azure,
    cloudResourceType: type,
    telemetryAttributes: { "azuremonitor.resource_id": armId(type, name) },
  };
}

/*
 * Each namespace's queues, every minute: 6 messages in, 60 waiting -
 * orders 1 and 10, invoices 2 and 20, payments 3 and 30.
 */
const QUEUES: Array<{ entity: string; incoming: number; waiting: number }> = [
  { entity: "orders", incoming: 1, waiting: 10 },
  { entity: "invoices", incoming: 2, waiting: 20 },
  { entity: "payments", incoming: 3, waiting: 30 },
];
const NAMESPACE_INCOMING: number = 6;
const NAMESPACE_WAITING: number = 60;

function minutes(): Array<number> {
  const times: Array<number> = [];

  for (let minute: number = 0; minute < STORED_MINUTES; minute++) {
    times.push(NEWEST_MINUTE_MS - minute * MINUTE_MS);
  }

  return times;
}

type DatapointSet =
  CloudMetricGroup["metrics"][number]["datapointSets"][number];

// A namespace's datapoint, as the azure_monitor receiver and the read write it.
function namespaceSet(data: {
  type: string;
  namespace: string;
  entity: string | null;
  value: number;
}): DatapointSet {
  const attributes: Array<OtlpAttribute> = [
    stringAttribute(
      "azuremonitor.resource_id",
      armId(data.type, data.namespace),
    ),
    stringAttribute("name", data.namespace),
    stringAttribute("type", data.type),
    stringAttribute("resource_group", "rg-prod"),
    stringAttribute("location", REGION),
    stringAttribute("timegrain", "PT1M"),
  ];

  if (data.entity !== null) {
    attributes.push(stringAttribute("metadata_entityname", data.entity));
  }

  return {
    attributes,
    points: minutes().map((timeMs: number) => {
      // Ten seconds into each minute, as Azure stamps a grain's start.
      return { timeMs: timeMs + 10000, value: data.value };
    }),
  };
}

// The collector's receiver: no connection's id, its own service.
function receiverPayload(metrics: CloudMetricGroup["metrics"]): JSONObject {
  return buildMetricsPayloads([
    {
      resourceAttributes: [
        stringAttribute("service.name", "otel-collector"),
        stringAttribute("azuremonitor.subscription_id", SUBSCRIPTION),
      ],
      metrics,
    },
  ])[0]!;
}

function readPayload(metrics: CloudMetricGroup["metrics"]): JSONObject {
  return buildMetricsPayloads([
    {
      resourceAttributes: [
        ...connectionResourceAttributes({
          serviceName: "Production Azure",
          connectionId: CONNECTION_ID,
          cloudProvider: CloudProvider.Azure,
        }),
        stringAttribute("azuremonitor.subscription_id", SUBSCRIPTION),
      ],
      metrics,
    },
  ])[0]!;
}

// Each queue's series of one namespace, as the read splits it.
function splitSets(data: {
  type: string;
  namespace: string;
  metric: "incoming" | "waiting";
  only?: Array<string>;
}): Array<DatapointSet> {
  return QUEUES.filter((queue: { entity: string }): boolean => {
    return !data.only || data.only.includes(queue.entity);
  }).map((queue: { entity: string; incoming: number; waiting: number }) => {
    return namespaceSet({
      type: data.type,
      namespace: data.namespace,
      entity: queue.entity,
      value: data.metric === "incoming" ? queue.incoming : queue.waiting,
    });
  });
}

// What the collector's receiver sends: shop split by queue, billing's totals.
const RECEIVER: JSONObject = receiverPayload([
  {
    name: INCOMING,
    unit: "Count",
    datapointSets: [
      ...splitSets({
        type: SERVICE_BUS,
        namespace: "shop",
        metric: "incoming",
        only: ["orders", "invoices"],
      }),
      namespaceSet({
        type: SERVICE_BUS,
        namespace: "billing",
        entity: null,
        value: NAMESPACE_INCOMING,
      }),
    ],
  },
  {
    name: WAITING,
    unit: "Count",
    datapointSets: [
      ...splitSets({
        type: SERVICE_BUS,
        namespace: "shop",
        metric: "waiting",
        only: ["orders", "invoices"],
      }),
      namespaceSet({
        type: SERVICE_BUS,
        namespace: "billing",
        entity: null,
        value: NAMESPACE_WAITING,
      }),
    ],
  },
]);

// What the connection's read reads: every queue of every namespace, and the VM.
const READ: JSONObject = readPayload([
  {
    name: INCOMING,
    unit: "Count",
    datapointSets: [
      ...["shop", "billing", "ledger"].flatMap((namespace: string) => {
        return splitSets({ type: SERVICE_BUS, namespace, metric: "incoming" });
      }),
      ...splitSets({
        type: EVENT_HUBS,
        namespace: "clicks",
        metric: "incoming",
      }),
    ],
  },
  {
    name: WAITING,
    unit: "Count",
    datapointSets: ["shop", "billing", "ledger"].flatMap(
      (namespace: string) => {
        return splitSets({ type: SERVICE_BUS, namespace, metric: "waiting" });
      },
    ),
  },
  {
    name: CPU,
    unit: "Percent",
    datapointSets: [
      {
        ...namespaceSet({
          type: VIRTUAL_MACHINE,
          namespace: "web-01",
          entity: null,
          value: 40,
        }),
      },
    ],
  },
  {
    name: NETWORK_IN,
    unit: "Bytes",
    datapointSets: [
      namespaceSet({
        type: VIRTUAL_MACHINE,
        namespace: "web-01",
        entity: null,
        value: 4096,
      }),
    ],
  },
]);

function streamResource(type: string, name: string): AzureStreamResource {
  return {
    resourceId: armId(type, name),
    providerResourceId: armId(type, name),
    name,
    type,
    resourceGroup: "rg-prod",
    region: REGION,
    subscriptionId: SUBSCRIPTION,
  };
}

function definitionsOf(
  metrics: Array<AzureStreamMetricDefinition>,
): Map<string, AzureStreamMetricDefinition> {
  return new Map(
    metrics.map(
      (
        metric: AzureStreamMetricDefinition,
      ): [string, AzureStreamMetricDefinition] => {
        return [metric.name.toLowerCase(), metric];
      },
    ),
  );
}

const MESSAGES: Array<AzureStreamMetricDefinition> = [
  {
    name: "IncomingMessages",
    aggregation: "Total",
    unit: "Count",
    grain: "PT1M",
  },
  {
    name: "ActiveMessages",
    aggregation: "Average",
    unit: "Count",
    grain: "PT1M",
  },
];

// What the stream decodes against: the resources and definitions the reads keep.
const STREAM_CONTEXT: AzureStreamContext = {
  projectId: PROJECT_ID,
  connectionId: new ObjectID(CONNECTION_ID),
  serviceName: "Production Azure",
  resources: new Map(
    [
      streamResource(SERVICE_BUS, "shop"),
      streamResource(SERVICE_BUS, "billing"),
      streamResource(SERVICE_BUS, "ledger"),
      streamResource(EVENT_HUBS, "clicks"),
      streamResource(VIRTUAL_MACHINE, "web-01"),
    ].map((resource: AzureStreamResource): [string, AzureStreamResource] => {
      return [resource.resourceId.toLowerCase(), resource];
    }),
  ),
  definitions: new Map([
    [SERVICE_BUS.toLowerCase(), definitionsOf(MESSAGES)],
    [EVENT_HUBS.toLowerCase(), definitionsOf(MESSAGES.slice(0, 1))],
    [
      VIRTUAL_MACHINE.toLowerCase(),
      definitionsOf([
        {
          name: "Percentage CPU",
          aggregation: "Average",
          unit: "Percent",
          grain: "PT1M",
        },
        {
          name: "Network In Total",
          aggregation: "Total",
          unit: "Bytes",
          grain: "PT1M",
        },
      ]),
    ],
  ]),
};

// A minute of a platform metric, as an AllMetrics diagnostic setting sends it.
function diagnosticRecord(data: {
  type: string;
  name: string;
  metricName: string;
  value: number;
  timeMs: number;
}): JSONObject {
  return {
    count: 1,
    total: data.value,
    minimum: data.value,
    maximum: data.value,
    average: data.value,
    resourceId: armId(data.type, data.name).toUpperCase(),
    time: new Date(data.timeMs).toISOString(),
    metricName: data.metricName,
    timeGrain: "PT1M",
  };
}

// The stream's events: each namespace's totals, the VM's CPU and network.
function streamRecords(): Array<JSONObject> {
  const records: Array<JSONObject> = [];

  for (const timeMs of minutes()) {
    for (const [type, name] of [
      [SERVICE_BUS, "shop"],
      [SERVICE_BUS, "billing"],
      [SERVICE_BUS, "ledger"],
      [EVENT_HUBS, "clicks"],
    ] as Array<[string, string]>) {
      records.push(
        diagnosticRecord({
          type,
          name,
          metricName: "IncomingMessages",
          value: NAMESPACE_INCOMING,
          timeMs,
        }),
      );
    }

    records.push(
      diagnosticRecord({
        type: VIRTUAL_MACHINE,
        name: "web-01",
        metricName: "Percentage CPU",
        value: 42,
        timeMs,
      }),
      // Not exported by a diagnostic setting; should Azure send it, it is the read's.
      diagnosticRecord({
        type: VIRTUAL_MACHINE,
        name: "web-01",
        metricName: "Network In Total",
        value: 4096,
        timeMs,
      }),
    );
  }

  return records;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

let ingested: Array<JSONObject> = [];

// The real metrics ingest, with discovery, service resolution and rule loads replaced.
function stubIngestLookups(): void {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const service: Record<string, any> =
    OtelMetricsIngestService as unknown as Record<string, any>;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  for (const method of Object.getOwnPropertyNames(OtelIngestBaseService)) {
    if (
      method.startsWith("autoDiscover") &&
      typeof baseService[method] === "function"
    ) {
      jest.spyOn(service, method).mockResolvedValue(null as never);
    }
  }

  jest
    .spyOn(service, "resolveTelemetryResource")
    .mockImplementation((async (): Promise<TelemetryServiceMetadata> => {
      return {
        serviceName: "Production Azure",
        primaryEntityId: ObjectID.generate(),
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 15,
        serviceRetentionConfig: null,
        serviceRetentionInDays: null,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      } as unknown as TelemetryServiceMetadata;
    }) as never);
  jest
    .spyOn(service, "runBatchHostEnrichment")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(MetricPipelineRuleService, "loadRules")
    .mockResolvedValue({ projectRules: [], rulesByServiceId: new Map() });
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined as never);
  jest.spyOn(TelemetryFanInWriter, "submit").mockImplementation((async (
    target: FanInInsertTarget,
    batch: Array<JSONObject>,
  ) => {
    if ((target as unknown) === MetricService) {
      ingested.push(...batch);
    }
    return { flushed: Promise.resolve() };
  }) as never);
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
): Promise<void> {
  const model: AnalyticsBaseModel = new Metric();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: Metric as unknown as { new (): AnalyticsBaseModel },
      database: clickhouse,
    });

  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = ${model.tableEngine} PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

// A request as the wire carries it: serialized, sent, deserialized.
function overTheWire<T>(value: T): T {
  return JSONFunctions.deserialize(
    JSON.parse(
      JSON.stringify(JSONFunctions.serialize(value as unknown as JSONObject)),
    ) as JSONObject,
  ) as unknown as T;
}

async function answerFromClickhouse(request: unknown): Promise<unknown> {
  const sent: { aggregateBy: JSONObject } = request as {
    aggregateBy: JSONObject;
  };
  const aggregateBy: JSONObject = overTheWire(sent.aggregateBy);
  const result: AggregatedResult = await MetricService.aggregateBy({
    ...(aggregateBy as unknown as Parameters<
      typeof MetricService.aggregateBy
    >[0]),
    props: { isRoot: true },
  });
  return overTheWire({ ...result } as unknown as JSONObject);
}

interface Interval {
  startMs: number;
  value: number;
}

function intervalsOf(result: AggregatedResult | undefined): Array<Interval> {
  return (result?.data || [])
    .map((row: AggregatedModel): Interval => {
      return {
        startMs: new Date(row.timestamp).getTime(),
        value: Number(row.value),
      };
    })
    .sort((a: Interval, b: Interval): number => {
      return a.startMs - b.startMs;
    });
}

// Each interval's value, the same in every one of them.
function valuesOf(intervals: Array<Interval>): Array<number> {
  return Array.from(
    new Set(
      intervals.map((interval: Interval): number => {
        return interval.value;
      }),
    ),
  );
}

integration(
  "A namespace read two ways, summed once, against ClickHouse",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    let original:
      | {
          database: ClickhouseDatabase;
          databaseClient: ClickhouseClient | null;
          ingestDatabase: ClickhouseDatabase;
          ingestDatabaseClient: ClickhouseClient | null;
        }
      | undefined;
    let decoded: AzureDiagnosticDecoded;
    let collector: CollectorMessagingQueues;
    const leftToStreams: Dictionary<number> = {};

    async function ingestAndStore(
      resourceMetrics: Array<JSONObject>,
    ): Promise<void> {
      ingested = [];

      await OtelMetricsIngestService.processMetricsFromQueue({
        projectId: PROJECT_ID,
        body: { resourceMetrics },
        headers: {},
      } as unknown as TelemetryRequest);

      if (ingested.length > 0) {
        await client.insert({
          table: `${database}.${new Metric().tableName}`,
          values: ingested,
          format: "JSONEachRow",
        });
      }
    }

    beforeAll(async (): Promise<void> => {
      const url: URL = new URL(endpoint!);

      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error(
          "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
        );
      }

      // Connecting creates the database.
      const options: ClickHouseClientConfigOptions = {
        url: `${url.protocol}//${url.host}`,
        username: decodeURIComponent(url.username) || "default",
        password: decodeURIComponent(url.password),
        database: database,
        request_timeout: 60000,
      };

      clickhouse = new ClickhouseDatabase(options);
      client = await clickhouse.connect(options);

      await createTable(client, clickhouse);

      original = {
        database: MetricService.database,
        databaseClient: MetricService.databaseClient,
        ingestDatabase: MetricService.ingestDatabase,
        ingestDatabaseClient: MetricService.ingestDatabaseClient,
      };
      MetricService.database = clickhouse;
      MetricService.databaseClient = client;
      MetricService.ingestDatabase = clickhouse;
      MetricService.ingestDatabaseClient = client;

      stubIngestLookups();
      mockAnswer = answerFromClickhouse;
      jest
        .spyOn(ProjectUtil, "getCurrentProjectId")
        .mockReturnValue(PROJECT_ID);
      // The monitor converts units from the catalog: these metrics have none.
      jest
        .spyOn(MetricTypeService, "findBy")
        .mockImplementation(async (): Promise<Array<MetricType>> => {
          return [];
        });

      // 1. The collector's receiver.
      await ingestAndStore(RECEIVER["resourceMetrics"] as Array<JSONObject>);

      // 2. The stream: the decoder writes what a stream may.
      decoded = decodeAzureDiagnosticEvents({
        records: [
          {
            offset: 0,
            timestampMs: NEWEST_MINUTE_MS,
            value: Buffer.from(
              JSON.stringify({ records: streamRecords() }),
              "utf8",
            ),
          },
        ],
        context: STREAM_CONTEXT,
        namespaceRegion: REGION,
        observedAtMs: NOW.getTime(),
      });
      await ingestAndStore(
        decoded.resourceMetrics.map((delivered: { resource: JSONObject }) => {
          return delivered.resource;
        }),
      );

      /*
       * 3. The connection's read, as CloudConnectionPullRunner writes it:
       * what the stream delivered lately - its sightings, and an older one
       * of the namespaces' types, as a stream sighted them before #6409 -
       * then the collector's queues, looked up in what is stored.
       */
      const sightings: Array<CloudStreamSighting> = [
        ...decoded.sightings,
        {
          accountId: SUBSCRIPTION,
          region: REGION,
          namespaces: [SERVICE_BUS, EVENT_HUBS],
        },
      ];
      const summary: CloudStreamSummary = {
        metricSources: sightings
          .filter((sighting: CloudStreamSighting): boolean => {
            return Boolean(
              sighting.namespaces && sighting.namespaces.length > 0,
            );
          })
          .map((sighting: CloudStreamSighting) => {
            return {
              accountId: sighting.accountId,
              region: sighting.region,
              namespaces: sighting.namespaces!,
              lastAt: NOW.toISOString(),
            };
          }),
        logSources: [],
      };
      const streamedKeys: Set<string> = getStreamedMetricKeys({
        summary,
        now: NOW,
      });

      collector = (
        await CloudConnectionPullRunner.findCollectorQueues({
          projectId: PROJECT_ID,
          payloads: [READ],
          now: NOW,
          find: findCollectorMessagingQueues,
        })
      ).queues;

      const toWrite: { payload: JSONObject | null; leftOut: number } =
        withoutStreamedMetrics({ payload: READ, streamedKeys });
      leftToStreams["read"] = toWrite.leftOut;

      const ownToWrite: { payload: JSONObject | null } = withoutCollectorQueues(
        {
          payload: toWrite.payload!,
          collector,
        },
      );

      await ingestAndStore(
        ownToWrite.payload!["resourceMetrics"] as Array<JSONObject>,
      );
    });

    afterAll(async (): Promise<void> => {
      mockAnswer = null;
      jest.restoreAllMocks();

      if (original) {
        MetricService.database = original.database;
        MetricService.databaseClient = original.databaseClient;
        MetricService.ingestDatabase = original.ingestDatabase;
        MetricService.ingestDatabaseClient = original.ingestDatabaseClient;
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
        await client.close();
      }
    });

    // A plain sum of a resource's series, per minute, over the stored minutes.
    async function summedPerMinute(data: {
      name: string;
      attributes: Dictionary<string>;
    }): Promise<Array<Interval>> {
      const since: Date = new Date(
        NEWEST_MINUTE_MS - (STORED_MINUTES - 1) * MINUTE_MS,
      );
      const until: Date = new Date(NEWEST_MINUTE_MS + MINUTE_MS - 1);

      return intervalsOf(
        await MetricService.aggregateBy({
          query: {
            projectId: PROJECT_ID,
            name: data.name,
            time: new InBetween<Date>(since, until),
            attributes: data.attributes,
          } as never,
          aggregationType: AggregationType.Sum,
          aggregateColumnName: "value",
          aggregationTimestampColumnName: "time",
          aggregationInterval: AggregationInterval.Minute,
          startTimestamp: since,
          endTimestamp: until,
          limit: 1000,
          skip: 0,
          props: { isRoot: true },
        }),
      );
    }

    function namespaceFilter(type: string, name: string): Dictionary<string> {
      return getCloudMonitoredResourceAttributeFilters(
        cloudResource(type, name),
      ) as Dictionary<string>;
    }

    test("the stream wrote only what a diagnostic setting exports of a type the read leaves to it", () => {
      expect(decoded.datapoints).toBe(STORED_MINUTES);
      // Four namespaces' totals and the VM's network, every minute: the read's.
      expect(decoded.leftToRead).toBe(5 * STORED_MINUTES);
      expect(
        decoded.sightings.map((sighting: CloudStreamSighting) => {
          return sighting.namespaces;
        }),
      ).toEqual([[VIRTUAL_MACHINE]]);
      // The read left the stream the VM's CPU, and nothing of a namespace.
      expect(leftToStreams["read"]).toBe(STORED_MINUTES);
    });

    test("the read found what the collector sends: shop's two queues, and billing's totals", () => {
      expect(collector.series.size).toBe(4);
      expect(collector.wholeNamespaces.size).toBe(0);
      expect(collector.namespaceTotals.size).toBe(2);
    });

    for (const [type, namespace] of [
      [SERVICE_BUS, "shop"],
      [SERVICE_BUS, "billing"],
      [SERVICE_BUS, "ledger"],
    ] as Array<[string, string]>) {
      test(`${namespace}: every minute's sum is the namespace's messages in and waiting, each queue's once`, async () => {
        const incoming: Array<Interval> = await summedPerMinute({
          name: INCOMING,
          attributes: namespaceFilter(type, namespace),
        });
        const waiting: Array<Interval> = await summedPerMinute({
          name: WAITING,
          attributes: namespaceFilter(type, namespace),
        });

        expect(incoming).toHaveLength(STORED_MINUTES);
        expect(valuesOf(incoming)).toEqual([NAMESPACE_INCOMING]);
        expect(waiting).toHaveLength(STORED_MINUTES);
        expect(valuesOf(waiting)).toEqual([NAMESPACE_WAITING]);
      });
    }

    test("clicks, an Event Hubs namespace: its messages in, each event hub's once", async () => {
      const incoming: Array<Interval> = await summedPerMinute({
        name: INCOMING,
        attributes: namespaceFilter(EVENT_HUBS, "clicks"),
      });

      expect(incoming).toHaveLength(STORED_MINUTES);
      expect(valuesOf(incoming)).toEqual([NAMESPACE_INCOMING]);
    });

    test("each queue's own series is stored once, whoever wrote it, and still files on its queue", async () => {
      for (const namespace of ["shop", "billing", "ledger"]) {
        for (const queue of QUEUES) {
          const incoming: Array<Interval> = await summedPerMinute({
            name: INCOMING,
            attributes: {
              name: namespace,
              metadata_entityname: queue.entity,
            },
          });

          expect({
            namespace,
            queue: queue.entity,
            values: valuesOf(incoming),
          }).toEqual({
            namespace,
            queue: queue.entity,
            values: [queue.incoming],
          });
          expect(incoming).toHaveLength(STORED_MINUTES);
        }
      }
    });

    test("a virtual machine's CPU is the stream's one series, and its network the read's", async () => {
      const vm: Dictionary<string> = namespaceFilter(VIRTUAL_MACHINE, "web-01");
      const cpu: Array<Interval> = await summedPerMinute({
        name: CPU,
        attributes: vm,
      });
      const network: Array<Interval> = await summedPerMinute({
        name: NETWORK_IN,
        attributes: vm,
      });

      // 42, the stream's: the read's 40 was left to it, never added beside it.
      expect(cpu).toHaveLength(STORED_MINUTES);
      expect(valuesOf(cpu)).toEqual([42]);
      // A diagnostic setting cannot export it: the read keeps writing it, once.
      expect(network).toHaveLength(STORED_MINUTES);
      expect(valuesOf(network)).toEqual([4096]);
    });

    /*
     * What the Metrics tab's list reads for a namespace over the past hour:
     * the real sparkline fetcher, scoped by its attribute filter, each row
     * read with the aggregation the scope helper names for it.
     */
    test("the namespaces' Metrics tabs read each total once", async () => {
      const window: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate({
          range: TimeRange.PAST_ONE_HOUR,
        });

      for (const [type, namespace] of [
        [SERVICE_BUS, "shop"],
        [SERVICE_BUS, "billing"],
        [SERVICE_BUS, "ledger"],
      ] as Array<[string, string]>) {
        const resource: JSONObject = cloudResource(type, namespace);
        const rows: CloudMonitoredResourceRowAggregation | undefined =
          getCloudMonitoredResourceRowAggregation(resource);
        const aggregations: Dictionary<MetricsAggregationType> = {
          [INCOMING]: rows!.getRowAggregation(INCOMING, window)!
            .aggregationType,
          [WAITING]: rows!.getRowAggregation(WAITING, window)!.aggregationType,
        };

        expect(aggregations).toEqual({
          [INCOMING]: MetricsAggregationType.Sum,
          [WAITING]: MetricsAggregationType.Sum,
        });

        const results: Map<string, AggregatedResult> =
          await MetricUtil.fetchSparklineAggregates({
            metricNames: [INCOMING, WAITING],
            attributes: getCloudMonitoredResourceAttributeFilters(resource),
            startAndEndDate: window,
            getAggregationType: (name: string): MetricsAggregationType => {
              return aggregations[name]!;
            },
          });

        const incoming: Array<Interval> = intervalsOf(results.get(INCOMING));
        const waiting: Array<Interval> = intervalsOf(results.get(WAITING));

        expect({
          namespace,
          minutes: incoming.length >= STORED_MINUTES - 1,
        }).toEqual({ namespace, minutes: true });
        expect({ namespace, values: valuesOf(incoming) }).toEqual({
          namespace,
          values: [NAMESPACE_INCOMING],
        });
        expect({ namespace, values: valuesOf(waiting) }).toEqual({
          namespace,
          values: [NAMESPACE_WAITING],
        });
      }
    });

    /*
     * A monitor of a namespace carries the row's query: its metric, the
     * namespace's filter and the row's aggregation. The worker reads it per
     * minute over its window.
     */
    test("a metric monitor of each namespace reads its total once, every minute of its window", async () => {
      for (const namespace of ["shop", "billing", "ledger"]) {
        for (const [metricName, expected] of [
          [INCOMING, NAMESPACE_INCOMING],
          [WAITING, NAMESPACE_WAITING],
        ] as Array<[string, number]>) {
          const view: MetricsViewConfig = {
            queryConfigs: [
              {
                metricAliasData: {
                  metricVariable: "a",
                  title: undefined,
                  description: undefined,
                  legend: undefined,
                  legendUnit: undefined,
                },
                metricQueryData: {
                  filterData: {
                    metricName,
                    attributes: getCloudMonitoredResourceAttributeFilters(
                      cloudResource(SERVICE_BUS, namespace),
                    ),
                    aggegationType: MetricsAggregationType.Sum,
                    aggregateBy: {},
                  },
                },
              },
            ],
            formulaConfigs: [],
          };

          const response: MetricMonitorResponse = await monitorMetric({
            monitorStep: new MonitorStep().setMetricMonitor({
              ...MonitorStepMetricMonitorUtil.getDefault(),
              metricViewConfig: view,
              rollingTime: RollingTime.Past15Minutes,
            }),
            monitorId: ObjectID.generate(),
            projectId: PROJECT_ID,
          });
          const intervals: Array<Interval> = intervalsOf(
            response.metricResult[0],
          );

          expect(intervals.length).toBeGreaterThanOrEqual(10);
          expect({
            namespace,
            metricName,
            values: valuesOf(intervals),
          }).toEqual({
            namespace,
            metricName,
            values: [expected],
          });
        }
      }
    });
  },
);

describe("The namespace read two ways' ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
