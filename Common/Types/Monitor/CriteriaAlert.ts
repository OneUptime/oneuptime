import ObjectID from "../ObjectID";
import Zod, { ZodSchema } from "../../Utils/Schema/Zod";

export interface CriteriaAlert {
  title: string;
  description: string;
  alertSeverityId?: ObjectID | undefined;
  autoResolveAlert?: boolean | undefined;
  remediationNotes?: string | undefined;
  id: string;
  onCallPolicyIds?: Array<ObjectID> | undefined;
}

export const CriteriaAlertSchema: ZodSchema = Zod.object({
  title: Zod.string(),
  description: Zod.string(),
  alertSeverityId: Zod.any().optional(),
  autoResolveAlert: Zod.boolean().optional(),
  remediationNotes: Zod.string().optional(),
  id: Zod.string(),
  onCallPolicyIds: Zod.array(Zod.any()).optional(),
});
