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
const CHANGE_INCIDENT_STATE: string = readSource(
  "Components",
  "Incident",
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

describe("incident AI investigation header wiring", () => {
  test("lifts status from the existing investigation panel poller", () => {
    expect(INCIDENT_VIEW).toContain(
      "onStatusChange={onAIInvestigationStatusChange}",
    );
    expect(INCIDENT_VIEW).toContain(
      "aiInvestigationStatus={currentAIInvestigationStatus}",
    );
    expect(INCIDENT_VIEW).toContain(
      "aiInvestigationStatus.subjectId === modelIdString",
    );
  });

  test("does not add another investigation request to the incident page", () => {
    expect(INCIDENT_VIEW).not.toContain("/ai-investigation/incident");
    expect(INCIDENT_VIEW).not.toContain("setInterval");
  });

  test("shows the notice only for an active investigation", () => {
    expect(CHANGE_INCIDENT_STATE).toContain(
      "isActiveAIInvestigationStatus(props.aiInvestigationStatus)",
    );
    expect(CHANGE_INCIDENT_STATE).toContain("<AIInvestigationHeaderStatus");
    expect(CHANGE_INCIDENT_STATE).toContain(
      "onViewProgress={scrollToAIInvestigationPanel}",
    );
    expect(CHANGE_INCIDENT_STATE).toContain("<AIInvestigationStatusLiveRegion");
  });

  test("puts the notice inside the shared titled header card", () => {
    expect(CHANGE_INCIDENT_STATE).toContain("headerNotice={");
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
