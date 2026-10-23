import { AddAiRuleInvestigation1806900000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1806900000000-AddAiRuleInvestigation";
import {
  ADDED_RULE_DESCRIPTIONS,
  ADDED_RULE_NAMES,
  MergeInvestigationRulesIntoAiRules1806910000000,
  RULE_LIST_TABLES,
  RuleListTable,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1806910000000-MergeInvestigationRulesIntoAiRules";
import IncidentAlertRuleMatcher, {
  IncidentAlertMatchRule,
} from "../../../../Server/Utils/Rules/IncidentAlertRuleMatcher";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import ExternalMcpServer from "../../../../Models/DatabaseModels/ExternalMcpServer";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import {
  getFixingAiRules,
  getInvestigatingAiRules,
} from "../../../../Types/AI/AiRule";
import {
  AutomaticFixPullRequest,
  AutomaticFixPullRequestDecision,
  decideAutomaticFixPullRequest,
} from "../../../../Types/AI/AutomaticFixPullRequests";
import {
  ExternalMcpServerAllowance,
  EVERY_EXTERNAL_MCP_SERVER,
  getExternalMcpServerAllowance,
} from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerAllowance";
import { getInvestigationRuleWaitMinutes } from "../../../../Types/AI/InvestigationRuleWait";
import {
  getLlmProviderPickingRules,
  getRuleLlmProviderId,
} from "../../../../Types/AI/LlmProviderChoice";
import AutoRemediationTriggerEntity from "../../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import {
  CodeRepositoryAllowance,
  EVERY_CODE_REPOSITORY,
  getCodeRepositoryAllowance,
} from "../../../../Types/CodeRepository/CodeRepositoryAllowance";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import ObjectID from "../../../../Types/ObjectID";
import {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../../Types/Rules/RuleCriteria";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * The AddAiRuleInvestigation and MergeInvestigationRulesIntoAiRules
 * migrations against a real Postgres, on real rows: every investigation
 * rule moves into the AI rules (the auto remediation rules' table), and no
 * project's AI does anything different afterwards.
 *
 * Each project below is one combination - investigation rules only (with
 * fixing on, and off), auto remediation rules only (one that picks an LLM
 * provider among them, and one that already matches every incident), an
 * investigation rule and an auto remediation rule that match the same
 * incidents (and ones that allow different tools, match different
 * incidents, or differ in being on), several of them paired in name order,
 * criteria that decide alone, both kinds of signal in one project, a
 * deleted rule and a deleted project. The suite checks:
 *
 *   - the rows: what each rule became, with its id, conditions, lists,
 *     wait, LLM provider and fix settings, and the two rules added;
 *   - the behaviour: for a spread of incidents and alerts, whether each is
 *     investigated (with which wait, LLM provider, MCP servers and code
 *     repositories), which rules fix it, and whether each pull request
 *     opens (in which repositories, with which provider) - read off the
 *     rules before and after with the matcher and the decisions the server
 *     uses, and equal;
 *   - that up() run again changes nothing, that down() gives the auto
 *     remediation rules back with the investigation rules untouched, and
 *     that up() after down() gives the same rules again.
 *
 * Opt in with RUN_POSTGRES_AI_RULE_MERGE_TESTS=true and the normal database
 * credentials; AI_RULE_MERGE_TEST_DATABASE_HOST / _PORT / _NAME point it at
 * a database other than the local development one. The database must
 * already be migrated: the tables are cloned from public into a uniquely
 * named schema (so the source's rows are never read or modified), put back
 * as they were before AddAiRuleInvestigation, seeded, and migrated. The
 * schema is dropped afterwards.
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml ("Test merging
 * investigation rules into AI rules on migrated Postgres"), right after that
 * job has applied every registered migration.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_AI_RULE_MERGE_TESTS"] === "true"
    ? describe
    : describe.skip;

const CLONED_TABLES: Array<string> = [
  "Project",
  "AIInvestigationRule",
  "AutoRemediationRule",
  "AutoRemediationRuleRunbook",
  "AutoRemediationRuleRunner",
  ...RULE_LIST_TABLES.flatMap((table: RuleListTable): Array<string> => {
    return [table.investigationRuleTable, table.aiRuleTable];
  }),
];

// A dash in a uuid is not a character a schema name may hold unquoted.
const DASH: RegExp = /-/g;

type Lane = "Incident" | "Alert";

// The ids the rules below point at: no foreign key holds them in the clone.
const ID: Record<string, string> = {
  monitorCheckout: "a1a1a1a1-0000-4000-8000-000000000001",
  monitorSearch: "a1a1a1a1-0000-4000-8000-000000000002",
  severityCritical: "b2b2b2b2-0000-4000-8000-000000000001",
  severityMinor: "b2b2b2b2-0000-4000-8000-000000000002",
  alertSeverityHigh: "b3b3b3b3-0000-4000-8000-000000000001",
  labelProduction: "c3c3c3c3-0000-4000-8000-000000000001",
  labelStaging: "c3c3c3c3-0000-4000-8000-000000000002",
  mcpGrafana: "d4d4d4d4-0000-4000-8000-000000000001",
  mcpGithub: "d4d4d4d4-0000-4000-8000-000000000002",
  repositoryApi: "e5e5e5e5-0000-4000-8000-000000000001",
  providerOpus: "f6f6f6f6-0000-4000-8000-000000000001",
  runbookRestart: "a7a7a7a7-0000-4000-8000-000000000001",
};

// What a seeded rule matches on, and what it allows OneUptime AI to use.
interface RuleSeed {
  lane: Lane;
  name: string;
  isEnabled?: boolean;
  description?: string | null;
  criteria?: unknown;
  titlePattern?: string | null;
  descriptionPattern?: string | null;
  monitors?: Array<string>;
  incidentSeverities?: Array<string>;
  alertSeverities?: Array<string>;
  labels?: Array<string>;
  externalMcpServers?: Array<string>;
  codeRepositories?: Array<string>;
  llmProviderId?: string | null;
  deletedAt?: Date | null;
}

interface InvestigationRuleSeed extends RuleSeed {
  onlyIfOpenAfterMinutes?: number | null;
}

interface RemediationRuleSeed extends RuleSeed {
  executionMode?: "Suggest" | "FullAuto";
  remediationAction?: "OneUptimeAI" | "Runbooks";
  runbooks?: Array<string>;
  openCodeFixPullRequests?: boolean;
  openTelemetryPullRequests?: boolean;
}

interface ProjectSeed {
  label: string;
  incidentFixing?: boolean;
  alertFixing?: boolean;
  deletedAt?: Date | null;
  investigationRules?: Array<InvestigationRuleSeed>;
  remediationRules?: Array<RemediationRuleSeed>;
}

// A rule as the matcher and the decisions read it - before or after.
interface ReadRule {
  _id: string;
  name: string;
  isEnabled: boolean;
  triggerEntityType: Lane;
  investigates: boolean;
  fixes: boolean;
  onlyIfOpenAfterMinutes: number | null;
  llmProviderId: string | null;
  criteria: unknown;
  titlePattern: string | null;
  descriptionPattern: string | null;
  description: string | null;
  executionMode: string;
  remediationAction: string;
  openCodeFixPullRequests: boolean;
  openTelemetryPullRequests: boolean;
  runnerId: string | null;
  monitors: Array<string>;
  incidentSeverities: Array<string>;
  alertSeverities: Array<string>;
  labels: Array<string>;
  monitorLabels: Array<string>;
  externalMcpServers: Array<string>;
  codeRepositories: Array<string>;
  runbooks: Array<string>;
}

const PROJECTS: Array<ProjectSeed> = [
  { label: "no rules", incidentFixing: true },
  {
    label: "investigation rules only, fixing on",
    incidentFixing: true,
    investigationRules: [
      {
        lane: "Incident",
        name: "Investigate checkout",
        description: "Checkout incidents only",
        monitors: [ID["monitorCheckout"]!],
        onlyIfOpenAfterMinutes: 10,
        externalMcpServers: [ID["mcpGrafana"]!],
        codeRepositories: [ID["repositoryApi"]!],
        llmProviderId: ID["providerOpus"]!,
      },
      {
        lane: "Incident",
        name: "Investigate staging",
        isEnabled: false,
        labels: [ID["labelStaging"]!],
      },
    ],
  },
  {
    label: "investigation rules only, fixing off",
    incidentFixing: false,
    investigationRules: [
      {
        lane: "Incident",
        name: "Investigate critical",
        incidentSeverities: [ID["severityCritical"]!],
      },
    ],
  },
  {
    label: "remediation rules only",
    incidentFixing: true,
    remediationRules: [
      {
        lane: "Incident",
        name: "Restart checkout",
        incidentSeverities: [ID["severityCritical"]!],
        remediationAction: "Runbooks",
        runbooks: [ID["runbookRestart"]!],
        externalMcpServers: [ID["mcpGithub"]!],
      },
      {
        lane: "Incident",
        name: "Scale search",
        labels: [ID["labelProduction"]!],
        llmProviderId: ID["providerOpus"]!,
        executionMode: "FullAuto",
      },
      {
        lane: "Incident",
        name: "Old rule",
        isEnabled: false,
        monitors: [ID["monitorSearch"]!],
      },
    ],
  },
  {
    label: "a remediation rule that matches every incident",
    incidentFixing: true,
    remediationRules: [
      {
        lane: "Incident",
        name: "Fix every incident with OneUptime AI",
        executionMode: "FullAuto",
      },
    ],
  },
  {
    label: "a remediation rule that matches every incident and names a server",
    incidentFixing: true,
    remediationRules: [
      {
        lane: "Incident",
        name: "Fix everything through GitHub",
        externalMcpServers: [ID["mcpGithub"]!],
      },
    ],
  },
  {
    label: "a pair",
    incidentFixing: true,
    investigationRules: [
      {
        lane: "Incident",
        name: "Investigate critical",
        description: "What the investigation rule said",
        incidentSeverities: [ID["severityCritical"]!],
        codeRepositories: [ID["repositoryApi"]!],
        onlyIfOpenAfterMinutes: 5,
      },
    ],
    remediationRules: [
      {
        lane: "Incident",
        name: "Fix critical",
        description: null,
        incidentSeverities: [ID["severityCritical"]!],
        codeRepositories: [ID["repositoryApi"]!],
        executionMode: "FullAuto",
        openTelemetryPullRequests: false,
      },
    ],
  },
  {
    label: "same conditions, different servers",
    incidentFixing: true,
    investigationRules: [
      {
        lane: "Incident",
        name: "Investigate critical",
        incidentSeverities: [ID["severityCritical"]!],
        externalMcpServers: [ID["mcpGrafana"]!],
      },
    ],
    remediationRules: [
      {
        lane: "Incident",
        name: "Fix critical",
        incidentSeverities: [ID["severityCritical"]!],
        externalMcpServers: [ID["mcpGithub"]!],
      },
    ],
  },
  {
    label: "different conditions",
    incidentFixing: true,
    investigationRules: [
      {
        lane: "Incident",
        name: "Investigate critical",
        incidentSeverities: [ID["severityCritical"]!],
      },
    ],
    remediationRules: [
      {
        lane: "Incident",
        name: "Fix minor",
        incidentSeverities: [ID["severityMinor"]!],
      },
    ],
  },
  {
    label: "paired in name order",
    incidentFixing: true,
    investigationRules: [
      {
        lane: "Incident",
        name: "B second",
        labels: [ID["labelProduction"]!],
        onlyIfOpenAfterMinutes: 7,
      },
      {
        lane: "Incident",
        name: "A first",
        labels: [ID["labelProduction"]!],
        onlyIfOpenAfterMinutes: 3,
      },
    ],
    remediationRules: [
      {
        lane: "Incident",
        name: "Fix production",
        labels: [ID["labelProduction"]!],
      },
    ],
  },
  {
    label: "on and off do not pair",
    incidentFixing: true,
    investigationRules: [
      {
        lane: "Incident",
        name: "Investigate critical",
        incidentSeverities: [ID["severityCritical"]!],
      },
    ],
    remediationRules: [
      {
        lane: "Incident",
        name: "Fix critical, turned off",
        isEnabled: false,
        incidentSeverities: [ID["severityCritical"]!],
      },
    ],
  },
  {
    label: "criteria decide alone",
    incidentFixing: true,
    investigationRules: [
      {
        lane: "Incident",
        name: "Investigate by condition",
        titlePattern: "(?!)",
        criteria: {
          schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
          filterCondition: FilterCondition.All,
          filters: [
            {
              field: "incidentSeverities",
              operator: RuleCriteriaOperator.HasAnyOf,
              value: [ID["severityCritical"]!],
            },
          ],
        },
      },
    ],
    remediationRules: [
      {
        lane: "Incident",
        name: "Fix by condition",
        titlePattern: "never matched when criteria are set",
        criteria: {
          schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
          filterCondition: FilterCondition.All,
          filters: [
            {
              field: "incidentSeverities",
              operator: RuleCriteriaOperator.HasAnyOf,
              value: [ID["severityCritical"]!],
            },
          ],
        },
      },
    ],
  },
  {
    label: "both kinds",
    incidentFixing: true,
    alertFixing: true,
    investigationRules: [
      {
        lane: "Incident",
        name: "Investigate checkout incidents",
        monitors: [ID["monitorCheckout"]!],
      },
    ],
    remediationRules: [
      {
        lane: "Alert",
        name: "Fix high alerts",
        alertSeverities: [ID["alertSeverityHigh"]!],
      },
    ],
  },
  {
    label: "alert investigation rules only, fixing on",
    alertFixing: true,
    investigationRules: [
      {
        lane: "Alert",
        name: "Investigate production alerts",
        labels: [ID["labelProduction"]!],
      },
    ],
  },
  {
    label: "a deleted investigation rule",
    incidentFixing: true,
    investigationRules: [
      {
        lane: "Incident",
        name: "Deleted",
        monitors: [ID["monitorCheckout"]!],
        deletedAt: new Date(),
      },
    ],
    remediationRules: [
      {
        lane: "Incident",
        name: "Fix checkout",
        monitors: [ID["monitorCheckout"]!],
      },
    ],
  },
  {
    label: "a deleted project",
    incidentFixing: true,
    deletedAt: new Date(),
    remediationRules: [
      {
        lane: "Incident",
        name: "Fix in a deleted project",
        incidentSeverities: [ID["severityCritical"]!],
      },
    ],
  },
];

// The incidents and alerts each project's rules are tried on.
interface Subject {
  title: string;
  description: string;
  monitors: Array<string>;
  severity: string | null;
  labels: Array<string>;
}

const SUBJECTS: Array<Subject> = [];

for (const monitors of [
  [ID["monitorCheckout"]!],
  [ID["monitorSearch"]!],
  [] as Array<string>,
]) {
  for (const severity of [
    ID["severityCritical"]!,
    ID["severityMinor"]!,
    ID["alertSeverityHigh"]!,
    null,
  ]) {
    for (const labels of [
      [ID["labelProduction"]!],
      [ID["labelStaging"]!],
      [] as Array<string>,
    ]) {
      SUBJECTS.push({
        title: "Checkout database is down",
        description: "Connection refused",
        monitors,
        severity,
        labels,
      });
    }
  }
}

function ref<T extends { _id?: string | undefined }>(
  type: { new (): T },
  id: string,
): T {
  const model: T = new type();
  model._id = id;
  return model;
}

function toMatchRule(rule: ReadRule): IncidentAlertMatchRule {
  return {
    id: new ObjectID(rule._id),
    criteria: rule.criteria ?? null,
    monitors: rule.monitors.map((id: string) => {
      return ref(Monitor, id);
    }),
    incidentSeverities: rule.incidentSeverities.map((id: string) => {
      return ref(IncidentSeverity, id);
    }),
    alertSeverities: rule.alertSeverities.map((id: string) => {
      return ref(AlertSeverity, id);
    }),
    labels: rule.labels.map((id: string) => {
      return ref(Label, id);
    }),
    monitorLabels: rule.monitorLabels.map((id: string) => {
      return ref(Label, id);
    }),
    titlePattern: rule.titlePattern || undefined,
    descriptionPattern: rule.descriptionPattern || undefined,
  };
}

async function matches(
  lane: Lane,
  subject: Subject,
  rule: ReadRule,
): Promise<boolean> {
  if (lane === "Incident") {
    const incident: Incident = Object.assign(new Incident(), {
      title: subject.title,
      description: subject.description,
      monitors: subject.monitors.map((id: string) => {
        return ref(Monitor, id);
      }),
      labels: subject.labels.map((id: string) => {
        return ref(Label, id);
      }),
      ...(subject.severity
        ? { incidentSeverityId: new ObjectID(subject.severity) }
        : {}),
    });

    return IncidentAlertRuleMatcher.doesIncidentMatch(
      incident,
      toMatchRule(rule),
      "AI rule",
    );
  }

  const alert: Alert = Object.assign(new Alert(), {
    title: subject.title,
    description: subject.description,
    labels: subject.labels.map((id: string) => {
      return ref(Label, id);
    }),
    ...(subject.monitors[0]
      ? { monitorId: new ObjectID(subject.monitors[0]) }
      : {}),
    ...(subject.severity
      ? { alertSeverityId: new ObjectID(subject.severity) }
      : {}),
  });

  return IncidentAlertRuleMatcher.doesAlertMatch(
    alert,
    toMatchRule(rule),
    "AI rule",
  );
}

// Everything OneUptime AI does with one incident or alert on its own.
interface AiDecision {
  isInvestigated: boolean;
  waitMinutes: number;
  investigationLlmProviderId: string;
  investigationMcpServers: ExternalMcpServerAllowance;
  investigationRepositories: CodeRepositoryAllowance;
  // "every one": fixed as with no rule; otherwise the ids of the rules that fix it.
  fixedBy: Array<string>;
  pullRequests: Record<string, AutomaticFixPullRequestDecision>;
}

const FIXED_AS_WITH_NO_RULE: string = "every one";

function sortAllowances(decision: AiDecision): AiDecision {
  return {
    ...decision,
    investigationMcpServers: {
      ...decision.investigationMcpServers,
      serverIds: [...decision.investigationMcpServers.serverIds].sort(),
    },
    investigationRepositories: {
      ...decision.investigationRepositories,
      repositoryIds: [
        ...decision.investigationRepositories.repositoryIds,
      ].sort(),
    },
    fixedBy: [...decision.fixedBy].sort(),
    pullRequests: Object.fromEntries(
      Object.entries(decision.pullRequests).map(
        ([key, value]: [string, AutomaticFixPullRequestDecision]) => {
          return [
            key,
            {
              ...value,
              repositories: {
                ...value.repositories,
                repositoryIds: [...value.repositories.repositoryIds].sort(),
              },
            },
          ];
        },
      ),
    ),
  };
}

/*
 * What the server decides for a subject, read the way InvestigationRules,
 * AutoRemediationRuleEngineService and RemediationRulePullRequests read
 * their rules: `investigating` are the rules that decide investigations,
 * `fixing` the enabled rules of the lane and which of them fix.
 */
async function decide(data: {
  lane: Lane;
  subject: Subject;
  investigating: Array<ReadRule>;
  enabled: Array<ReadRule>;
  fixing: Array<ReadRule>;
  isFixingOn: boolean;
  fixesAsWithNoRule: Array<string>;
}): Promise<AiDecision> {
  const matchingInvestigating: Array<ReadRule> = [];

  for (const rule of data.investigating) {
    if (await matches(data.lane, data.subject, rule)) {
      matchingInvestigating.push(rule);
    }
  }

  const isInvestigated: boolean =
    data.investigating.length === 0 || matchingInvestigating.length > 0;

  const waitMinutes: number =
    data.investigating.length === 0 || matchingInvestigating.length === 0
      ? 0
      : Math.min(
          ...matchingInvestigating.map((rule: ReadRule): number => {
            return getInvestigationRuleWaitMinutes(rule.onlyIfOpenAfterMinutes);
          }),
        );

  const picking: Array<ReadRule> = getLlmProviderPickingRules(
    matchingInvestigating,
  );

  const matchingFixing: Array<ReadRule> = [];

  for (const rule of data.fixing) {
    if (await matches(data.lane, data.subject, rule)) {
      matchingFixing.push(rule);
    }
  }

  // With fixing off nothing is fixed, whatever the rules say.
  const fixedBy: Array<string> = !data.isFixingOn
    ? []
    : data.enabled.length === 0
      ? [FIXED_AS_WITH_NO_RULE]
      : matchingFixing.map((rule: ReadRule): string => {
          return data.fixesAsWithNoRule.includes(rule._id)
            ? FIXED_AS_WITH_NO_RULE
            : rule._id;
        });

  const pullRequests: Record<string, AutomaticFixPullRequestDecision> = {};

  for (const pullRequest of [
    AutomaticFixPullRequest.CodeFix,
    AutomaticFixPullRequest.MissingTelemetry,
  ]) {
    pullRequests[pullRequest] = decideAutomaticFixPullRequest({
      project: {
        enableAutomaticIncidentRemediation:
          data.lane === "Incident" && data.isFixingOn,
        enableAutomaticAlertRemediation:
          data.lane === "Alert" && data.isFixingOn,
      },
      signal:
        data.lane === "Incident"
          ? AutoRemediationTriggerEntity.Incident
          : AutoRemediationTriggerEntity.Alert,
      pullRequest,
      rules: {
        rulesSetUp: data.enabled.length > 0,
        matchingRules: matchingFixing,
      },
    });
  }

  return sortAllowances({
    isInvestigated,
    waitMinutes,
    investigationLlmProviderId:
      picking.length > 0 ? getRuleLlmProviderId(picking[0]!) : "",
    investigationMcpServers:
      data.investigating.length === 0
        ? EVERY_EXTERNAL_MCP_SERVER
        : getExternalMcpServerAllowance({
            rulesSetUp: true,
            matchingRules: matchingInvestigating,
          }),
    investigationRepositories:
      data.investigating.length === 0
        ? EVERY_CODE_REPOSITORY
        : getCodeRepositoryAllowance({
            rulesSetUp: true,
            matchingRules: matchingInvestigating,
          }),
    fixedBy,
    pullRequests,
  });
}

describePostgres("MergeInvestigationRulesIntoAiRules against Postgres", () => {
  const schema: string = `ai_rule_merge_test_${ObjectID.generate()
    .toString()
    .replace(DASH, "")}`;
  let database: DataSource;

  const requiredColumnsByTable: Map<
    string,
    Array<{ column_name: string; udt_name: string }>
  > = new Map();

  async function runInSchema(
    step: (queryRunner: QueryRunner) => Promise<void>,
  ): Promise<void> {
    const queryRunner: QueryRunner = database.createQueryRunner();
    try {
      await queryRunner.query(`SET search_path TO "${schema}"`);
      await step(queryRunner);
    } finally {
      await queryRunner.release();
    }
  }

  /*
   * Inserts a row, filling every NOT NULL column that has no default and
   * was not given with a value of its type, so the seeds only say what the
   * test is about.
   */
  async function insertRow(
    table: string,
    values: Record<string, unknown>,
  ): Promise<string> {
    let required: Array<{ column_name: string; udt_name: string }> | undefined =
      requiredColumnsByTable.get(table);

    if (!required) {
      required = await database.query(
        `SELECT column_name, udt_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
           AND is_nullable = 'NO' AND column_default IS NULL`,
        [schema, table],
      );
      requiredColumnsByTable.set(table, required!);
    }

    const row: Record<string, unknown> = { ...values };

    for (const column of required!) {
      if (column.column_name in row) {
        continue;
      }

      if (column.udt_name === "uuid") {
        row[column.column_name] = ObjectID.generate().toString();
      } else if (column.udt_name === "int4") {
        row[column.column_name] = 1;
      } else if (column.udt_name === "bool") {
        row[column.column_name] = false;
      } else {
        row[column.column_name] =
          `${column.column_name}-${ObjectID.generate().toString()}`;
      }
    }

    const columns: Array<string> = Object.keys(row);

    await database.query(
      `INSERT INTO "${schema}"."${table}" (${columns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${columns
        .map((_column: string, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      columns.map((column: string): unknown => {
        const value: unknown = row[column];
        // jsonb columns take their value as JSON text.
        return column === "criteria" && value !== null && value !== undefined
          ? JSON.stringify(value)
          : value;
      }),
    );

    return row["_id"] as string;
  }

  // The list of a seeded rule that one join table holds.
  function seededList(seed: RuleSeed, table: RuleListTable): Array<string> {
    const lists: Record<string, Array<string> | undefined> = {
      monitors: seed.monitors,
      incidentSeverities: seed.incidentSeverities,
      alertSeverities: seed.alertSeverities,
      labels: seed.labels,
      monitorLabels: [],
      externalMcpServers: seed.externalMcpServers,
      codeRepositories: seed.codeRepositories,
    };

    return lists[table.key] || [];
  }

  async function seedRuleLists(data: {
    ruleId: string;
    seed: RuleSeed;
    isInvestigationRule: boolean;
  }): Promise<void> {
    for (const table of RULE_LIST_TABLES) {
      for (const id of seededList(data.seed, table)) {
        await insertRow(
          data.isInvestigationRule
            ? table.investigationRuleTable
            : table.aiRuleTable,
          {
            [data.isInvestigationRule
              ? "aiInvestigationRuleId"
              : "autoRemediationRuleId"]: data.ruleId,
            [table.column]: id,
          },
        );
      }
    }
  }

  function seedColumns(
    projectId: string,
    seed: RuleSeed,
  ): Record<string, unknown> {
    return {
      _id: ObjectID.generate().toString(),
      projectId,
      name: seed.name,
      description: seed.description ?? null,
      isEnabled: seed.isEnabled ?? true,
      triggerEntityType: seed.lane,
      criteria: seed.criteria ?? null,
      titlePattern: seed.titlePattern ?? null,
      descriptionPattern: seed.descriptionPattern ?? null,
      llmProviderId: seed.llmProviderId ?? null,
      deletedAt: seed.deletedAt ?? null,
    };
  }

  // A rule as the server reads it, from either table, with its lists.
  async function readRules(data: {
    table: "AIInvestigationRule" | "AutoRemediationRule";
    projectId: string;
  }): Promise<Array<ReadRule>> {
    const isInvestigationTable: boolean = data.table === "AIInvestigationRule";

    const rows: Array<Record<string, unknown>> = await database.query(
      `SELECT * FROM "${schema}"."${data.table}" WHERE "projectId" = $1 AND "deletedAt" IS NULL ORDER BY "name", "_id"`,
      [data.projectId],
    );

    const rules: Array<ReadRule> = [];

    for (const row of rows) {
      const lists: Record<string, Array<string>> = {};

      for (const table of RULE_LIST_TABLES) {
        const listRows: Array<{ id: string }> = await database.query(
          `SELECT "${table.column}" AS id FROM "${schema}"."${
            isInvestigationTable
              ? table.investigationRuleTable
              : table.aiRuleTable
          }" WHERE "${
            isInvestigationTable
              ? "aiInvestigationRuleId"
              : "autoRemediationRuleId"
          }" = $1 ORDER BY 1`,
          [row["_id"]],
        );
        lists[table.key] = listRows.map((listRow: { id: string }) => {
          return listRow.id;
        });
      }

      const runbookRows: Array<{ id: string }> = isInvestigationTable
        ? []
        : await database.query(
            `SELECT "runbookId" AS id FROM "${schema}"."AutoRemediationRuleRunbook" WHERE "autoRemediationRuleId" = $1 ORDER BY 1`,
            [row["_id"]],
          );

      rules.push({
        _id: row["_id"] as string,
        name: row["name"] as string,
        isEnabled: row["isEnabled"] as boolean,
        triggerEntityType: row["triggerEntityType"] as Lane,
        // An investigation rule investigates and never fixes; an auto remediation rule, before up(), the opposite.
        investigates: isInvestigationTable
          ? true
          : (row["investigates"] as boolean | undefined) === true,
        fixes: isInvestigationTable
          ? false
          : (row["fixes"] as boolean | undefined) !== false,
        onlyIfOpenAfterMinutes:
          (row["onlyIfOpenAfterMinutes"] as number | null | undefined) ?? null,
        llmProviderId: (row["llmProviderId"] as string | null) ?? null,
        criteria: row["criteria"] ?? null,
        titlePattern: (row["titlePattern"] as string | null) ?? null,
        descriptionPattern:
          (row["descriptionPattern"] as string | null) ?? null,
        description: (row["description"] as string | null) ?? null,
        executionMode: (row["executionMode"] as string | undefined) || "",
        remediationAction:
          (row["remediationAction"] as string | undefined) || "",
        openCodeFixPullRequests:
          (row["openCodeFixPullRequests"] as boolean | undefined) !== false,
        openTelemetryPullRequests:
          (row["openTelemetryPullRequests"] as boolean | undefined) !== false,
        runnerId: (row["runnerId"] as string | null | undefined) ?? null,
        monitors: lists["monitors"] || [],
        incidentSeverities: lists["incidentSeverities"] || [],
        alertSeverities: lists["alertSeverities"] || [],
        labels: lists["labels"] || [],
        monitorLabels: lists["monitorLabels"] || [],
        externalMcpServers: lists["externalMcpServers"] || [],
        codeRepositories: lists["codeRepositories"] || [],
        runbooks: runbookRows.map((runbookRow: { id: string }) => {
          return runbookRow.id;
        }),
      });
    }

    return rules;
  }

  // Seeded before up(), read after it.
  const projectIds: Map<string, string> = new Map();
  const seededRuleIds: Map<string, string> = new Map();
  const investigationRulesBefore: Map<string, Array<ReadRule>> = new Map();
  const remediationRulesBefore: Map<string, Array<ReadRule>> = new Map();
  const aiRulesAfter: Map<string, Array<ReadRule>> = new Map();
  let aiRuleColumnsAfterUp: Array<unknown> = [];
  let snapshotAfterUp: string = "";
  let snapshotAfterSecondUp: string = "";
  let snapshotAfterDown: string = "";
  let investigationSnapshotBefore: string = "";
  let investigationSnapshotAfterDown: string = "";
  let remediationSnapshotBefore: string = "";
  let columnsAfterDown: Array<unknown> = [];
  let snapshotAfterUpAgain: string = "";

  /*
   * Every row of a rule table and its lists - but when a row was written:
   * the rules up() adds are stamped with the time it ran.
   */
  async function snapshot(table: string): Promise<string> {
    const rows: Array<Record<string, unknown>> = (
      (await database.query(
        `SELECT * FROM "${schema}"."${table}" ORDER BY "_id"`,
      )) as Array<Record<string, unknown>>
    ).map((row: Record<string, unknown>) => {
      const copy: Record<string, unknown> = { ...row };
      delete copy["createdAt"];
      delete copy["updatedAt"];
      return copy;
    });
    const lists: Array<unknown> = [];

    for (const listTable of RULE_LIST_TABLES) {
      lists.push(
        await database.query(
          `SELECT * FROM "${schema}"."${
            table === "AIInvestigationRule"
              ? listTable.investigationRuleTable
              : listTable.aiRuleTable
          }" ORDER BY 1, 2`,
        ),
      );
    }

    return JSON.stringify({ rows, lists });
  }

  // The rule seeded with this name in this project.
  function seededId(project: string, name: string): string {
    const id: string | undefined = seededRuleIds.get(`${project}::${name}`);
    expect(id).toBeDefined();
    return id!;
  }

  function aiRules(project: string, lane?: Lane): Array<ReadRule> {
    const rules: Array<ReadRule> | undefined = aiRulesAfter.get(project);
    expect(rules).toBeDefined();
    return rules!.filter((rule: ReadRule) => {
      return !lane || rule.triggerEntityType === lane;
    });
  }

  function aiRule(project: string, id: string): ReadRule {
    const rule: ReadRule | undefined = aiRules(project).find(
      (candidate: ReadRule) => {
        return candidate._id === id;
      },
    );
    expect(rule).toBeDefined();
    return rule!;
  }

  function addedRule(
    project: string,
    lane: Lane,
    kind: "InvestigateEveryOne" | "FixEveryOne",
  ): ReadRule | undefined {
    return aiRules(project, lane).find((rule: ReadRule) => {
      return (
        rule.name === ADDED_RULE_NAMES[kind][lane] &&
        rule.description === ADDED_RULE_DESCRIPTIONS[kind][lane]
      );
    });
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["AI_RULE_MERGE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["AI_RULE_MERGE_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["AI_RULE_MERGE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      schema: schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of CLONED_TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    // The rule table as it was before AddAiRuleInvestigation.
    for (const column of ["investigates", "onlyIfOpenAfterMinutes", "fixes"]) {
      await database.query(
        `ALTER TABLE "${schema}"."AutoRemediationRule" DROP COLUMN IF EXISTS "${column}"`,
      );
    }

    for (const project of PROJECTS) {
      const projectId: string = await insertRow("Project", {
        _id: ObjectID.generate().toString(),
        enableAutomaticIncidentRemediation: project.incidentFixing === true,
        enableAutomaticAlertRemediation: project.alertFixing === true,
        deletedAt: project.deletedAt ?? null,
      });
      projectIds.set(project.label, projectId);

      for (const seed of project.investigationRules || []) {
        const columns: Record<string, unknown> = {
          ...seedColumns(projectId, seed),
          onlyIfOpenAfterMinutes: seed.onlyIfOpenAfterMinutes ?? null,
        };
        const ruleId: string = await insertRow("AIInvestigationRule", columns);
        seededRuleIds.set(`${project.label}::${seed.name}`, ruleId);
        await seedRuleLists({ ruleId, seed, isInvestigationRule: true });
      }

      for (const seed of project.remediationRules || []) {
        const ruleId: string = await insertRow("AutoRemediationRule", {
          ...seedColumns(projectId, seed),
          executionMode: seed.executionMode || "Suggest",
          remediationAction: seed.remediationAction || "OneUptimeAI",
          aiSelectsRunbook: false,
          aiComposesCommands: false,
          openCodeFixPullRequests: seed.openCodeFixPullRequests ?? true,
          openTelemetryPullRequests: seed.openTelemetryPullRequests ?? true,
        });
        seededRuleIds.set(`${project.label}::${seed.name}`, ruleId);
        await seedRuleLists({ ruleId, seed, isInvestigationRule: false });

        for (const runbookId of seed.runbooks || []) {
          await insertRow("AutoRemediationRuleRunbook", {
            autoRemediationRuleId: ruleId,
            runbookId,
          });
        }
      }

      investigationRulesBefore.set(
        project.label,
        await readRules({ table: "AIInvestigationRule", projectId }),
      );
      remediationRulesBefore.set(
        project.label,
        await readRules({ table: "AutoRemediationRule", projectId }),
      );
    }

    investigationSnapshotBefore = await snapshot("AIInvestigationRule");
    remediationSnapshotBefore = await snapshot("AutoRemediationRule");

    await runInSchema(async (queryRunner: QueryRunner) => {
      await new AddAiRuleInvestigation1806900000000().up(queryRunner);
      await new MergeInvestigationRulesIntoAiRules1806910000000().up(
        queryRunner,
      );
    });

    aiRuleColumnsAfterUp = await database.query(
      `SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'AutoRemediationRule'
         AND column_name IN ('investigates', 'onlyIfOpenAfterMinutes', 'fixes')
       ORDER BY column_name`,
      [schema],
    );

    for (const project of PROJECTS) {
      aiRulesAfter.set(
        project.label,
        await readRules({
          table: "AutoRemediationRule",
          projectId: projectIds.get(project.label)!,
        }),
      );
    }

    snapshotAfterUp = await snapshot("AutoRemediationRule");

    // Run again: nothing changes.
    await runInSchema(async (queryRunner: QueryRunner) => {
      await new MergeInvestigationRulesIntoAiRules1806910000000().up(
        queryRunner,
      );
    });
    snapshotAfterSecondUp = await snapshot("AutoRemediationRule");

    // down(), and the rule table's columns too.
    await runInSchema(async (queryRunner: QueryRunner) => {
      await new MergeInvestigationRulesIntoAiRules1806910000000().down(
        queryRunner,
      );
      await new AddAiRuleInvestigation1806900000000().down(queryRunner);
    });
    snapshotAfterDown = await snapshot("AutoRemediationRule");
    investigationSnapshotAfterDown = await snapshot("AIInvestigationRule");
    columnsAfterDown = await database.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'AutoRemediationRule'
         AND column_name IN ('investigates', 'onlyIfOpenAfterMinutes', 'fixes')`,
      [schema],
    );

    // And up() once more, after down(): the same rules as the first time.
    await runInSchema(async (queryRunner: QueryRunner) => {
      await new AddAiRuleInvestigation1806900000000().up(queryRunner);
      await new MergeInvestigationRulesIntoAiRules1806910000000().up(
        queryRunner,
      );
    });
    snapshotAfterUpAgain = await snapshot("AutoRemediationRule");
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  describe("the schema", () => {
    test("a rule says whether it investigates (off by default), its wait and whether it fixes (on by default)", () => {
      expect(aiRuleColumnsAfterUp).toEqual([
        {
          column_name: "fixes",
          data_type: "boolean",
          column_default: "true",
          is_nullable: "NO",
        },
        {
          column_name: "investigates",
          data_type: "boolean",
          column_default: "false",
          is_nullable: "NO",
        },
        {
          column_name: "onlyIfOpenAfterMinutes",
          data_type: "integer",
          column_default: null,
          is_nullable: "YES",
        },
      ]);
    });
  });

  describe("what each rule became", () => {
    test("a project with no rule gets none", () => {
      expect(aiRules("no rules")).toEqual([]);
    });

    test("an investigation rule becomes an AI rule that investigates and does not fix, with its id, conditions, wait, servers, repositories and provider", () => {
      const project: string = "investigation rules only, fixing on";
      const copy: ReadRule = aiRule(
        project,
        seededId(project, "Investigate checkout"),
      );

      expect(copy).toMatchObject({
        name: "Investigate checkout",
        description: "Checkout incidents only",
        isEnabled: true,
        triggerEntityType: "Incident",
        investigates: true,
        fixes: false,
        onlyIfOpenAfterMinutes: 10,
        llmProviderId: ID["providerOpus"],
        monitors: [ID["monitorCheckout"]],
        externalMcpServers: [ID["mcpGrafana"]],
        codeRepositories: [ID["repositoryApi"]],
        // Its fix settings are a new rule's: asks first, any runbook, no Runner, both pull requests.
        executionMode: "Suggest",
        remediationAction: "OneUptimeAI",
        runnerId: null,
        runbooks: [],
        openCodeFixPullRequests: true,
        openTelemetryPullRequests: true,
      });
    });

    test("a disabled investigation rule moves in disabled", () => {
      const project: string = "investigation rules only, fixing on";
      expect(
        aiRule(project, seededId(project, "Investigate staging")),
      ).toMatchObject({
        isEnabled: false,
        investigates: true,
        fixes: false,
        labels: [ID["labelStaging"]],
      });
    });

    test("investigation rules alone, with fixing on: every incident is still fixed, by an added rule that does not investigate", () => {
      const project: string = "investigation rules only, fixing on";
      const fixEveryOne: ReadRule | undefined = addedRule(
        project,
        "Incident",
        "FixEveryOne",
      );

      expect(fixEveryOne).toMatchObject({
        isEnabled: true,
        investigates: false,
        fixes: true,
        executionMode: "FullAuto",
        remediationAction: "OneUptimeAI",
        criteria: null,
        monitors: [],
        incidentSeverities: [],
        labels: [],
        externalMcpServers: [],
        codeRepositories: [],
        runbooks: [],
        llmProviderId: null,
        runnerId: null,
        openCodeFixPullRequests: true,
        openTelemetryPullRequests: true,
      });
      expect(
        addedRule(project, "Incident", "InvestigateEveryOne"),
      ).toBeUndefined();
      expect(aiRules(project)).toHaveLength(3);
    });

    test("investigation rules alone, with fixing off: no rule that fixes is added", () => {
      const project: string = "investigation rules only, fixing off";
      expect(aiRules(project)).toHaveLength(1);
      expect(aiRules(project)[0]).toMatchObject({
        _id: seededId(project, "Investigate critical"),
        investigates: true,
        fixes: false,
      });
    });

    test("auto remediation rules alone: each investigates too unless it picks an LLM provider, and one added rule investigates every incident", () => {
      const project: string = "remediation rules only";

      expect(
        aiRule(project, seededId(project, "Restart checkout")),
      ).toMatchObject({
        investigates: true,
        fixes: true,
        onlyIfOpenAfterMinutes: null,
        // Everything it fixed with, as it was.
        remediationAction: "Runbooks",
        runbooks: [ID["runbookRestart"]],
        externalMcpServers: [ID["mcpGithub"]],
        executionMode: "Suggest",
      });
      expect(aiRule(project, seededId(project, "Scale search"))).toMatchObject({
        investigates: false,
        fixes: true,
        llmProviderId: ID["providerOpus"],
        executionMode: "FullAuto",
      });
      expect(aiRule(project, seededId(project, "Old rule"))).toMatchObject({
        isEnabled: false,
        investigates: true,
        fixes: true,
      });
      expect(
        addedRule(project, "Incident", "InvestigateEveryOne"),
      ).toMatchObject({
        isEnabled: true,
        investigates: true,
        fixes: false,
        onlyIfOpenAfterMinutes: null,
        criteria: null,
        externalMcpServers: [],
        codeRepositories: [],
        llmProviderId: null,
      });
      expect(addedRule(project, "Incident", "FixEveryOne")).toBeUndefined();
      expect(aiRules(project)).toHaveLength(4);
    });

    test("an auto remediation rule that already matches every incident, naming nothing, needs no added rule", () => {
      const project: string = "a remediation rule that matches every incident";
      expect(aiRules(project)).toHaveLength(1);
      expect(aiRules(project)[0]).toMatchObject({
        name: "Fix every incident with OneUptime AI",
        investigates: true,
        fixes: true,
        executionMode: "FullAuto",
      });
    });

    test("one that matches every incident but names a server still gets the added rule", () => {
      const project: string =
        "a remediation rule that matches every incident and names a server";
      expect(
        addedRule(project, "Incident", "InvestigateEveryOne"),
      ).toBeDefined();
      expect(aiRules(project)).toHaveLength(2);
    });

    test("an investigation rule and an auto remediation rule that match the same incidents and allow the same tools become one rule", () => {
      const project: string = "a pair";
      expect(aiRules(project)).toHaveLength(1);

      const merged: ReadRule = aiRules(project)[0]!;
      expect(merged).toMatchObject({
        _id: seededId(project, "Fix critical"),
        name: "Fix critical",
        description: "What the investigation rule said",
        investigates: true,
        fixes: true,
        onlyIfOpenAfterMinutes: 5,
        incidentSeverities: [ID["severityCritical"]],
        codeRepositories: [ID["repositoryApi"]],
        executionMode: "FullAuto",
        openTelemetryPullRequests: false,
      });
    });

    test("the same conditions with different MCP servers stay two rules, the remediation one only fixing", () => {
      const project: string = "same conditions, different servers";
      expect(aiRules(project)).toHaveLength(2);
      expect(
        aiRule(project, seededId(project, "Investigate critical")),
      ).toMatchObject({
        investigates: true,
        fixes: false,
        externalMcpServers: [ID["mcpGrafana"]],
      });
      expect(aiRule(project, seededId(project, "Fix critical"))).toMatchObject({
        investigates: false,
        fixes: true,
        externalMcpServers: [ID["mcpGithub"]],
      });
    });

    test("different conditions stay two rules, and nothing is added", () => {
      const project: string = "different conditions";
      expect(aiRules(project)).toHaveLength(2);
      expect(aiRule(project, seededId(project, "Fix minor"))).toMatchObject({
        investigates: false,
        fixes: true,
      });
    });

    test("pairs are made in name order: the first investigation rule by name joins the auto remediation rule", () => {
      const project: string = "paired in name order";
      expect(aiRules(project)).toHaveLength(2);
      expect(
        aiRule(project, seededId(project, "Fix production")),
      ).toMatchObject({
        investigates: true,
        fixes: true,
        onlyIfOpenAfterMinutes: 3,
      });
      expect(aiRule(project, seededId(project, "B second"))).toMatchObject({
        investigates: true,
        fixes: false,
        onlyIfOpenAfterMinutes: 7,
      });
    });

    test("an enabled rule and a disabled one are never merged", () => {
      const project: string = "on and off do not pair";
      expect(
        aiRule(project, seededId(project, "Investigate critical")),
      ).toMatchObject({ isEnabled: true, investigates: true, fixes: false });
      expect(
        aiRule(project, seededId(project, "Fix critical, turned off")),
      ).toMatchObject({ isEnabled: false, investigates: false, fixes: true });
      // No enabled auto remediation rule: every incident was fixed, and still is.
      expect(addedRule(project, "Incident", "FixEveryOne")).toBeDefined();
      expect(aiRules(project)).toHaveLength(3);
    });

    test("criteria decide alone: two rules with the same criteria pair whatever their old condition columns hold", () => {
      const project: string = "criteria decide alone";
      expect(aiRules(project)).toHaveLength(1);
      expect(aiRules(project)[0]).toMatchObject({
        _id: seededId(project, "Fix by condition"),
        investigates: true,
        fixes: true,
      });
    });

    test("each kind of signal is decided on its own", () => {
      const project: string = "both kinds";
      expect(
        aiRule(project, seededId(project, "Investigate checkout incidents")),
      ).toMatchObject({ investigates: true, fixes: false });
      expect(addedRule(project, "Incident", "FixEveryOne")).toBeDefined();
      expect(
        aiRule(project, seededId(project, "Fix high alerts")),
      ).toMatchObject({ investigates: true, fixes: true });
      expect(addedRule(project, "Alert", "InvestigateEveryOne")).toBeDefined();
      expect(addedRule(project, "Alert", "FixEveryOne")).toBeUndefined();
      expect(
        addedRule(project, "Incident", "InvestigateEveryOne"),
      ).toBeUndefined();
    });

    test("an alert lane gets its own added rule, named for alerts", () => {
      const project: string = "alert investigation rules only, fixing on";
      expect(addedRule(project, "Alert", "FixEveryOne")).toMatchObject({
        name: "Fix every alert",
        triggerEntityType: "Alert",
      });
    });

    test("a deleted investigation rule is not moved, and does not count", () => {
      const project: string = "a deleted investigation rule";
      expect(
        aiRules(project).find((rule: ReadRule) => {
          return rule._id === seededId(project, "Deleted");
        }),
      ).toBeUndefined();
      expect(aiRule(project, seededId(project, "Fix checkout"))).toMatchObject({
        investigates: true,
        fixes: true,
      });
      expect(
        addedRule(project, "Incident", "InvestigateEveryOne"),
      ).toBeDefined();
    });

    test("a deleted project's rules are left fixing only, and it gets no added rule", () => {
      const project: string = "a deleted project";
      expect(aiRules(project)).toHaveLength(1);
      expect(aiRules(project)[0]).toMatchObject({
        investigates: false,
        fixes: true,
      });
    });

    test("no auto remediation rule's fix settings change", () => {
      for (const project of PROJECTS) {
        for (const before of remediationRulesBefore.get(project.label) || []) {
          const after: ReadRule = aiRule(project.label, before._id);

          expect({
            name: after.name,
            isEnabled: after.isEnabled,
            fixes: after.fixes,
            executionMode: after.executionMode,
            remediationAction: after.remediationAction,
            runnerId: after.runnerId,
            runbooks: after.runbooks,
            externalMcpServers: after.externalMcpServers,
            codeRepositories: after.codeRepositories,
            llmProviderId: after.llmProviderId,
            openCodeFixPullRequests: after.openCodeFixPullRequests,
            openTelemetryPullRequests: after.openTelemetryPullRequests,
            criteria: after.criteria,
            monitors: after.monitors,
            incidentSeverities: after.incidentSeverities,
            alertSeverities: after.alertSeverities,
            labels: after.labels,
          }).toEqual({
            name: before.name,
            isEnabled: before.isEnabled,
            fixes: true,
            executionMode: before.executionMode,
            remediationAction: before.remediationAction,
            runnerId: before.runnerId,
            runbooks: before.runbooks,
            externalMcpServers: before.externalMcpServers,
            codeRepositories: before.codeRepositories,
            llmProviderId: before.llmProviderId,
            openCodeFixPullRequests: before.openCodeFixPullRequests,
            openTelemetryPullRequests: before.openTelemetryPullRequests,
            criteria: before.criteria,
            monitors: before.monitors,
            incidentSeverities: before.incidentSeverities,
            alertSeverities: before.alertSeverities,
            labels: before.labels,
          });
        }
      }
    });
  });

  describe("no project's AI does anything different", () => {
    test("for every incident and alert: investigated or not, with the same wait, LLM provider, MCP servers and repositories; fixed by the same rules; the same pull requests", async () => {
      let compared: number = 0;

      for (const project of PROJECTS) {
        const before: {
          investigation: Array<ReadRule>;
          remediation: Array<ReadRule>;
        } = {
          investigation: investigationRulesBefore.get(project.label) || [],
          remediation: remediationRulesBefore.get(project.label) || [],
        };
        const after: Array<ReadRule> = aiRules(project.label);

        for (const lane of ["Incident", "Alert"] as Array<Lane>) {
          const isFixingOn: boolean =
            lane === "Incident"
              ? project.incidentFixing === true
              : project.alertFixing === true;

          const ofLane: (rules: Array<ReadRule>) => Array<ReadRule> = (
            rules: Array<ReadRule>,
          ): Array<ReadRule> => {
            return rules.filter((rule: ReadRule) => {
              return rule.triggerEntityType === lane && rule.isEnabled;
            });
          };

          const fixEveryOne: ReadRule | undefined = addedRule(
            project.label,
            lane,
            "FixEveryOne",
          );

          for (const subject of SUBJECTS) {
            const old: AiDecision = await decide({
              lane,
              subject,
              investigating: ofLane(before.investigation),
              enabled: ofLane(before.remediation),
              fixing: ofLane(before.remediation),
              isFixingOn,
              fixesAsWithNoRule: [],
            });

            const now: AiDecision = await decide({
              lane,
              subject,
              investigating: getInvestigatingAiRules(ofLane(after)),
              enabled: ofLane(after),
              fixing: getFixingAiRules(ofLane(after)),
              isFixingOn,
              fixesAsWithNoRule: fixEveryOne ? [fixEveryOne._id] : [],
            });

            const description: string = `${project.label} / ${lane} / ${JSON.stringify(subject)}`;

            expect({ description, decision: now }).toEqual({
              description,
              decision: old,
            });
            compared++;
          }
        }
      }

      expect(compared).toBe(PROJECTS.length * 2 * SUBJECTS.length);
    });

    test("the subjects tried cover being investigated and not, and being fixed by rules and not", async () => {
      // Without this, an equality over subjects nothing matched would prove nothing.
      const project: string = "different conditions";
      const rules: Array<ReadRule> = aiRules(project, "Incident");
      const decisions: Array<AiDecision> = [];

      for (const subject of SUBJECTS) {
        decisions.push(
          await decide({
            lane: "Incident",
            subject,
            investigating: getInvestigatingAiRules(rules),
            enabled: rules,
            fixing: getFixingAiRules(rules),
            isFixingOn: true,
            fixesAsWithNoRule: [],
          }),
        );
      }

      expect(
        decisions.some((decision: AiDecision) => {
          return decision.isInvestigated;
        }),
      ).toBe(true);
      expect(
        decisions.some((decision: AiDecision) => {
          return !decision.isInvestigated;
        }),
      ).toBe(true);
      expect(
        decisions.some((decision: AiDecision) => {
          return decision.fixedBy.length > 0;
        }),
      ).toBe(true);
      expect(
        decisions.some((decision: AiDecision) => {
          return decision.fixedBy.length === 0;
        }),
      ).toBe(true);
    });
  });

  describe("running it again, and taking it back", () => {
    test("up() run again changes nothing", () => {
      expect(snapshotAfterSecondUp).toBe(snapshotAfterUp);
    });

    test("the investigation rules are never changed, and are as they were after down()", () => {
      expect(investigationSnapshotAfterDown).toBe(investigationSnapshotBefore);
    });

    test("down() gives the auto remediation rules back as they were - the copies and the added rules gone, the columns too", () => {
      expect(columnsAfterDown).toEqual([]);

      const before: {
        rows: Array<Record<string, unknown>>;
        lists: Array<unknown>;
      } = JSON.parse(remediationSnapshotBefore);
      const after: {
        rows: Array<Record<string, unknown>>;
        lists: Array<unknown>;
      } = JSON.parse(snapshotAfterDown);

      // A merged rule keeps the description its investigation rule gave it; nothing else differs.
      const withoutDescription: (
        rows: Array<Record<string, unknown>>,
      ) => Array<Record<string, unknown>> = (
        rows: Array<Record<string, unknown>>,
      ): Array<Record<string, unknown>> => {
        return rows.map((row: Record<string, unknown>) => {
          const copy: Record<string, unknown> = { ...row };
          delete copy["description"];
          return copy;
        });
      };

      expect(withoutDescription(after.rows)).toEqual(
        withoutDescription(before.rows),
      );
      expect(after.lists).toEqual(before.lists);
    });

    test("up() after down() gives the same rules again", () => {
      expect(snapshotAfterUpAgain).toBe(snapshotAfterUp);
    });
  });

  test("the seeds name real models' lists", () => {
    // The join tables the migration reads are the ones the models declare.
    expect(
      RULE_LIST_TABLES.map((table: RuleListTable) => {
        return table.aiRuleTable;
      }),
    ).toEqual([
      "AutoRemediationRuleMonitor",
      "AutoRemediationRuleIncidentSeverity",
      "AutoRemediationRuleAlertSeverity",
      "AutoRemediationRuleLabel",
      "AutoRemediationRuleMonitorLabel",
      "AutoRemediationRuleExternalMcpServer",
      "AutoRemediationRuleCodeRepository",
    ]);
    expect(new ExternalMcpServer()).toBeDefined();
    expect(new CodeRepository()).toBeDefined();
  });
});
