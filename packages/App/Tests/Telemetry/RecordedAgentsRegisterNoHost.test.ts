/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at
 * import time via the services' queue imports; nothing queue-related is
 * under test here, so the module is replaced - same idiom as
 * MobileAppResourceNotAHost.test.ts in this directory.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it. Replaced WITH A FACTORY - an
 * automock would still require, and type-check, the real file.
 */
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

import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import HostService from "Common/Server/Services/HostService";
import LabelService from "Common/Server/Services/LabelService";
import DockerResourceService from "Common/Server/Services/DockerResourceService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { HEARTBEAT_ROW_PRESENT } from "Common/Server/Utils/Telemetry/ResourceHeartbeat";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import Host from "Common/Models/DatabaseModels/Host";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  RecordedBlock,
  RecordingName,
  getRecordedBlock,
  retimeRecordedBlock,
} from "../Fixtures/HostResourceRecordings";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ISSUE #11257, THROUGH THE REAL INGEST: WHAT REAL AGENTS AND APPS SEND
 * REGISTERS A HOST ONLY WHEN IT IS A HOST'S OWN TELEMETRY.
 *
 * The recordings (Fixtures/HostResourceRecordings) go through the real
 * metrics, logs and traces walks - processMetricsFromQueue,
 * processLogsFromQueue, processTracesFromQueue - with the real Host gate
 * (autoDiscoverHost) and the real metrics batch enrichment
 * (runBatchHostEnrichment). Only what reaches Postgres, Redis or ClickHouse
 * is stood in for: a Host lookup answers with a row, so a Host the gate let
 * through is one the test sees.
 *
 *   - The Docker Agent's container metrics and logs carry
 *     container.runtime=docker, host.name=web-shop-01 and os.type=linux. A
 *     Docker host whose row did not resolve in the batch (a gone row, a
 *     failed lookup) used to be registered as a Host as well.
 *   - Two apps in pods export straight to OneUptime, with no k8s.* attribute:
 *     one names its pod in host.name, before and after a rollout; the other's
 *     SDK names the node's VM. Each was a Host - one per pod, more with each
 *     rollout - from os.type, which the SDKs' OS detectors set.
 *   - The Kubernetes agent's node, pod, cluster and eBPF telemetry never was
 *     one, and is not.
 *   - OneUptime's default host collector's system and process blocks are, as
 *     ever: db-01.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const HOST_ROW_ID: ObjectID = ObjectID.generate();
const DOCKER_HOST_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();

// Inside any read window: the recordings are retimed to it.
const NOW: Date = new Date();

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
const metricsService: Record<string, any> =
  OtelMetricsIngestService as unknown as Record<string, any>;
const logsService: Record<string, any> =
  OtelLogsIngestService as unknown as Record<string, any>;
const tracesService: Record<string, any> =
  OtelTracesIngestService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

// Every discovery but the Host's, the Docker host's and the Podman host's.
const OTHER_DISCOVERIES: Array<string> = [
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

type CallRecorder = { mock: { calls: Array<Array<unknown>> } };

let resolveSpy: CallRecorder;
let findOrCreateSpy: CallRecorder;
let dockerHostAnswer: ObjectID | null = null;

function stubService(service: Record<string, unknown>): void {
  for (const method of OTHER_DISCOVERIES) {
    if (typeof service[method] === "function") {
      jest.spyOn(service as never, method as never).mockResolvedValue(
        null as never,
      );
    }
  }

  jest
    .spyOn(service as never, "autoDiscoverDockerHost" as never)
    .mockImplementation((async () => {
      return dockerHostAnswer;
    }) as never);
  jest
    .spyOn(service as never, "autoDiscoverPodmanHost" as never)
    .mockResolvedValue(null as never);
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

function drain(...args: Array<unknown>): Promise<void> {
  const rows: Array<JSONObject> = (args[0] || []) as Array<JSONObject>;
  rows.splice(0, rows.length);
  return Promise.resolve();
}

beforeEach(() => {
  OtelIngestBaseService.clearInProcessMemos();
  dockerHostAnswer = null;

  const host: Host = new Host();
  host._id = HOST_ROW_ID.toString();
  host.projectId = PROJECT_ID;

  // The Host gate's lookup: a row for whatever it lets through.
  resolveSpy = jest
    .spyOn(baseService, "resolveDiscoveredResourceId")
    .mockImplementation((async (data: { kindName: string }) => {
      return data.kindName === "Host"
        ? HOST_ROW_ID.toString()
        : ObjectID.generate().toString();
    }) as never) as unknown as CallRecorder;
  jest.spyOn(baseService, "shouldRunMaintenance").mockResolvedValue(false);

  // The metrics batch enrichment's own write path.
  findOrCreateSpy = jest
    .spyOn(HostService, "findOrCreateByHostIdentifier")
    .mockResolvedValue(host) as unknown as CallRecorder;
  jest
    .spyOn(HostService, "updateLastSeen")
    .mockResolvedValue(HEARTBEAT_ROW_PRESENT);
  jest.spyOn(HostService, "attachLabels").mockResolvedValue(undefined);
  jest.spyOn(LabelService, "findOrCreateLabelsByNames").mockResolvedValue([]);

  for (const service of [metricsService, logsService, tracesService]) {
    stubService(service);
  }

  jest.spyOn(metricsService, "submitMetricsBuffer").mockImplementation(drain);
  jest
    .spyOn(metricsService, "flushDockerSnapshotBuffer")
    .mockResolvedValue(undefined);
  jest
    .spyOn(MetricPipelineRuleService, "loadRules")
    .mockResolvedValue({ projectRules: [], rulesByServiceId: new Map() });
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    .mockResolvedValue(undefined as never);

  jest.spyOn(logsService, "submitLogsBuffer").mockImplementation(drain);
  jest.spyOn(logsService, "submitExceptionsBuffer").mockImplementation(drain);
  jest.spyOn(LogDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogPipelineService, "loadPipelines")
    .mockResolvedValue([] as never);
  jest.spyOn(DockerResourceService, "bulkUpsert").mockResolvedValue(
    undefined as never,
  );

  jest.spyOn(tracesService, "submitSpansBuffer").mockImplementation(drain);
  jest.spyOn(tracesService, "submitExceptionsBuffer").mockImplementation(drain);
  jest.spyOn(TraceDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest
    .spyOn(TraceScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as never);
  jest
    .spyOn(TracePipelineService, "loadPipelines")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LlmModelPriceService, "loadModelPrices")
    .mockResolvedValue([] as never);
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  OtelIngestBaseService.clearInProcessMemos();
});

function recorded(name: RecordingName, key: string): RecordedBlock {
  return retimeRecordedBlock(getRecordedBlock(name, key), NOW);
}

function request(
  signal: "resourceMetrics" | "resourceLogs" | "resourceSpans",
  blocks: Array<RecordedBlock>,
): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: {
      [signal]: blocks.map((block: RecordedBlock) => {
        return block.block;
      }),
    },
    headers: {},
  } as unknown as TelemetryRequest;
}

// Sends each recorded block through the ingest of its own signal.
async function ingest(blocks: Array<RecordedBlock>): Promise<void> {
  const of: (
    signal: RecordedBlock["signal"],
  ) => Array<RecordedBlock> = (signal: RecordedBlock["signal"]) => {
    return blocks.filter((block: RecordedBlock) => {
      return block.signal === signal;
    });
  };

  if (of("resourceMetrics").length > 0) {
    await OtelMetricsIngestService.processMetricsFromQueue(
      request("resourceMetrics", of("resourceMetrics")) as never,
    );
  }

  if (of("resourceLogs").length > 0) {
    await OtelLogsIngestService.processLogsFromQueue(
      request("resourceLogs", of("resourceLogs")) as never,
    );
  }

  if (of("resourceSpans").length > 0) {
    await OtelTracesIngestService.processTracesFromQueue(
      request("resourceSpans", of("resourceSpans")) as never,
    );
  }
}

// The Hosts the gate let through, by the name each would be registered by.
function hostsRegisteredByTheGate(): Array<string> {
  return resolveSpy.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as { kindName: string; identity: string };
    })
    .filter((data: { kindName: string }) => {
      return data.kindName === "Host";
    })
    .map((data: { identity: string }) => {
      return data.identity;
    });
}

// The Hosts the metrics batch enrichment found or created.
function hostsRegisteredByTheEnrichment(): Array<string> {
  return findOrCreateSpy.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as { hostIdentifier: string }).hostIdentifier;
  });
}

const DOCKER_AGENT: Array<RecordedBlock> = [
  recorded("docker-agent", "containerMetrics"),
  recorded("docker-agent", "containerLogs"),
];

const POD_APP_NAMING_ITS_POD: Array<RecordedBlock> = [
  recorded("direct-otlp-pods", "workerMetrics"),
  recorded("direct-otlp-pods", "workerLogs"),
  recorded("direct-otlp-pods", "workerSpans"),
  recorded("direct-otlp-pods", "workerLogsBeforeRollout"),
];

const POD_APP_NAMING_ITS_VM: Array<RecordedBlock> = [
  recorded("direct-otlp-pods", "apiMetrics"),
  recorded("direct-otlp-pods", "apiLogs"),
  recorded("direct-otlp-pods", "apiSpans"),
];

const KUBERNETES_AGENT: Array<RecordedBlock> = [
  recorded("kubernetes-agent", "nodeHostMetrics"),
  recorded("kubernetes-agent", "nodeKubeletMetrics"),
  recorded("kubernetes-agent", "podMetrics"),
  recorded("kubernetes-agent", "deploymentMetrics"),
  recorded("kubernetes-agent", "podLogs"),
  recorded("kubernetes-agent", "ebpfSpans"),
];

const HOST_COLLECTOR: Array<RecordedBlock> = [
  recorded("host-collector", "hostMetrics"),
  recorded("host-collector", "processMetrics"),
];

describe("recorded telemetry through the real ingest (issue #11257)", () => {
  test("the Docker Agent's metrics and logs register no Host when their Docker host did not resolve", async () => {
    dockerHostAnswer = null;

    await ingest(DOCKER_AGENT);

    expect(hostsRegisteredByTheGate()).toEqual([]);
    expect(hostsRegisteredByTheEnrichment()).toEqual([]);
  });

  test("nor when it did", async () => {
    dockerHostAnswer = DOCKER_HOST_ID;

    await ingest(DOCKER_AGENT);

    expect(hostsRegisteredByTheGate()).toEqual([]);
    expect(hostsRegisteredByTheEnrichment()).toEqual([]);
  });

  test("an app in a pod that names its pod registers no Host, before or after a rollout", async () => {
    await ingest(POD_APP_NAMING_ITS_POD);

    expect(hostsRegisteredByTheGate()).toEqual([]);
    expect(hostsRegisteredByTheEnrichment()).toEqual([]);
  });

  test("an app whose SDK names the node's VM in host.name registers no Host either", async () => {
    await ingest(POD_APP_NAMING_ITS_VM);

    expect(hostsRegisteredByTheGate()).toEqual([]);
    expect(hostsRegisteredByTheEnrichment()).toEqual([]);
  });

  test("the Kubernetes agent's node, pod, cluster and eBPF telemetry registers no Host", async () => {
    await ingest(KUBERNETES_AGENT);

    expect(hostsRegisteredByTheGate()).toEqual([]);
    expect(hostsRegisteredByTheEnrichment()).toEqual([]);
  });

  test("a host's own collector still registers its Host, from its system and process blocks", async () => {
    await ingest(HOST_COLLECTOR);

    expect(new Set(hostsRegisteredByTheGate())).toEqual(new Set(["db-01"]));
    expect(hostsRegisteredByTheEnrichment()).toEqual(["db-01"]);
  });

  test("one batch of everything registers db-01 alone", async () => {
    await ingest([
      ...DOCKER_AGENT,
      ...POD_APP_NAMING_ITS_POD,
      ...POD_APP_NAMING_ITS_VM,
      ...KUBERNETES_AGENT,
      ...HOST_COLLECTOR,
    ]);

    expect(new Set(hostsRegisteredByTheGate())).toEqual(new Set(["db-01"]));
    expect(hostsRegisteredByTheEnrichment()).toEqual(["db-01"]);
  });
});
