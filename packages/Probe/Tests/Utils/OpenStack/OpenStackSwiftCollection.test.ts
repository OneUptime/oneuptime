import { describe, expect, test } from "@jest/globals";
import { OpenStackResourceBufferEntry } from "Common/Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONObject } from "Common/Types/JSON";
import { OpenStackAccessRead } from "Common/Types/OpenStack/OpenStackProbeCollection";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import { toSwiftAccountUrl } from "../../../Utils/OpenStack/Collectors/ObjectStoreCollector";
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
 * What a probe sends of Swift is what the agent sends, on the same real DevStack at the same moment
 * (services-designate-barbican-swift, stable/2026.1), plus whose each container is, which the exporter leaves out.
 * Its answer is a bare list, which nothing else here answers with.
 */

const GROUP: string = "services-designate-barbican-swift";
const PROJECT: string = "ae4a67bb74a44dddb73258c2b4fa0bb6";
const SWIFT_URL: string = `${RECORDED_HOST}/swift/v1/AUTH_${PROJECT}`;
const CATALOG: Array<JSONObject> = [catalogEntry("object-store", SWIFT_URL)];

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
      return path.endsWith(`/AUTH_${PROJECT}`)
        ? recordedCall(scene, "swift-account")
        : undefined;
    },
  });
}

function containers(
  rows: ReadonlyArray<OpenStackResourceBufferEntry>,
): Array<OpenStackResourceBufferEntry> {
  return rows.filter((row: OpenStackResourceBufferEntry): boolean => {
    return row.kind === OpenStackResourceKind.ObjectContainer;
  });
}

// The exporter's labels: a probe adds whose it is.
function withoutProject(series: ReadonlyArray<string>): Array<string> {
  return series.map((one: string): string => {
    const point: { labels: JSONObject; value: number } = JSON.parse(one) as {
      labels: JSONObject;
      value: number;
    };
    delete point.labels["tenant_id"];
    return JSON.stringify(point);
  });
}

describe("Swift, on what a real cloud said", () => {
  describe.each(["swift-baseline", "swift-object-down"])(
    "%s",
    (name: string) => {
      const scene: RecordedScene = loadScene(GROUP, name);

      test.each([
        "openstack_object_store_bytes",
        "openstack_object_store_objects",
      ])("%s is the exporter's, plus whose", async (metric: string) => {
        const { points } = await collect(scene);
        expect(withoutProject(comparableOfProbe(points, metric))).toEqual(
          comparableOfExporter(scene, metric),
        );
      });

      test("its API reads as the exporter's did", async () => {
        const { points } = await collect(scene);
        expect(comparableOfProbe(points, "openstack_object_store_up")).toEqual(
          comparableOfExporter(scene, "openstack_object_store_up"),
        );
      });
    },
  );

  test("says whose each is, which the exporter leaves out", async () => {
    const { report } = await collect(loadScene(GROUP, "swift-baseline"));
    const [row] = containers(rowsOfReport(report).rows);

    expect(row?.name).toBe("ou-container-admin");
    expect(row?.openStackProjectId).toBe(PROJECT);
    expect(row?.externalId).toBe(`RegionOne/${PROJECT}/ou-container-admin`);
  });

  test("api-down: nothing answers, and its API reads 0, as the exporter's did", async () => {
    const { points } = await collect(
      loadScene(GROUP, "swift-api-down"),
      (): RecordedAnswer => {
        return { status: 503, body: "Service Unavailable" };
      },
    );

    expect(pointsNamed(points, "openstack_object_store_up")[0]?.value).toBe(0);
    expect(pointsNamed(points, "openstack_object_store_bytes")).toEqual([]);
  });

  test("an account with nothing in it is an empty list, and no error", async () => {
    const { points, report } = await collect(
      loadScene(GROUP, "swift-baseline"),
      (): RecordedAnswer => {
        return { status: 200, body: "[]" };
      },
    );

    expect(pointsNamed(points, "openstack_object_store_up")[0]?.value).toBe(1);
    expect(containers(rowsOfReport(report).rows)).toEqual([]);
  });
});

describe("paging", () => {
  test("a full page asks again from the last name, and a short one stops", async () => {
    const queries: Array<string> = [];
    const page: (from: number, count: number) => string = (
      from: number,
      count: number,
    ): string => {
      return JSON.stringify(
        Array.from(
          { length: count },
          (_: unknown, index: number): JSONObject => {
            return { name: `c-${from + index}`, bytes: 1, count: 1 };
          },
        ),
      );
    };

    const { report } = await collectFromRecordedService({
      catalog: CATALOG,
      projectId: PROJECT,
      answer: (
        path: string,
        request: RecordedRequest,
      ): RecordedAnswer | undefined => {
        if (!path.endsWith(`/AUTH_${PROJECT}`)) {
          return undefined;
        }
        queries.push(request.query);
        const limit: number = Number(
          new URLSearchParams(request.query).get("limit"),
        );
        return {
          status: 200,
          body: queries.length === 1 ? page(0, limit) : page(limit, 1),
        };
      },
    });

    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain("format=json");
    expect(queries[1]).toMatch(/marker=c-\d+/);
    expect(containers(rowsOfReport(report).rows).length).toBeGreaterThan(1);
  });
});

describe("a credential with ResellerAdmin", () => {
  const scene: RecordedScene = loadScene(GROUP, "swift-reseller-admin");
  const OTHER: string = "877c6b7796f24d749487877296ae2f2c";

  async function collectAs(data: {
    roles: Array<string>;
    refuse?: boolean | undefined;
  }): Promise<RecordedServiceCollection & { otherReads: number }> {
    let otherReads: number = 0;
    const collected: RecordedServiceCollection =
      await collectFromRecordedService({
        catalog: CATALOG,
        projectId: PROJECT,
        roles: data.roles,
        projects: [
          { id: PROJECT, name: "admin" },
          { id: OTHER, name: "ou-payments" },
        ],
        answer: (path: string): RecordedAnswer | undefined => {
          if (path.endsWith(`/AUTH_${PROJECT}`)) {
            return recordedCall(scene, "swift-account");
          }
          if (path.endsWith(`/AUTH_${OTHER}`)) {
            otherReads++;
            return data.refuse
              ? { status: 403, body: "<html><h1>Forbidden</h1></html>" }
              : recordedCall(scene, "swift-account-ou-payments-as-admin");
          }
          return undefined;
        },
      });
    return { ...collected, otherReads };
  }

  test("reads every project's, one read an account, each row saying whose it is", async () => {
    const { report, otherReads } = await collectAs({
      roles: ["admin", "ResellerAdmin"],
    });
    const rows: Array<OpenStackResourceBufferEntry> = containers(
      rowsOfReport(report).rows,
    );

    expect(otherReads).toBe(1);
    expect(
      rows
        .map((row: OpenStackResourceBufferEntry): string => {
          return `${row.openStackProjectId} ${row.name}`;
        })
        .sort(),
    ).toEqual(
      [
        `${PROJECT} ou-container-admin`,
        `${OTHER} ou-container-payments`,
      ].sort(),
    );
  });

  test("a container of the same name in two projects is two rows", async () => {
    const { report } = await collectFromRecordedService({
      catalog: CATALOG,
      projectId: PROJECT,
      roles: ["ResellerAdmin"],
      projects: [{ id: OTHER, name: "ou-payments" }],
      answer: (): RecordedAnswer => {
        return {
          status: 200,
          body: JSON.stringify([{ name: "backups", bytes: 1, count: 1 }]),
        };
      },
    });

    expect(containers(rowsOfReport(report).rows)).toHaveLength(2);
  });

  test("without that role nobody else's is asked for, because a refusal is all it would get", async () => {
    expect((await collectAs({ roles: ["admin"] })).otherReads).toBe(0);
  });

  test("a role that isn't what it seemed is refused, and costs only what it reads", async () => {
    const { report, otherReads } = await collectAs({
      roles: ["ResellerAdmin"],
      refuse: true,
    });

    expect(otherReads).toBe(1);
    expect(containers(rowsOfReport(report).rows)).toHaveLength(1);
  });

  test("swaps the account in the catalog's address, and won't guess at one it can't read", () => {
    expect(
      toSwiftAccountUrl({
        ownAccountUrl: `http://swift/v1/AUTH_${PROJECT}`,
        ownProjectId: PROJECT,
        projectId: OTHER,
      }),
    ).toBe(`http://swift/v1/AUTH_${OTHER}`);
    expect(
      toSwiftAccountUrl({
        ownAccountUrl: "http://swift/v1/ACCOUNT",
        ownProjectId: PROJECT,
        projectId: OTHER,
      }),
    ).toBe(null);
  });
});

describe("a credential Swift refuses", () => {
  test("reads as answering, because it did, where the exporter says 0", async () => {
    const { points, report } = await collect(
      loadScene(GROUP, "swift-baseline"),
      (): RecordedAnswer => {
        return { status: 403, body: "<html><h1>Forbidden</h1></html>" };
      },
    );

    expect(pointsNamed(points, "openstack_object_store_up")[0]?.value).toBe(1);
    expect(containers(rowsOfReport(report).rows)).toEqual([]);
    expect(report.summary?.warnings.join(" ")).toContain("own account");
  });
});

describe("a cloud without Swift", () => {
  test("is asked nothing about it, and sends nothing that could make a row", async () => {
    const { report, requests } = await collectFromRecordedService({
      catalog: [],
      answer: (): RecordedAnswer | undefined => {
        return undefined;
      },
    });

    expect(
      requests.filter((request: RecordedRequest): boolean => {
        return request.path.includes("AUTH_");
      }),
    ).toEqual([]);
    expect(
      rowsOfReport(report).rows.filter(
        (row: OpenStackResourceBufferEntry): boolean => {
          return row.name === OpenStackServiceType.ObjectStore;
        },
      ),
    ).toEqual([]);
  });
});

describe("the connection test", () => {
  const scene: RecordedScene = loadScene(GROUP, "swift-baseline");

  function readsOf(
    catalog: Array<JSONObject>,
  ): Promise<Array<OpenStackAccessRead>> {
    return testConnectionOnRecordedService({
      catalog,
      projectId: PROJECT,
      answer: (path: string): RecordedAnswer | undefined => {
        return path.endsWith(`/AUTH_${PROJECT}`)
          ? recordedCall(scene, "swift-account")
          : undefined;
      },
    });
  }

  test("a cloud without Swift hears nothing of it", async () => {
    expect(
      (await readsOf([])).filter((read: OpenStackAccessRead): boolean => {
        return read.service === OpenStackServiceType.ObjectStore;
      }),
    ).toEqual([]);
  });

  test("one with it is asked about its own account, and can read a bare list", async () => {
    const reads: Array<OpenStackAccessRead> = (await readsOf(CATALOG)).filter(
      (read: OpenStackAccessRead): boolean => {
        return read.service === OpenStackServiceType.ObjectStore;
      },
    );
    expect(
      reads.map((read: OpenStackAccessRead): string => {
        return read.read;
      }),
    ).toEqual(["own account"]);
    expect(reads[0]?.access).toBe("ReadsEverything");
  });
});
