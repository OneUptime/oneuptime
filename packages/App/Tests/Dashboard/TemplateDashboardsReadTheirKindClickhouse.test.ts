/*
 * Nothing here reaches a queue or hashes a password; both modules pull in
 * what a node test cannot load (BullMQ's ESM, a TS5.9 diagnostic).
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
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
          throw new Error("No backend for the aggregate request");
        }
        return mockAnswer(request);
      },
    },
  };
});

import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "Common/Types/Dashboard/DashboardTemplates";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import DashboardVariableInterpolation from "Common/Utils/Dashboard/VariableInterpolation";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "Common/Models/AnalyticsModels/Metric";
import Log from "Common/Models/AnalyticsModels/Log";
import MetricItemAggMV1m from "Common/Models/AnalyticsModels/MetricItemAggMV1m";
import MetricItemAggMV1mByHostV2 from "Common/Models/AnalyticsModels/MetricItemAggMV1mByHostV2";
import MetricItemAggMV1mByK8sCluster from "Common/Models/AnalyticsModels/MetricItemAggMV1mByK8sCluster";
import MetricItemAggMV1mByContainer from "Common/Models/AnalyticsModels/MetricItemAggMV1mByContainer";
import MetricItemAggMV1mByService from "Common/Models/AnalyticsModels/MetricItemAggMV1mByService";
import Host from "Common/Models/DatabaseModels/Host";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import MetricService from "Common/Server/Services/MetricService";
import LogService from "Common/Server/Services/LogService";
import TelemetryAttributeService, {
  TelemetryAttributeService as TelemetryAttributeServiceClass,
} from "Common/Server/Services/TelemetryAttributeService";
import HostService from "Common/Server/Services/HostService";
import LabelService from "Common/Server/Services/LabelService";
import DockerResourceService from "Common/Server/Services/DockerResourceService";
import { HEARTBEAT_ROW_PRESENT } from "Common/Server/Utils/Telemetry/ResourceHeartbeat";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import ProjectUtil from "Common/UI/Utils/Project";
import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import MetricUtil from "../../FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics";
import {
  RecordedBlock,
  RecordingName,
  getRecordedBlock,
  retimeRecordedBlock,
} from "../Fixtures/HostResourceRecordings";
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
 * EACH TEMPLATE DASHBOARD READS ITS OWN KIND OF RESOURCE, ON A REAL
 * CLICKHOUSE (issues #11258, #11257).
 *
 * Until a value was picked in a template's variable, every widget read the
 * whole project: a Docker Swarm board with no swarm drew the Docker Agent's
 * containers and every log, Kubernetes' Cluster Logs showed Docker's logs,
 * and the Hosts tiles averaged in Kubernetes nodes' system.* metrics.
 *
 * Here a project holds a bit of everything, built by the REAL metrics and
 * logs ingest from what real agents send (Fixtures/HostResourceRecordings:
 * the Docker Agent; the Kubernetes agent's nodes, pods, deployment, cost
 * engine and logs; two apps in pods exporting straight to OneUptime; a
 * host's own collector), plus, for the kinds no recording here holds, a
 * block of each under the resource its agent stamps: the Swarm agent's is
 * the Docker recording as agents/DockerSwarmAgent's resource processor
 * rewrites it, and Proxmox, VMware, XCP-ng, OpenStack, Ceph and a storage
 * array each send a point of every metric their template charts and a log
 * line. The ingest's rows go into tables built from the real models, the
 * minute rollups and their materialized views included.
 *
 * Every widget of every template is then read with the template's own
 * variables, interpolated as the board does it - at "All" and with a pick:
 * each metric query and the log stream as listings, to say whose rows they
 * read, and the tiles through the dashboard's own fetch (MetricUtil), sent
 * across the wire to the real MetricService. A second project holds the
 * Docker Agent alone, the issue's own reproduction.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Dashboard/TemplateDashboardsReadTheirKindClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `template_kinds_${process.pid}_${Date.now()}`;

// Every recorded point lands on one whole minute inside the window read.
const NOW: Date = new Date(Math.floor(Date.now() / 60000) * 60000 - 5 * 60000);
const WINDOW: InBetween<Date> = new InBetween<Date>(
  OneUptimeDate.addRemoveHours(NOW, -1),
  OneUptimeDate.addRemoveMinutes(NOW, 30),
);

// A project with a bit of everything, and one with the Docker Agent alone.
const MIXED_PROJECT: ObjectID = ObjectID.generate();
const DOCKER_ONLY_PROJECT: ObjectID = ObjectID.generate();

const SERVICE_ID: ObjectID = ObjectID.generate();

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
const metricsService: Record<string, any> =
  OtelMetricsIngestService as unknown as Record<string, any>;
const logsService: Record<string, any> =
  OtelLogsIngestService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

// Every discovery but the Host's, which runs (its Postgres row stood in for).
const OTHER_DISCOVERIES: Array<string> = [
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverKubernetesCluster",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverOpenStackCloud",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverStorageArray",
  "autoDiscoverXcpNgPool",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverIoTFleet",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

function recorded(name: RecordingName, key: string): RecordedBlock {
  return retimeRecordedBlock(getRecordedBlock(name, key), NOW);
}

function stringAttributes(values: Record<string, string>): Array<JSONObject> {
  return Object.entries(values).map(([key, value]: [string, string]) => {
    return { key, value: { stringValue: value } };
  });
}

function resourceAttributesOf(block: RecordedBlock): Array<JSONObject> {
  return ((block.block["resource"] as JSONObject)["attributes"] ||
    []) as Array<JSONObject>;
}

/*
 * The Docker recording as the Swarm agent sends it: the same docker_stats
 * receiver (container.runtime=docker on every container) with its resource
 * processor's docker.swarm.cluster.name and node, and neither
 * resourcedetection nor host.name (agents/DockerSwarmAgent).
 */
function asSwarmAgentSends(block: RecordedBlock): RecordedBlock {
  const copy: RecordedBlock = JSON.parse(JSON.stringify(block));
  const kept: Array<JSONObject> = resourceAttributesOf(copy).filter(
    (attribute: JSONObject) => {
      return !["host.name", "os.type"].includes(attribute["key"] as string);
    },
  );
  (copy.block["resource"] as JSONObject)["attributes"] = [
    ...kept,
    ...stringAttributes({
      "docker.swarm.cluster.name": "prod-swarm",
      "docker.swarm.node.name": "swarm-node-1",
    }),
  ];
  return copy;
}

const METRIC_WIDGETS: ReadonlyArray<string> = [
  DashboardComponentType.Chart,
  DashboardComponentType.Value,
  DashboardComponentType.Gauge,
  DashboardComponentType.Table,
];

function componentQueries(
  component: DashboardBaseComponent,
): Array<MetricQueryConfigData> {
  const args: JSONObject = (component.arguments || {}) as unknown as JSONObject;
  const queries: Array<MetricQueryConfigData> = [];

  if (args["metricQueryConfig"]) {
    queries.push(args["metricQueryConfig"] as unknown as MetricQueryConfigData);
  }

  for (const more of (args["metricQueryConfigs"] || []) as Array<unknown>) {
    queries.push(more as MetricQueryConfigData);
  }

  return queries.filter((query: MetricQueryConfigData) => {
    return Boolean(query?.metricQueryData?.filterData?.metricName);
  });
}

function getTemplateMetricQueries(
  type: DashboardTemplateType,
): Array<MetricQueryConfigData> {
  const config: DashboardViewConfig = getTemplateConfig(type)!;

  return config.components
    .filter((component: DashboardBaseComponent) => {
      return METRIC_WIDGETS.includes(component.componentType);
    })
    .flatMap(componentQueries);
}

function hasLogStream(type: DashboardTemplateType): boolean {
  return getTemplateConfig(type)!.components.some(
    (component: DashboardBaseComponent) => {
      return component.componentType === DashboardComponentType.LogStream;
    },
  );
}

// The metric names a template's widgets chart, their fallbacks' included.
function getTemplateMetricNames(type: DashboardTemplateType): Array<string> {
  const names: Set<string> = new Set<string>();

  for (const query of getTemplateMetricQueries(type)) {
    names.add(query.metricQueryData.filterData.metricName as string);

    const fallbackName: string | undefined = query.fallback?.queryConfig
      ?.metricQueryData?.filterData?.metricName as string | undefined;

    if (fallbackName) {
      names.add(fallbackName);
    }
  }

  return Array.from(names);
}

/*
 * A resource of a kind no recording here holds, under the attributes its
 * agent stamps: a point of each metric its template charts, and a log line.
 */
function kindBlocks(data: {
  template: DashboardTemplateType;
  attributes: Record<string, string>;
}): Array<RecordedBlock> {
  const nanos: string = `${NOW.getTime()}000000`;

  return [
    {
      signal: "resourceMetrics",
      block: {
        resource: { attributes: stringAttributes(data.attributes) },
        scopeMetrics: [
          {
            scope: { name: "template-kinds" },
            metrics: getTemplateMetricNames(data.template).map(
              (name: string): JSONObject => {
                return {
                  name: name,
                  gauge: { dataPoints: [{ timeUnixNano: nanos, asDouble: 1 }] },
                };
              },
            ),
          },
        ],
      },
    },
    {
      signal: "resourceLogs",
      block: {
        resource: { attributes: stringAttributes(data.attributes) },
        scopeLogs: [
          {
            scope: { name: "template-kinds" },
            logRecords: [
              {
                timeUnixNano: nanos,
                severityNumber: 9,
                severityText: "INFO",
                body: { stringValue: `${data.template} reporting` },
              },
            ],
          },
        ],
      },
    },
  ];
}

// db-01's own log line, under the resource its collector stamps.
function hostCollectorLog(): RecordedBlock {
  return {
    signal: "resourceLogs",
    block: {
      resource: {
        attributes: resourceAttributesOf(
          recorded("host-collector", "hostMetrics"),
        ),
      },
      scopeLogs: [
        {
          scope: { name: "journald" },
          logRecords: [
            {
              timeUnixNano: `${NOW.getTime()}000000`,
              severityNumber: 9,
              severityText: "INFO",
              body: { stringValue: "Started PostgreSQL database server." },
            },
          ],
        },
      ],
    },
  };
}

function dockerAgentBlocks(): Array<RecordedBlock> {
  return [
    recorded("docker-agent", "containerMetrics"),
    recorded("docker-agent", "containerLogs"),
  ];
}

const XCP_NG_POOL_ID: string = "3f1c0a52-7d4b-4e1a-9c2f-8b6d5e4a3c21";

function mixedProjectBlocks(): Array<RecordedBlock> {
  return [
    ...dockerAgentBlocks(),
    recorded("kubernetes-agent", "nodeHostMetrics"),
    recorded("kubernetes-agent", "nodeKubeletMetrics"),
    recorded("kubernetes-agent", "podMetrics"),
    recorded("kubernetes-agent", "deploymentMetrics"),
    recorded("kubernetes-agent", "costMetrics"),
    recorded("kubernetes-agent", "podLogs"),
    recorded("direct-otlp-pods", "apiMetrics"),
    recorded("direct-otlp-pods", "apiLogs"),
    recorded("direct-otlp-pods", "workerMetrics"),
    recorded("direct-otlp-pods", "workerLogs"),
    recorded("host-collector", "hostMetrics"),
    recorded("host-collector", "processMetrics"),
    hostCollectorLog(),
    asSwarmAgentSends(recorded("docker-agent", "containerMetrics")),
    asSwarmAgentSends(recorded("docker-agent", "containerLogs")),
    ...kindBlocks({
      template: DashboardTemplateType.Proxmox,
      attributes: { "proxmox.cluster.name": "lab-pve" },
    }),
    ...kindBlocks({
      template: DashboardTemplateType.VMware,
      attributes: {
        "vmware.vcenter.name": "vc-lab",
        "vcenter.datacenter.name": "dc-1",
        "vcenter.host.name": "esx-01",
      },
    }),
    ...kindBlocks({
      template: DashboardTemplateType.XcpNg,
      attributes: { "xcp_ng.pool.id": XCP_NG_POOL_ID, "xcp_ng.pool.name": "Lab" },
    }),
    ...kindBlocks({
      template: DashboardTemplateType.OpenStack,
      attributes: { "openstack.cloud.name": "lab-cloud" },
    }),
    ...kindBlocks({
      template: DashboardTemplateType.Ceph,
      attributes: { "ceph.cluster.name": "lab-ceph" },
    }),
    ...kindBlocks({
      template: DashboardTemplateType.StorageArray,
      attributes: {
        "storage.array.name": "fa-01",
        "storage.system": "purestorage.flasharray",
      },
    }),
  ];
}

/*
 * One project's telemetry through the real metrics and logs ingest,
 * captured where it would be handed to ClickHouse's writer. What reaches
 * Postgres or Redis is stood in for, as in RecordedAgentsRegisterNoHost.
 */
async function ingestRows(data: {
  projectId: ObjectID;
  blocks: Array<RecordedBlock>;
}): Promise<{ metrics: Array<JSONObject>; logs: Array<JSONObject> }> {
  const metricRows: Array<JSONObject> = [];
  const logRows: Array<JSONObject> = [];

  const capture: (
    into: Array<JSONObject>,
  ) => (...args: Array<unknown>) => Promise<void> = (
    into: Array<JSONObject>,
  ) => {
    return (...args: Array<unknown>): Promise<void> => {
      const rows: Array<JSONObject> = (args[0] || []) as Array<JSONObject>;
      into.push(...rows.splice(0, rows.length));
      return Promise.resolve();
    };
  };

  const host: Host = new Host();
  host._id = ObjectID.generate().toString();
  host.projectId = data.projectId;

  for (const service of [metricsService, logsService]) {
    for (const method of OTHER_DISCOVERIES) {
      if (typeof service[method] === "function") {
        jest
          .spyOn(service as never, method as never)
          .mockResolvedValue(null as never);
      }
    }

    jest
      .spyOn(service as never, "resolveTelemetryResource" as never)
      .mockResolvedValue({
        serviceName: "recorded",
        primaryEntityId: SERVICE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 15,
        serviceRetentionConfig: null,
        serviceRetentionInDays: null,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      } as never);
  }

  jest
    .spyOn(baseService, "resolveDiscoveredResourceId")
    .mockImplementation((async () => {
      return ObjectID.generate().toString();
    }) as never);
  jest.spyOn(baseService, "shouldRunMaintenance").mockResolvedValue(false);
  jest.spyOn(HostService, "findOrCreateByHostIdentifier").mockResolvedValue(host);
  jest
    .spyOn(HostService, "updateLastSeen")
    .mockResolvedValue(HEARTBEAT_ROW_PRESENT);
  jest.spyOn(HostService, "attachLabels").mockResolvedValue(undefined);
  jest.spyOn(LabelService, "findOrCreateLabelsByNames").mockResolvedValue([]);
  jest
    .spyOn(metricsService, "submitMetricsBuffer")
    .mockImplementation(capture(metricRows));
  jest
    .spyOn(metricsService, "flushDockerSnapshotBuffer")
    .mockResolvedValue(undefined);
  jest
    .spyOn(MetricPipelineRuleService, "loadRules")
    .mockResolvedValue({ projectRules: [], rulesByServiceId: new Map() });
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(logsService, "submitLogsBuffer")
    .mockImplementation(capture(logRows));
  jest
    .spyOn(logsService, "submitExceptionsBuffer")
    .mockImplementation(capture([]));
  jest.spyOn(LogDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogPipelineService, "loadPipelines")
    .mockResolvedValue([] as never);
  jest
    .spyOn(DockerResourceService, "bulkUpsert")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined);

  const of: (signal: RecordedBlock["signal"]) => Array<JSONObject> = (
    signal: RecordedBlock["signal"],
  ): Array<JSONObject> => {
    return data.blocks
      .filter((block: RecordedBlock) => {
        return block.signal === signal;
      })
      .map((block: RecordedBlock) => {
        return block.block;
      });
  };

  try {
    OtelIngestBaseService.clearInProcessMemos();

    await OtelMetricsIngestService.processMetricsFromQueue({
      projectId: data.projectId,
      body: { resourceMetrics: of("resourceMetrics") },
      headers: {},
    } as unknown as TelemetryRequest as never);

    await OtelLogsIngestService.processLogsFromQueue({
      projectId: data.projectId,
      body: { resourceLogs: of("resourceLogs") },
      headers: {},
    } as unknown as TelemetryRequest as never);
  } finally {
    jest.restoreAllMocks();
    OtelIngestBaseService.clearInProcessMemos();
  }

  return { metrics: metricRows, logs: logRows };
}

async function createTable(data: {
  client: ClickhouseClient;
  clickhouse: ClickhouseDatabase;
  modelType: { new (): AnalyticsBaseModel };
}): Promise<void> {
  const model: AnalyticsBaseModel = new data.modelType();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: data.modelType,
      database: data.clickhouse,
    });

  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  await data.client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = ${model.tableEngine} PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });

  for (const view of model.materializedViews || []) {
    await data.client.command({ query: view.query });
  }
}

// Only the table's columns: what the writer inserts.
function asStored(
  rows: Array<JSONObject>,
  model: AnalyticsBaseModel,
): Array<JSONObject> {
  const columns: Set<string> = new Set<string>(
    model.tableColumns.map((column: { key: string }) => {
      return column.key;
    }),
  );

  return rows.map((row: JSONObject): JSONObject => {
    const stored: JSONObject = {};

    for (const key of Object.keys(row)) {
      if (columns.has(key)) {
        stored[key] = row[key] as JSONObject[string];
      }
    }

    return stored;
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

function templateVariables(
  type: DashboardTemplateType,
  picks?: Record<string, Array<string>>,
): Array<DashboardVariable> {
  return (getTemplateConfig(type)!.variables || []).map(
    (variable: DashboardVariable): DashboardVariable => {
      const picked: Array<string> | undefined = picks?.[variable.name];

      if (!picked) {
        return variable;
      }

      return variable.isMultiSelect
        ? { ...variable, selectedValues: picked }
        : { ...variable, selectedValue: picked[0] };
    },
  );
}

interface ReadRow {
  name: string;
  attributes: Record<string, unknown>;
}

// The rows a metric query reads, its filter as the board sends it.
async function metricRowsRead(data: {
  projectId: ObjectID;
  query: MetricQueryConfigData;
  variables: Array<DashboardVariable>;
}): Promise<Array<ReadRow>> {
  const filterData: JSONObject =
    DashboardVariableInterpolation.applyToQueryConfig(
      data.query,
      data.variables,
    ).metricQueryData.filterData as unknown as JSONObject;
  const attributes: JSONObject | undefined = filterData["attributes"] as
    | JSONObject
    | undefined;

  const rows: Array<Metric> = await MetricService.findBy({
    query: overTheWire({
      projectId: data.projectId,
      name: filterData["metricName"] as string,
      time: WINDOW,
      ...(attributes && Object.keys(attributes).length > 0
        ? { attributes: attributes }
        : {}),
    }) as never,
    select: { name: true, attributes: true },
    limit: LIMIT_MAX,
    skip: 0,
    props: { isRoot: true },
  });

  return rows.map((row: Metric): ReadRow => {
    return {
      name: row.name || "",
      attributes: (row.attributes || {}) as Record<string, unknown>,
    };
  });
}

// The rows the log stream reads, its filter as the widget builds it.
async function logRowsRead(data: {
  projectId: ObjectID;
  variables: Array<DashboardVariable>;
}): Promise<Array<ReadRow>> {
  const attributes: Record<string, unknown> =
    DashboardVariableInterpolation.applyToAttributes(undefined, data.variables);

  const rows: Array<Log> = await LogService.findBy({
    query: overTheWire({
      projectId: data.projectId,
      time: WINDOW,
      ...(Object.keys(attributes).length > 0 ? { attributes: attributes } : {}),
    }) as never,
    select: { body: true, attributes: true },
    limit: LIMIT_MAX,
    skip: 0,
    props: { isRoot: true },
  });

  return rows.map((row: Log): ReadRow => {
    return {
      name: String(row.body || ""),
      attributes: (row.attributes || {}) as Record<string, unknown>,
    };
  });
}

interface TemplateRead {
  metrics: Array<ReadRow>;
  logs: Array<ReadRow>;
}

// Every row a template's widgets read: each metric query's, the log stream's.
async function rowsTemplateReads(data: {
  projectId: ObjectID;
  type: DashboardTemplateType;
  variables: Array<DashboardVariable>;
}): Promise<TemplateRead> {
  const metrics: Array<ReadRow> = [];

  for (const query of getTemplateMetricQueries(data.type)) {
    metrics.push(
      ...(await metricRowsRead({
        projectId: data.projectId,
        query: query,
        variables: data.variables,
      })),
    );
  }

  return {
    metrics: metrics,
    logs: hasLogStream(data.type)
      ? await logRowsRead({
          projectId: data.projectId,
          variables: data.variables,
        })
      : [],
  };
}

function valueOf(row: ReadRow, key: string): string {
  const value: unknown = row.attributes[key];
  return typeof value === "string" ? value : "";
}

// Whose rows were read, by a resource attribute: "" for none.
function readersOf(rows: Array<ReadRow>, key: string): Array<string> {
  return Array.from(
    new Set<string>(
      rows.map((row: ReadRow) => {
        return valueOf(row, key);
      }),
    ),
  ).sort();
}

// A tile's points, fetched as the board fetches them.
async function tilePoints(data: {
  projectId: ObjectID;
  type: DashboardTemplateType;
  metricName: string;
  variables: Array<DashboardVariable>;
}): Promise<Array<number>> {
  const query: MetricQueryConfigData | undefined = getTemplateMetricQueries(
    data.type,
  ).find((candidate: MetricQueryConfigData) => {
    return candidate.metricQueryData.filterData.metricName === data.metricName;
  });

  expect(query).toBeDefined();

  const spy: { mockRestore: () => void } = jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(data.projectId) as unknown as { mockRestore: () => void };

  try {
    const results: Array<AggregatedResult> = await MetricUtil.fetchResults({
      metricViewData: {
        queryConfigs: DashboardVariableInterpolation.applyToQueryConfigs(
          [query!],
          data.variables,
        ),
        formulaConfigs: [],
        startAndEndDate: WINDOW,
      },
      // The catalog only converts units; these points are read as stored.
      metricTypes: [],
      refreshNonce: ObjectID.generate().toString(),
    } as never);

    return (results[0]?.data || []).map((point: AggregatedModel) => {
      return Number(point["value"]);
    });
  } finally {
    spy.mockRestore();
  }
}

integration("template dashboards read their own kind of resource", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  const original: Array<{
    service: Record<string, unknown>;
    saved: Record<string, unknown>;
  }> = [];

  const SWAPPED: Array<string> = [
    "database",
    "databaseClient",
    "ingestDatabase",
    "ingestDatabaseClient",
  ];

  async function averageOf(data: {
    projectId: ObjectID;
    metricName: string;
    hostName?: string;
  }): Promise<number> {
    const found: { json: () => Promise<unknown> } = await client.query({
      query: `SELECT avg(value) AS average FROM ${database}.${new Metric().tableName} WHERE projectId = {projectId:String} AND name = {name:String}${data.hostName ? " AND attributes['resource.host.name'] = {hostName:String}" : ""}`,
      query_params: {
        projectId: data.projectId.toString(),
        name: data.metricName,
        hostName: data.hostName || "",
      },
      format: "JSONEachRow",
    });
    const [row] = (await found.json()) as Array<{ average: number }>;
    return Number(row?.average);
  }

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

    // connect() creates the database it is pointed at.
    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    for (const modelType of [
      Metric,
      Log,
      MetricItemAggMV1m,
      MetricItemAggMV1mByHostV2,
      MetricItemAggMV1mByK8sCluster,
      MetricItemAggMV1mByContainer,
      MetricItemAggMV1mByService,
    ]) {
      await createTable({
        client,
        clickhouse,
        modelType: modelType as unknown as { new (): AnalyticsBaseModel },
      });
    }

    for (const projectData of [
      { projectId: MIXED_PROJECT, blocks: mixedProjectBlocks() },
      { projectId: DOCKER_ONLY_PROJECT, blocks: dockerAgentBlocks() },
    ]) {
      const rows: { metrics: Array<JSONObject>; logs: Array<JSONObject> } =
        await ingestRows(projectData);

      expect(rows.metrics.length).toBeGreaterThan(0);
      expect(rows.logs.length).toBeGreaterThan(0);

      await client.insert({
        table: `${database}.${new Metric().tableName}`,
        values: asStored(rows.metrics, new Metric()),
        format: "JSONEachRow",
      });
      await client.insert({
        table: `${database}.${new Log().tableName}`,
        values: asStored(rows.logs, new Log()),
        format: "JSONEachRow",
      });
    }

    for (const service of [MetricService, LogService]) {
      const writable: Record<string, unknown> = service as unknown as Record<
        string,
        unknown
      >;
      const saved: Record<string, unknown> = {};

      for (const key of SWAPPED) {
        saved[key] = writable[key];
      }

      original.push({ service: writable, saved });
      writable["database"] = clickhouse;
      writable["databaseClient"] = client;
      writable["ingestDatabase"] = clickhouse;
      writable["ingestDatabaseClient"] = client;
    }

    mockAnswer = async (request: unknown): Promise<unknown> => {
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
    };
  });

  afterAll(async (): Promise<void> => {
    mockAnswer = null;

    for (const entry of original) {
      for (const key of SWAPPED) {
        entry.service[key] = entry.saved[key];
      }
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  describe("a project with only the Docker Agent (the issue's reproduction)", () => {
    test("the Docker Swarm board reads nothing - there is no swarm - where it drew the Docker Agent's containers and every log", async () => {
      const read: TemplateRead = await rowsTemplateReads({
        projectId: DOCKER_ONLY_PROJECT,
        type: DashboardTemplateType.DockerSwarm,
        variables: templateVariables(DashboardTemplateType.DockerSwarm),
      });

      expect(read.metrics).toEqual([]);
      expect(read.logs).toEqual([]);

      // Its CPU chart, fetched as the board fetches it, has nothing to draw.
      expect(
        await tilePoints({
          projectId: DOCKER_ONLY_PROJECT,
          type: DashboardTemplateType.DockerSwarm,
          metricName: "container.cpu.utilization",
          variables: templateVariables(DashboardTemplateType.DockerSwarm),
        }),
      ).toEqual([]);
    });

    test("Kubernetes' Cluster Logs shows no Docker log, and its charts nothing", async () => {
      const read: TemplateRead = await rowsTemplateReads({
        projectId: DOCKER_ONLY_PROJECT,
        type: DashboardTemplateType.Kubernetes,
        variables: templateVariables(DashboardTemplateType.Kubernetes),
      });

      expect(read.metrics).toEqual([]);
      expect(read.logs).toEqual([]);
    });

    test("the Hosts board shows no Docker log, and its Host picker offers no Docker host", async () => {
      const read: TemplateRead = await rowsTemplateReads({
        projectId: DOCKER_ONLY_PROJECT,
        type: DashboardTemplateType.Host,
        variables: templateVariables(DashboardTemplateType.Host),
      });

      expect(read.metrics).toEqual([]);
      expect(read.logs).toEqual([]);

      const hostVariable: DashboardVariable = templateVariables(
        DashboardTemplateType.Host,
      )[0]!;

      TelemetryAttributeServiceClass.clearValueSuggestionCache();

      expect(
        await TelemetryAttributeService.fetchAttributeValues({
          projectId: DOCKER_ONLY_PROJECT,
          telemetryType: TelemetryType.Metric,
          attributeKey: hostVariable.attributeKey!,
          resourceScope: hostVariable.resourceScope,
          startTime: WINDOW.startValue,
          endTime: WINDOW.endValue,
        }),
      ).toEqual([]);
    });
  });

  describe("a project with a bit of everything", () => {
    test("Kubernetes reads the cluster's telemetry alone, and its Cluster Logs only the cluster's logs", async () => {
      const read: TemplateRead = await rowsTemplateReads({
        projectId: MIXED_PROJECT,
        type: DashboardTemplateType.Kubernetes,
        variables: templateVariables(DashboardTemplateType.Kubernetes),
      });

      expect(read.metrics.length).toBeGreaterThan(0);
      expect(read.logs.length).toBeGreaterThan(0);
      expect(readersOf(read.metrics, "resource.k8s.cluster.name")).toEqual([
        "shop-cluster",
      ]);
      expect(readersOf(read.logs, "resource.k8s.cluster.name")).toEqual([
        "shop-cluster",
      ]);
    });

    test("Kubernetes with its cluster picked reads it, and with one that does not exist reads nothing", async () => {
      const picked: TemplateRead = await rowsTemplateReads({
        projectId: MIXED_PROJECT,
        type: DashboardTemplateType.Kubernetes,
        variables: templateVariables(DashboardTemplateType.Kubernetes, {
          cluster: ["shop-cluster"],
        }),
      });

      expect(picked.metrics.length).toBeGreaterThan(0);
      expect(picked.logs.length).toBeGreaterThan(0);

      const none: TemplateRead = await rowsTemplateReads({
        projectId: MIXED_PROJECT,
        type: DashboardTemplateType.Kubernetes,
        variables: templateVariables(DashboardTemplateType.Kubernetes, {
          cluster: ["no-such-cluster"],
        }),
      });

      expect(none.metrics).toEqual([]);
      expect(none.logs).toEqual([]);
    });

    test("Kubernetes Cost reads the cluster's cost engine", async () => {
      const read: TemplateRead = await rowsTemplateReads({
        projectId: MIXED_PROJECT,
        type: DashboardTemplateType.KubernetesCost,
        variables: templateVariables(DashboardTemplateType.KubernetesCost),
      });

      expect(read.metrics.length).toBeGreaterThan(0);
      expect(readersOf(read.metrics, "resource.k8s.cluster.name")).toEqual([
        "shop-cluster",
      ]);
    });

    test("Hosts reads db-01's own telemetry alone - never a Kubernetes node's, a Docker host's, a pod's or an app's", async () => {
      const read: TemplateRead = await rowsTemplateReads({
        projectId: MIXED_PROJECT,
        type: DashboardTemplateType.Host,
        variables: templateVariables(DashboardTemplateType.Host),
      });

      expect(read.metrics.length).toBeGreaterThan(0);
      expect(read.logs.length).toBeGreaterThan(0);
      expect(readersOf(read.metrics, "resource.host.name")).toEqual(["db-01"]);
      expect(readersOf(read.logs, "resource.host.name")).toEqual(["db-01"]);
      expect(readersOf(read.metrics, "resource.k8s.node.name")).toEqual([""]);
    });

    test("Hosts' Avg Memory tile averages db-01 alone, not the Kubernetes node beside it", async () => {
      const ownAverage: number = await averageOf({
        projectId: MIXED_PROJECT,
        metricName: "system.memory.usage",
        hostName: "db-01",
      });
      const everyonesAverage: number = await averageOf({
        projectId: MIXED_PROJECT,
        metricName: "system.memory.usage",
      });

      // The node's system.memory.usage is in the project, and would move it.
      expect(Number.isFinite(ownAverage)).toBe(true);
      expect(everyonesAverage).not.toBeCloseTo(ownAverage, 0);

      const points: Array<number> = await tilePoints({
        projectId: MIXED_PROJECT,
        type: DashboardTemplateType.Host,
        metricName: "system.memory.usage",
        variables: templateVariables(DashboardTemplateType.Host),
      });

      expect(points).toHaveLength(1);
      expect(Math.abs(points[0]! - ownAverage) / ownAverage).toBeLessThan(
        1e-6,
      );
    });

    test("Hosts' picker offers db-01 alone - no Docker host, no pod, no node VM an app's SDK named", async () => {
      const hostVariable: DashboardVariable = templateVariables(
        DashboardTemplateType.Host,
      )[0]!;

      TelemetryAttributeServiceClass.clearValueSuggestionCache();

      expect(
        await TelemetryAttributeService.fetchAttributeValues({
          projectId: MIXED_PROJECT,
          telemetryType: TelemetryType.Metric,
          attributeKey: hostVariable.attributeKey!,
          resourceScope: hostVariable.resourceScope,
          startTime: WINDOW.startValue,
          endTime: WINDOW.endValue,
        }),
      ).toEqual(["db-01"]);

      // Every one of those names is in the project's telemetry.
      TelemetryAttributeServiceClass.clearValueSuggestionCache();

      expect(
        await TelemetryAttributeService.fetchAttributeValues({
          projectId: MIXED_PROJECT,
          telemetryType: TelemetryType.Metric,
          attributeKey: hostVariable.attributeKey!,
          startTime: WINDOW.startValue,
          endTime: WINDOW.endValue,
        }),
      ).toEqual(
        expect.arrayContaining([
          "db-01",
          "web-shop-01",
          "aks-nodepool1-vm0",
          "shop-worker-6748887dc-2wr95",
        ]),
      );
    });

    test("Hosts with a Docker host's and a pod's names picked beside db-01 still reads db-01 alone", async () => {
      const read: TemplateRead = await rowsTemplateReads({
        projectId: MIXED_PROJECT,
        type: DashboardTemplateType.Host,
        variables: templateVariables(DashboardTemplateType.Host, {
          host: ["db-01", "web-shop-01", "shop-worker-6748887dc-2wr95"],
        }),
      });

      expect(read.metrics.length).toBeGreaterThan(0);
      expect(readersOf(read.metrics, "resource.host.name")).toEqual(["db-01"]);
      expect(readersOf(read.logs, "resource.host.name")).toEqual(["db-01"]);
    });

    test("Docker Swarm reads the swarm's containers and logs, not the Docker Agent's", async () => {
      const read: TemplateRead = await rowsTemplateReads({
        projectId: MIXED_PROJECT,
        type: DashboardTemplateType.DockerSwarm,
        variables: templateVariables(DashboardTemplateType.DockerSwarm),
      });

      expect(read.metrics.length).toBeGreaterThan(0);
      expect(read.logs.length).toBeGreaterThan(0);
      expect(
        readersOf(
          [...read.metrics, ...read.logs],
          "resource.docker.swarm.cluster.name",
        ),
      ).toEqual(["prod-swarm"]);
    });

    test.each([
      [DashboardTemplateType.Proxmox, "resource.proxmox.cluster.name", "lab-pve"],
      [DashboardTemplateType.VMware, "resource.vmware.vcenter.name", "vc-lab"],
      [DashboardTemplateType.XcpNg, "resource.xcp_ng.pool.id", XCP_NG_POOL_ID],
      [
        DashboardTemplateType.OpenStack,
        "resource.openstack.cloud.name",
        "lab-cloud",
      ],
      [DashboardTemplateType.Ceph, "resource.ceph.cluster.name", "lab-ceph"],
      [
        DashboardTemplateType.StorageArray,
        "resource.storage.array.name",
        "fa-01",
      ],
    ])(
      "%s reads its own resource's telemetry alone",
      async (type: DashboardTemplateType, key: string, value: string) => {
        const read: TemplateRead = await rowsTemplateReads({
          projectId: MIXED_PROJECT,
          type: type,
          variables: templateVariables(type),
        });

        expect(read.metrics.length).toBeGreaterThan(0);
        expect(readersOf(read.metrics, key)).toEqual([value]);

        if (hasLogStream(type)) {
          expect(read.logs.length).toBeGreaterThan(0);
          expect(readersOf(read.logs, key)).toEqual([value]);
        }
      },
    );

    test("the Metrics board, made for the whole project, still reads all of it", async () => {
      const read: TemplateRead = await rowsTemplateReads({
        projectId: MIXED_PROJECT,
        type: DashboardTemplateType.Metrics,
        variables: templateVariables(DashboardTemplateType.Metrics),
      });

      expect(readersOf(read.logs, "resource.host.name")).toEqual(
        expect.arrayContaining(["db-01", "web-shop-01", "aks-nodepool1-vm0"]),
      );
      expect(readersOf(read.logs, "resource.k8s.cluster.name")).toContain(
        "shop-cluster",
      );
    });
  });
});

describe("The template dashboards' ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
