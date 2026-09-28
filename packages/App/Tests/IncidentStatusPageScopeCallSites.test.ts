import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Only IncidentStatusPageScope (Common/Server/Utils/StatusPage) decides which
 * status pages an incident reaches. An incident limited to some status pages
 * (Incident.statusPages), and a page that only shows incidents limited to it
 * (StatusPage.onlyShowScopedIncidents), are respected only on code paths that
 * ask the helper; a path that works reach out for itself from the incident's
 * monitors shows the incident on - or emails the subscribers of - every page
 * that lists the monitor. That is the wrong-site delivery this feature exists
 * to prevent, so this test fails on such a path, in:
 *
 *   - the incident and episode subscriber jobs (Workers/Jobs/Incident*),
 *   - Common/Server/API/StatusPageAPI.ts (what public status pages show),
 *   - Common/Server/Services/StatusPageService.ts (report counts).
 *
 * What counts as working reach out from monitors, read from the TypeScript
 * AST at call sites - never by searching for the text "monitors:", which
 * also appears in the many select blocks that only read an incident's
 * monitors:
 *
 *   - an IncidentService find/count whose query has a `monitors` key, written
 *     inline, spread in, or built in a variable first (`query: incidentQuery`);
 *   - StatusPageResourceService.findByMonitors or findAllBy (the lookups from
 *     monitors to status page resources);
 *   - in the jobs, also StatusPageSubscriberService.
 *     getStatusPagesToSendNotification (the helper loads the pages, so a job
 *     that loads them itself skips the scope), and an episode member lookup
 *     that selects its incidents' monitors (use
 *     IncidentStatusPageScope.getEpisodeMemberIncidents).
 *
 * The status page display queries and the report counts go through the
 * helper too (findIncidentsForStatusPage, findOneIncidentForStatusPage,
 * countIncidentsForStatusPage), so in those files no call site may work out
 * reach from monitors at all. What they may still do is read an episode's
 * member incidents by id, to map the episode to the page's monitors - but
 * only as the incidents given to StatusPageAPI.keepMemberIncidentsInScope,
 * with the scope columns selected (INCIDENT_SCOPE_SELECT), so that a member
 * limited to other status pages is dropped and the scope columns are removed
 * before anything is serialized. And an incident is serialized for a public
 * page only by serializeIncidentsForStatusPage, which removes the scope
 * columns whatever a select brought in.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..");
const JOBS_DIR: string = path.join(
  PACKAGES_DIR,
  "App",
  "FeatureSet",
  "Workers",
  "Jobs",
);

// The incident and episode subscriber jobs, found as Jobs/Incident*/Send*ToSubscribers.ts.
const EXPECTED_JOB_FILES: Array<string> = [
  "App/FeatureSet/Workers/Jobs/Incident/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/Incident/SendPostmortemNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/IncidentEpisode/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/IncidentEpisodePublicNote/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/IncidentEpisodeStateTimeline/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/IncidentPublicNote/SendNotificationToSubscribers.ts",
  "App/FeatureSet/Workers/Jobs/IncidentStateTimeline/SendNotificationToSubscribers.ts",
];

const JOB_FILE_PATTERN: RegExp = /^Send.*ToSubscribers\.ts$/;

const STATUS_PAGE_FILES: Array<string> = [
  "Common/Server/API/StatusPageAPI.ts",
  "Common/Server/Services/StatusPageService.ts",
];

const HELPER_FILE: string =
  "Common/Server/Utils/StatusPage/IncidentStatusPageScope.ts";

/*
 * The methods that may read incidents directly in the status page files, and
 * what they must do with them. See the top of this file.
 */
const MEMBER_INCIDENT_FILTER: string = "keepMemberIncidentsInScope";
const INCIDENT_SERIALIZER: string = "serializeIncidentsForStatusPage";
const INCIDENT_SCOPE_SELECT_NAME: string = "INCIDENT_SCOPE_SELECT";

// The IncidentService calls that take a query.
const INCIDENT_QUERY_METHODS: ReadonlyArray<string> = [
  "findBy",
  "findAllBy",
  "findOneBy",
  "countBy",
  "findOneOrNoneBy",
  "searchBy",
];

// Lookups from monitors to status page resources.
const RESOURCE_REACH_METHODS: ReadonlyArray<string> = [
  "findByMonitors",
  "findAllBy",
];

interface CallSite {
  file: string;
  line: number;
  within: string;
  call: string;
}

// A direct incident read, or an incident serialization, that breaks a rule.
interface Violation {
  file: string;
  line: number;
  within: string;
  call: string;
  problem: string;
}

interface ScanOptions {
  // The job-only rules (page loading and episode members through the helper).
  isJob: boolean;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
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

/*
 * The object literals an identifier is given, within the function the use
 * is in (its declarations and plain assignments), else anywhere in the file.
 */
function objectLiteralsAssignedTo(
  name: string,
  from: ts.Node,
): Array<ts.ObjectLiteralExpression> {
  const collect: (scope: ts.Node) => Array<ts.ObjectLiteralExpression> = (
    scope: ts.Node,
  ): Array<ts.ObjectLiteralExpression> => {
    const found: Array<ts.ObjectLiteralExpression> = [];

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name &&
        node.initializer
      ) {
        const value: ts.Expression = unwrap(node.initializer);
        if (ts.isObjectLiteralExpression(value)) {
          found.push(value);
        }
      }

      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(unwrap(node.left)) &&
        (unwrap(node.left) as ts.Identifier).text === name
      ) {
        const value: ts.Expression = unwrap(node.right);
        if (ts.isObjectLiteralExpression(value)) {
          found.push(value);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(scope);
    return found;
  };

  const local: Array<ts.ObjectLiteralExpression> = collect(
    nearestFunction(from),
  );

  return local.length > 0 ? local : collect(from.getSourceFile());
}

// The object literals an expression can be, following identifiers.
function objectLiteralsOf(
  expression: ts.Expression | undefined,
  depth: number = 0,
): Array<ts.ObjectLiteralExpression> {
  if (!expression || depth > 5) {
    return [];
  }

  const value: ts.Expression = unwrap(expression);

  if (ts.isObjectLiteralExpression(value)) {
    return [value];
  }

  if (ts.isIdentifier(value)) {
    return objectLiteralsAssignedTo(value.text, value);
  }

  return [];
}

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (
    (ts.isPropertyAssignment(property) ||
      ts.isShorthandPropertyAssignment(property) ||
      ts.isMethodDeclaration(property)) &&
    property.name
  ) {
    if (
      ts.isIdentifier(property.name) ||
      ts.isStringLiteral(property.name) ||
      ts.isNoSubstitutionTemplateLiteral(property.name)
    ) {
      return property.name.text;
    }
  }

  return null;
}

// The value a property of these object literals is given, if any.
function propertyValues(
  literals: Array<ts.ObjectLiteralExpression>,
  name: string,
  depth: number = 0,
): Array<ts.Expression> {
  const values: Array<ts.Expression> = [];

  for (const literal of literals) {
    for (const property of literal.properties) {
      if (propertyName(property) === name) {
        if (ts.isPropertyAssignment(property)) {
          values.push(property.initializer);
        } else if (ts.isShorthandPropertyAssignment(property)) {
          values.push(property.name);
        }
      }

      if (ts.isSpreadAssignment(property) && depth < 5) {
        values.push(
          ...propertyValues(
            objectLiteralsOf(property.expression, depth + 1),
            name,
            depth + 1,
          ),
        );
      }
    }
  }

  return values;
}

// Whether any of these object literals has the key, directly or spread in.
function hasKey(
  literals: Array<ts.ObjectLiteralExpression>,
  key: string,
): boolean {
  return propertyValues(literals, key).length > 0;
}

// Whether the key appears anywhere inside these object literals (a select).
function hasKeyDeep(
  literals: Array<ts.ObjectLiteralExpression>,
  key: string,
  depth: number = 0,
): boolean {
  if (depth > 5) {
    return false;
  }

  for (const literal of literals) {
    for (const property of literal.properties) {
      if (propertyName(property) === key) {
        return true;
      }

      if (ts.isPropertyAssignment(property)) {
        if (
          hasKeyDeep(objectLiteralsOf(property.initializer), key, depth + 1)
        ) {
          return true;
        }
      }

      if (ts.isSpreadAssignment(property)) {
        if (hasKeyDeep(objectLiteralsOf(property.expression), key, depth + 1)) {
          return true;
        }
      }
    }
  }

  return false;
}

// The name of the method or function a call site is in.
function enclosingName(node: ts.Node): string {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (
      (ts.isMethodDeclaration(current) ||
        ts.isFunctionDeclaration(current) ||
        ts.isGetAccessorDeclaration(current)) &&
      current.name
    ) {
      return current.name.getText();
    }

    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      current.initializer &&
      (ts.isArrowFunction(unwrap(current.initializer)) ||
        ts.isFunctionExpression(unwrap(current.initializer)))
    ) {
      return current.name.text;
    }

    if (ts.isConstructorDeclaration(current)) {
      return "constructor";
    }

    current = current.parent;
  }

  return "(top level)";
}

// The call sites in one source file that work out reach from monitors.
function findReachCallSites(data: {
  file: string;
  text: string;
  options: ScanOptions;
}): Array<CallSite> {
  const source: ts.SourceFile = ts.createSourceFile(
    data.file,
    data.text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const sites: Array<CallSite> = [];

  const record: (node: ts.CallExpression, call: string) => void = (
    node: ts.CallExpression,
    call: string,
  ): void => {
    sites.push({
      file: data.file,
      line:
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      within: enclosingName(node),
      call: call,
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression)
    ) {
      const service: string = node.expression.expression.text;
      const method: string = node.expression.name.text;
      const call: string = `${service}.${method}`;
      const argument: Array<ts.ObjectLiteralExpression> = objectLiteralsOf(
        node.arguments[0],
      );

      if (
        service === "IncidentService" &&
        INCIDENT_QUERY_METHODS.includes(method)
      ) {
        const queries: Array<ts.ObjectLiteralExpression> = propertyValues(
          argument,
          "query",
        ).flatMap((value: ts.Expression) => {
          return objectLiteralsOf(value);
        });

        if (hasKey(queries, "monitors")) {
          record(node, call);
        }
      }

      if (
        service === "StatusPageResourceService" &&
        RESOURCE_REACH_METHODS.includes(method)
      ) {
        record(node, call);
      }

      if (data.options.isJob) {
        if (
          service === "StatusPageSubscriberService" &&
          method === "getStatusPagesToSendNotification"
        ) {
          record(node, call);
        }

        if (service === "IncidentEpisodeMemberService") {
          const selects: Array<ts.ObjectLiteralExpression> = propertyValues(
            argument,
            "select",
          ).flatMap((value: ts.Expression) => {
            return objectLiteralsOf(value);
          });

          if (hasKeyDeep(selects, "monitors")) {
            record(node, call);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return sites;
}

function readPackageFile(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

function discoverJobFiles(): Array<string> {
  return fs
    .readdirSync(JOBS_DIR, { withFileTypes: true })
    .filter((entry: fs.Dirent): boolean => {
      return entry.isDirectory() && entry.name.startsWith("Incident");
    })
    .flatMap((entry: fs.Dirent): Array<string> => {
      return fs
        .readdirSync(path.join(JOBS_DIR, entry.name))
        .filter((file: string): boolean => {
          return JOB_FILE_PATTERN.test(file);
        })
        .map((file: string): string => {
          return path
            .relative(PACKAGES_DIR, path.join(JOBS_DIR, entry.name, file))
            .split(path.sep)
            .join("/");
        });
    })
    .sort();
}

// The call a node sits in the arguments of, up to the function it is in.
function isArgumentOfCallTo(node: ts.Node, methodName: string): boolean {
  let current: ts.Node | undefined = node.parent;

  while (current && !ts.isFunctionLike(current)) {
    if (
      ts.isCallExpression(current) &&
      current.arguments.some((argument: ts.Expression): boolean => {
        return argument.pos <= node.pos && node.end <= argument.end;
      })
    ) {
      const callee: ts.Expression = unwrap(current.expression);

      const name: string | null = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : null;

      if (name === methodName) {
        return true;
      }
    }

    current = current.parent;
  }

  return false;
}

// Whether these object literals spread in the named identifier.
function spreadsIdentifier(
  literals: Array<ts.ObjectLiteralExpression>,
  name: string,
): boolean {
  return literals.some((literal: ts.ObjectLiteralExpression): boolean => {
    return literal.properties.some(
      (property: ts.ObjectLiteralElementLike): boolean => {
        return (
          ts.isSpreadAssignment(property) &&
          ts.isIdentifier(unwrap(property.expression)) &&
          (unwrap(property.expression) as ts.Identifier).text === name
        );
      },
    );
  });
}

/*
 * The incident reads in a status page file that do not go through
 * IncidentStatusPageScope and break the rule for them: each must be the
 * incidents given to keepMemberIncidentsInScope, and must select the scope
 * columns that filter reads.
 */
function findUnscopedIncidentReads(data: {
  file: string;
  text: string;
}): Array<Violation> {
  const source: ts.SourceFile = ts.createSourceFile(
    data.file,
    data.text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const violations: Array<Violation> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "IncidentService" &&
      INCIDENT_QUERY_METHODS.includes(node.expression.name.text)
    ) {
      const call: string = `IncidentService.${node.expression.name.text}`;
      const selects: Array<ts.ObjectLiteralExpression> = propertyValues(
        objectLiteralsOf(node.arguments[0]),
        "select",
      ).flatMap((value: ts.Expression) => {
        return objectLiteralsOf(value);
      });

      const problems: Array<string> = [];

      if (!isArgumentOfCallTo(node, MEMBER_INCIDENT_FILTER)) {
        problems.push(`not given to ${MEMBER_INCIDENT_FILTER}`);
      }

      const selectsScope: boolean =
        spreadsIdentifier(selects, INCIDENT_SCOPE_SELECT_NAME) ||
        (hasKey(selects, "isScopedToStatusPages") &&
          hasKey(selects, "statusPages"));

      if (!selectsScope) {
        problems.push("does not select the scope columns");
      }

      for (const problem of problems) {
        violations.push({
          file: data.file,
          line:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1,
          within: enclosingName(node),
          call: call,
          problem: problem,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return violations;
}

/*
 * Incidents turned into JSON (BaseModel.toJSON, toJSONArray or toJSONObject
 * with the Incident model) anywhere but the serializer that removes the
 * scope columns.
 */
function findIncidentSerializationsOutsideSerializer(data: {
  file: string;
  text: string;
}): Array<Violation> {
  const source: ts.SourceFile = ts.createSourceFile(
    data.file,
    data.text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const violations: Array<Violation> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "BaseModel" &&
      ["toJSON", "toJSONArray", "toJSONObject"].includes(
        node.expression.name.text,
      ) &&
      node.arguments[1] &&
      ts.isIdentifier(unwrap(node.arguments[1])) &&
      (unwrap(node.arguments[1]) as ts.Identifier).text === "Incident"
    ) {
      const within: string = enclosingName(node);

      if (within !== INCIDENT_SERIALIZER) {
        violations.push({
          file: data.file,
          line:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1,
          within: within,
          call: `BaseModel.${node.expression.name.text}`,
          problem: `serializes an incident outside ${INCIDENT_SERIALIZER}`,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return violations;
}

// The source of a method, found by name.
function methodText(text: string, methodName: string): string {
  const source: ts.SourceFile = ts.createSourceFile(
    "Method.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  let found: string = "";

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isMethodDeclaration(node) &&
      node.name &&
      node.name.getText(source) === methodName
    ) {
      found = node.getText(source);
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

function describeViolations(violations: Array<Violation>): string {
  return violations
    .map((violation: Violation): string => {
      return `${violation.file}:${violation.line} ${violation.call} in ${violation.within}: ${violation.problem}`;
    })
    .join("\n");
}

function describeSites(sites: Array<CallSite>): string {
  return sites
    .map((site: CallSite): string => {
      return `${site.file}:${site.line} ${site.call} in ${site.within}`;
    })
    .join("\n");
}

describe("Incident reach is decided only by IncidentStatusPageScope", () => {
  test("finds every incident and episode subscriber job", () => {
    expect(discoverJobFiles()).toEqual([...EXPECTED_JOB_FILES].sort());
  });

  test.each(EXPECTED_JOB_FILES)(
    "%s works out no status page reach of its own",
    (file: string) => {
      const sites: Array<CallSite> = findReachCallSites({
        file: file,
        text: readPackageFile(file),
        options: { isJob: true },
      });

      expect(describeSites(sites)).toBe("");
    },
  );

  test.each(EXPECTED_JOB_FILES)(
    "%s asks IncidentStatusPageScope which pages to tell",
    (file: string) => {
      const text: string = readPackageFile(file);

      expect(text).toContain(
        "IncidentStatusPageScope.resolvePagesForIncidents(",
      );
      expect(text).toContain(
        'from "Common/Server/Utils/StatusPage/IncidentStatusPageScope"',
      );
    },
  );

  test("the status page API and service work out no status page reach of their own", () => {
    const sites: Array<CallSite> = STATUS_PAGE_FILES.flatMap(
      (file: string): Array<CallSite> => {
        return findReachCallSites({
          file: file,
          text: readPackageFile(file),
          options: { isJob: false },
        });
      },
    );

    /*
     * A site here decides from an incident's monitors what a status page
     * shows or counts. Use IncidentStatusPageScope.findIncidentsForStatusPage,
     * findOneIncidentForStatusPage or countIncidentsForStatusPage instead.
     */
    expect(describeSites(sites)).toBe("");
  });

  test("the status page API and service read incidents directly only as episode members, filtered by scope", () => {
    const violations: Array<Violation> = STATUS_PAGE_FILES.flatMap(
      (file: string): Array<Violation> => {
        return findUnscopedIncidentReads({
          file: file,
          text: readPackageFile(file),
        });
      },
    );

    expect(describeViolations(violations)).toBe("");
  });

  test("the status page API serializes incidents only through the serializer that removes the scope columns", () => {
    const file: string = "Common/Server/API/StatusPageAPI.ts";

    expect(
      describeViolations(
        findIncidentSerializationsOutsideSerializer({
          file: file,
          text: readPackageFile(file),
        }),
      ),
    ).toBe("");
  });

  test("the serializer and the member filter remove the scope columns, and the filter applies the scope", () => {
    const text: string = readPackageFile("Common/Server/API/StatusPageAPI.ts");

    const serializer: string = methodText(text, INCIDENT_SERIALIZER);
    expect(serializer).toContain("IncidentStatusPageScope.removeScopeColumns(");

    const memberFilter: string = methodText(text, MEMBER_INCIDENT_FILTER);
    expect(memberFilter).toContain(
      "IncidentStatusPageScope.isIncidentInScope(",
    );
    expect(memberFilter).toContain(
      "IncidentStatusPageScope.removeScopeColumns(",
    );
  });

  test("the status page API and service ask IncidentStatusPageScope what a page shows and counts", () => {
    const api: string = readPackageFile("Common/Server/API/StatusPageAPI.ts");
    expect(api).toContain(
      "IncidentStatusPageScope.findIncidentsForStatusPage(",
    );
    expect(api).toContain(
      "IncidentStatusPageScope.findOneIncidentForStatusPage(",
    );

    const service: string = readPackageFile(
      "Common/Server/Services/StatusPageService.ts",
    );
    expect(service).toContain(
      "IncidentStatusPageScope.countIncidentsForStatusPage(",
    );
  });

  test("the helper is where the monitor lookups live", () => {
    const sites: Array<CallSite> = findReachCallSites({
      file: HELPER_FILE,
      text: readPackageFile(HELPER_FILE),
      options: { isJob: false },
    });

    expect(
      sites.map((site: CallSite): string => {
        return site.call;
      }),
    ).toContain("StatusPageResourceService.findByMonitors");
  });
});

/*
 * The scanner itself, on small sources: it must find reach worked out from
 * monitors however the query is written, and must not mistake a select of
 * monitors for it.
 */
describe("the reach call-site scanner", () => {
  function scan(text: string, isJob: boolean = false): Array<string> {
    return findReachCallSites({
      file: "Example.ts",
      text: text,
      options: { isJob: isJob },
    }).map((site: CallSite): string => {
      return `${site.call} in ${site.within}`;
    });
  }

  test("finds a monitors key written into the query", () => {
    expect(
      scan(`
        class A {
          public async load(): Promise<void> {
            await IncidentService.findBy({
              query: { monitors: ids as any, projectId: p },
              select: { _id: true },
              limit: 10,
              skip: 0,
              props: { isRoot: true },
            });
          }
        }
      `),
    ).toEqual(["IncidentService.findBy in load"]);
  });

  test("finds a query built in a variable first, however it was reassigned", () => {
    expect(
      scan(`
        async function getIncidents(): Promise<void> {
          let incidentQuery: Query<Incident> = { projectId: p };
          if (one) {
            incidentQuery = { monitors: ids as any, _id: one };
          }
          await IncidentService.findBy({ query: incidentQuery, limit: 1, skip: 0, props: {} });
        }
      `),
    ).toEqual(["IncidentService.findBy in getIncidents"]);
  });

  test("finds a monitors key spread into the query, and a query passed by shorthand", () => {
    expect(
      scan(`
        async function spread(): Promise<void> {
          const base = { monitors: ids };
          await IncidentService.countBy({ query: { ...base, projectId: p }, props: {} });
        }
        async function shorthand(): Promise<void> {
          const query = { monitors: ids };
          await IncidentService.findOneBy({ query, props: {} });
        }
      `),
    ).toEqual([
      "IncidentService.countBy in spread",
      "IncidentService.findOneBy in shorthand",
    ]);
  });

  test("finds the whole find argument built in a variable", () => {
    expect(
      scan(`
        async function built(): Promise<void> {
          const args = { query: { monitors: ids }, props: {} };
          await IncidentService.findAllBy(args);
        }
      `),
    ).toEqual(["IncidentService.findAllBy in built"]);
  });

  test("a select of monitors, a string mentioning them or another key is not reach", () => {
    expect(
      scan(`
        async function members(): Promise<void> {
          const note = "monitors: are selected below";
          await IncidentService.findBy({
            query: { _id: QueryHelper.any(ids), monitorsCount: 2 },
            select: { _id: true, monitors: { _id: true } },
            limit: 10,
            skip: 0,
            props: {},
          });
          await IncidentService.updateOneById({ id, data: { monitors: [] }, props: {} });
        }
      `),
    ).toEqual([]);
  });

  test("finds the monitor-to-resource lookups, but not a page's own resources", () => {
    expect(
      scan(`
        async function resources(): Promise<void> {
          await StatusPageResourceService.findByMonitors({ monitors, select: {} });
          await StatusPageResourceService.findAllBy({ query: { monitorId: x }, props: {} });
          await StatusPageResourceService.findBy({ query: { statusPageId: s }, props: {} });
        }
      `),
    ).toEqual([
      "StatusPageResourceService.findByMonitors in resources",
      "StatusPageResourceService.findAllBy in resources",
    ]);
  });

  test("in a job, loading the pages or the episode's monitors directly is reach too", () => {
    const text: string = `
      const run = async (): Promise<void> => {
        await StatusPageSubscriberService.getStatusPagesToSendNotification(ids);
        await IncidentEpisodeMemberService.findBy({
          query: { incidentEpisodeId: e },
          select: { incident: { monitors: { _id: true } } },
          props: {},
        });
        await IncidentEpisodeMemberService.findBy({
          query: { incidentEpisodeId: e },
          select: { incidentId: true },
          props: {},
        });
      };
    `;

    expect(scan(text, true)).toEqual([
      "StatusPageSubscriberService.getStatusPagesToSendNotification in run",
      "IncidentEpisodeMemberService.findBy in run",
    ]);
    // Outside the jobs those two are not this test's business.
    expect(scan(text, false)).toEqual([]);
  });
});

/*
 * The rules for the status page files, on small sources: incidents read
 * directly must go through the member filter with their scope selected, and
 * be serialized only by the serializer that strips the scope columns.
 */
describe("the status page incident read and serialization scanners", () => {
  function reads(text: string): Array<string> {
    return findUnscopedIncidentReads({
      file: "Example.ts",
      text: text,
    }).map((violation: Violation): string => {
      return `${violation.call} in ${violation.within}: ${violation.problem}`;
    });
  }

  function serializations(text: string): Array<string> {
    return findIncidentSerializationsOutsideSerializer({
      file: "Example.ts",
      text: text,
    }).map((violation: Violation): string => {
      return `${violation.call} in ${violation.within}`;
    });
  }

  test("a member read given to the filter with the scope select spread in passes", () => {
    expect(
      reads(`
        class A {
          public async getEpisodes(): Promise<void> {
            members = this.keepMemberIncidentsInScope({
              incidents: await IncidentService.findBy({
                query: { _id: QueryHelper.any(ids) },
                select: { _id: true, monitors: { _id: true }, ...INCIDENT_SCOPE_SELECT },
                limit: 10,
                skip: 0,
                props: { isRoot: true },
              }),
              statusPage: page,
            });
          }
        }
      `),
    ).toEqual([]);
  });

  test("the scope columns may also be selected by name", () => {
    expect(
      reads(`
        class A {
          public async load(): Promise<void> {
            members = this.keepMemberIncidentsInScope({
              incidents: await IncidentService.findBy({
                query: { _id: x },
                select: { isScopedToStatusPages: true, statusPages: { _id: true } },
                props: {},
              }),
              statusPage: page,
            });
          }
        }
      `),
    ).toEqual([]);
  });

  test("a read not given to the filter, or without the scope columns, is flagged", () => {
    expect(
      reads(`
        class A {
          public async unfiltered(): Promise<void> {
            const incidents = await IncidentService.findBy({
              query: { _id: x },
              select: { _id: true, ...INCIDENT_SCOPE_SELECT },
              props: {},
            });
            members = this.keepMemberIncidentsInScope({ incidents, statusPage: page });
          }
          public async unselected(): Promise<void> {
            members = this.keepMemberIncidentsInScope({
              incidents: await IncidentService.findBy({
                query: { _id: x },
                select: { _id: true, isScopedToStatusPages: true },
                props: {},
              }),
              statusPage: page,
            });
          }
          public async count(): Promise<void> {
            await IncidentService.countBy({ query: { projectId: p }, props: {} });
          }
        }
      `),
    ).toEqual([
      "IncidentService.findBy in unfiltered: not given to keepMemberIncidentsInScope",
      "IncidentService.findBy in unselected: does not select the scope columns",
      "IncidentService.countBy in count: not given to keepMemberIncidentsInScope",
      "IncidentService.countBy in count: does not select the scope columns",
    ]);
  });

  test("reads through IncidentStatusPageScope are not direct reads", () => {
    expect(
      reads(`
        async function list(): Promise<void> {
          await IncidentStatusPageScope.findIncidentsForStatusPage({ statusPage, query: { monitors: ids }, select: {}, limit: 1, props: {} });
          await IncidentStatusPageScope.countIncidentsForStatusPage({ statusPage, projectId, query: {} });
        }
      `),
    ).toEqual([]);
  });

  test("incidents turned into JSON outside the serializer are flagged, other models are not", () => {
    expect(
      serializations(`
        class A {
          private serializeIncidentsForStatusPage(incidents: Array<Incident>): JSONArray {
            return incidents.map((incident: Incident) => {
              return BaseModel.toJSON(incident, Incident);
            });
          }
          public async overview(): Promise<JSONObject> {
            return {
              timelineIncidents: BaseModel.toJSONArray(timeline, Incident),
              one: BaseModel.toJSONObject(incident, Incident),
              episodes: BaseModel.toJSONArray(episodes, IncidentEpisode),
              notes: BaseModel.toJSONArray(notes, IncidentPublicNote),
            };
          }
        }
      `),
    ).toEqual([
      "BaseModel.toJSONArray in overview",
      "BaseModel.toJSONObject in overview",
    ]);
  });

  test("finds a method's source by name", () => {
    const text: string = `
      class A {
        private one(): void { first(); }
        private keepMemberIncidentsInScope(): void { IncidentStatusPageScope.isIncidentInScope(a, b); }
      }
    `;

    expect(methodText(text, "keepMemberIncidentsInScope")).toContain(
      "IncidentStatusPageScope.isIncidentInScope(",
    );
    expect(methodText(text, "one")).not.toContain("isIncidentInScope");
    expect(methodText(text, "missing")).toBe("");
  });
});
