import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  AllowlistEntry,
  BARE_CLIENT,
  Finding,
  PACKAGES_DIR,
  findBareClientOffenders,
  findBareClientValueImports,
  findRawTransportOffenders,
  findRawTransports,
  findStaleAllowlistEntries,
  listSourceFiles,
  readSources,
  toRelativePath,
} from "Common/Tests/Helpers/RefreshAwareApiScan";

/*
 * The Enterprise screens send every request through the refresh-aware client.
 *
 * packages/App/Tests/FrontendRequestsUseRefreshAwareApi.test.ts pins this for
 * the core frontends: a browser module that holds the core client
 * (Common/Utils/API) or opens a raw fetch / XMLHttpRequest / EventSource /
 * sendBeacon / axios request works for fifteen minutes and then fails, because
 * nothing refreshes the expired session. The Community / Enterprise split
 * moved the SSO, SCIM, audit-log, team-compliance, license and health screens
 * out of those frontends into ee/Dashboard and ee/AdminDashboard - which the
 * core suite cannot scan, because the App Test job deletes ee/.
 *
 * This suite runs the same detector (Common/Tests/Helpers/RefreshAwareApiScan)
 * over the Enterprise screens. Nothing in ee/ needs an exception today, so
 * both allowlists are EMPTY: a new exception has to be added here, with its
 * reason, where a reviewer sees it.
 */

const EE_DIR: string = path.resolve(__dirname, "..", "..");
const REPOSITORY_ROOT: string = path.resolve(EE_DIR, "..");

// The Enterprise UI plugins, one per frontend (see ee/README.md).
const ENTERPRISE_BROWSER_ROOTS: Array<string> = [
  path.join(EE_DIR, "Dashboard"),
  path.join(EE_DIR, "AdminDashboard"),
];

// Paths are relative to the repository root ("ee/Dashboard/...").
const BARE_CLIENT_ALLOWLIST: Array<AllowlistEntry> = [];
const RAW_TRANSPORT_ALLOWLIST: Array<AllowlistEntry> = [];

const toRepositoryPath: (filePath: string) => string = (
  filePath: string,
): string => {
  return toRelativePath(REPOSITORY_ROOT, filePath);
};

describe("Enterprise screens send their requests through the refresh-aware client", () => {
  const enterpriseFiles: Array<string> = ENTERPRISE_BROWSER_ROOTS.flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  const sources: Map<string, string> = readSources(enterpriseFiles);

  test("the scan actually found the Enterprise screens of both frontends", () => {
    /*
     * Guards the guard: a moved directory or a broken walk would otherwise
     * leave the two main assertions passing over nothing.
     */
    for (const root of ENTERPRISE_BROWSER_ROOTS) {
      expect(fs.existsSync(root)).toBe(true);
    }

    expect(enterpriseFiles.length).toBeGreaterThan(0);

    const scanned: Array<string> = enterpriseFiles.map(toRepositoryPath);

    for (const entry of [
      "ee/Dashboard/Index.tsx",
      "ee/Dashboard/TeamCompliance/Compliance.tsx",
      "ee/AdminDashboard/Index.tsx",
      "ee/AdminDashboard/Health/QueryConsole.tsx",
    ]) {
      expect([entry, scanned.includes(entry)]).toEqual([entry, true]);
    }

    // Only TypeScript modules, and never anything from node_modules.
    for (const file of scanned) {
      expect(file).toMatch(/\.tsx?$/);
      expect(file).not.toContain("/node_modules/");
    }
  });

  test("the shared detector points at this checkout's core client", () => {
    /*
     * The helper finds packages/ from its own location. Were it ever to point
     * at another checkout, no import here would resolve to its BARE_CLIENT
     * and the scan could find nothing.
     */
    expect(PACKAGES_DIR).toBe(path.join(REPOSITORY_ROOT, "packages"));
    expect(fs.existsSync(BARE_CLIENT)).toBe(true);
    expect(toRepositoryPath(BARE_CLIENT)).toBe("packages/Common/Utils/API.ts");
  });

  test("the scan reads the screens' real imports: they use the refresh-aware client", () => {
    const refreshAwareUsers: Array<string> = [];

    for (const [file, source] of sources) {
      if (source.includes('from "Common/UI/Utils/API/API"')) {
        refreshAwareUsers.push(toRepositoryPath(file));
      }
    }

    expect(refreshAwareUsers.length).toBeGreaterThan(0);
  });

  test("both allowlists are empty, so nothing in ee/ is excused", () => {
    expect(BARE_CLIENT_ALLOWLIST).toEqual([]);
    expect(RAW_TRANSPORT_ALLOWLIST).toEqual([]);
    expect(
      findStaleAllowlistEntries({
        baseDir: REPOSITORY_ROOT,
        bareClientAllowlist: BARE_CLIENT_ALLOWLIST,
        rawTransportAllowlist: RAW_TRANSPORT_ALLOWLIST,
      }),
    ).toEqual([]);
  });

  describe("negative controls: the same checks flag an Enterprise screen that bypasses the client", () => {
    const syntheticFile: string = path.join(
      EE_DIR,
      "Dashboard",
      "SSO",
      "Pages",
      "Settings",
      "SyntheticBypass.tsx",
    );

    const syntheticSource: string = [
      'import API from "Common/Utils/API";',
      'import RefreshAware from "Common/UI/Utils/API/API";',
      "export const load = async (): Promise<void> => {",
      "  await fetch('/api/project-sso');",
      "  void window.fetch('/api/project-oidc');",
      "  const events = new EventSource('/api/scim/stream');",
      "  navigator.sendBeacon('/api/audit-log');",
      "  void RefreshAware.get;",
      "  void API;",
      "};",
    ].join("\n");

    test("a raw fetch in a synthetic source string is flagged", () => {
      const findings: Array<Finding> = findRawTransports(
        syntheticFile,
        "export const load = async (): Promise<void> => { await fetch('/api/project-sso'); };",
      );

      expect(findings).toEqual([
        { line: 1, description: "calls the global fetch()" },
      ]);
    });

    test("every raw transport and the core client import are flagged, with their lines", () => {
      expect(
        findRawTransports(syntheticFile, syntheticSource).map(
          (finding: Finding): number => {
            return finding.line;
          },
        ),
      ).toEqual([4, 5, 6, 7]);

      expect(
        findBareClientValueImports(syntheticFile, syntheticSource),
      ).toEqual([
        {
          line: 1,
          description: 'imports the core client from "Common/Utils/API"',
        },
      ]);
    });

    test("the suite's own pipeline, with its empty allowlists, reports the file by its ee/ path", () => {
      const syntheticSources: Map<string, string> = new Map<string, string>([
        [syntheticFile, syntheticSource],
      ]);

      const bareClient: Array<string> = findBareClientOffenders({
        sources: syntheticSources,
        baseDir: REPOSITORY_ROOT,
        allowlist: BARE_CLIENT_ALLOWLIST,
      });
      const rawTransport: Array<string> = findRawTransportOffenders({
        sources: syntheticSources,
        baseDir: REPOSITORY_ROOT,
        allowlist: RAW_TRANSPORT_ALLOWLIST,
      });

      expect(bareClient).toHaveLength(1);
      expect(bareClient[0]).toMatch(
        /^ee\/Dashboard\/SSO\/Pages\/Settings\/SyntheticBypass\.tsx:1 imports the core client/,
      );
      expect(rawTransport).toHaveLength(4);
      expect(rawTransport[0]).toMatch(
        /^ee\/Dashboard\/SSO\/Pages\/Settings\/SyntheticBypass\.tsx:4 calls the global fetch\(\)/,
      );
    });

    test("a relative import that reaches the core client is flagged too", () => {
      /*
       * ee/ must reach core through "Common/...", so a relative path into
       * packages/ is already an eslint error - but were one to land, it
       * would still resolve to the core client and be caught here.
       */
      const relative: string = path
        .relative(path.dirname(syntheticFile), BARE_CLIENT)
        .split(path.sep)
        .join("/")
        .replace(/\.ts$/, "");

      expect(
        findBareClientValueImports(
          syntheticFile,
          `import Core from "${relative}";`,
        ),
      ).toHaveLength(1);
    });
  });

  test("no Enterprise screen holds the core client, which never refreshes a session", () => {
    /*
     * The strings ARE the message: jest prints the received array, so a
     * failure names every file and line along with the fix.
     */
    expect(
      findBareClientOffenders({
        sources: sources,
        baseDir: REPOSITORY_ROOT,
        allowlist: BARE_CLIENT_ALLOWLIST,
      }),
    ).toEqual([]);
  });

  test("no Enterprise screen opens a request around the client", () => {
    expect(
      findRawTransportOffenders({
        sources: sources,
        baseDir: REPOSITORY_ROOT,
        allowlist: RAW_TRANSPORT_ALLOWLIST,
      }),
    ).toEqual([]);
  });
});
