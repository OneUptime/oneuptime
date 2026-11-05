import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import OpenStackProbeMetrics from "Common/Server/Utils/OpenStack/OpenStackProbeMetrics";
import {
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  isOpenStackSnapshotDatapoint,
} from "Common/Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  OpenStackCollectionReport,
  OpenStackConnectionTestReport,
  OpenStackServiceSummary,
} from "Common/Types/OpenStack/OpenStackProbeCollection";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import { classifyAccessList } from "../../../Utils/OpenStack/OpenStackAccessCheck";
import OpenStackCollector from "../../../Utils/OpenStack/OpenStackCollector";
import {
  IRONIC_MICROVERSION,
  IRONIC_NODE_FIELDS,
} from "../../../Utils/OpenStack/Collectors/BareMetalCollector";
import {
  OpenStackHttpRequest,
  OpenStackHttpResponse,
} from "../../../Utils/OpenStack/OpenStackHttp";
import { toOpenStackServiceBaseUrl } from "../../../Utils/OpenStack/OpenStackCatalog";
import {
  collectionJob,
  connectionTestJob,
  createCollectorHarness,
  datapointsOf,
  ReportedDatapoint,
} from "./Helpers/CollectorHarness";
import {
  FIXTURES_ROOT,
  PrometheusSeries,
  RECORDED_REGION,
  RecordedCloud,
  RecordedScene,
  createRecordedCloud,
  jsonAnswer,
  loadScene,
  parsePrometheusText,
  recordedTokenBody,
} from "./Helpers/RecordedCloud";

/*
 * What a probe reads of Ironic, on what a real one answered.
 *
 * Fixtures/OpenStack/services-ironic holds what Ironic's API and the agent's exporter each said in
 * one scene of a real DevStack, with fake hardware: so what the probe makes of the one can be held
 * to the other, label by label, and to what the server's scan makes of it. The rest of the cloud is
 * a recording of a cloud of the same release, which is what the token's catalog names, with Ironic
 * added. So the scenes here are real for Ironic, and the catalog entry and its path are the rig's.
 *
 * Written by hand, because nothing recorded holds them, and each says so: a list of conductors that
 * answers (a project is refused it), and Nova's hypervisor list with a node in it.
 */

const CLOUD: RecordedScene = loadScene("gazpacho-ovn", "healthy");
const SCENES: ReadonlyArray<string> = [
  "half-enrolled",
  "maintenance",
  "clean-failed",
  "wait-call-back",
  "deploy-failed",
];

const NODE_ID: string = "1062b540-62b5-44a7-805f-212d8778807c";

function ironicFile(scene: string, call: string): string {
  return fs.readFileSync(
    path.join(FIXTURES_ROOT, "services-ironic", scene, "api", `${call}.json`),
    "utf8",
  );
}

// What each of a scene's calls answered, by its status on record.
function ironicStatus(scene: string, call: string): number {
  for (const line of fs
    .readFileSync(
      path.join(FIXTURES_ROOT, "services-ironic", scene, "api-status.txt"),
      "utf8",
    )
    .split("\n")) {
    const [status, name] = line.split(" ");
    if (name === call) {
      return Number(status);
    }
  }
  throw new Error(`${scene} recorded no ${call}`);
}

function ironicAnswer(scene: string, call: string): OpenStackHttpResponse {
  return {
    status: ironicStatus(scene, call),
    headers: { date: "Wed, 04 Nov 2026 11:50:00 GMT" },
    body: ironicFile(scene, call),
  };
}

function catalogWithIronic(): JSONObject {
  const token: JSONObject = recordedTokenBody(CLOUD)["token"] as JSONObject;

  return {
    catalog: [
      ...(token["catalog"] as JSONArray),
      {
        id: "ironic",
        name: "ironic",
        type: "baremetal",
        endpoints: [
          {
            id: "ironic-public",
            interface: "public",
            region: RECORDED_REGION,
            region_id: RECORDED_REGION,
            url: "https://openstack.example/baremetal",
          },
        ],
      },
    ],
  };
}

interface Collected {
  report: OpenStackCollectionReport;
  points: Array<ReportedDatapoint>;
  cloud: RecordedCloud;
  requests: Array<OpenStackHttpRequest>;
}

async function collect(data: {
  // What Ironic answers, by the path's end. Nothing for a cloud without it in the catalog.
  ironic?:
    | ((pathname: string) => OpenStackHttpResponse | undefined)
    | undefined;
  answer?:
    | ((request: OpenStackHttpRequest) => OpenStackHttpResponse | undefined)
    | undefined;
}): Promise<Collected> {
  const requests: Array<OpenStackHttpRequest> = [];

  const cloud: RecordedCloud = createRecordedCloud(CLOUD, {
    tokenOverrides: data.ironic ? catalogWithIronic() : undefined,
    answer: (
      request: OpenStackHttpRequest,
    ): OpenStackHttpResponse | undefined => {
      const pathname: string = new URL(request.url).pathname;

      if (pathname.startsWith("/baremetal/")) {
        requests.push(request);
        return (
          data.ironic?.(pathname.substring("/baremetal".length)) ||
          jsonAnswer(404, {})
        );
      }

      return data.answer?.(request);
    },
  });

  const report: OpenStackCollectionReport = await OpenStackCollector.collect(
    collectionJob(),
    createCollectorHarness({ transport: cloud.transport }).dependencies,
  );

  return {
    report,
    points: datapointsOf(report.resourceMetrics),
    cloud,
    requests,
  };
}

function ironicAsRecorded(
  scene: string,
): (pathname: string) => OpenStackHttpResponse | undefined {
  return (pathname: string): OpenStackHttpResponse | undefined => {
    if (pathname === "/v1/nodes") {
      return ironicAnswer(scene, "ironic-nodes");
    }
    if (pathname === "/v1/conductors") {
      return ironicAnswer(scene, "ironic-conductors");
    }
    return undefined;
  };
}

// What ingest makes of a collection: the same walk OtelMetricsIngestService makes.
function rowsOf(
  report: OpenStackCollectionReport,
): Array<OpenStackResourceBufferEntry> {
  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();
  const prepared: JSONArray = OpenStackProbeMetrics.prepare({
    resourceMetrics: report.resourceMetrics,
    cloudName: "devstack",
  }).resourceMetrics;

  for (const resource of prepared as Array<JSONObject>) {
    for (const scope of resource["scopeMetrics"] as Array<JSONObject>) {
      for (const metric of scope["metrics"] as Array<JSONObject>) {
        const body: JSONObject = (metric["gauge"] ||
          metric["sum"]) as JSONObject;
        for (const point of body["dataPoints"] as Array<JSONObject>) {
          const metricName: string = metric["name"] as string;
          if (isOpenStackSnapshotDatapoint({ metricName, datapoint: point })) {
            bufferOpenStackSnapshotMetric({
              metricName,
              datapoint: point,
              buffer,
            });
          }
        }
      }
    }
  }

  return finishOpenStackBatch(buffer.values());
}

function ofKind(
  rows: Array<OpenStackResourceBufferEntry>,
  kind: OpenStackResourceKind,
): Array<OpenStackResourceBufferEntry> {
  return rows.filter((row: OpenStackResourceBufferEntry): boolean => {
    return row.kind === kind;
  });
}

function pointsNamed(
  points: Array<ReportedDatapoint>,
  metric: string,
): Array<ReportedDatapoint> {
  return points.filter((point: ReportedDatapoint): boolean => {
    return point.metric === metric;
  });
}

function summaryOf(
  report: OpenStackCollectionReport,
): OpenStackServiceSummary | undefined {
  return report.summary?.services.find(
    (one: OpenStackServiceSummary): boolean => {
      return one.service === OpenStackServiceType.BareMetal;
    },
  );
}

function exporterSeries(scene: string): Array<PrometheusSeries> {
  return parsePrometheusText(
    fs.readFileSync(
      path.join(
        FIXTURES_ROOT,
        "services-ironic",
        scene,
        "exporter",
        "baremetal.prom",
      ),
      "utf8",
    ),
    "baremetal",
  );
}

describe("a cloud without Ironic shows no trace of it", () => {
  test("nothing is asked, nothing is said, and no series names it", async () => {
    const { report, points, requests } = await collect({});

    expect(requests).toEqual([]);
    expect(summaryOf(report)).toBeUndefined();
    expect(
      points.filter((point: ReportedDatapoint): boolean => {
        return point.metric.startsWith("openstack_ironic_");
      }),
    ).toEqual([]);
    /*
     * What the receiver says of a scrape, as the agent's does for a job with nothing to read. It is
     * what the scan never makes a row from, which the rows below hold.
     */
    expect(
      ofKind(rowsOf(report), OpenStackResourceKind.Api).filter(
        (row: OpenStackResourceBufferEntry): boolean => {
          return row.name === OpenStackServiceType.BareMetal;
        },
      ),
    ).toEqual([]);
    expect(ofKind(rowsOf(report), OpenStackResourceKind.BareMetalNode)).toEqual(
      [],
    );
  });

  test("a connection test lists no read of it", async () => {
    const cloud: RecordedCloud = createRecordedCloud(CLOUD);
    const report: OpenStackConnectionTestReport = await OpenStackCollector.test(
      connectionTestJob(),
      createCollectorHarness({ transport: cloud.transport }).dependencies,
    );

    expect(report.summary).toBeDefined();
    expect(JSON.stringify(report.summary)).not.toContain("baremetal");
  });
});

describe("what it asks Ironic, on a cloud that has it", () => {
  test("its nodes by field, and never what says how to reach a controller", async () => {
    const { requests } = await collect({
      ironic: ironicAsRecorded("half-enrolled"),
    });
    const nodes: OpenStackHttpRequest = requests.find(
      (request: OpenStackHttpRequest): boolean => {
        return new URL(request.url).pathname === "/baremetal/v1/nodes";
      },
    ) as OpenStackHttpRequest;
    const fields: string = new URL(nodes.url).searchParams.get(
      "fields",
    ) as string;

    expect(fields.split(",")).toEqual(IRONIC_NODE_FIELDS);
    for (const secret of ["driver_info", "instance_info", "extra"]) {
      expect(fields.split(",")).not.toContain(secret);
    }
    expect(nodes.headers["X-OpenStack-Ironic-API-Version"]).toBe(
      IRONIC_MICROVERSION,
    );
  });

  test("two requests, whatever else the cloud holds", async () => {
    const { requests } = await collect({
      ironic: ironicAsRecorded("deploy-failed"),
    });

    expect(
      requests
        .map((request: OpenStackHttpRequest): string => {
          return new URL(request.url).pathname;
        })
        .sort(),
    ).toEqual(["/baremetal/v1/conductors", "/baremetal/v1/nodes"]);
  });

  test("a second page is asked for by the last node's UUID, as Ironic pages them", async () => {
    const answers: Array<string | null> = [];
    const allNodes: Array<JSONObject> = (
      JSON.parse(ironicFile("deploy-failed", "ironic-nodes")) as {
        nodes: Array<JSONObject>;
      }
    ).nodes;

    await collect({
      ironic: (pathname: string) => {
        if (pathname !== "/v1/nodes") {
          return ironicAnswer("deploy-failed", "ironic-conductors");
        }
        return jsonAnswer(200, {
          nodes:
            answers.length === 0 ? allNodes.slice(0, 2) : allNodes.slice(2),
          ...(answers.push("page") === 1
            ? { next: "https://openstack.example/baremetal/v1/nodes?marker=x" }
            : {}),
        });
      },
    });

    expect(answers.length).toBe(2);
  });

  test("a catalog that says /v1 itself is asked for one /v1", () => {
    expect(
      toOpenStackServiceBaseUrl(
        OpenStackServiceType.BareMetal,
        "https://openstack.example:6385/v1/",
      ),
    ).toBe("https://openstack.example:6385");
    expect(
      toOpenStackServiceBaseUrl(
        OpenStackServiceType.BareMetal,
        "https://openstack.example/baremetal",
      ),
    ).toBe("https://openstack.example/baremetal");
  });
});

describe("what it sends is what the agent's exporter sent, in the same scene", () => {
  test.each(SCENES)(
    "%s: every node's every label the exporter has, and its value",
    async (scene: string) => {
      const { points } = await collect({ ironic: ironicAsRecorded(scene) });
      const said: Array<PrometheusSeries> = exporterSeries(scene).filter(
        (one: PrometheusSeries): boolean => {
          return one.name === "openstack_ironic_node";
        },
      );

      expect(said.length).toBeGreaterThan(0);
      expect(pointsNamed(points, "openstack_ironic_node").length).toBe(
        said.length,
      );

      for (const line of said) {
        const point: ReportedDatapoint | undefined = pointsNamed(
          points,
          "openstack_ironic_node",
        ).find((one: ReportedDatapoint): boolean => {
          return one.labels["id"] === line.labels["id"];
        });

        expect(point?.value).toBe(line.value);

        for (const label of Object.keys(line.labels)) {
          // In a node's driver_info, which a probe does not read, and empty on every recording.
          if (label === "deploy_kernel" || label === "deploy_ramdisk") {
            continue;
          }
          expect({
            label,
            value: point?.labels[label] ?? "",
          }).toEqual({ label, value: line.labels[label] });
        }
      }
    },
  );

  test.each(SCENES)(
    "%s: when Ironic last saw each node move",
    async (scene: string) => {
      const { points } = await collect({ ironic: ironicAsRecorded(scene) });
      const said: Array<PrometheusSeries> = exporterSeries(scene).filter(
        (one: PrometheusSeries): boolean => {
          return one.name === "openstack_ironic_node_provision_updated_at";
        },
      );

      expect(
        pointsNamed(points, "openstack_ironic_node_provision_updated_at")
          .length,
      ).toBe(said.length);

      for (const line of said) {
        expect(
          pointsNamed(
            points,
            "openstack_ironic_node_provision_updated_at",
          ).find((one: ReportedDatapoint): boolean => {
            return one.labels["id"] === line.labels["id"];
          })?.value,
        ).toBe(line.value);
      }
    },
  );

  test.each(SCENES)(
    "%s: it says its API is up, as the exporter does",
    async (scene: string) => {
      const { points } = await collect({ ironic: ironicAsRecorded(scene) });

      expect(pointsNamed(points, "openstack_ironic_up")[0]?.value).toBe(1);
    },
  );

  test.each(SCENES)(
    "%s: the rows are what the exporter's are, as far as it says",
    async (scene: string) => {
      const { report } = await collect({ ironic: ironicAsRecorded(scene) });
      const said: Array<PrometheusSeries> = exporterSeries(scene).filter(
        (one: PrometheusSeries): boolean => {
          return one.name === "openstack_ironic_node";
        },
      );
      const rows: Array<OpenStackResourceBufferEntry> = ofKind(
        rowsOf(report),
        OpenStackResourceKind.BareMetalNode,
      );

      expect(rows.length).toBe(said.length);

      for (const line of said) {
        const row: OpenStackResourceBufferEntry | undefined = rows.find(
          (one: OpenStackResourceBufferEntry): boolean => {
            return one.externalId === line.labels["id"];
          },
        );

        expect({
          status: row?.status,
          reason: row?.disabledReason,
          powerState: row?.facts["powerState"],
          resourceClass: row?.facts["resourceClass"],
        }).toEqual({
          status: line.labels["provision_state"],
          reason: line.labels["maintenance_reason"] || null,
          powerState: line.labels["power_state"] || null,
          resourceClass: line.labels["resource_class"] || null,
        });
      }
    },
  );
});

describe("what only a probe says of a node, from Ironic's own answer", () => {
  test("its driver, its owner and its conductor", async () => {
    const { report } = await collect({
      ironic: ironicAsRecorded("deploy-failed"),
    });

    for (const row of ofKind(
      rowsOf(report),
      OpenStackResourceKind.BareMetalNode,
    )) {
      expect(row.facts["driver"]).toBe("fake-hardware");
      expect(row.facts["conductor"]).toBe("compute-01");
      expect(row.openStackProjectId).toBe("cc8bdebd938940c0a22ed92aab43840c");
    }
  });

  test("why the deploy failed, while Ironic still says it", async () => {
    const { report } = await collect({
      ironic: ironicAsRecorded("deploy-failed"),
    });
    const node: OpenStackResourceBufferEntry = ofKind(
      rowsOf(report),
      OpenStackResourceKind.BareMetalNode,
    ).find((row: OpenStackResourceBufferEntry): boolean => {
      return row.name === "ou-node-deploy-failed";
    }) as OpenStackResourceBufferEntry;

    expect(node.facts["lastError"]).toContain(
      "Timeout reached while waiting for callback",
    );
    expect(node.facts["lastErrorReadAt"]).toBeTruthy();
  });

  test("and none written over it once Ironic has emptied it, with the node still failed", async () => {
    // Recorded: clean failed said why in its own scene, and in the next had nothing to say.
    const { report } = await collect({
      ironic: ironicAsRecorded("deploy-failed"),
    });
    const node: OpenStackResourceBufferEntry = ofKind(
      rowsOf(report),
      OpenStackResourceKind.BareMetalNode,
    ).find((row: OpenStackResourceBufferEntry): boolean => {
      return row.name === "ou-node-clean-failed";
    }) as OpenStackResourceBufferEntry;

    expect(node.status).toBe("clean failed");
    expect(node.facts).not.toHaveProperty("lastError");
  });

  test("the reason it did give, in the scene it gave it", async () => {
    const { report } = await collect({
      ironic: ironicAsRecorded("clean-failed"),
    });
    const node: OpenStackResourceBufferEntry = ofKind(
      rowsOf(report),
      OpenStackResourceKind.BareMetalNode,
    ).find((row: OpenStackResourceBufferEntry): boolean => {
      return row.name === "ou-node-clean-failed";
    }) as OpenStackResourceBufferEntry;

    expect(node.facts["lastError"]).toBeTruthy();
  });

  test("a label is cut at what a label holds, and what's long reads on", async () => {
    const { points } = await collect({
      ironic: (pathname: string) => {
        return pathname === "/v1/nodes"
          ? jsonAnswer(200, {
              nodes: [
                {
                  uuid: NODE_ID,
                  provision_state: "clean failed",
                  driver: "ipmi",
                  last_error: "x".repeat(16 * 1024 * 1024),
                },
              ],
            })
          : jsonAnswer(403, {});
      },
    });

    expect(
      (
        pointsNamed(points, "openstack_ironic_node")[0]?.labels["last_error"] ||
        ""
      ).length,
    ).toBeLessThanOrEqual(1024);
  });
});

describe("what a credential's scope decides", () => {
  test("a project is refused the conductors, recorded, and that is no failure of anything", async () => {
    const { report, points } = await collect({
      ironic: ironicAsRecorded("deploy-failed"),
    });

    expect(ironicStatus("deploy-failed", "ironic-conductors")).toBe(403);
    expect(pointsNamed(points, "openstack_ironic_agent_state")).toEqual([]);
    expect(pointsNamed(points, "openstack_ironic_up")[0]?.value).toBe(1);
    expect(summaryOf(report)?.errorCode).toBeUndefined();
    expect(JSON.stringify(report.summary?.warnings || [])).not.toContain(
      "conductors",
    );
    // And its nodes read without them.
    expect(
      ofKind(rowsOf(report), OpenStackResourceKind.BareMetalNode).length,
    ).toBe(5);
  });

  test("a credential that may reads them: written by hand, as no recording holds one yet", async () => {
    const { report } = await collect({
      ironic: (pathname: string) => {
        return pathname === "/v1/conductors"
          ? jsonAnswer(200, {
              conductors: [
                { hostname: "conductor-1", conductor_group: "", alive: true },
                {
                  hostname: "conductor-2",
                  conductor_group: "rack-a",
                  alive: false,
                },
              ],
            })
          : ironicAnswer("half-enrolled", "ironic-nodes");
      },
    });

    const conductors: Array<OpenStackResourceBufferEntry> = ofKind(
      rowsOf(report),
      OpenStackResourceKind.Service,
    ).filter((row: OpenStackResourceBufferEntry): boolean => {
      return row.facts["family"] === "baremetal";
    });

    expect(
      conductors
        .map((row: OpenStackResourceBufferEntry): Array<unknown> => {
          return [row.name, row.facts["host"], row.status];
        })
        .sort(),
    ).toEqual([
      ["ironic-conductor", "conductor-1", "up"],
      ["ironic-conductor", "conductor-2", "down"],
    ]);
  });

  test("the access check tells a project's own view from everyone's, on the recording", () => {
    const nodes: JSONObject = JSON.parse(
      ironicFile("deploy-failed", "ironic-nodes"),
    ) as JSONObject;

    expect(
      classifyAccessList({
        body: nodes,
        key: "nodes",
        projectField: "owner?",
        ownProjectId: "cc8bdebd938940c0a22ed92aab43840c",
        hasAdminRole: true,
      }).access,
    ).toBe("OwnProjectOnly");
  });

  test.each([
    [
      "nobody's nodes, which Ironic shows no project",
      [null, null],
      "ReadsEverything",
    ],
    ["two projects' nodes", ["own", "other"], "ReadsEverything"],
    ["another project's alone", ["other"], "ReadsEverything"],
    ["its own alone", ["own", "own"], "OwnProjectOnly"],
    ["none at all, and no admin role to go by", [], "OwnProjectOnly"],
  ] as Array<[string, Array<string | null>, string]>)(
    "%s",
    (_name: string, owners: Array<string | null>, access: string) => {
      expect(
        classifyAccessList({
          body: {
            nodes: owners.map((owner: string | null): JSONObject => {
              return { uuid: "n", owner };
            }),
          },
          key: "nodes",
          projectField: "owner?",
          ownProjectId: "own",
          hasAdminRole: false,
        }).access,
      ).toBe(access);
    },
  );
});

describe("Ironic's API stopped, which only a probe can tell from a cloud without it", () => {
  test("it reads 0, and no node has gone anywhere", async () => {
    const { report, points } = await collect({
      ironic: ironicAsRecorded("api-down"),
    });

    expect(ironicStatus("api-down", "ironic-nodes")).toBe(503);
    expect(pointsNamed(points, "openstack_ironic_up")[0]?.value).toBe(0);
    expect(pointsNamed(points, "openstack_ironic_node")).toEqual([]);

    const api: OpenStackResourceBufferEntry | undefined = ofKind(
      rowsOf(report),
      OpenStackResourceKind.Api,
    ).find((row: OpenStackResourceBufferEntry): boolean => {
      return row.name === OpenStackServiceType.BareMetal;
    });

    expect(api?.status).toBe("down");
    // What the stale-row rule measures from: a read that failed vouches for nothing.
    expect(api?.facts).not.toHaveProperty("vouchedAt");
  });

  test("the rest of the cloud reads on", async () => {
    const { points } = await collect({ ironic: ironicAsRecorded("api-down") });

    expect(pointsNamed(points, "openstack_nova_up")[0]?.value).toBe(1);
    expect(pointsNamed(points, "openstack_neutron_up")[0]?.value).toBe(1);
  });
});

/*
 * Nothing recorded holds Nova's hypervisor list with a node in it, so this is Nova's Ironic driver's
 * answer as its source writes it: the shape that broke other exporters (openstack-exporter issue 428),
 * with no cpu_info to parse and none of a host's numbers.
 */
describe("a node in Nova's list breaks nothing in a probe", () => {
  function withANode(
    request: OpenStackHttpRequest,
  ): OpenStackHttpResponse | undefined {
    if (!new URL(request.url).pathname.endsWith("/os-hypervisors/detail")) {
      return undefined;
    }
    const recorded: Array<JSONObject> = (
      JSON.parse(CLOUD.api.get("nova-hypervisors") as string) as {
        hypervisors: Array<JSONObject>;
      }
    ).hypervisors;
    return jsonAnswer(200, {
      hypervisors: [
        ...recorded,
        {
          id: "b1a2c3d4-0000-4000-8000-000000000001",
          hypervisor_hostname: NODE_ID,
          hypervisor_type: "ironic",
          hypervisor_version: 1,
          host_ip: "192.0.2.1",
          state: "up",
          status: "enabled",
          cpu_info: "",
          service: {
            id: "b1a2c3d4-0000-4000-8000-000000000002",
            host: "compute-01",
            disabled_reason: null,
          },
        },
      ],
    });
  }

  test("every host still reads, and Nova's API stays up", async () => {
    const without: Collected = await collect({});
    const withIt: Collected = await collect({ answer: withANode });

    expect(pointsNamed(withIt.points, "openstack_nova_up")[0]?.value).toBe(1);
    expect(
      ofKind(rowsOf(withIt.report), OpenStackResourceKind.Hypervisor)
        .map((row: OpenStackResourceBufferEntry): string | null => {
          return row.hypervisorName;
        })
        .sort(),
    ).toEqual(
      ofKind(rowsOf(without.report), OpenStackResourceKind.Hypervisor)
        .map((row: OpenStackResourceBufferEntry): string | null => {
          return row.hypervisorName;
        })
        .sort(),
    );
  });

  test("and the node is no hypervisor", async () => {
    const { report } = await collect({ answer: withANode });

    expect(
      ofKind(rowsOf(report), OpenStackResourceKind.Hypervisor).filter(
        (row: OpenStackResourceBufferEntry): boolean => {
          return row.hypervisorName === NODE_ID;
        },
      ),
    ).toEqual([]);
  });
});
