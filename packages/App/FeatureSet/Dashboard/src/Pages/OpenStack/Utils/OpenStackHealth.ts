import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import {
  OpenStackL3AgentFact,
  OPENSTACK_ALLOCATION_WARNING_PERCENT,
  OPENSTACK_IP_POOL_WARNING_PERCENT,
  OPENSTACK_SERVICE_DISABLED_WARNING_DAYS,
  OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT,
  OPENSTACK_STORAGE_POOL_WARNING_PERCENT,
  getOpenStackNetworkIpPercent,
  getOpenStackRouterAgents,
  getOpenStackShortHostName,
  isOpenStackAdminDisabled,
  isOpenStackFloatingIpAssociated,
  isOpenStackImageStuck,
  isOpenStackInstanceStuck,
  isOpenStackServiceDown,
  isOpenStackVolumeInError,
  isOpenStackVolumeStuck,
  minutesInState,
  percentOf,
} from "Common/Types/OpenStack/OpenStackHealthRules";
import {
  OpenStackProjectQuota,
  OpenStackQuotaResource,
  getOpenStackProjectQuotas,
} from "Common/Types/OpenStack/OpenStackQuota";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
  ResourceHealth,
  getResourceAttentionHealth,
  mergeResourceAttentionSeverity,
  sortResourceAttention,
} from "../../../Components/ResourcePart/ResourceAttention";

/*
 * WHAT ON AN OPENSTACK CLOUD NEEDS SOMEONE, AND HOW BAD IT IS.
 *
 * One set of rules for every page that says it: the Overview (its health pill and
 * Needs attention), the lists, a part's own page and the Topology. They read the
 * inventory (OpenStackResource), and every line they draw is the alert templates'
 * line (Common/Types/OpenStack/OpenStackHealthRules).
 *
 *   Critical - broken, or about to be:
 *     an API not answering; an enabled nova-compute, Neutron agent, cinder-volume or
 *     cinder-scheduler down; every nova-scheduler or nova-conductor down; a storage
 *     pool past 95%; an external network with no addresses left; a router with no
 *     alive agent, or with two active ones.
 *   Warning - needs a look soon:
 *     one nova-scheduler or nova-conductor down of several; a hypervisor past 90% of
 *     what Placement allows; an instance or volume in error, or an instance, volume
 *     or image stuck on its way to something else; a storage pool past 85%; an external
 *     network past 90%; a router or floating IP that should be active and is not; a
 *     service disabled for more than a week.
 *
 * Three things these rules never do:
 *
 *  - Read planned work as a failure. A service someone disabled is Disabled, with
 *    its reason, and never turns a cloud red: the VMware audit found a template that
 *    paged on planned shutdowns and missed the crashes it described.
 *  - Read allocation as load. Nova and Placement say what is promised to instances,
 *    not what is busy, so nothing here says "CPU".
 *  - Say anything stale. A cloud whose agent is disconnected has no current state, so
 *    the Overview asks for no attention items at all then.
 *
 * React-free (pages hand in routeFor), so tests can read it.
 */

export interface OpenStackAssessment {
  severity: ResourceAttentionSeverity | null;
  reasons: Array<ResourceAttentionText>;
}

export type OpenStackRouteFor = (row: OpenStackResource) => Route | undefined;

const FINE: OpenStackAssessment = { severity: null, reasons: [] };

const REASON_API_DOWN: string = translationKey("Not answering");
const REASON_SCRAPE_FAILED: string = translationKey(
  "Not answering: the last read of it failed",
);
const REASON_SERVICE_DOWN: string = translationKey("Down");
const REASON_SERVICE_DOWN_WITH_INSTANCES: { one: string; other: string } = {
  one: "Down, with {{count}} instance on it",
  other: "Down, with {{count}} instances on it",
};
const REASON_SERVICE_DOWN_IN_PROJECTS: { one: string; other: string } = {
  one: "In {{count}} project",
  other: "In {{count}} projects",
};
const REASON_DISABLED_LONG: string = translationKey(
  "Disabled for {{days}} days",
);
const REASON_VCPUS_ALLOCATED: string = translationKey(
  "{{percent}} of vCPUs allocated",
);
const REASON_MEMORY_ALLOCATED: string = translationKey(
  "{{percent}} of memory allocated",
);
const REASON_DISK_ALLOCATED: string = translationKey(
  "{{percent}} of local disk allocated",
);
export const OPENSTACK_REASON_INSTANCE_ERROR: string =
  translationKey("In ERROR");
const REASON_STUCK: string = translationKey("{{status}} for {{duration}}");
const REASON_VOLUME_ERROR: string = translationKey("In {{status}}");
const REASON_PERCENT_FULL: string = translationKey("{{percent}} full");
const REASON_NO_ADDRESSES: string = translationKey("No addresses left");
const REASON_ADDRESSES_USED: string = translationKey(
  "{{percent}} of addresses used",
);
const REASON_ROUTER_NOT_ACTIVE: string = translationKey(
  "Not active ({{status}})",
);
const REASON_ROUTER_NO_AGENT: string = translationKey("No alive L3 agent");
const REASON_ROUTER_TWO_ACTIVE: string = translationKey("Two active L3 agents");
const REASON_FLOATING_IP_NOT_ACTIVE: string = translationKey(
  "Associated, but not active",
);
const REASON_EVERY_DOWN: string = translationKey("Every {{service}} is down");
/*
 * Whole sentences, one per quota, because a sentence is translated whole. In a cloud of
 * one region, which is most of them, naming the region says nothing.
 */
const REASON_QUOTA_AT_LINE: Record<
  OpenStackQuotaResource,
  { here: string; inRegion: string }
> = {
  [OpenStackQuotaResource.Instances]: {
    here: translationKey("{{used}} of {{limit}} instances used ({{percent}})"),
    inRegion: translationKey(
      "{{used}} of {{limit}} instances used in {{region}} ({{percent}})",
    ),
  },
  [OpenStackQuotaResource.Cores]: {
    here: translationKey("{{used}} of {{limit}} vCPUs used ({{percent}})"),
    inRegion: translationKey(
      "{{used}} of {{limit}} vCPUs used in {{region}} ({{percent}})",
    ),
  },
  [OpenStackQuotaResource.RamMib]: {
    here: translationKey(
      "{{used}} of {{limit}} MiB of memory used ({{percent}})",
    ),
    inRegion: translationKey(
      "{{used}} of {{limit}} MiB of memory used in {{region}} ({{percent}})",
    ),
  },
  [OpenStackQuotaResource.Gigabytes]: {
    here: translationKey(
      "{{used}} of {{limit}} GiB of volumes used ({{percent}})",
    ),
    inRegion: translationKey(
      "{{used}} of {{limit}} GiB of volumes used in {{region}} ({{percent}})",
    ),
  },
  [OpenStackQuotaResource.Networks]: {
    here: translationKey("{{used}} of {{limit}} networks used ({{percent}})"),
    inRegion: translationKey(
      "{{used}} of {{limit}} networks used in {{region}} ({{percent}})",
    ),
  },
  [OpenStackQuotaResource.Ports]: {
    here: translationKey("{{used}} of {{limit}} ports used ({{percent}})"),
    inRegion: translationKey(
      "{{used}} of {{limit}} ports used in {{region}} ({{percent}})",
    ),
  },
  [OpenStackQuotaResource.FloatingIps]: {
    here: translationKey(
      "{{used}} of {{limit}} floating IPs used ({{percent}})",
    ),
    inRegion: translationKey(
      "{{used}} of {{limit}} floating IPs used in {{region}} ({{percent}})",
    ),
  },
};

// What a quota is of, as the card that lists them titles each.
export const OPENSTACK_QUOTA_TITLES: Record<OpenStackQuotaResource, string> = {
  [OpenStackQuotaResource.Instances]: translationKey("Instances"),
  [OpenStackQuotaResource.Cores]: translationKey("vCPUs"),
  [OpenStackQuotaResource.RamMib]: translationKey("Memory (MiB)"),
  [OpenStackQuotaResource.Gigabytes]: translationKey("Volume storage (GiB)"),
  [OpenStackQuotaResource.Networks]: translationKey("Networks"),
  [OpenStackQuotaResource.Ports]: translationKey("Ports"),
  [OpenStackQuotaResource.FloatingIps]: translationKey("Floating IPs"),
};

const KIND_API: string = translationKey("API");
const KIND_SERVICE: string = translationKey("Service");
const KIND_HYPERVISOR: string = translationKey("Hypervisor");
const KIND_INSTANCE: string = translationKey("Instance");
const KIND_VOLUME: string = translationKey("Volume");
const KIND_STORAGE_POOL: string = translationKey("Storage pool");
const KIND_NETWORK: string = translationKey("Network");
const KIND_ROUTER: string = translationKey("Router");
const KIND_FLOATING_IP: string = translationKey("Floating IP");
const KIND_PROJECT: string = translationKey("Project");
const KIND_IMAGE: string = translationKey("Image");

// The order Needs attention lists the kinds in, at one severity.
export const OPENSTACK_ATTENTION_KIND_ORDER: Array<string> = [
  KIND_API,
  KIND_SERVICE,
  KIND_HYPERVISOR,
  KIND_STORAGE_POOL,
  KIND_NETWORK,
  KIND_ROUTER,
  KIND_VOLUME,
  KIND_INSTANCE,
  KIND_FLOATING_IP,
  KIND_IMAGE,
  KIND_PROJECT,
];

/*
 * Workers where one down of several is a warning, because the others carry on. All
 * of them down is a control-plane outage, which getOpenStackAttentionItems says once
 * rather than once per worker.
 */
const REDUNDANT_WORKERS: ReadonlySet<string> = new Set([
  "nova-scheduler",
  "nova-conductor",
]);

function formatPercent(percent: number): string {
  return `${Math.round(percent)}%`;
}

// How long something has been in a state, as a reason and a list both write it.
export function formatOpenStackDuration(minutes: number): string {
  if (minutes < 120) {
    return `${Math.round(minutes)}m`;
  }
  if (minutes < 48 * 60) {
    return `${Math.round(minutes / 60)}h`;
  }
  return `${Math.round(minutes / (24 * 60))}d`;
}

function factsOf(row: OpenStackResource): JSONObject {
  return (row.facts as JSONObject | undefined) || {};
}

export function assessOpenStackApi(
  row: OpenStackResource,
): OpenStackAssessment {
  if (row.status !== "down") {
    return FINE;
  }
  return {
    severity: ResourceAttentionSeverity.Critical,
    reasons: [
      {
        text:
          factsOf(row)["scrapeFailed"] === true
            ? REASON_SCRAPE_FAILED
            : REASON_API_DOWN,
      },
    ],
  };
}

export function assessOpenStackService(data: {
  row: OpenStackResource;
  now: Date;
  // How many instances are on this host, for a nova-compute that went down.
  instanceCount?: number | null | undefined;
  // And whose they are, when the blast radius has been read.
  projectCount?: number | null | undefined;
}): OpenStackAssessment {
  const { row, now } = data;

  if (isOpenStackAdminDisabled(row.adminState)) {
    const minutes: number | null = minutesInState({
      stateChangedAt: row.stateChangedAt,
      now,
    });
    const days: number = minutes === null ? 0 : Math.floor(minutes / (24 * 60));
    if (days > OPENSTACK_SERVICE_DISABLED_WARNING_DAYS) {
      return {
        severity: ResourceAttentionSeverity.Warning,
        reasons: [{ text: REASON_DISABLED_LONG, values: { days: `${days}` } }],
      };
    }
    return FINE;
  }

  if (
    !isOpenStackServiceDown({ status: row.status, adminState: row.adminState })
  ) {
    return FINE;
  }

  if (REDUNDANT_WORKERS.has(row.name || "")) {
    return {
      severity: ResourceAttentionSeverity.Warning,
      reasons: [{ text: REASON_SERVICE_DOWN }],
    };
  }

  const count: number | null | undefined = data.instanceCount;
  if (row.name === "nova-compute" && count) {
    return {
      severity: ResourceAttentionSeverity.Critical,
      reasons: [
        {
          text: REASON_SERVICE_DOWN_WITH_INSTANCES.other,
          values: { count: `${count}` },
          plural: { one: REASON_SERVICE_DOWN_WITH_INSTANCES.one, count },
        },
        ...(data.projectCount
          ? [
              {
                text: REASON_SERVICE_DOWN_IN_PROJECTS.other,
                values: { count: `${data.projectCount}` },
                plural: {
                  one: REASON_SERVICE_DOWN_IN_PROJECTS.one,
                  count: data.projectCount,
                },
              },
            ]
          : []),
      ],
    };
  }

  return {
    severity: ResourceAttentionSeverity.Critical,
    reasons: [{ text: REASON_SERVICE_DOWN }],
  };
}

export function getOpenStackAllocation(row: OpenStackResource): {
  vcpuPercent: number | null;
  memoryPercent: number | null;
  diskPercent: number | null;
} {
  return {
    vcpuPercent: percentOf(row.vcpuAllocated, row.vcpuCapacity),
    memoryPercent: percentOf(
      row.memoryAllocatedBytes,
      row.memoryCapacityBytes,
    ),
    diskPercent: percentOf(row.diskAllocatedBytes, row.diskCapacityBytes),
  };
}

export function assessOpenStackHypervisor(
  row: OpenStackResource,
): OpenStackAssessment {
  /*
   * A lost hypervisor's numbers are its last known ones, and its nova-compute already
   * says what is wrong. One someone disabled takes no new instances, so how full it is
   * asks nothing of anyone.
   */
  if (
    isOpenStackServiceDown({ status: row.status, adminState: row.adminState }) ||
    isOpenStackAdminDisabled(row.adminState)
  ) {
    return FINE;
  }
  const { vcpuPercent, memoryPercent, diskPercent } =
    getOpenStackAllocation(row);
  const reasons: Array<ResourceAttentionText> = [];
  const add = (percent: number | null, text: string): void => {
    if (percent !== null && percent > OPENSTACK_ALLOCATION_WARNING_PERCENT) {
      reasons.push({ text, values: { percent: formatPercent(percent) } });
    }
  };
  add(vcpuPercent, REASON_VCPUS_ALLOCATED);
  add(memoryPercent, REASON_MEMORY_ALLOCATED);
  add(diskPercent, REASON_DISK_ALLOCATED);
  return {
    severity: reasons.length > 0 ? ResourceAttentionSeverity.Warning : null,
    reasons,
  };
}

/*
 * A host as one thing, for what draws a hypervisor rather than a list of workers. Nova's
 * hypervisor series keep their last numbers after its nova-compute stops, so the host's
 * state is its nova-compute's, in the rules that row has anyway: down is critical and
 * says how many instances are on it, and disabled is planned work. Otherwise it is how
 * full it is.
 */
export function assessOpenStackHost(data: {
  hypervisor: OpenStackResource;
  // Its nova-compute, when the inventory holds it. The hypervisor's row says the same.
  compute?: OpenStackResource | null | undefined;
  instanceCount?: number | null | undefined;
  now: Date;
}): OpenStackAssessment {
  const { hypervisor, compute, now } = data;
  const worker: OpenStackResource =
    compute ||
    Object.assign(new OpenStackResource(), {
      kind: OpenStackResourceKind.Service,
      name: "nova-compute",
      status: hypervisor.status,
      adminState: hypervisor.adminState,
      disabledReason: hypervisor.disabledReason,
      stateChangedAt: hypervisor.stateChangedAt,
    });

  if (
    isOpenStackServiceDown({
      status: worker.status,
      adminState: worker.adminState,
    }) ||
    isOpenStackAdminDisabled(worker.adminState)
  ) {
    return assessOpenStackService({
      row: worker,
      now,
      instanceCount: data.instanceCount ?? hypervisor.instanceCount,
    });
  }

  return assessOpenStackHypervisor(hypervisor);
}

/*
 * An instance on a host that is down. Nova still says ACTIVE, because the only thing
 * that could tell it otherwise has stopped, and it may well be running: it is what the
 * host's failure takes with it, so a warning, and never the critical its host already is.
 */
const REASON_HOST_DOWN: string = translationKey("Its hypervisor is down");

export function assessOpenStackInstanceOnHost(data: {
  row: OpenStackResource;
  now: Date;
  isHostDown: boolean;
}): OpenStackAssessment {
  const own: OpenStackAssessment = assessOpenStackInstance(data);
  if (!data.isHostDown || data.row.status === "SHUTOFF") {
    return own;
  }
  return {
    severity: ResourceAttentionSeverity.Warning,
    reasons: [...own.reasons, { text: REASON_HOST_DOWN }],
  };
}

export function assessOpenStackInstance(data: {
  row: OpenStackResource;
  now: Date;
}): OpenStackAssessment {
  const { row, now } = data;
  if (row.status === "ERROR") {
    return {
      severity: ResourceAttentionSeverity.Warning,
      reasons: [{ text: OPENSTACK_REASON_INSTANCE_ERROR }],
    };
  }
  if (
    isOpenStackInstanceStuck({
      status: row.status,
      stateChangedAt: row.stateChangedAt,
      now,
    })
  ) {
    return stuckAssessment(row, now);
  }
  return FINE;
}

function stuckAssessment(row: OpenStackResource, now: Date): OpenStackAssessment {
  const minutes: number =
    minutesInState({ stateChangedAt: row.stateChangedAt, now }) || 0;
  return {
    severity: ResourceAttentionSeverity.Warning,
    reasons: [
      {
        text: REASON_STUCK,
        values: {
          status: row.status || "",
          duration: formatOpenStackDuration(minutes),
        },
      },
    ],
  };
}

export function assessOpenStackVolume(data: {
  row: OpenStackResource;
  now: Date;
}): OpenStackAssessment {
  const { row, now } = data;
  if (isOpenStackVolumeInError(row.status)) {
    return {
      severity: ResourceAttentionSeverity.Warning,
      reasons: [{ text: REASON_VOLUME_ERROR, values: { status: row.status || "" } }],
    };
  }
  if (
    isOpenStackVolumeStuck({
      status: row.status,
      stateChangedAt: row.stateChangedAt,
      now,
    })
  ) {
    return stuckAssessment(row, now);
  }
  return FINE;
}

export function getOpenStackStoragePoolPercent(
  row: OpenStackResource,
): number | null {
  return percentOf(row.diskAllocatedBytes, row.diskCapacityBytes);
}

export function assessOpenStackStoragePool(
  row: OpenStackResource,
): OpenStackAssessment {
  const percent: number | null = getOpenStackStoragePoolPercent(row);
  if (percent === null || percent <= OPENSTACK_STORAGE_POOL_WARNING_PERCENT) {
    return FINE;
  }
  return {
    severity:
      percent > OPENSTACK_STORAGE_POOL_CRITICAL_PERCENT
        ? ResourceAttentionSeverity.Critical
        : ResourceAttentionSeverity.Warning,
    reasons: [
      { text: REASON_PERCENT_FULL, values: { percent: formatPercent(percent) } },
    ],
  };
}

/*
 * Only the networks people depend on being able to draw from. A tenant's own small
 * network filling up is theirs to see on its page, and would drown the rest.
 */
export function assessOpenStackNetwork(
  row: OpenStackResource,
): OpenStackAssessment {
  const facts: JSONObject = factsOf(row);
  if (facts["isExternal"] !== true) {
    return FINE;
  }
  const percent: number | null = getOpenStackNetworkIpPercent(facts);
  if (percent === null) {
    return FINE;
  }
  if (percent >= 100) {
    return {
      severity: ResourceAttentionSeverity.Critical,
      reasons: [{ text: REASON_NO_ADDRESSES }],
    };
  }
  if (percent > OPENSTACK_IP_POOL_WARNING_PERCENT) {
    return {
      severity: ResourceAttentionSeverity.Warning,
      reasons: [
        {
          text: REASON_ADDRESSES_USED,
          values: { percent: formatPercent(percent) },
        },
      ],
    };
  }
  return FINE;
}

export function assessOpenStackRouter(
  row: OpenStackResource,
): OpenStackAssessment {
  if (isOpenStackAdminDisabled(row.adminState)) {
    return FINE;
  }

  const severities: Array<ResourceAttentionSeverity> = [];
  const reasons: Array<ResourceAttentionText> = [];

  /*
   * On OVN no agent holds a router, so there is nothing to be missing: this only
   * speaks when agents were reported, and then none of them is alive.
   */
  const agents: Array<OpenStackL3AgentFact> = getOpenStackRouterAgents(
    factsOf(row),
  );
  if (agents.length > 0) {
    const alive: Array<OpenStackL3AgentFact> = agents.filter(
      (agent: OpenStackL3AgentFact) => {
        return agent.isAlive && agent.isAdminUp;
      },
    );
    if (alive.length === 0) {
      severities.push(ResourceAttentionSeverity.Critical);
      reasons.push({ text: REASON_ROUTER_NO_AGENT });
    }
    // Two agents both answering for one router is a split brain.
    const active: Array<OpenStackL3AgentFact> = alive.filter(
      (agent: OpenStackL3AgentFact) => {
        return agent.haState === "active";
      },
    );
    if (active.length > 1) {
      severities.push(ResourceAttentionSeverity.Critical);
      reasons.push({ text: REASON_ROUTER_TWO_ACTIVE });
    }
  }

  if (row.status && row.status !== "ACTIVE") {
    severities.push(ResourceAttentionSeverity.Warning);
    reasons.push({
      text: REASON_ROUTER_NOT_ACTIVE,
      values: { status: row.status },
    });
  }

  return { severity: mergeResourceAttentionSeverity(severities), reasons };
}

export function assessOpenStackFloatingIp(
  row: OpenStackResource,
): OpenStackAssessment {
  // A spare address is meant to be down: only one in use should be up.
  if (
    isOpenStackFloatingIpAssociated(factsOf(row)) &&
    row.status &&
    row.status !== "ACTIVE"
  ) {
    return {
      severity: ResourceAttentionSeverity.Warning,
      reasons: [{ text: REASON_FLOATING_IP_NOT_ACTIVE }],
    };
  }
  return FINE;
}

// An image left in queued is a failed upload nothing will ever move on.
export function assessOpenStackImage(data: {
  row: OpenStackResource;
  now: Date;
}): OpenStackAssessment {
  const { row, now } = data;
  if (
    isOpenStackImageStuck({
      status: row.status,
      stateChangedAt: row.stateChangedAt,
      now,
    })
  ) {
    return stuckAssessment(row, now);
  }
  return FINE;
}

/*
 * A project at a quota: its next instance or volume is about to be refused. A warning,
 * however far past the line, since nothing it runs now has stopped. Says nothing without
 * quota data, which most clouds do not collect, and nothing about a reading so old that
 * nobody is collecting it any more.
 */
export function assessOpenStackProject(data: {
  row: OpenStackResource;
  now: Date;
}): OpenStackAssessment {
  const quotas: Array<OpenStackProjectQuota> = getOpenStackProjectQuotas(
    factsOf(data.row),
    data.now,
  );
  const atLine: Array<OpenStackProjectQuota> = quotas.filter(
    (quota: OpenStackProjectQuota) => {
      return quota.isAtLine;
    },
  );

  if (atLine.length === 0) {
    return FINE;
  }

  const regions: Set<string> = new Set<string>(
    quotas.map((quota: OpenStackProjectQuota): string => {
      return quota.regionName;
    }),
  );

  return {
    severity: ResourceAttentionSeverity.Warning,
    reasons: atLine.map((quota: OpenStackProjectQuota) => {
      const sentences: { here: string; inRegion: string } =
        REASON_QUOTA_AT_LINE[quota.resource];
      const values: Record<string, string> = {
        used: `${quota.used}`,
        limit: `${quota.limit}`,
        percent: formatPercent(quota.percent || 0),
      };
      return regions.size > 1
        ? {
            text: sentences.inRegion,
            values: { ...values, region: quota.regionName },
          }
        : { text: sentences.here, values };
    }),
  };
}

export function assessOpenStackResource(data: {
  row: OpenStackResource;
  now: Date;
  instanceCountOnHost?: number | null | undefined;
  projectCountOnHost?: number | null | undefined;
}): OpenStackAssessment {
  const { row, now } = data;
  switch (row.kind) {
    case OpenStackResourceKind.Api:
      return assessOpenStackApi(row);
    case OpenStackResourceKind.Service:
      return assessOpenStackService({
        row,
        now,
        instanceCount: data.instanceCountOnHost,
        projectCount: data.projectCountOnHost,
      });
    case OpenStackResourceKind.Hypervisor:
      return assessOpenStackHypervisor(row);
    case OpenStackResourceKind.Instance:
      return assessOpenStackInstance({ row, now });
    case OpenStackResourceKind.Volume:
      return assessOpenStackVolume({ row, now });
    case OpenStackResourceKind.StoragePool:
      return assessOpenStackStoragePool(row);
    case OpenStackResourceKind.Network:
      return assessOpenStackNetwork(row);
    case OpenStackResourceKind.Router:
      return assessOpenStackRouter(row);
    case OpenStackResourceKind.FloatingIp:
      return assessOpenStackFloatingIp(row);
    case OpenStackResourceKind.Project:
      return assessOpenStackProject({ row, now });
    case OpenStackResourceKind.Image:
      return assessOpenStackImage({ row, now });
    default:
      return FINE;
  }
}

const KIND_WORDS: Partial<Record<string, string>> = {
  [OpenStackResourceKind.Api]: KIND_API,
  [OpenStackResourceKind.Service]: KIND_SERVICE,
  [OpenStackResourceKind.Hypervisor]: KIND_HYPERVISOR,
  [OpenStackResourceKind.Instance]: KIND_INSTANCE,
  [OpenStackResourceKind.Volume]: KIND_VOLUME,
  [OpenStackResourceKind.StoragePool]: KIND_STORAGE_POOL,
  [OpenStackResourceKind.Network]: KIND_NETWORK,
  [OpenStackResourceKind.Router]: KIND_ROUTER,
  [OpenStackResourceKind.FloatingIp]: KIND_FLOATING_IP,
  [OpenStackResourceKind.Project]: KIND_PROJECT,
  [OpenStackResourceKind.Image]: KIND_IMAGE,
};

function iconOf(kind: string | undefined): IconProp {
  switch (kind) {
    case OpenStackResourceKind.Hypervisor:
      return IconProp.ServerStack;
    case OpenStackResourceKind.Volume:
    case OpenStackResourceKind.StoragePool:
      return IconProp.Database;
    case OpenStackResourceKind.Image:
      return IconProp.Image;
    case OpenStackResourceKind.Network:
    case OpenStackResourceKind.Router:
    case OpenStackResourceKind.FloatingIp:
      return IconProp.Globe;
    case OpenStackResourceKind.Api:
    case OpenStackResourceKind.Service:
      return IconProp.Cog;
    case OpenStackResourceKind.Project:
      return IconProp.Folder;
    default:
      return IconProp.Cube;
  }
}

/*
 * The hypervisors' instance counts by host, which turn "nova-compute is down" into
 * how much that means. Hosts in different regions can share a name, so the region
 * is part of the key. Nova's service says compute-01 where its hypervisor says
 * compute-01.example.internal, so the key is the short name.
 */
function instanceCountsByHost(
  rows: Array<OpenStackResource>,
): Map<string, number> {
  const counts: Map<string, number> = new Map();
  for (const row of rows) {
    if (
      row.kind === OpenStackResourceKind.Hypervisor &&
      row.hypervisorName &&
      typeof row.instanceCount === "number"
    ) {
      counts.set(
        `${row.regionName}/${getOpenStackShortHostName(row.hypervisorName)}`,
        row.instanceCount,
      );
    }
  }
  return counts;
}

/*
 * Every scheduler or conductor of a region down is one thing that went wrong, not
 * one per worker, and it stops the whole region creating anything.
 */
function getEveryWorkerDownItems(
  rows: Array<OpenStackResource>,
  routeFor?: OpenStackRouteFor | undefined,
): Array<ResourceAttentionItem> {
  const byRegionAndWorker: Map<
    string,
    {
      region: string;
      worker: string;
      up: number;
      down: number;
      first: OpenStackResource;
    }
  > = new Map();
  for (const row of rows) {
    if (
      row.kind !== OpenStackResourceKind.Service ||
      !REDUNDANT_WORKERS.has(row.name || "") ||
      isOpenStackAdminDisabled(row.adminState)
    ) {
      continue;
    }
    const key: string = `${row.regionName}/${row.name}`;
    const entry: {
      region: string;
      worker: string;
      up: number;
      down: number;
      first: OpenStackResource;
    } = byRegionAndWorker.get(key) || {
      region: row.regionName || "",
      worker: row.name || "",
      up: 0,
      down: 0,
      first: row,
    };
    if (row.status === "down") {
      entry.down += 1;
    } else {
      entry.up += 1;
    }
    byRegionAndWorker.set(key, entry);
  }

  const items: Array<ResourceAttentionItem> = [];
  for (const entry of byRegionAndWorker.values()) {
    if (entry.down > 0 && entry.up === 0) {
      items.push({
        key: `every-${entry.region}-${entry.worker}`,
        kind: KIND_SERVICE,
        icon: IconProp.Cog,
        name: entry.worker,
        detail: entry.region,
        severity: ResourceAttentionSeverity.Critical,
        reasons: [
          { text: REASON_EVERY_DOWN, values: { service: entry.worker } },
        ],
        // One of them, since all of them are the same answer.
        route: routeFor?.(entry.first),
      });
    }
  }
  return items;
}

export function getOpenStackAttentionItems(data: {
  rows: Array<OpenStackResource>;
  now: Date;
  routeFor?: OpenStackRouteFor | undefined;
  // How a part reads when its own name is not what a person calls it: an API's type.
  nameFor?: ((row: OpenStackResource) => string) | undefined;
  /*
   * What a lost host takes with it, once read (POST /blast-radius). A hypervisor's own
   * count stands in until then, and says nothing about whose they are.
   */
  blastRadiusFor?:
    | ((
        row: OpenStackResource,
      ) => { instanceCount: number; projectCount: number } | null | undefined)
    | undefined;
}): Array<ResourceAttentionItem> {
  const counts: Map<string, number> = instanceCountsByHost(data.rows);
  const everyWorkerDown: Array<ResourceAttentionItem> = getEveryWorkerDownItems(
    data.rows,
    data.routeFor,
  );
  const coveredByEveryWorkerDown: Set<string> = new Set(
    everyWorkerDown.map((item: ResourceAttentionItem) => {
      return `${item.detail}/${item.name}`;
    }),
  );

  const items: Array<ResourceAttentionItem> = [...everyWorkerDown];

  for (const row of data.rows) {
    if (
      row.kind === OpenStackResourceKind.Service &&
      coveredByEveryWorkerDown.has(`${row.regionName}/${row.name}`)
    ) {
      continue;
    }
    const host: unknown = factsOf(row)["host"];
    const radius: { instanceCount: number; projectCount: number } | null | undefined =
      data.blastRadiusFor?.(row);
    const assessment: OpenStackAssessment = assessOpenStackResource({
      row,
      now: data.now,
      instanceCountOnHost:
        radius?.instanceCount ??
        (typeof host === "string"
          ? counts.get(`${row.regionName}/${getOpenStackShortHostName(host)}`)
          : undefined),
      projectCountOnHost: radius?.projectCount,
    });
    if (!assessment.severity) {
      continue;
    }
    items.push({
      key: `${row.kind}/${row.externalId}`,
      kind: KIND_WORDS[row.kind || ""] || row.kind || "",
      icon: iconOf(row.kind),
      name: data.nameFor?.(row) || getOpenStackDisplayName(row),
      detail: getOpenStackDetail(row),
      severity: assessment.severity,
      reasons: assessment.reasons,
      // What Nova recorded about why it failed, in its own words. Only a probe has this.
      message:
        typeof factsOf(row)["faultMessage"] === "string"
          ? (factsOf(row)["faultMessage"] as string)
          : undefined,
      route: data.routeFor?.(row),
    });
  }

  return sortResourceAttention(items, OPENSTACK_ATTENTION_KIND_ORDER);
}

export function getOpenStackHealth(
  items: Array<ResourceAttentionItem>,
): ResourceHealth {
  return getResourceAttentionHealth(items);
}

// A part's name as people know it, or its id when OpenStack gave it none.
export function getOpenStackDisplayName(row: OpenStackResource): string {
  if (row.name) {
    return row.name;
  }
  const externalId: string = row.externalId || "";
  return externalId.substring(externalId.lastIndexOf("/") + 1);
}

// Where a part sits, in the words of what it sits on.
function getOpenStackDetail(row: OpenStackResource): string | undefined {
  const host: unknown = factsOf(row)["host"];
  if (row.kind === OpenStackResourceKind.Service && typeof host === "string") {
    return row.regionName ? `${host} · ${row.regionName}` : host;
  }
  if (row.kind === OpenStackResourceKind.Api) {
    return row.regionName || undefined;
  }
  if (row.kind === OpenStackResourceKind.Instance && row.hypervisorName) {
    return row.hypervisorName;
  }
  return row.regionName || undefined;
}
