import {
  averagePerHour,
  computeSharePercent,
  filterProjects,
  formatBytes,
  formatCompactCount,
  formatCount,
  formatPercent,
  getSignalCounts,
  parseProjectIngestion,
  parseSignalIngestion,
  projectDisplayName,
  sortProjects,
  sumOrNull,
  summarizeProjects,
  TELEMETRY_SIGNAL_ORDER,
  TelemetryProjectIngestionView,
  TelemetryProjectRow,
  TelemetryProjectSummary,
  TelemetrySignalIngestionView,
  TelemetrySortColumn,
  TelemetrySortDirection,
  toCountOrNull,
} from "../../FeatureSet/AdminDashboard/src/Pages/Health/TelemetryIngestionUtils";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The view model behind Instance Health > Diagnostics > Telemetry.
 *
 * The page is read during incidents — an ingest spike, a tenant that went quiet,
 * a capacity conversation — so the rules that decide what an operator SEES are
 * the ones worth pinning:
 *
 *   - a count we could not read must render "—", never "0". "0 traces" is read
 *     as "this tenant stopped sending traces"; that is a different incident from
 *     "we could not measure", and acting on the wrong one wastes an outage.
 *   - the ordering must be total, stable and null-last, or the table reshuffles
 *     under the cursor between polls.
 *   - the share bar must never produce NaN/Infinity width, which breaks the
 *     layout of every row beneath it.
 */

function project(data: {
  projectId: string;
  projectName?: string | null | undefined;
  logs?: number | null | undefined;
  metrics?: number | null | undefined;
  traces?: number | null | undefined;
  lastHour?: number | null | undefined;
  lastMinute?: number | null | undefined;
}): TelemetryProjectRow {
  const logs: number | null = data.logs === undefined ? 0 : data.logs;
  const metrics: number | null = data.metrics === undefined ? 0 : data.metrics;
  const traces: number | null = data.traces === undefined ? 0 : data.traces;

  return {
    projectId: data.projectId,
    projectName: data.projectName === undefined ? null : data.projectName,
    signals: [
      {
        telemetryType: "Logs",
        lastMinute: null,
        lastHour: null,
        lastDay: logs,
      },
      {
        telemetryType: "Metrics",
        lastMinute: null,
        lastHour: null,
        lastDay: metrics,
      },
      {
        telemetryType: "Traces",
        lastMinute: null,
        lastHour: null,
        lastDay: traces,
      },
    ],
    lastMinute: data.lastMinute === undefined ? 0 : data.lastMinute,
    lastHour: data.lastHour === undefined ? 0 : data.lastHour,
    lastDay: sumOrNull([logs, metrics, traces]),
  };
}

function idsOf(projects: Array<TelemetryProjectRow>): Array<string> {
  return projects.map((row: TelemetryProjectRow): string => {
    return row.projectId;
  });
}

describe("signal ordering", () => {
  /*
   * The tiles, the table headers and the per-row cells all read this list. If
   * they ever iterated their own copies, a column header could end up over the
   * wrong signal's numbers.
   */
  test("is the same three signals the API returns, in one place", () => {
    expect(TELEMETRY_SIGNAL_ORDER).toEqual(["Logs", "Metrics", "Traces"]);
  });
});

describe("toCountOrNull", () => {
  test("reads the stringified counts the API returns", () => {
    expect(toCountOrNull("1500")).toBe(1500);
    expect(toCountOrNull(12)).toBe(12);
    expect(toCountOrNull(0)).toBe(0);
  });

  test("keeps an unreadable count unknown rather than calling it zero", () => {
    expect(toCountOrNull(null)).toBeNull();
    expect(toCountOrNull(undefined)).toBeNull();
    expect(toCountOrNull("")).toBeNull();
    expect(toCountOrNull("n/a")).toBeNull();
    expect(toCountOrNull({})).toBeNull();
  });
});

describe("sumOrNull", () => {
  test("adds what it knows and keeps a real zero", () => {
    expect(sumOrNull([1, 2])).toBe(3);
    expect(sumOrNull([0, 0])).toBe(0);
  });

  test("totals the known values when some are missing", () => {
    expect(sumOrNull([4, null])).toBe(4);
  });

  test("stays unknown when nothing is known", () => {
    expect(sumOrNull([null, null])).toBeNull();
    expect(sumOrNull([])).toBeNull();
  });
});

describe("parseSignalIngestion", () => {
  const view: TelemetrySignalIngestionView = parseSignalIngestion({
    connected: true,
    tables: [
      {
        telemetryType: "Logs",
        table: "LogItemV3",
        lastMinute: "10",
        lastHour: "600",
        lastDay: "14400",
        uncompressedBytes: "1024",
        available: true,
      },
      {
        telemetryType: "Traces",
        table: "SpanItemV3",
        lastMinute: null,
        lastHour: null,
        lastDay: null,
        uncompressedBytes: null,
        available: false,
      },
    ],
  } as unknown as JSONObject);

  test("reads the counts and the footprint", () => {
    expect(view.connected).toBe(true);
    expect(view.signals[0]!.telemetryType).toBe("Logs");
    expect(view.signals[0]!.lastHour).toBe(600);
    expect(view.signals[0]!.uncompressedBytes).toBe(1024);
  });

  test("keeps an unavailable signal's counts unknown", () => {
    expect(view.signals[1]!.available).toBe(false);
    expect(view.signals[1]!.lastDay).toBeNull();
  });

  /*
   * The page renders before the first response lands, and an error response is
   * not the shape the page expects. Neither may throw on the way to a message.
   */
  test("survives a missing or malformed payload", () => {
    expect(parseSignalIngestion(null).signals).toEqual([]);
    expect(parseSignalIngestion(null).connected).toBe(false);
    expect(
      parseSignalIngestion({ tables: "nope" } as unknown as JSONObject).signals,
    ).toEqual([]);
  });
});

describe("parseProjectIngestion", () => {
  const view: TelemetryProjectIngestionView = parseProjectIngestion({
    connected: true,
    truncated: true,
    maxProjectsPerSignal: 500,
    signals: [
      { telemetryType: "Logs", available: true, truncated: true },
      { telemetryType: "Metrics", available: true, truncated: false },
      { telemetryType: "Traces", available: false, truncated: false },
    ],
    projects: [
      {
        projectId: "p1",
        projectName: "Acme",
        lastMinute: "1",
        lastHour: "60",
        lastDay: "1440",
        signals: [
          {
            telemetryType: "Logs",
            lastMinute: "1",
            lastHour: "60",
            lastDay: "1440",
          },
          {
            telemetryType: "Traces",
            lastMinute: null,
            lastHour: null,
            lastDay: null,
          },
        ],
      },
      {
        projectId: "p2",
        projectName: null,
        lastMinute: "0",
        lastHour: "0",
        lastDay: "3",
        signals: [],
      },
    ],
  } as unknown as JSONObject);

  test("reads the per-project counts", () => {
    expect(view.projects).toHaveLength(2);
    expect(view.projects[0]!.projectName).toBe("Acme");
    expect(view.projects[0]!.lastDay).toBe(1440);
  });

  test("carries the per-signal breakdown, unknowns included", () => {
    expect(getSignalCounts(view.projects[0]!, "Logs").lastDay).toBe(1440);
    expect(getSignalCounts(view.projects[0]!, "Traces").lastDay).toBeNull();
  });

  /*
   * A signal the server could not read is called out in the UI so the dashes in
   * that column are explained rather than looking like a tenant going silent.
   */
  test("names the signals the server could not read", () => {
    expect(view.unavailableSignals).toEqual(["Traces"]);
  });

  test("carries the truncation flag and its cap", () => {
    expect(view.truncated).toBe(true);
    expect(view.maxProjectsPerSignal).toBe(500);
  });

  // An empty-string name from the API is not a name.
  test("treats a blank project name as unresolved", () => {
    const blank: TelemetryProjectIngestionView = parseProjectIngestion({
      connected: true,
      projects: [{ projectId: "p", projectName: "", signals: [] }],
    } as unknown as JSONObject);

    expect(blank.projects[0]!.projectName).toBeNull();
  });

  test("survives a missing or malformed payload", () => {
    expect(parseProjectIngestion(null).projects).toEqual([]);
    expect(parseProjectIngestion(null).connected).toBe(false);
    expect(parseProjectIngestion(null).unavailableSignals).toEqual([]);
    expect(
      parseProjectIngestion({ projects: 5 } as unknown as JSONObject).projects,
    ).toEqual([]);
  });
});

describe("getSignalCounts", () => {
  test("finds a signal the project reported", () => {
    expect(
      getSignalCounts(project({ projectId: "p", logs: 7 }), "Logs").lastDay,
    ).toBe(7);
  });

  /*
   * A signal absent from the row is not a zero — the row simply does not carry
   * it, and the cell has to say so.
   */
  test("returns unknown for a signal the project does not carry", () => {
    expect(
      getSignalCounts(project({ projectId: "p" }), "Profiles").lastDay,
    ).toBeNull();
  });
});

describe("projectDisplayName", () => {
  test("uses the project name when there is one", () => {
    expect(
      projectDisplayName(project({ projectId: "p", projectName: "Acme" })),
    ).toBe("Acme");
  });

  /*
   * Telemetry outlives its project: retention keeps rows for days after the
   * project is deleted. That volume is real, so the row is labelled by id
   * instead of being dropped from a total it still contributes to.
   */
  test("falls back to the id for a project that no longer resolves", () => {
    expect(projectDisplayName(project({ projectId: "abc123" }))).toContain(
      "abc123",
    );
  });
});

describe("filterProjects", () => {
  const projects: Array<TelemetryProjectRow> = [
    project({ projectId: "aaa", projectName: "Acme Corp" }),
    project({ projectId: "bbb", projectName: "Globex" }),
    project({ projectId: "ccc" }),
  ];

  test("matches on the project name, case-insensitively", () => {
    expect(idsOf(filterProjects(projects, "acme"))).toEqual(["aaa"]);
    expect(idsOf(filterProjects(projects, "GLOBEX"))).toEqual(["bbb"]);
  });

  /*
   * Project ids are what appear in logs and support tickets, so pasting one in
   * has to find its row — including for a project with no name left.
   */
  test("matches on the project id", () => {
    expect(idsOf(filterProjects(projects, "ccc"))).toEqual(["ccc"]);
  });

  test("an empty or whitespace filter shows everything", () => {
    expect(filterProjects(projects, "")).toHaveLength(3);
    expect(filterProjects(projects, "   ")).toHaveLength(3);
  });

  test("a filter that matches nothing returns nothing", () => {
    expect(filterProjects(projects, "zzz")).toEqual([]);
  });

  test("does not mutate the list it was given", () => {
    filterProjects(projects, "acme");
    expect(idsOf(projects)).toEqual(["aaa", "bbb", "ccc"]);
  });
});

describe("sortProjects", () => {
  const projects: Array<TelemetryProjectRow> = [
    project({ projectId: "small", projectName: "Small", logs: 5 }),
    project({ projectId: "big", projectName: "Big", logs: 900 }),
    project({ projectId: "mid", projectName: "Mid", logs: 40 }),
  ];

  test("sorts by total descending by default use", () => {
    expect(
      idsOf(
        sortProjects({
          projects,
          column: TelemetrySortColumn.Total,
          direction: TelemetrySortDirection.Descending,
        }),
      ),
    ).toEqual(["big", "mid", "small"]);
  });

  test("sorts by total ascending", () => {
    expect(
      idsOf(
        sortProjects({
          projects,
          column: TelemetrySortColumn.Total,
          direction: TelemetrySortDirection.Ascending,
        }),
      ),
    ).toEqual(["small", "mid", "big"]);
  });

  /*
   * The three signal columns show the 24-hour figure, so clicking one has to
   * order by THAT signal's day count — not by the row total, which would look
   * almost right on most instances and be wrong on the one that matters.
   */
  test("sorts by one signal's own 24-hour count", () => {
    const bySignal: Array<TelemetryProjectRow> = [
      project({ projectId: "a", logs: 100, traces: 1 }),
      project({ projectId: "b", logs: 1, traces: 100 }),
    ];

    expect(
      idsOf(
        sortProjects({
          projects: bySignal,
          column: TelemetrySortColumn.Total,
          signalColumn: "Traces",
          direction: TelemetrySortDirection.Descending,
        }),
      ),
    ).toEqual(["b", "a"]);
  });

  test("sorts by the hour and minute windows", () => {
    const windows: Array<TelemetryProjectRow> = [
      project({ projectId: "a", lastHour: 1, lastMinute: 9 }),
      project({ projectId: "b", lastHour: 9, lastMinute: 1 }),
    ];

    expect(
      idsOf(
        sortProjects({
          projects: windows,
          column: TelemetrySortColumn.LastHour,
          direction: TelemetrySortDirection.Descending,
        }),
      ),
    ).toEqual(["b", "a"]);
    expect(
      idsOf(
        sortProjects({
          projects: windows,
          column: TelemetrySortColumn.LastMinute,
          direction: TelemetrySortDirection.Descending,
        }),
      ),
    ).toEqual(["a", "b"]);
  });

  test("sorts by project label", () => {
    expect(
      idsOf(
        sortProjects({
          projects,
          column: TelemetrySortColumn.Project,
          direction: TelemetrySortDirection.Ascending,
        }),
      ),
    ).toEqual(["big", "mid", "small"]);
  });

  /*
   * Ascending by traces is how an operator looks for tenants that stopped
   * sending them. A row we could not measure is not an answer to that question,
   * so unknowns sink in BOTH directions rather than heading the ascending list.
   */
  test("unknown counts sink to the bottom in both directions", () => {
    const withUnknown: Array<TelemetryProjectRow> = [
      project({ projectId: "unknown", traces: null }),
      project({ projectId: "quiet", traces: 0 }),
      project({ projectId: "busy", traces: 50 }),
    ];

    expect(
      idsOf(
        sortProjects({
          projects: withUnknown,
          column: TelemetrySortColumn.Total,
          signalColumn: "Traces",
          direction: TelemetrySortDirection.Ascending,
        }),
      ),
    ).toEqual(["quiet", "busy", "unknown"]);

    expect(
      idsOf(
        sortProjects({
          projects: withUnknown,
          column: TelemetrySortColumn.Total,
          signalColumn: "Traces",
          direction: TelemetrySortDirection.Descending,
        }),
      ),
    ).toEqual(["busy", "quiet", "unknown"]);
  });

  /*
   * The page polls. Two tenants with identical volumes swapping places on every
   * refresh makes the table unusable, so the id is a total tie-break.
   */
  test("ties break on project id, so the order is stable between refreshes", () => {
    const tied: Array<TelemetryProjectRow> = [
      project({ projectId: "b", logs: 10 }),
      project({ projectId: "a", logs: 10 }),
      project({ projectId: "c", logs: 10 }),
    ];

    expect(
      idsOf(
        sortProjects({
          projects: tied,
          column: TelemetrySortColumn.Total,
          direction: TelemetrySortDirection.Descending,
        }),
      ),
    ).toEqual(["a", "b", "c"]);
    expect(
      idsOf(
        sortProjects({
          projects: tied,
          column: TelemetrySortColumn.Total,
          direction: TelemetrySortDirection.Ascending,
        }),
      ),
    ).toEqual(["a", "b", "c"]);
  });

  test("does not mutate the list it was given", () => {
    sortProjects({
      projects,
      column: TelemetrySortColumn.Total,
      direction: TelemetrySortDirection.Ascending,
    });

    expect(idsOf(projects)).toEqual(["small", "big", "mid"]);
  });
});

describe("summarizeProjects", () => {
  const summary: TelemetryProjectSummary = summarizeProjects([
    project({
      projectId: "a",
      projectName: "Acme",
      logs: 100,
      metrics: 10,
      traces: 1,
      lastHour: 11,
      lastMinute: 2,
    }),
    project({
      projectId: "b",
      projectName: "Globex",
      logs: 200,
      metrics: 20,
      traces: 2,
      lastHour: 22,
      lastMinute: 3,
    }),
  ]);

  test("counts the projects and totals every window", () => {
    expect(summary.projectCount).toBe(2);
    expect(summary.lastDay).toBe(333);
    expect(summary.lastHour).toBe(33);
    expect(summary.lastMinute).toBe(5);
  });

  test("totals each signal across every project", () => {
    expect(
      summary.byTelemetryType.map(
        (signal: {
          telemetryType: string;
          lastDay: number | null;
        }): unknown => {
          return [signal.telemetryType, signal.lastDay];
        },
      ),
    ).toEqual([
      ["Logs", 300],
      ["Metrics", 30],
      ["Traces", 3],
    ]);
  });

  test("names the loudest tenant", () => {
    expect(summary.topProject?.projectId).toBe("b");
  });

  /*
   * The headline is what an operator reads first. A signal the server could not
   * measure must not be quietly counted as zero there either.
   */
  test("a signal nobody could measure stays unknown in the totals", () => {
    const unknown: TelemetryProjectSummary = summarizeProjects([
      project({ projectId: "a", logs: 5, traces: null }),
    ]);

    expect(
      unknown.byTelemetryType.find(
        (signal: { telemetryType: string }): boolean => {
          return signal.telemetryType === "Traces";
        },
      )?.lastDay,
    ).toBeNull();
  });

  test("an instance with no ingestion summarises to nothing, not to a crash", () => {
    const empty: TelemetryProjectSummary = summarizeProjects([]);

    expect(empty.projectCount).toBe(0);
    expect(empty.lastDay).toBeNull();
    expect(empty.topProject).toBeNull();
  });

  // "Top: <a project that sent nothing>" is noise, not information.
  test("no project is called the top one when none ingested anything", () => {
    expect(
      summarizeProjects([project({ projectId: "a" })]).topProject,
    ).toBeNull();
  });
});

describe("computeSharePercent", () => {
  test("is the fraction of the total, as a percentage", () => {
    expect(computeSharePercent(25, 100)).toBe(25);
    expect(computeSharePercent(1, 3)).toBeCloseTo(33.33, 1);
  });

  /*
   * The result is written straight into `style={{ width: `${percent}%` }}`. NaN
   * or Infinity there breaks the layout of the whole row, so every degenerate
   * input has to come out as a number between 0 and 100.
   */
  test("never produces NaN, Infinity or a negative width", () => {
    expect(computeSharePercent(5, 0)).toBe(0);
    expect(computeSharePercent(5, null)).toBe(0);
    expect(computeSharePercent(null, 100)).toBe(0);
    expect(computeSharePercent(null, null)).toBe(0);
    expect(computeSharePercent(-5, 100)).toBe(0);
  });

  // Rounding in the API can leave a part fractionally over its own total.
  test("clamps at 100", () => {
    expect(computeSharePercent(150, 100)).toBe(100);
  });
});

describe("formatCount", () => {
  test("groups digits so a nine-figure count is readable", () => {
    expect(formatCount(1234567)).toBe((1234567).toLocaleString());
  });

  test("shows a real zero as zero", () => {
    expect(formatCount(0)).toBe("0");
  });

  // The whole point: unknown is a dash, never a zero.
  test("shows an unknown count as a dash", () => {
    expect(formatCount(null)).toBe("—");
  });
});

describe("formatCompactCount", () => {
  test("leaves small numbers alone", () => {
    expect(formatCompactCount(0)).toBe("0");
    expect(formatCompactCount(999)).toBe("999");
  });

  test("shortens large numbers so the tiles never wrap", () => {
    expect(formatCompactCount(1000)).toBe("1.0K");
    expect(formatCompactCount(15400)).toBe("15K");
    expect(formatCompactCount(2_500_000)).toBe("2.5M");
    expect(formatCompactCount(3_200_000_000)).toBe("3.2B");
  });

  test("shows an unknown count as a dash", () => {
    expect(formatCompactCount(null)).toBe("—");
  });
});

describe("formatBytes", () => {
  test("picks the unit that fits", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });

  test("shows an unknown size as a dash", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(NaN)).toBe("—");
  });
});

describe("averagePerHour", () => {
  test("smooths the day into an hourly rate", () => {
    expect(averagePerHour(2400)).toBe(100);
  });

  test("stays unknown when the day is unknown", () => {
    expect(averagePerHour(null)).toBeNull();
  });
});

describe("formatPercent", () => {
  test("rounds to whole percents", () => {
    expect(formatPercent(33.4)).toBe("33%");
    expect(formatPercent(100)).toBe("100%");
  });

  /*
   * A tenant with a real but tiny share must not read as "0%" — that is the
   * cell an operator uses to decide a project is idle.
   */
  test("distinguishes a tiny share from none at all", () => {
    expect(formatPercent(0.2)).toBe("<1%");
    expect(formatPercent(0)).toBe("0%");
  });

  test("never renders NaN", () => {
    expect(formatPercent(NaN)).toBe("0%");
  });
});
