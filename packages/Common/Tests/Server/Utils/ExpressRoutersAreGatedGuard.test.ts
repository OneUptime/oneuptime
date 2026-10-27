import { listProductFiles } from "../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * EVERY ROUTER OF ONEUPTIME'S IS MADE BY Express.getRouter().
 *
 * Express.getRouter() gates the router it makes (ExpressRouterGate): a
 * request none of its routes can match passes it straight by, instead of
 * being tried against each of its routes. With ~700 routers in the App,
 * most of them at /api, that is about 0.75 ms of CPU an API request. A
 * router made by Express itself would not be gated, and every request to
 * /api would be tried against all of its routes again - so product code
 * makes no router of its own: it asks Express.getRouter().
 *
 * Read from the code (the TypeScript syntax tree), across all product code
 * (ee/ too, when it is checked out): a call of Router on what a file imports
 * from "express" - express.Router(), whatever the import is called - and a
 * Router imported from "express" by name.
 */

const CODE_FILE: RegExp = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

// The one place a router is made: the gate's own.
const ALLOWED: Array<string> = ["packages/Common/Server/Utils/Express.ts"];

// Where, in this source, Express is asked for a router of its own.
function expressRoutersMadeIn(
  fileName: string,
  source: string,
): Array<string> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const expressNames: Set<string> = new Set();
  const found: Array<string> = [];

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "express"
    ) {
      continue;
    }

    const clause: ts.ImportClause | undefined = statement.importClause;

    if (clause?.name) {
      expressNames.add(clause.name.text);
    }

    const bindings: ts.NamedImportBindings | undefined = clause?.namedBindings;

    if (bindings && ts.isNamespaceImport(bindings)) {
      expressNames.add(bindings.name.text);
    }

    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if ((element.propertyName || element.name).text === "Router") {
          found.push(`imports Router from "express"`);
        }
      }
    }
  }

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "Router" &&
      ts.isIdentifier(node.expression.expression) &&
      expressNames.has(node.expression.expression.text)
    ) {
      found.push(`calls ${node.expression.getText(sourceFile)}()`);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

describe("every Express router is made by Express.getRouter()", () => {
  test("no product code makes a router of Express's own", () => {
    const files: Array<string> = listProductFiles(REPOSITORY_DIRECTORY, [
      "packages",
      "ee",
    ]).filter((relativePath: string): boolean => {
      return CODE_FILE.test(relativePath);
    });

    // The scan reads the product's code, not an empty list.
    expect(files.length).toBeGreaterThan(1000);

    const makers: Array<string> = files.filter(
      (relativePath: string): boolean => {
        const source: string = fs.readFileSync(
          path.join(REPOSITORY_DIRECTORY, relativePath),
          "utf8",
        );

        // A cheap first pass on the text, then the syntax tree.
        if (!source.includes("express") || !source.includes("Router")) {
          return false;
        }

        return expressRoutersMadeIn(relativePath, source).length > 0;
      },
    );

    expect(makers.sort()).toEqual(ALLOWED);
  });

  test("Express.getRouter() makes its router through the gate", () => {
    const source: string = fs.readFileSync(
      path.join(REPOSITORY_DIRECTORY, ALLOWED[0]!),
      "utf8",
    );

    expect(source).toContain("return ExpressRouterGate.gate(express.Router());");
    expect(expressRoutersMadeIn(ALLOWED[0]!, source)).toEqual([
      "calls express.Router()",
    ]);
  });

  test.each([
    ['import express from "express";\nconst r = express.Router();', 1],
    ['import e from "express";\nconst r = e.Router({ mergeParams: true });', 1],
    ['import * as ex from "express";\nex.Router();', 1],
    ['import { Router } from "express";', 1],
    ['import express, { Request, Router as R } from "express";', 1],
    ['import Express from "../Utils/Express";\nExpress.getRouter();', 0],
    ['import { BrowserRouter as Router } from "react-router-dom";', 0],
    ['import express from "express";\n// express.Router() in a comment', 0],
    ['const express = { Router: () => 1 };\nexpress.Router();', 0],
  ])("finds what it is for in %j", (source: string, count: number) => {
    expect(expressRoutersMadeIn("Example.ts", source)).toHaveLength(count);
  });
});
