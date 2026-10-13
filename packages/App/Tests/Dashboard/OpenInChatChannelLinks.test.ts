import { describe, expect, test } from "@jest/globals";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  WorkspaceChannelLink,
  WorkspaceChannelRecordType,
} from "Common/Types/Workspace/WorkspaceChannelLink";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import {
  CHANNEL_LINK_RECHECK_DELAYS_MS,
  CHANNEL_LINK_RECHECK_WINDOW_MS,
  CHANNEL_LINK_TEXT,
  ChannelLinkGroup,
  getChannelLinkGroups,
  getChannelLinkLabel,
  getChannelLinkMenuLabel,
  getWorkspaceName,
  getChannelLinkRecheckDelay,
  getChannelLinkRoute,
} from "../../FeatureSet/Dashboard/src/Components/Workspace/ChannelLinks";

/*
 * The rules behind a record page's "Open in Slack" / "Open in Microsoft
 * Teams" buttons: one button per workspace the record has a channel in,
 * Slack first; a channel named as people write it; and a new record's page
 * looking again for a channel a rule is still creating, then stopping.
 */

const slack: (name: string, channel?: string) => WorkspaceChannelLink = (
  name: string,
  channel?: string,
): WorkspaceChannelLink => {
  return {
    workspaceType: WorkspaceType.Slack,
    channelName: name,
    url: `https://slack.com/app_redirect?channel=${channel || "C1"}&team=T1`,
  };
};

const teams: (name: string) => WorkspaceChannelLink = (
  name: string,
): WorkspaceChannelLink => {
  return {
    workspaceType: WorkspaceType.MicrosoftTeams,
    channelName: name,
    url: `https://teams.microsoft.com/l/channel/x/${encodeURIComponent(name)}?groupId=3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b`,
  };
};

describe("one button per workspace", () => {
  test("no channel, no button", () => {
    expect(getChannelLinkGroups([])).toEqual([]);
  });

  test("Slack first, whatever order the channels came in", () => {
    const groups: Array<ChannelLinkGroup> = getChannelLinkGroups([
      teams("Incident 42"),
      slack("incident-42"),
    ]);

    expect(
      groups.map((group: ChannelLinkGroup) => {
        return group.workspaceType;
      }),
    ).toEqual([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]);
  });

  test("each button says where it goes and carries its product's icon", () => {
    const [slackGroup, teamsGroup] = getChannelLinkGroups([
      slack("incident-42"),
      teams("Incident 42"),
    ]);

    expect(slackGroup!.label).toBe("Open in Slack");
    expect(slackGroup!.label).toBe(CHANNEL_LINK_TEXT.openInSlack);
    expect(slackGroup!.icon).toBe(IconProp.Slack);

    expect(teamsGroup!.label).toBe("Open in Microsoft Teams");
    expect(teamsGroup!.label).toBe(CHANNEL_LINK_TEXT.openInMicrosoftTeams);
    expect(teamsGroup!.icon).toBe(IconProp.MicrosoftTeams);
  });

  test("a record with two Slack channels gets one Open in Slack holding both, in order", () => {
    const groups: Array<ChannelLinkGroup> = getChannelLinkGroups([
      slack("incident-42", "C1"),
      teams("Incident 42"),
      slack("sre-war-room", "C2"),
    ]);

    expect(groups).toHaveLength(2);
    expect(
      groups[0]!.links.map((link: WorkspaceChannelLink) => {
        return link.channelName;
      }),
    ).toEqual(["incident-42", "sre-war-room"]);
    expect(groups[1]!.links).toHaveLength(1);
  });

  test("only Teams: a Teams button alone", () => {
    expect(
      getChannelLinkGroups([teams("Incident 42")]).map(
        (group: ChannelLinkGroup) => {
          return group.label;
        },
      ),
    ).toEqual(["Open in Microsoft Teams"]);
  });

  test("a workspace with no button of its own is left out", () => {
    expect(
      getChannelLinkGroups([
        {
          workspaceType: "Discord" as WorkspaceType,
          channelName: "x",
          url: "https://discord.com/x",
        },
      ]),
    ).toEqual([]);
  });
});

describe("a channel as people write it", () => {
  test.each<[WorkspaceChannelLink, string]>([
    [slack("incident-42-checkout"), "#incident-42-checkout"],
    [slack("#already-hashed"), "#already-hashed"],
    [slack("  spaced  "), "#spaced"],
    [slack(""), "#channel"],
    [teams("Incident 42 - checkout"), "Incident 42 - checkout"],
    [teams(" "), "Channel"],
  ])("%p reads %p", (link: WorkspaceChannelLink, expected: string) => {
    expect(getChannelLinkLabel(link)).toBe(expected);
  });
});

describe("a menu that mixes Slack and Teams", () => {
  test("names each channel's product first, by the product's own name", () => {
    expect(getWorkspaceName(WorkspaceType.Slack)).toBe("Slack");
    expect(getWorkspaceName(WorkspaceType.MicrosoftTeams)).toBe(
      "Microsoft Teams",
    );
    expect(getChannelLinkMenuLabel(slack("incident-42"))).toBe(
      "Slack · #incident-42",
    );
    expect(getChannelLinkMenuLabel(teams("Incident 42"))).toBe(
      "Microsoft Teams · Incident 42",
    );
  });

  test("the merged button's words are a key of their own", () => {
    expect(CHANNEL_LINK_TEXT.openChannel).toBe("Open channel");
  });
});

describe("where the page asks", () => {
  test.each(Object.values(WorkspaceChannelRecordType))(
    "a %s's links are at its own route",
    (recordType: WorkspaceChannelRecordType) => {
      const recordId: ObjectID = new ObjectID(
        "11111111-1111-4111-8111-111111111111",
      );

      expect(getChannelLinkRoute({ recordType, recordId })).toBe(
        `/workspace-channel-link/${recordType}/11111111-1111-4111-8111-111111111111`,
      );
    },
  );
});

describe("looking again while a rule is still creating the channel", () => {
  const NOW: Date = new Date("2026-10-13T09:00:00.000Z");
  const secondsAgo: (seconds: number) => Date = (seconds: number): Date => {
    return new Date(NOW.getTime() - seconds * 1000);
  };

  test("a new record without a channel is looked at again, sooner first", () => {
    const delays: Array<number | null> = [0, 1, 2, 3, 4].map(
      (attempt: number) => {
        return getChannelLinkRecheckDelay({
          recordStartedAt: secondsAgo(5),
          now: NOW,
          linkCount: 0,
          attempt,
        });
      },
    );

    expect(delays).toEqual([...CHANNEL_LINK_RECHECK_DELAYS_MS, null]);
    // Each wait is longer than the last, and they stop within a minute.
    for (
      let index: number = 1;
      index < CHANNEL_LINK_RECHECK_DELAYS_MS.length;
      index++
    ) {
      expect(CHANNEL_LINK_RECHECK_DELAYS_MS[index]!).toBeGreaterThan(
        CHANNEL_LINK_RECHECK_DELAYS_MS[index - 1]!,
      );
    }
    expect(
      CHANNEL_LINK_RECHECK_DELAYS_MS.reduce((total: number, delay: number) => {
        return total + delay;
      }, 0),
    ).toBeLessThanOrEqual(60 * 1000);
  });

  test("a record that has its channel is not looked at again", () => {
    expect(
      getChannelLinkRecheckDelay({
        recordStartedAt: secondsAgo(5),
        now: NOW,
        linkCount: 1,
        attempt: 0,
      }),
    ).toBeNull();
  });

  test("an older record without a channel has no rule that makes one: no second look", () => {
    expect(
      getChannelLinkRecheckDelay({
        recordStartedAt: new Date(
          NOW.getTime() - CHANNEL_LINK_RECHECK_WINDOW_MS - 1000,
        ),
        now: NOW,
        linkCount: 0,
        attempt: 0,
      }),
    ).toBeNull();
  });

  test("a record started just inside the window is still new", () => {
    expect(
      getChannelLinkRecheckDelay({
        recordStartedAt: new Date(
          NOW.getTime() - CHANNEL_LINK_RECHECK_WINDOW_MS + 1000,
        ),
        now: NOW,
        linkCount: 0,
        attempt: 0,
      }),
    ).toBe(CHANNEL_LINK_RECHECK_DELAYS_MS[0]);
  });

  test("a clock a little ahead still counts the record as new; one far ahead does not", () => {
    expect(
      getChannelLinkRecheckDelay({
        recordStartedAt: new Date(NOW.getTime() + 30 * 1000),
        now: NOW,
        linkCount: 0,
        attempt: 0,
      }),
    ).toBe(CHANNEL_LINK_RECHECK_DELAYS_MS[0]);

    expect(
      getChannelLinkRecheckDelay({
        recordStartedAt: new Date(NOW.getTime() + 10 * 60 * 1000),
        now: NOW,
        linkCount: 0,
        attempt: 0,
      }),
    ).toBeNull();
  });

  test("a page that does not know when the record started does not look again", () => {
    expect(
      getChannelLinkRecheckDelay({
        recordStartedAt: undefined,
        now: NOW,
        linkCount: 0,
        attempt: 0,
      }),
    ).toBeNull();
    expect(
      getChannelLinkRecheckDelay({
        recordStartedAt: new Date("not a date"),
        now: NOW,
        linkCount: 0,
        attempt: 0,
      }),
    ).toBeNull();
  });
});
