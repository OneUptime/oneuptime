import { describe, expect, test } from "@jest/globals";
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
import { collectionJob, createCollectorHarness } from "./Helpers/CollectorHarness";
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
 * nothing here, by being public and by being in use. Its deliberately wasted image is on the rig's
 * usage run: until that's imported, what it finds is proven only on made-up rows (OpenStackWaste.test).
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

describe.each(RELEASES)("a probe's %s", (release: string) => {
  async function findingsAt(
    now: Date,
  ): Promise<{
    findings: Array<OpenStackWasteFinding>;
    instances: Array<OpenStackResourceBufferEntry>;
  }> {
    const rows: Array<OpenStackResourceBufferEntry> = await rowsOf(
      loadScene(release, "healthy"),
    );
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
            // OneUptime has only just connected: all it knows of time is what the cloud says.
            stateChangedAt: now,
            createdAt: now,
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
