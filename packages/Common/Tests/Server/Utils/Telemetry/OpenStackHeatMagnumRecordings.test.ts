import fs from "fs";
import path from "path";
import OpenStackResource from "../../../../Models/DatabaseModels/OpenStackResource";
import {
  OpenStackOptionalServiceScrape,
  OpenStackResourceBufferEntry,
  bufferOpenStackOptionalServiceScrape,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  isOpenStackOptionalServiceScrapeDatapoint,
  isOpenStackSnapshotDatapoint,
} from "../../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  OPENSTACK_CONTAINER_CLUSTER_STUCK_MINUTES,
  OPENSTACK_STACK_STUCK_MINUTES,
} from "../../../../Types/OpenStack/OpenStackHealthRules";
import {
  OPENSTACK_CONTAINER_CLUSTER_FAILED_STATUSES,
  OPENSTACK_CONTAINER_CLUSTER_IN_PROGRESS_STATUSES,
  OPENSTACK_STACK_FAILED_STATUSES,
  OPENSTACK_STACK_IN_PROGRESS_STATUSES,
  OpenStackResourceKind,
} from "../../../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_FIXTURES_FOLDER,
  RecordedSeries,
  readRecordedSeries,
  scanRecordedSeries,
} from "../../../Helpers/OpenStackRecordedRows";
import {
  OPENSTACK_EXPORTER_CONTAINER_CLUSTER_STATUS_CODES,
  OPENSTACK_EXPORTER_STACK_STATUS_CODES,
} from "../../../Types/Monitor/Utils/OpenStackExporterSeries";
import {
  getOpenStackAttentionItems,
  getOpenStackHealth,
} from "../../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackHealth";
import {
  getOpenStackServerNamesOfStack,
  getOpenStackStackNameOfServer,
} from "../../../../Types/OpenStack/OpenStackLinks";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";

/*
 * Heat and Magnum, on what a real stable/2026.1 DevStack said (run 41988907585), through the real
 * scan and the real health rules. Tests/Ops/openstack-e2e/services-heat-magnum.sh drives each scene,
 * and its how.txt says how the state was reached: every scene here was reached on its own.
 *
 * What these can't say, because it was never recorded: a cluster that reached CREATE_COMPLETE, on any
 * runner.
 */

const FOLDER: string = path.join(
  OPENSTACK_FIXTURES_FOLDER,
  "services-heat-magnum",
);
const OBSERVED_AT_MS: number = 1793843549000;
const NOW: Date = new Date(OBSERVED_AT_MS + 60 * 1000);

function toRow(entry: OpenStackResourceBufferEntry): OpenStackResource {
  return Object.assign(new OpenStackResource(), {
    kind: entry.kind,
    externalId: entry.externalId,
    name: entry.name || undefined,
    regionName: entry.regionName || undefined,
    openStackProjectId: entry.openStackProjectId || undefined,
    status: entry.status || undefined,
    // A row's state starts when it was first seen, which is now on a scan of one scene.
    stateChangedAt: entry.statusObservedAt || undefined,
    facts: entry.facts,
  });
}

function seriesOf(
  scene: string,
  exporter: string = "exporter",
): Array<RecordedSeries> {
  return readRecordedSeries(path.join(FOLDER, scene, exporter));
}

function rowsOf(scene: string, exporter?: string): Array<OpenStackResource> {
  return scanRecordedSeries(seriesOf(scene, exporter), OBSERVED_AT_MS).map(
    toRow,
  );
}

function ofKind(
  rows: Array<OpenStackResource>,
  kind: OpenStackResourceKind,
): Array<OpenStackResource> {
  return rows.filter((row: OpenStackResource): boolean => {
    return row.kind === kind;
  });
}

function named(
  rows: Array<OpenStackResource>,
  kind: OpenStackResourceKind,
  name: string,
): OpenStackResource {
  const row: OpenStackResource | undefined = ofKind(rows, kind).find(
    (candidate: OpenStackResource): boolean => {
      return candidate.name === name;
    },
  );
  if (!row) {
    throw new Error(`No ${kind} named ${name}`);
  }
  return row;
}

function attentionOf(
  rows: Array<OpenStackResource>,
  now: Date = NOW,
): Array<ResourceAttentionItem> {
  return getOpenStackAttentionItems({ rows, now });
}

function namesNeedingAttention(rows: Array<OpenStackResource>): Array<string> {
  return attentionOf(rows)
    .map((item: ResourceAttentionItem): string => {
      return item.name;
    })
    .sort();
}

function apiOf(
  rows: Array<OpenStackResource>,
  service: string,
): OpenStackResource {
  return named(rows, OpenStackResourceKind.Api, service);
}

function readJson(...segments: Array<string>): JSONObject {
  return JSON.parse(
    fs.readFileSync(path.join(FOLDER, ...segments), "utf8"),
  ) as JSONObject;
}

const OTLP_SERVICE: RegExp =
  /"key":"openstack_service","value":\{"stringValue":"([^"]+)"\}/g;
const PROJECT_ADMIN: string = "ae798f87fdb743ddb30bc5a46ac15507";
const PROJECT_PAYMENTS: string = "a01a07259d8441afa457d94ba7e4425f";

describe("Heat", () => {
  describe("heat-baseline: stacks that finished and stacks that failed, in two projects", () => {
    const rows: Array<OpenStackResource> = rowsOf("heat-baseline");

    test("every project's stacks are in an admin's one list", () => {
      expect(
        ofKind(rows, OpenStackResourceKind.Stack)
          .map((row: OpenStackResource): Array<string | undefined> => {
            return [row.name, row.status, row.openStackProjectId];
          })
          .sort(),
      ).toEqual(
        [
          ["ou-stack-admin-failed", "CREATE_FAILED", PROJECT_ADMIN],
          ["ou-stack-admin-ok", "CREATE_COMPLETE", PROJECT_ADMIN],
          ["ou-stack-failed", "CREATE_FAILED", PROJECT_PAYMENTS],
          ["ou-stack-ok", "CREATE_COMPLETE", PROJECT_PAYMENTS],
        ].sort(),
      );
    });

    test("its row is keyed by Heat's own ID, and holds its region", () => {
      const row: OpenStackResource = named(
        rows,
        OpenStackResourceKind.Stack,
        "ou-stack-failed",
      );
      expect(row.externalId).toBe("8fb1dcc5-0685-434b-8e1a-bf0618776952");
      expect(row.regionName).toBe("RegionOne");
    });

    test("each failed stack reaches Needs attention by name, and neither of the others does", () => {
      // And the server Nova couldn't place for it, which reads on its own.
      expect(namesNeedingAttention(rows)).toEqual([
        "ou-stack-admin-failed",
        "ou-stack-failed",
        "ou-stack-failed-server-b2chjl4j7q3r",
      ]);
      const item: ResourceAttentionItem = attentionOf(rows).find(
        (candidate: ResourceAttentionItem): boolean => {
          return candidate.name === "ou-stack-failed";
        },
      )!;
      expect(item.kind).toBe("Stack");
      expect(item.severity).toBe(ResourceAttentionSeverity.Warning);
      expect(item.reasons).toEqual([
        { text: "In {{status}}", values: { status: "CREATE_FAILED" } },
      ]);
    });

    test("so the cloud reads degraded, and never down, for a project's own failure", () => {
      expect(getOpenStackHealth(attentionOf(rows))).toBe("Degraded");
    });

    test("Heat's API reads up", () => {
      expect(apiOf(rows, "orchestration").status).toBe("up");
    });

    test("the exporter says nothing of why it failed: that takes a probe", () => {
      expect(
        named(rows, OpenStackResourceKind.Stack, "ou-stack-failed").facts?.[
          "statusReason"
        ],
      ).toBeNull();
    });
  });

  describe("heat-held-in-progress: stacks taking their time", () => {
    const rows: Array<OpenStackResource> = rowsOf("heat-held-in-progress");
    const creating: OpenStackResource = named(
      rows,
      OpenStackResourceKind.Stack,
      "ou-stack-creating",
    );

    test("reads as it is, and needs nobody yet", () => {
      expect(creating.status).toBe("CREATE_IN_PROGRESS");
      expect(
        named(rows, OpenStackResourceKind.Stack, "ou-stack-updating").status,
      ).toBe("UPDATE_IN_PROGRESS");
      expect(namesNeedingAttention(rows)).toEqual([
        "ou-stack-admin-failed",
        "ou-stack-failed",
      ]);
    });

    test("past the line it is stuck, by name, and says for how long", () => {
      const later: Date = new Date(
        OBSERVED_AT_MS + OPENSTACK_STACK_STUCK_MINUTES * 60 * 1000,
      );
      const item: ResourceAttentionItem = attentionOf(rows, later).find(
        (candidate: ResourceAttentionItem): boolean => {
          return candidate.name === "ou-stack-creating";
        },
      )!;
      expect(item.severity).toBe(ResourceAttentionSeverity.Warning);
      expect(item.reasons).toEqual([
        {
          text: "{{status}} for {{duration}}",
          values: { status: "CREATE_IN_PROGRESS", duration: "2h" },
        },
      ]);
    });

    test("a minute short of the line it is not", () => {
      const before: Date = new Date(
        OBSERVED_AT_MS + (OPENSTACK_STACK_STUCK_MINUTES - 1) * 60 * 1000,
      );
      expect(
        attentionOf(rows, before).map((item: ResourceAttentionItem): string => {
          return item.name;
        }),
      ).not.toContain("ou-stack-creating");
    });
  });

  test("heat-update-failed: a stack whose update failed reaches Needs attention by name", () => {
    expect(namesNeedingAttention(rowsOf("heat-update-failed"))).toEqual([
      "ou-stack-admin-failed",
      "ou-stack-failed",
      "ou-stack-update-fails",
    ]);
  });

  describe.each(["heat-engine-down", "heat-api-down"])(
    "%s: Heat can't answer its lists",
    (scene: string) => {
      const rows: Array<OpenStackResource> = rowsOf(scene);

      test("its API reads down, and is what needs someone", () => {
        expect(apiOf(rows, "orchestration").status).toBe("down");
        const items: Array<ResourceAttentionItem> = attentionOf(rows);
        expect(items).toHaveLength(1);
        expect(items[0]!.severity).toBe(ResourceAttentionSeverity.Critical);
      });

      test("and says nothing about its stacks, which keep what they last said", () => {
        expect(ofKind(rows, OpenStackResourceKind.Stack)).toEqual([]);
      });
    },
  );

  test("heat-engine-down: the exporter waited a minute for the answer, under the agent's two", () => {
    const status: string = fs.readFileSync(
      path.join(FOLDER, "heat-engine-down", "exporter", "status.txt"),
      "utf8",
    );
    const scrape: RegExp = /orchestration 200 ([0-9.]+)s/;
    const seconds: number = Number.parseFloat(
      scrape.exec(status)![1] as string,
    );
    expect(seconds).toBeGreaterThan(55);
    // The job's scrape_timeout, read in OpenStackAgentConfig: so this reads _up 0, and not up 0.
    expect(seconds).toBeLessThan(120);
  });

  test("heat-engine-restarted: a new engine moved neither stack the old one left", () => {
    const rows: Array<OpenStackResource> = rowsOf("heat-engine-restarted");
    expect(apiOf(rows, "orchestration").status).toBe("up");
    expect(
      named(rows, OpenStackResourceKind.Stack, "ou-stack-creating").status,
    ).toBe("CREATE_IN_PROGRESS");
    expect(
      named(rows, OpenStackResourceKind.Stack, "ou-stack-updating").status,
    ).toBe("UPDATE_IN_PROGRESS");
  });

  test("every word Heat's counter reads is a word the rules know, and none is missed", () => {
    const words: Array<string> = seriesOf("heat-baseline")
      .filter((series: RecordedSeries): boolean => {
        return series.name === "openstack_heat_stack_status_counter";
      })
      .map((series: RecordedSeries): string => {
        return series.labels["status"] as string;
      });
    expect(words).toHaveLength(30);
    const failed: Array<string> = words.filter((word: string): boolean => {
      return word.endsWith("_FAILED");
    });
    const inProgress: Array<string> = words.filter((word: string): boolean => {
      return word.endsWith("_IN_PROGRESS");
    });
    expect(failed.sort()).toEqual(
      Array.from(OPENSTACK_STACK_FAILED_STATUSES).sort(),
    );
    expect(inProgress.sort()).toEqual(
      Array.from(OPENSTACK_STACK_IN_PROGRESS_STATUSES).sort(),
    );
  });

  test("each series' value is the code the exporter's source says for its word", () => {
    for (const scene of ["heat-baseline", "heat-update-failed"]) {
      for (const series of seriesOf(scene)) {
        if (series.name === "openstack_heat_stack_status") {
          expect(series.value).toBe(
            OPENSTACK_EXPORTER_STACK_STATUS_CODES[
              series.labels["status"] as string
            ],
          );
        }
      }
    }
  });
});

describe("Magnum", () => {
  test("magnum-baseline: the API answers and there are no clusters", () => {
    const rows: Array<OpenStackResource> = rowsOf("magnum-baseline");
    expect(apiOf(rows, "container-infra").status).toBe("up");
    expect(ofKind(rows, OpenStackResourceKind.ContainerCluster)).toEqual([]);
    expect(attentionOf(rows)).toEqual([]);
  });

  describe("magnum-creating: clusters on their way", () => {
    const rows: Array<OpenStackResource> = rowsOf("magnum-creating");
    const cluster: OpenStackResource = named(
      rows,
      OpenStackResourceKind.ContainerCluster,
      "ou-cluster-long",
    );

    test("its row is keyed by Magnum's own ID, and holds what its series say", () => {
      expect(cluster.externalId).toBe("1836d7d8-990a-42aa-a318-4de151184de9");
      expect(cluster.status).toBe("CREATE_IN_PROGRESS");
      expect(cluster.facts).toMatchObject({
        stackId: "8ff88764-ef47-484e-8804-2b4c3d22d558",
        nodeCount: 1,
        masterCount: 1,
      });
    });

    test("the exporter has no project for it: Magnum says it only on a cluster's own read", () => {
      expect(cluster.openStackProjectId).toBeUndefined();
      const ownRead: JSONObject = readJson(
        "magnum-creating",
        "api",
        "magnum-cluster-ou-cluster-long.json",
      );
      expect(ownRead["project_id"]).toBe(PROJECT_ADMIN);
      const list: JSONObject = readJson(
        "magnum-creating",
        "api",
        "magnum-clusters.json",
      );
      expect(
        (list["clusters"] as Array<JSONObject>)[0]!["project_id"],
      ).toBeUndefined();
    });

    test("one row per cluster, however many of its series say so", () => {
      expect(ofKind(rows, OpenStackResourceKind.ContainerCluster)).toHaveLength(
        2,
      );
    });

    test("needs nobody yet, and past the line is stuck by name", () => {
      expect(attentionOf(rows)).toEqual([]);
      const later: Date = new Date(
        OBSERVED_AT_MS + OPENSTACK_CONTAINER_CLUSTER_STUCK_MINUTES * 60 * 1000,
      );
      expect(
        attentionOf(rows, later)
          .map((item: ResourceAttentionItem): string => {
            return item.name;
          })
          .sort(),
      ).toEqual(["ou-cluster-long", "ou-cluster-times-out"]);
    });
  });

  describe("magnum-failed: a cluster that ran out of its time", () => {
    const rows: Array<OpenStackResource> = rowsOf("magnum-failed");

    test("reaches Needs attention by name, beside one still on its way", () => {
      expect(namesNeedingAttention(rows)).toEqual(["ou-cluster-times-out"]);
      const item: ResourceAttentionItem = attentionOf(rows)[0]!;
      expect(item.kind).toBe("Kubernetes cluster");
      expect(item.severity).toBe(ResourceAttentionSeverity.Warning);
      expect(item.reasons).toEqual([
        { text: "In {{status}}", values: { status: "CREATE_FAILED" } },
      ]);
    });

    test("Magnum says why on its own read of it, which only a probe makes", () => {
      expect(
        readJson(
          "magnum-failed",
          "api",
          "magnum-cluster-ou-cluster-times-out.json",
        )["status_reason"],
      ).toBe("default-master failed, default-worker failed");
    });
  });

  test("magnum-real-image: the real image failed on a runner, and reads the same", () => {
    const names: Array<string> = namesNeedingAttention(
      rowsOf("magnum-real-image"),
    );
    expect(names).toContain("ou-cluster-real");
    // Its stack failed with it, and that is one line, by the cluster's name.
    expect(names).not.toContain("ou-cluster-real-b4a265chwfks");
  });

  test("magnum-conductor-down: the exporter's series say nothing of it, which a page has to say", () => {
    const rows: Array<OpenStackResource> = rowsOf("magnum-conductor-down");
    expect(apiOf(rows, "container-infra").status).toBe("up");
    expect(ofKind(rows, OpenStackResourceKind.Service)).toEqual([]);
    expect(
      (
        readJson("magnum-conductor-down", "api", "magnum-services.json")[
          "mservices"
        ] as Array<JSONObject>
      )[0]!["state"],
    ).toBe("down");
  });

  test("magnum-api-down: its API reads down, and is what needs someone", () => {
    const rows: Array<OpenStackResource> = rowsOf("magnum-api-down");
    expect(apiOf(rows, "container-infra").status).toBe("down");
    expect(ofKind(rows, OpenStackResourceKind.ContainerCluster)).toEqual([]);
    expect(attentionOf(rows)).toHaveLength(1);
  });

  test("each series' value is the code the exporter's source says for its word", () => {
    for (const scene of ["magnum-creating", "magnum-failed"]) {
      for (const series of seriesOf(scene)) {
        if (series.name === "openstack_container_infra_cluster_status") {
          expect(series.value).toBe(
            OPENSTACK_EXPORTER_CONTAINER_CLUSTER_STATUS_CODES[
              series.labels["status"] as string
            ],
          );
        }
      }
    }
  });

  test("every word the rules read is one the exporter's source knows", () => {
    for (const word of [
      ...OPENSTACK_CONTAINER_CLUSTER_FAILED_STATUSES,
      ...OPENSTACK_CONTAINER_CLUSTER_IN_PROGRESS_STATUSES,
    ]) {
      expect(
        OPENSTACK_EXPORTER_CONTAINER_CLUSTER_STATUS_CODES[word],
      ).toBeDefined();
    }
  });
});

describe("Heat and Magnum together: a credential that reads both", () => {
  const rows: Array<OpenStackResource> = rowsOf(
    "access-check",
    "exporter/admin",
  );
  const cluster: OpenStackResource = named(
    rows,
    OpenStackResourceKind.ContainerCluster,
    "ou-cluster-real",
  );

  test("a cluster's stack is one of Heat's stacks, and says the project Magnum's own read does", () => {
    const stack: OpenStackResource | undefined = ofKind(
      rows,
      OpenStackResourceKind.Stack,
    ).find((row: OpenStackResource): boolean => {
      return row.externalId === cluster.facts?.["stackId"];
    });
    expect(stack?.name).toBe("ou-cluster-real-b4a265chwfks");
    expect(stack?.openStackProjectId).toBe(
      readJson(
        "magnum-real-image",
        "api",
        "magnum-cluster-ou-cluster-real.json",
      )["project_id"],
    );
  });

  test("a failed cluster and its failed stack are one line, by the cluster's name", () => {
    const names: Array<string> = namesNeedingAttention(rows);
    expect(names).toContain("ou-cluster-real");
    expect(names).not.toContain("ou-cluster-real-b4a265chwfks");
    // Stacks that are nobody's cluster still read on their own.
    expect(names).toContain("ou-stack-failed");
  });

  test("on the stack's own page, read alone, it still reads", () => {
    const stack: OpenStackResource = named(
      rows,
      OpenStackResourceKind.Stack,
      "ou-cluster-real-b4a265chwfks",
    );
    expect(namesNeedingAttention([stack])).toEqual([
      "ou-cluster-real-b4a265chwfks",
    ]);
  });
});

describe("what a stack owns, as its own project was told", () => {
  const owned: (name: string, type: string) => Array<string> = (
    name: string,
    type: string,
  ): Array<string> => {
    return (
      readJson("heat-baseline", "api", `heat-stack-resources-${name}.json`)[
        "resources"
      ] as Array<JSONObject>
    )
      .filter((resource: JSONObject): boolean => {
        return resource["resource_type"] === type;
      })
      .map((resource: JSONObject): string => {
        return resource["physical_resource_id"] as string;
      });
  };
  const rows: Array<OpenStackResource> = rowsOf("heat-baseline");

  test("Heat's IDs are the ones Nova and Cinder have rows for", () => {
    const [instance]: Array<string> = owned("ou-stack-ok", "OS::Nova::Server");
    const [volume]: Array<string> = owned("ou-stack-ok", "OS::Cinder::Volume");

    expect(
      ofKind(rows, OpenStackResourceKind.Instance).find(
        (row: OpenStackResource): boolean => {
          return row.externalId === instance;
        },
      )?.name,
    ).toContain("ou-stack-ok-server");
    expect(
      ofKind(rows, OpenStackResourceKind.Volume).some(
        (row: OpenStackResource): boolean => {
          return row.externalId === volume;
        },
      ),
    ).toBe(true);
  });

  test("a server Nova couldn't place still has an ID, and a row in ERROR", () => {
    const [instance]: Array<string> = owned(
      "ou-stack-failed",
      "OS::Nova::Server",
    );
    expect(
      ofKind(rows, OpenStackResourceKind.Instance).find(
        (row: OpenStackResource): boolean => {
          return row.externalId === instance;
        },
      )?.status,
    ).toBe("ERROR");
  });

  test("a resource that failed before it was made has no ID at all", () => {
    expect(owned("ou-stack-admin-failed", "OS::Heat::TestResource")).toEqual([
      "",
    ]);
  });
});

describe("what a stack owns, as a credential of another project was told", () => {
  const read: (matrix: string) => Record<string, JSONObject> = (
    matrix: string,
  ): Record<string, JSONObject> => {
    const row: JSONObject | undefined = (
      readJson("access-check", `${matrix}.json`)[
        "partReads"
      ] as Array<JSONObject>
    ).find((candidate: JSONObject): boolean => {
      return candidate["read"] === "another project's stack's resources";
    });
    return row?.["results"] as unknown as Record<string, JSONObject>;
  };

  test("the Full view credential is told, through the access rules a customer fits", () => {
    expect(read("matrix-access-rules")["monitoring-admin-get"]).toMatchObject({
      status: 200,
      count: 1,
    });
  });

  test("anything less is refused, which is why a stack's page can say nothing has read it", () => {
    const results: Record<string, JSONObject> = read("matrix");
    expect(results["admin"]?.["status"]).toBe(200);
    for (const credential of [
      "reader",
      "monitoring-role",
      "role-on-a-project",
    ]) {
      expect(results[credential]?.["status"]).toBe(403);
    }
  });
});

describe("a Magnum cluster's server, on what a real cloud named it", () => {
  const rows: Array<OpenStackResource> = rowsOf("magnum-real-image");
  const stackId: unknown = named(
    rows,
    OpenStackResourceKind.ContainerCluster,
    "ou-cluster-real",
  ).facts?.["stackId"];
  const stack: OpenStackResource | undefined = ofKind(
    rows,
    OpenStackResourceKind.Stack,
  ).find((row: OpenStackResource): boolean => {
    return row.externalId === stackId;
  });

  test("its name says the stack the cluster names, which is what links it to Kubernetes", () => {
    const servers: Array<OpenStackResource> = ofKind(
      rows,
      OpenStackResourceKind.Instance,
    ).filter((row: OpenStackResource): boolean => {
      return getOpenStackStackNameOfServer(row.name) === stack?.name;
    });
    expect(
      servers.map((row: OpenStackResource): string => {
        return row.name || "";
      }),
    ).toEqual([`${stack?.name}-master-0`]);
  });

  test("and it is among the names a read of that stack's servers asks for", () => {
    expect(
      getOpenStackServerNamesOfStack({
        stackName: stack?.name || "",
        masterCount: Number(
          named(rows, OpenStackResourceKind.ContainerCluster, "ou-cluster-real")
            .facts?.["masterCount"],
        ),
        nodeCount: 1,
      }),
    ).toContain(`${stack?.name}-master-0`);
  });

  test("nothing else on this cloud reads as one, whatever it is called", () => {
    expect(
      ofKind(rows, OpenStackResourceKind.Instance)
        .filter((row: OpenStackResource): boolean => {
          return Boolean(getOpenStackStackNameOfServer(row.name));
        })
        .map((row: OpenStackResource): string => {
          return row.name || "";
        }),
    ).toEqual([`${stack?.name}-master-0`]);
  });
});

describe("what a limited credential got", () => {
  test("level 1's access rules read what an admin reads", () => {
    const admin: Array<OpenStackResource> = rowsOf(
      "access-check",
      "exporter/admin",
    );
    const level1: Array<OpenStackResource> = rowsOf(
      "access-check",
      "exporter/monitoring-admin-get",
    );
    expect(
      ofKind(level1, OpenStackResourceKind.Stack).map(
        (row: OpenStackResource): string => {
          return row.externalId || "";
        },
      ),
    ).toEqual(
      ofKind(admin, OpenStackResourceKind.Stack).map(
        (row: OpenStackResource): string => {
          return row.externalId || "";
        },
      ),
    );
    expect(ofKind(level1, OpenStackResourceKind.ContainerCluster)).toHaveLength(
      1,
    );
  });

  test("the monitoring role is refused Heat and shown no clusters, and each API still reads up", () => {
    const rows: Array<OpenStackResource> = rowsOf(
      "access-check",
      "exporter/monitoring-role",
    );
    expect(apiOf(rows, "orchestration").status).toBe("up");
    expect(apiOf(rows, "container-infra").status).toBe("up");
    expect(ofKind(rows, OpenStackResourceKind.Stack)).toEqual([]);
    expect(ofKind(rows, OpenStackResourceKind.ContainerCluster)).toEqual([]);
  });

  test("a plain reader gets its own project's stacks, with no project on them", () => {
    const rows: Array<OpenStackResource> = rowsOf(
      "access-check",
      "exporter/reader",
    );
    const stacks: Array<OpenStackResource> = ofKind(
      rows,
      OpenStackResourceKind.Stack,
    );
    expect(
      stacks
        .map((row: OpenStackResource): string => {
          return row.name || "";
        })
        .sort(),
    ).toEqual(["ou-stack-failed", "ou-stack-ok"]);
    for (const stack of stacks) {
      expect(stack.openStackProjectId).toBeUndefined();
    }
  });
});

/*
 * The collector's real OTLP on a real cloud: Heat and Magnum there, and Designate not, so the same
 * batch holds both of what this has to tell apart.
 */
describe("the agent's real collector, on a cloud with some of these and not others", () => {
  type Point = { name: string; datapoint: JSONObject };

  const points: Array<Point> = [];
  const otlp: JSONObject = readJson("otlp.json");
  for (const resource of otlp["resourceMetrics"] as JSONArray) {
    for (const scope of (resource as JSONObject)["scopeMetrics"] as JSONArray) {
      for (const metric of (scope as JSONObject)["metrics"] as JSONArray) {
        const gauge: JSONObject = ((metric as JSONObject)["gauge"] ||
          (metric as JSONObject)["sum"]) as JSONObject;
        for (const datapoint of (gauge["dataPoints"] as JSONArray) || []) {
          points.push({
            name: (metric as JSONObject)["name"] as string,
            datapoint: datapoint as JSONObject,
          });
        }
      }
    }
  }

  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();
  const scrapes: Map<string, OpenStackOptionalServiceScrape> = new Map();
  for (const point of points) {
    if (
      isOpenStackSnapshotDatapoint({
        metricName: point.name,
        datapoint: point.datapoint,
      })
    ) {
      bufferOpenStackSnapshotMetric({
        metricName: point.name,
        datapoint: point.datapoint,
        buffer,
      });
    }
    if (
      isOpenStackOptionalServiceScrapeDatapoint({
        metricName: point.name,
        datapoint: point.datapoint,
      })
    ) {
      bufferOpenStackOptionalServiceScrape({
        metricName: point.name,
        datapoint: point.datapoint,
        buffer: scrapes,
      });
    }
  }
  const finished: Array<OpenStackResourceBufferEntry> = finishOpenStackBatch(
    buffer.values(),
  );

  const apis: Array<string> = finished
    .filter((entry: OpenStackResourceBufferEntry): boolean => {
      return entry.kind === OpenStackResourceKind.Api;
    })
    .map((entry: OpenStackResourceBufferEntry): string => {
      return entry.name || "";
    })
    .sort();

  test("the services the exporter said something about have rows", () => {
    expect(apis).toEqual(["container-infra", "orchestration"]);
    expect(
      finished.filter((entry: OpenStackResourceBufferEntry): boolean => {
        return entry.kind === OpenStackResourceKind.Stack;
      }),
    ).toHaveLength(4);
    expect(
      finished.filter((entry: OpenStackResourceBufferEntry): boolean => {
        return entry.kind === OpenStackResourceKind.ContainerCluster;
      }),
    ).toHaveLength(2);
  });

  // Which service a run's one export caught differs by run, so this asks rather than names it.
  const notHere: (name: string) => boolean = (name: string): boolean => {
    return name !== "container-infra" && name !== "orchestration";
  };

  test("the one it said nothing about, which the cloud does not run, has none", () => {
    const other: Array<string> = points
      .filter((point: Point): boolean => {
        return point.name === "up";
      })
      .flatMap((point: Point): Array<string> => {
        return Array.from(
          JSON.stringify(point.datapoint).matchAll(OTLP_SERVICE),
          (match: RegExpMatchArray): string => {
            return match[1] as string;
          },
        );
      })
      .filter(notHere);
    expect(other.length).toBeGreaterThan(0);
    expect(apis.filter(notHere)).toEqual([]);
  });

  test("an empty scrape of one this cloud doesn't run is at most something to update a row with, and it has none", () => {
    expect(Array.from(scrapes.keys())).toEqual(
      expect.arrayContaining([
        "RegionOne/container-infra",
        "RegionOne/orchestration",
      ]),
    );
    for (const [key, scrape] of scrapes) {
      if (notHere(key.substring(key.indexOf("/") + 1))) {
        expect(scrape).toMatchObject({ answered: true, samples: 0 });
      }
    }
    expect(apis.filter(notHere)).toEqual([]);
  });

  test("what each scrape said, to go on a row that is already there", () => {
    expect(scrapes.get("RegionOne/orchestration")).toMatchObject({
      service: "orchestration",
      regionName: "RegionOne",
      answered: true,
      samples: 35,
    });
    expect(scrapes.get("RegionOne/container-infra")?.seconds).toBeGreaterThan(
      0,
    );
  });

  test("a real cluster's series have no project label at all: empty is no label", () => {
    const cluster: OpenStackResourceBufferEntry | undefined = finished.find(
      (entry: OpenStackResourceBufferEntry): boolean => {
        return entry.kind === OpenStackResourceKind.ContainerCluster;
      },
    );
    expect(cluster?.openStackProjectId).toBeNull();
    expect(cluster?.facts["stackId"]).toBeTruthy();
  });
});
