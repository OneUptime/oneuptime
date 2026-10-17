import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import * as React from "react";
import OneUptimeDate from "../../../Types/Date";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorSummarySnapshot from "../../../Types/Monitor/MonitorSummarySnapshot";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ProbeStatusMonitorResponse, {
  ProbeStatusMonitorProbe,
} from "../../../Types/Monitor/ProbeStatusMonitor/ProbeStatusMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import MonitorLogSummaryUtil from "../../../Utils/Monitor/MonitorLogSummaryUtil";
import MonitorSummarySnapshotUtil, {
  MonitorSummaryDataToProcess,
  MonitorSummaryInfoProps,
} from "../../../Utils/Monitor/MonitorSummarySnapshotUtil";
import ProbeStatusMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/ProbeStatusMonitorView";
import SummaryInfo from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryInfo";

/*
 * What a Probe Status monitor found: the counts, then each probe it watches
 * with whether it is connected and when it was last heard from -
 * disconnected first, since they are why anyone is looking. The same card is
 * drawn on the monitor's overview, on an incident or alert the monitor
 * opened (from the snapshot stored with it) and in its Monitoring Logs, so
 * each of those paths is rendered here from the JSON it really reads.
 */

const NOW: Date = new Date("2026-10-17T12:00:00.000Z");
const CHECKED_AT: Date = new Date("2026-10-17T11:59:00.000Z");

const FRANKFURT: ProbeStatusMonitorProbe = {
  probeId: "79000000-0000-4000-8000-000000000001",
  probeName: "Frankfurt",
  isGlobalProbe: false,
  isConnected: true,
  lastAliveAt: new Date("2026-10-17T11:59:30.000Z"),
};
const SINGAPORE: ProbeStatusMonitorProbe = {
  probeId: "79000000-0000-4000-8000-000000000002",
  probeName: "Singapore",
  isGlobalProbe: true,
  isConnected: false,
  lastAliveAt: new Date("2026-10-17T11:41:00.000Z"),
};
const BASEMENT: ProbeStatusMonitorProbe = {
  probeId: "79000000-0000-4000-8000-000000000003",
  probeName: "Basement",
  isGlobalProbe: false,
  isConnected: false,
};

const EVALUATION_SUMMARY: MonitorEvaluationSummary = {
  evaluatedAt: CHECKED_AT,
  criteriaResults: [
    {
      criteriaId: "criteria-1",
      criteriaName: "Check if a probe is disconnected",
      filterCondition: FilterCondition.Any,
      met: true,
      message:
        "Disconnected Probes was 2, above the 0 threshold. 2 of 3 probes are disconnected: Basement, Singapore.",
      filters: [],
    },
  ],
  events: [],
};

function response(
  probes: Array<ProbeStatusMonitorProbe>,
  overrides: Partial<ProbeStatusMonitorResponse> = {},
): ProbeStatusMonitorResponse {
  const connected: number = probes.filter(
    (probe: ProbeStatusMonitorProbe): boolean => {
      return probe.isConnected;
    },
  ).length;

  return {
    projectId: new ObjectID("79000000-0000-4000-8000-0000000000a1"),
    monitorId: new ObjectID("79000000-0000-4000-8000-0000000000a2"),
    monitorStepId: new ObjectID("79000000-0000-4000-8000-0000000000a3"),
    probes: probes,
    connectedProbeCount: connected,
    disconnectedProbeCount: probes.length - connected,
    missingProbeIds: [],
    checkedAt: CHECKED_AT,
    ...overrides,
  };
}

function rows(): Array<HTMLElement> {
  return screen.getAllByTestId("probe-status-monitor-probe-row");
}

function rowNames(): Array<string> {
  return rows().map((row: HTMLElement): string => {
    return within(row).getByText(
      (_content: string, element: Element | null): boolean => {
        return element?.tagName === "SPAN" && element.className.includes("break-words");
      },
    ).textContent as string;
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("ProbeStatusMonitorView", () => {
  it("counts the probes it watches, connected of all, and disconnected", () => {
    render(
      <ProbeStatusMonitorView
        probeStatusMonitorResponse={response([FRANKFURT, SINGAPORE, BASEMENT])}
      />,
    );

    const summary: HTMLElement = screen.getByTestId(
      "probe-status-monitor-summary",
    );

    expect(summary).toHaveTextContent("Connected");
    expect(summary).toHaveTextContent("1 of 3");
    expect(summary).toHaveTextContent("Disconnected");
    expect(summary).toHaveTextContent("Checked At");
  });

  it("lists the disconnected probes first, each set by name", () => {
    render(
      <ProbeStatusMonitorView
        probeStatusMonitorResponse={response([FRANKFURT, SINGAPORE, BASEMENT])}
      />,
    );

    expect(rowNames()).toEqual(["Basement", "Singapore", "Frankfurt"]);
    expect(within(rows()[0]!).getByText("Disconnected")).toBeInTheDocument();
    expect(within(rows()[2]!).getByText("Connected")).toBeInTheDocument();
  });

  it("marks a global probe, and says when each probe was last heard from", () => {
    render(
      <ProbeStatusMonitorView
        probeStatusMonitorResponse={response([FRANKFURT, SINGAPORE, BASEMENT])}
      />,
    );

    const singapore: HTMLElement = rows()[1]!;
    const frankfurt: HTMLElement = rows()[2]!;
    const basement: HTMLElement = rows()[0]!;

    expect(within(singapore).getByText("Global")).toBeInTheDocument();
    expect(within(frankfurt).queryByText("Global")).toBeNull();
    expect(singapore).toHaveTextContent(
      `Last heard from ${OneUptimeDate.fromNow(SINGAPORE.lastAliveAt!)}`,
    );
    expect(singapore).toHaveTextContent("19 minutes ago");
    // A probe that never reported is not given a time it never had.
    expect(basement).toHaveTextContent("Never heard from");
  });

  it("says how many watched probes no longer exist, and where to fix it", () => {
    const { rerender } = render(
      <ProbeStatusMonitorView
        probeStatusMonitorResponse={response([FRANKFURT], {
          missingProbeIds: ["79000000-0000-4000-8000-000000000009"],
        })}
      />,
    );

    expect(
      screen.getByTestId("probe-status-monitor-missing-probes"),
    ).toHaveTextContent(
      "1 probe this monitor watches no longer exists, so it is not counted. Pick probes again under Criteria.",
    );

    rerender(
      <ProbeStatusMonitorView
        probeStatusMonitorResponse={response([FRANKFURT], {
          missingProbeIds: [
            "79000000-0000-4000-8000-000000000009",
            "79000000-0000-4000-8000-000000000010",
          ],
        })}
      />,
    );

    expect(
      screen.getByTestId("probe-status-monitor-missing-probes"),
    ).toHaveTextContent(
      "2 probes this monitor watches no longer exist, so they are not counted. Pick probes again under Criteria.",
    );
  });

  it("says nothing about missing probes when none are missing", () => {
    render(
      <ProbeStatusMonitorView probeStatusMonitorResponse={response([FRANKFURT])} />,
    );

    expect(screen.queryByTestId("probe-status-monitor-missing-probes")).toBeNull();
  });

  it("shows no time it does not have", () => {
    render(
      <ProbeStatusMonitorView
        probeStatusMonitorResponse={response([FRANKFURT], {
          checkedAt: new Date(0),
        })}
      />,
    );

    expect(screen.getByTestId("probe-status-monitor-summary")).not.toHaveTextContent(
      "1970",
    );
  });
});

describe("SummaryInfo for a Probe Status monitor", () => {
  it("draws the probes its newest evaluation found, with the criteria that judged them", () => {
    render(
      <SummaryInfo
        monitorType={MonitorType.ProbeStatus}
        probeStatusMonitorResponse={response([FRANKFURT, SINGAPORE])}
        evaluationSummary={EVALUATION_SUMMARY}
      />,
    );

    expect(screen.getByTestId("probe-status-monitor-summary")).toBeInTheDocument();
    expect(rowNames()).toEqual(["Singapore", "Frankfurt"]);
    expect(
      screen.getAllByText("Check if a probe is disconnected").length,
    ).toBeGreaterThan(0);
  });

  it("before its first evaluation, says when one will come", () => {
    render(<SummaryInfo monitorType={MonitorType.ProbeStatus} />);

    expect(
      screen.getByText(
        "No evaluation yet. This monitor checks the probes it watches every minute.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("probe-status-monitor-summary")).toBeNull();
  });

  it("an incident it opened shows the probes as they were, read back from its stored summary", () => {
    const snapshot: MonitorSummarySnapshot | null =
      MonitorSummarySnapshotUtil.buildSnapshot({
        monitorType: MonitorType.ProbeStatus,
        dataToProcess: response([
          FRANKFURT,
          SINGAPORE,
        ]) as unknown as MonitorSummaryDataToProcess,
        monitorId: "79000000-0000-4000-8000-0000000000a2",
        monitorName: "Probe health",
        evaluationSummary: EVALUATION_SUMMARY,
        capturedAt: CHECKED_AT,
      });

    // Through the jsonb column and back over the API, as the browser reads it.
    const readBack: MonitorSummarySnapshot = MonitorSummarySnapshotUtil.deserialize(
      JSON.parse(
        JSON.stringify(MonitorSummarySnapshotUtil.serialize(snapshot)),
      ) as JSONObject,
    )!;

    const props: MonitorSummaryInfoProps =
      MonitorSummarySnapshotUtil.toSummaryInfoProps(readBack);

    render(<SummaryInfo {...props} />);

    expect(rowNames()).toEqual(["Singapore", "Frankfurt"]);
    expect(screen.getByTestId("probe-status-monitor-summary")).toHaveTextContent(
      "1 of 2",
    );
  });

  it("a Monitoring Logs row shows the probes it evaluated, from the stored body", () => {
    const props: MonitorSummaryInfoProps = MonitorLogSummaryUtil.toSummaryInfoProps({
      monitorType: MonitorType.ProbeStatus,
      // As MonitorLogUtil stores it: a plain JSON round trip.
      logBody: JSON.parse(
        JSON.stringify({
          ...response([FRANKFURT, BASEMENT]),
          evaluationSummary: EVALUATION_SUMMARY,
        }),
      ) as JSONObject,
      monitoredAt: CHECKED_AT,
    });

    render(<SummaryInfo {...props} />);

    expect(rowNames()).toEqual(["Basement", "Frankfurt"]);
    expect(rows()[1]!).toHaveTextContent(
      `Last heard from ${OneUptimeDate.fromNow(FRANKFURT.lastAliveAt!)}`,
    );
  });
});
