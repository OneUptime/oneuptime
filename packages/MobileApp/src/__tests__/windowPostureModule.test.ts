import { describe, expect, test } from "@jest/globals";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  FOLDS_CHANGE_EVENT,
  WINDOW_POSTURE_MODULE_NAME,
} from "../layout/postureSource";
import { parseFoldReport, type FoldReport } from "../layout/windowPosture";

/*
 * The native half of the posture check (modules/window-posture), pinned from
 * JavaScript. No device or Android toolchain runs in CI, so what can be held
 * here is held here:
 *
 * - Expo's autolinking - the same command the Android build runs - links the
 *   module into Android builds and into no iOS build, so iOS keeps today's
 *   layout until its iOS side (ios/, written against the iOS 27.1 SDK's
 *   division regions and hinge) is built on Xcode 27.1 and checked in the
 *   iPhone Duo simulator - one line in expo-module.config.json links it;
 * - the names and the report's shape the Kotlin side uses are the ones the
 *   JavaScript side reads, so a rename on one side cannot silently turn the
 *   posture off;
 * - the module builds against the same androidx.window React Native itself
 *   ships, so it adds no second version to the app.
 *
 * The Kotlin's own logic has JVM unit tests beside it (android/src/test), run
 * with the app's Gradle build, and the Swift report has XCTests beside it
 * (ios/Tests, run with `swift test` on a Mac or in Swift's Linux image): see
 * the module's README.
 */

const APP_ROOT: string = path.resolve(__dirname, "../..");
const MODULE_ROOT: string = path.join(APP_ROOT, "modules/window-posture");
const KOTLIN_ROOT: string = path.join(
  MODULE_ROOT,
  "android/src/main/java/com/oneuptime/windowposture",
);
const SWIFT_ROOT: string = path.join(MODULE_ROOT, "ios/Sources");

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

interface AutolinkedModule {
  packageName: string;
  projects?: Array<{
    name: string;
    sourceDir: string;
    modules: Array<{ classifier: string }>;
  }>;
  modules?: Array<string | { name?: string }>;
}

function autolinkedModules(platform: string): Array<AutolinkedModule> {
  const output: string = execFileSync(
    process.execPath,
    [
      require.resolve(
        "expo-modules-autolinking/bin/expo-modules-autolinking.js",
        {
          paths: [APP_ROOT],
        },
      ),
      "resolve",
      "--platform",
      platform,
      "--json",
    ],
    { cwd: APP_ROOT, encoding: "utf8" },
  );
  return (JSON.parse(output) as { modules: Array<AutolinkedModule> }).modules;
}

describe("The module is linked into Android builds, and only those", () => {
  test("Android builds compile it, from the app's own modules folder", () => {
    const posture: AutolinkedModule | undefined = autolinkedModules(
      "android",
    ).find((module: AutolinkedModule): boolean => {
      return module.packageName === "window-posture";
    });

    expect(posture?.projects).toHaveLength(1);
    expect(posture?.projects?.[0]?.sourceDir).toBe(
      path.join(MODULE_ROOT, "android"),
    );
    expect(posture?.projects?.[0]?.modules).toEqual([
      {
        classifier: "com.oneuptime.windowposture.WindowPostureModule",
        name: null,
      },
    ]);
  });

  test("iOS builds do not: there, nothing reports the posture and the layout stays today's", () => {
    const names: Array<string> = autolinkedModules("apple").map(
      (module: AutolinkedModule): string => {
        return module.packageName;
      },
    );

    expect(names.length).toBeGreaterThan(0);
    expect(names).not.toContain("window-posture");
  });

  test("the module's config names Android alone, and the class the Kotlin declares", () => {
    const config: {
      platforms: Array<string>;
      android: { modules: Array<string> };
    } = JSON.parse(read(path.join(MODULE_ROOT, "expo-module.config.json")));
    const kotlin: string = read(
      path.join(KOTLIN_ROOT, "WindowPostureModule.kt"),
    );

    expect(config.platforms).toEqual(["android"]);
    expect(config.android.modules).toEqual([
      "com.oneuptime.windowposture.WindowPostureModule",
    ]);
    expect(kotlin).toContain("package com.oneuptime.windowposture\n");
    expect(kotlin).toContain("class WindowPostureModule : Module()");
  });
});

describe("The Kotlin and the JavaScript speak the same names", () => {
  const moduleSource: string = read(
    path.join(KOTLIN_ROOT, "WindowPostureModule.kt"),
  );
  const reportSource: string = read(path.join(KOTLIN_ROOT, "FoldReport.kt"));

  test("the module registers under the name JavaScript asks Expo for", () => {
    expect(moduleSource).toContain(`Name("${WINDOW_POSTURE_MODULE_NAME}")`);
  });

  test("it sends the event JavaScript listens to, and answers getFolds", () => {
    expect(moduleSource).toContain(
      `private const val FOLDS_CHANGE_EVENT = "${FOLDS_CHANGE_EVENT}"`,
    );
    expect(moduleSource).toContain("Events(FOLDS_CHANGE_EVENT)");
    expect(moduleSource).toContain('Function("getFolds")');
  });

  test("the report it builds has every key parseFoldReport reads, in the units it reads them", () => {
    for (const key of [
      "windowWidth",
      "windowHeight",
      "folds",
      "x",
      "y",
      "width",
      "height",
      "orientation",
      "separating",
    ]) {
      expect(reportSource).toContain(`"${key}" to `);
    }
    expect(reportSource).toContain(
      'if (fold.vertical) "vertical" else "horizontal"',
    );
    // Pixels become points by the window's density, as React Native's do.
    expect(reportSource).toContain("/ scale");
  });

  test("a report of exactly that shape is read as a fold", () => {
    // What describeFolds returns for a Galaxy Z Fold half open as a book.
    const report: FoldReport | null = parseFoldReport({
      windowWidth: 2320 / 2.625,
      windowHeight: 2898 / 2.625,
      folds: [
        {
          x: 1160 / 2.625,
          y: 0,
          width: 0,
          height: 2898 / 2.625,
          orientation: "vertical",
          separating: true,
        },
      ],
    });

    expect(report?.folds).toHaveLength(1);
    expect(report?.folds[0]?.orientation).toBe("vertical");
  });
});

describe("The module's Android build", () => {
  const gradle: string = read(path.join(MODULE_ROOT, "android/build.gradle"));

  test("uses the androidx.window version React Native already ships", () => {
    const versions: string = read(
      path.join(
        APP_ROOT,
        "node_modules/react-native/gradle/libs.versions.toml",
      ),
    );
    const reactNativeWindow: string | undefined = versions
      .split("\n")
      .map((line: string): string => {
        return line.trim();
      })
      .find((line: string): boolean => {
        return line.startsWith("androidx-window = ");
      })
      ?.split("=")[1]
      ?.trim()
      .replaceAll('"', "");

    expect(reactNativeWindow).toBeTruthy();
    expect(gradle).toContain(
      `implementation 'androidx.window:window:${reactNativeWindow}'`,
    );
  });

  test("is an Expo module library in the Kotlin package it declares", () => {
    expect(gradle).toContain("id 'com.android.library'");
    expect(gradle).toContain("id 'expo-module-gradle-plugin'");
    expect(gradle).toContain("namespace 'com.oneuptime.windowposture'");
  });

  test("its JVM unit tests sit beside it", () => {
    expect(
      fs.existsSync(
        path.join(
          MODULE_ROOT,
          "android/src/test/java/com/oneuptime/windowposture/FoldReportTest.kt",
        ),
      ),
    ).toBe(true);
    expect(gradle).toContain("testImplementation 'junit:junit:");
  });
});
describe("The iOS side, written and waiting for Xcode 27.1", () => {
  /*
   * The iPhone Duo's fold reaches an app through UIKit's division regions and
   * its hinge interaction, both new in the iOS 27.1 SDK. The Swift side reads
   * them and builds the same report the Kotlin does. It is not linked yet:
   * no Mac builds here, and an iOS side that failed to compile would break
   * the store build. These hold what can be held without one.
   */
  const moduleSource: string = read(
    path.join(SWIFT_ROOT, "WindowPostureModule.swift"),
  );
  const observerSource: string = read(
    path.join(SWIFT_ROOT, "FoldObserver.swift"),
  );
  const reportSource: string = read(path.join(SWIFT_ROOT, "FoldReport.swift"));
  const podspec: string = read(
    path.join(MODULE_ROOT, "ios/WindowPosture.podspec"),
  );

  test("it registers under the name JavaScript asks Expo for, sends the same event and answers getFolds", () => {
    expect(moduleSource).toContain(`Name("${WINDOW_POSTURE_MODULE_NAME}")`);
    expect(moduleSource).toContain(
      `private let foldsChangeEvent = "${FOLDS_CHANGE_EVENT}"`,
    );
    expect(moduleSource).toContain("Events(foldsChangeEvent)");
    expect(moduleSource).toContain('Function("getFolds")');
    expect(moduleSource).toContain(
      "public class WindowPostureModule: Module {",
    );
  });

  test("its report has every key parseFoldReport reads, the same as the Kotlin's", () => {
    for (const key of [
      "windowWidth",
      "windowHeight",
      "folds",
      "x",
      "y",
      "width",
      "height",
      "orientation",
      "separating",
    ]) {
      expect(reportSource).toContain(`"${key}": `);
    }
    expect(reportSource).toContain('vertical ? "vertical" : "horizontal"');
    // UIKit already measures in points: nothing to divide by.
    expect(reportSource).not.toContain("scale");
  });

  test("it reads the iOS 27.1 SDK's division regions and hinge only behind the SDK's own guard", () => {
    const guard: string = "#if canImport(UIKit, _version: 9127.0.85)";
    const blocks: Array<string> = observerSource.split(guard);
    const guarded: Array<string> = blocks
      .slice(1)
      .map((block: string): string => {
        return block.slice(0, block.indexOf("#endif"));
      });
    const unguarded: string = blocks
      .map((block: string, index: number): string => {
        return index === 0 ? block : block.slice(block.indexOf("#endif"));
      })
      .join("");

    // The new SDK's names appear only between the guard and its #endif.
    expect(guarded.length).toBeGreaterThanOrEqual(2);
    for (const name of [
      "reservedRegions",
      "UIHingeInteraction",
      "UIHinge",
      "FoldProbeView",
      "#available(iOS 27.1",
    ]) {
      expect(guarded.join("")).toContain(name);
      expect(unguarded).not.toContain(name);
    }
    // Built with the new SDK but run on an older iOS, none of it runs either.
    for (const block of guarded) {
      expect(block).toMatch(/[#@]available\(iOS 27\.1, \*\)/);
    }
    expect(observerSource).toContain(
      "reservedRegions(\n      kind: .division,\n      options: .includeInactive\n    )",
    );
    // Where UIKit says regions are tracked and read again when they change.
    expect(observerSource).toContain("override func updateConstraints()");
    // Nothing on screen, nothing to touch, nothing read aloud.
    expect(observerSource).toContain("isUserInteractionEnabled = false");
    expect(observerSource).toContain("accessibilityElementsHidden = true");
  });

  test("the pod compiles only Sources/, never the report's own Swift package or its tests", () => {
    expect(podspec).toContain("s.source_files = 'Sources/**/*.swift'");
    expect(podspec).toContain("s.dependency 'ExpoModulesCore'");
    expect(fs.existsSync(path.join(MODULE_ROOT, "ios/Package.swift"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(MODULE_ROOT, "ios/Tests/FoldReportTests.swift")),
    ).toBe(true);
  });

  test("linking it is one entry in the module's config - not made yet", () => {
    const config: { platforms: Array<string> } = JSON.parse(
      read(path.join(MODULE_ROOT, "expo-module.config.json")),
    );

    expect(config.platforms).not.toContain("apple");
    expect(config.platforms).not.toContain("ios");
  });
});
