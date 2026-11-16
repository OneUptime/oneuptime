import { describe, expect, test } from "@jest/globals";
import StatusPageSubscriberChannel, {
  DEFAULT_STATUS_PAGE_SUBSCRIBER_CHANNEL,
  MOVED_SUBSCRIBER_LIST_PATHS,
  STATUS_PAGE_SUBSCRIBERS_PAGE_PATH,
  STATUS_PAGE_SUBSCRIBER_CHANNELS,
  STATUS_PAGE_SUBSCRIBER_CHANNEL_QUERY_PARAM,
  getStatusPageSubscriberChannelForUnsubscribeChannel,
  getStatusPageSubscriberChannelQuery,
  readStatusPageSubscriberChannel,
} from "../../../Types/StatusPage/StatusPageSubscriberChannel";
import { StatusPageSubscriberUnsubscribeChannel } from "../../../Types/StatusPage/StatusPageSubscriberUnsubscribe";

/*
 * A status page's subscribers are one Subscribers page with a tab per
 * channel (#9125), where they were five pages. This vocabulary names the
 * tabs in the address, and the five old addresses each forward to its tab.
 */

describe("the channels", () => {
  test("are the five tabs, in the order the Subscribe page offers them, Email first", () => {
    expect([...STATUS_PAGE_SUBSCRIBER_CHANNELS]).toEqual([
      "email",
      "sms",
      "slack",
      "microsoft-teams",
      "webhook",
    ]);
    expect(DEFAULT_STATUS_PAGE_SUBSCRIBER_CHANNEL).toBe(
      StatusPageSubscriberChannel.Email,
    );
    expect(STATUS_PAGE_SUBSCRIBER_CHANNEL_QUERY_PARAM).toBe("channel");
    expect(STATUS_PAGE_SUBSCRIBERS_PAGE_PATH).toBe("subscribers");
  });

  test.each([
    ["sms", StatusPageSubscriberChannel.SMS],
    ["  Microsoft-Teams ", StatusPageSubscriberChannel.MicrosoftTeams],
    ["WEBHOOK", StatusPageSubscriberChannel.Webhook],
    ["email", StatusPageSubscriberChannel.Email],
  ])("reads %p as its channel", (value: string, channel: string) => {
    expect(readStatusPageSubscriberChannel(value)).toBe(channel);
  });

  test.each([[null], [undefined], [""], ["teams"], ["email-subscribers"]])(
    "reads %p as no channel, so the page opens on Email",
    (value: string | null | undefined) => {
      expect(readStatusPageSubscriberChannel(value)).toBeNull();
    },
  );

  test("opens the first tab at the bare address, and every other with its channel", () => {
    expect(
      getStatusPageSubscriberChannelQuery(StatusPageSubscriberChannel.Email),
    ).toEqual({});

    for (const channel of STATUS_PAGE_SUBSCRIBER_CHANNELS.slice(1)) {
      expect(getStatusPageSubscriberChannelQuery(channel)).toEqual({
        channel: channel,
      });
    }
  });
});

describe("the old per-channel addresses", () => {
  test("are the five pages the tabs replaced, each forwarding to its own tab", () => {
    expect(MOVED_SUBSCRIBER_LIST_PATHS).toEqual({
      "email-subscribers": StatusPageSubscriberChannel.Email,
      "sms-subscribers": StatusPageSubscriberChannel.SMS,
      "slack-subscribers": StatusPageSubscriberChannel.Slack,
      "microsoft-teams-subscribers": StatusPageSubscriberChannel.MicrosoftTeams,
      "webhook-subscribers": StatusPageSubscriberChannel.Webhook,
    });
  });

  test("cover every channel once", () => {
    expect(Object.values(MOVED_SUBSCRIBER_LIST_PATHS).sort()).toEqual(
      [...STATUS_PAGE_SUBSCRIBER_CHANNELS].sort(),
    );
  });
});

describe("the server's emails", () => {
  test.each([
    [
      StatusPageSubscriberUnsubscribeChannel.Email,
      StatusPageSubscriberChannel.Email,
    ],
    [
      StatusPageSubscriberUnsubscribeChannel.SMS,
      StatusPageSubscriberChannel.SMS,
    ],
    [
      StatusPageSubscriberUnsubscribeChannel.Slack,
      StatusPageSubscriberChannel.Slack,
    ],
    [
      StatusPageSubscriberUnsubscribeChannel.MicrosoftTeams,
      StatusPageSubscriberChannel.MicrosoftTeams,
    ],
    [
      StatusPageSubscriberUnsubscribeChannel.Webhook,
      StatusPageSubscriberChannel.Webhook,
    ],
  ])(
    "link a %s subscriber to the %s tab",
    (
      unsubscribeChannel: StatusPageSubscriberUnsubscribeChannel,
      channel: StatusPageSubscriberChannel,
    ) => {
      expect(
        getStatusPageSubscriberChannelForUnsubscribeChannel(unsubscribeChannel),
      ).toBe(channel);
    },
  );
});
