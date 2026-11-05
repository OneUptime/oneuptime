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
 * to the other, label by label, and to what the server's scan makes of it. Each was read twice, as a
 * project's admin and with system scope, which see different things. The rest of the cloud is a
 * recording of a cloud of the same release, which is what the token's catalog names, with Ironic
 * added. So the scenes here are real for Ironic and for Nova's list of its nodes, and the catalog
 * entry and its path are the rig's.
 */

type View = "a project's admin" | "system scope";

const CLOUD: RecordedScene = loadScene("gazpacho-ovn", "healthy");
const SCENES: ReadonlyArray<string> = [
  "baseline",
  "half-enrolled",
  "maintenance",
  "clean-failed",
  "wait-call-back",
  "deploy-failed",
  "power-off-while-active",
  "conductor-down",
  "recovered",
];
const VIEWS: ReadonlyArray<[string, View]> = SCENES.flatMap(
  (scene: string): Array<[string, View]> => {
    return [
      [scene, "a project's admin"],
      [scene, "system scope"],
    ];
  },
);

const NODE_ID: string = "1062b540-62b5-44a7-805f-212d8778807c";

function ironicFile(scene: string, call: string): string {
  return fs.readFileSync(
    path.join(FIXTURES_ROOT, "services-ironic", scene, "api", `${call}.json`),
    "utf8",
  );
}

// Whose nodes a project's admin was shown: its own, as the rig's cloud named it.
function recordedOwner(scene: string): string {
  const nodes: Array<JSONObject> = (
    JSON.parse(ironicFile(scene, "ironic-nodes")) as JSONObject
  )["nodes"] as Array<JSONObject>;

  return nodes[0]!["owner"] as string;
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
  view: View = "a project's admin",
): (pathname: string) => OpenStackHttpResponse | undefined {
  const asSystem: string = view === "system scope" ? "-as-system" : "";

  return (pathname: string): OpenStackHttpResponse | undefined => {
    if (pathname === "/v1/nodes") {
      return ironicAnswer(scene, `ironic-nodes${asSystem}`);
    }
    if (pathname === "/v1/conductors") {
      return ironicAnswer(scene, `ironic-conductors${asSystem}`);
    }
    return undefined;
  };
}

// Nova's list at the microversion a probe asks at, in the same scene.
function novaAsRecorded(
  scene: string,
): (request: OpenStackHttpRequest) => OpenStackHttpResponse | undefined {
  return (request: OpenStackHttpRequest): OpenStackHttpResponse | undefined => {
    return new URL(request.url).pathname.endsWith("/os-hypervisors/detail")
      ? ironicAnswer(scene, "nova-hypervisors-before-2-88")
      : undefined;
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

function exporterSeries(
  scene: string,
  view: View = "a project's admin",
  file: string = view === "system scope"
    ? "baremetal-as-devstack-system-admin"
    : "baremetal",
): Array<PrometheusSeries> {
  return parsePrometheusText(
    fs.readFileSync(
      path.join(
        FIXTURES_ROOT,
        "services-ironic",
        scene,
        "exporter",
        `${file}.prom`,
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
  test.each(VIEWS)(
    "%s, as %s: every node's every label the exporter has, and its value",
    async (scene: string, view: View) => {
      const { points } = await collect({
        ironic: ironicAsRecorded(scene, view),
      });
      const said: Array<PrometheusSeries> = exporterSeries(scene, view).filter(
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

  test.each(VIEWS)(
    "%s, as %s: when Ironic last saw each node move",
    async (scene: string, view: View) => {
      const { points } = await collect({
        ironic: ironicAsRecorded(scene, view),
      });
      const said: Array<PrometheusSeries> = exporterSeries(scene, view).filter(
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

  test.each(VIEWS)(
    "%s, as %s: the rows are what the exporter's are, as far as it says",
    async (scene: string, view: View) => {
      const { report } = await collect({
        ironic: ironicAsRecorded(scene, view),
      });
      const said: Array<PrometheusSeries> = exporterSeries(scene, view).filter(
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
      expect(row.openStackProjectId).toBe(recordedOwner("deploy-failed"));
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

  function conductorsOf(
    report: OpenStackCollectionReport,
  ): Array<Array<unknown>> {
    return ofKind(rowsOf(report), OpenStackResourceKind.Service)
      .filter((row: OpenStackResourceBufferEntry): boolean => {
        return row.facts["family"] === "baremetal";
      })
      .map((row: OpenStackResourceBufferEntry): Array<unknown> => {
        return [row.name, row.facts["host"], row.status];
      })
      .sort();
  }

  test("a credential that may reads them: alive, then its heartbeat old enough, then alive", async () => {
    for (const [scene, status] of [
      ["baseline", "up"],
      ["conductor-down", "down"],
      ["recovered", "up"],
    ] as Array<[string, string]>) {
      const { report } = await collect({
        ironic: ironicAsRecorded(scene, "system scope"),
      });

      expect(conductorsOf(report)).toEqual([
        ["ironic-conductor", "compute-01", status],
      ]);
    }
  });

  test("with its conductor down Ironic's API still answers, and every node reads as it did", async () => {
    const { report, points } = await collect({
      ironic: ironicAsRecorded("conductor-down", "system scope"),
    });

    expect(pointsNamed(points, "openstack_ironic_up")[0]?.value).toBe(1);
    expect(
      ofKind(rowsOf(report), OpenStackResourceKind.BareMetalNode).length,
    ).toBe(7);
  });

  test("the group a conductor is in, written by hand, as DevStack has only the one", async () => {
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

    expect(conductorsOf(report)).toEqual([
      ["ironic-conductor", "conductor-1", "up"],
      ["ironic-conductor", "conductor-2", "down"],
    ]);
  });

  test("what's left out of a project's list, which only system scope holds", async () => {
    const project: Collected = await collect({
      ironic: ironicAsRecorded("power-off-while-active"),
    });
    const everything: Collected = await collect({
      ironic: ironicAsRecorded("power-off-while-active", "system scope"),
    });
    const namesOf: (report: OpenStackCollectionReport) => Array<string> = (
      report: OpenStackCollectionReport,
    ): Array<string> => {
      return ofKind(rowsOf(report), OpenStackResourceKind.BareMetalNode)
        .map((row: OpenStackResourceBufferEntry): string => {
          return row.name as string;
        })
        .sort();
    };

    expect(namesOf(project.report)).not.toContain("ou-node-active");
    expect(namesOf(everything.report)).toContain("ou-node-active");
    expect(
      ofKind(
        rowsOf(everything.report),
        OpenStackResourceKind.BareMetalNode,
      ).find((row: OpenStackResourceBufferEntry): boolean => {
        return row.name === "ou-node-active";
      })?.facts["powerState"],
    ).toBe("power off");
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
        ownProjectId: recordedOwner("deploy-failed"),
        hasAdminRole: true,
      }).access,
    ).toBe("OwnProjectOnly");
  });

  test("none at all, with an admin role, is still only that project's: an admin is shown what it owns", () => {
    expect(
      classifyAccessList({
        body: { nodes: [] },
        key: "nodes",
        projectField: "owner?",
        ownProjectId: "own",
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
 * Nova's Ironic driver's list, as recorded: every node there is, under its UUID, with a half-enrolled
 * one's numbers null (the shape that broke other exporters: openstack-exporter issue 428).
 */
describe("Nova's list with nodes in it breaks nothing in a probe", () => {
  const NOVA_SERIES: ReadonlySet<string> = new Set([
    "openstack_nova_running_vms",
    "openstack_nova_current_workload",
    "openstack_nova_vcpus_available",
    "openstack_nova_vcpus_used",
    "openstack_nova_memory_available_bytes",
    "openstack_nova_memory_used_bytes",
    "openstack_nova_local_storage_available_bytes",
    "openstack_nova_local_storage_used_bytes",
    "openstack_nova_free_disk_bytes",
  ]);

  test("the half-enrolled one really has nothing to say, in that scene", () => {
    const nodes: Array<JSONObject> = (
      JSON.parse(
        ironicFile("half-enrolled", "nova-hypervisors-before-2-88"),
      ) as JSONObject
    )["hypervisors"] as Array<JSONObject>;

    expect(
      nodes.filter((one: JSONObject): boolean => {
        return one["running_vms"] === null;
      }).length,
    ).toBe(1);
    expect(
      nodes.every((one: JSONObject): boolean => {
        return one["hypervisor_type"] === "ironic";
      }),
    ).toBe(true);
  });

  test.each(SCENES)(
    "%s: every number of every node is what the exporter said",
    async (scene: string) => {
      const { points } = await collect({ answer: novaAsRecorded(scene) });
      const said: Array<PrometheusSeries> = exporterSeries(
        scene,
        "a project's admin",
        "compute",
      ).filter((one: PrometheusSeries): boolean => {
        return NOVA_SERIES.has(one.name);
      });

      const halfEnrolled: Array<string> = (
        (
          JSON.parse(
            ironicFile(scene, "nova-hypervisors-before-2-88"),
          ) as JSONObject
        )["hypervisors"] as Array<JSONObject>
      )
        .filter((one: JSONObject): boolean => {
          return one["running_vms"] === null;
        })
        .map((one: JSONObject): string => {
          return one["hypervisor_hostname"] as string;
        });

      expect(said.length).toBeGreaterThan(0);

      for (const line of said) {
        const point: ReportedDatapoint | undefined = pointsNamed(
          points,
          line.name,
        ).find((one: ReportedDatapoint): boolean => {
          return one.labels["hostname"] === line.labels["hostname"];
        });

        /*
         * Nova's null is no number. The exporter makes a 0 of it and a probe says nothing, as it does
         * of what any Nova doesn't say, and the scan makes no row of either.
         */
        if (
          !point &&
          halfEnrolled.includes(line.labels["hostname"] as string)
        ) {
          expect(line.value).toBe(0);
          continue;
        }

        expect({
          series: line.name,
          host: line.labels["hostname"],
          value: point?.value,
        }).toEqual({
          series: line.name,
          host: line.labels["hostname"],
          value: line.value,
        });
      }
    },
  );

  test.each(SCENES)(
    "%s: Nova's API stays up, and no node is a hypervisor",
    async (scene: string) => {
      const { report, points } = await collect({
        answer: novaAsRecorded(scene),
      });
      const nodes: Array<string> = (
        (
          JSON.parse(
            ironicFile(scene, "nova-hypervisors-before-2-88"),
          ) as JSONObject
        )["hypervisors"] as Array<JSONObject>
      ).map((one: JSONObject): string => {
        return one["hypervisor_hostname"] as string;
      });

      expect(pointsNamed(points, "openstack_nova_up")[0]?.value).toBe(1);
      expect(nodes.length).toBeGreaterThan(0);
      expect(
        ofKind(rowsOf(report), OpenStackResourceKind.Hypervisor).filter(
          (row: OpenStackResourceBufferEntry): boolean => {
            return nodes.includes(row.hypervisorName as string);
          },
        ),
      ).toEqual([]);
    },
  );

  test("past the microversion that says, its list of nodes is just as harmless", async () => {
    const { report, points } = await collect({
      answer: (
        request: OpenStackHttpRequest,
      ): OpenStackHttpResponse | undefined => {
        return new URL(request.url).pathname.endsWith("/os-hypervisors/detail")
          ? ironicAnswer("half-enrolled", "nova-hypervisors")
          : undefined;
      },
    });

    expect(pointsNamed(points, "openstack_nova_up")[0]?.value).toBe(1);
    expect(
      ofKind(rowsOf(report), OpenStackResourceKind.Hypervisor).filter(
        (row: OpenStackResourceBufferEntry): boolean => {
          return (row.hypervisorName as string).startsWith("0fa2c1b5");
        },
      ),
    ).toEqual([]);
  });
});
