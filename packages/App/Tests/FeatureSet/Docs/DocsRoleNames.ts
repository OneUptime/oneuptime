import { PermissionHelper, PermissionProps } from "Common/Types/Permission";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import { drawnDashboardLabel } from "./DocsDashboardLabels";

/*
 * THE BUILT-IN ROLES' NAMES, IN EVERY DOCS LANGUAGE.
 *
 * The Dashboard draws a built-in role's name in the reader's language: each
 * name is a key of its own (Components/Permission/RoleCardSelectOptions
 * ROLE_NAMES), and the role picker, the Built-in Roles card, the team and
 * API key permission tables and the "You need one of these permissions"
 * refusals all look it up. So a translated docs page names a role the way
 * its Dashboard draws it (drawnDashboardLabel) - Project Owner, Incident
 * Viewer and the rest are no longer kept in English the way a permission's
 * own title is ("Create Incident", "Manage Billing").
 *
 * The roles are the permissions Common/Types/Permission marks as role
 * permissions, so a new built-in role is a name here at once.
 */
export const BUILT_IN_ROLE_NAMES: ReadonlyArray<string> =
  PermissionHelper.getRolePermissionProps().map(
    (props: PermissionProps): string => {
      return props.title;
    },
  );

// Whether a bold name is a built-in role's name.
export function isBuiltInRoleName(name: string): boolean {
  return BUILT_IN_ROLE_NAMES.includes(name);
}

/*
 * A role's or a permission's title as a page in a language writes it: a
 * built-in role's name as that language's Dashboard draws it, a
 * permission's own title as it is ("Edit LLM", "Manage Billing").
 */
export function writtenPermissionTitle(
  language: string,
  title: string,
): string {
  return isBuiltInRoleName(title)
    ? drawnDashboardLabel(language, title)
    : title;
}

/*
 * BUILT-IN ROLES IN RUNNING TEXT (#7514).
 *
 * The suites that hold a page to the Dashboard read its bold spans, so a
 * role named in a sentence or a table cell - "Project Owners, Project
 * Admins and anyone with Edit Project can change the prefixes" - was left
 * in English in every translation, while each language's Dashboard draws
 * it in its own words. These read the running text instead: the page
 * without its code, its inline code and its bold spans, which other checks
 * hold.
 */
const FENCED_CODE: RegExp = /^ {0,3}```[\s\S]*?^ {0,3}```[^\n]*$/gm;
const INLINE_CODE: RegExp = /`[^`\n]*`/g;
const BOLD_SPAN: RegExp = /\*\*[^*\n]+?\*\*/g;

// The page's running text: what is left once code and bold spans are out.
export function runningText(markdown: string): string {
  return markdown
    .replace(FENCED_CODE, " ")
    .replace(INLINE_CODE, " ")
    .replace(BOLD_SPAN, " ");
}

/*
 * A built-in role's English name in running text, as a whole name, an
 * English plural "s" allowed ("Project Admins"); the longest name first, so
 * "Incident Viewer" is not also read as "Viewer".
 */
const ENGLISH_ROLE_NAME: RegExp = new RegExp(
  `(?<![A-Za-z])(${[...BUILT_IN_ROLE_NAMES]
    .sort((first: string, second: string): number => {
      return second.length - first.length;
    })
    .map((name: string): string => {
      return escapeRegExp(name);
    })
    .join("|")})s?(?![A-Za-z])`,
  "g",
);

// The built-in roles running text names in English, each once, in order.
export function englishRoleNamesIn(text: string): Array<string> {
  const names: Array<string> = [];

  for (const match of text.matchAll(ENGLISH_ROLE_NAME)) {
    const name: string = match[1] as string;

    if (!names.includes(name)) {
      names.push(name);
    }
  }

  return names;
}

/*
 * The built-in roles a page in this language writes in English in its
 * running text although this language's Dashboard draws them otherwise.
 */
export function rolesLeftInEnglish(
  language: string,
  markdown: string,
): Array<string> {
  return englishRoleNamesIn(runningText(markdown)).filter(
    (name: string): boolean => {
      return writtenPermissionTitle(language, name) !== name;
    },
  );
}

// A letter, a combining mark or Persian's zero-width non-joiner.
const WORD_LETTERS: string = "[\\p{L}\\p{M}\\u200c]*";

/*
 * Whether running text names a role as this language's Dashboard draws it,
 * inflected as the sentence needs: each word of the drawn name, its last
 * two letters free for a plural or a case ending ("Projektadministratoren"
 * for Projektadministrator, "Propriétaires du projet", "Владельцы
 * проекта"), a short word as it is.
 */
export function namesRoleAsDrawn(
  language: string,
  text: string,
  role: string,
): boolean {
  const words: Array<string> = writtenPermissionTitle(language, role)
    .split(/\s+/)
    .filter((word: string): boolean => {
      return word.length > 0;
    });
  const pattern: string = words
    .map((word: string): string => {
      const letters: Array<string> = Array.from(word);
      const kept: string =
        letters.length <= 3
          ? word
          : letters.slice(0, Math.max(3, letters.length - 2)).join("");

      return escapeRegExp(kept) + (letters.length <= 3 ? "" : WORD_LETTERS);
    })
    .join("[\\s\\u200c]+");

  return new RegExp(pattern, "u").test(text);
}

/*
 * Whether a bold name is a permission's own title - which every language
 * keeps in English, as the permission picker draws it - and not a built-in
 * role's name, which reads in the page's language.
 */
export function isPermissionTitleKeptInEnglish(name: string): boolean {
  return (
    !isBuiltInRoleName(name) &&
    PermissionHelper.getAllPermissionProps().some(
      (props: PermissionProps): boolean => {
        return props.title === name;
      },
    )
  );
}
