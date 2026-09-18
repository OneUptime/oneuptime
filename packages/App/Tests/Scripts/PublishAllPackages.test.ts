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

  it("allows longer than one packument cache lifetime for Common to appear", () => {
    const attempts: RegExpMatchArray | null =
      SOURCE.match(/max_attempts=(\d+)/u);
    const delay: RegExpMatchArray | null = SOURCE.match(/sleep (\d+)/u);

    expect(attempts).not.toBeNull();
    expect(delay).not.toBeNull();

    const budgetInSeconds: number = Number(attempts![1]) * Number(delay![1]);

    // The registry's own max-age is 300s; wait comfortably past it.
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

  it("compiles and tests the package in dedicated CI jobs", () => {
    const compileWorkflow: string = fs.readFileSync(
      path.join(REPO_ROOT, ".github/workflows/compile.yml"),
      "utf8",
    );
    const testWorkflow: string = fs.readFileSync(
      path.join(REPO_ROOT, ".github/workflows/test.mobile-recorder.yaml"),
      "utf8",
    );

    expect(compileWorkflow).toContain("compile-mobile-recorder:");
    expect(compileWorkflow).toContain(
      "cd packages/App/FeatureSet/MobileRecorder && npm install && npm run compile && npm run build",
    );
    expect(testWorkflow).toContain("name: Mobile Recorder Test");
    expect(testWorkflow).toContain(
      "cd packages/App/FeatureSet/MobileRecorder && npm install && npm run test",
    );
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
