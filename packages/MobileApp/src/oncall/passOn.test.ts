import { describe, expect, test } from "@jest/globals";
import { PASS_ON_TEXT, getPassOnAnswer, getPassOnQuestion } from "./passOn";

/*
 * What "Pass it on" says on a phone: the question before anything changes,
 * and the answer after. The sentences about what it does come from the
 * server, worded as in the email and the call that paged the person; these
 * put them together with the one line every place says beside them.
 */

const NEXT_RULE: string =
  "Escalation rule 2 of 3 (Level 2) is paged right away, without waiting.";

describe("the question", () => {
  test("says the person is not paged again, then what passing on will do", () => {
    expect(
      getPassOnQuestion([
        {
          executionLogId: "run-1",
          policyName: "Payments",
          sentence: NEXT_RULE,
        },
      ]),
    ).toEqual({
      title: "Pass it on?",
      message: `You won't be paged about it again.\n\n${NEXT_RULE}`,
    });
  });

  test("two policies paging about the same record: each line names its policy", () => {
    expect(
      getPassOnQuestion([
        {
          executionLogId: "run-1",
          policyName: "Payments",
          sentence: NEXT_RULE,
        },
        {
          executionLogId: "run-2",
          policyName: "Database",
          sentence: "Bob Smith is still being paged.",
        },
      ]).message,
    ).toBe(
      [
        "You won't be paged about it again.",
        `Payments: ${NEXT_RULE}`,
        "Database: Bob Smith is still being paged.",
      ].join("\n\n"),
    );
  });

  test("a page the server said nothing about still asks", () => {
    expect(
      getPassOnQuestion([
        { executionLogId: "run-1", policyName: "Payments", sentence: "" },
      ]).message,
    ).toBe("You won't be paged about it again.");
  });
});

describe("the answer", () => {
  test("passed on: what it did, and that they are not paged again", () => {
    expect(
      getPassOnAnswer([
        {
          passedOn: true,
          policyName: "Payments",
          sentence: "Escalation rule 2 of 3 (Level 2) is paging Sam Lee now.",
        },
      ]),
    ).toEqual({
      title: "You passed it on",
      message:
        "Escalation rule 2 of 3 (Level 2) is paging Sam Lee now.\n\nYou won't be paged about it again.",
      passedOn: true,
    });
  });

  test("not passed on: why, and no promise it will not page them", () => {
    const answer: ReturnType<typeof getPassOnAnswer> = getPassOnAnswer([
      {
        passedOn: false,
        policyName: "",
        sentence:
          "It was already acknowledged by Ana Lopez, so there is nothing to pass on.",
      },
    ]);

    expect(answer).toEqual({
      title: "Nothing to pass on",
      message:
        "It was already acknowledged by Ana Lopez, so there is nothing to pass on.",
      passedOn: false,
    });
    expect(answer.message).not.toContain(PASS_ON_TEXT.notPagedAgain);
  });

  test("an empty answer says they are not being paged", () => {
    expect(getPassOnAnswer([])).toEqual({
      title: "Nothing to pass on",
      message: "You are not being paged about this right now.",
      passedOn: false,
    });
  });

  test("the words are the ones every other place uses", () => {
    expect(PASS_ON_TEXT.button).toBe("Pass it on");
    expect(PASS_ON_TEXT.notPagedAgain).toBe(
      "You won't be paged about it again.",
    );
    // The status the server gives a page passed on.
    expect(PASS_ON_TEXT.passedOnStatus).toBe("Passed On");
  });
});
