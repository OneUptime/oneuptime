import { describe, expect, test } from "@jest/globals";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import { OPENSTACK_CEPH_STATUS_FACT } from "../../../Types/OpenStack/OpenStackLinks";
import {
  OpenStackQuotaResource,
  getOpenStackQuotaFactKey,
} from "../../../Types/OpenStack/OpenStackQuota";
import {
  OPENSTACK_ALLOCATION_MISMATCH_MINUTES,
  OPENSTACK_ALLOCATION_WARNING_PERCENT,
  OPENSTACK_BARE_METAL_MAINTENANCE_WARNING_DAYS,
  OPENSTACK_BARE_METAL_STUCK_MINUTES,
  OPENSTACK_CAPACITY_FORECAST_WARNING_DAYS,
  OPENSTACK_CONTAINER_CLUSTER_STUCK_MINUTES,
  OPENSTACK_HYPERVISOR_CPU_SATURATED_PERCENT,
  OPENSTACK_HYPERVISOR_MEMORY_PRESSURE_PERCENT,
  OPENSTACK_IMAGE_STUCK_MINUTES,
  OPENSTACK_INSTANCE_CPU_CONTENTION_WARNING_PERCENT,
  OPENSTACK_INSTANCE_CPU_SATURATED_PERCENT,
  OPENSTACK_INSTANCE_DISK_LATENCY_HIGH_MS,
  OPENSTACK_INSTANCE_STUCK_MINUTES,
  OPENSTACK_IP_POOL_EXHAUSTED_PERCENT,
  OPENSTACK_IP_POOL_WARNING_PERCENT,
  OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT,
  OPENSTACK_QUIET_SERVICE_FORGOTTEN_DAYS,
  OPENSTACK_QUIET_SERVICE_MINUTES,
  OPENSTACK_ROUTER_MAX_ACTIVE_AGENTS,
  OPENSTACK_SERVICE_DISABLED_WARNING_DAYS,
  OPENSTACK_STACK_STUCK_MINUTES,
  OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT,
  OPENSTACK_STORAGE_POOL_WARNING_PERCENT,
  OPENSTACK_VOLUME_STUCK_MINUTES,
  OpenStackL3AgentFact,
  getOpenStackRouterAgents,
  getOpenStackShortHostName,
  isOpenStackContainerClusterFailed,
  isOpenStackContainerClusterStuck,
  isOpenStackQuotaAtLine,
  isOpenStackServiceDown,
  isOpenStackServiceQuiet,
  isOpenStackStackFailed,
  isOpenStackStackStuck,
  isOpenStackServiceForcedDown,
  isSameOpenStackHost,
} from "../../../Types/OpenStack/OpenStackHealthRules";
import {
  OPENSTACK_CONTAINER_CLUSTER_UNHEALTHY,
  OpenStackResourceKind,
  OPENSTACK_IMAGE_TRANSITIONAL_STATUSES,
  OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES,
  OPENSTACK_VOLUME_ERROR_STATUSES,
  OPENSTACK_VOLUME_TRANSITIONAL_STATUSES,
} from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackAssessment,
  assessOpenStackApi,
  assessOpenStackBareMetalNode,
  assessOpenStackContainerCluster,
  assessOpenStackFloatingIp,
  assessOpenStackHypervisor,
  assessOpenStackImage,
  assessOpenStackInstance,
  assessOpenStackInstanceOnHost,
  assessOpenStackNetwork,
  assessOpenStackProject,
  assessOpenStackResource,
  assessOpenStackRouter,
  assessOpenStackService,
  assessOpenStackStoragePool,
  assessOpenStackVolume,
  formatOpenStackDuration,
  getOpenStackAttentionItems,
  getOpenStackBareMetalPowerState,
  getOpenStackBareMetalProvisionUpdatedAt,
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

// Partial, but a field can be named as undefined: a service nothing has ever said anything about.
type ResourceFields = {
  [Key in keyof OpenStackResource]?: OpenStackResource[Key] | undefined;
};

function row(
  kind: OpenStackResourceKind,
  fields: ResourceFields = {},
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

/*
 * The lines themselves, as numbers. Everything below reads them by name and follows them
 * wherever they go, so this is what notices one moved: each is what the issue promised, and
 * what an alert and a tile's (i) text tell people.
 */
describe("the lines", () => {
  test.each<[string, number, number]>([
    ["a storage pool warns past", OPENSTACK_STORAGE_POOL_WARNING_PERCENT, 85],
    [
      "a storage pool is critical past",
      OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT,
      95,
    ],
    [
      "a hypervisor's allocation warns past",
      OPENSTACK_ALLOCATION_WARNING_PERCENT,
      90,
    ],
    ["an external network warns past", OPENSTACK_IP_POOL_WARNING_PERCENT, 90],
    ["a project's quota warns at", OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT, 90],
    ["an instance is stuck after", OPENSTACK_INSTANCE_STUCK_MINUTES, 60],
    ["a volume is stuck after", OPENSTACK_VOLUME_STUCK_MINUTES, 30],
    ["an image is stuck after", OPENSTACK_IMAGE_STUCK_MINUTES, 60],
    [
      "a service disabled is probably forgotten after",
      OPENSTACK_SERVICE_DISABLED_WARNING_DAYS,
      7,
    ],
    ["an external network is out at", OPENSTACK_IP_POOL_EXHAUSTED_PERCENT, 100],
    [
      "a router is split past this many active agents:",
      OPENSTACK_ROUTER_MAX_ACTIVE_AGENTS,
      1,
    ],
    ["a stack is stuck after", OPENSTACK_STACK_STUCK_MINUTES, 120],
    [
      "a Kubernetes cluster is stuck after",
      OPENSTACK_CONTAINER_CLUSTER_STUCK_MINUTES,
      120,
    ],
    [
      "a bare metal node is stuck after",
      OPENSTACK_BARE_METAL_STUCK_MINUTES,
      120,
    ],
    [
      "a hypervisor's CPU is saturated past",
      OPENSTACK_HYPERVISOR_CPU_SATURATED_PERCENT,
      90,
    ],
    [
      "a hypervisor's memory is under pressure past",
      OPENSTACK_HYPERVISOR_MEMORY_PRESSURE_PERCENT,
      90,
    ],
    [
      "an instance's CPU is saturated past",
      OPENSTACK_INSTANCE_CPU_SATURATED_PERCENT,
      95,
    ],
    [
      "an instance's disk is slow past, in ms,",
      OPENSTACK_INSTANCE_DISK_LATENCY_HIGH_MS,
      50,
    ],
    [
      "an instance waits on its neighbours past",
      OPENSTACK_INSTANCE_CPU_CONTENTION_WARNING_PERCENT,
      10,
    ],
    [
      "a node in maintenance is probably forgotten after",
      OPENSTACK_BARE_METAL_MAINTENANCE_WARNING_DAYS,
      7,
    ],
    [
      "running out of capacity warns within, in days,",
      OPENSTACK_CAPACITY_FORECAST_WARNING_DAYS,
      14,
    ],
    [
      "a usage record out of step counts after",
      OPENSTACK_ALLOCATION_MISMATCH_MINUTES,
      30,
    ],
    ["a service is quiet after", OPENSTACK_QUIET_SERVICE_MINUTES, 20],
    [
      "a quiet service is forgotten after, in days,",
      OPENSTACK_QUIET_SERVICE_FORGOTTEN_DAYS,
      14,
    ],
  ])("%s %d", (_what: string, line: number, expected: number) => {
    expect(line).toBe(expected);
  });
});

describe("what counts as down", () => {
  test("down and enabled, in Nova's word or Neutron's, and never what someone disabled", () => {
    expect(
      isOpenStackServiceDown({ status: "down", adminState: "enabled" }),
    ).toBe(true);
    expect(isOpenStackServiceDown({ status: "down", adminState: "up" })).toBe(
      true,
    );
    expect(isOpenStackServiceDown({ status: "down" })).toBe(true);
    expect(
      isOpenStackServiceDown({ status: "down", adminState: "disabled" }),
    ).toBe(false);
    expect(isOpenStackServiceDown({ status: "down", adminState: "down" })).toBe(
      false,
    );
    expect(
      isOpenStackServiceDown({ status: "up", adminState: "enabled" }),
    ).toBe(false);
  });
});

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
  const service: (fields: ResourceFields) => OpenStackResource = (
    fields: ResourceFields,
  ): OpenStackResource => {
    return row(OpenStackResourceKind.Service, {
      name: "nova-compute",
      ...fields,
    });
  };
  const assess: (r: OpenStackResource) => OpenStackAssessment = (
    r: OpenStackResource,
  ): OpenStackAssessment => {
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

  describe("forced down by an operator", () => {
    test("is read as down, as bad as any other down, and says it was an operator", () => {
      const assessment: OpenStackAssessment = assess(
        service({
          status: "down",
          adminState: "enabled",
          facts: { forcedDown: true },
        }),
      );

      expect(assessment.severity).toBe(CRITICAL);
      expect(
        assessment.reasons.map((reason: { text: string }): string => {
          return reason.text;
        }),
      ).toEqual(["Down", "Forced down by an operator"]);
    });

    test("names what it takes with it first, and says it was an operator", () => {
      const assessment: OpenStackAssessment = assessOpenStackService({
        row: service({
          status: "down",
          adminState: "enabled",
          facts: { forcedDown: true },
        }),
        now: NOW,
        instanceCount: 3,
      });

      expect(assessment.severity).toBe(CRITICAL);
      expect(
        assessment.reasons.map((reason: { text: string }): string => {
          return reason.text;
        }),
      ).toContain("Forced down by an operator");
    });

    test("a redundant one is a warning, as one of several down is", () => {
      const assessment: OpenStackAssessment = assess(
        service({
          name: "nova-scheduler",
          status: "down",
          adminState: "enabled",
          facts: { forcedDown: true },
        }),
      );

      expect(assessment.severity).toBe(WARNING);
      expect(reasonOf(assessment)).toBe("Down");
      expect(assessment.reasons).toHaveLength(2);
    });

    test.each<[string, Partial<OpenStackResource>, JSONObject | undefined]>([
      ["it says it isn't", { status: "down" }, { forcedDown: false }],
      [
        "nothing says, as on the agent",
        { status: "down" },
        { forcedDown: null },
      ],
      ["nothing has ever said", { status: "down" }, undefined],
    ])(
      "a stopped one reads plainly down when %s",
      (
        _name: string,
        fields: Partial<OpenStackResource>,
        facts: JSONObject | undefined,
      ) => {
        const assessment: OpenStackAssessment = assess(
          service({ ...fields, adminState: "enabled", facts }),
        );

        expect(assessment.severity).toBe(CRITICAL);
        expect(assessment.reasons).toHaveLength(1);
        expect(reasonOf(assessment)).toBe("Down");
      },
    );

    test("what is left of an old say-so on a worker that came back says nothing", () => {
      expect(
        isOpenStackServiceForcedDown({
          status: "up",
          facts: { forcedDown: true },
        }),
      ).toBe(false);
      expect(
        assess(
          service({
            status: "up",
            adminState: "enabled",
            facts: { forcedDown: true },
          }),
        ).severity,
      ).toBeNull();
    });

    test("disabled wins: someone disabled it, and it reads as planned work", () => {
      expect(
        assess(
          service({
            status: "down",
            adminState: "disabled",
            stateChangedAt: ago(60),
            facts: { forcedDown: true },
          }),
        ).severity,
      ).toBeNull();
    });
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
    const days: (count: number) => Date = (count: number): Date => {
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
  const hypervisor: (
    fields: Partial<OpenStackResource>,
  ) => OpenStackResource = (
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
  const assess: (
    status: string,
    minutes: number | null,
  ) => OpenStackAssessment = (
    status: string,
    minutes: number | null,
  ): OpenStackAssessment => {
    return assessOpenStackInstance({
      row: row(OpenStackResourceKind.Instance, {
        status,
        ...(minutes === null ? {} : { stateChangedAt: ago(minutes) }),
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
  const assess: (
    status: string,
    minutes: number | null,
  ) => OpenStackAssessment = (
    status: string,
    minutes: number | null,
  ): OpenStackAssessment => {
    return assessOpenStackVolume({
      row: row(OpenStackResourceKind.Volume, {
        status,
        ...(minutes === null ? {} : { stateChangedAt: ago(minutes) }),
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

describe("an image", () => {
  const assess: (
    status: string,
    minutes: number | null,
  ) => OpenStackAssessment = (
    status: string,
    minutes: number | null,
  ): OpenStackAssessment => {
    return assessOpenStackImage({
      row: row(OpenStackResourceKind.Image, {
        status,
        ...(minutes === null ? {} : { stateChangedAt: ago(minutes) }),
      }),
      now: NOW,
    });
  };

  test.each(["active", "deactivated", "deleted"])(
    "%s is fine, however long",
    (status: string) => {
      expect(assess(status, 100000).severity).toBeNull();
    },
  );

  test.each(Array.from(OPENSTACK_IMAGE_TRANSITIONAL_STATUSES))(
    "%s is fine until it has been too long",
    (status: string) => {
      expect(
        assess(status, OPENSTACK_IMAGE_STUCK_MINUTES - 1).severity,
      ).toBeNull();
      const stuck: OpenStackAssessment = assess(
        status,
        OPENSTACK_IMAGE_STUCK_MINUTES,
      );
      expect(stuck.severity).toBe(WARNING);
      expect(stuck.reasons[0]?.values?.["status"]).toBe(status);
    },
  );

  test("without knowing since when, it does not guess it is stuck", () => {
    expect(assess("saving", null).severity).toBeNull();
  });

  test("reaches Needs attention by name", () => {
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: [
        row(OpenStackResourceKind.Image, {
          name: "windows-2022",
          status: "saving",
          stateChangedAt: ago(OPENSTACK_IMAGE_STUCK_MINUTES),
        }),
      ],
      now: NOW,
      routeFor: (): Route => {
        return new Route("/image");
      },
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe("windows-2022");
  });
});

describe("what the probe adds to an item", () => {
  test("a failed instance carries Nova's fault message as it was written", () => {
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: [
        row(OpenStackResourceKind.Instance, {
          name: "web-01",
          status: "ERROR",
          stateChangedAt: ago(5),
          facts: { faultMessage: "No valid host was found." },
        }),
      ],
      now: NOW,
      routeFor: (): Route => {
        return new Route("/instance");
      },
    });
    expect(items[0]?.message).toBe("No valid host was found.");
  });

  test("with none said, it says none", () => {
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: [
        row(OpenStackResourceKind.Instance, {
          name: "web-01",
          status: "ERROR",
          stateChangedAt: ago(5),
        }),
      ],
      now: NOW,
      routeFor: (): Route => {
        return new Route("/instance");
      },
    });
    expect(items[0]?.message).toBeFalsy();
  });
});

describe("a storage pool", () => {
  const assess: (used: number, total?: number) => OpenStackAssessment = (
    used: number,
    total: number = 100,
  ): OpenStackAssessment => {
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
  const assess: (facts: JSONObject) => OpenStackAssessment = (
    facts: JSONObject,
  ): OpenStackAssessment => {
    return assessOpenStackNetwork(
      row(OpenStackResourceKind.Network, { facts }),
    );
  };

  test("an external network, on each side of each line", () => {
    const external: (used: number) => OpenStackAssessment = (
      used: number,
    ): OpenStackAssessment => {
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
  const agent: (
    haState: string | null,
    isAlive?: boolean,
    isAdminUp?: boolean,
  ) => JSONObject = (
    haState: string | null,
    isAlive: boolean = true,
    isAdminUp: boolean = true,
  ): JSONObject => {
    return { host: "network-01", isAlive, isAdminUp, haState };
  };
  const assess: (fields: ResourceFields) => OpenStackAssessment = (
    fields: ResourceFields,
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
    expect(assess({ status: "DOWN", adminState: "down" }).severity).toBeNull();
  });
});

describe("a floating IP", () => {
  const assess: (status: string, facts?: JSONObject) => OpenStackAssessment = (
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
  const service: (
    name: string,
    host: string,
    status: string,
    regionName?: string,
    adminState?: string,
  ) => OpenStackResource = (
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
        rows: [
          service(
            "nova-compute",
            "compute-01",
            "down",
            "RegionOne",
            "disabled",
          ),
        ],
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
    const down: OpenStackResource = service(
      "nova-compute",
      "compute-01",
      "down",
    );
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
    expect(getOpenStackAttentionItems({ rows: [api], now: NOW })[0]?.name).toBe(
      "compute",
    );
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

/*
 * What breaking each rule on its own found nothing holding (mutation checks, as #5723 asks):
 * a line's other side, a word in a reason, and which sentence a reason takes.
 */
describe("on the line, and in the words that say so", () => {
  test.each<[number, string]>([
    [119, "119m"],
    [120, "2h"],
    [48 * 60 - 1, "48h"],
    [48 * 60, "2d"],
  ])("%d minutes read as %s", (minutes: number, expected: string) => {
    expect(formatOpenStackDuration(minutes)).toBe(expected);
  });

  test("a host's name is what comes before its first dot, if anything does", () => {
    expect(getOpenStackShortHostName("compute-1.example.org")).toBe(
      "compute-1",
    );
    expect(getOpenStackShortHostName(".local")).toBe(".local");
  });

  test("a service a cloud may not run is quiet from the minute it reaches the line", () => {
    const quiet: (minutes: number) => boolean = (minutes: number): boolean => {
      return isOpenStackServiceQuiet({
        service: "baremetal",
        lastSeenAt: ago(minutes),
        now: NOW,
      });
    };

    expect(quiet(OPENSTACK_QUIET_SERVICE_MINUTES - 1)).toBe(false);
    expect(quiet(OPENSTACK_QUIET_SERVICE_MINUTES)).toBe(true);
    expect(isOpenStackServiceQuiet({ lastSeenAt: ago(600), now: NOW })).toBe(
      false,
    );
    // Every cloud has Nova, so one gone quiet is a whole cloud gone quiet, said elsewhere.
    expect(
      isOpenStackServiceQuiet({
        service: "compute",
        lastSeenAt: ago(600),
        now: NOW,
      }),
    ).toBe(false);
  });

  test("and says for how long", () => {
    const assessment: OpenStackAssessment = assessOpenStackApi(
      row(OpenStackResourceKind.Api, {
        name: "baremetal",
        status: "up",
        lastSeenAt: ago(25),
      }),
      NOW,
    );

    expect(assessment.severity).toBe(WARNING);
    expect(assessment.reasons[0]?.values).toEqual({ duration: "25m" });
  });

  test("a quota is at its line at exactly 90%, and a limit of nothing is no line", () => {
    expect(isOpenStackQuotaAtLine({ used: 9, limit: 10 })).toBe(true);
    expect(isOpenStackQuotaAtLine({ used: 899, limit: 1000 })).toBe(false);
    expect(isOpenStackQuotaAtLine({ used: 0, limit: 0 })).toBe(false);
    expect(isOpenStackQuotaAtLine({ used: 5, limit: -1 })).toBe(false);
  });

  test("a project at its line says the numbers, and its region only when it has several", () => {
    const quota: (region: string) => JSONObject = (
      region: string,
    ): JSONObject => {
      return {
        [getOpenStackQuotaFactKey(OpenStackQuotaResource.Instances, region)]: {
          used: 9,
          limit: 10,
          observedAt: NOW.toISOString(),
        },
      };
    };

    const oneRegion: OpenStackAssessment = assessOpenStackProject({
      row: row(OpenStackResourceKind.Project, {
        facts: quota("RegionOne"),
      }),
      now: NOW,
    });

    expect(oneRegion.severity).toBe(WARNING);
    expect(oneRegion.reasons[0]).toEqual({
      text: "{{used}} of {{limit}} instances used ({{percent}})",
      values: { used: "9", limit: "10", percent: "90%" },
    });

    const twoRegions: OpenStackAssessment = assessOpenStackProject({
      row: row(OpenStackResourceKind.Project, {
        facts: {
          ...quota("RegionOne"),
          [getOpenStackQuotaFactKey(
            OpenStackQuotaResource.Instances,
            "RegionTwo",
          )]: { used: 1, limit: 10, observedAt: NOW.toISOString() },
        },
      }),
      now: NOW,
    });

    expect(twoRegions.reasons).toEqual([
      {
        text: "{{used}} of {{limit}} instances used in {{region}} ({{percent}})",
        values: {
          used: "9",
          limit: "10",
          percent: "90%",
          region: "RegionOne",
        },
      },
    ]);
  });

  test("a router's agents, whatever a fact holds", () => {
    expect(getOpenStackRouterAgents(undefined)).toEqual([]);
    expect(getOpenStackRouterAgents({ l3Agents: "a word" })).toEqual([]);
    expect(getOpenStackRouterAgents({ l3Agents: ["a list"] })).toEqual([]);

    const agents: Array<OpenStackL3AgentFact> = getOpenStackRouterAgents({
      l3Agents: {
        one: {
          host: "net-1",
          isAlive: true,
          isAdminUp: true,
          haState: "active",
        },
        two: { host: "", haState: "" },
      },
    });

    expect(agents).toEqual([
      { host: "net-1", isAlive: true, isAdminUp: true, haState: "active" },
      { host: null, isAlive: false, isAdminUp: false, haState: null },
    ]);
  });

  test("an instance on a stopped host: what it takes with it, unless someone stopped it first", () => {
    const on: (status: string) => OpenStackAssessment = (
      status: string,
    ): OpenStackAssessment => {
      return assessOpenStackInstanceOnHost({
        row: row(OpenStackResourceKind.Instance, { status }),
        now: NOW,
        isHostDown: true,
      });
    };

    expect(on("ACTIVE").severity).toBe(WARNING);
    expect(reasonOf(on("ACTIVE"))).toBe("Its hypervisor is down");
    expect(on("SHUTOFF").severity).toBeNull();
    expect(
      assessOpenStackInstanceOnHost({
        row: row(OpenStackResourceKind.Instance, { status: "ACTIVE" }),
        now: NOW,
        isHostDown: false,
      }).severity,
    ).toBeNull();
  });

  test("something stuck says its status and for how long", () => {
    const assessment: OpenStackAssessment = assessOpenStackInstance({
      row: row(OpenStackResourceKind.Instance, {
        status: "BUILD",
        stateChangedAt: ago(OPENSTACK_INSTANCE_STUCK_MINUTES + 30),
      }),
      now: NOW,
    });

    expect(assessment.reasons[0]?.values).toEqual({
      status: "BUILD",
      duration: "90m",
    });
  });

  test.each<
    [string, number | null, ResourceAttentionSeverity | null, string | null]
  >([
    ["HEALTH_OK says nothing", 0, null, null],
    [
      "HEALTH_WARN is often a rebalance",
      1,
      WARNING,
      "Its Ceph cluster {{cluster}} reads HEALTH_WARN",
    ],
    [
      "HEALTH_ERR is Ceph refusing something",
      2,
      CRITICAL,
      "Its Ceph cluster {{cluster}} reads HEALTH_ERR",
    ],
    ["and no reading says nothing", null, null, null],
  ])(
    "a half empty pool, with Ceph behind it: %s",
    (
      _what: string,
      healthStatus: number | null,
      severity: ResourceAttentionSeverity | null,
      reason: string | null,
    ) => {
      const assessment: OpenStackAssessment = assessOpenStackStoragePool(
        row(OpenStackResourceKind.StoragePool, {
          diskAllocatedBytes: 50,
          diskCapacityBytes: 100,
          facts: {
            [OPENSTACK_CEPH_STATUS_FACT]: {
              clusterId: "c-1",
              clusterName: "ceph-eu",
              healthStatus,
            },
          },
        }),
      );

      expect(assessment.severity).toBe(severity);
      expect(assessment.reasons).toHaveLength(severity ? 1 : 0);
      if (severity) {
        expect(assessment.reasons[0]).toEqual({
          text: reason,
          values: { cluster: "ceph-eu" },
        });
      }
    },
  );

  test.each<
    [
      string,
      (status: string | null | undefined) => boolean,
      (data: {
        status?: string | null | undefined;
        stateChangedAt?: Date | string | null | undefined;
        now: Date;
      }) => boolean,
      number,
    ]
  >([
    [
      "a stack",
      isOpenStackStackFailed,
      isOpenStackStackStuck,
      OPENSTACK_STACK_STUCK_MINUTES,
    ],
    [
      "a Kubernetes cluster",
      isOpenStackContainerClusterFailed,
      isOpenStackContainerClusterStuck,
      OPENSTACK_CONTAINER_CLUSTER_STUCK_MINUTES,
    ],
  ])(
    "%s has failed in those words, and is stuck from the minute it reaches the line",
    (
      _what: string,
      isFailed: (status: string | null | undefined) => boolean,
      isStuck: (data: {
        status?: string | null | undefined;
        stateChangedAt?: Date | string | null | undefined;
        now: Date;
      }) => boolean,
      line: number,
    ) => {
      expect(isFailed("CREATE_FAILED")).toBe(true);
      expect(isFailed("CREATE_COMPLETE")).toBe(false);
      expect(isFailed("")).toBe(false);
      expect(isFailed(null)).toBe(false);

      const stuck: (status: string | null, minutes: number) => boolean = (
        status: string | null,
        minutes: number,
      ): boolean => {
        return isStuck({ status, stateChangedAt: ago(minutes), now: NOW });
      };

      expect(stuck("CREATE_IN_PROGRESS", line - 1)).toBe(false);
      expect(stuck("CREATE_IN_PROGRESS", line)).toBe(true);
      expect(stuck("CREATE_COMPLETE", line * 10)).toBe(false);
      expect(stuck(null, line * 10)).toBe(false);
    },
  );

  test("a Kubernetes cluster that Magnum says is unhealthy, and nothing else it says", () => {
    const withHealth: (healthStatus: string) => OpenStackAssessment = (
      healthStatus: string,
    ): OpenStackAssessment => {
      return assessOpenStackContainerCluster({
        row: row(OpenStackResourceKind.ContainerCluster, {
          status: "CREATE_COMPLETE",
          facts: { healthStatus },
        }),
        now: NOW,
      });
    };

    expect(withHealth(OPENSTACK_CONTAINER_CLUSTER_UNHEALTHY).severity).toBe(
      WARNING,
    );
    expect(withHealth("HEALTHY").severity).toBeNull();
    // What Magnum says of any cluster it cannot reach, recorded on every scene.
    expect(withHealth("UNKNOWN").severity).toBeNull();
  });

  test("a failed cluster is said once, by its name, and a stack with no such cluster still is", () => {
    const failedStack: (id: string) => OpenStackResource = (
      id: string,
    ): OpenStackResource => {
      return row(OpenStackResourceKind.Stack, {
        externalId: id,
        name: `stack-${id}`,
        status: "CREATE_FAILED",
      });
    };

    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: [
        row(OpenStackResourceKind.ContainerCluster, {
          externalId: "c-1",
          name: "cluster-failed",
          status: "CREATE_FAILED",
          facts: { stackId: "s-1" },
        }),
        failedStack("s-1"),
        // Its cluster is fine, so nothing else says this stack failed.
        row(OpenStackResourceKind.ContainerCluster, {
          externalId: "c-2",
          name: "cluster-fine",
          status: "CREATE_COMPLETE",
          facts: { stackId: "s-2" },
        }),
        failedStack("s-2"),
        // A stack nobody's cluster is built on.
        failedStack("s-3"),
        // Sharing an ID with such a stack does not make something that stack.
        row(OpenStackResourceKind.Instance, {
          externalId: "s-1",
          name: "instance-failed",
          status: "ERROR",
        }),
      ],
      now: NOW,
    });

    expect(
      items
        .map((item: ResourceAttentionItem): string => {
          return item.name;
        })
        .sort(),
    ).toEqual(["cluster-failed", "instance-failed", "stack-s-2", "stack-s-3"]);
  });

  test("a bare metal node that failed says so in Ironic's words", () => {
    expect(
      assessOpenStackBareMetalNode({
        row: row(OpenStackResourceKind.BareMetalNode, {
          status: "deploy failed",
        }),
        now: NOW,
      }).reasons[0]?.values,
    ).toEqual({ status: "deploy failed" });
  });

  test("a bare metal node's facts, whatever they hold", () => {
    const node: (facts: JSONObject) => OpenStackResource = (
      facts: JSONObject,
    ): OpenStackResource => {
      return row(OpenStackResourceKind.BareMetalNode, { facts });
    };

    expect(
      getOpenStackBareMetalProvisionUpdatedAt(
        node({ provisionUpdatedAt: "2026-11-04T11:00:00Z" }),
      ),
    ).toBe("2026-11-04T11:00:00Z");
    expect(
      getOpenStackBareMetalProvisionUpdatedAt(node({ provisionUpdatedAt: 7 })),
    ).toBeUndefined();
    expect(
      getOpenStackBareMetalPowerState(node({ powerState: "power on" })),
    ).toBe("power on");
    expect(getOpenStackBareMetalPowerState(node({ powerState: 1 }))).toBeNull();
  });

  test("a bare metal node stuck says since its provision state last moved, not since the row did", () => {
    const assessment: OpenStackAssessment = assessOpenStackBareMetalNode({
      row: row(OpenStackResourceKind.BareMetalNode, {
        status: "deploying",
        stateChangedAt: ago(5),
        facts: {
          provisionUpdatedAt: ago(
            OPENSTACK_BARE_METAL_STUCK_MINUTES + 60,
          ).toISOString(),
        },
      }),
      now: NOW,
    });

    expect(assessment.severity).toBe(WARNING);
    expect(assessment.reasons[0]?.values).toEqual({
      status: "deploying",
      duration: "3h",
    });
  });

  test("a healthy bare metal node asks nobody for anything", () => {
    expect(
      assessOpenStackBareMetalNode({
        row: row(OpenStackResourceKind.BareMetalNode, {
          status: "active",
          facts: { powerState: "power on" },
        }),
        now: NOW,
      }).severity,
    ).toBeNull();
  });

  test("an item names what it is and where it sits, in the words of what it sits on", () => {
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: [
        row(OpenStackResourceKind.Instance, {
          externalId: "i-1",
          name: "web-01",
          status: "ERROR",
          hypervisorName: "compute-1",
        }),
        row(OpenStackResourceKind.Instance, {
          externalId: "i-2",
          name: "web-02",
          status: "ERROR",
          regionName: "RegionTwo",
        }),
        row(OpenStackResourceKind.StoragePool, {
          externalId: "p-1",
          name: "pool-1",
          diskAllocatedBytes: 99,
          diskCapacityBytes: 100,
        }),
        row(OpenStackResourceKind.Api, {
          externalId: "a-1",
          name: "compute",
          status: "down",
        }),
      ],
      now: NOW,
    });

    const named: (name: string) => ResourceAttentionItem = (
      name: string,
    ): ResourceAttentionItem => {
      return items.find((item: ResourceAttentionItem): boolean => {
        return item.name === name;
      })!;
    };

    expect(named("web-01").detail).toBe("compute-1");
    expect(named("web-02").detail).toBe("RegionTwo");
    expect(named("pool-1").detail).toBe("RegionOne");
    expect(named("pool-1").kind).toBe("Storage pool");
    expect(named("compute").detail).toBe("RegionOne");
  });

  test("a bare metal node's own reason for its maintenance is what an item says, and nothing else's is", () => {
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: [
        row(OpenStackResourceKind.BareMetalNode, {
          externalId: "n-1",
          name: "node-1",
          status: "deploy failed",
          disabledReason: "Replacing a disk",
        }),
        row(OpenStackResourceKind.Instance, {
          externalId: "i-1",
          name: "web-01",
          status: "ERROR",
          disabledReason: "Not what an instance says",
        }),
      ],
      now: NOW,
    });

    expect(
      items.find((item: ResourceAttentionItem): boolean => {
        return item.name === "node-1";
      })?.message,
    ).toBe("Replacing a disk");
    expect(
      items.find((item: ResourceAttentionItem): boolean => {
        return item.name === "web-01";
      })?.message,
    ).toBeUndefined();
  });
});
