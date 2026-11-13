import { describe, expect, test } from "@jest/globals";
import { describeTrendDate } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsData";
import {
  AI_RESULTS_RECENT_WEEK_COUNT,
  AiResultsBreakdown,
  AiResultsCard,
  AiResultsCardKind,
  AiResultsFact,
  AiResultsSegment,
  AiResultsWeekBar,
  FIXES_VERIFIED_DESCRIPTION,
  FIXES_VERIFIED_HEADLINE,
  FIXES_VERIFIED_TITLE,
  FIXES_WEEK_LEGEND,
  PAGES_AVOIDED_DESCRIPTION,
  PAGES_AVOIDED_HEADLINE,
  PAGES_AVOIDED_TITLE,
  PAGES_WEEK_LEGEND,
  PAGE_OUTCOME_LABELS,
  PULL_REQUEST_FIXES_TITLE,
  PULL_REQUEST_FIX_LABELS,
  REMEDIATION_FIXES_TITLE,
  REMEDIATION_FIX_LABELS,
  ROOT_CAUSES_CONFIRMED_DESCRIPTION,
  ROOT_CAUSES_CONFIRMED_HEADLINE,
  ROOT_CAUSES_CONFIRMED_TITLE,
  ROOT_CAUSES_HOW_JUDGED,
  ROOT_CAUSES_WEEK_LEGEND,
  ROOT_CAUSE_FACT_LABELS,
  ROOT_CAUSE_LABELS,
  STILL_HELD_LABEL,
  canReadAnyAiResults,
  describeAiResultsPartial,
  describeAiResultsWindow,
  describeRecentWeeks,
  getAiResultsCards,
  hasAiResults,
  parseAiOutcomes,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Results/AiResultsData";
import {
  AiOutcomes,
  AiOutcomesRootCauses,
  AiOutcomesWeek,
  getCheckedFixCount,
  getHeldPageCount,
  getJudgedRootCauseCount,
} from "../../../Types/AI/AiOutcomes";
import { JSONObject } from "../../../Types/JSON";
import {
  AI_RESULTS_WEEK_STARTS,
  FIXES_CHECKED_BY_WEEK,
  FIXES_VERIFIED_BY_WEEK,
  PAGES_AVOIDED_BY_WEEK,
  PAGES_HELD_BY_WEEK,
  ROOT_CAUSES_CONFIRMED_BY_WEEK,
  ROOT_CAUSES_JUDGED_BY_WEEK,
  makeEmptyOutcomes,
  makeOutcomes,
  makeQuietWeeks,
  makeWeeks,
  toBody,
} from "./AiResultsFixtures";

/*
 * The AI Results page's words and numbers (AiResultsData, issue #6800):
 * the server's answer read defensively, then three cards - Pages Avoided,
 * Fixes Verified, Root Causes Confirmed - each its number out of what it
 * counts, its twelve weeks, its breakdown, and in words how it starts when
 * there is nothing to count yet. In English here (no i18next set up: the
 * global translator answers in English); AiResultsInReaderLanguage holds
 * the reader's digits.
 */

function cardOf(outcomes: AiOutcomes, kind: AiResultsCardKind): AiResultsCard {
  const card: AiResultsCard | undefined = getAiResultsCards(outcomes).find(
    (candidate: AiResultsCard): boolean => {
      return candidate.kind === kind;
    },
  );

  if (!card) {
    throw new Error(`No ${kind} card.`);
  }

  return card;
}

function kindsOf(outcomes: AiOutcomes): Array<AiResultsCardKind> {
  return getAiResultsCards(outcomes).map(
    (card: AiResultsCard): AiResultsCardKind => {
      return card.kind;
    },
  );
}

function segmentsOf(
  breakdown: AiResultsBreakdown,
): Array<[string, number, string]> {
  return breakdown.segments.map(
    (segment: AiResultsSegment): [string, number, string] => {
      return [segment.label, segment.value, segment.color];
    },
  );
}

function factsOf(card: AiResultsCard): Array<[string, number]> {
  return card.facts.map((fact: AiResultsFact): [string, number] => {
    return [fact.label, fact.value];
  });
}

function barsOf(card: AiResultsCard): Array<[string, number, number]> {
  return card.weeks.map((week: AiResultsWeekBar): [string, number, number] => {
    return [week.weekStart, week.value, week.total];
  });
}

function zip(
  values: Array<number>,
  totals: Array<number>,
): Array<[string, number, number]> {
  return AI_RESULTS_WEEK_STARTS.map(
    (weekStart: string, index: number): [string, number, number] => {
      return [weekStart, values[index]!, totals[index]!];
    },
  );
}

// ---------------------------------------------------------------------------

describe("parseAiOutcomes: what the page can draw, or null", () => {
  test("reads a whole answer as it was sent", () => {
    const outcomes: AiOutcomes = makeOutcomes({ isPartial: true });

    expect(parseAiOutcomes(toBody(outcomes))).toEqual(outcomes);
  });

  test("a part sent as null, or not sent at all, is one the reader may not read", () => {
    const body: JSONObject = toBody(makeOutcomes({ pages: null }));
    delete body["rootCauses"];

    const parsed: AiOutcomes | null = parseAiOutcomes(body);

    expect(parsed).not.toBeNull();
    expect(parsed!.pages).toBeNull();
    expect(parsed!.rootCauses).toBeNull();
    expect(parsed!.remediationFixes).toEqual(makeOutcomes().remediationFixes);
  });

  test("only true is partial", () => {
    for (const isPartial of ["true", 1, "yes", null, undefined, {}]) {
      const body: JSONObject = toBody(makeOutcomes());
      body["isPartial"] = isPartial as never;

      expect({ isPartial, parsed: parseAiOutcomes(body)!.isPartial }).toEqual({
        isPartial,
        parsed: false,
      });
    }
  });

  test("keeps only the counts it knows: nothing else the server sent is carried along", () => {
    const body: JSONObject = toBody(makeOutcomes());
    (body["pages"] as JSONObject)["incidentTitle"] = "Checkout is down";
    (body["weeks"] as Array<JSONObject>)[0]!["note"] = "secret";
    body["projectId"] = "someone else's";

    const parsed: AiOutcomes = parseAiOutcomes(body)!;

    expect(parsed).toEqual(makeOutcomes());
    expect(JSON.stringify(parsed)).not.toContain("Checkout is down");
    expect(JSON.stringify(parsed)).not.toContain("secret");
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["text", "outcomes"],
    ["a number", 12],
    ["a list", [toBody(makeOutcomes())]],
  ])("%s is not an answer", (_name: string, body: unknown) => {
    expect(parseAiOutcomes(body)).toBeNull();
  });

  test.each([
    ["windowStart", undefined],
    ["windowStart", "the last 12 weeks"],
    ["windowStart", 1755820800000],
    ["windowStart", null],
    ["windowEnd", undefined],
    ["windowEnd", "now"],
    ["windowEnd", ""],
  ])("refuses a window whose %s is %j", (field: string, value: unknown) => {
    const body: JSONObject = toBody(makeOutcomes());
    if (value === undefined) {
      delete body[field];
    } else {
      body[field] = value as never;
    }

    expect(parseAiOutcomes(body)).toBeNull();
  });

  test.each([
    ["pages", "resolvedByAi", -1],
    ["pages", "holding", 1.5],
    ["pages", "handedOff", "6"],
    ["pages", "pageNowPressed", null],
    ["pages", "recoveredOnItsOwn", undefined],
    ["remediationFixes", "verified", -3],
    ["remediationFixes", "skipped", Number.NaN],
    ["pullRequestFixes", "awaitingDeploy", 0.25],
    ["pullRequestFixes", "unverifiable", Number.POSITIVE_INFINITY],
    ["rootCauses", "completed", -20],
    ["rootCauses", "judgedByPeople", "six"],
    ["rootCauses", "partial", true],
  ])(
    "refuses the whole answer when %s.%s is %p",
    (part: string, field: string, value: unknown) => {
      const body: JSONObject = toBody(makeOutcomes());
      const counts: JSONObject = body[part] as JSONObject;

      if (value === undefined) {
        delete counts[field];
      } else {
        counts[field] = value as never;
      }

      expect(parseAiOutcomes(body)).toBeNull();
    },
  );

  test.each([
    ["pages", 35],
    ["remediationFixes", "none"],
    ["pullRequestFixes", [4, 2, 1]],
    ["rootCauses", true],
  ])(
    "refuses the whole answer when %s is %j, not an object",
    (part: string, value: unknown) => {
      const body: JSONObject = toBody(makeOutcomes());
      body[part] = value as never;

      expect(parseAiOutcomes(body)).toBeNull();
    },
  );

  test.each([
    ["not a list", { weekStart: "2026-08-22" }],
    ["an empty list", []],
    [
      "more weeks than a year has",
      Array.from({ length: 54 }, () => {
        return makeWeeks()[0];
      }),
    ],
  ])("refuses weeks that are %s", (_name: string, weeks: unknown) => {
    const body: JSONObject = toBody(makeOutcomes());
    body["weeks"] = weeks as never;

    expect(parseAiOutcomes(body)).toBeNull();
  });

  test("a year of weeks, or just one, is still weeks", () => {
    const weeks: Array<JSONObject> = toBody(makeOutcomes())[
      "weeks"
    ] as Array<JSONObject>;

    const yearBody: JSONObject = toBody(makeOutcomes());
    yearBody["weeks"] = Array.from(
      { length: 53 },
      (_value: unknown, index: number): JSONObject => {
        return weeks[index % 12]!;
      },
    );

    const oneBody: JSONObject = toBody(makeOutcomes());
    oneBody["weeks"] = [weeks[11]!];

    expect(parseAiOutcomes(yearBody)!.weeks).toHaveLength(53);
    expect(parseAiOutcomes(oneBody)!.weeks).toHaveLength(1);
  });

  test.each([
    [
      "not an object",
      (): unknown => {
        return "2026-08-22";
      },
    ],
    [
      "with no first day",
      (week: JSONObject): unknown => {
        const withoutStart: JSONObject = { ...week };
        delete withoutStart["weekStart"];
        return withoutStart;
      },
    ],
    [
      "whose first day is a time",
      (week: JSONObject): unknown => {
        return { ...week, weekStart: "2026-09-26T00:00:00.000Z" };
      },
    ],
    [
      "whose first day is written another way",
      (week: JSONObject): unknown => {
        return { ...week, weekStart: "26/09/2026" };
      },
    ],
    [
      "whose first day is short a digit",
      (week: JSONObject): unknown => {
        return { ...week, weekStart: "2026-9-26" };
      },
    ],
    [
      "whose first day is a number",
      (week: JSONObject): unknown => {
        return { ...week, weekStart: 20260926 };
      },
    ],
    [
      "with a negative count",
      (week: JSONObject): unknown => {
        return { ...week, pagesHeld: -1 };
      },
    ],
    [
      "with a fraction",
      (week: JSONObject): unknown => {
        return { ...week, fixesChecked: 0.5 };
      },
    ],
    [
      "with a count left out",
      (week: JSONObject): unknown => {
        const withoutCount: JSONObject = { ...week };
        delete withoutCount["rootCausesJudged"];
        return withoutCount;
      },
    ],
  ] as Array<[string, (week: JSONObject) => unknown]>)(
    "refuses the whole answer for a week %s",
    (_name: string, change: (week: JSONObject) => unknown) => {
      const body: JSONObject = toBody(makeOutcomes());
      const weeks: Array<unknown> = body["weeks"] as Array<unknown>;

      weeks[5] = change(weeks[5] as JSONObject);

      expect(parseAiOutcomes(body)).toBeNull();
    },
  );
});

describe("whether there is anything to show", () => {
  test("canReadAnyAiResults: any one part the reader may read", () => {
    const none: AiOutcomes = makeOutcomes({
      pages: null,
      remediationFixes: null,
      pullRequestFixes: null,
      rootCauses: null,
    });

    expect(canReadAnyAiResults(none)).toBe(false);
    expect(canReadAnyAiResults(makeOutcomes())).toBe(true);

    for (const part of [
      "pages",
      "remediationFixes",
      "pullRequestFixes",
      "rootCauses",
    ] as Array<keyof AiOutcomes>) {
      expect({
        part,
        canRead: canReadAnyAiResults({
          ...none,
          [part]: makeEmptyOutcomes()[part],
        }),
      }).toEqual({ part, canRead: true });
    }
  });

  test("hasAiResults: nothing held, run, opened or finished is nothing to show", () => {
    expect(hasAiResults(makeEmptyOutcomes())).toBe(false);
    expect(
      hasAiResults(
        makeOutcomes({
          pages: null,
          remediationFixes: null,
          pullRequestFixes: null,
          rootCauses: null,
        }),
      ),
    ).toBe(false);
    expect(hasAiResults(makeOutcomes())).toBe(true);
  });

  test.each([
    [
      "a page still held",
      {
        pages: { ...makeEmptyOutcomes().pages!, holding: 1 },
      },
    ],
    [
      "a held page that ended",
      {
        pages: { ...makeEmptyOutcomes().pages!, handedOff: 1 },
      },
    ],
    [
      "a fix still being checked",
      {
        remediationFixes: {
          ...makeEmptyOutcomes().remediationFixes!,
          pending: 1,
        },
      },
    ],
    [
      "a fix nothing could check",
      {
        remediationFixes: {
          ...makeEmptyOutcomes().remediationFixes!,
          skipped: 1,
        },
      },
    ],
    [
      "a fix pull request waiting for a deploy",
      {
        pullRequestFixes: {
          ...makeEmptyOutcomes().pullRequestFixes!,
          awaitingDeploy: 1,
        },
      },
    ],
    [
      "an investigation finished and not judged",
      {
        rootCauses: { ...makeEmptyOutcomes().rootCauses!, completed: 1 },
      },
    ],
  ] as Array<[string, Partial<AiOutcomes>]>)(
    "hasAiResults: %s is something to show",
    (_name: string, overrides: Partial<AiOutcomes>) => {
      expect(hasAiResults(makeEmptyOutcomes(overrides))).toBe(true);
    },
  );
});

describe("the cards: one per part the reader may read, in the page's order", () => {
  test("Pages Avoided, Fixes Verified, Root Causes Confirmed", () => {
    expect(kindsOf(makeOutcomes())).toEqual([
      AiResultsCardKind.PagesAvoided,
      AiResultsCardKind.FixesVerified,
      AiResultsCardKind.RootCausesConfirmed,
    ]);
    expect(
      getAiResultsCards(makeOutcomes()).map((card: AiResultsCard): string => {
        return card.title;
      }),
    ).toEqual(["Pages Avoided", "Fixes Verified", "Root Causes Confirmed"]);
  });

  test.each([
    [
      "no on-call pages",
      { pages: null },
      [AiResultsCardKind.FixesVerified, AiResultsCardKind.RootCausesConfirmed],
    ],
    [
      "no fixes AI ran, but fix pull requests",
      { remediationFixes: null },
      [
        AiResultsCardKind.PagesAvoided,
        AiResultsCardKind.FixesVerified,
        AiResultsCardKind.RootCausesConfirmed,
      ],
    ],
    [
      "no fix pull requests, but fixes AI ran",
      { pullRequestFixes: null },
      [
        AiResultsCardKind.PagesAvoided,
        AiResultsCardKind.FixesVerified,
        AiResultsCardKind.RootCausesConfirmed,
      ],
    ],
    [
      "no fixes of either kind",
      { remediationFixes: null, pullRequestFixes: null },
      [AiResultsCardKind.PagesAvoided, AiResultsCardKind.RootCausesConfirmed],
    ],
    [
      "no incidents or alerts",
      { rootCauses: null, remediationFixes: null },
      [AiResultsCardKind.PagesAvoided, AiResultsCardKind.FixesVerified],
    ],
    [
      "nothing",
      {
        pages: null,
        remediationFixes: null,
        pullRequestFixes: null,
        rootCauses: null,
      },
      [],
    ],
  ] as Array<[string, Partial<AiOutcomes>, Array<AiResultsCardKind>]>)(
    "a reader who may read %s",
    (
      _name: string,
      overrides: Partial<AiOutcomes>,
      kinds: Array<AiResultsCardKind>,
    ) => {
      expect(kindsOf(makeOutcomes(overrides))).toEqual(kinds);
    },
  );

  test("every card title is in Title Case, and every title and description is a translation key", () => {
    for (const card of getAiResultsCards(makeOutcomes())) {
      for (const word of card.title.split(" ")) {
        expect({ title: card.title, word: word[0] }).toEqual({
          title: card.title,
          word: word[0]!.toUpperCase(),
        });
      }
    }

    expect(
      getAiResultsCards(makeOutcomes()).map((card: AiResultsCard) => {
        return [card.title, card.description];
      }),
    ).toEqual([
      [PAGES_AVOIDED_TITLE, PAGES_AVOIDED_DESCRIPTION],
      [FIXES_VERIFIED_TITLE, FIXES_VERIFIED_DESCRIPTION],
      [ROOT_CAUSES_CONFIRMED_TITLE, ROOT_CAUSES_CONFIRMED_DESCRIPTION],
    ]);
  });

  test("each card says how many out of what, as one count-dependent sentence", () => {
    const cards: Array<AiResultsCard> = getAiResultsCards(makeOutcomes());

    expect(
      cards.map((card: AiResultsCard): [number, number] => {
        return [card.value, card.total];
      }),
    ).toEqual([
      [17, 35],
      [11, 16],
      [11, 16],
    ]);
    expect(
      cards.map((card: AiResultsCard) => {
        return card.headline;
      }),
    ).toEqual([
      PAGES_AVOIDED_HEADLINE,
      FIXES_VERIFIED_HEADLINE,
      ROOT_CAUSES_CONFIRMED_HEADLINE,
    ]);

    for (const card of cards) {
      // The number drawn large, and what it is out of.
      expect(card.headline.one).toContain("{{value}} of {{count}}");
      expect(card.headline.other).toContain("{{value}} of {{count}}");
      // With something to count, no start notes.
      expect(card.startNotes).toEqual([]);
    }
  });
});

describe("Pages Avoided", () => {
  const card: () => AiResultsCard = (): AiResultsCard => {
    return cardOf(makeOutcomes(), AiResultsCardKind.PagesAvoided);
  };

  test("is the held pages OneUptime AI's fix ended, out of every held page that ended", () => {
    expect(card().value).toBe(17);
    expect(card().total).toBe(getHeldPageCount(makeOutcomes().pages!));
    expect(card().total).toBe(35);
  });

  test("breaks down how every held page ended, AI's fix first and in green", () => {
    expect(card().breakdowns).toHaveLength(1);
    expect(card().breakdowns[0]!.title).toBeUndefined();
    expect(segmentsOf(card().breakdowns[0]!)).toEqual([
      [PAGE_OUTCOME_LABELS.resolvedByAi, 17, "bg-emerald-500"],
      [PAGE_OUTCOME_LABELS.recoveredOnItsOwn, 5, "bg-teal-500/50"],
      [PAGE_OUTCOME_LABELS.handledByPerson, 4, "bg-indigo-400"],
      [PAGE_OUTCOME_LABELS.handedOff, 6, "bg-amber-400"],
      [PAGE_OUTCOME_LABELS.holdTimeRanOut, 2, "bg-orange-500"],
      [PAGE_OUTCOME_LABELS.pageNowPressed, 1, "bg-rose-500"],
    ]);
    // The bar is the card's total: a page still held is not in it.
    expect(
      card().breakdowns[0]!.segments.reduce(
        (sum: number, segment: AiResultsSegment): number => {
          return sum + segment.value;
        },
        0,
      ),
    ).toBe(card().total);
  });

  test("the pages still held are a fact beside the bar, not part of it", () => {
    expect(factsOf(card())).toEqual([[STILL_HELD_LABEL, 2]]);
    expect(
      factsOf(
        cardOf(
          makeOutcomes({
            pages: { ...makeOutcomes().pages!, holding: 0 },
          }),
          AiResultsCardKind.PagesAvoided,
        ),
      ),
    ).toEqual([]);
  });

  test("its bars are the pages avoided out of the pages held, week by week", () => {
    expect(barsOf(card())).toEqual(
      zip(PAGES_AVOIDED_BY_WEEK, PAGES_HELD_BY_WEEK),
    );
  });

  test("each bar says its week and its counts", () => {
    const bars: Array<AiResultsWeekBar> = card().weeks;

    expect(bars[0]!.description).toBe(
      `Week of ${describeTrendDate("2026-08-22")}: 0 of 2 held pages ended with OneUptime AI's fix`,
    );
    expect(bars[2]!.description).toBe(
      `Week of ${describeTrendDate("2026-09-05")}: 0 of 1 held page ended with OneUptime AI's fix`,
    );
    // A week with no held pages says so.
    expect(bars[3]!.description).toBe(
      `Week of ${describeTrendDate("2026-09-12")}: no held pages`,
    );
    expect(bars[10]!.description).toBe(
      `Week of ${describeTrendDate("2026-10-31")}: 4 of 6 held pages ended with OneUptime AI's fix`,
    );
  });

  test("its last four weeks against the four before", () => {
    expect(card().recentWeeks).toBe(
      "Last 4 weeks: 10 of 15. The 4 weeks before: 6 of 14.",
    );
  });

  test("with every held page still held, it says how many and that how they end will show up", () => {
    const one: AiResultsCard = cardOf(
      makeEmptyOutcomes({
        pages: { ...makeEmptyOutcomes().pages!, holding: 1 },
      }),
      AiResultsCardKind.PagesAvoided,
    );
    const three: AiResultsCard = cardOf(
      makeEmptyOutcomes({
        pages: { ...makeEmptyOutcomes().pages!, holding: 3 },
      }),
      AiResultsCardKind.PagesAvoided,
    );

    expect(one.total).toBe(0);
    expect(one.startNotes).toEqual([
      "1 page is held right now while OneUptime AI works on it. How it ends will show up here.",
    ]);
    expect(three.startNotes).toEqual([
      "3 pages are held right now while OneUptime AI works on them. How they end will show up here.",
    ]);
    // Nothing ended: no bar, no fact - the start note says it all.
    expect(three.breakdowns).toEqual([]);
    expect(three.facts).toEqual([]);
  });

  test("with no held pages at all, it says how a page comes to be held", () => {
    const quiet: AiResultsCard = cardOf(
      makeEmptyOutcomes(),
      AiResultsCardKind.PagesAvoided,
    );

    expect(quiet.startNotes).toEqual([
      "No held pages yet. When an incident or alert rule waits for OneUptime AI before it pages, how each held page ends shows up here.",
    ]);
    expect(quiet.breakdowns).toEqual([]);
    expect(quiet.facts).toEqual([]);
    expect(quiet.weeks).toHaveLength(12);
  });
});

describe("Fixes Verified", () => {
  const card: (outcomes?: AiOutcomes) => AiResultsCard = (
    outcomes: AiOutcomes = makeOutcomes(),
  ): AiResultsCard => {
    return cardOf(outcomes, AiResultsCardKind.FixesVerified);
  };

  test("is the fixes that worked, of both kinds, out of the fixes whose check finished", () => {
    expect(card().value).toBe(11);
    expect(card().total).toBe(getCheckedFixCount(makeOutcomes()));
    expect(card().total).toBe(16);
    expect(card().facts).toEqual([]);
  });

  test("with both kinds, each has its own titled bar", () => {
    const breakdowns: Array<AiResultsBreakdown> = card().breakdowns;

    expect(
      breakdowns.map((breakdown: AiResultsBreakdown) => {
        return breakdown.title;
      }),
    ).toEqual([REMEDIATION_FIXES_TITLE, PULL_REQUEST_FIXES_TITLE]);
    expect(segmentsOf(breakdowns[0]!)).toEqual([
      [REMEDIATION_FIX_LABELS.verified, 7, "bg-emerald-500"],
      [REMEDIATION_FIX_LABELS.failed, 3, "bg-rose-500"],
      [REMEDIATION_FIX_LABELS.pending, 1, "bg-sky-400"],
      [REMEDIATION_FIX_LABELS.skipped, 2, "bg-gray-300"],
    ]);
    expect(segmentsOf(breakdowns[1]!)).toEqual([
      [PULL_REQUEST_FIX_LABELS.verified, 4, "bg-emerald-500"],
      [PULL_REQUEST_FIX_LABELS.regressed, 2, "bg-rose-500"],
      [PULL_REQUEST_FIX_LABELS.watching, 1, "bg-sky-400"],
      [PULL_REQUEST_FIX_LABELS.awaitingDeploy, 1, "bg-sky-500/50"],
      [PULL_REQUEST_FIX_LABELS.unverifiable, 1, "bg-gray-300"],
    ]);
  });

  test.each([
    ["fixes AI ran", { pullRequestFixes: null }, REMEDIATION_FIX_LABELS],
    ["fix pull requests", { remediationFixes: null }, PULL_REQUEST_FIX_LABELS],
    [
      "fixes AI ran, the fix pull requests being none",
      {
        pullRequestFixes: {
          verified: 0,
          regressed: 0,
          watching: 0,
          awaitingDeploy: 0,
          unverifiable: 0,
        },
      },
      REMEDIATION_FIX_LABELS,
    ],
  ] as Array<[string, Partial<AiOutcomes>, Record<string, string>]>)(
    "with only %s, one bar, untitled: the card's own",
    (
      _name: string,
      overrides: Partial<AiOutcomes>,
      labels: Record<string, string>,
    ) => {
      const breakdowns: Array<AiResultsBreakdown> = card(
        makeOutcomes(overrides),
      ).breakdowns;

      expect(breakdowns).toHaveLength(1);
      expect(breakdowns[0]!.title).toBeUndefined();
      expect(
        breakdowns[0]!.segments.map((segment: AiResultsSegment) => {
          return segment.label;
        }),
      ).toEqual(Object.values(labels));
    },
  );

  test("only the kinds the reader may read count", () => {
    const pullRequestsOnly: AiResultsCard = card(
      makeOutcomes({ remediationFixes: null }),
    );

    expect(pullRequestsOnly.value).toBe(4);
    expect(pullRequestsOnly.total).toBe(6);
  });

  test("its bars are the fixes verified out of the fixes checked, week by week", () => {
    expect(barsOf(card())).toEqual(
      zip(FIXES_VERIFIED_BY_WEEK, FIXES_CHECKED_BY_WEEK),
    );
    expect(card().weeks[0]!.description).toBe(
      `Week of ${describeTrendDate("2026-08-22")}: 1 of 1 checked fix worked`,
    );
    expect(card().weeks[1]!.description).toBe(
      `Week of ${describeTrendDate("2026-08-29")}: no checked fixes`,
    );
    expect(card().weeks[7]!.description).toBe(
      `Week of ${describeTrendDate("2026-10-10")}: 2 of 3 checked fixes worked`,
    );
  });

  test("its last four weeks against the four before", () => {
    expect(card().recentWeeks).toBe(
      "Last 4 weeks: 5 of 6. The 4 weeks before: 4 of 6.",
    );
  });

  test("with fixes still being checked and none finished, it says how many", () => {
    const one: AiResultsCard = card(
      makeEmptyOutcomes({
        remediationFixes: { verified: 0, failed: 0, pending: 1, skipped: 0 },
      }),
    );
    const three: AiResultsCard = card(
      makeEmptyOutcomes({
        remediationFixes: { verified: 0, failed: 0, pending: 1, skipped: 0 },
        pullRequestFixes: {
          verified: 0,
          regressed: 0,
          watching: 1,
          awaitingDeploy: 1,
          unverifiable: 0,
        },
      }),
    );

    expect(one.total).toBe(0);
    expect(one.startNotes).toEqual([
      "1 fix is still being checked. Whether it worked will show up here.",
    ]);
    expect(three.startNotes).toEqual([
      "3 fixes are still being checked. Whether they worked will show up here.",
    ]);
    expect(three.breakdowns).toEqual([]);
  });

  test("with no fixes at all, it says how a fix comes to be checked", () => {
    const quiet: AiResultsCard = card(makeEmptyOutcomes());

    expect(quiet.total).toBe(0);
    expect(quiet.startNotes).toEqual([
      "No checked fixes yet. When OneUptime AI runs a fix, or a fix pull request it opened reaches production, whether it worked shows up here.",
    ]);
    expect(quiet.breakdowns).toEqual([]);
  });

  /*
   * Fixes ran, and nothing could check them: "No checked fixes yet. When
   * OneUptime AI runs a fix..." would say no fix ran.
   */
  test("with only fixes nothing could check, it says how many, of both kinds, and why", () => {
    const one: AiResultsCard = card(
      makeEmptyOutcomes({
        remediationFixes: { verified: 0, failed: 0, pending: 0, skipped: 1 },
      }),
    );
    const three: AiResultsCard = card(
      makeEmptyOutcomes({
        remediationFixes: { verified: 0, failed: 0, pending: 0, skipped: 2 },
        pullRequestFixes: {
          verified: 0,
          regressed: 0,
          watching: 0,
          awaitingDeploy: 0,
          unverifiable: 1,
        },
      }),
    );

    expect(one.total).toBe(0);
    expect(one.startNotes).toEqual([
      "1 fix could not be checked: there was nothing to check it against.",
    ]);
    expect(three.startNotes).toEqual([
      "3 fixes could not be checked: there was nothing to check them against.",
    ]);
    expect(three.breakdowns).toEqual([]);
  });

  test("with fixes being checked and fixes nothing could check, it says both, the ones being checked first", () => {
    const both: AiResultsCard = card(
      makeEmptyOutcomes({
        remediationFixes: { verified: 0, failed: 0, pending: 1, skipped: 4 },
      }),
    );

    expect(both.startNotes).toEqual([
      "1 fix is still being checked. Whether it worked will show up here.",
      "4 fixes could not be checked: there was nothing to check them against.",
    ]);
  });

  test("once a fix is checked, the headline counts it and no start note is left", () => {
    const checked: AiResultsCard = card(
      makeEmptyOutcomes({
        remediationFixes: { verified: 1, failed: 0, pending: 1, skipped: 4 },
      }),
    );

    expect(checked.total).toBe(1);
    expect(checked.startNotes).toEqual([]);
  });
});

describe("Root Causes Confirmed", () => {
  const card: (outcomes?: AiOutcomes) => AiResultsCard = (
    outcomes: AiOutcomes = makeOutcomes(),
  ): AiResultsCard => {
    return cardOf(outcomes, AiResultsCardKind.RootCausesConfirmed);
  };

  test("is the investigations that found the root cause, out of the ones judged", () => {
    expect(card().value).toBe(11);
    expect(card().total).toBe(
      getJudgedRootCauseCount(makeOutcomes().rootCauses!),
    );
    expect(card().total).toBe(16);
  });

  test("breaks the judged down: found it, partly right, missed it", () => {
    expect(card().breakdowns).toHaveLength(1);
    expect(segmentsOf(card().breakdowns[0]!)).toEqual([
      [ROOT_CAUSE_LABELS.confirmed, 11, "bg-emerald-500"],
      [ROOT_CAUSE_LABELS.partial, 2, "bg-amber-400"],
      [ROOT_CAUSE_LABELS.wrong, 3, "bg-rose-500"],
    ]);
  });

  test("beside the bar, how they were judged and the ones not judged yet: together, every investigation it finished", () => {
    expect(factsOf(card())).toEqual([
      [ROOT_CAUSE_FACT_LABELS.judgedByPeople, 6],
      [ROOT_CAUSE_FACT_LABELS.graded, 10],
      [ROOT_CAUSE_FACT_LABELS.notJudged, 4],
    ]);
    expect(
      card().facts.reduce((sum: number, fact: AiResultsFact): number => {
        return sum + fact.value;
      }, 0),
    ).toBe(makeOutcomes().rootCauses!.completed);
  });

  test.each([
    [{ confirmed: 3, partial: 0, wrong: 0, judgedByPeople: 3, completed: 3 }],
    [{ confirmed: 0, partial: 4, wrong: 1, judgedByPeople: 0, completed: 9 }],
    [{ confirmed: 2, partial: 1, wrong: 2, judgedByPeople: 4, completed: 5 }],
  ])(
    "the facts always add up to the investigations finished: %j",
    (rootCauses: AiOutcomesRootCauses) => {
      const facts: Array<AiResultsFact> = card(
        makeOutcomes({ rootCauses }),
      ).facts;

      expect(
        facts.reduce((sum: number, fact: AiResultsFact): number => {
          return sum + fact.value;
        }, 0),
      ).toBe(rootCauses.completed);
      for (const fact of facts) {
        expect(fact.value).toBeGreaterThanOrEqual(0);
      }
    },
  );

  test("its bars are the root causes found out of the investigations judged, week by week", () => {
    expect(barsOf(card())).toEqual(
      zip(ROOT_CAUSES_CONFIRMED_BY_WEEK, ROOT_CAUSES_JUDGED_BY_WEEK),
    );
    expect(card().weeks[0]!.description).toBe(
      `Week of ${describeTrendDate("2026-08-22")}: no judged investigations`,
    );
    expect(card().weeks[1]!.description).toBe(
      `Week of ${describeTrendDate("2026-08-29")}: 0 of 1 judged investigation found the right root cause`,
    );
    expect(card().weeks[8]!.description).toBe(
      `Week of ${describeTrendDate("2026-10-17")}: 2 of 3 judged investigations found the right root cause`,
    );
  });

  test("its last four weeks against the four before", () => {
    expect(card().recentWeeks).toBe(
      "Last 4 weeks: 6 of 8. The 4 weeks before: 3 of 4.",
    );
  });

  test("with investigations finished and none judged, it says how many, and how one comes to be judged", () => {
    const one: AiResultsCard = card(
      makeEmptyOutcomes({
        rootCauses: {
          confirmed: 0,
          partial: 0,
          wrong: 0,
          judgedByPeople: 0,
          completed: 1,
        },
      }),
    );
    const many: AiResultsCard = card(
      makeEmptyOutcomes({
        rootCauses: {
          confirmed: 0,
          partial: 0,
          wrong: 0,
          judgedByPeople: 0,
          completed: 7,
        },
      }),
    );

    expect(one.startNotes).toEqual([
      "OneUptime AI finished 1 investigation, and it has not been judged yet.",
      ROOT_CAUSES_HOW_JUDGED,
    ]);
    expect(many.startNotes).toEqual([
      "OneUptime AI finished 7 investigations, and none has been judged yet.",
      ROOT_CAUSES_HOW_JUDGED,
    ]);
    expect(many.breakdowns).toEqual([]);
    expect(many.facts).toEqual([]);
  });

  test("with nothing finished, it says so, and how an investigation comes to be judged", () => {
    expect(card(makeEmptyOutcomes()).startNotes).toEqual([
      "No judged investigations yet.",
      ROOT_CAUSES_HOW_JUDGED,
    ]);
  });
});

describe("every card's twelve bars", () => {
  test("are the twelve weeks, oldest first, on every card", () => {
    for (const card of getAiResultsCards(makeOutcomes())) {
      expect(
        card.weeks.map((week: AiResultsWeekBar): string => {
          return week.weekStart;
        }),
      ).toEqual(AI_RESULTS_WEEK_STARTS);
      // A bar never says more went well than it counts.
      for (const week of card.weeks) {
        expect(week.value).toBeLessThanOrEqual(week.total);
      }
    }
  });

  test("a week's date is the reader's calendar's, never the server's key", () => {
    const description: string = cardOf(
      makeOutcomes(),
      AiResultsCardKind.PagesAvoided,
    ).weeks[0]!.description;

    expect(describeTrendDate("2026-08-22")).toBe("22 Aug");
    expect(description).toBe(
      "Week of 22 Aug: 0 of 2 held pages ended with OneUptime AI's fix",
    );
    expect(description).not.toContain("2026-08-22");
    expect(description).toContain(describeTrendDate("2026-08-22"));
  });

  /*
   * The legend under the bars names what a bar's green part and its whole
   * are, in the card's own words: its green part is the breakdown's green
   * part where the card has one, so the two never disagree.
   */
  test("each card's legend names the green part and the whole bar, in its own words", () => {
    const cards: Array<AiResultsCard> = getAiResultsCards(makeOutcomes());

    expect(
      cards.map((card: AiResultsCard) => {
        return [card.kind, card.weekLegend];
      }),
    ).toEqual([
      [
        AiResultsCardKind.PagesAvoided,
        { value: "Resolved by OneUptime AI", total: "All held pages" },
      ],
      [
        AiResultsCardKind.FixesVerified,
        { value: "Fixes that worked", total: "All checked fixes" },
      ],
      [
        AiResultsCardKind.RootCausesConfirmed,
        { value: "Found the root cause", total: "All judged investigations" },
      ],
    ]);
    expect(PAGES_WEEK_LEGEND.value).toBe(PAGE_OUTCOME_LABELS.resolvedByAi);
    expect(ROOT_CAUSES_WEEK_LEGEND.value).toBe(ROOT_CAUSE_LABELS.confirmed);
    expect(FIXES_WEEK_LEGEND.value).not.toBe(FIXES_WEEK_LEGEND.total);

    for (const card of cards) {
      const green: Array<string> = card.breakdowns.flatMap(
        (breakdown: AiResultsBreakdown): Array<string> => {
          return breakdown.segments
            .filter((segment: AiResultsSegment): boolean => {
              return segment.color === "bg-emerald-500";
            })
            .map((segment: AiResultsSegment): string => {
              return segment.label;
            });
        },
      );

      // One breakdown names its green part as the legend does.
      if (card.kind !== AiResultsCardKind.FixesVerified) {
        expect(green).toEqual([card.weekLegend.value]);
      }
    }
  });

  test("a card with nothing counted yet keeps its legend, for when it has bars", () => {
    for (const card of getAiResultsCards(makeEmptyOutcomes())) {
      expect(card.total).toBe(0);
      expect(card.weekLegend.value).not.toBe("");
      expect(card.weekLegend.total).not.toBe("");
    }
  });
});

/*
 * The quiet parts of a bar - a fix waiting for a deploy, a page that
 * recovered on its own - are a mid-tone at half strength, never a light
 * tint: a light tint is the brightest part of a dark card.
 */
describe("the colours of every breakdown", () => {
  test("each part's colour is a fill class, never a light tint", () => {
    const colours: Array<string> = getAiResultsCards(makeOutcomes()).flatMap(
      (card: AiResultsCard): Array<string> => {
        return card.breakdowns.flatMap(
          (breakdown: AiResultsBreakdown): Array<string> => {
            return breakdown.segments.map((segment: AiResultsSegment) => {
              return segment.color;
            });
          },
        );
      },
    );

    expect(colours.length).toBeGreaterThan(10);

    for (const colour of colours) {
      expect(colour).toMatch(/^bg-[a-z]+-\d{3}(\/\d{2})?$/);

      const [, shade, strength]: RegExpMatchArray = colour.match(
        /-(\d{3})(?:\/(\d{2}))?$/,
      )!;

      // The grey of "nothing could check it" is Theme.css's to re-colour.
      if (!colour.startsWith("bg-gray-")) {
        expect(parseInt(shade!, 10)).toBeGreaterThanOrEqual(400);
      }

      if (strength) {
        expect(parseInt(strength, 10)).toBeGreaterThanOrEqual(40);
      }
    }
  });
});

describe("describeRecentWeeks: the last four weeks against the four before", () => {
  const pick: (week: AiOutcomesWeek) => { value: number; total: number } = (
    week: AiOutcomesWeek,
  ): { value: number; total: number } => {
    return { value: week.pagesAvoided, total: week.pagesHeld };
  };

  function weeksOf(
    values: Array<number>,
    totals: Array<number>,
  ): Array<AiOutcomesWeek> {
    return values.map((value: number, index: number): AiOutcomesWeek => {
      return {
        ...makeQuietWeeks()[index % 12]!,
        pagesAvoided: value,
        pagesHeld: totals[index]!,
      };
    });
  }

  test("is four weeks", () => {
    expect(AI_RESULTS_RECENT_WEEK_COUNT).toBe(4);
  });

  test("nothing in either: none yet, and none", () => {
    expect(describeRecentWeeks(makeQuietWeeks(), pick)).toBe(
      "Last 4 weeks: none yet. The 4 weeks before: none.",
    );
  });

  test("something only in the four before", () => {
    expect(
      describeRecentWeeks(
        weeksOf(
          [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 2, 0, 1, 0, 0, 0, 0, 0],
        ),
        pick,
      ),
    ).toBe("Last 4 weeks: none yet. The 4 weeks before: 1 of 3.");
  });

  test("something only in the last four", () => {
    expect(
      describeRecentWeeks(
        weeksOf(
          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3],
          [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 3],
        ),
        pick,
      ),
    ).toBe("Last 4 weeks: 3 of 4. The 4 weeks before: none.");
  });

  test("the first four of the twelve weeks are in neither", () => {
    expect(
      describeRecentWeeks(
        weeksOf(
          [5, 5, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0],
          [9, 9, 9, 9, 0, 0, 0, 0, 0, 0, 0, 0],
        ),
        pick,
      ),
    ).toBe("Last 4 weeks: none yet. The 4 weeks before: none.");
  });

  test("with fewer than eight weeks, the weeks before are the ones there are", () => {
    expect(
      describeRecentWeeks(
        weeksOf([1, 1, 2, 0, 1, 0], [2, 1, 2, 1, 1, 3]),
        pick,
      ),
    ).toBe("Last 4 weeks: 3 of 7. The 4 weeks before: 2 of 3.");
    expect(describeRecentWeeks(weeksOf([1, 0, 2], [1, 1, 2]), pick)).toBe(
      "Last 4 weeks: 3 of 4. The 4 weeks before: none.",
    );
  });

  test("its counts are written as the reader writes numbers", () => {
    expect(
      describeRecentWeeks(
        weeksOf(
          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1234],
          [0, 0, 0, 0, 0, 0, 0, 2000, 0, 0, 0, 5678],
        ),
        pick,
      ),
    ).toBe("Last 4 weeks: 1,234 of 5,678. The 4 weeks before: 0 of 2,000.");
  });
});

describe("the lines around the cards", () => {
  test("the window: from the first week's first day, in the reader's calendar, to today", () => {
    const line: string = describeAiResultsWindow(makeOutcomes());

    expect(line).toBe(
      `Counted from ${describeTrendDate("2026-08-22")} to today. Each week counts the work OneUptime AI started that week, however long its check took.`,
    );
  });

  test("with no weeks, the window's own first day", () => {
    expect(
      describeAiResultsWindow(
        makeOutcomes({ weeks: [], windowStart: "2026-08-23T00:00:00.000Z" }),
      ),
    ).toContain(`Counted from ${describeTrendDate("2026-08-23")} to today.`);
  });

  test("partial: each number counts the newest 5,000 of its kind", () => {
    expect(describeAiResultsPartial()).toBe(
      "There was more than this page counts: each number counts the newest 5,000 of its kind.",
    );
  });
});
