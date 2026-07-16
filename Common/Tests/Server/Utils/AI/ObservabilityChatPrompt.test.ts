import {
  buildObservabilityChatSystemPrompt,
  buildPageContextSection,
} from "../../../../Server/Utils/AI/Chat/ObservabilityChatPrompt";
import AIChatPageContextType, {
  AIChatPageContext,
} from "../../../../Types/AI/AIChatPageContext";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import { describe, expect, test } from "@jest/globals";

const ENTITY_ID: string = "0f10509d-6656-4a08-b957-235fd4e8c52e";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";

describe("buildPageContextSection", () => {
  test("returns an empty string without a context", () => {
    expect(buildPageContextSection(undefined)).toBe("");
  });

  /*
   * Each entity type must name the tool (and its id argument) that fetches
   * the entity — that pairing is what lets the model resolve "this incident"
   * without guessing.
   */
  test.each<[AIChatPageContextType, string]>([
    [
      AIChatPageContextType.Incident,
      `query_incidents using incidentId="${ENTITY_ID}"`,
    ],
    [AIChatPageContextType.Alert, `query_alerts using alertId="${ENTITY_ID}"`],
    [
      AIChatPageContextType.Monitor,
      `query_monitors using monitorId="${ENTITY_ID}"`,
    ],
    [AIChatPageContextType.TelemetryService, `serviceId="${ENTITY_ID}"`],
    [
      AIChatPageContextType.Exception,
      `find_code_for_exception with exceptionId="${ENTITY_ID}"`,
    ],
  ])(
    "%s guidance names the fetch tool and id",
    (type: AIChatPageContextType, expected: string) => {
      const section: string = buildPageContextSection({
        type: type,
        entityId: ENTITY_ID,
      });

      expect(section).toContain("## Current page context");
      expect(section).toContain(expected);
    },
  );

  test("trace guidance uses get_trace with the hex trace id", () => {
    const section: string = buildPageContextSection({
      type: AIChatPageContextType.Trace,
      entityId: TRACE_ID,
    });

    expect(section).toContain(`get_trace using traceId="${TRACE_ID}"`);
  });

  test("scheduled maintenance guidance is honest about missing tooling", () => {
    const section: string = buildPageContextSection({
      type: AIChatPageContextType.ScheduledMaintenanceEvent,
      entityId: ENTITY_ID,
    });

    expect(section).toContain("no tool that fetches a scheduled maintenance");
    expect(section).toContain("recent_changes");
  });

  test("the entity title is included in quotes when present", () => {
    const section: string = buildPageContextSection({
      type: AIChatPageContextType.Incident,
      entityId: ENTITY_ID,
      entityTitle: "#42 Payment API down",
    });

    expect(section).toContain('titled "#42 Payment API down"');
  });

  test.each<[AIChatPageContextType, string]>([
    [AIChatPageContextType.IncidentsList, "query_incidents"],
    [AIChatPageContextType.AlertsList, "query_alerts"],
    [AIChatPageContextType.MonitorsList, "query_monitors"],
    [AIChatPageContextType.ScheduledMaintenanceList, "recent_changes"],
    [AIChatPageContextType.LogsExplorer, "log_histogram"],
    [AIChatPageContextType.TracesExplorer, "query_traces"],
    [AIChatPageContextType.MetricsExplorer, "query_metrics"],
    [AIChatPageContextType.ExceptionsList, "top_exceptions"],
  ])(
    "area context %s names its primary tool",
    (type: AIChatPageContextType, expectedTool: string) => {
      const context: AIChatPageContext = { type: type };
      const section: string = buildPageContextSection(context);

      expect(section).toContain("## Current page context");
      expect(section).toContain(expectedTool);
    },
  );

  test("every section reminds the model that context is not evidence", () => {
    const section: string = buildPageContextSection({
      type: AIChatPageContextType.Incident,
      entityId: ENTITY_ID,
    });

    expect(section).toContain("It is not evidence");
  });
});

describe("buildObservabilityChatSystemPrompt with page context", () => {
  test("omits the section when no context is passed", () => {
    const prompt: string = buildObservabilityChatSystemPrompt({
      currentTime: new Date("2026-07-16T00:00:00Z"),
      permissionMode: AIChatPermissionMode.AskForApproval,
    });

    expect(prompt).not.toContain("## Current page context");
  });

  test("includes the section without displacing the hard rules", () => {
    const prompt: string = buildObservabilityChatSystemPrompt({
      currentTime: new Date("2026-07-16T00:00:00Z"),
      permissionMode: AIChatPermissionMode.AskForApproval,
      pageContext: {
        type: AIChatPageContextType.Incident,
        entityId: ENTITY_ID,
        entityTitle: "Payment API down",
      },
    });

    expect(prompt).toContain("## Current page context");
    expect(prompt).toContain(`incidentId="${ENTITY_ID}"`);
    // The binding trust rules survive untouched.
    expect(prompt).toContain("## Hard rules");
    expect(prompt).toContain("Cite your sources.");
  });
});
