import DataMigrationBase from "./DataMigrationBase";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import DashboardService from "Common/Server/Services/DashboardService";
import logger from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import TemplateVariableResourceScopeRepair, {
  ScopedTemplateVariableSignature,
  TemplateVariableResourceScopeRepairResult,
} from "Common/Utils/Dashboard/TemplateVariableResourceScopeRepair";

/*
 * Gives the variable of a dashboard made from an infrastructure template -
 * Kubernetes, Kubernetes Cost, Hosts, Docker Swarm, Proxmox, VMware, XCP-ng,
 * OpenStack, Ceph, storage arrays - the kind of resource the template now
 * ships it with (issue #11258), so with nothing picked the board reads that
 * kind's telemetry, not the whole project's. Templates are copied into a
 * dashboard when it is created, so fixing the templates alone left every
 * existing board as it was. Which boards and variables:
 * TemplateVariableResourceScopeRepair (the template's own variable, on a
 * board that holds one of the template's own widgets).
 *
 * Postgres selects the candidates by jsonb containment, one variable
 * signature at a time, so only dashboards holding such a variable are read.
 * Their ids are collected first and each dashboard is then read and written
 * on its own, as RepairKubernetesDashboardClusterCpuTile does: a repaired
 * board still matches the containment, so collecting first is what keeps
 * paging stable, and one config in memory at a time keeps a large table
 * cheap.
 *
 * The write is a compare-and-set on the whole config, so a board a user
 * saves while this runs keeps their save. Hook-free: nobody is editing the
 * board, only its stored variable is named.
 *
 * Idempotent, and safe to run twice at once: a named variable is left as it
 * is, and two passes writing the same repair cannot disagree.
 */
export default class ScopeTemplateDashboardVariablesToTheirResources extends DataMigrationBase {
  public constructor() {
    super("ScopeTemplateDashboardVariablesToTheirResources");
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

        const repair: TemplateVariableResourceScopeRepairResult | null =
          TemplateVariableResourceScopeRepair.repair(storedConfig);

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
          `Failed to name the resource kind of the template variable on dashboard ${dashboardId.toString()}:`,
        );
        logger.error(err);
      }
    }

    if (repairedDashboardCount > 0) {
      logger.info(
        `ScopeTemplateDashboardVariablesToTheirResources: named the resource kind of the template variable on ${repairedDashboardCount} dashboard(s).`,
      );
    }
  }

  /*
   * Nothing is written while this pages, so each match stays put under the
   * walk and plain skip/limit paging over a stable id order sees every row.
   */
  private async findCandidateDashboardIds(): Promise<Array<ObjectID>> {
    const dashboardIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const signature of TemplateVariableResourceScopeRepair.getScopedTemplateVariables() as Array<ScopedTemplateVariableSignature>) {
      let skip: number = 0;

      while (true) {
        const dashboards: Array<Dashboard> = await DashboardService.findBy({
          query: {
            dashboardViewConfig: QueryHelper.jsonContains(
              TemplateVariableResourceScopeRepair.getContainment(signature),
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
            dashboardIds.set(dashboard.id.toString(), dashboard.id);
          }
        }

        if (dashboards.length < LIMIT_MAX) {
          break;
        }

        skip += dashboards.length;
      }
    }

    return Array.from(dashboardIds.values());
  }

  public override async rollback(): Promise<void> {
    // A variable's Resource Type is taken off again in the Variables dialog.
    return;
  }
}
