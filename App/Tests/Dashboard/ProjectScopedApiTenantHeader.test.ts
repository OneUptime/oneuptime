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

interface RawApiCall {
  file: string;
  verb: string;
  body: string;
}

const SOURCE_FILE: RegExp = /\.tsx?$/;
const WHITESPACE: RegExp = /\s/;

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
 */
function readRawApiCalls(file: string): Array<RawApiCall> {
  const source: string = fs.readFileSync(file, "utf8");
  const calls: Array<RawApiCall> = [];
  const callSite: RegExp =
    /(^|[^A-Za-z0-9_])API\.(post|get|put|delete|patch)\s*[<(]/g;

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

      for (; end < source.length; end++) {
        if (source[end] === "(") {
          parenDepth++;
        } else if (source[end] === ")") {
          parenDepth--;

          if (parenDepth === 0) {
            end++;
            break;
          }
        }
      }

      calls.push({
        file: path.relative(DASHBOARD_SRC, file),
        verb: match[2]!,
        body: squash(source.slice(index, end)),
      });
    }

    match = callSite.exec(source);
  }

  return calls;
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

describe("every raw API call to a project-scoped route sends the tenant header", () => {
  const allCalls: Array<{ call: RawApiCall; route: string }> = [];

  for (const file of listSourceFiles(DASHBOARD_SRC)) {
    const fileText: string = fs.readFileSync(file, "utf8");

    for (const call of readRawApiCalls(file)) {
      for (const route of PROJECT_SCOPED_ROUTES) {
        if (callsRoute(call, route, fileText)) {
          allCalls.push({ call, route });
        }
      }
    }
  }

  test("the sweep still finds the call sites it is meant to guard", () => {
    /*
     * Guards the scanner itself: if readRawApiCalls stops matching, every
     * assertion below would pass vacuously.
     */
    expect(allCalls.length).toBe(13);

    for (const route of PROJECT_SCOPED_ROUTES) {
      expect(
        allCalls.some((entry: { call: RawApiCall; route: string }) => {
          return entry.route === route;
        }),
      ).toBe(true);
    }
  });

  test.each(PROJECT_SCOPED_ROUTES)(
    "%s is only ever called with ModelAPI.getCommonHeaders()",
    (route: string) => {
      const callsForRoute: Array<RawApiCall> = allCalls
        .filter((entry: { call: RawApiCall; route: string }) => {
          return entry.route === route;
        })
        .map((entry: { call: RawApiCall; route: string }) => {
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
 * regressed.
 */
describe("the pages that call project-scoped custom routes", () => {
  const PAGES: Array<{ page: Array<string>; route: string; calls: number }> = [
    {
      page: ["Pages", "Monitor", "Settings", "MonitorTemplatesView.tsx"],
      route: "/monitor-template/",
      calls: 6,
    },
    {
      page: ["Pages", "Alerts", "View", "InternalNote.tsx"],
      route: "/alert/generate-note-from-ai/",
      calls: 1,
    },
    {
      page: ["Pages", "Incidents", "View", "InternalNote.tsx"],
      route: "/incident/generate-note-from-ai/",
      calls: 1,
    },
    {
      page: ["Pages", "Incidents", "View", "PublicNote.tsx"],
      route: "/incident/generate-note-from-ai/",
      calls: 1,
    },
    {
      page: ["Pages", "Incidents", "View", "Postmortem.tsx"],
      route: "/incident/generate-postmortem-from-ai/",
      calls: 1,
    },
    {
      page: ["Pages", "Incidents", "EpisodeView", "Postmortem.tsx"],
      route: "/incident-episode/generate-postmortem-from-ai/",
      calls: 1,
    },
    {
      page: ["Pages", "ScheduledMaintenanceEvents", "View", "InternalNote.tsx"],
      route: "/scheduled-maintenance/generate-note-from-ai/",
      calls: 1,
    },
    {
      page: ["Pages", "ScheduledMaintenanceEvents", "View", "PublicNote.tsx"],
      route: "/scheduled-maintenance/generate-note-from-ai/",
      calls: 1,
    },
  ];

  test.each(PAGES)(
    "$page sends the tenant header on every raw call",
    ({
      page,
      route,
      calls,
    }: {
      page: Array<string>;
      route: string;
      calls: number;
    }) => {
      const file: string = path.join(DASHBOARD_SRC, ...page);
      const fileText: string = fs.readFileSync(file, "utf8");
      const matching: Array<RawApiCall> = readRawApiCalls(file).filter(
        (call: RawApiCall) => {
          return callsRoute(call, route, fileText);
        },
      );

      expect(matching.length).toBe(calls);

      for (const call of matching) {
        expect(call.body).toContain(TENANT_HEADER);
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
