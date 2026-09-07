import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ModelAPI.getCommonHeaders() is the only producer of a `tenantid` header in
 * the codebase, and ModelAPI attaches it to every request it makes itself. A
 * custom route reached with a raw API.post/API.get from
 * Common/UI/Utils/API/API gets no such header — BaseAPI.getHeaders() adds only
 * the default and permission-hash headers.
 *
 * When a project-scoped route is called without it,
 * ProjectMiddleware.getProjectId returns null, getUserMiddleware never
 * populates userTenantAccessPermission, and the eventual tenant-scoped read
 * fails with "You do not have permissions to read <model>. You need one of
 * these permissions: ..." naming permissions the caller actually holds.
 *
 * These pages are React components with no extractable logic — the header is a
 * property of an object literal — and the App suite runs in a plain Node
 * environment with no renderer. So this reads the sources and asserts the
 * exact expression, the same way NetworkSitePageInvariants.test.ts pins the
 * defects that live in a prop or a hook dependency.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const TENANT_HEADER: string = "headers: ModelAPI.getCommonHeaders(),";

/*
 * Routes that thread CommonAPI.getDatabaseCommonInteractionProps(req) into a
 * tenant-scoped read or write. Every raw API call reaching one of these has to
 * send the tenant header. Each is also guarded server-side by
 * CommonAPI.assertTenantScoped, so a regression here reports the real cause
 * rather than a misleading permissions list.
 */
const PROJECT_SCOPED_ROUTES: Array<string> = [
  "/sync-to-linked-monitors",
  "/sync-to-monitor/",
  "/link-monitor/",
  "/unlink-monitor/",
  "/alert/generate-note-from-ai/",
  "/incident/generate-note-from-ai/",
  "/scheduled-maintenance/generate-note-from-ai/",
  "/incident/generate-postmortem-from-ai/",
  "/incident-episode/generate-postmortem-from-ai/",
];

/*
 * The pages known to reach one of those routes. These name FILES rather than
 * counting calls: a page that grows a fourth sync button is the normal way this
 * feature area changes, and the new call is then checked for the header like
 * the rest. What the list is here to catch is the opposite — a page dropping
 * out of the sweep entirely, which is the shape a broken scanner takes and
 * which would otherwise let every assertion below pass over an empty set.
 *
 * `routePrefix` belongs to the per-page describe at the bottom of this file and
 * to nothing else. It is the prefix that covers every raw call the page makes,
 * which is what lets that describe demand a resolved route for all of them
 * rather than only for the ones the scanner happened to recognise. It is
 * deliberately not a member of PROJECT_SCOPED_ROUTES: "/monitor-template/"
 * stands for a whole family of routes, so a new /monitor-template/... call is
 * covered the day it lands. The sweep matches PROJECT_SCOPED_ROUTES itself and
 * never reads this field.
 */
interface GuardedPage {
  page: Array<string>;
  routePrefix: string;
}

const GUARDED_PAGES: Array<GuardedPage> = [
  {
    page: ["Pages", "Monitor", "Settings", "MonitorTemplatesView.tsx"],
    routePrefix: "/monitor-template/",
  },
  {
    page: ["Pages", "Alerts", "View", "InternalNote.tsx"],
    routePrefix: "/alert/generate-note-from-ai/",
  },
  {
    page: ["Pages", "Incidents", "View", "InternalNote.tsx"],
    routePrefix: "/incident/generate-note-from-ai/",
  },
  {
    page: ["Pages", "Incidents", "View", "PublicNote.tsx"],
    routePrefix: "/incident/generate-note-from-ai/",
  },
  {
    page: ["Pages", "Incidents", "View", "Postmortem.tsx"],
    routePrefix: "/incident/generate-postmortem-from-ai/",
  },
  {
    page: ["Pages", "Incidents", "EpisodeView", "Postmortem.tsx"],
    routePrefix: "/incident-episode/generate-postmortem-from-ai/",
  },
  {
    page: ["Pages", "ScheduledMaintenanceEvents", "View", "InternalNote.tsx"],
    routePrefix: "/scheduled-maintenance/generate-note-from-ai/",
  },
  {
    page: ["Pages", "ScheduledMaintenanceEvents", "View", "PublicNote.tsx"],
    routePrefix: "/scheduled-maintenance/generate-note-from-ai/",
  },
];

interface RawApiCall {
  file: string;
  verb: string;
  body: string;

  /*
   * False when the paren walk below ran off the end of the file without
   * closing the argument list. Such a call still gets pushed — dropping it
   * would take it out of the sweep silently — but its `body` is then the whole
   * rest of the file, which will contain some other call's `headers:` line and
   * would turn the header assertions into a false pass. So it is reported
   * instead, by the scanner-health test.
   */
  balanced: boolean;
}

const SOURCE_FILE: RegExp = /\.tsx?$/;
const WHITESPACE: RegExp = /\s/;
const RAW_API_CALL_SITE: string =
  "(^|[^A-Za-z0-9_])API\\.(post|get|put|delete|patch)\\s*[<(]";

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function listSourceFiles(dir: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      found.push(...listSourceFiles(full));
    } else if (SOURCE_FILE.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
}

/*
 * Pull out every raw `API.<verb>(...)` call — the ones that go through
 * Common/UI/Utils/API/API rather than ModelAPI. The leading character class
 * keeps `ModelAPI.post` and `BaseAPI.get` out of the results.
 *
 * The argument object is matched by balancing parentheses rather than by
 * regex so that nested calls inside `url:`/`data:` cannot end the match early.
 * The walk counts parentheses without understanding string literals, so an
 * unmatched "(" inside a string would read as an argument list that never
 * closes. Nothing in the Dashboard sources does that today, and if something
 * ever does it is reported by the scanner-health test rather than quietly
 * changing what the header assertions see.
 */
function readRawApiCalls(file: string): Array<RawApiCall> {
  const source: string = fs.readFileSync(file, "utf8");
  const calls: Array<RawApiCall> = [];
  const callSite: RegExp = new RegExp(RAW_API_CALL_SITE, "g");

  let match: RegExpExecArray | null = callSite.exec(source);

  while (match !== null) {
    let index: number = match.index + match[0].length - 1;

    // Step over an explicit generic argument, e.g. API.post<JSONObject>(...).
    if (source[index] === "<") {
      let angleDepth: number = 0;

      while (index < source.length) {
        if (source[index] === "<") {
          angleDepth++;
        } else if (source[index] === ">") {
          angleDepth--;

          if (angleDepth === 0) {
            index++;
            break;
          }
        }

        index++;
      }

      while (WHITESPACE.test(source[index] || "")) {
        index++;
      }
    }

    if (source[index] === "(") {
      let parenDepth: number = 0;
      let end: number = index;
      let balanced: boolean = false;

      for (; end < source.length; end++) {
        if (source[end] === "(") {
          parenDepth++;
        } else if (source[end] === ")") {
          parenDepth--;

          if (parenDepth === 0) {
            end++;
            balanced = true;
            break;
          }
        }
      }

      calls.push({
        file: path.relative(DASHBOARD_SRC, file),
        verb: match[2]!,
        body: squash(source.slice(index, end)),
        balanced,
      });
    }

    match = callSite.exec(source);
  }

  return calls;
}

/*
 * How many raw call sites the matcher can see, before any of the parsing above
 * runs. readRawApiCalls emits a call only once it has stepped over any generic
 * argument and landed on the opening paren, so a call whose generic argument
 * the stepper cannot walk is dropped from the results with nothing else to
 * show for it. Comparing this count against the emitted calls is how that
 * shows up; the `balanced` flag covers the other half, a call site that is
 * reached but whose argument list is never closed.
 */
function countRawApiCallSites(text: string): number {
  return (text.match(new RegExp(RAW_API_CALL_SITE, "g")) || []).length;
}

/*
 * A page may build the URL into a local before passing it as `url:`, so the
 * route string is looked for anywhere in the enclosing file's call body plus
 * the file text. Matching on the call body alone would miss
 * Postmortem.tsx, where `url: apiUrl` hides the route.
 */
function callsRoute(
  call: RawApiCall,
  route: string,
  fileText: string,
): boolean {
  if (call.body.includes(route)) {
    return true;
  }

  const urlVariable: RegExpMatchArray | null = call.body.match(
    /url: ([A-Za-z_$][\w$]*)[,}]/,
  );

  if (!urlVariable) {
    return false;
  }

  const declaration: RegExpMatchArray | null = squash(fileText).match(
    new RegExp(`(?:const|let|var) ${urlVariable[1]}[^=]*= ([\\s\\S]{0,300})`),
  );

  return Boolean(declaration && declaration[1]!.includes(route));
}

interface GuardedCall {
  call: RawApiCall;
  routes: Array<string>;
}

describe("every raw API call to a project-scoped route sends the tenant header", () => {
  const allCalls: Array<GuardedCall> = [];

  for (const file of listSourceFiles(DASHBOARD_SRC)) {
    const fileText: string = fs.readFileSync(file, "utf8");

    for (const call of readRawApiCalls(file)) {
      const routes: Array<string> = PROJECT_SCOPED_ROUTES.filter(
        (route: string) => {
          return callsRoute(call, route, fileText);
        },
      );

      if (routes.length > 0) {
        allCalls.push({ call, routes });
      }
    }
  }

  /*
   * The header assertions below are shaped as "every call the sweep found",
   * which is what keeps a sync button added next month covered without anyone
   * editing this file. The price is that they say nothing about a call the
   * sweep never found — a call whose route callsRoute cannot resolve, say
   * because the URL is built by a helper, drops out of the sweep and out of
   * the header check together. An exact total used to catch that by arithmetic
   * and no longer does, so it is caught by construction instead: this test
   * pins the floors, the test after it pins the set of files that may reach a
   * guarded route at all, and the per-page describe at the bottom requires a
   * resolved route for every raw call in each of those files. Between them
   * there is nowhere for an unresolvable call to a guarded route to hide.
   *
   * The floors themselves are the coarsest of the three: every guarded route,
   * and every page named above, has to still be represented. Neither goes up
   * when a call site is added, so neither needs hand-editing.
   */
  test("the sweep still finds the call sites it is meant to guard", () => {
    const coveredRoutes: Array<string> = [];
    const coveredFiles: Array<string> = [];

    for (const entry of allCalls) {
      for (const route of entry.routes) {
        if (!coveredRoutes.includes(route)) {
          coveredRoutes.push(route);
        }
      }

      if (!coveredFiles.includes(entry.call.file)) {
        coveredFiles.push(entry.call.file);
      }
    }

    for (const route of PROJECT_SCOPED_ROUTES) {
      expect(coveredRoutes).toContain(route);
    }

    for (const { page } of GUARDED_PAGES) {
      expect(coveredFiles).toContain(path.join(...page));
    }
  });

  /*
   * The per-page describe at the bottom can only require a resolved route for
   * every raw call in a guarded file if GUARDED_PAGES actually lists every
   * file that reaches a guarded route. That is what this pins, by deriving the
   * list back out of the sources: a page that starts calling one of these
   * routes fails here, naming itself, rather than sitting outside the sweep
   * with no header on it.
   *
   * This is the one assertion in the file that a new call site can turn red,
   * and only when the call site is on a page not listed above. That is the
   * trade being made deliberately: adding a file to a list of files is the
   * edit the comment on GUARDED_PAGES already asks for, and it is what buys
   * the per-page describe the right to be exhaustive.
   */
  test("only the guarded pages reach a project-scoped route", () => {
    const pagesReachingGuardedRoutes: Array<string> = [];

    for (const file of listSourceFiles(DASHBOARD_SRC)) {
      const fileText: string = fs.readFileSync(file, "utf8");

      const mentionsGuardedRoute: boolean = PROJECT_SCOPED_ROUTES.some(
        (route: string) => {
          return fileText.includes(route);
        },
      );

      if (mentionsGuardedRoute) {
        pagesReachingGuardedRoutes.push(path.relative(DASHBOARD_SRC, file));
      }
    }

    expect(pagesReachingGuardedRoutes.sort()).toEqual(
      GUARDED_PAGES.map(({ page }: GuardedPage) => {
        return path.join(...page);
      }).sort(),
    );
  });

  /*
   * The other way the sweep can go quiet is one call at a time, inside the
   * scanner. A call site whose generic argument the stepper cannot walk never
   * reaches an argument list and is dropped from the results entirely; a call
   * whose argument list never closes is kept, but with the rest of the file as
   * its body, so it matches TENANT_HEADER off some later call and passes the
   * header assertions without ever having been read. Both are checked here,
   * over every file that mentions a guarded route — which is a superset of the
   * files the sweep draws calls from, since callsRoute can only resolve a
   * route that appears in the file's own text.
   *
   * This does not catch a scanner that matches nothing at all: with no calls
   * found there is nothing to disagree about and it passes. The route and page
   * floors above are what fail in that case, which is why both tests exist.
   */
  test("the scanner reads every raw API call in the files it guards", () => {
    const unread: Array<string> = [];

    for (const file of listSourceFiles(DASHBOARD_SRC)) {
      const fileText: string = fs.readFileSync(file, "utf8");

      const mentionsGuardedRoute: boolean = PROJECT_SCOPED_ROUTES.some(
        (route: string) => {
          return fileText.includes(route);
        },
      );

      if (!mentionsGuardedRoute) {
        continue;
      }

      const name: string = path.relative(DASHBOARD_SRC, file);
      const parsed: Array<RawApiCall> = readRawApiCalls(file);
      const found: number = countRawApiCallSites(fileText);

      if (parsed.length !== found) {
        unread.push(
          `${name}: reached the arguments of ${parsed.length} of ${found}`,
        );
      }

      for (const call of parsed) {
        if (!call.balanced) {
          unread.push(`${name}: [${call.verb}] argument list never closes`);
        }
      }
    }

    expect(unread).toEqual([]);
  });

  test.each(PROJECT_SCOPED_ROUTES)(
    "%s is only ever called with ModelAPI.getCommonHeaders()",
    (route: string) => {
      const callsForRoute: Array<RawApiCall> = allCalls
        .filter((entry: GuardedCall) => {
          return entry.routes.includes(route);
        })
        .map((entry: GuardedCall) => {
          return entry.call;
        });

      expect(callsForRoute.length).toBeGreaterThan(0);

      for (const call of callsForRoute) {
        expect(`${call.file} [${call.verb}] ${call.body}`).toContain(
          TENANT_HEADER,
        );
      }
    },
  );
});

/*
 * Per-page pins. The sweep above catches a header dropped from any call site;
 * these name the pages so a failure points straight at the file that
 * regressed, and they are the part of the file that is exhaustive rather than
 * a floor.
 */
describe("the pages that call project-scoped custom routes", () => {
  test.each(GUARDED_PAGES)(
    "$page sends the tenant header on every raw call",
    ({ page, routePrefix }: GuardedPage) => {
      const file: string = path.join(DASHBOARD_SRC, ...page);
      const fileText: string = fs.readFileSync(file, "utf8");
      const parsed: Array<RawApiCall> = readRawApiCalls(file);
      const matching: Array<RawApiCall> = parsed.filter((call: RawApiCall) => {
        return callsRoute(call, routePrefix, fileText);
      });

      /*
       * routePrefix covers the whole page, so every raw call in the file has
       * to resolve to it. Asserting that — rather than only that some call
       * did — is what stops a call from leaving the header check by becoming
       * invisible to callsRoute: hoisting a URL into a helper the 300-character
       * lookback cannot follow used to drop the call out of both the sweep and
       * this test at once, and now fails here with the call body in the
       * message. Nothing about it needs hand-editing when a sync or link
       * button is added; a call to some other route from one of these pages
       * does need the prefix widened or the page split, which is the point.
       */
      expect(parsed.length).toBeGreaterThan(0);
      expect(
        parsed
          .filter((call: RawApiCall) => {
            return !matching.includes(call);
          })
          .map((call: RawApiCall) => {
            return `[${call.verb}] ${call.body}`;
          }),
      ).toEqual([]);

      for (const call of matching) {
        expect(`[${call.verb}] ${call.body}`).toContain(TENANT_HEADER);
      }
    },
  );
});

/*
 * The notification-method and two-factor endpoints look like the same shape
 * but are user scoped: each one loads its row with `props: { isRoot: true }`
 * and authorizes by comparing the row's userId to the caller's, so no tenant
 * is needed. Where they do need a project they put `projectId` in the request
 * body, which ProjectMiddleware.getProjectId reads as its last fallback.
 *
 * That body field is load-bearing — dropping it silently un-scopes the
 * request the same way a missing header does — so it is pinned here rather
 * than left as a comment.
 */
describe("user-scoped notification endpoints carry projectId in the body", () => {
  const USER_SCOPED: Array<{ page: Array<string>; route: string }> = [
    {
      page: ["Components", "NotificationMethods", "SMS.tsx"],
      route: "/user-sms/",
    },
    {
      page: ["Components", "NotificationMethods", "Email.tsx"],
      route: "/user-email/",
    },
    {
      page: ["Components", "NotificationMethods", "Call.tsx"],
      route: "/user-call/",
    },
    {
      page: ["Components", "NotificationMethods", "Push.tsx"],
      route: "/user-push/",
    },
    {
      page: ["Components", "NotificationMethods", "Telegram.tsx"],
      route: "/user-telegram/",
    },
    {
      page: ["Components", "NotificationMethods", "WhatsApp.tsx"],
      route: "/user-whatsapp/",
    },
    {
      page: ["Components", "NotificationMethods", "Webhook.tsx"],
      route: "/user-webhook/",
    },
    {
      page: ["Components", "NotificationMethods", "IncomingCallNumber.tsx"],
      route: "/user-incoming-call-number/",
    },
  ];

  test.each(USER_SCOPED)(
    "$page posts projectId instead of a tenant header",
    ({ page, route }: { page: Array<string>; route: string }) => {
      const file: string = path.join(DASHBOARD_SRC, ...page);
      const matching: Array<RawApiCall> = readRawApiCalls(file).filter(
        (call: RawApiCall) => {
          return call.body.includes(route);
        },
      );

      expect(matching.length).toBeGreaterThan(0);

      for (const call of matching) {
        expect(call.body).toContain(
          "projectId: ProjectUtil.getCurrentProjectId()!",
        );
      }
    },
  );
});
