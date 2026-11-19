import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import ScheduledMaintenanceTemplateService from "../../Services/ScheduledMaintenanceTemplateService";
import { PickedStatusPagesRecordKind } from "./PickedStatusPagesReachBuilder";

/*
 * What a maintenance event, or a maintenance template, on the status pages
 * picked on its form does (Types/StatusPage/PickedStatusPagesReach), for
 * POST /scheduled-maintenance/reach and /scheduled-maintenance-template
 * /reach: whether one of them shows maintenance events, and whether one
 * that does tells its subscribers - or why not (#9920). Schedule
 * Maintenance Event's Subscriber Notifications line says it, and a
 * template's.
 *
 * Each is a kind of record whose form picks its status pages
 * (PickedStatusPagesReachBuilder, the one rule for every such form, an
 * announcement's included): a page shows maintenance events while Show
 * Maintenance Events is on (showScheduledMaintenanceEventsOnStatusPage),
 * as every maintenance notification job reads it, and who may ask is
 * decided for the event or the template as the form will save it - on
 * Create whoever may create it on those pages, on Edit whoever may update
 * it.
 *
 * The answer is the pages' alone. What the event's own settings do to each
 * moment - its visibility, its publish time, the three switches and its
 * reminders - the form works out from what it holds
 * (Types/ScheduledMaintenance/ScheduledMaintenanceSubscriberReach), so the
 * line follows them as they are changed, without asking again.
 */

const showsMaintenanceEvents: (statusPage: StatusPage) => boolean = (
  statusPage: StatusPage,
): boolean => {
  return Boolean(statusPage.showScheduledMaintenanceEventsOnStatusPage);
};

export const SCHEDULED_MAINTENANCE_RECORD: PickedStatusPagesRecordKind<ScheduledMaintenance> =
  {
    modelType: ScheduledMaintenance,
    service: ScheduledMaintenanceService,
    recordIdKey: "scheduledMaintenanceId",
    recordName: "maintenance event",
    showsRecord: showsMaintenanceEvents,
  };

export const SCHEDULED_MAINTENANCE_TEMPLATE_RECORD: PickedStatusPagesRecordKind<ScheduledMaintenanceTemplate> =
  {
    modelType: ScheduledMaintenanceTemplate,
    service: ScheduledMaintenanceTemplateService,
    recordIdKey: "scheduledMaintenanceTemplateId",
    recordName: "maintenance template",
    showsRecord: showsMaintenanceEvents,
  };
