import AIAgentService from "../../../Services/AIAgentService";
import RunbookAgentService from "../../../Services/RunbookAgentService";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import AIAgent from "../../../../Models/DatabaseModels/AIAgent";
import RunbookAgent from "../../../../Models/DatabaseModels/RunbookAgent";

/*
 * Which registry the presented credentials matched. Consumers that write the
 * agent id into a column with a real foreign key to the AIAgent table (e.g.
 * AIAgentTaskPullRequest.aiAgentId) must only do so for an AIAgent identity —
 * a Runner id would violate the constraint.
 */
export enum CodeFixAgentSource {
  AIAgent = "AIAgent",
  Runner = "Runner",
}

export interface CodeFixAgentIdentity {
  id: ObjectID;
  projectId?: ObjectID | undefined;
  source: CodeFixAgentSource;
}

/*
 * Resolves the aiAgentId/aiAgentKey pair every code-fix protocol request
 * carries. Two registries can hold the identity:
 *
 *   - AIAgent: the in-cluster fleet (cluster-key auto-registration) and any
 *     legacy per-project agents created before the Runner merge.
 *   - RunbookAgent: the unified OneUptime Runner customers install. The
 *     dashboard issues its id + key from this table, and the Runner presents
 *     them on the code-fix protocol too — so the protocol must accept them.
 *
 * The RunbookAgent path is also where the canRunCodeFixTasks capability is
 * enforced: a Runner whose code-fix capability was revoked in the dashboard
 * authenticates like any other invalid credential — it cannot claim work,
 * fetch task data, or mint repository tokens, no matter what its container
 * env vars say.
 */
export default class CodeFixAgentAuth {
  public static async resolveAgentIdentity(
    data: JSONObject,
  ): Promise<CodeFixAgentIdentity | null> {
    if (!data["aiAgentId"] || !data["aiAgentKey"]) {
      return null;
    }

    let agentId: ObjectID;

    try {
      agentId = new ObjectID(data["aiAgentId"] as string);
    } catch {
      return null;
    }

    const agentKey: string = data["aiAgentKey"] as string;

    const aiAgent: AIAgent | null = await AIAgentService.findOneBy({
      query: {
        _id: agentId.toString(),
        key: agentKey,
      },
      select: {
        _id: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (aiAgent && aiAgent.id) {
      return {
        id: aiAgent.id,
        projectId: aiAgent.projectId,
        source: CodeFixAgentSource.AIAgent,
      };
    }

    const runner: RunbookAgent | null = await RunbookAgentService.findOneBy({
      query: {
        _id: agentId.toString(),
        key: agentKey,
      },
      select: {
        _id: true,
        projectId: true,
        canRunCodeFixTasks: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (runner && runner.id && runner.canRunCodeFixTasks === true) {
      return {
        id: runner.id,
        projectId: runner.projectId,
        source: CodeFixAgentSource.Runner,
      };
    }

    return null;
  }

  /*
   * A project-scoped identity may only touch resources of its own project.
   * Global identities (no projectId — the in-cluster fleet) serve every
   * tenant. Callers should answer a denial with the same "not found"
   * response they give for a missing resource, so a probing key cannot
   * distinguish "exists in another tenant" from "does not exist".
   */
  public static deniesAccessToProject(
    identity: CodeFixAgentIdentity,
    resourceProjectId: ObjectID | undefined,
  ): boolean {
    if (!identity.projectId) {
      return false;
    }

    if (!resourceProjectId) {
      return true;
    }

    return identity.projectId.toString() !== resourceProjectId.toString();
  }
}
