import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHO IS IN A MICROSOFT TEAMS TEAM (MicrosoftTeamsUtil.getTeamRoster), as an
 * on-call tag reads it: a tag holds only its team's members, and the roster
 * says who they are - their Microsoft Entra id, which a tag's members are
 * named by, and their email address, which a person on call is matched by.
 *
 * Read through the bot, which is in the team (no Graph permission to read
 * people): a proactive turn in the team's own conversation - its thread id
 * and the service URL captured when the app was installed, never the Graph
 * id the tag is kept under - paging through TeamsInfo.getPagedTeamMembers.
 */

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
    MicrosoftTeamsAppClientSecret: "test-secret",
    MicrosoftTeamsAppTenantId: "test-tenant",
  };
});

jest.mock("botbuilder", () => {
  return {
    CloudAdapter: class CloudAdapter {},
    ConfigurationBotFrameworkAuthentication: class ConfigurationBotFrameworkAuthentication {},
    TeamsActivityHandler: class TeamsActivityHandler {},
    TurnContext: class TurnContext {},
    ActivityHandler: class ActivityHandler {},
    MessageFactory: { text: jest.fn(), attachment: jest.fn() },
    CardFactory: { heroCard: jest.fn() },
    TeamsInfo: {
      getMembers: jest.fn(),
      getPagedMembers: jest.fn(),
      getPagedTeamMembers: jest.fn(),
      getTeamDetails: jest.fn(),
    },
  };
});

import MicrosoftTeamsUtil, {
  MICROSOFT_TEAMS_MAX_ROSTER_MEMBERS,
  MicrosoftTeamsRosterMember,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsInstalledTeam,
  MicrosoftTeamsMiscData,
} from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import ObjectID from "../../../../Types/ObjectID";
import { TeamsInfo, type ConversationReference } from "botbuilder";

const PROJECT_ID: ObjectID = new ObjectID(
  "c5000000-0000-4000-8000-000000000001",
);
const TENANT_ID: string = "aaaaaaaa-1111-2222-3333-444444444444";
const GRAPH_TEAM_ID: string = "bbbbbbbb-5555-6666-7777-888888888888";
const TEAM_THREAD_ID: string = "19:qWeRtY_teamThread@thread.tacv2";
const SERVICE_URL: string = "https://smba.trafficmanager.net/emea/";

interface Turns {
  refs: Array<ConversationReference>;
  appIds: Array<string>;
}

let getPagedTeamMembers: jest.Mock;

function installedTeam(
  data: Partial<MicrosoftTeamsInstalledTeam> = {},
): MicrosoftTeamsInstalledTeam {
  return {
    id: GRAPH_TEAM_ID,
    graphTeamId: GRAPH_TEAM_ID,
    teamsThreadId: TEAM_THREAD_ID,
    name: "Payments",
    serviceUrl: SERVICE_URL,
    ...data,
  };
}

function projectAuthWith(
  installedTeams: Record<string, MicrosoftTeamsInstalledTeam> | undefined,
): void {
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockResolvedValue({
      id: ObjectID.generate(),
      workspaceProjectId: TENANT_ID,
      miscData: {
        tenantId: TENANT_ID,
        installedTeams: installedTeams,
      } as MicrosoftTeamsMiscData,
    } as unknown as WorkspaceProjectAuthToken);
}

function fakeBotAdapter(): Turns {
  const turns: Turns = { refs: [], appIds: [] };

  jest.spyOn(MicrosoftTeamsUtil as any, "getBotAdapter").mockReturnValue({
    continueConversationAsync: async (
      appId: string,
      ref: ConversationReference,
      logic: (context: unknown) => Promise<void>,
    ): Promise<void> => {
      turns.appIds.push(appId);
      turns.refs.push(ref);
      await logic({ activity: { serviceUrl: ref.serviceUrl } });
    },
  });

  return turns;
}

function member(
  aadObjectId: string | undefined,
  name: string,
  email?: string,
  userPrincipalName?: string,
): Record<string, unknown> {
  return {
    id: `29:${name.replace(/\s/g, "").toLowerCase()}`,
    aadObjectId: aadObjectId,
    name: name,
    email: email,
    userPrincipalName: userPrincipalName,
  };
}

beforeEach(() => {
  getPagedTeamMembers = TeamsInfo.getPagedTeamMembers as unknown as jest.Mock;
  getPagedTeamMembers.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MicrosoftTeamsUtil.getTeamRoster", () => {
  test("asked of the bot in the team's own conversation - by its thread id and service URL - every page, as Entra ids and email addresses", async () => {
    projectAuthWith({ [GRAPH_TEAM_ID]: installedTeam() });
    const turns: Turns = fakeBotAdapter();

    getPagedTeamMembers
      .mockResolvedValueOnce({
        members: [
          member("a0a0", " Ana Silva ", " ana@acme.test ", "ana@acme.test"),
          member("b0b0", "Bob Lee", undefined, "bob@acme.onmicrosoft.com"),
        ],
        continuationToken: "page-2",
      })
      .mockResolvedValueOnce({
        members: [member("c0c0", "Carol Diaz", "carol@acme.test")],
        continuationToken: undefined,
      });

    const roster: Array<MicrosoftTeamsRosterMember> | null =
      await MicrosoftTeamsUtil.getTeamRoster({
        projectId: PROJECT_ID,
        teamId: GRAPH_TEAM_ID,
      });

    expect(roster).toEqual([
      {
        aadObjectId: "a0a0",
        email: "ana@acme.test",
        userPrincipalName: "ana@acme.test",
        name: "Ana Silva",
      },
      {
        aadObjectId: "b0b0",
        email: "",
        userPrincipalName: "bob@acme.onmicrosoft.com",
        name: "Bob Lee",
      },
      {
        aadObjectId: "c0c0",
        email: "carol@acme.test",
        userPrincipalName: "",
        name: "Carol Diaz",
      },
    ]);

    // One turn, as the bot, in the team's conversation where it was installed.
    expect(turns.appIds).toEqual(["11111111-2222-3333-4444-555555555555"]);
    expect(turns.refs).toHaveLength(1);
    expect(turns.refs[0]!.conversation).toEqual(
      expect.objectContaining({
        id: TEAM_THREAD_ID,
        isGroup: true,
        conversationType: "channel",
        tenantId: TENANT_ID,
      }),
    );
    expect(turns.refs[0]!.serviceUrl).toBe(SERVICE_URL);
    expect(turns.refs[0]!.channelId).toBe("msteams");

    // Paged by the thread id - never the Graph id - 500 at a time.
    expect(
      getPagedTeamMembers.mock.calls.map((call: Array<unknown>) => {
        return call.slice(1);
      }),
    ).toEqual([
      [TEAM_THREAD_ID, 500, undefined],
      [TEAM_THREAD_ID, 500, "page-2"],
    ]);
  });

  test("a member with no Entra id - a bot, a guest from another tenant - is nobody a tag can hold", async () => {
    projectAuthWith({ [GRAPH_TEAM_ID]: installedTeam() });
    fakeBotAdapter();

    getPagedTeamMembers.mockResolvedValueOnce({
      members: [
        member(undefined, "Some Bot"),
        member("a0a0", "Ana Silva", "ana@acme.test"),
      ],
    });

    expect(
      (
        await MicrosoftTeamsUtil.getTeamRoster({
          projectId: PROJECT_ID,
          teamId: GRAPH_TEAM_ID,
        })
      )?.map((person: MicrosoftTeamsRosterMember): string => {
        return person.aadObjectId;
      }),
    ).toEqual(["a0a0"]);
  });

  test("stops paging at the most a roster is read for, however many pages Teams offers", async () => {
    projectAuthWith({ [GRAPH_TEAM_ID]: installedTeam() });
    fakeBotAdapter();

    let page: number = 0;
    getPagedTeamMembers.mockImplementation(async () => {
      page++;
      return {
        members: Array.from({ length: 500 }, (_: unknown, index: number) => {
          return member(`id-${page}-${index}`, `Person ${page}-${index}`);
        }),
        continuationToken: `page-${page + 1}`,
      };
    });

    const roster: Array<MicrosoftTeamsRosterMember> | null =
      await MicrosoftTeamsUtil.getTeamRoster({
        projectId: PROJECT_ID,
        teamId: GRAPH_TEAM_ID,
      });

    expect(getPagedTeamMembers).toHaveBeenCalledTimes(
      MICROSOFT_TEAMS_MAX_ROSTER_MEMBERS / 500,
    );
    expect(roster).toHaveLength(MICROSOFT_TEAMS_MAX_ROSTER_MEMBERS);
  });

  test("a team the app is not in, or was installed in before its thread id was kept: null - the tag's team is gone", async () => {
    const turns: Turns = fakeBotAdapter();

    projectAuthWith({});
    expect(
      await MicrosoftTeamsUtil.getTeamRoster({
        projectId: PROJECT_ID,
        teamId: GRAPH_TEAM_ID,
      }),
    ).toBeNull();

    projectAuthWith({
      [GRAPH_TEAM_ID]: installedTeam({ teamsThreadId: undefined }),
    });
    expect(
      await MicrosoftTeamsUtil.getTeamRoster({
        projectId: PROJECT_ID,
        teamId: GRAPH_TEAM_ID,
      }),
    ).toBeNull();

    // Microsoft Teams is not asked at all.
    expect(turns.refs).toEqual([]);
    expect(getPagedTeamMembers).not.toHaveBeenCalled();
  });

  test("a project not connected to Microsoft Teams: null, nothing asked", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(null);
    const turns: Turns = fakeBotAdapter();

    expect(
      await MicrosoftTeamsUtil.getTeamRoster({
        projectId: PROJECT_ID,
        teamId: GRAPH_TEAM_ID,
      }),
    ).toBeNull();
    expect(turns.refs).toEqual([]);
  });

  test("Teams refusing the read is the caller's to answer: it is thrown, not taken for an empty team", async () => {
    projectAuthWith({ [GRAPH_TEAM_ID]: installedTeam() });
    fakeBotAdapter();

    getPagedTeamMembers.mockRejectedValueOnce(
      Object.assign(new Error("Forbidden"), { statusCode: 403 }),
    );

    await expect(
      MicrosoftTeamsUtil.getTeamRoster({
        projectId: PROJECT_ID,
        teamId: GRAPH_TEAM_ID,
      }),
    ).rejects.toThrow("Forbidden");
  });
});
