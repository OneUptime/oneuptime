import AIBillingService from "../../../Services/AIBillingService";
import LlmProviderService from "../../../Services/LlmProviderService";
import ProjectService from "../../../Services/ProjectService";
import SubjectCodeFixRun from "../SRE/SubjectCodeFixRun";
import CodeRepositoryRunnerChoice, {
  CodeRepositoryRunnerFactsRow,
  CodeRepositoryRunnerStatus,
} from "./CodeRepositoryRunnerChoice";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../../Models/DatabaseModels/Project";
import ObjectID from "../../../../Types/ObjectID";
import {
  AIFixReadiness,
  AIFixReadinessCheck,
} from "../../../../Types/AI/AIFixReadiness";
import { IsBillingEnabled } from "../../../EnvironmentConfig";
import AutoRechargeState from "../../../../Types/Billing/AutoRechargeState";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  getProjectBalanceWhoCanAddSentence,
  ProjectBalanceType,
} from "../../../../Utils/Project/ProjectBalance";
import { CodeRepositoryRunnerChoiceKind } from "../../../../Types/Runner/CodeRepositoryRunner";
import {
  CodeTaskBlocker,
  CodeTaskBlockerType,
} from "../../../../Types/AI/CodeTask";

/*
 * Why nothing can do a repository's AI work now, by what its Runner setting
 * in Code picks (CodeRepositoryRunnerChoice.getStatusForRepository): the
 * words the exception page's checklist, Code's gate and the queue sweeper
 * say it in.
 */
export const NO_GLOBAL_RUNNER_ONLINE_DETAIL: string =
  "No global Runner is online to work in this repository. Pick one of your Runners for it in the repository's settings in Code, or try again once the global Runner is back.";

/*
 * Global Runners are online, but none takes AI code fixes: each runs a
 * release from before global Runners took them, or its host turned them off
 * (Types/Runner/RunnerCodeFixes). Saying none is online would be wrong - the
 * Runners page shows them connected - and only whoever runs OneUptime can
 * change them.
 */
export const GLOBAL_RUNNERS_TAKE_NO_CODE_FIXES_DETAIL: string =
  "No global Runner online takes AI code fixes, so none can work in this repository: each runs an older release or has code fixes turned off. Pick one of your Runners for it in the repository's settings in Code, or ask your OneUptime administrator to let a global Runner take them.";

/*
 * The Runner a repository works on is online, but its host turned AI code
 * fixes off (ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false): the setting that
 * stops it, and the two ways on.
 */
const CODE_FIXES_TURNED_OFF_ON_HOST: string =
  "does not take AI code fixes: ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false is set on its host. Remove that setting and restart the Runner, or pick another Runner in the repository's settings in Code.";

/*
 * The name of the Runner check (agentAvailable) while what the repository
 * works on is online but takes no AI code fixes. "Runner online" next to a
 * cross would say it is not - the Runners page shows it connected - and a
 * start refused for it lists the check by this name among what is missing.
 */
export const RUNNER_ONLINE_CHECK_TITLE: string = "Runner online";

export const RUNNER_TAKES_CODE_FIXES_CHECK_TITLE: string =
  "Runner takes AI code fixes";

export const GLOBAL_RUNNERS_OFF_FOR_REPOSITORY_DETAIL: string =
  "This project does not use global Runners, and this repository picks no Runner of its own. Pick one of your Runners for it in the repository's settings in Code, or turn global Runners on under Runbooks → Runners.";

export const NO_RUNNER_ONLINE_FOR_PROJECT_DETAIL: string =
  "No Runner is online to work in this project's repositories. Each repository works on the Runner it picks in its settings in Code; one that picks none works on the project's default Runner, or on a global Runner when the project has no default.";

export function getRepositoryRunnerOfflineDetail(
  runnerName?: string | undefined,
): string {
  const runner: string = runnerName
    ? `The Runner "${runnerName}"`
    : "The Runner";

  return `${runner} this repository picks is not online. Check that its container is running, or pick another Runner in the repository's settings in Code.`;
}

/*
 * The project's default Runner, which a repository that picks no Runner of
 * its own works on, is not online.
 */
export function getProjectDefaultRunnerOfflineDetail(
  runnerName?: string | undefined,
): string {
  const runner: string = runnerName
    ? `The project's default Runner, "${runnerName}",`
    : "The project's default Runner";

  return `${runner} which this repository works on, is not online. Check that its container is running, or pick another Runner in the repository's settings in Code.`;
}

// The Runner the repository picks is online but takes no AI code fixes.
export function getRepositoryRunnerTakesNoCodeFixesDetail(
  runnerName?: string | undefined,
): string {
  const runner: string = runnerName
    ? `The Runner "${runnerName}" this repository picks`
    : "The Runner this repository picks";

  return `${runner} ${CODE_FIXES_TURNED_OFF_ON_HOST}`;
}

// The same, for the project's default Runner the repository follows.
export function getProjectDefaultRunnerTakesNoCodeFixesDetail(
  runnerName?: string | undefined,
): string {
  const runner: string = runnerName
    ? `The project's default Runner, "${runnerName}", which this repository works on,`
    : "The project's default Runner, which this repository works on,";

  return `${runner} ${CODE_FIXES_TURNED_OFF_ON_HOST}`;
}

// Why nothing can do the repository's work now, or null while something can.
export function describeRepositoryRunnerStatus(
  status: CodeRepositoryRunnerStatus,
): string | null {
  if (status.isOnline) {
    return null;
  }

  switch (status.decision.kind) {
    case CodeRepositoryRunnerChoiceKind.Custom:
      return status.takesNoCodeFixes
        ? getRepositoryRunnerTakesNoCodeFixesDetail(status.runnerName)
        : getRepositoryRunnerOfflineDetail(status.runnerName);
    case CodeRepositoryRunnerChoiceKind.ProjectDefault:
      return status.takesNoCodeFixes
        ? getProjectDefaultRunnerTakesNoCodeFixesDetail(status.runnerName)
        : getProjectDefaultRunnerOfflineDetail(status.runnerName);
    case CodeRepositoryRunnerChoiceKind.Global:
      return status.takesNoCodeFixes
        ? GLOBAL_RUNNERS_TAKE_NO_CODE_FIXES_DETAIL
        : NO_GLOBAL_RUNNER_ONLINE_DETAIL;
    case CodeRepositoryRunnerChoiceKind.NoRunner:
      return GLOBAL_RUNNERS_OFF_FOR_REPOSITORY_DETAIL;
    default: {
      const unhandled: never = status.decision;
      return String(unhandled);
    }
  }
}

// What Code's gate says when nothing can do the repository's work now.
export function getRepositoryRunnerBlocker(
  status: CodeRepositoryRunnerStatus,
): CodeTaskBlocker | null {
  const message: string | null = describeRepositoryRunnerStatus(status);

  if (!message) {
    return null;
  }

  const isProjectRunner: boolean =
    status.decision.kind === CodeRepositoryRunnerChoiceKind.Custom ||
    status.decision.kind === CodeRepositoryRunnerChoiceKind.ProjectDefault;

  const type: CodeTaskBlockerType = isProjectRunner
    ? status.takesNoCodeFixes
      ? CodeTaskBlockerType.RunnerTakesNoCodeFixes
      : CodeTaskBlockerType.RunnerNotOnline
    : status.decision.kind === CodeRepositoryRunnerChoiceKind.NoRunner
      ? CodeTaskBlockerType.GlobalRunnersOff
      : status.takesNoCodeFixes
        ? CodeTaskBlockerType.GlobalRunnersTakeNoCodeFixes
        : CodeTaskBlockerType.NoAgent;

  /*
   * The Runner the repository works on is named, so Code's notice says
   * which one to check: the person reading it may pick Runners for the
   * project's repositories, and sees the name in the repository's settings
   * anyway.
   */
  if (isProjectRunner && status.runnerName) {
    return { type, message, runnerName: status.runnerName };
  }

  return { type, message };
}

/*
 * Why AI fix tasks cannot run on the OneUptime-hosted provider once the
 * project's AI credits are used up: who can add credits, and where - most
 * people asking AI in Code cannot - and that a provider of the project's
 * own needs none.
 */
export const CODE_FIX_AI_CREDITS_USED_UP_DETAIL: string = `AI fix tasks would use the OneUptime-hosted LLM provider, which is paid from this project's AI credits, and they are used up. ${getProjectBalanceWhoCanAddSentence(ProjectBalanceType.AI)} A provider of the project's own (Project Settings > AI > LLM Providers) needs no AI credits.`;

/*
 * The gates every CodeFix run passes through, in one place. Several surfaces
 * ask the question — the per-exception panel, the project-wide readiness
 * route and Code's request box (CodeTaskGate) — and they differ only in how
 * strict their repository gate is (see AIFixReadinessCheckId). Sharing the
 * LLM and agent checks is what keeps them from drifting into telling the
 * user different stories.
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
        select: {
          aiCurrentBalanceInUSDCents: true,
          enableAutoRechargeAiBalance: true,
          autoAiRechargeByBalanceInUSD: true,
          autoRechargeAiWhenCurrentBalanceFallsInUSD: true,
        },
        props: { isRoot: true },
      });

      /*
       * Used up, and Auto Recharge will not refill them before the first
       * completion: it is off, or its last charge failed. With it on and set
       * up, the first completion recharges the credits and runs, as every
       * billed AI call does (AIService.getAiBalanceBlocker says the same).
       */
      const isUsedUp: boolean =
        !project ||
        ((project.aiCurrentBalanceInUSDCents || 0) <= 0 &&
          (await AIBillingService.getAutoRechargeState({
            projectId: params.projectId,
            project,
          })) !== AutoRechargeState.Ready);

      if (isUsedUp) {
        return {
          id: "llmProvider",
          ok: false,
          title: "LLM provider",
          detail: CODE_FIX_AI_CREDITS_USED_UP_DETAIL,
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
   * The project-wide repository gate: at least one repository the agent
   * can clone and push to - connected through the GitHub App, or through
   * its connection to GitLab, Forgejo, Gitea or any Git server
   * (SubjectCodeFixRun.hasConnectedRepository). This is the WEAKER claim -
   * it deliberately says nothing about whether a given exception's stack
   * trace will match one.
   */
  @CaptureSpan()
  public static async getRepositoryConnectedCheck(params: {
    projectId: ObjectID;
  }): Promise<AIFixReadinessCheck> {
    const hasRepository: boolean =
      await SubjectCodeFixRun.hasConnectedRepository(params.projectId);

    return {
      id: "repositoryConnected",
      ok: hasRepository,
      title: "Code repository",
      detail: hasRepository
        ? "Connected. The agent pushes its fixes there and opens a pull request where the repository's host has them."
        : "AI pushes its fixes to a repository and opens them as pull requests, so it needs one. Connect one in Code: through the GitHub App, or from GitLab, Forgejo, Gitea or any Git server.",
    };
  }

  /*
   * A Runner must be alive to pick the task up, or runs sit Queued forever.
   * For a known repository, the one its Runner setting in Code picks (or,
   * for one that picks none, the project's default Runner, else a global
   * Runner); before a repository is known, anything online for the
   * project's repositories.
   */
  @CaptureSpan()
  public static async getAgentCheck(params: {
    projectId: ObjectID;
    repository?: CodeRepositoryRunnerFactsRow | undefined;
  }): Promise<AIFixReadinessCheck> {
    if (!params.repository) {
      const isOnline: boolean =
        await CodeRepositoryRunnerChoice.isAnyRunnerOnlineForProject(
          params.projectId,
        );

      return {
        id: "agentAvailable",
        ok: isOnline,
        title: RUNNER_ONLINE_CHECK_TITLE,
        detail: isOnline
          ? "Connected and polling for tasks."
          : NO_RUNNER_ONLINE_FOR_PROJECT_DETAIL,
      };
    }

    const status: CodeRepositoryRunnerStatus =
      await CodeRepositoryRunnerChoice.getStatusForRepository({
        projectId: params.projectId,
        runnerId: params.repository.runnerId,
        isGlobalRunnerPicked: params.repository.isGlobalRunnerPicked,
      });

    const blocker: CodeTaskBlocker | null = getRepositoryRunnerBlocker(status);

    /*
     * Which of Code's blockers it is rides along, so a page that draws the
     * failure as Code's notice (an exception finding's Fix with AI) says
     * what Code says.
     */
    if (blocker) {
      return {
        id: "agentAvailable",
        ok: false,
        title: status.takesNoCodeFixes
          ? RUNNER_TAKES_CODE_FIXES_CHECK_TITLE
          : RUNNER_ONLINE_CHECK_TITLE,
        detail: blocker.message,
        blocker,
      };
    }

    return {
      id: "agentAvailable",
      ok: true,
      title:
        status.decision.kind === CodeRepositoryRunnerChoiceKind.Custom ||
        status.decision.kind === CodeRepositoryRunnerChoiceKind.ProjectDefault
          ? `Runner online: ${status.runnerName || "Runner"}`
          : "Global Runner online",
      detail: "Connected and polling for tasks.",
    };
  }

  /*
   * Project-wide readiness (POST /ai-readiness/code-fix). Same LLM and agent gates
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
