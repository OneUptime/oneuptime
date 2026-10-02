/*
 * The words the template variable pickers show of their own: the collapsed
 * list under a field, the editor's Insert variable button and the list that
 * opens while "{{" is typed. The variables' own descriptions come with them.
 *
 * Kept in one React-free module so the components render these exact
 * strings and App/Tests/Dashboard/TemplateVariablesI18n can check that each
 * has an entry in all seventeen Dashboard locale files - a string is
 * translated by looking up its English text, so one with no entry silently
 * stays English.
 *
 * Only typingHint holds braces, and they are its {{braces}} slot: the
 * sentence is translated whole, and the two opening braces are drawn as a
 * key into the slot (translateTemplateAround), never looked up.
 */

export const TemplateVariablesCopy: {
  listTitle: string;
  insertButton: string;
  searchPlaceholder: string;
  noMatches: string;
  clickToInsert: string;
  typingHint: string;
} = {
  listTitle: "Template variables",
  insertButton: "Insert variable",
  searchPlaceholder: "Search variables",
  noMatches: "No variables match your search.",
  clickToInsert: "Click a variable to add it where your cursor is.",
  typingHint:
    "You can also type {{braces}} in the field to pick one as you write.",
};

// The slot in typingHint, and what is drawn in it.
export const TYPING_HINT_SLOT: string = "braces";
export const TYPING_HINT_KEYS: string = "{{";

export default TemplateVariablesCopy;
