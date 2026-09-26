/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import DatabaseServerFeedService from "../../../Server/Services/DatabaseServerFeedService";
import DatabaseServerOwnerTeamService from "../../../Server/Services/DatabaseServerOwnerTeamService";
import DatabaseServerOwnerUserService from "../../../Server/Services/DatabaseServerOwnerUserService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import DatabaseServerFeed, {
  DatabaseServerFeedEventType,
} from "../../../Models/DatabaseModels/DatabaseServerFeed";
import DatabaseServerOwnerTeam from "../../../Models/DatabaseModels/DatabaseServerOwnerTeam";
import DatabaseServerOwnerUser from "../../../Models/DatabaseModels/DatabaseServerOwnerUser";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Blue500, Gray500, Red500 } from "../../../Types/BrandColors";
import Email from "../../../Types/Email";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { getJestSpyOn } from "../../Spy";

/*
 * The database feed and the owner join services: every owner change is
 * explained on the database's feed, and a feed write can never fail the
 * change it describes.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const DATABASE_ID: ObjectID = ObjectID.generate();
const TEAM_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const ACTING_USER_ID: ObjectID = ObjectID.generate();
const LINK: string = "[Database PostgreSQL orders-db.internal:5432](/db)";

let feed: jest.SpyInstance;

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
  getJestSpyOn(
    DatabaseServerService,
    "getDatabaseServerMarkdownLink",
  ).mockResolvedValue(LINK);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("DatabaseServerFeedService.createDatabaseServerFeedItem", () => {
  test("writes the item as root, defaulting the color and the time", async () => {
    const create: jest.SpyInstance = getJestSpyOn(
      DatabaseServerFeedService,
      "create",
    ).mockResolvedValue({});

    await DatabaseServerFeedService.createDatabaseServerFeedItem({
      databaseServerId: DATABASE_ID,
      projectId: PROJECT_ID,
      databaseServerFeedEventType:
        DatabaseServerFeedEventType.DatabaseServerUpdated,
      feedInfoInMarkdown: "📝 updated",
      moreInformationInMarkdown: "**Updated fields**: `name`",
      userId: ACTING_USER_ID,
    });

    const call: any = create.mock.calls[0]![0];
    expect(call.props).toEqual({ isRoot: true });
    const item: DatabaseServerFeed = call.data;
    expect(item.databaseServerId).toBe(DATABASE_ID);
    expect(item.projectId).toBe(PROJECT_ID);
    expect(item.databaseServerFeedEventType).toBe(
      DatabaseServerFeedEventType.DatabaseServerUpdated,
    );
    expect(item.displayColor).toEqual(Blue500);
    expect(item.postedAt).toBeInstanceOf(Date);
    expect(item.userId).toBe(ACTING_USER_ID);
    expect(item.moreInformationInMarkdown).toBe("**Updated fields**: `name`");
  });

  test("a failing write is swallowed and logged", async () => {
    getJestSpyOn(DatabaseServerFeedService, "create").mockRejectedValue(
      new Error("connection terminated"),
    );

    await expect(
      DatabaseServerFeedService.createDatabaseServerFeedItem({
        databaseServerId: DATABASE_ID,
        projectId: PROJECT_ID,
        databaseServerFeedEventType:
          DatabaseServerFeedEventType.DatabaseServerCreated,
        feedInfoInMarkdown: "🚀 created",
      }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  test("an item without its database is never written", async () => {
    const create: jest.SpyInstance = getJestSpyOn(
      DatabaseServerFeedService,
      "create",
    );

    await DatabaseServerFeedService.createDatabaseServerFeedItem({
      databaseServerId: undefined as unknown as ObjectID,
      projectId: PROJECT_ID,
      databaseServerFeedEventType:
        DatabaseServerFeedEventType.DatabaseServerCreated,
      feedInfoInMarkdown: "🚀 created",
    });

    expect(create).not.toHaveBeenCalled();
  });
});

describe("DatabaseServerOwnerTeamService feed items", () => {
  beforeEach(() => {
    feed = getJestSpyOn(
      DatabaseServerFeedService,
      "createDatabaseServerFeedItem",
    ).mockResolvedValue(undefined);
    const team: Team = new Team(TEAM_ID);
    team.name = "Data Platform";
    getJestSpyOn(TeamService, "findOneById").mockResolvedValue(team);
  });

  test("adding a team owner is recorded on the database's feed", async () => {
    const owner: DatabaseServerOwnerTeam = new DatabaseServerOwnerTeam();
    owner.databaseServerId = DATABASE_ID;
    owner.projectId = PROJECT_ID;
    owner.teamId = TEAM_ID;

    await DatabaseServerOwnerTeamService.onCreateSuccess(
      {
        createBy: { data: owner, props: { userId: ACTING_USER_ID } },
        carryForward: null,
      },
      owner,
    );

    const item: any = feed.mock.calls[0]![0];
    expect(item.databaseServerId).toBe(DATABASE_ID);
    expect(item.databaseServerFeedEventType).toBe(
      DatabaseServerFeedEventType.OwnerTeamAdded,
    );
    expect(item.displayColor).toEqual(Gray500);
    expect(item.feedInfoInMarkdown).toContain(
      `Added team **Data Platform** as an owner of ${LINK}.`,
    );
    expect(item.userId).toBe(ACTING_USER_ID);
  });

  test("removing a team owner is recorded from the rows read before the delete", async () => {
    const row: DatabaseServerOwnerTeam = new DatabaseServerOwnerTeam();
    row.databaseServerId = DATABASE_ID;
    row.projectId = PROJECT_ID;
    row.teamId = TEAM_ID;
    const findBy: jest.SpyInstance = getJestSpyOn(
      DatabaseServerOwnerTeamService,
      "findBy",
    ).mockResolvedValue([row]);
    const ownerTeamService: any = DatabaseServerOwnerTeamService;

    const onDelete: any = await ownerTeamService.onBeforeDelete({
      query: { _id: ObjectID.generate().toString() },
      limit: 1,
      skip: 0,
      props: { userId: ACTING_USER_ID },
    });
    expect(findBy.mock.calls[0]![0].select).toEqual({
      databaseServerId: true,
      projectId: true,
      teamId: true,
    });

    await ownerTeamService.onDeleteSuccess(onDelete, []);

    const item: any = feed.mock.calls[0]![0];
    expect(item.databaseServerFeedEventType).toBe(
      DatabaseServerFeedEventType.OwnerTeamRemoved,
    );
    expect(item.displayColor).toEqual(Red500);
    expect(item.feedInfoInMarkdown).toContain(
      `Removed team **Data Platform** as an owner of ${LINK}.`,
    );
    expect(item.userId).toBe(ACTING_USER_ID);
  });
});

describe("DatabaseServerOwnerUserService feed items", () => {
  beforeEach(() => {
    feed = getJestSpyOn(
      DatabaseServerFeedService,
      "createDatabaseServerFeedItem",
    ).mockResolvedValue(undefined);
  });

  test("adding a user owner is recorded on the database's feed", async () => {
    getJestSpyOn(UserService, "getUserMarkdownString").mockResolvedValue(
      "Jane Doe (jane@example.com)",
    );
    const owner: DatabaseServerOwnerUser = new DatabaseServerOwnerUser();
    owner.databaseServerId = DATABASE_ID;
    owner.projectId = PROJECT_ID;
    owner.userId = USER_ID;

    await DatabaseServerOwnerUserService.onCreateSuccess(
      {
        createBy: { data: owner, props: { userId: ACTING_USER_ID } },
        carryForward: null,
      },
      owner,
    );

    const item: any = feed.mock.calls[0]![0];
    expect(item.databaseServerFeedEventType).toBe(
      DatabaseServerFeedEventType.OwnerUserAdded,
    );
    expect(item.feedInfoInMarkdown).toContain(
      `Added **Jane Doe (jane@example.com)** as an owner of ${LINK}.`,
    );
  });

  test("removing a user owner names who was removed", async () => {
    const row: DatabaseServerOwnerUser = new DatabaseServerOwnerUser();
    row.databaseServerId = DATABASE_ID;
    row.projectId = PROJECT_ID;
    row.userId = USER_ID;
    getJestSpyOn(DatabaseServerOwnerUserService, "findBy").mockResolvedValue([
      row,
    ]);
    const user: User = new User(USER_ID);
    user.name = new Name("Jane Doe");
    user.email = new Email("jane@example.com");
    getJestSpyOn(UserService, "findOneById").mockResolvedValue(user);
    const ownerUserService: any = DatabaseServerOwnerUserService;

    const onDelete: any = await ownerUserService.onBeforeDelete({
      query: {},
      limit: 1,
      skip: 0,
      props: { userId: ACTING_USER_ID },
    });
    await ownerUserService.onDeleteSuccess(onDelete, []);

    const item: any = feed.mock.calls[0]![0];
    expect(item.databaseServerFeedEventType).toBe(
      DatabaseServerFeedEventType.OwnerUserRemoved,
    );
    expect(item.feedInfoInMarkdown).toContain(
      `Removed **Jane Doe** (jane@example.com) as an owner of ${LINK}.`,
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * A caller creating owners or feed notes: the database must be in their
 * project, and an owner a person adds counts as investment.
 * ---------------------------------------------------------------------------
 */
describe("database child rows created by a caller", () => {
  const OTHER_DATABASE_ID: ObjectID = ObjectID.generate();

  function callerProps(
    permissions: Array<Permission> = [Permission.ProjectMember],
  ): DatabaseCommonInteractionProps {
    return {
      userId: ACTING_USER_ID,
      tenantId: PROJECT_ID,
      userGlobalAccessPermission: {
        projectIds: [PROJECT_ID],
        globalPermissions: [Permission.Public, Permission.User],
        _type: "UserGlobalAccessPermission",
      },
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          projectId: PROJECT_ID,
          permissions: permissions.map(
            (permission: Permission): UserPermission => {
              return {
                permission,
                labelIds: [],
                isBlockPermission: false,
                _type: "UserPermission",
              };
            },
          ),
          _type: "UserTenantAccessPermission",
        },
      },
    };
  }

  let findDatabase: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(logger, "warn").mockImplementation(() => {
      return undefined as never;
    });
    feed = getJestSpyOn(
      DatabaseServerFeedService,
      "createDatabaseServerFeedItem",
    ).mockResolvedValue(undefined);
    // Only DATABASE_ID lives in PROJECT_ID.
    findDatabase = getJestSpyOn(
      DatabaseServerService,
      "findOneBy",
    ).mockImplementation(async (args: any) => {
      return args.query._id === DATABASE_ID.toString() &&
        args.query.projectId.toString() === PROJECT_ID.toString()
        ? ({ _id: DATABASE_ID.toString() } as never)
        : null;
    });
  });

  describe.each([
    [
      "DatabaseServerOwnerUserService",
      DatabaseServerOwnerUserService as any,
      (): any => {
        const owner: DatabaseServerOwnerUser = new DatabaseServerOwnerUser();
        owner.userId = USER_ID;
        return owner;
      },
    ],
    [
      "DatabaseServerOwnerTeamService",
      DatabaseServerOwnerTeamService as any,
      (): any => {
        const owner: DatabaseServerOwnerTeam = new DatabaseServerOwnerTeam();
        owner.teamId = TEAM_ID;
        return owner;
      },
    ],
    [
      "DatabaseServerFeedService",
      DatabaseServerFeedService as any,
      (): any => {
        const item: DatabaseServerFeed = new DatabaseServerFeed();
        item.feedInfoInMarkdown = "Failover drill at 14:00";
        item.databaseServerFeedEventType =
          DatabaseServerFeedEventType.DatabaseServerUpdated;
        return item;
      },
    ],
  ])(
    "%s.onBeforeCreate",
    (_name: string, childService: any, newChild: () => any) => {
      test("a database of the caller's project is accepted, as the FK column only", async () => {
        const data: any = newChild();
        data.databaseServer = new DatabaseServer(DATABASE_ID);

        await childService.onBeforeCreate({
          data: data,
          props: callerProps(),
        });

        expect(data.databaseServerId.toString()).toBe(DATABASE_ID.toString());
        expect(data.databaseServer).toBeUndefined();
        const lookup: any = findDatabase.mock.calls[0]![0];
        expect(lookup.query.projectId.toString()).toBe(PROJECT_ID.toString());
        expect(lookup.props).toEqual({ isRoot: true });
      });

      test("another project's database is refused - by FK column or by relation object", async () => {
        const byColumn: any = newChild();
        byColumn.databaseServerId = OTHER_DATABASE_ID;
        const byRelation: any = newChild();
        byRelation.databaseServer = new DatabaseServer(OTHER_DATABASE_ID);

        for (const data of [byColumn, byRelation]) {
          await expect(
            childService.onBeforeCreate({ data: data, props: callerProps() }),
          ).rejects.toThrow("Database not found.");
        }
      });

      test("an FK column and a relation object that disagree are refused", async () => {
        const data: any = newChild();
        data.databaseServerId = DATABASE_ID;
        data.databaseServer = new DatabaseServer(OTHER_DATABASE_ID);

        await expect(
          childService.onBeforeCreate({ data: data, props: callerProps() }),
        ).rejects.toThrow("Conflicting database references were provided.");
      });

      test("a caller without the create permission is refused before any lookup", async () => {
        const data: any = newChild();
        data.databaseServerId = OTHER_DATABASE_ID;

        const error: unknown = await childService
          .onBeforeCreate({
            data: data,
            props: callerProps([Permission.ReadDatabaseServer]),
          })
          .catch((e: unknown) => {
            return e;
          });

        expect(error).toBeInstanceOf(NotAuthorizedException);
        expect(findDatabase).not.toHaveBeenCalled();
      });

      test("root writes (rules, the product's own feed items) pass through untouched", async () => {
        const data: any = newChild();
        data.databaseServerId = OTHER_DATABASE_ID;

        await childService.onBeforeCreate({
          data: data,
          props: { isRoot: true },
        });

        expect(findDatabase).not.toHaveBeenCalled();
        expect(data.databaseServerId).toBe(OTHER_DATABASE_ID);
      });
    },
  );

  describe.each([
    [
      "user",
      DatabaseServerOwnerUserService as any,
      "ownerUserIds",
      (): any => {
        const owner: DatabaseServerOwnerUser = new DatabaseServerOwnerUser();
        owner.userId = USER_ID;
        return owner;
      },
      USER_ID,
    ],
    [
      "team",
      DatabaseServerOwnerTeamService as any,
      "ownerTeamIds",
      (): any => {
        const owner: DatabaseServerOwnerTeam = new DatabaseServerOwnerTeam();
        owner.teamId = TEAM_ID;
        return owner;
      },
      TEAM_ID,
    ],
  ])(
    "a %s owner",
    (
      _kind: string,
      ownerService: any,
      assignmentKind: string,
      newOwner: () => any,
      ownerId: ObjectID,
    ) => {
      let forget: jest.SpyInstance;

      beforeEach(() => {
        forget = getJestSpyOn(
          DatabaseServerService,
          "forgetAutomaticAssignments",
        ).mockResolvedValue(undefined);
        getJestSpyOn(UserService, "getUserMarkdownString").mockResolvedValue(
          "Jane Doe (jane@example.com)",
        );
        const team: Team = new Team(TEAM_ID);
        team.name = "Data Platform";
        getJestSpyOn(TeamService, "findOneById").mockResolvedValue(team);
      });

      test("added by a person counts as investment, whichever rule added it first", async () => {
        const owner: any = newOwner();
        owner.databaseServerId = DATABASE_ID;
        owner.projectId = PROJECT_ID;

        await ownerService.onCreateSuccess(
          {
            createBy: { data: owner, props: callerProps() },
            carryForward: null,
          },
          owner,
        );

        expect(forget).toHaveBeenCalledWith({
          databaseServerId: DATABASE_ID,
          kind: assignmentKind,
          ids: [ownerId],
        });
      });

      test("added by an owner rule (root) stays automatic", async () => {
        const owner: any = newOwner();
        owner.databaseServerId = DATABASE_ID;
        owner.projectId = PROJECT_ID;

        await ownerService.onCreateSuccess(
          {
            createBy: { data: owner, props: { isRoot: true } },
            carryForward: null,
          },
          owner,
        );

        expect(forget).not.toHaveBeenCalled();
      });
    },
  );
});
