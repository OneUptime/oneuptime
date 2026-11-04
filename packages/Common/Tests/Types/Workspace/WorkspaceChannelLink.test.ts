import { describe, expect, test } from "@jest/globals";
import WorkspaceChannelLinkUtil, {
  WORKSPACE_CHANNEL_LINK_ROUTE,
  WorkspaceChannelLink,
  WorkspaceChannelRecordType,
} from "../../../Types/Workspace/WorkspaceChannelLink";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { generatedTexts } from "../../Helpers/GeneratedTexts";

/*
 * The links behind Open in Slack / Open in Microsoft Teams / Open in
 * Mattermost: built only from ids of the shapes each product gives, on the
 * product's own host - for Mattermost, the server the project was connected
 * to - so nothing a stored channel row holds can send the button anywhere
 * else.
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

describe("Mattermost", () => {
  const SERVER: string = "https://chat.example.com";
  const TEAM: string = "acme";
  const CHANNEL: string = "inc-42";

  const url: (data: {
    serverUrl?: string | undefined;
    teamName?: string | undefined;
    channelName?: string | undefined;
  }) => string | null = (data: {
    serverUrl?: string | undefined;
    teamName?: string | undefined;
    channelName?: string | undefined;
  }): string | null => {
    return WorkspaceChannelLinkUtil.getMattermostChannelUrl({
      serverUrl: "serverUrl" in data ? data.serverUrl : SERVER,
      teamName: "teamName" in data ? data.teamName : TEAM,
      channelName: "channelName" in data ? data.channelName : CHANNEL,
    });
  };

  test("is the channel's own address, on the connected server, in its team", () => {
    expect(url({})).toBe("https://chat.example.com/acme/channels/inc-42");
  });

  test.each<[string, string, string]>([
    [
      "on a path keeps its path",
      "https://example.com/mattermost",
      "https://example.com/mattermost/acme/channels/inc-42",
    ],
    [
      "on a port keeps its port",
      "https://chat.example.com:8065",
      "https://chat.example.com:8065/acme/channels/inc-42",
    ],
    [
      "connected over http stays http",
      "http://10.0.0.5:8065",
      "http://10.0.0.5:8065/acme/channels/inc-42",
    ],
    [
      "with a trailing slash has none in its link",
      "https://chat.example.com/",
      "https://chat.example.com/acme/channels/inc-42",
    ],
    [
      "on a path with trailing slashes has none in its link",
      "https://example.com/mattermost//",
      "https://example.com/mattermost/acme/channels/inc-42",
    ],
  ])("a server %s", (_label: string, serverUrl: string, expected: string) => {
    expect(url({ serverUrl })).toBe(expected);
  });

  test("surrounding spaces are not part of a name", () => {
    expect(
      url({
        serverUrl: ` ${SERVER} `,
        teamName: ` ${TEAM} `,
        channelName: ` ${CHANNEL} `,
      }),
    ).toBe("https://chat.example.com/acme/channels/inc-42");
  });

  test.each<[string | undefined]>([
    [undefined],
    [""],
    ["   "],
    ["../../evil"],
    [".."],
    ["a/b"],
    ["a\\b"],
    ["%2e%2e%2fevil"],
    ["x?y=1"],
    ["x#y"],
    ["x y"],
    ["Inc-42"],
    ["#inc-42"],
    ["~inc-42"],
    ["@evil.example"],
    ["https://evil.example"],
    ["a".repeat(65)],
  ])(
    "no link from a channel that is not one of Mattermost's: %p",
    (name: string | undefined) => {
      expect(url({ channelName: name })).toBeNull();
    },
  );

  test.each<[string | undefined]>([
    [undefined],
    [""],
    ["../../evil"],
    ["a/b"],
    ["x?y=1"],
    ["Acme Inc"],
    ["@evil.example"],
    ["a".repeat(65)],
  ])(
    "no link from a team that is not one of Mattermost's: %p",
    (teamName: string | undefined) => {
      expect(url({ teamName })).toBeNull();
    },
  );

  test.each<[string | undefined]>([
    [undefined],
    [""],
    ["chat.example.com"],
    ["//evil.example"],
    ["javascript:alert(1)"],
    ["data:text/html,evil"],
    ["ftp://chat.example.com"],
    ["file:///etc/passwd"],
    ["https://user:secret@chat.example.com"],
    ["https://chat.example.com@evil.example"],
    ["https://chat.example.com?x=1"],
    ["https://chat.example.com#x"],
  ])(
    "no link on a server that is not a server's address: %p",
    (serverUrl: string | undefined) => {
      expect(url({ serverUrl })).toBeNull();
    },
  );

  test("a stored value that is not text is no name, and fails nothing", () => {
    for (const value of [42, true, {}, [], null]) {
      const notText: string = value as unknown as string;

      expect(url({ serverUrl: notText })).toBeNull();
      expect(url({ teamName: notText })).toBeNull();
      expect(url({ channelName: notText })).toBeNull();
    }
  });

  /*
   * What a channel row holds is written by whoever named the channel. Every
   * link it gets is a channel of the connected team, on the connected server.
   */
  test("whatever a channel is called, its link stays on the connected server", () => {
    const pieces: ReadonlyArray<string> = [
      "a",
      "7",
      "-",
      "_",
      "/",
      "\\",
      ".",
      "..",
      ":",
      "@",
      "?",
      "#",
      "%2f",
      "%2e",
      " ",
      "\t",
      "\n",
      "https://",
      "evil.example",
    ];
    let linked: number = 0;

    for (const name of generatedTexts(20000, 5693, pieces, 9)) {
      const link: string | null = url({
        serverUrl: "https://example.com/mattermost",
        channelName: name,
      });

      if (!link) {
        continue;
      }

      linked++;

      const parsed: URL = new URL(link);

      expect(parsed.origin).toBe("https://example.com");
      expect(parsed.pathname).toBe(`/mattermost/acme/channels/${name.trim()}`);
      expect(parsed.username).toBe("");
      expect(parsed.search).toBe("");
      expect(parsed.hash).toBe("");

      // And the page takes it: a link it refused would hide the button.
      expect(
        WorkspaceChannelLinkUtil.isOnWorkspaceHost({
          workspaceType: WorkspaceType.Mattermost,
          url: link,
        }),
      ).toBe(true);
    }

    // The sweep reached names that do get a link, not only ones refused.
    expect(linked).toBeGreaterThan(50);
  });

  describe("what the page takes", () => {
    const isTaken: (link: string) => boolean = (link: string): boolean => {
      return WorkspaceChannelLinkUtil.isOnWorkspaceHost({
        workspaceType: WorkspaceType.Mattermost,
        url: link,
      });
    };

    test.each<[string]>([
      ["https://chat.example.com"],
      ["https://chat.example.com:8065"],
      ["https://example.com/mattermost"],
      ["http://10.0.0.5:8065"],
      ["https://[2001:db8::1]:8065"],
    ])("every link the server builds, on %s", (serverUrl: string) => {
      expect(isTaken(url({ serverUrl })!)).toBe(true);
    });

    test.each<[string, string]>([
      ["a script", "javascript:alert(1)//acme/channels/inc-42"],
      ["a page of data", "data:text/html,/acme/channels/inc-42"],
      ["another scheme", "ftp://chat.example.com/acme/channels/inc-42"],
      ["a local file", "file:///acme/channels/inc-42"],
      [
        "a user name in front of the host",
        "https://chat.example.com@evil.example/acme/channels/inc-42",
      ],
      [
        "a password",
        "https://user:secret@chat.example.com/acme/channels/inc-42",
      ],
      ["a query", "https://chat.example.com/acme/channels/inc-42?x=1"],
      ["a fragment", "https://chat.example.com/acme/channels/inc-42#x"],
      ["no channel", "https://chat.example.com/acme/channels/"],
      ["no channels word", "https://chat.example.com/acme/inc-42"],
      ["no team", "https://chat.example.com/channels/inc-42"],
      ["only the server", "https://chat.example.com"],
      ["another page", "https://chat.example.com/login"],
      ["more after the channel", "https://chat.example.com/acme/channels/a/b"],
      [
        "a capital in the channel",
        "https://chat.example.com/acme/channels/Inc",
      ],
      ["a capital in the team", "https://chat.example.com/Acme/channels/inc"],
      ["an encoded slash", "https://chat.example.com/acme/channels/a%2fb"],
      ["a direct message", "https://chat.example.com/acme/messages/@admin"],
      ["not an address", "not a url"],
    ])("not %s", (_label: string, link: string) => {
      expect(isTaken(link)).toBe(false);
    });

    test("a channel's address is not a link to Slack or Microsoft Teams", () => {
      for (const workspaceType of [
        WorkspaceType.Slack,
        WorkspaceType.MicrosoftTeams,
      ]) {
        expect(
          WorkspaceChannelLinkUtil.isOnWorkspaceHost({
            workspaceType,
            url: url({})!,
          }),
        ).toBe(false);
      }
    });

    test("Slack and Microsoft Teams stay https, on their own hosts", () => {
      expect(
        WorkspaceChannelLinkUtil.isOnWorkspaceHost({
          workspaceType: WorkspaceType.Slack,
          url: "http://slack.com/acme/channels/inc-42",
        }),
      ).toBe(false);
      expect(
        WorkspaceChannelLinkUtil.isOnWorkspaceHost({
          workspaceType: WorkspaceType.MicrosoftTeams,
          url: "https://chat.example.com/acme/channels/inc-42",
        }),
      ).toBe(false);
    });
  });
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
    {
      workspaceType: WorkspaceType.Mattermost,
      channelName: "inc-42",
      url: "https://chat.example.com/acme/channels/inc-42",
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

  test("keeps only well-formed links to Slack's and Microsoft's own hosts, and to Mattermost channels", () => {
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
        {
          workspaceType: WorkspaceType.Mattermost,
          channelName: "javascript",
          url: "javascript:alert(1)//acme/channels/inc-42",
        },
        {
          workspaceType: WorkspaceType.Mattermost,
          channelName: "a user name in front of the host",
          url: "https://chat.example.com@evil.example/acme/channels/inc-42",
        },
        {
          workspaceType: WorkspaceType.Mattermost,
          channelName: "not a channel",
          url: "https://evil.example/login",
        },
        {
          workspaceType: WorkspaceType.Mattermost,
          channelName: "a Slack link in a Mattermost row",
          url: "https://slack.com/app_redirect?channel=C1&team=T1",
        },
        {
          workspaceType: WorkspaceType.Slack,
          channelName: "a Mattermost link in a Slack row",
          url: "https://chat.example.com/acme/channels/inc-42",
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
