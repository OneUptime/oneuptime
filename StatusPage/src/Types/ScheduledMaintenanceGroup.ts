import Dictionary from 'Common/Types/Dictionary';
import ObjectID from 'Common/Types/ObjectID';
import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';
import ScheduledMaintenancePublicNote from 'Model/Models/ScheduledMaintenancePublicNote';
import ScheduledMaintenanceState from 'Model/Models/ScheduledMaintenanceState';
import ScheduledMaintenanceStateTimeline from 'Model/Models/ScheduledMaintenanceStateTimeline';
import StatusPageResource from 'Model/Models/StatusPageResource';

export default interface ScheduledMaintenanceGroup {
    scheduledMaintenance: ScheduledMaintenance;
    publicNotes?: Array<ScheduledMaintenancePublicNote>;
    scheduledMaintenanceState: ScheduledMaintenanceState;
    scheduledMaintenanceStateTimelines: Array<ScheduledMaintenanceStateTimeline>;
    scheduledEventResources: Array<StatusPageResource>;
    monitorsInGroup: Dictionary<Array<ObjectID>>;
}
