import PageMap from "../../Utils/PageMap";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  RESOURCE_AI_ALLOWLIST_EXAMPLES,
  getResourceSentenceName,
} from "Common/Types/AI/ResourceAiAccessPermissions";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  ALL_AI_RESOURCE_TYPES,
  AiResourceTypeInfo,
} from "Common/Types/ResourceAiAgent/AiResourceType";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import Host from "Common/Models/DatabaseModels/Host";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";

/*
 * What the generic AI pages (ResourceAiAgentPage, ResourceAiInsightsPage,
 * ResourceAiLogsPage) need to know about one kind of resource: its model,
 * its AI pages, and the words the pages use for it. One entry per
 * AiResourceType — the thin per-resource pages under Pages/<Resource>/View/AI
 * only pick theirs.
 *
 * Kubernetes clusters are not here: they keep their own AI pages
 * (Pages/Kubernetes/View/AI).
 *
 * Import-clean on purpose (Common types and models, and PageMap, which is
 * an enum), so the suites read it without a browser.
 */

// Every model a resource AI agent can serve. Their AI columns share names.
export type ResourceAiModel =
  | DockerHost
  | PodmanHost
  | DockerSwarmCluster
  | ProxmoxCluster
  | VMwareVCenter
  | CephCluster
  | DatabaseServer
  | Host;

export type ResourceAiModelType = { new (): ResourceAiModel };

export interface ResourceAiAgentDescriptor {
  resourceType: AiResourceType;
  modelType: ResourceAiModelType;
  // The resource's AI → AI agent, AI → Insights and AI → Logs pages.
  agentPage: PageMap;
  insightsPage: PageMap;
  logsPage: PageMap;
  // How sentences name the resource, after "this" or "a": "Docker host".
  noun: string;
  // The agent, as everything else names it: "Docker AI agent".
  agentName: string;
  // The agent card's one-line description.
  agentCardDescription: string;
  // The investigation switch's label: "Investigate with docker".
  investigateTitle: string;
  // What an investigation runs, in a few words: "ps, inspect, logs, …".
  readExamples: string;
  // How the ready line and the commands card name what AI runs.
  readOnlyCommandsPhrase: string;
  commandsCardTitle: string;
  /*
   * The resource's own version as the agent reports it, labelled:
   * "Docker 27.3.1". Null: the version is shown as it is.
   */
  toolVersionLabel: string | null;
  /*
   * The column holding the identity the agent registers with (the name
   * the collector reports), read for the install instructions. Null: the
   * agent is pinned by the resource's id instead (database servers).
   */
  identityColumn: "hostIdentifier" | "name" | null;
  // An allowlist entry to show as the field's example: a riskier command.
  allowlistPlaceholder: string;
  // What fixes may change, and the changes that always ask a person.
  writeExamples: string;
  alwaysHumanExamples: string | null;
  /*
   * A few riskier changes, as a phrase of their own ("riskier changes such
   * as stopping, killing or updating a container") and as the changes
   * alone, for a sentence that says "such as" itself. Each is a key, so a
   * locale words both.
   */
  riskierExamples: string;
  riskierChanges: string;
  // The table and preference keys of the commands table.
  commandsTableId: string;
}

/*
 * The descriptors' copy that the shared contract does not hold already
 * (AI_RESOURCE_TYPE_INFO's agent names, the server's sentence names and
 * allowlist examples in Types/AI/ResourceAiAccessPermissions).
 */
type DescriptorCopy = Omit<
  ResourceAiAgentDescriptor,
  "resourceType" | "agentName" | "noun" | "allowlistPlaceholder"
>;

const DESCRIPTOR_COPY: Readonly<Record<AiResourceType, DescriptorCopy>> = {
  [AiResourceType.DockerHost]: {
    modelType: DockerHost,
    agentPage: PageMap.DOCKER_HOST_VIEW_AI_AGENT,
    insightsPage: PageMap.DOCKER_HOST_VIEW_AI_INSIGHTS,
    logsPage: PageMap.DOCKER_HOST_VIEW_AI_LOGS,
    agentCardDescription: translationKey(
      "The small container next to your Docker agent that runs docker commands for OneUptime AI.",
    ),
    investigateTitle: translationKey("Investigate with docker"),
    readExamples: "ps, inspect, logs, stats, events",
    readOnlyCommandsPhrase: translationKey("read-only docker commands"),
    commandsCardTitle: translationKey("docker commands"),
    toolVersionLabel: "Docker",
    identityColumn: "hostIdentifier",
    writeExamples: translationKey(
      "restart, start, stop, kill, pause and update (memory, CPU, restart policy) containers",
    ),
    alwaysHumanExamples: null,
    riskierExamples: translationKey(
      "riskier changes such as stopping, killing or updating a container",
    ),
    riskierChanges: translationKey("stopping, killing or updating a container"),
    commandsTableId: "docker-host-ai-commands",
  },
  [AiResourceType.PodmanHost]: {
    modelType: PodmanHost,
    agentPage: PageMap.PODMAN_HOST_VIEW_AI_AGENT,
    insightsPage: PageMap.PODMAN_HOST_VIEW_AI_INSIGHTS,
    logsPage: PageMap.PODMAN_HOST_VIEW_AI_LOGS,
    agentCardDescription: translationKey(
      "The small container next to your Podman agent that runs docker commands against Podman's Docker-compatible API for OneUptime AI.",
    ),
    investigateTitle: translationKey("Investigate with docker"),
    readExamples: "ps, inspect, logs, stats, events",
    readOnlyCommandsPhrase: translationKey("read-only docker commands"),
    commandsCardTitle: translationKey("docker commands"),
    toolVersionLabel: "Podman",
    identityColumn: "hostIdentifier",
    writeExamples: translationKey(
      "restart, start, stop, kill, pause and update (memory, CPU, restart policy) containers",
    ),
    alwaysHumanExamples: null,
    riskierExamples: translationKey(
      "riskier changes such as stopping, killing or updating a container",
    ),
    riskierChanges: translationKey("stopping, killing or updating a container"),
    commandsTableId: "podman-host-ai-commands",
  },
  [AiResourceType.DockerSwarmCluster]: {
    modelType: DockerSwarmCluster,
    agentPage: PageMap.DOCKER_SWARM_CLUSTER_VIEW_AI_AGENT,
    insightsPage: PageMap.DOCKER_SWARM_CLUSTER_VIEW_AI_INSIGHTS,
    logsPage: PageMap.DOCKER_SWARM_CLUSTER_VIEW_AI_LOGS,
    agentCardDescription: translationKey(
      "The small container on a manager node that runs docker commands for OneUptime AI.",
    ),
    investigateTitle: translationKey("Investigate with docker"),
    readExamples: "service ls, service ps, service logs, node ls, stack ps",
    readOnlyCommandsPhrase: translationKey("read-only docker commands"),
    commandsCardTitle: translationKey("docker commands"),
    toolVersionLabel: "Docker",
    identityColumn: "name",
    writeExamples: translationKey(
      "restart (force-update), roll back, scale and update services, and change a node's availability",
    ),
    alwaysHumanExamples: translationKey("draining or pausing a node"),
    riskierExamples: translationKey(
      "riskier changes such as scaling a service to zero or changing its image",
    ),
    riskierChanges: translationKey(
      "scaling a service to zero or changing its image",
    ),
    commandsTableId: "docker-swarm-cluster-ai-commands",
  },
  [AiResourceType.ProxmoxCluster]: {
    modelType: ProxmoxCluster,
    agentPage: PageMap.PROXMOX_CLUSTER_VIEW_AI_AGENT,
    insightsPage: PageMap.PROXMOX_CLUSTER_VIEW_AI_INSIGHTS,
    logsPage: PageMap.PROXMOX_CLUSTER_VIEW_AI_LOGS,
    agentCardDescription: translationKey(
      "The small container next to your Proxmox agent that calls the Proxmox VE API (pvesh) for OneUptime AI with its own API token.",
    ),
    investigateTitle: translationKey("Investigate with pvesh"),
    readExamples:
      "cluster status and resources, node and guest status, tasks and logs",
    readOnlyCommandsPhrase: translationKey("read-only pvesh requests"),
    commandsCardTitle: translationKey("pvesh commands"),
    toolVersionLabel: "Proxmox VE",
    identityColumn: "name",
    writeExamples: translationKey(
      "start, resume, reboot, shut down, stop, suspend and reset guests, and start, restart or reload node services",
    ),
    alwaysHumanExamples: translationKey(
      "migrating a guest, and restarting corosync or pve-cluster",
    ),
    riskierExamples: translationKey(
      "riskier changes such as shutting down, stopping or resetting a guest",
    ),
    riskierChanges: translationKey(
      "shutting down, stopping or resetting a guest",
    ),
    commandsTableId: "proxmox-cluster-ai-commands",
  },
  [AiResourceType.VMwareVCenter]: {
    modelType: VMwareVCenter,
    agentPage: PageMap.VMWARE_VCENTER_VIEW_AI_AGENT,
    insightsPage: PageMap.VMWARE_VCENTER_VIEW_AI_INSIGHTS,
    logsPage: PageMap.VMWARE_VCENTER_VIEW_AI_LOGS,
    agentCardDescription: translationKey(
      "The small container next to your VMware agent that runs govc for OneUptime AI with its own vCenter user.",
    ),
    investigateTitle: translationKey("Investigate with govc"),
    readExamples: "about, ls, find, vm.info, host.info, events, tasks",
    readOnlyCommandsPhrase: translationKey("read-only govc commands"),
    commandsCardTitle: translationKey("govc commands"),
    toolVersionLabel: "vCenter",
    identityColumn: "name",
    writeExamples: translationKey(
      "power VMs on, off, reset, suspend and reboot them, and take hosts out of maintenance mode",
    ),
    alwaysHumanExamples: translationKey(
      "migrating a VM and putting a host into maintenance mode",
    ),
    riskierExamples: translationKey(
      "riskier changes such as powering a VM off, resetting or suspending it",
    ),
    riskierChanges: translationKey(
      "powering a VM off, resetting or suspending it",
    ),
    commandsTableId: "vmware-vcenter-ai-commands",
  },
  [AiResourceType.CephCluster]: {
    modelType: CephCluster,
    agentPage: PageMap.CEPH_CLUSTER_VIEW_AI_AGENT,
    insightsPage: PageMap.CEPH_CLUSTER_VIEW_AI_INSIGHTS,
    logsPage: PageMap.CEPH_CLUSTER_VIEW_AI_LOGS,
    agentCardDescription: translationKey(
      "The small container next to your Ceph agent that runs the ceph CLI for OneUptime AI with its own keyring.",
    ),
    investigateTitle: translationKey("Investigate with ceph"),
    readExamples: "status, health detail, osd tree, df, pg stat, crash ls",
    readOnlyCommandsPhrase: translationKey("read-only ceph commands"),
    commandsCardTitle: translationKey("ceph commands"),
    toolVersionLabel: "Ceph",
    identityColumn: "name",
    writeExamples: translationKey(
      "mark OSDs in, out and down, set and unset cluster flags, reweight OSDs, scrub and repair PGs, fail over the mgr, restart, stop and start daemons, and archive crash reports",
    ),
    alwaysHumanExamples: translationKey(
      "pausing all client I/O and changing a pool's size or min_size",
    ),
    riskierExamples: translationKey(
      "riskier changes such as marking an OSD out, setting noout or repairing a PG",
    ),
    riskierChanges: translationKey(
      "marking an OSD out, setting noout or repairing a PG",
    ),
    commandsTableId: "ceph-cluster-ai-commands",
  },
  [AiResourceType.DatabaseServer]: {
    modelType: DatabaseServer,
    agentPage: PageMap.DATABASE_SERVER_VIEW_AI_AGENT,
    insightsPage: PageMap.DATABASE_SERVER_VIEW_AI_INSIGHTS,
    logsPage: PageMap.DATABASE_SERVER_VIEW_AI_LOGS,
    agentCardDescription: translationKey(
      "The small container next to your database agent that runs a fixed catalog of diagnostics for OneUptime AI with its own login. It never runs free SQL.",
    ),
    investigateTitle: translationKey("Investigate with db diagnostics"),
    readExamples:
      "sessions, locks, long-running queries, replication, sizes, settings",
    readOnlyCommandsPhrase: translationKey("read-only db diagnostics"),
    commandsCardTitle: translationKey("db commands"),
    toolVersionLabel: null,
    identityColumn: null,
    writeExamples: translationKey("cancel a running query and end one session"),
    alwaysHumanExamples: null,
    riskierExamples: translationKey("riskier changes such as ending a session"),
    riskierChanges: translationKey("ending a session"),
    commandsTableId: "database-server-ai-commands",
  },
  [AiResourceType.Host]: {
    modelType: Host,
    agentPage: PageMap.HOST_VIEW_AI_AGENT,
    insightsPage: PageMap.HOST_VIEW_AI_INSIGHTS,
    logsPage: PageMap.HOST_VIEW_AI_LOGS,
    agentCardDescription: translationKey(
      "The small privileged container on this host that runs the host's own tools (systemctl, journalctl, ps, …) for OneUptime AI.",
    ),
    investigateTitle: translationKey("Investigate with host commands"),
    readExamples: "systemctl status, journalctl, df, free, ps, ss",
    readOnlyCommandsPhrase: translationKey("read-only host commands"),
    commandsCardTitle: translationKey("Host commands"),
    toolVersionLabel: null,
    identityColumn: "hostIdentifier",
    writeExamples: translationKey(
      "restart, start, reload, stop and reset systemd units, vacuum the journal and signal processes",
    ),
    alwaysHumanExamples: translationKey(
      "changing a protected unit (sshd, systemd-*, dbus, networking, docker, …), a .target or .mount unit, and killing a process",
    ),
    riskierExamples: translationKey(
      "riskier changes such as stopping a unit or vacuuming the journal",
    ),
    riskierChanges: translationKey("stopping a unit or vacuuming the journal"),
    commandsTableId: "host-ai-commands",
  },
};

/*
 * The resource and agent names the shared catalog (Common/Types) gives these
 * pages, listed as translation keys so a locale can word them: the pages'
 * sentences take them as terms ({{noun}}, {{agent}}), looked up by their
 * English text.
 */
export const RESOURCE_AI_NAME_KEYS: ReadonlyArray<string> = [
  translationKey("Docker host"),
  translationKey("Podman host"),
  translationKey("Docker Swarm cluster"),
  translationKey("Proxmox cluster"),
  translationKey("VMware vCenter"),
  translationKey("Ceph cluster"),
  translationKey("database server"),
  translationKey("host"),
  translationKey("Docker AI agent"),
  translationKey("Podman AI agent"),
  translationKey("Docker Swarm AI agent"),
  translationKey("Proxmox AI agent"),
  translationKey("VMware AI agent"),
  translationKey("Ceph AI agent"),
  translationKey("Database AI agent"),
  translationKey("Host AI agent"),
];

export const RESOURCE_AI_AGENT_DESCRIPTORS: Readonly<
  Record<AiResourceType, ResourceAiAgentDescriptor>
> = ALL_AI_RESOURCE_TYPES.reduce(
  (
    descriptors: Record<AiResourceType, ResourceAiAgentDescriptor>,
    type: AiResourceType,
  ): Record<AiResourceType, ResourceAiAgentDescriptor> => {
    const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[type];

    descriptors[type] = {
      ...DESCRIPTOR_COPY[type],
      resourceType: type,
      agentName: info.agentDisplayName,
      noun: getResourceSentenceName(type),
      allowlistPlaceholder: RESOURCE_AI_ALLOWLIST_EXAMPLES[type],
    };

    return descriptors;
  },
  {} as Record<AiResourceType, ResourceAiAgentDescriptor>,
);

export function getResourceAiAgentDescriptor(
  type: AiResourceType,
): ResourceAiAgentDescriptor {
  return RESOURCE_AI_AGENT_DESCRIPTORS[type];
}
