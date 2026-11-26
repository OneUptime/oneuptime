import { mockRouter } from "./Helpers";
// Loading the API registers its routes on the stand-in router.
import {
  readScrubRuleValueCounts,
  SCRUB_RULE_READ_PERMISSIONS,
} from "../../../Server/API/ScrubRuleValueCountsAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ScrubRuleValueCountService from "../../../Server/Services/ScrubRuleValueCountService";
import ServiceService from "../../../Server/Services/ServiceService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  foldScrubRuleValueCounts,
  MAX_SCRUB_RULES_PER_COUNT_REQUEST,
  readScrubRuleValueCountsAnswer,
  readScrubRuleValueCountsRequest,
  SCRUB_RULE_VALUE_COUNTS_API_PATH,
  ScrubRuleValueCountsAnswer,
} from "../../../Types/Telemetry/ScrubRuleValueCounts";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

/*
 * HOW MANY VALUES EACH SCRUB RULE CHANGED, BY SERVICE AND VERSION, ASKED OF
 * THE SERVER (Server/API/ScrubRuleValueCountsAPI, #10366).
 *
 * The rule lists ask for the rules on their page: answered for whoever may
 * read that kind of rule, from the project's own counts, with a service
 * named only where the person may read it. A request is held to what it
 * may ask.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const RULE_ID: string = "0192f1a0-0000-7000-8000-000000103661";
const OTHER_RULE_ID: string = "0192f1a0-0000-7000-8000-000000103662";
const CHECKOUT: string = "0192f1a0-0000-7000-8000-000000103671";
const PAYMENTS: string = "0192f1a0-0000-7000-8000-000000103672";

function buildProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };
  const map: Dictionary<UserTenantAccessPermission> = {};

  map[PROJECT_ID.toString()] = tenantPermission;

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: map,
  };
}

async function call(body: unknown): Promise<{
  thrown: unknown;
  answer: JSONObject | undefined;
}> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body,
    headers: {},
  } as unknown as ExpressRequest;
  const next: jest.Mock = jest.fn();
  const send: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  const before: number = send.mock.calls.length;

  await mockRouter
    .match("POST", SCRUB_RULE_VALUE_COUNTS_API_PATH)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return {
    thrown: next.mock.calls[0]?.[0],
    answer:
      send.mock.calls.length > before
        ? (send.mock.calls[send.mock.calls.length - 1]![2] as JSONObject)
        : undefined,
  };
}

const ROWS: Array<{
  scrubRuleId: string;
  serviceId: string;
  serviceVersion: string;
  valueCount: number;
  lastChangedAt: Date | null;
}> = [
  {
    scrubRuleId: RULE_ID,
    serviceId: CHECKOUT,
    serviceVersion: "2.4.0",
    valueCount: 40,
    lastChangedAt: new Date("2026-11-21T08:00:00.000Z"),
  },
  {
    scrubRuleId: RULE_ID,
    serviceId: CHECKOUT,
    serviceVersion: "2.5.0",
    valueCount: 2,
    lastChangedAt: new Date("2026-11-22T09:00:00.000Z"),
  },
  {
    scrubRuleId: RULE_ID,
    serviceId: PAYMENTS,
    serviceVersion: "",
    valueCount: 7,
    lastChangedAt: null,
  },
];

let readSpy: jest.SpyInstance;

beforeEach(() => {
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(buildProps([Permission.ReadProjectLogScrubRule]));
  readSpy = jest
    .spyOn(ScrubRuleValueCountService, "readValueCounts")
    .mockResolvedValue(ROWS as never);
  // The person may read checkout, not payments.
  jest
    .spyOn(ServiceService, "findBy")
    .mockResolvedValue([
      { id: new ObjectID(CHECKOUT), name: "checkout" },
    ] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a request, held to what it may ask", () => {
  test("a kind of rule and its rules' ids, each once, in lower case, at most a page and some", () => {
    expect(
      readScrubRuleValueCountsRequest({
        signal: "log",
        scrubRuleIds: [RULE_ID, RULE_ID.toUpperCase(), "not-an-id", 7],
      }),
    ).toEqual({ signal: "log", scrubRuleIds: [RULE_ID] });
    expect(readScrubRuleValueCountsRequest({ signal: "metric" })).toBeNull();
    expect(
      readScrubRuleValueCountsRequest({
        signal: "trace",
        scrubRuleIds: Array.from(
          { length: MAX_SCRUB_RULES_PER_COUNT_REQUEST + 10 },
          (): string => {
            return ObjectID.generate().toString();
          },
        ),
      })!.scrubRuleIds,
    ).toHaveLength(MAX_SCRUB_RULES_PER_COUNT_REQUEST);
  });
});

describe("the counts", () => {
  test("each rule's, by service and version, the most first, a service named only where the person may read it", async () => {
    const answer: ScrubRuleValueCountsAnswer = await readScrubRuleValueCounts({
      projectId: PROJECT_ID,
      request: { signal: "log", scrubRuleIds: [RULE_ID, OTHER_RULE_ID] },
      props: buildProps([Permission.ReadProjectLogScrubRule]),
      now: new Date("2026-11-22T10:00:00.000Z"),
    });

    expect(answer.since).toBe("2026-11-15T10:00:00.000Z");
    expect(answer.days).toBe(7);
    expect(answer.isChecked).toBe(true);
    expect(answer.rules).toEqual([
      {
        scrubRuleId: RULE_ID,
        valueCount: 49,
        lastChangedAt: "2026-11-22T09:00:00.000Z",
        services: [
          expect.objectContaining({
            serviceName: "checkout",
            serviceVersion: "2.4.0",
            valueCount: 40,
          }),
          expect.objectContaining({ serviceName: "", valueCount: 7 }),
          expect.objectContaining({
            serviceName: "checkout",
            serviceVersion: "2.5.0",
            valueCount: 2,
          }),
        ],
      },
    ]);
    expect(readSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      scrubRuleIds: [RULE_ID, OTHER_RULE_ID],
      since: new Date("2026-11-15T10:00:00.000Z"),
    });
  });

  test("counts that cannot be read just now say nothing of any rule", async () => {
    readSpy.mockRejectedValue(new Error("ClickHouse is down"));

    const answer: ScrubRuleValueCountsAnswer = await readScrubRuleValueCounts({
      projectId: PROJECT_ID,
      request: { signal: "log", scrubRuleIds: [RULE_ID] },
      props: buildProps([Permission.ReadProjectLogScrubRule]),
    });

    expect(answer.isChecked).toBe(false);
    expect(answer.rules).toEqual([]);
  });

  test("an answer read back keeps only what is one", () => {
    expect(
      readScrubRuleValueCountsAnswer({
        since: "2026-11-15T10:00:00.000Z",
        days: 7,
        isChecked: true,
        rules: [
          { scrubRuleId: "nope", valueCount: 3 },
          {
            scrubRuleId: RULE_ID,
            valueCount: -4,
            services: [{ serviceId: CHECKOUT, valueCount: "9" }],
          },
        ],
      }).rules,
    ).toEqual([
      {
        scrubRuleId: RULE_ID,
        valueCount: 0,
        lastChangedAt: "",
        services: [
          {
            serviceId: CHECKOUT,
            serviceName: "",
            serviceVersion: "",
            valueCount: 0,
            lastChangedAt: "",
          },
        ],
      },
    ]);
    expect(foldScrubRuleValueCounts([], new Map())).toEqual([]);
  });
});

describe("the route", () => {
  test("is a POST behind the signed-in user's own session", () => {
    expect(
      mockRouter.match("POST", SCRUB_RULE_VALUE_COUNTS_API_PATH).middlewares,
    ).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
  });

  test("whoever may read the kind of rule may ask", () => {
    expect(SCRUB_RULE_READ_PERMISSIONS.log).toContain(
      Permission.ReadProjectLogScrubRule,
    );
    expect(SCRUB_RULE_READ_PERMISSIONS.trace).toContain(
      Permission.ReadProjectTraceScrubRule,
    );
  });

  test("answers the person's project", async () => {
    const result: { thrown: unknown; answer: JSONObject | undefined } =
      await call({ signal: "log", scrubRuleIds: [RULE_ID] });

    expect(result.thrown).toBeUndefined();
    expect(
      (result.answer as unknown as ScrubRuleValueCountsAnswer).rules[0]!
        .valueCount,
    ).toBe(49);
    expect(readSpy.mock.calls[0]![0].projectId).toEqual(PROJECT_ID);
  });

  test("refuses whoever may not read that kind of rule, before anything is read", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(buildProps([Permission.ReadProjectLogScrubRule]));

    const result: { thrown: unknown } = await call({
      signal: "trace",
      scrubRuleIds: [RULE_ID],
    });

    expect(String(result.thrown)).toContain(
      "You do not have permission to read trace scrub rules",
    );
    expect(readSpy).not.toHaveBeenCalled();
  });

  test("refuses a request that asks nothing it may", async () => {
    const result: { thrown: unknown } = await call({ signal: "metric" });

    expect(result.thrown).toBeInstanceOf(BadDataException);
    expect(readSpy).not.toHaveBeenCalled();
  });
});
