jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import Redis from "../../../../Server/Infrastructure/Redis";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../../Server/Services/ProjectService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import UserService from "../../../../Server/Services/UserService";
import CookieUtil from "../../../../Server/Utils/Cookie";
import JSONWebToken from "../../../../Server/Utils/JsonWebToken";
import RealtimeAccessChanges, {
  RealtimeAccessChangeKind,
} from "../../../../Server/Utils/Realtime/RealtimeAccessChanges";
import RealtimeJoinAccess, {
  RealtimeHandshakeSocket,
  RealtimeJoinDecision,
  RealtimeJoinRefusal,
} from "../../../../Server/Utils/Realtime/RealtimeJoinAccess";
import RealtimeReaders, {
  RealtimeReaderIdentity,
} from "../../../../Server/Utils/Realtime/RealtimeReaders";
import User from "../../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A BLOCKED PROJECT'S LIVE UPDATES STOP FOR ITS MEMBERS, ON EVERY SERVER.
 *
 * A socket joins a project's rooms through the API's own check
 * (RealtimeJoinAccess), so a member's join into a project a master admin
 * blocked is refused as their API requests are; a master admin's is not.
 * Each event is delivered as its reader would read it (RealtimeReaders),
 * and a member of a blocked project reads nothing there. A block or an
 * unblock is announced to every server (RealtimeAccessChanges): each one
 * forgets whether the project is blocked and who hears what in it, and asks
 * the sockets it holds there again.
 * ---------------------------------------------------------------------------
 */

const USER: string = "b2000000-0000-4000-8000-000000000001";
const BLOCKED_PROJECT: string = "b2000000-0000-4000-8000-0000000000b1";
const LIVE_PROJECT: string = "b2000000-0000-4000-8000-0000000000a1";

const tenantPermissionIn: (projectId: string) => UserTenantAccessPermission = (
  projectId: string,
): UserTenantAccessPermission => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(projectId),
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectMember,
        labelIds: [],
      },
    ],
  };
};

const GLOBAL_PERMISSION: UserGlobalAccessPermission = {
  _type: "UserGlobalAccessPermission",
  projectIds: [new ObjectID(BLOCKED_PROJECT), new ObjectID(LIVE_PROJECT)],
  globalPermissions: [Permission.Public, Permission.User],
};

const socketOf: (isMasterAdmin: boolean) => RealtimeHandshakeSocket = (
  isMasterAdmin: boolean,
): RealtimeHandshakeSocket => {
  const token: string = JSONWebToken.signJsonPayload(
    {
      userId: USER,
      email: "member@example.com",
      name: "Mia Member",
      isMasterAdmin: isMasterAdmin,
      sessionId: "b2000000-0000-4000-8000-000000000002",
    },
    15 * 60,
  );

  return {
    handshake: {
      headers: {
        cookie: `${CookieUtil.getUserTokenKey()}=${token}`,
      },
    },
  };
};

let isProjectBlocked: jest.SpyInstance;
let getUserTenantAccessPermission: jest.SpyInstance;

beforeEach(() => {
  isProjectBlocked = jest
    .spyOn(ProjectService, "isProjectBlocked")
    .mockImplementation(async (projectId: ObjectID): Promise<boolean> => {
      return projectId.toString() === BLOCKED_PROJECT;
    });
  jest.spyOn(ProjectService, "getRequireSsoForLogin").mockResolvedValue(false);
  jest
    .spyOn(GlobalConfigService, "getRequireSsoForLogin")
    .mockResolvedValue(false);
  jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(false);
  jest
    .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
    .mockResolvedValue(GLOBAL_PERMISSION);
  getUserTenantAccessPermission = jest
    .spyOn(AccessTokenService, "getUserTenantAccessPermission")
    .mockImplementation(
      async (
        _userId: ObjectID,
        projectId: ObjectID,
      ): Promise<UserTenantAccessPermission> => {
        return tenantPermissionIn(projectId.toString());
      },
    );
  jest.spyOn(TeamMemberService, "getTeamIdsForUser").mockResolvedValue([]);
});

afterEach(() => {
  RealtimeReaders.clear();
  RealtimeAccessChanges.onProjectBlockChanged(null);
  jest.restoreAllMocks();
});

describe("joining a blocked project's rooms", () => {
  test("a member's socket is refused, as their API requests are", async () => {
    const decision: RealtimeJoinDecision = await RealtimeJoinAccess.decide(
      socketOf(false),
      BLOCKED_PROJECT,
    );

    expect(decision).toEqual({
      allowed: false,
      refusal: RealtimeJoinRefusal.NotAuthorized,
    });
  });

  test("the same member's socket joins a project that is not blocked", async () => {
    const decision: RealtimeJoinDecision = await RealtimeJoinAccess.decide(
      socketOf(false),
      LIVE_PROJECT,
    );

    expect(decision.allowed).toBe(true);
  });

  test("a master admin's socket joins it", async () => {
    const decision: RealtimeJoinDecision = await RealtimeJoinAccess.decide(
      socketOf(true),
      BLOCKED_PROJECT,
    );

    expect(decision.allowed).toBe(true);
    expect(isProjectBlocked).not.toHaveBeenCalled();
  });

  test("a lookup that fails is an error, not a refusal or a pass", async () => {
    isProjectBlocked.mockRejectedValue(new Error("database unavailable"));

    await expect(
      RealtimeJoinAccess.decide(socketOf(false), LIVE_PROJECT),
    ).rejects.toThrow("database unavailable");
  });
});

describe("who reads a blocked project's live updates", () => {
  const member: RealtimeReaderIdentity = {
    userId: USER,
    isMasterAdmin: false,
  };

  test("a member reads nothing there, and their permissions are not read", async () => {
    const props: DatabaseCommonInteractionProps | null =
      await RealtimeReaders.buildProps(member, BLOCKED_PROJECT);

    expect(props).toBeNull();
    expect(getUserTenantAccessPermission).not.toHaveBeenCalled();
  });

  test("a member reads a project that is not blocked as before", async () => {
    const props: DatabaseCommonInteractionProps | null =
      await RealtimeReaders.buildProps(member, LIVE_PROJECT);

    expect(props?.userType).toBe(UserType.User);
    expect(props?.userTenantAccessPermission?.[LIVE_PROJECT]).toEqual(
      tenantPermissionIn(LIVE_PROJECT),
    );
  });

  test("a master admin reads it, while their account says they are one", async () => {
    const masterAdmin: User = new User();
    masterAdmin._id = USER;
    masterAdmin.isMasterAdmin = true;
    jest.spyOn(UserService, "findOneById").mockResolvedValue(masterAdmin);

    const props: DatabaseCommonInteractionProps | null =
      await RealtimeReaders.buildProps(
        { userId: USER, isMasterAdmin: true },
        BLOCKED_PROJECT,
      );

    expect(props?.userType).toBe(UserType.MasterAdmin);
    expect(isProjectBlocked).not.toHaveBeenCalled();
  });

  test("forgetProject forgets everyone in that project, and only there", async () => {
    await RealtimeReaders.getReader(member, LIVE_PROJECT);
    await RealtimeReaders.getReader(member, BLOCKED_PROJECT);
    await RealtimeReaders.getReader(
      { userId: "b2000000-0000-4000-8000-000000000003", isMasterAdmin: false },
      BLOCKED_PROJECT,
    );

    expect(RealtimeReaders.size()).toBe(3);

    RealtimeReaders.forgetProject(BLOCKED_PROJECT.toUpperCase());

    expect(RealtimeReaders.size()).toBe(1);

    // The entry kept is the live project's: it is answered without a read.
    getUserTenantAccessPermission.mockClear();
    await RealtimeReaders.getReader(member, LIVE_PROJECT);
    expect(getUserTenantAccessPermission).not.toHaveBeenCalled();
  });
});

describe("a block or an unblock, told to every server", () => {
  let forgetBlockedStatus: jest.SpyInstance;
  let forgetProject: jest.SpyInstance;
  let published: Array<string>;

  beforeEach(() => {
    forgetBlockedStatus = jest
      .spyOn(ProjectService, "forgetBlockedStatus")
      .mockImplementation(() => {
        return undefined;
      });
    forgetProject = jest.spyOn(RealtimeReaders, "forgetProject");

    published = [];
    const client: { publish: jest.Mock } = {
      publish: jest.fn(async (_channel: string, message: string) => {
        published.push(message);
        return 1;
      }),
    };

    jest
      .spyOn(Redis, "getClient")
      .mockReturnValue(client as unknown as ReturnType<typeof Redis.getClient>);
    jest.spyOn(Redis, "isConnected").mockReturnValue(true);
  });

  test("is applied here at once and published for the others", () => {
    const asked: Array<string> = [];
    RealtimeAccessChanges.onProjectBlockChanged((projectId: string): void => {
      asked.push(projectId);
    });

    RealtimeAccessChanges.announce({
      kind: RealtimeAccessChangeKind.ProjectBlockChanged,
      projectId: BLOCKED_PROJECT,
    });

    expect(forgetBlockedStatus).toHaveBeenCalledWith(
      new ObjectID(BLOCKED_PROJECT),
    );
    expect(forgetProject).toHaveBeenCalledWith(BLOCKED_PROJECT);
    expect(asked).toEqual([BLOCKED_PROJECT]);

    expect(published).toHaveLength(1);
    expect(JSON.parse(published[0]!).change).toEqual({
      kind: RealtimeAccessChangeKind.ProjectBlockChanged,
      projectId: BLOCKED_PROJECT,
    });
  });

  test("another server's announcement is applied here", () => {
    const asked: Array<string> = [];
    RealtimeAccessChanges.onProjectBlockChanged((projectId: string): void => {
      asked.push(projectId);
    });

    RealtimeAccessChanges.receive(
      JSON.stringify({
        origin: "b2000000-0000-4000-8000-0000000000ff",
        change: {
          kind: RealtimeAccessChangeKind.ProjectBlockChanged,
          projectId: BLOCKED_PROJECT,
        },
      }),
    );

    expect(forgetBlockedStatus).toHaveBeenCalledWith(
      new ObjectID(BLOCKED_PROJECT),
    );
    expect(forgetProject).toHaveBeenCalledWith(BLOCKED_PROJECT);
    expect(asked).toEqual([BLOCKED_PROJECT]);
  });

  test.each([
    ["no project", {}],
    ["a project that is not an id", { projectId: "not-an-id" }],
    ["a project that is not a string", { projectId: 42 }],
  ] as Array<[string, Record<string, unknown>]>)(
    "one naming %s is ignored",
    (_name: string, fields: Record<string, unknown>) => {
      RealtimeAccessChanges.receive(
        JSON.stringify({
          origin: "b2000000-0000-4000-8000-0000000000ff",
          change: {
            kind: RealtimeAccessChangeKind.ProjectBlockChanged,
            ...fields,
          },
        }),
      );

      expect(forgetBlockedStatus).not.toHaveBeenCalled();
      expect(forgetProject).not.toHaveBeenCalled();
    },
  );
});
