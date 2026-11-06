import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import OpenStackProbeMetrics from "Common/Server/Utils/OpenStack/OpenStackProbeMetrics";
import {
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  isOpenStackSnapshotDatapoint,
} from "Common/Server/Utils/Telemetry/OpenStackSnapshotScan";
import { OpenStackCollectionReport } from "Common/Types/OpenStack/OpenStackProbeCollection";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackWasteFinding,
  OpenStackWasteItem,
  OpenStackWasteRow,
  OpenStackWasteRuleId,
  getOpenStackImagesInUse,
  getOpenStackWasteFindings,
} from "Common/Types/OpenStack/OpenStackWaste";
import OpenStackCollector from "../../../Utils/OpenStack/OpenStackCollector";
import {
  collectionJob,
  createCollectorHarness,
} from "./Helpers/CollectorHarness";
import {
  RecordedScene,
  createRecordedCloud,
  loadScene,
  recordedJson,
} from "./Helpers/RecordedCloud";

/*
 * WHAT THE WASTE RULES MAKE OF A PROBE'S CLOUD.
 *
 * A probe reads what the agent can't: which image an instance booted from, and each snapshot and how
 * old it is. So here the two rules the agent's cloud has to sit out really run, on what a real
 * cloud's APIs answered, through the real collector and the real scan.
 *
 * Every recording's image is the public cirros everything boots from, so the unused image rule finds
 * nothing on those, by being public and by being in use. Its deliberately wasted image is on the rig's
 * usage run, at the end of this file.
 */

const RELEASES: ReadonlyArray<string> = [
  "hibiscus-ovn",
  "gazpacho-ovn",
  "flamingo-ovn",
  "epoxy-ovn",
];
const DAY_MS: number = 24 * 60 * 60 * 1000;

function scanAsIngest(
  resourceMetrics: JSONArray,
): Array<OpenStackResourceBufferEntry> {
  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();

  for (const resource of resourceMetrics as Array<JSONObject>) {
    for (const scope of resource["scopeMetrics"] as Array<JSONObject>) {
      for (const metric of scope["metrics"] as Array<JSONObject>) {
        const metricName: string = metric["name"] as string;
        const body: JSONObject = metric["gauge"] as JSONObject;

        for (const datapoint of body["dataPoints"] as Array<JSONObject>) {
          if (isOpenStackSnapshotDatapoint({ metricName, datapoint })) {
            bufferOpenStackSnapshotMetric({ metricName, datapoint, buffer });
          }
        }
      }
    }
  }

  return finishOpenStackBatch(buffer.values());
}

async function rowsOf(
  scene: RecordedScene,
): Promise<Array<OpenStackResourceBufferEntry>> {
  const report: OpenStackCollectionReport = await OpenStackCollector.collect(
    collectionJob(),
    createCollectorHarness({ transport: createRecordedCloud(scene).transport })
      .dependencies,
  );

  return scanAsIngest(
    OpenStackProbeMetrics.prepare({
      resourceMetrics: report.resourceMetrics,
      cloudName: "devstack",
    }).resourceMetrics,
  );
}

async function findingsOf(
  scene: RecordedScene,
  now: Date,
  // When OneUptime first saw it all. By default just now: all it knows of time is what the cloud says.
  firstSeenAt: Date = now,
): Promise<{
  findings: Array<OpenStackWasteFinding>;
  instances: Array<OpenStackResourceBufferEntry>;
}> {
  const rows: Array<OpenStackResourceBufferEntry> = await rowsOf(scene);
  const ofKind: (kind: OpenStackResourceKind) => Array<OpenStackWasteRow> = (
    kind: OpenStackResourceKind,
  ): Array<OpenStackWasteRow> => {
    return rows
      .filter((row: OpenStackResourceBufferEntry): boolean => {
        return row.kind === kind;
      })
      .map((row: OpenStackResourceBufferEntry): OpenStackWasteRow => {
        return {
          externalId: row.externalId,
          name: row.name,
          regionName: row.regionName,
          openStackProjectId: row.openStackProjectId,
          status: row.status,
          stateChangedAt: firstSeenAt,
          createdAt: firstSeenAt,
          diskCapacityBytes: row.diskCapacityBytes,
          facts: row.facts as JSONObject,
        };
      });
  };
  const instances: Array<OpenStackResourceBufferEntry> = rows.filter(
    (row: OpenStackResourceBufferEntry): boolean => {
      return row.kind === OpenStackResourceKind.Instance;
    },
  );

  return {
    instances,
    findings: getOpenStackWasteFindings({
      volumes: ofKind(OpenStackResourceKind.Volume).filter(
        (row: OpenStackWasteRow): boolean => {
          return row.status === "available";
        },
      ),
      floatingIps: ofKind(OpenStackResourceKind.FloatingIp),
      instances: ofKind(OpenStackResourceKind.Instance).filter(
        (row: OpenStackWasteRow): boolean => {
          return row.status === "SHUTOFF";
        },
      ),
      images: ofKind(OpenStackResourceKind.Image).filter(
        (row: OpenStackWasteRow): boolean => {
          return row.status === "active";
        },
      ),
      snapshots: ofKind(OpenStackResourceKind.Snapshot).filter(
        (row: OpenStackWasteRow): boolean => {
          return row.status === "available";
        },
      ),
      flavorOf: () => {
        return null;
      },
      imagesInUse: getOpenStackImagesInUse({
        instanceImageIds: instances.map(
          (row: OpenStackResourceBufferEntry): string | null => {
            return (row.facts["imageId"] as string | null) ?? null;
          },
        ),
        volumeImageIds: ofKind(OpenStackResourceKind.Volume).map(
          (row: OpenStackWasteRow): string | null => {
            return (row.facts?.["imageId"] as string | null) ?? null;
          },
        ),
        instancesNotSaying: instances.filter(
          (row: OpenStackResourceBufferEntry): boolean => {
            return !("imageId" in row.facts);
          },
        ).length,
      }),
      snapshotsAreReported: ofKind(OpenStackResourceKind.Snapshot).length > 0,
      movableHosts: [],
      priceList: null,
      now,
    }),
  };
}

function ruleOf(
  findings: Array<OpenStackWasteFinding>,
  rule: OpenStackWasteRuleId,
): OpenStackWasteFinding {
  return findings.find((finding: OpenStackWasteFinding): boolean => {
    return finding.rule === rule;
  })!;
}

function namesOf(finding: OpenStackWasteFinding): Array<string | null> {
  return finding.items.map((item: OpenStackWasteItem): string | null => {
    return item.name;
  });
}

describe.each(RELEASES)("a probe's %s", (release: string) => {
  function findingsAt(now: Date): ReturnType<typeof findingsOf> {
    return findingsOf(loadScene(release, "healthy"), now);
  }

  test("91 days after it was made, ou-snap is an old snapshot, by the cloud's own clock", async () => {
    const answer: JSONObject = recordedJson(
      loadScene(release, "healthy"),
      "cinder-snapshots",
    ) as JSONObject;
    const created: string = (
      (answer["snapshots"] as Array<JSONObject>)[0] as JSONObject
    )["created_at"] as string;
    const madeAt: number = Date.parse(`${created}Z`);

    expect(Number.isFinite(madeAt)).toBe(true);

    const old: OpenStackWasteFinding = ruleOf(
      (await findingsAt(new Date(madeAt + 91 * DAY_MS))).findings,
      OpenStackWasteRuleId.OldSnapshot,
    );

    expect(old.cannotTell).toBeNull();
    expect(namesOf(old)).toEqual(["ou-snap"]);
    expect(old.frees.storageGb).toBe(1);

    const young: OpenStackWasteFinding = ruleOf(
      (await findingsAt(new Date(madeAt + 89 * DAY_MS))).findings,
      OpenStackWasteRuleId.OldSnapshot,
    );

    expect(namesOf(young)).toEqual([]);
  });

  test("every instance says which image it booted from, so the image rule really runs", async () => {
    const { findings, instances } = await findingsAt(
      new Date(Date.now() + 400 * DAY_MS),
    );

    for (const instance of instances) {
      expect(instance.facts).toHaveProperty("imageId");
    }

    const images: OpenStackWasteFinding = ruleOf(
      findings,
      OpenStackWasteRuleId.UnusedImage,
    );

    // It runs, and it names nothing: the one image is public, and everything's running on it.
    expect(images.cannotTell).toBeNull();
    expect(images.count).toBe(0);
  });

  test("the cloud's own clock says how long a volume's been free, on the day it's connected", async () => {
    const { findings } = await findingsAt(new Date(Date.now() + 400 * DAY_MS));
    const volumes: OpenStackWasteFinding = ruleOf(
      findings,
      OpenStackWasteRuleId.UnattachedVolume,
    );

    expect(namesOf(volumes)).toContain("ou-vol-free");
    expect(namesOf(volumes)).not.toContain("ou-vol-used");
    expect(namesOf(volumes)).not.toContain("ou-vol-bad");
  });
});

/*
 * WHAT THE RIG LEFT ON PURPOSE, THROUGH A PROBE'S REAL READ.
 *
 * Tests/Ops/openstack-e2e/usage-record.sh on Hibiscus with OVN, in rig run 41987501921, where each
 * of these was left beside something in use that no rule may name:
 *
 *   ou-image-unused          private, and nothing has ever booted from it. The one to find
 *   ou-image-used            ou-usage-on-image runs on it
 *   ou-image-behind-volume   ou-vol-from-image was made from it
 *   ou-image-protected       someone said to keep it
 *   ou-image-stuck           no file ever arrived, so it holds nothing
 *   cirros                   public, for anyone to boot from
 */
describe("what the rig left, as a probe reads it", () => {
  const scene: RecordedScene = loadScene("hibiscus-ovn", "usage/usage-end");
  const leftAt: number = Date.parse(
    fs
      .readFileSync(
        path.join(
          __dirname,
          "../../../../Common/Tests/Fixtures/OpenStack/hibiscus-ovn/usage/usage-end/recorded-at.txt",
        ),
        "utf8",
      )
      .trim(),
  );
  const daysOn: (days: number) => Date = (days: number): Date => {
    return new Date(leftAt + days * DAY_MS);
  };

  test("31 days on, the image nothing came from, and none of the others", async () => {
    const images: OpenStackWasteFinding = ruleOf(
      (await findingsOf(scene, daysOn(31))).findings,
      OpenStackWasteRuleId.UnusedImage,
    );

    expect(images.cannotTell).toBeNull();
    expect(namesOf(images)).toEqual(["ou-image-unused"]);
    // 1 MiB, of which there's about a thousandth of a GB.
    expect(images.frees.storageGb).toBeCloseTo(1 / 1024, 3);
  });

  test("and 29 days on it's not old enough", async () => {
    expect(
      namesOf(
        ruleOf(
          (await findingsOf(scene, daysOn(29))).findings,
          OpenStackWasteRuleId.UnusedImage,
        ),
      ),
    ).toEqual([]);
  });

  test("91 days on, the old snapshot, by when the cloud says it was made", async () => {
    const snapshots: OpenStackWasteFinding = ruleOf(
      (await findingsOf(scene, daysOn(91))).findings,
      OpenStackWasteRuleId.OldSnapshot,
    );

    expect(snapshots.cannotTell).toBeNull();
    expect(namesOf(snapshots)).toEqual(["ou-snap"]);
  });

  test("what's in use, in error, on its way or Cinder's own isn't named by the other rules", async () => {
    const { findings } = await findingsOf(scene, daysOn(31));

    expect(
      namesOf(ruleOf(findings, OpenStackWasteRuleId.UnattachedVolume)).sort(),
    ).toEqual(["ou-vol-free", "ou-vol-from-image"]);
    expect(
      namesOf(ruleOf(findings, OpenStackWasteRuleId.ShutOffInstance)),
    ).toEqual(["ou-stopped"]);
  });

  test("a floating IP has no clock of the cloud's here, so it's named once OneUptime has seen it spare", async () => {
    expect(
      namesOf(
        ruleOf(
          (await findingsOf(scene, daysOn(31))).findings,
          OpenStackWasteRuleId.SpareFloatingIp,
        ),
      ),
    ).toEqual([]);
    expect(
      namesOf(
        ruleOf(
          (await findingsOf(scene, daysOn(31), new Date(leftAt))).findings,
          OpenStackWasteRuleId.SpareFloatingIp,
        ),
      ),
    ).toEqual(["172.24.4.67"]);
  });
});
