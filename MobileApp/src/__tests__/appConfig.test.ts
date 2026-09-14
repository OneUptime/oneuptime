import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * Critical alerts on iOS require Apple's critical-alerts entitlement, granted
 * per Apple team by application. A provisioning profile cannot carry an
 * entitlement the team has not been granted, and a build that declares one it
 * cannot carry FAILS TO SIGN.
 *
 * So the entitlement is opt-in via an environment variable rather than
 * committed into app.json. That is not a stylistic choice: committing it would
 * break the iOS build for this repo's release pipeline, every fork, and every
 * self-hoster on the day it merged, months before Apple answered anybody's
 * request.
 *
 * These tests pin both halves - that it is OFF by default, and that it is
 * actually applied when switched on - because either half silently wrong
 * produces a confusing failure a long way from here.
 */

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
const appConfig: {
  IOS_CRITICAL_ALERTS_ENTITLEMENT: string;
  isCriticalAlertsEntitlementEnabled: (env: unknown) => boolean;
  withCriticalAlertsEntitlement: (
    config: Record<string, unknown>,
    env: unknown,
  ) => Record<string, unknown>;
} = require("../../app.config.js");

const ENTITLEMENT: string = appConfig.IOS_CRITICAL_ALERTS_ENTITLEMENT;

interface SplashDefinition {
  backgroundColor: string;
  image: string;
  imageWidth?: number;
  ios?: SplashDefinition;
  android?: SplashDefinition;
}

const staticApp: {
  userInterfaceStyle: string;
  ios: { bundleIdentifier: string; icon: string };
  android: {
    package: string;
    adaptiveIcon: { foregroundImage: string; backgroundColor: string };
  };
  icon: string;
  scheme: string;
  plugins: Array<string | [string, Record<string, unknown>]>;
  extra: { eas: { projectId: string } };
} = require("../../app.json").expo;

function splashPluginOptions(): SplashDefinition {
  const plugin: string | [string, Record<string, unknown>] | undefined =
    staticApp.plugins.find(
      (item: string | [string, Record<string, unknown>]): boolean => {
        return Array.isArray(item) && item[0] === "expo-splash-screen";
      },
    );
  if (!Array.isArray(plugin)) {
    throw new Error("expo-splash-screen plugin is not configured");
  }
  return plugin[1] as unknown as SplashDefinition;
}

function baseConfig(): Record<string, unknown> {
  return {
    name: "OneUptime On-Call",
    ios: {
      bundleIdentifier: "com.oneuptime.oncall",
      infoPlist: { UIBackgroundModes: ["remote-notification"] },
    },
  };
}

function iosEntitlements(
  config: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return (config["ios"] as { entitlements?: Record<string, unknown> })
    ?.entitlements;
}

describe("The iOS critical alerts entitlement is off by default", () => {
  test("an empty environment does not enable it", () => {
    expect(appConfig.isCriticalAlertsEntitlementEnabled({})).toBe(false);
  });

  test("an undefined environment does not enable it", () => {
    expect(appConfig.isCriticalAlertsEntitlementEnabled(undefined)).toBe(false);
  });

  test.each([
    ["false", "false"],
    ["an empty string", ""],
    ['"1"', "1"],
    ['"yes"', "yes"],
    ['"TRUE"', "TRUE"],
  ])("%s does not enable it", (_label: string, value: string) => {
    expect(
      appConfig.isCriticalAlertsEntitlementEnabled({
        EXPO_IOS_CRITICAL_ALERTS_ENTITLEMENT: value,
      }),
    ).toBe(false);
  });

  test("the config is returned untouched when it is off", () => {
    const config: Record<string, unknown> = baseConfig();
    const result: Record<string, unknown> =
      appConfig.withCriticalAlertsEntitlement(config, {});

    expect(result).toBe(config);
    expect(iosEntitlements(result)).toBeUndefined();
  });
});

describe("The entitlement is applied when explicitly switched on", () => {
  const env: Record<string, string> = {
    EXPO_IOS_CRITICAL_ALERTS_ENTITLEMENT: "true",
  };

  test('the exact string "true" enables it', () => {
    expect(appConfig.isCriticalAlertsEntitlementEnabled(env)).toBe(true);
  });

  test("the entitlement Apple actually looks for is the one declared", () => {
    expect(ENTITLEMENT).toBe(
      "com.apple.developer.usernotifications.critical-alerts",
    );
  });

  test("it lands under ios.entitlements where prebuild reads it", () => {
    const result: Record<string, unknown> =
      appConfig.withCriticalAlertsEntitlement(baseConfig(), env);

    expect(iosEntitlements(result)?.[ENTITLEMENT]).toBe(true);
  });

  test("the rest of the iOS config survives", () => {
    /*
     * A spread that replaced `ios` wholesale would drop the bundle identifier
     * and the background modes push notifications depend on - a much bigger
     * outage than the feature being added.
     */
    const result: Record<string, unknown> =
      appConfig.withCriticalAlertsEntitlement(baseConfig(), env);

    const ios: { bundleIdentifier?: string; infoPlist?: unknown } = result[
      "ios"
    ] as { bundleIdentifier?: string; infoPlist?: unknown };

    expect(ios.bundleIdentifier).toBe("com.oneuptime.oncall");
    expect(ios.infoPlist).toEqual({
      UIBackgroundModes: ["remote-notification"],
    });
  });

  test("the rest of the app config survives", () => {
    const result: Record<string, unknown> =
      appConfig.withCriticalAlertsEntitlement(baseConfig(), env);

    expect(result["name"]).toBe("OneUptime On-Call");
  });

  test("entitlements a fork already declared are preserved", () => {
    const config: Record<string, unknown> = {
      ios: {
        entitlements: { "com.apple.developer.something-else": true },
      },
    };

    const result: Record<string, unknown> =
      appConfig.withCriticalAlertsEntitlement(config, env);

    expect(iosEntitlements(result)).toEqual({
      "com.apple.developer.something-else": true,
      [ENTITLEMENT]: true,
    });
  });

  test("a config with no ios section at all still works", () => {
    const result: Record<string, unknown> =
      appConfig.withCriticalAlertsEntitlement({ name: "x" }, env);

    expect(iosEntitlements(result)?.[ENTITLEMENT]).toBe(true);
  });

  test("the original config object is not mutated", () => {
    /*
     * Expo hands the same object to more than one plugin. Mutating it makes
     * the resulting config depend on plugin ordering.
     */
    const config: Record<string, unknown> = baseConfig();

    appConfig.withCriticalAlertsEntitlement(config, env);

    expect(iosEntitlements(config)).toBeUndefined();
  });
});

describe("The native launch screen matches the light app", () => {
  test("every iOS and Android splash declaration uses the same light canvas and wordmark", () => {
    const options: SplashDefinition = splashPluginOptions();
    expect(staticApp.userInterfaceStyle).toBe("light");
    for (const splash of [options, options.ios, options.android]) {
      expect(splash).toMatchObject({
        backgroundColor: "#F6F7F9",
        image: "./assets/splash-light.png",
      });
    }
    expect(options.imageWidth).toBe(200);
    expect(options.ios?.imageWidth).toBe(200);
    expect(options.android?.imageWidth).toBe(200);
  });

  test("uses the Expo 57 plugin schema instead of removed legacy fields", () => {
    expect("newArchEnabled" in staticApp).toBe(false);
    expect("splash" in staticApp).toBe(false);
    expect("splash" in staticApp.ios).toBe(false);
    expect("edgeToEdgeEnabled" in staticApp.android).toBe(false);
  });

  test("the checked-in launch artwork is a transparent-capable PNG at the wordmark's aspect ratio", () => {
    const options: SplashDefinition = splashPluginOptions();
    const artwork: Buffer = readFileSync(
      path.resolve(__dirname, "../..", options.image),
    );
    expect(artwork.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(artwork.readUInt32BE(16)).toBe(1000);
    expect(artwork.readUInt32BE(20)).toBe(200);
    expect(artwork[25]).toBe(6); // PNG color type 6 is RGBA, not an opaque launch tile.
  });

  test("the redesign preserves installed app identity, launcher icons, and notifications", () => {
    expect(staticApp.scheme).toBe("oneuptime");
    expect(staticApp.ios.bundleIdentifier).toBe("com.oneuptime.oncall");
    expect(staticApp.android.package).toBe("com.oneuptime.oncall");
    expect(staticApp.extra.eas.projectId).toBe(
      "d9f87edc-1c3e-466f-b032-1ced7621aa8a",
    );
    expect(staticApp.icon).toBe("./assets/icon.png");
    expect(staticApp.ios.icon).toBe("./assets/icon.png");
    expect(staticApp.android.adaptiveIcon).toEqual({
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#000000",
    });
    expect(staticApp.plugins).toContainEqual([
      "expo-notifications",
      { color: "#58A6FF" },
    ]);
  });
});
