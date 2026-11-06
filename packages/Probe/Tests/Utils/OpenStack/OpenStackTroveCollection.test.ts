import { describe, expect, test } from "@jest/globals";
import { OpenStackResourceBufferEntry } from "Common/Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONObject } from "Common/Types/JSON";
import { OpenStackAccessRead } from "Common/Types/OpenStack/OpenStackProbeCollection";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  RECORDED_HOST,
  RecordedScene,
  loadScene,
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
 * What a probe sends of Trove is what the agent sends, on the same real DevStack at the same moment
 * (services-trove, stable/2026.1), plus what only a native read can add: why one failed. Where it differs
 * from the agent is what a refusal reads as: Trove answered, so its API is up, where the exporter says 0.
 */

const GROUP: string = "services-trove";
const PROJECT: string = "4d0acfc18c9d4a0b994a7fe34516bf65";
const TROVE_URL: string = `${RECORDED_HOST}/database/v1.0/${PROJECT}`;
const CATALOG: Array<JSONObject> = [catalogEntry("database", TROVE_URL)];

const SCENES: ReadonlyArray<string> = [
  "baseline",
  "instance-building",
  "instance-error",
  "taskmanager-down",
];

async function collect(
  scene: RecordedScene,
  override?: ((path: string) => RecordedAnswer | undefined) | undefined,
): Promise<RecordedServiceCollection> {
  return await collectFromRecordedService({
    catalog: CATALOG,
    projectId: PROJECT,
    answer: (path: string): RecordedAnswer | undefined => {
      const overridden: RecordedAnswer | undefined = override?.(path);
      if (overridden) {
        return overridden;
      }
      return path.endsWith("/mgmt/instances")
        ? recordedCall(scene, "trove-mgmt-instances")
        : undefined;
    },
  });
}

function databases(
  rows: ReadonlyArray<OpenStackResourceBufferEntry>,
): Array<OpenStackResourceBufferEntry> {
  return rows.filter((row: OpenStackResourceBufferEntry): boolean => {
    return row.kind === OpenStackResourceKind.DatabaseInstance;
  });
}

describe("Trove, on what a real cloud said", () => {
  describe.each(SCENES)("%s", (name: string) => {
    const scene: RecordedScene = loadScene(GROUP, name);

    test.each([
      "openstack_trove_instance_status",
      "openstack_trove_instance_volume_size_gb",
      "openstack_trove_instance_volume_used_gb",
      "openstack_trove_total_instances",
      "openstack_trove_up",
    ])("%s is the exporter's, label for label", async (metric: string) => {
      const { points } = await collect(scene);
      expect(comparableOfProbe(points, metric)).toEqual(
        comparableOfExporter(scene, metric),
      );
    });
  });

  test("api-down: nothing answers, and its API reads 0, as the exporter's did", async () => {
    const scene: RecordedScene = loadScene(GROUP, "api-down");
    const { points } = await collect(scene, (): RecordedAnswer => {
      return { status: 503, body: "Service Unavailable" };
    });

    expect(pointsNamed(points, "openstack_trove_up")[0]?.value).toBe(0);
    expect(pointsNamed(points, "openstack_trove_instance_status")).toEqual([]);
  });
});

describe("what only a native read says", () => {
  test("why one failed, in Trove's words, on its row", async () => {
    const { report } = await collect(loadScene(GROUP, "instance-error"));
    const row: OpenStackResourceBufferEntry | undefined = databases(
      rowsOfReport(report).rows,
    ).find((one: OpenStackResourceBufferEntry): boolean => {
      return one.name === "ou-db-no-host";
    });

    expect(row?.status).toBe("ERROR");
    expect(row?.facts["faultMessage"]).toContain("Flavor's disk is too small");
    expect(row?.facts["taskDescription"]).toBe("Build error: Server.");
  });

  test("one on its way says nothing of why, and carries nothing old", async () => {
    const { report } = await collect(loadScene(GROUP, "instance-building"));
    const [row] = databases(rowsOfReport(report).rows);

    expect(row?.facts["faultMessage"]).toBe(null);
  });

  test("a guest that reports fills in how much of its volume is used, made up because none has", async () => {
    const scene: RecordedScene = loadScene(GROUP, "instance-building");
    const answer: JSONObject = JSON.parse(
      scene.api.get("trove-mgmt-instances") as string,
    ) as JSONObject;
    const [instance] = answer["instances"] as Array<JSONObject>;
    (instance as JSONObject)["status"] = "ACTIVE";
    (instance as JSONObject)["volume"] = { size: 10, used: 9 };

    const { report } = await collect(scene, (): RecordedAnswer => {
      return { status: 200, body: JSON.stringify(answer) };
    });
    const [row] = databases(rowsOfReport(report).rows);

    expect(row?.diskCapacityBytes).toBe(10 * 1024 * 1024 * 1024);
    expect(row?.diskAllocatedBytes).toBe(9 * 1024 * 1024 * 1024);
  });
});

describe("a credential Trove refuses", () => {
  test("Trove answered, so its API isn't called down, and nothing of it is sent", async () => {
    const { points, report } = await collect(
      loadScene(GROUP, "baseline"),
      (): RecordedAnswer => {
        return { status: 403, body: "Access was denied to this resource." };
      },
    );

    expect(pointsNamed(points, "openstack_trove_instance_status")).toEqual([]);
    expect(report.summary?.warnings.join(" ")).toContain("instances");
  });
});

describe("what it costs", () => {
  test("one read a collection, of what the exporter asks", async () => {
    const { requests } = await collect(loadScene(GROUP, "instance-error"));
    const trove: Array<RecordedRequest> = requests.filter(
      (request: RecordedRequest): boolean => {
        return request.path.startsWith("/database/");
      },
    );

    expect(trove).toHaveLength(1);
    expect(trove[0]?.path).toBe(`/database/v1.0/${PROJECT}/mgmt/instances`);
    expect(trove[0]?.query).toContain("include_clustered=False");
    expect(trove[0]?.query).toContain("deleted=False");
  });

  test("a list longer than a page follows Trove's own next link, by marker", async () => {
    const scene: RecordedScene = loadScene(GROUP, "instance-error");
    const all: Array<JSONObject> = (
      JSON.parse(scene.api.get("trove-mgmt-instances") as string) as JSONObject
    )["instances"] as Array<JSONObject>;
    const queries: Array<string> = [];

    const { report } = await collectFromRecordedService({
      catalog: CATALOG,
      projectId: PROJECT,
      answer: (
        path: string,
        request: RecordedRequest,
      ): RecordedAnswer | undefined => {
        if (!path.endsWith("/mgmt/instances")) {
          return undefined;
        }
        queries.push(request.query);
        const isFirst: boolean = !request.query.includes("marker=");
        return {
          status: 200,
          body: JSON.stringify({
            instances: isFirst ? [all[0]] : [all[1]],
            links: isFirst ? [{ rel: "next", href: `${TROVE_URL}/x` }] : [],
          }),
        };
      },
    });

    expect(queries).toHaveLength(2);
    expect(queries[1]).toContain(`marker=${all[0]?.["id"]}`);
    expect(databases(rowsOfReport(report).rows)).toHaveLength(2);
  });
});

describe("a cloud without Trove", () => {
  test("is asked nothing about it, and sends nothing that could make a row", async () => {
    const { report, requests } = await collectFromRecordedService({
      catalog: [],
      answer: (): RecordedAnswer | undefined => {
        return undefined;
      },
    });

    expect(
      requests.filter((request: RecordedRequest): boolean => {
        return request.path.includes("database");
      }),
    ).toEqual([]);
    expect(
      rowsOfReport(report).rows.filter(
        (row: OpenStackResourceBufferEntry): boolean => {
          return row.name === OpenStackServiceType.Database;
        },
      ),
    ).toEqual([]);
  });
});

describe("the connection test", () => {
  const scene: RecordedScene = loadScene(GROUP, "baseline");

  function readsOf(
    catalog: Array<JSONObject>,
  ): Promise<Array<OpenStackAccessRead>> {
    return testConnectionOnRecordedService({
      catalog,
      projectId: PROJECT,
      answer: (path: string): RecordedAnswer | undefined => {
        return path.endsWith("/mgmt/instances")
          ? recordedCall(scene, "trove-mgmt-instances")
          : undefined;
      },
    });
  }

  test("a cloud without Trove hears nothing of it", async () => {
    expect(
      (await readsOf([])).filter((read: OpenStackAccessRead): boolean => {
        return read.service === OpenStackServiceType.Database;
      }),
    ).toEqual([]);
  });

  test("one with it is asked, on its catalog's own address", async () => {
    expect(
      (await readsOf(CATALOG))
        .filter((read: OpenStackAccessRead): boolean => {
          return read.service === OpenStackServiceType.Database;
        })
        .map((read: OpenStackAccessRead): string => {
          return read.read;
        }),
    ).toEqual(["instances, all projects"]);
  });
});
