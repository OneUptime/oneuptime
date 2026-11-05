import { OpenStackCollectionOptions } from "Common/Types/OpenStack/OpenStackProbeCollection";
import OpenStackProbeMetrics from "Common/Server/Utils/OpenStack/OpenStackProbeMetrics";
import {
  OpenStackOptionalServiceScrape,
  OpenStackResourceBufferEntry,
  bufferOpenStackOptionalServiceScrape,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  isOpenStackOptionalServiceScrapeDatapoint,
  isOpenStackSnapshotDatapoint,
} from "Common/Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  OpenStackMetricDefinition,
  getOpenStackMetricByMetricName,
} from "Common/Types/Monitor/OpenStackMetricCatalog";
import {
  OpenStackAccessRead,
  OpenStackCollectionReport,
  OpenStackConnectionTestReport,
} from "Common/Types/OpenStack/OpenStackProbeCollection";
import OpenStackCollector from "../../../../Utils/OpenStack/OpenStackCollector";
import {
  OpenStackHttpRequest,
  OpenStackHttpResponse,
} from "../../../../Utils/OpenStack/OpenStackHttp";
import {
  CollectorHarness,
  ReportedDatapoint,
  collectionJob,
  connectionTestJob,
  createCollectorHarness,
  datapointsOf,
} from "./CollectorHarness";
import {
  PrometheusSeries,
  RECORDED_AUTH_URL,
  RecordedScene,
} from "./RecordedCloud";

/*
 * A SERVICE A CLOUD MAY NOT RUN, ANSWERING AS A RECORDED SCENE DID.
 *
 * The promise the probe makes for one: what it sends is what the agent sends, on the same real DevStack
 * at the same moment, plus what only a native read can add. These scenes record each service's own API
 * beside the exporter, so each read here is answered with what that API really said, status and all.
 * Not a test file itself.
 */

export interface RecordedAnswer {
  status: number;
  body: string;
}

export interface RecordedRequest {
  // Which host and port it went to: what's in Keystone's catalog is all one, and /recon isn't.
  host: string;
  path: string;
  query: string;
  headers: Record<string, string>;
}

function respond(answer: RecordedAnswer): OpenStackHttpResponse {
  return {
    status: answer.status,
    headers: { date: "Thu, 05 Nov 2026 02:30:00 GMT" },
    body: answer.body,
  };
}

export function catalogEntry(type: string, url: string): JSONObject {
  return {
    id: type,
    name: type,
    type,
    endpoints: [
      {
        id: type,
        interface: "public",
        region: "RegionOne",
        region_id: "RegionOne",
        url,
      },
    ],
  };
}

const CATALOG_KEYSTONE: JSONObject = catalogEntry(
  "identity",
  RECORDED_AUTH_URL,
);

function tokenBody(data: {
  catalog: Array<JSONObject>;
  projectId: string;
  roles: Array<string>;
}): JSONObject {
  return {
    token: {
      methods: ["application_credential"],
      expires_at: "2026-11-05T12:48:28.000000Z",
      issued_at: "2026-11-05T01:48:28.000000Z",
      project: {
        id: data.projectId,
        name: "admin",
        domain: { id: "default", name: "Default" },
      },
      roles: data.roles.map((role: string): JSONObject => {
        return { id: `role-${role}`, name: role };
      }),
      user: { id: "monitoring-user", name: "oneuptime-monitoring" },
      catalog: [CATALOG_KEYSTONE, ...data.catalog],
    },
  };
}

// What a scene recorded of one call, with the status it came with. Undefined when it holds no such call.
export function recordedCall(
  scene: RecordedScene,
  call: string,
): RecordedAnswer | undefined {
  const text: string | undefined = scene.api.get(call);
  return text === undefined
    ? undefined
    : { status: scene.statuses.get(call) || 200, body: text };
}

export interface RecordedServiceCollection {
  report: OpenStackCollectionReport;
  points: Array<ReportedDatapoint>;
  // Each read a collection made of a service, Keystone's own left out, so what it costs can be counted.
  requests: Array<RecordedRequest>;
  harness: CollectorHarness;
}

export interface RecordedServiceAnswers {
  catalog: Array<JSONObject>;
  // What a path of the service answers. Undefined reads as the 404 anything else would.
  answer: (
    path: string,
    request: RecordedRequest,
  ) => RecordedAnswer | undefined;
  projectId?: string | undefined;
  roles?: Array<string> | undefined;
  // What Keystone lists. Left out, it lists none, as for a cloud with few.
  projects?: Array<JSONObject> | undefined;
  options?: OpenStackCollectionOptions | undefined;
}

function transportOf(
  data: RecordedServiceAnswers,
  requests: Array<RecordedRequest>,
): (request: OpenStackHttpRequest) => Promise<OpenStackHttpResponse> {
  return async (
    request: OpenStackHttpRequest,
  ): Promise<OpenStackHttpResponse> => {
    const url: URL = new URL(request.url);
    const path: string = url.pathname;

    if (path.endsWith("/auth/tokens")) {
      return {
        status: 201,
        headers: { "x-subject-token": "a-token" },
        body: JSON.stringify(
          tokenBody({
            catalog: data.catalog,
            projectId: data.projectId || "4d0acfc18c9d4a0b994a7fe34516bf65",
            roles: data.roles || ["admin"],
          }),
        ),
      };
    }

    // Keystone's lists say nothing here, and answer as they would for a cloud with few.
    if (path.includes("/identity/v3/")) {
      const key: string = path.substring(path.lastIndexOf("/") + 1);
      return respond({
        status: 200,
        body: JSON.stringify({
          [key]: key === "projects" ? data.projects || [] : [],
        }),
      });
    }

    const recorded: RecordedRequest = {
      host: url.host,
      path,
      query: url.search,
      headers: (request.headers || {}) as Record<string, string>,
    };
    requests.push(recorded);

    return respond(
      data.answer(path, recorded) || {
        status: 404,
        body: '{"message": "Not found."}',
      },
    );
  };
}

export async function collectFromRecordedService(
  data: RecordedServiceAnswers & { harness?: CollectorHarness | undefined },
): Promise<RecordedServiceCollection> {
  const requests: Array<RecordedRequest> = [];
  const transport: ReturnType<typeof transportOf> = transportOf(data, requests);

  const harness: CollectorHarness =
    data.harness || createCollectorHarness({ transport: transport as never });
  if (data.harness) {
    data.harness.dependencies.createTransport = () => {
      return { transport: transport as never, close: () => {} };
    };
  }

  const report: OpenStackCollectionReport = await OpenStackCollector.collect(
    collectionJob({ authUrl: RECORDED_AUTH_URL, options: data.options || {} }),
    harness.dependencies,
  );

  return {
    report,
    points: datapointsOf(report.resourceMetrics),
    requests,
    harness,
  };
}

// What Test Connection says of each read, on the same answers.
export async function testConnectionOnRecordedService(
  data: RecordedServiceAnswers,
): Promise<Array<OpenStackAccessRead>> {
  const harness: CollectorHarness = createCollectorHarness({
    transport: transportOf(data, []) as never,
  });
  const report: OpenStackConnectionTestReport = await OpenStackCollector.test(
    connectionTestJob({ authUrl: RECORDED_AUTH_URL }),
    harness.dependencies,
  );
  return report.summary?.reads || [];
}

export function pointsNamed(
  points: ReadonlyArray<ReportedDatapoint>,
  metric: string,
): Array<ReportedDatapoint> {
  return points.filter((point: ReportedDatapoint): boolean => {
    return point.metric === metric;
  });
}

// The labels both say, in a comparable order: what only a probe adds is held to the catalogue.
function withoutProbeLabels(
  metric: string,
  labels: Record<string, string>,
  ignoring: ReadonlyArray<string>,
): Record<string, string> {
  const definition: OpenStackMetricDefinition | undefined =
    getOpenStackMetricByMetricName(metric);
  const kept: Record<string, string> = {};
  for (const key of Object.keys(labels).sort()) {
    if (
      !(definition?.probeOnlyAttributes || []).includes(key) &&
      !ignoring.includes(key) &&
      key !== "openstack.region.name" &&
      key !== "openstack_service" &&
      labels[key]
    ) {
      kept[key] = labels[key] as string;
    }
  }
  return kept;
}

export function comparableOfProbe(
  points: ReadonlyArray<ReportedDatapoint>,
  metric: string,
  ignoring: ReadonlyArray<string> = [],
): Array<string> {
  return pointsNamed(points, metric)
    .map((point: ReportedDatapoint): string => {
      return JSON.stringify({
        labels: withoutProbeLabels(metric, point.labels, ignoring),
        value: point.value,
      });
    })
    .sort();
}

export function comparableOfExporter(
  scene: RecordedScene,
  metric: string,
  ignoring: ReadonlyArray<string> = [],
): Array<string> {
  return scene.exporter
    .filter((series: PrometheusSeries): boolean => {
      return series.name === metric;
    })
    .map((series: PrometheusSeries): string => {
      return JSON.stringify({
        labels: withoutProbeLabels(metric, series.labels, ignoring),
        value: series.value,
      });
    })
    .sort();
}

// What the rest of OneUptime makes of a report: the rows ingest would write from it.
export function rowsOfReport(report: OpenStackCollectionReport): {
  rows: Array<OpenStackResourceBufferEntry>;
  scrapes: Map<string, OpenStackOptionalServiceScrape>;
} {
  const stamped: JSONArray = OpenStackProbeMetrics.prepare({
    resourceMetrics: report.resourceMetrics as JSONArray,
    cloudName: "Lab",
  }).resourceMetrics;
  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();
  const scrapes: Map<string, OpenStackOptionalServiceScrape> = new Map();
  for (const resource of stamped as Array<JSONObject>) {
    for (const scope of resource["scopeMetrics"] as Array<JSONObject>) {
      for (const metric of scope["metrics"] as Array<JSONObject>) {
        const gauge: JSONObject = metric["gauge"] as JSONObject;
        for (const datapoint of gauge["dataPoints"] as Array<JSONObject>) {
          const metricName: string = metric["name"] as string;
          if (isOpenStackSnapshotDatapoint({ metricName, datapoint })) {
            bufferOpenStackSnapshotMetric({ metricName, datapoint, buffer });
          }
          if (
            isOpenStackOptionalServiceScrapeDatapoint({ metricName, datapoint })
          ) {
            bufferOpenStackOptionalServiceScrape({
              metricName,
              datapoint,
              buffer: scrapes,
            });
          }
        }
      }
    }
  }
  return { rows: finishOpenStackBatch(buffer.values()), scrapes };
}
