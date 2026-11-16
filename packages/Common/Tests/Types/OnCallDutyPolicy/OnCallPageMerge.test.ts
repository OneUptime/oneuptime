import {
  ON_CALL_PAGE_MERGE_UNNAMED_POLICY,
  OnCallPageMergeRun,
  getOnCallPageMergeTakenOverMessage,
  getOnCallPageMergedMessage,
  isOnCallPageACover,
  isOnCallPageMergeable,
  readOnCallPageMergeTakenOverMessage,
  readOnCallPageMergedMessage,
} from "../../../Types/OnCallDutyPolicy/OnCallPageMerge";
import {
  OnCallLogLineCode,
  readOnCallLogLine,
} from "../../../Types/OnCallDutyPolicy/OnCallLogLine";
import { isOnCallPageLineReached } from "../../../Types/OnCallDutyPolicy/OnCallEmptyLevel";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import { describe, expect, test } from "@jest/globals";

/*
 * WHICH PAGES ARE MERGED, INTO WHICH, AND THE WORDS OF A MERGED PAGE
 * (issue #7837, Types/OnCallDutyPolicy/OnCallPageMerge).
 *
 * A person two of a record's policies page is paged once: the second
 * policy's page of them is merged into their open page from the first. Only
 * a policy's run that ends once its record is acknowledged merges its pages:
 * a page again, a policy started by hand, a page sent from a chat, an
 * observer's page and a test page page their people themselves. A page may
 * be merged into any responder's page of a policy - never an observer's, a
 * direct page or a test page.
 */

const POLICY: string = "a-policy";
const PERSON: string = "a-person";

const RUNS: Record<string, OnCallPageMergeRun> = {
  "OneUptime's run of a policy": { onCallDutyPolicyId: POLICY },
  "a policy a workflow started": {
    onCallDutyPolicyId: POLICY,
    triggeredByUserId: PERSON,
    triggeredByWorkflowId: "a-workflow",
  },
  "a policy read with its policy, not its id": {
    onCallDutyPolicy: { name: "Payments" },
  },
  "a page again": { onCallDutyPolicyId: POLICY, pageAgainNumber: 1 },
  "a policy started by hand": {
    onCallDutyPolicyId: POLICY,
    triggeredByUserId: PERSON,
  },
  "an observer's page of a policy": {
    onCallDutyPolicyId: POLICY,
    isObserverPage: true,
  },
  "a page sent from a chat": { triggeredByUserId: PERSON },
  "a workflow's direct page": { triggeredByWorkflowId: "a-workflow" },
  "a test page": {
    onCallDutyPolicyId: POLICY,
    triggeredByUserId: PERSON,
    userNotificationEventType: UserNotificationEventType.TestPage,
  },
};

describe("which pages are merged into the person's open page", () => {
  test.each([
    ["OneUptime's run of a policy", true],
    ["a policy a workflow started", true],
    ["a policy read with its policy, not its id", true],
    ["a page again", false],
    ["a policy started by hand", false],
    ["an observer's page of a policy", false],
    ["a page sent from a chat", false],
    ["a workflow's direct page", false],
    ["a test page", false],
  ])("%s: %s", (name: string, isMerged: boolean) => {
    expect(isOnCallPageMergeable(RUNS[name])).toBe(isMerged);
  });

  test("a run not read is never merged", () => {
    expect(isOnCallPageMergeable(null)).toBe(false);
    expect(isOnCallPageMergeable(undefined)).toBe(false);
  });
});

describe("which pages a page is merged into", () => {
  test.each([
    ["OneUptime's run of a policy", true],
    ["a policy a workflow started", true],
    ["a page again", true],
    ["a policy started by hand", true],
    ["an observer's page of a policy", false],
    ["a page sent from a chat", false],
    ["a workflow's direct page", false],
    ["a test page", false],
  ])("%s: %s", (name: string, isACover: boolean) => {
    expect(isOnCallPageACover(RUNS[name])).toBe(isACover);
  });

  test("a run not read is no page to merge into", () => {
    expect(isOnCallPageACover(null)).toBe(false);
  });
});

describe("a merged page's lines", () => {
  test("say which policy is paging them, and read back to it", () => {
    const line: string = getOnCallPageMergedMessage({ policyName: "Payments" });

    expect(line).toBe(
      "Already paged about this by Payments, so not paged again.",
    );
    expect(readOnCallPageMergedMessage(line)).toBe("Payments");
    expect(readOnCallPageMergeTakenOverMessage(line)).toBeNull();
  });

  test("the line of a page that took the page over reads back to the policy too", () => {
    const line: string = getOnCallPageMergeTakenOverMessage({
      policyName: "Payments",
    });

    expect(line).toBe(
      "Their page from Payments is over, so this policy pages them now.",
    );
    expect(readOnCallPageMergeTakenOverMessage(line)).toBe("Payments");
    expect(readOnCallPageMergedMessage(line)).toBeNull();
  });

  test.each([
    "Payments, EU",
    "Tier 1. Database",
    "  Payments  ",
    "Already paged about this by ",
  ])(
    "a name with commas, full stops or spaces in it reads back whole: %j",
    (name: string) => {
      expect(
        readOnCallPageMergedMessage(
          getOnCallPageMergedMessage({ policyName: name }),
        ),
      ).toBe(name.trim());
      expect(
        readOnCallPageMergeTakenOverMessage(
          getOnCallPageMergeTakenOverMessage({ policyName: name }),
        ),
      ).toBe(name.trim());
    },
  );

  test.each([null, undefined, "", "   "])(
    "a policy with no name is another on-call policy: %j",
    (name: string | null | undefined) => {
      expect(getOnCallPageMergedMessage({ policyName: name })).toBe(
        "Already paged about this by another on-call policy, so not paged again.",
      );
      expect(
        readOnCallPageMergedMessage(
          getOnCallPageMergedMessage({ policyName: name }),
        ),
      ).toBe(ON_CALL_PAGE_MERGE_UNNAMED_POLICY);
    },
  );

  test.each([
    "",
    "Skipped because notification sent to this user already.",
    "Already paged about this by , so not paged again.",
    "Already paged for this, so not paged again.",
    "Their page from Payments is over.",
  ])("any other line is no merged page's: %j", (line: string) => {
    expect(readOnCallPageMergedMessage(line)).toBeNull();
    expect(readOnCallPageMergeTakenOverMessage(line)).toBeNull();
  });

  test("the on-call logs read both lines as codes, naming the policy", () => {
    expect(
      readOnCallLogLine(getOnCallPageMergedMessage({ policyName: "Payments" })),
    ).toEqual({ code: OnCallLogLineCode.PageMerged, name: "Payments" });
    expect(
      readOnCallLogLine(
        getOnCallPageMergeTakenOverMessage({ policyName: "Payments" }),
      ),
    ).toEqual({ code: OnCallLogLineCode.PageMergeTakenOver, name: "Payments" });
  });

  test("a line naming no policy reads as a code with no name, for the Dashboard to word", () => {
    expect(
      readOnCallLogLine(getOnCallPageMergedMessage({ policyName: null })),
    ).toEqual({ code: OnCallLogLineCode.PageMerged });
    expect(
      readOnCallLogLine(getOnCallPageMergeTakenOverMessage({ policyName: "" })),
    ).toEqual({ code: OnCallLogLineCode.PageMergeTakenOver });
  });
});

describe("a merged page's line on the run's timeline", () => {
  test("counts as reaching its person: the level waits, as for a page sent", () => {
    expect(
      isOnCallPageLineReached(
        OnCallDutyExecutionLogTimelineStatus.AlreadyPaged,
      ),
    ).toBe(true);
  });
});
