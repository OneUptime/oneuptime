import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "../ForeignHiddenRuleGuard";

/*
 * Where browser code import()s a library by name (LazyLoadedLibrariesGuard).
 *
 * Issue #6638: the QR code element loaded qrcode with import("qrcode"). The
 * frontends' build (Common/UI/esbuild-config.js: ES modules, split into
 * files) puts a module that is only ever import()ed in a file of its own, and
 * the file of a CommonJS module can export nothing but `default`. So the
 * element got an object without toDataURL, and every QR code in the product
 * said "L.toDataURL is not a function" - while Jest, which reads modules as
 * CommonJS and hands import() every export, passed.
 *
 * A library import()ed by name must therefore be an ES module as the browser
 * build resolves it. This finds every such import(), read through the
 * TypeScript AST so a type (typeof import("x")), a comment or a string that
 * names one is not a finding.
 */

/*
 * Specifiers that name a module of ours, not a library: Common/... and
 * App/... are the frontends' paths into the repository, @oneuptime/... the
 * Enterprise screens' plugin entries. Their modules are TypeScript, which the
 * build reads as ES modules.
 */
const OWN_SPECIFIER_PREFIXES: ReadonlyArray<string> = [
  "Common/",
  "App/",
  "@oneuptime/",
];

export interface LibraryImport {
  // As written: "react-beautiful-dnd", "jspdf-autotable".
  specifier: string;
  // Relative to the repository root, with forward slashes.
  file: string;
  // 1-based.
  line: number;
}

// Whether import() of this specifier loads a library rather than our own module.
export function isLibrarySpecifier(specifier: string): boolean {
  if (!specifier || specifier.startsWith(".") || specifier.startsWith("/")) {
    return false;
  }

  return !OWN_SPECIFIER_PREFIXES.some((prefix: string): boolean => {
    return specifier.startsWith(prefix);
  });
}

/*
 * The package a specifier loads from: "jspdf-autotable" for itself,
 * "@scope/name" for "@scope/name/deep/path", "highlight.js" for
 * "highlight.js/lib/core".
 */
export function packageOfSpecifier(specifier: string): string {
  const parts: Array<string> = specifier.split("/");

  return specifier.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : (parts[0] as string);
}

// Every import("<library>") in one module's source.
export function findLibraryImports(
  source: string,
  file: string,
): Array<LibraryImport> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Array<LibraryImport> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const argument: ts.Expression | undefined = node.arguments[0];

      if (
        argument &&
        (ts.isStringLiteral(argument) ||
          ts.isNoSubstitutionTemplateLiteral(argument)) &&
        isLibrarySpecifier(argument.text)
      ) {
        found.push({
          specifier: argument.text,
          file: file,
          line:
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
              .line + 1,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

/*
 * The directories browser code is in: every feature set's browser source,
 * the shared UI and the Enterprise screens (listScanRoots), and the shared
 * code they draw on - Common's Utils, Types and Models. Common/Server is
 * Node's alone: the TypeScript compiler writes it as CommonJS, where import()
 * becomes require() and hands over every export.
 */
export function listBrowserSourceRoots(repositoryRoot: string): Array<string> {
  const roots: Array<string> = listScanRoots(repositoryRoot);

  for (const shared of ["Utils", "Types", "Models"]) {
    const directory: string = path.join(
      repositoryRoot,
      "packages",
      "Common",
      shared,
    );

    if (fs.existsSync(directory)) {
      roots.push(directory);
    }
  }

  return roots;
}

// Every import("<library>") in browser code, in a stable order.
export function scanLibraryImports(
  repositoryRoot: string,
): Array<LibraryImport> {
  const found: Array<LibraryImport> = [];
  const seen: Set<string> = new Set<string>();

  for (const root of listBrowserSourceRoots(repositoryRoot)) {
    for (const file of listSourceFiles(root)) {
      const realFile: string = fs.realpathSync(file);

      if (seen.has(realFile)) {
        continue;
      }

      seen.add(realFile);

      found.push(
        ...findLibraryImports(
          fs.readFileSync(file, "utf8"),
          toRelativePath(repositoryRoot, file),
        ),
      );
    }
  }

  return found.sort((a: LibraryImport, b: LibraryImport): number => {
    return (
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.specifier.localeCompare(b.specifier)
    );
  });
}
