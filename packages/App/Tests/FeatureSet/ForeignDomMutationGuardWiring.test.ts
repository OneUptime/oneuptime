import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Every React frontend installs the foreign-DOM-mutation guard before it
 * renders anything.
 *
 * Password managers and translators move nodes React manages, and React's
 * next commit then throws NotFoundError from removeChild or insertBefore,
 * which takes the page under the nearest error boundary down with it. The
 * guard (Common/UI/Utils/ForeignDomMutationGuard, whose behaviour is covered
 * by Common/Tests/UI/Utils/ForeignDomMutationGuard.test.tsx) makes exactly
 * those two failures survivable, but only on a page that installed it before
 * React's first commit. The App suite runs in plain Node, so the shells are
 * read through the TypeScript AST rather than rendered.
 */

const FEATURE_SET_DIR: string = path.join(__dirname, "..", "..", "FeatureSet");

const FRONTENDS: Array<string> = [
  "Dashboard",
  "AdminDashboard",
  "StatusPage",
  "PublicDashboard",
  "Accounts",
];

const GUARD_MODULE: string = "Common/UI/Utils/ForeignDomMutationGuard";

interface ShellWiring {
  // The local name the guard's default export is imported under, if it is.
  guardImportName: string | null;
  // Source offsets of the top-level `<guard>.install()` statements.
  installAt: Array<number>;
  // Source offset of the first ReactDOM.createRoot(...) call, if any.
  createRootAt: number | null;
  // Source offset of the first `.render(` call, if any.
  renderAt: number | null;
  // Whether every install() call is a statement at the top of the module.
  everyInstallIsTopLevel: boolean;
}

function readShell(frontend: string): string {
  return fs.readFileSync(
    path.join(FEATURE_SET_DIR, frontend, "src", "Index.tsx"),
    "utf8",
  );
}

function analyzeShell(source: string): ShellWiring {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    "Index.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  const wiring: ShellWiring = {
    guardImportName: null,
    installAt: [],
    createRootAt: null,
    renderAt: null,
    everyInstallIsTopLevel: true,
  };

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === GUARD_MODULE &&
      statement.importClause?.name
    ) {
      wiring.guardImportName = statement.importClause.name.text;
    }
  }

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const target: ts.Expression = node.expression.expression;
      const method: string = node.expression.name.text;
      const start: number = node.getStart(sourceFile);

      if (
        method === "install" &&
        ts.isIdentifier(target) &&
        target.text === wiring.guardImportName
      ) {
        wiring.installAt.push(start);

        const isTopLevelStatement: boolean =
          ts.isExpressionStatement(node.parent) &&
          node.parent.parent === sourceFile;

        wiring.everyInstallIsTopLevel =
          wiring.everyInstallIsTopLevel && isTopLevelStatement;
      }

      if (
        method === "createRoot" &&
        ts.isIdentifier(target) &&
        target.text === "ReactDOM" &&
        wiring.createRootAt === null
      ) {
        wiring.createRootAt = start;
      }

      if (method === "render" && wiring.renderAt === null) {
        wiring.renderAt = start;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return wiring;
}

function problemsWith(wiring: ShellWiring): Array<string> {
  const problems: Array<string> = [];

  if (!wiring.guardImportName) {
    problems.push(`does not import ${GUARD_MODULE}`);
    return problems;
  }

  if (wiring.installAt.length === 0) {
    problems.push(`never calls ${wiring.guardImportName}.install()`);
    return problems;
  }

  if (!wiring.everyInstallIsTopLevel) {
    problems.push("calls install() somewhere other than the top of the module");
  }

  const firstInstall: number = Math.min(...wiring.installAt);

  if (wiring.createRootAt === null || wiring.renderAt === null) {
    problems.push("no longer creates and renders a React root");
  } else if (
    firstInstall > wiring.createRootAt ||
    firstInstall > wiring.renderAt
  ) {
    problems.push(
      "installs the guard only after React's root is created or rendered",
    );
  }

  return problems;
}

describe("every React frontend installs the foreign-DOM-mutation guard before it renders", () => {
  test.each(FRONTENDS)("%s", (frontend: string) => {
    expect(problemsWith(analyzeShell(readShell(frontend)))).toEqual([]);
  });

  test("the guard module the shells import exists and exports install()", () => {
    const guardSource: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Common",
        "UI",
        "Utils",
        "ForeignDomMutationGuard.ts",
      ),
      "utf8",
    );

    expect(guardSource).toContain(
      "export default class ForeignDomMutationGuard",
    );
    expect(guardSource).toContain("public static install(): void");
  });
});

describe("the wiring check itself", () => {
  const DASHBOARD_SHELL: string = readShell("Dashboard");

  test("it reads the Dashboard shell the way it is written", () => {
    const wiring: ShellWiring = analyzeShell(DASHBOARD_SHELL);

    expect(wiring.guardImportName).toBe("ForeignDomMutationGuard");
    expect(wiring.installAt).toHaveLength(1);
    expect(wiring.createRootAt).not.toBeNull();
    expect(wiring.renderAt).not.toBeNull();
  });

  test("a shell that drops the install() call is caught", () => {
    const withoutInstall: string = DASHBOARD_SHELL.replace(
      "ForeignDomMutationGuard.install();",
      "",
    );

    expect(problemsWith(analyzeShell(withoutInstall))).toEqual([
      "never calls ForeignDomMutationGuard.install()",
    ]);
  });

  test("a shell that drops the import is caught", () => {
    const withoutImport: string = DASHBOARD_SHELL.replace(
      `import ForeignDomMutationGuard from "${GUARD_MODULE}";`,
      "",
    );

    expect(problemsWith(analyzeShell(withoutImport))).toEqual([
      `does not import ${GUARD_MODULE}`,
    ]);
  });

  test("a shell that installs the guard only after rendering is caught", () => {
    const lateInstall: string = `
      import ForeignDomMutationGuard from "${GUARD_MODULE}";
      import ReactDOM from "react-dom/client";
      const root: any = ReactDOM.createRoot(document.getElementById("root"));
      root.render(null);
      ForeignDomMutationGuard.install();
    `;

    expect(problemsWith(analyzeShell(lateInstall))).toEqual([
      "installs the guard only after React's root is created or rendered",
    ]);
  });

  test("a shell that only installs the guard inside a callback is caught", () => {
    const deferredInstall: string = `
      import ForeignDomMutationGuard from "${GUARD_MODULE}";
      import ReactDOM from "react-dom/client";
      window.addEventListener("load", () => {
        ForeignDomMutationGuard.install();
      });
      const root: any = ReactDOM.createRoot(document.getElementById("root"));
      root.render(null);
    `;

    // Written above createRoot, but it runs whenever the callback does.
    expect(problemsWith(analyzeShell(deferredInstall))).toEqual([
      "calls install() somewhere other than the top of the module",
    ]);
  });
});
