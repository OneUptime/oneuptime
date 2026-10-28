import ObjectID from "../ObjectID";

export interface CriteriaAlert {
  title: string;
  description: string;
  alertSeverityId?: ObjectID | undefined;
  autoResolveAlert?: boolean | undefined;
  remediationNotes?: string | undefined;
  id: string;
  onCallPolicyIds?: Array<ObjectID> | undefined;
  labelIds?: Array<ObjectID> | undefined;
  ownerTeamIds?: Array<ObjectID> | undefined;
  ownerUserIds?: Array<ObjectID> | undefined;
  isPrivate?: boolean | undefined;
}
