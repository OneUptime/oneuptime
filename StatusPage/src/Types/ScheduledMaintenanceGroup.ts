import type ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';
import type ScheduledMaintenancePublicNote from 'Model/Models/ScheduledMaintenancePublicNote';
import type ScheduledMaintenanceState from 'Model/Models/ScheduledMaintenanceState';
import type ScheduledMaintenanceStateTimeline from 'Model/Models/ScheduledMaintenanceStateTimeline';
import type StatusPageResource from 'Model/Models/StatusPageResource';

export default interface ScheduledMaintenanceGroup {
    scheduledMaintenance: ScheduledMaintenance;
    publicNotes?: Array<ScheduledMaintenancePublicNote>;
    scheduledMaintenanceState: ScheduledMaintenanceState;
    scheduledMaintenanceStateTimelines: Array<ScheduledMaintenanceStateTimeline>;
    scheduledEventResources: Array<StatusPageResource>;
}
