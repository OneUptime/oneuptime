import { describe, expect, test } from "@jest/globals";
import {
  OpenStackProjectPagePlan,
  OpenStackStatusPageExistingMonitor,
  OpenStackStatusPagePlan,
  OpenStackStatusPagePlanGroup,
  OpenStackStatusPagePlanMonitor,
  OpenStackStatusPagePlanRow,
  buildOpenStackProjectPagePlan,
  buildOpenStackStatusPagePlan,
  getOpenStackStatusPagePlanKey,
  readOpenStackProjectPageRows,
} from "../../../Types/OpenStack/OpenStackStatusPagePlan";
import {
  OPENSTACK_STATUS_PAGE_SERVICES,
  OpenStackStatusPageService,
  describeOpenStackPartToAProject,
  getOpenStackStatusPageServiceOfPart,
} from "../../../Types/OpenStack/OpenStackStatusPageService";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import { OpenStackMaintenancePartKind } from "../../../Types/OpenStack/OpenStackMaintenancePart";
import {
  OpenStackAlertTemplate,
  getAllOpenStackAlertTemplates,
  getOpenStackAlertTemplateById,
} from "../../../Types/Monitor/OpenStackAlertTemplates";

/*
 * WHAT MAKING A STATUS PAGE WILL DO, BEFORE IT DOES IT.
 *
 * One failure must still open one incident once there is a page, so a monitor that already watches a row is
 * what backs it, and a service a cloud doesn't run shows no trace.
 */
const TEMPLATE_NAMES: Record<string, string> = {};
for (const template of getAllOpenStackAlertTemplates()) {
  TEMPLATE_NAMES[template.id] = template.name;
}

const EVERY_SERVICE: Array<string> = [
  "compute",
  "network",
  "volume",
  "image",
  "identity",
  "placement",
];

function planOf(data: {
  regions?: Array<{ regionName: string | null; apiNames: Array<string> }>;
  existing?: Array<OpenStackStatusPageExistingMonitor>;
  offered?: Array<string>;
}): OpenStackStatusPagePlan {
  return buildOpenStackStatusPagePlan({
    cloudName: "devstack",
    regions: data.regions || [
      { regionName: "RegionOne", apiNames: EVERY_SERVICE },
    ],
    existingMonitors: data.existing || [],
    templateNames: TEMPLATE_NAMES,
    ...(data.offered
      ? {
          isTemplateOffered: (id: string): boolean => {
            return data.offered!.includes(id);
          },
        }
      : {}),
  });
}

function rowOf(
  plan: OpenStackStatusPagePlan,
  region: string | null,
  service: OpenStackStatusPageService,
): OpenStackStatusPagePlanRow | undefined {
  return plan.groups
    .find((group: OpenStackStatusPagePlanGroup): boolean => {
      return group.regionName === region;
    })
    ?.rows.find((row: OpenStackStatusPagePlanRow): boolean => {
      return row.service === service;
    });
}

function servicesOf(group: OpenStackStatusPagePlanGroup): Array<string> {
  return group.rows.map((row: OpenStackStatusPagePlanRow): string => {
    return row.service;
  });
}

describe("what a cloud's page holds", () => {
  test("regions as groups and services as rows, in the order people read them", () => {
    const plan: OpenStackStatusPagePlan = planOf({});

    expect(plan.name).toBe("devstack status");
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]!.name).toBe("RegionOne");
    expect(servicesOf(plan.groups[0]!)).toEqual([
      "Compute",
      "Networking",
      "Block Storage",
      "Images",
      "Identity",
    ]);
  });

  test("a cloud without a service shows no trace of it", () => {
    const plan: OpenStackStatusPagePlan = planOf({
      regions: [{ regionName: "RegionOne", apiNames: ["compute", "identity"] }],
    });

    expect(servicesOf(plan.groups[0]!)).toEqual(["Compute", "Identity"]);
    expect(JSON.stringify(plan)).not.toContain("block-storage");
    expect(JSON.stringify(plan)).not.toContain("Block Storage");
  });

  test("load balancing has no row until something can say whether it works", () => {
    const plan: OpenStackStatusPagePlan = planOf({
      regions: [
        { regionName: "RegionOne", apiNames: ["compute", "load-balancer"] },
      ],
    });

    expect(servicesOf(plan.groups[0]!)).toEqual(["Compute"]);
  });

  test("two regions are two groups, each with what it runs", () => {
    const plan: OpenStackStatusPagePlan = planOf({
      regions: [
        { regionName: "RegionTwo", apiNames: ["compute"] },
        { regionName: "RegionOne", apiNames: ["compute", "volume"] },
      ],
    });

    expect(
      plan.groups.map((group: OpenStackStatusPagePlanGroup) => {
        return [group.name, servicesOf(group)];
      }),
    ).toEqual([
      ["RegionOne", ["Compute", "Block Storage"]],
      ["RegionTwo", ["Compute"]],
    ]);
  });

  test("a region with nothing on it is not a group", () => {
    const plan: OpenStackStatusPagePlan = planOf({
      regions: [{ regionName: "RegionOne", apiNames: ["placement"] }],
    });

    expect(plan.groups).toEqual([]);
    expect(plan.monitorsToMake).toBe(0);
  });

  test("a cloud whose APIs name no region is named after itself", () => {
    const plan: OpenStackStatusPagePlan = planOf({
      regions: [{ regionName: null, apiNames: ["identity"] }],
    });

    expect(plan.groups[0]!.name).toBe("devstack");
    expect(plan.groups[0]!.rows[0]!.monitors[0]!.name).toBe(
      "devstack - Identity API Down",
    );
  });

  test("every template a row reads is one that exists, and none trips on planned work", () => {
    for (const entry of OPENSTACK_STATUS_PAGE_SERVICES) {
      for (const id of [...entry.templateIds, ...entry.checkTemplateIds]) {
        const template: OpenStackAlertTemplate | undefined =
          getOpenStackAlertTemplateById(id);
        expect(template).toBeDefined();
      }
      expect(entry.templateIds).not.toContain(
        "openstack-compute-service-disabled",
      );
    }
  });
});

describe("what it makes and what it reuses", () => {
  const COMPUTE_DOWN: string = "openstack-compute-service-down";

  test("with nothing there, it makes one for each, for its region", () => {
    const plan: OpenStackStatusPagePlan = planOf({});
    const compute: OpenStackStatusPagePlanRow = rowOf(
      plan,
      "RegionOne",
      OpenStackStatusPageService.Compute,
    )!;

    expect(plan.monitorsToMake).toBe(8);
    expect(plan.monitorsReused).toBe(0);
    expect(
      compute.monitors.map((monitor: OpenStackStatusPagePlanMonitor) => {
        return [
          monitor.templateId,
          monitor.existingMonitorId,
          monitor.regionName,
        ];
      }),
    ).toEqual([
      ["openstack-compute-api-down", null, "RegionOne"],
      [COMPUTE_DOWN, null, "RegionOne"],
    ]);
    expect(compute.monitors[1]!.name).toBe(
      "devstack - Compute Service Down (RegionOne)",
    );
    expect(compute.monitors[1]!.incidentsOpenedBy).toBeUndefined();
  });

  test("one already there for the region is reused, so one failure stays one incident", () => {
    const plan: OpenStackStatusPagePlan = planOf({
      existing: [
        {
          id: "m1",
          name: "Mine",
          templateId: COMPUTE_DOWN,
          regionName: "RegionOne",
        },
      ],
    });
    const monitor: OpenStackStatusPagePlanMonitor = rowOf(
      plan,
      "RegionOne",
      OpenStackStatusPageService.Compute,
    )!.monitors[1]!;

    expect(monitor.existingMonitorId).toBe("m1");
    expect(monitor.name).toBe("Mine");
    expect(plan.monitorsToMake).toBe(7);
    expect(plan.monitorsReused).toBe(1);
  });

  test("on one region, a monitor of the whole cloud is that region's", () => {
    const plan: OpenStackStatusPagePlan = planOf({
      existing: [
        {
          id: "m1",
          name: "Whole cloud",
          templateId: COMPUTE_DOWN,
          regionName: null,
        },
      ],
    });

    expect(
      rowOf(plan, "RegionOne", OpenStackStatusPageService.Compute)!.monitors[1]!
        .existingMonitorId,
    ).toBe("m1");
  });

  test("on two regions, a monitor of the whole cloud can't be one row: each gets its own, opening nothing", () => {
    const plan: OpenStackStatusPagePlan = planOf({
      regions: [
        { regionName: "RegionOne", apiNames: ["compute"] },
        { regionName: "RegionTwo", apiNames: ["compute"] },
      ],
      existing: [
        {
          id: "m1",
          name: "Whole cloud",
          templateId: COMPUTE_DOWN,
          regionName: null,
        },
      ],
    });

    for (const region of ["RegionOne", "RegionTwo"]) {
      const monitor: OpenStackStatusPagePlanMonitor = rowOf(
        plan,
        region,
        OpenStackStatusPageService.Compute,
      )!.monitors[1]!;

      expect(monitor.existingMonitorId).toBeNull();
      expect(monitor.regionName).toBe(region);
      // It stays the one that opens the incident.
      expect(monitor.incidentsOpenedBy).toBe("Whole cloud");
    }

    // And one with no such monitor beside it opens its own.
    expect(
      rowOf(plan, "RegionOne", OpenStackStatusPageService.Compute)!.monitors[0]!
        .incidentsOpenedBy,
    ).toBeUndefined();
  });

  test("one for another region says nothing of this one", () => {
    const plan: OpenStackStatusPagePlan = planOf({
      regions: [
        { regionName: "RegionOne", apiNames: ["compute"] },
        { regionName: "RegionTwo", apiNames: ["compute"] },
      ],
      existing: [
        {
          id: "m2",
          name: "Two",
          templateId: COMPUTE_DOWN,
          regionName: "RegionTwo",
        },
      ],
    });

    expect(
      rowOf(plan, "RegionOne", OpenStackStatusPageService.Compute)!.monitors[1]!
        .existingMonitorId,
    ).toBeNull();
    expect(
      rowOf(plan, "RegionTwo", OpenStackStatusPageService.Compute)!.monitors[1]!
        .existingMonitorId,
    ).toBe("m2");
  });

  test("a check's monitor is for its objective, and only once that check is on", () => {
    const off: OpenStackStatusPagePlan = planOf({
      offered: ["openstack-compute-api-down", COMPUTE_DOWN],
    });
    const on: OpenStackStatusPagePlan = planOf({
      offered: [
        "openstack-compute-api-down",
        COMPUTE_DOWN,
        "openstack-instance-boot-failing",
      ],
    });

    expect(
      rowOf(off, "RegionOne", OpenStackStatusPageService.Compute)!
        .checkMonitors,
    ).toEqual([]);
    expect(
      rowOf(
        on,
        "RegionOne",
        OpenStackStatusPageService.Compute,
      )!.checkMonitors.map((monitor: OpenStackStatusPagePlanMonitor) => {
        return monitor.templateId;
      }),
    ).toEqual(["openstack-instance-boot-failing"]);
    // Never counted in what the page itself will make.
    expect(on.monitorsToMake).toBe(off.monitorsToMake);
  });
});

describe("the key a make is held to", () => {
  test("the same cloud reads the same", () => {
    expect(getOpenStackStatusPagePlanKey(planOf({}))).toBe(
      getOpenStackStatusPagePlanKey(planOf({})),
    );
  });

  test("a monitor added since, a region gone or a service gone is a different plan", () => {
    const before: string = getOpenStackStatusPagePlanKey(planOf({}));

    expect(
      getOpenStackStatusPagePlanKey(
        planOf({
          existing: [
            {
              id: "m1",
              name: "x",
              templateId: "openstack-compute-service-down",
              regionName: "RegionOne",
            },
          ],
        }),
      ),
    ).not.toBe(before);
    expect(
      getOpenStackStatusPagePlanKey(
        planOf({
          regions: [
            { regionName: "RegionOne", apiNames: ["compute", "identity"] },
          ],
        }),
      ),
    ).not.toBe(before);
    expect(getOpenStackStatusPagePlanKey(planOf({ regions: [] }))).not.toBe(
      before,
    );
  });
});

describe("a project's own page", () => {
  test("its rows are what it uses, in each region it is in", () => {
    const plan: OpenStackProjectPagePlan = buildOpenStackProjectPagePlan({
      projectName: "ou-payments",
      projectId: "aaaa",
      holdings: [
        {
          kind: OpenStackResourceKind.Volume,
          regionName: "RegionOne",
          count: 1,
        },
        {
          kind: OpenStackResourceKind.Instance,
          regionName: "RegionOne",
          count: 3,
        },
        {
          kind: OpenStackResourceKind.Router,
          regionName: "RegionOne",
          count: 1,
        },
        {
          kind: OpenStackResourceKind.FloatingIp,
          regionName: "RegionOne",
          count: 2,
        },
        {
          kind: OpenStackResourceKind.Instance,
          regionName: "RegionTwo",
          count: 1,
        },
      ],
    });

    expect(plan.name).toBe("ou-payments status");
    expect(
      plan.rows.map(
        (row: {
          regionName: string | null;
          service: string;
          holdingCount: number;
        }) => {
          return [row.regionName, row.service, row.holdingCount];
        },
      ),
    ).toEqual([
      ["RegionOne", "Compute", 3],
      ["RegionOne", "Networking", 3],
      ["RegionOne", "Block Storage", 1],
      ["RegionTwo", "Compute", 1],
    ]);
  });

  test("a project holding nothing has no rows, and a name it never had reads as its ID", () => {
    const plan: OpenStackProjectPagePlan = buildOpenStackProjectPagePlan({
      projectName: null,
      projectId: "aaaa",
      holdings: [],
    });

    expect(plan.rows).toEqual([]);
    expect(plan.name).toBe("aaaa status");
  });

  test("what isn't a row is not one", () => {
    expect(
      buildOpenStackProjectPagePlan({
        projectName: "x",
        projectId: "aaaa",
        holdings: [
          { kind: OpenStackResourceKind.Flavor, regionName: "R", count: 3 },
          { kind: OpenStackResourceKind.Instance, regionName: "R", count: 0 },
        ],
      }).rows,
    ).toEqual([]);
  });

  test("rows read back for what they hold", () => {
    expect(
      readOpenStackProjectPageRows([
        { monitorId: "m1", service: "Compute", regionName: "R" },
        { monitorId: "m2", service: "Compute" },
        { monitorId: "m3", service: "Not a service" },
        { service: "Compute" },
        null,
        "x",
      ]),
    ).toEqual([
      { monitorId: "m1", service: "Compute", regionName: "R" },
      { monitorId: "m2", service: "Compute", regionName: null },
    ]);
    expect(readOpenStackProjectPageRows(undefined)).toEqual([]);
  });
});

describe("which row a part belongs to, and what it is called to a tenant", () => {
  test.each<
    [
      string,
      { kind: string; name?: string; externalId?: string },
      OpenStackStatusPageService | null,
      string,
    ]
  >([
    [
      "a hypervisor",
      { kind: OpenStackResourceKind.Hypervisor, name: "compute-01.internal" },
      OpenStackStatusPageService.Compute,
      "A compute host",
    ],
    [
      "its nova-compute",
      {
        kind: OpenStackResourceKind.Service,
        name: "nova-compute",
        externalId: "R/compute/compute-01/nova-compute",
      },
      OpenStackStatusPageService.Compute,
      "A compute host",
    ],
    [
      "a scheduler",
      {
        kind: OpenStackResourceKind.Service,
        name: "nova-scheduler",
        externalId: "R/compute/c/nova-scheduler",
      },
      OpenStackStatusPageService.Compute,
      "A compute service",
    ],
    [
      "a Neutron agent",
      {
        kind: OpenStackResourceKind.Service,
        name: "neutron-l3-agent",
        externalId: "R/network/n/neutron-l3-agent",
      },
      OpenStackStatusPageService.Networking,
      "A networking service",
    ],
    [
      "a cinder-volume",
      {
        kind: OpenStackResourceKind.Service,
        name: "cinder-volume",
        externalId: "R/volume/s@lvm/cinder-volume",
      },
      OpenStackStatusPageService.BlockStorage,
      "A block storage service",
    ],
    [
      "a Heat engine",
      {
        kind: OpenStackResourceKind.Service,
        name: "heat-engine",
        externalId: "R/orchestration/h/heat-engine",
      },
      null,
      "A service",
    ],
    [
      "a router",
      { kind: OpenStackResourceKind.Router, name: "r1", externalId: "x" },
      OpenStackStatusPageService.Networking,
      "A router",
    ],
    [
      "a volume",
      { kind: OpenStackResourceKind.Volume, externalId: "x" },
      OpenStackStatusPageService.BlockStorage,
      "A volume",
    ],
    [
      "a storage pool",
      { kind: OpenStackResourceKind.StoragePool, name: "h@b#p" },
      OpenStackStatusPageService.BlockStorage,
      "A storage pool",
    ],
    [
      "an instance",
      { kind: OpenStackResourceKind.Instance, externalId: "x" },
      OpenStackStatusPageService.Compute,
      "An instance",
    ],
    [
      "Nova's API",
      { kind: OpenStackResourceKind.Api, name: "compute" },
      OpenStackStatusPageService.Compute,
      "The Compute API",
    ],
    [
      "Placement's API, which is how Compute schedules",
      { kind: OpenStackResourceKind.Api, name: "placement" },
      OpenStackStatusPageService.Compute,
      "The Placement API",
    ],
    [
      "Keystone's API",
      { kind: OpenStackResourceKind.Api, name: "identity" },
      OpenStackStatusPageService.Identity,
      "The Identity API",
    ],
    [
      "Glance's API",
      { kind: OpenStackResourceKind.Api, name: "image" },
      OpenStackStatusPageService.Images,
      "The Image API",
    ],
    [
      "an API there is no row for",
      { kind: OpenStackResourceKind.Api, name: "orchestration" },
      null,
      "The Orchestration API",
    ],
    [
      "a zone under maintenance",
      { kind: OpenStackMaintenancePartKind.AvailabilityZone },
      OpenStackStatusPageService.Compute,
      "An availability zone",
    ],
    [
      "what we can't place",
      { kind: "Something New" },
      null,
      "A part of the cloud",
    ],
  ])(
    "%s",
    (
      _name: string,
      part: { kind: string; name?: string; externalId?: string },
      service: OpenStackStatusPageService | null,
      words: string,
    ) => {
      expect(getOpenStackStatusPageServiceOfPart(part)).toBe(service);
      expect(describeOpenStackPartToAProject(part)).toBe(words);
    },
  );

  test("a host's name never reaches a tenant, whatever the part says", () => {
    expect(
      describeOpenStackPartToAProject({
        kind: OpenStackResourceKind.Hypervisor,
        name: "secret-host.internal",
        externalId: "R/secret-host.internal",
      }),
    ).not.toContain("secret-host");
    expect(
      describeOpenStackPartToAProject({
        kind: OpenStackResourceKind.Service,
        name: "nova-compute",
        externalId: "R/compute/secret-host/nova-compute",
      }),
    ).not.toContain("secret-host");
  });
});
