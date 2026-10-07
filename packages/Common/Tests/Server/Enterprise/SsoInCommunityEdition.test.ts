import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import EnterpriseEdition, {
  RUNTIME_ENTERPRISE_FEATURES,
} from "../../../Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature, {
  ALL_ENTERPRISE_FEATURES,
  RETIRED_ENTERPRISE_FEATURE_VALUES,
  parseEnterpriseFeature,
} from "../../../Server/Enterprise/EnterpriseFeature";
import { EnterpriseLicenseSnapshot } from "../../../Server/Enterprise/EnterpriseLicenseSnapshot";
import EditionPermissions from "../../../Server/Types/Database/Permissions/EditionPermission";
import BasePermission from "../../../Server/Types/Database/Permissions/BasePermission";
import CreatePermission from "../../../Server/Types/Database/Permissions/CreatePermission";
import TablePermission from "../../../Server/Types/Database/Permissions/TablePermission";
import UpdatePermission from "../../../Server/Types/Database/Permissions/UpdatePermission";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import Query from "../../../Server/Types/Database/Query";
import EditionEnforcement from "../../../Server/Utils/EditionEnforcement";
import logger from "../../../Server/Utils/Logger";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalOIDC from "../../../Models/DatabaseModels/GlobalOidc";
import GlobalOIDCProject from "../../../Models/DatabaseModels/GlobalOidcProject";
import GlobalSSO from "../../../Models/DatabaseModels/GlobalSso";
import GlobalSSOProject from "../../../Models/DatabaseModels/GlobalSsoProject";
import ProjectOIDC from "../../../Models/DatabaseModels/ProjectOidc";
import ProjectSCIM from "../../../Models/DatabaseModels/ProjectSCIM";
import ProjectSSO from "../../../Models/DatabaseModels/ProjectSso";
import StatusPageOIDC from "../../../Models/DatabaseModels/StatusPageOidc";
import StatusPageSCIM from "../../../Models/DatabaseModels/StatusPageSCIM";
import StatusPageSSO from "../../../Models/DatabaseModels/StatusPageSso";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import QueryDeepPartialEntity from "../../../Types/Database/PartialEntity";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import FakeEnterpriseModule, {
  createLicenseSnapshot,
  installFakeEnterpriseModule,
  LICENSE_STATE_CASES,
  LicenseStateCase,
  uninstallEnterpriseModule,
} from "./FakeEnterpriseModule";
import { setTestBillingEnabled } from "./TestBillingFlag";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";

/*
 * Single sign-on - SAML and OIDC for projects, status pages and the whole
 * instance, and "Require SSO for login" - is part of the Community Edition.
 * This suite proves it end to end at the model and permission level, in
 * EVERY deployment state:
 *
 *   - the Community Edition (ee/ not loaded), billing off and on;
 *   - the Enterprise Edition in every license state: valid, grace, trial,
 *     accepted legacy, expired, missing after the trial, invalid, a license
 *     that leaves SCIM and audit logs out, and the unknown states;
 *   - OneUptime Cloud (billing on, ee/ loaded).
 *
 * In all of them the eight SSO configuration models carry no edition gate,
 * the right roles can create and update them (project owners and admins for
 * project and status page providers, master admins for global ones), and no
 * license - including one issued with the retired "sso" claim - changes
 * that. SCIM is the control: it keeps its Enterprise gating unchanged.
 *
 * The Cloud's Scale plan gate is covered by SsoScalePlanGate.test.ts.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("./TestBillingFlag") = jest.requireActual(
    "./TestBillingFlag",
  ) as typeof import("./TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

type ModelType = DatabaseBaseModelType;

type DeploymentState = {
  label: string;
  billing: boolean;
  isLoaded: boolean;
  // Whether an enterprise configuration write is allowed (billing off).
  isConfigurationAvailable: boolean;
  apply: () => void;
};

const PROJECT_SSO_MODELS: ReadonlyArray<[string, ModelType]> = [
  ["ProjectSSO", ProjectSSO],
  ["ProjectOIDC", ProjectOIDC],
  ["StatusPageSSO", StatusPageSSO],
  ["StatusPageOIDC", StatusPageOIDC],
];

const GLOBAL_SSO_MODELS: ReadonlyArray<[string, ModelType]> = [
  ["GlobalSSO", GlobalSSO],
  ["GlobalOIDC", GlobalOIDC],
  ["GlobalSSOProject", GlobalSSOProject],
  ["GlobalOIDCProject", GlobalOIDCProject],
];

const SSO_MODELS: ReadonlyArray<[string, ModelType]> = [
  ...GLOBAL_SSO_MODELS,
  ...PROJECT_SSO_MODELS,
];

const SCIM_MODELS: ReadonlyArray<[string, ModelType]> = [
  ["ProjectSCIM", ProjectSCIM],
  ["StatusPageSCIM", StatusPageSCIM],
];

const buildDeploymentStates: () => Array<DeploymentState> =
  (): Array<DeploymentState> => {
    const states: Array<DeploymentState> = [];

    for (const billing of [false, true]) {
      states.push({
        label: `billing=${billing}, Community Edition`,
        billing,
        isLoaded: false,
        isConfigurationAvailable: false,
        apply: (): void => {
          setTestBillingEnabled(billing);
          uninstallEnterpriseModule();
        },
      });

      for (const licenseState of LICENSE_STATE_CASES) {
        states.push({
          label: `billing=${billing}, Enterprise Edition, ${licenseState.label}`,
          billing,
          isLoaded: true,
          // Configuration fails closed in an unknown license state.
          isConfigurationAvailable:
            licenseState.isActiveWithoutBilling && !licenseState.isUnknown,
          apply: (): void => {
            setTestBillingEnabled(billing);
            licenseState.install();
          },
        });
      }
    }

    return states;
  };

const DEPLOYMENT_STATES: Array<[string, DeploymentState]> =
  buildDeploymentStates().map(
    (state: DeploymentState): [string, DeploymentState] => {
      return [state.label, state];
    },
  );

const projectId: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const userId: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const withPermissions: (
  permissions: Array<Permission>,
) => DatabaseCommonInteractionProps = (
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps => {
  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  } as UserTenantAccessPermission;

  return {
    userId,
    tenantId: projectId,
    ...ON_HIGHEST_PLAN,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
};

const masterAdmin: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return { userId, isMasterAdmin: true };
  };

const PROVIDER_QUERY: Query<BaseModel> = {
  _id: "33333333-3333-4333-8333-333333333333",
} as Query<BaseModel>;

const PROVIDER_UPDATE: QueryDeepPartialEntity<BaseModel> = {
  isEnabled: true,
  name: "Okta",
} as QueryDeepPartialEntity<BaseModel>;

// The claim list of a license, as the license client reads it into features.
const featuresFromClaims: (
  claims: Array<string>,
) => Array<EnterpriseFeature> = (
  claims: Array<string>,
): Array<EnterpriseFeature> => {
  const features: Array<EnterpriseFeature> = [];

  for (const claim of claims) {
    const feature: EnterpriseFeature | null = parseEnterpriseFeature(claim);

    if (feature && !features.includes(feature)) {
      features.push(feature);
    }
  }

  return features;
};

describe("single sign-on is part of the Community Edition", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
    uninstallEnterpriseModule();
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });
    // What follows the table-level checks on update needs a database.
    jest.spyOn(BasePermission, "checkPermissions").mockImplementation((async (
      _modelType: unknown,
      checkedQuery: Query<BaseModel>,
    ) => {
      return { query: checkedQuery };
    }) as never);
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  describe("the models and the license format", () => {
    test.each(SSO_MODELS)(
      "%s carries no edition gate and maps to no license feature",
      (tableName: string, modelType: ModelType) => {
        const model: BaseModel = new modelType();

        expect(model.tableName).toBe(tableName);
        expect(model.requiresEnterprise).toBeFalsy();
        expect(EnterpriseEdition.getModelFeature(modelType)).toBeNull();
        expect(EnterpriseEdition.getMappedTableNames()).not.toContain(
          tableName,
        );
        expect(EditionPermissions.getTightenOnlyColumns().has(tableName)).toBe(
          false,
        );
      },
    );

    test('the license format has no single sign-on feature, and the retired "sso" claim parses to nothing', () => {
      expect(ALL_ENTERPRISE_FEATURES as ReadonlyArray<string>).not.toContain(
        "sso",
      );
      expect(Object.keys(EnterpriseFeature)).not.toContain("SSO");
      expect(RETIRED_ENTERPRISE_FEATURE_VALUES).toContain("sso");
      expect(parseEnterpriseFeature("sso")).toBeNull();
    });

    test("single sign-on is not a runtime enterprise feature, and nothing in core asks about it", () => {
      expect(
        RUNTIME_ENTERPRISE_FEATURES as ReadonlyArray<string>,
      ).not.toContain("sso");

      for (const removed of [
        "isSsoEnforced",
        "isSsoRequired",
        "areSsoRoutesServed",
        "shouldMaskSsoRequirementOnRead",
        "guardSsoRequirementWrite",
      ]) {
        expect(
          (EditionEnforcement as unknown as Record<string, unknown>)[removed],
        ).toBeUndefined();
      }
    });
  });

  describe.each(DEPLOYMENT_STATES)(
    "%s",
    (_label: string, state: DeploymentState) => {
      beforeEach(() => {
        state.apply();
      });

      test("the edition check never refuses single sign-on configuration", () => {
        for (const [, modelType] of SSO_MODELS) {
          for (const props of [
            withPermissions([Permission.ProjectOwner]),
            masterAdmin(),
          ]) {
            for (const operation of [
              DatabaseRequestType.Create,
              DatabaseRequestType.Read,
              DatabaseRequestType.Update,
              DatabaseRequestType.Delete,
            ]) {
              expect(() => {
                EditionPermissions.checkEditionPermissions(
                  modelType,
                  props,
                  operation,
                  { isEnabled: true },
                );
              }).not.toThrow();
            }
          }
        }
      });

      test.each(PROJECT_SSO_MODELS)(
        "a project owner can create, read, update and delete %s",
        async (_name: string, modelType: ModelType) => {
          const owner: DatabaseCommonInteractionProps = withPermissions([
            Permission.ProjectOwner,
          ]);

          for (const operation of [
            DatabaseRequestType.Create,
            DatabaseRequestType.Read,
            DatabaseRequestType.Delete,
          ]) {
            expect(() => {
              TablePermission.checkTableLevelPermissions(
                modelType,
                owner,
                operation,
              );
            }).not.toThrow();
          }

          await expect(
            UpdatePermission.checkUpdatePermissions(
              modelType,
              PROVIDER_QUERY,
              PROVIDER_UPDATE,
              owner,
            ),
          ).resolves.toEqual(PROVIDER_QUERY);
        },
      );

      test.each(SSO_MODELS)(
        "a master admin can create and update %s",
        async (_name: string, modelType: ModelType) => {
          expect(() => {
            CreatePermission.checkCreatePermissions(
              modelType,
              new modelType(),
              masterAdmin(),
            );
          }).not.toThrow();

          await expect(
            UpdatePermission.checkUpdatePermissions(
              modelType,
              PROVIDER_QUERY,
              PROVIDER_UPDATE,
              masterAdmin(),
            ),
          ).resolves.toBe(PROVIDER_QUERY);
        },
      );

      test.each(GLOBAL_SSO_MODELS)(
        "a project owner who is not a master admin still cannot create %s",
        (_name: string, modelType: ModelType) => {
          expect(() => {
            TablePermission.checkTableLevelPermissions(
              modelType,
              withPermissions([Permission.ProjectOwner]),
              DatabaseRequestType.Create,
            );
          }).toThrow();
        },
      );

      // The control: SCIM keeps its Enterprise gating exactly as before.
      test.each(SCIM_MODELS)(
        "%s keeps its Enterprise gating",
        (_name: string, modelType: ModelType) => {
          const create: () => void = (): void => {
            CreatePermission.checkCreatePermissions(
              modelType,
              new modelType(),
              masterAdmin(),
            );
          };

          if (state.billing) {
            expect(create).not.toThrow();
            return;
          }

          if (!state.isLoaded) {
            expect(create).toThrow(
              new PaymentRequiredException(
                EnterpriseEdition.COMMUNITY_EDITION_MESSAGE,
              ),
            );
            return;
          }

          if (state.isConfigurationAvailable) {
            expect(create).not.toThrow();
          } else {
            expect(create).toThrow(
              new PaymentRequiredException(
                EnterpriseEdition.LICENSE_REQUIRED_MESSAGE,
              ),
            );
          }
        },
      );
    },
  );

  test("the matrix covers the Community Edition, every license state and the Cloud", () => {
    const labels: Array<string> = DEPLOYMENT_STATES.map(
      ([label]: [string, DeploymentState]): string => {
        return label;
      },
    );

    expect(labels).toHaveLength(2 * (1 + LICENSE_STATE_CASES.length));
    expect(
      LICENSE_STATE_CASES.filter((licenseState: LicenseStateCase): boolean => {
        return !licenseState.isActiveWithoutBilling;
      }).length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      LICENSE_STATE_CASES.filter((licenseState: LicenseStateCase): boolean => {
        return licenseState.isUnknown;
      }).length,
    ).toBeGreaterThan(0);
  });

  describe('a license issued with the retired "sso" claim', () => {
    const installWithClaims: (claims: Array<string>) => FakeEnterpriseModule = (
      claims: Array<string>,
    ): FakeEnterpriseModule => {
      const snapshot: EnterpriseLicenseSnapshot = createLicenseSnapshot({
        features: featuresFromClaims(claims),
      });

      return installFakeEnterpriseModule({ snapshot });
    };

    test('a license whose features are only ["sso"] entitles nothing', () => {
      installWithClaims(["sso"]);

      for (const feature of ALL_ENTERPRISE_FEATURES) {
        expect(EnterpriseEdition.isFeatureAvailableSync(feature)).toBe(false);
        expect(EnterpriseEdition.isFeatureActive(feature)).toBe(false);
      }

      expect(() => {
        CreatePermission.checkCreatePermissions(
          ProjectSCIM,
          new ProjectSCIM(),
          masterAdmin(),
        );
      }).toThrow(
        new PaymentRequiredException(
          EnterpriseEdition.LICENSE_REQUIRED_MESSAGE,
        ),
      );
    });

    test('a license whose features are ["sso", "scim"] entitles SCIM only', () => {
      installWithClaims(["sso", "scim"]);

      for (const feature of ALL_ENTERPRISE_FEATURES) {
        expect({
          feature,
          available: EnterpriseEdition.isFeatureAvailableSync(feature),
        }).toEqual({ feature, available: feature === EnterpriseFeature.SCIM });
      }

      expect(EditionEnforcement.areScimTeamLocksEnforced()).toBe(true);
      expect(() => {
        CreatePermission.checkCreatePermissions(
          ProjectSCIM,
          new ProjectSCIM(),
          masterAdmin(),
        );
      }).not.toThrow();
    });

    test.each([[["sso"]], [["sso", "scim"]], [[]]] as Array<[Array<string>]>)(
      "single sign-on configuration is writable either way (claims %j)",
      async (claims: Array<string>) => {
        installWithClaims(claims);

        for (const [, modelType] of SSO_MODELS) {
          expect(() => {
            CreatePermission.checkCreatePermissions(
              modelType,
              new modelType(),
              masterAdmin(),
            );
          }).not.toThrow();
        }

        for (const [, modelType] of PROJECT_SSO_MODELS) {
          expect(() => {
            TablePermission.checkTableLevelPermissions(
              modelType,
              withPermissions([Permission.ProjectOwner]),
              DatabaseRequestType.Create,
            );
          }).not.toThrow();
        }
      },
    );
  });
});
