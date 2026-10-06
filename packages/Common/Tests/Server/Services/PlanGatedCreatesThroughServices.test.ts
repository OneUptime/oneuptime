import DashboardService from "../../../Server/Services/DashboardService";
import FormService from "../../../Server/Services/FormService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import logger from "../../../Server/Utils/Logger";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import Form from "../../../Models/DatabaseModels/Form";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../Spy";
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

/*
 * A setting a plan sells needs its plan on a create, through the services
 * that create status pages, dashboards and forms - the path every API,
 * Terraform and JSON-import create takes.
 *
 * Each create below runs StatusPageService / DashboardService /
 * FormService.create for real: the caller check before the hooks, the
 * service's own onBeforeCreate (which fills in a status page's report
 * schedule, a form's share key and default fields, a dashboard's layout),
 * then the create's permission check, whose column check asks each
 * plan-gated column's plan. Only reads the hooks make (the project's plan,
 * the free plan's counts, the project's monitor statuses) and the
 * repository are stubbed. Nothing is saved: the repository's save answers
 * REACHED_SAVE, which is how a create that passed every check shows here.
 *
 * Pinned:
 *   - below the plan, a create with a paid setting on is refused with the
 *     plan's name, before anything is saved;
 *   - with the setting left alone, or at its default, the same create goes
 *     through on every plan;
 *   - at the plan it goes through - including the report schedule the
 *     status page service fills in when reports are switched on;
 *   - with billing off (self-hosted), nothing is asked.
 *
 * Existing records are not touched by any of this: only creates are
 * checked, and an update of a record a trial left with a feature on still
 * may switch it off (PlanGatedTurnOff.test.ts).
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

const PLANS: ReadonlyArray<PlanType> = [
  PlanType.Free,
  PlanType.Growth,
  PlanType.Scale,
  PlanType.Enterprise,
];

const REACHED_SAVE: string = "REACHED_SAVE";

const refusalFor: (plan: PlanType) => string = (plan: PlanType): string => {
  return `Please upgrade your plan to ${plan} to access this feature`;
};

const PROJECT_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("5e000000-0000-4000-8000-000000000002");

// A project owner on a plan, as CommonAPI builds the props for a request.
const ownerOnPlan: (plan: PlanType) => DatabaseCommonInteractionProps = (
  plan: PlanType,
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
            permission: Permission.ProjectOwner,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      } as UserTenantAccessPermission,
    },
  };
};

let plan: PlanType = PlanType.Free;
let saved: Array<Record<string, unknown>> = [];

// What a create through a service ends in: its refusal, or REACHED_SAVE.
const outcome: (create: () => Promise<unknown>) => Promise<string> = async (
  create: () => Promise<unknown>,
): Promise<string> => {
  try {
    await create();
    return "created";
  } catch (err) {
    return (err as Error).message;
  }
};

const createStatusPage: (
  onPlan: PlanType,
  settings: Record<string, unknown>,
) => Promise<string> = async (
  onPlan: PlanType,
  settings: Record<string, unknown>,
): Promise<string> => {
  plan = onPlan;

  const page: StatusPage = new StatusPage();
  page.name = "Customer status";
  page.projectId = PROJECT_ID;

  for (const [column, value] of Object.entries(settings)) {
    page.setColumnValue(column, value);
  }

  return outcome(() => {
    return StatusPageService.create({
      data: page,
      props: ownerOnPlan(onPlan),
    });
  });
};

const createDashboard: (
  onPlan: PlanType,
  settings: Record<string, unknown>,
) => Promise<string> = async (
  onPlan: PlanType,
  settings: Record<string, unknown>,
): Promise<string> => {
  plan = onPlan;

  const dashboard: Dashboard = new Dashboard();
  dashboard.name = "Service health";
  dashboard.projectId = PROJECT_ID;

  for (const [column, value] of Object.entries(settings)) {
    dashboard.setColumnValue(column, value);
  }

  return outcome(() => {
    return DashboardService.create({
      data: dashboard,
      props: ownerOnPlan(onPlan),
    });
  });
};

const createForm: (
  onPlan: PlanType,
  settings: Record<string, unknown>,
) => Promise<string> = async (
  onPlan: PlanType,
  settings: Record<string, unknown>,
): Promise<string> => {
  plan = onPlan;

  const form: Form = new Form();
  form.name = "Bug report";
  form.projectId = PROJECT_ID;

  for (const [column, value] of Object.entries(settings)) {
    form.setColumnValue(column, value);
  }

  return outcome(() => {
    return FormService.create({
      data: form,
      props: ownerOnPlan(onPlan),
    });
  });
};

const stubRepository: (service: {
  getRepository: () => unknown;
}) => void = (service: { getRepository: () => unknown }): void => {
  getJestSpyOn(service, "getRepository").mockReturnValue({
    save: async (row: Record<string, unknown>): Promise<never> => {
      saved.push(row);
      throw new Error(REACHED_SAVE);
    },
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
  setTestBillingEnabled(true);
  saved = [];

  getJestSpyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });

  // The project's plan, as the status page service reads it for its count.
  getJestSpyOn(ProjectService, "getCurrentPlan").mockImplementation(
    async (): Promise<never> => {
      return { plan, isSubscriptionUnpaid: false } as never;
    },
  );

  // A project with no status pages or dashboards yet: the free plan's caps allow one.
  for (const service of [StatusPageService, DashboardService, FormService]) {
    getJestSpyOn(service, "countBy").mockResolvedValue(
      new PositiveNumber(0) as never,
    );
  }

  getJestSpyOn(MonitorStatusService, "findBy").mockResolvedValue([] as never);

  stubRepository(StatusPageService as never);
  stubRepository(DashboardService as never);
  stubRepository(FormService as never);
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("on OneUptime Cloud (billing on), StatusPageService.create", () => {
  test.each(PLANS)(
    "a status page the way the dashboard creates one (a name) is created on %s",
    async (onPlan: PlanType) => {
      expect(await createStatusPage(onPlan, {})).toBe(REACHED_SAVE);
      expect(saved).toHaveLength(1);
    },
  );

  test.each([
    ["private", { isPublicStatusPage: false }],
    ["with custom CSS", { customCSS: "body { color: #111827; }" }],
    ["with custom JavaScript", { customJavaScript: "console.log('acme');" }],
    ["with a custom header", { headerHTML: "<div>Acme</div>" }],
    ["with SMS subscribers", { enableSmsSubscribers: true }],
    ["with email reports on", { isReportEnabled: true }],
    ["with a report time zone", { reportTimezone: "America/New_York" }],
    ["hiding its incidents", { showIncidentsOnStatusPage: false }],
    ["with incident labels shown", { showIncidentLabelsOnStatusPage: true }],
    ["with the embedded status badge", { enableEmbeddedOverallStatus: true }],
  ] as Array<[string, Record<string, unknown>]>)(
    "a status page created %s is refused on Free naming Growth, and nothing is saved",
    async (_name: string, settings: Record<string, unknown>) => {
      expect(await createStatusPage(PlanType.Free, settings)).toBe(
        refusalFor(PlanType.Growth),
      );
      expect(saved).toHaveLength(0);
    },
  );

  test.each([
    ["with Slack subscribers", { enableSlackSubscribers: true }],
    ["with webhook subscribers", { enableWebhookSubscribers: true }],
    ["without the Powered by line", { hidePoweredByOneUptimeBranding: true }],
    ["with an IP allowlist", { ipWhitelist: "10.0.0.0/8" }],
    [
      "with the overall uptime percent shown",
      { showOverallUptimePercentOnStatusPage: true },
    ],
    [
      "letting subscribers choose resources",
      { allowSubscribersToChooseResources: true },
    ],
    ["requiring SSO", { requireSsoForLogin: true }],
  ] as Array<[string, Record<string, unknown>]>)(
    "a status page created %s is refused on Growth naming Scale, and created on Scale",
    async (_name: string, settings: Record<string, unknown>) => {
      expect(await createStatusPage(PlanType.Growth, settings)).toBe(
        refusalFor(PlanType.Scale),
      );
      expect(saved).toHaveLength(0);

      expect(await createStatusPage(PlanType.Scale, settings)).toBe(
        REACHED_SAVE,
      );
      expect(saved).toHaveLength(1);
    },
  );

  test("a status page created with every paid setting at its default is created on Free", async () => {
    expect(
      await createStatusPage(PlanType.Free, {
        isPublicStatusPage: true,
        showIncidentsOnStatusPage: true,
        showAnnouncementsOnStatusPage: true,
        showScheduledMaintenanceEventsOnStatusPage: true,
        showSubscriberPageOnStatusPage: true,
        showEpisodesOnStatusPage: true,
        showEpisodeHistoryInDays: 14,
        isReportEnabled: false,
        reportDataInDays: 30,
        enableSmsSubscribers: false,
        enableSlackSubscribers: false,
        hidePoweredByOneUptimeBranding: false,
        customCSS: "",
        headerHTML: null,
        ipWhitelist: "",
        requireSsoForLogin: false,
      }),
    ).toBe(REACHED_SAVE);
  });

  test("a status page created with email reports on, on Growth, is saved with the schedule the service fills in", async () => {
    expect(
      await createStatusPage(PlanType.Growth, { isReportEnabled: true }),
    ).toBe(REACHED_SAVE);

    const row: Record<string, unknown> = saved[0] as Record<string, unknown>;

    expect(row["isReportEnabled"]).toBe(true);
    expect(row["reportStartDateTime"]).toBeInstanceOf(Date);
    expect(row["sendNextReportBy"]).toBeInstanceOf(Date);
    expect(
      (row["reportRecurringInterval"] as unknown as { toJSON: () => JSONObject })
        .toJSON,
    ).toBeDefined();
  });

  test("on Free, the same create with reports on is refused before the service's schedule is saved", async () => {
    expect(
      await createStatusPage(PlanType.Free, {
        isReportEnabled: true,
        reportRecurringInterval: {
          _type: "Recurring",
          value: { intervalType: "Month", intervalCount: 1 },
        },
      }),
    ).toBe(refusalFor(PlanType.Growth));
    expect(saved).toHaveLength(0);
  });
});

describe("on OneUptime Cloud (billing on), DashboardService.create", () => {
  test.each(PLANS)(
    "a dashboard the way the dashboard creates one (a name) is created on %s",
    async (onPlan: PlanType) => {
      expect(await createDashboard(onPlan, {})).toBe(REACHED_SAVE);
    },
  );

  test("a dashboard created public is refused on Free naming Growth, and created on Growth", async () => {
    expect(
      await createDashboard(PlanType.Free, { isPublicDashboard: true }),
    ).toBe(refusalFor(PlanType.Growth));
    expect(saved).toHaveLength(0);

    expect(
      await createDashboard(PlanType.Growth, { isPublicDashboard: true }),
    ).toBe(REACHED_SAVE);
  });

  test("a dashboard created with an IP allowlist is refused on Growth naming Scale, and created on Scale", async () => {
    const settings: Record<string, unknown> = {
      isPublicDashboard: true,
      ipWhitelist: "203.0.113.7",
    };

    expect(await createDashboard(PlanType.Growth, settings)).toBe(
      refusalFor(PlanType.Scale),
    );
    expect(await createDashboard(PlanType.Scale, settings)).toBe(REACHED_SAVE);
  });

  test("a dashboard created private, with no IP allowlist, is created on Free", async () => {
    expect(
      await createDashboard(PlanType.Free, {
        isPublicDashboard: false,
        ipWhitelist: "",
      }),
    ).toBe(REACHED_SAVE);
  });
});

describe("on OneUptime Cloud (billing on), FormService.create", () => {
  test("a form (sold on Growth) created with an IP allowlist is refused on Growth naming Scale, and created on Scale", async () => {
    expect(
      await createForm(PlanType.Growth, { ipWhitelist: "203.0.113.0/24" }),
    ).toBe(refusalFor(PlanType.Scale));
    expect(saved).toHaveLength(0);

    expect(
      await createForm(PlanType.Scale, { ipWhitelist: "203.0.113.0/24" }),
    ).toBe(REACHED_SAVE);
  });

  test("a form created without an IP allowlist, or with an empty one, is created on Growth", async () => {
    expect(await createForm(PlanType.Growth, {})).toBe(REACHED_SAVE);
    expect(await createForm(PlanType.Growth, { ipWhitelist: "" })).toBe(
      REACHED_SAVE,
    );
  });

  test("on Free a form is refused by its own table, naming Growth", async () => {
    expect(await createForm(PlanType.Free, {})).toBe(
      refusalFor(PlanType.Growth),
    );
  });
});

describe("on a self-hosted install (billing off)", () => {
  beforeEach(() => {
    setTestBillingEnabled(false);
  });

  test("a status page, a dashboard and a form are created with paid settings on, whatever plan the props carry", async () => {
    expect(
      await createStatusPage(PlanType.Free, {
        isPublicStatusPage: false,
        customCSS: "body { margin: 0; }",
        enableSlackSubscribers: true,
        isReportEnabled: true,
      }),
    ).toBe(REACHED_SAVE);
    expect(
      await createDashboard(PlanType.Free, {
        isPublicDashboard: true,
        ipWhitelist: "203.0.113.7",
      }),
    ).toBe(REACHED_SAVE);
    expect(
      await createForm(PlanType.Free, { ipWhitelist: "203.0.113.0/24" }),
    ).toBe(REACHED_SAVE);
  });
});
