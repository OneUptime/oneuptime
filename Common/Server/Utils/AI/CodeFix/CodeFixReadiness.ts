import AIAgentService from "../../../Services/AIAgentService";
import LlmProviderService from "../../../Services/LlmProviderService";
import ProjectService from "../../../Services/ProjectService";
import SubjectCodeFixRun from "../SRE/SubjectCodeFixRun";
import AIAgent from "../../../../Models/DatabaseModels/AIAgent";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../../Models/DatabaseModels/Project";
import ObjectID from "../../../../Types/ObjectID";
import {
  AIFixReadiness,
  AIFixReadinessCheck,
} from "../../../../Types/AI/AIFixReadiness";
import { IsBillingEnabled } from "../../../EnvironmentConfig";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * The gates every CodeFix run passes through, in one place. Two surfaces ask
 * the question — the per-exception panel and the project-wide AI Tasks page —
 * and they differ only in how strict their repository gate is (see
 * AIFixReadinessCheckId). Sharing the LLM and agent checks is what keeps the
 * two from drifting into telling the user different stories.
 */
export default class CodeFixReadiness {
  /*
   * An LLM provider the agent may use. Agent completions are server-mediated
   * and metered, so the shared global provider is a valid fallback on cloud
   * too — a project-owned provider simply wins when one exists. A project
   * LLM provider is therefore NOT a prerequisite.
   *
   * The ok-state detail names the resolved provider and its scope: a user
   * running on the shared provider should be able to see that that is what
   * is happening without going to Settings.
   */
  @CaptureSpan()
  public static async getLlmProviderCheck(params: {
    projectId: ObjectID;
    /*
     * Overrides the IsBillingEnabled env flag for the balance check — exists
     * so tests can exercise both modes without mocking the module.
     */
    billingEnabled?: boolean | undefined;
  }): Promise<AIFixReadinessCheck> {
    const llmProvider: LlmProvider | null =
      await LlmProviderService.getLlmProviderForMeteredAgentPath(
        params.projectId,
      );

    if (!llmProvider) {
      return {
        id: "llmProvider",
        ok: false,
        title: "LLM provider",
        detail:
          "AI fix tasks need an LLM provider. Add one in Project Settings > AI > LLM Providers. Self-hosted instances can alternatively set the GLOBAL_LLM_PROVIDER_* environment variables to register a global provider for every project.",
      };
    }

    const providerName: string = llmProvider.name || "LLM provider";
    const isGlobal: boolean = llmProvider.isGlobalLlm || false;
    const isCosted: boolean =
      (llmProvider.costPerMillionTokensInUSDCents || 0) > 0;
    const billingEnabled: boolean = params.billingEnabled ?? IsBillingEnabled;

    /*
     * A resolved provider must also be PAYABLE, or the run passes readiness
     * here and dies at its first completion call instead. Mirrors the
     * billing gate in AIService.executeWithLogging: only a COSTED global
     * provider on cloud bills the project's AI balance per call —
     * project-owned and free-global providers consume no balance and must
     * not require one.
     */
    const isMetered: boolean = isGlobal && isCosted && billingEnabled;

    if (isMetered) {
      const project: Project | null = await ProjectService.findOneById({
        id: params.projectId,
        select: { aiCurrentBalanceInUSDCents: true },
        props: { isRoot: true },
      });

      if (!project || (project.aiCurrentBalanceInUSDCents || 0) <= 0) {
        return {
          id: "llmProvider",
          ok: false,
          title: "LLM provider",
          detail:
            "AI fix tasks would use the OneUptime-hosted LLM provider, which is billed against your AI balance — and the project's balance is empty. Recharge it in Project Settings > AI Credits, or add your own LLM provider in Project Settings > AI > LLM Providers.",
        };
      }
    }

    let detail: string = "";

    if (!isGlobal) {
      detail = `Using "${providerName}", this project's own provider. Tasks run on your API key and consume no AI credits.`;
    } else if (isMetered) {
      detail = `Using "${providerName}", the shared provider. Tasks are billed against this project's AI balance. Add your own provider in Settings to use your API key instead.`;
    } else {
      detail = `Using "${providerName}", a shared provider available to every project on this instance. No project provider is needed.`;
    }

    return {
      id: "llmProvider",
      ok: true,
      title: `LLM provider: ${providerName}`,
      detail,
    };
  }

  /*
   * The project-wide repository gate: at least one GitHub-App-connected
   * repository exists. This is the WEAKER claim — it deliberately says
   * nothing about whether a given exception's stack trace will match one.
   * Only GitHub is supported: the agent's clone/push path rejects every
   * other host (see AIAgentDataAPI's repositoryHostedAt guard).
   */
  @CaptureSpan()
  public static async getRepositoryConnectedCheck(params: {
    projectId: ObjectID;
  }): Promise<AIFixReadinessCheck> {
    const hasRepository: boolean =
      await SubjectCodeFixRun.hasGitHubAppConnectedRepository(params.projectId);

    return {
      id: "repositoryConnected",
      ok: hasRepository,
      title: "GitHub repository",
      detail: hasRepository
        ? "Connected through the GitHub App. The agent opens its fix pull requests here."
        : "AI opens its fixes as pull requests, so it needs a repository to push to. Connect one through the GitHub App — installing it imports all of its repositories automatically.",
    };
  }

  // An agent must be alive to pick the task up, or runs sit Queued forever.
  @CaptureSpan()
  public static async getAgentCheck(params: {
    projectId: ObjectID;
  }): Promise<AIFixReadinessCheck> {
    const anyAgent: AIAgent | null = await AIAgentService.getAIAgentForProject(
      params.projectId,
    );

    const isAlive: boolean = anyAgent
      ? AIAgentService.isAgentAlive(anyAgent)
      : false;

    if (isAlive) {
      return {
        id: "agentAvailable",
        ok: true,
        title: `AI agent online: ${anyAgent?.name || "agent"}`,
        detail: "Connected and polling for tasks.",
      };
    }

    return {
      id: "agentAvailable",
      ok: false,
      title: "AI agent online",
      detail: anyAgent
        ? `The AI agent "${anyAgent.name || "agent"}" has not reported in — check that its container is running.`
        : "No AI agent is available for this project. Self-hosted: create an agent under Settings > AI > AI Agents and run its container. Cloud: the shared fleet appears here automatically once enabled.",
    };
  }

  /*
   * Project-wide readiness for the AI Tasks page. Same LLM and agent gates
   * the per-exception check uses, with the any-repository gate in place of
   * per-exception stack-trace resolution.
   */
  @CaptureSpan()
  public static async getProjectReadiness(params: {
    projectId: ObjectID;
    billingEnabled?: boolean | undefined;
  }): Promise<AIFixReadiness> {
    const [repositoryCheck, llmCheck, agentCheck]: [
      AIFixReadinessCheck,
      AIFixReadinessCheck,
      AIFixReadinessCheck,
    ] = await Promise.all([
      this.getRepositoryConnectedCheck({ projectId: params.projectId }),
      this.getLlmProviderCheck({
        projectId: params.projectId,
        billingEnabled: params.billingEnabled,
      }),
      this.getAgentCheck({ projectId: params.projectId }),
    ]);

    /*
     * Ordered the way the user sets them up: connect a repo, point it at a
     * model, run the agent.
     */
    const checks: Array<AIFixReadinessCheck> = [
      repositoryCheck,
      llmCheck,
      agentCheck,
    ];

    return {
      ready: checks.every((check: AIFixReadinessCheck) => {
        return check.ok;
      }),
      checks,
    };
  }
}
