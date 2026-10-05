import IconProp from "Common/Types/Icon/IconProp";
import { AgentAiSettingsSource } from "Common/Types/AI/AgentAiSettings";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words and looks "What AI may do" shares between a Kubernetes
 * cluster's AI agent page (Pages/Kubernetes/View/AI/Agent.tsx) and every
 * other resource's (Components/ResourceAiAgent/ResourceAiAgentPage.tsx):
 * the two rows it shows (Investigation, Fixes), each with a badge that says
 * where the setting stands, and the icon and tone of each fixes mode.
 *
 * The fixes modes are the same four on both, with the same stored values
 * (KubernetesAiRemediationMode and ResourceAiRemediationMode), so either
 * enum reads as an AiFixesMode.
 *
 * Import-clean on purpose (Common types only), so the suites read it
 * without a browser.
 */

export type AiFixesMode =
  | "Disabled"
  | "RequireApproval"
  | "Automatic"
  | "BypassApproval";

/*
 * How a badge is coloured: off (gray) or on (green), and nothing else.
 *
 * "When fixes are enabled, why does it show in yellow? That makes me think
 * that fixes are not enabled, and I need to enable it." A badge answers one
 * question — is it on? — so every on mode reads on. What a mode does is in
 * its name (the badge's words: Ask for approval, Automatic, Bypass approval)
 * and its icon, never in a warning colour that reads as "something is
 * wrong".
 */
export type AiAccessBadgeTone = "off" | "on";

export interface AiAccessBadge {
  text: string;
  tone: AiAccessBadgeTone;
}

export const AI_FIXES_MODE_TONES: Readonly<
  Record<AiFixesMode, AiAccessBadgeTone>
> = {
  Disabled: "off",
  RequireApproval: "on",
  Automatic: "on",
  BypassApproval: "on",
};

// The icon each mode's card shows in the Change modal.
export const AI_FIXES_MODE_ICONS: Readonly<Record<AiFixesMode, IconProp>> = {
  Disabled: IconProp.NoSymbol,
  RequireApproval: IconProp.HandRaised,
  Automatic: IconProp.Bolt,
  BypassApproval: IconProp.ShieldExclamation,
};

/*
 * Where a cluster's or resource's investigation and fixes are set, as the
 * status reports it (status.aiSettingsSource). A status from a server older
 * than the field, or a value this build does not know, reads as
 * "oneuptime": the settings are edited here, as they always were, and the
 * server still refuses a change its agent's configuration does not allow.
 */
export function readAiSettingsSource(value: unknown): AgentAiSettingsSource {
  return value === "agent_configuration" || value === "agent_defaults"
    ? value
    : "oneuptime";
}

// What AI may do, as an agent's configuration says it.
export interface AgentAiSettingsChoice {
  investigation: boolean;
  fixes: AiFixesMode;
}

/*
 * The "Change what AI may do" dialog for settings an agent sets: its intro,
 * by where the settings are set now. {{agent}} is the agent's name.
 */
export const AGENT_AI_SETTINGS_DIALOG_INTRO: Readonly<
  Record<AgentAiSettingsSource, string>
> = {
  agent_configuration: translationKey(
    "What AI may do here is set in the {{agent}}'s configuration, so it is changed there, not on this page. Pick what AI may do, then run the command below. OneUptime applies it as soon as the agent restarts.",
  ),
  agent_defaults: translationKey(
    "The {{agent}} decides what AI may do here, with its defaults: its configuration sets neither setting. Pick what AI may do, then run the command below to set it there. OneUptime applies it as soon as the agent restarts.",
  ),
  oneuptime: translationKey(
    "These settings are chosen on this page today. Set them in the {{agent}}'s configuration instead and they follow the agent from then on: this page then shows them, read-only. Pick what AI may do, then run the command below.",
  ),
};

// The dialog's two choices and what follows them.
export const AGENT_AI_SETTINGS_INVESTIGATION_OPTIONS: Readonly<
  Record<"on" | "off", { title: string; description: string }>
> = {
  on: {
    title: translationKey("On"),
    description: translationKey(
      "AI may run read-only commands while it investigates. An investigation never changes anything.",
    ),
  },
  off: {
    title: translationKey("Off"),
    description: translationKey(
      "AI investigates with the data OneUptime already has, and runs no commands.",
    ),
  },
};

export const AGENT_AI_SETTINGS_COMMANDS_TITLE: string = translationKey(
  "Then run this where the agent runs",
);

export const AGENT_AI_SETTINGS_DONE_TEXT: string = translationKey(
  "Once the agent restarts, this page shows the new settings within a minute.",
);

/*
 * The hint under Fixes while fixes are Off and the agent sets them: the
 * Change button shows the command, whoever clicks it.
 */
export const AI_FIXES_OFF_AGENT_SET_HINT: string = translationKey(
  "Want AI to propose fixes? Click Change to get the command that turns them on in the agent.",
);

export const AI_ACCESS_INVESTIGATION_ROW_TITLE: string = "Investigation";
export const AI_ACCESS_FIXES_ROW_TITLE: string = "Fixes";

export function getAiInvestigationBadge(isEnabled: boolean): AiAccessBadge {
  return isEnabled ? { text: "On", tone: "on" } : { text: "Off", tone: "off" };
}

// The fixes badge: the mode's short name, in the mode's tone.
export function getAiFixesBadge(data: {
  mode: AiFixesMode;
  shortNames: Readonly<Record<AiFixesMode, string>>;
}): AiAccessBadge {
  return {
    text: data.shortNames[data.mode],
    tone: AI_FIXES_MODE_TONES[data.mode],
  };
}

/*
 * The card's description, for a place named the way sentences name it
 * ("database server", "cluster").
 */
export function getAiAccessCardDescription(noun: string): string {
  return `For incidents and alerts on this ${noun}. Changes apply from the next one.`;
}

/*
 * What the Investigation row says when investigation is off. Off is not
 * "AI does nothing": it still investigates, with what OneUptime already
 * has, it just runs nothing on the place itself.
 */
export function getAiInvestigationOffSentence(noun: string): string {
  return `AI does not run commands on this ${noun}. It still investigates with the data OneUptime already has.`;
}

/*
 * The next step under Fixes while fixes are Off, for someone who may turn
 * them on (the Change button, and the permission to loosen) and for
 * everyone else.
 */
export function getAiFixesOffHint(canTurnOnFixes: boolean): string {
  return canTurnOnFixes
    ? "Want AI to propose fixes? Click Change and choose Ask for approval."
    : "Want AI to propose fixes? Ask a project owner or admin to choose Ask for approval.";
}

// The Change modal's field description above the mode cards.
export function getAiFixesFieldDescription(noun: string): string {
  return `What AI does when it finds a fix for a problem on this ${noun}.`;
}

/*
 * A mode card's title in the Change modal. The saved mode is marked, so
 * whoever clicks around can still see what is in effect.
 */
export function getAiFixesModeCardTitle(data: {
  mode: AiFixesMode;
  savedMode: AiFixesMode;
  shortNames: Readonly<Record<AiFixesMode, string>>;
}): string {
  const name: string = data.shortNames[data.mode];

  return data.mode === data.savedMode ? `${name} (current)` : name;
}

export const AI_ACCESS_PROTECTIONS_TITLE: string =
  "What stays protected in every mode";

// A clause that already ends a sentence keeps its own punctuation.
const SENTENCE_END_REGEX: RegExp = /[.!?]$/;

/*
 * The every-mode protections, one clause each, as lines of a list:
 * capitalized and ending with a full stop.
 */
export function formatAiAccessProtections(
  clauses: ReadonlyArray<string>,
): Array<string> {
  return clauses
    .map((clause: string): string => {
      return clause.trim();
    })
    .filter((clause: string): boolean => {
      return clause.length > 0;
    })
    .map((clause: string): string => {
      const capitalized: string = `${clause[0]!.toUpperCase()}${clause.slice(1)}`;
      return SENTENCE_END_REGEX.test(capitalized)
        ? capitalized
        : `${capitalized}.`;
    });
}

/*
 * The same clauses as one sentence: "a; b; c; and d". What the Bypass
 * approval confirmation and the broad-allowlist confirmation say after
 * "Even so,".
 */
export function joinAiAccessProtections(
  clauses: ReadonlyArray<string>,
): string {
  if (clauses.length <= 1) {
    return clauses.join("");
  }

  return `${clauses.slice(0, -1).join("; ")}; and ${clauses[clauses.length - 1]}`;
}
