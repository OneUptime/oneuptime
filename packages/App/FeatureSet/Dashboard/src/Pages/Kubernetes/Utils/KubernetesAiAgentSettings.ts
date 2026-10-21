import { AgentAiSettingsChoice } from "../../../Components/AiAccess/AiAccessModes";
import {
  AgentAiSettingsInstructions,
  AgentAiSettingsStep,
  areFixesOn,
} from "../../../Components/AiAccess/AgentAiSettingsInstructions";
import {
  AiAgentHelmCommands,
  getAiAgentClusterWideCommandNote,
  getAiAgentHelmCommands,
  getAiAgentScopedCommandNote,
  getAiAgentWriteDisclosure,
} from "./KubernetesAiAccessSetup";
import {
  getAiAgentSummary,
  isAdvancedRunnerTarget,
  isLegacyRunnerTarget,
} from "./KubernetesAiAgentStatus";
import { AgentAiSettingsSource } from "Common/Types/AI/AgentAiSettings";
import {
  KubernetesAgentPosture,
  KubernetesAiAgentSummary,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What a cluster's AI agent page says and shows about where investigation
 * and fixes are set — read-only while the Kubernetes AI agent sets them
 * (the chart's aiAgent.investigation and aiAgent.fixes, or the agent's
 * defaults), with the helm upgrade that sets each choice.
 *
 * The commands are the chart upgrades the page already shows
 * (getAiAgentHelmCommands), for the chosen settings: the same refreshed
 * chart index, --reset-then-reuse-values, and — when fixes need write
 * access the agent does not have yet — the same scoped and cluster-wide
 * variants with the same notes and disclosure.
 *
 * Import-clean on purpose (Common types and the page's own utils), so the
 * suites read it without a browser.
 */

/*
 * Could the cluster's settings be set in its agent's configuration
 * instead of here? It has a Kubernetes AI agent, and AI reaches the cluster
 * through it — not through the previous in-cluster Runner (upgrade the
 * chart first) or a Runner an operator bound (the agent does not run the
 * commands then).
 */
export function canKubernetesAgentSetAiSettings(
  status: KubernetesClusterAiAccessStatus,
): boolean {
  return (
    getAiAgentSummary(status) !== null &&
    !isAdvancedRunnerTarget(status) &&
    !isLegacyRunnerTarget(status)
  );
}

// What is in effect on the cluster now, as a choice.
export function getKubernetesAiSettingsChoice(
  status: KubernetesClusterAiAccessStatus,
): AgentAiSettingsChoice {
  const mode: unknown = status.remediationMode;

  return {
    investigation: status.isInvestigationEnabled === true,
    fixes: Object.values(KubernetesAiRemediationMode).includes(
      mode as KubernetesAiRemediationMode,
    )
      ? (mode as KubernetesAiRemediationMode)
      : KubernetesAiRemediationMode.Disabled,
  };
}

// The line above the rows, by where the settings are set.
export const KUBERNETES_AI_SETTINGS_SET_BY_TEXT: Readonly<
  Record<AgentAiSettingsSource, string>
> = {
  agent_configuration: translationKey(
    "Set by the Kubernetes AI agent's configuration: aiAgent.investigation and aiAgent.fixes on the Kubernetes agent chart. Change them there; this page follows.",
  ),
  agent_defaults: translationKey(
    "Set by the Kubernetes AI agent's defaults: the Kubernetes agent chart sets neither aiAgent.investigation nor aiAgent.fixes. Set them on the chart to choose; this page follows.",
  ),
  oneuptime: translationKey(
    "Chosen on this page. You can set them on the Kubernetes agent chart instead (aiAgent.investigation and aiAgent.fixes), so they follow the agent.",
  ),
};

// The posture of whatever runs kubectl for the agent now.
function getAgentPosture(
  status: KubernetesClusterAiAccessStatus,
): KubernetesAgentPosture | undefined {
  const agent: KubernetesAiAgentSummary | null = getAiAgentSummary(status);

  return status.runner?.posture || agent?.posture || undefined;
}

export const KUBERNETES_AI_SETTINGS_STEP_TITLE: string = translationKey(
  "Upgrade the Kubernetes agent chart",
);

export const KUBERNETES_AI_SETTINGS_STEP_DESCRIPTION: string = translationKey(
  "Run this with kubectl pointed at the cluster. --reset-then-reuse-values (Helm 3.14 or later) keeps every other value you set on the release.",
);

export const KUBERNETES_AI_SETTINGS_SCOPED_LABEL: string = translationKey(
  "Only some namespaces (recommended)",
);

export const KUBERNETES_AI_SETTINGS_CLUSTER_WIDE_LABEL: string =
  translationKey("The whole cluster");

export const KUBERNETES_AI_SETTINGS_FIXES_OFF_NOTE: string = translationKey(
  "Fixes off takes the agent's write access away too: the chart removes its write role.",
);

/*
 * How to set this choice on the chart. Fixes that need write access the
 * agent does not have get the scoped (recommended) and cluster-wide
 * upgrades, each complete on its own, with the write-access disclosure;
 * everything else is one upgrade that sets the two values and keeps the
 * write scope the release has.
 */
export function getKubernetesAiSettingsInstructions(data: {
  choice: AgentAiSettingsChoice;
  status: KubernetesClusterAiAccessStatus;
}): AgentAiSettingsInstructions {
  const commands: AiAgentHelmCommands = getAiAgentHelmCommands({
    investigation: data.choice.investigation,
    fixes: data.choice.fixes,
  });
  const mayWriteNow: boolean =
    getAgentPosture(data.status)?.allowWrites === true;

  if (areFixesOn(data.choice) && !mayWriteNow) {
    const step: AgentAiSettingsStep = {
      title: KUBERNETES_AI_SETTINGS_STEP_TITLE,
      description: KUBERNETES_AI_SETTINGS_STEP_DESCRIPTION,
      dataTestId: "agent-ai-settings-step-upgrade",
      ways: [
        {
          label: KUBERNETES_AI_SETTINGS_SCOPED_LABEL,
          code: commands.enableRemediationScoped,
          note: getAiAgentScopedCommandNote(),
          dataTestId: "agent-ai-settings-command-scoped",
        },
        {
          label: KUBERNETES_AI_SETTINGS_CLUSTER_WIDE_LABEL,
          code: commands.enableRemediation,
          note: getAiAgentClusterWideCommandNote(),
          dataTestId: "agent-ai-settings-command-cluster-wide",
        },
      ],
    };

    return {
      steps: [step],
      notes: [
        {
          text: getAiAgentWriteDisclosure(),
          dataTestId: "agent-ai-settings-write-disclosure",
        },
      ],
    };
  }

  return {
    steps: [
      {
        title: KUBERNETES_AI_SETTINGS_STEP_TITLE,
        description: KUBERNETES_AI_SETTINGS_STEP_DESCRIPTION,
        dataTestId: "agent-ai-settings-step-upgrade",
        ways: [
          {
            label: KUBERNETES_AI_SETTINGS_STEP_TITLE,
            code: commands.applySettings,
            dataTestId: "agent-ai-settings-command",
          },
        ],
      },
    ],
    notes:
      !areFixesOn(data.choice) && mayWriteNow
        ? [
            {
              text: KUBERNETES_AI_SETTINGS_FIXES_OFF_NOTE,
              dataTestId: "agent-ai-settings-fixes-off-note",
            },
          ]
        : [],
  };
}
