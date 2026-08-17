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

  test("scheduled maintenance guidance names query_scheduled_maintenance", () => {
    const section: string = buildPageContextSection({
      type: AIChatPageContextType.ScheduledMaintenanceEvent,
      entityId: ENTITY_ID,
    });

    expect(section).toContain(
      `query_scheduled_maintenance using scheduledMaintenanceId="${ENTITY_ID}"`,
    );
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
    [
      AIChatPageContextType.ScheduledMaintenanceList,
      "query_scheduled_maintenance",
    ],
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

  /*
   * An autonomous investigation may already have run for the incident/alert
   * the user is looking at. The page guidance must send the model to that
   * finished work (get_ai_investigation) and to the timeline tool for
   * "what's the latest" — otherwise it re-derives everything from raw
   * telemetry on every question.
   */
  test("incident guidance builds on the AI investigation and the timeline", () => {
    const section: string = buildPageContextSection({
      type: AIChatPageContextType.Incident,
      entityId: ENTITY_ID,
    });

    expect(section).toContain("get_ai_investigation");
    expect(section).toContain("build on (and cite) its findings");
    expect(section).toContain("get_incident_timeline");
  });

  test("alert guidance builds on the AI investigation and the timeline", () => {
    const section: string = buildPageContextSection({
      type: AIChatPageContextType.Alert,
      entityId: ENTITY_ID,
    });

    expect(section).toContain("get_ai_investigation");
    expect(section).toContain("build on (and cite) its findings");
    expect(section).toContain("get_alert_timeline");
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

/*
 * open_code_pull_request now opens the PR ready for review rather than as a
 * draft. The system prompt describes that tool to the model in its own words,
 * so a stale sentence here makes the model tell the user it filed a draft and
 * that they should go mark it ready — for a PR that already is.
 *
 * What must stay is the part that was never about the draft flag: this is a
 * proposal off the default branch that a human reviews and merges.
 */
describe("buildObservabilityChatSystemPrompt — how it describes code changes", () => {
  const prompt: string = buildObservabilityChatSystemPrompt({
    currentTime: new Date("2026-07-16T00:00:00Z"),
    permissionMode: AIChatPermissionMode.AskForApproval,
  });

  test("does not tell the model the pull request is a draft", () => {
    expect(prompt.toLowerCase()).not.toContain("draft pull request");
  });

  test("says the pull request opens ready for review", () => {
    expect(prompt).toContain("ready for review");
  });

  test("still says the change goes off the default branch for a human", () => {
    expect(prompt).toContain("off the default branch");
    expect(prompt).toContain("for a human to review");
  });

  test("still prefers open_code_pull_request over committing to a branch", () => {
    expect(prompt).toContain(
      "open_code_pull_request is the right tool almost always",
    );
  });
});

/*
 * The platform-questions paragraph maps each class of "how is this being
 * handled" question to the exact tool that answers it, so the model never
 * tries to answer on-call or status-page questions from telemetry.
 */
describe("buildObservabilityChatSystemPrompt — platform questions guidance", () => {
  const prompt: string = buildObservabilityChatSystemPrompt({
    currentTime: new Date("2026-07-16T00:00:00Z"),
    permissionMode: AIChatPermissionMode.ReadOnly,
  });

  test.each<[string, string]>([
    ["who is on call", "get_on_call_status"],
    ["escalation", "query_on_call_policies"],
    ["page delivery", "query_on_call_pages"],
    ["ownership", "query_teams"],
    ["runbook contents", "query_runbooks"],
    ["public status", "query_status_pages"],
    ["subscriber announcements", "query_status_page_announcements"],
    ["SLO budget", "query_slos"],
    ["automation failures", "query_workflows"],
    ["probe health", "query_probes"],
    ["early warnings", "query_ai_insights"],
  ])("%s questions route to %s", (_label: string, tool: string) => {
    expect(prompt).toContain(tool);
  });

  test("tells the model these beat telemetry for platform questions", () => {
    expect(prompt).toContain(
      "Platform questions have direct tools — answer them from those, not from telemetry",
    );
  });
});

describe("buildObservabilityChatSystemPrompt — clarifying question policy", () => {
  const prompt: string = buildObservabilityChatSystemPrompt({
    currentTime: new Date("2026-07-16T00:00:00Z"),
    permissionMode: AIChatPermissionMode.AskForApproval,
  });

  test("asks one focused question only when ambiguity is costly", () => {
    expect(prompt).toContain(
      "which service? which time window? which environment?",
    );
    expect(prompt).toContain("one focused clarifying question");
  });

  test("minor ambiguity proceeds with a stated assumption", () => {
    expect(prompt).toContain("state the assumption explicitly");
  });
});

/*
 * Tool results arrive sanitized. Without this section the model quotes
 * "[redacted-email]" back to the user as if it were the literal value, or
 * treats a "[truncated]" tail as the end of the data.
 */
describe("buildObservabilityChatSystemPrompt — sanitization markers", () => {
  const prompt: string = buildObservabilityChatSystemPrompt({
    currentTime: new Date("2026-07-16T00:00:00Z"),
    permissionMode: AIChatPermissionMode.AskForApproval,
  });

  test("names the redaction placeholders and forbids quoting them as values", () => {
    expect(prompt).toContain("[redacted-email]");
    expect(prompt).toContain("[redacted-ip]");
    expect(prompt).toContain("never as literal data values");
  });

  test("says what to answer when the redacted value is the answer", () => {
    expect(prompt).toContain("the value is redacted in this view");
  });

  test("explains truncation and how to see the rest", () => {
    expect(prompt).toContain('"... [truncated]"');
    expect(prompt).toContain("fetch the single record");
  });
});

describe("buildObservabilityChatSystemPrompt — investigation answer shape", () => {
  const prompt: string = buildObservabilityChatSystemPrompt({
    currentTime: new Date("2026-07-16T00:00:00Z"),
    permissionMode: AIChatPermissionMode.AskForApproval,
  });

  test("leads with the finding and separates facts from hypotheses", () => {
    expect(prompt).toContain("lead with the finding");
    expect(prompt).toContain("confirmed facts (each cited) from hypotheses");
  });

  test("states the window and what comes next when inconclusive", () => {
    expect(prompt).toContain("time window you examined");
    expect(prompt).toContain("what you would check next");
  });
});

/*
 * The action list now includes internal notes and kicking off an autonomous
 * investigation. Every permission mode must name these tools — the acting
 * modes so the model uses them, read-only so it can explain what switching
 * modes unlocks.
 */
describe("buildObservabilityChatSystemPrompt — action guidance per mode", () => {
  test.each<[AIChatPermissionMode]>([
    [AIChatPermissionMode.ReadOnly],
    [AIChatPermissionMode.AskForApproval],
    [AIChatPermissionMode.AutoRun],
  ])(
    "%s names the note and investigation tools",
    (mode: AIChatPermissionMode) => {
      const prompt: string = buildObservabilityChatSystemPrompt({
        currentTime: new Date("2026-07-16T00:00:00Z"),
        permissionMode: mode,
      });

      expect(prompt).toContain("create_incident_note");
      expect(prompt).toContain("create_alert_note");
      expect(prompt).toContain("start_investigation");
    },
  );

  test.each<[AIChatPermissionMode]>([
    [AIChatPermissionMode.AskForApproval],
    [AIChatPermissionMode.AutoRun],
  ])(
    "%s contrasts private notes with the public status update",
    (mode: AIChatPermissionMode) => {
      const prompt: string = buildObservabilityChatSystemPrompt({
        currentTime: new Date("2026-07-16T00:00:00Z"),
        permissionMode: mode,
      });

      expect(prompt).toContain("never notifies status page subscribers");
      expect(prompt).toContain(
        "post_incident_status_update is the public counterpart",
      );
    },
  );
});
