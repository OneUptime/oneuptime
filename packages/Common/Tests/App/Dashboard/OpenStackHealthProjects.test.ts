import { describe, expect, test } from "@jest/globals";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import { JSONObject } from "../../../Types/JSON";
import {
  OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT,
  isOpenStackQuotaAtLine,
} from "../../../Types/OpenStack/OpenStackHealthRules";
import {
  OPENSTACK_QUOTA_STALE_MINUTES,
  OpenStackQuotaResource,
  getOpenStackQuotaFactKey,
} from "../../../Types/OpenStack/OpenStackQuota";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackAssessment,
  assessOpenStackHost,
  assessOpenStackInstanceOnHost,
  assessOpenStackProject,
  assessOpenStackResource,
  getOpenStackAttentionItems,
  getOpenStackHealth,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackHealth";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";

/*
 * The lines this issue adds to the one set of rules: a project at its quota, on both
 * sides of the line, and what the map reads about a host and what runs on it.
 */

const NOW: Date = new Date("2026-11-04T12:00:00.000Z");
const WARNING: ResourceAttentionSeverity = ResourceAttentionSeverity.Warning;
const CRITICAL: ResourceAttentionSeverity = ResourceAttentionSeverity.Critical;

function reading(data: {
  used: number;
  limit: number;
  resource?: OpenStackQuotaResource;
  region?: string;
  minutesAgo?: number;
}): JSONObject {
  return {
    [getOpenStackQuotaFactKey(
      data.resource || OpenStackQuotaResource.Instances,
      data.region || "RegionOne",
    )]: {
      used: data.used,
      limit: data.limit,
      observedAt: new Date(
        NOW.getTime() - (data.minutesAgo || 0) * 60 * 1000,
      ).toISOString(),
    },
  };
}

function project(facts: JSONObject = {}): OpenStackResource {
  return Object.assign(new OpenStackResource(), {
    kind: OpenStackResourceKind.Project,
    externalId: "project-1",
    name: "ou-payments",
    openStackProjectId: "project-1",
    status: "enabled",
    facts,
  });
}

describe("the line", () => {
  test("is the one the alert template draws", () => {
    expect(OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT).toBe(90);
  });

  test.each([
    [89, 100, false],
    [90, 100, true],
    [100, 100, true],
    [9, 10, true],
    [8, 10, false],
    [1, 0, false],
    [0, 0, false],
    [5, -1, false],
  ])("%d of %d: %s", (used: number, limit: number, expected: boolean) => {
    expect(isOpenStackQuotaAtLine({ used, limit })).toBe(expected);
  });

  test("never drifts on a figure a division would round", () => {
    // 0.9 * 100 and its neighbours are where a percentage comparison goes wrong.
    for (let limit: number = 10; limit <= 1000; limit += 10) {
      expect(isOpenStackQuotaAtLine({ used: (limit / 10) * 9, limit })).toBe(
        true,
      );
      expect(
        isOpenStackQuotaAtLine({ used: (limit / 10) * 9 - 1, limit }),
      ).toBe(false);
    }
  });
});

describe("a project", () => {
  test("with no quota data has no opinion, which is most clouds", () => {
    expect(assessOpenStackProject({ row: project(), now: NOW }).severity).toBe(
      null,
    );
    expect(
      assessOpenStackProject({
        row: project({ domainId: "default", description: "x" }),
        now: NOW,
      }).severity,
    ).toBe(null);
  });

  test("under the line has no opinion", () => {
    expect(
      assessOpenStackProject({
        row: project(reading({ used: 89, limit: 100 })),
        now: NOW,
      }).severity,
    ).toBe(null);
  });

  test("on the line is a warning, and says what and how much", () => {
    const assessment: OpenStackAssessment = assessOpenStackProject({
      row: project(reading({ used: 9, limit: 10 })),
      now: NOW,
    });

    expect(assessment.severity).toBe(WARNING);
    expect(assessment.reasons[0]?.text).toBe(
      "{{used}} of {{limit}} instances used ({{percent}})",
    );
    expect(assessment.reasons[0]?.values).toEqual({
      used: "9",
      limit: "10",
      percent: "90%",
    });
  });

  test("past its quota is still a warning: nothing it runs has stopped", () => {
    expect(
      assessOpenStackProject({
        row: project(reading({ used: 12, limit: 10 })),
        now: NOW,
      }).severity,
    ).toBe(WARNING);
  });

  test("with no limit is never at it, however much it runs", () => {
    expect(
      assessOpenStackProject({
        row: project(reading({ used: 100000, limit: -1 })),
        now: NOW,
      }).severity,
    ).toBe(null);
  });

  test("whose quotas stopped being read is not left at them", () => {
    expect(
      assessOpenStackProject({
        row: project(
          reading({
            used: 10,
            limit: 10,
            minutesAgo: OPENSTACK_QUOTA_STALE_MINUTES + 1,
          }),
        ),
        now: NOW,
      }).severity,
    ).toBe(null);
  });

  test("gives a reason for each quota at the line, and none for the rest", () => {
    const assessment: OpenStackAssessment = assessOpenStackProject({
      row: project({
        ...reading({ used: 10, limit: 10 }),
        ...reading({
          used: 1,
          limit: 100,
          resource: OpenStackQuotaResource.Cores,
        }),
        ...reading({
          used: 95,
          limit: 100,
          resource: OpenStackQuotaResource.FloatingIps,
        }),
      }),
      now: NOW,
    });

    expect(assessment.reasons).toHaveLength(2);
    expect(assessment.reasons[1]?.text).toBe(
      "{{used}} of {{limit}} floating IPs used ({{percent}})",
    );
  });

  test("names the region only when there is more than one to tell apart", () => {
    const assessment: OpenStackAssessment = assessOpenStackProject({
      row: project({
        ...reading({ used: 10, limit: 10, region: "RegionOne" }),
        ...reading({ used: 1, limit: 10, region: "RegionTwo" }),
      }),
      now: NOW,
    });

    expect(assessment.reasons[0]?.text).toBe(
      "{{used}} of {{limit}} instances used in {{region}} ({{percent}})",
    );
    expect(assessment.reasons[0]?.values?.["region"]).toBe("RegionOne");
  });

  test("assessOpenStackResource reads it by kind", () => {
    expect(
      assessOpenStackResource({
        row: project(reading({ used: 10, limit: 10 })),
        now: NOW,
      }).severity,
    ).toBe(WARNING);
  });
});

describe("Needs attention", () => {
  test("a project at a quota is on it, under its own name and kind", () => {
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: [project(reading({ used: 10, limit: 10 }))],
      now: NOW,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("Project");
    expect(items[0]?.name).toBe("ou-payments");
    expect(items[0]?.severity).toBe(WARNING);
    expect(getOpenStackHealth(items)).toBe("Degraded");
  });

  test("a project without quota data is not, and does not change the verdict", () => {
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: [project()],
      now: NOW,
    });

    expect(items).toEqual([]);
    expect(getOpenStackHealth(items)).toBe("Healthy");
  });

  test("it comes after what has actually broken", () => {
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: [
        project(reading({ used: 10, limit: 10 })),
        Object.assign(new OpenStackResource(), {
          kind: OpenStackResourceKind.Instance,
          externalId: "instance-1",
          name: "ou-failed",
          status: "ERROR",
        }),
      ],
      now: NOW,
    });

    expect(
      items.map((item: ResourceAttentionItem) => {
        return item.kind;
      }),
    ).toEqual(["Instance", "Project"]);
  });
});

describe("a host, for what draws a hypervisor as one thing", () => {
  const hypervisor = (fields: Partial<OpenStackResource> = {}) => {
    return Object.assign(new OpenStackResource(), {
      kind: OpenStackResourceKind.Hypervisor,
      externalId: "RegionOne/compute-1.example.internal",
      name: "compute-1.example.internal",
      hypervisorName: "compute-1.example.internal",
      regionName: "RegionOne",
      status: "up",
      adminState: "enabled",
      ...fields,
    });
  };
  const compute = (fields: Partial<OpenStackResource> = {}) => {
    return Object.assign(new OpenStackResource(), {
      kind: OpenStackResourceKind.Service,
      externalId: "RegionOne/compute/compute-1/nova-compute",
      name: "nova-compute",
      status: "up",
      adminState: "enabled",
      ...fields,
    });
  };

  test("is down when its nova-compute is, and says how many it held", () => {
    const assessment: OpenStackAssessment = assessOpenStackHost({
      hypervisor: hypervisor(),
      compute: compute({ status: "down" }),
      instanceCount: 42,
      now: NOW,
    });

    expect(assessment.severity).toBe(CRITICAL);
    expect(assessment.reasons[0]?.values?.["count"]).toBe("42");
  });

  test("falls back on its own row when no worker row is held", () => {
    const assessment: OpenStackAssessment = assessOpenStackHost({
      hypervisor: hypervisor({ status: "down" }),
      now: NOW,
    });

    expect(assessment.severity).toBe(CRITICAL);
  });

  test("someone disabling it is planned work, however full it is", () => {
    expect(
      assessOpenStackHost({
        hypervisor: hypervisor({ vcpuAllocated: 100, vcpuCapacity: 100 }),
        compute: compute({ status: "down", adminState: "disabled" }),
        instanceCount: 42,
        now: NOW,
      }).severity,
    ).toBeNull();
  });

  test("otherwise it is how full it is, and never more than a warning", () => {
    expect(
      assessOpenStackHost({
        hypervisor: hypervisor({ vcpuAllocated: 99, vcpuCapacity: 100 }),
        compute: compute(),
        now: NOW,
      }).severity,
    ).toBe(WARNING);
    expect(
      assessOpenStackHost({
        hypervisor: hypervisor({ vcpuAllocated: 50, vcpuCapacity: 100 }),
        compute: compute(),
        now: NOW,
      }).severity,
    ).toBeNull();
  });
});

describe("an instance on a host", () => {
  const instance = (status: string) => {
    return Object.assign(new OpenStackResource(), {
      kind: OpenStackResourceKind.Instance,
      externalId: "instance-1",
      status,
    });
  };

  test("that is up is as it says", () => {
    expect(
      assessOpenStackInstanceOnHost({
        row: instance("ACTIVE"),
        now: NOW,
        isHostDown: false,
      }).severity,
    ).toBeNull();
  });

  test("that is down needs a look, whatever Nova still says about it", () => {
    const assessment: OpenStackAssessment = assessOpenStackInstanceOnHost({
      row: instance("ACTIVE"),
      now: NOW,
      isHostDown: true,
    });

    expect(assessment.severity).toBe(WARNING);
    expect(assessment.reasons[0]?.text).toBe("Its hypervisor is down");
  });

  test("shut off on purpose loses nothing when its host goes", () => {
    expect(
      assessOpenStackInstanceOnHost({
        row: instance("SHUTOFF"),
        now: NOW,
        isHostDown: true,
      }).severity,
    ).toBeNull();
  });

  test("in ERROR already keeps its own reason as well", () => {
    expect(
      assessOpenStackInstanceOnHost({
        row: instance("ERROR"),
        now: NOW,
        isHostDown: true,
      }).reasons,
    ).toHaveLength(2);
  });
});
