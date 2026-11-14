// UX rule: Docs/ux/README.md#dialogs-and-confirmations
import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import ts from "typescript";
import AppLink from "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink";
import {
  DashboardWidgetPreviewProvider,
  useIsDashboardWidgetPreview,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetPreview";
import Route from "../../../Types/API/Route";
import HtmlWidgetDocument from "../../../Utils/Dashboard/HtmlWidgetDocument";

/*
 * EVERY WIDGET HONOURS ITS LIVE PREVIEW (issue #6859).
 *
 * The widget settings dialog draws its widget as a reader sees it, out of
 * edit mode, over a board being edited - and nothing asks before leaving a
 * board with widgets not saved yet. So the dialog draws it with isPreview,
 * DashboardBaseComponentElement hands that to the widget and to every part
 * of it (DashboardWidgetPreviewProvider), and in it nothing leaves the page:
 * a link is its words (AppLink, the text widget's Markdown), a tile, a site
 * or an event marker opens nothing, and Open in Metric Explorer,
 * Investigate, a series' menu and an exemplar's are left out.
 *
 * The DashboardWidgetPreview*Links suites draw every kind of widget with a
 * link, in the preview and on the board. This guard reads the source, so a
 * widget added later - or a link added to one - cannot leave the page from
 * the preview:
 *
 *   - every file a widget is drawn from (each one under
 *     Dashboard/Components, and every file of the app they import) that
 *     can go to another page - a navigate() call, window.open, the
 *     address, an <a> that stays in the tab, react-router or the shared
 *     Link, Open in Explorer - is a widget that reads the preview
 *     (useIsDashboardWidgetPreview), or a part of one listed in REVIEWED
 *     with what keeps it from leaving the preview. An <a> that opens a tab
 *     of its own (target="_blank") leaves the board as it is: it is fine;
 *   - each switch a widget hands those parts - MetricCharts' series and
 *     exemplar menus, the event markers' clicks, Markdown's links, a funnel
 *     or retention widget's link - is set from the preview, or off;
 *   - the dialog draws its widget with isPreview, and the base element
 *     draws every widget inside the provider.
 *
 * A file of the app is read through the TypeScript AST, so a comment or a
 * string that names navigate() is never taken for a call.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..", "..", "..");

const APP_SRC_DIR: string = path.join(
  PACKAGES_DIR,
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

const WIDGETS_DIR: string = path.join(
  APP_SRC_DIR,
  "Components",
  "Dashboard",
  "Components",
);

const BASE_ELEMENT_FILE: string = path.join(
  WIDGETS_DIR,
  "DashboardBaseComponent.tsx",
);

const SETTINGS_MODAL_FILE: string = path.join(
  APP_SRC_DIR,
  "Components",
  "Dashboard",
  "Canvas",
  "ComponentSettingsModal.tsx",
);

const PREVIEW_HOOK: string = "useIsDashboardWidgetPreview";

const SOURCE_FILE_REGEX: RegExp = /\.tsx?$/;

const REACT_ROUTER_REGEX: RegExp = /^react-router(-dom)?$/;

// The line a described place names: "<file>:<line> (<kind>)".
const DESCRIBED_LINE_REGEX: RegExp = /:(\d+) /;

/*
 * The investigation drawer opens only from Investigate - shown with Open
 * in Explorer - and from a series' menu: never in the preview (both are
 * checked below). What it draws is a page of its own, so the walk does not
 * go into it.
 */
const INVESTIGATION_DRAWER_REGEX: RegExp = /InvestigationDrawer\.tsx$/;

const INVESTIGATION_DRAWER_OPENERS: ReadonlyArray<string> = [
  "Components/Dashboard/Components/DashboardChartComponent.tsx",
  "Components/Metrics/MetricCharts.tsx",
];

/*
 * The parts of a widget, out of Dashboard/Components, that can go to
 * another page: each with what keeps it from doing so in the preview. A
 * part added here needs that reason, and a check below or in a suite.
 */
const REVIEWED: Record<string, string> = {
  "Components/AppLink/AppLink.tsx":
    "Draws a link as its words under AppLinkAsTextContext, which DashboardWidgetPreviewProvider gives the preview.",
  "Components/Metrics/MetricCharts.tsx":
    "Its series menu comes with enableSeriesActions and its exemplar menu with enableExemplarActions; every widget sets both from the preview, or off.",
  "Components/Metrics/Utils/ExplorerLink.ts":
    "Opens the explorer when called: by the chart widget's Open in Metric Explorer, never shown in the preview, and by MetricCharts' series menu (enableSeriesActions).",
  "Components/Metrics/Utils/UseEventTimeReferenceLines.ts":
    "An incident's or an alert's marker opens it unless opensEvents is false, which every widget sets from the preview.",
  "Components/Infrastructure/ResourceTable.tsx":
    "A widget's parts read only its helpers - formatMemoryValue, a status's words and colours - never the table, whose rows open a resource's page.",
};

type NavigationKind =
  | "a navigate() call"
  | "window.open"
  | "the page's address"
  | "an <a> that stays in the tab"
  | "an href"
  | "react-router"
  | "the shared Link"
  | "Open in Explorer"
  | "useNavigate";

interface NavigationHit {
  file: string;
  line: number;
  kind: NavigationKind;
}

const sourceFiles: Map<string, ts.SourceFile> = new Map<
  string,
  ts.SourceFile
>();

function readSource(file: string): ts.SourceFile {
  const known: ts.SourceFile | undefined = sourceFiles.get(file);

  if (known) {
    return known;
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  sourceFiles.set(file, source);

  return source;
}

// Every node of a file, depth first.
function nodesOf(root: ts.Node): Array<ts.Node> {
  const nodes: Array<ts.Node> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    nodes.push(node);
    ts.forEachChild(node, visit);
  };

  visit(root);

  return nodes;
}

function lineOf(node: ts.Node): number {
  const source: ts.SourceFile = node.getSourceFile();

  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

// A file's place under the app's src, as REVIEWED names it.
function relativeToApp(file: string): string {
  return path.relative(APP_SRC_DIR, file).split(path.sep).join("/");
}

function resolveImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const base: string = path.resolve(path.dirname(fromFile), specifier);

  for (const candidate of [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    path.join(base, "index.tsx"),
    path.join(base, "index.ts"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

// What a file imports of the app's own files, a type alone left out.
function appImportsOf(file: string): Array<string> {
  const imports: Array<string> = [];

  for (const node of nodesOf(readSource(file))) {
    let specifier: string | null = null;

    if (
      ts.isImportDeclaration(node) &&
      !node.importClause?.isTypeOnly &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifier = node.moduleSpecifier.text;
    } else if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifier = node.moduleSpecifier.text;
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifier = node.arguments[0].text;
    }

    const resolved: string | null = specifier
      ? resolveImport(file, specifier)
      : null;

    if (resolved) {
      imports.push(resolved);
    }
  }

  return imports;
}

function widgetFiles(): Array<string> {
  return fs
    .readdirSync(WIDGETS_DIR)
    .filter((name: string): boolean => {
      return SOURCE_FILE_REGEX.test(name);
    })
    .sort()
    .map((name: string): string => {
      return path.join(WIDGETS_DIR, name);
    });
}

// Every file of the app a widget is drawn from: the widgets', and all they import.
function filesWidgetsAreDrawnFrom(): Array<string> {
  const seen: Set<string> = new Set<string>();
  const queue: Array<string> = widgetFiles();

  while (queue.length > 0) {
    const file: string = queue.pop() as string;

    if (seen.has(file)) {
      continue;
    }

    seen.add(file);

    for (const imported of appImportsOf(file)) {
      if (!INVESTIGATION_DRAWER_REGEX.test(imported) && !seen.has(imported)) {
        queue.push(imported);
      }
    }
  }

  return Array.from(seen).sort();
}

function jsxAttribute(
  element: ts.JsxOpeningLikeElement,
  name: string,
): ts.JsxAttribute | undefined {
  return element.attributes.properties.find(
    (property: ts.JsxAttributeLike): property is ts.JsxAttribute => {
      return ts.isJsxAttribute(property) && property.name.getText() === name;
    },
  );
}

function stringAttribute(
  element: ts.JsxOpeningLikeElement,
  name: string,
): string | undefined {
  const attribute: ts.JsxAttribute | undefined = jsxAttribute(element, name);

  if (attribute?.initializer && ts.isStringLiteral(attribute.initializer)) {
    return attribute.initializer.text;
  }

  return undefined;
}

// The expression an attribute is set to: {expression}; undefined for a bare one.
function attributeExpression(
  attribute: ts.JsxAttribute | undefined,
): ts.Expression | undefined {
  if (
    attribute?.initializer &&
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression
  ) {
    return attribute.initializer.expression;
  }

  return undefined;
}

function isJsxElementNamed(
  node: ts.Node,
  names: ReadonlyArray<string>,
): boolean {
  return (
    (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
    names.includes(node.tagName.getText())
  );
}

function calledName(node: ts.CallExpression): string {
  if (ts.isIdentifier(node.expression)) {
    return node.expression.text;
  }

  if (ts.isPropertyAccessExpression(node.expression)) {
    return node.expression.name.text;
  }

  return "";
}

// Where a file can go to another page.
function navigationIn(file: string): Array<NavigationHit> {
  const hits: Array<NavigationHit> = [];
  const add: (node: ts.Node, kind: NavigationKind) => void = (
    node: ts.Node,
    kind: NavigationKind,
  ): void => {
    hits.push({ file: relativeToApp(file), line: lineOf(node), kind });
  };

  for (const node of nodesOf(readSource(file))) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier: string = node.moduleSpecifier.text;

      if (REACT_ROUTER_REGEX.test(specifier)) {
        add(node, "react-router");
      }

      if (specifier.startsWith("Common/UI/Components/Link/")) {
        add(node, "the shared Link");
      }
    }

    if (ts.isCallExpression(node)) {
      const name: string = calledName(node);

      if (name === "navigate") {
        add(node, "a navigate() call");
      }

      if (name === "useNavigate") {
        add(node, "useNavigate");
      }

      if (name === "openInExplorer") {
        add(node, "Open in Explorer");
      }

      if (
        name === "open" &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText() === "window"
      ) {
        add(node, "window.open");
      }
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      node.expression.getText() === "window" &&
      node.name.text === "location"
    ) {
      add(node, "the page's address");
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName: string = node.tagName.getText();

      if (tagName === "a") {
        // A tab of its own leaves the board where it is.
        if (stringAttribute(node, "target") !== "_blank") {
          add(node, "an <a> that stays in the tab");
        }
      } else if (jsxAttribute(node, "href")) {
        add(node, "an href");
      }
    }
  }

  return hits;
}

function readsPreview(file: string): boolean {
  return nodesOf(readSource(file)).some((node: ts.Node): boolean => {
    return ts.isCallExpression(node) && calledName(node) === PREVIEW_HOOK;
  });
}

/*
 * Whether an expression is the preview's, or off: `false`, an expression of
 * the file's isPreview (const isPreview = useIsDashboardWidgetPreview()),
 * or a name the file declares from one, such as enableSeriesActions.
 */
function isSetFromPreview(
  expression: ts.Expression | undefined,
  file: string,
): boolean {
  if (!expression) {
    return false;
  }

  if (expression.kind === ts.SyntaxKind.FalseKeyword) {
    return true;
  }

  const namesPreview: (root: ts.Node) => boolean = (root: ts.Node): boolean => {
    return nodesOf(root).some((node: ts.Node): boolean => {
      return (
        ts.isIdentifier(node) &&
        node.text === "isPreview" &&
        !(
          ts.isPropertyAccessExpression(node.parent) &&
          node.parent.name === node
        )
      );
    });
  };

  const declarations: Array<ts.VariableDeclaration> = nodesOf(
    readSource(file),
  ).filter((node: ts.Node): node is ts.VariableDeclaration => {
    return ts.isVariableDeclaration(node) && ts.isIdentifier(node.name);
  });

  const isPreviewDeclaration: ts.VariableDeclaration | undefined =
    declarations.find((declaration: ts.VariableDeclaration): boolean => {
      return (
        declaration.name.getText() === "isPreview" &&
        Boolean(declaration.initializer) &&
        ts.isCallExpression(declaration.initializer!) &&
        calledName(declaration.initializer as ts.CallExpression) ===
          PREVIEW_HOOK
      );
    });

  if (!isPreviewDeclaration) {
    return false;
  }

  if (namesPreview(expression)) {
    return true;
  }

  if (ts.isIdentifier(expression)) {
    const declaration: ts.VariableDeclaration | undefined = declarations.find(
      (candidate: ts.VariableDeclaration): boolean => {
        return candidate.name.getText() === expression.text;
      },
    );

    return Boolean(
      declaration?.initializer && namesPreview(declaration.initializer),
    );
  }

  return false;
}

interface Setting {
  file: string;
  line: number;
  what: string;
  isFromPreview: boolean;
}

// Each place a widget hands a part one of the switches the preview turns off.
function previewSettingsIn(file: string): Array<Setting> {
  const settings: Array<Setting> = [];
  const add: (
    node: ts.Node,
    what: string,
    expression: ts.Expression | undefined,
  ) => void = (
    node: ts.Node,
    what: string,
    expression: ts.Expression | undefined,
  ): void => {
    settings.push({
      file: relativeToApp(file),
      line: lineOf(node),
      what,
      isFromPreview: isSetFromPreview(expression, file),
    });
  };

  for (const node of nodesOf(readSource(file))) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText() === "MetricCharts"
    ) {
      for (const name of ["enableSeriesActions", "enableExemplarActions"]) {
        add(
          node,
          `<MetricCharts ${name}>`,
          attributeExpression(jsxAttribute(node, name)),
        );
      }
    }

    if (isJsxElementNamed(node, ["LazyMarkdownViewer", "MarkdownViewer"])) {
      add(
        node,
        "a Markdown viewer's showLinksAsText",
        attributeExpression(
          jsxAttribute(node as ts.JsxOpeningLikeElement, "showLinksAsText"),
        ),
      );
    }

    if (ts.isCallExpression(node)) {
      const objectProperty: (name: string) => ts.Expression | undefined = (
        name: string,
      ): ts.Expression | undefined => {
        const argument: ts.Expression | undefined = node.arguments[0];

        if (!argument || !ts.isObjectLiteralExpression(argument)) {
          return undefined;
        }

        for (const property of argument.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            property.name.getText() === name
          ) {
            return property.initializer;
          }
        }

        return undefined;
      };

      if (calledName(node) === "useEventTimeReferenceLines") {
        add(
          node,
          "the event markers' opensEvents",
          objectProperty("opensEvents"),
        );
      }

      if (calledName(node) === "isProductAnalyticsWidgetLinked") {
        add(
          node,
          "a funnel's or retention's link",
          objectProperty("isPreview"),
        );
      }
    }
  }

  return settings;
}

function describeHit(hit: NavigationHit): string {
  return `${hit.file}:${hit.line} (${hit.kind})`;
}

afterEach(() => {
  cleanup();
});

describe("every file a widget is drawn from keeps the preview on the page", () => {
  const files: Array<string> = filesWidgetsAreDrawnFrom();

  test("the walk reaches every widget and the parts they share", () => {
    const reached: Array<string> = files.map(relativeToApp);

    expect(reached).toEqual(
      expect.arrayContaining([
        "Components/Dashboard/Components/DashboardBaseComponent.tsx",
        "Components/Dashboard/Components/DashboardChartComponent.tsx",
        "Components/Dashboard/Components/DashboardResourceListBase.tsx",
        "Components/AppLink/AppLink.tsx",
        "Components/Metrics/MetricCharts.tsx",
      ]),
    );
    // A walk that stopped short would find nothing to check.
    expect(files.length).toBeGreaterThan(150);
  });

  test("a widget that can leave the page reads the preview", () => {
    const unread: Array<string> = [];

    for (const file of files) {
      if (path.dirname(file) !== WIDGETS_DIR) {
        continue;
      }

      const hits: Array<NavigationHit> = navigationIn(file);

      if (hits.length > 0 && !readsPreview(file)) {
        unread.push(...hits.map(describeHit));
      }
    }

    expect(unread).toEqual([]);
  });

  test("any other part that can leave the page is reviewed, with its reason", () => {
    const unreviewed: Array<string> = [];

    for (const file of files) {
      if (path.dirname(file) === WIDGETS_DIR) {
        continue;
      }

      if (REVIEWED[relativeToApp(file)]) {
        continue;
      }

      unreviewed.push(...navigationIn(file).map(describeHit));
    }

    expect(unreviewed).toEqual([]);
  });

  test("each reviewed part is still drawn by a widget and can still leave the page", () => {
    const reached: Set<string> = new Set<string>(files.map(relativeToApp));

    for (const [file, reason] of Object.entries(REVIEWED)) {
      expect(reason.length).toBeGreaterThan(20);
      expect({ file, isReached: reached.has(file) }).toEqual({
        file,
        isReached: true,
      });
      expect({
        file,
        navigates: navigationIn(path.join(APP_SRC_DIR, file)).length > 0,
      }).toEqual({ file, navigates: true });
    }
  });

  test("a widget's parts read ResourceTable's helpers, never the table that opens a resource", () => {
    const resourceTable: string = path.join(
      APP_SRC_DIR,
      "Components",
      "Infrastructure",
      "ResourceTable.tsx",
    );
    const source: ts.SourceFile = readSource(resourceTable);
    const table: ts.Node | undefined = nodesOf(source).find(
      (node: ts.Node): boolean => {
        return (
          ts.isVariableDeclaration(node) &&
          node.name.getText() === "ResourceTable"
        );
      },
    );

    expect(table).toBeDefined();

    /*
     * Whatever in the file can leave the page is the table's own: each
     * navigate() call, and each shared Link it draws (its import is the
     * file's).
     */
    const tableStartLine: number = lineOf(table!);
    const tableEndLine: number =
      source.getLineAndCharacterOfPosition(table!.getEnd()).line + 1;
    const leavingLines: Array<string> = navigationIn(resourceTable)
      .filter((hit: NavigationHit): boolean => {
        return hit.kind !== "the shared Link";
      })
      .map(describeHit)
      .concat(
        nodesOf(source)
          .filter((node: ts.Node): boolean => {
            return isJsxElementNamed(node, ["Link"]);
          })
          .map((node: ts.Node): string => {
            return `Components/Infrastructure/ResourceTable.tsx:${lineOf(node)} (the shared Link)`;
          }),
      );

    expect(leavingLines.length).toBeGreaterThan(1);

    for (const leaving of leavingLines) {
      const line: number = Number(DESCRIBED_LINE_REGEX.exec(leaving)?.[1]);

      expect({
        leaving,
        isTheTables: line >= tableStartLine && line <= tableEndLine,
      }).toEqual({ leaving, isTheTables: true });
    }

    const imported: Array<string> = [];

    for (const file of files) {
      for (const node of nodesOf(readSource(file))) {
        if (
          !ts.isImportDeclaration(node) ||
          !ts.isStringLiteral(node.moduleSpecifier) ||
          resolveImport(file, node.moduleSpecifier.text) !== resourceTable
        ) {
          continue;
        }

        const clause: ts.ImportClause | undefined = node.importClause;

        if (clause?.name) {
          imported.push(`${relativeToApp(file)}: default`);
        }

        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            imported.push(`${relativeToApp(file)}: ${element.name.text}`);
          }
        } else if (clause?.namedBindings) {
          imported.push(`${relativeToApp(file)}: *`);
        }
      }
    }

    expect(imported).toEqual(
      expect.arrayContaining([
        "Components/Dashboard/Components/DashboardCephPoolListComponent.tsx: formatMemoryValue",
      ]),
    );
    // Neither the table (its default export) nor all of the file.
    expect(
      imported.filter((entry: string): boolean => {
        return entry.endsWith(": default") || entry.endsWith(": *");
      }),
    ).toEqual([]);
  });

  test("the widgets reading the preview are the ones whose parts open a page", () => {
    const readers: Array<string> = files
      .filter((file: string): boolean => {
        return readsPreview(file);
      })
      .map(relativeToApp);

    // Each one's links, clicks and menus are drawn in the preview and on the board by the *Links suites.
    expect(readers).toEqual(
      expect.arrayContaining([
        "Components/Dashboard/Components/DashboardChartComponent.tsx",
        "Components/Dashboard/Components/DashboardNetworkMapComponent.tsx",
        "Components/Dashboard/Components/DashboardResourceHoneycomb.tsx",
        "Components/Dashboard/Components/DashboardTextComponent.tsx",
        "Components/Dashboard/Components/DashboardProductAnalyticsWidget.tsx",
        "Components/Dashboard/Components/DashboardProductAnalyticsRetentionComponent.tsx",
      ]),
    );
  });
});

describe("each switch a widget hands its parts is set from the preview, or off", () => {
  const settings: Array<Setting> = filesWidgetsAreDrawnFrom()
    .filter((file: string): boolean => {
      return path.dirname(file) === WIDGETS_DIR;
    })
    .flatMap(previewSettingsIn);

  test("every one of them", () => {
    expect(
      settings
        .filter((setting: Setting): boolean => {
          return !setting.isFromPreview;
        })
        .map((setting: Setting): string => {
          return `${setting.file}:${setting.line} ${setting.what}`;
        }),
    ).toEqual([]);
  });

  test("the switches it reads are found where the widgets set them", () => {
    const found: Array<string> = settings.map((setting: Setting): string => {
      return `${path.basename(setting.file)} ${setting.what}`;
    });

    expect(found).toEqual(
      expect.arrayContaining([
        "DashboardChartComponent.tsx <MetricCharts enableSeriesActions>",
        "DashboardChartComponent.tsx <MetricCharts enableExemplarActions>",
        "DashboardDataSourceChartComponent.tsx <MetricCharts enableSeriesActions>",
        "DashboardDataSourceChartComponent.tsx <MetricCharts enableExemplarActions>",
        "DashboardChartComponent.tsx the event markers' opensEvents",
        "DashboardTextComponent.tsx a Markdown viewer's showLinksAsText",
        "DashboardProductAnalyticsWidget.tsx a funnel's or retention's link",
        "DashboardProductAnalyticsRetentionComponent.tsx a funnel's or retention's link",
      ]),
    );
  });

  test("the chart widget's Open in Metric Explorer and Investigate are left out of the preview", () => {
    const chartFile: string = path.join(
      WIDGETS_DIR,
      "DashboardChartComponent.tsx",
    );
    const declaration: ts.VariableDeclaration | undefined = nodesOf(
      readSource(chartFile),
    ).find((node: ts.Node): node is ts.VariableDeclaration => {
      return (
        ts.isVariableDeclaration(node) &&
        node.name.getText() === "showOpenInExplorer"
      );
    });

    expect(declaration?.initializer?.getText()).toContain("!isPreview");
    expect(
      isSetFromPreview(
        ts.factory.createIdentifier("showOpenInExplorer"),
        chartFile,
      ),
    ).toBe(true);
  });

  test("the investigation drawer is opened only from the chart widget and MetricCharts", () => {
    const openers: Array<string> = filesWidgetsAreDrawnFrom()
      .filter((file: string): boolean => {
        return appImportsOf(file).some((imported: string): boolean => {
          return INVESTIGATION_DRAWER_REGEX.test(imported);
        });
      })
      .map(relativeToApp);

    expect(openers.sort()).toEqual([...INVESTIGATION_DRAWER_OPENERS].sort());
  });

  test("an HTML widget's frame can never take the page with it", () => {
    const sandbox: string = HtmlWidgetDocument.getSandboxAttribute({
      allowScripts: true,
      allowForms: true,
      allowPopups: true,
    });

    expect(sandbox).not.toContain("allow-top-navigation");
  });
});

describe("the dialog's preview reaches every widget", () => {
  test("the settings dialog draws its widget with isPreview, out of edit mode", () => {
    const elements: Array<ts.JsxOpeningLikeElement> = nodesOf(
      readSource(SETTINGS_MODAL_FILE),
    ).filter((node: ts.Node): node is ts.JsxOpeningLikeElement => {
      return isJsxElementNamed(node, ["DashboardBaseComponentElement"]);
    });

    expect(elements).toHaveLength(1);

    for (const element of elements) {
      expect(
        attributeExpression(jsxAttribute(element, "isPreview"))?.kind,
      ).toBe(ts.SyntaxKind.TrueKeyword);
      expect(
        attributeExpression(jsxAttribute(element, "isEditMode"))?.kind,
      ).toBe(ts.SyntaxKind.FalseKeyword);
    }
  });

  test("the base element draws every widget inside the preview's provider", () => {
    const widgets: Array<ts.JsxOpeningLikeElement> = nodesOf(
      readSource(BASE_ELEMENT_FILE),
    ).filter((node: ts.Node): node is ts.JsxOpeningLikeElement => {
      return isJsxElementNamed(node, ["Widget"]);
    });

    expect(widgets).toHaveLength(1);

    // The whole <Widget> element, and the element it is drawn in.
    const widget: ts.Node = ts.isJsxOpeningElement(widgets[0]!)
      ? widgets[0]!.parent
      : widgets[0]!;
    let provider: ts.Node | undefined = widget.parent;

    while (provider && !ts.isJsxElement(provider)) {
      provider = provider.parent;
    }

    expect(provider && ts.isJsxElement(provider)).toBe(true);

    const opening: ts.JsxOpeningElement = (provider as ts.JsxElement)
      .openingElement;

    expect(opening.tagName.getText()).toBe("DashboardWidgetPreviewProvider");
    expect(
      attributeExpression(jsxAttribute(opening, "isPreview"))?.getText(),
    ).toBe("Boolean(props.isPreview)");
  });

  function PreviewProbe(): ReactElement {
    const isPreview: boolean = useIsDashboardWidgetPreview();

    return (
      <div>
        <output data-testid="preview-probe">{String(isPreview)}</output>
        <AppLink
          to={new Route("/dashboard/project/monitors")}
          dataTestId="probe-link"
        >
          Monitors
        </AppLink>
      </div>
    );
  }

  test.each([
    [true, "true", "SPAN"],
    [false, "false", "A"],
  ])(
    "the provider, isPreview %s: the widget reads %s, and a link is a %s",
    (isPreview: boolean, read: string, tagName: string) => {
      render(
        <MemoryRouter>
          <DashboardWidgetPreviewProvider isPreview={isPreview}>
            <PreviewProbe />
          </DashboardWidgetPreviewProvider>
        </MemoryRouter>,
      );

      expect(screen.getByTestId("preview-probe")).toHaveTextContent(read);
      expect(screen.getByTestId("probe-link").tagName).toBe(tagName);
    },
  );

  test("with no provider, a part is not in a preview", () => {
    render(
      <MemoryRouter>
        <PreviewProbe />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("preview-probe")).toHaveTextContent("false");
    expect(screen.getByTestId("probe-link").tagName).toBe("A");
  });
});
