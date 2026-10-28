import ObjectID from "../ObjectID";

export interface IncidentMemberRoleAssignment {
  roleId: ObjectID;
  userId: ObjectID;
}

export interface CriteriaIncident {
  title: string;
  description: string;
  incidentSeverityId?: ObjectID | undefined;
  autoResolveIncident?: boolean | undefined;
  remediationNotes?: string | undefined;
  id: string;
  onCallPolicyIds?: Array<ObjectID> | undefined;
  labelIds?: Array<ObjectID> | undefined;
  ownerTeamIds?: Array<ObjectID> | undefined;
  ownerUserIds?: Array<ObjectID> | undefined;
  incidentMemberRoles?: Array<IncidentMemberRoleAssignment> | undefined;
  showIncidentOnStatusPage?: boolean | undefined;
  isPrivate?: boolean | undefined;
}
