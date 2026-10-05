import { AgentAiSettingsChoice, AiFixesMode } from "./AiAccessModes";

/*
 * How to set what OneUptime AI may do in an agent's own configuration, as
 * the "Change what AI may do" dialog shows it (AgentAiSettingsModal): a
 * few numbered steps, each with one or more ways of doing it (a tab per
 * way), and notes under them.
 *
 * Each page builds these from its own setup guide's commands — the cluster
 * page from the kubernetes-agent chart's helm upgrades
 * (Pages/Kubernetes/Utils/KubernetesAiAgentSettings.ts), a resource's page
 * from its AI agent's .env and restart command
 * (Components/ResourceAiAgent/ResourceAiAgentInstall.ts) — so the dialog
 * never tells anyone to run a command the guides do not.
 *
 * Strings are English keys (or already translated sentences from
 * translateTemplate), translated where the dialog draws them.
 *
 * Import-clean on purpose (Common types only), so the suites read it
 * without a browser.
 */

// One way of doing a step: a tab when the step has several.
export interface AgentAiSettingsWay {
  // The tab's label; unused when the step has one way.
  label: string;
  // A sentence before the command.
  intro?: string | undefined;
  // The command, or the lines to set, with a copy button.
  code?: string | undefined;
  // A sentence after the command.
  note?: string | undefined;
  dataTestId: string;
}

export interface AgentAiSettingsStep {
  title: string;
  description?: string | undefined;
  ways: Array<AgentAiSettingsWay>;
  dataTestId: string;
}

export interface AgentAiSettingsInstructions {
  // Above the steps: another way the agent may have been set up.
  intro?: Array<{ text: string; dataTestId: string }> | undefined;
  steps: Array<AgentAiSettingsStep>;
  // Under the steps: what the choice amounts to (write access, and so on).
  notes: Array<{ text: string; dataTestId: string }>;
}

// Does this choice let AI apply fixes at all?
export function areFixesOn(choice: AgentAiSettingsChoice): boolean {
  return choice.fixes !== "Disabled";
}

// The same choice, or not.
export function isSameAgentAiSettingsChoice(
  left: AgentAiSettingsChoice,
  right: AgentAiSettingsChoice,
): boolean {
  return (
    left.investigation === right.investigation && left.fixes === right.fixes
  );
}

/*
 * The choice the dialog opens on: what is in effect, with investigation
 * on when the step that opened it asked for that (the "Needs attention"
 * step "Turn on AI investigation").
 */
export function getInitialAgentAiSettingsChoice(data: {
  current: AgentAiSettingsChoice;
  turnOnInvestigation?: boolean | undefined;
}): AgentAiSettingsChoice {
  return {
    investigation: data.turnOnInvestigation ? true : data.current.investigation,
    fixes: data.current.fixes,
  };
}

// Every fixes mode, least autonomy first: the order the dialog lists them.
export const AGENT_AI_SETTINGS_FIXES_ORDER: ReadonlyArray<AiFixesMode> = [
  "Disabled",
  "RequireApproval",
  "Automatic",
  "BypassApproval",
];
