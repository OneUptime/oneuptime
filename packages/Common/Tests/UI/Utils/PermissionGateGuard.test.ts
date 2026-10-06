import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The dashboard decides what the signed-in user may do by the rule the
 * server follows (Types/HeldPermissions): an allow row grants and a block
 * row never does, a block with no labels on any permission an action accepts
 * refuses it, and an operational resource's own permission list accepts its
 * *AllOperationalResources wildcard. PermissionGate is where the dashboard
 * asks it (check, holdsAnyOf, holdsColumnPermission, canReadColumn), reading
 * the permission snapshot through PermissionUtil.
 *
 * A gate that read the snapshot itself - the raw rows, or a flat list of
 * permission names - counted a team's block row as a grant, or missed the
 * wildcard, and offered a button the server refused (or hid one it allowed).
 * Read from source, through the TypeScript syntax tree, across every
 * frontend:
 *
 *   1. PermissionUtil's readers (getAllPermissions, getProjectPermissions,
 *      getGlobalPermissions, getHeldPermissions) are called only in the
 *      files listed in SNAPSHOT_READERS.
 *   2. Nothing calls a model's flat checks (hasCreatePermissions,
 *      hasReadPermissions, hasUpdatePermissions, hasDeletePermissions) or
 *      PermissionHelper.doesPermissionsIntersect: they compare a list of
 *      names, with no blocks and no wildcard.
 *
 * The list only shrinks: an entry whose file no longer reads the snapshot
 * fails the guard until the entry goes.
 */

// packages/Common/Tests/UI/Utils -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

// Every frontend. ee/ is scanned when it is checked out (CI's Common job runs without it).
const SCANNED_ROOTS: Array<string> = [
  "packages/App/FeatureSet/Dashboard/src",
  "packages/Common/UI",
  "packages/App/FeatureSet/AdminDashboard/src",
  "packages/App/FeatureSet/StatusPage/src",
  "packages/App/FeatureSet/PublicDashboard/src",
  "packages/App/FeatureSet/Accounts/src",
  "ee/Dashboard",
  "ee/AdminDashboard",
];

// The module whose readers are guarded: Common/UI/Utils/Permission.
const PERMISSION_UTIL_FILE: string = "packages/Common/UI/Utils/Permission";

const SNAPSHOT_READS: ReadonlySet<string> = new Set<string>([
  "getAllPermissions",
  "getProjectPermissions",
  "getGlobalPermissions",
  "getHeldPermissions",
]);

const FLAT_CHECKS: ReadonlySet<string> = new Set<string>([
  "hasCreatePermissions",
  "hasReadPermissions",
  "hasUpdatePermissions",
  "hasDeletePermissions",
  "doesPermissionsIntersect",
]);

// The files that read the snapshot, and why.
const SNAPSHOT_READERS: Record<string, string> = {
  "packages/Common/UI/Utils/PermissionGate.ts":
    "The dashboard's one reader of the snapshot for 'may the user do this?': it hands it to HeldPermissionsUtil.",
  "packages/Common/UI/Utils/GrantablePermission.ts":
    "The grant ceiling's mirror: what the user may hand on to a team or an API key, which is stricter than holding it (TeamPermissionService.assertCanGrantPermission).",
};

// A file that may import PermissionUtil: no other needs a parse.
const IMPORTS_PERMISSION_UTIL: RegExp = /Utils\/Permission"|\.\/Permission"/;

// A file that may call a flat check: no other needs a parse.
const MAY_CALL_A_FLAT_CHECK: RegExp = /Permissions\(|doesPermissionsIntersect/;

function listSourceFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return found;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "build" ||
        entry.name === "dist" ||
        entry.name === "Tests"
      ) {
        continue;
      }

      found.push(...listSourceFiles(full));
      continue;
    }

    if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      found.push(full);
    }
  }

  return found;
}

function toRepositoryPath(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

interface Finding {
  file: string;
  line: number;
  text: string;
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function visit(node: ts.Node, onNode: (node: ts.Node) => void): void {
  onNode(node);
  ts.forEachChild(node, (child: ts.Node) => {
    visit(child, onNode);
  });
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

/*
 * The repository path an import specifier points at, without its
 * extension: "Common/..." is packages/Common, a relative one is resolved
 * against the importing file.
 */
function resolveSpecifier(file: string, specifier: string): string | null {
  if (specifier.startsWith("Common/")) {
    return `packages/${specifier}`;
  }

  if (specifier.startsWith(".")) {
    return path.posix.normalize(
      path.posix.join(path.posix.dirname(file), specifier),
    );
  }

  return null;
}

// The local names this file gives PermissionUtil's default export.
function getPermissionUtilNames(
  file: string,
  sourceFile: ts.SourceFile,
): Set<string> {
  const names: Set<string> = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause?.name
    ) {
      continue;
    }

    const target: string | null = resolveSpecifier(
      file,
      statement.moduleSpecifier.text,
    );

    if (target === PERMISSION_UTIL_FILE) {
      names.add(statement.importClause.name.text);
    }
  }

  return names;
}

// Every call of a PermissionUtil reader.
function findSnapshotReads(file: string, text: string): Array<Finding> {
  if (!IMPORTS_PERMISSION_UTIL.test(text)) {
    return [];
  }

  const sourceFile: ts.SourceFile = parse(file, text);
  const names: Set<string> = getPermissionUtilNames(file, sourceFile);

  if (names.size === 0) {
    return [];
  }

  const findings: Array<Finding> = [];

  visit(sourceFile, (node: ts.Node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      SNAPSHOT_READS.has(node.name.text) &&
      ts.isIdentifier(node.expression) &&
      names.has(node.expression.text)
    ) {
      findings.push({
        file: file,
        line: lineOf(sourceFile, node),
        text: node.getText(sourceFile),
      });
    }
  });

  return findings;
}

// Every call of a flat permission check.
function findFlatChecks(file: string, text: string): Array<Finding> {
  if (!MAY_CALL_A_FLAT_CHECK.test(text)) {
    return [];
  }

  const sourceFile: ts.SourceFile = parse(file, text);
  const findings: Array<Finding> = [];

  visit(sourceFile, (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      FLAT_CHECKS.has(node.expression.name.text)
    ) {
      findings.push({
        file: file,
        line: lineOf(sourceFile, node),
        text: node.expression.getText(sourceFile),
      });
    }
  });

  return findings;
}

interface ScannedSource {
  file: string;
  text: string;
}

const SOURCES: Array<ScannedSource> = SCANNED_ROOTS.flatMap(
  (root: string): Array<ScannedSource> => {
    return listSourceFiles(path.join(REPOSITORY_ROOT, root)).map(
      (file: string): ScannedSource => {
        return {
          file: toRepositoryPath(file),
          text: fs.readFileSync(file, "utf8"),
        };
      },
    );
  },
);

function describeFindings(findings: Array<Finding>): Array<string> {
  return findings.map((finding: Finding): string => {
    return `${finding.file}:${finding.line} ${finding.text}`;
  });
}

describe("PermissionGateGuard: the detector", () => {
  test("flags a page that reads the snapshot itself", () => {
    const findings: Array<Finding> = findSnapshotReads(
      "packages/App/FeatureSet/Dashboard/src/Pages/Example.tsx",
      `import PermissionUtil from "Common/UI/Utils/Permission";
      const canEdit: boolean = PermissionUtil.getAllPermissions().includes(Permission.ProjectOwner);
      const rows = PermissionUtil.getProjectPermissions()?.permissions || [];`,
    );

    expect(
      findings.map((finding: Finding) => {
        return finding.text;
      }),
    ).toEqual([
      "PermissionUtil.getAllPermissions",
      "PermissionUtil.getProjectPermissions",
    ]);
  });

  test("follows the import, whatever it is called", () => {
    expect(
      findSnapshotReads(
        "packages/Common/UI/Components/Example/Example.tsx",
        `import Snapshot from "../../Utils/Permission";
        const held = Snapshot.getHeldPermissions();`,
      ),
    ).toHaveLength(1);
  });

  test("leaves PermissionGate and PermissionUtil's writers alone", () => {
    expect(
      findSnapshotReads(
        "packages/App/FeatureSet/Dashboard/src/Pages/Example.tsx",
        `import PermissionUtil from "Common/UI/Utils/Permission";
        import PermissionGate from "Common/UI/Utils/PermissionGate";
        PermissionUtil.clearProjectPermissions();
        const held = PermissionGate.getHeldPermissions();`,
      ),
    ).toEqual([]);
  });

  test("flags a flat check of a list of names", () => {
    expect(
      findFlatChecks(
        "Example.tsx",
        `const canDelete: boolean = model.hasDeletePermissions(permissions);
        const canRead: boolean = PermissionHelper.doesPermissionsIntersect(permissions, list);`,
      ),
    ).toHaveLength(2);
  });
});

describe("PermissionGateGuard: the frontends", () => {
  test("scans the frontends' source", () => {
    const files: Array<string> = SOURCES.map((source: ScannedSource) => {
      return source.file;
    });

    expect(files).toContain("packages/Common/UI/Utils/PermissionGate.ts");
    expect(files).toContain(
      "packages/Common/UI/Components/ModelTable/BaseModelTable.tsx",
    );
    expect(files).toContain(
      "packages/App/FeatureSet/Dashboard/src/Components/Workspace/TestRuleLock.ts",
    );
    expect(files.length).toBeGreaterThan(1000);
  });

  test("reads the permission snapshot only through PermissionGate", () => {
    const findings: Array<Finding> = SOURCES.flatMap(
      (source: ScannedSource): Array<Finding> => {
        if (SNAPSHOT_READERS[source.file]) {
          return [];
        }

        return findSnapshotReads(source.file, source.text);
      },
    );

    expect(describeFindings(findings)).toEqual([]);
  });

  test("every listed snapshot reader still reads it", () => {
    const stale: Array<string> = Object.keys(SNAPSHOT_READERS).filter(
      (file: string): boolean => {
        const source: ScannedSource | undefined = SOURCES.find(
          (candidate: ScannedSource) => {
            return candidate.file === file;
          },
        );

        return (
          !source || findSnapshotReads(source.file, source.text).length === 0
        );
      },
    );

    expect(stale).toEqual([]);
  });

  test("never compares a flat list of permission names", () => {
    const findings: Array<Finding> = SOURCES.flatMap(
      (source: ScannedSource): Array<Finding> => {
        return findFlatChecks(source.file, source.text);
      },
    );

    expect(describeFindings(findings)).toEqual([]);
  });

  test("every listed file says why", () => {
    for (const reason of Object.values(SNAPSHOT_READERS)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});
