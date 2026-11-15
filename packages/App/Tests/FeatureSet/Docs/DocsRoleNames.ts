import { PermissionHelper, PermissionProps } from "Common/Types/Permission";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { escapeRegExp } from "./DocsTranslationChecks";

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
  return proseText(markdown).replace(BOLD_SPAN, " ");
}

// The page outside its code, its bold spans and bold leads included.
export function proseText(markdown: string): string {
  return markdown.replace(FENCED_CODE, " ").replace(INLINE_CODE, " ");
}

/*
 * ENGLISH A TRANSLATED PAGE KEEPS, THOUGH IT HAS A ROLE'S WORDS (#8315).
 *
 * A few names in running text have a built-in role's name in them but are
 * no OneUptime role: another product's role or window, which that product
 * names in English. And a few sentences are quoted as the product writes
 * them, in English whatever the reader's language. A translated page keeps
 * each as it is, so the role checks read past them, on the English page as
 * on the translations.
 */
export interface KeptEnglish {
  text: string;
  why: string;
}

export const KEPT_IN_ENGLISH: ReadonlyArray<KeptEnglish> = [
  {
    text: "Monitoring Viewer",
    why: "Google Cloud's IAM role, which the service account that reads Cloud Monitoring needs.",
  },
  {
    text: "Event Viewer",
    why: "The Windows Event Viewer, whose menus the host collector page quotes as Windows names them.",
  },
  {
    text: "Workflow steps can do only what a Project Admin of this project can do",
    why: "A refused step's reason, which the run log shows as the server writes it (LogComponentError), in English.",
  },
  {
    text: "A Project Owner or someone with Manage Billing can raise or remove the limit",
    why: "The refusal when a project's own AI limit is reached, quoted as the server writes it, in English.",
  },
  {
    text: "A Project Owner or someone with Manage Billing can add AI credits",
    why: "The refusal when a project's AI credits are used up, quoted as the server writes it, in English.",
  },
  {
    text: "Ask a Project Admin for access to it.",
    why: "The Slack and Microsoft Teams reply when a private incident is out of reach, quoted as the bot writes it, in English.",
  },
  {
    text: "Ask a Project Admin for access to them.",
    why: "The Slack and Microsoft Teams reply when no incident state is in reach, quoted as the bot writes it, in English.",
  },
];

/*
 * English that uses a role's word for something else - the people who
 * viewed a Power BI report, the logs and traces explorers' viewer - so an
 * English page names no role there, and a translation words it as prose.
 */
export const NOT_A_ROLE_IN_ENGLISH: ReadonlyArray<KeptEnglish> = [
  {
    text: "Viewers are named as Power BI names them",
    why: "The people who viewed a Power BI report, as Power BI's activity log names them.",
  },
  {
    text: "Open the Viewer",
    why: "The logs and traces explorers' viewer, a step's heading.",
  },
  {
    text: "in the Viewer to see these",
    why: "The logs explorer's viewer, where a key shows the shortcuts.",
  },
  {
    text: "the Viewer opens on the past hour",
    why: "The logs explorer's viewer, which opens on the past hour.",
  },
];

/*
 * The running text the role checks read: without the English kept on
 * purpose, and without the English that uses a role's word for something
 * else.
 */
export function roleText(markdown: string): string {
  return [...KEPT_IN_ENGLISH, ...NOT_A_ROLE_IN_ENGLISH].reduce(
    (text: string, kept: KeptEnglish): string => {
      return text.split(kept.text).join(" ");
    },
    runningText(markdown),
  );
}

/*
 * A built-in role's English name in running text, as a whole name, an
 * English plural "s" allowed ("Project Admins"); the longest name first, so
 * "Incident Viewer" is not also read as "Viewer". A name a compound ends
 * with is another thing's ("Trace-Viewer", the German page's trace
 * viewer), while a compound it starts is the role's ("Viewer-Rolle").
 */
const ENGLISH_ROLE_NAME: RegExp = new RegExp(
  `(?<![A-Za-z]|[A-Za-z]-)(${[...BUILT_IN_ROLE_NAMES]
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
  return [...englishRoleCounts(text).keys()];
}

/*
 * How often running text names each built-in role in English, the roles
 * in the order the text first names them.
 */
export function englishRoleCounts(text: string): Map<string, number> {
  const counts: Map<string, number> = new Map();

  for (const match of text.matchAll(ENGLISH_ROLE_NAME)) {
    const name: string = match[1] as string;

    counts.set(name, (counts.get(name) || 0) + 1);
  }

  return counts;
}

/*
 * The built-in roles a page in this language writes in English in its
 * running text although this language's Dashboard draws them otherwise.
 */
export function rolesLeftInEnglish(
  language: string,
  markdown: string,
): Array<string> {
  return englishRoleNamesIn(roleText(markdown)).filter(
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
  return new RegExp(drawnRolePattern(language, role), "u").test(text);
}

/*
 * How often running text names a role as this language's Dashboard draws
 * it, inflected as namesRoleAsDrawn allows: a page that names a role in
 * English five times names it as drawn five times, not once and then
 * "Projektadmins" or "プロジェクトのオーナー" (#8315).
 */
export function timesRoleNamedAsDrawn(
  language: string,
  text: string,
  role: string,
): number {
  return Array.from(
    text.matchAll(new RegExp(drawnRolePattern(language, role), "gu")),
  ).length;
}

function drawnRolePattern(language: string, role: string): string {
  const words: Array<string> = writtenPermissionTitle(language, role)
    .split(/\s+/)
    .filter((word: string): boolean => {
      return word.length > 0;
    });

  return words
    .map((word: string): string => {
      const letters: Array<string> = Array.from(word);
      const kept: string =
        letters.length <= 3
          ? word
          : letters.slice(0, Math.max(3, letters.length - 2)).join("");

      return escapeRegExp(kept) + (letters.length <= 3 ? "" : WORD_LETTERS);
    })
    .join("[\\s\\u200c]+");
}

/*
 * THE ENGLISH PAGES NAME THE ROLES THEY MEAN (#8493, #8595).
 *
 * A translation names each role its English page names (above), so a role
 * the English page words in general terms - "the project's owners are
 * emailed", "**A project owner or admin.**" - is a role no translation
 * names either: Japanese wrote "プロジェクトのオーナー", German "die
 * Eigentümer des Projekts". The English pages name the role instead:
 * "Project Owners are emailed", "**A Project Owner or Project Admin.**".
 *
 * These are the general words: a built-in role's name in lowercase ("a
 * project admin"; "project members", the people in a project, is not one),
 * "the project's owners" or "admins", and "owners and admins". They are
 * read outside code, bold leads included.
 */
const LOWERCASE_ROLE_NAME: RegExp = new RegExp(
  `(?<![A-Za-z])(${BUILT_IN_ROLE_NAMES.filter((name: string): boolean => {
    return name.includes(" ") && name !== "Project Member";
  })
    .map((name: string): string => {
      return escapeRegExp(name.toLowerCase());
    })
    .sort((first: string, second: string): number => {
      return second.length - first.length;
    })
    .join("|")})s?(?![A-Za-z])`,
  "g",
);

const GENERAL_ROLE_WORDS: ReadonlyArray<RegExp> = [
  LOWERCASE_ROLE_NAME,
  /\b(?:[Tt]he|[Aa]|[Yy]our) project's (?:owners?|admins?|administrators?)\b/g,
  /\b(?:[Oo]wners?|[Aa]dmins?) (?:and|or) (?:owners?|admins?)\b/g,
];

// General words that are not the built-in roles, and quotes of the product.
export const GENERAL_WORDS_NOT_THE_ROLES: ReadonlyArray<KeptEnglish> = [
  {
    text: "An organization admin or owner clicks **Connect with Slack**",
    why: "a Slack organization's own admin or owner",
  },
  {
    text: "a workspace can let only its owners and admins change them",
    why: "a Slack workspace's own owners and admins",
  },
  {
    text: "for example through the project's owner rules",
    why: "the project's incident and alert owner rules, not its owners",
  },
  {
    text: "this incident is private, so only its owners and the project's owners and admins can see it.",
    why: "the Slack and Microsoft Teams reply, quoted as the product writes it",
  },
];

/*
 * The general words for a built-in role in an English page's prose, in
 * order, past the ones listed as something else.
 */
export function generalRoleWords(markdown: string): Array<string> {
  const text: string = GENERAL_WORDS_NOT_THE_ROLES.reduce(
    (prose: string, kept: KeptEnglish): string => {
      return prose.split(kept.text).join(" ");
    },
    proseText(markdown),
  );

  return GENERAL_ROLE_WORDS.flatMap(
    (words: RegExp): Array<RegExpMatchArray> => {
      return Array.from(text.matchAll(words));
    },
  )
    .sort((first: RegExpMatchArray, second: RegExpMatchArray): number => {
      return (first.index || 0) - (second.index || 0);
    })
    .map((match: RegExpMatchArray): string => {
      return match[0];
    });
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
