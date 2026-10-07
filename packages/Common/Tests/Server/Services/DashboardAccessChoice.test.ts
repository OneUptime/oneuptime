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
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DashboardService from "../../../Server/Services/DashboardService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressRequest } from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import {
  DASHBOARD_ACCESS_CHOICES,
  DashboardAccess,
  DashboardAccessState,
  getDashboardAccess,
  getDashboardAccessChanges,
  isDashboardLockedWithoutPassword,
  isDashboardPasswordNeededFor,
} from "../../../Types/Dashboard/DashboardAccess";
import { DASHBOARD_MASTER_PASSWORD_COOKIE_IDENTIFIER } from "../../../Types/Dashboard/MasterPassword";
import MasterPasswordRequiredException from "../../../Types/Exception/MasterPasswordRequiredException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { getPlanNeededToWriteColumn } from "../../../UI/Components/ModelSwitch/ModelSwitchUtil";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  getPlanNeededForDashboardAccess,
  getPlanNeededToComeBackToDashboardAccess,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Sharing/DashboardSharingCopy";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../Spy";

/*
 * Who can view a dashboard is one choice on its Sharing page (only people
 * in this project, anyone with the link, anyone with the link and a
 * password). The page writes a choice as the columns that change (Types/
 * Dashboard/DashboardAccess), with a password whenever the move needs one.
 * These pin, at the server, that what it writes is what the choice says:
 *
 *   - the server's own read check (DashboardService.hasReadAccess) keeps the
 *     public link closed, opens it, or asks for the password - the choice
 *     made - from every state a dashboard can start in, with billing on and
 *     off, and never leaves a dashboard in a state it reads as another
 *     choice;
 *   - no move leaves the public link locked (the password switch on with no
 *     password, where the server fails closed and lets nobody in): a move
 *     to the password carries one whenever none is stored, so a visitor
 *     who entered it gets in;
 *   - on OneUptime Cloud (billing on), the column check (ColumnPermission,
 *     which refuses a write that carries a plan-gated column switched on,
 *     changed or not) refuses exactly the moves that make a dashboard
 *     PUBLIC below Growth. Making one private again ("Only people in this
 *     project") takes isPublicDashboard back to its default, which every
 *     plan may write: a dashboard a trial left public can always be made
 *     private (a paid feature can always be switched off). Moving between
 *     the two public choices, and changing the password, works on every
 *     plan. The Sharing page's plan pill names a plan for exactly the moves
 *     the server refuses, and its dialog for a move off a choice the plan
 *     does not include names the plan coming back needs. The IP allowlist
 *     (Scale) is never part of a choice's write;
 *   - with billing off (every self-hosted install), no move is refused.
 *
 * The plans are read from SUBSCRIPTION_PLAN_* in the environment, which this
 * suite sets itself (and restores), so it does not depend on the config file
 * it runs with. Billing is pinned per test: CI's config.env turns it on.
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

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

const PLANS: ReadonlyArray<PlanType> = [
  PlanType.Free,
  PlanType.Growth,
  PlanType.Scale,
  PlanType.Enterprise,
];

const GROWTH_REFUSAL: string =
  "Please upgrade your plan to Growth to access this feature";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const DASHBOARD_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

// The states a dashboard can start in (what the server stores).
const START_STATES: Array<[string, DashboardAccessState]> = [
  [
    "a new, private dashboard",
    {
      isPublicDashboard: false,
      enableMasterPassword: false,
      hasMasterPassword: false,
    },
  ],
  [
    "a private dashboard with a password set but switched off",
    {
      isPublicDashboard: false,
      enableMasterPassword: false,
      hasMasterPassword: true,
    },
  ],
  [
    "a private dashboard with the switch on and a password set",
    {
      isPublicDashboard: false,
      enableMasterPassword: true,
      hasMasterPassword: true,
    },
  ],
  [
    "a private dashboard with the switch on and no password",
    {
      isPublicDashboard: false,
      enableMasterPassword: true,
      hasMasterPassword: false,
    },
  ],
  [
    "a public dashboard",
    {
      isPublicDashboard: true,
      enableMasterPassword: false,
      hasMasterPassword: false,
    },
  ],
  [
    "a public dashboard with a password set but switched off",
    {
      isPublicDashboard: true,
      enableMasterPassword: false,
      hasMasterPassword: true,
    },
  ],
  [
    "a password-protected dashboard",
    {
      isPublicDashboard: true,
      enableMasterPassword: true,
      hasMasterPassword: true,
    },
  ],
  [
    "a locked dashboard: the switch on and no password",
    {
      isPublicDashboard: true,
      enableMasterPassword: true,
      hasMasterPassword: false,
    },
  ],
];

// Every start state moved to every choice: [the start, the choice, its state].
const MOVES: Array<[string, DashboardAccess, DashboardAccessState]> =
  START_STATES.flatMap(
    ([label, state]: [string, DashboardAccessState]): Array<
      [string, DashboardAccess, DashboardAccessState]
    > => {
      return DASHBOARD_ACCESS_CHOICES.map(
        (
          to: DashboardAccess,
        ): [string, DashboardAccess, DashboardAccessState] => {
          return [label, to, state];
        },
      );
    },
  );

// A stored dashboard as the database hands it back.
const storedDashboard: (state: DashboardAccessState) => Dashboard = (
  state: DashboardAccessState,
): Dashboard => {
  const dashboard: Dashboard = new Dashboard();
  dashboard.id = DASHBOARD_ID;
  dashboard.projectId = PROJECT_ID;
  dashboard.isPublicDashboard = state.isPublicDashboard === true;
  dashboard.enableMasterPassword = state.enableMasterPassword === true;
  dashboard.isArchived = false;

  if (state.hasMasterPassword) {
    dashboard.masterPassword = new HashedString("stored-hash", true);
  }

  return dashboard;
};

/*
 * What the Sharing page sends for a move: the columns that change, and a
 * password when the move needs one.
 */
const writeFor: (
  from: DashboardAccessState,
  to: DashboardAccess,
) => Dashboard = (
  from: DashboardAccessState,
  to: DashboardAccess,
): Dashboard => {
  const data: Dashboard = new Dashboard();
  Object.assign(data, getDashboardAccessChanges({ from, to }));

  if (isDashboardPasswordNeededFor({ from, to })) {
    data.masterPassword = new HashedString("open sesame", false);
  }

  return data;
};

// The dashboard once the write lands, as the server then stores it.
const dashboardAfter: (
  from: DashboardAccessState,
  to: DashboardAccess,
) => Dashboard = (
  from: DashboardAccessState,
  to: DashboardAccess,
): Dashboard => {
  const dashboard: Dashboard = storedDashboard(from);
  const written: Dashboard = writeFor(from, to);

  if (written.isPublicDashboard !== undefined) {
    dashboard.isPublicDashboard = written.isPublicDashboard;
  }

  if (written.enableMasterPassword !== undefined) {
    dashboard.enableMasterPassword = written.enableMasterPassword;
  }

  if (written.masterPassword) {
    dashboard.masterPassword = new HashedString("new-hash", true);
  }

  return dashboard;
};

const stateOf: (dashboard: Dashboard) => DashboardAccessState = (
  dashboard: Dashboard,
): DashboardAccessState => {
  return {
    isPublicDashboard: dashboard.isPublicDashboard,
    enableMasterPassword: dashboard.enableMasterPassword,
    hasMasterPassword: Boolean(dashboard.masterPassword),
  };
};

const anonymousRequest: () => ExpressRequest = (): ExpressRequest => {
  return {
    cookies: {},
    headers: {},
    socket: {},
    ips: [],
  } as unknown as ExpressRequest;
};

// A visitor who entered the password (the cookie the password route sets).
const unlockedRequest: () => ExpressRequest = (): ExpressRequest => {
  const request: ExpressRequest = anonymousRequest();

  request.cookies[CookieUtil.getDashboardMasterPasswordKey(DASHBOARD_ID)] =
    JSONWebToken.signJsonPayload(
      {
        dashboardId: DASHBOARD_ID.toString(),
        type: DASHBOARD_MASTER_PASSWORD_COOKIE_IDENTIFIER,
      },
      900,
    );

  return request;
};

// A project owner on the given plan, as the API hands the props over.
const ownerOnPlan: (plan: PlanType) => DatabaseCommonInteractionProps = (
  plan: PlanType,
): DatabaseCommonInteractionProps => {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
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
    userId: USER_ID,
    tenantId: PROJECT_ID,
    currentPlan: plan,
    isSubscriptionUnpaid: false,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
};

// What the column check says about a write: "allowed", or its refusal.
const checkWrite: (data: Dashboard, plan: PlanType) => string = (
  data: Dashboard,
  plan: PlanType,
): string => {
  try {
    ColumnPermissions.checkDataColumnPermissions(
      Dashboard,
      data,
      ownerOnPlan(plan),
      DatabaseRequestType.Update,
    );

    return "allowed";
  } catch (err) {
    if (err instanceof PaymentRequiredException) {
      return err.message;
    }

    throw err;
  }
};

type ReadAccess = { hasReadAccess: boolean; error?: unknown };

const readAccess: (
  dashboard: Dashboard,
  request: ExpressRequest,
) => Promise<ReadAccess> = async (
  dashboard: Dashboard,
  request: ExpressRequest,
): Promise<ReadAccess> => {
  getJestSpyOn(DashboardService, "findOneById").mockResolvedValue(dashboard);

  return await DashboardService.hasReadAccess({
    dashboardId: DASHBOARD_ID,
    req: request,
  });
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
  setTestBillingEnabled(false);
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe.each([
  ["billing off (self-hosted)", false],
  ["billing on (OneUptime Cloud)", true],
])(
  "the server lets in whoever the choice says, %s",
  (_billing: string, isBillingEnabled: boolean) => {
    beforeEach(() => {
      setTestBillingEnabled(isBillingEnabled);
    });

    test.each(MOVES)(
      "%s, moved to %s",
      async (
        _label: string,
        to: DashboardAccess,
        from: DashboardAccessState,
      ) => {
        const dashboard: Dashboard = dashboardAfter(from, to);

        // The dashboard now reads as the choice made, and is never locked...
        expect(getDashboardAccess(stateOf(dashboard))).toBe(to);
        expect(isDashboardLockedWithoutPassword(stateOf(dashboard))).toBe(
          false,
        );

        // ...and the server enforces it, for a visitor with nothing...
        const anonymous: ReadAccess = await readAccess(
          dashboard,
          anonymousRequest(),
        );

        // ...and for one who entered the password.
        const unlocked: ReadAccess = await readAccess(
          dashboard,
          unlockedRequest(),
        );

        if (to === DashboardAccess.AnyoneWithLink) {
          expect(anonymous).toEqual({ hasReadAccess: true });
          expect(unlocked).toEqual({ hasReadAccess: true });
          return;
        }

        expect(anonymous.hasReadAccess).toBe(false);

        if (to === DashboardAccess.AnyoneWithPassword) {
          expect(anonymous.error).toBeInstanceOf(
            MasterPasswordRequiredException,
          );
          // The password lets a visitor in: the link is not locked.
          expect(unlocked).toEqual({ hasReadAccess: true });
          return;
        }

        // Only the project: the public link answers nobody, password or not.
        expect(anonymous.error).toBeInstanceOf(NotAuthenticatedException);
        expect(unlocked.hasReadAccess).toBe(false);
        expect(unlocked.error).toBeInstanceOf(NotAuthenticatedException);
      },
    );

    test("a locked dashboard (the switch on, no password) lets nobody in through its link, even with the unlock cookie", async () => {
      const locked: Dashboard = storedDashboard({
        isPublicDashboard: true,
        enableMasterPassword: true,
        hasMasterPassword: false,
      });

      for (const request of [anonymousRequest(), unlockedRequest()]) {
        const result: ReadAccess = await readAccess(locked, request);

        expect(result.hasReadAccess).toBe(false);
        expect(result.error).toBeInstanceOf(MasterPasswordRequiredException);
      }
    });

    test("Set Password on a locked dashboard (the password alone) opens it to visitors who enter it", async () => {
      const from: DashboardAccessState = {
        isPublicDashboard: true,
        enableMasterPassword: true,
        hasMasterPassword: false,
      };

      // Set Password writes the password, and no column of the choice.
      expect(
        getDashboardAccessChanges({
          from,
          to: DashboardAccess.AnyoneWithPassword,
        }),
      ).toEqual({});

      const dashboard: Dashboard = storedDashboard(from);
      dashboard.masterPassword = new HashedString("new-hash", true);

      expect(await readAccess(dashboard, unlockedRequest())).toEqual({
        hasReadAccess: true,
      });
      expect(
        (await readAccess(dashboard, anonymousRequest())).error,
      ).toBeInstanceOf(MasterPasswordRequiredException);
    });

    test("an archived dashboard's link answers nobody, whatever the choice", async () => {
      for (const to of DASHBOARD_ACCESS_CHOICES) {
        const dashboard: Dashboard = storedDashboard({
          isPublicDashboard: true,
          enableMasterPassword: false,
          hasMasterPassword: true,
        });
        Object.assign(
          dashboard,
          getDashboardAccessChanges({
            from: stateOf(dashboard),
            to,
          }),
        );
        dashboard.isArchived = true;

        const result: ReadAccess = await readAccess(
          dashboard,
          unlockedRequest(),
        );

        expect([to, result.hasReadAccess]).toEqual([to, false]);
        expect(result.error).toBeInstanceOf(NotAuthenticatedException);
      }
    });
  },
);

describe("on OneUptime Cloud, a move is refused below Growth exactly when it makes the dashboard public", () => {
  beforeEach(() => {
    setTestBillingEnabled(true);
  });

  test("isPublicDashboard is the one Growth-gated column a choice writes; the IP allowlist needs Scale", () => {
    const model: Dashboard = new Dashboard();

    expect(model.getColumnBillingAccessControl("isPublicDashboard")).toEqual(
      expect.objectContaining({ update: PlanType.Growth }),
    );
    expect(
      model.getColumnBillingAccessControl("enableMasterPassword"),
    ).toBeFalsy();
    expect(model.getColumnBillingAccessControl("masterPassword")).toBeFalsy();
    expect(model.getColumnBillingAccessControl("ipWhitelist")).toEqual(
      expect.objectContaining({ update: PlanType.Scale }),
    );
  });

  test.each(MOVES)(
    "%s, moved to %s",
    (_label: string, to: DashboardAccess, from: DashboardAccessState) => {
      const data: Dashboard = writeFor(from, to);
      const makesPublic: boolean = data.isPublicDashboard === true;

      // A choice never writes the IP allowlist, so its plan never stands in the way.
      expect(data.ipWhitelist).toBeUndefined();

      getJestSpyOn(ProjectUtil, "getCurrentPlan");

      for (const plan of PLANS) {
        const expected: string =
          plan === PlanType.Free && makesPublic ? GROWTH_REFUSAL : "allowed";

        expect([plan, checkWrite(data, plan)]).toEqual([plan, expected]);

        /*
         * The Sharing page names the plan on exactly the choices the server
         * would refuse: the plan pill and a locked choice, instead of a
         * dialog whose save fails.
         */
        (ProjectUtil.getCurrentPlan as unknown as jest.Mock).mockReturnValue(
          plan,
        );

        const getPlanNeeded: (
          column: string,
          value: unknown,
        ) => PlanType | null = (
          column: string,
          value: unknown,
        ): PlanType | null => {
          return getPlanNeededToWriteColumn(new Dashboard(), column, value);
        };

        const planNeeded: PlanType | null = getPlanNeededForDashboardAccess({
          from,
          to,
          getPlanNeeded,
        });

        expect([plan, planNeeded]).toEqual([
          plan,
          expected === "allowed" ? null : PlanType.Growth,
        ]);

        /*
         * A move off a public dashboard to "Only people in this project",
         * below Growth: allowed, and the dialog says sharing it again needs
         * Growth. Every other move says nothing of the kind.
         */
        const planToComeBack: PlanType | null =
          getPlanNeededToComeBackToDashboardAccess({ from, to, getPlanNeeded });

        const isLeavingPublic: boolean =
          getDashboardAccess(from) !== DashboardAccess.ProjectOnly &&
          to === DashboardAccess.ProjectOnly;

        expect([plan, planToComeBack]).toEqual([
          plan,
          plan === PlanType.Free && isLeavingPublic ? PlanType.Growth : null,
        ]);
      }
    },
  );

  test("stopping sharing a dashboard a trial left public works on Free; sharing it again does not", () => {
    const publicDashboard: DashboardAccessState = {
      isPublicDashboard: true,
      enableMasterPassword: true,
      hasMasterPassword: true,
    };

    const stop: Dashboard = writeFor(
      publicDashboard,
      DashboardAccess.ProjectOnly,
    );

    // Back to the defaults: private, and the password switch off.
    expect(stop.isPublicDashboard).toBe(false);
    expect(stop.enableMasterPassword).toBe(false);
    expect(checkWrite(stop, PlanType.Free)).toBe("allowed");

    // Sharing it again, from private, needs Growth - with a link or a password.
    const privateDashboard: DashboardAccessState = {
      isPublicDashboard: false,
      enableMasterPassword: false,
      hasMasterPassword: true,
    };

    for (const to of [
      DashboardAccess.AnyoneWithLink,
      DashboardAccess.AnyoneWithPassword,
    ]) {
      expect([
        to,
        checkWrite(writeFor(privateDashboard, to), PlanType.Free),
      ]).toEqual([to, GROWTH_REFUSAL]);
    }
  });

  test("a write that carries the public switch unchanged is refused below Growth too, which is why only changed columns are sent", () => {
    // A public dashboard saved as public again, with its password switch.
    const unchanged: Dashboard = new Dashboard();
    unchanged.isPublicDashboard = true;
    unchanged.enableMasterPassword = true;

    expect(checkWrite(unchanged, PlanType.Free)).toBe(GROWTH_REFUSAL);

    // What the Sharing page sends for the same move: the switch alone.
    const sent: Dashboard = writeFor(
      {
        isPublicDashboard: true,
        enableMasterPassword: false,
        hasMasterPassword: true,
      },
      DashboardAccess.AnyoneWithPassword,
    );

    expect(sent.isPublicDashboard).toBeUndefined();
    expect(sent.enableMasterPassword).toBe(true);
    expect(checkWrite(sent, PlanType.Free)).toBe("allowed");
  });

  test("setting or changing the password alone works on every plan", () => {
    const data: Dashboard = new Dashboard();
    data.masterPassword = new HashedString("a new one", false);

    for (const plan of PLANS) {
      expect([plan, checkWrite(data, plan)]).toEqual([plan, "allowed"]);
    }
  });

  test("the IP allowlist, saved on its own, needs Scale", () => {
    const data: Dashboard = new Dashboard();
    data.ipWhitelist = "203.0.113.7";

    expect(checkWrite(data, PlanType.Free)).not.toBe("allowed");
    expect(checkWrite(data, PlanType.Growth)).not.toBe("allowed");
    expect(checkWrite(data, PlanType.Scale)).toBe("allowed");
    expect(checkWrite(data, PlanType.Enterprise)).toBe("allowed");
  });
});

describe("on a self-hosted install (billing off), no move is refused", () => {
  test.each(MOVES)(
    "%s, moved to %s",
    (_label: string, to: DashboardAccess, from: DashboardAccessState) => {
      setTestBillingEnabled(false);

      for (const plan of PLANS) {
        expect([plan, checkWrite(writeFor(from, to), plan)]).toEqual([
          plan,
          "allowed",
        ]);
      }
    },
  );
});
