import {
  CallOutcome,
  TwilioCallStatus,
  getCallOutcome,
  getCallOutcomeStatusMessage,
} from "../../FeatureSet/Notification/Utils/CallOutcome";
import CallStatus from "Common/Types/Call/CallStatus";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW A CALL ENDED, AS TWILIO TELLS IT (#6586).
 *
 * A call is logged Success the moment Twilio accepts it - long before
 * anybody picks up. When it ends, Twilio calls the call's status callback
 * with its final status, and this says what that status means: for the
 * call's log (Missed Call, Busy, Error - or, answered, Success as it was),
 * for the on-call notification it was made for (Not Answered, Error - or,
 * answered, sent as it was, until the person presses 1), and in a sentence
 * both are left with. Never the number called.
 */

const CALL_SID: string = "CA0123456789abcdef0123456789abcdef";

function outcomeOf(
  providerStatus: unknown,
  durationInSeconds?: unknown,
): CallOutcome | null {
  return getCallOutcome({
    providerStatus: providerStatus,
    durationInSeconds: durationInSeconds,
  });
}

describe("each final status Twilio sends", () => {
  test("no-answer: it rang out - a missed call, a call not answered", () => {
    expect(outcomeOf("no-answer")).toEqual({
      callStatus: CallStatus.MissedCall,
      notificationStatus: UserNotificationStatus.NotAnswered,
      sentence: "The call was not answered: it rang out.",
    });
  });

  test("busy: the line was busy - or the person declined it, which most phones answer as busy", () => {
    expect(outcomeOf("busy")).toEqual({
      callStatus: CallStatus.Busy,
      notificationStatus: UserNotificationStatus.NotAnswered,
      sentence:
        "The call was not answered: the line was busy, or the call was declined.",
    });
  });

  test("failed: it could not be connected - an error, a page that did not reach them", () => {
    expect(outcomeOf("failed")).toEqual({
      callStatus: CallStatus.Error,
      notificationStatus: UserNotificationStatus.Error,
      sentence: "The call could not be connected.",
    });
  });

  test("completed: it was answered - the log stays Success and the notification sent, until the person presses 1", () => {
    expect(outcomeOf("completed", "42")).toEqual({
      callStatus: null,
      notificationStatus: null,
      sentence: "The call was answered and lasted 42 seconds.",
    });
  });

  test("the enum names Twilio's own words", () => {
    expect(Object.values(TwilioCallStatus).sort()).toEqual(
      ["busy", "canceled", "completed", "failed", "no-answer"].sort(),
    );
  });
});

describe("how long an answered call lasted", () => {
  test("a whole number of seconds, Twilio's CallDuration, read as text or a number", () => {
    expect(outcomeOf("completed", "1")?.sentence).toBe(
      "The call was answered and lasted 1 second.",
    );
    expect(outcomeOf("completed", 0)?.sentence).toBe(
      "The call was answered and lasted 0 seconds.",
    );
    expect(outcomeOf("completed", 75)?.sentence).toBe(
      "The call was answered and lasted 75 seconds.",
    );
  });

  test("anything else is not said: the call was answered", () => {
    for (const duration of [
      undefined,
      null,
      "",
      "  ",
      "abc",
      "-3",
      "1.5",
      true,
      false,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      { seconds: 4 },
      [4],
    ]) {
      expect(outcomeOf("completed", duration)?.sentence).toBe(
        "The call was answered.",
      );
    }
  });
});

describe("a status that is not how a call ended", () => {
  test("queued, ringing, in progress - or canceled, which OneUptime never asks for - is nothing to write", () => {
    for (const status of [
      "queued",
      "initiated",
      "ringing",
      "in-progress",
      TwilioCallStatus.Canceled,
    ]) {
      expect(outcomeOf(status)).toBeNull();
    }
  });

  test("no status, or one that is not text, is nothing to write", () => {
    for (const status of [undefined, null, "", 42, true, {}, ["busy"]]) {
      expect(outcomeOf(status)).toBeNull();
    }
  });

  test("Twilio's word is read whatever its case, and whatever spaces surround it", () => {
    expect(outcomeOf(" No-Answer ")?.callStatus).toBe(CallStatus.MissedCall);
    expect(outcomeOf("BUSY")?.callStatus).toBe(CallStatus.Busy);
  });
});

describe("the message the log and the notification are left with", () => {
  const rangOut: CallOutcome = outcomeOf("no-answer")!;

  test("the call's Twilio id, as the log has always shown it, then how it ended", () => {
    expect(
      getCallOutcomeStatusMessage({ callSid: CALL_SID, outcome: rangOut }),
    ).toBe(`Call ID: ${CALL_SID}. The call was not answered: it rang out.`);
  });

  test("an id that is not a Twilio call's is left out - a forged request writes nothing of its own", () => {
    for (const callSid of [
      undefined,
      null,
      "",
      42,
      "CA123",
      `${CALL_SID}0`,
      `SM${CALL_SID.slice(2)}`,
      "+15551234567",
      "<script>alert(1)</script>",
      `${CALL_SID}\nInjected line`,
    ]) {
      expect(
        getCallOutcomeStatusMessage({ callSid: callSid, outcome: rangOut }),
      ).toBe("The call was not answered: it rang out.");
    }
  });

  test("the same callback twice leaves the same message: it is written whole", () => {
    const once: string = getCallOutcomeStatusMessage({
      callSid: CALL_SID,
      outcome: rangOut,
    });

    expect(
      getCallOutcomeStatusMessage({
        callSid: ` ${CALL_SID} `,
        outcome: rangOut,
      }),
    ).toBe(once);
  });

  test("no sentence names a number: never the person's phone number", () => {
    for (const status of ["no-answer", "busy", "failed", "completed"]) {
      const sentence: string = outcomeOf(status)!.sentence;

      expect(sentence).not.toMatch(/\+|\d/);
    }
  });
});
