import { readPage } from "./DocsContentSupport";
import { boldSpans } from "./DocsTranslationChecks";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookCredential from "Common/Models/DatabaseModels/RunbookCredential";
import RunbookRule from "Common/Models/DatabaseModels/RunbookRule";
import RunbookSecret from "Common/Models/DatabaseModels/RunbookSecret";
import Runner from "Common/Models/DatabaseModels/Runner";
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
  KubernetesAction,
  KubernetesWorkloadKind,
} from "Common/Types/Runbook/RunbookStep";
import RunbookStepExecutionStatus from "Common/Types/Runbook/RunbookStepExecutionStatus";
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
import RunnerLiveStatus, {
  getRunnerLiveStatus,
  getRunnerLiveStatusLabel,
  RUNNER_ALIVE_WINDOW_IN_MINUTES,
} from "Common/Types/Runner/RunnerLiveStatus";
import { RuleCriteriaOperator } from "Common/Types/Rules/RuleCriteria";
import {
  getDefaultRuleCriteriaOperator,
  getRuleCriteriaOperatorsForField,
  RULE_CRITERIA_OPERATOR_LABELS,
} from "Common/UI/Components/RuleCriteria/RuleCriteriaFields";
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
 * AgentVersionSignDocs, CredentialsReachAiRunnersDocs, RunnersUnderRunbooksDocs,
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
const CREDENTIALS: string = readPage("en", "runbooks/credentials");
const CONFIGURATION: string = readPage("en", "runbooks/configuration");

const PAGES: Record<string, string> = {
  index: INDEX,
  authoring: AUTHORING,
  running: RUNNING,
  rules: RULES,
  agents: AGENTS,
  credentials: CREDENTIALS,
  configuration: CONFIGURATION,
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
const RUNBOOK_CREDENTIALS_UTIL: string = readSource(
  "App/FeatureSet/Runbook/Utils/Credentials.ts",
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
const RUNNER_KUBERNETES_EXECUTOR: string = readSource(
  "Runner/Services/KubernetesExecutor.ts",
);

const STEPS_PAGE: string = readDashboard("Pages/Runbook/View/Steps.tsx");
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
const CREDENTIALS_PAGE: string = readDashboard(
  "Pages/Runbook/Runners/RunnerCredentials.tsx",
);
const SECRETS_PAGE: string = readDashboard("Pages/Runbook/Secrets.tsx");
const RULES_TABLE: string = readDashboard(
  "Components/Runbook/RunbookRulesTable.tsx",
);

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
    // JavaScript, HTTP request, Bash, SSH and Kubernetes, and the agents table.
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
      "| Execution timeout | **30 seconds** by default | JavaScript, Bash, SSH and Kubernetes steps |",
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
    // The HTTP request step runs with the step timeout too.
    expect(STEP_EXECUTORS).toContain(
      "const timeout: number = resolveStepExecutionTimeoutInMs(config.timeoutInMs);",
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
      "these env vars are a local\n * override that can only ever turn a capability OFF.",
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

  it("walks Create Runner through the form's steps, with the capabilities' defaults", () => {
    expect(formSteps(RUNNER_FORM_FIELDS)).toEqual(["Runner", "Capabilities"]);

    const capability: RegExp =
      /title: "(Runs [^"]+)",\s*\.\.\.onStep\("capabilities"\),[\s\S]*?defaultValue: (true|false),/g;
    const defaults: Array<[string, boolean]> = Array.from(
      RUNNER_FORM_FIELDS.matchAll(capability),
    ).map((match: RegExpMatchArray): [string, boolean] => {
      return [match[1] as string, match[2] === "true"];
    });

    expect(defaults).toEqual([
      ["Runs Runbooks", true],
      ["Runs AI Code Fixes", false],
      ["Runs AI Remediation Commands", false],
    ]);

    const setup: string = section(AGENTS, "Install a Runner");

    for (const [name, on] of defaults) {
      expect({
        name,
        row: setup.includes(
          `| **${name}** | **Capabilities** | ${on ? "On" : "Off"} by default.`,
        ),
      }).toEqual({
        name,
        row: true,
      });
    }

    for (const field of ["Name", "Description"]) {
      expect(setup).toContain(`| **${field}** | **Runner** |`);
    }

    // The labels fold under More fields on the Runner step.
    expect(RUNNER_FORM_FIELDS).toContain(
      'getLabelsFormField<Runner>(onStep("runner"))',
    );
    expect(setup).toContain(
      "| **Labels** | **Runner** (under **More fields**) |",
    );
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

  it("says a DaemonSet cannot be scaled, as the Runner refuses it", () => {
    expect(RUNNER_KUBERNETES_EXECUTOR).toContain(
      '"A DaemonSet cannot be scaled — it runs one pod per node. Restart it instead."',
    );
    expect(AUTHORING).toContain(
      "A DaemonSet runs one pod per node and cannot be scaled; restart it instead.",
    );
    expect(CREDENTIALS).toContain("A DaemonSet cannot be scaled");
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

  it("names the step badges the execution page draws, in its order", () => {
    const labels: Array<string> = statusLabels(
      "RunbookStepExecutionStatus",
    ).map(([, label]: [string, string]): string => {
      return label;
    });

    expect(labels.length).toBe(Object.keys(RunbookStepExecutionStatus).length);
    expect(RUNNING).toContain(
      `- **Status pill** — ${englishList(labels, "or")}.`,
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

    for (const label of [
      "Refresh",
      "Cancel Execution",
      "Run Again",
      "Mark complete",
      "Approve & continue",
      "Skip",
    ]) {
      expect({ label, drawn: EXECUTION_VIEW.includes(`"${label}"`) }).toEqual({
        label,
        drawn: true,
      });
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

    const missingRunner: string =
      "Bash step is missing a Runner. Pick one under Runbooks → Runners.";

    expect(STEP_EXECUTORS).toContain(`"${missingRunner}"`);
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
    [RunbookStepType.Kubernetes]: "Kubernetes",
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

    for (const field of new Set(fields)) {
      expect({ field, drawn: STEPS_PAGE.includes(`"${field}"`) }).toEqual({
        field,
        drawn: true,
      });
    }
  });

  it("names the Kubernetes actions and workload kinds the editor offers", () => {
    expect(Object.values(KubernetesAction)).toEqual([
      "RestartWorkload",
      "ScaleWorkload",
    ]);
    expect(Object.values(KubernetesWorkloadKind)).toEqual([
      "Deployment",
      "StatefulSet",
      "DaemonSet",
    ]);

    for (const kind of Object.values(KubernetesWorkloadKind)) {
      expect(STEPS_PAGE).toContain(
        `KubernetesWorkloadKind.${kind},\n                                                      label: "${kind}",`,
      );
    }

    expect(AUTHORING).toContain(
      "| **Workload kind** | **Deployment**, **StatefulSet** or **DaemonSet**. |",
    );
    expect(AUTHORING).toContain(
      "**Restart workload** changes the pod template so the controller recreates the pods",
    );
    expect(AUTHORING).toContain("**Scale workload** sets the replica count.");
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

  it("says naming a credential in a step takes reading runbook credentials, which Runbook Admin does not", () => {
    const readers: Array<Permission> = new RunbookCredential()
      .readRecordPermissions;

    expect(readers).not.toContain(Permission.RunbookAdmin);
    expect(englishList(readers.map(title), "or")).toBe(
      "Project Owner, Project Admin or Read Runbook Credential",
    );

    expect(AUTHORING).toContain(
      "A step can name a credential only when you may read runbook credentials: Project Owner, Project Admin, or **Read Runbook Credential**. Runbook Admin does not include it.",
    );
    expect(CREDENTIALS).toContain(
      "saving a step that names a credential takes permission to read runbook credentials.",
    );
  });
});

describe("runbook rules", () => {
  it("walk Create Runbook Rule through the form's steps", () => {
    expect(formSteps(RULES_TABLE)).toEqual([
      "Basic Info",
      "Match Criteria",
      "Runbooks",
    ]);
    expect(RULES_TABLE).toContain('title: "Runbooks to Start",');

    // A rule starts on; the switch is on its edit form only.
    const enabled: number = RULES_TABLE.indexOf(
      'title: "Enabled",\n          stepId: "basic-info",',
    );

    expect(enabled).toBeGreaterThan(0);
    expect(RULES_TABLE.slice(enabled, enabled + 300)).toContain(
      "doNotShowWhenCreating: true,",
    );

    const create: string = section(RULES, "Create a runbook rule");

    expect(create).toContain("On **Basic Info**, enter a **Name**");
    expect(create).toContain("On **Match Criteria**, click **Add condition**");
    expect(create).toContain(
      "On **Runbooks**, choose one or more **Runbooks to Start**, then click **Create Runbook Rule**. The rule is on as soon as it is created, and it appears in the list with the status **Enabled**.",
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

describe("credentials and secrets", () => {
  it("walk Create Runbook Credential through the form's steps", () => {
    expect(formSteps(CREDENTIALS_PAGE)).toEqual([
      "Credential",
      "SSH Host",
      "SSH Authentication",
      "Kubernetes",
      "Runners",
    ]);

    const create: string = section(CREDENTIALS, "Create a credential");

    for (const step of formSteps(CREDENTIALS_PAGE)) {
      expect(create).toContain(`**${step}**`);
    }

    for (const field of [
      "Name",
      "Description",
      "Type",
      "Hostname",
      "Port",
      "Username",
      "Private Key (PEM)",
      "Private Key Passphrase",
      "Password",
      "API Server URL",
      "Service Account Token",
      "CA Certificate (PEM)",
    ]) {
      expect({
        field,
        drawn: CREDENTIALS_PAGE.includes(`title: "${field}",`),
      }).toEqual({
        field,
        drawn: true,
      });
      expect(create).toContain(`**${field}**`);
    }
  });

  it("connect to port 22 when the port is left empty", () => {
    expect(RUNBOOK_CREDENTIALS_UTIL).toContain(
      "port: credential.sshPort || 22,",
    );
    expect(RUNNER_SSH_EXECUTOR).toContain(
      'Number(data.credential["port"] || 22)',
    );

    expect(CREDENTIALS).toContain("the **Port** (22 when left empty)");
    expect(CREDENTIALS).toContain("port (defaults to 22)");
  });

  it("say who manages credentials and secrets, which Runbook Admin does not", () => {
    for (const [model, permission, sentence] of [
      [
        new RunbookCredential(),
        Permission.CreateRunbookCredential,
        "Project Owner and Project Admin, or anyone with the **Create Runbook Credential** permission. The Runbook Admin role does not include it.",
      ],
      [
        new RunbookSecret(),
        Permission.CreateRunbookSecret,
        "by Project Owners and Project Admins or with the **Create Runbook Secret** permission.",
      ],
    ] as Array<[RunbookCredential | RunbookSecret, Permission, string]>) {
      expect(model.createRecordPermissions).toEqual([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        permission,
      ]);
      expect(model.createRecordPermissions).not.toContain(
        Permission.RunbookAdmin,
      );
      expect(CREDENTIALS).toContain(sentence);
    }
  });

  it("say both need the Growth plan on OneUptime Cloud", () => {
    for (const model of [new RunbookCredential(), new RunbookSecret()]) {
      expect(model.createBillingPlan).toBe(PlanType.Growth);
      expect(model.readBillingPlan).toBe(PlanType.Growth);
    }

    expect(CREDENTIALS).toContain(
      "On OneUptime Cloud, runbook credentials need the **Growth** plan or above.",
    );
    expect(CREDENTIALS).toContain(
      "On OneUptime Cloud, runbook secrets also need the **Growth** plan or above.",
    );
  });

  it("walk Create Runbook Secret through the form's steps and fields", () => {
    expect(formSteps(SECRETS_PAGE)).toEqual(["Secret", "Access"]);

    for (const field of [
      "Name",
      "Description",
      "Secret Value",
      "Runbook agents which have access to this secret",
      "Update Secret Value",
    ]) {
      expect({
        field,
        drawn: SECRETS_PAGE.includes(`title: "${field}",`),
      }).toEqual({
        field,
        drawn: true,
      });
      expect(CREDENTIALS).toContain(`**${field}**`);
    }

    expect(SECRETS_PAGE).toContain(
      "can only contain letters, numbers, hyphens (-), and underscores (_).",
    );
    expect(CREDENTIALS).toContain(
      "On the **Secret** step, enter a **Name** (letters, numbers, hyphens and underscores)",
    );
    expect(CREDENTIALS).toContain("On the **Access** step, pick the Runners");
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

    expect(sections.slice(0, 3)).toEqual([
      { title: "Runbooks", items: ["Runbooks", "Executions"] },
      { title: "Runners", items: ["Runners", "Credentials"] },
      { title: "Settings", items: ["Secrets", "Owner Rules", "Label Rules"] },
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
      "Runbooks → Runners → Credentials",
      "Runbooks → Settings",
      "Runbooks → Settings → Secrets",
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
