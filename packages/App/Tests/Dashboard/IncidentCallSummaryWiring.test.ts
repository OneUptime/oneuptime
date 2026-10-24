import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT ONEUPTIME AI READ IN AN INCIDENT CALL'S TRANSCRIPT (issue #4875) is
 * part of the incident's one AI card, not a card of its own: a flat
 * section the incident page hands the card, after OneUptime AI's own
 * report and before the conversation. The Video Call card's Review goes
 * there. An alert's calls keep no transcript, so its page hands none.
 *
 * How the section and the card render is covered in Common/Tests/App/
 * Dashboard (CallSummarySection, CallTranscriptBlock, InvestigationPanel)
 * and in the browser suite in packages/E2E/EventOverview. These read the
 * sources and hold the wiring.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

// The code alone: comments are prose and may mention what is forbidden.
function readSource(...relativeParts: Array<string>): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const INCIDENT_VIEW: string = readSource(
  "Pages",
  "Incidents",
  "View",
  "Index.tsx",
);
const ALERT_VIEW: string = readSource("Pages", "Alerts", "View", "Index.tsx");
const PANEL: string = readSource("Components", "AI", "InvestigationPanel.tsx");
const SECTION: string = readSource(
  "Components",
  "AI",
  "CallSummary",
  "CallSummarySection.tsx",
);
const CALLS_CARD: string = readSource(
  "Components",
  "VideoCall",
  "EventVideoCallsCard.tsx",
);

describe("the incident page", () => {
  test("hands the AI card the section, made from the calls the Video Call card shows", () => {
    expect(INCIDENT_VIEW).toContain("renderCallSummaries={() => {");
    expect(INCIDENT_VIEW).toMatch(
      /<CallSummarySection incidentId=\{modelId\} calls=\{videoCalls\.calls as Array<IncidentVideoCall>\}/,
    );
  });

  test("reads the calls and the feed again when a suggestion is used or dismissed", () => {
    const section: string = INCIDENT_VIEW.slice(
      INCIDENT_VIEW.indexOf("<CallSummarySection"),
    );
    const onChanged: string = section.slice(
      section.indexOf("onChanged={() => {"),
      section.indexOf("}}") + 2,
    );

    expect(onChanged).toContain("videoCalls.refresh();");
    expect(onChanged).toContain("refreshFeed();");
  });

  test("an alert's page hands none: an alert's calls keep no transcript", () => {
    expect(ALERT_VIEW).not.toContain("renderCallSummaries");
    expect(ALERT_VIEW).not.toContain("CallSummarySection");
  });
});

describe("the AI card", () => {
  test("renders the section after its own report and before the conversation", () => {
    const callSummaries: number = PANEL.indexOf(
      "props.renderCallSummaries ? props.renderCallSummaries() : <></>",
    );
    const conversation: number = PANEL.indexOf(
      "props.renderConversation({ investigationStage, fold: conversationFold, })",
    );

    expect(callSummaries).toBeGreaterThan(-1);
    expect(conversation).toBeGreaterThan(callSummaries);
  });

  test("the section is never a card of its own", () => {
    expect(SECTION).not.toMatch(/<Card[\s>]/);
    expect(SECTION).not.toMatch(/import Card\b/);
  });
});

describe("the Video Call card", () => {
  test("Review opens the call's section on the AI card, or the card while it is not there yet", () => {
    expect(CALLS_CARD).toContain(
      "document.getElementById( getCallSummarySectionId(callId), )",
    );
    expect(CALLS_CARD).toContain("scrollToAIInvestigationPanel();");
  });

  test("keeps a transcript only for an incident's calls", () => {
    expect(CALLS_CARD).toContain(
      "if (props.kind !== VideoCallEventKind.Incident) { return undefined; }",
    );
  });
});
