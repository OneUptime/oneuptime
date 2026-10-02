import { describe, expect, test } from "@jest/globals";
import MissedCallNotification, {
  MissedCall,
  MissedCallAttempt,
  MissedCallNotificationContent,
} from "../../../../Server/Utils/IncomingCall/MissedCallNotification";
import OneUptimeDate from "../../../../Types/Date";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import IncomingCallStatus from "../../../../Types/IncomingCall/IncomingCallStatus";
import { MissedIncomingCallReason } from "../../../../Types/IncomingCall/MissedIncomingCall";
import { JSONObject } from "../../../../Types/JSON";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import Timezone from "../../../../Types/Timezone";

/*
 * What an Incoming Call Policy's owners are told about a missed call, on
 * every channel. The builder is pure, so every test builds a call and reads
 * the message straight back.
 */

const LINK: string =
  "https://oneuptime.example.com/dashboard/11111111-1111-4111-8111-111111111111/on-call-duty/incoming-call-policies/22222222-2222-4222-8222-222222222222/logs/44444444-4444-4444-8444-444444444444";

const STARTED_AT: Date = new Date("2026-10-01T22:00:00.000Z");

function makeAttempt(
  overrides: Partial<MissedCallAttempt> = {},
): MissedCallAttempt {
  return {
    userName: "Alice Martin",
    phoneNumber: "+14155551001",
    ruleName: "Rule 1",
    status: IncomingCallStatus.NoAnswer,
    ringSeconds: 30,
    ...overrides,
  };
}

function makeCall(overrides: Partial<MissedCall> = {}): MissedCall {
  return {
    policyName: "Support Hotline",
    projectName: "Acme",
    callerPhoneNumber: "+14155550999",
    routingPhoneNumber: "+14155550102",
    reason: MissedIncomingCallReason.NoAnswer,
    statusMessage: "",
    startedAt: STARTED_AT,
    endedAt: new Date(STARTED_AT.getTime() + 65_000),
    attempts: [makeAttempt()],
    incomingCallLogViewLink: LINK,
    ...overrides,
  };
}

function build(
  call: MissedCall,
  options: { isOwner?: boolean; timezone?: Timezone | undefined } = {},
): MissedCallNotificationContent {
  return MissedCallNotification.buildContent({
    call,
    isOwner: options.isOwner ?? true,
    timezone: options.timezone,
  });
}

function attemptsOf(content: MissedCallNotificationContent): Array<JSONObject> {
  return content.emailEnvelope.vars["attempts"] as unknown as Array<JSONObject>;
}

describe("MissedCallNotification constants", () => {
  test("is sent under the missed call event type", () => {
    expect(MissedCallNotification.EVENT_TYPE).toBe(
      NotificationSettingEventType.SEND_INCOMING_CALL_MISSED_OWNER_NOTIFICATION,
    );
  });

  test("lists up to 25 attempts in the email", () => {
    expect(MissedCallNotification.MAX_ATTEMPTS_IN_EMAIL).toBe(25);
  });
});

describe("who called and where", () => {
  test("names the caller by number", () => {
    expect(MissedCallNotification.getCallerLabel(makeCall())).toBe(
      "+14155550999",
    );
  });

  test("says when the number is unknown", () => {
    expect(
      MissedCallNotification.getCallerLabel(
        makeCall({ callerPhoneNumber: "   " }),
      ),
    ).toBe("an unknown number");
  });

  test("the subject names the caller and the policy", () => {
    expect(MissedCallNotification.getEmailSubject(makeCall())).toBe(
      "Missed call from +14155550999 to Support Hotline",
    );
    expect(
      MissedCallNotification.getEmailSubject(
        makeCall({ callerPhoneNumber: "" }),
      ),
    ).toBe("Missed call from an unknown number to Support Hotline");
  });
});

describe("why nobody answered", () => {
  test.each([
    [MissedIncomingCallReason.NoAnswer, "Nobody answered"],
    [
      MissedIncomingCallReason.CallerHungUp,
      "Caller hung up before anyone answered",
    ],
    [MissedIncomingCallReason.NoOneAvailable, "Nobody was available"],
    [MissedIncomingCallReason.PolicyDisabled, "Policy is disabled"],
    [MissedIncomingCallReason.Failed, "Call could not be routed"],
  ])("%s reads as %j", (reason: MissedIncomingCallReason, result: string) => {
    expect(MissedCallNotification.getResult(reason)).toBe(result);
  });

  test("the summary is who called, which policy, and the result", () => {
    expect(MissedCallNotification.getSummary(makeCall())).toBe(
      "+14155550999 called Support Hotline. Nobody answered.",
    );
    expect(
      MissedCallNotification.getSummary(
        makeCall({ reason: MissedIncomingCallReason.CallerHungUp }),
      ),
    ).toBe(
      "+14155550999 called Support Hotline. Caller hung up before anyone answered.",
    );
  });

  test("no answer: the hunt ran out and the caller heard the No Answer Message", () => {
    expect(MissedCallNotification.getExplanation(makeCall())).toBe(
      "Nobody answered. OneUptime went through the escalation rules, then played your No Answer Message to the caller and ended the call.",
    );
  });

  test("caller hung up: says how long they waited", () => {
    expect(
      MissedCallNotification.getExplanation(
        makeCall({
          reason: MissedIncomingCallReason.CallerHungUp,
          endedAt: new Date(STARTED_AT.getTime() + 47_000),
        }),
      ),
    ).toBe(
      "The caller hung up after waiting 47 seconds, before anyone answered.",
    );
  });

  test("caller hung up: without both times, no wait is claimed", () => {
    expect(
      MissedCallNotification.getExplanation(
        makeCall({
          reason: MissedIncomingCallReason.CallerHungUp,
          endedAt: undefined,
        }),
      ),
    ).toBe("The caller hung up, before anyone answered.");
  });

  test("nobody available: points at the verified incoming call numbers", () => {
    const explanation: string = MissedCallNotification.getExplanation(
      makeCall({
        reason: MissedIncomingCallReason.NoOneAvailable,
        attempts: [],
      }),
    );

    expect(explanation).toContain("Nobody was rung.");
    expect(explanation).toContain("verified incoming call number");
    expect(explanation).toContain("No One Available Message");
  });

  test("disabled policy: says the policy is disabled", () => {
    expect(
      MissedCallNotification.getExplanation(
        makeCall({
          reason: MissedIncomingCallReason.PolicyDisabled,
          attempts: [],
        }),
      ),
    ).toBe(
      "Nobody was rung because this incoming call policy is disabled. The caller was told the service is disabled and the call ended.",
    );
  });

  test("any other failure repeats the stored status message", () => {
    expect(
      MissedCallNotification.getExplanation(
        makeCall({
          reason: MissedIncomingCallReason.Failed,
          statusMessage: "  Twilio configuration not found ",
        }),
      ),
    ).toBe(
      "The call could not be routed to anyone: Twilio configuration not found",
    );

    expect(
      MissedCallNotification.getExplanation(
        makeCall({
          reason: MissedIncomingCallReason.Failed,
          statusMessage: "",
        }),
      ),
    ).toBe("The call could not be routed to anyone.");
  });
});

describe("how each attempt ended", () => {
  test.each([
    [IncomingCallStatus.NoAnswer, 30, "No answer after 30 seconds"],
    [IncomingCallStatus.NoAnswer, undefined, "No answer"],
    [
      IncomingCallStatus.CallerHungUp,
      11,
      "Caller hung up while ringing after 11 seconds",
    ],
    [IncomingCallStatus.Busy, 2, "Line busy"],
    [IncomingCallStatus.Failed, 1, "Call failed"],
    [IncomingCallStatus.Connected, 42, "Answered"],
    [IncomingCallStatus.Completed, 42, "Answered"],
    [IncomingCallStatus.Ringing, undefined, "Ringing"],
    [undefined, undefined, "Unknown"],
  ])(
    "%s after %s s reads as %j",
    (
      status: IncomingCallStatus | undefined,
      ringSeconds: number | undefined,
      expected: string,
    ) => {
      expect(
        MissedCallNotification.getAttemptResult(
          makeAttempt({ status, ringSeconds }),
        ),
      ).toBe(expected);
    },
  );
});

describe("MissedCallNotification.formatDuration", () => {
  test.each([
    [0, "0 seconds"],
    [1, "1 second"],
    [47, "47 seconds"],
    [60, "1 minute"],
    [61, "1 minute 1 second"],
    [125, "2 minutes 5 seconds"],
    [3600, "1 hour"],
    [3725, "1 hour 2 minutes"],
    [7260, "2 hours 1 minute"],
    [59.6, "1 minute"],
    [-5, "0 seconds"],
  ])("%s seconds reads as %j", (seconds: number, expected: string) => {
    expect(MissedCallNotification.formatDuration(seconds)).toBe(expected);
  });
});

describe("MissedCallNotification.getSecondsBetween", () => {
  test("is the whole seconds from one time to the other", () => {
    expect(
      MissedCallNotification.getSecondsBetween(
        STARTED_AT,
        new Date(STARTED_AT.getTime() + 10_400),
      ),
    ).toBe(10);
  });

  test("is undefined when either time is missing, or they are backwards", () => {
    expect(
      MissedCallNotification.getSecondsBetween(undefined, STARTED_AT),
    ).toBeUndefined();
    expect(
      MissedCallNotification.getSecondsBetween(STARTED_AT, undefined),
    ).toBeUndefined();
    expect(
      MissedCallNotification.getSecondsBetween(
        STARTED_AT,
        new Date(STARTED_AT.getTime() - 5_000),
      ),
    ).toBeUndefined();
  });
});

describe("the email", () => {
  test("uses the missed call template with a literal subject", () => {
    const content: MissedCallNotificationContent = build(makeCall());

    expect(content.emailEnvelope.templateType).toBe(
      EmailTemplateType.IncomingCallPolicyOwnerMissedCall,
    );
    expect(content.emailEnvelope.subject).toBe(
      "Missed call from +14155550999 to Support Hotline",
    );
    expect(content.emailEnvelope.isSubjectLiteral).toBe(true);
  });

  test("a policy name that looks like a template stays literal text", () => {
    const content: MissedCallNotificationContent = build(
      makeCall({ policyName: "Support {{ .Values.tier }}" }),
    );

    expect(content.emailEnvelope.subject).toBe(
      "Missed call from +14155550999 to Support {{ .Values.tier }}",
    );
    expect(content.emailEnvelope.isSubjectLiteral).toBe(true);
    expect(content.emailEnvelope.vars["policyName"]).toBe(
      "Support {{ .Values.tier }}",
    );
  });

  test("carries the call's details", () => {
    const vars: JSONObject = build(makeCall()).emailEnvelope.vars as JSONObject;

    expect(vars).toMatchObject({
      policyName: "Support Hotline",
      projectName: "Acme",
      callerPhoneNumber: "+14155550999",
      routingPhoneNumber: "+14155550102",
      result: "Nobody answered",
      explanation: MissedCallNotification.getExplanation(makeCall()),
      incomingCallLogViewLink: LINK,
      hasAttempts: "true",
      hasMoreAttempts: "false",
      moreAttemptsCount: "0",
    });
  });

  test("an unknown caller is named as such and a missing called number is left out", () => {
    const vars: JSONObject = build(
      makeCall({ callerPhoneNumber: "", routingPhoneNumber: "  " }),
    ).emailEnvelope.vars as JSONObject;

    expect(vars["callerPhoneNumber"]).toBe("an unknown number");
    expect(vars["routingPhoneNumber"]).toBe("");
  });

  test("shows the call time in the recipient's own time zone", () => {
    const vars: JSONObject = build(makeCall(), {
      timezone: Timezone.AsiaKolkata,
    }).emailEnvelope.vars as JSONObject;

    expect(vars["callStartedAt"]).toBe(
      OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
        date: STARTED_AT,
        timezones: [Timezone.AsiaKolkata],
      }),
    );
  });

  test("without a time zone, shows the usual set of zones", () => {
    const vars: JSONObject = build(makeCall()).emailEnvelope.vars as JSONObject;

    expect(vars["callStartedAt"]).toBe(
      OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
        date: STARTED_AT,
        timezones: [],
      }),
    );
  });

  test("leaves the call time out when it is unknown", () => {
    const vars: JSONObject = build(makeCall({ startedAt: undefined }))
      .emailEnvelope.vars as JSONObject;

    expect(vars["callStartedAt"]).toBe("");
  });

  test("lists each attempt in order with its rule, number and result", () => {
    const content: MissedCallNotificationContent = build(
      makeCall({
        attempts: [
          makeAttempt(),
          makeAttempt({
            userName: "Bob Chen",
            phoneNumber: "+14155551002",
            ruleName: "Night shift",
            status: IncomingCallStatus.NoAnswer,
            ringSeconds: 20,
          }),
        ],
      }),
    );

    expect(attemptsOf(content)).toEqual([
      {
        position: "1",
        userName: "Alice Martin",
        details: "Rule 1 · +14155551001 · No answer after 30 seconds",
      },
      {
        position: "2",
        userName: "Bob Chen",
        details: "Night shift · +14155551002 · No answer after 20 seconds",
      },
    ]);
  });

  test("an attempt with no name, rule or number still says how it ended", () => {
    const content: MissedCallNotificationContent = build(
      makeCall({
        attempts: [
          makeAttempt({
            userName: " ",
            ruleName: "",
            phoneNumber: "",
            status: IncomingCallStatus.CallerHungUp,
            ringSeconds: 11,
          }),
        ],
      }),
    );

    expect(attemptsOf(content)).toEqual([
      {
        position: "1",
        userName: "Unknown user",
        details: "Caller hung up while ringing after 11 seconds",
      },
    ]);
  });

  test("a call that rang nobody has no attempt list", () => {
    const vars: JSONObject = build(
      makeCall({
        reason: MissedIncomingCallReason.NoOneAvailable,
        attempts: [],
      }),
    ).emailEnvelope.vars as JSONObject;

    expect(vars["hasAttempts"]).toBe("false");
    expect(vars["attempts"]).toEqual([]);
  });

  test("a long hunt lists the first 25 attempts and counts the rest", () => {
    const attempts: Array<MissedCallAttempt> = Array.from(
      { length: 31 },
      (_value: unknown, index: number): MissedCallAttempt => {
        return makeAttempt({ userName: `Engineer ${index + 1}` });
      },
    );

    const content: MissedCallNotificationContent = build(
      makeCall({ attempts }),
    );
    const shown: Array<JSONObject> = attemptsOf(content);

    expect(shown).toHaveLength(25);
    expect(shown[0]).toMatchObject({ position: "1", userName: "Engineer 1" });
    expect(shown[24]).toMatchObject({
      position: "25",
      userName: "Engineer 25",
    });
    expect(content.emailEnvelope.vars["hasMoreAttempts"]).toBe("true");
    expect(content.emailEnvelope.vars["moreAttemptsCount"]).toBe("6");
  });

  test("exactly 25 attempts are all listed", () => {
    const attempts: Array<MissedCallAttempt> = Array.from(
      { length: 25 },
      (): MissedCallAttempt => {
        return makeAttempt();
      },
    );

    const content: MissedCallNotificationContent = build(
      makeCall({ attempts }),
    );

    expect(attemptsOf(content)).toHaveLength(25);
    expect(content.emailEnvelope.vars["hasMoreAttempts"]).toBe("false");
  });

  test("marks an owner as the owner, and a project owner as not", () => {
    expect(
      build(makeCall(), { isOwner: true }).emailEnvelope.vars["isOwner"],
    ).toBe("true");
    expect(
      build(makeCall(), { isOwner: false }).emailEnvelope.vars,
    ).not.toHaveProperty("isOwner");
  });

  test("does not change the call it was given", () => {
    const call: MissedCall = makeCall();
    const before: string = JSON.stringify(call);

    build(call);

    expect(JSON.stringify(call)).toBe(before);
  });
});

describe("the other channels", () => {
  test("SMS says it is a missed call and how to unsubscribe", () => {
    expect(build(makeCall()).smsMessage.message).toBe(
      "This is a message from OneUptime. Missed call: +14155550999 called Support Hotline. Nobody answered. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.",
    );
  });

  test("a voice call says the same and says goodbye", () => {
    expect(build(makeCall()).callRequestMessage.data).toEqual([
      {
        sayMessage:
          "This is a message from OneUptime. Missed call. +14155550999 called Support Hotline. Nobody answered. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.",
      },
    ]);
  });

  test("push opens the call log", () => {
    const push: MissedCallNotificationContent["pushNotificationMessage"] =
      build(
        makeCall({ reason: MissedIncomingCallReason.CallerHungUp }),
      ).pushNotificationMessage;

    expect(push.title).toBe("Missed call to Support Hotline");
    expect(push.body).toBe(
      "+14155550999 called. Caller hung up before anyone answered. Tap to open the call log.",
    );
    expect(push.clickAction).toBe(LINK);
    expect(push.url).toBe(LINK);
    expect(push.tag).toBe("incoming-call-missed");
  });

  test("WhatsApp gets the SMS text, as no WhatsApp template exists for this event", () => {
    const content: MissedCallNotificationContent = build(makeCall());

    expect(content.whatsAppMessage).toEqual({
      body: content.smsMessage.message,
    });
    expect(content.whatsAppMessage.templateKey).toBeUndefined();
  });

  test.each(Object.values(MissedIncomingCallReason))(
    "every channel names the policy and the result for %s",
    (reason: MissedIncomingCallReason) => {
      const content: MissedCallNotificationContent = build(
        makeCall({ reason }),
      );
      const result: string = MissedCallNotification.getResult(reason);

      expect(content.smsMessage.message).toContain("Support Hotline");
      expect(content.smsMessage.message).toContain(result);
      expect(content.callRequestMessage.data[0]).toMatchObject({
        sayMessage: expect.stringContaining(result),
      });
      expect(content.pushNotificationMessage.body).toContain(result);
      expect(content.emailEnvelope.vars["result"]).toBe(result);
    },
  );
});
