import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import { JSONObject } from "Common/Types/JSON";
import {
  getOpenStackShortHostName,
  isOpenStackAdminDisabled,
  isOpenStackServiceDown,
} from "Common/Types/OpenStack/OpenStackHealthRules";
import {
  OpenStackResourceKind,
  OpenStackServiceFamily,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  OpenStackAssessment,
  assessOpenStackApi,
  assessOpenStackFloatingIp,
  assessOpenStackHost,
  assessOpenStackInstanceOnHost,
  assessOpenStackNetwork,
  assessOpenStackRouter,
  assessOpenStackService,
  assessOpenStackStoragePool,
  assessOpenStackVolume,
  getOpenStackAllocation,
  getOpenStackDisplayName,
  getOpenStackStoragePoolPercent,
} from "../../../Pages/OpenStack/Utils/OpenStackHealth";
import PageMap from "../../../Utils/PageMap";
import {
  ResourceAttentionSeverity,
  ResourceAttentionText,
} from "../../ResourcePart/ResourceAttention";
import { SECTION_KIND } from "../ResourceTopologyKinds";
import {
  OpenIssueRecord,
  attachOpenIssues,
  readSeriesLabel,
} from "../ResourceTopologyIssues";
import { formatTopologyPercent, isRecent } from "../ResourceTopologyFormat";
import {
  ResourceTopologyFact,
  ResourceTopologyGraph,
  ResourceTopologyHealth,
  ResourceTopologyLinkTarget,
  ResourceTopologyNode,
  ResourceTopologyNodeInput,
  ResourceTopologyRelation,
  ResourceTopologyText,
  ResourceTopologyTruncation,
  buildResourceTopologyGraph,
} from "../ResourceTopologyModel";

/*
 * An OpenStack cloud's topology: where everything runs, what it is attached to, and
 * whose it is.
 *
 *   cloud > region > availability zone > hypervisor > instance > volume
 *   region > Network > external network > router > floating IP
 *   region > Storage > storage pool
 *   region > Control plane > APIs and workers
 *
 * What the agent's exporter says, and so what is drawn. A volume names the instance it
 * is attached to. A floating IP names its router, a router its external network and a
 * subnet its network. An instance names no network, and a volume no pool, so those two
 * joins are not drawn at all rather than guessed, and the page says so
 * (getOpenStackTopologyGaps). A native collector that says which pool holds a volume
 * joins the two with a relation.
 *
 * Health is OpenStackHealth's, the same rules as Needs attention: a host whose
 * nova-compute stopped is critical and says how many instances it held, and its
 * instances beneath it say why they need attention. A cloud that has stopped reporting
 * says so at the top and nothing below it, because nothing below it is current.
 *
 * Past a stated size only what has failed and what that affects is read at all
 * (OpenStackResourceService.getTopologyRead), so a hypervisor says how many instances it
 * holds from a count, whether or not they are drawn beneath it.
 */

export const OPENSTACK_ROOT_ID: string = "cloud";

// Three of the slowest collections, the inventory's own window for a row gone quiet.
export const OPENSTACK_STALE_MS: number = 15 * 60 * 1000;

export interface OpenStackInstancesByHost {
  regionName: string | null;
  hypervisorName: string;
  instanceCount: number;
}

export interface OpenStackTopologyInput {
  cloud: { id: string; name: string; lastSeenAt?: Date | null | undefined };
  rows: Array<OpenStackResource>;
  instancesByHost?: Array<OpenStackInstancesByHost> | undefined;
  projectNames?: Record<string, string> | undefined;
  issues?: Array<OpenIssueRecord> | undefined;
  now: Date;
  truncations?: Array<ResourceTopologyTruncation> | undefined;
}

const SECTION_NETWORK: string = translationKey("Network");
const SECTION_STORAGE: string = translationKey("Storage");
const SECTION_CONTROL_PLANE: string = translationKey("Control plane");
const SECTION_NO_REGION: string = translationKey("No region reported");
const SECTION_NO_ZONE: string = translationKey("No availability zone reported");

const RELATION_STORED_IN: string = translationKey("Stored in");
const RELATION_STORES: string = translationKey("Stores");
const RELATION_HELD_BY: string = translationKey("Held by");
const RELATION_HOLDS: string = translationKey("Holds");
const RELATION_RUNS_ON: string = translationKey("Runs on");
const RELATION_RUNS_HERE: string = translationKey("Runs here");

function factsOf(row: OpenStackResource): JSONObject {
  return (row.facts as JSONObject | undefined) || {};
}

function text(
  value: string,
  values?: Record<string, string> | undefined,
): ResourceTopologyText {
  return values ? { text: value, values: values } : { text: value };
}

function toReasons(
  reasons: Array<ResourceAttentionText>,
): Array<ResourceTopologyText> {
  return reasons.map((reason: ResourceAttentionText): ResourceTopologyText => {
    return text(reason.text, reason.values);
  });
}

function hostKey(
  regionName: string | null | undefined,
  hostName: string | null | undefined,
): string {
  return `${regionName || ""}/${getOpenStackShortHostName(hostName)}`;
}

// A word OpenStack wrote, as it wrote it: ACTIVE, in-use, down.
function asWritten(row: OpenStackResource): ResourceTopologyText | undefined {
  return row.status ? text("{{status}}", { status: row.status }) : undefined;
}

function fromAssessment(
  assessment: OpenStackAssessment,
  fine: ResourceTopologyHealth,
): { health: ResourceTopologyHealth; reasons: Array<ResourceTopologyText> } {
  if (assessment.severity === ResourceAttentionSeverity.Critical) {
    return { health: "critical", reasons: toReasons(assessment.reasons) };
  }
  if (assessment.severity === ResourceAttentionSeverity.Warning) {
    return { health: "warning", reasons: toReasons(assessment.reasons) };
  }
  return { health: fine, reasons: [] };
}

function linkTo(
  cloudId: string,
  page: PageMap,
  externalId: string,
): ResourceTopologyLinkTarget {
  return {
    page: page,
    modelId: cloudId,
    subModelId: encodeURIComponent(externalId),
  };
}

// What is left when a part has said what it is: how the inventory words its own state.
function instanceHealthWhenFine(
  row: OpenStackResource,
): ResourceTopologyHealth {
  if (row.status === "SHUTOFF" || row.status === "SUSPENDED") {
    return "off";
  }
  return row.status ? "healthy" : "unknown";
}

export function buildOpenStackTopology(
  input: OpenStackTopologyInput,
): ResourceTopologyGraph {
  const cloudId: string = input.cloud.id;
  const now: Date = input.now;
  const isReporting: boolean =
    isRecent(input.cloud.lastSeenAt, now, OPENSTACK_STALE_MS) ||
    input.rows.some((row: OpenStackResource): boolean => {
      return isRecent(row.lastSeenAt, now, OPENSTACK_STALE_MS);
    });

  /*
   * A cloud that has stopped reporting has no current state, so nothing below it can
   * be called broken or fine: it holds what it held, and says nothing about it.
   */
  const judge: (
    assessment: () => OpenStackAssessment,
    fine: ResourceTopologyHealth,
  ) => {
    health: ResourceTopologyHealth;
    reasons: Array<ResourceTopologyText>;
  } = (assessment: () => OpenStackAssessment, fine: ResourceTopologyHealth) => {
    return isReporting
      ? fromAssessment(assessment(), fine)
      : { health: "unknown", reasons: [] };
  };

  const nodes: Array<ResourceTopologyNodeInput> = [
    {
      id: OPENSTACK_ROOT_ID,
      parentId: null,
      kind: "openstack.cloud",
      name: input.cloud.name || "OpenStack",
      health: isReporting
        ? "healthy"
        : input.cloud.lastSeenAt
          ? "warning"
          : "unknown",
      status: isReporting
        ? text(translationKey("Reporting"))
        : input.cloud.lastSeenAt
          ? text(translationKey("Not reporting"))
          : text(translationKey("No data yet")),
      reasons:
        !isReporting && input.cloud.lastSeenAt
          ? [
              text(
                translationKey(
                  "Nothing below this can be read as current until the cloud reports again.",
                ),
              ),
            ]
          : [],
      link: { page: PageMap.OPENSTACK_CLOUD_VIEW, modelId: cloudId },
    },
  ];
  const relations: Array<ResourceTopologyRelation> = [];

  const byKind: Map<string, Array<OpenStackResource>> = new Map();
  for (const row of input.rows) {
    if (!row.externalId || !row.kind) {
      continue;
    }
    const list: Array<OpenStackResource> = byKind.get(row.kind) || [];
    list.push(row);
    byKind.set(row.kind, list);
  }
  const rowsOf: (kind: OpenStackResourceKind) => Array<OpenStackResource> = (
    kind: OpenStackResourceKind,
  ): Array<OpenStackResource> => {
    return byKind.get(kind) || [];
  };

  // Regions, and the sections inside each, only when something stands in them.
  const regions: Set<string> = new Set<string>();
  const regionId: (regionName: string | null | undefined) => string = (
    regionName: string | null | undefined,
  ): string => {
    const name: string = regionName || "";
    if (!regions.has(name)) {
      regions.add(name);
      nodes.push({
        id: `region:${name}`,
        parentId: OPENSTACK_ROOT_ID,
        kind: name ? "openstack.region" : SECTION_KIND,
        isSection: !name,
        name: name || SECTION_NO_REGION,
        health: "healthy",
      });
    }
    return `region:${name}`;
  };

  const sections: Set<string> = new Set<string>();
  const sectionId: (
    regionName: string | null | undefined,
    key: string,
    name: string,
  ) => string = (
    regionName: string | null | undefined,
    key: string,
    name: string,
  ): string => {
    const id: string = `section:${regionName || ""}/${key}`;
    if (!sections.has(id)) {
      sections.add(id);
      nodes.push({
        id: id,
        parentId: regionId(regionName),
        kind: SECTION_KIND,
        isSection: true,
        name: name,
        health: "healthy",
      });
    }
    return id;
  };

  const zones: Set<string> = new Set<string>();
  const zoneId: (
    regionName: string | null | undefined,
    zone: string | null | undefined,
  ) => string = (
    regionName: string | null | undefined,
    zone: string | null | undefined,
  ): string => {
    const name: string = zone || "";
    const id: string = `az:${regionName || ""}/${name}`;
    if (!zones.has(id)) {
      zones.add(id);
      nodes.push({
        id: id,
        parentId: regionId(regionName),
        kind: name ? "openstack.az" : SECTION_KIND,
        isSection: !name,
        name: name || SECTION_NO_ZONE,
        health: "healthy",
      });
    }
    return id;
  };

  const projectName: (row: OpenStackResource) => string | undefined = (
    row: OpenStackResource,
  ): string | undefined => {
    const id: string | undefined = row.openStackProjectId;
    return id ? input.projectNames?.[id] || id : undefined;
  };

  const projectFacts: (
    row: OpenStackResource,
  ) => Array<ResourceTopologyFact> = (
    row: OpenStackResource,
  ): Array<ResourceTopologyFact> => {
    const name: string | undefined = projectName(row);
    return name ? [{ label: translationKey("Project"), value: name }] : [];
  };

  const projectKeywords: (row: OpenStackResource) => Array<string> = (
    row: OpenStackResource,
  ): Array<string> => {
    const name: string | undefined = projectName(row);
    return [name, row.openStackProjectId, row.externalId].filter(
      (word: string | undefined): word is string => {
        return Boolean(word);
      },
    );
  };

  // The workers, first: a hypervisor's state is its nova-compute's.
  const computeByHost: Map<string, OpenStackResource> = new Map();
  const serviceIds: Map<string, string> = new Map();
  const agentIds: Map<string, string> = new Map();
  for (const row of rowsOf(OpenStackResourceKind.Service)) {
    const host: unknown = factsOf(row)["host"];
    const id: string = `service:${row.externalId}`;
    if (row.name === "nova-compute" && typeof host === "string") {
      computeByHost.set(hostKey(row.regionName, host), row);
    }
    serviceIds.set(
      `${row.regionName || ""}/${row.name || ""}/${getOpenStackShortHostName(host as string | undefined)}`,
      id,
    );
    const agentId: unknown = factsOf(row)["agentId"];
    if (typeof agentId === "string") {
      agentIds.set(agentId, id);
    }
  }

  const instanceCountByHost: Map<string, number> = new Map();
  for (const host of input.instancesByHost || []) {
    const key: string = hostKey(host.regionName, host.hypervisorName);
    instanceCountByHost.set(
      key,
      (instanceCountByHost.get(key) || 0) + host.instanceCount,
    );
  }

  /*
   * What a host holds, from the count when there is one, because past the stated size
   * its instances are not all read. The hypervisor's own figure is Nova's, and is only
   * there when Nova's series were on.
   */
  const instancesOnHost: (row: OpenStackResource) => number | null = (
    row: OpenStackResource,
  ): number | null => {
    const counted: number | undefined = instanceCountByHost.get(
      hostKey(row.regionName, row.hypervisorName || row.name),
    );
    if (counted !== undefined) {
      return counted;
    }
    return typeof row.instanceCount === "number" ? row.instanceCount : null;
  };

  const hypervisorIds: Map<string, string> = new Map();
  const hostsDown: Set<string> = new Set<string>();

  for (const row of rowsOf(OpenStackResourceKind.Hypervisor)) {
    const id: string = `hypervisor:${row.externalId}`;
    const key: string = hostKey(row.regionName, row.hypervisorName || row.name);
    const compute: OpenStackResource | undefined = computeByHost.get(key);
    const held: number | null = instancesOnHost(row);
    const verdict: {
      health: ResourceTopologyHealth;
      reasons: Array<ResourceTopologyText>;
    } = judge(() => {
      return assessOpenStackHost({
        hypervisor: row,
        compute: compute,
        instanceCount: held,
        now: now,
      });
    }, "healthy");

    const status: string | undefined = compute?.status || row.status;
    const adminState: string | undefined =
      compute?.adminState || row.adminState;
    const isDown: boolean = isOpenStackServiceDown({ status, adminState });
    const isDisabled: boolean = isOpenStackAdminDisabled(adminState);

    if (isDown) {
      hostsDown.add(key);
    }
    hypervisorIds.set(key, id);

    const facts: Array<ResourceTopologyFact> = [];
    const allocation: { vcpuPercent: number | null } =
      getOpenStackAllocation(row);
    // A lost host's numbers are its last ones, and say nothing about room.
    if (!isDown && allocation.vcpuPercent !== null) {
      facts.push({
        label: translationKey("vCPUs allocated"),
        value: formatTopologyPercent(allocation.vcpuPercent),
      });
    }
    if (held !== null) {
      facts.push({ label: translationKey("Instances"), value: `${held}` });
    }

    nodes.push({
      id: id,
      parentId: zoneId(row.regionName, row.availabilityZone),
      kind: "openstack.hypervisor",
      name: getOpenStackDisplayName(row),
      health:
        isDisabled && isReporting && verdict.health === "healthy"
          ? "off"
          : verdict.health,
      status: isDown
        ? text(translationKey("Down"))
        : isDisabled
          ? text(translationKey("Disabled"))
          : status
            ? text("{{status}}", { status })
            : undefined,
      reasons: verdict.reasons,
      facts: facts,
      link: linkTo(
        cloudId,
        PageMap.OPENSTACK_CLOUD_VIEW_HYPERVISOR_DETAIL,
        row.externalId!,
      ),
    });
  }

  const instanceIds: Map<string, string> = new Map();

  for (const row of rowsOf(OpenStackResourceKind.Instance)) {
    const id: string = `instance:${row.externalId}`;
    instanceIds.set(row.externalId!, id);
    const key: string = hostKey(row.regionName, row.hypervisorName);
    const verdict: {
      health: ResourceTopologyHealth;
      reasons: Array<ResourceTopologyText>;
    } = judge(() => {
      return assessOpenStackInstanceOnHost({
        row: row,
        now: now,
        isHostDown: hostsDown.has(key),
      });
    }, instanceHealthWhenFine(row));

    /*
     * One that failed before it was placed has no host, and belongs to its zone: what
     * Nova said about where it should have gone is all there is.
     */
    nodes.push({
      id: id,
      parentId:
        hypervisorIds.get(key) || zoneId(row.regionName, row.availabilityZone),
      kind: "openstack.instance",
      name: getOpenStackDisplayName(row),
      health: verdict.health,
      status: asWritten(row),
      reasons: verdict.reasons,
      facts: projectFacts(row),
      context: projectName(row),
      keywords: [...projectKeywords(row), row.hypervisorName || ""],
      link: linkTo(
        cloudId,
        PageMap.OPENSTACK_CLOUD_VIEW_INSTANCE_DETAIL,
        row.externalId!,
      ),
    });
  }

  const poolIds: Map<string, string> = new Map();

  for (const row of rowsOf(OpenStackResourceKind.StoragePool)) {
    const id: string = `pool:${row.externalId}`;
    poolIds.set(`${row.regionName || ""}/${row.name || ""}`, id);
    const verdict: {
      health: ResourceTopologyHealth;
      reasons: Array<ResourceTopologyText>;
    } = judge(() => {
      return assessOpenStackStoragePool(row);
    }, "healthy");
    const percent: number | null = getOpenStackStoragePoolPercent(row);

    nodes.push({
      id: id,
      parentId: sectionId(row.regionName, "storage", SECTION_STORAGE),
      kind: "openstack.pool",
      name: getOpenStackDisplayName(row),
      health: verdict.health,
      status:
        percent === null
          ? undefined
          : text(translationKey("{{percent}} used"), {
              percent: formatTopologyPercent(percent),
            }),
      reasons: verdict.reasons,
      link: linkTo(
        cloudId,
        PageMap.OPENSTACK_CLOUD_VIEW_STORAGE_POOL_DETAIL,
        row.externalId!,
      ),
    });
  }

  const volumeIds: Map<string, string> = new Map();

  for (const row of rowsOf(OpenStackResourceKind.Volume)) {
    const id: string = `volume:${row.externalId}`;
    volumeIds.set(row.externalId!, id);
    const attachedTo: unknown = factsOf(row)["attachedToInstance"];
    const verdict: {
      health: ResourceTopologyHealth;
      reasons: Array<ResourceTopologyText>;
    } = judge(
      () => {
        return assessOpenStackVolume({ row, now });
      },
      row.status ? "healthy" : "unknown",
    );

    nodes.push({
      id: id,
      parentId:
        (typeof attachedTo === "string" && instanceIds.get(attachedTo)) ||
        sectionId(row.regionName, "storage", SECTION_STORAGE),
      kind: "openstack.volume",
      name: getOpenStackDisplayName(row),
      health: verdict.health,
      status: asWritten(row),
      reasons: verdict.reasons,
      facts: projectFacts(row),
      context: projectName(row),
      keywords: projectKeywords(row),
      link: linkTo(
        cloudId,
        PageMap.OPENSTACK_CLOUD_VIEW_VOLUME_DETAIL,
        row.externalId!,
      ),
    });

    const pool: unknown = factsOf(row)["pool"];
    const poolId: string | undefined =
      typeof pool === "string"
        ? poolIds.get(`${row.regionName || ""}/${pool}`)
        : undefined;
    if (poolId) {
      relations.push({
        from: id,
        to: poolId,
        label: RELATION_STORED_IN,
        inverseLabel: RELATION_STORES,
      });
    }
  }

  const networkIds: Map<string, string> = new Map();

  for (const row of rowsOf(OpenStackResourceKind.Network)) {
    const id: string = `network:${row.externalId}`;
    networkIds.set(row.externalId!, id);
    const verdict: {
      health: ResourceTopologyHealth;
      reasons: Array<ResourceTopologyText>;
    } = judge(() => {
      return assessOpenStackNetwork(row);
    }, "healthy");

    nodes.push({
      id: id,
      parentId: sectionId(row.regionName, "network", SECTION_NETWORK),
      kind: "openstack.network",
      name: getOpenStackDisplayName(row),
      health: verdict.health,
      status: asWritten(row),
      reasons: verdict.reasons,
      facts: projectFacts(row),
      context: projectName(row),
      keywords: projectKeywords(row),
      link: linkTo(
        cloudId,
        PageMap.OPENSTACK_CLOUD_VIEW_NETWORK_DETAIL,
        row.externalId!,
      ),
    });
  }

  for (const row of rowsOf(OpenStackResourceKind.Subnet)) {
    const networkId: unknown = factsOf(row)["networkId"];
    const cidr: unknown = factsOf(row)["cidr"];
    nodes.push({
      id: `subnet:${row.externalId}`,
      parentId:
        (typeof networkId === "string" && networkIds.get(networkId)) ||
        sectionId(row.regionName, "network", SECTION_NETWORK),
      kind: "openstack.subnet",
      name: getOpenStackDisplayName(row),
      health: isReporting ? "healthy" : "unknown",
      status:
        typeof cidr === "string"
          ? text("{{status}}", { status: cidr })
          : undefined,
      keywords: projectKeywords(row),
      context: projectName(row),
      link: linkTo(
        cloudId,
        PageMap.OPENSTACK_CLOUD_VIEW_SUBNET_DETAIL,
        row.externalId!,
      ),
    });
  }

  const routerIds: Map<string, string> = new Map();

  for (const row of rowsOf(OpenStackResourceKind.Router)) {
    const id: string = `router:${row.externalId}`;
    routerIds.set(row.externalId!, id);
    const externalNetworkId: unknown = factsOf(row)["externalNetworkId"];
    const verdict: {
      health: ResourceTopologyHealth;
      reasons: Array<ResourceTopologyText>;
    } = judge(
      () => {
        return assessOpenStackRouter(row);
      },
      isOpenStackAdminDisabled(row.adminState) ? "off" : "healthy",
    );

    nodes.push({
      id: id,
      parentId:
        (typeof externalNetworkId === "string" &&
          networkIds.get(externalNetworkId)) ||
        sectionId(row.regionName, "network", SECTION_NETWORK),
      kind: "openstack.router",
      name: getOpenStackDisplayName(row),
      health: verdict.health,
      status: asWritten(row),
      reasons: verdict.reasons,
      facts: projectFacts(row),
      context: projectName(row),
      keywords: projectKeywords(row),
      link: linkTo(
        cloudId,
        PageMap.OPENSTACK_CLOUD_VIEW_ROUTER_DETAIL,
        row.externalId!,
      ),
    });

    const agents: JSONObject | undefined = factsOf(row)["l3Agents"] as
      | JSONObject
      | undefined;
    for (const agentId of Object.keys(agents || {})) {
      const serviceId: string | undefined = agentIds.get(agentId);
      if (serviceId) {
        relations.push({
          from: id,
          to: serviceId,
          label: RELATION_HELD_BY,
          inverseLabel: RELATION_HOLDS,
        });
      }
    }
  }

  for (const row of rowsOf(OpenStackResourceKind.FloatingIp)) {
    const routerId: unknown = factsOf(row)["routerId"];
    const floatingNetworkId: unknown = factsOf(row)["floatingNetworkId"];
    const verdict: {
      health: ResourceTopologyHealth;
      reasons: Array<ResourceTopologyText>;
    } = judge(() => {
      return assessOpenStackFloatingIp(row);
    }, "healthy");

    nodes.push({
      id: `floatingip:${row.externalId}`,
      parentId:
        (typeof routerId === "string" && routerIds.get(routerId)) ||
        (typeof floatingNetworkId === "string" &&
          networkIds.get(floatingNetworkId)) ||
        sectionId(row.regionName, "network", SECTION_NETWORK),
      kind: "openstack.floatingip",
      name: getOpenStackDisplayName(row),
      health: verdict.health,
      status: asWritten(row),
      reasons: verdict.reasons,
      facts: projectFacts(row),
      context: projectName(row),
      keywords: projectKeywords(row),
      link: linkTo(
        cloudId,
        PageMap.OPENSTACK_CLOUD_VIEW_FLOATING_IP_DETAIL,
        row.externalId!,
      ),
    });
  }

  for (const row of rowsOf(OpenStackResourceKind.Api)) {
    const verdict: {
      health: ResourceTopologyHealth;
      reasons: Array<ResourceTopologyText>;
    } = judge(
      () => {
        return assessOpenStackApi(row);
      },
      row.status ? "healthy" : "unknown",
    );

    nodes.push({
      id: `api:${row.externalId}`,
      parentId: sectionId(row.regionName, "control", SECTION_CONTROL_PLANE),
      kind: "openstack.api",
      name: getOpenStackDisplayName(row),
      health: verdict.health,
      status: asWritten(row),
      reasons: verdict.reasons,
      link: linkTo(
        cloudId,
        PageMap.OPENSTACK_CLOUD_VIEW_SERVICE_DETAIL,
        row.externalId!,
      ),
    });
  }

  for (const row of rowsOf(OpenStackResourceKind.Service)) {
    const id: string = `service:${row.externalId}`;
    const host: unknown = factsOf(row)["host"];
    const hostName: string | undefined =
      typeof host === "string" ? host : undefined;
    const isDisabled: boolean = isOpenStackAdminDisabled(row.adminState);
    const held: number | undefined =
      row.name === "nova-compute"
        ? instanceCountByHost.get(hostKey(row.regionName, hostName))
        : undefined;
    const verdict: {
      health: ResourceTopologyHealth;
      reasons: Array<ResourceTopologyText>;
    } = judge(
      () => {
        return assessOpenStackService({
          row: row,
          now: now,
          instanceCount: held,
        });
      },
      isDisabled ? "off" : row.status ? "healthy" : "unknown",
    );

    nodes.push({
      id: id,
      parentId: sectionId(row.regionName, "control", SECTION_CONTROL_PLANE),
      kind: "openstack.service",
      name: getOpenStackDisplayName(row),
      health: verdict.health,
      status: isDisabled ? text(translationKey("Disabled")) : asWritten(row),
      reasons: verdict.reasons,
      context: hostName,
      keywords: hostName ? [hostName] : [],
      // A Neutron agent has a page of its own, with the routers it holds.
      link: linkTo(
        cloudId,
        factsOf(row)["family"] === OpenStackServiceFamily.Network
          ? PageMap.OPENSTACK_CLOUD_VIEW_NETWORK_AGENT_DETAIL
          : PageMap.OPENSTACK_CLOUD_VIEW_SERVICE_DETAIL,
        row.externalId!,
      ),
    });

    const hypervisorId: string | undefined = hypervisorIds.get(
      hostKey(row.regionName, hostName),
    );
    if (hypervisorId) {
      relations.push({
        from: id,
        to: hypervisorId,
        label: RELATION_RUNS_ON,
        inverseLabel: RELATION_RUNS_HERE,
      });
    }
  }

  /*
   * Which part a record is about. Names of labels differ by series: `id` is an instance
   * on one and a network on another, so each map is asked in turn, and IDs are unique
   * across kinds. A worker's series name its host and binary, and a nova-compute's
   * failure is drawn on its host, where the instances are.
   */
  const locate: (record: OpenIssueRecord) => string | null = (
    record: OpenIssueRecord,
  ): string | null => {
    const labels: JSONObject | null = record.seriesLabels;
    const id: string | null =
      readSeriesLabel(labels, "uuid") || readSeriesLabel(labels, "id");

    if (id) {
      const found: string | undefined =
        instanceIds.get(id) ||
        volumeIds.get(id) ||
        routerIds.get(id) ||
        networkIds.get(id);
      if (found) {
        return found;
      }
    }

    const region: string | null = readSeriesLabel(
      labels,
      "openstack.region.name",
    );

    for (const key of ["router_id", "network_id", "volume_id", "server_id"]) {
      const value: string | null = readSeriesLabel(labels, key);
      const found: string | undefined = value
        ? routerIds.get(value) ||
          networkIds.get(value) ||
          volumeIds.get(value) ||
          instanceIds.get(value)
        : undefined;
      if (found) {
        return found;
      }
    }

    const host: string | null =
      readSeriesLabel(labels, "hostname") ||
      readSeriesLabel(labels, "hypervisor_hostname");
    const service: string | null = readSeriesLabel(labels, "service");

    if (host && service && service !== "nova-compute") {
      const found: string | undefined = serviceIds.get(
        `${region || ""}/${service}/${getOpenStackShortHostName(host)}`,
      );
      if (found) {
        return found;
      }
    }

    if (host) {
      const found: string | undefined = hypervisorIds.get(
        hostKey(region, host),
      );
      if (found) {
        return found;
      }
    }

    const poolName: string | null = readSeriesLabel(labels, "name");
    if (poolName) {
      const found: string | undefined = poolIds.get(
        `${region || ""}/${poolName}`,
      );
      if (found) {
        return found;
      }
    }

    return region && regions.has(region) ? `region:${region}` : null;
  };

  return buildResourceTopologyGraph({
    rootId: OPENSTACK_ROOT_ID,
    nodes: nodes,
    relations: relations,
    issues: attachOpenIssues({
      records: input.issues || [],
      rootId: OPENSTACK_ROOT_ID,
      locate: locate,
    }),
    truncations: input.truncations,
  });
}

/*
 * What a map too large to reach them by itself opens on: the parts that have failed, the
 * hosts first because everything stands on them, each with one of what it holds so that
 * it opens. Few of them: this is what still reads at the zoom every map is held to, on a
 * laptop. Needs attention, one click away, narrows the map to all of the rest.
 */
export const OPENSTACK_TOPOLOGY_OPENS_ON: number = 2;

export function getOpenStackTopologyFocus(
  graph: ResourceTopologyGraph,
  limit: number = OPENSTACK_TOPOLOGY_OPENS_ON,
): Array<string> {
  const failed: Array<ResourceTopologyNode> = [];

  for (const part of graph.nodes.values()) {
    if (
      part.id !== graph.rootId &&
      !part.isSection &&
      part.effectiveHealth === "critical"
    ) {
      failed.push(part);
    }
  }

  const rank: (part: ResourceTopologyNode) => number = (
    part: ResourceTopologyNode,
  ): number => {
    return part.kind === "openstack.hypervisor" ? 0 : 1;
  };

  const reveal: Array<string> = [];

  for (const part of failed
    .sort((a: ResourceTopologyNode, b: ResourceTopologyNode): number => {
      return rank(a) - rank(b) || b.descendantCount - a.descendantCount;
    })
    .slice(0, limit)) {
    reveal.push(part.id);
    const child: string | undefined = part.childIds[0];
    if (child) {
      reveal.push(child);
    }
  }

  return reveal;
}

/*
 * What the page says this map cannot draw, because nothing says it. Only when it is
 * about something this cloud holds: a cloud with no instances lacks nothing.
 */
export const OPENSTACK_TOPOLOGY_GAP_NETWORKS: string = translationKey(
  "Instances are not joined to their networks: what this cloud reports does not say which network an instance is on.",
);
export const OPENSTACK_TOPOLOGY_GAP_NETWORKS_AND_POOLS: string = translationKey(
  "Instances are not joined to their networks, nor volumes to their storage pools: what this cloud reports says neither.",
);
export const OPENSTACK_TOPOLOGY_SUMMARIZED: string = translationKey(
  "This cloud has more than {{limit}} parts, more than a map can usefully draw, so it opens on what has failed and what that affects. Every hypervisor still says how many instances it holds.",
);

export function getOpenStackTopologyGap(
  rows: Array<OpenStackResource>,
): string | null {
  let hasInstance: boolean = false;
  let hasUnplacedVolume: boolean = false;
  let hasPool: boolean = false;

  for (const row of rows) {
    if (row.kind === OpenStackResourceKind.Instance) {
      hasInstance = true;
    } else if (row.kind === OpenStackResourceKind.StoragePool) {
      hasPool = true;
    } else if (
      row.kind === OpenStackResourceKind.Volume &&
      typeof factsOf(row)["pool"] !== "string"
    ) {
      hasUnplacedVolume = true;
    }
  }

  if (hasPool && hasUnplacedVolume) {
    return OPENSTACK_TOPOLOGY_GAP_NETWORKS_AND_POOLS;
  }

  return hasInstance ? OPENSTACK_TOPOLOGY_GAP_NETWORKS : null;
}
