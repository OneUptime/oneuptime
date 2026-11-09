import ServiceLevelObjectiveBurnRateRuleAPI, {
  SLO_ADD_RECOMMENDED_BURN_RATE_RULES_ROUTE,
  SLO_BULK_ADD_RECOMMENDED_BURN_RATE_RULES_ROUTE,
  SLO_BULK_RECOMMENDED_BURN_RATE_RULES_ROUTE,
  SLO_RECOMMENDED_BURN_RATE_RULES_ROUTE,
  readServiceLevelObjectiveId,
  readServiceLevelObjectiveIds,
} from "../../../Server/API/ServiceLevelObjectiveBurnRateRuleAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ServiceLevelObjectiveBurnRateRuleService, {
  SLO_NOT_FOUND_MESSAGE,
  SloAddedRecommendedRules,
  SloBulkAddedRecommendedRules,
  SloBulkMissingRecommendedRules,
  SloMissingRecommendedRules,
} from "../../../Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import {
  SLO_BULK_NO_IDS_MESSAGE,
  SLO_BULK_TOO_MANY_MESSAGE,
  SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS,
  SloBulkRecommendedRulesStatus,
} from "../../../Utils/Slo/SloBulkRecommendedBurnRateRules";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  SloRecommendedBurnRateRule,
  getSloRecommendedBurnRateRules,
} from "../../../Utils/Slo/SloRecommendedBurnRateRules";

/*
 * "Add recommended rules", as the API serves it:
 *
 *   POST /service-level-objective-burn-rate-rule/recommended-rules
 *   POST /service-level-objective-burn-rate-rule/recommended-rules/add
 *
 * and for many SLOs at once, as the SLO list's Bulk Actions ask:
 *
 *   POST /service-level-objective-burn-rate-rule/recommended-rules/bulk
 *   POST /service-level-objective-burn-rate-rule/recommended-rules/bulk/add
 *
 * Who may ask (the first: whoever may read SLO burn rate rules; the second:
 * whoever may create them - a person or an API key of the project, and never
 * a read-only credential or a team that blocks the permission), which SLO is
 * asked about (the id the body names, nothing else), and what is answered.
 * The service is answered here; its own suite holds what it reads and adds.
 */

type Handler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

const recordedRoutes: Array<{ uri: string; handlers: Array<Handler> }> = [];

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return {
        post: (uri: string, ...handlers: Array<Handler>): void => {
          recordedRoutes.push({ uri, handlers });
        },
        get: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
      };
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return { sendJsonObjectResponse: jest.fn() };
});

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const USER: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const SLO_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const RULE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const LOW_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const PREVIEW: string = `/service-level-objective-burn-rate-rule${SLO_RECOMMENDED_BURN_RATE_RULES_ROUTE}`;
const ADD: string = `/service-level-objective-burn-rate-rule${SLO_ADD_RECOMMENDED_BURN_RATE_RULES_ROUTE}`;
const BULK: string = `/service-level-objective-burn-rate-rule${SLO_BULK_RECOMMENDED_BURN_RATE_RULES_ROUTE}`;
const BULK_ADD: string = `/service-level-objective-burn-rate-rule${SLO_BULK_ADD_RECOMMENDED_BURN_RATE_RULES_ROUTE}`;

const SLO_2: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const SLO_3: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");

const SLOW_LEAK: SloRecommendedBurnRateRule = getSloRecommendedBurnRateRules({
  windowDays: 30,
})[2]!;

function lowSeverity(): AlertSeverity {
  const severity: AlertSeverity = new AlertSeverity();
  severity._id = LOW_ID.toString();
  severity.id = LOW_ID;
  severity.name = "Low";
  return severity;
}

const SLOW_LEAK_JSON: JSONObject = {
  name: "Slow leak",
  budgetPercentage: 10,
  burnRateThreshold: 1,
  longWindowInMinutes: 4320,
  shortWindowInMinutes: 360,
  refireSuppressionMinutes: 1440,
  alertSeverity: "LeastSevere",
  alertSeverityName: "Low",
};

let props: DatabaseCommonInteractionProps;
let next: jest.Mock;
let previewSpy: jest.SpyInstance;
let addSpy: jest.SpyInstance;
let bulkPreviewSpy: jest.SpyInstance;
let bulkAddSpy: jest.SpyInstance;
const res: ExpressResponse = {} as ExpressResponse;

function withPermissions(
  permissions: Array<Permission>,
  blocked: Array<Permission> = [],
): void {
  props.userTenantAccessPermission = {
    [PROJECT.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT,
      permissions: [
        ...permissions.map((permission: Permission) => {
          return {
            _type: "UserPermission",
            permission,
            labelIds: [],
            isBlockPermission: false,
          };
        }),
        ...blocked.map((permission: Permission) => {
          return {
            _type: "UserPermission",
            permission,
            labelIds: [],
            isBlockPermission: true,
          };
        }),
      ],
    },
  } as never;
}

function routeOf(uri: string): { uri: string; handlers: Array<Handler> } {
  const found: { uri: string; handlers: Array<Handler> } | undefined =
    recordedRoutes.find((item: { uri: string }) => {
      return item.uri === uri;
    });

  expect(found).toBeDefined();

  return found!;
}

async function post(uri: string, body: unknown): Promise<void> {
  const route: { uri: string; handlers: Array<Handler> } = routeOf(uri);

  await route.handlers[route.handlers.length - 1]!(
    { params: {}, body } as unknown as ExpressRequest,
    res,
    next,
  );
}

function answered(): JSONObject {
  const mock: jest.Mock = Response.sendJsonObjectResponse as jest.Mock;
  expect(mock).toHaveBeenCalledTimes(1);
  return mock.mock.calls[0]![2] as JSONObject;
}

function refusal(): Error {
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0]![0] as Error;
}

beforeAll(() => {
  new ServiceLevelObjectiveBurnRateRuleAPI();
});

beforeEach(() => {
  props = { userId: USER, tenantId: PROJECT, userType: UserType.User };
  withPermissions([
    Permission.ReadServiceLevelObjectiveBurnRateRule,
    Permission.CreateServiceLevelObjectiveBurnRateRule,
  ]);
  next = jest.fn();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return props;
    });

  previewSpy = jest
    .spyOn(
      ServiceLevelObjectiveBurnRateRuleService,
      "getMissingRecommendedRules",
    )
    .mockResolvedValue({
      serviceLevelObjectiveId: SLO_ID,
      projectId: PROJECT,
      rules: [{ recommended: SLOW_LEAK, alertSeverity: lowSeverity() }],
    } as SloMissingRecommendedRules);

  addSpy = jest
    .spyOn(
      ServiceLevelObjectiveBurnRateRuleService,
      "addMissingRecommendedRules",
    )
    .mockResolvedValue({
      serviceLevelObjectiveId: SLO_ID,
      rules: [
        {
          recommended: SLOW_LEAK,
          alertSeverity: lowSeverity(),
          ruleId: RULE_ID,
        },
      ],
    } as SloAddedRecommendedRules);

  bulkPreviewSpy = jest
    .spyOn(
      ServiceLevelObjectiveBurnRateRuleService,
      "getMissingRecommendedRulesForMany",
    )
    .mockResolvedValue([
      {
        serviceLevelObjectiveId: SLO_ID,
        status: SloBulkRecommendedRulesStatus.Missing,
        rules: [{ recommended: SLOW_LEAK, alertSeverity: lowSeverity() }],
        message: null,
      },
      {
        serviceLevelObjectiveId: SLO_2,
        status: SloBulkRecommendedRulesStatus.NothingMissing,
        rules: [],
        message: null,
      },
      {
        serviceLevelObjectiveId: SLO_3,
        status: SloBulkRecommendedRulesStatus.Refused,
        rules: [],
        message: SLO_NOT_FOUND_MESSAGE,
      },
    ] as Array<SloBulkMissingRecommendedRules>);

  bulkAddSpy = jest
    .spyOn(
      ServiceLevelObjectiveBurnRateRuleService,
      "addMissingRecommendedRulesToMany",
    )
    .mockResolvedValue([
      {
        serviceLevelObjectiveId: SLO_ID,
        status: SloBulkRecommendedRulesStatus.Added,
        rules: [
          {
            recommended: SLOW_LEAK,
            alertSeverity: lowSeverity(),
            ruleId: RULE_ID,
          },
        ],
        message: null,
      },
      {
        serviceLevelObjectiveId: SLO_2,
        status: SloBulkRecommendedRulesStatus.NothingMissing,
        rules: [],
        message: null,
      },
      {
        serviceLevelObjectiveId: SLO_3,
        status: SloBulkRecommendedRulesStatus.Failed,
        rules: [
          {
            recommended: SLOW_LEAK,
            alertSeverity: null,
            ruleId: null,
          },
        ],
        message: "Database down.",
      },
    ] as Array<SloBulkAddedRecommendedRules>);
});

function bulkBody(...ids: Array<ObjectID>): {
  serviceLevelObjectiveIds: Array<string>;
} {
  return {
    serviceLevelObjectiveIds: ids.map((id: ObjectID): string => {
      return id.toString();
    }),
  };
}

function manyIds(count: number): Array<string> {
  const ids: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    ids.push(ObjectID.generate().toString());
  }

  return ids;
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("the routes", () => {
  test("sit beside the rule table's CRUD path, behind the user middleware only - as the CRUD create is, so an API key may call them", () => {
    for (const uri of [PREVIEW, ADD, BULK, BULK_ADD]) {
      expect(routeOf(uri).handlers).toHaveLength(2);
      expect(routeOf(uri).handlers[0]).toBe(UserMiddleware.getUserMiddleware);
    }

    expect(PREVIEW).toBe(
      "/service-level-objective-burn-rate-rule/recommended-rules",
    );
    expect(ADD).toBe(
      "/service-level-objective-burn-rate-rule/recommended-rules/add",
    );
    expect(BULK).toBe(
      "/service-level-objective-burn-rate-rule/recommended-rules/bulk",
    );
    expect(BULK_ADD).toBe(
      "/service-level-objective-burn-rate-rule/recommended-rules/bulk/add",
    );
  });

  test("are not taken for a rule's own routes: no path ends like /:id/get-item, /:id/update-item or /:id/delete-item", () => {
    for (const uri of [PREVIEW, ADD, BULK, BULK_ADD]) {
      expect(uri).not.toMatch(/\/(get-item|update-item|delete-item)$/);
    }
  });

  test("are each served once", () => {
    for (const uri of [PREVIEW, ADD, BULK, BULK_ADD]) {
      expect(
        recordedRoutes.filter((item: { uri: string }): boolean => {
          return item.uri === uri;
        }),
      ).toHaveLength(1);
    }
  });
});

describe("which recommended rules an SLO is missing", () => {
  test("answers the missing rules, each with the severity it would raise at", async () => {
    await post(PREVIEW, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(next).not.toHaveBeenCalled();
    expect(previewSpy).toHaveBeenCalledTimes(1);
    expect(previewSpy.mock.calls[0]![0]).toEqual({
      serviceLevelObjectiveId: SLO_ID,
      props: props,
    });
    expect((previewSpy.mock.calls[0]![0] as { props: unknown }).props).toBe(
      props,
    );
    expect(answered()).toEqual({ rules: [SLOW_LEAK_JSON] });
    expect(addSpy).not.toHaveBeenCalled();
  });

  test("a rule the project has no severity for answers no severity name", async () => {
    previewSpy.mockResolvedValue({
      serviceLevelObjectiveId: SLO_ID,
      projectId: PROJECT,
      rules: [{ recommended: SLOW_LEAK, alertSeverity: null }],
    });

    await post(PREVIEW, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect((answered()["rules"] as Array<JSONObject>)[0]!).toMatchObject({
      name: "Slow leak",
      alertSeverityName: null,
    });
  });

  test("nothing missing answers an empty list", async () => {
    previewSpy.mockResolvedValue({
      serviceLevelObjectiveId: SLO_ID,
      projectId: PROJECT,
      rules: [],
    });

    await post(PREVIEW, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(answered()).toEqual({ rules: [] });
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ReadServiceLevelObjectiveBurnRateRule,
  ])(
    "%s may ask: it reads SLO burn rate rules",
    async (permission: Permission) => {
      withPermissions([permission]);

      await post(PREVIEW, { serviceLevelObjectiveId: SLO_ID.toString() });

      expect(next).not.toHaveBeenCalled();
      expect(previewSpy).toHaveBeenCalledTimes(1);
    },
  );

  test("a role that reads SLOs but not their burn rate rules may not ask", async () => {
    withPermissions([Permission.ReadServiceLevelObjective]);

    await post(PREVIEW, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(refusal().message).toContain("read SLO burn rate rules");
    expect(previewSpy).not.toHaveBeenCalled();
  });

  test("a team that blocks reading the rules may not ask", async () => {
    withPermissions(
      [Permission.ReadServiceLevelObjectiveBurnRateRule],
      [Permission.ReadServiceLevelObjectiveBurnRateRule],
    );

    await post(PREVIEW, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(refusal()).toBeInstanceOf(Error);
    expect(previewSpy).not.toHaveBeenCalled();
  });

  test("an API key of the project may ask, as it may read the rules through their CRUD path", async () => {
    props = { tenantId: PROJECT, userType: UserType.API };
    withPermissions([Permission.ReadServiceLevelObjectiveBurnRateRule]);

    await post(PREVIEW, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(next).not.toHaveBeenCalled();
    expect(previewSpy).toHaveBeenCalledTimes(1);
  });

  test("a request with no credentials, or in no project, is refused before anything is read", async () => {
    props = { tenantId: PROJECT };

    await post(PREVIEW, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(refusal()).toBeInstanceOf(Error);

    next = jest.fn();
    props = { userId: USER, userType: UserType.User };

    await post(PREVIEW, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(refusal()).toBeInstanceOf(Error);
    expect(previewSpy).not.toHaveBeenCalled();
  });

  test("a member of another project is refused", async () => {
    props = {
      userId: USER,
      userType: UserType.User,
      tenantId: new ObjectID("66666666-6666-4666-8666-666666666666"),
    };
    withPermissions([Permission.ReadServiceLevelObjectiveBurnRateRule]);

    await post(PREVIEW, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(refusal()).toBeInstanceOf(Error);
    expect(previewSpy).not.toHaveBeenCalled();
  });

  test("an SLO that is not one the caller may read is not found", async () => {
    previewSpy.mockRejectedValue(new NotFoundException(SLO_NOT_FOUND_MESSAGE));

    await post(PREVIEW, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(refusal()).toBeInstanceOf(NotFoundException);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test.each([
    ["no body", undefined],
    ["no id", {}],
    ["an id that is not one", { serviceLevelObjectiveId: "not-an-id" }],
    ["an id that is not text", { serviceLevelObjectiveId: 7 }],
    ["a list", [SLO_ID.toString()]],
  ])("%s is refused as bad data", async (_label: string, body: unknown) => {
    await post(PREVIEW, body);

    expect(refusal()).toBeInstanceOf(BadDataException);
    expect(previewSpy).not.toHaveBeenCalled();
  });
});

describe("adding the missing recommended rules", () => {
  test("adds them as the caller and answers what it added, with each new rule's id", async () => {
    await post(ADD, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(next).not.toHaveBeenCalled();
    expect(addSpy).toHaveBeenCalledTimes(1);
    expect((addSpy.mock.calls[0]![0] as { props: unknown }).props).toBe(props);
    expect(
      (addSpy.mock.calls[0]![0] as { serviceLevelObjectiveId: ObjectID })
        .serviceLevelObjectiveId,
    ).toEqual(SLO_ID);
    expect(answered()).toEqual({
      rules: [{ ...SLOW_LEAK_JSON, id: RULE_ID.toString() }],
    });
    expect(previewSpy).not.toHaveBeenCalled();
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateServiceLevelObjectiveBurnRateRule,
  ])(
    "%s may add them: it creates SLO burn rate rules",
    async (permission: Permission) => {
      withPermissions([permission]);

      await post(ADD, { serviceLevelObjectiveId: SLO_ID.toString() });

      expect(next).not.toHaveBeenCalled();
      expect(addSpy).toHaveBeenCalledTimes(1);
    },
  );

  test("a role that only reads the rules may not add them", async () => {
    withPermissions([Permission.ReadServiceLevelObjectiveBurnRateRule]);

    await post(ADD, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(refusal().message).toContain("create SLO burn rate rules");
    expect(addSpy).not.toHaveBeenCalled();
  });

  test("a team that blocks creating rules may not add them, whatever else it may do", async () => {
    withPermissions(
      [Permission.CreateServiceLevelObjectiveBurnRateRule],
      [Permission.CreateServiceLevelObjectiveBurnRateRule],
    );

    await post(ADD, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(refusal()).toBeInstanceOf(Error);
    expect(addSpy).not.toHaveBeenCalled();
  });

  test("a credential issued for reading only may not add them", async () => {
    props.isReadOnlyCredential = true;

    await post(ADD, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(refusal()).toBeInstanceOf(Error);
    expect(addSpy).not.toHaveBeenCalled();
  });

  test("an API key that may create rules may add them", async () => {
    props = { tenantId: PROJECT, userType: UserType.API };
    withPermissions([Permission.CreateServiceLevelObjectiveBurnRateRule]);

    await post(ADD, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(next).not.toHaveBeenCalled();
    expect(addSpy).toHaveBeenCalledTimes(1);
  });

  test("nothing left to add answers an empty list", async () => {
    addSpy.mockResolvedValue({ serviceLevelObjectiveId: SLO_ID, rules: [] });

    await post(ADD, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(answered()).toEqual({ rules: [] });
  });

  test("a refusal from the service reaches the caller", async () => {
    addSpy.mockRejectedValue(new NotFoundException(SLO_NOT_FOUND_MESSAGE));

    await post(ADD, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(refusal()).toBeInstanceOf(NotFoundException);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("a body that names no SLO is refused before anything is added", async () => {
    await post(ADD, { serviceLevelObjectiveId: "  " });

    expect(refusal()).toBeInstanceOf(BadDataException);
    expect(addSpy).not.toHaveBeenCalled();
  });
});

describe("reading the SLO a request names", () => {
  test("takes the id, trimmed", () => {
    expect(
      readServiceLevelObjectiveId({
        serviceLevelObjectiveId: `  ${SLO_ID.toString()} `,
      }).toString(),
    ).toBe(SLO_ID.toString());
  });

  test("refuses anything else", () => {
    for (const body of [
      null,
      undefined,
      "id",
      [],
      {},
      { serviceLevelObjectiveId: null },
      { serviceLevelObjectiveId: "slo-1" },
      { serviceLevelObjectiveId: { id: SLO_ID.toString() } },
    ]) {
      expect(() => {
        return readServiceLevelObjectiveId(body);
      }).toThrow(BadDataException);
    }
  });
});

const SLOW_LEAK_RULE_JSON: JSONObject = {
  name: "Slow leak",
  budgetPercentage: 10,
  burnRateThreshold: 1,
  longWindowInMinutes: 4320,
  shortWindowInMinutes: 360,
  refireSuppressionMinutes: 1440,
  alertSeverity: "LeastSevere",
};

describe("what many SLOs are missing", () => {
  test("answers each SLO's result, in the order asked: what it is missing with the severity each raises at, nothing, or why not", async () => {
    await post(BULK, bulkBody(SLO_ID, SLO_2, SLO_3));

    expect(next).not.toHaveBeenCalled();
    expect(answered()).toEqual({
      results: [
        {
          serviceLevelObjectiveId: SLO_ID.toString(),
          status: "Missing",
          rules: [{ ...SLOW_LEAK_RULE_JSON, alertSeverityName: "Low" }],
          message: null,
        },
        {
          serviceLevelObjectiveId: SLO_2.toString(),
          status: "NothingMissing",
          rules: [],
          message: null,
        },
        {
          serviceLevelObjectiveId: SLO_3.toString(),
          status: "Refused",
          rules: [],
          message: SLO_NOT_FOUND_MESSAGE,
        },
      ],
    });
    expect(bulkAddSpy).not.toHaveBeenCalled();
    expect(addSpy).not.toHaveBeenCalled();
  });

  test("asks the service about the SLOs the body names, each once, as the caller", async () => {
    await post(BULK, {
      serviceLevelObjectiveIds: [
        ` ${SLO_ID.toString()} `,
        SLO_2.toString(),
        SLO_ID.toString().toUpperCase(),
      ],
    });

    expect(bulkPreviewSpy).toHaveBeenCalledTimes(1);

    const asked: {
      serviceLevelObjectiveIds: Array<ObjectID>;
      props: DatabaseCommonInteractionProps;
    } = bulkPreviewSpy.mock.calls[0]![0] as {
      serviceLevelObjectiveIds: Array<ObjectID>;
      props: DatabaseCommonInteractionProps;
    };

    expect(
      asked.serviceLevelObjectiveIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([SLO_ID.toString(), SLO_2.toString()]);
    expect(asked.props).toBe(props);
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ReadServiceLevelObjectiveBurnRateRule,
  ])(
    "%s may ask: it reads SLO burn rate rules",
    async (permission: Permission) => {
      withPermissions([permission]);

      await post(BULK, bulkBody(SLO_ID));

      expect(next).not.toHaveBeenCalled();
      expect(bulkPreviewSpy).toHaveBeenCalledTimes(1);
    },
  );

  test("a role that reads SLOs but not their burn rate rules may not ask", async () => {
    withPermissions([Permission.ReadServiceLevelObjective]);

    await post(BULK, bulkBody(SLO_ID));

    expect(refusal().message).toContain("read SLO burn rate rules");
    expect(bulkPreviewSpy).not.toHaveBeenCalled();
  });

  test("a team that blocks reading the rules may not ask", async () => {
    withPermissions(
      [Permission.ReadServiceLevelObjectiveBurnRateRule],
      [Permission.ReadServiceLevelObjectiveBurnRateRule],
    );

    await post(BULK, bulkBody(SLO_ID));

    expect(refusal()).toBeInstanceOf(Error);
    expect(bulkPreviewSpy).not.toHaveBeenCalled();
  });

  test("an API key of the project that reads the rules may ask", async () => {
    props = { tenantId: PROJECT, userType: UserType.API };
    withPermissions([Permission.ReadServiceLevelObjectiveBurnRateRule]);

    await post(BULK, bulkBody(SLO_ID));

    expect(next).not.toHaveBeenCalled();
    expect(bulkPreviewSpy).toHaveBeenCalledTimes(1);
  });

  test("a request with no credentials, in no project, or of another project is refused before anything is read", async () => {
    props = { tenantId: PROJECT };

    await post(BULK, bulkBody(SLO_ID));

    expect(refusal()).toBeInstanceOf(Error);

    next = jest.fn();
    props = { userId: USER, userType: UserType.User };

    await post(BULK, bulkBody(SLO_ID));

    expect(refusal()).toBeInstanceOf(Error);

    next = jest.fn();
    props = {
      userId: USER,
      userType: UserType.User,
      tenantId: new ObjectID("66666666-6666-4666-8666-666666666666"),
    };
    withPermissions([Permission.ReadServiceLevelObjectiveBurnRateRule]);

    await post(BULK, bulkBody(SLO_ID));

    expect(refusal()).toBeInstanceOf(Error);
    expect(bulkPreviewSpy).not.toHaveBeenCalled();
  });

  test("a refusal from the service reaches the caller", async () => {
    bulkPreviewSpy.mockRejectedValue(new Error("severities down"));

    await post(BULK, bulkBody(SLO_ID));

    expect(refusal().message).toBe("severities down");
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test.each([
    ["no body", undefined, SLO_BULK_NO_IDS_MESSAGE],
    ["no list", {}, SLO_BULK_NO_IDS_MESSAGE],
    [
      "one id, not in a list",
      { serviceLevelObjectiveIds: SLO_ID.toString() },
      SLO_BULK_NO_IDS_MESSAGE,
    ],
    [
      "an empty list",
      { serviceLevelObjectiveIds: [] },
      SLO_BULK_NO_IDS_MESSAGE,
    ],
    [
      "an id that is not one",
      { serviceLevelObjectiveIds: [SLO_ID.toString(), "slo-2"] },
      SLO_BULK_NO_IDS_MESSAGE,
    ],
    [
      "an id that is not text",
      { serviceLevelObjectiveIds: [7] },
      SLO_BULK_NO_IDS_MESSAGE,
    ],
    [
      "more than one request may name",
      {
        serviceLevelObjectiveIds: manyIds(
          SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS + 1,
        ),
      },
      SLO_BULK_TOO_MANY_MESSAGE,
    ],
  ])(
    "%s is refused as bad data before anything is asked",
    async (_label: string, body: unknown, message: string) => {
      await post(BULK, body);

      expect(refusal()).toEqual(new BadDataException(message));
      expect(bulkPreviewSpy).not.toHaveBeenCalled();
    },
  );
});

describe("adding the missing recommended rules to many SLOs", () => {
  test("adds them as the caller and answers each SLO's result, in the order asked, with each new rule's id", async () => {
    await post(BULK_ADD, bulkBody(SLO_ID, SLO_2, SLO_3));

    expect(next).not.toHaveBeenCalled();
    expect(bulkAddSpy).toHaveBeenCalledTimes(1);

    const asked: {
      serviceLevelObjectiveIds: Array<ObjectID>;
      props: DatabaseCommonInteractionProps;
    } = bulkAddSpy.mock.calls[0]![0] as {
      serviceLevelObjectiveIds: Array<ObjectID>;
      props: DatabaseCommonInteractionProps;
    };

    expect(asked.props).toBe(props);
    expect(
      asked.serviceLevelObjectiveIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([SLO_ID.toString(), SLO_2.toString(), SLO_3.toString()]);

    expect(answered()).toEqual({
      results: [
        {
          serviceLevelObjectiveId: SLO_ID.toString(),
          status: "Added",
          rules: [
            {
              ...SLOW_LEAK_RULE_JSON,
              alertSeverityName: "Low",
              id: RULE_ID.toString(),
            },
          ],
          message: null,
        },
        {
          serviceLevelObjectiveId: SLO_2.toString(),
          status: "NothingMissing",
          rules: [],
          message: null,
        },
        {
          // What went in before it failed, and why it failed.
          serviceLevelObjectiveId: SLO_3.toString(),
          status: "Failed",
          rules: [{ ...SLOW_LEAK_RULE_JSON, alertSeverityName: null }],
          message: "Database down.",
        },
      ],
    });
    expect(bulkPreviewSpy).not.toHaveBeenCalled();
    expect(addSpy).not.toHaveBeenCalled();
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateServiceLevelObjectiveBurnRateRule,
  ])(
    "%s may add them: it creates SLO burn rate rules",
    async (permission: Permission) => {
      withPermissions([permission]);

      await post(BULK_ADD, bulkBody(SLO_ID));

      expect(next).not.toHaveBeenCalled();
      expect(bulkAddSpy).toHaveBeenCalledTimes(1);
    },
  );

  test("a role that only reads the rules may not add them", async () => {
    withPermissions([Permission.ReadServiceLevelObjectiveBurnRateRule]);

    await post(BULK_ADD, bulkBody(SLO_ID));

    expect(refusal().message).toContain("create SLO burn rate rules");
    expect(bulkAddSpy).not.toHaveBeenCalled();
  });

  test("a team that blocks creating rules may not add them, whatever else it may do", async () => {
    withPermissions(
      [Permission.CreateServiceLevelObjectiveBurnRateRule],
      [Permission.CreateServiceLevelObjectiveBurnRateRule],
    );

    await post(BULK_ADD, bulkBody(SLO_ID));

    expect(refusal()).toBeInstanceOf(Error);
    expect(bulkAddSpy).not.toHaveBeenCalled();
  });

  test("a credential issued for reading only may not add them", async () => {
    props.isReadOnlyCredential = true;

    await post(BULK_ADD, bulkBody(SLO_ID));

    expect(refusal()).toBeInstanceOf(Error);
    expect(bulkAddSpy).not.toHaveBeenCalled();
  });

  test("an API key that may create rules may add them", async () => {
    props = { tenantId: PROJECT, userType: UserType.API };
    withPermissions([Permission.CreateServiceLevelObjectiveBurnRateRule]);

    await post(BULK_ADD, bulkBody(SLO_ID));

    expect(next).not.toHaveBeenCalled();
    expect(bulkAddSpy).toHaveBeenCalledTimes(1);
  });

  test("a request in no project, or of another project, is refused before anything is added", async () => {
    props = { userId: USER, userType: UserType.User };

    await post(BULK_ADD, bulkBody(SLO_ID));

    expect(refusal()).toBeInstanceOf(Error);

    next = jest.fn();
    props = {
      userId: USER,
      userType: UserType.User,
      tenantId: new ObjectID("66666666-6666-4666-8666-666666666666"),
    };
    withPermissions([Permission.CreateServiceLevelObjectiveBurnRateRule]);

    await post(BULK_ADD, bulkBody(SLO_ID));

    expect(refusal()).toBeInstanceOf(Error);
    expect(bulkAddSpy).not.toHaveBeenCalled();
  });

  test("more SLOs than one request may name are refused before anything is added; as many as it may name are added to", async () => {
    await post(BULK_ADD, {
      serviceLevelObjectiveIds: manyIds(
        SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS + 1,
      ),
    });

    expect(refusal()).toEqual(new BadDataException(SLO_BULK_TOO_MANY_MESSAGE));
    expect(bulkAddSpy).not.toHaveBeenCalled();

    next = jest.fn();

    await post(BULK_ADD, {
      serviceLevelObjectiveIds: manyIds(
        SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS,
      ),
    });

    expect(next).not.toHaveBeenCalled();
    expect(
      (
        bulkAddSpy.mock.calls[0]![0] as {
          serviceLevelObjectiveIds: Array<ObjectID>;
        }
      ).serviceLevelObjectiveIds,
    ).toHaveLength(SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS);
  });

  test("a body that names no SLO is refused before anything is added", async () => {
    await post(BULK_ADD, { serviceLevelObjectiveIds: ["  "] });

    expect(refusal()).toEqual(new BadDataException(SLO_BULK_NO_IDS_MESSAGE));
    expect(bulkAddSpy).not.toHaveBeenCalled();
  });

  test("a refusal from the service reaches the caller", async () => {
    bulkAddSpy.mockRejectedValue(
      new BadDataException("Project ID is required."),
    );

    await post(BULK_ADD, bulkBody(SLO_ID));

    expect(refusal()).toBeInstanceOf(BadDataException);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

describe("reading the SLOs a bulk request names", () => {
  test("takes each id trimmed, once, in the order first named, whatever its case", () => {
    expect(
      readServiceLevelObjectiveIds({
        serviceLevelObjectiveIds: [
          ` ${SLO_2.toString()}`,
          SLO_ID.toString(),
          SLO_2.toString().toUpperCase(),
          SLO_3.toString(),
        ],
      }).map((id: ObjectID): string => {
        return id.toString().toLowerCase();
      }),
    ).toEqual([SLO_2.toString(), SLO_ID.toString(), SLO_3.toString()]);
  });

  test("counts the list as it was sent: more entries than the cap are refused, repeats or not", () => {
    const ids: Array<string> = manyIds(
      SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS,
    );

    expect(
      readServiceLevelObjectiveIds({ serviceLevelObjectiveIds: ids }),
    ).toHaveLength(SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS);

    expect(() => {
      return readServiceLevelObjectiveIds({
        serviceLevelObjectiveIds: [...ids, ids[0]!],
      });
    }).toThrow(new BadDataException(SLO_BULK_TOO_MANY_MESSAGE));
  });

  test("refuses anything but a list of SLO ids", () => {
    for (const body of [
      null,
      undefined,
      "ids",
      [SLO_ID.toString()],
      {},
      { serviceLevelObjectiveIds: null },
      { serviceLevelObjectiveIds: {} },
      { serviceLevelObjectiveIds: [] },
      { serviceLevelObjectiveIds: [null] },
      { serviceLevelObjectiveIds: [{ id: SLO_ID.toString() }] },
      { serviceLevelObjectiveIds: [SLO_ID.toString(), "slo-1"] },
      // The one-SLO routes' body is not a bulk one.
      { serviceLevelObjectiveId: SLO_ID.toString() },
    ]) {
      expect(() => {
        return readServiceLevelObjectiveIds(body);
      }).toThrow(new BadDataException(SLO_BULK_NO_IDS_MESSAGE));
    }
  });
});
