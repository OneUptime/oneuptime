import { PermissionHelper, PermissionProps } from "Common/Types/Permission";
import { isProductLevelPermission } from "Common/Types/Product/ProductLevels";
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
  {
    text: "so only its owners, Project Owners and Project Admins can see it.",
    why: "The Slack and Microsoft Teams reply on a private incident the person does not own, quoted as the bot writes it, in English.",
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

/*
 * A PRODUCT'S LEVEL IS NOT A BUILT-IN ROLE (#11396).
 *
 * A product level's name ends with a project-wide role's word ("Cloud
 * Viewer", "Host Viewer"), so the English pattern above reads it as that
 * role: "A Cloud Viewer can read them" named the Viewer, and the German
 * page passed only because the drawn-name pattern found Betrachter inside
 * Cloud-Betrachter. An English page's roles are counted without its
 * product levels, as the locale check counts a key's
 * (BuiltInRoleNamesInLocales); a level that is also a built-in role's name
 * stays.
 */
const PRODUCT_LEVEL_TITLES: ReadonlyArray<string> =
  PermissionHelper.getAllPermissionProps()
    .filter((props: PermissionProps): boolean => {
      return isProductLevelPermission(props.permission);
    })
    .map((props: PermissionProps): string => {
      return props.title;
    })
    .filter((title: string): boolean => {
      return !BUILT_IN_ROLE_NAMES.includes(title);
    })
    .sort((first: string, second: string): number => {
      return second.length - first.length;
    });

export function productLevelTitles(): ReadonlyArray<string> {
  return PRODUCT_LEVEL_TITLES;
}

// Text without the product levels it names, the longest read first.
export function withoutProductLevelNames(text: string): string {
  return PRODUCT_LEVEL_TITLES.reduce((rest: string, title: string): string => {
    return rest.split(title).join(" ");
  }, text);
}

/*
 * How often an English page's running text names each built-in role: its
 * role text (roleText) without the product levels it names.
 */
export function englishPageRoleCounts(markdown: string): Map<string, number> {
  return englishRoleCounts(withoutProductLevelNames(roleText(markdown)));
}

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

/*
 * A ROLE'S DRAWN NAME COUNTS AS A WORD OF ITS OWN, OR AN INFLECTION OF IT
 * (#11396).
 *
 * A sentence names a role as its Dashboard draws it, inflected as the
 * sentence needs. The rule used to be each word's first letters and then any
 * letters at all, so a short name kept only three, and nothing said where a
 * word starts. The Norwegian Viewer, Leser, was "Les" and whatever followed
 * it: the heading "### Les dekningen" ("Read the coverage") counted as the
 * Viewer, and so did Lese, Lesinger and Leseoperasjoner. Hindi's Viewer,
 * दर्शक, read दर्ज ("recorded") and the दर्भ of संदर्भ ("reference"); the
 * Persian Project Owner, مالک پروژه, read مالی ("financial"); Russian's
 * Administrator read Административные; the Spanish Viewer, Visor, read
 * Visión and Vista; and Sicherheits-Betrachter, the German Security Viewer,
 * counted as a Viewer too.
 *
 * So a drawn name counts:
 *   - only where a word starts: no letter, mark, digit or zero-width
 *     non-joiner right before it, nor a letter and a hyphen
 *     ("Sicherheits-Betrachter" is the Security Viewer's). Arabic writes
 *     "and", "to", "by" and "like" onto the noun ("لمالك المشروع", "to the
 *     Project Owner"), so there a word may start with them. Japanese and
 *     Chinese run their words together, so there a name counts wherever it
 *     is, as drawn;
 *   - as drawn, or with one of its language's endings on the word a
 *     sentence inflects: the first in French, Spanish, Italian, Portuguese,
 *     Russian, Persian and Arabic, the last in Hindi and Korean, and the one
 *     word in German, Dutch and the Scandinavian languages. The endings are
 *     the ones the docs and the locales use, listed per language below;
 *   - as the role whose name is longest where two would match, as English
 *     reads "Incident Viewer" once and not also as a "Viewer": "Lecteur des
 *     incidents" is the Incident Viewer, and インシデント閲覧者 holds no
 *     Viewer (閲覧者) of its own.
 */
interface RoleNameGrammar {
  // The word of a drawn name a sentence inflects (its head noun), or none.
  head: "first" | "last" | "none";
  /*
   * How the head may end instead: a word that ends with the first may end
   * with the second, a regular expression ("" appends it).
   */
  endings: ReadonlyArray<readonly [string, string]>;
  /*
   * How the last word of a name of several words may end, where a sentence
   * writes onto the end of the whole name: Persian's "a", "of" and "its"
   * ("هیچ مدیر امنیتی", "no Security Admin"; "مالکان پروژهٔ شما", "your
   * Project Owners").
   */
  phraseEndings?: ReadonlyArray<readonly [string, string]>;
  // What a sentence may write onto the front of the name, a regex.
  prefixes?: string;
  // Whether the name counts only where a word starts and ends.
  wordBounded: boolean;
}

// Each ending appended to the word as it is.
function appended(
  endings: ReadonlyArray<string>,
): Array<readonly [string, string]> {
  return endings.map((ending: string): readonly [string, string] => {
    return ["", ending];
  });
}

// Danish and Norwegian: medlem, medlemmer, medlemmerne; Seer, Seere, Seerne.
const DANO_NORWEGIAN_ENDINGS: ReadonlyArray<readonly [string, string]> = [
  ...appended(["e", "en", "ene", "er", "ere", "erne", "es", "ens", "ne", "s"]),
  ["em", "emme(?:r|rne|ne|t|ts)"],
];

// After a Persian noun: a plural, and then "his", "their", "a", "of".
const PERSIAN_SUFFIX: string =
  "(?:ان(?:ش|شان|ت|تان|م|مان|ی)?|\\u200c?ها(?:ی|یش|یشان|یت|یتان|یم|یمان)?|ش|شان|ت|تان|م|مان|ی|\\u200cای|\\u200cی|ند|\\u200cاند|[\\u0650\\u0654])?";
/*
 * After the last word of a Persian name: its ezafe, "a", "its" or "are",
 * but no plural, which is the head's (مدیر پروژه‌ها is the projects' admin).
 */
const PERSIAN_PHRASE_SUFFIX: string =
  "(?:[\\u0650\\u0654]|\\u200c(?:ای|ی|اش|ات|ام|شان|تان|مان|است|اند)|ی|ش|شان|ت|تان|م|مان|ست|ند)?";

const ROLE_NAME_GRAMMAR: Readonly<Record<string, RoleNameGrammar>> = {
  // English names a role in English: Project Owners, a Project Admin's.
  en: {
    head: "last",
    wordBounded: true,
    endings: appended(["s", "'s", "s'", "’s", "s’"]),
  },
  // Projektadministratoren, Projektinhabern, Projektmitglieder(n).
  de: {
    head: "first",
    wordBounded: true,
    endings: appended(["s", "es", "n", "en", "er", "ern"]),
  },
  // Projecteigenaren, Projectbeheerders, Projectleden.
  nl: {
    head: "first",
    wordBounded: true,
    endings: [
      ...appended(["s", "'s", "en"]),
      ["aar", "aren"],
      ["lid", "leden"],
    ],
  },
  da: { head: "first", wordBounded: true, endings: DANO_NORWEGIAN_ENDINGS },
  no: { head: "first", wordBounded: true, endings: DANO_NORWEGIAN_ENDINGS },
  // Projektadministratörer(na), Projektägarna, Projektmedlemmar.
  sv: {
    head: "first",
    wordBounded: true,
    endings: [
      ...appended(["s", "n", "ns", "en", "ens", "er", "erna", "ernas"]),
      ["are", "arn(?:a|as)"],
      ["em", "emma(?:r|rna|rnas|rs)"],
      ["em", "emmen"],
    ],
  },
  // Propriétaires du projet, Administratrices.
  fr: {
    head: "first",
    wordBounded: true,
    endings: [...appended(["s"]), ["eur", "rices?"]],
  },
  // Propietarios, Administradores, Administradoras.
  es: {
    head: "first",
    wordBounded: true,
    endings: [...appended(["s", "es"]), ["o", "as?"], ["or", "oras?"]],
  },
  // Proprietari, Amministratori, Membri, Amministratrice.
  it: {
    head: "first",
    wordBounded: true,
    endings: [
      ["o", "[iae]"],
      ["io", "i"],
      ["e", "i"],
      ["ore", "ric[ei]"],
    ],
  },
  // Proprietários, Administradores, Administradora(s).
  pt: {
    head: "first",
    wordBounded: true,
    endings: [...appended(["s", "es"]), ["o", "as?"], ["or", "oras?"]],
  },
  // Администраторы, Владельцам, Участником, Зрители.
  ru: {
    head: "first",
    wordBounded: true,
    endings: [
      ...appended(["а", "у", "ом", "е", "ы", "и", "ов", "ам", "ами", "ах"]),
      ["ь", "(?:я|ю|ем|е|и|ей|ям|ями|ях)"],
      ["ец", "ьц(?:а|у|ем|е|ы|ев|ам|ами|ах)"],
    ],
  },
  // प्रोजेक्ट स्वामियों, प्रोजेक्ट सदस्यों, दर्शकों.
  hi: {
    head: "last",
    wordBounded: true,
    endings: [...appended(["ों"]), ["ी", "ियों"]],
  },
  // مالکان پروژه، مدیرِ پروژه، بینندگان؛ عضو پروژه‌ای، مدیر امنیتی.
  fa: {
    head: "first",
    wordBounded: true,
    endings: [...appended([PERSIAN_SUFFIX]), ["ه", "گان(?:ش|شان|ی)?"]],
    phraseEndings: appended([PERSIAN_PHRASE_SUFFIX]),
  },
  /*
   * مالكو المشروع، مسؤولي المشروع، أعضاء المشروع; and "and", "so", "by",
   * "to", "like" written onto the noun: ومسؤولو المشروع، لمالك المشروع.
   */
  ar: {
    head: "first",
    wordBounded: true,
    prefixes: "(?:[وف]?[بلك]?)",
    endings: [...appended(["[ويا]"]), ["عضو", "أعضاء"]],
  },
  // 프로젝트 관리자가, 프로젝트 구성원과, 관리자에게만: a particle, or several.
  ko: {
    head: "last",
    wordBounded: true,
    endings: appended(["[\\uac00-\\ud7a3]+"]),
  },
  ja: { head: "none", wordBounded: false, endings: [] },
  "zh-CN": { head: "none", wordBounded: false, endings: [] },
  "zh-TW": { head: "none", wordBounded: false, endings: [] },
};

// The languages whose role names the checks know how to read.
export const LANGUAGES_WITH_ROLE_NAME_GRAMMAR: ReadonlyArray<string> =
  Object.keys(ROLE_NAME_GRAMMAR);

function roleNameGrammar(language: string): RoleNameGrammar {
  const grammar: RoleNameGrammar | undefined = ROLE_NAME_GRAMMAR[language];

  if (!grammar) {
    throw new Error(
      `DocsRoleNames knows no grammar for "${language}": add how its sentences inflect a role's name to ROLE_NAME_GRAMMAR, from that language's docs and locales.`,
    );
  }

  return grammar;
}

// Right before a word: no letter, mark, digit or ZWNJ, nor a letter and a hyphen.
const WORD_START: string =
  "(?<![\\p{L}\\p{M}\\p{N}\\u200c])(?<![\\p{L}\\p{M}\\p{N}]-)";
// Right after one: no letter, mark, digit or ZWNJ.
const WORD_END: string = "(?![\\p{L}\\p{M}\\p{N}\\u200c])";

// A word as drawn, or with one of the endings given.
function inflectedPattern(
  word: string,
  endings: ReadonlyArray<readonly [string, string]>,
): string {
  const forms: Array<string> = [escapeRegExp(word)];

  // An ending may be the whole word: Arabic's عضو, whose plural is أعضاء.
  for (const [ending, replacement] of endings) {
    if (word.endsWith(ending)) {
      forms.push(
        `${escapeRegExp(word.slice(0, word.length - ending.length))}(?:${replacement})`,
      );
    }
  }

  return `(?:${forms.join("|")})`;
}

// One role's drawn name, as a sentence may write it (no capturing group).
export function drawnRolePattern(language: string, role: string): string {
  const grammar: RoleNameGrammar = roleNameGrammar(language);
  const words: Array<string> = writtenPermissionTitle(language, role)
    .split(/\s+/)
    .filter((word: string): boolean => {
      return word.length > 0;
    });
  const head: number =
    grammar.head === "first"
      ? 0
      : grammar.head === "last"
        ? words.length - 1
        : -1;
  const last: number = words.length > 1 ? words.length - 1 : -1;
  const name: string = words
    .map((word: string, index: number): string => {
      if (index === head) {
        return inflectedPattern(word, grammar.endings);
      }
      if (index === last && grammar.phraseEndings) {
        return inflectedPattern(word, grammar.phraseEndings);
      }
      return escapeRegExp(word);
    })
    .join("[\\s\\u200c]+");

  if (!grammar.wordBounded) {
    return name;
  }

  return `${WORD_START}${grammar.prefixes || ""}${name}${WORD_END}`;
}

/*
 * Every role's drawn name in one pattern, the longest first, each in a
 * group of its own: the roles in group order.
 */
interface RoleNamesPattern {
  pattern: RegExp;
  roles: Array<string>;
}

const ROLE_NAMES_PATTERNS: Map<string, RoleNamesPattern> = new Map();

function roleNamesPattern(language: string): RoleNamesPattern {
  const cached: RoleNamesPattern | undefined =
    ROLE_NAMES_PATTERNS.get(language);

  if (cached) {
    return cached;
  }

  // Before the drawn names are looked up, so the error names what is missing.
  roleNameGrammar(language);

  const roles: Array<string> = [...BUILT_IN_ROLE_NAMES].sort(
    (first: string, second: string): number => {
      return (
        writtenPermissionTitle(language, second).length -
        writtenPermissionTitle(language, first).length
      );
    },
  );
  const built: RoleNamesPattern = {
    pattern: new RegExp(
      roles
        .map((role: string): string => {
          return `(${drawnRolePattern(language, role)})`;
        })
        .join("|"),
      "gu",
    ),
    roles,
  };

  ROLE_NAMES_PATTERNS.set(language, built);

  return built;
}

/*
 * Each built-in role running text names as this language's Dashboard draws
 * it, inflected as its sentence needs, in the order the text names them,
 * each time it does.
 */
export function rolesNamedAsDrawn(
  language: string,
  text: string,
): Array<string> {
  const { pattern, roles }: RoleNamesPattern = roleNamesPattern(language);

  return Array.from(text.matchAll(pattern)).map(
    (match: RegExpMatchArray): string => {
      const group: number = match.slice(1).findIndex((value: unknown) => {
        return value !== undefined;
      });

      return roles[group] as string;
    },
  );
}

/*
 * Whether running text names a role as this language's Dashboard draws it,
 * inflected as the sentence needs ("Projektadministratoren" for
 * Projektadministrator, "Propriétaires du projet", "Владельцы проекта").
 */
export function namesRoleAsDrawn(
  language: string,
  text: string,
  role: string,
): boolean {
  return timesRoleNamedAsDrawn(language, text, role) > 0;
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
  return rolesNamedAsDrawn(language, text).filter((named: string): boolean => {
    return named === role;
  }).length;
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

// General words that are not the built-in roles.
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
];

/*
 * The general words for a built-in role in an English page's prose, in
 * order, past the ones listed as something else.
 */
export function generalRoleWords(markdown: string): Array<string> {
  return generalRoleWordsIn(
    GENERAL_WORDS_NOT_THE_ROLES.reduce(
      (prose: string, kept: KeptEnglish): string => {
        return prose.split(kept.text).join(" ");
      },
      proseText(markdown),
    ),
  );
}

// The general words for a built-in role in any English text, in order.
export function generalRoleWordsIn(text: string): Array<string> {
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
