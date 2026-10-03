import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const SOURCE: string = fs.readFileSync(
  path.join(REPO_ROOT, "Scripts/NPM/PublishAllPackages.sh"),
  "utf8",
);

describe("PublishAllPackages", () => {
  it("publishes the React Native recorder after Common is available", () => {
    const waitEnd: number = SOURCE.indexOf(
      'echo "@oneuptime/common@$package_version is now available on npm"',
    );
    const mobilePublish: number = SOURCE.indexOf(
      'publish_to_npm "packages/App/FeatureSet/MobileRecorder"',
    );

    expect(waitEnd).toBeGreaterThan(-1);
    expect(mobilePublish).toBeGreaterThan(waitEnd);
  });

  /*
   * 13.0.7 published @oneuptime/common successfully and then failed this
   * wait, which skipped the CLI and React Native publishes and every job
   * gated behind them. registry.npmjs.org serves packuments with
   * max-age=300 and npm answers from its cache until that expires, so the
   * already-published check seeded a document without the new version and
   * the poll re-read it for the whole five minutes it was allowed.
   */
  it("reads the registry rather than npm's cache when polling", () => {
    // Command lines only — the comment above the loop says "npm view" too.
    const registryReads: Array<string> = SOURCE.split("\n").filter(
      (line: string): boolean => {
        return line.includes("npm view") && !line.trim().startsWith("#");
      },
    );

    expect(registryReads).toHaveLength(2);

    for (const read of registryReads) {
      expect(read).toContain("npm view --prefer-online");
    }
  });

  /*
   * The budget has now been set twice by a release failing on it, so this
   * pins the evidence rather than a round number.
   *
   *   13.0.7 timed out at 5 minutes. Diagnosed as npm's packument cache
   *          (max-age=300) and raised to 15.
   *   14.0.7 timed out at 15 minutes. Not the cache: @oneuptime/common@14.0.7
   *          was accepted at 05:26:16Z and first readable at 06:21:39Z, so
   *          propagation genuinely took 55 minutes for a 181.7 MB unpacked
   *          package.
   *
   * The floor below is that measured 55 minutes. Anything at or under it is
   * a budget we have already watched a release fail on, and the failure is
   * expensive and misleading - the publish succeeds, then the CLI and React
   * Native publishes, the release e2e suites, the tags and the GitHub release
   * are all skipped behind it.
   */
  it("allows longer than Common has actually taken to propagate", () => {
    const attempts: RegExpMatchArray | null =
      SOURCE.match(/max_attempts=(\d+)/u);
    const delay: RegExpMatchArray | null = SOURCE.match(/sleep (\d+)/u);

    expect(attempts).not.toBeNull();
    expect(delay).not.toBeNull();

    const budgetInSeconds: number = Number(attempts![1]) * Number(delay![1]);

    // 14.0.7 took 3323s. Comfortably past the slowest propagation observed.
    const slowestObservedPropagationSeconds: number = 55 * 60;

    expect(budgetInSeconds).toBeGreaterThan(slowestObservedPropagationSeconds);

    /*
     * And past the registry's own max-age too, which is what 13.0.7 was
     * diagnosed as - kept as a separate, much lower bar so that a future
     * reduction cannot quietly reintroduce the original bug either.
     */
    expect(budgetInSeconds).toBeGreaterThan(300);
  });

  /*
   * The dependent packages type-check packages/Common's real sources through
   * the node_modules/Common link their lockfiles pin, so that directory needs
   * its own dependencies installed. publish_to_npm does that only as a side
   * effect of publishing and returns early when the version is already on
   * npm — which is what happens on a re-run after a partial failure. The
   * 13.0.7 retry skipped Common's publish and @oneuptime/cli then failed with
   * "Cannot find module 'typeorm'" against ../Common.
   */
  it("installs Common's dependencies before the dependent packages build", () => {
    const commonInstall: number = SOURCE.indexOf(
      "(cd packages/Common && npm install)",
    );
    const mobilePublish: number = SOURCE.indexOf(
      'publish_to_npm "packages/App/FeatureSet/MobileRecorder"',
    );
    const cliPublish: number = SOURCE.indexOf('publish_to_npm "packages/CLI"');

    expect(commonInstall).toBeGreaterThan(-1);
    expect(mobilePublish).toBeGreaterThan(commonInstall);
    expect(cliPublish).toBeGreaterThan(commonInstall);
  });

  it("isolates each nested package publish so the next path starts at the repo root", () => {
    const functionBody: string = SOURCE.slice(
      SOURCE.indexOf("publish_to_npm()"),
      SOURCE.indexOf("# Publish Common first"),
    );

    expect(functionBody).toContain('(\n        cd "$directory_name"');
    expect(functionBody).not.toMatch(/^\s*cd \.\.\s*$/mu);
  });

  it("compiles and tests the package in CI from its own dependencies alone", () => {
    const compileWorkflow: string = fs.readFileSync(
      path.join(REPO_ROOT, ".github/workflows/compile.yml"),
      "utf8",
    );
    const testWorkflow: string = fs.readFileSync(
      path.join(REPO_ROOT, ".github/workflows/test.mobile-recorder.yaml"),
      "utf8",
    );

    /*
     * Each workflow installs the package's own dependencies first - a step of
     * its own, through ./.github/actions/npm-install, which retries a network
     * failure - and then compiles, or tests, the package. In the Compile
     * workflow that is compile-recorders, the job for the SDKs published to
     * npm, which installs neither Common nor App: the package customers
     * install must build without either.
     */
    const install: RegExp =
      /uses: \.\/\.github\/actions\/npm-install\s+with:\s+working-directory: packages\/App\/FeatureSet\/MobileRecorder\s/;
    const compileCommand: string =
      "cd packages/App/FeatureSet/MobileRecorder && npm run compile && npm run build";
    const compileAt: number = compileWorkflow.indexOf(compileCommand);

    // The job the compile belongs to: from its key line to the next job's.
    const jobKeys: Array<RegExpMatchArray> = [
      ...compileWorkflow.matchAll(/\n {2}([A-Za-z0-9_-]+):\n/g),
    ];
    const owner: RegExpMatchArray | undefined = jobKeys
      .filter((key: RegExpMatchArray) => {
        return (key.index as number) < compileAt;
      })
      .pop();
    const next: RegExpMatchArray | undefined = jobKeys.find(
      (key: RegExpMatchArray) => {
        return (key.index as number) > compileAt;
      },
    );

    expect(compileAt).toBeGreaterThan(-1);
    expect(owner?.[1]).toBe("compile-recorders");

    const compileJob: string = compileWorkflow.slice(
      (owner?.index as number) + 1,
      next ? (next.index as number) + 1 : undefined,
    );

    expect(compileJob.search(install)).toBeGreaterThan(-1);
    expect(compileJob.indexOf(compileCommand)).toBeGreaterThan(
      compileJob.search(install),
    );
    expect(compileJob).not.toMatch(/working-directory: packages\/Common\s/);
    expect(compileJob).not.toMatch(/working-directory: packages\/App\s/);

    const test: number = testWorkflow.indexOf(
      "cd packages/App/FeatureSet/MobileRecorder && npm run test",
    );

    expect(testWorkflow).toContain("name: Mobile Recorder Test");
    expect(testWorkflow.search(install)).toBeGreaterThan(-1);
    expect(test).toBeGreaterThan(testWorkflow.search(install));
  });

  it("builds generated distribution files as part of npm packing", () => {
    const packageJson: {
      files: Array<string>;
      scripts: Record<string, string>;
    } = JSON.parse(
      fs.readFileSync(
        path.join(
          REPO_ROOT,
          "packages/App/FeatureSet/MobileRecorder/package.json",
        ),
        "utf8",
      ),
    ) as {
      files: Array<string>;
      scripts: Record<string, string>;
    };

    expect(packageJson.files).toContain("dist");
    expect(packageJson.files).toContain("android");
    expect(packageJson.files).toContain("ios");
    expect(packageJson.files).toContain("OneUptimeReactNativeReplay.podspec");
    expect(packageJson.scripts["prepack"]).toBe("npm run build");
  });
});
