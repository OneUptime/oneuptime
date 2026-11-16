import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * NOTHING FINDS OR SORTS ON-CALL RUNS BY THE COLUMNS A STEP WRITES (issue
 * #8104).
 *
 * Every escalation step of an on-call run writes when its level started
 * (lastEscalationRuleExecutedAt), the level's order and wait
 * (lastExecutedEscalationRuleOrder, executeNextEscalationRuleInMinutes) and
 * a new pass's count (onCallPolicyExecutionRepeatCount). None of them is in
 * an index (DropOnCallExecutionLogStepIndexes1809181400000): an index by
 * one is written on every step - it keeps the step's update from being HOT
 * - and nothing read by them. This keeps it so. A read that finds runs by
 * one of them, or sorts runs by one, fails here until it either names the
 * run's _id too (a read or a compare-and-set of one run, which its primary
 * key answers), or gets an index of its own - and its entry in KNOWN below,
 * with that index named.
 *
 * Read: every TypeScript file of the server, the Workers, the dashboards,
 * the Enterprise server and the mobile app that names one of the columns.
 * Flagged:
 *
 *   - an object literal that names one of them where a read's filter or
 *     order goes - a `query`, `where`, `sort`, `order`, `orderBy` or
 *     `filterQuery`, a repository call's first argument (update, find,
 *     findOne, findBy, findOneBy, count, countBy, delete, exists), a
 *     variable named for a query, a where or a clause - unless it names
 *     `_id` too (never for an order);
 *   - a field of a list's `filters` or `columns` (a column of a list sorts
 *     it);
 *   - raw SQL that names one of them.
 *
 * What a read selects, and what an update writes, are not reads by them.
 * The public API can still filter and sort by them, as by any column it
 * returns: such a read is answered by the project's own index.
 */

const COLUMNS: ReadonlyArray<string> = [
  "lastExecutedEscalationRuleOrder",
  "lastEscalationRuleExecutedAt",
  "executeNextEscalationRuleInMinutes",
  "onCallPolicyExecutionRepeatCount",
];

// packages/Common/Tests/Server/Services -> the repository.
const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

const SCAN_ROOTS: ReadonlyArray<string> = [
  "packages/Common/Server",
  "packages/Common/UI",
  "packages/Common/Utils",
  "packages/Common/Types",
  "packages/App/FeatureSet",
  "packages/MobileApp/src",
  "ee/Server",
  "ee/Dashboard",
];

// The migrations name the columns in their DDL; nothing there is a read.
const SKIPPED_DIRECTORIES: ReadonlyArray<string> = [
  "node_modules",
  "build",
  "dist",
  "SchemaMigrations",
];

// Where a read's filter or order goes.
const QUERY_PROPERTIES: ReadonlySet<string> = new Set<string>([
  "query",
  "where",
  "filterQuery",
]);
const ORDER_PROPERTIES: ReadonlySet<string> = new Set<string>([
  "sort",
  "order",
  "orderBy",
]);

// A repository or service call whose first argument says which rows.
const ROW_FINDING_CALLS: ReadonlySet<string> = new Set<string>([
  "update",
  "find",
  "findOne",
  "findBy",
  "findOneBy",
  "count",
  "countBy",
  "delete",
  "softDelete",
  "exists",
  "exist",
]);

// A variable that holds a filter.
const QUERY_VARIABLE: RegExp = /(query|where|clause|filter)$/i;

/*
 * Reads by one of the columns that are right as they are, each with the
 * index that answers it. Empty: there are none.
 */
const KNOWN: ReadonlyArray<{ position: string; why: string }> = [];

interface Finding {
  // file:line - what it is.
  position: string;
  kind: "byRunId" | "read" | "order" | "listField" | "sql";
}

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        files.push(...listSourceFiles(fullPath));
      }
      continue;
    }

    if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.includes(".test.")
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

function nameOf(node: ts.PropertyName | ts.BindingName): string | null {
  if (
    ts.isIdentifier(node) ||
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node)
  ) {
    return node.text;
  }

  return null;
}

function keysOf(object: ts.ObjectLiteralExpression): Array<string> {
  const keys: Array<string> = [];

  for (const property of object.properties) {
    if (
      (ts.isPropertyAssignment(property) ||
        ts.isShorthandPropertyAssignment(property) ||
        ts.isMethodDeclaration(property)) &&
      property.name
    ) {
      const key: string | null = nameOf(property.name);

      if (key) {
        keys.push(key);
      }
    }
  }

  return keys;
}

// Parentheses, `as` casts and non-null assertions do not change what an object is.
function outerOf(node: ts.Node): ts.Node {
  let current: ts.Node = node;

  while (
    current.parent &&
    (ts.isParenthesizedExpression(current.parent) ||
      ts.isAsExpression(current.parent) ||
      ts.isNonNullExpression(current.parent) ||
      ts.isSatisfiesExpression(current.parent) ||
      ts.isTypeAssertionExpression(current.parent))
  ) {
    current = current.parent;
  }

  return current;
}

function calleeNameOf(call: ts.CallExpression): string | null {
  const callee: ts.Expression = call.expression;

  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }

  if (ts.isIdentifier(callee)) {
    return callee.text;
  }

  return null;
}

// The name of the list (filters / columns) an object sits in, if any.
function enclosingListName(node: ts.Node): string | null {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (ts.isPropertyAssignment(current) || ts.isVariableDeclaration(current)) {
      const name: string | null = nameOf(current.name);

      if (name === "filters" || name === "columns") {
        return name;
      }
    }

    if (ts.isFunctionLike(current)) {
      return null;
    }

    current = current.parent;
  }

  return null;
}

type Position = "read" | "order" | "listField" | null;

// Where an object literal goes: a read's filter, its order, a list's field, or nothing read.
function positionOf(object: ts.ObjectLiteralExpression): Position {
  const outer: ts.Node = outerOf(object);
  const parent: ts.Node | undefined = outer.parent;

  if (!parent) {
    return null;
  }

  if (ts.isPropertyAssignment(parent) && parent.initializer === outer) {
    const name: string | null = nameOf(parent.name);

    if (name && QUERY_PROPERTIES.has(name)) {
      return "read";
    }

    if (name && ORDER_PROPERTIES.has(name)) {
      return "order";
    }

    if (name === "field" && enclosingListName(parent)) {
      return "listField";
    }

    return null;
  }

  if (ts.isCallExpression(parent) && parent.arguments[0] === outer) {
    const callee: string | null = calleeNameOf(parent);

    return callee && ROW_FINDING_CALLS.has(callee) ? "read" : null;
  }

  if (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === outer &&
    ts.isIdentifier(parent.name) &&
    QUERY_VARIABLE.test(parent.name.text)
  ) {
    return "read";
  }

  return null;
}

// Every place a source reads by one of the columns, and every by-id read that names one.
export function findStepColumnReads(
  fileName: string,
  source: string,
): Array<Finding> {
  const findings: Array<Finding> = [];

  if (
    !COLUMNS.some((column: string): boolean => {
      return source.includes(column);
    })
  ) {
    return findings;
  }

  const file: ts.SourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const at: (node: ts.Node) => string = (node: ts.Node): string => {
    const line: number =
      file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    return `${path.relative(REPOSITORY_ROOT, fileName)}:${line}`;
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const keys: Array<string> = keysOf(node);
      const named: Array<string> = keys.filter((key: string): boolean => {
        return COLUMNS.includes(key);
      });

      if (named.length > 0) {
        const position: Position = positionOf(node);

        if (position === "order") {
          findings.push({ position: at(node), kind: "order" });
        } else if (position === "listField") {
          findings.push({ position: at(node), kind: "listField" });
        } else if (position === "read") {
          findings.push({
            position: at(node),
            kind: keys.includes("_id") ? "byRunId" : "read",
          });
        }
      }
    }

    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      COLUMNS.some((column: string): boolean => {
        return node.text.includes(`"${column}"`);
      })
    ) {
      findings.push({ position: at(node), kind: "sql" });
    }

    ts.forEachChild(node, visit);
  };

  visit(file);

  return findings;
}

let scanned: Array<Finding> | null = null;

function scanRepository(): Array<Finding> {
  if (scanned) {
    return scanned;
  }

  const findings: Array<Finding> = [];

  for (const root of SCAN_ROOTS) {
    for (const file of listSourceFiles(path.join(REPOSITORY_ROOT, root))) {
      findings.push(
        ...findStepColumnReads(file, fs.readFileSync(file, "utf8")),
      );
    }
  }

  scanned = findings;

  return findings;
}

describe("what finds or sorts on-call runs by the columns a step writes", () => {
  test("nothing reads runs by them but by the run's _id, and nothing sorts runs by them", () => {
    const unexplained: Array<string> = scanRepository()
      .filter((finding: Finding): boolean => {
        return finding.kind !== "byRunId";
      })
      .map((finding: Finding): string => {
        return `${finding.position} (${finding.kind})`;
      })
      .filter((position: string): boolean => {
        return !KNOWN.some((known: { position: string }): boolean => {
          return position.startsWith(known.position);
        });
      });

    expect(unexplained).toEqual([]);
  });

  /*
   * The reads by one run's _id that name a step's columns: the claim that
   * moves a run on, its give-back, and the hand-over of a run that waited
   * to page. Seen here, or the scan above saw nothing.
   */
  test("the compare-and-sets of one run are seen, by the run's _id", () => {
    const byRunId: Array<string> = scanRepository()
      .filter((finding: Finding): boolean => {
        return finding.kind === "byRunId";
      })
      .map((finding: Finding): string => {
        return finding.position.split(":")[0]!;
      });

    expect(byRunId).toContain(
      "packages/Common/Server/Services/OnCallDutyPolicyExecutionLogService.ts",
    );
  });

  test("every KNOWN entry still names a read", () => {
    for (const known of KNOWN) {
      expect(
        scanRepository().some((finding: Finding): boolean => {
          return finding.position.startsWith(known.position);
        }),
      ).toBe(true);
    }
  });
});

describe("the scan itself", () => {
  const SAMPLE: string = "Sample.ts";

  function kindsIn(source: string): Array<string> {
    return findStepColumnReads(SAMPLE, source).map(
      (finding: Finding): string => {
        return finding.kind;
      },
    );
  }

  test("a find by one of them is a read", () => {
    expect(
      kindsIn(`
        OnCallDutyPolicyExecutionLogService.findBy({
          query: { lastEscalationRuleExecutedAt: QueryHelper.lessThan(now) },
          select: { _id: true },
        });
      `),
    ).toEqual(["read"]);
  });

  test("a sort by one of them is an order, whatever else it names", () => {
    expect(
      kindsIn(`
        Service.findBy({
          query: { projectId: projectId },
          sort: { lastExecutedEscalationRuleOrder: SortOrder.Ascending, _id: SortOrder.Ascending },
        });
      `),
    ).toEqual(["order"]);
  });

  test("a repository update held to one run by its _id is a read of that run", () => {
    expect(
      kindsIn(`
        this.getRepository().update(
          { _id: id.toString(), lastEscalationRuleExecutedAt: previous } as any,
          { lastEscalationRuleExecutedAt: next } as any,
        );
      `),
    ).toEqual(["byRunId"]);
  });

  test("a where clause kept in a variable counts as one", () => {
    expect(
      kindsIn(`
        const whereClause: Record<string, unknown> = {
          status: OnCallDutyPolicyStatus.Executing,
          executeNextEscalationRuleInMinutes: 0,
        };
      `),
    ).toEqual(["read"]);
  });

  test("a list's filter or column on one of them is a read", () => {
    expect(
      kindsIn(`
        const filters = [{ title: "Order", field: { lastExecutedEscalationRuleOrder: true } }];
        const view = { columns: [{ field: { onCallPolicyExecutionRepeatCount: true } }] };
      `),
    ).toEqual(["listField", "listField"]);
  });

  test("raw SQL that names one of them is flagged", () => {
    expect(
      kindsIn(
        'await queryRunner.query(`SELECT * FROM "OnCallDutyPolicyExecutionLog" WHERE "lastEscalationRuleExecutedAt" < now()`);',
      ),
    ).toEqual(["sql"]);
  });

  test("what a read selects, what an update writes, and data kept on the side are not reads", () => {
    expect(
      kindsIn(`
        Service.findOneById({ id: id, select: { lastEscalationRuleExecutedAt: true, onCallPolicyExecutionRepeatCount: true } });
        Service.updateOneById({ id: id, data: { executeNextEscalationRuleInMinutes: 0 } });
        const moveOn = { lastExecutedEscalationRuleOrder: 2 };
        const details = { fields: [{ field: { lastExecutedEscalationRuleOrder: true } }] };
      `),
    ).toEqual([]);
  });
});
