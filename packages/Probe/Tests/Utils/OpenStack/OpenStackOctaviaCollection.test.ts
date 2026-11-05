import { describe, expect, test } from "@jest/globals";
import { OpenStackResourceBufferEntry } from "Common/Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { OpenStackAccessRead } from "Common/Types/OpenStack/OpenStackProbeCollection";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  OCTAVIA_MEMBER_READS_PER_COLLECTION,
  OCTAVIA_STATS_READS_PER_COLLECTION,
  OCTAVIA_STATS_REMEMBERED_FOR_IN_MS,
  getOctaviaRates,
} from "../../../Utils/OpenStack/Collectors/LoadBalancerCollector";
import { ReportedDatapoint } from "./Helpers/CollectorHarness";
import {
  RECORDED_HOST,
  RecordedScene,
  loadScene,
  recordedJson,
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
 * What a probe sends of Octavia is what the agent sends, on the same real DevStack at the same moment
 * (services-octavia, stable/2026.1), plus what only a native read can add: listeners, members and the
 * rates of Octavia's traffic counters, whose answers the rig recorded one per load balancer and listener, a
 * minute apart (baseline and baseline-one-minute-later).
 */

const GROUP: string = "services-octavia";
const OCTAVIA_URL: string = `${RECORDED_HOST}/load-balancer`;
const PREFIX: string = "/load-balancer/v2";
const CATALOG: Array<JSONObject> = [catalogEntry("load-balancer", OCTAVIA_URL)];

const SCENES: ReadonlyArray<string> = [
  "baseline",
  "baseline-one-minute-later",
  "active-standby",
  "ovn-provider",
  "pool-members-down",
  "pending-update",
  "pending-create",
  "lb-error",
  "amphora-near-expiry",
  "two-masters",
  "amphora-error",
  "recovered",
];

function namesById(
  scene: RecordedScene,
  call: string,
  key: string,
): Map<string, string> {
  const answer: JSONObject | undefined = recordedJson(scene, call);
  return new Map(
    ((answer?.[key] as JSONArray) || []).map(
      (item: unknown): [string, string] => {
        return [
          (item as JSONObject)["id"] as string,
          (item as JSONObject)["name"] as string,
        ];
      },
    ),
  );
}

// Every route of Octavia the rig recorded, by the recording's own name for it.
function callOf(scene: RecordedScene): (path: string) => string | undefined {
  const pools: Map<string, string> = namesById(scene, "octavia-pools", "pools");
  const balancers: Map<string, string> = namesById(
    scene,
    "octavia-loadbalancers",
    "loadbalancers",
  );
  const listeners: Map<string, string> = namesById(
    scene,
    "octavia-listeners",
    "listeners",
  );

  return (path: string): string | undefined => {
    const fixed: Record<string, string> = {
      [`${PREFIX}/lbaas/loadbalancers`]: "octavia-loadbalancers",
      [`${PREFIX}/lbaas/pools`]: "octavia-pools",
      [`${PREFIX}/lbaas/listeners`]: "octavia-listeners",
      [`${PREFIX}/octavia/amphorae`]: "octavia-amphorae",
    };
    if (fixed[path]) {
      return fixed[path];
    }
    let found: RegExpExecArray | null = new RegExp(
      `^${PREFIX}/lbaas/pools/([^/]+)/members$`,
    ).exec(path);
    if (found) {
      return `octavia-members-${pools.get(found[1] as string)}`;
    }
    found = new RegExp(`^${PREFIX}/lbaas/loadbalancers/([^/]+)/stats$`).exec(
      path,
    );
    if (found) {
      return `octavia-lb-stats-${balancers.get(found[1] as string)}`;
    }
    found = new RegExp(`^${PREFIX}/lbaas/listeners/([^/]+)/stats$`).exec(path);
    return found
      ? `octavia-listener-stats-${listeners.get(found[1] as string)}`
      : undefined;
  };
}

function answerFrom(
  scene: RecordedScene,
  override?: ((path: string) => RecordedAnswer | undefined) | undefined,
): (path: string) => RecordedAnswer | undefined {
  const call: (path: string) => string | undefined = callOf(scene);
  return (path: string): RecordedAnswer | undefined => {
    const overridden: RecordedAnswer | undefined = override?.(path);
    if (overridden) {
      return overridden;
    }
    const name: string | undefined = call(path);
    return name ? recordedCall(scene, name) : undefined;
  };
}

async function collect(
  scene: RecordedScene,
  override?: ((path: string) => RecordedAnswer | undefined) | undefined,
): Promise<RecordedServiceCollection> {
  return await collectFromRecordedService({
    catalog: CATALOG,
    answer: answerFrom(scene, override),
  });
}

function octaviaRequests(
  requests: ReadonlyArray<RecordedRequest>,
): Array<string> {
  return requests
    .filter((request: RecordedRequest): boolean => {
      return request.path.startsWith("/load-balancer");
    })
    .map((request: RecordedRequest): string => {
      return request.path.replace(PREFIX, "");
    });
}

function rowsOf(
  rows: ReadonlyArray<OpenStackResourceBufferEntry>,
  kind: OpenStackResourceKind,
): Array<OpenStackResourceBufferEntry> {
  return rows.filter((row: OpenStackResourceBufferEntry): boolean => {
    return row.kind === kind;
  });
}

describe("Octavia, on what a real cloud said", () => {
  describe.each(SCENES)("%s", (name: string) => {
    const scene: RecordedScene = loadScene(GROUP, name);

    /*
     * The rig scraped the exporter and read the API a moment apart, and in these two scenes the active-standby
     * pair was DEGRADED in the first and ONLINE in the second (a failover settling). Both are what Octavia said
     * at the time, so these two are compared on everything but that pair's operating status below.
     */
    const SETTLING: ReadonlyArray<string> = ["lb-error", "recovered"];

    if (!SETTLING.includes(name)) {
      test.each([
        "openstack_loadbalancer_loadbalancer_status",
        "openstack_loadbalancer_pool_status",
      ])("%s is the exporter's, label for label", async (metric: string) => {
        const { points } = await collect(scene);
        expect(comparableOfProbe(points, metric)).toEqual(
          comparableOfExporter(scene, metric),
        );
      });
    }

    test.each([
      "openstack_loadbalancer_amphora_status",
      "openstack_loadbalancer_total_loadbalancers",
      "openstack_loadbalancer_total_pools",
      "openstack_loadbalancer_total_amphorae",
      "openstack_loadbalancer_up",
    ])("%s is the exporter's, label for label", async (metric: string) => {
      const { points } = await collect(scene);
      expect(comparableOfProbe(points, metric)).toEqual(
        comparableOfExporter(scene, metric),
      );
    });

    test("makes a row for each thing the exporter counted, and adds the listeners and members", async () => {
      const { report } = await collect(scene);
      const rows: Array<OpenStackResourceBufferEntry> =
        rowsOfReport(report).rows;
      const counted: (metric: string) => number = (metric: string): number => {
        return (
          scene.exporter.find((series: { name: string }): boolean => {
            return series.name === metric;
          })?.value ?? 0
        );
      };

      expect(rowsOf(rows, OpenStackResourceKind.LoadBalancer)).toHaveLength(
        counted("openstack_loadbalancer_total_loadbalancers"),
      );
      expect(rowsOf(rows, OpenStackResourceKind.LoadBalancerPool)).toHaveLength(
        counted("openstack_loadbalancer_total_pools"),
      );
      expect(rowsOf(rows, OpenStackResourceKind.Amphora)).toHaveLength(
        counted("openstack_loadbalancer_total_amphorae"),
      );
      expect(
        rowsOf(rows, OpenStackResourceKind.Listener).length,
      ).toBeGreaterThan(0);
      expect(
        rowsOf(rows, OpenStackResourceKind.LoadBalancerMember).length,
      ).toBeGreaterThan(0);
    });
  });

  test("api-down: its API reads 0 where the exporter said nothing, and no row", async () => {
    const scene: RecordedScene = loadScene(GROUP, "api-down");
    const { points, report } = await collect(scene, (): RecordedAnswer => {
      return { status: 503, body: "{}" };
    });

    expect(
      pointsNamed(points, "openstack_loadbalancer_loadbalancer_status"),
    ).toEqual([]);
    expect(
      pointsNamed(points, "openstack_loadbalancer_listener_status"),
    ).toEqual([]);
    expect(
      rowsOf(rowsOfReport(report).rows, OpenStackResourceKind.LoadBalancer),
    ).toEqual([]);
  });
});

describe("two moments of one active-standby pair", () => {
  test.each(["lb-error", "recovered"])(
    "%s: the exporter and the API caught the pair a moment apart, and the probe says what the API said",
    async (name: string) => {
      const scene: RecordedScene = loadScene(GROUP, name);
      const { points } = await collect(scene);
      const probe: ReportedDatapoint | undefined = pointsNamed(
        points,
        "openstack_loadbalancer_loadbalancer_status",
      ).find((point: ReportedDatapoint): boolean => {
        return point.labels["name"] === "ou-lb-ha";
      });

      const said: string = (
        (recordedJson(scene, "octavia-loadbalancers")?.[
          "loadbalancers"
        ] as Array<JSONObject>) || []
      ).find((one: JSONObject): boolean => {
        return one["name"] === "ou-lb-ha";
      })?.["operating_status"] as string;

      expect(probe?.labels["operating_status"]).toBe(said);
      expect(probe?.value).toBe(said === "ONLINE" ? 0 : -1);
      // Everything else about every load balancer is the exporter's.
      const strip = (list: Array<string>): Array<string> => {
        return list.filter((line: string): boolean => {
          return !line.includes("ou-lb-ha");
        });
      };
      expect(
        strip(
          comparableOfProbe(
            points,
            "openstack_loadbalancer_loadbalancer_status",
          ),
        ),
      ).toEqual(
        strip(
          comparableOfExporter(
            scene,
            "openstack_loadbalancer_loadbalancer_status",
          ),
        ),
      );
    },
  );
});

describe("what only a native read says", () => {
  test("a listener says its load balancer, its pool and its port, and a member its address and its pool", async () => {
    const { report } = await collect(loadScene(GROUP, "baseline"));
    const rows: Array<OpenStackResourceBufferEntry> = rowsOfReport(report).rows;
    const listener: OpenStackResourceBufferEntry = rowsOf(
      rows,
      OpenStackResourceKind.Listener,
    ).find((row: OpenStackResourceBufferEntry): boolean => {
      return row.name === "ou-lb-listener";
    })!;

    expect(listener.status).toBe("ACTIVE");
    expect(listener.facts).toMatchObject({
      operatingStatus: "ONLINE",
      protocol: "HTTP",
      protocolPort: 80,
      loadBalancerId: "27c8eb38-e43d-4f03-82b9-e6f4e714fa38",
      defaultPoolId: "191471d8-1ec1-4158-a922-b009bfdaac33",
    });

    const member: OpenStackResourceBufferEntry = rowsOf(
      rows,
      OpenStackResourceKind.LoadBalancerMember,
    ).find((row: OpenStackResourceBufferEntry): boolean => {
      return row.name === "ou-lb-pool-member-1";
    })!;
    expect(member.facts).toMatchObject({
      operatingStatus: "ONLINE",
      poolId: "191471d8-1ec1-4158-a922-b009bfdaac33",
      address: "10.77.0.26",
      protocolPort: 80,
      weight: 1,
      isBackup: false,
    });
  });

  test("every member of a pool failing its health monitor reads ERROR, and the pool and its load balancer still provision ACTIVE", async () => {
    const { report } = await collect(loadScene(GROUP, "pool-members-down"));
    const rows: Array<OpenStackResourceBufferEntry> = rowsOfReport(report).rows;
    const members: Array<OpenStackResourceBufferEntry> = rowsOf(
      rows,
      OpenStackResourceKind.LoadBalancerMember,
    ).filter((row: OpenStackResourceBufferEntry): boolean => {
      return row.facts["poolId"] === "191471d8-1ec1-4158-a922-b009bfdaac33";
    });

    expect(members.length).toBeGreaterThan(0);
    for (const member of members) {
      expect(member.facts["operatingStatus"]).toBe("ERROR");
      expect(member.status).toBe("ACTIVE");
    }
  });
});

describe("what it costs", () => {
  test("baseline: four lists, a pool's members each, and the counters of each load balancer and listener, once", async () => {
    const { requests } = await collect(loadScene(GROUP, "baseline"));
    const asked: Array<string> = octaviaRequests(requests);

    // 4 lists + 1 per pool (1) + 1 per load balancer (3) + 1 per listener (1).
    expect(asked).toHaveLength(9);
    expect(asked.slice(0, 4)).toEqual([
      "/lbaas/loadbalancers",
      "/lbaas/pools",
      "/lbaas/listeners",
      "/octavia/amphorae",
    ]);
    expect(
      asked.filter((path: string): boolean => {
        return path.endsWith("/members");
      }),
    ).toHaveLength(1);
    expect(
      asked.filter((path: string): boolean => {
        return path.endsWith("/stats");
      }),
    ).toHaveLength(4);
    expect(new Set(asked).size).toBe(asked.length);
  });

  test("a load balancer that is not ACTIVE is not asked for its counters, nor are its listeners", async () => {
    const { requests } = await collect(loadScene(GROUP, "pending-create"));
    const stats: Array<string> = octaviaRequests(requests).filter(
      (path: string): boolean => {
        return path.endsWith("/stats");
      },
    );
    // ou-lb is PENDING_UPDATE and ou-lb-pending is PENDING_CREATE: only the other two are ACTIVE.
    expect(stats).toHaveLength(4);
  });

  test("a cloud past the limits reads this many pools and counters a collection, the longest unread first, and says what the rest said before", async () => {
    const scene: RecordedScene = loadScene(GROUP, "baseline");
    const pool: JSONObject = (
      recordedJson(scene, "octavia-pools")?.["pools"] as JSONArray
    )[0] as JSONObject;
    const pools: Array<JSONObject> = [];
    for (
      let at: number = 0;
      at < OCTAVIA_MEMBER_READS_PER_COLLECTION + 5;
      at++
    ) {
      pools.push({ ...pool, id: `pool-${at}`, name: `pool-${at}` });
    }
    const harness: Awaited<ReturnType<typeof collect>> =
      await collectFromRecordedService({
        catalog: CATALOG,
        answer: (path: string): RecordedAnswer | undefined => {
          if (path === `${PREFIX}/lbaas/pools`) {
            return { status: 200, body: JSON.stringify({ pools }) };
          }
          if (path.endsWith("/members")) {
            return {
              status: 200,
              body: JSON.stringify({
                members: [
                  {
                    id: `member-of-${path.split("/")[5]}`,
                    name: "m",
                    operating_status: "ONLINE",
                    provisioning_status: "ACTIVE",
                    address: "10.0.0.1",
                    protocol_port: 80,
                    weight: 1,
                    backup: false,
                  },
                ],
              }),
            };
          }
          return answerFrom(scene)(path);
        },
      });
    const first: Array<string> = octaviaRequests(harness.requests).filter(
      (path: string): boolean => {
        return path.endsWith("/members");
      },
    );
    expect(first).toHaveLength(OCTAVIA_MEMBER_READS_PER_COLLECTION);

    // The ones past the limit are read next, and the others have not been read since.
    harness.harness.clock.advance(5 * 60_000);
    const second: RecordedServiceCollection = await collectFromRecordedService({
      harness: harness.harness,
      catalog: CATALOG,
      answer: (path: string): RecordedAnswer | undefined => {
        if (path === `${PREFIX}/lbaas/pools`) {
          return { status: 200, body: JSON.stringify({ pools }) };
        }
        if (path.endsWith("/members")) {
          return {
            status: 200,
            body: JSON.stringify({ members: [] }),
          };
        }
        return answerFrom(scene)(path);
      },
    });
    const next: Array<string> = octaviaRequests(second.requests).filter(
      (path: string): boolean => {
        return path.endsWith("/members");
      },
    );
    expect(next).toHaveLength(OCTAVIA_MEMBER_READS_PER_COLLECTION);
    expect(next.slice(0, 5).sort()).toEqual(
      Array.from({ length: 5 }, (_unused: unknown, at: number): string => {
        return `/lbaas/pools/pool-${OCTAVIA_MEMBER_READS_PER_COLLECTION + at}/members`;
      }).sort(),
    );
    expect(OCTAVIA_STATS_READS_PER_COLLECTION).toBeGreaterThan(0);
  });
});

describe("traffic is a rate between two readings", () => {
  test("the first reading writes the open connections and no rate; a minute later, the rates", async () => {
    const first: RecordedServiceCollection = await collect(
      loadScene(GROUP, "baseline"),
    );

    expect(
      pointsNamed(
        first.points,
        "openstack_loadbalancer_stats_active_connections",
      ),
    ).toHaveLength(3);
    for (const metric of [
      "openstack_loadbalancer_stats_connections_per_second",
      "openstack_loadbalancer_stats_bytes_in_per_second",
      "openstack_loadbalancer_stats_bytes_out_per_second",
      "openstack_loadbalancer_stats_request_errors_per_second",
      "openstack_loadbalancer_listener_stats_connections_per_second",
    ]) {
      expect(pointsNamed(first.points, metric)).toEqual([]);
    }

    // A probe reads a service like this every five minutes, as the agent's job does.
    first.harness.clock.advance(5 * 60_000);
    const later: RecordedScene = loadScene(GROUP, "baseline-one-minute-later");
    const second: RecordedServiceCollection = await collectFromRecordedService({
      harness: first.harness,
      catalog: CATALOG,
      answer: answerFrom(later),
    });

    const rate: ReportedDatapoint | undefined = pointsNamed(
      second.points,
      "openstack_loadbalancer_stats_connections_per_second",
    ).find((point: ReportedDatapoint): boolean => {
      return point.labels["name"] === "ou-lb";
    });
    // Recorded: total_connections went from 46 to 264 between the two scenes. They were a minute apart on the rig; here the clock is moved the five minutes a probe waits, so the rate is the same difference over that.
    expect(rate?.value).toBeCloseTo((264 - 46) / 300, 5);
    const errors: ReportedDatapoint | undefined = pointsNamed(
      second.points,
      "openstack_loadbalancer_stats_request_errors_per_second",
    ).find((point: ReportedDatapoint): boolean => {
      return point.labels["name"] === "ou-lb";
    });
    expect(errors?.value).toBeCloseTo((132 - 23) / 300, 5);
    expect(
      pointsNamed(
        second.points,
        "openstack_loadbalancer_listener_stats_connections_per_second",
      ).length,
    ).toBe(1);
    // The OVN provider reports 0 for everything, which is a rate of 0 and no fault.
    expect(
      pointsNamed(
        second.points,
        "openstack_loadbalancer_stats_bytes_in_per_second",
      ).find((point: ReportedDatapoint): boolean => {
        return point.labels["name"] === "ou-lb-ovn";
      })?.value,
    ).toBe(0);
  });
});

describe("rates, on awkward counters", () => {
  const counters = (
    total: number,
  ): {
    activeConnections: number;
    totalConnections: number;
    bytesIn: number;
    bytesOut: number;
    requestErrors: number;
  } => {
    return {
      activeConnections: 1,
      totalConnections: total,
      bytesIn: total * 10,
      bytesOut: total * 20,
      requestErrors: total / 10,
    };
  };

  test.each([
    ["10 seconds apart", 10_000, 100, 200, 10],
    ["a counter that went down: a listener rebuilt", 10_000, 500, 20, null],
    ["a counter that stayed", 10_000, 100, 100, 0],
    ["a minute and a half", 90_000, 0, 90, 1],
  ])(
    "%s",
    (
      _name: string,
      gap: number,
      before: number,
      now: number,
      expected: number | null,
    ) => {
      const rates: ReturnType<typeof getOctaviaRates> = getOctaviaRates({
        scope: "listener",
        id: "l",
        name: "l",
        loadBalancerId: "lb",
        now: { readAt: 1_000_000 + gap, stats: counters(now) },
        before: { readAt: 1_000_000, stats: counters(before) },
      });
      expect(rates.connectionsPerSecond).toBe(expected);
      expect(rates.activeConnections).toBe(1);
    },
  );

  test("a reading older than the memory is not compared with, and nor is the same instant", () => {
    for (const gap of [OCTAVIA_STATS_REMEMBERED_FOR_IN_MS + 1, 0]) {
      expect(
        getOctaviaRates({
          scope: "loadbalancer",
          id: "lb",
          name: "lb",
          loadBalancerId: "lb",
          now: { readAt: 1_000_000 + gap, stats: counters(200) },
          before: { readAt: 1_000_000, stats: counters(100) },
        }).connectionsPerSecond,
      ).toBeNull();
    }
  });

  test("counters Octavia leaves out are not rates", () => {
    const rates: ReturnType<typeof getOctaviaRates> = getOctaviaRates({
      scope: "loadbalancer",
      id: "lb",
      name: "lb",
      loadBalancerId: "lb",
      now: {
        readAt: 20_000,
        stats: {
          activeConnections: null,
          totalConnections: null,
          bytesIn: 5,
          bytesOut: null,
          requestErrors: null,
        },
      },
      before: { readAt: 10_000, stats: counters(1) },
    });
    expect(rates.activeConnections).toBeNull();
    expect(rates.connectionsPerSecond).toBeNull();
    expect(rates.bytesInPerSecond).toBeNull();
  });
});

describe("a credential Octavia refuses some of", () => {
  test("amphorae, members and counters refused say nothing and raise no alarm", async () => {
    const scene: RecordedScene = loadScene(GROUP, "baseline");
    const { report, points } = await collect(
      scene,
      (path: string): RecordedAnswer | undefined => {
        return path.endsWith("/amphorae") ||
          path.endsWith("/members") ||
          path.endsWith("/stats")
          ? { status: 403, body: '{"faultstring": "Policy does not allow"}' }
          : undefined;
      },
    );

    expect(
      pointsNamed(points, "openstack_loadbalancer_amphora_status"),
    ).toEqual([]);
    expect(pointsNamed(points, "openstack_loadbalancer_member_status")).toEqual(
      [],
    );
    expect(
      pointsNamed(points, "openstack_loadbalancer_stats_active_connections"),
    ).toEqual([]);
    expect(
      pointsNamed(points, "openstack_loadbalancer_loadbalancer_status"),
    ).toHaveLength(3);
    expect(pointsNamed(points, "openstack_loadbalancer_up")[0]?.value).toBe(1);
    expect(
      (report.summary?.warnings || []).filter((warning: string): boolean => {
        return warning.includes("Octavia");
      }),
    ).toEqual([]);
  });

  test("a project's reader sees its own load balancers only, and that is a 200", async () => {
    const scene: RecordedScene = loadScene(GROUP, "baseline");
    const { points } = await collect(
      scene,
      (path: string): RecordedAnswer | undefined => {
        return path === `${PREFIX}/lbaas/loadbalancers`
          ? { status: 200, body: JSON.stringify({ loadbalancers: [] }) }
          : undefined;
      },
    );

    expect(
      pointsNamed(points, "openstack_loadbalancer_total_loadbalancers")[0]
        ?.value,
    ).toBe(0);
    expect(pointsNamed(points, "openstack_loadbalancer_up")[0]?.value).toBe(1);
  });
});

describe("a cloud without Octavia", () => {
  test("is asked nothing about it, and sends nothing that could make a row", async () => {
    const { report, requests } = await collectFromRecordedService({
      catalog: [],
      answer: (): RecordedAnswer | undefined => {
        return undefined;
      },
    });

    expect(octaviaRequests(requests)).toEqual([]);
    expect(
      requests.filter((request: RecordedRequest): boolean => {
        return request.path.includes("lbaas");
      }),
    ).toEqual([]);
    expect(
      rowsOfReport(report).rows.filter(
        (row: OpenStackResourceBufferEntry): boolean => {
          return (
            row.kind === OpenStackResourceKind.LoadBalancer ||
            row.name === OpenStackServiceType.LoadBalancer
          );
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
      answer: answerFrom(scene),
    });
  }

  test("a cloud without Octavia hears nothing of it", async () => {
    const reads: Array<OpenStackAccessRead> = await readsOf([]);

    expect(reads.length).toBeGreaterThan(0);
    expect(
      reads.filter((read: OpenStackAccessRead): boolean => {
        return read.service === OpenStackServiceType.LoadBalancer;
      }),
    ).toEqual([]);
  });

  test("one with it is asked, and an admin reads every project's load balancers and the amphorae", async () => {
    const reads: Array<OpenStackAccessRead> = (await readsOf(CATALOG)).filter(
      (read: OpenStackAccessRead): boolean => {
        return read.service === OpenStackServiceType.LoadBalancer;
      },
    );

    expect(
      reads.map((read: OpenStackAccessRead): [string, string] => {
        return [read.read, read.access];
      }),
    ).toEqual([
      ["load balancers", "ReadsEverything"],
      ["amphorae", "ReadsEverything"],
    ]);
  });
});
