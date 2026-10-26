import AIAgentService from "../../../Services/AIAgentService";
import RunnerService, {
  Service as RunnerServiceClass,
} from "../../../Services/RunnerService";
import { isShippedSecretValue } from "../../../EnvironmentConfig";
import { ExpressRequest, ExpressResponse } from "../../Express";
import Response from "../../Response";
import WrongComponentKeyLimit, {
  ComponentKeyKind,
} from "../../RateLimit/WrongComponentKeyLimit";
import { WrongKeyRefusal } from "../../RateLimit/WrongKeyLimit";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import BadDataException from "../../../../Types/Exception/BadDataException";
import AIAgent from "../../../../Models/DatabaseModels/AIAgent";
import Runner from "../../../../Models/DatabaseModels/Runner";
import {
  CodeWorker,
  CodeWorkerKind,
} from "../../../../Types/Runner/CodeRepositoryRunner";
import CodeRepositoryRunnerChoice from "./CodeRepositoryRunnerChoice";

// What every code-fix route answers a pair that proves no code-fix identity.
export const INVALID_CODE_FIX_AGENT_MESSAGE: string =
  "Invalid AI Agent ID or AI Agent Key";

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
 * What a pair proved: the code-fix identity, when it may do code-fix work;
 * the id it named, when it named one; and whether its key is the key of the
 * AI agent or Runner of that id, whether or not that one may do code-fix
 * work.
 */
export interface CodeFixCredentialCheck {
  identity: CodeFixAgentIdentity | null;
  agentId: ObjectID | null;
  isKeyRight: boolean;
}

/*
 * Resolves the aiAgentId/aiAgentKey pair every code-fix protocol request
 * carries. Two registries can hold the identity:
 *
 *   - AIAgent: the in-cluster fleet (cluster-key auto-registration) and any
 *     legacy per-project agents created before the Runner merge.
 *   - Runner: the unified OneUptime Runner customers install. The
 *     dashboard issues its id + key from this table, and the Runner presents
 *     them on the code-fix protocol too — so the protocol must accept them.
 *
 * The Runner path is also where a Runner's code-fix capability is
 * enforced: a project's Runner takes code-fix work exactly while AI works
 * in a code repository of its project on it - a repository picks it (its
 * Runner setting in Code), or it is the project's default Runner and a
 * repository that picks none follows it
 * (CodeRepositoryRunnerChoice.doesRunnerWorkInARepository). One no
 * repository works on authenticates like any other invalid credential — it
 * cannot claim work, fetch task data, or mint repository tokens, no matter
 * what its container env vars say.
 *
 * A kubernetes-agent Runner never authenticates here, whatever picks it.
 * Its row is minted and re-keyed with the project's telemetry ingestion
 * key, a credential every collector and CI job holds, so a code-fix
 * identity on it would let anyone with that key claim code-fix work and
 * mint repository tokens. CodeRepositoryService refuses to let a repository
 * pick such a row, but a row picked before it became an agent row stays
 * picked; the one agent-row rule (RunnerService's
 * isKubernetesAgentRunnerRow: the server-owned name marker, or an agent
 * posture) is applied here too.
 *
 * Every code-fix route authenticates a request through authenticate, which
 * also counts the different wrong keys a client presents for an agent or a
 * Runner (WrongComponentKeyLimit): a client that sent too many is refused
 * for that agent, whichever key it carries, until its window ends - before
 * either registry is read.
 */
export default class CodeFixAgentAuth {
  /*
   * Authenticates a code-fix protocol request by the aiAgentId/aiAgentKey
   * pair its body carries: the identity it proves, or null once the request
   * is answered - 400 for a pair that proves no code-fix identity, 429 for a
   * client that sent too many different wrong keys for that agent or Runner.
   */
  public static async authenticate(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<CodeFixAgentIdentity | null> {
    const data: JSONObject =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? (req.body as JSONObject)
        : {};

    /*
     * A client that sent too many different wrong keys for this agent or
     * Runner is refused before either registry is read.
     */
    const presentedAgentId: ObjectID | null =
      CodeFixAgentAuth.getPresentedAgentId(data);

    if (presentedAgentId) {
      const refusedBeforeLookup: WrongKeyRefusal | null =
        await WrongComponentKeyLimit.checkBeforeLookup({
          req: req,
          kind: ComponentKeyKind.Agent,
          componentId: presentedAgentId.toString(),
        });

      if (refusedBeforeLookup) {
        WrongComponentKeyLimit.answerRefusal(
          req,
          res,
          ComponentKeyKind.Agent,
          refusedBeforeLookup,
        );

        return null;
      }
    }

    const check: CodeFixCredentialCheck =
      await CodeFixAgentAuth.checkCredential(data);

    const agentId: ObjectID | null = check.agentId;

    if (agentId) {
      const refusal: WrongKeyRefusal | null =
        await WrongComponentKeyLimit.checkComponentKey({
          req: req,
          kind: ComponentKeyKind.Agent,
          componentId: agentId.toString(),
          presentedKey: data["aiAgentKey"],
          isKeyRight: check.isKeyRight,
          componentExists: async (): Promise<boolean> => {
            return await CodeFixAgentAuth.agentOrRunnerExists(agentId);
          },
        });

      if (refusal) {
        WrongComponentKeyLimit.answerRefusal(
          req,
          res,
          ComponentKeyKind.Agent,
          refusal,
        );

        return null;
      }
    }

    if (!check.identity) {
      Response.sendErrorResponse(
        req,
        res,
        new BadDataException(INVALID_CODE_FIX_AGENT_MESSAGE),
      );

      return null;
    }

    return check.identity;
  }

  // The identity a pair proves, or null.
  public static async resolveAgentIdentity(
    data: JSONObject,
  ): Promise<CodeFixAgentIdentity | null> {
    return (await CodeFixAgentAuth.checkCredential(data)).identity;
  }

  // What a pair proves (CodeFixCredentialCheck).
  public static async checkCredential(
    data: JSONObject,
  ): Promise<CodeFixCredentialCheck> {
    const agentId: ObjectID | null = CodeFixAgentAuth.getPresentedAgentId(data);

    if (!agentId) {
      return { identity: null, agentId: null, isKeyRight: false };
    }

    const agentKey: string = data["aiAgentKey"] as string;

    /*
     * A key this repository ships never authenticates an agent. The
     * in-cluster fleet's global agent registers with ONEUPTIME_RUNNER_KEY,
     * which config.example.env ships as a placeholder, and every code-fix
     * route authenticates here. A real agent or Runner key is a long random
     * value, never a shipped one, so refusing it here (before either registry
     * is read) never turns away a legitimate agent, and the rule holds on
     * every code-fix route at once.
     */
    if (isShippedSecretValue(agentKey)) {
      return { identity: null, agentId: agentId, isKeyRight: false };
    }

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
        identity: {
          id: aiAgent.id,
          projectId: aiAgent.projectId,
          source: CodeFixAgentSource.AIAgent,
        },
        agentId: agentId,
        isKeyRight: true,
      };
    }

    const runner: Runner | null = await RunnerService.findOneBy({
      query: {
        _id: agentId.toString(),
        key: agentKey,
      },
      select: {
        _id: true,
        projectId: true,
        // What the agent-row rule reads.
        name: true,
        hostInfo: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (
      runner &&
      runner.id &&
      !RunnerServiceClass.isKubernetesAgentRunnerRow(runner) &&
      (await CodeRepositoryRunnerChoice.doesRunnerWorkInARepository(runner))
    ) {
      return {
        identity: {
          id: runner.id,
          projectId: runner.projectId,
          source: CodeFixAgentSource.Runner,
        },
        agentId: agentId,
        isKeyRight: true,
      };
    }

    /*
     * A Runner whose key this is, but that may not do code-fix work: no
     * identity here, though the key is right, so it is never counted as a
     * wrong one.
     */
    return {
      identity: null,
      agentId: agentId,
      isKeyRight: Boolean(runner),
    };
  }

  /*
   * The id a pair names, when the pair names one and carries a key; null
   * otherwise.
   */
  public static getPresentedAgentId(data: JSONObject): ObjectID | null {
    if (!data["aiAgentId"] || !data["aiAgentKey"]) {
      return null;
    }

    try {
      return new ObjectID(data["aiAgentId"] as string);
    } catch {
      return null;
    }
  }

  /*
   * Whether an AI agent or a Runner has this id: asked only for a key that
   * matched neither, so that a wrong key is counted only for one there is.
   */
  public static async agentOrRunnerExists(agentId: ObjectID): Promise<boolean> {
    return (
      (await AIAgentService.hasAIAgentWithId(agentId)) ||
      (await RunnerService.hasRunnerWithId(agentId))
    );
  }

  /*
   * Who the identity is, for the repositories' Runner choice
   * (Types/Runner/CodeRepositoryRunner): a Runner row is one of its
   * project's Runners; an AI agent with no project is a global Runner for
   * code (the installation's bundled Runner, OneUptime Cloud's fleet); one
   * with a project is that project's own, from before Runners.
   */
  public static getCodeWorker(identity: CodeFixAgentIdentity): CodeWorker {
    if (identity.source === CodeFixAgentSource.Runner) {
      return { kind: CodeWorkerKind.ProjectRunner, id: identity.id };
    }

    return {
      kind: identity.projectId
        ? CodeWorkerKind.ProjectAgent
        : CodeWorkerKind.GlobalRunner,
      id: identity.id,
    };
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
