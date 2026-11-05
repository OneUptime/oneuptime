import {
  OpenStackResourceBufferEntry,
  OPENSTACK_SNAPSHOT_METRIC_NAMES,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  getOpenStackHostsToReconcile,
  isOpenStackSnapshotDatapoint,
} from "../../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONObject } from "../../../../Types/JSON";
import { readOpenStackInventories } from "../../../../Types/OpenStack/OpenStackCapacity";
import {
  OPENSTACK_KINDS_BY_SERVICE,
  OpenStackResourceKind,
  OpenStackServiceFamily,
  OpenStackServiceType,
} from "../../../../Types/OpenStack/OpenStackResourceKind";

/*
 * What no recording holds, on rows written by hand, and says so. A probe's native labels come from
 * Ironic's API as recorded in services-ironic/<scene>/api/ironic-nodes.json. Nova's hypervisor list
 * with a node in it is from its Ironic driver's source: DevStack mapped the host before any node
 * existed, so every recorded list is empty. What real clouds said is in
 * OpenStackBareMetalRecordings.test.ts.
 */

const NODE_ID: string = "1062b540-62b5-44a7-805f-212d8778807c";
const BASE_MS: number = 1793841200000;

type Buffer = Map<string, OpenStackResourceBufferEntry>;

function datapoint(
  value: number,
  labels: Record<string, string>,
  atMs: number = BASE_MS,
): JSONObject {
  return {
    asDouble: value,
    timeUnixNano: `${atMs}000000`,
    attributes: Object.entries({
      "openstack.region.name": "RegionOne",
      ...labels,
    }).map(([key, stringValue]: [string, string]) => {
      return { key, value: { stringValue } };
    }),
  } as unknown as JSONObject;
}

function scan(
  series: Array<[string, number, Record<string, string>]>,
  atMs?: number,
): Array<OpenStackResourceBufferEntry> {
  const buffer: Buffer = new Map();
  for (const [metricName, value, labels] of series) {
    const point: JSONObject = datapoint(value, labels, atMs);
    if (isOpenStackSnapshotDatapoint({ metricName, datapoint: point })) {
      bufferOpenStackSnapshotMetric({ metricName, datapoint: point, buffer });
    }
  }
  return finishOpenStackBatch(buffer.values());
}

function ofKind(
  entries: Array<OpenStackResourceBufferEntry>,
  kind: OpenStackResourceKind,
): Array<OpenStackResourceBufferEntry> {
  return entries.filter((entry: OpenStackResourceBufferEntry): boolean => {
    return entry.kind === kind;
  });
}

const EXPORTER_NODE: Record<string, string> = {
  id: NODE_ID,
  name: "node-1",
  provision_state: "clean failed",
  maintenance: "false",
  retired: "false",
  resource_class: "gold",
};

// As the probe sends it: the exporter's labels, and what only Ironic's API says.
const PROBE_NODE: Record<string, string> = {
  ...EXPORTER_NODE,
  driver: "ipmi",
  owner: "project-1",
  lessee: "project-2",
  instance_uuid: "instance-1",
  conductor: "conductor-1",
  conductor_group: "rack-a",
  fault: "clean failure",
  target_provision_state: "manageable",
  target_power_state: "power off",
  last_error: "the BMC would not answer",
};

describe("a node's row", () => {
  test("is keyed by its id, in whichever region said so", () => {
    const [node] = ofKind(
      scan([["openstack_ironic_node", 1, EXPORTER_NODE]]),
      OpenStackResourceKind.BareMetalNode,
    );

    expect(node?.externalId).toBe(NODE_ID);
    expect(node?.regionName).toBe("RegionOne");
    expect(node?.status).toBe("clean failed");
  });

  test("a node with no name still has a row: Ironic does not need one", () => {
    const [node] = ofKind(
      scan([
        [
          "openstack_ironic_node",
          1,
          { id: NODE_ID, provision_state: "enroll", maintenance: "false" },
        ],
      ]),
      OpenStackResourceKind.BareMetalNode,
    );

    expect(node?.name).toBe(null);
    expect(node?.externalId).toBe(NODE_ID);
  });

  test("a series with no id has nothing to be about", () => {
    expect(
      scan([["openstack_ironic_node", 1, { provision_state: "active" }]]),
    ).toEqual([]);
  });

  test("taking a node out of maintenance clears its reason, and writes that it did", () => {
    const [node] = ofKind(
      scan([["openstack_ironic_node", 1, EXPORTER_NODE]]),
      OpenStackResourceKind.BareMetalNode,
    );

    // bulkUpsert takes the reason whenever adminState is written, so this must be written too.
    expect(node?.adminState).toBe("in service");
    expect(node?.disabledReason).toBe(null);
  });

  test("a label that went away is written as gone: facts merge key by key", () => {
    const [node] = ofKind(
      scan([["openstack_ironic_node", 1, EXPORTER_NODE]]),
      OpenStackResourceKind.BareMetalNode,
    );

    expect(node?.facts).toMatchObject({
      powerState: null,
      retiredReason: null,
      isRetired: false,
    });
  });

  test("retired, with its reason", () => {
    const [node] = ofKind(
      scan([
        [
          "openstack_ironic_node",
          1,
          { ...EXPORTER_NODE, retired: "true", retired_reason: "end of lease" },
        ],
      ]),
      OpenStackResourceKind.BareMetalNode,
    );

    expect(node?.facts).toMatchObject({
      isRetired: true,
      retiredReason: "end of lease",
    });
  });

  test("Ironic's times are facts, and only a real time counts", () => {
    const [node] = ofKind(
      scan([
        ["openstack_ironic_node", 1, EXPORTER_NODE],
        [
          "openstack_ironic_node_provision_updated_at",
          1793840982,
          { id: NODE_ID, name: "node-1", provision_state: "clean failed" },
        ],
        [
          "openstack_ironic_node_updated_at",
          0,
          { id: NODE_ID, name: "node-1", provision_state: "clean failed" },
        ],
      ]),
      OpenStackResourceKind.BareMetalNode,
    );

    expect(node?.facts["provisionUpdatedAt"]).toBe(
      new Date(1793840982 * 1000).toISOString(),
    );
    expect(node?.facts).not.toHaveProperty("nodeUpdatedAt");
  });

  test("a batch cut between a node's series still has what each says", () => {
    /*
     * A collector can cut a scrape anywhere. Each series says its id, name and state, so a batch
     * holding only a node's time is still a row, and writes nothing of what it did not hear.
     */
    const [node] = ofKind(
      scan([
        [
          "openstack_ironic_node_updated_at",
          1793840982,
          { id: NODE_ID, name: "node-1", provision_state: "active" },
        ],
      ]),
      OpenStackResourceKind.BareMetalNode,
    );

    expect(node?.status).toBe("active");
    expect(node?.name).toBe("node-1");
    expect(node?.adminState).toBe(null);
    expect(node?.facts).not.toHaveProperty("powerState");
  });
});

describe("what only a probe says of a node, from Ironic's API", () => {
  const [node] = ofKind(
    scan([["openstack_ironic_node", 1, PROBE_NODE]]),
    OpenStackResourceKind.BareMetalNode,
  );

  test("reads every one", () => {
    expect(node?.openStackProjectId).toBe("project-1");
    expect(node?.facts).toMatchObject({
      driver: "ipmi",
      instanceId: "instance-1",
      lessee: "project-2",
      conductor: "conductor-1",
      conductorGroup: "rack-a",
      fault: "clean failure",
      targetProvisionState: "manageable",
      targetPowerState: "power off",
      lastError: "the BMC would not answer",
    });
    expect(node?.facts["lastErrorReadAt"]).toBe(
      new Date(BASE_MS).toISOString(),
    );
  });

  test("the exporter saying nothing of them says nothing about them", () => {
    const [exporter] = ofKind(
      scan([["openstack_ironic_node", 1, EXPORTER_NODE]]),
      OpenStackResourceKind.BareMetalNode,
    );

    for (const fact of [
      "driver",
      "instanceId",
      "lastError",
      "fault",
      "conductor",
    ]) {
      expect(exporter?.facts).not.toHaveProperty(fact);
    }
  });

  test("Ironic empties a reason within a minute, and a failed node keeps the last one", () => {
    const withoutReason: Record<string, string> = { ...PROBE_NODE };
    delete withoutReason["last_error"];
    const [later] = ofKind(
      scan([["openstack_ironic_node", 1, withoutReason]]),
      OpenStackResourceKind.BareMetalNode,
    );

    // Not written, so the one on the row stays: facts merge key by key.
    expect(later?.facts).not.toHaveProperty("lastError");
    expect(later?.facts).not.toHaveProperty("lastErrorReadAt");
  });

  test("a node that left its failed state has its reason cleared", () => {
    const recovered: Record<string, string> = {
      ...PROBE_NODE,
      provision_state: "manageable",
    };
    delete recovered["last_error"];
    const [later] = ofKind(
      scan([["openstack_ironic_node", 1, recovered]]),
      OpenStackResourceKind.BareMetalNode,
    );

    expect(later?.facts["lastError"]).toBe(null);
    expect(later?.facts["lastErrorReadAt"]).toBe(null);
  });

  test("what has cleared is written as cleared, unlike the reason", () => {
    const cleared: Record<string, string> = {
      id: NODE_ID,
      provision_state: "available",
      maintenance: "false",
      driver: "ipmi",
    };
    const [later] = ofKind(
      scan([["openstack_ironic_node", 1, cleared]]),
      OpenStackResourceKind.BareMetalNode,
    );

    expect(later?.facts).toMatchObject({
      instanceId: null,
      fault: null,
      targetProvisionState: null,
      targetPowerState: null,
      lessee: null,
      conductor: null,
      conductorGroup: null,
    });
  });
});

describe("conductors, which only a probe reads", () => {
  test("are workers of their own family, with a host", () => {
    const [conductor] = ofKind(
      scan([
        [
          "openstack_ironic_conductor_state",
          1,
          { hostname: "conductor-1", service: "ironic-conductor" },
        ],
      ]),
      OpenStackResourceKind.Service,
    );

    expect(conductor?.name).toBe("ironic-conductor");
    expect(conductor?.status).toBe("up");
    expect(conductor?.facts["family"]).toBe(OpenStackServiceFamily.BareMetal);
    expect(conductor?.facts["host"]).toBe("conductor-1");
  });

  test("one Ironic calls dead reads down", () => {
    const [conductor] = ofKind(
      scan([
        [
          "openstack_ironic_conductor_state",
          0,
          { hostname: "conductor-1", service: "ironic-conductor" },
        ],
      ]),
      OpenStackResourceKind.Service,
    );

    expect(conductor?.status).toBe("down");
  });
});

describe("a node is no hypervisor", () => {
  const PLACEMENT: Array<string> = [
    "openstack_placement_resource_total",
    "openstack_placement_resource_reserved",
    "openstack_placement_resource_allocation_ratio",
    "openstack_placement_resource_usage",
  ];

  test("what Placement holds of one is a provider, whichever series it is, in any order", () => {
    for (const metricName of PLACEMENT) {
      const entries: Array<OpenStackResourceBufferEntry> = scan([
        [
          metricName,
          1,
          { hostname: NODE_ID, resourcetype: "CUSTOM_BAREMETAL_GOLD" },
        ],
      ]);

      expect(ofKind(entries, OpenStackResourceKind.Hypervisor)).toEqual([]);
      expect(
        ofKind(entries, OpenStackResourceKind.PlacementProvider)[0]?.externalId,
      ).toBe(`RegionOne/${NODE_ID}`);
    }
  });

  test("its inventory reads as capacity pages read any other", () => {
    const [provider] = ofKind(
      scan([
        [PLACEMENT[0]!, 1, { hostname: NODE_ID, resourcetype: "CUSTOM_GOLD" }],
        [PLACEMENT[1]!, 0, { hostname: NODE_ID, resourcetype: "CUSTOM_GOLD" }],
        [PLACEMENT[2]!, 1, { hostname: NODE_ID, resourcetype: "CUSTOM_GOLD" }],
        [PLACEMENT[3]!, 1, { hostname: NODE_ID, resourcetype: "CUSTOM_GOLD" }],
      ]),
      OpenStackResourceKind.PlacementProvider,
    );

    expect(readOpenStackInventories(provider?.facts)).toEqual({
      CUSTOM_GOLD: { total: 1, reserved: 0, allocationRatio: 1, used: 1 },
    });
    // These are vCPUs and bytes on a hypervisor, and mean nothing of a node.
    expect(provider?.vcpuCapacity).toBe(null);
    expect(provider?.memoryCapacityBytes).toBe(null);
  });

  test("half a reading writes half: a collector can cut a scrape between them", () => {
    const [provider] = ofKind(
      scan([
        [PLACEMENT[3]!, 1, { hostname: NODE_ID, resourcetype: "CUSTOM_GOLD" }],
      ]),
      OpenStackResourceKind.PlacementProvider,
    );

    expect(provider?.facts).toEqual({ "inventory:CUSTOM_GOLD:used": 1 });
  });

  test("Nova's series of a node say nothing, so they write nothing (from its driver's source)", () => {
    const entries: Array<OpenStackResourceBufferEntry> = scan(
      [
        "openstack_nova_vcpus_available",
        "openstack_nova_vcpus_used",
        "openstack_nova_memory_available_bytes",
        "openstack_nova_memory_used_bytes",
        "openstack_nova_local_storage_available_bytes",
        "openstack_nova_local_storage_used_bytes",
        "openstack_nova_running_vms",
      ].map((name: string): [string, number, Record<string, string>] => {
        return [
          name,
          name === "openstack_nova_running_vms" ? 1 : 0,
          { hostname: NODE_ID, availability_zone: "nova", aggregates: "" },
        ];
      }),
    );

    expect(entries).toEqual([]);
    // So it costs no read to look for a nova-compute of that name, on every batch.
    expect(getOpenStackHostsToReconcile(entries)).toEqual([]);
  });

  test("a half-enrolled node's zeros are no different (from its driver's source)", () => {
    expect(
      scan([
        ["openstack_nova_vcpus_used", 0, { hostname: NODE_ID }],
        ["openstack_nova_memory_available_bytes", 0, { hostname: NODE_ID }],
      ]),
    ).toEqual([]);
  });

  test("a host really called by a UUID keeps its row, on what it holds", () => {
    const entries: Array<OpenStackResourceBufferEntry> = scan([
      [PLACEMENT[0]!, 64, { hostname: NODE_ID, resourcetype: "VCPU" }],
      [PLACEMENT[2]!, 4, { hostname: NODE_ID, resourcetype: "VCPU" }],
      [PLACEMENT[3]!, 8, { hostname: NODE_ID, resourcetype: "VCPU" }],
    ]);

    const [host] = ofKind(entries, OpenStackResourceKind.Hypervisor);

    expect(host?.hypervisorName).toBe(NODE_ID);
    expect(host?.vcpuCapacity).toBe(256);
    expect(host?.vcpuAllocated).toBe(8);
    expect(ofKind(entries, OpenStackResourceKind.PlacementProvider)).toEqual(
      [],
    );
  });

  test("so does one Nova has numbers for, before microversion 2.88", () => {
    const [host] = ofKind(
      scan([
        ["openstack_nova_vcpus_available", 64, { hostname: NODE_ID }],
        ["openstack_nova_vcpus_used", 8, { hostname: NODE_ID }],
      ]),
      OpenStackResourceKind.Hypervisor,
    );

    expect(host?.vcpuCapacity).toBe(64);
    expect(host?.vcpuAllocated).toBe(8);
  });

  test("a custom class on a host called anything else stays that host's", () => {
    const entries: Array<OpenStackResourceBufferEntry> = scan([
      [
        PLACEMENT[0]!,
        2,
        { hostname: "compute-01", resourcetype: "CUSTOM_GPU" },
      ],
    ]);

    expect(ofKind(entries, OpenStackResourceKind.PlacementProvider)).toEqual(
      [],
    );
    expect(
      ofKind(entries, OpenStackResourceKind.Hypervisor)[0]?.hypervisorName,
    ).toBe("compute-01");
  });

  test("a compute host's own rows are what they were", () => {
    const [host] = ofKind(
      scan([
        [PLACEMENT[0]!, 8, { hostname: "compute-01", resourcetype: "VCPU" }],
        [PLACEMENT[2]!, 4, { hostname: "compute-01", resourcetype: "VCPU" }],
      ]),
      OpenStackResourceKind.Hypervisor,
    );

    expect(host?.vcpuCapacity).toBe(32);
  });
});

describe("where a kind's rows answer to", () => {
  test("Ironic vouches for its nodes and Placement for its providers, never the other way", () => {
    expect(OPENSTACK_KINDS_BY_SERVICE[OpenStackServiceType.BareMetal]).toEqual([
      OpenStackResourceKind.BareMetalNode,
    ]);
    expect(OPENSTACK_KINDS_BY_SERVICE[OpenStackServiceType.Placement]).toEqual([
      OpenStackResourceKind.PlacementProvider,
    ]);
  });

  test("every series a node's row reads is one the scan keeps", () => {
    for (const name of [
      "openstack_ironic_up",
      "openstack_ironic_node",
      "openstack_ironic_node_provision_updated_at",
      "openstack_ironic_node_updated_at",
    ]) {
      expect(OPENSTACK_SNAPSHOT_METRIC_NAMES.has(name)).toBe(true);
    }
  });
});
