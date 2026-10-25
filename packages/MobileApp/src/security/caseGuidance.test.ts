import { describe, expect, test } from "@jest/globals";
import { getCaseGuidance, type CaseGuidance } from "./caseGuidance";

/*
 * The card above a case's actions answers the first question an analyst
 * opening a page has - is anybody on it? - and then says what to do next.
 * Its words never repeat a status name (the pill says those), and the tone
 * says how much it needs somebody.
 */

const OPEN: Parameters<typeof getCaseGuidance>[0] = {
  isClosed: false,
  isMine: false,
  hasAssignee: false,
  assigneeName: "",
  isContained: false,
  verdict: null,
};

describe("a case nobody has", () => {
  test("needs an analyst, as a warning, and says how to take it on", () => {
    const guidance: CaseGuidance = getCaseGuidance(OPEN);

    expect(guidance).toEqual({
      stage: "unassigned",
      tone: "warning",
      icon: "alert-circle-outline",
      title: "Needs an analyst",
      message:
        "Nobody has taken this case yet. Assign it to yourself to take it on.",
    });
  });
});

describe("a case handed to a team nobody in it has taken yet", () => {
  test("says which team it waits on, and still how to take it on", () => {
    const guidance: CaseGuidance = getCaseGuidance({
      ...OPEN,
      teamName: "Security Operations",
    });

    expect(guidance.stage).toBe("unassigned");
    expect(guidance.title).toBe("Needs an analyst");
    expect(guidance.message).toBe(
      "Waiting for someone in Security Operations. Assign it to yourself to take it on.",
    );
  });

  test("a team with no name to show reads as no team", () => {
    expect(getCaseGuidance({ ...OPEN, teamName: "   " }).message).toBe(
      "Nobody has taken this case yet. Assign it to yourself to take it on.",
    );
  });

  test("a person on the case counts before the team", () => {
    const guidance: CaseGuidance = getCaseGuidance({
      ...OPEN,
      hasAssignee: true,
      assigneeName: "Priya Shah",
      teamName: "Security Operations",
    });

    expect(guidance.stage).toBe("theirs");
    expect(guidance.message).not.toContain("Security Operations");
  });
});

describe("a case somebody else has", () => {
  test("names them, and offers taking it over", () => {
    const guidance: CaseGuidance = getCaseGuidance({
      ...OPEN,
      hasAssignee: true,
      assigneeName: "Priya Shah",
    });

    expect(guidance.stage).toBe("theirs");
    expect(guidance.tone).toBe("info");
    expect(guidance.title).toBe("Priya Shah has this case");
    expect(guidance.message).toBe(
      "Assign it to yourself if you are taking it over.",
    );
  });

  test("a person the reader cannot see by name is still somebody", () => {
    expect(
      getCaseGuidance({ ...OPEN, hasAssignee: true, assigneeName: "" }).title,
    ).toBe("Someone has this case");
  });
});

describe("my case", () => {
  test("says to move it along and close it with a verdict", () => {
    const guidance: CaseGuidance = getCaseGuidance({
      ...OPEN,
      isMine: true,
      hasAssignee: true,
      assigneeName: "Alex Morgan",
    });

    expect(guidance.stage).toBe("mine");
    expect(guidance.title).toBe("You have this case");
    expect(guidance.message).toBe(
      "Change its status as you work it, and close it with a verdict when it is done.",
    );
  });

  test("once contained, says what is left: the cleanup, then the verdict", () => {
    expect(
      getCaseGuidance({
        ...OPEN,
        isMine: true,
        hasAssignee: true,
        isContained: true,
      }).message,
    ).toBe(
      "The threat is contained. Close the case with a verdict once the cleanup is done.",
    );
  });
});

describe("a closed case", () => {
  test("says how it closed, and that it can be reopened", () => {
    const guidance: CaseGuidance = getCaseGuidance({
      ...OPEN,
      isClosed: true,
      isMine: true,
      verdict: "False Positive",
    });

    expect(guidance).toEqual({
      stage: "closed",
      tone: "success",
      icon: "checkmark-circle-outline",
      title: "Case closed",
      message: "Closed as False Positive. Reopen it if it needs more work.",
    });
  });

  test("without a verdict, says only that it can be reopened", () => {
    expect(getCaseGuidance({ ...OPEN, isClosed: true }).message).toBe(
      "Reopen it if it needs more work.",
    );
  });

  test("closed wins over who has it", () => {
    expect(
      getCaseGuidance({
        ...OPEN,
        isClosed: true,
        hasAssignee: true,
        assigneeName: "Priya Shah",
      }).stage,
    ).toBe("closed");
  });
});

test("no title repeats a status name a project might use", () => {
  const titles: Array<string> = [
    getCaseGuidance(OPEN).title,
    getCaseGuidance({ ...OPEN, hasAssignee: true, assigneeName: "X" }).title,
    getCaseGuidance({ ...OPEN, isMine: true }).title,
  ];

  for (const title of titles) {
    for (const status of ["New", "Investigating", "Contained"]) {
      expect(title.includes(status)).toBe(false);
    }
  }
});
