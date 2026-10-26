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
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import { CODE_AGENT_COMMAND_TOOL_NAME } from "../../../../Types/Runner/GlobalRunnerWork";
import { LLMToolDefinition } from "../../LLM/LLMService";
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

/*
 * Who a pair proved it is. A Runner identity with no project is a global
 * Runner (checkCredential makes one only of a row that is global and has no
 * project); every other identity has its project.
 */
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
 * What a route asks of a run for the identity (deniesAccessToRun): to hand
 * it something for the work, or to take its report about the work.
 */
export enum CodeFixRunAccess {
  /*
   * The run's details, its exception, its repositories, a repository token,
   * a completion, a review posted for it: only while the worker holds the
   * run.
   */
  Work = "work",
  // Progress, a pull request opened, how the run ended.
  Report = "report",
}

// What deniesAccessToRun reads of a run.
export interface CodeFixRunHoldFacts {
  projectId?: ObjectID | undefined;
  aiAgentId?: ObjectID | undefined;
  status?: AIRunStatus | string | undefined;
}

// The columns a run is read with for deniesAccessToRun.
export const CODE_FIX_RUN_HOLD_SELECT: {
  _id: true;
  projectId: true;
  aiAgentId: true;
  status: true;
} = {
  _id: true,
  projectId: true,
  aiAgentId: true,
  status: true,
};

// A repository's own commands, as a worker is handed them.
export interface CodeRepositoryCommands {
  setupCommand: string | null;
  buildCommand: string | null;
  testCommand: string | null;
}

/*
 * Resolves the aiAgentId/aiAgentKey pair every code-fix protocol request
 * carries. Two registries can hold the identity:
 *
 *   - Runner: every Runner. The dashboard issues a project's Runner its id
 *     and key, a master admin a global Runner's (the bundled one is kept
 *     from GLOBAL_RUNNER_KEY), and the Runner presents them on the code-fix
 *     protocol too — so the protocol must accept them.
 *   - AIAgent: the AI agents a project created before Runners replaced the
 *     agent container, which still take its repositories' work. An AI agent
 *     with no project - a global AI agent, from before global Runners took
 *     its work - proves nothing here.
 *
 * What an identity may then do is held to its project, and a global
 * Runner's - it serves every project - to the run it claimed
 * (deniesAccessToRun): the details, the exception, the repositories and the
 * repository token of that run, never another's. Nor is it ever handed a
 * repository's own commands or the code agent's command tool
 * (getRepositoryCommands, getOfferedTools): it runs no command.
 *
 * The Runner path is also where a Runner's code-fix capability is
 * enforced. A global Runner takes the code-fix work of every repository
 * that runs on the Global Runner (Types/Runner/CodeRepositoryRunner), as it
 * takes every project's JavaScript steps. A project's Runner takes code-fix
 * work exactly while AI works in a code repository of its project on it - a
 * repository picks it (its Runner setting in Code), or it is the project's
 * default Runner and a repository that picks none follows it
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
     * A key this repository ships never authenticates an agent or a Runner.
     * Every code-fix route authenticates here, and a real key is a long
     * random value, never a shipped one (the global Runner's GLOBAL_RUNNER_KEY
     * included: a shipped one turns it off), so refusing it here (before
     * either registry is read) never turns away a legitimate one, and the
     * rule holds on every code-fix route at once.
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
      /*
       * An AI agent with no project is a global AI agent - the shared
       * Runner's registration, or one a master admin added on the removed
       * Global AI Agents page - from before global Runners took the work it
       * did (GlobalAIAgentsGone): its key is right, but it proves nothing,
       * so it can never claim every project's runs or mint their
       * repositories' tokens again.
       */
      if (!aiAgent.projectId) {
        return { identity: null, agentId: agentId, isKeyRight: true };
      }

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
        isGlobalRunner: true,
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
      !RunnerServiceClass.isKubernetesAgentRunnerRow(runner)
    ) {
      /*
       * A global Runner takes the code-fix work of every repository on the
       * Global Runner. It belongs to no project, and neither does its
       * identity, so the claim and the data routes serve it across projects
       * by each repository's Runner choice, as they serve its JavaScript
       * steps.
       */
      if (runner.isGlobalRunner === true && !runner.projectId) {
        return {
          identity: {
            id: runner.id,
            source: CodeFixAgentSource.Runner,
          },
          agentId: agentId,
          isKeyRight: true,
        };
      }

      if (
        runner.projectId &&
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
   * (Types/Runner/CodeRepositoryRunner): a Runner with a project is one of
   * that project's Runners, and one with none a global Runner; an AI agent
   * is its project's own, from before Runners. checkCredential proves no
   * AI agent without a project; were one ever let through, it would be
   * served as a global Runner, never as an agent of every project.
   */
  public static getCodeWorker(identity: CodeFixAgentIdentity): CodeWorker {
    if (identity.source === CodeFixAgentSource.Runner) {
      return {
        kind: identity.projectId
          ? CodeWorkerKind.ProjectRunner
          : CodeWorkerKind.GlobalRunner,
        id: identity.id,
      };
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
   * Global identities (no projectId — a global Runner) serve every tenant.
   * Callers should answer a denial with the same "not found"
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

  /*
   * Whether the identity serves every project: a global Runner. Every other
   * identity has its project.
   */
  public static isGlobalIdentity(identity: CodeFixAgentIdentity): boolean {
    return !identity.projectId;
  }

  /*
   * Whether the identity may act for this run - or, true, it may not.
   *
   * A project's Runner, or an AI agent of a project's own, may act for any
   * code-fix run of its own project (deniesAccessToProject), as it always
   * could: every one of them is its project's.
   *
   * A global Runner serves every project, so it acts only for the run it
   * claimed (the claim writes its id on the run as aiAgentId) - never for
   * one another worker holds, one still waiting, or one of a project it
   * took nothing from. What it is handed for the work (the run's details,
   * its exception, its repositories and their tokens, a review posted for
   * it) is handed only while it still holds the run (CodeFixRunAccess.Work:
   * the run is Running); what it reports about the work it did (progress, a
   * pull request it opened, how the run ended) only needs the run to be one
   * it claimed (CodeFixRunAccess.Report), so a report it retries after the
   * run ended is answered as before rather than refused. A global Runner's
   * key - held on a host that runs every project's JavaScript steps, or on
   * one a master admin started - therefore reaches only the work it was
   * handed, never every project's runs, exceptions and repositories.
   *
   * Answered exactly like a missing run, so a probing key cannot tell
   * another worker's run from no run.
   */
  public static deniesAccessToRun(
    identity: CodeFixAgentIdentity,
    run: CodeFixRunHoldFacts,
    access: CodeFixRunAccess,
  ): boolean {
    if (CodeFixAgentAuth.deniesAccessToProject(identity, run.projectId)) {
      return true;
    }

    if (!CodeFixAgentAuth.isGlobalIdentity(identity)) {
      return false;
    }

    if (
      !run.projectId ||
      !run.aiAgentId ||
      run.aiAgentId.toString() !== identity.id.toString()
    ) {
      return true;
    }

    if (access === CodeFixRunAccess.Work) {
      return run.status !== AIRunStatus.Running;
    }

    return false;
  }

  /*
   * The repository's own setup, build and test commands, as a worker is
   * handed them with a repository - or none, for a global Runner. A global
   * Runner runs none of a repository's commands (the Runner's
   * Config.runsProjectAuthoredCommands), so it is never handed them either:
   * the rule holds on the server, whatever a Runner does with what it is
   * sent, as a global Runner is served JavaScript steps alone
   * (GlobalRunnerWork).
   */
  public static getRepositoryCommands(
    identity: CodeFixAgentIdentity,
    repository: {
      setupCommand?: string | undefined | null;
      buildCommand?: string | undefined | null;
      testCommand?: string | undefined | null;
    },
  ): CodeRepositoryCommands {
    if (CodeFixAgentAuth.isGlobalIdentity(identity)) {
      return { setupCommand: null, buildCommand: null, testCommand: null };
    }

    return {
      setupCommand: repository.setupCommand || null,
      buildCommand: repository.buildCommand || null,
      testCommand: repository.testCommand || null,
    };
  }

  /*
   * The tools the model is offered for the identity's code-fix run: those
   * the worker sent, less the code agent's command tool for a global
   * Runner, which runs no command a model composes. The Runner already
   * leaves the tool out there and refuses the call (InHouseCodeAgent); this
   * is the same rule on the server, so the model is never offered it.
   */
  public static getOfferedTools(
    identity: CodeFixAgentIdentity,
    tools: Array<LLMToolDefinition> | undefined,
  ): Array<LLMToolDefinition> | undefined {
    if (!tools || !CodeFixAgentAuth.isGlobalIdentity(identity)) {
      return tools;
    }

    return tools.filter((tool: LLMToolDefinition): boolean => {
      return tool.name !== CODE_AGENT_COMMAND_TOOL_NAME;
    });
  }
}
