import ServiceLevelObjectiveErrorBudgetPolicyTierAPI, {
  SLO_BULK_ADD_RECOMMENDED_POLICY_ROUTE,
  SLO_BULK_RECOMMENDED_POLICY_ROUTE,
  SLO_RECOMMENDED_POLICY_CREATE_REFUSAL_MESSAGE,
  SLO_RECOMMENDED_POLICY_READ_REFUSAL_MESSAGE,
} from "../../../Server/API/ServiceLevelObjectiveErrorBudgetPolicyTierAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ServiceLevelObjectiveErrorBudgetPolicyTierService, {
  SLO_NOT_FOUND_MESSAGE,
  SloBulkAddedRecommendedPolicy,
  SloBulkMissingRecommendedPolicy,
} from "../../../Server/Services/ServiceLevelObjectiveErrorBudgetPolicyTierService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  SLO_BULK_NO_IDS_MESSAGE,
  SLO_BULK_TOO_MANY_MESSAGE,
  SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS,
} from "../../../Utils/Slo/SloBulkRecommendedBurnRateRules";
import {
  SloBulkRecommendedPolicyResult,
  SloBulkRecommendedPolicyStatus,
  parseSloBulkRecommendedPolicyResults,
} from "../../../Utils/Slo/SloBulkRecommendedPolicy";
import {
  SLO_RECOMMENDED_POLICY_TIERS,
  SloRecommendedPolicyTier,
} from "../../../Utils/Slo/SloErrorBudgetPolicy";
import { countRefusals, withoutRefusals } from "./RouteRefusals";

/*
 * "Use the recommended policy" for many SLOs over the API (#6358): the
 * preview the SLO list's confirmation counts, and the add. Both take what the
 * one-SLO routes take - reading tiers, creating tiers - from a person or an
 * API key of the project, read the SLOs a request names as the bulk routes
 * of Add recommended rules do, hand the caller's own props to the service,
 * and answer one result per SLO in the order named.
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
const SLO_A: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const SLO_B: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const TIER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const BULK_PREVIEW: string = `/service-level-objective-error-budget-policy-tier${SLO_BULK_RECOMMENDED_POLICY_ROUTE}`;
const BULK_ADD: string = `/service-level-objective-error-budget-policy-tier${SLO_BULK_ADD_RECOMMENDED_POLICY_ROUTE}`;

// The recommended tier that freezes deployments.
const EXHAUSTED: SloRecommendedPolicyTier = SLO_RECOMMENDED_POLICY_TIERS.find(
  (tier: SloRecommendedPolicyTier): boolean => {
    return tier.freezesDeployments;
  },
)!;

let props: DatabaseCommonInteractionProps;
let next: jest.Mock;
let bulkPreviewSpy: jest.SpyInstance;
let bulkAddSpy: jest.SpyInstance;
const res: ExpressResponse = {} as ExpressResponse;

function withPermissions(permissions: Array<Permission>): void {
  props.userTenantAccessPermission = {
    [PROJECT.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT,
      permissions: permissions.map((permission: Permission) => {
        return {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: false,
        };
      }),
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
  new ServiceLevelObjectiveErrorBudgetPolicyTierAPI();
});

beforeEach(() => {
  props = { userId: USER, tenantId: PROJECT, userType: UserType.User };
  withPermissions([
    Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
  ]);
  next = jest.fn();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return props;
    });

  bulkPreviewSpy = jest
    .spyOn(
      ServiceLevelObjectiveErrorBudgetPolicyTierService,
      "getMissingRecommendedTiersForMany",
    )
    .mockResolvedValue([
      {
        serviceLevelObjectiveId: SLO_A,
        status: SloBulkRecommendedPolicyStatus.Missing,
        tiers: [EXHAUSTED],
        message: null,
      },
      {
        serviceLevelObjectiveId: SLO_B,
        status: SloBulkRecommendedPolicyStatus.OwnPolicy,
        tiers: [],
        message: null,
      },
    ] as Array<SloBulkMissingRecommendedPolicy>);

  bulkAddSpy = jest
    .spyOn(
      ServiceLevelObjectiveErrorBudgetPolicyTierService,
      "addMissingRecommendedTiersToMany",
    )
    .mockResolvedValue([
      {
        serviceLevelObjectiveId: SLO_A,
        status: SloBulkRecommendedPolicyStatus.Added,
        tiers: [{ ...EXHAUSTED, tierId: TIER_ID }],
        message: null,
      },
      {
        serviceLevelObjectiveId: SLO_B,
        status: SloBulkRecommendedPolicyStatus.Refused,
        tiers: [],
        message: SLO_NOT_FOUND_MESSAGE,
      },
    ] as Array<SloBulkAddedRecommendedPolicy>);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("the bulk routes", () => {
  test("sit beside the one-SLO routes, behind the user middleware", () => {
    for (const uri of [BULK_PREVIEW, BULK_ADD]) {
      expect(withoutRefusals(routeOf(uri).handlers)).toHaveLength(2);
      expect(routeOf(uri).handlers[0]).toBe(UserMiddleware.getUserMiddleware);
    }

    expect(BULK_PREVIEW).toBe(
      "/service-level-objective-error-budget-policy-tier/recommended-policy/bulk",
    );
    expect(BULK_ADD).toBe(
      "/service-level-objective-error-budget-policy-tier/recommended-policy/bulk/add",
    );
  });

  // Switching SLOs off on the server stops adding tiers; asking only reads.
  test("refuse the add while SLOs are switched off on the server, and leave the preview alone", () => {
    expect(countRefusals(routeOf(BULK_ADD).handlers)).toBe(1);
    expect(countRefusals(routeOf(BULK_PREVIEW).handlers)).toBe(0);
  });
});

describe("what many SLOs would get", () => {
  test("answers each SLO, as the Dashboard reads them back", async () => {
    await post(BULK_PREVIEW, {
      serviceLevelObjectiveIds: [SLO_A.toString(), SLO_B.toString()],
    });

    expect(next).not.toHaveBeenCalled();
    expect(bulkPreviewSpy).toHaveBeenCalledTimes(1);

    const asked: {
      serviceLevelObjectiveIds: Array<ObjectID>;
      props: unknown;
    } = bulkPreviewSpy.mock.calls[0]![0] as {
      serviceLevelObjectiveIds: Array<ObjectID>;
      props: unknown;
    };

    expect(asked.props).toBe(props);
    expect(asked.serviceLevelObjectiveIds).toEqual([SLO_A, SLO_B]);

    const results: Array<SloBulkRecommendedPolicyResult> =
      parseSloBulkRecommendedPolicyResults(answered()["results"]);

    expect(results).toEqual([
      {
        serviceLevelObjectiveId: SLO_A.toString(),
        status: SloBulkRecommendedPolicyStatus.Missing,
        tiers: [EXHAUSTED],
        message: null,
      },
      {
        serviceLevelObjectiveId: SLO_B.toString(),
        status: SloBulkRecommendedPolicyStatus.OwnPolicy,
        tiers: [],
        message: null,
      },
    ]);
    expect(bulkAddSpy).not.toHaveBeenCalled();
  });

  test("a role that reads SLOs but not their tiers may not ask", async () => {
    withPermissions([Permission.ReadServiceLevelObjective]);

    await post(BULK_PREVIEW, { serviceLevelObjectiveIds: [SLO_A.toString()] });

    expect(refusal().message).toBe(SLO_RECOMMENDED_POLICY_READ_REFUSAL_MESSAGE);
    expect(bulkPreviewSpy).not.toHaveBeenCalled();
  });

  test.each([
    ["no body", undefined, SLO_BULK_NO_IDS_MESSAGE],
    ["no list", {}, SLO_BULK_NO_IDS_MESSAGE],
    [
      "an empty list",
      { serviceLevelObjectiveIds: [] },
      SLO_BULK_NO_IDS_MESSAGE,
    ],
    [
      "an id that is not one",
      { serviceLevelObjectiveIds: ["not-an-id"] },
      SLO_BULK_NO_IDS_MESSAGE,
    ],
    [
      "more SLOs than the cap",
      {
        serviceLevelObjectiveIds: Array.from(
          { length: SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS + 1 },
          (): string => {
            return ObjectID.generate().toString();
          },
        ),
      },
      SLO_BULK_TOO_MANY_MESSAGE,
    ],
  ])(
    "%s is refused as bad data",
    async (_label: string, body: unknown, message: string) => {
      await post(BULK_PREVIEW, body);

      expect(refusal()).toBeInstanceOf(BadDataException);
      expect(refusal().message).toBe(message);
      expect(bulkPreviewSpy).not.toHaveBeenCalled();
    },
  );
});

describe("adding the recommended policy to many SLOs", () => {
  test("adds as the caller and answers what each SLO got, each added tier with its new id", async () => {
    await post(BULK_ADD, {
      serviceLevelObjectiveIds: [SLO_A.toString(), SLO_B.toString()],
    });

    expect(next).not.toHaveBeenCalled();
    expect(bulkAddSpy).toHaveBeenCalledTimes(1);
    expect((bulkAddSpy.mock.calls[0]![0] as { props: unknown }).props).toBe(
      props,
    );

    expect(answered()).toEqual({
      results: [
        {
          serviceLevelObjectiveId: SLO_A.toString(),
          status: SloBulkRecommendedPolicyStatus.Added,
          tiers: [
            {
              name: EXHAUSTED.name,
              thresholdPercentage: 0,
              whatWeDo: EXHAUSTED.whatWeDo,
              freezesDeployments: true,
              id: TIER_ID.toString(),
            },
          ],
          message: null,
        },
        {
          serviceLevelObjectiveId: SLO_B.toString(),
          status: SloBulkRecommendedPolicyStatus.Refused,
          tiers: [],
          message: SLO_NOT_FOUND_MESSAGE,
        },
      ],
    });
  });

  test("a role that only reads tiers may not add, and nothing is read", async () => {
    withPermissions([
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ]);

    await post(BULK_ADD, { serviceLevelObjectiveIds: [SLO_A.toString()] });

    expect(refusal().message).toBe(
      SLO_RECOMMENDED_POLICY_CREATE_REFUSAL_MESSAGE,
    );
    expect(bulkAddSpy).not.toHaveBeenCalled();
  });

  test("an API key that may create tiers may add", async () => {
    props = { tenantId: PROJECT, userType: UserType.API };
    withPermissions([
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ]);

    await post(BULK_ADD, { serviceLevelObjectiveIds: [SLO_A.toString()] });

    expect(next).not.toHaveBeenCalled();
    expect(bulkAddSpy).toHaveBeenCalledTimes(1);
  });

  test("a request in no project is refused before anything is added", async () => {
    props = { userId: USER, userType: UserType.User };

    await post(BULK_ADD, { serviceLevelObjectiveIds: [SLO_A.toString()] });

    expect(refusal()).toBeInstanceOf(Error);
    expect(bulkAddSpy).not.toHaveBeenCalled();
  });
});
