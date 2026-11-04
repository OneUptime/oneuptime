import { describe, expect, test } from "@jest/globals";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import {
  OPENSTACK_ALLOCATION_WARNING_PERCENT,
  OPENSTACK_INSTANCE_STUCK_MINUTES,
  OPENSTACK_IP_POOL_WARNING_PERCENT,
  OPENSTACK_SERVICE_DISABLED_WARNING_DAYS,
  OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT,
  OPENSTACK_STORAGE_POOL_WARNING_PERCENT,
  OPENSTACK_VOLUME_STUCK_MINUTES,
  getOpenStackShortHostName,
  isSameOpenStackHost,
} from "../../../Types/OpenStack/OpenStackHealthRules";
import {
  OpenStackResourceKind,
  OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES,
  OPENSTACK_VOLUME_ERROR_STATUSES,
  OPENSTACK_VOLUME_TRANSITIONAL_STATUSES,
} from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackAssessment,
  assessOpenStackApi,
  assessOpenStackFloatingIp,
  assessOpenStackHypervisor,
  assessOpenStackInstance,
  assessOpenStackNetwork,
  assessOpenStackResource,
  assessOpenStackRouter,
  assessOpenStackService,
  assessOpenStackStoragePool,
  assessOpenStackVolume,
  getOpenStackAttentionItems,
  getOpenStackDisplayName,
  getOpenStackHealth,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackHealth";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";

/*
 * What on an OpenStack cloud needs someone, and how bad it is: the one set of rules
 * the Overview, the lists, the part pages and the Topology read. Every line is tested
 * on both sides of it, because a line that moved is a page and an alert that disagree.
 */

const NOW: Date = new Date("2026-11-04T12:00:00.000Z");
const MINUTE_MS: number = 60 * 1000;

const CRITICAL: ResourceAttentionSeverity = ResourceAttentionSeverity.Critical;
const WARNING: ResourceAttentionSeverity = ResourceAttentionSeverity.Warning;

function row(
  kind: OpenStackResourceKind,
  fields: Partial<OpenStackResource> & { facts?: JSONObject } = {},
): OpenStackResource {
  const resource: OpenStackResource = new OpenStackResource();
  resource.kind = kind;
  resource.externalId = fields.externalId || `${kind}-1`;
  resource.regionName = "RegionOne";
  Object.assign(resource, fields);
  return resource;
}

function ago(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE_MS);
}

function reasonOf(assessment: OpenStackAssessment): string {
  return assessment.reasons[0]?.text || "";
}

describe("an API", () => {
  test("up is fine", () => {
    expect(
      assessOpenStackApi(row(OpenStackResourceKind.Api, { status: "up" }))
        .severity,
    ).toBeNull();
  });

  test("down is critical", () => {
    expect(
      assessOpenStackApi(row(OpenStackResourceKind.Api, { status: "down" }))
        .severity,
    ).toBe(CRITICAL);
  });

  test("says when the read itself failed, not that the API said it was down", () => {
    expect(
      reasonOf(
        assessOpenStackApi(
          row(OpenStackResourceKind.Api, {
            status: "down",
            facts: { scrapeFailed: true },
          }),
        ),
      ),
    ).toContain("last read");
  });

  test("not heard from yet is not a failure", () => {
    expect(
      assessOpenStackApi(row(OpenStackResourceKind.Api)).severity,
    ).toBeNull();
  });
});

describe("a service", () => {
  const service = (
    fields: Partial<OpenStackResource> & { facts?: JSONObject },
  ): OpenStackResource => {
    return row(OpenStackResourceKind.Service, { name: "nova-compute", ...fields });
  };
  const assess = (r: OpenStackResource): OpenStackAssessment => {
    return assessOpenStackService({ row: r, now: NOW });
  };

  test("up and enabled is fine", () => {
    expect(
      assess(service({ status: "up", adminState: "enabled" })).severity,
    ).toBeNull();
  });

  test("an enabled compute service down is critical", () => {
    expect(
      assess(service({ status: "down", adminState: "enabled" })).severity,
    ).toBe(CRITICAL);
  });

  test.each(["disabled", "down"])(
    "planned work is never a failure: admin state %s, however it reports",
    (adminState: string) => {
      expect(
        assess(
          service({
            status: "down",
            adminState,
            stateChangedAt: ago(60),
          }),
        ).severity,
      ).toBeNull();
    },
  );

  test("Neutron's admin up is not disabled", () => {
    expect(
      assess(
        service({
          name: "neutron-l3-agent",
          status: "down",
          adminState: "up",
        }),
      ).severity,
    ).toBe(CRITICAL);
  });

  test("a service disabled so long someone forgot gets a look, exactly past the line", () => {
    const days = (count: number): Date => {
      return ago(count * 24 * 60);
    };
    expect(
      assess(
        service({
          status: "down",
          adminState: "disabled",
          stateChangedAt: days(OPENSTACK_SERVICE_DISABLED_WARNING_DAYS),
        }),
      ).severity,
    ).toBeNull();
    const assessed: OpenStackAssessment = assess(
      service({
        status: "down",
        adminState: "disabled",
        stateChangedAt: days(OPENSTACK_SERVICE_DISABLED_WARNING_DAYS + 1),
      }),
    );
    expect(assessed.severity).toBe(WARNING);
    expect(assessed.reasons[0]?.values?.["days"]).toBe(
      `${OPENSTACK_SERVICE_DISABLED_WARNING_DAYS + 1}`,
    );
  });

  test("a disabled service with no date is left alone", () => {
    expect(
      assess(service({ status: "up", adminState: "disabled" })).severity,
    ).toBeNull();
  });

  test.each(["nova-scheduler", "nova-conductor"])(
    "one %s down of several is a warning: the others carry on",
    (name: string) => {
      expect(
        assess(service({ name, status: "down", adminState: "enabled" }))
          .severity,
      ).toBe(WARNING);
    },
  );

  test("says how many instances are on a compute host that went down", () => {
    const assessed: OpenStackAssessment = assessOpenStackService({
      row: service({ status: "down", adminState: "enabled" }),
      now: NOW,
      instanceCount: 42,
    });
    expect(assessed.severity).toBe(CRITICAL);
    expect(assessed.reasons[0]?.values?.["count"]).toBe("42");
    expect(assessed.reasons[0]?.plural?.count).toBe(42);
  });

  test("says whose they are, when the blast radius has been read", () => {
    const assessed: OpenStackAssessment = assessOpenStackService({
      row: service({ status: "down", adminState: "enabled" }),
      now: NOW,
      instanceCount: 42,
      projectCount: 7,
    });
    expect(assessed.reasons).toHaveLength(2);
    expect(assessed.reasons[1]?.text).toBe("In {{count}} projects");
    expect(assessed.reasons[1]?.values?.["count"]).toBe("7");
    expect(assessed.reasons[1]?.plural).toEqual({
      one: "In {{count}} project",
      count: 7,
    });
  });

  test("no projects known says nothing about projects", () => {
    expect(
      assessOpenStackService({
        row: service({ status: "down", adminState: "enabled" }),
        now: NOW,
        instanceCount: 42,
        projectCount: 0,
      }).reasons,
    ).toHaveLength(1);
  });

  test("no instances on it is said without a count", () => {
    const assessed: OpenStackAssessment = assessOpenStackService({
      row: service({ status: "down", adminState: "enabled" }),
      now: NOW,
      instanceCount: 0,
    });
    expect(assessed.reasons[0]?.plural).toBeUndefined();
  });
});

describe("a hypervisor", () => {
  const hypervisor = (
    fields: Partial<OpenStackResource>,
  ): OpenStackResource => {
    return row(OpenStackResourceKind.Hypervisor, fields);
  };

  test("under the line is fine, on the line is still fine", () => {
    expect(
      assessOpenStackHypervisor(
        hypervisor({
          vcpuCapacity: 100,
          vcpuAllocated: OPENSTACK_ALLOCATION_WARNING_PERCENT,
        }),
      ).severity,
    ).toBeNull();
  });

  test("a lost one has last known numbers, and its nova-compute says what is wrong", () => {
    expect(
      assessOpenStackHypervisor(
        hypervisor({
          status: "down",
          adminState: "enabled",
          vcpuCapacity: 100,
          vcpuAllocated: 100,
        }),
      ).severity,
    ).toBeNull();
  });

  test("how full a disabled one is asks nothing of anyone", () => {
    expect(
      assessOpenStackHypervisor(
        hypervisor({
          status: "up",
          adminState: "disabled",
          vcpuCapacity: 100,
          vcpuAllocated: 100,
        }),
      ).severity,
    ).toBeNull();
  });

  test("past the line is a warning, and never critical: allocation is a promise, not load", () => {
    const assessed: OpenStackAssessment = assessOpenStackHypervisor(
      hypervisor({
        vcpuCapacity: 100,
        vcpuAllocated: OPENSTACK_ALLOCATION_WARNING_PERCENT + 1,
      }),
    );
    expect(assessed.severity).toBe(WARNING);
    expect(reasonOf(assessed)).toContain("allocated");
    expect(reasonOf(assessed)).not.toContain("CPU ");
    expect(
      assessOpenStackHypervisor(
        hypervisor({ vcpuCapacity: 100, vcpuAllocated: 400 }),
      ).severity,
    ).toBe(WARNING);
  });

  test("says each of vCPUs, memory and disk that is past it", () => {
    expect(
      assessOpenStackHypervisor(
        hypervisor({
          vcpuCapacity: 100,
          vcpuAllocated: 99,
          memoryCapacityBytes: 100,
          memoryAllocatedBytes: 99,
          diskCapacityBytes: 100,
          diskAllocatedBytes: 99,
        }),
      ).reasons,
    ).toHaveLength(3);
  });

  test("a hypervisor that reports no capacity has no opinion", () => {
    expect(
      assessOpenStackHypervisor(hypervisor({ vcpuAllocated: 99 })).severity,
    ).toBeNull();
    expect(
      assessOpenStackHypervisor(
        hypervisor({ vcpuCapacity: 0, vcpuAllocated: 99 }),
      ).severity,
    ).toBeNull();
  });
});

describe("an instance", () => {
  const assess = (
    status: string,
    minutes: number | null,
  ): OpenStackAssessment => {
    return assessOpenStackInstance({
      row: row(OpenStackResourceKind.Instance, {
        status,
        stateChangedAt: minutes === null ? undefined : ago(minutes),
      }),
      now: NOW,
    });
  };

  test.each(["ACTIVE", "SHUTOFF", "PAUSED", "SUSPENDED", "SHELVED_OFFLOADED"])(
    "%s is fine, however long: someone chose that",
    (status: string) => {
      expect(assess(status, 100000).severity).toBeNull();
    },
  );

  test("ERROR is a warning", () => {
    expect(assess("ERROR", 1).severity).toBe(WARNING);
  });

  test.each(Array.from(OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES))(
    "%s is fine until it has been too long",
    (status: string) => {
      expect(
        assess(status, OPENSTACK_INSTANCE_STUCK_MINUTES - 1).severity,
      ).toBeNull();
      const stuck: OpenStackAssessment = assess(
        status,
        OPENSTACK_INSTANCE_STUCK_MINUTES,
      );
      expect(stuck.severity).toBe(WARNING);
      expect(stuck.reasons[0]?.values?.["status"]).toBe(status);
    },
  );

  test("without knowing since when, it does not guess it is stuck", () => {
    expect(assess("BUILD", null).severity).toBeNull();
  });
});

describe("a volume", () => {
  const assess = (
    status: string,
    minutes: number | null,
  ): OpenStackAssessment => {
    return assessOpenStackVolume({
      row: row(OpenStackResourceKind.Volume, {
        status,
        stateChangedAt: minutes === null ? undefined : ago(minutes),
      }),
      now: NOW,
    });
  };

  test.each(["available", "in-use"])("%s is fine", (status: string) => {
    expect(assess(status, 100000).severity).toBeNull();
  });

  test.each(Array.from(OPENSTACK_VOLUME_ERROR_STATUSES))(
    "%s is a warning at once, in Cinder's word",
    (status: string) => {
      const assessed: OpenStackAssessment = assess(status, 0);
      expect(assessed.severity).toBe(WARNING);
      expect(assessed.reasons[0]?.values?.["status"]).toBe(status);
    },
  );

  test.each(Array.from(OPENSTACK_VOLUME_TRANSITIONAL_STATUSES))(
    "%s is fine until it has been too long",
    (status: string) => {
      expect(
        assess(status, OPENSTACK_VOLUME_STUCK_MINUTES - 1).severity,
      ).toBeNull();
      expect(assess(status, OPENSTACK_VOLUME_STUCK_MINUTES).severity).toBe(
        WARNING,
      );
    },
  );
});

describe("a storage pool", () => {
  const assess = (used: number, total: number = 100): OpenStackAssessment => {
    return assessOpenStackStoragePool(
      row(OpenStackResourceKind.StoragePool, {
        diskCapacityBytes: total,
        diskAllocatedBytes: used,
      }),
    );
  };

  test("the lines, on each side", () => {
    expect(assess(OPENSTACK_STORAGE_POOL_WARNING_PERCENT).severity).toBeNull();
    expect(assess(OPENSTACK_STORAGE_POOL_WARNING_PERCENT + 1).severity).toBe(
      WARNING,
    );
    expect(assess(OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT).severity).toBe(
      WARNING,
    );
    expect(assess(OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT + 1).severity).toBe(
      CRITICAL,
    );
  });

  test("a pool that reports no size has no opinion", () => {
    expect(
      assessOpenStackStoragePool(row(OpenStackResourceKind.StoragePool))
        .severity,
    ).toBeNull();
  });
});

describe("a network", () => {
  const assess = (facts: JSONObject): OpenStackAssessment => {
    return assessOpenStackNetwork(row(OpenStackResourceKind.Network, { facts }));
  };

  test("an external network, on each side of each line", () => {
    const external = (used: number): OpenStackAssessment => {
      return assess({ isExternal: true, ipsUsed: used, ipsTotal: 100 });
    };
    expect(external(OPENSTACK_IP_POOL_WARNING_PERCENT).severity).toBeNull();
    expect(external(OPENSTACK_IP_POOL_WARNING_PERCENT + 1).severity).toBe(
      WARNING,
    );
    expect(external(99).severity).toBe(WARNING);
    expect(external(100).severity).toBe(CRITICAL);
  });

  test("a tenant's own network filling up does not turn the cloud red", () => {
    expect(
      assess({ isExternal: false, ipsUsed: 100, ipsTotal: 100 }).severity,
    ).toBeNull();
  });

  test("a network that reports no addresses has no opinion", () => {
    expect(assess({ isExternal: true }).severity).toBeNull();
  });
});

describe("a router", () => {
  const agent = (
    haState: string | null,
    isAlive: boolean = true,
    isAdminUp: boolean = true,
  ): JSONObject => {
    return { host: "network-01", isAlive, isAdminUp, haState };
  };
  const assess = (
    fields: Partial<OpenStackResource> & { facts?: JSONObject },
  ): OpenStackAssessment => {
    return assessOpenStackRouter(
      row(OpenStackResourceKind.Router, { adminState: "up", ...fields }),
    );
  };

  test("active with a live agent is fine", () => {
    expect(
      assess({
        status: "ACTIVE",
        facts: { l3Agents: { a: agent("active") } },
      }).severity,
    ).toBeNull();
  });

  test("on OVN no agent holds a router, so nothing is missing", () => {
    expect(assess({ status: "ACTIVE", facts: {} }).severity).toBeNull();
  });

  test("no alive agent is critical", () => {
    expect(
      assess({
        status: "ACTIVE",
        facts: { l3Agents: { a: agent(null, false) } },
      }).severity,
    ).toBe(CRITICAL);
  });

  test("an alive agent an operator took down holds nothing", () => {
    expect(
      assess({
        status: "ACTIVE",
        facts: { l3Agents: { a: agent(null, true, false) } },
      }).severity,
    ).toBe(CRITICAL);
  });

  test("two active agents is a split brain, and critical", () => {
    const assessed: OpenStackAssessment = assess({
      status: "ACTIVE",
      facts: { l3Agents: { a: agent("active"), b: agent("active") } },
    });
    expect(assessed.severity).toBe(CRITICAL);
    expect(reasonOf(assessed)).toContain("Two active");
  });

  test("HA with one active and one standby is fine", () => {
    expect(
      assess({
        status: "ACTIVE",
        facts: { l3Agents: { a: agent("active"), b: agent("standby") } },
      }).severity,
    ).toBeNull();
  });

  test("not active is a warning, in Neutron's word", () => {
    const assessed: OpenStackAssessment = assess({ status: "ERROR" });
    expect(assessed.severity).toBe(WARNING);
    expect(assessed.reasons[0]?.values?.["status"]).toBe("ERROR");
  });

  test("a router someone took down is planned work", () => {
    expect(
      assess({ status: "DOWN", adminState: "down" }).severity,
    ).toBeNull();
  });
});

describe("a floating IP", () => {
  const assess = (
    status: string,
    facts: JSONObject = {},
  ): OpenStackAssessment => {
    return assessOpenStackFloatingIp(
      row(OpenStackResourceKind.FloatingIp, { status, facts }),
    );
  };

  // What the agent's series say: the exporter has no port label.
  test("one going through a router that is down is a warning", () => {
    expect(assess("DOWN", { routerId: "router-1" }).severity).toBe(WARNING);
  });

  // What the probe's reads say.
  test("one with a port that is down is a warning", () => {
    expect(assess("DOWN", { portId: "port-1" }).severity).toBe(WARNING);
  });

  test("a spare one is meant to be down", () => {
    expect(assess("DOWN").severity).toBeNull();
    expect(assess("DOWN", { routerId: null }).severity).toBeNull();
  });

  test("one in use and active is fine", () => {
    expect(assess("ACTIVE", { routerId: "router-1" }).severity).toBeNull();
  });
});

describe("a host's short and full names", () => {
  test("Nova's service and its hypervisor are one machine", () => {
    expect(
      isSameOpenStackHost("compute-01", "compute-01.example.internal"),
    ).toBe(true);
    expect(getOpenStackShortHostName("compute-01.example.internal")).toBe(
      "compute-01",
    );
  });

  test("different machines stay different", () => {
    expect(
      isSameOpenStackHost("compute-01", "compute-02.example.internal"),
    ).toBe(false);
  });

  test("an address has no short form", () => {
    expect(getOpenStackShortHostName("192.0.2.10")).toBe("192.0.2.10");
    expect(getOpenStackShortHostName("2001:db8::1")).toBe("2001:db8::1");
  });

  test("nothing is the same as nothing else", () => {
    expect(isSameOpenStackHost(null, undefined)).toBe(false);
    expect(isSameOpenStackHost("", "")).toBe(false);
  });
});

describe("assessOpenStackResource", () => {
  test("kinds with no rules have no opinion", () => {
    for (const kind of [
      OpenStackResourceKind.Flavor,
      OpenStackResourceKind.Image,
      OpenStackResourceKind.Project,
      OpenStackResourceKind.Domain,
      OpenStackResourceKind.Subnet,
      OpenStackResourceKind.Snapshot,
    ]) {
      expect(
        assessOpenStackResource({
          row: row(kind, { status: "ERROR" }),
          now: NOW,
        }).severity,
      ).toBeNull();
    }
  });
});

describe("Needs attention", () => {
  const service = (
    name: string,
    host: string,
    status: string,
    regionName: string = "RegionOne",
    adminState: string = "enabled",
  ): OpenStackResource => {
    return row(OpenStackResourceKind.Service, {
      externalId: `${regionName}/compute/${host}/${name}`,
      name,
      regionName,
      status,
      adminState,
      facts: { host, family: "compute" },
    });
  };

  test("a healthy cloud has nothing to say", () => {
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: [
        service("nova-compute", "compute-01", "up"),
        row(OpenStackResourceKind.Api, { status: "up" }),
      ],
      now: NOW,
    });
    expect(items).toEqual([]);
    expect(getOpenStackHealth(items)).toBe("Healthy");
  });

  test("a warning makes it Degraded, a critical makes it Unhealthy", () => {
    const warning: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: [row(OpenStackResourceKind.Instance, { status: "ERROR" })],
      now: NOW,
    });
    expect(getOpenStackHealth(warning)).toBe("Degraded");
    const critical: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: [row(OpenStackResourceKind.Api, { status: "down" })],
      now: NOW,
    });
    expect(getOpenStackHealth(critical)).toBe("Unhealthy");
  });

  test("a service someone disabled never reaches it", () => {
    expect(
      getOpenStackAttentionItems({
        rows: [service("nova-compute", "compute-01", "down", "RegionOne", "disabled")],
        now: NOW,
      }),
    ).toEqual([]);
  });

  test("critical first, then by kind in the order an operator reads them", () => {
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: [
        row(OpenStackResourceKind.Instance, {
          name: "web-1",
          status: "ERROR",
        }),
        row(OpenStackResourceKind.StoragePool, {
          name: "rbd",
          diskCapacityBytes: 100,
          diskAllocatedBytes: 99,
        }),
        row(OpenStackResourceKind.Volume, {
          name: "data",
          status: "error",
        }),
        row(OpenStackResourceKind.Api, {
          externalId: "RegionOne/compute",
          name: "compute",
          status: "down",
        }),
      ],
      now: NOW,
    });
    expect(
      items.map((item: ResourceAttentionItem) => {
        return item.name;
      }),
    ).toEqual(["compute", "rbd", "data", "web-1"]);
  });

  test("names how many instances a dead host held, by reading its hypervisor", () => {
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: [
        service("nova-compute", "compute-01", "down"),
        row(OpenStackResourceKind.Hypervisor, {
          externalId: "RegionOne/compute-01",
          hypervisorName: "compute-01",
          instanceCount: 42,
        }),
      ],
      now: NOW,
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.reasons[0]?.values?.["count"]).toBe("42");
    expect(items[0]?.detail).toBe("compute-01 · RegionOne");
  });

  test("a read blast radius wins over the hypervisor's own count, and says whose", () => {
    const down: OpenStackResource = service("nova-compute", "compute-01", "down");
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: [
        down,
        row(OpenStackResourceKind.Hypervisor, {
          externalId: "RegionOne/compute-01",
          hypervisorName: "compute-01",
          instanceCount: 40,
        }),
      ],
      now: NOW,
      blastRadiusFor: (candidate: OpenStackResource) => {
        return candidate === down
          ? { instanceCount: 42, projectCount: 7 }
          : undefined;
      },
    });
    expect(items[0]?.reasons[0]?.values?.["count"]).toBe("42");
    expect(items[0]?.reasons[1]?.values?.["count"]).toBe("7");
  });

  test("a part reads by the name a page gives it, and its own without one", () => {
    const api: OpenStackResource = row(OpenStackResourceKind.Api, {
      externalId: "RegionOne/compute",
      name: "compute",
      status: "down",
    });
    expect(
      getOpenStackAttentionItems({ rows: [api], now: NOW })[0]?.name,
    ).toBe("compute");
    expect(
      getOpenStackAttentionItems({
        rows: [api],
        now: NOW,
        nameFor: (): string => {
          return "Compute (Nova)";
        },
      })[0]?.name,
    ).toBe("Compute (Nova)");
  });

  test("every scheduler down is one step from one of them", () => {
    const scheduler: OpenStackResource = service(
      "nova-scheduler",
      "ctl-01",
      "down",
    );
    const route: Route = new Route("/services/ctl-01");
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: [scheduler],
      now: NOW,
      routeFor: (candidate: OpenStackResource): Route | undefined => {
        return candidate === scheduler ? route : undefined;
      },
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.severity).toBe(CRITICAL);
    expect(items[0]?.route).toBe(route);
  });

  // Seen on a real cloud: Nova's services use the short name, its hypervisors the full one.
  test("finds a dead host's hypervisor by its full name", () => {
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: [
        service("nova-compute", "compute-01", "down"),
        row(OpenStackResourceKind.Hypervisor, {
          externalId: "RegionOne/compute-01.example.internal",
          hypervisorName: "compute-01.example.internal",
          instanceCount: 42,
        }),
      ],
      now: NOW,
    });
    expect(items[0]?.reasons[0]?.values?.["count"]).toBe("42");
  });

  test("the same host name in another region is another host", () => {
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: [
        service("nova-compute", "compute-01", "down", "RegionOne"),
        row(OpenStackResourceKind.Hypervisor, {
          externalId: "RegionTwo/compute-01",
          regionName: "RegionTwo",
          hypervisorName: "compute-01",
          instanceCount: 42,
        }),
      ],
      now: NOW,
    });
    expect(items[0]?.reasons[0]?.plural).toBeUndefined();
  });

  describe("every scheduler or conductor down", () => {
    test("one of two is one warning, on the worker", () => {
      const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
        rows: [
          service("nova-scheduler", "control-01", "down"),
          service("nova-scheduler", "control-02", "up"),
        ],
        now: NOW,
      });
      expect(items).toHaveLength(1);
      expect(items[0]?.severity).toBe(WARNING);
    });

    test("all of them is one critical, said once, not once per worker", () => {
      const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
        rows: [
          service("nova-scheduler", "control-01", "down"),
          service("nova-scheduler", "control-02", "down"),
        ],
        now: NOW,
      });
      expect(items).toHaveLength(1);
      expect(items[0]?.severity).toBe(CRITICAL);
      expect(items[0]?.reasons[0]?.values?.["service"]).toBe("nova-scheduler");
      expect(items[0]?.detail).toBe("RegionOne");
    });

    test("each region answers for itself", () => {
      const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
        rows: [
          service("nova-scheduler", "control-01", "down", "RegionOne"),
          service("nova-scheduler", "control-01", "up", "RegionTwo"),
        ],
        now: NOW,
      });
      expect(items).toHaveLength(1);
      expect(items[0]?.severity).toBe(CRITICAL);
      expect(items[0]?.detail).toBe("RegionOne");
    });

    test("a disabled one does not count as still carrying on", () => {
      const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
        rows: [
          service("nova-conductor", "control-01", "down"),
          service(
            "nova-conductor",
            "control-02",
            "up",
            "RegionOne",
            "disabled",
          ),
        ],
        now: NOW,
      });
      expect(items[0]?.severity).toBe(CRITICAL);
    });
  });

  test("each row goes to its page, when a page hands in routes", () => {
    const route: Route = new Route("/dashboard/x");
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: [row(OpenStackResourceKind.Instance, { status: "ERROR" })],
      now: NOW,
      routeFor: () => {
        return route;
      },
    });
    expect(items[0]?.route).toBe(route);
  });

  test("keys are stable and unique", () => {
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: [
        row(OpenStackResourceKind.Instance, {
          externalId: "a",
          status: "ERROR",
        }),
        row(OpenStackResourceKind.Volume, {
          externalId: "a",
          status: "error",
        }),
      ],
      now: NOW,
    });
    expect(
      new Set(
        items.map((item: ResourceAttentionItem) => {
          return item.key;
        }),
      ).size,
    ).toBe(2);
  });
});

describe("a part's name", () => {
  test("is its name, or the tail of its id when OpenStack gave it none", () => {
    expect(
      getOpenStackDisplayName(
        row(OpenStackResourceKind.Instance, { name: "web-1" }),
      ),
    ).toBe("web-1");
    expect(
      getOpenStackDisplayName(
        row(OpenStackResourceKind.Service, {
          externalId: "RegionOne/compute/compute-01/nova-compute",
        }),
      ),
    ).toBe("nova-compute");
    expect(
      getOpenStackDisplayName(
        row(OpenStackResourceKind.Instance, { externalId: "uuid-1" }),
      ),
    ).toBe("uuid-1");
  });
});
