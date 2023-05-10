import ObjectID from '../ObjectID';

export interface CriteriaIncident {
    title: string;
    description: string;
    incidentSeverityId?: ObjectID | undefined;
}
