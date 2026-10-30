import { describe, expect, test } from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import {
  ON_CALL_PERSON_PAGE_MESSAGE_MAX_LENGTH,
  OnCallPersonPageNotice,
  getOnCallPersonPageCallMessage,
  getOnCallPersonPageCallSentence,
  getOnCallPersonPageEmailLine,
  getOnCallPersonPageEmailMessageLine,
  getOnCallPersonPageEmailSubject,
  getOnCallPersonPageLead,
  getOnCallPersonPageMessage,
  getOnCallPersonPagePushBody,
  getOnCallPersonPagePushTitle,
  getOnCallPersonPageWhyLine,
  isOnCallPersonPage,
  toOnCallPersonPageMessage,
} from "../../../Types/OnCallDutyPolicy/OnCallPersonPage";

/*
 * A PAGE A PERSON ASKED FOR - from Slack or Microsoft Teams - is a direct
 * page started by a person, with no policy and no workflow behind it. It
 * goes on until one of the people it paged answers it, or its record is
 * resolved, and every notification it sends says who paged, why this
 * person, and what they wrote.
 */

const USER: ObjectID = new ObjectID("f6000000-0000-4000-8000-000000000001");
const POLICY: ObjectID = new ObjectID("f6000000-0000-4000-8000-000000000002");
const WORKFLOW: ObjectID = new ObjectID("f6000000-0000-4000-8000-000000000003");

describe("isOnCallPersonPage: which runs are a page a person asked for", () => {
  test.each([
    [
      "a direct page a person started (Slack, Teams)",
      { triggeredByUserId: USER },
      true,
    ],
    [
      "the same, with the person's id as text",
      { triggeredByUserId: USER.toString() },
      true,
    ],
    [
      "a direct page a workflow started",
      { triggeredByWorkflowId: WORKFLOW },
      false,
    ],
    [
      "a direct page a workflow started as a person",
      { triggeredByUserId: USER, triggeredByWorkflowId: WORKFLOW },
      false,
    ],
    [
      "an on-call policy's run a person started (Execute On-Call Policy)",
      { onCallDutyPolicyId: POLICY, triggeredByUserId: USER },
      false,
    ],
    [
      "an on-call policy's run read with its policy only",
      { onCallDutyPolicy: {}, triggeredByUserId: USER },
      false,
    ],
    ["a direct page nobody started (OneUptime's own)", {}, false],
    ["a run with an empty person", { triggeredByUserId: "" }, false],
    ["no run at all", null, false],
  ])("%s: %p", (_name: string, run: unknown, expected: boolean) => {
    expect(
      isOnCallPersonPage(run as Parameters<typeof isOnCallPersonPage>[0]),
    ).toBe(expected);
  });
});

describe("toOnCallPersonPageMessage: the message as a page keeps it", () => {
  test("on one line, without white space at its ends", () => {
    expect(
      toOnCallPersonPageMessage("  Can you check\n\nthe   database?\t"),
    ).toBe("Can you check the database?");
  });

  test("none, or only white space: empty", () => {
    expect(toOnCallPersonPageMessage(undefined)).toBe("");
    expect(toOnCallPersonPageMessage(null)).toBe("");
    expect(toOnCallPersonPageMessage(" \n\t ")).toBe("");
  });

  test("as long as an alert's title, at most: longer is cut with an ellipsis", () => {
    expect(ON_CALL_PERSON_PAGE_MESSAGE_MAX_LENGTH).toBe(500);

    const exactly: string = "a".repeat(500);
    expect(toOnCallPersonPageMessage(exactly)).toBe(exactly);

    const kept: string = toOnCallPersonPageMessage(`${"word ".repeat(200)}`);
    expect(kept.length).toBeLessThanOrEqual(500);
    expect(kept.endsWith("…")).toBe(true);
    // The cut never leaves a space before the ellipsis.
    expect(kept.endsWith(" …")).toBe(false);
  });

  test("a very long message is read in time that grows with it", () => {
    const timed: FastestRun<string> = fastestRun({
      run: (): string => {
        return toOnCallPersonPageMessage(" a\n".repeat(200_000));
      },
      limitInMs: 2000,
    });

    expect(timed.result.length).toBe(500);
    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("the words of a person's page, for the person it pages", () => {
  const byName: OnCallPersonPageNotice = { pagedByName: "Alice Kim" };
  const asTeam: OnCallPersonPageNotice = {
    pagedByName: "Alice Kim",
    teamName: "Platform",
  };
  const asSchedule: OnCallPersonPageNotice = {
    pagedByName: "Alice Kim",
    scheduleName: "Primary",
  };
  const withMessage: OnCallPersonPageNotice = {
    pagedByName: "Alice Kim",
    teamName: "Platform",
    message: "  Can you check\nthe database? ",
  };

  test("the lead names who paged, then whom - a team by its name first", () => {
    expect(getOnCallPersonPageLead(byName)).toBe("Alice Kim paged you");
    expect(getOnCallPersonPageLead(asTeam)).toBe("Alice Kim paged Platform");
    expect(getOnCallPersonPageLead(asSchedule)).toBe(
      "Alice Kim paged whoever is on call in Primary",
    );
    // A team and a schedule both: the team the person was reached through.
    expect(
      getOnCallPersonPageLead({ ...asTeam, scheduleName: "Primary" }),
    ).toBe("Alice Kim paged Platform");
  });

  test("somebody with no name is somebody", () => {
    expect(getOnCallPersonPageLead({ pagedByName: "   " })).toBe(
      "Someone paged you",
    );
  });

  test("why this person, where a page OneUptime starts says they are on call", () => {
    expect(getOnCallPersonPageWhyLine(byName)).toBe(
      "You're getting this because Alice Kim paged you by name.",
    );
    expect(getOnCallPersonPageWhyLine(asTeam)).toBe(
      "You're getting this because you're a member of Platform.",
    );
    expect(getOnCallPersonPageWhyLine(asSchedule)).toBe(
      "You're getting this because you're on call in Primary.",
    );
  });

  test("the message, on one line, or nothing", () => {
    expect(getOnCallPersonPageMessage(withMessage)).toBe(
      "Can you check the database?",
    );
    expect(getOnCallPersonPageMessage(asTeam)).toBe("");
  });

  test("a push: who paged and the record in the title, the title, project and message in the body", () => {
    expect(
      getOnCallPersonPagePushTitle({
        recordLabel: " Incident INC-42 ",
        notice: asTeam,
      }),
    ).toBe("Alice Kim paged Platform: Incident INC-42");
    expect(
      getOnCallPersonPagePushBody({
        recordTitle: "Checkout is down",
        projectName: "Acme",
        notice: withMessage,
      }),
    ).toBe("Checkout is down, in Acme. “Can you check the database?”");
    expect(
      getOnCallPersonPagePushBody({
        recordTitle: "Checkout is down",
        projectName: "",
        notice: byName,
      }),
    ).toBe("Checkout is down.");
  });

  test("a call: who paged about what, then the message as said by them", () => {
    expect(
      getOnCallPersonPageCallSentence({
        recordNoun: "incident",
        notice: asTeam,
      }),
    ).toBe("Alice Kim paged Platform about an incident");
    expect(
      getOnCallPersonPageCallSentence({ recordNoun: "alert", notice: byName }),
    ).toBe("Alice Kim paged you about an alert");
    expect(getOnCallPersonPageCallMessage(withMessage)).toBe(
      "Alice Kim says: Can you check the database?",
    );
    expect(getOnCallPersonPageCallMessage(byName)).toBe("");
  });

  test("an email: the line it opens with, the message's line, and its subject", () => {
    expect(
      getOnCallPersonPageEmailLine({
        recordNoun: "incident",
        projectName: "Acme",
        notice: asTeam,
      }),
    ).toBe(
      "Alice Kim paged Platform about this incident in the project Acme. You're a member of Platform.",
    );
    expect(
      getOnCallPersonPageEmailLine({
        recordNoun: "alert",
        projectName: " ",
        notice: asSchedule,
      }),
    ).toBe(
      "Alice Kim paged whoever is on call in Primary about this alert. You're on call in Primary.",
    );
    expect(
      getOnCallPersonPageEmailLine({
        recordNoun: "incident",
        projectName: "Acme",
        notice: byName,
      }),
    ).toBe("Alice Kim paged you about this incident in the project Acme.");
    expect(getOnCallPersonPageEmailMessageLine(withMessage)).toBe(
      "Alice Kim wrote: “Can you check the database?”",
    );
    expect(getOnCallPersonPageEmailMessageLine(byName)).toBe("");
    expect(
      getOnCallPersonPageEmailSubject({
        recordLabel: "Incident INC-42",
        recordTitle: "Checkout is down",
        notice: asTeam,
      }),
    ).toBe(
      "ACTION REQUIRED: Alice Kim paged Platform about Incident INC-42 - Checkout is down",
    );
  });
});
