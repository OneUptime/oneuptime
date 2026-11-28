import DataMigrationBase from "./DataMigrationBase";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import DashboardService from "Common/Server/Services/DashboardService";
import logger from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import HostsDashboardChartGroupingRepair, {
  HostsDashboardChartGroupingRepairResult,
} from "Common/Utils/Dashboard/HostsDashboardChartGroupingRepair";

/*
 * The Hosts Dashboard's charts by host, on a dashboard made from the
 * template before they grouped by the key hosts' rows carry: each drew
 * every host as one unnamed line, and now draws one line per host. Which
 * charts, and why only those: HostsDashboardChartGroupingRepair.
 *
 * Postgres selects the candidates by jsonb containment, so only dashboards
 * holding a chart grouped by `host.name` are read. Their ids are collected
 * first and each dashboard is then read and written on its own, as
 * ScopeTemplateDashboardVariablesToTheirResources does. The write is a
 * compare-and-set on the whole config, so a dashboard a person saves while
 * this runs keeps their save. Hook-free: nobody is editing the dashboard.
 *
 * Idempotent, and safe to run twice at once: a regrouped chart no longer
 * matches, and two passes writing the same repair cannot disagree.
 */
export default class GroupHostsDashboardChartsByHost extends DataMigrationBase {
  public constructor() {
    super("GroupHostsDashboardChartsByHost");
  }

  public override async migrate(): Promise<void> {
    const dashboardIds: Array<ObjectID> =
      await this.findCandidateDashboardIds();
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

        const repair: HostsDashboardChartGroupingRepairResult | null =
          HostsDashboardChartGroupingRepair.repair(storedConfig);

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
          `Failed to group the Hosts Dashboard's charts by host on dashboard ${dashboardId.toString()}:`,
        );
        logger.error(err);
      }
    }

    if (repairedDashboardCount > 0) {
      logger.info(
        `GroupHostsDashboardChartsByHost: grouped the Hosts Dashboard's charts by host on ${repairedDashboardCount} dashboard(s).`,
      );
    }
  }

  /*
   * Nothing is written while this pages, so each match stays put under the
   * walk and plain skip/limit paging over a stable id order sees every row.
   */
  private async findCandidateDashboardIds(): Promise<Array<ObjectID>> {
    const dashboardIds: Array<ObjectID> = [];
    let skip: number = 0;

    while (true) {
      const dashboards: Array<Dashboard> = await DashboardService.findBy({
        query: {
          dashboardViewConfig: QueryHelper.jsonContains(
            HostsDashboardChartGroupingRepair.getContainment(),
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
    // A chart's grouping is changed back in its settings.
    return;
  }
}
