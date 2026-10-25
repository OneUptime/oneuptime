#!/usr/bin/env node
"use strict";

/*
 * Builds what npm publishes as @oneuptime/common, into build/npm/package.
 *
 *   npm run build-npm-package      (node Scripts/NpmPackage/BuildNpmPackage.js)
 *
 * Scripts/NPM/PublishAllPackages.sh runs it and publishes that directory, and
 * Scripts/NpmPackage/SmokeTestNpmPackage.js packs it, installs it in a new
 * project and loads every module it exports.
 *
 * Why a directory of its own. packages/Common/package.json is the manifest
 * every package in this repository links as node_modules/Common, and Common is
 * TypeScript that the services run through ts-node and the frontends bundle.
 * An exports map there would redirect every require("Common/...") in the
 * repository (#4877 tried it; #4900 says what it broke), so it cannot be the
 * npm package's manifest. What npm published from it until now could not be
 * loaded at all: its main, index.js, did not exist, its paths held
 * TypeScript, and its JavaScript was ES modules that Node.js cannot resolve.
 *
 * What the package holds:
 *   - every module under Types/, Utils/ and Models/, and ServiceRoute, whose
 *     JavaScript runs in plain Node.js: compiled to CommonJS by tsc with the
 *     options Common's tsconfig.json gives everything else (decorators and
 *     their metadata included), and, beside it, an ES module that re-exports
 *     it - so `import` and `require` hand out the same classes, and an
 *     `instanceof` holds whichever way a class was loaded;
 *   - each module's types twice: <module>.d.ts for require, <module>.d.mts
 *     for import (the same declarations, naming .mjs files), and the
 *     declarations they refer to, some of which sit under Server/ and UI/:
 *     types only, never their JavaScript;
 *   - the package root, index.js and index.mjs: the pieces a script that
 *     calls the OneUptime API needs most (ROOT_EXPORTS);
 *   - package.json, written here, with an exports map that opens ".",
 *     "./Types/*", "./Utils/*", "./Models/*" and "./ServiceRoute", and maps
 *     every module left out to null; README.md and LICENSE.
 *
 * A module is left out when its JavaScript loads code from Server/ or UI/
 * (which needs OneUptime's own environment, or a browser), a module left out,
 * or a package Common does not depend on - or when LEFT_OUT names it. The
 * build prints each one with the reason.
 *
 * The build fails, rather than publishing something broken, when the
 * TypeScript does not compile, a root export cannot be published, a published
 * module throws when it is loaded, or the package it wrote refers to a file
 * or package it does not have (verifyPackage).
 */

const childProcess = require("child_process");
const fs = require("fs");
const { builtinModules } = require("module");
const os = require("os");
const path = require("path");

const COMMON_ROOT = path.resolve(__dirname, "..", "..");
const REPOSITORY_ROOT = path.resolve(COMMON_ROOT, "..", "..");

// build/npm/compiled is tsc's output, build/npm/package what npm publishes.
const BUILD_DIRECTORY = path.join(COMMON_ROOT, "build", "npm");
const COMPILED_DIRECTORY_NAME = "compiled";
const PACKAGE_DIRECTORY_NAME = "package";
const PACKAGE_DIRECTORY = path.join(BUILD_DIRECTORY, PACKAGE_DIRECTORY_NAME);

// The directories whose modules npm users get, and the files at Common's root.
const PUBLIC_DIRECTORIES = Object.freeze(["Types", "Utils", "Models"]);
const PUBLIC_FILES = Object.freeze(["ServiceRoute"]);

// What the compile needs besides those modules: ambient module declarations.
const GLOBAL_DECLARATIONS = Object.freeze(["Typings", "UI/index.d.ts"]);

/*
 * Modules left out on purpose, although they load in Node.js, with why. The
 * ones that load Server/ or UI/ code are found by the build and need no entry.
 */
const LEFT_OUT = Object.freeze({
  "Utils/Analytics":
    "OneUptime's own product analytics for its web apps, through posthog-js, a browser library",
});

/*
 * The package root: what `require("@oneuptime/common")` and
 * `import ... from "@oneuptime/common"` hand out. Each is a module's default
 * export unless `export` names another; a typeOnly one exists for TypeScript
 * alone. Every other module is imported by its path.
 */
const ROOT_EXPORTS = Object.freeze([
  { name: "API", module: "Utils/API" },
  { name: "URL", module: "Types/API/URL" },
  { name: "Route", module: "Types/API/Route" },
  { name: "Hostname", module: "Types/API/Hostname" },
  { name: "Protocol", module: "Types/API/Protocol" },
  { name: "HTTPMethod", module: "Types/API/HTTPMethod" },
  { name: "HTTPResponse", module: "Types/API/HTTPResponse" },
  { name: "HTTPErrorResponse", module: "Types/API/HTTPErrorResponse" },
  { name: "ObjectID", module: "Types/ObjectID" },
  { name: "OneUptimeDate", module: "Types/Date" },
  { name: "JSONFunctions", module: "Types/JSONFunctions" },
  { name: "Exception", module: "Types/Exception/Exception" },
  { name: "BadDataException", module: "Types/Exception/BadDataException" },
  { name: "Headers", module: "Types/API/Headers", typeOnly: true },
  { name: "Dictionary", module: "Types/Dictionary", typeOnly: true },
  {
    name: "JSONObject",
    module: "Types/JSON",
    export: "JSONObject",
    typeOnly: true,
  },
  {
    name: "JSONArray",
    module: "Types/JSON",
    export: "JSONArray",
    typeOnly: true,
  },
  {
    name: "JSONValue",
    module: "Types/JSON",
    export: "JSONValue",
    typeOnly: true,
  },
]);

/*
 * The Node.js lines the package supports: the maintained ones. The smoke test
 * runs it on each of them in CI (.github/workflows/test.common.yaml).
 */
const NODE_ENGINE = ">=22";

const PACKAGE_DESCRIPTION =
  "OneUptime's shared types, utilities and data models, for Node.js and TypeScript.";

const ROOT_ENTRY = "index";

// The name the ES module twin gives the CommonJS module it re-exports.
const COMMONJS_BINDING = "commonJsModule";

const READ_EXPORTS_FLAG = "--read-exports";

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// Words a `const` cannot be named, so an export of that name is re-exported by an alias.
const RESERVED_WORDS = new Set(
  (
    "await break case catch class const continue debugger default delete do " +
    "else enum export extends false finally for function if implements import " +
    "in instanceof interface let new null package private protected public " +
    "return static super switch this throw true try typeof var void while " +
    "with yield arguments eval"
  ).split(" "),
);

const SOURCE_FILE = /\.(ts|tsx)$/;
const DECLARATION_FILE = /\.d\.ts$/;
const MODULE_EXTENSION = /(\.d\.mts|\.d\.ts|\.mjs|\.js|\.tsx|\.ts)$/;
const LEADING_NEWLINES = /^\n+/;

/**
 * A path as the build names it: relative, with forward slashes.
 * @param {string} from - the directory it is relative to
 * @param {string} file - the file
 * @returns {string} e.g. "Types/API/URL.js"
 */
function relativePath(from, file) {
  return path.relative(from, file).split(path.sep).join("/");
}

/**
 * A module's id: its path from Common's root, without an extension.
 * @param {string} file - e.g. "Types/API/URL.d.ts"
 * @returns {string} e.g. "Types/API/URL"
 */
function moduleIdOf(file) {
  return file.split(path.sep).join("/").replace(MODULE_EXTENSION, "");
}

/**
 * Whether a module is one npm users may get: under a public directory, or a
 * public file at Common's root.
 * @param {string} id - a module id
 * @returns {boolean} whether it is
 */
function isCandidateModule(id) {
  return (
    PUBLIC_FILES.includes(id) ||
    PUBLIC_DIRECTORIES.some((directory) => {
      return id.startsWith(`${directory}/`);
    })
  );
}

/**
 * Whether a specifier names one of Node.js's own modules.
 * @param {string} specifier - e.g. "fs", "node:crypto", "fs/promises"
 * @returns {boolean} whether it does
 */
function isBuiltinModule(specifier) {
  if (specifier.startsWith("node:")) {
    return true;
  }

  return (
    builtinModules.includes(specifier) ||
    builtinModules.includes(specifier.split("/")[0])
  );
}

/**
 * The package a bare specifier names.
 * @param {string} specifier - e.g. "typeorm", "@scope/name/sub/path"
 * @returns {string} e.g. "typeorm", "@scope/name"
 */
function packageNameOf(specifier) {
  const parts = specifier.split("/");

  return specifier.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : parts[0] ?? specifier;
}

/**
 * Resolves a relative specifier from a module, against the modules there are:
 * the module it names, or the Index (or index) of the directory it names.
 * @param {string} fromId - the module the specifier is written in
 * @param {string} specifier - e.g. "../API/URL" or "./Monitor"
 * @param {(id: string) => boolean} exists - whether a module id exists
 * @returns {string | null} the module it names, or null when there is none
 */
function resolveRelativeModule(fromId, specifier, exists) {
  const joined = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromId), specifier),
  );

  if (joined.startsWith("../") || joined === "..") {
    return null;
  }

  for (const candidate of [
    joined,
    `${joined}/Index`,
    `${joined}/index`,
    joined.replace(MODULE_EXTENSION, ""),
  ]) {
    if (exists(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * A specifier for `toId` as written in `fromId`: relative, starting with ./
 * or ../, ending in `extension`.
 * @param {string} fromId - the module the specifier is written in
 * @param {string} toId - the module it names
 * @param {string} extension - e.g. ".mjs", or "" for none
 * @returns {string} e.g. "../API/URL.mjs"
 */
function relativeSpecifier(fromId, toId, extension) {
  const target = `${toId}${extension}`;
  /*
   * Relative to the file the target is, not to its id: Types/Email/X naming
   * Types/Email - a module beside the directory of the same name - is
   * "../Email.mjs", where the ids alone would give "".
   */
  const relative =
    path.posix.relative(path.posix.dirname(fromId), target) ||
    `../${path.posix.basename(target)}`;

  return relative.startsWith("../") ? relative : `./${relative}`;
}

/**
 * Every require("<string>") of a CommonJS file, read with TypeScript's
 * parser, so that text in a string or a comment is never taken for one.
 * @param {object} ts - the typescript module
 * @param {string} fileName - the file's name, for the parser
 * @param {string} text - the file's text
 * @returns {Array<string>} the specifiers, in the order they appear
 */
function requiredSpecifiers(ts, fileName, text) {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  const specifiers = [];

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      ((ts.isIdentifier(node.expression) &&
        node.expression.text === "require") ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword)
    ) {
      specifiers.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return specifiers;
}

/**
 * Every module specifier a declaration file names: in an import or an
 * export ... from, an import("...") type, an import x = require("..."), a
 * `declare module "..."`, or a /// <reference path="..." />. Each with where
 * its text sits, so a copy can name other files.
 * @param {object} ts - the typescript module
 * @param {string} fileName - the file's name, for the parser
 * @param {string} text - the file's text
 * @returns {Array<{ text: string, start: number, end: number }>} the specifiers, start and end bounding the text inside the quotes
 */
function declarationSpecifiers(ts, fileName, text) {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const specifiers = [];

  const record = (literal) => {
    specifiers.push({
      text: literal.text,
      start: literal.getStart(sourceFile) + 1,
      end: literal.getEnd() - 1,
    });
  };

  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      record(node.moduleSpecifier);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      record(node.argument.literal);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      record(node.moduleReference.expression);
    } else if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
      record(node.name);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  for (const reference of sourceFile.referencedFiles) {
    specifiers.push({
      text: reference.fileName,
      start: reference.pos,
      end: reference.end,
    });
  }

  return specifiers.sort((a, b) => {
    return a.start - b.start;
  });
}

/**
 * The names a declaration file exports, "default" among them: its exported
 * declarations, the names of its export lists, and an export default.
 * @param {object} ts - the typescript module
 * @param {string} fileName - the file's name, for the parser
 * @param {string} text - the file's text
 * @returns {Set<string>} the names
 */
function declaredExports(ts, fileName, text) {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  const names = new Set();
  const isExported = (statement) => {
    return (
      (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export) !== 0
    );
  };
  const isDefault = (statement) => {
    return (
      (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Default) !== 0
    );
  };

  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) {
      names.add("default");
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          names.add(element.name.text);
        }
      }
    } else if (ts.isVariableStatement(statement)) {
      if (isExported(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            names.add(declaration.name.text);
          }
        }
      }
    } else if (
      (ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
      isExported(statement)
    ) {
      if (isDefault(statement)) {
        names.add("default");
      } else if (statement.name && ts.isIdentifier(statement.name)) {
        names.add(statement.name.text);
      }
    }
  }

  return names;
}

/**
 * A declaration file written for `import`: the same declarations, with each
 * relative specifier naming the .mjs twin of the module it names (which
 * TypeScript reads as its .d.mts), so the types an ES module sees are ES
 * module types throughout. A bare specifier goes through `packageSpecifier`,
 * which may give it the extension an ES module needs.
 * @param {object} ts - the typescript module
 * @param {string} fromId - the declaration's module id
 * @param {string} text - the .d.ts text
 * @param {{ exists: (id: string) => boolean, packageSpecifier?: (specifier: string) => string }} names - whether a declaration exists for a module id, and how to write a bare specifier
 * @returns {string} the .d.mts text
 */
function esModuleDeclaration(ts, fromId, text, names) {
  let rewritten = text;

  for (const specifier of declarationSpecifiers(
    ts,
    `${fromId}.d.ts`,
    text,
  ).reverse()) {
    let written = specifier.text;

    if (specifier.text.startsWith(".")) {
      const target = resolveRelativeModule(
        fromId,
        specifier.text,
        names.exists,
      );

      if (target !== null) {
        written = relativeSpecifier(fromId, target, ".mjs");
      }
    } else if (names.packageSpecifier) {
      written = names.packageSpecifier(specifier.text);
    }

    if (written !== specifier.text) {
      rewritten =
        rewritten.slice(0, specifier.start) +
        written +
        rewritten.slice(specifier.end);
    }
  }

  return rewritten;
}

/**
 * How an ES module declaration writes a bare specifier: as it is, unless
 * TypeScript resolves it for an ES module only with ".js" added. typeorm's
 * exports map opens "./*" to require but, for import, only "./*.js": the
 * declarations' "typeorm/find-options/FindOperator" names nothing in an ES
 * module, and every type it brought became `any`.
 * @param {object} ts - the typescript module
 * @param {string} fromDirectory - where the packages resolve from: the package directory
 * @returns {(specifier: string) => string} the specifier to write
 */
function esModulePackageSpecifiers(ts, fromDirectory) {
  const options = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  };
  const containingFile = path.join(fromDirectory, "index.d.mts");
  const written = new Map();
  const resolves = (specifier) => {
    return Boolean(
      ts.resolveModuleName(
        specifier,
        containingFile,
        options,
        ts.sys,
        undefined,
        undefined,
        ts.ModuleKind.ESNext,
      ).resolvedModule,
    );
  };

  return (specifier) => {
    if (!written.has(specifier)) {
      written.set(
        specifier,
        !resolves(specifier) && resolves(`${specifier}.js`)
          ? `${specifier}.js`
          : specifier,
      );
    }

    return written.get(specifier);
  };
}

/**
 * What a declaration file uses from the module `isTarget` accepts: the names
 * it imports or re-exports from it, and the first name of each
 * import("...").Name type. `all` when it takes the module as a whole (a
 * namespace import, export *, a bare import("...") type).
 * @param {object} ts - the typescript module
 * @param {string} fileName - the file's name, for the parser
 * @param {string} text - the file's text
 * @param {(specifier: string) => boolean} isTarget - whether a specifier names the module
 * @returns {{ all: boolean, names: Set<string> }} what it uses
 */
function namesUsedFrom(ts, fileName, text, isTarget) {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  const used = { all: false, names: new Set() };
  const nameOf = (element) => {
    return (element.propertyName || element.name).text;
  };

  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isTarget(node.moduleSpecifier.text) &&
      node.importClause
    ) {
      const clause = node.importClause;

      if (clause.name) {
        used.names.add("default");
      }

      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          used.all = true;
        } else {
          for (const element of clause.namedBindings.elements) {
            used.names.add(nameOf(element));
          }
        }
      }
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isTarget(node.moduleSpecifier.text)
    ) {
      if (!node.exportClause || !ts.isNamedExports(node.exportClause)) {
        used.all = true;
      } else {
        for (const element of node.exportClause.elements) {
          used.names.add(nameOf(element));
        }
      }
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal) &&
      isTarget(node.argument.literal.text)
    ) {
      let qualifier = node.qualifier;

      while (qualifier && ts.isQualifiedName(qualifier)) {
        qualifier = qualifier.left;
      }

      if (qualifier) {
        used.names.add(qualifier.text);
      } else {
        used.all = true;
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression) &&
      isTarget(node.moduleReference.expression.text)
    ) {
      used.all = true;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return used;
}

/**
 * The names a top-level statement of a declaration file declares, with
 * "default" for an export default declaration.
 * @param {object} ts - the typescript module
 * @param {object} statement - the statement
 * @returns {Array<string>} the names
 */
function statementDeclares(ts, statement) {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations
      .filter((declaration) => {
        return ts.isIdentifier(declaration.name);
      })
      .map((declaration) => {
        return declaration.name.text;
      });
  }

  if (
    ts.isClassDeclaration(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    // A namespace; `declare global` declares no name of the file's own.
    (ts.isModuleDeclaration(statement) &&
      ts.isIdentifier(statement.name) &&
      (statement.flags & ts.NodeFlags.GlobalAugmentation) === 0)
  ) {
    const names = statement.name ? [statement.name.text] : [];
    const flags = ts.getCombinedModifierFlags(statement);

    if (
      (flags & ts.ModifierFlags.Export) !== 0 &&
      (flags & ts.ModifierFlags.Default) !== 0
    ) {
      names.push("default");
    }

    return names;
  }

  return [];
}

/**
 * A declaration file cut down to what other declarations use from it: the
 * exports in `used`, the declarations and imports those refer to, all the
 * way down, and whatever declares no name of its own (declare global,
 * declare module "...", a side-effect import). Statements are kept whole,
 * with their comments; an import or an export list keeps only what is
 * still used.
 *
 * The build uses it on a declaration it ships for types only when that
 * declaration names a package the package does not install: the UI's
 * Dropdown declares a React component, and the package's other declarations
 * use only its DropdownOption.
 * @param {object} ts - the typescript module
 * @param {string} fileName - the file's name, for the parser
 * @param {string} text - the declaration file
 * @param {Set<string>} used - the exported names other declarations use, "default" among them
 * @returns {string} the declaration file, cut down
 */
function pruneDeclaration(ts, fileName, text, used) {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const statements = sourceFile.statements;
  const declaredBy = new Map();
  const imported = new Set();
  const exportedAs = new Map();

  statements.forEach((statement, index) => {
    for (const name of statementDeclares(ts, statement)) {
      declaredBy.set(name, [...(declaredBy.get(name) || []), index]);
    }

    if (ts.isImportDeclaration(statement) && statement.importClause) {
      const clause = statement.importClause;

      if (clause.name) {
        imported.add(clause.name.text);
      }

      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          imported.add(clause.namedBindings.name.text);
        } else {
          for (const element of clause.namedBindings.elements) {
            imported.add(element.name.text);
          }
        }
      }
    } else if (ts.isImportEqualsDeclaration(statement)) {
      imported.add(statement.name.text);
    } else if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        exportedAs.set(
          element.name.text,
          (element.propertyName || element.name).text,
        );
      }
    } else if (
      ts.isExportAssignment(statement) &&
      !statement.isExportEquals &&
      ts.isIdentifier(statement.expression)
    ) {
      exportedAs.set("default", statement.expression.text);
    }
  });

  const required = new Set();
  const kept = new Set();
  const queue = [];
  const need = (name) => {
    if (!required.has(name) && (declaredBy.has(name) || imported.has(name))) {
      required.add(name);
      queue.push(name);
    }
  };
  const referencedIn = (node, found) => {
    if (ts.isIdentifier(node)) {
      found.add(node.text);
    }

    ts.forEachChild(node, (child) => {
      referencedIn(child, found);
    });

    return found;
  };

  for (const name of used) {
    need(exportedAs.get(name) || name);
  }

  while (queue.length > 0) {
    for (const index of declaredBy.get(queue.shift()) || []) {
      if (!kept.has(index)) {
        kept.add(index);

        for (const name of referencedIn(statements[index], new Set())) {
          need(name);
        }
      }
    }
  }

  const printer = ts.createPrinter({ removeComments: false });
  const output = [];
  let isModule = false;
  const keep = (statement) => {
    output.push(statement.getFullText(sourceFile));
  };
  const print = (node) => {
    output.push(
      `\n${printer.printNode(ts.EmitHint.Unspecified, node, sourceFile)}`,
    );
  };

  statements.forEach((statement, index) => {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;

      if (!clause) {
        keep(statement);
        return;
      }

      const name =
        clause.name && required.has(clause.name.text) ? clause.name : undefined;
      let bindings = clause.namedBindings;

      if (bindings && ts.isNamespaceImport(bindings)) {
        bindings = required.has(bindings.name.text) ? bindings : undefined;
      } else if (bindings) {
        const elements = bindings.elements.filter((element) => {
          return required.has(element.name.text);
        });

        if (elements.length === 0) {
          bindings = undefined;
        } else if (elements.length !== bindings.elements.length) {
          bindings = ts.factory.updateNamedImports(bindings, elements);
        }
      }

      if (!name && !bindings) {
        return;
      }

      isModule = true;

      if (name === clause.name && bindings === clause.namedBindings) {
        keep(statement);
      } else {
        print(
          ts.factory.updateImportDeclaration(
            statement,
            statement.modifiers,
            ts.factory.updateImportClause(
              clause,
              clause.isTypeOnly,
              name,
              bindings,
            ),
            statement.moduleSpecifier,
            statement.attributes,
          ),
        );
      }

      return;
    }

    if (ts.isImportEqualsDeclaration(statement)) {
      if (required.has(statement.name.text)) {
        isModule = true;
        keep(statement);
      }

      return;
    }

    if (ts.isExportDeclaration(statement)) {
      if (
        !statement.exportClause ||
        !ts.isNamedExports(statement.exportClause)
      ) {
        isModule = true;
        keep(statement);
        return;
      }

      const elements = statement.exportClause.elements;
      const usedElements = elements.filter((element) => {
        return used.has(element.name.text);
      });

      if (elements.length === 0 || usedElements.length === elements.length) {
        isModule = true;
        keep(statement);
      } else if (usedElements.length > 0) {
        isModule = true;
        print(
          ts.factory.updateExportDeclaration(
            statement,
            statement.modifiers,
            statement.isTypeOnly,
            ts.factory.updateNamedExports(statement.exportClause, usedElements),
            statement.moduleSpecifier,
            statement.attributes,
          ),
        );
      }

      return;
    }

    if (ts.isExportAssignment(statement)) {
      if (used.has("default")) {
        isModule = true;
        keep(statement);
      }

      return;
    }

    if (statementDeclares(ts, statement).length === 0 || kept.has(index)) {
      if (
        (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export) !==
        0
      ) {
        isModule = true;
      }

      keep(statement);
    }
  });

  if (!isModule) {
    output.push("\nexport {};");
  }

  return `${output.join("").replace(LEADING_NEWLINES, "")}\n`;
}

/**
 * The ES module twin of a CommonJS module: it imports the CommonJS module
 * and exports what it exports, so both ways hand out the same values.
 * @param {string} id - the module's id
 * @param {{ hasDefault: boolean, names: Array<string> }} exported - what the CommonJS module exports besides __esModule
 * @returns {string} the .mjs text
 */
function esModuleWrapper(id, exported) {
  const commonJsFile = `./${path.posix.basename(id)}.js`;
  const names = [...exported.names].sort();

  if (!exported.hasDefault && names.length === 0) {
    return `import ${JSON.stringify(commonJsFile)};\n`;
  }

  let binding = COMMONJS_BINDING;

  while (names.includes(binding)) {
    binding = `_${binding}`;
  }

  const lines = [`import ${binding} from ${JSON.stringify(commonJsFile)};`];

  if (exported.hasDefault) {
    lines.push(`export default ${binding}.default;`);
  }

  names.forEach((name, index) => {
    if (IDENTIFIER.test(name) && !RESERVED_WORDS.has(name)) {
      lines.push(`export const ${name} = ${binding}.${name};`);
      return;
    }

    const local = `${binding}_${index}`;
    const exportedName = IDENTIFIER.test(name) ? name : JSON.stringify(name);

    lines.push(`const ${local} = ${binding}[${JSON.stringify(name)}];`);
    lines.push(`export { ${local} as ${exportedName} };`);
  });

  return `${lines.join("\n")}\n`;
}

/**
 * The package root's four files.
 * @param {ReadonlyArray<{ name: string, module: string, export?: string, typeOnly?: boolean }>} rootExports - what the root hands out
 * @returns {Record<string, string>} file name -> text
 */
function rootEntryFiles(rootExports) {
  const header = [
    "/*",
    " * @oneuptime/common: the pieces a script that calls the OneUptime API",
    " * needs most. Import every other module by its path, such as",
    ' * "@oneuptime/common/Types/Monitor/MonitorType" (README.md).',
    " */",
  ];
  const commonJs = [
    '"use strict";',
    ...header,
    'Object.defineProperty(exports, "__esModule", { value: true });',
  ];
  const esModule = [...header];
  const commonJsTypes = [...header];
  const esModuleTypes = [...header];

  for (const entry of rootExports) {
    const exported = entry.export || "default";
    const binding =
      exported === entry.name ? entry.name : `${exported} as ${entry.name}`;
    const typePrefix = entry.typeOnly ? "export type" : "export";

    if (!entry.typeOnly) {
      commonJs.push(
        `exports.${entry.name} = require(${JSON.stringify(`./${entry.module}`)}).${exported};`,
      );
      esModule.push(
        `export { ${binding} } from ${JSON.stringify(`./${entry.module}.mjs`)};`,
      );
    }

    commonJsTypes.push(
      `${typePrefix} { ${binding} } from ${JSON.stringify(`./${entry.module}`)};`,
    );
    esModuleTypes.push(
      `${typePrefix} { ${binding} } from ${JSON.stringify(`./${entry.module}.mjs`)};`,
    );
  }

  return {
    [`${ROOT_ENTRY}.js`]: `${commonJs.join("\n")}\n`,
    [`${ROOT_ENTRY}.mjs`]: `${esModule.join("\n")}\n`,
    [`${ROOT_ENTRY}.d.ts`]: `${commonJsTypes.join("\n")}\n`,
    [`${ROOT_ENTRY}.d.mts`]: `${esModuleTypes.join("\n")}\n`,
  };
}

/**
 * The conditions a subpath resolves through: ES module or CommonJS, each
 * with its types first, as TypeScript reads them.
 * @param {string} base - e.g. "index" or "Types/*"
 * @returns {object} the conditions
 */
function exportConditions(base) {
  return {
    import: { types: `./${base}.d.mts`, default: `./${base}.mjs` },
    require: { types: `./${base}.d.ts`, default: `./${base}.js` },
  };
}

/**
 * The manifest's exports map: the root, each public file, a pattern per
 * public directory, null for each module left out, and package.json.
 * @param {{ publishedFiles: Array<string>, leftOut: Array<string> }} modules - the public files published, and the module ids left out
 * @returns {object} the exports map
 */
function exportsMap(modules) {
  const map = { ".": exportConditions(ROOT_ENTRY) };

  for (const file of modules.publishedFiles) {
    map[`./${file}`] = exportConditions(file);
  }

  for (const directory of PUBLIC_DIRECTORIES) {
    map[`./${directory}/*`] = exportConditions(`${directory}/*`);
  }

  for (const id of [...modules.leftOut].sort()) {
    map[`./${id}`] = null;
  }

  map["./package.json"] = "./package.json";

  return map;
}

/**
 * The manifest npm publishes.
 * @param {{ source: object, dependencies: Record<string, string>, exports: object, files: Array<string> }} parts - Common's own manifest, and what the build decided
 * @returns {object} the manifest
 */
function packageManifest(parts) {
  const source = parts.source;

  return {
    name: source.name,
    version: source.version,
    description: PACKAGE_DESCRIPTION,
    homepage: "https://oneuptime.com",
    repository: { ...source.repository, directory: "packages/Common" },
    bugs: { url: "https://github.com/OneUptime/oneuptime/issues" },
    author: source.author,
    license: source.license,
    engines: { node: NODE_ENGINE },
    main: `./${ROOT_ENTRY}.js`,
    types: `./${ROOT_ENTRY}.d.ts`,
    exports: parts.exports,
    files: parts.files,
    dependencies: parts.dependencies,
  };
}

/**
 * The files of a directory, recursively, as paths relative to it.
 * @param {string} directory - where to look
 * @param {(relative: string) => boolean} keep - which files to list
 * @returns {Array<string>} the files, sorted
 */
function listFiles(directory, keep) {
  const found = [];

  const walk = (current) => {
    if (!fs.existsSync(current)) {
      return;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") {
          walk(full);
        }
      } else if (entry.isFile()) {
        const relative = relativePath(directory, full);

        if (keep(relative)) {
          found.push(relative);
        }
      }
    }
  };

  walk(directory);

  return found.sort();
}

/**
 * The files the compile starts from: every module under the public
 * directories, the public files, and the ambient declarations.
 * @param {string} sourceRoot - Common's root, or a stand-in for it
 * @returns {Array<string>} absolute paths
 */
function compileRoots(sourceRoot) {
  const roots = [];

  for (const directory of PUBLIC_DIRECTORIES) {
    for (const file of listFiles(path.join(sourceRoot, directory), (name) => {
      return SOURCE_FILE.test(name) && !DECLARATION_FILE.test(name);
    })) {
      roots.push(path.join(sourceRoot, directory, file));
    }
  }

  for (const file of PUBLIC_FILES) {
    for (const extension of [".ts", ".tsx"]) {
      const full = path.join(sourceRoot, `${file}${extension}`);

      if (fs.existsSync(full)) {
        roots.push(full);
      }
    }
  }

  for (const declarations of GLOBAL_DECLARATIONS) {
    const full = path.join(sourceRoot, declarations);

    if (!fs.existsSync(full)) {
      continue;
    }

    if (fs.statSync(full).isDirectory()) {
      for (const file of listFiles(full, (name) => {
        return DECLARATION_FILE.test(name);
      })) {
        roots.push(path.join(full, file));
      }
    } else {
      roots.push(full);
    }
  }

  return roots;
}

/**
 * Compiles the public modules, and everything they import, to CommonJS with
 * declarations: Common's own compiler options, with only what this build
 * needs changed. Throws on any error, with each diagnostic.
 * @param {{ ts: object, sourceRoot: string, outDir: string }} options - the typescript module, Common's root, and where tsc writes
 * @returns {{ rootFiles: number, programFiles: number }} what it compiled
 */
function compileSources(options) {
  const ts = options.ts;
  const configFile = path.join(options.sourceRoot, "tsconfig.json");
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configFile,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(
          ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        );
      },
    },
  );

  if (!parsed) {
    throw new Error(`Could not read ${configFile}`);
  }

  const compilerOptions = {
    ...parsed.options,
    module: ts.ModuleKind.CommonJS,
    declaration: true,
    declarationMap: false,
    emitDeclarationOnly: false,
    sourceMap: false,
    inlineSourceMap: false,
    inlineSources: false,
    noEmit: false,
    noEmitOnError: true,
    incremental: false,
    composite: false,
    outDir: options.outDir,
    rootDir: options.sourceRoot,
  };
  delete compilerOptions.tsBuildInfoFile;
  delete compilerOptions.declarationDir;
  delete compilerOptions.outFile;

  const rootNames = compileRoots(options.sourceRoot);
  let program = ts.createProgram({ rootNames, options: compilerOptions });
  const diagnostics = [...ts.getPreEmitDiagnostics(program)];
  const emitted = program.emit();
  diagnostics.push(...emitted.diagnostics);

  const errors = diagnostics.filter((diagnostic) => {
    return diagnostic.category === ts.DiagnosticCategory.Error;
  });
  const programFiles = program.getSourceFiles().length;

  // Lets the program, the largest thing the build holds, be collected.
  program = null;

  if (errors.length > 0 || emitted.emitSkipped) {
    throw new Error(
      `TypeScript could not compile what the package holds:\n${ts.formatDiagnostics(
        errors,
        {
          getCanonicalFileName: (name) => {
            return name;
          },
          getCurrentDirectory: () => {
            return options.sourceRoot;
          },
          getNewLine: () => {
            return "\n";
          },
        },
      )}`,
    );
  }

  return { rootFiles: rootNames.length, programFiles };
}

/**
 * What tsc wrote, read on demand: for a module's JavaScript, the modules and
 * packages it requires; for its declaration, the declarations and packages it
 * refers to.
 * @param {object} ts - the typescript module
 * @param {string} compiledDirectory - tsc's output
 * @returns {{ scripts: Set<string>, declarations: Set<string>, requiresOf: (id: string) => object, referencesOf: (id: string) => object, referencesIn: (id: string, text: string) => object }} the compiled modules and how to read them
 */
function readCompiledTree(ts, compiledDirectory) {
  const scripts = new Set(
    listFiles(compiledDirectory, (name) => {
      return name.endsWith(".js");
    }).map(moduleIdOf),
  );
  const declarations = new Set(
    listFiles(compiledDirectory, (name) => {
      return DECLARATION_FILE.test(name);
    }).map(moduleIdOf),
  );
  const scriptCache = new Map();
  const declarationCache = new Map();

  const sort = (specifiers, fromId, exists) => {
    const modules = [];
    const packages = [];
    const unresolved = [];

    for (const specifier of specifiers) {
      if (specifier.startsWith(".")) {
        const target = resolveRelativeModule(fromId, specifier, exists);

        if (target === null) {
          unresolved.push(specifier);
        } else if (!modules.includes(target)) {
          modules.push(target);
        }
      } else if (!isBuiltinModule(specifier)) {
        const name = packageNameOf(specifier);

        if (!packages.includes(name)) {
          packages.push(name);
        }
      }
    }

    return { modules, packages, unresolved };
  };

  return {
    scripts,
    declarations,
    requiresOf: (id) => {
      if (!scriptCache.has(id)) {
        const file = path.join(compiledDirectory, `${id}.js`);
        const specifiers = requiredSpecifiers(
          ts,
          file,
          fs.readFileSync(file, "utf8"),
        );

        scriptCache.set(
          id,
          sort(specifiers, id, (candidate) => {
            return scripts.has(candidate);
          }),
        );
      }

      return scriptCache.get(id);
    },
    referencesIn: (id, text) => {
      return sort(
        declarationSpecifiers(ts, `${id}.d.ts`, text).map((specifier) => {
          return specifier.text;
        }),
        id,
        (candidate) => {
          return declarations.has(candidate);
        },
      );
    },
    referencesOf: (id) => {
      if (!declarationCache.has(id)) {
        const file = path.join(compiledDirectory, `${id}.d.ts`);
        const specifiers = declarationSpecifiers(
          ts,
          file,
          fs.readFileSync(file, "utf8"),
        ).map((specifier) => {
          return specifier.text;
        });

        declarationCache.set(
          id,
          sort(specifiers, id, (candidate) => {
            return declarations.has(candidate);
          }),
        );
      }

      return declarationCache.get(id);
    },
  };
}

/**
 * Decides which modules npm users get. A module is left out when LEFT_OUT
 * names it, or when what it loads when it runs - itself and every module it
 * requires, all the way down - includes a module outside the public
 * directories, a module left out on purpose, a relative require that names
 * no module, or a package Common does not depend on.
 * @param {{ candidates: Array<string>, requiresOf: (id: string) => { modules: Array<string>, packages: Array<string>, unresolved: Array<string> }, dependencies: Record<string, string>, leftOut: Record<string, string> }} input - the modules to decide on, how to read them, Common's dependencies and LEFT_OUT
 * @returns {{ published: Array<string>, leftOut: Array<{ module: string, reason: string }> }} the decision, each list sorted
 */
function selectModules(input) {
  const published = [];
  const leftOut = [];

  for (const id of [...input.candidates].sort()) {
    const reason = leftOutReason(id, input);

    if (reason === null) {
      published.push(id);
    } else {
      leftOut.push({ module: id, reason });
    }
  }

  return { published, leftOut };
}

/**
 * Why a module is left out, or null when it is published.
 * @param {string} id - the module
 * @param {object} input - as selectModules takes it
 * @returns {string | null} the reason
 */
function leftOutReason(id, input) {
  if (Object.prototype.hasOwnProperty.call(input.leftOut, id)) {
    return input.leftOut[id];
  }

  // Breadth first, so the chain printed is the shortest one.
  const parents = new Map([[id, null]]);
  const queue = [id];
  const chain = (to) => {
    const steps = [];

    for (let at = to; at !== null; at = parents.get(at)) {
      steps.unshift(at);
    }

    return steps.join(" -> ");
  };

  while (queue.length > 0) {
    const current = queue.shift();

    if (!isCandidateModule(current)) {
      return `loads ${current} when it runs (${chain(current)})`;
    }

    if (
      current !== id &&
      Object.prototype.hasOwnProperty.call(input.leftOut, current)
    ) {
      return `loads ${current}, which is left out (${chain(current)})`;
    }

    const required = input.requiresOf(current);

    if (required.unresolved.length > 0) {
      return `${current} requires ${required.unresolved[0]}, which is not there (${chain(current)})`;
    }

    for (const name of required.packages) {
      if (!Object.prototype.hasOwnProperty.call(input.dependencies, name)) {
        return `needs ${name}, which Common does not depend on (${chain(current)})`;
      }
    }

    for (const next of required.modules) {
      if (!parents.has(next)) {
        parents.set(next, current);
        queue.push(next);
      }
    }
  }

  return null;
}

/**
 * The declarations the package ships: each published module's, and every
 * declaration those refer to, all the way down.
 * @param {{ published: Array<string>, declarations: Set<string>, referencesOf: (id: string) => { modules: Array<string>, packages: Array<string>, unresolved: Array<string> } }} input - the published modules, and the compiled declarations
 * @returns {{ files: Array<string>, packages: Record<string, Array<string>>, problems: Array<string> }} the declarations (sorted), the packages they name (with the declarations that name each), and what is missing
 */
function selectDeclarations(input) {
  const files = new Set();
  const packages = {};
  const problems = [];
  const queue = [];

  for (const id of input.published) {
    if (input.declarations.has(id)) {
      queue.push(id);
    } else {
      problems.push(`${id} has no declaration`);
    }
  }

  while (queue.length > 0) {
    const id = queue.shift();

    if (files.has(id)) {
      continue;
    }

    files.add(id);

    const references = input.referencesOf(id);

    for (const specifier of references.unresolved) {
      problems.push(`${id}.d.ts refers to ${specifier}, which is not there`);
    }

    for (const name of references.packages) {
      packages[name] = [...(packages[name] || []), id];
    }

    for (const next of references.modules) {
      queue.push(next);
    }
  }

  return { files: [...files].sort(), packages, problems };
}

/**
 * The packages the published JavaScript requires, at the versions Common's
 * package.json gives them.
 * @param {{ published: Array<string>, requiresOf: (id: string) => { packages: Array<string> }, dependencies: Record<string, string> }} input - the published modules, how to read them, and Common's dependencies
 * @returns {Record<string, string>} name -> version range, sorted by name
 */
function selectDependencies(input) {
  const names = new Set();

  for (const id of input.published) {
    for (const name of input.requiresOf(id).packages) {
      names.add(name);
    }
  }

  const dependencies = {};

  for (const name of [...names].sort()) {
    dependencies[name] = input.dependencies[name];
  }

  return dependencies;
}

/**
 * What each module's CommonJS exports: loaded in a Node.js process of its
 * own, from the package directory, so it resolves its packages as an
 * installed package would from there. Throws, naming each module, when a
 * module throws as it loads.
 * @param {string} packageDirectory - the package, with its .js files written
 * @param {Array<string>} ids - the modules
 * @returns {Map<string, { hasDefault: boolean, names: Array<string> }>} what each exports
 */
function readExportNames(packageDirectory, ids) {
  const scratch = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-common-exports-"),
  );

  try {
    const input = path.join(scratch, "modules.json");
    const output = path.join(scratch, "exports.json");
    fs.writeFileSync(input, JSON.stringify(ids));

    const loaded = childProcess.spawnSync(
      process.execPath,
      [__filename, READ_EXPORTS_FLAG, packageDirectory, input, output],
      {
        cwd: packageDirectory,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    );

    if (loaded.status !== 0 || !fs.existsSync(output)) {
      throw new Error(
        `Could not load the package's modules to read their exports:\n${loaded.stderr || loaded.stdout}`,
      );
    }

    const results = JSON.parse(fs.readFileSync(output, "utf8"));
    const failures = Object.entries(results)
      .filter(([, result]) => {
        return typeof result.error === "string";
      })
      .map(([id, result]) => {
        return `  ${id}: ${result.error}`;
      });

    if (failures.length > 0) {
      throw new Error(
        `These modules throw when Node.js loads them from the package:\n${failures.join("\n")}`,
      );
    }

    return new Map(Object.entries(results));
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The other half of readExportNames, run as `node BuildNpmPackage.js
 * --read-exports <package> <modules.json> <exports.json>`.
 * @param {string} packageDirectory - the package
 * @param {string} input - a JSON list of module ids
 * @param {string} output - where to write what each exports
 */
function readExportNamesHere(packageDirectory, input, output) {
  const results = {};

  for (const id of JSON.parse(fs.readFileSync(input, "utf8"))) {
    try {
      const loaded = require(path.join(packageDirectory, `${id}.js`));

      results[id] = {
        hasDefault: Object.prototype.hasOwnProperty.call(loaded, "default"),
        names: Object.keys(loaded).filter((name) => {
          return name !== "default" && name !== "__esModule";
        }),
      };
    } catch (error) {
      results[id] = {
        error: String((error && error.message) || error).split("\n")[0],
      };
    }
  }

  fs.writeFileSync(output, JSON.stringify(results));
}

/**
 * Checks a written package on its own terms, file by file: every relative
 * require, import and declaration reference names a file the package has,
 * every package its JavaScript requires is a dependency (or Node.js's own),
 * every target of its manifest exists, every published module has its four
 * files, a module mapped to null has no JavaScript, and it holds nothing but
 * JavaScript, declarations, package.json, README.md and LICENSE.
 * @param {object} ts - the typescript module
 * @param {string} packageDirectory - the package
 * @returns {Array<string>} what is wrong, empty when nothing is
 */
function verifyPackage(ts, packageDirectory) {
  const problems = [];
  const manifestFile = path.join(packageDirectory, "package.json");

  if (!fs.existsSync(manifestFile)) {
    return ["there is no package.json"];
  }

  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const dependencies = manifest.dependencies || {};
  const files = listFiles(packageDirectory, () => {
    return true;
  });
  const fileSet = new Set(files);
  // The modules with a file of this kind: ".js" is not ".d.js", and so on.
  const idsWith = (extension) => {
    return new Set(
      files
        .filter((file) => {
          return (
            file.endsWith(extension) &&
            (extension.startsWith(".d.") || !file.endsWith(`.d${extension}`))
          );
        })
        .map((file) => {
          return file.slice(0, -extension.length);
        }),
    );
  };
  const scripts = idsWith(".js");
  const esModules = idsWith(".mjs");
  const commonJsTypes = idsWith(".d.ts");
  const esModuleTypes = idsWith(".d.mts");
  const publicIds = [...scripts].filter((id) => {
    return id !== ROOT_ENTRY;
  });

  for (const file of files) {
    const allowed =
      ["package.json", "README.md", "LICENSE"].includes(file) ||
      file.endsWith(".d.ts") ||
      file.endsWith(".d.mts") ||
      ((file.endsWith(".js") || file.endsWith(".mjs")) &&
        (moduleIdOf(file) === ROOT_ENTRY ||
          isCandidateModule(moduleIdOf(file))));

    if (!allowed) {
      problems.push(`${file} should not be in the package`);
    }
  }

  for (const target of [manifest.main, manifest.types]) {
    if (typeof target !== "string" || !fileSet.has(target.replace("./", ""))) {
      problems.push(`the manifest names ${target}, which is not there`);
    }
  }

  for (const [subpath, conditions] of Object.entries(manifest.exports || {})) {
    if (conditions === null || typeof conditions === "string") {
      if (conditions === null && scripts.has(subpath.slice(2))) {
        problems.push(
          `${subpath} is mapped to null but its JavaScript is in the package`,
        );
      }

      if (typeof conditions === "string" && !fileSet.has(conditions.slice(2))) {
        problems.push(`${subpath} names ${conditions}, which is not there`);
      }

      continue;
    }

    for (const kind of ["import", "require"]) {
      for (const target of Object.values(conditions[kind] || {})) {
        if (target.includes("*")) {
          continue;
        }

        if (!fileSet.has(target.slice(2))) {
          problems.push(`${subpath} names ${target}, which is not there`);
        }
      }
    }
  }

  for (const id of [ROOT_ENTRY, ...publicIds]) {
    for (const [set, extension] of [
      [scripts, ".js"],
      [esModules, ".mjs"],
      [commonJsTypes, ".d.ts"],
      [esModuleTypes, ".d.mts"],
    ]) {
      if (!set.has(id)) {
        problems.push(`${id} has no ${extension}`);
      }
    }
  }

  for (const id of esModules) {
    if (!scripts.has(id)) {
      problems.push(`${id}.mjs has no CommonJS module beside it`);
    }
  }

  for (const id of scripts) {
    const text = fs.readFileSync(
      path.join(packageDirectory, `${id}.js`),
      "utf8",
    );

    for (const specifier of requiredSpecifiers(ts, `${id}.js`, text)) {
      if (specifier.startsWith(".")) {
        if (
          resolveRelativeModule(id, specifier, (candidate) => {
            return scripts.has(candidate);
          }) === null
        ) {
          problems.push(`${id}.js requires ${specifier}, which is not there`);
        }
      } else if (
        !isBuiltinModule(specifier) &&
        !Object.prototype.hasOwnProperty.call(
          dependencies,
          packageNameOf(specifier),
        )
      ) {
        problems.push(
          `${id}.js requires ${specifier}, which is not a dependency`,
        );
      }
    }
  }

  for (const id of esModules) {
    const text = fs.readFileSync(
      path.join(packageDirectory, `${id}.mjs`),
      "utf8",
    );

    for (const specifier of declarationSpecifiers(ts, `${id}.mts`, text)) {
      if (!specifier.text.startsWith(".")) {
        problems.push(`${id}.mjs imports ${specifier.text}`);
      } else if (
        !fileSet.has(
          path.posix.normalize(
            path.posix.join(path.posix.dirname(id), specifier.text),
          ),
        )
      ) {
        problems.push(
          `${id}.mjs imports ${specifier.text}, which is not there`,
        );
      }
    }
  }

  for (const [set, extension, exists] of [
    [
      commonJsTypes,
      ".d.ts",
      (candidate) => {
        return commonJsTypes.has(candidate);
      },
    ],
    [
      esModuleTypes,
      ".d.mts",
      (candidate) => {
        return esModuleTypes.has(candidate);
      },
    ],
  ]) {
    for (const id of set) {
      const text = fs.readFileSync(
        path.join(packageDirectory, `${id}${extension}`),
        "utf8",
      );

      for (const specifier of declarationSpecifiers(
        ts,
        `${id}${extension}`,
        text,
      )) {
        if (!specifier.text.startsWith(".")) {
          continue;
        }

        if (extension === ".d.mts" && !specifier.text.endsWith(".mjs")) {
          problems.push(
            `${id}${extension} refers to ${specifier.text}, which does not name an ES module`,
          );
          continue;
        }

        if (resolveRelativeModule(id, specifier.text, exists) === null) {
          problems.push(
            `${id}${extension} refers to ${specifier.text}, which is not there`,
          );
        }
      }
    }
  }

  return problems;
}

/**
 * Cuts down each declaration the package would ship for types only (not a
 * published module's own) that names a package the package does not
 * install, to what the package's other declarations use from it
 * (pruneDeclaration). A declaration another one takes as a whole stays as
 * it is.
 * @param {{ ts: object, compiledDirectory: string, published: Set<string>, dependencies: Record<string, string>, tree: object }} input - the typescript module, tsc's output, the published modules, the package's dependencies and the compiled tree
 * @returns {Map<string, string>} module id -> its declaration, cut down
 */
function pruneTypeOnlyDeclarations(input) {
  const { ts, tree } = input;
  const reached = selectDeclarations({
    published: [...input.published],
    declarations: tree.declarations,
    referencesOf: tree.referencesOf,
  });
  const installs = (name) => {
    return Object.prototype.hasOwnProperty.call(input.dependencies, name);
  };
  const toPrune = reached.files.filter((id) => {
    return (
      !input.published.has(id) &&
      tree.referencesOf(id).packages.some((name) => {
        return !installs(name);
      })
    );
  });
  const pruned = new Map();

  if (toPrune.length === 0) {
    return pruned;
  }

  const texts = new Map(
    reached.files.map((id) => {
      return [
        id,
        fs.readFileSync(
          path.join(input.compiledDirectory, `${id}.d.ts`),
          "utf8",
        ),
      ];
    }),
  );

  for (const target of toPrune) {
    const used = { all: false, names: new Set() };

    for (const id of reached.files) {
      if (id === target || !tree.referencesOf(id).modules.includes(target)) {
        continue;
      }

      const usedHere = namesUsedFrom(
        ts,
        `${id}.d.ts`,
        texts.get(id),
        (specifier) => {
          return (
            specifier.startsWith(".") &&
            resolveRelativeModule(id, specifier, (candidate) => {
              return tree.declarations.has(candidate);
            }) === target
          );
        },
      );

      used.all = used.all || usedHere.all;

      for (const name of usedHere.names) {
        used.names.add(name);
      }
    }

    if (!used.all) {
      pruned.set(
        target,
        pruneDeclaration(ts, `${target}.d.ts`, texts.get(target), used.names),
      );
    }
  }

  return pruned;
}

/**
 * Writes a file, making its directory first.
 * @param {string} file - where
 * @param {string} text - what
 */
function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/**
 * The manifest's files: the root entry, the public files and directories,
 * and, for a directory that holds declarations only, its declarations.
 * @param {string} packageDirectory - the package, written
 * @returns {Array<string>} the entries
 */
function filesField(packageDirectory) {
  const entries = [
    `${ROOT_ENTRY}.js`,
    `${ROOT_ENTRY}.mjs`,
    `${ROOT_ENTRY}.d.ts`,
    `${ROOT_ENTRY}.d.mts`,
  ];

  for (const file of PUBLIC_FILES) {
    if (fs.existsSync(path.join(packageDirectory, `${file}.js`))) {
      entries.push(
        `${file}.js`,
        `${file}.mjs`,
        `${file}.d.ts`,
        `${file}.d.mts`,
      );
    }
  }

  const topLevel = fs
    .readdirSync(packageDirectory, { withFileTypes: true })
    .filter((entry) => {
      return entry.isDirectory();
    })
    .map((entry) => {
      return entry.name;
    })
    .sort();

  for (const directory of topLevel) {
    if (PUBLIC_DIRECTORIES.includes(directory)) {
      entries.push(`${directory}/`);
    } else {
      entries.push(`${directory}/**/*.d.ts`, `${directory}/**/*.d.mts`);
    }
  }

  return entries;
}

/**
 * The size of a directory's files.
 * @param {string} directory - the directory
 * @returns {{ files: number, bytes: number }} how many, and how large
 */
function directorySize(directory) {
  let bytes = 0;
  const files = listFiles(directory, () => {
    return true;
  });

  for (const file of files) {
    bytes += fs.statSync(path.join(directory, file)).size;
  }

  return { files: files.length, bytes };
}

/**
 * Refuses to start over in a directory the build does not own: it deletes
 * the build directory first, so that must be under the source root's build/
 * or under the system's temporary directory.
 * @param {string} buildDirectory - where the build writes
 * @param {string} sourceRoot - Common's root, or a stand-in for it
 */
function assertDeletable(buildDirectory, sourceRoot) {
  const resolved = path.resolve(buildDirectory);
  const inside = (parent) => {
    const relative = path.relative(path.resolve(parent), resolved);

    return (
      relative.length > 0 &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative)
    );
  };

  if (!inside(path.join(sourceRoot, "build")) && !inside(os.tmpdir())) {
    throw new Error(
      `Refusing to build into ${buildDirectory}: the build deletes it first, so it must be under ${path.join(sourceRoot, "build")} or ${os.tmpdir()}`,
    );
  }
}

/**
 * Builds the package.
 * @param {object} [options] - for tests: a stand-in Common and where to write
 * @param {string} [options.sourceRoot] - Common's root (default: this package)
 * @param {string} [options.buildDirectory] - where to build (default: <sourceRoot>/build/npm)
 * @param {object} [options.typescript] - the typescript module (default: Common's)
 * @param {Record<string, string>} [options.leftOut] - modules left out on purpose (default: LEFT_OUT)
 * @param {ReadonlyArray<object>} [options.rootExports] - the root's exports (default: ROOT_EXPORTS)
 * @param {string} [options.licenseFile] - the LICENSE to ship (default: the repository's)
 * @param {string} [options.readmeFile] - the README.md to ship (default: <sourceRoot>/README.md)
 * @returns {object} what it built: the package directory, the manifest, what was published and left out, and the package's size
 */
function buildNpmPackage(options) {
  const settings = options || {};
  const sourceRoot = settings.sourceRoot || COMMON_ROOT;
  const buildDirectory =
    settings.buildDirectory || path.join(sourceRoot, "build", "npm");
  const ts =
    settings.typescript ||
    require(
      require.resolve("typescript", { paths: [sourceRoot, COMMON_ROOT] }),
    );
  const leftOutOnPurpose = settings.leftOut || LEFT_OUT;
  const rootExports = settings.rootExports || ROOT_EXPORTS;
  const licenseFile =
    settings.licenseFile || path.join(REPOSITORY_ROOT, "LICENSE");
  const readmeFile = settings.readmeFile || path.join(sourceRoot, "README.md");
  const compiledDirectory = path.join(buildDirectory, COMPILED_DIRECTORY_NAME);
  const packageDirectory = path.join(buildDirectory, PACKAGE_DIRECTORY_NAME);
  const source = JSON.parse(
    fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8"),
  );
  const commonDependencies = source.dependencies || {};

  assertDeletable(buildDirectory, sourceRoot);
  fs.rmSync(buildDirectory, { recursive: true, force: true });

  const compiled = compileSources({
    ts,
    sourceRoot,
    outDir: compiledDirectory,
  });
  const tree = readCompiledTree(ts, compiledDirectory);
  const candidates = [...tree.scripts].filter(isCandidateModule);
  const selection = selectModules({
    candidates,
    requiresOf: tree.requiresOf,
    dependencies: commonDependencies,
    leftOut: leftOutOnPurpose,
  });
  const publishedSet = new Set(selection.published);

  for (const entry of rootExports) {
    if (!publishedSet.has(entry.module)) {
      const reason = selection.leftOut.find((leftOut) => {
        return leftOut.module === entry.module;
      });

      throw new Error(
        `The package root exports ${entry.name} from ${entry.module}, which cannot be published: ${
          reason ? reason.reason : "there is no such module"
        }`,
      );
    }
  }

  const dependencies = selectDependencies({
    published: selection.published,
    requiresOf: tree.requiresOf,
    dependencies: commonDependencies,
  });
  const pruned = pruneTypeOnlyDeclarations({
    ts,
    compiledDirectory,
    published: publishedSet,
    dependencies,
    tree,
  });
  const declarations = selectDeclarations({
    published: selection.published,
    declarations: tree.declarations,
    referencesOf: (id) => {
      return pruned.has(id)
        ? tree.referencesIn(id, pruned.get(id))
        : tree.referencesOf(id);
    },
  });

  if (declarations.problems.length > 0) {
    throw new Error(
      `The package's declarations are not complete:\n  ${declarations.problems.join("\n  ")}`,
    );
  }

  const shippedDeclarations = new Set(declarations.files);
  const packageSpecifier = esModulePackageSpecifiers(ts, packageDirectory);

  for (const id of selection.published) {
    fs.mkdirSync(path.dirname(path.join(packageDirectory, id)), {
      recursive: true,
    });
    fs.copyFileSync(
      path.join(compiledDirectory, `${id}.js`),
      path.join(packageDirectory, `${id}.js`),
    );
  }

  for (const id of declarations.files) {
    const text = pruned.has(id)
      ? pruned.get(id)
      : fs.readFileSync(path.join(compiledDirectory, `${id}.d.ts`), "utf8");

    writeFile(path.join(packageDirectory, `${id}.d.ts`), text);
    writeFile(
      path.join(packageDirectory, `${id}.d.mts`),
      esModuleDeclaration(ts, id, text, {
        exists: (candidate) => {
          return shippedDeclarations.has(candidate);
        },
        packageSpecifier,
      }),
    );
  }

  const exportNames = readExportNames(packageDirectory, selection.published);

  for (const id of selection.published) {
    writeFile(
      path.join(packageDirectory, `${id}.mjs`),
      esModuleWrapper(id, exportNames.get(id)),
    );
  }

  for (const entry of rootExports) {
    const exported = exportNames.get(entry.module);
    const name = entry.export || "default";
    const atRunTime =
      name === "default" ? exported.hasDefault : exported.names.includes(name);
    const declared = declaredExports(
      ts,
      `${entry.module}.d.ts`,
      fs.readFileSync(
        path.join(packageDirectory, `${entry.module}.d.ts`),
        "utf8",
      ),
    ).has(name);

    if ((!entry.typeOnly && !atRunTime) || !declared) {
      throw new Error(
        `The package root exports ${entry.name} as ${entry.module}'s ${name}, which ${entry.module} does not export${
          entry.typeOnly || atRunTime ? " in its types" : ""
        }`,
      );
    }
  }

  for (const [file, text] of Object.entries(rootEntryFiles(rootExports))) {
    writeFile(path.join(packageDirectory, file), text);
  }

  const leftOutIds = selection.leftOut.map((entry) => {
    return entry.module;
  });
  const manifest = packageManifest({
    source,
    dependencies,
    exports: exportsMap({
      publishedFiles: PUBLIC_FILES.filter((file) => {
        return publishedSet.has(file);
      }),
      leftOut: leftOutIds,
    }),
    files: filesField(packageDirectory),
  });

  writeFile(
    path.join(packageDirectory, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  fs.copyFileSync(readmeFile, path.join(packageDirectory, "README.md"));
  fs.copyFileSync(licenseFile, path.join(packageDirectory, "LICENSE"));

  const problems = verifyPackage(ts, packageDirectory);

  if (problems.length > 0) {
    throw new Error(
      `The package in ${packageDirectory} is not right:\n  ${problems.join("\n  ")}`,
    );
  }

  return {
    packageDirectory,
    manifest,
    compiled,
    published: selection.published,
    leftOut: selection.leftOut,
    typeOnlyDeclarations: declarations.files.filter((id) => {
      return !publishedSet.has(id);
    }),
    prunedDeclarations: [...pruned.keys()].sort(),
    typeOnlyPackages: Object.keys(declarations.packages)
      .filter((name) => {
        return !Object.prototype.hasOwnProperty.call(dependencies, name);
      })
      .sort(),
    size: directorySize(packageDirectory),
  };
}

/**
 * What the build prints.
 * @param {object} report - what buildNpmPackage returned
 * @returns {string} the summary
 */
function describeBuild(report) {
  const byDirectory = {};

  for (const id of report.published) {
    const top = id.split("/")[0];
    byDirectory[top] = (byDirectory[top] || 0) + 1;
  }

  const lines = [
    `${report.manifest.name}@${report.manifest.version} in ${report.packageDirectory}`,
    `  ${report.published.length} modules published (${Object.entries(
      byDirectory,
    )
      .map(([directory, count]) => {
        return `${directory} ${count}`;
      })
      .join(", ")})`,
    `  ${report.leftOut.length} left out:`,
    ...report.leftOut.map((entry) => {
      return `    ${entry.module}: ${entry.reason}`;
    }),
    `  ${report.typeOnlyDeclarations.length} more declarations, for types only (their JavaScript is not in the package)${
      report.prunedDeclarations.length > 0
        ? `; cut down to what the others use: ${report.prunedDeclarations.join(", ")}`
        : ""
    }`,
    `  dependencies: ${Object.keys(report.manifest.dependencies).join(", ")}`,
  ];

  if (report.typeOnlyPackages.length > 0) {
    lines.push(
      `  declarations that also name packages it does not install (types only): ${report.typeOnlyPackages.join(", ")}`,
    );
  }

  lines.push(
    `  ${report.size.files} files, ${(report.size.bytes / 1024 / 1024).toFixed(1)} MB`,
  );

  return lines.join("\n");
}

module.exports = {
  COMMON_ROOT,
  BUILD_DIRECTORY,
  PACKAGE_DIRECTORY,
  PUBLIC_DIRECTORIES,
  PUBLIC_FILES,
  LEFT_OUT,
  ROOT_EXPORTS,
  NODE_ENGINE,
  moduleIdOf,
  isCandidateModule,
  isBuiltinModule,
  packageNameOf,
  resolveRelativeModule,
  relativeSpecifier,
  requiredSpecifiers,
  declarationSpecifiers,
  declaredExports,
  esModuleDeclaration,
  esModulePackageSpecifiers,
  esModuleWrapper,
  namesUsedFrom,
  pruneDeclaration,
  rootEntryFiles,
  exportsMap,
  packageManifest,
  compileRoots,
  selectModules,
  selectDeclarations,
  selectDependencies,
  verifyPackage,
  buildNpmPackage,
  describeBuild,
};

if (require.main === module) {
  if (process.argv[2] === READ_EXPORTS_FLAG) {
    readExportNamesHere(process.argv[3], process.argv[4], process.argv[5]);
  } else {
    try {
      const started = Date.now();
      const report = buildNpmPackage();

      console.log(describeBuild(report));
      console.log(`  built in ${Math.round((Date.now() - started) / 1000)} s`);
    } catch (error) {
      console.error(String((error && error.message) || error));
      process.exit(1);
    }
  }
}
