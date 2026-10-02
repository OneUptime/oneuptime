import {
  DEFAULT_DASHBOARD_LANGUAGE,
  SUPPORTED_DASHBOARD_LANGUAGE_CODES,
} from "Common/Types/Dashboard/DashboardLanguage";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

/*
 * Reading, writing and lining up the Dashboard's locale files
 * (src/Locales/<code>.json).
 *
 * en.json is the source of truth. Most of its keys are the English text
 * itself ("Create Incident": "Create Incident"), looked up by
 * useTranslateValue(); a few are nested ("navbar": { "items": ... }) and read
 * with t("navbar.items.x"). Every other locale has exactly en.json's keys, in
 * en.json's order, plus the extra plural forms its language needs. A key a
 * locale has not translated yet holds the English text as a placeholder.
 *
 * Ordering is deterministic so that branches merge cleanly: existing keys keep
 * their place, and a new key goes in right after the existing key that sorts
 * immediately before it. Every locale mirrors en.json's order, so a feature's
 * keys land at the same spot in all seventeen files. When a merge still
 * conflicts, `npm run i18n:extract` reads both sides and writes the union
 * (resolveConflictedLocaleText below).
 */

export type LocaleNode = string | LocaleTree;

export interface LocaleTree {
  [key: string]: LocaleNode;
}

export interface LocaleLeaf {
  path: Array<string>;
  value: string;
}

export const DASHBOARD_DIRECTORY: string = path.resolve(__dirname, "..", "..");

export const REPOSITORY_ROOT: string = path.resolve(
  DASHBOARD_DIRECTORY,
  "..",
  "..",
  "..",
  "..",
);

export const LOCALES_DIRECTORY: string = path.join(
  DASHBOARD_DIRECTORY,
  "src",
  "Locales",
);

/*
 * Translation progress lives outside src/ so it is never bundled: esbuild
 * turns the lazy `../Locales/${code}.json` import into a chunk per file it
 * matches.
 */
export const TRACKING_DIRECTORY: string = path.join(
  DASHBOARD_DIRECTORY,
  "i18n",
);

export const ENGLISH: string = DEFAULT_DASHBOARD_LANGUAGE;

// Every locale except English, in the order the language picker lists them.
export const TRANSLATED_LOCALES: Array<string> =
  SUPPORTED_DASHBOARD_LANGUAGE_CODES.filter((code: string): boolean => {
    return code !== ENGLISH;
  });

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

/*
 * CLDR plural categories per locale, as Intl.PluralRules (and so i18next)
 * reports them. Written out rather than read from Intl at run time, so the
 * files this tool writes do not depend on the ICU build of whoever runs it;
 * Tests/Dashboard/I18nLocaleFiles.test.ts fails if Intl ever disagrees.
 */
export const PLURAL_CATEGORIES: Record<string, Array<PluralCategory>> = {
  en: ["one", "other"],
  da: ["one", "other"],
  de: ["one", "other"],
  es: ["one", "many", "other"],
  fa: ["one", "other"],
  fr: ["one", "many", "other"],
  hi: ["one", "other"],
  it: ["one", "many", "other"],
  ja: ["other"],
  ko: ["other"],
  nl: ["one", "other"],
  no: ["one", "other"],
  pt: ["one", "many", "other"],
  ru: ["one", "few", "many", "other"],
  sv: ["one", "other"],
  "zh-CN": ["other"],
  "zh-TW": ["other"],
};

// Suffixes a locale may add beyond en.json's "_one", in CLDR order.
const EXTRA_PLURAL_CATEGORIES: Array<PluralCategory> = [
  "zero",
  "two",
  "few",
  "many",
];

export const getPluralCategories: (code: string) => Array<PluralCategory> = (
  code: string,
): Array<PluralCategory> => {
  return PLURAL_CATEGORIES[code] || ["one", "other"];
};

// The plural forms `code` needs beyond the general form and "_one".
export const getExtraPluralCategories: (
  code: string,
) => Array<PluralCategory> = (code: string): Array<PluralCategory> => {
  const categories: Array<PluralCategory> = getPluralCategories(code);

  return EXTRA_PLURAL_CATEGORIES.filter((category: PluralCategory): boolean => {
    return categories.includes(category);
  });
};

export const getLocalePath: (code: string) => string = (
  code: string,
): string => {
  return path.join(LOCALES_DIRECTORY, `${code}.json`);
};

export const isLocaleTree: (node: unknown) => node is LocaleTree = (
  node: unknown,
): node is LocaleTree => {
  return typeof node === "object" && node !== null && !Array.isArray(node);
};

/*
 * The exact text of a locale file: two-space JSON and a trailing newline,
 * which is what every locale file in the repository already is.
 */
export const serializeLocale: (tree: LocaleTree) => string = (
  tree: LocaleTree,
): string => {
  return `${JSON.stringify(tree, null, 2)}\n`;
};

export const parseLocaleText: (text: string) => LocaleTree = (
  text: string,
): LocaleTree => {
  const parsed: unknown = JSON.parse(text);

  if (!isLocaleTree(parsed)) {
    throw new Error("A locale file must hold a JSON object.");
  }

  return parsed;
};

// Every string in a tree, depth first, in file order.
export const getLeaves: (tree: LocaleTree) => Array<LocaleLeaf> = (
  tree: LocaleTree,
): Array<LocaleLeaf> => {
  const leaves: Array<LocaleLeaf> = [];

  const walk: (node: LocaleTree, prefix: Array<string>) => void = (
    node: LocaleTree,
    prefix: Array<string>,
  ): void => {
    for (const key of Object.keys(node)) {
      const value: LocaleNode = node[key] as LocaleNode;

      if (isLocaleTree(value)) {
        walk(value, [...prefix, key]);
      } else if (typeof value === "string") {
        leaves.push({ path: [...prefix, key], value: value });
      }
    }
  };

  walk(tree, []);

  return leaves;
};

/*
 * A leaf's address as one string. A flat key is itself ("Loading..." keeps
 * its dots); a nested one joins its path with " › " (navbar › items ›
 * formsTitle), which no flat key contains.
 */
export const NESTED_PATH_SEPARATOR: string = " › ";

export const getLeafId: (leafPath: Array<string>) => string = (
  leafPath: Array<string>,
): string => {
  return leafPath.join(NESTED_PATH_SEPARATOR);
};

export const getValueAt: (
  tree: LocaleTree,
  leafPath: Array<string>,
) => LocaleNode | undefined = (
  tree: LocaleTree,
  leafPath: Array<string>,
): LocaleNode | undefined => {
  let node: LocaleNode | undefined = tree;

  for (const key of leafPath) {
    if (!isLocaleTree(node)) {
      return undefined;
    }

    node = Object.prototype.hasOwnProperty.call(node, key)
      ? node[key]
      : undefined;
  }

  return node;
};

const PLACEHOLDER_PATTERN: RegExp = /\{\{\s*([^{}]+?)\s*\}\}/g;

// The distinct {{placeholder}} names in a text, sorted.
export const getPlaceholders: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  const names: Set<string> = new Set<string>();

  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    names.add((match[1] as string).trim());
  }

  return Array.from(names).sort();
};

export const PLURAL_ONE_SUFFIX: string = "_one";

/*
 * The flat keys en.json holds as count-dependent sentences: those with a
 * "_one" sibling. The key is the English "other" form.
 */
export const getPluralBases: (english: LocaleTree) => Array<string> = (
  english: LocaleTree,
): Array<string> => {
  return Object.keys(english).filter((key: string): boolean => {
    return (
      typeof english[key] === "string" &&
      typeof english[`${key}${PLURAL_ONE_SUFFIX}`] === "string"
    );
  });
};

/*
 * A key is compared and sorted by its UTF-16 code units - the order
 * JavaScript's default sort uses - so every machine and Node version agrees.
 */
export const compareKeys: (a: string, b: string) => number = (
  a: string,
  b: string,
): number => {
  if (a === b) {
    return 0;
  }

  return a < b ? -1 : 1;
};

/*
 * Adds flat keys to en.json without moving any existing key. A new key goes
 * right after the existing flat key that sorts immediately before it (keys
 * sharing that neighbour go in sorted order), or before the first flat key
 * if nothing sorts before it. The result depends only on the existing file
 * and the set of additions, never on the order they were found in.
 */
export const insertEnglishKeys: (
  english: LocaleTree,
  additions: Record<string, string>,
) => { tree: LocaleTree; added: Array<string> } = (
  english: LocaleTree,
  additions: Record<string, string>,
): { tree: LocaleTree; added: Array<string> } => {
  const existingKeys: Array<string> = Object.keys(english);

  const newKeys: Array<string> = Object.keys(additions)
    .filter((key: string): boolean => {
      return !Object.prototype.hasOwnProperty.call(english, key);
    })
    .sort(compareKeys);

  if (newKeys.length === 0) {
    return { tree: english, added: [] };
  }

  const existingFlatKeys: Array<string> = existingKeys
    .filter((key: string): boolean => {
      return typeof english[key] === "string";
    })
    .sort(compareKeys);

  // New keys grouped by the existing key they follow ("" = before them all).
  const followers: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();

  let anchorIndex: number = -1;

  for (const key of newKeys) {
    while (
      anchorIndex + 1 < existingFlatKeys.length &&
      compareKeys(existingFlatKeys[anchorIndex + 1] as string, key) < 0
    ) {
      anchorIndex++;
    }

    const anchor: string =
      anchorIndex >= 0 ? (existingFlatKeys[anchorIndex] as string) : "";
    const group: Array<string> = followers.get(anchor) || [];

    group.push(key);
    followers.set(anchor, group);
  }

  const firstFlatKey: string | undefined = existingKeys.find(
    (key: string): boolean => {
      return typeof english[key] === "string";
    },
  );

  const tree: LocaleTree = {};

  const addGroup: (anchor: string) => void = (anchor: string): void => {
    for (const key of followers.get(anchor) || []) {
      tree[key] = additions[key] as string;
    }
  };

  for (const key of existingKeys) {
    if (key === firstFlatKey) {
      addGroup("");
    }

    tree[key] = english[key] as LocaleNode;

    if (typeof english[key] === "string") {
      addGroup(key);
    }
  }

  // A file with no flat keys at all: the additions go at the end.
  if (firstFlatKey === undefined) {
    addGroup("");
  }

  return { tree: tree, added: newKeys };
};

/*
 * A PluralTemplate's "_one" sentence follows the source: when the English
 * singular changes in code, en.json's "_one" entry changes with it (no other
 * key depends on its text). Returns the keys it updated.
 */
export const updateEnglishPluralForms: (
  english: LocaleTree,
  additions: Record<string, string>,
) => Array<string> = (
  english: LocaleTree,
  additions: Record<string, string>,
): Array<string> => {
  const updated: Array<string> = [];

  for (const key of Object.keys(additions).sort(compareKeys)) {
    if (
      key.endsWith(PLURAL_ONE_SUFFIX) &&
      typeof english[key] === "string" &&
      english[key] !== additions[key]
    ) {
      english[key] = additions[key] as string;
      updated.push(key);
    }
  }

  return updated;
};

export interface NestedEntry {
  path: Array<string>;
  value: string;
}

/*
 * Adds nested keys read with t("commandPalette.actions.logOut", "Log out")
 * that en.json lacks, holding the English the call gives. Existing entries
 * are never changed. A new key inside an existing object goes after the
 * existing key that sorts immediately before it; a new top-level object goes
 * after the last existing one (they lead the file). Returns the added paths
 * and the ones that clash with a string already at part of the path.
 */
export const insertNestedEnglishKeys: (
  english: LocaleTree,
  entries: ReadonlyArray<NestedEntry>,
) => { tree: LocaleTree; added: Array<string>; clashes: Array<string> } = (
  english: LocaleTree,
  entries: ReadonlyArray<NestedEntry>,
): { tree: LocaleTree; added: Array<string>; clashes: Array<string> } => {
  const added: Array<string> = [];
  const clashes: Array<string> = [];

  const sorted: Array<NestedEntry> = [...entries].sort(
    (a: NestedEntry, b: NestedEntry): number => {
      return compareKeys(a.path.join("."), b.path.join("."));
    },
  );

  // A copy of `node` with `key` -> `value` placed by the rules above.
  const placeKey: (
    node: LocaleTree,
    key: string,
    value: LocaleNode,
    isTopLevel: boolean,
  ) => LocaleTree = (
    node: LocaleTree,
    key: string,
    value: LocaleNode,
    isTopLevel: boolean,
  ): LocaleTree => {
    const keys: Array<string> = Object.keys(node);
    let after: string | undefined = undefined;

    if (isTopLevel) {
      const objectKeys: Array<string> = keys.filter(
        (existing: string): boolean => {
          return isLocaleTree(node[existing]);
        },
      );

      after = objectKeys[objectKeys.length - 1];
    } else {
      for (const existing of keys) {
        if (
          compareKeys(existing, key) < 0 &&
          (after === undefined || compareKeys(after, existing) < 0)
        ) {
          after = existing;
        }
      }
    }

    const result: LocaleTree = {};

    if (after === undefined) {
      result[key] = value;
    }

    for (const existing of keys) {
      result[existing] = node[existing] as LocaleNode;

      if (existing === after) {
        result[key] = value;
      }
    }

    return result;
  };

  const insert: (
    node: LocaleTree,
    entryPath: Array<string>,
    value: string,
    isTopLevel: boolean,
  ) => LocaleTree | undefined = (
    node: LocaleTree,
    entryPath: Array<string>,
    value: string,
    isTopLevel: boolean,
  ): LocaleTree | undefined => {
    const [head, ...rest] = entryPath as [string, ...Array<string>];
    const existing: LocaleNode | undefined =
      Object.prototype.hasOwnProperty.call(node, head) ? node[head] : undefined;

    if (rest.length === 0) {
      if (existing !== undefined) {
        return undefined;
      }

      return placeKey(node, head, value, isTopLevel);
    }

    if (typeof existing === "string") {
      throw new Error("clash");
    }

    const child: LocaleTree | undefined = insert(
      existing || {},
      rest,
      value,
      false,
    );

    if (!child) {
      return undefined;
    }

    if (existing) {
      const result: LocaleTree = {};

      for (const key of Object.keys(node)) {
        result[key] = key === head ? child : (node[key] as LocaleNode);
      }

      return result;
    }

    return placeKey(node, head, child, isTopLevel);
  };

  let tree: LocaleTree = english;

  for (const entry of sorted) {
    try {
      const next: LocaleTree | undefined = insert(
        tree,
        entry.path,
        entry.value,
        true,
      );

      if (next) {
        tree = next;
        added.push(entry.path.join("."));
      }
    } catch {
      clashes.push(entry.path.join("."));
    }
  }

  return { tree: tree, added: added, clashes: clashes };
};

export interface AlignedLocale {
  tree: LocaleTree;
  // Keys that had no entry and now hold the English text as a placeholder.
  placeholdersAdded: Array<string>;
  // Entries en.json no longer has, which were dropped.
  removed: Array<string>;
}

/*
 * A locale rewritten to mirror en.json: en.json's keys in en.json's order,
 * each holding the locale's value or, where it has none, the English text.
 * After a count-dependent key's "_one" form come the extra forms the
 * language needs ("_few", "_many" for Russian), also English until they are
 * translated. Entries en.json does not have are dropped.
 */
export const alignLocale: (
  english: LocaleTree,
  locale: LocaleTree,
  code: string,
) => AlignedLocale = (
  english: LocaleTree,
  locale: LocaleTree,
  code: string,
): AlignedLocale => {
  const placeholdersAdded: Array<string> = [];
  const removed: Array<string> = [];
  const pluralBases: Set<string> = new Set<string>(getPluralBases(english));
  const extraCategories: Array<PluralCategory> = getExtraPluralCategories(code);

  const align: (
    englishNode: LocaleTree,
    localeNode: LocaleTree | undefined,
    prefix: Array<string>,
    isTopLevel: boolean,
  ) => LocaleTree = (
    englishNode: LocaleTree,
    localeNode: LocaleTree | undefined,
    prefix: Array<string>,
    isTopLevel: boolean,
  ): LocaleTree => {
    const result: LocaleTree = {};
    const expected: Set<string> = new Set<string>();

    const take: (key: string, englishValue: string) => void = (
      key: string,
      englishValue: string,
    ): void => {
      expected.add(key);

      const value: LocaleNode | undefined = localeNode
        ? localeNode[key]
        : undefined;

      if (typeof value === "string") {
        result[key] = value;
      } else {
        result[key] = englishValue;
        placeholdersAdded.push(getLeafId([...prefix, key]));
      }
    };

    for (const key of Object.keys(englishNode)) {
      const englishValue: LocaleNode = englishNode[key] as LocaleNode;

      if (isLocaleTree(englishValue)) {
        expected.add(key);

        const localeValue: LocaleNode | undefined = localeNode
          ? localeNode[key]
          : undefined;

        result[key] = align(
          englishValue,
          isLocaleTree(localeValue) ? localeValue : undefined,
          [...prefix, key],
          false,
        );
        continue;
      }

      take(key, englishValue);

      // The extra plural forms follow the "_one" form.
      if (isTopLevel && key.endsWith(PLURAL_ONE_SUFFIX)) {
        const base: string = key.slice(0, -PLURAL_ONE_SUFFIX.length);

        if (pluralBases.has(base)) {
          for (const category of extraCategories) {
            take(`${base}_${category}`, englishNode[base] as string);
          }
        }
      }
    }

    if (localeNode) {
      for (const key of Object.keys(localeNode)) {
        if (!expected.has(key)) {
          removed.push(getLeafId([...prefix, key]));
        }
      }
    }

    return result;
  };

  return {
    tree: align(english, locale, [], true),
    placeholdersAdded: placeholdersAdded,
    removed: removed,
  };
};

// The end of a JSON value on its line: a string, an object, a number...
const ENDS_WITH_VALUE: RegExp = /("|\}|\]|\d|true|false|null)$/;

const CONFLICT_START: RegExp = /^<<<<<<< /;
const CONFLICT_BASE: RegExp = /^\|\|\|\|\|\|\| /;
const CONFLICT_MIDDLE: RegExp = /^=======\s*$/;
const CONFLICT_END: RegExp = /^>>>>>>> /;

export const hasConflictMarkers: (text: string) => boolean = (
  text: string,
): boolean => {
  return text.split("\n").some((line: string): boolean => {
    return CONFLICT_START.test(line);
  });
};

export interface ConflictSides {
  ours: string;
  theirs: string;
}

/*
 * The two versions of a file git left conflict markers in, each with every
 * conflict resolved its own way (the common base section of a diff3-style
 * conflict is dropped).
 */
export const splitConflictSides: (text: string) => ConflictSides = (
  text: string,
): ConflictSides => {
  const ours: Array<string> = [];
  const theirs: Array<string> = [];

  type Section = "both" | "ours" | "base" | "theirs";

  let section: Section = "both";

  for (const line of text.split("\n")) {
    if (CONFLICT_START.test(line)) {
      section = "ours";
    } else if (CONFLICT_BASE.test(line) && section === "ours") {
      section = "base";
    } else if (
      CONFLICT_MIDDLE.test(line) &&
      (section === "ours" || section === "base")
    ) {
      section = "theirs";
    } else if (CONFLICT_END.test(line) && section === "theirs") {
      section = "both";
    } else if (section === "both") {
      ours.push(line);
      theirs.push(line);
    } else if (section === "ours") {
      ours.push(line);
    } else if (section === "theirs") {
      theirs.push(line);
    }
  }

  return { ours: ours.join("\n"), theirs: theirs.join("\n") };
};

/*
 * Parses one side of a conflicted locale file. Each side was valid JSON on
 * its own branch, but picking one side of every hunk can leave a comma
 * missing after the last entry of a hunk, or one too many before a closing
 * brace; both are repaired line by line before parsing.
 */
export const parseConflictSide: (text: string) => LocaleTree = (
  text: string,
): LocaleTree => {
  try {
    return parseLocaleText(text);
  } catch {
    // Repaired below.
  }

  const lines: Array<string> = text.split("\n");
  const repaired: Array<string> = [];

  for (let index: number = 0; index < lines.length; index++) {
    let line: string = lines[index] as string;
    const trimmed: string = line.trim();

    let nextIndex: number = index + 1;

    while (
      nextIndex < lines.length &&
      (lines[nextIndex] as string).trim() === ""
    ) {
      nextIndex++;
    }

    const next: string = ((lines[nextIndex] as string | undefined) || "")
      .trim()
      .charAt(0);

    const endsValue: boolean =
      ENDS_WITH_VALUE.test(trimmed) && !trimmed.endsWith(",");

    if (endsValue && next === '"') {
      line = `${line},`;
    } else if (trimmed.endsWith(",") && (next === "}" || next === "]")) {
      line = line.replace(/,\s*$/, "");
    }

    repaired.push(line);
  }

  return parseLocaleText(repaired.join("\n"));
};

/*
 * Prefers a translation over an English placeholder, then the first side -
 * the branch being merged into.
 */
const pickValue: (
  ours: string,
  theirs: string,
  englishValue: string | undefined,
) => string = (
  ours: string,
  theirs: string,
  englishValue: string | undefined,
): string => {
  if (englishValue !== undefined && ours === englishValue) {
    return theirs;
  }

  return ours;
};

/*
 * Every key of both trees: `ours` in its own order, with each key only
 * `theirs` has placed after the key it follows there. A value both sides
 * changed resolves by pickValue; with a `base` (git's common ancestor), a
 * value only one side changed takes that side's change, and a key one side
 * deleted while the other left it alone stays deleted.
 */
export const mergeLocaleTrees: (data: {
  ours: LocaleTree;
  theirs: LocaleTree;
  base?: LocaleTree | undefined;
  english?: LocaleTree | undefined;
}) => LocaleTree = (data: {
  ours: LocaleTree;
  theirs: LocaleTree;
  base?: LocaleTree | undefined;
  english?: LocaleTree | undefined;
}): LocaleTree => {
  const merge: (
    ours: LocaleTree,
    theirs: LocaleTree,
    base: LocaleTree | undefined,
    english: LocaleTree | undefined,
  ) => LocaleTree = (
    ours: LocaleTree,
    theirs: LocaleTree,
    base: LocaleTree | undefined,
    english: LocaleTree | undefined,
  ): LocaleTree => {
    const has: (tree: LocaleTree | undefined, key: string) => boolean = (
      tree: LocaleTree | undefined,
      key: string,
    ): boolean => {
      return Boolean(tree) && Object.prototype.hasOwnProperty.call(tree, key);
    };

    /*
     * Key order: ours, with each run of keys only theirs has placed after the
     * last key both sides share before it (at the start if there is none).
     * Where ours also added keys after that same shared key, the two runs
     * interleave in sorted order - what one extraction over both branches
     * would have written.
     */
    const oursKeys: Array<string> = Object.keys(ours);
    const inOurs: Set<string> = new Set<string>(oursKeys);
    const inTheirs: Set<string> = new Set<string>(Object.keys(theirs));
    const theirsOnlyAtStart: Array<string> = [];
    const theirsOnlyAfter: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();
    let sharedAnchor: string | undefined = undefined;

    for (const key of Object.keys(theirs)) {
      if (inOurs.has(key)) {
        sharedAnchor = key;
        continue;
      }

      if (sharedAnchor === undefined) {
        theirsOnlyAtStart.push(key);
      } else {
        const group: Array<string> = theirsOnlyAfter.get(sharedAnchor) || [];

        group.push(key);
        theirsOnlyAfter.set(sharedAnchor, group);
      }
    }

    // A run of ours-only keys and a run of theirs-only keys, interleaved.
    const interleave: (
      oursRun: Array<string>,
      theirsRun: Array<string>,
    ) => Array<string> = (
      oursRun: Array<string>,
      theirsRun: Array<string>,
    ): Array<string> => {
      const merged: Array<string> = [];
      let oursIndex: number = 0;

      for (const key of theirsRun) {
        while (
          oursIndex < oursRun.length &&
          compareKeys(oursRun[oursIndex] as string, key) < 0
        ) {
          merged.push(oursRun[oursIndex] as string);
          oursIndex++;
        }

        merged.push(key);
      }

      return [...merged, ...oursRun.slice(oursIndex)];
    };

    const order: Array<string> = [];
    let pendingAnchor: string | undefined = undefined;
    let pendingOursRun: Array<string> = [];

    const flush: () => void = (): void => {
      const theirsRun: Array<string> =
        pendingAnchor === undefined
          ? theirsOnlyAtStart
          : theirsOnlyAfter.get(pendingAnchor) || [];

      order.push(...interleave(pendingOursRun, theirsRun));
      pendingOursRun = [];
    };

    for (const key of oursKeys) {
      if (inTheirs.has(key)) {
        flush();
        order.push(key);
        pendingAnchor = key;
      } else {
        pendingOursRun.push(key);
      }
    }

    flush();

    const result: LocaleTree = {};

    for (const key of order) {
      const isInOurs: boolean = has(ours, key);
      const isInTheirs: boolean = has(theirs, key);
      const baseValue: LocaleNode | undefined =
        base && has(base, key) ? base[key] : undefined;

      const oursValue: LocaleNode | undefined = ours[key];
      const theirsValue: LocaleNode | undefined = theirs[key];

      // Deleted on one side and untouched on the other: stays deleted.
      if (
        base &&
        has(base, key) &&
        (!isInOurs || !isInTheirs) &&
        JSON.stringify(isInOurs ? oursValue : theirsValue) ===
          JSON.stringify(baseValue)
      ) {
        continue;
      }

      if (!isInOurs) {
        result[key] = theirsValue as LocaleNode;
        continue;
      }

      if (!isInTheirs) {
        result[key] = oursValue as LocaleNode;
        continue;
      }

      if (isLocaleTree(oursValue) && isLocaleTree(theirsValue)) {
        const englishValue: LocaleNode | undefined = english
          ? english[key]
          : undefined;

        result[key] = merge(
          oursValue,
          theirsValue,
          isLocaleTree(baseValue) ? baseValue : undefined,
          isLocaleTree(englishValue) ? englishValue : undefined,
        );
        continue;
      }

      if (
        typeof oursValue === "string" &&
        typeof theirsValue === "string" &&
        oursValue !== theirsValue
      ) {
        if (base && baseValue === oursValue) {
          result[key] = theirsValue;
          continue;
        }

        if (base && baseValue === theirsValue) {
          result[key] = oursValue;
          continue;
        }

        const englishValue: LocaleNode | undefined = english
          ? english[key]
          : undefined;

        result[key] = pickValue(
          oursValue,
          theirsValue,
          typeof englishValue === "string" ? englishValue : undefined,
        );
        continue;
      }

      result[key] = oursValue as LocaleNode;
    }

    return result;
  };

  return merge(data.ours, data.theirs, data.base, data.english);
};

/*
 * A stage of the file in git's index while a merge is in progress: 1 is the
 * common ancestor, 2 the branch being merged into, 3 the incoming branch.
 * Undefined outside a conflicted merge, or where git is unavailable.
 */
export const readGitStage: (
  filePath: string,
  stage: 1 | 2 | 3,
) => string | undefined = (
  filePath: string,
  stage: 1 | 2 | 3,
): string | undefined => {
  try {
    const relativePath: string = path
      .relative(REPOSITORY_ROOT, filePath)
      .split(path.sep)
      .join("/");

    return execFileSync("git", ["show", `:${stage}:${relativePath}`], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
};

export type StageReader = (
  filePath: string,
  stage: 1 | 2 | 3,
) => string | undefined;

/*
 * A locale file git could not merge, put back together: the two sides from
 * git's index when the merge is still in progress (with the common ancestor,
 * so a deliberate change or deletion on one side wins), or else from the
 * conflict markers in the file itself.
 */
export const resolveConflictedLocaleText: (data: {
  filePath: string;
  text: string;
  english?: LocaleTree | undefined;
  readStage?: StageReader | undefined;
}) => LocaleTree = (data: {
  filePath: string;
  text: string;
  english?: LocaleTree | undefined;
  readStage?: StageReader | undefined;
}): LocaleTree => {
  const readStage: StageReader = data.readStage || readGitStage;

  const oursText: string | undefined = readStage(data.filePath, 2);
  const theirsText: string | undefined = readStage(data.filePath, 3);

  if (oursText !== undefined && theirsText !== undefined) {
    try {
      const baseText: string | undefined = readStage(data.filePath, 1);

      return mergeLocaleTrees({
        ours: parseLocaleText(oursText),
        theirs: parseLocaleText(theirsText),
        base: baseText !== undefined ? parseLocaleText(baseText) : undefined,
        english: data.english,
      });
    } catch {
      // Fall back to the markers in the working file.
    }
  }

  const sides: ConflictSides = splitConflictSides(data.text);

  return mergeLocaleTrees({
    ours: parseConflictSide(sides.ours),
    theirs: parseConflictSide(sides.theirs),
    english: data.english,
  });
};

export interface ReadLocaleResult {
  tree: LocaleTree;
  hadConflicts: boolean;
}

export const readLocaleFile: (
  code: string,
  options?: {
    english?: LocaleTree | undefined;
    readStage?: StageReader | undefined;
    directory?: string | undefined;
  },
) => ReadLocaleResult = (
  code: string,
  options?: {
    english?: LocaleTree | undefined;
    readStage?: StageReader | undefined;
    directory?: string | undefined;
  },
): ReadLocaleResult => {
  const filePath: string = path.join(
    options?.directory || LOCALES_DIRECTORY,
    `${code}.json`,
  );
  const text: string = fs.readFileSync(filePath, "utf8");

  if (!hasConflictMarkers(text)) {
    return { tree: parseLocaleText(text), hadConflicts: false };
  }

  return {
    tree: resolveConflictedLocaleText({
      filePath: filePath,
      text: text,
      english: options?.english,
      readStage: options?.readStage,
    }),
    hadConflicts: true,
  };
};

// Writes the file only when its text changes; true when it did.
export const writeLocaleFile: (
  code: string,
  tree: LocaleTree,
  directory?: string,
) => boolean = (
  code: string,
  tree: LocaleTree,
  directory?: string,
): boolean => {
  const filePath: string = path.join(
    directory || LOCALES_DIRECTORY,
    `${code}.json`,
  );
  const text: string = serializeLocale(tree);
  const current: string | undefined = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf8")
    : undefined;

  if (current === text) {
    return false;
  }

  fs.writeFileSync(filePath, text);

  return true;
};
