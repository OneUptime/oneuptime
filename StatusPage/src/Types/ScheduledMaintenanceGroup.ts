import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";

export default interface ScheduledMaintenanceGroup {
  scheduledMaintenance: ScheduledMaintenance;
  publicNotes?: Array<ScheduledMaintenancePublicNote>;
  scheduledMaintenanceState: ScheduledMaintenanceState;
  scheduledMaintenanceStateTimelines: Array<ScheduledMaintenanceStateTimeline>;
  scheduledEventResources: Array<StatusPageResource>;
  monitorsInGroup: Dictionary<Array<ObjectID>>;
}
