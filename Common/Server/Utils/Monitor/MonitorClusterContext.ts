import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import CephClusterService from "../../Services/CephClusterService";
import ProxmoxClusterService from "../../Services/ProxmoxClusterService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";

/*
 * WI-11 contract: incidents/alerts created by Proxmox/Ceph monitors must
 * be attached to the cluster they monitor — the per-cluster Activity
 * pages and SideMenu badge counts query `proxmoxClusters` /
 * `cephClusters` on Incident/Alert. Series labels cannot supply this
 * identity: the shipped templates group by datapoint labels (`id`,
 * `ceph_daemon`, `pool_id`), and ungrouped templates (e.g.
 * ceph-health-error) have no series at all. The deterministic source is
 * the monitor step config, which always carries `clusterIdentifier`
 * (validated as required by MonitorStep), so the incident/alert creation
 * paths resolve the cluster row from it once per evaluation.
 */
export interface MonitorClusterContext {
  proxmoxClusterIds: Array<string>;
  cephClusterIds: Array<string>;
}

export default class MonitorClusterContextUtil {
  /*
   * Resolve the Proxmox/Ceph cluster rows referenced by the monitor's
   * step configs. Lookup-only — row creation belongs to ingest
   * discovery (findOrCreateByName); a monitor pointing at a cluster
   * that never sent data simply links nothing. The lookup is
   * case-insensitive and project-scoped, matching the ingest contract
   * (the agent-stamped name and the user-typed step identifier may
   * differ only by case). Returns empty arrays for every other monitor
   * type without touching the database.
   */
  public static async resolveClusterContextForMonitor(input: {
    monitor: Monitor;
  }): Promise<MonitorClusterContext> {
    const context: MonitorClusterContext = {
      proxmoxClusterIds: [],
      cephClusterIds: [],
    };

    const monitorType: MonitorType | undefined = input.monitor.monitorType;

    if (
      monitorType !== MonitorType.Proxmox &&
      monitorType !== MonitorType.Ceph
    ) {
      return context;
    }

    if (!input.monitor.projectId) {
      return context;
    }

    const monitorSteps: Array<MonitorStep> =
      input.monitor.monitorSteps?.data?.monitorStepsInstanceArray || [];

    const clusterIdentifiers: Set<string> = new Set<string>();

    for (const monitorStep of monitorSteps) {
      const clusterIdentifier: string | undefined =
        monitorType === MonitorType.Proxmox
          ? monitorStep.data?.proxmoxMonitor?.clusterIdentifier
          : monitorStep.data?.cephMonitor?.clusterIdentifier;

      if (clusterIdentifier && clusterIdentifier.trim().length > 0) {
        clusterIdentifiers.add(clusterIdentifier.trim());
      }
    }

    /*
     * Cluster linking is best-effort context — a lookup failure must
     * never block incident/alert creation, so errors are logged and
     * swallowed per identifier.
     */
    for (const clusterIdentifier of clusterIdentifiers) {
      try {
        if (monitorType === MonitorType.Proxmox) {
          const proxmoxCluster: ProxmoxCluster | null =
            await ProxmoxClusterService.findOneBy({
              query: {
                projectId: input.monitor.projectId,
                name: QueryHelper.findWithSameText(clusterIdentifier),
              },
              select: {
                _id: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (proxmoxCluster?._id) {
            context.proxmoxClusterIds.push(String(proxmoxCluster._id));
          }
        } else {
          const cephCluster: CephCluster | null =
            await CephClusterService.findOneBy({
              query: {
                projectId: input.monitor.projectId,
                name: QueryHelper.findWithSameText(clusterIdentifier),
              },
              select: {
                _id: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (cephCluster?._id) {
            context.cephClusterIds.push(String(cephCluster._id));
          }
        }
      } catch (err) {
        logger.error(
          `Failed to resolve ${monitorType} cluster "${clusterIdentifier}" for monitor ${input.monitor.id?.toString()}: ${err}`,
        );
      }
    }

    return context;
  }
}
