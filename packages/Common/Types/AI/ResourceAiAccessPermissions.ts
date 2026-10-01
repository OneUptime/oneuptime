import Permission, { PermissionHelper } from "../Permission";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
} from "../ResourceAiAgent/AiResourceType";
import { ResourceAiRemediationMode } from "../ResourceAiAgent/ResourceAiAccess";

/*
 * Who may change what OneUptime AI is allowed to do on an infrastructure
 * resource reached through a resource AI agent (a Docker, Podman or Docker
 * Swarm host, a Proxmox cluster, a VMware vCenter, a Ceph cluster, a
 * database server or a host), and the words the server and the dashboard
 * use for it.
 *
 * Kept apart from Types/ResourceAiAgent, which the resource AI agent carries
 * a byte-identical copy of and which therefore stays free of the permission
 * catalog.
 */

/*
 * Who may LOOSEN a resource's AI access: turn AI fixes on (any move up from
 * Off, Ask for approval included) or give them more autonomy (Automatic,
 * Bypass approval), add a command allowlist pattern, and reset the
 * resource's AI agent. A resource's AI mode does the job of a FullAuto
 * AutoRemediationRule without a rule row, so it takes the same set a
 * Kubernetes cluster's AI access takes (KUBERNETES_AI_ACCESS_ADMIN_
 * PERMISSIONS — a Common test pins the two together).
 *
 * Tightening (Off, moving down, removing allowlist patterns or clearing the
 * list) and the investigation switch stay open to anyone who may edit the
 * resource: making AI do less never needs more privilege than the resource
 * itself.
 */
export const RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditAutoRemediationRule,
];

/*
 * How each resource type is named inside a sentence ("on this Docker host",
 * "on this database server"). AI_RESOURCE_TYPE_INFO's displayName starts
 * every name with a capital, which reads wrong mid-sentence for the two
 * types whose name is a common noun.
 */
const RESOURCE_SENTENCE_NAMES: Readonly<Record<AiResourceType, string>> = {
  [AiResourceType.DockerHost]: "Docker host",
  [AiResourceType.PodmanHost]: "Podman host",
  [AiResourceType.DockerSwarmCluster]: "Docker Swarm cluster",
  [AiResourceType.ProxmoxCluster]: "Proxmox cluster",
  [AiResourceType.VMwareVCenter]: "VMware vCenter",
  [AiResourceType.CephCluster]: "Ceph cluster",
  [AiResourceType.DatabaseServer]: "database server",
  [AiResourceType.Host]: "host",
};

export function getResourceSentenceName(resourceType: AiResourceType): string {
  return RESOURCE_SENTENCE_NAMES[resourceType] || "resource";
}

// The name of the resource type's AI agent, for sentences ("the Docker AI agent").
export function getResourceAgentName(resourceType: AiResourceType): string {
  return AI_RESOURCE_TYPE_INFO[resourceType]?.agentDisplayName || "AI agent";
}

/*
 * The AI agent page's short name for each remediation mode, used on the
 * resource feed and in messages — the same words a Kubernetes cluster's
 * page uses.
 */
export const RESOURCE_AI_REMEDIATION_MODE_LABELS: Readonly<
  Record<ResourceAiRemediationMode, string>
> = {
  [ResourceAiRemediationMode.Disabled]: "Off",
  [ResourceAiRemediationMode.RequireApproval]: "Ask for approval",
  [ResourceAiRemediationMode.Automatic]: "Automatic",
  [ResourceAiRemediationMode.BypassApproval]: "Bypass approval",
};

/*
 * One valid allowlist entry per resource type — a change that needs
 * approval unless allowlisted — shown as the example in the refusal of a
 * malformed allowlist and usable as the dashboard field's placeholder. A
 * Common test checks each one against the resource command policy.
 */
export const RESOURCE_AI_ALLOWLIST_EXAMPLES: Readonly<
  Record<AiResourceType, string>
> = {
  [AiResourceType.DockerHost]: "docker stop web",
  [AiResourceType.PodmanHost]: "docker stop web",
  [AiResourceType.DockerSwarmCluster]:
    "docker service update --image nginx:1.27 web",
  [AiResourceType.ProxmoxCluster]:
    "pvesh create /nodes/pve1/qemu/100/status/shutdown",
  [AiResourceType.VMwareVCenter]: "govc vm.power -off web-01",
  [AiResourceType.CephCluster]: "ceph osd out 3",
  [AiResourceType.DatabaseServer]: "db terminate-session 12345",
  [AiResourceType.Host]: "systemctl stop nginx",
};

/*
 * The refusal for a caller who tried to make AI do more on a resource
 * without one of RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS: what needs them, who
 * has them, and what stays open to every editor of the resource.
 */
export function getResourceAiAccessAdminRefusal(
  resourceType: AiResourceType,
): string {
  const name: string = getResourceSentenceName(resourceType);

  return `You need one of these permissions to let OneUptime AI do more on a ${name} (turn AI fixes on or give them more autonomy, or add command allowlist patterns): ${PermissionHelper.getPermissionTitles(
    RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS,
  ).join(
    ", ",
  )}. Anyone who may edit the ${name} can still turn AI fixes off or down to Ask for approval, and remove allowlist patterns.`;
}

// The refusal for a caller who may not reset the resource's AI agent.
export function getResourceAiAgentResetRefusal(
  resourceType: AiResourceType,
): string {
  return `You need one of these permissions to reset this ${getResourceSentenceName(
    resourceType,
  )}'s ${getResourceAgentName(resourceType)}: ${PermissionHelper.getPermissionTitles(
    RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS,
  ).join(", ")}.`;
}
