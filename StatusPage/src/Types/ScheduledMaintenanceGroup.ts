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
}
