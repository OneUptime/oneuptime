import BaseAPI from "../../../Server/API/BaseAPI";
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
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import UserType from "../../../Types/UserType";
import {
  getDisplayChoiceWrite,
  getDisplayStatusesWrite,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageDisplaySettingsCopy";
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
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * The records these tests name are their project's own: the services check
 * every reference against the project (ProjectReferencesService).
 */
beforeEach(() => {
  stubProjectDirectory({});
});

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
 * A status page's overall uptime percentage, its precision, and the
 * statuses that count as downtime, as the "What your status page shows"
 * card writes them - through the API's update route (BaseAPI.updateItem)
 * and the real update path of StatusPageService, permission and plan
 * checks included. Only the repository, the plan lookup and the side
 * effects after a write are stubbed.
 *
 * These were two cards with an Edit dialog each. The dialog for the overall
 * uptime percentage sent the switch and the precision together, and on
 * OneUptime Cloud the column check refuses a whole write that carries a
 * column the plan may not change, changed or not: the switch needs Scale,
 * so below Scale the free precision could not be changed at all. The card
 * now sends each control's column alone (the copy's writes, used here as
 * the card uses them), so:
 *
 *   - the precision and the downtime statuses save on every plan;
 *   - showing the overall uptime percentage needs Scale, on its own;
 *   - with billing off (every self-hosted install), nothing is refused.
 *
 * The plans are read from SUBSCRIPTION_PLAN_* in the environment, which this
 * suite sets itself (and restores), as CI's config.env does. Billing is
 * pinned per test.
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

const SCALE_REFUSAL: string =
  "Please upgrade your plan to Scale to access this feature";

const PROJECT_ID: ObjectID = new ObjectID(
  "1c000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("1c000000-0000-4000-8000-000000000002");
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "1c000000-0000-4000-8000-000000000003",
);
const DEGRADED_ID: string = "1c000000-0000-4000-8000-000000000011";
const OFFLINE_ID: string = "1c000000-0000-4000-8000-000000000012";

type Write = { through: "update" | "save"; data: Record<string, unknown> };

let currentPlan: PlanType = PlanType.Free;
let writes: Array<Write> = [];

const api: BaseAPI<StatusPage, StatusPageServiceType> = new BaseAPI<
  StatusPage,
  StatusPageServiceType
>(StatusPage, StatusPageService);

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

  // One stored status page: find() reads it, update() and save() write it.
  getJestSpyOn(StatusPageService, "getRepository").mockReturnValue({
    find: async (): Promise<Array<StatusPage>> => {
      const page: StatusPage = new StatusPage();
      page._id = STATUS_PAGE_ID.toString();
      page.projectId = PROJECT_ID;
      page.showOverallUptimePercentOnStatusPage = true;
      page.overallUptimePercentPrecision = UptimePrecision.TWO_DECIMAL;
      return [page];
    },
    update: async (
      _where: unknown,
      set: Record<string, unknown>,
    ): Promise<{ affected: number }> => {
      const written: Record<string, unknown> = { ...set };
      delete written["version"];
      writes.push({ through: "update", data: written });
      return { affected: 1 };
    },
    save: async (entity: Record<string, unknown>): Promise<unknown> => {
      const written: Record<string, unknown> = { ...entity };
      delete written["_id"];
      writes.push({ through: "save", data: written });
      return entity;
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
  stubProjectDirectory({});
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
  (Response.sendEmptySuccessResponse as jest.Mock).mockClear();
});

describe("on OneUptime Cloud (billing on)", () => {
  test("the precision, sent alone as the card sends it, saves on every plan", async () => {
    for (const plan of PLANS) {
      currentPlan = plan;
      writes = [];

      const answer: string = await put(
        getDisplayChoiceWrite(
          "overallUptimePercentPrecision",
          UptimePrecision.THREE_DECIMAL,
        ),
      );

      expect([plan, answer]).toEqual([plan, "saved"]);
      expect([plan, writes]).toEqual([
        plan,
        [
          {
            through: "update",
            data: {
              overallUptimePercentPrecision: UptimePrecision.THREE_DECIMAL,
            },
          },
        ],
      ]);
    }
  });

  test("the downtime statuses, sent alone and by id as the card sends them, save on every plan, as the statuses they name", async () => {
    for (const plan of PLANS) {
      currentPlan = plan;
      writes = [];

      const answer: string = await put(
        getDisplayStatusesWrite("downtimeMonitorStatuses", [
          DEGRADED_ID,
          OFFLINE_ID,
        ]),
      );

      expect([plan, answer]).toEqual([plan, "saved"]);
      expect(writes).toHaveLength(1);

      // A list of relations: written through save(), which keeps the join table.
      const write: Write = writes[0]!;

      expect(write.through).toBe("save");
      expect(Object.keys(write.data)).toEqual(["downtimeMonitorStatuses"]);
      expect(
        (write.data["downtimeMonitorStatuses"] as Array<{ _id: string }>).map(
          (status: { _id: string }): string => {
            return status._id;
          },
        ),
      ).toEqual([DEGRADED_ID, OFFLINE_ID]);
    }
  });

  test("showing the overall uptime percentage needs Scale", async () => {
    for (const plan of PLANS) {
      currentPlan = plan;
      writes = [];

      const answer: string = await put({
        showOverallUptimePercentOnStatusPage: true,
      });

      const isAllowed: boolean =
        plan === PlanType.Scale || plan === PlanType.Enterprise;

      expect([plan, answer]).toEqual([
        plan,
        isAllowed ? "saved" : SCALE_REFUSAL,
      ]);
      expect([plan, writes.length]).toEqual([plan, isAllowed ? 1 : 0]);
    }
  });

  /*
   * What the old Edit dialog sent: both fields, whatever was changed. It is
   * why the card sends each control's column alone.
   */
  test("a write carrying the switch with the precision is refused whole below Scale, even with the switch unchanged", async () => {
    for (const plan of [PlanType.Free, PlanType.Growth]) {
      currentPlan = plan;
      writes = [];

      const answer: string = await put({
        showOverallUptimePercentOnStatusPage: true,
        overallUptimePercentPrecision: UptimePrecision.ONE_DECIMAL,
      });

      expect([plan, answer]).toEqual([plan, SCALE_REFUSAL]);
      expect(writes).toEqual([]);
    }

    currentPlan = PlanType.Scale;

    expect(
      await put({
        showOverallUptimePercentOnStatusPage: true,
        overallUptimePercentPrecision: UptimePrecision.ONE_DECIMAL,
      }),
    ).toBe("saved");
  });
});

describe("on a self-hosted install (billing off)", () => {
  test("every control saves, on any plan the project was left on", async () => {
    setTestBillingEnabled(false);

    for (const plan of PLANS) {
      currentPlan = plan;

      expect([
        plan,
        await put({ showOverallUptimePercentOnStatusPage: true }),
      ]).toEqual([plan, "saved"]);
      expect([
        plan,
        await put(
          getDisplayChoiceWrite(
            "overallUptimePercentPrecision",
            UptimePrecision.NO_DECIMAL,
          ),
        ),
      ]).toEqual([plan, "saved"]);
      expect([
        plan,
        await put(
          getDisplayStatusesWrite("downtimeMonitorStatuses", [OFFLINE_ID]),
        ),
      ]).toEqual([plan, "saved"]);
    }

    // The plan is never looked up: there is none to go by.
    expect(ProjectService.getCurrentPlan).not.toHaveBeenCalled();
  });
});
