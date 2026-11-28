/*
 * THE KINDS OF RECORD WITH OWNER TABLES OF THEIR OWN, BY TABLE (#11436).
 *
 * People and teams own a monitor, a service, a dashboard, a status page -
 * each kind here keeps its owners in two tables of its own (MonitorOwnerUser
 * and MonitorOwnerTeam), and a grant scoped to Owned reaches only the
 * records its holder, or the team it is given to, owns
 * (Server/Types/Database/Permissions/OwnedScopePermission). Their CRUD
 * routes answer who owns the records a page shows (POST /<record>
 * /record-ownership, Types/RecordAccess/RecordOwnership), and a page asks
 * only of these kinds.
 *
 * Read off the server's registry of owner tables
 * (Server/Types/Database/Permissions/OwnerTableRegistry) and written down
 * here because the Dashboard carries no server code.
 * KindsWithOwnersGuard.test.ts (Tests/Server/Types/Database/Permissions)
 * fails, naming each kind to add or remove, whenever the registry changes.
 * In alphabetical order.
 */
export const KINDS_WITH_OWNER_TABLES: ReadonlyArray<string> = [
  "AIAgent",
  "Alert",
  "AlertEpisode",
  "CephCluster",
  "CloudResource",
  "Dashboard",
  "DataAsset",
  "DataPipeline",
  "DataStore",
  "DatabaseServer",
  "DockerHost",
  "DockerSwarmCluster",
  "Host",
  "Incident",
  "IncidentEpisode",
  "IncidentTemplate",
  "IncomingCallPolicy",
  "IoTFleet",
  "KubernetesCluster",
  "MessageQueue",
  "Monitor",
  "MonitorGroup",
  "NetworkDevice",
  "NetworkSite",
  "OnCallDutyPolicy",
  "OnCallDutyPolicySchedule",
  "OpenStackCloud",
  "PodmanHost",
  "Probe",
  "ProxmoxCluster",
  "RumApplication",
  "Runbook",
  "Runner",
  "ScheduledMaintenance",
  "ScheduledMaintenanceTemplate",
  "ServerlessFunction",
  "Service",
  "ServiceLevelObjective",
  "StatusPage",
  "StorageArray",
  "Team",
  "VMwareVCenter",
  "Workflow",
  "XcpNgPool",
];

/*
 * Of those, the kinds other records are set up with - a probe, a runner, a
 * template, an on-call schedule - whose reads the Owned scope leaves alone:
 * every reader of the kind reads every one, as picking one needs, and a
 * grant scoped to Owned still changes and deletes only what its holder or
 * their teams own (OwnerTableRegistry's ownedScopeLeavesReads,
 * OwnedScopePermission.leavesReadsAlone). Held to the registry by the same
 * guard.
 */
export const KINDS_WHOSE_READS_THE_OWNED_SCOPE_LEAVES_ALONE: ReadonlyArray<string> =
  [
    "AIAgent",
    "IncidentTemplate",
    "NetworkSite",
    "OnCallDutyPolicySchedule",
    "Probe",
    "Runner",
    "ScheduledMaintenanceTemplate",
    "Team",
  ];

const KINDS: ReadonlySet<string> = new Set<string>(KINDS_WITH_OWNER_TABLES);
const READS_LEFT_ALONE: ReadonlySet<string> = new Set<string>(
  KINDS_WHOSE_READS_THE_OWNED_SCOPE_LEAVES_ALONE,
);

// What the scope reads of a model: its table, and the parents it takes its owners from.
export interface OwnedKindModel {
  tableName?: string | null | undefined;
  isOperationalResource?: boolean | undefined;
  ownedThrough?: { parentModels: ReadonlyArray<unknown> } | null | undefined;
}

const getTableNameOf: (modelType: unknown) => string = (
  modelType: unknown,
): string => {
  if (typeof modelType !== "function") {
    return "";
  }

  try {
    return (
      new (modelType as { new (): { tableName?: string | null } })()
        .tableName || ""
    );
  } catch {
    return "";
  }
};

export default class KindsWithOwners {
  // Whether records of `tableName` have owner tables of their own.
  public static hasOwnerTables(tableName: string | null | undefined): boolean {
    return Boolean(tableName && KINDS.has(tableName));
  }

  /*
   * Whether a model's records have owners for the Owned scope to narrow by,
   * as the server reads it (OwnedScopePermission.hasOwners): an operational
   * resource, a kind with owner tables, or a model that takes its owners
   * from one (@OwnedThrough).
   */
  public static hasOwners(model: OwnedKindModel | null | undefined): boolean {
    return Boolean(
      model &&
        (model.isOperationalResource ||
          model.ownedThrough ||
          KindsWithOwners.hasOwnerTables(model.tableName)),
    );
  }

  /*
   * Whether the Owned scope leaves a model's reads alone
   * (OwnedScopePermission.leavesReadsAlone): a kind other records are set
   * up with, or a model that takes its owners only from such kinds.
   */
  public static leavesReadsAlone(
    model: OwnedKindModel | null | undefined,
  ): boolean {
    if (!model) {
      return false;
    }

    const kinds: Array<string> = model.ownedThrough
      ? model.ownedThrough.parentModels.map(getTableNameOf)
      : [model.tableName || ""];

    return (
      kinds.length > 0 &&
      kinds.every((kind: string): boolean => {
        return Boolean(kind) && READS_LEFT_ALONE.has(kind);
      })
    );
  }
}
