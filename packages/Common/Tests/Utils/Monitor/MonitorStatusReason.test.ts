import { describe, expect, test } from "@jest/globals";
import {
  EvaluationSentence,
  englishOfEvaluationSentence,
} from "../../../Types/Monitor/EvaluationSentence";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CheckOn } from "../../../Types/Monitor/CriteriaFilter";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
} from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../Types/ObjectID";
import { createTranslator, Translator } from "../../../Types/Translator";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import { RootCauseFinding } from "../../../Utils/Monitor/MonitorRootCauseWording";
import {
  MonitorEvaluationByProbe,
  MonitorOverviewProbeHealth,
  MonitorOverviewProbeRow,
  MonitorOverviewProbeSummary,
} from "../../../Utils/Monitor/MonitorOverviewProbeUtil";
import {
  getCriteriaStatusIds,
  getEvaluationFindings,
  getMatchedCriteria,
  getProbesBehindStatus,
  MonitorStatusProbe,
  MonitorStatusReason,
  readMarkdownAsPlainText,
  readMonitorStatusReason,
  REASON_FACTS_SHOWN,
} from "../../../Utils/Monitor/MonitorStatusReason";
import MonitorCriteriaEvaluator from "../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";

/*
 * WHY A MONITOR IS IN ITS STATUS, READ FROM ITS STATUS EVENT (#9592).
 *
 * The hero of an Offline monitor said "Offline for 3h" and nothing more:
 * the reason was the status event's root cause, behind the Status
 * Timeline's View Cause. MonitorStatusReason reads that Markdown back into
 * what the hero draws - the criteria that matched, what it found, what the
 * check saw, the probe's cause - in the reader's language where OneUptime
 * wrote the words, and the probes whose newest check holds the status.
 *
 * Each root cause here is built as the engine builds one
 * (MonitorCriteriaEvaluator), with mdText, so an escape or a line the
 * engine writes differently would fail here first.
 */

const ENGLISH: Translator = createTranslator((): string | undefined => {
  return undefined;
}, "en");

function translatorWith(words: Record<string, string>): Translator {
  return createTranslator((key: string): string | undefined => {
    return words[key];
  }, "de");
}

// A root cause as the engine renders one for a criteria that matched.
function engineRootCause(data: {
  criteriaName: string;
  // The filters' finding, as isMonitorInstanceCriteriaFiltersMet returns it.
  conditions: string;
  context?: Array<string> | undefined;
  cause?: string | undefined;
}): string {
  let rootCause: MarkdownText = mdText`
**Created because the following criteria was met**:

**Criteria Name**: ${data.criteriaName}
`;

  rootCause = mdText`${rootCause}
**Filter Conditions Met**: ${FeedMarkdown.asMarkdown(data.conditions)}
`;

  if (data.context) {
    rootCause = mdText`${rootCause}
${FeedMarkdown.asMarkdown(data.context.join("\n"))}
`;
  }

  if (data.cause) {
    rootCause = mdText`${rootCause}
**Cause**: ${data.cause}
`;
  }

  return rootCause.toString();
}

// An Any criteria's finding: its one message, placed as text.
function anyFinding(message: string): string {
  return mdText`${message}`.toString();
}

// An All criteria's finding: "All filters met." and a line per filter.
function allFindings(messages: Array<string>): string {
  return mdText`All filters met.${FeedMarkdown.join(
    messages.map((message: string): MarkdownText => {
      return mdText`\n- ${message}`;
    }),
    "",
  )}`.toString();
}

// The Response Snapshot the engine lists under a probe's check.
function responseSnapshot(): Array<string> {
  return [
    "**Request Details**",
    mdText`- Destination: ${"https://shop.example.com/health"}`.toString(),
    mdText`- Request Method: ${"GET"}`.toString(),
    "",
    "",
    "**Response Snapshot**",
    mdText`- Response Status Code: ${503}`.toString(),
    mdText`- Response Time: ${MonitorCriteriaEvaluator.formatMilliseconds(411) as string}`.toString(),
    mdText`- Timed Out: ${"No"}`.toString(),
    mdText`- Attempts: ${3}`.toString(),
  ];
}

// A finding as the evaluation stores it: its English and its sentence.
function statusCodeFinding(code: number): RootCauseFinding {
  const sentence: EvaluationSentence = {
    template:
      "Response Status Code was {{code}}, at or above the 500 threshold.",
    values: { code: String(code) },
  };

  return {
    message: englishOfEvaluationSentence(sentence),
    messageSentence: sentence,
  };
}

const GERMAN_WORDS: Record<string, string> = {
  "Response Status Code was {{code}}, at or above the 500 threshold.":
    "Der Antwortstatuscode war {{code}}, auf oder über der Schwelle von 500.",
  Yes: "Ja",
  No: "Nein",
  "DNS Resolution": "DNS-Auflösung",
  "Changed by {{user}}": "Geändert von {{user}}",
  "Changed because incident {{incident}} was created.":
    "Geändert, weil Vorfall {{incident}} erstellt wurde.",
  "Changed because incident {{incident}} was updated.":
    "Geändert, weil Vorfall {{incident}} aktualisiert wurde.",
  "Changed by a maintenance event.": "Durch eine Wartung geändert.",
};

const GERMAN: Translator = translatorWith(GERMAN_WORDS);

// A text as a reader reads it: no isolate marks, a plain space for a held one.
function plain(text: string | undefined): string {
  return withoutIsolateMarks(text || "")
    .split(NO_BREAK_SPACE)
    .join(" ");
}

describe("a criteria's root cause", () => {
  const rootCause: string = engineRootCause({
    criteriaName: "Website *is* down [prod]",
    conditions: anyFinding(
      "Response Status Code was 503, at or above the 500 threshold.",
    ),
    context: responseSnapshot(),
    cause: "Server returned 503",
  });

  test("names the criteria as the project wrote it, its escapes undone", () => {
    // The engine escapes what Markdown would read: an emphasis, a link.
    expect(rootCause).toContain("Website \\*is\\* down \\[prod\\]");

    const reason: MonitorStatusReason | null = readMonitorStatusReason({
      rootCause: rootCause,
      translator: ENGLISH,
    });

    expect(reason?.criteriaName).toBe("Website *is* down [prod]");
    expect(reason?.note).toBeUndefined();
  });

  test("says what its filter found, as stored in English", () => {
    const reason: MonitorStatusReason | null = readMonitorStatusReason({
      rootCause: rootCause,
      translator: ENGLISH,
    });

    expect(reason?.findings).toEqual([
      "Response Status Code was 503, at or above the 500 threshold.",
    ]);
  });

  test("words the finding in the reader's language from its evaluation's sentence", () => {
    const reason: MonitorStatusReason | null = readMonitorStatusReason({
      rootCause: rootCause,
      translator: GERMAN,
      findings: [statusCodeFinding(503)],
    });

    expect(plain(reason?.findings[0])).toBe(
      "Der Antwortstatuscode war 503, auf oder über der Schwelle von 500.",
    );
  });

  test("keeps a finding no newer evaluation holds as stored", () => {
    const reason: MonitorStatusReason | null = readMonitorStatusReason({
      rootCause: rootCause,
      translator: GERMAN,
      // The newest check found a 502: the stored 503 is not it.
      findings: [statusCodeFinding(502)],
    });

    expect(reason?.findings).toEqual([
      "Response Status Code was 503, at or above the 500 threshold.",
    ]);
  });

  test("lists what the check saw, and leaves out what only names the target", () => {
    const reason: MonitorStatusReason | null = readMonitorStatusReason({
      rootCause: rootCause,
      translator: ENGLISH,
    });

    expect(
      reason?.facts.map((fact: { label: string }): string => {
        return fact.label;
      }),
    ).toEqual(["Response Status Code", "Response Time", "Attempts"]);
    expect(reason?.facts[0]?.value).toBe("503");
  });

  test("says nothing of a check that did not time out", () => {
    const reason: MonitorStatusReason | null = readMonitorStatusReason({
      rootCause: rootCause,
      translator: ENGLISH,
    });

    expect(
      reason?.facts.some((fact: { label: string }): boolean => {
        return fact.label === "Timed Out";
      }),
    ).toBe(false);
  });

  test("says a check timed out, in the reader's word", () => {
    const reason: MonitorStatusReason | null = readMonitorStatusReason({
      rootCause: engineRootCause({
        criteriaName: "Website is down",
        conditions: anyFinding("Request timed out."),
        context: ["**Response Snapshot**", "- Timed Out: Yes"],
      }),
      translator: GERMAN,
    });

    expect(reason?.facts).toEqual([{ label: "Timed Out", value: "Ja" }]);
  });

  test("writes a response time and attempts in the reader's digits", () => {
    const reason: MonitorStatusReason | null = readMonitorStatusReason({
      rootCause: rootCause,
      translator: dashboardTranslator("fa"),
    });
    const responseTime: string | undefined = reason?.facts.find(
      (fact: { label: string }): boolean => {
        return fact.label === "Response Time";
      },
    )?.value;
    const attempts: string | undefined = reason?.facts.find(
      (fact: { label: string }): boolean => {
        return fact.label === "Attempts";
      },
    )?.value;

    expect(responseTime).toContain("۴۱۱");
    expect(responseTime).not.toContain("411");
    expect(attempts).toBe("۳");
  });

  test("words the phase a request broke in", () => {
    const reason: MonitorStatusReason | null = readMonitorStatusReason({
      rootCause: engineRootCause({
        criteriaName: "Website is down",
        conditions: anyFinding("Request failed."),
        context: [
          "**Request Failed Details**",
          "- Failed Phase: DNS Resolution",
          "- Error Code: ENOTFOUND",
        ],
      }),
      translator: GERMAN,
    });

    expect(reason?.facts).toEqual([
      { label: "Failed Phase", value: "DNS-Auflösung" },
      { label: "Error Code", value: "ENOTFOUND" },
    ]);
  });

  test("keeps the probe's own cause as written", () => {
    const reason: MonitorStatusReason | null = readMonitorStatusReason({
      rootCause: rootCause,
      translator: GERMAN,
    });

    expect(reason?.cause).toBe("Server returned 503");
  });

  test("lists at most a few facts, most telling first", () => {
    const reason: MonitorStatusReason | null = readMonitorStatusReason({
      rootCause: engineRootCause({
        criteriaName: "Website is down",
        conditions: anyFinding("Request failed."),
        context: [
          "**Response Snapshot**",
          "- Response Status Code: 0",
          "- Response Time: 12.00 ms",
          "- Timed Out: Yes",
          "- Attempts: 3",
          "**Request Failed Details**",
          "- Failed Phase: TCP Connection",
          "- Error Code: ECONNREFUSED",
          "- Error Description: Connection refused.",
          "- Raw Error Message: connect ECONNREFUSED 10.0.0.1:443",
        ],
      }),
      translator: ENGLISH,
    });

    expect(reason?.facts).toHaveLength(REASON_FACTS_SHOWN);
    expect(reason?.facts[0]?.label).toBe("Response Status Code");
  });
});

describe("an All criteria's root cause", () => {
  const rootCause: string = engineRootCause({
    criteriaName: "Slow and failing",
    conditions: allFindings([
      "Response Status Code was 503, at or above the 500 threshold.",
      "Response Time was 2,400 ms, above 2,000 ms.",
    ]),
  });

  test("lists each filter's finding, in order", () => {
    const reason: MonitorStatusReason | null = readMonitorStatusReason({
      rootCause: rootCause,
      translator: ENGLISH,
    });

    expect(reason?.criteriaName).toBe("Slow and failing");
    expect(reason?.findings).toEqual([
      "Response Status Code was 503, at or above the 500 threshold.",
      "Response Time was 2,400 ms, above 2,000 ms.",
    ]);
  });

  test("words the findings its evaluation holds, and keeps the rest", () => {
    const reason: MonitorStatusReason | null = readMonitorStatusReason({
      rootCause: rootCause,
      translator: GERMAN,
      findings: [statusCodeFinding(503)],
    });

    expect(reason?.findings.map(plain)).toEqual([
      "Der Antwortstatuscode war 503, auf oder über der Schwelle von 500.",
      "Response Time was 2,400 ms, above 2,000 ms.",
    ]);
  });

  test("never reads a fact line under the list as a finding", () => {
    const reason: MonitorStatusReason | null = readMonitorStatusReason({
      rootCause: engineRootCause({
        criteriaName: "Slow and failing",
        conditions: allFindings(["Response Time was 2,400 ms."]),
        context: ["**Response Snapshot**", "- Response Status Code: 200"],
      }),
      translator: ENGLISH,
    });

    expect(reason?.findings).toEqual(["Response Time was 2,400 ms."]);
    expect(reason?.facts).toEqual([
      { label: "Response Status Code", value: "200" },
    ]);
  });
});

describe("a root cause no criteria wrote", () => {
  test("a person's change says who changed it, in the reader's words", () => {
    const rootCause: string =
      mdText`Monitor status created by ${mdText`[${"Jane Doe"}](${"https://oneuptime.example/dashboard/p/users/u"})`}`.toString();

    expect(
      readMonitorStatusReason({ rootCause: rootCause, translator: ENGLISH })
        ?.note,
    ).toBe("Changed by Jane Doe");
    expect(
      plain(
        readMonitorStatusReason({ rootCause: rootCause, translator: GERMAN })
          ?.note,
      ),
    ).toBe("Geändert von Jane Doe");
  });

  test("an incident's change names the incident", () => {
    expect(
      plain(
        readMonitorStatusReason({
          rootCause: "Status was changed because Incident #42 was created.",
          translator: GERMAN,
        })?.note,
      ),
    ).toBe("Geändert, weil Vorfall #42 erstellt wurde.");
    expect(
      plain(
        readMonitorStatusReason({
          rootCause: "Status was changed because Incident INC-7 was updated.",
          translator: ENGLISH,
        })?.note,
      ),
    ).toBe("Changed because incident INC-7 was updated.");
  });

  test("a maintenance event's change says so, without its id", () => {
    expect(
      readMonitorStatusReason({
        rootCause:
          "Changed because of maintenance event: 5c0a1b2c-1111-4111-8111-111111111111",
        translator: GERMAN,
      })?.note,
    ).toBe("Durch eine Wartung geändert.");
  });

  test("any other note reads as its words, its first paragraph only", () => {
    const reason: MonitorStatusReason | null = readMonitorStatusReason({
      rootCause:
        "The **payments** API is down, see [the runbook](https://runbooks.example/payments).\n\nMore context the hero has no room for.",
      translator: GERMAN,
    });

    expect(reason?.note).toBe("The payments API is down, see the runbook.");
    expect(reason?.criteriaName).toBeUndefined();
    expect(reason?.findings).toEqual([]);
  });

  test("an empty root cause explains nothing", () => {
    for (const rootCause of [undefined, null, "", "   \n  "]) {
      expect(
        readMonitorStatusReason({ rootCause: rootCause, translator: ENGLISH }),
      ).toBeNull();
    }
  });
});

describe("Markdown read as its words", () => {
  test("a link is its words, emphasis and code their text, escapes undone", () => {
    expect(
      readMarkdownAsPlainText(
        "See [the docs](https://docs.example/x) for **why** `GET` \\(v2\\)",
      ),
    ).toBe("See the docs for why GET (v2)");
  });

  test("lines and runs of space are one space", () => {
    expect(readMarkdownAsPlainText("one\n\n  two\tthree")).toBe(
      "one two three",
    );
  });
});

const OFFLINE_ID: string = "44444444-4444-4444-8444-444444444444";
const DEGRADED_ID: string = "55555555-5555-4555-8555-555555555555";
const DOWN_CRITERIA_ID: string = "c-down";
const SLOW_CRITERIA_ID: string = "c-slow";
const ONLINE_CRITERIA_ID: string = "c-online";

// Steps as the API returns them: the status id as JSON, or as an ObjectID.
function steps(): MonitorSteps {
  return {
    data: {
      monitorStepsInstanceArray: [
        {
          data: {
            monitorCriteria: {
              data: {
                monitorCriteriaInstanceArray: [
                  {
                    data: {
                      id: DOWN_CRITERIA_ID,
                      changeMonitorStatus: true,
                      monitorStatusId: { _type: "ObjectID", value: OFFLINE_ID },
                    },
                  },
                  {
                    data: {
                      id: SLOW_CRITERIA_ID,
                      changeMonitorStatus: true,
                      monitorStatusId: new ObjectID(DEGRADED_ID),
                    },
                  },
                  {
                    // Opens an incident only: it sets no status.
                    data: {
                      id: ONLINE_CRITERIA_ID,
                      changeMonitorStatus: false,
                      monitorStatusId: OFFLINE_ID,
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  } as unknown as MonitorSteps;
}

describe("the status each criteria sets", () => {
  test("reads every id however it is stored, only where it changes the status", () => {
    const statusIds: Map<string, string> = getCriteriaStatusIds(steps());

    expect(statusIds.get(DOWN_CRITERIA_ID)).toBe(OFFLINE_ID);
    expect(statusIds.get(SLOW_CRITERIA_ID)).toBe(DEGRADED_ID);
    expect(statusIds.has(ONLINE_CRITERIA_ID)).toBe(false);
  });

  test("reads nothing from steps that are missing or malformed", () => {
    expect(getCriteriaStatusIds(undefined).size).toBe(0);
    expect(
      getCriteriaStatusIds({
        data: { monitorStepsInstanceArray: [null, { data: {} }, "x"] },
      } as unknown as MonitorSteps).size,
    ).toBe(0);
  });
});

function criteriaResult(
  overrides: Partial<MonitorEvaluationCriteriaResult>,
): MonitorEvaluationCriteriaResult {
  return {
    criteriaId: DOWN_CRITERIA_ID,
    criteriaName: "Website is down",
    filterCondition: FilterCondition.Any,
    met: true,
    message: "Response Status Code was 503, at or above the 500 threshold.",
    filters: [
      {
        checkOn: CheckOn.ResponseStatusCode,
        message: statusCodeFinding(503).message,
        messageSentence: statusCodeFinding(503)
          .messageSentence as EvaluationSentence,
        met: true,
      },
    ],
    ...overrides,
  };
}

function summaryOf(
  results: Array<MonitorEvaluationCriteriaResult>,
): MonitorEvaluationSummary {
  return {
    evaluatedAt: new Date("2026-11-19T10:00:00.000Z"),
    criteriaResults: results,
    events: [],
  };
}

describe("the criteria that owns the status", () => {
  test("is the first met and not skipped", () => {
    expect(
      getMatchedCriteria(
        summaryOf([
          criteriaResult({ criteriaId: "a", met: false }),
          criteriaResult({ criteriaId: "b", met: true, skipped: true }),
          criteriaResult({ criteriaId: "c", met: true }),
          criteriaResult({ criteriaId: "d", met: true }),
        ]),
      )?.criteriaId,
    ).toBe("c");
  });

  test("is none when nothing matched", () => {
    expect(
      getMatchedCriteria(summaryOf([criteriaResult({ met: false })])),
    ).toBeNull();
    expect(getMatchedCriteria(undefined)).toBeNull();
  });
});

describe("the findings an evaluation can word", () => {
  test("come from the newest evaluation and each probe's, each once", () => {
    const evaluation: MonitorEvaluationByProbe = {
      latest: {
        summary: summaryOf([criteriaResult({})]),
        at: new Date(),
      },
      byProbeId: {
        london: summaryOf([criteriaResult({})]),
        tokyo: summaryOf([
          criteriaResult({
            filters: [
              {
                checkOn: CheckOn.ResponseTime,
                message: "Response Time was 2,400 ms.",
                met: true,
              },
            ],
          }),
        ]),
      },
    };

    expect(
      getEvaluationFindings(evaluation).map(
        (finding: RootCauseFinding): string => {
          return finding.message;
        },
      ),
    ).toEqual([
      "Response Status Code was 503, at or above the 500 threshold.",
      "Response Time was 2,400 ms.",
    ]);
    expect(getEvaluationFindings(null)).toEqual([]);
  });
});

const NOW: Date = new Date("2026-11-19T10:00:00.000Z");

function probeRow(
  overrides: Partial<MonitorOverviewProbeRow>,
): MonitorOverviewProbeRow {
  return {
    probeId: "london",
    name: "London",
    isEnabled: true,
    isConnected: true,
    health: MonitorOverviewProbeHealth.Down,
    latestResult: {
      probeId: "london",
      monitoredAt: NOW,
      isOnline: false,
      responseTimeInMs: 411,
      responseCode: 503,
      failureCause: "Server returned 503",
    },
    ...overrides,
  };
}

function probeSummary(
  rows: Array<MonitorOverviewProbeRow>,
): MonitorOverviewProbeSummary {
  return {
    rows: rows,
    attachedCount: rows.length,
    enabledCount: rows.length,
    reportingCount: rows.length,
    disabledCount: 0,
    disconnectedCount: 0,
    responseTime: null,
  };
}

function behind(data: {
  rows: Array<MonitorOverviewProbeRow>;
  byProbeId?: Record<string, MonitorEvaluationSummary> | undefined;
  statusId?: string | undefined;
  isOfflineState?: boolean | undefined;
}): Array<MonitorStatusProbe> {
  return getProbesBehindStatus({
    probes: probeSummary(data.rows),
    evaluation: data.byProbeId ? { byProbeId: data.byProbeId } : null,
    monitorSteps: steps(),
    statusId: data.statusId ?? OFFLINE_ID,
    isOfflineState: data.isOfflineState ?? true,
    translator: GERMAN,
  });
}

describe("the probes that see the monitor in its status", () => {
  test("are the probes whose newest check matched a criteria that sets it", () => {
    const probes: Array<MonitorStatusProbe> = behind({
      rows: [
        probeRow({}),
        probeRow({
          probeId: "tokyo",
          name: "Tokyo",
          health: MonitorOverviewProbeHealth.Up,
          latestResult: { probeId: "tokyo", isOnline: true, monitoredAt: NOW },
        }),
      ],
      byProbeId: {
        london: summaryOf([criteriaResult({})]),
        tokyo: summaryOf([
          criteriaResult({ criteriaId: ONLINE_CRITERIA_ID, met: true }),
        ]),
      },
    });

    expect(
      probes.map((probe: MonitorStatusProbe): string => {
        return probe.row.name;
      }),
    ).toEqual(["London"]);
    expect(probes[0]?.criteriaName).toBe("Website is down");
    expect(probes[0]?.findings.map(plain)).toEqual([
      "Der Antwortstatuscode war 503, auf oder über der Schwelle von 500.",
    ]);
  });

  test("a probe that is up but matched a slow-response criteria holds Degraded", () => {
    const probes: Array<MonitorStatusProbe> = behind({
      rows: [
        probeRow({
          health: MonitorOverviewProbeHealth.Up,
          latestResult: { probeId: "london", isOnline: true, monitoredAt: NOW },
        }),
      ],
      byProbeId: {
        london: summaryOf([
          criteriaResult({
            criteriaId: SLOW_CRITERIA_ID,
            criteriaName: "Slow",
            filters: [],
          }),
        ]),
      },
      statusId: DEGRADED_ID,
      isOfflineState: false,
    });

    expect(probes).toHaveLength(1);
    expect(probes[0]?.criteriaName).toBe("Slow");
  });

  test("without its evaluation, a probe that is down holds an offline status", () => {
    expect(behind({ rows: [probeRow({})] })).toHaveLength(1);
    expect(behind({ rows: [probeRow({})], isOfflineState: false })).toEqual([]);
  });

  test("a disabled probe, one with no result and one not reporting are left out", () => {
    expect(
      behind({
        rows: [
          probeRow({ isEnabled: false }),
          probeRow({ probeId: "a", latestResult: undefined }),
          probeRow({
            probeId: "b",
            health: MonitorOverviewProbeHealth.Disconnected,
          }),
          probeRow({ probeId: "c", health: MonitorOverviewProbeHealth.Late }),
        ],
      }),
    ).toEqual([]);
  });

  test("lists a probe that sees it down before one that only matched, then by name", () => {
    const probes: Array<MonitorStatusProbe> = behind({
      rows: [
        probeRow({
          probeId: "tokyo",
          name: "Tokyo",
          health: MonitorOverviewProbeHealth.Up,
          latestResult: { probeId: "tokyo", isOnline: true, monitoredAt: NOW },
        }),
        probeRow({ probeId: "paris-10", name: "Paris 10" }),
        probeRow({ probeId: "paris-2", name: "Paris 2" }),
      ],
      byProbeId: {
        tokyo: summaryOf([criteriaResult({})]),
        "paris-10": summaryOf([criteriaResult({})]),
        "paris-2": summaryOf([criteriaResult({})]),
      },
    });

    expect(
      probes.map((probe: MonitorStatusProbe): string => {
        return probe.row.name;
      }),
    ).toEqual(["Paris 2", "Paris 10", "Tokyo"]);
  });

  test("nothing is behind a status with no probes or no id", () => {
    expect(
      getProbesBehindStatus({
        probes: null,
        evaluation: null,
        monitorSteps: steps(),
        statusId: OFFLINE_ID,
        isOfflineState: true,
        translator: ENGLISH,
      }),
    ).toEqual([]);
    expect(behind({ rows: [probeRow({})], statusId: "" })).toEqual([]);
  });
});
