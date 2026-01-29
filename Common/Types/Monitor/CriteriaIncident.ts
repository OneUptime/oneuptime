import ObjectID from "../ObjectID";
import Zod, { ZodSchema } from "../../Utils/Schema/Zod";

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
}

export const CriteriaIncidentSchema: ZodSchema = Zod.object({
  title: Zod.string(),
  description: Zod.string(),
  incidentSeverityId: Zod.any().optional(),
  autoResolveIncident: Zod.boolean().optional(),
  remediationNotes: Zod.string().optional(),
  id: Zod.string(),
  onCallPolicyIds: Zod.array(Zod.any()).optional(),
  labelIds: Zod.array(Zod.any()).optional(),
  ownerTeamIds: Zod.array(Zod.any()).optional(),
  ownerUserIds: Zod.array(Zod.any()).optional(),
});
