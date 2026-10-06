import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import BillingPermissions from "../../../../../Server/Types/Database/Permissions/BillingPermission";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import logger from "../../../../../Server/Utils/Logger";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalOIDC from "../../../../../Models/DatabaseModels/GlobalOidc";
import GlobalOIDCProject from "../../../../../Models/DatabaseModels/GlobalOidcProject";
import GlobalSSO from "../../../../../Models/DatabaseModels/GlobalSso";
import GlobalSSOProject from "../../../../../Models/DatabaseModels/GlobalSsoProject";
import Project from "../../../../../Models/DatabaseModels/Project";
import ProjectOIDC from "../../../../../Models/DatabaseModels/ProjectOidc";
import ProjectSCIM from "../../../../../Models/DatabaseModels/ProjectSCIM";
import ProjectSSO from "../../../../../Models/DatabaseModels/ProjectSso";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import StatusPageOIDC from "../../../../../Models/DatabaseModels/StatusPageOidc";
import StatusPageSCIM from "../../../../../Models/DatabaseModels/StatusPageSCIM";
import StatusPageSSO from "../../../../../Models/DatabaseModels/StatusPageSso";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import {
  createEditionStateCases,
  EditionStateCase,
  uninstallEnterpriseModule,
} from "../../../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../../../Enterprise/TestBillingFlag";

/*
 * OneUptime Cloud (billing on) sells single sign-on on the Scale plan, and
 * that is decided by BillingPermission from each model's
 * @TableBillingAccessControl(PlanType.Scale) - never by the edition or the
 * license. For the project and status page SAML/OIDC providers (ProjectSSO,
 * ProjectOIDC, StatusPageSSO, StatusPageOIDC):
 *
 *   - below Scale (Free, Growth): creating them, switching them back on and
 *     changing them is refused with a 402 that names the plan, while the
 *     providers a project already has can still be read, switched off and
 *     deleted (Types/Billing/PlanGatedTable): a provider a Scale trial left
 *     on keeps signing people in until someone stops it;
 *   - on Scale and above (Scale, Enterprise): allowed;
 *   - whatever the edition and the license say, since on the Cloud the plan
 *     is the only gate (EditionPermission never refuses with billing on).
 *
 * A project's own "Require SSO for login" switch is Scale-gated the same way
 * (Project.requireSsoForLogin's @ColumnBillingAccessControl), and so is a
 * status page's (StatusPage.requireSsoForLogin): turning either on needs
 * Scale, turning it off works on every plan. Global SSO/OIDC
 * (master admins only) has no plan gate. SCIM stays on Scale too. And with
 * billing off - every self-hosted install, Community or Enterprise - no plan
 * gate applies at all, whatever plan the props carry.
 *
 * The plans are read from SUBSCRIPTION_PLAN_* in the environment, which this
 * suite sets itself (and restores), so it does not depend on the config file
 * it runs with.
 */
jest.mock("../../../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../../../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../../../Enterprise/TestBillingFlag",
    ) as typeof import("../../../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

type ModelType = DatabaseBaseModelType;

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

const SCALE_REFUSAL: string =
  "Please upgrade your plan to Scale to access this feature";

const PLANS_BELOW_SCALE: ReadonlyArray<PlanType> = [
  PlanType.Free,
  PlanType.Growth,
];

const PLANS_FROM_SCALE: ReadonlyArray<PlanType> = [
  PlanType.Scale,
  PlanType.Enterprise,
];

const SSO_PROVIDER_MODELS: ReadonlyArray<[string, ModelType]> = [
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

const SCIM_MODELS: ReadonlyArray<[string, ModelType]> = [
  ["ProjectSCIM", ProjectSCIM],
  ["StatusPageSCIM", StatusPageSCIM],
];

// What TablePermission checks; updates are checked by the column-aware path.
const TABLE_OPERATIONS: ReadonlyArray<DatabaseRequestType> = [
  DatabaseRequestType.Create,
  DatabaseRequestType.Read,
  DatabaseRequestType.Delete,
];

const ALL_OPERATIONS: ReadonlyArray<DatabaseRequestType> = [
  ...TABLE_OPERATIONS,
  DatabaseRequestType.Update,
];

const EDITION_CASES: Array<EditionStateCase> = createEditionStateCases();

const CLOUD_STATES: Array<[string, EditionStateCase]> = EDITION_CASES.filter(
  (state: EditionStateCase): boolean => {
    return state.billing;
  },
).map((state: EditionStateCase): [string, EditionStateCase] => {
  return [state.label, state];
});

const SELF_HOSTED_STATES: Array<[string, EditionStateCase]> =
  EDITION_CASES.filter((state: EditionStateCase): boolean => {
    return !state.billing;
  }).map((state: EditionStateCase): [string, EditionStateCase] => {
    return [state.label, state];
  });

const projectId: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const userId: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

// A project owner on the given plan.
const ownerOnPlan: (plan: PlanType) => DatabaseCommonInteractionProps = (
  plan: PlanType,
): DatabaseCommonInteractionProps => {
  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectOwner,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  } as UserTenantAccessPermission;

  return {
    userId,
    tenantId: projectId,
    currentPlan: plan,
    isSubscriptionUnpaid: false,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
};

// The plan check an operation runs through, as the database layer runs it.
const checkPlan: (input: {
  modelType: ModelType;
  operation: DatabaseRequestType;
  plan: PlanType;
  updateData?: unknown;
}) => "allowed" | string = (input: {
  modelType: ModelType;
  operation: DatabaseRequestType;
  plan: PlanType;
  updateData?: unknown;
}): "allowed" | string => {
  try {
    if (input.operation === DatabaseRequestType.Update) {
      BillingPermissions.checkBillingPermissions(
        input.modelType,
        ownerOnPlan(input.plan),
        input.operation,
        input.updateData,
      );
    } else {
      TablePermission.checkTableLevelPermissions(
        input.modelType,
        ownerOnPlan(input.plan),
        input.operation,
      );
    }

    return "allowed";
  } catch (err) {
    if (err instanceof PaymentRequiredException) {
      return err.message;
    }

    throw err;
  }
};

describe("single sign-on on OneUptime Cloud: the Scale plan gate", () => {
  const savedPlanEnvironment: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SUBSCRIPTION_PLAN_")) {
        savedPlanEnvironment[key] = process.env[key];
        delete process.env[key];
      }
    }

    Object.assign(process.env, PLAN_ENVIRONMENT);
  });

  afterAll(() => {
    for (const key of Object.keys(PLAN_ENVIRONMENT)) {
      delete process.env[key];
    }

    for (const [key, value] of Object.entries(savedPlanEnvironment)) {
      if (value !== undefined) {
        process.env[key] = value;
      }
    }
  });

  beforeEach(() => {
    setTestBillingEnabled(true);
    uninstallEnterpriseModule();
    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  test("the four provider models are Scale-gated for every operation, and carry no edition gate", () => {
    for (const [, modelType] of SSO_PROVIDER_MODELS) {
      const model: BaseModel = new modelType();

      expect({
        create: model.createBillingPlan,
        read: model.readBillingPlan,
        update: model.updateBillingPlan,
        delete: model.deleteBillingPlan,
      }).toEqual({
        create: PlanType.Scale,
        read: PlanType.Scale,
        update: PlanType.Scale,
        delete: PlanType.Scale,
      });
      expect(model.requiresEnterprise).toBeFalsy();
    }
  });

  describe.each(CLOUD_STATES)(
    "%s",
    (_label: string, state: EditionStateCase) => {
      beforeEach(() => {
        state.apply();
      });

      test.each(SSO_PROVIDER_MODELS)(
        "%s: creating and changing are refused below Scale with a 402 that names the plan",
        (_name: string, modelType: ModelType) => {
          for (const plan of PLANS_BELOW_SCALE) {
            for (const [operation, updateData] of [
              [DatabaseRequestType.Create, undefined],
              [DatabaseRequestType.Update, undefined],
              [DatabaseRequestType.Update, { isEnabled: true }],
              [DatabaseRequestType.Update, { name: "Renamed" }],
              [DatabaseRequestType.Update, { isEnabled: false, name: "x" }],
            ] as Array<[DatabaseRequestType, unknown]>) {
              expect(
                `${plan} ${operation} ${JSON.stringify(updateData)}: ${checkPlan({ modelType, operation, plan, updateData })}`,
              ).toBe(
                `${plan} ${operation} ${JSON.stringify(updateData)}: ${SCALE_REFUSAL}`,
              );
            }
          }
        },
      );

      test.each(SSO_PROVIDER_MODELS)(
        "%s: a provider the project has can be read, switched off and deleted below Scale",
        (_name: string, modelType: ModelType) => {
          for (const plan of PLANS_BELOW_SCALE) {
            for (const [operation, updateData] of [
              [DatabaseRequestType.Read, undefined],
              [DatabaseRequestType.Delete, undefined],
              [DatabaseRequestType.Update, { isEnabled: false }],
            ] as Array<[DatabaseRequestType, unknown]>) {
              expect(
                `${plan} ${operation}: ${checkPlan({ modelType, operation, plan, updateData })}`,
              ).toBe(`${plan} ${operation}: allowed`);
            }
          }
        },
      );

      test.each(SSO_PROVIDER_MODELS)(
        "%s is allowed on Scale and above",
        (_name: string, modelType: ModelType) => {
          for (const plan of PLANS_FROM_SCALE) {
            for (const operation of ALL_OPERATIONS) {
              expect(
                `${plan} ${operation}: ${checkPlan({ modelType, operation, plan })}`,
              ).toBe(`${plan} ${operation}: allowed`);
            }
          }
        },
      );

      test('a project\'s own "Require SSO for login" switch is Scale-gated too', () => {
        const data: Project = new Project();
        data.requireSsoForLogin = true;

        for (const plan of PLANS_BELOW_SCALE) {
          expect(() => {
            ColumnPermissions.checkDataColumnPermissions(
              Project,
              data,
              ownerOnPlan(plan),
              DatabaseRequestType.Update,
            );
          }).toThrow(new PaymentRequiredException(SCALE_REFUSAL));
        }

        for (const plan of PLANS_FROM_SCALE) {
          expect(() => {
            ColumnPermissions.checkDataColumnPermissions(
              Project,
              data,
              ownerOnPlan(plan),
              DatabaseRequestType.Update,
            );
          }).not.toThrow();
        }
      });

      test('a status page\'s "Require SSO for login" switch is Scale-gated too, on a create as on an update; off works on every plan', () => {
        for (const operation of [
          DatabaseRequestType.Create,
          DatabaseRequestType.Update,
        ]) {
          const on: StatusPage = new StatusPage();
          on.requireSsoForLogin = true;

          const off: StatusPage = new StatusPage();
          off.requireSsoForLogin = false;

          for (const plan of PLANS_BELOW_SCALE) {
            expect(() => {
              ColumnPermissions.checkDataColumnPermissions(
                StatusPage,
                on,
                ownerOnPlan(plan),
                operation,
              );
            }).toThrow(new PaymentRequiredException(SCALE_REFUSAL));
          }

          for (const plan of [...PLANS_BELOW_SCALE, ...PLANS_FROM_SCALE]) {
            expect(() => {
              ColumnPermissions.checkDataColumnPermissions(
                StatusPage,
                off,
                ownerOnPlan(plan),
                operation,
              );
            }).not.toThrow();
          }

          for (const plan of PLANS_FROM_SCALE) {
            expect(() => {
              ColumnPermissions.checkDataColumnPermissions(
                StatusPage,
                on,
                ownerOnPlan(plan),
                operation,
              );
            }).not.toThrow();
          }
        }
      });

      test.each(GLOBAL_SSO_MODELS)(
        "%s (global single sign-on, master admins only) has no plan gate",
        (_name: string, modelType: ModelType) => {
          const model: BaseModel = new modelType();

          expect(model.createBillingPlan).toBeFalsy();
          expect(model.updateBillingPlan).toBeFalsy();

          for (const operation of ALL_OPERATIONS) {
            expect(() => {
              BillingPermissions.checkBillingPermissions(
                modelType,
                ownerOnPlan(PlanType.Free),
                operation,
              );
            }).not.toThrow();
          }
        },
      );

      test.each(SCIM_MODELS)(
        "%s stays on Scale as well",
        (_name: string, modelType: ModelType) => {
          expect(
            checkPlan({
              modelType,
              operation: DatabaseRequestType.Create,
              plan: PlanType.Growth,
            }),
          ).toBe(SCALE_REFUSAL);
          expect(
            checkPlan({
              modelType,
              operation: DatabaseRequestType.Create,
              plan: PlanType.Scale,
            }),
          ).toBe("allowed");
        },
      );
    },
  );

  describe.each(SELF_HOSTED_STATES)(
    "self-hosted, %s: no plan gate at all",
    (_label: string, state: EditionStateCase) => {
      beforeEach(() => {
        state.apply();
      });

      test.each(SSO_PROVIDER_MODELS)(
        "%s is not refused whatever plan the props carry",
        (_name: string, modelType: ModelType) => {
          for (const plan of [...PLANS_BELOW_SCALE, ...PLANS_FROM_SCALE]) {
            for (const operation of ALL_OPERATIONS) {
              expect(
                `${plan} ${operation}: ${checkPlan({ modelType, operation, plan })}`,
              ).toBe(`${plan} ${operation}: allowed`);
            }
          }
        },
      );

      test('a project\'s "Require SSO for login" switch is not plan-gated', () => {
        const data: Project = new Project();
        data.requireSsoForLogin = true;

        expect(() => {
          ColumnPermissions.checkDataColumnPermissions(
            Project,
            data,
            ownerOnPlan(PlanType.Free),
            DatabaseRequestType.Update,
          );
        }).not.toThrow();
      });

      test('a status page\'s "Require SSO for login" switch is not plan-gated', () => {
        const data: StatusPage = new StatusPage();
        data.requireSsoForLogin = true;

        for (const operation of [
          DatabaseRequestType.Create,
          DatabaseRequestType.Update,
        ]) {
          expect(() => {
            ColumnPermissions.checkDataColumnPermissions(
              StatusPage,
              data,
              ownerOnPlan(PlanType.Free),
              operation,
            );
          }).not.toThrow();
        }
      });
    },
  );
});
