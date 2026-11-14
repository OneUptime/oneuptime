import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  OnCallTestPageFix,
  OnCallTestPageDeliveryStatus,
  OnCallTestPageStatus,
  OnCallTestPageStepStatus,
} from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import { OnCallPageChannel } from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";
import Permission from "Common/Types/Permission";

/*
 * WHERE A TEST PAGE IS OFFERED, AND WHAT THE DASHBOARD AND THE SERVER AGREE
 * ON (#6811).
 *
 * "Send me a test page" in User Settings (Notification Methods, On-Call
 * Rules) and at the end of the setup checklist; "Send test page" on a
 * member's row of On-Call > Readiness, for who may send it; "Test this
 * policy" on a policy's escalation rules, for who may edit it; a test run
 * marked as one wherever runs are listed; and the command palette's action.
 * The dialog calls the routes the server mounts, offers a member's test to
 * the roles the server lets send one, and words every status, channel and
 * fix the server's result can carry.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "src",
);
const TEST_PAGE_DIR: string = path.join(
  DASHBOARD_SRC,
  "Components",
  "OnCallTestPage",
);

function read(...parts: Array<string>): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8");
}

/*
 * The server's side, read as source: importing its service here would load
 * the whole server for two constants.
 */
const COMMON_SERVER: string = path.join(APP_ROOT, "..", "Common", "Server");

const SERVER_API: string = fs.readFileSync(
  path.join(COMMON_SERVER, "API", "OnCallTestPageAPI.ts"),
  "utf8",
);

const SERVER_SERVICE: string = fs.readFileSync(
  path.join(COMMON_SERVER, "Services", "OnCallTestPageService.ts"),
  "utf8",
);

const ON_CALL_TEST_PAGE_API_PATH: string = (SERVER_API.match(
  /export const ON_CALL_TEST_PAGE_API_PATH: string = "([^"]+)";/,
) || [])[1]!;

// The permission members a constant of `source` lists.
function permissionsListed(source: string, constant: string): Array<string> {
  const start: number = source.indexOf(`export const ${constant}`);
  const body: string = source.slice(start, source.indexOf("];", start));

  return Array.from(body.matchAll(/Permission\.(\w+)/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

describe("where a test page is offered", () => {
  test.each([
    ["Pages/UserSettings/NotificationMethods.tsx"],
  ])("%s offers the person a test page of their own", (file: string) => {
    const source: string = read(...file.split("/"));

    expect(source).toContain(
      'import TestPageCard from "../../Components/OnCallTestPage/TestPageCard";',
    );
    expect(source).toMatch(/<TestPageCard\b/);
  });

  /*
   * How to Reach Me (#6820) offers it at the foot of the ladder and of the
   * grid, on your own page only: a member's page tests nobody.
   */
  test("How to Reach Me offers the person a test page of their own, at its foot", () => {
    const page: string = read("Pages", "UserSettings", "OnCallRules.tsx");

    expect(page).toContain("<HowToReachMe");

    const source: string = read(
      "Components",
      "NotificationRule",
      "HowToReachMe.tsx",
    );

    expect(source).toContain(
      'import TestPageCard from "../OnCallTestPage/TestPageCard";',
    );
    expect(source).toMatch(/<TestPageCard\b/);
    expect(source).toMatch(/const testPage: ReactElement = isOwn \?/);
  });

  test("the setup checklist ends with one, beside Recheck", () => {
    const source: string = read(
      "Components",
      "UserSettings",
      "SetupChecklist",
      "SetupChecklist.tsx",
    );

    expect(source).toMatch(/<SendTestPageButton\b/);
    expect(source).toContain('kind: "self"');
  });

  test("On-Call > Readiness offers a member's test, to who may send one", () => {
    const source: string = read("Pages", "OnCallDuty", "Readiness.tsx");

    expect(source).toContain('title: "Send test page"');
    expect(source).toContain("canSendTestPageToMember()");
    expect(source).toMatch(/<SendTestPageModal\b/);
    expect(source).toContain('kind: "member"');
  });

  test("a policy's escalation rules offer its test, to who may edit it, once it has a rule", () => {
    const source: string = read(
      "Components",
      "OnCallPolicy",
      "EscalationRule",
      "EscalationRules.tsx",
    );

    expect(source).toContain("getTestPolicyGate()");
    expect(source).toMatch(/<SendTestPageButton\b/);
    expect(source).toContain('kind: "policy"');
  });

  test("the command palette finds it", () => {
    const source: string = read(
      "Components",
      "CommandPalette",
      "PageSearchIndex.ts",
    );

    expect(source).toContain('"send-me-a-test-page"');
    expect(source).toContain('"Send me a test page"');
  });
});

describe("a test run is marked as one wherever runs are listed", () => {
  test.each([
    ["Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable.tsx"],
    ["Pages/UserSettings/OnCallLogs.tsx"],
  ])("%s reads each run's event type and marks a test page", (file: string) => {
    const source: string = read(...file.split("/"));

    expect(source).toContain("userNotificationEventType: true");
    expect(source).toContain(
      'import { isOnCallTestPage } from "Common/Types/OnCallDutyPolicy/OnCallTestPage";',
    );
    expect(source).toMatch(/isOnCallTestPage\(/);
  });
});

describe("what the Dashboard and the server agree on", () => {
  test("the dialog calls the routes the server mounts", () => {
    expect(ON_CALL_TEST_PAGE_API_PATH).toBe("/on-call-test-page");

    for (const route of [
      "/preview",
      "/page-person",
      "/page-policy",
      "/result/:executionLogId",
    ]) {
      expect(SERVER_API).toContain(`\${ON_CALL_TEST_PAGE_API_PATH}${route}`);
    }

    const api: string = fs.readFileSync(
      path.join(TEST_PAGE_DIR, "OnCallTestPageApi.ts"),
      "utf8",
    );

    expect(api).toContain(
      `export const ON_CALL_TEST_PAGE_API_PATH: string = "${ON_CALL_TEST_PAGE_API_PATH}";`,
    );

    for (const route of [
      "/preview",
      "/page-person",
      "/page-policy",
      "/result/",
    ]) {
      expect({ route, called: api.includes(route) }).toEqual({
        route,
        called: true,
      });
    }

    const baseApi: string = fs.readFileSync(
      path.join(APP_ROOT, "FeatureSet", "BaseAPI", "Index.ts"),
      "utf8",
    );

    expect(baseApi).toContain(
      'import OnCallTestPageAPI from "Common/Server/API/OnCallTestPageAPI";',
    );
    expect(baseApi).toMatch(
      /app\.use\(\s*`\/\$\{APP_NAME\.toLocaleLowerCase\(\)\}`,\s*OnCallTestPageAPI,?\s*\)/,
    );
  });

  test("a member's test is offered to the roles the server lets send one", () => {
    const access: string = fs.readFileSync(
      path.join(TEST_PAGE_DIR, "OnCallTestPageAccess.ts"),
      "utf8",
    );

    const offered: Array<string> = permissionsListed(
      access,
      "TEST_PAGE_FOR_MEMBER_PERMISSIONS",
    );
    const allowed: Array<string> = permissionsListed(
      SERVER_SERVICE,
      "ON_CALL_TEST_PAGE_FOR_MEMBER_PERMISSIONS",
    );

    expect(offered.length).toBeGreaterThan(0);
    expect(offered.sort()).toEqual(allowed.sort());

    for (const member of offered) {
      expect(Permission[member as keyof typeof Permission]).toBeDefined();
    }
  });

  test("every status, channel and fix of a result is worded", () => {
    const words: string = fs.readFileSync(
      path.join(TEST_PAGE_DIR, "OnCallTestPageWords.ts"),
      "utf8",
    );

    const kinds: Array<[string, Record<string, string>]> = [
      ["OnCallPageChannel", OnCallPageChannel],
      ["OnCallTestPageDeliveryStatus", OnCallTestPageDeliveryStatus],
      ["OnCallTestPageStepStatus", OnCallTestPageStepStatus],
      ["OnCallTestPageStatus", OnCallTestPageStatus],
      ["OnCallTestPageFix", OnCallTestPageFix],
    ];

    for (const [name, values] of kinds) {
      for (const member of Object.keys(values)) {
        expect({ worded: words.includes(`[${name}.${member}]`) }).toEqual({
          worded: true,
        });
      }
    }
  });
});
