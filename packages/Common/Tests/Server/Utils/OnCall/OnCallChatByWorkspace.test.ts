import OnCallDutyPolicyEscalationRuleSchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import UserService from "../../../../Server/Services/UserService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import logger from "../../../../Server/Utils/Logger";
import OnCallChatByWorkspace, {
  OnCallChatTextByWorkspaceType,
  OnCallChatWriter,
  ON_CALL_CHAT_NOBODY_NAMED,
} from "../../../../Server/Utils/OnCall/OnCallChatByWorkspace";
import OnCallChatText, {
  ON_CALL_CHAT_INVITEE_UNNAMED,
} from "../../../../Server/Utils/OnCall/OnCallChatText";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import MattermostUtil from "../../../../Server/Utils/Workspace/Mattermost/Mattermost";
import FeedPersonName from "../../../../Server/Utils/Feed/FeedPersonName";
import WorkspaceUtil from "../../../../Server/Utils/Workspace/Workspace";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import Timezone from "../../../../Types/Timezone";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../Utils/Markdown/FeedMarkdown";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * AN ON-CALL LINE, AS EACH CONNECTED WORKSPACE READS IT (#7967, #7970).
 *
 * In one on-call channel the same person read "@ana.lee" in a hand-off's
 * line and "Ana Lee" in the next override's: only the hand-off lines named
 * people as each workspace knows them. Every on-call line now writes its
 * people and its moments through OnCallChatByWorkspace:
 *
 *   - a person is "@name" where they connected their account in that
 *     workspace, their OneUptime name, a link, where they did not;
 *   - each name is asked once per workspace, however many lines name them;
 *   - Slack and Microsoft Teams show a moment in each reader's own zone,
 *     Mattermost in words on the policy's zone's clock, or UTC's;
 *   - a line is written only for the workspaces the project connected, and
 *     nothing it cannot read or write stops the line from being posted.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "79670000-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "79670000-0000-4000-8000-000000000002",
);
const ANA: ObjectID = new ObjectID("79670000-0000-4000-8000-0000000000a1");
const BOB: ObjectID = new ObjectID("79670000-0000-4000-8000-0000000000b1");

const POLICY_LINK: string =
  "https://oneuptime.test/dashboard/p/on-call-duty/policies/2";

// Saturday 14 November 2026, 22:50 UTC: 5:50 PM in New York.
const AT: Date = new Date("2026-11-14T22:50:00.000Z");

const POLICY: MarkdownText = OnCallChatText.policy({
  name: "Payments",
  link: POLICY_LINK,
});

function connect(
  auths: Array<{ workspaceType?: WorkspaceType; authToken?: string }>,
): void {
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
    .mockResolvedValue(
      auths.map(
        (auth: {
          workspaceType?: WorkspaceType;
          authToken?: string;
        }): WorkspaceProjectAuthToken => {
          const token: WorkspaceProjectAuthToken =
            new WorkspaceProjectAuthToken();

          if (auth.workspaceType) {
            token.workspaceType = auth.workspaceType;
          }

          if (auth.authToken) {
            token.authToken = auth.authToken;
          }

          return token;
        },
      ),
    );
}

function schedulesIn(zones: Array<string | undefined>): void {
  jest
    .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
    .mockResolvedValue(
      zones.map((zone: string | undefined) => {
        const row: OnCallDutyPolicyEscalationRuleSchedule =
          new OnCallDutyPolicyEscalationRuleSchedule();
        const schedule: OnCallDutyPolicySchedule =
          new OnCallDutyPolicySchedule();

        if (zone) {
          schedule.timezone = zone as Timezone;
        }

        row.onCallDutyPolicySchedule = schedule;

        return row;
      }) as never,
    );
}

beforeEach(() => {
  jest
    .spyOn(OneUptimeDate, "getCurrentDate")
    .mockReturnValue(new Date("2026-11-13T12:00:00.000Z"));

  // Ana connected Slack and Mattermost; Bob connected nothing.
  jest
    .spyOn(WorkspaceUtil, "getUserStringForWorkspace")
    .mockImplementation((async (data: {
      userId: ObjectID;
      workspaceType: WorkspaceType;
    }): Promise<string> => {
      if (data.userId.toString() === ANA.toString()) {
        return data.workspaceType === WorkspaceType.MicrosoftTeams
          ? "[Ana Lee](https://oneuptime.test/users/ana) "
          : "@ana.lee ";
      }

      return "[Bob Ito](https://oneuptime.test/users/bob) ";
    }) as never);
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockImplementation((async (data: {
      userId: ObjectID;
    }): Promise<MarkdownText> => {
      return data.userId.toString() === ANA.toString()
        ? mdText`[Ana Lee](https://oneuptime.test/users/ana)`
        : FeedMarkdown.empty();
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which workspaces get a line", () => {
  test("each workspace the project connected, once, in the order connected", async () => {
    connect([
      { workspaceType: WorkspaceType.Slack, authToken: "a" },
      { workspaceType: WorkspaceType.Mattermost, authToken: "b" },
      // A second connection of the same kind is the same workspace's.
      { workspaceType: WorkspaceType.Slack, authToken: "c" },
    ]);

    const chat: OnCallChatByWorkspace = new OnCallChatByWorkspace({
      projectId: PROJECT_ID,
    });

    expect(await chat.getWorkspaceTypes()).toEqual([
      WorkspaceType.Slack,
      WorkspaceType.Mattermost,
    ]);
    // Read once, however often asked.
    await chat.getWorkspaceTypes();
    expect(
      WorkspaceProjectAuthTokenService.getProjectAuths,
    ).toHaveBeenCalledTimes(1);
  });

  test("a connection with no token, or no workspace, gets none", async () => {
    connect([
      { workspaceType: WorkspaceType.Slack },
      { authToken: "a" },
      { workspaceType: WorkspaceType.MicrosoftTeams, authToken: "b" },
    ]);

    expect(
      await new OnCallChatByWorkspace({
        projectId: PROJECT_ID,
      }).getWorkspaceTypes(),
    ).toEqual([WorkspaceType.MicrosoftTeams]);
  });

  test("connections that cannot be read: no line of its own anywhere, and nothing thrown", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
      .mockRejectedValue(new Error("database down"));

    const chat: OnCallChatByWorkspace = new OnCallChatByWorkspace({
      projectId: PROJECT_ID,
    });

    expect(await chat.getWorkspaceTypes()).toEqual([]);
    expect(
      await chat.write((): MarkdownText => {
        return mdText`never written`;
      }),
    ).toEqual({});
  });
});

describe("how each workspace names a person", () => {
  test("REGRESSION (#7967): @name where they connected that workspace, their OneUptime name where they did not", async () => {
    connect([
      { workspaceType: WorkspaceType.Slack, authToken: "a" },
      { workspaceType: WorkspaceType.MicrosoftTeams, authToken: "b" },
    ]);

    const lines: OnCallChatTextByWorkspaceType =
      await new OnCallChatByWorkspace({ projectId: PROJECT_ID }).write(
        async (writer: OnCallChatWriter): Promise<MarkdownText> => {
          return OnCallChatText.overrideRemoved({
            policy: POLICY,
            person: await writer.nameOf(ANA),
          });
        },
      );

    expect(lines).toEqual({
      [WorkspaceType.Slack]: `❌ Removed an override on [Payments](${POLICY_LINK}): @ana.lee is paged on their turns again.`,
      [WorkspaceType.MicrosoftTeams]: `❌ Removed an override on [Payments](${POLICY_LINK}): [Ana Lee](https://oneuptime.test/users/ana) is paged on their turns again.`,
    });
  });

  test("each person's name in each workspace is asked once, for every line", async () => {
    connect([{ workspaceType: WorkspaceType.Slack, authToken: "a" }]);

    const chat: OnCallChatByWorkspace = new OnCallChatByWorkspace({
      projectId: PROJECT_ID,
    });

    for (let line: number = 0; line < 3; line++) {
      await chat.write(
        async (writer: OnCallChatWriter): Promise<MarkdownText> => {
          return mdText`${await writer.nameOf(ANA)} ${await writer.nameOf(BOB)} ${await writer.nameOf(new ObjectID(ANA.toString().toUpperCase()))}`;
        },
      );
    }

    // Ana (in either case) and Bob, in Slack.
    expect(WorkspaceUtil.getUserStringForWorkspace).toHaveBeenCalledTimes(2);
  });

  test("with no workspace, OneUptime's name; with no name at all, Somebody", async () => {
    const chat: OnCallChatByWorkspace = new OnCallChatByWorkspace({
      projectId: PROJECT_ID,
    });

    expect((await chat.nameIn(null)(ANA)).toString()).toBe(
      "[Ana Lee](https://oneuptime.test/users/ana)",
    );
    expect((await chat.nameIn(null)(BOB)).toString()).toBe(
      ON_CALL_CHAT_NOBODY_NAMED,
    );
    expect(WorkspaceUtil.getUserStringForWorkspace).not.toHaveBeenCalled();
  });

  describe("someone only invited to the project (#10616)", () => {
    const IVY: ObjectID = new ObjectID("79670000-0000-4000-8000-0000000000c1");

    // The name typed with Ivy's invitation; undefined: she is no invitee.
    let typed: string | null | undefined;

    beforeEach(() => {
      typed = "Ivy";
      jest
        .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
        .mockImplementation((async (data: {
          userIds: Array<string>;
        }): Promise<Map<string, WithheldProfile>> => {
          const withheld: Map<string, WithheldProfile> = new Map<
            string,
            WithheldProfile
          >();

          if (typed !== undefined && data.userIds.includes(IVY.toString())) {
            withheld.set(IVY.toString().toLowerCase(), {
              inviteeName: typed,
              inviteeEmail: "ivy@invited.test",
            });
          }

          return withheld;
        }) as never);
      // As main named her: the address she was invited at (#10175).
      jest
        .spyOn(WorkspaceUtil, "getUserStringForWorkspace")
        .mockResolvedValue(
          "[ivy@invited.test](https://oneuptime.test/users/ivy) " as never,
        );
      jest
        .spyOn(UserService, "getUserMarkdownString")
        .mockResolvedValue(
          mdText`[ivy@invited.test](https://oneuptime.test/users/ivy)` as never,
        );
    });

    test("REGRESSION: the name typed with her invitation, as text, in every workspace and with none - never the address she was invited at", async () => {
      connect([
        { workspaceType: WorkspaceType.Slack, authToken: "a" },
        { workspaceType: WorkspaceType.MicrosoftTeams, authToken: "b" },
        { workspaceType: WorkspaceType.Mattermost, authToken: "c" },
      ]);

      const chat: OnCallChatByWorkspace = new OnCallChatByWorkspace({
        projectId: PROJECT_ID,
      });

      const lines: OnCallChatTextByWorkspaceType = await chat.write(
        async (writer: OnCallChatWriter): Promise<MarkdownText> => {
          return OnCallChatText.overrideRemoved({
            policy: POLICY,
            person: await writer.nameOf(IVY),
          });
        },
      );

      const line: string = `❌ Removed an override on [Payments](${POLICY_LINK}): Ivy is paged on their turns again.`;

      expect(lines).toEqual({
        [WorkspaceType.Slack]: line,
        [WorkspaceType.MicrosoftTeams]: line,
        [WorkspaceType.Mattermost]: line,
      });
      expect((await chat.nameIn(null)(IVY)).toString()).toBe("Ivy");
      // Neither the workspace nor OneUptime is asked how to name her.
      expect(WorkspaceUtil.getUserStringForWorkspace).not.toHaveBeenCalled();
      expect(UserService.getUserMarkdownString).not.toHaveBeenCalled();
    });

    test.each([
      ["no name typed", null],
      ["only spaces typed", "   "],
      ["an address typed as her name", "ivy@invited.test"],
      ["a name with an address in it", "Ivy <ivy@invited.test>"],
    ])(
      "REGRESSION: %s - 'someone who hasn't joined the project yet'",
      async (_why: string, name: string | null) => {
        typed = name;

        const chat: OnCallChatByWorkspace = new OnCallChatByWorkspace({
          projectId: PROJECT_ID,
        });

        for (const workspaceType of [WorkspaceType.Slack, null]) {
          const named: string = (
            await chat.nameIn(workspaceType)(IVY)
          ).toString();

          expect(named).toBe(ON_CALL_CHAT_INVITEE_UNNAMED);
          expect(named).not.toContain("invited.test");
        }
      },
    );

    test("whether she is only invited is read once for the whole change, however many workspaces and lines name her", async () => {
      connect([
        { workspaceType: WorkspaceType.Slack, authToken: "a" },
        { workspaceType: WorkspaceType.Mattermost, authToken: "b" },
      ]);

      const chat: OnCallChatByWorkspace = new OnCallChatByWorkspace({
        projectId: PROJECT_ID,
      });

      for (let line: number = 0; line < 2; line++) {
        await chat.write(
          async (writer: OnCallChatWriter): Promise<MarkdownText> => {
            return mdText`${await writer.nameOf(IVY)} ${await writer.nameOf(new ObjectID(IVY.toString().toUpperCase()))}`;
          },
        );
        await chat.nameIn(null)(IVY);
      }

      expect(
        PendingInviteeProfiles.readWithheldProfilesInProject,
      ).toHaveBeenCalledTimes(1);
      expect(
        PendingInviteeProfiles.readWithheldProfilesInProject,
      ).toHaveBeenCalledWith({
        userIds: [IVY.toString()],
        projectId: PROJECT_ID,
      });
    });

    test("a member is asked of the workspace and of OneUptime as before", async () => {
      typed = undefined;

      const chat: OnCallChatByWorkspace = new OnCallChatByWorkspace({
        projectId: PROJECT_ID,
      });

      expect((await chat.nameIn(WorkspaceType.Slack)(IVY)).toString()).toBe(
        "[ivy@invited.test](https://oneuptime.test/users/ivy)",
      );
      expect((await chat.nameIn(null)(IVY)).toString()).toBe(
        "[ivy@invited.test](https://oneuptime.test/users/ivy)",
      );
    });

    test("whether she is only invited could not be read: Somebody, never what could be her address - and logged", async () => {
      jest
        .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
        .mockRejectedValue(new Error("database down") as never);

      const chat: OnCallChatByWorkspace = new OnCallChatByWorkspace({
        projectId: PROJECT_ID,
      });

      expect((await chat.nameIn(WorkspaceType.Slack)(IVY)).toString()).toBe(
        ON_CALL_CHAT_NOBODY_NAMED,
      );
      expect((await chat.nameIn(null)(IVY)).toString()).toBe(
        ON_CALL_CHAT_NOBODY_NAMED,
      );
      expect(UserService.getUserMarkdownString).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        "Could not read whether somebody a feed entry or channel line names is only invited to the project; the line names them as Somebody.",
        expect.anything(),
      );
    });

    test("the name typed is text: it links nowhere and mentions nobody", async () => {
      typed = "[Click](https://evil.test) <!channel> **Ivy**";

      const named: string = (
        await new OnCallChatByWorkspace({ projectId: PROJECT_ID }).nameIn(
          WorkspaceType.Slack,
        )(IVY)
      ).toString();

      expect(named).toBe(mdText`${typed}`.toString());
      expect(named).not.toContain("[Click](https://evil.test)");
      expect(named).not.toContain("<!channel>");
    });
  });

  /*
   * The rule an on-call line names an invitee by is every feed entry's and
   * channel line's (FeedPersonName; its own tests hold getDisplayName and
   * getInviteeName): one rule, and one set of words.
   */
  test("the names an on-call line gives an invitee are the shared rule's", () => {
    expect(
      FeedPersonName.getInviteeName({
        inviteeName: " Ivy ",
        inviteeEmail: "ivy@invited.test",
      }),
    ).toBe("Ivy");

    for (const inviteeName of [null, "", "  ", "ivy@invited.test"]) {
      expect(
        FeedPersonName.getInviteeName({
          inviteeName: inviteeName,
          inviteeEmail: "ivy@invited.test",
        }),
      ).toBe(ON_CALL_CHAT_INVITEE_UNNAMED);
    }

    expect(ON_CALL_CHAT_INVITEE_UNNAMED).toBe(
      "someone who hasn't joined the project yet",
    );
  });

  test("Mattermost's @name pings nobody: the post breaks it, as every name in an on-call line", async () => {
    connect([{ workspaceType: WorkspaceType.Mattermost, authToken: "a" }]);

    const lines: OnCallChatTextByWorkspaceType =
      await new OnCallChatByWorkspace({ projectId: PROJECT_ID }).write(
        async (writer: OnCallChatWriter): Promise<MarkdownText> => {
          return OnCallChatText.overrideRemoved({
            policy: POLICY,
            person: await writer.nameOf(ANA),
          });
        },
      );

    const posted: string = MattermostUtil.getMessageText(
      lines[WorkspaceType.Mattermost] || "",
    );

    expect(posted).toContain("@⁠ana.lee is paged");
    expect(posted).not.toMatch(/@ana\.lee/);
  });
});

describe("how each workspace says a moment", () => {
  async function overrideLines(
    chat: OnCallChatByWorkspace,
  ): Promise<OnCallChatTextByWorkspaceType> {
    return await chat.write(
      async (writer: OnCallChatWriter): Promise<MarkdownText> => {
        return OnCallChatText.overrideAdded({
          policy: POLICY,
          person: await writer.nameOf(ANA),
          cover: await writer.nameOf(BOB),
          from: AT,
          until: new Date("2026-11-15T22:50:00.000Z"),
          moment: writer.moment,
        });
      },
    );
  }

  beforeEach(() => {
    connect([
      { workspaceType: WorkspaceType.Slack, authToken: "a" },
      { workspaceType: WorkspaceType.MicrosoftTeams, authToken: "b" },
      { workspaceType: WorkspaceType.Mattermost, authToken: "c" },
    ]);
  });

  test("Slack and Teams in each reader's own zone; Mattermost in words on the zone given (#7970)", async () => {
    const lines: OnCallChatTextByWorkspaceType = await overrideLines(
      new OnCallChatByWorkspace({
        projectId: PROJECT_ID,
        timezone: Timezone.AmericaNew_York,
      }),
    );

    for (const workspaceType of [
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
    ]) {
      expect(lines[workspaceType]).toContain(
        "from {{DATE(2026-11-14T22:50:00Z, SHORT)}} at {{TIME(2026-11-14T22:50:00Z)}} to {{DATE(2026-11-15T22:50:00Z, SHORT)}} at {{TIME(2026-11-15T22:50:00Z)}}.",
      );
    }

    expect(lines[WorkspaceType.Mattermost]).toBe(
      `🔁 Added an override on [Payments](${POLICY_LINK}): [Bob Ito](https://oneuptime.test/users/bob) covers for @ana.lee from Sat, Nov 14 at 5:50 PM EST to Sun, Nov 15 at 5:50 PM EST.`,
    );
  });

  test("an override's line reads in its policy's zone in Mattermost: the zone its schedules share", async () => {
    schedulesIn(["America/New_York", "America/New_York"]);

    const lines: OnCallChatTextByWorkspaceType = await overrideLines(
      new OnCallChatByWorkspace({
        projectId: PROJECT_ID,
        onCallDutyPolicyId: POLICY_ID,
      }),
    );

    expect(lines[WorkspaceType.Mattermost]).toContain(
      "from Sat, Nov 14 at 5:50 PM EST to Sun, Nov 15 at 5:50 PM EST.",
    );
    // Its schedules are read once, for the policy it is.
    expect(
      OnCallDutyPolicyEscalationRuleScheduleService.findBy,
    ).toHaveBeenCalledTimes(1);
    expect(
      (
        OnCallDutyPolicyEscalationRuleScheduleService.findBy as unknown as jest.Mock
      ).mock.calls[0]![0],
    ).toMatchObject({ query: { onCallDutyPolicyId: POLICY_ID } });
  });

  test("a policy whose schedules hand off in different zones, or pages none, reads in UTC", async () => {
    for (const zones of [
      ["America/New_York", "Europe/London"],
      [],
      // A schedule set in no zone hands off in UTC: not the other's zone.
      ["America/New_York", undefined],
    ]) {
      schedulesIn(zones);

      const lines: OnCallChatTextByWorkspaceType = await overrideLines(
        new OnCallChatByWorkspace({
          projectId: PROJECT_ID,
          onCallDutyPolicyId: POLICY_ID,
        }),
      );

      expect(lines[WorkspaceType.Mattermost]).toContain(
        "from Sat, Nov 14 at 10:50 PM UTC to Sun, Nov 15 at 10:50 PM UTC.",
      );
    }
  });

  test("schedules that cannot be read: UTC, and the line is still written", async () => {
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
      .mockRejectedValue(new Error("database down"));

    const lines: OnCallChatTextByWorkspaceType = await overrideLines(
      new OnCallChatByWorkspace({
        projectId: PROJECT_ID,
        onCallDutyPolicyId: POLICY_ID,
      }),
    );

    expect(lines[WorkspaceType.Mattermost]).toContain("10:50 PM UTC");
    expect(lines[WorkspaceType.Slack]).toContain("{{TIME(");
  });

  test("the policy's schedules are read only for Mattermost: a project without it reads none", async () => {
    connect([{ workspaceType: WorkspaceType.Slack, authToken: "a" }]);
    schedulesIn(["America/New_York"]);

    await overrideLines(
      new OnCallChatByWorkspace({
        projectId: PROJECT_ID,
        onCallDutyPolicyId: POLICY_ID,
      }),
    );

    expect(
      OnCallDutyPolicyEscalationRuleScheduleService.findBy,
    ).not.toHaveBeenCalled();
  });

  test("a zone given wins: the policy's schedules are not read", async () => {
    schedulesIn(["Europe/London"]);

    const lines: OnCallChatTextByWorkspaceType = await overrideLines(
      new OnCallChatByWorkspace({
        projectId: PROJECT_ID,
        timezone: Timezone.AmericaNew_York,
        onCallDutyPolicyId: POLICY_ID,
      }),
    );

    expect(lines[WorkspaceType.Mattermost]).toContain("5:50 PM EST");
    expect(
      OnCallDutyPolicyEscalationRuleScheduleService.findBy,
    ).not.toHaveBeenCalled();
  });
});

describe("a line that cannot be written for a workspace", () => {
  test("is left out for that workspace only: it hears the line with OneUptime's names", async () => {
    connect([
      { workspaceType: WorkspaceType.Slack, authToken: "a" },
      { workspaceType: WorkspaceType.Mattermost, authToken: "b" },
    ]);

    const lines: OnCallChatTextByWorkspaceType =
      await new OnCallChatByWorkspace({ projectId: PROJECT_ID }).write(
        (writer: OnCallChatWriter): MarkdownText => {
          if (writer.workspaceType === WorkspaceType.Slack) {
            throw new Error("Slack names could not be read");
          }

          return mdText`line for ${writer.workspaceType}`;
        },
      );

    expect(lines).toEqual({
      [WorkspaceType.Mattermost]: "line for Mattermost",
    });
  });

  test("an empty line is no line", async () => {
    connect([{ workspaceType: WorkspaceType.Slack, authToken: "a" }]);

    expect(
      await new OnCallChatByWorkspace({ projectId: PROJECT_ID }).write(
        (): MarkdownText => {
          return FeedMarkdown.empty();
        },
      ),
    ).toEqual({});
  });
});
