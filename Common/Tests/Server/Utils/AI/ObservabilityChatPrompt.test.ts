import {
  buildObservabilityChatSystemPrompt,
  buildPageContextSection,
} from "../../../../Server/Utils/AI/Chat/ObservabilityChatPrompt";
import AIChatPageContextType, {
  AIChatPageContext,
  AIChatPageContextHelper,
} from "../../../../Types/AI/AIChatPageContext";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
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
import { QueryAlertsTool } from "../../../../Server/Utils/AI/Toolbox/AlertTools";
import { QueryMonitorsTool } from "../../../../Server/Utils/AI/Toolbox/MonitorTools";
import { ObservabilityTool } from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import { JSONObject } from "../../../../Types/JSON";
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
