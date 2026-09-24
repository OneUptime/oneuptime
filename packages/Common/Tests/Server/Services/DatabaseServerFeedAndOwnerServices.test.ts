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
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import { Blue500, Gray500, Red500 } from "../../../Types/BrandColors";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
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
