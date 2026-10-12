import {
  AI_GATEWAYS,
  CIRCUIT_BREAKER,
  GEMINI_COPILOT,
} from "./AiObservabilityDocsPages";
import { DocsHeading, readPage, scanMarkdown } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import Alert from "Common/Models/DatabaseModels/Alert";
import LlmCostBudget from "Common/Models/DatabaseModels/LlmCostBudget";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import {
  LlmAttributeNamespacePrefixes,
  LlmConversationIdAttributeKeys,
  LlmCostAttributeKeys,
  LlmEndUserBaseAttributeKeys,
  LlmTeamAttributeKeys,
  LlmTeamBaseAttributeKeys,
  LlmUserEmailAttributeKeys,
  LlmUserEmailBaseAttributeKeys,
  LlmUserIdAttributeKeys,
  LlmUserIdBaseAttributeKeys,
  RESOURCE_ATTRIBUTE_KEY_PREFIX,
} from "Common/Types/Telemetry/LlmConventions";
import { LlmTokenUsageMetricNames } from "Common/Types/Telemetry/LlmMetricConventions";
import ComponentMetadata, {
  Argument,
  Port,
} from "Common/Types/Workflow/Component";
import ApiComponents from "Common/Types/Workflow/Components/API";
import BaseModelComponent from "Common/Types/Workflow/Components/BaseModel";
import ConditionComponents, {
  ConditionOperator,
} from "Common/Types/Workflow/Components/Condition";
import EmailComponents from "Common/Types/Workflow/Components/Email";
import SlackComponents from "Common/Types/Workflow/Components/Slack";
import {
  componentReturnValueReference,
  globalVariableReference,
} from "Common/Types/Workflow/TemplateSyntax";
import { WORKFLOW_ENABLED_SWITCH_LABEL } from "Common/Types/Workflow/WorkflowEnabled";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 24b: what the Gemini CLI & GitHub Copilot, AI Gateways
 * and AI Agent Circuit Breakers pages say about OneUptime, held to the code
 * that does it - the identity, conversation, cost and metric keys ingest
 * reads, how an ingestion key is refused, the budget metrics and their
 * cadence, the monitor forms the trip wires are built in, and the workflow
 * steps, settings, dots and references the circuit breaker is wired from.
 * The translations are held to these English pages by
 * AiToolingAndSecurityDocsTranslations.
 *
 * What Gemini CLI, Copilot, LiteLLM and Portkey themselves do (their
 * settings, variables and span names) is the vendors' and is not in this
 * repository; it was checked against their documentation and sources when
 * the pages were written. Where their telemetry meets OneUptime's code - a
 * key OneUptime reads, or one it deliberately does not - it is held here.
 *
 * App tests read no React module, so the Dashboard's words are read from its
 * source files as text; Common's types are imported. The server modules that
 * reach a database (the budget evaluator, the ingest middleware) are read as
 * text too.
 */

const REPO_DIR: string = path.resolve(__dirname, "../../../../..");
const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

const SOURCES: Record<string, string> = {
  settingsSideMenu: `${DASHBOARD}/Pages/Settings/SideMenu.tsx`,
  ingestionKeys: `${DASHBOARD}/Pages/Settings/TelemetryIngestionKeys.tsx`,
  llmNavTabs: `${DASHBOARD}/Components/AI/LlmNavTabs.tsx`,
  usageBreakdown: `${DASHBOARD}/Components/AI/LlmUsageBreakdown.tsx`,
  tracesNavTabs: `${DASHBOARD}/Components/Traces/TracesNavTabs.tsx`,
  tracesSettingsMenu: `${DASHBOARD}/Pages/Traces/Settings/SideMenu.tsx`,
  llmSpanPanel: `${DASHBOARD}/Components/Traces/LlmSpanPanel.tsx`,
  budgets: `${DASHBOARD}/Pages/Llm/Budgets.tsx`,
  metricMonitorForm: `${DASHBOARD}/Components/Form/Monitor/MetricMonitor/MetricMonitorStepForm.tsx`,
  traceMonitorForm: `${DASHBOARD}/Components/Form/Monitor/TraceMonitor/TraceMonitorStepForm.tsx`,
  criteriaAlertForm: `${DASHBOARD}/Components/Form/Monitor/MonitorCriteriaAlertForm.tsx`,
  monitorTypeField: `${DASHBOARD}/Utils/Form/Monitor/MonitorTypeFormField.ts`,
  spanUtil: `${DASHBOARD}/Utils/SpanUtil.ts`,
  navigationItems: `${DASHBOARD}/Utils/NavigationItems.tsx`,
  workflowSideMenu: `${DASHBOARD}/Pages/Workflow/SideMenu.tsx`,
  workflowViewSideMenu: `${DASHBOARD}/Pages/Workflow/View/SideMenu.tsx`,
  workflowBuilder: `${DASHBOARD}/Pages/Workflow/View/Builder.tsx`,
  createWorkflowModal: `${DASHBOARD}/Components/Workflow/CreateWorkflowModal.tsx`,
  templatePicker: `${DASHBOARD}/Components/Workflow/WorkflowTemplatePicker.tsx`,
  variableUtil: `${DASHBOARD}/Utils/Workflow/WorkflowVariableUtil.ts`,
  variableView: `${DASHBOARD}/Components/Workflow/WorkflowVariableView.tsx`,
  workflowCanvas: "packages/Common/UI/Components/Workflow/Workflow.tsx",
  componentsModal: "packages/Common/UI/Components/Workflow/ComponentsModal.tsx",
  modelTable: "packages/Common/UI/Components/ModelTable/BaseModelTable.tsx",
  stepTrace: "packages/Common/Types/Workflow/StepTrace.ts",
  workflowModel: "packages/Common/Models/DatabaseModels/Workflow.ts",
  spanModel: "packages/Common/Models/AnalyticsModels/Span.ts",
  ingestMiddleware: "packages/Common/Server/Middleware/TelemetryIngest.ts",
  llmSpan: "packages/Common/Server/Utils/Telemetry/LlmSpan.ts",
  budgetEvaluator:
    "packages/Common/Server/Utils/Telemetry/LlmCostBudgetEvaluator.ts",
  budgetJob:
    "packages/App/FeatureSet/Workers/Jobs/Llm/EvaluateLlmCostBudgets.ts",
};

const INLINE_CODE: RegExp = /`([^`]+)`/g;
const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;
const LINE_BREAK: RegExp = /\n/;
const WHITESPACE: RegExp = /\s+/g;
// An exported string constant: `export const NAME: string =\n  "value";`.
const STRING_CONSTANT: RegExp =
  /export const ([A-Z_]+): string =\s*"([^"]+)";/g;
// A dropdown option of a monitor form: `label: "Last 5 minutes",`.
const OPTION_LABEL: RegExp = /label: "([^"]+)",/g;
// A Dashboard field or menu title: `title: "Time Range",` or `title="..."`.
const TITLE: RegExp = /title(?:: |=)"([^"]+)"/g;
// A JSON value of the page's request templates that references a step.
const TEMPLATE_REFERENCE: RegExp = /\{\{[^}]+\}\}/g;

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

// Source text with every run of whitespace made one space.
function flat(text: string): string {
  return text.replace(WHITESPACE, " ");
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

// The rows of a section's table (the first unless told), without the header.
function rowsOf(
  markdown: string,
  heading: string,
  which: number = 0,
): Array<Array<string>> {
  const found: Array<Array<Array<string>>> = tables(section(markdown, heading));

  expect(found.length).toBeGreaterThan(which);

  return (found[which] as Array<Array<string>>).slice(1);
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

function componentTitled(
  components: Array<ComponentMetadata>,
  title: string,
): ComponentMetadata {
  const found: ComponentMetadata | undefined = components.find(
    (component: ComponentMetadata): boolean => {
      return component.title === title;
    },
  );

  expect({ title, found: found !== undefined }).toEqual({
    title,
    found: true,
  });

  return found as ComponentMetadata;
}

function argumentNames(component: ComponentMetadata): Array<string> {
  return component.arguments.map((argument: Argument): string => {
    return argument.name;
  });
}

function portTitles(ports: Array<Port>): Array<string> {
  return ports.map((port: Port): string => {
    return port.title;
  });
}

// The value of an exported string constant of a source read as text.
function stringConstant(text: string, name: string): string {
  const found: Map<string, string> = new Map(
    Array.from(text.matchAll(STRING_CONSTANT)).map(
      (match: RegExpMatchArray): [string, string] => {
        return [match[1] as string, match[2] as string];
      },
    ),
  );

  expect({ name, found: found.has(name) }).toEqual({ name, found: true });

  return found.get(name) as string;
}

// The JSON of a fenced code block whose info string carries this title.
function codeBlockTitled(markdown: string, title: string): string {
  const fence: { code: string } | undefined = scanMarkdown(
    markdown,
  ).fences.find((candidate: { info: string }): boolean => {
    return candidate.info.includes(`title="${title}"`);
  });

  expect({ title, found: fence !== undefined }).toEqual({
    title,
    found: true,
  });

  return (fence as { code: string }).code;
}

describe("the Gemini CLI & GitHub Copilot page", () => {
  const page: string = englishPage(GEMINI_COPILOT);

  it("names the person by user.email, the first key ingest reads as an employee's email", () => {
    expect(LlmUserEmailBaseAttributeKeys[0]).toBe("user.email");
    expect(page).toContain(
      "OneUptime reads `user.email` as the employee, so each person's spend shows with no mapping and no setup per machine.",
    );
  });

  it("lists the identity keys as ingest reads them: the employee's id, email and team", () => {
    const rows: Array<Array<string>> = rowsOf(page, "Name each developer");
    const teamKeys: Array<string> = codeSpans(
      rows[rows.length - 1]?.[0] as string,
    );

    expect(rowNamed(rows, "`enduser.id`")[1]).toBe("The employee's id");
    expect(LlmUserIdBaseAttributeKeys).toContain("enduser.id");
    expect(rowNamed(rows, "`user.email`")[1]).toContain("The employee's email");
    expect(LlmUserEmailBaseAttributeKeys).toContain("user.email");
    expect(teamKeys).toEqual(["team.id", "team", "cost_center", "department"]);
    expect(LlmTeamBaseAttributeKeys.slice(0, teamKeys.length)).toEqual(
      teamKeys,
    );
  });

  it("says every identity and team key is read with or without the resource. prefix", () => {
    expect(RESOURCE_ATTRIBUTE_KEY_PREFIX).toBe("resource.");

    for (const [base, all] of [
      [LlmUserIdBaseAttributeKeys, LlmUserIdAttributeKeys],
      [LlmUserEmailBaseAttributeKeys, LlmUserEmailAttributeKeys],
      [LlmTeamBaseAttributeKeys, LlmTeamAttributeKeys],
    ] as Array<[Array<string>, Array<string>]>) {
      for (const key of base) {
        expect(all).toContain(key);
        expect(all).toContain(`resource.${key}`);
      }
    }

    expect(page).toContain(
      "they arrive as `resource.enduser.id`, `resource.user.email` and so on: OneUptime reads every identity and team key with or without the `resource.` prefix.",
    );
  });

  it("never reads Copilot's user.name, its pseudonymous id or a customer key as the employee", () => {
    for (const key of [
      "user.name",
      "enduser.pseudo.id",
      "gen_ai.user",
      "llm.user",
    ]) {
      expect(LlmUserIdAttributeKeys).not.toContain(key);
      expect(LlmUserEmailAttributeKeys).not.toContain(key);
    }

    // The two customer keys are the ones ingest keeps apart, as the end user.
    expect(LlmEndUserBaseAttributeKeys).toEqual(
      expect.arrayContaining(["gen_ai.user", "llm.user"]),
    );
    expect(page).toContain(
      "Its `captureIdentity` setting adds `user.name`, and Copilot CLI may add `enduser.pseudo.id`, but OneUptime reads neither as the employee.",
    );
    expect(page).toContain(
      "Don't use `gen_ai.user` or `llm.user`. In an app that serves customers they name the customer, so OneUptime never reads them as the employee.",
    );
  });

  it("groups a Gemini CLI session as one conversation by session.id, and a Copilot turn by gen_ai.conversation.id", () => {
    expect(LlmConversationIdAttributeKeys.slice(0, 2)).toEqual([
      "gen_ai.conversation.id",
      "session.id",
    ]);
    expect(page).toContain(
      "OneUptime reads `session.id` as a conversation id, so a whole Gemini CLI session shows as one conversation under **Conversations**",
    );
    expect(page).toContain(
      "`gen_ai.usage.output_tokens` and `gen_ai.conversation.id`, so a whole agent turn shows as one conversation.",
    );
  });

  it("counts the GenAI token metric, and never Gemini CLI's own copy of it", () => {
    const rows: Array<Array<string>> = rowsOf(page, "What Gemini CLI sends");

    expect(LlmTokenUsageMetricNames).toContain("gen_ai.client.token.usage");
    expect(LlmTokenUsageMetricNames).not.toContain("gemini_cli.token.usage");
    expect(rowNamed(rows, "`gen_ai.client.token.usage`")[1]).toBe(
      "Input and output tokens: the series OneUptime counts",
    );
    expect(rowNamed(rows, "`gemini_cli.token.usage`")[1]).toContain(
      "not counted, so tokens are never counted twice",
    );
  });

  it("refuses a key as the ingest middleware does: 401 when it can't authenticate, 422 when it may not", () => {
    const middleware: string = flat(source("ingestMiddleware"));

    expect(ExceptionCode.NotAuthenticatedException).toBe(401);
    expect(ExceptionCode.NotAuthorizedException).toBe(422);
    expect(middleware).toContain(
      "Missing ingestion token. Send your OneUptime telemetry ingestion key in the x-oneuptime-token header.",
    );
    expect(middleware).toContain(
      "if (policy.isEnabled === false) { return Response.sendErrorResponse( req, res, new NotAuthorizedException(",
    );
    expect(middleware).toContain(
      "if (policy.expiresAt && policy.expiresAt.getTime() <= Date.now()) { return Response.sendErrorResponse( req, res, new NotAuthenticatedException(",
    );
    expect(middleware).toContain(
      "`A browser ingestion key cannot be used for ${readableSurfaceName}. Use a server ingestion key.`",
    );
    expect(page).toContain(
      "OneUptime answers `401` for a missing, unknown or expired key, and `422` for a disabled key or a browser key. Use a server key, sent in `x-oneuptime-token`.",
    );
  });

  it("sends readers to Dashboard places that exist: the ingestion keys, the AI / LLM tabs, the trace settings", () => {
    const settings: string = source("settingsSideMenu");
    const telemetry: string = settings.slice(
      settings.indexOf('title: "Telemetry & APM",'),
    );

    expect(telemetry.slice(0, 400)).toContain('title: "Ingestion Keys",');
    expect(source("ingestionKeys")).toContain('singularName="Ingestion Key"');
    expect(page).toContain(
      "**Project Settings → Telemetry & APM → Ingestion Keys** and click **Create Ingestion Key**",
    );

    for (const tab of ["Conversations", "Calls", "Usage", "Pricing"]) {
      expect(source("llmNavTabs")).toContain(`label: "${tab}",`);
      expect(boldSpans(page)).toContain(tab);
    }

    expect(page).toContain("Open **Products → AI / LLM → Calls**");
    expect(source("tracesNavTabs")).toContain('label: "Settings",');
    expect(source("tracesSettingsMenu")).toContain('title: "Scrub Rules"');
    expect(page).toContain("scrub rules under **Traces → Settings**");
  });

  it("names the Usage tab's Unattributed row, where Copilot's spend lands without an identity", () => {
    expect(source("usageBreakdown")).toContain(
      'const UNATTRIBUTED_LABEL: string = translationKey("Unattributed");',
    );
    expect(page).toContain(
      "Without an identity, all of Copilot's spend lands in one **Unattributed** row on the **Usage** tab.",
    );
  });
});

describe("the AI Gateways page", () => {
  const page: string = englishPage(AI_GATEWAYS);

  it("reads LiteLLM's key-owner attributes as the employee and the team, and its end user never", () => {
    const rows: Array<Array<string>> = rowsOf(
      page,
      "One virtual key per employee",
    );

    expect(rowNamed(rows, "`metadata.user_api_key_user_id`")[1]).toBe(
      "The employee's id",
    );
    expect(LlmUserIdBaseAttributeKeys).toContain(
      "metadata.user_api_key_user_id",
    );
    expect(rowNamed(rows, "`metadata.user_api_key_user_email`")[1]).toBe(
      "The employee's email",
    );
    expect(LlmUserEmailBaseAttributeKeys).toContain(
      "metadata.user_api_key_user_email",
    );
    expect(rowNamed(rows, "`metadata.user_api_key_team_id`")[1]).toBe(
      "The team",
    );
    expect(LlmTeamBaseAttributeKeys).toContain("metadata.user_api_key_team_id");
    expect(rowNamed(rows, "`metadata.user_api_key_end_user_id`")[1]).toContain(
      "Never the employee",
    );
    expect(LlmEndUserBaseAttributeKeys).toContain(
      "metadata.user_api_key_end_user_id",
    );
    expect(LlmUserIdAttributeKeys).not.toContain(
      "metadata.user_api_key_end_user_id",
    );
    expect(LlmUserEmailAttributeKeys).not.toContain(
      "metadata.user_api_key_end_user_id",
    );
  });

  it("reads the same keys under LiteLLM's OpenTelemetry v2 prefix", () => {
    for (const [keys, key] of [
      [LlmUserIdBaseAttributeKeys, "metadata.user_api_key_user_id"],
      [LlmUserEmailBaseAttributeKeys, "metadata.user_api_key_user_email"],
      [LlmTeamBaseAttributeKeys, "metadata.user_api_key_team_id"],
    ] as Array<[Array<string>, string]>) {
      expect(keys).toContain(`litellm.${key}`);
    }

    expect(page).toContain(
      "the same values arrive with a `litellm.` prefix (`litellm.metadata.user_api_key_user_email` and so on), which OneUptime reads too.",
    );
  });

  it("reads the price LiteLLM reports, in either mode, and prefers it to an estimate", () => {
    const llmSpan: string = flat(source("llmSpan"));

    expect(LlmCostAttributeKeys).toEqual(
      expect.arrayContaining(["gen_ai.cost.total_cost", "litellm.cost.total"]),
    );
    expect(llmSpan).toContain(
      "Cost fallback: the SDK-reported cost always wins",
    );
    expect(llmSpan).toContain("if (fields.isLlmSpan && reportedCost === null)");
    expect(page).toContain(
      "reports the price as `gen_ai.cost.total_cost`. OneUptime takes a reported cost over its own estimate",
    );
    expect(page).toContain(
      "Its cost arrives as `litellm.cost.total`, which OneUptime reads as well.",
    );
  });

  it("counts a span as a model call by its gen_ai.* attributes, and shows it on the span's LLM tab", () => {
    expect(LlmAttributeNamespacePrefixes).toContain("gen_ai.");
    expect(source("llmSpanPanel").length).toBeGreaterThan(0);
    expect(page).toContain(
      "A span counts as a model call only when it carries `gen_ai.*` attributes",
    );
    expect(page).toContain("open the span's **LLM** tab");
  });

  it("sends readers to the ingestion keys, the AI / LLM calls and the trace settings", () => {
    expect(source("settingsSideMenu")).toContain('title: "Ingestion Keys",');
    expect(source("llmNavTabs")).toContain('label: "Calls",');
    expect(source("llmNavTabs")).toContain('label: "Usage",');
    expect(source("tracesNavTabs")).toContain('label: "Settings",');
    expect(source("navigationItems")).toContain('t("navbar.items.tracesTitle"');
    expect(page).toContain(
      "**Project Settings → Telemetry & APM → Ingestion Keys**",
    );
    expect(page).toContain("Open **Products → AI / LLM → Calls**.");
    expect(page).toContain(
      "use scrub rules under **Traces → Settings** instead.",
    );
    expect(page).toContain("Filter **Traces** by the gateway's service");
  });

  it("refuses a key as the Gemini CLI page and the ingest middleware say", () => {
    expect(page).toContain(
      "OneUptime answers `401` for a missing, unknown or expired key, and `422` for a disabled key or a browser key.",
    );
  });
});

describe("the AI Agent Circuit Breakers page", () => {
  const page: string = englishPage(CIRCUIT_BREAKER);
  const evaluator: string = source("budgetEvaluator");

  it("names the two budget metrics and their id attribute as the evaluator publishes them", () => {
    expect(stringConstant(evaluator, "LLM_BUDGET_SPEND_METRIC_NAME")).toBe(
      "oneuptime.llm.budget.spend.usd",
    );
    expect(stringConstant(evaluator, "LLM_BUDGET_PERCENT_METRIC_NAME")).toBe(
      "oneuptime.llm.budget.percent.used",
    );
    expect(stringConstant(evaluator, "LLM_BUDGET_ID_ATTRIBUTE")).toBe(
      "oneuptime.llm.budget.id",
    );
    expect(page).toContain(
      "publishes it as two metrics, `oneuptime.llm.budget.spend.usd` and `oneuptime.llm.budget.percent.used`, each with the budget's ID in `oneuptime.llm.budget.id`.",
    );
  });

  it("says a budget adds up the UTC day every 15 minutes", () => {
    const job: string = source("budgetJob");

    expect(job).toContain(
      'import { EVERY_FIFTEEN_MINUTE } from "Common/Utils/CronTime";',
    );
    expect(job).toContain("schedule: EVERY_FIFTEEN_MINUTE,");
    expect(flat(evaluator)).toContain(
      "Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())",
    );
    expect(page).toContain(
      "A budget adds up the day's AI spend every 15 minutes",
    );
    expect(page).toContain(
      "A budget counts the UTC day, so its percentage starts again from 0 at midnight UTC.",
    );
  });

  it("creates the budget with the Budgets form's fields and button, and finds its ID with Show ID", () => {
    const budgets: string = source("budgets");

    expect(new LlmCostBudget().singularName).toBe("LLM Cost Budget");
    expect(budgets).toContain('title: "Daily Budget (USD)",');
    expect(budgets).toContain('title: "Service (optional)",');
    expect(budgets).toContain("showViewIdButton={true}");
    expect(source("modelTable")).toContain('title: tx("Show ID"),');
    expect(page).toContain(
      "**Products → AI / LLM → Budgets** and click **Create LLM Cost Budget**. Set a **Daily Budget (USD)**, and pick the agent's service in **Service (optional)**",
    );
    expect(page).toContain("pick **Show ID** and copy the ID.");
  });

  it("sets the Metrics monitor's Time Range to Past 30 Minutes, the window the evaluator asks for", () => {
    expect(source("metricMonitorForm")).toContain('title="Time Range"');
    expect(RollingTime.Past30Minutes).toBe("Past 30 Minutes");
    expect(flat(evaluator)).toContain("using a rolling window of 30 minutes");
    expect(page).toContain("set its **Time Range** to **Past 30 Minutes**.");
    expect(page).toContain(
      "Keep the time range at 30 minutes: a budget publishes one point every 15 minutes",
    );
  });

  it("builds the alerts from the criteria the monitors offer, titled in the criteria's Alert Title", () => {
    expect(FilterType.GreaterThanOrEqualTo).toBe("Greater Than Or Equal To");
    expect(FilterType.GreaterThan).toBe("Greater Than");
    expect(CheckOn.SpanCount).toBe("Span Count");
    expect(source("criteriaAlertForm")).toContain('title="Alert Title"');
    expect(source("criteriaAlertForm")).toContain('title="Auto Resolve Alert"');
    expect(page).toContain(
      "Add a criteria **Greater Than Or Equal To** `100` that creates an alert, and give it an **Alert Title**",
    );
    expect(page).toContain("Add a criteria **Span Count** **Greater Than**");
    expect(page).toContain(
      "With **Auto Resolve Alert** on, the alert resolves",
    );
  });

  it("picks the Traces monitor under More monitor types, as the type picker draws it", () => {
    expect(MonitorType.Traces).toBe("Traces");
    expect(MonitorTypeHelper.getCommonMonitorTypes()).not.toContain(
      MonitorType.Traces,
    );
    expect(source("monitorTypeField")).toContain(
      'translationKey("More monitor types")',
    );
    expect(page).toContain(
      "Open **Monitors**, click **Create Monitor**, and pick **Traces** under **More monitor types**.",
    );
  });

  it("sets the loop alert's filters with the Traces monitor's own fields and options", () => {
    const form: string = source("traceMonitorForm");
    const titles: Array<string> = allMatches(form, TITLE, 1);
    const options: Array<string> = allMatches(form, OPTION_LABEL, 1);

    for (const field of [
      "Span Name",
      "Monitor Traces for (time)",
      "Filter by Span Status",
      "Filter by Telemetry Service",
      "Filter by Attributes",
    ]) {
      expect(titles).toContain(field);
      expect(boldSpans(page)).toContain(field);
    }

    // The window the page picks is one the form offers; 2 minutes is not.
    expect(options).toContain("Last 5 minutes");
    expect(options).not.toContain("Last 2 minutes");
    expect(page).toContain(
      "Set **Monitor Traces for (time)** to **Last 5 minutes**.",
    );
  });

  it("filters the retry-storm monitor on the span status Error, a status the form lists", () => {
    expect(source("spanUtil")).toContain(
      "DropdownUtil.getDropdownOptionsFromEnum(SpanStatus, true)",
    );
    expect(flat(source("spanModel"))).toMatch(
      /export enum SpanStatus \{[^}]*Error = /,
    );
    expect(page).toContain(
      "A second Traces monitor with **Filter by Span Status** set to **Error**",
    );
  });

  it("starts the workflow from the trigger the Alert model offers: On Create Alert, with Select Fields and a Success dot", () => {
    const trigger: ComponentMetadata = componentTitled(
      BaseModelComponent.getComponents(new Alert()),
      "On Create Alert",
    );

    expect(trigger.id).toBe("alert-on-create");
    expect(argumentNames(trigger)).toEqual(["Select Fields"]);
    expect(portTitles(trigger.outPorts)).toEqual(["Success"]);
    expect(
      trigger.returnValues.map((value: { id: string }): string => {
        return value.id;
      }),
    ).toEqual(["model"]);
    expect(page).toContain(
      "pick **On Create Alert** in the **Add Trigger** panel. Click the trigger, tick the title and the description in **Select Fields**",
    );
  });

  it("names the trigger's block alert-on-create-1, the first block of its kind on the canvas", () => {
    const canvas: string = source("workflowCanvas");

    expect(canvas).toContain("let idCounter: number = 1;");
    expect(canvas).toContain("id: `${metaDataId}-${idCounter}`,");
    expect(page).toContain(
      "The ID on the block, `alert-on-create-1`, is how later blocks refer to it.",
    );
  });

  it("checks the title with If / Else's own settings and dots", () => {
    const ifElse: ComponentMetadata = componentTitled(
      ConditionComponents,
      "If / Else",
    );

    expect(argumentNames(ifElse).slice(0, 3)).toEqual([
      "Value to check",
      "Comparison",
      "Compare with",
    ]);
    expect(portTitles(ifElse.outPorts)).toEqual(["Yes", "No"]);
    expect(ConditionOperator.Contains).toBe("contains");
    expect(page).toContain(
      "Set **Value to check** to the alert's title (click **{ }** and pick it), **Comparison** to **contains**, and **Compare with**",
    );
    expect(page).toContain(
      "connect the **Yes** dot of the **If / Else** to it.",
    );
    expect(page).toContain(
      "chain more **If / Else** blocks from the **No** dot.",
    );
  });

  it("calls the endpoint with API Post (JSON)'s settings, and its Success and Error dots", () => {
    const post: ComponentMetadata = componentTitled(
      ApiComponents,
      "API Post (JSON)",
    );

    expect(argumentNames(post)).toEqual([
      "URL",
      "Request Body",
      "Request Headers",
    ]);
    expect(portTitles(post.outPorts)).toEqual(["Success", "Error"]);
    expect(post.outPorts[0]?.description).toContain("(2xx)");
    expect(page).toContain("Set its **URL** to your endpoint");
    expect(page).toContain("The **Request Headers** of the API block:");
    expect(page).toContain("Its **Request Body**:");
    expect(page).toContain("connect the API block's **Error** dot to it.");
    expect(page).toContain("The workflow counts any 2xx answer as success.");
  });

  it("reports a failure with steps the builder has: Send Message to Slack, Send Email", () => {
    componentTitled(SlackComponents, "Send Message to Slack");
    componentTitled(EmailComponents, "Send Email");
    expect(page).toContain("Add **Send Message to Slack**, or **Send Email**");
  });

  it("writes the request's references as the builder writes them", () => {
    const headers: string = codeBlockTitled(page, "Request Headers");
    const body: string = codeBlockTitled(page, "Request Body");

    expect(headers).toContain(
      `"Bearer ${globalVariableReference("AGENT_KILL_TOKEN")}"`,
    );
    expect(allMatches(body, TEMPLATE_REFERENCE, 0)).toEqual(
      ["_id", "title", "description"].map((field: string): string => {
        return componentReturnValueReference("alert-on-create-1", "model", [
          field,
        ]);
      }),
    );
  });

  it("creates the workflow with the Dashboard's words: Start from scratch, Create Workflow, the Builder", () => {
    expect(source("templatePicker")).toContain('{tx("Start from scratch")}');
    expect(source("createWorkflowModal")).toContain(
      'submitButtonText="Create Workflow"',
    );
    expect(source("workflowViewSideMenu")).toContain('title: "Builder",');
    expect(source("workflowCanvas")).toContain(
      'description: "Choose what starts this workflow",',
    );
    expect(source("componentsModal")).toContain(
      'title={isTrigger ? "Add Trigger" : "Add Component"}',
    );
    expect(source("workflowBuilder")).toContain('title="Add Component"');
    expect(page).toContain(
      "Open **Products → Workflows** and click **Create Workflow**. Click **Start from scratch**",
    );
    expect(page).toContain("It opens in the **Builder**, switched off.");
    expect(page).toContain(
      "Click the dashed **Choose what starts this workflow** block",
    );
    expect(page).toContain("Click **Add Component**, pick **If / Else**");
  });

  it("says workflows are created switched off and turned on with Enabled", () => {
    const model: string = flat(source("workflowModel"));

    expect(model).toMatch(
      /title: "Is Enabled", description: "Is this workflow enabled\?", defaultValue: false, \}\) @Column\(\{ type: ColumnType\.Boolean, default: false, \}\) public isEnabled\?: boolean/,
    );
    expect(WORKFLOW_ENABLED_SWITCH_LABEL).toBe("Enabled");
    expect(page).toContain(
      "Switch **Enabled** on at the top of the **Builder**.",
    );
    expect(page).toContain(
      "Check that **Enabled** is on at the top of the **Builder**: workflows are created switched off.",
    );
  });

  it("keeps the token in a secret global variable, as the variable form and the run logs handle one", () => {
    const variables: string = source("variableUtil");

    expect(source("workflowSideMenu")).toContain('title: "Global Variables",');
    expect(variables).toContain('title: "Content",');
    expect(variables).toContain('title: "Secret",');
    expect(flat(variables)).toContain(
      "Keep this variable's content out of workflow run logs - every run replaces it with [REDACTED]",
    );
    expect(source("stepTrace")).toContain(
      'const TRACE_REDACTED_MARKER: string = "[REDACTED]";',
    );
    expect(source("variableView")).toContain('title: "Update Content",');
    expect(page).toContain(
      "open **Workflows → Global Variables**, click **Create Workflow Variable**, name it `AGENT_KILL_TOKEN`, put the token in **Content**, and turn **Secret** on. A secret value is scrubbed out of run logs and step traces.",
    );
    expect(page).toContain("type it again with **Update Content**");
  });

  it("finds a run under Workflows → Logs → Runs", () => {
    const menu: string = source("workflowSideMenu");
    const logs: string = menu.slice(menu.indexOf('title: "Logs",'));

    expect(logs.slice(0, 400)).toContain('title: "Runs",');
    expect(page).toContain("The run appears under **Workflows → Logs → Runs**");
    expect(page).toContain(
      "Open the run under **Workflows → Logs → Runs** and the **API Post (JSON)** step",
    );
  });

  it("opens alerts by hand with the Alerts product's own Create Alert", () => {
    expect(new Alert().singularName).toBe("Alert");
    expect(source("navigationItems")).toContain('t("navbar.items.alertsTitle"');
    expect(page).toContain("Open **Alerts**, click **Create Alert**");
  });
});
