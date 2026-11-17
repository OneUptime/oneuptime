// UX rule: Docs/ux/README.md#side-menus
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * A SECTION WITH ONE ENTRY DOES NOT REPEAT THAT ENTRY'S NAME.
 *
 * User Settings read "On-Call Logs > On-Call Logs", the Admin Dashboard's
 * settings "Data Retention > Data Retention", Project Settings "Danger Zone >
 * Danger Zone", and seven resource pages "Settings > Settings" (#9134). A
 * heading that says what its only entry says doubles the menu's height, and
 * when it starts folded it hides that page behind a click that tells the
 * reader nothing new. Such an entry joins a section of related pages (a
 * resource's Settings went to Advanced, beside Owners and Audit Logs), or
 * the entry says what the page does (Danger Zone > Delete Project).
 *
 * This reads every side menu in the App's feature sets and the enterprise
 * dashboards, in both of the forms they are written in:
 *
 *   - `<SideMenuSection title="...">` with its `<SideMenuItem>`s (and the
 *     items that count themselves, `CountModelSideMenuItem`) as children;
 *   - a `{ title: "...", items: [...] }` section in a `sections` array.
 *
 * A section whose entries cannot be counted from the source (a spread, an
 * item drawn by another component) is left alone. A title may be English
 * text, which the menu looks up where it draws it, or a key of the Admin
 * Dashboard's locale (`t("sideMenu.settingsDataRetention")`); keys are read
 * as the English they stand for, so two keys with the same English repeat
 * each other too.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..");
const REPOSITORY_DIR: string = path.resolve(PACKAGES_DIR, "..");

const SCAN_DIRS: Array<string> = [
  path.join(PACKAGES_DIR, "App", "FeatureSet"),
  path.join(REPOSITORY_DIR, "ee", "Dashboard"),
  path.join(REPOSITORY_DIR, "ee", "AdminDashboard"),
];

const ADMIN_ENGLISH: Record<string, unknown> = JSON.parse(
  fs.readFileSync(
    path.join(
      PACKAGES_DIR,
      "App",
      "FeatureSet",
      "AdminDashboard",
      "src",
      "Locales",
      "en.json",
    ),
    "utf8",
  ),
) as Record<string, unknown>;

const ITEM_TAGS: ReadonlyArray<string> = [
  "SideMenuItem",
  "CountModelSideMenuItem",
];

export interface MenuSectionFound {
  file: string;
  line: number;
  title: string;
  // The entries' titles, or null when they cannot be read from the source.
  entries: Array<string> | null;
}

// "sideMenu.settingsDataRetention" as the English the Admin Dashboard draws.
function englishOfKey(key: string): string {
  let value: unknown = ADMIN_ENGLISH;

  for (const part of key.split(".")) {
    value = (value as Record<string, unknown> | undefined)?.[part];
  }

  return typeof value === "string" ? value : key;
}

// A title as written: a string, or t("key"). Anything else is unreadable.
function readTitle(expression: ts.Expression | undefined): string | null {
  if (!expression) {
    return null;
  }

  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return expression.text;
  }

  if (
    ts.isCallExpression(expression) &&
    expression.expression.getText() === "t" &&
    expression.arguments[0] &&
    ts.isStringLiteral(expression.arguments[0])
  ) {
    return englishOfKey(expression.arguments[0].text);
  }

  return null;
}

function jsxAttribute(
  element: ts.JsxOpeningLikeElement,
  name: string,
): ts.Expression | undefined {
  for (const attribute of element.attributes.properties) {
    if (ts.isJsxAttribute(attribute) && attribute.name.getText() === name) {
      if (!attribute.initializer) {
        return undefined;
      }

      if (ts.isStringLiteral(attribute.initializer)) {
        return attribute.initializer;
      }

      if (ts.isJsxExpression(attribute.initializer)) {
        return attribute.initializer.expression;
      }
    }
  }

  return undefined;
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && property.name.getText() === name) {
      return property.initializer;
    }
  }

  return undefined;
}

// The title of an item's link={{ title }} or link: { title }.
function linkTitle(link: ts.Expression | undefined): string | null {
  if (!link || !ts.isObjectLiteralExpression(link)) {
    return null;
  }

  return readTitle(objectProperty(link, "title"));
}

function jsxSectionEntries(section: ts.JsxElement): Array<string> | null {
  const entries: Array<string> = [];
  let isReadable: boolean = true;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag: string = node.tagName.getText().replace(/<.*$/, "");

      if (ITEM_TAGS.includes(tag)) {
        const title: string | null = linkTitle(jsxAttribute(node, "link"));

        if (title === null) {
          isReadable = false;
        } else {
          entries.push(title);
        }
      } else if (tag.match(/^[A-Z]/) && tag !== "SideMenuSection") {
        // A component of its own may draw entries this cannot see.
        isReadable = false;
      }
    } else if (ts.isJsxExpression(node) && node.expression) {
      // {cond ? <SideMenuItem/> : <></>} is read; {someItems()} is not.
      if (
        ts.isCallExpression(node.expression) ||
        ts.isIdentifier(node.expression)
      ) {
        isReadable = false;
      }
    }

    ts.forEachChild(node, visit);
  };

  section.children.forEach(visit);

  return isReadable ? entries : null;
}

function arraySectionEntries(
  items: ts.Expression | undefined,
): Array<string> | null {
  if (!items || !ts.isArrayLiteralExpression(items)) {
    return null;
  }

  const entries: Array<string> = [];

  for (const element of items.elements) {
    if (!ts.isObjectLiteralExpression(element)) {
      return null;
    }

    const title: string | null = linkTitle(objectProperty(element, "link"));

    if (title === null) {
      return null;
    }

    entries.push(title);
  }

  return entries;
}

export function readMenuSections(
  file: string,
  source: string,
): Array<MenuSectionFound> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: Array<MenuSectionFound> = [];

  const lineOf: (node: ts.Node) => number = (node: ts.Node): number => {
    return (
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1
    );
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText() === "SideMenuSection"
    ) {
      const title: string | null = readTitle(
        jsxAttribute(node.openingElement, "title"),
      );

      if (title !== null) {
        found.push({
          file,
          line: lineOf(node),
          title,
          entries: jsxSectionEntries(node),
        });
      }
    }

    if (ts.isObjectLiteralExpression(node)) {
      const items: ts.Expression | undefined = objectProperty(node, "items");
      const title: string | null = readTitle(objectProperty(node, "title"));

      if (items && title !== null) {
        found.push({
          file,
          line: lineOf(node),
          title,
          entries: arraySectionEntries(items),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

function normalized(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function repeatsItsOnlyEntry(section: MenuSectionFound): boolean {
  return (
    section.entries !== null &&
    section.entries.length === 1 &&
    normalized(section.entries[0]!) === normalized(section.title)
  );
}

function sourceFiles(directory: string): Array<string> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }

    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (entry.name.match(/\.tsx?$/) && !entry.name.endsWith(".d.ts")) {
      files.push(full);
    }
  }

  return files;
}

function everyMenuSection(): Array<MenuSectionFound> {
  const sections: Array<MenuSectionFound> = [];

  for (const directory of SCAN_DIRS) {
    for (const file of sourceFiles(directory)) {
      const source: string = fs.readFileSync(file, "utf8");

      if (!source.includes("SideMenu")) {
        continue;
      }

      sections.push(
        ...readMenuSections(path.relative(REPOSITORY_DIR, file), source),
      );
    }
  }

  return sections;
}

describe("a section with one entry does not repeat that entry's name", () => {
  const sections: Array<MenuSectionFound> = everyMenuSection();

  test("every side menu's sections are read", () => {
    const files: Set<string> = new Set(
      sections.map((section: MenuSectionFound): string => {
        return section.file;
      }),
    );

    // The menus #9134 changed, in both forms and with the Admin's keys.
    expect(files).toContain(
      "packages/App/FeatureSet/Dashboard/src/Pages/UserSettings/SideMenu.tsx",
    );
    expect(files).toContain(
      "packages/App/FeatureSet/Dashboard/src/Pages/Dashboards/View/SideMenu.tsx",
    );
    expect(files).toContain(
      "packages/App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu.tsx",
    );
    expect(files.size).toBeGreaterThan(80);
  });

  test("no menu has one", () => {
    const repeated: Array<string> = sections
      .filter(repeatsItsOnlyEntry)
      .map((section: MenuSectionFound): string => {
        return `${section.file}:${section.line} "${section.title}" holds only "${section.entries![0]}"`;
      });

    expect(repeated).toEqual([]);
  });
});

describe("the reader", () => {
  test("finds a JSX section that repeats its only entry", () => {
    const found: Array<MenuSectionFound> = readMenuSections(
      "Menu.tsx",
      `const Menu = () => (
        <SideMenu>
          <SideMenuSection title="Owners">
            <SideMenuItem link={{ title: "Owners", to: route }} />
          </SideMenuSection>
          <SideMenuSection title="Basic">
            <SideMenuItem link={{ title: "Overview", to: route }} />
            {isOn ? <SideMenuItem link={{ title: "Basic", to: route }} /> : <></>}
          </SideMenuSection>
        </SideMenu>
      );`,
    );

    expect(found.filter(repeatsItsOnlyEntry)).toEqual([
      { file: "Menu.tsx", line: 3, title: "Owners", entries: ["Owners"] },
    ]);
    expect(found[1]!.entries).toEqual(["Overview", "Basic"]);
  });

  test("finds an array section that repeats its only entry, in any case", () => {
    const found: Array<MenuSectionFound> = readMenuSections(
      "Menu.tsx",
      `const sections = [
        { title: "Danger Zone", items: [{ link: { title: "Danger zone", to: route } }] },
        { title: "Danger Zone", items: [{ link: { title: "Delete Project", to: route } }] },
      ];`,
    );

    expect(found.filter(repeatsItsOnlyEntry)).toHaveLength(1);
    expect(found.filter(repeatsItsOnlyEntry)[0]!.line).toBe(2);
  });

  test("reads the Admin Dashboard's keys as their English", () => {
    const found: Array<MenuSectionFound> = readMenuSections(
      "Menu.tsx",
      `const Menu = () => (
        <SideMenuSection title={t("sideMenu.settingsDataRetention")} isTitleTranslated={true}>
          <SideMenuItem link={{ title: t("sideMenu.settingsDataRetention"), to: route }} />
        </SideMenuSection>
      );`,
    );

    expect(found).toEqual([
      {
        file: "Menu.tsx",
        line: 2,
        title: "Data Retention",
        entries: ["Data Retention"],
      },
    ]);
    expect(repeatsItsOnlyEntry(found[0]!)).toBe(true);
  });

  test("leaves alone a section whose entries it cannot count", () => {
    const found: Array<MenuSectionFound> = readMenuSections(
      "Menu.tsx",
      `const Menu = () => (
        <SideMenuSection title="Settings">
          <SideMenuItem link={{ title: "Settings", to: route }} />
          {EnterpriseItems ? <EnterpriseItems /> : <></>}
        </SideMenuSection>
      );
      const sections = [{ title: "Settings", items: [settingsItem, ...more] }];`,
    );

    expect(
      found.map((section: MenuSectionFound) => {
        return section.entries;
      }),
    ).toEqual([null, null]);
  });
});
