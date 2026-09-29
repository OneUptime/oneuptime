import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "../../../Server/Enterprise/EnterpriseFeature";
import EditionEnforcement from "../../../Server/Utils/EditionEnforcement";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import FakeEnterpriseModule, {
  createEditionStateCases,
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  EditionStateCase,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../Spy";

type SpyInstance = ReturnType<typeof getJestSpyOn>;

/*
 * EditionEnforcement answers "is this identity control live here?" for the
 * core enforcement sites (UserAuthorization, status page sign-in, SCIM team
 * locks, provider listings, read masking).
 *
 * The rule: the answer follows the RUNTIME state of the feature behind it
 * (EnterpriseEdition.isFeatureActive) - SSO for the SSO requirements, routes
 * and listings, SCIM for the team locks. So the controls are live on the
 * Enterprise Edition while the license covers the feature (or billing is on),
 * and relaxed on the Community Edition AND on an Enterprise install whose
 * license has lapsed - there the SSO routes refuse and nobody could satisfy a
 * requirement. An unknown license state and any error answer "enforce".
 *
 * Billing and the edition are pinned in every test (CI's config.env sets
 * BILLING_ENABLED=true).
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

const userProps: DatabaseCommonInteractionProps = {
  userId: new ObjectID("22222222-2222-4222-8222-222222222222"),
  tenantId: new ObjectID("11111111-1111-4111-8111-111111111111"),
};

const EDITION_CASES: Array<EditionStateCase> = createEditionStateCases();

describe("EditionEnforcement", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
    uninstallEnterpriseModule();
    getJestSpyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    getJestSpyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  describe("the answers follow the runtime state of SSO and SCIM", () => {
    test("the matrix has lapsed Enterprise states, not just the two editions", () => {
      expect(
        EDITION_CASES.filter((editionCase: EditionStateCase): boolean => {
          return editionCase.isLoaded && !editionCase.isActive;
        }).length,
      ).toBeGreaterThanOrEqual(4);
    });

    test.each(
      EDITION_CASES.map(
        (editionCase: EditionStateCase): [string, EditionStateCase] => {
          return [editionCase.label, editionCase];
        },
      ),
    )("%s", (_label: string, editionCase: EditionStateCase) => {
      editionCase.apply();

      expect(EditionEnforcement.isSsoEnforced()).toBe(editionCase.isActive);
      expect(EditionEnforcement.isSsoRequired(true)).toBe(editionCase.isActive);
      expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(
        editionCase.isActive,
      );
      expect(EditionEnforcement.areSsoRoutesServed()).toBe(
        editionCase.isActive,
      );
      expect(EditionEnforcement.shouldMaskSsoRequirementOnRead(userProps)).toBe(
        !editionCase.isActive,
      );
    });
  });

  describe("SSO and SCIM are decided separately", () => {
    test("a license without SCIM relaxes the SCIM team locks only", () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshot({
          features: [EnterpriseFeature.SSO, EnterpriseFeature.AuditLogs],
        }),
      });

      expect(EditionEnforcement.isSsoEnforced()).toBe(true);
      expect(EditionEnforcement.areSsoRoutesServed()).toBe(true);
      expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(false);
    });

    test("a license without SSO relaxes the SSO requirements only", () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshot({
          features: [EnterpriseFeature.SCIM],
        }),
      });

      expect(EditionEnforcement.isSsoEnforced()).toBe(false);
      expect(EditionEnforcement.isSsoRequired(true)).toBe(false);
      expect(EditionEnforcement.areSsoRoutesServed()).toBe(false);
      expect(EditionEnforcement.shouldMaskSsoRequirementOnRead(userProps)).toBe(
        true,
      );
      expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(true);
    });
  });

  describe("a license change applies at once, without a restart", () => {
    test("lapse relaxes, renewal enforces again, lapse relaxes again", () => {
      const fake: FakeEnterpriseModule = installFakeEnterpriseModule();

      expect(EditionEnforcement.isSsoRequired(true)).toBe(true);
      expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(true);

      fake.setSnapshot(createLicenseSnapshotWithStatus("expired"));
      expect(EditionEnforcement.isSsoRequired(true)).toBe(false);
      expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(false);
      expect(EditionEnforcement.areSsoRoutesServed()).toBe(false);

      fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));
      expect(EditionEnforcement.isSsoRequired(true)).toBe(true);
      expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(true);
      expect(EditionEnforcement.areSsoRoutesServed()).toBe(true);

      fake.setSnapshot(createLicenseSnapshotWithStatus("missing"));
      expect(EditionEnforcement.isSsoRequired(true)).toBe(false);
    });
  });

  describe("isSsoRequired", () => {
    test.each([false, undefined, null])(
      "a requirement that is not configured (%p) is never required",
      (configured: boolean | undefined | null) => {
        installFakeEnterpriseModule();
        expect(EditionEnforcement.isSsoRequired(configured)).toBe(false);

        uninstallEnterpriseModule();
        expect(EditionEnforcement.isSsoRequired(configured)).toBe(false);
      },
    );

    test("a configured requirement is relaxed on the Enterprise Edition once the license lapsed", () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });

      expect(EditionEnforcement.isSsoRequired(true)).toBe(false);
    });

    test("a configured requirement is still required during the grace period", () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("grace"),
      });

      expect(EditionEnforcement.isSsoRequired(true)).toBe(true);
    });

    test("a configured requirement is relaxed on the Community Edition", () => {
      expect(EditionEnforcement.isSsoRequired(true)).toBe(false);
    });
  });

  describe("errors answer 'enforce' (fail secure)", () => {
    let loggerError: SpyInstance;

    beforeEach(() => {
      loggerError = getJestSpyOn(logger, "error").mockImplementation(
        (): void => {
          return undefined;
        },
      );
      getJestSpyOn(EnterpriseEdition, "isFeatureActive").mockImplementation(
        (): boolean => {
          throw new Error("facade exploded");
        },
      );
    });

    test("an error while deciding SSO enforcement enforces SSO and logs it", () => {
      expect(EditionEnforcement.isSsoEnforced()).toBe(true);
      expect(EditionEnforcement.isSsoRequired(true)).toBe(true);
      expect(EditionEnforcement.shouldMaskSsoRequirementOnRead(userProps)).toBe(
        false,
      );
      expect(loggerError).toHaveBeenCalled();
    });

    test("an error while deciding whether the SSO routes are served serves them", () => {
      expect(EditionEnforcement.areSsoRoutesServed()).toBe(true);
      expect(loggerError).toHaveBeenCalled();
    });

    test("an error while deciding the SCIM team locks applies them", () => {
      expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(true);
      expect(loggerError).toHaveBeenCalled();
    });
  });

  describe("shouldMaskSsoRequirementOnRead", () => {
    test("internal root reads are never masked, in any state", () => {
      expect(
        EditionEnforcement.shouldMaskSsoRequirementOnRead({ isRoot: true }),
      ).toBe(false);

      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });

      expect(
        EditionEnforcement.shouldMaskSsoRequirementOnRead({ isRoot: true }),
      ).toBe(false);

      installFakeEnterpriseModule();

      expect(
        EditionEnforcement.shouldMaskSsoRequirementOnRead({ isRoot: true }),
      ).toBe(false);
    });

    test("missing props are treated as an internal read", () => {
      expect(EditionEnforcement.shouldMaskSsoRequirementOnRead(undefined)).toBe(
        false,
      );
      expect(EditionEnforcement.shouldMaskSsoRequirementOnRead(null)).toBe(
        false,
      );
    });

    test("master admin and user reads are masked while SSO is not active only", () => {
      const masterAdmin: DatabaseCommonInteractionProps = {
        userId: userProps.userId!,
        isMasterAdmin: true,
      };

      // Community Edition.
      expect(
        EditionEnforcement.shouldMaskSsoRequirementOnRead(masterAdmin),
      ).toBe(true);
      expect(EditionEnforcement.shouldMaskSsoRequirementOnRead(userProps)).toBe(
        true,
      );

      // Enterprise Edition, lapsed license.
      const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("invalid"),
      });

      expect(
        EditionEnforcement.shouldMaskSsoRequirementOnRead(masterAdmin),
      ).toBe(true);
      expect(EditionEnforcement.shouldMaskSsoRequirementOnRead(userProps)).toBe(
        true,
      );

      // Enterprise Edition, license renewed.
      fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));

      expect(
        EditionEnforcement.shouldMaskSsoRequirementOnRead(masterAdmin),
      ).toBe(false);
      expect(EditionEnforcement.shouldMaskSsoRequirementOnRead(userProps)).toBe(
        false,
      );
    });
  });
});
