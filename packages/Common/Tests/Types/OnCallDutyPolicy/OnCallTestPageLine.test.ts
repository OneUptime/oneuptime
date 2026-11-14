import { describe, expect, test } from "@jest/globals";
import {
  getProjectNotificationChannelOffMessage,
  ProjectNotificationChannel,
} from "../../../Utils/Project/NotificationChannels";
import { ALREADY_PAGED_TIMELINE_MESSAGE } from "../../../Types/OnCallDutyPolicy/AlreadyPagedTimelineMessage";
import { getAwayTimelineMessage } from "../../../Types/OnCallDutyPolicy/AwayTimelineMessage";
import { ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE } from "../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import { ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE } from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import {
  getOnCallEmptyLevelTimelineMessage,
  LEGACY_ON_CALL_LEVEL_NO_USERS_TIMELINE_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallEmptyLevel";
import { NOBODY_NEXT_IN_ROTATION_TIMELINE_MESSAGE } from "../../../Types/OnCallDutyPolicy/NextInRotation";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  getOnCallFallbackFailedStatusMessage,
  getOnCallFallbackNotifiedStatusMessage,
  getOnCallNoVerifiedMethodStatusMessage,
  getOnCallOptedOutStatusMessage,
  isOnCallFallbackFailedStatusMessage,
  isOnCallFallbackNotifiedStatusMessage,
  isOnCallNoNotificationRulesStatusMessage,
  isOnCallNoVerifiedMethodStatusMessage,
  isOnCallOptedOutStatusMessage,
  NO_NOTIFICATION_RULES_STATUS_MESSAGE,
  NOBODY_ON_CALL_IN_SCHEDULE_TIMELINE_MESSAGE,
  NOT_A_PROJECT_MEMBER_STATUS_MESSAGE,
  NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
  ON_CALL_POLICY_HAS_NO_ESCALATION_RULES_MESSAGE,
  PUSH_NOT_SENT_TO_APP_THAT_NO_LONGER_RECEIVES_MESSAGE,
  PUSH_NOT_SENT_TO_BROWSER_THAT_NO_LONGER_RECEIVES_MESSAGE,
  SENDING_NOTIFICATION_TO_USER_TIMELINE_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallPageLine";
import {
  ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES,
  ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE,
  ON_CALL_TEST_PAGE_FIRST_LEVEL_PAGED_MESSAGE,
  ON_CALL_TEST_PAGE_FIRST_LEVEL_REACHED_NOBODY_MESSAGE,
  ON_CALL_TEST_PAGE_NOBODY_PAGED_MESSAGE,
  ON_CALL_TEST_PAGE_RULES_RAN_MESSAGE,
  ON_CALL_TEST_PAGE_RUN_UNREADABLE_MESSAGE,
  ON_CALL_TEST_PAGE_WENT_THROUGH_EVERY_LEVEL_MESSAGE,
  OnCallTestPageLine,
  OnCallTestPageLineCode,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import {
  getOnCallTestPageCustomChannelOffMessage,
  getOnCallTestPageNotVerifiedMessage,
  OnCallTestPageNotVerifiedChannel,
  readOnCallTestPageDeliveryLine,
  readOnCallTestPageRunLine,
  readOnCallTestPageStepLine,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPageLine";

/*
 * ISSUE #7260: A TEST PAGE'S RESULT, LINE BY LINE, AS CODES.
 *
 * A test page writes its lines in English - on each message it did not send,
 * on each person or target of the run's timeline, on the run itself - as
 * every page does, and every reader of the execution logs reads them so. Its
 * result reads the lines it knows back into codes with the values they name
 * (OnCallTestPageLine), so the Dashboard words them in the reader's
 * language: a German reader read "SMS not sent because phone ... is not
 * verified." in English, among German words.
 *
 * Two things are pinned here. The English: each line is built by the same
 * helper its writer uses now, and reads word for word as the writer wrote
 * it before - operators grep their logs for these. And the reading: every
 * line a writer builds is read back into its code, and a line no code
 * stands for - a provider's own error - is not.
 */

const PERSON: string = "Jane Doe";

describe("the English lines, word for word as they were written before", () => {
  test("a message a test did not send because its method is not verified", () => {
    expect(
      getOnCallTestPageNotVerifiedMessage({
        channel: OnCallPageChannel.Email,
        address: "ana@example.com",
      }),
    ).toBe(
      "Email notification not sent because email ana@example.com is not verified.",
    );
    expect(
      getOnCallTestPageNotVerifiedMessage({
        channel: OnCallPageChannel.SMS,
        address: "+15550100",
      }),
    ).toBe("SMS not sent because phone +15550100 is not verified.");
    expect(
      getOnCallTestPageNotVerifiedMessage({
        channel: OnCallPageChannel.WhatsApp,
        address: "+15550100",
      }),
    ).toBe(
      "WhatsApp message not sent because phone +15550100 is not verified.",
    );
    expect(
      getOnCallTestPageNotVerifiedMessage({
        channel: OnCallPageChannel.Call,
        address: "+15550100",
      }),
    ).toBe("Call not sent because phone +15550100 is not verified.");
    expect(
      getOnCallTestPageNotVerifiedMessage({
        channel: OnCallPageChannel.Telegram,
      }),
    ).toBe(
      "Telegram message not sent because the Telegram account is not verified.",
    );
    expect(
      getOnCallTestPageNotVerifiedMessage({ channel: OnCallPageChannel.Slack }),
    ).toBe("Slack message not sent because the Slack account is not verified.");
    expect(
      getOnCallTestPageNotVerifiedMessage({
        channel: OnCallPageChannel.MicrosoftTeams,
      }),
    ).toBe(
      "Microsoft Teams message not sent because the Microsoft Teams account is not verified.",
    );
    expect(
      getOnCallTestPageNotVerifiedMessage({
        channel: OnCallPageChannel.Mattermost,
      }),
    ).toBe(
      "Mattermost message not sent because the Mattermost account is not verified.",
    );
  });

  test("a custom channel that is turned off", () => {
    expect(getOnCallTestPageCustomChannelOffMessage("Ops bridge")).toBe(
      "Not sent: Ops bridge is turned off.",
    );
  });

  test("a person who opted out, has no rule, or no verified method", () => {
    expect(
      getOnCallOptedOutStatusMessage({
        severityName: "Sev4",
        pagedFor: "incidents",
      }),
    ).toBe("You have opted out of notifications for Sev4 incidents.");
    expect(
      getOnCallFallbackNotifiedStatusMessage({
        severityName: "Sev1",
        channelsUsed: ["Push", "Email"],
      }),
    ).toBe(
      "No notification rule configured for Sev1; notified via fallback (Push, Email).",
    );
    expect(getOnCallNoVerifiedMethodStatusMessage(PERSON)).toBe(
      "Jane Doe has no verified notification method, so this page could not be delivered. Ask them to add one in User Settings > Notification Methods.",
    );
    expect(
      getOnCallFallbackFailedStatusMessage({
        responderLabel: PERSON,
        severityName: "Sev1",
      }),
    ).toBe(
      "Jane Doe has no notification rule for Sev1 and the fallback delivery attempt failed, so this page was not delivered. Check the worker logs, then add a rule in User Settings > How to Reach Me.",
    );
    expect(NO_NOTIFICATION_RULES_STATUS_MESSAGE).toBe(
      "No notification rules found for this user. User should add the rules in User Settings > How to Reach Me.",
    );
  });

  /*
   * A row written before the On-Call Rules page was called How to Reach Me
   * (#6820) still names the old page: it reads into the same code as the
   * row written today, so its line is still worded in the reader's language.
   */
  test("a row written before the page was called How to Reach Me reads as the same line", () => {
    expect(
      readOnCallTestPageStepLine({
        statusMessage:
          "No notification rules found for this user. User should add the rules in User Settings > On-Call Rules.",
      }),
    ).toEqual({ code: OnCallTestPageLineCode.NoRuleNoFallback });
    expect(
      readOnCallTestPageStepLine({
        statusMessage:
          "Jane Doe has no notification rule for Sev1 and the fallback delivery attempt failed, so this page was not delivered. Check the worker logs, then add a rule in User Settings > On-Call Rules.",
      }),
    ).toEqual({ code: OnCallTestPageLineCode.FallbackFailed });
    expect(
      isOnCallFallbackFailedStatusMessage(
        "Jane Doe has no notification rule for Sev1 and the fallback delivery attempt failed, so this page was not delivered. Check the worker logs, then add a rule in User Settings > On-Call Rules.",
      ),
    ).toBe(true);
    expect(
      isOnCallNoNotificationRulesStatusMessage(
        "No notification rules found for this user. User should add the rules in User Settings > On-Call Rules.",
      ),
    ).toBe(true);
    // A line that only starts the same way is another line.
    expect(
      readOnCallTestPageStepLine({
        statusMessage: "No notification rules found for this user's team.",
      }),
    ).toBeNull();
    expect(
      isOnCallNoNotificationRulesStatusMessage(
        "No notification rules found for this user's team.",
      ),
    ).toBe(false);
    expect(
      isOnCallFallbackFailedStatusMessage(
        "Jane Doe has no notification rule for Sev1, so this page was not delivered.",
      ),
    ).toBe(false);
  });

  test("the timeline's lines for a person, a schedule and a policy", () => {
    expect(NOT_A_PROJECT_MEMBER_STATUS_MESSAGE).toBe(
      "Not sent because this user is not a member of the project.",
    );
    expect(NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE).toBe(
      "Skipped because this user is not a member of the project.",
    );
    expect(SENDING_NOTIFICATION_TO_USER_TIMELINE_MESSAGE).toBe(
      "Sending notification to user.",
    );
    expect(NOBODY_ON_CALL_IN_SCHEDULE_TIMELINE_MESSAGE).toBe(
      "Skipped because no active users are found in this schedule.",
    );
    expect(ON_CALL_POLICY_HAS_NO_ESCALATION_RULES_MESSAGE).toBe(
      "No Escalation Rules in Policy. Please add escalation rules to this policy.",
    );
  });

  test("a push to a device, or a browser, that no longer receives them", () => {
    expect(PUSH_NOT_SENT_TO_APP_THAT_NO_LONGER_RECEIVES_MESSAGE).toBe(
      "Push notification not sent: this device no longer receives push notifications. Open the mobile app on it to register it again.",
    );
    expect(PUSH_NOT_SENT_TO_BROWSER_THAT_NO_LONGER_RECEIVES_MESSAGE).toBe(
      "Push notification not sent: this browser no longer receives push notifications. Register it again from User Settings > Notification Methods > Push in that browser.",
    );
  });

  test("each builder's line is the one its reader recognises, and no other", () => {
    expect(
      isOnCallOptedOutStatusMessage(
        getOnCallOptedOutStatusMessage({
          severityName: "Critical",
          pagedFor: "alert episodes",
        }),
      ),
    ).toBe(true);
    expect(
      isOnCallFallbackNotifiedStatusMessage(
        getOnCallFallbackNotifiedStatusMessage({
          severityName: "Critical",
          channelsUsed: ["SMS"],
        }),
      ),
    ).toBe(true);
    expect(
      isOnCallNoVerifiedMethodStatusMessage(
        getOnCallNoVerifiedMethodStatusMessage(PERSON),
      ),
    ).toBe(true);
    expect(
      isOnCallFallbackFailedStatusMessage(
        getOnCallFallbackFailedStatusMessage({
          responderLabel: PERSON,
          severityName: "Critical",
        }),
      ),
    ).toBe(true);

    // The no-rule line's reader knows its line, and says no to the others.
    expect(
      isOnCallNoNotificationRulesStatusMessage(
        NO_NOTIFICATION_RULES_STATUS_MESSAGE,
      ),
    ).toBe(true);

    for (const other of [
      getOnCallFallbackFailedStatusMessage({
        responderLabel: PERSON,
        severityName: "Critical",
      }),
      getOnCallNoVerifiedMethodStatusMessage(PERSON),
      SENDING_NOTIFICATION_TO_USER_TIMELINE_MESSAGE,
      "",
    ]) {
      expect([other, isOnCallNoNotificationRulesStatusMessage(other)]).toEqual([
        other,
        false,
      ]);
    }

    // Each reader says no to the others' lines, and to nothing at all.
    const others: Array<string> = [
      NO_NOTIFICATION_RULES_STATUS_MESSAGE,
      SENDING_NOTIFICATION_TO_USER_TIMELINE_MESSAGE,
      "Twilio error 21610: Attempt to send to unsubscribed recipient.",
      "",
    ];

    for (const other of others) {
      expect([other, isOnCallOptedOutStatusMessage(other)]).toEqual([
        other,
        false,
      ]);
      expect([other, isOnCallFallbackNotifiedStatusMessage(other)]).toEqual([
        other,
        false,
      ]);
      expect([other, isOnCallNoVerifiedMethodStatusMessage(other)]).toEqual([
        other,
        false,
      ]);
      expect([other, isOnCallFallbackFailedStatusMessage(other)]).toEqual([
        other,
        false,
      ]);
    }

    // The sentence's end alone names nobody: not a line about a person.
    expect(
      isOnCallNoVerifiedMethodStatusMessage(
        getOnCallNoVerifiedMethodStatusMessage(""),
      ),
    ).toBe(false);
    expect(isOnCallNoVerifiedMethodStatusMessage(null)).toBe(false);
    expect(isOnCallOptedOutStatusMessage(undefined)).toBe(false);
  });
});

describe("a message's line, as a code (readOnCallTestPageDeliveryLine)", () => {
  /*
   * Every row has its two values - an account's address is undefined - so
   * jest never takes the test for one that waits on a callback.
   */
  const NOT_VERIFIED: Array<
    [OnCallTestPageNotVerifiedChannel, string | undefined]
  > = [
    [OnCallPageChannel.Email, "ana@example.com"],
    [OnCallPageChannel.SMS, "+15550100"],
    [OnCallPageChannel.WhatsApp, "+15550100"],
    [OnCallPageChannel.Call, "+15550100"],
    [OnCallPageChannel.Telegram, undefined],
    [OnCallPageChannel.Slack, undefined],
    [OnCallPageChannel.MicrosoftTeams, undefined],
    [OnCallPageChannel.Mattermost, undefined],
  ];

  test.each(NOT_VERIFIED)(
    "%s not verified: MethodNotVerified, with its channel",
    (
      channel: OnCallTestPageNotVerifiedChannel,
      address: string | undefined,
    ) => {
      const statusMessage: string = getOnCallTestPageNotVerifiedMessage({
        channel: channel,
        address: address,
      });

      expect(
        readOnCallTestPageDeliveryLine({
          statusMessage: statusMessage,
          channel: channel,
        }),
      ).toEqual({
        code: OnCallTestPageLineCode.MethodNotVerified,
        channel: channel,
      });

      // Spaces around a line, as a database may keep them, change nothing.
      expect(
        readOnCallTestPageDeliveryLine({
          statusMessage: ` ${statusMessage} `,
          channel: channel,
        })?.code,
      ).toBe(OnCallTestPageLineCode.MethodNotVerified);
    },
  );

  test("a line read only for the method it is about: an SMS line on a call is no code", () => {
    expect(
      readOnCallTestPageDeliveryLine({
        statusMessage: getOnCallTestPageNotVerifiedMessage({
          channel: OnCallPageChannel.SMS,
          address: "+15550100",
        }),
        channel: OnCallPageChannel.Call,
      }),
    ).toBeNull();
    expect(
      readOnCallTestPageDeliveryLine({
        statusMessage: getOnCallTestPageNotVerifiedMessage({
          channel: OnCallPageChannel.Slack,
        }),
        channel: OnCallPageChannel.MicrosoftTeams,
      }),
    ).toBeNull();
  });

  test("a line that names no address is not one about an address", () => {
    expect(
      readOnCallTestPageDeliveryLine({
        statusMessage: "SMS not sent because phone  is not verified.",
        channel: OnCallPageChannel.SMS,
      }),
    ).toBeNull();
  });

  test("a custom channel turned off: MethodNotVerified, the custom channel's", () => {
    expect(
      readOnCallTestPageDeliveryLine({
        statusMessage: getOnCallTestPageCustomChannelOffMessage("Ops bridge"),
        channel: OnCallPageChannel.CustomChannel,
      }),
    ).toEqual({
      code: OnCallTestPageLineCode.MethodNotVerified,
      channel: OnCallPageChannel.CustomChannel,
    });
    // Only on a custom channel's row.
    expect(
      readOnCallTestPageDeliveryLine({
        statusMessage: getOnCallTestPageCustomChannelOffMessage("Ops bridge"),
        channel: OnCallPageChannel.Webhook,
      }),
    ).toBeNull();
  });

  test("a push device or browser that no longer receives: which of the two", () => {
    expect(
      readOnCallTestPageDeliveryLine({
        statusMessage: PUSH_NOT_SENT_TO_APP_THAT_NO_LONGER_RECEIVES_MESSAGE,
        channel: OnCallPageChannel.Push,
      }),
    ).toEqual({
      code: OnCallTestPageLineCode.PushDeviceNoLongerReceives,
      isMobileApp: true,
    });
    expect(
      readOnCallTestPageDeliveryLine({
        statusMessage: PUSH_NOT_SENT_TO_BROWSER_THAT_NO_LONGER_RECEIVES_MESSAGE,
        channel: OnCallPageChannel.Push,
      }),
    ).toEqual({
      code: OnCallTestPageLineCode.PushDeviceNoLongerReceives,
      isMobileApp: false,
    });
  });

  test.each([
    [OnCallPageChannel.SMS, ProjectNotificationChannel.SMS],
    [OnCallPageChannel.Call, ProjectNotificationChannel.Call],
    [OnCallPageChannel.WhatsApp, ProjectNotificationChannel.WhatsApp],
    [OnCallPageChannel.Telegram, ProjectNotificationChannel.Telegram],
  ])(
    "%s switched off in the project: ChannelOff, with its channel",
    (
      channel: OnCallPageChannel,
      projectChannel: ProjectNotificationChannel,
    ) => {
      expect(
        readOnCallTestPageDeliveryLine({
          statusMessage:
            getProjectNotificationChannelOffMessage(projectChannel),
          channel: channel,
        }),
      ).toEqual({ code: OnCallTestPageLineCode.ChannelOff, channel: channel });
    },
  );

  test("another channel's off line on this channel's row is no code", () => {
    expect(
      readOnCallTestPageDeliveryLine({
        statusMessage: getProjectNotificationChannelOffMessage(
          ProjectNotificationChannel.SMS,
        ),
        channel: OnCallPageChannel.Call,
      }),
    ).toBeNull();
  });

  test("a provider's own error, a message on its way, or a row with no method: no code - shown as written", () => {
    for (const [statusMessage, channel] of [
      [
        "Twilio error 21610: Attempt to send to unsubscribed recipient.",
        OnCallPageChannel.SMS,
      ],
      ["Sending SMS to +15550100.", OnCallPageChannel.SMS],
      ["Email sent.", OnCallPageChannel.Email],
      ["", OnCallPageChannel.SMS],
    ] as Array<[string, OnCallPageChannel]>) {
      expect([
        statusMessage,
        readOnCallTestPageDeliveryLine({
          statusMessage: statusMessage,
          channel: channel,
        }),
      ]).toEqual([statusMessage, null]);
    }

    expect(
      readOnCallTestPageDeliveryLine({
        statusMessage: getOnCallTestPageNotVerifiedMessage({
          channel: OnCallPageChannel.SMS,
          address: "+15550100",
        }),
        channel: null,
      }),
    ).toBeNull();
    expect(
      readOnCallTestPageDeliveryLine({
        statusMessage: null,
        channel: OnCallPageChannel.SMS,
      }),
    ).toBeNull();
  });
});

describe("a person's or a target's line, as a code (readOnCallTestPageStepLine)", () => {
  const AWAY_UNTIL: Date = new Date("2026-11-20T09:00:00.000Z");

  test.each([
    [
      "no rule, no fallback",
      NO_NOTIFICATION_RULES_STATUS_MESSAGE,
      { code: OnCallTestPageLineCode.NoRuleNoFallback },
    ],
    [
      "not a member (their log)",
      NOT_A_PROJECT_MEMBER_STATUS_MESSAGE,
      { code: OnCallTestPageLineCode.NotProjectMember, name: PERSON },
    ],
    [
      "not a member (the timeline)",
      NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
      { code: OnCallTestPageLineCode.NotProjectMember, name: PERSON },
    ],
    [
      "a team with no members",
      ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE,
      { code: OnCallTestPageLineCode.TeamHasNoMembers, name: "Platform" },
    ],
    [
      "nobody next in the rotation",
      NOBODY_NEXT_IN_ROTATION_TIMELINE_MESSAGE,
      { code: OnCallTestPageLineCode.NobodyNextInRotation, name: "Nights" },
    ],
    [
      "nobody on call",
      NOBODY_ON_CALL_IN_SCHEDULE_TIMELINE_MESSAGE,
      { code: OnCallTestPageLineCode.NobodyOnCall, name: "Nights" },
    ],
    [
      "already paged",
      ALREADY_PAGED_TIMELINE_MESSAGE,
      { code: OnCallTestPageLineCode.AlreadyPaged },
    ],
    [
      "being paged",
      SENDING_NOTIFICATION_TO_USER_TIMELINE_MESSAGE,
      { code: OnCallTestPageLineCode.SendingToPerson },
    ],
    [
      "every rule ran",
      ON_CALL_TEST_PAGE_RULES_RAN_MESSAGE,
      { code: OnCallTestPageLineCode.RulesRan },
    ],
    [
      "an unreadable run",
      ON_CALL_TEST_PAGE_RUN_UNREADABLE_MESSAGE,
      { code: OnCallTestPageLineCode.RunUnreadable },
    ],
    [
      "a level with no responders",
      getOnCallEmptyLevelTimelineMessage({ namesAnybody: false }),
      { code: OnCallTestPageLineCode.LevelHasNoResponders },
    ],
    [
      "a level that paged nobody",
      getOnCallEmptyLevelTimelineMessage({ namesAnybody: true }),
      { code: OnCallTestPageLineCode.LevelPagedNobody },
    ],
    [
      "away, nobody covering",
      getAwayTimelineMessage(AWAY_UNTIL),
      {
        code: OnCallTestPageLineCode.AwayWithNobodyCovering,
        name: PERSON,
        awayUntil: AWAY_UNTIL.toISOString(),
      },
    ],
    [
      "opted out",
      getOnCallOptedOutStatusMessage({
        severityName: "Sev4",
        pagedFor: "incidents",
      }),
      { code: OnCallTestPageLineCode.OptedOut },
    ],
    [
      "no rule, paged by fallback",
      getOnCallFallbackNotifiedStatusMessage({
        severityName: "Sev1",
        channelsUsed: ["Push", "Email"],
      }),
      { code: OnCallTestPageLineCode.NoRuleFallsBack },
    ],
    [
      "no verified method",
      getOnCallNoVerifiedMethodStatusMessage(PERSON),
      { code: OnCallTestPageLineCode.NoVerifiedMethod, name: PERSON },
    ],
    [
      "the fallback failed",
      getOnCallFallbackFailedStatusMessage({
        responderLabel: PERSON,
        severityName: "Sev1",
      }),
      { code: OnCallTestPageLineCode.FallbackFailed },
    ],
  ] as Array<[string, string, OnCallTestPageLine]>)(
    "%s",
    (_name: string, statusMessage: string, expected: OnCallTestPageLine) => {
      expect(
        readOnCallTestPageStepLine({
          statusMessage: statusMessage,
          userName: PERSON,
          teamName: "Platform",
          scheduleName: "Nights",
        }),
      ).toEqual(expected);
    },
  );

  test("a line about somebody with no name to give names nobody, rather than an empty name", () => {
    expect(
      readOnCallTestPageStepLine({
        statusMessage: NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
      }),
    ).toEqual({ code: OnCallTestPageLineCode.NotProjectMember });
    expect(
      readOnCallTestPageStepLine({
        statusMessage: getOnCallNoVerifiedMethodStatusMessage(PERSON),
        userName: "",
      }),
    ).toEqual({ code: OnCallTestPageLineCode.NoVerifiedMethod });
  });

  test("an older run's level line, an error's own words and nothing at all: no code", () => {
    for (const statusMessage of [
      LEGACY_ON_CALL_LEVEL_NO_USERS_TIMELINE_MESSAGE,
      "Error sending notification: connect ECONNREFUSED 10.0.0.4:443",
      "Skipped because this user is away until tomorrow.",
      "",
    ]) {
      expect([
        statusMessage,
        readOnCallTestPageStepLine({
          statusMessage: statusMessage,
          userName: PERSON,
        }),
      ]).toEqual([statusMessage, null]);
    }

    expect(readOnCallTestPageStepLine({ statusMessage: null })).toBeNull();
  });
});

describe("the test's own line, as a code (readOnCallTestPageRunLine)", () => {
  test.each([
    [
      ON_CALL_TEST_PAGE_NOBODY_PAGED_MESSAGE,
      { code: OnCallTestPageLineCode.NobodyPaged },
    ],
    [
      ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
      { code: OnCallTestPageLineCode.NobodyPaged },
    ],
    [
      ON_CALL_TEST_PAGE_FIRST_LEVEL_REACHED_NOBODY_MESSAGE,
      { code: OnCallTestPageLineCode.FirstLevelReachedNobody },
    ],
    [
      ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE,
      {
        code: OnCallTestPageLineCode.EndedUnanswered,
        minutes: ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES,
      },
    ],
    [
      ON_CALL_TEST_PAGE_WENT_THROUGH_EVERY_LEVEL_MESSAGE,
      { code: OnCallTestPageLineCode.WentThroughEveryLevel },
    ],
    [
      ON_CALL_POLICY_HAS_NO_ESCALATION_RULES_MESSAGE,
      { code: OnCallTestPageLineCode.PolicyHasNoLevels },
    ],
  ] as Array<[string, OnCallTestPageLine]>)(
    "%s",
    (statusMessage: string, expected: OnCallTestPageLine) => {
      expect(readOnCallTestPageRunLine(statusMessage)).toEqual(expected);
    },
  );

  test("the minutes the test waited are the ones its line says", () => {
    expect(ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE).toBe(
      `Test ended: nobody acknowledged it within ${ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES} minutes.`,
    );
  });

  test("a test still paging, or one acknowledged, has no code: it is not a line that needs words", () => {
    for (const statusMessage of [
      ON_CALL_TEST_PAGE_FIRST_LEVEL_PAGED_MESSAGE,
      "Test page acknowledged by Ana Lopez by SMS after 14 seconds.",
      "",
    ]) {
      expect([statusMessage, readOnCallTestPageRunLine(statusMessage)]).toEqual(
        [statusMessage, null],
      );
    }

    expect(readOnCallTestPageRunLine(undefined)).toBeNull();
  });
});

describe("every code a reader gives is one the enum names, and every code is given by some line", () => {
  test("no code is left without a line that reads into it", () => {
    const given: Set<OnCallTestPageLineCode> =
      new Set<OnCallTestPageLineCode>();

    const add: (line: OnCallTestPageLine | null) => void = (
      line: OnCallTestPageLine | null,
    ): void => {
      if (line) {
        given.add(line.code);
      }
    };

    add(
      readOnCallTestPageDeliveryLine({
        statusMessage: getOnCallTestPageNotVerifiedMessage({
          channel: OnCallPageChannel.SMS,
          address: "+15550100",
        }),
        channel: OnCallPageChannel.SMS,
      }),
    );
    add(
      readOnCallTestPageDeliveryLine({
        statusMessage: getProjectNotificationChannelOffMessage(
          ProjectNotificationChannel.SMS,
        ),
        channel: OnCallPageChannel.SMS,
      }),
    );
    add(
      readOnCallTestPageDeliveryLine({
        statusMessage: PUSH_NOT_SENT_TO_APP_THAT_NO_LONGER_RECEIVES_MESSAGE,
        channel: OnCallPageChannel.Push,
      }),
    );

    for (const statusMessage of [
      NO_NOTIFICATION_RULES_STATUS_MESSAGE,
      NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
      ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE,
      NOBODY_NEXT_IN_ROTATION_TIMELINE_MESSAGE,
      NOBODY_ON_CALL_IN_SCHEDULE_TIMELINE_MESSAGE,
      ALREADY_PAGED_TIMELINE_MESSAGE,
      SENDING_NOTIFICATION_TO_USER_TIMELINE_MESSAGE,
      ON_CALL_TEST_PAGE_RULES_RAN_MESSAGE,
      ON_CALL_TEST_PAGE_RUN_UNREADABLE_MESSAGE,
      getOnCallEmptyLevelTimelineMessage({ namesAnybody: false }),
      getOnCallEmptyLevelTimelineMessage({ namesAnybody: true }),
      getAwayTimelineMessage(new Date("2026-11-20T09:00:00.000Z")),
      getOnCallOptedOutStatusMessage({
        severityName: "Sev4",
        pagedFor: "incidents",
      }),
      getOnCallFallbackNotifiedStatusMessage({
        severityName: "Sev1",
        channelsUsed: ["Email"],
      }),
      getOnCallNoVerifiedMethodStatusMessage(PERSON),
      getOnCallFallbackFailedStatusMessage({
        responderLabel: PERSON,
        severityName: "Sev1",
      }),
    ]) {
      add(
        readOnCallTestPageStepLine({
          statusMessage: statusMessage,
          userName: PERSON,
          teamName: "Platform",
          scheduleName: "Nights",
        }),
      );
    }

    for (const statusMessage of [
      ON_CALL_TEST_PAGE_NOBODY_PAGED_MESSAGE,
      ON_CALL_TEST_PAGE_FIRST_LEVEL_REACHED_NOBODY_MESSAGE,
      ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE,
      ON_CALL_TEST_PAGE_WENT_THROUGH_EVERY_LEVEL_MESSAGE,
      ON_CALL_POLICY_HAS_NO_ESCALATION_RULES_MESSAGE,
    ]) {
      add(readOnCallTestPageRunLine(statusMessage));
    }

    expect(Array.from(given).sort()).toEqual(
      Object.values(OnCallTestPageLineCode).sort(),
    );
  });
});
