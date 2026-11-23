import {
  SecurityCaseAiHoldAction,
  buildAiHoldAlertMarkdown,
  buildAiHoldResolvedLines,
  buildAiHoldResolvedMarkdown,
  describeAiHoldAsked,
  describeAiHoldBlock,
  describeAiHoldDone,
  describeAiHoldDoneLine,
  describeAiHoldDuration,
  describeAiHoldEnd,
  describeBlockLength,
  getHeldMinutes,
  joinWithAnd,
} from "../../../../Server/Utils/SecurityCase/SecurityCaseAiHoldWords";
import { NO_BREAK_SPACE } from "../../../../Types/NoBreakSpaces";
import {
  SecurityCaseAiActionKind,
  SecurityCaseAiActionStatus,
  SecurityCaseHandOffReason,
} from "../../../../Types/SecurityCase/SecurityCaseAi";
import { SecurityCaseAiHoldOutcome } from "../../../../Types/SecurityCase/SecurityCaseAiHold";
import SecurityCaseAiVerdict from "../../../../Types/SecurityCase/SecurityCaseAiVerdict";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT PEOPLE AND CHANNELS ARE TOLD WHEN ONEUPTIME AI'S HOLD OF A CASE ENDS
 * (#10353), on the issue's own examples: one summary for a case it
 * contained - "OneUptime AI contained a scanner from 35.205.11.131 in 1m
 * 52s. Blocked at Cloudflare for 1 hour. Nothing reached the app." - and,
 * when it needs people, why and what it already did: "OneUptime AI blocked
 * the address and is waiting for approval to suspend k.morgan in Okta."
 */

const AI: string = "OneUptime AI";
const NB: string = NO_BREAK_SPACE;

const OPENED: Date = new Date("2026-11-23T03:00:00.000Z");

function at(seconds: number): Date {
  return new Date(OPENED.getTime() + seconds * 1000);
}

const BLOCKED: SecurityCaseAiHoldAction = {
  kind: SecurityCaseAiActionKind.BlockAddress,
  status: SecurityCaseAiActionStatus.Done,
  target: "35.205.11.131",
};

const TOOK: SecurityCaseAiHoldAction = {
  kind: SecurityCaseAiActionKind.TakeCase,
  status: SecurityCaseAiActionStatus.Done,
};

const ASKS_TO_CONTAIN: SecurityCaseAiHoldAction = {
  kind: SecurityCaseAiActionKind.ContainAccount,
  status: SecurityCaseAiActionStatus.Asked,
  target: "k.morgan",
};

describe("how long it took, and how long a block lasts", () => {
  test("a duration as the summary says it: 52s, 1m 52s, 2h 5m", () => {
    expect(describeAiHoldDuration(52 * 1000)).toBe("52s");
    expect(describeAiHoldDuration(112 * 1000)).toBe(`1m${NB}52s`);
    expect(describeAiHoldDuration(120 * 1000)).toBe("2m");
    expect(describeAiHoldDuration(125 * 60 * 1000)).toBe(`2h${NB}5m`);
    expect(describeAiHoldDuration(-5)).toBe("0s");
  });

  test("a block's length, its figure held to its word", () => {
    expect(describeBlockLength(60 * 60 * 1000)).toBe(`1${NB}hour`);
    expect(describeBlockLength(24 * 60 * 60 * 1000)).toBe(`24${NB}hours`);
    expect(describeBlockLength(30 * 60 * 1000)).toBe(`30${NB}minutes`);
    expect(describeBlockLength(7 * 24 * 60 * 60 * 1000)).toBe(`7${NB}days`);
  });

  test("joined as English joins a list", () => {
    expect(joinWithAnd([])).toBe("");
    expect(joinWithAnd(["Cloudflare"])).toBe("Cloudflare");
    expect(joinWithAnd(["Cloudflare", "AWS WAF"])).toBe("Cloudflare and AWS WAF");
    expect(joinWithAnd(["a", "b", "c"])).toBe("a, b and c");
  });

  test("how long a case was held, in whole minutes", () => {
    expect(getHeldMinutes({ openedAt: OPENED, endedAt: at(600) })).toBe(10);
    expect(getHeldMinutes({ openedAt: OPENED, endedAt: at(5) })).toBe(1);
    expect(getHeldMinutes({ openedAt: undefined, endedAt: at(5) })).toBe(
      undefined,
    );
  });
});

describe("a block the case made", () => {
  test("where it is enforced and for how long", () => {
    expect(
      describeAiHoldBlock({
        block: {
          value: "35.205.11.131",
          createdAt: OPENED,
          expiresAt: at(60 * 60),
        },
        destinations: ["Cloudflare"],
      }),
    ).toBe(`Blocked 35.205.11.131 at Cloudflare for 1${NB}hour.`);
  });

  test("a block with no end, and one nothing enforces yet", () => {
    expect(
      describeAiHoldBlock({
        block: { value: "35.205.11.131", createdAt: OPENED, expiresAt: null },
        destinations: [],
      }),
    ).toBe("Blocked 35.205.11.131 until someone lifts it.");
  });
});

describe("the summary a resolved case's channels get instead of an alert", () => {
  test("OneUptime AI contained the case: how fast, what it blocked, and that nothing got through", () => {
    const lines: { headline: string; facts: Array<string> } =
      buildAiHoldResolvedLines({
        aiName: AI,
        caseNumber: "SEC-12",
        isWorkedByAi: true,
        isClosed: false,
        tookMs: 112 * 1000,
        blocks: [
          {
            value: "35.205.11.131",
            createdAt: OPENED,
            expiresAt: at(60 * 60),
          },
        ],
        destinations: ["Cloudflare"],
        actions: [TOOK, BLOCKED],
        isNothingThrough: true,
      });

    expect(lines.headline).toBe(
      `OneUptime AI contained SEC-12 in 1m${NB}52s, so nobody was alerted.`,
    );
    expect(lines.facts).toEqual([
      `Blocked 35.205.11.131 at Cloudflare for 1${NB}hour.`,
      "Nothing reached the app: OneUptime saw every request turned away.",
    ]);

    const markdown: string = buildAiHoldResolvedMarkdown(lines).toString();

    expect(markdown).toContain(
      `✅ **OneUptime AI contained SEC-12 in 1m${NB}52s, so nobody was alerted.**`,
    );
    expect(markdown).toContain("- Nothing reached the app");
  });

  test("an account and a host OneUptime AI contained are said too", () => {
    expect(
      buildAiHoldResolvedLines({
        aiName: AI,
        caseNumber: "SEC-13",
        isWorkedByAi: true,
        isClosed: false,
        tookMs: 90 * 1000,
        blocks: [],
        destinations: [],
        actions: [
          {
            kind: SecurityCaseAiActionKind.ContainAccount,
            status: SecurityCaseAiActionStatus.Done,
            target: "k.morgan",
          },
          {
            kind: SecurityCaseAiActionKind.ContainHost,
            status: SecurityCaseAiActionStatus.Done,
            target: "web-1",
          },
          // Asked and left are no fact of what was done.
          ASKS_TO_CONTAIN,
        ],
        isNothingThrough: false,
      }).facts,
    ).toEqual([
      "Contained the account k.morgan.",
      "Contained the host web-1.",
    ]);
  });

  test("a case closed, and one contained without OneUptime AI working it, say so", () => {
    expect(
      buildAiHoldResolvedLines({
        aiName: AI,
        caseNumber: "SEC-14",
        isWorkedByAi: true,
        isClosed: true,
        tookMs: 130 * 1000,
        blocks: [],
        destinations: [],
        actions: [],
        isNothingThrough: false,
      }).headline,
    ).toBe(`OneUptime AI closed SEC-14 in 2m${NB}10s, so nobody was alerted.`);
    expect(
      buildAiHoldResolvedLines({
        aiName: AI,
        caseNumber: "SEC-15",
        isWorkedByAi: false,
        isClosed: false,
        tookMs: null,
        blocks: [],
        destinations: [],
        actions: [],
        isNothingThrough: false,
      }).headline,
    ).toBe("SEC-15 was contained, before anyone had to be alerted.");
  });

  test("a summary with nothing to list is its headline", () => {
    expect(
      buildAiHoldResolvedMarkdown({ headline: "SEC-16 was closed.", facts: [] })
        .toString()
        .includes("\n"),
    ).toBe(false);
  });

  test("a value the attacker wrote is placed as text, never as Markdown", () => {
    const markdown: string = buildAiHoldResolvedMarkdown(
      buildAiHoldResolvedLines({
        aiName: AI,
        caseNumber: "SEC-17",
        isWorkedByAi: true,
        isClosed: false,
        tookMs: 1000,
        blocks: [],
        destinations: [],
        actions: [
          {
            kind: SecurityCaseAiActionKind.ContainAccount,
            status: SecurityCaseAiActionStatus.Done,
            target: "**[click](https://evil.example)**",
          },
        ],
        isNothingThrough: false,
      }),
    ).toString();

    expect(markdown).not.toContain("[click](https://evil.example)");
  });
});

describe("why people are alerted now", () => {
  test("OneUptime AI asked a person to approve a step: which, and what it already did", () => {
    const actions: Array<SecurityCaseAiHoldAction> = [
      TOOK,
      BLOCKED,
      ASKS_TO_CONTAIN,
    ];
    const reason: string = describeAiHoldEnd({
      outcome: SecurityCaseAiHoldOutcome.NeedsApproval,
      aiName: AI,
      asked: describeAiHoldAsked(actions),
    });

    expect(reason).toBe(
      "OneUptime AI responded first and is waiting for approval to contain the account k.morgan.",
    );
    expect(describeAiHoldDone(actions)).toEqual([
      "Took the case",
      "Blocked 35.205.11.131 for 24 hours",
    ]);
    expect(describeAiHoldDoneLine(describeAiHoldDone(actions))).toBe(
      "Took the case. Blocked 35.205.11.131 for 24 hours.",
    );
  });

  test("several steps asked are one phrase; none named still says it waits", () => {
    expect(
      describeAiHoldAsked([
        {
          kind: SecurityCaseAiActionKind.BlockAddress,
          status: SecurityCaseAiActionStatus.Asked,
          target: "35.205.11.131",
        },
        ASKS_TO_CONTAIN,
      ]),
    ).toBe(
      "block 35.205.11.131 for 24 hours and contain the account k.morgan",
    );
    expect(
      describeAiHoldEnd({
        outcome: SecurityCaseAiHoldOutcome.NeedsApproval,
        aiName: AI,
        asked: "",
      }),
    ).toBe(
      "OneUptime AI responded first and is waiting for a person to approve a step.",
    );
  });

  test("a hand-off says OneUptime AI's own reason", () => {
    expect(
      describeAiHoldEnd({
        outcome: SecurityCaseAiHoldOutcome.HandedOff,
        aiName: AI,
        handOffReason: SecurityCaseHandOffReason.CannotTell,
      }),
    ).toBe(
      "OneUptime AI responded first, then handed the case to people. OneUptime AI could not tell what to do next.",
    );
  });

  test("the hold time ran out", () => {
    expect(
      describeAiHoldEnd({
        outcome: SecurityCaseAiHoldOutcome.TimeRanOut,
        aiName: AI,
        heldMinutes: 10,
      }),
    ).toBe(
      `OneUptime AI responded first but did not finish within 10${NB}minutes.`,
    );
  });

  test("the triage's read, by its verdict", () => {
    expect(
      describeAiHoldEnd({
        outcome: SecurityCaseAiHoldOutcome.NotMalicious,
        aiName: AI,
        aiVerdict: SecurityCaseAiVerdict.LikelyFalsePositive,
      }),
    ).toBe(
      "OneUptime AI's triage read the case as Likely False Positive, and it works only cases it reads as Likely Malicious on its own, so a person decides.",
    );
    expect(
      describeAiHoldEnd({
        outcome: SecurityCaseAiHoldOutcome.NotMalicious,
        aiName: AI,
        aiVerdict: SecurityCaseAiVerdict.Inconclusive,
      }),
    ).toBe(
      "OneUptime AI's triage could not tell whether the case is real, so a person decides.",
    );
  });

  test("Page now, a rise and a person taking the case name who and what", () => {
    expect(
      describeAiHoldEnd({
        outcome: SecurityCaseAiHoldOutcome.PageNow,
        aiName: AI,
        personName: "Ana Lee",
      }),
    ).toBe("Ana Lee pressed Page now.");
    expect(
      describeAiHoldEnd({
        outcome: SecurityCaseAiHoldOutcome.PageNow,
        aiName: AI,
      }),
    ).toBe("Someone pressed Page now.");
    expect(
      describeAiHoldEnd({
        outcome: SecurityCaseAiHoldOutcome.RoseInPriority,
        aiName: AI,
        priorityName: "High",
      }),
    ).toBe("The case rose to High, which alerts people at once.");
    expect(
      describeAiHoldEnd({
        outcome: SecurityCaseAiHoldOutcome.TakenByPerson,
        aiName: AI,
        personName: "Ana Lee",
      }),
    ).toBe(
      "Ana Lee took the case while OneUptime AI was on it, so nobody else was alerted.",
    );
  });

  test("an active attack, and the setting turned off", () => {
    expect(
      describeAiHoldEnd({
        outcome: SecurityCaseAiHoldOutcome.ActiveAttack,
        aiName: AI,
      }),
    ).toBe(
      `Several security cases opened within 5${NB}minutes, which looks like an active attack.`,
    );
    expect(
      describeAiHoldEnd({
        outcome: SecurityCaseAiHoldOutcome.TurnedOff,
        aiName: AI,
      }),
    ).toBe("Letting OneUptime AI respond first was turned off.");
  });

  test("every outcome has its words", () => {
    for (const outcome of Object.values(SecurityCaseAiHoldOutcome)) {
      expect(
        describeAiHoldEnd({ outcome, aiName: AI }).length,
      ).toBeGreaterThan(0);
    }
  });

  test("the alert's post opens with the new case, why, and what was already done", () => {
    const markdown: string = buildAiHoldAlertMarkdown({
      priorityName: "Medium",
      reason:
        "OneUptime AI responded first and is waiting for approval to contain the account k.morgan.",
      done: ["Took the case", "Blocked 35.205.11.131 for 24 hours"],
    }).toString();

    expect(markdown).toContain(
      "🛡️ **New Medium security case.** OneUptime AI responded first and is waiting for approval to contain the account k.morgan.",
    );
    expect(markdown).toContain(
      "Already done: Took the case. Blocked 35.205.11.131 for 24 hours.",
    );
  });
});
