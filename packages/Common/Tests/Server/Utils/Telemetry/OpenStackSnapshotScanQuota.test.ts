import { describe, expect, test } from "@jest/globals";
import {
  OPENSTACK_SNAPSHOT_METRIC_NAMES,
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
} from "../../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  OPENSTACK_QUOTA_STALE_MINUTES,
  OpenStackProjectQuota,
  OpenStackQuotaResource,
  getOpenStackProjectQuotas,
  getOpenStackQuotaFactKey,
} from "../../../../Types/OpenStack/OpenStackQuota";
import { OpenStackResourceKind } from "../../../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_EXPORTER_SERIES,
  OpenStackExporterSeries,
} from "../../../Types/Monitor/Utils/OpenStackExporterSeries";

/*
 * What a project may use and has used, as the scan folds it onto the project's row.
 *
 * No recording holds these series, because the agent leaves them off, so the series here
 * are written from the exporter's source, label for label (nova.go ListComputeLimits,
 * cinder.go ListVolumeLimits, neutron.go collectNeutronQuotaDetail). The parser takes
 * only those exact names and labels, and these tests are what holds it to that.
 */

const OBSERVED_AT_MS: number = Date.UTC(2026, 10, 4, 12, 0, 0);
const NOW: Date = new Date(OBSERVED_AT_MS + 60 * 1000);
const PROJECT: string = "f3a1c0d2e4b64f7c8a9d0e1f2a3b4c5d";

function point(data: {
  labels: Record<string, string>;
  value: number;
  atMs?: number;
}): JSONObject {
  const attributes: JSONArray = Object.keys(data.labels).map((key: string) => {
    return { key, value: { stringValue: data.labels[key] } };
  });
  return {
    attributes,
    asDouble: data.value,
    timeUnixNano: String((data.atMs ?? OBSERVED_AT_MS) * 1000000),
  };
}

function fold(
  series: Array<{
    name: string;
    labels?: Record<string, string>;
    value: number;
    region?: string;
  }>,
): Array<OpenStackResourceBufferEntry> {
  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();
  for (const item of series) {
    bufferOpenStackSnapshotMetric({
      metricName: item.name,
      datapoint: point({
        labels: {
          tenant: "ou-payments",
          tenant_id: PROJECT,
          ...(item.region === undefined
            ? { "openstack.region.name": "RegionOne" }
            : item.region
              ? { "openstack.region.name": item.region }
              : {}),
          ...(item.labels || {}),
        },
        value: item.value,
      }),
      buffer,
    });
  }
  return finishOpenStackBatch(buffer.values());
}

function factsOfProject(
  entries: Array<OpenStackResourceBufferEntry>,
): JSONObject {
  const project: OpenStackResourceBufferEntry | undefined = entries.find(
    (entry: OpenStackResourceBufferEntry) => {
      return entry.kind === OpenStackResourceKind.Project;
    },
  );
  return project?.facts || {};
}

function quotasOf(
  entries: Array<OpenStackResourceBufferEntry>,
): Array<OpenStackProjectQuota> {
  return getOpenStackProjectQuotas(factsOfProject(entries), NOW);
}

describe("the series the scan reads, and the ones it leaves", () => {
  test.each([
    "openstack_nova_limits_instances_used",
    "openstack_nova_limits_instances_max",
    "openstack_nova_limits_vcpus_used",
    "openstack_nova_limits_vcpus_max",
    "openstack_nova_limits_memory_used",
    "openstack_nova_limits_memory_max",
    "openstack_cinder_limits_volume_used_gb",
    "openstack_cinder_limits_volume_max_gb",
    "openstack_neutron_quota_network",
    "openstack_neutron_quota_port",
    "openstack_neutron_quota_floatingip",
  ])("%s is read", (name: string) => {
    expect(OPENSTACK_SNAPSHOT_METRIC_NAMES.has(name)).toBe(true);
  });

  test.each([
    ["openstack_nova_limits_instances_max", ["tenant", "tenant_id"]],
    ["openstack_nova_limits_vcpus_used", ["tenant", "tenant_id"]],
    ["openstack_cinder_limits_volume_max_gb", ["tenant", "tenant_id"]],
    ["openstack_neutron_quota_network", ["type", "tenant", "tenant_id"]],
    ["openstack_neutron_quota_port", ["type", "tenant", "tenant_id"]],
    ["openstack_neutron_quota_floatingip", ["type", "tenant", "tenant_id"]],
  ])(
    "%s carries the labels the exporter's source writes",
    (name: string, labels: Array<string>) => {
      const series: OpenStackExporterSeries | undefined =
        OPENSTACK_EXPORTER_SERIES[name];

      expect(series).toBeDefined();
      expect([...series!.labels].sort()).toEqual([...labels].sort());
    },
  );

  test.each([
    // Nova's other spelling of these, which the agent also leaves off: one reading is enough.
    "openstack_nova_quota_cores",
    "openstack_nova_quota_instances",
    // What the spec does not ask for, and nothing here shows.
    "openstack_cinder_limits_backup_used_gb",
    "openstack_neutron_quota_subnet",
    "openstack_neutron_quota_router",
  ])("%s is not", (name: string) => {
    expect(OPENSTACK_SNAPSHOT_METRIC_NAMES.has(name)).toBe(false);
  });
});

describe("a whole reading lands on the project's row", () => {
  test("Nova's limits, each by the name that says which number it is", () => {
    const quotas: Array<OpenStackProjectQuota> = quotasOf(
      fold([
        { name: "openstack_nova_limits_instances_used", value: 3 },
        { name: "openstack_nova_limits_instances_max", value: 4 },
        { name: "openstack_nova_limits_vcpus_used", value: 6 },
        { name: "openstack_nova_limits_vcpus_max", value: 8 },
        { name: "openstack_nova_limits_memory_used", value: 512 },
        { name: "openstack_nova_limits_memory_max", value: 2097152 },
      ]),
    );

    expect(
      quotas.map((quota: OpenStackProjectQuota) => {
        return [quota.resource, quota.used, quota.limit];
      }),
    ).toEqual([
      [OpenStackQuotaResource.Instances, 3, 4],
      [OpenStackQuotaResource.Cores, 6, 8],
      [OpenStackQuotaResource.RamMib, 512, 2097152],
    ]);
  });

  test("Cinder's gigabytes", () => {
    const quotas: Array<OpenStackProjectQuota> = quotasOf(
      fold([
        { name: "openstack_cinder_limits_volume_used_gb", value: 90 },
        { name: "openstack_cinder_limits_volume_max_gb", value: 100 },
      ]),
    );

    expect(quotas[0]?.resource).toBe(OpenStackQuotaResource.Gigabytes);
    expect(quotas[0]?.isAtLine).toBe(true);
  });

  test("Neutron's, each by its type label, and its reserved figure is left out", () => {
    const quotas: Array<OpenStackProjectQuota> = quotasOf(
      fold([
        {
          name: "openstack_neutron_quota_port",
          labels: { type: "used" },
          value: 12,
        },
        {
          name: "openstack_neutron_quota_port",
          labels: { type: "reserved" },
          value: 99,
        },
        {
          name: "openstack_neutron_quota_port",
          labels: { type: "limit" },
          value: 100,
        },
        {
          name: "openstack_neutron_quota_floatingip",
          labels: { type: "used" },
          value: 1,
        },
        {
          name: "openstack_neutron_quota_floatingip",
          labels: { type: "limit" },
          value: 50,
        },
      ]),
    );

    expect(
      quotas.map((quota: OpenStackProjectQuota) => {
        return [quota.resource, quota.used, quota.limit];
      }),
    ).toEqual([
      [OpenStackQuotaResource.Ports, 12, 100],
      [OpenStackQuotaResource.FloatingIps, 1, 50],
    ]);
  });

  test("the row is the project's, by its ID, with its name", () => {
    const entries: Array<OpenStackResourceBufferEntry> = fold([
      { name: "openstack_nova_limits_instances_used", value: 1 },
      { name: "openstack_nova_limits_instances_max", value: 4 },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.externalId).toBe(PROJECT);
    expect(entries[0]?.name).toBe("ou-payments");
    expect(entries[0]?.openStackProjectId).toBe(PROJECT);
    // A project belongs to the cloud, so its row has no region even when its quota has.
    expect(entries[0]?.regionName).toBeNull();
  });

  test("says when it was read", () => {
    const quota: OpenStackProjectQuota = quotasOf(
      fold([
        { name: "openstack_nova_limits_instances_used", value: 1 },
        { name: "openstack_nova_limits_instances_max", value: 4 },
      ]),
    )[0]!;

    expect(quota.observedAt?.getTime()).toBe(OBSERVED_AT_MS);
    expect(quota.isStale).toBe(false);
  });
});

describe("what never reads as a quota", () => {
  test("half a reading writes nothing, because it would replace a whole one", () => {
    const facts: JSONObject = factsOfProject(
      fold([{ name: "openstack_nova_limits_instances_used", value: 3 }]),
    );

    expect(
      facts[
        getOpenStackQuotaFactKey(OpenStackQuotaResource.Instances, "RegionOne")
      ],
    ).toBeUndefined();
  });

  test("a series with no project says nothing", () => {
    const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();
    bufferOpenStackSnapshotMetric({
      metricName: "openstack_nova_limits_instances_used",
      datapoint: point({ labels: { tenant: "no-id" }, value: 1 }),
      buffer,
    });

    expect(buffer.size).toBe(0);
  });

  test("a Neutron series with no type, or one this does not know, says nothing", () => {
    expect(
      factsOfProject(
        fold([
          { name: "openstack_neutron_quota_port", value: 12 },
          {
            name: "openstack_neutron_quota_port",
            labels: { type: "in_use" },
            value: 12,
          },
          {
            name: "openstack_neutron_quota_port",
            labels: { type: "limit" },
            value: 100,
          },
        ]),
      )[getOpenStackQuotaFactKey(OpenStackQuotaResource.Ports, "RegionOne")],
    ).toBeUndefined();
  });

  test("a used figure below zero means nothing", () => {
    expect(
      factsOfProject(
        fold([
          { name: "openstack_nova_limits_instances_used", value: -1 },
          { name: "openstack_nova_limits_instances_max", value: 4 },
        ]),
      )[
        getOpenStackQuotaFactKey(OpenStackQuotaResource.Instances, "RegionOne")
      ],
    ).toBeUndefined();
  });

  test("a value that is no number at all is dropped before it gets here", () => {
    const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();
    bufferOpenStackSnapshotMetric({
      metricName: "openstack_nova_limits_instances_max",
      datapoint: {
        attributes: [
          { key: "tenant_id", value: { stringValue: PROJECT } },
        ] as JSONArray,
        asDouble: Number.NaN,
      },
      buffer,
    });

    expect(buffer.size).toBe(0);
  });
});

describe("the limit", () => {
  test("-1 is no limit, kept as that, and never at anything", () => {
    const quota: OpenStackProjectQuota = quotasOf(
      fold([
        { name: "openstack_nova_limits_instances_used", value: 5000 },
        { name: "openstack_nova_limits_instances_max", value: -1 },
      ]),
    )[0]!;

    expect(quota.limit).toBe(-1);
    expect(quota.percent).toBeNull();
    expect(quota.isAtLine).toBe(false);
  });

  test("0 is a project that may hold none, which is no share of anything", () => {
    const quota: OpenStackProjectQuota = quotasOf(
      fold([
        { name: "openstack_nova_limits_instances_used", value: 0 },
        { name: "openstack_nova_limits_instances_max", value: 0 },
      ]),
    )[0]!;

    expect(quota.percent).toBeNull();
    expect(quota.isAtLine).toBe(false);
  });

  test.each([
    [89, 100, false],
    [90, 100, true],
    [91, 100, true],
    [9, 10, true],
    [4, 4, true],
    [8, 9, false],
    [101, 100, true],
  ])(
    "%d of %d is at the line: %s",
    (used: number, limit: number, at: boolean) => {
      const quota: OpenStackProjectQuota = quotasOf(
        fold([
          { name: "openstack_nova_limits_instances_used", value: used },
          { name: "openstack_nova_limits_instances_max", value: limit },
        ]),
      )[0]!;

      expect(quota.isAtLine).toBe(at);
    },
  );
});

describe("a quota belongs to a region", () => {
  test("each region's reading is its own, on the one project row", () => {
    const entries: Array<OpenStackResourceBufferEntry> = fold([
      {
        name: "openstack_nova_limits_instances_used",
        value: 1,
        region: "RegionOne",
      },
      {
        name: "openstack_nova_limits_instances_max",
        value: 10,
        region: "RegionOne",
      },
      {
        name: "openstack_nova_limits_instances_used",
        value: 9,
        region: "RegionTwo",
      },
      {
        name: "openstack_nova_limits_instances_max",
        value: 10,
        region: "RegionTwo",
      },
    ]);

    expect(entries).toHaveLength(1);
    expect(
      quotasOf(entries).map((quota: OpenStackProjectQuota) => {
        return [quota.regionName, quota.isAtLine];
      }),
    ).toEqual([
      ["RegionOne", false],
      ["RegionTwo", true],
    ]);
  });

  test("a scrape that names no region reads as the default one", () => {
    expect(
      quotasOf(
        fold([
          {
            name: "openstack_nova_limits_instances_used",
            value: 1,
            region: "",
          },
          { name: "openstack_nova_limits_instances_max", value: 2, region: "" },
        ]),
      )[0]?.regionName,
    ).toBe("default");
  });
});

describe("each service's scrape arrives alone", () => {
  test("so each reading is a fact of its own, and one never replaces another", () => {
    const nova: JSONObject = factsOfProject(
      fold([
        { name: "openstack_nova_limits_instances_used", value: 1 },
        { name: "openstack_nova_limits_instances_max", value: 4 },
      ]),
    );
    const neutron: JSONObject = factsOfProject(
      fold([
        {
          name: "openstack_neutron_quota_port",
          labels: { type: "used" },
          value: 2,
        },
        {
          name: "openstack_neutron_quota_port",
          labels: { type: "limit" },
          value: 4,
        },
      ]),
    );

    // What bulkUpsert's `facts || EXCLUDED.facts` does with them.
    const merged: JSONObject = { ...nova, ...neutron };

    expect(
      getOpenStackProjectQuotas(merged, NOW).map(
        (quota: OpenStackProjectQuota) => {
          return quota.resource;
        },
      ),
    ).toEqual([OpenStackQuotaResource.Instances, OpenStackQuotaResource.Ports]);
  });
});

describe("a reading goes stale", () => {
  const reading: (minutesAgo: number) => JSONObject = (
    minutesAgo: number,
  ): JSONObject => {
    return {
      [getOpenStackQuotaFactKey(OpenStackQuotaResource.Instances, "RegionOne")]:
        {
          used: 4,
          limit: 4,
          observedAt: new Date(
            NOW.getTime() - minutesAgo * 60 * 1000,
          ).toISOString(),
        },
    };
  };

  test("on the stated line: whoever turned quotas off is not left with a red project", () => {
    expect(
      getOpenStackProjectQuotas(reading(OPENSTACK_QUOTA_STALE_MINUTES), NOW)[0]
        ?.isAtLine,
    ).toBe(true);

    const stale: OpenStackProjectQuota = getOpenStackProjectQuotas(
      reading(OPENSTACK_QUOTA_STALE_MINUTES + 1),
      NOW,
    )[0]!;

    expect(stale.isStale).toBe(true);
    expect(stale.isAtLine).toBe(false);
  });
});

describe("what is not a whole reading on a row is left out, not guessed", () => {
  test.each([
    ["no used", { limit: 4, observedAt: new Date().toISOString() }],
    ["no limit", { used: 4, observedAt: new Date().toISOString() }],
    ["text for a number", { used: "4", limit: "4" }],
    ["not an object", 4],
    ["a list", [4, 4]],
    ["null", null],
  ])("%s", (_name: string, value: unknown) => {
    expect(
      getOpenStackProjectQuotas(
        {
          [getOpenStackQuotaFactKey(
            OpenStackQuotaResource.Instances,
            "RegionOne",
          )]: value as JSONObject,
        },
        NOW,
      ),
    ).toEqual([]);
  });

  test("a resource this does not know, or a key with no region", () => {
    expect(
      getOpenStackProjectQuotas(
        {
          "quota:bananas:RegionOne": { used: 1, limit: 2 },
          "quota:instances": { used: 1, limit: 2 },
          domainId: "default",
        },
        NOW,
      ),
    ).toEqual([]);
  });

  test("a row with no facts at all", () => {
    expect(getOpenStackProjectQuotas(undefined, NOW)).toEqual([]);
    expect(getOpenStackProjectQuotas(null, NOW)).toEqual([]);
  });

  test("a region whose name holds a colon stays whole", () => {
    const facts: JSONObject = {
      [getOpenStackQuotaFactKey(OpenStackQuotaResource.Cores, "eu:west")]: {
        used: 1,
        limit: 2,
        observedAt: NOW.toISOString(),
      },
    };

    expect(getOpenStackProjectQuotas(facts, NOW)[0]?.regionName).toBe(
      "eu:west",
    );
  });
});

describe("which pool holds a volume", () => {
  const volume: (labels: Record<string, string>) => JSONObject = (
    labels: Record<string, string>,
  ): JSONObject => {
    const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();
    bufferOpenStackSnapshotMetric({
      metricName: "openstack_cinder_volume_gb",
      datapoint: point({
        labels: {
          id: "22222222-2222-4222-8222-222222222222",
          name: "ou-data",
          status: "in-use",
          tenant_id: PROJECT,
          server_id: "11111111-1111-4111-8111-111111111111",
          "openstack.region.name": "RegionOne",
          ...labels,
        },
        value: 10,
      }),
      buffer,
    });
    return Array.from(buffer.values())[0]!.facts;
  };

  test("the exporter does not say, so the row does not either", () => {
    expect(volume({})["pool"]).toBeUndefined();
    expect(volume({})["attachedToInstance"]).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  test("a source that names one is believed, in Cinder's own spelling of a pool", () => {
    expect(volume({ pool: "cinder-1@lvm#lvm" })["pool"]).toBe(
      "cinder-1@lvm#lvm",
    );
  });
});

describe("Nova metadata an operator chose to see", () => {
  const server: (labels: Record<string, string>) => JSONObject = (
    labels: Record<string, string>,
  ): JSONObject => {
    const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();
    bufferOpenStackSnapshotMetric({
      metricName: "openstack_nova_server_status",
      datapoint: point({
        labels: {
          id: "11111111-1111-4111-8111-111111111111",
          uuid: "11111111-1111-4111-8111-111111111111",
          name: "ou-running",
          status: "ACTIVE",
          tenant_id: PROJECT,
          user_id: "u",
          host_id: "h",
          hypervisor_hostname: "compute-1",
          availability_zone: "nova",
          flavor_id: "f",
          instance_libvirt: "instance-1",
          address_ipv4: "",
          address_ipv6: "",
          openstack_service: "compute",
          "openstack.region.name": "RegionOne",
          ...labels,
        },
        value: 0,
      }),
      buffer,
    });
    return Array.from(buffer.values())[0]!.facts;
  };

  test("what the exporter says by itself is no label", () => {
    expect(server({})["labels"]).toEqual({});
  });

  test("what the flag adds is, under the name the operator gave it", () => {
    expect(
      server({ team: "payments", owner: "ou-payments" })["labels"],
    ).toEqual({
      team: "payments",
      owner: "ou-payments",
    });
  });

  test("an instance without the key has no such label", () => {
    expect(server({ team: "" })["labels"]).toEqual({});
  });
});
