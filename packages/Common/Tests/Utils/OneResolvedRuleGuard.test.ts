import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, test } from "@jest/globals";

/*
 * ONE RULE DECIDES WHETHER AN INCIDENT, AN ALERT OR AN EPISODE IS RESOLVED.
 *
 * A record is resolved when its state is at or below its project's resolved
 * state, or carries the resolved flag itself (Common/Utils/ResolvedState).
 * Reading the flag on its own is what made a state placed after Resolved
 * ("Closed") half-resolved: resolved for reminders and status pages, open for
 * the Active badges and an episode's resolvedAt, and never a resolve at all
 * for an incident's monitors.
 *
 * So nothing outside the helpers reads the flag to decide that:
 *
 *   - no `x.isResolvedState` (or `x["isResolvedState"]`, or a destructured
 *     `{ isResolvedState }`) is read, except to hand a state's flags on as
 *     they are (`isResolvedState: state.isResolvedState`) - into the helper's
 *     input, say;
 *   - no query asks for records by it (`query`, `countQuery`, a `Query<...>`
 *     or a `where`: `currentIncidentState: { isResolvedState: false }`). The
 *     state services' getUnresolvedIncidentStateIds and the alert twins name
 *     the states to ask for. Selecting the flag, to hand it to the helper, is
 *     fine.
 *
 * What is left reads the flag on purpose and is listed below, shrink-only: a
 * file that no longer needs its entry fails here until the entry goes.
 * Scheduled maintenance has a path of its own (scheduled, ongoing, ended,
 * completed), where "ended or completed" is read off its states' flags.
 *
 * Only real syntax is read, through the TypeScript AST.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");

// Where the readers live. A directory that is not in the checkout is skipped
// (the core test job runs without ee/).
const SCANNED_DIRECTORIES: Array<string> = [
  "packages/Common/Server",
  "packages/Common/Utils",
  "packages/Common/UI",
  "packages/Common/Types",
  "packages/App/FeatureSet",
  "packages/MobileApp/src",
  "ee/Server",
  "ee/Dashboard",
  "ee/AdminDashboard",
];

const SKIPPED_DIRECTORY_NAMES: Set<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
  "__tests__",
  // Schema history: what the database looked like then, not a reader.
  "SchemaMigrations",
  "DataMigrations",
]);

const FLAG: string = "isResolvedState";

/*
 * Files that read the flag on purpose, by path from the repository root, and
 * why. Shrink-only.
 */
const ALLOWED: Record<string, string> = {
  // The app's own copy of the rule: it is built without Common's runtime code.
  "packages/MobileApp/src/utils/resolvedState.ts":
    "the mobile app's copy of Common/Utils/ResolvedState",

  // Scheduled maintenance: its own path, "ended or completed" by its flags.
  "packages/Common/Server/Services/ScheduledMaintenanceStateTimelineService.ts":
    "scheduled maintenance states",
  "packages/Common/Server/Services/ScheduledMaintenanceStateService.ts":
    "scheduled maintenance states",
  "packages/Common/Server/Services/ScheduledMaintenanceMeasurementValueService.ts":
    "scheduled maintenance states",
  "packages/Common/Server/Services/ScheduledMaintenanceReminderRuleService.ts":
    "scheduled maintenance events not yet completed",
  "packages/Common/Server/Services/ScheduledMaintenanceService.ts":
    "scheduled maintenance states",
  "packages/Common/Server/Utils/TeamMember/ProjectLeaveResourceCleanup.ts":
    "the open scheduled maintenance states (incidents and alerts ask the state services)",
  "packages/Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault.ts":
    "a scheduled maintenance event moved into an ended state",
  "packages/Common/Server/Utils/Workspace/MicrosoftTeams/ReactionNoteSync.ts":
    "the open scheduled maintenance events (incidents and alerts ask the state services)",
  "packages/App/FeatureSet/StatusPage/src/Pages/ScheduledEvent/Detail.tsx":
    "scheduled maintenance timeline icons",
  "packages/App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/Index.tsx":
    "scheduled maintenance states",
  "packages/App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ChangeState.tsx":
    "scheduled maintenance states",
  "packages/App/FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceTiming.ts":
    "scheduled maintenance states",
  "packages/App/FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceState.ts":
    "scheduled maintenance states",
};

export interface FlagRead {
  file: string;
  line: number;
  text: string;
}

const QUERY_CONTEXT: RegExp = /^(query|\w*Query|where)$/;
const SELECT_CONTEXT: RegExp = /^(select|selectMoreFields|\w*Select)$/;

function nameOf(name: ts.PropertyName | ts.JsxAttributeName): string | null {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }

  return null;
}

/*
 * What an object literal property sits in: a query, a select, or neither,
 * from the nearest property, JSX attribute, typed variable or assignment that
 * names it.
 */
function contextOf(
  source: ts.SourceFile,
  node: ts.Node,
): "query" | "select" | null {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (ts.isPropertyAssignment(current)) {
      const name: string | null = nameOf(current.name);

      if (name && SELECT_CONTEXT.test(name)) {
        return "select";
      }

      if (name && QUERY_CONTEXT.test(name)) {
        return "query";
      }
    }

    if (ts.isJsxAttribute(current)) {
      const name: string | null = nameOf(current.name);

      if (name && SELECT_CONTEXT.test(name)) {
        return "select";
      }

      if (name && QUERY_CONTEXT.test(name)) {
        return "query";
      }
    }

    if (ts.isVariableDeclaration(current) && current.type) {
      const type: string = current.type.getText(source);

      if (/\bSelect</.test(type)) {
        return "select";
      }

      if (/\bQuery</.test(type)) {
        return "query";
      }
    }

    if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const target: string = current.left.getText(source);

      if (/\b\w*[sS]elect\b/.test(target)) {
        return "select";
      }

      if (/\b(query|\w*Query)\b/.test(target)) {
        return "query";
      }
    }

    // A function boundary ends the search: its body is a context of its own.
    if (ts.isFunctionLike(current)) {
      return null;
    }

    current = current.parent;
  }

  return null;
}

function isAssignmentTarget(node: ts.Node): boolean {
  const parent: ts.Node = node.parent;

  return (
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  );
}

// `isResolvedState: state.isResolvedState`: the flags handed on as they are.
function isHandedOn(node: ts.Node): boolean {
  const parent: ts.Node = node.parent;

  return (
    ts.isPropertyAssignment(parent) &&
    parent.initializer === node &&
    nameOf(parent.name) === FLAG
  );
}

/*
 * Every read of the resolved flag, and every query on it, in one source
 * file's text.
 */
export function findFlagReads(file: string, text: string): Array<FlagRead> {
  if (!text.includes(FLAG)) {
    return [];
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const reads: Array<FlagRead> = [];

  const record: (node: ts.Node) => void = (node: ts.Node): void => {
    reads.push({
      file: file,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      text: node.getText(source).replace(/\s+/g, " ").slice(0, 160),
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    // state.isResolvedState / state?.isResolvedState
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === FLAG &&
      !isAssignmentTarget(node) &&
      !isHandedOn(node)
    ) {
      record(node);
    }

    // state["isResolvedState"]
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === FLAG &&
      !isAssignmentTarget(node) &&
      !isHandedOn(node)
    ) {
      record(node);
    }

    // const { isResolvedState } = state;
    if (
      ts.isBindingElement(node) &&
      ts.isObjectBindingPattern(node.parent) &&
      (node.propertyName
        ? nameOf(node.propertyName as ts.PropertyName) === FLAG
        : ts.isIdentifier(node.name) && node.name.text === FLAG)
    ) {
      record(node);
    }

    /*
     * query: { currentIncidentState: { isResolvedState: false } } - and
     * `isResolvedState: false` anywhere but a select, which only ever asks
     * for records by the flag (a query built in a helper and returned, say).
     */
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      nameOf(node.name) === FLAG
    ) {
      const context: "query" | "select" | null = contextOf(source, node);

      if (
        context === "query" ||
        (context !== "select" &&
          ts.isPropertyAssignment(node) &&
          node.initializer.kind === ts.SyntaxKind.FalseKeyword)
      ) {
        record(node);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return reads;
}

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  const walk: (current: string) => void = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
          walk(path.join(current, entry.name));
        }
        continue;
      }

      if (
        /\.(ts|tsx)$/.test(entry.name) &&
        !/\.(test|spec)\.(ts|tsx)$/.test(entry.name) &&
        !entry.name.endsWith(".d.ts")
      ) {
        files.push(path.join(current, entry.name));
      }
    }
  };

  walk(directory);

  return files;
}

function scanRepository(): Array<FlagRead> {
  const reads: Array<FlagRead> = [];

  for (const relativeDirectory of SCANNED_DIRECTORIES) {
    const directory: string = path.join(REPOSITORY_ROOT, relativeDirectory);

    if (!fs.existsSync(directory)) {
      continue;
    }

    for (const file of listSourceFiles(directory)) {
      reads.push(
        ...findFlagReads(
          path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/"),
          fs.readFileSync(file, "utf8"),
        ),
      );
    }
  }

  return reads;
}

describe("one rule decides whether an incident, alert or episode is resolved", () => {
  const reads: Array<FlagRead> = scanRepository();

  test("nothing outside the helpers reads the resolved flag or queries by it", () => {
    const unexpected: Array<string> = reads
      .filter((read: FlagRead): boolean => {
        return !Object.prototype.hasOwnProperty.call(ALLOWED, read.file);
      })
      .map((read: FlagRead): string => {
        return `${read.file}:${read.line}: ${read.text}`;
      });

    /*
     * Ask Common/Utils/ResolvedState (in the dashboard and on status pages),
     * the state services (isResolvedIncidentState, getUnresolvedIncidentStateIds
     * and the alert twins) or the record services (isIncidentResolved,
     * isAlertResolved, isEpisodeResolved) instead.
     */
    expect(unexpected).toEqual([]);
  });

  test("every allowed file still reads the flag, so the list only shrinks", () => {
    const filesWithReads: Set<string> = new Set<string>(
      reads.map((read: FlagRead): string => {
        return read.file;
      }),
    );

    const stale: Array<string> = Object.keys(ALLOWED).filter(
      (file: string): boolean => {
        return (
          fs.existsSync(path.join(REPOSITORY_ROOT, file)) &&
          !filesWithReads.has(file)
        );
      },
    );

    expect(stale).toEqual([]);
  });

  test("the helpers themselves are where the rule is read", () => {
    for (const file of [
      "packages/Common/Utils/ResolvedState.ts",
      "packages/Common/Utils/StartingStage.ts",
    ]) {
      expect(fs.existsSync(path.join(REPOSITORY_ROOT, file))).toBe(true);
    }
  });
});

describe("the guard's own detector", () => {
  function linesOf(text: string, file: string = "sample.ts"): Array<string> {
    return findFlagReads(file, text).map((read: FlagRead): string => {
      return read.text;
    });
  }

  test.each([
    ["a read of the flag", "if (state.isResolvedState) { go(); }"],
    ["an optional read", "const x = incident.currentIncidentState?.isResolvedState;"],
    ["a string-keyed read", 'const x = state["isResolvedState"];'],
    ["a destructured read", "const { isResolvedState } = state;"],
    [
      "a renamed destructured read",
      "const { isResolvedState: resolved } = state;",
    ],
    [
      "a query by the flag",
      "await IncidentService.findBy({ query: { currentIncidentState: { isResolvedState: false } } });",
    ],
    [
      "a query for the flagged state",
      "await IncidentStateService.findOneBy({ query: { isResolvedState: true, projectId } });",
    ],
    [
      "a count query",
      "const item = { countQuery: { currentAlertState: { isResolvedState: false } } };",
    ],
    [
      "a typed query",
      "const query: Query<Incident> = { currentIncidentState: { isResolvedState: false } as any };",
    ],
    [
      "a query assigned to",
      "query.currentIncidentState = { isResolvedState: false };",
    ],
    [
      "a query built in a helper and returned",
      "function open() { return { currentIncidentState: { isResolvedState: false } }; }",
    ],
  ] as Array<[string, string]>)("flags %s", (_name: string, text: string) => {
    expect(linesOf(text)).toHaveLength(1);
  });

  test("flags a query in a JSX attribute", () => {
    expect(
      linesOf(
        "const page = <Table query={{ currentIncidentState: { isResolvedState: false } }} />;",
        "sample.tsx",
      ),
    ).toHaveLength(1);
  });

  test.each([
    ["a select", "await IncidentStateService.findBy({ query: { projectId }, select: { _id: true, isResolvedState: true } });"],
    [
      "a nested select",
      "await IncidentService.findBy({ query: {}, select: { currentIncidentState: { isResolvedState: true } } });",
    ],
    ["a typed select", "const select: Select<Incident> = { currentIncidentState: { isResolvedState: true } };"],
    ["the flags handed on", "const row = { id: state.id, isResolvedState: state.isResolvedState };"],
    ["a write of the flag", "resolvedState.isResolvedState = true;"],
    ["a label map", 'const labels = { isResolvedState: "Resolved" };'],
    ["a string naming the flag", 'const flag = "isResolvedState";'],
    ["a type member", "interface S { isResolvedState?: boolean }"],
  ] as Array<[string, string]>)("leaves %s alone", (_name: string, text: string) => {
    expect(linesOf(text)).toEqual([]);
  });
});
