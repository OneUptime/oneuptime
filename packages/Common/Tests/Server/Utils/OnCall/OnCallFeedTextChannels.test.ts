import { describe, expect, test } from "@jest/globals";
import OnCallFeedText, {
  OnCallDirectPagePager,
  OnCallDirectPageStepFeedTextInput,
  OnCallStepFeedTextInput,
} from "../../../../Server/Utils/OnCall/OnCallFeedText";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import {
  OnCallObserverPageRecordKind,
  getOnCallObserverPageSeenMessage,
} from "../../../../Types/OnCallDutyPolicy/OnCallObserverPage";
import {
  ON_CALL_PAGE_SENT_STATUS_MESSAGE,
  OnCallPageChannel,
  OnCallPageNotificationEvent,
  OnCallPageNotificationNews,
} from "../../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import FeedMarkdown, {
  MarkdownText,
} from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * THE RECORD'S FEED SAYS HOW EACH PAGE REACHED ITS PERSON, AND HOW THEY
 * ANSWERED IT (#6568).
 *
 * "On-call policy Payments paged Nitin at Level 1 of 3. Alert Sent." said
 * that a page went out, not how: whether Nitin's phone rang, or an email
 * sat unread. The entry now names the channels its notifications went out
 * by, a notification the person's own On-Call Rules send later - a call
 * ten minutes on - or one that could not be sent is an entry of its own,
 * and an answer names the notification it came from. "Alert Sent", which
 * said nothing the sentence does not, is gone - and so is the acknowledged
 * line's own message, which repeated the headline with the person's email
 * address in it. A failure never says why: a provider's reason can hold the
 * person's phone number or email address.
 */

const POLICY: MarkdownText = FeedMarkdown.link(
  "Payments primary",
  "https://oneuptime.com/dashboard/p/on-call-duty/policies/x",
);
const NITIN: MarkdownText = FeedMarkdown.link(
  "Nitin Kumar",
  "https://oneuptime.com/dashboard/p/users/n",
);

const POLICY_MD: string =
  "On-call policy **[Payments primary](https://oneuptime.com/dashboard/p/on-call-duty/policies/x)**";
const POLICY_IN_SENTENCE_MD: string =
  "on-call policy **[Payments primary](https://oneuptime.com/dashboard/p/on-call-duty/policies/x)**";
const NITIN_MD: string =
  "**[Nitin Kumar](https://oneuptime.com/dashboard/p/users/n)**";
const RULE_MD: string = "**First line** (Level 1 of 3, schedule **Primary**)";

const WORKFLOW: OnCallDirectPagePager = {
  workflowName: "Page the on-call engineer",
};
const WORKFLOW_MD: string = "Workflow **Page the on-call engineer**";
const WORKFLOW_IN_SENTENCE_MD: string =
  "workflow **Page the on-call engineer**";

// A step of a policy's page to Nitin, at Level 1 of 3 from schedule Primary.
function step(
  more: Partial<OnCallStepFeedTextInput> = {},
): OnCallStepFeedTextInput {
  return {
    status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    policyLink: POLICY,
    recipient: NITIN,
    ruleName: "First line",
    ruleOrder: 1,
    ruleCount: 3,
    scheduleName: "Primary",
    ...more,
  };
}

// A step of a workflow's direct page to Nitin.
function directStep(
  more: Partial<OnCallDirectPageStepFeedTextInput> = {},
): OnCallDirectPageStepFeedTextInput {
  return {
    status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    pager: WORKFLOW,
    recipient: NITIN,
    ...more,
  };
}

function sentLater(
  channels: Array<OnCallPageChannel>,
  isPagedBefore: boolean,
): OnCallPageNotificationNews {
  return {
    event: OnCallPageNotificationEvent.SentLater,
    channels: channels,
    isPagedBefore: isPagedBefore,
  };
}

function failed(
  channels: Array<OnCallPageChannel>,
): OnCallPageNotificationNews {
  return {
    event: OnCallPageNotificationEvent.Failed,
    channels: channels,
    isPagedBefore: false,
  };
}

function notAnswered(
  channels: Array<OnCallPageChannel>,
): OnCallPageNotificationNews {
  return {
    event: OnCallPageNotificationEvent.NotAnswered,
    channels: channels,
    isPagedBefore: false,
  };
}

describe("a page sent names the channels it went out by", () => {
  test("one channel", () => {
    expect(
      OnCallFeedText.getStepMarkdown(
        step({ channels: [OnCallPageChannel.SMS] }),
      ),
    ).toBe(`${POLICY_MD} paged ${NITIN_MD} via SMS at ${RULE_MD}.`);
  });

  test("two channels: 'A and B', named in full", () => {
    expect(
      OnCallFeedText.getStepMarkdown(
        step({
          channels: [OnCallPageChannel.Email, OnCallPageChannel.Push],
        }),
      ),
    ).toBe(
      `${POLICY_MD} paged ${NITIN_MD} via push notification and email at ${RULE_MD}.`,
    );
  });

  test("three or more: 'A, B and C', in the list's order, each once", () => {
    expect(
      OnCallFeedText.getStepMarkdown(
        step({
          channels: [
            OnCallPageChannel.Email,
            OnCallPageChannel.Call,
            OnCallPageChannel.SMS,
            OnCallPageChannel.Email,
          ],
        }),
      ),
    ).toBe(
      `${POLICY_MD} paged ${NITIN_MD} via phone call, SMS and email at ${RULE_MD}.`,
    );
  });

  test("the team they were paged as a member of still closes the sentence", () => {
    expect(
      OnCallFeedText.getStepMarkdown(
        step({
          channels: [OnCallPageChannel.SMS],
          teamName: "Payments",
        }),
      ),
    ).toBe(
      `${POLICY_MD} paged ${NITIN_MD} via SMS at ${RULE_MD}, as a member of **Payments**.`,
    );
  });

  test("a person covering for someone says so after the sentence, as before", () => {
    expect(
      OnCallFeedText.getStepMarkdown(
        step({
          channels: [OnCallPageChannel.Push],
          overriddenUser: FeedMarkdown.link(
            "Sam Lee",
            "https://oneuptime.com/dashboard/p/users/s",
          ),
        }),
      ),
    ).toBe(
      `${POLICY_MD} paged ${NITIN_MD} via push notification at ${RULE_MD}.\n\nThey are covering for [Sam Lee](https://oneuptime.com/dashboard/p/users/s) (a user override).`,
    );
  });

  test("with no channel known - an entry from before, or none went out yet - it reads as it always did", () => {
    for (const channels of [undefined, []]) {
      expect(OnCallFeedText.getStepMarkdown(step({ channels: channels }))).toBe(
        `${POLICY_MD} paged ${NITIN_MD} at ${RULE_MD}.`,
      );
    }
  });

  test("'Alert Sent' is never said: the sentence says who it reached, and via what", () => {
    for (const statusMessage of [
      ON_CALL_PAGE_SENT_STATUS_MESSAGE,
      "alert sent",
      " Alert Sent ",
    ]) {
      const markdown: string = OnCallFeedText.getStepMarkdown(
        step({
          channels: [OnCallPageChannel.SMS],
          statusMessage: statusMessage,
        }),
      );

      expect(markdown).toBe(
        `${POLICY_MD} paged ${NITIN_MD} via SMS at ${RULE_MD}.`,
      );
      expect(markdown.toLowerCase()).not.toContain("alert sent");
    }
  });

  test("any other message still follows, as its own sentence", () => {
    expect(
      OnCallFeedText.getStepMarkdown(
        step({
          channels: [OnCallPageChannel.SMS],
          statusMessage: "Notification sent by SMS.",
        }),
      ),
    ).toBe(
      `${POLICY_MD} paged ${NITIN_MD} via SMS at ${RULE_MD}.\n\nNotification sent by SMS.`,
    );
  });

  test("a direct page names them too, before whom the person was paged as", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown(
        directStep({
          channels: [OnCallPageChannel.SMS, OnCallPageChannel.Email],
          scheduleName: "Primary",
        }),
      ),
    ).toBe(
      `${WORKFLOW_MD} paged ${NITIN_MD} via SMS and email, on call in schedule **Primary**.`,
    );
    expect(
      OnCallFeedText.getDirectPageStepMarkdown(
        directStep({
          channels: [OnCallPageChannel.Push],
          teamName: "Platform",
          statusMessage: ON_CALL_PAGE_SENT_STATUS_MESSAGE,
        }),
      ),
    ).toBe(
      `${WORKFLOW_MD} paged ${NITIN_MD} via push notification, as a member of **Platform**.`,
    );
  });

  test("a direct page with no channel known reads as it always did, without 'Alert Sent'", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown(
        directStep({ statusMessage: ON_CALL_PAGE_SENT_STATUS_MESSAGE }),
      ),
    ).toBe(`${WORKFLOW_MD} paged ${NITIN_MD}.`);
  });
});

describe("an answer names the notification it came from", () => {
  test("acknowledged from a phone call", () => {
    expect(
      OnCallFeedText.getStepMarkdown(
        step({
          status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
          channels: [OnCallPageChannel.Call],
        }),
      ),
    ).toBe(
      `${NITIN_MD} acknowledged the page from ${POLICY_IN_SENTENCE_MD} at ${RULE_MD} via phone call.`,
    );
  });

  test("after the team, set apart by a comma, so the channel is not read as the team's", () => {
    expect(
      OnCallFeedText.getStepMarkdown(
        step({
          status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
          channels: [OnCallPageChannel.Push],
          teamName: "Payments",
        }),
      ),
    ).toBe(
      `${NITIN_MD} acknowledged the page from ${POLICY_IN_SENTENCE_MD} at ${RULE_MD}, as a member of **Payments**, via push notification.`,
    );
  });

  test("acknowledged in the Dashboard or the app - no notification says so - reads as before", () => {
    expect(
      OnCallFeedText.getStepMarkdown(
        step({
          status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
        }),
      ),
    ).toBe(
      `${NITIN_MD} acknowledged the page from ${POLICY_IN_SENTENCE_MD} at ${RULE_MD}.`,
    );
  });

  test("the acknowledged line's own message - the headline again, with the person's email address - is not said", () => {
    const markdown: string = OnCallFeedText.getStepMarkdown(
      step({
        status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
        channels: [OnCallPageChannel.SMS],
        statusMessage:
          "Incident acknowledged by Nitin Kumar (nitin@example.com)",
      }),
    );

    expect(markdown).toBe(
      `${NITIN_MD} acknowledged the page from ${POLICY_IN_SENTENCE_MD} at ${RULE_MD} via SMS.`,
    );
    expect(markdown).not.toContain("nitin@example.com");
  });

  test("an observer has seen it, via the notification they answered", () => {
    const markdown: string = OnCallFeedText.getStepMarkdown(
      step({
        status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
        isObserverPage: true,
        channels: [OnCallPageChannel.SMS],
        statusMessage: getOnCallObserverPageSeenMessage({
          kind: "incident" as OnCallObserverPageRecordKind,
          userName: "Nitin Kumar",
          userEmail: "nitin@example.com",
        }),
      }),
    );

    expect(markdown).toBe(
      `${NITIN_MD} has seen the page from ${POLICY_IN_SENTENCE_MD} at ${RULE_MD} via SMS, as an observer.`,
    );
    expect(markdown).not.toContain("nitin@example.com");
  });

  test("escalated from an SMS", () => {
    expect(
      OnCallFeedText.getStepMarkdown(
        step({
          status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
          channels: [OnCallPageChannel.SMS],
        }),
      ),
    ).toBe(
      `${NITIN_MD} escalated the page from ${POLICY_IN_SENTENCE_MD} at ${RULE_MD} via SMS.`,
    );
  });

  test("a direct page's answers name the channel too", () => {
    expect(
      OnCallFeedText.getDirectPageStepMarkdown(
        directStep({
          status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
          channels: [OnCallPageChannel.Call],
          statusMessage:
            "Incident acknowledged by Nitin Kumar (nitin@example.com)",
        }),
      ),
    ).toBe(
      `${NITIN_MD} acknowledged the page from ${WORKFLOW_IN_SENTENCE_MD} via phone call.`,
    );
    expect(
      OnCallFeedText.getDirectPageStepMarkdown(
        directStep({
          status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
          isObserverPage: true,
          channels: [OnCallPageChannel.Push],
        }),
      ),
    ).toBe(
      `${NITIN_MD} has seen the page from ${WORKFLOW_IN_SENTENCE_MD} via push notification, as an observer.`,
    );
    expect(
      OnCallFeedText.getDirectPageStepMarkdown(
        directStep({
          status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
          channels: [OnCallPageChannel.SMS],
        }),
      ),
    ).toBe(
      `${NITIN_MD} escalated the page from ${WORKFLOW_IN_SENTENCE_MD} via SMS.`,
    );
  });

  test("a page that failed, was skipped or is still going out names no channel", () => {
    for (const status of [
      OnCallDutyExecutionLogTimelineStatus.Error,
      OnCallDutyExecutionLogTimelineStatus.Skipped,
      OnCallDutyExecutionLogTimelineStatus.Executing,
    ]) {
      expect(
        OnCallFeedText.getStepMarkdown(
          step({ status: status, channels: [OnCallPageChannel.SMS] }),
        ),
      ).not.toContain(" via ");
    }
  });
});

describe("a notification after the page's own entry", () => {
  test("a later rule's call pages them again", () => {
    expect(
      OnCallFeedText.getStepNotificationMarkdown(
        step(),
        sentLater([OnCallPageChannel.Call], true),
      ),
    ).toBe(
      `${POLICY_MD} paged ${NITIN_MD} again via phone call at ${RULE_MD}.`,
    );
  });

  test("the first notification to reach them is no page 'again'", () => {
    expect(
      OnCallFeedText.getStepNotificationMarkdown(
        step(),
        sentLater([OnCallPageChannel.SMS], false),
      ),
    ).toBe(`${POLICY_MD} paged ${NITIN_MD} via SMS at ${RULE_MD}.`);
  });

  test("one that could not be sent", () => {
    expect(
      OnCallFeedText.getStepNotificationMarkdown(
        step({ teamName: "Payments" }),
        failed([OnCallPageChannel.SMS]),
      ),
    ).toBe(
      `${POLICY_MD} could not page ${NITIN_MD} via SMS at ${RULE_MD}, as a member of **Payments**.`,
    );
  });

  test("never says why it could not be sent: the reason can hold a phone number or an email address", () => {
    const markdown: string = OnCallFeedText.getStepNotificationMarkdown(
      step({
        statusMessage:
          "Could not send SMS to +15551234567 (nitin@example.com): the carrier refused it.",
      }),
      failed([OnCallPageChannel.SMS]),
    );

    expect(markdown).not.toContain("+1555");
    expect(markdown).not.toContain("@");
    expect(markdown).not.toContain("carrier");
  });

  test("a direct page's notifications read the same way", () => {
    expect(
      OnCallFeedText.getDirectPageStepNotificationMarkdown(
        directStep({ scheduleName: "Primary" }),
        sentLater([OnCallPageChannel.Call], true),
      ),
    ).toBe(
      `${WORKFLOW_MD} paged ${NITIN_MD} again via phone call, on call in schedule **Primary**.`,
    );
    expect(
      OnCallFeedText.getDirectPageStepNotificationMarkdown(
        directStep({ teamName: "Platform" }),
        failed([OnCallPageChannel.Push]),
      ),
    ).toBe(
      `${WORKFLOW_MD} could not page ${NITIN_MD} via push notification, as a member of **Platform**.`,
    );
  });

  test("nothing to tell - nobody, or no channel - is nothing", () => {
    expect(
      OnCallFeedText.getStepNotificationMarkdown(
        step({ recipient: undefined }),
        sentLater([OnCallPageChannel.Call], true),
      ),
    ).toBe("");
    expect(OnCallFeedText.getStepNotificationMarkdown(step(), failed([]))).toBe(
      "",
    );
    expect(
      OnCallFeedText.getDirectPageStepNotificationMarkdown(
        directStep({ recipient: undefined }),
        failed([OnCallPageChannel.SMS]),
      ),
    ).toBe("");
    expect(
      OnCallFeedText.getDirectPageStepNotificationMarkdown(
        directStep(),
        sentLater([], false),
      ),
    ).toBe("");
  });

  test("names somebody typed stay text: Markdown in a level's or a team's name formats nothing", () => {
    const markdown: string = OnCallFeedText.getStepNotificationMarkdown(
      step({
        ruleName: "**Night** [shift](https://evil.test)",
        teamName: "_Ops_",
      }),
      sentLater([OnCallPageChannel.Call], true),
    );

    expect(markdown).not.toContain("[shift](https://evil.test)");
    expect(markdown).not.toContain(" _Ops_");
    expect(markdown).toContain("again via phone call at ");
  });
});

/*
 * A CALL THAT RANG AND WAS NOT PICKED UP (#6586).
 *
 * Twilio says how each call of a page ended. One that rang out, or found
 * the line busy, is an entry of its own, said of the person - as their
 * answer is - so a review reads the page's story in order: paged via phone
 * call, did not answer the phone call, acknowledged via SMS. Never whether
 * it rang out or was declined: that is the person's own business, and the
 * call log has it for whoever owns the project's phone numbers.
 */
describe("a call they did not pick up", () => {
  test("is said of the person, from the policy, at the level - as an answer is", () => {
    expect(
      OnCallFeedText.getStepNotificationMarkdown(
        step(),
        notAnswered([OnCallPageChannel.Call]),
      ),
    ).toBe(
      `${NITIN_MD} did not answer the phone call from ${POLICY_IN_SENTENCE_MD} at ${RULE_MD}.`,
    );
  });

  test("the team they were paged as a member of closes the sentence", () => {
    expect(
      OnCallFeedText.getStepNotificationMarkdown(
        step({ teamName: "Payments" }),
        notAnswered([OnCallPageChannel.Call]),
      ),
    ).toBe(
      `${NITIN_MD} did not answer the phone call from ${POLICY_IN_SENTENCE_MD} at ${RULE_MD}, as a member of **Payments**.`,
    );
  });

  test("is never paged 'again', nor 'could not page': the call did reach them", () => {
    const markdown: string = OnCallFeedText.getStepNotificationMarkdown(
      step(),
      notAnswered([OnCallPageChannel.Call]),
    );

    expect(markdown).not.toContain(" again");
    expect(markdown).not.toContain("could not page");
    expect(markdown).not.toContain(" paged ");
  });

  test("never says how the call ended, nor the number it rang: the message is not read", () => {
    const markdown: string = OnCallFeedText.getStepNotificationMarkdown(
      step({
        statusMessage:
          "Call ID: CA0123456789abcdef0123456789abcdef. The call was not answered: the line was busy, or the call was declined. +15551234567",
      }),
      notAnswered([OnCallPageChannel.Call]),
    );

    expect(markdown).not.toContain("+1555");
    expect(markdown).not.toContain("busy");
    expect(markdown).not.toContain("declined");
    expect(markdown).not.toContain("CA0123");
  });

  test("a direct page's: of the person, from whoever paged", () => {
    expect(
      OnCallFeedText.getDirectPageStepNotificationMarkdown(
        directStep({ scheduleName: "Primary" }),
        notAnswered([OnCallPageChannel.Call]),
      ),
    ).toBe(
      `${NITIN_MD} did not answer the phone call from ${WORKFLOW_IN_SENTENCE_MD}.`,
    );
  });

  test("nothing to tell - nobody, or no channel - is nothing", () => {
    expect(
      OnCallFeedText.getStepNotificationMarkdown(
        step({ recipient: undefined }),
        notAnswered([OnCallPageChannel.Call]),
      ),
    ).toBe("");
    expect(
      OnCallFeedText.getStepNotificationMarkdown(step(), notAnswered([])),
    ).toBe("");
    expect(
      OnCallFeedText.getDirectPageStepNotificationMarkdown(
        directStep({ recipient: undefined }),
        notAnswered([OnCallPageChannel.Call]),
      ),
    ).toBe("");
    expect(
      OnCallFeedText.getDirectPageStepNotificationMarkdown(
        directStep(),
        notAnswered([]),
      ),
    ).toBe("");
  });

  test("names somebody typed stay text: Markdown in a level's or a team's name formats nothing", () => {
    const markdown: string = OnCallFeedText.getStepNotificationMarkdown(
      step({
        ruleName: "**Night** [shift](https://evil.test)",
        teamName: "_Ops_",
      }),
      notAnswered([OnCallPageChannel.Call]),
    );

    expect(markdown).not.toContain("[shift](https://evil.test)");
    expect(markdown).not.toContain(" _Ops_");
    expect(markdown).toContain("did not answer the phone call from ");
  });
});
