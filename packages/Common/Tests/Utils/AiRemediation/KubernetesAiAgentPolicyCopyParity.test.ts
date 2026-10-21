import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";

/*
 * The Kubernetes AI agent (agents/KubernetesAIAgent) enforces the same
 * kubectl rules as the server before it spawns anything: KubectlPolicy tiers
 * the argv, KubectlWriteScope bounds where a write may land. It is a
 * standalone package with no Common dependency, so it carries BYTE-IDENTICAL
 * copies of those files (and everything they import) under
 * agents/KubernetesAIAgent/Common/, in the same relative layout — plus the
 * Runner's KubectlArgvGuard. If a copy drifts, the two sides of the trust
 * boundary disagree about a command: the server approves what the agent
 * refuses (every fix fails in the cluster), or the agent runs what the
 * server would now refuse.
 *
 * So this fails when:
 *   - a copy differs from its source (run `npm run sync-common` in
 *     agents/KubernetesAIAgent);
 *   - the policy closure starts importing a file that is not copied (add it
 *     to agents/KubernetesAIAgent/Scripts/CommonCopies.json and sync), or
 *     anything that is not a relative import — a package, or the
 *     "Common/..." alias, which the agent cannot resolve;
 *   - the agent imports a Common file that is not in the copied set, or the
 *     set carries a copy nothing uses.
 *
 * Files (and the copy list) are read with fs, never required: Common's jest
 * config maps any specifier containing "Common/" to this package, which
 * would silently compare a file with itself.
 */

const REPO_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..", "..");
const COMMON_ROOT: string = path.join(REPO_ROOT, "packages", "Common");
const AGENT_ROOT: string = path.join(REPO_ROOT, "agents", "KubernetesAIAgent");
const AGENT_COMMON_ROOT: string = path.join(AGENT_ROOT, "Common");
// The list Scripts/SyncCommon.js (npm run sync-common) copies from.
const COPY_LIST: string = path.join(AGENT_ROOT, "Scripts", "CommonCopies.json");

interface CopyList {
  commonPolicyFiles: Array<string>;
  otherCopies: Array<{ source: string; target: string }>;
}

const copyList: CopyList = JSON.parse(
  fs.readFileSync(COPY_LIST, "utf8"),
) as CopyList;

const COPIED: Array<string> = [...copyList.commonPolicyFiles].sort();

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

describe("Kubernetes AI agent: copies of the kubectl policy closure", () => {
  test("the copied set is the policy and everything it imports", () => {
    expect(COPIED).toEqual(
      expect.arrayContaining([
        "Utils/AiRemediation/KubectlPolicy.ts",
        "Utils/AiRemediation/KubectlWriteScope.ts",
        "Utils/AiRemediation/CommandPolicy.ts",
        "Types/Kubernetes/KubernetesClusterAiAccess.ts",
        "Types/AutoRemediation/AiRemediationCommandPolicyVerdict.ts",
      ]),
    );
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

  test.each(
    copyList.otherCopies.map((copy: { source: string; target: string }) => {
      return [copy.target, copy.source];
    }),
  )("%s is byte-identical to %s", (target: string, source: string) => {
    expect(
      fs
        .readFileSync(path.join(REPO_ROOT, source))
        .equals(fs.readFileSync(path.join(AGENT_ROOT, target))),
    ).toBe(true);
  });

  test("the argv guard is among the verbatim copies", () => {
    expect(copyList.otherCopies).toContainEqual({
      source: "packages/Runner/Utils/KubectlArgvGuard.ts",
      target: "KubectlArgvGuard.ts",
    });
  });

  test("the closure imports nothing outside the copied set", () => {
    const closure: { files: Array<string>; problems: Array<string> } =
      walkClosure(COPIED);

    expect(closure.problems).toEqual([]);
    expect(closure.files).toEqual(COPIED);
  });

  test("the agent imports only copied files, and every copy is used", () => {
    const entries: Array<string> = getAgentEntryPoints();

    // Imported directly by the agent...
    for (const entry of entries) {
      expect({ entry, copied: COPIED.includes(entry) }).toEqual({
        entry,
        copied: true,
      });
    }

    // ...and nothing copied that neither the agent nor the closure needs.
    expect(walkClosure(entries).files).toEqual(COPIED);
  });

  test("the agent directory holds no stray copies", () => {
    const present: Array<string> = [];
    const walk: (dir: string) => void = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full: string = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          present.push(
            path.relative(AGENT_COMMON_ROOT, full).split(path.sep).join("/"),
          );
        }
      }
    };
    walk(AGENT_COMMON_ROOT);

    expect(present.sort()).toEqual(COPIED);
  });

  describe("the checks themselves", () => {
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
