// Must stay the first import: the client's URLs are built from HOST on load.
import { DASHBOARD_ORIGIN } from "./DashboardHost";
import FakeAxiosServer, {
  FakeTransport,
  Gate,
  SentRequest,
  createGate,
  settle,
} from "./FakeAxiosServer";
import BaseAPI from "../../../../UI/Utils/API/API";
import { IDENTITY_URL } from "../../../../UI/Config";
import ModelAPI from "../../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../../UI/Utils/Navigation";
import PermissionUtil, {
  getProjectPermissionsHashStorageKey,
  getProjectPermissionsStorageKey,
} from "../../../../UI/Utils/Permission";
import PermissionGate, {
  ModelAction,
} from "../../../../UI/Utils/PermissionGate";
import LocalStorage from "../../../../UI/Utils/LocalStorage";
import User from "../../../../UI/Utils/User";
import Label from "../../../../Models/DatabaseModels/Label";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import Route from "../../../../Types/API/Route";
import URL from "../../../../Types/API/URL";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import axios from "axios";

jest.mock("axios", () => {
  // Keep the real helpers (axios.isAxiosError, AxiosError) and fake only the call.
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

/*
 * WHAT A REQUEST SAYS ABOUT THE PERMISSION SNAPSHOTS, AND WHERE AN ANSWER'S
 * SNAPSHOT IS KEPT - with two projects open in two tabs.
 *
 * The server answers a request about a project with the person's snapshot
 * in that project (the `project-permissions` header, its hash beside it)
 * unless the request's `project-permissions-hash` says the browser already
 * has it (Server/Middleware/UserAuthorization). The browser kept the
 * snapshot and the hash under one name for every project, so every request
 * of one tab sent the hash of whichever project's answer had come back
 * last - the other tab's - and each answer overwrote the other tab's role.
 *
 * Now each answer's snapshot is kept for the project it names, with its
 * hash, and each request sends the hash of the project its tenantid header
 * names. Everything runs through the real client, down to where axios would
 * open a socket.
 */

const mockedAxios: FakeTransport = axios as unknown as FakeTransport;

const API_ORIGIN: string = `${DASHBOARD_ORIGIN}/api`;

const OWNED_PROJECT_ID: string = "6f000000-0000-4000-8000-000000000001";
const VIEWED_PROJECT_ID: string = "6f000000-0000-4000-8000-000000000002";
const THIRD_PROJECT_ID: string = "6f000000-0000-4000-8000-000000000003";

const OWNED_HASH: string = "owned-project-hash";
const VIEWED_HASH: string = "viewed-project-hash";
const THIRD_HASH: string = "third-project-hash";
const GLOBAL_HASH: string = "global-hash";

const SHARED_SNAPSHOT_KEY: string = "project_permissions";
const SHARED_HASH_KEY: string = "project-permissions-hash";

const LABELS_URL: string = `${API_ORIGIN}/label/get-list?limit=10&skip=0`;

const REFRESH_URL: string = URL.fromString(IDENTITY_URL.toString())
  .addRoute("/refresh-token")
  .toString();

// A list answer, as the API writes one: no labels.
const EMPTY_LIST: JSONObject = { data: [], count: 0, skip: 0, limit: 10 };

let server: FakeAxiosServer;

type SnapshotHeaderFunction = (
  projectId: string,
  permissions: Array<Permission>,
) => string;

// The `project-permissions` header as the server writes it.
const snapshotHeader: SnapshotHeaderFunction = (
  projectId: string,
  permissions: Array<Permission>,
): string => {
  return JSON.stringify(
    JSONFunctions.serialize({
      _type: "UserTenantAccessPermission",
      projectId: new ObjectID(projectId),
      permissions: permissions.map((permission: Permission): JSONObject => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: false,
        };
      }),
    } as JSONObject),
  );
};

type PermissionHeadersFunction = (
  projectId: string,
  permissions: Array<Permission>,
  hash: string,
) => Dictionary<string>;

const permissionHeaders: PermissionHeadersFunction = (
  projectId: string,
  permissions: Array<Permission>,
  hash: string,
): Dictionary<string> => {
  return {
    "project-permissions": snapshotHeader(projectId, permissions),
    "project-permissions-hash": hash,
  };
};

const OWNER_HEADERS: Dictionary<string> = permissionHeaders(
  OWNED_PROJECT_ID,
  [Permission.ProjectOwner],
  OWNED_HASH,
);

const VIEWER_HEADERS: Dictionary<string> = permissionHeaders(
  VIEWED_PROJECT_ID,
  [Permission.Viewer],
  VIEWED_HASH,
);

type OpenTabFunction = (projectId: string) => void;

// The person moves to the tab that shows `projectId`.
const openTab: OpenTabFunction = (projectId: string): void => {
  window.sessionStorage.clear();
  window.history.replaceState(
    null,
    "",
    `/dashboard/${projectId}/settings/labels`,
  );
};

type ListLabelsFunction = () => Promise<ListResult<Label>>;

// The Labels table's read, as the tab makes it: its tenantid is the tab's project.
const listLabels: ListLabelsFunction = async (): Promise<ListResult<Label>> => {
  return await ModelAPI.getList<Label>({
    modelType: Label,
    query: {},
    limit: 10,
    skip: 0,
    select: { name: true },
    sort: {},
  });
};

type GetAboutFunction = (
  projectId: string | null,
  headerName?: string,
) => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>;

const RESOURCE_URL: string = `${API_ORIGIN}/on-call-duty-policy/current-on-duty-escalation-policies`;

// A request about `projectId`, named the way the caller names it.
const getAbout: GetAboutFunction = async (
  projectId: string | null,
  headerName: string = "tenantid",
): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
  return await BaseAPI.get<JSONObject>({
    url: URL.fromString(RESOURCE_URL),
    headers: projectId ? { [headerName]: projectId } : {},
  });
};

type HashesSentFunction = () => Array<string | undefined>;

const projectHashesSent: HashesSentFunction = (): Array<string | undefined> => {
  return server.sent.map((request: SentRequest): string | undefined => {
    return request.headers["project-permissions-hash"];
  });
};

type CanCreateLabelFunction = () => boolean;

const canCreateLabel: CanCreateLabelFunction = (): boolean => {
  return PermissionGate.check(new Label(), ModelAction.Create).isAllowed;
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  PermissionGate.clearPermissionPropsCache();

  server = new FakeAxiosServer(mockedAxios);

  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(User, "logout").mockImplementation((): void => {});
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});
  jest
    .spyOn(Navigation, "getCurrentRoute")
    .mockReturnValue(new Route("/dashboard"));
});

afterEach(() => {
  mockedAxios.mockReset();
  jest.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("an answer's project snapshot", () => {
  test("is kept for the project it names, with the hash sent beside it", async () => {
    openTab(OWNED_PROJECT_ID);
    server.on(HTTPMethod.POST, LABELS_URL, [
      { status: 200, data: EMPTY_LIST, headers: OWNER_HEADERS },
    ]);

    await listLabels();

    expect(
      localStorage.getItem(getProjectPermissionsStorageKey(OWNED_PROJECT_ID)!),
    ).not.toBeNull();
    expect(PermissionUtil.getProjectPermissionsHash(OWNED_PROJECT_ID)).toBe(
      OWNED_HASH,
    );
    expect(canCreateLabel()).toBe(true);
  });

  test("two tabs' answers keep both projects' roles: the Owner's tab offers Create Label, the Viewer's locks it", async () => {
    server.on(HTTPMethod.POST, LABELS_URL, [
      { status: 200, data: EMPTY_LIST, headers: OWNER_HEADERS },
      { status: 200, data: EMPTY_LIST, headers: VIEWER_HEADERS },
      { status: 200, data: EMPTY_LIST, headers: OWNER_HEADERS },
    ]);

    openTab(OWNED_PROJECT_ID);
    await listLabels();

    openTab(VIEWED_PROJECT_ID);
    await listLabels();

    openTab(OWNED_PROJECT_ID);
    expect(canCreateLabel()).toBe(true);

    openTab(VIEWED_PROJECT_ID);
    expect(canCreateLabel()).toBe(false);

    // The Owner's tab reads again (its hash changed, say): the Viewer's tab is still locked.
    openTab(OWNED_PROJECT_ID);
    await listLabels();
    openTab(VIEWED_PROJECT_ID);
    expect(canCreateLabel()).toBe(false);
  });

  test("an answer that lands for the other tab while this tab's read is in flight changes nothing here", async () => {
    const ownedAnswer: Gate = createGate();

    server.on(HTTPMethod.POST, LABELS_URL, [
      { status: 200, data: EMPTY_LIST, headers: OWNER_HEADERS },
      {
        status: 200,
        data: EMPTY_LIST,
        headers: OWNER_HEADERS,
        gate: ownedAnswer.promise,
      },
      { status: 200, data: EMPTY_LIST, headers: VIEWER_HEADERS },
    ]);

    openTab(OWNED_PROJECT_ID);
    await listLabels();

    // The Owner's tab refreshes; its answer is slow.
    const refresh: Promise<ListResult<Label>> = listLabels();
    await settle();

    // Meanwhile the Viewer's tab reads.
    openTab(VIEWED_PROJECT_ID);
    await listLabels();

    // The Owner's tab draws while its own answer is still on its way.
    openTab(OWNED_PROJECT_ID);
    expect(canCreateLabel()).toBe(true);

    ownedAnswer.open();
    await refresh;

    openTab(VIEWED_PROJECT_ID);
    expect(canCreateLabel()).toBe(false);
  });

  test("an answer about another project - a page that reads several - is kept for that project, not this tab's", async () => {
    server.on(HTTPMethod.GET, RESOURCE_URL, [
      { status: 200, data: {}, headers: VIEWER_HEADERS },
      { status: 200, data: {}, headers: OWNER_HEADERS },
      {
        status: 200,
        data: {},
        headers: permissionHeaders(
          THIRD_PROJECT_ID,
          [Permission.ProjectAdmin],
          THIRD_HASH,
        ),
      },
    ]);

    openTab(VIEWED_PROJECT_ID);
    await getAbout(VIEWED_PROJECT_ID);
    // My On-Call Policies: every project of the person, in turn.
    await getAbout(OWNED_PROJECT_ID);
    await getAbout(THIRD_PROJECT_ID);

    expect(canCreateLabel()).toBe(false);
    expect(PermissionUtil.getProjectPermissionsHash(THIRD_PROJECT_ID)).toBe(
      THIRD_HASH,
    );
    expect(PermissionUtil.getProjectPermissionsHash(OWNED_PROJECT_ID)).toBe(
      OWNED_HASH,
    );
  });

  test("is never kept under the name every project shared", async () => {
    server.on(HTTPMethod.POST, LABELS_URL, [
      { status: 200, data: EMPTY_LIST, headers: OWNER_HEADERS },
      { status: 200, data: EMPTY_LIST, headers: VIEWER_HEADERS },
    ]);

    openTab(OWNED_PROJECT_ID);
    await listLabels();
    openTab(VIEWED_PROJECT_ID);
    await listLabels();

    expect(localStorage.getItem(SHARED_SNAPSHOT_KEY)).toBeNull();
    expect(localStorage.getItem(SHARED_HASH_KEY)).toBeNull();
  });

  test("a hash with no snapshot beside it is not kept", async () => {
    openTab(OWNED_PROJECT_ID);
    server.on(HTTPMethod.POST, LABELS_URL, [
      {
        status: 200,
        data: EMPTY_LIST,
        headers: { "project-permissions-hash": OWNED_HASH },
      },
    ]);

    await listLabels();

    expect(
      localStorage.getItem(
        getProjectPermissionsHashStorageKey(OWNED_PROJECT_ID)!,
      ),
    ).toBeNull();
    expect(localStorage.getItem(SHARED_HASH_KEY)).toBeNull();
  });

  test("a snapshot header that cannot be read is left out, and the request still succeeds", async () => {
    openTab(OWNED_PROJECT_ID);
    server.on(HTTPMethod.POST, LABELS_URL, [
      {
        status: 200,
        data: EMPTY_LIST,
        headers: {
          "project-permissions": "{not json",
          "project-permissions-hash": OWNED_HASH,
          "global-permissions": "[1, 2]",
        },
      },
    ]);

    const result: ListResult<Label> = await listLabels();

    expect(result.count).toBe(0);
    expect(PermissionUtil.getProjectPermissions()).toBeNull();
    expect(PermissionUtil.getGlobalPermissions()).toBeNull();
  });

  test("a storage that refuses to keep it does not fail the request it came on", async () => {
    openTab(OWNED_PROJECT_ID);
    server.on(HTTPMethod.POST, LABELS_URL, [
      {
        status: 200,
        data: EMPTY_LIST,
        headers: {
          ...OWNER_HEADERS,
          "global-permissions": JSON.stringify({
            _type: "UserGlobalAccessPermission",
            globalPermissions: [Permission.CurrentUser],
            projectIds: [],
          }),
          "global-permissions-hash": GLOBAL_HASH,
        },
      },
    ]);

    jest.spyOn(LocalStorage, "setItem").mockImplementation((): void => {
      throw new Error("QuotaExceededError");
    });

    const result: ListResult<Label> = await listLabels();

    expect(result.count).toBe(0);
  });
});

describe("the hash a request sends", () => {
  test("is the hash of the project its tenantid names, in each tab", async () => {
    server.on(HTTPMethod.POST, LABELS_URL, [
      { status: 200, data: EMPTY_LIST, headers: OWNER_HEADERS },
      { status: 200, data: EMPTY_LIST, headers: VIEWER_HEADERS },
      { status: 200, data: EMPTY_LIST },
      { status: 200, data: EMPTY_LIST },
      { status: 200, data: EMPTY_LIST },
    ]);

    openTab(OWNED_PROJECT_ID);
    await listLabels();
    openTab(VIEWED_PROJECT_ID);
    await listLabels();

    // From here every request already has its project's snapshot.
    openTab(OWNED_PROJECT_ID);
    await listLabels();
    openTab(VIEWED_PROJECT_ID);
    await listLabels();
    openTab(OWNED_PROJECT_ID);
    await listLabels();

    expect(
      server.sent.map((request: SentRequest): string => {
        return request.headers["tenantid"] || "";
      }),
    ).toEqual([
      OWNED_PROJECT_ID,
      VIEWED_PROJECT_ID,
      OWNED_PROJECT_ID,
      VIEWED_PROJECT_ID,
      OWNED_PROJECT_ID,
    ]);
    expect(projectHashesSent()).toEqual([
      undefined,
      undefined,
      OWNED_HASH,
      VIEWED_HASH,
      OWNED_HASH,
    ]);
  });

  test("is that project's hash when a request names another project than the tab's", async () => {
    PermissionUtil.setProjectPermissions(
      {
        _type: "UserTenantAccessPermission",
        projectId: new ObjectID(THIRD_PROJECT_ID),
        permissions: [],
      } as UserTenantAccessPermission,
      { hash: THIRD_HASH },
    );
    PermissionUtil.setProjectPermissions(
      {
        _type: "UserTenantAccessPermission",
        projectId: new ObjectID(VIEWED_PROJECT_ID),
        permissions: [],
      } as UserTenantAccessPermission,
      { hash: VIEWED_HASH },
    );

    openTab(VIEWED_PROJECT_ID);
    server.on(HTTPMethod.GET, RESOURCE_URL, [{ status: 200, data: {} }]);

    await getAbout(THIRD_PROJECT_ID);

    expect(projectHashesSent()).toEqual([THIRD_HASH]);
  });

  test("reads the tenantid header whatever its case", async () => {
    PermissionUtil.setProjectPermissions(
      {
        _type: "UserTenantAccessPermission",
        projectId: new ObjectID(OWNED_PROJECT_ID),
        permissions: [],
      } as UserTenantAccessPermission,
      { hash: OWNED_HASH },
    );

    server.on(HTTPMethod.GET, RESOURCE_URL, [
      { status: 200, data: {} },
      { status: 200, data: {} },
    ]);

    await getAbout(OWNED_PROJECT_ID, "TenantId");
    await getAbout(` ${OWNED_PROJECT_ID.toUpperCase()} `);

    expect(projectHashesSent()).toEqual([OWNED_HASH, OWNED_HASH]);
  });

  test("is no project hash for a request about no project, while the person's global hash still goes", async () => {
    PermissionUtil.setProjectPermissions(
      {
        _type: "UserTenantAccessPermission",
        projectId: new ObjectID(OWNED_PROJECT_ID),
        permissions: [],
      } as UserTenantAccessPermission,
      { hash: OWNED_HASH },
    );
    PermissionUtil.setGlobalPermissionsHash(GLOBAL_HASH);

    openTab(OWNED_PROJECT_ID);
    server.on(HTTPMethod.GET, RESOURCE_URL, [{ status: 200, data: {} }]);

    await getAbout(null);

    expect(projectHashesSent()).toEqual([undefined]);
    expect(server.sent[0]!.headers["global-permissions-hash"]).toBe(
      GLOBAL_HASH,
    );
  });

  test("is no hash for a project whose snapshot is not kept, so the server sends it", async () => {
    localStorage.setItem(
      getProjectPermissionsHashStorageKey(OWNED_PROJECT_ID)!,
      OWNED_HASH,
    );

    server.on(HTTPMethod.GET, RESOURCE_URL, [{ status: 200, data: {} }]);

    await getAbout(OWNED_PROJECT_ID);

    expect(projectHashesSent()).toEqual([undefined]);
  });

  test("is never the hash every project shared", async () => {
    localStorage.setItem(SHARED_HASH_KEY, "old-shared-hash");
    localStorage.setItem(
      SHARED_SNAPSHOT_KEY,
      JSON.stringify({ projectId: OWNED_PROJECT_ID, permissions: [] }),
    );

    openTab(OWNED_PROJECT_ID);
    server.on(HTTPMethod.POST, LABELS_URL, [
      { status: 200, data: EMPTY_LIST, headers: OWNER_HEADERS },
    ]);

    await listLabels();

    expect(projectHashesSent()).toEqual([undefined]);
    // Left where it was, for a tab still running the version before.
    expect(localStorage.getItem(SHARED_HASH_KEY)).toBe("old-shared-hash");
  });

  test("the global hash one tab's answer left goes with the other tab's requests, on purpose", async () => {
    server.on(HTTPMethod.POST, LABELS_URL, [
      {
        status: 200,
        data: EMPTY_LIST,
        headers: {
          ...OWNER_HEADERS,
          "global-permissions": JSON.stringify({
            _type: "UserGlobalAccessPermission",
            globalPermissions: [Permission.CurrentUser],
            projectIds: [OWNED_PROJECT_ID, VIEWED_PROJECT_ID],
          }),
          "global-permissions-hash": GLOBAL_HASH,
        },
      },
      { status: 200, data: EMPTY_LIST, headers: VIEWER_HEADERS },
    ]);

    openTab(OWNED_PROJECT_ID);
    await listLabels();
    openTab(VIEWED_PROJECT_ID);
    await listLabels();

    expect(server.sent[1]!.headers["global-permissions-hash"]).toBe(
      GLOBAL_HASH,
    );
    expect(PermissionUtil.getGlobalPermissions()?.globalPermissions).toEqual([
      Permission.CurrentUser,
    ]);
  });

  test("a request goes out without its hashes when they cannot be read, rather than not at all", async () => {
    jest
      .spyOn(PermissionUtil, "getGlobalPermissionsHash")
      .mockImplementation((): string | null => {
        throw new Error("SecurityError");
      });

    server.on(HTTPMethod.GET, RESOURCE_URL, [{ status: 200, data: {} }]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await getAbout(OWNED_PROJECT_ID);

    expect(response.statusCode).toBe(200);
    expect(server.sent[0]!.headers["global-permissions-hash"]).toBeUndefined();
    expect(server.sent[0]!.headers["project-permissions-hash"]).toBeUndefined();
    expect(server.sent[0]!.headers["tenantid"]).toBe(OWNED_PROJECT_ID);
  });

  test("an answer whose snapshot cannot be kept still reaches its caller", async () => {
    jest
      .spyOn(PermissionUtil, "setProjectPermissions")
      .mockImplementation((): void => {
        throw new Error("QuotaExceededError");
      });

    server.on(HTTPMethod.GET, RESOURCE_URL, [
      { status: 200, data: { answered: true }, headers: OWNER_HEADERS },
    ]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await getAbout(OWNED_PROJECT_ID);

    expect(response.statusCode).toBe(200);
    expect(response.data).toEqual({ answered: true });
  });

  test("a replay after a lapsed session sends the same project's hash", async () => {
    PermissionUtil.setProjectPermissions(
      {
        _type: "UserTenantAccessPermission",
        projectId: new ObjectID(VIEWED_PROJECT_ID),
        permissions: [],
      } as UserTenantAccessPermission,
      { hash: VIEWED_HASH },
    );

    server
      .on(HTTPMethod.GET, RESOURCE_URL, [
        { status: 401, data: { message: "Authentication required." } },
        { status: 200, data: {}, headers: VIEWER_HEADERS },
      ])
      .on(HTTPMethod.POST, REFRESH_URL, [{ status: 200 }]);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await getAbout(VIEWED_PROJECT_ID);

    expect(response.statusCode).toBe(200);

    const toResource: Array<SentRequest> = server.requestsTo(
      HTTPMethod.GET,
      RESOURCE_URL,
    );

    // The refused request and its replay, each with the project's own hash.
    expect(toResource).toHaveLength(2);

    for (const request of toResource) {
      expect(request.headers["project-permissions-hash"]).toBe(VIEWED_HASH);
    }

    // The refresh carries no project hash: it is about no project.
    expect(
      server.requestsTo(HTTPMethod.POST, REFRESH_URL)[0]!.headers[
        "project-permissions-hash"
      ],
    ).toBeUndefined();
  });
});
