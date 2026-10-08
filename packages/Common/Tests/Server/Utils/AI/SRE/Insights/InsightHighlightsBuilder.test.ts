import InsightHighlightsBuilder, {
  InsightHighlightsRow,
} from "../../../../../../Server/Utils/AI/SRE/Insights/InsightHighlightsBuilder";
import AIInsightSeverity from "../../../../../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../../../../../Types/AI/AIInsightType";
import {
  AI_INSIGHT_HIGHLIGHTS_NEW_WINDOW_IN_DAYS,
  AI_INSIGHT_HIGHLIGHTS_SERVICE_MIN,
  AIInsightHighlights,
} from "../../../../../../Types/AI/AIInsightHighlights";
import { describe, expect, test } from "@jest/globals";

/*
 * What the AI Insights inbox leads with, from the open findings the caller
 * may read: the one to look at first, the service behind most of them, and
 * what is new this week. Pure: the same rows always give the same
 * highlights.
 */

const NOW: Date = new Date("2026-10-08T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR);
}

let sequence: number = 0;

function finding(
  overrides: Partial<InsightHighlightsRow> = {},
): InsightHighlightsRow {
  sequence++;
  return {
    id: `insight-${String(sequence).padStart(3, "0")}`,
    title: `Finding ${sequence}`,
    insightType: AIInsightType.ErrorLogSpike,
    severity: AIInsightSeverity.Medium,
    occurrenceCount: 1,
    firstSeenAt: hoursAgo(30 * 24),
    lastSeenAt: hoursAgo(5),
    ...overrides,
  };
}

function build(rows: Array<InsightHighlightsRow>): AIInsightHighlights {
  return InsightHighlightsBuilder.build({ now: NOW, rows, isPartial: false });
}

describe("InsightHighlightsBuilder.build", () => {
  test("with nothing open, there is nothing to lead with", () => {
    expect(build([])).toEqual({
      openCount: 0,
      newCount: 0,
      isPartial: false,
    });
  });

  test("passes on that the reader could not read every open finding", () => {
    expect(
      InsightHighlightsBuilder.build({ now: NOW, rows: [], isPartial: true })
        .isPartial,
    ).toBe(true);
  });

  test("counts the open findings it read", () => {
    expect(build([finding(), finding(), finding()]).openCount).toBe(3);
  });

  describe("the finding to look at first", () => {
    test("is the most severe one", () => {
      const high: InsightHighlightsRow = finding({
        severity: AIInsightSeverity.High,
        lastSeenAt: hoursAgo(20),
      });

      expect(
        build([
          finding({ severity: AIInsightSeverity.Low, lastSeenAt: hoursAgo(1) }),
          high,
          finding({ severity: AIInsightSeverity.Medium }),
        ]).topFinding!.id,
      ).toBe(high.id);
    });

    test("of the same severity, the most recently seen, then the one seen most often", () => {
      const recent: InsightHighlightsRow = finding({ lastSeenAt: hoursAgo(1) });
      const often: InsightHighlightsRow = finding({
        lastSeenAt: hoursAgo(1),
        occurrenceCount: 9,
      });

      expect(
        build([finding({ lastSeenAt: hoursAgo(3) }), recent]).topFinding!.id,
      ).toBe(recent.id);
      expect(build([recent, often]).topFinding!.id).toBe(often.id);
    });

    test("a severity a newer server added comes after every known one", () => {
      const low: InsightHighlightsRow = finding({
        severity: AIInsightSeverity.Low,
      });

      expect(
        build([finding({ severity: "Critical" }), low]).topFinding!.id,
      ).toBe(low.id);
    });

    test("names everything the card says about it, and what triage concluded", () => {
      const row: InsightHighlightsRow = finding({
        title: "Error logs from checkout spiked 6x",
        severity: AIInsightSeverity.High,
        serviceName: "checkout",
        telemetryServiceId: "service-1",
        occurrenceCount: 3,
        firstSeenAt: hoursAgo(6),
        lastSeenAt: hoursAgo(2),
        triageSummary: "  The 10:42 deploy shortened the gateway timeout.  ",
      });

      expect(build([row]).topFinding).toEqual({
        id: row.id,
        title: "Error logs from checkout spiked 6x",
        insightType: AIInsightType.ErrorLogSpike,
        severity: AIInsightSeverity.High,
        serviceName: "checkout",
        occurrenceCount: 3,
        firstSeenAt: hoursAgo(6).toISOString(),
        lastSeenAt: hoursAgo(2).toISOString(),
        triageSummary: "The 10:42 deploy shortened the gateway timeout.",
      });
    });

    test("leaves out what it does not know, rather than saying it empty", () => {
      const row: InsightHighlightsRow = {
        id: "bare",
        title: "Bare",
        insightType: AIInsightType.MetricDrift,
        severity: AIInsightSeverity.Low,
        triageSummary: "   ",
      };

      expect(build([row]).topFinding).toEqual({
        id: "bare",
        title: "Bare",
        insightType: AIInsightType.MetricDrift,
        severity: AIInsightSeverity.Low,
      });
    });
  });

  describe("the service behind most of them", () => {
    test(`stands out with ${AI_INSIGHT_HIGHLIGHTS_SERVICE_MIN} findings or more, more than any other, and not all of them`, () => {
      const highlights: AIInsightHighlights = build([
        finding({ serviceName: "checkout", telemetryServiceId: "s1" }),
        finding({ serviceName: "checkout", telemetryServiceId: "s1" }),
        finding({ serviceName: "checkout", telemetryServiceId: "s1" }),
        finding({ serviceName: "payments", telemetryServiceId: "s2" }),
        finding({}),
      ]);

      expect(highlights.topService).toEqual({
        id: "s1",
        name: "checkout",
        count: 3,
      });
    });

    test("a tie is no stand-out", () => {
      expect(
        build([
          finding({ serviceName: "checkout", telemetryServiceId: "s1" }),
          finding({ serviceName: "checkout", telemetryServiceId: "s1" }),
          finding({ serviceName: "payments", telemetryServiceId: "s2" }),
          finding({ serviceName: "payments", telemetryServiceId: "s2" }),
        ]).topService,
      ).toBeUndefined();
    });

    test("one finding is no pattern", () => {
      expect(
        build([
          finding({ serviceName: "checkout", telemetryServiceId: "s1" }),
          finding({}),
          finding({}),
        ]).topService,
      ).toBeUndefined();
    });

    test("a project whose every finding is one service's says nothing about it", () => {
      expect(
        build([
          finding({ serviceName: "checkout", telemetryServiceId: "s1" }),
          finding({ serviceName: "checkout", telemetryServiceId: "s1" }),
        ]).topService,
      ).toBeUndefined();
    });

    test("findings that name a service without its id are counted by name, in any case", () => {
      expect(
        build([
          finding({ serviceName: "Search" }),
          finding({ serviceName: "search " }),
          finding({}),
        ]).topService,
      ).toEqual({ name: "Search", count: 2 });
    });
  });

  describe("what is new", () => {
    test(`counts the findings first seen in the last ${AI_INSIGHT_HIGHLIGHTS_NEW_WINDOW_IN_DAYS} days, and names the newest that is not already first`, () => {
      const top: InsightHighlightsRow = finding({
        severity: AIInsightSeverity.High,
        firstSeenAt: hoursAgo(1),
      });
      const newest: InsightHighlightsRow = finding({
        firstSeenAt: hoursAgo(3),
      });

      const highlights: AIInsightHighlights = build([
        top,
        newest,
        finding({ firstSeenAt: hoursAgo(50) }),
        finding({
          firstSeenAt: new Date(
            NOW.getTime() - AI_INSIGHT_HIGHLIGHTS_NEW_WINDOW_IN_DAYS * DAY - 1,
          ),
        }),
      ]);

      expect(highlights.topFinding!.id).toBe(top.id);
      expect(highlights.newCount).toBe(3);
      expect(highlights.newest!.id).toBe(newest.id);
    });

    test("when the only new one is the finding already named first, no newest is said", () => {
      const only: InsightHighlightsRow = finding({
        severity: AIInsightSeverity.High,
        firstSeenAt: hoursAgo(1),
      });

      const highlights: AIInsightHighlights = build([only, finding()]);

      expect(highlights.newCount).toBe(1);
      expect(highlights.newest).toBeUndefined();
    });

    test("a finding with no first-seen time is never new", () => {
      expect(
        build([finding({ firstSeenAt: undefined })]).newCount,
      ).toBe(0);
    });
  });

  test("the same rows give the same highlights, in whatever order they come", () => {
    const rows: Array<InsightHighlightsRow> = [
      finding({ severity: AIInsightSeverity.High, serviceName: "a" }),
      finding({ severity: AIInsightSeverity.High, serviceName: "a" }),
      finding({ firstSeenAt: hoursAgo(2), serviceName: "b" }),
      finding({ firstSeenAt: hoursAgo(2) }),
    ];

    expect(build([...rows].reverse())).toEqual(build(rows));
  });
});
