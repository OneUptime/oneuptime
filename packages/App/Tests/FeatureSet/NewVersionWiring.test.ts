import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Every frontend that splits its code notices a new version deployed while
 * it is open and moves the reader onto it (Common/UI/Utils/NewVersion):
 *
 *   - its entry starts NewVersion before its first render, with the
 *     audience its readers are (people who use OneUptime, or a status
 *     page's and public dashboard's visitors, who are never told about
 *     OneUptime);
 *   - NewVersionNavigation sits inside its router, so the next page opened
 *     once a new version is out loads in full, in the new version;
 *   - the Dashboard and the Admin Dashboard show NewVersionNotice;
 *   - its build goes through Common's build() and watch(), which name the
 *     build and write build.json for the server to say which build it
 *     serves.
 *
 * The App suite runs in plain Node, so the entries are read through the
 * TypeScript AST rather than rendered; the behaviour itself is covered in
 * Common/Tests/UI (Utils/NewVersion, Components/NewVersion).
 */

const FEATURE_SET_DIR: string = path.join(__dirname, "..", "..", "FeatureSet");

interface FrontendExpectation {
  name: string;
  audience: "Members" | "Visitors";
  hasNotice: boolean;
}

const FRONTENDS: Array<FrontendExpectation> = [
  { name: "Dashboard", audience: "Members", hasNotice: true },
  { name: "AdminDashboard", audience: "Members", hasNotice: true },
  { name: "Accounts", audience: "Members", hasNotice: false },
  { name: "StatusPage", audience: "Visitors", hasNotice: false },
  { name: "PublicDashboard", audience: "Visitors", hasNotice: false },
];

interface EntryWiring {
  imports: Map<string, string>;
  // Audiences passed to top-level NewVersion.start({ audience }) calls.
  startAudiences: Array<string>;
  startAt: Array<number>;
  renderAt: number | null;
  // Names of the elements directly inside each <BrowserRouter>.
  routerChildren: Array<Array<string>>;
  // Every JSX element name, in source order.
  elements: Array<string>;
}

function readEntry(frontend: string): string {
  return fs.readFileSync(
    path.join(FEATURE_SET_DIR, frontend, "src", "Index.tsx"),
    "utf8",
  );
}

function elementName(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
  const tagName: ts.JsxTagNameExpression = ts.isJsxElement(node)
    ? node.openingElement.tagName
    : node.tagName;

  return tagName.getText();
}

function analyzeEntry(source: string): EntryWiring {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    "Index.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  const wiring: EntryWiring = {
    imports: new Map<string, string>(),
    startAudiences: [],
    startAt: [],
    renderAt: null,
    routerChildren: [],
    elements: [],
  };

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.importClause?.name
    ) {
      wiring.imports.set(
        statement.importClause.name.text,
        statement.moduleSpecifier.text,
      );
    }

    if (
      ts.isExpressionStatement(statement) &&
      ts.isCallExpression(statement.expression) &&
      statement.expression.expression.getText() === "NewVersion.start"
    ) {
      wiring.startAt.push(statement.getStart());

      const options: ts.Expression | undefined =
        statement.expression.arguments[0];

      if (options && ts.isObjectLiteralExpression(options)) {
        for (const property of options.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            property.name.getText() === "audience"
          ) {
            wiring.startAudiences.push(property.initializer.getText());
          }
        }
      }
    }
  }

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "render" &&
      wiring.renderAt === null
    ) {
      wiring.renderAt = node.getStart();
    }

    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      wiring.elements.push(elementName(node));
    }

    if (ts.isJsxElement(node) && elementName(node) === "BrowserRouter") {
      wiring.routerChildren.push(
        node.children
          .filter(
            (
              child: ts.JsxChild,
            ): child is ts.JsxElement | ts.JsxSelfClosingElement => {
              return (
                ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)
              );
            },
          )
          .map((child: ts.JsxElement | ts.JsxSelfClosingElement): string => {
            return elementName(child);
          }),
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return wiring;
}

describe.each(FRONTENDS)(
  "$name notices a new version",
  (frontend: FrontendExpectation) => {
    const wiring: EntryWiring = analyzeEntry(readEntry(frontend.name));

    test("imports NewVersion and NewVersionNavigation from Common", () => {
      expect(wiring.imports.get("NewVersion")).toBe(
        "Common/UI/Utils/NewVersion/NewVersion",
      );
      expect(wiring.imports.get("NewVersionNavigation")).toBe(
        "Common/UI/Components/NewVersion/NewVersionNavigation",
      );
    });

    test(`starts NewVersion once, for its ${frontend.audience.toLowerCase()}, before its first render`, () => {
      expect(wiring.startAudiences).toEqual([
        `NewVersionAudience.${frontend.audience}`,
      ]);
      expect(wiring.renderAt).not.toBeNull();
      expect(wiring.startAt[0]).toBeLessThan(wiring.renderAt as number);
    });

    test("renders NewVersionNavigation inside its router, ahead of the app", () => {
      expect(wiring.routerChildren).toHaveLength(1);
      expect(wiring.routerChildren[0]).toEqual(["NewVersionNavigation", "App"]);
    });

    test(
      frontend.hasNotice
        ? "shows the new-version notice"
        : "shows no new-version notice",
      () => {
        expect(wiring.elements.includes("NewVersionNotice")).toBe(
          frontend.hasNotice,
        );
        expect(wiring.imports.has("NewVersionNotice")).toBe(frontend.hasNotice);
      },
    );

    test("builds through Common's build() and watch(), which name the build", () => {
      const config: string = fs.readFileSync(
        path.join(FEATURE_SET_DIR, frontend.name, "esbuild.config.js"),
        "utf8",
      );

      expect(config).toContain('require("Common/UI/esbuild-config")');
      expect(config).toContain(`watch(config, "${frontend.name}")`);
      expect(config).toContain(`build(config, "${frontend.name}")`);
    });
  },
);

test("the notice sits inside the app's last-resort boundary, beside the router", () => {
  for (const frontend of FRONTENDS.filter((item: FrontendExpectation) => {
    return item.hasNotice;
  })) {
    const source: string = readEntry(frontend.name);
    const boundaryOpen: number = source.indexOf("<ErrorBoundary>");
    const routerClose: number = source.indexOf("</BrowserRouter>");
    const notice: number = source.indexOf("<NewVersionNotice />");
    const boundaryClose: number = source.indexOf("</ErrorBoundary>");

    expect([frontend.name, boundaryOpen > -1]).toEqual([frontend.name, true]);
    expect(notice).toBeGreaterThan(routerClose);
    expect(boundaryClose).toBeGreaterThan(notice);
  }
});
