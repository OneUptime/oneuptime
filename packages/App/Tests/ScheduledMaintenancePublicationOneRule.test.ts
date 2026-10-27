import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";

/*
 * One rule decides whether a scheduled maintenance event is public - shown
 * on its status pages, and told to their subscribers: Visible on Status
 * Page on, and published (no Publish on Status Page At, or one that has
 * come). In code it is Common/Types/ScheduledMaintenance/
 * ScheduledMaintenancePublication; in SQL, StatusPageVisibilityQuery.
 * shownScheduledMaintenance (GitHub issue #5249).
 *
 * An event kept to the team until its publish time must not reach anyone
 * outside it early: not a status page, its feeds, its calendar or its API,
 * and not a subscriber. A reader that asks the switch alone shows it early,
 * so this fails on one:
 *
 *   - the subscriber jobs about an event - the 'scheduled' notification,
 *     the reminders before it, state changes and public notes - decide with
 *     ScheduledMaintenancePublication (isShown or getState), never on the
 *     switch alone: wherever they select isVisibleOnStatusPage they select
 *     publishOnStatusPageAt with it, and they read no `.isVisibleOnStatusPage`
 *     of a record;
 *   - the 'scheduled' notification waits for the publish time in its query,
 *     so it is sent once, at publication;
 *   - only those jobs hand events to the service that tells subscribers an
 *     event is scheduled (notififySubscribersOnEventScheduled), which
 *     decides nothing itself;
 *   - every read of scheduled maintenance by the code that serves status
 *     pages - their API, their servers, the public MCP tools, the status
 *     page utilities (feeds, calendar, caches) - passes its query through
 *     StatusPageVisibilityQuery.shownScheduledMaintenance
 *     (StatusPageVisibilityOneRule holds StatusPageAPI.ts to it, read by
 *     read; this holds the rest of that code, where there are none today).
 *
 * Read from the TypeScript AST, so a comment or a string naming a column
 * never counts.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..");

// The jobs that tell status page subscribers about a scheduled maintenance event.
const SUBSCRIBER_JOB_FILES: ReadonlyArray<string> = [
  "App/FeatureSet/Workers/Jobs/ScheduledMaintenance/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/ScheduledMaintenance/SendSubscriberRemindersOnEventScheduled.ts",
  "App/FeatureSet/Workers/Jobs/ScheduledMaintenanceStateTimeline/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/ScheduledMaintenancePublicNote/SendNotificationToSubscribers.ts",
];

const SCHEDULED_JOB_FILE: string = SUBSCRIBER_JOB_FILES[0]!;

// The rule in code, and the calls that apply it.
const RULE: string = "ScheduledMaintenancePublication";
const RULE_CALLS: ReadonlyArray<string> = ["isShown", "getState"];

// The service call that sends the 'scheduled' notification, and its reminders.
const SEND_SCHEDULED_CALL: string = "notififySubscribersOnEventScheduled";

// The code that serves what status pages show, outside StatusPageAPI.ts.
const PUBLIC_SOURCE_DIRS: ReadonlyArray<string> = [
  "Common/Server/Utils/StatusPage",
  "App/FeatureSet/StatusPage",
  "App/FeatureSet/Frontend",
  "App/FeatureSet/MCP/Tools",
];

// Where code that could send the 'scheduled' notification lives.
const SERVER_SOURCE_DIRS: ReadonlyArray<string> = [
  "Common/Server",
  "App/FeatureSet",
];

// The service calls that take a query.
const QUERY_METHODS: ReadonlyArray<string> = [
  "findBy",
  "findAllBy",
  "findOneBy",
  "countBy",
  "findOneOrNoneBy",
  "searchBy",
];

interface Finding {
  file: string;
  line: number;
  text: string;
}

// A file under packages/, or a probe written elsewhere (an absolute path).
function parse(relativePath: string): ts.SourceFile {
  const absolute: string = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(PACKAGES_DIR, relativePath);

  return ts.createSourceFile(
    absolute,
    fs.readFileSync(absolute, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    absolute.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isAwaitExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

function lineOf(node: ts.Node): number {
  const source: ts.SourceFile = node.getSourceFile();

  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function visitAll(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child: ts.Node) => {
    visitAll(child, visit);
  });
}

// `Name.method(...)` as [Name, method], else null.
function calleeOf(call: ts.CallExpression): [string, string] | null {
  const callee: ts.Expression = unwrap(call.expression);

  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(unwrap(callee.expression))
  ) {
    return [
      (unwrap(callee.expression) as ts.Identifier).text,
      callee.name.text,
    ];
  }

  return null;
}

function propertyNamed(
  literal: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralElementLike | undefined {
  return literal.properties.find(
    (property: ts.ObjectLiteralElementLike): boolean => {
      return (
        (ts.isPropertyAssignment(property) ||
          ts.isShorthandPropertyAssignment(property)) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text === name
      );
    },
  );
}

function describeFindings(findings: Array<Finding>): Array<string> {
  return findings.map((finding: Finding): string => {
    return `${finding.file}:${finding.line} ${finding.text}`;
  });
}

interface JobScan {
  // `.isVisibleOnStatusPage` read off a record.
  switchReads: Array<Finding>;
  // A select (or query) naming isVisibleOnStatusPage without publishOnStatusPageAt.
  selectsWithoutPublishTime: Array<Finding>;
  // Calls of the rule, by name.
  ruleCalls: Array<string>;
}

function scanJob(relativePath: string): JobScan {
  const scan: JobScan = {
    switchReads: [],
    selectsWithoutPublishTime: [],
    ruleCalls: [],
  };
  const source: ts.SourceFile = parse(relativePath);

  visitAll(source, (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "isVisibleOnStatusPage"
    ) {
      scan.switchReads.push({
        file: relativePath,
        line: lineOf(node),
        text: node.getText(source),
      });
    }

    if (
      ts.isObjectLiteralExpression(node) &&
      propertyNamed(node, "isVisibleOnStatusPage") &&
      !propertyNamed(node, "publishOnStatusPageAt")
    ) {
      scan.selectsWithoutPublishTime.push({
        file: relativePath,
        line: lineOf(node),
        text: "isVisibleOnStatusPage without publishOnStatusPageAt",
      });
    }

    if (ts.isCallExpression(node)) {
      const callee: [string, string] | null = calleeOf(node);

      if (callee && callee[0] === RULE) {
        scan.ruleCalls.push(callee[1]);
      }
    }
  });

  return scan;
}

// Every .ts/.tsx file under a directory of packages/, tests left out.
function sourceFilesUnder(relativeDir: string): Array<string> {
  const absolute: string = path.join(PACKAGES_DIR, relativeDir);
  const files: Array<string> = [];

  if (!fs.existsSync(absolute)) {
    return files;
  }

  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name === "node_modules" ||
        entry.name === "build" ||
        entry.name === "dist" ||
        entry.name === "Tests" ||
        entry.name.startsWith(".")
      ) {
        continue;
      }

      const full: string = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }

      if (
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
        !entry.name.endsWith(".d.ts") &&
        !entry.name.endsWith(".test.ts") &&
        !entry.name.endsWith(".test.tsx")
      ) {
        files.push(path.relative(PACKAGES_DIR, full));
      }
    }
  };

  walk(absolute);

  return files.sort();
}

/*
 * The values an identifier is given in the function it is used in: its
 * declaration's initializer and every plain assignment.
 */
function nearestFunction(node: ts.Node): ts.Node {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (ts.isFunctionLike(current)) {
      return current;
    }
    current = current.parent;
  }

  return node.getSourceFile();
}

function valuesAssignedTo(name: string, from: ts.Node): Array<ts.Expression> {
  const values: Array<ts.Expression> = [];

  visitAll(nearestFunction(from), (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      values.push(node.initializer);
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(unwrap(node.left)) &&
      (unwrap(node.left) as ts.Identifier).text === name
    ) {
      values.push(node.right);
    }
  });

  return values;
}

// Whether a query is built by StatusPageVisibilityQuery.shownScheduledMaintenance.
function holdsTheRule(expression: ts.Expression, depth: number = 0): boolean {
  const value: ts.Expression = unwrap(expression);

  if (ts.isCallExpression(value)) {
    const callee: [string, string] | null = calleeOf(value);

    return Boolean(
      callee &&
        callee[0] === "StatusPageVisibilityQuery" &&
        callee[1] === "shownScheduledMaintenance",
    );
  }

  if (ts.isIdentifier(value) && depth < 3) {
    const assigned: Array<ts.Expression> = valuesAssignedTo(value.text, value);

    return (
      assigned.length > 0 &&
      assigned.every((candidate: ts.Expression): boolean => {
        return holdsTheRule(candidate, depth + 1);
      })
    );
  }

  return false;
}

interface ReadScan {
  reads: Array<Finding>;
  withoutTheRule: Array<Finding>;
}

// The ScheduledMaintenanceService reads of a file, and those that skip the rule.
function scanMaintenanceReads(relativePath: string): ReadScan {
  const scan: ReadScan = { reads: [], withoutTheRule: [] };
  const source: ts.SourceFile = parse(relativePath);

  visitAll(source, (node: ts.Node): void => {
    if (!ts.isCallExpression(node)) {
      return;
    }

    const callee: [string, string] | null = calleeOf(node);

    if (!callee || callee[0] !== "ScheduledMaintenanceService") {
      return;
    }

    const finding: Finding = {
      file: relativePath,
      line: lineOf(node),
      text: `${callee[0]}.${callee[1]}`,
    };

    if (callee[1] === "findOneById") {
      scan.reads.push(finding);
      scan.withoutTheRule.push(finding);
      return;
    }

    if (!QUERY_METHODS.includes(callee[1])) {
      return;
    }

    scan.reads.push(finding);

    const argument: ts.Expression | undefined = node.arguments[0]
      ? unwrap(node.arguments[0])
      : undefined;

    const query: ts.ObjectLiteralElementLike | undefined =
      argument && ts.isObjectLiteralExpression(argument)
        ? propertyNamed(argument, "query")
        : undefined;

    const queryValue: ts.Expression | undefined =
      query && ts.isPropertyAssignment(query)
        ? query.initializer
        : query && ts.isShorthandPropertyAssignment(query)
          ? query.name
          : undefined;

    if (!queryValue || !holdsTheRule(queryValue)) {
      scan.withoutTheRule.push(finding);
    }
  });

  return scan;
}

// The calls of the service that sends the 'scheduled' notification, by file.
function filesSendingScheduled(): Array<string> {
  const files: Set<string> = new Set<string>();

  for (const dir of SERVER_SOURCE_DIRS) {
    for (const file of sourceFilesUnder(dir)) {
      const text: string = fs.readFileSync(
        path.join(PACKAGES_DIR, file),
        "utf8",
      );

      if (!text.includes(SEND_SCHEDULED_CALL)) {
        continue;
      }

      visitAll(parse(file), (node: ts.Node): void => {
        if (!ts.isCallExpression(node)) {
          return;
        }

        const callee: ts.Expression = unwrap(node.expression);

        if (
          ts.isPropertyAccessExpression(callee) &&
          callee.name.text === SEND_SCHEDULED_CALL
        ) {
          files.add(file);
        }
      });
    }
  }

  return Array.from(files).sort();
}

describe("A scheduled maintenance event is public by one rule: visible, and published", () => {
  test.each(SUBSCRIBER_JOB_FILES)(
    "%s decides with ScheduledMaintenancePublication, never on the switch alone",
    (relativePath: string) => {
      const scan: JobScan = scanJob(relativePath);

      expect(describeFindings(scan.switchReads)).toEqual([]);
      expect(describeFindings(scan.selectsWithoutPublishTime)).toEqual([]);
      expect(
        scan.ruleCalls.some((call: string): boolean => {
          return RULE_CALLS.includes(call);
        }),
      ).toBe(true);
    },
  );

  test("the 'scheduled' notification waits for the publish time in its query", () => {
    const source: ts.SourceFile = parse(SCHEDULED_JOB_FILE);
    const waitingQueries: Array<number> = [];

    visitAll(source, (node: ts.Node): void => {
      if (!ts.isObjectLiteralExpression(node)) {
        return;
      }

      // The query of the events it sends: queued, and notifying.
      const notifies: ts.ObjectLiteralElementLike | undefined = propertyNamed(
        node,
        "shouldStatusPageSubscribersBeNotifiedOnEventCreated",
      );

      if (
        !notifies ||
        !ts.isPropertyAssignment(notifies) ||
        notifies.initializer.kind !== ts.SyntaxKind.TrueKeyword
      ) {
        return;
      }

      const publishTime: ts.ObjectLiteralElementLike | undefined =
        propertyNamed(node, "publishOnStatusPageAt");

      expect(publishTime).toBeDefined();

      const condition: ts.Expression = unwrap(
        (publishTime as ts.PropertyAssignment).initializer,
      );

      expect(ts.isCallExpression(condition)).toBe(true);
      expect(calleeOf(condition as ts.CallExpression)).toEqual([
        "QueryHelper",
        "lessThanEqualToOrNull",
      ]);

      waitingQueries.push(lineOf(node));
    });

    // Exactly the one query: the events it tells subscribers about.
    expect(waitingQueries).toHaveLength(1);
  });

  test("only the subscriber jobs send the 'scheduled' notification and its reminders", () => {
    expect(filesSendingScheduled()).toEqual(
      [SUBSCRIBER_JOB_FILES[0]!, SUBSCRIBER_JOB_FILES[1]!].sort(),
    );
  });

  test("every read of scheduled maintenance by the code serving status pages holds the rule", () => {
    const withoutTheRule: Array<Finding> = [];
    let filesScanned: number = 0;

    for (const dir of PUBLIC_SOURCE_DIRS) {
      for (const file of sourceFilesUnder(dir)) {
        filesScanned++;
        withoutTheRule.push(...scanMaintenanceReads(file).withoutTheRule);
      }
    }

    // The folders are there: the scan read the code it is about.
    expect(filesScanned).toBeGreaterThan(50);
    expect(describeFindings(withoutTheRule)).toEqual([]);
  });

  test("a job that decides on the switch alone is caught", () => {
    const probe: string = path.join(
      os.tmpdir(),
      `maintenance-publication-job-probe-${process.pid}.ts`,
    );

    fs.writeFileSync(
      probe,
      [
        "const select = { isVisibleOnStatusPage: true };",
        "if (!event.isVisibleOnStatusPage) { skip(); }",
        "const both = { isVisibleOnStatusPage: true, publishOnStatusPageAt: true };",
      ].join("\n"),
    );

    try {
      const scan: JobScan = scanJob(probe);

      expect(scan.switchReads).toHaveLength(1);
      expect(scan.selectsWithoutPublishTime).toHaveLength(1);
      expect(scan.selectsWithoutPublishTime[0]!.line).toBe(1);
      expect(scan.ruleCalls).toEqual([]);
    } finally {
      fs.unlinkSync(probe);
    }
  });

  test("a status page read that skips the rule is caught, and one built by it passes", () => {
    const probe: string = path.join(
      os.tmpdir(),
      `maintenance-publication-read-probe-${process.pid}.ts`,
    );

    fs.writeFileSync(
      probe,
      [
        "async function read(): Promise<void> {",
        "  await ScheduledMaintenanceService.findBy({ query: { isVisibleOnStatusPage: true } });",
        "  await ScheduledMaintenanceService.findBy({ query: StatusPageVisibilityQuery.shownScheduledMaintenance({}) });",
        "  const shown = StatusPageVisibilityQuery.shownScheduledMaintenance({}, { now: now });",
        "  await ScheduledMaintenanceService.findOneBy({ query: shown });",
        "  await ScheduledMaintenanceService.findOneById({ id: id });",
        "  await ScheduledMaintenanceService.countBy({ query: StatusPageVisibilityQuery.shownEpisodes({}) });",
        "}",
      ].join("\n"),
    );

    try {
      const scan: ReadScan = scanMaintenanceReads(probe);

      expect(scan.reads).toHaveLength(5);
      expect(
        scan.withoutTheRule.map((finding: Finding): string => {
          return `${finding.line} ${finding.text}`;
        }),
      ).toEqual([
        "2 ScheduledMaintenanceService.findBy",
        "6 ScheduledMaintenanceService.findOneById",
        // An episode's helper is not the event's rule.
        "7 ScheduledMaintenanceService.countBy",
      ]);
    } finally {
      fs.unlinkSync(probe);
    }
  });

  test("the scan of senders would catch a new caller", () => {
    const probe: string = path.join(
      os.tmpdir(),
      `maintenance-publication-sender-probe-${process.pid}.ts`,
    );

    fs.writeFileSync(
      probe,
      "async function tell(): Promise<void> { await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([]); }\n",
    );

    try {
      let found: boolean = false;

      visitAll(parse(probe), (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(unwrap(node.expression)) &&
          (unwrap(node.expression) as ts.PropertyAccessExpression).name.text ===
            SEND_SCHEDULED_CALL
        ) {
          found = true;
        }
      });

      expect(found).toBe(true);
    } finally {
      fs.unlinkSync(probe);
    }
  });
});
