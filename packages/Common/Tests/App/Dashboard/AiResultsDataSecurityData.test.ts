import { describe, expect, test } from "@jest/globals";
import { describeTrendDate } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsData";
import {
  AiResultsBreakdown,
  AiResultsCard,
  AiResultsCardKind,
  AiResultsFact,
  AiResultsSegment,
  AiResultsWeekBar,
  BY_KIND_TITLE,
  DATA_SECURITY_CHANGES_TITLE,
  DATA_SECURITY_CHANGE_LABELS,
  DATA_SECURITY_DESCRIPTION,
  DATA_SECURITY_FACT_LABELS,
  DATA_SECURITY_HEADLINE,
  DATA_SECURITY_HOW_CHANGES_COUNT,
  DATA_SECURITY_KIND_LABELS,
  DATA_SECURITY_PROPOSALS_TITLE,
  DATA_SECURITY_PROPOSAL_LABELS,
  DATA_SECURITY_TITLE,
  DATA_SECURITY_WEEK_LEGEND,
  canReadAnyAiResults,
  describeKindResult,
  getAiResultsCards,
  getDataSecurityKindLabel,
  hasAiResults,
  parseAiOutcomes,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Results/AiResultsData";
import {
  AI_RESULTS_RECORDS_CLICK_HINTS,
  AI_RESULTS_RECORDS_UNTITLED_ISSUE,
  describeRecordDataSecurityIssue,
  describeRecordsCount,
  getRecordFacts,
  parseAiOutcomesRecords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/Results/AiResultsRecordsData";
import {
  AI_OUTCOMES_DATA_SECURITY_PARTS,
  AI_OUTCOMES_PART_OUTCOMES,
  AiOutcomes,
  AiOutcomesDataSecurity,
  AiOutcomesPart,
  AiOutcomesRecords,
} from "../../../Types/AI/AiOutcomes";
import { DataSecurityAiProposalKind } from "../../../Types/DataSecurity/DataSecurityAi";
import { JSONObject } from "../../../Types/JSON";
import {
  AI_RESULTS_WEEK_STARTS,
  DATA_SECURITY_CHANGES_MADE_BY_WEEK,
  DATA_SECURITY_CHANGES_PROVEN_BY_WEEK,
  makeDataSecurity,
  makeEmptyOutcomes,
  makeOutcomes,
  makeQuietWeeks,
  makeWeeks,
  toBody,
} from "./AiResultsFixtures";

/*
 * AI RESULTS COUNTS DATA SECURITY (#10364), in the page's words: the
 * server's Data Security part read defensively, the card it draws - what
 * worked of the changes OneUptime AI made, what came of the others, what
 * the team did with its proposals, the issues it analyzed and how long an
 * issue took to pass its check - and the records each number opens. In
 * English here: no i18next is set up.
 */

const SCRUB: string = DataSecurityAiProposalKind.ScrubTelemetry;

function withDataSecurity(
  overrides: Partial<AiOutcomesDataSecurity> = {},
  outcomes: Partial<AiOutcomes> = {},
): AiOutcomes {
  return makeOutcomes({
    dataSecurity: makeDataSecurity(overrides),
    ...outcomes,
  });
}

function card(outcomes: AiOutcomes = withDataSecurity()): AiResultsCard {
  const found: AiResultsCard | undefined = getAiResultsCards(outcomes).find(
    (candidate: AiResultsCard): boolean => {
      return candidate.kind === AiResultsCardKind.DataSecurity;
    },
  );

  if (!found) {
    throw new Error("No Data Security card.");
  }

  return found;
}

function segmentsOf(
  breakdown: AiResultsBreakdown,
): Array<[string, number, string, string, string]> {
  return breakdown.segments.map(
    (segment: AiResultsSegment): [string, number, string, string, string] => {
      return [
        segment.label,
        segment.value,
        segment.color,
        segment.records.part,
        segment.records.outcome,
      ];
    },
  );
}

describe("reading the server's Data Security part", () => {
  test("reads it as it was sent", () => {
    const outcomes: AiOutcomes = withDataSecurity();

    expect(parseAiOutcomes(toBody(outcomes))).toEqual(outcomes);
  });

  test("sent as null, or not at all: one the reader may not read", () => {
    const body: JSONObject = toBody(withDataSecurity());
    delete body["dataSecurity"];

    expect(parseAiOutcomes(body)!.dataSecurity).toBeNull();
    expect(
      parseAiOutcomes(toBody(makeOutcomes({ dataSecurity: null })))!
        .dataSecurity,
    ).toBeNull();
  });

  test("an unread count of the issues analyzed, and no time yet, are kept as nothing", () => {
    const outcomes: AiOutcomes = withDataSecurity({
      issuesAnalyzed: null,
      medianMinutesToCheckPassed: null,
      issuesCheckPassed: 0,
    });

    expect(parseAiOutcomes(toBody(outcomes))!.dataSecurity).toEqual(
      outcomes.dataSecurity,
    );
  });

  test("a kind this build does not know is kept, as stored", () => {
    const outcomes: AiOutcomes = withDataSecurity({
      kinds: [
        ...makeDataSecurity().kinds,
        {
          kind: "RevokeAccess",
          proven: 1,
          waiting: 0,
          undone: 0,
          failed: 0,
          approved: 1,
          dismissed: 0,
        },
      ],
    });

    expect(parseAiOutcomes(toBody(outcomes))!.dataSecurity!.kinds).toEqual(
      outcomes.dataSecurity!.kinds,
    );
  });

  test("keeps only what it knows", () => {
    const body: JSONObject = toBody(withDataSecurity());
    const dataSecurity: JSONObject = body["dataSecurity"] as JSONObject;
    dataSecurity["issueTitles"] = ["Customer emails in logs"];
    (dataSecurity["changes"] as JSONObject)["note"] = "secret";

    const parsed: AiOutcomes = parseAiOutcomes(body)!;

    expect(parsed).toEqual(withDataSecurity());
    expect(JSON.stringify(parsed)).not.toContain("Customer emails in logs");
    expect(JSON.stringify(parsed)).not.toContain("secret");
  });

  test.each([
    [
      "the part is not an object",
      (): unknown => {
        return "yes";
      },
    ],
    [
      "a change count is negative",
      (part: JSONObject): unknown => {
        return {
          ...part,
          changes: { ...(part["changes"] as JSONObject), proven: -1 },
        };
      },
    ],
    [
      "the proposals are missing",
      (part: JSONObject): unknown => {
        const without: JSONObject = { ...part };
        delete without["proposals"];
        return without;
      },
    ],
    [
      "a proposal count is a fraction",
      (part: JSONObject): unknown => {
        return {
          ...part,
          proposals: { ...(part["proposals"] as JSONObject), dismissed: 0.5 },
        };
      },
    ],
    [
      "the issues analyzed is text",
      (part: JSONObject): unknown => {
        return { ...part, issuesAnalyzed: "14" };
      },
    ],
    [
      "the issues analyzed is missing",
      (part: JSONObject): unknown => {
        const without: JSONObject = { ...part };
        delete without["issuesAnalyzed"];
        return without;
      },
    ],
    [
      "the time is text",
      (part: JSONObject): unknown => {
        return { ...part, medianMinutesToCheckPassed: "205" };
      },
    ],
    [
      "the time is negative",
      (part: JSONObject): unknown => {
        return { ...part, medianMinutesToCheckPassed: -5 };
      },
    ],
    [
      "the issues it is over are missing",
      (part: JSONObject): unknown => {
        const without: JSONObject = { ...part };
        delete without["issuesCheckPassed"];
        return without;
      },
    ],
    [
      "the kinds are not a list",
      (part: JSONObject): unknown => {
        return { ...part, kinds: { ScrubTelemetry: 1 } };
      },
    ],
    [
      "a kind has no name",
      (part: JSONObject): unknown => {
        return {
          ...part,
          kinds: [{ ...(part["kinds"] as Array<JSONObject>)[0]!, kind: " " }],
        };
      },
    ],
    [
      "a kind has a count left out",
      (part: JSONObject): unknown => {
        const kind: JSONObject = {
          ...(part["kinds"] as Array<JSONObject>)[0]!,
        };
        delete kind["approved"];
        return { ...part, kinds: [kind] };
      },
    ],
  ] as Array<[string, (part: JSONObject) => unknown]>)(
    "refuses the whole answer when %s",
    (_name: string, change: (part: JSONObject) => unknown) => {
      const body: JSONObject = toBody(withDataSecurity());
      body["dataSecurity"] = change(
        body["dataSecurity"] as JSONObject,
      ) as never;

      expect(parseAiOutcomes(body)).toBeNull();
    },
  );

  test("refuses the whole answer for a week without its Data Security counts", () => {
    const body: JSONObject = toBody(withDataSecurity());
    const weeks: Array<JSONObject> = body["weeks"] as Array<JSONObject>;
    const week: JSONObject = { ...weeks[3]! };
    delete week["dataSecurityChangesMade"];
    weeks[3] = week;

    expect(parseAiOutcomes(body)).toBeNull();
  });
});

describe("whether there is anything to show", () => {
  const NOTHING_ELSE: Partial<AiOutcomes> = {
    pages: null,
    remediationFixes: null,
    pullRequestFixes: null,
    rootCauses: null,
  };

  test("a reader who may read Data Security alone may read AI Results", () => {
    expect(
      canReadAnyAiResults(
        makeOutcomes({ ...NOTHING_ELSE, dataSecurity: null }),
      ),
    ).toBe(false);
    expect(
      canReadAnyAiResults(
        makeOutcomes({ ...NOTHING_ELSE, dataSecurity: makeDataSecurity() }),
      ),
    ).toBe(true);
  });

  test("nothing analyzed, made or dismissed is nothing to show", () => {
    expect(
      hasAiResults(
        makeEmptyOutcomes({
          dataSecurity: makeDataSecurity({
            issuesAnalyzed: 0,
            changes: { proven: 0, waiting: 0, undone: 0, failed: 0 },
            proposals: { approved: 0, dismissed: 0 },
            kinds: [],
            medianMinutesToCheckPassed: null,
            issuesCheckPassed: 0,
          }),
        }),
      ),
    ).toBe(false);
  });

  test.each([
    ["an issue analyzed", { issuesAnalyzed: 1 }],
    [
      "a change waiting for its check",
      {
        changes: { proven: 0, waiting: 1, undone: 0, failed: 0 },
      },
    ],
    [
      "a change that could not be made",
      {
        changes: { proven: 0, waiting: 0, undone: 0, failed: 1 },
      },
    ],
    ["a proposal dismissed", { proposals: { approved: 0, dismissed: 1 } }],
  ] as Array<[string, Partial<AiOutcomesDataSecurity>]>)(
    "%s is something to show",
    (_name: string, overrides: Partial<AiOutcomesDataSecurity>) => {
      expect(
        hasAiResults(
          makeEmptyOutcomes({
            dataSecurity: makeDataSecurity({
              issuesAnalyzed: 0,
              changes: { proven: 0, waiting: 0, undone: 0, failed: 0 },
              proposals: { approved: 0, dismissed: 0 },
              kinds: [],
              medianMinutesToCheckPassed: null,
              issuesCheckPassed: 0,
              ...overrides,
            }),
          }),
        ),
      ).toBe(true);
    },
  );
});

describe("the Data Security card", () => {
  test("comes last, for a reader of Data Security only, and not at all for anyone else", () => {
    expect(
      getAiResultsCards(withDataSecurity()).map((each: AiResultsCard) => {
        return each.kind;
      }),
    ).toEqual([
      AiResultsCardKind.PagesAvoided,
      AiResultsCardKind.FixesVerified,
      AiResultsCardKind.RootCausesConfirmed,
      AiResultsCardKind.DataSecurity,
    ]);
    expect(
      getAiResultsCards(
        withDataSecurity(
          {},
          {
            pages: null,
            remediationFixes: null,
            pullRequestFixes: null,
            rootCauses: null,
          },
        ),
      ).map((each: AiResultsCard) => {
        return each.kind;
      }),
    ).toEqual([AiResultsCardKind.DataSecurity]);
    expect(
      getAiResultsCards(makeOutcomes()).map((each: AiResultsCard) => {
        return each.kind;
      }),
    ).not.toContain(AiResultsCardKind.DataSecurity);
  });

  test("is the changes that worked out of every change made, in one count-dependent sentence", () => {
    const drawn: AiResultsCard = card();

    expect(drawn.title).toBe(DATA_SECURITY_TITLE);
    expect(drawn.title).toBe("Data Security");
    expect(drawn.description).toBe(DATA_SECURITY_DESCRIPTION);
    expect(drawn.headline).toBe(DATA_SECURITY_HEADLINE);
    expect(drawn.headline.one).toContain("{{value}} of {{count}}");
    expect(drawn.headline.other).toContain("{{value}} of {{count}}");
    // 9 worked, of 9 + 3 waiting + 1 undone: not the 2 that changed nothing.
    expect([drawn.value, drawn.total]).toEqual([9, 13]);
    expect(drawn.startNotes).toEqual([]);
  });

  test("breaks the changes down, worked first and in green, then the proposals your team decided on - each opening what it counts", () => {
    const drawn: AiResultsCard = card();

    expect(
      drawn.breakdowns.map((breakdown: AiResultsBreakdown) => {
        return breakdown.title;
      }),
    ).toEqual([DATA_SECURITY_CHANGES_TITLE, DATA_SECURITY_PROPOSALS_TITLE]);
    expect(segmentsOf(drawn.breakdowns[0]!)).toEqual([
      [
        DATA_SECURITY_CHANGE_LABELS.proven,
        9,
        "bg-emerald-500",
        AiOutcomesPart.DataSecurityChanges,
        "proven",
      ],
      [
        DATA_SECURITY_CHANGE_LABELS.waiting,
        3,
        "bg-sky-400",
        AiOutcomesPart.DataSecurityChanges,
        "waiting",
      ],
      [
        DATA_SECURITY_CHANGE_LABELS.undone,
        1,
        "bg-indigo-400",
        AiOutcomesPart.DataSecurityChanges,
        "undone",
      ],
      [
        DATA_SECURITY_CHANGE_LABELS.failed,
        2,
        "bg-rose-500",
        AiOutcomesPart.DataSecurityChanges,
        "failed",
      ],
    ]);
    expect(segmentsOf(drawn.breakdowns[1]!)).toEqual([
      [
        DATA_SECURITY_PROPOSAL_LABELS.approved,
        5,
        "bg-emerald-500",
        AiOutcomesPart.DataSecurityProposals,
        "approved",
      ],
      [
        DATA_SECURITY_PROPOSAL_LABELS.dismissed,
        2,
        "bg-rose-500",
        AiOutcomesPart.DataSecurityProposals,
        "dismissed",
      ],
    ]);

    // Every target is an outcome its part's records may name.
    for (const breakdown of drawn.breakdowns) {
      for (const segment of breakdown.segments) {
        expect(AI_OUTCOMES_PART_OUTCOMES[segment.records.part]).toContain(
          segment.records.outcome,
        );
      }
    }
  });

  test("with no proposal decided, the changes are the card's own bar, untitled", () => {
    const drawn: AiResultsCard = card(
      withDataSecurity({ proposals: { approved: 0, dismissed: 0 } }),
    );

    expect(drawn.breakdowns).toHaveLength(1);
    expect(drawn.breakdowns[0]!.title).toBeUndefined();
  });

  test("beside the bars: the issues it analyzed, which open them, and how long an issue took to pass its check", () => {
    const facts: Array<AiResultsFact> = card().facts;

    expect(facts).toEqual([
      {
        label: DATA_SECURITY_FACT_LABELS.issuesAnalyzed,
        value: 14,
        records: {
          part: AiOutcomesPart.DataSecurityAnalyses,
          outcome: "analyzed",
        },
      },
      {
        label: DATA_SECURITY_FACT_LABELS.timeToCheckPassed,
        value: 205,
        isDurationInMinutes: true,
      },
    ]);
  });

  test("the issues analyzed the reader may not read, or none, and no time yet", () => {
    expect(
      card(
        withDataSecurity({
          issuesAnalyzed: null,
          medianMinutesToCheckPassed: null,
          issuesCheckPassed: 0,
        }),
      ).facts,
    ).toEqual([]);
    // None analyzed: a count that opens nothing.
    expect(card(withDataSecurity({ issuesAnalyzed: 0 })).facts[0]).toEqual({
      label: DATA_SECURITY_FACT_LABELS.issuesAnalyzed,
      value: 0,
    });
  });

  test("its bars are the changes that worked out of the changes made, week by week, each saying so", () => {
    const drawn: AiResultsCard = card();

    expect(
      drawn.weeks.map((week: AiResultsWeekBar): [string, number, number] => {
        return [week.weekStart, week.value, week.total];
      }),
    ).toEqual(
      AI_RESULTS_WEEK_STARTS.map(
        (weekStart: string, index: number): [string, number, number] => {
          return [
            weekStart,
            DATA_SECURITY_CHANGES_PROVEN_BY_WEEK[index]!,
            DATA_SECURITY_CHANGES_MADE_BY_WEEK[index]!,
          ];
        },
      ),
    );
    expect(drawn.weeks[8]!.description).toBe(
      `Week of ${describeTrendDate("2026-10-17")}: 2 of 3 changes OneUptime AI made worked`,
    );
    expect(drawn.weeks[3]!.description).toBe(
      `Week of ${describeTrendDate("2026-09-12")}: 1 of 1 change OneUptime AI made worked`,
    );
    expect(drawn.weeks[0]!.description).toBe(
      `Week of ${describeTrendDate("2026-08-22")}: no changes made`,
    );
    expect(drawn.weekLegend).toEqual(DATA_SECURITY_WEEK_LEGEND);
    expect(drawn.weekLegend).toEqual({
      value: "Changes that worked",
      total: "All changes made",
    });
    expect(drawn.recentWeeks).toBe(
      "Last 4\u00A0weeks: 6 of 9. The 4\u00A0weeks before: 2 of 3.",
    );
  });

  test("its weeks are marked where the investigations moved to another model, as every card's are", () => {
    const drawn: AiResultsCard = card(
      withDataSecurity(
        {},
        {
          models: {
            rootCauses: [],
            fixes: [],
            changes: [{ weekStart: "2026-10-17", modelName: "chat-medium" }],
          },
        },
      ),
    );

    expect(drawn.modelChanges).toHaveLength(1);
    expect(drawn.weeks[8]!.modelChange).toBeDefined();
  });
});

describe("the Data Security card with no change made yet", () => {
  const NONE_MADE: Partial<AiOutcomesDataSecurity> = {
    issuesAnalyzed: 0,
    changes: { proven: 0, waiting: 0, undone: 0, failed: 0 },
    proposals: { approved: 0, dismissed: 0 },
    kinds: [],
    medianMinutesToCheckPassed: null,
    issuesCheckPassed: 0,
  };

  function quiet(overrides: Partial<AiOutcomesDataSecurity>): AiResultsCard {
    return card(
      withDataSecurity(
        { ...NONE_MADE, ...overrides },
        { weeks: makeQuietWeeks() },
      ),
    );
  }

  test("nothing at all: it says so, and how a change comes to count", () => {
    const drawn: AiResultsCard = quiet({});

    expect(drawn.total).toBe(0);
    expect(drawn.startNotes).toEqual([
      "No changes made yet.",
      DATA_SECURITY_HOW_CHANGES_COUNT,
    ]);
    expect(drawn.breakdowns).toEqual([]);
    expect(drawn.facts).toEqual([]);
    expect(drawn.byKind).toBeNull();
  });

  test("issues analyzed and changes that could not be made: each said, then how a change counts", () => {
    expect(quiet({ issuesAnalyzed: 3 }).startNotes).toEqual([
      "OneUptime AI analyzed 3 Data Security issues.",
      DATA_SECURITY_HOW_CHANGES_COUNT,
    ]);
    expect(
      quiet({
        issuesAnalyzed: 1,
        changes: { proven: 0, waiting: 0, undone: 0, failed: 2 },
      }).startNotes,
    ).toEqual([
      "OneUptime AI analyzed 1 Data Security issue.",
      "2 changes could not be made, and nothing changed.",
      DATA_SECURITY_HOW_CHANGES_COUNT,
    ]);
    expect(
      quiet({ changes: { proven: 0, waiting: 0, undone: 0, failed: 1 } })
        .startNotes,
    ).toEqual([
      "1 change could not be made, and nothing changed.",
      DATA_SECURITY_HOW_CHANGES_COUNT,
    ]);
  });

  test("once a change is made, waiting for its check or not, the headline counts it and no start note is left", () => {
    const drawn: AiResultsCard = quiet({
      changes: { proven: 0, waiting: 1, undone: 0, failed: 0 },
    });

    expect([drawn.value, drawn.total]).toEqual([0, 1]);
    expect(drawn.startNotes).toEqual([]);
  });
});

describe("by kind", () => {
  const TWO_KINDS: Partial<AiOutcomesDataSecurity> = {
    kinds: [
      {
        kind: SCRUB,
        proven: 7,
        waiting: 2,
        undone: 1,
        failed: 2,
        approved: 4,
        dismissed: 2,
      },
      {
        kind: "RevokeAccess",
        proven: 2,
        waiting: 1,
        undone: 0,
        failed: 0,
        approved: 1,
        dismissed: 0,
      },
    ],
  };

  test("one kind alone compares with nothing: no By kind", () => {
    expect(card().byKind).toBeNull();
  });

  test("two kinds made: each, what worked of what was made, named in the page's words or as stored", () => {
    expect(card(withDataSecurity(TWO_KINDS)).byKind).toEqual({
      rows: [
        {
          kind: SCRUB,
          label:
            DATA_SECURITY_KIND_LABELS[
              DataSecurityAiProposalKind.ScrubTelemetry
            ],
          value: 7,
          total: 10,
        },
        { kind: "RevokeAccess", label: "RevokeAccess", value: 2, total: 3 },
      ],
    });
    expect(BY_KIND_TITLE).toBe("By kind");
  });

  test("a kind with nothing made is left out: one kind left compares with nothing", () => {
    expect(
      card(
        withDataSecurity({
          kinds: [
            makeDataSecurity().kinds[0]!,
            {
              kind: "RevokeAccess",
              proven: 0,
              waiting: 0,
              undone: 0,
              failed: 1,
              approved: 0,
              dismissed: 3,
            },
          ],
        }),
      ).byKind,
    ).toBeNull();
  });

  test("a kind's line and its name", () => {
    expect(
      describeKindResult({
        kind: SCRUB,
        label: "Scrub rules",
        value: 9,
        total: 13,
      }),
    ).toBe("9 of 13");
    expect(getDataSecurityKindLabel(SCRUB)).toBe("Scrub rules");
    expect(getDataSecurityKindLabel("RevokeAccess")).toBe("RevokeAccess");
  });

  test("every other card is counted by no kind", () => {
    for (const drawn of getAiResultsCards(withDataSecurity(TWO_KINDS))) {
      if (drawn.kind !== AiResultsCardKind.DataSecurity) {
        expect({ kind: drawn.kind, byKind: drawn.byKind }).toEqual({
          kind: drawn.kind,
          byKind: null,
        });
      }
    }
  });
});

describe("the records a Data Security number opens", () => {
  const RECORDS: AiOutcomesRecords = {
    part: AiOutcomesPart.DataSecurityChanges,
    outcome: "proven",
    total: 9,
    records: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        at: "2026-11-10T09:00:00.000Z",
        dataSecurityIssue: {
          id: "77777777-7777-4777-8777-777777777777",
          title: "Secrets in telemetry",
        },
        proposalTitle: "Scrub API Key in attributes of checkout-logs",
        proposalKind: SCRUB,
      },
    ],
    nextSkip: null,
  };

  test("each part says what it shows: the issues", () => {
    for (const part of AI_OUTCOMES_DATA_SECURITY_PARTS) {
      expect(AI_RESULTS_RECORDS_CLICK_HINTS[part]).toBe("Show the issues");
    }
  });

  test.each([
    [
      AiOutcomesPart.DataSecurityAnalyses,
      "1 Data Security issue OneUptime AI analyzed over the last 12\u00A0weeks.",
      "14 Data Security issues OneUptime AI analyzed over the last 12\u00A0weeks, newest first.",
    ],
    [
      AiOutcomesPart.DataSecurityChanges,
      "1 change for a Data Security issue over the last 12\u00A0weeks.",
      "14 changes for Data Security issues over the last 12\u00A0weeks, newest first.",
    ],
    [
      AiOutcomesPart.DataSecurityProposals,
      "1 proposal by OneUptime AI over the last 12\u00A0weeks.",
      "14 proposals by OneUptime AI over the last 12\u00A0weeks, newest first.",
    ],
  ] as Array<[AiOutcomesPart, string, string]>)(
    "%s: how many it lists, and what",
    (part: AiOutcomesPart, one: string, many: string) => {
      expect(describeRecordsCount(part, 1)).toBe(one);
      expect(describeRecordsCount(part, 14)).toBe(many);
    },
  );

  test("reads the issue, the line and the kind of each record as they were sent", () => {
    expect(parseAiOutcomesRecords(JSON.parse(JSON.stringify(RECORDS)))).toEqual(
      RECORDS,
    );
  });

  test("an issue with no id is no issue; one with no title still names it", () => {
    const body: JSONObject = JSON.parse(JSON.stringify(RECORDS)) as JSONObject;
    const records: Array<JSONObject> = body["records"] as Array<JSONObject>;

    records.push({
      id: "44444444-4444-4444-8444-444444444445",
      at: "2026-11-09T09:00:00.000Z",
      dataSecurityIssue: { title: "No id" },
    });
    records.push({
      id: "44444444-4444-4444-8444-444444444446",
      at: "2026-11-08T09:00:00.000Z",
      dataSecurityIssue: { id: "77777777-7777-4777-8777-777777777778" },
    });

    const parsed: AiOutcomesRecords = parseAiOutcomesRecords(body)!;

    expect(parsed.records[1]!.dataSecurityIssue).toBeUndefined();
    expect(parsed.records[2]!.dataSecurityIssue).toEqual({
      id: "77777777-7777-4777-8777-777777777778",
    });
  });

  test("an issue is named by its title, else as a Data Security issue", () => {
    expect(
      describeRecordDataSecurityIssue(RECORDS.records[0]!.dataSecurityIssue!),
    ).toBe("Secrets in telemetry");
    expect(
      describeRecordDataSecurityIssue({
        id: "77777777-7777-4777-8777-777777777777",
      }),
    ).toBe(AI_RESULTS_RECORDS_UNTITLED_ISSUE);
    expect(AI_RESULTS_RECORDS_UNTITLED_ISSUE).toBe("Data Security Issue");
  });

  test("its kind is a fact only when no line says what the change was", () => {
    const record: AiOutcomesRecords["records"][number] = RECORDS.records[0]!;

    expect(getRecordFacts(AiOutcomesPart.DataSecurityChanges, record)).toEqual(
      [],
    );
    expect(
      getRecordFacts(AiOutcomesPart.DataSecurityProposals, {
        ...record,
        proposalTitle: undefined,
      }),
    ).toEqual([
      DATA_SECURITY_KIND_LABELS[DataSecurityAiProposalKind.ScrubTelemetry],
    ]);
    expect(
      getRecordFacts(AiOutcomesPart.DataSecurityAnalyses, {
        id: record.id,
        at: record.at,
        dataSecurityIssue: record.dataSecurityIssue,
      }),
    ).toEqual([]);
  });
});

describe("the fixtures add up", () => {
  test("the weeks' changes are the part's", () => {
    const weeks: ReturnType<typeof makeWeeks> = makeWeeks();
    const sum: (
      key: "dataSecurityChangesProven" | "dataSecurityChangesMade",
    ) => number = (
      key: "dataSecurityChangesProven" | "dataSecurityChangesMade",
    ): number => {
      return weeks.reduce((total: number, week: (typeof weeks)[number]) => {
        return total + week[key];
      }, 0);
    };

    expect(sum("dataSecurityChangesProven")).toBe(
      makeDataSecurity().changes.proven,
    );
    expect(sum("dataSecurityChangesMade")).toBe(13);
  });
});
