import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import module from "module";
import path from "path";
import ts from "typescript";

/*
 * A Probe test may only import a package the Probe installs.
 *
 * Probe Test's job installs packages/Common and packages/Probe and nothing else. A test that
 * imports a package only Common or the repository's root has, as two OpenStack suites did with
 * typeorm, passes on a checkout with the root's installed and fails the whole file in CI. Common's
 * helper for it is Common/Tests/Helpers/TypeOrmDataSource. App has its own guard
 * (packages/App/Tests/TestImportsResolveFromApp.test.ts).
 */

const TESTS_DIR: string = __dirname;
const PROBE_NODE_MODULES: string = path.join(__dirname, "..", "node_modules");

function listTestFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...listTestFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      found.push(full);
    }
  }

  return found;
}

function importsOf(file: string): Array<string> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
  );
  const specifiers: Array<string> = [];

  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) ||
        ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }

  return specifiers;
}

// `@scope/name/deep/path` and `name/deep/path` both resolve through their package.
function packageNameOf(specifier: string): string {
  const parts: Array<string> = specifier.split("/");

  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

function isPackageImport(specifier: string): boolean {
  return (
    !specifier.startsWith(".") &&
    !specifier.startsWith("node:") &&
    !module.isBuiltin(packageNameOf(specifier))
  );
}

describe("a Probe test imports only what the Probe installs", () => {
  const files: Array<string> = listTestFiles(TESTS_DIR);

  test("the scan reads the Probe's tests", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(
      importsOf(path.join(TESTS_DIR, "TestImportsResolveFromProbe.test.ts")),
    ).toContain("typescript");
  });

  test("every package a test names is in the Probe's node_modules", () => {
    const missing: Array<string> = [];

    for (const file of files) {
      for (const specifier of importsOf(file).filter(isPackageImport)) {
        const name: string = packageNameOf(specifier);

        if (!fs.existsSync(path.join(PROBE_NODE_MODULES, name))) {
          missing.push(`${path.relative(TESTS_DIR, file)}: ${name}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
