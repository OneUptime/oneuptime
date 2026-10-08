import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import Redis from "../../../Server/Infrastructure/Redis";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import UserService from "../../../Server/Services/UserService";
import UserSessionService from "../../../Server/Services/UserSessionService";
import { OnDelete, OnUpdate } from "../../../Server/Types/Database/Hooks";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import RealtimeAccessChanges, {
  RealtimeAccessChange,
  RealtimeAccessChangeKind,
} from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import RealtimeReaders, {
  RealtimeReaderIdentity,
} from "../../../Server/Utils/Realtime/RealtimeReaders";
import RealtimeSessions, {
  RealtimeSessionSocket,
} from "../../../Server/Utils/Realtime/RealtimeSessions";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import UserSession from "../../../Models/DatabaseModels/UserSession";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import EventName from "../../../Types/Realtime/EventName";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Whatever takes access away from someone takes their live updates with it,
 * at once, on this server and - through RealtimeAccessChanges - on every
 * other:
 *
 *   - a revoked or deleted session (signing out, a password change, a block,
 *     a refresh token past its time) ends the sockets that joined with it;
 *   - a block ends every session of the person, and a deleted account too;
 *   - a block, an unblock and a server admin change make every server forget
 *     whether the person is blocked and who they are in each project;
 *   - a team membership or permission change makes every server read the
 *     person's permissions in that project again, with one announcement
 *     however many projects a refresh rebuilds;
 *   - a change to a project's sign-in rules (Require SSO, the provider it
 *     pins), or to the instance's, makes every server ask its sockets again.
 *
 * No database: the services' writes are reached through their hooks, with
 * the reads they make stubbed.
 */

const USER: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_USER: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SESSION: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const OTHER_SESSION: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const TEAM: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");

interface HookedService<TModel> {
  onUpdateSuccess: (
    onUpdate: OnUpdate<TModel & User & UserSession>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<unknown>;
  onDeleteSuccess: (
    onDelete: OnDelete<TModel & User & UserSession>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ) => Promise<unknown>;
}

function hooksOf<TModel>(service: unknown): HookedService<TModel> {
  return service as HookedService<TModel>;
}

function updateOf<TModel>(
  patch: Record<string, unknown>,
): OnUpdate<TModel & User & UserSession> {
  const updateBy: UpdateBy<TModel & User & UserSession> = {
    query: {} as unknown as UpdateBy<TModel & User & UserSession>["query"],
    data: patch as unknown as UpdateBy<TModel & User & UserSession>["data"],
    props: { isRoot: true },
    limit: 1,
    skip: 0,
  };

  return { updateBy, carryForward: [] };
}

function deleteOf<TModel>(): OnDelete<TModel & User & UserSession> {
  const deleteBy: DeleteBy<TModel & User & UserSession> = {
    query: {} as unknown as DeleteBy<TModel & User & UserSession>["query"],
    props: { isRoot: true },
    limit: 1,
    skip: 0,
  };

  return { deleteBy, carryForward: null };
}

let nextSocketId: number = 1;

// A socket that joined a room with a session, as Realtime keeps it.
class ListeningSocket implements RealtimeSessionSocket {
  public id: string = `socket-${nextSocketId++}`;
  public data: unknown = undefined;
  public rooms: Set<string> = new Set<string>([this.id, "a-project-room"]);
  public emitted: Array<string> = [];

  public constructor(userId: ObjectID, sessionId: ObjectID) {
    RealtimeSessions.begin(this, {
      userId: userId.toString(),
      isMasterAdmin: false,
      sessionId: sessionId.toString(),
      expiresAtMs: Date.now() + 15 * 60 * 1000,
    });
  }

  public leave(room: string): void {
    this.rooms.delete(room);
  }

  public emit(event: string): boolean {
    this.emitted.push(event);
    return true;
  }

  public on(): unknown {
    return this;
  }

  public hearsLiveUpdates(): boolean {
    return (
      RealtimeSessions.getSession(this) !== null &&
      this.rooms.has("a-project-room")
    );
  }
}

describe("live updates follow every change of access", () => {
  let announced: Array<RealtimeAccessChange>;
  let built: Array<string>;

  beforeEach(() => {
    RealtimeReaders.clear();
    RealtimeSessions.clear();
    announced = [];
    built = [];

    // No Valkey here: every change applies on this server only.
    jest.spyOn(Redis, "isConnected").mockReturnValue(false);

    const announce: (change: RealtimeAccessChange) => void =
      RealtimeAccessChanges.announce.bind(RealtimeAccessChanges);

    jest
      .spyOn(RealtimeAccessChanges, "announce")
      .mockImplementation((change: RealtimeAccessChange): void => {
        announced.push(change);
        announce(change);
      });

    jest
      .spyOn(RealtimeReaders, "buildProps")
      .mockImplementation(
        async (
          identity: RealtimeReaderIdentity,
          projectId: string,
        ): Promise<DatabaseCommonInteractionProps | null> => {
          built.push(`${identity.userId}@${projectId}`);
          return {
            userId: new ObjectID(identity.userId),
            tenantId: new ObjectID(projectId),
          };
        },
      );

    jest
      .spyOn(UserSessionService, "revokeAllSessionsByUserId")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    RealtimeReaders.clear();
    RealtimeSessions.clear();
  });

  describe("a session that ends", () => {
    test("a revoked session (signing out) ends the live updates opened with it, and only those", async () => {
      const signedOut: ListeningSocket = new ListeningSocket(USER, SESSION);
      const otherDevice: ListeningSocket = new ListeningSocket(
        USER,
        OTHER_SESSION,
      );

      await hooksOf(UserSessionService).onUpdateSuccess(
        updateOf({ isRevoked: true, revokedReason: "User logout" }),
        [SESSION],
      );

      expect(announced).toEqual([
        {
          kind: RealtimeAccessChangeKind.SessionsEnded,
          sessionIds: [SESSION.toString()],
        },
      ]);
      expect(signedOut.hearsLiveUpdates()).toBe(false);
      expect(signedOut.emitted).toEqual([EventName.AuthenticationRequired]);
      expect(otherDevice.hearsLiveUpdates()).toBe(true);
    });

    test("revoking every session of a person (a password change) ends each of them", async () => {
      const first: ListeningSocket = new ListeningSocket(USER, SESSION);
      const second: ListeningSocket = new ListeningSocket(USER, OTHER_SESSION);

      await hooksOf(UserSessionService).onUpdateSuccess(
        updateOf({ isRevoked: true }),
        [SESSION, OTHER_SESSION],
      );

      expect(first.hearsLiveUpdates()).toBe(false);
      expect(second.hearsLiveUpdates()).toBe(false);
    });

    test("a renewed or touched session changes nothing", async () => {
      const socket: ListeningSocket = new ListeningSocket(USER, SESSION);

      await hooksOf(UserSessionService).onUpdateSuccess(
        updateOf({ isRevoked: false }),
        [SESSION],
      );
      await hooksOf(UserSessionService).onUpdateSuccess(
        updateOf({ lastActiveAt: new Date() }),
        [SESSION],
      );

      expect(announced).toEqual([]);
      expect(socket.hearsLiveUpdates()).toBe(true);
    });

    test("a revocation that matched no session announces nothing", async () => {
      await hooksOf(UserSessionService).onUpdateSuccess(
        updateOf({ isRevoked: true }),
        [],
      );

      expect(announced).toEqual([]);
    });

    test("a deleted session ends its live updates too", async () => {
      const socket: ListeningSocket = new ListeningSocket(USER, SESSION);

      await hooksOf(UserSessionService).onDeleteSuccess(deleteOf(), [SESSION]);

      expect(socket.hearsLiveUpdates()).toBe(false);
    });

    /*
     * The hook reads what every revocation writes: revokeSessionById and
     * revokeAllSessionsByUserId both set isRevoked to true through this
     * service, so signing out, a password change, a block and a refresh
     * token past its time all pass through it.
     */
    test("every way of revoking a session writes what the hook reads", async () => {
      (
        UserSessionService.revokeAllSessionsByUserId as unknown as jest.Mock
      ).mockRestore();

      const updateOneById: jest.SpyInstance = jest
        .spyOn(UserSessionService, "updateOneById")
        .mockResolvedValue(undefined as never);
      const updateBy: jest.SpyInstance = jest
        .spyOn(UserSessionService, "updateBy")
        .mockResolvedValue(0 as never);
      jest
        .spyOn(UserSessionService, "findActiveSessionByRefreshToken")
        .mockResolvedValue({ id: SESSION } as unknown as UserSession);

      await UserSessionService.revokeSessionById(SESSION, {
        reason: "User logout",
      });
      await UserSessionService.revokeSessionByRefreshToken("a-refresh-token", {
        reason: "User logout",
      });
      await UserSessionService.revokeAllSessionsByUserId(USER, {
        reason: "Password changed",
      });

      expect(updateOneById).toHaveBeenCalledTimes(2);

      for (const call of updateOneById.mock.calls) {
        expect(call[0]).toEqual(
          expect.objectContaining({
            id: SESSION,
            data: expect.objectContaining({ isRevoked: true }),
          }),
        );
        expect(call[0].props?.ignoreHooks).toBeFalsy();
      }

      expect(updateBy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isRevoked: true }),
        }),
      );
      expect(updateBy.mock.calls[0]![0].props?.ignoreHooks).toBeFalsy();
    });
  });

  describe("blocking someone, and taking server admin away", () => {
    test("a block ends every session of theirs and forgets who they are, at once", async () => {
      const blockedTab: ListeningSocket = new ListeningSocket(USER, SESSION);
      const someoneElse: ListeningSocket = new ListeningSocket(
        OTHER_USER,
        OTHER_SESSION,
      );
      const forgetBlockedStatus: jest.SpyInstance = jest.spyOn(
        UserService,
        "forgetBlockedStatus",
      );

      await RealtimeReaders.getReader(
        { userId: USER.toString(), isMasterAdmin: false },
        PROJECT,
      );
      expect(RealtimeReaders.size()).toBe(1);

      await hooksOf(UserService).onUpdateSuccess(
        updateOf({ isBlocked: true }),
        [USER],
      );

      expect(UserSessionService.revokeAllSessionsByUserId).toHaveBeenCalledWith(
        USER,
        { reason: "User blocked" },
      );
      expect(announced).toEqual([
        {
          kind: RealtimeAccessChangeKind.SessionsEnded,
          userId: USER.toString(),
        },
        {
          kind: RealtimeAccessChangeKind.AccountChanged,
          userId: USER.toString(),
        },
      ]);
      expect(blockedTab.hearsLiveUpdates()).toBe(false);
      expect(someoneElse.hearsLiveUpdates()).toBe(true);
      expect(RealtimeReaders.size()).toBe(0);
      expect(forgetBlockedStatus).toHaveBeenCalledWith(USER);
    });

    test("an unblock forgets whether they are blocked, and ends nothing", async () => {
      const socket: ListeningSocket = new ListeningSocket(USER, SESSION);

      await hooksOf(UserService).onUpdateSuccess(
        updateOf({ isBlocked: false }),
        [USER],
      );

      expect(announced).toEqual([
        {
          kind: RealtimeAccessChangeKind.AccountChanged,
          userId: USER.toString(),
        },
      ]);
      expect(socket.hearsLiveUpdates()).toBe(true);
    });

    test("taking server admin away makes their next live update read them as they are now", async () => {
      const admin: RealtimeReaderIdentity = {
        userId: USER.toString(),
        isMasterAdmin: true,
      };

      await RealtimeReaders.getReader(admin, PROJECT);
      await RealtimeReaders.getReader(admin, OTHER_PROJECT);
      expect(built).toHaveLength(2);

      await hooksOf(UserService).onUpdateSuccess(
        updateOf({ isMasterAdmin: false }),
        [USER],
      );

      expect(announced).toEqual([
        {
          kind: RealtimeAccessChangeKind.AccountChanged,
          userId: USER.toString(),
        },
      ]);
      expect(RealtimeReaders.size()).toBe(0);

      await RealtimeReaders.getReader(admin, PROJECT);

      expect(built).toHaveLength(3);
    });

    test("an update that touches neither announces nothing", async () => {
      await RealtimeReaders.getReader(
        { userId: USER.toString(), isMasterAdmin: false },
        PROJECT,
      );

      await hooksOf(UserService).onUpdateSuccess(
        updateOf({ name: "Renamed" }),
        [USER],
      );

      expect(announced).toEqual([]);
      expect(RealtimeReaders.size()).toBe(1);
    });

    test("a block of several people ends each of their sessions", async () => {
      const first: ListeningSocket = new ListeningSocket(USER, SESSION);
      const second: ListeningSocket = new ListeningSocket(
        OTHER_USER,
        OTHER_SESSION,
      );

      await hooksOf(UserService).onUpdateSuccess(
        updateOf({ isBlocked: true }),
        [USER, OTHER_USER],
      );

      expect(first.hearsLiveUpdates()).toBe(false);
      expect(second.hearsLiveUpdates()).toBe(false);
    });

    test("a deleted account's live updates end at once", async () => {
      const socket: ListeningSocket = new ListeningSocket(USER, SESSION);

      await hooksOf(UserService).onDeleteSuccess(deleteOf(), [USER]);

      expect(announced).toEqual([
        {
          kind: RealtimeAccessChangeKind.SessionsEnded,
          userId: USER.toString(),
        },
      ]);
      expect(socket.hearsLiveUpdates()).toBe(false);
    });
  });

  describe("a team membership or permission that changes", () => {
    function member(teamId: ObjectID): TeamMember {
      const row: TeamMember = new TeamMember();
      row.teamId = teamId;
      return row;
    }

    let teamRows: jest.SpyInstance;

    beforeEach(() => {
      jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined);
      jest.spyOn(GlobalCache, "deleteKey").mockResolvedValue(undefined);
      jest.spyOn(TeamMemberService, "findAllBy").mockResolvedValue([]);
      jest.spyOn(TeamPermissionService, "findBy").mockResolvedValue([]);
      teamRows = jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([]);
    });

    test("leaving the project's last team forgets their entry there at once, and the team list this server keeps", async () => {
      const forgetTeamIds: jest.SpyInstance = jest.spyOn(
        TeamMemberService,
        "forgetTeamIdsForUser",
      );
      const person: RealtimeReaderIdentity = {
        userId: USER.toString(),
        isMasterAdmin: false,
      };

      await RealtimeReaders.getReader(person, PROJECT);
      await RealtimeReaders.getReader(person, OTHER_PROJECT);

      await AccessTokenService.refreshUserTenantAccessPermission(USER, PROJECT);

      expect(announced).toEqual([
        {
          kind: RealtimeAccessChangeKind.PermissionsChanged,
          userId: USER.toString(),
          projectId: PROJECT.toString(),
        },
      ]);
      expect(forgetTeamIds).toHaveBeenCalledWith(USER, PROJECT);
      // Only that project's entry goes.
      expect(RealtimeReaders.size()).toBe(1);

      await RealtimeReaders.getReader(person, PROJECT);
      expect(built).toEqual([
        `${USER.toString()}@${PROJECT.toString()}`,
        `${USER.toString()}@${OTHER_PROJECT.toString()}`,
        `${USER.toString()}@${PROJECT.toString()}`,
      ]);
    });

    test("a permission that changes for a member is announced for that project", async () => {
      teamRows.mockResolvedValue([member(TEAM)]);

      await AccessTokenService.refreshUserTenantAccessPermission(USER, PROJECT);

      expect(announced).toEqual([
        {
          kind: RealtimeAccessChangeKind.PermissionsChanged,
          userId: USER.toString(),
          projectId: PROJECT.toString(),
        },
      ]);
    });

    test("a change to the projects they belong to is announced for every project", async () => {
      await AccessTokenService.refreshUserGlobalAccessPermission(USER);

      expect(announced).toEqual([
        {
          kind: RealtimeAccessChangeKind.PermissionsChanged,
          userId: USER.toString(),
        },
      ]);
    });

    test("filling a cache that had nothing is not a change: nothing is announced", async () => {
      await AccessTokenService.refreshUserGlobalAccessPermission(USER, {
        forgetLiveUpdateReaders: false,
      });
      await AccessTokenService.refreshUserTenantAccessPermission(
        USER,
        PROJECT,
        { forgetLiveUpdateReaders: false },
      );

      expect(announced).toEqual([]);
    });

    test("dropping the cached permissions after a failed refresh is announced too", async () => {
      await AccessTokenService.clearCachedPermissions(USER, PROJECT);

      expect(announced).toEqual([
        {
          kind: RealtimeAccessChangeKind.PermissionsChanged,
          userId: USER.toString(),
          projectId: PROJECT.toString(),
        },
      ]);
    });

    test("a sign-in rebuilds every project's permissions and announces once, after all of them", async () => {
      const order: Array<string> = [];

      jest.spyOn(TeamMemberService, "findAllBy").mockResolvedValue(
        [PROJECT, OTHER_PROJECT].map((projectId: ObjectID): TeamMember => {
          const row: TeamMember = new TeamMember();
          row.projectId = projectId;
          return row;
        }),
      );
      (GlobalCache.setJSON as unknown as jest.Mock).mockImplementation(
        async (): Promise<void> => {
          order.push("rebuilt");
        },
      );
      (GlobalCache.deleteKey as unknown as jest.Mock).mockImplementation(
        async (): Promise<void> => {
          order.push("rebuilt");
        },
      );
      (
        RealtimeAccessChanges.announce as unknown as jest.Mock
      ).mockImplementation((change: RealtimeAccessChange): void => {
        announced.push(change);
        order.push("announced");
      });

      await AccessTokenService.refreshUserAllPermissions(USER);

      expect(announced).toEqual([
        {
          kind: RealtimeAccessChangeKind.PermissionsChanged,
          userId: USER.toString(),
        },
      ]);
      // The global set and one per project, then the one announcement.
      expect(
        order.filter((step: string) => {
          return step === "rebuilt";
        }),
      ).toHaveLength(3);
      expect(order[order.length - 1]).toBe("announced");
    });

    test("a change in every project forgets the person's team lists in every project, and nobody else's", async () => {
      teamRows.mockResolvedValue([member(TEAM)]);

      // Nothing left over from another test: each list is read once first.
      TeamMemberService.forgetTeamIdsForUser(USER, PROJECT);
      TeamMemberService.forgetTeamIdsForUser(USER, OTHER_PROJECT);
      TeamMemberService.forgetTeamIdsForUser(OTHER_USER, PROJECT);

      await TeamMemberService.getTeamIdsForUser(USER, PROJECT);
      await TeamMemberService.getTeamIdsForUser(USER, OTHER_PROJECT);
      await TeamMemberService.getTeamIdsForUser(OTHER_USER, PROJECT);

      expect(teamRows).toHaveBeenCalledTimes(3);

      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.PermissionsChanged,
        userId: USER.toString(),
      });

      await TeamMemberService.getTeamIdsForUser(USER, PROJECT);
      await TeamMemberService.getTeamIdsForUser(USER, OTHER_PROJECT);
      await TeamMemberService.getTeamIdsForUser(OTHER_USER, PROJECT);

      // Theirs are read again; the other person's still come from the cache.
      expect(teamRows).toHaveBeenCalledTimes(5);
    });

    test("a membership change in a project is announced once, for that project", async () => {
      await TeamMemberService.refreshTokens(USER, PROJECT);

      expect(announced).toEqual([
        {
          kind: RealtimeAccessChangeKind.PermissionsChanged,
          userId: USER.toString(),
          projectId: PROJECT.toString(),
        },
      ]);
    });
  });

  describe("a change to the sign-in rules", () => {
    type ProjectHooks = {
      onUpdateSuccess: (
        onUpdate: OnUpdate<User & UserSession>,
        updatedItemIds: Array<ObjectID>,
      ) => Promise<unknown>;
    };

    const projectHooks: ProjectHooks =
      ProjectService as unknown as ProjectHooks;
    const instanceHooks: ProjectHooks =
      GlobalConfigService as unknown as ProjectHooks;

    test("turning on Require SSO for projects announces it for each of them", async () => {
      await projectHooks.onUpdateSuccess(
        updateOf<User>({ requireSsoForLogin: true }),
        [PROJECT, OTHER_PROJECT],
      );

      expect(announced).toEqual([
        {
          kind: RealtimeAccessChangeKind.SignInRulesChanged,
          projectId: PROJECT.toString(),
        },
        {
          kind: RealtimeAccessChangeKind.SignInRulesChanged,
          projectId: OTHER_PROJECT.toString(),
        },
      ]);
    });

    test("pinning the provider a project's SSO sign-in must come from announces it too", async () => {
      await projectHooks.onUpdateSuccess(
        updateOf<User>({ requireSsoWithSsoProviderId: TEAM }),
        [PROJECT],
      );

      expect(announced).toEqual([
        {
          kind: RealtimeAccessChangeKind.SignInRulesChanged,
          projectId: PROJECT.toString(),
        },
      ]);
    });

    test("turning Require SSO off, or clearing the pinned provider, is announced once per project too: no server keeps refusing people with the rule it held", async () => {
      await projectHooks.onUpdateSuccess(
        updateOf<User>({ requireSsoForLogin: false }),
        [PROJECT],
      );
      await projectHooks.onUpdateSuccess(
        updateOf<User>({ requireSsoWithSsoProviderId: null }),
        [PROJECT, OTHER_PROJECT],
      );

      expect(announced).toEqual([
        {
          kind: RealtimeAccessChangeKind.SignInRulesChanged,
          projectId: PROJECT.toString(),
        },
        {
          kind: RealtimeAccessChangeKind.SignInRulesChanged,
          projectId: PROJECT.toString(),
        },
        {
          kind: RealtimeAccessChangeKind.SignInRulesChanged,
          projectId: OTHER_PROJECT.toString(),
        },
      ]);
    });

    test("a project update that wrote no project announces nothing, whatever it names", async () => {
      await projectHooks.onUpdateSuccess(
        updateOf<User>({ requireSsoForLogin: false }),
        [],
      );

      expect(announced).toEqual([]);
    });

    test("turning the instance-wide rule off is announced once, for every project", async () => {
      await instanceHooks.onUpdateSuccess(
        updateOf<User>({ requireSsoForLogin: false }),
        [TEAM],
      );

      expect(announced).toEqual([
        { kind: RealtimeAccessChangeKind.SignInRulesChanged },
      ]);
    });

    test("an instance-wide settings update that leaves Require SSO alone announces nothing", async () => {
      await instanceHooks.onUpdateSuccess(
        updateOf<User>({ name: "Renamed" }),
        [TEAM],
      );

      expect(announced).toEqual([]);
    });

    test("a project update that touches neither announces nothing", async () => {
      await projectHooks.onUpdateSuccess(updateOf<User>({ name: "Renamed" }), [
        PROJECT,
      ]);

      expect(announced).toEqual([]);
    });

    test("the instance-wide rule is announced for every project", async () => {
      await instanceHooks.onUpdateSuccess(
        updateOf<User>({ requireSsoForLogin: true }),
        [TEAM],
      );

      expect(announced).toEqual([
        { kind: RealtimeAccessChangeKind.SignInRulesChanged },
      ]);
    });
  });
});
