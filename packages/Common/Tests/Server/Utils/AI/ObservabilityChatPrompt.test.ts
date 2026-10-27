import {
  ANSWER_STYLE_SECTION,
  INCIDENTS_ALERTS_AND_MONITORS_SECTION,
  INFRASTRUCTURE_COMMANDS_GUIDANCE,
  buildObservabilityChatSystemPrompt,
  buildPageContextSection,
} from "../../../../Server/Utils/AI/Chat/ObservabilityChatPrompt";
import { RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME } from "../../../../Server/Utils/AI/ResourceAccess/ResourceAccessToolNames";
import { RUN_KUBECTL_TOOL_NAME } from "../../../../Types/Kubernetes/KubernetesClusterAiAccessToolNames";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../../Types/ResourceAiAgent/AiResourceType";
import AIChatPageContextType, {
  AIChatPageContext,
  AIChatPageContextHelper,
} from "../../../../Types/AI/AIChatPageContext";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import {
  AIResourceSubresourceKind,
  AIResourceType,
} from "../../../../Types/AI/AIResourceContext";
/*
 * Toolbox/Index MUST be imported before any individual tool module. The
 * toolbox sits in an import cycle (tool -> service -> ... -> AIToolbox), so
 * entering through a tool module first re-enters Index before its tools array
 * is assigned and leaves undefined holes in it. Production always enters
 * through Index, which is the order reproduced here.
 */
import AIToolbox from "../../../../Server/Utils/AI/Toolbox/Index";
import {
  QueryIncidentsTool,
  SearchIncidentsTool,
} from "../../../../Server/Utils/AI/Toolbox/IncidentTools";
import {
  QueryTelemetryResourcesTool,
  QueryResourceTelemetryTool,
} from "../../../../Server/Utils/AI/Toolbox/ResourceTools";
import { QueryAlertsTool } from "../../../../Server/Utils/AI/Toolbox/AlertTools";
import { QueryMonitorsTool } from "../../../../Server/Utils/AI/Toolbox/MonitorTools";
import { SearchSecurityEventsTool } from "../../../../Server/Utils/AI/Toolbox/SecurityEventTools";
import { ObservabilityTool } from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import { JSONObject } from "../../../../Types/JSON";
import {
  AI_AFFECTED_RESOURCE_KINDS,
  AI_RESOURCE_TYPES_NOT_LINKABLE,
  AiAffectedResourceKind,
  AiAffectedResourceKindInfo,
} from "../../../../Types/AI/AiAffectedResources";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import {
  HostAlertTemplate,
  getHostAlertTemplateById,
} from "../../../../Types/Monitor/HostAlertTemplates";
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
      AIChatPageContextType.RumApplication,
      `query_rum_applications using rumApplicationId="${ENTITY_ID}"`,
    ],
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
    [AIChatPageContextType.RumApplications, "query_rum_applications"],
    [AIChatPageContextType.TelemetryServicesList, "lookup_context"],
  ])(
    "area context %s names its primary tool",
    (type: AIChatPageContextType, expectedTool: string) => {
      const context: AIChatPageContext = { type: type };
      const section: string = buildPageContextSection(context);

      expect(section).toContain("## Current page context");
      expect(section).toContain(expectedTool);
    },
  );

  /*
   * Regression for #3552. The incidents list ships a suggested prompt card
   * asking "which incidents are currently active or unresolved, and what
   * state is each in?" — and the model replied that it had no tool for that
   * and could only act on one incident once given an incidentId. It was not
   * hallucinating: this guidance summarised the tool as "query_incidents
   * (recent incidents, or one by incidentId)", a NARROWER capability claim
   * than query_incidents' own schema, injected on that exact page. The model
   * paraphrased the parenthetical back as a denial. Page guidance must name
   * the affordance the page's own suggested prompts depend on.
   */
  test('incidents list guidance offers state="active" for unresolved incidents', () => {
    const section: string = buildPageContextSection({
      type: AIChatPageContextType.IncidentsList,
    });

    expect(section).toContain('state="active"');
    expect(section).toContain("unresolved");
    // The exact phrasing the model quoted back as "I have no such tool".
    expect(section).not.toContain("(recent incidents, or one by incidentId)");
  });

  /*
   * The alerts list carries the same "what is firing right now?" suggested
   * prompt, and query_alerts has the same state="active" affordance. Its
   * guidance used to stop dead at the tool name ("answered with
   * query_alerts."), which is the same under-claim one page over.
   */
  test('alerts list guidance offers state="active" for unresolved alerts', () => {
    const section: string = buildPageContextSection({
      type: AIChatPageContextType.AlertsList,
    });

    expect(section).toContain('state="active"');
    expect(section).toContain("unresolved");
    expect(section).not.toContain("answered with query_alerts.");
  });

  /*
   * "What is down right now?" on the monitors list is query_monitors'
   * problemsOnly flag. Naming only the tool left the model to guess that a
   * plain listing was the best it could do.
   */
  test("monitors list guidance offers problemsOnly for what is down now", () => {
    const section: string = buildPageContextSection({
      type: AIChatPageContextType.MonitorsList,
    });

    expect(section).toContain("problemsOnly");
    expect(section).not.toContain("answered with query_monitors.");
  });

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

  /*
   * buildPageContextSection passing is worthless if the section never makes
   * it into the prompt: the assembled string is what actually reaches the
   * model. #3552 was reported by a user sitting on the incidents list, so
   * that context is asserted end to end.
   */
  test('an incidents list context carries state="active" into the prompt', () => {
    const prompt: string = buildObservabilityChatSystemPrompt({
      currentTime: new Date("2026-07-16T00:00:00Z"),
      permissionMode: AIChatPermissionMode.ReadOnly,
      pageContext: {
        type: AIChatPageContextType.IncidentsList,
      },
    });

    expect(prompt).toContain("## Current page context");
    expect(prompt).toContain('state="active"');
    expect(prompt).not.toContain("(recent incidents, or one by incidentId)");
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

/*
 * How an answer reads. The maintainer, of Ask AI: "The ask AI is very
 * noisy as well." Answers opened with a preamble, walked through every
 * query, listed the sources the conversation already draws, and closed by
 * offering more help. One answer style, for every surface the prompt
 * serves: Ask AI and the incident's conversation (every mode), and the
 * read-only Slack, Microsoft Teams and investigation runs.
 */
describe("buildObservabilityChatSystemPrompt — a quiet answer", () => {
  test.each<[AIChatPermissionMode]>([
    [AIChatPermissionMode.ReadOnly],
    [AIChatPermissionMode.AskForApproval],
    [AIChatPermissionMode.AutoRun],
  ])("%s ends with the one answer style, once", (mode: AIChatPermissionMode) => {
    const prompt: string = buildObservabilityChatSystemPrompt({
      currentTime: new Date("2026-07-16T00:00:00Z"),
      permissionMode: mode,
    });

    expect(prompt.endsWith(`## Answer style\n\n${ANSWER_STYLE_SECTION}`)).toBe(
      true,
    );
    expect(prompt.split("## Answer style")).toHaveLength(2);
    // The old, softer line is gone rather than kept beside the new ones.
    expect(prompt).not.toContain("Be concise.");
  });

  test("the answer leads: no preamble, and the question is not said back", () => {
    expect(ANSWER_STYLE_SECTION).toContain(
      "Lead with the answer: its first sentence answers the question.",
    );
    expect(ANSWER_STYLE_SECTION).toContain(
      'No preamble ("Great question", "Here is what I found", "Based on the data")',
    );
    expect(ANSWER_STYLE_SECTION).toContain("do not restate the question");
  });

  test("its work is not narrated, but an empty query that matters is still named", () => {
    expect(ANSWER_STYLE_SECTION).toContain("Do not narrate your work.");
    expect(ANSWER_STYLE_SECTION).toContain(
      "name a query only when it matters to the answer, such as one that came back empty",
    );
    // Hard rule 1 still says what to do when the data is not there.
    const prompt: string = buildObservabilityChatSystemPrompt({
      currentTime: new Date("2026-07-16T00:00:00Z"),
      permissionMode: AIChatPermissionMode.AskForApproval,
    });
    expect(prompt).toContain(
      "state exactly which queries you ran and what came back empty",
    );
  });

  test("short unless asked, and a later format still wins", () => {
    expect(ANSWER_STYLE_SECTION).toContain(
      "Keep it short and direct: a sentence or two, or a few bullets, unless the person asks for detail or later instructions give a format.",
    );
    expect(ANSWER_STYLE_SECTION).toContain(
      "Use Markdown only where it helps",
    );
  });

  test("it stops when it is done: no summary, no offer of more help, no list of sources", () => {
    expect(ANSWER_STYLE_SECTION).toContain(
      "Stop when the answer is complete: no closing summary, no offer of more help, and no list of your sources.",
    );
  });

  test("it still cites each claim inline: the sources are drawn, the markers are its own", () => {
    const prompt: string = buildObservabilityChatSystemPrompt({
      currentTime: new Date("2026-07-16T00:00:00Z"),
      permissionMode: AIChatPermissionMode.AskForApproval,
    });

    expect(prompt).toContain(
      "Put the matching citation marker immediately after each factual claim it supports.",
    );
  });

  test("an approval card is not said twice: no description before it, no asking in words", () => {
    const prompt: string = buildObservabilityChatSystemPrompt({
      currentTime: new Date("2026-07-16T00:00:00Z"),
      permissionMode: AIChatPermissionMode.AskForApproval,
    });

    expect(prompt).toContain(
      "The card already says what the action will do: do not describe it again before it, and do not ask for approval in words.",
    );
    expect(prompt).toContain(
      "If an action is denied, say in one sentence that it was not done, and continue helping.",
    );
    expect(prompt).toContain(
      "Never claim an action happened unless the tool result confirms it.",
    );
  });

  test("an action run at once is said in one sentence, not listed again under its card", () => {
    const prompt: string = buildObservabilityChatSystemPrompt({
      currentTime: new Date("2026-07-16T00:00:00Z"),
      permissionMode: AIChatPermissionMode.AutoRun,
    });

    expect(prompt).toContain(
      "After an action succeeds, say in one sentence what you did: the card under your answer shows the record it created or changed, so do not list its details again.",
    );
    expect(prompt).not.toContain("tell the user exactly what you did");
  });

  test("read-only says nothing about cards it cannot leave", () => {
    const prompt: string = buildObservabilityChatSystemPrompt({
      currentTime: new Date("2026-07-16T00:00:00Z"),
      permissionMode: AIChatPermissionMode.ReadOnly,
    });

    expect(prompt).not.toContain("The card already says what the action will do");
    expect(prompt).not.toContain("the card under your answer shows the record");
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

/*
 * The page guidance is a SUMMARY of tools the model also receives in full.
 * When the summary claims LESS than the schema, the model believes the
 * summary — that is #3552. These tests assert both halves at once: that the
 * tool really does take the argument, and that the page whose suggested
 * prompts depend on it says so. Adding an area page means adding a row here,
 * or deciding explicitly that the page has no "what is wrong right now?"
 * affordance to advertise.
 *
 * A type alias rather than an interface on purpose: jest's object-form
 * test.each is typed against Record<string, unknown>, which an interface does
 * not satisfy (it has no implicit index signature).
 */
type AreaAffordanceCase = {
  type: AIChatPageContextType;
  tool: ObservabilityTool;
  // The tool argument that answers "what is wrong RIGHT NOW?" on this page.
  argument: string;
  // The enum value the model must pass, or null when the argument is a flag.
  enumValue: string | null;
  // The literal text the page guidance must use to name the affordance.
  guidancePhrase: string;
};

function getSchemaProperty(
  tool: ObservabilityTool,
  argument: string,
): JSONObject | undefined {
  const properties: JSONObject =
    (tool.inputSchema["properties"] as JSONObject | undefined) || {};

  return properties[argument] as JSONObject | undefined;
}

describe("page guidance stays in sync with the tool schemas it summarises", () => {
  test.each<AreaAffordanceCase>([
    {
      type: AIChatPageContextType.IncidentsList,
      tool: QueryIncidentsTool,
      argument: "state",
      enumValue: "active",
      guidancePhrase: 'state="active"',
    },
    {
      type: AIChatPageContextType.AlertsList,
      tool: QueryAlertsTool,
      argument: "state",
      enumValue: "active",
      guidancePhrase: 'state="active"',
    },
    {
      type: AIChatPageContextType.MonitorsList,
      tool: QueryMonitorsTool,
      argument: "problemsOnly",
      enumValue: null,
      guidancePhrase: "problemsOnly",
    },
    {
      type: AIChatPageContextType.SecurityEvents,
      tool: SearchSecurityEventsTool,
      argument: "processName",
      enumValue: null,
      guidancePhrase: "process name",
    },
    {
      type: AIChatPageContextType.SecurityEvents,
      tool: SearchSecurityEventsTool,
      argument: "commandLineSearchText",
      enumValue: null,
      guidancePhrase: "command line",
    },
  ])(
    "$type guidance names the $argument affordance its tool really has",
    (testCase: AreaAffordanceCase) => {
      // Half one: the tool's own schema documents the affordance.
      const property: JSONObject | undefined = getSchemaProperty(
        testCase.tool,
        testCase.argument,
      );

      expect(property).toBeDefined();

      if (testCase.enumValue) {
        const allowedValues: Array<string> =
          (property?.["enum"] as Array<string> | undefined) || [];

        expect(allowedValues).toContain(testCase.enumValue);
      }

      // Half two: the page the user is standing on is told about it.
      const section: string = buildPageContextSection({ type: testCase.type });

      expect(section).toContain(testCase.tool.name);
      expect(section).toContain(testCase.guidancePhrase);
    },
  );

  /*
   * The incidents list owns the historical question too, and search_incidents
   * is the only tool that searches incident text. Dropping it here would push
   * "have we seen this before?" onto query_incidents, which cannot search at
   * all. This one is a drift guard: it holds before and after the fix.
   */
  test("the incidents list still routes free-text history to search_incidents", () => {
    const section: string = buildPageContextSection({
      type: AIChatPageContextType.IncidentsList,
    });

    expect(getSchemaProperty(SearchIncidentsTool, "searchText")).toBeDefined();
    expect(section).toContain(SearchIncidentsTool.name);
  });
});

/*
 * The other direction of the same drift: guidance naming a tool the model was
 * never given. Extracting tool names from prose is safe here because this
 * prompt keeps a strict convention — tool names are snake_case, tool
 * ARGUMENTS are camelCase (incidentId, problemsOnly, createdWithinHours), and
 * everything else is plain English or a UUID. So a snake_case token in the
 * guidance is always a capability claim, and every one of them is checked
 * against the toolbox the runner actually offers. A fresh regex per call
 * keeps the global flag's lastIndex out of the picture.
 */
function extractToolNameTokens(text: string): Array<string> {
  const tokens: Array<string> =
    text.match(/[a-z][a-z0-9]*(?:_[a-z0-9]+)+/g) || [];

  return Array.from(new Set(tokens));
}

const TOOLBOX_TOOL_NAMES: Set<string> = new Set(
  AIToolbox.getTools().map((tool: ObservabilityTool): string => {
    return tool.name;
  }),
);

function buildSectionForType(type: AIChatPageContextType): string {
  if (
    type === AIChatPageContextType.Resource ||
    type === AIChatPageContextType.ResourcesList
  ) {
    return buildPageContextSection({
      type,
      resourceType: AIResourceType.Host,
      ...(type === AIChatPageContextType.Resource
        ? { entityId: ENTITY_ID }
        : {}),
    });
  }
  if (!AIChatPageContextHelper.isEntityType(type)) {
    return buildPageContextSection({ type: type });
  }

  return buildPageContextSection({
    type: type,
    entityId: type === AIChatPageContextType.Trace ? TRACE_ID : ENTITY_ID,
  });
}

describe("page guidance only names tools that exist in the toolbox", () => {
  /*
   * Driven off the enum rather than a hand-written list, so a new page type
   * fails here until someone decides what it routes to.
   */
  test.each<[AIChatPageContextType]>(
    Object.values(AIChatPageContextType).map(
      (type: AIChatPageContextType): [AIChatPageContextType] => {
        return [type];
      },
    ),
  )(
    "%s names at least one tool and every tool it names is real",
    (type: AIChatPageContextType) => {
      const section: string = buildSectionForType(type);
      const mentionedTools: Array<string> = extractToolNameTokens(section);

      // Guidance that routes the model nowhere is guidance it cannot use.
      expect(mentionedTools.length).toBeGreaterThan(0);

      const notInToolbox: Array<string> = mentionedTools.filter(
        (name: string): boolean => {
          return !TOOLBOX_TOOL_NAMES.has(name);
        },
      );

      expect(notInToolbox).toEqual([]);
    },
  );
});

describe("infrastructure page guidance", () => {
  test.each(Object.values(AIResourceType))(
    "%s detail names the resource selector and actual telemetry capabilities",
    (resourceType: AIResourceType) => {
      const section: string = buildPageContextSection({
        type: AIChatPageContextType.Resource,
        resourceType,
        entityId: ENTITY_ID,
      });

      expect(section).toContain(QueryTelemetryResourcesTool.name);
      expect(section).toContain(QueryResourceTelemetryTool.name);
      expect(section).toContain(
        JSON.stringify({ resourceType, resourceId: ENTITY_ID }),
      );
      expect(section).toContain("omit metricName first");
      expect(section).toContain('mode="trend"');
      expect(section).toContain('mode="summary"');
      expect(section).toContain("severity histogram");
      expect(section).toContain("operation summaries");
      expect(section).toContain("explicit time windows");
      expect(section).toContain("missing telemetry does not mean");
      expect(
        getSchemaProperty(QueryTelemetryResourcesTool, "resourceType")?.[
          "enum"
        ],
      ).toContain(resourceType);
      expect(
        getSchemaProperty(QueryResourceTelemetryTool, "resourceType")?.["enum"],
      ).toContain(resourceType);
      expect(
        getSchemaProperty(QueryResourceTelemetryTool, "signal")?.["enum"],
      ).toEqual(["metrics", "logs", "traces"]);
    },
  );

  test.each(Object.values(AIResourceType))(
    "%s list scopes discovery to its kind without inventing a selected resource",
    (resourceType: AIResourceType) => {
      const section: string = buildPageContextSection({
        type: AIChatPageContextType.ResourcesList,
        resourceType,
      });
      expect(section).toContain(JSON.stringify({ resourceType }));
      expect(section).not.toContain(ENTITY_ID);
      expect(section).toContain("For each selected resource");
    },
  );

  test("a pod name is a hint and cannot turn parent telemetry into pod-only evidence", () => {
    const section: string = buildPageContextSection({
      type: AIChatPageContextType.Resource,
      resourceType: AIResourceType.KubernetesCluster,
      entityId: ENTITY_ID,
      subresource: { kind: AIResourceSubresourceKind.Pod, key: "checkout" },
    });
    expect(section).toContain('"kind":"Pod","key":"checkout"');
    expect(section).toContain("not verified unique identities");
    expect(section).toContain("Do not invent a namespace or child ID");
    expect(section).toContain("returns the parent resource's data");
    expect(section).toContain("never describe it as child-only measurements");
    expect(section).not.toContain('"namespace":');
  });

  test("a storage array volume is quoted as a parent-scoped hint, not child-only evidence", () => {
    const section: string = buildPageContextSection({
      type: AIChatPageContextType.Resource,
      resourceType: AIResourceType.StorageArray,
      entityId: ENTITY_ID,
      entityTitle: "pure-prod-01",
      subresource: { kind: AIResourceSubresourceKind.Volume, key: "vol-db" },
    });
    expect(section).toContain('a Storage Array titled "pure-prod-01"');
    expect(section).toContain(
      JSON.stringify({
        resourceType: AIResourceType.StorageArray,
        resourceId: ENTITY_ID,
      }),
    );
    expect(section).toContain('"kind":"Volume","key":"vol-db"');
    expect(section).toContain("returns the parent resource's data");
    expect(section).toContain("never describe it as child-only measurements");
  });

  test("the system prompt routes storage arrays through the infrastructure tools", () => {
    const prompt: string = buildObservabilityChatSystemPrompt({
      currentTime: new Date("2026-07-16T00:00:00Z"),
      permissionMode: AIChatPermissionMode.ReadOnly,
    });
    const infrastructureLine: string | undefined = prompt
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("- For infrastructure (");
      });
    expect(infrastructureLine).toBeDefined();
    expect(infrastructureLine).toContain("Ceph, storage arrays, serverless");
    expect(infrastructureLine).toContain(QueryTelemetryResourcesTool.name);
    expect(infrastructureLine).toContain(QueryResourceTelemetryTool.name);
  });

  test("an explicit namespace is quoted with the child hint", () => {
    const section: string = buildPageContextSection({
      type: AIChatPageContextType.Resource,
      resourceType: AIResourceType.KubernetesCluster,
      entityId: ENTITY_ID,
      subresource: {
        kind: AIResourceSubresourceKind.Pod,
        key: "checkout",
        namespace: "production",
      },
    });
    expect(section).toContain('"namespace":"production"');
  });
});

describe("network device transceiver guidance", () => {
  test("a network device page routes optics questions to query_network_transceivers with its id", () => {
    const section: string = buildPageContextSection({
      type: AIChatPageContextType.Resource,
      resourceType: AIResourceType.NetworkDevice,
      entityId: ENTITY_ID,
      entityTitle: "core-switch-1",
    });

    expect(section).toContain(
      `call query_network_transceivers with networkDeviceId="${ENTITY_ID}"`,
    );
    expect(section).toContain("received power over the last weeks");
  });

  test("the network devices list names the tool without inventing a device", () => {
    const section: string = buildPageContextSection({
      type: AIChatPageContextType.ResourcesList,
      resourceType: AIResourceType.NetworkDevice,
    });

    expect(section).toContain(
      "call query_network_transceivers with its networkDeviceId",
    );
    expect(section).not.toContain(ENTITY_ID);
  });

  test.each(
    Object.values(AIResourceType).filter((resourceType: AIResourceType) => {
      return resourceType !== AIResourceType.NetworkDevice;
    }),
  )("%s pages do not mention transceivers", (resourceType: AIResourceType) => {
    expect(
      buildPageContextSection({
        type: AIChatPageContextType.Resource,
        resourceType,
        entityId: ENTITY_ID,
      }),
    ).not.toContain("query_network_transceivers");
  });

  test("the system prompt sends interface trouble on a network device to the optics", () => {
    const prompt: string = buildObservabilityChatSystemPrompt({
      currentTime: new Date("2026-10-09T00:00:00Z"),
      permissionMode: AIChatPermissionMode.ReadOnly,
    });
    const line: string | undefined = prompt
      .split("\n")
      .find((candidate: string): boolean => {
        return candidate.startsWith("- For a network device's transceivers");
      });

    expect(line).toBeDefined();
    expect(line).toContain("query_network_transceivers");
    expect(line).toContain("interface is down or logging errors");
    expect(TOOLBOX_TOOL_NAMES.has("query_network_transceivers")).toBe(true);
  });
});

describe("container host and split-metric guidance (issues #4784, #4785)", () => {
  test.each([AIResourceType.DockerHost, AIResourceType.PodmanHost])(
    "a %s page routes container questions to query_containers with its id",
    (resourceType: AIResourceType) => {
      const section: string = buildPageContextSection({
        type: AIChatPageContextType.Resource,
        resourceType,
        entityId: ENTITY_ID,
        entityTitle: "web-1",
      });

      expect(section).toContain(
        `call query_containers with ${JSON.stringify({ resourceType, resourceId: ENTITY_ID })}`,
      );
      expect(section).toContain("the ones that stopped reporting");
    },
  );

  test("the Docker hosts list names the tool without inventing a host", () => {
    const section: string = buildPageContextSection({
      type: AIChatPageContextType.ResourcesList,
      resourceType: AIResourceType.DockerHost,
    });

    expect(section).toContain(
      "call query_containers with its resourceType and resourceId",
    );
    expect(section).not.toContain(ENTITY_ID);
  });

  test.each(
    Object.values(AIResourceType).filter((resourceType: AIResourceType) => {
      return (
        resourceType !== AIResourceType.DockerHost &&
        resourceType !== AIResourceType.PodmanHost
      );
    }),
  )(
    "%s pages do not offer the container tool",
    (resourceType: AIResourceType) => {
      expect(
        buildPageContextSection({
          type: AIChatPageContextType.Resource,
          resourceType,
          entityId: ENTITY_ID,
        }),
      ).not.toContain("query_containers");
    },
  );

  test("every resource page says metrics take attributes and groupBy, and split host metrics are read per state", () => {
    const section: string = buildPageContextSection({
      type: AIChatPageContextType.Resource,
      resourceType: AIResourceType.Host,
      entityId: ENTITY_ID,
    });

    expect(section).toContain(
      "attributes filters a metric by attribute and groupBy reads one series per value",
    );
    expect(section).toContain("are read per state on their own");
  });

  test("the system prompt explains split host metrics and sends container questions to query_containers", () => {
    const prompt: string = buildObservabilityChatSystemPrompt({
      currentTime: new Date("2026-10-16T00:00:00Z"),
      permissionMode: AIChatPermissionMode.ReadOnly,
    });
    const line: string | undefined = prompt
      .split("\n")
      .find((candidate: string): boolean => {
        return candidate.startsWith(
          "- Host metrics such as system.cpu.utilization",
        );
      });

    expect(line).toBeDefined();
    expect(line).toContain(
      "the states add up to 1, so one average across them means nothing",
    );
    expect(line).toContain("use query_containers");
    expect(TOOLBOX_TOOL_NAMES.has("query_containers")).toBe(true);
  });
});

/*
 * Issue #5259: asked to run a command on a host, the model answered "I
 * don't have a tool that can execute commands on remote hosts" and stopped
 * there. The command tools exist only in a conversation about a resource
 * whose AI agent may investigate; everywhere else - another page, Slack,
 * Microsoft Teams - the prompt says where commands can run.
 */
describe("infrastructure commands guidance (issue #5259)", () => {
  test.each(Object.values(AIChatPermissionMode))(
    "the %s prompt says where commands on infrastructure run",
    (permissionMode: AIChatPermissionMode) => {
      const prompt: string = buildObservabilityChatSystemPrompt({
        currentTime: new Date("2026-10-25T00:00:00Z"),
        permissionMode,
      });

      expect(prompt).toContain(INFRASTRUCTURE_COMMANDS_GUIDANCE);
    },
  );

  test("names both command tools, the agent behind them, and never pretends a command ran", () => {
    expect(INFRASTRUCTURE_COMMANDS_GUIDANCE).toContain(
      RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
    );
    expect(INFRASTRUCTURE_COMMANDS_GUIDANCE).toContain(RUN_KUBECTL_TOOL_NAME);
    expect(INFRASTRUCTURE_COMMANDS_GUIDANCE).toContain(
      "whose AI agent is connected and may investigate",
    );
    expect(INFRASTRUCTURE_COMMANDS_GUIDANCE).toContain(
      "with the reason when this conversation gives one",
    );
    expect(INFRASTRUCTURE_COMMANDS_GUIDANCE).toContain(
      "for a resource that has an AI agent, that Ask AI opened on its page in OneUptime can, once the agent is connected and AI investigation is on for it",
    );
    expect(INFRASTRUCTURE_COMMANDS_GUIDANCE).toContain(
      "never pretend a command ran",
    );
  });

  /*
   * Every run reads the base prompt, a remediation run too: it runs
   * commands with tools of its own (execute_remediation_command), so the
   * guidance never says the agents' two tools are the only way.
   */
  test("never claims the agents' tools are the only way a command runs", () => {
    expect(INFRASTRUCTURE_COMMANDS_GUIDANCE).toContain(
      "If you are asked to run a command and no tool here can run it",
    );
    expect(INFRASTRUCTURE_COMMANDS_GUIDANCE).not.toContain("run only through");
    expect(INFRASTRUCTURE_COMMANDS_GUIDANCE).not.toContain(
      "neither tool is offered",
    );
  });

  /*
   * A storage array's or a network device's page has no AI agent to send
   * the user to: the guidance says which kinds of resource have one.
   */
  test("names every kind of resource that has an AI agent, and says the others have none", () => {
    // Typed by kind: a new kind of resource AI agent fails here until named.
    const named: Record<AiResourceType, string> = {
      [AiResourceType.DockerHost]: "Docker and Podman hosts",
      [AiResourceType.PodmanHost]: "Docker and Podman hosts",
      [AiResourceType.DockerSwarmCluster]: "Docker Swarm",
      [AiResourceType.ProxmoxCluster]: "Proxmox",
      [AiResourceType.VMwareVCenter]: "VMware",
      [AiResourceType.CephCluster]: "Ceph clusters",
      [AiResourceType.DatabaseServer]: "database servers",
      [AiResourceType.Host]: "Hosts",
    };

    for (const type of ALL_AI_RESOURCE_TYPES) {
      expect(INFRASTRUCTURE_COMMANDS_GUIDANCE).toContain(named[type]);
    }

    expect(INFRASTRUCTURE_COMMANDS_GUIDANCE).toContain("Kubernetes clusters");
    expect(INFRASTRUCTURE_COMMANDS_GUIDANCE).toContain(
      "have AI agents; other resources have none",
    );
  });

  test("the guidance sits with the other infrastructure lines of How to investigate", () => {
    const prompt: string = buildObservabilityChatSystemPrompt({
      currentTime: new Date("2026-10-25T00:00:00Z"),
      permissionMode: AIChatPermissionMode.ReadOnly,
    });
    const lines: Array<string> = prompt.split("\n");
    const hostMetricsLine: number = lines.findIndex((line: string): boolean => {
      return line.startsWith("- Host metrics such as system.cpu.utilization");
    });

    expect(lines[hostMetricsLine + 1]).toBe(INFRASTRUCTURE_COMMANDS_GUIDANCE);
    expect(prompt.indexOf(INFRASTRUCTURE_COMMANDS_GUIDANCE)).toBeGreaterThan(
      prompt.indexOf("## How to investigate"),
    );
  });

  test("a page section names neither command tool: a page alone never offers them", () => {
    for (const resourceType of Object.values(AIResourceType)) {
      const section: string = buildPageContextSection({
        type: AIChatPageContextType.Resource,
        resourceType,
        entityId: ENTITY_ID,
      });

      expect(section).not.toContain(RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME);
      expect(section).not.toContain(RUN_KUBECTL_TOOL_NAME);
    }
  });
});

/*
 * Issue #5293: on a host's page, Ask AI declared an incident linked to
 * nothing. The page's guidance says what an incident declared there is
 * linked to - in the exact affectedResources create_incident takes - and
 * the base prompt says why linking matters and which tools link.
 */
describe("what an incident declared from a page is linked to (issue #5293)", () => {
  test("a host's page: declared there, linked to the host, in the exact argument", () => {
    const section: string = buildPageContextSection({
      type: AIChatPageContextType.Resource,
      resourceType: AIResourceType.Host,
      entityId: ENTITY_ID,
      entityTitle: "test01",
    });

    expect(section).toContain(
      `An incident you declare here with create_incident, or an alert you raise here with create_alert, is linked to it (affectedResources [{"resourceType":"Host","resourceId":"${ENTITY_ID}"}])`,
    );
    expect(section).toContain(
      "pass affectedResources yourself only when the incident or alert is about something else",
    );
    expect(section).toContain("add_incident_affected_resources");
    expect(section).toContain("add_alert_affected_resources");
  });

  test.each(
    AI_AFFECTED_RESOURCE_KINDS.filter(
      (info: AiAffectedResourceKindInfo): boolean => {
        return info.kind !== AiAffectedResourceKind.Service;
      },
    ).map((info: AiAffectedResourceKindInfo) => {
      return [info.kind];
    }),
  )("every linkable resource's page says so (%s)", (kind: string) => {
    expect(
      buildPageContextSection({
        type: AIChatPageContextType.Resource,
        resourceType: kind as AIResourceType,
        entityId: ENTITY_ID,
      }),
    ).toContain(`{"resourceType":"${kind}","resourceId":"${ENTITY_ID}"}`);
  });

  test("a pod's page links its cluster", () => {
    expect(
      buildPageContextSection({
        type: AIChatPageContextType.Resource,
        resourceType: AIResourceType.KubernetesCluster,
        entityId: ENTITY_ID,
        subresource: { kind: AIResourceSubresourceKind.Pod, key: "web-1" },
      }),
    ).toContain(
      `{"resourceType":"KubernetesCluster","resourceId":"${ENTITY_ID}"}`,
    );
  });

  test("a telemetry service's page links the service", () => {
    const section: string = buildPageContextSection({
      type: AIChatPageContextType.TelemetryService,
      entityId: ENTITY_ID,
      entityTitle: "checkout",
    });

    expect(section).toContain(
      `{"resourceType":"Service","resourceId":"${ENTITY_ID}"}`,
    );
    // Still scoped to the service the way it was.
    expect(section).toContain(`serviceId="${ENTITY_ID}"`);
  });

  test.each(Object.keys(AI_RESOURCE_TYPES_NOT_LINKABLE))(
    "the page of a resource an incident cannot be linked to (%s) says what to link instead",
    (type: string) => {
      const section: string = buildPageContextSection({
        type: AIChatPageContextType.Resource,
        resourceType: type as AIResourceType,
        entityId: ENTITY_ID,
      });

      expect(section).toContain("An incident or alert cannot be linked to a");
      expect(section).toContain(
        "link one you declare here to the hosts, clusters or services it runs on, if you can find them with a tool",
      );
      expect(section).not.toContain("affectedResources [");
    },
  );

  test("a list page, an incident's page or a monitor's page links nothing by itself", () => {
    for (const context of [
      {
        type: AIChatPageContextType.ResourcesList,
        resourceType: AIResourceType.Host,
      },
      { type: AIChatPageContextType.Incident, entityId: ENTITY_ID },
      { type: AIChatPageContextType.Monitor, entityId: ENTITY_ID },
    ] as Array<AIChatPageContext>) {
      expect(buildPageContextSection(context)).not.toContain(
        "An incident you declare here",
      );
    }
  });

  test.each(Object.values(AIChatPermissionMode))(
    "the %s prompt says OneUptime AI fixes only what an incident is linked to, and how to link",
    (permissionMode: AIChatPermissionMode) => {
      const prompt: string = buildObservabilityChatSystemPrompt({
        currentTime: new Date("2026-10-26T00:00:00Z"),
        permissionMode,
      });

      expect(prompt).toContain(
        "OneUptime AI investigates and fixes the infrastructure an incident or alert is linked to, and nothing else.",
      );
      expect(prompt).toContain(
        "When you declare an incident or raise an alert about a host, a cluster, a database or a service, pass it in the affectedResources of create_incident or create_alert",
      );
      expect(prompt).toContain(
        "Never link a resource you have not found with a tool.",
      );
    },
  );

  test("the modes that act list linking among the actions, and read-only says it cannot", () => {
    for (const permissionMode of [
      AIChatPermissionMode.AskForApproval,
      AIChatPermissionMode.AutoRun,
    ]) {
      expect(
        buildObservabilityChatSystemPrompt({
          currentTime: new Date("2026-10-26T00:00:00Z"),
          permissionMode,
        }),
      ).toContain(
        "link an incident or alert to the infrastructure and services it is about (add_incident_affected_resources / add_alert_affected_resources)",
      );
    }

    expect(
      buildObservabilityChatSystemPrompt({
        currentTime: new Date("2026-10-26T00:00:00Z"),
        permissionMode: AIChatPermissionMode.ReadOnly,
      }),
    ).toContain(
      "If the user asks you to create an incident or an alert, link one to the resources it is about,",
    );
  });

  test("the linking tools the prompt names are the toolbox's, and they change the project", () => {
    for (const name of [
      "create_incident",
      "create_alert",
      "add_incident_affected_resources",
      "add_alert_affected_resources",
    ]) {
      expect(AIToolbox.getToolByName(name)).toBeDefined();
      expect(AIToolbox.isMutationTool(name)).toBe(true);
    }
  });
});

/*
 * Issue #5301. On host test01's page, "Create alert on high ram 75%" was
 * answered with "I don't have a tool available to create new alerts",
 * though Ask AI declared incidents there. Ask AI raises alerts now
 * (create_alert), and the prompt says, in every mode:
 *
 *   - which record fits: an incident for an outage users feel, an alert
 *     for something to look into - and the one the user names wins;
 *   - that neither record watches for anything: being alerted whenever a
 *     condition holds is a monitor, which no tool creates, so the model
 *     says so, reads the condition now, offers an alert if it holds, and
 *     says where a person creates the monitor - in the product's words,
 *     held here to the monitor types and the Host template it names.
 */
describe("raising an alert, and what an alert rule is (issue #5301)", () => {
  function promptFor(permissionMode: AIChatPermissionMode): string {
    return buildObservabilityChatSystemPrompt({
      currentTime: new Date("2026-10-26T00:00:00Z"),
      permissionMode,
    });
  }

  test.each(Object.values(AIChatPermissionMode))(
    "the %s prompt says when an alert fits and when an incident does",
    (permissionMode: AIChatPermissionMode) => {
      const prompt: string = promptFor(permissionMode);

      expect(prompt).toContain("## Incidents, alerts and monitors");
      expect(prompt).toContain(
        "Declare an incident (create_incident) for an outage or a problem users feel, which needs a response now.",
      );
      expect(prompt).toContain(
        "Raise an alert (create_alert) for something the team should look into that is not, or not yet, an outage",
      );
      expect(prompt).toContain("When the user names one, create that one.");
    },
  );

  test.each(Object.values(AIChatPermissionMode))(
    "the %s prompt says a rule is a monitor, which no tool creates, and what to do instead",
    (permissionMode: AIChatPermissionMode) => {
      const prompt: string = promptFor(permissionMode);

      expect(prompt).toContain(
        "An incident or an alert is created once, now, and watches nothing.",
      );
      expect(prompt).toContain(
        'A request to be alerted when or whenever something happens ("alert me when memory goes above 75%") asks for a monitor, and no tool here creates one',
      );
      expect(prompt).toContain(
        "say so plainly, read the condition now with the metric tools, and if it holds now, offer to raise an alert about it",
      );
      expect(prompt).toContain(
        "A person creates the monitor under Monitors → Create Monitor",
      );
    },
  );

  test("the section is the exported one, once, between How to investigate and Reading tool results", () => {
    for (const permissionMode of Object.values(AIChatPermissionMode)) {
      const prompt: string = promptFor(permissionMode);
      const at: number = prompt.indexOf(INCIDENTS_ALERTS_AND_MONITORS_SECTION);

      expect(at).toBeGreaterThan(prompt.indexOf("## How to investigate"));
      expect(at).toBeLessThan(prompt.indexOf("## Reading tool results"));
      expect(prompt.split("## Incidents, alerts and monitors")).toHaveLength(2);
    }
  });

  test("the claim that no tool creates a monitor holds: no tool of the toolbox writes one", () => {
    const monitorWriters: Array<string> = AIToolbox.getTools()
      .filter((tool: ObservabilityTool): boolean => {
        return Boolean(tool.isMutation) && tool.name.includes("monitor");
      })
      .map((tool: ObservabilityTool): string => {
        return tool.name;
      });

    expect(monitorWriters).toEqual([]);
    expect(AIToolbox.getToolByName("create_monitor")).toBeUndefined();
  });

  test("the monitors it names are the product's: the Host and Metrics types, and the Host template for memory", () => {
    const memory: HostAlertTemplate | undefined =
      getHostAlertTemplateById("host-high-memory");

    expect(MonitorType.Host).toBe("Host");
    expect(MonitorType.Metrics).toBe("Metrics");
    expect(memory?.name).toBe("High Memory Utilization");
    expect(INCIDENTS_ALERTS_AND_MONITORS_SECTION).toContain(
      `a ${MonitorType.Host} monitor watches a host's CPU, memory and disks (its ${memory?.name} template sets a memory threshold they can change)`,
    );
    expect(INCIDENTS_ALERTS_AND_MONITORS_SECTION).toContain(
      `a ${MonitorType.Metrics} monitor watches any metric`,
    );
  });

  test("the modes that act list raising an alert among their actions", () => {
    for (const permissionMode of [
      AIChatPermissionMode.AskForApproval,
      AIChatPermissionMode.AutoRun,
    ]) {
      expect(promptFor(permissionMode)).toContain(
        "You can take actions: create incidents and alerts (create_incident / create_alert),",
      );
    }

    expect(promptFor(AIChatPermissionMode.ReadOnly)).not.toContain(
      "You can take actions",
    );
  });

  test("every tool the section names is the toolbox's, and the two that create are mutations", () => {
    for (const name of ["create_incident", "create_alert"]) {
      expect(INCIDENTS_ALERTS_AND_MONITORS_SECTION).toContain(name);
      expect(AIToolbox.getToolByName(name)?.isMutation).toBe(true);
    }
  });

  test("raised on a host's page, an alert is linked to the host, in the exact argument create_alert takes", () => {
    const section: string = buildPageContextSection({
      type: AIChatPageContextType.Resource,
      resourceType: AIResourceType.Host,
      entityId: ENTITY_ID,
      entityTitle: "test01",
    });
    const properties: JSONObject = AIToolbox.getToolByName("create_alert")!
      .inputSchema["properties"] as JSONObject;

    expect(section).toContain(
      `or an alert you raise here with create_alert, is linked to it (affectedResources [{"resourceType":"Host","resourceId":"${ENTITY_ID}"}])`,
    );
    expect(properties["affectedResources"]).toBeDefined();
  });
});
