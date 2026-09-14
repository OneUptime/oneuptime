import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

const REPO_ROOT: string = path.resolve(__dirname, "../../..");
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
      'publish_to_npm "App/FeatureSet/MobileRecorder"',
    );

    expect(waitEnd).toBeGreaterThan(-1);
    expect(mobilePublish).toBeGreaterThan(waitEnd);
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
      "cd App/FeatureSet/MobileRecorder && npm install && npm run compile && npm run build",
    );
    expect(testWorkflow).toContain("name: Mobile Recorder Test");
    expect(testWorkflow).toContain(
      "cd App/FeatureSet/MobileRecorder && npm install && npm run test",
    );
  });

  it("builds generated distribution files as part of npm packing", () => {
    const packageJson: {
      files: Array<string>;
      scripts: Record<string, string>;
    } = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, "App/FeatureSet/MobileRecorder/package.json"),
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
