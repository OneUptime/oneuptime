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
  ClaudeCodeUsageAttributeKeys,
  LlmAgentNameAttributeKeys,
  LlmAttributeNamespacePrefixes,
  LlmCacheReadTokenAttributeKeys,
  LlmCacheWriteTokenAttributeKeys,
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
  LlmEndpointAddressAttributeKeys,
  LlmEventContentAttributeKey,
  RESOURCE_ATTRIBUTE_KEY_PREFIX,
} from "Common/Types/Telemetry/LlmConventions";
import {
  getAzureLlmProviderOfAddress,
  getLlmProviderOfAddress,
  getLlmProviderTitle,
  normalizeLlmProvider,
} from "Common/Types/Telemetry/LlmProviders";
import { LlmEmptyViewFindingKey } from "Common/Types/Telemetry/LlmSetupCheckApi";
import {
  LlmCostCatalogUtil,
  LlmModelPrice as CatalogPrice,
} from "Common/Types/Telemetry/LlmCostCatalog";
import LlmTokenUsageUtil from "Common/Types/Telemetry/LlmTokenUsage";
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
  LlmMetricInputCacheTokenTypes,
  LlmMetricUserAttributeKeys,
  getLlmMetricTokenDirection,
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
  connect: `${DASHBOARD}/Pages/Llm/Connect.tsx`,
  appsPath: `${DASHBOARD}/Components/AI/Connect/LlmAppsPath.tsx`,
  appsSnippets: `${DASHBOARD}/Components/AI/Connect/LlmAppsSnippets.ts`,
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
  budgetJob:
    "packages/App/FeatureSet/Workers/Jobs/Llm/EvaluateLlmCostBudgets.ts",
  priceLoader:
    "packages/App/FeatureSet/Telemetry/Services/LlmModelPriceService.ts",
  priceCatalog: "packages/Common/Types/Telemetry/LlmCostCatalog.ts",
  tokenUsage: "packages/Common/Types/Telemetry/LlmTokenUsage.ts",
  telemetryApi: "packages/Common/Server/API/TelemetryAPI.ts",
  projectService: "packages/Common/Server/Services/ProjectService.ts",
  homeAiPage: "packages/Home/Views/ai-observability.ejs",
  setupCheckCard: `${DASHBOARD}/Components/AI/SetupCheck/LlmSetupCheckCard.tsx`,
  setupCheckWords: `${DASHBOARD}/Components/AI/SetupCheck/LlmSetupCheckWords.ts`,
  emptyViewDiagnosis: `${DASHBOARD}/Components/AI/SetupCheck/LlmEmptyViewDiagnosis.ts`,
  conversationsView: `${DASHBOARD}/Components/LlmConversations/LlmConversationsView.tsx`,
  setupCheckReader:
    "packages/Common/Server/Utils/Telemetry/LlmSetupCheckReader.ts",
  metricUsageReader:
    "packages/Common/Server/Utils/Telemetry/LlmMetricUsageReader.ts",
  metricUsage: "packages/Common/Utils/Telemetry/LlmMetricUsage.ts",
  metricSpend: "packages/Common/Server/Utils/Telemetry/LlmMetricSpend.ts",
};

const INLINE_CODE: RegExp = /`([^`]+)`/g;
const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;
const NUMBER: RegExp = /\d+(?:\.\d+)?/g;
// A tab of the AI / LLM product: `label: "Conversations",`.
const TAB_LABEL: RegExp = /label: "([^"]+)",/g;
/*
 * A step of what to send from your apps, on Connect:
 * `key: "record",\n    title: translationKey("Record what was said"),`.
 */
const APPS_STEP: RegExp =
  /key: "([a-z]+)",\s*title: translationKey\("([^"]+)"\),/g;
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
  /metricDimension: LlmMetricUsageDimension\.\w+,/g;
// A breakdown of the Usage tab that says why the metrics cannot fill it.
const NO_METRIC_SIGNAL_NOTE: RegExp = /noMetricSignalNote: translationKey\(/g;
// Where a Dashboard path on these pages starts: a menu the product has.
const PATH_START: RegExp =
  /^(?:Products|Project Settings|Traces|Team Settings)$/;

function source(name: string): string {
  return fs.readFileSync(path.join(REPO_DIR, SOURCES[name] as string), "utf8");
}

function englishPage(page: string): string {
  return readPage("en", page);
}

function allMatches(
  text: string,
  pattern: RegExp,
  group: number,
): Array<string> {
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

  it("is the page the product links to: the Connect tab's guide and the website's AI page", () => {
    expect(source("appsPath")).toContain(
      'export const LLM_DOCS_PATH: string = "/docs/telemetry/ai-llm-observability";',
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
      "Connect",
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

  it("walks through the five steps of Connect's Your apps: its snippets, then what to send, in its order and with its titles", () => {
    const steps: Array<string> = allMatches(source("appsPath"), APPS_STEP, 2);
    const headings: Array<string> = scanMarkdown(
      section(page, "Set it up in five steps"),
    ).headings.map((heading: DocsHeading): string => {
      return heading.text;
    });

    // The snippets send the calls; the four after them are folded below.
    expect(steps).toHaveLength(4);
    expect(headings).toEqual(["Send your AI calls", ...steps]);
    expect(source("connect")).toContain('title="Your apps"');
    expect(source("appsPath")).toContain(
      'translator.translateText("What to send to get the most out of it")',
    );
    expect(page).toContain(
      "The first step is all you need to see calls. Each step after it shows more.",
    );
  });

  it("names the three ways in as the Connect tab draws them", () => {
    const connect: string = source("connect");
    const rows: Array<Array<string>> = rowsOf(page, "Three ways in");

    for (const title of [
      "Your apps",
      "Your AI provider accounts",
      "Your company's AI tools",
    ]) {
      expect(connect).toContain(`title="${title}"`);
    }

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual([
      "**Your apps**",
      "**Your AI provider accounts**",
      "**Your company's AI tools**",
    ]);
    expect(page).toContain(
      "All three are under **Products → AI / LLM → Connect**.",
    );
    expect(connect).toContain(
      'description="Three ways to bring AI in. Use one, two or all three: everything lands in the same Conversations, Usage, Alerts and Budgets."',
    );
  });

  it("turns recording on with the variable the Connect tab names", () => {
    expect(source("appsSnippets")).toContain(
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
    expect(LlmAnswerIssueUtil.getIssues({ ...base, outputTokens: 0 })).toEqual([
      LlmAnswerIssue.Empty,
    ]);
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
    expect(step).toContain(
      'translator.translateText("Open this call in Traces")',
    );
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
    expect(source("projectService")).toContain(
      'degradedStatus.name = "Degraded";',
    );
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
    // One read of the metric usage route; Codex's micro-USD scaled apart.
    expect(totals).toContain("await fetchLlmMetricUsage({");
    expect(source("metricUsage")).toContain("MICRO_USD_TO_USD");
    expect(rowNamed(rows, "Input and output tokens")[2]).toBe(
      "The spans' token totals are both 0",
    );
    expect(rowNamed(rows, "Cost (USD)")[2]).toBe("The spans' cost total is 0");

    // A breakdown falls back only when it found no span rows, and only three can.
    expect(usage).toContain("if (metricDimension && allRows.length === 0) {");
    expect(rowNamed(rows, "**Employee**, **Team**, **Model** tables")[2]).toBe(
      "That table found no span rows",
    );
    // Cost, and the tokens a person's metrics counted; never a call count.
    expect(rowNamed(rows, "**Employee**, **Team**, **Model** tables")[1]).toBe(
      "Cost, and tokens where the metrics count them; the calls cell shows `—`",
    );
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

  it("lists the providers of the built-in price list, and every shape of its examples' ids finds the model's own price", () => {
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
      "claude-opus-4-5-20251101": "claude-opus-4-5",
      "us.anthropic.claude-opus-4-5-20251101-v1:0": "claude-opus-4-5",
      "claude-opus-4-5@20251101": "claude-opus-4-5",
      "anthropic/claude-opus-4.5": "claude-opus-4-5",
    };

    for (const [model, prefix] of Object.entries(examples)) {
      expect(page).toContain(`\`${model}\``);
      expect(LlmCostCatalogUtil.findPriceForModel(model)?.modelPrefix).toBe(
        prefix,
      );
    }

    expect(page).toContain(
      "are all Claude Opus 4.5. A newer release never takes an older model's price: a model the list does not know is never guessed, and its cost stays 0 until you price it.",
    );

    // Claude Opus 4.5 is not Opus 4: $5 in and $25 out, not $15 and $75.
    expect(
      LlmCostCatalogUtil.findPriceForModel("claude-opus-4-5-20251101")
        ?.inputPricePerMillionTokensInUSD,
    ).toBe(5);
    expect(
      LlmCostCatalogUtil.findPriceForModel("claude-opus-4-20250514")
        ?.inputPricePerMillionTokensInUSD,
    ).toBe(15);

    // A model the list does not know, a later release included, is never guessed.
    for (const model of ["my-fine-tune-7", "claude-opus-4-9", "gpt-5.9"]) {
      expect(
        LlmCostCatalogUtil.computeCostInUSD({
          model: model,
          inputTokens: 1000,
          outputTokens: 1000,
        }),
      ).toBeNull();
    }
  });

  it("prices cached tokens at the provider's cache rates, writes at the 5-minute rate, and long prompts by their length", () => {
    expect(page).toContain(
      "Tokens a span reports as read from or written to the provider's prompt cache are priced at the provider's cache rates, writes at the 5-minute rate, and a model that charges more for a long prompt, such as Claude Haiku 5.5 past 100,000 tokens, is priced by its prompt's length. Estimates are list prices: batch discounts, fast modes and regional premiums are not applied.",
    );

    const opus: CatalogPrice = LlmCostCatalogUtil.findPriceForModel(
      "claude-opus-4-5",
    ) as CatalogPrice;

    // Anthropic's 5-minute cache write is 1.25 times the input price (the 1-hour one is 2 times).
    expect(opus.cacheWritePricePerMillionTokensInUSD).toBe(
      opus.inputPricePerMillionTokensInUSD * 1.25,
    );
    expect(
      LlmCostCatalogUtil.computeCostInUSD({
        model: "claude-opus-4-5",
        inputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBe(opus.cacheReadPricePerMillionTokensInUSD);

    const haiku: CatalogPrice = LlmCostCatalogUtil.findPriceForModel(
      "claude-haiku-5-5",
    ) as CatalogPrice;

    // "Past 100,000 tokens": the long-prompt price starts at the next token.
    expect(haiku.longPrompt?.fromPromptTokens).toBe(100_001);
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

    expect(pricing).toContain("your entry beats the built-in one on ties");
    expect(page).toContain(
      "The longest matching prefix wins across your prices and the built-in list; your price wins a tie. Your price is charged for every input token, cached or not.",
    );
    expect(
      LlmCostCatalogUtil.computeCostInUSD({
        model: "claude-opus-4-5",
        inputTokens: 1_000_000,
        cacheReadTokens: 900_000,
        outputTokens: 0,
        projectPriceOverrides: [
          {
            modelPrefix: "claude-opus-4-5",
            inputPricePerMillionTokensInUSD: 4,
            outputPricePerMillionTokensInUSD: 20,
          },
        ],
      }),
    ).toBe(4);
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

      expect(api).toContain(
        `router.post(\n  ${name},\n  ...requireTraceReadAccess,`,
      );
    }

    expect(page).toContain(
      "Conversations are read with the same permission as traces",
    );
  });

  it("lists every attribute ingest reads, in the order it tries them", () => {
    const rows: Array<Array<string>> = rowsOf(
      page,
      "Attributes OneUptime reads",
    );
    const expected: Record<string, Array<string>> = {
      Provider: LlmSystemAttributeKeys,
      Operation: LlmOperationAttributeKeys,
      "Requested model": LlmRequestModelAttributeKeys,
      "Served model": LlmResponseModelAttributeKeys,
      "Input tokens": LlmInputTokenAttributeKeys,
      "Output tokens": LlmOutputTokenAttributeKeys,
      "Total tokens": LlmTotalTokenAttributeKeys,
      "Cache-read tokens": LlmCacheReadTokenAttributeKeys,
      "Cache-write tokens": LlmCacheWriteTokenAttributeKeys,
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

    expect(LlmAttributeNamespacePrefixes).toEqual([
      "gen_ai.",
      "llm.",
      "traceloop.",
    ]);
    expect(reference).toContain(
      "or any attribute that starts with `gen_ai.`, `llm.` or `traceloop.`",
    );
    expect(prefixes).toBe("`gen_ai.`, `llm.`, `traceloop.`");
    // "Total tokens are input plus output when no total is reported."
    expect(source("tokenUsage")).toContain(
      "const derivedTotal: number = this.count(inputTokens + outputCount);",
    );
    expect(
      LlmTokenUsageUtil.read({
        numberOf: (key: string): number | null => {
          return (
            (
              {
                "gen_ai.usage.input_tokens": 1200,
                "gen_ai.usage.output_tokens": 350,
              } as Record<string, number>
            )[key] ?? null
          );
        },
        namesModelOrProvider: true,
      }).totalTokens,
    ).toBe(1550);
    expect(source("llmSpan")).toContain(
      "fields.llmTotalTokens = usage.totalTokens;",
    );
  });

  it("counts cached tokens in the input, and reads Claude Code's own keys where it sends no gen_ai.usage.*", () => {
    const reference: string = section(page, "Attributes OneUptime reads");
    const claudeCodeKeys: Array<string> = [
      ClaudeCodeUsageAttributeKeys.inputTokens,
      ClaudeCodeUsageAttributeKeys.outputTokens,
      ClaudeCodeUsageAttributeKeys.cacheReadTokens,
      ClaudeCodeUsageAttributeKeys.cacheWriteTokens,
    ];

    expect(reference).toContain(
      "Input tokens count the cached ones too, as the conventions count them: when a span's cache counts are larger than its input count, the input count left them out, and OneUptime adds them in.",
    );
    expect(reference).toContain(
      `Claude Code's traces beta sends no \`gen_ai.usage.*\` keys: on a span that names its model, OneUptime reads its ${claudeCodeKeys
        .slice(0, 3)
        .map((key: string): string => {
          return `\`${key}\``;
        })
        .join(
          ", ",
        )} and \`${claudeCodeKeys[3]}\`, and adds the two cache counts to \`${claudeCodeKeys[0]}\`, which leaves them out.`,
    );

    const numbers: Record<string, number> = {
      input_tokens: 12,
      output_tokens: 640,
      cache_read_tokens: 48_000,
      cache_creation_tokens: 2_100,
      "gen_ai.usage.input_tokens": 50,
      "gen_ai.usage.cache_read_input_tokens": 400,
    };
    const numberOf: (key: string) => number | null = (
      key: string,
    ): number | null => {
      return key in numbers ? (numbers[key] as number) : null;
    };

    // Claude Code: input_tokens + the two cache counts.
    expect(
      LlmTokenUsageUtil.read({
        numberOf: (key: string): number | null => {
          return key.startsWith("gen_ai.") ? null : numberOf(key);
        },
        namesModelOrProvider: true,
      }).inputTokens,
    ).toBe(50_112);

    // A conventions count smaller than its own cache count left it out.
    expect(
      LlmTokenUsageUtil.read({
        numberOf: (key: string): number | null => {
          return key.startsWith("gen_ai.") ? numberOf(key) : null;
        },
        namesModelOrProvider: true,
      }).inputTokens,
    ).toBe(450);
  });

  it("lists where prompts and answers are read from, the conventions' event and attributes first", () => {
    const sources: string = section(
      page,
      "Where prompts and answers are read from",
    );
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

/*
 * #5776: a project whose OpenAI and Azure OpenAI accounts were connected
 * and working had empty Conversations and Calls, and nothing said why. The
 * page now says what each way in fills, how the setup check reads what is
 * arriving, how .NET and Java apps send their calls, where each
 * instrumentation records what was said, and how a provider is named and an
 * Azure call priced. Each claim, held to the code that makes it true.
 */
describe("the AI / LLM Observability page: what is arriving, and from where", () => {
  const page: string = englishPage(LLM);

  it("says provider accounts and coding assistants fill Usage, never Conversations or Calls", () => {
    expect(page).toContain(
      "Provider accounts and coding assistants bring usage and cost, never a call: they fill **Usage**, and **Conversations** and **Calls** stay empty until your apps send their AI calls or a company AI tool is connected.",
    );
    // The check's finding for that project, word for word on the views.
    expect(source("setupCheckWords")).toContain(
      "connected provider accounts report usage and cost by day, never a call or a conversation",
    );
  });

  it("names the setup check as Connect draws it, at the top, with Check again", () => {
    const card: string = source("setupCheckCard");
    const connect: string = source("connect");

    expect(card).toContain('translationKey("Setup check")');
    expect(card).toContain('title: translationKey("Check again")');
    // Above the three ways' tabs.
    expect(connect.indexOf("<LlmSetupCheckCard")).toBeGreaterThan(-1);
    expect(connect.indexOf("<LlmSetupCheckCard")).toBeLessThan(
      connect.indexOf('title="Your apps"'),
    );
    expect(page).toContain(
      "The **Setup check** at the top of **Connect** says what each way in is bringing right now, and **Check again** reads it again.",
    );
  });

  it("says an empty Conversations or Calls list leads with the same finding", () => {
    expect(source("conversationsView")).toContain("getLlmEmptyViewState(");
    expect(source("callsTable")).toContain("getLlmEmptyViewState(");
    expect(source("emptyViewDiagnosis")).toContain("diagnoseEmptyLlmView(");
    expect(page).toContain(
      "An empty **Conversations** or **Calls** list leads with the same finding, and a button for what to do next.",
    );
  });

  it("lists what the check finds, each a finding the views lead with or a line of the card", () => {
    const rows: Array<Array<string>> = rowsOf(page, "Check what is arriving");
    const words: string = source("setupCheckWords");

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual([
      "No app has sent an AI call",
      "An app calls an AI provider's API, and no GenAI instrumentation records it",
      "Calls arrive without prompts or answers",
      "The calls are just outside the time range",
      "A provider account reads no usage",
    ]);

    // The findings behind them.
    for (const key of [
      LlmEmptyViewFindingKey.Nothing,
      LlmEmptyViewFindingKey.Uninstrumented,
      LlmEmptyViewFindingKey.CallsOutsideWindow,
      LlmEmptyViewFindingKey.ProviderAccountsOnly,
    ]) {
      expect(Object.values(LlmEmptyViewFindingKey)).toContain(key);
    }

    expect(words).toContain(
      '"No app has sent an AI call yet. Calls and conversations come from your apps."',
    );
    expect(words).toContain(
      "and no GenAI instrumentation recorded those calls",
    );
    expect(words).toContain(
      "Prompts and answers aren't recorded, so conversations show each call's time, tokens and cost but not what was said.",
    );
    expect(words).toContain("Your apps' newest AI call was {{time}}.");
    expect(words).toContain(
      "No Azure OpenAI or Foundry resource found: give the app registration the Monitoring Reader role where they are.",
    );
  });

  it("names hosts the check recognizes as AI providers' APIs", () => {
    const hosts: Array<string> = codeSpans(
      rowNamed(
        rowsOf(page, "Check what is arriving"),
        "An app calls an AI provider's API, and no GenAI instrumentation records it",
      )[1] as string,
    );

    expect(hosts).toEqual([
      "api.openai.com",
      "*.openai.azure.com",
      "*.services.ai.azure.com",
    ]);
    expect(getLlmProviderOfAddress("api.openai.com")).toBe("openai");
    expect(getAzureLlmProviderOfAddress("contoso.openai.azure.com")).toBe(
      "azure.ai.openai",
    );
    expect(getAzureLlmProviderOfAddress("contoso.services.ai.azure.com")).toBe(
      "azure.ai.openai",
    );
    // The check reads plain HTTP client spans, not AI ones.
    expect(source("setupCheckReader")).toContain(
      "kind = 'SPAN_KIND_CLIENT' AND isLlmSpan = 0",
    );
  });

  it("gives .NET and Java the snippets Connect gives them", () => {
    const steps: string = section(page, "Send your AI calls");
    const snippets: string = source("appsSnippets");
    const fences: Array<{ lang: string; code: string }> =
      scanMarkdown(steps).fences;
    const csharp: { lang: string; code: string } | undefined = fences.find(
      (fence: { lang: string }): boolean => {
        return fence.lang === "csharp";
      },
    );

    expect(csharp).toBeDefined();

    for (const line of csharp!.code.split("\n")) {
      if (line.trim()) {
        expect({ line, inSnippet: snippets.includes(line) }).toEqual({
          line,
          inSnippet: true,
        });
      }
    }

    expect(steps).toContain("dotnet add package OpenTelemetry.Extensions.Hosting");
    expect(snippets).toContain(
      "dotnet add package OpenTelemetry.Extensions.Hosting",
    );
    expect(steps).toContain(
      "https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar",
    );
    expect(snippets).toContain(
      "https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar",
    );
    expect(steps).toContain("java -javaagent:opentelemetry-javaagent.jar");
    expect(snippets).toContain("java -javaagent:opentelemetry-javaagent.jar");
    expect(steps).toContain("@tab .NET");
    expect(steps).toContain("@tab Java");
  });

  it("says where each instrumentation records what was said, as the Connect notes do", () => {
    const snippets: string = source("appsSnippets");

    expect(page).toContain(
      "Python's OpenTelemetry instrumentation records it there with `span_only`; the JavaScript and Java instrumentations, and Python's with `true`, send it as log events, which conversations do not read, and the **Setup check** says so.",
    );
    expect(snippets).toContain("span_only instead of true");
    expect(snippets).toContain(
      "It sends prompts and answers as log events, which conversations do not show",
    );
    expect(snippets).toContain("UseOpenTelemetry and EnableSensitiveData");
    // The check looks for GenAI events on the logs signal.
    expect(source("setupCheckReader")).toContain(
      "public static buildContentInLogsStatement(",
    );
  });

  it("stores a provider under the conventions' name, Azure found by its address", () => {
    for (const [sent, stored] of [
      ["az.ai.openai", "azure.ai.openai"],
      ["azure_openai", "azure.ai.openai"],
      ["az.ai.inference", "azure.ai.inference"],
      ["OpenAI", "openai"],
    ]) {
      expect(normalizeLlmProvider({ reported: sent })).toBe(stored);
      expect(page).toContain(`\`${sent}\``);
    }

    expect(LlmEndpointAddressAttributeKeys).toEqual([
      "server.address",
      "gen_ai.openai.api_base",
    ]);
    expect(
      normalizeLlmProvider({
        reported: "openai",
        addresses: ["contoso.openai.azure.com"],
      }),
    ).toBe("azure.ai.openai");
    expect(
      normalizeLlmProvider({
        reported: "openai",
        addresses: ["https://contoso.services.ai.azure.com/openai/v1/"],
      }),
    ).toBe("azure.ai.openai");
    expect(page).toContain(
      "by its `server.address` or OpenLLMetry's `gen_ai.openai.api_base`, is stored as `azure.ai.openai`.",
    );
  });

  it("says Calls shows the provider by name, and an Azure call's served model under its deployment", () => {
    const calls: string = source("callsTable");

    expect(getLlmProviderTitle("azure.ai.openai")).toBe("Azure OpenAI");
    expect(calls).toContain("getLlmProviderTitle(");
    expect(calls).toContain('data-testid="llm-call-served-model"');
    expect(page).toContain(
      "**Calls** shows the provider by name, and an Azure deployment's call shows the deployment it asked for with, under it, the model that served it and prices it.",
    );
  });

  it("reads the message a gen_ai.event.content JSON carries", () => {
    expect(LlmEventContentAttributeKey).toBe("gen_ai.event.content");
    expect(
      section(page, "Where prompts and answers are read from"),
    ).toContain(
      "with the message in `gen_ai.event.content` when Azure's AI Inference SDK or Semantic Kernel sent them",
    );
  });

  it("says a token or cost metric counts the way a counter counts", () => {
    expect(source("metricUsageReader")).toContain(
      "if(aggregationTemporality = 'Cumulative', cityHash64(mapKeys(attributes), mapValues(attributes)), 0)",
    );
    expect(source("budgetEvaluator")).toContain("LlmMetricSpend");
    expect(page).toContain(
      "a cumulative counter, the OpenTelemetry SDKs' default, counts what it grew by in the time range, each series on its own, so a running total exported every minute is counted once. Budgets count GenAI metrics the same way.",
    );
  });

  it("troubleshoots connected accounts and empty views, and an Azure call priced by its served model", () => {
    expect(page).toContain(
      ":::details Provider accounts are connected, but Conversations and Calls are empty",
    );
    expect(page).toContain(
      "An Azure OpenAI call is priced by the model that served it, `gen_ai.response.model`: when its span names none, price the deployment's name.",
    );
    // The served model is priced before the requested one.
    expect(source("llmSpan")).toContain("llmResponseModel");
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
    expect(
      codeSpans(rowNamed(rows, "Team / cost centre")[1] as string),
    ).toEqual(LlmTeamBaseAttributeKeys);
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
    expect(
      codeSpans(rowNamed(rows, "Team / cost centre")[1] as string),
    ).toEqual(LlmMetricTeamBaseAttributeKeys);
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
    expect(
      LlmUserEmailAttributeKeys.slice(LlmUserEmailBaseAttributeKeys.length),
    ).toEqual(
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

    expect(
      codeSpans(excluded).filter((key: string): boolean => {
        return LlmEndUserBaseAttributeKeys.includes(key);
      }),
    ).toEqual(LlmEndUserBaseAttributeKeys);

    for (const key of LlmEndUserBaseAttributeKeys) {
      expect(LlmUserIdAttributeKeys).not.toContain(key);
      expect(LlmUserEmailAttributeKeys).not.toContain(key);
    }

    expect(source("llmSpanPanel")).toContain('label: "End user (customer)"');
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
    const metrics: string = section(
      page,
      "Coding-assistant metrics OneUptime reads",
    );
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
    const metrics: string = section(
      page,
      "Coding-assistant metrics OneUptime reads",
    );

    expect(metrics).toContain(
      "The token type is read from `gen_ai.token.type`, `llm.token.type`, `type`, `cursor.token.type` or `token_type`",
    );
    expect(metrics).toContain(
      "with Claude Code's `cacheRead` and `cacheCreation` as input, since its `input` leaves them out",
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
    // The keys a Claude Code point can carry: Cursor's own are not among them.
    expect(
      LlmMetricUserBaseAttributeKeys.filter((key: string): boolean => {
        return !key.startsWith("cursor.");
      }).slice(0, 2),
    ).toEqual(["user.email", "user.id"]);
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

  it("counts the camelCase cache types as input, since Claude Code's input leaves them out", () => {
    expect(getLlmTokenDirection("input")).toBe("input");
    expect(getLlmTokenDirection("output")).toBe("output");
    expect(LlmMetricInputCacheTokenTypes["claude_code.token.usage"]).toEqual([
      "cacheread",
      "cachecreation",
    ]);

    for (const cache of ["cacheRead", "cacheCreation"]) {
      expect(
        getLlmMetricTokenDirection("claude_code.token.usage", cache),
      ).toBe("input");
      // Another tool's cache types are not Claude Code's: left out.
      expect(getLlmMetricTokenDirection("cursor.token.usage", cache)).toBeNull();
    }

    expect(page).toContain(
      "Claude Code's `input` leaves them out, so OneUptime counts them as input tokens too.",
    );
  });

  it("says the Usage tab and budgets count a delta and a cumulative counter each the way it counts", () => {
    const reader: string = source("metricUsageReader");

    expect(reader).toContain(
      "if(aggregationTemporality = 'Cumulative', greatest(max(value) - if(min(startTime) >= ",
    );
    expect(reader).toContain("0, min(value)), 0), sum(value)) AS increase");
    // Budgets read the metrics through the same reader.
    expect(source("metricSpend")).toContain("LlmMetricUsageReader");
    expect(page).toContain(
      "OneUptime's Usage tab and budgets count both: a delta by adding its points up, a cumulative counter by what it grew in the time range.",
    );
  });

  it("says the traces beta's model spans get their tokens and a cost, read from Claude Code's own keys", () => {
    const traces: string = section(page, "Traces (beta)");

    expect(LlmSystemAttributeKeys).toContain("gen_ai.system");
    expect(LlmRequestModelAttributeKeys).toContain("gen_ai.request.model");
    expect(ClaudeCodeUsageAttributeKeys).toEqual({
      inputTokens: "input_tokens",
      outputTokens: "output_tokens",
      cacheReadTokens: "cache_read_tokens",
      cacheWriteTokens: "cache_creation_tokens",
    });

    // The bare keys are Claude Code's own, never one of the conventions' lists.
    for (const key of ["input_tokens", "output_tokens"]) {
      expect(LlmInputTokenAttributeKeys).not.toContain(key);
      expect(LlmOutputTokenAttributeKeys).not.toContain(key);
    }

    // 12 + 48,000 + 2,100 input tokens and 640 output tokens on Claude Opus 4.8.
    expect(
      LlmCostCatalogUtil.computeCostInUSD({
        model: "claude-opus-4-8",
        inputTokens: 50_112,
        cacheReadTokens: 48_000,
        cacheWriteTokens: 2_100,
        outputTokens: 640,
      }),
    ).toBe(0.053185);

    expect(traces).toContain("> [!NOTE]");
    expect(traces).not.toContain("[!WARNING]");
    expect(traces).toContain(
      "reads their `input_tokens`, `output_tokens`, `cache_read_tokens` and `cache_creation_tokens` as the call's tokens, and prices each call at its model's list prices.",
    );
    expect(traces).toContain(
      "That is OneUptime's estimate, with cache writes at the 5-minute rate and no fast-mode price, so it can differ from `claude_code.cost.usage`.",
    );
    expect(LlmCostMetricNames).toContain("claude_code.cost.usage");
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

  it("reads Cursor's email first, then its user id, and its team and model", () => {
    expect(LlmMetricUserBaseAttributeKeys).toContain("cursor.user.id");
    expect(LlmMetricTeamBaseAttributeKeys).toContain("cursor.team.id");
    expect(LlmMetricModelBaseAttributeKeys).toContain("cursor.model.name");
    expect(LlmTokenTypeAttributeKeys).toContain("cursor.token.type");

    /*
     * #5776: the metric identity reads cursor.user.email, before
     * cursor.user.id, with the resource. prefix too. Cursor sends metrics and
     * log events, no GenAI spans, so the spans' identity keys need neither.
     */
    const email: number =
      LlmMetricUserBaseAttributeKeys.indexOf("cursor.user.email");

    expect(email).toBeGreaterThan(-1);
    expect(email).toBeLessThan(
      LlmMetricUserBaseAttributeKeys.indexOf("cursor.user.id"),
    );
    expect(LlmMetricUserAttributeKeys).toContain("resource.cursor.user.email");

    expect(page).toContain(
      "OneUptime reads `cursor.user.email` as the employee when Cursor sends it, `cursor.user.id` when it does not",
    );
    expect(page).toContain(
      "| **Employee** | Yes, by `cursor.user.email`, else `cursor.user.id` |",
    );
    expect(page).toContain(
      "That is `cursor.user.id`, read when Cursor sends no `cursor.user.email`.",
    );
  });

  it("leaves Cursor's cache token types out of the totals", () => {
    expect(getLlmTokenDirection("cache_read")).toBeNull();
    expect(getLlmTokenDirection("cache_creation")).toBeNull();
    expect(page).toContain(
      "(its `input` and `output` types; cache tokens are left out)",
    );
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
