import AIRun from "../../../Models/DatabaseModels/AIRun";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import { AIRunEventResultSummary } from "../../../Types/AI/AIChatTypes";
import {
  LlmProviderActivity,
  LlmProviderCandidate,
  LlmProviderDecision,
  LlmProviderFallbackReason,
  LlmProviderSource,
  decideLlmProvider,
  describeLlmProviderActivityInEnglish,
  getLlmProviderActivity,
  isLlmProviderActivityWarning,
  readLlmProviderId,
} from "../../../Types/AI/LlmProviderChoice";
import { ProjectAiDailyLimit } from "../../../Types/AI/ProjectAiDailyLimits";
import ObjectID from "../../../Types/ObjectID";
import { IsBillingEnabled } from "../../EnvironmentConfig";
import AIRunService from "../../Services/AIRunService";
import AIService, { ProjectAiDailyLimitStatus } from "../../Services/AIService";
import LlmProviderService from "../../Services/LlmProviderService";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * THE LLM PROVIDER A RULE'S WORK USES, read from the database - the shared
 * piece every AI rule's runs go through: investigations, auto remediation,
 * postmortem drafts, the fix pull requests rules open, and the AI rules of
 * the telemetry products after them. The rule itself, and the words for
 * it, are Common/Types/AI/LlmProviderChoice: the rule's pick, else the
 * project's default provider, else the global one; a pick that cannot be
 * used falls back, and the run says so.
 *
 * How a rule's work uses it:
 *
 *   - the rule's pick is written on the run it starts (AIRun.llmProviderId,
 *     the AIInvestigationQueue.enqueue and SubjectCodeFixRun inputs), or
 *     handed to the work directly when there is no run (a postmortem
 *     draft);
 *   - when the run starts, decideForRun reads it and decides; the run hands
 *     `llmProviderId` to every LLM call it makes (AIService.
 *     executeWithLogging), and records `eventSummary` in its activity;
 *   - a gate that asks whether AI can run at all (a provider, AI credits)
 *     asks decide with the pick too, so a rule whose own provider can run
 *     is not stopped for the project's.
 *
 * With no pick nothing new is read or recorded: `llmProviderId` stays
 * undefined and each call resolves the project's provider as it always has.
 */

export interface RuleLlmProviderChoice extends LlmProviderDecision {
  // The rule's pick, as recorded: "" for none.
  pickedProviderId: string;
  /*
   * What to hand every LLM call of the work (AILogRequest.llmProviderId):
   * the rule's pick when it is used. Undefined otherwise - each call then
   * resolves the project's default, else the global provider, itself,
   * exactly as without a rule.
   */
  llmProviderId?: ObjectID | undefined;
  /*
   * The provider decided, as read - with what an AI credits check reads off
   * it (isGlobalLlm, projectId, costPerMillionTokensInUSDCents). Undefined
   * when nothing was read: no pick, and the caller did not ask for the
   * project's provider (decideForRun).
   */
  providerRow?: LlmProvider | null | undefined;
  // What the run's activity says; null when no rule picked a provider.
  activity: LlmProviderActivity | null;
}

// The columns a decision reads off a provider (never its secrets).
const PROVIDER_SELECT: {
  _id: true;
  name: true;
  modelName: true;
  projectId: true;
  isGlobalLlm: true;
  isDefault: true;
  costPerMillionTokensInUSDCents: true;
} = {
  _id: true,
  name: true,
  modelName: true,
  projectId: true,
  isGlobalLlm: true,
  isDefault: true,
  costPerMillionTokensInUSDCents: true,
};

// A run no rule picked a provider for: nothing to decide or say.
const NO_PICK: RuleLlmProviderChoice = {
  provider: null,
  source: null,
  fallbackReason: null,
  pickedProviderId: "",
  activity: null,
};

export default class LlmProviderChoice {
  /*
   * The provider for work a rule starts, from the rule's pick (empty for
   * none). Reads the pick, what may stop it (AI credits, the daily AI
   * spend limit - only for a provider the credits pay for), and, when it is
   * not used or there is none, the project's provider: its default, else
   * the global one (LlmProviderService.getLLMProviderForProject). Never
   * throws: a read that fails is a pick that cannot be used, and a budget
   * that cannot be read stops nothing - the LLM call checks it again.
   */
  @CaptureSpan()
  public static async decide(data: {
    projectId: ObjectID;
    pickedProviderId?: unknown;
  }): Promise<RuleLlmProviderChoice> {
    const pickedProviderId: string = readLlmProviderId(data.pickedProviderId);

    const picked: LlmProvider | null = pickedProviderId
      ? await this.readPickedProvider({
          projectId: data.projectId,
          pickedProviderId,
        })
      : null;

    const pickedBlocker: LlmProviderFallbackReason | null = picked
      ? await this.getBlocker({ projectId: data.projectId, provider: picked })
      : null;

    // The pick, used as it is: nothing else to read.
    if (picked && !pickedBlocker) {
      return this.toChoice({
        pickedProviderId,
        decision: decideLlmProvider({
          pickedProviderId,
          pickedProvider: this.toCandidate(picked),
          projectDefault: null,
          globalProvider: null,
        }),
        rows: [picked],
      });
    }

    const projectProvider: LlmProvider | null =
      await this.readProjectProvider(data.projectId);

    const projectCandidate: LlmProviderCandidate | null = projectProvider
      ? this.toCandidate(projectProvider)
      : null;

    const isProjectDefault: boolean = Boolean(
      projectProvider && !LlmProviderChoice.isGlobalProvider(projectProvider),
    );

    return this.toChoice({
      pickedProviderId,
      decision: decideLlmProvider({
        pickedProviderId,
        pickedProvider: picked ? this.toCandidate(picked) : null,
        pickedProviderBlocker: pickedBlocker,
        projectDefault: isProjectDefault ? projectCandidate : null,
        globalProvider: isProjectDefault ? null : projectCandidate,
      }),
      rows: [picked, projectProvider],
    });
  }

  /*
   * decide, for work whose pick is known - and, with no pick, nothing read
   * and nothing to say (NO_PICK): the work's LLM calls resolve the project's
   * provider themselves, as they always have.
   */
  public static async decideIfPicked(data: {
    projectId: ObjectID;
    pickedProviderId?: unknown;
  }): Promise<RuleLlmProviderChoice> {
    if (!readLlmProviderId(data.pickedProviderId)) {
      return NO_PICK;
    }

    return this.decide(data);
  }

  /*
   * The provider for a run, from the pick its rule recorded on it
   * (AIRun.llmProviderId). A run no rule picked one for reads nothing more
   * and says nothing: NO_PICK.
   */
  @CaptureSpan()
  public static async decideForRun(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
  }): Promise<RuleLlmProviderChoice> {
    let pickedProviderId: string = "";

    try {
      const run: AIRun | null = await AIRunService.findOneById({
        id: data.aiRunId,
        select: { llmProviderId: true },
        props: { isRoot: true },
      });

      pickedProviderId = readLlmProviderId(run?.llmProviderId);
    } catch (error) {
      logger.error(
        `AI: could not read the LLM provider run ${data.aiRunId.toString()}'s rule picked; it uses the project's provider: ${error}`,
      );
      return NO_PICK;
    }

    if (!pickedProviderId) {
      return NO_PICK;
    }

    return this.decide({ projectId: data.projectId, pickedProviderId });
  }

  /*
   * The ProgressLog event a run records for its choice - the provider its
   * rule picked, or why it used another - or null when no rule picked one.
   * `message` is the English; `llmProvider` lets the Dashboard say it in the
   * reader's language.
   */
  public static getEventSummary(
    choice: RuleLlmProviderChoice,
  ): AIRunEventResultSummary | null {
    if (!choice.activity) {
      return null;
    }

    return this.getActivityEventSummary(choice.activity);
  }

  // The ProgressLog event for an activity (getEventSummary).
  public static getActivityEventSummary(
    activity: LlmProviderActivity,
  ): AIRunEventResultSummary {
    return {
      message: describeLlmProviderActivityInEnglish(activity),
      severity: isLlmProviderActivityWarning(activity) ? "Warning" : "Info",
      llmProvider: activity,
    };
  }

  /*
   * What a run says when its rule's pick was not used and the provider it
   * did use was resolved some other way - a fix run's, by the metered
   * agent path: the reason the pick was not used, and that provider.
   */
  public static getFallbackActivity(data: {
    choice: RuleLlmProviderChoice;
    usedProvider: LlmProvider | null;
  }): LlmProviderActivity | null {
    if (!data.choice.activity || !data.choice.fallbackReason) {
      return data.choice.activity;
    }

    const activity: LlmProviderActivity = {
      fallbackReason: data.choice.fallbackReason,
    };

    if (data.usedProvider) {
      activity.source = LlmProviderChoice.isGlobalProvider(data.usedProvider)
        ? LlmProviderSource.Global
        : LlmProviderSource.ProjectDefault;
      activity.providerName = data.usedProvider.name || "";
    }

    return activity;
  }

  /*
   * The pick, when the project may use it: one of its own providers, or a
   * global one (LlmProviderService.isProviderUsableBy). Null otherwise -
   * deleted, another project's, a global provider no longer shared, or an
   * id that is not one.
   */
  private static async readPickedProvider(data: {
    projectId: ObjectID;
    pickedProviderId: string;
  }): Promise<LlmProvider | null> {
    if (!ObjectID.isValidUUID(data.pickedProviderId)) {
      return null;
    }

    try {
      const provider: LlmProvider | null = await LlmProviderService.findOneBy({
        query: { _id: data.pickedProviderId },
        select: PROVIDER_SELECT,
        props: { isRoot: true },
      });

      if (
        !provider ||
        !LlmProviderService.isProviderUsableBy(provider, data.projectId)
      ) {
        return null;
      }

      return provider;
    } catch (error) {
      logger.error(
        `AI: could not read the LLM provider ${data.pickedProviderId} a rule picks; using the project's provider: ${error}`,
      );
      return null;
    }
  }

  // The project's provider - its default, else a global one - or null.
  private static async readProjectProvider(
    projectId: ObjectID,
  ): Promise<LlmProvider | null> {
    try {
      return await LlmProviderService.getLLMProviderForProject(projectId);
    } catch (error) {
      logger.error(
        `AI: could not read the LLM provider of project ${projectId.toString()}: ${error}`,
      );
      return null;
    }
  }

  /*
   * What stops a provider the project's AI credits pay for from running
   * now: the credits used up with nothing to refill them, or the project's
   * daily AI spend limit reached. Nothing stops a provider they do not pay
   * for, here: the token limit and the per-lane budgets stop every
   * provider alike, so no other provider would get past them.
   */
  private static async getBlocker(data: {
    projectId: ObjectID;
    provider: LlmProvider;
  }): Promise<LlmProviderFallbackReason | null> {
    if (!LlmProviderChoice.isBilledProvider(data.provider)) {
      return null;
    }

    try {
      if (
        await AIService.getAiBalanceBlocker({
          projectId: data.projectId,
          llmProvider: data.provider,
        })
      ) {
        return LlmProviderFallbackReason.CreditsUsedUp;
      }
    } catch (error) {
      logger.error(
        `AI: could not check the AI credits of project ${data.projectId.toString()} for the LLM provider a rule picks; not stopping on them: ${error}`,
      );
    }

    try {
      const status: ProjectAiDailyLimitStatus =
        await AIService.getProjectDailyLimitStatus({
          projectId: data.projectId,
          isBilled: true,
          llmProvider: data.provider,
        });

      if (status.reachedLimit === ProjectAiDailyLimit.Spend) {
        return LlmProviderFallbackReason.SpendLimitReached;
      }
    } catch (error) {
      logger.error(
        `AI: could not check the daily AI spend limit of project ${data.projectId.toString()} for the LLM provider a rule picks; not stopping on it: ${error}`,
      );
    }

    return null;
  }

  /*
   * Whether the project's AI credits pay for this provider: the test
   * AIService.executeWithLogging bills by (shouldBill).
   */
  public static isBilledProvider(provider: LlmProvider): boolean {
    return (
      IsBillingEnabled &&
      provider.isGlobalLlm === true &&
      (provider.costPerMillionTokensInUSDCents || 0) > 0
    );
  }

  // A global provider, shared with every project; else the project's own.
  public static isGlobalProvider(provider: LlmProvider): boolean {
    return provider.isGlobalLlm === true;
  }

  private static toCandidate(provider: LlmProvider): LlmProviderCandidate {
    return {
      id: readLlmProviderId(provider._id ?? provider.id),
      name: provider.name || "",
      isGlobal: LlmProviderChoice.isGlobalProvider(provider),
    };
  }

  private static toChoice(data: {
    pickedProviderId: string;
    decision: LlmProviderDecision;
    rows: Array<LlmProvider | null>;
  }): RuleLlmProviderChoice {
    const providerId: string = data.decision.provider?.id || "";

    const providerRow: LlmProvider | null =
      data.rows.find((row: LlmProvider | null): boolean => {
        return Boolean(
          row && providerId && readLlmProviderId(row._id ?? row.id) === providerId,
        );
      }) || null;

    const choice: RuleLlmProviderChoice = {
      ...data.decision,
      pickedProviderId: data.pickedProviderId,
      providerRow,
      activity: getLlmProviderActivity({
        pickedProviderId: data.pickedProviderId,
        decision: data.decision,
      }),
    };

    if (
      data.decision.source === LlmProviderSource.RulePick &&
      data.decision.provider
    ) {
      choice.llmProviderId = new ObjectID(data.decision.provider.id);
    }

    return choice;
  }
}
