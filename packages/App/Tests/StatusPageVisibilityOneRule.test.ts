import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";

/*
 * One rule decides whether a status page shows an incident or an incident
 * episode: Visible on Status Page on, and not private
 * (Common/Types/StatusPage/StatusPageVisibility; in SQL,
 * Common/Server/Utils/StatusPage/StatusPageVisibilityQuery). A read that asks
 * the switch alone shows a private record, so this fails on one:
 *
 *   - every IncidentEpisodeService read in StatusPageAPI.ts passes its query
 *     through StatusPageVisibilityQuery.shownEpisodes;
 *   - every IncidentService read in StatusPageAPI.ts and StatusPageService.ts
 *     passes its query through StatusPageVisibilityQuery (shownIncidents, or
 *     notPrivateIncidents where an incident only links an episode). Their
 *     display queries and counts go through IncidentStatusPageScope, which
 *     applies the rule itself (pinned by its own suites);
 *   - neither reads a record by id alone (findOneById has no query to hold
 *     the rule);
 *   - the incident and episode subscriber jobs, and the audience summary,
 *     never decide on the switch alone: wherever they select
 *     isVisibleOnStatusPage they select isPrivate with it, they read no
 *     `.isVisibleOnStatusPage` of a record, and they decide with
 *     StatusPageVisibility.isShown (the postmortem job through
 *     IncidentPostmortemPublication.isIncidentShown, which is that rule).
 *
 * Read from the TypeScript AST, so a comment or a select naming a column
 * never counts as a read.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..");

const STATUS_PAGE_FILES: Array<string> = [
  "Common/Server/API/StatusPageAPI.ts",
  "Common/Server/Services/StatusPageService.ts",
];

// What each read must pass its query through, per service.
const RULE_HELPER: string = "StatusPageVisibilityQuery";

const ALLOWED_QUERY_HELPERS: Record<string, ReadonlyArray<string>> = {
  IncidentService: ["shownIncidents", "notPrivateIncidents"],
  IncidentEpisodeService: ["shownEpisodes"],
};

// The service calls that take a query.
const QUERY_METHODS: ReadonlyArray<string> = [
  "findBy",
  "findAllBy",
  "findOneBy",
  "countBy",
  "findOneOrNoneBy",
  "searchBy",
];

// Reads with no query: nothing can hold the rule.
const QUERYLESS_READS: ReadonlyArray<string> = ["findOneById"];

const JOB_FILES: Array<string> = [
  "App/FeatureSet/Workers/Jobs/Incident/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/IncidentStateTimeline/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/IncidentPublicNote/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/IncidentEpisode/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/IncidentEpisodePublicNote/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/IncidentEpisodeStateTimeline/SendNotificationToSubscribers.ts",
  "Common/Server/Utils/StatusPage/IncidentSubscriberAudienceBuilder.ts",
];

const POSTMORTEM_JOB_FILE: string =
  "App/FeatureSet/Workers/Jobs/Incident/SendPostmortemNotificationToSubscribers.ts";

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
    ts.ScriptKind.TS,
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

// `Service.method(...)` as [Service, method], else null.
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

/*
 * The values an identifier is given in the function it is used in: its
 * declaration's initializer and every plain assignment.
 */
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

// Whether a query expression is built by one of the rule's helpers.
function holdsTheRule(
  expression: ts.Expression,
  helpers: ReadonlyArray<string>,
  depth: number = 0,
): boolean {
  const value: ts.Expression = unwrap(expression);

  if (ts.isCallExpression(value)) {
    const callee: [string, string] | null = calleeOf(value);

    return Boolean(
      callee && callee[0] === RULE_HELPER && helpers.includes(callee[1]),
    );
  }

  if (ts.isIdentifier(value) && depth < 3) {
    const assigned: Array<ts.Expression> = valuesAssignedTo(value.text, value);

    return (
      assigned.length > 0 &&
      assigned.every((candidate: ts.Expression): boolean => {
        return holdsTheRule(candidate, helpers, depth + 1);
      })
    );
  }

  return false;
}

interface ReadScan {
  reads: Array<Finding>;
  withoutTheRule: Array<Finding>;
}

function scanStatusPageReads(relativePath: string): ReadScan {
  const scan: ReadScan = { reads: [], withoutTheRule: [] };
  const source: ts.SourceFile = parse(relativePath);

  visitAll(source, (node: ts.Node): void => {
    if (!ts.isCallExpression(node)) {
      return;
    }

    const callee: [string, string] | null = calleeOf(node);

    if (!callee || !ALLOWED_QUERY_HELPERS[callee[0]]) {
      return;
    }

    const [service, method] = callee;
    const finding: Finding = {
      file: relativePath,
      line: lineOf(node),
      text: `${service}.${method}`,
    };

    if (QUERYLESS_READS.includes(method)) {
      scan.reads.push(finding);
      scan.withoutTheRule.push(finding);
      return;
    }

    if (!QUERY_METHODS.includes(method)) {
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

    if (
      !queryValue ||
      !holdsTheRule(queryValue, ALLOWED_QUERY_HELPERS[service]!)
    ) {
      scan.withoutTheRule.push(finding);
    }
  });

  return scan;
}

interface SwitchScan {
  // `.isVisibleOnStatusPage` read off a record.
  switchReads: Array<Finding>;
  // A select (or query) naming isVisibleOnStatusPage without isPrivate.
  selectsWithoutPrivacy: Array<Finding>;
  // Calls to the rule.
  ruleCalls: Array<string>;
}

function scanSwitchUse(relativePath: string): SwitchScan {
  const scan: SwitchScan = {
    switchReads: [],
    selectsWithoutPrivacy: [],
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
      !propertyNamed(node, "isPrivate")
    ) {
      scan.selectsWithoutPrivacy.push({
        file: relativePath,
        line: lineOf(node),
        text: "isVisibleOnStatusPage without isPrivate",
      });
    }

    if (ts.isCallExpression(node)) {
      const callee: [string, string] | null = calleeOf(node);

      if (callee) {
        scan.ruleCalls.push(`${callee[0]}.${callee[1]}`);
      }
    }
  });

  return scan;
}

function describeFindings(findings: Array<Finding>): Array<string> {
  return findings.map((finding: Finding): string => {
    return `${finding.file}:${finding.line} ${finding.text}`;
  });
}

describe("A status page shows an incident or an episode by one rule: visible, and not private", () => {
  test.each(STATUS_PAGE_FILES)(
    "every incident and episode read in %s holds the rule in its query",
    (relativePath: string) => {
      const scan: ReadScan = scanStatusPageReads(relativePath);

      expect(describeFindings(scan.withoutTheRule)).toEqual([]);
    },
  );

  /*
   * An episode's incidentCount counts every incident in it, private ones
   * included: a status page never selects it.
   */
  test("no status page read selects an episode's incident count", () => {
    const source: ts.SourceFile = parse(STATUS_PAGE_FILES[0]!);
    const selected: Array<number> = [];

    visitAll(source, (node: ts.Node): void => {
      if (
        ts.isObjectLiteralExpression(node) &&
        propertyNamed(node, "incidentCount")
      ) {
        selected.push(lineOf(node));
      }
    });

    expect(selected).toEqual([]);
  });

  test("the scan sees the reads it is about (it would catch one)", () => {
    const scan: ReadScan = scanStatusPageReads(STATUS_PAGE_FILES[0]!);

    // Episode lists, the overview count and list, member incidents, attachments.
    expect(scan.reads.length).toBeGreaterThanOrEqual(7);
    expect(
      scan.reads.filter((finding: Finding): boolean => {
        return finding.text.startsWith("IncidentEpisodeService.");
      }).length,
    ).toBeGreaterThanOrEqual(5);
    expect(
      scan.reads.filter((finding: Finding): boolean => {
        return finding.text.startsWith("IncidentService.");
      }).length,
    ).toBeGreaterThanOrEqual(2);
  });

  test("a read whose query skips the rule is caught, and one built by it passes", () => {
    const probe: string = path.join(
      os.tmpdir(),
      `status-page-visibility-probe-${process.pid}.ts`,
    );

    fs.writeFileSync(
      probe,
      [
        "async function read(): Promise<void> {",
        "  await IncidentEpisodeService.findBy({ query: { isVisibleOnStatusPage: true } });",
        "  const ok = StatusPageVisibilityQuery.shownEpisodes({});",
        "  await IncidentEpisodeService.findBy({ query: ok });",
        "  await IncidentService.findOneById({ id: someId });",
        "  await IncidentService.countBy({ query: StatusPageVisibilityQuery.shownIncidents({}) });",
        "  await IncidentService.findBy({ query: StatusPageVisibilityQuery.shownEpisodes({}) });",
        "}",
      ].join("\n"),
    );

    try {
      const scan: ReadScan = scanStatusPageReads(probe);

      expect(
        scan.withoutTheRule.map((finding: Finding): string => {
          return `${finding.line} ${finding.text}`;
        }),
      ).toEqual([
        "2 IncidentEpisodeService.findBy",
        "5 IncidentService.findOneById",
        // An incident read through the episodes' helper is not the rule.
        "7 IncidentService.findBy",
      ]);
    } finally {
      fs.unlinkSync(probe);
    }
  });

  test.each(JOB_FILES)(
    "%s decides with StatusPageVisibility.isShown, never on the switch alone",
    (relativePath: string) => {
      const scan: SwitchScan = scanSwitchUse(relativePath);

      expect(describeFindings(scan.switchReads)).toEqual([]);
      expect(describeFindings(scan.selectsWithoutPrivacy)).toEqual([]);
      expect(scan.ruleCalls).toContain("StatusPageVisibility.isShown");
    },
  );

  test("the postmortem job decides with IncidentPostmortemPublication.isIncidentShown, the same rule", () => {
    const scan: SwitchScan = scanSwitchUse(POSTMORTEM_JOB_FILE);

    expect(describeFindings(scan.switchReads)).toEqual([]);
    expect(describeFindings(scan.selectsWithoutPrivacy)).toEqual([]);
    expect(scan.ruleCalls).toContain(
      "IncidentPostmortemPublication.isIncidentShown",
    );
  });

  test("the scan of the jobs would catch the switch read alone", () => {
    const probe: string = path.join(
      os.tmpdir(),
      `status-page-visibility-job-probe-${process.pid}.ts`,
    );

    fs.writeFileSync(
      probe,
      [
        "const select = { isVisibleOnStatusPage: true };",
        "if (!incident.isVisibleOnStatusPage) { skip(); }",
      ].join("\n"),
    );

    try {
      const scan: SwitchScan = scanSwitchUse(probe);

      expect(scan.switchReads).toHaveLength(1);
      expect(scan.selectsWithoutPrivacy).toHaveLength(1);
      expect(scan.ruleCalls).not.toContain("StatusPageVisibility.isShown");
    } finally {
      fs.unlinkSync(probe);
    }
  });
});
