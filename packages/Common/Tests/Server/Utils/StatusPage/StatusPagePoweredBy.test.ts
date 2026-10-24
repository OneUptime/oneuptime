import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import EnterpriseFeature, {
  ALL_ENTERPRISE_FEATURES,
} from "../../../../Server/Enterprise/EnterpriseFeature";
import { isPoweredByOneUptimeHidden } from "../../../../Server/Utils/StatusPage/StatusPagePoweredBy";
import {
  createEditionStateCases,
  createLicenseSnapshot,
  EditionStateCase,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../../Enterprise/TestBillingFlag";

/*
 * Removing "Powered by OneUptime" from a status page is an Enterprise feature
 * (EnterpriseFeature.StatusPageBranding) with a RUNTIME side: the page's
 * switch hides the line only while the feature is active. On the Community
 * Edition, and once a self-hosted license has lapsed or leaves the feature
 * out, every page shows it again; OneUptime Cloud (the Scale plan sells the
 * switch) and an unknown license state keep hiding it.
 *
 * Billing and the edition are pinned in every test: CI's config.env sets
 * BILLING_ENABLED=true.
 */
jest.mock("../../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../../Enterprise/TestBillingFlag",
    ) as typeof import("../../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

beforeEach(() => {
  setTestBillingEnabled(false);
  uninstallEnterpriseModule();
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
});

describe("isPoweredByOneUptimeHidden", () => {
  test.each(
    createEditionStateCases().map((state: EditionStateCase) => {
      return [state.label, state] as [string, EditionStateCase];
    }),
  )("%s", (_label: string, state: EditionStateCase) => {
    state.apply();

    // The switch on: hidden exactly while the feature runs.
    expect(isPoweredByOneUptimeHidden(true)).toBe(state.isActive);

    // The switch off, or never set: every edition shows the line.
    expect(isPoweredByOneUptimeHidden(false)).toBe(false);
    expect(isPoweredByOneUptimeHidden(null)).toBe(false);
    expect(isPoweredByOneUptimeHidden(undefined)).toBe(false);
  });

  test("the Community Edition shows the line on a page whose switch says to hide it", () => {
    expect(isPoweredByOneUptimeHidden(true)).toBe(false);
  });

  test("a license that names only status page branding hides it", () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({
        features: [EnterpriseFeature.StatusPageBranding],
      }),
    });

    expect(isPoweredByOneUptimeHidden(true)).toBe(true);
  });

  test("a license that leaves status page branding out shows it", () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({
        features: ALL_ENTERPRISE_FEATURES.filter(
          (feature: EnterpriseFeature): boolean => {
            return feature !== EnterpriseFeature.StatusPageBranding;
          },
        ),
      }),
    });

    expect(isPoweredByOneUptimeHidden(true)).toBe(false);
  });

  test("only a real true hides it: a truthy value of another type does not", () => {
    installFakeEnterpriseModule();

    for (const value of ["true", 1, {}]) {
      expect(isPoweredByOneUptimeHidden(value as unknown as boolean)).toBe(
        false,
      );
    }
  });

  test("it is asked per call: a license that lapses and comes back is followed without a restart", () => {
    const fake: ReturnType<typeof installFakeEnterpriseModule> =
      installFakeEnterpriseModule();

    expect(isPoweredByOneUptimeHidden(true)).toBe(true);

    fake.setSnapshot(createLicenseSnapshot({ features: [] }));
    expect(isPoweredByOneUptimeHidden(true)).toBe(false);

    fake.setSnapshot(createLicenseSnapshot());
    expect(isPoweredByOneUptimeHidden(true)).toBe(true);
  });
});
