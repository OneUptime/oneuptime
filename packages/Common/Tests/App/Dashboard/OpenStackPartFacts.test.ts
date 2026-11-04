import { describe, expect, test } from "@jest/globals";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import { JSONObject } from "../../../Types/JSON";
import { OpenStackCountRow } from "../../../Types/OpenStack/OpenStackCounts";
import {
  getAllOpenStackAlertTemplates,
  OpenStackAlertTemplate,
} from "../../../Types/Monitor/OpenStackAlertTemplates";
import {
  OPENSTACK_ALLOCATION_WARNING_PERCENT,
  OPENSTACK_IMAGE_STUCK_MINUTES,
  OPENSTACK_INSTANCE_STUCK_MINUTES,
  OPENSTACK_IP_POOL_WARNING_PERCENT,
  OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT,
  OPENSTACK_STORAGE_POOL_WARNING_PERCENT,
  OPENSTACK_VOLUME_STUCK_MINUTES,
} from "../../../Types/OpenStack/OpenStackHealthRules";
import {
  OPENSTACK_IMAGE_TRANSITIONAL_STATUSES,
  OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES,
  OPENSTACK_VOLUME_ERROR_STATUSES,
  OPENSTACK_VOLUME_TRANSITIONAL_STATUSES,
  OpenStackResourceKind,
} from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_IMAGE_STATE_PRESETS,
  OPENSTACK_INSTANCE_STATE_PRESETS,
  OPENSTACK_VOLUME_STATE_PRESETS,
  OpenStackStatePreset,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackListFacets";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import { ResourcePartStatus } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartTypes";
import { getOpenStackAttentionItems } from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackHealth";
import {
  OPENSTACK_FLOATING_IP_ALERT_TEMPLATE_IDS,
  OPENSTACK_HYPERVISOR_ALERT_TEMPLATE_IDS,
  OPENSTACK_INSTANCE_ALERT_TEMPLATE_IDS,
  OPENSTACK_NETWORK_AGENT_ALERT_TEMPLATE_IDS,
  OPENSTACK_NETWORK_ALERT_TEMPLATE_IDS,
  OPENSTACK_ROUTER_ALERT_TEMPLATE_IDS,
  OPENSTACK_STORAGE_POOL_ALERT_TEMPLATE_IDS,
  OPENSTACK_VOLUME_ALERT_TEMPLATE_IDS,
  OpenStackAllocationLine,
  OpenStackForecast,
  OpenStackGrowthSample,
  OpenStackHostGroup,
  OpenStackRowState,
  OpenStackSubnetAddresses,
  canOpenStackHypervisorGive,
  formatOpenStackAllocationRatio,
  getOpenStackAddressesFree,
  getOpenStackAddressesTone,
  getOpenStackAllocationLines,
  getOpenStackEmptyWords,
  getOpenStackFlavorExternalId,
  getOpenStackFlavorId,
  getOpenStackFloatingIpAssociation,
  getOpenStackForecast,
  getOpenStackHostGroupId,
  getOpenStackCountTotals,
  getOpenStackHostGroups,
  getOpenStackHypervisorExternalId,
  getOpenStackInstanceAddresses,
  getOpenStackL3AgentExternalId,
  getOpenStackNetworkBackend,
  getOpenStackNetworkSubnets,
  getOpenStackPartExplanation,
  getOpenStackPartName,
  getOpenStackPartStatus,
  getOpenStackRouterAgentReading,
  getOpenStackRowState,
  getOpenStackSubnetAddresses,
  getOpenStackTimeInState,
  isOpenStackHypervisorLost,
  isOpenStackInstanceUnplaced,
  isOpenStackIssueAbout,
  isOpenStackIssueAboutHosts,
  isOpenStackL3Agent,
  isOpenStackListPossiblyOneProject,
  isOpenStackNetworkAgent,
  isOpenStackNetworkExternal,
  isOpenStackNetworkShared,
  parseOpenStackAggregates,
  parseOpenStackHostGroupId,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackPartFacts";
import {
  OPENSTACK_RECORDING_NOW,
  OpenStackRecording,
  getOpenStackDrilledReleases,
  getOpenStackReleases,
} from "../../Helpers/OpenStackRecordings";

/*
 * What a part of an OpenStack cloud is, in the words its pages use: every state of every
 * kind, at the rules' own lines, then on what real clouds said. A guess about OpenStack
 * gets caught in the second half: the short and full host names, an IPv6 subnet beside a
 * full IPv4 pool, and a failed instance with no hypervisor were all found that way.
 */

const NOW: Date = new Date("2026-11-04T12:00:00.000Z");
const GIB: number = 1024 * 1024 * 1024;

type RowFields = {
  [Key in keyof OpenStackResource]?: OpenStackResource[Key] | undefined;
};

function row(fields: RowFields): OpenStackResource {
  return Object.assign(new OpenStackResource(), fields);
}

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

function stateOf(fields: RowFields): OpenStackRowState {
  const state: OpenStackRowState | null = getOpenStackRowState(
    row(fields),
    NOW,
  );
  if (!state) {
    throw new Error("Expected a state");
  }
  return state;
}

function reasonsOf(state: OpenStackRowState): Array<string> {
  return state.reasons.map((reason: { text: string }): string => {
    return reason.text;
  });
}

describe("a hypervisor's state", () => {
  test("up reads Nova's word, in green", () => {
    const state: OpenStackRowState = stateOf({
      kind: OpenStackResourceKind.Hypervisor,
      status: "up",
      adminState: "enabled",
    });
    expect(state.label).toBe("up");
    expect(state.isOpenStackWord).toBe(true);
    expect(state.tone).toBe("positive");
    expect(state.reasons).toEqual([]);
  });

  test("a stopped nova-compute reads Lost, in red, and says its numbers are last known", () => {
    const state: OpenStackRowState = stateOf({
      kind: OpenStackResourceKind.Hypervisor,
      status: "down",
      adminState: "enabled",
      vcpuAllocated: 10,
      vcpuCapacity: 100,
    });
    expect(state.label).toBe("Lost");
    expect(state.isOpenStackWord).toBe(false);
    expect(state.tone).toBe("danger");
    expect(reasonsOf(state)).toEqual([
      "nova-compute is down. Its numbers are last known",
    ]);
  });

  test("one someone disabled reads Disabled with their reason, never Lost or red, however down it is", () => {
    for (const status of ["up", "down"]) {
      const state: OpenStackRowState = stateOf({
        kind: OpenStackResourceKind.Hypervisor,
        status,
        adminState: "disabled",
        disabledReason: "Hardware swap, CHG-1042",
      });
      expect(state.label).toBe("Disabled");
      expect(state.tone).toBe("neutral");
      expect(state.writtenReason).toBe("Hardware swap, CHG-1042");
      expect(state.reasons).toEqual([]);
    }
  });

  test("past the allocation templates' line it stays up, in amber, and says which", () => {
    const line: number = OPENSTACK_ALLOCATION_WARNING_PERCENT;
    const atLine: OpenStackRowState = stateOf({
      kind: OpenStackResourceKind.Hypervisor,
      status: "up",
      adminState: "enabled",
      vcpuAllocated: line,
      vcpuCapacity: 100,
    });
    expect(atLine.tone).toBe("positive");
    expect(atLine.reasons).toEqual([]);

    const pastLine: OpenStackRowState = stateOf({
      kind: OpenStackResourceKind.Hypervisor,
      status: "up",
      adminState: "enabled",
      vcpuAllocated: line + 1,
      vcpuCapacity: 100,
      memoryAllocatedBytes: 95,
      memoryCapacityBytes: 100,
    });
    expect(pastLine.label).toBe("up");
    expect(pastLine.tone).toBe("warning");
    expect(reasonsOf(pastLine)).toEqual([
      "{{percent}} of vCPUs allocated",
      "{{percent}} of memory allocated",
    ]);
  });

  test("a lost hypervisor's last numbers never read as over the line", () => {
    const state: OpenStackRowState = stateOf({
      kind: OpenStackResourceKind.Hypervisor,
      status: "down",
      adminState: "enabled",
      vcpuAllocated: 99,
      vcpuCapacity: 100,
    });
    expect(reasonsOf(state)).not.toContain("{{percent}} of vCPUs allocated");
  });

  test("no state at all has nothing to say, and is not read as fine", () => {
    expect(
      getOpenStackRowState(
        row({ kind: OpenStackResourceKind.Hypervisor }),
        NOW,
      ),
    ).toBeNull();
    expect(
      getOpenStackPartStatus(
        row({ kind: OpenStackResourceKind.Hypervisor }),
        NOW,
      ),
    ).toBeNull();
  });
});

describe("an instance's state", () => {
  test.each([
    ["ACTIVE", "positive"],
    ["ERROR", "danger"],
    ["SHUTOFF", "neutral"],
    ["PAUSED", "neutral"],
    ["SUSPENDED", "neutral"],
    ["SHELVED", "neutral"],
    ["SHELVED_OFFLOADED", "neutral"],
    ["UNKNOWN", "warning"],
    ["A_WORD_NOVA_ADDED_LAST_WEEK", "neutral"],
  ])("%s reads as written, %s", (status: string, tone: string) => {
    const state: OpenStackRowState = stateOf({
      kind: OpenStackResourceKind.Instance,
      status,
      stateChangedAt: minutesAgo(1000),
    });
    expect(state.label).toBe(status);
    expect(state.isOpenStackWord).toBe(true);
    expect(state.tone).toBe(tone);
  });

  test("ERROR doesn't say so twice", () => {
    expect(
      stateOf({
        kind: OpenStackResourceKind.Instance,
        status: "ERROR",
      }).reasons,
    ).toEqual([]);
  });

  test.each(Array.from(OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES))(
    "%s on its way reads as written and neutral, until the line, then Stuck in amber",
    (status: string) => {
      const fresh: OpenStackRowState = stateOf({
        kind: OpenStackResourceKind.Instance,
        status,
        stateChangedAt: minutesAgo(OPENSTACK_INSTANCE_STUCK_MINUTES - 1),
      });
      expect(fresh.label).toBe(status);
      expect(fresh.tone).toBe("neutral");
      expect(fresh.reasons).toEqual([]);

      const stuck: OpenStackRowState = stateOf({
        kind: OpenStackResourceKind.Instance,
        status,
        stateChangedAt: minutesAgo(OPENSTACK_INSTANCE_STUCK_MINUTES),
      });
      expect(stuck.label).toBe("Stuck");
      expect(stuck.isOpenStackWord).toBe(false);
      expect(stuck.tone).toBe("warning");
      expect(stuck.reasons).toEqual([
        {
          text: "{{status}} for {{duration}}",
          values: { status, duration: "60m" },
        },
      ]);
    },
  );

  test("with no time to read it stays what it is, and is not called stuck on a guess", () => {
    const state: OpenStackRowState = stateOf({
      kind: OpenStackResourceKind.Instance,
      status: "BUILD",
    });
    expect(state.label).toBe("BUILD");
    expect(state.tone).toBe("neutral");
  });

  test("someone's shut-off instance is never stuck, however long ago", () => {
    expect(
      stateOf({
        kind: OpenStackResourceKind.Instance,
        status: "SHUTOFF",
        stateChangedAt: minutesAgo(100000),
      }).label,
    ).toBe("SHUTOFF");
  });
});

describe("a volume's state", () => {
  test.each(Array.from(OPENSTACK_VOLUME_ERROR_STATUSES))(
    "%s reads as failed, in red, without saying so twice",
    (status: string) => {
      const state: OpenStackRowState = stateOf({
        kind: OpenStackResourceKind.Volume,
        status,
      });
      expect(state.label).toBe(status);
      expect(state.tone).toBe("danger");
      expect(state.reasons).toEqual([]);
    },
  );

  test.each(Array.from(OPENSTACK_VOLUME_TRANSITIONAL_STATUSES))(
    "%s stays as it is until the line, then reads Stuck",
    (status: string) => {
      expect(
        stateOf({
          kind: OpenStackResourceKind.Volume,
          status,
          stateChangedAt: minutesAgo(OPENSTACK_VOLUME_STUCK_MINUTES - 1),
        }),
      ).toMatchObject({ label: status, tone: "neutral" });
      expect(
        stateOf({
          kind: OpenStackResourceKind.Volume,
          status,
          stateChangedAt: minutesAgo(OPENSTACK_VOLUME_STUCK_MINUTES),
        }),
      ).toMatchObject({ label: "Stuck", tone: "warning" });
    },
  );

  test.each([
    ["available", "positive"],
    ["in-use", "positive"],
  ])("%s is fine", (status: string, tone: string) => {
    expect(
      stateOf({
        kind: OpenStackResourceKind.Volume,
        status,
        stateChangedAt: minutesAgo(100000),
      }),
    ).toMatchObject({ label: status, tone, reasons: [] });
  });
});

describe("an image's state", () => {
  test.each(Array.from(OPENSTACK_IMAGE_TRANSITIONAL_STATUSES))(
    "%s stays as it is until the line, then reads Stuck",
    (status: string) => {
      expect(
        stateOf({
          kind: OpenStackResourceKind.Image,
          status,
          stateChangedAt: minutesAgo(OPENSTACK_IMAGE_STUCK_MINUTES - 1),
        }),
      ).toMatchObject({ label: status, tone: "neutral" });
      expect(
        stateOf({
          kind: OpenStackResourceKind.Image,
          status,
          stateChangedAt: minutesAgo(OPENSTACK_IMAGE_STUCK_MINUTES),
        }),
      ).toMatchObject({ label: "Stuck", tone: "warning" });
    },
  );

  test("pending_delete is where delayed delete holds one on purpose: never stuck", () => {
    expect(
      stateOf({
        kind: OpenStackResourceKind.Image,
        status: "pending_delete",
        stateChangedAt: minutesAgo(100000),
      }).label,
    ).toBe("pending_delete");
  });

  test("active is fine, and killed is a failure", () => {
    expect(
      stateOf({ kind: OpenStackResourceKind.Image, status: "active" }).tone,
    ).toBe("positive");
    expect(
      stateOf({ kind: OpenStackResourceKind.Image, status: "killed" }).tone,
    ).toBe("danger");
  });
});

describe("a storage pool's state is how full it is, at the templates' two lines", () => {
  function poolAt(percent: number): OpenStackRowState {
    return stateOf({
      kind: OpenStackResourceKind.StoragePool,
      diskAllocatedBytes: percent,
      diskCapacityBytes: 100,
    });
  }

  test("up to the warning line it has room", () => {
    expect(poolAt(OPENSTACK_STORAGE_POOL_WARNING_PERCENT)).toMatchObject({
      label: "Has room",
      tone: "positive",
    });
  });

  test("past the warning line it is filling up", () => {
    expect(poolAt(OPENSTACK_STORAGE_POOL_WARNING_PERCENT + 1)).toMatchObject({
      label: "Filling up",
      tone: "warning",
    });
    expect(poolAt(OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT)).toMatchObject({
      label: "Filling up",
      tone: "warning",
    });
  });

  test("past the critical line it is nearly full", () => {
    expect(poolAt(OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT + 1)).toMatchObject({
      label: "Nearly full",
      tone: "danger",
    });
  });

  test("how full is said once, by the Used column", () => {
    expect(poolAt(99).reasons).toEqual([]);
  });

  test("a pool that reports no size says nothing, and never 0%", () => {
    expect(
      getOpenStackRowState(
        row({ kind: OpenStackResourceKind.StoragePool }),
        NOW,
      ),
    ).toBeNull();
  });
});

describe("a network's state", () => {
  function externalAt(used: number): RowFields {
    return {
      kind: OpenStackResourceKind.Network,
      status: "ACTIVE",
      facts: { isExternal: true, ipsUsed: used, ipsTotal: 100 },
    };
  }

  test("an external pool is amber past the line and red with none left", () => {
    expect(stateOf(externalAt(OPENSTACK_IP_POOL_WARNING_PERCENT)).tone).toBe(
      "positive",
    );
    expect(
      stateOf(externalAt(OPENSTACK_IP_POOL_WARNING_PERCENT + 1)),
    ).toMatchObject({
      label: "ACTIVE",
      tone: "warning",
    });
    expect(stateOf(externalAt(100))).toMatchObject({
      label: "ACTIVE",
      tone: "danger",
    });
  });

  test("a tenant's own full network asks nothing of anyone", () => {
    expect(
      stateOf({
        kind: OpenStackResourceKind.Network,
        status: "ACTIVE",
        facts: { isExternal: false, ipsUsed: 100, ipsTotal: 100 },
      }),
    ).toMatchObject({ tone: "positive", reasons: [] });
  });
});

describe("a router's state", () => {
  const AGENT_ALIVE: JSONObject = {
    host: "net-01",
    isAlive: true,
    isAdminUp: true,
    haState: "active",
  };
  const AGENT_DEAD: JSONObject = {
    host: "net-02",
    isAlive: false,
    isAdminUp: true,
    haState: "standby",
  };

  test("no alive agent is critical, whatever its own word says", () => {
    expect(
      stateOf({
        kind: OpenStackResourceKind.Router,
        status: "ACTIVE",
        adminState: "up",
        facts: { l3Agents: { a: AGENT_DEAD } },
      }),
    ).toMatchObject({
      label: "ACTIVE",
      tone: "danger",
      reasons: [{ text: "No alive L3 agent" }],
    });
  });

  test("two active agents are a split brain", () => {
    expect(
      stateOf({
        kind: OpenStackResourceKind.Router,
        status: "ACTIVE",
        adminState: "up",
        facts: { l3Agents: { a: AGENT_ALIVE, b: AGENT_ALIVE } },
      }),
    ).toMatchObject({
      tone: "danger",
      reasons: [{ text: "Two active L3 agents" }],
    });
  });

  test("not ACTIVE is a warning, and its word isn't said twice", () => {
    expect(
      stateOf({
        kind: OpenStackResourceKind.Router,
        status: "ERROR",
        adminState: "up",
      }),
    ).toMatchObject({ label: "ERROR", tone: "danger", reasons: [] });
    expect(
      stateOf({
        kind: OpenStackResourceKind.Router,
        status: "DOWN",
        adminState: "up",
      }),
    ).toMatchObject({ label: "DOWN", tone: "warning", reasons: [] });
  });

  test("one someone set down is planned work, even with its agents dead", () => {
    expect(
      stateOf({
        kind: OpenStackResourceKind.Router,
        status: "ACTIVE",
        adminState: "down",
        facts: { l3Agents: { a: AGENT_DEAD } },
      }),
    ).toMatchObject({ label: "Disabled", tone: "neutral", reasons: [] });
  });

  test("on OVN there are no agents, and nothing is wrong", () => {
    expect(
      stateOf({
        kind: OpenStackResourceKind.Router,
        status: "ACTIVE",
        adminState: "up",
      }),
    ).toMatchObject({ label: "ACTIVE", tone: "positive", reasons: [] });
  });
});

describe("a floating IP's state", () => {
  test("in use and ACTIVE is fine", () => {
    expect(
      stateOf({
        kind: OpenStackResourceKind.FloatingIp,
        status: "ACTIVE",
        facts: { routerId: "r" },
      }),
    ).toMatchObject({ label: "ACTIVE", tone: "positive", reasons: [] });
  });

  test("a spare one is DOWN by design, which is nothing to look at", () => {
    expect(
      stateOf({
        kind: OpenStackResourceKind.FloatingIp,
        status: "DOWN",
        facts: { routerId: null },
      }),
    ).toMatchObject({ label: "DOWN", tone: "neutral", reasons: [] });
  });

  test("associated and not active is what to look at", () => {
    expect(
      stateOf({
        kind: OpenStackResourceKind.FloatingIp,
        status: "DOWN",
        facts: { routerId: "r" },
      }),
    ).toMatchObject({
      label: "DOWN",
      tone: "warning",
      reasons: [{ text: "Associated, but not active" }],
    });
  });

  test.each([
    ["DOWN", { routerId: null }, "unassociated"],
    ["ACTIVE", {}, "unassociated"],
    ["ACTIVE", { routerId: "r" }, "associated"],
    ["DOWN", { routerId: "r" }, "associated-not-active"],
    ["ERROR", { portId: "p" }, "associated-not-active"],
    [undefined, { routerId: "r" }, "associated"],
  ])(
    "status %s with %j reads %s",
    (status: string | undefined, facts: JSONObject, association: string) => {
      expect(
        getOpenStackFloatingIpAssociation(
          row({ kind: OpenStackResourceKind.FloatingIp, status, facts }),
        ),
      ).toBe(association);
    },
  );
});

describe("a snapshot's and a backup's state", () => {
  test.each([
    [OpenStackResourceKind.Snapshot, "available", "positive"],
    [OpenStackResourceKind.Snapshot, "error", "danger"],
    [OpenStackResourceKind.Backup, "available", "positive"],
    [OpenStackResourceKind.Backup, "error", "danger"],
    [OpenStackResourceKind.Backup, "a-new-word", "neutral"],
  ])(
    "%s %s reads %s",
    (kind: OpenStackResourceKind, status: string, tone: string) => {
      expect(stateOf({ kind, status }).tone).toBe(tone);
    },
  );
});

describe("the hero's status", () => {
  test("OpenStack's word goes through a template with no words of its own, so it reads as written", () => {
    const status: ResourcePartStatus | null = getOpenStackPartStatus(
      row({ kind: OpenStackResourceKind.Instance, status: "ACTIVE" }),
      NOW,
    );
    expect(status).toEqual({
      label: "{{status}}",
      values: { status: "ACTIVE" },
      tone: "positive",
    });
  });

  test("our own word goes to be looked up", () => {
    expect(
      getOpenStackPartStatus(
        row({
          kind: OpenStackResourceKind.Hypervisor,
          status: "down",
          adminState: "enabled",
        }),
        NOW,
      ),
    ).toEqual({ label: "Lost", tone: "danger" });
  });
});

describe("how long a part has been in its state", () => {
  test.each([
    [1, "1m"],
    [119, "119m"],
    [120, "2h"],
    [47 * 60, "47h"],
    [48 * 60, "2d"],
  ])("%i minutes reads %s", (minutes: number, text: string) => {
    expect(
      getOpenStackTimeInState({ stateChangedAt: minutesAgo(minutes) }, NOW),
    ).toBe(text);
  });

  test("a date off the wire reads the same", () => {
    expect(
      getOpenStackTimeInState(
        { stateChangedAt: minutesAgo(5).toISOString() as unknown as Date },
        NOW,
      ),
    ).toBe("5m");
  });

  test("no time says nothing", () => {
    expect(getOpenStackTimeInState({}, NOW)).toBe("");
  });
});

describe("what is promised on a hypervisor", () => {
  const HYPERVISOR: RowFields = {
    kind: OpenStackResourceKind.Hypervisor,
    status: "up",
    adminState: "enabled",
    vcpuAllocated: 12,
    vcpuCapacity: 64,
    memoryAllocatedBytes: 95 * GIB,
    memoryCapacityBytes: 100 * GIB,
    diskAllocatedBytes: 10 * GIB,
    diskCapacityBytes: 100 * GIB,
    facts: { allocationRatios: { VCPU: 16, MEMORY_MB: 1.5, DISK_GB: 1 } },
  };

  function lines(fields: RowFields): Record<string, OpenStackAllocationLine> {
    return Object.fromEntries(
      getOpenStackAllocationLines(row(fields)).map(
        (line: OpenStackAllocationLine) => {
          return [line.key, line];
        },
      ),
    );
  }

  test("always says allocated, never CPU", () => {
    expect(
      getOpenStackAllocationLines(row(HYPERVISOR)).map(
        (line: OpenStackAllocationLine) => {
          return line.title;
        },
      ),
    ).toEqual(["vCPUs allocated", "Memory allocated", "Local disk allocated"]);
  });

  test("reads what is promised, out of what can be, at Placement's ratio", () => {
    const vcpu: OpenStackAllocationLine = lines(HYPERVISOR)["vcpu"]!;
    expect(vcpu).toMatchObject({ taken: 12, capacity: 64, ratio: 16 });
    expect(vcpu.percent).toBeCloseTo(18.75);
    expect(vcpu.isOverLine).toBe(false);
    expect(lines(HYPERVISOR)["memory"]).toMatchObject({
      ratio: 1.5,
      isOverLine: true,
    });
  });

  test("Nova's numbers have no ratio, and none is made up", () => {
    expect(lines({ ...HYPERVISOR, facts: {} })["vcpu"]?.ratio).toBeNull();
  });

  test("a lost hypervisor's lines are last known, and never over the line", () => {
    const lost: RowFields = { ...HYPERVISOR, status: "down" };
    expect(lines(lost)["memory"]).toMatchObject({
      isLastKnown: true,
      isOverLine: false,
    });
    expect(lines(HYPERVISOR)["memory"]?.isLastKnown).toBe(false);
  });

  test("no capacity reads no percent, never 0%", () => {
    expect(
      lines({ kind: OpenStackResourceKind.Hypervisor, vcpuAllocated: 5 })[
        "vcpu"
      ],
    ).toMatchObject({ taken: 5, capacity: null, percent: null });
  });

  test.each([
    [16, "16:1"],
    [1.5, "1.5:1"],
    [1, "1:1"],
    [null, ""],
  ])("a ratio of %s reads %s", (ratio: number | null, text: string) => {
    expect(formatOpenStackAllocationRatio(ratio)).toBe(text);
  });

  test("who can give: not a host Nova lost, not one someone disabled", () => {
    expect(
      canOpenStackHypervisorGive({ status: "up", adminState: "enabled" }),
    ).toBe(true);
    expect(
      canOpenStackHypervisorGive({ status: "down", adminState: "enabled" }),
    ).toBe(false);
    expect(
      canOpenStackHypervisorGive({ status: "up", adminState: "disabled" }),
    ).toBe(false);
    expect(
      canOpenStackHypervisorGive({ status: "down", adminState: "disabled" }),
    ).toBe(false);
  });

  test("lost means an enabled hypervisor whose nova-compute is down, and nothing else", () => {
    expect(
      isOpenStackHypervisorLost({
        kind: OpenStackResourceKind.Hypervisor,
        status: "down",
        adminState: "enabled",
      }),
    ).toBe(true);
    expect(
      isOpenStackHypervisorLost({
        kind: OpenStackResourceKind.Hypervisor,
        status: "down",
        adminState: "disabled",
      }),
    ).toBe(false);
    expect(
      isOpenStackHypervisorLost({
        kind: OpenStackResourceKind.Service,
        status: "down",
        adminState: "enabled",
      }),
    ).toBe(false);
  });
});

describe("how rows name each other", () => {
  test("a hypervisor and a flavor are keyed by their region", () => {
    expect(getOpenStackHypervisorExternalId("RegionOne", "c1.example")).toBe(
      "RegionOne/c1.example",
    );
    expect(getOpenStackFlavorExternalId("RegionOne", "m1")).toBe(
      "RegionOne/m1",
    );
    expect(getOpenStackFlavorExternalId(undefined, "m1")).toBe("default/m1");
  });

  test("a flavor's own id comes back without its region, even when it holds a slash", () => {
    expect(
      getOpenStackFlavorId({
        externalId: "RegionOne/a/b",
        regionName: "RegionOne",
      }),
    ).toBe("a/b");
    expect(getOpenStackFlavorId({ externalId: "default/m1" })).toBe("m1");
    expect(
      getOpenStackFlavorId({ externalId: "m1", regionName: "RegionOne" }),
    ).toBe("m1");
  });

  test("a part goes by its name, or the end of its id", () => {
    expect(getOpenStackPartName({ name: "web-01" }, "abc")).toBe("web-01");
    expect(getOpenStackPartName(null, "RegionOne/compute-01")).toBe(
      "compute-01",
    );
    expect(getOpenStackPartName({}, "abc")).toBe("abc");
  });

  test("a zone's id comes apart at its first slash, whatever its name holds", () => {
    expect(getOpenStackHostGroupId("RegionOne", "a/b")).toBe("RegionOne/a/b");
    expect(parseOpenStackHostGroupId("RegionOne/a/b")).toEqual({
      regionName: "RegionOne",
      name: "a/b",
    });
    expect(parseOpenStackHostGroupId("nova")).toEqual({
      regionName: "",
      name: "nova",
    });
  });
});

describe("zones and aggregates add up from their hypervisors", () => {
  function hypervisor(name: string, fields: RowFields = {}): OpenStackResource {
    return row({
      kind: OpenStackResourceKind.Hypervisor,
      externalId: `RegionOne/${name}.example`,
      name: `${name}.example`,
      hypervisorName: `${name}.example`,
      regionName: "RegionOne",
      availabilityZone: "az1",
      status: "up",
      adminState: "enabled",
      vcpuAllocated: 10,
      vcpuCapacity: 100,
      memoryAllocatedBytes: GIB,
      memoryCapacityBytes: 10 * GIB,
      diskAllocatedBytes: GIB,
      diskCapacityBytes: 10 * GIB,
      instanceCount: 3,
      ...fields,
    });
  }

  function computeService(
    name: string,
    fields: RowFields = {},
  ): OpenStackResource {
    return row({
      kind: OpenStackResourceKind.Service,
      externalId: `RegionOne/compute/${name}/nova-compute`,
      name: "nova-compute",
      regionName: "RegionOne",
      status: "up",
      adminState: "enabled",
      facts: { family: "compute", host: name },
      ...fields,
    });
  }

  function zones(rows: Array<OpenStackResource>): Array<OpenStackHostGroup> {
    return getOpenStackHostGroups({ rows, kind: "zone", now: NOW });
  }

  test("counts each state, and what can be given only from who can give it", () => {
    const [zone]: Array<OpenStackHostGroup> = zones([
      hypervisor("a"),
      hypervisor("b", { status: "down" }),
      hypervisor("c", { adminState: "disabled", status: "down" }),
    ]);
    expect(zone).toMatchObject({
      name: "az1",
      total: 3,
      up: 1,
      lost: 1,
      disabled: 1,
      vcpuAllocated: 10,
      vcpuCapacity: 100,
      memoryCapacityBytes: 10 * GIB,
      diskCapacityBytes: 10 * GIB,
    });
  });

  test("a lost hypervisor's instances still count: they are on it", () => {
    expect(
      zones([hypervisor("a"), hypervisor("b", { status: "down" })])[0]
        ?.instanceCount,
    ).toBe(6);
  });

  test("Nova's internal zone is never one anyone counts, and no zone is no group", () => {
    expect(
      zones([
        hypervisor("a", { availabilityZone: "internal" }),
        hypervisor("b", { availabilityZone: undefined }),
      ]),
    ).toEqual([]);
  });

  test("a zone is one per region, and regions sort first", () => {
    const groups: Array<OpenStackHostGroup> = zones([
      hypervisor("a", { regionName: "RegionTwo" }),
      hypervisor("b", { regionName: "RegionOne", availabilityZone: "az2" }),
      hypervisor("c", { regionName: "RegionOne", availabilityZone: "az1" }),
    ]);
    expect(
      groups.map((group: OpenStackHostGroup) => {
        return group.id;
      }),
    ).toEqual(["RegionOne/az1", "RegionOne/az2", "RegionTwo/az1"]);
  });

  test("a stopped nova-compute reaches its zone by the short name, and says how many instances it held", () => {
    const [zone]: Array<OpenStackHostGroup> = zones([
      hypervisor("a", { status: "down" }),
      computeService("a", { status: "down" }),
    ]);
    expect(zone?.health).toBe("Unhealthy");
    const item: ResourceAttentionItem = zone!.attention[0]!;
    expect(item.name).toBe("nova-compute");
    expect(item.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(item.reasons[0]?.values).toEqual({ count: "3" });
  });

  test("a warning makes it Degraded, and nothing makes it Healthy", () => {
    expect(zones([hypervisor("a", { vcpuAllocated: 99 })])[0]?.health).toBe(
      "Degraded",
    );
    expect(zones([hypervisor("a")])[0]?.health).toBe("Healthy");
  });

  test("what may need someone counts towards the zone it is on, and no other", () => {
    const [first, second]: Array<OpenStackHostGroup> = zones([
      hypervisor("a"),
      hypervisor("b", { availabilityZone: "az2" }),
      row({
        kind: OpenStackResourceKind.Instance,
        externalId: "i-1",
        name: "broken",
        status: "ERROR",
        regionName: "RegionOne",
        hypervisorName: "a.example",
      }),
    ]);
    expect(first?.health).toBe("Degraded");
    expect(
      first?.attention.map((item: ResourceAttentionItem) => {
        return item.name;
      }),
    ).toEqual(["broken"]);
    expect(second?.health).toBe("Healthy");
  });

  test("a hypervisor in two aggregates counts towards both", () => {
    const groups: Array<OpenStackHostGroup> = getOpenStackHostGroups({
      rows: [
        hypervisor("a", { facts: { aggregates: "gpu, ssd" } }),
        hypervisor("b", { facts: { aggregates: "ssd" } }),
        hypervisor("c", { facts: { aggregates: null } }),
      ],
      kind: "aggregate",
      now: NOW,
    });
    expect(
      groups.map((group: OpenStackHostGroup) => {
        return [group.name, group.total];
      }),
    ).toEqual([
      ["gpu", 1],
      ["ssd", 2],
    ]);
  });

  test("a hypervisor's aggregates, as the exporter joins them", () => {
    expect(
      parseOpenStackAggregates(row({ facts: { aggregates: "gpu,ssd" } })),
    ).toEqual(["gpu", "ssd"]);
    expect(
      parseOpenStackAggregates(row({ facts: { aggregates: null } })),
    ).toEqual([]);
    expect(parseOpenStackAggregates(row({}))).toEqual([]);
    expect(parseOpenStackAggregates(null)).toEqual([]);
  });
});

describe("an instance", () => {
  test("empty address labels are not an instance with no address", () => {
    expect(getOpenStackInstanceAddresses(row({ facts: {} }))).toEqual({
      ipv4: "",
      ipv6: "",
      isKnown: false,
    });
    expect(
      getOpenStackInstanceAddresses(
        row({ facts: { addressIpv4: "10.0.0.5" } }),
      ),
    ).toEqual({ ipv4: "10.0.0.5", ipv6: "", isKnown: true });
  });

  test("one with no hypervisor has not been placed", () => {
    expect(
      isOpenStackInstanceUnplaced({ kind: OpenStackResourceKind.Instance }),
    ).toBe(true);
    expect(
      isOpenStackInstanceUnplaced({
        kind: OpenStackResourceKind.Instance,
        hypervisorName: "c1",
      }),
    ).toBe(false);
    expect(
      isOpenStackInstanceUnplaced({ kind: OpenStackResourceKind.Volume }),
    ).toBe(false);
  });
});

describe("a network's addresses", () => {
  const DUAL_STACK: RowFields = {
    kind: OpenStackResourceKind.Network,
    facts: {
      isExternal: true,
      isShared: true,
      ipsUsed: 4,
      ipsTotal: 253,
      ipsBySubnet: {
        "ipv6-public-subnet": {
          total: 1.8446744073709552e19,
          used: 4,
          cidr: "2001:db8::/64",
          ipVersion: "6",
        },
        "public-subnet": {
          total: 253,
          used: 4,
          cidr: "172.24.4.0/24",
          ipVersion: "4",
        },
      },
    },
  };

  test("IPv4 comes first, and an IPv6 subnet has no share of anything", () => {
    const subnets: Array<OpenStackSubnetAddresses> = getOpenStackNetworkSubnets(
      row(DUAL_STACK),
    );
    expect(subnets[0]).toMatchObject({
      name: "public-subnet",
      ipVersion: "4",
      used: 4,
      total: 253,
    });
    expect(subnets[0]?.percent).toBeCloseTo(1.58, 1);
    expect(subnets[1]).toMatchObject({
      name: "ipv6-public-subnet",
      percent: null,
      used: 4,
    });
  });

  test("nothing reported is no subnets, and no free count", () => {
    expect(getOpenStackNetworkSubnets(row({}))).toEqual([]);
    expect(getOpenStackNetworkSubnets(null)).toEqual([]);
    expect(getOpenStackAddressesFree(row({}))).toBeNull();
  });

  test("free never goes below none", () => {
    expect(
      getOpenStackAddressesFree(
        row({ facts: { ipsUsed: 300, ipsTotal: 253 } }),
      ),
    ).toBe(0);
    expect(getOpenStackAddressesFree(row(DUAL_STACK))).toBe(249);
  });

  test("a subnet finds its numbers on its network, by CIDR and then by name", () => {
    expect(
      getOpenStackSubnetAddresses({
        subnet: row({ facts: { cidr: "172.24.4.0/24" } }),
        network: row(DUAL_STACK),
      })?.name,
    ).toBe("public-subnet");
    expect(
      getOpenStackSubnetAddresses({
        subnet: row({ name: "ipv6-public-subnet" }),
        network: row(DUAL_STACK),
      })?.cidr,
    ).toBe("2001:db8::/64");
    expect(
      getOpenStackSubnetAddresses({
        subnet: row({ name: "other" }),
        network: row(DUAL_STACK),
      }),
    ).toBeNull();
    expect(
      getOpenStackSubnetAddresses({
        subnet: row({ name: "other" }),
        network: null,
      }),
    ).toBeNull();
  });

  test("its tone is the external pool templates' two lines", () => {
    const at: (used: number) => string | undefined = (
      used: number,
    ): string | undefined => {
      return getOpenStackAddressesTone(
        row({ facts: { ipsUsed: used, ipsTotal: 100 } }),
      );
    };
    expect(at(OPENSTACK_IP_POOL_WARNING_PERCENT)).toBe("positive");
    expect(at(OPENSTACK_IP_POOL_WARNING_PERCENT + 1)).toBe("warning");
    expect(at(99)).toBe("warning");
    expect(at(100)).toBe("danger");
    expect(getOpenStackAddressesTone(row({}))).toBeUndefined();
  });

  test("external and shared read their facts, and never a guess", () => {
    expect(isOpenStackNetworkExternal(row(DUAL_STACK))).toBe(true);
    expect(isOpenStackNetworkShared(row(DUAL_STACK))).toBe(true);
    expect(isOpenStackNetworkExternal(row({ facts: {} }))).toBe(false);
    expect(isOpenStackNetworkShared(null)).toBe(false);
  });
});

describe("which backend a cloud's network runs", () => {
  test.each([
    [["neutron-l3-agent", "neutron-dhcp-agent"], "ml2-ovs"],
    [["L3 agent"], "ml2-ovs"],
    [["neutron-ovn-agent", "ovn-controller"], "ovn"],
    [["OVN Controller agent", "OVN Neutron agent"], "ovn"],
    [["ovn-controller", "neutron-l3-agent"], "ml2-ovs"],
    [["neutron-openvswitch-agent"], "unknown"],
    [[], "unknown"],
    [[null, undefined, ""], "unknown"],
  ])(
    "%j reads %s",
    (names: Array<string | null | undefined>, backend: string) => {
      expect(getOpenStackNetworkBackend(names)).toBe(backend);
    },
  );
});

describe("who holds a router", () => {
  function reading(
    agents: JSONObject | undefined,
    backend: "ml2-ovs" | "ovn" | "unknown",
  ): ReturnType<typeof getOpenStackRouterAgentReading> {
    return getOpenStackRouterAgentReading({
      row: row({ facts: agents ? { l3Agents: agents } : {} }),
      backend,
    });
  }

  const ALIVE_ACTIVE: JSONObject = {
    host: "n1",
    isAlive: true,
    isAdminUp: true,
    haState: "active",
  };
  const ALIVE_STANDBY: JSONObject = {
    host: "n2",
    isAlive: true,
    isAdminUp: true,
    haState: "standby",
  };
  const DEAD: JSONObject = {
    host: "n3",
    isAlive: false,
    isAdminUp: true,
    haState: null,
  };
  const SET_DOWN: JSONObject = {
    host: "n4",
    isAlive: true,
    isAdminUp: false,
    haState: null,
  };

  test("on OVN there is no such agent, and that is never missing", () => {
    expect(reading(undefined, "ovn")).toMatchObject({
      state: "not-applicable",
      label: "Not applicable",
      tone: "neutral",
    });
  });

  test("on ML2/OVS, or when the agents can't be listed, none reported only says that", () => {
    for (const backend of ["ml2-ovs", "unknown"] as const) {
      expect(reading(undefined, backend)).toMatchObject({
        state: "not-reported",
        label: "Not reported",
        tone: "neutral",
      });
    }
  });

  test("how many are alive, and which is carrying it", () => {
    expect(
      reading({ a: ALIVE_ACTIVE, b: ALIVE_STANDBY, c: DEAD }, "ml2-ovs"),
    ).toMatchObject({
      state: "alive",
      alive: 2,
      total: 3,
      values: { alive: "2", total: "3" },
      tone: "positive",
      activeHost: "n1",
    });
  });

  test("none alive is red, and an agent someone set down doesn't count as alive", () => {
    expect(reading({ a: DEAD, b: SET_DOWN }, "ml2-ovs")).toMatchObject({
      state: "none-alive",
      alive: 0,
      total: 2,
      tone: "danger",
      activeHost: null,
    });
  });

  test("two active is a split brain, in red", () => {
    expect(
      reading({ a: ALIVE_ACTIVE, b: ALIVE_ACTIVE }, "ml2-ovs"),
    ).toMatchObject({ state: "two-active", tone: "danger" });
  });

  test("an agent's own id tells it from any other", () => {
    expect(isOpenStackL3Agent({ name: "neutron-l3-agent" })).toBe(true);
    expect(isOpenStackL3Agent({ name: "L3 agent" })).toBe(true);
    expect(isOpenStackL3Agent({ name: "neutron-dhcp-agent" })).toBe(false);
    expect(isOpenStackL3Agent({})).toBe(false);
    expect(getOpenStackL3AgentExternalId("RegionOne", "net-1")).toBe(
      "RegionOne/network/net-1/neutron-l3-agent",
    );
  });

  test("a network agent is a Service row of the network family", () => {
    expect(
      isOpenStackNetworkAgent(
        row({
          kind: OpenStackResourceKind.Service,
          facts: { family: "network" },
        }),
      ),
    ).toBe(true);
    expect(
      isOpenStackNetworkAgent(
        row({
          kind: OpenStackResourceKind.Service,
          facts: { family: "compute" },
        }),
      ),
    ).toBe(false);
    expect(
      isOpenStackNetworkAgent(
        row({
          kind: OpenStackResourceKind.Router,
          facts: { family: "network" },
        }),
      ),
    ).toBe(false);
  });
});

describe("why a part reads as it does", () => {
  function why(fields: RowFields): string | null {
    return getOpenStackPartExplanation(row(fields), NOW);
  }

  test.each<[string, RowFields, RegExp]>([
    [
      "a full external pool",
      {
        kind: OpenStackResourceKind.Network,
        facts: { isExternal: true, ipsUsed: 100, ipsTotal: 100 },
      },
      /no addresses left/,
    ],
    [
      "a filling external pool",
      {
        kind: OpenStackResourceKind.Network,
        facts: { isExternal: true, ipsUsed: 95, ipsTotal: 100 },
      },
      /nearly out of addresses/,
    ],
    [
      "a router with no alive agent",
      {
        kind: OpenStackResourceKind.Router,
        status: "ACTIVE",
        facts: {
          l3Agents: { a: { isAlive: false, isAdminUp: true } },
        },
      },
      /No L3 agent holding this router is alive/,
    ],
    [
      "a router with two active agents",
      {
        kind: OpenStackResourceKind.Router,
        status: "ACTIVE",
        facts: {
          l3Agents: {
            a: { isAlive: true, isAdminUp: true, haState: "active" },
            b: { isAlive: true, isAdminUp: true, haState: "active" },
          },
        },
      },
      /split brain/,
    ],
    [
      "a router not active",
      { kind: OpenStackResourceKind.Router, status: "ERROR" },
      /should be active/,
    ],
    [
      "a floating IP associated and not active",
      {
        kind: OpenStackResourceKind.FloatingIp,
        status: "DOWN",
        facts: { routerId: "r" },
      },
      /may not be arriving/,
    ],
    [
      "a volume in error",
      { kind: OpenStackResourceKind.Volume, status: "error_deleting" },
      /failed/,
    ],
    [
      "a stuck volume",
      {
        kind: OpenStackResourceKind.Volume,
        status: "attaching",
        stateChangedAt: minutesAgo(600),
      },
      /longer than it should take/,
    ],
    [
      "a failed instance on a host",
      {
        kind: OpenStackResourceKind.Instance,
        status: "ERROR",
        hypervisorName: "c1",
      },
      /No valid host/,
    ],
    [
      "a failed instance with no host",
      { kind: OpenStackResourceKind.Instance, status: "ERROR" },
      /never placed/,
    ],
    [
      "a stuck instance",
      {
        kind: OpenStackResourceKind.Instance,
        status: "VERIFY_RESIZE",
        stateChangedAt: minutesAgo(600),
      },
      /confirm or revert/,
    ],
    [
      "a nearly full pool",
      {
        kind: OpenStackResourceKind.StoragePool,
        diskAllocatedBytes: 99,
        diskCapacityBytes: 100,
      },
      /nearly full/,
    ],
    [
      "a filling pool",
      {
        kind: OpenStackResourceKind.StoragePool,
        diskAllocatedBytes: 90,
        diskCapacityBytes: 100,
      },
      /filling up/,
    ],
    [
      "a stuck image",
      {
        kind: OpenStackResourceKind.Image,
        status: "queued",
        stateChangedAt: minutesAgo(600),
      },
      /failed upload/,
    ],
  ])("%s says so", (_name: string, fields: RowFields, words: RegExp) => {
    expect(why(fields)).toMatch(words);
  });

  test.each<[string, RowFields]>([
    [
      "a fine instance",
      { kind: OpenStackResourceKind.Instance, status: "ACTIVE" },
    ],
    ["a fine volume", { kind: OpenStackResourceKind.Volume, status: "in-use" }],
    [
      "a tenant's full network",
      {
        kind: OpenStackResourceKind.Network,
        facts: { isExternal: false, ipsUsed: 100, ipsTotal: 100 },
      },
    ],
    [
      "a spare floating IP",
      { kind: OpenStackResourceKind.FloatingIp, status: "DOWN" },
    ],
    ["a flavor", { kind: OpenStackResourceKind.Flavor }],
  ])("%s has nothing to explain", (_name: string, fields: RowFields) => {
    expect(why(fields)).toBeNull();
  });
});

describe("whether an open record is about a part", () => {
  function about(labels: JSONObject, fields: RowFields): boolean {
    return isOpenStackIssueAbout({ seriesLabels: labels }, row(fields));
  }

  const REGION: string = "openstack.region.name";

  test("a hypervisor's, by host, across Nova's two names for one machine", () => {
    const hypervisor: RowFields = {
      kind: OpenStackResourceKind.Hypervisor,
      hypervisorName: "compute-01.example.internal",
      regionName: "RegionOne",
    };
    expect(
      about({ hostname: "compute-01", [REGION]: "RegionOne" }, hypervisor),
    ).toBe(true);
    expect(
      about(
        { hostname: "compute-01.example.internal", [REGION]: "RegionOne" },
        hypervisor,
      ),
    ).toBe(true);
    expect(about({ hostname: "compute-02" }, hypervisor)).toBe(false);
    expect(
      about({ hostname: "compute-01", [REGION]: "RegionTwo" }, hypervisor),
    ).toBe(false);
  });

  test("a worker's record is about a hypervisor only when the worker is its nova-compute", () => {
    const hypervisor: RowFields = {
      kind: OpenStackResourceKind.Hypervisor,
      hypervisorName: "compute-01.example.internal",
    };
    expect(
      about({ hostname: "compute-01", service: "nova-compute" }, hypervisor),
    ).toBe(true);
    expect(
      about(
        { hostname: "compute-01", service: "neutron-l3-agent" },
        hypervisor,
      ),
    ).toBe(false);
  });

  test("an agent's, by host and binary", () => {
    const agent: RowFields = {
      kind: OpenStackResourceKind.Service,
      name: "neutron-l3-agent",
      facts: { host: "net-01" },
    };
    expect(
      about({ hostname: "net-01", service: "neutron-l3-agent" }, agent),
    ).toBe(true);
    expect(
      about({ hostname: "net-01", service: "neutron-dhcp-agent" }, agent),
    ).toBe(false);
    expect(
      about({ hostname: "net-02", service: "neutron-l3-agent" }, agent),
    ).toBe(false);
  });

  test("an instance's, by its uuid, never by a name people can share", () => {
    const instance: RowFields = {
      kind: OpenStackResourceKind.Instance,
      externalId: "uuid-1",
      name: "web",
    };
    expect(about({ uuid: "uuid-1", name: "web" }, instance)).toBe(true);
    expect(about({ uuid: "uuid-2", name: "web" }, instance)).toBe(false);
  });

  test("a volume's, a pool's, a network's and a router's, by what their templates group on", () => {
    expect(
      about(
        { id: "v1" },
        { kind: OpenStackResourceKind.Volume, externalId: "v1" },
      ),
    ).toBe(true);
    expect(
      about(
        { name: "host@lvm#lvm", [REGION]: "RegionOne" },
        {
          kind: OpenStackResourceKind.StoragePool,
          name: "host@lvm#lvm",
          regionName: "RegionOne",
        },
      ),
    ).toBe(true);
    expect(
      about(
        { network_id: "n1" },
        { kind: OpenStackResourceKind.Network, externalId: "n1" },
      ),
    ).toBe(true);
    expect(
      about(
        { router_id: "r1" },
        { kind: OpenStackResourceKind.Router, externalId: "r1" },
      ),
    ).toBe(true);
  });

  test("a template that only counts per region is about nobody", () => {
    expect(
      about(
        { [REGION]: "RegionOne", status: "ERROR" },
        {
          kind: OpenStackResourceKind.Instance,
          externalId: "uuid-1",
          regionName: "RegionOne",
        },
      ),
    ).toBe(false);
    expect(
      about(
        { [REGION]: "RegionOne" },
        { kind: OpenStackResourceKind.FloatingIp, externalId: "f1" },
      ),
    ).toBe(false);
    expect(
      about(
        { id: "x" },
        { kind: OpenStackResourceKind.Flavor, externalId: "x" },
      ),
    ).toBe(false);
  });

  test("a row with no id matches no record with no label", () => {
    expect(about({}, { kind: OpenStackResourceKind.Instance })).toBe(false);
    expect(about({}, { kind: OpenStackResourceKind.Router })).toBe(false);
    expect(
      isOpenStackIssueAbout(
        { seriesLabels: null },
        row({ kind: OpenStackResourceKind.Volume }),
      ),
    ).toBe(false);
  });

  test("a zone's are its hypervisors'", () => {
    expect(
      isOpenStackIssueAboutHosts({ seriesLabels: { hostname: "c1" } }, [
        row({ kind: OpenStackResourceKind.Hypervisor, hypervisorName: "c2.e" }),
        row({ kind: OpenStackResourceKind.Hypervisor, hypervisorName: "c1.e" }),
      ]),
    ).toBe(true);
    expect(
      isOpenStackIssueAboutHosts({ seriesLabels: { hostname: "c3" } }, [
        row({ kind: OpenStackResourceKind.Hypervisor, hypervisorName: "c1.e" }),
      ]),
    ).toBe(false);
  });
});

describe("when something fills up", () => {
  const HOUR: number = 60 * 60 * 1000;
  const START: number = NOW.getTime();

  function line(
    hours: number,
    usedPerHour: number,
    start: number = 0,
  ): Array<OpenStackGrowthSample> {
    return Array.from({ length: hours }, (_: unknown, index: number) => {
      return { time: START + index * HOUR, used: start + index * usedPerHour };
    });
  }

  test("a steady climb reads how long it has left", () => {
    const forecast: OpenStackForecast = getOpenStackForecast({
      samples: line(24, 1),
      capacity: 23 + 24 * 10,
    });
    expect(forecast.state).toBe("days");
    expect((forecast as { days: number }).days).toBeCloseTo(10, 5);
  });

  test("already at capacity is full, whatever the history", () => {
    expect(
      getOpenStackForecast({
        samples: [{ time: START, used: 100 }],
        capacity: 100,
      }),
    ).toEqual({ state: "full" });
  });

  test("flat or shrinking is not growing", () => {
    expect(
      getOpenStackForecast({ samples: line(24, 0, 5), capacity: 100 }),
    ).toEqual({ state: "not-growing" });
    expect(
      getOpenStackForecast({ samples: line(24, -1, 50), capacity: 100 }),
    ).toEqual({ state: "not-growing" });
  });

  test("a line more than a year out is not one anyone plans around", () => {
    expect(
      getOpenStackForecast({ samples: line(24, 0.001), capacity: 1000 }),
    ).toEqual({ state: "not-growing" });
  });

  test("a new cloud says there isn't enough history, and never makes a guess", () => {
    expect(getOpenStackForecast({ samples: [], capacity: 100 })).toEqual({
      state: "not-enough-history",
    });
    expect(
      getOpenStackForecast({ samples: line(2, 10), capacity: 100 }),
    ).toEqual({ state: "not-enough-history" });
    // Many samples, all within an hour.
    expect(
      getOpenStackForecast({
        samples: Array.from({ length: 60 }, (_: unknown, index: number) => {
          return { time: START + index * 60 * 1000, used: index };
        }),
        capacity: 1000,
      }),
    ).toEqual({ state: "not-enough-history" });
  });

  test("no capacity can't say", () => {
    for (const capacity of [null, undefined, 0, -1]) {
      expect(getOpenStackForecast({ samples: line(24, 1), capacity })).toEqual({
        state: "not-enough-history",
      });
    }
  });

  test("out of order and broken samples read the same", () => {
    const samples: Array<{ time: number; used: number }> = line(24, 1);
    expect(
      getOpenStackForecast({
        samples: [
          ...[...samples].reverse(),
          { time: Number.NaN, used: 1 },
          { time: START, used: Number.NaN },
        ],
        capacity: 1000,
      }),
    ).toEqual(getOpenStackForecast({ samples, capacity: 1000 }));
  });
});

describe("what an empty list means", () => {
  test("an API that answers with no hypervisors is a credential that can't list them", () => {
    expect(
      getOpenStackEmptyWords({
        kind: OpenStackResourceKind.Hypervisor,
        api: "up",
      })?.title,
    ).toBe("This credential can't list hypervisors");
    expect(
      getOpenStackEmptyWords({
        kind: OpenStackResourceKind.StoragePool,
        api: "up",
      })?.title,
    ).toBe("This credential can't list storage pools");
    expect(
      getOpenStackEmptyWords({
        kind: OpenStackResourceKind.Service,
        api: "up",
      })?.title,
    ).toBe("This credential can't list network agents");
  });

  test.each([
    OpenStackResourceKind.Instance,
    OpenStackResourceKind.Volume,
    OpenStackResourceKind.Router,
    OpenStackResourceKind.FloatingIp,
    OpenStackResourceKind.Image,
    OpenStackResourceKind.Flavor,
  ])(
    "%s can really be empty, so its page's own words stand",
    (kind: OpenStackResourceKind) => {
      expect(getOpenStackEmptyWords({ kind, api: "up" })).toBeNull();
    },
  );

  test("the fix is named, not only the problem", () => {
    expect(
      getOpenStackEmptyWords({
        kind: OpenStackResourceKind.Hypervisor,
        api: "up",
      })?.description,
    ).toMatch(/Full view or Infrastructure only[\s\S]*troubleshoot\.sh/);
  });

  test("an API that doesn't answer says that, for any kind", () => {
    expect(
      getOpenStackEmptyWords({
        kind: OpenStackResourceKind.Instance,
        api: "down",
      })?.title,
    ).toBe("This service's API isn't answering");
  });

  test("nothing reported yet is left to the page", () => {
    expect(
      getOpenStackEmptyWords({
        kind: OpenStackResourceKind.Hypervisor,
        api: "not-reported",
      }),
    ).toBeNull();
  });

  test("every row one project's only says so when more than one is known", () => {
    expect(
      isOpenStackListPossiblyOneProject({
        projectIdsInList: ["a", "a"],
        knownProjectCount: 3,
      }),
    ).toBe(true);
    expect(
      isOpenStackListPossiblyOneProject({
        projectIdsInList: ["a"],
        knownProjectCount: 1,
      }),
    ).toBe(false);
    expect(
      isOpenStackListPossiblyOneProject({
        projectIdsInList: ["a", "b"],
        knownProjectCount: 3,
      }),
    ).toBe(false);
    expect(
      isOpenStackListPossiblyOneProject({
        projectIdsInList: [],
        knownProjectCount: 3,
      }),
    ).toBe(false);
    expect(
      isOpenStackListPossiblyOneProject({
        projectIdsInList: [null, "a"],
        knownProjectCount: 3,
      }),
    ).toBe(true);
  });
});

describe("the alert templates each kind of part names", () => {
  const TEMPLATE_IDS: Set<string> = new Set(
    getAllOpenStackAlertTemplates().map((template: OpenStackAlertTemplate) => {
      return template.id;
    }),
  );

  test.each<[string, Array<string>]>([
    ["hypervisor", OPENSTACK_HYPERVISOR_ALERT_TEMPLATE_IDS],
    ["instance", OPENSTACK_INSTANCE_ALERT_TEMPLATE_IDS],
    ["network", OPENSTACK_NETWORK_ALERT_TEMPLATE_IDS],
    ["router", OPENSTACK_ROUTER_ALERT_TEMPLATE_IDS],
    ["floating IP", OPENSTACK_FLOATING_IP_ALERT_TEMPLATE_IDS],
    ["network agent", OPENSTACK_NETWORK_AGENT_ALERT_TEMPLATE_IDS],
    ["volume", OPENSTACK_VOLUME_ALERT_TEMPLATE_IDS],
    ["storage pool", OPENSTACK_STORAGE_POOL_ALERT_TEMPLATE_IDS],
  ])("a %s's are real templates", (_kind: string, ids: Array<string>) => {
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect({ id, exists: TEMPLATE_IDS.has(id) }).toEqual({
        id,
        exists: true,
      });
    }
  });
});

describe("a state a list is asked for by name finds what the rules call that", () => {
  function preset(
    presets: Array<{ value: string; getQuery: (now: Date) => unknown }>,
    value: string,
  ): Record<string, unknown> {
    const found: OpenStackStatePreset | undefined = presets.find(
      (candidate: OpenStackStatePreset) => {
        return candidate.value === value;
      },
    );
    return found!.getQuery(NOW) as Record<string, unknown>;
  }

  function cutoffOf(query: Record<string, unknown>): number {
    return (query["stateChangedAt"] as { value: Date }).value.getTime();
  }

  test.each([
    [
      "instance",
      OPENSTACK_INSTANCE_STATE_PRESETS,
      OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES,
      OPENSTACK_INSTANCE_STUCK_MINUTES,
    ],
    [
      "volume",
      OPENSTACK_VOLUME_STATE_PRESETS,
      OPENSTACK_VOLUME_TRANSITIONAL_STATUSES,
      OPENSTACK_VOLUME_STUCK_MINUTES,
    ],
    [
      "image",
      OPENSTACK_IMAGE_STATE_PRESETS,
      OPENSTACK_IMAGE_TRANSITIONAL_STATUSES,
      OPENSTACK_IMAGE_STUCK_MINUTES,
    ],
  ])(
    "stuck %s is the rules' words, past the rules' line",
    (
      _kind: string,
      presets: Array<{ value: string; getQuery: (now: Date) => unknown }>,
      statuses: ReadonlySet<string>,
      minutes: number,
    ) => {
      const query: Record<string, unknown> = preset(presets, "stuck");
      expect((query["status"] as { values: Array<string> }).values).toEqual(
        Array.from(statuses),
      );
      expect(cutoffOf(query)).toBe(NOW.getTime() - minutes * 60 * 1000);
    },
  );

  test("a volume in error is every word the rules call failed", () => {
    expect(
      (
        preset(OPENSTACK_VOLUME_STATE_PRESETS, "error")["status"] as {
          values: Array<string>;
        }
      ).values,
    ).toEqual(Array.from(OPENSTACK_VOLUME_ERROR_STATUSES));
  });

  test("an instance in error is ERROR", () => {
    expect(preset(OPENSTACK_INSTANCE_STATE_PRESETS, "error")["status"]).toBe(
      "ERROR",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * On what real clouds said
 * ---------------------------------------------------------------------------
 */
describe.each(getOpenStackReleases())(
  "a healthy cloud, on %s",
  (release: string) => {
    const scene: OpenStackRecording = new OpenStackRecording(
      release,
      "healthy",
    );

    test("its instances read as the estate left them, the failed one with no hypervisor", () => {
      const failed: OpenStackResource = scene.named(
        OpenStackResourceKind.Instance,
        "ou-failed",
      );
      expect(
        getOpenStackRowState(failed, OPENSTACK_RECORDING_NOW),
      ).toMatchObject({
        label: "ERROR",
        tone: "danger",
      });
      expect(isOpenStackInstanceUnplaced(failed)).toBe(true);
      expect(
        getOpenStackPartExplanation(failed, OPENSTACK_RECORDING_NOW),
      ).toMatch(/never placed/);

      expect(
        getOpenStackRowState(
          scene.named(OpenStackResourceKind.Instance, "ou-stopped"),
          OPENSTACK_RECORDING_NOW,
        ),
      ).toMatchObject({ label: "SHUTOFF", tone: "neutral" });

      const running: OpenStackResource = scene.named(
        OpenStackResourceKind.Instance,
        "ou-running",
      );
      expect(
        getOpenStackRowState(running, OPENSTACK_RECORDING_NOW),
      ).toMatchObject({ label: "ACTIVE", tone: "positive" });
      expect(isOpenStackInstanceUnplaced(running)).toBe(false);
    });

    test("an instance's addresses are empty in the exporter's output, and that is said", () => {
      expect(
        getOpenStackInstanceAddresses(
          scene.named(OpenStackResourceKind.Instance, "ou-running"),
        ).isKnown,
      ).toBe(false);
    });

    test("an instance links to its hypervisor and its flavor, by what their rows are keyed on", () => {
      const running: OpenStackResource = scene.named(
        OpenStackResourceKind.Instance,
        "ou-running",
      );
      expect(
        scene
          .ofKind(OpenStackResourceKind.Hypervisor)
          .map((row: OpenStackResource) => {
            return row.externalId;
          }),
      ).toContain(
        getOpenStackHypervisorExternalId(
          running.regionName,
          running.hypervisorName as string,
        ),
      );
      expect(
        scene
          .ofKind(OpenStackResourceKind.Flavor)
          .map((row: OpenStackResource) => {
            return row.externalId;
          }),
      ).toContain(
        getOpenStackFlavorExternalId(
          running.regionName,
          running.facts?.["flavorId"] as string,
        ),
      );
    });

    test("a hypervisor reads as allocated, at Placement's ratio", () => {
      const hypervisor: OpenStackResource = scene.ofKind(
        OpenStackResourceKind.Hypervisor,
      )[0]!;
      const lines: Array<OpenStackAllocationLine> =
        getOpenStackAllocationLines(hypervisor);
      expect(lines[0]?.ratio).toBeGreaterThan(1);
      expect(lines[0]?.percent).toBeGreaterThan(0);
      expect(lines[0]?.isLastKnown).toBe(false);
      expect(
        getOpenStackRowState(hypervisor, OPENSTACK_RECORDING_NOW),
      ).toMatchObject({ label: "up", tone: "positive" });
    });

    test("its zone is nova, and Nova's internal zone isn't one", () => {
      const groups: Array<OpenStackHostGroup> = getOpenStackHostGroups({
        rows: scene.rows,
        kind: "zone",
        now: OPENSTACK_RECORDING_NOW,
      });
      expect(
        groups.map((group: OpenStackHostGroup) => {
          return group.name;
        }),
      ).toEqual(["nova"]);
      expect(groups[0]?.total).toBe(1);
      expect(groups[0]?.up).toBe(1);
      expect(groups[0]?.instanceCount).toBeGreaterThan(0);
    });

    test("it has no aggregates, which is usual and not an error", () => {
      expect(
        getOpenStackHostGroups({
          rows: scene.rows,
          kind: "aggregate",
          now: OPENSTACK_RECORDING_NOW,
        }),
      ).toEqual([]);
    });

    test("a dual-stack external network counts its IPv4 pool alone", () => {
      const external: OpenStackResource = scene.named(
        OpenStackResourceKind.Network,
        "public",
      );
      expect(isOpenStackNetworkExternal(external)).toBe(true);
      // Added to a /64 this would be 2^64, and a full pool would read as 0%.
      expect(external.facts?.["ipsTotal"]).toBeLessThan(65536);
      expect(getOpenStackAddressesTone(external)).toBe("positive");
      const subnets: Array<OpenStackSubnetAddresses> =
        getOpenStackNetworkSubnets(external);
      const ipv6: OpenStackSubnetAddresses | undefined = subnets.find(
        (subnet: OpenStackSubnetAddresses) => {
          return subnet.ipVersion === "6";
        },
      );
      if (ipv6) {
        expect(ipv6.percent).toBeNull();
      }
      expect(
        subnets.some((subnet: OpenStackSubnetAddresses) => {
          return subnet.ipVersion === "4" && subnet.percent !== null;
        }),
      ).toBe(true);
    });

    test("a subnet finds its addresses on its network", () => {
      const subnet: OpenStackResource = scene.named(
        OpenStackResourceKind.Subnet,
        "ou-subnet",
      );
      const network: OpenStackResource | undefined = scene
        .ofKind(OpenStackResourceKind.Network)
        .find((candidate: OpenStackResource) => {
          return candidate.externalId === subnet.facts?.["networkId"];
        });
      expect(network?.name).toBe("ou-net");
      expect(
        getOpenStackSubnetAddresses({ subnet, network })?.total,
      ).toBeGreaterThan(0);
    });

    test("a floating IP in use goes through a router in the inventory, and the spare one reads as spare", () => {
      const addresses: Array<OpenStackResource> = scene.ofKind(
        OpenStackResourceKind.FloatingIp,
      );
      const inUse: OpenStackResource | undefined = addresses.find(
        (address: OpenStackResource) => {
          return getOpenStackFloatingIpAssociation(address) === "associated";
        },
      );
      expect(inUse).toBeDefined();
      expect(
        scene
          .ofKind(OpenStackResourceKind.Router)
          .map((router: OpenStackResource) => {
            return router.externalId;
          }),
      ).toContain(inUse?.facts?.["routerId"]);
      expect(
        addresses.filter((address: OpenStackResource) => {
          return getOpenStackFloatingIpAssociation(address) === "unassociated";
        }),
      ).toHaveLength(1);
    });

    test("a volume links to the instance holding it, and the spare one to none", () => {
      expect(
        scene.named(OpenStackResourceKind.Volume, "ou-vol-used").facts?.[
          "attachedToInstance"
        ],
      ).toBe(
        scene.named(OpenStackResourceKind.Instance, "ou-running").externalId,
      );
      expect(
        scene.named(OpenStackResourceKind.Volume, "ou-vol-free").facts?.[
          "attachedToInstance"
        ],
      ).toBeNull();
    });

    test("a failed volume reads in Cinder's word, as failed", () => {
      expect(
        getOpenStackRowState(
          scene.named(OpenStackResourceKind.Volume, "ou-vol-bad"),
          OPENSTACK_RECORDING_NOW,
        ),
      ).toMatchObject({ label: "error", tone: "danger", reasons: [] });
    });

    test("a pool has room", () => {
      expect(
        getOpenStackRowState(
          scene.ofKind(OpenStackResourceKind.StoragePool)[0]!,
          OPENSTACK_RECORDING_NOW,
        ),
      ).toMatchObject({ label: "Has room", tone: "positive" });
    });

    test("no snapshot or backup rows arrive through the agent", () => {
      expect(scene.ofKind(OpenStackResourceKind.Snapshot)).toEqual([]);
      expect(scene.ofKind(OpenStackResourceKind.Backup)).toEqual([]);
    });

    test("an image reads its status, visibility and size", () => {
      const image: OpenStackResource = scene.ofKind(
        OpenStackResourceKind.Image,
      )[0]!;
      expect(
        getOpenStackRowState(image, OPENSTACK_RECORDING_NOW),
      ).toMatchObject({ label: "active", tone: "positive" });
      expect(image.facts?.["visibility"]).toBe("public");
      expect(image.diskCapacityBytes).toBeGreaterThan(0);
    });
  },
);

describe("a Neutron with L3 agents, on ML2/OVS", () => {
  const scene: OpenStackRecording = new OpenStackRecording(
    "gazpacho-ovs",
    "healthy",
  );
  const backend: ReturnType<typeof getOpenStackNetworkBackend> =
    getOpenStackNetworkBackend(
      scene
        .ofKind(OpenStackResourceKind.Service)
        .filter(isOpenStackNetworkAgent)
        .map((agent: OpenStackResource) => {
          return agent.name;
        }),
    );

  test("the agents list says which it is", () => {
    expect(backend).toBe("ml2-ovs");
  });

  test("a router says who holds it, and that agent's row is where the link goes", () => {
    const router: OpenStackResource = scene.named(
      OpenStackResourceKind.Router,
      "ou-router",
    );
    const reading: ReturnType<typeof getOpenStackRouterAgentReading> =
      getOpenStackRouterAgentReading({ row: router, backend });
    expect(reading).toMatchObject({ state: "alive", alive: 1, total: 1 });

    const agents: Array<OpenStackResource> = scene
      .ofKind(OpenStackResourceKind.Service)
      .filter((agent: OpenStackResource) => {
        return isOpenStackL3Agent(agent);
      });
    expect(agents.length).toBeGreaterThan(0);
    expect(
      agents.map((agent: OpenStackResource) => {
        return agent.externalId;
      }),
    ).toContain(
      getOpenStackL3AgentExternalId(
        router.regionName,
        Object.values(router.facts?.["l3Agents"] as JSONObject).map(
          (agent: unknown) => {
            return (agent as JSONObject)["host"] as string;
          },
        )[0] as string,
      ),
    );
  });

  test("an L3 agent's id is one of the keys of what a router holds", () => {
    const router: OpenStackResource = scene.named(
      OpenStackResourceKind.Router,
      "ou-router",
    );
    const agent: OpenStackResource | undefined = scene
      .ofKind(OpenStackResourceKind.Service)
      .find((candidate: OpenStackResource) => {
        return isOpenStackL3Agent(candidate);
      });
    expect(Object.keys(router.facts?.["l3Agents"] as JSONObject)).toContain(
      agent?.facts?.["agentId"],
    );
  });
});

describe("a Neutron on OVN", () => {
  const scene: OpenStackRecording = new OpenStackRecording(
    "hibiscus-ovn",
    "healthy",
  );

  test("reads as OVN, and a router's agents as not applicable, never as missing", () => {
    const backend: ReturnType<typeof getOpenStackNetworkBackend> =
      getOpenStackNetworkBackend(
        scene
          .ofKind(OpenStackResourceKind.Service)
          .filter(isOpenStackNetworkAgent)
          .map((agent: OpenStackResource) => {
            return agent.name;
          }),
      );
    expect(backend).toBe("ovn");

    const router: OpenStackResource = scene.named(
      OpenStackResourceKind.Router,
      "ou-router",
    );
    expect(
      getOpenStackRouterAgentReading({ row: router, backend }),
    ).toMatchObject({ state: "not-applicable", tone: "neutral" });
    expect(getOpenStackRowState(router, OPENSTACK_RECORDING_NOW)).toMatchObject(
      { label: "ACTIVE", tone: "positive", reasons: [] },
    );
  });
});

describe.each(getOpenStackDrilledReleases())(
  "a failure, on %s",
  (release: string) => {
    test("a stopped nova-compute marks its hypervisor lost, its numbers last known and its zone unhealthy", () => {
      const scene: OpenStackRecording = new OpenStackRecording(
        release,
        "compute-down",
      );
      const hypervisor: OpenStackResource = scene.ofKind(
        OpenStackResourceKind.Hypervisor,
      )[0]!;
      expect(isOpenStackHypervisorLost(hypervisor)).toBe(true);
      expect(
        getOpenStackRowState(hypervisor, OPENSTACK_RECORDING_NOW),
      ).toMatchObject({ label: "Lost", tone: "danger" });

      const lines: Array<OpenStackAllocationLine> =
        getOpenStackAllocationLines(hypervisor);
      expect(lines[0]?.isLastKnown).toBe(true);
      expect(lines[0]?.taken).toBeGreaterThan(0);

      const [zone]: Array<OpenStackHostGroup> = getOpenStackHostGroups({
        rows: scene.rows,
        kind: "zone",
        now: OPENSTACK_RECORDING_NOW,
      });
      expect(zone).toMatchObject({ lost: 1, up: 0, health: "Unhealthy" });
      // A host Nova lost is never read as room.
      expect(zone?.vcpuCapacity).toBe(0);
      expect(zone?.instanceCount).toBe(hypervisor.instanceCount);
    });

    test("a compute service disabled on purpose reads Disabled with its reason, and no zone goes red", () => {
      const scene: OpenStackRecording = new OpenStackRecording(
        release,
        "compute-disabled",
      );
      const hypervisor: OpenStackResource = scene.ofKind(
        OpenStackResourceKind.Hypervisor,
      )[0]!;
      expect(
        getOpenStackRowState(hypervisor, OPENSTACK_RECORDING_NOW),
      ).toMatchObject({
        label: "Disabled",
        tone: "neutral",
        writtenReason: "OneUptime drill: planned maintenance",
      });
      const [zone]: Array<OpenStackHostGroup> = getOpenStackHostGroups({
        rows: scene.rows,
        kind: "zone",
        now: OPENSTACK_RECORDING_NOW,
      });
      expect(zone).toMatchObject({ disabled: 1, lost: 0 });
      expect(zone?.health).not.toBe("Unhealthy");
    });

    test("a stopped Neutron agent's page and its routers read what the recording says", () => {
      const scene: OpenStackRecording = new OpenStackRecording(
        release,
        "network-agent-down",
      );
      const down: Array<OpenStackResource> = scene
        .ofKind(OpenStackResourceKind.Service)
        .filter((agent: OpenStackResource) => {
          return isOpenStackNetworkAgent(agent) && agent.status === "down";
        });
      expect(down.length).toBeGreaterThan(0);
      const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
        rows: scene.rows,
        now: OPENSTACK_RECORDING_NOW,
      });
      expect(
        items.some((item: ResourceAttentionItem) => {
          return item.name === down[0]?.name;
        }),
      ).toBe(true);
    });

    test("everything back on reads as it did before", () => {
      const scene: OpenStackRecording = new OpenStackRecording(
        release,
        "recovered",
      );
      expect(
        isOpenStackHypervisorLost(
          scene.ofKind(OpenStackResourceKind.Hypervisor)[0]!,
        ),
      ).toBe(false);
    });
  },
);

describe("a card's totals, from counts that come per region", () => {
  const COUNTS: Array<OpenStackCountRow> = [
    { value: "ssd", regionName: "RegionOne", count: 4, sizeBytes: 40 },
    { value: "hdd", regionName: "RegionOne", count: 1, sizeBytes: 10 },
    { value: "ssd", regionName: "RegionTwo", count: 2, sizeBytes: 20 },
    { value: null, regionName: "RegionTwo", count: 3, sizeBytes: 30 },
  ];

  test("the whole cloud adds each up across its regions, most first", () => {
    expect(getOpenStackCountTotals(COUNTS, null)).toEqual([
      { value: "ssd", regionName: null, count: 6, sizeBytes: 60 },
      { value: null, regionName: null, count: 3, sizeBytes: 30 },
      { value: "hdd", regionName: null, count: 1, sizeBytes: 10 },
    ]);
  });

  test("a region reads only itself", () => {
    expect(getOpenStackCountTotals(COUNTS, "RegionTwo")).toEqual([
      { value: null, regionName: "RegionTwo", count: 3, sizeBytes: 30 },
      { value: "ssd", regionName: "RegionTwo", count: 2, sizeBytes: 20 },
    ]);
  });

  test("one with none reads as none, and what it was given is left as it was", () => {
    expect(getOpenStackCountTotals(COUNTS, "RegionThree")).toEqual([]);
    expect(getOpenStackCountTotals([], null)).toEqual([]);
    expect(COUNTS[0]).toEqual({
      value: "ssd",
      regionName: "RegionOne",
      count: 4,
      sizeBytes: 40,
    });
  });
});
