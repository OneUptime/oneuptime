import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The app says, once at boot, when its ONEUPTIME_SECRET is unset or a value
 * the repository ships (EnvironmentConfig.ClusterKeyWarning): it refuses that
 * value from every caller, its own services use a key derived from the token
 * signing key instead, and the in-cluster Runner cannot register until the
 * operator sets one. Pinned from App/Index.ts, comments removed:
 *
 *   - the warning is imported and logged exactly once, only when it is set;
 *   - right after the token signing key is loaded, which the derived key
 *     comes from (TokenSigningKeyBootWiring pins that the load comes before
 *     every route and worker), and before the next boot step.
 */

const INDEX_PATH: string = path.join(__dirname, "../../Index.ts");

const LOAD_CALL: string =
  "await InstanceTokenSigningKeyService.loadTokenSigningKey();";
const WARNING: string =
  "if (ClusterKeyWarning) { logger.warn(ClusterKeyWarning); }";
const NEXT_STEP: string = "await Redis.connect();";
const WHITESPACE: RegExp = /\s+/g;

// The boot's code, comments removed and every run of whitespace one space.
function code(): string {
  const source: string = fs.readFileSync(INDEX_PATH, "utf8");

  return ts
    .createPrinter({ removeComments: true })
    .printFile(
      ts.createSourceFile(
        "Index.ts",
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      ),
    )
    .replace(WHITESPACE, " ");
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("App/Index.ts warns about a shipped cluster key", () => {
  const index: string = code();

  test("imports the warning from EnvironmentConfig", () => {
    const sourceFile: ts.SourceFile = ts.createSourceFile(
      "Index.ts",
      fs.readFileSync(INDEX_PATH, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    const imported: Array<string> = sourceFile.statements
      .filter((statement: ts.Statement): statement is ts.ImportDeclaration => {
        return (
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text === "Common/Server/EnvironmentConfig"
        );
      })
      .flatMap((statement: ts.ImportDeclaration): Array<string> => {
        const bindings: ts.NamedImportBindings | undefined =
          statement.importClause?.namedBindings;

        return bindings && ts.isNamedImports(bindings)
          ? bindings.elements.map((element: ts.ImportSpecifier): string => {
              return element.name.text;
            })
          : [];
      });

    expect(imported).toContain("ClusterKeyWarning");
  });

  test("logs it exactly once, and only when there is one", () => {
    expect(countOf(index, "logger.warn(ClusterKeyWarning)")).toBe(1);
    expect(countOf(index, WARNING)).toBe(1);
  });

  test("right after the token signing key is loaded, before the next boot step", () => {
    const load: number = index.indexOf(LOAD_CALL);
    const warning: number = index.indexOf(WARNING);
    const next: number = index.indexOf(NEXT_STEP);

    expect(load).toBeGreaterThan(-1);
    expect(warning).toBeGreaterThan(load);
    expect(next).toBeGreaterThan(warning);
    expect(index.slice(load + LOAD_CALL.length, warning).trim()).toBe("");
  });
});
