import SecurityCaseAPI from "../../../Server/API/SecurityCaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import SecurityCaseAiHold from "../../../Server/Utils/SecurityCase/SecurityCaseAiHold";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { withoutRefusals } from "./RouteRefusals";

/*
 * PAGE NOW, ON A CASE ONEUPTIME AI RESPONDS FIRST TO (#10353): who may
 * press it - a role that can work security cases, on a case they may
 * change - that it reads the case as the caller and in the caller's
 * project, that it ends the hold as theirs, and what it answers when the
 * case is no longer held.
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
  return {
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
  };
});

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const USER: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CASE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const PAGE_NOW: string = "/security-case/:caseId/ai-response/page-now";

let props: DatabaseCommonInteractionProps;
let next: jest.Mock;
const res: ExpressResponse = {} as ExpressResponse;

function setPermissions(...permissions: Array<Permission>): void {
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

function route(): Handler {
  const found: { uri: string; handlers: Array<Handler> } | undefined =
    recordedRoutes.find((item: { uri: string }) => {
      return item.uri === PAGE_NOW;
    });
  expect(found).toBeDefined();
  return found!.handlers[found!.handlers.length - 1]!;
}

function request(caseId: string = CASE_ID.toString()): ExpressRequest {
  return { params: { caseId }, body: {} } as unknown as ExpressRequest;
}

// The case the caller may change, in the project they asked under.
function caseChangeable(projectId: ObjectID = PROJECT): jest.SpyInstance {
  return jest
    .spyOn(SecurityCaseService, "findOneUpdatableById")
    .mockResolvedValue({
      id: CASE_ID,
      _id: CASE_ID.toString(),
      projectId,
    } as unknown as SecurityCase);
}

function refusal(): unknown {
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0]![0];
}

beforeAll(() => {
  new SecurityCaseAPI();
});

beforeEach(() => {
  props = { userId: USER, tenantId: PROJECT };
  setPermissions(Permission.SecurityMember);
  next = jest.fn();
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return props;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("POST /security-case/:caseId/ai-response/page-now", () => {
  test("resolves the user and requires authentication first", () => {
    const found: { uri: string; handlers: Array<Handler> } | undefined =
      recordedRoutes.find((item: { uri: string }) => {
        return item.uri === PAGE_NOW;
      });

    expect(found?.handlers.slice(0, 2)).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
    expect(withoutRefusals(found!.handlers)).toHaveLength(3);
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
    Permission.SecurityMember,
  ])(
    "%s alerts people at once: the hold ends as theirs, on the case read as them",
    async (permission: Permission) => {
      setPermissions(permission);
      const read: jest.SpyInstance = caseChangeable();
      const paged: jest.SpyInstance = jest
        .spyOn(SecurityCaseAiHold, "pageNow")
        .mockResolvedValue(true);

      await route()(request(), res, next);

      expect(next).not.toHaveBeenCalled();
      expect(read).toHaveBeenCalledWith(
        expect.objectContaining({ id: CASE_ID, props }),
      );
      expect(paged).toHaveBeenCalledWith({
        projectId: PROJECT,
        securityCaseId: CASE_ID,
        userId: USER,
      });
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    },
  );

  test("a Security Viewer, who reads cases but does not work them, is refused before anything is read", async () => {
    setPermissions(Permission.SecurityViewer);
    const read: jest.SpyInstance = caseChangeable();
    const paged: jest.SpyInstance = jest
      .spyOn(SecurityCaseAiHold, "pageNow")
      .mockResolvedValue(true);

    await route()(request(), res, next);

    expect(refusal()).toBeInstanceOf(NotAuthorizedException);
    expect((refusal() as Error).message).toBe(
      "Alerting people about a case OneUptime AI is on takes a role that can work security cases.",
    );
    expect(read).not.toHaveBeenCalled();
    expect(paged).not.toHaveBeenCalled();
  });

  test("a case the caller may not change is not found, and nobody is alerted", async () => {
    jest
      .spyOn(SecurityCaseService, "findOneUpdatableById")
      .mockResolvedValue(null);
    jest
      .spyOn(SecurityCaseService, "getUnwrittenByIdError")
      .mockResolvedValue(new NotFoundException("gone"));
    const paged: jest.SpyInstance = jest
      .spyOn(SecurityCaseAiHold, "pageNow")
      .mockResolvedValue(true);

    await route()(request(), res, next);

    expect(refusal()).toBeInstanceOf(NotFoundException);
    expect(paged).not.toHaveBeenCalled();
  });

  test("a case of another project is refused, and nobody is alerted", async () => {
    caseChangeable(OTHER_PROJECT);
    const paged: jest.SpyInstance = jest
      .spyOn(SecurityCaseAiHold, "pageNow")
      .mockResolvedValue(true);

    await route()(request(), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(paged).not.toHaveBeenCalled();
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });

  test("an id that is not one is refused", async () => {
    const paged: jest.SpyInstance = jest
      .spyOn(SecurityCaseAiHold, "pageNow")
      .mockResolvedValue(true);

    await route()(request("not-an-id"), res, next);

    expect(refusal()).toBeInstanceOf(BadDataException);
    expect((refusal() as Error).message).toBe("A valid case ID is required.");
    expect(paged).not.toHaveBeenCalled();
  });

  test("a case no longer held - resolved, or people alerted already - says there is nobody left to alert", async () => {
    caseChangeable();
    jest.spyOn(SecurityCaseAiHold, "pageNow").mockResolvedValue(false);

    await route()(request(), res, next);

    expect(refusal()).toBeInstanceOf(BadDataException);
    expect((refusal() as Error).message).toBe(
      "OneUptime AI is not holding this case's alerts any more, so there is nobody left to alert.",
    );
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });
});
