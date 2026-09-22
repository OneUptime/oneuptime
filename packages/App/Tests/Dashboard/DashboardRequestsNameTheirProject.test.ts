import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  AllowlistEntry,
  PACKAGES_DIR,
  listSourceFiles,
  readSources,
} from "Common/Tests/Helpers/RefreshAwareApiScan";
import {
  RawApiCall,
  findImplicitProjectCalls,
  findImplicitProjectOffenders,
  findRawApiCalls,
  findStaleProjectAllowlistEntries,
  makesProjectExplicit,
  readDeclarations,
  sendsTenantHeader,
} from "Common/Tests/Helpers/TenantScopedRequestScan";

/*
 * Every Dashboard request says which project it is for.
 *
 * The Dashboard is the project-scoped app: almost everything it reads or
 * writes belongs to one project, and the server learns which one from
 * ProjectMiddleware.getProjectId - params.projectId, params/query `tenantid`,
 * the `tenantid` / `projectid` headers, or `body.projectId`. Nothing else.
 *
 * Model CRUD is safe by construction: ModelAPI calls getCommonHeaders() on
 * every request, and that is the only producer of a `tenantid` header in the
 * codebase. Custom routes are not. They are reached with a raw `API.post` /
 * `API.get` from Common/UI/Utils/API/API, whose getHeaders() adds only the
 * default and permission-hash headers - so unless the call site adds
 * `headers: ModelAPI.getCommonHeaders()` itself, or puts `projectId` in the
 * body, the request arrives with no project at all.
 *
 * That is OneUptime issue #3920. "Send Test Email" on Project Settings >
 * Custom SMTP posted to `/smtp-config/test` with no headers; the route
 * requires an authenticated member of the config's own project; with no
 * `tenantid` there was no project to check, so every click answered
 * "Project ID is required". The same omission on a route that merely reads
 * tenant-scoped data shows up instead as "You do not have permissions to read
 * <model>", naming permissions the caller already holds - which is how the
 * Monitor Template sync buttons failed before they were fixed.
 *
 * Three guards already cover single pages by name:
 * ProjectScopedApiTenantHeader, ProjectScopedCustomRouteTenantHeader and
 * MonitorTemplateSyncTenantHeader. None of them saw `/smtp-config/test`,
 * because a hardcoded list only ever covers what someone remembered to add.
 * This suite sweeps the whole Dashboard instead, so a new page is covered the
 * day it lands, and the only way out is an allowlist entry with a reason.
 *
 * These pages are React components with no extractable logic - the header is a
 * property of an object literal - and the App suite runs in a plain Node
 * environment with no renderer. So the scan reads the sources through the
 * TypeScript parser, the same way the sibling RefreshAwareApiScan guard does.
 */

const DASHBOARD_SRC: string = path.join(
  PACKAGES_DIR,
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

/*
 * Dashboard modules that may open a request naming no project. Every entry
 * needs a reason a reviewer would accept, and each is checked below both to
 * exist and to still need the exception, so this list cannot quietly outlive
 * its reasons. Paths are relative to the Dashboard src root.
 *
 * The shape of every reason here is the same: the endpoint is about the
 * signed-in USER or the INSTANCE, not about a project. Anything that is about
 * a project does not belong on this list - it belongs behind the header.
 */
const PROJECT_FREE_ALLOWLIST: Array<AllowlistEntry> = [
  {
    file: "Components/Footer/Footer.tsx",
    reason:
      "GET <app>/version reports the build of the instance. It is the same answer for every project and is read before any project is chosen.",
  },
  {
    file: "Components/Slack/SlackIntegration.tsx",
    reason:
      "GET <home>/api/slack/app-manifest returns the static manifest a self-hosted admin pastes into Slack. It is instance configuration, identical for every project.",
  },
  {
    file: "Components/TwoFactorAuth/BackupCodes.tsx",
    reason:
      "Backup codes belong to the signed-in user's own login, not to a project. The route takes the user from the session and would ignore a tenant.",
  },
  {
    file: "Components/TwoFactorAuth/WebAuthnCredentials.tsx",
    reason:
      "Passkey registration is for the signed-in user's own login, taken from the session. Projects do not own credentials.",
  },
  {
    file: "Pages/Global/UserProfile/TwoFactorAuth.tsx",
    reason:
      "TOTP enrolment for the signed-in user's own login. This page is under Global/UserProfile precisely because it is not project scoped.",
  },
];

/*
 * The call that issue #3920 was about, pinned by name. The sweep above would
 * catch it again on its own, but only while the scanner still recognises the
 * call - and a scanner that silently stops recognising things is exactly how a
 * sweep goes quiet. This names the file and the route, so the day the scan
 * stops seeing this call, a test says so.
 */
const SMTP_TEST_CALL: {
  file: string;
  route: string;
} = {
  file: "Components/CustomSMTP/CustomSMTPTable.tsx",
  route: "/smtp-config/test",
};

/*
 * The sibling test buttons in the same settings area, which posted to their
 * own custom routes with no project either.
 */
const CALL_SMS_TEST_CALLS: {
  file: string;
  routes: Array<string>;
} = {
  file: "Components/CallSMS/CallSMSConfigTable.tsx",
  routes: ["/sms/test", "/call/test"],
};

function dashboardFile(relative: string): string {
  return path.join(DASHBOARD_SRC, ...relative.split("/"));
}

function callsIn(relative: string): {
  calls: Array<RawApiCall>;
  declarations: Map<string, string>;
} {
  const file: string = dashboardFile(relative);
  const source: string = fs.readFileSync(file, "utf8");

  return {
    calls: findRawApiCalls(source, file),
    declarations: readDeclarations(source, file),
  };
}

describe("Dashboard requests name the project they are for", () => {
  const files: Array<string> = listSourceFiles(DASHBOARD_SRC);
  const sources: ReadonlyMap<string, string> = readSources(files);

  test("every raw API call sends a tenant header, a projectId, or names the project in the url", () => {
    expect(
      findImplicitProjectOffenders({
        sources: sources,
        baseDir: DASHBOARD_SRC,
        allowlist: PROJECT_FREE_ALLOWLIST,
      }),
    ).toEqual([]);
  });

  test("no allowlist entry has outlived its reason", () => {
    expect(
      findStaleProjectAllowlistEntries({
        baseDir: DASHBOARD_SRC,
        allowlist: PROJECT_FREE_ALLOWLIST,
        allowlistName: "PROJECT_FREE_ALLOWLIST",
      }),
    ).toEqual([]);
  });

  test("every allowlist entry explains itself", () => {
    for (const entry of PROJECT_FREE_ALLOWLIST) {
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  });

  /*
   * Guard the guard. Every assertion above passes vacuously over an empty
   * scan, and a scanner that quietly matches nothing is the failure mode this
   * whole file exists to avoid - it is also what let `/smtp-config/test` sit
   * unnoticed while three tenant-header suites were green.
   *
   * Nothing below is a tally that an unrelated feature has to come and
   * correct. The floors are far under the real counts, and the point is only
   * that the sweep still reaches a Dashboard-sized body of code.
   */
  describe("the scan itself still works", () => {
    test("it reads the whole Dashboard", () => {
      expect(files.length).toBeGreaterThan(500);
      expect(sources.size).toBe(files.length);
    });

    test("it finds the Dashboard's raw API calls", () => {
      const found: number = files.reduce(
        (total: number, file: string): number => {
          return total + findRawApiCalls(sources.get(file)!, file).length;
        },
        0,
      );

      expect(found).toBeGreaterThan(20);
    });

    /*
     * A file that reaches the server only through ModelAPI must not be read as
     * an offender: ModelAPI sends the header itself, so demanding an explicit
     * one from its call sites would be wrong, and a scan that did would be
     * ignored within a week.
     */
    test("it does not mistake a ModelAPI call for a raw one", () => {
      const modelApiOnly: string = [
        'import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";',
        "const response = await ModelAPI.post({",
        '  url: URL.fromString("/thing"),',
        "  data: {},",
        "});",
      ].join("\n");

      expect(findRawApiCalls(modelApiOnly, "Fake.ts")).toEqual([]);
      expect(findImplicitProjectCalls(modelApiOnly, "Fake.ts")).toEqual([]);
    });

    /*
     * And the other direction: a raw call with no project HAS to be seen. This
     * is the exact shape the SMTP test button had before the fix.
     */
    test("it flags a raw call that names no project", () => {
      const rawWithoutProject: string = [
        'import API from "Common/UI/Utils/API/API";',
        "const response = await API.post({",
        "  url: URL.fromString(NOTIFICATION_URL.toString()).addRoute(",
        "    `/smtp-config/test`,",
        "  ),",
        '  data: { toEmail: values["toEmail"] },',
        "});",
      ].join("\n");

      const findings: Array<{ line: number; description: string }> =
        findImplicitProjectCalls(rawWithoutProject, "Fake.ts");

      expect(findings.length).toBe(1);
      expect(findings[0]!.line).toBe(2);
    });

    /* Each of the three ways of naming a project is accepted. */
    test.each([
      ["the tenant header", "headers: ModelAPI.getCommonHeaders(),"],
      [
        "a spread tenant header",
        "headers: { ...ModelAPI.getCommonHeaders() },",
      ],
      ["a projectId in the body", "data: { projectId: id },"],
    ])("it accepts %s", (_name: string, property: string) => {
      const source: string = [
        'import API from "Common/UI/Utils/API/API";',
        "const response = await API.post({",
        '  url: URL.fromString("/thing/test"),',
        `  ${property}`,
        "});",
      ].join("\n");

      expect(findImplicitProjectCalls(source, "Fake.ts")).toEqual([]);
    });

    /*
     * A call the scan cannot read must not be a call it lets through. There
     * are none in the Dashboard today, and the reason to pin it is precisely
     * that: the first `API.post(buildRequest())` has to arrive as a finding a
     * human looks at, not as silence.
     */
    test("it flags a call it cannot read as an object literal", () => {
      const indirect: string = [
        'import API from "Common/UI/Utils/API/API";',
        "const response = await API.post(buildRequest());",
      ].join("\n");

      const findings: Array<{ line: number; description: string }> =
        findImplicitProjectCalls(indirect, "Fake.ts");

      expect(findings.length).toBe(1);
      expect(findings[0]!.description).toContain("object literal");
    });

    /*
     * The one indirection these pages actually use. LogsViewer.tsx writes
     * `headers: getHeaders()` over a local `getHeaders()` that returns
     * ModelAPI.getCommonHeaders(); a scan that could not follow that would
     * accuse a correct file, and an accused correct file is how an allowlist
     * fills up with entries that are not really exceptions.
     */
    test("it follows a local helper to the header it returns", () => {
      const source: string = [
        'import API from "Common/UI/Utils/API/API";',
        'import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";',
        "function getHeaders(): Record<string, string> {",
        "  return ModelAPI.getCommonHeaders();",
        "}",
        "const response = await API.post({",
        '  url: URL.fromString("/thing/test"),',
        "  headers: getHeaders(),",
        "});",
      ].join("\n");

      expect(findImplicitProjectCalls(source, "Fake.ts")).toEqual([]);
    });
  });

  /*
   * The regression itself, named. The sweep proves no Dashboard call is
   * missing a project; this proves the specific call issue #3920 was filed
   * about is still there, still raw, still resolved by the scan, and now
   * carries the header.
   */
  describe("the SMTP test button (issue #3920)", () => {
    test("still posts to /smtp-config/test with a raw API.post", () => {
      const smtpCalls: Array<RawApiCall> = callsIn(
        SMTP_TEST_CALL.file,
      ).calls.filter((call: RawApiCall): boolean => {
        return call.url.includes(SMTP_TEST_CALL.route);
      });

      expect(smtpCalls.length).toBe(1);
      expect(smtpCalls[0]!.verb).toBe("post");
    });

    test("sends the tenant header, so the server can resolve the project", () => {
      const { calls, declarations } = callsIn(SMTP_TEST_CALL.file);

      const smtpCall: RawApiCall | undefined = calls.find(
        (call: RawApiCall): boolean => {
          return call.url.includes(SMTP_TEST_CALL.route);
        },
      );

      expect(smtpCall).toBeDefined();
      expect(sendsTenantHeader(smtpCall!, declarations)).toBe(true);
      expect(makesProjectExplicit(smtpCall!, declarations)).toBe(true);
    });

    test("the whole file is free of requests that name no project", () => {
      const file: string = dashboardFile(SMTP_TEST_CALL.file);

      expect(
        findImplicitProjectCalls(fs.readFileSync(file, "utf8"), file),
      ).toEqual([]);
    });
  });

  /*
   * The same three questions for the sibling buttons on the Call & SMS config
   * table, which sit in the same settings area and had the same omission.
   */
  describe("the Call and SMS test buttons", () => {
    test.each(CALL_SMS_TEST_CALLS.routes)(
      "%s is still a raw API.post and sends the tenant header",
      (route: string) => {
        const { calls, declarations } = callsIn(CALL_SMS_TEST_CALLS.file);

        const matching: Array<RawApiCall> = calls.filter(
          (call: RawApiCall): boolean => {
            return call.url.includes(route);
          },
        );

        expect(matching.length).toBe(1);
        expect(matching[0]!.verb).toBe("post");
        expect(sendsTenantHeader(matching[0]!, declarations)).toBe(true);
      },
    );
  });

  /*
   * The allowlist is a list of files, so nothing stops an entry from also
   * excusing a project-scoped call that happens to live in the same file. Read
   * back what each entry actually covers and check the routes are the ones the
   * reason describes: user-level or instance-level, never a project's.
   */
  test("no allowlisted file hides a project-scoped route", () => {
    const projectScopedHint: RegExp =
      /smtp-config|call-sms|\/sms\/|\/call\/|monitor|incident|alert|status-page|on-call|telemetry|workspace-notification/i;

    for (const entry of PROJECT_FREE_ALLOWLIST) {
      const file: string = dashboardFile(entry.file);
      const source: string = fs.readFileSync(file, "utf8");

      for (const call of findRawApiCalls(source, file)) {
        expect({
          file: entry.file,
          line: call.line,
          url: call.url.replace(/\s+/g, " ").trim(),
          looksProjectScoped: projectScopedHint.test(call.url),
        }).toEqual({
          file: entry.file,
          line: call.line,
          url: call.url.replace(/\s+/g, " ").trim(),
          looksProjectScoped: false,
        });
      }
    }
  });
});

/*
 * A note on scope, so the next reader does not have to re-derive it.
 *
 * Only the Dashboard is swept. The other frontends are not project-scoped in
 * the same way and a sweep over them would be mostly allowlist: Accounts has
 * no project yet (you are logging in), AdminDashboard is master-admin and
 * instance-wide, and StatusPage / PublicDashboard are public surfaces whose
 * requests are scoped by the status page or dashboard id in the path. ee/
 * ships no Dashboard requests of this shape today, so an ee/ counterpart would
 * assert nothing; RefreshAwareApiScan has one because ee/ does import the core
 * client.
 */
export {};
