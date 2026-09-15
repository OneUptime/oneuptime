import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type ReadSourceFunction = (...relativeParts: Array<string>) => string;

const readSource: ReadSourceFunction = (
  ...relativeParts: Array<string>
): string => {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const INCIDENT_VIEW: string = readSource(
  "Pages",
  "Incidents",
  "View",
  "Index.tsx",
);
const ALERT_VIEW: string = readSource("Pages", "Alerts", "View", "Index.tsx");
const CHANGE_INCIDENT_STATE: string = readSource(
  "Components",
  "Incident",
  "ChangeState.tsx",
);
const CHANGE_ALERT_STATE: string = readSource(
  "Components",
  "Alert",
  "ChangeState.tsx",
);
const EVENT_STATUS_PANEL: string = readSource(
  "Components",
  "EventView",
  "EventStatusPanel.tsx",
);
const INVESTIGATION_PANEL: string = readSource(
  "Components",
  "AI",
  "InvestigationPanel.tsx",
);

/*
 * The incident page and the alert page carry the same AI header: both lift
 * the status (and, once a report exists, its summary) out of the one poller
 * InvestigationPanel already runs, and hand it to their ChangeState header.
 */
const EVENT_PAGES: Array<
  [string, { view: string; changeState: string; endpoint: string }]
> = [
  [
    "incident",
    {
      view: INCIDENT_VIEW,
      changeState: CHANGE_INCIDENT_STATE,
      endpoint: "/ai-investigation/incident",
    },
  ],
  [
    "alert",
    {
      view: ALERT_VIEW,
      changeState: CHANGE_ALERT_STATE,
      endpoint: "/ai-investigation/alert",
    },
  ],
];

describe.each(EVENT_PAGES)(
  "%s AI investigation header wiring",
  (
    _name: string,
    sources: { view: string; changeState: string; endpoint: string },
  ) => {
    test("lifts status from the existing investigation panel poller", () => {
      expect(sources.view).toContain(
        "onStatusChange={onAIInvestigationStatusChange}",
      );
      expect(sources.view).toContain(
        "aiInvestigationStatus={currentAIInvestigationStatus}",
      );
      expect(sources.view).toContain(
        "aiInvestigationStatus.subjectId === modelIdString",
      );
    });

    test("lifts the completed report's summary the same way, keyed by subject", () => {
      expect(sources.view).toContain(
        "onReportSummaryChange={onAIInvestigationReportSummaryChange}",
      );
      expect(sources.view).toContain(
        "aiInvestigationSummary={currentAIInvestigationSummary}",
      );
      expect(sources.view).toContain(
        "aiInvestigationSummary.subjectId === modelIdString",
      );
    });

    test("does not add another investigation request to the page", () => {
      expect(sources.view).not.toContain(sources.endpoint);
      expect(sources.view).not.toContain("setInterval");
    });

    test("shows the notice while active, or once completed with a summary", () => {
      // Tolerant of how prettier wraps the call's arguments.
      expect(sources.changeState).toMatch(
        /shouldShowAIInvestigationHeaderStatus\(\s*props\.aiInvestigationStatus,\s*props\.aiInvestigationSummary,?\s*\)/,
      );
      expect(sources.changeState).toContain("<AIInvestigationHeaderStatus");
      expect(sources.changeState).toContain(
        "summary={props.aiInvestigationSummary}",
      );
      expect(sources.changeState).toContain(
        "onViewProgress={scrollToAIInvestigationPanel}",
      );
      expect(sources.changeState).toContain("<AIInvestigationStatusLiveRegion");
    });

    test("puts the notice inside the shared titled header card", () => {
      expect(sources.changeState).toContain("headerNotice={");
    });
  },
);

describe("shared header and panel contracts", () => {
  test("the titled header card renders the notice under the pills", () => {
    expect(EVENT_STATUS_PANEL).toContain("props.headerNotice &&");
    expect(EVENT_STATUS_PANEL).toContain(
      '<div className="mt-3">{props.headerNotice}</div>',
    );
  });

  test("reuses one stable, focusable target for the progress action", () => {
    expect(INVESTIGATION_PANEL).toContain("id={AI_INVESTIGATION_PANEL_ID}");
    expect(INVESTIGATION_PANEL).toContain("tabIndex={-1}");
    expect(INVESTIGATION_PANEL).toContain('aria-label="AI Investigation"');
  });

  test("keeps polling and status ownership in InvestigationPanel", () => {
    expect(INVESTIGATION_PANEL).toContain(
      "const isActive: boolean = isRunning || isQueued",
    );
    expect(INVESTIGATION_PANEL).toContain("setTimeout(() =>");
    expect(INVESTIGATION_PANEL).not.toContain("setInterval(() =>");
    expect(INVESTIGATION_PANEL).toContain(
      "onStatusChangeRef.current?.(runStatus)",
    );
    expect(INVESTIGATION_PANEL).toContain(
      "const subjectIdString: string = props.subjectId.toString()",
    );
  });
});
