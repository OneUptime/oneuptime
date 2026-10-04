import BaseAPI from "../../../Server/API/BaseAPI";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import AuditLogService from "../../../Server/Services/AuditLogService";
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
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import StatusPageReportPeriodType from "../../../Types/StatusPage/StatusPageReportPeriodType";
import Timezone from "../../../Types/Timezone";
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
 * Status page email reports, as the dashboard and the API switch them on and
 * off - through the API's update route (BaseAPI.updateItem) and the real
 * update path of StatusPageService, permission and plan checks included.
 * Only the repository, the plan lookup and the side effects after a write
 * are stubbed.
 *
 * A status page's report schedule (when the first report goes out, how
 * often one follows it) had no defaults, so switching reports on meant
 * making one up, and the settings dialog asked for it even to switch
 * reports off. The dashboard's switch now sends `isReportEnabled` alone,
 * and the server fills in the default schedule for a page that has none:
 * every month, on the 1st at 09:00 in the report timezone, each report
 * covering the calendar month before it. A schedule the page has, or the
 * caller sends, is kept, and switching reports off writes the switch alone.
 *
 * "Now" is pinned at 4 Oct 2026, 12:00 UTC, so the default first report is
 * 1 Nov 2026 at 09:00 in the page's timezone.
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

const GROWTH_REFUSAL: string =
  "Please upgrade your plan to Growth to access this feature";

const NOW: Date = OneUptimeDate.fromString("2026-10-04T12:00:00.000Z");

const PROJECT_ID: ObjectID = new ObjectID(
  "1d000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("1d000000-0000-4000-8000-000000000002");
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "1d000000-0000-4000-8000-000000000003",
);
const OTHER_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "1d000000-0000-4000-8000-000000000004",
);

// One write to the repository, its dates and intervals read back as text.
interface Write {
  statusPageId: string;
  data: Record<string, unknown>;
}

type StoredPage = Partial<
  Pick<
    StatusPage,
    | "isReportEnabled"
    | "reportStartDateTime"
    | "reportRecurringInterval"
    | "reportTimezone"
    | "reportPeriodType"
    | "sendNextReportBy"
  >
>;

let currentPlan: PlanType = PlanType.Free;
let writes: Array<Write> = [];
// What the stored pages hold, by id.
let stored: Record<string, StoredPage> = {};

const api: BaseAPI<StatusPage, StatusPageServiceType> = new BaseAPI<
  StatusPage,
  StatusPageServiceType
>(StatusPage, StatusPageService);

function every(intervalType: EventInterval, intervalCount: number): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = intervalType;
  recurring.intervalCount = new PositiveNumber(intervalCount);
  return recurring;
}

// A write's value as text: dates as ISO strings, an interval as "1 Month".
function readable(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Recurring) {
    return value.toString();
  }

  if (value && typeof value === "object") {
    try {
      return Recurring.fromJSON(value as JSONObject).toString();
    } catch {
      return value;
    }
  }

  return value;
}

function readableWrite(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [column, value] of Object.entries(data)) {
    result[column] = readable(value);
  }

  return result;
}

// A project owner's request, as the API's auth middleware leaves it.
const ownerRequest: (data: JSONObject) => OneUptimeRequest = (
  data: JSONObject,
): OneUptimeRequest => {
  return {
    params: { id: STATUS_PAGE_ID.toString() },
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

// What the update route answers: "saved", or the refusal's message.
const put: (data: JSONObject) => Promise<string> = async (
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

// The page the API route writes, as the repository would hand it back.
function storedPage(id: string): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = id;
  page.projectId = PROJECT_ID;
  Object.assign(page, stored[id] || {});
  return page;
}

// The write to the one page the API route updates, readable.
function onlyWrite(): Record<string, unknown> {
  expect(writes).toHaveLength(1);
  expect(writes[0]!.statusPageId).toBe(STATUS_PAGE_ID.toString());
  return readableWrite(writes[0]!.data);
}

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
  currentPlan = PlanType.Free;
  writes = [];
  stored = {
    [STATUS_PAGE_ID.toString()]: {
      isReportEnabled: false,
      reportTimezone: Timezone.UTC,
      reportPeriodType: StatusPageReportPeriodType.Rolling,
    },
  };

  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(NOW.getTime());
  });

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

  /*
   * The stored pages: find() reads the ones its where names (every one,
   * for a query without an id), update() writes one.
   */
  getJestSpyOn(StatusPageService, "getRepository").mockReturnValue({
    find: async (options: {
      where?: Record<string, unknown>;
    }): Promise<Array<StatusPage>> => {
      const id: unknown = options?.where?.["_id"];

      if (typeof id === "string") {
        return stored[id] ? [storedPage(id)] : [];
      }

      return Object.keys(stored).map((pageId: string): StatusPage => {
        return storedPage(pageId);
      });
    },
    update: async (
      where: { _id: string },
      set: Record<string, unknown>,
    ): Promise<{ affected: number }> => {
      const written: Record<string, unknown> = { ...set };
      delete written["version"];
      writes.push({ statusPageId: where._id.toString(), data: written });
      return { affected: 1 };
    },
  } as never);

  getJestSpyOn(StatusPageService, "onTriggerWorkflow").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(StatusPageService, "onTriggerRealtime").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(AuditLogService, "recordUpdate").mockResolvedValue(
    undefined as never,
  );
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
  (Response.sendEmptySuccessResponse as jest.Mock).mockClear();
});

describe("switching reports on", () => {
  test("a page with no schedule gets the default one in the same write", async () => {
    expect(await put({ isReportEnabled: true })).toBe("saved");

    expect(onlyWrite()).toEqual({
      isReportEnabled: true,
      reportStartDateTime: "2026-11-01T09:00:00.000Z",
      reportRecurringInterval: "1 Month",
      reportPeriodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
      sendNextReportBy: "2026-11-01T09:00:00.000Z",
    });
  });

  test("the default first report is 09:00 in the page's report timezone", async () => {
    stored[STATUS_PAGE_ID.toString()]!.reportTimezone =
      Timezone.AmericaNew_York;

    expect(await put({ isReportEnabled: true })).toBe("saved");

    expect(onlyWrite()).toMatchObject({
      // 09:00 EST: New York is back on standard time on 1 Nov 2026.
      reportStartDateTime: "2026-11-01T14:00:00.000Z",
      sendNextReportBy: "2026-11-01T14:00:00.000Z",
    });
  });

  test("a page that already has a schedule keeps it; only its next send is worked out again", async () => {
    stored[STATUS_PAGE_ID.toString()] = {
      isReportEnabled: false,
      reportStartDateTime: OneUptimeDate.fromString("2026-01-05T08:00:00.000Z"),
      reportRecurringInterval: every(EventInterval.Week, 2),
      reportTimezone: Timezone.UTC,
      reportPeriodType: StatusPageReportPeriodType.Rolling,
      // Due while reports were off: switching them on must not send at once.
      sendNextReportBy: OneUptimeDate.fromString("2026-09-07T08:00:00.000Z"),
    };

    expect(await put({ isReportEnabled: true })).toBe("saved");

    expect(onlyWrite()).toEqual({
      isReportEnabled: true,
      sendNextReportBy: "2026-10-12T08:00:00.000Z",
    });
  });

  test("a schedule the caller sends with it is kept, through the API as through Terraform", async () => {
    expect(
      await put({
        isReportEnabled: true,
        reportStartDateTime: "2026-10-10T07:30:00.000Z",
        reportRecurringInterval: every(EventInterval.Day, 1).toJSON(),
        reportPeriodType: StatusPageReportPeriodType.Rolling,
        reportDataInDays: 1,
      }),
    ).toBe("saved");

    expect(onlyWrite()).toEqual({
      isReportEnabled: true,
      reportStartDateTime: "2026-10-10T07:30:00.000Z",
      reportRecurringInterval: "1 Day",
      reportPeriodType: StatusPageReportPeriodType.Rolling,
      reportDataInDays: 1,
      sendNextReportBy: "2026-10-10T07:30:00.000Z",
    });
  });
});

describe("switching reports off", () => {
  test("writes the switch alone, with no schedule", async () => {
    stored[STATUS_PAGE_ID.toString()]!.isReportEnabled = true;

    expect(await put({ isReportEnabled: false })).toBe("saved");

    expect(onlyWrite()).toEqual({ isReportEnabled: false });
  });

  test("keeps the schedule the page has, for when reports are switched on again", async () => {
    stored[STATUS_PAGE_ID.toString()] = {
      isReportEnabled: true,
      reportStartDateTime: OneUptimeDate.fromString("2026-11-01T09:00:00.000Z"),
      reportRecurringInterval: every(EventInterval.Month, 1),
      reportTimezone: Timezone.UTC,
    };

    expect(await put({ isReportEnabled: false })).toBe("saved");

    expect(onlyWrite()).toEqual({ isReportEnabled: false });
  });
});

describe("editing the schedule", () => {
  test("saves what the dialog sends and works the next send out from it", async () => {
    stored[STATUS_PAGE_ID.toString()] = {
      isReportEnabled: true,
      reportStartDateTime: OneUptimeDate.fromString("2026-11-01T09:00:00.000Z"),
      reportRecurringInterval: every(EventInterval.Month, 1),
      reportTimezone: Timezone.UTC,
      reportPeriodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
    };

    expect(
      await put({
        reportRecurringInterval: every(EventInterval.Week, 1).toJSON(),
        reportStartDateTime: "2026-10-05T09:00:00.000Z",
        reportTimezone: Timezone.AsiaKolkata,
        reportPeriodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
        reportDataInDays: 30,
      }),
    ).toBe("saved");

    expect(onlyWrite()).toEqual({
      reportRecurringInterval: "1 Week",
      reportStartDateTime: "2026-10-05T09:00:00.000Z",
      reportTimezone: Timezone.AsiaKolkata,
      reportPeriodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
      reportDataInDays: 30,
      sendNextReportBy: "2026-10-05T09:00:00.000Z",
    });
  });

  test("a first report date alone, while reports are off, is stored as sent - nothing is filled in", async () => {
    expect(await put({ reportStartDateTime: "2026-10-15T10:00:00.000Z" })).toBe(
      "saved",
    );

    expect(onlyWrite()).toEqual({
      reportStartDateTime: "2026-10-15T10:00:00.000Z",
    });
  });

  test("a write that does not touch reports carries no report column", async () => {
    expect(await put({ name: "Acme Status" })).toBe("saved");

    expect(onlyWrite()).toEqual({ name: "Acme Status" });
  });
});

describe("on OneUptime Cloud (billing on)", () => {
  test("switching reports on needs Growth, as before; from Growth up it saves with the default schedule", async () => {
    setTestBillingEnabled(true);

    for (const plan of PLANS) {
      currentPlan = plan;
      writes = [];

      const answer: string = await put({ isReportEnabled: true });
      const isAllowed: boolean = plan !== PlanType.Free;

      expect([plan, answer]).toEqual([
        plan,
        isAllowed ? "saved" : GROWTH_REFUSAL,
      ]);

      if (!isAllowed) {
        expect(writes).toEqual([]);
        continue;
      }

      expect([plan, onlyWrite()]).toEqual([
        plan,
        {
          isReportEnabled: true,
          reportStartDateTime: "2026-11-01T09:00:00.000Z",
          reportRecurringInterval: "1 Month",
          reportPeriodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
          sendNextReportBy: "2026-11-01T09:00:00.000Z",
        },
      ]);
    }
  });

  test("switching reports off writes the switch alone on every plan that may change it", async () => {
    setTestBillingEnabled(true);
    stored[STATUS_PAGE_ID.toString()]!.isReportEnabled = true;

    for (const plan of [PlanType.Growth, PlanType.Scale, PlanType.Enterprise]) {
      currentPlan = plan;
      writes = [];

      expect([plan, await put({ isReportEnabled: false })]).toEqual([
        plan,
        "saved",
      ]);
      expect([plan, onlyWrite()]).toEqual([plan, { isReportEnabled: false }]);
    }
  });
});

describe("on a self-hosted install (billing off)", () => {
  test("switching reports on and off saves on any plan the project was left on", async () => {
    setTestBillingEnabled(false);

    for (const plan of PLANS) {
      currentPlan = plan;
      stored[STATUS_PAGE_ID.toString()] = { isReportEnabled: false };

      writes = [];
      expect([plan, await put({ isReportEnabled: true })]).toEqual([
        plan,
        "saved",
      ]);
      expect(onlyWrite()["reportStartDateTime"]).toBe(
        "2026-11-01T09:00:00.000Z",
      );

      writes = [];
      expect([plan, await put({ isReportEnabled: false })]).toEqual([
        plan,
        "saved",
      ]);
      expect(onlyWrite()).toEqual({ isReportEnabled: false });
    }

    // The plan is never looked up: there is none to go by.
    expect(ProjectService.getCurrentPlan).not.toHaveBeenCalled();
  });
});

describe("an update that matches several pages (a workflow's Update Many)", () => {
  test("each page gets its own report columns: the default schedule where it has none, its own kept where it has one", async () => {
    stored = {
      [STATUS_PAGE_ID.toString()]: {
        isReportEnabled: false,
        reportTimezone: Timezone.UTC,
      },
      [OTHER_STATUS_PAGE_ID.toString()]: {
        isReportEnabled: false,
        reportStartDateTime: OneUptimeDate.fromString(
          "2026-01-05T08:00:00.000Z",
        ),
        reportRecurringInterval: every(EventInterval.Week, 2),
        reportTimezone: Timezone.UTC,
      },
    };

    const updated: number = await StatusPageService.updateBy({
      query: { projectId: PROJECT_ID },
      data: { isReportEnabled: true },
      skip: 0,
      limit: 10,
      props: { isRoot: true },
    });

    expect(updated).toBe(2);

    const byPage: Record<string, Array<Record<string, unknown>>> = {};

    for (const write of writes) {
      (byPage[write.statusPageId] ||= []).push(readableWrite(write.data));
    }

    // The switch, written to both, then each page's own columns.
    expect(byPage[STATUS_PAGE_ID.toString()]).toEqual([
      { isReportEnabled: true },
      {
        reportStartDateTime: "2026-11-01T09:00:00.000Z",
        reportRecurringInterval: "1 Month",
        reportPeriodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
        sendNextReportBy: "2026-11-01T09:00:00.000Z",
      },
    ]);
    expect(byPage[OTHER_STATUS_PAGE_ID.toString()]).toEqual([
      { isReportEnabled: true },
      { sendNextReportBy: "2026-10-12T08:00:00.000Z" },
    ]);
  });

  test("pages that need the same columns get them in the one write", async () => {
    stored = {
      [STATUS_PAGE_ID.toString()]: { isReportEnabled: false },
      [OTHER_STATUS_PAGE_ID.toString()]: { isReportEnabled: false },
    };

    await StatusPageService.updateBy({
      query: { projectId: PROJECT_ID },
      data: { isReportEnabled: true },
      skip: 0,
      limit: 10,
      props: { isRoot: true },
    });

    expect(writes).toHaveLength(2);

    for (const write of writes) {
      expect(readableWrite(write.data)).toEqual({
        isReportEnabled: true,
        reportStartDateTime: "2026-11-01T09:00:00.000Z",
        reportRecurringInterval: "1 Month",
        reportPeriodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
        sendNextReportBy: "2026-11-01T09:00:00.000Z",
      });
    }
  });
});

describe("creating a status page", () => {
  type OnBeforeCreate = (
    createBy: CreateBy<StatusPage>,
  ) => Promise<OnCreate<StatusPage>>;

  // The service's own create hook, as create() runs it.
  const beforeCreate: (page: StatusPage) => Promise<StatusPage> = async (
    page: StatusPage,
  ): Promise<StatusPage> => {
    page.projectId = PROJECT_ID;
    page.name = "Acme Status";
    // Set, so the hook does not look the project's monitor statuses up.
    page.downtimeMonitorStatuses = [];

    const hook: OnBeforeCreate = (
      StatusPageService as unknown as { onBeforeCreate: OnBeforeCreate }
    ).onBeforeCreate.bind(StatusPageService);

    const result: OnCreate<StatusPage> = await hook({
      data: page,
      props: { isRoot: true },
    });

    return result.createBy.data;
  };

  test("with reports on and no schedule, it gets the default one", async () => {
    const page: StatusPage = new StatusPage();
    page.isReportEnabled = true;
    page.reportTimezone = Timezone.AsiaKolkata;

    const created: StatusPage = await beforeCreate(page);

    expect(created.reportStartDateTime?.toISOString()).toBe(
      "2026-11-01T03:30:00.000Z",
    );
    expect(created.reportRecurringInterval?.toString()).toBe("1 Month");
    expect(created.reportPeriodType).toBe(
      StatusPageReportPeriodType.PreviousCalendarPeriod,
    );
    expect(created.sendNextReportBy?.toISOString()).toBe(
      "2026-11-01T03:30:00.000Z",
    );
  });

  test("with a schedule, it keeps it, and the worker knows when the first report is due", async () => {
    const page: StatusPage = new StatusPage();
    page.isReportEnabled = true;
    page.reportStartDateTime = OneUptimeDate.fromString(
      "2026-10-06T08:00:00.000Z",
    );
    page.reportRecurringInterval = every(EventInterval.Week, 1);

    const created: StatusPage = await beforeCreate(page);

    expect(created.reportStartDateTime?.toISOString()).toBe(
      "2026-10-06T08:00:00.000Z",
    );
    expect(created.reportRecurringInterval?.toString()).toBe("1 Week");
    expect(created.reportPeriodType).toBeUndefined();
    expect(created.sendNextReportBy?.toISOString()).toBe(
      "2026-10-06T08:00:00.000Z",
    );
  });

  test("with reports off, it gets no schedule", async () => {
    const created: StatusPage = await beforeCreate(new StatusPage());

    expect(created.reportStartDateTime).toBeUndefined();
    expect(created.reportRecurringInterval).toBeUndefined();
    expect(created.sendNextReportBy).toBeUndefined();
  });
});
