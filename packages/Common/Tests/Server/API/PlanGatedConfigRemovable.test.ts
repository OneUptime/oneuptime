import BaseAPI from "../../../Server/API/BaseAPI";
import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import ProjectOIDCService from "../../../Server/Services/ProjectOidcService";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProjectSSOService from "../../../Server/Services/ProjectSsoService";
import StatusPageOIDCService from "../../../Server/Services/StatusPageOidcService";
import StatusPageSSOService from "../../../Server/Services/StatusPageSsoService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceNotificationSummaryService from "../../../Server/Services/WorkspaceNotificationSummaryService";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import Response from "../../../Server/Utils/Response";
import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import APIKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import ProjectOIDC from "../../../Models/DatabaseModels/ProjectOidc";
import ProjectSCIM from "../../../Models/DatabaseModels/ProjectSCIM";
import ProjectSSO from "../../../Models/DatabaseModels/ProjectSso";
import StatusPageOIDC from "../../../Models/DatabaseModels/StatusPageOidc";
import StatusPageSSO from "../../../Models/DatabaseModels/StatusPageSso";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceNotificationSummary from "../../../Models/DatabaseModels/WorkspaceNotificationSummary";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
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
 * Configuration a lower plan cannot use can still be seen, switched off and
 * removed - through the API's own routes (BaseAPI) and each service's real
 * read, update and delete paths, permission and plan checks included, with
 * billing on as on OneUptime Cloud. Only the repositories, the plan lookup
 * and the side effects after a write are stubbed.
 *
 * A project whose Scale trial ended keeps its SAML and OIDC providers - and
 * they keep signing people in - and its SCIM connection keeps provisioning
 * them. One that dropped from Growth keeps posting to Slack and Microsoft
 * Teams, keeps its API keys authenticating and its schedules paging people.
 * Before this, below the plan none of it could even be read, let alone
 * switched off or removed. Now every plan reads what the project has,
 * switches it off and deletes it; creating, switching back on and changing
 * still need the plan, refused with its name - and so does deleting an API
 * key's permissions one by one, and reading what a feature produced (logs).
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

const PROJECT_ID: ObjectID = new ObjectID(
  "6e000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("6e000000-0000-4000-8000-000000000002");
const RECORD_ID: ObjectID = new ObjectID(
  "6e000000-0000-4000-8000-000000000003",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "6e000000-0000-4000-8000-000000000004",
);

const refusalFor: (plan: PlanType) => string = (plan: PlanType): string => {
  return `Please upgrade your plan to ${plan} to access this feature`;
};

// The two plans a project lands on when a Growth or Scale trial ends.
const PLANS_BELOW_SCALE: ReadonlyArray<PlanType> = [
  PlanType.Free,
  PlanType.Growth,
];

let currentPlan: PlanType = PlanType.Free;
let writes: Array<Record<string, unknown>> = [];
let deletes: number = 0;
let stored: Record<string, unknown> = {};

type AnyService = DatabaseService<BaseModel>;

interface Subject {
  name: string;
  modelType: { new (): BaseModel };
  service: AnyService;
  api: BaseAPI<any, any>;
}

const subject: (
  name: string,
  modelType: { new (): BaseModel },
  service: unknown,
) => Subject = (
  name: string,
  modelType: { new (): BaseModel },
  service: unknown,
): Subject => {
  return {
    name,
    modelType,
    service: service as AnyService,
    api: new BaseAPI<any, any>(modelType as never, service as never),
  };
};

const SAML_PROVIDER: Subject = subject(
  "a project's SAML provider",
  ProjectSSO,
  ProjectSSOService,
);
const OIDC_PROVIDER: Subject = subject(
  "a project's OIDC provider",
  ProjectOIDC,
  ProjectOIDCService,
);
const STATUS_PAGE_SAML_PROVIDER: Subject = subject(
  "a status page's SAML provider",
  StatusPageSSO,
  StatusPageSSOService,
);
const STATUS_PAGE_OIDC_PROVIDER: Subject = subject(
  "a status page's OIDC provider",
  StatusPageOIDC,
  StatusPageOIDCService,
);
const SCIM_CONNECTION: Subject = subject(
  "a project's SCIM connection",
  ProjectSCIM,
  ProjectSCIMService,
);
const NOTIFICATION_RULE: Subject = subject(
  "a Slack or Teams notification rule",
  WorkspaceNotificationRule,
  WorkspaceNotificationRuleService,
);
const SUMMARY: Subject = subject(
  "a Slack or Teams summary",
  WorkspaceNotificationSummary,
  WorkspaceNotificationSummaryService,
);
const API_KEY: Subject = subject("an API key", ApiKey, ApiKeyService);
const API_KEY_PERMISSION: Subject = subject(
  "an API key's permission",
  APIKeyPermission,
  ApiKeyPermissionService,
);
const SCHEDULE: Subject = subject(
  "an on-call schedule",
  OnCallDutyPolicySchedule,
  OnCallDutyPolicyScheduleService,
);
const ON_CALL_LOG: Subject = subject(
  "an on-call log",
  OnCallDutyPolicyExecutionLog,
  OnCallDutyPolicyExecutionLogService,
);

const ALL_SUBJECTS: ReadonlyArray<Subject> = [
  SAML_PROVIDER,
  OIDC_PROVIDER,
  STATUS_PAGE_SAML_PROVIDER,
  STATUS_PAGE_OIDC_PROVIDER,
  SCIM_CONNECTION,
  NOTIFICATION_RULE,
  SUMMARY,
  API_KEY,
  API_KEY_PERMISSION,
  SCHEDULE,
  ON_CALL_LOG,
];

// A member of the project, as the API's auth middleware leaves the request.
const request: (data: {
  body?: JSONObject | undefined;
  permission?: Permission | null | undefined;
}) => OneUptimeRequest = (data: {
  body?: JSONObject | undefined;
  permission?: Permission | null | undefined;
}): OneUptimeRequest => {
  const permission: Permission | null =
    data.permission === undefined ? Permission.ProjectOwner : data.permission;

  return {
    params: { id: RECORD_ID.toString() },
    body: data.body || {},
    headers: {},
    query: {},
    userType: UserType.User,
    userAuthorization: { userId: USER_ID },
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permission
          ? [
              {
                _type: "UserPermission",
                permission: permission,
                labelIds: [],
                isBlockPermission: false,
                scope: PermissionScope.All,
              },
            ]
          : [],
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

// What a route answers: "done", or the refusal's message.
const call: (run: () => Promise<void>) => Promise<string> = async (
  run: () => Promise<void>,
): Promise<string> => {
  try {
    await run();
    return "done";
  } catch (err) {
    if (
      err instanceof PaymentRequiredException ||
      err instanceof NotAuthorizedException
    ) {
      return err.message;
    }

    throw err;
  }
};

const read: (
  target: Subject,
  select?: JSONObject,
  permission?: Permission | null,
) => Promise<string> = async (
  target: Subject,
  select?: JSONObject,
  permission?: Permission | null,
): Promise<string> => {
  return await call(async () => {
    await target.api.getItem(
      request({
        body: { select: select || { _id: true } },
        permission: permission === undefined ? undefined : permission,
      }),
      response(),
    );
  });
};

const update: (
  target: Subject,
  data: JSONObject,
  permission?: Permission,
) => Promise<string> = async (
  target: Subject,
  data: JSONObject,
  permission?: Permission,
): Promise<string> => {
  return await call(async () => {
    await target.api.updateItem(
      request({ body: { data: data }, permission: permission }),
      response(),
    );
  });
};

const remove: (target: Subject) => Promise<string> = async (
  target: Subject,
): Promise<string> => {
  return await call(async () => {
    await target.api.deleteItem(request({}), response());
  });
};

const create: (target: Subject, data: JSONObject) => Promise<string> = async (
  target: Subject,
  data: JSONObject,
): Promise<string> => {
  return await call(async () => {
    await target.api.createItem(
      request({
        body: { data: { projectId: PROJECT_ID.toString(), ...data } },
      }),
      response(),
    );
  });
};

// The repository of a service: one stored record, every write recorded.
const stubRepository: (target: Subject) => void = (target: Subject): void => {
  getJestSpyOn(target.service as never, "getRepository").mockReturnValue({
    find: async (): Promise<Array<BaseModel>> => {
      const record: BaseModel = new target.modelType();
      record._id = RECORD_ID.toString();
      (record as unknown as Record<string, unknown>)["projectId"] = PROJECT_ID;
      Object.assign(record, stored);
      return [record];
    },
    count: async (): Promise<number> => {
      return 1;
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
    delete: async (): Promise<{ affected: number }> => {
      deletes++;
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
  deletes = 0;
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

  for (const target of ALL_SUBJECTS) {
    stubRepository(target);

    getJestSpyOn(
      target.service as never,
      "onTriggerWorkflow",
    ).mockResolvedValue(undefined as never);
    getJestSpyOn(
      target.service as never,
      "onTriggerRealtime",
    ).mockResolvedValue(undefined as never);
  }

  /*
   * A schedule's delete hooks end its time logs and tell the shift-change
   * listeners: other tables, not what this suite is about.
   */
  getJestSpyOn(SCHEDULE.service as never, "onBeforeDelete").mockImplementation(
    async (deleteBy: unknown): Promise<unknown> => {
      return { deleteBy: deleteBy, carryForward: null };
    },
  );
  getJestSpyOn(SCHEDULE.service as never, "onDeleteSuccess").mockImplementation(
    async (onDelete: unknown): Promise<unknown> => {
      return onDelete;
    },
  );

  getJestSpyOn(AuditLogService, "recordUpdate").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(AuditLogService, "recordDelete").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(AuditLogService, "recordCreate").mockResolvedValue(
    undefined as never,
  );
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
  (Response.sendEmptySuccessResponse as jest.Mock).mockClear();
  (Response.sendEntityResponse as jest.Mock).mockClear();
});

describe("single sign-on a Scale trial left behind, on Free and on Growth", () => {
  const providers: ReadonlyArray<Subject> = [
    SAML_PROVIDER,
    OIDC_PROVIDER,
    STATUS_PAGE_SAML_PROVIDER,
    STATUS_PAGE_OIDC_PROVIDER,
  ];

  beforeEach(() => {
    stored = { isEnabled: true, statusPageId: STATUS_PAGE_ID };
  });

  test("every provider can be read", async () => {
    for (const plan of PLANS_BELOW_SCALE) {
      currentPlan = plan;

      for (const provider of providers) {
        expect([
          plan,
          provider.name,
          await read(provider, { name: true, isEnabled: true }),
        ]).toEqual([plan, provider.name, "done"]);
      }
    }

    expect(Response.sendEntityResponse).toHaveBeenCalled();
  });

  test("every provider can be switched off: the switch alone is written", async () => {
    for (const plan of PLANS_BELOW_SCALE) {
      currentPlan = plan;

      for (const provider of providers) {
        writes = [];

        expect([
          plan,
          provider.name,
          await update(provider, { isEnabled: false }),
        ]).toEqual([plan, provider.name, "done"]);

        expect([plan, provider.name, writes]).toEqual([
          plan,
          provider.name,
          [{ isEnabled: false }],
        ]);
      }
    }
  });

  test("every provider can be deleted", async () => {
    for (const plan of PLANS_BELOW_SCALE) {
      currentPlan = plan;

      for (const provider of providers) {
        deletes = 0;

        expect([plan, provider.name, await remove(provider)]).toEqual([
          plan,
          provider.name,
          "done",
        ]);
        expect([plan, provider.name, deletes]).toEqual([
          plan,
          provider.name,
          1,
        ]);
      }
    }
  });

  test("but switching one back on, editing one or adding one needs Scale", async () => {
    stored = { isEnabled: false, statusPageId: STATUS_PAGE_ID };

    for (const plan of PLANS_BELOW_SCALE) {
      currentPlan = plan;

      for (const provider of providers) {
        expect([
          plan,
          provider.name,
          await update(provider, { isEnabled: true }),
          await update(provider, { name: "Renamed" }),
          await update(provider, { isEnabled: false, name: "Renamed" }),
          await update(provider, { isEnabled: "false" }),
          await create(provider, { name: "New", isEnabled: false }),
        ]).toEqual([
          plan,
          provider.name,
          refusalFor(PlanType.Scale),
          refusalFor(PlanType.Scale),
          refusalFor(PlanType.Scale),
          refusalFor(PlanType.Scale),
          refusalFor(PlanType.Scale),
        ]);
      }
    }

    expect(writes).toEqual([]);
  });

  test("on Scale, switching one back on works as before", async () => {
    currentPlan = PlanType.Scale;
    stored = { isEnabled: false, statusPageId: STATUS_PAGE_ID };

    expect(await update(OIDC_PROVIDER, { isEnabled: true })).toBe("done");
    expect(writes).toEqual([{ isEnabled: true }]);
  });

  /*
   * Express parses a body's "__proto__" key as an ordinary property. Copied
   * by assignment it would become the payload's prototype, whose values -
   * a provider's teams, its name - no check that lists the payload's own
   * columns sees, yet the write reads them by name. The key is dropped
   * when the body is read (JSONFunctions.deserialize), and a payload that
   * still carries a prototype is no switch-off (PlanGatedTable).
   */
  test("a switch-off whose body hides columns under __proto__ writes the switch alone", async () => {
    const data: JSONObject = JSON.parse(
      '{"isEnabled": false, "__proto__": {"name": "Renamed", "teams": []}}',
    ) as JSONObject;

    expect(Object.keys(data)).toEqual(["isEnabled", "__proto__"]);

    for (const provider of providers) {
      writes = [];

      expect([provider.name, await update(provider, data)]).toEqual([
        provider.name,
        "done",
      ]);

      expect([provider.name, writes]).toEqual([
        provider.name,
        [{ isEnabled: false }],
      ]);
    }
  });

  test("who may do it is unchanged: switching off needs the provider's edit permission, deleting its delete permission", async () => {
    for (const provider of [SAML_PROVIDER, OIDC_PROVIDER]) {
      expect(
        await update(provider, { isEnabled: false }, Permission.ProjectMember),
      ).toContain("You do not have permissions");

      expect(
        await call(async () => {
          await provider.api.deleteItem(
            request({ permission: Permission.ProjectMember }),
            response(),
          );
        }),
      ).toContain("You do not have permissions");
    }

    expect(writes).toEqual([]);
    expect(deletes).toBe(0);
  });
});

describe("a SCIM connection a Scale trial left behind, on Free and on Growth", () => {
  beforeEach(() => {
    stored = { name: "Okta", bearerToken: "a-long-bearer-token-the-idp-holds" };
  });

  test("can be read and deleted by those who could on Scale", async () => {
    for (const plan of PLANS_BELOW_SCALE) {
      currentPlan = plan;

      expect([plan, await read(SCIM_CONNECTION, { name: true })]).toEqual([
        plan,
        "done",
      ]);
      expect([
        plan,
        await read(SCIM_CONNECTION, { name: true }, Permission.ProjectAdmin),
      ]).toEqual([plan, "done"]);
    }

    deletes = 0;
    expect(
      await call(async () => {
        await SCIM_CONNECTION.api.deleteItem(
          request({ permission: Permission.ProjectAdmin }),
          response(),
        );
      }),
    ).toBe("done");
    expect(deletes).toBe(1);
  });

  test("its bearer token stays readable by project owners only", async () => {
    for (const plan of PLANS_BELOW_SCALE) {
      currentPlan = plan;

      expect([
        plan,
        await read(SCIM_CONNECTION, { name: true, bearerToken: true }),
      ]).toEqual([plan, "done"]);

      for (const permission of [
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.ReadProjectSSO,
      ]) {
        expect([
          plan,
          permission,
          await read(
            SCIM_CONNECTION,
            { name: true, bearerToken: true },
            permission,
          ),
        ]).toEqual([
          plan,
          permission,
          expect.stringContaining(
            "You do not have permissions to select on - bearerToken",
          ) as unknown as string,
        ]);
      }
    }
  });

  test("but its token cannot be replaced, nor a connection added, without Scale: deleting is how it stops", async () => {
    for (const plan of PLANS_BELOW_SCALE) {
      currentPlan = plan;

      expect([
        plan,
        await update(SCIM_CONNECTION, {
          bearerToken: "a-new-long-bearer-token-for-the-idp-1234",
        }),
        await update(SCIM_CONNECTION, { isEnabled: false }),
        await create(SCIM_CONNECTION, { name: "Another" }),
      ]).toEqual([
        plan,
        refusalFor(PlanType.Scale),
        refusalFor(PlanType.Scale),
        refusalFor(PlanType.Scale),
      ]);
    }

    expect(writes).toEqual([]);
  });
});

describe("Slack and Microsoft Teams rules and summaries a Growth trial left behind, on Free", () => {
  test("a notification rule can be read and deleted, but not changed or added", async () => {
    stored = { name: "Page #incidents" };

    expect(await read(NOTIFICATION_RULE, { name: true })).toBe("done");
    expect(await remove(NOTIFICATION_RULE)).toBe("done");
    expect(deletes).toBe(1);

    expect(await update(NOTIFICATION_RULE, { name: "Renamed" })).toBe(
      refusalFor(PlanType.Growth),
    );
    // A rule has no switch of its own: deleting it is how it stops.
    expect(await update(NOTIFICATION_RULE, { isEnabled: false })).toBe(
      refusalFor(PlanType.Growth),
    );
    expect(await create(NOTIFICATION_RULE, { name: "New" })).toBe(
      refusalFor(PlanType.Growth),
    );
    expect(writes).toEqual([]);
  });

  test("a summary can be read, switched off and deleted, but not switched back on", async () => {
    stored = { name: "Weekly incidents", isEnabled: true };

    expect(await read(SUMMARY, { name: true, isEnabled: true })).toBe("done");
    expect(await update(SUMMARY, { isEnabled: false })).toBe("done");
    expect(writes).toEqual([{ isEnabled: false }]);

    stored = { name: "Weekly incidents", isEnabled: false };
    writes = [];

    expect(await update(SUMMARY, { isEnabled: true })).toBe(
      refusalFor(PlanType.Growth),
    );
    expect(writes).toEqual([]);

    expect(await remove(SUMMARY)).toBe("done");
    expect(deletes).toBe(1);
  });

  test("a refused change never reaches the service's own hooks", async () => {
    const onBeforeUpdate: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SUMMARY.service as never,
      "onBeforeUpdate",
    );

    stored = { isEnabled: false };

    expect(await update(SUMMARY, { isEnabled: true })).toBe(
      refusalFor(PlanType.Growth),
    );
    expect(onBeforeUpdate).not.toHaveBeenCalled();

    expect(await update(SUMMARY, { isEnabled: false })).toBe("done");
    expect(onBeforeUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("API keys a Growth trial left behind, on Free", () => {
  beforeEach(() => {
    stored = { name: "CI deploys" };
  });

  test("a key, and what it may do, can be read, and the key deleted - so a leaked key can be revoked on any plan", async () => {
    expect(await read(API_KEY, { name: true, expiresAt: true })).toBe("done");
    expect(await read(API_KEY_PERMISSION, { permission: true })).toBe("done");

    expect(await remove(API_KEY)).toBe("done");
    expect(deletes).toBe(1);
  });

  /*
   * A block permission narrows the key, so deleting one gives the key
   * more - a change the plan gates. Deleting the key takes its permissions
   * with it.
   */
  test("its permissions are not deleted one by one below Growth: deleting a block would give the key more", async () => {
    for (const isBlockPermission of [true, false]) {
      stored = {
        permission: Permission.DeleteProjectMonitor,
        isBlockPermission,
      };

      expect([isBlockPermission, await remove(API_KEY_PERMISSION)]).toEqual([
        isBlockPermission,
        refusalFor(PlanType.Growth),
      ]);
    }

    expect(deletes).toBe(0);

    // On Growth, as before.
    currentPlan = PlanType.Growth;
    stored = {
      permission: Permission.DeleteProjectMonitor,
      isBlockPermission: false,
    };

    expect(await remove(API_KEY_PERMISSION)).toBe("done");
    expect(deletes).toBe(1);
  });

  test("but a key cannot be added, renamed or extended, and it gains nothing new", async () => {
    expect(await create(API_KEY, { name: "New key" })).toBe(
      refusalFor(PlanType.Growth),
    );
    expect(await update(API_KEY, { name: "Renamed" })).toBe(
      refusalFor(PlanType.Growth),
    );
    expect(
      await update(API_KEY, { expiresAt: "2030-01-01T00:00:00.000Z" }),
    ).toBe(refusalFor(PlanType.Growth));
    expect(
      await create(API_KEY_PERMISSION, {
        permission: Permission.ProjectOwner,
        apiKeyId: RECORD_ID.toString(),
      }),
    ).toBe(refusalFor(PlanType.Growth));
    expect(writes).toEqual([]);
  });
});

describe("on-call schedules a Growth trial left behind, on Free", () => {
  test("a schedule can be read and deleted, but not changed or added", async () => {
    stored = { name: "Primary" };

    expect(await read(SCHEDULE, { name: true })).toBe("done");
    expect(await remove(SCHEDULE)).toBe("done");
    expect(deletes).toBe(1);

    expect(await update(SCHEDULE, { name: "Renamed" })).toBe(
      refusalFor(PlanType.Growth),
    );
    expect(await create(SCHEDULE, { name: "New" })).toBe(
      refusalFor(PlanType.Growth),
    );
  });

  test("its on-call logs stay unreadable: only configuration that keeps working is read below the plan", async () => {
    expect(await read(ON_CALL_LOG, { _id: true })).toBe(
      refusalFor(PlanType.Growth),
    );

    currentPlan = PlanType.Growth;
    expect(await read(ON_CALL_LOG, { _id: true })).toBe("done");
  });
});

describe("with billing off (every self-hosted install)", () => {
  test("no plan is asked of anything", async () => {
    setTestBillingEnabled(false);
    stored = { isEnabled: false, statusPageId: STATUS_PAGE_ID };

    expect(await update(SAML_PROVIDER, { isEnabled: true })).toBe("done");
    expect(await update(NOTIFICATION_RULE, { name: "Renamed" })).toBe("done");
    expect(await read(ON_CALL_LOG, { _id: true })).toBe("done");
    expect(await remove(API_KEY)).toBe("done");
  });
});
