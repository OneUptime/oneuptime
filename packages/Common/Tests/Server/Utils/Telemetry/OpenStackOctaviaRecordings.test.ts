import OpenStackResource from "../../../../Models/DatabaseModels/OpenStackResource";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  OPENSTACK_AMPHORA_CERTIFICATE_WARNING_DAYS,
  OPENSTACK_LOAD_BALANCER_STUCK_MINUTES,
  getOpenStackAmphoraCertificateDaysLeft,
  getOpenStackLoadBalancersWithTwoMasters,
  isOpenStackAmphoraCertificateExpiring,
  isOpenStackAmphoraInError,
  isOpenStackLoadBalancerInError,
  isOpenStackLoadBalancerStuck,
  isOpenStackPoolWithoutHealthyMembers,
} from "../../../../Types/OpenStack/OpenStackHealthRules";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "../../../../Types/OpenStack/OpenStackResourceKind";
import {
  RECORDED_AT,
  RecordedServiceScene,
  factsOfRow,
  namesOfRows,
  scanRecordedOtlp,
} from "../../../Helpers/OpenStackServiceRecording";
import {
  OpenStackTemplateReading,
  isAnythingFiring,
  readOpenStackTemplateOnRecording,
} from "../../../Types/Monitor/Utils/OpenStackTemplateOnRecording";
import {
  assessOpenStackResource,
  getOpenStackAttentionItems,
  getOpenStackHealth,
} from "../../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackHealth";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";

/*
 * OCTAVIA, ON WHAT A REAL CLOUD SAID.
 *
 * Tests/Ops/openstack-e2e/services-octavia.sh ran Octavia on a real stable/2026.1 DevStack with real
 * amphorae under KVM and recorded what the agent's exporter answered in each of 13 scenes
 * (Tests/Fixtures/OpenStack/services-octavia). Ten of them are what Octavia did on its own. Three are
 * written into the rows, because nothing on a runner gets there by itself: an amphora near the end of
 * its certificate, two masters, and an amphora in ERROR. Each of those says so in its how.txt, and so
 * does the describe of it below.
 */

const GROUP: string = "services-octavia";
const DAY_MS: number = 24 * 60 * 60 * 1000;

const SCENES: Array<string> = [
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

function scene(name: string): RecordedServiceScene {
  return new RecordedServiceScene({ group: GROUP, scene: name });
}

function loadBalancers(
  recorded: RecordedServiceScene,
): Array<OpenStackResource> {
  return recorded.ofKind(OpenStackResourceKind.LoadBalancer);
}

function pools(recorded: RecordedServiceScene): Array<OpenStackResource> {
  return recorded.ofKind(OpenStackResourceKind.LoadBalancerPool);
}

function amphorae(recorded: RecordedServiceScene): Array<OpenStackResource> {
  return recorded.ofKind(OpenStackResourceKind.Amphora);
}

function minutesAfter(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * 60000);
}

function daysAfter(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

function itemsOf(
  recorded: RecordedServiceScene,
  now: Date = RECORDED_AT,
): Array<ResourceAttentionItem> {
  return getOpenStackAttentionItems({ rows: recorded.rows, now });
}

function namesOf(items: ReadonlyArray<ResourceAttentionItem>): Array<string> {
  return items
    .map((item: ResourceAttentionItem): string => {
      return item.name;
    })
    .sort();
}

function roleFacts(rows: Array<OpenStackResource>): Array<{
  status?: string | undefined;
  loadBalancerId?: string | undefined;
  role?: string | undefined;
}> {
  return rows.map((row: OpenStackResource) => {
    return {
      status: row.status,
      loadBalancerId: factsOfRow(row)["loadBalancerId"] as string,
      role: factsOfRow(row)["role"] as string,
    };
  });
}

async function firedBy(
  templateId: string,
  recorded: RecordedServiceScene,
  groupKey: string = "name",
): Promise<Array<string>> {
  const readings: Array<OpenStackTemplateReading> =
    await readOpenStackTemplateOnRecording({
      templateId,
      series: recorded.series,
    });
  return readings
    .filter((reading: OpenStackTemplateReading): boolean => {
      return reading.breached;
    })
    .map((reading: OpenStackTemplateReading): string => {
      return reading.group[groupKey] || JSON.stringify(reading.group);
    })
    .sort();
}

const LB: Record<string, string> = {
  plain: "27c8eb38-e43d-4f03-82b9-e6f4e714fa38",
  pair: "3ababc03-93f7-4b7f-90be-3aec0b457dc6",
  ovn: "fd511df0-8732-465f-a86c-c5ed171bd45a",
  failed: "c5b33ea0-43bb-4f9e-823e-10a848867f50",
  pending: "5398256a-4f6b-4a6d-8b72-ca585866db19",
};

describe("every scene with Octavia answering", () => {
  test.each(SCENES)(
    "%s: the rows are exactly what the exporter counted",
    (name: string) => {
      const recorded: RecordedServiceScene = scene(name);

      expect(loadBalancers(recorded)).toHaveLength(
        recorded.seriesNamed("openstack_loadbalancer_total_loadbalancers")[0]!
          .value,
      );
      expect(pools(recorded)).toHaveLength(
        recorded.seriesNamed("openstack_loadbalancer_total_pools")[0]!.value,
      );
      expect(amphorae(recorded)).toHaveLength(
        recorded.seriesNamed("openstack_loadbalancer_total_amphorae")[0]!.value,
      );
      expect(recorded.seriesNamed("openstack_loadbalancer_up")[0]!.value).toBe(
        1,
      );
    },
  );

  test.each(SCENES)(
    "%s: one row per thing, and none without an id",
    (name: string) => {
      const recorded: RecordedServiceScene = scene(name);
      const ids: Array<string> = [
        ...loadBalancers(recorded),
        ...pools(recorded),
        ...amphorae(recorded),
      ].map((row: OpenStackResource): string => {
        return row.externalId as string;
      });

      expect(ids.every(Boolean)).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );

  test.each(SCENES)(
    "%s: the Octavia API reads up, and nothing else of Octavia's is a row",
    (name: string) => {
      const recorded: RecordedServiceScene = scene(name);

      expect(recorded.api(OpenStackServiceType.LoadBalancer)?.status).toBe(
        "up",
      );
      // The scene holds Nova's too, from the same recording, and Octavia's three kinds are the rest.
      const octavia: Array<string | undefined> = recorded.rows
        .filter((row: OpenStackResource): boolean => {
          return (
            row.kind === OpenStackResourceKind.LoadBalancer ||
            row.kind === OpenStackResourceKind.LoadBalancerPool ||
            row.kind === OpenStackResourceKind.Amphora
          );
        })
        .map((row: OpenStackResource): string | undefined => {
          return row.kind;
        });
      expect(new Set(octavia).size).toBe(3);
    },
  );

  test("the exporter has no series for listeners, members or traffic, so there are no rows for them", () => {
    for (const name of SCENES) {
      for (const series of scene(name).series.filter(
        (one: { name: string }): boolean => {
          return one.name.startsWith("openstack_loadbalancer_");
        },
      )) {
        expect(series.name).toMatch(
          /^openstack_loadbalancer_(up|total_loadbalancers|total_pools|total_amphorae|loadbalancer_status|pool_status|amphora_status)$/,
        );
      }
    }
  });
});

describe("api-down: Octavia's API stopped", () => {
  const recorded: RecordedServiceScene = scene("api-down");

  test("the exporter says nothing of it, not even an `up` of 0", () => {
    expect(recorded.series).toEqual([]);
    expect(recorded.rows).toEqual([]);
  });

  test("so Load Balancers API Down has nothing to read on an agent's cloud, and does not fire", async () => {
    expect(
      isAnythingFiring(
        await readOpenStackTemplateOnRecording({
          templateId: "openstack-load-balancer-api-down",
          series: recorded.series,
        }),
      ),
    ).toBe(false);
  });
});

describe("baseline: a plain load balancer, an active-standby pair and an OVN one", () => {
  const recorded: RecordedServiceScene = scene("baseline");

  test("a load balancer reads as Octavia said it, whose it is included", () => {
    const row: OpenStackResource = recorded.named(
      OpenStackResourceKind.LoadBalancer,
      "ou-lb",
    );

    expect(row.externalId).toBe(LB["plain"]);
    expect(row.status).toBe("ACTIVE");
    expect(row.regionName).toBe("RegionOne");
    expect(row.openStackProjectId).toBe("1e59c0ba8e5c4bce9ce2fe412624b16a");
    expect(factsOfRow(row)).toMatchObject({
      operatingStatus: "ONLINE",
      provider: "amphora",
      vipAddress: "10.77.0.124",
    });
  });

  test("the same ids, projects and addresses the API says, which is where the exporter got them", () => {
    const answer: JSONObject = recorded.readApi("octavia-loadbalancers");

    for (const item of answer["loadbalancers"] as JSONArray) {
      const said: JSONObject = item as JSONObject;
      const row: OpenStackResource = recorded.named(
        OpenStackResourceKind.LoadBalancer,
        said["name"] as string,
      );

      expect(row.externalId).toBe(said["id"]);
      expect(row.openStackProjectId).toBe(said["project_id"]);
      expect(factsOfRow(row)["vipAddress"]).toBe(said["vip_address"]);
      expect(factsOfRow(row)["provider"]).toBe(said["provider"]);
      expect(row.status).toBe(said["provisioning_status"]);
    }
  });

  test("a pool says which load balancer it is behind, and both of its statuses", () => {
    const pool: OpenStackResource = recorded.named(
      OpenStackResourceKind.LoadBalancerPool,
      "ou-lb-pool",
    );

    expect(pool.status).toBe("ACTIVE");
    expect(factsOfRow(pool)).toMatchObject({
      operatingStatus: "ONLINE",
      protocol: "HTTP",
      algorithm: "ROUND_ROBIN",
      loadBalancerIds: [LB["plain"]],
    });
  });

  test("an amphora has no name or project, and says its role", () => {
    const rows: Array<OpenStackResource> = amphorae(recorded);

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.name).toBeUndefined();
      expect(row.status).toBe("ALLOCATED");
    }
    expect(
      rows
        .map((row: OpenStackResource): unknown => {
          return factsOfRow(row)["role"];
        })
        .sort(),
    ).toEqual(["BACKUP", "MASTER", "STANDALONE"]);
  });

  test("an amphora's instance is the one the API says, and its certificate ends exactly 30 days after it was built", () => {
    const answer: JSONObject = recorded.readApi("octavia-amphorae");

    for (const item of answer["amphorae"] as JSONArray) {
      const said: JSONObject = item as JSONObject;
      const row: OpenStackResource | undefined = amphorae(recorded).find(
        (candidate: OpenStackResource): boolean => {
          return candidate.externalId === said["id"];
        },
      );

      expect(factsOfRow(row!)["computeId"]).toBe(said["compute_id"]);
      expect(factsOfRow(row!)["loadBalancerId"]).toBe(said["loadbalancer_id"]);
      // Why a line at 30 days would fire on every amphora for its whole life. Both are UTC, with no zone.
      const built: number = Date.parse(`${said["created_at"] as string}Z`);
      const ends: number = Date.parse(`${said["cert_expiration"] as string}Z`);
      expect(Math.abs(ends - built - 30 * DAY_MS)).toBeLessThan(60 * 1000);
    }
  });

  test("a certificate is read as the text the exporter sends, a moment of UTC", () => {
    for (const row of amphorae(recorded)) {
      expect(factsOfRow(row)["certExpiresAt"]).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
      );
    }
  });

  test("the value of a status series is a code, so it is the words that are read", () => {
    const series: Array<{ value: number }> = recorded.seriesNamed(
      "openstack_loadbalancer_loadbalancer_status",
    );

    expect(
      series.every((one: { value: number }): boolean => {
        return one.value === 0;
      }),
    ).toBe(true);
  });

  test("needs nobody", () => {
    expect(itemsOf(recorded)).toEqual([]);
    expect(getOpenStackHealth(itemsOf(recorded))).toBe("Healthy");
  });

  test("a minute later says the same", () => {
    const later: RecordedServiceScene = scene("baseline-one-minute-later");

    expect(namesOfRows(loadBalancers(later))).toEqual(
      namesOfRows(loadBalancers(recorded)),
    );
    expect(itemsOf(later)).toEqual([]);
  });

  test.each([
    "openstack-load-balancer-in-error",
    "openstack-load-balancer-stuck-pending",
    "openstack-load-balancer-with-two-masters",
    "openstack-amphora-in-error",
    "openstack-pool-without-healthy-members",
  ])("%s has nothing to fire on", async (id: string) => {
    expect(
      isAnythingFiring(
        await readOpenStackTemplateOnRecording({
          templateId: id,
          series: recorded.series,
        }),
      ),
    ).toBe(false);
  });
});

describe("active-standby: a pair of amphorae, one MASTER and one BACKUP", () => {
  const recorded: RecordedServiceScene = scene("active-standby");

  test("is one master, which is how it should be", () => {
    const pair: Array<OpenStackResource> = amphorae(recorded).filter(
      (row: OpenStackResource): boolean => {
        return factsOfRow(row)["loadBalancerId"] === LB["pair"];
      },
    );

    expect(
      pair
        .map((row: OpenStackResource): unknown => {
          return factsOfRow(row)["role"];
        })
        .sort(),
    ).toEqual(["BACKUP", "MASTER"]);
    expect(
      getOpenStackLoadBalancersWithTwoMasters(roleFacts(amphorae(recorded))),
    ).toEqual([]);
    expect(itemsOf(recorded)).toEqual([]);
  });
});

describe("ovn-provider: a load balancer with no amphora at all", () => {
  const recorded: RecordedServiceScene = scene("ovn-provider");

  test("is a load balancer like another, and needs nobody for having no amphora", () => {
    const row: OpenStackResource = recorded.named(
      OpenStackResourceKind.LoadBalancer,
      "ou-lb-ovn",
    );

    expect(factsOfRow(row)["provider"]).toBe("ovn");
    expect(
      amphorae(recorded).filter((amphora: OpenStackResource): boolean => {
        return factsOfRow(amphora)["loadBalancerId"] === row.externalId;
      }),
    ).toEqual([]);
    expect(itemsOf(recorded)).toEqual([]);
  });
});

describe("lb-error: Nova refused the amphora, and the load balancer went to ERROR by itself", () => {
  const recorded: RecordedServiceScene = scene("lb-error");
  const row: OpenStackResource = recorded.named(
    OpenStackResourceKind.LoadBalancer,
    "ou-lb-failed",
  );

  test("reads ERROR in provisioning and OFFLINE in operating, as Octavia said", () => {
    expect(row.externalId).toBe(LB["failed"]);
    expect(row.status).toBe("ERROR");
    expect(factsOfRow(row)["operatingStatus"]).toBe("OFFLINE");
    expect(isOpenStackLoadBalancerInError(row.status)).toBe(true);
  });

  test("its series reads 2, for OFFLINE, so only the words say it is in error", () => {
    const series: { value: number } | undefined = recorded
      .seriesNamed("openstack_loadbalancer_loadbalancer_status")
      .find((one: { labels: Record<string, string> }): boolean => {
        return one.labels["name"] === "ou-lb-failed";
      });

    expect(series?.value).toBe(2);
  });

  test("reaches Needs attention by name, critical, and nothing else does", () => {
    const items: Array<ResourceAttentionItem> = itemsOf(recorded);

    expect(namesOf(items)).toEqual(["ou-lb-failed"]);
    expect(items[0]?.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(items[0]?.reasons[0]?.values).toEqual({ status: "ERROR" });
    expect(getOpenStackHealth(items)).not.toBe("Healthy");
  });

  test("however long ago it happened, because Octavia retries none of these", () => {
    expect(
      assessOpenStackResource({ row, now: daysAfter(RECORDED_AT, 90) })
        .severity,
    ).toBe(ResourceAttentionSeverity.Critical);
  });

  test("Load Balancer in Error fires on it, and on nothing else in the scene", async () => {
    expect(await firedBy("openstack-load-balancer-in-error", recorded)).toEqual(
      ["ou-lb-failed"],
    );
  });

  test("and the pending one does not read it", async () => {
    expect(
      isAnythingFiring(
        await readOpenStackTemplateOnRecording({
          templateId: "openstack-load-balancer-stuck-pending",
          series: recorded.series,
        }),
      ),
    ).toBe(false);
  });

  test("recovers when the load balancer is deleted, which is its series going away", async () => {
    expect(
      isAnythingFiring(
        await readOpenStackTemplateOnRecording({
          templateId: "openstack-load-balancer-in-error",
          series: recorded.series.filter(
            (series: { labels: Record<string, string> }): boolean => {
              return series.labels["name"] !== "ou-lb-failed";
            },
          ),
        }),
      ),
    ).toBe(false);
  });

  test("and it stays a row through every scene after it, until someone deals with it", async () => {
    for (const name of ["amphora-near-expiry", "two-masters", "recovered"]) {
      expect(
        await firedBy("openstack-load-balancer-in-error", scene(name)),
      ).toEqual(["ou-lb-failed"]);
    }
  });
});

describe("pending-update and pending-create: Octavia's worker was stopped", () => {
  test("a change it never did leaves the load balancer PENDING_UPDATE", () => {
    const row: OpenStackResource = scene("pending-update").named(
      OpenStackResourceKind.LoadBalancer,
      "ou-lb",
    );

    expect(row.status).toBe("PENDING_UPDATE");
    expect(factsOfRow(row)["operatingStatus"]).toBe("ONLINE");
  });

  test("a load balancer it never built reads PENDING_CREATE, and OFFLINE", () => {
    const row: OpenStackResource = scene("pending-create").named(
      OpenStackResourceKind.LoadBalancer,
      "ou-lb-pending",
    );

    expect(row.externalId).toBe(LB["pending"]);
    expect(row.status).toBe("PENDING_CREATE");
    expect(factsOfRow(row)["operatingStatus"]).toBe("OFFLINE");
  });

  test.each([
    ["pending-update", "ou-lb"],
    ["pending-create", "ou-lb-pending"],
  ])(
    "%s: is nothing for an hour, because Octavia is allowed that, and stuck after it",
    (name: string, loadBalancer: string) => {
      const recorded: RecordedServiceScene = scene(name);
      const row: OpenStackResource = recorded.named(
        OpenStackResourceKind.LoadBalancer,
        loadBalancer,
      );

      // The API's own row ages with the clock this test moves, and is not what is being asked.
      expect(
        namesOf(
          itemsOf(recorded, minutesAfter(RECORDED_AT, 30)).filter(
            (item: ResourceAttentionItem): boolean => {
              return item.kind !== "API";
            },
          ),
        ),
      ).toEqual([]);
      expect(
        isOpenStackLoadBalancerStuck({
          status: row.status,
          stateChangedAt: row.stateChangedAt,
          now: minutesAfter(
            RECORDED_AT,
            OPENSTACK_LOAD_BALANCER_STUCK_MINUTES - 1,
          ),
        }),
      ).toBe(false);

      const items: Array<ResourceAttentionItem> = itemsOf(
        recorded,
        minutesAfter(RECORDED_AT, OPENSTACK_LOAD_BALANCER_STUCK_MINUTES),
      );
      expect(namesOf(items)).toContain(loadBalancer);
      expect(
        items.find((item: ResourceAttentionItem): boolean => {
          return item.name === loadBalancer;
        })?.severity,
      ).toBe(ResourceAttentionSeverity.Warning);
    },
  );

  test("Load Balancer Stuck Pending reads a PENDING status of any of the three words", async () => {
    expect(
      await firedBy(
        "openstack-load-balancer-stuck-pending",
        scene("pending-update"),
      ),
    ).toEqual(["ou-lb"]);
    expect(
      await firedBy(
        "openstack-load-balancer-stuck-pending",
        scene("pending-create"),
      ),
    ).toEqual(["ou-lb", "ou-lb-pending"]);
  });

  test("and Load Balancer in Error does not read a pending one", async () => {
    expect(
      isAnythingFiring(
        await readOpenStackTemplateOnRecording({
          templateId: "openstack-load-balancer-in-error",
          series: scene("pending-create").series,
        }),
      ),
    ).toBe(false);
  });
});

describe("pool-members-down: every member fails its health monitor, and nothing is wrong in provisioning", () => {
  const recorded: RecordedServiceScene = scene("pool-members-down");

  test("the pool and its load balancer provision ACTIVE, and are ERROR in operating", () => {
    for (const name of ["ou-lb-pool", "ou-lb-ha-pool"]) {
      const pool: OpenStackResource = recorded.named(
        OpenStackResourceKind.LoadBalancerPool,
        name,
      );

      expect(pool.status).toBe("ACTIVE");
      expect(factsOfRow(pool)["operatingStatus"]).toBe("ERROR");
    }
    const balancer: OpenStackResource = recorded.named(
      OpenStackResourceKind.LoadBalancer,
      "ou-lb",
    );
    expect(balancer.status).toBe("ACTIVE");
    expect(factsOfRow(balancer)["operatingStatus"]).toBe("ERROR");
  });

  test("the pool's series reads 0, as a healthy one does, which is why a template can't read the value", () => {
    const series: { value: number } | undefined = recorded
      .seriesNamed("openstack_loadbalancer_pool_status")
      .find((one: { labels: Record<string, string> }): boolean => {
        return one.labels["name"] === "ou-lb-pool";
      });

    expect(series?.value).toBe(0);
  });

  test("the pools reach Needs attention by name, critical, and the OVN pool, which is fine, does not", () => {
    const items: Array<ResourceAttentionItem> = itemsOf(recorded);

    expect(namesOf(items)).toEqual(["ou-lb-ha-pool", "ou-lb-pool"]);
    for (const item of items) {
      expect(item.severity).toBe(ResourceAttentionSeverity.Critical);
    }
  });

  test("Pool Has No Healthy Members fires on those two and not on the pool that is fine", async () => {
    expect(
      await firedBy("openstack-pool-without-healthy-members", recorded),
    ).toEqual(["ou-lb-ha-pool", "ou-lb-pool"]);
  });

  test("and Load Balancer in Error does not, because it is not in error in provisioning", async () => {
    expect(
      isAnythingFiring(
        await readOpenStackTemplateOnRecording({
          templateId: "openstack-load-balancer-in-error",
          series: recorded.series,
        }),
      ),
    ).toBe(false);
  });

  test("a pool with only some members down is DEGRADED, and nothing pages for it", () => {
    expect(isOpenStackPoolWithoutHealthyMembers("ERROR")).toBe(true);
    expect(isOpenStackPoolWithoutHealthyMembers("DEGRADED")).toBe(false);
    expect(isOpenStackPoolWithoutHealthyMembers("NO_MONITOR")).toBe(false);
    expect(isOpenStackPoolWithoutHealthyMembers("OFFLINE")).toBe(false);
    expect(isOpenStackPoolWithoutHealthyMembers(undefined)).toBe(false);
  });
});

describe("two-masters: what a split pair reads as, written into its rows", () => {
  const recorded: RecordedServiceScene = scene("two-masters");

  test("both amphorae of the pair say MASTER", () => {
    const masters: Array<OpenStackResource> = amphorae(recorded).filter(
      (row: OpenStackResource): boolean => {
        return (
          factsOfRow(row)["loadBalancerId"] === LB["pair"] &&
          factsOfRow(row)["role"] === "MASTER"
        );
      },
    );

    expect(masters).toHaveLength(2);
    expect(
      getOpenStackLoadBalancersWithTwoMasters(roleFacts(amphorae(recorded))),
    ).toEqual([LB["pair"]]);
  });

  test("Load Balancer With Two Masters fires on that load balancer, by its id, and no other", async () => {
    expect(
      await firedBy(
        "openstack-load-balancer-with-two-masters",
        recorded,
        "loadbalancer_id",
      ),
    ).toEqual([LB["pair"]]);
  });

  test("the load balancer reaches Needs attention when the server has counted its masters", () => {
    const stamped: Array<OpenStackResource> = recorded.rows.map(
      (row: OpenStackResource): OpenStackResource => {
        if (row.externalId === LB["pair"]) {
          row.facts = { ...(row.facts as JSONObject), masterAmphoraCount: 2 };
        }
        return row;
      },
    );
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: stamped,
      now: RECORDED_AT,
    });

    expect(namesOf(items)).toContain("ou-lb-ha");
    expect(
      items.find((item: ResourceAttentionItem): boolean => {
        return item.name === "ou-lb-ha";
      })?.severity,
    ).toBe(ResourceAttentionSeverity.Critical);
  });

  test("and a load balancer whose masters nobody counted is not guessed at", () => {
    expect(namesOf(itemsOf(scene("two-masters")))).not.toContain("ou-lb-ha");
  });

  test.each([
    [[{ status: "ALLOCATED", loadBalancerId: "a", role: "MASTER" }], []],
    [
      [
        { status: "ALLOCATED", loadBalancerId: "a", role: "MASTER" },
        { status: "ERROR", loadBalancerId: "a", role: "MASTER" },
      ],
      [],
    ],
    [
      [
        { status: "ALLOCATED", loadBalancerId: "a", role: "MASTER" },
        { status: "BOOTING", loadBalancerId: "a", role: "MASTER" },
      ],
      [],
    ],
    [
      [
        { status: "ALLOCATED", loadBalancerId: "a", role: "STANDALONE" },
        { status: "ALLOCATED", loadBalancerId: "a", role: "STANDALONE" },
      ],
      [],
    ],
    [
      [
        { status: "ALLOCATED", loadBalancerId: null, role: "MASTER" },
        { status: "ALLOCATED", loadBalancerId: null, role: "MASTER" },
      ],
      [],
    ],
    [
      [
        { status: "ALLOCATED", loadBalancerId: "a", role: "MASTER" },
        { status: "ALLOCATED", loadBalancerId: "b", role: "MASTER" },
        { status: "ALLOCATED", loadBalancerId: "a", role: "MASTER" },
        { status: "ALLOCATED", loadBalancerId: "b", role: "BACKUP" },
      ],
      ["a"],
    ],
  ])(
    "two masters, awkward rows %#: an amphora being replaced, a spare, a standalone",
    (
      rows: Array<{
        status: string;
        loadBalancerId: string | null;
        role: string;
      }>,
      expected: Array<string>,
    ) => {
      expect(getOpenStackLoadBalancersWithTwoMasters(rows)).toEqual(expected);
    },
  );
});

describe("amphora-error: what an amphora the health manager could not replace reads as, written into its row", () => {
  const recorded: RecordedServiceScene = scene("amphora-error");
  const row: OpenStackResource = amphorae(recorded).find(
    (amphora: OpenStackResource): boolean => {
      return amphora.status === "ERROR";
    },
  )!;

  test("is the BACKUP of the pair, and its status series reads 6", () => {
    expect(factsOfRow(row)["role"]).toBe("BACKUP");
    expect(isOpenStackAmphoraInError(row.status)).toBe(true);
    expect(
      recorded
        .seriesNamed("openstack_loadbalancer_amphora_status")
        .find((one: { labels: Record<string, string> }): boolean => {
          return one.labels["id"] === row.externalId;
        })?.value,
    ).toBe(6);
  });

  test("reaches Needs attention by its id, since an amphora has no name, with its role beside it", () => {
    const found: ResourceAttentionItem | undefined = itemsOf(recorded).find(
      (item: ResourceAttentionItem): boolean => {
        return item.name === row.externalId;
      },
    );

    expect(found?.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(found?.detail).toContain("BACKUP");
  });

  test("Amphora in Error fires on it only", async () => {
    expect(await firedBy("openstack-amphora-in-error", recorded, "id")).toEqual(
      [row.externalId],
    );
  });
});

describe("amphora-near-expiry: a certificate three weeks from its end, written into its row", () => {
  const recorded: RecordedServiceScene = scene("amphora-near-expiry");
  const row: OpenStackResource = amphorae(recorded).find(
    (amphora: OpenStackResource): boolean => {
      return factsOfRow(amphora)["certExpiresAt"] === "2026-11-26T06:06:07Z";
    },
  )!;

  test("has about 21 days left at the recording: past the 14 day line, where a line at 30 would have fired on every amphora", () => {
    const days: number = getOpenStackAmphoraCertificateDaysLeft({
      certExpiresAt: factsOfRow(row)["certExpiresAt"] as string,
      now: RECORDED_AT,
    })!;

    expect(days).toBeGreaterThan(21);
    expect(days).toBeLessThan(22);
    expect(days).toBeGreaterThan(OPENSTACK_AMPHORA_CERTIFICATE_WARNING_DAYS);
    // Only the load balancer that failed in an earlier scene needs anyone.
    expect(namesOf(itemsOf(recorded))).toEqual(["ou-lb-failed"]);
  });

  test("reaches Needs attention by its id the day it is under 14 days away, as a warning", () => {
    const found: ResourceAttentionItem | undefined = itemsOf(
      recorded,
      daysAfter(RECORDED_AT, 21.2 - 13.9),
    ).find((item: ResourceAttentionItem): boolean => {
      return item.name === row.externalId;
    });

    expect(found?.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(found?.reasons[0]?.values).toEqual({ days: "13" });
  });

  test("and critical once it has ended, saying for how long", () => {
    const found: ResourceAttentionItem | undefined = itemsOf(
      recorded,
      daysAfter(RECORDED_AT, 24),
    ).find((item: ResourceAttentionItem): boolean => {
      return item.name === row.externalId;
    });

    expect(found?.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(found?.reasons[0]?.values).toEqual({ days: "3" });
  });

  test("the other certificates, 30 days from when they were built, are fine until their own last two weeks", () => {
    const other: string | undefined = amphorae(recorded).find(
      (amphora: OpenStackResource): boolean => {
        return factsOfRow(amphora)["certExpiresAt"] === "2026-12-05T05:52:05Z";
      },
    )?.externalId;

    expect(
      namesOf(itemsOf(recorded, daysAfter(RECORDED_AT, 15))),
    ).not.toContain(other);
    expect(namesOf(itemsOf(recorded, daysAfter(RECORDED_AT, 22)))).toContain(
      other,
    );
  });

  test("a spare amphora waiting in the pool has a certificate too, and one that is gone has none to mind", () => {
    expect(
      isOpenStackAmphoraCertificateExpiring({
        status: "READY",
        certExpiresAt: "2026-11-06T00:00:00Z",
        now: RECORDED_AT,
      }),
    ).toBe(true);
    for (const status of ["DELETED", "PENDING_DELETE"]) {
      expect(
        isOpenStackAmphoraCertificateExpiring({
          status,
          certExpiresAt: "2026-11-06T00:00:00Z",
          now: RECORDED_AT,
        }),
      ).toBe(false);
    }
  });

  test.each([undefined, null, "", "soon", "2026-13-45T99:99:99Z"])(
    "a certificate date of %p says nothing, rather than throwing",
    (certExpiresAt: string | null | undefined) => {
      expect(
        getOpenStackAmphoraCertificateDaysLeft({
          certExpiresAt,
          now: RECORDED_AT,
        }),
      ).toBeNull();
      expect(
        isOpenStackAmphoraCertificateExpiring({
          status: "ALLOCATED",
          certExpiresAt,
          now: RECORDED_AT,
        }),
      ).toBe(false);
    },
  );

  test("at exactly the line it is not yet, and a second under it is", () => {
    const line: number = OPENSTACK_AMPHORA_CERTIFICATE_WARNING_DAYS * DAY_MS;

    expect(
      isOpenStackAmphoraCertificateExpiring({
        status: "ALLOCATED",
        certExpiresAt: new Date(RECORDED_AT.getTime() + line).toISOString(),
        now: RECORDED_AT,
      }),
    ).toBe(false);
    expect(
      isOpenStackAmphoraCertificateExpiring({
        status: "ALLOCATED",
        certExpiresAt: new Date(
          RECORDED_AT.getTime() + line - 1000,
        ).toISOString(),
        now: RECORDED_AT,
      }),
    ).toBe(true);
  });
});

describe("recovered: everything started again, and the load balancer that failed is still in ERROR", () => {
  const recorded: RecordedServiceScene = scene("recovered");

  test("needs only the load balancer that is in ERROR, which nothing started again", () => {
    expect(namesOf(itemsOf(recorded))).toEqual(["ou-lb-failed"]);
  });

  test("the pools are healthy again", async () => {
    expect(
      isAnythingFiring(
        await readOpenStackTemplateOnRecording({
          templateId: "openstack-pool-without-healthy-members",
          series: recorded.series,
        }),
      ),
    ).toBe(false);
  });
});

describe("what the agent's own collector made of the same answers", () => {
  const otlp: ReturnType<typeof scanRecordedOtlp> = scanRecordedOtlp(GROUP);

  test("makes load balancers and amphorae from them, through ingest's own filter", () => {
    const kinds: Array<string | null> = otlp.entries.map(
      (entry: { kind: string | null }): string | null => {
        return entry.kind;
      },
    );

    expect(kinds).toContain(OpenStackResourceKind.LoadBalancer);
    expect(kinds).toContain(OpenStackResourceKind.Amphora);
    expect(kinds).toContain(OpenStackResourceKind.LoadBalancerPool);
  });
});
