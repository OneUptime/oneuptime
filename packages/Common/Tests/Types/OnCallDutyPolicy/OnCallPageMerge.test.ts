import {
  ON_CALL_PAGE_MERGE_UNNAMED_POLICY,
  OnCallPageCoverKind,
  OnCallPageCoverName,
  OnCallPageMergeRun,
  getOnCallPageCoverKind,
  getOnCallPageMergeTakenOverMessage,
  getOnCallPageMergedLine,
  getOnCallPageMergedMessage,
  isOnCallPageACover,
  isOnCallPageMergeable,
  readOnCallPageMergeTakenOverDirectlyMessage,
  readOnCallPageMergeTakenOverMessage,
  readOnCallPageMergedLine,
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
 * (issues #7837, #8859, Types/OnCallDutyPolicy/OnCallPageMerge).
 *
 * A person two of a record's pages reach is paged once: the second page of
 * them is merged into their open page from the first. Only a run that ends
 * once its record is acknowledged merges its pages - a policy's that
 * OneUptime, a workflow or an API key started, and a workflow's direct page
 * (#8859): a page again, a policy started by hand, a page sent from a chat,
 * an observer's page and a test page page their people themselves. A page
 * may be merged into any responder's page - a policy's, a page sent from a
 * chat, a workflow's direct page (#8859) - never an observer's or a test
 * page.
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
  "a workflow's direct page, with the person whose workflow it is": {
    triggeredByUserId: PERSON,
    triggeredByWorkflowId: "a-workflow",
  },
  "an observer's page sent from a chat": {
    triggeredByUserId: PERSON,
    isObserverPage: true,
  },
  "a workflow's direct page to observers": {
    triggeredByWorkflowId: "a-workflow",
    isObserverPage: true,
  },
  "a test page to a person": {
    triggeredByUserId: PERSON,
    userNotificationEventType: UserNotificationEventType.TestPage,
  },
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
    // Worded as a page OneUptime starts, and ended by the acknowledgement (#8859).
    ["a workflow's direct page", true],
    ["a workflow's direct page, with the person whose workflow it is", true],
    ["an observer's page sent from a chat", false],
    ["a workflow's direct page to observers", false],
    ["a test page", false],
    ["a test page to a person", false],
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
    // A direct page stands for a policy's page too (#8859).
    ["a page sent from a chat", true],
    ["a workflow's direct page", true],
    ["a workflow's direct page, with the person whose workflow it is", true],
    ["an observer's page sent from a chat", false],
    ["a workflow's direct page to observers", false],
    ["a test page", false],
    ["a test page to a person", false],
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

/*
 * MERGED INTO A DIRECT PAGE (#8859): the line names who paged them from a
 * chat, or which workflow did - never as a policy, whatever the policy is
 * called, so the feed and the run's message say "Jane Doe is paging them",
 * not "on-call policy Jane Doe".
 */
describe("what kind of page a page is merged into", () => {
  test.each([
    ["OneUptime's run of a policy", OnCallPageCoverKind.Policy],
    ["a policy a workflow started", OnCallPageCoverKind.Policy],
    ["a policy read with its policy, not its id", OnCallPageCoverKind.Policy],
    ["a page again", OnCallPageCoverKind.Policy],
    ["a policy started by hand", OnCallPageCoverKind.Policy],
    ["a page sent from a chat", OnCallPageCoverKind.PersonPage],
    ["a workflow's direct page", OnCallPageCoverKind.WorkflowPage],
    [
      "a workflow's direct page, with the person whose workflow it is",
      OnCallPageCoverKind.WorkflowPage,
    ],
  ])("%s: %s", (name: string, kind: OnCallPageCoverKind) => {
    expect(getOnCallPageCoverKind(RUNS[name]!)).toBe(kind);
  });
});

describe("the line of a page merged into a direct page", () => {
  test("a page a person sent from a chat: names them, and reads back to them", () => {
    const cover: OnCallPageCoverName = {
      kind: OnCallPageCoverKind.PersonPage,
      name: "Jane Doe",
    };
    const line: string = getOnCallPageMergedLine(cover);

    expect(line).toBe(
      "Already paged directly about this by Jane Doe, so not paged again.",
    );
    expect(readOnCallPageMergedLine(line)).toEqual(cover);
    // Never read as a policy's.
    expect(readOnCallPageMergedMessage(line)).toBeNull();
    expect(readOnCallPageMergeTakenOverMessage(line)).toBeNull();
  });

  test("a workflow's direct page: names the workflow, and reads back to it", () => {
    const cover: OnCallPageCoverName = {
      kind: OnCallPageCoverKind.WorkflowPage,
      name: "Nightly Checks",
    };
    const line: string = getOnCallPageMergedLine(cover);

    expect(line).toBe(
      "Already paged about this through the workflow Nightly Checks, so not paged again.",
    );
    expect(readOnCallPageMergedLine(line)).toEqual(cover);
    expect(readOnCallPageMergedMessage(line)).toBeNull();
  });

  test("a policy's line is written and read as it always was", () => {
    const line: string = getOnCallPageMergedLine({
      kind: OnCallPageCoverKind.Policy,
      name: "Payments",
    });

    expect(line).toBe(getOnCallPageMergedMessage({ policyName: "Payments" }));
    expect(readOnCallPageMergedLine(line)).toEqual({
      kind: OnCallPageCoverKind.Policy,
      name: "Payments",
    });
  });

  test("a policy with no name reads back as a policy with none", () => {
    expect(
      readOnCallPageMergedLine(
        getOnCallPageMergedLine({ kind: OnCallPageCoverKind.Policy, name: "" }),
      ),
    ).toEqual({ kind: OnCallPageCoverKind.Policy, name: null });
  });

  test.each([
    "Jane Doe directly",
    "the workflow team",
    "through the workflow Nightly",
    "directly about this by Jane",
    "Payments, EU",
    "Tier 1. Database",
    "  Jane  ",
  ])(
    "a name with commas, full stops, spaces or a kind's words in it reads back whole, as its own kind: %j",
    (name: string) => {
      for (const kind of Object.values(OnCallPageCoverKind)) {
        expect(
          readOnCallPageMergedLine(
            getOnCallPageMergedLine({ kind: kind, name: name }),
          ),
        ).toEqual({ kind: kind, name: name.trim() });
      }
    },
  );

  test("a direct page with no name is worded as a policy with none: it names nobody it cannot", () => {
    for (const kind of [
      OnCallPageCoverKind.PersonPage,
      OnCallPageCoverKind.WorkflowPage,
    ]) {
      expect(getOnCallPageMergedLine({ kind: kind, name: "  " })).toBe(
        getOnCallPageMergedMessage({ policyName: null }),
      );
    }
  });

  test.each([
    "Already paged directly about this by , so not paged again.",
    "Already paged about this through the workflow , so not paged again.",
    "Already paged directly about this, so not paged again.",
    "Already paged directly about this by Jane Doe.",
  ])("any other line is no merged page's: %j", (line: string) => {
    expect(readOnCallPageMergedLine(line)).toBeNull();
  });

  test("the on-call logs read them as codes of their own, naming who or which workflow", () => {
    expect(
      readOnCallLogLine(
        getOnCallPageMergedLine({
          kind: OnCallPageCoverKind.PersonPage,
          name: "Jane Doe",
        }),
      ),
    ).toEqual({ code: OnCallLogLineCode.PageMergedDirectly, name: "Jane Doe" });
    expect(
      readOnCallLogLine(
        getOnCallPageMergedLine({
          kind: OnCallPageCoverKind.WorkflowPage,
          name: "Nightly Checks",
        }),
      ),
    ).toEqual({
      code: OnCallLogLineCode.PageMergedByWorkflow,
      name: "Nightly Checks",
    });
  });
});

describe("the line of a merged direct page that took the page over (#8859)", () => {
  test("says they are paged directly now, not that a policy pages them", () => {
    const line: string = getOnCallPageMergeTakenOverMessage({
      policyName: "Payments",
      isDirectPage: true,
    });

    expect(line).toBe(
      "Their page from Payments is over, so they are paged directly now.",
    );
    expect(readOnCallPageMergeTakenOverDirectlyMessage(line)).toBe("Payments");
    expect(readOnCallPageMergeTakenOverMessage(line)).toBeNull();
    expect(readOnCallPageMergedLine(line)).toBeNull();
  });

  test("a policy's take-over line is no direct page's", () => {
    expect(
      readOnCallPageMergeTakenOverDirectlyMessage(
        getOnCallPageMergeTakenOverMessage({ policyName: "Payments" }),
      ),
    ).toBeNull();
  });

  test("reads as its code, with the name - or with none", () => {
    expect(
      readOnCallLogLine(
        getOnCallPageMergeTakenOverMessage({
          policyName: "Jane Doe",
          isDirectPage: true,
        }),
      ),
    ).toEqual({
      code: OnCallLogLineCode.PageMergeTakenOverDirectly,
      name: "Jane Doe",
    });
    expect(
      readOnCallLogLine(
        getOnCallPageMergeTakenOverMessage({
          policyName: null,
          isDirectPage: true,
        }),
      ),
    ).toEqual({ code: OnCallLogLineCode.PageMergeTakenOverDirectly });
  });

  test("the name a page merged into a direct page reads back by is what its take-over names", () => {
    const by: OnCallPageCoverName | null = readOnCallPageMergedLine(
      getOnCallPageMergedLine({
        kind: OnCallPageCoverKind.PersonPage,
        name: "Jane Doe",
      }),
    );

    expect(getOnCallPageMergeTakenOverMessage({ policyName: by?.name })).toBe(
      "Their page from Jane Doe is over, so this policy pages them now.",
    );
  });
});

test("the unnamed policy's words are the readers' too", () => {
  expect(ON_CALL_PAGE_MERGE_UNNAMED_POLICY).toBe("another on-call policy");
});
