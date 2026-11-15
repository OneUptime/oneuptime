/** @timezone UTC */
import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import WidgetRenderer from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/Widgets/WidgetRenderer";
import CitationChips from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/CitationChips";
import { getCitationLabelText } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/CitationWords";
import {
  DrawnWidgetHeading,
  getDrawnWidgetHeading,
  getKnownHeadingWords,
  getKnownTableWords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/TableWords";
import { STATUS_LABELS } from "../../../../App/FeatureSet/Dashboard/src/Components/AIInsights/InsightPresentation";
import { TopExceptionsTool } from "../../../Server/Utils/AI/Toolbox/ExceptionTools";
import { QueryAIInsightsTool } from "../../../Server/Utils/AI/Toolbox/AIMetaTools";
import { getEscalationChainCell } from "../../../Server/Utils/AI/Toolbox/OnCallTools";
import { getSecurityCasesCitation } from "../../../Server/Utils/AI/Toolbox/SecurityCaseTools";
import ToolOutputPager from "../../../Server/Utils/AI/Chat/ToolOutputPager";
import {
  citationSentence,
  countFigure,
  ToolCitation,
  windowSentence,
} from "../../../Server/Utils/AI/Toolbox/ReadTableWords";
import WidgetBuilder from "../../../Server/Utils/AI/Toolbox/WidgetBuilder";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../Server/Utils/AI/Toolbox/ToolTypes";
import TelemetryExceptionService from "../../../Server/Services/TelemetryExceptionService";
import AIInsightService from "../../../Server/Services/AIInsightService";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import {
  AIActionSentence,
  aiActionSentence,
  describeAIActionSentence,
} from "../../../Types/AI/AIActionWords";
import {
  AI_INSIGHT_STATUS_LABELS,
  AI_READ_CITATIONS,
  AI_READ_RECORD_TABLE_TITLES,
  AI_READ_WIDGET_LINES,
  AI_READ_WIDGET_TITLES,
  AI_TOOL_CITATIONS,
} from "../../../Types/AI/AIReadTableWords";
import {
  AIChatCitation,
  AIChatWidget,
  AIChatWidgetType,
} from "../../../Types/AI/AIChatTypes";
import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightStatus from "../../../Types/AI/AIInsightStatus";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PositiveNumber from "../../../Types/PositiveNumber";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { widgetToMarkdown } from "../../../UI/Utils/AIChatExport/ChatWidgetMarkdown";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * THE REST OF ASK AI, IN THE READER'S LANGUAGE (issues #8311, #8312,
 * #8313).
 *
 * "Which incidents are active?" left a list headed "Active incidents (3)"
 * over German cards; a chart said "Log volume by severity"; the AI insights
 * table said "ActionRequired" and "High"; an on-call policy's escalation
 * chain was "1. First responders: users [Ana] (escalates after 5m)"; and
 * the chips of the docs, code, write and security tools named what they
 * read in English. Here they are built by the real tools - or by the words
 * the tools build them from - and drawn in English, German, Persian and
 * Arabic: the reader's words, names as named, counts the reader's way. A
 * widget saved before its words, or whose words disagree with what it
 * stores, reads as stored, and the exports print English.
 */

const LANGUAGES: Array<string> = ["de", "fa", "ar"];
const LOCALES: Record<string, Record<string, string>> = {};
for (const language of LANGUAGES) {
  LOCALES[language] = readDashboardLocale(language);
}

const LATIN_DIGIT: RegExp = /[0-9]/;
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const NOW: Date = new Date("2026-09-17T12:00:00.000Z");

const ctx: ToolContext = {
  projectId: PROJECT_ID,
  props: { isRoot: true },
};

// A member of the project who may read telemetry, as the exception tools ask.
const memberCtx: ToolContext = {
  projectId: PROJECT_ID,
  props: {
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userGlobalAccessPermission: {
      globalPermissions: [Permission.Public],
      projectIds: [PROJECT_ID],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: [
          {
            permission: Permission.ProjectMember,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission",
          },
        ],
        _type: "UserTenantAccessPermission",
      },
    },
  } as unknown as DatabaseCommonInteractionProps,
};

// The last day's top exceptions: one group.
async function topExceptions(): Promise<ToolExecutionResult> {
  const exception: TelemetryException = new TelemetryException();
  exception._id = ObjectID.generate().toString();
  exception.message = "Cannot read properties of undefined";
  exception.exceptionType = "TypeError";
  exception.occuranceCount = 420;
  exception.firstSeenAt = new Date("2026-09-10T08:00:00.000Z");
  exception.lastSeenAt = new Date("2026-09-17T11:45:00.000Z");
  exception.isResolved = false;
  exception.fingerprint = "fp-1";

  jest
    .spyOn(TelemetryExceptionService, "findBy")
    .mockResolvedValue([exception] as never);

  return TopExceptionsTool.execute({ lastSeenWithinHours: 24 }, memberCtx);
}

// The last week's AI insights: one that needs attention, one dismissed.
async function aiInsights(): Promise<ToolExecutionResult> {
  const build: (data: {
    title: string;
    status: AIInsightStatus;
    severity: AIInsightSeverity;
    classification?: string;
  }) => AIInsight = (data: {
    title: string;
    status: AIInsightStatus;
    severity: AIInsightSeverity;
    classification?: string;
  }): AIInsight => {
    const insight: AIInsight = new AIInsight();
    insight._id = ObjectID.generate().toString();
    insight.title = data.title;
    insight.status = data.status;
    insight.severity = data.severity;
    insight.classification = data.classification;
    insight.serviceName = "checkout-service";
    insight.lastSeenAt = new Date("2026-09-16T09:00:00Z");
    return insight;
  };

  jest
    .spyOn(AIInsightService, "countBy")
    .mockResolvedValue(new PositiveNumber(2) as never);
  jest.spyOn(AIInsightService, "findBy").mockResolvedValue([
    build({
      title: "Error log spike in checkout-service",
      status: AIInsightStatus.ActionRequired,
      severity: AIInsightSeverity.High,
      classification: "code-fault",
    }),
    build({
      title: "p99 latency regression",
      status: AIInsightStatus.Dismissed,
      severity: AIInsightSeverity.Low,
    }),
  ] as never);

  return QueryAIInsightsTool.execute({}, ctx);
}

// An active-incidents list as the incident tool heads it (IncidentTools).
function activeIncidentsList(): AIChatWidget {
  return {
    ...WidgetBuilder.incidentList({
      words: {
        title: aiActionSentence(AI_READ_WIDGET_TITLES.activeIncidents, {
          count: countFigure(3),
        }),
        description: aiActionSentence(AI_READ_WIDGET_LINES.createdInHours, {
          hours: countFigure(24),
        }),
      },
      items: [
        {
          id: ObjectID.generate().toString(),
          incidentNumber: 42,
          title: "Checkout down",
          state: "Investigating",
          severity: "SEV1",
        },
      ],
    }),
    id: "W1",
  };
}

// A policy's escalation chain, as the policies table words it (OnCallTools).
function policiesTable(): AIChatWidget {
  const chain: AIActionSentence = getEscalationChainCell(
    [
      {
        id: {
          toString: (): string => {
            return "r1";
          },
        },
        order: 1,
        name: "First responders",
        escalateAfterInMinutes: 5,
      },
      {
        id: {
          toString: (): string => {
            return "r2";
          },
        },
        order: 2,
        name: "Managers",
      },
    ] as never,
    new Map([
      ["r1", { users: ["Ana Lopez"], teams: [], schedules: [] }],
      ["r2", { users: [], teams: ["Platform"], schedules: [] }],
    ]),
  );

  return {
    ...WidgetBuilder.table({
      words: {
        title: aiActionSentence(AI_READ_RECORD_TABLE_TITLES.onCallPolicies, {
          count: countFigure(1),
        }),
        cells: [{ escalationChain: chain }],
      },
      columns: [
        { key: "name", title: "Policy", type: "text" },
        { key: "escalationChain", title: "Escalation chain", type: "text" },
      ],
      rows: [{ name: "Checkout on-call", escalationChain: "stored" }],
    }),
    id: "W1",
  };
}

function textOf(element: Element): string {
  return withoutIsolateMarks(element.textContent || "");
}

// A text with its no-break spaces as plain ones: a count keeps its unit.
function withPlainSpaces(text: string): string {
  return text.replace(/[\u00a0\u202f]/g, " ");
}

function onlyWidget(): HTMLElement {
  return screen.getByTestId("ai-chat-widget");
}

function titleText(): string {
  return textOf(within(onlyWidget()).getByTestId("ai-chat-widget-title"));
}

function descriptionText(): string {
  return textOf(within(onlyWidget()).getByTestId("ai-chat-widget-description"));
}

function cells(): Array<string> {
  return screen.getAllByTestId("ai-chat-table-cell").map(textOf);
}

function chipLabels(): Array<string> {
  return screen.getAllByTestId("ai-chat-citation-label").map(textOf);
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

// The locale's own words for a sentence.
function worded(language: string, sentence: AIActionSentence): string {
  return withoutIsolateMarks(
    describeAIActionSentence(sentence, dashboardTranslator(language)),
  );
}

function chip(
  id: string,
  citation: ToolCitation,
  rowCount: number,
): AIChatCitation {
  return {
    id,
    toolName: "tool",
    label: citation.citationLabel,
    words: citation.citationWords,
    queryArguments: {},
    rowCount,
  };
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: LOCALES["de"]! },
      fa: { translation: LOCALES["fa"]! },
      ar: { translation: LOCALES["ar"]! },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await inLanguage("en");
});

describe("an exception list, headed in the reader's language (#8312)", () => {
  test("the tool heads it with words whose English is what it always wrote", async () => {
    const widget: AIChatWidget = (await topExceptions()).widget!;

    expect(widget.type).toBe(AIChatWidgetType.ExceptionList);
    expect(widget.title).toBe("Top exceptions (1)");
    expect(widget.description).toBe("Last 24h, by occurrence count");
    expect(getKnownHeadingWords(widget)).not.toBeNull();
    // Cells are a table's alone.
    expect(getKnownTableWords(widget)).toBeNull();
  });

  test("English: drawn as stored", async () => {
    const widget: AIChatWidget = {
      ...(await topExceptions()).widget!,
      id: "W1",
    };

    await inLanguage("en");
    render(<WidgetRenderer widgets={[widget]} />);

    expect(titleText()).toBe("Top exceptions (1)");
    expect(descriptionText()).toBe("Last 24h, by occurrence count");
  });

  test.each(LANGUAGES)(
    "%s: its title and line are the language's",
    async (language: string) => {
      const widget: AIChatWidget = {
        ...(await topExceptions()).widget!,
        id: "W1",
      };

      await inLanguage(language);
      render(<WidgetRenderer widgets={[widget]} />);

      expect(titleText()).toBe(
        worded(language, getKnownHeadingWords(widget)!.title),
      );
      expect(titleText()).not.toContain("Top exceptions");
      expect(descriptionText()).not.toContain("occurrence");
      expect(descriptionText()).not.toContain("Last");
    },
  );

  test("German: Häufigste Ausnahmen (1)", async () => {
    await inLanguage("de");
    render(
      <WidgetRenderer
        widgets={[{ ...(await topExceptions()).widget!, id: "W1" }]}
      />,
    );

    expect(titleText()).toBe("Häufigste Ausnahmen (1)");
    expect(withPlainSpaces(descriptionText())).toBe(
      "Letzte 24 Std., nach Häufigkeit",
    );
  });
});

describe("an incident list and a chart, headed in the reader's language (#8312)", () => {
  test.each(LANGUAGES)(
    "%s: the list's title and line, its count the reader's way",
    async (language: string) => {
      await inLanguage(language);
      render(<WidgetRenderer widgets={[activeIncidentsList()]} />);

      expect(titleText()).toBe(
        worded(language, getKnownHeadingWords(activeIncidentsList())!.title),
      );
      expect(titleText()).not.toContain("Active incidents");
      expect(descriptionText()).not.toContain("Created in the last");
      // The incident itself is data, as the project wrote it.
      expect(textOf(onlyWidget())).toContain("Checkout down");
    },
  );

  test("Persian: Persian digits, read from the right", async () => {
    await inLanguage("fa");
    render(<WidgetRenderer widgets={[activeIncidentsList()]} />);

    expect(titleText()).toContain("۳");
    expect(titleText()).not.toMatch(LATIN_DIGIT);
    expect(
      within(onlyWidget())
        .getByTestId("ai-chat-widget-title")
        .querySelector("bdi"),
    ).toHaveAttribute("dir", "rtl");
  });

  test("Arabic: read from the right", async () => {
    await inLanguage("ar");
    render(<WidgetRenderer widgets={[activeIncidentsList()]} />);

    expect(titleText()).toBe("الحوادث النشطة (3)");
    expect(
      within(onlyWidget())
        .getByTestId("ai-chat-widget-title")
        .querySelector("bdi"),
    ).toHaveAttribute("dir", "rtl");
  });

  test.each(LANGUAGES)(
    "%s: a log volume chart's title and its window, worded (no render: the heading)",
    (language: string) => {
      const chart: AIChatWidget = WidgetBuilder.bars({
        words: {
          title: aiActionSentence(AI_READ_WIDGET_TITLES.logVolume),
          description: windowSentence(
            new Date("2026-09-17T11:00:00.000Z"),
            new Date("2026-09-17T12:00:00.000Z"),
          ),
        },
        series: [],
      });
      const heading: DrawnWidgetHeading = getDrawnWidgetHeading(
        chart,
        dashboardTranslator(language),
      );

      expect(chart.title).toBe("Log volume by severity");
      expect(heading.title?.text).toBe(
        LOCALES[language]!["Log volume by severity"],
      );
      expect(heading.title?.text).not.toBe("Log volume by severity");
      // The window in the reader's time: no ISO instant on the page.
      expect(heading.description?.text).not.toContain("T11:00:00");
    },
  );

  test("a widget saved before its words, or whose words disagree, reads as stored", () => {
    const saved: AIChatWidget = { ...activeIncidentsList() };
    delete saved.data.tableWords;
    const disagreeing: AIChatWidget = {
      ...activeIncidentsList(),
      title: "Something else (3)",
    };
    const resourceCard: AIChatWidget = {
      ...activeIncidentsList(),
      type: AIChatWidgetType.ResourceCard,
    };

    expect(
      getDrawnWidgetHeading(saved, dashboardTranslator("de")).title,
    ).toBeNull();
    expect(
      getDrawnWidgetHeading(disagreeing, dashboardTranslator("de")).title,
    ).toBeNull();
    // A resource card draws its own words.
    expect(getKnownHeadingWords(resourceCard)).toBeNull();
  });

  test("the Markdown export prints English", () => {
    expect(widgetToMarkdown(activeIncidentsList())).toContain(
      "Active incidents (3)",
    );
  });
});

describe("the AI insights table's words, in the reader's language (#8313)", () => {
  test("the tool words severity, status and triage; English is what the Dashboard's inbox says", async () => {
    const widget: AIChatWidget = (await aiInsights()).widget!;
    const rows: Array<Record<string, unknown>> = widget.data.rows!;

    expect(
      rows.map((row: Record<string, unknown>) => {
        return row["status"];
      }),
    ).toEqual(["Needs Attention", "Dismissed"]);
    expect(
      rows.map((row: Record<string, unknown>) => {
        return row["severity"];
      }),
    ).toEqual(["High", "Low"]);
    expect(rows[0]!["classification"]).toBe("Code fault");
    // The inbox and the table say the same words, from one copy.
    expect(STATUS_LABELS).toBe(AI_INSIGHT_STATUS_LABELS);
    // The model still reads the stored values.
    expect((await aiInsights()).dataForLlm).toContain("ActionRequired");
  });

  test.each(LANGUAGES)(
    "%s: severity, status and triage are the language's",
    async (language: string) => {
      const words: Record<string, string> = LOCALES[language]!;
      const widget: AIChatWidget = {
        ...(await aiInsights()).widget!,
        id: "W1",
      };

      await inLanguage(language);
      render(<WidgetRenderer widgets={[widget]} />);

      const drawn: Array<string> = cells();
      expect(drawn).toContain(words["Needs Attention"]);
      expect(drawn).toContain(words["High"]);
      expect(drawn).toContain(words["Dismissed"]);
      expect(drawn).toContain(words["Code fault"]);
      for (const english of [
        "ActionRequired",
        "Needs Attention",
        "Code fault",
      ]) {
        expect({ language, english, drawn: drawn.includes(english) }).toEqual({
          language,
          english,
          drawn: false,
        });
      }
      // The finding is data, as written.
      expect(drawn).toContain("Error log spike in checkout-service");
    },
  );
});

describe("an escalation chain, in the reader's language (#8313)", () => {
  test("its English is the chain's, rules in a list", () => {
    expect(policiesTable().data.rows![0]!["escalationChain"]).toBe(
      "1. First responders: users [Ana Lopez] (escalates after 5m), 2. Managers: teams [Platform]",
    );
  });

  test.each(LANGUAGES)(
    "%s: the kinds of target and the escalation are the language's; names as named",
    async (language: string) => {
      await inLanguage(language);
      render(<WidgetRenderer widgets={[policiesTable()]} />);

      const chain: string = cells().find((cell: string): boolean => {
        return cell.includes("Ana Lopez");
      })!;

      expect(chain).toContain("Platform");
      expect(chain).toContain("First responders");
      for (const english of ["users [", "teams [", "escalates after"]) {
        expect({ language, english, inChain: chain.includes(english) }).toEqual(
          { language, english, inChain: false },
        );
      }
    },
  );

  test("German: Benutzer [Ana Lopez] (eskaliert nach 5 Min.)", async () => {
    await inLanguage("de");
    render(<WidgetRenderer widgets={[policiesTable()]} />);

    expect(cells().map(withPlainSpaces)).toContain(
      "1. First responders: Benutzer [Ana Lopez] (eskaliert nach 5 Min.), 2. Managers: Teams [Platform]",
    );
  });
});

describe("the chips of the other tools, in the reader's language (#8311)", () => {
  const citations: () => Array<AIChatCitation> = (): Array<AIChatCitation> => {
    return [
      chip(
        "C1",
        citationSentence(AI_TOOL_CITATIONS.docsSearch, { query: "probes" }),
        3,
      ),
      chip(
        "C2",
        citationSentence(AI_TOOL_CITATIONS.createdIncident, {
          incident: "#42",
        }),
        1,
      ),
      chip(
        "C3",
        getSecurityCasesCitation({
          status: "open",
          entity: "10.0.0.7",
          count: 12,
        }),
        12,
      ),
      chip(
        "C4",
        ToolOutputPager.getPageCitation({
          label: "Monitors (4 found)",
          words: aiActionSentence(AI_READ_CITATIONS.monitors, {
            count: countFigure(4),
          }),
          offset: 0,
          end: 5000,
        }),
        1,
      ),
      chip(
        "C5",
        citationSentence(AI_TOOL_CITATIONS.incidentTimelineNotFound),
        0,
      ),
    ];
  };

  test("English: the labels the tools always wrote", async () => {
    await inLanguage("en");
    render(<CitationChips citations={citations()} />);

    expect(chipLabels()).toEqual([
      "Docs search: probes",
      "Created incident #42",
      "Security cases (open, about 10.0.0.7) - 12 found",
      "Monitors (4 found) (characters 0–5000)",
      "Incident timeline (not found)",
    ]);
  });

  test.each(LANGUAGES)(
    "%s: every chip is the language's, its values as written",
    async (language: string) => {
      await inLanguage(language);
      render(<CitationChips citations={citations()} />);

      const labels: Array<string> = chipLabels();

      expect(labels).toHaveLength(5);
      expect(labels[0]).toContain("probes");
      expect(labels[0]).not.toContain("Docs search");
      expect(labels[1]).toContain("#42");
      expect(labels[1]).not.toContain("Created incident");
      expect(labels[2]).toContain("10.0.0.7");
      expect(labels[2]).not.toContain("Security cases");
      // A page of an output names what it is of, worded too.
      expect(labels[3]).not.toContain("Monitors");
      expect(labels[3]).not.toContain("characters");
      expect(labels[4]).not.toContain("Incident timeline");

      for (const citation of citations()) {
        expect(
          withoutIsolateMarks(
            getCitationLabelText(citation, dashboardTranslator(language)),
          ),
        ).not.toBe(citation.label);
      }
    },
  );

  test("Persian: the counts in Persian digits", async () => {
    await inLanguage("fa");
    render(<CitationChips citations={citations()} />);

    const labels: Array<string> = chipLabels();

    expect(labels[2]).toContain("۱۲");
    // 5,000 the Persian way, its thousands set apart.
    expect(labels[3]).toContain("۵٬۰۰۰");
    // The counts are figures; the data (#42, an IP address) as written.
    expect(labels[3]).not.toMatch(LATIN_DIGIT);
    expect(labels[1]).toContain("#42");
    expect(labels[2]).toContain("10.0.0.7");
  });

  test("German: Dokumentationssuche: probes", async () => {
    await inLanguage("de");
    render(<CitationChips citations={citations()} />);

    expect(chipLabels()[0]).toBe("Dokumentationssuche: probes");
    expect(chipLabels()[1]).toBe("Vorfall #42 erstellt");
  });
});
