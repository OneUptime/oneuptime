import IconProp from "Common/Types/Icon/IconProp";
import { AgentAiSettingsSource } from "Common/Types/AI/AgentAiSettings";
import {
  composedValue,
  getGlobalTranslator,
  TemplateValues,
  translatableTerm,
  translateTemplate,
  translateText,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

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
 * The words are the Dashboard's translation keys (src/Locales/README.md): a
 * constant or a badge's text is the English key, looked up where it is
 * shown (the AiAccessRow components look up their own text); a function
 * answers in the reader's language.
 *
 * Import-clean on purpose (Common types and the translation helpers only),
 * so the suites read it without a browser.
 */

export type AiFixesMode =
  | "Disabled"
  | "RequireApproval"
  | "Automatic"
  | "BypassApproval";

/*
 * How a badge is coloured: a setting is off (gray) or on (green), and
 * nothing else.
 *
 * "When fixes are enabled, why does it show in yellow? That makes me think
 * that fixes are not enabled, and I need to enable it." A badge answers one
 * question — is it on? — so every on mode reads on. What a mode does is in
 * its name (the badge's words: Ask for approval, Automatic, Bypass approval)
 * and its icon, never in a warning colour that reads as "something is
 * wrong".
 *
 * danger is for that alone: something that should work does not (an AI
 * agent that went offline, on the Overview's AI agent card) — never a
 * setting.
 */
export type AiAccessBadgeTone = "off" | "on" | "danger";

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

export const AI_ACCESS_INVESTIGATION_ROW_TITLE: string =
  translationKey("Investigation");
export const AI_ACCESS_FIXES_ROW_TITLE: string = translationKey("Fixes");

const AI_INVESTIGATION_ON: string = translationKey("On");
const AI_INVESTIGATION_OFF: string = translationKey("Off");

export function getAiInvestigationBadge(isEnabled: boolean): AiAccessBadge {
  return isEnabled
    ? { text: AI_INVESTIGATION_ON, tone: "on" }
    : { text: AI_INVESTIGATION_OFF, tone: "off" };
}

/*
 * The fixes badge: the mode's short name (a key, looked up where the badge
 * is drawn), in the mode's tone.
 */
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
  return translateTemplate(
    "For incidents and alerts on this {{noun}}. Changes apply from the next one.",
    { noun: translatableTerm(noun, { inSentence: true }) },
  );
}

/*
 * What the Investigation row says when investigation is off. Off is not
 * "AI does nothing": it still investigates, with what OneUptime already
 * has, it just runs nothing on the place itself. In the reader's language:
 * the Overview's AI agent card shows it too.
 */
export function getAiInvestigationOffSentence(noun: string): string {
  return translateTemplate(
    "AI does not run commands on this {{noun}}. It still investigates with the data OneUptime already has.",
    { noun: translatableTerm(noun, { inSentence: true }) },
  );
}

/*
 * The next step under Fixes while fixes are Off, for someone who may turn
 * them on (the Change button, and the permission to loosen) and for
 * everyone else.
 */
export function getAiFixesOffHint(canTurnOnFixes: boolean): string {
  return translateTemplate(
    canTurnOnFixes
      ? "Want AI to propose fixes? Click Change and choose Ask for approval."
      : "Want AI to propose fixes? Ask a project owner or admin to choose Ask for approval.",
  );
}

// The Change modal's field description above the mode cards.
export function getAiFixesFieldDescription(noun: string): string {
  return translateTemplate(
    "What AI does when it finds a fix for a problem on this {{noun}}.",
    { noun: translatableTerm(noun, { inSentence: true }) },
  );
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

  return data.mode === data.savedMode
    ? translateTemplate("{{mode}} (current)", { mode: translatableTerm(name) })
    : translateText(name) || name;
}

export const AI_ACCESS_PROTECTIONS_TITLE: string = translationKey(
  "What stays protected in every mode",
);

// A clause that already ends a sentence keeps its own punctuation.
const SENTENCE_END_REGEX: RegExp = /[.!?。！？।؟]$/u;

// Chinese and Japanese end a sentence with 。, Hindi with ।.
const IDEOGRAPHIC_END_REGEX: RegExp =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u;
const DEVANAGARI_END_REGEX: RegExp = /\p{Script=Devanagari}$/u;

/*
 * Scripts without capital letters. A clause in one keeps its first letter
 * as it is: a code name it may start with ("kubectl", "kube-system") must
 * not read "Kubectl".
 */
const CASELESS_SCRIPT_REGEX: RegExp =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Devanagari}\p{Script=Arabic}]/u;

// Chinese and Japanese list with 、, Persian with ،.
const IDEOGRAPHIC_REGEX: RegExp =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const ARABIC_SCRIPT_REGEX: RegExp = /\p{Script=Arabic}/u;

// The separator between clauses listed in a sentence, by their script.
function getListSeparator(clauses: ReadonlyArray<string>): string {
  if (
    clauses.some((clause: string): boolean => {
      return IDEOGRAPHIC_REGEX.test(clause);
    })
  ) {
    return "、";
  }

  if (
    clauses.some((clause: string): boolean => {
      return ARABIC_SCRIPT_REGEX.test(clause);
    })
  ) {
    return "، ";
  }

  return ", ";
}

// The full stop of the script a clause ends in.
function getFullStop(clause: string): string {
  if (IDEOGRAPHIC_END_REGEX.test(clause)) {
    return "。";
  }

  if (DEVANAGARI_END_REGEX.test(clause)) {
    return "।";
  }

  return ".";
}

/*
 * The every-mode protections, one clause each, as lines of a list:
 * capitalized and ending with a full stop - the full stop of the language
 * the clause is in, translated or not.
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
      const capitalized: string = capitalizeFirst(clause);
      return SENTENCE_END_REGEX.test(capitalized)
        ? capitalized
        : `${capitalized}${getFullStop(capitalized)}`;
    });
}

/*
 * The clauses joined into one, by how many there are: each a whole key, so
 * a locale sets its own separators and "and" (French puts a space before
 * the semicolon).
 */
const PROTECTIONS_JOINED: Readonly<Record<2 | 3 | 4, string>> = {
  2: translationKey("{{first}}; and {{second}}"),
  3: translationKey("{{first}}; {{second}}; and {{third}}"),
  4: translationKey("{{first}}; {{second}}; {{third}}; and {{fourth}}"),
};

const PROTECTION_SLOTS: ReadonlyArray<string> = [
  "first",
  "second",
  "third",
  "fourth",
];

/*
 * The same clauses as one sentence: "a; b; c; and d". What the Bypass
 * approval confirmation and the broad-allowlist confirmation say after
 * "Even so,". Built with `translator`: hand it in as a composedValue() of
 * the sentence it goes into, so it is in that sentence's language.
 */
export function joinAiAccessProtections(
  clauses: ReadonlyArray<string>,
  translator: Translator = getGlobalTranslator(),
): string {
  if (clauses.length <= 1) {
    return clauses.join("");
  }

  // Never more than four today; any more are said together as the first.
  if (clauses.length > 4) {
    const together: number = clauses.length - 3;

    return joinAiAccessProtections(
      [clauses.slice(0, together).join("; "), ...clauses.slice(together)],
      translator,
    );
  }

  const values: TemplateValues = {};

  clauses.forEach((clause: string, index: number): void => {
    values[PROTECTION_SLOTS[index]!] = clause;
  });

  return translator.translateTemplate(
    PROTECTIONS_JOINED[clauses.length as 2 | 3 | 4],
    values,
  );
}

export type NameListConjunction = "and" | "or";

/*
 * Names joined the way a sentence lists them, by how many there are: each
 * shape a whole key, so a locale sets its own separator and word.
 */
const NAME_LISTS: Readonly<
  Record<NameListConjunction, Readonly<Record<2 | 3, string>>>
> = {
  and: {
    2: translationKey("{{first}} and {{second}}"),
    3: translationKey("{{first}}, {{second}} and {{third}}"),
  },
  or: {
    2: translationKey("{{first}} or {{second}}"),
    3: translationKey("{{first}}, {{second}} or {{third}}"),
  },
};

/*
 * "a, b and c" / "a, b or c". Built with `translator`: hand it in as a
 * composedValue() of the sentence it goes into, so it is in that sentence's
 * language.
 */
export function formatNameList(
  names: ReadonlyArray<string>,
  conjunction: NameListConjunction,
  translator: Translator = getGlobalTranslator(),
): string {
  if (names.length <= 1) {
    return names.join("");
  }

  // Never more than three today; any more are said together as the first.
  if (names.length > 3) {
    const together: number = names.length - 2;

    return formatNameList(
      [names.slice(0, together).join(", "), ...names.slice(together)],
      conjunction,
      translator,
    );
  }

  const [first, second, third] = names;

  return translator.translateTemplate(
    NAME_LISTS[conjunction][names.length as 2 | 3],
    third === undefined
      ? { first: first!, second: second! }
      : { first: first!, second: second!, third },
  );
}

/*
 * The first letter as a sentence starts it: capitalized, unless the text is
 * in a script without capitals (see CASELESS_SCRIPT_REGEX).
 */
export function capitalizeFirst(value: string): string {
  if (value.length === 0 || CASELESS_SCRIPT_REGEX.test(value)) {
    return value;
  }

  return `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

/*
 * What a save that loosens what AI may do says to someone without the
 * permissions it takes: what it would loosen, as clauses built with the
 * sentence's translator and listed the way their script lists them, then
 * the permissions.
 */
export function getAiAccessLooseningRefusal(data: {
  getChanges: (translator: Translator) => Array<string>;
  permissionTitles: ReadonlyArray<string>;
}): string {
  return translateTemplate(
    "{{changes}} needs one of these permissions: {{permissions}}.",
    {
      changes: composedValue((translator: Translator): string => {
        const changes: Array<string> = data.getChanges(translator);

        return capitalizeFirst(changes.join(getListSeparator(changes)));
      }),
      permissions: data.permissionTitles.join(", "),
    },
  );
}

/*
 * Why the connection test is locked, for the disabled button's tooltip and
 * note: it spends the agent's time, so it takes edit access to the place.
 */
export function getAiAccessTestPermissionRequirement(
  data: { noun: string; permissionTitles: ReadonlyArray<string> },
  translator: Translator = getGlobalTranslator(),
): string {
  return translator.translateTemplate(
    "Testing the connection needs permission to edit this {{noun}} (one of: {{permissions}}).",
    {
      noun: translatableTerm(data.noun, { inSentence: true }),
      permissions: data.permissionTitles.join(", "),
    },
  );
}

/*
 * What a refused test says. The server's sentence for the route may talk
 * about CHANGING the place's AI access, which the user did not try.
 */
export function getAiAccessTestPermissionMessage(data: {
  noun: string;
  permissionTitles: ReadonlyArray<string>;
}): string {
  return translateTemplate(
    "{{requirement}} Nothing on the {{noun}} or in its AI settings was changed.",
    {
      requirement: composedValue((translator: Translator): string => {
        return getAiAccessTestPermissionRequirement(data, translator);
      }),
      noun: translatableTerm(data.noun, { inSentence: true }),
    },
  );
}
