import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import {
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  isOpenStackSnapshotDatapoint,
} from "../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_ROOT_ID,
  buildOpenStackTopology,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/Builders/OpenStackTopology";
import {
  ResourceTopologyGraph,
  ResourceTopologyNode,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";

/*
 * The map, on what real clouds' exporters said (Tests/Fixtures/OpenStack), through the
 * scan ingest runs. The estate is in Tests/Ops/openstack-e2e/estate.sh: ou-payments and
 * ou-research, instances running, stopped and failed, a router and floating IPs. The
 * drill the issue is written around is the recording `compute-down`.
 */

const FIXTURES: string = path.join(__dirname, "../../Fixtures/OpenStack");
const OBSERVED_AT_MS: number = 1793785799000;
const NOW: Date = new Date(OBSERVED_AT_MS + 60 * 1000);

interface Series {
  name: string;
  labels: Record<string, string>;
  value: number;
}

// Prometheus' text format: a tenant's label can hold anything, so this reads escapes.
function parse(text: string): Array<Series> {
  const series: Array<Series> = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) {
      continue;
    }
    const labelsAt: number = line.indexOf("{");
    const valueAt: number = line.lastIndexOf(" ");
    const labels: Record<string, string> = {};
    if (labelsAt >= 0) {
      let at: number = labelsAt + 1;
      while (at < line.length && line[at] !== "}") {
        const equals: number = line.indexOf("=", at);
        const key: string = line.substring(at, equals);
        at = equals + 2;
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
        at += 1;
        if (line[at] === ",") {
          at += 1;
        }
      }
    }
    series.push({
      name: line.substring(0, labelsAt >= 0 ? labelsAt : valueAt),
      labels,
      value: Number.parseFloat(line.substring(valueAt + 1)),
    });
  }
  return series;
}

function rowsOf(scene: string): Array<OpenStackResource> {
  const folder: string = path.join(FIXTURES, scene, "exporter");
  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();

  for (const file of fs.readdirSync(folder).sort()) {
    if (!file.endsWith(".prom")) {
      continue;
    }
    for (const series of parse(
      fs.readFileSync(path.join(folder, file), "utf8"),
    )) {
      const attributes: JSONArray = Object.keys(series.labels).map(
        (key: string): JSONObject => {
          return { key, value: { stringValue: series.labels[key] as string } };
        },
      );
      attributes.push({
        key: "openstack.region.name",
        value: { stringValue: "RegionOne" },
      });
      const datapoint: JSONObject = {
        attributes,
        timeUnixNano: `${OBSERVED_AT_MS}000000`,
        asDouble: series.value,
      };
      if (
        isOpenStackSnapshotDatapoint({ metricName: series.name, datapoint })
      ) {
        bufferOpenStackSnapshotMetric({
          metricName: series.name,
          datapoint,
          buffer,
        });
      }
    }
  }

  return finishOpenStackBatch(buffer.values()).map(
    (entry: OpenStackResourceBufferEntry): OpenStackResource => {
      return Object.assign(new OpenStackResource(), {
        kind: entry.kind,
        externalId: entry.externalId,
        name: entry.name ?? undefined,
        regionName: entry.regionName ?? undefined,
        availabilityZone: entry.availabilityZone ?? undefined,
        hypervisorName: entry.hypervisorName ?? undefined,
        openStackProjectId: entry.openStackProjectId ?? undefined,
        status: entry.status ?? undefined,
        adminState: entry.adminState ?? undefined,
        disabledReason: entry.disabledReason ?? undefined,
        vcpuCapacity: entry.vcpuCapacity ?? undefined,
        vcpuAllocated: entry.vcpuAllocated ?? undefined,
        instanceCount: entry.instanceCount ?? undefined,
        facts: entry.facts,
        lastSeenAt: new Date(OBSERVED_AT_MS),
      });
    },
  );
}

function mapOf(scene: string): {
  rows: Array<OpenStackResource>;
  graph: ResourceTopologyGraph;
} {
  const rows: Array<OpenStackResource> = rowsOf(scene);
  const projectNames: Record<string, string> = {};
  for (const row of rows) {
    if (row.kind === OpenStackResourceKind.Project && row.name) {
      projectNames[row.externalId || ""] = row.name;
    }
  }
  return {
    rows,
    graph: buildOpenStackTopology({
      cloud: {
        id: "71000000-0000-4000-8000-000000000001",
        name: "devstack",
        lastSeenAt: new Date(OBSERVED_AT_MS),
      },
      rows,
      projectNames,
      now: NOW,
    }),
  };
}

function ofKind(
  graph: ResourceTopologyGraph,
  kind: string,
): Array<ResourceTopologyNode> {
  return Array.from(graph.nodes.values()).filter(
    (part: ResourceTopologyNode) => {
      return part.kind === kind;
    },
  );
}

function named(
  graph: ResourceTopologyGraph,
  kind: string,
  name: string,
): ResourceTopologyNode {
  const found: ResourceTopologyNode | undefined = ofKind(graph, kind).find(
    (part: ResourceTopologyNode) => {
      return part.name === name;
    },
  );
  if (!found) {
    throw new Error(`No ${kind} named ${name}`);
  }
  return found;
}

describe.each([
  "gazpacho-ovs/healthy",
  "gazpacho-ovn/healthy",
  "epoxy-ovn/healthy",
  "flamingo-ovn/healthy",
  "hibiscus-ovn/healthy",
])("a healthy cloud on %s", (scene: string) => {
  const { graph } = mapOf(scene);

  test("cloud, region, zone, hypervisor, instance", () => {
    const running: ResourceTopologyNode = named(
      graph,
      "openstack.instance",
      "ou-running",
    );
    const host: ResourceTopologyNode = graph.nodes.get(running.parentId!)!;
    const zone: ResourceTopologyNode = graph.nodes.get(host.parentId!)!;
    const region: ResourceTopologyNode = graph.nodes.get(zone.parentId!)!;

    expect(host.kind).toBe("openstack.hypervisor");
    expect(zone.kind).toBe("openstack.az");
    expect(region.kind).toBe("openstack.region");
    expect(region.parentId).toBe(OPENSTACK_ROOT_ID);
  });

  test("an instance that failed before it was placed still has a place", () => {
    const failed: ResourceTopologyNode = named(
      graph,
      "openstack.instance",
      "ou-failed",
    );

    expect(failed.effectiveHealth).toBe("warning");
    expect(failed.parentId).not.toBe(OPENSTACK_ROOT_ID);
  });

  test("one stopped on purpose is off, not a problem", () => {
    expect(
      named(graph, "openstack.instance", "ou-stopped").effectiveHealth,
    ).toBe("off");
  });

  test("every instance says whose it is, by name", () => {
    expect(
      named(graph, "openstack.instance", "ou-running").facts?.[0]?.value,
    ).toBe("ou-payments");
    expect(
      named(graph, "openstack.instance", "ou-research-1").facts?.[0]?.value,
    ).toBe("ou-research");
  });

  test("the floating IP in use hangs off the router, off the external network", () => {
    const router: ResourceTopologyNode = named(
      graph,
      "openstack.router",
      "ou-router",
    );

    expect(graph.nodes.get(router.parentId!)?.kind).toBe("openstack.network");
    expect(graph.nodes.get(router.parentId!)?.name).toBe("public");

    const carried: Array<string> = ofKind(graph, "openstack.floatingip")
      .filter((part: ResourceTopologyNode) => {
        return part.parentId === router.id;
      })
      .map((part: ResourceTopologyNode) => {
        return part.id;
      });

    expect(carried).toHaveLength(1);
  });

  test("a subnet stands on its network", () => {
    expect(
      graph.nodes.get(named(graph, "openstack.subnet", "ou-subnet").parentId!)
        ?.name,
    ).toBe("ou-net");
  });

  test("nothing is left hanging off the cloud but its region", () => {
    for (const part of graph.nodes.values()) {
      if (part.parentId === OPENSTACK_ROOT_ID) {
        expect(part.kind).toBe("openstack.region");
      }
    }
  });
});

describe("the attached volume on a recording with Cinder", () => {
  const { graph } = mapOf("gazpacho-ovs/healthy");

  test("stands under the instance it is attached to", () => {
    const volume: ResourceTopologyNode = named(
      graph,
      "openstack.volume",
      "ou-vol-used",
    );

    expect(graph.nodes.get(volume.parentId!)?.name).toBe("ou-running");
  });

  test("and one attached to nothing stands in storage", () => {
    const volume: ResourceTopologyNode = named(
      graph,
      "openstack.volume",
      "ou-vol-free",
    );

    expect(graph.nodes.get(volume.parentId!)?.isSection).toBe(true);
  });

  test("a volume in error needs a look", () => {
    expect(named(graph, "openstack.volume", "ou-vol-bad").effectiveHealth).toBe(
      "warning",
    );
  });
});

describe("the drill: a compute service stopped on a real cloud", () => {
  const { graph, rows } = mapOf("gazpacho-ovs/compute-down");

  test("draws that host red", () => {
    const hosts: Array<ResourceTopologyNode> = ofKind(
      graph,
      "openstack.hypervisor",
    );

    expect(hosts.length).toBeGreaterThan(0);
    expect(
      hosts.some((host: ResourceTopologyNode): boolean => {
        return host.effectiveHealth === "critical";
      }),
    ).toBe(true);
  });

  test("with its instances beneath it, of both projects", () => {
    const host: ResourceTopologyNode = ofKind(
      graph,
      "openstack.hypervisor",
    ).find((part: ResourceTopologyNode) => {
      return part.effectiveHealth === "critical";
    })!;
    const owners: Set<string> = new Set<string>();
    for (const id of host.childIds) {
      const child: ResourceTopologyNode = graph.nodes.get(id)!;
      if (child.kind === "openstack.instance") {
        owners.add(child.facts?.[0]?.value || "");
      }
    }

    expect(owners.has("ou-payments")).toBe(true);
    expect(owners.has("ou-research")).toBe(true);
  });

  test("says how many it held", () => {
    const host: ResourceTopologyNode = ofKind(
      graph,
      "openstack.hypervisor",
    ).find((part: ResourceTopologyNode) => {
      return part.effectiveHealth === "critical";
    })!;
    const held: number = rows.filter((row: OpenStackResource) => {
      return (
        row.kind === OpenStackResourceKind.Instance &&
        row.hypervisorName === host.name
      );
    }).length;

    expect(held).toBeGreaterThan(0);
    expect(host.reasons?.length).toBeGreaterThan(0);
  });
});

describe("planned work on a real cloud", () => {
  const { graph } = mapOf("gazpacho-ovs/compute-disabled");

  test("a compute service disabled on purpose raises nothing on the host", () => {
    for (const host of ofKind(graph, "openstack.hypervisor")) {
      expect(host.effectiveHealth).not.toBe("critical");
    }
  });
});
