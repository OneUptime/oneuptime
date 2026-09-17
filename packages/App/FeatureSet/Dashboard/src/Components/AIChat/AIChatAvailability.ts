import PageMap from "../../Utils/PageMap";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * Why Ask AI cannot answer a question right now.
 *
 * Every one of these is a SETTING somebody flipped (or never turned on), not a
 * failure — which is why they are resolved before the user types rather than
 * surfaced as an error after a send is refused. Ordered by precedence in
 * getAIChatUnavailableReason: the reason shown is the one the user has to fix
 * FIRST, so the page it points at is never a dead end.
 */
enum AIChatUnavailableReason {
  // The project's plan does not include AI at all — nothing else matters yet.
  PlanUpgradeRequired = "PlanUpgradeRequired",
  // Project.enableAi is off: the project's own AI kill switch.
  DisabledForProject = "DisabledForProject",
  // AI is on, but no LLM provider is configured for the project (nor globally).
  NoProviderConfigured = "NoProviderConfigured",
}

export default AIChatUnavailableReason;

/*
 * What a surface needs to tell the user, per reason: what is off, and the one
 * settings page that turns it back on. Kept as data rather than as branches in
 * a component so the panel, the full page, and the tests all read the same
 * sentences.
 */
export interface AIChatUnavailableCopy {
  icon: IconProp;
  title: string;
  description: string;
  // The settings page that owns the switch, and the words that link to it.
  actionPage: PageMap;
  actionLabel: string;
}

const COPY: Record<AIChatUnavailableReason, AIChatUnavailableCopy> = {
  [AIChatUnavailableReason.PlanUpgradeRequired]: {
    icon: IconProp.Sparkles,
    title: "AI is not included in this project's plan",
    description:
      "Ask AI needs the Growth plan or higher. Upgrade the project to ask questions about your logs, traces, metrics, incidents and monitors.",
    actionPage: PageMap.SETTINGS_BILLING,
    actionLabel: "Go to Project Settings > Billing",
  },
  [AIChatUnavailableReason.DisabledForProject]: {
    icon: IconProp.Sparkles,
    title: "AI features are disabled for this project",
    description:
      "Ask AI is switched off along with every other AI feature in this project. A project owner can turn it back on with the Enable AI toggle.",
    actionPage: PageMap.SETTINGS_AI_CREDITS,
    actionLabel: "Go to Project Settings > AI Credits",
  },
  [AIChatUnavailableReason.NoProviderConfigured]: {
    icon: IconProp.Sparkles,
    title: "No LLM provider is configured for this project",
    description:
      "Ask AI sends your questions to a model, and this project has no provider to send them to yet. Add one to start chatting.",
    actionPage: PageMap.SETTINGS_AI_LLM_PROVIDERS,
    actionLabel: "Go to Project Settings > AI > LLM Providers",
  },
};

export function getAIChatUnavailableCopy(
  reason: AIChatUnavailableReason,
): AIChatUnavailableCopy {
  return COPY[reason];
}

/*
 * The single verdict every Ask AI surface asks for, resolved from what the
 * client actually knows.
 *
 * FAILS OPEN by design. `isProjectAIEnabled` and `hasLoadedProviders` both
 * come from POST /ai-chat/providers, and that request can be slow, can fail,
 * or can be refused for a member without provider-read permission. Guessing
 * "disabled" in any of those cases would lock a working assistant behind a
 * setup notice for a setting that is perfectly fine — so only a verdict we
 * actually received closes the door. The server still refuses the send either
 * way; this decides what the user is TOLD, and it must not lie.
 */
export function getAIChatUnavailableReason(data: {
  isAccessibleOnPlan: boolean;
  isProjectAIEnabled: boolean;
  hasLoadedProviders: boolean;
  providerCount: number;
}): AIChatUnavailableReason | null {
  if (!data.isAccessibleOnPlan) {
    return AIChatUnavailableReason.PlanUpgradeRequired;
  }

  if (!data.isProjectAIEnabled) {
    return AIChatUnavailableReason.DisabledForProject;
  }

  if (data.hasLoadedProviders && data.providerCount === 0) {
    return AIChatUnavailableReason.NoProviderConfigured;
  }

  return null;
}
