import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Whether a caller holds a permission is decided by one rule
 * (Types/HeldPermissions): an allow row grants and a block row never does, a
 * block with no labels on any permission an action accepts refuses it, a
 * block with labels restricts only the records carrying them, and an
 * operational resource's own permission list accepts its
 * *AllOperationalResources wildcard. On the server a caller's rows reach that
 * rule through Server/Utils/Permission/CallerPermission (route guards, and
 * every other check that looks at no record) or through
 * DatabaseCommonInteractionPropsUtil.getUserPermissions (the CRUD path).
 *
 * This guard keeps it that way, reading the server's source through the
 * TypeScript syntax tree:
 *
 *   1. A caller's rows - the `permissions` of a UserTenantAccessPermission,
 *      reached through `userTenantAccessPermission` or held in a variable or
 *      parameter typed as one - are read only to hand them to the rule
 *      (`HeldPermissionsUtil.fromRows({ rows: ... })`), or in a file listed
 *      in ROW_READERS.
 *   2. DatabaseCommonInteractionPropsUtil.getUserPermissions, and
 *      getPermissionRows (both kinds of row together), are called only in a
 *      file listed in USER_PERMISSIONS_CALLERS.
 *
 * Both lists only shrink: an entry whose file no longer does what it is
 * listed for fails the guard until the entry goes.
 */

// packages/Common/Tests/Server/Utils/Permission -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

// Server code. ee/ is scanned when it is checked out (CI's Common job runs without it).
const SCANNED_ROOTS: Array<string> = [
  "packages/Common/Server",
  "packages/Common/Types",
  "packages/Common/Utils",
  "packages/App/API",
  "packages/App/Services",
  "packages/App/Utils",
  "packages/App/FeatureSet/APIReference",
  "packages/App/FeatureSet/BaseAPI",
  "packages/App/FeatureSet/Docs",
  "packages/App/FeatureSet/Frontend",
  "packages/App/FeatureSet/Identity",
  "packages/App/FeatureSet/MCP",
  "packages/App/FeatureSet/Notification",
  "packages/App/FeatureSet/Runbook",
  "packages/App/FeatureSet/Telemetry",
  "packages/App/FeatureSet/Workers",
  "packages/App/FeatureSet/Workflow",
  "ee/Server",
];

/*
 * The files that read a caller's rows other than to hand them to the rule,
 * and why. Every one of them builds or carries the rows; none decides from
 * them.
 */
const ROW_READERS: Record<string, string> = {
  "packages/Common/Server/Utils/Permission/CallerPermission.ts":
    "The server's one reader of a caller's rows for checks that look at no record: it hands them to HeldPermissionsUtil.",
  "packages/Common/Types/BaseDatabase/DatabaseCommonInteractionPropsUtil.ts":
    "The CRUD path's reader: it splits the rows into allows and blocks by HeldPermissionsUtil.isBlockRow.",
  "packages/Common/Server/Services/AccessTokenService.ts":
    "Builds the rows a member's requests carry, from their teams' permissions.",
  "packages/Common/Server/Utils/APIKey/AccessPermission.ts":
    "Builds the rows an API key's requests carry, from the key's permissions.",
  "packages/Common/Server/Utils/UserPermission/UserPermission.ts":
    "Caches the rows and adds the Project User row every member holds.",
};

/*
 * The files that call DatabaseCommonInteractionPropsUtil.getUserPermissions
 * or getPermissionRows, and why.
 */
const USER_PERMISSIONS_CALLERS: Record<string, string> = {
  "packages/Common/Types/BaseDatabase/DatabaseCommonInteractionPropsUtil.ts":
    "getPermissionRows: the allow and block rows of getUserPermissions together, for the rule.",
  "packages/Common/Server/Types/Database/Permissions/TablePermission.ts":
    "The CRUD table check: hands the rows to HeldPermissionsUtil and refuses a block with no labels in a step of its own.",
  "packages/Common/Server/Types/Database/Permissions/ColumnPermission.ts":
    "The CRUD column check: hands the rows to HeldPermissionsUtil (getColumnCheckRows).",
  "packages/Common/Server/Types/Database/Permissions/AccessControlPermission.ts":
    "Turns a block with labels into a filter on the records' labels.",
  "packages/Common/Server/Types/Database/Permissions/ReadPermission.ts":
    "The same filter for a read: records carrying a blocked label are left out.",
  "packages/Common/Server/Types/Database/Permissions/OwnedScopePermission.ts":
    "How far a grant the table check let through reaches (Owned scope); it decides no grant.",
  "packages/Common/Server/Types/Database/Permissions/TenantPermission.ts":
    "Whether only Current User lets the caller in, to scope the query to their own rows; a blocked permission is refused by the table check first.",
  "packages/Common/Server/Types/AnalyticsDatabase/ModelPermission.ts":
    "The analytics twin of the CRUD path: hands the rows to HeldPermissionsUtil, and scopes them like the database models.",
  "packages/Common/Server/Services/TeamPermissionService.ts":
    "The grant ceiling: what a caller may hand on to a team, which is stricter than holding it.",
  "packages/Common/Server/Services/ApiKeyPermissionService.ts":
    "The grant ceiling for an API key's permissions.",
  "packages/Common/Server/Services/OnCallDutyPolicyChildService.ts":
    "Builds the props a create runs with from the caller's rows for the table's create permissions, blocks kept; the CRUD path decides.",
  "packages/Common/Server/API/TelemetryAPI.ts":
    "Session replay's label scope, read after the route guard (the rule) let the caller in.",
  "packages/App/FeatureSet/Workflow/Utils/WorkflowRunAccess.ts":
    "Builds the props a manual run reads the workflow with from the caller's Workflow Member rows alone, blocks kept, after the rule let them in; the CRUD path decides what the rows reach.",
};

// A type that is, or holds, a caller's rows.
const ROWS_TYPE: RegExp = /\bUserTenantAccessPermission\b/;

// An expression that reaches a caller's rows through the request or the props.
const ROWS_ON_REQUEST: RegExp = /\buserTenantAccessPermission\b/;

// The rule's own entry point for rows.
const HANDED_TO_THE_RULE: RegExp = /\bHeldPermissionsUtil\.fromRows$/;

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

// The names this file declares with a UserTenantAccessPermission type.
function getRowCarrierNames(sourceFile: ts.SourceFile): Set<string> {
  const names: Set<string> = new Set<string>();

  visit(sourceFile, (node: ts.Node) => {
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
      node.type &&
      ts.isIdentifier(node.name) &&
      ROWS_TYPE.test(node.type.getText(sourceFile))
    ) {
      names.add(node.name.text);
    }
  });

  return names;
}

// `a`, `a!` and `(a)` all name `a`.
function getIdentifierName(expression: ts.Expression): string | null {
  let current: ts.Expression = expression;

  while (
    ts.isNonNullExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }

  return ts.isIdentifier(current) ? current.text : null;
}

/*
 * Whether a read of the rows hands them straight to the rule:
 * `HeldPermissionsUtil.fromRows({ rows: <read> })`, through `||`, `??`, a
 * non-null assertion or parentheses.
 */
function isHandedToTheRule(read: ts.Node): boolean {
  let current: ts.Node = read;

  while (
    current.parent &&
    (ts.isParenthesizedExpression(current.parent) ||
      ts.isNonNullExpression(current.parent) ||
      (ts.isBinaryExpression(current.parent) &&
        (current.parent.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          current.parent.operatorToken.kind ===
            ts.SyntaxKind.QuestionQuestionToken)))
  ) {
    current = current.parent;
  }

  const assignment: ts.Node | undefined = current.parent;

  if (
    !assignment ||
    !ts.isPropertyAssignment(assignment) ||
    assignment.name.getText() !== "rows"
  ) {
    return false;
  }

  const objectLiteral: ts.Node | undefined = assignment.parent;
  const call: ts.Node | undefined = objectLiteral?.parent;

  return Boolean(
    objectLiteral &&
      ts.isObjectLiteralExpression(objectLiteral) &&
      call &&
      ts.isCallExpression(call) &&
      HANDED_TO_THE_RULE.test(call.expression.getText()),
  );
}

// Every read of a caller's rows that does not hand them to the rule.
function findRowReads(file: string, text: string): Array<Finding> {
  if (!text.includes("permissions")) {
    return [];
  }

  const sourceFile: ts.SourceFile = parse(file, text);
  const carriers: Set<string> = getRowCarrierNames(sourceFile);
  const findings: Array<Finding> = [];

  visit(sourceFile, (node: ts.Node) => {
    if (
      !ts.isPropertyAccessExpression(node) ||
      node.name.text !== "permissions"
    ) {
      return;
    }

    const receiverText: string = node.expression.getText(sourceFile);
    const receiverName: string | null = getIdentifierName(node.expression);

    const readsRows: boolean =
      ROWS_ON_REQUEST.test(receiverText) ||
      Boolean(receiverName && carriers.has(receiverName));

    if (!readsRows || isHandedToTheRule(node)) {
      return;
    }

    // Writing the rows is building them, not reading them.
    if (
      node.parent &&
      ts.isBinaryExpression(node.parent) &&
      node.parent.left === node &&
      node.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      return;
    }

    findings.push({
      file: file,
      line: lineOf(sourceFile, node),
      text: node.getText(sourceFile),
    });
  });

  return findings;
}

// The CRUD path's row readers: either kind of row, or both together.
const ROW_READER_METHODS: ReadonlyArray<string> = [
  "getUserPermissions",
  "getPermissionRows",
];

// Every call of DatabaseCommonInteractionPropsUtil's row readers.
function findUserPermissionsCalls(file: string, text: string): Array<Finding> {
  if (
    !ROW_READER_METHODS.some((method: string): boolean => {
      return text.includes(method);
    })
  ) {
    return [];
  }

  const sourceFile: ts.SourceFile = parse(file, text);
  const findings: Array<Finding> = [];

  visit(sourceFile, (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ROW_READER_METHODS.includes(node.expression.name.text) &&
      node.expression.expression.getText(sourceFile) ===
        "DatabaseCommonInteractionPropsUtil"
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

describe("CallerPermissionGuard: the detector", () => {
  test("flags a route that decides from the request's rows", () => {
    const findings: Array<Finding> = findRowReads(
      "Example.ts",
      `const allowed: boolean = (req.userTenantAccessPermission?.[projectId]?.permissions || []).some((row) => {
        return row.permission === Permission.ProjectOwner;
      });`,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]!.text).toContain("userTenantAccessPermission");
  });

  test("flags a variable typed as a caller's rows", () => {
    const findings: Array<Finding> = findRowReads(
      "Example.ts",
      `async function check(): Promise<boolean> {
        const tenantPermission: UserTenantAccessPermission | null = await load();
        return tenantPermission!.permissions.some((row) => {
          return row.isBlockPermission;
        });
      }`,
    );

    expect(
      findings.map((finding: Finding) => {
        return finding.text;
      }),
    ).toEqual(["tenantPermission!.permissions"]);
  });

  test("leaves rows handed straight to the rule alone", () => {
    expect(
      findRowReads(
        "Example.ts",
        `const held = HeldPermissionsUtil.fromRows({
          rows: req.userTenantAccessPermission?.[projectId]?.permissions || [],
        });
        function f(snapshot: UserTenantAccessPermission): HeldPermissions {
          return HeldPermissionsUtil.fromRows({ rows: snapshot.permissions });
        }`,
      ),
    ).toEqual([]);
  });

  test("leaves writes and other objects' permissions alone", () => {
    expect(
      findRowReads(
        "Example.ts",
        `function build(snapshot: UserTenantAccessPermission): void {
          snapshot.permissions = [];
        }
        const listed: Array<Permission> = model.permissions;`,
      ),
    ).toEqual([]);
  });

  test("finds the CRUD path's row readers by their calls", () => {
    expect(
      findUserPermissionsCalls(
        "Example.ts",
        `const rows = DatabaseCommonInteractionPropsUtil.getUserPermissions(props, PermissionType.Allow);
        const both = DatabaseCommonInteractionPropsUtil.getPermissionRows(props);`,
      ),
    ).toHaveLength(2);
  });
});

describe("CallerPermissionGuard: the server", () => {
  test("scans the server's source", () => {
    const files: Array<string> = SOURCES.map((source: ScannedSource) => {
      return source.file;
    });

    expect(files).toContain(
      "packages/Common/Server/Utils/Permission/CallerPermission.ts",
    );
    expect(files).toContain(
      "packages/Common/Server/Middleware/UserAuthorization.ts",
    );
    expect(files).toContain("packages/Common/Server/API/NotificationAPI.ts");
    expect(files.length).toBeGreaterThan(500);
  });

  test("reads a caller's rows only to hand them to the rule", () => {
    const findings: Array<Finding> = SOURCES.flatMap(
      (source: ScannedSource): Array<Finding> => {
        if (ROW_READERS[source.file]) {
          return [];
        }

        return findRowReads(source.file, source.text);
      },
    );

    expect(describeFindings(findings)).toEqual([]);
  });

  test("every listed row reader still reads the rows", () => {
    const stale: Array<string> = Object.keys(ROW_READERS).filter(
      (file: string): boolean => {
        const source: ScannedSource | undefined = SOURCES.find(
          (candidate: ScannedSource) => {
            return candidate.file === file;
          },
        );

        return !source || findRowReads(source.file, source.text).length === 0;
      },
    );

    expect(stale).toEqual([]);
  });

  test("calls getUserPermissions only where it is listed", () => {
    const findings: Array<Finding> = SOURCES.flatMap(
      (source: ScannedSource): Array<Finding> => {
        if (USER_PERMISSIONS_CALLERS[source.file]) {
          return [];
        }

        return findUserPermissionsCalls(source.file, source.text);
      },
    );

    expect(describeFindings(findings)).toEqual([]);
  });

  test("every listed getUserPermissions caller still calls it", () => {
    const stale: Array<string> = Object.keys(USER_PERMISSIONS_CALLERS).filter(
      (file: string): boolean => {
        const source: ScannedSource | undefined = SOURCES.find(
          (candidate: ScannedSource) => {
            return candidate.file === file;
          },
        );

        return (
          !source ||
          findUserPermissionsCalls(source.file, source.text).length === 0
        );
      },
    );

    expect(stale).toEqual([]);
  });

  test("every listed file says why", () => {
    for (const reason of [
      ...Object.values(ROW_READERS),
      ...Object.values(USER_PERMISSIONS_CALLERS),
    ]) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});
