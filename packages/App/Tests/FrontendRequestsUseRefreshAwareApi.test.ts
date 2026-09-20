import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  AllowlistEntry,
  BARE_CLIENT,
  COMMON_DIR,
  Finding,
  PACKAGES_DIR,
  allowlistedFiles,
  findBareClientOffenders,
  findBareClientValueImports,
  findRawTransportOffenders,
  findRawTransports,
  findStaleAllowlistEntries,
  fromRelativePath,
  listSourceFiles,
  readSources,
  referencesBareClient,
  toRelativePath,
} from "Common/Tests/Helpers/RefreshAwareApiScan";

/*
 * Every browser request to our backend goes through the refresh-aware client.
 *
 * The access-token cookie lives exactly as long as the 15-minute JWT inside
 * it, so a Dashboard left open past that sends its next request with no
 * access token at all. The server answers 401, and the UI client
 * (Common/UI/Utils/API/API, class BaseAPI) answers that by refreshing the
 * session once and replaying the request - the user never notices.
 *
 * The core client underneath it (Common/Utils/API) cannot do that. Its
 * tryRefreshAuth returns false and its handleError does nothing, because it
 * is also the server's HTTP client and has no session to refresh. A page that
 * imports it directly therefore works for fifteen minutes and then fails -
 * which is how "Send setup reminder" came to answer a customer with "You are
 * not authorized to access this project's data." after they left a tab open.
 * The same happens to a raw fetch(), axios or XMLHttpRequest call: none of
 * them know the session can be refreshed.
 *
 * Nothing about either mistake shows up in a type check or a quick manual
 * test, because both work perfectly with a fresh session. This guard is what
 * catches them: it reads every browser module and names the file and line.
 *
 * The detector itself is shared (Common/Tests/Helpers/RefreshAwareApiScan):
 * the Enterprise screens moved to ee/, which the App Test job deletes, so
 * ee/Tests/Server/FrontendRequestsUseRefreshAwareApi.test.ts runs the same
 * checks over ee/Dashboard and ee/AdminDashboard. This suite covers the core
 * frontends and never reads ee/.
 */

const APP_DIR: string = path.join(PACKAGES_DIR, "App");

/*
 * Browser code only. src/Server under StatusPage and PublicDashboard is the
 * node side that renders those pages, where the core client is correct.
 */
const BROWSER_SOURCE_ROOTS: Array<string> = [
  path.join(APP_DIR, "FeatureSet", "Dashboard", "src"),
  path.join(APP_DIR, "FeatureSet", "AdminDashboard", "src"),
  path.join(APP_DIR, "FeatureSet", "Accounts", "src"),
  path.join(APP_DIR, "FeatureSet", "StatusPage", "src"),
  path.join(APP_DIR, "FeatureSet", "PublicDashboard", "src"),
  path.join(COMMON_DIR, "UI"),
];

/*
 * Browser modules that may hold the core client as a value. Every entry needs
 * a reason a reviewer would accept, and each is checked below both to exist
 * and to still need the exception, so this list cannot quietly outlive its
 * reasons. Paths are relative to packages/.
 *
 * Type-only references (`import type`, or named imports of the interfaces the
 * core module exports, such as RequestOptions and AuthRetryContext) are not
 * listed: they carry no client, and the detector already lets them through.
 * Common/UI/Utils/API/RequestOptions.ts is the live example, pinned by its own
 * test below.
 */
const BARE_CLIENT_ALLOWLIST: Array<AllowlistEntry> = [
  {
    file: "Common/UI/Utils/API/API.ts",
    reason:
      "It IS the refresh-aware client: BaseAPI extends the core class and adds the refresh.",
  },
  {
    file: "Common/UI/Utils/GlobalConfig.ts",
    reason:
      "GET /api/global-config/vars is anonymous by design and loads before any session exists, so there is nothing to refresh.",
  },
  {
    file: "App/FeatureSet/StatusPage/src/Utils/User.ts",
    reason:
      "Logout is called from handleError; going through the status page client would recurse into handleError on a failed logout.",
  },
];

/*
 * Browser modules that may open a request without any client. The same two
 * checks apply.
 */
const RAW_TRANSPORT_ALLOWLIST: Array<AllowlistEntry> = [
  {
    file: "App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayPlayer.tsx",
    reason:
      "Recording chunks are application/octet-stream, which the JSON client cannot return, and the watch-time heartbeat needs fetch keepalive to survive pagehide. The player refreshes through API.refreshSession() on a 401 itself.",
  },
];

function toPackagesPath(filePath: string): string {
  return toRelativePath(PACKAGES_DIR, filePath);
}

function fromPackagesPath(packagesPath: string): string {
  return fromRelativePath(PACKAGES_DIR, packagesPath);
}

describe("Browser requests to our backend go through the refresh-aware client", () => {
  const browserFiles: Array<string> = BROWSER_SOURCE_ROOTS.flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  const sources: Map<string, string> = readSources(browserFiles);

  test("the import detector reads syntax, not text", () => {
    /*
     * The fixture pretends to live beside TableView, so a relative
     * "../../../Utils/API" really does resolve to the core client.
     */
    const fixturePath: string = path.join(
      COMMON_DIR,
      "UI",
      "Components",
      "ModelTable",
      "ImportDetectorFixture.tsx",
    );

    const findings: Array<Finding> = findBareClientValueImports(
      fixturePath,
      [
        'import API from "Common/Utils/API";',
        'import Core, { AuthRetryContext } from "../../../Utils/API";',
        'import * as CoreModule from "Common/Utils/API";',
        'import { default as Renamed } from "Common/Utils/API";',
        'export { default } from "Common/Utils/API";',
        'const lazy = import("Common/Utils/API");',
        'const required = require("../../../Utils/API");',
        'import type TypeOnly from "Common/Utils/API";',
        'import { AuthRetryContext as Context, RequestOptions } from "Common/Utils/API";',
        'import { type default as AlsoTypeOnly } from "Common/Utils/API";',
        'export type { APIRequestOptions } from "Common/Utils/API";',
        'import RefreshAware from "Common/UI/Utils/API/API";',
        'import Sibling from "../../Utils/API/API";',
        'const quoted = `import API from "Common/Utils/API"`;',
        '// import API from "Common/Utils/API";',
        '/* import API from "../../../Utils/API"; */',
      ].join("\n"),
    );

    expect(
      findings.map((finding: Finding): number => {
        return finding.line;
      }),
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("the transport detector reads syntax and scope, not text", () => {
    const findings: Array<Finding> = findRawTransports(
      "TransportDetectorFixture.tsx",
      [
        "void fetch('/api/thing');",
        "void window.fetch('/api/thing');",
        "const f = globalThis['fetch'];",
        "const xhr = new XMLHttpRequest();",
        "const events = new EventSource('/api/stream');",
        "navigator.sendBeacon('/api/beacon');",
        'import axios from "axios";',
        'const lazyAxios = import("axios");',
        "function load(): void {",
        "  const fetch = async (): Promise<void> => {};",
        "  void fetch();",
        "}",
        "function withParameter(fetch: () => void): void { fetch(); }",
        'import type { AxiosProgressEvent } from "axios";',
        'import { type AxiosError } from "axios";',
        "const instrumentation = new XMLHttpRequestInstrumentation();",
        "void ENV.fetch('REGION');",
        "void loader.fetch();",
        "const sample = `const response = await fetch(url);`;",
        "const snippet = \"await axios.get('https://example.com')\";",
        "// fetch('/api/commented-out');",
      ].join("\n"),
    );

    expect(
      findings.map((finding: Finding): number => {
        return finding.line;
      }),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test("the scan actually found the browser source", () => {
    /*
     * Guards the guard: a moved directory or a broken walk would otherwise
     * leave every assertion below passing over nothing.
     */
    for (const root of BROWSER_SOURCE_ROOTS) {
      expect(fs.existsSync(root)).toBe(true);
    }

    expect(browserFiles.length).toBeGreaterThan(1000);

    expect(
      browserFiles.some((file: string): boolean => {
        return file.includes(`${path.sep}src${path.sep}Server${path.sep}`);
      }),
    ).toBe(false);
  });

  test("the shared detector points at this checkout's core client", () => {
    /*
     * The helper finds packages/ from its own location. Were it ever to point
     * elsewhere, no import would resolve to BARE_CLIENT and the main
     * assertion below would pass over a scan that can find nothing.
     */
    expect(fs.existsSync(BARE_CLIENT)).toBe(true);
    expect(toPackagesPath(BARE_CLIENT)).toBe("Common/Utils/API.ts");
    expect(fromPackagesPath("App/Tests")).toBe(path.resolve(__dirname));
  });

  test("a type-only reference to the core module is not a finding", () => {
    /*
     * RequestOptions.ts names the core module for its RequestOptions
     * interface. It is deliberately NOT allowlisted: were it ever to take
     * the class as a value, the main assertion below should catch it.
     */
    const requestOptions: string = fromPackagesPath(
      "Common/UI/Utils/API/RequestOptions.ts",
    );
    const source: string = fs.readFileSync(requestOptions, "utf8");

    expect(referencesBareClient(requestOptions, source)).toBe(true);
    expect(findBareClientValueImports(requestOptions, source)).toEqual([]);
  });

  test("every allowlisted file still exists and still needs its exception", () => {
    expect(
      findStaleAllowlistEntries({
        baseDir: PACKAGES_DIR,
        bareClientAllowlist: BARE_CLIENT_ALLOWLIST,
        rawTransportAllowlist: RAW_TRANSPORT_ALLOWLIST,
      }),
    ).toEqual([]);
  });

  test("the staleness check fails on an entry that no longer earns its place", () => {
    /*
     * Negative control for the check above: a file that does not exist, and
     * files that exist but do not do what they are excused for (this suite
     * neither imports the core client as a value nor opens a raw request).
     */
    const thisFile: string = toPackagesPath(__filename);

    expect(
      findStaleAllowlistEntries({
        baseDir: PACKAGES_DIR,
        bareClientAllowlist: [
          { file: "Common/UI/Utils/API/Gone.ts", reason: "fixture" },
          { file: thisFile, reason: "fixture" },
        ],
        rawTransportAllowlist: [
          { file: "App/FeatureSet/Dashboard/src/Gone.tsx", reason: "fixture" },
          { file: thisFile, reason: "fixture" },
        ],
      }),
    ).toEqual([
      "Common/UI/Utils/API/Gone.ts no longer exists - remove it from BARE_CLIENT_ALLOWLIST",
      `${thisFile} no longer imports the core client - remove it from BARE_CLIENT_ALLOWLIST`,
      "App/FeatureSet/Dashboard/src/Gone.tsx no longer exists - remove it from RAW_TRANSPORT_ALLOWLIST",
      `${thisFile} no longer makes a raw request - remove it from RAW_TRANSPORT_ALLOWLIST`,
    ]);
  });

  test("an offender is named with its file and line, and only its allowlist entry excuses it", () => {
    /*
     * Negative control for the two main assertions below: the same pipeline
     * they run, over a synthetic Dashboard module, reports the module - and
     * an allowlist entry for a DIFFERENT file does not hide it.
     */
    const offendingFile: string = path.join(
      APP_DIR,
      "FeatureSet",
      "Dashboard",
      "src",
      "Pages",
      "SyntheticOffender.tsx",
    );
    const syntheticSources: Map<string, string> = new Map<string, string>([
      [
        offendingFile,
        [
          'import API from "Common/Utils/API";',
          "export const load = async (): Promise<void> => {",
          "  await fetch('/api/thing');",
          "};",
        ].join("\n"),
      ],
    ]);
    const otherEntry: Array<AllowlistEntry> = [
      { file: "App/FeatureSet/Dashboard/src/Pages/Other.tsx", reason: "x" },
    ];
    const ownEntry: Array<AllowlistEntry> = [
      {
        file: "App/FeatureSet/Dashboard/src/Pages/SyntheticOffender.tsx",
        reason: "x",
      },
    ];

    const bareClient: Array<string> = findBareClientOffenders({
      sources: syntheticSources,
      baseDir: PACKAGES_DIR,
      allowlist: otherEntry,
    });
    const rawTransport: Array<string> = findRawTransportOffenders({
      sources: syntheticSources,
      baseDir: PACKAGES_DIR,
      allowlist: otherEntry,
    });

    expect(bareClient).toHaveLength(1);
    expect(bareClient[0]).toMatch(
      /^App\/FeatureSet\/Dashboard\/src\/Pages\/SyntheticOffender\.tsx:1 imports the core client from "Common\/Utils\/API"\. /,
    );
    expect(rawTransport).toHaveLength(1);
    expect(rawTransport[0]).toMatch(
      /^App\/FeatureSet\/Dashboard\/src\/Pages\/SyntheticOffender\.tsx:3 calls the global fetch\(\)\. /,
    );

    expect(
      findBareClientOffenders({
        sources: syntheticSources,
        baseDir: PACKAGES_DIR,
        allowlist: ownEntry,
      }),
    ).toEqual([]);
    expect(
      findRawTransportOffenders({
        sources: syntheticSources,
        baseDir: PACKAGES_DIR,
        allowlist: ownEntry,
      }),
    ).toEqual([]);
    expect(allowlistedFiles(ownEntry)).toEqual(
      new Set<string>([
        "App/FeatureSet/Dashboard/src/Pages/SyntheticOffender.tsx",
      ]),
    );
  });

  test("no browser module holds the core client, which never refreshes a session", () => {
    /*
     * The strings ARE the message: jest prints the received array, so a
     * failure names every file and line along with the fix.
     */
    expect(
      findBareClientOffenders({
        sources: sources,
        baseDir: PACKAGES_DIR,
        allowlist: BARE_CLIENT_ALLOWLIST,
      }),
    ).toEqual([]);
  });

  test("no browser module opens a request around the client", () => {
    expect(
      findRawTransportOffenders({
        sources: sources,
        baseDir: PACKAGES_DIR,
        allowlist: RAW_TRANSPORT_ALLOWLIST,
      }),
    ).toEqual([]);
  });
});
