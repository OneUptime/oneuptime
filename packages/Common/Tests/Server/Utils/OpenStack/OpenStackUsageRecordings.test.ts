import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  isOpenStackSnapshotDatapoint,
} from "../../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  OPENSTACK_USAGE_IMAGE_STATUS_HOLDING,
  OPENSTACK_USAGE_INSTANCE_STATUSES_HOLDING_NOTHING,
  OPENSTACK_USAGE_STORAGE_STATUSES_HOLDING_NOTHING,
  OpenStackProjectHolding,
  OpenStackUsageQuantities,
  OpenStackUsageRows,
  applyOpenStackUsageReading,
  getOpenStackFlavorUsageKey,
  getOpenStackProjectHoldings,
  getOpenStackUsageInterval,
  getOpenStackUsageTotals,
  readOpenStackUsageFlavorId,
} from "../../../../Types/OpenStack/OpenStackProjectUsage";
import { getOpenStackUsageCost } from "../../../../Types/OpenStack/OpenStackPriceList";
import { OpenStackResourceKind } from "../../../../Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackWasteFinding,
  OpenStackWasteItem,
  OpenStackWasteRow,
  OpenStackWasteRuleId,
  getOpenStackImagesInUse,
  getOpenStackWasteFindings,
} from "../../../../Types/OpenStack/OpenStackWaste";

/*
 * USAGE AND WASTE, ON WHAT REAL CLOUDS SAID.
 *
 * What the agent's exporter answered, through the real snapshot scan, into the rows the worker
 * reads. The grouping below is what OpenStackProjectUsageService.getUsageRows does in SQL, which
 * OpenStackUsagePostgres.test.ts runs for real. Every recording is the same estate.sh on a different
 * release, with its own ids and its own volume type.
 *
 * What's real and what isn't: every row is real, and what each rule makes of it. The test period
 * across a resize and a deletion is an EDITED RECORDING until the rig's usage run is imported: a real
 * cloud's real scrape, read three times an hour apart, with one instance's flavor_id changed to a
 * flavor that cloud really has, and another's series removed. Nova wasn't asked to do either.
 */

const FIXTURES: string = path.join(__dirname, "../../../Fixtures/OpenStack");
const OBSERVED_AT_MS: number = 1793785799000;
const DAY_MS: number = 24 * 60 * 60 * 1000;
const HOUR_MS: number = 60 * 60 * 1000;
const SERVICES: ReadonlyArray<string> = [
  "identity",
  "compute",
  "network",
  "volume",
  "image",
];
const RELEASES: ReadonlyArray<string> = [
  "hibiscus-ovn",
  "gazpacho-ovs",
  "gazpacho-ovn",
  "flamingo-ovn",
  "epoxy-ovn",
];

function datapointsOf(text: string): Array<{
  metricName: string;
  datapoint: JSONObject;
}> {
  const points: Array<{ metricName: string; datapoint: JSONObject }> = [];

  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) {
      continue;
    }
    const brace: number = line.indexOf("{");
    const space: number = line.lastIndexOf(" ");
    const attributes: JSONArray = [];

    if (brace >= 0) {
      const body: string = line.substring(brace + 1, line.lastIndexOf("}"));
      let at: number = 0;
      while (at < body.length) {
        const equals: number = body.indexOf("=", at);
        const key: string = body.substring(at, equals);
        let end: number = equals + 2;
        while (body[end] !== '"') {
          end += body[end] === "\\" ? 2 : 1;
        }
        const value: string = body.substring(equals + 2, end);
        // What the collector does: an empty label is no label.
        if (value) {
          attributes.push({ key, value: { stringValue: value } });
        }
        at = end + 2;
      }
    }

    attributes.push({
      key: "openstack.region.name",
      value: { stringValue: "RegionOne" },
    });

    points.push({
      metricName: line.substring(0, brace >= 0 ? brace : space),
      datapoint: {
        attributes,
        asDouble: Number(line.substring(space + 1)),
        timeUnixNano: `${OBSERVED_AT_MS}000000`,
      },
    });
  }

  return points;
}

function recordedText(release: string, service: string): string {
  return fs.readFileSync(
    path.join(FIXTURES, release, "healthy", "exporter", `${service}.prom`),
    "utf8",
  );
}

function scan(
  texts: ReadonlyArray<string>,
): Array<OpenStackResourceBufferEntry> {
  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();

  for (const text of texts) {
    for (const point of datapointsOf(text)) {
      if (isOpenStackSnapshotDatapoint(point)) {
        bufferOpenStackSnapshotMetric({ ...point, buffer });
      }
    }
  }

  return finishOpenStackBatch(buffer.values());
}

function scanRecording(release: string): Array<OpenStackResourceBufferEntry> {
  return scan(
    SERVICES.map((service: string): string => {
      return recordedText(release, service);
    }),
  );
}

// What OpenStackProjectUsageService.getUsageRows does in SQL, over the scan's own rows.
function usageRowsOf(
  rows: ReadonlyArray<OpenStackResourceBufferEntry>,
): OpenStackUsageRows {
  const ofKind: (
    kind: OpenStackResourceKind,
  ) => Array<OpenStackResourceBufferEntry> = (
    kind: OpenStackResourceKind,
  ): Array<OpenStackResourceBufferEntry> => {
    return rows.filter((row: OpenStackResourceBufferEntry): boolean => {
      return row.kind === kind && Boolean(row.openStackProjectId);
    });
  };
  const holdsSpace: (row: OpenStackResourceBufferEntry) => boolean = (
    row: OpenStackResourceBufferEntry,
  ): boolean => {
    return !OPENSTACK_USAGE_STORAGE_STATUSES_HOLDING_NOTHING.includes(
      row.status || "",
    );
  };

  return {
    instances: ofKind(OpenStackResourceKind.Instance)
      .filter((row: OpenStackResourceBufferEntry): boolean => {
        return (
          Boolean(row.hypervisorName) &&
          !OPENSTACK_USAGE_INSTANCE_STATUSES_HOLDING_NOTHING.includes(
            row.status || "",
          )
        );
      })
      .map((row: OpenStackResourceBufferEntry) => {
        return {
          openStackProjectId: row.openStackProjectId,
          regionName: row.regionName,
          flavorId: (row.facts["flavorId"] as string) || null,
          status: row.status,
          count: 1,
        };
      }),
    flavors: rows
      .filter((row: OpenStackResourceBufferEntry): boolean => {
        return row.kind === OpenStackResourceKind.Flavor;
      })
      .map((row: OpenStackResourceBufferEntry) => {
        return {
          regionName: row.regionName,
          flavorId: readOpenStackUsageFlavorId({
            externalId: row.externalId,
            regionName: row.regionName,
          }),
          name: row.name,
          vcpus: row.vcpuCapacity,
          memoryBytes: row.memoryCapacityBytes,
        };
      }),
    volumes: ofKind(OpenStackResourceKind.Volume)
      .filter(holdsSpace)
      .map((row: OpenStackResourceBufferEntry) => {
        return {
          openStackProjectId: row.openStackProjectId,
          type: (row.facts["volumeType"] as string) || null,
          bytes: row.diskCapacityBytes || 0,
        };
      }),
    floatingIps: ofKind(OpenStackResourceKind.FloatingIp).map(
      (row: OpenStackResourceBufferEntry) => {
        return { openStackProjectId: row.openStackProjectId, count: 1 };
      },
    ),
    images: ofKind(OpenStackResourceKind.Image)
      .filter((row: OpenStackResourceBufferEntry): boolean => {
        return row.status === OPENSTACK_USAGE_IMAGE_STATUS_HOLDING;
      })
      .map((row: OpenStackResourceBufferEntry) => {
        return {
          openStackProjectId: row.openStackProjectId,
          bytes: row.diskCapacityBytes || 0,
        };
      }),
    snapshots: ofKind(OpenStackResourceKind.Snapshot)
      .filter(holdsSpace)
      .map((row: OpenStackResourceBufferEntry) => {
        return {
          openStackProjectId: row.openStackProjectId,
          bytes: row.diskCapacityBytes || 0,
        };
      }),
  };
}

function idOfProject(
  rows: ReadonlyArray<OpenStackResourceBufferEntry>,
  name: string,
): string {
  return rows.find((row: OpenStackResourceBufferEntry): boolean => {
    return row.kind === OpenStackResourceKind.Project && row.name === name;
  })!.externalId;
}

function idOfFlavor(
  rows: ReadonlyArray<OpenStackResourceBufferEntry>,
  name: string,
): string {
  const row: OpenStackResourceBufferEntry = rows.find(
    (entry: OpenStackResourceBufferEntry): boolean => {
      return entry.kind === OpenStackResourceKind.Flavor && entry.name === name;
    },
  )!;

  return readOpenStackUsageFlavorId({
    externalId: row.externalId,
    regionName: row.regionName,
  });
}

describe.each(RELEASES)("on %s, as its exporter really answered", (release: string) => {
  const rows: Array<OpenStackResourceBufferEntry> = scanRecording(release);
  const holdings: Array<OpenStackProjectHolding> = getOpenStackProjectHoldings(
    usageRowsOf(rows),
  );
  const payments: string = idOfProject(rows, "ou-payments");
  const research: string = idOfProject(rows, "ou-research");
  const holdingOf: (id: string) => OpenStackProjectHolding = (
    id: string,
  ): OpenStackProjectHolding => {
    return holdings.find((entry: OpenStackProjectHolding): boolean => {
      return entry.openStackProjectId === id;
    })!;
  };

  describe("what each project holds", () => {
    /*
     * From estate.sh: ou-running (ou.tiny, ACTIVE), ou-stopped (ou.tiny, SHUTOFF) and ou-failed
     * (ou.impossible, ERROR, never placed) in ou-payments. ou-research-1 (ou.tiny) in ou-research.
     */
    test("ou-payments holds one ou.tiny running and one shut off, and nothing of the one never placed", () => {
      expect(holdingOf(payments).flavors).toEqual([
        {
          regionName: "RegionOne",
          flavorId: idOfFlavor(rows, "ou.tiny"),
          name: "ou.tiny",
          vcpus: 1,
          ramMib: 128,
          running: 1,
          shutOff: 1,
        },
      ]);
    });

    test("ou-research holds one ou.tiny", () => {
      expect(holdingOf(research).flavors.length).toBe(1);
      expect(holdingOf(research).flavors[0]).toMatchObject({
        name: "ou.tiny",
        running: 1,
        shutOff: 0,
      });
    });

    test("volumes count unless they're in error, and both floating IPs count, attached or not", () => {
      const gb: number = Object.values(
        holdingOf(payments).volumeGbByType,
      ).reduce((sum: number, value: number): number => {
        return sum + value;
      }, 0);

      // ou-vol-free and ou-vol-used, of 1 GB each. Not ou-vol-bad, which is in error.
      expect(gb).toBeGreaterThanOrEqual(2);
      expect(holdingOf(payments).floatingIps).toBe(2);
    });

    test("the agent's exporter reports no snapshots, so none count", () => {
      for (const holding of holdings) {
        expect(holding.snapshotGb).toBe(0);
      }
    });
  });

  /*
   * THE HAND CALCULATION, ON AN EDITED RECORDING. Four readings an hour apart:
   *
   *   t0  healthy. The first reading: nothing's counted.
   *   t1  healthy. An hour of ou-running on ou.tiny.
   *   t2  ou-running's flavor_id now says m1.tiny: RESIZED.
   *   t3  and ou-research-1's series are gone: DELETED.
   *
   * ou.tiny is 1 vCPU and 128 MB (0.125 GB), and m1.tiny 1 vCPU and 512 MB (0.5 GB), on every release.
   *
   *   ou-running     ou.tiny 1 h, then m1.tiny 2 h
   *   ou-stopped     ou.tiny, shut off, 3 h
   *   ou-research-1  ou.tiny 2 h, then gone
   *
   *   ou-payments    ou.tiny 1 h running + 3 h shut off; m1.tiny 2 h
   *                  vCPU-hours 1 + 3 + 2 = 6
   *                  memory GB-hours 4 x 0.125 + 2 x 0.5 = 1.5
   *   ou-research    ou.tiny 2 h
   *                  vCPU-hours 2
   *                  memory GB-hours 0.25
   *
   * At 0.01 a vCPU-hour and 0.1 a GB of memory an hour:
   *   ou-payments 0.06 + 0.15 = 0.21, and ou-research 0.02 + 0.025 = 0.045.
   */
  describe("over a test period, across a resize and a deletion", () => {
    const start: Date = new Date("2026-11-10T00:00:00.000Z");
    const ouRunning: OpenStackResourceBufferEntry = rows.find(
      (row: OpenStackResourceBufferEntry): boolean => {
        return (
          row.kind === OpenStackResourceKind.Instance &&
          row.name === "ou-running"
        );
      },
    )!;
    const compute: string = recordedText(release, "compute");
    const resized: string = compute
      .split("\n")
      .map((line: string): string => {
        return line.startsWith("openstack_nova_server_status{") &&
          line.includes('name="ou-running"')
          ? line.replace(
              `flavor_id="${ouRunning.facts["flavorId"]}"`,
              `flavor_id="${idOfFlavor(rows, "m1.tiny")}"`,
            )
          : line;
      })
      .join("\n");
    const deleted: string = resized
      .split("\n")
      .filter((line: string): boolean => {
        return !(
          line.startsWith("openstack_nova_server_status{") &&
          line.includes('name="ou-research-1"')
        );
      })
      .join("\n");
    const others: Array<string> = SERVICES.filter((service: string) => {
      return service !== "compute";
    }).map((service: string): string => {
      return recordedText(release, service);
    });
    const readings: Array<string> = [compute, compute, resized, deleted];

    let months: Map<string, Map<string, OpenStackUsageQuantities>> = new Map();
    let lastReadAt: Date | null = null;

    readings.forEach((text: string, index: number): void => {
      const now: Date = new Date(start.getTime() + index * HOUR_MS);

      months = applyOpenStackUsageReading({
        months,
        holdings: getOpenStackProjectHoldings(
          usageRowsOf(scan([text, ...others])),
        ),
        interval: getOpenStackUsageInterval({ lastReadAt, now }),
      }).months;
      lastReadAt = now;
    });

    const month: Map<string, OpenStackUsageQuantities> = months.get("2026-11")!;
    const small: string = getOpenStackFlavorUsageKey({
      regionName: "RegionOne",
      flavorId: idOfFlavor(rows, "ou.tiny"),
    });
    const medium: string = getOpenStackFlavorUsageKey({
      regionName: "RegionOne",
      flavorId: idOfFlavor(rows, "m1.tiny"),
    });

    test("a resize moves hours between the cloud's real flavors, and a deletion stops them", () => {
      const quantities: OpenStackUsageQuantities = month.get(payments)!;

      expect(quantities.flavors[small]!.runningHours).toBe(1);
      expect(quantities.flavors[small]!.shutOffHours).toBe(3);
      expect(quantities.flavors[medium]!.runningHours).toBe(2);
      expect(month.get(research)!.flavors[small]!.runningHours).toBe(2);
      expect(month.get(research)!.flavors[medium]).toBeUndefined();
    });

    test("vCPU-hours and memory-hours are as the calculation has them", () => {
      expect(getOpenStackUsageTotals(month.get(payments)!).vcpuHours).toBe(6);
      expect(getOpenStackUsageTotals(month.get(payments)!).memoryGbHours).toBe(
        1.5,
      );
      expect(getOpenStackUsageTotals(month.get(research)!).vcpuHours).toBe(2);
      expect(getOpenStackUsageTotals(month.get(research)!).memoryGbHours).toBe(
        0.25,
      );
    });

    test("each volume type's GB-hours are its real volumes' sizes for the three hours", () => {
      for (const [type, gb] of Object.entries(
        holdingOf(payments).volumeGbByType,
      )) {
        expect(month.get(payments)!.volumeGbHoursByType[type]).toBe(gb * 3);
      }
      expect(month.get(payments)!.floatingIpHours).toBe(6);
    });

    test("with prices set, costs are as the calculation has them", () => {
      const priceList: {
        currency: string;
        vcpuHour: number;
        memoryGbHour: number;
        volumeGbHour: number;
        floatingIpHour: number;
        imageGbHour: number;
        snapshotGbHour: number;
        flavorHour: Record<string, number>;
        volumeTypeGbHour: Record<string, number>;
        leaveOutShutOff: boolean;
      } = {
        currency: "EUR",
        vcpuHour: 0.01,
        memoryGbHour: 0.1,
        volumeGbHour: 0,
        floatingIpHour: 0,
        imageGbHour: 0,
        snapshotGbHour: 0,
        flavorHour: {},
        volumeTypeGbHour: {},
        leaveOutShutOff: false,
      };

      expect(
        getOpenStackUsageCost({
          quantities: month.get(payments)!,
          priceList,
        }).amount,
      ).toBeCloseTo(0.21, 4);
      expect(
        getOpenStackUsageCost({
          quantities: month.get(research)!,
          priceList,
        }).amount,
      ).toBeCloseTo(0.045, 4);
    });
  });

  describe("what could be reclaimed", () => {
    const seenAt: string = new Date(OBSERVED_AT_MS).toISOString();
    const toRow: (row: OpenStackResourceBufferEntry) => OpenStackWasteRow = (
      row: OpenStackResourceBufferEntry,
    ): OpenStackWasteRow => {
      return {
        externalId: row.externalId,
        name: row.name,
        regionName: row.regionName,
        openStackProjectId: row.openStackProjectId,
        status: row.status,
        // A new row's state began when it was first seen: see bulkUpsert.
        stateChangedAt: seenAt,
        createdAt: seenAt,
        diskCapacityBytes: row.diskCapacityBytes,
        facts: row.facts as JSONObject,
      };
    };
    const ofKind: (kind: OpenStackResourceKind) => Array<OpenStackWasteRow> = (
      kind: OpenStackResourceKind,
    ): Array<OpenStackWasteRow> => {
      return rows
        .filter((row: OpenStackResourceBufferEntry): boolean => {
          return row.kind === kind;
        })
        .map(toRow);
    };
    const findingsAt: (days: number) => Array<OpenStackWasteFinding> = (
      days: number,
    ): Array<OpenStackWasteFinding> => {
      const usageRows: OpenStackUsageRows = usageRowsOf(rows);
      const instances: Array<OpenStackWasteRow> = ofKind(
        OpenStackResourceKind.Instance,
      );

      return getOpenStackWasteFindings({
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
          instancesNotSaying: instances.filter(
            (row: OpenStackWasteRow): boolean => {
              return !("imageId" in (row.facts || {}));
            },
          ).length,
        }),
        snapshotsAreReported:
          ofKind(OpenStackResourceKind.Snapshot).length > 0,
        movableHosts: [],
        priceList: null,
        now: new Date(OBSERVED_AT_MS + days * DAY_MS),
      });
    };
    const namesOf: (
      findings: Array<OpenStackWasteFinding>,
      rule: OpenStackWasteRuleId,
    ) => Array<string | null> = (
      findings: Array<OpenStackWasteFinding>,
      rule: OpenStackWasteRuleId,
    ): Array<string | null> => {
      return findings
        .find((finding: OpenStackWasteFinding): boolean => {
          return finding.rule === rule;
        })!
        .items.map((item: OpenStackWasteItem): string | null => {
          return item.name;
        });
    };

    test("31 days on, each rule finds what estate.sh left, and nothing that's in use", () => {
      const findings: Array<OpenStackWasteFinding> = findingsAt(31);
      const volumes: Array<string | null> = namesOf(
        findings,
        OpenStackWasteRuleId.UnattachedVolume,
      );

      expect(volumes).toContain("ou-vol-free");
      expect(volumes).not.toContain("ou-vol-used");
      expect(volumes).not.toContain("ou-vol-bad");

      expect(namesOf(findings, OpenStackWasteRuleId.ShutOffInstance)).toEqual([
        "ou-stopped",
      ]);

      // One attached and one spare. A floating IP's name is its address.
      const attached: OpenStackResourceBufferEntry = rows.find(
        (row: OpenStackResourceBufferEntry): boolean => {
          return (
            row.kind === OpenStackResourceKind.FloatingIp &&
            Boolean(row.facts["routerId"])
          );
        },
      )!;
      const spare: OpenStackResourceBufferEntry = rows.find(
        (row: OpenStackResourceBufferEntry): boolean => {
          return (
            row.kind === OpenStackResourceKind.FloatingIp &&
            !row.facts["routerId"]
          );
        },
      )!;

      expect(namesOf(findings, OpenStackWasteRuleId.SpareFloatingIp)).toEqual([
        spare.name,
      ]);
      expect(
        namesOf(findings, OpenStackWasteRuleId.SpareFloatingIp),
      ).not.toContain(attached.name);
    });

    test("6 days on nothing's old enough, and 7 days on a spare address is", () => {
      const six: Array<OpenStackWasteFinding> = findingsAt(6);

      for (const finding of six) {
        expect(finding.count).toBe(0);
      }

      expect(
        namesOf(findingsAt(7), OpenStackWasteRuleId.SpareFloatingIp).length,
      ).toBe(1);
      expect(
        namesOf(findingsAt(7), OpenStackWasteRuleId.UnattachedVolume),
      ).toEqual([]);
    });

    test("29 days on a shut-off instance isn't old enough, and 30 is", () => {
      expect(
        namesOf(findingsAt(29), OpenStackWasteRuleId.ShutOffInstance),
      ).toEqual([]);
      expect(
        namesOf(findingsAt(30), OpenStackWasteRuleId.ShutOffInstance),
      ).toEqual(["ou-stopped"]);
    });

    test("the agent's series can't say what's in use or list snapshots, so those rules say so", () => {
      const findings: Array<OpenStackWasteFinding> = findingsAt(400);
      const rule: (id: OpenStackWasteRuleId) => OpenStackWasteFinding = (
        id: OpenStackWasteRuleId,
      ): OpenStackWasteFinding => {
        return findings.find((finding: OpenStackWasteFinding): boolean => {
          return finding.rule === id;
        })!;
      };

      expect(rule(OpenStackWasteRuleId.UnusedImage).cannotTell).toBe(
        "images-in-use-not-reported",
      );
      expect(rule(OpenStackWasteRuleId.UnusedImage).count).toBe(0);
      expect(rule(OpenStackWasteRuleId.OldSnapshot).cannotTell).toBe(
        "snapshots-not-reported",
      );
    });
  });
});
