import { describe, expect, test } from "@jest/globals";
import WorkspaceChannelLinkUtil, {
  WORKSPACE_CHANNEL_LINK_ROUTE,
  WorkspaceChannelLink,
  WorkspaceChannelRecordType,
} from "../../../Types/Workspace/WorkspaceChannelLink";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

/*
 * The links behind Open in Slack / Open in Microsoft Teams: built only from
 * ids of the shapes each product gives, on a fixed host, so nothing a stored
 * channel row holds can send the button anywhere else.
 */

const TEAM_GUID: string = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const TENANT_GUID: string = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const TEAMS_CHANNEL: string =
  "19:3bb6a2a1b5e64c2a9d0d8f2d1c0e8f2b@thread.tacv2";

describe("Slack", () => {
  test("opens the channel through Slack's own redirect, in the app or the browser", () => {
    const url: string | null = WorkspaceChannelLinkUtil.getSlackChannelUrl({
      teamId: "T0123ABCD",
      channelId: "C0456EFGH",
    });

    expect(url).toBe(
      "https://slack.com/app_redirect?channel=C0456EFGH&team=T0123ABCD",
    );

    const parsed: URL = new URL(url!);
    expect(parsed.host).toBe("slack.com");
    expect(parsed.searchParams.get("channel")).toBe("C0456EFGH");
    expect(parsed.searchParams.get("team")).toBe("T0123ABCD");
  });

  test("an Enterprise Grid org and a private channel are Slack ids too", () => {
    expect(
      WorkspaceChannelLinkUtil.getSlackChannelUrl({
        teamId: "E0123ABCD",
        channelId: "G0456EFGH",
      }),
    ).not.toBeNull();
  });

  test("surrounding spaces are not part of an id", () => {
    expect(
      WorkspaceChannelLinkUtil.getSlackChannelUrl({
        teamId: " T0123ABCD ",
        channelId: " C0456EFGH",
      }),
    ).toBe("https://slack.com/app_redirect?channel=C0456EFGH&team=T0123ABCD");
  });

  test.each<[string | undefined, string | undefined]>([
    [undefined, "C0456EFGH"],
    ["T0123ABCD", undefined],
    ["", "C0456EFGH"],
    ["t0123abcd", "C0456EFGH"],
    ["T0123ABCD", "C0456&team=TEVIL"],
    ["T0123ABCD", "../../evil"],
    ["T0123ABCD", "C0456EFGH#x"],
    ["https://evil.example", "C0456EFGH"],
  ])(
    "no link from ids that are not Slack's: team %p, channel %p",
    (teamId: string | undefined, channelId: string | undefined) => {
      expect(
        WorkspaceChannelLinkUtil.getSlackChannelUrl({ teamId, channelId }),
      ).toBeNull();
    },
  );
});

describe("Microsoft Teams", () => {
  test("is Teams' own channel link, with the team and the tenant", () => {
    const url: string | null =
      WorkspaceChannelLinkUtil.getMicrosoftTeamsChannelUrl({
        tenantId: TENANT_GUID,
        teamId: TEAM_GUID,
        channelId: TEAMS_CHANNEL,
        channelName: "Incident 42 - checkout",
      });

    expect(url).toBe(
      `https://teams.microsoft.com/l/channel/19%3A3bb6a2a1b5e64c2a9d0d8f2d1c0e8f2b%40thread.tacv2/Incident%2042%20-%20checkout?groupId=${TEAM_GUID}&tenantId=${TENANT_GUID}`,
    );

    const parsed: URL = new URL(url!);
    expect(parsed.host).toBe("teams.microsoft.com");
    expect(parsed.searchParams.get("groupId")).toBe(TEAM_GUID);
    expect(parsed.searchParams.get("tenantId")).toBe(TENANT_GUID);
  });

  test("in a US Government cloud, on that cloud's Teams on the web", () => {
    for (const [origin, host] of [
      ["https://gov.teams.microsoft.us", "gov.teams.microsoft.us"],
      ["https://dod.teams.microsoft.us", "dod.teams.microsoft.us"],
    ]) {
      const url: string | null =
        WorkspaceChannelLinkUtil.getMicrosoftTeamsChannelUrl({
          tenantId: TENANT_GUID,
          teamId: TEAM_GUID,
          channelId: TEAMS_CHANNEL,
          channelName: "ops",
          teamsWebOrigin: origin,
        });
      const parsed: URL = new URL(url!);

      expect(parsed.host).toBe(host);
      expect(parsed.pathname.startsWith("/l/channel/")).toBe(true);
      expect(parsed.searchParams.get("groupId")).toBe(TEAM_GUID);
      // And the page takes it: it is on Teams' host, in that cloud.
      expect(
        WorkspaceChannelLinkUtil.isOnWorkspaceHost({
          workspaceType: WorkspaceType.MicrosoftTeams,
          url: url!,
        }),
      ).toBe(true);
    }
  });

  test("a link on a host that only looks like a Teams cloud's is not Teams'", () => {
    for (const url of [
      "https://gov.teams.microsoft.us.evil.example/l/channel/x/y",
      "https://teams.microsoft.us/l/channel/x/y",
      "http://gov.teams.microsoft.us/l/channel/x/y",
    ]) {
      expect(
        WorkspaceChannelLinkUtil.isOnWorkspaceHost({
          workspaceType: WorkspaceType.MicrosoftTeams,
          url: url,
        }),
      ).toBe(false);
    }
  });

  test("without a tenant, Teams finds the channel by its team", () => {
    const url: string | null =
      WorkspaceChannelLinkUtil.getMicrosoftTeamsChannelUrl({
        tenantId: undefined,
        teamId: TEAM_GUID,
        channelId: TEAMS_CHANNEL,
        channelName: "ops",
      });

    expect(new URL(url!).searchParams.get("tenantId")).toBeNull();
    expect(new URL(url!).searchParams.get("groupId")).toBe(TEAM_GUID);
  });

  test("a tenant of the wrong shape is left out rather than placed", () => {
    const url: string | null =
      WorkspaceChannelLinkUtil.getMicrosoftTeamsChannelUrl({
        tenantId: "evil&x=1",
        teamId: TEAM_GUID,
        channelId: TEAMS_CHANNEL,
        channelName: "ops",
      });

    expect(new URL(url!).searchParams.get("tenantId")).toBeNull();
    expect(new URL(url!).searchParams.get("x")).toBeNull();
  });

  test("a channel of an older team (thread.skype) works too", () => {
    expect(
      WorkspaceChannelLinkUtil.getMicrosoftTeamsChannelUrl({
        tenantId: TENANT_GUID,
        teamId: TEAM_GUID,
        channelId: "19:abc-DEF_123@thread.skype",
        channelName: "General",
      }),
    ).not.toBeNull();
  });

  test("a name that would end the path is encoded, not placed", () => {
    const url: string | null =
      WorkspaceChannelLinkUtil.getMicrosoftTeamsChannelUrl({
        tenantId: TENANT_GUID,
        teamId: TEAM_GUID,
        channelId: TEAMS_CHANNEL,
        channelName: "a/../b?groupId=evil#x",
      });
    const parsed: URL = new URL(url!);

    expect(parsed.host).toBe("teams.microsoft.com");
    expect(parsed.searchParams.get("groupId")).toBe(TEAM_GUID);
    expect(parsed.hash).toBe("");
  });

  test.each<[string, string | undefined, string | undefined]>([
    ["no team", undefined, TEAMS_CHANNEL],
    ["a team that is not a GUID", "my-team", TEAMS_CHANNEL],
    ["no channel", TEAM_GUID, undefined],
    ["a channel that is not a Teams channel id", TEAM_GUID, "C0456EFGH"],
    ["a chat id", TEAM_GUID, "19:meeting_abc@thread.v2"],
  ])(
    "no link with %s",
    (
      _label: string,
      teamId: string | undefined,
      channelId: string | undefined,
    ) => {
      expect(
        WorkspaceChannelLinkUtil.getMicrosoftTeamsChannelUrl({
          tenantId: TENANT_GUID,
          teamId,
          channelId,
          channelName: "ops",
        }),
      ).toBeNull();
    },
  );
});

describe("the answer the page reads", () => {
  const LINKS: Array<WorkspaceChannelLink> = [
    {
      workspaceType: WorkspaceType.Slack,
      channelName: "incident-42",
      url: "https://slack.com/app_redirect?channel=C1&team=T1",
    },
    {
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelName: "Incident 42",
      url: `https://teams.microsoft.com/l/channel/x/y?groupId=${TEAM_GUID}`,
    },
  ];

  test("round-trips through JSON", () => {
    expect(
      WorkspaceChannelLinkUtil.fromJSONArray(
        JSON.parse(JSON.stringify(WorkspaceChannelLinkUtil.toJSONArray(LINKS))),
      ),
    ).toEqual(LINKS);
  });

  test.each<[string, unknown]>([
    ["a non-array", { links: [] }],
    ["null", null],
    ["a string", "https://slack.com"],
  ])("%s holds no links", (_label: string, value: unknown) => {
    expect(WorkspaceChannelLinkUtil.fromJSONArray(value)).toEqual([]);
  });

  test("keeps only well-formed links to Slack's and Microsoft's own hosts", () => {
    expect(
      WorkspaceChannelLinkUtil.fromJSONArray([
        ...WorkspaceChannelLinkUtil.toJSONArray(LINKS),
        null,
        "x",
        {
          workspaceType: WorkspaceType.Slack,
          channelName: "phish",
          url: "https://slack.com.evil.example/app_redirect",
        },
        {
          workspaceType: WorkspaceType.Slack,
          channelName: "plain http",
          url: "http://slack.com/app_redirect?channel=C1&team=T1",
        },
        {
          workspaceType: WorkspaceType.MicrosoftTeams,
          channelName: "a Slack link in a Teams row",
          url: "https://slack.com/app_redirect?channel=C1&team=T1",
        },
        {
          workspaceType: "Discord",
          channelName: "other",
          url: "https://discord.com/x",
        },
        {
          workspaceType: WorkspaceType.Slack,
          channelName: 5,
          url: "https://slack.com/app_redirect?channel=C1&team=T1",
        },
        {
          workspaceType: WorkspaceType.Slack,
          channelName: "no url",
        },
        {
          workspaceType: WorkspaceType.Slack,
          channelName: "javascript",
          url: "javascript:alert(1)",
        },
      ]),
    ).toEqual(LINKS);
  });

  test("knows the record types that have channels of their own", () => {
    expect(Object.values(WorkspaceChannelRecordType).sort()).toEqual(
      [
        "alert",
        "alert-episode",
        "incident",
        "incident-episode",
        "scheduled-maintenance",
      ].sort(),
    );

    for (const recordType of Object.values(WorkspaceChannelRecordType)) {
      expect(WorkspaceChannelLinkUtil.isRecordType(recordType)).toBe(true);
    }

    expect(WorkspaceChannelLinkUtil.isRecordType("monitor")).toBe(false);
    expect(WorkspaceChannelLinkUtil.isRecordType("__proto__")).toBe(false);
    expect(WorkspaceChannelLinkUtil.isRecordType(undefined)).toBe(false);
    expect(WORKSPACE_CHANNEL_LINK_ROUTE).toBe("/workspace-channel-link");
  });
});
