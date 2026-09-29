import Alert from "../../Models/DatabaseModels/Alert";
import Incident from "../../Models/DatabaseModels/Incident";
import Monitor from "../../Models/DatabaseModels/Monitor";
import ResourceAiAgent from "../../Models/DatabaseModels/ResourceAiAgent";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  ALL_AI_RESOURCE_TYPES,
  AiResourceTypeInfo,
  isAiResourceType,
} from "../../Types/ResourceAiAgent/AiResourceType";
import {
  RESOURCE_AI_AGENT_IMAGE_REPOSITORY,
  RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV,
  RESOURCE_AI_ALLOW_WRITES_ENV,
  RESOURCE_AI_WRITE_TARGETS_ENV,
  ResourceAiAccessGap,
  ResourceAiAccessStatus,
  ResourceAiAgentPosture,
  ResourceAiAgentSummary,
  ResourceAiRemediationMode,
  parseResourceAiRemediationMode,
} from "../../Types/ResourceAiAgent/ResourceAiAccess";
import ModelPermission from "../Types/Database/Permissions/Index";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import MonitorResourceContextUtil from "../Utils/Monitor/MonitorResourceContext";
import { SeriesResolvedResourceIds } from "../Utils/Monitor/SeriesResourceLinker";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import AlertService from "./AlertService";
import CephClusterService from "./CephClusterService";
import DatabaseServerService from "./DatabaseServerService";
import DatabaseService from "./DatabaseService";
import DockerHostService from "./DockerHostService";
import DockerSwarmClusterService from "./DockerSwarmClusterService";
import HostService from "./HostService";
import IncidentService from "./IncidentService";
import KubernetesClusterAiAccessService, {
  AI_BALANCE_INSUFFICIENT_NEXT_STEP,
  KubernetesClusterAiAccessProjectGates,
} from "./KubernetesClusterAiAccessService";
import MonitorService from "./MonitorService";
import PodmanHostService from "./PodmanHostService";
import ProxmoxClusterService from "./ProxmoxClusterService";
import ResourceAiAgentService from "./ResourceAiAgentService";
import VMwareVCenterService from "./VMwareVCenterService";

/*
 * OneUptime AI access to an infrastructure resource — a Docker or Podman
 * host, a Docker Swarm, Proxmox, VMware or Ceph cluster, a database server
 * or a host — through that resource's AI agent (a ResourceAiAgent row).
 *
 * The resource-agnostic sibling of KubernetesClusterAiAccessService, and
 * shaped like it: it answers, from CURRENT configuration, whether AI can
 * run commands on a resource and what it may do there, and turns every
 * reason it cannot into a row of a checklist with a next step. The same
 * status feeds the AI runs (which only ever act on a resource this module
 * calls ready), the investigation's prompt, and the resource's AI agent
 * page.
 *
 * A resource is reached through exactly ONE target: its own resource AI
 * agent. There are no Runners and no credentials here — the agent holds the
 * resource's credentials itself and never receives one from OneUptime.
 *
 * The project-wide gates (AI on, a provider, a balance, auto-remediation)
 * are the Kubernetes service's, read once per call and shared, so a project
 * setting reads the same for a cluster and for every other resource.
 */

export type ResourceAiAccessProjectGates =
  KubernetesClusterAiAccessProjectGates;

// One resource a subject (an incident or an alert) is linked to.
export interface ResourceAiAccessRef {
  resourceType: AiResourceType;
  resourceId: string;
}

/*
 * A resource row as the status computation reads it, whichever table it
 * came from. Built by loadResource / loadResources, never by callers.
 */
export interface ResourceAiAccessRow {
  resourceType: AiResourceType;
  id: ObjectID;
  projectId: ObjectID;
  // The name the dashboard shows (the row's name, else its identifier).
  name: string;
  /*
   * The identity the resource's collector reports and its agent registers
   * with (hostIdentifier, the cluster/vCenter name, the database endpoint).
   */
  identifier?: string | undefined;
  isAiInvestigationEnabled: boolean;
  aiRemediationMode: ResourceAiRemediationMode;
  aiCommandAllowlist: Array<string>;
  aiAccessConfiguredAt?: Date | undefined;
  aiAccessLastVerifiedAt?: Date | undefined;
  aiAccessLastError?: string | undefined;
  isArchived: boolean;
}

/*
 * The resource and the agent a command for it would go to right now: the
 * resource's ONLINE agent (ResourceAiAgentService.findOnlineAgentForResource),
 * or null when it has none. resource is null when the resource does not
 * exist in the project.
 */
export interface LoadedResourceAiAccessTarget {
  resource: ResourceAiAccessRow | null;
  agent: ResourceAiAgent | null;
}

// The most resources one incident or alert offers an investigation.
export const MAX_RESOURCES_PER_SUBJECT: number = 10;

/*
 * How many of a subject's linked resources are read per query while
 * looking for its unarchived ones (getResourcesForSubject): one read covers
 * any ordinary subject, and a subject linked to many archived resources is
 * read on in batches until the cap is reached.
 */
const SUBJECT_RESOURCE_READ_BATCH_SIZE: number = MAX_RESOURCES_PER_SUBJECT * 5;

// The columns every resource model carries for AI access.
const AI_ACCESS_COLUMNS: Record<string, boolean> = {
  _id: true,
  projectId: true,
  name: true,
  isArchived: true,
  isAiInvestigationEnabled: true,
  aiRemediationMode: true,
  aiCommandAllowlist: true,
  aiAccessConfiguredAt: true,
  aiAccessLastVerifiedAt: true,
  aiAccessLastError: true,
};

type SubjectRelation =
  | "dockerHosts"
  | "podmanHosts"
  | "dockerSwarmClusters"
  | "proxmoxClusters"
  | "vmwareVCenters"
  | "cephClusters"
  | "databaseServers"
  | "hosts";

/*
 * How each resource type is read: its table's service, the extra columns
 * its identity lives in, the Incident/Alert relation that links it to a
 * subject, and the list the monitor-step fallback fills for it.
 */
interface ResourceAiAccessModelSpec {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: DatabaseService<any>;
  identityColumns: Record<string, boolean>;
  subjectRelation: SubjectRelation;
  resolvedIdsKey: keyof SeriesResolvedResourceIds;
}

const MODEL_SPECS: Readonly<Record<AiResourceType, ResourceAiAccessModelSpec>> =
  {
    [AiResourceType.DockerHost]: {
      service: DockerHostService,
      identityColumns: { hostIdentifier: true },
      subjectRelation: "dockerHosts",
      resolvedIdsKey: "dockerHostIds",
    },
    [AiResourceType.PodmanHost]: {
      service: PodmanHostService,
      identityColumns: { hostIdentifier: true },
      subjectRelation: "podmanHosts",
      resolvedIdsKey: "podmanHostIds",
    },
    [AiResourceType.DockerSwarmCluster]: {
      service: DockerSwarmClusterService,
      identityColumns: {},
      subjectRelation: "dockerSwarmClusters",
      resolvedIdsKey: "dockerSwarmClusterIds",
    },
    [AiResourceType.ProxmoxCluster]: {
      service: ProxmoxClusterService,
      identityColumns: {},
      subjectRelation: "proxmoxClusters",
      resolvedIdsKey: "proxmoxClusterIds",
    },
    [AiResourceType.VMwareVCenter]: {
      service: VMwareVCenterService,
      identityColumns: {},
      subjectRelation: "vmwareVCenters",
      resolvedIdsKey: "vmwareVCenterIds",
    },
    [AiResourceType.CephCluster]: {
      service: CephClusterService,
      identityColumns: {},
      subjectRelation: "cephClusters",
      resolvedIdsKey: "cephClusterIds",
    },
    [AiResourceType.DatabaseServer]: {
      service: DatabaseServerService,
      identityColumns: {
        dbSystem: true,
        serverAddress: true,
        serverPort: true,
      },
      subjectRelation: "databaseServers",
      resolvedIdsKey: "databaseServerIds",
    },
    [AiResourceType.Host]: {
      service: HostService,
      identityColumns: { hostIdentifier: true },
      subjectRelation: "hosts",
      resolvedIdsKey: "hostIds",
    },
  };

/*
 * What an operator checks when the agent is online but cannot reach its
 * resource: the one thing each agent needs besides the network.
 */
const REACH_HINTS: Readonly<Record<AiResourceType, string>> = {
  [AiResourceType.DockerHost]:
    "that the Docker socket (/var/run/docker.sock) is mounted into the agent's container",
  [AiResourceType.PodmanHost]:
    "that the Podman socket (/run/podman/podman.sock) is mounted into the agent's container",
  [AiResourceType.DockerSwarmCluster]:
    "that the agent runs on a swarm MANAGER node with the Docker socket mounted",
  [AiResourceType.ProxmoxCluster]: "PVE_HOST and the agent's Proxmox API token",
  [AiResourceType.VMwareVCenter]:
    "the vCenter URL and the credentials in the agent's environment",
  [AiResourceType.CephCluster]:
    "the Ceph config and keyring mounted into the agent's container",
  [AiResourceType.DatabaseServer]:
    "the database address and the read-only credentials in the agent's environment",
  [AiResourceType.Host]:
    "that the agent runs privileged with the host's PID namespace (pid: host)",
};

// "Docker host", but "host" and "database server" for the generic nouns.
export function describeResourceNoun(resourceType: AiResourceType): string {
  if (resourceType === AiResourceType.Host) {
    return "host";
  }

  if (resourceType === AiResourceType.DatabaseServer) {
    return "database server";
  }

  return isAiResourceType(resourceType)
    ? AI_RESOURCE_TYPE_INFO[resourceType].displayName
    : "resource";
}

/*
 * Where every next step sends an operator: the resource's AI agent page
 * (AI → AI agent in its side menu). Shown verbatim in the investigation's
 * report and panel, so it always names the page.
 */
export function getResourceAiAgentPage(resourceType: AiResourceType): string {
  return `the ${describeResourceNoun(resourceType)}'s AI agent page (AI → AI agent)`;
}

/*
 * How to install the resource's agent, as one sentence: the image, the
 * type, and the identity to register with — spelled with this resource's
 * own identity when it is known, so the agent lands on THIS row.
 */
export function getResourceAiAgentInstallNextStep(data: {
  resourceType: AiResourceType;
  resourceId?: string | undefined;
  identifier?: string | undefined;
}): string {
  const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[data.resourceType];
  const noun: string = describeResourceNoun(data.resourceType);
  let identity: string;

  if (data.resourceType === AiResourceType.DatabaseServer) {
    identity = data.resourceId
      ? ` and DATABASE_SERVER_ID=${data.resourceId}`
      : " and DATABASE_SERVER_ID set to this database server's id";
  } else {
    const variable: string = info.identityEnvVars[0] || "the identity";
    identity = data.identifier
      ? ` and ${variable}=${data.identifier}`
      : ` and ${variable} set to the name its collector reports`;
  }

  return `Install the ${info.agentDisplayName} next to this ${noun}'s telemetry collector: run the ${RESOURCE_AI_AGENT_IMAGE_REPOSITORY} image with ${RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV}=${info.agentAlias}${identity}. The complete snippet is on ${getResourceAiAgentPage(
    data.resourceType,
  )}.`;
}

type DateLike = Date | string | null | undefined;

function toDate(value: DateLike): Date | null {
  if (!value) {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoString(value: DateLike): string | undefined {
  const date: Date | null = toDate(value);

  return date ? OneUptimeDate.toString(date) : undefined;
}

/*
 * The allowlist column is jsonb; a client may save it as an array or as a
 * JSON string. Anything unusable normalizes to empty — nothing risky
 * auto-executes.
 */
export function normalizeResourceAllowlist(value: unknown): Array<string> {
  let raw: unknown = value;

  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [value];
    }
  }

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((pattern: unknown): pattern is string => {
      return typeof pattern === "string" && pattern.trim().length > 0;
    })
    .map((pattern: string): string => {
      return pattern.trim();
    });
}

function refKey(resourceType: string, resourceId: string): string {
  return `${resourceType}:${resourceId.toLowerCase()}`;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export class ResourceAiAccessServiceClass {
  /*
   * ------------------------------------------------------------------
   * Readiness
   * ------------------------------------------------------------------
   */

  // The project-wide gates, read exactly as they are for clusters.
  @CaptureSpan()
  public async getProjectGates(
    projectId: ObjectID,
  ): Promise<ResourceAiAccessProjectGates> {
    return await KubernetesClusterAiAccessService.getProjectGates(projectId);
  }

  @CaptureSpan()
  public async getStatusForResource(data: {
    projectId: ObjectID;
    resourceType: AiResourceType;
    resourceId: ObjectID;
    gates?: ResourceAiAccessProjectGates | undefined;
  }): Promise<ResourceAiAccessStatus | null> {
    const statuses: Array<ResourceAiAccessStatus> =
      await this.getStatusesForResources({
        projectId: data.projectId,
        resources: [
          {
            resourceType: data.resourceType,
            resourceId: data.resourceId.toString(),
          },
        ],
        gates: data.gates,
      });

    return statuses[0] || null;
  }

  /*
   * The status of several resources of one project, in the order asked
   * for, with every resource's agent row read in ONE query. A resource
   * that does not exist in the project (or, with excludeArchived, is
   * archived) has no status. When the agent read fails every status reads
   * as having no agent, which can only make it say less is reachable.
   */
  @CaptureSpan()
  public async getStatusesForResources(data: {
    projectId: ObjectID;
    resources: Array<ResourceAiAccessRef>;
    gates?: ResourceAiAccessProjectGates | undefined;
    excludeArchived?: boolean | undefined;
  }): Promise<Array<ResourceAiAccessStatus>> {
    const rows: Array<ResourceAiAccessRow> = await this.loadResources({
      projectId: data.projectId,
      resources: data.resources,
      excludeArchived: data.excludeArchived,
    });

    if (rows.length === 0) {
      return [];
    }

    const gates: ResourceAiAccessProjectGates =
      data.gates || (await this.getProjectGates(data.projectId));

    let agentRows: Map<string, ResourceAiAgent> = new Map<
      string,
      ResourceAiAgent
    >();

    try {
      agentRows = await this.findAgentRows({
        projectId: data.projectId,
        resources: rows,
      });
    } catch (error) {
      logger.error(
        `ResourceAiAccess: could not read the resource AI agents of project ${data.projectId.toString()}; every resource reads as having none: ${error}`,
      );
    }

    return rows.map((row: ResourceAiAccessRow): ResourceAiAccessStatus => {
      return this.buildStatus({
        resource: row,
        agentRow:
          agentRows.get(refKey(row.resourceType, row.id.toString())) || null,
        gates,
      });
    });
  }

  /*
   * The readiness computation proper, for one resource row, its agent row
   * (online or not; null when none ever registered) and the project gates.
   * Pure: every read was done by the caller.
   */
  public buildStatus(data: {
    resource: ResourceAiAccessRow;
    agentRow: ResourceAiAgent | null;
    gates: ResourceAiAccessProjectGates;
    now?: Date | undefined;
  }): ResourceAiAccessStatus {
    const { resource, agentRow, gates } = data;
    const type: AiResourceType = resource.resourceType;
    const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[type];
    const noun: string = describeResourceNoun(type);
    const page: string = getResourceAiAgentPage(type);
    const gaps: Array<ResourceAiAccessGap> = [];

    /*
     * The agent as ResourceAiAgentService sees it: one online rule for the
     * status and for the chokepoint (findOnlineAgentForResource).
     */
    const agent: ResourceAiAgentSummary | null = agentRow
      ? ResourceAiAgentService.getAgentSummary(agentRow, data.now)
      : null;
    const posture: ResourceAiAgentPosture | null = agent?.posture || null;
    const remediationMode: ResourceAiRemediationMode =
      resource.aiRemediationMode;

    if (!agent) {
      gaps.push({
        code: "ai_agent_not_connected",
        title: `No ${info.agentDisplayName} is connected`,
        nextStep: getResourceAiAgentInstallNextStep({
          resourceType: type,
          resourceId: resource.id.toString(),
          identifier: resource.identifier,
        }),
        blocksInvestigation: true,
        blocksRemediation: true,
      });
    } else if (!agent.isOnline) {
      const lastAliveAt: Date | null = toDate(agentRow?.lastAliveAt);
      const lastAliveText: string = lastAliveAt
        ? OneUptimeDate.getDateAsFormattedString(lastAliveAt)
        : "an unknown time";

      gaps.push({
        code: "ai_agent_offline",
        title: `The ${info.agentDisplayName} is offline`,
        nextStep: `It last reported in at ${lastAliveText}${
          agent.connectionStatus === "disconnected"
            ? " and then signed off (it was stopped, restarted or reset)"
            : ""
        }. Check that its container is running and can reach your OneUptime URL (its logs say why it cannot).`,
        blocksInvestigation: true,
        blocksRemediation: true,
      });
    } else if (!posture || posture.resourceType !== type) {
      /*
       * The agent always reports a posture for the type it serves; one
       * that is missing, unreadable or for another type is not trusted
       * with commands (the enqueue chokepoint refuses the same case).
       */
      gaps.push({
        code: "ai_agent_unreachable_resource",
        title: `The ${info.agentDisplayName} has not reported that it can reach this ${noun}`,
        nextStep: `Wait for its next report (within a minute), or reset the agent on ${page}.`,
        blocksInvestigation: true,
        blocksRemediation: true,
      });
    } else if (posture.reachable !== true) {
      gaps.push({
        code: "ai_agent_unreachable_resource",
        title: `The ${info.agentDisplayName} cannot reach this ${noun}`,
        nextStep: `Its last check failed${
          posture.reachError ? `: ${posture.reachError}` : ""
        }. Check ${REACH_HINTS[type]}, then use "Test connection" on ${page}.`,
        blocksInvestigation: true,
        blocksRemediation: true,
      });
    }

    if (!resource.isAiInvestigationEnabled) {
      gaps.push({
        code: "investigation_disabled",
        title: `AI investigation is turned off for this ${noun}`,
        nextStep: `Turn on AI investigation on ${page}.`,
        blocksInvestigation: true,
        blocksRemediation: false,
      });
    }

    if (remediationMode === ResourceAiRemediationMode.Disabled) {
      gaps.push({
        code: "remediation_disabled",
        title: `AI fixes are turned off for this ${noun}`,
        nextStep: `Set "Fixes" to "Ask for approval", "Automatic" or "Bypass approval" on ${page}.`,
        blocksInvestigation: false,
        blocksRemediation: true,
      });
    } else if (agent && posture?.allowWrites !== true) {
      gaps.push({
        code: "remediation_write_access_missing",
        title: `The ${info.agentDisplayName} is read-only`,
        nextStep: `Set ${RESOURCE_AI_ALLOW_WRITES_ENV}=true on the ${info.agentDisplayName} and restart it (${RESOURCE_AI_WRITE_TARGETS_ENV} limits what it may change).`,
        blocksInvestigation: false,
        blocksRemediation: true,
      });
    }

    if (!gates.isAiEnabled) {
      gaps.push({
        code: "ai_disabled_for_project",
        title: "AI is disabled for this project",
        nextStep: "Enable AI under Project Settings → AI Features.",
        blocksInvestigation: true,
        blocksRemediation: true,
      });
    }

    if (!gates.hasLlmProvider) {
      gaps.push({
        code: "llm_provider_missing",
        title: "No AI provider is configured",
        nextStep:
          "Add a provider under Project Settings → AI → LLM Providers (or use OneUptime AI credits).",
        blocksInvestigation: true,
        blocksRemediation: true,
      });
    }

    if (gates.aiBalanceBlocker) {
      gaps.push({
        code: "ai_balance_insufficient",
        title: "The project is out of AI credits",
        nextStep: AI_BALANCE_INSUFFICIENT_NEXT_STEP,
        blocksInvestigation: true,
        blocksRemediation: true,
      });
    }

    if (!gates.isAutoRemediationEnabled) {
      gaps.push({
        code: "auto_remediation_disabled_for_project",
        title: "Auto-remediation is disabled for this project",
        nextStep:
          "Enable auto-remediation under Project Settings → AI Features.",
        blocksInvestigation: false,
        blocksRemediation: true,
      });
    }

    const blocksInvestigation: boolean = gaps.some(
      (gap: ResourceAiAccessGap): boolean => {
        return gap.blocksInvestigation;
      },
    );
    const blocksRemediation: boolean = gaps.some(
      (gap: ResourceAiAccessGap): boolean => {
        return gap.blocksRemediation;
      },
    );

    return {
      resourceType: type,
      resourceId: resource.id.toString(),
      resourceName: resource.name,
      isAiInvestigationEnabled: resource.isAiInvestigationEnabled,
      aiRemediationMode: remediationMode,
      aiCommandAllowlist: resource.aiCommandAllowlist,
      aiAccessConfiguredAt: toIsoString(resource.aiAccessConfiguredAt) || null,
      aiAccessLastVerifiedAt:
        toIsoString(resource.aiAccessLastVerifiedAt) || null,
      aiAccessLastError: resource.aiAccessLastError || null,
      agent,
      gaps,
      isInvestigationReady:
        resource.isAiInvestigationEnabled && !blocksInvestigation,
      isRemediationReady:
        remediationMode !== ResourceAiRemediationMode.Disabled &&
        !blocksRemediation,
    };
  }

  /*
   * ------------------------------------------------------------------
   * Rows
   * ------------------------------------------------------------------
   */

  /*
   * One resource of the project (as root: the caller scopes by project),
   * or null when it is not the project's. Lookup failures propagate: the
   * enqueue chokepoint must fail closed on a resource it could not read.
   */
  @CaptureSpan()
  public async loadResource(data: {
    projectId: ObjectID;
    resourceType: AiResourceType;
    resourceId: ObjectID;
  }): Promise<ResourceAiAccessRow | null> {
    if (!isAiResourceType(data.resourceType)) {
      return null;
    }

    const rows: Array<ResourceAiAccessRow> = await this.loadResources({
      projectId: data.projectId,
      resources: [
        {
          resourceType: data.resourceType,
          resourceId: data.resourceId.toString(),
        },
      ],
    });

    return rows[0] || null;
  }

  /*
   * Several resources of one project, one query per resource type, in the
   * order asked for (duplicates and unknown types dropped).
   */
  @CaptureSpan()
  public async loadResources(data: {
    projectId: ObjectID;
    resources: Array<ResourceAiAccessRef>;
    excludeArchived?: boolean | undefined;
  }): Promise<Array<ResourceAiAccessRow>> {
    const wanted: Array<ResourceAiAccessRef> = [];
    const seen: Set<string> = new Set<string>();

    for (const ref of data.resources) {
      if (
        !ref ||
        !isAiResourceType(ref.resourceType) ||
        typeof ref.resourceId !== "string" ||
        !ObjectID.isValidUUID(ref.resourceId)
      ) {
        continue;
      }

      const key: string = refKey(ref.resourceType, ref.resourceId);

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      wanted.push(ref);
    }

    const byKey: Map<string, ResourceAiAccessRow> = new Map<
      string,
      ResourceAiAccessRow
    >();

    for (const type of ALL_AI_RESOURCE_TYPES) {
      const ids: Array<string> = wanted
        .filter((ref: ResourceAiAccessRef): boolean => {
          return ref.resourceType === type;
        })
        .map((ref: ResourceAiAccessRef): string => {
          return ref.resourceId;
        });

      if (ids.length === 0) {
        continue;
      }

      const spec: ResourceAiAccessModelSpec = MODEL_SPECS[type];

      const models: Array<Record<string, unknown>> = (await spec.service.findBy(
        {
          query: {
            projectId: data.projectId,
            _id: QueryHelper.any(
              ids.map((id: string): ObjectID => {
                return new ObjectID(id);
              }),
            ),
            ...(data.excludeArchived ? { isArchived: false } : {}),
          },
          select: { ...AI_ACCESS_COLUMNS, ...spec.identityColumns },
          limit: ids.length,
          skip: 0,
          props: { isRoot: true },
        },
      )) as unknown as Array<Record<string, unknown>>;

      for (const model of models) {
        const row: ResourceAiAccessRow | null = this.toRow(type, model, data);

        if (row) {
          byKey.set(refKey(type, row.id.toString()), row);
        }
      }
    }

    const rows: Array<ResourceAiAccessRow> = [];

    for (const ref of wanted) {
      const row: ResourceAiAccessRow | undefined = byKey.get(
        refKey(ref.resourceType, ref.resourceId),
      );

      if (row) {
        rows.push(row);
      }
    }

    return rows;
  }

  // A resource model read through its service, as the status reads it.
  public toRow(
    resourceType: AiResourceType,
    model: Record<string, unknown>,
    scope: { projectId: ObjectID; excludeArchived?: boolean | undefined },
  ): ResourceAiAccessRow | null {
    const idValue: unknown = model["_id"] || model["id"];
    const id: string | undefined =
      idValue instanceof ObjectID
        ? idValue.toString()
        : readString(idValue as string);

    if (!id || !ObjectID.isValidUUID(id)) {
      return null;
    }

    const projectIdValue: unknown = model["projectId"];
    const projectId: string | undefined =
      projectIdValue instanceof ObjectID
        ? projectIdValue.toString()
        : readString(projectIdValue as string);

    // The query was project-scoped; a row that says otherwise is not used.
    if (projectId && projectId !== scope.projectId.toString()) {
      return null;
    }

    const isArchived: boolean = model["isArchived"] === true;

    if (scope.excludeArchived && isArchived) {
      return null;
    }

    const identifier: string | undefined = this.readIdentifier(
      resourceType,
      model,
    );

    return {
      resourceType,
      id: new ObjectID(id),
      projectId: scope.projectId,
      name:
        readString(model["name"]) ||
        identifier ||
        AI_RESOURCE_TYPE_INFO[resourceType].displayName,
      identifier,
      isAiInvestigationEnabled: model["isAiInvestigationEnabled"] === true,
      aiRemediationMode: parseResourceAiRemediationMode(
        model["aiRemediationMode"],
      ),
      aiCommandAllowlist: normalizeResourceAllowlist(
        model["aiCommandAllowlist"],
      ),
      aiAccessConfiguredAt:
        toDate(model["aiAccessConfiguredAt"] as DateLike) || undefined,
      aiAccessLastVerifiedAt:
        toDate(model["aiAccessLastVerifiedAt"] as DateLike) || undefined,
      aiAccessLastError: readString(model["aiAccessLastError"]),
      isArchived,
    };
  }

  /*
   * The identity the resource's collector reports: hostIdentifier for
   * hosts, the name for clusters and vCenters, and system|host:port for a
   * database server.
   */
  private readIdentifier(
    resourceType: AiResourceType,
    model: Record<string, unknown>,
  ): string | undefined {
    if (
      resourceType === AiResourceType.DockerHost ||
      resourceType === AiResourceType.PodmanHost ||
      resourceType === AiResourceType.Host
    ) {
      return readString(model["hostIdentifier"]);
    }

    if (resourceType === AiResourceType.DatabaseServer) {
      const address: string | undefined = readString(model["serverAddress"]);

      if (!address) {
        return undefined;
      }

      const port: unknown = model["serverPort"];
      const system: string | undefined = readString(model["dbSystem"]);

      return `${system ? `${system}|` : ""}${address}${
        typeof port === "number" && Number.isFinite(port) ? `:${port}` : ""
      }`;
    }

    return readString(model["name"]);
  }

  /*
   * The agent rows of these resources (online or not), keyed by
   * type:resourceId — one query per resource type present
   * (ResourceAiAgentService.findAgentsForResources). Never reads the key
   * hash.
   */
  @CaptureSpan()
  public async findAgentRows(data: {
    projectId: ObjectID;
    resources: Array<Pick<ResourceAiAccessRow, "resourceType" | "id">>;
  }): Promise<Map<string, ResourceAiAgent>> {
    const byKey: Map<string, ResourceAiAgent> = new Map<
      string,
      ResourceAiAgent
    >();

    for (const type of ALL_AI_RESOURCE_TYPES) {
      const ids: Array<ObjectID> = data.resources
        .filter(
          (
            resource: Pick<ResourceAiAccessRow, "resourceType" | "id">,
          ): boolean => {
            return resource.resourceType === type;
          },
        )
        .map(
          (
            resource: Pick<ResourceAiAccessRow, "resourceType" | "id">,
          ): ObjectID => {
            return resource.id;
          },
        );

      if (ids.length === 0) {
        continue;
      }

      const rows: Map<string, ResourceAiAgent> =
        await ResourceAiAgentService.findAgentsForResources({
          projectId: data.projectId,
          resourceType: type,
          resourceIds: ids,
        });

      for (const [resourceId, row] of rows) {
        byKey.set(refKey(type, resourceId), row);
      }
    }

    return byKey;
  }

  /*
   * ------------------------------------------------------------------
   * The access target
   * ------------------------------------------------------------------
   */

  /*
   * The resource and the agent a command for it goes to NOW: its online
   * agent, or null. Lookup failures propagate: the enqueue chokepoint must
   * fail closed on a target it could not check.
   */
  @CaptureSpan()
  public async loadAccessTarget(data: {
    projectId: ObjectID;
    resourceType: AiResourceType;
    resourceId: ObjectID;
  }): Promise<LoadedResourceAiAccessTarget> {
    const resource: ResourceAiAccessRow | null = await this.loadResource(data);

    if (!resource) {
      return { resource: null, agent: null };
    }

    const agent: ResourceAiAgent | null =
      await ResourceAiAgentService.findOnlineAgentForResource({
        projectId: data.projectId,
        resourceType: resource.resourceType,
        resourceId: resource.id,
      });

    return { resource, agent: agent || null };
  }

  /*
   * ------------------------------------------------------------------
   * Subjects
   * ------------------------------------------------------------------
   */

  /*
   * The unarchived resources of the project an incident or alert is linked
   * to, in the order ALL_AI_RESOURCE_TYPES lists the types, at most
   * MAX_RESOURCES_PER_SUBJECT. Linked means the subject's resource
   * relations (written when it was created, from its series labels and its
   * monitors' configuration); when none of those is an unarchived resource
   * of the project, the subject's monitors' step configuration is resolved
   * again now (the resource may have appeared after the subject was
   * created, or replaced an archived one), matching names
   * case-insensitively like the linker does.
   *
   * Archived and missing resources are dropped BEFORE the cap: capping
   * first would let ten archived links hide an active one behind them.
   */
  @CaptureSpan()
  public async getResourcesForSubject(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): Promise<Array<ResourceAiAccessRef>> {
    const linked: Map<AiResourceType, Array<string>> = new Map<
      AiResourceType,
      Array<string>
    >();
    const monitorIds: Array<ObjectID> = [];

    if (data.alertId || data.incidentId) {
      const relations: Array<{
        type: AiResourceType;
        ids: Array<string>;
      }> = await Promise.all(
        ALL_AI_RESOURCE_TYPES.map(
          async (
            type: AiResourceType,
          ): Promise<{ type: AiResourceType; ids: Array<string> }> => {
            return {
              type,
              ids: await this.readSubjectRelation({
                projectId: data.projectId,
                incidentId: data.incidentId,
                alertId: data.alertId,
                relation: MODEL_SPECS[type].subjectRelation,
              }),
            };
          },
        ),
      );

      for (const relation of relations) {
        linked.set(relation.type, relation.ids);
      }

      monitorIds.push(
        ...(await this.readSubjectMonitorIds({
          projectId: data.projectId,
          incidentId: data.incidentId,
          alertId: data.alertId,
        })),
      );
    }

    let refs: Array<ResourceAiAccessRef> = await this.keepUnarchivedRefs({
      projectId: data.projectId,
      refs: this.flattenRefs(linked),
    });

    if (refs.length === 0 && monitorIds.length > 0) {
      refs = await this.keepUnarchivedRefs({
        projectId: data.projectId,
        refs: this.flattenRefs(
          await this.resolveMonitorResources({
            projectId: data.projectId,
            monitorIds,
          }),
        ),
      });
    }

    return refs;
  }

  /*
   * The first MAX_RESOURCES_PER_SUBJECT of these refs (in their order) that
   * are unarchived resources of the project, read in batches so a long
   * list of archived links costs a few reads, not one per link.
   */
  private async keepUnarchivedRefs(data: {
    projectId: ObjectID;
    refs: Array<ResourceAiAccessRef>;
  }): Promise<Array<ResourceAiAccessRef>> {
    const kept: Array<ResourceAiAccessRef> = [];

    for (
      let start: number = 0;
      start < data.refs.length && kept.length < MAX_RESOURCES_PER_SUBJECT;
      start += SUBJECT_RESOURCE_READ_BATCH_SIZE
    ) {
      const rows: Array<ResourceAiAccessRow> = await this.loadResources({
        projectId: data.projectId,
        resources: data.refs.slice(
          start,
          start + SUBJECT_RESOURCE_READ_BATCH_SIZE,
        ),
        excludeArchived: true,
      });

      for (const row of rows) {
        kept.push({
          resourceType: row.resourceType,
          resourceId: row.id.toString(),
        });
      }
    }

    return kept.slice(0, MAX_RESOURCES_PER_SUBJECT);
  }

  @CaptureSpan()
  public async getStatusesForSubject(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): Promise<Array<ResourceAiAccessStatus>> {
    const refs: Array<ResourceAiAccessRef> =
      await this.getResourcesForSubject(data);

    if (refs.length === 0) {
      return [];
    }

    return await this.getStatusesForResources({
      projectId: data.projectId,
      resources: refs,
      excludeArchived: true,
    });
  }

  // Types in priority order, each type's ids in relation order, deduped.
  private flattenRefs(
    byType: Map<AiResourceType, Array<string>>,
  ): Array<ResourceAiAccessRef> {
    const refs: Array<ResourceAiAccessRef> = [];
    const seen: Set<string> = new Set<string>();

    for (const type of ALL_AI_RESOURCE_TYPES) {
      for (const id of byType.get(type) || []) {
        const key: string = refKey(type, id);

        if (!ObjectID.isValidUUID(id) || seen.has(key)) {
          continue;
        }

        seen.add(key);
        refs.push({ resourceType: type, resourceId: id });
      }
    }

    return refs;
  }

  /*
   * One of the subject's resource relations, read on its own: reading all
   * eight many-to-many relations in one query would multiply their rows.
   */
  private async readSubjectRelation(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    relation: SubjectRelation;
  }): Promise<Array<string>> {
    const select: Record<string, unknown> = {
      _id: true,
      [data.relation]: { _id: true },
    };

    let linked: Array<{ id?: ObjectID | null | undefined }> = [];

    if (data.alertId) {
      const alert: Alert | null = await AlertService.findOneBy({
        query: { _id: data.alertId.toString(), projectId: data.projectId },
        select: select as never,
        props: { isRoot: true },
      });

      linked = ((alert as unknown as Record<string, unknown> | null)?.[
        data.relation
      ] || []) as Array<{ id?: ObjectID | null | undefined }>;
    } else if (data.incidentId) {
      const incident: Incident | null = await IncidentService.findOneBy({
        query: { _id: data.incidentId.toString(), projectId: data.projectId },
        select: select as never,
        props: { isRoot: true },
      });

      linked = ((incident as unknown as Record<string, unknown> | null)?.[
        data.relation
      ] || []) as Array<{ id?: ObjectID | null | undefined }>;
    }

    const ids: Array<string> = [];

    for (const resource of Array.isArray(linked) ? linked : []) {
      const id: string | undefined = resource?.id?.toString();

      if (id) {
        ids.push(id);
      }
    }

    return ids;
  }

  private async readSubjectMonitorIds(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): Promise<Array<ObjectID>> {
    if (data.alertId) {
      const alert: Alert | null = await AlertService.findOneBy({
        query: { _id: data.alertId.toString(), projectId: data.projectId },
        select: { _id: true, monitorId: true },
        props: { isRoot: true },
      });

      return alert?.monitorId ? [alert.monitorId] : [];
    }

    if (data.incidentId) {
      const incident: Incident | null = await IncidentService.findOneBy({
        query: { _id: data.incidentId.toString(), projectId: data.projectId },
        select: { _id: true, monitors: { _id: true } },
        props: { isRoot: true },
      });

      return (incident?.monitors || [])
        .map((monitor: Monitor): ObjectID | undefined => {
          return monitor.id || undefined;
        })
        .filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        });
    }

    return [];
  }

  /*
   * What the subject's monitors' step configuration names now, resolved
   * the way the incident/alert creation path resolves it
   * (MonitorResourceContext: MonitorStepResourceIdentity, then
   * SeriesResourceLinker.resolveResourceRefs with case-insensitive
   * names). Best effort per monitor: that resolution never throws.
   */
  private async resolveMonitorResources(data: {
    projectId: ObjectID;
    monitorIds: Array<ObjectID>;
  }): Promise<Map<AiResourceType, Array<string>>> {
    const byType: Map<AiResourceType, Array<string>> = new Map<
      AiResourceType,
      Array<string>
    >();

    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        _id: QueryHelper.any(
          data.monitorIds.slice(0, MAX_RESOURCES_PER_SUBJECT),
        ),
        projectId: data.projectId,
      },
      select: {
        _id: true,
        projectId: true,
        monitorType: true,
        monitorSteps: true,
      },
      limit: MAX_RESOURCES_PER_SUBJECT,
      skip: 0,
      props: { isRoot: true },
    });

    for (const monitor of monitors) {
      const resolved: SeriesResolvedResourceIds =
        await MonitorResourceContextUtil.resolveResourceContextForMonitor({
          monitor,
        });

      for (const type of ALL_AI_RESOURCE_TYPES) {
        const ids: Array<string> =
          (resolved[MODEL_SPECS[type].resolvedIdsKey] as
            | Array<string>
            | undefined) || [];

        if (ids.length > 0) {
          byType.set(type, [...(byType.get(type) || []), ...ids]);
        }
      }
    }

    return byType;
  }

  /*
   * ------------------------------------------------------------------
   * Who may change a resource
   * ------------------------------------------------------------------
   */

  /*
   * Throws unless the caller may EDIT this resource: its update ACL, with
   * label-scoped allow and block rows decided from the row's own labels,
   * and the caller's Owned scope — exactly what a CRUD update of the row
   * would check. Approving an AI plan runs its commands on the resource as
   * root, so being allowed to start runbooks in the project is not enough
   * on its own: someone blocked from editing (or reading) a resource must
   * not be able to change it by approving a plan. Root and master admins
   * are not gated. A resource that does not exist in the project is
   * refused like one the caller may not edit.
   */
  @CaptureSpan()
  public async assertCallerMayChangeResource(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    resourceType: AiResourceType;
    resourceId: ObjectID;
  }): Promise<void> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    if (!isAiResourceType(data.resourceType)) {
      throw new BadDataException(
        `"${String(data.resourceType)}" is not a resource type.`,
      );
    }

    const noun: string = describeResourceNoun(data.resourceType);
    const refusal: string = `You do not have permission to edit this ${noun}, so you cannot approve an AI plan that changes it. Ask someone who may edit the ${noun} to approve it, or dismiss the suggestion.`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service: DatabaseService<any> =
      MODEL_SPECS[data.resourceType].service;

    const query: Record<string, unknown> = {
      _id: data.resourceId.toString(),
      projectId: data.projectId,
    };

    /*
     * The caller's permissions are read for the resource's own project —
     * the permission layer reads the rows of props.tenantId.
     */
    const callerProps: DatabaseCommonInteractionProps = {
      ...data.props,
      tenantId: data.projectId,
      isMultiTenantRequest: false,
    };

    /*
     * The row's labels, read as root: label-scoped allow and block rows are
     * decided per row, from them (DatabaseService.updateOneById's read).
     */
    const select: Select<BaseModel> = { _id: true };
    const accessControlColumn: string | null = service
      .getModel()
      .getAccessControlColumn();

    if (accessControlColumn) {
      (select as Record<string, unknown>)[accessControlColumn] = {
        _id: true,
        name: true,
      };
    }

    const row: BaseModel | null = (await service.findOneBy({
      query,
      select,
      props: { isRoot: true },
    })) as BaseModel | null;

    if (!row) {
      throw new NotAuthorizedException(refusal);
    }

    try {
      // Readable to the caller at all (a label-scoped read block refuses).
      const readable: BaseModel | null = (await service.findOneBy({
        query,
        select: { _id: true },
        props: callerProps,
      })) as BaseModel | null;

      if (!readable) {
        throw new NotAuthorizedException(refusal);
      }

      await ModelPermission.checkUpdatePermissionByModel({
        modelType: service.modelType,
        fetchModelWithAccessControlIds: async (): Promise<BaseModel> => {
          return row;
        },
        props: callerProps,
      });

      /*
       * The caller's whole update scope as a query (labels, Owned scope):
       * the row must still be in it.
       */
      const permittedQuery: Record<string, unknown> =
        (await ModelPermission.checkUpdateQueryPermissions(
          service.modelType,
          query,
          {},
          callerProps,
        )) as Record<string, unknown>;

      const permitted: BaseModel | null = (await service.findOneBy({
        query: permittedQuery,
        select: { _id: true },
        props: { isRoot: true },
      })) as BaseModel | null;

      if (!permitted) {
        throw new NotAuthorizedException(refusal);
      }
    } catch (error) {
      if (
        error instanceof NotAuthorizedException ||
        error instanceof NotAuthenticatedException
      ) {
        throw new NotAuthorizedException(refusal);
      }

      throw error;
    }
  }

  /*
   * ------------------------------------------------------------------
   * Bookkeeping
   * ------------------------------------------------------------------
   */

  /*
   * Best effort: the resource's AI agent page shows "last verified" / "last
   * error" from this. Written as root without the model's hooks — it is the
   * server's own record of what a command did, not an operator's change to
   * the resource's AI settings (the settings hooks stamp and police those).
   */
  @CaptureSpan()
  public async recordCommandOutcome(data: {
    resourceType: AiResourceType;
    resourceId: ObjectID;
    succeeded: boolean;
    errorMessage?: string | undefined;
  }): Promise<void> {
    try {
      if (!isAiResourceType(data.resourceType)) {
        throw new BadDataException(
          `"${String(data.resourceType)}" is not a resource type.`,
        );
      }

      await MODEL_SPECS[data.resourceType].service.updateOneById({
        id: data.resourceId,
        data: (data.succeeded
          ? {
              aiAccessLastVerifiedAt: OneUptimeDate.getCurrentDate(),
              aiAccessLastError: null,
            }
          : {
              aiAccessLastError: (data.errorMessage || "Command failed.").slice(
                0,
                2000,
              ),
            }) as never,
        props: { isRoot: true, ignoreHooks: true },
      });
    } catch (error) {
      logger.error(
        `ResourceAiAccess: could not record a command outcome for ${String(
          data.resourceType,
        )} ${data.resourceId?.toString()}: ${error}`,
      );
    }
  }
}

const ResourceAiAccessService: ResourceAiAccessServiceClass =
  new ResourceAiAccessServiceClass();

export default ResourceAiAccessService;
