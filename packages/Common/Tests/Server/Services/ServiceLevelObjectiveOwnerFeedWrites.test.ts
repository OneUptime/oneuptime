/*
 * `jest` is the global (as in ServiceLevelObjectiveService.test.ts), not the
 * @jest/globals export: that export's SpiedFunction type does not accept what
 * jest.spyOn returns with this repo's jest-mock version.
 */
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

import { ServiceLevelObjectiveFeedEventType } from "../../../Models/DatabaseModels/ServiceLevelObjectiveFeed";
import ServiceLevelObjectiveOwnerTeam from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import ServiceLevelObjectiveFeedService from "../../../Server/Services/ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveOwnerTeamService from "../../../Server/Services/ServiceLevelObjectiveOwnerTeamService";
import ServiceLevelObjectiveOwnerUserService from "../../../Server/Services/ServiceLevelObjectiveOwnerUserService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import URL from "../../../Types/API/URL";
import { Gray500, Red500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";

/*
 * Owners are who gets paged when an SLO goes at risk, so "who was put on the
 * hook, who was taken off, and by whom" is part of the SLO's history. These
 * are the ServiceOwnerUser/TeamService hooks, cloned for SLOs, with the
 * differences pinned hardest here: every user and team name is escaped (the
 * feed renders without safe mode), a feed failure never fails the owner
 * change it describes - the row was already written or deleted - and only a
 * row the delete REALLY removed is described.
 *
 * The delete pair is the easy one to get wrong both ways. The rows are gone by
 * the time onDeleteSuccess runs, so they have to be carried forward from
 * onBeforeDelete or the removal is silently never recorded. But onBeforeDelete
 * runs before DatabaseService applies permissions, so what it read is only a
 * candidate list: a delete naming another project's owner row deletes nothing,
 * and must not post "removed" onto that project's SLO feed in the caller's
 * name.
 */

const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const TEAM_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const ACTING_USER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
// The owner join rows themselves - what a delete actually removes.
const OWNER_USER_ROW_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const OWNER_TEAM_ROW_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const OTHER_OWNER_TEAM_ROW_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

const SLO_MARKDOWN_LINK: string =
  "[SLO Checkout](https://oneuptime.test/dashboard/p/slos/s)";
const USER_LINK: string = "https://oneuptime.test/dashboard/p/users/u";

interface FeedCall {
  serviceLevelObjectiveId: ObjectID;
  projectId: ObjectID;
  serviceLevelObjectiveFeedEventType: ServiceLevelObjectiveFeedEventType;
  feedInfoInMarkdown: string;
  displayColor?: Color | undefined;
  userId?: ObjectID | undefined;
}

interface FindByArgs {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  props: Record<string, unknown>;
}

let feedCalls: Array<FeedCall> = [];
let sloLinkSpy: jest.SpyInstance;

// Calls a protected hook without widening the service's public surface.
function callHook(
  service: unknown,
  name: string,
  ...args: Array<unknown>
): Promise<unknown> {
  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = service as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return hooks[name]!.apply(service, args);
}

function makeUser(fields: { name?: string; email?: string }): User {
  const user: User = new User(USER_ID);

  if (fields.name !== undefined) {
    user.name = new Name(fields.name);
  }

  if (fields.email !== undefined) {
    user.email = new Email(fields.email);
  }

  return user;
}

function ownerUser(): ServiceLevelObjectiveOwnerUser {
  const row: ServiceLevelObjectiveOwnerUser =
    new ServiceLevelObjectiveOwnerUser(OWNER_USER_ROW_ID);
  row.serviceLevelObjectiveId = SLO_ID;
  row.projectId = PROJECT_ID;
  row.userId = USER_ID;
  return row;
}

function ownerTeam(
  id: ObjectID = OWNER_TEAM_ROW_ID,
): ServiceLevelObjectiveOwnerTeam {
  const row: ServiceLevelObjectiveOwnerTeam =
    new ServiceLevelObjectiveOwnerTeam(id);
  row.serviceLevelObjectiveId = SLO_ID;
  row.projectId = PROJECT_ID;
  row.teamId = TEAM_ID;
  return row;
}

function makeTeam(name: string): Team {
  const team: Team = new Team(TEAM_ID);
  team.name = name;
  return team;
}

beforeEach(() => {
  feedCalls = [];

  jest
    .spyOn(
      ServiceLevelObjectiveFeedService,
      "createServiceLevelObjectiveFeedItem",
    )
    .mockImplementation((data: FeedCall): Promise<void> => {
      feedCalls.push(data);
      return Promise.resolve();
    });

  sloLinkSpy = jest
    .spyOn(ServiceLevelObjectiveService, "getSloMarkdownLink")
    .mockResolvedValue(SLO_MARKDOWN_LINK);

  jest
    .spyOn(UserService, "getUserLinkInDashboard")
    .mockResolvedValue(URL.fromString(USER_LINK));

  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ServiceLevelObjectiveOwnerUserService feed writes", () => {
  test("records the owner and who added them", async () => {
    jest
      .spyOn(UserService, "findOneById")
      .mockResolvedValue(
        makeUser({ name: "Jane Doe", email: "jane@example.com" }),
      );

    await ServiceLevelObjectiveOwnerUserService.onCreateSuccess(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { createBy: { props: { userId: ACTING_USER_ID } } } as any,
      ownerUser(),
    );

    expect(feedCalls).toHaveLength(1);
    expect(feedCalls[0]!.serviceLevelObjectiveFeedEventType).toBe(
      ServiceLevelObjectiveFeedEventType.OwnerUserAdded,
    );
    expect(feedCalls[0]!.serviceLevelObjectiveId).toBe(SLO_ID);
    expect(feedCalls[0]!.projectId).toBe(PROJECT_ID);
    expect(feedCalls[0]!.displayColor).toBe(Gray500);
    expect(feedCalls[0]!.feedInfoInMarkdown).toBe(
      `👨🏻‍💻 Added **[Jane Doe](${USER_LINK})** as an owner of ${SLO_MARKDOWN_LINK}.`,
    );
    // Who did the adding, not who was added.
    expect(feedCalls[0]!.userId).toBe(ACTING_USER_ID);
    expect(sloLinkSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      sloId: SLO_ID,
    });
  });

  test("prefers the row's own createdByUserId over the request's", async () => {
    jest
      .spyOn(UserService, "findOneById")
      .mockResolvedValue(makeUser({ name: "Jane Doe" }));

    const row: ServiceLevelObjectiveOwnerUser = ownerUser();
    row.createdByUserId = USER_ID;

    await ServiceLevelObjectiveOwnerUserService.onCreateSuccess(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { createBy: { props: { userId: ACTING_USER_ID } } } as any,
      row,
    );

    expect(feedCalls[0]!.userId).toBe(USER_ID);
  });

  test("an owner's name cannot re-point a link or add an image", async () => {
    jest.spyOn(UserService, "findOneById").mockResolvedValue(
      makeUser({
        name: "x](https://evil.example) ![p](https://t.example/p)",
      }),
    );

    await ServiceLevelObjectiveOwnerUserService.onCreateSuccess(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { createBy: { props: {} } } as any,
      ownerUser(),
    );

    expect(feedCalls[0]!.feedInfoInMarkdown).toBe(
      `👨🏻‍💻 Added **[x\\]\\(https://evil.example\\) \\!\\[p\\]\\(https://t.example/p\\)](${USER_LINK})** as an owner of ${SLO_MARKDOWN_LINK}.`,
    );
  });

  test("writes nothing, and looks nothing up, when the row is missing its SLO or user", async () => {
    const findSpy: jest.SpyInstance = jest.spyOn(UserService, "findOneById");

    const row: ServiceLevelObjectiveOwnerUser =
      new ServiceLevelObjectiveOwnerUser();
    row.projectId = PROJECT_ID;

    await ServiceLevelObjectiveOwnerUserService.onCreateSuccess(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { createBy: { props: {} } } as any,
      row,
    );

    expect(feedCalls).toHaveLength(0);
    expect(findSpy).not.toHaveBeenCalled();
  });

  test("an owner whose user row is gone is not described as a blank name", async () => {
    jest.spyOn(UserService, "findOneById").mockResolvedValue(null);

    await ServiceLevelObjectiveOwnerUserService.onCreateSuccess(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { createBy: { props: {} } } as any,
      ownerUser(),
    );

    expect(feedCalls).toHaveLength(0);
  });

  test("a failing lookup is logged and never fails the owner that was already added", async () => {
    jest
      .spyOn(UserService, "findOneById")
      .mockResolvedValue(makeUser({ name: "Jane Doe" }));
    sloLinkSpy.mockRejectedValue(new Error("dashboard url unavailable"));

    const row: ServiceLevelObjectiveOwnerUser = ownerUser();

    await expect(
      ServiceLevelObjectiveOwnerUserService.onCreateSuccess(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { createBy: { props: {} } } as any,
        row,
      ),
    ).resolves.toBe(row);

    expect(feedCalls).toHaveLength(0);
    expect(logger.error).toHaveBeenCalled();
  });

  test("carries the deleted row forward so the removal can be described", async () => {
    const doomed: ServiceLevelObjectiveOwnerUser = ownerUser();

    const findBySpy: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveOwnerUserService, "findBy")
      .mockResolvedValue([doomed]);

    jest
      .spyOn(UserService, "findOneById")
      .mockResolvedValue(
        makeUser({ name: "Jane Doe", email: "jane@example.com" }),
      );

    const onDelete: {
      deleteBy: unknown;
      carryForward: { itemsToDelete: Array<ServiceLevelObjectiveOwnerUser> };
    } = (await callHook(
      ServiceLevelObjectiveOwnerUserService,
      "onBeforeDelete",
      {
        query: { _id: OWNER_USER_ROW_ID.toString() },
        limit: 1,
        skip: 0,
        props: { userId: ACTING_USER_ID, tenantId: PROJECT_ID },
      },
    )) as {
      deleteBy: unknown;
      carryForward: { itemsToDelete: Array<ServiceLevelObjectiveOwnerUser> };
    };

    expect(onDelete.carryForward.itemsToDelete).toEqual([doomed]);

    /*
     * Read as root through the caller's own query - pinned to the caller's
     * project, since permissions are applied only after this hook - selecting
     * the row id (matched against what the delete removed) and the SLO column.
     */
    const findByArgs: FindByArgs = findBySpy.mock.calls[0]![0] as FindByArgs;

    expect(findByArgs.query).toEqual({
      _id: OWNER_USER_ROW_ID.toString(),
      projectId: PROJECT_ID,
    });
    expect(findByArgs.props).toEqual({ isRoot: true });
    expect(findByArgs.select).toEqual({
      _id: true,
      serviceLevelObjectiveId: true,
      projectId: true,
      userId: true,
    });

    await callHook(
      ServiceLevelObjectiveOwnerUserService,
      "onDeleteSuccess",
      onDelete,
      [OWNER_USER_ROW_ID],
    );

    expect(feedCalls).toHaveLength(1);
    expect(feedCalls[0]!.serviceLevelObjectiveFeedEventType).toBe(
      ServiceLevelObjectiveFeedEventType.OwnerUserRemoved,
    );
    expect(feedCalls[0]!.displayColor).toBe(Red500);
    expect(feedCalls[0]!.feedInfoInMarkdown).toBe(
      `👨🏻‍💻 Removed **Jane Doe** (jane@example.com) as an owner of ${SLO_MARKDOWN_LINK}.`,
    );
    expect(feedCalls[0]!.userId).toBe(ACTING_USER_ID);
  });

  test("a delete that removed nothing - one naming another project's owner row - describes nothing and looks nothing up", async () => {
    const findUserSpy: jest.SpyInstance = jest
      .spyOn(UserService, "findOneById")
      .mockResolvedValue(makeUser({ name: "Jane Doe" }));

    /*
     * onBeforeDelete saw the row, but the permission-checked delete matched
     * nothing, so DatabaseService reports no deleted ids.
     */
    await callHook(
      ServiceLevelObjectiveOwnerUserService,
      "onDeleteSuccess",
      {
        deleteBy: { props: { userId: ACTING_USER_ID } },
        carryForward: { itemsToDelete: [ownerUser()] },
      },
      [],
    );

    expect(feedCalls).toHaveLength(0);
    expect(findUserSpy).not.toHaveBeenCalled();
  });

  test("prefers the recorded deleting user over the request's", async () => {
    jest
      .spyOn(UserService, "findOneById")
      .mockResolvedValue(makeUser({ name: "Jane Doe" }));

    await callHook(
      ServiceLevelObjectiveOwnerUserService,
      "onDeleteSuccess",
      {
        deleteBy: {
          deletedByUser: new User(USER_ID),
          props: { userId: ACTING_USER_ID },
        },
        carryForward: { itemsToDelete: [ownerUser()] },
      },
      [OWNER_USER_ROW_ID],
    );

    // The recorded user's id is read back through the model, so compare values.
    expect(feedCalls[0]!.userId?.toString()).toBe(USER_ID.toString());
  });

  test("a removed owner with no name is named by email once, not twice", async () => {
    jest
      .spyOn(UserService, "findOneById")
      .mockResolvedValue(makeUser({ email: "ops@example.com" }));

    await callHook(
      ServiceLevelObjectiveOwnerUserService,
      "onDeleteSuccess",
      {
        deleteBy: { props: {} },
        carryForward: { itemsToDelete: [ownerUser()] },
      },
      [OWNER_USER_ROW_ID],
    );

    expect(feedCalls[0]!.feedInfoInMarkdown).toBe(
      `👨🏻‍💻 Removed **ops@example.com** as an owner of ${SLO_MARKDOWN_LINK}.`,
    );
  });

  test("a removed owner's hostile name and email are escaped", async () => {
    jest
      .spyOn(UserService, "findOneById")
      .mockResolvedValue(
        makeUser({ name: "**Jane** [x](y)", email: "jane_doe@example.com" }),
      );

    await callHook(
      ServiceLevelObjectiveOwnerUserService,
      "onDeleteSuccess",
      {
        deleteBy: { props: {} },
        carryForward: { itemsToDelete: [ownerUser()] },
      },
      [OWNER_USER_ROW_ID],
    );

    expect(feedCalls[0]!.feedInfoInMarkdown).toBe(
      `👨🏻‍💻 Removed **\\*\\*Jane\\*\\* \\[x\\]\\(y\\)** (jane\\_doe@example.com) as an owner of ${SLO_MARKDOWN_LINK}.`,
    );
  });

  test("a failed read before delete never blocks the delete", async () => {
    jest
      .spyOn(ServiceLevelObjectiveOwnerUserService, "findBy")
      .mockRejectedValue(new Error("replica lag"));

    const onDelete: { carryForward: { itemsToDelete: Array<unknown> } } =
      (await callHook(ServiceLevelObjectiveOwnerUserService, "onBeforeDelete", {
        query: {},
        limit: 1,
        skip: 0,
        props: {},
      })) as { carryForward: { itemsToDelete: Array<unknown> } };

    expect(onDelete.carryForward.itemsToDelete).toEqual([]);

    await expect(
      callHook(
        ServiceLevelObjectiveOwnerUserService,
        "onDeleteSuccess",
        onDelete,
        [OWNER_USER_ROW_ID],
      ),
    ).resolves.toBeDefined();
    expect(feedCalls).toHaveLength(0);
  });
});

describe("ServiceLevelObjectiveOwnerTeamService feed writes", () => {
  test("records the team that was added, and by whom", async () => {
    jest
      .spyOn(TeamService, "findOneById")
      .mockResolvedValue(makeTeam("Platform"));

    await ServiceLevelObjectiveOwnerTeamService.onCreateSuccess(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { createBy: { props: { userId: ACTING_USER_ID } } } as any,
      ownerTeam(),
    );

    expect(feedCalls).toHaveLength(1);
    expect(feedCalls[0]!.serviceLevelObjectiveFeedEventType).toBe(
      ServiceLevelObjectiveFeedEventType.OwnerTeamAdded,
    );
    expect(feedCalls[0]!.displayColor).toBe(Gray500);
    expect(feedCalls[0]!.feedInfoInMarkdown).toBe(
      `👨🏻‍👩🏻‍👦🏻 Added team **Platform** as an owner of ${SLO_MARKDOWN_LINK}.`,
    );
    expect(feedCalls[0]!.userId).toBe(ACTING_USER_ID);
  });

  test("records the team that was removed", async () => {
    jest
      .spyOn(TeamService, "findOneById")
      .mockResolvedValue(makeTeam("Platform"));

    await callHook(
      ServiceLevelObjectiveOwnerTeamService,
      "onDeleteSuccess",
      {
        deleteBy: { props: { userId: ACTING_USER_ID } },
        carryForward: { itemsToDelete: [ownerTeam()] },
      },
      [OWNER_TEAM_ROW_ID],
    );

    expect(feedCalls).toHaveLength(1);
    expect(feedCalls[0]!.serviceLevelObjectiveFeedEventType).toBe(
      ServiceLevelObjectiveFeedEventType.OwnerTeamRemoved,
    );
    expect(feedCalls[0]!.displayColor).toBe(Red500);
    expect(feedCalls[0]!.feedInfoInMarkdown).toBe(
      `👨🏻‍👩🏻‍👦🏻 Removed team **Platform** as an owner of ${SLO_MARKDOWN_LINK}.`,
    );
    expect(feedCalls[0]!.userId).toBe(ACTING_USER_ID);
  });

  test("a team name cannot break out of its bold", async () => {
    jest
      .spyOn(TeamService, "findOneById")
      .mockResolvedValue(makeTeam("SRE** [phish](https://evil.example)"));

    await ServiceLevelObjectiveOwnerTeamService.onCreateSuccess(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { createBy: { props: {} } } as any,
      ownerTeam(),
    );

    expect(feedCalls[0]!.feedInfoInMarkdown).toBe(
      `👨🏻‍👩🏻‍👦🏻 Added team **SRE\\*\\* \\[phish\\]\\(https://evil.example\\)** as an owner of ${SLO_MARKDOWN_LINK}.`,
    );
  });

  test.each([
    ["is gone", null],
    ["has no name", makeTeam("")],
  ])(
    "a team that %s posts nothing",
    async (_label: string, team: Team | null) => {
      jest.spyOn(TeamService, "findOneById").mockResolvedValue(team);

      await ServiceLevelObjectiveOwnerTeamService.onCreateSuccess(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { createBy: { props: {} } } as any,
        ownerTeam(),
      );

      await callHook(
        ServiceLevelObjectiveOwnerTeamService,
        "onDeleteSuccess",
        {
          deleteBy: { props: {} },
          carryForward: { itemsToDelete: [ownerTeam()] },
        },
        [OWNER_TEAM_ROW_ID],
      );

      expect(feedCalls).toHaveLength(0);
    },
  );

  test("carries the deleted team row forward, reading the SLO column", async () => {
    const doomed: ServiceLevelObjectiveOwnerTeam = ownerTeam();

    const findBySpy: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveOwnerTeamService, "findBy")
      .mockResolvedValue([doomed]);

    const onDelete: { carryForward: { itemsToDelete: Array<unknown> } } =
      (await callHook(ServiceLevelObjectiveOwnerTeamService, "onBeforeDelete", {
        query: { _id: OWNER_TEAM_ROW_ID.toString() },
        limit: 1,
        skip: 0,
        props: { tenantId: PROJECT_ID },
      })) as { carryForward: { itemsToDelete: Array<unknown> } };

    expect(onDelete.carryForward.itemsToDelete).toEqual([doomed]);

    const findByArgs: FindByArgs = findBySpy.mock.calls[0]![0] as FindByArgs;

    expect(findByArgs.query).toEqual({
      _id: OWNER_TEAM_ROW_ID.toString(),
      projectId: PROJECT_ID,
    });
    expect(findByArgs.select).toEqual({
      _id: true,
      serviceLevelObjectiveId: true,
      projectId: true,
      teamId: true,
    });
  });

  test("without a tenant - a root automation - the delete read uses the query as it came", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveOwnerTeamService, "findBy")
      .mockResolvedValue([]);

    await callHook(ServiceLevelObjectiveOwnerTeamService, "onBeforeDelete", {
      query: { serviceLevelObjectiveId: SLO_ID },
      limit: 10,
      skip: 0,
      props: { isRoot: true },
    });

    expect((findBySpy.mock.calls[0]![0] as FindByArgs).query).toEqual({
      serviceLevelObjectiveId: SLO_ID,
    });
  });

  test("only the team rows the delete really removed are described", async () => {
    jest
      .spyOn(TeamService, "findOneById")
      .mockResolvedValue(makeTeam("Platform"));

    await callHook(
      ServiceLevelObjectiveOwnerTeamService,
      "onDeleteSuccess",
      {
        deleteBy: { props: { userId: ACTING_USER_ID } },
        carryForward: {
          itemsToDelete: [ownerTeam(), ownerTeam(OTHER_OWNER_TEAM_ROW_ID)],
        },
      },
      [OTHER_OWNER_TEAM_ROW_ID],
    );

    expect(feedCalls).toHaveLength(1);
    expect(TeamService.findOneById).toHaveBeenCalledTimes(1);
  });

  test("one team failing to describe does not cost the next one its item", async () => {
    jest
      .spyOn(TeamService, "findOneById")
      .mockRejectedValueOnce(new Error("team read failed"))
      .mockResolvedValueOnce(makeTeam("Platform"));

    await callHook(
      ServiceLevelObjectiveOwnerTeamService,
      "onDeleteSuccess",
      {
        deleteBy: { props: {} },
        carryForward: {
          itemsToDelete: [ownerTeam(), ownerTeam(OTHER_OWNER_TEAM_ROW_ID)],
        },
      },
      [OWNER_TEAM_ROW_ID, OTHER_OWNER_TEAM_ROW_ID],
    );

    expect(feedCalls).toHaveLength(1);
    expect(logger.error).toHaveBeenCalled();
  });
});
