import {
  getNotificationLogStatusFilterOptions,
  getNotificationLogStatusWords,
  NOTIFICATION_LOG_FILTER_STATUSES,
  NOTIFICATION_LOG_STATUS_TONES,
  NOTIFICATION_LOGS_DOCUMENTATION,
  NotificationLogKind,
  NotificationLogStatusMeaning,
  NotificationLogStatusWords,
} from "../../FeatureSet/Dashboard/src/Components/NotificationLogs/NotificationLogStatus";
import {
  LOCALES_DIRECTORY,
  TRANSLATED_LOCALES,
} from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import CallStatus from "Common/Types/Call/CallStatus";
import { getSentToCallAndSmsGatewayMessage } from "Common/Types/CallAndSMS/CallAndSmsGatewayLine";
import MailStatus from "Common/Types/Mail/MailStatus";
import {
  MEANING_KEYS,
  withMeaningKeyAsItsWord,
} from "Common/Types/MeaningKeys";
import {
  CALL_ANSWERED_MESSAGE,
  CALL_RANG_OUT_MESSAGE,
  getCallAnsweredAndLastedMessage,
  getCallIdStatusMessage,
  getCallOutcomeMessage,
  getMessageIdStatusMessage,
  getProviderDeliveryStatusMessage,
} from "Common/Types/OnCallDutyPolicy/OnCallSentLine";
import PushStatus from "Common/Types/PushNotification/PushStatus";
import SmsStatus from "Common/Types/SmsStatus";
import TelegramStatus from "Common/Types/TelegramStatus";
import WebhookStatus from "Common/Types/WebhookStatus";
import WhatsAppStatus from "Common/Types/WhatsAppStatus";
import WorkspaceNotificationStatus from "Common/Types/Workspace/WorkspaceNotificationStatus";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT EVERY NOTIFICATION LOG STATUS MEANS, AND ITS COLOUR (#11138).
 *
 * "What are the statuses in SMS Logs? Is Sent or Delivered the last one on
 * the happy path - and should Sent not be green?" A customer had to ask:
 * the SMS log drew Sent - the carrier took the SMS, its delivery receipt
 * still to come - in the green of Delivered, and no log said what any of
 * its statuses meant. Each status of the eight logs is placed once, by what
 * it means (NotificationLogStatus), and these hold it there:
 *
 *   - its colour: grey while it is handed over, blue while the provider is
 *     still to say how it ended, green once it reached them or nothing more
 *     will be said, yellow when nobody answered, red when it did not go;
 *   - the same word means the same colour in every log - but Sent, which
 *     means "on its way" for an SMS Twilio's carrier took and a WhatsApp
 *     message, and "its last status" for a Telegram message and an SMS the
 *     server's own gateway took (CallAndSmsGatewayLine);
 *   - every status has its plain sentences, every word and sentence is a
 *     key of every language the Dashboard ships, and each language names a
 *     status, a button or a column inside a sentence as its pills, buttons
 *     and columns name it;
 *   - each log's Status filter offers every status it can hold, in the
 *     order a message moves through them - six of the eight offered none.
 */

const ENGLISH: Record<string, string> = readLocale("en");

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIRECTORY, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

function wordsOf(
  kind: NotificationLogKind,
  status: string,
  statusMessage?: string | undefined,
): NotificationLogStatusWords {
  const words: NotificationLogStatusWords | null =
    getNotificationLogStatusWords({
      kind: kind,
      status: status,
      statusMessage: statusMessage,
    });

  expect(words).not.toBeNull();

  return words!;
}

function toneOf(
  kind: NotificationLogKind,
  status: string,
  statusMessage?: string | undefined,
): PillTone {
  return NOTIFICATION_LOG_STATUS_TONES[
    wordsOf(kind, status, statusMessage).meaning
  ];
}

// The explanation as English reads it: its sentences, one after another.
function explanationOf(
  kind: NotificationLogKind,
  status: string,
  statusMessage?: string | undefined,
): string {
  return wordsOf(kind, status, statusMessage).explanation.join(" ");
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

// The lines a log's message holds, as the senders and callbacks write them.
const SMS_SID: string = "SM1342fe1b2c904d1ab04f0fc7a58abca9";
const CALL_SID: string = "CA1342fe1b2c904d1ab04f0fc7a58abca9";
const TWILIO_SENT_LINE: string = getProviderDeliveryStatusMessage({
  status: SmsStatus.Sent,
  messageId: SMS_SID,
});
const GATEWAY_SENT_LINE: string = getSentToCallAndSmsGatewayMessage(200);

// Every status, with every message that changes what it says.
function everyCase(): Array<{
  kind: NotificationLogKind;
  status: string;
  statusMessage?: string | undefined;
}> {
  const cases: Array<{
    kind: NotificationLogKind;
    status: string;
    statusMessage?: string | undefined;
  }> = [];

  for (const kind of KINDS) {
    for (const status of STATUSES_OF[kind]) {
      cases.push({ kind: kind, status: status });
    }
  }

  cases.push(
    {
      kind: NotificationLogKind.SMS,
      status: SmsStatus.Sent,
      statusMessage: GATEWAY_SENT_LINE,
    },
    {
      kind: NotificationLogKind.Call,
      status: CallStatus.Success,
      statusMessage: getCallOutcomeMessage({
        callId: CALL_SID,
        sentence: getCallAnsweredAndLastedMessage(42),
      }),
    },
    {
      kind: NotificationLogKind.Call,
      status: CallStatus.Success,
      statusMessage: GATEWAY_SENT_LINE,
    },
  );

  return cases;
}

describe("the question that was asked (#11138)", () => {
  test("an SMS the carrier accepted is Sent, in blue - on its way, never the green of Delivered", () => {
    expect(
      toneOf(NotificationLogKind.SMS, SmsStatus.Sent, TWILIO_SENT_LINE),
    ).toBe(PillTone.Info);
    expect(
      toneOf(NotificationLogKind.SMS, SmsStatus.Sent, TWILIO_SENT_LINE),
    ).not.toBe(PillTone.Success);
  });

  test("Sent says what comes next, and that it can stay Sent when the carrier never reports back", () => {
    expect(
      explanationOf(NotificationLogKind.SMS, SmsStatus.Sent, TWILIO_SENT_LINE),
    ).toBe(
      "The carrier accepted the SMS. It moves to Delivered or Undelivered once the carrier reports back. Some carriers never report back, so an SMS can stay Sent.",
    );
  });

  test("Delivered is the last status on the happy path: green, and it says so", () => {
    expect(toneOf(NotificationLogKind.SMS, SmsStatus.Delivered)).toBe(
      PillTone.Success,
    );
    expect(explanationOf(NotificationLogKind.SMS, SmsStatus.Delivered)).toBe(
      "The carrier confirmed the SMS reached the phone. This is its last status.",
    );
  });

  test("the SMS statuses, in the order an SMS moves through them, each in its colour", () => {
    expect(
      NOTIFICATION_LOG_FILTER_STATUSES[NotificationLogKind.SMS].map(
        (status: string) => {
          return [status, toneOf(NotificationLogKind.SMS, status)];
        },
      ),
    ).toEqual([
      [SmsStatus.Sending, PillTone.Neutral],
      [SmsStatus.Sent, PillTone.Info],
      [SmsStatus.Delivered, PillTone.Success],
      [SmsStatus.Undelivered, PillTone.Danger],
      [SmsStatus.Failed, PillTone.Danger],
      [SmsStatus.Error, PillTone.Danger],
      [SmsStatus.LowBalance, PillTone.Danger],
      [SmsStatus.Success, PillTone.Success],
    ]);
  });

  test("an SMS still on its way to the carrier is Sending, grey, and says what it moves to", () => {
    expect(toneOf(NotificationLogKind.SMS, SmsStatus.Sending)).toBe(
      PillTone.Neutral,
    );
    expect(explanationOf(NotificationLogKind.SMS, SmsStatus.Sending)).toBe(
      "OneUptime handed the SMS to Twilio, which is passing it to the carrier. It moves to Sent once the carrier accepts it.",
    );
  });

  test("an SMS the server's own gateway took is Sent for good: green, and says the gateway reports nothing", () => {
    expect(
      toneOf(NotificationLogKind.SMS, SmsStatus.Sent, GATEWAY_SENT_LINE),
    ).toBe(PillTone.Success);
    expect(
      explanationOf(NotificationLogKind.SMS, SmsStatus.Sent, GATEWAY_SENT_LINE),
    ).toBe(
      "Your SMS and call gateway accepted the SMS. Gateways do not report delivery, so this is its last status.",
    );
  });

  test("an SMS Twilio's carrier accepted reads as Twilio's whatever its message: the id it was sent with, or none", () => {
    for (const message of [
      getMessageIdStatusMessage(SMS_SID),
      TWILIO_SENT_LINE,
      undefined,
      "",
    ]) {
      expect(toneOf(NotificationLogKind.SMS, SmsStatus.Sent, message)).toBe(
        PillTone.Info,
      );
    }
  });

  test("undelivered, failed, not sent: red, and where to read why", () => {
    expect(explanationOf(NotificationLogKind.SMS, SmsStatus.Undelivered)).toBe(
      "The carrier could not deliver the SMS, for example because the phone was off or the number cannot receive texts. Error Code says why.",
    );
    expect(explanationOf(NotificationLogKind.SMS, SmsStatus.Failed)).toBe(
      "Twilio could not send the SMS. Error Code says why.",
    );
    expect(explanationOf(NotificationLogKind.SMS, SmsStatus.Error)).toBe(
      "The SMS was not sent. View Status Message says why.",
    );
    expect(explanationOf(NotificationLogKind.SMS, SmsStatus.LowBalance)).toBe(
      "It was not sent: the project's balance was too low to pay for it. View Status Message says who can add balance.",
    );
  });

  test("an SMS from before delivery was tracked says so", () => {
    expect(explanationOf(NotificationLogKind.SMS, SmsStatus.Success)).toBe(
      "Twilio accepted the SMS. It was sent before OneUptime tracked delivery, so whether it was delivered is not known.",
    );
  });
});

describe("a call's statuses", () => {
  test("ringing: Calling, blue, until Twilio says how it ended", () => {
    expect(toneOf(NotificationLogKind.Call, CallStatus.Calling)).toBe(
      PillTone.Info,
    );
    expect(explanationOf(NotificationLogKind.Call, CallStatus.Calling)).toBe(
      "Twilio placed the call. It changes once Twilio says how the call ended.",
    );
  });

  test("answered: Success, green, and where to read how long it lasted - with or without its duration", () => {
    for (const sentence of [
      getCallAnsweredAndLastedMessage(42),
      getCallAnsweredAndLastedMessage(1),
      CALL_ANSWERED_MESSAGE,
    ]) {
      for (const callId of [CALL_SID, null]) {
        const message: string = getCallOutcomeMessage({
          callId: callId,
          sentence: sentence,
        });

        expect(
          toneOf(NotificationLogKind.Call, CallStatus.Success, message),
        ).toBe(PillTone.Success);
        expect(
          explanationOf(NotificationLogKind.Call, CallStatus.Success, message),
        ).toBe(
          "The call was answered. View Status Message says how long it lasted.",
        );
      }
    }
  });

  test("taken by the server's own gateway: Success, its last status - the gateway says nothing more", () => {
    expect(
      explanationOf(
        NotificationLogKind.Call,
        CallStatus.Success,
        GATEWAY_SENT_LINE,
      ),
    ).toBe(
      "Your SMS and call gateway accepted the call. Gateways do not report whether a call was answered, so this is its last status.",
    );
  });

  test("placed and never told how it ended - before Calling was written, or on a server Twilio cannot call back - says so", () => {
    for (const message of [getCallIdStatusMessage(CALL_SID), undefined, ""]) {
      expect(
        explanationOf(NotificationLogKind.Call, CallStatus.Success, message),
      ).toBe(
        "Twilio placed the call. OneUptime was not told how it ended, so this is its last status.",
      );
    }
  });

  test("a Success whose message says the call was not answered still reads as placed, never as answered", () => {
    expect(
      explanationOf(
        NotificationLogKind.Call,
        CallStatus.Success,
        getCallOutcomeMessage({
          callId: CALL_SID,
          sentence: CALL_RANG_OUT_MESSAGE,
        }),
      ),
    ).not.toContain("answered.");
  });

  test("nobody picked up: yellow, never red - it reached the phone", () => {
    for (const status of [
      CallStatus.MissedCall,
      CallStatus.Busy,
      CallStatus.Voicemail,
    ]) {
      expect(toneOf(NotificationLogKind.Call, status)).toBe(PillTone.Warning);
    }

    expect(explanationOf(NotificationLogKind.Call, CallStatus.MissedCall)).toBe(
      "The call rang out: nobody answered.",
    );
    expect(explanationOf(NotificationLogKind.Call, CallStatus.Busy)).toBe(
      "The line was busy, or the call was declined.",
    );
    expect(explanationOf(NotificationLogKind.Call, CallStatus.Voicemail)).toBe(
      "Voicemail answered the call. View Status Message says whether a message was left.",
    );
  });
});

describe("every other log", () => {
  test("WhatsApp: Queued grey, Sent blue, Delivered and Read green", () => {
    expect(toneOf(NotificationLogKind.WhatsApp, WhatsAppStatus.Queued)).toBe(
      PillTone.Neutral,
    );
    expect(toneOf(NotificationLogKind.WhatsApp, WhatsAppStatus.Sent)).toBe(
      PillTone.Info,
    );
    expect(toneOf(NotificationLogKind.WhatsApp, WhatsAppStatus.Delivered)).toBe(
      PillTone.Success,
    );
    expect(toneOf(NotificationLogKind.WhatsApp, WhatsAppStatus.Read)).toBe(
      PillTone.Success,
    );
    expect(toneOf(NotificationLogKind.WhatsApp, WhatsAppStatus.Warning)).toBe(
      PillTone.Warning,
    );
    expect(
      explanationOf(NotificationLogKind.WhatsApp, WhatsAppStatus.Delivered),
    ).toBe(
      "The message reached the phone. It moves to Read once it is opened, if the person shares read receipts.",
    );
  });

  test("Telegram: Sent is its last status, green - Telegram reports nothing after - and a failure is red, not the yellow it was", () => {
    expect(toneOf(NotificationLogKind.Telegram, TelegramStatus.Sent)).toBe(
      PillTone.Success,
    );
    expect(
      explanationOf(NotificationLogKind.Telegram, TelegramStatus.Sent),
    ).toBe(
      "Telegram posted the message in the chat. Telegram does not report when it is read, so this is its last status.",
    );
    expect(toneOf(NotificationLogKind.Telegram, TelegramStatus.Failed)).toBe(
      PillTone.Danger,
    );
  });

  test("email: Success is the mail server's, the last word, and says delivery is not tracked", () => {
    expect(toneOf(NotificationLogKind.Email, MailStatus.Success)).toBe(
      PillTone.Success,
    );
    expect(explanationOf(NotificationLogKind.Email, MailStatus.Success)).toBe(
      "The mail server accepted the email. OneUptime does not track it further, so this is its last status.",
    );
  });

  test("push: Success says a receipt can still turn it to Error", () => {
    expect(explanationOf(NotificationLogKind.Push, PushStatus.Success)).toBe(
      "The push service accepted the notification for the device. If it reports later that the notification was not delivered, this changes to Error.",
    );
  });

  test("webhook and workspace: what went through, and where to read why not", () => {
    expect(
      explanationOf(NotificationLogKind.Webhook, WebhookStatus.Error),
    ).toBe(
      "The webhook's address refused the request, or could not be reached. View Status Message says why.",
    );
    expect(
      explanationOf(
        NotificationLogKind.Workspace,
        WorkspaceNotificationStatus.Error,
      ),
    ).toBe("The action did not go through. Reason says why.");
  });
});

describe("one meaning, one colour", () => {
  test("nothing still on its way is ever green", () => {
    const onItsWay: Array<[NotificationLogKind, string, string | undefined]> = [
      [NotificationLogKind.SMS, SmsStatus.Sending, undefined],
      [NotificationLogKind.SMS, SmsStatus.Sent, TWILIO_SENT_LINE],
      [NotificationLogKind.Call, CallStatus.Calling, undefined],
      [NotificationLogKind.WhatsApp, WhatsAppStatus.Queued, undefined],
      [NotificationLogKind.WhatsApp, WhatsAppStatus.Sent, undefined],
      [NotificationLogKind.Telegram, TelegramStatus.Queued, undefined],
    ];

    for (const [kind, status, message] of onItsWay) {
      expect({ kind, status, tone: toneOf(kind, status, message) }).toEqual({
        kind,
        status,
        tone: expect.not.stringMatching(PillTone.Success),
      });
      expect([
        NotificationLogStatusMeaning.HandedOver,
        NotificationLogStatusMeaning.OnItsWay,
      ]).toContain(wordsOf(kind, status, message).meaning);
    }
  });

  test("a word means one thing in every log that has it - Sent aside, whose meaning each log's pill says", () => {
    const byWord: Map<string, Set<PillTone>> = new Map<string, Set<PillTone>>();

    for (const kind of KINDS) {
      for (const status of STATUSES_OF[kind]) {
        if (status === SmsStatus.Sent) {
          continue;
        }

        const tones: Set<PillTone> = byWord.get(status) || new Set<PillTone>();
        tones.add(toneOf(kind, status));
        byWord.set(status, tones);
      }
    }

    for (const [word, tones] of byWord) {
      expect({ word, tones: [...tones] }).toEqual({
        word,
        tones: [[...tones][0]],
      });
    }

    // The ones several logs share, pinned.
    expect([...byWord.get("Error")!]).toEqual([PillTone.Danger]);
    expect([...byWord.get("Low Balance")!]).toEqual([PillTone.Danger]);
    expect([...byWord.get("Failed")!]).toEqual([PillTone.Danger]);
    expect([...byWord.get("Not Verified")!]).toEqual([PillTone.Danger]);
    expect([...byWord.get("Delivered")!]).toEqual([PillTone.Success]);
    expect([...byWord.get("Read")!]).toEqual([PillTone.Success]);
    expect([...byWord.get("Success")!]).toEqual([PillTone.Success]);
    expect([...byWord.get("Queued")!]).toEqual([PillTone.Neutral]);
    expect([...byWord.get("Unknown")!]).toEqual([PillTone.Neutral]);
  });

  test("Sent is on its way where more is still to come, and the last status where nothing more will be said - and each says which", () => {
    expect([
      toneOf(NotificationLogKind.SMS, SmsStatus.Sent, TWILIO_SENT_LINE),
      toneOf(NotificationLogKind.WhatsApp, WhatsAppStatus.Sent),
    ]).toEqual([PillTone.Info, PillTone.Info]);
    expect([
      toneOf(NotificationLogKind.SMS, SmsStatus.Sent, GATEWAY_SENT_LINE),
      toneOf(NotificationLogKind.Telegram, TelegramStatus.Sent),
    ]).toEqual([PillTone.Success, PillTone.Success]);

    expect(
      explanationOf(NotificationLogKind.WhatsApp, WhatsAppStatus.Sent),
    ).toContain("It moves to Delivered");
    expect(
      explanationOf(NotificationLogKind.Telegram, TelegramStatus.Sent),
    ).toContain("this is its last status");
  });

  test("a project out of balance reads the same in every log that charges for it: red, not sent, and who can add balance", () => {
    for (const kind of [
      NotificationLogKind.SMS,
      NotificationLogKind.Call,
      NotificationLogKind.WhatsApp,
      NotificationLogKind.Telegram,
    ]) {
      expect(wordsOf(kind, "Low Balance")).toEqual({
        text: "Low Balance",
        meaning: NotificationLogStatusMeaning.NotSent,
        explanation: [
          "It was not sent: the project's balance was too low to pay for it.",
          "View Status Message says who can add balance.",
        ],
      });
    }
  });
});

describe("every status says what it means", () => {
  test.each(everyCase())(
    "$kind $status ($statusMessage): a word, a colour, and whole sentences",
    (data: {
      kind: NotificationLogKind;
      status: string;
      statusMessage?: string | undefined;
    }) => {
      const words: NotificationLogStatusWords = wordsOf(
        data.kind,
        data.status,
        data.statusMessage,
      );

      expect(words.text.trim()).not.toBe("");
      expect(words.isTextAsWritten).toBeFalsy();
      expect(Object.values(NotificationLogStatusMeaning)).toContain(
        words.meaning,
      );
      expect(words.explanation.length).toBeGreaterThanOrEqual(1);
      expect(words.explanation.length).toBeLessThanOrEqual(3);

      for (const sentence of words.explanation) {
        expect(sentence).toMatch(/^[A-Z].*\.$/);
      }

      // Short enough for a tooltip.
      expect(words.explanation.join(" ").length).toBeLessThanOrEqual(240);

      // The pill says the stored word, as the filter offers it.
      expect(withMeaningKeyAsItsWord(words.text).toLowerCase()).toBe(
        data.status.toLowerCase(),
      );
    },
  );

  test("a status OneUptime does not know is drawn as written, grey, and says so", () => {
    expect(wordsOf(NotificationLogKind.SMS, "Delivered-ish")).toEqual({
      text: "Delivered-ish",
      isTextAsWritten: true,
      meaning: NotificationLogStatusMeaning.Unknown,
      explanation: [
        "OneUptime does not know this status.",
        "View Status Message shows what was reported.",
      ],
    });
  });

  test("a log with no status has no pill", () => {
    for (const status of [undefined, null, ""]) {
      expect(
        getNotificationLogStatusWords({
          kind: NotificationLogKind.SMS,
          status: status,
        }),
      ).toBeNull();
    }
  });

  test("a message's Read is a key of its own, read as Read in English", () => {
    expect(
      wordsOf(NotificationLogKind.WhatsApp, WhatsAppStatus.Read).text,
    ).toBe("Read (message status)");
    expect(MEANING_KEYS).toContain("Read (message status)");
    expect(withMeaningKeyAsItsWord("Read (message status)")).toBe("Read");
  });
});

describe("each log's Status filter", () => {
  const ORDER: Readonly<Record<NotificationLogKind, ReadonlyArray<string>>> = {
    [NotificationLogKind.Email]: ["Success", "Error"],
    [NotificationLogKind.SMS]: [
      "Sending",
      "Sent",
      "Delivered",
      "Undelivered",
      "Failed",
      "Error",
      "Low Balance",
      "Success",
    ],
    [NotificationLogKind.Call]: [
      "Calling",
      "Success",
      "Missed Call",
      "Busy",
      "Voicemail",
      "Error",
      "Low Balance",
    ],
    [NotificationLogKind.Push]: ["Success", "Error"],
    [NotificationLogKind.WhatsApp]: [
      "Queued",
      "Sent",
      "Delivered",
      "Read",
      "Warning",
      "Failed",
      "Error",
      "Low Balance",
      "Deleted",
      "Unknown",
      "Success",
    ],
    [NotificationLogKind.Telegram]: ["Sent", "Error", "Low Balance"],
    [NotificationLogKind.Webhook]: ["Success", "Error"],
    [NotificationLogKind.Workspace]: ["Success", "Error"],
  };

  // The statuses a log's enum holds that nothing writes, and why each is left out.
  const NEVER_WRITTEN: Readonly<Record<string, string>> = {
    [`${NotificationLogKind.WhatsApp}:${WhatsAppStatus.NotVerified}`]:
      "WhatsApp sends to a number its person verified, and no sender writes Not Verified",
    [`${NotificationLogKind.Telegram}:${TelegramStatus.Success}`]:
      "Telegram's sends have only ever written Sent, Error and Low Balance",
    [`${NotificationLogKind.Telegram}:${TelegramStatus.Delivered}`]:
      "Telegram reports nothing after it takes a message",
    [`${NotificationLogKind.Telegram}:${TelegramStatus.Read}`]:
      "Telegram reports nothing after it takes a message",
    [`${NotificationLogKind.Telegram}:${TelegramStatus.Queued}`]:
      "a Telegram log is written once, after the send",
    [`${NotificationLogKind.Telegram}:${TelegramStatus.Failed}`]:
      "a failed Telegram send is written as Error",
    [`${NotificationLogKind.Telegram}:${TelegramStatus.NotVerified}`]:
      "no sender writes Not Verified",
    [`${NotificationLogKind.Telegram}:${TelegramStatus.Unknown}`]:
      "Telegram reports no status OneUptime could not know",
  };

  test.each(KINDS)(
    "%s: every status it can hold, in the order a message moves through them, in the pills' words",
    (kind: NotificationLogKind) => {
      expect(NOTIFICATION_LOG_FILTER_STATUSES[kind]).toEqual(ORDER[kind]);

      expect(getNotificationLogStatusFilterOptions(kind)).toEqual(
        ORDER[kind].map((status: string) => {
          return {
            value: status,
            label: wordsOf(kind, status).text,
          };
        }),
      );
    },
  );

  test("every status of every log is offered, or listed here with why nothing writes it", () => {
    for (const kind of KINDS) {
      for (const status of STATUSES_OF[kind]) {
        const isOffered: boolean =
          NOTIFICATION_LOG_FILTER_STATUSES[kind].includes(status);
        const neverWritten: string | undefined =
          NEVER_WRITTEN[`${kind}:${status}`];

        expect({
          kind,
          status,
          isOffered,
          isListed: Boolean(neverWritten),
        }).toEqual({
          kind,
          status,
          isOffered: !neverWritten,
          isListed: !isOffered,
        });
      }
    }
  });

  test("a call's Missed Call is offered as the call lists word it, and a message's Read by its own key", () => {
    expect(
      getNotificationLogStatusFilterOptions(NotificationLogKind.Call).find(
        (option: { value: unknown }) => {
          return option.value === CallStatus.MissedCall;
        },
      )?.label,
    ).toBe("Missed call");
    expect(
      getNotificationLogStatusFilterOptions(NotificationLogKind.WhatsApp).find(
        (option: { value: unknown }) => {
          return option.value === WhatsAppStatus.Read;
        },
      )?.label,
    ).toBe("Read (message status)");
  });
});

describe("in every language the Dashboard ships", () => {
  // Every word and sentence a pill can say.
  const KEYS: ReadonlyArray<string> = [
    ...new Set<string>(
      everyCase().flatMap(
        (data: {
          kind: NotificationLogKind;
          status: string;
          statusMessage?: string | undefined;
        }) => {
          const words: NotificationLogStatusWords = wordsOf(
            data.kind,
            data.status,
            data.statusMessage,
          );

          return [words.text, ...words.explanation];
        },
      ),
    ),
    "OneUptime does not know this status.",
    "View Status Message shows what was reported.",
  ];

  /*
   * What a sentence names that the reader sees elsewhere on the page: a
   * status's pill, a button, a column. Each language names it the way it
   * draws it there.
   */
  const NAMED: Readonly<Record<string, ReadonlyArray<string>>> = {
    "It moves to Sent once the carrier accepts it.": ["Sent"],
    "It moves to Sent once WhatsApp accepts it.": ["Sent"],
    "Some carriers never report back, so an SMS can stay Sent.": ["Sent"],
    "It moves to Delivered once it reaches the phone.": ["Delivered"],
    "It moves to Delivered or Undelivered once the carrier reports back.": [
      "Delivered",
      "Undelivered",
    ],
    "It moves to Read once it is opened, if the person shares read receipts.": [
      "Read (message status)",
    ],
    "If it reports later that the notification was not delivered, this changes to Error.":
      ["Error"],
    "Error Code says why.": ["Error Code"],
    "HTTP Status shows its answer.": ["HTTP Status"],
    "Reason says why.": ["Reason"],
    "View Status Message says why.": ["View Status Message"],
    "View Status Message shows what was reported.": ["View Status Message"],
    "View Status Message says how long it lasted.": ["View Status Message"],
    "View Status Message says what WhatsApp reported.": ["View Status Message"],
    "View Status Message says whether a message was left.": [
      "View Status Message",
    ],
    "View Status Message says who can add balance.": ["View Status Message"],
  };

  test("every word and sentence is a key of the English locale", () => {
    for (const key of KEYS) {
      expect({ key, english: ENGLISH[key] }).toEqual({ key, english: key });
    }
  });

  test("the sentences that name a pill, a button or a column are the ones the pills say", () => {
    for (const sentence of Object.keys(NAMED)) {
      expect(KEYS).toContain(sentence);
    }
  });

  test.each(TRANSLATED_LOCALES)(
    "%s words every one of them",
    (language: string) => {
      const locale: Record<string, string> = readLocale(language);

      for (const key of KEYS) {
        const value: string | undefined = locale[key];

        expect({
          key,
          isWorded: typeof value === "string" && value.trim() !== "",
        }).toEqual({ key, isWorded: true });

        // A sentence is worded, never left in English (a word may read as English's: Spanish "Error").
        if (key.endsWith(".")) {
          expect({ key, value }).not.toEqual({ key, value: key });
        }
      }
    },
  );

  test.each(TRANSLATED_LOCALES)(
    "%s names each status, button and column in a sentence as it draws it",
    (language: string) => {
      const locale: Record<string, string> = readLocale(language);

      for (const [sentence, names] of Object.entries(NAMED)) {
        for (const name of names) {
          expect({
            sentence: locale[sentence],
            names: locale[name],
            isNamed: (locale[sentence] || "").includes(locale[name] || "?"),
          }).toEqual({
            sentence: locale[sentence],
            names: locale[name],
            isNamed: true,
          });
        }
      }
    },
  );

  test.each(TRANSLATED_LOCALES)(
    "%s words a message's Read as a status, never the verb",
    (language: string) => {
      const locale: Record<string, string> = readLocale(language);

      expect(locale["Read (message status)"]).not.toBe(locale["Read"]);
      expect(locale["Read (message status)"]).not.toContain("(");
    },
  );
});

/*
 * THE DOCS PAGE THAT EXPLAINS THEM (/docs/notifications/notification-logs).
 *
 * Every log's card opens it with View Documentation, and it says what the
 * pills say: its SMS and call tables list the statuses the filters offer,
 * in the filters' order and the pills' words, and its colour table names
 * each status in the colour its pill is drawn in.
 */
describe("the docs page that explains them", () => {
  const DOCS_CONTENT: string = path.join(
    __dirname,
    "../../FeatureSet/Docs/Content",
  );
  const PAGE: string = "notifications/notification-logs.md";
  const TABLES_DIRECTORY: string = path.join(
    __dirname,
    "../../FeatureSet/Dashboard/src/Components/NotificationLogs",
  );
  const ENGLISH_PAGE: Array<string> = fs
    .readFileSync(path.join(DOCS_CONTENT, "en", PAGE), "utf8")
    .split("\n");

  // The lines of the English page's section under `heading`, up to the next one.
  function sectionOf(heading: string): Array<string> {
    const start: number = ENGLISH_PAGE.indexOf(`## ${heading}`);

    expect(start).toBeGreaterThan(-1);

    const end: number = ENGLISH_PAGE.findIndex(
      (line: string, index: number): boolean => {
        return index > start && line.startsWith("## ");
      },
    );

    return ENGLISH_PAGE.slice(start + 1, end === -1 ? undefined : end);
  }

  // The bold status each row of a section's status table starts with.
  function tableStatuses(heading: string): Array<string> {
    const statuses: Array<string> = [];

    for (const line of sectionOf(heading)) {
      const status: string | undefined = line.match(
        /^\| \*\*([^*]+)\*\* \|/,
      )?.[1];

      if (status) {
        statuses.push(status);
      }
    }

    return statuses;
  }

  test("every log's card opens it, and every language the docs have has it", () => {
    expect(NOTIFICATION_LOGS_DOCUMENTATION.toString()).toBe(
      "/docs/notifications/notification-logs",
    );

    const tables: Array<string> = fs
      .readdirSync(TABLES_DIRECTORY)
      .filter((name: string): boolean => {
        return name.endsWith("LogsTable.tsx");
      });

    expect(tables).toHaveLength(KINDS.length);

    for (const table of tables) {
      expect({
        table,
        opensTheDocs: fs
          .readFileSync(path.join(TABLES_DIRECTORY, table), "utf8")
          .includes("documentationLink={NOTIFICATION_LOGS_DOCUMENTATION}"),
      }).toEqual({ table, opensTheDocs: true });
    }

    const languages: Array<string> = fs.readdirSync(DOCS_CONTENT);

    expect(languages).toHaveLength(17);

    for (const language of languages) {
      expect({
        language,
        hasThePage: fs.existsSync(path.join(DOCS_CONTENT, language, PAGE)),
      }).toEqual({ language, hasThePage: true });
    }
  });

  test("its SMS table lists every status the SMS filter offers, in its order and the pills' words", () => {
    expect(tableStatuses("SMS")).toEqual(
      NOTIFICATION_LOG_FILTER_STATUSES[NotificationLogKind.SMS].map(
        (status: string): string => {
          return wordsOf(NotificationLogKind.SMS, status).text;
        },
      ),
    );
  });

  test("its call table lists every status the call filter offers, in its order and the pills' words", () => {
    expect(tableStatuses("Calls")).toEqual(
      NOTIFICATION_LOG_FILTER_STATUSES[NotificationLogKind.Call].map(
        (status: string): string => {
          return wordsOf(NotificationLogKind.Call, status).text;
        },
      ),
    );
  });

  test("its colour table names each status in the colour its pill is drawn in", () => {
    const TONE_OF_COLOUR: Readonly<Record<string, PillTone>> = {
      Grey: PillTone.Neutral,
      Blue: PillTone.Info,
      Green: PillTone.Success,
      Yellow: PillTone.Warning,
      Red: PillTone.Danger,
    };

    // The log and status each word the table names is read from.
    const STATUS_OF_WORD: Readonly<
      Record<string, [NotificationLogKind, string]>
    > = {
      Sending: [NotificationLogKind.SMS, SmsStatus.Sending],
      Sent: [NotificationLogKind.SMS, SmsStatus.Sent],
      Calling: [NotificationLogKind.Call, CallStatus.Calling],
      Delivered: [NotificationLogKind.SMS, SmsStatus.Delivered],
      "Missed call": [NotificationLogKind.Call, CallStatus.MissedCall],
      Undelivered: [NotificationLogKind.SMS, SmsStatus.Undelivered],
      Failed: [NotificationLogKind.SMS, SmsStatus.Failed],
      Error: [NotificationLogKind.SMS, SmsStatus.Error],
      "Low Balance": [NotificationLogKind.SMS, SmsStatus.LowBalance],
    };

    const named: Array<{ word: string; tone: PillTone }> = [];

    for (const line of sectionOf("How to read a status")) {
      const colour: string | undefined = line.match(/^\| (\w+) \|/)?.[1];

      if (!colour || !TONE_OF_COLOUR[colour]) {
        continue;
      }

      for (const match of line.matchAll(/\*\*([^*]+)\*\*/g)) {
        named.push({ word: match[1]!, tone: TONE_OF_COLOUR[colour]! });
      }
    }

    expect(
      named.map((name: { word: string }): string => {
        return name.word;
      }),
    ).toEqual(Object.keys(STATUS_OF_WORD));

    for (const { word, tone } of named) {
      const [kind, status] = STATUS_OF_WORD[word]!;

      expect({ word, text: wordsOf(kind, status).text }).toEqual({
        word,
        text: word,
      });
      expect({ word, tone: toneOf(kind, status) }).toEqual({ word, tone });
    }
  });
});
