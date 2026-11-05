import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import {
  OpenStackCollectionJob,
  OpenStackCollectionReport,
  OpenStackServiceSummary,
} from "Common/Types/OpenStack/OpenStackProbeCollection";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_CANDIDATE_READS_PER_COLLECTION,
  OPENSTACK_CANDIDATE_RESULT_LIMIT,
  OPENSTACK_PER_PART_READS_PER_COLLECTION,
  OpenStackCloudCounts,
  getOpenStackCountsOfSize,
  getOpenStackSeriesCounts,
  simulateOpenStackProbeRequests,
} from "Common/Types/OpenStack/OpenStackScale";
import {
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
} from "Common/Server/Utils/Telemetry/OpenStackSnapshotScan";
import {
  OpenStackCapacityFlavor,
  OpenStackCapacityFlavorRow,
  getOpenStackCapacityFlavorRow,
  readOpenStackCapacityFlavor,
} from "Common/Types/OpenStack/OpenStackCapacitySnapshot";
import {
  OpenStackCapacityFacts,
  getOpenStackCapacityFacts,
} from "../../../Utils/OpenStack/Collectors/AllocationCandidatesCollector";
import OpenStackCollector from "../../../Utils/OpenStack/OpenStackCollector";
import {
  OpenStackHttpRequest,
  OpenStackHttpResponse,
} from "../../../Utils/OpenStack/OpenStackHttp";
import {
  toNovaAggregate,
  toNovaFlavor,
  toNovaService,
} from "../../../Utils/OpenStack/OpenStackInventory";
import {
  CollectorHarness,
  FakeClock,
  ReportedDatapoint,
  collectionJob,
  createCollectorHarness,
  createFakeClock,
  datapointsOf,
} from "./Helpers/CollectorHarness";
import MockOpenStackCloud, {
  MOCK_AUTH_URL,
} from "./Helpers/MockOpenStackCloud";

/*
 * WHAT ASKING PLACEMENT COSTS, COUNTED.
 *
 * GET /allocation_candidates is the one read here that makes Placement work, so the promise is
 * that it stays small however large the cloud: a request count is a request count, on any machine.
 */

const ROUTE: string = "/placement/allocation_candidates";
const INTERVAL_IN_MINUTES: number = 2;
const MINUTE_IN_MS: number = 60_000;

interface Scene {
  cloud: MockOpenStackCloud;
  clock: FakeClock;
  harness: CollectorHarness;
  job: OpenStackCollectionJob;
  requests: Array<OpenStackHttpRequest>;
}

function json(status: number, body: JSONObject): OpenStackHttpResponse {
  return { status, headers: {}, body: JSON.stringify(body) };
}

function sceneOf(data: {
  counts?: OpenStackCloudCounts | undefined;
  answer?:
    | ((request: OpenStackHttpRequest) => OpenStackHttpResponse | undefined)
    | undefined;
  latencyInMs?:
    | ((request: { url: string }, service: OpenStackServiceType) => number)
    | undefined;
}): Scene {
  const clock: FakeClock = createFakeClock();
  const requests: Array<OpenStackHttpRequest> = [];
  const cloud: MockOpenStackCloud = new MockOpenStackCloud({
    counts:
      data.counts ||
      getOpenStackCountsOfSize({ hypervisors: 3, instances: 6, projects: 2 }),
    clock,
    latencyInMs: data.latencyInMs,
    answer: (request: OpenStackHttpRequest) => {
      if (request.url.includes("allocation_candidates")) {
        requests.push(request);
      }
      return data.answer?.(request);
    },
  });

  return {
    cloud,
    clock,
    requests,
    harness: createCollectorHarness({ transport: cloud.transport, clock }),
    job: collectionJob({
      authUrl: MOCK_AUTH_URL,
      collectionIntervalInMinutes: INTERVAL_IN_MINUTES,
    }),
  };
}

async function collect(scene: Scene): Promise<OpenStackCollectionReport> {
  const startedAt: number = scene.clock.now();
  const report: OpenStackCollectionReport = await OpenStackCollector.collect(
    scene.job,
    scene.harness.dependencies,
  );

  scene.clock.advance(
    startedAt + INTERVAL_IN_MINUTES * MINUTE_IN_MS - scene.clock.now(),
  );

  return report;
}

function asked(scene: Scene): number {
  return scene.cloud.requestsByRoute.get(ROUTE) || 0;
}

function fitsOf(report: OpenStackCollectionReport): Array<ReportedDatapoint> {
  return datapointsOf(report.resourceMetrics).filter(
    (point: ReportedDatapoint): boolean => {
      return point.metric === "openstack_placement_flavor_fits";
    },
  );
}

function regionFitsOf(
  report: OpenStackCollectionReport,
): Array<ReportedDatapoint> {
  return fitsOf(report).filter((point: ReportedDatapoint): boolean => {
    return point.labels["scope"] === "region";
  });
}

function placementSummaryOf(
  report: OpenStackCollectionReport,
): OpenStackServiceSummary {
  return report.summary!.services!.find(
    (service: OpenStackServiceSummary): boolean => {
      return service.service === OpenStackServiceType.Placement;
    },
  )!;
}

// A flavors list of this cloud's own making, for a question about what it holds.
function flavorsAnswer(flavors: Array<JSONObject>): OpenStackHttpResponse {
  return json(200, { flavors });
}

function flavor(id: string, extra?: JSONObject): JSONObject {
  return {
    id,
    name: `flavor-${id}`,
    vcpus: 1,
    ram: 2048,
    disk: 20,
    "OS-FLV-EXT-DATA:ephemeral": 0,
    swap: 0,
    "OS-FLV-DISABLED:disabled": false,
    "os-flavor-access:is_public": true,
    ...extra,
  };
}

describe("what it asks, and how often", () => {
  test("a first collection asks nothing: it has only just been told what to ask about", async () => {
    const scene: Scene = sceneOf({});

    const report: OpenStackCollectionReport = await collect(scene);

    expect(asked(scene)).toBe(0);
    expect(fitsOf(report)).toEqual([]);
  });

  test("after that exactly a turn's worth a collection, however many flavors there are", async () => {
    const counts: OpenStackCloudCounts = getOpenStackCountsOfSize({
      hypervisors: 3,
      instances: 6,
      projects: 2,
    });
    const scene: Scene = sceneOf({ counts });

    expect(counts.flavors).toBe(40);

    await collect(scene);

    for (let round: number = 1; round <= 5; round++) {
      await collect(scene);
      expect(asked(scene)).toBe(
        round * OPENSTACK_CANDIDATE_READS_PER_COLLECTION,
      );
    }
  });

  test("every flavor comes round, and what wasn't asked this time is sent as it last stood", async () => {
    const scene: Scene = sceneOf({});

    await collect(scene);

    const turns: number = Math.ceil(
      40 / OPENSTACK_CANDIDATE_READS_PER_COLLECTION,
    );

    let report: OpenStackCollectionReport = await collect(scene);
    expect(regionFitsOf(report)).toHaveLength(
      OPENSTACK_CANDIDATE_READS_PER_COLLECTION,
    );

    for (let turn: number = 1; turn < turns; turn++) {
      report = await collect(scene);
      expect(regionFitsOf(report)).toHaveLength(
        (turn + 1) * OPENSTACK_CANDIDATE_READS_PER_COLLECTION,
      );
    }

    expect(regionFitsOf(report)).toHaveLength(40);
    expect(asked(scene)).toBe(40);

    // Round again: as many series, and the same few questions a collection.
    report = await collect(scene);
    expect(regionFitsOf(report)).toHaveLength(40);
    expect(asked(scene)).toBe(44);
  });

  test("a cloud with fewer flavors than a turn asks about each of them each time", async () => {
    const scene: Scene = sceneOf({
      answer: (request: OpenStackHttpRequest) => {
        return request.url.includes("/flavors/detail")
          ? flavorsAnswer([
              flavor("1", { ram: 1024 }),
              flavor("2", { ram: 2048 }),
            ])
          : undefined;
      },
    });

    await collect(scene);
    expect(asked(scene)).toBe(0);
    await collect(scene);
    expect(asked(scene)).toBe(2);
    await collect(scene);
    expect(asked(scene)).toBe(4);
  });

  test("flavors that ask for the same thing are one question, and each is told the answer", async () => {
    const scene: Scene = sceneOf({
      answer: (request: OpenStackHttpRequest) => {
        return request.url.includes("/flavors/detail")
          ? flavorsAnswer([
              flavor("a"),
              flavor("b"),
              flavor("c"),
              flavor("d", { ram: 4096 }),
            ])
          : undefined;
      },
    });

    await collect(scene);

    const report: OpenStackCollectionReport = await collect(scene);

    expect(asked(scene)).toBe(2);
    expect(
      regionFitsOf(report)
        .map((point: ReportedDatapoint) => {
          return point.labels["flavor_id"];
        })
        .sort(),
    ).toEqual(["a", "b", "c", "d"]);
  });

  test("a disabled flavor nobody can ask for isn't asked about", async () => {
    const scene: Scene = sceneOf({
      answer: (request: OpenStackHttpRequest) => {
        return request.url.includes("/flavors/detail")
          ? flavorsAnswer([
              flavor("on"),
              flavor("off", { "OS-FLV-DISABLED:disabled": true, ram: 1024 }),
            ])
          : undefined;
      },
    });

    await collect(scene);

    const report: OpenStackCollectionReport = await collect(scene);

    expect(asked(scene)).toBe(1);
    expect(
      regionFitsOf(report).map((point: ReportedDatapoint) => {
        return point.labels["flavor_id"];
      }),
    ).toEqual(["on"]);
  });

  test("each question is what a boot would be told, at the microversion it needs, one at a time", async () => {
    let inFlight: number = 0;
    let mostAtOnce: number = 0;
    const clockScene: Scene = sceneOf({
      answer: (request: OpenStackHttpRequest) => {
        if (request.url.includes("/flavors/detail")) {
          return flavorsAnswer([
            flavor("gold", {
              extra_specs: {
                "trait:CUSTOM_GOLD": "required",
                "trait:CUSTOM_SLOW": "forbidden",
              },
            }),
          ]);
        }
        if (request.url.includes("allocation_candidates")) {
          inFlight += 1;
          mostAtOnce = Math.max(mostAtOnce, inFlight);
          inFlight -= 1;
        }
        return undefined;
      },
    });

    await collect(clockScene);
    await collect(clockScene);

    expect(clockScene.requests).toHaveLength(1);
    expect(mostAtOnce).toBe(1);

    const request: OpenStackHttpRequest = clockScene.requests[0]!;
    const url: URL = new URL(request.url);

    expect(url.searchParams.get("resources")).toBe(
      "DISK_GB:20,MEMORY_MB:2048,VCPU:1",
    );
    expect(url.searchParams.get("required")).toBe(
      "CUSTOM_GOLD,!CUSTOM_SLOW,!COMPUTE_STATUS_DISABLED",
    );
    expect(url.searchParams.get("limit")).toBe(
      String(OPENSTACK_CANDIDATE_RESULT_LIMIT),
    );
    expect(request.headers["OpenStack-API-Version"]).toBe("placement 1.29");
  });

  test("the rest of Placement isn't asked at that microversion", async () => {
    const seen: Array<string | undefined> = [];
    const scene: Scene = sceneOf({
      answer: (request: OpenStackHttpRequest) => {
        if (
          request.url.includes("/placement/resource_providers") &&
          !request.url.includes("allocation_candidates")
        ) {
          seen.push(request.headers["OpenStack-API-Version"]);
        }
        return undefined;
      },
    });

    await collect(scene);
    await collect(scene);
    await collect(scene);

    expect(new Set(seen)).toEqual(new Set([undefined]));
  });
});

describe("it adds up to what the docs say", () => {
  test("its reads are in the published numbers, at every collection", async () => {
    const counts: OpenStackCloudCounts = getOpenStackCountsOfSize({
      hypervisors: 3,
      instances: 6,
      projects: 2,
    });
    const scene: Scene = sceneOf({ counts });

    for (let collection: number = 0; collection < 30; collection++) {
      await collect(scene);
    }

    expect(scene.cloud.countsByService()).toEqual(
      simulateOpenStackProbeRequests({
        counts,
        fromMinute: 0,
        toMinute: 60,
      }),
    );
    expect(asked(scene)).toBe(29 * OPENSTACK_CANDIDATE_READS_PER_COLLECTION);
  });

  test("a large cloud asks no more than a small one, and a read's answer is capped", async () => {
    const counts: OpenStackCloudCounts = getOpenStackCountsOfSize({
      hypervisors: 2500,
      instances: 10,
      projects: 2,
    });
    const scene: Scene = sceneOf({ counts });

    await collect(scene);
    scene.cloud.resetCounts();

    const report: OpenStackCollectionReport = await collect(scene);

    expect(asked(scene)).toBe(OPENSTACK_CANDIDATE_READS_PER_COLLECTION);
    // Compared to a whole collection of Placement, it hardly shows.
    expect(
      scene.cloud.countsByService()[OpenStackServiceType.Placement],
    ).toBeLessThanOrEqual(
      1 +
        OPENSTACK_PER_PART_READS_PER_COLLECTION * 2 +
        OPENSTACK_CANDIDATE_READS_PER_COLLECTION,
    );

    /*
     * Past Nova's own limit, the answer has as many hosts as it was asked for. Every one has room
     * for 96 (2047 GB / 10 at most, 1536 vCPUs, and memory is what's asked for), so a floor.
     */
    const region: ReportedDatapoint = regionFitsOf(report)[0]!;

    expect(region.labels["is_capped"]).toBe("true");
    expect(region.labels["hosts_with_room"]).toBe(
      String(OPENSTACK_CANDIDATE_RESULT_LIMIT),
    );
  });

  test("the series are what the volume estimate says, once every flavor has an answer", async () => {
    const counts: OpenStackCloudCounts = getOpenStackCountsOfSize({
      hypervisors: 1,
      instances: 2,
      projects: 2,
    });
    const scene: Scene = sceneOf({ counts });

    const first: OpenStackCollectionReport = await collect(scene);
    const series: { fast: number; slow: number } = getOpenStackSeriesCounts({
      counts,
    });

    expect(first.summary?.datapointCount).toBe(series.fast + series.slow);

    let report: OpenStackCollectionReport = first;
    for (let turn: number = 0; turn < 10; turn++) {
      report = await collect(scene);
    }

    // One for the region and one for the one zone the one host is in.
    expect(fitsOf(report)).toHaveLength(counts.flavors * 2);
    expect(
      getOpenStackSeriesCounts({ counts, flavorsAnswered: counts.flavors })
        .fast - getOpenStackSeriesCounts({ counts }).fast,
    ).toBe(counts.flavors * 2);
  });
});

describe("it stops when told, and never gets in the way", () => {
  test("a credential that may not ask is left alone for a while, and nothing reads as wrong", async () => {
    let isRefused: boolean = true;
    const scene: Scene = sceneOf({
      answer: (request: OpenStackHttpRequest) => {
        return isRefused && request.url.includes("allocation_candidates")
          ? json(403, { message: "Policy doesn't allow this." })
          : undefined;
      },
    });

    await collect(scene);

    const refused: OpenStackCollectionReport = await collect(scene);

    // One question, and the turn stops there.
    expect(asked(scene)).toBe(1);
    expect(refused.status).toBe("Succeeded");
    expect(placementSummaryOf(refused).outcome).toBe("Succeeded");
    expect(refused.summary?.warnings || []).toEqual([]);
    expect(
      datapointsOf(refused.resourceMetrics).find(
        (point: ReportedDatapoint): boolean => {
          return point.metric === "openstack_placement_up";
        },
      )?.value,
    ).toBe(1);
    expect(regionFitsOf(refused)).toEqual([]);

    for (let collection: number = 0; collection < 10; collection++) {
      await collect(scene);
    }

    expect(asked(scene)).toBe(1);

    // After an hour it asks again, because someone may have added the policy.
    isRefused = false;
    scene.clock.advance(60 * MINUTE_IN_MS);
    await collect(scene);
    expect(asked(scene)).toBeGreaterThan(1);
  });

  test("Placement in trouble isn't asked for the rest of this collection", async () => {
    const scene: Scene = sceneOf({
      answer: (request: OpenStackHttpRequest) => {
        return request.url.includes("allocation_candidates")
          ? json(500, { message: "Oops" })
          : undefined;
      },
    });

    await collect(scene);
    await collect(scene);

    // A failing read stops the turn, once its own retries are spent.
    expect(asked(scene)).toBeLessThanOrEqual(3);
  });

  test("everything else this collection reads from Placement still counts, whatever this does", async () => {
    const scene: Scene = sceneOf({
      answer: (request: OpenStackHttpRequest) => {
        return request.url.includes("allocation_candidates")
          ? json(500, { message: "Oops" })
          : undefined;
      },
    });

    await collect(scene);

    const report: OpenStackCollectionReport = await collect(scene);
    const up: ReportedDatapoint | undefined = datapointsOf(
      report.resourceMetrics,
    ).find((point: ReportedDatapoint): boolean => {
      return point.metric === "openstack_placement_up";
    });

    expect(up?.value).toBe(1);
    expect(
      datapointsOf(report.resourceMetrics).filter(
        (point: ReportedDatapoint): boolean => {
          return point.metric === "openstack_placement_resource_total";
        },
      ).length,
    ).toBeGreaterThan(0);
  });

  test("a Placement that's already being waited for isn't asked the heaviest thing it has", async () => {
    let isSlow: boolean = false;
    const scene: Scene = sceneOf({
      latencyInMs: (
        _request: { url: string },
        service: OpenStackServiceType,
      ): number => {
        return isSlow && service === OpenStackServiceType.Placement ? 6000 : 1;
      },
    });

    await collect(scene);
    await collect(scene);
    expect(asked(scene)).toBe(OPENSTACK_CANDIDATE_READS_PER_COLLECTION);

    isSlow = true;
    const before: number = asked(scene);
    const report: OpenStackCollectionReport = await collect(scene);

    // Nothing asked of it beyond its list, and each host's usages and allocations.
    expect(asked(scene)).toBe(before);
    expect(placementSummaryOf(report).requestCount).toBe(7);
  });

  test("a Nova that can't be read leaves what it last said to ask about", async () => {
    let isDown: boolean = false;
    const scene: Scene = sceneOf({
      answer: (request: OpenStackHttpRequest) => {
        return isDown && request.url.includes("/flavors/detail")
          ? json(500, { message: "Oops" })
          : undefined;
      },
    });

    await collect(scene);
    await collect(scene);
    const before: number = asked(scene);

    isDown = true;
    await collect(scene);

    expect(asked(scene)).toBe(
      before + OPENSTACK_CANDIDATE_READS_PER_COLLECTION,
    );
  });
});

describe("what it says of a host", () => {
  test("Nova's services say which hosts count, and its aggregates which group they're in", () => {
    const facts: OpenStackCapacityFacts | null = getOpenStackCapacityFacts({
      flavors: [toNovaFlavor(flavor("a"))],
      services: [
        toNovaService({
          binary: "nova-compute",
          host: "compute-01",
          zone: "zone-a",
          status: "enabled",
          state: "up",
        }),
        toNovaService({
          binary: "nova-compute",
          host: "compute-02.example.org",
          zone: "zone-a",
          status: "enabled",
          state: "down",
        }),
        toNovaService({
          binary: "nova-compute",
          host: "compute-03",
          zone: "zone-b",
          status: "disabled",
          state: "up",
        }),
        toNovaService({
          binary: "nova-scheduler",
          host: "controller",
          zone: "internal",
          status: "enabled",
          state: "up",
        }),
      ],
      aggregates: [
        toNovaAggregate({
          name: "rack-a",
          availability_zone: "zone-a",
          metadata: { availability_zone: "zone-a" },
          hosts: ["compute-01"],
        }),
        toNovaAggregate({
          name: "gold",
          availability_zone: null,
          metadata: { tier: "gold" },
          hosts: ["compute-01", "compute-03"],
        }),
      ],
    });

    expect(Array.from(facts!.hostsByShortName.entries())).toEqual([
      [
        "compute-01",
        {
          name: "compute-01",
          zone: "zone-a",
          // rack-a only exists to set a zone, so it is no group anyone made.
          aggregates: ["gold"],
          state: "up",
        },
      ],
      [
        "compute-02",
        {
          name: "compute-02.example.org",
          zone: "zone-a",
          aggregates: [],
          state: "lost",
        },
      ],
      [
        "compute-03",
        {
          name: "compute-03",
          zone: "zone-b",
          aggregates: ["gold"],
          state: "disabled",
        },
      ],
    ]);
  });

  test("no flavors read is nothing to ask about, and leaves the last answer standing", () => {
    expect(getOpenStackCapacityFacts({})).toBe(null);
  });

  test("a lost host isn't counted, though Placement goes on offering it", async () => {
    const scene: Scene = sceneOf({
      counts: getOpenStackCountsOfSize({
        hypervisors: 2,
        instances: 2,
        projects: 2,
      }),
      answer: (request: OpenStackHttpRequest) => {
        if (request.url.includes("/flavors/detail")) {
          return flavorsAnswer([flavor("a")]);
        }
        if (request.url.endsWith("/os-services")) {
          return json(200, {
            services: [
              {
                id: "1",
                binary: "nova-compute",
                host: "compute-0000",
                zone: "zone-a",
                status: "enabled",
                state: "down",
              },
              {
                id: "2",
                binary: "nova-compute",
                host: "compute-0001",
                zone: "zone-a",
                status: "enabled",
                state: "up",
              },
            ],
          });
        }
        return undefined;
      },
    });

    await collect(scene);

    const report: OpenStackCollectionReport = await collect(scene);
    const region: ReportedDatapoint = regionFitsOf(report)[0]!;

    // Each host: 2047 GB / 20 = 102, 1536 / 1 = 1536, 1146382 / 2048 = 559. One host counts.
    expect(region.value).toBe(102);
    expect(region.labels["hosts_with_room"]).toBe("1");
    expect(region.labels["is_capped"]).toBe("false");
    expect(
      fitsOf(report)
        .filter((point: ReportedDatapoint): boolean => {
          return point.labels["scope"] === "zone";
        })
        .map((point: ReportedDatapoint) => {
          return [point.labels["scope_name"], point.value];
        }),
    ).toEqual([["zone-a", 102]]);
  });
});

describe("what the server makes of it", () => {
  function foldedFlavors(
    report: OpenStackCollectionReport,
  ): Array<OpenStackResourceBufferEntry> {
    const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();

    for (const resource of report.resourceMetrics as Array<JSONObject>) {
      for (const scope of resource["scopeMetrics"] as Array<JSONObject>) {
        for (const metric of scope["metrics"] as Array<JSONObject>) {
          const body: JSONObject = (metric["gauge"] ||
            metric["sum"]) as JSONObject;

          for (const datapoint of body["dataPoints"] as Array<JSONObject>) {
            bufferOpenStackSnapshotMetric({
              metricName: metric["name"] as string,
              datapoint,
              buffer,
            });
          }
        }
      }
    }

    return finishOpenStackBatch(buffer.values()).filter(
      (entry: OpenStackResourceBufferEntry): boolean => {
        return entry.kind === "Flavor";
      },
    );
  }

  test("a flavor's row says what Placement said, and the page says it asked", async () => {
    const scene: Scene = sceneOf({
      counts: getOpenStackCountsOfSize({
        hypervisors: 1,
        instances: 2,
        projects: 2,
      }),
      answer: (request: OpenStackHttpRequest) => {
        return request.url.includes("/flavors/detail")
          ? flavorsAnswer([
              flavor("gold", {
                extra_specs: {
                  "trait:CUSTOM_GOLD": "required",
                  "resources:CUSTOM_GPU": "1",
                },
              }),
            ])
          : undefined;
      },
    });

    await collect(scene);
    const report: OpenStackCollectionReport = await collect(scene);
    const [entry] = foldedFlavors(report);

    expect(entry!.facts["placementResources"]).toBe(
      "CUSTOM_GPU:1,DISK_GB:20,MEMORY_MB:2048,VCPU:1",
    );
    expect(entry!.facts["placementRequired"]).toBe("CUSTOM_GOLD");
    expect(entry!.facts["placementForbidden"]).toBe(null);
    expect(entry!.facts["isDisabled"]).toBe(null);

    const row: OpenStackCapacityFlavor = readOpenStackCapacityFlavor({
      row: {
        externalId: entry!.externalId,
        name: entry!.name,
        regionName: entry!.regionName,
        vcpuCapacity: entry!.vcpuCapacity,
        memoryCapacityBytes: entry!.memoryCapacityBytes,
        diskCapacityBytes: entry!.diskCapacityBytes,
        facts: entry!.facts,
      },
      instanceCount: 0,
    });

    expect(row.request).toEqual({
      resources: { CUSTOM_GPU: 1, DISK_GB: 20, MEMORY_MB: 2048, VCPU: 1 },
      requiredTraits: ["CUSTOM_GOLD"],
      forbiddenTraits: [],
    });

    const flavorRow: OpenStackCapacityFlavorRow = getOpenStackCapacityFlavorRow(
      {
        flavor: row,
        hosts: [],
        now: new Date(scene.clock.now()),
      },
    );

    expect(flavorRow.source).toBe("placement");
    expect(flavorRow.fits).toBe(102);
    expect(flavorRow.hostsWithRoom).toBe(1);
    expect(flavorRow.askedAt).toEqual(expect.any(String));
  });

  test("half an answer is no answer", () => {
    const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();

    bufferOpenStackSnapshotMetric({
      metricName: "openstack_placement_flavor_fits",
      datapoint: {
        asDouble: 3,
        timeUnixNano: "1793785799000000000",
        attributes: [
          { key: "flavor_id", value: { stringValue: "a" } },
          { key: "scope", value: { stringValue: "zone" } },
          { key: "scope_name", value: { stringValue: "nova" } },
        ],
      },
      buffer,
    });

    expect(
      finishOpenStackBatch(buffer.values())[0]!.facts["placementAnswer"],
    ).toBeUndefined();
  });
});
