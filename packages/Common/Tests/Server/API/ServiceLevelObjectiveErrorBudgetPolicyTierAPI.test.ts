import ServiceLevelObjectiveErrorBudgetPolicyTierAPI, {
  SLO_ADD_RECOMMENDED_POLICY_ROUTE,
  SLO_RECOMMENDED_POLICY_ROUTE,
} from "../../../Server/API/ServiceLevelObjectiveErrorBudgetPolicyTierAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ServiceLevelObjectiveErrorBudgetPolicyTierService, {
  SLO_NOT_FOUND_MESSAGE,
  SloAddedRecommendedPolicyTiers,
  SloMissingRecommendedPolicyTiers,
} from "../../../Server/Services/ServiceLevelObjectiveErrorBudgetPolicyTierService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  SLO_RECOMMENDED_POLICY_TIERS,
  SloRecommendedPolicyTier,
  parseSloRecommendedPolicyTiers,
} from "../../../Utils/Slo/SloErrorBudgetPolicy";

/*
 * "Use the recommended policy" over the API: the preview the confirmation
 * lists, and the add. Both take what the tier table's CRUD endpoint takes for
 * the same work - reading tiers, creating tiers - from a person or an API key
 * of the project, and both hand the caller's own props to the service, which
 * reads the SLO and creates each tier as the caller.
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
const TIER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

const PREVIEW: string = `/service-level-objective-error-budget-policy-tier${SLO_RECOMMENDED_POLICY_ROUTE}`;
const ADD: string = `/service-level-objective-error-budget-policy-tier${SLO_ADD_RECOMMENDED_POLICY_ROUTE}`;

const CAUTION: SloRecommendedPolicyTier = SLO_RECOMMENDED_POLICY_TIERS[0]!;

const CAUTION_JSON: JSONObject = {
  name: "Caution",
  thresholdPercentage: 50,
  whatWeDo: CAUTION.whatWeDo,
};

let props: DatabaseCommonInteractionProps;
let next: jest.Mock;
let previewSpy: jest.SpyInstance;
let addSpy: jest.SpyInstance;
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

  previewSpy = jest
    .spyOn(
      ServiceLevelObjectiveErrorBudgetPolicyTierService,
      "getMissingRecommendedTiers",
    )
    .mockResolvedValue({
      serviceLevelObjectiveId: SLO_ID,
      projectId: PROJECT,
      tiers: [CAUTION],
    } as SloMissingRecommendedPolicyTiers);

  addSpy = jest
    .spyOn(
      ServiceLevelObjectiveErrorBudgetPolicyTierService,
      "addMissingRecommendedTiers",
    )
    .mockResolvedValue({
      serviceLevelObjectiveId: SLO_ID,
      tiers: [{ ...CAUTION, tierId: TIER_ID }],
    } as SloAddedRecommendedPolicyTiers);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("the routes", () => {
  test("sit beside the tier table's CRUD path, behind the user middleware only", () => {
    for (const uri of [PREVIEW, ADD]) {
      expect(routeOf(uri).handlers).toHaveLength(2);
      expect(routeOf(uri).handlers[0]).toBe(UserMiddleware.getUserMiddleware);
    }

    expect(PREVIEW).toBe(
      "/service-level-objective-error-budget-policy-tier/recommended-policy",
    );
    expect(ADD).toBe(
      "/service-level-objective-error-budget-policy-tier/recommended-policy/add",
    );
  });

  test("are not taken for a tier's own routes", () => {
    for (const uri of [PREVIEW, ADD]) {
      expect(uri).not.toMatch(/\/(get-item|update-item|delete-item)$/);
    }
  });
});

describe("the recommended tiers an SLO is missing", () => {
  test("answers them, as the Dashboard reads them back", async () => {
    await post(PREVIEW, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(next).not.toHaveBeenCalled();
    expect(previewSpy).toHaveBeenCalledTimes(1);
    expect((previewSpy.mock.calls[0]![0] as { props: unknown }).props).toBe(
      props,
    );
    expect(
      (previewSpy.mock.calls[0]![0] as { serviceLevelObjectiveId: ObjectID })
        .serviceLevelObjectiveId,
    ).toEqual(SLO_ID);

    const body: JSONObject = answered();

    expect(body).toEqual({ tiers: [CAUTION_JSON] });
    expect(parseSloRecommendedPolicyTiers(body["tiers"])).toEqual([CAUTION]);
    expect(addSpy).not.toHaveBeenCalled();
  });

  test("nothing missing answers an empty list", async () => {
    previewSpy.mockResolvedValue({
      serviceLevelObjectiveId: SLO_ID,
      projectId: PROJECT,
      tiers: [],
    });

    await post(PREVIEW, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(answered()).toEqual({ tiers: [] });
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
  ])("%s may ask: it reads the tiers", async (permission: Permission) => {
    withPermissions([permission]);

    await post(PREVIEW, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(next).not.toHaveBeenCalled();
    expect(previewSpy).toHaveBeenCalledTimes(1);
  });

  test("a role that reads SLOs but not their tiers may not ask", async () => {
    withPermissions([Permission.ReadServiceLevelObjective]);

    await post(PREVIEW, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(refusal().message).toContain(
      "read SLO error budget policy tiers",
    );
    expect(previewSpy).not.toHaveBeenCalled();
  });

  test("a team that blocks reading tiers may not ask", async () => {
    withPermissions(
      [Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier],
      [Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier],
    );

    await post(PREVIEW, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(refusal()).toBeInstanceOf(Error);
    expect(previewSpy).not.toHaveBeenCalled();
  });

  test("an API key of the project may ask", async () => {
    props = { tenantId: PROJECT, userType: UserType.API };
    withPermissions([
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ]);

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

  test("an SLO the caller may not read is not found", async () => {
    previewSpy.mockRejectedValue(new NotFoundException(SLO_NOT_FOUND_MESSAGE));

    await post(PREVIEW, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(refusal()).toBeInstanceOf(NotFoundException);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test.each([
    ["no body", undefined],
    ["no id", {}],
    ["an id that is not one", { serviceLevelObjectiveId: "not-an-id" }],
    ["a list", [SLO_ID.toString()]],
  ])("%s is refused as bad data", async (_label: string, body: unknown) => {
    await post(PREVIEW, body);

    expect(refusal()).toBeInstanceOf(BadDataException);
    expect(previewSpy).not.toHaveBeenCalled();
  });
});

describe("using the recommended policy", () => {
  test("adds the tiers as the caller and answers what it added, each with its new id", async () => {
    await post(ADD, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(next).not.toHaveBeenCalled();
    expect(addSpy).toHaveBeenCalledTimes(1);
    expect((addSpy.mock.calls[0]![0] as { props: unknown }).props).toBe(props);
    expect(answered()).toEqual({
      tiers: [{ ...CAUTION_JSON, id: TIER_ID.toString() }],
    });
    expect(previewSpy).not.toHaveBeenCalled();
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
  ])("%s may use it: it creates tiers", async (permission: Permission) => {
    withPermissions([permission]);

    await post(ADD, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(next).not.toHaveBeenCalled();
    expect(addSpy).toHaveBeenCalledTimes(1);
  });

  test("a role that only reads tiers may not use it", async () => {
    withPermissions([
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ]);

    await post(ADD, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(refusal().message).toContain(
      "create SLO error budget policy tiers",
    );
    expect(addSpy).not.toHaveBeenCalled();
  });

  test("a credential issued for reading only may not use it", async () => {
    props.isReadOnlyCredential = true;

    await post(ADD, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(refusal()).toBeInstanceOf(Error);
    expect(addSpy).not.toHaveBeenCalled();
  });

  test("an API key that may create tiers may use it", async () => {
    props = { tenantId: PROJECT, userType: UserType.API };
    withPermissions([
      Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
    ]);

    await post(ADD, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(next).not.toHaveBeenCalled();
    expect(addSpy).toHaveBeenCalledTimes(1);
  });

  test("a tier whose create returned no id is answered without one", async () => {
    addSpy.mockResolvedValue({
      serviceLevelObjectiveId: SLO_ID,
      tiers: [{ ...CAUTION, tierId: null }],
    });

    await post(ADD, { serviceLevelObjectiveId: SLO_ID.toString() });

    expect(answered()).toEqual({ tiers: [CAUTION_JSON] });
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
