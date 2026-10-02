import DataMigrationBase from "./DataMigrationBase";
import AlertGroupingRuleService from "Common/Server/Services/AlertGroupingRuleService";
import AlertMeasurementService from "Common/Server/Services/AlertMeasurementService";
import AlertReminderRuleService from "Common/Server/Services/AlertReminderRuleService";
import AlertSeverityService from "Common/Server/Services/AlertSeverityService";
import AlertStateService from "Common/Server/Services/AlertStateService";
import DatabaseService from "Common/Server/Services/DatabaseService";
import IncidentCustomFieldService from "Common/Server/Services/IncidentCustomFieldService";
import IncidentGroupingRuleService from "Common/Server/Services/IncidentGroupingRuleService";
import IncidentMeasurementService from "Common/Server/Services/IncidentMeasurementService";
import IncidentReminderRuleService from "Common/Server/Services/IncidentReminderRuleService";
import IncidentSeverityService from "Common/Server/Services/IncidentSeverityService";
import IncidentSlaRuleService from "Common/Server/Services/IncidentSlaRuleService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
import IncomingCallPolicyEscalationRuleService from "Common/Server/Services/IncomingCallPolicyEscalationRuleService";
import LogDropFilterService from "Common/Server/Services/LogDropFilterService";
import LogPipelineProcessorService from "Common/Server/Services/LogPipelineProcessorService";
import LogPipelineService from "Common/Server/Services/LogPipelineService";
import LogScrubRuleService from "Common/Server/Services/LogScrubRuleService";
import MetricPipelineRuleService from "Common/Server/Services/MetricPipelineRuleService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import NetworkDeviceRoleService from "Common/Server/Services/NetworkDeviceRoleService";
import NetworkSiteAssignmentRuleService from "Common/Server/Services/NetworkSiteAssignmentRuleService";
import ScheduledMaintenanceMeasurementService from "Common/Server/Services/ScheduledMaintenanceMeasurementService";
import ScheduledMaintenanceReminderRuleService from "Common/Server/Services/ScheduledMaintenanceReminderRuleService";
import ScheduledMaintenanceStateService from "Common/Server/Services/ScheduledMaintenanceStateService";
import StatusPageFooterLinkService from "Common/Server/Services/StatusPageFooterLinkService";
import StatusPageHeaderLinkService from "Common/Server/Services/StatusPageHeaderLinkService";
import StatusPageHistoryChartBarColorRuleService from "Common/Server/Services/StatusPageHistoryChartBarColorRuleService";
import TraceDropFilterService from "Common/Server/Services/TraceDropFilterService";
import TracePipelineProcessorService from "Common/Server/Services/TracePipelineProcessorService";
import TracePipelineService from "Common/Server/Services/TracePipelineService";
import TraceScrubRuleService from "Common/Server/Services/TraceScrubRuleService";
import logger from "Common/Server/Utils/Logger";

/*
 * Numbers the drag-ordered lists that need it 1..n (n..1 for a list whose top
 * is its highest number), in the order each one is shown in today.
 *
 * The lists these services own are now reordered by dragging rows, and a drop
 * sends the number of the row it landed on - which only says where it landed
 * when no two rows of the list share a number. Lists saved before the server
 * kept the numbers are often not like that: the dashboard saved every log
 * pipeline, drop filter and scrub rule with 1, and incident custom fields and
 * device roles could have no number at all. A drop onto a row that shares its
 * number with the dragged one would do nothing.
 *
 * Only a list with a row without a number, or two rows with the same one, is
 * renumbered. A list whose numbers are already unique - gaps and all, as an
 * API or Terraform caller may have written them - is left exactly as it is.
 * Every later create and move keeps the numbers unique on its own
 * (DatabaseService, @ListOrderColumn). The order a list is shown in is kept:
 * by number, rows without one last, ties broken by the older row first.
 *
 * Idempotent, and safe to run twice at once: a list it has fixed needs no
 * fixing the second time, and two runs compute the same numbers. A table that
 * fails is logged and skipped - a list that keeps its old numbers still shows
 * every row - so it never halts the migrations after it.
 */
export default class NormalizeListOrder extends DataMigrationBase {
  public constructor() {
    super("NormalizeListOrder");
  }

  // Every service whose model is a drag-ordered list (@ListOrderColumn).
  public static getServices(): Array<DatabaseService<any>> {
    return [
      IncidentCustomFieldService,
      IncidentMeasurementService,
      AlertMeasurementService,
      ScheduledMaintenanceMeasurementService,
      IncidentReminderRuleService,
      AlertReminderRuleService,
      ScheduledMaintenanceReminderRuleService,
      IncidentSlaRuleService,
      IncidentGroupingRuleService,
      AlertGroupingRuleService,
      NetworkDeviceRoleService,
      NetworkSiteAssignmentRuleService,
      LogPipelineService,
      LogPipelineProcessorService,
      LogDropFilterService,
      LogScrubRuleService,
      TracePipelineService,
      TracePipelineProcessorService,
      TraceDropFilterService,
      TraceScrubRuleService,
      MetricPipelineRuleService,
      StatusPageHeaderLinkService,
      StatusPageFooterLinkService,
      StatusPageHistoryChartBarColorRuleService,
      IncomingCallPolicyEscalationRuleService,
      /*
       * A project's states, severities and monitor statuses. Their numbers
       * were kept unique per project before they were dragged, so this only
       * ever heals a list two concurrent creates left with a shared number.
       */
      IncidentStateService,
      AlertStateService,
      ScheduledMaintenanceStateService,
      MonitorStatusService,
      IncidentSeverityService,
      AlertSeverityService,
    ] as Array<DatabaseService<any>>;
  }

  public override async migrate(): Promise<void> {
    for (const service of NormalizeListOrder.getServices()) {
      const tableName: string =
        service.getModel().tableName || service.getModel().constructor.name;

      try {
        const result: { lists: number; rowsChanged: number } =
          await service.normalizeListOrders();

        logger.info(
          `NormalizeListOrder: ${tableName}: renumbered ${result.rowsChanged} row(s) in ${result.lists} list(s).`,
        );
      } catch (err) {
        logger.error(
          `NormalizeListOrder: could not renumber ${tableName}: ${(err as Error)?.message || err}`,
        );
      }
    }
  }

  public override async rollback(): Promise<void> {
    // Nothing to undo: the lists are shown in the same order as before.
    return;
  }
}
