import fs from "fs";
import path from "path";
import OpenStackResource from "../../../../Models/DatabaseModels/OpenStackResource";
import {
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  isOpenStackSnapshotDatapoint,
} from "../../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  getOpenStackShortHostName,
  isOpenStackFloatingIpAssociated,
} from "../../../../Types/OpenStack/OpenStackHealthRules";
import { OpenStackResourceKind } from "../../../../Types/OpenStack/OpenStackResourceKind";
import {
  getOpenStackAttentionItems,
  getOpenStackHealth,
} from "../../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackHealth";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceHealth,
} from "../../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";

/*
 * The scan and the health rules, on what real clouds said.
 *
 * Tests/Ops/openstack-e2e deploys OpenStack, builds a known estate, breaks it one way
 * at a time and records what the agent's exporter answers. Those answers are in
 * Tests/Fixtures/OpenStack, and every scene here asserts what the estate and the
 * failure should make the product say. This is where a guess about OpenStack gets
 * caught: the short and full host names, the floating IP labels and the 12-minute
 * service timeout were all found this way, and none would have failed a mock.
 *
 * The estate is in Tests/Ops/openstack-e2e/estate.sh.
 */

const FIXTURES: string = path.join(__dirname, "../../../Fixtures/OpenStack");
const OBSERVED_AT_MS: number = 1793785799000;
const NOW: Date = new Date(OBSERVED_AT_MS + 60 * 1000);

const CRITICAL: ResourceAttentionSeverity = ResourceAttentionSeverity.Critical;
const WARNING: ResourceAttentionSeverity = ResourceAttentionSeverity.Warning;

interface Series {
  name: string;
  labels: Record<string, string>;
  value: number;
}

/*
 * Prometheus' text format. A label value can hold anything a tenant typed, so this
 * reads escapes rather than splitting on commas.
 */
function parsePrometheusText(text: string): Array<Series> {
  const series: Array<Series> = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) {
      continue;
    }
    const labelsAt: number = line.indexOf("{");
    const valueAt: number = line.lastIndexOf(" ");
    if (labelsAt < 0) {
      series.push({
        name: line.substring(0, valueAt),
        labels: {},
        value: Number.parseFloat(line.substring(valueAt + 1)),
      });
      continue;
    }

    const labels: Record<string, string> = {};
    let at: number = labelsAt + 1;
    while (at < line.length && line[at] !== "}") {
      const equals: number = line.indexOf("=", at);
      const key: string = line.substring(at, equals);
      at = equals + 2; // Past the = and the opening quote.
      let value: string = "";
      while (line[at] !== '"') {
        if (line[at] === "\\") {
          at += 1;
          value += line[at] === "n" ? "\n" : line[at];
        } else {
          value += line[at];
        }
        at += 1;
      }
      labels[key] = value;
      at += 1; // Past the closing quote.
      if (line[at] === ",") {
        at += 1;
      }
    }
    series.push({
      name: line.substring(0, labelsAt),
      labels,
      value: Number.parseFloat(line.substring(valueAt + 1)),
    });
  }
  return series;
}

function readSeries(folder: string): Array<Series> {
  const series: Array<Series> = [];
  for (const file of fs.readdirSync(folder).sort()) {
    if (file.endsWith(".prom")) {
      series.push(
        ...parsePrometheusText(
          fs.readFileSync(path.join(folder, file), "utf8"),
        ),
      );
    }
  }
  return series;
}

// What the agent's collector turns a series into before it reaches OneUptime.
function toDatapoint(series: Series): JSONObject {
  const attributes: JSONArray = Object.keys(series.labels).map(
    (key: string): JSONObject => {
      return { key, value: { stringValue: series.labels[key] as string } };
    },
  );
  attributes.push({
    key: "openstack.region.name",
    value: { stringValue: "RegionOne" },
  });
  return {
    attributes,
    timeUnixNano: `${OBSERVED_AT_MS}000000`,
    asDouble: series.value,
  };
}

function toRow(entry: OpenStackResourceBufferEntry): OpenStackResource {
  const row: OpenStackResource = new OpenStackResource();
  row.kind = entry.kind;
  row.externalId = entry.externalId;
  row.name = entry.name || undefined;
  row.regionName = entry.regionName || undefined;
  row.availabilityZone = entry.availabilityZone || undefined;
  row.hypervisorName = entry.hypervisorName || undefined;
  row.openStackProjectId = entry.openStackProjectId || undefined;
  row.status = entry.status || undefined;
  row.adminState = entry.adminState || undefined;
  row.disabledReason = entry.disabledReason || undefined;
  row.vcpuCapacity = entry.vcpuCapacity ?? undefined;
  row.vcpuAllocated = entry.vcpuAllocated ?? undefined;
  row.memoryCapacityBytes = entry.memoryCapacityBytes ?? undefined;
  row.memoryAllocatedBytes = entry.memoryAllocatedBytes ?? undefined;
  row.diskCapacityBytes = entry.diskCapacityBytes ?? undefined;
  row.diskAllocatedBytes = entry.diskAllocatedBytes ?? undefined;
  row.instanceCount = entry.instanceCount ?? undefined;
  row.facts = entry.facts;
  return row;
}

class Scene {
  public readonly series: Array<Series>;
  public readonly rows: Array<OpenStackResource>;

  public constructor(folder: string) {
    this.series = readSeries(folder);
    const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();
    for (const series of this.series) {
      const datapoint: JSONObject = toDatapoint(series);
      if (isOpenStackSnapshotDatapoint({ metricName: series.name, datapoint })) {
        bufferOpenStackSnapshotMetric({
          metricName: series.name,
          datapoint,
          buffer,
        });
      }
    }
    this.rows = finishOpenStackBatch(buffer.values()).map(toRow);
  }

  public ofKind(kind: OpenStackResourceKind): Array<OpenStackResource> {
    return this.rows.filter((row: OpenStackResource) => {
      return row.kind === kind;
    });
  }

  public named(kind: OpenStackResourceKind, name: string): OpenStackResource {
    const found: OpenStackResource | undefined = this.ofKind(kind).find(
      (row: OpenStackResource) => {
        return row.name === name;
      },
    );
    if (!found) {
      throw new Error(
        `No ${kind} named ${name}. There are: ${this.ofKind(kind)
          .map((row: OpenStackResource) => {
            return row.name;
          })
          .join(", ")}`,
      );
    }
    return found;
  }

  public attention(): Array<ResourceAttentionItem> {
    return getOpenStackAttentionItems({ rows: this.rows, now: NOW });
  }

  public critical(): Array<ResourceAttentionItem> {
    return this.attention().filter((item: ResourceAttentionItem) => {
      return item.severity === CRITICAL;
    });
  }

  public health(): ResourceHealth {
    return getOpenStackHealth(this.attention());
  }

  public seriesNamed(name: string): Array<Series> {
    return this.series.filter((series: Series) => {
      return series.name === name;
    });
  }
}

function sceneOf(release: string, scene: string, folder: string): Scene {
  return new Scene(path.join(FIXTURES, release, scene, folder));
}

function hasScene(release: string, scene: string): boolean {
  return fs.existsSync(path.join(FIXTURES, release, scene, "exporter"));
}

const RELEASES: Array<string> = fs
  .readdirSync(FIXTURES)
  .filter((entry: string) => {
    return hasScene(entry, "healthy");
  })
  .sort();

// The releases recorded through every failure, and not only when healthy.
const DRILLED_RELEASES: Array<string> = RELEASES.filter((release: string) => {
  return hasScene(release, "compute-down");
});

function namesIn(items: Array<ResourceAttentionItem>): Array<string> {
  return items
    .map((item: ResourceAttentionItem) => {
      return item.name;
    })
    .sort();
}

test("recordings of a healthy cloud exist, from more than one release", () => {
  expect(RELEASES.length).toBeGreaterThan(1);
  expect(DRILLED_RELEASES.length).toBeGreaterThan(0);
  expect(DRILLED_RELEASES).toContain("gazpacho-ovs");
});

describe.each(RELEASES)("a healthy cloud, on %s", (release: string) => {
  const scene: Scene = sceneOf(release, "healthy", "exporter");

  test("every API answers", () => {
    const names: Array<string | undefined> = scene
      .ofKind(OpenStackResourceKind.Api)
      .map((row: OpenStackResource) => {
        return row.name;
      })
      .sort();
    expect(names).toEqual([
      "compute",
      "identity",
      "image",
      "network",
      "placement",
      "volume",
    ]);
    for (const row of scene.ofKind(OpenStackResourceKind.Api)) {
      expect(row.status).toBe("up");
      expect(row.regionName).toBe("RegionOne");
      expect(row.facts?.["vouchedAt"]).toBeTruthy();
    }
  });

  test("every worker is up and enabled, in its own service's words", () => {
    const workers: Array<OpenStackResource> = scene.ofKind(
      OpenStackResourceKind.Service,
    );
    expect(workers.length).toBeGreaterThan(5);
    for (const row of workers) {
      expect(row.status).toBe("up");
      expect(["enabled", "up"]).toContain(row.adminState);
    }
    expect(
      scene.named(OpenStackResourceKind.Service, "nova-compute").adminState,
    ).toBe("enabled");
    expect(
      scene.named(OpenStackResourceKind.Service, "cinder-volume").adminState,
    ).toBe("enabled");
    const neutronAgents: Array<OpenStackResource> = workers.filter(
      (row: OpenStackResource) => {
        return row.facts?.["family"] === "network";
      },
    );
    expect(neutronAgents.length).toBeGreaterThan(0);
    for (const agent of neutronAgents) {
      expect(agent.adminState).toBe("up");
    }
  });

  test("a hypervisor's capacity is what Placement will promise", () => {
    const hypervisors: Array<OpenStackResource> = scene.ofKind(
      OpenStackResourceKind.Hypervisor,
    );
    expect(hypervisors).toHaveLength(1);
    const hypervisor: OpenStackResource = hypervisors[0]!;
    // Nova's hypervisor series say neither of these: its nova-compute does.
    expect(hypervisor.status).toBe("up");
    expect(hypervisor.adminState).toBe("enabled");
    expect(hypervisor.availabilityZone).toBe("nova");

    const reading = (metric: string, resource: string): number => {
      const found: Series | undefined = scene
        .seriesNamed(`openstack_placement_resource_${metric}`)
        .find((series: Series) => {
          return series.labels["resourcetype"] === resource;
        });
      expect(found).toBeDefined();
      return found!.value;
    };
    const capacity = (resource: string): number => {
      return (
        (reading("total", resource) - reading("reserved", resource)) *
        reading("allocation_ratio", resource)
      );
    };

    expect(hypervisor.vcpuCapacity).toBe(capacity("VCPU"));
    // A ratio over 1 is the point: this is not the host's own count of vCPUs.
    expect(reading("allocation_ratio", "VCPU")).toBeGreaterThan(1);
    expect(hypervisor.vcpuAllocated).toBe(reading("usage", "VCPU"));
    expect(hypervisor.memoryCapacityBytes).toBe(
      capacity("MEMORY_MB") * 1024 * 1024,
    );
    expect(hypervisor.memoryAllocatedBytes).toBe(
      reading("usage", "MEMORY_MB") * 1024 * 1024,
    );
    expect(hypervisor.diskCapacityBytes).toBe(
      capacity("DISK_GB") * 1024 * 1024 * 1024,
    );
    expect(hypervisor.facts?.["allocationRatios"]).toEqual({
      VCPU: reading("allocation_ratio", "VCPU"),
      MEMORY_MB: reading("allocation_ratio", "MEMORY_MB"),
      DISK_GB: reading("allocation_ratio", "DISK_GB"),
    });
    expect(hypervisor.instanceCount).toBeGreaterThan(0);
  });

  test("Nova's short host name and its hypervisor's full one are one machine", () => {
    const compute: OpenStackResource = scene.named(
      OpenStackResourceKind.Service,
      "nova-compute",
    );
    const hypervisor: OpenStackResource = scene.ofKind(
      OpenStackResourceKind.Hypervisor,
    )[0]!;
    expect(compute.facts?.["host"]).not.toEqual(hypervisor.hypervisorName);
    expect(getOpenStackShortHostName(hypervisor.hypervisorName)).toBe(
      compute.facts?.["host"],
    );
  });

  test("every instance of the estate reads as it was left", () => {
    const running: OpenStackResource = scene.named(
      OpenStackResourceKind.Instance,
      "ou-running",
    );
    const stopped: OpenStackResource = scene.named(
      OpenStackResourceKind.Instance,
      "ou-stopped",
    );
    const failed: OpenStackResource = scene.named(
      OpenStackResourceKind.Instance,
      "ou-failed",
    );
    const research: OpenStackResource = scene.named(
      OpenStackResourceKind.Instance,
      "ou-research-1",
    );
    expect(running.status).toBe("ACTIVE");
    expect(stopped.status).toBe("SHUTOFF");
    expect(failed.status).toBe("ERROR");
    expect(research.status).toBe("ACTIVE");

    // Placed, and named as the hypervisor is, so the two join.
    const hypervisor: OpenStackResource = scene.ofKind(
      OpenStackResourceKind.Hypervisor,
    )[0]!;
    expect(running.hypervisorName).toBe(hypervisor.hypervisorName);
    // One that never found a host says nothing about where it is.
    expect(failed.hypervisorName).toBeUndefined();

    expect(running.availabilityZone).toBe("nova");
    expect(running.facts?.["libvirtName"]).toMatch(/^instance-/);
    expect(running.openStackProjectId).toBeTruthy();
    expect(research.openStackProjectId).not.toEqual(running.openStackProjectId);
    expect(running.openStackProjectId).toBe(failed.openStackProjectId);
  });

  test("a flavor is sized in bytes, from Nova's MiB and GiB", () => {
    const flavor: OpenStackResource = scene.named(
      OpenStackResourceKind.Flavor,
      "ou.tiny",
    );
    expect(flavor.vcpuCapacity).toBe(1);
    expect(flavor.memoryCapacityBytes).toBe(128 * 1024 * 1024);
    expect(flavor.diskCapacityBytes).toBe(1024 * 1024 * 1024);
  });

  test("networks know what is external, and how many addresses are left", () => {
    const external: OpenStackResource = scene.named(
      OpenStackResourceKind.Network,
      "public",
    );
    expect(external.facts?.["isExternal"]).toBe(true);
    expect(external.facts?.["ipsTotal"]).toBeGreaterThan(0);
    expect(external.facts?.["ipsUsed"]).toBeGreaterThan(0);
    expect(external.status).toBe("ACTIVE");

    const tenant: OpenStackResource = scene.named(
      OpenStackResourceKind.Network,
      "ou-net",
    );
    expect(tenant.facts?.["isExternal"]).toBe(false);
    expect(Object.values(tenant.facts?.["ipsBySubnet"] as JSONObject)).toEqual([
      expect.objectContaining({ cidr: "10.77.0.0/24" }),
    ]);
  });

  /*
   * The alert templates read IPv4 alone, because a /64 is 2^64 addresses: added to one, a
   * full IPv4 pool reads as 0%. The real `public` network is dual-stack, so the rule and
   * the page have to read the same pool the template does, or it never needs anyone.
   */
  test("an external network's addresses are its IPv4 pool, not its /64 too", () => {
    const external: OpenStackResource = scene.named(
      OpenStackResourceKind.Network,
      "public",
    );
    const subnets: Array<JSONObject> = Object.values(
      external.facts?.["ipsBySubnet"] as JSONObject,
    ) as Array<JSONObject>;
    const ipv4: Array<JSONObject> = subnets.filter((subnet: JSONObject) => {
      return subnet["ipVersion"] === "4";
    });
    expect(ipv4.length).toBeGreaterThan(0);
    expect(external.facts?.["ipsTotal"]).toBe(
      ipv4.reduce((sum: number, subnet: JSONObject) => {
        return sum + (subnet["total"] as number);
      }, 0),
    );
    expect(external.facts?.["ipsUsed"]).toBe(
      ipv4.reduce((sum: number, subnet: JSONObject) => {
        return sum + (subnet["used"] as number);
      }, 0),
    );
  });

  test("the router and subnets of the estate are there", () => {
    const router: OpenStackResource = scene.named(
      OpenStackResourceKind.Router,
      "ou-router",
    );
    expect(router.status).toBe("ACTIVE");
    expect(router.adminState).toBe("up");
    expect(router.facts?.["externalNetworkId"]).toBeTruthy();

    const subnet: OpenStackResource = scene.named(
      OpenStackResourceKind.Subnet,
      "ou-subnet",
    );
    expect(subnet.facts?.["cidr"]).toBe("10.77.0.0/24");
  });

  test("a floating IP in use is told from a spare one", () => {
    const addresses: Array<OpenStackResource> = scene.ofKind(
      OpenStackResourceKind.FloatingIp,
    );
    expect(addresses).toHaveLength(2);
    const inUse: Array<OpenStackResource> = addresses.filter(
      (row: OpenStackResource) => {
        return isOpenStackFloatingIpAssociated(row.facts as JSONObject);
      },
    );
    expect(inUse).toHaveLength(1);
    expect(inUse[0]?.status).toBe("ACTIVE");
    const spare: OpenStackResource | undefined = addresses.find(
      (row: OpenStackResource) => {
        return !isOpenStackFloatingIpAssociated(row.facts as JSONObject);
      },
    );
    expect(spare?.status).toBe("DOWN");
  });

  test("volumes read as they were left, and know what holds them", () => {
    expect(
      scene.named(OpenStackResourceKind.Volume, "ou-vol-free").status,
    ).toBe("available");
    expect(scene.named(OpenStackResourceKind.Volume, "ou-vol-bad").status).toBe(
      "error",
    );
    const used: OpenStackResource = scene.named(
      OpenStackResourceKind.Volume,
      "ou-vol-used",
    );
    expect(used.status).toBe("in-use");
    expect(used.diskCapacityBytes).toBe(1024 * 1024 * 1024);
    expect(used.facts?.["attachedToInstance"]).toBe(
      scene.named(OpenStackResourceKind.Instance, "ou-running").externalId,
    );
  });

  /*
   * The exporter counts snapshots and names none: the pinned image has no per-snapshot
   * series, whatever its source says. Per-item status comes from the probe.
   */
  test("snapshots are a count, not rows", () => {
    expect(scene.ofKind(OpenStackResourceKind.Snapshot)).toEqual([]);
    expect(scene.seriesNamed("openstack_cinder_snapshots")[0]?.value).toBe(1);
  });

  test("a storage pool reads its capacity and what is used", () => {
    const pools: Array<OpenStackResource> = scene.ofKind(
      OpenStackResourceKind.StoragePool,
    );
    expect(pools.length).toBeGreaterThan(0);
    for (const pool of pools) {
      expect(pool.diskCapacityBytes).toBeGreaterThan(0);
      expect(pool.diskAllocatedBytes).toBeGreaterThanOrEqual(0);
      expect(pool.diskAllocatedBytes).toBeLessThanOrEqual(
        pool.diskCapacityBytes!,
      );
    }
  });

  test("images are there, with the agent's own flags", () => {
    const images: Array<OpenStackResource> = scene.ofKind(
      OpenStackResourceKind.Image,
    );
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(image.diskCapacityBytes).toBeGreaterThan(0);
      expect(image.status).toBe("active");
      expect(image.facts?.["visibility"]).toBe("public");
    }
  });

  test("Projects and the domain are named, and carry no region", () => {
    const project: OpenStackResource = scene.named(
      OpenStackResourceKind.Project,
      "ou-payments",
    );
    expect(project.status).toBe("enabled");
    expect(project.regionName).toBeUndefined();
    expect(project.facts?.["domainId"]).toBe("default");
    scene.named(OpenStackResourceKind.Project, "ou-research");
    expect(scene.named(OpenStackResourceKind.Domain, "Default").status).toBe(
      "enabled",
    );
  });

  test("only what the estate broke on purpose needs attention", () => {
    expect(namesIn(scene.attention())).toEqual(["ou-failed", "ou-vol-bad"]);
    for (const item of scene.attention()) {
      expect(item.severity).toBe(WARNING);
    }
    expect(scene.health()).toBe("Degraded");
  });
});

describe.each(DRILLED_RELEASES)("a failure, on %s", (release: string) => {
  const healthy: Scene = sceneOf(release, "healthy", "exporter");
  const newlyWrong = (scene: Scene): Array<string> => {
    const before: Array<string> = namesIn(healthy.attention());
    return namesIn(scene.attention()).filter((name: string) => {
      return !before.includes(name);
    });
  };

  test("a compute service disabled on purpose is planned work", () => {
    const scene: Scene = sceneOf(release, "compute-disabled", "exporter");
    const compute: OpenStackResource = scene.named(
      OpenStackResourceKind.Service,
      "nova-compute",
    );
    expect(compute.adminState).toBe("disabled");
    expect(compute.disabledReason).toBe("OneUptime drill: planned maintenance");
    const hypervisor: OpenStackResource = scene.ofKind(
      OpenStackResourceKind.Hypervisor,
    )[0]!;
    expect(hypervisor.adminState).toBe("disabled");
    expect(hypervisor.disabledReason).toBe(
      "OneUptime drill: planned maintenance",
    );
    expect(newlyWrong(scene)).toEqual([]);
    expect(scene.critical()).toEqual([]);
  });

  test("a stopped nova-compute is critical, and says how many instances it held", () => {
    const scene: Scene = sceneOf(release, "compute-down", "exporter");
    const compute: OpenStackResource = scene.named(
      OpenStackResourceKind.Service,
      "nova-compute",
    );
    expect(compute.status).toBe("down");
    expect(compute.adminState).toBe("enabled");

    const items: Array<ResourceAttentionItem> = scene.critical();
    expect(namesIn(items)).toEqual(["nova-compute"]);
    const hypervisor: OpenStackResource = scene.ofKind(
      OpenStackResourceKind.Hypervisor,
    )[0]!;
    // Its numbers keep coming, as its last known ones, and it reads as lost.
    expect(hypervisor.status).toBe("down");
    expect(hypervisor.vcpuAllocated).toBeGreaterThan(0);
    expect(hypervisor.instanceCount).toBeGreaterThan(0);
    expect(items[0]?.reasons[0]?.values?.["count"]).toBe(
      `${hypervisor.instanceCount}`,
    );
    expect(scene.health()).toBe("Unhealthy");
  });

  test("a stopped Neutron agent is critical, by its name", () => {
    const scene: Scene = sceneOf(release, "network-agent-down", "exporter");
    const items: Array<ResourceAttentionItem> = scene.critical();
    expect(items.length).toBeGreaterThan(0);
    const down: Array<OpenStackResource> = scene
      .ofKind(OpenStackResourceKind.Service)
      .filter((row: OpenStackResource) => {
        return row.facts?.["family"] === "network" && row.status === "down";
      });
    expect(down.length).toBeGreaterThan(0);
    expect(namesIn(items)).toEqual(
      expect.arrayContaining(
        down.map((row: OpenStackResource) => {
          return row.name as string;
        }),
      ),
    );
  });

  test("a stopped cinder-volume is critical", () => {
    const scene: Scene = sceneOf(release, "volume-service-down", "exporter");
    expect(
      scene.named(OpenStackResourceKind.Service, "cinder-volume").status,
    ).toBe("down");
    expect(namesIn(scene.critical())).toContain("cinder-volume");
  });

  test("the only scheduler stopped is one thing that went wrong", () => {
    const scene: Scene = sceneOf(release, "scheduler-down", "exporter");
    expect(
      scene.named(OpenStackResourceKind.Service, "nova-scheduler").status,
    ).toBe("down");
    const items: Array<ResourceAttentionItem> = scene.critical();
    expect(namesIn(items)).toEqual(["nova-scheduler"]);
    expect(items[0]?.reasons[0]?.values?.["service"]).toBe("nova-scheduler");
  });

  /*
   * What a stopped API does to its series is what this recording is for. Everything
   * else keeps answering, so nothing else may change.
   */
  test("Nova's API stopped says so, and the other services are untouched", () => {
    const scene: Scene = sceneOf(release, "compute-api-down", "exporter");
    const apis: Map<string, string | undefined> = new Map(
      scene.ofKind(OpenStackResourceKind.Api).map((row: OpenStackResource) => {
        return [row.name as string, row.status];
      }),
    );
    expect(apis.get("compute")).toBe("down");
    expect(apis.get("identity")).toBe("up");
    expect(apis.get("network")).toBe("up");
    expect(apis.get("volume")).toBe("up");
    expect(apis.get("image")).toBe("up");
    expect(apis.get("placement")).toBe("up");
    expect(namesIn(scene.critical())).toEqual(["compute"]);

    // The stale-row rule reads this: a failing service is not a service whose parts are gone.
    const compute: OpenStackResource = scene.named(
      OpenStackResourceKind.Api,
      "compute",
    );
    expect(compute.facts?.["vouchedAt"]).toBeUndefined();
  });

  test("everything back on reads as it did before", () => {
    const scene: Scene = sceneOf(release, "recovered", "exporter");
    expect(namesIn(scene.attention())).toEqual(namesIn(healthy.attention()));
    expect(scene.health()).toBe(healthy.health());
  });
});

describe("a Neutron with L3 agents, on ML2/OVS", () => {
  const scene: Scene = sceneOf("gazpacho-ovs", "healthy", "exporter");

  test("each router names the agent that holds it", () => {
    const router: OpenStackResource = scene.named(
      OpenStackResourceKind.Router,
      "ou-router",
    );
    const agents: Array<JSONObject> = Object.values(
      router.facts?.["l3Agents"] as JSONObject,
    ) as Array<JSONObject>;
    expect(agents).toHaveLength(1);
    expect(agents[0]?.["isAlive"]).toBe(true);
    expect(agents[0]?.["isAdminUp"]).toBe(true);
    expect(agents[0]?.["host"]).toBe("compute-01");
  });

  test("it reports the agents OVN does not have", () => {
    const names: Array<string | undefined> = scene
      .ofKind(OpenStackResourceKind.Service)
      .filter((row: OpenStackResource) => {
        return row.facts?.["family"] === "network";
      })
      .map((row: OpenStackResource) => {
        return row.name;
      });
    expect(names).toEqual(
      expect.arrayContaining([
        "neutron-dhcp-agent",
        "neutron-l3-agent",
        "neutron-metadata-agent",
        "neutron-openvswitch-agent",
      ]),
    );
  });
});

describe("a Neutron on OVN", () => {
  const scene: Scene = sceneOf("hibiscus-ovn", "healthy", "exporter");

  test("no agent holds a router, and nothing is missing", () => {
    const router: OpenStackResource = scene.named(
      OpenStackResourceKind.Router,
      "ou-router",
    );
    expect(router.facts?.["l3Agents"]).toBeUndefined();
    expect(namesIn(scene.attention())).not.toContain("ou-router");
  });
});

/*
 * The exporter's last non-alpha release, which Kolla-Ansible pins. It says less, and
 * the product has to read what it does say rather than break on what it does not.
 */
describe.each(RELEASES)("the exporter's 1.7.0, on %s", (release: string) => {
  const scene: Scene = sceneOf(release, "healthy", "exporter-stable");

  test("reads as the same cloud, as far as it goes", () => {
    expect(scene.ofKind(OpenStackResourceKind.Instance).length).toBe(4);
    expect(
      scene.named(OpenStackResourceKind.Instance, "ou-failed").status,
    ).toBe("ERROR");
    expect(
      scene.named(OpenStackResourceKind.Service, "nova-compute").status,
    ).toBe("up");
    expect(namesIn(scene.critical())).toEqual([]);
  });
});

/*
 * The whole way: what the agent's real collector config exports, walked as ingest
 * walks it. This is the one place a change to the collector config can break the scan
 * without either's own tests noticing.
 */
describe.each(DRILLED_RELEASES)("what the collector exports, on %s", (release: string) => {
  const otlp: JSONObject = JSON.parse(
    fs.readFileSync(path.join(FIXTURES, release, "otlp.json"), "utf8"),
  ) as JSONObject;

  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();
  const resourceAttributes: Array<JSONObject> = [];
  for (const resourceMetrics of otlp["resourceMetrics"] as Array<JSONObject>) {
    resourceAttributes.push(
      ...(((resourceMetrics["resource"] as JSONObject)[
        "attributes"
      ] as Array<JSONObject>) || []),
    );
    for (const scope of resourceMetrics["scopeMetrics"] as Array<JSONObject>) {
      for (const metric of scope["metrics"] as Array<JSONObject>) {
        const data: JSONObject =
          (metric["gauge"] as JSONObject) ||
          (metric["sum"] as JSONObject) ||
          ({} as JSONObject);
        for (const datapoint of (data["dataPoints"] as Array<JSONObject>) ||
          []) {
          const metricName: string = metric["name"] as string;
          if (isOpenStackSnapshotDatapoint({ metricName, datapoint })) {
            bufferOpenStackSnapshotMetric({ metricName, datapoint, buffer });
          }
        }
      }
    }
  }
  const rows: Array<OpenStackResource> = finishOpenStackBatch(
    buffer.values(),
  ).map(toRow);

  const attribute = (key: string): JSONObject | undefined => {
    return resourceAttributes.find((candidate: JSONObject) => {
      return candidate["key"] === key;
    });
  };

  test("stamps the cloud and the agent's version on every export", () => {
    expect(attribute("openstack.cloud.name")?.["value"]).toEqual({
      stringValue: "devstack",
    });
    expect(attribute("oneuptime.agent.version")).toBeDefined();
    // Discovery is by the cloud's name, and these would make it a service's.
    expect(attribute("service.name")).toBeUndefined();
    expect(attribute("service.instance.id")).toBeUndefined();
  });

  test("says which region and service each read is from", () => {
    const apis: Array<OpenStackResource> = rows.filter(
      (row: OpenStackResource) => {
        return row.kind === OpenStackResourceKind.Api;
      },
    );
    expect(
      apis
        .map((row: OpenStackResource) => {
          return row.name;
        })
        .sort(),
    ).toEqual([
      "compute",
      "identity",
      "image",
      "network",
      "placement",
      "volume",
    ]);
    for (const api of apis) {
      expect(api.regionName).toBe("RegionOne");
      expect(api.status).toBe("up");
      expect(api.facts?.["scrapeFailed"]).toBe(false);
      expect(api.facts?.["vouchedAt"]).toBeTruthy();
    }
  });

  test("carries the estate", () => {
    const named = (kind: OpenStackResourceKind, name: string): boolean => {
      return rows.some((row: OpenStackResource) => {
        return row.kind === kind && row.name === name;
      });
    };
    expect(named(OpenStackResourceKind.Instance, "ou-running")).toBe(true);
    expect(named(OpenStackResourceKind.Volume, "ou-vol-used")).toBe(true);
    expect(named(OpenStackResourceKind.Network, "public")).toBe(true);
    expect(named(OpenStackResourceKind.Router, "ou-router")).toBe(true);
    expect(named(OpenStackResourceKind.Service, "nova-compute")).toBe(true);
    expect(named(OpenStackResourceKind.Project, "ou-payments")).toBe(true);
  });
});
