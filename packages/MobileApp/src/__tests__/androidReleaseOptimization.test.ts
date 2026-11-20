import { describe, expect, test } from "@jest/globals";
import path from "path";

/*
 * The Android release build runs R8 (#9955). Google Play scores how much of
 * an app's code is optimized and obfuscated, and from February 2027 an app
 * under 25% in any category may lose visibility and publishing
 * capabilities; 1.6.0, built without R8, scored 1% for obfuscation.
 *
 * - expo-build-properties' enableMinifyInReleaseBuilds is what turns R8 on:
 *   it writes android.enableMinifyInReleaseBuilds=true into
 *   gradle.properties, which the generated app/build.gradle reads for
 *   minifyEnabled. Keep rules come with the libraries (React Native's,
 *   expo-modules-core's for every Expo module, the app's window-posture
 *   module included) and the template's proguard-rules.pro.
 * - Resource shrinking stays OFF: the critical alarm sounds in res/raw are
 *   named by file name when a notification channel is created
 *   (src/notifications/criticalAlertSounds.ts, channels.ts), which the
 *   shrinker cannot see, so it could ship a build whose critical pages ring
 *   with the default sound.
 * - Every production build keeps its mapping.txt among the build's
 *   artifacts, for retracing stack traces locally. Play takes its own copy
 *   from the bundle, where the Android Gradle plugin embeds it, so crash
 *   reports stay readable without an upload (RELEASING.md).
 */

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
const APP_ROOT: string = path.resolve(__dirname, "..", "..");

interface BuildPropertiesOptions {
  android?: {
    enableMinifyInReleaseBuilds?: boolean;
    enableShrinkResourcesInReleaseBuilds?: boolean;
  };
}

function buildPropertiesOptions(): BuildPropertiesOptions {
  const plugins: Array<unknown> = (
    require("../../app.json") as { expo: { plugins: Array<unknown> } }
  ).expo.plugins;
  const entry: unknown = plugins.find((plugin: unknown): boolean => {
    return Array.isArray(plugin) && plugin[0] === "expo-build-properties";
  });
  if (!Array.isArray(entry)) {
    throw new Error("app.json does not configure expo-build-properties");
  }
  return entry[1] as BuildPropertiesOptions;
}

interface GradleProperty {
  type: string;
  key?: string;
  value?: string;
}

describe("The Android release build runs R8 (#9955)", () => {
  test("R8 is on for release builds", () => {
    expect(buildPropertiesOptions().android?.enableMinifyInReleaseBuilds).toBe(
      true,
    );
  });

  test("resource shrinking stays off: the alarm sounds are named by string", () => {
    expect(
      buildPropertiesOptions().android?.enableShrinkResourcesInReleaseBuilds,
    ).not.toBe(true);
  });

  test("every production build keeps its R8 mapping among its artifacts", () => {
    const production: { android?: { buildArtifactPaths?: Array<string> } } = (
      require("../../eas.json") as {
        build: Record<
          string,
          { android?: { buildArtifactPaths?: Array<string> } }
        >;
      }
    ).build["production"] as {
      android?: { buildArtifactPaths?: Array<string> };
    };
    expect(production.android?.buildArtifactPaths).toContain(
      "android/app/build/outputs/mapping/release/mapping.txt",
    );
  });

  test("Expo writes the switch the generated build.gradle reads", async () => {
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
      ) => Promise<{
        _internal: {
          modResults: { android: { gradleProperties: Array<GradleProperty> } };
        };
      }>;
    };
    const { exp } = await getPrebuildConfigAsync(APP_ROOT, {
      platforms: ["android"],
    });
    const config: Awaited<ReturnType<typeof compileModsAsync>> =
      await compileModsAsync(exp, {
        projectRoot: APP_ROOT,
        introspect: true,
        platforms: ["android"],
        assertMissingModProviders: false,
      });
    const minify: GradleProperty | undefined =
      config._internal.modResults.android.gradleProperties.find(
        (property: GradleProperty): boolean => {
          return (
            property.type === "property" &&
            property.key === "android.enableMinifyInReleaseBuilds"
          );
        },
      );
    expect(minify?.value).toBe("true");
  }, 300000);
});
