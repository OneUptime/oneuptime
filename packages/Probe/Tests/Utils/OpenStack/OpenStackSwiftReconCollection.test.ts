import { describe, expect, test } from "@jest/globals";
import { OpenStackResourceBufferEntry } from "Common/Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONObject } from "Common/Types/JSON";
import OpenStackCollectionSettings from "Common/Utils/OpenStack/OpenStackCollectionSettings";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import fs from "fs";
import path from "path";
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
} from "./Helpers/RecordedServiceCloud";

/*
 * What Swift's storage servers said through /recon, on a real DevStack (stable/2026.1): its one replica's account,
 * container and object servers, each on a port of its own, with no token. The object server was stopped for one
 * scene, and didn't answer. Two servers disagreeing about a ring is made up, because a runner has the one.
 */

const GROUP: string = "services-designate-barbican-swift";
const PROJECT: string = "ae4a67bb74a44dddb73258c2b4fa0bb6";
const SWIFT_URL: string = `${RECORDED_HOST}/swift/v1/AUTH_${PROJECT}`;
const CATALOG: Array<JSONObject> = [catalogEntry("object-store", SWIFT_URL)];
const TARGETS: Record<string, string> = {
  "10.0.0.5:6611": "container",
  "10.0.0.5:6612": "account",
  "10.0.0.5:6613": "object",
};

function reconOf(
  scene: string,
  target: string,
  call: string,
): RecordedAnswer | undefined {
  const file: string = path.join(
    __dirname,
    "../../../../Common/Tests/Fixtures/OpenStack",
    GROUP,
    scene,
    "recon",
    `${target}-${call}.json`,
  );
  return fs.existsSync(file)
    ? { status: 200, body: fs.readFileSync(file, "utf8") }
    : undefined;
}

async function collect(data: {
  sceneName: string;
  addresses: Array<string>;
  answerRecon?:
    | ((target: string, call: string) => RecordedAnswer | undefined)
    | undefined;
}): Promise<RecordedServiceCollection & { reconReads: number }> {
  const scene: RecordedScene = loadScene(GROUP, data.sceneName);
  let reconReads: number = 0;
  const collected: RecordedServiceCollection = await collectFromRecordedService(
    {
      catalog: CATALOG,
      projectId: PROJECT,
      options: { swiftReconAddresses: data.addresses },
      answer: (
        routePath: string,
        request: RecordedRequest,
      ): RecordedAnswer | undefined => {
        if (routePath.endsWith(`/AUTH_${PROJECT}`)) {
          return recordedCall(scene, "swift-account");
        }
        if (!routePath.startsWith("/recon/")) {
          return undefined;
        }
        reconReads++;
        expect(request.headers["X-Auth-Token"]).toBeUndefined();
        const call: string = routePath
          .substring("/recon/".length)
          .replace("/", "-");
        const target: string = TARGETS[request.host] || "object";
        return data.answerRecon
          ? data.answerRecon(target, call)
          : reconOf(data.sceneName, target, call);
      },
    },
  );
  return { ...collected, reconReads };
}

function apiRow(
  report: RecordedServiceCollection["report"],
): OpenStackResourceBufferEntry | undefined {
  return rowsOfReport(report).rows.find(
    (row: OpenStackResourceBufferEntry): boolean => {
      return row.name === OpenStackServiceType.ObjectStore;
    },
  );
}

describe("no storage servers named", () => {
  test("costs nothing, says there are none, and carries no word from them", async () => {
    const { points, reconReads, report } = await collect({
      sceneName: "swift-baseline",
      addresses: [],
    });

    expect(reconReads).toBe(0);
    expect(pointsNamed(points, "openstack_object_store_recon_up")).toEqual([]);
    expect(apiRow(report)?.facts["reconServers"]).toBe(0);
    expect(apiRow(report)?.facts["reconRingsDiffering"]).toBe(null);
  });
});

describe("on what a real cloud's servers said", () => {
  test("each answers, with its replication and its rings, with no token", async () => {
    const { points, report, reconReads } = await collect({
      sceneName: "swift-baseline",
      addresses: Object.keys(TARGETS),
    });

    expect(reconReads).toBe(15);
    expect(
      pointsNamed(points, "openstack_object_store_recon_up").map(
        (point: { value: number }): number => {
          return point.value;
        },
      ),
    ).toEqual([1, 1, 1]);
    expect(
      pointsNamed(points, "openstack_object_store_recon_replication_failures")
        .length,
    ).toBe(9);
    expect(apiRow(report)?.facts["reconServers"]).toBe(3);
    expect(apiRow(report)?.facts["reconServersNotAnswering"]).toBe(0);
    expect(apiRow(report)?.facts["reconRingsDiffering"]).toBe(0);
  });

  test("the same ring on each reads as the same, recorded, for each ring there is", async () => {
    const { points } = await collect({
      sceneName: "swift-baseline",
      addresses: Object.keys(TARGETS),
    });

    expect(
      pointsNamed(points, "openstack_object_store_recon_rings_differ").map(
        (point: { labels: Record<string, unknown>; value: number }): string => {
          return `${point.labels["ring"]} ${point.value}`;
        },
      ),
    ).toEqual(["account 0", "container 0", "object 0", "object-1 0"]);
  });

  test("a drive it says isn't mounted reads as one, recorded on DevStack's loopback", async () => {
    const { points } = await collect({
      sceneName: "swift-baseline",
      addresses: ["10.0.0.5:6613"],
    });

    expect(
      pointsNamed(points, "openstack_object_store_recon_unmounted_drives")[0]
        ?.value,
    ).toBe(1);
  });

  test("swift-object-down: the stopped one doesn't answer, and its proxy reads up", async () => {
    const { points, report } = await collect({
      sceneName: "swift-object-down",
      addresses: Object.keys(TARGETS),
      answerRecon: (target: string, call: string) => {
        // Recorded as a refused connection: 000000 for all of the object server's.
        return target === "object"
          ? { status: 503, body: "" }
          : reconOf("swift-object-down", target, call);
      },
    });

    expect(pointsNamed(points, "openstack_object_store_up")[0]?.value).toBe(1);
    expect(apiRow(report)?.facts["reconServersNotAnswering"]).toBe(1);
    expect(
      pointsNamed(points, "openstack_object_store_recon_up")
        .filter((point: { value: number }): boolean => {
          return point.value === 0;
        })
        .map((point: { labels: Record<string, unknown> }): unknown => {
          return point.labels["address"];
        }),
    ).toEqual(["10.0.0.5:6613"]);
  });

  test("swift-api-down: its storage servers go on answering, recorded, with its proxy down", async () => {
    const { points } = await collect({
      sceneName: "swift-api-down",
      addresses: ["10.0.0.5:6613"],
    });

    expect(
      pointsNamed(points, "openstack_object_store_recon_up")[0]?.value,
    ).toBe(1);
  });
});

describe("two servers disagreeing about a ring, made up", () => {
  test("reads as that ring differing, and no other", async () => {
    const { points, report } = await collect({
      sceneName: "swift-baseline",
      addresses: ["10.0.0.5:6612", "10.0.0.5:6613"],
      answerRecon: (target: string, call: string) => {
        if (call === "ringmd5" && target === "object") {
          const said: JSONObject = JSON.parse(
            reconOf("swift-baseline", target, call)?.body as string,
          ) as JSONObject;
          said["/etc/swift/object.ring.gz"] = "not-the-same";
          return { status: 200, body: JSON.stringify(said) };
        }
        return reconOf("swift-baseline", target, call);
      },
    });

    expect(
      pointsNamed(points, "openstack_object_store_recon_rings_differ")
        .filter((point: { value: number }): boolean => {
          return point.value === 1;
        })
        .map((point: { labels: Record<string, unknown> }): unknown => {
          return point.labels["ring"];
        }),
    ).toEqual(["object"]);
    expect(apiRow(report)?.facts["reconRingsDiffering"]).toBe(1);
  });
});

describe("the setting", () => {
  test.each([
    ["10.0.0.5:6200"],
    ["swift-01.internal:6200"],
    ["[fd00::5]:6200"],
  ])("%s is a host and port", (address: string) => {
    expect(
      OpenStackCollectionSettings.normalizeOptions({
        swiftReconAddresses: [address],
      }).options?.swiftReconAddresses,
    ).toEqual([address]);
  });

  test.each([
    ["10.0.0.5"],
    ["http://10.0.0.5:6200"],
    ["10.0.0.5:6200/recon"],
    ["a b:6200"],
    [`${"a".repeat(400)}:6200`],
  ])("%s isn't", (address: string) => {
    expect(
      OpenStackCollectionSettings.normalizeOptions({
        swiftReconAddresses: [address],
      }).error,
    ).toContain("host and port");
  });

  test("the same one twice is one, and none is no setting", () => {
    expect(
      OpenStackCollectionSettings.normalizeOptions({
        swiftReconAddresses: ["10.0.0.5:6200", " 10.0.0.5:6200 "],
      }).options?.swiftReconAddresses,
    ).toEqual(["10.0.0.5:6200"]);
    expect(
      OpenStackCollectionSettings.normalizeOptions({
        swiftReconAddresses: [],
      }).options?.swiftReconAddresses,
    ).toBeUndefined();
  });
});
