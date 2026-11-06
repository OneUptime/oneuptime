import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  OPENSTACK_USAGE_RECORDING,
  OPENSTACK_USAGE_SCENES,
  idOfFlavor,
  idOfProject,
  recordedAtOfUsageScene,
  scanUsageScene,
  usageRowsOf,
} from "../../../Helpers/OpenStackRecordedScan";
import { OpenStackResourceBufferEntry } from "../../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONObject } from "../../../../Types/JSON";
import {
  OpenStackCapacityFlavorSourceRow,
  OpenStackCapacityHostSourceRow,
  readOpenStackCapacityFlavor,
  readOpenStackCapacityHost,
} from "../../../../Types/OpenStack/OpenStackCapacitySnapshot";
import { getOpenStackUsageCost } from "../../../../Types/OpenStack/OpenStackPriceList";
import {
  OpenStackUsageQuantities,
  OpenStackUsageRows,
  applyOpenStackUsageReading,
  getOpenStackFlavorUsageKey,
  getOpenStackProjectHoldings,
  getOpenStackUsageInterval,
  getOpenStackUsageTotals,
} from "../../../../Types/OpenStack/OpenStackProjectUsage";
import { OpenStackResourceKind } from "../../../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_WASTE_RULES,
  OpenStackWasteFinding,
  OpenStackWasteItem,
  OpenStackWasteRow,
  OpenStackWasteRuleId,
  getOpenStackImagesInUse,
  getOpenStackMovableHosts,
  getOpenStackWasteFindings,
} from "../../../../Types/OpenStack/OpenStackWaste";

/*
 * THE HAND CALCULATION, ON WHAT A REAL CLOUD DID.
 *
 * Tests/Ops/openstack-e2e/usage-record.sh on Hibiscus with OVN, in rig run 41987501921. Nova really
 * resized ou-usage-resized and really deleted ou-usage-deleted, with six readings of what the agent's
 * exporter said around them. Nothing here has been edited. Each reading goes through the real scan
 * and into what the worker adds up, at the time it was really taken:
 *
 *   reading               taken at   seconds it counts   what's different
 *   usage-start           07:46:47   none: it's the first
 *   usage-before-resize   07:52:04   317
 *   usage-after-resize    07:52:26    22                 ou-usage-resized is on ou.small
 *   usage-before-delete   07:57:44   318
 *   usage-after-delete    07:58:03    19                 ou-usage-deleted has gone
 *   usage-end             08:03:21   318
 *                                    994 in all
 *
 * A change counts from the first reading that shows it. So this is what ran on each flavor in the
 * admin project, in instance-seconds:
 *
 *                       ou.tiny               ou.small             m1.small
 *   ou-usage-resized    317                   22+318+19+318 = 677
 *   ou-usage-deleted    317+22+318 = 657
 *   ou-usage-on-image   994
 *   ou-use-quiet-1      994
 *   six ou-use-*                                                   6 x 994 = 5,964
 *   in all              2,962                 677                  5,964
 *
 * As this cloud's Nova has them, ou.tiny is 1 vCPU and 128 MB (0.125 GB), ou.small 2 vCPUs and 256 MB
 * (0.25 GB), and m1.small 1 vCPU and 2,048 MB (2 GB). So:
 *
 *   vCPU-seconds       2,962 x 1 + 677 x 2 + 5,964 x 1             = 10,280
 *   memory GB-seconds  2,962 x 0.125 + 677 x 0.25 + 5,964 x 2      = 370.25 + 169.25 + 11,928 = 12,467.5
 *
 * At 0.36 a vCPU-hour and 0.72 a GB of memory an hour, which is 0.0001 a vCPU-second and 0.0002 a
 * GB-second, that comes to 1.028 + 2.4935 = 3.5215.
 *
 * Nothing else moved, so the other projects are the whole period's 994 seconds:
 *
 *   ou-payments   ou-running 994 running, ou-stopped 994 shut off, and nothing of ou-failed, never placed
 *                 3 GB of volumes, because ou-vol-bad is in error. 2 floating IPs
 *   ou-research   ou-research-1 and ou-from-volume, 994 each. 1 GB of volume
 *   service       Cinder's own image volumes, 2 GB, which do take up space
 */

const GIB: number = 1024 * 1024 * 1024;
const DAY_MS: number = 24 * 60 * 60 * 1000;
const WHOLE_PERIOD: number = 994;
// What's added up is kept to a millionth of an hour, each reading, so it agrees to the fifth place.
const PLACES: number = 5;

function hours(seconds: number): number {
  return seconds / 3600;
}

function instanceNamed(
  rows: ReadonlyArray<OpenStackResourceBufferEntry>,
  name: string,
): OpenStackResourceBufferEntry | undefined {
  return rows.find((row: OpenStackResourceBufferEntry): boolean => {
    return row.kind === OpenStackResourceKind.Instance && row.name === name;
  });
}

const END: Array<OpenStackResourceBufferEntry> = scanUsageScene("usage-end");

describe("what the recording says happened", () => {
  test("the readings are as far apart as the calculation has them", () => {
    const seconds: Array<number> = OPENSTACK_USAGE_SCENES.slice(1).map(
      (scene: string, index: number): number => {
        return (
          (recordedAtOfUsageScene(scene).getTime() -
            recordedAtOfUsageScene(OPENSTACK_USAGE_SCENES[index]!).getTime()) /
          1000
        );
      },
    );

    expect(seconds).toEqual([317, 22, 318, 19, 318]);
    expect(
      seconds.reduce((sum: number, value: number): number => {
        return sum + value;
      }, 0),
    ).toBe(WHOLE_PERIOD);
  });

  test("Nova moved ou-usage-resized from ou.tiny to ou.small between two readings", () => {
    const before: Array<OpenStackResourceBufferEntry> = scanUsageScene(
      "usage-before-resize",
    );
    const after: Array<OpenStackResourceBufferEntry> =
      scanUsageScene("usage-after-resize");

    expect(instanceNamed(before, "ou-usage-resized")!.facts["flavorId"]).toBe(
      idOfFlavor(before, "ou.tiny"),
    );
    expect(instanceNamed(after, "ou-usage-resized")!.facts["flavorId"]).toBe(
      idOfFlavor(after, "ou.small"),
    );
  });

  test("and ou-usage-deleted was there, and then wasn't", () => {
    expect(
      instanceNamed(scanUsageScene("usage-before-delete"), "ou-usage-deleted"),
    ).toBeDefined();
    expect(
      instanceNamed(scanUsageScene("usage-after-delete"), "ou-usage-deleted"),
    ).toBeUndefined();
  });

  test("the flavors are what the calculation says", () => {
    const flavors: OpenStackUsageRows["flavors"] = usageRowsOf(END).flavors;

    expect(
      [
        ["ou.tiny", 1, 128],
        ["ou.small", 2, 256],
        ["m1.small", 1, 2048],
      ].map(([name]: Array<string | number>) => {
        const flavor: OpenStackUsageRows["flavors"][number] = flavors.find(
          (entry: OpenStackUsageRows["flavors"][number]): boolean => {
            return entry.name === name;
          },
        )!;

        return [name, flavor.vcpus, (flavor.memoryBytes || 0) / (1024 * 1024)];
      }),
    ).toEqual([
      ["ou.tiny", 1, 128],
      ["ou.small", 2, 256],
      ["m1.small", 1, 2048],
    ]);
  });
});

describe("what a project used, across a real resize and a real deletion", () => {
  let months: Map<string, Map<string, OpenStackUsageQuantities>> = new Map();
  let lastReadAt: Date | null = null;

  for (const scene of OPENSTACK_USAGE_SCENES) {
    const now: Date = recordedAtOfUsageScene(scene);

    months = applyOpenStackUsageReading({
      months,
      holdings: getOpenStackProjectHoldings(usageRowsOf(scanUsageScene(scene))),
      interval: getOpenStackUsageInterval({ lastReadAt, now }),
    }).months;
    lastReadAt = now;
  }

  const month: Map<string, OpenStackUsageQuantities> = months.get("2026-11")!;
  const of: (project: string) => OpenStackUsageQuantities = (
    project: string,
  ): OpenStackUsageQuantities => {
    return month.get(idOfProject(END, project))!;
  };
  const keyOf: (flavor: string) => string = (flavor: string): string => {
    return getOpenStackFlavorUsageKey({
      regionName: "RegionOne",
      flavorId: idOfFlavor(END, flavor),
    });
  };

  test("the resize moved hours between flavors, and the deletion stopped them", () => {
    const flavors: OpenStackUsageQuantities["flavors"] = of("admin").flavors;

    expect(flavors[keyOf("ou.tiny")]!.runningHours).toBeCloseTo(
      hours(2962),
      PLACES,
    );
    expect(flavors[keyOf("ou.small")]!.runningHours).toBeCloseTo(
      hours(677),
      PLACES,
    );
    expect(flavors[keyOf("m1.small")]!.runningHours).toBeCloseTo(
      hours(5964),
      PLACES,
    );
    expect(Object.keys(flavors).length).toBe(3);
  });

  test("vCPU-hours and memory-hours are as the calculation has them", () => {
    const totals: ReturnType<typeof getOpenStackUsageTotals> =
      getOpenStackUsageTotals(of("admin"));

    expect(totals.vcpuHours).toBeCloseTo(hours(10280), PLACES);
    expect(totals.memoryGbHours).toBeCloseTo(hours(12467.5), PLACES);
  });

  test("with prices set, the cost is as the calculation has it", () => {
    const cost: ReturnType<typeof getOpenStackUsageCost> =
      getOpenStackUsageCost({
        quantities: of("admin"),
        priceList: {
          currency: "EUR",
          vcpuHour: 0.36,
          memoryGbHour: 0.72,
          volumeGbHour: 0,
          floatingIpHour: 0,
          imageGbHour: 0,
          snapshotGbHour: 0,
          flavorHour: {},
          volumeTypeGbHour: {},
          leaveOutShutOff: false,
        },
      });

    expect(cost.amount).toBeCloseTo(3.5215, 3);
  });

  test("a flavor's own price counts its instance-hours, resized or not", () => {
    // 2,962 seconds of ou.tiny at 3.6 an hour, which is 0.001 a second, and nothing else priced.
    const cost: ReturnType<typeof getOpenStackUsageCost> =
      getOpenStackUsageCost({
        quantities: of("admin"),
        priceList: {
          currency: "EUR",
          vcpuHour: 0,
          memoryGbHour: 0,
          volumeGbHour: 0,
          floatingIpHour: 0,
          imageGbHour: 0,
          snapshotGbHour: 0,
          flavorHour: { "ou.tiny": 3.6 },
          volumeTypeGbHour: {},
          leaveOutShutOff: false,
        },
      });

    expect(cost.amount).toBeCloseTo(2.962, 3);
  });

  test("nothing else moved: the other projects have the whole period", () => {
    const whole: number = hours(WHOLE_PERIOD);
    const payments: OpenStackUsageQuantities = of("ou-payments");
    const research: OpenStackUsageQuantities = of("ou-research");

    expect(Object.keys(payments.flavors)).toEqual([keyOf("ou.tiny")]);
    expect(payments.flavors[keyOf("ou.tiny")]!.runningHours).toBeCloseTo(
      whole,
      PLACES,
    );
    expect(payments.flavors[keyOf("ou.tiny")]!.shutOffHours).toBeCloseTo(
      whole,
      PLACES,
    );
    expect(research.flavors[keyOf("ou.tiny")]!.runningHours).toBeCloseTo(
      2 * whole,
      PLACES,
    );
    expect(getOpenStackUsageTotals(payments).volumeGbHours).toBeCloseTo(
      3 * whole,
      PLACES,
    );
    expect(payments.floatingIpHours).toBeCloseTo(2 * whole, PLACES);
    expect(getOpenStackUsageTotals(research).volumeGbHours).toBeCloseTo(
      whole,
      PLACES,
    );
    expect(getOpenStackUsageTotals(of("service")).volumeGbHours).toBeCloseTo(
      2 * whole,
      PLACES,
    );
    expect(getOpenStackUsageTotals(of("admin")).volumeGbHours).toBeCloseTo(
      whole,
      PLACES,
    );
  });

  test("image storage is what's really uploaded, for the whole period", () => {
    /*
     * In admin: cirros, ou-image-behind-volume and ou-image-used of 21,692,416 bytes, and
     * ou-image-protected and ou-image-unused of 1,048,576. ou-image-stuck never got a file.
     */
    const bytes: number = 3 * 21692416 + 2 * 1048576;

    expect(of("admin").imageGbHours).toBeCloseTo(
      (bytes / GIB) * hours(WHOLE_PERIOD),
      PLACES,
    );
  });
});

describe("what could be reclaimed, 31 days after the rig left it", () => {
  const seenAt: string = recordedAtOfUsageScene("usage-end").toISOString();
  const ofKind: (kind: OpenStackResourceKind) => Array<OpenStackWasteRow> = (
    kind: OpenStackResourceKind,
  ): Array<OpenStackWasteRow> => {
    return END.filter((row: OpenStackResourceBufferEntry): boolean => {
      return row.kind === kind;
    }).map((row: OpenStackResourceBufferEntry): OpenStackWasteRow => {
      return {
        externalId: row.externalId,
        name: row.name,
        regionName: row.regionName,
        openStackProjectId: row.openStackProjectId,
        status: row.status,
        stateChangedAt: seenAt,
        createdAt: seenAt,
        diskCapacityBytes: row.diskCapacityBytes,
        facts: row.facts as JSONObject,
      };
    });
  };
  // As the worker reads them: a row's own columns, and one line per flavor per host.
  const hostRows: Array<OpenStackResourceBufferEntry> = END.filter(
    (row: OpenStackResourceBufferEntry): boolean => {
      return row.kind === OpenStackResourceKind.Hypervisor;
    },
  );
  const flavorRows: Array<OpenStackResourceBufferEntry> = END.filter(
    (row: OpenStackResourceBufferEntry): boolean => {
      return row.kind === OpenStackResourceKind.Flavor;
    },
  );
  const usageRows: OpenStackUsageRows = usageRowsOf(END);
  const instances: Array<OpenStackWasteRow> = ofKind(
    OpenStackResourceKind.Instance,
  );
  const findings: Array<OpenStackWasteFinding> = getOpenStackWasteFindings({
    volumes: ofKind(OpenStackResourceKind.Volume).filter(
      (row: OpenStackWasteRow): boolean => {
        return row.status === "available";
      },
    ),
    floatingIps: ofKind(OpenStackResourceKind.FloatingIp),
    instances: instances.filter((row: OpenStackWasteRow): boolean => {
      return row.status === "SHUTOFF";
    }),
    images: ofKind(OpenStackResourceKind.Image),
    snapshots: ofKind(OpenStackResourceKind.Snapshot),
    flavorOf: (flavor: {
      regionName: string | null;
      flavorId: string | null;
    }) => {
      const row: OpenStackUsageRows["flavors"][number] | undefined =
        usageRows.flavors.find(
          (entry: OpenStackUsageRows["flavors"][number]): boolean => {
            return entry.flavorId === flavor.flavorId;
          },
        );

      return row
        ? {
            name: row.name,
            vcpus: row.vcpus || 0,
            ramMib: (row.memoryBytes || 0) / (1024 * 1024),
            diskGb: 1,
          }
        : null;
    },
    imagesInUse: getOpenStackImagesInUse({
      instanceImageIds: [],
      volumeImageIds: [],
      instancesNotSaying: instances.length,
    }),
    snapshotsAreReported: false,
    movableHosts: getOpenStackMovableHosts({
      hosts: hostRows.map((row: OpenStackResourceBufferEntry) => {
        return readOpenStackCapacityHost(
          row as unknown as OpenStackCapacityHostSourceRow,
        );
      }),
      instancesOnHosts: END.filter(
        (row: OpenStackResourceBufferEntry): boolean => {
          return (
            row.kind === OpenStackResourceKind.Instance &&
            Boolean(row.hypervisorName)
          );
        },
      ).map((row: OpenStackResourceBufferEntry) => {
        return {
          regionName: row.regionName,
          hypervisorName: row.hypervisorName as string,
          flavorId: (row.facts["flavorId"] as string) || null,
          count: 1,
          movingCount: 0,
        };
      }),
      flavors: flavorRows.map((row: OpenStackResourceBufferEntry) => {
        const flavor: ReturnType<typeof readOpenStackCapacityFlavor> =
          readOpenStackCapacityFlavor({
            row: row as unknown as OpenStackCapacityFlavorSourceRow,
            instanceCount: 0,
          });

        return {
          regionName: flavor.regionName,
          flavorId: flavor.id,
          resources: flavor.request.resources,
        };
      }),
    }),
    priceList: null,
    now: new Date(recordedAtOfUsageScene("usage-end").getTime() + 31 * DAY_MS),
  });
  const finding: (rule: OpenStackWasteRuleId) => OpenStackWasteFinding = (
    rule: OpenStackWasteRuleId,
  ): OpenStackWasteFinding => {
    return findings.find((entry: OpenStackWasteFinding): boolean => {
      return entry.rule === rule;
    })!;
  };
  const namesOf: (rule: OpenStackWasteRuleId) => Array<string | null> = (
    rule: OpenStackWasteRuleId,
  ): Array<string | null> => {
    return finding(rule)
      .items.map((item: OpenStackWasteItem): string | null => {
        return item.name;
      })
      .sort();
  };

  test("volumes: what's attached to nothing, and not what's in use, in error, or Cinder's own", () => {
    // Not ou-vol-used, ou-boot-volume, ou-vol-bad, ou-vol-stuck, or Cinder's two image-<id> volumes.
    expect(namesOf(OpenStackWasteRuleId.UnattachedVolume)).toEqual([
      "ou-vol-free",
      "ou-vol-from-image",
    ]);
    expect(finding(OpenStackWasteRuleId.UnattachedVolume).frees.storageGb).toBe(
      2,
    );
  });

  test("floating IPs: the spare address, and not the one on a router", () => {
    expect(namesOf(OpenStackWasteRuleId.SpareFloatingIp)).toEqual([
      "172.24.4.67",
    ]);
  });

  test("instances: the one shut off, of fourteen", () => {
    expect(namesOf(OpenStackWasteRuleId.ShutOffInstance)).toEqual([
      "ou-stopped",
    ]);
  });

  test("hosts: the quiet one, and not the busy ones or the only one in its zone", () => {
    expect(namesOf(OpenStackWasteRuleId.MovableHost)).toEqual(["ou-use-quiet"]);
    expect(finding(OpenStackWasteRuleId.MovableHost).frees.hosts).toBe(1);
  });

  test("what the agent can't see stays unsaid: images and snapshots wait for a probe", () => {
    expect(finding(OpenStackWasteRuleId.UnusedImage).count).toBe(0);
    expect(finding(OpenStackWasteRuleId.UnusedImage).cannotTell).toBe(
      "images-in-use-not-reported",
    );
    expect(finding(OpenStackWasteRuleId.OldSnapshot).count).toBe(0);
    expect(finding(OpenStackWasteRuleId.OldSnapshot).cannotTell).toBe(
      "snapshots-not-reported",
    );
  });
});

describe("the command each rule says lists what it found, as the cloud really answered it", () => {
  const output: (name: string) => string = (name: string): string => {
    return fs.readFileSync(
      path.join(OPENSTACK_USAGE_RECORDING, "commands", `${name}.txt`),
      "utf8",
    );
  };

  test.each([
    [
      OpenStackWasteRuleId.UnattachedVolume,
      ["ou-vol-free", "ou-vol-from-image"],
      ["ou-vol-used", "ou-vol-bad"],
    ],
    [OpenStackWasteRuleId.SpareFloatingIp, ["172.24.4.67"], ["172.24.4.52"]],
    [OpenStackWasteRuleId.ShutOffInstance, ["ou-stopped"], ["ou-running"]],
    [OpenStackWasteRuleId.UnusedImage, ["ou-image-unused"], []],
    [OpenStackWasteRuleId.OldSnapshot, ["ou-snap"], []],
    [OpenStackWasteRuleId.MovableHost, ["ou-use-quiet"], []],
  ] as Array<[OpenStackWasteRuleId, Array<string>, Array<string>]>)(
    "%s",
    (
      rule: OpenStackWasteRuleId,
      lists: Array<string>,
      leavesOut: Array<string>,
    ) => {
      const text: string = output(rule);

      expect(text.split("\n")[0]).toBe(
        `$ ${OPENSTACK_WASTE_RULES[rule].command}`,
      );
      for (const name of lists) {
        expect(text).toContain(name);
      }
      for (const name of leavesOut) {
        expect(text).not.toContain(name);
      }
      expect(text).not.toContain("exit code");
    },
  );

  test("and what's on the host it would empty can be listed too", () => {
    const text: string = output("movable-host-instances");

    expect(text).toContain("ou-use-quiet-1");
    expect(text).toContain("ou-usage-resized");
    expect(text).not.toContain("exit code");
  });
});
