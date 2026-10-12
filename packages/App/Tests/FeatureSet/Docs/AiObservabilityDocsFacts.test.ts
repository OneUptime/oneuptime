import { DocsHeading, readPage, scanMarkdown } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import { prose } from "./DocsTranslationChecks";
import LlmCostBudget from "Common/Models/DatabaseModels/LlmCostBudget";
import LlmModelPrice from "Common/Models/DatabaseModels/LlmModelPrice";
import { CheckOn } from "Common/Types/Monitor/CriteriaFilter";
import MonitorRecommendationSeverityMapper from "Common/Types/Monitor/Recommendation/MonitorRecommendationSeverityMapper";
import { MonitorRecommendationSeverityMap } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "Common/Types/ObjectID";
import LlmMonitorTemplates, {
  LlmMonitorTemplate,
  LlmMonitorTemplateFilter,
  LlmMonitorTemplateId,
} from "Common/Types/Monitor/LlmMonitor/LlmMonitorTemplates";
import {
  LLM_MONITOR_DEFAULT_WINDOW_SECONDS,
  MonitorStepLlmMonitorUtil,
} from "Common/Types/Monitor/MonitorStepLlmMonitor";
import {
  LlmAnswerIssue,
  LlmAnswerIssueInfo,
  LlmAnswerIssueUtil,
} from "Common/Types/Telemetry/LlmAnswerIssue";
import { LlmCallKind } from "Common/Types/Telemetry/LlmCallKind";
import {
  LLM_CONVERSATIONS_ROUTE,
  LLM_CONVERSATION_ROUTE,
} from "Common/Types/Telemetry/LlmConversationApi";
import {
  LlmAgentNameAttributeKeys,
  LlmAttributeNamespacePrefixes,
  LlmCompletionEventNames,
  LlmCompletionIndexedMessageConventions,
  LlmCompletionJsonAttributeKeys,
  LlmConversationIdAttributeKeys,
  LlmCostAttributeKeys,
  LlmEndUserBaseAttributeKeys,
  LlmErrorTypeAttributeKeys,
  LlmEvaluationResultEventName,
  LlmEvaluationScoreLabelAttributeKey,
  LlmFinishReasonAttributeKeys,
  LlmInferenceDetailsEventName,
  LlmInputTokenAttributeKeys,
  LlmOperationAttributeKeys,
  LlmOutputTokenAttributeKeys,
  LlmPromptEventNames,
  LlmPromptIndexedMessageConventions,
  LlmPromptJsonAttributeKeys,
  LlmRequestModelAttributeKeys,
  LlmResponseModelAttributeKeys,
  LlmSystemAttributeKeys,
  LlmSystemInstructionsAttributeKeys,
  LlmTeamAttributeKeys,
  LlmTeamBaseAttributeKeys,
  LlmToolNameAttributeKeys,
  LlmTotalTokenAttributeKeys,
  LlmUserEmailAttributeKeys,
  LlmUserEmailBaseAttributeKeys,
  LlmUserIdAttributeKeys,
  LlmUserIdBaseAttributeKeys,
  RESOURCE_ATTRIBUTE_KEY_PREFIX,
} from "Common/Types/Telemetry/LlmConventions";
import { LlmCostCatalogUtil } from "Common/Types/Telemetry/LlmCostCatalog";
import {
  LlmCostMetricNames,
  LlmInputTokenTypeValues,
  LlmMetricModelBaseAttributeKeys,
  LlmMetricTeamBaseAttributeKeys,
  LlmMetricUserBaseAttributeKeys,
  LlmMicroUsdCostMetricNames,
  LlmOutputTokenTypeValues,
  LlmTokenTypeAttributeKeys,
  LlmTokenUsageMetricNames,
  MICRO_USD_TO_USD,
  getLlmTokenDirection,
} from "Common/Types/Telemetry/LlmMetricConventions";
import LlmConversationReplay, {
  IDLE_GAP_THRESHOLD_MS,
  REPLAY_SPEEDS,
} from "Common/Utils/Telemetry/LlmConversationReplay";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 24a: what the AI / LLM Observability, AI Coding
 * Assistants, Claude Code, Cursor and OpenAI Codex pages say about OneUptime,
 * held to the code that does it - the attribute and metric names ingest
 * reads, the answer checks, the replay, the alert templates, the Usage tab's
 * fallback from spans to metrics, the price list, budgets, and the
 * Dashboard's own words for its tabs, fields and buttons. The translations
 * are held to these English pages by AiObservabilityDocsTranslations.
 *
 * What the coding assistants themselves do (Claude Code's variables,
 * Cursor's dashboard, Codex's config.toml) is the vendors' and is not in this
 * repository; it was checked against their documentation and sources when
 * the pages were written. Where a vendor's telemetry meets OneUptime's code
 * - a metric or attribute name OneUptime reads, or one it does not - it is
 * held here.
 *
 * App tests read no React module, so the Dashboard's words are read from its
 * source files as text; Common's types and utilities are imported.
 */

const REPO_DIR: string = path.resolve(__dirname, "../../../../..");

const LLM: string = "telemetry/ai-llm-observability";
const ASSISTANTS: string = "telemetry/ai-coding-assistants";
const CLAUDE_CODE: string = "telemetry/claude-code";
const CURSOR: string = "telemetry/cursor";
const CODEX: string = "telemetry/openai-codex";

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

const SOURCES: Record<string, string> = {
  navTabs: `${DASHBOARD}/Components/AI/LlmNavTabs.tsx`,
  layout: `${DASHBOARD}/Pages/Llm/Layout.tsx`,
  setup: `${DASHBOARD}/Pages/Llm/Documentation.tsx`,
  budgets: `${DASHBOARD}/Pages/Llm/Budgets.tsx`,
  pricing: `${DASHBOARD}/Pages/Llm/Pricing.tsx`,
  callsTable: `${DASHBOARD}/Components/AI/LlmCallsTable.tsx`,
  usageBreakdown: `${DASHBOARD}/Components/AI/LlmUsageBreakdown.tsx`,
  usageTotals: `${DASHBOARD}/Components/AI/LlmUsageTotals.tsx`,
  summaryTiles: `${DASHBOARD}/Components/LlmConversations/LlmSummaryTiles.tsx`,
  replayBar: `${DASHBOARD}/Components/LlmConversations/LlmReplayBar.tsx`,
  replayKeyboard: `${DASHBOARD}/Components/LlmConversations/LlmReplayKeyboard.ts`,
  replayState: `${DASHBOARD}/Components/LlmConversations/useLlmConversationReplay.ts`,
  replayRoutes: `${DASHBOARD}/Components/LlmConversations/LlmConversationRoutes.ts`,
  transcriptStep: `${DASHBOARD}/Components/LlmConversations/LlmTranscriptStepView.tsx`,
  templateCopy: `${DASHBOARD}/Components/LlmAlerts/LlmMonitorTemplateCopy.ts`,
  monitorPrefill: `${DASHBOARD}/Utils/LlmMonitorPrefill.ts`,
  monitorData: `${DASHBOARD}/Utils/LlmMonitorData.ts`,
  monitorForm: `${DASHBOARD}/Components/Form/Monitor/LlmMonitor/LlmMonitorStepForm.tsx`,
  criteriaFilter: `${DASHBOARD}/Utils/Form/Monitor/CriteriaFilter.ts`,
  spanPanel: `${DASHBOARD}/Components/Traces/TraceDetail/TraceSpanPanel.tsx`,
  llmSpanPanel: `${DASHBOARD}/Components/Traces/LlmSpanPanel.tsx`,
  navigationItems: `${DASHBOARD}/Utils/NavigationItems.tsx`,
  settingsSideMenu: `${DASHBOARD}/Pages/Settings/SideMenu.tsx`,
  ingestionKeys: `${DASHBOARD}/Pages/Settings/TelemetryIngestionKeys.tsx`,
  tracesNavTabs: `${DASHBOARD}/Components/Traces/TracesNavTabs.tsx`,
  tracesSettingsMenu: `${DASHBOARD}/Pages/Traces/Settings/SideMenu.tsx`,
  moreFieldsTitle:
    "packages/Common/UI/Components/FoldedSection/FoldedSectionTitles.ts",
  llmSpan: "packages/Common/Server/Utils/Telemetry/LlmSpan.ts",
  budgetEvaluator:
    "packages/Common/Server/Utils/Telemetry/LlmCostBudgetEvaluator.ts",
  budgetJob: "packages/App/FeatureSet/Workers/Jobs/Llm/EvaluateLlmCostBudgets.ts",
  priceLoader: "packages/App/FeatureSet/Telemetry/Services/LlmModelPriceService.ts",
  priceCatalog: "packages/Common/Types/Telemetry/LlmCostCatalog.ts",
  telemetryApi: "packages/Common/Server/API/TelemetryAPI.ts",
  projectService: "packages/Common/Server/Services/ProjectService.ts",
  homeAiPage: "packages/Home/Views/ai-observability.ejs",
};

const TABLE_ROW: RegExp = /^\|/;
const INLINE_CODE: RegExp = /`([^`]+)`/g;
const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;
const NUMBER: RegExp = /\d+(?:\.\d+)?/g;
// A tab of the AI / LLM product: `label: "Conversations",`.
const TAB_LABEL: RegExp = /label: "([^"]+)",/g;
// A step of the Setup tab: `key: "send",\n      title: "Send your AI calls",`.
const SETUP_STEP: RegExp = /key: "([a-z]+)",\s*title: "([^"]+)",/g;
// A template's card title in the Dashboard's copy.
const TEMPLATE_TITLE: RegExp =
  /\[LlmMonitorTemplateId\.(\w+)\]: \{\s*title: translationKey\("([^"]+)"\)/g;
// A form field's title: `title: "Time window",`.
const FIELD_TITLE: RegExp = /title: "([^"]+)",/g;
// A menu section written as data: `title: "Telemetry & APM",`.
const MENU_TITLE: RegExp = /title: "([^"]+)"/g;
// A provider section of the built-in price list: `// ---- Anthropic ----`.
const CATALOG_SECTION: RegExp = /\/\/ ---- ([^-]+?)(?: \([^)]*\))? ----/g;
const LINE_BREAK: RegExp = /\n/;
// A breakdown of the Usage tab that the metrics can fill.
const METRIC_FALLBACK_DIMENSION: RegExp =
  /metricAttributeKeys: LlmMetric\w+AttributeKeys,/g;
// A breakdown of the Usage tab that says why the metrics cannot fill it.
const NO_METRIC_SIGNAL_NOTE: RegExp = /noMetricSignalNote: translationKey\(/g;
// Where a Dashboard path on these pages starts: a menu the product has.
const PATH_START: RegExp = /^(?:Products|Project Settings|Traces|Team Settings)$/;

function source(name: string): string {
  return fs.readFileSync(
    path.join(REPO_DIR, SOURCES[name] as string),
    "utf8",
  );
}

function englishPage(page: string): string {
  return readPage("en", page);
}

function allMatches(text: string, pattern: RegExp, group: number): Array<string> {
  return Array.from(text.matchAll(pattern)).map(
    (match: RegExpMatchArray): string => {
      return match[group] as string;
    },
  );
}

function codeSpans(text: string): Array<string> {
  return allMatches(text, INLINE_CODE, 1);
}

function boldSpans(text: string): Array<string> {
  return allMatches(text, BOLD, 1);
}

/*
 * A section of a page: from its heading to the next heading of the same
 * level or higher, without the heading line itself.
 */
function section(markdown: string, heading: string): string {
  const headings: Array<DocsHeading> = scanMarkdown(markdown).headings;
  const index: number = headings.findIndex((entry: DocsHeading): boolean => {
    return entry.text === heading;
  });

  expect({ heading, found: index >= 0 }).toEqual({ heading, found: true });

  const start: DocsHeading = headings[index] as DocsHeading;
  const next: DocsHeading | undefined = headings
    .slice(index + 1)
    .find((entry: DocsHeading): boolean => {
      return entry.level <= start.level;
    });
  const lines: Array<string> = markdown.split(LINE_BREAK);

  return lines
    .slice(start.line, next ? next.line - 1 : lines.length)
    .join("\n");
}

// The rows of the first table of a section, without the header row.
function rowsOf(markdown: string, heading: string): Array<Array<string>> {
  const found: Array<Array<Array<string>>> = tables(section(markdown, heading));

  expect(found.length).toBeGreaterThan(0);

  return (found[0] as Array<Array<string>>).slice(1);
}

// A table row whose first cell is `name`.
function rowNamed(rows: Array<Array<string>>, name: string): Array<string> {
  const row: Array<string> | undefined = rows.find(
    (cells: Array<string>): boolean => {
      return cells[0] === name;
    },
  );

  expect({ name, found: row !== undefined }).toEqual({ name, found: true });

  return row as Array<string>;
}

function numbersIn(text: string): Array<number> {
  return allMatches(text, NUMBER, 0).map((value: string): number => {
    return Number(value);
  });
}

function template(id: LlmMonitorTemplateId): LlmMonitorTemplate {
  return LlmMonitorTemplates.get(id) as LlmMonitorTemplate;
}

function filterValue(
  filters: Array<LlmMonitorTemplateFilter>,
  checkOn: CheckOn,
): number | undefined {
  return filters.find((filter: LlmMonitorTemplateFilter): boolean => {
    return filter.checkOn === checkOn;
  })?.value;
}

describe("the AI / LLM Observability page", () => {
  const page: string = englishPage(LLM);

  it("is the page the product links to: the Setup tab's guide and the website's AI page", () => {
    expect(source("setup")).toContain(
      'export const LLM_DOCS_URL: string = "/docs/telemetry/ai-llm-observability";',
    );
    expect(source("homeAiPage")).toContain(
      'href="/docs/telemetry/ai-llm-observability"',
    );
  });

  it("opens the product from Products → AI / LLM, which the Products menu lists under Observability", () => {
    const items: string = source("navigationItems");
    const entry: string = items.slice(
      items.indexOf('t("navbar.items.llmObservabilityTitle", "AI / LLM")'),
    );

    expect(entry.length).toBeLessThan(items.length);
    expect(entry.slice(0, entry.indexOf("category:") + 40)).toContain(
      "category: observabilityCategory",
    );
    expect(page).toContain(
      "Open **Products → AI / LLM**, under **Observability**.",
    );
  });

  it("names the product's seven tabs in the order the product draws them", () => {
    const labels: Array<string> = allMatches(source("navTabs"), TAB_LABEL, 1);
    const rows: Array<Array<string>> = rowsOf(page, "How it works");

    expect(labels).toEqual([
      "Conversations",
      "Calls",
      "Usage",
      "Alerts",
      "Budgets",
      "Pricing",
      "Setup",
    ]);
    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(
      labels.map((label: string): string => {
        return `**${label}**`;
      }),
    );
    expect(page).toContain("The product has seven tabs:");
  });

  it("says what the Conversations tab counts above its list, as its tiles do", () => {
    const tiles: string = source("summaryTiles");

    for (const tile of [
      "Conversations",
      "AI answers",
      "Need attention",
      "Cost",
      "Typical answer time",
    ]) {
      expect(tiles).toContain(`label="${tile}"`);
    }

    expect(page).toContain(
      "Above the list: conversations, AI answers, how many need attention, cost and the typical answer time.",
    );
  });

  it("lists the Calls tab's filters, and opens a call in the trace viewer", () => {
    const calls: string = source("callsTable");

    for (const filter of [
      "Service",
      "Provider",
      "Model",
      "Operation",
      "User Email",
      "User ID",
      "Team",
      "Conversation ID",
    ]) {
      expect(calls).toContain(`title: "${filter}",`);
    }

    expect(calls).toContain("RouteMap[PageMap.TRACE_VIEW]");
    expect(page).toContain(
      "Filter by service, provider, model, operation, person, team or conversation; click a call to open it in the trace viewer.",
    );
  });

  it("names the trace viewer's LLM tab, which shows a call's provider, model, tokens and cost", () => {
    expect(source("spanPanel")).toContain('label: "LLM"');

    for (const chip of ["Provider", "Model"]) {
      expect(source("llmSpanPanel")).toContain(`label: "${chip}"`);
    }

    expect(page).toContain("the span of each AI call also has an **LLM** tab");
  });

  it("walks through the Setup tab's five steps, in its order and with its titles", () => {
    const steps: Array<string> = allMatches(source("setup"), SETUP_STEP, 2);
    const headings: Array<string> = scanMarkdown(
      section(page, "Set it up in five steps"),
    ).headings.map((heading: DocsHeading): string => {
      return heading.text;
    });

    expect(steps).toHaveLength(5);
    expect(headings).toEqual(steps);
    expect(source("setup")).toContain(
      "Five steps. The first is all you need to start; each one after it shows more.",
    );
    expect(page).toContain(
      "The first step is all you need to see calls. Each step after it shows more.",
    );
  });

  it("turns recording on with the variable the Setup tab names", () => {
    expect(source("setup")).toContain(
      "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true",
    );
    expect(page).toContain(
      "export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true",
    );
  });

  it("groups calls by the conversation keys ingest reads, the Vercel AI SDK's included", () => {
    const step: string = section(page, "Group calls into conversations");

    expect(LlmConversationIdAttributeKeys.slice(0, 2)).toEqual([
      "gen_ai.conversation.id",
      "session.id",
    ]);
    expect(step).toContain(
      "Set `gen_ai.conversation.id` (or `session.id`) to your chat's id",
    );
    expect(LlmConversationIdAttributeKeys).toContain(
      "traceloop.association.properties.session_id",
    );
    expect(LlmConversationIdAttributeKeys).toContain(
      "ai.telemetry.metadata.sessionId",
    );
    expect(step).toContain(
      "pass the chat's id as `experimental_telemetry: { metadata: { sessionId } }`",
    );
  });

  it("lists the five answer problems in the product's order, with the finish reasons and labels that raise them", () => {
    const rows: Array<Array<string>> = rowsOf(page, "Flag bad answers");
    const infos: Array<LlmAnswerIssueInfo> = LlmAnswerIssueUtil.getAllInfo();

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(
      infos.map((info: LlmAnswerIssueInfo): string => {
        return info.title;
      }),
    );

    for (const reason of codeSpans(rowNamed(rows, "Refused")[2] as string)) {
      expect({ reason, refusal: true }).toEqual({
        reason,
        refusal: LlmAnswerIssueUtil.isRefusalFinishReason(reason),
      });
    }

    for (const reason of codeSpans(rowNamed(rows, "Cut off")[2] as string)) {
      expect({ reason, cutOff: true }).toEqual({
        reason,
        cutOff: LlmAnswerIssueUtil.isCutOffFinishReason(reason),
      });
    }

    const step: string = section(page, "Flag bad answers");
    const labels: Array<string> = codeSpans(
      step.slice(step.indexOf("Labels such as")),
    ).slice(0, 6);

    expect(labels).toEqual([
      "incorrect",
      "wrong",
      "unhelpful",
      "toxic",
      "unsafe",
      "hallucination",
    ]);

    for (const label of [...labels, "fail"]) {
      expect({ label, failing: true }).toEqual({
        label,
        failing: LlmAnswerIssueUtil.isFailingEvaluation({
          name: "relevance",
          label: label,
          score: null,
          explanation: "",
        }),
      });
    }

    expect(LlmEvaluationResultEventName).toBe("gen_ai.evaluation.result");
    expect(LlmEvaluationScoreLabelAttributeKey).toBe(
      "gen_ai.evaluation.score.label",
    );
  });

  it("says a finish reason of error fails a call, and 0 output tokens leave an answer empty", () => {
    const base: {
      kind: LlmCallKind;
      statusIsError: boolean;
      errorType: string;
      finishReasons: Array<string>;
      outputTokens: number | null;
      answer: {
        recorded: boolean;
        hasText: boolean;
        hasToolCall: boolean;
        hasMedia: boolean;
        hasRefusal: boolean;
        leadingText: string;
      };
      evaluations: [];
    } = {
      kind: LlmCallKind.Answer,
      statusIsError: false,
      errorType: "",
      finishReasons: [],
      outputTokens: 12,
      answer: {
        recorded: false,
        hasText: false,
        hasToolCall: false,
        hasMedia: false,
        hasRefusal: false,
        leadingText: "",
      },
      evaluations: [],
    };

    expect(
      LlmAnswerIssueUtil.getIssues({ ...base, finishReasons: ["error"] }),
    ).toContain(LlmAnswerIssue.Failed);
    expect(LlmAnswerIssueUtil.getIssues({ ...base, outputTokens: 0 })).toEqual(
      [LlmAnswerIssue.Empty],
    );
    expect(
      LlmAnswerIssueUtil.getIssues({
        ...base,
        answer: { ...base.answer, recorded: true, leadingText: "" },
      }),
    ).toEqual([LlmAnswerIssue.Empty]);
    expect(
      LlmAnswerIssueUtil.opensWithRefusal(
        "I'm sorry, but I can't help with that request.",
      ),
    ).toBe(true);
  });

  it("describes the replay bar as it works: skip waiting on by default above 3 seconds, four speeds, K, J and L", () => {
    const rows: Array<Array<string>> = rowsOf(
      page,
      "Read and replay a conversation",
    );

    expect(source("replayBar")).toContain('translator.translateText("Replay")');
    expect(source("replayBar")).toContain(
      'translator.translateText("Skip waiting")',
    );
    expect(source("replayState")).toContain(
      "const [skipWaiting, setSkipWaitingState] = useState<boolean>(true);",
    );
    expect(IDLE_GAP_THRESHOLD_MS).toBe(3000);
    expect(rowNamed(rows, "**Skip waiting**")[1]).toBe(
      "On by default: shortens any silence longer than 3 seconds.",
    );

    expect(REPLAY_SPEEDS).toEqual([1, 2, 4, 8]);
    expect(LlmConversationReplay.nextSpeed(8)).toBe(1);
    expect(source("replayBar")).toContain("label={`${controller.speed}x`}");
    expect(rowNamed(rows, "`1x`")[1]).toBe(
      "Changes the speed: 1x, 2x, 4x or 8x.",
    );

    const keyboard: string = source("replayKeyboard");

    for (const key of ['case "k":', 'case "j":', 'case "l":']) {
      expect(keyboard).toContain(key);
    }

    expect(keyboard).toContain('case "ArrowLeft":');
    expect(keyboard).toContain('case "ArrowRight":');
    expect(source("replayRoutes")).toContain('query["step"]');
    expect(page).toContain("(`?step=`)");
  });

  it("names the answer details as the conversation view draws them", () => {
    const step: string = source("transcriptStep");

    expect(step).toContain('translator.translateText("Details")');
    expect(step).toContain('translator.translateText("Stopped because")');
    expect(step).toContain('translator.translateText("Evaluations")');
    expect(step).toContain('translator.translateText("Open this call in Traces")');
    expect(page).toContain(
      "**Details** under an answer shows why it stopped, its evaluations, and a link to the call in Traces.",
    );
  });

  it("lists the seven ready-made alerts in the Alerts tab's order, with their thresholds, windows and severity", () => {
    const titles: Array<string> = allMatches(
      source("templateCopy"),
      TEMPLATE_TITLE,
      2,
    );
    const rows: Array<Array<string>> = rowsOf(
      page,
      "Get told when the AI answers badly",
    );

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(titles);
    expect(LlmMonitorTemplates.getAll()).toHaveLength(7);

    LlmMonitorTemplates.getAll().forEach(
      (entry: LlmMonitorTemplate, index: number): void => {
        const row: Array<string> = rows[index] as Array<string>;
        const percent: number | undefined = filterValue(
          entry.unhealthyFilters,
          CheckOn.LlmBadAnswerPercent,
        );
        const minimum: number | undefined = filterValue(
          entry.unhealthyFilters,
          CheckOn.LlmBadAnswerCount,
        );
        const windowMinutes: number = entry.step.lastXSecondsOfCalls / 60;
        const stated: Array<number> = numbersIn(row[1] as string);

        expect({ alert: row[0], severity: row[2] }).toEqual({
          alert: row[0],
          severity: entry.severity,
        });

        if (entry.id === LlmMonitorTemplateId.NoAnswers) {
          expect(
            filterValue(entry.unhealthyFilters, CheckOn.LlmAnswerCount),
          ).toBe(0);
          expect(stated).toEqual([windowMinutes]);
          return;
        }

        if (entry.id === LlmMonitorTemplateId.FlaggedAnswers) {
          // "An evaluation marks an answer as bad": one is enough.
          expect(minimum).toBe(1);
          expect(stated).toEqual([]);
          return;
        }

        const expected: Array<number> =
          percent === undefined
            ? [minimum as number, windowMinutes]
            : [percent, windowMinutes];

        if (entry.step.slowAnswerSeconds > 0) {
          expected.push(entry.step.slowAnswerSeconds);
        }

        expect({ alert: row[0], stated }).toEqual({
          alert: row[0],
          stated: expected,
        });
      },
    );
  });

  it("says the share alerts wait for 3 bad answers", () => {
    for (const entry of LlmMonitorTemplates.getAll()) {
      if (
        filterValue(entry.unhealthyFilters, CheckOn.LlmBadAnswerPercent) ===
        undefined
      ) {
        continue;
      }

      expect(
        filterValue(entry.unhealthyFilters, CheckOn.LlmBadAnswerCount),
      ).toBe(3);
    }

    expect(page).toContain(
      "The alerts on a share of answers also wait for at least 3 bad answers",
    );
  });

  it("says a Critical template takes the project's most severe alert severity and a Warning one the next: High and Low in a new project", () => {
    const high: ObjectID = ObjectID.generate();
    const low: ObjectID = ObjectID.generate();
    const mapping: MonitorRecommendationSeverityMap =
      MonitorRecommendationSeverityMapper.getDefaultSeverityMapping([
        { id: low, name: "Low", order: 2 },
        { id: high, name: "High", order: 1 },
      ]);

    expect(mapping.Critical?.toString()).toBe(high.toString());
    expect(mapping.Warning?.toString()).toBe(low.toString());
    expect(source("projectService")).toContain('highSeverity.name = "High";');
    expect(source("projectService")).toContain('lowSeverity.name = "Low";');
    expect(page).toContain(
      "A Critical alert takes your project's most severe alert severity and a Warning alert the next one: High and Low in a new project.",
    );
  });

  it("names the AI / LLM monitor's fields, its default window and its three criteria as the form draws them", () => {
    const form: string = source("monitorForm");
    const fields: Array<string> = allMatches(form, FIELD_TITLE, 1);

    for (const field of [
      "Count an answer as bad when it",
      "Or takes longer than (seconds)",
      "Time window",
      "Apps",
      "Model",
    ]) {
      expect(fields).toContain(field);
      expect(page).toContain(`**${field}**`);
    }

    // The model is the one field folded under More fields.
    expect(form.slice(form.indexOf('title: "Model",'))).toContain(
      "collapsibleSection: MORE_LLM_MONITOR_FIELDS",
    );
    expect(source("moreFieldsTitle")).toContain(
      'MORE_FIELDS_SECTION_TITLE: string = translationKey("More fields")',
    );
    expect(form).toContain('title="Preview"');
    expect(LLM_MONITOR_DEFAULT_WINDOW_SECONDS).toBe(15 * 60);
    expect(MonitorStepLlmMonitorUtil.getDefault().lastXSecondsOfCalls).toBe(
      15 * 60,
    );
    expect(page).toContain("(**Time window**, 15 minutes by default)");

    expect([
      CheckOn.LlmBadAnswerPercent,
      CheckOn.LlmBadAnswerCount,
      CheckOn.LlmAnswerCount,
    ]).toEqual(["Bad AI Answers (in %)", "Bad AI Answers", "AI Answers"]);
    expect(page).toContain(
      "Its criteria compare three numbers: **Bad AI Answers (in %)**, **Bad AI Answers** and **AI Answers**.",
    );
  });

  it("says a ready-made alert resolves itself, shows Degraded, and leaves its incident off", () => {
    const prefill: string = source("monitorPrefill");

    expect(prefill).toContain("autoResolveAlert: true,");
    expect(prefill).toContain("createIncidents: false,");
    expect(prefill).toContain("createAlerts: Boolean(severityIds.alert),");
    // The first status that is neither operational nor offline: Degraded.
    expect(source("monitorData")).toContain(
      "status.id && !status.isOperationalState && !status.isOfflineState,",
    );
    expect(source("monitorData")).toContain(
      "unhealthyMonitorStatusId: degraded?.id || offline?.id || null,",
    );
    expect(source("projectService")).toContain('degradedStatus.name = "Degraded";');
    expect(page).toContain(
      "A ready-made alert raises an alert that resolves itself, and shows the monitor as **Degraded** while answers are bad. Its incident is filled in but switched off: switch it on to page someone instead.",
    );
  });

  it("describes the Usage tab as it is drawn: 7 days, the top 25, five breakdowns, Unattributed", () => {
    const usage: string = source("usageBreakdown");

    expect(usage).toContain("const DEFAULT_WINDOW_DAYS: number = 7;");
    expect(usage).toContain("const TOP_K_GROUPS: number = 25;");

    for (const dimension of [
      "Employee",
      "Team",
      "Model",
      "Provider",
      "Application / Service",
    ]) {
      expect(usage).toContain(`label: "${dimension}",`);
    }

    expect(usage).toContain(
      'const UNATTRIBUTED_LABEL: string = translationKey("Unattributed");',
    );
    expect(page).toContain(
      "(the last 7 days unless you pick another), and a table of the top 25 under one of five breakdowns: **Employee**, **Team**, **Model**, **Provider** and **Application / Service**.",
    );
  });

  it("states the fallback from spans to metrics exactly as the Usage tab applies it", () => {
    const totals: string = source("usageTotals");
    const usage: string = source("usageBreakdown");
    const rows: Array<Array<string>> = rowsOf(
      page,
      "Spans come first, metrics fill in",
    );

    // Tokens fall back when both span sums are 0, cost when the span cost is.
    expect(totals).toContain("if (spanInput === 0 && spanOutput === 0) {");
    expect(totals).toContain("if (spanCost === 0) {");
    expect(totals).toContain("LlmMetricQuery.buildMicroUsdCostQuery");
    expect(rowNamed(rows, "Input and output tokens")[2]).toBe(
      "The spans' token totals are both 0",
    );
    expect(rowNamed(rows, "Cost (USD)")[2]).toBe("The spans' cost total is 0");

    // A breakdown falls back only when it found no span rows, and only three can.
    expect(usage).toContain("if (metricAttributeKeys && allRows.length === 0) {");
    expect(
      rowNamed(rows, "**Employee**, **Team**, **Model** tables")[2],
    ).toBe("That table found no span rows");
    expect(usage.match(METRIC_FALLBACK_DIMENSION)).toHaveLength(3);
    expect(usage.match(NO_METRIC_SIGNAL_NOTE)).toHaveLength(2);
    expect(
      rowNamed(rows, "**Provider**, **Application / Service** tables")[1],
    ).toBe("Nothing: spans only");

    expect(usage).toContain(
      'const METRIC_SOURCE_HINT: string = translationKey("from GenAI metrics");',
    );
    expect(page).toContain(
      "A figure taken from metrics is marked **from GenAI metrics**",
    );
  });

  it("says a reported cost wins, even 0, and the served model is priced before the requested one", () => {
    const span: string = source("llmSpan");

    expect(LlmCostAttributeKeys[0]).toBe("gen_ai.usage.cost");
    expect(span).toContain("fields.llmCost = reportedCost ?? 0;");
    expect(span).toContain(
      "model: fields.llmResponseModel || fields.llmRequestModel,",
    );
    expect(page).toContain(
      "A cost your instrumentation reports (`gen_ai.usage.cost`) is used as it is, even when it is 0.",
    );
    expect(page).toContain(
      "The served model is priced first, then the requested model.",
    );
  });

  it("lists the providers of the built-in price list, and its examples find their family's price", () => {
    const providers: Array<string> = allMatches(
      source("priceCatalog"),
      CATALOG_SECTION,
      1,
    );

    expect(providers).toEqual([
      "OpenAI",
      "Anthropic",
      "Google Gemini",
      "Mistral",
      "DeepSeek",
      "xAI",
      "Cohere",
      "Amazon Nova",
      "Meta Llama",
    ]);
    expect(page).toContain(
      "a built-in list of prices for common OpenAI, Anthropic, Google Gemini, Mistral, DeepSeek, xAI, Cohere, Amazon Nova and Meta Llama models",
    );

    const examples: Record<string, string> = {
      "gpt-4o-2024-08-06": "gpt-4o",
      "us.anthropic.claude-sonnet-4-5-20250929-v1:0": "claude-sonnet-4",
    };

    for (const [model, family] of Object.entries(examples)) {
      expect(page).toContain(`\`${model}\``);
      expect(LlmCostCatalogUtil.findPriceForModel(model)?.modelPrefix).toBe(
        family,
      );
    }

    // A model the list does not know is never guessed.
    expect(
      LlmCostCatalogUtil.computeCostInUSD({
        model: "my-fine-tune-7",
        inputTokens: 1000,
        outputTokens: 1000,
      }),
    ).toBeNull();
  });

  it("names the Pricing tab's fields, and says when a new price applies", () => {
    const pricing: string = source("pricing");

    for (const label of [
      "Custom LLM Pricing",
      "Model Prefix",
      "Input Price (USD per 1M tokens)",
      "Output Price (USD per 1M tokens)",
    ]) {
      expect(pricing).toContain(`title: "${label}",`);
      expect(page).toContain(`**${label}**`);
    }

    expect(pricing).toContain(
      "your entry beats the built-in one on ties",
    );
    expect(page).toContain(
      "The longest matching prefix wins across your prices and the built-in list; your price wins a tie.",
    );
    expect(source("priceLoader")).toContain(
      "const CACHE_TTL_MS: number = 60 * 1000; // 60 seconds",
    );
    expect(page).toContain(
      "A price applies to calls that arrive about a minute after you save it; calls already stored keep their cost.",
    );
    expect(new LlmModelPrice().singularName).toBe("LLM Model Price");
  });

  it("describes budgets as the worker runs them: every 15 minutes, spans then metrics, two metrics with these attributes", () => {
    const evaluator: string = source("budgetEvaluator");
    const rows: Array<Array<string>> = rowsOf(page, "Daily cost budgets");

    expect(source("budgetJob")).toContain("schedule: EVERY_FIFTEEN_MINUTE,");
    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual([
      "`oneuptime.llm.budget.spend.usd`",
      "`oneuptime.llm.budget.percent.used`",
    ]);

    for (const name of [
      '"oneuptime.llm.budget.spend.usd"',
      '"oneuptime.llm.budget.percent.used"',
      '"oneuptime.llm.budget.id"',
      '"oneuptime.llm.budget.name"',
    ]) {
      expect(evaluator).toContain(name);
    }

    expect(evaluator).toContain("if (spanSpend > 0) {");
    expect(evaluator).toContain(
      "const metricSpend: number = await LlmMetricSpend.getCostInUSD(",
    );
    expect(page).toContain(
      "Every 15 minutes OneUptime adds up the day's AI spend (from spans, or from GenAI cost metrics when no span reported any)",
    );
  });

  it("names the budget form's fields and its create button as the Budgets tab draws them", () => {
    const budgets: string = source("budgets");

    for (const field of [
      "Daily Budget (USD)",
      "Service (optional)",
      "LLM Provider (optional)",
      "LLM Model (optional)",
    ]) {
      expect(budgets).toContain(`title: "${field}",`);
      expect(page).toContain(`**${field}**`);
    }

    // The table names no singular of its own, so its button is the model's.
    expect(budgets).not.toContain("singularName=");
    expect(new LlmCostBudget().singularName).toBe("LLM Cost Budget");
    expect(page).toContain("click **Create LLM Cost Budget**");
    expect(budgets).toContain("with a 30-minute rolling window");
    expect(page).toContain("Set the monitor's rolling window to 30 minutes.");
  });

  it("sends readers to the ingestion keys and the trace settings the product has", () => {
    const settings: string = source("settingsSideMenu");
    const telemetry: string = settings.slice(
      settings.indexOf('title: "Telemetry & APM",'),
    );

    expect(telemetry.slice(0, 400)).toContain('title: "Ingestion Keys",');
    expect(source("ingestionKeys")).toContain('singularName="Ingestion Key"');
    expect(allMatches(source("tracesSettingsMenu"), MENU_TITLE, 1)).toEqual(
      expect.arrayContaining(["Drop Filters", "Scrub Rules"]),
    );
    expect(source("tracesNavTabs")).toContain('label: "Settings",');
    expect(page).toContain(
      "**Project Settings → Telemetry & APM → Ingestion Keys**",
    );
    expect(page).toContain("Find both under **Traces → Settings**.");
  });

  it("says conversations are read with the traces' permission", () => {
    const api: string = source("telemetryApi");

    for (const route of [LLM_CONVERSATIONS_ROUTE, LLM_CONVERSATION_ROUTE]) {
      const name: string =
        route === LLM_CONVERSATIONS_ROUTE
          ? "LLM_CONVERSATIONS_ROUTE"
          : "LLM_CONVERSATION_ROUTE";

      expect(api).toContain(`router.post(\n  ${name},\n  ...requireTraceReadAccess,`);
    }

    expect(page).toContain(
      "Conversations are read with the same permission as traces",
    );
  });

  it("lists every attribute ingest reads, in the order it tries them", () => {
    const rows: Array<Array<string>> = rowsOf(page, "Attributes OneUptime reads");
    const expected: Record<string, Array<string>> = {
      Provider: LlmSystemAttributeKeys,
      Operation: LlmOperationAttributeKeys,
      "Requested model": LlmRequestModelAttributeKeys,
      "Served model": LlmResponseModelAttributeKeys,
      "Input tokens": LlmInputTokenAttributeKeys,
      "Output tokens": LlmOutputTokenAttributeKeys,
      "Total tokens": LlmTotalTokenAttributeKeys,
      "Cost (USD)": LlmCostAttributeKeys,
      Conversation: LlmConversationIdAttributeKeys,
      Agent: LlmAgentNameAttributeKeys,
      Tool: LlmToolNameAttributeKeys,
      "Finish reason": LlmFinishReasonAttributeKeys,
      Error: LlmErrorTypeAttributeKeys,
    };

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(Object.keys(expected));

    for (const row of rows) {
      expect({ value: row[0], keys: codeSpans(row[1] as string) }).toEqual({
        value: row[0],
        keys: expected[row[0] as string],
      });
    }
  });

  it("says which attributes make a span an AI call", () => {
    const reference: string = section(page, "Attributes OneUptime reads");
    const prefixes: string = LlmAttributeNamespacePrefixes.map(
      (prefix: string): string => {
        return `\`${prefix}\``;
      },
    ).join(", ");

    expect(LlmAttributeNamespacePrefixes).toEqual(["gen_ai.", "llm.", "traceloop."]);
    expect(reference).toContain(
      "or any attribute that starts with `gen_ai.`, `llm.` or `traceloop.`",
    );
    expect(prefixes).toBe("`gen_ai.`, `llm.`, `traceloop.`");
    expect(source("llmSpan")).toContain(
      "fields.llmTotalTokens = fields.llmInputTokens + fields.llmOutputTokens;",
    );
  });

  it("lists where prompts and answers are read from, the conventions' event and attributes first", () => {
    const sources: string = section(page, "Where prompts and answers are read from");
    const named: Array<string> = codeSpans(sources);

    for (const key of [
      LlmInferenceDetailsEventName,
      ...LlmSystemInstructionsAttributeKeys,
      ...LlmPromptEventNames,
      ...LlmCompletionEventNames,
      ...LlmPromptJsonAttributeKeys,
      ...LlmCompletionJsonAttributeKeys,
    ]) {
      expect({ key, named: named.includes(key) }).toEqual({ key, named: true });
    }

    for (const convention of [
      ...LlmPromptIndexedMessageConventions,
      ...LlmCompletionIndexedMessageConventions,
    ]) {
      const key: string = `${convention.prefix}.N.${convention.contentSuffix}`;

      expect({ key, named: named.includes(key) }).toEqual({ key, named: true });
    }

    expect(named[0]).toBe(LlmInferenceDetailsEventName);
  });
});

describe("the AI Coding Assistants page", () => {
  const page: string = englishPage(ASSISTANTS);

  it("is the page the Usage tab sends readers to about attribution", () => {
    expect(source("usageBreakdown")).toContain(
      'const ATTRIBUTION_DOCS_URL: string = "/docs/telemetry/ai-coding-assistants";',
    );
    expect(
      scanMarkdown(page).headings.map((heading: DocsHeading): string => {
        return heading.text;
      }),
    ).toContain("Employee and team attribution");
  });

  it("lists the span identity keys ingest reads, in its order", () => {
    const rows: Array<Array<string>> = rowsOf(
      page,
      "Attributes read as the employee",
    );

    expect(codeSpans(rowNamed(rows, "Employee id")[1] as string)).toEqual(
      LlmUserIdBaseAttributeKeys,
    );
    expect(codeSpans(rowNamed(rows, "Employee email")[1] as string)).toEqual(
      LlmUserEmailBaseAttributeKeys,
    );
    expect(codeSpans(rowNamed(rows, "Team / cost centre")[1] as string)).toEqual(
      LlmTeamBaseAttributeKeys,
    );
  });

  it("lists the metric identity and model keys, email first", () => {
    const tablesOfSection: Array<Array<Array<string>>> = tables(
      section(page, "Attributes read as the employee"),
    );
    const rows: Array<Array<string>> = (
      tablesOfSection[1] as Array<Array<string>>
    ).slice(1);

    expect(codeSpans(rowNamed(rows, "Employee")[1] as string)).toEqual(
      LlmMetricUserBaseAttributeKeys,
    );
    expect(codeSpans(rowNamed(rows, "Team / cost centre")[1] as string)).toEqual(
      LlmMetricTeamBaseAttributeKeys,
    );
    expect(codeSpans(rowNamed(rows, "Model")[1] as string)).toEqual(
      LlmMetricModelBaseAttributeKeys,
    );
    expect(LlmMetricUserBaseAttributeKeys[0]).toBe("user.email");
  });

  it("says every identity key is read with a resource. prefix too, the bare keys first", () => {
    expect(RESOURCE_ATTRIBUTE_KEY_PREFIX).toBe("resource.");
    expect(LlmUserIdAttributeKeys).toEqual([
      ...LlmUserIdBaseAttributeKeys,
      ...LlmUserIdBaseAttributeKeys.map((key: string): string => {
        return `resource.${key}`;
      }),
    ]);
    expect(LlmUserEmailAttributeKeys.slice(LlmUserEmailBaseAttributeKeys.length)).toEqual(
      LlmUserEmailBaseAttributeKeys.map((key: string): string => {
        return `resource.${key}`;
      }),
    );
    expect(LlmTeamAttributeKeys).toContain("resource.team.id");
    expect(page).toContain(
      "**Every key is also read with a `resource.` prefix.**",
    );
  });

  it("says the Usage tab labels a person by email first, and reads identity only from AI calls", () => {
    const usage: string = source("usageBreakdown");

    expect(usage).toContain(
      'readRowColumn(row, "llmUserEmail") || readRowColumn(row, "llmUserId")',
    );
    expect(page).toContain(
      "**The Usage tab shows a person's email when the call has one, and the id otherwise.**",
    );
    expect(source("llmSpan")).toContain(
      "fields.llmUserId = this.getString(attributes, LlmUserIdAttributeKeys);",
    );
    expect(source("llmSpan")).toContain(
      "Identity is gated on isLlmSpan for exactly the reason the",
    );
    expect(page).toContain("**Identity is read only from AI calls.**");
  });

  it("lists exactly the customer keys ingest never reads as the employee", () => {
    const excluded: string = section(
      page,
      "What is deliberately not treated as the employee",
    );

    expect(codeSpans(excluded).filter((key: string): boolean => {
      return LlmEndUserBaseAttributeKeys.includes(key);
    })).toEqual(LlmEndUserBaseAttributeKeys);

    for (const key of LlmEndUserBaseAttributeKeys) {
      expect(LlmUserIdAttributeKeys).not.toContain(key);
      expect(LlmUserEmailAttributeKeys).not.toContain(key);
    }

    expect(source("llmSpanPanel")).toContain(
      'label: "End user (customer)"',
    );
  });

  it("lists the coding assistants' metrics ingest reads, and their units", () => {
    const rows: Array<Array<string>> = rowsOf(
      page,
      "Coding-assistant metrics OneUptime reads",
    );
    const listed: Array<string> = rows.map((row: Array<string>): string => {
      return codeSpans(row[0] as string)[0] as string;
    });

    expect(listed).toEqual([
      "claude_code.token.usage",
      "claude_code.cost.usage",
      "cursor.token.usage",
      "cursor.cost.usage",
      "codex.turn.token_usage",
      "codex.turn.cost_microusd",
    ]);

    for (const row of rows) {
      const metric: string = codeSpans(row[0] as string)[0] as string;
      const unit: string = row[2] as string;

      if (unit === "Tokens") {
        expect(LlmTokenUsageMetricNames).toContain(metric);
      } else if (unit.startsWith("USD")) {
        expect(LlmCostMetricNames).toContain(metric);
      } else {
        expect(LlmMicroUsdCostMetricNames).toContain(metric);
        expect(unit).toContain("Millionths of a USD");
      }
    }

    expect(MICRO_USD_TO_USD).toBe(0.000001);
  });

  it("names the other token and cost metrics ingest reads, and leaves Gemini CLI's own out", () => {
    const metrics: string = section(page, "Coding-assistant metrics OneUptime reads");
    const named: Array<string> = codeSpans(metrics);

    for (const metric of [...LlmTokenUsageMetricNames, ...LlmCostMetricNames]) {
      expect({ metric, named: named.includes(metric) }).toEqual({
        metric,
        named: true,
      });
    }

    expect(LlmTokenUsageMetricNames).not.toContain("gemini_cli.token.usage");
    expect(metrics).toContain(
      "**`gemini_cli.token.usage` is left out on purpose.**",
    );
  });

  it("counts only input and output tokens, read from the token type keys it names", () => {
    const metrics: string = section(page, "Coding-assistant metrics OneUptime reads");

    expect(metrics).toContain(
      "The token type is read from `gen_ai.token.type`, `llm.token.type`, `type`, `cursor.token.type` or `token_type`",
    );
    expect(LlmTokenTypeAttributeKeys).toEqual([
      "gen_ai.token.type",
      "llm.token.type",
      "type",
      "cursor.token.type",
      "token_type",
    ]);
    expect(LlmInputTokenTypeValues).toEqual(["input", "prompt"]);
    expect(LlmOutputTokenTypeValues).toEqual(["output", "completion"]);

    for (const dropped of [
      "cacheRead",
      "cacheCreation",
      "cache_read",
      "cache_creation",
      "cached_input",
      "cache_write_input",
      "total",
      "reasoning_output",
    ]) {
      expect({ dropped, direction: getLlmTokenDirection(dropped) }).toEqual({
        dropped,
        direction: null,
      });
    }
  });

  it("says which Usage breakdowns a metrics-only tool can fill", () => {
    const rows: Array<Array<string>> = rowsOf(
      page,
      "Coding-assistant metrics are a fallback, not an addition",
    );
    const usage: string = source("usageBreakdown");

    expect(
      rows.map((row: Array<string>): string => {
        return `${row[0]} ${(row[1] as string).startsWith("Yes") ? "yes" : "no"}`;
      }),
    ).toEqual([
      "**Employee** yes",
      "**Team** yes",
      "**Model** yes",
      "**Provider** no",
      "**Application / Service** no",
    ]);
    expect(usage).toContain(
      "Coding-agent metric streams (Claude Code, Cursor, Codex) do not report a provider",
    );
    expect(usage).toContain(
      "Coding-agent metric streams (Claude Code, Cursor, Codex) are not attached to a OneUptime service",
    );
    expect(LlmMetricModelBaseAttributeKeys).toEqual(
      expect.arrayContaining(["model", "cursor.model.name"]),
    );
  });
});

describe("the Claude Code page", () => {
  const page: string = englishPage(CLAUDE_CODE);

  it("names the two Claude Code metrics the Usage tab reads", () => {
    const shows: string = section(page, "What OneUptime shows");

    expect(LlmCostMetricNames).toContain("claude_code.cost.usage");
    expect(LlmTokenUsageMetricNames).toContain("claude_code.token.usage");
    expect(shows).toContain(
      "`claude_code.cost.usage` feeds the **Employee**, **Team** and **Model** tables, and `claude_code.token.usage` the token totals.",
    );
  });

  it("reads the employee from user.email first, then user.id, as the metric keys are ordered", () => {
    expect(LlmMetricUserBaseAttributeKeys.slice(0, 2)).toEqual([
      "user.email",
      "user.id",
    ]);
    expect(page).toContain("**The employee is `user.email`.**");
    expect(page).toContain(
      "Without an email, each install shows as its own row.",
    );
  });

  it("reads the team keys the page tells you to set, and the bare model Claude Code stamps", () => {
    expect(LlmMetricTeamBaseAttributeKeys.slice(0, 4)).toEqual([
      "team.id",
      "team",
      "cost_center",
      "department",
    ]);
    expect(page).toContain(
      "OneUptime reads `team.id`, `team`, `cost_center` and `department`.",
    );
    expect(LlmMetricModelBaseAttributeKeys).toContain("model");
  });

  it("counts only the input and output token types, not the camelCase cache types", () => {
    expect(getLlmTokenDirection("input")).toBe("input");
    expect(getLlmTokenDirection("output")).toBe("output");
    expect(getLlmTokenDirection("cacheRead")).toBeNull();
    expect(getLlmTokenDirection("cacheCreation")).toBeNull();
    expect(page).toContain(
      "OneUptime's token totals count only `input` and `output`.",
    );
  });

  it("warns that the traces beta's model spans arrive with no tokens: their token keys are not ones ingest reads", () => {
    expect(LlmSystemAttributeKeys).toContain("gen_ai.system");
    expect(LlmRequestModelAttributeKeys).toContain("gen_ai.request.model");

    for (const key of ["input_tokens", "output_tokens"]) {
      expect(LlmInputTokenAttributeKeys).not.toContain(key);
      expect(LlmOutputTokenAttributeKeys).not.toContain(key);
    }

    expect(
      LlmCostCatalogUtil.computeCostInUSD({
        model: "claude-sonnet-4-5",
        inputTokens: 0,
        outputTokens: 0,
      }),
    ).toBeNull();
    expect(section(page, "Traces (beta)")).toContain(
      "but their tokens are in `input_tokens` and `output_tokens`, not the `gen_ai.usage.*` keys, so they arrive with no tokens and no cost.",
    );
  });
});

describe("the Cursor page", () => {
  const page: string = englishPage(CURSOR);

  it("names the Cursor metrics the Usage tab reads, and the one it only charts", () => {
    expect(LlmTokenUsageMetricNames).toContain("cursor.token.usage");
    expect(LlmCostMetricNames).toContain("cursor.cost.usage");
    expect([...LlmTokenUsageMetricNames, ...LlmCostMetricNames]).not.toContain(
      "cursor.tool.calls",
    );
    expect(page).toContain(
      "So in OneUptime, Cursor shows on the **Usage** tab of **Products → AI / LLM**, from `cursor.token.usage` and `cursor.cost.usage`",
    );
  });

  it("reads Cursor's user, team and model, and not yet its email", () => {
    expect(LlmMetricUserBaseAttributeKeys).toContain("cursor.user.id");
    expect(LlmMetricTeamBaseAttributeKeys).toContain("cursor.team.id");
    expect(LlmMetricModelBaseAttributeKeys).toContain("cursor.model.name");
    expect(LlmTokenTypeAttributeKeys).toContain("cursor.token.type");

    /*
     * The page says OneUptime does not read cursor.user.email yet. When an
     * identity list starts reading it, this fails: then say so on the
     * Cursor and AI Coding Assistants pages, in every language.
     */
    for (const keys of [
      LlmUserIdAttributeKeys,
      LlmUserEmailAttributeKeys,
      LlmMetricUserBaseAttributeKeys,
    ]) {
      expect(keys).not.toContain("cursor.user.email");
      expect(keys).not.toContain("resource.cursor.user.email");
    }

    expect(page).toContain(
      "Cursor can also send `cursor.user.email`, but OneUptime does not read it yet",
    );
  });

  it("leaves Cursor's cache token types out of the totals", () => {
    expect(getLlmTokenDirection("cache_read")).toBeNull();
    expect(getLlmTokenDirection("cache_creation")).toBeNull();
    expect(page).toContain("(its `input` and `output` types; cache tokens are left out)");
  });
});

describe("the OpenAI Codex page", () => {
  const page: string = englishPage(CODEX);

  it("names the Codex metrics ingest reads, and converts the micro-USD one", () => {
    expect(LlmTokenUsageMetricNames).toContain("codex.turn.token_usage");
    expect(LlmMicroUsdCostMetricNames).toEqual(["codex.turn.cost_microusd"]);
    expect(LlmCostMetricNames).not.toContain("codex.turn.cost_microusd");
    expect(page).toContain(
      "The cost totals then take Codex's cost from `codex.turn.cost_microusd`, converted to USD for you.",
    );
  });

  it("reads Codex's span tokens, but cannot price a span that names no model", () => {
    expect(LlmInputTokenAttributeKeys[0]).toBe("gen_ai.usage.input_tokens");
    expect(LlmOutputTokenAttributeKeys[0]).toBe("gen_ai.usage.output_tokens");
    expect(
      LlmCostCatalogUtil.computeCostInUSD({
        model: "",
        inputTokens: 1200,
        outputTokens: 300,
      }),
    ).toBeNull();
    expect(page).toContain(
      "Codex's spans name no model, so OneUptime cannot price them, and their cost is 0.",
    );
  });

  it("reads the token_type key and leaves Codex's total, cached and reasoning types out", () => {
    expect(LlmTokenTypeAttributeKeys).toContain("token_type");

    for (const dropped of [
      "total",
      "cached_input",
      "cache_write_input",
      "reasoning_output",
    ]) {
      expect(getLlmTokenDirection(dropped)).toBeNull();
    }
  });

  it("names the identity keys a span carries for OneUptime to read, user.id first", () => {
    expect(LlmUserIdBaseAttributeKeys[0]).toBe("user.id");
    expect(LlmUserEmailBaseAttributeKeys[0]).toBe("user.email");
    expect(page).toContain(
      "`user.id` is the key OneUptime prefers, and `user.email` fills the email column.",
    );
  });
});

describe("every page of the group", () => {
  it.each([LLM, ASSISTANTS, CLAUDE_CODE, CURSOR, CODEX])(
    "%s names OneUptime's OTLP endpoint and header the way ingest reads them",
    (page: string) => {
      const markdown: string = englishPage(page);

      expect(markdown).toContain("https://oneuptime.com/otlp");
      expect(prose(markdown) + markdown).toContain("x-oneuptime-token");
    },
  );

  it.each([LLM, ASSISTANTS, CLAUDE_CODE, CURSOR, CODEX])(
    "%s names only Dashboard paths that start where the product's menus do",
    (page: string) => {
      const paths: Array<string> = boldSpans(prose(englishPage(page))).filter(
        (span: string): boolean => {
          return span.includes(" → ");
        },
      );

      for (const found of paths) {
        const first: string = found.split(" → ")[0] as string;

        expect({ found, first }).toEqual({
          found,
          first: expect.stringMatching(PATH_START),
        });
      }
    },
  );
});
