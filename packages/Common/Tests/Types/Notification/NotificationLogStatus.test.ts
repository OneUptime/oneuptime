import CallStatus from "../../../Types/Call/CallStatus";
import { getSentToCallAndSmsGatewayMessage } from "../../../Types/CallAndSMS/CallAndSmsGatewayLine";
import MailStatus from "../../../Types/Mail/MailStatus";
import NotificationLogKind from "../../../Types/Notification/NotificationLogKind";
import {
  NOTIFICATION_LOG_FILTER_STATUSES,
  NOTIFICATION_LOG_STATUS_FILTER_OPTIONS,
  NotificationLogStatusLine,
  NotificationLogStatusMeaning,
  NotificationLogStatusReading,
  NotificationLogStatusWords,
  getNotificationLogStatusWords,
  readNotificationLogStatusLine,
  readPageNotificationLogStatus,
} from "../../../Types/Notification/NotificationLogStatus";
import { WhoWasToldLogKind } from "../../../Types/Notification/WhoWasTold";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  CALL_ANSWERED_MESSAGE,
  CALL_BUSY_MESSAGE,
  CALL_NOT_CONNECTED_MESSAGE,
  CALL_RANG_OUT_MESSAGE,
  CALL_VOICEMAIL_MESSAGE_LEFT_MESSAGE,
  getCallAnsweredAndLastedMessage,
  getCallIdStatusMessage,
  getCallOutcomeMessage,
  getMessageIdStatusMessage,
  getProviderDeliveryStatusMessage,
} from "../../../Types/OnCallDutyPolicy/OnCallSentLine";
import PushStatus from "../../../Types/PushNotification/PushStatus";
import SmsStatus from "../../../Types/SmsStatus";
import TelegramStatus from "../../../Types/TelegramStatus";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import WebhookStatus from "../../../Types/WebhookStatus";
import WhatsAppStatus from "../../../Types/WhatsAppStatus";
import WorkspaceNotificationStatus from "../../../Types/Workspace/WorkspaceNotificationStatus";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT EVERY NOTIFICATION LOG STATUS MEANS, DEFINED ONCE (#11138, #11416).
 *
 * The notification logs, Who Was Told, a test page's result and a person's
 * On-Call Logs read what a message's status means from one place, in
 * Common, so the server says where a person stands by the same meanings the
 * Dashboard draws. These hold that place to its rules: what a log's message
 * says that changes what its status means (an SMS or a call the server's own
 * gateway took, a call Twilio said was answered), the meanings it gives each
 * status, the sentence that only a log says, and what a page's own
 * notification says of its log for certain.
 */

const SMS_SID: string = "SM1342fe1b2c904d1ab04f0fc7a58abca9";
const CALL_SID: string = "CA1342fe1b2c904d1ab04f0fc7a58abca9";
const GATEWAY_SENT_LINE: string = getSentToCallAndSmsGatewayMessage(200);
const TWILIO_SENT_LINE: string = getProviderDeliveryStatusMessage({
  status: SmsStatus.Sent,
  messageId: SMS_SID,
});
const ANSWERED_LINE: string = getCallOutcomeMessage({
  callId: CALL_SID,
  sentence: getCallAnsweredAndLastedMessage(42),
});

function wordsOf(data: {
  kind: NotificationLogKind;
  status: string;
  statusMessage?: string | undefined;
  line?: NotificationLogStatusLine | undefined;
}): NotificationLogStatusWords {
  const words: NotificationLogStatusWords | null =
    getNotificationLogStatusWords(data);

  expect(words).not.toBeNull();

  return words!;
}

// Every status each log's enum holds.
const STATUSES_OF: Readonly<
  Record<NotificationLogKind, ReadonlyArray<string>>
> = {
  [NotificationLogKind.Email]: Object.values(MailStatus),
  [NotificationLogKind.SMS]: Object.values(SmsStatus),
  [NotificationLogKind.Call]: Object.values(CallStatus),
  [NotificationLogKind.Push]: Object.values(PushStatus),
  [NotificationLogKind.WhatsApp]: Object.values(WhatsAppStatus),
  [NotificationLogKind.Telegram]: Object.values(TelegramStatus),
  [NotificationLogKind.Webhook]: Object.values(WebhookStatus),
  [NotificationLogKind.Workspace]: Object.values(WorkspaceNotificationStatus),
};

const KINDS: ReadonlyArray<NotificationLogKind> = Object.values(
  NotificationLogKind,
) as Array<NotificationLogKind>;

describe("the eight logs, one kind each", () => {
  test("Who Was Told reads a record's notifications by the same kinds, the same values", () => {
    expect(WhoWasToldLogKind).toBe(NotificationLogKind);
    expect(Object.values(NotificationLogKind)).toEqual([
      "Email",
      "SMS",
      "Call",
      "Push",
      "WhatsApp",
      "Telegram",
      "Webhook",
      "Workspace",
    ]);
  });
});

describe("what a log's message says that changes what its status means", () => {
  test("an SMS the server's own gateway took is Sent for good", () => {
    expect(
      readNotificationLogStatusLine({
        kind: NotificationLogKind.SMS,
        status: SmsStatus.Sent,
        statusMessage: GATEWAY_SENT_LINE,
      }),
    ).toBe(NotificationLogStatusLine.SentToGateway);
  });

  test("an SMS Twilio's carrier took says nothing more, whatever its message", () => {
    for (const statusMessage of [
      TWILIO_SENT_LINE,
      getMessageIdStatusMessage(SMS_SID),
      "",
      undefined,
      null,
    ]) {
      expect(
        readNotificationLogStatusLine({
          kind: NotificationLogKind.SMS,
          status: SmsStatus.Sent,
          statusMessage: statusMessage,
        }),
      ).toBeNull();
    }
  });

  test("a call Twilio said was answered, with or without its id and its duration", () => {
    for (const statusMessage of [
      ANSWERED_LINE,
      CALL_ANSWERED_MESSAGE,
      getCallOutcomeMessage({
        callId: CALL_SID,
        sentence: CALL_ANSWERED_MESSAGE,
      }),
      getCallAnsweredAndLastedMessage(1),
    ]) {
      expect({
        statusMessage,
        line: readNotificationLogStatusLine({
          kind: NotificationLogKind.Call,
          status: CallStatus.Success,
          statusMessage: statusMessage,
        }),
      }).toEqual({
        statusMessage,
        line: NotificationLogStatusLine.Answered,
      });
    }
  });

  test("a call the gateway took is a call the gateway took, never an answer", () => {
    expect(
      readNotificationLogStatusLine({
        kind: NotificationLogKind.Call,
        status: CallStatus.Success,
        statusMessage: GATEWAY_SENT_LINE,
      }),
    ).toBe(NotificationLogStatusLine.SentToGateway);
  });

  test("a call that was not answered, or only placed, says nothing that changes its Success", () => {
    for (const statusMessage of [
      getCallIdStatusMessage(CALL_SID),
      getCallOutcomeMessage({
        callId: CALL_SID,
        sentence: CALL_RANG_OUT_MESSAGE,
      }),
      CALL_BUSY_MESSAGE,
      CALL_NOT_CONNECTED_MESSAGE,
      CALL_VOICEMAIL_MESSAGE_LEFT_MESSAGE,
      "The call was answered and lasted many seconds.",
      "",
    ]) {
      expect({
        statusMessage,
        line: readNotificationLogStatusLine({
          kind: NotificationLogKind.Call,
          status: CallStatus.Success,
          statusMessage: statusMessage,
        }),
      }).toEqual({ statusMessage, line: null });
    }
  });

  test("the lines change only an SMS's Sent and a call's Success: on any other status or log they say nothing", () => {
    const cases: Array<[NotificationLogKind, string, string]> = [
      [NotificationLogKind.SMS, SmsStatus.Delivered, GATEWAY_SENT_LINE],
      [NotificationLogKind.SMS, SmsStatus.Success, GATEWAY_SENT_LINE],
      [NotificationLogKind.Call, CallStatus.Calling, ANSWERED_LINE],
      [NotificationLogKind.Call, CallStatus.Calling, GATEWAY_SENT_LINE],
      [NotificationLogKind.Call, CallStatus.MissedCall, ANSWERED_LINE],
      [NotificationLogKind.WhatsApp, WhatsAppStatus.Sent, GATEWAY_SENT_LINE],
      [NotificationLogKind.Telegram, TelegramStatus.Sent, GATEWAY_SENT_LINE],
      [NotificationLogKind.Email, MailStatus.Success, ANSWERED_LINE],
    ];

    for (const [kind, status, statusMessage] of cases) {
      expect({
        kind,
        status,
        line: readNotificationLogStatusLine({
          kind: kind,
          status: status,
          statusMessage: statusMessage,
        }),
      }).toEqual({ kind, status, line: null });
    }
  });
});

describe("a page that carries what the message says reads a status as one with the message does", () => {
  const MESSAGES: Array<[NotificationLogKind, string, string]> = [
    [NotificationLogKind.SMS, SmsStatus.Sent, GATEWAY_SENT_LINE],
    [NotificationLogKind.SMS, SmsStatus.Sent, TWILIO_SENT_LINE],
    [NotificationLogKind.Call, CallStatus.Success, ANSWERED_LINE],
    [NotificationLogKind.Call, CallStatus.Success, GATEWAY_SENT_LINE],
    [
      NotificationLogKind.Call,
      CallStatus.Success,
      getCallIdStatusMessage(CALL_SID),
    ],
  ];

  test.each(MESSAGES)(
    "%s %s, %s",
    (kind: NotificationLogKind, status: string, statusMessage: string) => {
      const line: NotificationLogStatusLine | null =
        readNotificationLogStatusLine({
          kind: kind,
          status: status,
          statusMessage: statusMessage,
        });

      expect(
        wordsOf({ kind: kind, status: status, line: line || undefined }),
      ).toEqual(
        wordsOf({ kind: kind, status: status, statusMessage: statusMessage }),
      );
    },
  );

  test("a line the status has no use for changes nothing", () => {
    expect(
      wordsOf({
        kind: NotificationLogKind.SMS,
        status: SmsStatus.Sent,
        line: NotificationLogStatusLine.Answered,
      }),
    ).toEqual(
      wordsOf({ kind: NotificationLogKind.SMS, status: SmsStatus.Sent }),
    );
    expect(
      wordsOf({
        kind: NotificationLogKind.Email,
        status: MailStatus.Success,
        line: NotificationLogStatusLine.SentToGateway,
      }),
    ).toEqual(
      wordsOf({ kind: NotificationLogKind.Email, status: MailStatus.Success }),
    );
  });
});

describe("where each message stands", () => {
  test("it reached them: delivered, read, an answered call", () => {
    const reached: Array<NotificationLogStatusReading> = [
      { kind: NotificationLogKind.SMS, status: SmsStatus.Delivered },
      { kind: NotificationLogKind.WhatsApp, status: WhatsAppStatus.Delivered },
      { kind: NotificationLogKind.WhatsApp, status: WhatsAppStatus.Read },
      { kind: NotificationLogKind.Telegram, status: TelegramStatus.Delivered },
      { kind: NotificationLogKind.Telegram, status: TelegramStatus.Read },
      {
        kind: NotificationLogKind.Call,
        status: CallStatus.Success,
        line: NotificationLogStatusLine.Answered,
      },
    ];

    for (const reading of reached) {
      expect({ reading, meaning: wordsOf(reading).meaning }).toEqual({
        reading,
        meaning: NotificationLogStatusMeaning.Reached,
      });
    }
  });

  test("its last status, with nothing more to come: a gateway's SMS or call, Telegram's Sent, an email, a push, a webhook, a workspace's action", () => {
    const done: Array<NotificationLogStatusReading> = [
      {
        kind: NotificationLogKind.SMS,
        status: SmsStatus.Sent,
        line: NotificationLogStatusLine.SentToGateway,
      },
      {
        kind: NotificationLogKind.Call,
        status: CallStatus.Success,
        line: NotificationLogStatusLine.SentToGateway,
      },
      // Placed, and never told how it ended.
      { kind: NotificationLogKind.Call, status: CallStatus.Success },
      { kind: NotificationLogKind.Telegram, status: TelegramStatus.Sent },
      { kind: NotificationLogKind.Email, status: MailStatus.Success },
      { kind: NotificationLogKind.Push, status: PushStatus.Success },
      { kind: NotificationLogKind.Webhook, status: WebhookStatus.Success },
      {
        kind: NotificationLogKind.Workspace,
        status: WorkspaceNotificationStatus.Success,
      },
      { kind: NotificationLogKind.SMS, status: SmsStatus.Success },
      { kind: NotificationLogKind.WhatsApp, status: WhatsAppStatus.Success },
    ];

    for (const reading of done) {
      expect({ reading, meaning: wordsOf(reading).meaning }).toEqual({
        reading,
        meaning: NotificationLogStatusMeaning.Done,
      });
    }
  });

  test("on its way: an SMS its carrier accepted, a call still ringing, a WhatsApp message sent", () => {
    for (const reading of [
      { kind: NotificationLogKind.SMS, status: SmsStatus.Sent },
      { kind: NotificationLogKind.Call, status: CallStatus.Calling },
      { kind: NotificationLogKind.WhatsApp, status: WhatsAppStatus.Sent },
    ]) {
      expect({ reading, meaning: wordsOf(reading).meaning }).toEqual({
        reading,
        meaning: NotificationLogStatusMeaning.OnItsWay,
      });
    }
  });

  test("the same word, four meanings: the reason Who Was Told could not say Sent of them all", () => {
    expect(
      [
        { kind: NotificationLogKind.SMS, status: SmsStatus.Sent },
        {
          kind: NotificationLogKind.SMS,
          status: SmsStatus.Sent,
          line: NotificationLogStatusLine.SentToGateway,
        },
        { kind: NotificationLogKind.Call, status: CallStatus.Calling },
        {
          kind: NotificationLogKind.Call,
          status: CallStatus.Success,
          line: NotificationLogStatusLine.Answered,
        },
      ].map((reading: NotificationLogStatusReading) => {
        const words: NotificationLogStatusWords = wordsOf(reading);

        return [words.text, words.meaning];
      }),
    ).toEqual([
      ["Sent", NotificationLogStatusMeaning.OnItsWay],
      ["Sent", NotificationLogStatusMeaning.Done],
      ["Calling", NotificationLogStatusMeaning.OnItsWay],
      ["Success", NotificationLogStatusMeaning.Reached],
    ]);
  });
});

describe("what only a log says", () => {
  // The columns and buttons of a log's own table a sentence can name.
  const LOG_PARTS: ReadonlyArray<string> = [
    "View Status Message",
    "Error Code",
    "HTTP Status",
    "Reason",
  ];

  const everyReading: Array<NotificationLogStatusReading> = KINDS.flatMap(
    (kind: NotificationLogKind): Array<NotificationLogStatusReading> => {
      return STATUSES_OF[kind].map(
        (status: string): NotificationLogStatusReading => {
          return { kind: kind, status: status };
        },
      );
    },
  ).concat([
    {
      kind: NotificationLogKind.SMS,
      status: SmsStatus.Sent,
      line: NotificationLogStatusLine.SentToGateway,
    },
    {
      kind: NotificationLogKind.Call,
      status: CallStatus.Success,
      line: NotificationLogStatusLine.Answered,
    },
    {
      kind: NotificationLogKind.Call,
      status: CallStatus.Success,
      line: NotificationLogStatusLine.SentToGateway,
    },
    // A status OneUptime does not know.
    { kind: NotificationLogKind.SMS, status: "Delivered-ish" },
  ]);

  test("a sentence that names a log's own column or button is said apart, never in what is said everywhere", () => {
    for (const reading of everyReading) {
      const words: NotificationLogStatusWords = wordsOf(reading);

      for (const sentence of words.explanation) {
        for (const part of LOG_PARTS) {
          expect({
            reading,
            sentence,
            namesALogPart: sentence.includes(part),
          }).toEqual({
            reading,
            sentence,
            namesALogPart: false,
          });
        }
      }

      if (words.inTheLog) {
        expect({
          reading,
          inTheLog: words.inTheLog,
          namesALogPart: LOG_PARTS.some((part: string): boolean => {
            return words.inTheLog!.startsWith(part);
          }),
        }).toEqual({
          reading,
          inTheLog: words.inTheLog,
          namesALogPart: true,
        });
      }
    }
  });

  test("every status still says what happened, away from its log too", () => {
    for (const reading of everyReading) {
      const words: NotificationLogStatusWords = wordsOf(reading);

      expect({ reading, says: words.explanation.length >= 1 }).toEqual({
        reading,
        says: true,
      });
    }
  });

  test("what the logs said before is said still, the log's own sentence last", () => {
    expect(
      wordsOf({ kind: NotificationLogKind.SMS, status: SmsStatus.Undelivered }),
    ).toEqual({
      text: "Undelivered",
      meaning: NotificationLogStatusMeaning.NotSent,
      explanation: [
        "The carrier could not deliver the SMS, for example because the phone was off or the number cannot receive texts.",
      ],
      inTheLog: "Error Code says why.",
    });
    expect(
      wordsOf({
        kind: NotificationLogKind.Call,
        status: CallStatus.Success,
        statusMessage: ANSWERED_LINE,
      }),
    ).toEqual({
      text: "Success",
      meaning: NotificationLogStatusMeaning.Reached,
      explanation: ["The call was answered."],
      inTheLog: "View Status Message says how long it lasted.",
    });
  });
});

describe("what a page's own notification says of its log, for certain", () => {
  function reading(
    channel: OnCallPageChannel | null,
    status: UserNotificationStatus | string,
    statusMessage?: string | undefined,
  ): NotificationLogStatusReading | null {
    return readPageNotificationLogStatus({
      channel: channel,
      status: status,
      statusMessage: statusMessage,
    });
  }

  test("a provider that says nothing after it takes a message: its log holds its last status", () => {
    expect(
      reading(OnCallPageChannel.Email, UserNotificationStatus.Sent),
    ).toEqual({
      kind: NotificationLogKind.Email,
      status: MailStatus.Success,
    });
    expect(
      reading(OnCallPageChannel.Push, UserNotificationStatus.Sent),
    ).toEqual({
      kind: NotificationLogKind.Push,
      status: PushStatus.Success,
    });
    expect(
      reading(OnCallPageChannel.Telegram, UserNotificationStatus.Sent),
    ).toEqual({
      kind: NotificationLogKind.Telegram,
      status: TelegramStatus.Sent,
    });
    expect(
      reading(OnCallPageChannel.Webhook, UserNotificationStatus.Sent),
    ).toEqual({
      kind: NotificationLogKind.Webhook,
      status: WebhookStatus.Success,
    });

    for (const channel of [
      OnCallPageChannel.Slack,
      OnCallPageChannel.MicrosoftTeams,
      OnCallPageChannel.Mattermost,
    ]) {
      expect(reading(channel, UserNotificationStatus.Sent)).toEqual({
        kind: NotificationLogKind.Workspace,
        status: WorkspaceNotificationStatus.Success,
      });
    }
  });

  test("an SMS or a call the gateway took, and a call Twilio said was answered: the line the log keeps too", () => {
    expect(
      reading(
        OnCallPageChannel.SMS,
        UserNotificationStatus.Sent,
        GATEWAY_SENT_LINE,
      ),
    ).toEqual({
      kind: NotificationLogKind.SMS,
      status: SmsStatus.Sent,
      line: NotificationLogStatusLine.SentToGateway,
    });
    expect(
      reading(
        OnCallPageChannel.Call,
        UserNotificationStatus.Sent,
        GATEWAY_SENT_LINE,
      ),
    ).toEqual({
      kind: NotificationLogKind.Call,
      status: CallStatus.Success,
      line: NotificationLogStatusLine.SentToGateway,
    });
    expect(
      reading(
        OnCallPageChannel.Call,
        UserNotificationStatus.Sent,
        ANSWERED_LINE,
      ),
    ).toEqual({
      kind: NotificationLogKind.Call,
      status: CallStatus.Success,
      line: NotificationLogStatusLine.Answered,
    });
  });

  test("an SMS or a WhatsApp message on its way or delivered, a call ringing: its own log says which, not the notification", () => {
    expect(
      reading(
        OnCallPageChannel.SMS,
        UserNotificationStatus.Sent,
        getMessageIdStatusMessage(SMS_SID),
      ),
    ).toBeNull();
    expect(
      reading(
        OnCallPageChannel.Call,
        UserNotificationStatus.Sent,
        getCallIdStatusMessage(CALL_SID),
      ),
    ).toBeNull();
    expect(
      reading(OnCallPageChannel.WhatsApp, UserNotificationStatus.Sent),
    ).toBeNull();
    // A custom channel keeps no log.
    expect(
      reading(OnCallPageChannel.CustomChannel, UserNotificationStatus.Sent),
    ).toBeNull();
    expect(reading(null, UserNotificationStatus.Sent)).toBeNull();
  });

  test("a notification that did not go out, or that the person answered or escalated from, says more than its log", () => {
    for (const status of [
      UserNotificationStatus.Sending,
      UserNotificationStatus.Error,
      UserNotificationStatus.Skipped,
      UserNotificationStatus.Acknowledged,
      UserNotificationStatus.PassedOn,
      UserNotificationStatus.NotAnswered,
      "Odd",
      "",
    ]) {
      for (const channel of Object.values(OnCallPageChannel)) {
        expect({
          status,
          channel,
          log: reading(channel, status, ANSWERED_LINE),
        }).toEqual({ status, channel, log: null });
      }
    }
  });

  test("whatever it reads is a status its log can hold", () => {
    for (const channel of Object.values(OnCallPageChannel)) {
      for (const statusMessage of [GATEWAY_SENT_LINE, ANSWERED_LINE, ""]) {
        const log: NotificationLogStatusReading | null = reading(
          channel,
          UserNotificationStatus.Sent,
          statusMessage,
        );

        if (log) {
          expect(STATUSES_OF[log.kind]).toContain(log.status);
          expect(wordsOf(log).isTextAsWritten).toBeFalsy();
        }
      }
    }
  });
});

describe("each log's Status filter", () => {
  test("offers each status of its log once, and every one it offers is the log's own", () => {
    for (const kind of KINDS) {
      const statuses: ReadonlyArray<string> =
        NOTIFICATION_LOG_FILTER_STATUSES[kind];

      expect(new Set(statuses).size).toBe(statuses.length);

      for (const status of statuses) {
        expect(STATUSES_OF[kind]).toContain(status);
      }

      expect(
        NOTIFICATION_LOG_STATUS_FILTER_OPTIONS[kind].map(
          (option: { value: string; label: string }) => {
            return option.label;
          },
        ),
      ).toEqual(
        statuses.map((status: string): string => {
          return wordsOf({ kind: kind, status: status }).text;
        }),
      );
    }
  });
});

// What only a page imports: React, the Dashboard, Common/UI.
const PAGE_MODULE: RegExp = /react|UI\/|Dashboard/i;

describe("read on the server as in the browser", () => {
  test("the definition imports nothing of a page's: no React, no Dashboard, no Common/UI", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../Types/Notification/NotificationLogStatus.ts",
      ),
      "utf8",
    );
    const imports: Array<string> = Array.from(
      source.matchAll(/from "([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(imports.length).toBeGreaterThan(0);

    for (const specifier of imports) {
      expect({
        specifier,
        isAPage: PAGE_MODULE.test(specifier),
      }).toEqual({
        specifier,
        isAPage: false,
      });
    }
  });
});
