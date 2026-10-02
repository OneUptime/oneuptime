import IconProp from "Common/Types/Icon/IconProp";

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
 * How a badge is coloured:
 *
 * off:       nothing happens (investigation off, fixes Off).
 * on:        on, and a person stays in charge (investigation, Ask for
 *            approval).
 * automatic: some fixes run with nobody asked (Automatic).
 * bypass:    every allowed fix runs with nobody asked (Bypass approval).
 */
export type AiAccessBadgeTone = "off" | "on" | "automatic" | "bypass";

export interface AiAccessBadge {
  text: string;
  tone: AiAccessBadgeTone;
}

export const AI_FIXES_MODE_TONES: Readonly<
  Record<AiFixesMode, AiAccessBadgeTone>
> = {
  Disabled: "off",
  RequireApproval: "on",
  Automatic: "automatic",
  BypassApproval: "bypass",
};

// The icon each mode's card shows in the Change modal.
export const AI_FIXES_MODE_ICONS: Readonly<Record<AiFixesMode, IconProp>> = {
  Disabled: IconProp.NoSymbol,
  RequireApproval: IconProp.HandRaised,
  Automatic: IconProp.Bolt,
  BypassApproval: IconProp.ShieldExclamation,
};

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
