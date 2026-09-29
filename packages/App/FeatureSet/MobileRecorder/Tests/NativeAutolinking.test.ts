import fs from "node:fs";
import path from "node:path";

const packageRoot: string = path.resolve(__dirname, "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(packageRoot, relativePath), "utf8");
}

describe("native autolinking contract", () => {
  test("React Native config points at the shipped native projects", () => {
    const config: string = read("react-native.config.js");

    expect(config).toContain('sourceDir: "./android"');
    expect(config).toContain(
      "import com.oneuptime.replay.OneUptimeReplayPackage;",
    );
    expect(config).toContain("new OneUptimeReplayPackage()");
    expect(config).toContain(
      'podspecPath: "./OneUptimeReactNativeReplay.podspec"',
    );
  });

  test("Java, Objective-C, Swift, and JavaScript use one bridge name", () => {
    const bridgeName: string = "OneUptimeReplayViewTree";
    const androidModule: string = read(
      "android/src/main/java/com/oneuptime/replay/OneUptimeReplayViewTreeModule.java",
    );
    const objectiveCModule: string = read(
      "ios/OneUptimeReplayViewTreeModule.m",
    );
    const swiftModule: string = read("ios/OneUptimeReplayViewTreeModule.swift");
    const javascriptAdapter: string = read("src/NativeViewTree.ts");

    expect(androidModule).toContain(`return "${bridgeName}"`);
    expect(objectiveCModule).toContain(`RCT_EXTERN_MODULE(${bridgeName},`);
    expect(swiftModule).toContain(`@objc(${bridgeName})`);
    expect(javascriptAdapter).toContain(`["${bridgeName}"]`);
  });

  test("the podspec compiles both native bridge languages against React", () => {
    const podspec: string = read("OneUptimeReactNativeReplay.podspec");

    expect(podspec).toContain('spec.name = "OneUptimeReactNativeReplay"');
    expect(podspec).toContain('spec.source_files = "ios/**/*.{h,m,mm,swift}"');
    expect(podspec).toContain('spec.dependency "React-Core"');
  });

  test("the advertised RN 0.73 floor has a packed native compatibility build", () => {
    const packageJson: { peerDependencies: Record<string, string> } =
      JSON.parse(read("package.json")) as {
        peerDependencies: Record<string, string>;
      };
    const compatibilityProperties: string = read(
      "Tests/Fixtures/ReactNative073Android/gradle.properties",
    );
    const compatibilityBuild: string = read(
      "Tests/Fixtures/ReactNative073Android/build.gradle",
    );
    const nativeWorkflow: string = fs.readFileSync(
      path.resolve(
        packageRoot,
        "../../../../.github/workflows/test.mobile-recorder-native.yaml",
      ),
      "utf8",
    );

    expect(packageJson.peerDependencies["react-native"]).toBe(">=0.73.0");
    expect(compatibilityProperties).toMatch(
      /^reactNativeCompatibilityVersion=0\.73\./mu,
    );
    expect(compatibilityBuild).toContain(
      'details.requested.name == "react-android"',
    );
    expect(nativeWorkflow).toContain("android-react-native-073:");
    expect(nativeWorkflow).toContain("--legacy-peer-deps");
    expect(nativeWorkflow).toContain(":react-native-replay:assembleDebug");
  });
});
