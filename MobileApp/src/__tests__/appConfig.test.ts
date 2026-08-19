import { describe, expect, test } from "@jest/globals";

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

/* eslint-disable @typescript-eslint/no-var-requires */
const appConfig: {
  IOS_CRITICAL_ALERTS_ENTITLEMENT: string;
  isCriticalAlertsEntitlementEnabled: (env: unknown) => boolean;
  withCriticalAlertsEntitlement: (
    config: Record<string, unknown>,
    env: unknown,
  ) => Record<string, unknown>;
} = require("../../app.config.js");

const ENTITLEMENT: string = appConfig.IOS_CRITICAL_ALERTS_ENTITLEMENT;

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
