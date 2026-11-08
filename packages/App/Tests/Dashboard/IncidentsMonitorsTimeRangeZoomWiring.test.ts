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
 *   MonitorOverviewChartsTimeRangeZoom.test.tsx   (response time, metrics card)
 *   MonitorStepPreviewsTimeRangeZoom.test.tsx     (10 step forms, Criteria)
 *   IncidentRootCauseTimeRangeZoom.test.tsx       (Root Cause page: the
 *                                                  incident's investigation,
 *                                                  issue #6249)
 *   AlertRootCauseTimeRangeZoom.test.tsx          (an alert's Root Cause
 *                                                  page, the same card,
 *                                                  issue #6304)
 *   EventOverviewTelemetrySnapshotZoom.test.tsx   (incident / alert pages)
 *   EventOverviewSnapshotZoomAcrossTabs.test.tsx  (their snapshot's tabs)
 *   TelemetrySnapshotPanelTimeRangeZoom.test.tsx  (episodes, companion tabs)
 *   TelemetrySnapshotZoomAcrossTabs.test.tsx      (a snapshot's zoom, every tab)
 *   SnapshotExplorerPrimaryZoom.test.tsx          (a logs, traces or
 *                                                  exceptions card's zoom and
 *                                                  time range, issue #6251)
 *   EventOverviewSnapshotExplorerZoom.test.tsx    (the same on the pages)
 *   UseInvestigationTimeRange.test.tsx            (that card's time range)
 *   EventTimeRangeControls.test.tsx               (its picker, every tab)
 *   EventMetricInvestigationPanel.test.tsx        (a metric snapshot, issue
 *                                                  #5954: its time range,
 *                                                  zoom and every tab)
 *   MetricInvestigation.test.tsx                  (the investigation card)
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
  ["OpenStack", "OpenStackMonitor/OpenStackMonitorStepForm.tsx"],
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
      /*
       * The preview charts the window the form keeps (the Metrics form: the
       * hours before its rule's window).
       */
      expect(view).toContain("startAndEndDate: startAndEndTime");
      // And onChange still only ever writes the query configs back.
      const onChange: string = view.slice(view.indexOf("onChange="));
      expect(onChange).toContain("metricViewConfig:");
      expect(onChange).not.toContain("startAndEndDate");
      expect(onChange).not.toContain("rollingTime");
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
    "%s: a metrics monitor's snapshot is its metric investigation, not a chart of the host's",
    (_name: string, file: string) => {
      const source: string = readSquashed(file);

      /*
       * Issue #5954: the metric snapshot is the metric investigation
       * (EventMetricInvestigationPanel), which holds its own time range and
       * zoom above the tabs. The host draws no metric chart of its own, and
       * its snapshot zoom takes no metric data.
       */
      expect(metricViewElements(source)).toHaveLength(0);
      expect(source).toContain("<EventMetricInvestigationPanel");
      expect(source).not.toContain("snapshotZoom.metricViewData");
      expect(source).not.toContain("snapshotZoom.onTimeRangeSelect");
      // The snapshot window is a record, not a range the page owns.
      expect(source).not.toContain("TimeRangeZoomScope");
      /*
       * Issue #6251: no host holds a snapshot zoom of its own any more. A
       * logs, traces or exceptions snapshot's card holds its time range,
       * zoom included (TelemetrySnapshotPanel), as a metric snapshot's does.
       */
      expect(source).not.toContain("useTelemetrySnapshotZoom");
      expect(source).not.toContain("TelemetrySnapshotBadge");
    },
  );

  test.each(SNAPSHOT_HOSTS.slice(0, 2))(
    "%s: the investigation is handed the window the monitor evaluated, the event's moments and its id",
    (_name: string, file: string) => {
      const source: string = readSquashed(file);
      const panel: string = sliceBetween(
        source,
        "<EventMetricInvestigationPanel",
        "/>",
      );

      expect(source).toContain(
        "const isMetricSnapshot: boolean = telemetryQuery?.telemetryType === TelemetryType.Metric;",
      );
      expect(source).toContain("{isMetricSnapshot && telemetryQuery ? (");
      expect(panel).toContain("telemetryQuery={telemetryQuery}");
      expect(panel).toContain("evaluationWindow={telemetrySnapshotWindow}");
      expect(panel).toContain("seriesSummary={seriesSummary}");
      expect(panel).toContain("eventId={modelIdString}");
      expect(panel).toContain("startedAt={responseTimes.startedAt}");
      expect(panel).toContain("endedAt={durationEndDate}");
      expect(panel).toContain("stateTimeline={timelineDates}");

      /*
       * Every other kind of snapshot is the logs, traces or exceptions card
       * (issue #6251), the one the episode pages show, anchored on the
       * event: it picks its own time range around it.
       */
      const card: string = sliceBetween(
        source,
        "{telemetryQuery && !isMetricSnapshot && (",
        "/>",
      );
      expect(card).toContain("<TelemetrySnapshotPanel");
      expect(card).toContain("telemetryQuery={telemetryQuery}");
      expect(card).toContain("snapshotWindow={telemetrySnapshotWindow}");
      expect(card).toContain("startedAt={responseTimes.startedAt}");
      expect(card).toContain("endedAt={durationEndDate}");
      expect(card).toMatch(
        /eventNoun="(incident|alert)" subject=\{EventMetricSubject\.(Incident|Alert)\}/,
      );
      expect(source).not.toContain("<TelemetryCompanionSignalTabs");
    },
  );

  test("the episode panel hands a metric snapshot to the investigation, anchored on the episode", () => {
    const source: string = readSquashed(SNAPSHOT_HOSTS[2]![1]);

    expect(source).toContain(
      "if (props.telemetryQuery.telemetryType === TelemetryType.Metric) { return ( <EventMetricInvestigationPanel",
    );
    expect(
      sliceBetween(source, "<EventMetricInvestigationPanel", "/>"),
    ).toContain("evaluationWindow={props.snapshotWindow}");
  });

  test("the other tabs are handed the window the card shows, and what that window is", () => {
    const tabs: string = sliceBetween(
      readSquashed(SNAPSHOT_HOSTS[2]![1]),
      "<TelemetryCompanionSignalTabs",
      "primarySignalElement=",
    );

    expect(tabs).toContain(
      "snapshotWindow={hasWindow ? time.window : props.snapshotWindow}",
    );
    // So their copy names the zoomed part of the window, or the range picked.
    expect(tabs).toContain(
      "companionWindow={hasWindow ? getSnapshotCompanionWindow(time) : undefined}",
    );
  });

  test("every card of the snapshot carries its time range, Reset zoom and all, and none without a window", () => {
    const source: string = readSquashed(SNAPSHOT_HOSTS[2]![1]);

    expect(source).toContain(
      "const timeRangeControls: ReactElement | undefined = hasWindow ? ( <EventTimeRangeControls time={time}",
    );
    expect(source).toContain("snapshotWindowAlert={timeRangeControls}");
    // The Logs, Spans and Exceptions cards the primary can be.
    expect(source.split("rightElement={timeRangeControls}").length - 1).toBe(3);
    // The picker offers the card's own Reset zoom, wherever it sits.
    expect(
      readSquashed(
        `${DASHBOARD}/Components/Telemetry/EventTimeRangeControls.tsx`,
      ),
    ).toContain("<MetricInvestigationTimePicker investigation={time}");
  });

  test.each(SNAPSHOT_HOSTS.slice(0, 2))(
    "%s: a card's range and zoom belong to the event on screen (the page outlives a move to another one)",
    (_name: string, file: string) => {
      /*
       * The page shows its skeleton while it loads another event, which
       * unmounts the card: the next event starts from what its monitor
       * saw. (The page-level zoom it replaced was keyed on the event.)
       */
      expect(readSquashed(file)).toMatch(
        /if \(loadedModelId !== modelIdString\) \{ return \(? ?<EventOverviewSkeleton/,
      );
    },
  );
});

/*
 * A Logs, Traces or Exceptions snapshot: the primary is an explorer, and a
 * drag on its histogram must zoom the whole snapshot as a drag on a metric
 * snapshot's chart does. Behaviour: SnapshotExplorerPrimaryZoom.test.tsx
 * (the episode panel) and EventOverviewSnapshotExplorerZoom.test.tsx (the
 * incident and alert pages); the explorer's side of it:
 * ViewerFollowsEnclosingZoom.test.tsx.
 */
describe("a Logs, Traces or Exceptions snapshot's primary explorer follows the snapshot's zoom", () => {
  const EXPLORERS: Array<[string, string]> = [
    ["DashboardLogsViewer", "Log"],
    ["TracesViewer", "Span"],
    ["ExceptionsViewer", "ExceptionInstance"],
  ];

  const PANEL_SOURCE: string = SNAPSHOT_HOSTS[2]![1];

  test("each explorer primary sits inside the card's zoom", () => {
    const source: string = readSquashed(PANEL_SOURCE);

    for (const [explorer] of EXPLORERS) {
      expect(source).toContain(
        `<TimeRangeZoomProvider zoom={explorerZoom}> <${explorer}`,
      );
    }
    expect(
      source.split("<TimeRangeZoomProvider zoom={explorerZoom}>").length - 1,
    ).toBe(EXPLORERS.length);
    // Offered over the window the card shows, and none without a window.
    expect(source).toContain(
      "return hasWindow ? getExplorerZoom(time.zoom, time.window) : null;",
    );
  });

  test("each explorer primary is pinned to the window the card shows", () => {
    const source: string = readSquashed(PANEL_SOURCE);

    for (const [, model] of EXPLORERS) {
      expect(source).toContain(`explorerQuery as Query<${model}>`);
    }
    // Never the stored window alone: a pick or a zoom would not reach it.
    expect(source).not.toContain("telemetryQuery.telemetryQuery as Query<");
    expect(source).toContain(
      "return getSnapshotExplorerQuery({ telemetryType: telemetryQuery.telemetryType, storedQuery: telemetryQuery.telemetryQuery,",
    );
  });

  test("the card holds its time range: what the monitor saw first, the ranges around the event, kept in the URL", () => {
    const source: string = readSquashed(PANEL_SOURCE);
    const hook: string = sliceBetween(
      source,
      "useInvestigationTimeRange({",
      "});",
    );

    expect(hook).toContain("defaultSelection: EVENT_EVALUATED_SELECTION,");
    expect(hook).toContain("return getEventTimePresets(");
    expect(hook).toContain(
      "urlParamPrefix: snapshotWindow ? EVENT_TELEMETRY_TIME_URL_PREFIX : undefined,",
    );
  });

  test.each(SNAPSHOT_HOSTS.slice(0, 2))(
    "%s: renders no explorer of its own: the card does",
    (_name: string, file: string) => {
      const source: string = readSquashed(file);

      for (const [explorer] of EXPLORERS) {
        expect(source).not.toContain(`<${explorer}`);
      }
      expect(source).not.toContain("TimeRangeZoomProvider");
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

describe("a metric snapshot's investigation zooms as one, every tab of it (issue #5954)", () => {
  const PANEL: string = `${DASHBOARD}/Components/Telemetry/EventMetricInvestigationPanel.tsx`;
  const CARD: string = `${DASHBOARD}/Components/Metrics/Investigation/MetricInvestigation.tsx`;
  const PICKER: string = `${DASHBOARD}/Components/Metrics/Investigation/MetricInvestigationTimePicker.tsx`;

  test("the other tabs are handed the investigation's window, and its picker on every card", () => {
    const tabs: string = sliceBetween(
      readSquashed(PANEL),
      "<TelemetryCompanionSignalTabs",
      "primarySignalElement=",
    );

    expect(tabs).toContain("snapshotWindow={investigation.window}");
    expect(tabs).toContain('companionWindow="selected"');
    expect(tabs).toContain("snapshotWindowAlert={timePicker}");
  });

  test("the investigation's chart zooms the investigation, and resets only while zoomed", () => {
    const views: Array<string> = metricViewElements(readSquashed(CARD));

    expect(views).toHaveLength(1);
    const view: string = views[0]!;
    expect(view).toContain("data={investigation.metricViewData}");
    expect(view).toContain(
      "onTimeRangeSelect={investigation.zoom.zoomToTimeRange}",
    );
    expect(view).toContain(
      "onTimeRangeReset={ investigation.isZoomed ? investigation.zoom.resetZoom : undefined }",
    );
    expect(view).not.toContain("localChartZoom");
    expect(view).not.toContain("disableChartZoom");
  });

  test("the picker offers the investigation's own Reset zoom, wherever it sits", () => {
    expect(readSquashed(PICKER)).toContain(
      "<TimeRangeZoomProvider zoom={investigation.zoom}> <ResetTimeRangeZoomButton /> </TimeRangeZoomProvider>",
    );
  });

  test("a metric monitor's own card zooms through the same investigation (issue #5759)", () => {
    const card: string = readSquashed(
      `${DASHBOARD}/Components/Monitor/MetricMonitor/MonitorMetricsCard.tsx`,
    );

    // No chart of its own: the investigation draws them, zoom and all.
    expect(metricViewElements(card)).toHaveLength(0);
    expect(card).toContain(
      "<MetricInvestigation investigation={investigation}",
    );
  });
});

describe("the Root Cause cards zoom through the event's investigation (issues #6249 and #6304)", () => {
  const CARD: string = `${DASHBOARD}/Components/Telemetry/EventRootCauseMetricChart.tsx`;
  const INCIDENT_CARD: string = `${DASHBOARD}/Components/Incident/IncidentRootCauseMetricChart.tsx`;
  const ALERT_CARD: string = `${DASHBOARD}/Components/Alert/AlertRootCauseMetricChart.tsx`;

  test("no chart of its own: the investigation draws it, zoom and way back included", () => {
    const source: string = readSquashed(CARD);

    expect(metricViewElements(source)).toHaveLength(0);
    expect(source).not.toContain("TimeRangeZoom");

    const panel: string = sliceBetween(
      source,
      "<EventMetricInvestigationPanel",
      "/>",
    );
    // The event it reads: the incident, or the alert.
    expect(panel).toContain("subject={reader.subject}");
    expect(panel).toContain("eventId={eventId}");
    // The metrics alone, beside the root cause: the Overview has the tabs.
    expect(panel).toContain("showsCompanionTabs={false}");
    // Names of its own in the URL: never the Overview card's.
    expect(panel).toContain("urlParamPrefix={ROOT_CAUSE_METRICS_URL_PREFIX}");
    expect(source).toContain(
      'export const ROOT_CAUSE_METRICS_URL_PREFIX: string = "rootCauseMetrics";',
    );
  });

  test.each([
    [
      "the incident's",
      INCIDENT_CARD,
      "EventMetricSubject.Incident",
      "INCIDENT_ROOT_CAUSE_READER",
    ],
    [
      "the alert's",
      ALERT_CARD,
      "EventMetricSubject.Alert",
      "ALERT_ROOT_CAUSE_READER",
    ],
  ])(
    "%s Root Cause page shows that one card, reading its own event",
    (_name: string, file: string, subject: string, reader: string) => {
      const source: string = readSquashed(file);

      // Nothing of its own to draw, zoom or keep in the URL: the card's.
      expect(metricViewElements(source)).toHaveLength(0);
      expect(source).not.toContain("TimeRangeZoom");
      expect(source).not.toContain("<EventMetricInvestigationPanel");
      expect(source).not.toContain("urlParamPrefix");

      expect(source).toContain(`subject: ${subject},`);
      expect(
        sliceBetween(source, "<EventRootCauseMetricChart", "/>"),
      ).toContain(`reader={${reader}}`);
    },
  );

  test("each Root Cause page shows its card beside the root cause", () => {
    expect(
      readSquashed(`${DASHBOARD}/Pages/Incidents/View/RootCause.tsx`),
    ).toContain("<IncidentRootCauseMetricChart incidentId={modelId} />");
    expect(
      readSquashed(`${DASHBOARD}/Pages/Alerts/View/RootCause.tsx`),
    ).toContain("<AlertRootCauseMetricChart alertId={modelId} />");
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
