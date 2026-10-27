import { readPage } from "./DocsContentSupport";
import {
  MenuSection as DashboardMenuSection,
  developerSection,
  menuSections,
  sectionByTitle,
  startsCollapsed,
} from "./DocsDashboardMenus";
import { boldSpans } from "./DocsTranslationChecks";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookRule from "Common/Models/DatabaseModels/RunbookRule";
import RunbookVariable from "Common/Models/DatabaseModels/RunbookVariable";
import Runner from "Common/Models/DatabaseModels/Runner";
import { getIpv6NetworkRateLimit } from "Common/Server/Utils/ClientIp";
import DataSourceEgressGuard from "Common/Server/Utils/DataSource/EgressGuard";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import OneUptimeDate from "Common/Types/Date";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import RunbookRuleTriggerEntity from "Common/Types/Runbook/RunbookRuleTriggerEntity";
import { getRunbookRuleCriteriaProblem } from "Common/Types/Runbook/RunbookRuleCriteria";
import {
  RUNBOOK_ADVANCE_PERMISSIONS,
  RUNBOOK_RUN_GRANULAR_PERMISSIONS,
  RUNBOOK_RUN_PERMISSIONS,
  RUNBOOK_RUN_REFUSED_MESSAGE,
  RUNBOOK_RUN_ROLE_PERMISSIONS,
} from "Common/Types/Runbook/RunbookRunPermissions";
import {
  MIN_REDACTED_SECRET_LENGTH,
  REDACTED_SECRET_TEXT,
} from "Common/Types/Runbook/SecretOutputRedaction";
import {
  fillHttpStepJsonText,
  getHttpStepVariableTexts,
  redactHttpStepSecrets,
} from "Common/Types/Runbook/HttpStepVariables";
import {
  RUNBOOK_VARIABLE_NAME_MAX_LENGTH,
  RunbookVariableScope,
  formatRunbookVariableReference,
  isValidRunbookVariableName,
} from "Common/Types/Runbook/RunbookVariableReference";
import RunbookStepExecutionStatus from "Common/Types/Runbook/RunbookStepExecutionStatus";
import {
  RunbookStepWait,
  canStepTypeRequireApproval,
} from "Common/Types/Runbook/RunbookStepApproval";
import { RunbookStep } from "Common/Types/Runbook/RunbookStep";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import {
  CONTINUE_ON_FAILURE_TITLE,
  HTTP_HEADERS_TITLE,
  HTTP_METHODS_WITH_BODY,
  MANUAL_INSTRUCTIONS_TITLE,
  NEEDS_APPROVAL_LABEL,
  REQUIRE_APPROVAL_FOLDED_TITLE,
  REQUIRE_APPROVAL_TITLE,
  RUNNER_FIELD_TITLE,
  getStepMoreFieldsItems,
} from "../../../FeatureSet/Dashboard/src/Components/Runbook/Steps/RunbookStepEditorModel";
import {
  APPROVED_BY_LABEL,
  WAITING_FOR_APPROVAL_LABEL,
  WAITING_FOR_YOU_LABEL,
  getWaitingStepButtonTitle,
  getWaitingStepStatusLabel,
} from "../../../FeatureSet/Dashboard/src/Components/Runbook/RunbookExecutionWaitCopy";
import {
  DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
  DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
  MAX_AGENT_CLAIM_TIMEOUT_IN_MS,
  MAX_STEP_EXECUTION_TIMEOUT_IN_MS,
  MIN_AGENT_CLAIM_TIMEOUT_IN_MS,
  MIN_STEP_EXECUTION_TIMEOUT_IN_MS,
  resolveAgentClaimTimeoutInMs,
  resolveStepExecutionTimeoutInMs,
} from "Common/Types/Runbook/RunbookStepTimeout";
import RunbookStepType, {
  RUNNER_EXECUTED_STEP_TYPES,
} from "Common/Types/Runbook/RunbookStepType";
import RunnerJobStatus from "Common/Types/Runbook/RunnerJobStatus";
import {
  RunnerChoiceRefusal,
  describeRunnerChoiceRefusal,
} from "Common/Types/Runner/RunnerChoice";
import {
  DEFAULT_RUNBOOK_SCHEDULE_MISSED_RUN_POLICY,
  DEFAULT_RUNBOOK_SCHEDULE_OVERLAP_POLICY,
  RUNBOOK_SCHEDULE_HOUR_INTERVALS,
  RUNBOOK_SCHEDULE_MINUTE_INTERVALS,
  RUNBOOK_SCHEDULE_MISSED_RUN_GRACE_IN_MS,
  RunbookScheduleMissedRunPolicy,
  RunbookScheduleOverlapPolicy,
  getNextRunbookRuns,
} from "Common/Types/Runbook/RunbookSchedule";
import {
  RUNBOOK_WEBHOOK_CALLS_PER_ADDRESS_PER_MINUTE,
  RUNBOOK_WEBHOOK_MAX_ACTIVE_RUNS,
  RUNBOOK_WEBHOOK_MAX_BODY_BYTES,
  RUNBOOK_WEBHOOK_RUNS_PER_MINUTE,
  RUNBOOK_WEBHOOK_SECRET_KEY_LENGTH,
  RunbookWebhookMessages,
} from "Common/Types/Runbook/RunbookWebhook";
import {
  RUNBOOK_INPUTS_MAX_BYTES,
  RUNBOOK_INPUTS_MAX_DEPTH,
  RUNBOOK_INPUTS_VARIABLE,
  RUNBOOK_INPUT_MAX_NAME_LENGTH,
  RUNBOOK_INPUT_MAX_VARIABLES,
  RUNBOOK_INPUT_VARIABLE_PREFIX,
  RUNBOOK_TRIGGER_VARIABLE,
  getRunbookInputVariableName,
  getRunbookInputVariables,
} from "Common/Types/Runbook/RunbookInputs";
import {
  RUNBOOK_TRIGGER_COLUMNS,
  RUNBOOK_TRIGGER_REFUSED_MESSAGE,
} from "Common/Server/Utils/Runbook/RunbookTriggerAccess";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import RunnerLiveStatus, {
  getRunnerLiveStatus,
  getRunnerLiveStatusLabel,
  RUNNER_ALIVE_WINDOW_IN_MINUTES,
} from "Common/Types/Runner/RunnerLiveStatus";
import { RuleCriteriaOperator } from "Common/Types/Rules/RuleCriteria";
import { RuleCriteriaSubject } from "Common/Types/Rules/RuleCriteriaSubject";
import {
  getDefaultRuleCriteriaOperator,
  getRuleCriteriaOperatorsForField,
  RULE_CRITERIA_OPERATOR_LABELS,
  RuleCriteriaCopy,
} from "Common/UI/Components/RuleCriteria/RuleCriteriaFields";
import {
  getRuleCriteriaSubjectCopy,
  RuleCriteriaSubjectCopy,
} from "Common/UI/Components/RuleCriteria/RuleCriteriaSubjectCopy";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import RulePatternMatchUtil from "Common/Utils/Rules/RulePatternMatchUtil";
import { afterEach, describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the English runbook pages say about the product, held to the code that
 * makes it true. Markdown is not compiled, so nothing else notices when a
 * default moves, a label is renamed, a permission list changes or a message is
 * reworded. Each test reads the source of truth - the shared constant, the
 * model's access lists, the Worker and the Runner, the dashboard page (read as
 * text: an App test does not import the Dashboard's React components) - and
 * checks the page still says what it does.
 *
 * The translations are held to these English pages by RunbookDocsTranslations;
 * a few facts have suites of their own (RunbookStepActionsDocs,
 * RunbookStepReorderDocs, RunbookRuleConditionsDocs, RunbookAndBillingRolesDocs,
 * AgentVersionSignDocs, AiAccessRemovalDocs, RunnersUnderRunbooksDocs,
 * AiLeavesOutEmbeddedImagesDocs).
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

function readDashboard(relativePath: string): string {
  return readSource(`App/FeatureSet/Dashboard/src/${relativePath}`);
}

const INDEX: string = readPage("en", "runbooks/index");
const AUTHORING: string = readPage("en", "runbooks/authoring");
const RUNNING: string = readPage("en", "runbooks/running");
const RULES: string = readPage("en", "runbooks/rules");
const AGENTS: string = readPage("en", "runbooks/agents");
const VARIABLES: string = readPage("en", "runbooks/variables");
const CONFIGURATION: string = readPage("en", "runbooks/configuration");
const TRIGGERS: string = readPage("en", "runbooks/triggers");

const PAGES: Record<string, string> = {
  index: INDEX,
  authoring: AUTHORING,
  running: RUNNING,
  rules: RULES,
  agents: AGENTS,
  variables: VARIABLES,
  configuration: CONFIGURATION,
  triggers: TRIGGERS,
};

const STEP_EXECUTORS: string = readSource(
  "App/FeatureSet/Runbook/Services/StepExecutors.ts",
);
const RUN_RUNBOOK: string = readSource(
  "App/FeatureSet/Runbook/Services/RunRunbook.ts",
);
const AI_STEP_EXECUTOR: string = readSource(
  "App/FeatureSet/Runbook/Services/AIStepExecutor.ts",
);
const RUNBOOK_API: string = readSource("App/FeatureSet/Runbook/API/Runbook.ts");
const RUNNER_INGRESS: string = readSource(
  "App/FeatureSet/Runbook/API/RunnerIngress.ts",
);
const RUNBOOK_FEATURE_INDEX: string = readSource(
  "App/FeatureSet/Runbook/Index.ts",
);
const RUNNER_AUTHORIZATION: string = readSource(
  "App/FeatureSet/Runbook/Middleware/RunnerAuthorization.ts",
);
// What a claimed SSH step is handed: its host, port and sign-in.
const RUNBOOK_JOB_VARIABLES: string = readSource(
  "App/FeatureSet/Runbook/Utils/JobVariables.ts",
);
const RUNNER_JOB_SERVICE: string = readSource(
  "Common/Server/Services/RunnerJobService.ts",
);
const VM_RUNNER: string = readSource("Common/Server/Utils/VM/VMRunner.ts");
const RUNNER_CONFIG: string = readSource("Runner/Config.ts");
const RUNNER_INDEX: string = readSource("Runner/Index.ts");
const RUNNER_DOCKERFILE: string = readSource("Runner/Dockerfile.tpl");
const RUNNER_RUNBOOK_EXECUTOR: string = readSource(
  "Runner/Services/RunbookExecutor.ts",
);
const RUNNER_SSH_EXECUTOR: string = readSource(
  "Runner/Services/SSHExecutor.ts",
);
const RUNNER_KUBECTL_SCRIPT_EXECUTOR: string = readSource(
  "Runner/Services/KubectlScriptExecutor.ts",
);

const STEPS_PAGE: string = readDashboard("Pages/Runbook/View/Steps.tsx");
// What a step's editor shows and folds under More fields, and its fields' titles.
const STEP_EDITOR_MODEL: string = readDashboard(
  "Components/Runbook/Steps/RunbookStepEditorModel.ts",
);
// The Runner picker every Runner-run step draws (its Runner field).
const RUNNER_PICKER: string = readDashboard(
  "Components/Runner/RunnerPicker.tsx",
);
// Where a step runs, and the refusals of a step that cannot run anywhere.
const RUNNER_CHOICE: string = readSource("Common/Types/Runner/RunnerChoice.ts");
const EXECUTION_VIEW: string = readDashboard(
  "Pages/Runbook/View/ExecutionView.tsx",
);
const SIDE_MENU: string = readDashboard("Pages/Runbook/SideMenu.tsx");
const RUNNER_FORM_FIELDS: string = readDashboard(
  "Pages/Runbook/Runners/RunnerFormFields.tsx",
);
const RUNNERS_PAGE: string = readDashboard("Pages/Runbook/Runners/Runners.tsx");
const RUNNER_VIEW: string = readDashboard(
  "Pages/Runbook/Runners/RunnerView.tsx",
);
// The Global Variables page and a runbook's own Variables page draw this table.
const VARIABLES_TABLE: string = readDashboard(
  "Components/Runbook/RunbookVariablesTable.tsx",
);
// The variables pages' words: the form's steps and fields.
const VARIABLE_COPY: string = readDashboard(
  "Components/Runbook/RunbookVariableCopy.ts",
);
const RULES_TABLE: string = readDashboard(
  "Components/Runbook/RunbookRulesTable.tsx",
);
// The shared rule form the runbook rules take their steps and fields from.
const EVENT_RULE_FORM: string = readDashboard("Utils/Form/EventRuleForm.ts");

// The text of the "## " section with this heading, up to the next "## ".
function section(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(`\n## ${heading}\n`);

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const rest: string = markdown.slice(start + heading.length + 5);
  const end: number = rest.indexOf("\n## ");

  return end === -1 ? rest : rest.slice(0, end);
}

// The cells of a markdown table row, trimmed, without the empty outer ones.
function cells(row: string): Array<string> {
  return row
    .split("|")
    .slice(1, -1)
    .map((cell: string): string => {
      return cell.trim();
    });
}

// Every body row of every table in a piece of markdown, as cells.
function tableRows(markdown: string): Array<Array<string>> {
  const rows: Array<Array<string>> = [];
  const lines: Array<string> = markdown.split("\n");

  for (let i: number = 0; i < lines.length; i++) {
    const line: string = lines[i] as string;

    if (!line.startsWith("|")) {
      continue;
    }

    const isHeader: boolean = (lines[i + 1] || "").startsWith("| ---");
    const isDivider: boolean = line.startsWith("| ---");

    if (!isHeader && !isDivider) {
      rows.push(cells(line));
    }
  }

  return rows;
}

// The rows of the tables in `markdown` whose first cell is `firstCell`.
function rowsStartingWith(
  markdown: string,
  firstCell: string,
): Array<Array<string>> {
  return tableRows(markdown).filter((row: Array<string>): boolean => {
    return row[0] === firstCell;
  });
}

const DURATION: RegExp = /^(\d+) (second|seconds|minute|minutes|hour|hours)$/;

const UNIT_IN_MS: Record<string, number> = {
  second: 1000,
  seconds: 1000,
  minute: 60 * 1000,
  minutes: 60 * 1000,
  hour: 60 * 60 * 1000,
  hours: 60 * 60 * 1000,
};

// "30 seconds" -> 30000, "2 minutes" -> 120000; null for anything else.
function durationInMs(text: string): number | null {
  const match: RegExpMatchArray | null = text.trim().match(DURATION);

  if (!match) {
    return null;
  }

  return Number(match[1]) * (UNIT_IN_MS[match[2] as string] as number);
}

const DEFAULT_SENTENCE: RegExp = /Default (\d+ (?:seconds?|minutes?))\.$/;

/*
 * What a timeout row says its default is: the cell that is nothing but a
 * duration (the step tables' Default column, the agents table's second), or
 * the "Default <duration>." a row's last cell ends with.
 */
function rowDefaultInMs(row: Array<string>): number | null {
  for (const cell of row.slice(1)) {
    const asCell: number | null = durationInMs(cell);

    if (asCell !== null) {
      return asCell;
    }
  }

  const last: string = row[row.length - 1] as string;
  const sentence: RegExpMatchArray | null = last.match(DEFAULT_SENTENCE);

  return sentence ? durationInMs(sentence[1] as string) : null;
}

// A permission's title, as the permission picker and the docs name it.
function title(permission: Permission): string {
  const props: PermissionProps | undefined =
    PermissionHelper.getAllPermissionProps().find(
      (item: PermissionProps): boolean => {
        return item.permission === permission;
      },
    );

  expect({ permission, known: Boolean(props) }).toEqual({
    permission,
    known: true,
  });

  return (props as PermissionProps).title;
}

function isRole(permission: Permission): boolean {
  const props: PermissionProps | undefined =
    PermissionHelper.getAllPermissionProps().find(
      (item: PermissionProps): boolean => {
        return item.permission === permission;
      },
    );

  return Boolean(props?.isRolePermission);
}

function roles(list: ReadonlyArray<Permission>): Array<Permission> {
  return list.filter(isRole);
}

function granular(list: ReadonlyArray<Permission>): Array<Permission> {
  return list.filter((permission: Permission): boolean => {
    return !isRole(permission);
  });
}

// "A, B and C" / "A, B or C".
function englishList(items: Array<string>, conjunction: string): string {
  if (items.length <= 1) {
    return items.join("");
  }

  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;
}

// The number a constant is declared as in a source file: `NAME: number = 30_000;`.
function declaredNumber(source: string, name: string): number {
  const declaration: RegExp = new RegExp(`\\b${name}: number =\\s*([\\d_]+);`);
  const match: RegExpMatchArray | null = source.match(declaration);

  expect({ name, declared: Boolean(match) }).toEqual({ name, declared: true });

  return Number((match as RegExpMatchArray)[1]!.replace(/_/g, ""));
}

/*
 * How Runner/Config.ts reads a numeric environment variable: its default and
 * its minimum (a value under the minimum falls back to the default).
 */
interface EnvNumber {
  defaultValue: number;
  min: number;
}

function runnerEnvNumber(variable: string): EnvNumber {
  const read: RegExp = new RegExp(
    `value: process\\.env\\["${variable}"\\],\\s*defaultValue: ([\\d_]+),\\s*min: ([\\d_]+),`,
  );
  const match: RegExpMatchArray | null = RUNNER_CONFIG.match(read);

  expect({ variable, read: Boolean(match) }).toEqual({ variable, read: true });

  return {
    defaultValue: Number((match as RegExpMatchArray)[1]!.replace(/_/g, "")),
    min: Number((match as RegExpMatchArray)[2]!.replace(/_/g, "")),
  };
}

// A side menu section of the Runbooks product: its title and its links.
interface MenuSection {
  title: string;
  items: Array<string>;
}

const MENU_TITLE: RegExp = /title: "([^"]+)"/g;

function runbookMenuSections(): Array<MenuSection> {
  const sections: Array<MenuSection> = [];

  for (const match of SIDE_MENU.matchAll(MENU_TITLE)) {
    const before: string = SIDE_MENU.slice(
      Math.max(0, (match.index as number) - 40),
      match.index as number,
    );
    const name: string = match[1] as string;

    if (before.includes("link: {")) {
      sections[sections.length - 1]?.items.push(name);
    } else {
      sections.push({ title: name, items: [] });
    }
  }

  return sections;
}

// The labels a status map in ExecutionView draws, by enum member, in order.
function statusLabels(enumName: string): Array<[string, string]> {
  const entry: RegExp = new RegExp(
    `\\[${enumName}\\.(\\w+)\\]: \\{\\s*label: "([^"]+)"`,
    "g",
  );

  return Array.from(EXECUTION_VIEW.matchAll(entry)).map(
    (match: RegExpMatchArray): [string, string] => {
      return [match[1] as string, match[2] as string];
    },
  );
}

// The form steps a dashboard form declares, in order: `{ title: "X", id: "y" }`.
const FORM_STEP: RegExp = /\{\s*title: "([^"]+)",\s*id: "([^"]+)"/g;

function formSteps(source: string): Array<string> {
  return Array.from(source.matchAll(FORM_STEP)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

describe("the runbook pages' step timeouts", () => {
  const timeoutRows: Array<Array<string>> = [
    ...rowsStartingWith(AUTHORING, "**Execution timeout**"),
    ...rowsStartingWith(AUTHORING, "**Request timeout**"),
    ...rowsStartingWith(AGENTS, "**Execution timeout**"),
  ];
  const claimRows: Array<Array<string>> = [
    ...rowsStartingWith(AUTHORING, "**Claim timeout**"),
    ...rowsStartingWith(AGENTS, "**Claim timeout**"),
  ];

  it("find a default in every timeout row of the step tables", () => {
    // JavaScript, HTTP request, Bash, SSH and kubectl, and the agents table.
    expect(timeoutRows.length).toBe(6);
    expect(claimRows.length).toBe(5);

    for (const row of [...timeoutRows, ...claimRows]) {
      expect({ row: row[0], default: rowDefaultInMs(row) !== null }).toEqual({
        row: row[0],
        default: true,
      });
    }
  });

  it("give the execution and request timeout the default a step runs with", () => {
    expect(DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS).toBe(30 * 1000);
    expect(resolveStepExecutionTimeoutInMs(undefined)).toBe(
      DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
    );

    for (const row of timeoutRows) {
      expect({ row: row[0], defaultInMs: rowDefaultInMs(row) }).toEqual({
        row: row[0],
        defaultInMs: DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
      });
    }

    const limits: string = section(CONFIGURATION, "Output caps and timeouts");

    expect(limits).toContain(
      "| Execution timeout | **30 seconds** by default | JavaScript, Bash, SSH and kubectl steps |",
    );
    expect(limits).toContain(
      "| Request timeout | **30 seconds** by default | HTTP request steps |",
    );
  });

  it("give the claim timeout the default the Worker waits for a Runner", () => {
    expect(DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS).toBe(2 * 60 * 1000);
    expect(resolveAgentClaimTimeoutInMs("")).toBe(
      DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
    );

    for (const row of claimRows) {
      expect({ row: row[0], defaultInMs: rowDefaultInMs(row) }).toEqual({
        row: row[0],
        defaultInMs: DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
      });
    }

    expect(section(CONFIGURATION, "Output caps and timeouts")).toContain(
      "| Claim timeout | **2 minutes** by default:",
    );
    expect(AUTHORING).toContain("**claim timeout** (default 2 minutes)");
  });

  it("say every timeout takes 1 second to 1 hour, and a value outside is clamped", () => {
    for (const bound of [
      MIN_STEP_EXECUTION_TIMEOUT_IN_MS,
      MIN_AGENT_CLAIM_TIMEOUT_IN_MS,
    ]) {
      expect(bound).toBe(durationInMs("1 second"));
    }

    for (const bound of [
      MAX_STEP_EXECUTION_TIMEOUT_IN_MS,
      MAX_AGENT_CLAIM_TIMEOUT_IN_MS,
    ]) {
      expect(bound).toBe(durationInMs("1 hour"));
    }

    // Clamped, not refused: a typo can neither disable the bound nor pin a slot.
    expect(resolveStepExecutionTimeoutInMs(10)).toBe(
      MIN_STEP_EXECUTION_TIMEOUT_IN_MS,
    );
    expect(resolveAgentClaimTimeoutInMs(24 * 60 * 60 * 1000)).toBe(
      MAX_AGENT_CLAIM_TIMEOUT_IN_MS,
    );

    expect(section(CONFIGURATION, "Output caps and timeouts")).toContain(
      "| Timeout range | **1 second to 1 hour** | Every timeout |",
    );
    expect(CONFIGURATION).toContain(
      "A value outside the range is clamped when the step runs",
    );
    expect(AGENTS).toContain(
      "Each accepts 1 second to 1 hour; values outside that range are clamped when the step runs.",
    );
  });

  it("set the timeouts on the Steps page under the editor's own names", () => {
    expect(STEPS_PAGE).toContain('"Execution timeout"');
    expect(STEPS_PAGE).toContain('"Claim timeout"');
    expect(STEPS_PAGE).toContain('"Request timeout"');
    // Folded under a step's More fields, which names them when they are set.
    expect(STEP_EDITOR_MODEL).toContain(
      'MORE_FIELDS_TIMEOUTS_TITLE: string = translationKey("Timeouts");',
    );
    expect(AGENTS).toContain(
      "set **Execution timeout** and **Claim timeout** (in seconds) under its **More fields**.",
    );
    expect(CONFIGURATION).toContain(
      "Set the timeouts per step, under its **More fields** on the runbook's **Steps** page;",
    );
    // The HTTP request step runs with the step timeout too.
    expect(STEP_EXECUTORS).toMatch(
      /const timeout: number = resolveStepExecutionTimeoutInMs\(\s*storedConfig\.timeoutInMs,?\s*\);/,
    );
  });
});

describe("what a step's output and network are held to", () => {
  it("cap a step's output at 50 KB on the Worker and on the Runner", () => {
    expect(declaredNumber(STEP_EXECUTORS, "MAX_OUTPUT_BYTES")).toBe(50_000);
    expect(declaredNumber(RUNNER_CONFIG, "MAX_OUTPUT_BYTES")).toBe(50_000);

    expect(section(CONFIGURATION, "Output caps and timeouts")).toContain(
      "| Output per step | **50 KB**. Longer output is cut off with a marker. | Every automated step |",
    );
    expect(section(RUNNING, "Output limits")).toContain(
      "Per-step output is capped at **50 KB**",
    );
    expect(AGENTS).toContain(
      "Combined stdout and stderr are capped at **50 KB** per step.",
    );
  });

  it("say what an HTTP request step counts as success, and that it follows no redirect", () => {
    expect(STEP_EXECUTORS).toContain("maxRedirects: 0,");
    expect(STEP_EXECUTORS).toContain(
      "if (response.status >= 200 && response.status < 400) {",
    );
    expect(STEP_EXECUTORS).toContain(
      "errorMessage: `HTTP ${response.status}`,",
    );

    expect(AUTHORING).toContain(
      "The step succeeds on a `2xx` or `3xx` response and fails on anything else, with `HTTP <status>` as its error. Redirects are not followed.",
    );
    expect(CONFIGURATION).toContain("Redirects are not followed.");
  });

  it("list the HTTP methods the editor offers", () => {
    const methods: Array<string> = [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
    ];
    const list: RegExpMatchArray | null = STEPS_PAGE.match(
      /const HTTP_METHODS: HttpRequestMethod\[\] = \[([^\]]+)\]/,
    );

    expect(list).not.toBeNull();
    expect(
      Array.from((list as RegExpMatchArray)[1]!.matchAll(/"([A-Z]+)"/g)).map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    ).toEqual(methods);

    const row: Array<string> = rowsStartingWith(AUTHORING, "**Method**")[0]!;

    expect(row[1]).toBe(
      `${methods
        .slice(0, -1)
        .map((method: string): string => {
          return `\`${method}\``;
        })
        .join(", ")} or \`${methods[methods.length - 1]}\`.`,
    );
    expect(row[2]).toBe("`GET`");
    expect(STEPS_PAGE).toContain('const method: string = cfg.method || "GET";');
  });

  it("guard the HTTP request step's target with the egress guard", () => {
    expect(STEP_EXECUTORS).toContain(
      "await DataSourceEgressGuard.assertUrlAllowedAndPin(config.url",
    );
  });

  describe("the egress guard an HTTP request step goes through", () => {
    const savedBlock: string | undefined =
      process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"];
    const savedBilling: string | undefined = process.env["BILLING_ENABLED"];

    afterEach(() => {
      if (savedBlock === undefined) {
        delete process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"];
      } else {
        process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"] = savedBlock;
      }

      if (savedBilling === undefined) {
        delete process.env["BILLING_ENABLED"];
      } else {
        process.env["BILLING_ENABLED"] = savedBilling;
      }
    });

    it("never calls loopback or link-local addresses, such as a cloud metadata endpoint", () => {
      for (const address of ["127.0.0.1", "169.254.169.254", "::1"]) {
        expect({
          address,
          blocked: DataSourceEgressGuard.checkAddress(address, {
            blockPrivateAddresses: false,
          }).blocked,
        }).toEqual({ address, blocked: true });
      }

      expect(AUTHORING).toContain(
        "The Worker never calls loopback or link-local addresses, such as a cloud metadata endpoint.",
      );
    });

    it("refuses private addresses on OneUptime Cloud, and on a self-hosted OneUptime that asks", () => {
      delete process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"];
      process.env["BILLING_ENABLED"] = "true";
      expect(DataSourceEgressGuard.shouldBlockPrivateAddresses()).toBe(true);

      process.env["BILLING_ENABLED"] = "false";
      expect(DataSourceEgressGuard.shouldBlockPrivateAddresses()).toBe(false);
      expect(
        DataSourceEgressGuard.checkAddress("10.0.4.21", {
          blockPrivateAddresses: false,
        }).blocked,
      ).toBe(false);

      process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"] = "true";
      expect(DataSourceEgressGuard.shouldBlockPrivateAddresses()).toBe(true);
      expect(
        DataSourceEgressGuard.checkAddress("10.0.4.21", {
          blockPrivateAddresses: true,
        }).blocked,
      ).toBe(true);

      expect(AUTHORING).toContain(
        "On OneUptime Cloud it calls public addresses only. A self-hosted OneUptime also reaches private networks, unless `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` is `true`.",
      );
      expect(CONFIGURATION).toContain(
        "on OneUptime Cloud it also refuses private network addresses, and a self-hosted OneUptime refuses them with `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`.",
      );
    });
  });

  it("give the JavaScript sandbox 128 MB and only public addresses, on the Runner", () => {
    expect(VM_RUNNER).toContain("new ivm.Isolate({ memoryLimit: 128 })");

    // The axios bridge lets a script reach private addresses only when asked to ...
    expect(VM_RUNNER).toContain(
      "allowPrivateNetworkTargets:\n            options.allowPrivateNetworkRequests === true,",
    );

    // ... and the Runner never asks.
    const call: number = RUNNER_RUNBOOK_EXECUTOR.indexOf(
      "VMUtil.runCodeInSandbox({",
    );

    expect(call).toBeGreaterThan(0);
    expect(
      RUNNER_RUNBOOK_EXECUTOR.slice(call, call + 200).includes(
        "allowPrivateNetworkRequests",
      ),
    ).toBe(false);

    expect(AUTHORING).toContain(
      "The sandbox has 128 MB of memory and no filesystem or process access. It can make HTTP requests with `axios`, but only to public addresses",
    );
    expect(CONFIGURATION).toContain(
      "JavaScript runs in a separate `isolated-vm` isolate with 128 MB of memory",
    );
  });

  it("name tools the Runner's image ships with", () => {
    const install: number = RUNNER_DOCKERFILE.indexOf("apt-get install");

    expect(install).toBeGreaterThan(0);

    for (const tool of ["curl", "wget", "openssh-client"]) {
      expect({
        tool,
        installed: new RegExp(`\\s${tool}\\s`).test(
          RUNNER_DOCKERFILE.slice(install, install + 400),
        ),
      }).toEqual({ tool, installed: true });
    }

    expect(AUTHORING).toContain(
      "with the tools its image ships, such as `curl`, `wget` and the `ssh` client",
    );
  });

  it("give an AI step up to 4,000 characters of each earlier step's output", () => {
    expect(declaredNumber(AI_STEP_EXECUTOR, "MAX_CHARS_PER_STEP_OUTPUT")).toBe(
      4_000,
    );
    expect(AI_STEP_EXECUTOR).toContain(
      "redactAndCap(stepExecution.output, MAX_CHARS_PER_STEP_OUTPUT)",
    );

    expect(AUTHORING).toContain(
      "It gets up to 4,000 characters of each step's output.",
    );
  });
});

describe("the Runner the runbook pages describe", () => {
  const environment: string = section(AGENTS, "Environment variables");

  it("lists every variable the Runner reads, and nothing it does not", () => {
    const documented: Array<string> = tableRows(environment).map(
      (row: Array<string>): string => {
        return (row[0] as string).replace(/`/g, "");
      },
    );

    expect(documented).toEqual([
      "ONEUPTIME_URL",
      "ONEUPTIME_RUNNER_ID",
      "ONEUPTIME_RUNNER_KEY",
      "ONEUPTIME_RUNNER_POLL_INTERVAL_MS",
      "ONEUPTIME_RUNNER_HEARTBEAT_INTERVAL_MS",
      "ONEUPTIME_RUNNER_JOB_HEARTBEAT_INTERVAL_MS",
      "ONEUPTIME_RUNNER_CONCURRENCY",
      "ONEUPTIME_RUNNER_ENABLE_RUNBOOKS",
      "ONEUPTIME_RUNNER_ENABLE_CODE_FIXES",
      "ONEUPTIME_RUNNER_ENABLE_AI_COMMANDS",
    ]);

    for (const variable of documented) {
      expect({
        variable,
        read: RUNNER_CONFIG.includes(`process.env["${variable}"]`),
      }).toEqual({ variable, read: true });
    }
  });

  it("gives each interval the default and the floor Runner/Config.ts reads it with", () => {
    for (const [variable, notes] of [
      [
        "ONEUPTIME_RUNNER_POLL_INTERVAL_MS",
        "How often the Runner asks for new jobs.",
      ],
      [
        "ONEUPTIME_RUNNER_HEARTBEAT_INTERVAL_MS",
        "How often the Runner reports that it is alive.",
      ],
      [
        "ONEUPTIME_RUNNER_JOB_HEARTBEAT_INTERVAL_MS",
        "How often the Runner renews a running job's lease.",
      ],
    ] as Array<[string, string]>) {
      const read: EnvNumber = runnerEnvNumber(variable);

      expect(environment).toContain(
        `| \`${variable}\` | no | \`${read.defaultValue}\` | ${notes} A value under \`${read.min}\` falls back to the default. |`,
      );
    }

    const concurrency: EnvNumber = runnerEnvNumber(
      "ONEUPTIME_RUNNER_CONCURRENCY",
    );

    expect(environment).toContain(
      `| \`ONEUPTIME_RUNNER_CONCURRENCY\` | no | \`${concurrency.defaultValue}\` | Maximum simultaneous jobs on this Runner. |`,
    );
  });

  it("says how often a Runner polls and reports in, at the defaults", () => {
    const poll: number = runnerEnvNumber(
      "ONEUPTIME_RUNNER_POLL_INTERVAL_MS",
    ).defaultValue;
    const heartbeat: number = runnerEnvNumber(
      "ONEUPTIME_RUNNER_HEARTBEAT_INTERVAL_MS",
    ).defaultValue;

    expect(AGENTS).toContain(
      `3. The Runner asks OneUptime for work every ${poll / 1000} seconds, and reports that it is alive every ${heartbeat / 1000} seconds.`,
    );
    expect(AGENTS).toContain(
      `(\`ONEUPTIME_RUNNER_POLL_INTERVAL_MS\`, ${poll / 1000} seconds by default)`,
    );
  });

  it("says a capability variable can only turn a capability off", () => {
    expect(RUNNER_CONFIG).toContain(
      "these env vars are a local override\n * that can only ever turn a capability OFF.",
    );

    for (const variable of [
      "ONEUPTIME_RUNNER_ENABLE_RUNBOOKS",
      "ONEUPTIME_RUNNER_ENABLE_CODE_FIXES",
      "ONEUPTIME_RUNNER_ENABLE_AI_COMMANDS",
    ]) {
      const override: RegExp = new RegExp(
        `parseCapabilityOverride\\(\\s*process\\.env\\["${variable}"\\],?\\s*\\)`,
      );

      expect({ variable, override: override.test(RUNNER_CONFIG) }).toEqual({
        variable,
        override: true,
      });

      expect(environment).toContain(
        `| \`${variable}\` | no | — | Set to \`false\``,
      );
    }

    expect(environment).toContain("It can only turn the capability off.");
  });

  it("gives a claimed job the lease, and renews it at the cadence, the pages say", () => {
    const leaseMs: number = declaredNumber(
      RUNNER_JOB_SERVICE,
      "DEFAULT_LEASE_MS",
    );
    const renewMs: number = runnerEnvNumber(
      "ONEUPTIME_RUNNER_JOB_HEARTBEAT_INTERVAL_MS",
    ).defaultValue;

    expect(leaseMs).toBe(30_000);

    const lease: string = section(AGENTS, "Operational notes");

    expect(lease).toContain(
      `it gets a short lease (${leaseMs / 1000} seconds by default). While the step runs, the Runner renews the lease every ${renewMs / 1000} seconds.`,
    );
    expect(lease).toContain(
      `O-->>R: The job, with a ${leaseMs / 1000}-second lease`,
    );
    expect(lease).toContain(
      `loop Every ${renewMs / 1000} seconds while it runs`,
    );
  });

  it("says when a Runner shows Connected, Disconnected or Never connected", () => {
    expect(RUNNER_ALIVE_WINDOW_IN_MINUTES).toBe(5);

    expect(getRunnerLiveStatus(null)).toBe(RunnerLiveStatus.NeverConnected);
    expect(
      getRunnerLiveStatus(
        OneUptimeDate.getSomeMinutesAgo(RUNNER_ALIVE_WINDOW_IN_MINUTES - 1),
      ),
    ).toBe(RunnerLiveStatus.Connected);
    expect(
      getRunnerLiveStatus(
        OneUptimeDate.getSomeMinutesAgo(RUNNER_ALIVE_WINDOW_IN_MINUTES + 1),
      ),
    ).toBe(RunnerLiveStatus.Disconnected);

    const connected: string = getRunnerLiveStatusLabel(
      RunnerLiveStatus.Connected,
    );
    const disconnected: string = getRunnerLiveStatusLabel(
      RunnerLiveStatus.Disconnected,
    );
    const never: string = getRunnerLiveStatusLabel(
      RunnerLiveStatus.NeverConnected,
    );

    expect(AGENTS).toContain(
      `**${never}** means the Runner has never reported in. **${disconnected}** means it did, but not in the last ${RUNNER_ALIVE_WINDOW_IN_MINUTES} minutes.`,
    );
    expect(AGENTS).toContain(`If it stays **${never}** or **${disconnected}**`);
    expect(AGENTS).toContain(`should read **${connected}**`);
  });

  it("documents the endpoints the Runner calls, where they are mounted and how they authenticate", () => {
    const documented: Array<string> = tableRows(
      section(AGENTS, "Agent-facing API"),
    ).map((row: Array<string>): string => {
      return (row[0] as string).replace(/`/g, "").replace("POST ", "");
    });

    expect(documented).toEqual([
      "/heartbeat",
      "/claim-next-job",
      "/job/:jobId/heartbeat",
      "/job/:jobId/result",
      "/disconnect",
    ]);

    for (const route of documented) {
      expect({
        route,
        served: RUNNER_INGRESS.includes(
          `\`${route}\`,\n      RunnerAuthorization.isAuthorizedAgent,`,
        ),
      }).toEqual({ route, served: true });
    }

    expect(RUNBOOK_FEATURE_INDEX).toContain(
      'const AGENT_INGRESS_PATH: string = "runner-ingest";',
    );
    expect(RUNBOOK_FEATURE_INDEX).toContain(
      'const LEGACY_AGENT_INGRESS_PATH: string = "runbook-agent-ingest";',
    );
    expect(RUNNER_AUTHORIZATION).toContain(
      'data["agentId"] ?? req.headers["x-agent-id"]',
    );
    expect(RUNNER_AUTHORIZATION).toContain(
      'data["agentKey"] ?? req.headers["x-agent-key"]',
    );

    expect(AGENTS).toContain(
      "mounted under `/runner-ingest`. The pre-merge path `/runbook-agent-ingest` is still served",
    );
    expect(AGENTS).toContain(
      "in the JSON body (`agentId` and `agentKey`), or in the `x-agent-id` and `x-agent-key` headers.",
    );
  });

  it("walks Create Runner's one page, with Runs Runbooks and the labels under More fields", () => {
    // One page: no steps.
    expect(formSteps(RUNNER_FORM_FIELDS)).toEqual([]);

    const capability: RegExp =
      /title: "(Runs [^"]+)",\s*collapsibleSection: MORE_FIELDS,[\s\S]*?defaultValue: (true|false),/g;
    const defaults: Array<[string, boolean]> = Array.from(
      RUNNER_FORM_FIELDS.matchAll(capability),
    ).map((match: RegExpMatchArray): [string, boolean] => {
      return [match[1] as string, match[2] === "true"];
    });

    /*
     * AI is not a capability: a code repository picks its Runner in its
     * settings in Code (CodeRepository.runnerId), and an auto remediation
     * rule or a cluster's AI settings pick the Runner OneUptime AI runs its
     * commands on (RunnerAiCommandsPick).
     */
    expect(defaults).toEqual([["Runs Runbooks", true]]);
    expect(RUNNER_FORM_FIELDS).not.toContain("canRunAiCommands: true");

    const setup: string = section(AGENTS, "Install a Runner");

    expect(setup).not.toContain("Runs AI Code Fixes");
    expect(setup).not.toContain("Runs AI Remediation Commands");
    expect(setup).toContain(
      "Click **Create Runner** and fill in its fields, all on one page:",
    );
    expect(setup).toContain(
      "AI is not a capability. A code repository picks the Runner AI works in it on, in its settings in Code, and the Runner's page lists the repositories that pick it.",
    );
    expect(setup).toContain(
      "An AI rule picks the Runner OneUptime AI runs its commands on: picking a Runner there is what lets OneUptime AI's commands run on it.",
    );
    /*
     * The Runner's page lists the AI rules that pick it, in Runner Details
     * after the repositories (Components/Runner/RunnerAiRules): rules read
     * by their Runner.
     */
    expect(setup).toContain(
      "The Runner's page lists the AI rules that pick it too.",
    );
    expect(readDashboard("Components/Runner/RunnerAiRules.tsx")).toContain(
      "          runnerId: runnerId,",
    );
    expect(readDashboard("Pages/Runbook/Runners/RunnerView.tsx")).toContain(
      "title: RunnerAiRulesCopy.title,",
    );

    for (const [name, on] of defaults) {
      expect({
        name,
        row: setup.includes(
          `| **${name}** | Under **More fields** | ${on ? "On" : "Off"} by default.`,
        ),
      }).toEqual({
        name,
        row: true,
      });
    }

    for (const field of ["Name", "Description"]) {
      expect(setup).toContain(`| **${field}** | On the page |`);
    }

    // The labels fold under More fields, after Runs Runbooks.
    expect(RUNNER_FORM_FIELDS).toContain(
      "getLabelsFormField<Runner>({ collapsibleSection: MORE_FIELDS })",
    );
    expect(setup).toContain("| **Labels** | Under **More fields** |");
  });

  it("names the Runners list's columns, its setup action and the Runner page's status card", () => {
    for (const label of ["Status", "Last Seen", "Show setup instructions"]) {
      expect({
        label,
        drawn: RUNNERS_PAGE.includes(`title: "${label}"`),
      }).toEqual({ label, drawn: true });
    }

    for (const label of ["Runner Status", "Runner Version", "Host"]) {
      expect({
        label,
        drawn: RUNNER_VIEW.includes(`title: "${label}"`),
      }).toEqual({ label, drawn: true });
    }

    expect(AGENTS).toContain(
      "the Runner's **Status** should read **Connected**, with a fresh **Last Seen**.",
    );
    expect(AGENTS).toContain(
      "On the Runner's own page, the **Runner Status** card shows its **Runner Version** and **Host**.",
    );
    expect(AGENTS).toContain(
      "On the Runner's row, click **Show setup instructions**.",
    );
  });

  it("says who may create a Runner and who may read its key", () => {
    const runner: Runner = new Runner();

    expect(
      englishList(roles(runner.createRecordPermissions).map(title), "and"),
    ).toBe("Project Owner, Project Admin, Project Member and Runbook Admin");
    expect(AGENTS).toContain(
      "Project Owner, Project Admin, Project Member and Runbook Admin can create one.",
    );

    const key: ColumnAccessControl | null =
      runner.getColumnAccessControlFor("key");

    expect(key).not.toBeNull();
    expect(
      englishList((key as ColumnAccessControl).read.map(title), "or"),
    ).toBe("Project Owner, Project Admin or Runbook Admin");
    expect(AGENTS).toContain(
      "Only a Project Owner, Project Admin or Runbook Admin can see a Runner's key",
    );
    expect(AGENTS).toContain(
      "A Runner's key is readable only by Project Owners, Project Admins and Runbook Admins.",
    );
  });

  it("quotes what the Runner and the Worker write when a step is not taken or not finished", () => {
    for (const message of [
      "No runbook agent picked up this step before the wait window expired.",
      "The runbook agent stopped responding while this step was running.",
    ]) {
      expect({
        message,
        written: RUNNER_JOB_SERVICE.includes(`return "${message}`),
      }).toEqual({
        message,
        written: true,
      });
      expect(AGENTS).toContain(`"${message}"`);
    }

    expect(RUNNING).toContain(
      '"No runbook agent picked up this step before the wait window expired."',
    );
    expect(RUNNER_INDEX).toContain(
      '"No capability is enabled — this Runner has nothing to do.',
    );
    expect(AGENTS).toContain('Runner logs "No capability is enabled"');
  });

  it("says a kubectl step runs with bash, KUBECONFIG pointing at the cluster, and keeps no kubeconfig", () => {
    expect(RUNNER_KUBECTL_SCRIPT_EXECUTOR).toContain(
      "on this Runner with KUBECONFIG pointing at the cluster's kubeconfig.",
    );
    expect(RUNNER_KUBECTL_SCRIPT_EXECUTOR).toContain(
      "written to a private file (0600) in a private directory",
    );
    expect(RUNNER_DOCKERFILE).toContain(
      "install -o root -g root -m 0755 /tmp/kubectl /usr/local/bin/kubectl",
    );

    expect(AUTHORING).toContain(
      "The script runs with bash on the Runner, which ships `kubectl`, with `KUBECONFIG` pointing at the cluster",
    );
    expect(AUTHORING).toContain(
      "The Runner writes a kubeconfig to a file only it can read, and removes it when the script ends.",
    );
    expect(CONFIGURATION).toContain(
      "| kubectl | A Runner | `bash -c <script>`, with `KUBECONFIG` pointing at the cluster. |",
    );
  });

  it("quotes what the server says to a Runner too old for a kubectl script", () => {
    const message: string =
      "This kubectl step runs a script, and this Runner is too old to run one, so it was not run.";

    expect(RUNNER_INGRESS).toContain(message);
    expect(AGENTS).toContain(`The step failed with "${message}"`);
  });
});

describe("a step's options on the authoring page", () => {
  /*
   * The keys of what a new step of this type folds under More fields, in
   * order. `runner`: what the Steps page names the step's Runner, for a
   * step that runs on one.
   */
  function foldedKeys(
    type: RunbookStepType,
    runner?: string | undefined,
  ): Array<string> {
    const step: RunbookStep = {
      id: "step",
      order: 0,
      type,
      title: "Step",
      config: {},
    } as RunbookStep;

    return getStepMoreFieldsItems(step, runner ? { runner } : {}).map(
      (item: FoldedSectionItem): string => {
        return item.key;
      },
    );
  }

  it("puts the approval switch on the step it holds back, named as the editor and the step's header draw it", () => {
    expect(AUTHORING).toContain(
      `| **${REQUIRE_APPROVAL_FOLDED_TITLE}** | Automated steps only. If on, the run stops before this step until someone approves it, and only then runs it. The switch reads **${REQUIRE_APPROVAL_TITLE}**, and the step's header says **${NEEDS_APPROVAL_LABEL}**. |`,
    );
    expect(STEPS_PAGE).toContain("title={REQUIRE_APPROVAL_TITLE}");
    expect(STEPS_PAGE).toContain("NEEDS_APPROVAL_LABEL,");
  });

  it("lists what an automated step folds under More fields in the fold's order", () => {
    const switches: Array<string> = [
      "requireApprovalBeforeRunning",
      "continueOnFailure",
    ];

    expect(foldedKeys(RunbookStepType.HttpRequest)).toEqual([
      ...switches,
      "headersJson",
      "description",
      "timeouts",
    ]);
    expect(foldedKeys(RunbookStepType.SSH)).toEqual([
      ...switches,
      "port",
      "passphrase",
      "hostKey",
      "description",
      "timeouts",
    ]);
    expect(foldedKeys(RunbookStepType.AI)).toEqual([
      ...switches,
      "llmProviderId",
      "includePreviousStepContext",
      "includeTriggerContext",
      "description",
    ]);

    for (const type of [
      RunbookStepType.JavaScript,
      RunbookStepType.Bash,
      RunbookStepType.Kubernetes,
    ]) {
      expect(foldedKeys(type)).toEqual([
        ...switches,
        "description",
        "timeouts",
      ]);
    }

    /*
     * A step that runs on a Runner names it first - the one item the line
     * always says the value of, set or not (the Steps page passes it).
     */
    for (const type of [
      RunbookStepType.JavaScript,
      RunbookStepType.Bash,
      RunbookStepType.SSH,
      RunbookStepType.Kubernetes,
    ]) {
      expect(foldedKeys(type, "Global Runner").slice(0, 3)).toEqual([
        "runner",
        ...switches,
      ]);
    }

    expect(AUTHORING).toContain(
      `In every automated step below, the step's **More fields** holds its **${RUNNER_FIELD_TITLE}** first, for a step that runs on one, then **${REQUIRE_APPROVAL_FOLDED_TITLE}** and **${CONTINUE_ON_FAILURE_TITLE}**, then the step's own extra settings - an HTTP request's headers, an SSH step's port, key passphrase and host key, an AI step's provider and context switches - and last the **Description** and the timeouts. Folded, it names the step's Runner, so you see where a step runs without opening it.`,
    );
    expect(STEPS_PAGE).toContain("getStepMoreFieldsItems(");
    expect(STEPS_PAGE).toContain(
      "{ runner: getRunnerFoldedValue(runnerModel) }",
    );
    expect(AUTHORING).toContain(
      `| **${HTTP_HEADERS_TITLE}** | Under **More fields**.`,
    );
  });

  it("gives a Manual step Instructions and no approval switch, and folds nothing of it", () => {
    expect(canStepTypeRequireApproval(RunbookStepType.Manual)).toBe(false);
    expect(foldedKeys(RunbookStepType.Manual)).toEqual([]);
    expect(STEPS_PAGE).toContain(
      'isManual ? MANUAL_INSTRUCTIONS_TITLE : "Description"',
    );
    expect(AUTHORING).toContain(
      `On a Manual step it is the **${MANUAL_INSTRUCTIONS_TITLE}** the responder reads and follows, shown below the title.`,
    );
    expect(AUTHORING).toContain(
      `A checklist item for a person: its **${MANUAL_INSTRUCTIONS_TITLE}** say what to do or check.`,
    );
    expect(AUTHORING).toContain(
      "A Manual step has no approval switch: it stops the run for a person already.",
    );
  });

  it("shows an HTTP request's Body for the methods that send one", () => {
    expect(AUTHORING).toContain(
      `| **Body** | Shown for ${englishList(
        HTTP_METHODS_WITH_BODY.map((method: string): string => {
          return `\`${method}\``;
        }),
        "and",
      )}.`,
    );
  });
});

describe("running a runbook", () => {
  it("draws the run's states with the execution page's own labels", () => {
    const labels: Array<[string, string]> = statusLabels(
      "RunbookExecutionStatus",
    );

    expect(
      labels.map(([member]: [string, string]): string => {
        return member;
      }),
    ).toEqual(Object.keys(RunbookExecutionStatus));

    const diagram: string = section(RUNNING, "How a run moves");

    for (const [member, label] of labels) {
      expect(diagram).toContain(`    state "${label}" as ${member}\n`);
    }

    expect(diagram).toContain(
      "It ends **Completed**, **Failed** or **Cancelled**.",
    );
  });

  it("names the step badges the execution page draws, in its order, with the badge of a step that waits for approval after Waiting for you", () => {
    const labels: Array<string> = statusLabels(
      "RunbookStepExecutionStatus",
    ).map(([, label]: [string, string]): string => {
      return label;
    });

    expect(labels.length).toBe(Object.keys(RunbookStepExecutionStatus).length);

    // The step the run waits on reads Waiting for you, or Waiting for approval.
    const waiting: number = labels.indexOf(WAITING_FOR_YOU_LABEL);

    expect(waiting).toBeGreaterThan(-1);
    expect(EXECUTION_VIEW).toContain("label: getWaitingStepStatusLabel(wait),");
    expect(getWaitingStepStatusLabel(RunbookStepWait.Manual)).toBe(
      WAITING_FOR_YOU_LABEL,
    );

    for (const wait of [
      RunbookStepWait.ApprovalToRun,
      RunbookStepWait.ApprovalToContinue,
    ]) {
      expect(getWaitingStepStatusLabel(wait)).toBe(WAITING_FOR_APPROVAL_LABEL);
    }

    const badges: Array<string> = [
      ...labels.slice(0, waiting + 1),
      WAITING_FOR_APPROVAL_LABEL,
      ...labels.slice(waiting + 1),
    ];

    expect(RUNNING).toContain(
      `- **Status pill** — ${englishList(badges, "or")}.`,
    );
  });

  it("refreshes the execution page at the interval the page says", () => {
    const interval: number = declaredNumber(EXECUTION_VIEW, "POLL_INTERVAL_MS");

    expect(RUNNING).toContain(
      `the page refreshes itself every ${interval / 1000} seconds. Click **Refresh**`,
    );
  });

  it("names the execution page's own labels and buttons", () => {
    for (const label of ["Status", "Progress", "Started", "Triggered by"]) {
      expect({
        label,
        drawn: EXECUTION_VIEW.includes(`translator.translateText("${label}")`),
      }).toEqual({ label, drawn: true });
      expect(RUNNING).toContain(`**${label}**`);
    }

    for (const label of ["Refresh", "Cancel Execution", "Run Again", "Skip"]) {
      expect({ label, drawn: EXECUTION_VIEW.includes(`"${label}"`) }).toEqual({
        label,
        drawn: true,
      });
      expect(RUNNING).toContain(`**${label}**`);
    }

    // The waiting step's button, by why the run waits on it, and who approved it.
    expect(EXECUTION_VIEW).toContain("getWaitingStepButtonTitle(wait");
    expect(EXECUTION_VIEW).toContain(
      "translator.translateText(APPROVED_BY_LABEL)",
    );

    for (const label of [
      getWaitingStepButtonTitle(RunbookStepWait.Manual),
      getWaitingStepButtonTitle(RunbookStepWait.ApprovalToRun),
      getWaitingStepButtonTitle(RunbookStepWait.ApprovalToContinue),
      APPROVED_BY_LABEL,
    ]) {
      expect(RUNNING).toContain(`**${label}**`);
    }
  });

  it("says who may start a run, and who sees Run Now locked", () => {
    const roleNames: Array<string> = RUNBOOK_RUN_ROLE_PERMISSIONS.map(title);
    const granularNames: Array<string> =
      RUNBOOK_RUN_GRANULAR_PERMISSIONS.map(title);

    expect([...RUNBOOK_RUN_PERMISSIONS].sort()).toEqual(
      [
        ...RUNBOOK_RUN_ROLE_PERMISSIONS,
        ...RUNBOOK_RUN_GRANULAR_PERMISSIONS,
      ].sort(),
    );
    expect(RUNNING).toContain(
      `Starting a run takes ${englishList(roleNames, "or")}, or the **${englishList(granularNames, "or")}** permission.`,
    );

    // Locked for the roles that read runbooks and do not run them.
    const readers: Array<Permission> = roles(
      new Runbook().readRecordPermissions,
    );

    for (const locked of [Permission.RunbookViewer, Permission.Viewer]) {
      expect(readers).toContain(locked);
      expect(RUNBOOK_RUN_PERMISSIONS).not.toContain(locked);
    }

    expect(RUNNING).toContain(
      `${title(Permission.RunbookViewer)} and ${title(Permission.Viewer)} see **Run Now** locked`,
    );
  });

  it("says moving a run along takes the same roles, or Edit Runbook Execution", () => {
    const extra: Array<Permission> = RUNBOOK_ADVANCE_PERMISSIONS.filter(
      (permission: Permission): boolean => {
        return !RUNBOOK_RUN_PERMISSIONS.includes(permission);
      },
    );

    expect(extra).toEqual([Permission.EditRunbookExecution]);
    expect(RUNNING).toContain(
      `Completing, approving, skipping and cancelling take the same roles as starting a run, or the **${title(Permission.EditRunbookExecution)}** permission.`,
    );
  });

  it("quotes the refusals a run can meet as they are written", () => {
    expect(RUNNING).toContain(`"${RUNBOOK_RUN_REFUSED_MESSAGE}"`);

    for (const message of [
      "Runbook is disabled",
      "Runbook has no steps to run",
    ]) {
      expect(RUNBOOK_API).toContain(`new BadDataException("${message}")`);
      expect(RUNNING).toContain(`"${message}"`);
    }

    /*
     * A Bash step with no Runner: the refusal the one "global by default"
     * rule writes (RunnerChoice), quoted with the step type it names.
     */
    const missingRunner: string = describeRunnerChoiceRefusal({
      refusal: RunnerChoiceRefusal.NeedsOwnRunner,
      stepType: RunbookStepType.Bash,
    });

    expect(missingRunner).toBe(
      "This Bash step has no Runner. Bash steps run on a Runner of your own, inside your network: global Runners run JavaScript steps only. Pick one of your Runners for the step, or make one the project's default Runner under Runbooks → Runners.",
    );
    expect(RUNNER_CHOICE).toContain(
      "steps run on a Runner of your own, inside your network: global Runners run JavaScript steps only. Pick one of your Runners for the step, or make one the project's default Runner under Runbooks → Runners.`;",
    );
    expect(STEP_EXECUTORS).toContain("getRunnerChoiceRefusalFromStep({");
    expect(RUNNING).toContain(`"${missingRunner}"`);
  });

  it("does not record the result of a step that was running when the run ended", () => {
    const ran: number = RUN_RUNBOOK.indexOf("this.runAutomatedStep(");
    const asked: number = RUN_RUNBOOK.indexOf(
      "if (await this.hasReachedTerminalState(execution._id!)) {",
      ran,
    );
    const recorded: number = RUN_RUNBOOK.indexOf(
      "stepExec.completedAt = new Date().toISOString();",
      ran,
    );

    expect(ran).toBeGreaterThan(0);
    expect(asked).toBeGreaterThan(ran);
    expect(recorded).toBeGreaterThan(asked);

    expect(section(RUNNING, "Cancelling a run")).toContain(
      "A step that is already running is not interrupted, but its result is not recorded: the step stays `Cancelled`.",
    );
  });

  it("names the run and job statuses the way the product stores them", () => {
    expect(RUNNING).toContain("The status becomes `Cancelled`");
    expect(Object.values(RunbookExecutionStatus)).toContain("Cancelled");

    const statuses: string = Object.values(RunnerJobStatus)
      .map((status: string): string => {
        return `\`${status}\``;
      })
      .join(" ");

    // Pending, Claimed, Running, then one of the four outcomes.
    expect(statuses).toBe(
      "`Pending` `Claimed` `Running` `Succeeded` `Failed` `TimedOut` `Cancelled`",
    );
    expect(CONFIGURATION).toContain(
      "status (`Pending` → `Claimed` → `Running` → `Succeeded`, `Failed`, `TimedOut` or `Cancelled`)",
    );
  });
});

describe("authoring a runbook", () => {
  const AUTHORED_STEP_TYPES: Array<RunbookStepType> = [
    RunbookStepType.Manual,
    RunbookStepType.JavaScript,
    RunbookStepType.HttpRequest,
    RunbookStepType.Bash,
    RunbookStepType.SSH,
    RunbookStepType.Kubernetes,
    RunbookStepType.AI,
  ];

  // The name the pages give each step type: the editor's own short or full label.
  const STEP_TYPE_NAME: Record<string, string> = {
    [RunbookStepType.Manual]: "Manual",
    [RunbookStepType.JavaScript]: "JavaScript",
    [RunbookStepType.HttpRequest]: "HTTP request",
    [RunbookStepType.Bash]: "Bash",
    [RunbookStepType.SSH]: "SSH",
    // A kubectl script: the type keeps its stored name, Kubernetes.
    [RunbookStepType.Kubernetes]: "kubectl",
    [RunbookStepType.AI]: "AI",
  };

  it("names each step type as the editor does", () => {
    for (const type of AUTHORED_STEP_TYPES) {
      const meta: RegExp = new RegExp(
        `\\[RunbookStepType\\.${type}\\]: \\{\\s*type: RunbookStepType\\.${type},\\s*label: "([^"]+)",\\s*shortLabel: "([^"]+)"`,
      );
      const match: RegExpMatchArray | null = STEPS_PAGE.match(meta);

      expect({ type, drawn: Boolean(match) }).toEqual({ type, drawn: true });
      expect([match![1], match![2]]).toContain(STEP_TYPE_NAME[type]);
    }

    expect(AUTHORING).toContain(
      `| [${STEP_TYPE_NAME[RunbookStepType.HttpRequest]}](#http-request) |`,
    );
  });

  it("says which step types run on a Runner, the Worker or a person", () => {
    const expected: (type: RunbookStepType) => string = (
      type: RunbookStepType,
    ): string => {
      if (type === RunbookStepType.Manual) {
        return "person";
      }

      return RUNNER_EXECUTED_STEP_TYPES.includes(type) ? "Runner" : "Worker";
    };

    const tables: Array<[string, Array<Array<string>>]> = [
      ["index", tableRows(section(INDEX, "Step types"))],
      ["authoring", tableRows(section(AUTHORING, "Step types"))],
      [
        "configuration",
        tableRows(section(CONFIGURATION, "Where each step type runs")),
      ],
    ];

    for (const [page, rows] of tables) {
      for (const type of AUTHORED_STEP_TYPES) {
        const name: string = STEP_TYPE_NAME[type] as string;
        const row: Array<string> | undefined = rows.find(
          (cellsOfRow: Array<string>): boolean => {
            return (
              cellsOfRow[0] === name ||
              cellsOfRow[0] === `**${name}**` ||
              (cellsOfRow[0] as string).startsWith(`[${name}](`)
            );
          },
        );

        expect({ page, name, listed: Boolean(row) }).toEqual({
          page,
          name,
          listed: true,
        });
        expect({ page, name, runsOn: row![1] }).toEqual({
          page,
          name,
          runsOn: {
            person: "A person",
            Runner: "A Runner",
            Worker: "The OneUptime Worker",
          }[expected(type)],
        });
      }
    }
  });

  it("names every field of the step tables as the editor draws it", () => {
    const tables: string = section(AUTHORING, "Step types");
    const fields: Array<string> = tableRows(tables)
      .map((row: Array<string>): string => {
        return row[0] as string;
      })
      .filter((first: string): boolean => {
        return first.startsWith("**");
      })
      .flatMap((first: string): Array<string> => {
        return boldSpans(first);
      });

    expect(fields.length).toBeGreaterThanOrEqual(25);

    /*
     * The Runner field is the Runner picker's, which every step that runs on
     * a Runner draws (RunnerPicker); an SSH or kubectl step's own fields are
     * titled in the editor's model (RunbookStepEditorModel); every other
     * field is the Steps page's own.
     */
    expect(STEPS_PAGE).toContain("<RunnerPicker");

    for (const field of new Set(fields)) {
      expect({
        field,
        drawn:
          STEPS_PAGE.includes(`"${field}"`) ||
          STEP_EDITOR_MODEL.includes(`translationKey("${field}")`) ||
          RUNNER_PICKER.includes(`translateText("${field}")`),
      }).toEqual({
        field,
        drawn: true,
      });
    }
  });

  it("names the SSH and kubectl steps' fields, and what they fold under More fields", () => {
    const stepTypes: string = section(AUTHORING, "Step types");
    const ssh: string = stepTypes.slice(
      stepTypes.indexOf("### SSH\n"),
      stepTypes.indexOf("### kubectl\n"),
    );
    // The model as one line: prettier wraps a long translation key.
    const model: string = STEP_EDITOR_MODEL.replace(/\s+/g, " ");

    for (const [constant, words] of [
      ["SSH_TARGET_TITLE", "SSH to"],
      ["SSH_SIGN_IN_TITLE", "Sign in with"],
      ["SSH_PASSPHRASE_TITLE", "Key passphrase"],
      ["SSH_PORT_TITLE", "Port"],
      ["KUBECONFIG_TITLE", "Kubeconfig"],
      ["RUNNER_OWN_KUBECONFIG_LABEL", "The Runner's own access"],
    ] as Array<[string, string]>) {
      expect({
        constant,
        drawn:
          model.includes(`${constant}: string = translationKey("${words}");`) ||
          model.includes(
            `${constant}: string = translationKey( "${words}", );`,
          ),
      }).toEqual({ constant, drawn: true });
      expect(AUTHORING).toContain(`**${words}**`);
    }

    // The machine as people write it after ssh, its port folded, 22 by default.
    expect(STEP_EDITOR_MODEL).toContain(
      'export const SSH_TARGET_PLACEHOLDER: string = "deploy@10.0.4.21";',
    );
    expect(ssh).toContain(
      "| **SSH to** | The user and the machine, as you would write them after `ssh`: `deploy@10.0.4.21`. |",
    );
    expect(STEP_EDITOR_MODEL).toContain('key: "port",');
    expect(STEP_EDITOR_MODEL).toContain('key: "passphrase",');
    expect(STEPS_PAGE).toContain('placeholder="22"');
    expect(ssh).toContain(
      "| **Port** | Under **More fields**. 22 when left empty. |",
    );
    expect(ssh).toContain("| **Key passphrase** | Under **More fields**.");

    // The script runs with bash on the machine.
    expect(RUNNER_SSH_EXECUTOR).toContain(
      "return `bash -c ${shellQuote(script)}`;",
    );
    expect(ssh).toContain(
      "| **Bash script** | Runs with `bash` on the machine, as the user it signs in as.",
    );

    // Only secret variables are offered to sign in with.
    expect(AUTHORING).toContain("Only secret variables are offered");
  });

  it("says who writes runbooks: the roles that both create a runbook and save its steps", () => {
    const runbook: Runbook = new Runbook();
    const writers: Array<Permission> = roles(
      runbook.createRecordPermissions,
    ).filter((permission: Permission): boolean => {
      return runbook.updateRecordPermissions.includes(permission);
    });

    expect(englishList(writers.map(title), "and")).toBe(
      "Project Owner, Project Admin and Runbook Admin",
    );
    expect(granular(runbook.createRecordPermissions)).toEqual([
      Permission.CreateRunbook,
    ]);
    expect(granular(runbook.updateRecordPermissions)).toEqual([
      Permission.EditRunbook,
    ]);

    expect(AUTHORING).toContain(
      `Project Owner, Project Admin and Runbook Admin create runbooks and save their steps. With granular permissions, you need **${title(Permission.CreateRunbook)}** and **${title(Permission.EditRunbook)}**.`,
    );
  });

  it("says Project Owner and Project Admin create variables, and Runbook Admin picks them in its steps", () => {
    const variable: RunbookVariable = new RunbookVariable();

    expect(roles(variable.createRecordPermissions).map(title)).toEqual([
      "Project Owner",
      "Project Admin",
    ]);
    expect(variable.createRecordPermissions).not.toContain(
      Permission.RunbookAdmin,
    );
    expect(variable.readRecordPermissions).toContain(Permission.RunbookAdmin);

    expect(AUTHORING).toContain(
      "Project Owner and Project Admin create variables, and Runbook Admin picks them in the steps it writes.",
    );
  });
});

describe("a new runbook's first steps", () => {
  const list: string = readDashboard("Pages/Runbook/Runbooks.tsx");
  const overview: string = readDashboard(
    "Components/Runbook/RunbookOverviewState.ts",
  );

  it("open a new runbook on its Steps page, as the authoring guide says", () => {
    expect(list).toContain("modalType === ModalType.Create && item._id");
    expect(list).toContain("RouteMap[PageMap.RUNBOOK_VIEW_STEPS] as Route");
    expect(AUTHORING).toContain("The new runbook opens on its **Steps** page.");
    expect(AUTHORING).not.toContain(
      "The new runbook appears in the list: open it.",
    );
    expect(INDEX).toContain(
      "It opens on its **Steps**: add these steps, then click **Save Steps**:",
    );
  });

  it("say on the Overview why a runbook cannot run, with the button that fixes it", () => {
    expect(overview).toContain(
      'turnOnButton: translationKey("Turn on runbook"),',
    );
    expect(overview).toContain('addStepsButton: translationKey("Add Steps"),');
    expect(RUNNING).toContain(
      "Its **Overview** says which, with **Turn on runbook** or **Add Steps**.",
    );
  });
});

describe("runbook rules", () => {
  it("walk Create Runbook Rule through the form's steps", () => {
    /*
     * What the rule matches, then the runbooks it starts, from the shared
     * rule form (Utils/Form/EventRuleForm): no Basic Info step asks for a
     * name first.
     */
    expect(RULES_TABLE).toContain(
      "formSteps={getRunbookRuleFormSteps<RunbookRule>()}",
    );
    expect(RULES_TABLE).toContain(
      "...getRunbookRuleActionFields<RunbookRule>()",
    );
    expect(formSteps(RULES_TABLE)).toEqual([]);
    expect(RULES_TABLE).not.toContain('"Basic Info"');

    const stepsStart: number = EVENT_RULE_FORM.indexOf(
      "export const getRunbookRuleFormSteps",
    );
    const fieldsStart: number = EVENT_RULE_FORM.indexOf(
      "export const getRunbookRuleActionFields",
    );

    expect(stepsStart).toBeGreaterThan(0);
    expect(fieldsStart).toBeGreaterThan(0);
    expect(
      formSteps(EVENT_RULE_FORM.slice(stepsStart, stepsStart + 400)),
    ).toEqual(["Match", "Runbooks"]);

    const fields: string = EVENT_RULE_FORM.slice(
      fieldsStart,
      EVENT_RULE_FORM.indexOf("// ---- Privacy rules", fieldsStart),
    );

    expect(fields).toContain('title: "Runbooks to Start",');
    expect(fields).toContain(
      "onChange: followPicksWithRuleName<TEntity>(getRunbookRuleName),",
    );

    // A rule starts on; the switch is on its edit form only.
    const enabled: number = fields.indexOf('title: "Enabled",');

    expect(enabled).toBeGreaterThan(0);
    expect(fields.slice(enabled, enabled + 300)).toContain(
      "doNotShowWhenCreating: true,",
    );

    // The description waits under More fields.
    const description: number = fields.indexOf('title: "Description",');

    expect(description).toBeGreaterThan(0);
    expect(fields.slice(description, description + 300)).toContain(
      "collapsibleSection: moreFields,",
    );

    // The rule is named after its runbooks: "Start Database failover".
    expect(EVENT_RULE_FORM).toContain(
      'allPicks: translationKey("Start {{runbooks}}"),',
    );

    const create: string = section(RULES, "Create a runbook rule");

    expect(create).not.toContain("**Basic Info**");
    expect(create).not.toContain("### Name the rule");

    /*
     * Match Criteria asks what the rule applies to before any condition:
     * an incident rule's form says "All incidents" (the table passes its
     * trigger's subject), and the other answer opens the first condition.
     */
    const incidents: RuleCriteriaSubjectCopy = getRuleCriteriaSubjectCopy(
      RuleCriteriaSubject.Incidents,
    );

    expect(RULES_TABLE).toContain(
      "ruleCriteriaSubject={getRunbookRuleAppliesTo(props.triggerEntityType)}",
    );
    expect(create).toContain(
      `On **Match**, **${RuleCriteriaCopy.appliesToTitle}** starts on every new event of this kind, such as **${incidents.all}**, and the rule starts its runbooks for each one.`,
    );
    expect(create).toContain(
      `pick the other answer, such as **${incidents.matching}**, then pick a criterion and an operator`,
    );
    expect(create).toContain(
      `Click **${RuleCriteriaCopy.addCondition}** for more conditions`,
    );
    expect(create).not.toContain("Add none to start the runbooks");
    expect(create).toContain(
      'On **Runbooks**, choose one or more **Runbooks to Start**. The rule\'s **Name** follows them, such as "Start Database failover", until you type your own, and a **Description** waits under **More fields**. Click **Create Runbook Rule**. The rule is on as soon as it is created, and it appears in the list with the status **Enabled**.',
    );
    expect(RULES).toContain(
      "| **Conditions** | What the rule matches, on the **Match** step.",
    );
    expect(RULES).toContain(
      "| **Description** | Optional context for teammates, under **More fields**. |",
    );
    expect(RULES).toContain(
      "| **Enabled** | On for a new rule. Switch it off on the rule's edit form to suspend it without deleting it. |",
    );
  });

  it("names the operators a list and a text condition offer, and the ones a new condition starts on", () => {
    const list: Field<RunbookRule> = {
      field: { monitors: true },
      title: "Monitors",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
    };
    const text: Field<RunbookRule> = {
      field: { titlePattern: true },
      title: "Incident Title",
      fieldType: FormFieldSchemaType.Text,
    };
    const label: (operator: RuleCriteriaOperator) => string = (
      operator: RuleCriteriaOperator,
    ): string => {
      return `**${RULE_CRITERIA_OPERATOR_LABELS[operator]}**`;
    };

    const listOperators: Array<string> =
      getRuleCriteriaOperatorsForField(list).map(label);
    const textOperators: Array<string> =
      getRuleCriteriaOperatorsForField(text).map(label);

    const conditions: string = section(RULES, "Conditions");

    expect(conditions).toContain(
      `uses ${englishList(listOperators, "or")} the values you pick.`,
    );

    // Text: the six plain operators, then the pattern pair after "or".
    expect(textOperators.slice(-2)).toEqual([
      "**Matches pattern**",
      "**Does not match pattern**",
    ]);
    expect(conditions).toContain(
      `uses ${textOperators[0]} (where a new condition starts), ${textOperators.slice(1, -2).join(", ")}, or ${textOperators[6]} / ${textOperators[7]} for a case-insensitive regular expression or a \`*\` wildcard.`,
    );

    expect(label(getDefaultRuleCriteriaOperator(text))).toBe("**Contains**");
    expect(label(getDefaultRuleCriteriaOperator(list))).toBe(listOperators[0]);
  });

  it("match text without regard to case, as the page's example pattern does", () => {
    const example: RegExpMatchArray | null = RULES.match(
      /Conditions: {2}Incident Title matches pattern (\S+)\n/,
    );

    expect(example).not.toBeNull();

    const pattern: string = example![1] as string;

    expect(
      RulePatternMatchUtil.matches("db-primary connection timeout", pattern),
    ).toBe(true);
    expect(RulePatternMatchUtil.matches("Postgres replica lag", pattern)).toBe(
      true,
    );
    expect(RulePatternMatchUtil.matches("Checkout API latency", pattern)).toBe(
      false,
    );
    expect(RulePatternMatchUtil.matches("DB-PRIMARY DOWN", "db-primary")).toBe(
      true,
    );

    expect(RULES).toContain("Text comparisons ignore case.");
  });

  it("quote the refusal of another product's severity as the service words it", () => {
    const refusal: string | null = getRunbookRuleCriteriaProblem({
      triggerEntityType: RunbookRuleTriggerEntity.Incident,
      values: { alertSeverities: ["5f8b7c0e9d3a4b2c1d0e9f8a"] },
    });

    expect(refusal).toBe(
      "Alert Severities can only be used by alert runbook rules.",
    );
    expect(
      getRunbookRuleCriteriaProblem({
        triggerEntityType: RunbookRuleTriggerEntity.Alert,
        values: { alertSeverities: ["5f8b7c0e9d3a4b2c1d0e9f8a"] },
      }),
    ).toBeNull();

    expect(RULES).toContain(`with a message such as "${refusal}"`);
    expect(RULES).toContain(
      "A condition on another product's severity — **Alert Severities** on an incident rule, say — can never be true, so the API refuses to save it.",
    );
  });

  it("say who creates runbook rules", () => {
    const rule: RunbookRule = new RunbookRule();

    expect(
      englishList(roles(rule.createRecordPermissions).map(title), "and"),
    ).toBe("Project Owner, Project Admin and Runbook Admin");
    expect(granular(rule.createRecordPermissions)).toEqual([
      Permission.CreateRunbookRule,
    ]);
    expect(RULES).toContain(
      `Project Owner, Project Admin and Runbook Admin create runbook rules, as does anyone with the **${title(Permission.CreateRunbookRule)}** permission.`,
    );
  });
});

describe("runbook variables", () => {
  /*
   * Runbooks > Runners > AI Access held the runbook credentials OneUptime
   * AI's own commands reached a host or a cluster with. It is gone, with
   * its page, its docs page and the credentials: a step signs in with a
   * secret variable, and a step that still names a credential is turned
   * into a script step on its Steps page.
   */
  it("say runbook steps sign in with variables, and that runbook credentials were removed", () => {
    for (const gone of [
      "App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerCredentials.tsx",
      "App/FeatureSet/Dashboard/src/Components/Runner/RunnerCredentialSignIn.ts",
      "App/FeatureSet/Runbook/Utils/Credentials.ts",
      "App/FeatureSet/Docs/Content/en/runbooks/credentials.md",
    ]) {
      expect({
        gone,
        exists: fs.existsSync(path.join(PACKAGES_DIR, gone)),
      }).toEqual({
        gone,
        exists: false,
      });
    }

    expect(VARIABLES).toContain(
      "Runbook credentials were removed since, and a step that still named one was moved the same way first.",
    );
    expect(VARIABLES).toContain(
      "[Runbook credentials are removed](/docs/installation/upgrading#runbook-credentials-are-removed)",
    );

    for (const markdown of Object.values(PAGES)) {
      expect(markdown).not.toContain("/docs/runbooks/credentials");
      expect(markdown).not.toContain("**Create Credential**");
    }
  });

  it("connect an SSH step to port 22 when its port is left empty", () => {
    expect(RUNBOOK_JOB_VARIABLES).toMatch(
      /typeof payload\["port"\] === "number" && payload\["port"\] > 0\s*\?\s*\(payload\["port"\] as number\)\s*:\s*22;/,
    );
    expect(RUNNER_SSH_EXECUTOR).toContain(
      'Number(data.credential["port"] || 22)',
    );

    expect(AUTHORING).toContain(
      "| **Port** | Under **More fields**. 22 when left empty. |",
    );
  });

  /*
   * An SSH step may name the machine's host keys (SSHStepConfig.hostKey):
   * the Runner hands ssh2 a host verifier and signs in only when the
   * machine presents one of them; a step that names none says in its
   * output which key the machine presented. A Runner that does not say it
   * checks them ("ssh-host-key") is never handed such a step.
   */
  it("say an SSH step checks the machine's host key when it names one, under More fields", () => {
    expect(STEP_EDITOR_MODEL).toContain(
      'SSH_HOST_KEY_TITLE: string = translationKey("Host key");',
    );
    expect(RUNNER_SSH_EXECUTOR).toContain(
      "hostVerifier: (key: Buffer): boolean => {",
    );
    expect(RUNNER_SSH_EXECUTOR).toContain(
      "The machine's host key was not checked: it presented",
    );
    expect(readSource("Common/Types/Runbook/RunnerFeatures.ts")).toContain(
      'export const RUNNER_FEATURE_SSH_HOST_KEY: string = "ssh-host-key";',
    );
    expect(RUNNER_INGRESS).toContain(
      "RunnerIngressAPI.SSH_HOST_KEY_NEEDS_NEWER_RUNNER",
    );

    expect(AUTHORING).toContain(
      "| **Host key** | Under **More fields**. The machine's SHA256 fingerprint, or its public key as `ssh-keyscan` prints it, one per line. The step signs in only when the machine presents one of them. Left empty, any key is accepted, and the step's output names the one the machine presented. |",
    );
    expect(AUTHORING).toContain(
      "A step that names one fails on a Runner too old to check it, saying to update the Runner.",
    );
    expect(CONFIGURATION).toContain(
      "- **SSH steps** sign in only when the machine presents one of the host keys the step names. A step that names none accepts any key, and its output names the one the machine presented, to name in the step.",
    );
  });

  it("say who manages variables, which Runbook Admin does not", () => {
    const model: RunbookVariable = new RunbookVariable();

    expect(model.createRecordPermissions).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookSecret,
    ]);
    expect(model.createRecordPermissions).not.toContain(
      Permission.RunbookAdmin,
    );
    expect(VARIABLES).toContain(
      `Project Owner and Project Admin, or the **${title(Permission.CreateRunbookSecret)}** permission. Runbook Admin reads variables, to pick them in the steps it writes, but does not change them.`,
    );

    // The runbook secret permissions kept their names, and say variables now.
    expect(title(Permission.CreateRunbookSecret)).toBe(
      "Create Runbook Variable",
    );
    expect(new RunbookVariable().readRecordPermissions).toContain(
      Permission.RunbookAdmin,
    );
  });

  it("say variables need the Growth plan on OneUptime Cloud", () => {
    const model: RunbookVariable = new RunbookVariable();

    expect(model.createBillingPlan).toBe(PlanType.Growth);
    expect(model.readBillingPlan).toBe(PlanType.Growth);
    expect(VARIABLES).toContain(
      "On OneUptime Cloud, runbook variables need the **Growth** plan or above.",
    );
  });

  it("walk Create Variable through the form's steps and fields", () => {
    for (const [constant, words] of [
      ["VARIABLE_STEP_TITLE", "Variable"],
      ["ACCESS_STEP_TITLE", "Who can use it"],
      ["SECRET_TITLE", "Secret"],
      ["VALUE_TITLE", "Value"],
      ["SECRET_VALUE_TITLE", "Secret Value"],
      ["YOUR_RUNNERS_TITLE", "Your Runners that can use it"],
      // Asked only on a server with global Runners.
      ["GLOBAL_RUNNERS_CAN_USE_TITLE", "Global Runners can use it"],
      ["REPLACE_VALUE_TITLE", "Replace Value"],
    ] as Array<[string, string]>) {
      const copy: string = VARIABLE_COPY.replace(/\s+/g, " ");

      expect({
        constant,
        drawn:
          copy.includes(`${constant}: string = translationKey("${words}");`) ||
          copy.includes(`${constant}: string = translationKey( "${words}", );`),
      }).toEqual({ constant, drawn: true });
      expect(VARIABLES).toContain(`**${words}**`);
    }

    // The form: what the variable is, then who may use a secret.
    expect(VARIABLES_TABLE).toContain(
      '{ title: VARIABLE_STEP_TITLE, id: "variable" },',
    );
    expect(VARIABLES_TABLE).toContain("title: ACCESS_STEP_TITLE,");
    expect(VARIABLES_TABLE).toContain('singularName="Variable"');
    expect(VARIABLES).toContain("click **Create Variable**");

    // A name: letters, numbers, hyphens and underscores, up to 100 characters.
    expect(RUNBOOK_VARIABLE_NAME_MAX_LENGTH).toBe(100);
    expect(isValidRunbookVariableName("PROD_DB_SSH_KEY")).toBe(true);
    expect(isValidRunbookVariableName("prod-db.key")).toBe(false);
    expect(isValidRunbookVariableName("x".repeat(101))).toBe(false);
    expect(VARIABLES).toContain(
      "enter a **Name**: letters, numbers, hyphens and underscores, up to 100 characters, such as `PROD_DB_SSH_KEY`.",
    );

    // A new variable starts secret, open to global Runners while the project uses them.
    expect(VARIABLES_TABLE).toContain("isSecret: true,");
    expect(VARIABLES_TABLE).toContain(
      "hasGlobalRunners && globalRunnerAccess.projectUsesGlobalRunners,",
    );
    expect(VARIABLES).toContain("**Secret** starts on");
    expect(VARIABLES).toContain(
      "it starts on while the project uses global Runners.",
    );
  });

  it("write a variable the way a step names it", () => {
    expect(
      formatRunbookVariableReference({
        scope: RunbookVariableScope.Global,
        name: "NAME",
      }),
    ).toBe("{{global.variables.NAME}}");
    expect(
      formatRunbookVariableReference({
        scope: RunbookVariableScope.Local,
        name: "NAME",
      }),
    ).toBe("{{local.variables.NAME}}");

    expect(VARIABLES).toContain(
      "| Written in a step as | `{{global.variables.NAME}}` | `{{local.variables.NAME}}` |",
    );
    expect(INDEX).toContain(
      "`{{global.variables.NAME}}` for one of the project's",
    );
  });

  it("hide a step's secrets in its output, as the Runner and the server do", () => {
    expect(REDACTED_SECRET_TEXT).toBe("[REDACTED]");
    expect(MIN_REDACTED_SECRET_LENGTH).toBe(4);

    expect(VARIABLES).toContain(
      "the Runner replaces it with `[REDACTED]` before the output leaves its host, and OneUptime does again before it stores the output.",
    );
    expect(VARIABLES).toContain(
      "A secret shorter than 4 characters is not looked for.",
    );
  });

  /*
   * An HTTP request step names variables as a script does, in its URL, its
   * headers and its body. OneUptime sends it itself, from the Worker - no
   * Runner's list applies - so it is given every variable it names, a
   * secret too, and hides each secret in what it records.
   */
  it("say an HTTP request step fills in every variable it names, secrets too, and hides them in what it records", () => {
    expect(
      getHttpStepVariableTexts({ url: "u", headersJson: "h", body: "b" }),
    ).toEqual(["u", "h", "b"]);

    const httpStep: string = STEP_EXECUTORS.slice(
      STEP_EXECUTORS.indexOf("export async function runHttpStep("),
    ).replace(/\s+/g, " ");

    expect(httpStep).toContain(
      'access: { kind: "server" }, includeValues: true,',
    );
    expect(httpStep).toContain("redactHttpStepSecrets(text, secretValues)");
    expect(RUN_RUNBOOK).toContain("return runHttpStep(step, ctx);");

    // In JSON, a value goes inside its string: a quote in it keeps the JSON whole.
    expect(
      JSON.parse(
        fillHttpStepJsonText(
          '{ "Authorization": "Bearer {{global.variables.API_TOKEN}}" }',
          (): string => {
            return 'sk_"live';
          },
        ),
      ),
    ).toEqual({ Authorization: 'Bearer sk_"live' });
    expect(redactHttpStepSecrets("echo sk_live_8f2a", ["sk_live_8f2a"])).toBe(
      `echo ${REDACTED_SECRET_TEXT}`,
    );

    expect(VARIABLES).toContain(
      "Bash, JavaScript, SSH, kubectl and HTTP request steps use variables. AI steps do not fill them in. OneUptime sends an HTTP request step itself, without a Runner, so the step gets every variable it names, secrets too, and hides them in the response it records.",
    );
    expect(VARIABLES).toContain(
      "| OneUptime itself, for an HTTP request step | Always | Always |",
    );
    // The hardening notes say it too, beside the Runners a secret is handed to.
    expect(CONFIGURATION).toContain(
      "An HTTP request step, which OneUptime sends itself, is given every secret of its own project that it names, and hides them in the response it records.",
    );
    expect(VARIABLES).toContain(
      '{ "Authorization": "Bearer {{global.variables.API_TOKEN}}" }',
    );
    expect(AUTHORING).toContain(
      "OneUptime sends the request itself, so it fills in secrets too, and the response the step records shows `[REDACTED]` in their place. In JSON headers or a JSON body, a value goes inside its string, so a quote or a line break in it does not break the JSON.",
    );
  });
});

describe("the runbook pages' configuration reference", () => {
  it("say how many executions a Worker runs at once", () => {
    expect(RUNBOOK_FEATURE_INDEX).toContain("concurrency: 25,");
    expect(CONFIGURATION).toContain(
      "Each Worker process runs up to 25 executions at once; the number is fixed in the code",
    );
  });

  it("give only menu paths the Runbooks side menu has", () => {
    const sections: Array<MenuSection> = runbookMenuSections();

    // The Runners sit with the runbooks since AI Access went.
    expect(sections.slice(0, 2)).toEqual([
      { title: "Runbooks", items: ["Runbooks", "Executions", "Runners"] },
      {
        title: "Settings",
        items: ["Global Variables", "Owner Rules", "Label Rules"],
      },
    ]);

    const paths: Set<string> = new Set();

    for (const markdown of Object.values(PAGES)) {
      for (const span of boldSpans(markdown)) {
        if (span.startsWith("Runbooks → ")) {
          paths.add(span);
        }
      }
    }

    expect(Array.from(paths).sort()).toEqual([
      "Runbooks → Executions",
      "Runbooks → Runners",
      "Runbooks → Settings",
      "Runbooks → Settings → Global Variables",
    ]);

    for (const menuPath of paths) {
      const segments: Array<string> = menuPath.split(" → ").slice(1);
      const first: string = segments[0] as string;
      const sectionOfFirst: MenuSection | undefined = sections.find(
        (candidate: MenuSection): boolean => {
          return candidate.title === first;
        },
      );
      const isItem: boolean = sections.some(
        (candidate: MenuSection): boolean => {
          return candidate.items.includes(first);
        },
      );

      expect({ menuPath, found: Boolean(sectionOfFirst) || isItem }).toEqual({
        menuPath,
        found: true,
      });

      if (segments.length === 2) {
        expect({
          menuPath,
          inSection: sectionOfFirst?.items.includes(segments[1] as string),
        }).toEqual({ menuPath, inSection: true });
      }
    }
  });
});

/*
 * The Runbook Triggers page: a runbook's schedule and its webhook, held to
 * the shared constants and messages the dialog, the Worker and the webhook
 * route read, the dashboard's own words (read as text), and the schedule
 * arithmetic itself on the nights the clocks change.
 */
describe("runbook triggers", () => {
  const WEBHOOK_ROUTE: string = readSource(
    "App/FeatureSet/Runbook/API/RunbookWebhook.ts",
  );
  const TRIGGERS_COPY: string = readDashboard(
    "Components/Runbook/Triggers/RunbookTriggersCopy.ts",
  );
  const VIEW_SIDE_MENU: string = readDashboard(
    "Pages/Runbook/View/SideMenu.tsx",
  );
  // The copy with its line breaks as spaces: prettier wraps a long key.
  const TRIGGERS_COPY_TEXT: string = TRIGGERS_COPY.replace(/\s+/g, " ");

  // Whether the dashboard's copy has this English as a translation key.
  const isTriggersKey: (english: string) => boolean = (
    english: string,
  ): boolean => {
    return (
      TRIGGERS_COPY_TEXT.includes(`translationKey("${english}")`) ||
      TRIGGERS_COPY_TEXT.includes(`translationKey( "${english}", )`)
    );
  };

  it("offer the minute and hour steps the dialog offers", () => {
    expect(TRIGGERS).toContain(
      `| **Every few minutes** | **Every**: ${englishList(RUNBOOK_SCHEDULE_MINUTE_INTERVALS.map(String), "or")} minutes |`,
    );
    expect(TRIGGERS).toContain(
      `| **Every few hours** | **Every**: ${englishList(RUNBOOK_SCHEDULE_HOUR_INTERVALS.map(String), "or")} hours, and **Minutes past the hour** |`,
    );
  });

  it("name every Repeat choice, policy and field as the dashboard words it", () => {
    for (const label of [
      "Every few minutes",
      "Every few hours",
      "Every day",
      "On days of the week",
      "Custom (cron expression)",
      "Skip that time",
      "Run after it ends",
      "Run once when OneUptime is back",
      "Skip the missed times",
      "If a run is still going",
      "If OneUptime missed a time",
      "Minutes past the hour",
      "Time of day",
      "On these days",
      "Cron expression",
      "Set Up Schedule",
      "Save Schedule",
      "Edit Schedule",
      "Run on this schedule",
      "Run when this URL is called",
      "Webhook URL",
      "Copy URL",
      "Send Test Request",
      "Reset URL",
    ]) {
      expect({ label, drawn: isTriggersKey(label) }).toEqual({
        label,
        drawn: true,
      });
      expect(TRIGGERS).toContain(`**${label}**`);
    }
  });

  it("say the defaults the dialog starts a schedule on", () => {
    expect(DEFAULT_RUNBOOK_SCHEDULE_OVERLAP_POLICY).toBe(
      RunbookScheduleOverlapPolicy.Skip,
    );
    expect(DEFAULT_RUNBOOK_SCHEDULE_MISSED_RUN_POLICY).toBe(
      RunbookScheduleMissedRunPolicy.RunOnce,
    );
    expect(TRIGGERS).toContain("| **Skip that time** (default) |");
    expect(TRIGGERS).toContain(
      "| **Run once when OneUptime is back** (default) |",
    );
  });

  it("say when a scheduled time counts as missed", () => {
    expect(RUNBOOK_SCHEDULE_MISSED_RUN_GRACE_IN_MS).toBe(5 * 60 * 1000);
    expect(TRIGGERS).toContain(
      `the time is missed once it is more than ${RUNBOOK_SCHEDULE_MISSED_RUN_GRACE_IN_MS / 60000} minutes late`,
    );
  });

  it("describe the nights the clocks change as the schedule works them out", () => {
    // Europe/London goes forward at 01:00 GMT on 29 March 2026: 01:30 does not exist.
    expect(
      getNextRunbookRuns({
        cron: "30 1 * * *",
        timezone: "Europe/London",
        after: new Date("2026-03-28T12:00:00.000Z"),
        count: 1,
      })[0]!.toISOString(),
    ).toBe("2026-03-29T01:30:00.000Z"); // 02:30 BST: an hour later on the clock

    // And back at 02:00 BST on 25 October 2026: 01:30 comes twice.
    const after: Date = new Date("2026-10-24T23:50:00.000Z");
    const hourly: Array<string> = getNextRunbookRuns({
      cron: "30 * * * *",
      timezone: "Europe/London",
      after,
      count: 3,
    }).map((run: Date): string => {
      return run.toISOString();
    });
    expect(hourly).toEqual([
      "2026-10-25T00:30:00.000Z", // 01:30 BST
      "2026-10-25T01:30:00.000Z", // 01:30 GMT, the hour again
      "2026-10-25T02:30:00.000Z",
    ]);

    const daily: Array<string> = getNextRunbookRuns({
      cron: "30 1 * * *",
      timezone: "Europe/London",
      after,
      count: 2,
    }).map((run: Date): string => {
      return run.toISOString();
    });
    expect(daily).toEqual([
      "2026-10-25T00:30:00.000Z",
      "2026-10-26T01:30:00.000Z",
    ]);

    expect(TRIGGERS).toContain(
      "a time that does not exist that night runs an hour later on the clock",
    );
    expect(TRIGGERS).toContain(
      "a schedule that runs every hour runs in both, and any other schedule runs once, at the first",
    );
  });

  it("give the webhook's limits as the route enforces them", () => {
    expect(TRIGGERS).toContain(
      `| \`413\` | The body is larger than ${RUNBOOK_WEBHOOK_MAX_BODY_BYTES / 1024} KB. |`,
    );
    expect(RUNBOOK_INPUTS_MAX_BYTES).toBe(RUNBOOK_WEBHOOK_MAX_BODY_BYTES);
    expect(TRIGGERS).toContain(
      `is nested more than ${RUNBOOK_INPUTS_MAX_DEPTH} levels deep`,
    );
    expect(TRIGGERS).toContain(
      `The webhook started ${RUNBOOK_WEBHOOK_RUNS_PER_MINUTE} runs in the last minute, ${RUNBOOK_WEBHOOK_MAX_ACTIVE_RUNS} of its runs are still going, or one address made more than ${RUNBOOK_WEBHOOK_CALLS_PER_ADDRESS_PER_MINUTE} calls to runbook webhooks in a minute, or the addresses of one IPv6 /64 more than ${getIpv6NetworkRateLimit(RUNBOOK_WEBHOOK_CALLS_PER_ADDRESS_PER_MINUTE)} together.`,
    );
    expect(TRIGGERS).toContain(
      `The key is ${RUNBOOK_WEBHOOK_SECRET_KEY_LENGTH} random characters`,
    );
  });

  it("answer each refusal with the status the page names", () => {
    const answers: Array<[string, number]> = [
      ["BadDataException", 400],
      ["ForbiddenException", 403],
      ["NotFoundException", 404],
      ["PayloadTooLargeException", 413],
      ["TooManyRequestsException", 429],
      ["ServiceUnavailableException", 503],
    ];

    for (const [exception, status] of answers) {
      expect({
        exception,
        used: WEBHOOK_ROUTE.includes(`new ${exception}(`),
      }).toEqual({
        exception,
        used: true,
      });
      expect(
        (ExceptionCode as unknown as Record<string, number>)[exception],
      ).toBe(status);
      expect(TRIGGERS).toContain(`| \`${status}\` |`);
    }

    // A GET is answered 405 before anything is looked up.
    expect(WEBHOOK_ROUTE).toContain("{ statusCode: new StatusCode(405) }");
    expect(TRIGGERS).toContain("| `405` | The request is a `GET`.");
  });

  it("quote the webhook's and the API's refusals as they are written", () => {
    expect(TRIGGERS).toContain(`"${RunbookWebhookMessages.runbookOff}"`);

    for (const [message, sentence] of [
      [
        RunbookWebhookMessages.notFound,
        "No runbook webhook answers at this URL.",
      ],
      [
        RunbookWebhookMessages.webhookOff,
        "This runbook's webhook is turned off, so the runbook was not started.",
      ],
      [
        RUNBOOK_TRIGGER_REFUSED_MESSAGE,
        "You do not have permission to set up this runbook's schedule or webhook.",
      ],
    ] as Array<[string, string]>) {
      expect(message.startsWith(sentence)).toBe(true);
      expect(TRIGGERS).toContain(`"${sentence}"`);
    }
  });

  it("name the variables a Bash step gets, and how a name is written", () => {
    expect(TRIGGERS).toContain(`\`${RUNBOOK_INPUT_VARIABLE_PREFIX}<NAME>\``);
    expect(TRIGGERS).toContain(`\`${RUNBOOK_INPUTS_VARIABLE}\``);
    expect(TRIGGERS).toContain(`\`${RUNBOOK_TRIGGER_VARIABLE}\``);
    expect(getRunbookInputVariableName("host-name")).toBe(
      "ONEUPTIME_INPUT_HOST_NAME",
    );
    expect(TRIGGERS).toContain(
      "`host-name` becomes `ONEUPTIME_INPUT_HOST_NAME`",
    );
    expect(TRIGGERS).toContain(
      `A step gets at most ${RUNBOOK_INPUT_MAX_VARIABLES} of these variables, and a name longer than ${RUNBOOK_INPUT_MAX_NAME_LENGTH} characters becomes none`,
    );
    expect(
      getRunbookInputVariableName(
        "x".repeat(RUNBOOK_INPUT_MAX_NAME_LENGTH + 1),
      ),
    ).toBe(null);
    expect(
      Object.keys(
        getRunbookInputVariables({
          inputs: Object.fromEntries(
            Array.from(
              { length: RUNBOOK_INPUT_MAX_VARIABLES + 5 },
              (_: unknown, i: number) => {
                return [`v${i}`, i];
              },
            ),
          ),
          trigger: "Webhook",
        }),
      ).filter((name: string): boolean => {
        return name.startsWith(RUNBOOK_INPUT_VARIABLE_PREFIX);
      }),
    ).toHaveLength(RUNBOOK_INPUT_MAX_VARIABLES);
  });

  it("say who may set triggers up: the trigger columns' editors who also run runbooks", () => {
    const runbook: Runbook = new Runbook();

    for (const column of RUNBOOK_TRIGGER_COLUMNS) {
      const access: ColumnAccessControl | null =
        runbook.getColumnAccessControlFor(column);

      expect({ column, update: access?.update }).toEqual({
        column,
        update: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.EditRunbook,
          Permission.RunbookAdmin,
        ],
      });
    }

    for (const runs of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.RunbookAdmin,
      Permission.ProjectMember,
      Permission.RunbookMember,
      Permission.CreateRunbookExecution,
    ]) {
      expect(RUNBOOK_RUN_PERMISSIONS).toContain(runs);
    }

    expect(TRIGGERS).toContain(
      `${title(Permission.ProjectOwner)}, ${title(Permission.ProjectAdmin)} or ${title(Permission.RunbookAdmin)}, or **${title(Permission.EditRunbook)}** together with ${title(Permission.ProjectMember)}, ${title(Permission.RunbookMember)} or **${title(Permission.CreateRunbookExecution)}**.`,
    );
  });

  it("find the page from the runbook's menu, and the dashboard's links on its headings", () => {
    expect(VIEW_SIDE_MENU).toContain('title: "Triggers"');
    // In the menu's folded Settings section: see "a runbook's own side menu".
    expect(TRIGGERS).toContain(
      "click **Settings → Triggers** in its side menu.",
    );

    for (const heading of ["Run on a schedule", "Call the webhook"]) {
      expect(TRIGGERS).toContain(`\n## ${heading}\n`);
    }

    expect(TRIGGERS_COPY).toContain(
      '"/docs/runbooks/triggers#run-on-a-schedule"',
    );
    expect(TRIGGERS_COPY).toContain(
      '"/docs/runbooks/triggers#call-the-webhook"',
    );
  });
});

/*
 * A runbook's own side menu (Pages/Runbook/View/SideMenu.tsx), as the
 * overview tables it and the other pages give paths into it. The maintainer
 * asked for it to show as little as possible: Executions under a folded Logs
 * section, Triggers under a folded Settings section. So Basic is the only
 * section open, and a page in another section is named by its path, with the
 * section that has to be opened first.
 */
describe("a runbook's own side menu", () => {
  const VIEW_MENU_SOURCE: string = readDashboard(
    "Pages/Runbook/View/SideMenu.tsx",
  );

  // The menu, its Developer section put where the menu adds it.
  const viewMenu: Array<DashboardMenuSection> = menuSections(VIEW_MENU_SOURCE, {
    "{getDeveloperSideMenuSection(": developerSection(),
  });

  const sectionTitles: Array<string> = viewMenu.map(
    (menuSection: DashboardMenuSection): string => {
      return menuSection.title;
    },
  );

  const TABLE_HEADER: string = "| Section | Pages |";

  /*
   * The overview's table of the menu: each row a section, in bold, and its
   * pages, in bold, in the order the menu draws them.
   */
  function overviewMenuTable(): Array<DashboardMenuSection> {
    const where: string = section(
      INDEX,
      "Where runbooks live in the dashboard",
    );
    const start: number = where.indexOf(TABLE_HEADER);

    expect({ table: TABLE_HEADER, found: start >= 0 }).toEqual({
      table: TABLE_HEADER,
      found: true,
    });

    return tableRows(where.slice(start)).map(
      (row: Array<string>): DashboardMenuSection => {
        return {
          title: boldSpans(row[0] || "")[0] || "",
          items: boldSpans(row[1] || ""),
        };
      },
    );
  }

  // Every "X → Y" path on the runbook pages that starts at a section of this menu.
  function pathsIntoTheMenu(): Array<string> {
    const paths: Set<string> = new Set();

    for (const markdown of Object.values(PAGES)) {
      for (const span of boldSpans(markdown)) {
        const first: string = span.split(" → ")[0] as string;

        if (span.includes(" → ") && sectionTitles.includes(first)) {
          paths.add(span);
        }
      }
    }

    return Array.from(paths).sort();
  }

  it("is read with each section and page the menu draws, in order", () => {
    expect(viewMenu).toEqual([
      { title: "Basic", items: ["Overview", "Steps"] },
      { title: "Logs", items: ["Executions"] },
      { title: "Owners", items: ["Owners"] },
      { title: "Settings", items: ["Triggers", "Variables", "Settings"] },
      { title: "Developer", items: ["Terraform", "API", "AI Assistants"] },
      { title: "Advanced", items: ["Audit Logs", "Delete Runbook"] },
    ]);
  });

  it("is tabled on the overview section by section and page by page", () => {
    expect(overviewMenuTable()).toEqual(viewMenu);
  });

  it("starts with only Basic open, as the overview says", () => {
    const open: Array<string> = sectionTitles.filter(
      (title: string): boolean => {
        return !startsCollapsed(VIEW_MENU_SOURCE, title);
      },
    );

    expect(open).toEqual(["Basic"]);
    expect(INDEX).toContain(
      "Only **Basic** starts open: click a section's title to open it. A section opens by itself on any page inside it.",
    );
  });

  it("names the runs and the triggers by the folded sections that hold them", () => {
    expect(RUNNING).toContain(
      "| A runbook's **Logs → Executions** | Every run of that runbook,",
    );
    expect(TRIGGERS).toContain(
      "Open the runbook from **Runbooks**, and click **Settings → Triggers** in its side menu. **Settings** starts folded: click it to show **Triggers**.",
    );

    for (const [sectionTitle, page] of [
      ["Logs", "Executions"],
      ["Settings", "Triggers"],
    ] as Array<[string, string]>) {
      expect({
        sectionTitle,
        pages: sectionByTitle(viewMenu, sectionTitle).items,
        folded: startsCollapsed(VIEW_MENU_SOURCE, sectionTitle),
      }).toEqual({
        sectionTitle,
        pages: expect.arrayContaining([page]),
        folded: true,
      });
    }
  });

  it("gives every path into it as the menu has it", () => {
    const paths: Array<string> = pathsIntoTheMenu();

    expect(paths).toEqual([
      "Logs → Executions",
      "Settings → Triggers",
      "Settings → Variables",
    ]);

    for (const menuPath of paths) {
      const [sectionTitle, page] = menuPath.split(" → ") as [string, string];

      expect({
        menuPath,
        inSection: sectionByTitle(viewMenu, sectionTitle).items.includes(page),
      }).toEqual({ menuPath, inSection: true });
    }
  });

  it("no longer says Executions or Triggers are a click away in the menu", () => {
    for (const [name, markdown] of Object.entries(PAGES)) {
      expect({ page: name, says: markdown.includes("in its menu") }).toEqual({
        page: name,
        says: false,
      });
    }
  });
});
