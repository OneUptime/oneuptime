import { mockRouter } from "./Helpers";
// Loading the API registers its route on the stand-in router.
import {
  readScrubRuleReadersRequest,
  SCRUB_RULE_READERS_PERMISSIONS,
} from "../../../Server/API/ScrubRuleReadersAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import * as TelemetryScrubImpact from "../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubImpact";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
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
  getEmptyTelemetryFieldReadersByKind,
  SCRUB_RULE_READERS_API_PATH,
  TelemetryFieldReaders,
} from "../../../Types/Telemetry/TelemetryFieldReaders";
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
 * WHAT A SCRUB RULE BEING WRITTEN WOULD TAKE AWAY, ASKED OF THE SERVER
 * (Server/API/ScrubRuleReadersAPI, #10433).
 *
 * The scrub rule forms and a rule's Enable ask what reads the values the
 * rule would hide. The route answers whoever may write a log or trace scrub
 * rule - with their own permissions, so the records it names are theirs to
 * read - holds the rule it is asked about to what a saved rule may say, and
 * changes nothing. The lookup itself is stood in for here; it is tested
 * kind by kind in TelemetryFieldReaders.test.ts and TelemetryScrubImpact.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const SERVICE_ID: string = "6b6b6b6b-0000-4000-8000-0000000000b2";

function buildProps(
  permissions: Array<Permission>,
  memberOf: ObjectID = PROJECT_ID,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: memberOf,
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

  map[memberOf.toString()] = tenantPermission;

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: map,
  };
}

function nothingReads(): TelemetryFieldReaders {
  return {
    kinds: getEmptyTelemetryFieldReadersByKind(true),
    securityEvents: { isChecked: true, sources: [], loses: [] },
  };
}

interface RouteCall {
  thrown: unknown;
  answer: JSONObject | undefined;
}

let propsSpy: jest.SpyInstance;
let lookupSpy: jest.SpyInstance;

async function call(body: unknown): Promise<RouteCall> {
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
    .match("POST", SCRUB_RULE_READERS_API_PATH)
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

beforeEach(() => {
  propsSpy = jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(buildProps([Permission.CreateProjectLogScrubRule]));
  lookupSpy = jest
    .spyOn(TelemetryScrubImpact, "findScrubRuleReaders")
    .mockResolvedValue(nothingReads());
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the route", () => {
  test("is a POST behind the signed-in user's own session", () => {
    const route: (typeof mockRouter.routes)[number] = mockRouter.match(
      "POST",
      SCRUB_RULE_READERS_API_PATH,
    );

    expect(route.middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
  });

  test.each(SCRUB_RULE_READERS_PERMISSIONS)(
    "answers whoever may write a scrub rule: %s",
    async (permission: Permission) => {
      propsSpy.mockResolvedValue(buildProps([permission]));

      const result: RouteCall = await call({
        signal: "trace",
        patternType: "email",
        serviceId: SERVICE_ID,
      });

      expect(result.thrown).toBeUndefined();
      expect(result.answer).toEqual(nothingReads());
    },
  );

  test("asks the lookup with the caller's own permissions, for their project, and the rule as asked", async () => {
    const result: RouteCall = await call({
      signal: "log",
      patternType: "ipAddress",
      scrubAction: "hash",
      fieldsToScrub: "attributes",
      serviceId: SERVICE_ID.toUpperCase(),
    });

    expect(result.thrown).toBeUndefined();
    expect(lookupSpy).toHaveBeenCalledTimes(1);

    const asked: Parameters<
      typeof TelemetryScrubImpact.findScrubRuleReaders
    >[0] = lookupSpy.mock.calls[0]![0];

    expect(asked.projectId).toEqual(PROJECT_ID);
    expect(asked.rule).toEqual({
      signal: "log",
      patternType: "ipAddress",
      scrubAction: "hash",
      fieldsToScrub: "attributes",
      serviceId: SERVICE_ID,
    });
    // Never as OneUptime itself: the records named are the caller's.
    expect(asked.props.isRoot).toBeFalsy();
    expect(asked.props.userId).toEqual(USER_ID);
  });

  test("refuses whoever may only read scrub rules, before it reads anything", async () => {
    propsSpy.mockResolvedValue(
      buildProps([
        Permission.ReadProjectLogScrubRule,
        Permission.ReadProjectTraceScrubRule,
      ]),
    );

    const result: RouteCall = await call({
      signal: "log",
      patternType: "email",
    });

    expect(result.thrown).toBeDefined();
    expect(String((result.thrown as Error).message)).toContain(
      "You do not have permission to create or edit scrub rules",
    );
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  test("refuses a rule it cannot read, before it reads anything", async () => {
    const result: RouteCall = await call({ signal: "metric" });

    expect(result.thrown).toBeInstanceOf(BadDataException);
    expect(lookupSpy).not.toHaveBeenCalled();
  });
});

describe("the rule it is asked about", () => {
  test("a log or a trace rule, with its own pattern types and fields", () => {
    expect(
      readScrubRuleReadersRequest({
        signal: "trace",
        patternType: "custom",
        customRegex: "SECRET-[0-9]+",
        fieldsToScrub: "events",
        scrubAction: "mask",
      }),
    ).toEqual({
      signal: "trace",
      patternType: "custom",
      customRegex: "SECRET-[0-9]+",
      fieldsToScrub: "events",
      scrubAction: "mask",
    });
    // Left out, the server's defaults apply: nothing more is said.
    expect(
      readScrubRuleReadersRequest({ signal: "log", patternType: "email" }),
    ).toEqual({ signal: "log", patternType: "email" });
  });

  test.each([
    [{}, "signal"],
    [{ signal: "metric", patternType: "email" }, "signal"],
    [{ signal: "log" }, "pattern types"],
    [{ signal: "log", patternType: "creditcard" }, "pattern types"],
    [
      { signal: "trace", patternType: "email", fieldsToScrub: "body" },
      "fields to scrub",
    ],
    [
      { signal: "log", patternType: "email", fieldsToScrub: "name" },
      "fields to scrub",
    ],
    [
      { signal: "log", patternType: "email", scrubAction: "delete" },
      "scrub action",
    ],
    [{ signal: "log", patternType: "email", serviceId: "checkout" }, "service"],
  ] as Array<[unknown, string]>)(
    "refuses %p, saying what it takes",
    (body: unknown, says: string) => {
      expect(() => {
        return readScrubRuleReadersRequest(body);
      }).toThrow(BadDataException);
      expect(() => {
        return readScrubRuleReadersRequest(body);
      }).toThrow(says);
    },
  );

  test("a body that is no object is no rule", () => {
    for (const body of [undefined, null, "log", ["log"]]) {
      expect(() => {
        return readScrubRuleReadersRequest(body);
      }).toThrow(BadDataException);
    }
  });
});
