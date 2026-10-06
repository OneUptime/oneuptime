import { mockRouter } from "./Helpers";
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

/*
 * POST and PUT /workspace-notification-summary with a time zone, or
 * without one: a workspace summary - the recurring incident, alert or
 * episode summary posted to Slack or Microsoft Teams - goes out at the same
 * time of day all year, on its own time zone's clock.
 *
 * Through the API's create and update routes (BaseAPI.createItem,
 * updateItem) and the real create and update path of
 * WorkspaceNotificationSummaryService, permission and plan checks included.
 * Only the repository, the project lookups, the plan and the side effects
 * after a write are stubbed, and the time zone in a person's profile.
 *
 * The API default: a summary created without a time zone takes the time
 * zone in the creator's profile when a person creates it, and UTC when an
 * API key does (no person, no profile) - 09:00 its first summary goes out at
 * is read there. A name that is not a time zone is refused with a message
 * that says how to send one, before anything is written.
 *
 * "Now" is Monday 5 Oct 2026, 12:00 UTC: 14:00 in Berlin, 08:00 in New York.
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

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
    },
  };
});

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import AuditLogService from "../../../Server/Services/AuditLogService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceNotificationSummaryService, {
  Service as WorkspaceNotificationSummaryServiceType,
} from "../../../Server/Services/WorkspaceNotificationSummaryService";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceNotificationSummary from "../../../Models/DatabaseModels/WorkspaceNotificationSummary";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import Timezone from "../../../Types/Timezone";
import UserType from "../../../Types/UserType";
import WorkspaceNotificationSummaryItem from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryItem";
import WorkspaceNotificationSummaryType from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

const NOW: Date = OneUptimeDate.fromString("2026-10-05T12:00:00.000Z");

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-b51c-4aaa-8bbb-000000000001",
);
const PERSON_ID: ObjectID = new ObjectID(
  "0193c0de-b51c-4aaa-8bbb-000000000002",
);
const SUMMARY_ID: string = "0193c0de-b51c-4aaa-8bbb-0000000000d1";

// Run once with billing off (self-hosted) and once on, on the Growth plan.
const BILLING: ReadonlyArray<[string, boolean]> = [
  ["billing off (self-hosted)", false],
  ["billing on, on the Growth plan", true],
];

// What a principal holds in the project.
function accessWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps["userTenantAccessPermission"] {
  return {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: permissions.map((permission: Permission): UserPermission => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: false,
        };
      }),
    },
  };
}

// A person signed in to the project. Fresh per call.
function person(): DatabaseCommonInteractionProps {
  return {
    userId: PERSON_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: accessWith([Permission.ProjectAdmin]),
  };
}

// An API key of the project: no person behind it. Fresh per call.
function apiKey(): DatabaseCommonInteractionProps {
  return {
    userType: UserType.API,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: accessWith([
      Permission.CreateWorkspaceNotificationSummary,
      Permission.EditWorkspaceNotificationSummary,
      Permission.ReadWorkspaceNotificationSummary,
    ]),
  };
}

function every(intervalType: EventInterval, intervalCount: number): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = intervalType;
  recurring.intervalCount = new PositiveNumber(intervalCount);
  return recurring;
}

// A summary as the API documents it, without a schedule of its own.
function newSummary(): JSONObject {
  return {
    projectId: PROJECT_ID.toString(),
    name: "Weekly Incident Summary",
    workspaceType: WorkspaceType.Slack,
    summaryType: WorkspaceNotificationSummaryType.Incident,
    channelNames: ["#incidents"],
    summaryItems: [WorkspaceNotificationSummaryItem.All],
    numberOfDaysOfData: 7,
    isEnabled: true,
  };
}

// The members of the service these tests stub that its type keeps private.
interface StubbableService {
  getRepository: () => unknown;
  onCreateSuccess: (...args: Array<unknown>) => Promise<unknown>;
  onTriggerWorkflow: (...args: Array<unknown>) => Promise<unknown>;
  onTriggerRealtime: (...args: Array<unknown>) => Promise<unknown>;
}

const service: StubbableService =
  WorkspaceNotificationSummaryService as unknown as StubbableService;

const api: BaseAPI<
  WorkspaceNotificationSummary,
  WorkspaceNotificationSummaryServiceType
> = new BaseAPI<
  WorkspaceNotificationSummary,
  WorkspaceNotificationSummaryServiceType
>(WorkspaceNotificationSummary, WorkspaceNotificationSummaryService);

let caller: DatabaseCommonInteractionProps;
let profileTimezone: string | null = null;
let repositorySave: MockFunction;
// What the stored summary holds, for an update.
let storedSummary: Record<string, unknown> = {};
let updates: Array<Record<string, unknown>> = [];

function response(): ExpressResponse {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;
}

async function post(data: JSONObject): Promise<void> {
  const request: ExpressRequest = {
    params: {},
    body: { data: data },
    headers: {},
  } as unknown as ExpressRequest;

  await api.createItem(request, response());
}

async function put(data: JSONObject): Promise<void> {
  const request: ExpressRequest = {
    params: { id: SUMMARY_ID },
    body: { data: data },
    headers: {},
  } as unknown as ExpressRequest;

  await api.updateItem(request, response());
}

// The row the one save was handed.
function saved(): WorkspaceNotificationSummary {
  expect(repositorySave).toHaveBeenCalledTimes(1);
  return repositorySave.mock.calls[0]![0] as WorkspaceNotificationSummary;
}

function iso(value: unknown): string | undefined {
  return value instanceof Date
    ? value.toISOString()
    : value
      ? OneUptimeDate.fromString(value as string).toISOString()
      : undefined;
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

  setTestBillingEnabled(false);
});

beforeEach(() => {
  setTestBillingEnabled(false);
  caller = person();
  profileTimezone = null;
  storedSummary = {};
  updates = [];

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation((async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    }) as never);

  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockImplementation(
    (): Date => {
      return new Date(NOW.getTime());
    },
  );

  getJestSpyOn(ProjectService, "getCurrentPlan").mockImplementation(
    async (): Promise<{
      plan: PlanType | null;
      isSubscriptionUnpaid: boolean;
    }> => {
      return { plan: PlanType.Growth, isSubscriptionUnpaid: false };
    },
  );

  stubProjectDirectory({ projectId: PROJECT_ID });

  // The person's profile: the time zone the dashboard saved for them.
  getJestSpyOn(UserService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }): Promise<User | null> => {
    if (data.id.toString() !== PERSON_ID.toString()) {
      return null;
    }

    const user: User = new User();
    user._id = PERSON_ID.toString();
    (user as unknown as { timezone: string | null }).timezone =
      profileTimezone;
    return user;
  }) as never);

  repositorySave = getJestMockFunction();
  repositorySave.mockImplementation((async (
    item: WorkspaceNotificationSummary,
  ) => {
    item._id = SUMMARY_ID;
    return item;
  }) as never);

  getJestSpyOn(service, "getRepository").mockReturnValue({
    save: repositorySave,
    find: async (): Promise<Array<WorkspaceNotificationSummary>> => {
      const summary: WorkspaceNotificationSummary =
        new WorkspaceNotificationSummary();
      summary._id = SUMMARY_ID;
      summary.projectId = PROJECT_ID;
      Object.assign(summary, storedSummary);
      return [summary];
    },
    update: async (
      _where: unknown,
      set: Record<string, unknown>,
    ): Promise<{ affected: number }> => {
      const written: Record<string, unknown> = { ...set };
      delete written["version"];
      updates.push(written);
      return { affected: 1 };
    },
  } as never);

  getJestSpyOn(service, "onCreateSuccess").mockImplementation((async (
    _onCreate: unknown,
    createdItem: WorkspaceNotificationSummary,
  ): Promise<WorkspaceNotificationSummary> => {
    return createdItem;
  }) as never);
  getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(AuditLogService, "recordCreate").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(AuditLogService, "recordUpdate").mockResolvedValue(
    undefined as never,
  );

  (Response.sendEntityResponse as unknown as MockFunction).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(BILLING)(
  "POST /workspace-notification-summary, %s",
  (_billing: string, isBillingEnabled: boolean) => {
    beforeEach(() => {
      setTestBillingEnabled(isBillingEnabled);
    });

    test("an API key that names no time zone gets UTC, and the first summary at 09:00 UTC next Monday", async () => {
      caller = apiKey();

      await post(newSummary());

      const summary: WorkspaceNotificationSummary = saved();
      expect(summary.timezone).toBe(Timezone.UTC);
      expect(iso(summary.sendFirstReportAt)).toBe("2026-10-12T09:00:00.000Z");
      expect(iso(summary.nextSendAt)).toBe("2026-10-12T09:00:00.000Z");
      // No person: no profile is read.
      expect(UserService.findOneById).not.toHaveBeenCalled();
    });

    test("a person who names no time zone gets the one in their profile, and 09:00 there", async () => {
      profileTimezone = "Europe/Berlin";

      await post(newSummary());

      const summary: WorkspaceNotificationSummary = saved();
      expect(summary.timezone).toBe("Europe/Berlin");
      // Next Monday, 09:00 CEST.
      expect(iso(summary.sendFirstReportAt)).toBe("2026-10-12T07:00:00.000Z");
      expect(iso(summary.nextSendAt)).toBe("2026-10-12T07:00:00.000Z");
    });

    test("a person with no time zone in their profile gets UTC", async () => {
      await post(newSummary());

      expect(saved().timezone).toBe(Timezone.UTC);
    });

    test("a time zone the caller names is kept as it was sent, and 09:00 is read there", async () => {
      caller = apiKey();

      await post({ ...newSummary(), timezone: "America/New_York" });

      const summary: WorkspaceNotificationSummary = saved();
      expect(summary.timezone).toBe("America/New_York");
      // This Monday, 09:00 EDT: it is 08:00 in New York.
      expect(iso(summary.sendFirstReportAt)).toBe("2026-10-05T13:00:00.000Z");
    });

    test("a legacy name the caller sends is kept as sent: it is what they read back", async () => {
      caller = apiKey();

      await post({ ...newSummary(), timezone: "US/Eastern" });

      expect(saved().timezone).toBe("US/Eastern");
    });

    test("a first summary sent with a time zone keeps its time of day there after the clocks change", async () => {
      caller = apiKey();
      getJestSpyOn(OneUptimeDate, "getCurrentDate").mockImplementation(
        (): Date => {
          return OneUptimeDate.fromString("2026-10-28T12:00:00.000Z");
        },
      );

      await post({
        ...newSummary(),
        timezone: "Europe/Berlin",
        recurringInterval: every(EventInterval.Week, 1).toJSON(),
        sendFirstReportAt: "2026-09-07T07:00:00.000Z",
      });

      // Mon 2 Nov at 09:00 CET, not 08:00.
      expect(iso(saved().nextSendAt)).toBe("2026-11-02T08:00:00.000Z");
    });

    test.each([
      ["a made-up zone", "Mars/Olympus_Mons"],
      ["an offset", "GMT+2"],
      ["an empty name", ""],
    ])(
      "%s is refused before anything is written, with how to send one",
      async (_what: string, timezone: string) => {
        caller = apiKey();

        await expect(post({ ...newSummary(), timezone: timezone })).rejects.toThrow(
          BadDataException,
        );
        await expect(post({ ...newSummary(), timezone: timezone })).rejects.toThrow(
          'timezone is not a time zone. Send an IANA time zone name, such as "Europe/Berlin", "America/New_York" or "UTC".',
        );
        expect(repositorySave).not.toHaveBeenCalled();
      },
    );
  },
);

describe.each(BILLING)(
  "PUT /workspace-notification-summary/:id, %s",
  (_billing: string, isBillingEnabled: boolean) => {
    beforeEach(() => {
      setTestBillingEnabled(isBillingEnabled);
      caller = apiKey();
      getJestSpyOn(OneUptimeDate, "getCurrentDate").mockImplementation(
        (): Date => {
          return OneUptimeDate.fromString("2026-10-28T12:00:00.000Z");
        },
      );
      // Mondays at 09:00 CEST since 7 Sep, stepped in UTC: 08:00 CET next.
      storedSummary = {
        recurringInterval: every(EventInterval.Week, 1),
        sendFirstReportAt: OneUptimeDate.fromString("2026-09-07T07:00:00.000Z"),
        nextSendAt: OneUptimeDate.fromString("2026-11-02T07:00:00.000Z"),
        isEnabled: true,
        timezone: Timezone.UTC,
      };
    });

    test("a new time zone moves the next send to 09:00 on its clock, in the same write", async () => {
      await put({ timezone: "Europe/Berlin" });

      expect(updates).toHaveLength(1);
      expect(updates[0]!["timezone"]).toBe("Europe/Berlin");
      expect(iso(updates[0]!["nextSendAt"])).toBe("2026-11-02T08:00:00.000Z");
    });

    test("a time zone that is not one is refused, and nothing is written", async () => {
      await expect(put({ timezone: "Europe/Atlantis" })).rejects.toThrow(
        /timezone is not a time zone/,
      );
      expect(updates).toHaveLength(0);
    });

    test("a rename leaves the time zone and the next send alone", async () => {
      await put({ name: "Renamed" });

      expect(updates).toHaveLength(1);
      expect(updates[0]!["timezone"]).toBeUndefined();
      expect(updates[0]!["nextSendAt"]).toBeUndefined();
    });
  },
);
