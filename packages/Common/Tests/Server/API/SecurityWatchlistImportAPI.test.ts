import SecurityWatchlistAPI from "../../../Server/API/SecurityWatchlistAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import SecurityWatchlistItemService, {
  SecurityWatchlistImportSummary,
} from "../../../Server/Services/SecurityWatchlistItemService";
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
import { SecurityWatchlistImportMode } from "../../../Types/SecurityEvent/SecurityWatchlist";

/*
 * POST /security-watchlist/import: values from a file or a paste, added to
 * a list the team keeps or replacing what it holds. Who may (a role that
 * adds values; to replace, one that removes them too), what is asked of the
 * service (the list, the text, the mode, the caller), and what is answered.
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

const IMPORT: string = "/security-watchlist/import";

const SUMMARY: SecurityWatchlistImportSummary = {
  added: 3,
  removed: 1,
  unchanged: 2,
  duplicates: 1,
  problems: [
    { line: 4, value: "*", message: "A value of only * would match everything." },
  ],
  problemCount: 1,
  valueCount: 5,
};

let props: DatabaseCommonInteractionProps;
let next: jest.Mock;
let importValues: jest.SpyInstance;
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

function handler(): Handler {
  const found: { uri: string; handlers: Array<Handler> } | undefined =
    recordedRoutes.find((item: { uri: string }) => {
      return item.uri === IMPORT;
    });
  expect(found).toBeDefined();
  return found!.handlers[found!.handlers.length - 1]!;
}

async function ask(body: unknown): Promise<void> {
  await handler()({ params: {}, body } as unknown as ExpressRequest, res, next);
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
  importValues = jest
    .spyOn(SecurityWatchlistItemService, "importValues")
    .mockResolvedValue(SUMMARY);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("POST /security-watchlist/import", () => {
  test("resolves the user and requires authentication first", () => {
    const found: { uri: string; handlers: Array<Handler> } | undefined =
      recordedRoutes.find((item: { uri: string }) => {
        return item.uri === IMPORT;
      });

    expect(found?.handlers.slice(0, 2)).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
    expect(found?.handlers).toHaveLength(3);
  });

  test("the list, the text and the mode, imported as the caller; what it did answered", async () => {
    await ask({
      securityWatchlistId: LIST_ID,
      text: "alice\nbob",
      mode: SecurityWatchlistImportMode.Replace,
    });

    expect(next).not.toHaveBeenCalled();
    expect(importValues).toHaveBeenCalledWith({
      watchlistId: new ObjectID(LIST_ID),
      text: "alice\nbob",
      mode: SecurityWatchlistImportMode.Replace,
      props,
    });
    expect(answered()).toEqual({
      added: 3,
      removed: 1,
      unchanged: 2,
      duplicates: 1,
      problemCount: 1,
      valueCount: 5,
      problems: [
        {
          line: 4,
          value: "*",
          message: "A value of only * would match everything.",
        },
      ],
    });
  });

  test("an import adds unless it says it replaces", async () => {
    await ask({ securityWatchlistId: LIST_ID, text: "alice", mode: "merge" });

    expect(importValues).toHaveBeenCalledWith(
      expect.objectContaining({ mode: SecurityWatchlistImportMode.Add }),
    );
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
    Permission.SecurityMember,
    Permission.EditProjectDetectionRule,
  ])("%s may add values and replace a list", async (permission: Permission) => {
    setPermissions(permission);

    await ask({
      securityWatchlistId: LIST_ID,
      text: "alice",
      mode: SecurityWatchlistImportMode.Replace,
    });

    expect(next).not.toHaveBeenCalled();
    expect(importValues).toHaveBeenCalledTimes(1);
  });

  test.each([
    Permission.SecurityViewer,
    Permission.ReadProjectDetectionRule,
    Permission.CreateProjectDetectionRule,
    Permission.ProjectMember,
  ])("%s may not import", async (permission: Permission) => {
    setPermissions(permission);

    await ask({ securityWatchlistId: LIST_ID, text: "alice" });

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(String((next.mock.calls[0]![0] as Error).message)).toContain(
      "Importing values takes a role that can add values to watchlists.",
    );
    expect(importValues).not.toHaveBeenCalled();
  });

  test("a list that is not named by a real id is refused before anything is read", async () => {
    for (const securityWatchlistId of [undefined, "", "list-1", 42]) {
      next.mockClear();

      await ask({ securityWatchlistId, text: "alice" });

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(String((next.mock.calls[0]![0] as Error).message)).toBe(
        "Choose the watchlist to import into.",
      );
    }

    expect(importValues).not.toHaveBeenCalled();
  });

  test("a text that is not one is an empty import", async () => {
    await ask({ securityWatchlistId: LIST_ID, text: ["alice"] });

    expect(importValues).toHaveBeenCalledWith(
      expect.objectContaining({ text: "" }),
    );
  });

  test("a body that is not an object asks for the list", async () => {
    await ask("alice");

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(importValues).not.toHaveBeenCalled();
  });

  test("a refusal of the service reaches the caller as it is", async () => {
    importValues.mockRejectedValue(new Error("Watchlist not found."));

    await ask({ securityWatchlistId: LIST_ID, text: "alice" });

    expect(String((next.mock.calls[0]![0] as Error).message)).toBe(
      "Watchlist not found.",
    );
  });
});
