import BaseAPI from "../../../Server/API/BaseAPI";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DashboardService, {
  Service as DashboardServiceType,
} from "../../../Server/Services/DashboardService";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageService, {
  Service as StatusPageServiceType,
} from "../../../Server/Services/StatusPageService";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import Response from "../../../Server/Utils/Response";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { mockRouter } from "./Helpers";
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

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
  };
});

/*
 * A paid feature can always be switched off, on any plan - through the API's
 * update route (BaseAPI.updateItem) and the real update path of each
 * service, permission and plan checks included, with billing on as on
 * OneUptime Cloud. Only the repository, the plan lookup and the side effects
 * after a write are stubbed.
 *
 * A project whose Growth trial ended is on Free. What the trial left on
 * stays on - its status page keeps emailing reports, its dashboard keeps
 * its public link, its status page stays private - and before this, every
 * write that switched one of them off needed Growth, so nothing could be
 * switched off without upgrading. Now the default (the feature off) is
 * written on every plan, and switching the feature on still needs the plan:
 * the dashboard and the status page say so, Terraform and the API too.
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

const refusalFor: (plan: PlanType) => string = (plan: PlanType): string => {
  return `Please upgrade your plan to ${plan} to access this feature`;
};

const PROJECT_ID: ObjectID = new ObjectID(
  "6b000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("6b000000-0000-4000-8000-000000000002");
const RECORD_ID: ObjectID = new ObjectID(
  "6b000000-0000-4000-8000-000000000003",
);

let currentPlan: PlanType = PlanType.Free;
let writes: Array<Record<string, unknown>> = [];
let stored: Record<string, unknown> = {};

const dashboardApi: BaseAPI<Dashboard, DashboardServiceType> = new BaseAPI<
  Dashboard,
  DashboardServiceType
>(Dashboard, DashboardService);

const statusPageApi: BaseAPI<StatusPage, StatusPageServiceType> = new BaseAPI<
  StatusPage,
  StatusPageServiceType
>(StatusPage, StatusPageService);

// A project owner's request, as the API's auth middleware leaves it.
const ownerRequest: (data: JSONObject) => OneUptimeRequest = (
  data: JSONObject,
): OneUptimeRequest => {
  return {
    params: { id: RECORD_ID.toString() },
    body: { data: data },
    headers: {},
    userType: UserType.User,
    userAuthorization: { userId: USER_ID },
    tenantId: PROJECT_ID,
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
            scope: PermissionScope.All,
          },
        ],
      },
    },
  } as unknown as OneUptimeRequest;
};

const response: () => ExpressResponse = (): ExpressResponse => {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;
};

// What the update route answers: "saved", or the plan refusal's message.
const put: (
  api: BaseAPI<any, any>,
  data: JSONObject,
) => Promise<string> = async (
  api: BaseAPI<any, any>,
  data: JSONObject,
): Promise<string> => {
  try {
    await api.updateItem(ownerRequest(data), response());
    return "saved";
  } catch (err) {
    if (err instanceof PaymentRequiredException) {
      return err.message;
    }

    throw err;
  }
};

// The repository of a service: one stored record, every write recorded.
const stubRepository: (
  service: { getRepository: () => unknown },
  modelType: { new (): BaseModel },
) => void = (
  service: { getRepository: () => unknown },
  modelType: { new (): BaseModel },
): void => {
  getJestSpyOn(service as never, "getRepository").mockReturnValue({
    find: async (): Promise<Array<BaseModel>> => {
      const record: BaseModel = new modelType();
      record._id = RECORD_ID.toString();
      (record as unknown as Record<string, unknown>)["projectId"] = PROJECT_ID;
      Object.assign(record, stored);
      return [record];
    },
    update: async (
      _where: unknown,
      set: Record<string, unknown>,
    ): Promise<{ affected: number }> => {
      const written: Record<string, unknown> = { ...set };
      delete written["version"];
      writes.push(written);
      return { affected: 1 };
    },
  } as never);
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
  currentPlan = PlanType.Free;
  writes = [];
  stored = {};

  getJestSpyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  getJestSpyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });

  getJestSpyOn(ProjectService, "getCurrentPlan").mockImplementation(
    async (): Promise<{
      plan: PlanType | null;
      isSubscriptionUnpaid: boolean;
    }> => {
      return { plan: currentPlan, isSubscriptionUnpaid: false };
    },
  );

  stubRepository(DashboardService as never, Dashboard);
  stubRepository(StatusPageService as never, StatusPage);

  for (const service of [DashboardService, StatusPageService]) {
    getJestSpyOn(service as never, "onTriggerWorkflow").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(service as never, "onTriggerRealtime").mockResolvedValue(
      undefined as never,
    );
  }

  getJestSpyOn(AuditLogService, "recordUpdate").mockResolvedValue(
    undefined as never,
  );
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
  (Response.sendEmptySuccessResponse as jest.Mock).mockClear();
});

describe("a public dashboard, on a project now on Free", () => {
  beforeEach(() => {
    stored = { isPublicDashboard: true, enableMasterPassword: false };
  });

  test("is made private again: the switch alone is written", async () => {
    expect(await put(dashboardApi, { isPublicDashboard: false })).toBe("saved");
    expect(writes).toEqual([{ isPublicDashboard: false }]);
  });

  test("with its password switch, as the Sharing page's 'Only people in this project' writes it", async () => {
    stored = { isPublicDashboard: true, enableMasterPassword: true };

    expect(
      await put(dashboardApi, {
        isPublicDashboard: false,
        enableMasterPassword: false,
      }),
    ).toBe("saved");
    expect(writes).toEqual([
      { isPublicDashboard: false, enableMasterPassword: false },
    ]);
  });

  test("and its IP allowlist (Scale) can be emptied, on every plan", async () => {
    stored = { isPublicDashboard: true, ipWhitelist: "203.0.113.7" };

    for (const plan of PLANS) {
      currentPlan = plan;
      writes = [];

      for (const empty of [null, ""]) {
        expect([
          plan,
          empty,
          await put(dashboardApi, { ipWhitelist: empty }),
        ]).toEqual([plan, empty, "saved"]);
      }
    }
  });

  test("but cannot be shared again below Growth, nor an allowlist set below Scale", async () => {
    stored = { isPublicDashboard: false };

    for (const plan of PLANS) {
      currentPlan = plan;
      writes = [];

      const answer: string = await put(dashboardApi, {
        isPublicDashboard: true,
      });

      expect([plan, answer]).toEqual([
        plan,
        plan === PlanType.Free ? refusalFor(PlanType.Growth) : "saved",
      ]);

      if (plan === PlanType.Free) {
        expect(writes).toEqual([]);
      }

      writes = [];

      const allowlist: string = await put(dashboardApi, {
        ipWhitelist: "203.0.113.7",
      });

      expect([plan, allowlist]).toEqual([
        plan,
        plan === PlanType.Free || plan === PlanType.Growth
          ? refusalFor(PlanType.Scale)
          : "saved",
      ]);
    }
  });
});

describe("a status page a Growth trial left with paid features on, on a project now on Free", () => {
  test("email reports switch off", async () => {
    stored = { isReportEnabled: true };

    expect(await put(statusPageApi, { isReportEnabled: false })).toBe("saved");
    expect(writes).toEqual([{ isReportEnabled: false }]);
  });

  test("a private page can be made public again (anyone with the link)", async () => {
    stored = { isPublicStatusPage: false, enableMasterPassword: true };

    expect(
      await put(statusPageApi, {
        isPublicStatusPage: true,
        enableMasterPassword: false,
      }),
    ).toBe("saved");
    expect(writes).toEqual([
      { isPublicStatusPage: true, enableMasterPassword: false },
    ]);
  });

  test("subscriber channels, labels, branding, the uptime figure and the embedded badge switch off", async () => {
    stored = {
      enableSmsSubscribers: true,
      enableSlackSubscribers: true,
      enableMicrosoftTeamsSubscribers: true,
      enableWebhookSubscribers: true,
      allowSubscribersToChooseResources: true,
      allowSubscribersToChooseEventTypes: true,
      showIncidentLabelsOnStatusPage: true,
      hidePoweredByOneUptimeBranding: true,
      showOverallUptimePercentOnStatusPage: true,
      enableEmbeddedOverallStatus: true,
    };

    const off: JSONObject = {
      enableSmsSubscribers: false,
      enableSlackSubscribers: false,
      enableMicrosoftTeamsSubscribers: false,
      enableWebhookSubscribers: false,
      allowSubscribersToChooseResources: false,
      allowSubscribersToChooseEventTypes: false,
      showIncidentLabelsOnStatusPage: false,
      hidePoweredByOneUptimeBranding: false,
      showOverallUptimePercentOnStatusPage: false,
      enableEmbeddedOverallStatus: false,
    };

    // One at a time, as the switches save them...
    for (const [column, value] of Object.entries(off)) {
      writes = [];
      expect([column, await put(statusPageApi, { [column]: value })]).toEqual([
        column,
        "saved",
      ]);
    }

    // ...and all at once, as the API or Terraform may.
    writes = [];
    expect(await put(statusPageApi, off)).toBe("saved");
    expect(writes).toEqual([off]);
  });

  test("hidden sections show again: incidents, announcements, maintenance and the subscribe page", async () => {
    stored = {
      showIncidentsOnStatusPage: false,
      showAnnouncementsOnStatusPage: false,
      showScheduledMaintenanceEventsOnStatusPage: false,
      showSubscriberPageOnStatusPage: false,
      showEpisodesOnStatusPage: false,
    };

    expect(
      await put(statusPageApi, {
        showIncidentsOnStatusPage: true,
        showAnnouncementsOnStatusPage: true,
        showScheduledMaintenanceEventsOnStatusPage: true,
        showSubscriberPageOnStatusPage: true,
        showEpisodesOnStatusPage: true,
      }),
    ).toBe("saved");

    // Hiding one needs Growth.
    expect(await put(statusPageApi, { showIncidentsOnStatusPage: false })).toBe(
      refusalFor(PlanType.Growth),
    );
  });

  test("custom code is removed, and cannot be added back below Growth", async () => {
    stored = {
      headerHTML: "<div>hi</div>",
      footerHTML: "<div>bye</div>",
      customCSS: "body{}",
      customJavaScript: "console.log(1)",
    };

    for (const column of [
      "headerHTML",
      "footerHTML",
      "customCSS",
      "customJavaScript",
    ]) {
      for (const empty of ["", null]) {
        expect([
          column,
          empty,
          await put(statusPageApi, { [column]: empty }),
        ]).toEqual([column, empty, "saved"]);
      }

      expect([
        column,
        await put(statusPageApi, { [column]: "<b>again</b>" }),
      ]).toEqual([column, refusalFor(PlanType.Growth)]);
    }
  });

  test("an episode history kept longer than the default goes back to the default (14 days), and nowhere else", async () => {
    stored = { showEpisodeHistoryInDays: 30 };

    expect(await put(statusPageApi, { showEpisodeHistoryInDays: 14 })).toBe(
      "saved",
    );
    // The API takes a number column as text too; it is coerced first.
    expect(await put(statusPageApi, { showEpisodeHistoryInDays: "14" })).toBe(
      "saved",
    );
    expect(await put(statusPageApi, { showEpisodeHistoryInDays: 7 })).toBe(
      refusalFor(PlanType.Growth),
    );
  });

  /*
   * A switch is coerced first, as a number is: the text "false" is what
   * the database stores as off, so it switches the feature off like false,
   * on any plan - and is written as false. Switching it on as text still
   * needs the plan.
   */
  test.each([
    ['"false"', "false"],
    ['"no"', "no"],
    ['"off"', "off"],
    ['"0"', "0"],
    ["0", 0],
  ] as Array<[string, unknown]>)(
    "a switch written as %s is switched off like false, on any plan",
    async (_label: string, value: unknown) => {
      stored = { isReportEnabled: true };

      expect(
        await put(statusPageApi, { isReportEnabled: value } as JSONObject),
      ).toBe("saved");
      expect(writes).toEqual([{ isReportEnabled: false }]);
    },
  );

  test.each([
    ['"true"', "true"],
    ['"yes"', "yes"],
    ["1", 1],
  ] as Array<[string, unknown]>)(
    "written as %s it is switched on, which still needs the plan",
    async (_label: string, value: unknown) => {
      stored = { isReportEnabled: false };

      expect(
        await put(statusPageApi, { isReportEnabled: value } as JSONObject),
      ).toBe(refusalFor(PlanType.Growth));
      expect(writes).toEqual([]);
    },
  );

  test("a value the database would refuse is refused as such, before the plan is asked about it", async () => {
    stored = { isReportEnabled: true };

    await expect(
      put(statusPageApi, { isReportEnabled: "maybe" }),
    ).rejects.toThrow("isReportEnabled must be true or false.");
    expect(writes).toEqual([]);
  });
});

describe("on a self-hosted install (billing off)", () => {
  test("nothing asks for a plan, either way", async () => {
    setTestBillingEnabled(false);
    stored = { isPublicDashboard: false, isReportEnabled: false };

    expect(await put(dashboardApi, { isPublicDashboard: true })).toBe("saved");
    expect(await put(dashboardApi, { isPublicDashboard: false })).toBe("saved");
    expect(await put(statusPageApi, { isReportEnabled: true })).toBe("saved");
    expect(await put(statusPageApi, { isReportEnabled: false })).toBe("saved");

    expect(ProjectService.getCurrentPlan).not.toHaveBeenCalled();
  });
});
