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
 * NOR ALMOST REPEATS IT. "Logs > Call Logs", "Calendar > Maintenance
 * Calendar", "Notes > Private Notes", "Rules > Monitor Rules" (#9216): a
 * heading whose every word is in its only entry (or the other way round)
 * tells the reader nothing the entry does not, so the entry joins a
 * neighbouring section (Call Logs went to the policy's Basic, Monitor Rules
 * into Basic) or Advanced (a runbook's Executions). Words
 * are compared without case or a plural "s", so "Incoming Calls > Incoming
 * Call Policies" is one too. A section that must keep such a heading is in
 * ALLOWED_NEAR_REPEATS, with the reason.
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

// "On-Call Schedules" as ["on-call", "schedule"]: no case, no plural "s".
function words(name: string): Array<string> {
  return normalized(name)
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((word: string): boolean => {
      return word.length > 0;
    })
    .map((word: string): string => {
      return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
    });
}

function containsEvery(
  container: Array<string>,
  contained: Array<string>,
): boolean {
  return (
    contained.length > 0 &&
    contained.every((word: string): boolean => {
      return container.includes(word);
    })
  );
}

/*
 * A one-entry section whose heading's words are all in its entry ("Logs >
 * Call Logs"), or its entry's words all in its heading. An exact repeat is
 * one too.
 */
export function nearlyRepeatsItsOnlyEntry(section: MenuSectionFound): boolean {
  if (section.entries === null || section.entries.length !== 1) {
    return false;
  }

  const heading: Array<string> = words(section.title);
  const entry: Array<string> = words(section.entries[0]!);

  return containsEvery(entry, heading) || containsEvery(heading, entry);
}

interface AllowedNearRepeat {
  // Relative to the repository root, with forward slashes.
  file: string;
  title: string;
  entry: string;
  reason: string;
}

const PRODUCT_LIST_REASON: string =
  "A product menu's first section is named after the product and opens with its list of everything (Monitors > All Monitors, Real User Monitoring > All Applications). Here the list is the product's only page outside Settings and Advanced, so the section holds one entry, but folding it into Settings would file the product's own list as a setting.";

const ALLOWED_NEAR_REPEATS: Array<AllowedNearRepeat> = [
  {
    file: "packages/App/FeatureSet/Dashboard/src/Pages/Service/SideMenu.tsx",
    title: "Services",
    entry: "All Services",
    reason: PRODUCT_LIST_REASON,
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Pages/Teams/SideMenu.tsx",
    title: "Teams",
    entry: "All Teams",
    reason: PRODUCT_LIST_REASON,
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Pages/Users/SideMenu.tsx",
    title: "Users",
    entry: "All Users",
    reason: PRODUCT_LIST_REASON,
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SideMenu.tsx",
    title: "Rules",
    entry: "Monitor Rules",
    reason:
      'The maintainer asked for it: "Create a new section for rules and have monitor rules there. The section should be collapsed by default." Monitor Rules used to sit inside Resources, a row on every visit for something written once, and before that under Advanced, where the person who filed #3418 never found it. A folded Rules section right below Resources is neither. An SLO\'s Rules section holds its monitor rules the same way.',
  },
];

function isAllowedNearRepeat(section: MenuSectionFound): boolean {
  return ALLOWED_NEAR_REPEATS.some((allowed: AllowedNearRepeat): boolean => {
    return (
      allowed.file === section.file.split(path.sep).join("/") &&
      allowed.title === section.title &&
      allowed.entry === section.entries?.[0]
    );
  });
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

  test("no menu has one whose heading nearly repeats its only entry", () => {
    const nearlyRepeated: Array<string> = sections
      .filter((section: MenuSectionFound): boolean => {
        return (
          nearlyRepeatsItsOnlyEntry(section) && !isAllowedNearRepeat(section)
        );
      })
      .map((section: MenuSectionFound): string => {
        return `${section.file}:${section.line} "${section.title}" holds only "${section.entries![0]}"`;
      });

    expect(nearlyRepeated).toEqual([]);
  });

  test("every allowed near repeat is still there, and says why", () => {
    for (const allowed of ALLOWED_NEAR_REPEATS) {
      expect(allowed.reason.length).toBeGreaterThan(40);
      expect(
        sections.filter((section: MenuSectionFound): boolean => {
          return (
            section.file.split(path.sep).join("/") === allowed.file &&
            section.title === allowed.title &&
            section.entries?.length === 1 &&
            section.entries[0] === allowed.entry
          );
        }),
      ).toHaveLength(1);
    }
  });
});

describe("a near repeat", () => {
  function section(title: string, entries: Array<string>): MenuSectionFound {
    return { file: "Menu.tsx", line: 1, title, entries };
  }

  test.each([
    ["Logs", "Call Logs"],
    ["Logs", "Notification Logs"],
    ["Calendar", "Maintenance Calendar"],
    ["Notes", "Private Notes"],
    ["Alerts", "Member Alerts"],
    ["Incidents", "Member Incidents"],
    ["Rules", "Monitor Rules"],
    ["On-Call", "On-Call Schedules"],
    ["Incoming Calls", "Incoming Call Policies"],
    ["Support", "Customer Support Access"],
    ["Team Settings", "Settings"],
    ["Danger Zone", "Danger zone"],
  ])("%j holding only %j is one", (title: string, entry: string) => {
    expect(nearlyRepeatsItsOnlyEntry(section(title, [entry]))).toBe(true);
  });

  test.each([
    ["Danger Zone", "Delete Project"],
    ["Basic", "Overview"],
    ["Advanced", "Archived"],
    ["Reports", "User On-Call Time"],
    ["Real User Monitoring", "All Applications"],
    ["On-Call", "Calendar Feeds"],
    // A word inside a longer one is not that word.
    ["Log", "Catalog Logic"],
  ])("%j holding only %j is not one", (title: string, entry: string) => {
    expect(nearlyRepeatsItsOnlyEntry(section(title, [entry]))).toBe(false);
  });

  test("a section of two entries is never one", () => {
    expect(
      nearlyRepeatsItsOnlyEntry(section("Logs", ["Call Logs", "Audit Logs"])),
    ).toBe(false);
  });

  test("a section whose entries cannot be counted is never one", () => {
    expect(
      nearlyRepeatsItsOnlyEntry({
        file: "Menu.tsx",
        line: 1,
        title: "Logs",
        entries: null,
      }),
    ).toBe(false);
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
