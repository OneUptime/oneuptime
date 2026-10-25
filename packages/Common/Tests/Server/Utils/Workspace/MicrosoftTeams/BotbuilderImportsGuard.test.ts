import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { listProductFiles } from "../../../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../../../Helpers/TagStripScan";

/*
 * BOTBUILDER IS IMPORTED THROUGH ONE FILE.
 *
 * Common runs botbuilder (the Bot Framework SDK) on its own zod 4, and
 * botbuilder calls two zod 3 names zod 4 dropped - one of them while it
 * loads. BotbuilderOnZod4 adds them back, so it has to run before botbuilder
 * is loaded: Server/Utils/Workspace/MicrosoftTeams/Botbuilder imports it and
 * then re-exports botbuilder, and every other file imports botbuilder from
 * there. A file that imported botbuilder itself could load it first, and the
 * Teams integration would fail to start ("z.object(...).nonstrict is not a
 * function") on whichever path happened to load that file first.
 *
 * This reads every file of product code (Tests/Helpers/CodeScanning's
 * listing: packages/, ee/ when the checkout has it, Scripts/ and the rest,
 * no tests) through the TypeScript AST and fails on any import, re-export,
 * require() or import() of botbuilder or of a botbuilder-* or
 * botframework-* package outside Botbuilder.ts. The detector is pinned on
 * snippets first.
 */

const BOTBUILDER_FILE: string =
  "packages/Common/Server/Utils/Workspace/MicrosoftTeams/Botbuilder.ts";
const ZOD_NAMES_MODULE: string = "./BotbuilderOnZod4";

interface BotbuilderImport {
  // 1-based.
  line: number;
  module: string;
}

interface BotbuilderImportFinding extends BotbuilderImport {
  file: string;
}

/*
 * botbuilder and the packages it is made of (botbuilder-core,
 * botframework-connector, botframework-schema, ...), and their subpaths.
 */
function isBotbuilderModule(specifier: string): boolean {
  const packageName: string = specifier.split("/")[0] || "";

  return (
    packageName === "botbuilder" ||
    packageName.startsWith("botbuilder-") ||
    packageName.startsWith("botframework-")
  );
}

function scriptKindOf(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }

  if (fileName.endsWith(".ts")) {
    return ts.ScriptKind.TS;
  }

  if (fileName.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }

  return ts.ScriptKind.JS;
}

function findBotbuilderImports(
  fileName: string,
  source: string,
): Array<BotbuilderImport> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(fileName),
  );
  const found: Array<BotbuilderImport> = [];

  const record: (node: ts.Node, specifier: string) => void = (
    node: ts.Node,
    specifier: string,
  ): void => {
    if (!isBotbuilderModule(specifier)) {
      return;
    }

    found.push({
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
      module: specifier,
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      record(node, node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      record(node, node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node)) {
      const argument: ts.Expression | undefined = node.arguments[0];
      const isRequire: boolean =
        ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isDynamicImport: boolean =
        node.expression.kind === ts.SyntaxKind.ImportKeyword;

      if (
        (isRequire || isDynamicImport) &&
        argument &&
        ts.isStringLiteralLike(argument)
      ) {
        record(node, argument.text);
      }
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      record(node, node.argument.literal.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

function modulesIn(
  source: string,
  fileName: string = "Fixture.ts",
): Array<string> {
  return findBotbuilderImports(fileName, source).map(
    (found: BotbuilderImport): string => {
      return `${found.line}: ${found.module}`;
    },
  );
}

const SCANNED_EXTENSIONS: ReadonlyArray<string> = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

function scanProductCode(): {
  files: Array<string>;
  findings: Array<BotbuilderImportFinding>;
} {
  const files: Array<string> = listProductFiles().filter(
    (file: string): boolean => {
      return SCANNED_EXTENSIONS.some((extension: string): boolean => {
        return file.endsWith(extension);
      });
    },
  );
  const findings: Array<BotbuilderImportFinding> = [];

  for (const file of files) {
    const source: string = fs.readFileSync(
      path.join(REPOSITORY_DIRECTORY, file),
      "utf8",
    );

    // Most files never name it; only those are parsed.
    if (!source.includes("botbuilder") && !source.includes("botframework-")) {
      continue;
    }

    for (const found of findBotbuilderImports(file, source)) {
      findings.push({ ...found, file: file });
    }
  }

  return { files, findings };
}

describe("the detector finds every way of loading botbuilder", () => {
  test.each([
    ["an import", 'import { TurnContext } from "botbuilder";'],
    ["a type-only import", 'import type { Activity } from "botbuilder";'],
    ["a namespace import", 'import * as botbuilder from "botbuilder";'],
    ["a side-effect import", 'import "botbuilder";'],
    ["a re-export", 'export * from "botbuilder";'],
    ["a named re-export", 'export { CloudAdapter } from "botbuilder";'],
    ["a require", 'const botbuilder = require("botbuilder");'],
    ["an import-equals", 'import botbuilder = require("botbuilder");'],
    ["a dynamic import", 'const loaded = await import("botbuilder");'],
    [
      "an import type node",
      'type Adapter = import("botbuilder").CloudAdapter;',
    ],
    ["a template literal", "const botbuilder = require(`botbuilder`);"],
  ])("%s", (_name: string, source: string) => {
    expect(findBotbuilderImports("Fixture.ts", source)).toEqual([
      { line: 1, module: "botbuilder" },
    ]);
  });

  test.each([
    "botbuilder-core",
    "botframework-connector",
    "botframework-schema",
    "botbuilder-dialogs",
    "botbuilder/lib/teamsActivityHandler",
  ])("the packages botbuilder is made of, and subpaths: %s", (name: string) => {
    expect(modulesIn(`import { X } from "${name}";`)).toEqual([`1: ${name}`]);
  });

  test("in JavaScript too", () => {
    expect(
      modulesIn('const { CloudAdapter } = require("botbuilder");', "File.js"),
    ).toEqual(["1: botbuilder"]);
  });

  test("on the line it is on", () => {
    expect(
      modulesIn(
        [
          'import Logger from "../Logger";',
          "",
          "import {",
          "  CloudAdapter,",
          '} from "botbuilder";',
        ].join("\n"),
      ),
    ).toEqual(["3: botbuilder"]);
  });

  test("leaves alone what does not load it", () => {
    expect(
      modulesIn(
        [
          '// import { TurnContext } from "botbuilder";',
          'const name: string = "botbuilder";',
          'import { TurnContext } from "./Botbuilder";',
          'import { TurnContext as T } from "../Botbuilder";',
          'import x from "botbuilderish";',
          'import y from "@scope/botbuilder";',
          'const resolved = require.resolve("botbuilder");',
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});

describe("Botbuilder.ts adds zod's missing names before botbuilder is loaded", () => {
  test("its first module is BotbuilderOnZod4, then botbuilder, and nothing else", () => {
    const source: string = fs.readFileSync(
      path.join(REPOSITORY_DIRECTORY, BOTBUILDER_FILE),
      "utf8",
    );
    const sourceFile: ts.SourceFile = ts.createSourceFile(
      BOTBUILDER_FILE,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const modules: Array<string> = sourceFile.statements
      .map((statement: ts.Statement): string | undefined => {
        if (
          (ts.isImportDeclaration(statement) ||
            ts.isExportDeclaration(statement)) &&
          statement.moduleSpecifier &&
          ts.isStringLiteral(statement.moduleSpecifier)
        ) {
          return statement.moduleSpecifier.text;
        }

        return undefined;
      })
      .filter((specifier: string | undefined): specifier is string => {
        return specifier !== undefined;
      });

    expect(modules).toEqual([ZOD_NAMES_MODULE, "botbuilder"]);

    // A side-effect import: nothing named is taken, so nothing is elided.
    const first: ts.Statement | undefined = sourceFile.statements.find(
      (statement: ts.Statement): boolean => {
        return ts.isImportDeclaration(statement);
      },
    );

    expect(first && ts.isImportDeclaration(first)).toBe(true);
    expect((first as ts.ImportDeclaration).importClause).toBeUndefined();
  });

  test("BotbuilderOnZod4 itself does not load botbuilder", () => {
    const file: string = path.join(
      path.dirname(path.join(REPOSITORY_DIRECTORY, BOTBUILDER_FILE)),
      "BotbuilderOnZod4.ts",
    );

    expect(findBotbuilderImports(file, fs.readFileSync(file, "utf8"))).toEqual(
      [],
    );
  });
});

describe("product code loads botbuilder only through Botbuilder.ts", () => {
  const scanned: {
    files: Array<string>;
    findings: Array<BotbuilderImportFinding>;
  } = scanProductCode();

  test("the walk read the product code, Botbuilder.ts and the Teams integration among it", () => {
    expect(scanned.files.length).toBeGreaterThan(1000);
    expect(scanned.files).toContain(BOTBUILDER_FILE);
    expect(scanned.files).toContain(
      "packages/Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams.ts",
    );
    // No test is product code.
    expect(
      scanned.files.some((file: string): boolean => {
        return file.includes("/Tests/");
      }),
    ).toBe(false);
  });

  test("Botbuilder.ts is the one file that loads it", () => {
    const outside: Array<string> = scanned.findings
      .filter((finding: BotbuilderImportFinding): boolean => {
        return finding.file !== BOTBUILDER_FILE;
      })
      .map((finding: BotbuilderImportFinding): string => {
        return `${finding.file}:${finding.line}  ${finding.module}`;
      });

    if (outside.length > 0) {
      throw new Error(
        [
          `${outside.length} file(s) load botbuilder themselves:`,
          ...outside.map((line: string): string => {
            return `  ${line}`;
          }),
          "",
          "Import it from Common/Server/Utils/Workspace/MicrosoftTeams/Botbuilder",
          '(for example `import { TurnContext } from "./Botbuilder"`), which adds',
          "the zod 3 names botbuilder needs (BotbuilderOnZod4) before loading it.",
        ].join("\n"),
      );
    }

    expect(
      scanned.findings.map((finding: BotbuilderImportFinding): string => {
        return `${finding.file}: ${finding.module}`;
      }),
    ).toEqual([`${BOTBUILDER_FILE}: botbuilder`]);
  });

  test("the Teams integration imports botbuilder through it", () => {
    const teams: string = fs.readFileSync(
      path.join(
        REPOSITORY_DIRECTORY,
        "packages/Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams.ts",
      ),
      "utf8",
    );

    expect(teams).toContain('} from "./Botbuilder";');
  });
});
