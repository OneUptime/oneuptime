import { spawnSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";

/*
 * The resource AI agent (agents/ResourceAIAgent) enforces the same resource
 * command policy as the server before it runs anything: ResourceCommandPolicy
 * tiers the argv and bounds where a write may land, the output redactor
 * masks secrets before output leaves the agent. It is a standalone package
 * with no Common dependency, so it carries BYTE-IDENTICAL copies of those
 * files under agents/ResourceAIAgent/Common/, in the same relative layout:
 * every file of Types/ResourceAiAgent and Utils/AiRemediation/Resource
 * (whole directories, so a tool module a kit adds is copied without anyone
 * touching the list), plus Types/AutoRemediation/
 * AiRemediationCommandPolicyVerdict.ts and Types/Runbook/RunnerJobOrigin.ts.
 * If a copy drifts, the two sides of the trust boundary disagree about a
 * command: the server approves what the agent refuses (every fix fails on
 * the resource), or the agent runs what the server would now refuse.
 *
 * So this fails when:
 *   - a copy is missing or differs from its source (run
 *     `npm run sync-common` in agents/ResourceAIAgent);
 *   - the agent carries a copy whose source is gone;
 *   - the copied closure starts importing a file that is not copied, or
 *     anything that is not a relative import — a package, or the
 *     "Common/..." alias, which the agent cannot resolve;
 *   - the agent imports a Common file that is not in the copied set;
 *   - Scripts/SyncCommon.js and this test disagree about the set.
 *
 * Files (and the copy list) are read with fs, never required: Common's jest
 * config maps any specifier containing "Common/" to this package, which
 * would silently compare a file with itself.
 */

const REPO_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..", "..");
const COMMON_ROOT: string = path.join(REPO_ROOT, "packages", "Common");
const AGENT_ROOT: string = path.join(REPO_ROOT, "agents", "ResourceAIAgent");
const AGENT_COMMON_ROOT: string = path.join(AGENT_ROOT, "Common");
// The list Scripts/SyncCommon.js (npm run sync-common) copies from.
const COPY_LIST: string = path.join(AGENT_ROOT, "Scripts", "CommonCopies.json");
const SYNC_SCRIPT: string = path.join(AGENT_ROOT, "Scripts", "SyncCommon.js");

interface CopyList {
  commonPolicyDirectories: Array<string>;
  commonPolicyFiles: Array<string>;
  otherCopies: Array<{ source: string; target: string }>;
}

const copyList: CopyList = JSON.parse(
  fs.readFileSync(COPY_LIST, "utf8"),
) as CopyList;

// Every regular file under dir (dotfiles skipped), "/"-separated, sorted.
function listFilesRecursively(dir: string): Array<string> {
  const files: Array<string> = [];

  const walk: (current: string, prefix: string) => void = (
    current: string,
    prefix: string,
  ): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      const relative: string = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), relative);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  };

  walk(dir, "");
  return files.sort();
}

// The Common-relative paths the list names: whole directories, then files.
function listCopied(root: string, list: CopyList): Array<string> {
  const copied: Set<string> = new Set<string>();

  for (const directory of list.commonPolicyDirectories) {
    for (const file of listFilesRecursively(path.join(root, directory))) {
      copied.add(`${directory}/${file}`);
    }
  }

  for (const file of list.commonPolicyFiles) {
    copied.add(file);
  }

  return Array.from(copied).sort();
}

const COPIED: Array<string> = listCopied(COMMON_ROOT, copyList);

// Every module specifier a TypeScript file imports or re-exports.
function getImportSpecifiers(file: string): Array<string> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: Array<string> = [];

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
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return specifiers;
}

// A relative specifier resolved to a .ts file, or null when none exists.
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

/*
 * Walk the import graph from these Common files; returns every file reached
 * (Common-relative) and every import that leaves the closure.
 */
function walkClosure(
  entries: Array<string>,
  root: string = COMMON_ROOT,
): {
  files: Array<string>;
  problems: Array<string>;
} {
  const seen: Set<string> = new Set<string>();
  const problems: Array<string> = [];
  const stack: Array<string> = entries.map((relative: string): string => {
    return path.join(root, relative);
  });

  while (stack.length > 0) {
    const file: string = stack.pop()!;

    if (seen.has(file)) {
      continue;
    }
    seen.add(file);

    for (const specifier of getImportSpecifiers(file)) {
      const from: string = path.relative(root, file);

      if (!specifier.startsWith(".")) {
        problems.push(
          `${from} imports "${specifier}", which is not a relative import the agent can carry`,
        );
        continue;
      }

      const resolved: string | null = resolveRelative(file, specifier);

      if (!resolved) {
        problems.push(`${from} imports "${specifier}", which does not resolve`);
        continue;
      }

      if (!resolved.startsWith(`${root}${path.sep}`)) {
        problems.push(
          `${from} imports "${specifier}", outside packages/Common`,
        );
        continue;
      }

      stack.push(resolved);
    }
  }

  return {
    files: Array.from(seen)
      .map((file: string): string => {
        return path.relative(root, file).split(path.sep).join("/");
      })
      .sort(),
    problems,
  };
}

// The agent's own sources (everything but the copies, builds and deps).
function listAgentSources(dir: string = AGENT_ROOT): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (
        ["node_modules", "build", "Common"].includes(entry.name) &&
        dir === AGENT_ROOT
      ) {
        continue;
      }
      files.push(...listAgentSources(full));
    } else if (entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }

  return files;
}

// The copied Common files the agent's own sources import directly.
function getAgentEntryPoints(): Array<string> {
  const entries: Set<string> = new Set<string>();

  for (const file of listAgentSources()) {
    for (const specifier of getImportSpecifiers(file)) {
      if (!specifier.startsWith(".")) {
        continue;
      }

      const target: string = path.resolve(path.dirname(file), specifier);

      if (target.startsWith(`${AGENT_COMMON_ROOT}${path.sep}`)) {
        entries.add(
          path
            .relative(AGENT_COMMON_ROOT, `${target}.ts`)
            .split(path.sep)
            .join("/"),
        );
      }
    }
  }

  return Array.from(entries).sort();
}

describe("Resource AI agent: copies of the resource command policy closure", () => {
  test("the list copies both policy directories whole, and the three leaf files", () => {
    expect(copyList.commonPolicyDirectories).toEqual([
      "Types/ResourceAiAgent",
      "Utils/AiRemediation/Resource",
    ]);
    // AgentAiSettings: what AI may do, which ResourceAiAccess reads.
    expect(copyList.commonPolicyFiles).toEqual([
      "Types/AI/AgentAiSettings.ts",
      "Types/AutoRemediation/AiRemediationCommandPolicyVerdict.ts",
      "Types/Runbook/RunnerJobOrigin.ts",
    ]);
    expect(copyList.otherCopies).toEqual([]);
  });

  test("the copied set holds the contracts, the policy and everything they import", () => {
    expect(COPIED).toEqual(
      expect.arrayContaining([
        "Types/ResourceAiAgent/AiResourceType.ts",
        "Types/ResourceAiAgent/ResourceAiAccess.ts",
        "Utils/AiRemediation/Resource/ResourceCommandPolicy.ts",
        "Utils/AiRemediation/Resource/ResourceCommandPolicyCore.ts",
        "Utils/AiRemediation/Resource/ResourceOutputRedactor.ts",
        "Types/AutoRemediation/AiRemediationCommandPolicyVerdict.ts",
        "Types/Runbook/RunnerJobOrigin.ts",
      ]),
    );

    // Every source file directly in either directory is in it.
    for (const directory of copyList.commonPolicyDirectories) {
      for (const entry of fs.readdirSync(path.join(COMMON_ROOT, directory), {
        withFileTypes: true,
      })) {
        if (entry.isFile() && !entry.name.startsWith(".")) {
          const file: string = `${directory}/${entry.name}`;
          expect({ file, copied: COPIED.includes(file) }).toEqual({
            file,
            copied: true,
          });
        }
      }
    }
  });

  test.each(COPIED)(
    "Common/%s is byte-identical to its source",
    (relative: string) => {
      const source: Buffer = fs.readFileSync(path.join(COMMON_ROOT, relative));
      const copyPath: string = path.join(AGENT_COMMON_ROOT, relative);

      expect({ relative, copied: fs.existsSync(copyPath) }).toEqual({
        relative,
        copied: true,
      });
      expect({
        relative,
        identical: source.equals(fs.readFileSync(copyPath)),
      }).toEqual({
        relative,
        identical: true,
      });
    },
  );

  test("the closure imports nothing outside the copied set", () => {
    const closure: { files: Array<string>; problems: Array<string> } =
      walkClosure(COPIED);

    expect(closure.problems).toEqual([]);
    expect(closure.files).toEqual(COPIED);
  });

  test("the agent imports only copied files, and uses both leaf files", () => {
    const entries: Array<string> = getAgentEntryPoints();

    // Imported directly by the agent...
    for (const entry of entries) {
      expect({ entry, copied: COPIED.includes(entry) }).toEqual({
        entry,
        copied: true,
      });
    }

    // ...everything they reach is copied...
    const reached: Array<string> = walkClosure(entries).files;
    for (const file of reached) {
      expect({ file, copied: COPIED.includes(file) }).toEqual({
        file,
        copied: true,
      });
    }

    // ...and the single files are copied because the agent needs them.
    for (const file of copyList.commonPolicyFiles) {
      expect({ file, used: reached.includes(file) }).toEqual({
        file,
        used: true,
      });
    }

    // The policy itself is what the agent enforces.
    expect(entries).toEqual(
      expect.arrayContaining([
        "Utils/AiRemediation/Resource/ResourceCommandPolicy.ts",
        "Utils/AiRemediation/Resource/ResourceOutputRedactor.ts",
        "Types/Runbook/RunnerJobOrigin.ts",
      ]),
    );
  });

  test("the agent directory holds no stray copies", () => {
    expect(listFilesRecursively(AGENT_COMMON_ROOT)).toEqual(COPIED);
  });

  test("Scripts/SyncCommon.js copies exactly this set", () => {
    const run: SpawnSyncReturns<string> = spawnSync(
      process.execPath,
      [SYNC_SCRIPT, "--list"],
      { encoding: "utf8" },
    );

    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual(COPIED);
  });

  describe("the checks themselves", () => {
    test("a new file in a listed directory is part of the copied set", () => {
      const scratch: string = fs.mkdtempSync(path.join(os.tmpdir(), "parity-"));

      try {
        fs.mkdirSync(path.join(scratch, "Dir", "Nested"), { recursive: true });
        fs.writeFileSync(path.join(scratch, "Dir", "A.ts"), "a");
        fs.writeFileSync(path.join(scratch, "Dir", "Nested", "B.ts"), "b");
        fs.writeFileSync(path.join(scratch, "Dir", ".DS_Store"), "junk");
        fs.writeFileSync(path.join(scratch, "Leaf.ts"), "leaf");

        expect(
          listCopied(scratch, {
            commonPolicyDirectories: ["Dir"],
            commonPolicyFiles: ["Leaf.ts"],
            otherCopies: [],
          }),
        ).toEqual(["Dir/A.ts", "Dir/Nested/B.ts", "Leaf.ts"]);
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
      }
    });

    test("imports that leave the closure are reported", () => {
      const scratch: string = fs.mkdtempSync(path.join(os.tmpdir(), "parity-"));
      const root: string = path.join(scratch, "Common");

      try {
        fs.mkdirSync(root);
        fs.writeFileSync(
          path.join(scratch, "Outside.ts"),
          "export default 1;\n",
        );
        fs.writeFileSync(path.join(root, "Inside.ts"), "export default 2;\n");
        fs.writeFileSync(
          path.join(root, "Leaf.ts"),
          [
            'import x from "lodash";',
            'import y from "./Missing";',
            'import z from "Common/Types/JSON";',
            'import o from "../Outside";',
            'import i from "./Inside";',
            "export default [x, y, z, o, i];",
            "",
          ].join("\n"),
        );

        const closure: { files: Array<string>; problems: Array<string> } =
          walkClosure(["Leaf.ts"], root);

        expect(closure.files).toEqual(["Inside.ts", "Leaf.ts"]);
        expect(closure.problems).toHaveLength(4);
        expect(closure.problems[0]).toMatch(
          /imports "lodash", which is not a relative import/,
        );
        expect(closure.problems[1]).toMatch(
          /"\.\/Missing", which does not resolve/,
        );
        expect(closure.problems[2]).toMatch(/imports "Common\/Types\/JSON"/);
        expect(closure.problems[3]).toMatch(
          /"\.\.\/Outside", outside packages\/Common/,
        );
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
      }
    });

    test("import specifiers are found in every form", () => {
      const scratch: string = fs.mkdtempSync(path.join(os.tmpdir(), "parity-"));

      try {
        const file: string = path.join(scratch, "Forms.ts");
        fs.writeFileSync(
          file,
          [
            'import a from "./a";',
            'import type { B } from "./b";',
            'export { c } from "./c";',
            'export * from "./d";',
            'const e = require("./e");',
            'const f = import("./f");',
            "",
          ].join("\n"),
        );

        expect(getImportSpecifiers(file)).toEqual([
          "./a",
          "./b",
          "./c",
          "./d",
          "./e",
          "./f",
        ]);
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
      }
    });
  });
});
