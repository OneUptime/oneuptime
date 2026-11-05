import OpenStackResource from "../../../../Models/DatabaseModels/OpenStackResource";
import { OpenStackResourceBufferEntry } from "../../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  OPENSTACK_DNS_ZONE_PENDING_STUCK_MINUTES,
  OPENSTACK_QUIET_SERVICE_MINUTES,
  isOpenStackDnsInError,
  isOpenStackDnsZoneStuckPending,
  isOpenStackServiceQuiet,
} from "../../../../Types/OpenStack/OpenStackHealthRules";
import { isOpenStackApiClosedToThisCredential } from "../../../../Types/OpenStack/OpenStackOptionalServices";
import {
  OPENSTACK_DNS_RECORD_TYPES_SOMEONE_ASKED_FOR,
  OPENSTACK_DNS_ZONE_OWN_RECORD_TYPES,
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
  namesFiredBy,
  readOpenStackTemplateOnRecording,
} from "../../../Types/Monitor/Utils/OpenStackTemplateOnRecording";
import {
  assessOpenStackResource,
  getOpenStackAttentionItems,
} from "../../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackHealth";
import { getOpenStackRowsAsThisCredentialReadsThem } from "../../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackServices";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import { buildOpenStackTopology } from "../../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/Builders/OpenStackTopology";
import {
  ResourceTopologyGraph,
  ResourceTopologyNode,
} from "../../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";

/*
 * DESIGNATE, ON WHAT A REAL CLOUD SAID.
 *
 * Tests/Ops/openstack-e2e/services-designate-barbican-swift.sh ran Designate on a real stable/2026.1 DevStack with
 * its bind9 backend. All four of its scenes are in Tests/Fixtures/OpenStack/services-designate-barbican-swift, each
 * what the agent's exporter answered once Designate had got there by itself. The one recordset in ERROR is written
 * into its row, and its how.txt says so: a zone's writes failing took the zone there, and its own SOA and NS, but
 * not one recordset alone. So how Designate gets a single recordset to ERROR is the one thing here made by hand.
 */

const GROUP: string = "services-designate-barbican-swift";

function scene(name: string): RecordedServiceScene {
  return new RecordedServiceScene({ group: GROUP, scene: `designate-${name}` });
}

function zones(recorded: RecordedServiceScene): Array<OpenStackResource> {
  return recorded.ofKind(OpenStackResourceKind.DnsZone);
}

function zone(recorded: RecordedServiceScene, name: string): OpenStackResource {
  return recorded.named(OpenStackResourceKind.DnsZone, name);
}

function recordsets(recorded: RecordedServiceScene): Array<OpenStackResource> {
  return recorded.ofKind(OpenStackResourceKind.DnsRecordset);
}

function minutesAfter(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * 60000);
}

function severityOf(
  row: OpenStackResource,
  now: Date = RECORDED_AT,
): ResourceAttentionSeverity | null {
  return assessOpenStackResource({ row, now }).severity;
}

function namesNeedingSomeone(
  recorded: RecordedServiceScene,
  now: Date = RECORDED_AT,
): Array<string> {
  return getOpenStackAttentionItems({ rows: recorded.rows, now })
    .map((item: ResourceAttentionItem): string => {
      return item.name;
    })
    .sort();
}

describe("designate-baseline: zones and recordsets ACTIVE, in two projects", () => {
  const recorded: RecordedServiceScene = scene("baseline");

  test("each zone reads as Designate said it, whose it is and how many recordsets it holds", () => {
    const row: OpenStackResource = zone(recorded, "ou-active.example.org.");

    expect(row.status).toBe("ACTIVE");
    expect(row.regionName).toBe("RegionOne");
    expect(row.openStackProjectId).toBeTruthy();
    expect(factsOfRow(row)["zoneType"]).toBe("PRIMARY");
    expect(factsOfRow(row)["recordsetCount"]).toBe(3);
    expect(
      factsOfRow(zone(recorded, "ou-payments.example.org."))["recordsetCount"],
    ).toBe(2);
  });

  test("the same zones and projects the API lists", () => {
    const answer: JSONObject = recorded.readApi("designate-zones");

    for (const item of answer["zones"] as JSONArray) {
      const said: JSONObject = item as JSONObject;
      const row: OpenStackResource = zone(recorded, said["name"] as string);
      expect(row.externalId).toBe(said["id"]);
      expect(row.openStackProjectId).toBe(said["project_id"]);
    }
  });

  test("an ACTIVE recordset has no row: a zone can hold any number, and nothing is asked of them", () => {
    expect(
      recorded.seriesNamed("openstack_designate_recordsets_status").length,
    ).toBeGreaterThan(0);
    expect(recordsets(recorded)).toEqual([]);
  });

  test("its API reads up, and nothing needs anyone", () => {
    expect(recorded.api(OpenStackServiceType.Dns)?.status).toBe("up");
    expect(namesNeedingSomeone(recorded)).toEqual([]);
  });
});

describe("designate-pending: designate-worker stopped", () => {
  const recorded: RecordedServiceScene = scene("pending");

  test("zones and recordsets read PENDING, and PENDING's code is 0, so nothing can read its value", () => {
    expect(zone(recorded, "ou-pending.example.org.").status).toBe("PENDING");
    expect(
      recorded
        .seriesNamed("openstack_designate_zone_status")
        .filter((series: { labels: Record<string, string> }): boolean => {
          return series.labels["status"] === "PENDING";
        })
        .map((series: { value: number }): number => {
          return series.value;
        }),
    ).toEqual([0, 0]);
  });

  test("only what isn't ACTIVE has a row, each saying what it is of which zone", () => {
    const row: OpenStackResource = recorded.named(
      OpenStackResourceKind.DnsRecordset,
      "pending.ou-active.example.org.",
    );

    expect(row.status).toBe("PENDING");
    expect(factsOfRow(row)["recordType"]).toBe("A");
    expect(factsOfRow(row)["zoneName"]).toBe("ou-active.example.org.");
    expect(factsOfRow(row)["zoneId"]).toBe(
      zone(recorded, "ou-active.example.org.").externalId,
    );
    expect(
      recordsets(recorded).every((one: OpenStackResource): boolean => {
        return one.status === "PENDING";
      }),
    ).toBe(true);
  });

  test("it's on its way until the line, and nothing is working on it past it", () => {
    expect(namesNeedingSomeone(recorded)).toEqual([]);
    expect(
      isOpenStackDnsZoneStuckPending({
        status: "PENDING",
        stateChangedAt: RECORDED_AT,
        now: minutesAfter(
          RECORDED_AT,
          OPENSTACK_DNS_ZONE_PENDING_STUCK_MINUTES - 1,
        ),
      }),
    ).toBe(false);
    // This is one moment's rows, so its API's goes quiet by the line too: nothing has read it since.
    expect(
      namesNeedingSomeone(
        recorded,
        minutesAfter(RECORDED_AT, OPENSTACK_DNS_ZONE_PENDING_STUCK_MINUTES),
      ).filter((name: string): boolean => {
        return name !== OpenStackServiceType.Dns;
      }),
    ).toEqual(["ou-active.example.org.", "ou-pending.example.org."]);
  });

  test("a stopped worker leaves its API up, which is why only its zones say so", () => {
    expect(recorded.api(OpenStackServiceType.Dns)?.status).toBe("up");
    const statuses: Array<JSONObject> = recorded.readApi(
      "designate-service-statuses",
    )["service_statuses"] as Array<JSONObject>;
    // Designate's own list reads it as UP for a while yet: it goes by a heartbeat.
    expect(
      statuses.find((one: JSONObject): boolean => {
        return one["service_name"] === "worker";
      })?.["status"],
    ).toBe("UP");
  });

  test("DNS Zone Stuck Pending fires on what reads 0, by counting it", async () => {
    expect(
      namesFiredBy(
        await readOpenStackTemplateOnRecording({
          templateId: "openstack-dns-zone-stuck-pending",
          series: recorded.series,
        }),
      ),
    ).toEqual(["ou-active.example.org.", "ou-pending.example.org."]);
  });

  test("and nothing on the scene before it", async () => {
    expect(
      isAnythingFiring(
        await readOpenStackTemplateOnRecording({
          templateId: "openstack-dns-zone-stuck-pending",
          series: scene("baseline").series,
        }),
      ),
    ).toBe(false);
  });
});

describe("designate-error: the DNS server it writes to stopped", () => {
  const recorded: RecordedServiceScene = scene("error");

  test("the zone in ERROR got there by itself, with its own SOA and NS", () => {
    const row: OpenStackResource = zone(recorded, "ou-error.example.org.");

    expect(row.status).toBe("ERROR");
    expect(isOpenStackDnsInError(row.status)).toBe(true);
    expect(
      recordsets(recorded)
        .filter((one: OpenStackResource): boolean => {
          return factsOfRow(one)["zoneId"] === row.externalId;
        })
        .map((one: OpenStackResource): string => {
          return `${factsOfRow(one)["recordType"]} ${one.status}`;
        })
        .sort(),
    ).toEqual(["NS ERROR", "SOA ERROR"]);
  });

  test("a failed zone is said once, by the zone, and a recordset of another zone by itself", () => {
    expect(namesNeedingSomeone(recorded)).toEqual([
      "error.ou-active.example.org.",
      "ou-error.example.org.",
    ]);
  });

  test("however long ago, because nothing moves it on", () => {
    expect(
      severityOf(
        zone(recorded, "ou-error.example.org."),
        minutesAfter(RECORDED_AT, 60 * 24 * 30),
      ),
    ).toBe(ResourceAttentionSeverity.Warning);
  });

  test("DNS Zone in Error fires on the zone, and nothing else", async () => {
    expect(
      namesFiredBy(
        await readOpenStackTemplateOnRecording({
          templateId: "openstack-dns-zone-in-error",
          series: recorded.series,
        }),
      ),
    ).toEqual(["ou-error.example.org."]);
  });

  test("DNS Recordset in Error fires for the zone whose recordset someone asked for, and not for a failed zone's own", async () => {
    const readings: Array<OpenStackTemplateReading> =
      await readOpenStackTemplateOnRecording({
        templateId: "openstack-dns-recordset-in-error",
        series: recorded.series,
      });

    expect(
      readings
        .filter((reading: OpenStackTemplateReading): boolean => {
          return reading.breached;
        })
        .map((reading: OpenStackTemplateReading): string | undefined => {
          return reading.group["zone_name"];
        }),
    ).toEqual(["ou-active.example.org."]);
  });

  test("both recover once what they read has gone", async () => {
    const without: typeof recorded.series = recorded.series.filter(
      (series: { labels: Record<string, string> }): boolean => {
        return series.labels["status"] !== "ERROR";
      },
    );
    for (const templateId of [
      "openstack-dns-zone-in-error",
      "openstack-dns-recordset-in-error",
    ]) {
      expect(
        isAnythingFiring(
          await readOpenStackTemplateOnRecording({
            templateId,
            series: without,
          }),
        ),
      ).toBe(false);
    }
  });

  test("the types it reads and leaves are every type a real zone holds", () => {
    for (const series of recorded.seriesNamed(
      "openstack_designate_recordsets_status",
    )) {
      const type: string = series.labels["type"] as string;
      expect(
        OPENSTACK_DNS_ZONE_OWN_RECORD_TYPES.has(type) ||
          OPENSTACK_DNS_RECORD_TYPES_SOMEONE_ASKED_FOR.includes(type),
      ).toBe(true);
    }
  });
});

describe("designate-api-down: Designate's API stopped", () => {
  const recorded: RecordedServiceScene = scene("api-down");

  test("the exporter says nothing at all, as it does for a cloud without Designate", () => {
    expect(recorded.series).toEqual([]);
    expect(recorded.rows).toEqual([]);
  });

  test("so a cloud that had it can only go quiet, and never reads down", () => {
    const api: OpenStackResource = scene("baseline").api(
      OpenStackServiceType.Dns,
    ) as OpenStackResource;

    expect(api.status).toBe("up");
    expect(
      isOpenStackServiceQuiet({
        service: api.name,
        lastSeenAt: api.lastSeenAt,
        now: minutesAfter(RECORDED_AT, OPENSTACK_QUIET_SERVICE_MINUTES - 1),
      }),
    ).toBe(false);
    expect(
      severityOf(
        api,
        minutesAfter(RECORDED_AT, OPENSTACK_QUIET_SERVICE_MINUTES),
      ),
    ).toBe(ResourceAttentionSeverity.Warning);
    expect(
      assessOpenStackResource({
        row: api,
        now: minutesAfter(RECORDED_AT, OPENSTACK_QUIET_SERVICE_MINUTES),
      }).reasons[0]?.text,
    ).toContain("the exporter answers the same for both");
  });

  test("no alert reads that: DNS API Down speaks only where a probe can say so", async () => {
    expect(
      await readOpenStackTemplateOnRecording({
        templateId: "openstack-dns-api-down",
        series: recorded.series,
      }),
    ).toEqual([]);
  });
});

describe("what each credential got", () => {
  function reader(level: string): RecordedServiceScene {
    return new RecordedServiceScene({
      group: GROUP,
      scene: "access-check/exporter",
      exporterFolder: level,
    });
  }

  test.each(["admin", "monitoring-admin-get"])(
    "%s reads every project's zones",
    (level: string) => {
      const recorded: RecordedServiceScene = reader(level);

      expect(recorded.api(OpenStackServiceType.Dns)?.status).toBe("up");
      expect(namesOfRows(zones(recorded))).toContain(
        "ou-payments.example.org.",
      );
    },
  );

  test.each(["reader", "monitoring-role", "role-on-a-project"])(
    "%s is refused, and that's the one thing that reads 0 here: it isn't down, it's closed",
    (level: string) => {
      const recorded: RecordedServiceScene = reader(level);
      const api: OpenStackResource = recorded.api(
        OpenStackServiceType.Dns,
      ) as OpenStackResource;

      expect(
        recorded.series.filter((one: { name: string }): boolean => {
          return one.name.startsWith("openstack_designate_");
        }),
      ).toHaveLength(1);
      expect(api.status).toBe("down");
      expect(isOpenStackApiClosedToThisCredential(api)).toBe(true);

      const [read] = getOpenStackRowsAsThisCredentialReadsThem({
        rows: [api],
        apis: [api],
        workers: [],
      });
      expect(read?.status).toBe("closed");
      expect(severityOf(read as OpenStackResource)).toBe(null);
    },
  );
});

describe("Topology", () => {
  function graphOf(rows: Array<OpenStackResource>): ResourceTopologyGraph {
    return buildOpenStackTopology({
      cloud: { id: "cloud-id", name: "devstack", lastSeenAt: RECORDED_AT },
      rows,
      now: RECORDED_AT,
    });
  }

  function nodesOf(
    graph: ResourceTopologyGraph,
    kind: string,
  ): Array<ResourceTopologyNode> {
    return Array.from(graph.nodes.values()).filter(
      (node: ResourceTopologyNode): boolean => {
        return node.kind === kind;
      },
    );
  }

  test("draws each zone under its region's Network, and what's wrong of it beneath it", () => {
    const graph: ResourceTopologyGraph = graphOf(scene("error").rows);
    const failed: ResourceTopologyNode | undefined = nodesOf(
      graph,
      "openstack.dns-zone",
    ).find((node: ResourceTopologyNode): boolean => {
      return node.name === "ou-error.example.org.";
    });

    expect(failed?.parentId).toBe("section:RegionOne/network");
    expect(failed?.health).toBe("warning");
    expect(
      nodesOf(graph, "openstack.dns-recordset").filter(
        (node: ResourceTopologyNode): boolean => {
          return node.parentId === failed?.id;
        },
      ),
    ).toHaveLength(2);
  });

  test("a cloud without Designate has no such node", () => {
    expect(nodesOf(graphOf([]), "openstack.dns-zone")).toEqual([]);
  });
});

describe("what the agent's real collector sent", () => {
  const scanned: {
    entries: Array<OpenStackResourceBufferEntry>;
    scrapes: Array<{ service: string; up: number; samples: number }>;
  } = scanRecordedOtlp(GROUP);

  test("a zone reads the same as it does from the exporter's text", () => {
    const row: OpenStackResourceBufferEntry | undefined = scanned.entries.find(
      (entry: OpenStackResourceBufferEntry): boolean => {
        return entry.kind === OpenStackResourceKind.DnsZone;
      },
    );

    expect(row?.regionName).toBe("RegionOne");
    expect(row?.status).toBeTruthy();
    expect(row?.facts["zoneType"]).toBe("PRIMARY");
  });

  test("a service this cloud doesn't run reads up 1 with nothing, and makes no row", () => {
    const absent: { service: string; up: number; samples: number } | undefined =
      scanned.scrapes.find((scrape: { samples: number }): boolean => {
        return scrape.samples === 0;
      });

    expect(absent?.up).toBe(1);
    expect(
      scanned.entries
        .filter((entry: OpenStackResourceBufferEntry): boolean => {
          return entry.kind === OpenStackResourceKind.Api;
        })
        .map((entry: OpenStackResourceBufferEntry): string | null => {
          return entry.name;
        }),
    ).not.toContain(absent?.service);
  });
});
