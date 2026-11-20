import { describe, expect, test } from "@jest/globals";
import path from "node:path";

/*
 * Wi-Fi is optional hardware (plugins/withOptionalHardwareFeatures.js).
 * @react-native-community/netinfo asks for ACCESS_WIFI_STATE, which Google
 * Play reads as a requirement for android.hardware.wifi: Play Console's
 * pre-review check on 1.7.0 said the declaration was keeping the app off
 * phones, tablets, desktops and Android XR devices without Wi-Fi. The app
 * pages people over any network, so the manifest declares Wi-Fi not
 * required, and keeps every other feature declaration as it was.
 */

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
interface FeatureDeclaration {
  $: Record<string, string>;
}

interface ManifestShape {
  manifest: { "uses-feature"?: Array<FeatureDeclaration> } & Record<
    string,
    unknown
  >;
}

const plugin: {
  OPTIONAL_HARDWARE_FEATURES: Array<string>;
  withOptionalFeatureDeclarations: (manifest: ManifestShape) => ManifestShape;
} = require("../../plugins/withOptionalHardwareFeatures.js");

const appJson: {
  expo: { plugins: Array<unknown> };
} = require("../../app.json");

const APP_ROOT: string = path.resolve(__dirname, "..", "..");

function wifi(manifest: ManifestShape): Array<FeatureDeclaration> {
  return (manifest.manifest["uses-feature"] || []).filter(
    (feature: FeatureDeclaration): boolean => {
      return feature.$["android:name"] === "android.hardware.wifi";
    },
  );
}

describe("Wi-Fi is optional hardware", () => {
  test("the plugin is applied", () => {
    expect(appJson.expo.plugins).toContain(
      "./plugins/withOptionalHardwareFeatures",
    );
  });

  test("Wi-Fi is the hardware it declares optional", () => {
    expect(plugin.OPTIONAL_HARDWARE_FEATURES).toEqual([
      "android.hardware.wifi",
    ]);
  });

  test("a manifest with no declarations gets Wi-Fi, not required", () => {
    const result: ManifestShape = plugin.withOptionalFeatureDeclarations({
      manifest: {},
    });
    expect(wifi(result)).toEqual([
      {
        $: {
          "android:name": "android.hardware.wifi",
          "android:required": "false",
        },
      },
    ]);
  });

  test("a required Wi-Fi declaration becomes optional, once, and others are kept", () => {
    const camera: FeatureDeclaration = {
      $: {
        "android:name": "android.hardware.camera",
        "android:required": "true",
      },
    };
    const result: ManifestShape = plugin.withOptionalFeatureDeclarations({
      manifest: {
        "uses-feature": [
          camera,
          {
            $: {
              "android:name": "android.hardware.wifi",
              "android:required": "true",
            },
          },
        ],
      },
    });
    expect(wifi(result)).toHaveLength(1);
    expect(wifi(result)[0]?.$["android:required"]).toBe("false");
    expect(result.manifest["uses-feature"]).toContain(camera);
  });

  test("applying it twice changes nothing more", () => {
    const once: ManifestShape = plugin.withOptionalFeatureDeclarations({
      manifest: {},
    });
    const twice: ManifestShape = plugin.withOptionalFeatureDeclarations(once);
    expect(wifi(twice)).toHaveLength(1);
  });

  test("Expo's generated manifest declares Wi-Fi not required", async () => {
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
        _internal: { modResults: { android: { manifest: ManifestShape } } };
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
    expect(wifi(config._internal.modResults.android.manifest)).toEqual([
      {
        $: {
          "android:name": "android.hardware.wifi",
          "android:required": "false",
        },
      },
    ]);
  }, 300000);
});
