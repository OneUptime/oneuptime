import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { AIChatCitationTargetType } from "Common/Types/AI/AIChatTypes";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Timezone from "Common/Types/Timezone";
import {
  EvidenceToolDescription,
  FormattedEvidenceArgument,
  describeCitationTargetPage,
  describeEvidenceTool,
  formatEvidenceArguments,
  formatEvidenceDateTime,
  formatEvidenceDuration,
  formatEvidenceLabel,
  formatEvidenceTimeWindow,
  formatRowCount,
  getEvidenceEmptyRowsMessage,
  shortenIdentifier,
  toTitleCaseLabel,
} from "../../FeatureSet/Dashboard/src/Utils/InvestigationEvidenceFormat";

/*
 * The "Evidence checked" list turns raw tool calls into sentences a responder
 * can scan. Every read tool an investigation can cite is pinned here, together
 * with the argument formatting, so a new tool or argument shows up as a test
 * change rather than as `query_foo {"bar":1}` in front of a paged engineer.
 */

// Every read tool that can mint a citation in an investigation (ai-data-flow §1).
const INVESTIGATION_READ_TOOLS: Array<[string, string, IconProp, string]> = [
  ["lookup_context", "Looked up telemetry context", IconProp.Search, "Context"],
  ["query_incidents", "Searched incidents", IconProp.Alert, "Incidents"],
  ["search_incidents", "Searched past incidents", IconProp.Alert, "Incidents"],
  [
    "get_incident_timeline",
    "Read an incident timeline",
    IconProp.List,
    "Incidents",
  ],
  ["get_alert_timeline", "Read an alert timeline", IconProp.List, "Alerts"],
  ["query_alerts", "Searched alerts", IconProp.Bell, "Alerts"],
  ["query_monitors", "Checked monitors", IconProp.Cube, "Monitors"],
  [
    "query_scheduled_maintenance",
    "Checked scheduled maintenance",
    IconProp.Clock,
    "Scheduled maintenance",
  ],
  [
    "query_on_call_policies",
    "Checked on-call policies",
    IconProp.Call,
    "On-call",
  ],
  ["get_on_call_status", "Checked who is on call", IconProp.Call, "On-call"],
  ["query_on_call_pages", "Checked on-call pages", IconProp.Call, "On-call"],
  [
    "query_status_pages",
    "Checked status pages",
    IconProp.CheckCircle,
    "Status pages",
  ],
  [
    "query_status_page_announcements",
    "Checked status page announcements",
    IconProp.CheckCircle,
    "Status pages",
  ],
  ["query_slos", "Checked SLOs", IconProp.ArrowTrendingUp, "SLOs"],
  ["query_runbooks", "Checked runbooks", IconProp.Book, "Runbooks"],
  ["query_workflows", "Checked workflows", IconProp.Workflow, "Workflows"],
  ["query_probes", "Checked probes", IconProp.Signal, "Probes"],
  ["query_teams", "Checked teams", IconProp.Team, "Teams"],
  [
    "query_ai_insights",
    "Checked AI insights",
    IconProp.Sparkles,
    "AI insights",
  ],
  ["top_exceptions", "Listed top exceptions", IconProp.Error, "Exceptions"],
  ["search_logs", "Searched logs", IconProp.Logs, "Logs"],
  ["log_histogram", "Charted log volume", IconProp.ChartBar, "Logs"],
  [
    "search_security_events",
    "Searched security events",
    IconProp.ShieldExclamation,
    "Security",
  ],
  [
    "security_event_summary",
    "Summarised security events",
    IconProp.ShieldExclamation,
    "Security",
  ],
  ["query_metrics", "Queried a metric", IconProp.ChartBar, "Metrics"],
  [
    "baseline_anomaly",
    "Compared a metric with its baseline",
    IconProp.ArrowTrendingUp,
    "Metrics",
  ],
  ["query_traces", "Analysed traces", IconProp.Activity, "Traces"],
  ["get_trace", "Opened a trace", IconProp.Activity, "Traces"],
  ["recent_changes", "Checked recent changes", IconProp.Bolt, "Changes"],
  ["list_code_repositories", "Listed code repositories", IconProp.Code, "Code"],
  [
    "find_code_for_exception",
    "Located the code behind an exception",
    IconProp.Code,
    "Code",
  ],
  ["search_code", "Searched code", IconProp.Code, "Code"],
  ["read_code_file", "Read a code file", IconProp.DocumentText, "Code"],
];

function argumentsFor(
  toolName: string,
  args: Record<string, unknown>,
): Array<FormattedEvidenceArgument> {
  return formatEvidenceArguments(
    toolName,
    args as Parameters<typeof formatEvidenceArguments>[1],
  );
}

function valueOf(
  rows: Array<FormattedEvidenceArgument>,
  label: string,
): string | undefined {
  return rows.find((row: FormattedEvidenceArgument): boolean => {
    return row.label === label;
  })?.value;
}

describe("describeEvidenceTool", () => {
  test.each(INVESTIGATION_READ_TOOLS)(
    "%s reads as a plain-language step",
    (
      toolName: string,
      description: string,
      icon: IconProp,
      category: string,
    ) => {
      expect(describeEvidenceTool(toolName)).toEqual({
        description,
        icon,
        category,
      });
    },
  );

  test("every described tool has a non-empty description, icon and category", () => {
    for (const [toolName] of INVESTIGATION_READ_TOOLS) {
      const described: EvidenceToolDescription = describeEvidenceTool(toolName);
      expect(described.description.length).toBeGreaterThan(0);
      expect(Object.values(IconProp)).toContain(described.icon);
      expect(described.category).not.toBe("Other");
    }
  });

  test("covers remediation and mutation tools a run could have recorded", () => {
    expect(describeEvidenceTool("execute_remediation_command")).toEqual(
      expect.objectContaining({
        description: "Ran a remediation command",
        category: "Remediation",
      }),
    );
    expect(describeEvidenceTool("acknowledge_incident").description).toBe(
      "Acknowledged an incident",
    );
    expect(describeEvidenceTool("resolve_alert").description).toBe(
      "Resolved an alert",
    );
    expect(describeEvidenceTool("get_ai_investigation").description).toBe(
      "Read an AI investigation",
    );
  });

  test("matches tool names case-insensitively and ignores surrounding space", () => {
    expect(describeEvidenceTool("  SEARCH_LOGS ").description).toBe(
      "Searched logs",
    );
  });

  test("falls back to a humanised name for an unknown tool", () => {
    expect(describeEvidenceTool("query_kubernetes_pods")).toEqual({
      description: "Ran query kubernetes pods",
      icon: IconProp.Database,
      category: "Other",
    });
    expect(describeEvidenceTool("fetchDeployHistory").description).toBe(
      "Ran fetch deploy history",
    );
  });

  test("falls back safely for empty, missing and junk tool names", () => {
    expect(describeEvidenceTool("").description).toBe("Ran a telemetry query");
    expect(describeEvidenceTool(undefined).description).toBe(
      "Ran a telemetry query",
    );
    expect(describeEvidenceTool(null).description).toBe(
      "Ran a telemetry query",
    );
    expect(describeEvidenceTool("___").description).toBe(
      "Ran a telemetry query",
    );
  });

  test("clips a very long unknown tool name", () => {
    const described: EvidenceToolDescription = describeEvidenceTool(
      "x".repeat(500),
    );
    expect(described.description.length).toBeLessThanOrEqual(70);
  });

  test("never resolves prototype members as tools", () => {
    expect(describeEvidenceTool("constructor").category).toBe("Other");
    expect(describeEvidenceTool("__proto__").category).toBe("Other");
  });

  test("returns a copy so callers cannot mutate the shared table", () => {
    const first: EvidenceToolDescription = describeEvidenceTool("search_logs");
    first.description = "mutated";
    expect(describeEvidenceTool("search_logs").description).toBe(
      "Searched logs",
    );
  });
});

describe("describeCitationTargetPage", () => {
  test("names every target type", () => {
    for (const targetType of Object.values(AIChatCitationTargetType)) {
      const page: string = describeCitationTargetPage(targetType);
      expect(page.length).toBeGreaterThan(0);
      expect(page).not.toBe("Dashboard");
    }
  });

  test.each([
    [AIChatCitationTargetType.IncidentView, "Incident"],
    [AIChatCitationTargetType.Incidents, "Incidents"],
    [AIChatCitationTargetType.AlertView, "Alert"],
    [AIChatCitationTargetType.Logs, "Logs"],
    [AIChatCitationTargetType.TraceView, "Trace"],
    [AIChatCitationTargetType.Probes, "Probes"],
    [AIChatCitationTargetType.SecurityEvents, "Security events"],
    [AIChatCitationTargetType.OnCallPolicyView, "On-call policy"],
  ])("%s opens %s", (targetType: AIChatCitationTargetType, page: string) => {
    expect(describeCitationTargetPage(targetType)).toBe(page);
  });

  test("falls back for unknown or missing targets", () => {
    expect(describeCitationTargetPage("Nope")).toBe("Dashboard");
    expect(describeCitationTargetPage(undefined)).toBe("Dashboard");
    expect(describeCitationTargetPage("toString")).toBe("Dashboard");
  });
});

describe("formatRowCount", () => {
  test.each([
    [0, "No rows"],
    [1, "1 row"],
    [2, "2 rows"],
    [7, "7 rows"],
    [1234, "1,234 rows"],
    [1234567, "1,234,567 rows"],
    [2.9, "2 rows"],
    [-3, "No rows"],
    [Number.NaN, "No rows"],
    [Number.POSITIVE_INFINITY, "No rows"],
  ])("formatRowCount(%p) is %p", (count: number, expected: string) => {
    expect(formatRowCount(count)).toBe(expected);
  });

  test("formatRowCount treats a missing count as no rows", () => {
    expect(formatRowCount(undefined)).toBe("No rows");
    expect(formatRowCount(null)).toBe("No rows");
  });
});

describe("getEvidenceEmptyRowsMessage", () => {
  test.each([
    [
      'No monitor status matches "Degraded". Statuses in this project: Operational, Offline.',
    ],
    [
      "Incident 33333333-3333-4333-8333-333333333333 was not found in this project.",
    ],
    ["searchText is required"],
    [
      "(no rows found) — on-call policy not found or not accessible. Find valid ids with query_on_call_policies.",
    ],
    [
      "file: src/pool.ts\nrepository: acme/api@main\n\n(this file is empty — 0 bytes)",
    ],
  ])("keeps the server's explanation %p", (text: string) => {
    expect(getEvidenceEmptyRowsMessage(text)).toBe(text);
  });

  test("trims the surrounding whitespace but keeps inner line breaks", () => {
    expect(getEvidenceEmptyRowsMessage("\n  Not found.\nTry again.  \n")).toBe(
      "Not found.\nTry again.",
    );
  });

  test.each([
    ["[]"],
    ["{}"],
    ["(no rows found)"],
    ["(no data found)"],
    ["(No Rows Found)"],
    ["  []\n"],
    ["\n(no data found)  "],
    [""],
    ["   \n\t"],
  ])("is null for the empty-result placeholder %p", (text: string) => {
    expect(getEvidenceEmptyRowsMessage(text)).toBeNull();
  });

  test("is null without text", () => {
    expect(getEvidenceEmptyRowsMessage(undefined)).toBeNull();
    expect(getEvidenceEmptyRowsMessage(null)).toBeNull();
    expect(getEvidenceEmptyRowsMessage(42 as unknown as string)).toBeNull();
  });
});

describe("formatEvidenceDuration", () => {
  test.each([
    [0, "0 ms"],
    [340, "340 ms"],
    [999.4, "999 ms"],
    [1000, "1 s"],
    [1234, "1.2 s"],
    [59_949, "59.9 s"],
    [59_999, "1 min"],
    [60_000, "1 min"],
    [125_000, "2 min 5 s"],
    [3_600_000, "60 min"],
  ])("%p ms reads as %p", (durationInMs: number, expected: string) => {
    expect(formatEvidenceDuration(durationInMs)).toBe(expected);
  });

  test("is undefined for missing or invalid durations", () => {
    expect(formatEvidenceDuration(undefined)).toBeUndefined();
    expect(formatEvidenceDuration(null)).toBeUndefined();
    expect(formatEvidenceDuration(-1)).toBeUndefined();
    expect(formatEvidenceDuration(Number.NaN)).toBeUndefined();
  });
});

describe("dates", () => {
  const START: string = "2026-09-14T17:20:00.000Z";
  const END: string = "2026-09-14T18:20:00.000Z";

  test("formats an ISO timestamp in the viewer's local time with its zone", () => {
    const expected: string =
      `${OneUptimeDate.getDateAsLocalShortDateTimeString(new Date(START))} ${OneUptimeDate.getLocalZoneAbbr(new Date(START))}`.trim();

    expect(formatEvidenceDateTime(START)).toBe(expected);
    expect(formatEvidenceDateTime(new Date(START))).toBe(expected);
  });

  test("returns null for values that are not ISO timestamps", () => {
    expect(formatEvidenceDateTime("yesterday")).toBeNull();
    expect(formatEvidenceDateTime("12")).toBeNull();
    expect(formatEvidenceDateTime("2026-13-45T99:00:00Z")).toBeNull();
    expect(formatEvidenceDateTime(42)).toBeNull();
    expect(formatEvidenceDateTime(undefined)).toBeNull();
    expect(formatEvidenceDateTime(new Date(Number.NaN))).toBeNull();
  });

  test("a same-day window names the date once", () => {
    const window: string = formatEvidenceTimeWindow(
      new Date(START),
      new Date(END),
    );

    if (OneUptimeDate.areOnTheSameLocalDay(new Date(START), new Date(END))) {
      expect(window).toBe(
        `${OneUptimeDate.getDateAsLocalShortDateTimeString(new Date(START))} – ${OneUptimeDate.getLocalTimeString(
          new Date(END),
          { use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat() },
        )} ${OneUptimeDate.getLocalZoneAbbr(new Date(END))}`.trim(),
      );
    }

    expect(window).toContain(" – ");
  });

  test("a window across days names both dates", () => {
    const start: Date = new Date("2026-09-10T12:00:00.000Z");
    const end: Date = new Date("2026-09-14T12:00:00.000Z");

    expect(formatEvidenceTimeWindow(start, end)).toBe(
      `${OneUptimeDate.getDateAsLocalShortDateTimeString(start)} – ${OneUptimeDate.getDateAsLocalShortDateTimeString(end)} ${OneUptimeDate.getLocalZoneAbbr(end)}`.trim(),
    );
  });
});

/*
 * Citation labels are written by the server with raw `toISOString()` values,
 * which truncate to "Logs 2026-09-14T17:45:00.000Z – 2026-09-…" in a row.
 * The row shows them as compact local times instead. Each test pins the
 * viewer's timezone explicitly, and the clock through the options, so the
 * expectations hold in whatever TZ the suite runs under.
 */
describe("formatEvidenceLabel", () => {
  const H24: { use12HourFormat: boolean } = { use12HourFormat: false };
  const H12: { use12HourFormat: boolean } = { use12HourFormat: true };

  beforeEach(() => {
    OneUptimeDate.setUserTimezone(Timezone.UTC);
  });

  afterEach(() => {
    OneUptimeDate.setUserTimezone(null);
  });

  describe("server labels", () => {
    test.each([
      [
        "Logs 2026-09-14T17:45:00.000Z – 2026-09-14T18:20:00.000Z (50 shown)",
        "Logs Sep 14, 17:45 – 18:20 (50 shown)",
      ],
      [
        "P95(http.server.request.duration), 2026-09-13T18:00:00.000Z – 2026-09-14T18:05:00.000Z",
        "P95(http.server.request.duration), Sep 13, 18:00 – Sep 14, 18:05",
      ],
      [
        "Max(db.client.connections.usage), 2026-09-14T17:00:00.000Z – 2026-09-14T18:05:00.000Z",
        "Max(db.client.connections.usage), Sep 14, 17:00 – 18:05",
      ],
      [
        "Changes 2026-09-13T18:02:00.000Z → 2026-09-14T18:02:00.000Z (3 events)",
        "Changes Sep 13, 18:02 → Sep 14, 18:02 (3 events)",
      ],
      [
        "Log volume by severity, 2026-09-14T17:00:00.000Z – 2026-09-14T18:00:00.000Z",
        "Log volume by severity, Sep 14, 17:00 – 18:00",
      ],
      [
        "Security events 2026-09-14T06:00:00.000Z – 2026-09-14T18:00:00.000Z (12 shown)",
        "Security events Sep 14, 06:00 – 18:00 (12 shown)",
      ],
      [
        "Security event summary 2026-09-07T18:00:00.000Z – 2026-09-14T18:00:00.000Z (sample of 500)",
        "Security event summary Sep 7, 18:00 – Sep 14, 18:00 (sample of 500)",
      ],
    ])("%s reads as %s", (label: string, expected: string) => {
      expect(formatEvidenceLabel(label, H24)).toBe(expected);
    });

    test("uses a 12-hour clock when asked", () => {
      expect(
        formatEvidenceLabel(
          "Logs 2026-09-14T17:45:00.000Z – 2026-09-14T18:20:00.000Z (50 shown)",
          H12,
        ),
      ).toBe("Logs Sep 14, 5:45 PM – 6:20 PM (50 shown)");
      expect(
        formatEvidenceLabel(
          "P95(http.server.request.duration), 2026-09-13T18:00:00.000Z – 2026-09-14T00:05:00.000Z",
          H12,
        ),
      ).toBe(
        "P95(http.server.request.duration), Sep 13, 6:00 PM – Sep 14, 12:05 AM",
      );
    });

    test("follows the viewer's clock preference by default", () => {
      const label: string =
        "Logs 2026-09-14T17:45:00.000Z – 2026-09-14T18:20:00.000Z (50 shown)";

      expect(formatEvidenceLabel(label)).toBe(
        formatEvidenceLabel(label, {
          use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
        }),
      );
      expect(formatEvidenceLabel(label, {})).toBe(formatEvidenceLabel(label));
    });
  });

  describe("single timestamps", () => {
    test("formats a lone timestamp with its date", () => {
      expect(
        formatEvidenceLabel("Anomaly check at 2026-09-14T18:00:00.000Z", H24),
      ).toBe("Anomaly check at Sep 14, 18:00");
    });

    test("formats a timestamp that is the whole label", () => {
      expect(formatEvidenceLabel("2026-09-14T09:05:00.000Z", H24)).toBe(
        "Sep 14, 09:05",
      );
      expect(formatEvidenceLabel("2026-09-14T09:05:00.000Z", H12)).toBe(
        "Sep 14, 9:05 AM",
      );
    });

    test("formats a timestamp inside punctuation", () => {
      expect(
        formatEvidenceLabel("Deploy (2026-09-14T17:52:04.000Z).", H24),
      ).toBe("Deploy (Sep 14, 17:52).");
      expect(formatEvidenceLabel('At "2026-09-14T17:52:04Z"', H24)).toBe(
        'At "Sep 14, 17:52"',
      );
    });

    test.each([
      ["without milliseconds", "2026-09-14T17:45:00Z"],
      ["without seconds", "2026-09-14T17:45Z"],
      ["with one fractional digit", "2026-09-14T17:45:00.5Z"],
      ["with milliseconds", "2026-09-14T17:45:00.123Z"],
      ["with microseconds", "2026-09-14T17:45:00.123456Z"],
      ["with nanoseconds", "2026-09-14T17:45:00.123456789Z"],
      ["with lower-case separators", "2026-09-14t17:45:00.000z"],
    ])("reads a timestamp %s", (_case: string, timestamp: string) => {
      expect(formatEvidenceLabel(`Logs ${timestamp}`, H24)).toBe(
        "Logs Sep 14, 17:45",
      );
    });

    test("never rounds seconds up into the next minute", () => {
      expect(formatEvidenceLabel("2026-09-14T17:45:59.999Z", H24)).toBe(
        "Sep 14, 17:45",
      );
      expect(formatEvidenceLabel("2026-09-14T23:59:59.999999Z", H24)).toBe(
        "Sep 14, 23:59",
      );
    });

    test.each([
      ["+05:30", "2026-09-14T23:15:00+05:30"],
      ["+0530", "2026-09-14T23:15:00+0530"],
      ["-04:00", "2026-09-14T13:45:00-04:00"],
      ["+00:00", "2026-09-14T17:45:00+00:00"],
      ["-00:00", "2026-09-14T17:45:00.000-00:00"],
    ])("honours a %s offset", (_offset: string, timestamp: string) => {
      expect(formatEvidenceLabel(timestamp, H24)).toBe("Sep 14, 17:45");
    });

    test("an offset can move the instant onto another day", () => {
      expect(formatEvidenceLabel("2026-09-15T01:30:00+09:00", H24)).toBe(
        "Sep 14, 16:30",
      );
    });
  });

  describe("ranges", () => {
    test("drops the date from the end of a same-day window", () => {
      expect(
        formatEvidenceLabel(
          "2026-09-14T00:00:00.000Z – 2026-09-14T23:59:00.000Z",
          H24,
        ),
      ).toBe("Sep 14, 00:00 – 23:59");
    });

    test("names both dates when a window crosses midnight", () => {
      expect(
        formatEvidenceLabel(
          "2026-09-14T23:30:00.000Z – 2026-09-15T00:30:00.000Z",
          H24,
        ),
      ).toBe("Sep 14, 23:30 – Sep 15, 00:30");
    });

    test("names both dates across a year boundary", () => {
      expect(
        formatEvidenceLabel(
          "Logs 2025-12-31T23:30:00.000Z – 2026-01-01T00:30:00.000Z (4 shown)",
          H24,
        ),
      ).toBe("Logs Dec 31, 23:30 – Jan 1, 00:30 (4 shown)");
    });

    test("names both dates when the same wall clock is a day apart", () => {
      expect(
        formatEvidenceLabel(
          "2026-09-13T18:00:00.000Z – 2026-09-14T18:00:00.000Z",
          H24,
        ),
      ).toBe("Sep 13, 18:00 – Sep 14, 18:00");
    });

    test.each([
      ["an en dash", " – "],
      ["an em dash", " — "],
      ["an arrow", " → "],
      ["an ASCII arrow", " -> "],
      ["a hyphen", " - "],
      ["a bare en dash", "–"],
      ["a bare arrow", "→"],
      ["the word to", " to "],
      ["wide spacing", "  –  "],
    ])(
      "keeps %s between the two ends exactly as written",
      (_case: string, separator: string) => {
        expect(
          formatEvidenceLabel(
            `Logs 2026-09-14T17:45:00.000Z${separator}2026-09-14T18:20:00.000Z (50 shown)`,
            H24,
          ),
        ).toBe(`Logs Sep 14, 17:45${separator}18:20 (50 shown)`);
      },
    );

    test("a comma or a word between two timestamps is not a window", () => {
      expect(
        formatEvidenceLabel(
          "Restarts at 2026-09-14T17:45:00Z, 2026-09-14T18:20:00Z",
          H24,
        ),
      ).toBe("Restarts at Sep 14, 17:45, Sep 14, 18:20");
      expect(
        formatEvidenceLabel(
          "First 2026-09-14T17:45:00Z and then 2026-09-14T18:20:00Z",
          H24,
        ),
      ).toBe("First Sep 14, 17:45 and then Sep 14, 18:20");
    });

    test("keeps a reversed window's order and wording", () => {
      expect(
        formatEvidenceLabel(
          "2026-09-14T18:20:00.000Z – 2026-09-14T17:45:00.000Z",
          H24,
        ),
      ).toBe("Sep 14, 18:20 – 17:45");
    });

    test("uses a 12-hour clock on both ends of a window", () => {
      expect(
        formatEvidenceLabel(
          "Changes 2026-09-14T11:02:00.000Z → 2026-09-14T13:02:00.000Z (2 events)",
          H12,
        ),
      ).toBe("Changes Sep 14, 11:02 AM → 1:02 PM (2 events)");
    });
  });

  describe("several timestamps", () => {
    test("formats two windows in one label independently", () => {
      expect(
        formatEvidenceLabel(
          "Compared 2026-09-14T17:00:00Z – 2026-09-14T18:00:00Z with 2026-09-07T17:00:00Z – 2026-09-07T18:00:00Z",
          H24,
        ),
      ).toBe("Compared Sep 14, 17:00 – 18:00 with Sep 7, 17:00 – 18:00");
    });

    test("a window followed by a lone timestamp gives the lone one its date", () => {
      expect(
        formatEvidenceLabel(
          "Logs 2026-09-14T17:00:00Z – 2026-09-14T18:00:00Z, deploy 2026-09-14T17:52:00Z",
          H24,
        ),
      ).toBe("Logs Sep 14, 17:00 – 18:00, deploy Sep 14, 17:52");
    });

    test("a chain of three pairs only the first two", () => {
      expect(
        formatEvidenceLabel(
          "2026-09-14T17:00:00Z – 2026-09-14T18:00:00Z – 2026-09-14T19:00:00Z",
          H24,
        ),
      ).toBe("Sep 14, 17:00 – 18:00 – Sep 14, 19:00");
    });

    test("a chain of four makes two windows", () => {
      expect(
        formatEvidenceLabel(
          "2026-09-14T17:00:00Z – 2026-09-14T18:00:00Z – 2026-09-14T19:00:00Z – 2026-09-14T20:00:00Z",
          H24,
        ),
      ).toBe("Sep 14, 17:00 – 18:00 – Sep 14, 19:00 – 20:00");
    });
  });

  describe("labels left untouched", () => {
    test.each([
      ["Active incidents (7 total)"],
      ["Incident #1042 timeline (1 entry)"],
      ["Top exceptions, last 1h (0 found)"],
      ['Incident search "checkout latency" (3 found)'],
      ["Trace 5c1e0b7a9d2f4e6b8a3c1d5e7f9b2a4c (38 spans)"],
      ["Release 2026.09.14-2 of checkout-api"],
      ["Scheduled maintenance, -7d/+3d (2 found)"],
      ["src/pool.ts:40-52 (acme/checkout)"],
      ["A date alone 2026-09-14 and a clock alone 17:45:00"],
      ["Wall clock without a zone 2026-09-14T17:45:00.000"],
      ["Space instead of T 2026-09-14 17:45:00Z"],
      ["Unix time 1757872800"],
      [""],
    ])("%p", (label: string) => {
      expect(formatEvidenceLabel(label, H24)).toBe(label);
      expect(formatEvidenceLabel(label, H12)).toBe(label);
    });

    test.each([
      ["month 13", "2026-13-14T17:45:00Z"],
      ["month 00", "2026-00-14T17:45:00Z"],
      ["day 00", "2026-09-00T17:45:00Z"],
      ["September 31", "2026-09-31T17:45:00Z"],
      ["February 30", "2026-02-30T10:00:00Z"],
      ["February 29 outside a leap year", "2026-02-29T10:00:00Z"],
      [
        "February 29 in a century that is not a leap year",
        "2100-02-29T10:00:00Z",
      ],
      ["hour 24", "2026-09-14T24:00:00Z"],
      ["minute 60", "2026-09-14T17:60:00Z"],
      ["second 60", "2026-09-14T17:45:60Z"],
      ["an offset of 24 hours", "2026-09-14T17:45:00+24:00"],
      ["an offset minute of 60", "2026-09-14T17:45:00+05:60"],
      ["garbage digits", "2026-13-45T99:00:00Z"],
    ])(
      "leaves an impossible timestamp (%s) as written",
      (_case: string, timestamp: string) => {
        const label: string = `Logs ${timestamp} (1 shown)`;

        expect(formatEvidenceLabel(label, H24)).toBe(label);
      },
    );

    test("accepts February 29 in leap years", () => {
      expect(formatEvidenceLabel("2028-02-29T10:00:00Z", H24)).toBe(
        "Feb 29, 10:00",
      );
      expect(formatEvidenceLabel("2000-02-29T10:00:00Z", H24)).toBe(
        "Feb 29, 10:00",
      );
    });

    test("leaves a timestamp glued to a longer token alone", () => {
      const glued: Array<string> = [
        "build2026-09-14T17:45:00Z",
        "2026-09-14T17:45:00Zabc",
        "12026-09-14T17:45:00Z",
        "id_x2026-09-14T17:45:00Z",
      ];

      for (const label of glued) {
        expect(formatEvidenceLabel(label, H24)).toBe(label);
      }
    });

    test("an impossible end leaves the start formatted and the end as written", () => {
      expect(
        formatEvidenceLabel(
          "Logs 2026-09-14T17:45:00Z – 2026-09-14T25:00:00Z",
          H24,
        ),
      ).toBe("Logs Sep 14, 17:45 – 2026-09-14T25:00:00Z");
    });

    test("an impossible start leaves the end with its own date", () => {
      expect(
        formatEvidenceLabel(
          "Logs 2026-02-30T17:45:00Z – 2026-09-14T18:20:00Z",
          H24,
        ),
      ).toBe("Logs 2026-02-30T17:45:00Z – Sep 14, 18:20");
    });

    test("treats a non-string label as empty", () => {
      expect(formatEvidenceLabel(undefined as unknown as string, H24)).toBe("");
      expect(formatEvidenceLabel(null as unknown as string, H24)).toBe("");
    });
  });

  describe("safety and stability", () => {
    test("only the timestamps change, hostile text included", () => {
      const label: string =
        '<img src=x onerror="alert(1)"> 2026-09-14T17:45:00Z [x](https://evil) **bold**';

      expect(formatEvidenceLabel(label, H24)).toBe(
        '<img src=x onerror="alert(1)"> Sep 14, 17:45 [x](https://evil) **bold**',
      );
    });

    test("formatting a formatted label changes nothing", () => {
      const once: string = formatEvidenceLabel(
        "Logs 2026-09-14T17:45:00.000Z – 2026-09-14T18:20:00.000Z (50 shown)",
        H24,
      );

      expect(formatEvidenceLabel(once, H24)).toBe(once);
    });

    test("is stable across repeated calls", () => {
      const label: string =
        "Changes 2026-09-13T18:02:00.000Z → 2026-09-14T18:02:00.000Z (3 events)";

      expect(formatEvidenceLabel(label, H24)).toBe(
        formatEvidenceLabel(label, H24),
      );
    });

    test("handles a very long label with many timestamps", () => {
      const parts: Array<string> = [];

      for (let index: number = 0; index < 200; index++) {
        parts.push("2026-09-14T17:45:00.000Z");
      }

      const formatted: string = formatEvidenceLabel(parts.join(", "), H24);

      expect(formatted.split(", Sep 14, 17:45")).toHaveLength(200);
      expect(formatted).not.toContain("2026-");
    });
  });

  describe("the viewer's timezone", () => {
    test("reads the wall clock in the viewer's zone", () => {
      OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);

      expect(
        formatEvidenceLabel("Deploy at 2026-09-14T17:52:00.000Z", H24),
      ).toBe("Deploy at Sep 14, 23:22");
    });

    test("a window on one UTC day can cross the viewer's midnight", () => {
      OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);

      expect(
        formatEvidenceLabel(
          "Logs 2026-09-14T17:00:00.000Z – 2026-09-14T20:00:00.000Z (9 shown)",
          H24,
        ),
      ).toBe("Logs Sep 14, 22:30 – Sep 15, 01:30 (9 shown)");
    });

    test("a window across two UTC days can sit on one local day", () => {
      OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

      expect(
        formatEvidenceLabel(
          "Changes 2026-09-13T20:00:00.000Z → 2026-09-14T03:00:00.000Z (2 events)",
          H24,
        ),
      ).toBe("Changes Sep 13, 16:00 → 23:00 (2 events)");
    });

    test("an explicit offset names the same instant in every zone", () => {
      OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

      expect(
        formatEvidenceLabel(
          "2026-09-14T23:15:00+05:30 – 2026-09-14T17:45:00Z",
          H24,
        ),
      ).toBe("Sep 14, 13:45 – 13:45");
    });
  });
});

describe("formatEvidenceArguments", () => {
  test("merges a start/end pair into one leading Time window row", () => {
    const rows: Array<FormattedEvidenceArgument> = argumentsFor("search_logs", {
      bodySearchText: "timeout",
      startTime: "2026-09-14T17:20:00.000Z",
      endTime: "2026-09-14T18:20:00.000Z",
      severityTexts: ["Error", "Fatal"],
      limit: 25,
    });

    expect(
      rows.map((row: FormattedEvidenceArgument): string => {
        return row.key;
      }),
    ).toEqual(["timeWindow", "bodySearchText", "severityTexts", "limit"]);
    expect(rows[0]).toEqual({
      key: "timeWindow",
      label: "Time window",
      value: formatEvidenceTimeWindow(
        new Date("2026-09-14T17:20:00.000Z"),
        new Date("2026-09-14T18:20:00.000Z"),
      ),
    });
    expect(valueOf(rows, "Search")).toBe("“timeout”");
    expect(valueOf(rows, "Severity")).toBe("Error, Fatal");
    expect(valueOf(rows, "Limit")).toBe("25");
  });

  test("keeps a lone start or end as From / Until", () => {
    const onlyStart: Array<FormattedEvidenceArgument> = argumentsFor(
      "query_metrics",
      { startTime: "2026-09-14T17:20:00.000Z" },
    );
    expect(onlyStart).toEqual([
      {
        key: "startTime",
        label: "From",
        value: formatEvidenceDateTime("2026-09-14T17:20:00.000Z"),
      },
    ]);

    const onlyEnd: Array<FormattedEvidenceArgument> = argumentsFor(
      "query_metrics",
      { endTime: "2026-09-14T18:20:00.000Z" },
    );
    expect(onlyEnd[0]!.label).toBe("Until");
  });

  test("shows a time argument that is not a timestamp as written", () => {
    const rows: Array<FormattedEvidenceArgument> = argumentsFor("search_logs", {
      startTime: "1h ago",
      endTime: "now",
    });

    expect(rows).toEqual([
      { key: "startTime", label: "From", value: "1h ago" },
      { key: "endTime", label: "Until", value: "now" },
    ]);
  });

  test("formats an incident list query in plain words", () => {
    const rows: Array<FormattedEvidenceArgument> = argumentsFor(
      "query_incidents",
      {
        state: "active",
        createdWithinHours: 24,
        limit: 20,
        skip: 0,
      },
    );

    expect(rows).toEqual([
      { key: "state", label: "State", value: "Active" },
      {
        key: "createdWithinHours",
        label: "Time window",
        value: "Created within the last 24 hours",
      },
      { key: "limit", label: "Limit", value: "20" },
      { key: "skip", label: "Skip", value: "0" },
    ]);
  });

  test("reads a long hour window as whole days", () => {
    expect(
      valueOf(
        argumentsFor("search_incidents", { createdWithinHours: 2160 }),
        "Time window",
      ),
    ).toBe("Created within the last 90 days");
    expect(
      valueOf(
        argumentsFor("top_exceptions", { lastSeenWithinHours: 48 }),
        "Time window",
      ),
    ).toBe("Last seen within the last 2 days");
    expect(
      valueOf(
        argumentsFor("query_incidents", { createdWithinHours: 36 }),
        "Time window",
      ),
    ).toBe("Created within the last 36 hours");
    expect(
      valueOf(
        argumentsFor("query_incidents", { createdWithinHours: 50 }),
        "Time window",
      ),
    ).toBe("Created within the last 50 hours");
  });

  test("uses the singular for one hour or day", () => {
    expect(
      valueOf(
        argumentsFor("query_incidents", { createdWithinHours: 1 }),
        "Time window",
      ),
    ).toBe("Created within the last 1 hour");
    expect(
      valueOf(
        argumentsFor("query_status_page_announcements", { withinDays: 1 }),
        "Time window",
      ),
    ).toBe("Within the last 1 day");
  });

  test("describes the other window arguments", () => {
    expect(
      valueOf(
        argumentsFor("top_exceptions", { lastSeenWithinHours: 6 }),
        "Time window",
      ),
    ).toBe("Last seen within the last 6 hours");
    expect(
      argumentsFor("query_scheduled_maintenance", {
        pastDays: 7,
        upcomingDays: 3,
      }),
    ).toEqual([
      { key: "pastDays", label: "Past", value: "7 days" },
      { key: "upcomingDays", label: "Upcoming", value: "3 days" },
    ]);
    expect(
      valueOf(
        argumentsFor("query_ai_insights", { lookbackDays: 7 }),
        "Looking back",
      ),
    ).toBe("7 days");
    expect(
      valueOf(
        argumentsFor("baseline_anomaly", { windowDays: 14 }),
        "Baseline window",
      ),
    ).toBe("14 days");
  });

  test("formats metric queries", () => {
    const rows: Array<FormattedEvidenceArgument> = argumentsFor(
      "query_metrics",
      {
        metricName: "oneuptime.monitor.response.time",
        aggregationType: "P95",
      },
    );

    expect(rows).toEqual([
      {
        key: "metricName",
        label: "Metric",
        value: "oneuptime.monitor.response.time",
      },
      { key: "aggregationType", label: "Aggregation", value: "P95" },
    ]);
  });

  test("labels and shortens ids", () => {
    const rows: Array<FormattedEvidenceArgument> = argumentsFor(
      "get_incident_timeline",
      {
        incidentId: "33333333-3333-4333-8333-333333333333",
        monitorId: "short-id",
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        serviceId: "44444444-4444-4444-8444-444444444444",
      },
    );

    expect(rows).toEqual([
      { key: "incidentId", label: "Incident", value: "33333333…" },
      { key: "monitorId", label: "Monitor", value: "short-id" },
      { key: "traceId", label: "Trace", value: "4bf92f35…" },
      { key: "serviceId", label: "Service", value: "44444444…" },
    ]);
  });

  test("every search-like argument reads as a quoted Search", () => {
    for (const key of [
      "searchText",
      "nameSearch",
      "bodySearchText",
      "messageSearchText",
      "nameSearchText",
    ]) {
      expect(argumentsFor("any_tool", { [key]: "checkout" })).toEqual([
        { key, label: "Search", value: "“checkout”" },
      ]);
    }

    expect(argumentsFor("search_code", { query: "pool.acquire" })).toEqual([
      { key: "query", label: "Search", value: "“pool.acquire”" },
    ]);
  });

  test("booleans read Yes / No", () => {
    const rows: Array<FormattedEvidenceArgument> = argumentsFor(
      "query_monitors",
      { problemsOnly: true, includeGlobalProbes: false },
    );

    expect(rows).toEqual([
      {
        key: "problemsOnly",
        label: "Only monitors with problems",
        value: "Yes",
      },
      {
        key: "includeGlobalProbes",
        label: "Include global probes",
        value: "No",
      },
    ]);
  });

  test("unknown keys get a Title Case label", () => {
    expect(
      argumentsFor("query_kubernetes", {
        podNamespace: "checkout",
        max_restart_count: 3,
      }),
    ).toEqual([
      { key: "podNamespace", label: "Pod Namespace", value: "checkout" },
      { key: "max_restart_count", label: "Max Restart Count", value: "3" },
    ]);
  });

  test("skips empty, null and structured values", () => {
    expect(
      argumentsFor("search_logs", {
        bodySearchText: "   ",
        traceId: "",
        severityTexts: [],
        nested: { a: 1 },
        nothing: null,
        mixed: [{ a: 1 }, null],
      }),
    ).toEqual([]);
  });

  test("keeps only scalar items from arrays", () => {
    expect(
      argumentsFor("search_security_events", {
        classNames: ["Authentication", { a: 1 }, 7, true, null],
      }),
    ).toEqual([
      {
        key: "classNames",
        label: "Event class",
        value: "Authentication, 7, Yes",
      },
    ]);
  });

  test("returns no rows for missing or malformed arguments", () => {
    expect(formatEvidenceArguments("search_logs", undefined)).toEqual([]);
    expect(formatEvidenceArguments("search_logs", null)).toEqual([]);
    expect(
      formatEvidenceArguments(
        "search_logs",
        [] as unknown as Parameters<typeof formatEvidenceArguments>[1],
      ),
    ).toEqual([]);
  });

  test("values stay plain text, hostile strings included", () => {
    const hostile: string = '<img src=x onerror="alert(1)"> [x](https://evil)';
    expect(argumentsFor("search_logs", { bodySearchText: hostile })).toEqual([
      { key: "bodySearchText", label: "Search", value: `“${hostile}”` },
    ]);
  });

  test("formats an at-time as a local timestamp", () => {
    expect(
      argumentsFor("baseline_anomaly", {
        metricName: "cpu",
        atTime: "2026-09-14T18:00:00.000Z",
      }),
    ).toEqual([
      { key: "metricName", label: "Metric", value: "cpu" },
      {
        key: "atTime",
        label: "At",
        value: formatEvidenceDateTime("2026-09-14T18:00:00.000Z"),
      },
    ]);
  });

  test("non-numeric window values fall back to the raw value", () => {
    expect(
      argumentsFor("query_incidents", { createdWithinHours: "a while" }),
    ).toEqual([
      { key: "createdWithinHours", label: "Time window", value: "a while" },
    ]);
  });
});

describe("label helpers", () => {
  test.each([
    ["fooBarBaz", "Foo Bar Baz"],
    ["foo_bar_baz", "Foo Bar Baz"],
    ["service-name", "Service Name"],
    ["limit", "Limit"],
    ["a1B2", "A1 B2"],
  ])("toTitleCaseLabel(%p) is %p", (key: string, expected: string) => {
    expect(toTitleCaseLabel(key)).toBe(expected);
  });

  test("toTitleCaseLabel keeps a key with no word characters", () => {
    expect(toTitleCaseLabel("__")).toBe("__");
  });

  test("shortenIdentifier only shortens long ids", () => {
    expect(shortenIdentifier("abc")).toBe("abc");
    expect(shortenIdentifier("123456789012")).toBe("123456789012");
    expect(shortenIdentifier("1234567890123")).toBe("12345678…");
    expect(shortenIdentifier("  padded-id  ")).toBe("padded-id");
  });
});
