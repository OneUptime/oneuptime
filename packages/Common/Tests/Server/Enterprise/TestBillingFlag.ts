/*
 * A live, per-test billing switch for suites that touch edition gating.
 *
 * CI's config.env sets BILLING_ENABLED=true, so a suite that does not pin
 * billing silently tests the SaaS path in CI and the self-hosted path locally.
 * Every suite that exercises EnterpriseEdition (directly or through a gate)
 * must pin BOTH billing and the registered module.
 *
 * This file deliberately imports nothing: it is loaded from inside a hoisted
 * jest.mock factory, before any of the test file's own imports exist.
 *
 *   jest.mock("<path>/Server/EnvironmentConfig", () => {
 *     const flag: typeof import("<path>/Tests/Server/Enterprise/TestBillingFlag") =
 *       jest.requireActual("<path>/Tests/Server/Enterprise/TestBillingFlag") as
 *         typeof import("<path>/Tests/Server/Enterprise/TestBillingFlag");
 *     return flag.withLiveBillingFlag(
 *       jest.requireActual("<path>/Server/EnvironmentConfig") as
 *         Record<string, unknown>,
 *     );
 *   });
 *
 *   setTestBillingEnabled(false); // in beforeEach, or per test
 *
 * The flag lives on globalThis and the getter reads nothing else, so a module
 * that reads IsBillingEnabled while the mock is being built (some services do,
 * at module scope) sees `false` instead of hitting a temporal-dead-zone error.
 */
export const TEST_BILLING_FLAG_KEY: string =
  "__oneUptimeEnterpriseTestIsBillingEnabled";

type GlobalFlags = Record<string, unknown>;

export const setTestBillingEnabled: (value: boolean) => void = (
  value: boolean,
): void => {
  (globalThis as unknown as GlobalFlags)[TEST_BILLING_FLAG_KEY] = value;
};

export const isTestBillingEnabled: () => boolean = (): boolean => {
  return (globalThis as unknown as GlobalFlags)[TEST_BILLING_FLAG_KEY] === true;
};

/*
 * A copy of the real EnvironmentConfig exports whose IsBillingEnabled is a live
 * getter over the flag above. A getter rather than a value, because object
 * spread would freeze it at import time.
 */
export const withLiveBillingFlag: (
  actualEnvironmentConfig: Record<string, unknown>,
) => Record<string, unknown> = (
  actualEnvironmentConfig: Record<string, unknown>,
): Record<string, unknown> => {
  const mocked: Record<string, unknown> = {
    ...actualEnvironmentConfig,
    __esModule: true,
  };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    enumerable: true,
    get: (): boolean => {
      return (
        (globalThis as unknown as GlobalFlags)[
          "__oneUptimeEnterpriseTestIsBillingEnabled"
        ] === true
      );
    },
  });

  return mocked;
};
