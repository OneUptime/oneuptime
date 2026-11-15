// UX rule: Docs/ux/README.md#in-every-language
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  ExtractedString,
  scanSourceRoots,
  scanSourceText,
  SOURCE_ROOTS,
  SourceRoot,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import { getDefaultContext } from "../../FeatureSet/Dashboard/scripts/i18n/I18n";

/*
 * EVERY TAB'S NAME IS A KEY, HOWEVER A PAGE BUILDS ITS TABS (#8367).
 *
 * Tab draws its name looked up (translateString(props.tab.name)), but the
 * extractor read a tab's name only as an item of a `tabs={[...]}` or
 * `tabs: [...]` list. Most pages build their tabs in a variable first
 * (`const tabs: Array<Tab> = [...]`, `tabs.push({...})`), so their names were
 * looked up and never extracted: no locale had them, and "Diff vs.
 * baseline" on a profile and "Env Vars" on a Kubernetes pod read English in
 * every language. It also left "Top functions" out of the scan's list of
 * drawn keys, though the profile page draws it: a count of keys no source
 * draws (#7286) would have taken it for an old one.
 *
 * The extractor now knows a tab wherever it is written: by its list's name,
 * by the type its array or its variable is declared as, pushed onto such an
 * array, or returned by a function that returns a Tab.
 */

const CONTEXT: ReturnType<typeof getDefaultContext> = getDefaultContext();
const REPOSITORY_ROOT: string = CONTEXT.repositoryRoot;
const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";
const LOCALES_DIR: string = path.join(REPOSITORY_ROOT, DASHBOARD, "Locales");

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

// What the extractor reads from a fixture page, as its texts.
function extracted(source: string): Array<string> {
  return scanSourceText(`${DASHBOARD}/Pages/Example/Page.tsx`, source, {
    kind: "ui",
  }).strings.map((entry: ExtractedString): string => {
    return entry.text;
  });
}

describe("the extractor reads a tab's name wherever a page writes the tab", () => {
  test("an item of a tabs list, a prop or a property (as before)", () => {
    expect(
      extracted(
        [
          'const a = <Tabs tabs={[{ name: "Alpha Tab", children: <div /> }]} />;',
          'const b = { tabs: [{ name: "Beta Tab", children: <div /> }] };',
        ].join("\n"),
      ),
    ).toEqual(expect.arrayContaining(["Alpha Tab", "Beta Tab"]));
  });

  test("an array declared as tabs, by its type or its name", () => {
    expect(
      extracted(
        [
          'import { Tab } from "Common/UI/Components/Tabs/Tab";',
          'const first: Array<Tab> = [{ name: "Diff vs. baseline", children: <div /> }];',
          'const second: Tab[] = [{ name: "Env Vars", children: <div /> }];',
          'const third: ReadonlyArray<Tab> = [{ name: "Gamma Tab", children: <div /> }];',
          'const tabs = [{ name: "Delta Tab", children: <div /> }];',
        ].join("\n"),
      ),
    ).toEqual(
      expect.arrayContaining([
        "Diff vs. baseline",
        "Env Vars",
        "Gamma Tab",
        "Delta Tab",
      ]),
    );
  });

  test("a tab pushed onto such an array, declared as one, or returned as one", () => {
    expect(
      extracted(
        [
          "const items: Array<Tab> = [];",
          'items.push({ name: "Epsilon Tab", children: <div /> });',
          "const tabs: Array<Tab> = [];",
          'tabs.push({ name: "Zeta Tab", children: <div /> });',
          'const single: Tab = { name: "Eta Tab", children: <div /> };',
          'const make = (): Tab => ({ name: "Theta Tab", children: <div /> });',
          'function build(): Tab { return { name: "Iota Tab", children: <div /> }; }',
        ].join("\n"),
      ),
    ).toEqual(
      expect.arrayContaining([
        "Epsilon Tab",
        "Zeta Tab",
        "Eta Tab",
        "Theta Tab",
        "Iota Tab",
      ]),
    );
  });

  test("a name that is no tab's stays out: an id, a person, a column (negative control)", () => {
    const texts: Array<string> = extracted(
      [
        'const columns = [{ name: "created_at", type: "date" }];',
        'const people: Array<Person> = [{ name: "Ada Lovelace" }];',
        'const person: Person = { name: "Grace Hopper" };',
        'others.push({ name: "Not A Tab" });',
        'const one = (): Person => ({ name: "Alan Turing" });',
      ].join("\n"),
    );

    for (const name of [
      "created_at",
      "Ada Lovelace",
      "Grace Hopper",
      "Not A Tab",
      "Alan Turing",
    ]) {
      expect({ name, extracted: texts.includes(name) }).toEqual({
        name,
        extracted: false,
      });
    }
  });
});

/*
 * Every literal tab name in the Dashboard's and Common/UI's source, found
 * independently of the extractor: an object literal with a string `name`
 * and a `children` that is no list, as Tab is.
 */
interface TabName {
  file: string;
  name: string;
}

const SOURCE_FILE: RegExp = /\.tsx?$/;
const DECLARATION_FILE: RegExp = /\.d\.ts$/;

function listFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "Locales") {
        files.push(...listFiles(full));
      }
    } else if (
      SOURCE_FILE.test(entry.name) &&
      !DECLARATION_FILE.test(entry.name)
    ) {
      files.push(full);
    }
  }

  return files;
}

function findTabNames(): Array<TabName> {
  const roots: Array<string> = SOURCE_ROOTS.filter(
    (root: SourceRoot): boolean => {
      return (
        root.kind === "ui" &&
        fs.existsSync(path.join(REPOSITORY_ROOT, root.directory)) &&
        fs.statSync(path.join(REPOSITORY_ROOT, root.directory)).isDirectory()
      );
    },
  ).map((root: SourceRoot): string => {
    return path.join(REPOSITORY_ROOT, root.directory);
  });
  const names: Array<TabName> = [];

  for (const root of roots) {
    for (const file of listFiles(root)) {
      const text: string = fs.readFileSync(file, "utf8");

      if (!text.includes("children")) {
        continue;
      }

      const source: ts.SourceFile = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );

      const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (ts.isObjectLiteralExpression(node)) {
          let name: string | undefined = undefined;
          let hasChildren: boolean = false;

          for (const property of node.properties) {
            if (!ts.isPropertyAssignment(property)) {
              continue;
            }

            const key: string | undefined =
              ts.isIdentifier(property.name) ||
              ts.isStringLiteral(property.name)
                ? property.name.text
                : undefined;

            // A tab's children is an element; a tree node's (a flame graph's) is a list.
            if (
              key === "children" &&
              !ts.isArrayLiteralExpression(property.initializer)
            ) {
              hasChildren = true;
            }

            if (
              key === "name" &&
              (ts.isStringLiteral(property.initializer) ||
                ts.isNoSubstitutionTemplateLiteral(property.initializer))
            ) {
              name = property.initializer.text;
            }
          }

          // isName: a product's name, drawn as written (Tab).
          const isName: boolean = node.properties.some(
            (property: ts.ObjectLiteralElementLike): boolean => {
              return (
                ts.isPropertyAssignment(property) &&
                ts.isIdentifier(property.name) &&
                property.name.text === "isName" &&
                property.initializer.kind === ts.SyntaxKind.TrueKeyword
              );
            },
          );

          if (name && hasChildren && !isName) {
            names.push({
              file: path
                .relative(REPOSITORY_ROOT, file)
                .split(path.sep)
                .join("/"),
              name,
            });
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(source);
    }
  }

  return names;
}

describe("every tab a page draws is a key", () => {
  const ENGLISH: Record<string, string> = readLocale("en");
  const TAB_NAMES: Array<TabName> = findTabNames();

  test("the scan finds the pages' tabs", () => {
    // About 170 when #8367 was fixed.
    expect(TAB_NAMES.length).toBeGreaterThan(120);
    expect(TAB_NAMES).toEqual(
      expect.arrayContaining([
        {
          file: `${DASHBOARD}/Pages/Profiles/View/Index.tsx`,
          name: "Diff vs. baseline",
        },
        {
          file: `${DASHBOARD}/Pages/Kubernetes/View/PodDetail.tsx`,
          name: "Env Vars",
        },
      ]),
    );
  });

  test("each literal tab name is an en.json key", () => {
    const missing: Array<string> = TAB_NAMES.filter((tab: TabName): boolean => {
      return ENGLISH[tab.name] === undefined;
    }).map((tab: TabName): string => {
      return `${tab.file}: ${tab.name}`;
    });

    expect(missing).toEqual([]);
  });

  test("and each is one the extraction finds drawn, Top functions included", () => {
    const drawn: Set<string> = new Set<string>(
      scanSourceRoots(SOURCE_ROOTS, REPOSITORY_ROOT).strings.map(
        (entry: ExtractedString): string => {
          return entry.text;
        },
      ),
    );

    const notDrawn: Array<string> = TAB_NAMES.filter(
      (tab: TabName): boolean => {
        return !drawn.has(tab.name);
      },
    ).map((tab: TabName): string => {
      return `${tab.file}: ${tab.name}`;
    });

    expect(notDrawn).toEqual([]);
    expect(drawn.has("Top functions")).toBe(true);
  });

  test("the two that read English in every language are worded in every language", () => {
    for (const language of CONTEXT.locales) {
      const locale: Record<string, string> = readLocale(language);

      for (const name of ["Diff vs. baseline", "Env Vars"]) {
        expect({
          language,
          name,
          worded: Boolean(locale[name]) && locale[name] !== name,
        }).toEqual({ language, name, worded: true });
      }
    }

    expect(readLocale("de")["Env Vars"]).toBe("Umgebungsvariablen");
    expect(readLocale("fa")["Diff vs. baseline"]).toBe("تفاوت با خط پایه");
    expect(readLocale("ar")["Env Vars"]).toBe("متغيرات البيئة");
  });
});
