import {
  ExtractedString,
  SKIPPED_SOURCE_FILES,
  SOURCE_ROOTS,
  SourceRoot,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  FormColumnDescription,
  FormColumnDescriptionFinder,
} from "../../FeatureSet/Dashboard/scripts/i18n/FormColumnDescriptions";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { ADMIN_DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";

/*
 * EVERY SHARED FILE THE ADMIN DASHBOARD DRAWS, IN THE ADMIN DASHBOARD'S
 * LANGUAGES (#7567).
 *
 * The Admin Dashboard draws forms, dialogs, menus and table controls from
 * Common (the SSO and SMTP forms, the provider cards, the header's menu,
 * a table's select-all across pages, the delete dialog, the markdown and
 * code editors ...) and looks their words up in its own 18 locale files,
 * which are kept by hand. The Dashboard's are filled by its extraction
 * (npm run i18n:extract), which reads all of Common/UI. So a word a shared
 * component gained reached the Dashboard's locales, and the Admin
 * Dashboard's only if someone added it: 484 such words, in 62 files its
 * bundle loads, were missing from the Admin Dashboard's locales, so a page
 * that drew one read it in English in every language, though the
 * Dashboard words it. The checks before this held named files
 * (AdminSharedStringsLocales a list of component folders, #7563's
 * AdminLlmProviderFormLocales the LLM provider form), and these words were
 * in others.
 *
 * A file is held whole: a page may draw a few of its strings and not the
 * rest. BulkSwitchActions loads with every table, though no Admin table
 * switches rows in bulk. A word no page draws costs a reader nothing, and
 * reads right the day a page draws it.
 *
 * This follows the Admin Dashboard's bundle from its entry (src/Index.tsx)
 * through every import the build keeps, reads each Common file it reaches
 * that the extraction reads, with the extraction's own rules
 * (scanSourceText, SOURCE_ROOTS), and holds every string the Dashboard
 * translates to the Admin Dashboard's locales: an entry in all 18 files,
 * and, in each language where the Dashboard words it otherwise than
 * English, not left in English. A string a shared file gains fails here,
 * named with its file, until the Admin Dashboard's locales have it, worded
 * as the Dashboard words it.
 *
 * The wording itself is not held to the Dashboard's: a shared word the
 * Admin Dashboard's own pages draw too is worded for them. "Failed" is a
 * backup's in Spanish and French (Fallida, Échouée: a copia, a
 * sauvegarde), where the Dashboard's is a check's.
 *
 * What the walk leaves out:
 *
 *   - an import whose bindings are used only as types: the build drops it
 *     (esbuild, as TypeScript does), so it loads nothing;
 *   - what only SerializableObjectDictionary loads: API rebuilds every type
 *     the server can send from its JSON (JSONFunctions), so the bundle
 *     holds the monitors' default criteria (MonitorCriteriaInstance), the
 *     monitor type cards (MonitorType) and the security watchlists' errors,
 *     but nothing the Admin Dashboard draws says their words;
 *   - the models (the extraction's "models" roots): a model's file names
 *     and describes every column, of which a page draws a few, so their
 *     words are held where a page draws them (FormColumnDescriptionsInLocales
 *     holds a form's column help);
 *   - a product's name, which a card or a form step draws as written
 *     (isTitleProductName): Resend is Resend in every language, while the
 *     locales' "Resend" is the verb.
 *
 * The Enterprise Edition's screens (ee/AdminDashboard) are walked where ee/
 * is checked out: the build bundles them through "@oneuptime/ee-admin-
 * dashboard". The App Test job deletes ee/, so the Enterprise job runs this
 * too (.github/workflows/test.ee.yaml).
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");

const ADMIN_SOURCE: string = path.join(
  REPOSITORY_ROOT,
  "packages/App/FeatureSet/AdminDashboard/src",
);
const COMMON: string = path.join(REPOSITORY_ROOT, "packages/Common");
const ENTERPRISE_ADMIN: string = path.join(
  REPOSITORY_ROOT,
  "ee/AdminDashboard",
);
const ENTERPRISE_PRESENT: boolean = fs.existsSync(
  path.join(ENTERPRISE_ADMIN, "Index.tsx"),
);

const ENTRY: string = path.join(ADMIN_SOURCE, "Index.tsx");

const LOCALES: Record<string, string> = {
  AdminDashboard: path.join(ADMIN_SOURCE, "Locales"),
  Dashboard: path.join(
    REPOSITORY_ROOT,
    "packages/App/FeatureSet/Dashboard/src/Locales",
  ),
};

const LANGUAGES: Array<string> = [...ADMIN_DASHBOARD_LANGUAGES];

/*
 * Loaded only to rebuild what the API sends (JSONFunctions): the walk does
 * not go through it.
 */
const JSON_TYPES_DICTIONARY: string = path.join(
  COMMON,
  "Types/SerializableObjectDictionary.ts",
);

// A character no key has, to join a nested key's path.
const PATH_JOINER: string = String.fromCharCode(0);

// What the walk follows: TypeScript sources (CSS, JSON and images draw no words).
const SOURCE_FILE: RegExp = /\.tsx?$/;

type LocaleTree = { [key: string]: string | LocaleTree };

function readLocale(app: string, language: string): LocaleTree {
  return JSON.parse(
    fs.readFileSync(
      path.join(LOCALES[app] as string, `${language}.json`),
      "utf8",
    ),
  ) as LocaleTree;
}

// A key's text: a flat entry, or a nested one by its path.
function entryAt(locale: LocaleTree, key: string): string | undefined {
  let node: string | LocaleTree | undefined = locale;

  for (const part of key.split(PATH_JOINER)) {
    if (typeof node !== "object" || node === null) {
      return undefined;
    }

    node = node[part];
  }

  return typeof node === "string" ? node : undefined;
}

function repositoryPath(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

/*
 * A module specifier, to the file the Admin Dashboard's build resolves it
 * to - "Common/...", a relative path, the Enterprise plugin and the
 * Admin Dashboard's own source as ee/ imports it (Common/UI/esbuild-config,
 * esbuild-enterprise) - or undefined for a package.
 */
function resolveSpecifier(
  fromFile: string,
  specifier: string,
): string | undefined {
  let base: string;

  if (specifier === "@oneuptime/ee-admin-dashboard") {
    base = ENTERPRISE_PRESENT
      ? path.join(ENTERPRISE_ADMIN, "Index")
      : path.join(ADMIN_SOURCE, "Enterprise/CommunityPlugins");
  } else if (specifier.startsWith("@oneuptime/admin-dashboard/")) {
    base = path.join(
      ADMIN_SOURCE,
      specifier.slice("@oneuptime/admin-dashboard/".length),
    );
  } else if (specifier.startsWith("Common/")) {
    base = path.join(COMMON, specifier.slice("Common/".length));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return undefined;
  }

  return [
    `${base}.tsx`,
    `${base}.ts`,
    base,
    path.join(base, "index.tsx"),
    path.join(base, "index.ts"),
  ].find((candidate: string): boolean => {
    return (
      SOURCE_FILE.test(candidate) &&
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isFile()
    );
  });
}

/*
 * The modules a file loads once it is built: TypeScript's own emit drops an
 * import whose bindings are used only as types, or not at all, as esbuild
 * does. What is left is every import, export ... from, import() and
 * require().
 */
function valueImportsOf(fileName: string, text: string): Array<string> {
  const built: string = ts.transpileModule(text, {
    fileName: fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ES2017,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
      experimentalDecorators: true,
    },
  }).outputText;
  const output: ts.SourceFile = ts.createSourceFile(
    "built.jsx",
    built,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JSX,
  );
  const specifiers: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }

    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  };

  visit(output);

  return specifiers;
}

// Every source file the Admin Dashboard's bundle holds, from its entry.
function walkBundle(): Set<string> {
  const reached: Set<string> = new Set<string>([ENTRY]);
  const queue: Array<string> = [ENTRY];

  while (queue.length > 0) {
    const file: string = queue.shift() as string;

    if (file === JSON_TYPES_DICTIONARY) {
      continue;
    }

    for (const specifier of valueImportsOf(
      file,
      fs.readFileSync(file, "utf8"),
    )) {
      const target: string | undefined = resolveSpecifier(file, specifier);

      if (target && !reached.has(target)) {
        reached.add(target);
        queue.push(target);
      }
    }
  }

  return reached;
}

// The extraction's root a repository file is read under: the closest one.
function extractionRootOf(file: string): SourceRoot | undefined {
  let found: SourceRoot | undefined = undefined;

  for (const root of SOURCE_ROOTS) {
    if (file === root.directory || file.startsWith(`${root.directory}/`)) {
      if (!found || root.directory.length > found.directory.length) {
        found = root;
      }
    }
  }

  return found;
}

/*
 * The lines of the titles a file draws as written: a product's name on a
 * card or a form step ({ title: "Resend", isTitleProductName: true }).
 */
function productNameTitleLines(file: string, text: string): Set<number> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines: Set<number> = new Set<number>();

  const propertyOf: (
    node: ts.ObjectLiteralExpression,
    name: string,
  ) => ts.PropertyAssignment | undefined = (
    node: ts.ObjectLiteralExpression,
    name: string,
  ): ts.PropertyAssignment | undefined => {
    return node.properties.find(
      (
        property: ts.ObjectLiteralElementLike,
      ): property is ts.PropertyAssignment => {
        return (
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === name
        );
      },
    );
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const productName: ts.PropertyAssignment | undefined = propertyOf(
        node,
        "isTitleProductName",
      );
      const title: ts.PropertyAssignment | undefined = propertyOf(
        node,
        "title",
      );

      if (
        productName &&
        productName.initializer.kind === ts.SyntaxKind.TrueKeyword &&
        title
      ) {
        lines.add(
          source.getLineAndCharacterOfPosition(
            title.initializer.getStart(source),
          ).line + 1,
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return lines;
}

interface SharedString {
  // A flat key, or a nested key's path joined by PATH_JOINER.
  key: string;
  // The shared file that draws it, repository-relative.
  file: string;
}

interface SharedFiles {
  bundle: Set<string>;
  scanned: Array<string>;
  strings: Array<SharedString>;
}

// What the extraction reads in every Common file the bundle holds.
function readSharedFiles(): SharedFiles {
  const bundle: Set<string> = walkBundle();
  const columns: FormColumnDescriptionFinder = new FormColumnDescriptionFinder(
    REPOSITORY_ROOT,
  );
  const scanned: Array<string> = [];
  const strings: Array<SharedString> = [];

  for (const file of Array.from(bundle).sort()) {
    const relative: string = repositoryPath(file);
    const root: SourceRoot | undefined = extractionRootOf(relative);

    if (
      !relative.startsWith("packages/Common/") ||
      !root ||
      root.kind === "models" ||
      SKIPPED_SOURCE_FILES.has(relative)
    ) {
      continue;
    }

    const text: string = fs.readFileSync(file, "utf8");
    const asWritten: Set<number> = productNameTitleLines(relative, text);

    scanned.push(relative);

    for (const entry of scanSourceText(relative, text, { kind: root.kind })
      .strings as Array<ExtractedString>) {
      if (entry.kind === "prop" && asWritten.has(entry.line)) {
        continue;
      }

      if (entry.nestedPath) {
        strings.push({
          key: entry.nestedPath.join(PATH_JOINER),
          file: relative,
        });
        continue;
      }

      strings.push({ key: entry.text, file: relative });

      if (entry.pluralOne !== undefined) {
        strings.push({ key: `${entry.text}_one`, file: relative });
      }
    }

    if (root.kind === "ui") {
      for (const column of columns.find(file, text)) {
        strings.push({
          key: (column as FormColumnDescription).text,
          file: relative,
        });
      }
    }
  }

  return { bundle, scanned, strings };
}

const SHARED: SharedFiles = readSharedFiles();

const DASHBOARD_ENGLISH: LocaleTree = readLocale("Dashboard", "en");
const DASHBOARD: Record<string, LocaleTree> = Object.fromEntries(
  LANGUAGES.map((language: string): [string, LocaleTree] => {
    return [language, readLocale("Dashboard", language)];
  }),
);

/*
 * The strings the Dashboard translates: its English locale has the key, and
 * at least one of its languages words it otherwise than English. The first
 * file that draws each names it.
 */
const TRANSLATED: Map<string, string> = new Map<string, string>();

for (const shared of SHARED.strings) {
  const english: string | undefined = entryAt(DASHBOARD_ENGLISH, shared.key);

  if (english === undefined || TRANSLATED.has(shared.key)) {
    continue;
  }

  if (
    LANGUAGES.some((language: string): boolean => {
      const worded: string | undefined = entryAt(
        DASHBOARD[language] as LocaleTree,
        shared.key,
      );

      return worded !== undefined && worded !== english;
    })
  ) {
    TRANSLATED.set(shared.key, shared.file);
  }
}

// How a key is named in a failure: its file, then the key as a page has it.
function named(key: string): string {
  return `${TRANSLATED.get(key)}: ${key.split(PATH_JOINER).join(".")}`;
}

function bundled(file: string): boolean {
  return SHARED.bundle.has(path.join(REPOSITORY_ROOT, file));
}

describe("the shared files the Admin Dashboard draws", () => {
  test("are found from its entry: its pages, and the forms, menus and table controls they draw", () => {
    for (const file of [
      "packages/App/FeatureSet/AdminDashboard/src/App.tsx",
      // Settings > Single Sign-On, and Settings > Email.
      "packages/Common/UI/Components/Sso/OidcProviderFormFields.ts",
      "packages/Common/UI/Components/Sso/SamlProviderFormFields.ts",
      "packages/Common/UI/Components/Sso/SsoProviderFormFields.ts",
      "packages/Common/UI/Components/SmtpConfig/SmtpConfigFormFields.ts",
      "packages/Common/UI/Components/CardSelect/CardSelect.tsx",
      // The header and its menus.
      "packages/Common/UI/Components/Navbar/NavBar.tsx",
      "packages/Common/UI/Components/Navbar/NavBarMenuModal.tsx",
      // Through the shared table, form and delete dialog.
      "packages/Common/UI/Components/ModelTable/ModelTable.tsx",
      "packages/Common/UI/Components/BulkUpdate/BulkSwitchActions.tsx",
      "packages/Common/UI/Components/DeleteConfirmation/DeleteConsequences.ts",
      "packages/Common/UI/Components/Dropdown/Dropdown.tsx",
      "packages/Common/UI/Components/Markdown.tsx/MarkdownEditor.tsx",
      // A component loaded only when it opens: import().
      "packages/Common/UI/Components/Markdown.tsx/LazyMarkdownEditor.tsx",
    ]) {
      expect({ file, bundled: bundled(file) }).toEqual({ file, bundled: true });
    }

    // Many: a walk that stopped early would pass otherwise.
    expect(SHARED.bundle.size).toBeGreaterThan(800);
    expect(SHARED.scanned.length).toBeGreaterThan(400);
  });

  test("an import used only as a type loads nothing, as the build drops it", () => {
    const text: string = [
      'import type Kept from "./OnlyAType";',
      'import AlsoAType from "./AlsoAType";',
      'import { type Named, Drawn } from "./Drawn";',
      'import Unused from "./Unused";',
      'import "./SideEffect";',
      'export { Again } from "./ReExported";',
      'const lazy: Promise<unknown> = import("./Lazy");',
      "const value: AlsoAType | Kept | Named = Drawn();",
    ].join("\n");

    expect(valueImportsOf("Example.ts", text).sort()).toEqual(
      ["./Drawn", "./Lazy", "./ReExported", "./SideEffect"].sort(),
    );
  });

  test("the types API rebuilds from JSON are loaded, but not drawn: the walk does not go through them", () => {
    expect(SHARED.bundle.has(JSON_TYPES_DICTIONARY)).toBe(true);

    for (const file of [
      "packages/Common/Types/Monitor/MonitorCriteriaInstance.ts",
      "packages/Common/Types/Monitor/MonitorType.ts",
      "packages/Common/Types/SecurityEvent/SecurityWatchlist.ts",
    ]) {
      expect({ file, bundled: bundled(file) }).toEqual({
        file,
        bundled: false,
      });
    }
  });

  test("reads their strings as the Dashboard's extraction does, and a product's name as written", () => {
    expect(Array.from(TRANSLATED.keys())).toEqual(
      expect.arrayContaining([
        // A multi-select's chip (Dropdown).
        "Remove {{option}}",
        // The OIDC provider form, a plural's one form, a code editor's line.
        "Client Secret",
        "Enable {{count}} {{itemsName}}",
        "Enable {{count}} {{itemsName}}_one",
        "Ln {{line}}, Col {{column}}",
        // A callout's name, a nested key (MarkdownQuote).
        ["markdownCallouts", "note"].join(PATH_JOINER),
      ]),
    );
    // Resend is a product on the SMTP form's cards, the verb in the locales.
    expect(
      SHARED.strings.some((shared: SharedString): boolean => {
        return (
          shared.key === "Resend" &&
          shared.file ===
            "packages/Common/UI/Components/SmtpConfig/SmtpConfigFormFields.ts"
        );
      }),
    ).toBe(false);
    // Hundreds: a scan that read nothing would pass otherwise.
    expect(TRANSLATED.size).toBeGreaterThan(1000);
  });

  test.each(["en", ...LANGUAGES])(
    "%s: every string they draw that the Dashboard translates is an entry of the Admin Dashboard's locale",
    (language: string) => {
      const admin: LocaleTree = readLocale("AdminDashboard", language);
      const missing: Array<string> = Array.from(TRANSLATED.keys())
        .filter((key: string): boolean => {
          return entryAt(admin, key) === undefined;
        })
        .map(named);

      // Add each to all 18 files, worded as the Dashboard words it there.
      expect({ language, missing }).toEqual({ language, missing: [] });
    },
  );

  test("en: each is its English, as the Dashboard's English has it", () => {
    const admin: LocaleTree = readLocale("AdminDashboard", "en");
    const otherwise: Array<string> = Array.from(TRANSLATED.keys())
      .filter((key: string): boolean => {
        return (
          entryAt(admin, key) !== undefined &&
          entryAt(admin, key) !== entryAt(DASHBOARD_ENGLISH, key)
        );
      })
      .map(named);

    expect(otherwise).toEqual([]);
  });

  test.each(LANGUAGES)(
    "%s: none is left in English where the Dashboard words it otherwise",
    (language: string) => {
      const admin: LocaleTree = readLocale("AdminDashboard", language);
      const dashboard: LocaleTree = DASHBOARD[language] as LocaleTree;
      const leftInEnglish: Array<string> = Array.from(TRANSLATED.keys())
        .filter((key: string): boolean => {
          const english: string | undefined = entryAt(DASHBOARD_ENGLISH, key);

          return (
            entryAt(dashboard, key) !== english &&
            entryAt(admin, key) === english
          );
        })
        .map(named);

      expect({ language, leftInEnglish }).toEqual({
        language,
        leftInEnglish: [],
      });
    },
  );
});
