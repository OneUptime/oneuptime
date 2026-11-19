import {
  AnsweredByOutcome,
  getAnsweredByOutcome,
  getMachineAnsweredCallOutcome,
  getVoicemailMessage,
  MachineAnswered,
  TwilioAnsweredBy,
  VOICEMAIL_MACHINE_DETECTION,
  VOICEMAIL_MESSAGE_CLOSING,
  VOICEMAIL_MESSAGE_WITHOUT_WORDS,
} from "../../FeatureSet/Notification/Utils/AnsweredBy";
import { CallOutcome } from "../../FeatureSet/Notification/Utils/CallOutcome";
import CallStatus from "Common/Types/Call/CallStatus";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import { NotificationDeliveryStatus } from "Common/Server/Utils/Telemetry/NotificationDeliveryMetrics";
import {
  CallOutcomeLine,
  readCallOutcomeMessage,
} from "Common/Types/OnCallDutyPolicy/OnCallSentLine";
import { describe, expect, test } from "@jest/globals";

/*
 * WHO ANSWERED AN ON-CALL CALL, AS TWILIO'S ANSWERING MACHINE DETECTION
 * POSTS IT (#6594): every AnsweredBy value Twilio documents
 * (https://www.twilio.com/docs/voice/answering-machine-detection), and what
 * each means for the call's log and its on-call notification.
 *
 *   - human, unknown: a person, or Twilio could not tell - nothing to write;
 *   - machine_end_*: a voicemail at the end of its greeting - not answered,
 *     and a message can be left now;
 *   - machine_start: a voicemail at the start of its greeting - not
 *     answered, nothing left over the greeting (only Enable answers this,
 *     which OneUptime does not ask for);
 *   - fax: not answered, nothing left.
 */

describe("every AnsweredBy Twilio posts", () => {
  test("DetectMessageEnd is asked for: a voicemail is reported at the end of its greeting", () => {
    expect(VOICEMAIL_MACHINE_DETECTION).toBe("DetectMessageEnd");
  });

  test.each([TwilioAnsweredBy.Human, TwilioAnsweredBy.Unknown])(
    "%s: a person, or Twilio could not tell - nothing to write",
    (value: string) => {
      expect(getAnsweredByOutcome(value)).toBeNull();
    },
  );

  test.each([
    TwilioAnsweredBy.MachineEndBeep,
    TwilioAnsweredBy.MachineEndSilence,
    TwilioAnsweredBy.MachineEndOther,
  ])(
    "%s: voicemail, its greeting over - a message can be left",
    (value: string) => {
      expect(getAnsweredByOutcome(value)).toEqual({
        answered: MachineAnswered.Voicemail,
        canLeaveMessage: true,
      });
    },
  );

  test("machine_start: voicemail, at the start of its greeting - nothing left over it", () => {
    expect(getAnsweredByOutcome(TwilioAnsweredBy.MachineStart)).toEqual({
      answered: MachineAnswered.Voicemail,
      canLeaveMessage: false,
    });
  });

  test("fax: a fax machine - nothing left", () => {
    expect(getAnsweredByOutcome(TwilioAnsweredBy.Fax)).toEqual({
      answered: MachineAnswered.Fax,
      canLeaveMessage: false,
    });
  });

  test("the values are Twilio's, as its docs write them", () => {
    expect(Object.values(TwilioAnsweredBy).sort()).toEqual(
      [
        "fax",
        "human",
        "machine_end_beep",
        "machine_end_other",
        "machine_end_silence",
        "machine_start",
        "unknown",
      ].sort(),
    );
  });

  test.each([" Machine_End_Beep ", "MACHINE_END_SILENCE", "\tfax\n"])(
    "%p is read whatever its case, and without the space around it",
    (value: string) => {
      expect(getAnsweredByOutcome(value)).not.toBeNull();
    },
  );

  test.each([undefined, null, "", "machine", "voicemail", 7, {}, ["fax"]])(
    "%p is not one of Twilio's values: nothing to write",
    (value: unknown) => {
      expect(getAnsweredByOutcome(value)).toBeNull();
    },
  );
});

describe("a call a machine answered, for its log and its notification", () => {
  const voicemailAtTheBeep: AnsweredByOutcome = {
    answered: MachineAnswered.Voicemail,
    canLeaveMessage: true,
  };

  test("voicemail, a message left: Voicemail, Not Answered, not answered, in its own sentence", () => {
    const outcome: CallOutcome = getMachineAnsweredCallOutcome({
      outcome: voicemailAtTheBeep,
      isMessageLeft: true,
    });

    expect(outcome).toEqual({
      callStatus: CallStatus.Voicemail,
      notificationStatus: UserNotificationStatus.NotAnswered,
      sentence:
        "The call was not answered: it went to voicemail, and a message was left.",
      deliveryStatus: NotificationDeliveryStatus.NotAnswered,
      durationInSeconds: null,
    });
    expect(readCallOutcomeMessage(outcome.sentence)?.outcome).toBe(
      CallOutcomeLine.VoicemailMessageLeft,
    );
  });

  test("voicemail, no message left: says so", () => {
    const outcome: CallOutcome = getMachineAnsweredCallOutcome({
      outcome: voicemailAtTheBeep,
      isMessageLeft: false,
    });

    expect(outcome.callStatus).toBe(CallStatus.Voicemail);
    expect(outcome.notificationStatus).toBe(UserNotificationStatus.NotAnswered);
    expect(outcome.sentence).toBe(
      "The call was not answered: it went to voicemail, and no message was left.",
    );
    expect(readCallOutcomeMessage(outcome.sentence)?.outcome).toBe(
      CallOutcomeLine.VoicemailNoMessage,
    );
  });

  test("a fax machine: a missed call, not answered, said as a fax machine - never that a message was left", () => {
    for (const isMessageLeft of [true, false]) {
      const outcome: CallOutcome = getMachineAnsweredCallOutcome({
        outcome: { answered: MachineAnswered.Fax, canLeaveMessage: false },
        isMessageLeft: isMessageLeft,
      });

      expect(outcome).toEqual({
        callStatus: CallStatus.MissedCall,
        notificationStatus: UserNotificationStatus.NotAnswered,
        sentence: "The call was not answered: a fax machine picked up.",
        deliveryStatus: NotificationDeliveryStatus.NotAnswered,
        durationInSeconds: null,
      });
      expect(readCallOutcomeMessage(outcome.sentence)?.outcome).toBe(
        CallOutcomeLine.Fax,
      );
    }
  });
});

describe("the message left on voicemail", () => {
  test("what the call said, then what to do", () => {
    expect(
      getVoicemailMessage(
        "This is a call from One Uptime. Incident number 42, API is down.",
      ),
    ).toBe(
      `This is a call from One Uptime. Incident number 42, API is down. ${VOICEMAIL_MESSAGE_CLOSING}`,
    );
    expect(VOICEMAIL_MESSAGE_CLOSING).toBe(
      "Open One Uptime to respond. Good bye.",
    );
  });

  test.each([null, "", "   "])(
    "without the call's words (%p): who called, and what to do",
    (words: string | null) => {
      expect(getVoicemailMessage(words)).toBe(VOICEMAIL_MESSAGE_WITHOUT_WORDS);
      expect(VOICEMAIL_MESSAGE_WITHOUT_WORDS).toBe(
        "This is a call from One Uptime about an on-call page. Open One Uptime to respond. Good bye.",
      );
    },
  );

  test("asks for no key press: the voicemail cannot press one", () => {
    expect(getVoicemailMessage("Words.")).not.toMatch(/press/i);
    expect(VOICEMAIL_MESSAGE_WITHOUT_WORDS).not.toMatch(/press/i);
  });
});
