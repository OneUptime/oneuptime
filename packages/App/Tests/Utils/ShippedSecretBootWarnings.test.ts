import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The app says, once at boot, which other secrets the installation still
 * holds at a value the repository ships (EnvironmentConfig):
 *
 *   - RegisterProbeKeyWarning: REGISTER_PROBE_KEY unset or shipped, so every
 *     global probe's registration is refused;
 *   - DatastorePasswordWarning: a datastore password still at a value the
 *     repository ships, which the app cannot change itself.
 *
 * Pinned from App/Index.ts, comments removed: each is imported from
 * EnvironmentConfig and logged exactly once, only when it is set, right
 * after the cluster key's warning and before the next boot step - the
 * warnings an operator reads together, before anything connects to Valkey.
 */

const INDEX_PATH: string = path.join(__dirname, "../../Index.ts");

const CLUSTER_KEY_WARNING: string =
  "if (ClusterKeyWarning) { logger.warn(ClusterKeyWarning); }";
const REGISTER_PROBE_KEY_WARNING: string =
  "if (RegisterProbeKeyWarning) { logger.warn(RegisterProbeKeyWarning); }";
const DATASTORE_PASSWORD_WARNING: string =
  "if (DatastorePasswordWarning) { logger.warn(DatastorePasswordWarning); }";
const NEXT_STEP: string = "await Redis.connect();";
const WHITESPACE: RegExp = /\s+/g;

function sourceFile(): ts.SourceFile {
  return ts.createSourceFile(
    "Index.ts",
    fs.readFileSync(INDEX_PATH, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

// The boot's code, comments removed and every run of whitespace one space.
function code(): string {
  return ts
    .createPrinter({ removeComments: true })
    .printFile(sourceFile())
    .replace(WHITESPACE, " ");
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function importedFromEnvironmentConfig(): Array<string> {
  return sourceFile()
    .statements.filter(
      (statement: ts.Statement): statement is ts.ImportDeclaration => {
        return (
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text === "Common/Server/EnvironmentConfig"
        );
      },
    )
    .flatMap((statement: ts.ImportDeclaration): Array<string> => {
      const bindings: ts.NamedImportBindings | undefined =
        statement.importClause?.namedBindings;

      return bindings && ts.isNamedImports(bindings)
        ? bindings.elements.map((element: ts.ImportSpecifier): string => {
            return element.name.text;
          })
        : [];
    });
}

describe("App/Index.ts says which shipped secrets the installation still holds", () => {
  const index: string = code();

  test.each(["RegisterProbeKeyWarning", "DatastorePasswordWarning"])(
    "imports %s from EnvironmentConfig",
    (name: string) => {
      expect(importedFromEnvironmentConfig()).toContain(name);
    },
  );

  test.each([
    ["RegisterProbeKeyWarning", REGISTER_PROBE_KEY_WARNING],
    ["DatastorePasswordWarning", DATASTORE_PASSWORD_WARNING],
  ])(
    "logs %s exactly once, and only when there is one",
    (name: string, block: string) => {
      expect(countOf(index, `logger.warn(${name})`)).toBe(1);
      expect(countOf(index, block)).toBe(1);
    },
  );

  test("right after the cluster key's warning, before the next boot step", () => {
    const clusterKey: number = index.indexOf(CLUSTER_KEY_WARNING);
    const registerProbeKey: number = index.indexOf(REGISTER_PROBE_KEY_WARNING);
    const datastore: number = index.indexOf(DATASTORE_PASSWORD_WARNING);
    const next: number = index.indexOf(NEXT_STEP);

    expect(clusterKey).toBeGreaterThan(-1);
    expect(
      index
        .slice(clusterKey + CLUSTER_KEY_WARNING.length, registerProbeKey)
        .trim(),
    ).toBe("");
    expect(
      index
        .slice(registerProbeKey + REGISTER_PROBE_KEY_WARNING.length, datastore)
        .trim(),
    ).toBe("");
    expect(
      index.slice(datastore + DATASTORE_PASSWORD_WARNING.length, next).trim(),
    ).toBe("");
  });
});
