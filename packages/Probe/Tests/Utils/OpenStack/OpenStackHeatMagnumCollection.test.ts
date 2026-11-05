import { describe, expect, test } from "@jest/globals";
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
  OpenStackCollectionReport,
  OpenStackConnectionTestReport,
  OpenStackAccessRead,
} from "Common/Types/OpenStack/OpenStackProbeCollection";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import { MAGNUM_CLUSTER_READS_PER_COLLECTION } from "../../../Utils/OpenStack/Collectors/ContainerInfraCollector";
import OpenStackCollector from "../../../Utils/OpenStack/OpenStackCollector";
import {
  OpenStackHttpRequest,
  OpenStackHttpResponse,
} from "../../../Utils/OpenStack/OpenStackHttp";
import {
  CollectorHarness,
  ReportedDatapoint,
  collectionJob,
  connectionTestJob,
  createCollectorHarness,
  datapointsOf,
} from "./Helpers/CollectorHarness";
import {
  PrometheusSeries,
  RECORDED_AUTH_URL,
  RECORDED_HOST,
  RecordedScene,
  loadCollectorExport,
  loadScene,
  recordedJson,
} from "./Helpers/RecordedCloud";

/*
 * The promise the probe makes, for services a cloud may not run: what it sends is what the agent
 * sends, on the same real DevStack at the same moment (services-heat-magnum, stable/2026.1), plus what
 * only a native read can add. These scenes record Heat's and Magnum's own APIs beside the exporter, so
 * each read here is answered with what that API really said, status and all.
 */

const GROUP: string = "services-heat-magnum";
const PROJECT: string = "4d0acfc18c9d4a0b994a7fe34516bf65";
const HEAT_URL: string = `${RECORDED_HOST}/heat-api/v1/${PROJECT}`;
const MAGNUM_URL: string = `${RECORDED_HOST}/container-infra/v1`;

const HEAT_SCENES: ReadonlyArray<string> = [
  "heat-baseline",
  "heat-held-in-progress",
  "heat-update-failed",
  "heat-engine-restarted",
];

const MAGNUM_SCENES: ReadonlyArray<string> = [
  "magnum-baseline",
  "magnum-creating",
  "magnum-failed",
  "magnum-conductor-down",
  "magnum-real-image",
];

interface Answer {
  status: number;
  body: string;
}

function respond(answer: Answer): OpenStackHttpResponse {
  return {
    status: answer.status,
    headers: { date: "Thu, 05 Nov 2026 02:30:00 GMT" },
    body: answer.body,
  };
}

function tokenBody(catalog: Array<JSONObject>): JSONObject {
  return {
    token: {
      methods: ["application_credential"],
      expires_at: "2026-11-05T12:48:28.000000Z",
      issued_at: "2026-11-05T01:48:28.000000Z",
      project: {
        id: PROJECT,
        name: "admin",
        domain: { id: "default", name: "Default" },
      },
      roles: [{ id: "role-admin", name: "admin" }],
      user: { id: "monitoring-user", name: "oneuptime-monitoring" },
      catalog,
    },
  };
}

const CATALOG_KEYSTONE: JSONObject = {
  id: "keystone",
  name: "keystone",
  type: "identity",
  endpoints: [
    {
      id: "k",
      interface: "public",
      region: "RegionOne",
      region_id: "RegionOne",
      url: RECORDED_AUTH_URL,
    },
  ],
};

function catalogEntry(type: string, url: string): JSONObject {
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

const CATALOG: Array<JSONObject> = [
  CATALOG_KEYSTONE,
  catalogEntry("orchestration", HEAT_URL),
  catalogEntry("container-infra", MAGNUM_URL),
];

/*
 * A cloud answering as a recorded scene did: Keystone for a token, and the two services with what
 * they said. `override` answers a path differently, for what no scene holds; `requests` holds each
 * read, so what a collection costs can be counted exactly.
 */
function cloudOf(data: {
  scene?: RecordedScene | undefined;
  catalog?: Array<JSONObject> | undefined;
  override?:
    | ((path: string) => Answer | undefined)
    | undefined;
}): {
  transport: (request: OpenStackHttpRequest) => Promise<OpenStackHttpResponse>;
  requests: Array<string>;
} {
  const requests: Array<string> = [];
  const scene: RecordedScene | undefined = data.scene;

  const recorded: (call: string) => Answer | undefined = (
    call: string,
  ): Answer | undefined => {
    const text: string | undefined = scene?.api.get(call);
    return text === undefined
      ? undefined
      : { status: scene?.statuses.get(call) || 200, body: text };
  };

  return {
    requests,
    transport: async (
      request: OpenStackHttpRequest,
    ): Promise<OpenStackHttpResponse> => {
      const url: URL = new URL(request.url);
      const path: string = url.pathname;

      if (path.endsWith("/auth/tokens")) {
        return {
          status: 201,
          headers: { "x-subject-token": "a-token" },
          body: JSON.stringify(tokenBody(data.catalog || CATALOG)),
        };
      }

      requests.push(path);

      // Keystone's lists, which say nothing here, and answer as they would for a cloud with few.
      if (path.includes("/identity/v3/")) {
        const key: string = path.substring(path.lastIndexOf("/") + 1);
        return respond({ status: 200, body: JSON.stringify({ [key]: [] }) });
      }

      const answered: Answer | undefined = data.override?.(path);
      if (answered) {
        return respond(answered);
      }

      const call: string | undefined = {
        "/stacks": "heat-stacks-own",
        "/services": "heat-services",
        "/clusters": "magnum-clusters",
        "/clustertemplates": "magnum-clustertemplates",
        "/mservices": "magnum-services",
      }[path.substring(path.lastIndexOf("/"))];

      if (call && recorded(call)) {
        return respond(recorded(call) as Answer);
      }

      // One cluster's own read, recorded under its name.
      const uuid: string = path.substring(path.lastIndexOf("/") + 1);
      for (const name of scene?.api.keys() || []) {
        if (name.startsWith("magnum-cluster-")) {
          const own: JSONObject | undefined = recordedJson(
            scene as RecordedScene,
            name,
          );
          if (own?.["uuid"] === uuid) {
            return respond(recorded(name) as Answer);
          }
        }
      }

      return respond({ status: 404, body: '{"message": "Not found."}' });
    },
  };
}

async function collect(data: {
  scene?: RecordedScene | undefined;
  catalog?: Array<JSONObject> | undefined;
  override?: ((path: string) => Answer | undefined) | undefined;
  harness?: CollectorHarness | undefined;
}): Promise<{
  report: OpenStackCollectionReport;
  points: Array<ReportedDatapoint>;
  requests: Array<string>;
  harness: CollectorHarness;
}> {
  const cloud: ReturnType<typeof cloudOf> = cloudOf(data);
  const harness: CollectorHarness =
    data.harness ||
    createCollectorHarness({ transport: cloud.transport as never });
  if (data.harness) {
    data.harness.dependencies.createTransport = () => {
      return { transport: cloud.transport as never, close: () => {} };
    };
  }
  const report: OpenStackCollectionReport = await OpenStackCollector.collect(
    collectionJob({ authUrl: RECORDED_AUTH_URL }),
    harness.dependencies,
  );
  return {
    report,
    points: datapointsOf(report.resourceMetrics),
    requests: cloud.requests,
    harness,
  };
}

function pointsNamed(
  points: Array<ReportedDatapoint>,
  metric: string,
): Array<ReportedDatapoint> {
  return points.filter((point: ReportedDatapoint): boolean => {
    return point.metric === metric;
  });
}

function seriesNamed(
  scene: RecordedScene,
  metric: string,
): Array<PrometheusSeries> {
  return scene.exporter.filter((series: PrometheusSeries): boolean => {
    return series.name === metric;
  });
}

// The labels both say, in a comparable order: what only a probe adds is held to the catalogue below.
function withoutProbeLabels(
  metric: string,
  labels: Record<string, string>,
): Record<string, string> {
  const definition: OpenStackMetricDefinition | undefined =
    getOpenStackMetricByMetricName(metric);
  const kept: Record<string, string> = {};
  for (const key of Object.keys(labels).sort()) {
    if (
      !(definition?.probeOnlyAttributes || []).includes(key) &&
      key !== "openstack.region.name" &&
      key !== "openstack_service" &&
      labels[key]
    ) {
      kept[key] = labels[key] as string;
    }
  }
  return kept;
}

function comparableOfProbe(
  points: Array<ReportedDatapoint>,
  metric: string,
  // Magnum's project is what only a probe knows, though the exporter has the label: it sends it empty.
  ignoring: ReadonlyArray<string> = [],
): Array<string> {
  return pointsNamed(points, metric)
    .map((point: ReportedDatapoint): string => {
      const labels: Record<string, string> = withoutProbeLabels(
        metric,
        point.labels,
      );
      for (const key of ignoring) {
        delete labels[key];
      }
      return JSON.stringify({ labels, value: point.value });
    })
    .sort();
}

function comparableOfExporter(
  scene: RecordedScene,
  metric: string,
  ignoring: ReadonlyArray<string> = [],
): Array<string> {
  return seriesNamed(scene, metric)
    .map((series: PrometheusSeries): string => {
      const labels: Record<string, string> = withoutProbeLabels(
        metric,
        series.labels,
      );
      for (const key of ignoring) {
        delete labels[key];
      }
      return JSON.stringify({ labels, value: series.value });
    })
    .sort();
}

function rowsOf(report: OpenStackCollectionReport): {
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

describe("Heat, on what a real cloud said", () => {
  describe.each(HEAT_SCENES)("%s", (name: string) => {
    const scene: RecordedScene = loadScene(GROUP, name);

    test("every stack's series is the exporter's, with its value", async () => {
      const { points } = await collect({ scene });
      expect(
        comparableOfProbe(points, "openstack_heat_stack_status"),
      ).toEqual(comparableOfExporter(scene, "openstack_heat_stack_status"));
    });

    test("every word's count is the exporter's", async () => {
      const { points } = await collect({ scene });
      expect(
        comparableOfProbe(points, "openstack_heat_stack_status_counter"),
      ).toEqual(
        comparableOfExporter(scene, "openstack_heat_stack_status_counter"),
      );
    });

    test("its API reads as the exporter says", async () => {
      const { points } = await collect({ scene });
      expect(comparableOfProbe(points, "openstack_heat_up")).toEqual(
        comparableOfExporter(scene, "openstack_heat_up"),
      );
    });
  });

  test("heat-baseline: an admin's list holds every project, asked for with no paging and no global_tenant", async () => {
    const scene: RecordedScene = loadScene(GROUP, "heat-baseline");
    const seen: Array<string> = [];
    const { points, report } = await collect({
      scene,
      override: (path: string): undefined => {
        seen.push(path);
        return undefined;
      },
    });
    expect(
      new Set(
        pointsNamed(points, "openstack_heat_stack_status").map(
          (point: ReportedDatapoint): string => {
            return point.labels["project_id"] as string;
          },
        ),
      ).size,
    ).toBe(2);
    expect(seen.filter((path: string): boolean => {
      return path.endsWith("/stacks");
    })).toHaveLength(1);
    expect(JSON.stringify(report)).not.toContain("global_tenant");
  });

  test("why it failed, in Heat's own words, only a probe says", async () => {
    const { points } = await collect({
      scene: loadScene(GROUP, "heat-baseline"),
    });
    const failed: ReportedDatapoint | undefined = pointsNamed(
      points,
      "openstack_heat_stack_status",
    ).find((point: ReportedDatapoint): boolean => {
      return point.labels["name"] === "ou-stack-failed";
    });
    expect(failed?.labels["status_reason"]).toContain("No valid host was found");
    expect(
      getOpenStackMetricByMetricName(
        "openstack_heat_stack_status",
      )?.probeOnlyAttributes,
    ).toContain("status_reason");
  });

  test("every record of Heat's engines is a series, and one row per host", async () => {
    const { report, points } = await collect({
      scene: loadScene(GROUP, "heat-baseline"),
    });
    expect(pointsNamed(points, "openstack_heat_agent_state")).toHaveLength(2);
    const { rows } = rowsOf(report);
    const engines: Array<OpenStackResourceBufferEntry> = rows.filter(
      (row: OpenStackResourceBufferEntry): boolean => {
        return row.kind === OpenStackResourceKind.Service;
      },
    );
    expect(engines).toHaveLength(1);
    expect(engines[0]!.name).toBe("heat-engine");
    expect(engines[0]!.status).toBe("up");
    expect(engines[0]!.facts["family"]).toBe("orchestration");
  });

  describe.each(["heat-engine-down", "heat-api-down"])(
    "%s: nothing Heat lists can be read",
    (name: string) => {
      const scene: RecordedScene = loadScene(GROUP, name);

      test("its API reads down, as the exporter says, and nothing else is sent", async () => {
        const { points } = await collect({ scene });
        expect(
          pointsNamed(points, "openstack_heat_up").map(
            (point: ReportedDatapoint): number => {
              return point.value;
            },
          ),
        ).toEqual(
          seriesNamed(scene, "openstack_heat_up").map(
            (series: PrometheusSeries): number => {
              return series.value;
            },
          ),
        );
        expect(pointsNamed(points, "openstack_heat_up")[0]!.value).toBe(0);
        expect(pointsNamed(points, "openstack_heat_stack_status")).toEqual([]);
        expect(pointsNamed(points, "openstack_heat_agent_state")).toEqual([]);
      });

      test("the report says what failed, and is no secret's way out", async () => {
        const { report } = await collect({ scene });
        expect(report.status).not.toBe("Succeeded");
        expect(JSON.stringify(report)).not.toContain("Traceback");
      });
    },
  );
});

describe("Magnum, on what a real cloud said", () => {
  describe.each(MAGNUM_SCENES)("%s", (name: string) => {
    const scene: RecordedScene = loadScene(GROUP, name);

    test.each([
      "openstack_container_infra_total_clusters",
      "openstack_container_infra_cluster_status",
      "openstack_container_infra_cluster_masters",
      "openstack_container_infra_cluster_nodes",
    ])("%s is the exporter's, but for the project only a probe has", async (
      metric: string,
    ) => {
      const { points } = await collect({ scene });
      expect(comparableOfProbe(points, metric, ["project_id"])).toEqual(
        comparableOfExporter(scene, metric, ["project_id"]),
      );
    });

    test("its API reads as the exporter says", async () => {
      const { points } = await collect({ scene });
      expect(comparableOfProbe(points, "openstack_container_infra_up")).toEqual(
        comparableOfExporter(scene, "openstack_container_infra_up"),
      );
    });
  });

  test("magnum-failed: a cluster's own read says whose it is and why, in the row it fills", async () => {
    const { report } = await collect({
      scene: loadScene(GROUP, "magnum-failed"),
    });
    const { rows } = rowsOf(report);
    const failed: OpenStackResourceBufferEntry | undefined = rows.find(
      (row: OpenStackResourceBufferEntry): boolean => {
        return row.name === "ou-cluster-times-out";
      },
    );
    expect(failed?.kind).toBe(OpenStackResourceKind.ContainerCluster);
    expect(failed?.openStackProjectId).toBe(PROJECT);
    expect(failed?.status).toBe("CREATE_FAILED");
    expect(failed?.facts).toMatchObject({
      statusReason: "default-master failed, default-worker failed",
      healthStatus: "UNKNOWN",
      clusterTemplateId: "4203498b-8224-4477-b31e-bd0d55236ac6",
      clusterTemplateName: "ou-template",
      coeVersion: "v1.18.16",
      apiAddress: "https://:6443",
      stackId: "66b02f15-9492-45b2-84aa-a82a4edf21f7",
      nodeCount: 1,
      masterCount: 1,
    });
  });

  test("magnum-conductor-down: only here does a stopped conductor read down, with Magnum's API up", async () => {
    const { report, points } = await collect({
      scene: loadScene(GROUP, "magnum-conductor-down"),
    });
    expect(
      pointsNamed(points, "openstack_container_infra_up")[0]!.value,
    ).toBe(1);
    const conductor: ReportedDatapoint = pointsNamed(
      points,
      "openstack_container_infra_agent_state",
    )[0]!;
    expect(conductor.value).toBe(0);
    expect(conductor.labels).toMatchObject({
      hostname: "compute-01",
      service: "magnum-conductor",
      adminState: "enabled",
    });
    const row: OpenStackResourceBufferEntry | undefined = rowsOf(
      report,
    ).rows.find((one: OpenStackResourceBufferEntry): boolean => {
      return one.kind === OpenStackResourceKind.Service;
    });
    expect(row?.status).toBe("down");
    expect(row?.facts["family"]).toBe("container-infra");
  });

  test("magnum-api-down: its API reads down, and nothing else is sent", async () => {
    const { points } = await collect({
      scene: loadScene(GROUP, "magnum-api-down"),
    });
    expect(
      pointsNamed(points, "openstack_container_infra_up")[0]!.value,
    ).toBe(0);
    expect(
      pointsNamed(points, "openstack_container_infra_cluster_status"),
    ).toEqual([]);
  });

  test("is asked at the microversion the recordings were read at", async () => {
    const seen: Array<OpenStackHttpRequest> = [];
    const scene: RecordedScene = loadScene(GROUP, "magnum-failed");
    const cloud: ReturnType<typeof cloudOf> = cloudOf({ scene });
    const harness: CollectorHarness = createCollectorHarness({
      transport: (async (request: OpenStackHttpRequest) => {
        seen.push(request);
        return await cloud.transport(request);
      }) as never,
    });
    await OpenStackCollector.collect(collectionJob(), harness.dependencies);
    const clusters: OpenStackHttpRequest | undefined = seen.find(
      (request: OpenStackHttpRequest): boolean => {
        return request.url.includes("/clusters");
      },
    );
    expect(clusters?.headers?.["OpenStack-API-Version"]).toBe(
      "container-infra latest",
    );
  });
});

describe("what one cluster's own read costs", () => {
  function clusters(count: number, status: string = "CREATE_COMPLETE"): string {
    return JSON.stringify({
      clusters: Array.from({ length: count }, (_: unknown, index: number) => {
        return {
          uuid: `cluster-${index}`,
          name: `cluster-${index}`,
          status,
          stack_id: `stack-${index}`,
          node_count: 3,
          master_count: 1,
          health_status: "HEALTHY",
          cluster_template_id: "a-template",
        };
      }),
    });
  }

  function ownRead(path: string, status: string): Answer | undefined {
    const match: RegExpExecArray | null = /\/clusters\/(cluster-\d+)$/.exec(
      path,
    );
    return match
      ? {
          status: 200,
          body: JSON.stringify({
            uuid: match[1],
            status,
            project_id: "a-project",
            status_reason: null,
          }),
        }
      : undefined;
  }

  const readsOf: (requests: Array<string>) => number = (
    requests: Array<string>,
  ): number => {
    return requests.filter((path: string): boolean => {
      return /\/clusters\/cluster-\d+$/.test(path);
    }).length;
  };

  const heldToMagnum: Array<JSONObject> = [
    CATALOG_KEYSTONE,
    catalogEntry("container-infra", MAGNUM_URL),
  ];

  // The cadence of what is read every five minutes: a later collection is due again.
  function due(harness: CollectorHarness): void {
    harness.clock.advance(6 * 60_000);
  }

  test("each is read once, and not again while its status holds", async () => {
    const first: Awaited<ReturnType<typeof collect>> = await collect({
      catalog: heldToMagnum,
      override: (path: string): Answer | undefined => {
        return path.endsWith("/clusters")
          ? { status: 200, body: clusters(3) }
          : ownRead(path, "CREATE_COMPLETE");
      },
    });
    expect(readsOf(first.requests)).toBe(3);

    due(first.harness);
    const second: Awaited<ReturnType<typeof collect>> = await collect({
      catalog: heldToMagnum,
      harness: first.harness,
      override: (path: string): Answer | undefined => {
        return path.endsWith("/clusters")
          ? { status: 200, body: clusters(3) }
          : ownRead(path, "CREATE_COMPLETE");
      },
    });
    expect(second.requests.length).toBeGreaterThan(0);
    expect(readsOf(second.requests)).toBe(0);
    // What was read stays on its series.
    expect(
      pointsNamed(second.points, "openstack_container_infra_cluster_status")[0]!
        .labels["project_id"],
    ).toBe("a-project");
  });

  test("a change of status reads it again, and only those", async () => {
    const first: Awaited<ReturnType<typeof collect>> = await collect({
      catalog: heldToMagnum,
      override: (path: string): Answer | undefined => {
        return path.endsWith("/clusters")
          ? { status: 200, body: clusters(3) }
          : ownRead(path, "CREATE_COMPLETE");
      },
    });
    due(first.harness);
    const list: JSONObject = JSON.parse(clusters(3)) as JSONObject;
    ((list["clusters"] as JSONArray)[1] as JSONObject)["status"] =
      "UPDATE_FAILED";
    const second: Awaited<ReturnType<typeof collect>> = await collect({
      catalog: heldToMagnum,
      harness: first.harness,
      override: (path: string): Answer | undefined => {
        return path.endsWith("/clusters")
          ? { status: 200, body: JSON.stringify(list) }
          : ownRead(path, "UPDATE_FAILED");
      },
    });
    expect(readsOf(second.requests)).toBe(1);
  });

  test("however many there are, one collection reads a bounded number, and the next reads on", async () => {
    const count: number = MAGNUM_CLUSTER_READS_PER_COLLECTION + 10;
    const answer: (path: string) => Answer | undefined = (
      path: string,
    ): Answer | undefined => {
      return path.endsWith("/clusters")
        ? { status: 200, body: clusters(count) }
        : ownRead(path, "CREATE_COMPLETE");
    };
    const first: Awaited<ReturnType<typeof collect>> = await collect({
      catalog: heldToMagnum,
      override: answer,
    });
    expect(readsOf(first.requests)).toBe(MAGNUM_CLUSTER_READS_PER_COLLECTION);
    // Every cluster is still there, those not read yet with nothing about whose.
    expect(
      pointsNamed(first.points, "openstack_container_infra_cluster_status"),
    ).toHaveLength(count);

    due(first.harness);
    const second: Awaited<ReturnType<typeof collect>> = await collect({
      catalog: heldToMagnum,
      harness: first.harness,
      override: answer,
    });
    expect(readsOf(second.requests)).toBe(10);
  });

  test("access rules that don't name one cluster's read cost one try, and nothing else goes", async () => {
    const { requests, points, report } = await collect({
      catalog: heldToMagnum,
      override: (path: string): Answer | undefined => {
        if (/\/clusters\/cluster-\d+$/.test(path)) {
          return { status: 403, body: "{}" };
        }
        return path.endsWith("/clusters")
          ? { status: 200, body: clusters(5) }
          : undefined;
      },
    });
    expect(readsOf(requests)).toBe(1);
    expect(
      pointsNamed(points, "openstack_container_infra_cluster_status"),
    ).toHaveLength(5);
    expect(report.summary?.warnings).toEqual([]);
  });
});

describe("a credential Heat or Magnum holds things back from", () => {
  test("refused Heat's stacks, its API still reads up, and the report says so", async () => {
    const { points, report } = await collect({
      catalog: [CATALOG_KEYSTONE, catalogEntry("orchestration", HEAT_URL)],
      override: (): Answer => {
        return { status: 403, body: '{"code": 403, "title": "Forbidden"}' };
      },
    });
    expect(pointsNamed(points, "openstack_heat_up")[0]!.value).toBe(1);
    expect(pointsNamed(points, "openstack_heat_stack_status")).toEqual([]);
    expect(report.summary?.warnings.join(" ")).toContain("stacks");
  });

  test("refused only Heat's engines, a credential that isn't an admin hears nothing of it", async () => {
    const scene: RecordedScene = loadScene(GROUP, "heat-baseline");
    const { points, report } = await collect({
      scene,
      catalog: [CATALOG_KEYSTONE, catalogEntry("orchestration", HEAT_URL)],
      override: (path: string): Answer | undefined => {
        return path.endsWith("/services")
          ? { status: 403, body: "{}" }
          : undefined;
      },
    });
    expect(pointsNamed(points, "openstack_heat_agent_state")).toEqual([]);
    expect(pointsNamed(points, "openstack_heat_up")[0]!.value).toBe(1);
    expect(report.summary?.warnings).toEqual([]);
    expect(report.status).toBe("Succeeded");
  });

  test("a stack with no project on it, as a plain reader gets, sends no such label", async () => {
    const { points } = await collect({
      catalog: [CATALOG_KEYSTONE, catalogEntry("orchestration", HEAT_URL)],
      override: (path: string): Answer | undefined => {
        return path.endsWith("/stacks")
          ? {
              status: 200,
              body: JSON.stringify({
                stacks: [
                  {
                    id: "a-stack",
                    stack_name: "a-stack",
                    stack_status: "CREATE_FAILED",
                  },
                ],
              }),
            }
          : { status: 403, body: "{}" };
      },
    });
    const [stack]: Array<ReportedDatapoint> = pointsNamed(
      points,
      "openstack_heat_stack_status",
    );
    expect(stack!.labels["project_id"]).toBeUndefined();
    expect(stack!.value).toBe(4);
  });

  test("a word the exporter's source doesn't know reads as it does, and is still the word", async () => {
    const { points } = await collect({
      catalog: [CATALOG_KEYSTONE, catalogEntry("orchestration", HEAT_URL)],
      override: (path: string): Answer | undefined => {
        return path.endsWith("/stacks")
          ? {
              status: 200,
              body: JSON.stringify({
                stacks: [
                  {
                    id: "a-stack",
                    stack_name: "a-stack",
                    stack_status: "NEW_WORD",
                  },
                ],
              }),
            }
          : { status: 403, body: "{}" };
      },
    });
    const [stack]: Array<ReportedDatapoint> = pointsNamed(
      points,
      "openstack_heat_stack_status",
    );
    expect(stack!.value).toBe(-1);
    expect(stack!.labels["status"]).toBe("NEW_WORD");
  });
});

describe("a cloud that doesn't run either", () => {
  const WITHOUT: Array<JSONObject> = [CATALOG_KEYSTONE];

  test("isn't asked about them at all", async () => {
    const { requests } = await collect({ catalog: WITHOUT });
    expect(
      requests.filter((path: string): boolean => {
        return /stacks|clusters|services/.test(path) && !path.includes("/v3");
      }),
    ).toEqual([]);
  });

  test("hears nothing of them in the report", async () => {
    const { report } = await collect({ catalog: WITHOUT });
    expect(
      (report.summary?.services || []).map((service: { service: string }) => {
        return service.service;
      }),
    ).not.toEqual(expect.arrayContaining(["orchestration"]));
    expect(JSON.stringify(report.summary)).not.toContain("container-infra");
  });

  test("sends what an agent's empty scrape sends, which can't make a row, and no _up", async () => {
    const { report, points } = await collect({ catalog: WITHOUT });
    expect(pointsNamed(points, "openstack_heat_up")).toEqual([]);
    expect(pointsNamed(points, "openstack_container_infra_up")).toEqual([]);

    const { rows, scrapes } = rowsOf(report);
    expect(
      rows.filter((row: OpenStackResourceBufferEntry): boolean => {
        return row.name === "orchestration" || row.name === "container-infra";
      }),
    ).toEqual([]);
    expect(scrapes.get("RegionOne/orchestration")).toMatchObject({
      answered: true,
      samples: 0,
    });
  });

  test("the same two series a real agent sent for a service its cloud didn't run", () => {
    const real: string = JSON.stringify(loadCollectorExport(GROUP));
    expect(real).toContain('"dns"');
  });
});

describe("how often", () => {
  test("once in five minutes, as the agent's jobs read them, however often the rest are read", async () => {
    const scene: RecordedScene = loadScene(GROUP, "heat-baseline");
    const first: Awaited<ReturnType<typeof collect>> = await collect({
      scene,
      catalog: [CATALOG_KEYSTONE, catalogEntry("orchestration", HEAT_URL)],
    });
    expect(first.requests.length).toBeGreaterThan(0);

    first.harness.clock.advance(2 * 60_000);
    const second: Awaited<ReturnType<typeof collect>> = await collect({
      scene,
      catalog: [CATALOG_KEYSTONE, catalogEntry("orchestration", HEAT_URL)],
      harness: first.harness,
    });
    expect(
      second.requests.filter((path: string): boolean => {
        return path.endsWith("/stacks");
      }),
    ).toEqual([]);

    first.harness.clock.advance(4 * 60_000);
    const third: Awaited<ReturnType<typeof collect>> = await collect({
      scene,
      catalog: [CATALOG_KEYSTONE, catalogEntry("orchestration", HEAT_URL)],
      harness: first.harness,
    });
    expect(
      third.requests.filter((path: string): boolean => {
        return path.endsWith("/stacks");
      }),
    ).toHaveLength(1);
  });
});

describe("the connection test", () => {
  async function test_(catalog: Array<JSONObject>): Promise<{
    reads: Array<OpenStackAccessRead>;
  }> {
    const cloud: ReturnType<typeof cloudOf> = cloudOf({
      scene: loadScene(GROUP, "heat-baseline"),
      catalog,
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport as never,
    });
    const report: OpenStackConnectionTestReport = await OpenStackCollector.test(
      connectionTestJob({ authUrl: RECORDED_AUTH_URL }),
      harness.dependencies,
    );
    return { reads: report.summary?.reads || [] };
  }

  test("a cloud that doesn't run them hears nothing of them", async () => {
    const { reads } = await test_([CATALOG_KEYSTONE]);
    expect(reads.length).toBeGreaterThan(0);
    expect(
      reads.filter((read: OpenStackAccessRead): boolean => {
        return (
          read.service === "orchestration" || read.service === "container-infra"
        );
      }),
    ).toEqual([]);
  });

  test("one that does is asked, and what an admin reads says so", async () => {
    const { reads } = await test_([
      CATALOG_KEYSTONE,
      catalogEntry("orchestration", HEAT_URL),
    ]);
    const stacks: OpenStackAccessRead | undefined = reads.find(
      (read: OpenStackAccessRead): boolean => {
        return read.service === "orchestration" && read.read === "stacks";
      },
    );
    expect(stacks?.access).toBe("ReadsEverything");
  });
});
