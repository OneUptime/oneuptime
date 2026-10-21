import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "../../../Server/Enterprise/EnterpriseFeature";
import EditionEnforcement from "../../../Server/Utils/EditionEnforcement";
import logger from "../../../Server/Utils/Logger";
import FakeEnterpriseModule, {
  createEditionStateCases,
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  EditionStateCase,
  installFakeEnterpriseModule,
  LICENSE_STATE_CASES,
  LicenseStateCase,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../Spy";

type SpyInstance = ReturnType<typeof getJestSpyOn>;

/*
 * EditionEnforcement answers one question for core: are the SCIM Push Groups
 * team locks live here (TeamService, TeamMemberService, TeamMemberAPI)?
 *
 * The rule: the answer follows the RUNTIME state of SCIM
 * (EnterpriseEdition.isFeatureActive(SCIM)). So the locks are live on the
 * Enterprise Edition while the license covers SCIM (or billing is on), and
 * relaxed on the Community Edition AND on an Enterprise install whose license
 * no longer covers SCIM - there no SCIM endpoint answers the identity
 * provider, and nobody else could manage those teams. An unknown license
 * state and any error answer "enforce".
 *
 * Single sign-on is not decided here at all: it is part of the Community
 * Edition and its requirements are enforced in every edition.
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

  describe("the SCIM team locks follow the runtime state of SCIM", () => {
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

      expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(
        editionCase.isActive,
      );
      expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(
        EnterpriseEdition.isFeatureActive(EnterpriseFeature.SCIM),
      );
    });

    test("the Community Edition relaxes them with billing off and on", () => {
      for (const billing of [false, true]) {
        setTestBillingEnabled(billing);
        uninstallEnterpriseModule();

        expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(false);
      }
    });

    test.each(
      LICENSE_STATE_CASES.map(
        (licenseState: LicenseStateCase): [string, LicenseStateCase] => {
          return [licenseState.label, licenseState];
        },
      ),
    )(
      "billing on (OneUptime Cloud) enforces them whatever the license says: %s",
      (_label: string, licenseState: LicenseStateCase) => {
        setTestBillingEnabled(true);
        licenseState.install();

        expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(true);
      },
    );
  });

  describe("only the SCIM license feature decides", () => {
    test("a license without SCIM relaxes the locks", () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshot({
          features: [
            EnterpriseFeature.AuditLogs,
            EnterpriseFeature.TeamCompliance,
            EnterpriseFeature.InstanceHealth,
          ],
        }),
      });

      expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(false);
    });

    test("a license with only SCIM enforces them", () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshot({
          features: [EnterpriseFeature.SCIM],
        }),
      });

      expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(true);
    });

    test("an empty feature list relaxes them", () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshot({ features: [] }),
      });

      expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(false);
    });
  });

  describe("a license change applies at once, without a restart", () => {
    test("lapse relaxes, renewal enforces again, lapse relaxes again", () => {
      const fake: FakeEnterpriseModule = installFakeEnterpriseModule();

      expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(true);

      fake.setSnapshot(createLicenseSnapshotWithStatus("expired"));
      expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(false);

      fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));
      expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(true);

      fake.setSnapshot(createLicenseSnapshotWithStatus("missing"));
      expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(false);

      fake.setSnapshot(createLicenseSnapshotWithStatus("grace"));
      expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(true);
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

    test("an error while deciding the SCIM team locks applies them and logs it", () => {
      expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(true);
      expect(loggerError).toHaveBeenCalledWith(
        "EditionEnforcement: could not tell whether SCIM team locks apply; applying them.",
      );
    });
  });

  describe("asks about SCIM and nothing else", () => {
    test("isFeatureActive is asked for SCIM only", () => {
      installFakeEnterpriseModule();
      const isFeatureActive: SpyInstance = getJestSpyOn(
        EnterpriseEdition,
        "isFeatureActive",
      );

      EditionEnforcement.areScimTeamLocksEnforced();

      expect(isFeatureActive.mock.calls).toEqual([[EnterpriseFeature.SCIM]]);
    });

    /*
     * Single sign-on is part of the Community Edition: nothing may put it
     * back behind the license through this class.
     */
    test("exposes no single sign-on question", () => {
      const members: Array<string> = Object.getOwnPropertyNames(
        EditionEnforcement,
      ).filter((name: string): boolean => {
        return !["length", "name", "prototype"].includes(name);
      });

      expect(members).toEqual(["areScimTeamLocksEnforced"]);

      for (const removed of [
        "isSsoEnforced",
        "isSsoRequired",
        "areSsoRoutesServed",
        "shouldMaskSsoRequirementOnRead",
        "guardSsoRequirementWrite",
        "SSO_REQUIREMENT_UNCHANGEABLE_COMMUNITY_MESSAGE",
        "SSO_REQUIREMENT_UNCHANGEABLE_LICENSE_MESSAGE",
      ]) {
        expect(
          (EditionEnforcement as unknown as Record<string, unknown>)[removed],
        ).toBeUndefined();
      }
    });

    test("the source never mentions the retired SSO license feature", () => {
      const source: string = fs.readFileSync(
        path.join(__dirname, "../../../Server/Utils/EditionEnforcement.ts"),
        "utf8",
      );

      expect(source).not.toMatch(/EnterpriseFeature\.SSO\b/);
      expect(source).toContain("EnterpriseFeature.SCIM");
    });
  });
});
