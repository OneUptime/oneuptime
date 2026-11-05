import { describe, expect, test } from "@jest/globals";
import { OpenStackResourceBufferEntry } from "Common/Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONObject } from "Common/Types/JSON";
import { OpenStackAccessRead } from "Common/Types/OpenStack/OpenStackProbeCollection";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import { SHARED_FILE_SYSTEMS_MICROVERSION_HEADERS } from "../../../Utils/OpenStack/Collectors/SharedFileSystemsCollector";
import { ReportedDatapoint } from "./Helpers/CollectorHarness";
import {
  RECORDED_HOST,
  RecordedScene,
  loadScene,
  recordedJson,
} from "./Helpers/RecordedCloud";
import {
  RecordedAnswer,
  RecordedRequest,
  RecordedServiceCollection,
  catalogEntry,
  collectFromRecordedService,
  comparableOfExporter,
  comparableOfProbe,
  pointsNamed,
  recordedCall,
  rowsOfReport,
  testConnectionOnRecordedService,
} from "./Helpers/RecordedServiceCloud";

/*
 * What a probe sends of Manila is what the agent sends, on the same real DevStack at the same moment
 * (services-manila, stable/2026.1), plus what only a native read can add: a share's backend and access
 * rules, and Manila's own services, which is the only place a stopped one shows.
 */

const GROUP: string = "services-manila";
const MANILA_URL: string = `${RECORDED_HOST}/share/v2`;
const CATALOG: Array<JSONObject> = [catalogEntry("sharev2", MANILA_URL)];

const SCENES_WITH_SHARES: ReadonlyArray<string> = [
  "baseline",
  "share-error",
  "share-stuck",
  "share-service-stopped",
  "share-service-killed",
  "scheduler-stopped",
  "recovered",
];

function callOf(path: string): string | undefined {
  return {
    "/share/v2/shares/detail": "manila-shares-versioned",
    "/share/v2/services": "manila-services",
    "/share/v2/scheduler-stats/pools/detail": "manila-pools",
  }[path];
}

async function collect(
  scene: RecordedScene,
  override?: ((path: string) => RecordedAnswer | undefined) | undefined,
): Promise<RecordedServiceCollection> {
  return await collectFromRecordedService({
    catalog: CATALOG,
    answer: (path: string): RecordedAnswer | undefined => {
      const overridden: RecordedAnswer | undefined = override?.(path);
      if (overridden) {
        return overridden;
      }
      const call: string | undefined = callOf(path);
      return call ? recordedCall(scene, call) : undefined;
    },
  });
}

function rowOf(
  rows: ReadonlyArray<OpenStackResourceBufferEntry>,
  kind: OpenStackResourceKind,
  name: string,
): OpenStackResourceBufferEntry {
  const found: OpenStackResourceBufferEntry | undefined = rows.find(
    (row: OpenStackResourceBufferEntry): boolean => {
      return row.kind === kind && row.name === name;
    },
  );
  if (!found) {
    throw new Error(`No ${kind} called ${name}`);
  }
  return found;
}

describe("Manila, on what a real cloud said", () => {
  describe.each(SCENES_WITH_SHARES)("%s", (name: string) => {
    const scene: RecordedScene = loadScene(GROUP, name);

    test.each([
      "openstack_sharev2_share_gb",
      "openstack_sharev2_share_status",
      "openstack_sharev2_shares_counter",
      "openstack_sharev2_up",
    ])("%s is the exporter's, label for label", async (metric: string) => {
      const { points } = await collect(scene);
      // Empty on the exporter's, and a name on a probe's, which asks for a microversion.
      expect(comparableOfProbe(points, metric, ["share_type_name"])).toEqual(
        comparableOfExporter(scene, metric, ["share_type_name"]),
      );
    });

    test("every word's count is the exporter's", async () => {
      const { points } = await collect(scene);
      expect(
        comparableOfProbe(points, "openstack_sharev2_share_status_counter"),
      ).toEqual(
        comparableOfExporter(scene, "openstack_sharev2_share_status_counter"),
      );
    });
  });

  test("api-down: its API reads 0, as the exporter's did, and says nothing of its shares", async () => {
    const scene: RecordedScene = loadScene(GROUP, "api-down");
    const { points, report } = await collect(scene);

    expect(comparableOfProbe(points, "openstack_sharev2_up")).toEqual(
      comparableOfExporter(scene, "openstack_sharev2_up"),
    );
    expect(pointsNamed(points, "openstack_sharev2_share_gb")).toEqual([]);
    expect(
      rowsOfReport(report).rows.filter(
        (row: OpenStackResourceBufferEntry): boolean => {
          return row.kind === OpenStackResourceKind.Share;
        },
      ),
    ).toEqual([]);
  });
});

describe("what only a native read says", () => {
  test("a share's type by name, its backend and its access rules, on its row", async () => {
    const { report } = await collect(loadScene(GROUP, "baseline"));
    const row: OpenStackResourceBufferEntry = rowOf(
      rowsOfReport(report).rows,
      OpenStackResourceKind.Share,
      "ou-share-payments",
    );

    expect(row.facts["shareType"]).toBe("ou-alpha");
    expect(row.facts["backendHost"]).toBe(
      "compute-01@alpha#fake_pool_for_ALPHA",
    );
    expect(row.facts["accessRulesStatus"]).toBe("active");
    expect(row.status).toBe("available");
    expect(row.availabilityZone).toBe("manila-zone-0");
    expect(row.diskCapacityBytes).toBe(2 * 1024 * 1024 * 1024);
  });

  test("a share nothing placed has no backend, and says so by not saying", async () => {
    const { report } = await collect(loadScene(GROUP, "share-error"));
    const row: OpenStackResourceBufferEntry = rowOf(
      rowsOfReport(report).rows,
      OpenStackResourceKind.Share,
      "ou-share-error",
    );

    expect(row.status).toBe("error");
    expect(row.availabilityZone).toBe(null);
    expect(row.facts["backendHost"]).toBe(null);
  });

  test.each([
    ["baseline", "manila-share", "up"],
    ["share-service-stopped", "manila-share", "stopped"],
    ["share-service-killed", "manila-share", "down"],
    ["scheduler-stopped", "manila-scheduler", "stopped"],
    ["recovered", "manila-share", "up"],
  ])(
    "%s: %s reads %s, in Manila's word",
    async (name: string, binary: string, state: string) => {
      const { report, points } = await collect(loadScene(GROUP, name));
      const rows: Array<OpenStackResourceBufferEntry> = rowsOfReport(
        report,
      ).rows.filter((row: OpenStackResourceBufferEntry): boolean => {
        return row.kind === OpenStackResourceKind.Service && row.name === binary;
      });

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.status).toBe(state);
        expect(row.facts["family"]).toBe(
          OpenStackServiceType.SharedFileSystems,
        );
      }

      for (const point of pointsNamed(
        points,
        "openstack_sharev2_agent_state",
      ).filter((one: ReportedDatapoint): boolean => {
        return one.labels["service"] === binary;
      })) {
        expect(point.value).toBe(state === "up" ? 1 : 0);
        expect(point.labels["state"]).toBe(state);
      }
    },
  );

  test("each of a host's backends is a worker of its own, as Manila lists it", async () => {
    const { report } = await collect(loadScene(GROUP, "baseline"));

    expect(
      rowsOfReport(report)
        .rows.filter((row: OpenStackResourceBufferEntry): boolean => {
          return row.kind === OpenStackResourceKind.Service;
        })
        .map((row: OpenStackResourceBufferEntry): string => {
          return row.externalId;
        })
        .sort(),
    ).toEqual([
      "RegionOne/sharev2/compute-01/manila-data",
      "RegionOne/sharev2/compute-01/manila-scheduler",
      "RegionOne/sharev2/compute-01@alpha/manila-share",
      "RegionOne/sharev2/compute-01@slow/manila-share",
    ]);
  });

  test("a stopped service leaves its API up, which is why nothing else says so", async () => {
    const { points } = await collect(loadScene(GROUP, "share-service-stopped"));

    expect(pointsNamed(points, "openstack_sharev2_up")[0]?.value).toBe(1);
  });
});

describe("what it costs", () => {
  test("two reads a collection, at the microversion they were recorded at", async () => {
    const { requests } = await collect(loadScene(GROUP, "baseline"));
    const manila: Array<RecordedRequest> = requests.filter(
      (request: RecordedRequest): boolean => {
        return request.path.startsWith("/share/v2");
      },
    );

    expect(
      manila.map((request: RecordedRequest): string => {
        return request.path;
      }),
    ).toEqual(["/share/v2/shares/detail", "/share/v2/services"]);
    expect(manila[0]?.query).toContain("all_tenants=1");
    for (const request of manila) {
      expect(request.headers).toMatchObject(
        SHARED_FILE_SYSTEMS_MICROVERSION_HEADERS,
      );
    }
  });

  test("a list that's longer than a page is read by offset, because a marker means nothing to Manila", async () => {
    const scene: RecordedScene = loadScene(GROUP, "baseline");
    const all: Array<JSONObject> = recordedJson(
      scene,
      "manila-shares-versioned",
    )?.["shares"] as Array<JSONObject>;
    const queries: Array<string> = [];

    const { report } = await collectFromRecordedService({
      catalog: CATALOG,
      answer: (
        path: string,
        request: RecordedRequest,
      ): RecordedAnswer | undefined => {
        if (path !== "/share/v2/shares/detail") {
          return recordedCall(scene, callOf(path) || "");
        }
        queries.push(request.query);
        const offset: number = Number(
          new URLSearchParams(request.query).get("offset") || 0,
        );
        return {
          status: 200,
          body: JSON.stringify({
            shares: all.slice(offset, offset + 1),
            ...(offset + 1 < all.length
              ? {
                  shares_links: [
                    {
                      rel: "next",
                      href: `${MANILA_URL}/shares/detail?offset=${offset + 1}`,
                    },
                  ],
                }
              : {}),
          }),
        };
      },
    });

    expect(queries).toHaveLength(all.length);
    expect(queries[0]).not.toContain("offset=");
    expect(queries[1]).toContain("offset=1");
    for (const query of queries) {
      expect(query).not.toContain("marker=");
    }
    expect(
      rowsOfReport(report).rows.filter(
        (row: OpenStackResourceBufferEntry): boolean => {
          return row.kind === OpenStackResourceKind.Share;
        },
      ),
    ).toHaveLength(all.length);
  });
});

describe("a credential Manila refuses its services", () => {
  test("still reads its shares, says nothing of workers, and raises no alarm", async () => {
    const { report, points } = await collect(
      loadScene(GROUP, "baseline"),
      (path: string): RecordedAnswer | undefined => {
        return path === "/share/v2/services"
          ? { status: 403, body: '{"forbidden": {"code": 403}}' }
          : undefined;
      },
    );

    expect(pointsNamed(points, "openstack_sharev2_agent_state")).toEqual([]);
    expect(pointsNamed(points, "openstack_sharev2_up")[0]?.value).toBe(1);
    expect(pointsNamed(points, "openstack_sharev2_share_gb")).toHaveLength(2);
    expect(
      (report.summary?.warnings || []).filter((warning: string): boolean => {
        return warning.includes("Manila");
      }),
    ).toEqual([]);
  });
});

describe("a cloud without Manila", () => {
  test("is asked nothing about it, and sends nothing that could make a row", async () => {
    const { report, requests } = await collectFromRecordedService({
      catalog: [],
      answer: (): RecordedAnswer | undefined => {
        return undefined;
      },
    });

    expect(
      requests.filter((request: RecordedRequest): boolean => {
        return request.path.includes("share");
      }),
    ).toEqual([]);
    expect(
      rowsOfReport(report).rows.filter(
        (row: OpenStackResourceBufferEntry): boolean => {
          return (
            row.kind === OpenStackResourceKind.Share ||
            row.name === OpenStackServiceType.SharedFileSystems
          );
        },
      ),
    ).toEqual([]);
  });
});

describe("the connection test", () => {
  const scene: RecordedScene = loadScene(GROUP, "baseline");

  function readsOf(catalog: Array<JSONObject>): Promise<Array<OpenStackAccessRead>> {
    return testConnectionOnRecordedService({
      catalog,
      answer: (path: string): RecordedAnswer | undefined => {
        const call: string | undefined = callOf(path);
        return call ? recordedCall(scene, call) : undefined;
      },
    });
  }

  test("a cloud without Manila hears nothing of it", async () => {
    const reads: Array<OpenStackAccessRead> = await readsOf([]);

    expect(reads.length).toBeGreaterThan(0);
    expect(
      reads.filter((read: OpenStackAccessRead): boolean => {
        return read.service === OpenStackServiceType.SharedFileSystems;
      }),
    ).toEqual([]);
  });

  test("one with it is asked, and an admin reads every project's and its services", async () => {
    const reads: Array<OpenStackAccessRead> = (await readsOf(CATALOG)).filter(
      (read: OpenStackAccessRead): boolean => {
        return read.service === OpenStackServiceType.SharedFileSystems;
      },
    );

    expect(
      reads.map((read: OpenStackAccessRead): [string, string] => {
        return [read.read, read.access];
      }),
    ).toEqual([
      ["shares, all projects", "ReadsEverything"],
      ["services", "ReadsEverything"],
    ]);
  });
});
