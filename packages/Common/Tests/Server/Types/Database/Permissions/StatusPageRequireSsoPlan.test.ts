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
import Project from "../../../../../Models/DatabaseModels/Project";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import logger from "../../../../../Server/Utils/Logger";
import ColumnBillingAccessControl from "../../../../../Types/BaseDatabase/ColumnBillingAccessControl";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { isPlanGatedColumnDefault } from "../../../../../Types/Billing/PlanGatedColumnDefault";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import PaymentRequiredException from "../../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import {
  getPlanNeededToFlipSwitch,
  getPlanNeededToWriteColumn,
  getSwitchPlanLeftover,
  SwitchPlanLeftover,
} from "../../../../../UI/Components/ModelSwitch/ModelSwitchUtil";
import ProjectUtil from "../../../../../UI/Utils/Project";
import { setTestBillingEnabled } from "../../../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../../../Spy";
import { getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

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

/*
 * A status page's "Require SSO for Login" (StatusPage.requireSsoForLogin) is
 * single sign-on, which OneUptime Cloud sells on the Scale plan - like the
 * status page's SAML and OIDC providers and the project's own Require SSO.
 * On the Cloud (billing on), the server's column check (ColumnPermission,
 * for creates and updates) now asks for it:
 *
 *   - turning it on needs Scale, on an update and on a create alike, and
 *     below Scale is refused with the plan's name;
 *   - turning it off is the column's default and works on every plan
 *     (Types/Billing/PlanGatedColumnDefault), so a page a Scale trial left
 *     requiring SSO can always be let back in with passwords;
 *   - only exactly false is off: anything else needs the plan.
 *
 * The dashboard's switch reads the same rule (ModelSwitchUtil): below Scale
 * it names the plan for turning it on, and a page still requiring SSO is a
 * leftover that can be turned off. With billing off - every self-hosted
 * install - nothing is asked.
 *
 * The plans are read from SUBSCRIPTION_PLAN_* in the environment, which this
 * suite sets itself (and restores), so it does not depend on the config file
 * it runs with. Billing is pinned per test: CI's config.env turns it on.
 */

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

const COLUMN: string = "requireSsoForLogin";

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

const ALL_PLANS: ReadonlyArray<PlanType> = [
  ...PLANS_BELOW_SCALE,
  ...PLANS_FROM_SCALE,
];

const WRITES: ReadonlyArray<[string, DatabaseRequestType]> = [
  ["an update", DatabaseRequestType.Update],
  ["a create", DatabaseRequestType.Create],
];

const PROJECT_ID: ObjectID = new ObjectID(
  "5b000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("5b000000-0000-4000-8000-000000000002");

// Someone who may create and edit status pages, on a plan.
const editorOnPlan: (
  plan: PlanType,
  permission?: Permission,
) => DatabaseCommonInteractionProps = (
  plan: PlanType,
  permission?: Permission,
): DatabaseCommonInteractionProps => {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    currentPlan: plan,
    isSubscriptionUnpaid: false,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          {
            _type: "UserPermission",
            permission: permission || Permission.ProjectOwner,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      } as UserTenantAccessPermission,
    },
  };
};

// What the server's column check says about a write: "allowed", or its refusal.
const checkWrite: (input: {
  requestType: DatabaseRequestType;
  plan: PlanType;
  data: Record<string, unknown>;
  permission?: Permission;
}) => string = (input: {
  requestType: DatabaseRequestType;
  plan: PlanType;
  data: Record<string, unknown>;
  permission?: Permission;
}): string => {
  try {
    ColumnPermissions.checkDataColumnPermissions(
      StatusPage,
      input.data as unknown as StatusPage,
      editorOnPlan(input.plan, input.permission),
      input.requestType,
    );

    return "allowed";
  } catch (err) {
    if (err instanceof PaymentRequiredException) {
      return err.message;
    }

    throw err;
  }
};

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
  getJestSpyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("StatusPage.requireSsoForLogin carries the single sign-on plan", () => {
  test("turning it on needs Scale, on a create as on an update; reading it needs no plan", () => {
    const billing: ColumnBillingAccessControl =
      new StatusPage().getColumnBillingAccessControl(COLUMN);

    expect(billing).toEqual({
      read: PlanType.Free,
      create: PlanType.Scale,
      update: PlanType.Scale,
    });
  });

  test("the same plan as the project's own Require SSO", () => {
    expect(
      new StatusPage().getColumnBillingAccessControl(COLUMN).update,
    ).toBe(new Project().getColumnBillingAccessControl(COLUMN).update);
  });

  test("its default is off, in the model and in the database: the value every plan may write", () => {
    const metadata: ReturnType<StatusPage["getTableColumnMetadata"]> =
      new StatusPage().getTableColumnMetadata(COLUMN);

    expect(metadata.defaultValue).toBe(false);

    const typeOrm: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find(
        (candidate: ColumnMetadataArgs): boolean => {
          return (
            candidate.target === StatusPage && candidate.propertyName === COLUMN
          );
        },
      );

    expect(typeOrm?.options.default).toBe(false);
    expect(isPlanGatedColumnDefault(metadata, false)).toBe(true);
    expect(isPlanGatedColumnDefault(metadata, true)).toBe(false);
  });
});

describe("on OneUptime Cloud (billing on), at the server's column check", () => {
  describe.each(WRITES)("%s", (_label: string, requestType: DatabaseRequestType) => {
    test.each(PLANS_BELOW_SCALE)(
      "on %s, requiring SSO is refused with the plan's name",
      (plan: PlanType) => {
        expect(
          checkWrite({ requestType, plan, data: { [COLUMN]: true } }),
        ).toBe(SCALE_REFUSAL);
      },
    );

    test.each(PLANS_FROM_SCALE)(
      "on %s, requiring SSO is allowed",
      (plan: PlanType) => {
        expect(
          checkWrite({ requestType, plan, data: { [COLUMN]: true } }),
        ).toBe("allowed");
      },
    );

    test.each(ALL_PLANS)(
      "on %s, not requiring SSO - the default - is allowed",
      (plan: PlanType) => {
        expect(
          checkWrite({ requestType, plan, data: { [COLUMN]: false } }),
        ).toBe("allowed");
      },
    );

    test.each([
      ["the text \"false\"", "false"],
      ["0", 0],
      ["the text \"true\"", "true"],
    ])(
      "only exactly false is off: %s still needs Scale",
      (_name: string, value: unknown) => {
        expect(
          checkWrite({
            requestType,
            plan: PlanType.Free,
            data: { [COLUMN]: value },
          }),
        ).toBe(SCALE_REFUSAL);
      },
    );
  });

  test("a page left requiring SSO can be let back in with passwords on Free, alongside its other leftovers", () => {
    expect(
      checkWrite({
        requestType: DatabaseRequestType.Update,
        plan: PlanType.Free,
        data: {
          [COLUMN]: false,
          enableSmsSubscribers: false,
          isReportEnabled: false,
        },
      }),
    ).toBe("allowed");
  });

  test("turning it off does not carry another feature on with it: that one is refused with its own plan", () => {
    expect(
      checkWrite({
        requestType: DatabaseRequestType.Update,
        plan: PlanType.Free,
        data: { [COLUMN]: false, enableSmsSubscribers: true },
      }),
    ).toBe("Please upgrade your plan to Growth to access this feature");
  });

  test.each([
    Permission.ProjectAdmin,
    Permission.StatusPageAdmin,
    Permission.StatusPageMember,
    Permission.EditProjectStatusPage,
  ])(
    "for every role that may edit status pages (%s), the plan is what decides",
    (permission: Permission) => {
      expect(
        checkWrite({
          requestType: DatabaseRequestType.Update,
          plan: PlanType.Growth,
          data: { [COLUMN]: true },
          permission,
        }),
      ).toBe(SCALE_REFUSAL);
      expect(
        checkWrite({
          requestType: DatabaseRequestType.Update,
          plan: PlanType.Scale,
          data: { [COLUMN]: true },
          permission,
        }),
      ).toBe("allowed");
      expect(
        checkWrite({
          requestType: DatabaseRequestType.Update,
          plan: PlanType.Growth,
          data: { [COLUMN]: false },
          permission,
        }),
      ).toBe("allowed");
    },
  );

  test("a whole status page created requiring SSO is refused below Scale by the create check, and created from Scale", () => {
    const pageRequiringSso: () => StatusPage = (): StatusPage => {
      const page: StatusPage = new StatusPage();
      page.name = "Customer status";
      page.projectId = PROJECT_ID;
      page.requireSsoForLogin = true;
      return page;
    };

    for (const plan of PLANS_BELOW_SCALE) {
      expect(() => {
        ModelPermission.checkCreatePermissions(
          StatusPage,
          pageRequiringSso(),
          editorOnPlan(plan),
        );
      }).toThrow(new PaymentRequiredException(SCALE_REFUSAL));
    }

    for (const plan of PLANS_FROM_SCALE) {
      expect(() => {
        ModelPermission.checkCreatePermissions(
          StatusPage,
          pageRequiringSso(),
          editorOnPlan(plan),
        );
      }).not.toThrow();
    }

    // A page created without it - every page the dashboard creates - is fine on Free.
    const plainPage: StatusPage = pageRequiringSso();
    plainPage.requireSsoForLogin = false;

    expect(() => {
      ModelPermission.checkCreatePermissions(
        StatusPage,
        plainPage,
        editorOnPlan(PlanType.Free),
      );
    }).not.toThrow();
  });
});

describe("the dashboard's switch reads the same rule", () => {
  const setPlan: (plan: PlanType | null) => void = (
    plan: PlanType | null,
  ): void => {
    getJestSpyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(plan);
  };

  test.each(PLANS_BELOW_SCALE)(
    "on %s it names Scale for turning SSO on, and nothing for turning it off",
    (plan: PlanType) => {
      setPlan(plan);

      expect(getPlanNeededToWriteColumn(new StatusPage(), COLUMN, true)).toBe(
        PlanType.Scale,
      );
      expect(
        getPlanNeededToWriteColumn(new StatusPage(), COLUMN, false),
      ).toBeNull();
      expect(
        getPlanNeededToFlipSwitch({
          model: new StatusPage(),
          column: COLUMN,
          isOn: false,
        }),
      ).toBe(PlanType.Scale);
      expect(
        getPlanNeededToFlipSwitch({
          model: new StatusPage(),
          column: COLUMN,
          isOn: true,
        }),
      ).toBeNull();
    },
  );

  test.each(PLANS_BELOW_SCALE)(
    "on %s a page still requiring SSO is a leftover that can be turned off, and turning it on again needs Scale",
    (plan: PlanType) => {
      setPlan(plan);

      const leftover: SwitchPlanLeftover | null = getSwitchPlanLeftover({
        model: new StatusPage(),
        column: COLUMN,
        isOn: true,
      });

      expect(leftover).toEqual({ canTurn: "off", planNeeded: PlanType.Scale });

      // Once off, there is nothing left over: the plan's upsell is the page.
      expect(
        getSwitchPlanLeftover({
          model: new StatusPage(),
          column: COLUMN,
          isOn: false,
        }),
      ).toBeNull();
    },
  );

  test.each([...PLANS_FROM_SCALE, null])(
    "on %s (or a plan the dashboard cannot read), it names no plan",
    (plan: PlanType | null) => {
      setPlan(plan);

      expect(
        getPlanNeededToWriteColumn(new StatusPage(), COLUMN, true),
      ).toBeNull();
      expect(
        getSwitchPlanLeftover({
          model: new StatusPage(),
          column: COLUMN,
          isOn: true,
        }),
      ).toBeNull();
    },
  );
});

describe("on a self-hosted install (billing off)", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
  });

  describe.each(WRITES)("%s", (_label: string, requestType: DatabaseRequestType) => {
    test.each(ALL_PLANS)(
      "requiring SSO is allowed whatever plan the props carry (%s)",
      (plan: PlanType) => {
        expect(
          checkWrite({ requestType, plan, data: { [COLUMN]: true } }),
        ).toBe("allowed");
        expect(
          checkWrite({ requestType, plan, data: { [COLUMN]: false } }),
        ).toBe("allowed");
      },
    );
  });
});
