import AIChatPageContextType, { AIChatPageContext } from "./AIChatPageContext";
import { AIResourceType } from "./AIResourceContext";
import { JSONObject } from "../JSON";

/*
 * WHAT ONEUPTIME AI LINKS AN INCIDENT OR ALERT TO.
 *
 * Issue #5293: on a host's page, Ask AI declared an incident ("high memory
 * usage") and the incident was linked to nothing. Its investigation never
 * reached the host, and auto-remediation said "This incident is not linked
 * to a Kubernetes cluster or an infrastructure resource, so OneUptime AI had
 * nothing it could fix", although the conversation was about that host from
 * its first word. create_incident took a title, a description and a
 * severity, and nothing else.
 *
 * The resources an incident or alert is linked to are what everything after
 * its creation reads: its investigation reaches them through their AI
 * agents, auto-remediation fixes them, their owners and labels pass on to
 * it, and their pages list it. So OneUptime AI links what it declares:
 *
 *   - declared from a resource's page (a host, a cluster, a database, a
 *     service, ...), the incident is linked to that resource, as Declare
 *     Incident on the resource's own Incidents tab links it
 *     (CreateFromRecord);
 *   - and to the resources the model names (affectedResources), found with
 *     the person's own reads - query_telemetry_resources, lookup_context.
 *
 * This module is the vocabulary both use: the kinds of resource that can be
 * linked, the incident's and the alert's list each one goes in (the two
 * models declare the same lists), how a tool argument names them, and the
 * resource a page is about. React-free and server-free, so the dashboard
 * and any test read the same rules.
 *
 * Monitors are deliberately not here. A monitor linked to an incident a
 * person declares stops its own checks until the incident is resolved
 * (IncidentService.disableActiveMonitoringIfManualIncident), so linking
 * one is the person's choice on the Declare Incident form, never a side
 * effect of a conversation.
 */

// The kinds of resource OneUptime AI may link an incident or alert to.
export enum AiAffectedResourceKind {
  Host = "Host",
  DockerHost = "DockerHost",
  PodmanHost = "PodmanHost",
  KubernetesCluster = "KubernetesCluster",
  DockerSwarmCluster = "DockerSwarmCluster",
  ProxmoxCluster = "ProxmoxCluster",
  VMwareVCenter = "VMwareVCenter",
  CephCluster = "CephCluster",
  StorageArray = "StorageArray",
  IoTFleet = "IoTFleet",
  DatabaseServer = "DatabaseServer",
  // A resource a cloud connection lists (an AWS, Azure or Google Cloud one).
  CloudResource = "CloudResource",
  // A telemetry service (lookup_context's services).
  Service = "Service",
}

// The list of an Incident (and of an Alert) a kind of resource goes in.
export type AiAffectedResourceRelation =
  | "hosts"
  | "dockerHosts"
  | "podmanHosts"
  | "kubernetesClusters"
  | "dockerSwarmClusters"
  | "proxmoxClusters"
  | "vmwareVCenters"
  | "cephClusters"
  | "storageArrays"
  | "iotFleets"
  | "databaseServers"
  | "cloudResources"
  | "services";

export interface AiAffectedResourceKindInfo {
  kind: AiAffectedResourceKind;
  relation: AiAffectedResourceRelation;
  // How one is named in a sentence: "host", "Kubernetes cluster".
  noun: string;
  /*
   * Whether auto-remediation can fix it: a Kubernetes cluster through its
   * Kubernetes AI agent, and the resources with an AI agent of their own
   * (Types/ResourceAiAgent/AiResourceType). The others are linked for what
   * the link gives everything else - the investigation's telemetry, the
   * owners, the resource's own Incidents tab - never fixed.
   */
  isFixedByOneUptimeAi: boolean;
}

/*
 * Every kind, in the order the incident's Affected Resources card lists
 * them (AffectedResourceNames), each with the list it goes in.
 */
export const AI_AFFECTED_RESOURCE_KINDS: ReadonlyArray<AiAffectedResourceKindInfo> =
  [
    {
      kind: AiAffectedResourceKind.Host,
      relation: "hosts",
      noun: "host",
      isFixedByOneUptimeAi: true,
    },
    {
      kind: AiAffectedResourceKind.KubernetesCluster,
      relation: "kubernetesClusters",
      noun: "Kubernetes cluster",
      isFixedByOneUptimeAi: true,
    },
    {
      kind: AiAffectedResourceKind.DockerHost,
      relation: "dockerHosts",
      noun: "Docker host",
      isFixedByOneUptimeAi: true,
    },
    {
      kind: AiAffectedResourceKind.PodmanHost,
      relation: "podmanHosts",
      noun: "Podman host",
      isFixedByOneUptimeAi: true,
    },
    {
      kind: AiAffectedResourceKind.ProxmoxCluster,
      relation: "proxmoxClusters",
      noun: "Proxmox cluster",
      isFixedByOneUptimeAi: true,
    },
    {
      kind: AiAffectedResourceKind.VMwareVCenter,
      relation: "vmwareVCenters",
      noun: "VMware vCenter",
      isFixedByOneUptimeAi: true,
    },
    {
      kind: AiAffectedResourceKind.CephCluster,
      relation: "cephClusters",
      noun: "Ceph cluster",
      isFixedByOneUptimeAi: true,
    },
    {
      kind: AiAffectedResourceKind.StorageArray,
      relation: "storageArrays",
      noun: "storage array",
      isFixedByOneUptimeAi: false,
    },
    {
      kind: AiAffectedResourceKind.DockerSwarmCluster,
      relation: "dockerSwarmClusters",
      noun: "Docker Swarm cluster",
      isFixedByOneUptimeAi: true,
    },
    {
      kind: AiAffectedResourceKind.IoTFleet,
      relation: "iotFleets",
      noun: "IoT fleet",
      isFixedByOneUptimeAi: false,
    },
    {
      kind: AiAffectedResourceKind.DatabaseServer,
      relation: "databaseServers",
      noun: "database server",
      isFixedByOneUptimeAi: true,
    },
    /*
     * Linked for its changes, its metrics and its page's Incidents tab: no
     * AI agent acts on a cloud account yet.
     */
    {
      kind: AiAffectedResourceKind.CloudResource,
      relation: "cloudResources",
      noun: "cloud resource",
      isFixedByOneUptimeAi: false,
    },
    {
      kind: AiAffectedResourceKind.Service,
      relation: "services",
      noun: "service",
      isFixedByOneUptimeAi: false,
    },
  ];

/*
 * The resource pages Ask AI opens on whose resource an incident or alert
 * cannot be linked to yet - it has no list of them - and so is never linked
 * from there. Each says why; the model is told the same, and
 * Tests/Types/AI/AiAffectedResources.test.ts holds every other page's
 * resource to a list of both models. A model that gains the list moves its
 * kind above.
 */
export const AI_RESOURCE_TYPES_NOT_LINKABLE: Readonly<
  Partial<Record<AIResourceType, string>>
> = {
  [AIResourceType.ServerlessFunction]:
    "An incident or alert has no list of serverless functions.",
  [AIResourceType.NetworkDevice]:
    "An incident or alert has no list of network devices.",
};

// The most resources one call links: the most an investigation reaches.
export const MAX_AI_AFFECTED_RESOURCES: number = 10;

// One resource a tool call names, or a page is about.
export interface AiAffectedResourceRef {
  kind: AiAffectedResourceKind;
  // A resource's OneUptime ID (a UUID), lower-cased.
  id: string;
}

const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getAiAffectedResourceKindInfo(
  kind: AiAffectedResourceKind,
): AiAffectedResourceKindInfo {
  const info: AiAffectedResourceKindInfo | undefined =
    AI_AFFECTED_RESOURCE_KINDS.find(
      (item: AiAffectedResourceKindInfo): boolean => {
        return item.kind === kind;
      },
    );

  if (!info) {
    throw new Error(`Unknown kind of affected resource: ${kind}`);
  }

  return info;
}

export function isAiAffectedResourceKind(
  value: unknown,
): value is AiAffectedResourceKind {
  return AI_AFFECTED_RESOURCE_KINDS.some(
    (item: AiAffectedResourceKindInfo): boolean => {
      return item.kind === value;
    },
  );
}

/*
 * A kind as a model may spell it - "host", "kubernetescluster",
 * "TelemetryService" - or undefined for anything else. Matched without
 * regard to case, spaces, "-" or "_", since the value comes from a model.
 */
export function readAiAffectedResourceKind(
  value: unknown,
): AiAffectedResourceKind | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  let spelled: string = "";

  for (const character of value) {
    if (character === " " || character === "-" || character === "_") {
      continue;
    }

    spelled += character.toLowerCase();
  }

  if (spelled === "telemetryservice") {
    return AiAffectedResourceKind.Service;
  }

  const info: AiAffectedResourceKindInfo | undefined =
    AI_AFFECTED_RESOURCE_KINDS.find(
      (item: AiAffectedResourceKindInfo): boolean => {
        return item.kind.toLowerCase() === spelled;
      },
    );

  return info?.kind;
}

/*
 * The resource of the page Ask AI was asked from, when an incident or alert
 * can be linked to it: a resource's page (or one of its child pages - a
 * pod's page is about its cluster) or a telemetry service's page. Null for
 * every other page, and for a resource whose kind cannot be linked.
 */
export function getPageAffectedResource(
  pageContext: AIChatPageContext | null | undefined,
): AiAffectedResourceRef | null {
  if (!pageContext?.entityId || !UUID_PATTERN.test(pageContext.entityId)) {
    return null;
  }

  const id: string = pageContext.entityId.toLowerCase();

  if (pageContext.type === AIChatPageContextType.TelemetryService) {
    return { kind: AiAffectedResourceKind.Service, id };
  }

  if (
    pageContext.type === AIChatPageContextType.Resource &&
    isAiAffectedResourceKind(pageContext.resourceType)
  ) {
    return {
      kind: pageContext.resourceType as unknown as AiAffectedResourceKind,
      id,
    };
  }

  return null;
}

// What a tool's affectedResources argument named, and what it could not read.
export interface AiAffectedResourceArgument {
  refs: Array<AiAffectedResourceRef>;
  // Each entry left out, and why, in words the model can act on.
  problems: Array<string>;
}

/*
 * A tool's affectedResources argument: a list of { resourceType,
 * resourceId }. Undefined when the call left the argument out - the tool
 * then decides (create_incident links the page's resource) - and a list,
 * possibly empty, when it named one: an empty list links nothing. Entries
 * that name no kind, or no UUID, are left out with a problem each;
 * repeated entries are kept once; past MAX_AI_AFFECTED_RESOURCES the rest
 * are left out, and the problem says how many.
 */
export function readAiAffectedResourceArgument(
  value: unknown,
): AiAffectedResourceArgument | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    return {
      refs: [],
      problems: [
        "affectedResources must be a list of { resourceType, resourceId }.",
      ],
    };
  }

  const refs: Array<AiAffectedResourceRef> = [];
  const problems: Array<string> = [];
  const seen: Set<string> = new Set<string>();
  let leftOverCap: number = 0;

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      problems.push(
        "An entry of affectedResources is not a { resourceType, resourceId } object.",
      );
      continue;
    }

    const entry: JSONObject = item as JSONObject;
    const kind: AiAffectedResourceKind | undefined = readAiAffectedResourceKind(
      entry["resourceType"],
    );
    const rawId: unknown = entry["resourceId"];
    const id: string = typeof rawId === "string" ? rawId.trim() : "";

    if (!kind) {
      problems.push(
        `resourceType ${JSON.stringify(entry["resourceType"] ?? null).substring(0, 60)} cannot be linked. Use one of: ${AI_AFFECTED_RESOURCE_KINDS.map(
          (info: AiAffectedResourceKindInfo): string => {
            return info.kind;
          },
        ).join(", ")}.`,
      );
      continue;
    }

    if (!UUID_PATTERN.test(id)) {
      problems.push(
        `resourceId of a ${getAiAffectedResourceKindInfo(kind).noun} must be its OneUptime ID (a UUID).`,
      );
      continue;
    }

    const key: string = `${kind}:${id.toLowerCase()}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    if (refs.length >= MAX_AI_AFFECTED_RESOURCES) {
      leftOverCap++;
      continue;
    }

    refs.push({ kind, id: id.toLowerCase() });
  }

  if (leftOverCap > 0) {
    problems.push(
      `Only ${MAX_AI_AFFECTED_RESOURCES} resources are linked at once; ${leftOverCap} more were left out.`,
    );
  }

  return { refs, problems };
}
