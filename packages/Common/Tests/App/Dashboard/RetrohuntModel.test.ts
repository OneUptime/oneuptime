import { describe, expect, test } from "@jest/globals";
import {
  RETROHUNT_DEFAULT_PERIOD_IN_HOURS,
  RETROHUNT_GROUPS_SHOWN_FIRST,
  RetrohuntSentence,
  RetrohuntUncounted,
  buildRetrohuntRequest,
  getRetrohuntUncounted,
  canRunRetrohunt,
  getRetrohuntExceptionLines,
  getRetrohuntFacts,
  getRetrohuntGroupLabel,
  getRetrohuntGroupsNoun,
  getRetrohuntHeadline,
  getRetrohuntKeptLines,
  getRetrohuntPeriodOptions,
  getRetrohuntVisibleGroups,
  isPluralSentence,
  isRetrohuntWithoutHistory,
  isRetrohuntUngrouped,
  isSameRetrohuntRule,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Retrohunt/RetrohuntModel";
import {
  CORRELATION_FOUND_NOTHING,
  EVERY_MATCH,
  EXCEPTIONS_PREVENTED,
  EXCEPTIONS_SKIPPED,
  EXCEPTIONS_SKIPPED_NOTHING,
  FIRINGS_A_DAY,
  FOR_ADDRESSES,
  FOR_GROUPS,
  FOR_HOSTS,
  FOR_USERS,
  MATCHING_EVENTS,
  NEAR_MISS,
  NO_MATCHES,
  PERIOD_LAST_DAY,
  PERIOD_LAST_MONTH,
  PERIOD_LAST_WEEK,
  UNCOUNTED_HIDDEN_BY_SCRUB_RULE,
  UNCOUNTED_NO_HOST,
  UNCOUNTED_NO_IP_ADDRESS,
  UNCOUNTED_NO_USER,
  UNCOUNTED_NO_VALUE,
  UNCOUNTED_USER_HIDDEN_BY_SCRUB_RULE,
  WOULD_HAVE_FIRED,
  WOULD_NOT_HAVE_FIRED,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Retrohunt/RetrohuntCopy";
import {
  RETROHUNT_CORRELATION_FOUND_NOTHING_KEPT,
  RETROHUNT_COULD_NOT_TELL,
  RETROHUNT_FIRST_SEEN_NO_HISTORY,
  RETROHUNT_FIRST_SEEN_SHORT_HISTORY,
  RETROHUNT_KEPT,
  RETROHUNT_NO_MATCHES_KEPT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Retention/SecurityEventRetentionCopy";
import { PluralTemplate } from "../../../UI/Utils/TranslateTemplate";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  DetectionRetrohuntGroup,
  DetectionRetrohuntResult,
} from "../../../Types/SecurityEvent/DetectionRetrohunt";

/*
 * WHAT RUN ON PAST EVENTS SAYS ABOUT AN ANSWER: the headline, the facts
 * under it (how often a day, for whom, out of how many matching events -
 * or how close it came), what the rule's exceptions did, what each group
 * is called, the periods offered - and the request it sends, from a rule's
 * row or from the form as it stands.
 */

const RULE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

function group(
  value: string,
  entityType: string,
  firedCount: number = 1,
): DetectionRetrohuntGroup {
  return {
    value,
    entityType,
    firedCount,
    eventCount: firedCount * 3,
    firstFiredAt: null,
    lastFiredAt: null,
    sampleMessage: "",
    summary: "",
  };
}

function result(
  overrides: Partial<DetectionRetrohuntResult> = {},
): DetectionRetrohuntResult {
  return {
    startTime: new Date("2026-10-20T12:00:00.000Z"),
    endTime: new Date("2026-10-27T12:00:00.000Z"),
    periodInHours: 168,
    retentionInDays: 15,
    keptFrom: null,
    firstSeenHistory: null,
    isCorrelation: false,
    windowInMinutes: 5,
    threshold: 3,
    firedCount: 42,
    groupCount: 3,
    eventCount: 900,
    matchedEventCount: 1204,
    exceptionCount: 0,
    skippedEventCount: 0,
    preventedFiredCount: 0,
    groups: [
      group("alice", SecurityEntityType.User, 30),
      group("bob", SecurityEntityType.User, 10),
      group("carol", SecurityEntityType.User, 2),
    ],
    hasMoreGroups: false,
    candidateLimit: null,
    uncounted: null,
    ...overrides,
  };
}

describe("what a rule that counts per value could not count (#10415)", () => {
  test("says how many matching events had no value, in the words of the field it groups by", () => {
    const cases: ReadonlyArray<[string, PluralTemplate]> = [
      ["principalIp", UNCOUNTED_NO_IP_ADDRESS],
      ["targetIp", UNCOUNTED_NO_IP_ADDRESS],
      ["principalUser", UNCOUNTED_NO_USER],
      ["principalHost", UNCOUNTED_NO_HOST],
    ];

    for (const [field, template] of cases) {
      expect({
        field,
        uncounted: getRetrohuntUncounted(
          result({
            uncounted: {
              field,
              eventCount: 1204,
              hiddenInLogsCount: 0,
              hiddenInTracesCount: 0,
            },
          }),
        ),
      }).toEqual({
        field,
        uncounted: {
          lines: [{ template, count: 1204, values: {} }],
          scrubRulesSignal: null,
        },
      });
    }

    expect(
      getRetrohuntUncounted(
        result({
          uncounted: {
            field: "ssh.method",
            eventCount: 3,
            hiddenInLogsCount: 0,
            hiddenInTracesCount: 0,
          },
        }),
      )?.lines,
    ).toEqual([
      {
        template: UNCOUNTED_NO_VALUE,
        count: 3,
        values: { field: "ssh.method" },
      },
    ]);
  });

  test("says how many a scrub rule hid the address of, and opens the Scrub Rules of the record most were hidden in", () => {
    const fromLogs: RetrohuntUncounted | null = getRetrohuntUncounted(
      result({
        uncounted: {
          field: "principalIp",
          eventCount: 1204,
          hiddenInLogsCount: 1180,
          hiddenInTracesCount: 4,
        },
      }),
    );

    expect(fromLogs).toEqual({
      lines: [
        { template: UNCOUNTED_NO_IP_ADDRESS, count: 1204, values: {} },
        { template: UNCOUNTED_HIDDEN_BY_SCRUB_RULE, count: 1184 },
      ],
      scrubRulesSignal: "log",
    });

    expect(
      getRetrohuntUncounted(
        result({
          uncounted: {
            field: "principalIp",
            eventCount: 20,
            hiddenInLogsCount: 1,
            hiddenInTracesCount: 19,
          },
        }),
      )?.scrubRulesSignal,
    ).toBe("trace");
  });

  test("says how many a scrub rule hid the user of, for a rule that counts per user (#10435)", () => {
    for (const field of ["principalUser", "targetUser"]) {
      expect({
        field,
        uncounted: getRetrohuntUncounted(
          result({
            uncounted: {
              field,
              eventCount: 340,
              hiddenInLogsCount: 12,
              hiddenInTracesCount: 300,
            },
          }),
        ),
      }).toEqual({
        field,
        uncounted: {
          lines: [
            { template: UNCOUNTED_NO_USER, count: 340, values: {} },
            { template: UNCOUNTED_USER_HIDDEN_BY_SCRUB_RULE, count: 312 },
          ],
          scrubRulesSignal: "trace",
        },
      });
    }
  });

  test("says nothing for a rule that left nothing out", () => {
    expect(getRetrohuntUncounted(result())).toBeNull();
    expect(
      getRetrohuntUncounted(
        result({
          uncounted: {
            field: "principalIp",
            eventCount: 0,
            hiddenInLogsCount: 0,
            hiddenInTracesCount: 0,
          },
        }),
      ),
    ).toBeNull();
  });

  test("its words are one sentence and its plural", () => {
    for (const template of [
      UNCOUNTED_NO_IP_ADDRESS,
      UNCOUNTED_NO_USER,
      UNCOUNTED_NO_HOST,
      UNCOUNTED_NO_VALUE,
    ]) {
      expect(template.other).toContain("so this rule couldn't count them.");
      expect(template.one).toContain("so this rule couldn't count it.");
      expect(
        template.other.startsWith("{{count}} matching events had no"),
      ).toBe(true);
    }

    expect(UNCOUNTED_NO_IP_ADDRESS.other).toBe(
      "{{count}} matching events had no IP address, so this rule couldn't count them.",
    );
    expect(UNCOUNTED_USER_HIDDEN_BY_SCRUB_RULE.other).toBe(
      "A scrub rule hid the user of {{count}} of them.",
    );
  });
});

describe("the periods offered", () => {
  test("the last day, week and month, by their hours, a week to start with", () => {
    expect(getRetrohuntPeriodOptions()).toEqual([
      { label: PERIOD_LAST_DAY, value: "24" },
      { label: PERIOD_LAST_WEEK, value: "168" },
      { label: PERIOD_LAST_MONTH, value: "720" },
    ]);
    expect(RETROHUNT_DEFAULT_PERIOD_IN_HOURS).toBe(168);
  });
});

describe("the headline", () => {
  test("how often it would have fired, counted for the reader's plural", () => {
    const headline: RetrohuntSentence = getRetrohuntHeadline(result());

    expect(headline).toEqual({ template: WOULD_HAVE_FIRED, count: 42 });
    expect(isPluralSentence(headline)).toBe(true);
  });

  test("or that it would not have", () => {
    expect(getRetrohuntHeadline(result({ firedCount: 0 }))).toEqual({
      template: WOULD_NOT_HAVE_FIRED,
    });
  });
});

describe("what the groups are called", () => {
  test("users, hosts or addresses when every group is one", () => {
    expect(
      getRetrohuntGroupsNoun([
        group("alice", SecurityEntityType.User),
        group("bob", SecurityEntityType.User),
      ]),
    ).toBe(FOR_USERS);
    expect(
      getRetrohuntGroupsNoun([group("web-01", SecurityEntityType.Host)]),
    ).toBe(FOR_HOSTS);
    expect(
      getRetrohuntGroupsNoun([group("10.0.0.5", SecurityEntityType.IpAddress)]),
    ).toBe(FOR_ADDRESSES);
  });

  test("groups when they are mixed, or nothing in particular", () => {
    expect(
      getRetrohuntGroupsNoun([
        group("alice", SecurityEntityType.User),
        group("web-01", SecurityEntityType.Host),
      ]),
    ).toBe(FOR_GROUPS);
    expect(getRetrohuntGroupsNoun([group("x", "")])).toBe(FOR_GROUPS);
    expect(getRetrohuntGroupsNoun([])).toBe(FOR_GROUPS);
  });
});

describe("the facts under the headline", () => {
  test("a day, for whom, and every matching event", () => {
    expect(getRetrohuntFacts(result())).toEqual([
      { template: FIRINGS_A_DAY, values: { count: 6 } },
      { template: FOR_USERS, count: 3 },
      { template: MATCHING_EVENTS, count: 1204 },
    ]);
  });

  test("a rule that groups nothing has no 'for 1 group'", () => {
    const ungrouped: DetectionRetrohuntResult = result({
      groupCount: 1,
      groups: [group("", "", 42)],
    });

    expect(isRetrohuntUngrouped(ungrouped)).toBe(true);
    expect(getRetrohuntFacts(ungrouped)).toEqual([
      { template: FIRINGS_A_DAY, values: { count: 6 } },
      { template: MATCHING_EVENTS, count: 1204 },
    ]);
  });

  test("a correlation counts the events behind its matches", () => {
    expect(
      getRetrohuntFacts(
        result({
          isCorrelation: true,
          firedCount: 2,
          groupCount: 2,
          eventCount: 14,
          matchedEventCount: null,
          threshold: null,
          groups: [
            group("203.0.113.7", SecurityEntityType.IpAddress),
            group("203.0.113.8", SecurityEntityType.IpAddress),
          ],
        }),
      ),
    ).toEqual([
      // Two in a week is under one a day: no "0.3 a day".
      { template: FOR_ADDRESSES, count: 2 },
      { template: MATCHING_EVENTS, count: 14 },
    ]);
  });

  test("how many a day only over a week or a month, and only from one a day", () => {
    function rate(data: Partial<DetectionRetrohuntResult>): unknown {
      return getRetrohuntFacts(result(data)).find(
        (fact: RetrohuntSentence): boolean => {
          return fact.template === FIRINGS_A_DAY;
        },
      );
    }

    // The last 24 hours: a day's count is the headline's own.
    expect(rate({ periodInHours: 24, firedCount: 6 })).toBeUndefined();
    // Under one a day says nothing the headline does not.
    expect(rate({ periodInHours: 168, firedCount: 6 })).toBeUndefined();
    expect(rate({ periodInHours: 720, firedCount: 20 })).toBeUndefined();
    // One a day and more is the rule's weight on whoever reads its alerts.
    expect(rate({ periodInHours: 168, firedCount: 7 })).toEqual({
      template: FIRINGS_A_DAY,
      values: { count: 1 },
    });
    expect(rate({ periodInHours: 720, firedCount: 1680 })).toEqual({
      template: FIRINGS_A_DAY,
      values: { count: 56 },
    });
  });

  test("would not have fired, but matched: how close it came, with the threshold", () => {
    expect(
      getRetrohuntFacts(
        result({
          firedCount: 0,
          groupCount: 0,
          groups: [],
          matchedEventCount: 12,
        }),
      ),
    ).toEqual([{ template: NEAR_MISS, count: 12, values: { threshold: 3 } }]);
  });

  test("would not have fired, and matched nothing", () => {
    expect(
      getRetrohuntFacts(
        result({
          firedCount: 0,
          groupCount: 0,
          groups: [],
          matchedEventCount: 0,
        }),
      ),
    ).toEqual([{ template: NO_MATCHES }]);
  });

  test("a correlation that found nothing says so in its own words", () => {
    expect(
      getRetrohuntFacts(
        result({
          isCorrelation: true,
          firedCount: 0,
          groupCount: 0,
          groups: [],
          matchedEventCount: null,
          threshold: null,
        }),
      ),
    ).toEqual([{ template: CORRELATION_FOUND_NOTHING }]);
  });
});

/*
 * #10432: a period that starts before the kept events do - the last 30
 * days, in a project keeping 15 - says so, and nothing found is said of
 * the kept days ("in the last 15 days"), never of the whole period. A First
 * seen rule says how much of the history before the period it could see,
 * and one that could see none says it could not tell what was new, which
 * is not "nothing new".
 */
describe("what it says of the events the project keeps", () => {
  const DAY: number = 24 * 60 * 60;

  const MONTH: Partial<DetectionRetrohuntResult> = {
    startTime: new Date("2026-09-27T12:00:00.000Z"),
    endTime: new Date("2026-10-27T12:00:00.000Z"),
    periodInHours: 720,
    retentionInDays: 15,
    keptFrom: new Date("2026-10-12T12:00:00.000Z"),
  };

  const NOTHING: Partial<DetectionRetrohuntResult> = {
    firedCount: 0,
    groupCount: 0,
    groups: [],
    matchedEventCount: 0,
  };

  test("a period past the kept events: they are kept 15 days, so this looked back 15", () => {
    expect(getRetrohuntKeptLines(result(MONTH))).toEqual([
      { template: RETROHUNT_KEPT, spans: { retention: 15 * DAY } },
    ]);
  });

  test("a period the kept events cover says nothing of them", () => {
    expect(getRetrohuntKeptLines(result())).toEqual([]);
    // An answer from before it was said, too.
    expect(
      getRetrohuntKeptLines(result({ retentionInDays: null, keptFrom: null })),
    ).toEqual([]);
  });

  test("nothing matched: said of the last 15 days, never of the whole period", () => {
    const facts: Array<RetrohuntSentence> = getRetrohuntFacts(
      result({ ...MONTH, ...NOTHING }),
    );

    expect(facts).toEqual([
      { template: RETROHUNT_NO_MATCHES_KEPT, spans: { retention: 15 * DAY } },
    ]);
    expect(facts).not.toContainEqual({ template: NO_MATCHES });
  });

  test("a correlation that found nothing: said of the kept days too", () => {
    expect(
      getRetrohuntFacts(
        result({
          ...MONTH,
          ...NOTHING,
          isCorrelation: true,
          matchedEventCount: null,
          threshold: null,
        }),
      ),
    ).toEqual([
      {
        template: RETROHUNT_CORRELATION_FOUND_NOTHING_KEPT,
        spans: { retention: 15 * DAY },
      },
    ]);
  });

  test("how close it came is about the events it matched, as before", () => {
    expect(
      getRetrohuntFacts(
        result({ ...MONTH, ...NOTHING, matchedEventCount: 12 }),
      ),
    ).toEqual([{ template: NEAR_MISS, count: 12, values: { threshold: 3 } }]);
  });

  test("a day's rate is over the days kept: 30 firings in 15 kept days are 2 a day", () => {
    expect(getRetrohuntFacts(result({ ...MONTH, firedCount: 30 }))[0]).toEqual({
      template: FIRINGS_A_DAY,
      values: { count: 2 },
    });
  });

  test("a First seen rule that could see 8 of its 30 days before the period says so", () => {
    const answer: DetectionRetrohuntResult = result({
      isCorrelation: true,
      firstSeenHistory: {
        lookbackInSeconds: 30 * DAY,
        keptLookbackInSeconds: 8 * DAY,
      },
    });

    expect(isRetrohuntWithoutHistory(answer)).toBe(false);
    expect(getRetrohuntKeptLines(answer)).toEqual([
      {
        template: RETROHUNT_FIRST_SEEN_SHORT_HISTORY,
        spans: { lookback: 30 * DAY, kept: 8 * DAY },
      },
    ]);
  });

  test("one that could see none of it could not tell what was new: never 'would not have fired'", () => {
    const answer: DetectionRetrohuntResult = result({
      ...MONTH,
      ...NOTHING,
      isCorrelation: true,
      matchedEventCount: null,
      threshold: null,
      firstSeenHistory: {
        lookbackInSeconds: 30 * DAY,
        keptLookbackInSeconds: 0,
      },
    });

    expect(isRetrohuntWithoutHistory(answer)).toBe(true);
    expect(getRetrohuntHeadline(answer)).toEqual({
      template: RETROHUNT_COULD_NOT_TELL,
    });
    expect(getRetrohuntFacts(answer)).toEqual([]);
    expect(getRetrohuntKeptLines(answer)).toEqual([
      { template: RETROHUNT_KEPT, spans: { retention: 15 * DAY } },
      {
        template: RETROHUNT_FIRST_SEEN_NO_HISTORY,
        spans: { lookback: 30 * DAY },
      },
    ]);
  });

  test("one that could see none of it but still found a new value says how often", () => {
    const answer: DetectionRetrohuntResult = result({
      isCorrelation: true,
      firedCount: 1,
      firstSeenHistory: {
        lookbackInSeconds: 30 * DAY,
        keptLookbackInSeconds: 0,
      },
    });

    expect(getRetrohuntHeadline(answer)).toEqual({
      template: WOULD_HAVE_FIRED,
      count: 1,
    });
  });
});

describe("what the rule's exceptions did", () => {
  test("no exception applies: nothing to say", () => {
    expect(getRetrohuntExceptionLines(result())).toEqual([]);
  });

  test("they skipped events, and kept it from firing", () => {
    expect(
      getRetrohuntExceptionLines(
        result({
          exceptionCount: 2,
          skippedEventCount: 310,
          preventedFiredCount: 12,
        }),
      ),
    ).toEqual([
      { template: EXCEPTIONS_SKIPPED, count: 310 },
      { template: EXCEPTIONS_PREVENTED, count: 12 },
    ]);
  });

  test("they skipped events, none of which would have fired", () => {
    expect(
      getRetrohuntExceptionLines(
        result({
          exceptionCount: 1,
          skippedEventCount: 4,
          preventedFiredCount: 0,
        }),
      ),
    ).toEqual([{ template: EXCEPTIONS_SKIPPED, count: 4 }]);
  });

  test("they skipped nothing in this period", () => {
    expect(
      getRetrohuntExceptionLines(
        result({
          exceptionCount: 3,
          skippedEventCount: 0,
          preventedFiredCount: 0,
        }),
      ),
    ).toEqual([{ template: EXCEPTIONS_SKIPPED_NOTHING, count: 3 }]);
  });

  test("a correlation is read once with them: nothing to compare", () => {
    expect(
      getRetrohuntExceptionLines(
        result({
          isCorrelation: true,
          exceptionCount: 2,
          skippedEventCount: null,
          preventedFiredCount: null,
        }),
      ),
    ).toEqual([]);
  });
});

describe("the groups listed", () => {
  test("a group's value, or Every match for a rule that groups nothing", () => {
    expect(
      getRetrohuntGroupLabel(group("alice", SecurityEntityType.User)),
    ).toEqual({ text: "alice", isKey: false });
    expect(getRetrohuntGroupLabel(group("", ""))).toEqual({
      text: EVERY_MATCH,
      isKey: true,
    });
  });

  test("the first ten until Show all", () => {
    const many: Array<DetectionRetrohuntGroup> = [];

    for (let index: number = 0; index < 23; index++) {
      many.push(group(`user-${index}`, SecurityEntityType.User));
    }

    expect(RETROHUNT_GROUPS_SHOWN_FIRST).toBe(10);
    expect(getRetrohuntVisibleGroups(many, false)).toHaveLength(10);
    expect(getRetrohuntVisibleGroups(many, true)).toHaveLength(23);
    expect(getRetrohuntVisibleGroups(many.slice(0, 4), false)).toHaveLength(4);
  });
});

describe("the request", () => {
  test("from a rule's row: the saved rule, and the period", () => {
    expect(buildRetrohuntRequest({ detectionRuleId: RULE_ID }, 24)).toEqual({
      periodInHours: 24,
      detectionRuleId: RULE_ID,
    });
  });

  test("from a new rule's form: its YAML and how it counts, as numbers", () => {
    expect(
      buildRetrohuntRequest(
        {
          sigmaRuleYaml: "title: x",
          groupByField: " principalIp ",
          distinctCountField: null,
          matchCountThreshold: "5",
          evaluationIntervalInMinutes: 10,
        },
        168,
      ),
    ).toEqual({
      periodInHours: 168,
      sigmaRuleYaml: "title: x",
      groupByField: "principalIp",
      distinctCountField: "",
      matchCountThreshold: 5,
      evaluationIntervalInMinutes: 10,
    });
  });

  test("from an edit: the saved rule's id, so its exceptions apply, with the form's values", () => {
    expect(
      buildRetrohuntRequest(
        {
          detectionRuleId: RULE_ID,
          sigmaRuleYaml: "title: x",
          groupByField: "",
          matchCountThreshold: "",
        },
        720,
      ),
    ).toEqual({
      periodInHours: 720,
      detectionRuleId: RULE_ID,
      sigmaRuleYaml: "title: x",
      groupByField: "",
      distinctCountField: "",
    });
  });

  test("a form with no YAML sends no counting of its own", () => {
    expect(
      buildRetrohuntRequest(
        { detectionRuleId: RULE_ID, sigmaRuleYaml: "  ", groupByField: "x" },
        24,
      ),
    ).toEqual({ periodInHours: 24, detectionRuleId: RULE_ID });
  });

  test("a rule to run: some YAML, or a saved rule", () => {
    expect(canRunRetrohunt({ sigmaRuleYaml: "title: x" })).toBe(true);
    expect(canRunRetrohunt({ detectionRuleId: RULE_ID })).toBe(true);
    expect(canRunRetrohunt({ sigmaRuleYaml: "   " })).toBe(false);
    expect(canRunRetrohunt({})).toBe(false);
  });

  test("a form changed after its run is told apart from another period of the same rule", () => {
    const ran: ReturnType<typeof buildRetrohuntRequest> = buildRetrohuntRequest(
      { sigmaRuleYaml: "title: x", matchCountThreshold: 5 },
      168,
    );

    expect(
      isSameRetrohuntRule(
        ran,
        buildRetrohuntRequest(
          { sigmaRuleYaml: "title: x", matchCountThreshold: 5 },
          24,
        ),
      ),
    ).toBe(true);
    expect(
      isSameRetrohuntRule(
        ran,
        buildRetrohuntRequest(
          { sigmaRuleYaml: "title: y", matchCountThreshold: 5 },
          168,
        ),
      ),
    ).toBe(false);
    expect(
      isSameRetrohuntRule(
        ran,
        buildRetrohuntRequest(
          { sigmaRuleYaml: "title: x", matchCountThreshold: 6 },
          168,
        ),
      ),
    ).toBe(false);
  });
});
