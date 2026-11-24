import ProductKey from "../Product/ProductKey";
import {
  UsedByCounts,
  UsedByGroupPart,
  UsedByRow,
  UsedByRowKind,
  getUsedByRowKindOfRow,
} from "./UsedBy";

/*
 * "USED BY" AND THE PRODUCTS A SERVER SWITCHED OFF (#6815, #6813).
 *
 * The Used by card lists and links what refers to a record - a monitor's
 * status pages, SLOs, workflows. A product switched off on the server has no
 * pages to link to, so the card leaves its line out (UsedByCard). A family's
 * line (the rules that name a monitor) holds kinds of several products: it
 * keeps the kinds of the products that are on, and is left out only when
 * none is.
 *
 * The Delete and Archive dialogs read the same summary and keep every line
 * (UsedByImpact): deleting a monitor still takes it off a status page while
 * Status Pages is off, and that page is back, without it, once the server
 * switches Status Pages on again - nothing is deleted when a product is off,
 * so what a delete does to it still counts.
 *
 * Pure: the Dashboard and its tests read it.
 */

/*
 * The product each kind of row is a record of: the product whose pages
 * open it. A rule opens its event's settings - an incident runbook rule
 * Incidents', an alert's Alerts'.
 */
export const USED_BY_ROW_KIND_PRODUCTS: Readonly<
  Record<UsedByRowKind, ProductKey>
> = {
  [UsedByRowKind.Monitor]: ProductKey.Monitors,
  [UsedByRowKind.MonitorGroup]: ProductKey.Monitors,
  [UsedByRowKind.StatusPage]: ProductKey.StatusPages,
  [UsedByRowKind.ServiceLevelObjective]: ProductKey.Slos,
  [UsedByRowKind.ScheduledMaintenance]: ProductKey.ScheduledMaintenance,
  [UsedByRowKind.Workflow]: ProductKey.Workflows,
  [UsedByRowKind.Dashboard]: ProductKey.Dashboards,
  [UsedByRowKind.OnCallDutyPolicy]: ProductKey.OnCall,
  [UsedByRowKind.OnCallSchedule]: ProductKey.OnCall,
  [UsedByRowKind.Service]: ProductKey.Services,
  [UsedByRowKind.Incident]: ProductKey.Incidents,
  [UsedByRowKind.Alert]: ProductKey.Alerts,

  [UsedByRowKind.IncidentOnCallRule]: ProductKey.Incidents,
  [UsedByRowKind.AlertOnCallRule]: ProductKey.Alerts,
  [UsedByRowKind.IncidentEpisodeOnCallRule]: ProductKey.Incidents,
  [UsedByRowKind.AlertEpisodeOnCallRule]: ProductKey.Alerts,
  [UsedByRowKind.IncidentOwnerRule]: ProductKey.Incidents,
  [UsedByRowKind.AlertOwnerRule]: ProductKey.Alerts,
  [UsedByRowKind.IncidentLabelRule]: ProductKey.Incidents,
  [UsedByRowKind.AlertLabelRule]: ProductKey.Alerts,
  [UsedByRowKind.IncidentGroupingRule]: ProductKey.Incidents,
  [UsedByRowKind.AlertGroupingRule]: ProductKey.Alerts,
  [UsedByRowKind.IncidentPrivacyRule]: ProductKey.Incidents,
  [UsedByRowKind.AlertPrivacyRule]: ProductKey.Alerts,
  [UsedByRowKind.IncidentSlaRule]: ProductKey.Incidents,
  [UsedByRowKind.AlertIncidentRule]: ProductKey.Alerts,
  [UsedByRowKind.IncidentAiRule]: ProductKey.Incidents,
  [UsedByRowKind.AlertAiRule]: ProductKey.Alerts,
  [UsedByRowKind.IncidentRunbookRule]: ProductKey.Incidents,
  [UsedByRowKind.AlertRunbookRule]: ProductKey.Alerts,
  [UsedByRowKind.MaintenanceRunbookRule]: ProductKey.ScheduledMaintenance,
  [UsedByRowKind.PostmortemRule]: ProductKey.Incidents,
  [UsedByRowKind.MaintenanceLabelRule]: ProductKey.ScheduledMaintenance,
  [UsedByRowKind.MaintenanceOwnerRule]: ProductKey.ScheduledMaintenance,
  [UsedByRowKind.SloBurnRateRule]: ProductKey.Slos,
  [UsedByRowKind.SloErrorBudgetPolicyTier]: ProductKey.Slos,
  [UsedByRowKind.CloudBudget]: ProductKey.Cloud,

  [UsedByRowKind.IncidentTemplate]: ProductKey.Incidents,
  [UsedByRowKind.MaintenanceTemplate]: ProductKey.ScheduledMaintenance,
  [UsedByRowKind.AnnouncementTemplate]: ProductKey.StatusPages,

  [UsedByRowKind.IncidentEpisode]: ProductKey.Incidents,
  [UsedByRowKind.AlertEpisode]: ProductKey.Alerts,
  [UsedByRowKind.Runbook]: ProductKey.Runbooks,
  [UsedByRowKind.IncomingCallPolicy]: ProductKey.OnCall,
  [UsedByRowKind.Team]: ProductKey.Teams,
  [UsedByRowKind.Host]: ProductKey.Hosts,
  [UsedByRowKind.KubernetesCluster]: ProductKey.Kubernetes,
  [UsedByRowKind.DockerHost]: ProductKey.Docker,
  [UsedByRowKind.DockerSwarmCluster]: ProductKey.DockerSwarm,
  [UsedByRowKind.PodmanHost]: ProductKey.Podman,
  [UsedByRowKind.ProxmoxCluster]: ProductKey.Proxmox,
  [UsedByRowKind.OpenStackCloud]: ProductKey.OpenStack,
  [UsedByRowKind.VMwareVCenter]: ProductKey.VMware,
  [UsedByRowKind.CephCluster]: ProductKey.Ceph,
  [UsedByRowKind.StorageArray]: ProductKey.StorageArrays,
  [UsedByRowKind.NetworkDevice]: ProductKey.Network,
  [UsedByRowKind.NetworkSite]: ProductKey.Network,
  [UsedByRowKind.IoTFleet]: ProductKey.IoT,
  [UsedByRowKind.CloudResource]: ProductKey.Cloud,
  [UsedByRowKind.ServerlessFunction]: ProductKey.Serverless,
  [UsedByRowKind.DatabaseServer]: ProductKey.Databases,
  [UsedByRowKind.MessageQueue]: ProductKey.Queues,
  [UsedByRowKind.RumApplication]: ProductKey.Rum,
  [UsedByRowKind.DataStore]: ProductKey.DataObservability,
  [UsedByRowKind.DataAsset]: ProductKey.DataObservability,
  [UsedByRowKind.DataPipeline]: ProductKey.DataObservability,
  [UsedByRowKind.Probe]: ProductKey.Monitors,
  [UsedByRowKind.Runner]: ProductKey.Runbooks,
  // An AI agent belongs to the project, beside the resources it reads.
  [UsedByRowKind.AIAgent]: ProductKey.ProjectSettings,
};

function isOfProductOff(
  rowKind: UsedByRowKind,
  offProducts: ReadonlyArray<ProductKey>,
): boolean {
  return offProducts.includes(USED_BY_ROW_KIND_PRODUCTS[rowKind]);
}

/*
 * A family's line less the kinds of products that are off: its parts, its
 * counts (the parts that are left, summed) and its rows.
 */
function withoutPartsOfProductsOff<TGroup extends UsedByCounts>(
  group: TGroup,
  offProducts: ReadonlyArray<ProductKey>,
): TGroup {
  const parts: Array<UsedByGroupPart> = (group.parts || []).filter(
    (part: UsedByGroupPart): boolean => {
      return !isOfProductOff(part.rowKind, offProducts);
    },
  );
  const rows: Array<UsedByRow> | undefined = (
    group as unknown as { rows?: Array<UsedByRow> }
  ).rows;

  return {
    ...group,
    parts: parts,
    count: parts.reduce((sum: number, part: UsedByGroupPart): number => {
      return sum + part.count;
    }, 0),
    hiddenCount: parts.reduce((sum: number, part: UsedByGroupPart): number => {
      return sum + part.hiddenCount;
    }, 0),
    ...(rows
      ? {
          rows: rows.filter((row: UsedByRow): boolean => {
            return !isOfProductOff(
              getUsedByRowKindOfRow(row, group.rowKind),
              offProducts,
            );
          }),
        }
      : {}),
  };
}

// The rows a page of a relation keeps: none of a product that is off.
export const withoutRowsOfProductsOff: (
  rows: Array<UsedByRow>,
  groupRowKind: UsedByRowKind,
  offProducts: ReadonlyArray<ProductKey>,
) => Array<UsedByRow> = (
  rows: Array<UsedByRow>,
  groupRowKind: UsedByRowKind,
  offProducts: ReadonlyArray<ProductKey>,
): Array<UsedByRow> => {
  if (offProducts.length === 0) {
    return rows;
  }

  return rows.filter((row: UsedByRow): boolean => {
    return !isOfProductOff(
      getUsedByRowKindOfRow(row, groupRowKind),
      offProducts,
    );
  });
};

// The summary without the lines (and a family's kinds) of products switched off on the server.
export const withoutGroupsOfProductsOff: <
  TSummary extends { groups: Array<UsedByCounts> },
>(
  summary: TSummary,
  offProducts: ReadonlyArray<ProductKey>,
) => TSummary = <TSummary extends { groups: Array<UsedByCounts> }>(
  summary: TSummary,
  offProducts: ReadonlyArray<ProductKey>,
): TSummary => {
  if (offProducts.length === 0) {
    return summary;
  }

  return {
    ...summary,
    groups: summary.groups
      .filter((group: UsedByCounts): boolean => {
        return (
          Boolean(group.parts) || !isOfProductOff(group.rowKind, offProducts)
        );
      })
      .map((group: UsedByCounts): UsedByCounts => {
        return group.parts
          ? withoutPartsOfProductsOff(group, offProducts)
          : group;
      }),
  } as TSummary;
};
