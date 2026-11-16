import { describe, expect, test } from "@jest/globals";
import {
  citationSentence,
  countFigure,
  termCells,
  termsByValue,
  ToolCitation,
  windowSentence,
} from "../../../../../Server/Utils/AI/Toolbox/ReadTableWords";
import WidgetBuilder from "../../../../../Server/Utils/AI/Toolbox/WidgetBuilder";
import {
  getEscalationChainCell,
  getEscalationRuleWords,
  getNotifiedPersonWords,
} from "../../../../../Server/Utils/AI/Toolbox/OnCallTools";
import { describeStepInstructionWords } from "../../../../../Server/Utils/AI/Toolbox/RunbookTools";
import { getAttributeKeysCitation } from "../../../../../Server/Utils/AI/Toolbox/ContextTools";
import { getSecurityCasesCitation } from "../../../../../Server/Utils/AI/Toolbox/SecurityCaseTools";
import { getDataSecurityIssuesCitation } from "../../../../../Server/Utils/AI/Toolbox/DataSecurityTools";
import ToolOutputPager from "../../../../../Server/Utils/AI/Chat/ToolOutputPager";
import {
  AI_READ_CARD_VALUES,
  AIActionSentence,
  AIActionTableCell,
  aiActionSentence,
  describeAIActionSentence,
  describeAIActionTableCell,
  isKnownAIActionSentence,
  isKnownAIActionTableWords,
} from "../../../../../Types/AI/AIActionWords";
import {
  AI_INSIGHT_SEVERITY_LABELS,
  AI_INSIGHT_STATUS_LABELS,
  AI_READ_AI_RUN_STATUSES,
  AI_READ_CITATIONS,
  AI_READ_DATA_SECURITY_TERMS,
  AI_READ_RUNBOOK_STEP_TYPES,
  AI_READ_TRIAGE_LABELS,
  AI_READ_WIDGET_LINES,
  AI_READ_WIDGET_TITLES,
  AI_TOOL_CITATIONS,
} from "../../../../../Types/AI/AIReadTableWords";
import {
  AIChatWidget,
  AIChatWidgetType,
} from "../../../../../Types/AI/AIChatTypes";
import AIInsightStatus from "../../../../../Types/AI/AIInsightStatus";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import { JSONObject } from "../../../../../Types/JSON";
import RunbookStepType from "../../../../../Types/Runbook/RunbookStepType";
import { RunbookStep } from "../../../../../Types/Runbook/RunbookStep";
import SecuritySeverity from "../../../../../Types/SecuritySeverity";
import ErrorClass from "../../../../../Types/Telemetry/ErrorClass";
import TelemetryType from "../../../../../Types/Telemetry/TelemetryType";

/*
 * THE REST OF ASK AI IN THE READER'S LANGUAGE (issues #8311, #8312, #8313).
 *
 * The chips of the docs, code, cloud, metric, profile, context and write
 * tools, the not-found ones and a long output's pages; the headings of the
 * incident, alert and exception lists, the charts and the trace waterfall;
 * and the cells that were OneUptime's words drawn in English - an
 * escalation chain, who a page notified, an AI run's and an insight's
 * status, Data Security's words, a runbook step's type and what it does.
 * Each is a sentence or a term of Types/AI/AIReadTableWords the Dashboard
 * trusts, and its English is what the tool always wrote: the model reads
 * the same, and the exports print it.
 */

const START: Date = new Date("2026-09-14T17:49:05.000Z");
const END: Date = new Date("2026-09-14T18:49:05.000Z");

describe("a widget's heading, as words (#8312)", () => {
  const builders: Array<[string, (words: JSONObject) => AIChatWidget]> = [
    [
      "incidentList",
      (heading: JSONObject): AIChatWidget => {
        return WidgetBuilder.incidentList({ ...heading, items: [] } as never);
      },
    ],
    [
      "alertList",
      (heading: JSONObject): AIChatWidget => {
        return WidgetBuilder.alertList({ ...heading, items: [] } as never);
      },
    ],
    [
      "exceptionList",
      (heading: JSONObject): AIChatWidget => {
        return WidgetBuilder.exceptionList({ ...heading, items: [] } as never);
      },
    ],
    [
      "timeSeries",
      (heading: JSONObject): AIChatWidget => {
        return WidgetBuilder.timeSeries({ ...heading, series: [] } as never);
      },
    ],
    [
      "bars",
      (heading: JSONObject): AIChatWidget => {
        return WidgetBuilder.bars({ ...heading, series: [] } as never);
      },
    ],
    [
      "traceWaterfall",
      (heading: JSONObject): AIChatWidget => {
        return WidgetBuilder.traceWaterfall({
          ...heading,
          spans: [],
          totalDurationMs: 12,
        } as never);
      },
    ],
    [
      "stats",
      (heading: JSONObject): AIChatWidget => {
        return WidgetBuilder.stats({ ...heading, stats: [] } as never);
      },
    ],
  ];

  test.each(builders)(
    "%s stores the words' English, and the words beside it",
    (_name: string, build: (words: JSONObject) => AIChatWidget) => {
      const title: AIActionSentence = aiActionSentence(
        AI_READ_WIDGET_TITLES.activeIncidents,
        { count: countFigure(3) },
      );
      const description: AIActionSentence = aiActionSentence(
        AI_READ_WIDGET_LINES.createdInHours,
        { hours: countFigure(24) },
      );
      const widget: AIChatWidget = build({
        // The sentences as the widget's words carry them: plain JSON.
        words: { title, description } as unknown as JSONObject,
      });

      expect(widget.title).toBe("Active incidents (3)");
      expect(widget.description).toBe("Created in the last 24h");
      expect(widget.data.tableWords).toEqual({ title, description });
      expect(isKnownAIActionTableWords(widget.data.tableWords)).toBe(true);
    },
  );

  test.each(builders)(
    "%s built from English stores no words, as it always was",
    (_name: string, build: (words: JSONObject) => AIChatWidget) => {
      const widget: AIChatWidget = build({
        title: "Active incidents (3)",
        description: "Created in the last 24h",
      });

      expect(widget.title).toBe("Active incidents (3)");
      expect(widget.description).toBe("Created in the last 24h");
      expect(widget.data.tableWords).toBeUndefined();
      expect(
        Object.prototype.hasOwnProperty.call(widget.data, "tableWords"),
      ).toBe(false);
    },
  );

  test("words with no line of their own keep a line that is data", () => {
    const widget: AIChatWidget = WidgetBuilder.alertList({
      words: {
        title: aiActionSentence(AI_READ_WIDGET_TITLES.alerts, {
          count: countFigure(2),
        }),
      },
      description: "As written",
      items: [],
    });

    expect(widget.type).toBe(AIChatWidgetType.AlertList);
    expect(widget.title).toBe("Alerts (2)");
    expect(widget.description).toBe("As written");
    expect(widget.data.tableWords?.description).toBeUndefined();
  });

  test("a chart's window is two moments, said as the ISO text the tools wrote", () => {
    const widget: AIChatWidget = WidgetBuilder.bars({
      words: {
        title: aiActionSentence(AI_READ_WIDGET_TITLES.logVolume),
        description: windowSentence(START, END),
      },
      series: [],
    });

    expect(widget.title).toBe("Log volume by severity");
    expect(widget.description).toBe(
      `${START.toISOString()} – ${END.toISOString()}`,
    );
  });

  test.each<[AIActionSentence, string]>([
    [
      aiActionSentence(AI_READ_WIDGET_TITLES.incidents, {
        count: countFigure(7),
      }),
      "Incidents (7)",
    ],
    [
      aiActionSentence(AI_READ_WIDGET_TITLES.resolvedIncidents, {
        count: countFigure(1),
      }),
      "Resolved incidents (1)",
    ],
    [
      aiActionSentence(AI_READ_WIDGET_TITLES.incidentsMatching, {
        query: "db",
        count: countFigure(2),
      }),
      'Incidents matching "db" (2)',
    ],
    [
      aiActionSentence(AI_READ_WIDGET_TITLES.topExceptions, {
        count: countFigure(5),
      }),
      "Top exceptions (5)",
    ],
    [
      aiActionSentence(AI_READ_WIDGET_TITLES.metric, {
        aggregation: "Avg",
        metric: "cpu",
      }),
      "Avg of cpu",
    ],
    [
      aiActionSentence(AI_READ_WIDGET_TITLES.metricBy, {
        aggregation: "P95",
        metric: "latency",
        groupBy: "service",
      }),
      "P95 of latency by service",
    ],
    [
      aiActionSentence(AI_READ_WIDGET_TITLES.metricVsExpected, {
        metric: "cpu",
      }),
      "cpu vs expected range",
    ],
    [
      aiActionSentence(AI_READ_WIDGET_TITLES.traceWaterfall, {
        count: countFigure(12),
      }),
      "Trace waterfall (12 spans)",
    ],
    [
      aiActionSentence(AI_READ_WIDGET_TITLES.traceWaterfallMore, {
        count: countFigure(500),
      }),
      "Trace waterfall (500+ spans)",
    ],
    [
      aiActionSentence(AI_READ_CITATIONS.incident, { incident: "#42" }),
      "Incident #42",
    ],
    [aiActionSentence(AI_READ_WIDGET_TITLES.incident), "Incident"],
    [
      aiActionSentence(AI_READ_WIDGET_LINES.regardlessOfCreation),
      "Regardless of when they were created",
    ],
    [
      aiActionSentence(AI_READ_WIDGET_LINES.currentlyUnresolvedAlerts),
      "Currently unresolved alerts",
    ],
    [
      aiActionSentence(AI_READ_WIDGET_LINES.exceptionsInHours, {
        hours: countFigure(24),
      }),
      "Last 24h, by occurrence count",
    ],
    [
      aiActionSentence(AI_READ_WIDGET_LINES.traceDuration, {
        duration: { figure: 1234 },
      }),
      // A figure and its unit stay on one line (Types/NoBreakSpaces).
      "1234\u00A0ms total",
    ],
    [
      aiActionSentence(AI_READ_WIDGET_LINES.baselineWindow, {
        sigma: 3,
        days: countFigure(28),
        start: { moment: START.toISOString() },
        end: { moment: END.toISOString() },
      }),
      `Hour-of-week baseline (±3σ, 28-day window), ${START.toISOString()} – ${END.toISOString()}`,
    ],
  ])(
    "says what the tool always wrote: %j",
    (sentence: AIActionSentence, english: string) => {
      expect(isKnownAIActionSentence(sentence)).toBe(true);
      expect(describeAIActionSentence(sentence)).toBe(english);
    },
  );
});

describe("a table's cells that are OneUptime's words (#8313)", () => {
  test("termCells words the values a column names, and leaves the rest as data", () => {
    const rows: Array<JSONObject> = [
      {
        status: "ActionRequired",
        severity: "High",
        classification: "code-fault",
      },
      { status: "Somebody's own", severity: 3, classification: "unknown" },
      { status: AIInsightStatus.Resolved },
    ];

    expect(
      termCells(rows, {
        status: AI_INSIGHT_STATUS_LABELS,
        severity: AI_INSIGHT_SEVERITY_LABELS,
        classification: AI_READ_TRIAGE_LABELS,
      }),
    ).toEqual([
      {
        status: { term: "Needs Attention" },
        severity: { term: "High" },
        classification: { term: "Code fault" },
      },
      { classification: { term: "Unclassified" } },
      { status: { term: "Resolved" } },
    ]);
  });

  test("cells already worded are kept, row by row", () => {
    const base: Array<Record<string, AIActionTableCell>> = [
      { status: { term: AI_READ_CARD_VALUES.yes } },
    ];

    expect(
      termCells(
        [{ status: "x", clientType: "browser" }],
        { clientType: { browser: "Browser" } },
        base,
      ),
    ).toEqual([
      {
        status: { term: AI_READ_CARD_VALUES.yes },
        clientType: { term: "Browser" },
      },
    ]);
  });

  test("a value the words name only by an inherited key is data (no prototype lookups)", () => {
    expect(
      termCells([{ status: "toString" }, { status: "constructor" }], {
        status: AI_INSIGHT_STATUS_LABELS,
      }),
    ).toEqual([{}, {}]);
  });

  test("termsByValue: a word that says itself", () => {
    expect(termsByValue(["Restricted", "Public"])).toEqual({
      Restricted: "Restricted",
      Public: "Public",
    });
    // An open issue's status is data: "Open" alone is every Open button's verb.
    expect(AI_READ_DATA_SECURITY_TERMS).not.toContain("Open");
  });

  test("every AI run status, every insight status and severity, every triage and step type has a word", () => {
    for (const status of Object.values(AIRunStatus)) {
      expect(typeof AI_READ_AI_RUN_STATUSES[status]).toBe("string");
    }

    for (const status of Object.values(AIInsightStatus)) {
      expect(typeof AI_INSIGHT_STATUS_LABELS[status]).toBe("string");
    }

    for (const errorClass of Object.values(ErrorClass)) {
      expect(typeof AI_READ_TRIAGE_LABELS[errorClass]).toBe("string");
    }

    for (const type of Object.values(RunbookStepType)) {
      expect(typeof AI_READ_RUNBOOK_STEP_TYPES[type]).toBe("string");
    }

    expect(AI_READ_AI_RUN_STATUSES[AIRunStatus.WaitingForApproval]).toBe(
      "Waiting for approval",
    );
    expect(AI_READ_AI_RUN_STATUSES[AIRunStatus.Error]).toBe("Failed");
    expect(AI_READ_AI_RUN_STATUSES[AIRunStatus.Stale]).toBe("Timed out");
  });
});

describe("an escalation chain, as words (#8313)", () => {
  const NOTE: string =
    "next in rotation: the person after whoever is on call, passing over anyone away";

  /*
   * A rule as the model reads it back: any of its columns may be unset,
   * which the Pick of the model's own types cannot say with
   * exactOptionalPropertyTypes.
   */
  type RuleAsRead = {
    order?: number | undefined;
    name?: string | undefined;
    escalateAfterInMinutes?: number | undefined;
  };
  type RuleTargets = Parameters<typeof getEscalationRuleWords>[1];

  test.each<[string, [RuleAsRead, RuleTargets], string]>([
    [
      "users and teams, and when it escalates",
      [
        { order: 1, name: "First responders", escalateAfterInMinutes: 5 },
        { users: ["Ana", "Bo"], teams: ["SRE"], schedules: [] },
      ],
      "1. First responders: users [Ana, Bo], teams [SRE] (escalates after 5m)",
    ],
    [
      "a schedule's next in rotation",
      [
        { order: 2, name: "Backup", escalateAfterInMinutes: undefined },
        {
          users: [],
          teams: [],
          schedules: [`Primary (${NOTE})`, "Weekend"],
          nextInRotation: new Set<string>([`Primary (${NOTE})`]),
        },
      ],
      `2. Backup: schedules [Primary (${NOTE}), Weekend]`,
    ],
    [
      "no targets and no name",
      [{ order: 3, name: undefined, escalateAfterInMinutes: 15 }, undefined],
      "3. Unnamed rule: no targets (escalates after 15m)",
    ],
    [
      "no order",
      [
        { order: undefined, name: "Managers", escalateAfterInMinutes: 0 },
        { users: ["Cy"], teams: [], schedules: [] },
      ],
      "?. Managers: users [Cy]",
    ],
  ])(
    "%s: the English the model always read",
    (_name: string, args: [RuleAsRead, RuleTargets], english: string) => {
      const words: AIActionSentence = getEscalationRuleWords(
        args[0] as Parameters<typeof getEscalationRuleWords>[0],
        args[1],
      );

      expect(isKnownAIActionSentence(words)).toBe(true);
      expect(describeAIActionSentence(words)).toBe(english);
    },
  );

  test("a schedule named like the note, but not paged next in rotation, is its name as written", () => {
    const words: AIActionSentence = getEscalationRuleWords(
      { order: 1, name: "R" },
      { users: [], teams: [], schedules: [`Odd (${NOTE})`] },
    );

    expect(JSON.stringify(words)).not.toContain('"{{name}} (next in rotation');
    expect(describeAIActionSentence(words)).toBe(
      `1. R: schedules [Odd (${NOTE})]`,
    );
  });

  test("the chain is its rules in a list; no rules is said so", () => {
    const cell: AIActionSentence = getEscalationChainCell(
      [
        {
          id: {
            toString: () => {
              return "r1";
            },
          },
          order: 1,
          name: "A",
        },
        {
          id: {
            toString: () => {
              return "r2";
            },
          },
          order: 2,
          name: "B",
          escalateAfterInMinutes: 10,
        },
      ] as never,
      new Map([
        ["r1", { users: ["Ana"], teams: [], schedules: [] }],
        ["r2", { users: [], teams: ["Ops"], schedules: [] }],
      ]),
    );

    expect(isKnownAIActionSentence(cell)).toBe(true);
    expect(describeAIActionTableCell(cell)).toBe(
      "1. A: users [Ana], 2. B: teams [Ops] (escalates after 10m)",
    );
    expect(
      describeAIActionSentence(getEscalationChainCell([], new Map())),
    ).toBe("No escalation rules configured");
  });

  test.each<[Parameters<typeof getNotifiedPersonWords>[0], string, boolean]>([
    [
      { name: "Ana", status: "Completed", isAcknowledged: true },
      "Ana: Completed (acknowledged)",
      true,
    ],
    [
      // Stored "Passed On": escalated, as the logs say it.
      { name: "Bo", status: "Passed On", isAcknowledged: false },
      "Bo: Escalated",
      true,
    ],
    [
      { name: "Cy", status: "Something new", isAcknowledged: false },
      "Cy: Something new",
      false,
    ],
  ])(
    "who a page notified: %j",
    (
      data: Parameters<typeof getNotifiedPersonWords>[0],
      english: string,
      isWordedStatus: boolean,
    ) => {
      const words: AIActionSentence = getNotifiedPersonWords(data);

      expect(isKnownAIActionSentence(words)).toBe(true);
      expect(describeAIActionSentence(words)).toBe(english);
      // A status OneUptime names is a term; one it does not is data.
      expect(typeof words.values?.["status"] === "object").toBe(isWordedStatus);
    },
  );
});

describe("what a runbook step does, as words (#8313)", () => {
  const step: (type: RunbookStepType, config: JSONObject) => RunbookStep = (
    type: RunbookStepType,
    config: JSONObject,
  ): RunbookStep => {
    return {
      id: "s",
      order: 1,
      type,
      title: "Step",
      config,
    } as unknown as RunbookStep;
  };

  test.each<[RunbookStepType, JSONObject, string]>([
    [
      RunbookStepType.Manual,
      {},
      "Manual step — a responder performs this by hand (see the step title/description).",
    ],
    [
      RunbookStepType.JavaScript,
      { script: "return 1" },
      "Runs JavaScript on a runner: return 1",
    ],
    [
      RunbookStepType.Bash,
      { script: "uptime" },
      "Runs bash on a runner: uptime",
    ],
    [
      RunbookStepType.HttpRequest,
      { method: "GET", url: "https://x.io" },
      "HTTP GET https://x.io",
    ],
    [
      RunbookStepType.HttpRequest,
      { method: "POST", url: "https://x.io", body: "{}" },
      "HTTP POST https://x.io with body: {}",
    ],
    [
      RunbookStepType.AI,
      { prompt: "Summarize" },
      "AI step with prompt: Summarize",
    ],
    [
      RunbookStepType.SSH,
      { credentialId: "c1", command: "reboot" },
      "Runs over SSH: reboot",
    ],
    [
      RunbookStepType.SSH,
      { host: "db1", username: "ops", script: "ls" },
      "Runs a bash script over SSH on ops@db1: ls",
    ],
    [
      RunbookStepType.SSH,
      { host: "db1", script: "ls" },
      "Runs a bash script over SSH on db1: ls",
    ],
    [
      RunbookStepType.Kubernetes,
      {
        credentialId: "c1",
        action: "restart",
        workloadKind: "Deployment",
        namespace: "prod",
        workloadName: "api",
      },
      "Kubernetes restart on Deployment prod/api",
    ],
    [
      RunbookStepType.Kubernetes,
      {
        credentialId: "c1",
        action: "scale",
        workloadKind: "Deployment",
        namespace: "prod",
        workloadName: "api",
        replicas: 3,
      },
      "Kubernetes scale on Deployment prod/api (replicas: 3)",
    ],
    [
      RunbookStepType.Kubernetes,
      { script: "kubectl get pods" },
      "Runs kubectl commands on a runner: kubectl get pods",
    ],
  ])(
    "%s says what it always said",
    (type: RunbookStepType, config: JSONObject, english: string) => {
      const words: AIActionSentence | null = describeStepInstructionWords(
        step(type, config),
      );

      expect(words).not.toBeNull();
      expect(isKnownAIActionSentence(words)).toBe(true);
      expect(describeAIActionSentence(words!)).toBe(english);
    },
  );

  test("a step type newer than this build has no words: its raw config is shown", () => {
    expect(
      describeStepInstructionWords(step(RunbookStepType.Kubectl, { a: 1 })),
    ).toBeNull();
    expect(
      describeStepInstructionWords(step("Future" as RunbookStepType, {})),
    ).toBeNull();
  });
});

describe("the chips of the other tools (#8311)", () => {
  test.each<[TelemetryType, string | undefined, string]>([
    [TelemetryType.Log, undefined, "Log attribute keys (4 found)"],
    [TelemetryType.Trace, undefined, "Trace attribute keys (4 found)"],
    [TelemetryType.Metric, undefined, "Metric attribute keys (4 found)"],
    [
      TelemetryType.Metric,
      "http.duration",
      "http.duration Metric attribute keys (4 found)",
    ],
    [TelemetryType.Exception, undefined, "Exception attribute keys (4 found)"],
    [TelemetryType.Profile, undefined, "Profile attribute keys (4 found)"],
    [
      TelemetryType.SecurityEvent,
      undefined,
      "SecurityEvent attribute keys (4 found)",
    ],
    // A metric's name is a metric's only.
    [TelemetryType.Log, "http.duration", "Log attribute keys (4 found)"],
  ])(
    "attribute keys of %s (%s)",
    (type: TelemetryType, metric: string | undefined, english: string) => {
      const citation: ToolCitation = getAttributeKeysCitation({
        telemetryType: type,
        metricName: metric,
        count: 4,
      });

      expect(citation.citationLabel).toBe(english);
      expect(isKnownAIActionSentence(citation.citationWords)).toBe(true);
    },
  );

  test.each<[string, string | undefined, string]>([
    ["open", undefined, "Security cases (open) - 3 found"],
    ["open", "10.0.0.7", "Security cases (open, about 10.0.0.7) - 3 found"],
    ["closed", undefined, "Security cases (closed) - 3 found"],
    ["closed", "ana", "Security cases (closed, about ana) - 3 found"],
    ["all", undefined, "Security cases (all) - 3 found"],
    ["all", "host-1", "Security cases (all, about host-1) - 3 found"],
    // A filter the tool does not know reads every case: all.
    ["whatever", undefined, "Security cases (all) - 3 found"],
  ])(
    "security cases %s about %s",
    (status: string, entity: string | undefined, english: string) => {
      const citation: ToolCitation = getSecurityCasesCitation({
        status,
        entity,
        count: 3,
      });

      expect(citation.citationLabel).toBe(english);
      expect(isKnownAIActionSentence(citation.citationWords)).toBe(true);
    },
  );

  test.each<[string, SecuritySeverity | undefined, string]>([
    ["open", undefined, "Data security issues (open) - 2 found"],
    ["accepted", undefined, "Data security issues (accepted) - 2 found"],
    ["resolved", undefined, "Data security issues (resolved) - 2 found"],
    [
      "not-an-issue",
      undefined,
      "Data security issues (not-an-issue) - 2 found",
    ],
    ["all", undefined, "Data security issues (all) - 2 found"],
    [
      "open",
      SecuritySeverity.High,
      "Data security issues (open, High) - 2 found",
    ],
    [
      "all",
      SecuritySeverity.Critical,
      "Data security issues (all, Critical) - 2 found",
    ],
  ])(
    "data security issues %s %s",
    (
      status: string,
      severity: SecuritySeverity | undefined,
      english: string,
    ) => {
      const citation: ToolCitation = getDataSecurityIssuesCitation({
        status,
        severity,
        count: 2,
      });

      expect(citation.citationLabel).toBe(english);
      expect(isKnownAIActionSentence(citation.citationWords)).toBe(true);
    },
  );

  test("a page of a long output names what it is of - its words when it had them - and its characters", () => {
    const words: AIActionSentence = aiActionSentence(
      AI_READ_CITATIONS.monitors,
      {
        count: countFigure(4),
      },
    );
    const worded: ToolCitation = ToolOutputPager.getPageCitation({
      label: "Monitors (4 found)",
      words,
      offset: 0,
      end: 5000,
    });
    const asWritten: ToolCitation = ToolOutputPager.getPageCitation({
      label: 'kubectl get pods on cluster "prod"',
      offset: 5000,
      end: 9000,
    });

    expect(worded.citationLabel).toBe("Monitors (4 found) (characters 0–5000)");
    expect(worded.citationWords.values?.["label"]).toEqual({ list: [words] });
    expect(asWritten.citationLabel).toBe(
      'kubectl get pods on cluster "prod" (characters 5000–9000)',
    );
    expect(asWritten.citationWords.values?.["label"]).toBe(
      'kubectl get pods on cluster "prod"',
    );

    for (const citation of [worded, asWritten]) {
      expect(isKnownAIActionSentence(citation.citationWords)).toBe(true);
      expect(citation.citationWords.template).toBe(
        AI_TOOL_CITATIONS.outputPage,
      );
    }
  });

  test("a page's stored words that are not the module's are the label as written", () => {
    const page: ToolCitation = ToolOutputPager.getPageCitation({
      label: "Something",
      words: { template: "Not one of ours {{x}}", values: { x: "y" } },
      offset: 1,
      end: 2,
    });

    expect(page.citationLabel).toBe("Something (characters 1–2)");
    expect(page.citationWords.values?.["label"]).toBe("Something");
  });

  test.each<[ToolCitation, string]>([
    [
      citationSentence(AI_TOOL_CITATIONS.docsSearch, { query: "probes" }),
      "Docs search: probes",
    ],
    [
      citationSentence(AI_TOOL_CITATIONS.docsSection, {
        page: "Monitors",
        section: "Probes",
      }),
      "Docs: Monitors > Probes",
    ],
    [
      citationSentence(AI_TOOL_CITATIONS.dashboardPage, {
        path: "Monitors > Settings",
      }),
      "Page: Monitors > Settings",
    ],
    [
      citationSentence(AI_TOOL_CITATIONS.codeRepositories, {
        count: countFigure(2),
      }),
      "Connected code repositories (2)",
    ],
    [
      citationSentence(AI_TOOL_CITATIONS.codeFileLines, {
        file: "a.ts",
        start: 1,
        end: 40,
        repository: "acme/app",
      }),
      "a.ts:1-40 (acme/app)",
    ],
    [
      citationSentence(AI_TOOL_CITATIONS.createdIncident, { incident: "#42" }),
      "Created incident #42",
    ],
    [
      citationSentence(AI_TOOL_CITATIONS.incidentInState, {
        state: "Acknowledged",
        incident: "#42",
      }),
      "Acknowledged incident #42",
    ],
    [
      citationSentence(AI_TOOL_CITATIONS.alertInState, {
        state: "Resolved",
        alert: "#7",
      }),
      "Resolved alert #7",
    ],
    [
      citationSentence(AI_TOOL_CITATIONS.pagedPolicyForIncident, {
        policy: "SRE",
        incident: "#42",
      }),
      'Paged "SRE" for incident #42',
    ],
    [
      citationSentence(AI_TOOL_CITATIONS.incidentSeverityChanged, {
        incident: "#42",
        severity: "SEV1",
      }),
      "Incident #42 → SEV1",
    ],
    [
      citationSentence(AI_TOOL_CITATIONS.setUpMonitor, { name: "example.com" }),
      'Set up monitor "example.com"',
    ],
    [
      citationSentence(AI_TOOL_CITATIONS.workflowComponents),
      "Workflow components",
    ],
    [
      citationSentence(AI_TOOL_CITATIONS.onCallNowPolicyNotFound),
      "On-call now (policy not found)",
    ],
    [
      citationSentence(AI_TOOL_CITATIONS.incidentTimelineNotFound),
      "Incident timeline (not found)",
    ],
    [
      citationSentence(AI_TOOL_CITATIONS.statusPageById, { id: "abc" }),
      "Status page abc",
    ],
    [citationSentence(AI_TOOL_CITATIONS.setupHealth), "Setup Health"],
  ])(
    "%j says what the tool always wrote",
    (citation: ToolCitation, english: string) => {
      expect(citation.citationLabel).toBe(english);
      expect(isKnownAIActionSentence(citation.citationWords)).toBe(true);
    },
  );
});
