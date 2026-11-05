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
  comparableOfExporter,
  comparableOfProbe,
  pointsNamed,
  recordedCall,
  rowsOfReport,
  testConnectionOnRecordedService,
} from "./Helpers/RecordedServiceCloud";

/*
 * What a probe sends of Gnocchi is what the agent sends, on the same real DevStack at the same moment
 * (services-gnocchi, stable/2026.1). Where it differs is what a refusal reads as: Gnocchi answered, so its API is
 * up, where the exporter says 0.
 */

const GROUP: string = "services-gnocchi";
const GNOCCHI_URL: string = `${RECORDED_HOST}/metric`;
const CATALOG: Array<JSONObject> = [catalogEntry("metric", GNOCCHI_URL)];

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
      return path.endsWith("/v1/status")
        ? recordedCall(scene, "gnocchi-status")
        : undefined;
    },
  });
}

describe("Gnocchi, on what a real cloud said", () => {
  describe.each([
    "baseline",
    "metricd-stopped",
    "backlog-growing",
    "backlog-growing-more",
    "recovered",
  ])("%s", (name: string) => {
    const scene: RecordedScene = loadScene(GROUP, name);

    test.each([
      "openstack_gnocchi_status_metricd_processors",
      "openstack_gnocchi_up",
    ])("%s is the exporter's", async (metric: string) => {
      const { points } = await collect(scene);
      expect(comparableOfProbe(points, metric)).toEqual(
        comparableOfExporter(scene, metric),
      );
    });
  });

  test("the backlog it reads is what its own status said", async () => {
    const { points } = await collect(loadScene(GROUP, "backlog-growing-more"));

    expect(
      pointsNamed(points, "openstack_gnocchi_status_measures_to_process")[0]
        ?.value,
    ).toBe(
      (
        JSON.parse(
          loadScene(GROUP, "backlog-growing-more").api.get(
            "gnocchi-status",
          ) as string,
        ) as { storage: { summary: { measures: number } } }
      ).storage.summary.measures,
    );
  });

  test("api-down: nothing answers, and its API reads 0, as the exporter's did", async () => {
    const { points } = await collect(
      loadScene(GROUP, "api-down"),
      (): RecordedAnswer => {
        return { status: 503, body: "Service Unavailable" };
      },
    );

    expect(pointsNamed(points, "openstack_gnocchi_up")[0]?.value).toBe(0);
    expect(
      pointsNamed(points, "openstack_gnocchi_status_metricd_processors"),
    ).toEqual([]);
  });
});

describe("a credential Gnocchi refuses", () => {
  test("reads as answering, because it did, and says nothing else", async () => {
    const { points, report } = await collect(
      loadScene(GROUP, "baseline"),
      (): RecordedAnswer => {
        return { status: 403, body: '{"message": "Forbidden"}' };
      },
    );

    expect(pointsNamed(points, "openstack_gnocchi_up")[0]?.value).toBe(1);
    expect(
      pointsNamed(points, "openstack_gnocchi_status_metricd_processors"),
    ).toEqual([]);
    expect(report.summary?.warnings.join(" ")).toContain("status");
  });
});

describe("a cloud without Gnocchi", () => {
  test("is asked nothing about it, and sends nothing that could make a row", async () => {
    const { report, requests } = await collectFromRecordedService({
      catalog: [],
      answer: (): RecordedAnswer | undefined => {
        return undefined;
      },
    });

    expect(
      requests.filter((request: RecordedRequest): boolean => {
        return request.path.includes("/v1/status");
      }),
    ).toEqual([]);
    expect(
      rowsOfReport(report).rows.filter(
        (row: OpenStackResourceBufferEntry): boolean => {
          return row.name === OpenStackServiceType.Metric;
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
      answer: (path: string): RecordedAnswer | undefined => {
        return path.endsWith("/v1/status")
          ? recordedCall(scene, "gnocchi-status")
          : undefined;
      },
    });
  }

  test("a cloud without Gnocchi hears nothing of it", async () => {
    expect(
      (await readsOf([])).filter((read: OpenStackAccessRead): boolean => {
        return read.service === OpenStackServiceType.Metric;
      }),
    ).toEqual([]);
  });

  test("one with it is asked", async () => {
    expect(
      (await readsOf(CATALOG))
        .filter((read: OpenStackAccessRead): boolean => {
          return read.service === OpenStackServiceType.Metric;
        })
        .map((read: OpenStackAccessRead): string => {
          return read.read;
        }),
    ).toEqual(["status"]);
  });
});
