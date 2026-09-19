import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import { EnterpriseLicenseStatus } from "../../../Server/Enterprise/EnterpriseLicenseSnapshot";
import EditionEnforcement from "../../../Server/Utils/EditionEnforcement";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import FakeEnterpriseModule, {
  createLicenseSnapshotWithStatus,
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
 * The invariant (design v2 section 0): the answer depends ONLY on whether the
 * Enterprise Edition is loaded. Never on the license - a lapsed license must
 * not let a password through where SSO is required - and never on billing.
 * Errors answer "enforce".
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

const ALL_STATUSES: ReadonlyArray<EnterpriseLicenseStatus> = [
  "missing",
  "valid",
  "grace",
  "expired",
  "invalid",
];

type EditionCase = {
  label: string;
  install: () => void;
  isLoaded: boolean;
};

const EDITION_CASES: Array<EditionCase> = [
  {
    label: "Community Edition",
    install: (): void => {
      uninstallEnterpriseModule();
    },
    isLoaded: false,
  },
  ...ALL_STATUSES.map((status: EnterpriseLicenseStatus): EditionCase => {
    return {
      label: `Enterprise Edition, ${status} license`,
      install: (): void => {
        installFakeEnterpriseModule({
          snapshot: createLicenseSnapshotWithStatus(status, { features: [] }),
        });
      },
      isLoaded: true,
    };
  }),
  {
    label: "Enterprise Edition before the first license load",
    install: (): void => {
      installFakeEnterpriseModule({ snapshot: null });
    },
    isLoaded: true,
  },
];

const userProps: DatabaseCommonInteractionProps = {
  userId: new ObjectID("22222222-2222-4222-8222-222222222222"),
  tenantId: new ObjectID("11111111-1111-4111-8111-111111111111"),
};

describe("EditionEnforcement", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
    uninstallEnterpriseModule();
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  describe("the answers follow isLoaded() only - never the license, never billing", () => {
    for (const billing of [false, true]) {
      for (const editionCase of EDITION_CASES) {
        test(`billing=${billing}, ${editionCase.label}`, () => {
          setTestBillingEnabled(billing);
          editionCase.install();

          expect(EnterpriseEdition.isLoaded()).toBe(editionCase.isLoaded);
          expect(EditionEnforcement.isSsoEnforced()).toBe(editionCase.isLoaded);
          expect(EditionEnforcement.isSsoRequired(true)).toBe(
            editionCase.isLoaded,
          );
          expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(
            editionCase.isLoaded,
          );
          expect(EditionEnforcement.areSsoRoutesServed()).toBe(
            editionCase.isLoaded,
          );
          expect(
            EditionEnforcement.shouldMaskSsoRequirementOnRead(userProps),
          ).toBe(!editionCase.isLoaded);
        });
      }
    }
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

    test("a configured requirement is required on the Enterprise Edition even with an expired license", () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });

      expect(EditionEnforcement.isSsoRequired(true)).toBe(true);
    });

    test("a configured requirement is relaxed on the Community Edition", () => {
      expect(EditionEnforcement.isSsoRequired(true)).toBe(false);
    });
  });

  describe("errors answer 'enforce' (fail secure)", () => {
    test("an error while deciding SSO enforcement enforces SSO and logs it", () => {
      const loggerError: SpyInstance = getJestSpyOn(
        logger,
        "error",
      ).mockImplementation((): void => {
        return undefined;
      });
      getJestSpyOn(EnterpriseEdition, "shouldEnforceSso").mockImplementation(
        (): boolean => {
          throw new Error("facade exploded");
        },
      );

      expect(EditionEnforcement.isSsoEnforced()).toBe(true);
      expect(EditionEnforcement.isSsoRequired(true)).toBe(true);
      expect(EditionEnforcement.shouldMaskSsoRequirementOnRead(userProps)).toBe(
        false,
      );
      expect(loggerError).toHaveBeenCalled();
    });

    test("an error while deciding the SCIM team locks applies them", () => {
      getJestSpyOn(logger, "error").mockImplementation((): void => {
        return undefined;
      });
      getJestSpyOn(EnterpriseEdition, "isLoaded").mockImplementation(
        (): boolean => {
          throw new Error("facade exploded");
        },
      );

      expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(true);
    });
  });

  describe("shouldMaskSsoRequirementOnRead", () => {
    test("internal root reads are never masked, on any edition", () => {
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

    test("master admin and user reads are masked on the Community Edition only", () => {
      const masterAdmin: DatabaseCommonInteractionProps = {
        userId: userProps.userId!,
        isMasterAdmin: true,
      };

      expect(
        EditionEnforcement.shouldMaskSsoRequirementOnRead(masterAdmin),
      ).toBe(true);
      expect(EditionEnforcement.shouldMaskSsoRequirementOnRead(userProps)).toBe(
        true,
      );

      const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("invalid"),
      });

      expect(fake).toBeDefined();
      expect(
        EditionEnforcement.shouldMaskSsoRequirementOnRead(masterAdmin),
      ).toBe(false);
      expect(EditionEnforcement.shouldMaskSsoRequirementOnRead(userProps)).toBe(
        false,
      );
    });
  });
});
