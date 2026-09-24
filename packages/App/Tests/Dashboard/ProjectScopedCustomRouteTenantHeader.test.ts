import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * `/monitor/refresh-status/:monitorId` and
 * `/workspace-notification-rule/test/:ruleId` are custom routes rather than
 * model CRUD, so the dashboard drives them through raw `API.get`.
 * `BaseAPI.getHeaders()` does NOT add a `tenantid` header —
 * `ModelAPI.getCommonHeaders()` is the only thing in the codebase that does,
 * and both calls originally omitted it.
 *
 * Both routes now require an authenticated member of the resource's own
 * project (CommonAPI.assertAuthenticatedProjectMember plus a check that the
 * resource's projectId matches). With no `tenantid` there is no project to
 * check, so dropping the header again would not merely lose scope — it would
 * fail every request with "Project ID is required". These pages are React
 * components with no extractable logic, and the App suite runs in a plain
 * Node environment with no renderer, so this reads the source the same way
 * the sibling MonitorTemplateSyncTenantHeader test does.
 */

const MONITOR_VIEW_PAGE: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "Monitor",
  "View",
  "Index.tsx",
);

/*
 * The monitor overview no longer calls these routes itself: its data hook
 * fires refresh-status, and the uptime hook reads the uptime summary. The
 * page is kept below only to prove it makes no raw call of its own.
 */
const MONITOR_OVERVIEW_DATA_HOOK: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Monitor",
  "Overview",
  "useMonitorOverviewData.ts",
);

const MONITOR_UPTIME_SUMMARY_HOOK: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Monitor",
  "Overview",
  "useMonitorUptimeSummary.ts",
);

const NOTIFICATION_RULES_TABLE: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Workspace",
  "WorkspaceNotificationRulesTable.tsx",
);

/*
 * Comments are stripped so the prose above a call (which may quote both the
 * endpoint path and `getCommonHeaders`) cannot satisfy an assertion about the
 * code, and whitespace is squashed so prettier re-wrapping a call cannot turn
 * a real regression check into a red herring.
 */
function readCode(filePath: string): string {
  const raw: string = fs.readFileSync(filePath, "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

/*
 * Every raw `API.get({ ... })` argument object in the file, as source text.
 * Brace-matched rather than regex-matched so nested objects (`data: {}`) do
 * not truncate the capture. The lookbehind keeps `ModelAPI.get` out of the
 * results — that one attaches the tenant header itself.
 */
function getApiGetArguments(code: string): Array<string> {
  const calls: Array<string> = [];
  const marker: RegExp = /(?<![A-Za-z])API\.get(?:<[^>]*>)?\(\s*\{/g;

  let match: RegExpExecArray | null = marker.exec(code);

  while (match !== null) {
    const openIndex: number = code.indexOf("{", match.index);
    let depth: number = 0;
    let end: number = -1;

    for (let i: number = openIndex; i < code.length; i++) {
      if (code[i] === "{") {
        depth++;
      } else if (code[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (end === -1) {
      throw new Error("Unbalanced braces in an API.get call argument.");
    }

    calls.push(code.slice(openIndex, end + 1));
    match = marker.exec(code);
  }

  return calls;
}

function getCallsForRoute(data: {
  filePath: string;
  route: string;
}): Array<string> {
  return getApiGetArguments(readCode(data.filePath)).filter((call: string) => {
    return call.includes(data.route);
  });
}

describe("Project-scoped custom GET routes send the tenant header", () => {
  const cases: Array<{ name: string; filePath: string; route: string }> = [
    {
      name: "the monitor overview refreshing monitor status",
      filePath: MONITOR_OVERVIEW_DATA_HOOK,
      route: "/monitor/refresh-status/",
    },
    {
      name: "the monitor overview loading uptime history",
      filePath: MONITOR_UPTIME_SUMMARY_HOOK,
      route: "/monitor/uptime-summary/",
    },
    {
      name: "the workspace notification rules table testing a rule",
      filePath: NOTIFICATION_RULES_TABLE,
      route: "/workspace-notification-rule/test/",
    },
  ];

  for (const testCase of cases) {
    /*
     * Guard the guard: if a page is ever migrated off raw API.get, the header
     * assertion below would vacuously pass over an empty list.
     */
    test(`${testCase.name} still uses raw API.get`, () => {
      expect(
        getCallsForRoute({
          filePath: testCase.filePath,
          route: testCase.route,
        }).length,
      ).toBe(1);
    });

    test(`${testCase.name} passes ModelAPI.getCommonHeaders() so tenantid is sent`, () => {
      const sendsTenantHeader: RegExp = new RegExp(
        "headers:\\s*(\\{\\s*\\.\\.\\.\\s*)?ModelAPI\\.getCommonHeaders\\(",
      );

      const missing: Array<string> = getCallsForRoute({
        filePath: testCase.filePath,
        route: testCase.route,
      }).filter((call: string) => {
        return !sendsTenantHeader.test(call);
      });

      expect(missing).toEqual([]);
    });
  }

  test("the monitor view page makes no raw API.get of its own", () => {
    /*
     * The page used to await refresh-status itself. If a raw call comes back
     * here it bypasses the hook's once-per-monitor guard, and the cases above
     * would not notice, because they read the hooks.
     */
    expect(getApiGetArguments(readCode(MONITOR_VIEW_PAGE)).length).toBe(0);
  });
});
