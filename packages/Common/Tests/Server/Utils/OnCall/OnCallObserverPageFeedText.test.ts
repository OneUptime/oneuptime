import { describe, expect, test } from "@jest/globals";
import OnCallFeedText from "../../../../Server/Utils/OnCall/OnCallFeedText";
import RuleFeedMarkdown from "../../../../Server/Utils/Rules/RuleFeedMarkdown";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import FeedMarkdown, {
  MarkdownText,
} from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * AN OBSERVER'S PAGE, IN ITS RECORD'S FEED (OnCallObserverPage).
 *
 * The feed says a policy started paging AS OBSERVERS, and that somebody who
 * answered has seen the page - never that they acknowledged it, which would
 * read as them taking the incident on. A rule's entry lists the policies it
 * attached apart from those it pages as observers.
 */

const POLICY: MarkdownText = FeedMarkdown.link(
  "Oversight on-call",
  "https://oneuptime.com/dashboard/p/on-call-duty/policies/x",
);
const NITIN: MarkdownText = FeedMarkdown.link(
  "Nitin Kumar",
  "https://oneuptime.com/dashboard/p/users/n",
);

const POLICY_MD: string =
  "**[Oversight on-call](https://oneuptime.com/dashboard/p/on-call-duty/policies/x)**";
const NITIN_MD: string =
  "**[Nitin Kumar](https://oneuptime.com/dashboard/p/users/n)**";

describe("a run that pages as observers", () => {
  test("started by a rule: it started paging as observers", () => {
    expect(
      OnCallFeedText.getRunStartedMarkdown({
        policyLink: POLICY,
        isStartedBySomeone: false,
        isObserverPage: true,
      }),
    ).toBe(`On-call policy ${POLICY_MD} started paging as observers.`);
  });

  test("started by a person, or a workflow: on-call policy X as observers", () => {
    expect(
      OnCallFeedText.getRunStartedMarkdown({
        policyLink: POLICY,
        isStartedBySomeone: true,
        isObserverPage: true,
      }),
    ).toBe(`started on-call policy ${POLICY_MD} as observers.`);

    expect(
      OnCallFeedText.getRunStartedMarkdown({
        policyLink: POLICY,
        isStartedBySomeone: false,
        startedByWorkflowName: "Tell oversight",
        isObserverPage: true,
      }),
    ).toBe(
      `Workflow **Tell oversight** started on-call policy ${POLICY_MD} as observers.`,
    );
  });

  test("waiting for working hours: it is not paging its observers yet", () => {
    expect(
      OnCallFeedText.getRunWaitingMarkdown({
        policyLink: POLICY,
        isStartedBySomeone: false,
        isObserverPage: true,
        waitingMessage: "Waiting for working hours.",
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} is not paging as observers yet. Waiting for working hours.`,
    );
  });

  test("started early: it started paging as observers early, and why", () => {
    expect(
      OnCallFeedText.getRunStartedMarkdown({
        policyLink: POLICY,
        isStartedBySomeone: false,
        startedEarlyReason: "The incident now matches a rule",
        isObserverPage: true,
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} started paging as observers early. The incident now matches a rule.`,
    );
  });

  test("a responder's run reads as before", () => {
    expect(
      OnCallFeedText.getRunStartedMarkdown({
        policyLink: POLICY,
        isStartedBySomeone: false,
      }),
    ).toBe(`On-call policy ${POLICY_MD} started paging.`);
  });
});

describe("somebody answers an observer's page", () => {
  test("a policy's: they have seen it, as an observer - not acknowledged", () => {
    const markdown: string = OnCallFeedText.getStepMarkdown({
      status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
      policyLink: POLICY,
      ruleName: "first",
      recipient: NITIN,
      isObserverPage: true,
    });

    expect(markdown).toBe(
      `${NITIN_MD} has seen the page from on-call policy ${POLICY_MD} at escalation rule **first**, as an observer.`,
    );
    expect(markdown).not.toContain("acknowledged");
  });

  test("a direct page's: they have seen it, as an observer", () => {
    const markdown: string = OnCallFeedText.getDirectPageStepMarkdown({
      status: OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
      pager: { workflowName: "Tell oversight" },
      recipient: NITIN,
      isObserverPage: true,
    });

    expect(markdown).toBe(
      `${NITIN_MD} has seen the page from workflow **Tell oversight**, as an observer.`,
    );
  });

  test("a page sent reads as any page sent", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        policyLink: POLICY,
        ruleName: "first",
        recipient: NITIN,
        isObserverPage: true,
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} paged ${NITIN_MD} at escalation rule **first**.`,
    );
  });
});

describe("a rule's entry lists what it attached apart from what it pages as observers", () => {
  test("both: the attached list first, then the observers", () => {
    expect(
      RuleFeedMarkdown.onCallRulePolicies({
        recordNoun: "incident",
        attachedPolicyNames: ["Platform on-call"],
        observerPolicyNames: ["Oversight on-call", "Leadership"],
      }).toString(),
    ).toBe(
      "Attached the following on-call policy to the incident:\n- Platform on-call\n\nPaging the following on-call policies as observers - kept informed, while the people responding stay on the incident:\n- Oversight on-call\n- Leadership",
    );
  });

  test("observers only: nothing said about attaching", () => {
    const markdown: string = RuleFeedMarkdown.onCallRulePolicies({
      recordNoun: "alert",
      attachedPolicyNames: [],
      observerPolicyNames: ["Oversight on-call"],
    }).toString();

    expect(markdown).not.toContain("Attached");
    expect(markdown).toContain("stay on the alert");
  });

  test("policies with no names still say what happened", () => {
    expect(
      RuleFeedMarkdown.onCallRulePolicies({
        recordNoun: "incident",
        attachedPolicyNames: [],
        observerPolicyNames: [],
      }).toString(),
    ).toContain("(no named policies)");
  });

  test("names are text: never a link or formatting", () => {
    const markdown: string = RuleFeedMarkdown.onCallRulePolicies({
      recordNoun: "incident",
      attachedPolicyNames: [],
      observerPolicyNames: ["[Click](https://evil.example) **now**"],
    }).toString();

    expect(markdown).not.toContain("[Click](https://evil.example)");
    expect(markdown).not.toContain("**now**");
  });
});
