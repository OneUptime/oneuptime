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
import { ReportedDatapoint } from "./Helpers/CollectorHarness";
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
 * What a probe sends of Designate is what the agent sends, on the same real DevStack at the same moment
 * (services-designate-barbican-swift, stable/2026.1), apart from the one thing it doesn't ask for on purpose: the
 * recordsets of a zone that's ACTIVE, which takes the exporter a call per zone per scrape. Where it differs from the
 * agent is what a stopped API reads as: a probe reads the catalog, so it can say so, and the exporter can't.
 */

const GROUP: string = "services-designate-barbican-swift";
const DESIGNATE_URL: string = `${RECORDED_HOST}/dns`;
const CATALOG: Array<JSONObject> = [catalogEntry("dns", DESIGNATE_URL)];

const SCENES: ReadonlyArray<string> = [
  "designate-baseline",
  "designate-pending",
  "designate-error",
];

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
      if (path.endsWith("/v2/zones")) {
        return recordedCall(scene, "designate-zones");
      }
      if (path.endsWith("/v2/service_statuses")) {
        return recordedCall(scene, "designate-service-statuses");
      }
      const zone: RegExpMatchArray | null = path.match(
        /\/v2\/zones\/([^/]+)\/recordsets$/,
      );
      if (zone) {
        const answer: JSONObject = JSON.parse(
          scene.api.get("designate-zones") as string,
        ) as JSONObject;
        const name: string = (answer["zones"] as Array<JSONObject>).find(
          (one: JSONObject): boolean => {
            return one["id"] === zone[1];
          },
        )?.["name"] as string;
        return recordedCall(scene, `designate-recordsets-${name}`);
      }
      return undefined;
    },
  });
}

function rowsOfKind(
  rows: ReadonlyArray<OpenStackResourceBufferEntry>,
  kind: OpenStackResourceKind,
): Array<OpenStackResourceBufferEntry> {
  return rows.filter((row: OpenStackResourceBufferEntry): boolean => {
    return row.kind === kind;
  });
}

describe("Designate, on what a real cloud said", () => {
  describe.each(SCENES)("%s", (name: string) => {
    const scene: RecordedScene = loadScene(GROUP, name);

    test.each(["openstack_designate_zones", "openstack_designate_up"])(
      "%s is the exporter's",
      async (metric: string) => {
        const { points } = await collect(scene);
        expect(comparableOfProbe(points, metric)).toEqual(
          comparableOfExporter(scene, metric),
        );
      },
    );

    test("each zone's status is the exporter's, code and labels", async () => {
      const { points } = await collect(scene);
      expect(
        comparableOfProbe(points, "openstack_designate_zone_status"),
      ).toEqual(comparableOfExporter(scene, "openstack_designate_zone_status"));
    });

    test("a recordset read reads as the exporter's did: this just doesn't read ACTIVE zones'", async () => {
      const { points } = await collect(scene);
      const exporter: Array<unknown> = comparableOfExporter(
        scene,
        "openstack_designate_recordsets_status",
      );
      for (const one of comparableOfProbe(
        points,
        "openstack_designate_recordsets_status",
      )) {
        expect(exporter).toContainEqual(one);
      }
    });
  });

  test("api-down: a probe reads the catalog first, so what a stopped API reads is 0, where the exporter says nothing", async () => {
    const scene: RecordedScene = loadScene(GROUP, "designate-api-down");
    const { points } = await collect(scene, (): RecordedAnswer => {
      return { status: 503, body: "Service Unavailable" };
    });

    expect(pointsNamed(points, "openstack_designate_up")[0]?.value).toBe(0);
    expect(pointsNamed(points, "openstack_designate_zone_status")).toEqual([]);
  });
});

describe("what it costs", () => {
  test("a call per zone that isn't ACTIVE, and none for one that is", async () => {
    const { requests } = await collect(loadScene(GROUP, "designate-error"));
    const zones: Array<string> = requests
      .filter((request: RecordedRequest): boolean => {
        return request.path.endsWith("/recordsets");
      })
      .map((request: RecordedRequest): string => {
        return request.path;
      });

    // ou-active is PENDING and ou-error is ERROR: the other two are ACTIVE.
    expect(zones).toHaveLength(2);
  });

  test("asks with the header that reads every project's", async () => {
    const { requests } = await collect(loadScene(GROUP, "designate-baseline"));
    const first: RecordedRequest | undefined = requests.find(
      (request: RecordedRequest): boolean => {
        return request.path.endsWith("/v2/zones");
      },
    );
    expect(first?.headers?.["X-Auth-All-Projects"]).toBe("true");
  });
});

describe("what only a native read says", () => {
  test("Designate's workers, as its own list says them", async () => {
    const { points } = await collect(loadScene(GROUP, "designate-baseline"));
    const states: Array<ReportedDatapoint> = pointsNamed(
      points,
      "openstack_designate_agent_state",
    );
    expect(states).toHaveLength(5);
    expect(
      states.every((one: { value: number }): boolean => {
        return one.value === 1;
      }),
    ).toBe(true);
  });

  test("a stopped worker reads UP for a while yet, recorded, and its zones are what say so", async () => {
    const { report, points } = await collect(
      loadScene(GROUP, "designate-pending"),
    );

    expect(
      pointsNamed(points, "openstack_designate_agent_state").every(
        (one: { value: number }): boolean => {
          return one.value === 1;
        },
      ),
    ).toBe(true);
    expect(
      rowsOfKind(
        rowsOfReport(report).rows,
        OpenStackResourceKind.DnsZone,
      ).filter((row: OpenStackResourceBufferEntry): boolean => {
        return row.status === "PENDING";
      }),
    ).toHaveLength(2);
  });

  test("a recordset's row is made for what isn't ACTIVE, whichever collector said so", async () => {
    const { report } = await collect(loadScene(GROUP, "designate-error"));

    expect(
      rowsOfKind(rowsOfReport(report).rows, OpenStackResourceKind.DnsRecordset)
        .map((row: OpenStackResourceBufferEntry): string | null => {
          return row.status;
        })
        .every((status: string | null): boolean => {
          return status !== "ACTIVE";
        }),
    ).toBe(true);
  });
});

describe("a credential Designate refuses", () => {
  test("reads as answering, because it did, and the exporter can't say that", async () => {
    const scene: RecordedScene = loadScene(GROUP, "designate-baseline");
    const { points, report } = await collect(scene, (): RecordedAnswer => {
      return { status: 403, body: '{"message": "Forbidden"}' };
    });

    expect(pointsNamed(points, "openstack_designate_up")[0]?.value).toBe(1);
    expect(report.summary?.warnings.join(" ")).toContain("zones");
    expect(
      rowsOfKind(rowsOfReport(report).rows, OpenStackResourceKind.DnsZone),
    ).toEqual([]);
  });
});

describe("a cloud without Designate", () => {
  test("is asked nothing about it, and sends nothing that could make a row", async () => {
    const { report, requests } = await collectFromRecordedService({
      catalog: [],
      answer: (): RecordedAnswer | undefined => {
        return undefined;
      },
    });

    expect(
      requests.filter((request: RecordedRequest): boolean => {
        return request.path.includes("/v2/zones");
      }),
    ).toEqual([]);
    expect(
      rowsOfReport(report).rows.filter(
        (row: OpenStackResourceBufferEntry): boolean => {
          return row.name === OpenStackServiceType.Dns;
        },
      ),
    ).toEqual([]);
  });
});

describe("the connection test", () => {
  const scene: RecordedScene = loadScene(GROUP, "designate-baseline");

  function readsOf(
    catalog: Array<JSONObject>,
  ): Promise<Array<OpenStackAccessRead>> {
    return testConnectionOnRecordedService({
      catalog,
      answer: (path: string): RecordedAnswer | undefined => {
        return path.endsWith("/v2/zones")
          ? recordedCall(scene, "designate-zones")
          : undefined;
      },
    });
  }

  test("a cloud without Designate hears nothing of it", async () => {
    expect(
      (await readsOf([])).filter((read: OpenStackAccessRead): boolean => {
        return read.service === OpenStackServiceType.Dns;
      }),
    ).toEqual([]);
  });

  test("one with it is asked, on its catalog's own address", async () => {
    expect(
      (await readsOf(CATALOG))
        .filter((read: OpenStackAccessRead): boolean => {
          return read.service === OpenStackServiceType.Dns;
        })
        .map((read: OpenStackAccessRead): string => {
          return read.read;
        }),
    ).toEqual(["zones, all projects"]);
  });
});
