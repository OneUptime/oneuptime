import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import ScheduledMaintenance from "Common/AppModels/Models/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "Common/AppModels/Models/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceState from "Common/AppModels/Models/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/AppModels/Models/ScheduledMaintenanceStateTimeline";
import StatusPageResource from "Common/AppModels/Models/StatusPageResource";

export default interface ScheduledMaintenanceGroup {
  scheduledMaintenance: ScheduledMaintenance;
  publicNotes?: Array<ScheduledMaintenancePublicNote>;
  scheduledMaintenanceState: ScheduledMaintenanceState;
  scheduledMaintenanceStateTimelines: Array<ScheduledMaintenanceStateTimeline>;
  scheduledEventResources: Array<StatusPageResource>;
  monitorsInGroup: Dictionary<Array<ObjectID>>;
}
