import RealtimeReaders, {
  RealtimeReaderIdentity,
} from "../../../../Server/Utils/Realtime/RealtimeReaders";
import { RealtimeReader } from "../../../../Server/Utils/Realtime/RealtimeReadAccess";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * The people behind the sockets, as their reads see them: their props in
 * the record's project, built as a request's are, kept for a short while
 * per person and project, and forgotten as soon as their permissions
 * change on this server.
 */

const PROJECT: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_PROJECT: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER: string = "11111111-1111-4111-8111-111111111111";
const OTHER_USER: string = "22222222-2222-4222-8222-222222222222";
const TEAM: string = "33333333-3333-4333-8333-333333333333";

const person: RealtimeReaderIdentity = { userId: USER, isMasterAdmin: false };

function tenantPermission(projectId: string): UserTenantAccessPermission {
  return {
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(projectId),
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectMember,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  };
}

const globalPermission: UserGlobalAccessPermission = {
  _type: "UserGlobalAccessPermission",
  projectIds: [new ObjectID(PROJECT)],
  globalPermissions: [Permission.Public, Permission.User],
};

describe("RealtimeReaders", () => {
  let built: Array<string> = [];

  beforeEach(() => {
    built = [];
    RealtimeReaders.clear();
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
  });

  afterEach(() => {
    jest.restoreAllMocks();
    RealtimeReaders.clear();
  });

  describe("the entry of a person in a project", () => {
    test("is built once while it lives, whoever asks for it", async () => {
      const [first, second]: Array<RealtimeReader | null> = await Promise.all([
        RealtimeReaders.getReader(person, PROJECT),
        RealtimeReaders.getReader(person, PROJECT),
      ]);
      const third: RealtimeReader | null = await RealtimeReaders.getReader(
        person,
        PROJECT,
      );

      expect(built).toEqual([`${USER}@${PROJECT}`]);
      expect(first).toBe(second);
      expect(third).toBe(first);
      expect(first!.key).toBe(RealtimeReaders.getKey(person, PROJECT));
    });

    test("is kept apart per project and per person", async () => {
      await RealtimeReaders.getReader(person, PROJECT);
      await RealtimeReaders.getReader(person, OTHER_PROJECT);
      await RealtimeReaders.getReader(
        { userId: OTHER_USER, isMasterAdmin: false },
        PROJECT,
      );

      expect(built).toEqual([
        `${USER}@${PROJECT}`,
        `${USER}@${OTHER_PROJECT}`,
        `${OTHER_USER}@${PROJECT}`,
      ]);
      expect(RealtimeReaders.size()).toBe(3);
    });

    test("a server admin's entry is not a member's", () => {
      expect(
        RealtimeReaders.getKey({ userId: USER, isMasterAdmin: true }, PROJECT),
      ).not.toBe(RealtimeReaders.getKey(person, PROJECT));
    });

    test("keys ignore the case of ids", () => {
      expect(
        RealtimeReaders.getKey(
          { userId: USER.toUpperCase(), isMasterAdmin: false },
          PROJECT.toUpperCase(),
        ),
      ).toBe(RealtimeReaders.getKey(person, PROJECT));
    });

    test("is built again once ENTRY_TTL_IN_MS has passed", async () => {
      let now: number = 1_000_000;
      jest.spyOn(Date, "now").mockImplementation((): number => {
        return now;
      });

      await RealtimeReaders.getReader(person, PROJECT);
      now += RealtimeReaders.ENTRY_TTL_IN_MS - 1;
      await RealtimeReaders.getReader(person, PROJECT);
      expect(built).toHaveLength(1);

      now += 2;
      await RealtimeReaders.getReader(person, PROJECT);
      expect(built).toHaveLength(2);
    });

    test("a person who is not a member of the project reads nothing there", async () => {
      (RealtimeReaders.buildProps as unknown as jest.Mock).mockResolvedValueOnce(
        null,
      );

      await expect(
        RealtimeReaders.getReader(person, PROJECT),
      ).resolves.toBeNull();
    });

    test("a lookup that fails is not kept: the next one asks again", async () => {
      (RealtimeReaders.buildProps as unknown as jest.Mock).mockRejectedValueOnce(
        new Error("The permission cache is down"),
      );

      await expect(RealtimeReaders.getReader(person, PROJECT)).rejects.toThrow(
        "The permission cache is down",
      );
      expect(RealtimeReaders.size()).toBe(0);

      await expect(
        RealtimeReaders.getReader(person, PROJECT),
      ).resolves.not.toBeNull();
    });

    test("past MAX_ENTRIES the oldest entry goes first", async () => {
      for (let i: number = 0; i < RealtimeReaders.MAX_ENTRIES; i++) {
        await RealtimeReaders.getReader(
          { userId: ObjectID.generate().toString(), isMasterAdmin: false },
          PROJECT,
        );
      }

      const oldestUserId: string = built[0]!.split("@")[0]!;

      await RealtimeReaders.getReader(person, PROJECT);

      expect(RealtimeReaders.size()).toBe(RealtimeReaders.MAX_ENTRIES);

      // The oldest was let go, so it is built again; the newest was kept.
      built = [];
      await RealtimeReaders.getReader(person, PROJECT);
      await RealtimeReaders.getReader(
        { userId: oldestUserId, isMasterAdmin: false },
        PROJECT,
      );
      expect(built).toEqual([`${oldestUserId}@${PROJECT}`]);
    });
  });

  describe("forgetting a person when their permissions change", () => {
    test("in one project: that entry is built again, the others are kept", async () => {
      await RealtimeReaders.getReader(person, PROJECT);
      await RealtimeReaders.getReader(person, OTHER_PROJECT);
      await RealtimeReaders.getReader(
        { userId: OTHER_USER, isMasterAdmin: false },
        PROJECT,
      );

      RealtimeReaders.forgetUser(new ObjectID(USER), new ObjectID(PROJECT));
      built = [];

      await RealtimeReaders.getReader(person, PROJECT);
      await RealtimeReaders.getReader(person, OTHER_PROJECT);
      await RealtimeReaders.getReader(
        { userId: OTHER_USER, isMasterAdmin: false },
        PROJECT,
      );

      expect(built).toEqual([`${USER}@${PROJECT}`]);
    });

    test("in every project: all of their entries go, nobody else's", async () => {
      await RealtimeReaders.getReader(person, PROJECT);
      await RealtimeReaders.getReader(person, OTHER_PROJECT);
      await RealtimeReaders.getReader(
        { userId: OTHER_USER, isMasterAdmin: false },
        PROJECT,
      );

      RealtimeReaders.forgetUser(USER.toUpperCase());

      expect(RealtimeReaders.size()).toBe(1);
    });
  });

  describe("remember: worked out once per entry", () => {
    test("a value is worked out once, and each name has its own", async () => {
      const reader: RealtimeReader = (await RealtimeReaders.getReader(
        person,
        PROJECT,
      ))!;
      let worked: number = 0;

      const work: () => Promise<number> = async (): Promise<number> => {
        worked++;
        return 42;
      };

      await expect(reader.remember("a", work)).resolves.toBe(42);
      await expect(reader.remember("a", work)).resolves.toBe(42);
      await expect(reader.remember("b", work)).resolves.toBe(42);

      expect(worked).toBe(2);
    });

    test("a value that fails is worked out again next time", async () => {
      const reader: RealtimeReader = (await RealtimeReaders.getReader(
        person,
        PROJECT,
      ))!;
      let attempts: number = 0;

      const work: () => Promise<string> = async (): Promise<string> => {
        attempts++;

        if (attempts === 1) {
          throw new Error("Not yet");
        }

        return "ready";
      };

      await expect(reader.remember("scope", work)).rejects.toThrow("Not yet");
      await expect(reader.remember("scope", work)).resolves.toBe("ready");
    });

    test("a forgotten entry forgets what it remembered", async () => {
      const first: RealtimeReader = (await RealtimeReaders.getReader(
        person,
        PROJECT,
      ))!;
      let worked: number = 0;

      await first.remember("x", async (): Promise<boolean> => {
        worked++;
        return true;
      });

      RealtimeReaders.forgetUser(USER, PROJECT);

      const second: RealtimeReader = (await RealtimeReaders.getReader(
        person,
        PROJECT,
      ))!;

      await second.remember("x", async (): Promise<boolean> => {
        worked++;
        return true;
      });

      expect(worked).toBe(2);
    });
  });
});

describe("RealtimeReaders.buildProps", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a member's props carry their permissions in the project, their global permissions and their teams", async () => {
    jest
      .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
      .mockResolvedValue(globalPermission);
    const tenant: jest.SpyInstance = jest
      .spyOn(AccessTokenService, "getUserTenantAccessPermission")
      .mockResolvedValue(tenantPermission(PROJECT));
    const teams: jest.SpyInstance = jest
      .spyOn(TeamMemberService, "getTeamIdsForUser")
      .mockResolvedValue([new ObjectID(TEAM)]);

    const props: DatabaseCommonInteractionProps | null =
      await RealtimeReaders.buildProps(person, PROJECT);

    expect(props).toEqual({
      userId: new ObjectID(USER),
      userType: UserType.User,
      tenantId: new ObjectID(PROJECT),
      userGlobalAccessPermission: globalPermission,
      userTenantAccessPermission: {
        [PROJECT]: tenantPermission(PROJECT),
      },
      userTeamIds: [new ObjectID(TEAM)],
    });
    expect(tenant.mock.calls[0]![0]!.toString()).toBe(USER);
    expect(tenant.mock.calls[0]![1]!.toString()).toBe(PROJECT);
    expect(teams.mock.calls[0]![1]!.toString()).toBe(PROJECT);
  });

  test("someone whose membership is gone gets no props", async () => {
    jest
      .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
      .mockResolvedValue(globalPermission);
    jest
      .spyOn(AccessTokenService, "getUserTenantAccessPermission")
      .mockResolvedValue(null);
    jest.spyOn(TeamMemberService, "getTeamIdsForUser").mockResolvedValue([]);

    await expect(
      RealtimeReaders.buildProps(person, PROJECT),
    ).resolves.toBeNull();
  });

  test("a server admin reads as a server admin, with no lookups", async () => {
    const global: jest.SpyInstance = jest.spyOn(
      AccessTokenService,
      "getUserGlobalAccessPermission",
    );

    await expect(
      RealtimeReaders.buildProps({ userId: USER, isMasterAdmin: true }, PROJECT),
    ).resolves.toEqual({
      userId: new ObjectID(USER),
      userType: UserType.MasterAdmin,
      isMasterAdmin: true,
      tenantId: new ObjectID(PROJECT),
    });
    expect(global).not.toHaveBeenCalled();
  });

  test("permissions that cannot be read make the lookup fail rather than read as nothing held", async () => {
    jest
      .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
      .mockRejectedValue(new Error("Redis is down"));
    jest
      .spyOn(AccessTokenService, "getUserTenantAccessPermission")
      .mockRejectedValue(new Error("Redis is down"));
    jest.spyOn(TeamMemberService, "getTeamIdsForUser").mockResolvedValue([]);

    await expect(RealtimeReaders.buildProps(person, PROJECT)).rejects.toThrow(
      "Redis is down",
    );
  });
});
