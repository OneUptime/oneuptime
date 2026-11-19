import TwoFactorAuthSetupUtil, {
  TWO_FACTOR_AUTH_LAST_METHOD_MESSAGE,
  TWO_FACTOR_AUTH_NEEDS_A_METHOD_MESSAGE,
  TWO_FACTOR_AUTH_OWN_ACCOUNT_ON_MESSAGE,
  TWO_FACTOR_AUTH_STATUS_API_ROUTE,
} from "../../Types/TwoFactorAuthSetup";
import TwoFactorAuthStatus from "../../Types/TwoFactorAuthStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * Two-factor authentication's requirement and what is set up behind it,
 * as the profile reads them (issue #9666). "Enabled" over nothing was the
 * bug: required with nothing set up is its own state, never "configured",
 * and an answer that says otherwise is no answer.
 */

describe("TwoFactorAuthSetupUtil.getStatus", () => {
  test.each([
    [false, 0, TwoFactorAuthStatus.NotEnabled],
    [false, 1, TwoFactorAuthStatus.NotEnabled],
    [false, 7, TwoFactorAuthStatus.NotEnabled],
    [true, 0, TwoFactorAuthStatus.EnabledPendingSetup],
    [true, 1, TwoFactorAuthStatus.EnabledConfigured],
    [true, 3, TwoFactorAuthStatus.EnabledConfigured],
  ])(
    "on: %s, second steps set up: %s -> %s",
    (
      isTwoFactorAuthEnabled: boolean,
      verifiedMethodCount: number,
      expected: TwoFactorAuthStatus,
    ) => {
      expect(
        TwoFactorAuthSetupUtil.getStatus({
          isTwoFactorAuthEnabled,
          verifiedMethodCount,
        }),
      ).toBe(expected);
    },
  );
});

describe("TwoFactorAuthSetupUtil.parse", () => {
  test.each([
    [{ status: "NotEnabled", verifiedMethodCount: 0 }],
    [{ status: "NotEnabled", verifiedMethodCount: 2 }],
    [{ status: "EnabledPendingSetup", verifiedMethodCount: 0 }],
    [{ status: "EnabledConfigured", verifiedMethodCount: 1 }],
    [{ status: "EnabledConfigured", verifiedMethodCount: 4 }],
  ])("reads %j", (value: Record<string, unknown>) => {
    expect(TwoFactorAuthSetupUtil.parse(value)).toEqual(value);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a string", "EnabledConfigured"],
    ["an array", []],
    ["an unknown status", { status: "Enabled", verifiedMethodCount: 1 }],
    [
      "a status of another case",
      { status: "notenabled", verifiedMethodCount: 0 },
    ],
    ["no count", { status: "NotEnabled" }],
    [
      "a count that is a string",
      { status: "NotEnabled", verifiedMethodCount: "1" },
    ],
    ["a negative count", { status: "NotEnabled", verifiedMethodCount: -1 }],
    [
      "a fractional count",
      { status: "EnabledConfigured", verifiedMethodCount: 1.5 },
    ],
    [
      "configured over nothing, the bug itself",
      { status: "EnabledConfigured", verifiedMethodCount: 0 },
    ],
    [
      "pending setup with something set up",
      { status: "EnabledPendingSetup", verifiedMethodCount: 1 },
    ],
  ])("%s is no answer", (_label: string, value: unknown) => {
    expect(TwoFactorAuthSetupUtil.parse(value)).toBeNull();
  });
});

describe("the words and the route", () => {
  test.each([
    TWO_FACTOR_AUTH_NEEDS_A_METHOD_MESSAGE,
    TWO_FACTOR_AUTH_LAST_METHOD_MESSAGE,
    TWO_FACTOR_AUTH_OWN_ACCOUNT_ON_MESSAGE,
  ])("%s is a sentence", (message: string) => {
    expect(message).toMatch(/^[A-Z].*\.$/);
  });

  test("turning it on with nothing set up says what to set up first", () => {
    expect(TWO_FACTOR_AUTH_NEEDS_A_METHOD_MESSAGE).toMatch(
      /authenticator app, a security key or a passkey first/,
    );
  });

  test("removing the last one says both ways forward", () => {
    expect(TWO_FACTOR_AUTH_LAST_METHOD_MESSAGE).toMatch(/Add another one/);
    expect(TWO_FACTOR_AUTH_LAST_METHOD_MESSAGE).toMatch(
      /turn off two factor authentication/,
    );
  });

  test("the profile asks the route the API serves", () => {
    expect(TWO_FACTOR_AUTH_STATUS_API_ROUTE).toBe(
      "/user/two-factor-auth-status",
    );
  });
});
