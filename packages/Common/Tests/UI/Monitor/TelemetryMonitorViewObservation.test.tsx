import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import OneUptimeDate from "../../../Types/Date";
import MonitorType from "../../../Types/Monitor/MonitorType";
import TelemetryObservation, {
  TelemetryObservationKind,
} from "../../../Types/Monitor/TelemetryObservation";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import SummaryInfo from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryInfo";
import { getTelemetryObservationText } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/TelemetryObservationText";

/*
 * A telemetry monitor's summary facts (TelemetryMonitorView), as the
 * Monitoring Logs' View Summary (#6639) and the monitor's overview draw
 * them. A row is a check that has run: when it ran and what it saw, never a
 * "Next Check At" it cannot have. The overview's live card keeps its next
 * check.
 */

const MONITORED_AT: Date = OneUptimeDate.fromString("2026-11-10T09:12:00.000Z");
const NEXT_CHECK_AT: Date = OneUptimeDate.fromString(
  "2026-11-10T09:13:00.000Z",
);

afterEach(() => {
  cleanup();
});

// The value of the fact titled `title`.
function factValue(title: string): string {
  const card: HTMLElement | null = screen
    .getByText(title)
    .closest(".rounded-xl");

  expect(card).not.toBeNull();

  return (card!.textContent || "").replace(title, "").trim();
}

describe("a telemetry check's summary facts", () => {
  test("a Monitoring Logs row: when it ran and what it saw, with no next check", () => {
    render(
      <SummaryInfo
        monitorType={MonitorType.Metrics}
        telemetryMonitorSummary={{
          lastCheckedAt: MONITORED_AT,
          isPastCheck: true,
          observation: {
            kind: TelemetryObservationKind.MetricDataPoints,
            count: 8,
          },
        }}
      />,
    );

    const view: HTMLElement = screen.getByTestId("telemetry-monitor-summary");

    expect(within(view).getByText("Monitored At")).toBeInTheDocument();
    expect(factValue("Monitored At")).toBe(
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(MONITORED_AT),
    );
    expect(factValue("Observed")).toBe("8 data points");
    expect(within(view).queryByText("Next Check At")).not.toBeInTheDocument();
  });

  test("a row whose check saw nothing readable says when it ran, and no more", () => {
    render(
      <SummaryInfo
        monitorType={MonitorType.Traces}
        telemetryMonitorSummary={{
          lastCheckedAt: MONITORED_AT,
          isPastCheck: true,
        }}
      />,
    );

    expect(screen.getByText("Monitored At")).toBeInTheDocument();
    expect(screen.queryByText("Observed")).not.toBeInTheDocument();
    expect(screen.queryByText("Next Check At")).not.toBeInTheDocument();
  });

  test("the overview's live card keeps its next check, and says nothing it did not see", () => {
    render(
      <SummaryInfo
        monitorType={MonitorType.Logs}
        telemetryMonitorSummary={{
          lastCheckedAt: MONITORED_AT,
          lastCheckedLabel: "Evaluated At",
          nextCheckAt: NEXT_CHECK_AT,
        }}
      />,
    );

    expect(factValue("Evaluated At")).toBe(
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(MONITORED_AT),
    );
    expect(factValue("Next Check At")).toBe(
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(NEXT_CHECK_AT),
    );
    expect(screen.queryByText("Observed")).not.toBeInTheDocument();
  });

  test("a metric check that read nothing says No data", () => {
    render(
      <SummaryInfo
        monitorType={MonitorType.Kubernetes}
        telemetryMonitorSummary={{
          lastCheckedAt: MONITORED_AT,
          isPastCheck: true,
          observation: {
            kind: TelemetryObservationKind.NoMetricData,
            count: 0,
          },
        }}
      />,
    );

    expect(factValue("Observed")).toBe("No data");
  });
});

describe("what a check saw, in words", () => {
  const CASES: Array<{
    observation: TelemetryObservation;
    text: string;
  }> = [
    {
      observation: { kind: TelemetryObservationKind.Logs, count: 412 },
      text: "412 logs",
    },
    {
      observation: { kind: TelemetryObservationKind.Logs, count: 1 },
      text: "1 log",
    },
    {
      observation: { kind: TelemetryObservationKind.Logs, count: 0 },
      text: "0 logs",
    },
    {
      observation: { kind: TelemetryObservationKind.Spans, count: 7 },
      text: "7 spans",
    },
    {
      observation: { kind: TelemetryObservationKind.Spans, count: 1 },
      text: "1 span",
    },
    {
      observation: { kind: TelemetryObservationKind.Exceptions, count: 3 },
      text: "3 exceptions",
    },
    {
      observation: { kind: TelemetryObservationKind.Exceptions, count: 1 },
      text: "1 exception",
    },
    {
      observation: { kind: TelemetryObservationKind.Profiles, count: 11 },
      text: "11 profiles",
    },
    {
      observation: { kind: TelemetryObservationKind.Profiles, count: 1 },
      text: "1 profile",
    },
    {
      observation: {
        kind: TelemetryObservationKind.SecurityEvents,
        count: 5,
      },
      text: "5 security events",
    },
    {
      observation: {
        kind: TelemetryObservationKind.SecurityEvents,
        count: 1,
      },
      text: "1 security event",
    },
    {
      observation: { kind: TelemetryObservationKind.BadAiAnswers, count: 2 },
      text: "2 bad AI answers",
    },
    {
      observation: { kind: TelemetryObservationKind.BadAiAnswers, count: 1 },
      text: "1 bad AI answer",
    },
    {
      observation: { kind: TelemetryObservationKind.MetricSeries, count: 3 },
      text: "3 series",
    },
    {
      observation: { kind: TelemetryObservationKind.MetricSeries, count: 1 },
      text: "1 series",
    },
    {
      observation: {
        kind: TelemetryObservationKind.MetricDataPoints,
        count: 1234,
      },
      text: "1,234 data points",
    },
    {
      observation: {
        kind: TelemetryObservationKind.MetricDataPoints,
        count: 1,
      },
      text: "1 data point",
    },
    {
      observation: { kind: TelemetryObservationKind.NoMetricData, count: 0 },
      text: "No data",
    },
  ];

  test.each(CASES)(
    "$observation.kind $observation.count reads $text",
    ({
      observation,
      text,
    }: {
      observation: TelemetryObservation;
      text: string;
    }) => {
      expect(
        getTelemetryObservationText(getGlobalTranslator(), observation),
      ).toBe(text);
    },
  );

  test("every kind has words of its own", () => {
    const worded: Set<TelemetryObservationKind> = new Set(
      CASES.map((entry: { observation: TelemetryObservation }) => {
        return entry.observation.kind;
      }),
    );

    expect([...worded].sort()).toEqual(
      Object.values(TelemetryObservationKind).sort(),
    );
  });
});
