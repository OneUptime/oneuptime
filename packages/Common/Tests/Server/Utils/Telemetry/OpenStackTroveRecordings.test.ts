import OpenStackResource from "../../../../Models/DatabaseModels/OpenStackResource";
import { OpenStackResourceBufferEntry } from "../../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  OPENSTACK_DATABASE_INSTANCE_STUCK_MINUTES,
  OPENSTACK_DATABASE_VOLUME_WARNING_PERCENT,
  getOpenStackDatabaseVolumePercent,
  isOpenStackDatabaseInstanceInError,
  isOpenStackDatabaseInstanceStuck,
  isOpenStackDatabaseVolumeNearlyFull,
} from "../../../../Types/OpenStack/OpenStackHealthRules";
import { isOpenStackApiClosedToThisCredential } from "../../../../Types/OpenStack/OpenStackOptionalServices";
import {
  OPENSTACK_DATABASE_INSTANCE_ERROR_STATUSES,
  OPENSTACK_DATABASE_INSTANCE_TRANSITIONAL_STATUSES,
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
  getOpenStackHealth,
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
import PageMap from "../../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";

/*
 * TROVE, ON WHAT A REAL CLOUD SAID.
 *
 * Tests/Ops/openstack-e2e/services-trove.sh ran Trove on a real stable/2026.1 DevStack, with a real guest
 * image and a real Nova. Five of its six scenes are in Tests/Fixtures/OpenStack/services-trove: baseline,
 * instance-building, instance-error, taskmanager-down and api-down, each what the agent's exporter answered
 * once Trove had got there by itself.
 *
 * Not recorded: an instance reaching ACTIVE. Nova refused the guest on every run a runner has made, with
 * the fault in its API's answer. So a volume's `used` has only ever read 0, and what Volume Nearly Full
 * reads is proven below on made-up numbers, in the series' recorded labels, and says so.
 */

const GROUP: string = "services-trove";

function scene(name: string): RecordedServiceScene {
  return new RecordedServiceScene({ group: GROUP, scene: name });
}

function instances(recorded: RecordedServiceScene): Array<OpenStackResource> {
  return recorded.ofKind(OpenStackResourceKind.DatabaseInstance);
}

function instance(
  recorded: RecordedServiceScene,
  name: string,
): OpenStackResource {
  return recorded.named(OpenStackResourceKind.DatabaseInstance, name);
}

function severityOf(
  row: OpenStackResource,
  now: Date = RECORDED_AT,
): ResourceAttentionSeverity | null {
  return assessOpenStackResource({ row, now }).severity;
}

function minutesAfter(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * 60000);
}

describe("every scene with Trove answering", () => {
  test.each([
    ["baseline", 0],
    ["instance-building", 1],
    ["instance-error", 2],
    ["taskmanager-down", 2],
  ])(
    "%s holds %i instances, and its API reads up",
    (name: string, count: number) => {
      const recorded: RecordedServiceScene = scene(name);

      expect(instances(recorded)).toHaveLength(count);
      expect(
        recorded.seriesNamed("openstack_trove_total_instances")[0]?.value,
      ).toBe(count);
      expect(recorded.api(OpenStackServiceType.Database)?.status).toBe("up");
    },
  );

  test("three series speak of each instance, and it has one row", () => {
    const recorded: RecordedServiceScene = scene("instance-error");
    const ids: Array<string | undefined> = instances(recorded).map(
      (row: OpenStackResource): string | undefined => {
        return row.externalId;
      },
    );

    expect(new Set(ids).size).toBe(2);
    expect(
      recorded.seriesNamed("openstack_trove_instance_status"),
    ).toHaveLength(2);
    expect(
      recorded.seriesNamed("openstack_trove_instance_volume_size_gb"),
    ).toHaveLength(2);
    expect(
      recorded.seriesNamed("openstack_trove_instance_volume_used_gb"),
    ).toHaveLength(2);
  });
});

describe("instance-building: a database on its way", () => {
  const recorded: RecordedServiceScene = scene("instance-building");
  const row: OpenStackResource = instance(recorded, "ou-db-ok");

  test("reads as Trove said it, whose it is and what it runs", () => {
    expect(row.status).toBe("BUILD");
    expect(row.regionName).toBe("RegionOne");
    expect(row.openStackProjectId).toBeTruthy();
    expect(row.diskCapacityBytes).toBe(1024 * 1024 * 1024);
    expect(factsOfRow(row)["datastoreType"]).toBe("mysql");
    expect(factsOfRow(row)["datastoreVersion"]).toBe("8.4");
  });

  test("is the instance the API lists, of the project it says", () => {
    const answer: JSONObject = recorded.readApi("trove-mgmt-instances");
    const said: JSONObject = (
      answer["instances"] as JSONArray
    )[0] as JSONObject;

    expect(row.externalId).toBe(said["id"]);
    expect(row.openStackProjectId).toBe(said["tenant_id"]);
    expect(row.name).toBe(said["name"]);
  });

  test("the 0 its used side reads is no reading: it isn't running", () => {
    expect(row.diskAllocatedBytes).toBe(0);
    expect(
      getOpenStackDatabaseVolumePercent({
        usedBytes: row.diskAllocatedBytes,
        sizeBytes: row.diskCapacityBytes,
      }),
    ).toBe(null);
  });

  test("needs nobody yet, and is stuck once an hour has gone", () => {
    expect(
      getOpenStackAttentionItems({ rows: recorded.rows, now: RECORDED_AT }),
    ).toEqual([]);
    expect(
      severityOf(
        row,
        minutesAfter(
          RECORDED_AT,
          OPENSTACK_DATABASE_INSTANCE_STUCK_MINUTES - 1,
        ),
      ),
    ).toBe(null);
    expect(
      severityOf(
        row,
        minutesAfter(RECORDED_AT, OPENSTACK_DATABASE_INSTANCE_STUCK_MINUTES),
      ),
    ).toBe(ResourceAttentionSeverity.Warning);
  });

  test("Database Instance Stuck reads it, and fires by its status label however its code reads", async () => {
    const readings: Array<OpenStackTemplateReading> =
      await readOpenStackTemplateOnRecording({
        templateId: "openstack-database-instance-stuck",
        series: recorded.series,
      });

    expect(namesFiredBy(readings)).toEqual(["ou-db-ok"]);
  });

  test("and has nothing to fire on once it has moved on", async () => {
    expect(
      isAnythingFiring(
        await readOpenStackTemplateOnRecording({
          templateId: "openstack-database-instance-stuck",
          series: scene("instance-error").series,
        }),
      ),
    ).toBe(false);
  });
});

describe("instance-error: Nova refused it, and Trove gave up", () => {
  const recorded: RecordedServiceScene = scene("instance-error");

  test("reads Trove's word, however the exporter's code for it reads", () => {
    const row: OpenStackResource = instance(recorded, "ou-db-no-host");

    expect(row.status).toBe("ERROR");
    expect(isOpenStackDatabaseInstanceInError(row.status)).toBe(true);
    expect(
      recorded
        .seriesNamed("openstack_trove_instance_status")
        .map((series: { value: number }): number => {
          return series.value;
        }),
    ).toEqual([12, 12]);
  });

  test("reaches Needs attention by name, both of them", () => {
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: recorded.rows,
      now: RECORDED_AT,
    });

    expect(
      items
        .map((item: ResourceAttentionItem): string => {
          return item.name;
        })
        .sort(),
    ).toEqual(["ou-db-no-host", "ou-db-ok"]);
    expect(getOpenStackHealth(items)).toBe("Degraded");
  });

  test("however long ago", () => {
    expect(
      severityOf(
        instance(recorded, "ou-db-ok"),
        minutesAfter(RECORDED_AT, 60 * 24 * 30),
      ),
    ).toBe(ResourceAttentionSeverity.Warning);
  });

  test("Database Instance in Error fires on both, by name", async () => {
    expect(
      namesFiredBy(
        await readOpenStackTemplateOnRecording({
          templateId: "openstack-database-instance-in-error",
          series: recorded.series,
        }),
      ),
    ).toEqual(["ou-db-no-host", "ou-db-ok"]);
  });

  test("and has nothing to fire on before, or once they've gone", async () => {
    for (const series of [
      scene("baseline").series,
      scene("instance-building").series,
    ]) {
      expect(
        isAnythingFiring(
          await readOpenStackTemplateOnRecording({
            templateId: "openstack-database-instance-in-error",
            series,
          }),
        ),
      ).toBe(false);
    }
  });

  test("the exporter never says why: only Trove's mgmt API does", () => {
    const row: OpenStackResource = instance(recorded, "ou-db-no-host");
    const answer: JSONObject = recorded.readApi("trove-mgmt-instances");
    const said: JSONObject = (answer["instances"] as Array<JSONObject>).find(
      (item: JSONObject): boolean => {
        return item["name"] === "ou-db-no-host";
      },
    ) as JSONObject;

    expect(factsOfRow(row)).toHaveProperty("faultMessage", null);
    expect((said["fault"] as JSONObject)["message"]).toContain(
      "Flavor's disk is too small",
    );
    expect(said["task_description"]).toBe("Build error: Server.");
  });
});

describe("taskmanager-down: trove-taskmanager stopped", () => {
  const recorded: RecordedServiceScene = scene("taskmanager-down");

  test("nothing says so: Trove's lists answer without it, and it has no list of workers", () => {
    expect(recorded.api(OpenStackServiceType.Database)?.status).toBe("up");
    expect(recorded.ofKind(OpenStackResourceKind.Service)).toEqual([]);
  });
});

describe("api-down: Trove's API stopped", () => {
  const recorded: RecordedServiceScene = scene("api-down");

  test("reads 0, as it does for any credential refused, and says nothing of its instances", () => {
    expect(recorded.seriesNamed("openstack_trove_up")[0]?.value).toBe(0);
    expect(instances(recorded)).toEqual([]);
    expect(recorded.series).toHaveLength(1);
  });

  test("Databases API Down fires on it, and recovers once it answers", async () => {
    expect(
      isAnythingFiring(
        await readOpenStackTemplateOnRecording({
          templateId: "openstack-database-api-down",
          series: recorded.series,
        }),
      ),
    ).toBe(true);
    expect(
      isAnythingFiring(
        await readOpenStackTemplateOnRecording({
          templateId: "openstack-database-api-down",
          series: scene("taskmanager-down").series,
        }),
      ),
    ).toBe(false);
  });
});

describe("what each credential got: a refusal reads as a stopped API", () => {
  function reader(level: string): RecordedServiceScene {
    return new RecordedServiceScene({
      group: GROUP,
      scene: "access-check/exporter",
      exporterFolder: level,
    });
  }

  test.each(["admin", "monitoring-admin-get"])(
    "%s reads Trove: up, and every instance",
    (level: string) => {
      const recorded: RecordedServiceScene = reader(level);

      expect(recorded.api(OpenStackServiceType.Database)?.status).toBe("up");
      expect(namesOfRows(instances(recorded))).toEqual([
        "ou-db-no-host",
        "ou-db-ok",
      ]);
    },
  );

  test.each(["reader", "monitoring-role", "role-on-a-project"])(
    "%s is refused, and reads just as Trove stopped does",
    (level: string) => {
      const refused: RecordedServiceScene = reader(level);
      const stopped: RecordedServiceScene = scene("api-down");

      expect(
        refused.series.map((one: { name: string; value: number }) => {
          return [one.name, one.value];
        }),
      ).toEqual(
        stopped.series.map((one: { name: string; value: number }) => {
          return [one.name, one.value];
        }),
      );
    },
  );

  test.each(["reader", "monitoring-role", "role-on-a-project"])(
    "so to %s, whose read has never once worked, it isn't down: it's closed",
    (level: string) => {
      const api: OpenStackResource = reader(level).api(
        OpenStackServiceType.Database,
      ) as OpenStackResource;

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

  test("once it has read up, a 0 is a 0", () => {
    const api: OpenStackResource = scene("api-down").api(
      OpenStackServiceType.Database,
    ) as OpenStackResource;
    const once: OpenStackResource = Object.assign(
      new OpenStackResource(),
      api,
      {
        facts: { ...factsOfRow(api), vouchedAt: "2026-11-05T01:00:00.000Z" },
      },
    );

    expect(isOpenStackApiClosedToThisCredential(once)).toBe(false);
    expect(severityOf(once)).toBe(ResourceAttentionSeverity.Critical);
  });
});

describe("Volume Nearly Full, on made-up numbers", () => {
  // The labels as the exporter recorded them. Only `used` is made up: see the top of this file.
  function withUsed(
    usedGb: number,
    sizeGb: number,
  ): Array<{
    name: string;
    labels: Record<string, string>;
    value: number;
  }> {
    const labels: Record<string, string> = {
      ...scene("instance-building").seriesNamed(
        "openstack_trove_instance_status",
      )[0]!.labels,
      status: "ACTIVE",
    };
    return [
      {
        name: "openstack_trove_instance_volume_size_gb",
        labels,
        value: sizeGb,
      },
      {
        name: "openstack_trove_instance_volume_used_gb",
        labels,
        value: usedGb,
      },
    ];
  }

  test.each([
    [1, 10, false],
    [8.4, 10, false],
    [8.5, 10, true],
    [10, 10, true],
  ])(
    "%f of %f GiB fires: %s, on the same line the pages draw",
    async (usedGb: number, sizeGb: number, fires: boolean) => {
      expect(
        isAnythingFiring(
          await readOpenStackTemplateOnRecording({
            templateId: "openstack-database-volume-nearly-full",
            series: withUsed(usedGb, sizeGb),
          }),
        ),
      ).toBe(fires);
      expect(
        isOpenStackDatabaseVolumeNearlyFull({
          usedBytes: usedGb,
          sizeBytes: sizeGb,
        }),
      ).toBe(fires);
    },
  );

  test("what a real instance reads, 0 of its volume, fires nothing", async () => {
    expect(
      isAnythingFiring(
        await readOpenStackTemplateOnRecording({
          templateId: "openstack-database-volume-nearly-full",
          series: scene("instance-building").series,
        }),
      ),
    ).toBe(false);
  });

  test("it says the same line the rules hold", () => {
    expect(OPENSTACK_DATABASE_VOLUME_WARNING_PERCENT).toBe(85);
  });
});

describe("Topology", () => {
  function graphOf(rows: Array<OpenStackResource>): ResourceTopologyGraph {
    return buildOpenStackTopology({
      cloud: { id: "cloud-id", name: "devstack", lastSeenAt: RECORDED_AT },
      rows,
      now: RECORDED_AT,
    });
  }

  function databasesOf(
    graph: ResourceTopologyGraph,
  ): Array<ResourceTopologyNode> {
    return Array.from(graph.nodes.values()).filter(
      (node: ResourceTopologyNode): boolean => {
        return node.kind === "openstack.database";
      },
    );
  }

  test("draws each instance under its region's Databases, and links to its page", () => {
    const nodes: Array<ResourceTopologyNode> = databasesOf(
      graphOf(scene("instance-error").rows),
    );

    expect(nodes).toHaveLength(2);
    for (const node of nodes) {
      expect(node.parentId).toBe("section:RegionOne/databases");
      expect(node.health).toBe("warning");
      expect(node.link?.page).toBe(
        PageMap.OPENSTACK_CLOUD_VIEW_DATABASE_INSTANCE_DETAIL,
      );
    }
  });

  test("a cloud without Trove has no such node, and no section to hold one", () => {
    expect(databasesOf(graphOf([]))).toEqual([]);
    expect(
      Array.from(graphOf(scene("baseline").rows).nodes.keys()),
    ).not.toContain("section:RegionOne/databases");
  });
});

describe("what the agent's real collector sent", () => {
  const scanned: {
    entries: Array<OpenStackResourceBufferEntry>;
    scrapes: Array<{ service: string; up: number; samples: number }>;
  } = scanRecordedOtlp(GROUP);

  test("an instance reads the same as it does from the exporter's text", () => {
    const row: OpenStackResourceBufferEntry | undefined = scanned.entries.find(
      (entry: OpenStackResourceBufferEntry): boolean => {
        return entry.kind === OpenStackResourceKind.DatabaseInstance;
      },
    );

    expect(row?.status).toBeTruthy();
    expect(row?.regionName).toBe("RegionOne");
    expect(row?.facts["datastoreType"]).toBe("mysql");
  });

  test("a service this cloud doesn't run reads up 1 with nothing, and makes no row", () => {
    const absent: { service: string; up: number; samples: number } | undefined =
      scanned.scrapes.find(
        (scrape: { service: string; samples: number }): boolean => {
          return scrape.service !== OpenStackServiceType.Database;
        },
      );

    expect(absent?.up).toBe(1);
    expect(absent?.samples).toBe(0);
    expect(
      scanned.entries
        .filter((entry: OpenStackResourceBufferEntry): boolean => {
          return entry.kind === OpenStackResourceKind.Api;
        })
        .map((entry: OpenStackResourceBufferEntry): string | null => {
          return entry.name;
        }),
    ).toEqual([OpenStackServiceType.Database]);
  });
});

describe("the words themselves", () => {
  test("no word is both an error and on its way", () => {
    for (const status of OPENSTACK_DATABASE_INSTANCE_ERROR_STATUSES) {
      expect(
        OPENSTACK_DATABASE_INSTANCE_TRANSITIONAL_STATUSES.has(status),
      ).toBe(false);
    }
  });

  test.each([
    ["ACTIVE", null],
    ["SHUTDOWN", null],
    ["BACKUP", null],
    ["RESTART_REQUIRED", null],
    ["ERROR", ResourceAttentionSeverity.Warning],
    ["FAILED", ResourceAttentionSeverity.Warning],
    ["BUILD", null],
    [null, null],
  ])(
    "an instance reading %s, just now, reads as %s",
    (status: string | null, severity: ResourceAttentionSeverity | null) => {
      expect(
        severityOf(
          Object.assign(new OpenStackResource(), {
            kind: OpenStackResourceKind.DatabaseInstance,
            status: status || undefined,
            stateChangedAt: RECORDED_AT,
          }),
        ),
      ).toBe(severity);
    },
  );

  test("a word Trove has added since reads as nothing rather than as a failure", () => {
    expect(
      severityOf(
        Object.assign(new OpenStackResource(), {
          kind: OpenStackResourceKind.DatabaseInstance,
          status: "SOME_WORD_FROM_A_LATER_RELEASE",
          stateChangedAt: new Date(0),
        }),
      ),
    ).toBe(null);
  });

  test("a stuck instance with no time on it says nothing", () => {
    expect(
      isOpenStackDatabaseInstanceStuck({
        status: "BUILD",
        stateChangedAt: null,
        now: RECORDED_AT,
      }),
    ).toBe(false);
  });

  test("a volume with nothing to divide by says nothing", () => {
    expect(
      getOpenStackDatabaseVolumePercent({ usedBytes: 5, sizeBytes: 0 }),
    ).toBe(null);
    expect(
      getOpenStackDatabaseVolumePercent({ usedBytes: null, sizeBytes: 5 }),
    ).toBe(null);
    expect(
      isOpenStackDatabaseVolumeNearlyFull({ usedBytes: 0, sizeBytes: 5 }),
    ).toBe(false);
  });
});
