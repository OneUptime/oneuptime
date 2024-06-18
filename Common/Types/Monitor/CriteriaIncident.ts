import ObjectID from "../ObjectID";

export interface CriteriaIncident {
  title: string;
  description: string;
  incidentSeverityId?: ObjectID | undefined;
  autoResolveIncident?: boolean | undefined;
  remediationNotes?: string | undefined;
  id: string;
  onCallPolicyIds?: Array<ObjectID> | undefined;
}
