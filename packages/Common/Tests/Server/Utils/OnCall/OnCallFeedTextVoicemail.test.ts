import { describe, expect, test } from "@jest/globals";
import OnCallFeedText, {
  OnCallDirectPagePager,
  OnCallDirectPageStepFeedTextInput,
  OnCallStepFeedTextInput,
} from "../../../../Server/Utils/OnCall/OnCallFeedText";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import {
  OnCallPageChannel,
  OnCallPageNotificationEvent,
  OnCallPageNotificationNews,
} from "../../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  CALL_ANSWERED_MESSAGE,
  CALL_BUSY_MESSAGE,
  CALL_FAX_MESSAGE,
  CALL_NOT_CONNECTED_MESSAGE,
  CALL_RANG_OUT_MESSAGE,
  CALL_VOICEMAIL_MESSAGE_LEFT_MESSAGE,
  CALL_VOICEMAIL_NO_MESSAGE_MESSAGE,
  CallOutcomeLine,
  MACHINE_ANSWERED_CALL_OUTCOMES,
  getCallMachineAnsweredFeedSentence,
  getCallOutcomeMessage,
  isMachineAnsweredCallOutcome,
  readCallOutcomeMessage,
} from "../../../../Types/OnCallDutyPolicy/OnCallSentLine";
import FeedMarkdown, {
  MarkdownText,
} from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * A CALL A MACHINE ANSWERED, IN THE RECORD'S FEED AND THE CALL'S LINE (#6594).
 *
 * To Twilio, a call voicemail picks up is answered, so for a responder with
 * voicemail "did not pick up" ended as answered, and the feed said nothing.
 * Now Twilio's answering machine detection tells OneUptime who answered,
 * and a call voicemail answered is not answered:
 *
 *   - its line says so, after the call's id, in a sentence the on-call logs
 *     read back to word in the reader's language: it went to voicemail, and
 *     a message was left - or none was - or a fax machine picked up;
 *   - the feed's "Nitin did not answer the phone call ..." says it after:
 *     "It went to voicemail, and a message was left." - so a responder knows
 *     the person may hear it. A call that rang out or found the line busy
 *     reads as it always did.
 */

const POLICY: MarkdownText = FeedMarkdown.link(
  "Payments primary",
  "https://oneuptime.com/dashboard/p/on-call-duty/policies/x",
);
const NITIN: MarkdownText = FeedMarkdown.link(
  "Nitin Kumar",
  "https://oneuptime.com/dashboard/p/users/n",
);

const POLICY_IN_SENTENCE_MD: string =
  "on-call policy **[Payments primary](https://oneuptime.com/dashboard/p/on-call-duty/policies/x)**";
const NITIN_MD: string =
  "**[Nitin Kumar](https://oneuptime.com/dashboard/p/users/n)**";
const RULE_MD: string = "**First line** (Level 1 of 3, schedule **Primary**)";

const WORKFLOW: OnCallDirectPagePager = {
  workflowName: "Page the on-call engineer",
};
const WORKFLOW_IN_SENTENCE_MD: string =
  "workflow **Page the on-call engineer**";

const CALL_SID: string = "CA0123456789abcdef0123456789abcdef";

function step(): OnCallStepFeedTextInput {
  return {
    status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    policyLink: POLICY,
    recipient: NITIN,
    ruleName: "First line",
    ruleOrder: 1,
    ruleCount: 3,
    scheduleName: "Primary",
  };
}

function directStep(): OnCallDirectPageStepFeedTextInput {
  return {
    status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    pager: WORKFLOW,
    recipient: NITIN,
  };
}

function notAnswered(
  callOutcome?: CallOutcomeLine | undefined,
): OnCallPageNotificationNews {
  return {
    event: OnCallPageNotificationEvent.NotAnswered,
    channels: [OnCallPageChannel.Call],
    isPagedBefore: false,
    ...(callOutcome ? { callOutcome: callOutcome } : {}),
  };
}

const NOT_ANSWERED_MD: string = `${NITIN_MD} did not answer the phone call from ${POLICY_IN_SENTENCE_MD} at ${RULE_MD}.`;
const DIRECT_NOT_ANSWERED_MD: string = `${NITIN_MD} did not answer the phone call from ${WORKFLOW_IN_SENTENCE_MD}.`;

describe("the feed: a call a machine answered says so after 'did not answer'", () => {
  test.each([
    [
      CallOutcomeLine.VoicemailMessageLeft,
      "It went to voicemail, and a message was left.",
    ],
    [
      CallOutcomeLine.VoicemailNoMessage,
      "It went to voicemail, and no message was left.",
    ],
    [CallOutcomeLine.Fax, "A fax machine picked up."],
  ])(
    "a policy's page, %s: %s",
    (outcome: CallOutcomeLine, sentence: string) => {
      expect(
        OnCallFeedText.getStepNotificationMarkdown(
          step(),
          notAnswered(outcome),
        ),
      ).toBe(`${NOT_ANSWERED_MD} ${sentence}`);
    },
  );

  test.each([
    [
      CallOutcomeLine.VoicemailMessageLeft,
      "It went to voicemail, and a message was left.",
    ],
    [
      CallOutcomeLine.VoicemailNoMessage,
      "It went to voicemail, and no message was left.",
    ],
    [CallOutcomeLine.Fax, "A fax machine picked up."],
  ])("a direct page, %s: %s", (outcome: CallOutcomeLine, sentence: string) => {
    expect(
      OnCallFeedText.getDirectPageStepNotificationMarkdown(
        directStep(),
        notAnswered(outcome),
      ),
    ).toBe(`${DIRECT_NOT_ANSWERED_MD} ${sentence}`);
  });

  test.each([
    undefined,
    CallOutcomeLine.RangOut,
    CallOutcomeLine.Busy,
    CallOutcomeLine.Answered,
    CallOutcomeLine.NotConnected,
  ])(
    "rang out, busy, or nothing said of it (%p): the sentence as it always was",
    (outcome: CallOutcomeLine | undefined) => {
      expect(
        OnCallFeedText.getStepNotificationMarkdown(
          step(),
          notAnswered(outcome),
        ),
      ).toBe(NOT_ANSWERED_MD);
      expect(
        OnCallFeedText.getDirectPageStepNotificationMarkdown(
          directStep(),
          notAnswered(outcome),
        ),
      ).toBe(DIRECT_NOT_ANSWERED_MD);
    },
  );

  test("only a call not answered says it: a page sent later, or one that failed, never does", () => {
    for (const event of [
      OnCallPageNotificationEvent.SentLater,
      OnCallPageNotificationEvent.Failed,
    ]) {
      const markdown: string = OnCallFeedText.getStepNotificationMarkdown(
        step(),
        {
          event: event,
          channels: [OnCallPageChannel.Call],
          isPagedBefore: false,
          callOutcome: CallOutcomeLine.VoicemailMessageLeft,
        },
      );

      expect(markdown).not.toContain("voicemail");
    }
  });
});

describe("a call's line, read back", () => {
  test.each([
    [CALL_VOICEMAIL_MESSAGE_LEFT_MESSAGE, CallOutcomeLine.VoicemailMessageLeft],
    [CALL_VOICEMAIL_NO_MESSAGE_MESSAGE, CallOutcomeLine.VoicemailNoMessage],
    [CALL_FAX_MESSAGE, CallOutcomeLine.Fax],
  ])(
    "%s, after the call's id or on its own",
    (sentence: string, outcome: CallOutcomeLine) => {
      expect(
        readCallOutcomeMessage(
          getCallOutcomeMessage({ callId: CALL_SID, sentence: sentence }),
        ),
      ).toEqual({ outcome: outcome, callId: CALL_SID });
      expect(
        readCallOutcomeMessage(
          getCallOutcomeMessage({ callId: null, sentence: sentence }),
        ),
      ).toEqual({ outcome: outcome });
    },
  );

  test("the words are plain about what happened", () => {
    expect(CALL_VOICEMAIL_MESSAGE_LEFT_MESSAGE).toBe(
      "The call was not answered: it went to voicemail, and a message was left.",
    );
    expect(CALL_VOICEMAIL_NO_MESSAGE_MESSAGE).toBe(
      "The call was not answered: it went to voicemail, and no message was left.",
    );
    expect(CALL_FAX_MESSAGE).toBe(
      "The call was not answered: a fax machine picked up.",
    );
  });

  test("the machines are voicemail, with a message left or not, and a fax - no other outcome", () => {
    expect([...MACHINE_ANSWERED_CALL_OUTCOMES].sort()).toEqual(
      [
        CallOutcomeLine.VoicemailMessageLeft,
        CallOutcomeLine.VoicemailNoMessage,
        CallOutcomeLine.Fax,
      ].sort(),
    );

    for (const outcome of Object.values(CallOutcomeLine)) {
      expect({
        outcome,
        isMachine: isMachineAnsweredCallOutcome(outcome),
        hasFeedSentence: getCallMachineAnsweredFeedSentence(outcome) !== null,
      }).toEqual({
        outcome,
        isMachine: MACHINE_ANSWERED_CALL_OUTCOMES.includes(outcome),
        hasFeedSentence: MACHINE_ANSWERED_CALL_OUTCOMES.includes(outcome),
      });
    }

    expect(isMachineAnsweredCallOutcome(undefined)).toBe(false);
    expect(isMachineAnsweredCallOutcome(null)).toBe(false);
    expect(getCallMachineAnsweredFeedSentence(undefined)).toBeNull();
  });

  test("the lines of before read as they did", () => {
    expect(readCallOutcomeMessage(CALL_ANSWERED_MESSAGE)?.outcome).toBe(
      CallOutcomeLine.Answered,
    );
    expect(readCallOutcomeMessage(CALL_RANG_OUT_MESSAGE)?.outcome).toBe(
      CallOutcomeLine.RangOut,
    );
    expect(readCallOutcomeMessage(CALL_BUSY_MESSAGE)?.outcome).toBe(
      CallOutcomeLine.Busy,
    );
    expect(readCallOutcomeMessage(CALL_NOT_CONNECTED_MESSAGE)?.outcome).toBe(
      CallOutcomeLine.NotConnected,
    );
  });
});
