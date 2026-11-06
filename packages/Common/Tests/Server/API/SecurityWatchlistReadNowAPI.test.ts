import SecurityWatchlistAPI from "../../../Server/API/SecurityWatchlistAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import SecurityWatchlistUrlImport, {
  SecurityWatchlistUrlReadOutcome,
} from "../../../Server/Utils/SecurityEvent/Watchlists/SecurityWatchlistUrlImport";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { SECURITY_WATCHLIST_MESSAGES } from "../../../Types/SecurityEvent/SecurityWatchlist";

/*
 * POST /security-watchlist/read-now (#5391): a list read from an address,
 * read at once rather than at its next turn. It changes what the list
 * holds as its schedule would, so it takes a role that edits watchlists;
 * what the read did - or why it could not - is answered, as its page says
 * it.
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

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const USER: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const LIST_ID: string = "33333333-3333-4333-8333-333333333333";

const READ_NOW: string = "/security-watchlist/read-now";

const READ: SecurityWatchlistUrlReadOutcome = {
  summary: {
    added: 3,
    removed: 1,
    unchanged: 2,
    duplicates: 0,
    problems: [],
    problemCount: 4,
    valueCount: 5,
  },
  error: null,
  errorDetail: null,
  isRead: true,
};

let props: DatabaseCommonInteractionProps;
let next: jest.Mock;
let readNow: jest.SpyInstance;
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

function route(): { uri: string; handlers: Array<Handler> } {
  const found: { uri: string; handlers: Array<Handler> } | undefined =
    recordedRoutes.find((item: { uri: string }) => {
      return item.uri === READ_NOW;
    });
  expect(found).toBeDefined();
  return found!;
}

async function ask(body: unknown): Promise<void> {
  const handlers: Array<Handler> = route().handlers;

  await handlers[handlers.length - 1]!(
    { params: {}, body } as unknown as ExpressRequest,
    res,
    next,
  );
}

function answered(): JSONObject {
  const mock: jest.Mock = Response.sendJsonObjectResponse as jest.Mock;
  return mock.mock.calls[mock.mock.calls.length - 1]![2] as JSONObject;
}

beforeAll(() => {
  new SecurityWatchlistAPI();
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
  readNow = jest
    .spyOn(SecurityWatchlistUrlImport, "readNow")
    .mockResolvedValue(READ);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("POST /security-watchlist/read-now", () => {
  test("resolves the user and requires authentication first", () => {
    expect(route().handlers.slice(0, 2)).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
    expect(route().handlers).toHaveLength(3);
  });

  test("the list read as the caller may read it; what the read did answered", async () => {
    await ask({ securityWatchlistId: LIST_ID });

    expect(next).not.toHaveBeenCalled();
    expect(readNow).toHaveBeenCalledWith({
      watchlistId: new ObjectID(LIST_ID),
      props,
    });
    expect(answered()).toEqual({
      error: null,
      errorDetail: null,
      added: 3,
      removed: 1,
      unchanged: 2,
      problemCount: 4,
      valueCount: 5,
    });
  });

  test("a read that failed answers why, and what the address said, with nothing done", async () => {
    readNow.mockResolvedValue({
      summary: null,
      error: SECURITY_WATCHLIST_MESSAGES.urlNotRead.message,
      errorDetail: "Data source responded with HTTP 403: Forbidden",
      isRead: true,
    });

    await ask({ securityWatchlistId: LIST_ID });

    expect(answered()).toEqual({
      error: SECURITY_WATCHLIST_MESSAGES.urlNotRead.message,
      errorDetail: "Data source responded with HTTP 403: Forbidden",
      added: 0,
      removed: 0,
      unchanged: 0,
      problemCount: 0,
      valueCount: 0,
    });
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
    Permission.SecurityMember,
    Permission.EditProjectDetectionRule,
  ])("%s may read a list now", async (permission: Permission) => {
    setPermissions(permission);

    await ask({ securityWatchlistId: LIST_ID });

    expect(next).not.toHaveBeenCalled();
    expect(readNow).toHaveBeenCalledTimes(1);
  });

  test.each([
    Permission.SecurityViewer,
    Permission.ReadProjectDetectionRule,
    Permission.CreateProjectDetectionRule,
    Permission.ProjectMember,
  ])("%s may not", async (permission: Permission) => {
    setPermissions(permission);

    await ask({ securityWatchlistId: LIST_ID });

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(String((next.mock.calls[0]![0] as Error).message)).toContain(
      "Reading a list from its address takes a role that can edit watchlists.",
    );
    expect(readNow).not.toHaveBeenCalled();
  });

  test("a list that is not named by a real id is refused before anything is read", async () => {
    for (const body of [
      {},
      { securityWatchlistId: "" },
      { securityWatchlistId: "list-1" },
      { securityWatchlistId: 42 },
      "list",
    ]) {
      next.mockClear();

      await ask(body);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(String((next.mock.calls[0]![0] as Error).message)).toBe(
        "Choose the watchlist to read.",
      );
    }

    expect(readNow).not.toHaveBeenCalled();
  });

  test("a refusal of the service - a list not read from an address, one being read - reaches the caller as it is", async () => {
    readNow.mockRejectedValue(
      new Error("Only a watchlist read from an address is read from one."),
    );

    await ask({ securityWatchlistId: LIST_ID });

    expect(String((next.mock.calls[0]![0] as Error).message)).toBe(
      "Only a watchlist read from an address is read from one.",
    );
  });
});
