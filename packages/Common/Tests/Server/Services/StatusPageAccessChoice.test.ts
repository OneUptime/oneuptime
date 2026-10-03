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
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageService from "../../../Server/Services/StatusPageService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressRequest } from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import MasterPasswordRequiredException from "../../../Types/Exception/MasterPasswordRequiredException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserTenantAccessPermission } from "../../../Types/Permission";
import { MASTER_PASSWORD_COOKIE_IDENTIFIER } from "../../../Types/StatusPage/MasterPassword";
import {
  getStatusPageAccess,
  getStatusPageAccessChanges,
  isStatusPagePasswordNeededFor,
  STATUS_PAGE_ACCESS_CHOICES,
  StatusPageAccess,
  StatusPageAccessState,
} from "../../../Types/StatusPage/StatusPageAccess";
import { getPlanNeededToChangeColumn } from "../../../UI/Components/ModelSwitch/ModelSwitchUtil";
import ProjectUtil from "../../../UI/Utils/Project";
import { getPlanNeededForAccess } from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageAccessCopy";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../Spy";

/*
 * Who can see a status page is one choice on its Access page (anyone with
 * the link, only people who sign in, anyone with the password). The page
 * writes a choice as the columns that change (Types/StatusPage/
 * StatusPageAccess). These pin, at the server, that what it writes is what
 * the choice says:
 *
 *   - the server's own read check (StatusPageService.hasReadAccess) lets
 *     anyone in, asks visitors to sign in, or asks for the password - the
 *     choice made - from every state a page can start in, and never leaves
 *     a page in a state it reads as another choice;
 *   - on OneUptime Cloud (billing on), the column check (ColumnPermission,
 *     which refuses a write that carries a plan-gated column, changed or
 *     not) refuses exactly the moves that change isPublicStatusPage below
 *     Growth - so moving between the two private choices works on every
 *     plan - and the dashboard's plan pill names a plan for exactly those
 *     moves;
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
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

// The states a status page can start in (what the server stores).
const START_STATES: Array<[string, StatusPageAccessState]> = [
  [
    "a new, public page",
    { isPublicStatusPage: true, enableMasterPassword: false, hasMasterPassword: false },
  ],
  [
    "a public page with a password switched on and set",
    { isPublicStatusPage: true, enableMasterPassword: true, hasMasterPassword: true },
  ],
  [
    "a public page with the switch on and no password",
    { isPublicStatusPage: true, enableMasterPassword: true, hasMasterPassword: false },
  ],
  [
    "a sign-in page",
    { isPublicStatusPage: false, enableMasterPassword: false, hasMasterPassword: false },
  ],
  [
    "a sign-in page with a password set but switched off",
    { isPublicStatusPage: false, enableMasterPassword: false, hasMasterPassword: true },
  ],
  [
    "a private page with the switch on and no password",
    { isPublicStatusPage: false, enableMasterPassword: true, hasMasterPassword: false },
  ],
  [
    "a password page",
    { isPublicStatusPage: false, enableMasterPassword: true, hasMasterPassword: true },
  ],
];

const MOVES: Array<[string, StatusPageAccessState, StatusPageAccess]> =
  START_STATES.flatMap(
    ([label, state]: [string, StatusPageAccessState]): Array<
      [string, StatusPageAccessState, StatusPageAccess]
    > => {
      return STATUS_PAGE_ACCESS_CHOICES.map(
        (
          to: StatusPageAccess,
        ): [string, StatusPageAccessState, StatusPageAccess] => {
          return [label, state, to];
        },
      );
    },
  );

// A stored page as the database hands it back.
const storedPage: (state: StatusPageAccessState) => StatusPage = (
  state: StatusPageAccessState,
): StatusPage => {
  const page: StatusPage = new StatusPage();
  page.id = STATUS_PAGE_ID;
  page.isPublicStatusPage = state.isPublicStatusPage === true;
  page.enableMasterPassword = state.enableMasterPassword === true;

  if (state.hasMasterPassword) {
    page.masterPassword = new HashedString("stored-hash", true);
  }

  return page;
};

/*
 * What the Access page sends for a move: the columns that change, and a
 * password when the move needs one.
 */
const writeFor: (
  from: StatusPageAccessState,
  to: StatusPageAccess,
) => StatusPage = (
  from: StatusPageAccessState,
  to: StatusPageAccess,
): StatusPage => {
  const data: StatusPage = new StatusPage();
  Object.assign(data, getStatusPageAccessChanges({ from, to }));

  if (isStatusPagePasswordNeededFor({ from, to })) {
    data.masterPassword = new HashedString("open sesame", false);
  }

  return data;
};

// The page once the write lands, as the server then stores it.
const pageAfter: (
  from: StatusPageAccessState,
  to: StatusPageAccess,
) => StatusPage = (
  from: StatusPageAccessState,
  to: StatusPageAccess,
): StatusPage => {
  const page: StatusPage = storedPage(from);
  const written: StatusPage = writeFor(from, to);

  if (written.isPublicStatusPage !== undefined) {
    page.isPublicStatusPage = written.isPublicStatusPage;
  }

  if (written.enableMasterPassword !== undefined) {
    page.enableMasterPassword = written.enableMasterPassword;
  }

  if (written.masterPassword) {
    page.masterPassword = new HashedString("new-hash", true);
  }

  return page;
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

  request.cookies[CookieUtil.getStatusPageMasterPasswordKey(STATUS_PAGE_ID)] =
    JSONWebToken.signJsonPayload(
      {
        statusPageId: STATUS_PAGE_ID.toString(),
        type: MASTER_PASSWORD_COOKIE_IDENTIFIER,
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
const checkWrite: (data: StatusPage, plan: PlanType) => string = (
  data: StatusPage,
  plan: PlanType,
): string => {
  try {
    ColumnPermissions.checkDataColumnPermissions(
      StatusPage,
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

describe("the server lets in whoever the choice says", () => {
  const readAccess: (
    page: StatusPage,
    request: ExpressRequest,
  ) => Promise<{ hasReadAccess: boolean; error?: unknown }> = async (
    page: StatusPage,
    request: ExpressRequest,
  ): Promise<{ hasReadAccess: boolean; error?: unknown }> => {
    getJestSpyOn(StatusPageService, "findOneById").mockResolvedValue(page);

    return await StatusPageService.hasReadAccess({
      statusPageId: STATUS_PAGE_ID,
      req: request,
    });
  };

  test.each(MOVES)(
    "%s, moved to %s",
    async (
      _label: string,
      from: StatusPageAccessState,
      to: StatusPageAccess,
    ) => {
      const page: StatusPage = pageAfter(from, to);

      // The page now reads as the choice made...
      expect(
        getStatusPageAccess({
          isPublicStatusPage: page.isPublicStatusPage,
          enableMasterPassword: page.enableMasterPassword,
          hasMasterPassword: Boolean(page.masterPassword),
        }),
      ).toBe(to);

      // ...and the server enforces it, for a visitor with nothing...
      const anonymous: { hasReadAccess: boolean; error?: unknown } =
        await readAccess(page, anonymousRequest());

      // ...and for one who entered the password.
      const unlocked: { hasReadAccess: boolean; error?: unknown } =
        await readAccess(page, unlockedRequest());

      if (to === StatusPageAccess.Anyone) {
        expect(anonymous).toEqual({ hasReadAccess: true });
        expect(unlocked).toEqual({ hasReadAccess: true });
        return;
      }

      expect(anonymous.hasReadAccess).toBe(false);

      if (to === StatusPageAccess.Password) {
        expect(anonymous.error).toBeInstanceOf(MasterPasswordRequiredException);
        expect(unlocked).toEqual({ hasReadAccess: true });
        return;
      }

      // Sign in: visitors are asked to sign in; a password lets nobody in.
      expect(anonymous.error).toBeInstanceOf(NotAuthenticatedException);
      expect(unlocked.hasReadAccess).toBe(false);
      expect(unlocked.error).toBeInstanceOf(NotAuthenticatedException);
    },
  );

  test("a private page with the switch on and no password asks visitors to sign in, not for a password", async () => {
    const result: { hasReadAccess: boolean; error?: unknown } =
      await readAccess(
        storedPage({
          isPublicStatusPage: false,
          enableMasterPassword: true,
          hasMasterPassword: false,
        }),
        anonymousRequest(),
      );

    expect(result.hasReadAccess).toBe(false);
    expect(result.error).toBeInstanceOf(NotAuthenticatedException);
  });
});

describe("on OneUptime Cloud, a move is refused below Growth exactly when it changes isPublicStatusPage", () => {
  beforeEach(() => {
    setTestBillingEnabled(true);
  });

  test("isPublicStatusPage is the one Growth-gated column a choice writes", () => {
    const model: StatusPage = new StatusPage();

    expect(model.getColumnBillingAccessControl("isPublicStatusPage")).toEqual(
      expect.objectContaining({ update: PlanType.Growth }),
    );
    expect(
      model.getColumnBillingAccessControl("enableMasterPassword"),
    ).toBeFalsy();
    expect(model.getColumnBillingAccessControl("masterPassword")).toBeFalsy();
    // The IP allowlist, under Advanced on the same page, needs Scale.
    expect(model.getColumnBillingAccessControl("ipWhitelist")).toEqual(
      expect.objectContaining({ update: PlanType.Scale }),
    );
  });

  test.each(MOVES)(
    "%s, moved to %s",
    (_label: string, from: StatusPageAccessState, to: StatusPageAccess) => {
      const data: StatusPage = writeFor(from, to);
      const changesPublic: boolean = data.isPublicStatusPage !== undefined;

      getJestSpyOn(ProjectUtil, "getCurrentPlan");

      for (const plan of PLANS) {
        const expected: string =
          plan === PlanType.Free && changesPublic ? GROWTH_REFUSAL : "allowed";

        expect([plan, checkWrite(data, plan)]).toEqual([plan, expected]);

        /*
         * The Access page names the plan on exactly the choices the server
         * would refuse: the plan pill and a locked choice, instead of a
         * dialog whose save fails.
         */
        (
          ProjectUtil.getCurrentPlan as unknown as jest.Mock
        ).mockReturnValue(plan);

        const planNeeded: PlanType | null = getPlanNeededForAccess({
          from,
          to,
          getPlanNeeded: (column: string): PlanType | null => {
            return getPlanNeededToChangeColumn(new StatusPage(), column);
          },
        });

        expect([plan, planNeeded]).toEqual([
          plan,
          expected === "allowed" ? null : PlanType.Growth,
        ]);
      }
    },
  );

  test("a write that carries the public switch unchanged is refused below Growth too, which is why only changed columns are sent", () => {
    // A private page saved as private again.
    const unchanged: StatusPage = new StatusPage();
    unchanged.isPublicStatusPage = false;
    unchanged.enableMasterPassword = true;

    expect(checkWrite(unchanged, PlanType.Free)).toBe(GROWTH_REFUSAL);

    // What the Access page sends for the same move: the switch alone.
    const sent: StatusPage = writeFor(
      {
        isPublicStatusPage: false,
        enableMasterPassword: false,
        hasMasterPassword: true,
      },
      StatusPageAccess.Password,
    );

    expect(sent.isPublicStatusPage).toBeUndefined();
    expect(checkWrite(sent, PlanType.Free)).toBe("allowed");
  });

  test("changing the password alone works on every plan", () => {
    const data: StatusPage = new StatusPage();
    data.masterPassword = new HashedString("a new one", false);

    for (const plan of PLANS) {
      expect([plan, checkWrite(data, plan)]).toEqual([plan, "allowed"]);
    }
  });
});

describe("on a self-hosted install (billing off), no move is refused", () => {
  test.each(MOVES)(
    "%s, moved to %s",
    (_label: string, from: StatusPageAccessState, to: StatusPageAccess) => {
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
