import { describe, expect, test } from "@jest/globals";
import type { OnCallPageRecordType } from "../api/onCallPassOn";
import {
  PASS_ON_RECORD_TEXT,
  PASS_ON_TEXT,
  getPassOnAnswer,
  getPassOnQuestion,
  getPassOnRecordText,
} from "./passOn";

/*
 * What "Escalate" says on a phone: the question before anything changes,
 * and the answer after - in the words of the Dashboard's dialog, which
 * are the maintainer's:
 *
 *   Escalate Incident?
 *   This will immediately page Platform leads (Level 2 of 3), without
 *     waiting.
 *   You will not be paged again for this incident.
 *
 * The sentences about what it does come from the server, worded as in the
 * email and the call that paged the person; these put them together with
 * the one line every place says beside them. The action was called "Pass
 * it on" before.
 */

const NEXT_LEVEL: string =
  "This will immediately page Platform leads (Level 2 of 3), without waiting.";

const RECORDS: Array<
  [OnCallPageRecordType, string, string, string]
> = [
  [
    "incident",
    "Escalate Incident?",
    "Incident escalated",
    "You will not be paged again for this incident.",
  ],
  [
    "alert",
    "Escalate Alert?",
    "Alert escalated",
    "You will not be paged again for this alert.",
  ],
  [
    "incident-episode",
    "Escalate Episode?",
    "Episode escalated",
    "You will not be paged again for this episode.",
  ],
  [
    "alert-episode",
    "Escalate Episode?",
    "Episode escalated",
    "You will not be paged again for this episode.",
  ],
];

describe("the question", () => {
  test.each(RECORDS)(
    "a %s: Escalate it?, what escalating will do, then that the person is not paged again",
    (
      recordType: OnCallPageRecordType,
      question: string,
      _doneTitle: string,
      notPagedAgain: string,
    ) => {
      expect(
        getPassOnQuestion(
          [
            {
              executionLogId: "run-1",
              policyName: "Payments",
              sentence: NEXT_LEVEL,
            },
          ],
          recordType,
        ),
      ).toEqual({
        title: question,
        message: `${NEXT_LEVEL}\n\n${notPagedAgain}`,
      });
    },
  );

  test("two policies paging about the same record: each line names its policy", () => {
    expect(
      getPassOnQuestion(
        [
          {
            executionLogId: "run-1",
            policyName: "Payments",
            sentence: NEXT_LEVEL,
          },
          {
            executionLogId: "run-2",
            policyName: "Database",
            sentence: "Bob Smith is still being paged.",
          },
        ],
        "incident",
      ).message,
    ).toBe(
      [
        `Payments: ${NEXT_LEVEL}`,
        "Database: Bob Smith is still being paged.",
        "You will not be paged again for this incident.",
      ].join("\n\n"),
    );
  });

  test("a page the server said nothing about still asks", () => {
    expect(
      getPassOnQuestion(
        [{ executionLogId: "run-1", policyName: "Payments", sentence: "" }],
        "alert",
      ).message,
    ).toBe("You will not be paged again for this alert.");
  });
});

describe("the answer", () => {
  test.each(RECORDS)(
    "a %s escalated: what it did, and that the person is not paged again",
    (
      recordType: OnCallPageRecordType,
      _question: string,
      doneTitle: string,
      notPagedAgain: string,
    ) => {
      expect(
        getPassOnAnswer(
          [
            {
              passedOn: true,
              policyName: "Payments",
              sentence:
                "The policy is now paging Platform leads (Level 2 of 3): Sam Lee.",
            },
          ],
          recordType,
        ),
      ).toEqual({
        title: doneTitle,
        message: `The policy is now paging Platform leads (Level 2 of 3): Sam Lee.\n\n${notPagedAgain}`,
        passedOn: true,
      });
    },
  );

  test("not escalated: why, and no promise it will not page them", () => {
    const answer: ReturnType<typeof getPassOnAnswer> = getPassOnAnswer(
      [
        {
          passedOn: false,
          policyName: "",
          sentence:
            "It was already acknowledged by Ana Lopez, so there is nothing to escalate.",
        },
      ],
      "incident",
    );

    expect(answer).toEqual({
      title: "Nothing to escalate",
      message:
        "It was already acknowledged by Ana Lopez, so there is nothing to escalate.",
      passedOn: false,
    });
    expect(answer.message).not.toContain("You will not be paged again");
  });

  test("an empty answer says they are not being paged", () => {
    expect(getPassOnAnswer([], "incident")).toEqual({
      title: "Nothing to escalate",
      message: "You are not being paged about this right now.",
      passedOn: false,
    });
  });
});

describe("the words", () => {
  test("are the ones every other place uses", () => {
    expect(PASS_ON_TEXT.button).toBe("Escalate");
    expect(PASS_ON_TEXT.notDoneTitle).toBe("Nothing to escalate");
    expect(PASS_ON_TEXT.failed).toBe("Could not escalate. Please try again.");
    // The status the server stores for an escalated page, and how it reads.
    expect(PASS_ON_TEXT.passedOnStatus).toBe("Passed On");
    expect(PASS_ON_TEXT.passedOnLabel).toBe("Escalated");
  });

  test("each record kind has its own, and an unknown one reads as an incident", () => {
    for (const [recordType, question, doneTitle, notPagedAgain] of RECORDS) {
      expect(PASS_ON_RECORD_TEXT[recordType]).toEqual({
        question,
        doneTitle,
        notPagedAgain,
      });
    }

    expect(
      getPassOnRecordText("unknown" as unknown as OnCallPageRecordType),
    ).toEqual(PASS_ON_RECORD_TEXT.incident);
  });

  test("never the old words", () => {
    const words: string[] = [
      PASS_ON_TEXT.button,
      PASS_ON_TEXT.notDoneTitle,
      PASS_ON_TEXT.failed,
      PASS_ON_TEXT.passedOnLabel,
      ...Object.values(PASS_ON_RECORD_TEXT).flatMap(
        (text: { question: string; doneTitle: string; notPagedAgain: string }) => {
          return [text.question, text.doneTitle, text.notPagedAgain];
        },
      ),
    ];

    for (const word of words) {
      expect(word.toLowerCase()).not.toContain("pass");
    }
  });
});
