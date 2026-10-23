import Project from "../../../../Models/DatabaseModels/Project";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsInstalledTeam,
} from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import ProjectService from "../../../../Server/Services/ProjectService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import UserService from "../../../../Server/Services/UserService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../Server/Services/WorkspaceUserAuthTokenService";
import MicrosoftTeamsUtil, {
  MicrosoftTeamsRosterMember,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import SlackChannelMembers, {
  SlackChannelMembersError,
  SlackPersonFacts,
} from "../../../../Server/Utils/Workspace/Slack/SlackChannelMembers";
import WorkspaceAskToConnect, {
  SLACK_BUSY_WAIT_MS,
  SLACK_LOOKUP_ONE_BY_ONE_MAX,
  WORKSPACE_ASK_TO_CONNECT_ALREADY_ASKING_MESSAGE,
  WorkspaceAskToConnectMessage,
} from "../../../../Server/Utils/Workspace/WorkspaceAskToConnect";
import WorkspaceHome from "../../../../Server/Utils/Workspace/WorkspaceHome";
import URL from "../../../../Types/API/URL";
import Email from "../../../../Types/Email";
import { JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import Sleep from "../../../../Types/Sleep";
import {
  WorkspaceAskToConnectRun,
  WorkspaceAskToConnectState,
  WorkspaceAskToConnectStatus,
} from "../../../../Types/Workspace/WorkspaceAskToConnect";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadButtons,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../../Server/Utils/Logger");

/*
 * ASKING A THOUSAND PEOPLE TO CONNECT THEIR CHAT ACCOUNT, AT ONCE.
 *
 * A customer bringing a thousand people into OneUptime asked how to get
 * them all to connect Slack. Only a person's own sign-in connects their
 * account, so an admin asks them all instead: every member who has not
 * connected, and was not asked in the last day, is found in the workspace
 * by their email address and gets a direct message with a Connect button.
 *
 * Driven through WorkspaceAskToConnect with the database reads, the cache
 * (in memory) and the chats' calls stubbed; the run that goes on after the
 * answer is awaited through its spy.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "f1000000-0000-4000-8000-000000000001",
);
const ADMIN: ObjectID = new ObjectID("f1000000-0000-4000-8000-000000000002");
const ALICE: ObjectID = new ObjectID("f1000000-0000-4000-8000-000000000003");
const BOB: ObjectID = new ObjectID("f1000000-0000-4000-8000-000000000004");
const CAROL: ObjectID = new ObjectID("f1000000-0000-4000-8000-000000000005");
const LEFT: ObjectID = new ObjectID("f1000000-0000-4000-8000-000000000006");

interface FakePerson {
  id: ObjectID;
  name: string;
  email: string;
}

let people: Array<FakePerson>;
let memberIds: Array<ObjectID>;
let linkedIds: Array<ObjectID>;
let projectAuth: WorkspaceProjectAuthToken | null;
let cache: Map<string, string>;
let slackPeople: Array<SlackPersonFacts>;

let lookupSpy: SpyInstance<typeof SlackChannelMembers.findPersonByEmail>;
let pageSpy: SpyInstance<typeof SlackChannelMembers.getPeoplePage>;
let slackDmSpy: SpyInstance<typeof SlackUtil.sendDirectMessageToUser>;
let teamsDmSpy: SpyInstance<
  typeof MicrosoftTeamsUtil.sendDirectMessageToUserAsBot
>;
let rosterSpy: SpyInstance<typeof MicrosoftTeamsUtil.getTeamRoster>;
let sleepSpy: SpyInstance<typeof Sleep.sleep>;
let askSpy: SpyInstance<typeof WorkspaceAskToConnect.ask>;

function slackPerson(
  id: string,
  email: string,
  facts: Partial<SlackPersonFacts> = {},
): SlackPersonFacts {
  return {
    id: id,
    name: id,
    email: email,
    isBot: false,
    isDeactivated: false,
    isGuest: false,
    ...facts,
  };
}

function user(person: FakePerson): User {
  const model: User = new User();
  model.id = person.id;
  model.name = new Name(person.name);
  model.email = new Email(person.email);
  return model;
}

function cacheKey(namespace: string, key: string): string {
  return `${namespace}-${key}`;
}

beforeEach(() => {
  people = [
    { id: ADMIN, name: "Jane Admin", email: "jane@example.com" },
    { id: ALICE, name: "Alice", email: "alice@example.com" },
    { id: BOB, name: "Bob", email: "Bob@Example.com" },
    { id: CAROL, name: "Carol", email: "carol@example.com" },
  ];
  memberIds = [ADMIN, ALICE, BOB, CAROL];
  linkedIds = [ADMIN];
  cache = new Map<string, string>();
  projectAuth = {
    authToken: "xoxb-project",
    projectId: PROJECT_ID,
  } as unknown as WorkspaceProjectAuthToken;
  slackPeople = [
    slackPerson("U0ALICE", "alice@example.com"),
    slackPerson("U0BOB", "bob@example.com"),
  ];

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockImplementation(async () => {
      return projectAuth;
    });

  jest.spyOn(TeamMemberService, "findBy").mockImplementation((async () => {
    // A member of two teams is one member.
    return [...memberIds, memberIds[0]!].map((id: ObjectID): TeamMember => {
      const member: TeamMember = new TeamMember();
      member.userId = id;
      member.hasAcceptedInvitation = true;
      return member;
    });
  }) as never);

  jest
    .spyOn(WorkspaceUserAuthTokenService, "findBy")
    .mockImplementation((async () => {
      return linkedIds.map((id: ObjectID): WorkspaceUserAuthToken => {
        const link: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
        link.userId = id;
        return link;
      });
    }) as never);

  jest.spyOn(UserService, "findBy").mockImplementation((async (data: {
    query: { _id: { value: Array<string> } };
  }) => {
    const asked: Array<string> = JSON.stringify(data.query._id)
      .toLowerCase()
      .match(/[0-9a-f-]{36}/g) as Array<string>;

    return people
      .filter((person: FakePerson): boolean => {
        return asked.includes(person.id.toString().toLowerCase());
      })
      .map(user);
  }) as never);

  jest.spyOn(UserService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }) => {
    const found: FakePerson | undefined = people.find(
      (person: FakePerson): boolean => {
        return person.id.toString() === data.id.toString();
      },
    );
    return found ? user(found) : null;
  }) as never);

  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    const project: Project = new Project();
    project.name = "Acme Production";
    return project;
  }) as never);

  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(
      URL.fromString("https://oneuptime.example.com/dashboard"),
    );

  // The cache, in memory.
  jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        if (cache.has(cacheKey(namespace, key))) {
          return false;
        }
        cache.set(cacheKey(namespace, key), value);
        return true;
      },
    );
  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      return cache.get(cacheKey(namespace, key)) || null;
    });
  jest
    .spyOn(GlobalCache, "getStrings")
    .mockImplementation(async (namespace: string, keys: Array<string>) => {
      return keys.map((key: string): string | null => {
        return cache.get(cacheKey(namespace, key)) || null;
      });
    });
  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        cache.set(cacheKey(namespace, key), value);
      },
    );
  jest
    .spyOn(GlobalCache, "setJSON")
    .mockImplementation(
      async (namespace: string, key: string, value: JSONObject) => {
        cache.set(cacheKey(namespace, key), JSON.stringify(value));
      },
    );
  jest
    .spyOn(GlobalCache, "getJSONObject")
    .mockImplementation(async (namespace: string, key: string) => {
      const value: string | undefined = cache.get(cacheKey(namespace, key));
      return value ? (JSON.parse(value) as JSONObject) : null;
    });
  jest
    .spyOn(GlobalCache, "extendExpiry")
    .mockImplementation(async (namespace: string, key: string) => {
      return cache.has(cacheKey(namespace, key));
    });
  jest
    .spyOn(GlobalCache, "deleteKeyIfValue")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        if (cache.get(cacheKey(namespace, key)) !== value) {
          return false;
        }
        cache.delete(cacheKey(namespace, key));
        return true;
      },
    );

  lookupSpy = jest
    .spyOn(SlackChannelMembers, "findPersonByEmail")
    .mockImplementation(async (data: { email: string }) => {
      return (
        slackPeople.find((person: SlackPersonFacts): boolean => {
          return person.email.toLowerCase() === data.email.toLowerCase();
        }) || null
      );
    });

  pageSpy = jest
    .spyOn(SlackChannelMembers, "getPeoplePage")
    .mockImplementation(async (data: { cursor: string }) => {
      // Two pages: the first half, then the rest.
      const half: number = Math.ceil(slackPeople.length / 2);
      return data.cursor
        ? { people: slackPeople.slice(half), nextCursor: "" }
        : { people: slackPeople.slice(0, half), nextCursor: "page-2" };
    });

  slackDmSpy = jest
    .spyOn(SlackUtil, "sendDirectMessageToUser")
    .mockResolvedValue(undefined);

  teamsDmSpy = jest
    .spyOn(MicrosoftTeamsUtil, "sendDirectMessageToUserAsBot")
    .mockResolvedValue(undefined);

  rosterSpy = jest.spyOn(MicrosoftTeamsUtil, "getTeamRoster");

  sleepSpy = jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined);

  askSpy = jest.spyOn(WorkspaceAskToConnect, "ask");
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function startAndFinish(
  workspaceType: WorkspaceType = WorkspaceType.Slack,
): Promise<WorkspaceAskToConnectStatus> {
  const askedBefore: number = askSpy.mock.calls.length;

  const status: WorkspaceAskToConnectStatus = await WorkspaceAskToConnect.start(
    {
      projectId: PROJECT_ID,
      workspaceType: workspaceType,
      askedByUserId: ADMIN,
    },
  );

  // The messages go on after the answer: wait for them.
  if (askSpy.mock.results.length > askedBefore) {
    await askSpy.mock.results[askedBefore]!.value;
  }

  return status;
}

async function lastRun(
  workspaceType: WorkspaceType = WorkspaceType.Slack,
): Promise<WorkspaceAskToConnectRun> {
  return (await WorkspaceAskToConnect.getStatus({
    projectId: PROJECT_ID,
    workspaceType: workspaceType,
  }))!.run!;
}

function dmRecipients(): Array<string> {
  return slackDmSpy.mock.calls.map((call: Array<unknown>): string => {
    return (call[0] as { workspaceUserId: string }).workspaceUserId;
  });
}

function markdownOf(blocks: Array<WorkspaceMessageBlock>): string {
  return blocks
    .filter((block: WorkspaceMessageBlock): boolean => {
      return block._type === "WorkspacePayloadMarkdown";
    })
    .map((block: WorkspaceMessageBlock): string => {
      return (block as WorkspacePayloadMarkdown).text;
    })
    .join("\n");
}

describe("what the settings page reads", () => {
  test("the members, how many of them connected, and no run before anybody asked", async () => {
    // A link of somebody who left the project counts for nobody.
    linkedIds = [ADMIN, LEFT];

    expect(
      await WorkspaceAskToConnect.getStatus({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
      }),
    ).toEqual({ memberCount: 4, connectedCount: 1, run: null });
  });

  test("a run the cache says is asking, whose server let its lock run out, is a stopped run", async () => {
    await startAndFinish();

    const run: WorkspaceAskToConnectRun = await lastRun();
    cache.set(
      cacheKey(
        "workspace-ask-to-connect-run",
        `${PROJECT_ID.toString()}:${WorkspaceType.Slack}`,
      ),
      JSON.stringify({ ...run, state: WorkspaceAskToConnectState.Asking }),
    );

    expect((await lastRun()).state).toBe(WorkspaceAskToConnectState.Stopped);
  });
});

describe("asking everybody in Slack", () => {
  test("everybody who has not connected is messaged, and whoever Slack has no account for is named", async () => {
    const status: WorkspaceAskToConnectStatus = await startAndFinish();

    // The answer comes at once, with who it set out to ask.
    expect(status.memberCount).toBe(4);
    expect(status.connectedCount).toBe(1);
    expect(status.run).toMatchObject({
      state: WorkspaceAskToConnectState.Asking,
      askedByName: "Jane Admin",
      toAskCount: 3,
    });

    // A few people are looked up one by one, by their address lower-cased.
    expect(
      lookupSpy.mock.calls.map((call: Array<unknown>) => {
        return (call[0] as { email: string }).email;
      }),
    ).toEqual(["alice@example.com", "bob@example.com", "carol@example.com"]);
    expect(pageSpy).not.toHaveBeenCalled();

    expect(dmRecipients()).toEqual(["U0ALICE", "U0BOB"]);
    expect(slackDmSpy.mock.calls[0]![0]).toMatchObject({
      authToken: "xoxb-project",
    });

    expect(await lastRun()).toMatchObject({
      state: WorkspaceAskToConnectState.Done,
      toAskCount: 3,
      askedCount: 2,
      notFoundCount: 1,
      failedCount: 0,
      notFoundNames: ["Carol"],
    });

    // The lock is given back: asking again is allowed.
    expect(
      Array.from(cache.keys()).some((key: string): boolean => {
        return key.startsWith("workspace-ask-to-connect-lock");
      }),
    ).toBe(false);
  });

  test("whoever was messaged in the last day is not messaged again; whoever was not found is tried again", async () => {
    await startAndFinish();
    slackDmSpy.mockClear();

    const again: WorkspaceAskToConnectStatus = await startAndFinish();

    expect(again.run!.toAskCount).toBe(1);
    expect(dmRecipients()).toEqual([]);
    expect(await lastRun()).toMatchObject({
      askedCount: 0,
      notFoundCount: 1,
      notFoundNames: ["Carol"],
    });
  });

  test("nobody left to ask: the run is done at once, and nothing is sent", async () => {
    linkedIds = [ADMIN, ALICE, BOB, CAROL];

    const status: WorkspaceAskToConnectStatus = await startAndFinish();

    expect(askSpy).not.toHaveBeenCalled();
    expect(status.run).toMatchObject({
      state: WorkspaceAskToConnectState.Done,
      toAskCount: 0,
    });
    expect(slackDmSpy).not.toHaveBeenCalled();

    // And the lock is given back.
    await expect(startAndFinish()).resolves.toBeDefined();
  });

  test("while one run is asking, another is refused and sends nothing", async () => {
    cache.set(
      cacheKey(
        "workspace-ask-to-connect-lock",
        `${PROJECT_ID.toString()}:${WorkspaceType.Slack}`,
      ),
      "another-server",
    );

    await expect(startAndFinish()).rejects.toThrow(
      WORKSPACE_ASK_TO_CONNECT_ALREADY_ASKING_MESSAGE,
    );
    expect(slackDmSpy).not.toHaveBeenCalled();
  });

  test("a project not connected to Slack is refused before anything is read", async () => {
    projectAuth = null;

    await expect(startAndFinish()).rejects.toThrow(
      "Slack is not connected to this project. Connect it first.",
    );
    expect(TeamMemberService.findBy).not.toHaveBeenCalled();
  });

  test("many people are found by reading the workspace's people, page by page, until all are found", async () => {
    people = [people[0]!];
    memberIds = [ADMIN];
    slackPeople = [];

    for (let i: number = 0; i <= SLACK_LOOKUP_ONE_BY_ONE_MAX; i++) {
      const id: ObjectID = ObjectID.generate();
      people.push({ id: id, name: `Person ${i}`, email: `p${i}@example.com` });
      memberIds.push(id);
      slackPeople.push(slackPerson(`U0P${i}`, `p${i}@example.com`));
    }

    // Accounts nobody is asked about, or nobody can be asked through.
    slackPeople.push(slackPerson("U0BOT", "bot@example.com", { isBot: true }));

    await startAndFinish();

    expect(lookupSpy).not.toHaveBeenCalled();
    expect(pageSpy).toHaveBeenCalledTimes(2);
    expect(dmRecipients()).toHaveLength(SLACK_LOOKUP_ONE_BY_ONE_MAX + 1);
    expect(await lastRun()).toMatchObject({
      askedCount: SLACK_LOOKUP_ONE_BY_ONE_MAX + 1,
      notFoundCount: 0,
    });
  });

  test("a deactivated account or a bot with a member's address is nobody to message", async () => {
    slackPeople = [
      slackPerson("U0ALICE", "alice@example.com", { isDeactivated: true }),
      slackPerson("U0BOB", "bob@example.com", { isBot: true }),
    ];

    await startAndFinish();

    expect(dmRecipients()).toEqual([]);
    expect((await lastRun()).notFoundCount).toBe(3);
  });

  test("Slack's rate limit is waited out, longer each time, and the run goes on", async () => {
    lookupSpy.mockRejectedValueOnce(
      new SlackChannelMembersError("ratelimited"),
    );

    await startAndFinish();

    expect(sleepSpy).toHaveBeenCalledWith(SLACK_BUSY_WAIT_MS);
    expect(dmRecipients()).toEqual(["U0ALICE", "U0BOB"]);
    expect((await lastRun()).askedCount).toBe(2);
  });

  test("when Slack cannot be asked at all, whoever was not asked is counted as not sent, and the lock is given back", async () => {
    lookupSpy.mockRejectedValue(new SlackChannelMembersError("invalid_auth"));

    await startAndFinish();

    expect(dmRecipients()).toEqual([]);
    expect(await lastRun()).toMatchObject({
      state: WorkspaceAskToConnectState.Done,
      askedCount: 0,
      failedCount: 3,
    });
    await expect(startAndFinish()).resolves.toBeDefined();
  });

  test("a message Slack refuses is counted, the others still go, and the refused person can be asked again at once", async () => {
    slackDmSpy.mockRejectedValueOnce(
      new Error("Error from Slack cannot_dm_bot"),
    );

    await startAndFinish();

    expect(dmRecipients()).toEqual(["U0ALICE", "U0BOB"]);
    expect(await lastRun()).toMatchObject({
      askedCount: 1,
      failedCount: 1,
      notFoundCount: 1,
    });

    // Alice's message was refused: she is asked again; Bob is not.
    slackDmSpy.mockClear();
    await startAndFinish();
    expect(dmRecipients()).toEqual(["U0ALICE"]);
  });
});

describe("asking everybody in Microsoft Teams", () => {
  const TEAM_A: MicrosoftTeamsInstalledTeam = {
    id: "team-a",
    graphTeamId: "team-a",
    name: "Engineering",
  };
  const TEAM_B: MicrosoftTeamsInstalledTeam = {
    id: "team-b",
    graphTeamId: "team-b",
    name: "Support",
  };

  beforeEach(() => {
    projectAuth = {
      authToken: "graph-token",
      projectId: PROJECT_ID,
    } as unknown as WorkspaceProjectAuthToken;

    jest
      .spyOn(MicrosoftTeamsUtil, "getInstalledTeamsForProject")
      .mockResolvedValue({
        "team-a": TEAM_A,
        // Not resolved to a Microsoft Graph team: its roster cannot be read.
        "19:thread": { id: "19:thread" },
        "team-b": TEAM_B,
      });

    rosterSpy.mockImplementation(
      async (data: {
        teamId: string;
      }): Promise<Array<MicrosoftTeamsRosterMember> | null> => {
        if (data.teamId === "team-a") {
          throw new Error("The Bot Connector refused");
        }

        return [
          {
            aadObjectId: "aad-alice",
            email: "ALICE@example.com",
            userPrincipalName: "alice@contoso.onmicrosoft.com",
            name: "Alice",
          },
          {
            aadObjectId: "aad-bob",
            email: "",
            userPrincipalName: "bob@example.com",
            name: "Bob",
          },
        ];
      },
    );
  });

  test("people are found in the rosters of the teams the app is in, by email or user principal name, and messaged by the bot", async () => {
    await startAndFinish(WorkspaceType.MicrosoftTeams);

    // A team whose roster cannot be read does not stop the others.
    expect(
      rosterSpy.mock.calls.map((call: Array<unknown>) => {
        return (call[0] as { teamId: string }).teamId;
      }),
    ).toEqual(["team-a", "team-b"]);

    expect(
      teamsDmSpy.mock.calls.map((call: Array<unknown>) => {
        const sent: { projectId: ObjectID; workspaceUserId: string } =
          call[0] as never;
        return [sent.projectId.toString(), sent.workspaceUserId];
      }),
    ).toEqual([
      [PROJECT_ID.toString(), "aad-alice"],
      [PROJECT_ID.toString(), "aad-bob"],
    ]);
    expect(slackDmSpy).not.toHaveBeenCalled();
    expect(lookupSpy).not.toHaveBeenCalled();

    expect(await lastRun(WorkspaceType.MicrosoftTeams)).toMatchObject({
      askedCount: 2,
      notFoundCount: 1,
      notFoundNames: ["Carol"],
    });
  });

  test("the button connects their Microsoft Teams account, from their own Microsoft Teams settings", async () => {
    await startAndFinish(WorkspaceType.MicrosoftTeams);

    const blocks: Array<WorkspaceMessageBlock> = (
      teamsDmSpy.mock.calls[0]![0] as {
        messageBlocks: Array<WorkspaceMessageBlock>;
      }
    ).messageBlocks;

    const buttons: WorkspacePayloadButtons = blocks.find(
      (block: WorkspaceMessageBlock): boolean => {
        return block._type === "WorkspacePayloadButtons";
      },
    ) as WorkspacePayloadButtons;

    expect(buttons.buttons[0]!.title).toBe("Connect Microsoft Teams account");
    expect(buttons.buttons[0]!.url!.toString()).toBe(
      `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/user-settings/microsoft-teams-integration?connectAccount=true`,
    );
  });

  test("Slack and Microsoft Teams are asked apart: a run of one is not the other's", async () => {
    await startAndFinish(WorkspaceType.MicrosoftTeams);

    expect(
      (
        await WorkspaceAskToConnect.getStatus({
          projectId: PROJECT_ID,
          workspaceType: WorkspaceType.Slack,
        })
      ).run,
    ).toBeNull();
  });
});

describe("the message", () => {
  test("who asked, which project, what connecting does, and a button to their own Slack settings", () => {
    const message: WorkspaceAskToConnectMessage =
      WorkspaceAskToConnect.getMessage({
        workspaceType: WorkspaceType.Slack,
        askedByName: "Jane Admin",
        projectName: "Acme Production",
        connectUrl:
          "https://oneuptime.example.com/dashboard/p/user-settings/slack-integration?connectAccount=true",
      });

    const markdown: string = markdownOf(message.blocks);

    expect(markdown).toContain(
      "👋 **Jane Admin** asks you to connect your Slack account to OneUptime in the **Acme Production** project.",
    );
    expect(markdown).toContain("act as you, with your permissions");
    expect(markdown).toContain("It takes one click");

    const buttons: WorkspacePayloadButtons = message.blocks.find(
      (block: WorkspaceMessageBlock): boolean => {
        return block._type === "WorkspacePayloadButtons";
      },
    ) as WorkspacePayloadButtons;

    expect(buttons.buttons).toHaveLength(1);
    expect(buttons.buttons[0]).toMatchObject({
      title: "Connect Slack account",
      actionId: WorkspaceHome.CONNECT_ACTION_ID,
      isPrimary: true,
    });
    expect(buttons.buttons[0]!.url!.toString()).toContain(
      "connectAccount=true",
    );

    // The notification names nobody: a name is not the app's to put there.
    expect(message.text).toBe(
      "You're asked to connect your Slack account to OneUptime.",
    );
  });

  test("names are text: Markdown, a link or a mention in one is shown as written, never acted on", () => {
    const markdown: string = markdownOf(
      WorkspaceAskToConnect.getMessage({
        workspaceType: WorkspaceType.Slack,
        askedByName: "<!channel> [x](https://evil.example)",
        projectName: "**Prod**",
        connectUrl: null,
      }).blocks,
    );

    // No mention, no link, no bold of the name's own: each is escaped.
    expect(markdown).not.toContain("<!channel>");
    expect(markdown).toContain("\\[x\\](https://evil.example)");
    expect(markdown).toContain("**\\*\\*Prod\\*\\***");
  });

  test("without a dashboard address to link to, it says where to connect, with no button", () => {
    const message: WorkspaceAskToConnectMessage =
      WorkspaceAskToConnect.getMessage({
        workspaceType: WorkspaceType.MicrosoftTeams,
        askedByName: "",
        projectName: "",
        connectUrl: null,
      });

    expect(
      message.blocks.some((block: WorkspaceMessageBlock): boolean => {
        return block._type === "WorkspacePayloadButtons";
      }),
    ).toBe(false);

    const markdown: string = markdownOf(message.blocks);

    expect(markdown).toContain(
      "👋 A project admin asks you to connect your Microsoft Teams account to OneUptime.",
    );
    expect(markdown).toContain(
      "go to **User Settings → Workspace → Microsoft Teams** and press **Connect my account with Microsoft Teams**",
    );
  });

  test.each([
    [WorkspaceType.Slack, "slack-integration"],
    [WorkspaceType.MicrosoftTeams, "microsoft-teams-integration"],
  ])(
    "the %s button opens the member's own settings with connectAccount=true",
    async (workspaceType: WorkspaceType, page: string) => {
      expect(
        await WorkspaceAskToConnect.getConnectUrl({
          projectId: PROJECT_ID,
          workspaceType: workspaceType,
        }),
      ).toBe(
        `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/user-settings/${page}?connectAccount=true`,
      );
    },
  );
});
