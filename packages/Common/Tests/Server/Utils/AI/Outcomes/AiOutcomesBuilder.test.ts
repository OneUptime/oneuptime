import AiOutcomesBuilder, {
  AiOutcomesInput,
  AiOutcomesInvestigationRow,
  AiOutcomesJudgement,
  AiOutcomesPageRow,
  AiOutcomesPullRequestRow,
  AiOutcomesRemediationRow,
} from "../../../../../Server/Utils/AI/Outcomes/AiOutcomesBuilder";
import AIRunAutoGrade from "../../../../../Types/AI/AIRunAutoGrade";
import AIRunHumanVerdict from "../../../../../Types/AI/AIRunHumanVerdict";
import {
  AI_OUTCOMES_WEEK_COUNT,
  AiOutcomes,
  AiOutcomesPages,
  AiOutcomesPullRequestFixes,
  AiOutcomesRemediationFixes,
  AiOutcomesWeek,
  getCheckedFixCount,
  getHeldPageCount,
  getJudgedRootCauseCount,
  getVerifiedFixCount,
} from "../../../../../Types/AI/AiOutcomes";
import FixProductionStatus from "../../../../../Types/AI/FixProductionStatus";
import AutoRemediationVerificationStatus from "../../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import { OnCallPolicyAiHoldOutcome } from "../../../../../Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import { SeededRandom, seededRandom } from "../../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * AiOutcomesBuilder (issue #6800): the AI Results page's numbers from the
 * rows AiOutcomesReader read - pure, so every rule is held here with plain
 * rows. The window is twelve whole weeks of UTC days ending with today;
 * every row counts in the week its work started; a page still held counts
 * only as held; a person's verdict beats the automatic grade; a value this
 * server does not know is not counted at all; a part the caller may not
 * read stays null, never zeros.
 */

const DAY: number = 24 * 60 * 60 * 1000;
const WEEK: number = 7 * DAY;

// A Friday afternoon, UTC.
const NOW: Date = new Date("2026-11-13T15:00:00.000Z");

/*
 * Today (13 Nov) is the last of the window's 84 days, so the window opens on
 * 22 Aug, a Saturday, and its weeks start on Saturdays.
 */
const WINDOW_START: Date = new Date("2026-08-22T00:00:00.000Z");
const WINDOW_END: Date = new Date("2026-11-14T00:00:00.000Z");

const WEEK_STARTS: Array<string> = [
  "2026-08-22",
  "2026-08-29",
  "2026-09-05",
  "2026-09-12",
  "2026-09-19",
  "2026-09-26",
  "2026-10-03",
  "2026-10-10",
  "2026-10-17",
  "2026-10-24",
  "2026-10-31",
  "2026-11-07",
];

type WeekCount = keyof Omit<AiOutcomesWeek, "weekStart">;

const WEEK_COUNTS: Array<WeekCount> = [
  "pagesAvoided",
  "pagesHeld",
  "fixesVerified",
  "fixesChecked",
  "rootCausesConfirmed",
  "rootCausesJudged",
];

// A moment inside week `index` of the window (half a day in, by default).
function inWeek(index: number, offset: number = DAY / 2): Date {
  return new Date(WINDOW_START.getTime() + index * WEEK + offset);
}

function build(overrides: Partial<AiOutcomesInput> = {}): AiOutcomes {
  return AiOutcomesBuilder.build({
    now: NOW,
    pageRows: null,
    remediationRows: null,
    pullRequestRows: null,
    investigationRows: null,
    isPartial: false,
    ...overrides,
  });
}

// One count of every week, oldest first.
function weekly(outcomes: AiOutcomes, count: WeekCount): Array<number> {
  return outcomes.weeks.map((week: AiOutcomesWeek): number => {
    return week[count];
  });
}

function sumOfWeeks(outcomes: AiOutcomes, count: WeekCount): number {
  return weekly(outcomes, count).reduce((sum: number, value: number) => {
    return sum + value;
  }, 0);
}

// Twelve zeros with `value` at week `index`.
function onlyInWeek(index: number, value: number = 1): Array<number> {
  return WEEK_STARTS.map((_weekStart: string, at: number): number => {
    return at === index ? value : 0;
  });
}

const NO_WEEKS: Array<number> = onlyInWeek(-1);

const ZERO_PAGES: AiOutcomesPages = {
  resolvedByAi: 0,
  recoveredOnItsOwn: 0,
  handledByPerson: 0,
  handedOff: 0,
  holdTimeRanOut: 0,
  pageNowPressed: 0,
  holding: 0,
};

const ZERO_REMEDIATION_FIXES: AiOutcomesRemediationFixes = {
  verified: 0,
  failed: 0,
  pending: 0,
  skipped: 0,
};

const ZERO_PULL_REQUEST_FIXES: AiOutcomesPullRequestFixes = {
  verified: 0,
  regressed: 0,
  watching: 0,
  awaitingDeploy: 0,
  unverifiable: 0,
};

function page(
  outcome: AiOutcomesPageRow["outcome"],
  createdAt: Date = inWeek(4),
): AiOutcomesPageRow {
  return { createdAt, outcome };
}

function remediation(
  verificationStatus: AiOutcomesRemediationRow["verificationStatus"],
  createdAt: Date = inWeek(4),
): AiOutcomesRemediationRow {
  return { createdAt, verificationStatus };
}

function pullRequest(
  productionStatus: AiOutcomesPullRequestRow["productionStatus"],
  createdAt: Date = inWeek(4),
): AiOutcomesPullRequestRow {
  return { createdAt, productionStatus };
}

function investigation(
  judged: Partial<AiOutcomesInvestigationRow>,
  createdAt: Date = inWeek(4),
): AiOutcomesInvestigationRow {
  return { createdAt, ...judged };
}

describe("the window: twelve whole weeks of UTC days, the last ending with today", () => {
  test("opens at UTC midnight 83 days before today, so today is its 84th day", () => {
    expect(AiOutcomesBuilder.getWindowStart(NOW).toISOString()).toBe(
      WINDOW_START.toISOString(),
    );
    expect(AI_OUTCOMES_WEEK_COUNT).toBe(12);
  });

  test.each([
    // Today's first and last moments open the same window.
    ["2026-11-13T00:00:00.000Z", "2026-08-22T00:00:00.000Z"],
    ["2026-11-13T23:59:59.999Z", "2026-08-22T00:00:00.000Z"],
    // UTC midnight moves it on by a day.
    ["2026-11-14T00:00:00.000Z", "2026-08-23T00:00:00.000Z"],
    // Across a new year.
    ["2027-01-02T08:00:00.000Z", "2026-10-11T00:00:00.000Z"],
    // Across a leap February.
    ["2028-03-01T12:00:00.000Z", "2027-12-09T00:00:00.000Z"],
    // The night Europe's clocks go forward, and the one America's go back.
    ["2026-03-29T01:30:00.000Z", "2026-01-05T00:00:00.000Z"],
    ["2026-11-01T06:30:00.000Z", "2026-08-10T00:00:00.000Z"],
  ])("at %s it opens at %s", (now: string, expectedStart: string) => {
    expect(AiOutcomesBuilder.getWindowStart(new Date(now)).toISOString()).toBe(
      expectedStart,
    );
  });

  test.each([
    "2026-03-08T07:00:00.000Z",
    "2026-03-29T00:59:59.000Z",
    "2026-10-25T01:00:00.000Z",
    "2026-11-01T06:00:00.000Z",
    "2026-11-13T15:00:00.000Z",
    "2027-04-05T13:45:00.000Z",
  ])(
    "at %s it is exactly 84 days of 24 hours, up to the start of tomorrow (UTC): no clock change moves it",
    (nowText: string) => {
      const now: Date = new Date(nowText);
      const start: Date = AiOutcomesBuilder.getWindowStart(now);
      const startOfTomorrow: number =
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) +
        DAY;

      expect(startOfTomorrow - start.getTime()).toBe(84 * DAY);
      expect([
        start.getUTCHours(),
        start.getUTCMinutes(),
        start.getUTCSeconds(),
        start.getUTCMilliseconds(),
      ]).toEqual([0, 0, 0, 0]);
      // Twelve whole weeks: the window's weeks start on tomorrow's weekday.
      expect(start.getUTCDay()).toBe(new Date(startOfTomorrow).getUTCDay());
      // Now is inside it, in its last week.
      expect(AiOutcomesBuilder.getWeekIndex(start, now)).toBe(11);
    },
  );
});

describe("which week a moment falls in", () => {
  test.each([
    ["the window's first moment", WINDOW_START.getTime(), 0],
    ["a moment before the second week", WINDOW_START.getTime() + WEEK - 1, 0],
    ["the second week's first moment", WINDOW_START.getTime() + WEEK, 1],
    ["the middle of week 6", WINDOW_START.getTime() + 6 * WEEK + 3 * DAY, 6],
    ["the last week's first moment", WINDOW_START.getTime() + 11 * WEEK, 11],
    ["now", NOW.getTime(), 11],
    ["the last moment of today", WINDOW_END.getTime() - 1, 11],
  ])("%s is in week %#", (_name: string, time: number, index: number) => {
    expect(AiOutcomesBuilder.getWeekIndex(WINDOW_START, new Date(time))).toBe(
      index,
    );
  });

  test.each([
    ["a moment before the window", WINDOW_START.getTime() - 1],
    ["a week before the window", WINDOW_START.getTime() - WEEK],
    ["the start of tomorrow", WINDOW_END.getTime()],
    ["a year on", WINDOW_END.getTime() + 365 * DAY],
    ["a date that is not one", NaN],
  ])("%s is in none", (_name: string, time: number) => {
    expect(
      AiOutcomesBuilder.getWeekIndex(WINDOW_START, new Date(time)),
    ).toBeNull();
  });
});

describe("judge: a person's verdict, else the automatic grade", () => {
  const VERDICTS: Array<[string, string | undefined]> = [
    ["confirmed", AIRunHumanVerdict.Confirmed],
    ["rejected", AIRunHumanVerdict.Rejected],
    ["no verdict", undefined],
    // A verdict this server does not know is no verdict.
    ["an unknown verdict", "Edited"],
  ];

  const GRADES: Array<[string, string | undefined]> = [
    ["Match", AIRunAutoGrade.Match],
    ["Partial", AIRunAutoGrade.Partial],
    ["Mismatch", AIRunAutoGrade.Mismatch],
    ["no grade", undefined],
    ["an unknown grade", "Unsure"],
  ];

  function expected(
    verdict: string | undefined,
    grade: string | undefined,
  ): AiOutcomesJudgement | null {
    if (verdict === AIRunHumanVerdict.Confirmed) {
      return AiOutcomesJudgement.Confirmed;
    }

    if (verdict === AIRunHumanVerdict.Rejected) {
      return AiOutcomesJudgement.Wrong;
    }

    const byGrade: Record<string, AiOutcomesJudgement> = {
      [AIRunAutoGrade.Match]: AiOutcomesJudgement.Confirmed,
      [AIRunAutoGrade.Partial]: AiOutcomesJudgement.Partial,
      [AIRunAutoGrade.Mismatch]: AiOutcomesJudgement.Wrong,
    };

    return grade !== undefined && byGrade[grade] ? byGrade[grade]! : null;
  }

  const CASES: Array<[string, string, string | undefined, string | undefined]> =
    VERDICTS.flatMap(
      ([verdictName, verdict]: [string, string | undefined]): Array<
        [string, string, string | undefined, string | undefined]
      > => {
        return GRADES.map(
          ([gradeName, grade]: [string, string | undefined]): [
            string,
            string,
            string | undefined,
            string | undefined,
          ] => {
            return [verdictName, gradeName, verdict, grade];
          },
        );
      },
    );

  test("every pair of verdict and grade is covered", () => {
    expect(CASES).toHaveLength(20);
  });

  test.each(CASES)(
    "%s, graded %s",
    (
      _verdictName: string,
      _gradeName: string,
      verdict: string | undefined,
      grade: string | undefined,
    ) => {
      expect(
        AiOutcomesBuilder.judge({
          createdAt: NOW,
          humanVerdict: verdict,
          autoGrade: grade,
        }),
      ).toBe(expected(verdict, grade));
    },
  );

  test("the cases that matter, spelled out", () => {
    // A person who confirmed beats a grade that said it missed.
    expect(
      AiOutcomesBuilder.judge({
        createdAt: NOW,
        humanVerdict: AIRunHumanVerdict.Confirmed,
        autoGrade: AIRunAutoGrade.Mismatch,
      }),
    ).toBe(AiOutcomesJudgement.Confirmed);
    // A person who rejected beats a grade that said it matched.
    expect(
      AiOutcomesBuilder.judge({
        createdAt: NOW,
        humanVerdict: AIRunHumanVerdict.Rejected,
        autoGrade: AIRunAutoGrade.Match,
      }),
    ).toBe(AiOutcomesJudgement.Wrong);
    // Neither: not judged.
    expect(AiOutcomesBuilder.judge({ createdAt: NOW })).toBeNull();
  });
});

describe("the twelve weeks", () => {
  test("are its Saturdays, oldest first, every count zero, with nothing to count", () => {
    const outcomes: AiOutcomes = build();

    expect(
      outcomes.weeks.map((week: AiOutcomesWeek): string => {
        return week.weekStart;
      }),
    ).toEqual(WEEK_STARTS);
    for (const count of WEEK_COUNTS) {
      expect({ count, weeks: weekly(outcomes, count) }).toEqual({
        count,
        weeks: NO_WEEKS,
      });
    }
  });

  test("the window is now's: the first week's start to now itself", () => {
    const outcomes: AiOutcomes = build();

    expect(outcomes.windowStart).toBe("2026-08-22T00:00:00.000Z");
    expect(outcomes.windowEnd).toBe(NOW.toISOString());
    expect(outcomes.weeks[0]!.weekStart).toBe(
      outcomes.windowStart.substring(0, 10),
    );
  });

  test("each week is seven days after the one before, across a clock change in Europe and in America", () => {
    const outcomes: AiOutcomes = build();

    for (let index: number = 1; index < outcomes.weeks.length; index++) {
      const previous: number = Date.parse(
        `${outcomes.weeks[index - 1]!.weekStart}T00:00:00.000Z`,
      );
      const current: number = Date.parse(
        `${outcomes.weeks[index]!.weekStart}T00:00:00.000Z`,
      );

      expect(current - previous).toBe(WEEK);
    }
  });
});

describe("a part the caller may not read is null; one with nothing in it is zeros", () => {
  test("every part null: the weeks are still there, all zeros", () => {
    const outcomes: AiOutcomes = build();

    expect(outcomes.pages).toBeNull();
    expect(outcomes.remediationFixes).toBeNull();
    expect(outcomes.pullRequestFixes).toBeNull();
    expect(outcomes.rootCauses).toBeNull();
    expect(outcomes.weeks).toHaveLength(12);
  });

  test("every part empty: zeros, not null", () => {
    const outcomes: AiOutcomes = build({
      pageRows: [],
      remediationRows: [],
      pullRequestRows: [],
      investigationRows: [],
    });

    expect(outcomes.pages).toEqual(ZERO_PAGES);
    expect(outcomes.remediationFixes).toEqual(ZERO_REMEDIATION_FIXES);
    expect(outcomes.pullRequestFixes).toEqual(ZERO_PULL_REQUEST_FIXES);
    expect(outcomes.rootCauses).toEqual({
      confirmed: 0,
      partial: 0,
      wrong: 0,
      judgedByPeople: 0,
      completed: 0,
    });
  });

  test.each([
    ["pageRows", "pages"],
    ["remediationRows", "remediationFixes"],
    ["pullRequestRows", "pullRequestFixes"],
    ["investigationRows", "rootCauses"],
  ] as Array<[keyof AiOutcomesInput, keyof AiOutcomes]>)(
    "%s null leaves %s out and nothing else",
    (rows: keyof AiOutcomesInput, part: keyof AiOutcomes) => {
      const outcomes: AiOutcomes = build({
        pageRows: [page(OnCallPolicyAiHoldOutcome.ResolvedByAI)],
        remediationRows: [
          remediation(AutoRemediationVerificationStatus.Verified),
        ],
        pullRequestRows: [pullRequest(FixProductionStatus.Verified)],
        investigationRows: [investigation({ autoGrade: AIRunAutoGrade.Match })],
        [rows]: null,
      });

      for (const other of [
        "pages",
        "remediationFixes",
        "pullRequestFixes",
        "rootCauses",
      ] as Array<keyof AiOutcomes>) {
        expect({ other, isNull: outcomes[other] === null }).toEqual({
          other,
          isNull: other === part,
        });
      }
    },
  );

  test("a null part adds nothing to the weeks; the parts read still do", () => {
    const outcomes: AiOutcomes = build({
      remediationRows: null,
      pullRequestRows: [pullRequest(FixProductionStatus.Verified)],
    });

    expect(weekly(outcomes, "fixesVerified")).toEqual(onlyInWeek(4));
    expect(weekly(outcomes, "fixesChecked")).toEqual(onlyInWeek(4));
    expect(weekly(outcomes, "pagesHeld")).toEqual(NO_WEEKS);
  });
});

describe("held pages", () => {
  test.each([
    [OnCallPolicyAiHoldOutcome.ResolvedByAI, "resolvedByAi", 1],
    [OnCallPolicyAiHoldOutcome.RecoveredOnItsOwn, "recoveredOnItsOwn", 0],
    [OnCallPolicyAiHoldOutcome.HandledByPerson, "handledByPerson", 0],
    [OnCallPolicyAiHoldOutcome.HandedOff, "handedOff", 0],
    [OnCallPolicyAiHoldOutcome.HoldTimeRanOut, "holdTimeRanOut", 0],
    [OnCallPolicyAiHoldOutcome.PageNowPressed, "pageNowPressed", 0],
  ] as Array<[OnCallPolicyAiHoldOutcome, keyof AiOutcomesPages, number]>)(
    "%s counts as %s, held in its week",
    (
      outcome: OnCallPolicyAiHoldOutcome,
      field: keyof AiOutcomesPages,
      avoided: number,
    ) => {
      const outcomes: AiOutcomes = build({ pageRows: [page(outcome)] });

      expect(outcomes.pages).toEqual({ ...ZERO_PAGES, [field]: 1 });
      expect(getHeldPageCount(outcomes.pages!)).toBe(1);
      expect(weekly(outcomes, "pagesHeld")).toEqual(onlyInWeek(4));
      // Only OneUptime AI's own fix kept a page from anyone.
      expect(weekly(outcomes, "pagesAvoided")).toEqual(onlyInWeek(4, avoided));
    },
  );

  test("a page still held counts as holding only: not held, not avoided", () => {
    const outcomes: AiOutcomes = build({
      pageRows: [
        page(OnCallPolicyAiHoldOutcome.Holding),
        page(OnCallPolicyAiHoldOutcome.Holding, inWeek(11)),
      ],
    });

    expect(outcomes.pages).toEqual({ ...ZERO_PAGES, holding: 2 });
    expect(getHeldPageCount(outcomes.pages!)).toBe(0);
    expect(weekly(outcomes, "pagesHeld")).toEqual(NO_WEEKS);
    expect(weekly(outcomes, "pagesAvoided")).toEqual(NO_WEEKS);
  });

  test("an outcome this server does not know, or none, is not counted at all", () => {
    const outcomes: AiOutcomes = build({
      pageRows: [
        page("Escalated to the moon"),
        page(undefined),
        page("resolved by ai"),
        page(OnCallPolicyAiHoldOutcome.HandedOff),
      ],
    });

    expect(outcomes.pages).toEqual({ ...ZERO_PAGES, handedOff: 1 });
    expect(weekly(outcomes, "pagesHeld")).toEqual(onlyInWeek(4));
  });

  test("a page held before the window, or after it, is not counted - held or holding", () => {
    const outside: Array<Date> = [
      new Date(WINDOW_START.getTime() - 1),
      new Date(WINDOW_START.getTime() - 30 * DAY),
      WINDOW_END,
    ];

    const outcomes: AiOutcomes = build({
      pageRows: outside.flatMap((createdAt: Date): Array<AiOutcomesPageRow> => {
        return [
          page(OnCallPolicyAiHoldOutcome.ResolvedByAI, createdAt),
          page(OnCallPolicyAiHoldOutcome.Holding, createdAt),
        ];
      }),
    });

    expect(outcomes.pages).toEqual(ZERO_PAGES);
    expect(weekly(outcomes, "pagesHeld")).toEqual(NO_WEEKS);
  });

  test("each page counts in the week it was held, at the weeks' very edges too", () => {
    const outcomes: AiOutcomes = build({
      pageRows: [
        page(OnCallPolicyAiHoldOutcome.ResolvedByAI, WINDOW_START),
        page(OnCallPolicyAiHoldOutcome.HandedOff, inWeek(0)),
        page(OnCallPolicyAiHoldOutcome.ResolvedByAI, inWeek(1, -1)),
        page(OnCallPolicyAiHoldOutcome.ResolvedByAI, inWeek(5, 0)),
        page(OnCallPolicyAiHoldOutcome.RecoveredOnItsOwn, inWeek(5)),
        page(OnCallPolicyAiHoldOutcome.ResolvedByAI, NOW),
        page(
          OnCallPolicyAiHoldOutcome.PageNowPressed,
          new Date(WINDOW_END.getTime() - 1),
        ),
      ],
    });

    expect(weekly(outcomes, "pagesHeld")).toEqual([
      3, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 2,
    ]);
    expect(weekly(outcomes, "pagesAvoided")).toEqual([
      2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1,
    ]);
    // The weeks add up to the totals: Resolved by AI is Pages Avoided.
    expect(sumOfWeeks(outcomes, "pagesAvoided")).toBe(
      outcomes.pages!.resolvedByAi,
    );
    expect(sumOfWeeks(outcomes, "pagesHeld")).toBe(
      getHeldPageCount(outcomes.pages!),
    );
  });

  test("a creation time the database hands back as text still lands in its week", () => {
    const outcomes: AiOutcomes = build({
      pageRows: [
        {
          createdAt: inWeek(3).toISOString() as unknown as Date,
          outcome: OnCallPolicyAiHoldOutcome.ResolvedByAI,
        },
      ],
    });

    expect(weekly(outcomes, "pagesAvoided")).toEqual(onlyInWeek(3));
  });
});

describe("fixes AI ran", () => {
  test.each([
    [AutoRemediationVerificationStatus.Verified, "verified", 1, 1],
    [AutoRemediationVerificationStatus.Failed, "failed", 0, 1],
    // Started; nothing to say yet.
    [AutoRemediationVerificationStatus.Pending, "pending", 0, 0],
    // Nothing to check against: never checked.
    [AutoRemediationVerificationStatus.Skipped, "skipped", 0, 0],
  ] as Array<
    [
      AutoRemediationVerificationStatus,
      keyof AiOutcomesRemediationFixes,
      number,
      number,
    ]
  >)(
    "%s counts as %s: %i verified and %i checked in its week",
    (
      status: AutoRemediationVerificationStatus,
      field: keyof AiOutcomesRemediationFixes,
      verified: number,
      checked: number,
    ) => {
      const outcomes: AiOutcomes = build({
        remediationRows: [remediation(status)],
      });

      expect(outcomes.remediationFixes).toEqual({
        ...ZERO_REMEDIATION_FIXES,
        [field]: 1,
      });
      expect(weekly(outcomes, "fixesVerified")).toEqual(
        onlyInWeek(4, verified),
      );
      expect(weekly(outcomes, "fixesChecked")).toEqual(onlyInWeek(4, checked));
    },
  );

  test("a status this server does not know, or none, is not counted", () => {
    const outcomes: AiOutcomes = build({
      remediationRows: [remediation("Verifying"), remediation(undefined)],
    });

    expect(outcomes.remediationFixes).toEqual(ZERO_REMEDIATION_FIXES);
    expect(weekly(outcomes, "fixesChecked")).toEqual(NO_WEEKS);
  });

  test("a fix run before the window is not counted", () => {
    const outcomes: AiOutcomes = build({
      remediationRows: [
        remediation(
          AutoRemediationVerificationStatus.Verified,
          new Date(WINDOW_START.getTime() - 1),
        ),
      ],
    });

    expect(outcomes.remediationFixes).toEqual(ZERO_REMEDIATION_FIXES);
  });
});

describe("fix pull requests", () => {
  test.each([
    [FixProductionStatus.Verified, "verified", 1, 1],
    [FixProductionStatus.Regressed, "regressed", 0, 1],
    [FixProductionStatus.Watching, "watching", 0, 0],
    [FixProductionStatus.AwaitingDeploy, "awaitingDeploy", 0, 0],
    [FixProductionStatus.Unverifiable, "unverifiable", 0, 0],
  ] as Array<
    [FixProductionStatus, keyof AiOutcomesPullRequestFixes, number, number]
  >)(
    "%s counts as %s: %i verified and %i checked in its week",
    (
      status: FixProductionStatus,
      field: keyof AiOutcomesPullRequestFixes,
      verified: number,
      checked: number,
    ) => {
      const outcomes: AiOutcomes = build({
        pullRequestRows: [pullRequest(status)],
      });

      expect(outcomes.pullRequestFixes).toEqual({
        ...ZERO_PULL_REQUEST_FIXES,
        [field]: 1,
      });
      expect(weekly(outcomes, "fixesVerified")).toEqual(
        onlyInWeek(4, verified),
      );
      expect(weekly(outcomes, "fixesChecked")).toEqual(onlyInWeek(4, checked));
    },
  );

  test("a status this server does not know is not counted", () => {
    const outcomes: AiOutcomes = build({
      pullRequestRows: [pullRequest("Merged"), pullRequest(undefined)],
    });

    expect(outcomes.pullRequestFixes).toEqual(ZERO_PULL_REQUEST_FIXES);
    expect(weekly(outcomes, "fixesChecked")).toEqual(NO_WEEKS);
  });

  test("both kinds of fix add up in the weeks they started in", () => {
    const outcomes: AiOutcomes = build({
      remediationRows: [
        remediation(AutoRemediationVerificationStatus.Verified, inWeek(7)),
        remediation(AutoRemediationVerificationStatus.Failed, inWeek(7)),
        remediation(AutoRemediationVerificationStatus.Pending, inWeek(7)),
        remediation(AutoRemediationVerificationStatus.Verified, inWeek(2)),
      ],
      pullRequestRows: [
        pullRequest(FixProductionStatus.Verified, inWeek(7)),
        pullRequest(FixProductionStatus.Regressed, inWeek(7)),
        pullRequest(FixProductionStatus.Watching, inWeek(7)),
        pullRequest(FixProductionStatus.Regressed, inWeek(10)),
      ],
    });

    expect(weekly(outcomes, "fixesVerified")).toEqual([
      0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0,
    ]);
    expect(weekly(outcomes, "fixesChecked")).toEqual([
      0, 0, 1, 0, 0, 0, 0, 4, 0, 0, 1, 0,
    ]);
    expect(sumOfWeeks(outcomes, "fixesVerified")).toBe(
      getVerifiedFixCount(outcomes),
    );
    expect(sumOfWeeks(outcomes, "fixesChecked")).toBe(
      getCheckedFixCount(outcomes),
    );
  });
});

describe("root causes", () => {
  test("every investigation finished in the window counts as completed, judged or not", () => {
    const outcomes: AiOutcomes = build({
      investigationRows: [
        investigation({}),
        investigation({ autoGrade: AIRunAutoGrade.Match }),
        investigation({ humanVerdict: AIRunHumanVerdict.Rejected }),
        investigation({ autoGrade: "Unsure" }),
      ],
    });

    expect(outcomes.rootCauses).toEqual({
      confirmed: 1,
      partial: 0,
      wrong: 1,
      judgedByPeople: 1,
      completed: 4,
    });
    expect(getJudgedRootCauseCount(outcomes.rootCauses!)).toBe(2);
    expect(weekly(outcomes, "rootCausesJudged")).toEqual(onlyInWeek(4, 2));
    expect(weekly(outcomes, "rootCausesConfirmed")).toEqual(onlyInWeek(4));
  });

  test("each investigation counts once, a person's verdict before its grade", () => {
    const outcomes: AiOutcomes = build({
      investigationRows: [
        // Confirmed by a person, though graded a miss.
        investigation({
          humanVerdict: AIRunHumanVerdict.Confirmed,
          autoGrade: AIRunAutoGrade.Mismatch,
        }),
        // Rejected by a person, though graded a match.
        investigation({
          humanVerdict: AIRunHumanVerdict.Rejected,
          autoGrade: AIRunAutoGrade.Match,
        }),
        // Graded only.
        investigation({ autoGrade: AIRunAutoGrade.Partial }),
        investigation({ autoGrade: AIRunAutoGrade.Match }),
        investigation({ autoGrade: AIRunAutoGrade.Mismatch }),
      ],
    });

    expect(outcomes.rootCauses).toEqual({
      confirmed: 2,
      partial: 1,
      wrong: 2,
      judgedByPeople: 2,
      completed: 5,
    });
    expect(weekly(outcomes, "rootCausesConfirmed")).toEqual(onlyInWeek(4, 2));
    expect(weekly(outcomes, "rootCausesJudged")).toEqual(onlyInWeek(4, 5));
  });

  test("a verdict this server does not know is no person's judgement: the grade decides", () => {
    const outcomes: AiOutcomes = build({
      investigationRows: [
        investigation({ humanVerdict: "Edited", autoGrade: "Match" }),
        investigation({ humanVerdict: "Edited" }),
      ],
    });

    expect(outcomes.rootCauses).toEqual({
      confirmed: 1,
      partial: 0,
      wrong: 0,
      judgedByPeople: 0,
      completed: 2,
    });
  });

  test("partly right and wrong are judged, never confirmed", () => {
    const outcomes: AiOutcomes = build({
      investigationRows: [
        investigation({ autoGrade: AIRunAutoGrade.Partial }, inWeek(9)),
        investigation({ autoGrade: AIRunAutoGrade.Mismatch }, inWeek(9)),
      ],
    });

    expect(weekly(outcomes, "rootCausesJudged")).toEqual(onlyInWeek(9, 2));
    expect(weekly(outcomes, "rootCausesConfirmed")).toEqual(NO_WEEKS);
  });

  test("an investigation from before the window is not counted, not even as completed", () => {
    const outcomes: AiOutcomes = build({
      investigationRows: [
        investigation(
          { humanVerdict: AIRunHumanVerdict.Confirmed },
          new Date(WINDOW_START.getTime() - DAY),
        ),
      ],
    });

    expect(outcomes.rootCauses!.completed).toBe(0);
    expect(outcomes.rootCauses!.confirmed).toBe(0);
    expect(outcomes.rootCauses!.judgedByPeople).toBe(0);
  });
});

describe("isPartial", () => {
  test.each([true, false])(
    "%s passes through as it came",
    (isPartial: boolean) => {
      expect(build({ isPartial }).isPartial).toBe(isPartial);
    },
  );
});

/*
 * However the rows fall, the weeks add up to the parts' own totals, and the
 * totals are what a plain count of the rows inside the window says.
 */
describe("the weeks always add up to the totals", () => {
  // Drawn from the suites' one seeded generator: the same rows every run.
  function pick<T>(random: SeededRandom, values: Array<T>): T {
    return values[random(values.length)]!;
  }

  function isInWindow(createdAt: Date): boolean {
    return (
      createdAt.getTime() >= WINDOW_START.getTime() &&
      createdAt.getTime() < WINDOW_END.getTime()
    );
  }

  function countWhere<T extends { createdAt: Date }>(
    rows: Array<T>,
    matches: (row: T) => boolean,
  ): number {
    return rows.filter((row: T): boolean => {
      return isInWindow(row.createdAt) && matches(row);
    }).length;
  }

  test.each([1, 7, 42, 2026])("rows from seed %i", (seed: number) => {
    const random: SeededRandom = seededRandom(seed);
    // From two weeks before the window to a week after it.
    const from: number = WINDOW_START.getTime() - 2 * WEEK;
    const span: number = WINDOW_END.getTime() + WEEK - from;
    const when: () => Date = (): Date => {
      return new Date(from + Math.floor(random() * span));
    };

    const pageRows: Array<AiOutcomesPageRow> = [];
    const remediationRows: Array<AiOutcomesRemediationRow> = [];
    const pullRequestRows: Array<AiOutcomesPullRequestRow> = [];
    const investigationRows: Array<AiOutcomesInvestigationRow> = [];

    for (let index: number = 0; index < 400; index++) {
      pageRows.push(
        page(
          pick(random, [
            ...Object.values(OnCallPolicyAiHoldOutcome),
            "Unknown",
            undefined,
          ]),
          when(),
        ),
      );
      remediationRows.push(
        remediation(
          pick(random, [
            ...Object.values(AutoRemediationVerificationStatus),
            "Unknown",
            undefined,
          ]),
          when(),
        ),
      );
      pullRequestRows.push(
        pullRequest(
          pick(random, [
            ...Object.values(FixProductionStatus),
            "Unknown",
            undefined,
          ]),
          when(),
        ),
      );
      investigationRows.push(
        investigation(
          {
            humanVerdict: pick(random, [
              AIRunHumanVerdict.Confirmed,
              AIRunHumanVerdict.Rejected,
              undefined,
              undefined,
              "Edited",
            ]),
            autoGrade: pick(random, [
              AIRunAutoGrade.Match,
              AIRunAutoGrade.Partial,
              AIRunAutoGrade.Mismatch,
              undefined,
            ]),
          },
          when(),
        ),
      );
    }

    const outcomes: AiOutcomes = build({
      pageRows,
      remediationRows,
      pullRequestRows,
      investigationRows,
    });

    // The parts, as a plain count of the rows inside the window says.
    expect(outcomes.pages).toEqual({
      resolvedByAi: countWhere(pageRows, (row: AiOutcomesPageRow) => {
        return row.outcome === OnCallPolicyAiHoldOutcome.ResolvedByAI;
      }),
      recoveredOnItsOwn: countWhere(pageRows, (row: AiOutcomesPageRow) => {
        return row.outcome === OnCallPolicyAiHoldOutcome.RecoveredOnItsOwn;
      }),
      handledByPerson: countWhere(pageRows, (row: AiOutcomesPageRow) => {
        return row.outcome === OnCallPolicyAiHoldOutcome.HandledByPerson;
      }),
      handedOff: countWhere(pageRows, (row: AiOutcomesPageRow) => {
        return row.outcome === OnCallPolicyAiHoldOutcome.HandedOff;
      }),
      holdTimeRanOut: countWhere(pageRows, (row: AiOutcomesPageRow) => {
        return row.outcome === OnCallPolicyAiHoldOutcome.HoldTimeRanOut;
      }),
      pageNowPressed: countWhere(pageRows, (row: AiOutcomesPageRow) => {
        return row.outcome === OnCallPolicyAiHoldOutcome.PageNowPressed;
      }),
      holding: countWhere(pageRows, (row: AiOutcomesPageRow) => {
        return row.outcome === OnCallPolicyAiHoldOutcome.Holding;
      }),
    });
    expect(outcomes.remediationFixes).toEqual({
      verified: countWhere(remediationRows, (row: AiOutcomesRemediationRow) => {
        return (
          row.verificationStatus === AutoRemediationVerificationStatus.Verified
        );
      }),
      failed: countWhere(remediationRows, (row: AiOutcomesRemediationRow) => {
        return (
          row.verificationStatus === AutoRemediationVerificationStatus.Failed
        );
      }),
      pending: countWhere(remediationRows, (row: AiOutcomesRemediationRow) => {
        return (
          row.verificationStatus === AutoRemediationVerificationStatus.Pending
        );
      }),
      skipped: countWhere(remediationRows, (row: AiOutcomesRemediationRow) => {
        return (
          row.verificationStatus === AutoRemediationVerificationStatus.Skipped
        );
      }),
    });
    expect(outcomes.pullRequestFixes).toEqual({
      verified: countWhere(pullRequestRows, (row: AiOutcomesPullRequestRow) => {
        return row.productionStatus === FixProductionStatus.Verified;
      }),
      regressed: countWhere(
        pullRequestRows,
        (row: AiOutcomesPullRequestRow) => {
          return row.productionStatus === FixProductionStatus.Regressed;
        },
      ),
      watching: countWhere(pullRequestRows, (row: AiOutcomesPullRequestRow) => {
        return row.productionStatus === FixProductionStatus.Watching;
      }),
      awaitingDeploy: countWhere(
        pullRequestRows,
        (row: AiOutcomesPullRequestRow) => {
          return row.productionStatus === FixProductionStatus.AwaitingDeploy;
        },
      ),
      unverifiable: countWhere(
        pullRequestRows,
        (row: AiOutcomesPullRequestRow) => {
          return row.productionStatus === FixProductionStatus.Unverifiable;
        },
      ),
    });

    const judged: (row: AiOutcomesInvestigationRow) => string | null = (
      row: AiOutcomesInvestigationRow,
    ): string | null => {
      return AiOutcomesBuilder.judge(row);
    };

    expect(outcomes.rootCauses).toEqual({
      confirmed: countWhere(
        investigationRows,
        (row: AiOutcomesInvestigationRow) => {
          return judged(row) === AiOutcomesJudgement.Confirmed;
        },
      ),
      partial: countWhere(
        investigationRows,
        (row: AiOutcomesInvestigationRow) => {
          return judged(row) === AiOutcomesJudgement.Partial;
        },
      ),
      wrong: countWhere(
        investigationRows,
        (row: AiOutcomesInvestigationRow) => {
          return judged(row) === AiOutcomesJudgement.Wrong;
        },
      ),
      judgedByPeople: countWhere(
        investigationRows,
        (row: AiOutcomesInvestigationRow) => {
          return (
            row.humanVerdict === AIRunHumanVerdict.Confirmed ||
            row.humanVerdict === AIRunHumanVerdict.Rejected
          );
        },
      ),
      completed: countWhere(investigationRows, () => {
        return true;
      }),
    });

    // Every count of the weeks adds up to its part's total.
    expect(sumOfWeeks(outcomes, "pagesAvoided")).toBe(
      outcomes.pages!.resolvedByAi,
    );
    expect(sumOfWeeks(outcomes, "pagesHeld")).toBe(
      getHeldPageCount(outcomes.pages!),
    );
    expect(sumOfWeeks(outcomes, "fixesVerified")).toBe(
      getVerifiedFixCount(outcomes),
    );
    expect(sumOfWeeks(outcomes, "fixesChecked")).toBe(
      getCheckedFixCount(outcomes),
    );
    expect(sumOfWeeks(outcomes, "rootCausesConfirmed")).toBe(
      outcomes.rootCauses!.confirmed,
    );
    expect(sumOfWeeks(outcomes, "rootCausesJudged")).toBe(
      getJudgedRootCauseCount(outcomes.rootCauses!),
    );
    // A week never counts more good than it counts in all.
    for (const week of outcomes.weeks) {
      expect(week.pagesAvoided).toBeLessThanOrEqual(week.pagesHeld);
      expect(week.fixesVerified).toBeLessThanOrEqual(week.fixesChecked);
      expect(week.rootCausesConfirmed).toBeLessThanOrEqual(
        week.rootCausesJudged,
      );
    }
    // The seed put rows in every kind and outcome, in and out of the window.
    expect(outcomes.pages!.holding).toBeGreaterThan(0);
    expect(outcomes.rootCauses!.judgedByPeople).toBeGreaterThan(0);
    expect(outcomes.rootCauses!.completed).toBeLessThan(400);
  });
});
