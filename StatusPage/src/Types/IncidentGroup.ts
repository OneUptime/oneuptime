import type Incident from 'Model/Models/Incident';
import type IncidentPublicNote from 'Model/Models/IncidentPublicNote';
import type IncidentSeverity from 'Model/Models/IncidentSeverity';
import type IncidentState from 'Model/Models/IncidentState';
import type IncidentStateTimeline from 'Model/Models/IncidentStateTimeline';
import type StatusPageResource from 'Model/Models/StatusPageResource';

export default interface IncidentGroup {
    incident: Incident;
    incidentSeverity: IncidentSeverity;
    publicNotes?: Array<IncidentPublicNote>;
    incidentState: IncidentState;
    incidentStateTimelines: Array<IncidentStateTimeline>;
    incidentResources: Array<StatusPageResource>;
}
