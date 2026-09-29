import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4105 wiring pins for the monitor, incident and alert pages. App's
 * node test environment cannot render React, so the load-bearing wiring is
 * pinned here as whitespace-squashed source strings (the
 * DashboardTimeRangeZoomWiring pattern). The behaviour behind every pin is
 * rendered for real in Common/Tests/App/Dashboard:
 *
 *   MonitorMetricsTabsTimeRangeZoom.test.tsx      (monitor Metrics page)
 *   MonitorOverviewChartsTimeRangeZoom.test.tsx   (response time, preview)
 *   MonitorStepPreviewsTimeRangeZoom.test.tsx     (10 step forms, Criteria)
 *   IncidentRootCauseTimeRangeZoom.test.tsx       (Root Cause page)
 *   EventOverviewTelemetrySnapshotZoom.test.tsx   (incident / alert pages)
 *   EventOverviewSnapshotZoomAcrossTabs.test.tsx  (their snapshot's tabs)
 *   TelemetrySnapshotPanelTimeRangeZoom.test.tsx  (episodes, companion tabs)
 *   TelemetrySnapshotZoomAcrossTabs.test.tsx      (a snapshot's zoom, every tab)
 *   TelemetrySnapshotZoom.test.tsx                (the hosts' snapshot zoom)
 *   UptimeStripsExcludedFromZoom.test.tsx         (uptime day strips)
 */

function readSquashed(relative: string): string {
  return fs
    .readFileSync(path.join(__dirname, "../../..", relative), "utf8")
    .replace(/\s+/g, " ");
}

const DASHBOARD: string = "App/FeatureSet/Dashboard/src";

const MONITOR_METRICS: string = `${DASHBOARD}/Components/Monitor/MonitorMetrics.tsx`;

const STEP_FORMS: Array<[string, string]> = [
  ["Metric", "MetricMonitor/MetricMonitorStepForm.tsx"],
  ["Host", "HostMonitor/HostMonitorStepForm.tsx"],
  ["Kubernetes", "KubernetesMonitor/KubernetesMonitorStepForm.tsx"],
  ["Docker", "DockerMonitor/DockerMonitorStepForm.tsx"],
  ["Docker Swarm", "DockerSwarmMonitor/DockerSwarmMonitorStepForm.tsx"],
  ["Podman", "PodmanMonitor/PodmanMonitorStepForm.tsx"],
  ["Proxmox", "ProxmoxMonitor/ProxmoxMonitorStepForm.tsx"],
  ["VMware", "VMwareMonitor/VMwareMonitorStepForm.tsx"],
  ["Ceph", "CephMonitor/CephMonitorStepForm.tsx"],
  ["IoT", "IoTMonitor/IoTMonitorStepForm.tsx"],
];

const SNAPSHOT_HOSTS: Array<[string, string]> = [
  ["the incident overview", `${DASHBOARD}/Pages/Incidents/View/Index.tsx`],
  ["the alert overview", `${DASHBOARD}/Pages/Alerts/View/Index.tsx`],
  [
    "the episode snapshot panel",
    `${DASHBOARD}/Components/Telemetry/TelemetrySnapshotPanel.tsx`,
  ],
];

const COMPANION_TABS: string = `${DASHBOARD}/Components/Telemetry/TelemetryCompanionSignalTabs.tsx`;

// The slice of a file from `start` to the first `end` after it.
function sliceBetween(source: string, start: string, end: string): string {
  const startIndex: number = source.indexOf(start);
  expect(startIndex).toBeGreaterThan(-1);
  const endIndex: number = source.indexOf(end, startIndex);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex + end.length);
}

// Every <MetricView ... /> element in a file, attributes and all.
function metricViewElements(source: string): Array<string> {
  const elements: Array<string> = [];
  let index: number = source.indexOf("<MetricView ");
  while (index > -1) {
    // MetricView elements in these files are self-closing.
    const end: number = source.indexOf("/> ", index);
    elements.push(source.slice(index, end + 2));
    index = source.indexOf("<MetricView ", end);
  }
  return elements;
}

describe("the monitor Metrics tab zooms every category card as one", () => {
  const source: string = readSquashed(MONITOR_METRICS);

  test("one zoom, over the tab's own range and setter, wraps every card", () => {
    expect(source).toContain(
      "<TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={handleTimeRangeChange} >",
    );

    const scopeStart: number = source.indexOf("<TimeRangeZoomScope");
    const card: number = source.indexOf("<EmbeddedMetricCard");
    const scopeEnd: number = source.indexOf("</TimeRangeZoomScope>");
    expect(scopeStart).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(scopeStart);
    expect(scopeEnd).toBeGreaterThan(card);
  });

  test("the cards stay on the tab's range (so they follow the tab's zoom)", () => {
    const card: string = sliceBetween(source, "<EmbeddedMetricCard", "/>");
    expect(card).toContain("timeRange={timeRange}");
    expect(card).toContain("onTimeRangeChange={handleTimeRangeChange}");
  });

  test("the range state is not duplicated for the zoom", () => {
    expect(source.split("useState<RangeStartAndEndDateTime>").length - 1).toBe(
      1,
    );
  });
});

describe("the one-card metric tabs and the response-time card keep their own zoom", () => {
  test.each([
    [
      "Custom Metrics",
      `${DASHBOARD}/Components/Monitor/MonitorCustomMetrics.tsx`,
    ],
    [
      "Incident Metrics",
      `${DASHBOARD}/Components/Monitor/MonitorIncidentMetrics.tsx`,
    ],
    [
      "Alert Metrics",
      `${DASHBOARD}/Components/Monitor/MonitorAlertMetrics.tsx`,
    ],
    [
      "the Overview's response time",
      `${DASHBOARD}/Components/Monitor/Overview/MonitorResponseTimeCard.tsx`,
    ],
  ])(
    "%s: an uncontrolled EmbeddedMetricCard, which zooms and resets itself",
    (_name: string, file: string) => {
      const card: string = sliceBetween(
        readSquashed(file),
        "<EmbeddedMetricCard",
        "/>",
      );
      expect(card).not.toContain("timeRange=");
      expect(card).not.toContain("onTimeRangeChange=");
    },
  );

  test.each([
    ["the monitor Overview", `${DASHBOARD}/Pages/Monitor/View/Index.tsx`],
    ["the monitor Metrics page", `${DASHBOARD}/Pages/Monitor/View/Metrics.tsx`],
  ])(
    "%s owns no page range, so it has no page-wide zoom",
    (_name: string, file: string) => {
      expect(readSquashed(file)).not.toContain("TimeRangeZoom");
    },
  );
});

describe("monitor step forms zoom their preview only", () => {
  test.each(STEP_FORMS)(
    "%s: the preview zooms locally and the form never sees the zoom",
    (_name: string, file: string) => {
      const source: string = readSquashed(
        `${DASHBOARD}/Components/Form/Monitor/${file}`,
      );
      const views: Array<string> = metricViewElements(source);

      expect(views).toHaveLength(1);
      const view: string = views[0]!;
      expect(view).toContain("localChartZoom={true}");
      expect(view).not.toContain("disableChartZoom");
      // A host handler would route the zoom somewhere; here it goes nowhere.
      expect(view).not.toContain("onTimeRangeSelect");
      expect(view).not.toContain("onTimeRangeReset");
      // The preview charts the rolling window the form keeps in state.
      expect(view).toContain("startAndEndDate: startAndEndTime");
      // And onChange still only ever writes the query configs back.
      expect(view).toContain("metricViewConfig: {");
      expect(view.slice(view.indexOf("onChange="))).not.toContain(
        "startAndEndDate",
      );
    },
  );

  test("the Criteria page's step preview zooms locally too", () => {
    const view: Array<string> = metricViewElements(
      readSquashed(
        `${DASHBOARD}/Components/Monitor/MonitorSteps/MonitorStepMetricPreview.tsx`,
      ),
    );
    expect(view).toHaveLength(1);
    expect(view[0]).toContain("localChartZoom={true}");
    expect(view[0]).not.toContain("disableChartZoom");
  });
});

describe("the telemetry snapshot zooms as one, every tab of it", () => {
  test.each(SNAPSHOT_HOSTS)(
    "%s: its metric chart zooms the snapshot the host holds",
    (_name: string, file: string) => {
      const source: string = readSquashed(file);
      const views: Array<string> = metricViewElements(source);

      expect(views).toHaveLength(1);
      const view: string = views[0]!;
      // The chart shows the window the snapshot shows (a zoom included)...
      expect(view).toContain("data={snapshotZoom.metricViewData}");
      // ...and a drag or a double-click on it zooms or resets the snapshot.
      expect(view).toContain(
        "onTimeRangeSelect={snapshotZoom.onTimeRangeSelect}",
      );
      expect(view).toContain(
        "onTimeRangeReset={snapshotZoom.onTimeRangeReset}",
      );
      /*
       * Reached only when the hook hands no drag handler: a snapshot that
       * stored no window, whose chart still zooms itself alone.
       */
      expect(view).toContain("localChartZoom={true}");
      expect(view).not.toContain("disableChartZoom");
      // The snapshot window is a record, not a range the page owns.
      expect(source).not.toContain("TimeRangeZoomScope");
      expect(source).toContain("useTelemetrySnapshotZoom({");
    },
  );

  test.each(SNAPSHOT_HOSTS)(
    "%s: the other tabs are handed the window the snapshot shows",
    (_name: string, file: string) => {
      const source: string = readSquashed(file);

      expect(source).toContain("snapshotWindow={snapshotZoom.window}");
      // So their copy names the zoomed part of the window, not all of it.
      expect(source).toContain("isSnapshotZoomed={snapshotZoom.isZoomed}");
    },
  );

  test.each(SNAPSHOT_HOSTS)(
    "%s: every card's badge carries the snapshot's Reset zoom",
    (_name: string, file: string) => {
      const source: string = readSquashed(file);

      expect(source).toMatch(
        /const snapshotWindowAlert: ReactElement \| undefined = (telemetrySnapshotWindow|snapshotWindow) \? \( <TelemetrySnapshotBadge window=\{(telemetrySnapshotWindow|snapshotWindow)\} zoom=\{snapshotZoom.zoom\} \/> \) : undefined;/,
      );
      // Named by the snapshot window itself, never by the zoomed slice.
      expect(source).not.toContain(
        "<TelemetrySnapshotBadge window={snapshotZoom.window}",
      );
    },
  );

  test.each(SNAPSHOT_HOSTS.slice(0, 2))(
    "%s: the zoom belongs to the event on screen (the page outlives a move to another one)",
    (_name: string, file: string) => {
      expect(readSquashed(file)).toContain("subjectKey: modelIdString,");
    },
  );
});

describe("the snapshot card's companion tabs keep their own windows", () => {
  const source: string = readSquashed(COMPANION_TABS);

  test("the page's zoom is withdrawn from every companion", () => {
    expect(source).toContain(
      "<TimeRangeZoomProvider zoom={null}>{companion}</TimeRangeZoomProvider>",
    );
    for (const companion of [
      "CompanionLogsTab",
      "CompanionTracesTab",
      "CompanionMetricsTab",
      "CompanionExceptionsTab",
    ]) {
      expect(source).toContain(`children: withoutPageZoom( <${companion}`);
    }
  });

  test("the host's primary element is handed over untouched", () => {
    expect(source).toContain("children: props.primarySignalElement,");
    expect(source).not.toContain("withoutPageZoom(props.primarySignalElement");
  });

  test("the metrics companion stays pinned to the snapshot window", () => {
    expect(source).toContain("range: TimeRange.CUSTOM");
    expect(source).toContain(
      "timeRange={timeRange} onTimeRangeChange={setTimeRange}",
    );
  });
});

describe("charts whose host round-trips the window zoom through MetricView's own zoom", () => {
  test.each([
    [
      "the metric monitor preview",
      `${DASHBOARD}/Components/Monitor/MetricMonitor/MetricMonitorPreview.tsx`,
    ],
    [
      "the incident Root Cause chart",
      `${DASHBOARD}/Components/Incident/IncidentRootCauseMetricChart.tsx`,
    ],
  ])(
    "%s: its onChange keeps the zoomed window, so a reset has one to undo",
    (_name: string, file: string) => {
      const views: Array<string> = metricViewElements(readSquashed(file));

      expect(views).toHaveLength(1);
      const view: string = views[0]!;
      expect(view).toContain("data={metricViewData}");
      expect(view).toContain("setMetricViewData(data);");
      expect(view).not.toContain("disableChartZoom");
      expect(view).not.toContain("localChartZoom");
      expect(view).not.toContain("onTimeRangeSelect");
    },
  );

  test("the metric monitor preview's header names a zoom, and picking a range ends it", () => {
    const source: string = readSquashed(
      `${DASHBOARD}/Components/Monitor/MetricMonitor/MetricMonitorPreview.tsx`,
    );

    expect(source).toContain(
      "setZoomedWindow( getZoomedWindow({ shownWindow: data.startAndEndDate, rollingWindow: startAndEndDate, }), );",
    );
    expect(source).toContain(
      "zoomedWindow ? getZoomedWindowLabel(zoomedWindow) : `${rollingTime}`",
    );
    expect(source).toContain(
      "if (zoomedWindow && modalTempRollingTime === rollingTime) { setStartAndEndDate(",
    );
    // A freshly resolved rolling window is never a zoom.
    expect(
      sliceBetween(
        source,
        "useEffect(() => { setMetricViewData({",
        "}, [startAndEndDate]);",
      ),
    ).toContain("setZoomedWindow(null);");
  });
});

describe("uptime day strips and non-time-series bars stay out of the zoom", () => {
  test.each([
    ["the day strip", "Common/UI/Components/Graphs/DayUptimeGraph.tsx"],
    ["the uptime graph", "Common/UI/Components/MonitorGraphs/Uptime.tsx"],
    [
      "the monitor Overview's uptime history card",
      `${DASHBOARD}/Components/Monitor/Overview/MonitorUptimeHistoryCard.tsx`,
    ],
    [
      "the monitor group view",
      `${DASHBOARD}/Pages/MonitorGroup/View/Index.tsx`,
    ],
    [
      "the public status page's monitor strip",
      "App/FeatureSet/StatusPage/src/Components/Monitor/MonitorOverview.tsx",
    ],
    [
      "the public status page overview",
      "App/FeatureSet/StatusPage/src/Pages/Overview/Overview.tsx",
    ],
    // One request's phases, and one day's statuses: not time series at all.
    [
      "the HTTP request phase breakdown",
      `${DASHBOARD}/Components/Monitor/SummaryView/HttpTimingsView.tsx`,
    ],
    [
      "the port check phase breakdown",
      `${DASHBOARD}/Components/Monitor/SummaryView/PortTimingsView.tsx`,
    ],
    [
      "the uptime day summary bar",
      "Common/UI/Components/Graphs/UptimeDaySummary.tsx",
    ],
  ])("%s takes no drag and no zoom", (_name: string, file: string) => {
    const source: string = readSquashed(file);

    expect(source).not.toContain("TimeRangeZoom");
    expect(source).not.toContain("useChartTimeRangeZoom");
    expect(source).not.toContain("RangeSelection");
    expect(source).not.toContain("onMouseDown");
    expect(source).not.toContain("onDoubleClick");
  });

  test("the monitor group view keeps its fixed 90 days", () => {
    const graph: string = sliceBetween(
      readSquashed(`${DASHBOARD}/Pages/MonitorGroup/View/Index.tsx`),
      "<MonitorUptimeGraph",
      "/>",
    );
    expect(graph).toContain("startDate={OneUptimeDate.getSomeDaysAgo(90)}");
    expect(graph).toContain("endDate={OneUptimeDate.getCurrentDate()}");
  });
});
