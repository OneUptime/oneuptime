import CodeType from "../../../Types/Code/CodeType";
import { EditingRules } from "./CodeEditorCommands";

/*
 * Everything CodeEditor does differently per language, in one table. A
 * CodeType with no row here does not compile, so a new language cannot
 * silently fall back to some other language's behaviour.
 */

export type CodeValidator = "json" | "yaml";

export interface CodeLanguage {
  /** Named in the toolbar, and in the editor's accessible name. */
  label: string;
  /** The highlight.js grammar, or null to show plain text. */
  grammar: string | null;
  rules: EditingRules;
  /** Soft-wrap long lines. Only prose wraps; code scrolls sideways. */
  wrap: boolean;
  /**
   * Prose follows the caller's spell check preference. Code never gets it:
   * red squiggles under every key name are noise.
   */
  spellCheckFollowsCaller: boolean;
  /** Whether Tab may insert a tab character when the document uses them. */
  allowTabs: boolean;
  /** Checked as you type, with the result in the status bar. */
  validator: CodeValidator | null;
  /** Offers Format (JSON only: it never changes what the document says). */
  canFormat: boolean;
  /**
   * Draws tab characters. In YAML a tab is illegal as indentation and
   * otherwise indistinguishable from spaces.
   */
  showTabs: boolean;
}

const BRACKETS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

const NO_PAIRS: EditingRules = {
  brackets: {},
  quotes: [],
  lineComment: null,
  indentAfterColon: false,
};

type CodeLanguageInput = Partial<CodeLanguage> &
  Pick<CodeLanguage, "label" | "grammar" | "rules">;

type DefineFunction = (input: CodeLanguageInput) => CodeLanguage;

const define: DefineFunction = (input: CodeLanguageInput): CodeLanguage => {
  return {
    wrap: false,
    spellCheckFollowsCaller: false,
    allowTabs: true,
    validator: null,
    canFormat: false,
    showTabs: false,
    ...input,
  };
};

export const CODE_LANGUAGES: Record<CodeType, CodeLanguage> = {
  [CodeType.JSON]: define({
    label: "JSON",
    grammar: "json",
    rules: {
      brackets: { "[": "]", "{": "}" },
      quotes: ['"'],
      lineComment: null,
      indentAfterColon: false,
    },
    validator: "json",
    canFormat: true,
  }),
  [CodeType.YAML]: define({
    label: "YAML",
    grammar: "yaml",
    rules: {
      brackets: { "[": "]", "{": "}" },
      quotes: ['"', "'"],
      lineComment: "#",
      indentAfterColon: true,
    },
    allowTabs: false,
    validator: "yaml",
    showTabs: true,
  }),
  [CodeType.JavaScript]: define({
    label: "JavaScript",
    grammar: "javascript",
    rules: {
      brackets: BRACKETS,
      quotes: ['"', "'", "`"],
      lineComment: "//",
      indentAfterColon: false,
    },
  }),
  [CodeType.CSS]: define({
    label: "CSS",
    grammar: "css",
    rules: {
      brackets: BRACKETS,
      quotes: ['"', "'"],
      lineComment: null,
      indentAfterColon: false,
    },
  }),
  [CodeType.HTML]: define({
    label: "HTML",
    grammar: "xml",
    rules: {
      brackets: BRACKETS,
      quotes: ['"', "'"],
      lineComment: null,
      indentAfterColon: false,
    },
  }),
  [CodeType.SQL]: define({
    label: "SQL",
    grammar: "sql",
    rules: {
      brackets: { "(": ")" },
      quotes: ["'", '"'],
      lineComment: "--",
      indentAfterColon: false,
    },
  }),
  [CodeType.Bash]: define({
    label: "Bash",
    grammar: "bash",
    rules: {
      brackets: BRACKETS,
      quotes: ['"', "'"],
      lineComment: "#",
      indentAfterColon: false,
    },
  }),
  [CodeType.Markdown]: define({
    label: "Markdown",
    grammar: "markdown",
    rules: NO_PAIRS,
    wrap: true,
    spellCheckFollowsCaller: true,
  }),
  [CodeType.Text]: define({
    label: "Text",
    grammar: null,
    rules: NO_PAIRS,
  }),
};

export type GetCodeLanguageFunction = (type: CodeType) => CodeLanguage;

/*
 * Callers pass `type` from data as often as from a literal, so an unknown
 * value gets plain text rather than a crash.
 */
export const getCodeLanguage: GetCodeLanguageFunction = (
  type: CodeType,
): CodeLanguage => {
  return CODE_LANGUAGES[type] || CODE_LANGUAGES[CodeType.Text];
};
