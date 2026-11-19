import ScheduledMaintenanceTemplate from "../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import ScheduledMaintenanceTemplateService, {
  Service as ScheduledMaintenanceTemplateServiceType,
} from "../Services/ScheduledMaintenanceTemplateService";
import { SCHEDULED_MAINTENANCE_TEMPLATE_RECORD } from "../Utils/StatusPage/ScheduledMaintenanceReachBuilder";
import BaseAPI from "./BaseAPI";
import PickedStatusPagesReachRoute from "./PickedStatusPagesReachRoute";

/*
 * A maintenance template's API: its CRUD routes, and whether an event made
 * from it on the status pages picked on its form shows on one of them and
 * notifies anyone (POST /scheduled-maintenance-template/reach,
 * Types/StatusPage/PickedStatusPagesReach) - what the template's
 * Subscriber Notifications line says (#9920).
 */
export default class ScheduledMaintenanceTemplateAPI extends BaseAPI<
  ScheduledMaintenanceTemplate,
  ScheduledMaintenanceTemplateServiceType
> {
  public constructor() {
    super(ScheduledMaintenanceTemplate, ScheduledMaintenanceTemplateService);

    PickedStatusPagesReachRoute.register({
      router: this.router,
      apiPath: new this.entityType().getCrudApiPath()?.toString() || "",
      answer: PickedStatusPagesReachRoute.answerFor(
        SCHEDULED_MAINTENANCE_TEMPLATE_RECORD,
      ),
    });
  }
}
