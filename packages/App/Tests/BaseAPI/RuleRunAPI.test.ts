import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CommonAPI from "Common/Server/API/CommonAPI";
import RuleRunner from "Common/Server/Utils/Rules/RuleRun/RuleRunner";
import RuleRunPermission from "Common/Server/Utils/Rules/RuleRun/RuleRunPermission";
import Response from "Common/Server/Utils/Response";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { RuleRunType } from "Common/Types/Rules/RuleRun";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Rules/RuleRun/RuleRunner", () => {
  return {
    __esModule: true,
    default: { runPass: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Rules/RuleRun/RuleRunPermission", () => {
  return {
    __esModule: true,
    default: { assertCanRun: jest.fn() },
  };
});

/*
 * Contract under test - POST /rule-run/:ruleType/:ruleId/run.
 *
 * The runner and the permission check are tested on their own; what the
 * endpoint owns is the order and strictness of everything before them: a run
 * is always scoped to the caller's project, the permission check always runs
 * before anything is read, and every input is validated rather than coerced -
 * an unknown rule type, a malformed id or cursor, or a "true" string for
 * notifyOwners is a 400, never a guess.
 */

// Importing the module registers its route on the mocked router.
import RuleRunAPI from "../../FeatureSet/BaseAPI/API/RuleRun";

new RuleRunAPI().getRouter();

const ROUTE: string = "/rule-run/:ruleType/:ruleId/run";
const PROJECT_ID: ObjectID = ObjectID.generate();
const RULE_ID: ObjectID = ObjectID.generate();
const CURSOR: ObjectID = ObjectID.generate();

const runner: { runPass: jest.Mock } = RuleRunner as unknown as {
  runPass: jest.Mock;
};
const permission: { assertCanRun: jest.Mock } =
  RuleRunPermission as unknown as { assertCanRun: jest.Mock };
const responseUtil: { sendJsonObjectResponse: jest.Mock } =
  Response as unknown as { sendJsonObjectResponse: jest.Mock };

const PASS_RESULT: JSONObject = {
  resourcesEvaluated: 3,
  resourcesMatched: 2,
  resourcesUpdated: 2,
  itemsAdded: 2,
  itemsRemoved: 0,
  resourcesFailed: 0,
  nextCursor: null,
  ownersNotified: false,
};

function mockProps(
  tenantId: ObjectID | undefined,
): DatabaseCommonInteractionProps {
  const props: DatabaseCommonInteractionProps = {
    tenantId: tenantId,
    userId: ObjectID.generate(),
  } as unknown as DatabaseCommonInteractionProps;

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);

  return props;
}

async function callRoute(data: {
  ruleType?: string | undefined;
  ruleId?: string | undefined;
  body?: JSONObject | undefined;
}): Promise<NextFunction> {
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  const req: ExpressRequest = {
    params: {
      ruleType:
        data.ruleType === undefined
          ? RuleRunType.MonitorLabelRule
          : data.ruleType,
      ruleId: data.ruleId === undefined ? RULE_ID.toString() : data.ruleId,
    },
    body: data.body || {},
  } as unknown as ExpressRequest;

  await mockRouter
    .match("post", ROUTE)
    .handlerFunction(req, {} as ExpressResponse, next);

  return next;
}

function errorFrom(next: NextFunction): Error {
  const calls: Array<Array<unknown>> = (next as unknown as jest.Mock).mock
    .calls as Array<Array<unknown>>;
  expect(calls).toHaveLength(1);
  return calls[0]![0] as Error;
}

describe("RuleRunAPI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    runner.runPass.mockResolvedValue(PASS_RESULT as never);
  });

  test("runs one pass of the rule, scoped to the caller's project", async () => {
    const props: DatabaseCommonInteractionProps = mockProps(PROJECT_ID);

    const next: NextFunction = await callRoute({});

    expect(next).not.toHaveBeenCalled();
    expect(permission.assertCanRun).toHaveBeenCalledWith({
      props: props,
      ruleType: RuleRunType.MonitorLabelRule,
    });

    const args: {
      ruleType: RuleRunType;
      ruleId: ObjectID;
      projectId: ObjectID;
      cursor: ObjectID | null;
      allowOwnerNotification: boolean;
    } = runner.runPass.mock.calls[0]![0] as never;

    expect(args.ruleType).toBe(RuleRunType.MonitorLabelRule);
    expect(args.ruleId.toString()).toBe(RULE_ID.toString());
    expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(args.cursor).toBeNull();
    expect(args.allowOwnerNotification).toBe(false);

    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      PASS_RESULT,
    );
  });

  test("forwards the cursor and an explicit notifyOwners", async () => {
    mockProps(PROJECT_ID);

    await callRoute({
      ruleType: RuleRunType.IncidentOwnerRule,
      body: { cursor: CURSOR.toString(), notifyOwners: true },
    });

    const args: {
      ruleType: RuleRunType;
      cursor: ObjectID | null;
      allowOwnerNotification: boolean;
    } = runner.runPass.mock.calls[0]![0] as never;

    expect(args.ruleType).toBe(RuleRunType.IncidentOwnerRule);
    expect(args.cursor?.toString()).toBe(CURSOR.toString());
    expect(args.allowOwnerNotification).toBe(true);
  });

  test("refuses a request that is not scoped to a project", async () => {
    mockProps(undefined);

    const next: NextFunction = await callRoute({});

    expect(errorFrom(next)).toBeInstanceOf(BadDataException);
    expect(permission.assertCanRun).not.toHaveBeenCalled();
    expect(runner.runPass).not.toHaveBeenCalled();
  });

  test.each(["NotARule", "IncidentOnCallRule", "RunbookRule", ""])(
    "refuses the rule type %p before checking anything else",
    async (ruleType: string) => {
      mockProps(PROJECT_ID);

      const next: NextFunction = await callRoute({ ruleType: ruleType });

      expect(errorFrom(next).message).toBe("This rule type cannot be run.");
      expect(permission.assertCanRun).not.toHaveBeenCalled();
      expect(runner.runPass).not.toHaveBeenCalled();
    },
  );

  test("stops at the permission check", async () => {
    mockProps(PROJECT_ID);
    permission.assertCanRun.mockImplementationOnce(() => {
      throw new NotAuthorizedException("nope");
    });

    const next: NextFunction = await callRoute({});

    expect(errorFrom(next)).toBeInstanceOf(NotAuthorizedException);
    expect(runner.runPass).not.toHaveBeenCalled();
  });

  test.each([
    ["an invalid rule id", { ruleId: "not-a-uuid" }, "Invalid Rule ID."],
    ["a malformed cursor", { body: { cursor: "page-2" } }, "Invalid cursor."],
    ["a numeric cursor", { body: { cursor: 200 } }, "Invalid cursor."],
    [
      "a string notifyOwners",
      { body: { notifyOwners: "true" } },
      "notifyOwners must be a boolean (true or false).",
    ],
  ])(
    "rejects %s as a bad request",
    async (_name: string, input: Record<string, unknown>, message: string) => {
      mockProps(PROJECT_ID);

      const next: NextFunction = await callRoute(
        input as { ruleId?: string; body?: JSONObject },
      );

      const error: Error = errorFrom(next);
      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(message);
      expect(runner.runPass).not.toHaveBeenCalled();
    },
  );

  test("passes a runner failure on to the error handler", async () => {
    mockProps(PROJECT_ID);
    runner.runPass.mockRejectedValueOnce(
      new BadDataException("Rule not found.") as never,
    );

    const next: NextFunction = await callRoute({});

    expect(errorFrom(next).message).toBe("Rule not found.");
    expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
