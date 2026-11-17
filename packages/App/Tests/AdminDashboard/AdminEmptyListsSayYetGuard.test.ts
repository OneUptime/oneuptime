// UX rule: Docs/ux/README.md#empty-states-and-suggestions
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The Admin Dashboard's lists say "No X yet", never "No X found." (#9044).
 *
 * EmptyListsSayYetGuard holds the Dashboard to the rule, but it reads the
 * sentence a page writes. The Admin Dashboard words its pages through
 * nested locale keys (`t("pages.projects.noItems")`), so its lists kept
 * "No projects found.", "No probes found.", "No users found in this
 * project." on a server that simply had none yet, under card descriptions
 * that only pointed at the card ("Here is a list of users in OneUptime.").
 *
 * This reads every `noItemsMessage` the Admin Dashboard (and the enterprise
 * Admin Dashboard, when ee/ is present) writes, as a JSX attribute or an
 * object's property, and every sentence it can hand over - a literal, a
 * `t("key")` looked up in the English locale, either side of a condition
 * or of `||` - and:
 *
 *   - fails on "found" in any of them, unless the sentence is listed in
 *     ALLOWED below with its reason;
 *   - holds every key it reads to a value in every Admin language;
 *   - holds the reworded lists' keys to a translation in every language,
 *     and the keys they replaced to being gone from every locale.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..", "..");
const REPOSITORY_DIR: string = path.resolve(PACKAGES_DIR, "..");
const ADMIN_SRC: string = path.join(
  PACKAGES_DIR,
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
);
const LOCALES_DIR: string = path.join(ADMIN_SRC, "Locales");

const SCAN_DIRS: Array<string> = [
  ADMIN_SRC,
  path.join(REPOSITORY_DIR, "ee", "AdminDashboard"),
];

const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Locales",
];

const PROP_NAME: string = "noItemsMessage";
const TRANSLATE_FUNCTION: string = "t";
const SAYS_FOUND: RegExp = /\bfound\b/i;
const WHITESPACE: RegExp = /\s+/g;

interface AllowedMessage {
  // Relative to the repository root, with forward slashes.
  file: string;
  text: string;
  reason: string;
}

/*
 * Sentences that may say "found": each is drawn only after the reader asked
 * for something and nothing came back. Add one only with its reason.
 */
const ALLOWED: Array<AllowedMessage> = [];

/*
 * The lists reworded in #9044: the key each now reads, and the keys it
 * replaced, which must be gone from every locale.
 */
interface RewordedList {
  page: string;
  emptyKey: string;
  descriptionKey: string;
  replacedKeys: Array<string>;
}

const REWORDED_LISTS: Array<RewordedList> = [
  {
    page: "Pages/Users/Index.tsx",
    emptyKey: "pages.users.emptyMessage",
    descriptionKey: "pages.users.listDescription",
    replacedKeys: ["pages.users.noItems", "pages.users.cardDescription"],
  },
  {
    page: "Pages/Projects/Index.tsx",
    emptyKey: "pages.projects.emptyMessage",
    descriptionKey: "pages.projects.listDescription",
    replacedKeys: ["pages.projects.noItems", "pages.projects.cardDescription"],
  },
  {
    page: "Pages/Projects/View/Users.tsx",
    emptyKey: "pages.projectUsers.emptyMessage",
    descriptionKey: "pages.projectUsers.listDescription",
    replacedKeys: [
      "pages.projectUsers.noItems",
      "pages.projectUsers.cardDescription",
    ],
  },
  {
    page: "Pages/Projects/View/Teams.tsx",
    emptyKey: "pages.projectTeams.emptyMessage",
    descriptionKey: "pages.projectTeams.listDescription",
    replacedKeys: [
      "pages.projectTeams.noItems",
      "pages.projectTeams.cardDescription",
    ],
  },
  {
    page: "Pages/Settings/Probes/Index.tsx",
    emptyKey: "pages.settings.probes.emptyMessage",
    descriptionKey: "pages.settings.probes.cardDescription",
    replacedKeys: [
      "pages.settings.probes.noItems",
      "pages.settings.probes.bannerDescription",
      "pages.settings.probes.keyModalDescription",
    ],
  },
];

/*
 * Details cards whose description only repeated their title ("Project
 * details", "Details about this team.", "User details"): the title says it
 * all, so they have none.
 */
const DETAILS_CARDS_WITHOUT_DESCRIPTION: Array<{
  page: string;
  removedKey: string;
}> = [
  {
    page: "Pages/Projects/View/Index.tsx",
    removedKey: "pages.projectView.cardDescription",
  },
  {
    page: "Pages/Projects/View/TeamView.tsx",
    removedKey: "pages.projectTeamView.cardDescription",
  },
  {
    page: "Pages/Users/View/Index.tsx",
    removedKey: "pages.userView.cardDescription",
  },
];

type Locale = Record<string, unknown>;

const locales: Record<string, Locale> = {};

for (const file of fs.readdirSync(LOCALES_DIR).sort()) {
  if (file.endsWith(".json")) {
    locales[file.replace(/\.json$/, "")] = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
    ) as Locale;
  }
}

const OTHER_LANGUAGES: Array<string> = Object.keys(locales).filter(
  (code: string): boolean => {
    return code !== "en";
  },
);

/*
 * A key as i18next reads it: a flat key first (the shared strings are
 * keyed by their English), then the nested path.
 */
function lookUp(locale: Locale | undefined, key: string): unknown {
  if (!locale) {
    return undefined;
  }

  if (key in locale) {
    return locale[key];
  }

  let value: unknown = locale;

  for (const part of key.split(".")) {
    if (!value || typeof value !== "object") {
      return undefined;
    }

    value = (value as Record<string, unknown>)[part];
  }

  return value;
}

interface FoundMessage {
  file: string;
  line: number;
  text: string;
  // The locale key the sentence was read from, when it was one.
  key?: string | undefined;
}

function relative(file: string): string {
  return path.relative(REPOSITORY_DIR, file).split(path.sep).join("/");
}

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        files.push(...listSourceFiles(fullPath));
      }
    } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      if (!entry.name.endsWith(".d.ts")) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function collectMessages(
  node: ts.Node,
  source: ts.SourceFile,
  file: string,
  into: Array<FoundMessage>,
): void {
  const line: number =
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    into.push({
      file: file,
      line: line,
      text: node.text.replace(WHITESPACE, " ").trim(),
    });
    return;
  }

  if (ts.isTemplateExpression(node)) {
    into.push({
      file: file,
      line: line,
      text: node.head.text.replace(WHITESPACE, " ").trim(),
    });
    return;
  }

  if (
    ts.isCallExpression(node) &&
    node.expression.getText(source) === TRANSLATE_FUNCTION &&
    node.arguments[0] &&
    ts.isStringLiteral(node.arguments[0])
  ) {
    const key: string = node.arguments[0].text;
    const value: unknown = lookUp(locales["en"], key);

    into.push({
      file: file,
      line: line,
      text:
        typeof value === "string" ? value.replace(WHITESPACE, " ").trim() : "",
      key: key,
    });
    return;
  }

  if (ts.isJsxExpression(node) && node.expression) {
    collectMessages(node.expression, source, file, into);
    return;
  }

  if (ts.isParenthesizedExpression(node)) {
    collectMessages(node.expression, source, file, into);
    return;
  }

  if (ts.isConditionalExpression(node)) {
    collectMessages(node.whenTrue, source, file, into);
    collectMessages(node.whenFalse, source, file, into);
    return;
  }

  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    collectMessages(node.left, source, file, into);
    collectMessages(node.right, source, file, into);
  }
}

function readNoItemsMessages(file: string): Array<FoundMessage> {
  const text: string = fs.readFileSync(file, "utf8");

  if (!text.includes(PROP_NAME)) {
    return [];
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Array<FoundMessage> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxAttribute(node) || ts.isPropertyAssignment(node)) &&
      node.name.getText(source) === PROP_NAME &&
      node.initializer
    ) {
      collectMessages(node.initializer, source, relative(file), found);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

const MESSAGES: Array<FoundMessage> = SCAN_DIRS.flatMap(
  (directory: string): Array<FoundMessage> => {
    return listSourceFiles(directory).flatMap(readNoItemsMessages);
  },
);

const ADMIN_PREFIX: string = "packages/App/FeatureSet/AdminDashboard/src/";

function describeMessage(message: FoundMessage): string {
  return `${message.file}:${message.line}: ${message.key ? `${message.key} = ` : ""}${message.text}`;
}

function isAllowed(message: FoundMessage): boolean {
  return ALLOWED.some((allowed: AllowedMessage): boolean => {
    return allowed.file === message.file && allowed.text === message.text;
  });
}

function readPage(page: string): string {
  return fs.readFileSync(path.join(ADMIN_SRC, page), "utf8");
}

describe("the Admin Dashboard's empty lists say 'No X yet', never 'No X found.'", () => {
  test("the scan reads the lists it is meant to hold, keys and literals", () => {
    // A path that stopped resolving would read nothing and pass.
    expect(MESSAGES.length).toBeGreaterThanOrEqual(15);

    for (const list of REWORDED_LISTS) {
      expect(
        MESSAGES.some((message: FoundMessage): boolean => {
          return (
            message.file === ADMIN_PREFIX + list.page &&
            message.key === list.emptyKey
          );
        }),
      ).toBe(true);
    }

    // A written sentence is read too, not only a key.
    expect(
      MESSAGES.some((message: FoundMessage): boolean => {
        return !message.key && message.text.length > 0;
      }),
    ).toBe(true);
  });

  test("every key a list's empty sentence reads is in the English locale", () => {
    const missing: Array<string> = MESSAGES.filter(
      (message: FoundMessage): boolean => {
        return Boolean(message.key) && !message.text;
      },
    ).map(describeMessage);

    expect(missing).toEqual([]);
  });

  test("no list's empty sentence says 'found'", () => {
    const saysFound: Array<string> = MESSAGES.filter(
      (message: FoundMessage): boolean => {
        return SAYS_FOUND.test(message.text) && !isAllowed(message);
      },
    ).map(describeMessage);

    expect(saysFound).toEqual([]);
  });

  test("every allowed sentence is still there, with its reason", () => {
    for (const allowed of ALLOWED) {
      expect(allowed.reason.trim().length).toBeGreaterThan(20);
      expect(
        MESSAGES.some((message: FoundMessage): boolean => {
          return message.file === allowed.file && message.text === allowed.text;
        }),
      ).toBe(true);
    }
  });

  test("every key a list's empty sentence reads has a value in every language", () => {
    const missing: Array<string> = [];

    for (const message of MESSAGES) {
      if (!message.key) {
        continue;
      }

      for (const code of OTHER_LANGUAGES) {
        if (typeof lookUp(locales[code], message.key) !== "string") {
          missing.push(`${code}: ${describeMessage(message)}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

describe("the reworded Admin lists (#9044)", () => {
  test.each(REWORDED_LISTS)(
    "$page reads its new description and empty sentence",
    (list: RewordedList) => {
      const page: string = readPage(list.page);

      expect(page).toContain(`t("${list.emptyKey}")`);
      expect(page).toContain(`t("${list.descriptionKey}")`);

      for (const key of list.replacedKeys) {
        expect(page).not.toContain(`"${key}"`);
      }
    },
  );

  test("each says 'No X yet', with a description of what the list is for", () => {
    for (const list of REWORDED_LISTS) {
      expect(lookUp(locales["en"], list.emptyKey)).toMatch(/^No .+ yet\.$/);

      const description: unknown = lookUp(locales["en"], list.descriptionKey);

      expect(typeof description).toBe("string");
      expect((description as string).length).toBeGreaterThan(40);
      expect(description).not.toMatch(/^Here\b/i);
    }
  });

  test("each new sentence is translated in every language", () => {
    const untranslated: Array<string> = [];
    const keys: Array<string> = REWORDED_LISTS.flatMap(
      (list: RewordedList): Array<string> => {
        return [list.emptyKey, list.descriptionKey];
      },
    ).concat([
      "pages.settings.probes.bannerGuide",
      "pages.settings.probes.keyModalSecret",
    ]);

    for (const key of keys) {
      const english: unknown = lookUp(locales["en"], key);

      for (const code of OTHER_LANGUAGES) {
        const value: unknown = lookUp(locales[code], key);

        if (typeof value !== "string" || value === english) {
          untranslated.push(`${code}: ${key}`);
        }
      }
    }

    expect(untranslated).toEqual([]);
  });

  test("the keys they replaced are gone from every locale", () => {
    const left: Array<string> = [];
    const removed: Array<string> = REWORDED_LISTS.flatMap(
      (list: RewordedList): Array<string> => {
        return list.replacedKeys;
      },
    ).concat(
      DETAILS_CARDS_WITHOUT_DESCRIPTION.map(
        (card: { removedKey: string }): string => {
          return card.removedKey;
        },
      ),
    );

    for (const code of Object.keys(locales)) {
      for (const key of removed) {
        if (lookUp(locales[code], key) !== undefined) {
          left.push(`${code}: ${key}`);
        }
      }
    }

    expect(left).toEqual([]);
  });

  test("details cards whose title says it all have no description", () => {
    for (const card of DETAILS_CARDS_WITHOUT_DESCRIPTION) {
      expect(readPage(card.page)).not.toContain(card.removedKey);
    }
  });
});
