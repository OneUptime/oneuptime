import DataMigrationBase from "./DataMigrationBase";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import DashboardService from "Common/Server/Services/DashboardService";
import logger from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import KubernetesClusterCpuTileRepair, {
  KubernetesClusterCpuTileRepairResult,
} from "Common/Utils/Dashboard/KubernetesClusterCpuTileRepair";

/*
 * Rewrites the "Cluster CPU (cores in use)" tile on Kubernetes dashboards
 * that already exist to the busiest node's peak CPU, as the template now
 * ships it. See KubernetesClusterCpuTileRepair for why the old tile's `Sum`
 * read hundreds of cores on a small cluster, and for exactly which tiles are
 * touched.
 *
 * Templates are copied into a dashboard when it is created, so fixing the
 * template alone leaves every existing Kubernetes dashboard with the old tile.
 * Until the kubernetes-agent chart enabled k8s.node.cpu.usage that tile showed
 * no data; with it, the tile shows a wildly inflated number, which is worse.
 *
 * Postgres selects the affected dashboards by jsonb containment, so only
 * dashboards holding the tile are read. Their ids are collected first and
 * each dashboard is then read and written on its own: a repaired dashboard
 * drops out of that match, so paging the match while writing would skip rows,
 * and one config in memory at a time keeps a large table cheap.
 *
 * The write is a compare-and-set on the whole config, so a dashboard a user
 * saves while this runs keeps their save; it is not retried, and the user can
 * change the tile by hand. Hook-free, like the other column repairs: the
 * dashboard is not being edited by anyone, only its stored tile corrected.
 *
 * Idempotent, and safe to run twice concurrently as this runner requires
 * (see Workers/Utils/DataMigration.ts): a repaired config no longer matches,
 * and two passes writing the same repair to the same row cannot disagree.
 */
export default class RepairKubernetesDashboardClusterCpuTile extends DataMigrationBase {
  public constructor() {
    super("RepairKubernetesDashboardClusterCpuTile");
  }

  public override async migrate(): Promise<void> {
    const dashboardIds: Array<ObjectID> = await this.findAffectedDashboardIds();
    let repairedDashboardCount: number = 0;

    for (const dashboardId of dashboardIds) {
      try {
        const dashboard: Dashboard | null = await DashboardService.findOneById({
          id: dashboardId,
          select: {
            _id: true,
            dashboardViewConfig: true,
          },
          props: {
            isRoot: true,
          },
        });

        const storedConfig: DashboardViewConfig | undefined =
          dashboard?.dashboardViewConfig;

        const repair: KubernetesClusterCpuTileRepairResult | null =
          KubernetesClusterCpuTileRepair.repair(storedConfig);

        if (!storedConfig || !repair) {
          continue;
        }

        await DashboardService.updateColumnsByIdWithoutHooks({
          id: dashboardId,
          data: {
            dashboardViewConfig:
              repair.config as unknown as DashboardViewConfig,
          },
          expectedData: {
            dashboardViewConfig: storedConfig,
          },
        });
        repairedDashboardCount++;
      } catch (err) {
        /*
         * One unwritable dashboard must not cost the rest their repair, nor
         * halt every migration queued behind this one.
         */
        logger.error(
          `Failed to repair the Kubernetes cluster CPU tile on dashboard ${dashboardId.toString()}:`,
        );
        logger.error(err);
      }
    }

    if (repairedDashboardCount > 0) {
      logger.info(
        `RepairKubernetesDashboardClusterCpuTile: rewrote the cluster CPU tile on ${repairedDashboardCount} dashboard(s) to the busiest node's peak CPU.`,
      );
    }
  }

  /*
   * Nothing is written while this pages, so the match stays put under the
   * walk and plain skip/limit paging over a stable id order sees every row.
   */
  private async findAffectedDashboardIds(): Promise<Array<ObjectID>> {
    const dashboardIds: Array<ObjectID> = [];
    let skip: number = 0;

    while (true) {
      const dashboards: Array<Dashboard> = await DashboardService.findBy({
        query: {
          dashboardViewConfig: QueryHelper.jsonContains(
            KubernetesClusterCpuTileRepair.getLegacyTileContainment(),
          ) as unknown as DashboardViewConfig,
        },
        select: {
          _id: true,
        },
        sort: { _id: SortOrder.Ascending },
        skip,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
        },
      });

      for (const dashboard of dashboards) {
        if (dashboard.id) {
          dashboardIds.push(dashboard.id);
        }
      }

      if (dashboards.length < LIMIT_MAX) {
        break;
      }

      skip += dashboards.length;
    }

    return dashboardIds;
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
