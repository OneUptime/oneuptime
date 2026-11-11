import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import ObjectID from "../../../Types/ObjectID";
import {
  ON_CALL_PAGE_CHANNELS,
  ON_CALL_PAGE_RINGING_CHANNELS,
  ON_CALL_PAGE_SENT_STATUS_MESSAGE,
  OnCallPageChannel,
  OnCallPageChannelInfo,
  OnCallPageNotification,
  OnCallPageNotificationEvent,
  OnCallPageNotificationNews,
  getOnCallPageAnsweredChannels,
  getOnCallPageChannelName,
  getOnCallPageChannelShortName,
  getOnCallPageChannelsOf,
  getOnCallPageChannelsOut,
  getOnCallPageNotificationNews,
  isOnCallPageNotificationOut,
  sortOnCallPageChannels,
} from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW A PAGE REACHED SOMEBODY, AND HOW THEY ANSWERED IT.
 *
 * Every notification of a page is a row of its person's on-call timeline,
 * and the notification method column that is set says which channel it went
 * out by. These rules read those rows for the record's feed - "paged Nitin
 * via push notification and email", "acknowledged ... via phone call" - and
 * the run's Slack and Microsoft Teams message reads the same list for its
 * short words ("paged once · by call and push").
 */

const START: number = Date.parse("2026-11-10T09:00:00.000Z");

// A notification of a page, written `minutes` after the page started.
function notification(data: {
  id: string;
  minutes: number;
  status: UserNotificationStatus;
  channels: Array<OnCallPageChannel>;
  acknowledgedAfterMinutes?: number;
}): OnCallPageNotification {
  const row: OnCallPageNotification = {
    id: data.id,
    status: data.status,
    createdAt: new Date(START + data.minutes * 60_000),
  };

  for (const channel of data.channels) {
    const info: OnCallPageChannelInfo = ON_CALL_PAGE_CHANNELS.find(
      (candidate: OnCallPageChannelInfo) => {
        return candidate.channel === channel;
      },
    )!;

    row[info.field] = ObjectID.generate();
  }

  if (data.acknowledgedAfterMinutes !== undefined) {
    row.isAcknowledged = true;
    row.acknowledgedAt = new Date(
      START + data.acknowledgedAfterMinutes * 60_000,
    );
  }

  return row;
}

describe("the list of channels", () => {
  test("names every channel once, with one column of the timeline each", () => {
    const channels: Array<string> = ON_CALL_PAGE_CHANNELS.map(
      (info: OnCallPageChannelInfo) => {
        return info.channel;
      },
    );
    const fields: Array<string> = ON_CALL_PAGE_CHANNELS.map(
      (info: OnCallPageChannelInfo) => {
        return info.field;
      },
    );

    expect([...channels].sort()).toEqual(
      [...Object.values(OnCallPageChannel)].sort(),
    );
    expect(new Set(fields).size).toBe(fields.length);
  });

  test("every column it reads is a notification method column of the on-call timeline", () => {
    const row: UserOnCallLogTimeline = new UserOnCallLogTimeline();

    for (const info of ON_CALL_PAGE_CHANNELS) {
      expect(Object.prototype.hasOwnProperty.call(row, info.field)).toBe(true);
    }
  });

  test("REGRESSION: the run's Slack message keeps its words - call, SMS, push, email - in its order", () => {
    expect(
      ON_CALL_PAGE_CHANNELS.map((info: OnCallPageChannelInfo) => {
        return info.shortName;
      }),
    ).toEqual([
      "call",
      "SMS",
      "WhatsApp",
      "Telegram",
      "push",
      "email",
      "Slack",
      "Microsoft Teams",
      "Mattermost",
      "webhook",
      "custom channel",
    ]);
  });

  test("a feed sentence names each channel in full", () => {
    expect(getOnCallPageChannelName(OnCallPageChannel.Call)).toBe("phone call");
    expect(getOnCallPageChannelName(OnCallPageChannel.Push)).toBe(
      "push notification",
    );
    expect(getOnCallPageChannelName(OnCallPageChannel.SMS)).toBe("SMS");
    expect(getOnCallPageChannelName(OnCallPageChannel.Email)).toBe("email");
    expect(getOnCallPageChannelName(OnCallPageChannel.MicrosoftTeams)).toBe(
      "Microsoft Teams",
    );
    expect(getOnCallPageChannelName(OnCallPageChannel.CustomChannel)).toBe(
      "custom channel",
    );
    expect(getOnCallPageChannelShortName(OnCallPageChannel.Call)).toBe("call");
    expect(getOnCallPageChannelShortName(OnCallPageChannel.Push)).toBe("push");
  });

  test("every name is plain words: nothing a phone number or an address could be read from", () => {
    for (const info of ON_CALL_PAGE_CHANNELS) {
      expect(info.name).toMatch(/^[A-Za-z ]+$/);
      expect(info.shortName).toMatch(/^[A-Za-z ]+$/);
    }
  });

  test("channels are sorted into the list's order, each once", () => {
    expect(
      sortOnCallPageChannels([
        OnCallPageChannel.Email,
        OnCallPageChannel.Call,
        OnCallPageChannel.Email,
        OnCallPageChannel.SMS,
      ]),
    ).toEqual([
      OnCallPageChannel.Call,
      OnCallPageChannel.SMS,
      OnCallPageChannel.Email,
    ]);
    expect(sortOnCallPageChannels([])).toEqual([]);
  });

  test("the message a page is marked sent with is the one the on-call log writes", () => {
    expect(ON_CALL_PAGE_SENT_STATUS_MESSAGE).toBe("Alert Sent");
  });
});

describe("whether a notification went out", () => {
  test("sending, sent, acknowledged and escalated did", () => {
    expect(isOnCallPageNotificationOut(UserNotificationStatus.Sending)).toBe(
      true,
    );
    expect(isOnCallPageNotificationOut(UserNotificationStatus.Sent)).toBe(true);
    expect(
      isOnCallPageNotificationOut(UserNotificationStatus.Acknowledged),
    ).toBe(true);
    expect(isOnCallPageNotificationOut(UserNotificationStatus.PassedOn)).toBe(
      true,
    );
  });

  test("a call that rang and was not picked up did: it reached their phone", () => {
    expect(
      isOnCallPageNotificationOut(UserNotificationStatus.NotAnswered),
    ).toBe(true);
  });

  test("failed, skipped or unknown did not", () => {
    expect(isOnCallPageNotificationOut(UserNotificationStatus.Error)).toBe(
      false,
    );
    expect(isOnCallPageNotificationOut(UserNotificationStatus.Skipped)).toBe(
      false,
    );
    expect(isOnCallPageNotificationOut(undefined)).toBe(false);
    expect(isOnCallPageNotificationOut(null)).toBe(false);
    expect(isOnCallPageNotificationOut("Something else")).toBe(false);
  });
});

describe("the channels of one notification", () => {
  test("the column that is set", () => {
    expect(getOnCallPageChannelsOf({ userSmsId: ObjectID.generate() })).toEqual(
      [OnCallPageChannel.SMS],
    );
    expect(
      getOnCallPageChannelsOf({
        customNotificationChannelId: ObjectID.generate(),
      }),
    ).toEqual([OnCallPageChannel.CustomChannel]);
  });

  test("a rule written through the API with two methods names both, in the list's order", () => {
    expect(
      getOnCallPageChannelsOf({
        userEmailId: ObjectID.generate(),
        userCallId: ObjectID.generate(),
      }),
    ).toEqual([OnCallPageChannel.Call, OnCallPageChannel.Email]);
  });

  test("none set, or no notification: none", () => {
    expect(getOnCallPageChannelsOf({})).toEqual([]);
    expect(getOnCallPageChannelsOf(null)).toEqual([]);
    expect(getOnCallPageChannelsOf(undefined)).toEqual([]);
  });
});

describe("the channels a page went out by", () => {
  test("every notification that went out, each channel once, in the list's order", () => {
    expect(
      getOnCallPageChannelsOut([
        notification({
          id: "a",
          minutes: 0,
          status: UserNotificationStatus.Sent,
          channels: [OnCallPageChannel.Email],
        }),
        notification({
          id: "b",
          minutes: 0,
          status: UserNotificationStatus.Sending,
          channels: [OnCallPageChannel.Push],
        }),
        notification({
          id: "c",
          minutes: 1,
          status: UserNotificationStatus.Sent,
          channels: [OnCallPageChannel.Push],
        }),
      ]),
    ).toEqual([OnCallPageChannel.Push, OnCallPageChannel.Email]);
  });

  test("one that could not be sent, or was skipped, is not counted", () => {
    expect(
      getOnCallPageChannelsOut([
        notification({
          id: "a",
          minutes: 0,
          status: UserNotificationStatus.Error,
          channels: [OnCallPageChannel.SMS],
        }),
        notification({
          id: "b",
          minutes: 0,
          status: UserNotificationStatus.Skipped,
          channels: [OnCallPageChannel.Telegram],
        }),
        notification({
          id: "c",
          minutes: 0,
          status: UserNotificationStatus.Sent,
          channels: [OnCallPageChannel.Email],
        }),
      ]),
    ).toEqual([OnCallPageChannel.Email]);
  });

  test("a call that rang and was not picked up is counted: the page reached their phone", () => {
    expect(
      getOnCallPageChannelsOut([
        notification({
          id: "a",
          minutes: 0,
          status: UserNotificationStatus.NotAnswered,
          channels: [OnCallPageChannel.Call],
        }),
        notification({
          id: "b",
          minutes: 0,
          status: UserNotificationStatus.Sent,
          channels: [OnCallPageChannel.Email],
        }),
      ]),
    ).toEqual([OnCallPageChannel.Call, OnCallPageChannel.Email]);
  });

  test("none went out: none", () => {
    expect(getOnCallPageChannelsOut([])).toEqual([]);
  });
});

describe("the channel a page was answered from", () => {
  test("acknowledged: the notification it was acknowledged from", () => {
    expect(
      getOnCallPageAnsweredChannels(
        [
          notification({
            id: "a",
            minutes: 0,
            status: UserNotificationStatus.Sent,
            channels: [OnCallPageChannel.Email],
          }),
          notification({
            id: "b",
            minutes: 10,
            status: UserNotificationStatus.Acknowledged,
            channels: [OnCallPageChannel.Call],
            acknowledgedAfterMinutes: 11,
          }),
        ],
        "acknowledged",
      ),
    ).toEqual([OnCallPageChannel.Call]);
  });

  test("acknowledged from two (a link clicked twice): the latest answer", () => {
    expect(
      getOnCallPageAnsweredChannels(
        [
          notification({
            id: "a",
            minutes: 0,
            status: UserNotificationStatus.Acknowledged,
            channels: [OnCallPageChannel.SMS],
            acknowledgedAfterMinutes: 12,
          }),
          notification({
            id: "b",
            minutes: 5,
            status: UserNotificationStatus.Acknowledged,
            channels: [OnCallPageChannel.Push],
            acknowledgedAfterMinutes: 6,
          }),
        ],
        "acknowledged",
      ),
    ).toEqual([OnCallPageChannel.SMS]);

    /*
     * The other way round: the one sent first was answered first, so the
     * latest answer is the one sent later. Each answer acknowledges the
     * page again (UserOnCallLogTimelineService.acknowledgePage), and the
     * entry it writes then reads the answer that wrote it - the latest.
     */
    expect(
      getOnCallPageAnsweredChannels(
        [
          notification({
            id: "a",
            minutes: 0,
            status: UserNotificationStatus.Acknowledged,
            channels: [OnCallPageChannel.SMS],
            acknowledgedAfterMinutes: 1,
          }),
          notification({
            id: "b",
            minutes: 5,
            status: UserNotificationStatus.Acknowledged,
            channels: [OnCallPageChannel.Push],
            acknowledgedAfterMinutes: 6,
          }),
        ],
        "acknowledged",
      ),
    ).toEqual([OnCallPageChannel.Push]);
  });

  test("escalated: the notification it was escalated from", () => {
    expect(
      getOnCallPageAnsweredChannels(
        [
          notification({
            id: "a",
            minutes: 0,
            status: UserNotificationStatus.PassedOn,
            channels: [OnCallPageChannel.SMS],
          }),
          notification({
            id: "b",
            minutes: 0,
            status: UserNotificationStatus.Sent,
            channels: [OnCallPageChannel.Email],
          }),
        ],
        "escalated",
      ),
    ).toEqual([OnCallPageChannel.SMS]);
  });

  test("answered some other way - the record acknowledged in the Dashboard or the app: none", () => {
    const notifications: Array<OnCallPageNotification> = [
      notification({
        id: "a",
        minutes: 0,
        status: UserNotificationStatus.Sent,
        channels: [OnCallPageChannel.SMS],
      }),
    ];

    expect(
      getOnCallPageAnsweredChannels(notifications, "acknowledged"),
    ).toEqual([]);
    expect(getOnCallPageAnsweredChannels(notifications, "escalated")).toEqual(
      [],
    );
    expect(getOnCallPageAnsweredChannels([], "acknowledged")).toEqual([]);
  });
});

describe("a notification after the page's own entry", () => {
  const firstSms: OnCallPageNotification = notification({
    id: "a",
    minutes: 0,
    status: UserNotificationStatus.Sent,
    channels: [OnCallPageChannel.SMS],
  });
  const firstEmail: OnCallPageNotification = notification({
    id: "b",
    minutes: 0,
    status: UserNotificationStatus.Sent,
    channels: [OnCallPageChannel.Email],
  });

  function news(
    event: OnCallPageNotificationEvent,
    one: OnCallPageNotification,
    all: Array<OnCallPageNotification>,
  ): OnCallPageNotificationNews | null {
    return getOnCallPageNotificationNews({
      event: event,
      notification: one,
      notifications: all,
    });
  }

  test("a call ten minutes on pages the person again, via a channel the feed has not named", () => {
    const call: OnCallPageNotification = notification({
      id: "c",
      minutes: 10,
      status: UserNotificationStatus.Sending,
      channels: [OnCallPageChannel.Call],
    });

    expect(
      news(OnCallPageNotificationEvent.SentLater, call, [
        firstSms,
        firstEmail,
        call,
      ]),
    ).toEqual({
      event: OnCallPageNotificationEvent.SentLater,
      channels: [OnCallPageChannel.Call],
      isPagedBefore: true,
    });
  });

  test("the first notification to reach them - their rules page later - is no page 'again'", () => {
    const sms: OnCallPageNotification = notification({
      id: "c",
      minutes: 5,
      status: UserNotificationStatus.Sending,
      channels: [OnCallPageChannel.SMS],
    });

    expect(news(OnCallPageNotificationEvent.SentLater, sms, [sms])).toEqual({
      event: OnCallPageNotificationEvent.SentLater,
      channels: [OnCallPageChannel.SMS],
      isPagedBefore: false,
    });
  });

  test("nor is one whose earlier notifications all failed", () => {
    const failedEmail: OnCallPageNotification = notification({
      id: "a",
      minutes: 0,
      status: UserNotificationStatus.Error,
      channels: [OnCallPageChannel.Email],
    });
    const sms: OnCallPageNotification = notification({
      id: "c",
      minutes: 5,
      status: UserNotificationStatus.Sending,
      channels: [OnCallPageChannel.SMS],
    });

    expect(
      news(OnCallPageNotificationEvent.SentLater, sms, [failedEmail, sms])
        ?.isPagedBefore,
    ).toBe(false);
  });

  test("a push repeated until they answer is told of once: its channel was named already", () => {
    const push: OnCallPageNotification = notification({
      id: "a",
      minutes: 0,
      status: UserNotificationStatus.Sent,
      channels: [OnCallPageChannel.Push],
    });
    const repeats: Array<OnCallPageNotification> = [1, 2, 3].map(
      (minutes: number) => {
        return notification({
          id: `r${minutes}`,
          minutes: minutes,
          status: UserNotificationStatus.Sending,
          channels: [OnCallPageChannel.Push],
        });
      },
    );

    for (const repeat of repeats) {
      expect(
        news(OnCallPageNotificationEvent.SentLater, repeat, [push, ...repeats]),
      ).toBeNull();
    }
  });

  test("a channel whose earlier notification failed is news when one by it goes out", () => {
    const failedSms: OnCallPageNotification = notification({
      id: "a",
      minutes: 0,
      status: UserNotificationStatus.Error,
      channels: [OnCallPageChannel.SMS],
    });
    const sms: OnCallPageNotification = notification({
      id: "c",
      minutes: 5,
      status: UserNotificationStatus.Sending,
      channels: [OnCallPageChannel.SMS],
    });

    expect(
      news(OnCallPageNotificationEvent.SentLater, sms, [
        failedSms,
        firstEmail,
        sms,
      ]),
    ).toEqual({
      event: OnCallPageNotificationEvent.SentLater,
      channels: [OnCallPageChannel.SMS],
      isPagedBefore: true,
    });
  });

  test("a notification by no channel is no news", () => {
    const none: OnCallPageNotification = {
      id: "c",
      status: UserNotificationStatus.Sending,
      createdAt: new Date(START + 60_000),
    };

    expect(
      news(OnCallPageNotificationEvent.SentLater, none, [firstSms, none]),
    ).toBeNull();
    expect(news(OnCallPageNotificationEvent.Failed, none, [none])).toBeNull();
  });

  test("a notification by two channels is news by the one the feed has not named", () => {
    const both: OnCallPageNotification = notification({
      id: "c",
      minutes: 10,
      status: UserNotificationStatus.Sending,
      channels: [OnCallPageChannel.SMS, OnCallPageChannel.Call],
    });

    expect(
      news(OnCallPageNotificationEvent.SentLater, both, [firstSms, both])
        ?.channels,
    ).toEqual([OnCallPageChannel.Call]);
  });

  test("one that could not be sent is told of, with nobody paged 'again'", () => {
    const failedSms: OnCallPageNotification = notification({
      id: "c",
      minutes: 0,
      status: UserNotificationStatus.Error,
      channels: [OnCallPageChannel.SMS],
    });

    expect(
      news(OnCallPageNotificationEvent.Failed, failedSms, [
        firstEmail,
        failedSms,
      ]),
    ).toEqual({
      event: OnCallPageNotificationEvent.Failed,
      channels: [OnCallPageChannel.SMS],
      isPagedBefore: false,
    });
  });

  test("a channel that fails again - a push token that is gone fails every repeat - is told of once", () => {
    const first: OnCallPageNotification = notification({
      id: "a",
      minutes: 0,
      status: UserNotificationStatus.Error,
      channels: [OnCallPageChannel.Push],
    });
    const second: OnCallPageNotification = notification({
      id: "b",
      minutes: 1,
      status: UserNotificationStatus.Error,
      channels: [OnCallPageChannel.Push],
    });

    expect(
      news(OnCallPageNotificationEvent.Failed, first, [first, second]),
    ).not.toBeNull();
    expect(
      news(OnCallPageNotificationEvent.Failed, second, [first, second]),
    ).toBeNull();
  });

  test("a failure after a send by the same channel is still told of: that one did not reach them", () => {
    const sms: OnCallPageNotification = notification({
      id: "c",
      minutes: 10,
      status: UserNotificationStatus.Error,
      channels: [OnCallPageChannel.SMS],
    });

    expect(
      news(OnCallPageNotificationEvent.Failed, sms, [firstSms, sms])?.channels,
    ).toEqual([OnCallPageChannel.SMS]);
  });

  test("two that failed in the same instant: exactly one of them is told of, whichever is read first", () => {
    const one: OnCallPageNotification = notification({
      id: "0f800000-0000-4000-8000-0000000000b1",
      minutes: 0,
      status: UserNotificationStatus.Error,
      channels: [OnCallPageChannel.Push],
    });
    const other: OnCallPageNotification = notification({
      id: "0f800000-0000-4000-8000-0000000000b2",
      minutes: 0,
      status: UserNotificationStatus.Error,
      channels: [OnCallPageChannel.Push],
    });

    for (const all of [
      [one, other],
      [other, one],
    ]) {
      const told: Array<OnCallPageNotification> = [one, other].filter(
        (candidate: OnCallPageNotification) => {
          return (
            news(OnCallPageNotificationEvent.Failed, candidate, all) !== null
          );
        },
      );

      expect(told).toEqual([one]);
    }
  });

  test("the notification itself, read among the page's, is not an earlier one", () => {
    const call: OnCallPageNotification = notification({
      id: "c",
      minutes: 10,
      status: UserNotificationStatus.Sent,
      channels: [OnCallPageChannel.Call],
    });

    // The same row read twice: by reference, and as a copy with its id.
    expect(
      news(OnCallPageNotificationEvent.SentLater, call, [
        firstSms,
        call,
        { ...call },
      ])?.channels,
    ).toEqual([OnCallPageChannel.Call]);
  });
});

describe("a call that rang and was not picked up", () => {
  const sms: OnCallPageNotification = notification({
    id: "a",
    minutes: 0,
    status: UserNotificationStatus.Sent,
    channels: [OnCallPageChannel.SMS],
  });

  function notAnswered(
    one: OnCallPageNotification,
    all: Array<OnCallPageNotification>,
  ): OnCallPageNotificationNews | null {
    return getOnCallPageNotificationNews({
      event: OnCallPageNotificationEvent.NotAnswered,
      notification: one,
      notifications: all,
    });
  }

  test("only a phone call rings, and so only a call can go unanswered", () => {
    expect(ON_CALL_PAGE_RINGING_CHANNELS).toEqual([OnCallPageChannel.Call]);

    for (const channel of ON_CALL_PAGE_RINGING_CHANNELS) {
      expect(
        ON_CALL_PAGE_CHANNELS.map((info: OnCallPageChannelInfo) => {
          return info.channel;
        }),
      ).toContain(channel);
    }
  });

  test("is told of by its channel, with nobody paged 'again'", () => {
    const call: OnCallPageNotification = notification({
      id: "c",
      minutes: 10,
      status: UserNotificationStatus.NotAnswered,
      channels: [OnCallPageChannel.Call],
    });

    expect(notAnswered(call, [sms, call])).toEqual({
      event: OnCallPageNotificationEvent.NotAnswered,
      channels: [OnCallPageChannel.Call],
      isPagedBefore: false,
    });
  });

  test("a second call that rings out is told of once: the first said as much", () => {
    const first: OnCallPageNotification = notification({
      id: "c",
      minutes: 10,
      status: UserNotificationStatus.NotAnswered,
      channels: [OnCallPageChannel.Call],
    });
    const second: OnCallPageNotification = notification({
      id: "d",
      minutes: 20,
      status: UserNotificationStatus.NotAnswered,
      channels: [OnCallPageChannel.Call],
    });

    expect(notAnswered(first, [sms, first, second])).not.toBeNull();
    expect(notAnswered(second, [sms, first, second])).toBeNull();
  });

  test("an earlier call that went through, or failed, does not hide one that rang out", () => {
    for (const status of [
      UserNotificationStatus.Sent,
      UserNotificationStatus.Acknowledged,
      UserNotificationStatus.Error,
    ]) {
      const earlier: OnCallPageNotification = notification({
        id: "c",
        minutes: 0,
        status: status,
        channels: [OnCallPageChannel.Call],
      });
      const call: OnCallPageNotification = notification({
        id: "d",
        minutes: 10,
        status: UserNotificationStatus.NotAnswered,
        channels: [OnCallPageChannel.Call],
      });

      expect(notAnswered(call, [earlier, call])?.channels).toEqual([
        OnCallPageChannel.Call,
      ]);
    }
  });

  test("an SMS, an email or a push is never 'not answered' - it is read when it is read", () => {
    for (const channel of [
      OnCallPageChannel.SMS,
      OnCallPageChannel.Email,
      OnCallPageChannel.Push,
      OnCallPageChannel.WhatsApp,
      OnCallPageChannel.Telegram,
    ]) {
      const one: OnCallPageNotification = notification({
        id: "c",
        minutes: 0,
        status: UserNotificationStatus.NotAnswered,
        channels: [channel],
      });

      expect(notAnswered(one, [one])).toBeNull();
    }
  });

  test("a notification by a call and an SMS (a rule written through the API) is told of by its call alone", () => {
    const both: OnCallPageNotification = notification({
      id: "c",
      minutes: 0,
      status: UserNotificationStatus.NotAnswered,
      channels: [OnCallPageChannel.SMS, OnCallPageChannel.Call],
    });

    expect(notAnswered(both, [both])?.channels).toEqual([
      OnCallPageChannel.Call,
    ]);
  });

  test("a call that failed is not one that rang out: neither hides the other", () => {
    const failed: OnCallPageNotification = notification({
      id: "c",
      minutes: 0,
      status: UserNotificationStatus.Error,
      channels: [OnCallPageChannel.Call],
    });
    const rangOut: OnCallPageNotification = notification({
      id: "d",
      minutes: 10,
      status: UserNotificationStatus.NotAnswered,
      channels: [OnCallPageChannel.Call],
    });

    expect(
      getOnCallPageNotificationNews({
        event: OnCallPageNotificationEvent.Failed,
        notification: failed,
        notifications: [rangOut, failed],
      })?.channels,
    ).toEqual([OnCallPageChannel.Call]);
    expect(notAnswered(rangOut, [failed, rangOut])?.channels).toEqual([
      OnCallPageChannel.Call,
    ]);
  });

  test("a page sent after a call that rang out pages them 'again': the call reached them", () => {
    const call: OnCallPageNotification = notification({
      id: "c",
      minutes: 0,
      status: UserNotificationStatus.NotAnswered,
      channels: [OnCallPageChannel.Call],
    });
    const later: OnCallPageNotification = notification({
      id: "d",
      minutes: 5,
      status: UserNotificationStatus.Sending,
      channels: [OnCallPageChannel.SMS],
    });

    expect(
      getOnCallPageNotificationNews({
        event: OnCallPageNotificationEvent.SentLater,
        notification: later,
        notifications: [call, later],
      }),
    ).toEqual({
      event: OnCallPageNotificationEvent.SentLater,
      channels: [OnCallPageChannel.SMS],
      isPagedBefore: true,
    });
  });

  test("and a second call after one that rang out is no news: the feed named calls already", () => {
    const call: OnCallPageNotification = notification({
      id: "c",
      minutes: 0,
      status: UserNotificationStatus.NotAnswered,
      channels: [OnCallPageChannel.Call],
    });
    const again: OnCallPageNotification = notification({
      id: "d",
      minutes: 10,
      status: UserNotificationStatus.Sending,
      channels: [OnCallPageChannel.Call],
    });

    expect(
      getOnCallPageNotificationNews({
        event: OnCallPageNotificationEvent.SentLater,
        notification: again,
        notifications: [call, again],
      }),
    ).toBeNull();
  });
});
