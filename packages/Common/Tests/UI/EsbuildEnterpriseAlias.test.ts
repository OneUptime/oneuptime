import { afterAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * How the Dashboard and AdminDashboard builds decide between the Community
 * and the Enterprise UI (UI/esbuild-enterprise.js).
 *
 * Each frontend imports its Enterprise UI through one bare specifier, from
 * one file (src/Enterprise/Plugins.ts). The helper aliases that specifier to
 * ee/<Frontend>/Index.tsx when the Enterprise plugin is on disk (and
 * ONEUPTIME_EDITION allows it), and to the Community stub otherwise. Getting
 * it wrong fails silently in the worst direction: esbuild reads the
 * frontend's tsconfig "paths" natively, so a broken alias quietly bundles the
 * Community stub into an image tagged Enterprise. Hence the sentinel string,
 * and hence these tests building real bundles.
 *
 * Everything runs in a node SUBPROCESS, the way the build loads these files:
 * esbuild refuses to load under Common's jsdom test environment (see
 * EsbuildConfig.test.ts), and the helper reads the edition from the
 * environment, which a subprocess gets exactly as the build does.
 *
 * The fixtures are temp directories laid out like the repository
 * (packages/App/FeatureSet/<Frontend> next to ee/) and like the image
 * (/usr/src/app/FeatureSet/<Frontend> next to /usr/src/ee). The bundle
 * fixture uses the REAL src/Enterprise/{Plugins,EnterprisePlugins,
 * CommunityPlugins}.ts, so what is proven is the shipped door, not a copy.
 */

const UI_DIR: string = path.resolve(__dirname, "..", "..", "UI");
const ESBUILD_ENTERPRISE: string = path.join(UI_DIR, "esbuild-enterprise.js");
const ESBUILD_CONFIG: string = path.join(UI_DIR, "esbuild-config.js");
const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..", "..");
const REPOSITORY_ROOT: string = path.resolve(PACKAGES_DIR, "..");

const DASHBOARD_DIR: string = path.join(
  PACKAGES_DIR,
  "App",
  "FeatureSet",
  "Dashboard",
);
const ADMIN_DASHBOARD_DIR: string = path.join(
  PACKAGES_DIR,
  "App",
  "FeatureSet",
  "AdminDashboard",
);

const DASHBOARD_SENTINEL: string = "ONEUPTIME_EE_DASHBOARD_PLUGIN_v1";
const COMMUNITY_FIXTURE_MARKER: string = "COMMUNITY_STUB_FIXTURE_MARKER";

const temporaryRoots: Array<string> = [];

type ChildEnvironment = Record<string, string>;

/*
 * The child gets this process's environment minus everything that steers the
 * edition or the build mode, plus the overrides. null deletes a variable.
 */
function childEnvironment(
  overrides: Record<string, string | null>,
): ChildEnvironment {
  const environment: ChildEnvironment = {};

  for (const key of Object.keys(process.env)) {
    const value: string | undefined = process.env[key];

    if (typeof value === "string") {
      environment[key] = value;
    }
  }

  for (const key of [
    "ONEUPTIME_EDITION",
    "ONEUPTIME_EE_DIR",
    "NODE_ENV",
    "analyze",
  ]) {
    delete environment[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      delete environment[key];
    } else {
      environment[key] = value;
    }
  }

  return environment;
}

function runNode(
  script: string,
  overrides: Record<string, string | null>,
  cwd: string = REPOSITORY_ROOT,
  preload: string | null = null,
): string {
  const args: Array<string> = preload ? ["-r", preload] : [];

  return childProcess
    .execFileSync(process.execPath, [...args, "-e", script], {
      cwd,
      encoding: "utf8",
      env: childEnvironment(overrides),
    })
    .trim();
}

function makeTempDir(prefix: string): string {
  // realpath: macOS-style /tmp symlinks must not make paths compare unequal.
  const root: string = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
  );
  temporaryRoots.push(root);
  return root;
}

function writeFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

interface ResolveOptions {
  frontendDir: string;
  pluginSpecifier: string;
  eeSubdir: string;
  internalSpecifier: string;
}

interface BuildDecision {
  edition: string;
  requestedEdition: string;
  pluginEntry: string | null;
  communityStub: string;
  candidates: Array<string>;
  alias: Record<string, string>;
}

interface ResolveResult {
  ok: boolean;
  error: string;
  decision: BuildDecision | null;
  description: string;
}

function dashboardOptions(frontendDir: string): ResolveOptions {
  return {
    frontendDir,
    pluginSpecifier: "@oneuptime/ee-dashboard",
    eeSubdir: "Dashboard",
    internalSpecifier: "@oneuptime/dashboard",
  };
}

function adminDashboardOptions(frontendDir: string): ResolveOptions {
  return {
    frontendDir,
    pluginSpecifier: "@oneuptime/ee-admin-dashboard",
    eeSubdir: "AdminDashboard",
    internalSpecifier: "@oneuptime/admin-dashboard",
  };
}

/*
 * Runs resolveEnterpriseBuild in a child with the given environment. Options
 * are passed as JSON, so a missing key really is missing.
 */
function resolveInChild(
  options: Partial<ResolveOptions> | null,
  overrides: Record<string, string | null> = {},
): ResolveResult {
  const script: string = `
    const helper = require(${JSON.stringify(ESBUILD_ENTERPRISE)});
    try {
      const decision = helper.resolveEnterpriseBuild(${JSON.stringify(options)});
      console.log(JSON.stringify({
        ok: true,
        error: "",
        decision: decision,
        description: helper.describeEnterpriseBuild("Dashboard", decision),
      }));
    } catch (error) {
      console.log(JSON.stringify({
        ok: false,
        error: String((error && error.message) || error),
        decision: null,
        description: "",
      }));
    }
  `;

  return JSON.parse(runNode(script, overrides)) as ResolveResult;
}

function readRequestedEditionInChild(
  overrides: Record<string, string | null>,
): { ok: boolean; value: string; error: string } {
  const script: string = `
    const helper = require(${JSON.stringify(ESBUILD_ENTERPRISE)});
    try {
      console.log(JSON.stringify({ ok: true, value: helper.readRequestedEdition(), error: "" }));
    } catch (error) {
      console.log(JSON.stringify({ ok: false, value: "", error: String(error.message) }));
    }
  `;

  return JSON.parse(runNode(script, overrides)) as {
    ok: boolean;
    value: string;
    error: string;
  };
}

interface Layout {
  root: string;
  frontendDir: string;
  eeDir: string;
  communityStub: string;
  eeEntry: string;
}

/*
 * A minimal tree the resolver can decide on. "repository" mirrors
 * packages/App/FeatureSet/<Frontend> + <repo>/ee; "container" mirrors
 * /usr/src/app/FeatureSet/<Frontend> + /usr/src/ee.
 */
// Whether the temp directory tells "CaseProbe" and "caseprobe" apart.
function isCaseSensitiveFileSystem(): boolean {
  const directory: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-ee-case-"),
  );

  try {
    fs.writeFileSync(path.join(directory, "CaseProbe"), "");
    return !fs.existsSync(path.join(directory, "caseprobe"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function makeLayout(
  shape: "repository" | "container",
  options: { withEnterprise: boolean; frontend?: string; eeSubdir?: string },
): Layout {
  const root: string = makeTempDir("oneuptime-ee-alias-");
  const frontend: string = options.frontend || "Dashboard";
  const eeSubdir: string = options.eeSubdir || frontend;

  const frontendDir: string =
    shape === "repository"
      ? path.join(root, "packages", "App", "FeatureSet", frontend)
      : path.join(root, "usr", "src", "app", "FeatureSet", frontend);

  const eeDir: string =
    shape === "repository"
      ? path.join(root, "ee")
      : path.join(root, "usr", "src", "ee");

  const communityStub: string = path.join(
    frontendDir,
    "src",
    "Enterprise",
    "CommunityPlugins.ts",
  );
  writeFile(communityStub, "export default {};\n");

  const eeEntry: string = path.join(eeDir, eeSubdir, "Index.tsx");

  if (options.withEnterprise) {
    writeFile(eeEntry, "export default {};\n");
  }

  return { root, frontendDir, eeDir, communityStub, eeEntry };
}

afterAll(() => {
  while (temporaryRoots.length > 0) {
    fs.rmSync(temporaryRoots.pop() as string, {
      recursive: true,
      force: true,
    });
  }
});

describe("choosing the edition (resolveEnterpriseBuild)", () => {
  test("a checkout without ee/ builds the Community stub", () => {
    const layout: Layout = makeLayout("repository", { withEnterprise: false });
    const result: ResolveResult = resolveInChild(
      dashboardOptions(layout.frontendDir),
    );

    expect([result.ok, result.error]).toEqual([true, ""]);
    expect(result.decision!.edition).toBe("community");
    expect(result.decision!.requestedEdition).toBe("auto");
    expect(result.decision!.pluginEntry).toBeNull();
    expect(result.decision!.alias["@oneuptime/ee-dashboard"]).toBe(
      layout.communityStub,
    );
  });

  test("a checkout with ee/ builds the Enterprise plugin (repository layout)", () => {
    const layout: Layout = makeLayout("repository", { withEnterprise: true });
    const result: ResolveResult = resolveInChild(
      dashboardOptions(layout.frontendDir),
    );

    expect(result.decision!.edition).toBe("enterprise");
    expect(result.decision!.pluginEntry).toBe(layout.eeEntry);
    // The FILE, not the directory: a directory alias misses Index.tsx.
    expect(result.decision!.alias["@oneuptime/ee-dashboard"]).toBe(
      path.join(layout.root, "ee", "Dashboard", "Index.tsx"),
    );
  });

  test("the image layout finds /usr/src/ee next to /usr/src/app", () => {
    const layout: Layout = makeLayout("container", { withEnterprise: true });
    const result: ResolveResult = resolveInChild(
      dashboardOptions(layout.frontendDir),
    );

    expect(result.decision!.edition).toBe("enterprise");
    expect(result.decision!.alias["@oneuptime/ee-dashboard"]).toBe(
      path.join(layout.root, "usr", "src", "ee", "Dashboard", "Index.tsx"),
    );
  });

  test("tries the repository location first, then the image location", () => {
    const layout: Layout = makeLayout("repository", { withEnterprise: false });
    const result: ResolveResult = resolveInChild(
      dashboardOptions(layout.frontendDir),
    );

    expect(result.decision!.candidates).toEqual([
      path.join(layout.root, "ee", "Dashboard", "Index.tsx"),
      path.join(layout.root, "packages", "ee", "Dashboard", "Index.tsx"),
    ]);
  });

  test("ONEUPTIME_EDITION=community builds the stub even with ee/ present", () => {
    const layout: Layout = makeLayout("repository", { withEnterprise: true });
    const result: ResolveResult = resolveInChild(
      dashboardOptions(layout.frontendDir),
      { ONEUPTIME_EDITION: "community" },
    );

    expect(result.decision!.edition).toBe("community");
    expect(result.decision!.requestedEdition).toBe("community");
    expect(result.decision!.pluginEntry).toBeNull();
    expect(result.decision!.alias["@oneuptime/ee-dashboard"]).toBe(
      layout.communityStub,
    );
  });

  test("ONEUPTIME_EDITION=enterprise builds the plugin when it is there", () => {
    const layout: Layout = makeLayout("repository", { withEnterprise: true });
    const result: ResolveResult = resolveInChild(
      dashboardOptions(layout.frontendDir),
      { ONEUPTIME_EDITION: "enterprise" },
    );

    expect(result.decision!.edition).toBe("enterprise");
    expect(result.decision!.alias["@oneuptime/ee-dashboard"]).toBe(
      layout.eeEntry,
    );
  });

  test("ONEUPTIME_EDITION=enterprise with no plugin fails the build instead of shipping Community", () => {
    const layout: Layout = makeLayout("repository", { withEnterprise: false });
    const result: ResolveResult = resolveInChild(
      dashboardOptions(layout.frontendDir),
      { ONEUPTIME_EDITION: "enterprise" },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("ONEUPTIME_EDITION=enterprise");
    expect(result.error).toContain("Enterprise UI plugin for Dashboard");
    // It names every place it looked, so the fix is obvious from the log.
    expect(result.error).toContain(
      path.join(layout.root, "ee", "Dashboard", "Index.tsx"),
    );
    expect(result.error).toContain(
      path.join(layout.root, "packages", "ee", "Dashboard", "Index.tsx"),
    );
  });

  test("an ee/ directory without the plugin file is not the Enterprise Edition", () => {
    /*
     * A leftover ee/node_modules after switching branches, or a directory
     * that happens to be called Index.tsx, must not count: "found" means the
     * Index.tsx FILE.
     */
    const layout: Layout = makeLayout("repository", { withEnterprise: false });
    fs.mkdirSync(path.join(layout.eeDir, "node_modules"), { recursive: true });
    fs.mkdirSync(path.join(layout.eeDir, "Dashboard", "Index.tsx", "nested"), {
      recursive: true,
    });

    const auto: ResolveResult = resolveInChild(
      dashboardOptions(layout.frontendDir),
    );
    expect(auto.decision!.edition).toBe("community");

    const enterprise: ResolveResult = resolveInChild(
      dashboardOptions(layout.frontendDir),
      { ONEUPTIME_EDITION: "enterprise" },
    );
    expect(enterprise.ok).toBe(false);
  });

  /*
   * On a case-insensitive file system (macOS, Windows) a lowercase index.tsx
   * IS Index.tsx, so this only means something where names are
   * case-sensitive - the Linux build machines and the image.
   */
  const caseSensitiveTest: typeof test.skip = isCaseSensitiveFileSystem()
    ? test
    : test.skip;

  caseSensitiveTest("a lowercase index.tsx is not the plugin file", () => {
    const layout: Layout = makeLayout("repository", { withEnterprise: false });
    writeFile(path.join(layout.eeDir, "Dashboard", "index.tsx"), "");

    const auto: ResolveResult = resolveInChild(
      dashboardOptions(layout.frontendDir),
    );
    expect(auto.decision!.edition).toBe("community");

    const enterprise: ResolveResult = resolveInChild(
      dashboardOptions(layout.frontendDir),
      { ONEUPTIME_EDITION: "enterprise" },
    );
    expect(enterprise.ok).toBe(false);
  });

  test("each frontend picks its own ee subdirectory", () => {
    const layout: Layout = makeLayout("repository", {
      withEnterprise: true,
      frontend: "AdminDashboard",
    });
    // A Dashboard plugin alone must not satisfy the AdminDashboard.
    writeFile(path.join(layout.eeDir, "Dashboard", "Index.tsx"), "");

    const admin: ResolveResult = resolveInChild(
      adminDashboardOptions(layout.frontendDir),
    );

    expect(admin.decision!.alias["@oneuptime/ee-admin-dashboard"]).toBe(
      path.join(layout.eeDir, "AdminDashboard", "Index.tsx"),
    );

    fs.rmSync(path.join(layout.eeDir, "AdminDashboard"), {
      recursive: true,
      force: true,
    });

    const adminWithoutPlugin: ResolveResult = resolveInChild(
      adminDashboardOptions(layout.frontendDir),
    );
    expect(adminWithoutPlugin.decision!.edition).toBe("community");
  });

  test("ONEUPTIME_EE_DIR replaces the default locations", () => {
    const layout: Layout = makeLayout("repository", { withEnterprise: true });
    const elsewhere: string = makeTempDir("oneuptime-ee-elsewhere-");
    writeFile(path.join(elsewhere, "Dashboard", "Index.tsx"), "");

    const moved: ResolveResult = resolveInChild(
      dashboardOptions(layout.frontendDir),
      { ONEUPTIME_EE_DIR: elsewhere },
    );

    expect(moved.decision!.candidates).toEqual([
      path.join(elsewhere, "Dashboard", "Index.tsx"),
    ]);
    expect(moved.decision!.alias["@oneuptime/ee-dashboard"]).toBe(
      path.join(elsewhere, "Dashboard", "Index.tsx"),
    );

    // Pointed at a directory with no plugin, the repository ee/ is NOT used.
    const empty: string = makeTempDir("oneuptime-ee-empty-");
    const none: ResolveResult = resolveInChild(
      dashboardOptions(layout.frontendDir),
      { ONEUPTIME_EE_DIR: empty },
    );
    expect(none.decision!.edition).toBe("community");
  });

  test("always maps the internal specifier and Common into the frontend", () => {
    /*
     * ee code reaches core as "@oneuptime/dashboard/..." and "Common/...",
     * both served from the frontend itself so bundling never needs an
     * install inside ee/. Both editions get the same aliases, so core
     * resolves identically either way.
     */
    for (const withEnterprise of [false, true]) {
      const layout: Layout = makeLayout("repository", { withEnterprise });
      const result: ResolveResult = resolveInChild(
        dashboardOptions(layout.frontendDir),
      );

      expect(result.decision!.alias["@oneuptime/dashboard"]).toBe(
        path.join(layout.frontendDir, "src"),
      );
      expect(result.decision!.alias["Common"]).toBe(
        path.join(layout.frontendDir, "node_modules", "Common"),
      );
      expect(Object.keys(result.decision!.alias).sort()).toEqual(
        ["@oneuptime/dashboard", "@oneuptime/ee-dashboard", "Common"].sort(),
      );
    }
  });

  test("says which edition it built, for the build log", () => {
    const enterpriseLayout: Layout = makeLayout("repository", {
      withEnterprise: true,
    });
    const enterprise: ResolveResult = resolveInChild(
      dashboardOptions(enterpriseLayout.frontendDir),
    );
    expect(enterprise.description).toBe(
      `Dashboard: building the Enterprise Edition UI from ${enterpriseLayout.eeEntry}`,
    );

    const communityLayout: Layout = makeLayout("repository", {
      withEnterprise: true,
    });
    const community: ResolveResult = resolveInChild(
      dashboardOptions(communityLayout.frontendDir),
      { ONEUPTIME_EDITION: "community" },
    );
    expect(community.description).toBe(
      "Dashboard: building the Community Edition UI (ONEUPTIME_EDITION=community)",
    );
  });

  test("refuses a frontend with no Community stub", () => {
    const layout: Layout = makeLayout("repository", { withEnterprise: true });
    fs.rmSync(layout.communityStub);

    const result: ResolveResult = resolveInChild(
      dashboardOptions(layout.frontendDir),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Community plugin stub is missing");
  });

  test("refuses missing options and a relative frontend directory", () => {
    const layout: Layout = makeLayout("repository", { withEnterprise: false });

    for (const key of [
      "frontendDir",
      "pluginSpecifier",
      "eeSubdir",
      "internalSpecifier",
    ] as Array<keyof ResolveOptions>) {
      const options: Partial<ResolveOptions> = {
        ...dashboardOptions(layout.frontendDir),
      };
      delete options[key];

      const result: ResolveResult = resolveInChild(options);
      expect([key, result.ok, result.error]).toEqual([
        key,
        false,
        `resolveEnterpriseBuild: "${key}" is required.`,
      ]);
    }

    expect(resolveInChild(null).ok).toBe(false);

    const relative: ResolveResult = resolveInChild({
      ...dashboardOptions("packages/App/FeatureSet/Dashboard"),
    });
    expect(relative.ok).toBe(false);
    expect(relative.error).toContain("must be absolute");
  });
});

describe("reading ONEUPTIME_EDITION", () => {
  test.each([
    [null, "auto"],
    ["", "auto"],
    ["   ", "auto"],
    ["auto", "auto"],
    ["community", "community"],
    ["enterprise", "enterprise"],
    [" Enterprise ", "enterprise"],
    ["COMMUNITY", "community"],
  ])("%p reads as %p", (raw: string | null, expected: string) => {
    const result: { ok: boolean; value: string; error: string } =
      readRequestedEditionInChild({ ONEUPTIME_EDITION: raw });

    expect([result.ok, result.value]).toEqual([true, expected]);
  });

  test.each(["enterprize", "ee", "ce", "true"])(
    "a typo (%p) fails the build rather than guessing an edition",
    (raw: string) => {
      const result: { ok: boolean; value: string; error: string } =
        readRequestedEditionInChild({ ONEUPTIME_EDITION: raw });

      expect(result.ok).toBe(false);
      expect(result.error).toContain(
        "ONEUPTIME_EDITION must be one of auto, community, enterprise",
      );
      expect(result.error).toContain(`"${raw}"`);
    },
  );
});

describe("the real frontends", () => {
  /*
   * The two shipped esbuild.config.js files, run for real with esbuild's
   * build() swapped for a probe (preloaded into the same module instance),
   * so what is asserted is the config they would build with. NODE_PATH lets
   * "Common/..." resolve even where the frontend is not installed - the
   * Common Test CI job installs Common alone.
   */
  interface ProbedBuild {
    alias: Record<string, string>;
    keys: Array<string>;
    log: Array<string>;
  }

  function probeFrontendBuild(
    frontendDir: string,
    overrides: Record<string, string | null>,
  ): ProbedBuild {
    const probeDir: string = makeTempDir("oneuptime-ee-probe-");
    const preload: string = path.join(probeDir, "probe.js");

    writeFile(
      preload,
      `
      const config = require(${JSON.stringify(ESBUILD_CONFIG)});
      const log = [];
      const originalLog = console.log;
      console.log = function () {
        log.push(Array.prototype.join.call(arguments, " "));
      };
      function report(built) {
        originalLog(JSON.stringify({
          alias: built.alias,
          keys: Object.keys(built),
          log: log,
        }));
      }
      config.build = report;
      config.watch = report;
      `,
    );

    const output: string = runNode(
      `require(${JSON.stringify(path.join(frontendDir, "esbuild.config.js"))});`,
      { NODE_PATH: PACKAGES_DIR, ...overrides },
      frontendDir,
      preload,
    );

    return JSON.parse(output) as ProbedBuild;
  }

  const EXPECTED_CONFIG_KEYS: Array<string> = [
    "entryPoints",
    "bundle",
    "outdir",
    "format",
    "platform",
    "target",
    "sourcemap",
    "minify",
    "keepNames",
    "treeShaking",
    "splitting",
    "publicPath",
    "define",
    "external",
    "alias",
    "plugins",
    "loader",
    "resolveExtensions",
    "metafile",
  ];

  test.each([
    [
      "Dashboard",
      DASHBOARD_DIR,
      "@oneuptime/ee-dashboard",
      "@oneuptime/dashboard",
    ],
    [
      "AdminDashboard",
      ADMIN_DASHBOARD_DIR,
      "@oneuptime/ee-admin-dashboard",
      "@oneuptime/admin-dashboard",
    ],
  ])(
    "%s builds the Community stub under ONEUPTIME_EDITION=community",
    (
      name: string,
      frontendDir: string,
      pluginSpecifier: string,
      internalSpecifier: string,
    ) => {
      const probed: ProbedBuild = probeFrontendBuild(frontendDir, {
        ONEUPTIME_EDITION: "community",
      });

      expect(probed.alias[pluginSpecifier]).toBe(
        path.join(frontendDir, "src", "Enterprise", "CommunityPlugins.ts"),
      );
      expect(probed.alias[internalSpecifier]).toBe(
        path.join(frontendDir, "src"),
      );
      expect(probed.alias["Common"]).toBe(
        path.join(frontendDir, "node_modules", "Common"),
      );

      // The shared aliases createConfig adds are still there.
      expect(Object.keys(probed.alias)).toEqual(
        expect.arrayContaining(["react", "react-dom", "i18next"]),
      );

      // additionalAlias only: no new top-level config keys.
      expect([...probed.keys].sort()).toEqual([...EXPECTED_CONFIG_KEYS].sort());

      expect(probed.log).toContain(
        `${name}: building the Community Edition UI (ONEUPTIME_EDITION=community)`,
      );
    },
  );

  test.each([
    ["Dashboard", DASHBOARD_DIR, "@oneuptime/ee-dashboard"],
    ["AdminDashboard", ADMIN_DASHBOARD_DIR, "@oneuptime/ee-admin-dashboard"],
  ])(
    "%s builds the Enterprise plugin when one is on disk",
    (name: string, frontendDir: string, pluginSpecifier: string) => {
      const eeDir: string = makeTempDir("oneuptime-ee-real-frontend-");
      const entry: string = path.join(eeDir, name, "Index.tsx");
      writeFile(entry, "export default {};\n");

      const probed: ProbedBuild = probeFrontendBuild(frontendDir, {
        ONEUPTIME_EE_DIR: eeDir,
      });

      expect(probed.alias[pluginSpecifier]).toBe(entry);
      expect(probed.log).toContain(
        `${name}: building the Enterprise Edition UI from ${entry}`,
      );
    },
  );
});

describe("bundling for real", () => {
  interface BundleResult {
    ok: boolean;
    error: string;
    // Every emitted file concatenated - chunks included.
    output: string;
    inputs: Array<string>;
    evaluated: {
      ok: boolean;
      error: string;
      value: {
        shell: string;
        pluginKeys: Array<string>;
        buildMarker: string | null;
        areaResult: string | null;
        sharedCount: number;
        commonLabel: string;
      } | null;
    };
  }

  const REAL_ENTERPRISE_DIR: string = path.join(
    DASHBOARD_DIR,
    "src",
    "Enterprise",
  );

  /*
   * A frontend that uses the REAL core door. The ee area imports a core shell
   * back through "@oneuptime/dashboard/...", closing the same import cycle
   * the real Enterprise bundle has (core shell -> Plugins -> ee Index -> ee
   * area -> core shell).
   */
  function makeBundleFixture(options: {
    withEnterprise: boolean;
    topLevelPluginRead?: boolean;
  }): Layout {
    const layout: Layout = makeLayout("repository", {
      withEnterprise: false,
    });
    const src: string = path.join(layout.frontendDir, "src");

    for (const file of [
      "Plugins.ts",
      "EnterprisePlugins.ts",
      "CommunityPlugins.ts",
    ]) {
      writeFile(
        path.join(src, "Enterprise", file),
        fs.readFileSync(path.join(REAL_ENTERPRISE_DIR, file), "utf8"),
      );
    }

    // Proves the stub is what ships when ee/ is not bundled.
    fs.appendFileSync(
      path.join(src, "Enterprise", "CommunityPlugins.ts"),
      `\nexport const COMMUNITY_MARKER: string = "${COMMUNITY_FIXTURE_MARKER}";\n(globalThis as any).__communityMarker = COMMUNITY_MARKER;\n`,
    );

    writeFile(
      path.join(src, "Utils", "Shared.ts"),
      "export const sharedToken: { count: number } = { count: 0 };\n",
    );

    writeFile(
      path.join(src, "Components", "Shell.ts"),
      `
      import { getDashboardPlugins } from "../Enterprise/Plugins";
      export const renderShell = (): string => {
        return getDashboardPlugins().buildMarker || "community";
      };
      `,
    );

    writeFile(
      path.join(src, "Index.tsx"),
      `
      import { renderShell } from "./Components/Shell";
      import { getDashboardPlugins } from "./Enterprise/Plugins";
      import { sharedToken } from "./Utils/Shared";
      import { commonLabel } from "Common/Label";

      sharedToken.count += 1;

      const plugins: any = getDashboardPlugins();
      (globalThis as any).__fixtureResult = {
        shell: renderShell(),
        pluginKeys: Object.keys(plugins).sort(),
        buildMarker: plugins.buildMarker || null,
        areaResult: plugins.SettingsSSO ? plugins.SettingsSSO() : null,
        sharedCount: sharedToken.count,
        commonLabel: commonLabel,
      };
      `,
    );

    // A stand-in Common, reached through <frontend>/node_modules/Common.
    const common: string = path.join(layout.root, "packages", "Common");
    writeFile(
      path.join(common, "Label.ts"),
      'export const commonLabel: string = "common-label";\n',
    );
    fs.mkdirSync(path.join(layout.frontendDir, "node_modules"), {
      recursive: true,
    });
    fs.symlinkSync(
      common,
      path.join(layout.frontendDir, "node_modules", "Common"),
      "dir",
    );

    if (options.withEnterprise) {
      writeFile(
        path.join(layout.eeDir, "Dashboard", "Area", "Plugins.ts"),
        options.topLevelPluginRead
          ? `
          import { getDashboardPlugins } from "@oneuptime/dashboard/Enterprise/Plugins";
          const eager: any = getDashboardPlugins();
          export default { SettingsSSO: (): string => String(eager) };
          `
          : `
          import { renderShell } from "@oneuptime/dashboard/Components/Shell";
          import { sharedToken } from "@oneuptime/dashboard/Utils/Shared";
          import { commonLabel } from "Common/Label";
          export default {
            SettingsSSO: (): string => {
              return commonLabel + ":" + typeof renderShell + ":" + sharedToken.count;
            },
          };
          `,
      );

      writeFile(
        layout.eeEntry,
        `
        import { DashboardEnterprisePlugins } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
        import AreaPlugins from "./Area/Plugins";

        export const ONEUPTIME_EE_DASHBOARD_PLUGIN_SENTINEL: string =
          "${DASHBOARD_SENTINEL}";

        export default {
          ...AreaPlugins,
          buildMarker: ONEUPTIME_EE_DASHBOARD_PLUGIN_SENTINEL,
        } satisfies DashboardEnterprisePlugins;
        `,
      );
    }

    return layout;
  }

  /*
   * Builds the fixture with the real createConfig plus the helper's aliases -
   * exactly what esbuild.config.js does - then loads the bundle as ESM.
   */
  function bundle(
    layout: Layout,
    overrides: Record<string, string | null>,
  ): BundleResult {
    const outdir: string = path.join(layout.root, "out");

    const script: string = `
      const fs = require("fs");
      const path = require("path");
      const url = require("url");
      const { createConfig } = require(${JSON.stringify(ESBUILD_CONFIG)});
      const { resolveEnterpriseAliases } = require(${JSON.stringify(ESBUILD_ENTERPRISE)});
      const esbuild = require(require.resolve("esbuild", {
        paths: [${JSON.stringify(UI_DIR)}],
      }));

      const outdir = ${JSON.stringify(outdir)};
      const empty = { ok: false, error: "", value: null };

      (async function () {
        let cfg;
        let result;
        try {
          cfg = createConfig({
            serviceName: "Dashboard",
            publicPath: "/dashboard/dist/",
            additionalAlias: resolveEnterpriseAliases({
              frontendDir: ${JSON.stringify(layout.frontendDir)},
              pluginSpecifier: "@oneuptime/ee-dashboard",
              eeSubdir: "Dashboard",
              internalSpecifier: "@oneuptime/dashboard",
            }),
          });
          cfg.entryPoints = [${JSON.stringify(path.join(layout.frontendDir, "src", "Index.tsx"))}];
          cfg.outdir = outdir;
          cfg.metafile = true;
          cfg.logLevel = "silent";
          result = await esbuild.build(cfg);
        } catch (error) {
          console.log(JSON.stringify({
            ok: false,
            error: String((error && error.message) || error),
            output: "",
            inputs: [],
            evaluated: empty,
          }));
          return;
        }

        const files = fs.readdirSync(outdir).filter(function (file) {
          return file.endsWith(".js");
        });
        const output = files.map(function (file) {
          return fs.readFileSync(path.join(outdir, file), "utf8");
        }).join("\\n");

        // Load the bundle the way a browser would: as ES modules.
        fs.writeFileSync(path.join(outdir, "package.json"), '{"type":"module"}');
        let evaluated;
        try {
          await import(url.pathToFileURL(path.join(outdir, "Index.js")).href);
          evaluated = { ok: true, error: "", value: globalThis.__fixtureResult };
        } catch (error) {
          evaluated = {
            ok: false,
            error: String((error && error.message) || error),
            value: null,
          };
        }

        console.log(JSON.stringify({
          ok: true,
          error: "",
          output: output,
          inputs: Object.keys(result.metafile.inputs),
          evaluated: evaluated,
        }));
      })();
    `;

    return JSON.parse(runNode(script, overrides)) as BundleResult;
  }

  function countInputs(inputs: Array<string>, suffix: string): number {
    return inputs.filter((input: string): boolean => {
      return input.endsWith(suffix);
    }).length;
  }

  test("an Enterprise production build carries the sentinel and loads", () => {
    const layout: Layout = makeBundleFixture({ withEnterprise: true });
    const result: BundleResult = bundle(layout, { NODE_ENV: "production" });

    expect([result.ok, result.error]).toEqual([true, ""]);

    // Minified and tree-shaken, and the sentinel is still there.
    expect(result.output).toContain(DASHBOARD_SENTINEL);
    expect(result.output).not.toContain(COMMUNITY_FIXTURE_MARKER);
    expect(countInputs(result.inputs, "ee/Dashboard/Index.tsx")).toBe(1);
    expect(countInputs(result.inputs, "Enterprise/CommunityPlugins.ts")).toBe(
      0,
    );

    expect([result.evaluated.ok, result.evaluated.error]).toEqual([true, ""]);
    expect(result.evaluated.value).toEqual({
      shell: DASHBOARD_SENTINEL,
      pluginKeys: ["SettingsSSO", "buildMarker"],
      buildMarker: DASHBOARD_SENTINEL,
      // ee reached core through "@oneuptime/dashboard/..." and "Common/...".
      areaResult: "common-label:function:1",
      sharedCount: 1,
      commonLabel: "common-label",
    });
  });

  test("core and ee share ONE instance of a core module", () => {
    /*
     * The entry imports Utils/Shared relatively and the ee area imports it as
     * "@oneuptime/dashboard/Utils/Shared". Two copies would mean two
     * singletons (two i18n instances, two stores) - the count above would
     * read 0 from the ee side.
     */
    const layout: Layout = makeBundleFixture({ withEnterprise: true });
    const result: BundleResult = bundle(layout, { NODE_ENV: "production" });

    expect(countInputs(result.inputs, "src/Utils/Shared.ts")).toBe(1);
    expect(countInputs(result.inputs, "Label.ts")).toBe(1);
  });

  test("an Enterprise development build carries the sentinel too", () => {
    const layout: Layout = makeBundleFixture({ withEnterprise: true });
    const result: BundleResult = bundle(layout, {});

    expect([result.ok, result.error]).toEqual([true, ""]);
    expect(result.output).toContain(DASHBOARD_SENTINEL);
    expect(result.evaluated.value?.buildMarker).toBe(DASHBOARD_SENTINEL);
  });

  test("a Community build has no sentinel and no ee code", () => {
    const layout: Layout = makeBundleFixture({ withEnterprise: false });
    const result: BundleResult = bundle(layout, { NODE_ENV: "production" });

    expect([result.ok, result.error]).toEqual([true, ""]);
    expect(result.output).not.toContain(DASHBOARD_SENTINEL);
    expect(result.output).toContain(COMMUNITY_FIXTURE_MARKER);
    expect(countInputs(result.inputs, "Enterprise/CommunityPlugins.ts")).toBe(
      1,
    );
    expect(
      result.inputs.some((input: string): boolean => {
        return input.includes("ee/");
      }),
    ).toBe(false);

    expect(result.evaluated.value).toEqual({
      shell: "community",
      pluginKeys: [],
      buildMarker: null,
      areaResult: null,
      sharedCount: 1,
      commonLabel: "common-label",
    });
  });

  test("ONEUPTIME_EDITION=community leaves ee/ out even when it is on disk", () => {
    const layout: Layout = makeBundleFixture({ withEnterprise: true });
    const result: BundleResult = bundle(layout, {
      NODE_ENV: "production",
      ONEUPTIME_EDITION: "community",
    });

    expect([result.ok, result.error]).toEqual([true, ""]);
    expect(result.output).not.toContain(DASHBOARD_SENTINEL);
    expect(
      result.inputs.some((input: string): boolean => {
        return input.includes("ee/Dashboard");
      }),
    ).toBe(false);
    expect(result.evaluated.value?.shell).toBe("community");
  });

  test("ONEUPTIME_EDITION=enterprise without ee/ fails before bundling anything", () => {
    const layout: Layout = makeBundleFixture({ withEnterprise: false });
    const result: BundleResult = bundle(layout, {
      NODE_ENV: "production",
      ONEUPTIME_EDITION: "enterprise",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("ONEUPTIME_EDITION=enterprise");
    expect(fs.existsSync(path.join(layout.root, "out"))).toBe(false);
  });

  test("reading the plugins at module load crashes the Enterprise bundle (why the rule exists)", () => {
    /*
     * The negative control for the "call getDashboardPlugins() only inside a
     * function" rule: the same cycle, but the ee area reads the plugins at
     * its top level. It builds fine and dies on load - and only in the
     * Enterprise build, which is why it needs a guard of its own
     * (App/Tests/EnterpriseImportGuard.test.ts).
     */
    const layout: Layout = makeBundleFixture({
      withEnterprise: true,
      topLevelPluginRead: true,
    });
    const result: BundleResult = bundle(layout, { NODE_ENV: "production" });

    expect([result.ok, result.error]).toEqual([true, ""]);
    expect(result.evaluated.ok).toBe(false);
    expect(result.evaluated.error).not.toBe("");
  });
});
