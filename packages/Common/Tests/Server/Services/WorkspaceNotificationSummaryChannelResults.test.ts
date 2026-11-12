import { describe, expect, jest, test } from "@jest/globals";
import { MicrosoftTeamsTeam } from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import {
  Service as WorkspaceNotificationSummaryService,
  WorkspaceSummaryChannelResult,
} from "../../../Server/Services/WorkspaceNotificationSummaryService";
import {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
} from "../../../Server/Utils/Workspace/WorkspaceBase";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

jest.mock("../../../Server/Utils/Logger");

/*
 * #6920: what a workspace summary makes of each workspace's answer for one
 * of its channels (getChannelResult), which channels it posts in
 * (getChannelNamesToPostIn), what Send Test Now answers when a channel
 * did not get it (getTestNotPostedMessage), and which Microsoft Teams teams
 * a summary's Team Name names (getMicrosoftTeamsTeamsNamed). The send
 * itself, through each workspace, is
 * WorkspaceNotificationSummaryChannelErrors.test.ts.
 */

const SLACK_NOT_FOUND: string =
  "The Slack channel #ops was not found. If it is a private channel, invite OneUptime's bot to it in Slack.";

function channel(id: string, name: string = "ops"): WorkspaceChannel {
  return { id: id, name: name, workspaceType: WorkspaceType.Slack };
}

function resultOf(
  responses: Array<WorkspaceSendMessageResponse>,
  workspaceType: WorkspaceType = WorkspaceType.Slack,
  channelName: string = "#ops",
): WorkspaceSummaryChannelResult {
  return WorkspaceNotificationSummaryService.getChannelResult({
    channelName: channelName,
    workspaceType: workspaceType,
    responses: responses,
  });
}

describe("getChannelResult: what became of the summary in a channel", () => {
  test("a message the workspace gave back: posted, with its channel's id and the message's", () => {
    expect(
      resultOf([
        {
          workspaceType: WorkspaceType.Slack,
          threads: [{ channel: channel("C0OPS"), threadId: "1760.0001" }],
          errors: [],
        },
      ]),
    ).toEqual({
      channelName: "#ops",
      isPosted: true,
      channelId: "C0OPS",
      threadId: "1760.0001",
    });
  });

  test("an error the workspace gave: not posted, in its words, with the channel's id when it found the channel", () => {
    expect(
      resultOf([
        {
          workspaceType: WorkspaceType.Slack,
          threads: [],
          errors: [
            {
              channel: channel("C0OPS"),
              error: "Error from Slack is_archived",
            },
          ],
        },
      ]),
    ).toEqual({
      channelName: "#ops",
      isPosted: false,
      channelId: "C0OPS",
      reason: "Error from Slack is_archived",
    });
  });

  test("an error for a channel the workspace did not find has no channel id", () => {
    const result: WorkspaceSummaryChannelResult = resultOf([
      {
        workspaceType: WorkspaceType.MicrosoftTeams,
        threads: [],
        errors: [{ channel: channel(""), error: "Channel not found." }],
      },
    ]);

    expect(result.isPosted).toBe(false);
    expect(result.channelId).toBeUndefined();
  });

  test("an error wins over a message given back with it: a channel that half failed did not get the summary", () => {
    const result: WorkspaceSummaryChannelResult = resultOf([
      {
        workspaceType: WorkspaceType.Slack,
        threads: [{ channel: channel("C0OPS"), threadId: "1760.0001" }],
        errors: [{ channel: channel("C0OPS"), error: "ratelimited" }],
      },
    ]);

    expect(result.isPosted).toBe(false);
    expect(result.reason).toBe("ratelimited");
  });

  test("several errors are said one sentence after another, and the first channel id found is kept", () => {
    expect(
      resultOf([
        {
          workspaceType: WorkspaceType.Slack,
          threads: [],
          errors: [
            { channel: channel(""), error: "Lookup failed" },
            {
              channel: channel("C0OPS"),
              error: "Error from Slack is_archived.",
            },
          ],
        },
        {
          workspaceType: WorkspaceType.Slack,
          threads: [],
          errors: [{ channel: channel("C0OTHER"), error: "Is it there?" }],
        },
      ]),
    ).toEqual({
      channelName: "#ops",
      isPosted: false,
      channelId: "C0OPS",
      reason: "Lookup failed. Error from Slack is_archived. Is it there?",
    });
  });

  test("an error without words is said as a failed send", () => {
    expect(
      resultOf([
        {
          workspaceType: WorkspaceType.Slack,
          threads: [],
          errors: [{ channel: channel("C0OPS"), error: "   " }],
        },
      ]).reason,
    ).toBe("Failed to send message");
  });

  test("a workspace never asked to send (notSentReason) says why", () => {
    expect(
      resultOf([
        {
          workspaceType: WorkspaceType.Slack,
          threads: [],
          notSentReason: "This project is not connected to Slack.",
        },
      ]),
    ).toEqual({
      channelName: "#ops",
      isPosted: false,
      reason: "This project is not connected to Slack.",
    });
  });

  test("Slack saying nothing at all: the channel was not found (Slack leaves out a channel it cannot find)", () => {
    expect(
      resultOf([
        { workspaceType: WorkspaceType.Slack, threads: [], errors: [] },
      ]),
    ).toEqual({
      channelName: "#ops",
      isPosted: false,
      reason: SLACK_NOT_FOUND,
    });
  });

  test("no answer at all is not a send either", () => {
    expect(resultOf([]).isPosted).toBe(false);
    expect(resultOf([]).reason).toBe(SLACK_NOT_FOUND);
  });

  test.each([
    [WorkspaceType.MicrosoftTeams, "Microsoft Teams"],
    [WorkspaceType.Mattermost, "Mattermost"],
  ])(
    "%s saying nothing: not posted, and it did not say why",
    (workspaceType: WorkspaceType, displayName: string) => {
      expect(
        resultOf(
          [{ workspaceType: workspaceType, threads: [], errors: [] }],
          workspaceType,
          "General",
        ).reason,
      ).toBe(
        `Nothing was posted in the ${displayName} channel General, and ${displayName} did not say why.`,
      );
    },
  );
});

describe("getChannelNamesToPostIn: each channel once, in order", () => {
  function namesFor(
    workspaceType: WorkspaceType | undefined,
    channelNames: Array<string>,
  ): Array<string> {
    return WorkspaceNotificationSummaryService.getChannelNamesToPostIn({
      workspaceType: workspaceType,
      channelNames: channelNames,
    });
  }

  test("trims each name and leaves out the empty ones", () => {
    expect(namesFor(WorkspaceType.Slack, [" #ops ", "", "  ", "dev"])).toEqual([
      "#ops",
      "dev",
    ]);
  });

  test("Slack: a name with or without its # is one channel, whatever its case; the first spelling is kept", () => {
    expect(
      namesFor(WorkspaceType.Slack, ["ops", "#ops", "#OPS", "Ops", "#dev"]),
    ).toEqual(["ops", "#dev"]);
  });

  test("Mattermost: # and ~ are left out of the name, as Mattermost looks it up", () => {
    expect(
      namesFor(WorkspaceType.Mattermost, [
        "~town-square",
        "town-square",
        "#Town-Square",
        "off-topic",
      ]),
    ).toEqual(["~town-square", "off-topic"]);
  });

  test("Microsoft Teams: a channel's name is matched whole, whatever its case - a # is part of it", () => {
    expect(
      namesFor(WorkspaceType.MicrosoftTeams, [
        "General",
        "general",
        "#General",
      ]),
    ).toEqual(["General", "#General"]);
  });

  test("Slack's # is not stripped for another workspace, nor Mattermost's ~ for Slack", () => {
    expect(namesFor(WorkspaceType.Slack, ["~ops", "ops"])).toEqual([
      "~ops",
      "ops",
    ]);
    expect(namesFor(undefined, ["#ops", "ops"])).toEqual(["#ops", "ops"]);
  });

  test("a value that is not text is left out", () => {
    expect(
      namesFor(WorkspaceType.Slack, [
        "#ops",
        null as unknown as string,
        42 as unknown as string,
      ]),
    ).toEqual(["#ops"]);
  });

  test("no names: none", () => {
    expect(namesFor(WorkspaceType.Slack, [])).toEqual([]);
  });
});

describe("getTestNotPostedMessage: what Send Test Now answers", () => {
  function posted(channelName: string): WorkspaceSummaryChannelResult {
    return { channelName: channelName, isPosted: true };
  }

  function notPosted(
    channelName: string,
    reason?: string,
  ): WorkspaceSummaryChannelResult {
    return { channelName: channelName, isPosted: false, reason: reason };
  }

  test("the one channel: named, with why", () => {
    expect(
      WorkspaceNotificationSummaryService.getTestNotPostedMessage([
        notPosted("#ops", SLACK_NOT_FOUND),
      ]),
    ).toBe(`The test summary was not posted in #ops. ${SLACK_NOT_FOUND}`);
  });

  test("some of its channels: how many, and each with why, in order", () => {
    expect(
      WorkspaceNotificationSummaryService.getTestNotPostedMessage([
        notPosted("#ops", "Error from Slack is_archived"),
        posted("#dev"),
        notPosted("#sre", "ratelimited"),
      ]),
    ).toBe(
      "The test summary was not posted in 2 of its 3 channels. #ops: Error from Slack is_archived. #sre: ratelimited.",
    );
  });

  test("every channel, for one reason: that reason once", () => {
    const reason: string =
      "This project is not connected to Slack. Please ask a project admin to connect Slack in Project Settings > Workspace > Slack.";

    expect(
      WorkspaceNotificationSummaryService.getTestNotPostedMessage([
        notPosted("#ops", reason),
        notPosted("#dev", reason),
      ]),
    ).toBe(
      `The test summary was not posted in any of its 2 channels. ${reason}`,
    );
  });

  test("every channel, for different reasons: each channel with its own", () => {
    expect(
      WorkspaceNotificationSummaryService.getTestNotPostedMessage([
        notPosted("#ops", "Error from Slack is_archived"),
        notPosted("#dev", "ratelimited"),
      ]),
    ).toBe(
      "The test summary was not posted in any of its 2 channels. #ops: Error from Slack is_archived. #dev: ratelimited.",
    );
  });

  test("one reason shared by some channels but not all that failed is said for each", () => {
    expect(
      WorkspaceNotificationSummaryService.getTestNotPostedMessage([
        notPosted("#ops", "ratelimited"),
        notPosted("#dev", "ratelimited"),
        posted("#sre"),
      ]),
    ).toBe(
      "The test summary was not posted in 2 of its 3 channels. #ops: ratelimited. #dev: ratelimited.",
    );
  });

  test("a reason that ends as a sentence does keeps its end; one without words is a failed send", () => {
    expect(
      WorkspaceNotificationSummaryService.getTestNotPostedMessage([
        notPosted("#ops", "Is the bot in it?"),
        notPosted("#dev", "It was refused!"),
        notPosted("#sre"),
        notPosted("#qa", "  "),
      ]),
    ).toBe(
      "The test summary was not posted in any of its 4 channels. #ops: Is the bot in it? #dev: It was refused! #sre: Failed to send message. #qa: Failed to send message.",
    );
  });
});

describe("getMicrosoftTeamsTeamsNamed: the teams a Microsoft Teams summary's Team Name names", () => {
  const ENGINEERING: MicrosoftTeamsTeam = {
    id: "6920e000-0000-4000-8000-00000000000a",
    name: "Engineering Team",
  };
  const OPERATIONS: MicrosoftTeamsTeam = {
    id: "6920e000-0000-4000-8000-00000000000b",
    name: "Operations",
  };
  const OPERATIONS_TOO: MicrosoftTeamsTeam = {
    id: "6920e000-0000-4000-8000-00000000000c",
    name: " operations ",
  };

  const named: (
    teamName: string,
    teams?: Array<MicrosoftTeamsTeam>,
  ) => Array<string> = (
    teamName: string,
    teams: Array<MicrosoftTeamsTeam> = [ENGINEERING, OPERATIONS],
  ): Array<string> => {
    return WorkspaceNotificationSummaryService.getMicrosoftTeamsTeamsNamed({
      teamName: teamName,
      teams: teams,
    }).map((team: MicrosoftTeamsTeam): string => {
      return team.id;
    });
  };

  test("a team by its name, as Microsoft Teams shows it", () => {
    expect(named("Engineering Team")).toEqual([ENGINEERING.id]);
  });

  test("whatever its case, and the spaces around it", () => {
    expect(named("  engineering TEAM ")).toEqual([ENGINEERING.id]);
  });

  test("a team by its id, in any case", () => {
    expect(named(OPERATIONS.id.toUpperCase())).toEqual([OPERATIONS.id]);
  });

  test("an id names its team, even where another team is called by that id", () => {
    const calledByAnId: MicrosoftTeamsTeam = {
      id: "6920e000-0000-4000-8000-0000000000dd",
      name: ENGINEERING.id,
    };

    expect(named(ENGINEERING.id, [calledByAnId, ENGINEERING])).toEqual([
      ENGINEERING.id,
    ]);
  });

  test("every team of a name two teams share", () => {
    expect(
      named("OPERATIONS", [ENGINEERING, OPERATIONS, OPERATIONS_TOO]),
    ).toEqual([OPERATIONS.id, OPERATIONS_TOO.id]);
  });

  test("none for a name no team has, a part of a name, or no name", () => {
    expect(named("Enginering")).toEqual([]);
    expect(named("Engineering")).toEqual([]);
    expect(named("")).toEqual([]);
    expect(named("   ")).toEqual([]);
  });

  test("a team kept without an id or a name is passed over", () => {
    expect(
      named("Operations", [
        { id: "", name: "Operations" },
        { id: OPERATIONS.id } as MicrosoftTeamsTeam,
        OPERATIONS,
      ]),
    ).toEqual([OPERATIONS.id]);
    expect(named("Operations", [])).toEqual([]);
  });
});
