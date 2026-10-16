import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import UserMicrosoftTeamsService from "../../../Server/Services/UserMicrosoftTeamsService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserSlackService from "../../../Server/Services/UserSlackService";
import WorkspaceUserAuthTokenService, {
  LinksNotMadeBySignInCleanupResult,
  Service as WorkspaceUserAuthTokenServiceType,
} from "../../../Server/Services/WorkspaceUserAuthTokenService";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * WorkspaceUserAuthTokenService.removeLinksNotMadeBySignIn - the walk the
 * data migration RemoveChatAccountLinksNotMadeBySignIn runs once.
 *
 * A Slack or Microsoft Teams account acts as the member its link names. Only
 * the sign-ins write a link now, as OneUptime, so a link they wrote names no
 * creator; the API used to let anybody signed in write one too, and such a
 * link names the person who wrote it. Two kinds are out there:
 *
 *   - a link of the writer's own to somebody else's account (what the API
 *     allowed until today): that account's presses acted as the writer, and
 *     a Slack or Microsoft Teams notification method made then points at it;
 *   - a link naming ANOTHER member, to the writer's account (what it allowed
 *     before ownership was checked on create): the writer's presses acted as
 *     that member, and that member's own method may point at the writer.
 *
 * Every link that names a creator goes, and with it only the methods that
 * point at its account - never the member's methods for an account they
 * signed in to, which the link's delete hook would have taken (it removes all
 * of a member's methods in the project), and never a link a sign-in wrote.
 * The tables are held in memory; the deletes, their hooks and the
 * notification rules that use a method are real.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "a1000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "a1000000-0000-4000-8000-000000000002",
);

// A member who signed in to Slack and to Microsoft Teams.
const VICTIM: ObjectID = new ObjectID("b1000000-0000-4000-8000-000000000001");
// Somebody who wrote links through the API.
const WRITER: ObjectID = new ObjectID("b1000000-0000-4000-8000-000000000002");
// A member who typed in their own account and also signed in to it.
const CAREFUL: ObjectID = new ObjectID("b1000000-0000-4000-8000-000000000003");

const VICTIM_SLACK: string = "U0VICTIM";
const WRITER_SLACK: string = "U0WRITER";
const CAREFUL_SLACK: string = "U0CAREFUL";
const VICTIM_TEAMS: string = "c1000000-0000-4000-8000-000000000001";

// Link ids.
const VICTIM_SIGNED_IN_SLACK: string = "d1000000-0000-4000-8000-000000000001";
const WRITER_CLAIMS_VICTIM_SLACK: string =
  "d1000000-0000-4000-8000-000000000002";
const WRITER_PLANTED_ON_VICTIM: string = "d1000000-0000-4000-8000-000000000003";
const WRITER_CLAIMS_VICTIM_TEAMS: string =
  "d1000000-0000-4000-8000-000000000004";
const VICTIM_SIGNED_IN_TEAMS: string = "d1000000-0000-4000-8000-000000000005";
const WRITER_IN_OTHER_PROJECT: string = "d1000000-0000-4000-8000-000000000006";
const CAREFUL_TYPED_IN: string = "d1000000-0000-4000-8000-000000000007";
const CAREFUL_SIGNED_IN: string = "d1000000-0000-4000-8000-000000000008";

// Slack and Microsoft Teams notification method ids.
const VICTIM_SLACK_METHOD: string = "e1000000-0000-4000-8000-000000000001";
const WRITER_SLACK_METHOD: string = "e1000000-0000-4000-8000-000000000002";
const VICTIM_METHOD_TO_WRITER: string = "e1000000-0000-4000-8000-000000000003";
const CAREFUL_SLACK_METHOD: string = "e1000000-0000-4000-8000-000000000004";
const WRITER_TEAMS_METHOD: string = "e1000000-0000-4000-8000-000000000005";
const VICTIM_TEAMS_METHOD: string = "e1000000-0000-4000-8000-000000000006";
const VICTIM_SLACK_METHOD_ELSEWHERE: string =
  "e1000000-0000-4000-8000-000000000007";

let links: InMemoryTable;
let slackMethods: InMemoryTable;
let teamsMethods: InMemoryTable;
let rules: InMemoryTable;

function link(data: {
  id: string;
  userId: ObjectID;
  workspaceType: WorkspaceType;
  workspaceUserId: string;
  // Who wrote it through the API; none for a sign-in's.
  createdByUserId?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
}): StoredRow {
  const row: StoredRow = {
    _id: data.id,
    projectId: (data.projectId || PROJECT_ID).toString(),
    userId: data.userId.toString(),
    workspaceType: data.workspaceType,
    workspaceUserId: data.workspaceUserId,
    authToken: "",
    miscData: { userId: data.workspaceUserId },
    version: 1,
  };

  if (data.createdByUserId) {
    row["createdByUserId"] = data.createdByUserId.toString();
  }

  return row;
}

function slackMethod(data: {
  id: string;
  userId: ObjectID;
  slackUserId: string;
  projectId?: ObjectID | undefined;
}): StoredRow {
  return {
    _id: data.id,
    projectId: (data.projectId || PROJECT_ID).toString(),
    userId: data.userId.toString(),
    slackUserId: data.slackUserId,
    isVerified: true,
    version: 1,
  };
}

function teamsMethod(data: {
  id: string;
  userId: ObjectID;
  microsoftTeamsUserId: string;
}): StoredRow {
  return {
    _id: data.id,
    projectId: PROJECT_ID.toString(),
    userId: data.userId.toString(),
    microsoftTeamsUserId: data.microsoftTeamsUserId,
    isVerified: true,
    version: 1,
  };
}

// An on-call rule that pages through a method.
function rule(data: {
  id: string;
  userId: ObjectID;
  userSlackId?: string | undefined;
  userMicrosoftTeamsId?: string | undefined;
  projectId?: ObjectID | undefined;
}): StoredRow {
  const row: StoredRow = {
    _id: data.id,
    projectId: (data.projectId || PROJECT_ID).toString(),
    userId: data.userId.toString(),
    notifyAfterMinutes: 0,
    version: 1,
  };

  if (data.userSlackId) {
    row["userSlackId"] = data.userSlackId;
  }

  if (data.userMicrosoftTeamsId) {
    row["userMicrosoftTeamsId"] = data.userMicrosoftTeamsId;
  }

  return row;
}

function idsOf(table: InMemoryTable): Array<string> {
  return table.rows
    .map((row: StoredRow): string => {
      return String(row["_id"]);
    })
    .sort();
}

async function cleanUp(): Promise<LinksNotMadeBySignInCleanupResult> {
  return await WorkspaceUserAuthTokenService.removeLinksNotMadeBySignIn();
}

beforeEach(() => {
  stubProjectDirectory({});

  links = useInMemoryTable(WorkspaceUserAuthTokenService, [
    // The victim signed in to Slack and to Microsoft Teams.
    link({
      id: VICTIM_SIGNED_IN_SLACK,
      userId: VICTIM,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: VICTIM_SLACK,
    }),
    link({
      id: VICTIM_SIGNED_IN_TEAMS,
      userId: VICTIM,
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceUserId: VICTIM_TEAMS,
    }),
    // The writer's own links to the victim's accounts.
    link({
      id: WRITER_CLAIMS_VICTIM_SLACK,
      userId: WRITER,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: VICTIM_SLACK,
      createdByUserId: WRITER,
    }),
    link({
      id: WRITER_CLAIMS_VICTIM_TEAMS,
      userId: WRITER,
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceUserId: VICTIM_TEAMS,
      createdByUserId: WRITER,
    }),
    // A link naming the victim, to the writer's account.
    link({
      id: WRITER_PLANTED_ON_VICTIM,
      userId: VICTIM,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: WRITER_SLACK,
      createdByUserId: WRITER,
    }),
    // One in another project.
    link({
      id: WRITER_IN_OTHER_PROJECT,
      userId: WRITER,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: "U0SOMEBODY",
      createdByUserId: WRITER,
      projectId: OTHER_PROJECT_ID,
    }),
    // A member who typed in their own account, and also signed in to it.
    link({
      id: CAREFUL_TYPED_IN,
      userId: CAREFUL,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: CAREFUL_SLACK,
      createdByUserId: CAREFUL,
    }),
    link({
      id: CAREFUL_SIGNED_IN,
      userId: CAREFUL,
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: CAREFUL_SLACK,
    }),
  ]);

  slackMethods = useInMemoryTable(UserSlackService, [
    // Made from the victim's sign-in.
    slackMethod({
      id: VICTIM_SLACK_METHOD,
      userId: VICTIM,
      slackUserId: VICTIM_SLACK,
    }),
    // Made from the writer's link: pages the writer by DMing the victim.
    slackMethod({
      id: WRITER_SLACK_METHOD,
      userId: WRITER,
      slackUserId: VICTIM_SLACK,
    }),
    // Made while the planted link was read first: pages the victim by DMing the writer.
    slackMethod({
      id: VICTIM_METHOD_TO_WRITER,
      userId: VICTIM,
      slackUserId: WRITER_SLACK,
    }),
    slackMethod({
      id: CAREFUL_SLACK_METHOD,
      userId: CAREFUL,
      slackUserId: CAREFUL_SLACK,
    }),
    // The victim's method in another project, at the writer's account.
    slackMethod({
      id: VICTIM_SLACK_METHOD_ELSEWHERE,
      userId: VICTIM,
      slackUserId: WRITER_SLACK,
      projectId: OTHER_PROJECT_ID,
    }),
  ]);

  teamsMethods = useInMemoryTable(UserMicrosoftTeamsService, [
    teamsMethod({
      id: WRITER_TEAMS_METHOD,
      userId: WRITER,
      microsoftTeamsUserId: VICTIM_TEAMS,
    }),
    teamsMethod({
      id: VICTIM_TEAMS_METHOD,
      userId: VICTIM,
      microsoftTeamsUserId: VICTIM_TEAMS,
    }),
  ]);

  rules = useInMemoryTable(UserNotificationRuleService, [
    rule({
      id: "f1000000-0000-4000-8000-000000000001",
      userId: VICTIM,
      userSlackId: VICTIM_SLACK_METHOD,
    }),
    rule({
      id: "f1000000-0000-4000-8000-000000000002",
      userId: WRITER,
      userSlackId: WRITER_SLACK_METHOD,
    }),
    rule({
      id: "f1000000-0000-4000-8000-000000000003",
      userId: VICTIM,
      userSlackId: VICTIM_METHOD_TO_WRITER,
    }),
    rule({
      id: "f1000000-0000-4000-8000-000000000004",
      userId: CAREFUL,
      userSlackId: CAREFUL_SLACK_METHOD,
    }),
    rule({
      id: "f1000000-0000-4000-8000-000000000005",
      userId: WRITER,
      userMicrosoftTeamsId: WRITER_TEAMS_METHOD,
    }),
    rule({
      id: "f1000000-0000-4000-8000-000000000006",
      userId: VICTIM,
      userMicrosoftTeamsId: VICTIM_TEAMS_METHOD,
    }),
    rule({
      id: "f1000000-0000-4000-8000-000000000007",
      userId: VICTIM,
      userSlackId: VICTIM_SLACK_METHOD_ELSEWHERE,
      projectId: OTHER_PROJECT_ID,
    }),
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("removeLinksNotMadeBySignIn", () => {
  test("removes every link a person wrote, and keeps every link a sign-in wrote", async () => {
    const result: LinksNotMadeBySignInCleanupResult = await cleanUp();

    expect(idsOf(links)).toEqual(
      [
        VICTIM_SIGNED_IN_SLACK,
        VICTIM_SIGNED_IN_TEAMS,
        CAREFUL_SIGNED_IN,
      ].sort(),
    );
    expect(result.removedLinkCount).toBe(5);
    expect(result.failedLinkCount).toBe(0);
  });

  test("the account the writer claimed stops acting as the writer, and is the victim's again", async () => {
    await cleanUp();

    const remaining: Array<StoredRow> = links.rows.filter(
      (row: StoredRow): boolean => {
        return row["workspaceUserId"] === VICTIM_SLACK;
      },
    );

    expect(remaining).toHaveLength(1);
    expect(String(remaining[0]!["userId"])).toBe(VICTIM.toString());
  });

  test("the methods made from a removed link go, with the rules that page through them", async () => {
    const result: LinksNotMadeBySignInCleanupResult = await cleanUp();

    // The writer's method at the victim's account, and the victim's at the writer's.
    expect(slackMethods.get(WRITER_SLACK_METHOD)).toBeUndefined();
    expect(slackMethods.get(VICTIM_METHOD_TO_WRITER)).toBeUndefined();
    expect(teamsMethods.get(WRITER_TEAMS_METHOD)).toBeUndefined();

    expect(rules.get("f1000000-0000-4000-8000-000000000002")).toBeUndefined();
    expect(rules.get("f1000000-0000-4000-8000-000000000003")).toBeUndefined();
    expect(rules.get("f1000000-0000-4000-8000-000000000005")).toBeUndefined();

    expect(result.removedSlackMethodCount).toBe(2);
    expect(result.removedMicrosoftTeamsMethodCount).toBe(1);
  });

  test("a member's methods for the account they signed in to stay - although a link naming them was removed", async () => {
    await cleanUp();

    /*
     * The link planted on the victim went; its delete hook would have taken
     * every Slack method of the victim's in the project, this one included.
     */
    expect(slackMethods.get(VICTIM_SLACK_METHOD)).toBeDefined();
    expect(teamsMethods.get(VICTIM_TEAMS_METHOD)).toBeDefined();
    expect(rules.get("f1000000-0000-4000-8000-000000000001")).toBeDefined();
    expect(rules.get("f1000000-0000-4000-8000-000000000006")).toBeDefined();
  });

  test("a typed-in link goes, but the method stays when a sign-in connected the same account", async () => {
    await cleanUp();

    expect(links.get(CAREFUL_TYPED_IN)).toBeUndefined();
    expect(links.get(CAREFUL_SIGNED_IN)).toBeDefined();
    expect(slackMethods.get(CAREFUL_SLACK_METHOD)).toBeDefined();
    expect(rules.get("f1000000-0000-4000-8000-000000000004")).toBeDefined();
  });

  test("methods in other projects are not touched", async () => {
    await cleanUp();

    // The link removed in the other project names an account nobody's method points at.
    expect(links.get(WRITER_IN_OTHER_PROJECT)).toBeUndefined();
    expect(slackMethods.get(VICTIM_SLACK_METHOD_ELSEWHERE)).toBeDefined();
    expect(rules.get("f1000000-0000-4000-8000-000000000007")).toBeDefined();
  });

  test("running it again removes nothing more", async () => {
    await cleanUp();

    const linksAfterFirst: Array<string> = idsOf(links);
    const slackAfterFirst: Array<string> = idsOf(slackMethods);
    const teamsAfterFirst: Array<string> = idsOf(teamsMethods);
    const rulesAfterFirst: Array<string> = idsOf(rules);

    const again: LinksNotMadeBySignInCleanupResult = await cleanUp();

    expect(again).toEqual({
      removedLinkCount: 0,
      removedSlackMethodCount: 0,
      removedMicrosoftTeamsMethodCount: 0,
      failedLinkCount: 0,
    });
    expect(idsOf(links)).toEqual(linksAfterFirst);
    expect(idsOf(slackMethods)).toEqual(slackAfterFirst);
    expect(idsOf(teamsMethods)).toEqual(teamsAfterFirst);
    expect(idsOf(rules)).toEqual(rulesAfterFirst);
  });

  test("a table with only sign-ins' links is left as it is", async () => {
    links.rows = links.rows.filter((row: StoredRow): boolean => {
      return !row["createdByUserId"];
    });

    const before: Array<string> = idsOf(links);

    const result: LinksNotMadeBySignInCleanupResult = await cleanUp();

    expect(result.removedLinkCount).toBe(0);
    expect(idsOf(links)).toEqual(before);
    expect(slackMethods.rows).toHaveLength(5);
    expect(teamsMethods.rows).toHaveLength(2);
  });

  test("reads the links a batch at a time until none is left", async () => {
    const batch: number = WorkspaceUserAuthTokenServiceType.CLEANUP_BATCH_SIZE;
    const count: number = batch * 2 + 7;

    for (let index: number = 0; index < count; index++) {
      links.rows.push(
        link({
          id: ObjectID.generate().toString(),
          userId: WRITER,
          workspaceType: WorkspaceType.Slack,
          workspaceUserId: `U0TYPED${index}`,
          createdByUserId: WRITER,
        }),
      );
    }

    const result: LinksNotMadeBySignInCleanupResult = await cleanUp();

    expect(result.removedLinkCount).toBe(count + 5);
    expect(
      links.rows.filter((row: StoredRow): boolean => {
        return Boolean(row["createdByUserId"]);
      }),
    ).toHaveLength(0);
  });

  test("a link that cannot be removed is logged and counted, the rest still go, and the walk ends", async () => {
    const errors: Array<unknown> = [];

    jest.spyOn(logger, "error").mockImplementation((message: unknown) => {
      errors.push(message);
    });

    const realDeleteBy: typeof WorkspaceUserAuthTokenService.deleteBy =
      WorkspaceUserAuthTokenService.deleteBy.bind(
        WorkspaceUserAuthTokenService,
      );

    const failingDelete: ReturnType<typeof jest.spyOn> = jest
      .spyOn(WorkspaceUserAuthTokenService, "deleteBy")
      .mockImplementation(
        async (
          deleteBy: Parameters<
            typeof WorkspaceUserAuthTokenService.deleteBy
          >[0],
        ): Promise<number> => {
          if (
            String((deleteBy.query as StoredRow)["_id"]) ===
            WRITER_CLAIMS_VICTIM_SLACK
          ) {
            throw new Error("the database went away for a moment");
          }

          return await realDeleteBy(deleteBy);
        },
      );

    const result: LinksNotMadeBySignInCleanupResult = await cleanUp();

    expect(result.failedLinkCount).toBe(1);
    expect(result.removedLinkCount).toBe(4);
    // The one that failed is still there for the next run.
    expect(links.get(WRITER_CLAIMS_VICTIM_SLACK)).toBeDefined();
    expect(links.get(WRITER_PLANTED_ON_VICTIM)).toBeUndefined();
    expect(
      errors.some((message: unknown): boolean => {
        return String(message).includes(WRITER_CLAIMS_VICTIM_SLACK);
      }),
    ).toBe(true);

    // The next run, the database back, removes it.
    failingDelete.mockRestore();

    const next: LinksNotMadeBySignInCleanupResult = await cleanUp();

    expect(next.removedLinkCount).toBe(1);
    expect(links.get(WRITER_CLAIMS_VICTIM_SLACK)).toBeUndefined();
    expect(slackMethods.get(WRITER_SLACK_METHOD)).toBeUndefined();
  });

  test("a delete that removes nothing while the link is still there is a failure, and the walk still ends", async () => {
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });

    const realDeleteBy: typeof WorkspaceUserAuthTokenService.deleteBy =
      WorkspaceUserAuthTokenService.deleteBy.bind(
        WorkspaceUserAuthTokenService,
      );

    jest
      .spyOn(WorkspaceUserAuthTokenService, "deleteBy")
      .mockImplementation(
        async (
          deleteBy: Parameters<
            typeof WorkspaceUserAuthTokenService.deleteBy
          >[0],
        ): Promise<number> => {
          // This one is never removed, however often it is asked for.
          if (
            String((deleteBy.query as StoredRow)["_id"]) ===
            WRITER_PLANTED_ON_VICTIM
          ) {
            return 0;
          }

          return await realDeleteBy(deleteBy);
        },
      );

    const result: LinksNotMadeBySignInCleanupResult = await cleanUp();

    expect(result.failedLinkCount).toBe(1);
    expect(result.removedLinkCount).toBe(4);
    expect(links.get(WRITER_PLANTED_ON_VICTIM)).toBeDefined();
    // Not removed, so not taken for removed: the methods made from it stay for the next run.
    expect(slackMethods.get(VICTIM_METHOD_TO_WRITER)).toBeDefined();
  });

  test("a link another run removed first is not a failure, and its methods still go", async () => {
    const realDeleteBy: typeof WorkspaceUserAuthTokenService.deleteBy =
      WorkspaceUserAuthTokenService.deleteBy.bind(
        WorkspaceUserAuthTokenService,
      );

    jest
      .spyOn(WorkspaceUserAuthTokenService, "deleteBy")
      .mockImplementation(
        async (
          deleteBy: Parameters<
            typeof WorkspaceUserAuthTokenService.deleteBy
          >[0],
        ): Promise<number> => {
          if (
            String((deleteBy.query as StoredRow)["_id"]) ===
            WRITER_CLAIMS_VICTIM_SLACK
          ) {
            // The other run got there first.
            links.rows = links.rows.filter((row: StoredRow): boolean => {
              return String(row["_id"]) !== WRITER_CLAIMS_VICTIM_SLACK;
            });
            return 0;
          }

          return await realDeleteBy(deleteBy);
        },
      );

    const result: LinksNotMadeBySignInCleanupResult = await cleanUp();

    expect(result.failedLinkCount).toBe(0);
    expect(links.get(WRITER_CLAIMS_VICTIM_SLACK)).toBeUndefined();
    expect(slackMethods.get(WRITER_SLACK_METHOD)).toBeUndefined();
  });

  test("a failure to read the links at all is not swallowed", async () => {
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findBy")
      .mockRejectedValue(new Error("db down") as never);

    await expect(cleanUp()).rejects.toThrow("db down");
  });

  test("each link goes without the delete hook, so the blanket method removal never runs", async () => {
    const hook: ReturnType<typeof jest.spyOn> = jest.spyOn(
      WorkspaceUserAuthTokenService as unknown as {
        onBeforeDelete: (...args: Array<unknown>) => Promise<unknown>;
      },
      "onBeforeDelete",
    );

    await cleanUp();

    expect(hook).not.toHaveBeenCalled();
  });
});
