import { describe, expect, test } from "@jest/globals";
import path from "node:path";

/*
 * The native settings that decide whether the app survives a fold at all.
 *
 * None of these are visible in JavaScript, and every one of them fails
 * quietly: an Android activity without `density` in its configChanges is
 * restarted when a Galaxy Z Fold unfolds (everything on screen is lost and
 * the app opens on Home), an iPad build that requires full screen cannot be
 * put in Split View, and an iOS build made with an SDK older than 27.1 is
 * shown letterboxed in the middle of the iPhone Duo's inner screen.
 *
 * So each is pinned twice: in the config files the release reads, and in
 * the native projects Expo actually generates from them (its own config
 * introspection, which runs the same plugins as `expo prebuild`).
 */

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
const APP_ROOT: string = path.resolve(__dirname, "../..");

interface ManifestActivity {
  $: Record<string, string>;
}

interface AndroidManifest {
  manifest: {
    application?: Array<{
      $: Record<string, string>;
      activity?: Array<ManifestActivity>;
    }>;
  };
}

const foldable: {
  FOLDABLE_CONFIG_CHANGES: Array<string>;
  applyFoldableContinuity: (manifest: AndroidManifest) => AndroidManifest;
  parseConfigChanges: (value: unknown) => Array<string>;
} = require("../../plugins/withFoldableContinuity.js");

const appJson: {
  expo: {
    orientation: string;
    ios: { supportsTablet: boolean; requireFullScreen?: boolean };
    plugins: Array<string | [string, Record<string, unknown>]>;
  };
} = require("../../app.json");

const easJson: {
  build: Record<string, { ios?: { image?: string } }>;
} = require("../../eas.json");

const packageJson: { dependencies: Record<string, string> } =
  require("../../package.json");

// Expo's SDK 57 template, as `expo prebuild` writes it before any plugin runs.
const TEMPLATE_CONFIG_CHANGES: string =
  "keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize|assetsPaths";

function manifestWith(attributes: Record<string, string>): AndroidManifest {
  return {
    manifest: {
      application: [
        {
          $: { "android:name": ".MainApplication" },
          activity: [
            {
              $: {
                "android:name": ".MainActivity",
                "android:launchMode": "singleTask",
                ...attributes,
              },
            },
          ],
        },
      ],
    },
  };
}

function mainActivity(manifest: AndroidManifest): Record<string, string> {
  const activity: ManifestActivity | undefined =
    manifest.manifest.application?.[0]?.activity?.find(
      (candidate: ManifestActivity): boolean => {
        return candidate.$["android:name"] === ".MainActivity";
      },
    );
  if (!activity) {
    throw new Error("no MainActivity in the manifest");
  }
  return activity.$;
}

describe("The Android activity handles a fold in place", () => {
  test("density joins the changes Expo's template already handles, in order, after them", () => {
    const result: Record<string, string> = mainActivity(
      foldable.applyFoldableContinuity(
        manifestWith({ "android:configChanges": TEMPLATE_CONFIG_CHANGES }),
      ),
    );

    expect(result["android:configChanges"]).toBe(
      `${TEMPLATE_CONFIG_CHANGES}|density`,
    );
  });

  test("every change a fold, a rotation or a split-screen resize makes is declared", () => {
    const changes: Array<string> = foldable.parseConfigChanges(
      mainActivity(foldable.applyFoldableContinuity(manifestWith({})))[
        "android:configChanges"
      ],
    );

    for (const change of [
      "orientation",
      "screenSize",
      "smallestScreenSize",
      "screenLayout",
      "density",
      "keyboard",
      "keyboardHidden",
      "uiMode",
    ]) {
      expect(changes).toContain(change);
    }
    expect(foldable.FOLDABLE_CONFIG_CHANGES).toContain("density");
  });

  test("nothing is listed twice, and running the plugin again changes nothing", () => {
    const once: AndroidManifest = foldable.applyFoldableContinuity(
      manifestWith({
        "android:configChanges": "orientation|density|screenSize",
      }),
    );
    const firstPass: string = mainActivity(once)["android:configChanges"]!;
    const twice: AndroidManifest = foldable.applyFoldableContinuity(once);
    const changes: Array<string> = foldable.parseConfigChanges(
      mainActivity(twice)["android:configChanges"],
    );

    expect(mainActivity(twice)["android:configChanges"]).toBe(firstPass);
    expect(new Set(changes).size).toBe(changes.length);
    expect(changes.slice(0, 3)).toEqual(["orientation", "density", "screenSize"]);
  });

  test("the activity says outright that it can be resized, and keeps everything else", () => {
    const result: Record<string, string> = mainActivity(
      foldable.applyFoldableContinuity(
        manifestWith({
          "android:configChanges": "orientation",
          "android:windowSoftInputMode": "adjustResize",
        }),
      ),
    );

    expect(result["android:resizeableActivity"]).toBe("true");
    expect(result["android:launchMode"]).toBe("singleTask");
    expect(result["android:windowSoftInputMode"]).toBe("adjustResize");
  });

  test("a manifest with no main activity is an error, not a silent no-op", () => {
    expect(() => {
      foldable.applyFoldableContinuity({
        manifest: { application: [{ $: {}, activity: [] }] },
      });
    }).toThrow();
  });

  test.each([
    ["", []],
    [undefined, []],
    ["orientation| screenSize |", ["orientation", "screenSize"]],
  ] as Array<[unknown, Array<string>]>)(
    "reads %j as %j",
    (value: unknown, expected: Array<string>) => {
      expect(foldable.parseConfigChanges(value)).toEqual(expected);
    },
  );
});

describe("The configuration the release builds from", () => {
  test("the app follows the window in every orientation", () => {
    expect(appJson.expo.orientation).toBe("default");
  });

  test("iPad (and every resizable iPhone window) may be shared in Split View and Slide Over", () => {
    expect(appJson.expo.ios.supportsTablet).toBe(true);
    expect(appJson.expo.ios.requireFullScreen).toBe(false);
  });

  test("the Android continuity plugin is applied", () => {
    expect(appJson.expo.plugins).toContain("./plugins/withFoldableContinuity");
  });

  test("iOS adopts the scene life cycle the iOS 27 SDK requires", () => {
    /*
     * Without it, an app built with Xcode 27 does not launch on iOS 27, and
     * without Xcode 27.1 the iPhone Duo shows the app letterboxed.
     */
    expect(appJson.expo.plugins).toContainEqual([
      "expo-build-properties",
      { ios: { enableSceneSupport: true } },
    ]);
    expect(packageJson.dependencies["expo-build-properties"]).toMatch(
      /^~57\./,
    );
  });

  test("store builds compile with Xcode 27.1, the first SDK that fills the iPhone Duo's inner screen", () => {
    expect(easJson.build["production"]?.ios?.image).toBe(
      "macos-tahoe-26.6-xcode-27.1",
    );
  });
});

describe("What Expo generates from it", () => {
  interface IntrospectedConfig {
    _internal: {
      modResults: {
        android: { manifest: AndroidManifest };
        ios: { infoPlist: Record<string, unknown> };
      };
    };
  }

  async function introspect(): Promise<IntrospectedConfig> {
    const { getPrebuildConfigAsync } = require("@expo/prebuild-config") as {
      getPrebuildConfigAsync: (
        projectRoot: string,
        options: { platforms: Array<string> },
      ) => Promise<{ exp: Record<string, unknown> }>;
    };
    const { compileModsAsync } = require("@expo/config-plugins") as {
      compileModsAsync: (
        config: Record<string, unknown>,
        options: {
          projectRoot: string;
          introspect: boolean;
          platforms: Array<string>;
          assertMissingModProviders: boolean;
        },
      ) => Promise<IntrospectedConfig>;
    };
    const { exp } = await getPrebuildConfigAsync(APP_ROOT, {
      platforms: ["android", "ios"],
    });
    return compileModsAsync(exp, {
      projectRoot: APP_ROOT,
      introspect: true,
      platforms: ["android", "ios"],
      assertMissingModProviders: false,
    });
  }

  test("the Android main activity handles density, rotation and resizing in place, in any orientation", async () => {
    const config: IntrospectedConfig = await introspect();
    const activity: Record<string, string> = mainActivity(
      config._internal.modResults.android.manifest,
    );
    const changes: Array<string> = foldable.parseConfigChanges(
      activity["android:configChanges"],
    );

    for (const change of foldable.FOLDABLE_CONFIG_CHANGES) {
      expect(changes).toContain(change);
    }
    expect(activity["android:resizeableActivity"]).toBe("true");
    expect(activity["android:screenOrientation"]).toBe("unspecified");
  });

  test("the iOS app is resizable, takes every orientation and starts from a scene", async () => {
    const config: IntrospectedConfig = await introspect();
    const plist: Record<string, unknown> =
      config._internal.modResults.ios.infoPlist;
    const allOrientations: Array<string> = [
      "UIInterfaceOrientationPortrait",
      "UIInterfaceOrientationPortraitUpsideDown",
      "UIInterfaceOrientationLandscapeLeft",
      "UIInterfaceOrientationLandscapeRight",
    ];

    expect(plist["UIRequiresFullScreen"]).toBe(false);
    expect(plist["UISupportedInterfaceOrientations~ipad"]).toEqual(
      expect.arrayContaining(allOrientations),
    );
    expect(plist["UISupportedInterfaceOrientations"]).toEqual(
      expect.arrayContaining([
        "UIInterfaceOrientationPortrait",
        "UIInterfaceOrientationLandscapeLeft",
        "UIInterfaceOrientationLandscapeRight",
      ]),
    );
    expect(plist["UIApplicationSceneManifest"]).toEqual({
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "EXExpoAppSceneDelegate",
          },
        ],
      },
    });
  });
});
