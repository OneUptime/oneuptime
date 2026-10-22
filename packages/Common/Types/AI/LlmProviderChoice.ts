/*
 * WHICH LLM PROVIDER OneUptime AI USES FOR THE WORK A RULE STARTS - the one
 * rule, read by the server's runs, the Dashboard's rule forms and the docs
 * tests alike.
 *
 * The maintainer: "In all of these rules, especially and in fact including
 * the incident investigation and remediation rule, we don't have a way to
 * select the LLM provider that we currently use. If the provider is not
 * selected, select the project LLM provider by default if one is set to
 * default, or you can select the global LLM provider as well. If one is
 * selected, use that LLM provider to do everything."
 *
 * So every AI rule - investigation rules, auto remediation rules,
 * postmortem rules, and the AI rules of the telemetry products after them -
 * may pick an LLM provider under its More fields: one of the project's own,
 * or a global one. Everything the rule starts uses, in this order:
 *
 *   1. the provider the rule picks (LlmProviderSource.RulePick);
 *   2. else the project's default provider, LlmProvider.isDefault
 *      (LlmProviderSource.ProjectDefault);
 *   3. else the global provider (LlmProviderSource.Global) - the same order
 *      the project's AI has always used with no rule at all
 *      (LlmProviderService.getLLMProviderForProject).
 *
 * A pick that cannot be used falls back down that list, and the run says so
 * in its activity (LlmProviderActivity):
 *
 *   - Unavailable: the provider was deleted, or is no longer one the
 *     project may use (a global provider an administrator stopped sharing).
 *     A rule's pick of a deleted provider is cleared with it, so this is a
 *     run queued before the deletion, or a pick the project lost;
 *   - CreditsUsedUp: a global provider paid for with the project's AI
 *     credits, and they are used up with nothing to refill them;
 *   - SpendLimitReached: the project's daily AI spend limit stops AI that
 *     the AI credits pay for.
 *
 * The last two stop only providers the AI credits pay for, so a pick they
 * stop falls back to the project's own default provider alone - which they
 * never stop. With no such default the pick stays, and the run is refused
 * for what stops it, as it would have been without the rule.
 *
 * When several rules decide one run - an incident that matches two
 * investigation rules, say - the provider is that of the first of them, by
 * name, that picks one (getRulesLlmProviderId): a rule that picks none never
 * hides the pick of another rule that matched too.
 *
 * Shared by the server and the Dashboard, so it imports nothing.
 */

// Where the provider a run uses comes from.
export enum LlmProviderSource {
  // The provider the rule that started the run picks.
  RulePick = "RulePick",
  // The project's default provider (LlmProvider.isDefault).
  ProjectDefault = "ProjectDefault",
  // A global provider, shared with every project.
  Global = "Global",
}

// Why the provider a rule picks could not be used.
export enum LlmProviderFallbackReason {
  // Deleted, or no longer one the project may use.
  Unavailable = "Unavailable",
  // Paid for with AI credits, which are used up.
  CreditsUsedUp = "CreditsUsedUp",
  // The project's daily AI spend limit stops the AI credits it uses.
  SpendLimitReached = "SpendLimitReached",
}

// A provider the decision may choose: one the project may use.
export interface LlmProviderCandidate {
  // Lower-case, as readLlmProviderId reads ids.
  id: string;
  name: string;
  // A global provider, shared with every project; else the project's own.
  isGlobal: boolean;
}

export interface LlmProviderDecision {
  // The provider to use, or null when the project has none it may use.
  provider: LlmProviderCandidate | null;
  // Where it comes from; null with no provider.
  source: LlmProviderSource | null;
  // Set when the rule picked a provider that could not be used.
  fallbackReason: LlmProviderFallbackReason | null;
}

/*
 * A provider id from a stored value: a text, an ObjectID (which keeps its
 * text in _id), a relation row ({ _id } or { id }) or a dropdown option
 * ({ value }). Empty for none. Lower-case, as Postgres renders a uuid.
 */
export function readLlmProviderId(value: unknown): string {
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }

  if (value && typeof value === "object") {
    const row: { _id?: unknown; id?: unknown; value?: unknown } = value as {
      _id?: unknown;
      id?: unknown;
      value?: unknown;
    };

    return readLlmProviderId(row._id ?? row.id ?? row.value);
  }

  return "";
}

// The provider a rule picks, from its llmProviderId (or its relation): "" for none.
export function getRuleLlmProviderId(rule: {
  llmProviderId?: unknown;
  llmProvider?: unknown;
}): string {
  return (
    readLlmProviderId(rule.llmProviderId) || readLlmProviderId(rule.llmProvider)
  );
}

/*
 * THE DECISION: the provider a run uses, from the rule's pick and what the
 * project has (see the module comment). `pickedProvider` is the pick as it
 * was read - null when nothing the project may use answers to the id - and
 * `pickedProviderBlocker` what stops it running now though it is there.
 */
export function decideLlmProvider(data: {
  // The rule's pick, as stored: empty for none.
  pickedProviderId?: unknown;
  pickedProvider?: LlmProviderCandidate | null | undefined;
  pickedProviderBlocker?: LlmProviderFallbackReason | null | undefined;
  projectDefault: LlmProviderCandidate | null;
  globalProvider: LlmProviderCandidate | null;
}): LlmProviderDecision {
  const pickedProviderId: string = readLlmProviderId(data.pickedProviderId);

  const fallBack: (
    fallbackReason: LlmProviderFallbackReason | null,
  ) => LlmProviderDecision = (
    fallbackReason: LlmProviderFallbackReason | null,
  ): LlmProviderDecision => {
    if (data.projectDefault) {
      return {
        provider: data.projectDefault,
        source: LlmProviderSource.ProjectDefault,
        fallbackReason,
      };
    }

    if (data.globalProvider) {
      return {
        provider: data.globalProvider,
        source: LlmProviderSource.Global,
        fallbackReason,
      };
    }

    return { provider: null, source: null, fallbackReason };
  };

  // No pick: the project's default, else the global provider.
  if (!pickedProviderId) {
    return fallBack(null);
  }

  const picked: LlmProviderCandidate | null = data.pickedProvider || null;

  if (!picked || readLlmProviderId(picked.id) !== pickedProviderId) {
    return fallBack(LlmProviderFallbackReason.Unavailable);
  }

  const blocker: LlmProviderFallbackReason | null =
    data.pickedProviderBlocker || null;

  if (!blocker) {
    return {
      provider: picked,
      source: LlmProviderSource.RulePick,
      fallbackReason: null,
    };
  }

  /*
   * What stops the pick is what the AI credits pay for: only the project's
   * own default helps, which they never pay for. The global provider would
   * be stopped the same way.
   */
  if (
    data.projectDefault &&
    !data.projectDefault.isGlobal &&
    readLlmProviderId(data.projectDefault.id) !== pickedProviderId
  ) {
    return {
      provider: data.projectDefault,
      source: LlmProviderSource.ProjectDefault,
      fallbackReason: blocker,
    };
  }

  // Nothing better: the pick stays, and the run is refused for what stops it.
  return {
    provider: picked,
    source: LlmProviderSource.RulePick,
    fallbackReason: null,
  };
}

// A rule as getRulesLlmProviderId reads it.
export interface LlmProviderRuleFacts {
  name?: unknown;
  _id?: unknown;
  id?: unknown;
  llmProviderId?: unknown;
  llmProvider?: unknown;
}

// A rule's id, lower-case, to order rules that share a name.
function readRuleId(rule: LlmProviderRuleFacts): string {
  return readLlmProviderId(rule._id ?? rule.id);
}

/*
 * The rules that pick a provider, in the order that decides between them:
 * by name (ties by id). The first of them a run's subject matches decides
 * its provider; a rule that picks none is not among them, so it never
 * hides another's pick.
 */
export function getLlmProviderPickingRules<TRule extends LlmProviderRuleFacts>(
  rules: ReadonlyArray<TRule>,
): Array<TRule> {
  return rules
    .filter((rule: TRule): boolean => {
      return getRuleLlmProviderId(rule).length > 0;
    })
    .sort((first: TRule, second: TRule): number => {
      const byName: number = String(first.name ?? "").localeCompare(
        String(second.name ?? ""),
        "en",
        { sensitivity: "base" },
      );

      if (byName !== 0) {
        return byName;
      }

      return readRuleId(first).localeCompare(readRuleId(second));
    });
}

/*
 * Of the rules that decide a run, the provider it uses: the pick of the
 * first of them by name that picks one (ties by id), or "" when none does -
 * then the project's default, else the global provider.
 */
export function getRulesLlmProviderId(
  rules: ReadonlyArray<LlmProviderRuleFacts>,
): string {
  const picking: Array<LlmProviderRuleFacts> =
    getLlmProviderPickingRules(rules);

  return picking.length > 0 ? getRuleLlmProviderId(picking[0]!) : "";
}

/*
 * WHAT A RUN SAYS ABOUT ITS PROVIDER, in its activity (a ProgressLog event,
 * AIRunEventResultSummary.llmProvider): only for a run a rule picked a
 * provider for - the provider it used, or why it used another. A run no
 * rule picked one for says nothing new: its LLM calls name their provider
 * in the AI Logs, as every run's always have.
 */
export interface LlmProviderActivity {
  // Where the provider used comes from; absent when there was none to use.
  source?: LlmProviderSource | undefined;
  // The provider used, by name.
  providerName?: string | undefined;
  // Why the rule's pick was not used.
  fallbackReason?: LlmProviderFallbackReason | undefined;
}

// The run's activity for a decision, or null when no rule picked a provider.
export function getLlmProviderActivity(data: {
  pickedProviderId?: unknown;
  decision: LlmProviderDecision;
}): LlmProviderActivity | null {
  if (!readLlmProviderId(data.pickedProviderId)) {
    return null;
  }

  const activity: LlmProviderActivity = {};

  if (data.decision.provider && data.decision.source) {
    activity.source = data.decision.source;
    activity.providerName = data.decision.provider.name;
  }

  if (data.decision.fallbackReason) {
    activity.fallbackReason = data.decision.fallbackReason;
  }

  return activity;
}

// Whether the activity is a warning: the rule's pick was not used.
export function isLlmProviderActivityWarning(
  activity: LlmProviderActivity,
): boolean {
  return Boolean(activity.fallbackReason) || !activity.source;
}

/*
 * The run's line, in English, with its {{provider}} slot: what the server
 * writes as the event's message, and the words the Dashboard looks up to
 * draw the same line in the reader's language (ChatActivityFeed - a test
 * holds both to these).
 */
export const LLM_PROVIDER_ACTIVITY_TEMPLATES: {
  rulePick: string;
  unavailableToProjectDefault: string;
  unavailableToGlobal: string;
  unavailableToNone: string;
  creditsUsedUp: string;
  spendLimitReached: string;
} = {
  rulePick: "Using {{provider}}, the rule's LLM provider",
  unavailableToProjectDefault:
    "Using {{provider}}, the project's default LLM provider, because the rule's provider is no longer available",
  unavailableToGlobal:
    "Using {{provider}}, the global LLM provider, because the rule's provider is no longer available",
  unavailableToNone:
    "The rule's LLM provider is no longer available, and there is no other to use",
  creditsUsedUp:
    "Using {{provider}}, the project's default LLM provider, because the rule's provider runs on AI credits, which are used up",
  spendLimitReached:
    "Using {{provider}}, the project's default LLM provider, because the daily AI spend limit stops the rule's provider",
};

// Which template says the activity (LLM_PROVIDER_ACTIVITY_TEMPLATES).
export function getLlmProviderActivityTemplate(
  activity: LlmProviderActivity,
): string {
  const templates: typeof LLM_PROVIDER_ACTIVITY_TEMPLATES =
    LLM_PROVIDER_ACTIVITY_TEMPLATES;

  if (!activity.source || !activity.providerName) {
    return templates.unavailableToNone;
  }

  switch (activity.fallbackReason) {
    case LlmProviderFallbackReason.Unavailable:
      return activity.source === LlmProviderSource.Global
        ? templates.unavailableToGlobal
        : templates.unavailableToProjectDefault;
    case LlmProviderFallbackReason.CreditsUsedUp:
      return templates.creditsUsedUp;
    case LlmProviderFallbackReason.SpendLimitReached:
      return templates.spendLimitReached;
    default:
      return templates.rulePick;
  }
}

/*
 * The run's line in English, its slot filled: the event's message, which
 * surfaces that draw English (a code task's notes, the API) show as it is.
 */
export function describeLlmProviderActivityInEnglish(
  activity: LlmProviderActivity,
): string {
  return getLlmProviderActivityTemplate(activity)
    .split("{{provider}}")
    .join(activity.providerName || "");
}
