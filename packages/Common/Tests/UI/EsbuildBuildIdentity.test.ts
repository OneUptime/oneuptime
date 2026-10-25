import { afterAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import vm from "vm";

/*
 * Every frontend build names itself, so an open tab can tell that the server
 * serves a newer one (Common/UI/Utils/NewVersion). build() and watch() in
 * Common/UI/esbuild-config.js write the same id into the bundle (the
 * __ONEUPTIME_BUILD_ID__ define, read by RunningBuild.ts) and into
 * dist/build.json beside it, which the server hands out as a static file.
 *
 * These run the real build() and watch() in a node subprocess, the way the
 * frontend builds run them (esbuild refuses to load under Common's jsdom
 * jest environment; see EsbuildConfig.test.ts), on an entry that imports the
 * real RunningBuild.ts, and then run the bundle it produced.
 */

const ESBUILD_CONFIG: string = path.resolve(
  __dirname,
  "..",
  "..",
  "UI",
  "esbuild-config.js",
);

const RUNNING_BUILD: string = path.resolve(
  __dirname,
  "..",
  "..",
  "UI",
  "Utils",
  "NewVersion",
  "RunningBuild.ts",
);

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const temporaryRoots: Array<string> = [];

type ChildEnvironment = Record<string, string>;

function childEnvironment(overrides: ChildEnvironment): ChildEnvironment {
  const environment: ChildEnvironment = {};

  for (const key of Object.keys(process.env)) {
    const value: string | undefined = process.env[key];

    if (typeof value === "string") {
      environment[key] = value;
    }
  }

  delete environment["APP_VERSION"];
  delete environment["GIT_SHA"];
  delete environment["ONEUPTIME_FRONTEND_BUILD_ID"];
  delete environment["analyze"];
  environment["NODE_ENV"] = "production";

  return { ...environment, ...overrides };
}

interface BuildRun {
  ok: boolean;
  status: number;
  output: string;
  manifest: Record<string, unknown> | null;
  bundle: string;
  // What the bundle's getRunningBuild() returned, run for real.
  runningBuild: { buildId: string; manifestUrl: string } | null;
  files: Array<string>;
}

function runStep(
  step: "build" | "watch",
  env: ChildEnvironment,
  options?: { brokenEntry?: boolean },
): BuildRun {
  const root: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-build-identity-"),
  );
  temporaryRoots.push(root);

  const entry: string = path.join(root, "src", "Index.ts");
  const outdir: string = path.join(root, "public", "dist");

  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(
    entry,
    options?.brokenEntry
      ? "export const = ;\n"
      : `import { getRunningBuild } from ${JSON.stringify(RUNNING_BUILD)};\n(globalThis as any).runningBuild = getRunningBuild();\n`,
  );

  const script: string = `
    const c = require(${JSON.stringify(ESBUILD_CONFIG)});

    const cfg = c.createConfig({
      serviceName: "Dashboard",
      publicPath: "/dashboard/dist/",
      entryPoint: ${JSON.stringify(entry)},
      outdir: ${JSON.stringify(outdir)},
    });

    c.${step}(cfg, "Dashboard").then(function () {
      // watch() keeps esbuild watching: give its first build a moment.
      setTimeout(function () { process.exit(0); }, ${step === "watch" ? 1500 : 0});
    });
  `;

  const result: childProcess.SpawnSyncReturns<string> = childProcess.spawnSync(
    process.execPath,
    ["-e", script],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      env: childEnvironment(env),
    },
  );

  const manifestPath: string = path.join(outdir, "build.json");
  const bundlePath: string = path.join(outdir, "Index.js");

  const manifest: Record<string, unknown> | null = fs.existsSync(manifestPath)
    ? (JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<
        string,
        unknown
      >)
    : null;

  const bundle: string = fs.existsSync(bundlePath)
    ? fs.readFileSync(bundlePath, "utf8")
    : "";

  let runningBuild: { buildId: string; manifestUrl: string } | null = null;

  if (bundle) {
    const sandbox: Record<string, unknown> = {};
    sandbox["globalThis"] = sandbox;
    /*
     * The production bundle is ESM; its one import-free statement list runs
     * as a script once the export keyword (none here) is out of the way.
     */
    vm.runInNewContext(bundle, sandbox);
    runningBuild = sandbox["runningBuild"] as {
      buildId: string;
      manifestUrl: string;
    };
  }

  return {
    ok: result.status === 0,
    status: result.status ?? -1,
    output: `${result.stdout}${result.stderr}`,
    manifest,
    bundle,
    runningBuild,
    files: fs.existsSync(outdir) ? fs.readdirSync(outdir).sort() : [],
  };
}

afterAll(() => {
  while (temporaryRoots.length > 0) {
    fs.rmSync(temporaryRoots.pop() as string, {
      recursive: true,
      force: true,
    });
  }
});

describe("a frontend build names itself", () => {
  test("build() writes build.json beside the bundle, and the bundle carries the same id", () => {
    const run: BuildRun = runStep("build", {
      APP_VERSION: "14.0.90",
      GIT_SHA: "0123456789abcdef0123456789",
    });

    expect([run.ok, run.output.includes("build completed")]).toEqual([
      true,
      true,
    ]);
    expect(run.files).toEqual(["Index.js", "build.json"]);

    const buildId: string = run.manifest?.["buildId"] as string;

    expect(buildId).toMatch(/^14\.0\.90-0123456789ab-[0-9a-f]{12}$/);
    expect(run.manifest).toEqual({
      buildId: buildId,
      version: "14.0.90",
      gitSha: "0123456789abcdef0123456789",
    });

    // The running bundle reads the same id, and knows where to ask.
    expect(run.runningBuild).toEqual({
      buildId: buildId,
      manifestUrl: "/dashboard/dist/build.json",
    });
  });

  test("two builds of the same commit are two builds: the Community and Enterprise Dashboards never pass for each other", () => {
    const env: ChildEnvironment = {
      APP_VERSION: "14.0.90",
      GIT_SHA: "0123456789abcdef",
    };

    const first: BuildRun = runStep("build", env);
    const second: BuildRun = runStep("build", env);

    expect(first.manifest?.["buildId"]).toBeTruthy();
    expect(second.manifest?.["buildId"]).toBeTruthy();
    expect(first.manifest?.["buildId"]).not.toBe(second.manifest?.["buildId"]);
  });

  test("a build without a version or a commit still names itself", () => {
    const run: BuildRun = runStep("build", {});

    expect(run.ok).toBe(true);
    expect(run.manifest?.["buildId"]).toMatch(/^dev-local-[0-9a-f]{12}$/);
    expect(run.runningBuild?.buildId).toBe(run.manifest?.["buildId"]);
  });

  test("ONEUPTIME_FRONTEND_BUILD_ID names the build (fixtures that deploy two builds)", () => {
    const run: BuildRun = runStep("build", {
      ONEUPTIME_FRONTEND_BUILD_ID: "fixture-build-b",
    });

    expect(run.manifest?.["buildId"]).toBe("fixture-build-b");
    expect(run.runningBuild?.buildId).toBe("fixture-build-b");
  });

  test("an ONEUPTIME_FRONTEND_BUILD_ID that is not an id fails the build instead of shipping it", () => {
    const run: BuildRun = runStep("build", {
      ONEUPTIME_FRONTEND_BUILD_ID: 'not"an id',
    });

    expect(run.ok).toBe(false);
    expect(run.output).toContain("ONEUPTIME_FRONTEND_BUILD_ID");
    expect(run.manifest).toBeNull();
  });

  test("a build that fails leaves no build.json: a server never names a build whose files are not there", () => {
    const run: BuildRun = runStep("build", {}, { brokenEntry: true });

    expect(run.ok).toBe(false);
    expect(run.manifest).toBeNull();
  });

  test("watch() names its build too, once for the whole watch", () => {
    const run: BuildRun = runStep("watch", { APP_VERSION: "14.0.90" });

    expect(run.manifest?.["buildId"]).toMatch(/^14\.0\.90-local-[0-9a-f]{12}$/);
    expect(run.runningBuild).toEqual({
      buildId: run.manifest?.["buildId"],
      manifestUrl: "/dashboard/dist/build.json",
    });
  });

  test("odd characters in the version or the commit never reach the id", () => {
    const run: BuildRun = runStep("build", {
      APP_VERSION: "14.0.90 beta/1",
      GIT_SHA: "ab cd/ef",
    });

    expect(run.manifest?.["buildId"]).toMatch(
      /^14\.0\.90beta1-abcdef-[0-9a-f]{12}$/,
    );
  });
});

describe("what createConfig alone builds", () => {
  test("has no build id: a page built from it some other way never asks for build.json", () => {
    const script: string = `
      const c = require(${JSON.stringify(ESBUILD_CONFIG)});
      const cfg = c.createConfig({ serviceName: "Dashboard", publicPath: "/dashboard/dist/" });
      console.log(JSON.stringify(Object.keys(cfg.define)));
    `;

    const keys: Array<string> = JSON.parse(
      childProcess
        .execFileSync(process.execPath, ["-e", script], {
          cwd: REPOSITORY_ROOT,
          encoding: "utf8",
          env: childEnvironment({}),
        })
        .trim(),
    ) as Array<string>;

    expect(keys).not.toContain("__ONEUPTIME_BUILD_ID__");
    expect(keys).not.toContain("__ONEUPTIME_BUILD_MANIFEST_URL__");
  });
});
