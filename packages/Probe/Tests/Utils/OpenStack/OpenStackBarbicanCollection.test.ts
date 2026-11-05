import { describe, expect, test } from "@jest/globals";
import { OpenStackResourceBufferEntry } from "Common/Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONObject } from "Common/Types/JSON";
import { OpenStackAccessRead } from "Common/Types/OpenStack/OpenStackProbeCollection";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
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
  pointsNamed,
  recordedCall,
  rowsOfReport,
  testConnectionOnRecordedService,
} from "./Helpers/RecordedServiceCloud";

/*
 * Barbican, which only a probe can say anything of: the exporter has no reader for it, and asking for it is a 400,
 * recorded. So there's nothing here to hold it to but what Barbican answered, on a real DevStack (stable/2026.1).
 */

const GROUP: string = "services-designate-barbican-swift";
const BARBICAN_URL: string = `${RECORDED_HOST}/key-manager`;
const CATALOG: Array<JSONObject> = [catalogEntry("key-manager", BARBICAN_URL)];

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
      for (const list of ["secrets", "orders", "containers"]) {
        if (path.endsWith(`/v1/${list}`)) {
          return recordedCall(scene, `barbican-${list}`);
        }
      }
      return undefined;
    },
  });
}

describe("Barbican, on what a real cloud said", () => {
  test("its API reads up, with how many of each this project holds", async () => {
    const { points } = await collect(loadScene(GROUP, "barbican-baseline"));

    expect(pointsNamed(points, "openstack_barbican_up")[0]?.value).toBe(1);
    expect(pointsNamed(points, "openstack_barbican_secrets")[0]?.value).toBe(2);
    expect(pointsNamed(points, "openstack_barbican_orders")[0]?.value).toBe(1);
    expect(pointsNamed(points, "openstack_barbican_containers")[0]?.value).toBe(
      0,
    );
  });

  test("it reads on its API's row, and makes no other", async () => {
    const { report } = await collect(loadScene(GROUP, "barbican-baseline"));
    const rows: Array<OpenStackResourceBufferEntry> = rowsOfReport(
      report,
    ).rows.filter((row: OpenStackResourceBufferEntry): boolean => {
      return row.name === OpenStackServiceType.KeyManager;
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe(OpenStackServiceType.KeyManager);
    expect(rows[0]?.status).toBe("up");
    expect(rows[0]?.facts["secretCount"]).toBe(2);
    expect(rows[0]?.facts["orderCount"]).toBe(1);
    expect(rows[0]?.facts["containerCount"]).toBe(0);
  });

  test("api-down: a 503, recorded, and its API reads 0", async () => {
    const { points } = await collect(
      loadScene(GROUP, "barbican-api-down"),
      (): RecordedAnswer => {
        return { status: 503, body: "Service Unavailable" };
      },
    );

    expect(pointsNamed(points, "openstack_barbican_up")[0]?.value).toBe(0);
    expect(pointsNamed(points, "openstack_barbican_secrets")).toEqual([]);
  });
});

describe("what it asks", () => {
  test("one row of each list, because the total is all it wants: it reads no secret", async () => {
    const { requests } = await collect(loadScene(GROUP, "barbican-baseline"));
    const lists: Array<RecordedRequest> = requests.filter(
      (request: RecordedRequest): boolean => {
        return request.path.includes("/v1/");
      },
    );

    expect(lists).toHaveLength(3);
    for (const request of lists) {
      expect(request.query).toContain("limit=1");
      expect(request.path).not.toContain("/payload");
    }
  });
});

describe("a credential Barbican refuses", () => {
  test("reads as answering, because it did, and the counts say nothing", async () => {
    const { points, report } = await collect(
      loadScene(GROUP, "barbican-baseline"),
      (): RecordedAnswer => {
        return { status: 403, body: '{"title": "Forbidden"}' };
      },
    );

    expect(pointsNamed(points, "openstack_barbican_up")[0]?.value).toBe(1);
    expect(pointsNamed(points, "openstack_barbican_secrets")).toEqual([]);
    expect(report.summary?.warnings.join(" ")).toContain("secrets");
  });
});

describe("a cloud without Barbican", () => {
  test("is asked nothing about it, and sends nothing that could make a row", async () => {
    const { report, requests } = await collectFromRecordedService({
      catalog: [],
      answer: (): RecordedAnswer | undefined => {
        return undefined;
      },
    });

    expect(
      requests.filter((request: RecordedRequest): boolean => {
        return request.path.includes("/v1/secrets");
      }),
    ).toEqual([]);
    expect(
      rowsOfReport(report).rows.filter(
        (row: OpenStackResourceBufferEntry): boolean => {
          return row.name === OpenStackServiceType.KeyManager;
        },
      ),
    ).toEqual([]);
  });
});

describe("the connection test", () => {
  const scene: RecordedScene = loadScene(GROUP, "barbican-baseline");

  function readsOf(
    catalog: Array<JSONObject>,
  ): Promise<Array<OpenStackAccessRead>> {
    return testConnectionOnRecordedService({
      catalog,
      answer: (path: string): RecordedAnswer | undefined => {
        return path.endsWith("/v1/secrets")
          ? recordedCall(scene, "barbican-secrets")
          : path.endsWith("/v1/orders")
            ? recordedCall(scene, "barbican-orders")
            : undefined;
      },
    });
  }

  test("a cloud without Barbican hears nothing of it", async () => {
    expect(
      (await readsOf([])).filter((read: OpenStackAccessRead): boolean => {
        return read.service === OpenStackServiceType.KeyManager;
      }),
    ).toEqual([]);
  });

  test("one with it is asked for how many of each", async () => {
    expect(
      (await readsOf(CATALOG))
        .filter((read: OpenStackAccessRead): boolean => {
          return read.service === OpenStackServiceType.KeyManager;
        })
        .map((read: OpenStackAccessRead): string => {
          return read.read;
        }),
    ).toEqual(["secrets", "orders"]);
  });
});
