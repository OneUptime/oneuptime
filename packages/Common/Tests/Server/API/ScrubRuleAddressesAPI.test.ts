import { mockRouter } from "./Helpers";
// Loading the API registers its routes on the stand-in router.
import {
  readScrubRuleHashInsteadRequest,
  SCRUB_RULE_EDIT_PERMISSIONS,
  SCRUB_RULES_HIDING_ADDRESSES_PERMISSIONS,
} from "../../../Server/API/ScrubRuleAddressesAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import * as ScrubRuleHashInstead from "../../../Server/Utils/SecurityEvent/ScrubRuleHashInstead";
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
import LogScrubAction from "../../../Types/Log/LogScrubAction";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  SCRUB_RULE_HASH_INSTEAD_API_PATH,
  SCRUB_RULES_HIDING_ADDRESSES_API_PATH,
  ScrubRuleHidingAddresses,
  ScrubRulesHidingAddressesAnswer,
} from "../../../Types/Telemetry/ScrubRuleAddresses";
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
 * THE SCRUB RULES THAT HIDE ADDRESSES FROM SECURITY EVENTS, AND HASH
 * INSTEAD, ASKED OF THE SERVER (Server/API/ScrubRuleAddressesAPI, #10396).
 *
 * The list answers whoever may read scrub rules, with their own props; Hash
 * Instead answers whoever may edit scrub rules of the rule's kind, with
 * their own props, and refuses anyone else before it reads anything. The
 * work itself is stood in for here; it is tested in ScrubRuleHashInstead.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const RULE_ID: string = "0192f1a0-0000-7000-8000-0000001039c1";

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

interface RouteCall {
  thrown: unknown;
  answer: JSONObject | undefined;
}

async function call(path: string, body: unknown): Promise<RouteCall> {
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
    .match("POST", path)
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

const LISTED: ScrubRulesHidingAddressesAnswer = {
  isChecked: true,
  signalsRead: ["log"],
  rules: [
    {
      signal: "log",
      ruleId: RULE_ID,
      ruleName: "Scrub IP addresses",
      scrubAction: LogScrubAction.Redact,
    },
  ],
};

const SWITCHED: ScrubRuleHidingAddresses = {
  signal: "log",
  ruleId: RULE_ID,
  ruleName: "Scrub IP addresses",
  scrubAction: LogScrubAction.Hash,
};

let propsSpy: jest.SpyInstance;
let listSpy: jest.SpyInstance;
let switchSpy: jest.SpyInstance;

beforeEach(() => {
  propsSpy = jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(buildProps([Permission.ReadProjectLogScrubRule]));
  listSpy = jest
    .spyOn(ScrubRuleHashInstead, "findScrubRulesHidingAddressesFor")
    .mockResolvedValue(LISTED);
  switchSpy = jest
    .spyOn(ScrubRuleHashInstead, "switchScrubRuleToHash")
    .mockResolvedValue(SWITCHED);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the list of rules that hide addresses", () => {
  test("is a POST behind the signed-in user's own session", () => {
    expect(
      mockRouter.match("POST", SCRUB_RULES_HIDING_ADDRESSES_API_PATH)
        .middlewares,
    ).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
  });

  test("whoever may read either kind of scrub rule may ask", () => {
    for (const permission of [
      Permission.ReadProjectLogScrubRule,
      Permission.ReadProjectTraceScrubRule,
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]) {
      expect(SCRUB_RULES_HIDING_ADDRESSES_PERMISSIONS).toContain(permission);
    }
  });

  test("answers with the person's own props, for their project", async () => {
    const result: RouteCall = await call(
      SCRUB_RULES_HIDING_ADDRESSES_API_PATH,
      {},
    );

    expect(result.thrown).toBeUndefined();
    expect(result.answer).toEqual(LISTED);

    const asked: Parameters<
      typeof ScrubRuleHashInstead.findScrubRulesHidingAddressesFor
    >[0] = listSpy.mock.calls[0]![0];

    expect(asked.projectId).toEqual(PROJECT_ID);
    expect(asked.props.isRoot).toBeFalsy();
    expect(asked.props.userId).toEqual(USER_ID);
  });

  test("refuses whoever may read no scrub rule, before it reads anything", async () => {
    propsSpy.mockResolvedValue(buildProps([Permission.ReadDataStore]));

    const result: RouteCall = await call(
      SCRUB_RULES_HIDING_ADDRESSES_API_PATH,
      {},
    );

    expect(String((result.thrown as Error).message)).toContain(
      "You do not have permission to read scrub rules",
    );
    expect(listSpy).not.toHaveBeenCalled();
  });
});

describe("Hash Instead", () => {
  test("switches the rule as the person, who may edit scrub rules of its kind", async () => {
    propsSpy.mockResolvedValue(
      buildProps([Permission.EditProjectLogScrubRule]),
    );

    const result: RouteCall = await call(SCRUB_RULE_HASH_INSTEAD_API_PATH, {
      signal: "log",
      ruleId: RULE_ID,
    });

    expect(result.thrown).toBeUndefined();
    expect(result.answer).toEqual(SWITCHED);

    const asked: Parameters<
      typeof ScrubRuleHashInstead.switchScrubRuleToHash
    >[0] = switchSpy.mock.calls[0]![0];

    expect(asked.signal).toBe("log");
    expect(asked.ruleId.toString()).toBe(RULE_ID);
    expect(asked.props.isRoot).toBeFalsy();
  });

  test("refuses whoever may edit only the other kind, or only read, before it reads anything", async () => {
    propsSpy.mockResolvedValue(
      buildProps([
        Permission.EditProjectLogScrubRule,
        Permission.ReadProjectTraceScrubRule,
      ]),
    );

    const traces: RouteCall = await call(SCRUB_RULE_HASH_INSTEAD_API_PATH, {
      signal: "trace",
      ruleId: RULE_ID,
    });

    expect(String((traces.thrown as Error).message)).toContain(
      "You do not have permission to edit trace scrub rules",
    );

    propsSpy.mockResolvedValue(
      buildProps([Permission.ReadProjectLogScrubRule]),
    );

    const readOnly: RouteCall = await call(SCRUB_RULE_HASH_INSTEAD_API_PATH, {
      signal: "log",
      ruleId: RULE_ID,
    });

    expect(String((readOnly.thrown as Error).message)).toContain(
      "You do not have permission to edit log scrub rules",
    );
    expect(switchSpy).not.toHaveBeenCalled();
  });

  test("each kind's edit permission is the rule's own", () => {
    expect(SCRUB_RULE_EDIT_PERMISSIONS.log).toContain(
      Permission.EditProjectLogScrubRule,
    );
    expect(SCRUB_RULE_EDIT_PERMISSIONS.trace).toContain(
      Permission.EditProjectTraceScrubRule,
    );
    expect(SCRUB_RULE_EDIT_PERMISSIONS.log).not.toContain(
      Permission.EditProjectTraceScrubRule,
    );
  });

  test("its request names a kind and a rule, or is refused", () => {
    expect(
      readScrubRuleHashInsteadRequest({ signal: "trace", ruleId: RULE_ID }),
    ).toEqual({ signal: "trace", ruleId: RULE_ID });

    for (const body of [
      {},
      { signal: "metric", ruleId: RULE_ID },
      { signal: "log" },
      { signal: "log", ruleId: "checkout" },
      undefined,
      ["log"],
    ]) {
      expect(() => {
        return readScrubRuleHashInsteadRequest(body);
      }).toThrow(BadDataException);
    }
  });
});
