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
 * The status page display queries and report counts are converted to the
 * helper in the next stage of #4035, so their current call sites are listed
 * in PENDING_CONVERSION below. The list must match what is found exactly: a
 * new site fails the test, and so does a listed site that no longer exists,
 * so converting a site means deleting its entry, and the list can only
 * shrink. When it is empty, it stays empty.
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
 * The call sites that still work out an incident's reach from its monitors,
 * by file, enclosing method and call, with how many there are. Each is
 * converted to IncidentStatusPageScope in the next stage of #4035 (status page
 * display: findIncidentsForStatusPage / findOneIncidentForStatusPage; report
 * counts: countIncidentsForStatusPage), which must empty this list.
 *
 * Not enforceable here, and so also on that stage's list: the episode member
 * fetches in getEpisodes and buildOverviewResponse read their incidents by id
 * and select monitors to map them to pages. They must add the scope columns
 * and apply IncidentStatusPageScope.isIncidentInScope.
 */
const PENDING_CONVERSION: Array<CallSiteCount> = [
  {
    file: "Common/Server/API/StatusPageAPI.ts",
    within: "getIncidents",
    call: "IncidentService.findBy",
    count: 2,
  },
  {
    file: "Common/Server/API/StatusPageAPI.ts",
    within: "getEpisodes",
    call: "IncidentService.findBy",
    count: 1,
  },
  {
    file: "Common/Server/API/StatusPageAPI.ts",
    within: "buildOverviewResponse",
    call: "IncidentService.findBy",
    count: 3,
  },
  {
    file: "Common/Server/API/StatusPageAPI.ts",
    within: "getIncidentPostmortemAttachment",
    call: "IncidentService.findOneBy",
    count: 1,
  },
  {
    file: "Common/Server/API/StatusPageAPI.ts",
    within: "getIncidentPublicNoteAttachment",
    call: "IncidentService.findOneBy",
    count: 1,
  },
  {
    file: "Common/Server/API/StatusPageAPI.ts",
    within: "getIncidentEpisodePublicNoteAttachment",
    call: "IncidentService.findOneBy",
    count: 1,
  },
  {
    file: "Common/Server/Services/StatusPageService.ts",
    within: "getIncidentCountByMonitorIds",
    call: "IncidentService.countBy",
    count: 1,
  },
];

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

interface CallSiteCount {
  file: string;
  within: string;
  call: string;
  count: number;
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

function countByLocation(sites: Array<CallSite>): Array<CallSiteCount> {
  const counts: Map<string, CallSiteCount> = new Map();

  for (const site of sites) {
    const key: string = `${site.file}|${site.within}|${site.call}`;
    const existing: CallSiteCount | undefined = counts.get(key);

    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, {
        file: site.file,
        within: site.within,
        call: site.call,
        count: 1,
      });
    }
  }

  return sortCounts(Array.from(counts.values()));
}

function sortCounts(counts: Array<CallSiteCount>): Array<CallSiteCount> {
  return [...counts].sort((a: CallSiteCount, b: CallSiteCount): number => {
    return `${a.file}|${a.within}|${a.call}`.localeCompare(
      `${b.file}|${b.within}|${b.call}`,
    );
  });
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

  test("the status page API and service work out reach only at the sites pending conversion", () => {
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
     * A difference here is either a new call site that works out reach from
     * monitors (use IncidentStatusPageScope instead), or a converted one
     * whose PENDING_CONVERSION entry should now be removed.
     */
    expect(countByLocation(sites)).toEqual(sortCounts(PENDING_CONVERSION));
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
