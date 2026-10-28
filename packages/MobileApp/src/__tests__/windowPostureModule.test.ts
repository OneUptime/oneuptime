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
 *   layout until an iOS side is built and checked on Xcode 27.1;
 * - the names and the report's shape the Kotlin side uses are the ones the
 *   JavaScript side reads, so a rename on one side cannot silently turn the
 *   posture off;
 * - the module builds against the same androidx.window React Native itself
 *   ships, so it adds no second version to the app.
 *
 * The Kotlin's own logic has JVM unit tests beside it (android/src/test), run
 * with the app's Gradle build: see the module's README.
 */

const APP_ROOT: string = path.resolve(__dirname, "../..");
const MODULE_ROOT: string = path.join(APP_ROOT, "modules/window-posture");
const KOTLIN_ROOT: string = path.join(
  MODULE_ROOT,
  "android/src/main/java/com/oneuptime/windowposture",
);

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
