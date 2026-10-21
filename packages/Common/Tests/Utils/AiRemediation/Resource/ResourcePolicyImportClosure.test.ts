import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import { afterAll, describe, expect, test } from "@jest/globals";

/*
 * Contract under test — the resource policy closure stays import-closed.
 *
 * packages/Common/Types/ResourceAiAgent and
 * packages/Common/Utils/AiRemediation/Resource are copied byte-identically
 * into the standalone resource AI agent (agents/ResourceAIAgent), together
 * with Types/AutoRemediation/AiRemediationCommandPolicyVerdict.ts and
 * Types/AI/AgentAiSettings.ts (what OneUptime AI may do, as the agent
 * reports it). The agent has no Common dependency and no Node-specific code
 * may run inside the policy (it runs in the server, the dashboard and the
 * agent alike), so a file in those directories may import ONLY:
 *   - another file in those two directories, or
 *   - one of those two leaves (each imports nothing itself),
 * by a RELATIVE path — never a package, a Node built-in or the "Common/..."
 * alias — and may not reach for Node globals (process, Buffer, require,
 * __dirname, ...).
 *
 * Files are read with fs and parsed with the TypeScript compiler, never
 * required: Common's jest config maps any specifier containing "Common/" to
 * this package, which would hide exactly the alias imports this forbids.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const CLOSED_DIRECTORIES: Array<string> = [
  path.join(COMMON_ROOT, "Types", "ResourceAiAgent"),
  path.join(COMMON_ROOT, "Utils", "AiRemediation", "Resource"),
];

const AGENT_AI_SETTINGS_FILE: string = path.join(
  COMMON_ROOT,
  "Types",
  "AI",
  "AgentAiSettings.ts",
);

const ALLOWED_OUTSIDE_FILES: Array<string> = [
  path.join(
    COMMON_ROOT,
    "Types",
    "AutoRemediation",
    "AiRemediationCommandPolicyVerdict.ts",
  ),
  AGENT_AI_SETTINGS_FILE,
];

const NODE_GLOBALS: Array<string> = [
  "process",
  "Buffer",
  "require",
  "__dirname",
  "__filename",
  "module",
  "exports",
  "global",
  "setImmediate",
  "clearImmediate",
];

interface ImportFinding {
  specifiers: Array<string>;
  nodeGlobals: Array<string>;
}

// Every module specifier and every free Node global a TypeScript file uses.
function scanFile(file: string): ImportFinding {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: Array<string> = [];
  const nodeGlobals: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }

    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }

    if (ts.isImportTypeNode(node)) {
      const argument: ts.TypeNode = node.argument;

      if (
        ts.isLiteralTypeNode(argument) &&
        ts.isStringLiteral(argument.literal)
      ) {
        specifiers.push(argument.literal.text);
      }
    }

    if (ts.isIdentifier(node) && NODE_GLOBALS.includes(node.text)) {
      const parent: ts.Node | undefined = node.parent;
      const isPropertyName: boolean = Boolean(
        parent &&
          ((ts.isPropertyAccessExpression(parent) && parent.name === node) ||
            (ts.isPropertyAssignment(parent) && parent.name === node) ||
            (ts.isPropertySignature(parent) && parent.name === node) ||
            (ts.isPropertyDeclaration(parent) && parent.name === node) ||
            (ts.isMethodDeclaration(parent) && parent.name === node)),
      );

      if (!isPropertyName) {
        nodeGlobals.push(node.text);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return { specifiers, nodeGlobals };
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  const base: string = path.resolve(path.dirname(fromFile), specifier);

  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "Index.ts"),
  ]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isInside(file: string, directories: Array<string>): boolean {
  return directories.some((directory: string): boolean => {
    return path.dirname(file) === directory;
  });
}

function listTypeScriptFiles(directory: string): Array<string> {
  return fs
    .readdirSync(directory)
    .filter((name: string): boolean => {
      return name.endsWith(".ts");
    })
    .map((name: string): string => {
      return path.join(directory, name);
    })
    .sort();
}

/*
 * Every way the files in `directories` leave the closure; [] when closed.
 * The allowed outside files must themselves import nothing.
 */
function findClosureProblems(
  directories: Array<string>,
  allowedOutsideFiles: Array<string>,
): Array<string> {
  const problems: Array<string> = [];
  const files: Array<string> = [];

  for (const directory of directories) {
    files.push(...listTypeScriptFiles(directory));
  }

  files.push(...allowedOutsideFiles);

  for (const file of files) {
    const from: string = path.relative(COMMON_ROOT, file);
    const finding: ImportFinding = scanFile(file);
    const isLeaf: boolean = allowedOutsideFiles.includes(file);

    for (const name of finding.nodeGlobals) {
      problems.push(`${from} uses the Node global "${name}"`);
    }

    for (const specifier of finding.specifiers) {
      if (isLeaf) {
        problems.push(
          `${from} is a leaf the closure relies on, but imports "${specifier}"`,
        );
        continue;
      }

      if (!specifier.startsWith(".")) {
        problems.push(
          `${from} imports "${specifier}", which is not a relative import the agent can carry (a package, a Node built-in or the Common alias)`,
        );
        continue;
      }

      const resolved: string | null = resolveRelative(file, specifier);

      if (!resolved) {
        problems.push(`${from} imports "${specifier}", which does not resolve`);
        continue;
      }

      if (
        !isInside(resolved, directories) &&
        !allowedOutsideFiles.includes(resolved)
      ) {
        problems.push(
          `${from} imports "${specifier}" (${path.relative(
            COMMON_ROOT,
            resolved,
          )}), which is outside the files the resource AI agent carries`,
        );
      }
    }
  }

  return problems;
}

describe("the resource policy closure", () => {
  test("both directories exist and hold the contract files", () => {
    expect(
      listTypeScriptFiles(CLOSED_DIRECTORIES[0]!).map((file: string) => {
        return path.basename(file);
      }),
    ).toEqual(
      expect.arrayContaining(["AiResourceType.ts", "ResourceAiAccess.ts"]),
    );

    expect(
      listTypeScriptFiles(CLOSED_DIRECTORIES[1]!).map((file: string) => {
        return path.basename(file);
      }),
    ).toEqual(
      expect.arrayContaining([
        "ResourceCommandPolicyCore.ts",
        "ResourceCommandPolicy.ts",
        "ResourceOutputRedactor.ts",
        "DockerEngineCommandPolicy.ts",
        "DockerSwarmCommandPolicy.ts",
        "ProxmoxCommandPolicy.ts",
        "GovcCommandPolicy.ts",
        "CephCommandPolicy.ts",
        "DatabaseCommandPolicy.ts",
        "HostCommandPolicy.ts",
      ]),
    );
  });

  test("imports only its own files and the verdict leaf, by relative path, and no Node globals", () => {
    expect(
      findClosureProblems(CLOSED_DIRECTORIES, ALLOWED_OUTSIDE_FILES),
    ).toEqual([]);
  });

  test("AiResourceType imports nothing at all", () => {
    expect(
      scanFile(path.join(CLOSED_DIRECTORIES[0]!, "AiResourceType.ts"))
        .specifiers,
    ).toEqual([]);
  });

  test("ResourceAiAccess imports only ./AiResourceType and the AI settings contract", () => {
    expect(
      scanFile(
        path.join(CLOSED_DIRECTORIES[0]!, "ResourceAiAccess.ts"),
      ).specifiers.sort(),
    ).toEqual(["../AI/AgentAiSettings", "./AiResourceType"]);
  });

  // A leaf the closure may reach must not lead out of it.
  test("the AI settings contract imports nothing at all, and uses no Node globals", () => {
    expect(scanFile(AGENT_AI_SETTINGS_FILE)).toEqual({
      specifiers: [],
      nodeGlobals: [],
    });
  });
});

/*
 * The checker itself, against files that break each rule — so a checker
 * that silently stopped finding anything could not pass the test above.
 */
describe("the closure checker catches every way out", () => {
  const sandbox: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "resource-policy-closure-"),
  );
  const closed: string = path.join(sandbox, "Closed");
  const outside: string = path.join(sandbox, "Outside");

  fs.mkdirSync(closed);
  fs.mkdirSync(outside);
  fs.writeFileSync(
    path.join(outside, "Leaf.ts"),
    "export const LEAF: number = 1;\n",
  );
  fs.writeFileSync(
    path.join(outside, "NotCarried.ts"),
    "export const NOT_CARRIED: number = 1;\n",
  );
  fs.writeFileSync(
    path.join(closed, "Fine.ts"),
    'import { LEAF } from "../Outside/Leaf";\nimport Other from "./Other";\nexport const X: number = LEAF + Other;\nconst o: { process: number } = { process: 1 };\nexport const Y: number = o.process;\n',
  );
  fs.writeFileSync(
    path.join(closed, "Other.ts"),
    "const Other: number = 2;\nexport default Other;\n",
  );

  afterAll(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  function problemsWith(source: string): Array<string> {
    const file: string = path.join(closed, "Bad.ts");
    fs.writeFileSync(file, source);

    try {
      return findClosureProblems([closed], [path.join(outside, "Leaf.ts")]);
    } finally {
      fs.rmSync(file);
    }
  }

  test("a closed pair of files passes", () => {
    expect(
      findClosureProblems([closed], [path.join(outside, "Leaf.ts")]),
    ).toEqual([]);
  });

  test.each([
    [
      'import fs from "fs";\nexport const A: unknown = fs;\n',
      "not a relative import",
    ],
    [
      'import { readFileSync } from "node:fs";\nexport const A: unknown = readFileSync;\n',
      "not a relative import",
    ],
    [
      'import X from "Common/Types/JSON";\nexport const A: unknown = X;\n',
      "not a relative import",
    ],
    [
      'import { NOT_CARRIED } from "../Outside/NotCarried";\nexport const A: number = NOT_CARRIED;\n',
      "outside the files",
    ],
    ['export * from "../Outside/NotCarried";\n', "outside the files"],
    [
      'import Missing from "./Missing";\nexport const A: unknown = Missing;\n',
      "does not resolve",
    ],
    ["export const A: unknown = process.env;\n", 'Node global "process"'],
    ['export const A: unknown = Buffer.from("x");\n', 'Node global "Buffer"'],
    ['export const A: unknown = require("fs");\n', 'Node global "require"'],
    [
      "const process: number = 1;\nexport const A: unknown = { process };\n",
      'Node global "process"',
    ],
    ["export const A: string = __dirname;\n", 'Node global "__dirname"'],
    ['export type A = typeof import("fs");\n', "not a relative import"],
    [
      'export const A: Promise<unknown> = import("../Outside/NotCarried");\n',
      "outside the files",
    ],
  ])("%p is caught", (source: string, expected: string) => {
    const problems: Array<string> = problemsWith(source);

    expect(problems.join("\n")).toContain(expected);
  });

  test("a leaf that imports anything is caught", () => {
    const leaf: string = path.join(outside, "Leaf.ts");
    const original: string = fs.readFileSync(leaf, "utf8");

    fs.writeFileSync(leaf, `import "./NotCarried";\n${original}`);

    try {
      expect(findClosureProblems([closed], [leaf]).join("\n")).toContain(
        "is a leaf the closure relies on",
      );
    } finally {
      fs.writeFileSync(leaf, original);
    }
  });
});
