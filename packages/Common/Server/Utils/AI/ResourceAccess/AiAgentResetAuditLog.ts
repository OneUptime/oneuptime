import AuditLogService from "../../../Services/AuditLogService";
import DatabaseService from "../../../Services/DatabaseService";
import logger from "../../Logger";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * A RESOURCE'S AI AGENT RESET, IN THE AUDIT LOG (issue #6302).
 *
 * Reset agent - on a host's, a container host's, a cluster's, a cloud
 * account's, a Kubernetes cluster's AI agent page - ends the agent's key at
 * once, for the real agent and whatever else held it. The key lives in the
 * agent's own row (ResourceAiAgent, KubernetesAiAgent), which is what the
 * agent reports, rewritten each time it registers and checks in, so the
 * audit log leaves it out (AUDIT_LOG_EXEMPT_TABLES): a reset recorded
 * nothing at all.
 *
 * So the reset is recorded on the resource the agent works for, which has
 * an Audit Logs page of its own. Its aiAgentResetAt - only OneUptime writes
 * it - is stamped with when, and an Update entry names that column, by
 * whoever reset the agent: their props, from the route. No key and no hash
 * is in the entry: the agent's row is not recorded, a cloud account's keys
 * are not named, and the resource is read for its name and project only.
 * What agents report stays out as before.
 *
 * The reset itself is done by then. Recording it never undoes it nor fails
 * it, as no audit entry ever fails the change it records: a failure is
 * logged.
 */

// The column a reset's entry names.
export const AI_AGENT_RESET_AUDIT_COLUMNS: ReadonlyArray<string> = [
  "aiAgentResetAt",
];

export default class AiAgentResetAuditLog {
  public static async record<TModel extends BaseModel>(data: {
    // The resource's own service: a host's, a cluster's, a cloud account's.
    service: DatabaseService<TModel>;
    resourceId: ObjectID;
    resetAt: Date;
    // Who reset it; none for OneUptime's own, a system event.
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<void> {
    try {
      // The resource as it was: what names it, its project, its last reset.
      const before: TModel | null = await data.service.findOneById({
        id: data.resourceId,
        select: {
          _id: true,
          projectId: true,
          name: true,
          aiAgentResetAt: true,
        } as never,
        props: { isRoot: true },
      });

      if (!before || !before.id) {
        return;
      }

      // Hook-free: the resource's own update hooks would write an "updated" feed item of their own.
      await data.service.updateColumnsByIdWithoutHooks({
        id: before.id,
        data: { aiAgentResetAt: data.resetAt } as never,
      });

      await AuditLogService.recordUpdate({
        model: new data.service.modelType(),
        before: before,
        updatedFields: {
          aiAgentResetAt: data.resetAt,
        } as unknown as JSONObject,
        itemId: before.id,
        props: data.props || { isRoot: true },
        includeColumns: [...AI_AGENT_RESET_AUDIT_COLUMNS],
      });
    } catch (error) {
      logger.error(
        `AI agent reset: could not record the reset of ${data.service.getModel().singularName || "a resource"} ${data.resourceId.toString()} on the resource: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
