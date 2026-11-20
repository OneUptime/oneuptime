import CommonAPI from "../../../Server/API/CommonAPI";
import LogAggregationService from "../../../Server/Services/LogAggregationService";
import TraceAggregationService from "../../../Server/Services/TraceAggregationService";
import ExceptionAggregationService from "../../../Server/Services/ExceptionAggregationService";
import LogScrubRuleService from "../../../Server/Services/LogScrubRuleService";
import TraceScrubRuleService from "../../../Server/Services/TraceScrubRuleService";
import OwnerTableRegistry from "../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import HashedAddressSearch, {
  HashedAddressTokens,
} from "../../../Server/Utils/Telemetry/HashedAddressSearch";
import ScrubHashToken from "../../../Server/Utils/Telemetry/ScrubHashToken";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  MAX_HASHED_ADDRESS_SEARCH_TEXTS,
  MAX_HASHED_ADDRESS_SEARCH_TEXT_LENGTH,
} from "../../../Types/Telemetry/HashedAddressSearch";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A SEARCH FOR AN IP ADDRESS, THROUGH THE REAL ROUTES (#10418).
 *
 * Who may search a hashed address is who may read the telemetry: the same
 * people who could read the address before the rule. Each route below runs
 * through its real guards and handler; only the ClickHouse reads behind it
 * (the aggregation services) and the Postgres reads of the scrub rules and
 * the owner registry are answered here.
 *
 *  - A chart's, facets' or export's read is handed the tokens of the
 *    caller's own project - never another's - and only in a project whose
 *    rules hash addresses, alongside the same service filter it always had.
 *  - An explorer's question (/telemetry/{signal}/hashed-address-search)
 *    takes the signal's own read access, answers from the project's scrub
 *    rules and no record, names only addresses the person typed, and a
 *    caller who may read none of the signal's records hears of none.
 * ---------------------------------------------------------------------------
 */

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

interface RecordedRoute {
  method: string;
  uri: string;
  handlers: Array<RouterFunction>;
}

const recordedRoutes: Array<RecordedRoute> = [];

const recordRoute: (
  method: string,
) => (uri: string, ...handlers: Array<RouterFunction>) => void = (
  method: string,
) => {
  return (uri: string, ...handlers: Array<RouterFunction>): void => {
    recordedRoutes.push({ method: method.toUpperCase(), uri, handlers });
  };
};

const telemetryRouter: JSONObject = {
  get: recordRoute("get"),
  post: recordRoute("post"),
  put: recordRoute("put"),
  delete: recordRoute("delete"),
} as unknown as JSONObject;

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return telemetryRouter;
    },
    getClientIp: () => {
      return "198.51.100.200";
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
  };
});

const PROJECT: ObjectID = new ObjectID("0193b0a1-0000-7000-8000-0000000f1041");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-0000001f1041",
);
const PROJECT_WITHOUT_RULE: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-0000002f1041",
);
const USER_ID: ObjectID = ObjectID.generate();
const LABEL_WITH_NO_SERVICE: ObjectID = ObjectID.generate();

const ADDRESS: string = "203.0.113.7";

const tokenIn: (projectId: ObjectID) => string = (
  projectId: ObjectID,
): string => {
  return ScrubHashToken.ofIpAddress({ projectId, address: ADDRESS });
};

interface Principal {
  request: JSONObject;
  props: DatabaseCommonInteractionProps;
}

const row: (
  permission: Permission,
  data?: { scope?: PermissionScope; labelIds?: Array<ObjectID> },
) => UserPermission = (
  permission: Permission,
  data: { scope?: PermissionScope; labelIds?: Array<ObjectID> } = {},
): UserPermission => {
  return {
    _type: "UserPermission",
    permission,
    scope: data.scope || PermissionScope.All,
    labelIds: data.labelIds || [],
    isBlockPermission: false,
  } as UserPermission;
};

const principalOf: (
  projectId: ObjectID,
  permissions: Array<UserPermission>,
) => Principal = (
  projectId: ObjectID,
  permissions: Array<UserPermission>,
): Principal => {
  const permissionMap: JSONObject = {
    [projectId.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId,
      permissions,
    },
  } as unknown as JSONObject;

  return {
    request: {
      userType: UserType.User,
      tenantId: projectId,
      userTenantAccessPermission: permissionMap,
      userAuthorization: { userId: USER_ID },
    } as unknown as JSONObject,
    props: {
      tenantId: projectId,
      userId: USER_ID,
      userType: UserType.User,
      userTeamIds: [],
      userTenantAccessPermission: permissionMap as never,
    },
  };
};

const PROJECT_MEMBER: Principal = principalOf(PROJECT, [
  row(Permission.ProjectMember),
]);
const OTHER_PROJECT_MEMBER: Principal = principalOf(OTHER_PROJECT, [
  row(Permission.ProjectMember),
]);
const MEMBER_WITHOUT_RULE: Principal = principalOf(PROJECT_WITHOUT_RULE, [
  row(Permission.ProjectMember),
]);
const LOG_READER_ONLY: Principal = principalOf(PROJECT, [
  row(Permission.ReadTelemetryServiceLog),
]);
const NO_TELEMETRY_READER: Principal = principalOf(PROJECT, [
  row(Permission.ReadIncidentSla),
]);
const LOG_READER_OF_NO_SERVICE: Principal = principalOf(PROJECT, [
  row(Permission.ReadTelemetryServiceLog, {
    scope: PermissionScope.Labels,
    labelIds: [LABEL_WITH_NO_SERVICE],
  }),
]);

let currentPrincipal: Principal = PROJECT_MEMBER;

// A read stubbed to answer nothing, and what it was handed.
interface StubbedRead {
  mock: { calls: Array<Array<unknown>> };
}

const stubRead: (service: unknown, method: string) => StubbedRead = (
  service: unknown,
  method: string,
): StubbedRead => {
  return jest
    .spyOn(service as never, method as never)
    .mockResolvedValue([] as never) as unknown as StubbedRead;
};

// The tokens a read's request was handed, if any.
const tokensOf: (request: unknown) => HashedAddressTokens | undefined = (
  request: unknown,
): HashedAddressTokens | undefined => {
  return (request as Record<string, unknown>)["hashedAddresses"] as unknown as
    | HashedAddressTokens
    | undefined;
};

interface CallResult {
  thrownToNext: unknown;
  errorResponse: unknown;
  answer: JSONObject | undefined;
}

const callRoute: (data: {
  uri: string;
  principal: Principal;
  body: JSONObject;
}) => Promise<CallResult> = async (data: {
  uri: string;
  principal: Principal;
  body: JSONObject;
}): Promise<CallResult> => {
  currentPrincipal = data.principal;

  const route: RecordedRoute | undefined = recordedRoutes.find(
    (candidate: RecordedRoute): boolean => {
      return candidate.method === "POST" && candidate.uri === data.uri;
    },
  );

  if (!route) {
    throw new Error(`Route not registered: POST ${data.uri}`);
  }

  const req: ExpressRequest = {
    ...data.principal.request,
    body: data.body,
    params: {},
    query: {},
    headers: { "user-agent": "jest-agent" },
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    setHeader: (): void => {},
    send: (): void => {},
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as ExpressResponse;

  const outcome: CallResult = {
    thrownToNext: undefined,
    errorResponse: undefined,
    answer: undefined,
  };

  // From requireUserAuthentication on: getUserMiddleware only fills what the request carries already.
  for (let index: number = 1; index < route.handlers.length; index++) {
    const handler: RouterFunction = route.handlers[index]!;
    const step: { calledNext: boolean } = { calledNext: false };

    await handler(req, res, ((error?: unknown): void => {
      step.calledNext = true;

      if (error) {
        outcome.thrownToNext = error;
      }
    }) as unknown as NextFunction);

    if (!step.calledNext || outcome.thrownToNext) {
      break;
    }
  }

  const errorCall: Array<unknown> | undefined = (
    Response.sendErrorResponse as unknown as jest.Mock
  ).mock.calls[0] as Array<unknown> | undefined;
  outcome.errorResponse = errorCall ? errorCall[2] : undefined;

  const answerCall: Array<unknown> | undefined = (
    Response.sendJsonObjectResponse as unknown as jest.Mock
  ).mock.calls[0] as Array<unknown> | undefined;
  outcome.answer = answerCall ? (answerCall[2] as JSONObject) : undefined;

  return outcome;
};

// How many times a read asked for the project's scrub rules.
const counted: { ruleReads: number } = { ruleReads: 0 };

beforeAll(() => {
  recordedRoutes.length = 0;
  // Loaded after the router mock exists: TelemetryAPI asks for its router at module scope.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../../../Server/API/TelemetryAPI");
});

beforeEach(() => {
  jest.clearAllMocks();
  HashedAddressSearch.clearCache();
  counted.ruleReads = 0;

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation((async () => {
      return { ...currentPrincipal.props };
    }) as never);

  // PROJECT and OTHER_PROJECT hash IP addresses out of their logs and spans.
  for (const service of [LogScrubRuleService, TraceScrubRuleService]) {
    jest.spyOn(service, "countBy").mockImplementation((async (countBy: {
      query: JSONObject;
    }) => {
      counted.ruleReads++;
      const projectId: string = String(countBy.query["projectId"]);

      return new PositiveNumber(
        projectId === PROJECT.toString() ||
        projectId === OTHER_PROJECT.toString()
          ? 1
          : 0,
      );
    }) as never);
  }

  // No resource carries the label the label reader may read.
  for (const [, entry] of OwnerTableRegistry.entries()) {
    if (!entry.canOwnTelemetry || !entry.modelService) {
      continue;
    }

    jest.spyOn(entry.ownerUserService, "findBy").mockResolvedValue([] as never);
    jest.spyOn(entry.ownerTeamService, "findBy").mockResolvedValue([] as never);
    jest.spyOn(entry.modelService, "findBy").mockResolvedValue([] as never);
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

const LAST_HOUR: JSONObject = {
  startTime: "2026-11-20T11:00:00.000Z",
  endTime: "2026-11-20T12:00:00.000Z",
};

describe("a chart's read is handed the caller's own project's tokens", () => {
  const histogramTokens: (principal: Principal) => Promise<{
    tokens: HashedAddressTokens | undefined;
    request: JSONObject;
  }> = async (
    principal: Principal,
  ): Promise<{
    tokens: HashedAddressTokens | undefined;
    request: JSONObject;
  }> => {
    const read: StubbedRead = stubRead(LogAggregationService, "getHistogram");

    const result: CallResult = await callRoute({
      uri: "/telemetry/logs/histogram",
      principal,
      body: {
        ...LAST_HOUR,
        bodySearchText: ADDRESS,
        attributes: { "client.address": ADDRESS },
      },
    });

    expect(result.thrownToNext).toBeUndefined();
    expect(result.errorResponse).toBeUndefined();

    const request: JSONObject = read.mock.calls[0]![0] as JSONObject;

    return {
      tokens: tokensOf(request),
      request,
    };
  };

  test("a logs histogram, in a project that hashes addresses", async () => {
    const { tokens } = await histogramTokens(PROJECT_MEMBER);

    expect(tokens?.hashedFormOf(ADDRESS)).toBe(tokenIn(PROJECT));
  });

  test("never across projects: another project's member gets their project's token", async () => {
    const { tokens } = await histogramTokens(OTHER_PROJECT_MEMBER);

    expect(tokens?.hashedFormOf(ADDRESS)).toBe(tokenIn(OTHER_PROJECT));
    expect(tokens?.hashedFormOf(ADDRESS)).not.toBe(tokenIn(PROJECT));
  });

  test("in a project with no Hash rule the read is handed none, and reads as it did", async () => {
    const { tokens, request } = await histogramTokens(MEMBER_WITHOUT_RULE);

    expect(tokens).toBeUndefined();
    expect(request["bodySearchText"]).toBe(ADDRESS);
  });

  test("a search that names no address reads no rule", async () => {
    jest
      .spyOn(LogAggregationService, "getHistogram")
      .mockResolvedValue([] as never);

    await callRoute({
      uri: "/telemetry/logs/histogram",
      principal: PROJECT_MEMBER,
      body: { ...LAST_HOUR, bodySearchText: "timeout" },
    });

    expect(counted.ruleReads).toBe(0);
  });

  test("the logs facets: every facet's read", async () => {
    const read: StubbedRead = stubRead(LogAggregationService, "getFacetValues");

    await callRoute({
      uri: "/telemetry/logs/facets",
      principal: PROJECT_MEMBER,
      body: {
        ...LAST_HOUR,
        facetKeys: ["severityText"],
        attributes: { "client.address": ADDRESS },
      },
    });

    expect(read.mock.calls.length).toBeGreaterThan(0);

    for (const call of read.mock.calls) {
      expect(tokensOf(call[0])?.hashedFormOf(ADDRESS)).toBe(tokenIn(PROJECT));
    }
  });

  test("the traces histogram", async () => {
    const read: StubbedRead = stubRead(TraceAggregationService, "getHistogram");

    await callRoute({
      uri: "/telemetry/traces/histogram",
      principal: PROJECT_MEMBER,
      body: { ...LAST_HOUR, nameSearchText: `GET ${ADDRESS}` },
    });

    expect(tokensOf(read.mock.calls[0]![0])?.hashedFormOf(ADDRESS)).toBe(
      tokenIn(PROJECT),
    );
  });

  test("the exceptions histogram", async () => {
    const read: StubbedRead = stubRead(
      ExceptionAggregationService,
      "getHistogram",
    );

    await callRoute({
      uri: "/telemetry/exceptions/histogram",
      principal: PROJECT_MEMBER,
      body: { ...LAST_HOUR, messageSearchText: `connect ${ADDRESS}` },
    });

    expect(tokensOf(read.mock.calls[0]![0])?.hashedFormOf(ADDRESS)).toBe(
      tokenIn(PROJECT),
    );
  });

  test("a caller who may not read logs is refused before anything is read", async () => {
    const read: StubbedRead = stubRead(LogAggregationService, "getHistogram");

    const result: CallResult = await callRoute({
      uri: "/telemetry/logs/histogram",
      principal: NO_TELEMETRY_READER,
      body: { ...LAST_HOUR, bodySearchText: ADDRESS },
    });

    expect(result.thrownToNext || result.errorResponse).toBeDefined();
    expect(read.mock.calls).toHaveLength(0);
    expect(counted.ruleReads).toBe(0);
  });
});

describe("an explorer's question: which addresses did the search match by token", () => {
  const ask: (
    uri: string,
    principal: Principal,
    body?: JSONObject,
  ) => Promise<CallResult> = async (
    uri: string,
    principal: Principal,
    body: JSONObject = { texts: [ADDRESS, "timeout", "10.0.0.12"] },
  ): Promise<CallResult> => {
    return await callRoute({ uri, principal, body });
  };

  test.each([
    "/telemetry/logs/hashed-address-search",
    "/telemetry/traces/hashed-address-search",
    "/telemetry/exceptions/hashed-address-search",
  ])(
    "%s names the typed address its search also matches",
    async (uri: string) => {
      const result: CallResult = await ask(uri, PROJECT_MEMBER);

      expect(result.thrownToNext).toBeUndefined();
      expect(result.errorResponse).toBeUndefined();
      expect(result.answer).toEqual({ addresses: [ADDRESS] });
    },
  );

  test("none in a project whose rules hash no address", async () => {
    const result: CallResult = await ask(
      "/telemetry/logs/hashed-address-search",
      MEMBER_WITHOUT_RULE,
    );

    expect(result.answer).toEqual({ addresses: [] });
  });

  test("a caller who may read logs, and not spans, is answered for logs and refused for traces", async () => {
    expect(
      (await ask("/telemetry/logs/hashed-address-search", LOG_READER_ONLY))
        .answer,
    ).toEqual({ addresses: [ADDRESS] });

    jest.clearAllMocks();

    const traces: CallResult = await ask(
      "/telemetry/traces/hashed-address-search",
      LOG_READER_ONLY,
    );

    expect(traces.thrownToNext || traces.errorResponse).toBeDefined();
    expect(traces.answer).toBeUndefined();
  });

  test("a caller who may read no telemetry is refused, and no rule is read", async () => {
    const result: CallResult = await ask(
      "/telemetry/logs/hashed-address-search",
      NO_TELEMETRY_READER,
    );

    expect(result.thrownToNext || result.errorResponse).toBeDefined();
    expect(result.answer).toBeUndefined();
    expect(counted.ruleReads).toBe(0);
  });

  test("a caller whose read scope reaches no log hears of no address", async () => {
    const result: CallResult = await ask(
      "/telemetry/logs/hashed-address-search",
      LOG_READER_OF_NO_SERVICE,
    );

    expect(result.thrownToNext).toBeUndefined();
    expect(result.answer).toEqual({ addresses: [] });
  });

  test.each([
    ["no texts", {}],
    ["texts that are no list", { texts: ADDRESS }],
    ["a text that is no string", { texts: [ADDRESS, 7] }],
    [
      "more texts than one question holds",
      {
        texts: Array.from(
          { length: MAX_HASHED_ADDRESS_SEARCH_TEXTS + 1 },
          (): string => {
            return ADDRESS;
          },
        ),
      },
    ],
    [
      "a text longer than one question holds",
      { texts: ["a".repeat(MAX_HASHED_ADDRESS_SEARCH_TEXT_LENGTH + 1)] },
    ],
  ])("%s is refused as a bad request", async (_case: string, body: unknown) => {
    const result: CallResult = await ask(
      "/telemetry/logs/hashed-address-search",
      PROJECT_MEMBER,
      body as JSONObject,
    );

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(result.answer).toBeUndefined();
    expect(counted.ruleReads).toBe(0);
  });
});
