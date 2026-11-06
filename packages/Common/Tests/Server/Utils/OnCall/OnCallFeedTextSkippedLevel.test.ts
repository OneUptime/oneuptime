import { describe, expect, test } from "@jest/globals";
import OnCallFeedText from "../../../../Server/Utils/OnCall/OnCallFeedText";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import { ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE } from "../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import FeedMarkdown, {
  MarkdownText,
} from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * A LEVEL SKIPPED BY ESCALATING, IN THE RECORD'S FEED.
 *
 * Somebody escalating may pick a later level than the next; each level
 * between gets a line on the run's timeline, and the record's feed reads it
 * back as one sentence - which level, and why - between the entry of the
 * person who escalated and the entries of the level picked:
 *
 *   Ana Lopez escalated the page from on-call policy Payments at Level 1
 *     of 3.
 *   On-call policy Payments skipped Platform leads (Level 2 of 3): the page
 *     was escalated past it.
 *   On-call policy Payments paged Carl Diaz at DBA leads (Level 3 of 3).
 *
 * It is no level that "paged nobody": nothing needs fixing, so it says so in
 * its own words, and adds none of the line's own after them.
 */

const POLICY: MarkdownText = FeedMarkdown.link(
  "Payments",
  "https://oneuptime.com/dashboard/p/on-call-duty/policies/x",
);

const POLICY_MD: string =
  "**[Payments](https://oneuptime.com/dashboard/p/on-call-duty/policies/x)**";

describe("a level skipped by escalating", () => {
  test("names the level by its name and place, and says why it was skipped", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        policyLink: POLICY,
        ruleName: "Platform leads",
        ruleOrder: 2,
        ruleCount: 3,
        statusMessage: ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} skipped **Platform leads** (Level 2 of 3): the page was escalated past it.`,
    );
  });

  test("a level with no name of its own is named by its place", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        policyLink: POLICY,
        ruleName: "Level 2",
        ruleOrder: 2,
        ruleCount: 4,
        statusMessage: ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} skipped **Level 2 of 4**: the page was escalated past it.`,
    );
  });

  test("never says the level paged nobody, or that it has no responders", () => {
    const text: string = OnCallFeedText.getStepMarkdown({
      status: OnCallDutyExecutionLogTimelineStatus.Skipped,
      policyLink: POLICY,
      ruleName: "Platform leads",
      ruleOrder: 2,
      ruleCount: 3,
      statusMessage: ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
    });

    expect(text).not.toContain("paged nobody");
    expect(text).not.toContain("no responders");
    expect(text).not.toContain("moved on at once");
    // The line's own words are said once, in the sentence.
    expect(text).not.toContain(
      ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
    );
  });

  test("a name somebody typed is text, never Markdown", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        policyLink: POLICY,
        ruleName: "**Leads** [here](https://example.com)",
        ruleOrder: 2,
        ruleCount: 3,
        statusMessage: ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
      }),
    ).not.toContain("[here](https://example.com)");
  });

  test("a level whose place is not known is named as such lines always were", () => {
    expect(
      OnCallFeedText.getStepMarkdown({
        status: OnCallDutyExecutionLogTimelineStatus.Skipped,
        policyLink: POLICY,
        ruleName: "Platform leads",
        statusMessage: ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
      }),
    ).toBe(
      `On-call policy ${POLICY_MD} skipped escalation rule **Platform leads**: the page was escalated past it.`,
    );
  });
});
