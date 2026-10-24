import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Investigation rules move into the AI rules (Types/AI/AiRule): the table
 * the auto remediation rules had, where a rule now says once which
 * incidents (or alerts) it matches, whether OneUptime AI investigates them,
 * and whether - and how - it fixes them. "Should incident investigation rule
 * and remediation rule be the same entity - we can call it Incident AI rules
 * ... Since its not possible to remediate without investigation" - the
 * maintainer.
 *
 * No project's AI does anything different afterwards. Before, per project
 * and kind of signal (a "lane": its incidents, or its alerts):
 *
 *   - investigated: every new one with no enabled investigation rule, else
 *     the ones an enabled investigation rule matches;
 *   - fixed: every new one with no enabled auto remediation rule, else the
 *     ones an enabled auto remediation rule matches.
 *
 * After, an enabled AI rule that investigates puts its matches in the
 * investigation scope (none of them: every one is in it), and with any
 * enabled AI rule an incident is fixed only when one that fixes matches it.
 * So, per lane:
 *
 *   1. An investigation rule and an auto remediation rule that match exactly
 *      the same incidents - the same conditions, both on or both off - and
 *      allow the same MCP servers, code repositories and LLM provider become
 *      one rule: the auto remediation rule, which now investigates too, with
 *      the investigation rule's wait (MERGE_PAIRS). Several such rules are
 *      paired in name order. Rules that differ in any of that stay two.
 *   2. Every other investigation rule becomes an AI rule that investigates
 *      and does not fix, with its own id, conditions, wait, MCP servers,
 *      code repositories and LLM provider (COPY_INVESTIGATION_RULES,
 *      getCopyListStatements).
 *   3. An auto remediation rule not paired in 1 fixes as it did. In a lane
 *      with an enabled investigation rule it does not investigate: it never
 *      decided which incidents are investigated, and the investigation
 *      rules still do. In a lane without one, every incident was
 *      investigated: it investigates too - what it matches was investigated
 *      before it fixed - unless it picks an LLM provider, which would then
 *      start writing those investigations too (CONVERT_REMEDIATION_RULES).
 *   4. Such a lane, once one of its enabled rules investigates, gets one
 *      more rule, "Investigate every incident" (or alert), that investigates
 *      every one and fixes nothing, so every incident is still investigated
 *      - unless an enabled rule that investigates matches every incident
 *      already (getAddInvestigateEveryOneStatement).
 *   5. A lane with an enabled investigation rule and no enabled auto
 *      remediation rule had every incident fixed while fixing was on. Where
 *      fixing is on it gets "Fix every incident" (or alert): it matches every
 *      one, fixes it the way OneUptime AI did with no rule - without asking
 *      where an AI agent's settings allow it, every runbook pick and MCP
 *      change proposed for approval, both pull requests on - and does not
 *      investigate, so the investigation rules alone still decide that
 *      (getAddFixEveryOneStatement). Where fixing is off it gets nothing: no
 *      rule that changes infrastructure is added to a project that never
 *      fixed anything.
 *
 * Safe to stop part way and to run again. It runs in one transaction, so a
 * stop rolls all of it back, and SchemaMigrationRunner runs it again from
 * the start. And it only reads the investigation rules - their table is left
 * as it was, not read by the product any more - so every step decides the
 * same way each time it runs, and writes what it wrote before: the copies
 * keep the investigation rules' ids, the two added rules have ids made from
 * their project and lane, every insert skips a row that is there, and every
 * update writes the value it wrote. down() takes back what up() added.
 */

type Lane = "Incident" | "Alert";

export const AI_RULE_LANES: ReadonlyArray<Lane> = ["Incident", "Alert"];

// The project switch that turns fixing a lane on.
export const FIX_SWITCH_COLUMNS: Readonly<Record<Lane, string>> = {
  Incident: "enableAutomaticIncidentRemediation",
  Alert: "enableAutomaticAlertRemediation",
};

/*
 * The lists each kind of rule keeps in a join table: what a rule matches on
 * (conditions) and what it allows OneUptime AI to use (the rest).
 */
export interface RuleListTable {
  // The list's name in a rule's fingerprint.
  key: string;
  investigationRuleTable: string;
  aiRuleTable: string;
  column: string;
  isCondition: boolean;
}

export const RULE_LIST_TABLES: ReadonlyArray<RuleListTable> = [
  {
    key: "monitors",
    investigationRuleTable: "AIInvestigationRuleMonitor",
    aiRuleTable: "AutoRemediationRuleMonitor",
    column: "monitorId",
    isCondition: true,
  },
  {
    key: "incidentSeverities",
    investigationRuleTable: "AIInvestigationRuleIncidentSeverity",
    aiRuleTable: "AutoRemediationRuleIncidentSeverity",
    column: "incidentSeverityId",
    isCondition: true,
  },
  {
    key: "alertSeverities",
    investigationRuleTable: "AIInvestigationRuleAlertSeverity",
    aiRuleTable: "AutoRemediationRuleAlertSeverity",
    column: "alertSeverityId",
    isCondition: true,
  },
  {
    key: "labels",
    investigationRuleTable: "AIInvestigationRuleLabel",
    aiRuleTable: "AutoRemediationRuleLabel",
    column: "labelId",
    isCondition: true,
  },
  {
    key: "monitorLabels",
    investigationRuleTable: "AIInvestigationRuleMonitorLabel",
    aiRuleTable: "AutoRemediationRuleMonitorLabel",
    column: "labelId",
    isCondition: true,
  },
  {
    key: "externalMcpServers",
    investigationRuleTable: "AIInvestigationRuleExternalMcpServer",
    aiRuleTable: "AutoRemediationRuleExternalMcpServer",
    column: "externalMcpServerId",
    isCondition: false,
  },
  {
    key: "codeRepositories",
    investigationRuleTable: "AIInvestigationRuleCodeRepository",
    aiRuleTable: "AutoRemediationRuleCodeRepository",
    column: "codeRepositoryId",
    isCondition: false,
  },
];

type RuleKind = "investigation" | "ai";

const RULE_KEYS: Readonly<Record<RuleKind, string>> = {
  investigation: "aiInvestigationRuleId",
  ai: "autoRemediationRuleId",
};

// A quote inside an SQL string literal is written twice.
const SINGLE_QUOTE: RegExp = /'/g;

function quoteLiteral(value: string): string {
  return `'${value.replace(SINGLE_QUOTE, "''")}'`;
}

// One of a rule's lists, as a sorted JSON array of ids.
function getListSql(
  kind: RuleKind,
  table: RuleListTable,
  alias: string,
): string {
  const listTable: string =
    kind === "investigation" ? table.investigationRuleTable : table.aiRuleTable;

  return `COALESCE((SELECT jsonb_agg(list."${table.column}" ORDER BY list."${table.column}") FROM "${listTable}" AS list WHERE list."${RULE_KEYS[kind]}" = ${alias}."_id"), '[]'::jsonb)`;
}

/*
 * What a rule matches, as one value two rules share only when they match
 * the same incidents: the versioned criteria when it has them - they decide
 * alone (RuleCriteriaMatcher.matchesWithLegacy) - and its condition columns
 * otherwise, an empty pattern read as none.
 */
export function getConditionsSql(kind: RuleKind, alias: string): string {
  const lists: string = RULE_LIST_TABLES.filter((table: RuleListTable) => {
    return table.isCondition;
  })
    .map((table: RuleListTable): string => {
      return `'${table.key}', ${getListSql(kind, table, alias)}`;
    })
    .join(", ");

  return `(CASE WHEN ${alias}."criteria" IS NOT NULL THEN jsonb_build_object('criteria', ${alias}."criteria") ELSE jsonb_build_object('titlePattern', NULLIF(${alias}."titlePattern", ''), 'descriptionPattern', NULLIF(${alias}."descriptionPattern", ''), ${lists}) END)`;
}

/*
 * What a rule allows OneUptime AI to use: its MCP servers, its code
 * repositories and its LLM provider. One rule holds one set of them, so two
 * rules that allow different ones are not merged.
 */
export function getAllowedSql(kind: RuleKind, alias: string): string {
  const lists: string = RULE_LIST_TABLES.filter((table: RuleListTable) => {
    return !table.isCondition;
  })
    .map((table: RuleListTable): string => {
      return `'${table.key}', ${getListSql(kind, table, alias)}`;
    })
    .join(", ");

  return `jsonb_build_object('llmProviderId', ${alias}."llmProviderId", ${lists})`;
}

export type AddedRule = "InvestigateEveryOne" | "FixEveryOne";

/*
 * The id of a rule step 4 or 5 adds: made from its project and lane, so it
 * is the same each time up() runs.
 */
export function getAddedRuleIdSql(data: {
  rule: AddedRule;
  projectIdSql: string;
  laneSql: string;
}): string {
  return `md5('oneuptime-ai-rule-merge:${data.rule}:' || ${data.projectIdSql}::text || ':' || ${data.laneSql})::uuid`;
}

/*
 * SQL over an AI rule aliased `alias`: one of the auto remediation rules the
 * project had - not a copied investigation rule, and not a rule step 4 or 5
 * added.
 */
export function getIsRemediationRuleSql(alias: string): string {
  return `${alias}."_id" NOT IN (SELECT investigation."_id" FROM "AIInvestigationRule" AS investigation) AND ${alias}."_id" <> ${getAddedRuleIdSql({ rule: "InvestigateEveryOne", projectIdSql: `${alias}."projectId"`, laneSql: `${alias}."triggerEntityType"` })} AND ${alias}."_id" <> ${getAddedRuleIdSql({ rule: "FixEveryOne", projectIdSql: `${alias}."projectId"`, laneSql: `${alias}."triggerEntityType"` })}`;
}

/*
 * The pairs of step 1: the k-th investigation rule and the k-th auto
 * remediation rule (by name) of the same project, lane, on/off state,
 * conditions and allowed tools. A WITH clause naming them "pairs".
 */
export function getPairsSql(): string {
  const position: string = `ROW_NUMBER() OVER (PARTITION BY rules."projectId", rules."triggerEntityType", rules."isEnabled", rules."conditions", rules."allowed" ORDER BY rules."name", rules."_id") AS "position"`;

  return `WITH "investigationRules" AS (
  SELECT rules.*, ${position}
  FROM (
    SELECT investigation."_id", investigation."projectId", investigation."triggerEntityType", investigation."isEnabled", investigation."name", ${getConditionsSql("investigation", "investigation")} AS "conditions", ${getAllowedSql("investigation", "investigation")} AS "allowed"
    FROM "AIInvestigationRule" AS investigation
    WHERE investigation."deletedAt" IS NULL
  ) AS rules
), "remediationRules" AS (
  SELECT rules.*, ${position}
  FROM (
    SELECT remediation."_id", remediation."projectId", remediation."triggerEntityType", remediation."isEnabled", remediation."name", ${getConditionsSql("ai", "remediation")} AS "conditions", ${getAllowedSql("ai", "remediation")} AS "allowed"
    FROM "AutoRemediationRule" AS remediation
    WHERE remediation."deletedAt" IS NULL AND ${getIsRemediationRuleSql("remediation")}
  ) AS rules
), pairs AS (
  SELECT "investigationRules"."_id" AS "investigationRuleId", "remediationRules"."_id" AS "aiRuleId"
  FROM "investigationRules" JOIN "remediationRules"
    ON "investigationRules"."projectId" = "remediationRules"."projectId"
   AND "investigationRules"."triggerEntityType" = "remediationRules"."triggerEntityType"
   AND "investigationRules"."isEnabled" = "remediationRules"."isEnabled"
   AND "investigationRules"."conditions" = "remediationRules"."conditions"
   AND "investigationRules"."allowed" = "remediationRules"."allowed"
   AND "investigationRules"."position" = "remediationRules"."position"
)`;
}

// Step 1: each pair becomes its auto remediation rule, which investigates too.
export const MERGE_PAIRS: string = `${getPairsSql()}
UPDATE "AutoRemediationRule" AS rule
SET "investigates" = true,
    "onlyIfOpenAfterMinutes" = investigation."onlyIfOpenAfterMinutes",
    "description" = COALESCE(NULLIF(rule."description", ''), investigation."description")
FROM pairs, "AIInvestigationRule" AS investigation
WHERE rule."_id" = pairs."aiRuleId" AND investigation."_id" = pairs."investigationRuleId"`;

/*
 * Step 2: every other investigation rule, as an AI rule that investigates
 * and does not fix - its fix settings at the defaults a new rule has, so
 * turning fixing on asks first, with any runbook, no Runner and both pull
 * requests.
 */
export const COPY_INVESTIGATION_RULES: string = `${getPairsSql()}
INSERT INTO "AutoRemediationRule" ("_id", "createdAt", "updatedAt", "version", "projectId", "name", "description", "isEnabled", "triggerEntityType", "criteria", "titlePattern", "descriptionPattern", "onlyIfOpenAfterMinutes", "llmProviderId", "createdByUserId", "investigates", "fixes", "executionMode", "remediationAction", "aiSelectsRunbook", "aiComposesCommands", "autoResolveOnVerifiedRecovery", "openCodeFixPullRequests", "openTelemetryPullRequests")
SELECT investigation."_id", investigation."createdAt", investigation."updatedAt", investigation."version", investigation."projectId", investigation."name", investigation."description", investigation."isEnabled", investigation."triggerEntityType", investigation."criteria", investigation."titlePattern", investigation."descriptionPattern", investigation."onlyIfOpenAfterMinutes", investigation."llmProviderId", investigation."createdByUserId", true, false, 'Suggest', 'OneUptimeAI', false, false, false, true, true
FROM "AIInvestigationRule" AS investigation
WHERE investigation."deletedAt" IS NULL
  AND investigation."_id" NOT IN (SELECT pairs."investigationRuleId" FROM pairs)
ON CONFLICT ("_id") DO NOTHING`;

/*
 * Step 2, the lists: what each copied rule matches on and allows, read from
 * its investigation rule. A pair's investigation rule has no copy, so none
 * of its lists is copied.
 */
export function getCopyListStatement(table: RuleListTable): string {
  return `INSERT INTO "${table.aiRuleTable}" ("autoRemediationRuleId", "${table.column}")
SELECT list."aiInvestigationRuleId", list."${table.column}"
FROM "${table.investigationRuleTable}" AS list
JOIN "AutoRemediationRule" AS rule ON rule."_id" = list."aiInvestigationRuleId"
ON CONFLICT DO NOTHING`;
}

export function getCopyListStatements(): Array<string> {
  return RULE_LIST_TABLES.map(getCopyListStatement);
}

// SQL over an AI rule aliased `alias`: its lane has an enabled investigation rule.
function getLaneHasInvestigationRuleSql(alias: string): string {
  return `EXISTS (SELECT 1 FROM "AIInvestigationRule" AS investigation WHERE investigation."projectId" = ${alias}."projectId" AND investigation."triggerEntityType" = ${alias}."triggerEntityType" AND investigation."isEnabled" = true AND investigation."deletedAt" IS NULL)`;
}

/*
 * Step 3: in a lane with no enabled investigation rule, an auto remediation
 * rule that picks no LLM provider investigates what it matches too. Only in
 * a project that is not deleted: step 4 adds no rule to a deleted one, and
 * without it the lane would investigate less.
 */
export const CONVERT_REMEDIATION_RULES: string = `UPDATE "AutoRemediationRule" AS rule
SET "investigates" = true
WHERE rule."deletedAt" IS NULL
  AND rule."investigates" = false
  AND rule."llmProviderId" IS NULL
  AND ${getIsRemediationRuleSql("rule")}
  AND NOT ${getLaneHasInvestigationRuleSql("rule")}
  AND EXISTS (SELECT 1 FROM "Project" AS project WHERE project."_id" = rule."projectId" AND project."deletedAt" IS NULL)`;

/*
 * SQL over an AI rule aliased `alias`: it has no condition, so it matches
 * every incident (or alert) of its lane - criteria with no filter, or no
 * criteria and no condition column set.
 */
export function getMatchesEveryOneSql(alias: string): string {
  const noLists: string = RULE_LIST_TABLES.filter((table: RuleListTable) => {
    return table.isCondition;
  })
    .map((table: RuleListTable): string => {
      return `NOT EXISTS (SELECT 1 FROM "${table.aiRuleTable}" AS list WHERE list."autoRemediationRuleId" = ${alias}."_id")`;
    })
    .join(" AND ");

  return `((${alias}."criteria" IS NULL AND NULLIF(${alias}."titlePattern", '') IS NULL AND NULLIF(${alias}."descriptionPattern", '') IS NULL AND ${noLists}) OR (jsonb_typeof(${alias}."criteria" -> 'filters') = 'array' AND jsonb_array_length(${alias}."criteria" -> 'filters') = 0 AND ${alias}."criteria" ->> 'schemaVersion' = '1'))`;
}

/*
 * SQL over an AI rule aliased `alias`: what it investigates is exactly what
 * no rule did - every incident of its lane, right away, with every MCP
 * server and code repository and the default LLM provider. A lane with an
 * enabled rule like that needs no "Investigate every incident".
 */
export function getInvestigatesLikeNoRuleSql(alias: string): string {
  const nothingNamed: string = RULE_LIST_TABLES.filter(
    (table: RuleListTable) => {
      return !table.isCondition;
    },
  )
    .map((table: RuleListTable): string => {
      return `NOT EXISTS (SELECT 1 FROM "${table.aiRuleTable}" AS list WHERE list."autoRemediationRuleId" = ${alias}."_id")`;
    })
    .join(" AND ");

  return `(${getMatchesEveryOneSql(alias)} AND ${alias}."llmProviderId" IS NULL AND COALESCE(${alias}."onlyIfOpenAfterMinutes", 0) = 0 AND ${nothingNamed})`;
}

// What the two added rules are called, and why they are there.
export const ADDED_RULE_NAMES: Readonly<
  Record<AddedRule, Record<Lane, string>>
> = {
  InvestigateEveryOne: {
    Incident: "Investigate every incident",
    Alert: "Investigate every alert",
  },
  FixEveryOne: {
    Incident: "Fix every incident",
    Alert: "Fix every alert",
  },
};

export const ADDED_RULE_DESCRIPTIONS: Readonly<
  Record<AddedRule, Record<Lane, string>>
> = {
  InvestigateEveryOne: {
    Incident:
      "Added when investigation rules and auto remediation rules became AI rules, so OneUptime AI keeps investigating every new incident, as it did with no investigation rule. Delete it to investigate only the incidents your other AI rules match.",
    Alert:
      "Added when investigation rules and auto remediation rules became AI rules, so OneUptime AI keeps investigating every new alert, as it did with no investigation rule. Delete it to investigate only the alerts your other AI rules match.",
  },
  FixEveryOne: {
    Incident:
      "Added when investigation rules and auto remediation rules became AI rules, so OneUptime AI keeps fixing every new incident, as it did with no auto remediation rule. It does not change which incidents are investigated. Delete it to fix only the incidents your other AI rules fix.",
    Alert:
      "Added when investigation rules and auto remediation rules became AI rules, so OneUptime AI keeps fixing every new alert, as it did with no auto remediation rule. It does not change which alerts are investigated. Delete it to fix only the alerts your other AI rules fix.",
  },
};

/*
 * Step 4: "Investigate every incident" (or alert), in a lane with no
 * enabled investigation rule once one of its enabled rules investigates,
 * unless one of those matches every incident already.
 */
export function getAddInvestigateEveryOneStatement(lane: Lane): string {
  const id: string = getAddedRuleIdSql({
    rule: "InvestigateEveryOne",
    projectIdSql: `project."_id"`,
    laneSql: quoteLiteral(lane),
  });

  return `INSERT INTO "AutoRemediationRule" ("_id", "version", "projectId", "name", "description", "isEnabled", "triggerEntityType", "investigates", "fixes", "executionMode", "remediationAction", "aiSelectsRunbook", "aiComposesCommands", "autoResolveOnVerifiedRecovery", "openCodeFixPullRequests", "openTelemetryPullRequests")
SELECT ${id}, 1, project."_id", ${quoteLiteral(ADDED_RULE_NAMES.InvestigateEveryOne[lane])}, ${quoteLiteral(ADDED_RULE_DESCRIPTIONS.InvestigateEveryOne[lane])}, true, ${quoteLiteral(lane)}, true, false, 'Suggest', 'OneUptimeAI', false, false, false, true, true
FROM "Project" AS project
WHERE project."deletedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "AIInvestigationRule" AS investigation WHERE investigation."projectId" = project."_id" AND investigation."triggerEntityType" = ${quoteLiteral(lane)} AND investigation."isEnabled" = true AND investigation."deletedAt" IS NULL)
  AND EXISTS (SELECT 1 FROM "AutoRemediationRule" AS rule WHERE rule."projectId" = project."_id" AND rule."triggerEntityType" = ${quoteLiteral(lane)} AND rule."deletedAt" IS NULL AND rule."isEnabled" = true AND rule."investigates" = true AND ${getIsRemediationRuleSql("rule")})
  AND NOT EXISTS (SELECT 1 FROM "AutoRemediationRule" AS rule WHERE rule."projectId" = project."_id" AND rule."triggerEntityType" = ${quoteLiteral(lane)} AND rule."deletedAt" IS NULL AND rule."isEnabled" = true AND rule."investigates" = true AND rule."_id" <> ${id} AND ${getInvestigatesLikeNoRuleSql("rule")})
ON CONFLICT ("_id") DO NOTHING`;
}

/*
 * Step 5: "Fix every incident" (or alert), in a lane with an enabled
 * investigation rule and no enabled auto remediation rule, where fixing is
 * on. Without asking, naming nothing: what OneUptime AI did with no rule
 * (as 1799400000000 and 1805830000000 kept it).
 */
export function getAddFixEveryOneStatement(lane: Lane): string {
  const id: string = getAddedRuleIdSql({
    rule: "FixEveryOne",
    projectIdSql: `project."_id"`,
    laneSql: quoteLiteral(lane),
  });

  return `INSERT INTO "AutoRemediationRule" ("_id", "version", "projectId", "name", "description", "isEnabled", "triggerEntityType", "investigates", "fixes", "executionMode", "remediationAction", "aiSelectsRunbook", "aiComposesCommands", "autoResolveOnVerifiedRecovery", "openCodeFixPullRequests", "openTelemetryPullRequests")
SELECT ${id}, 1, project."_id", ${quoteLiteral(ADDED_RULE_NAMES.FixEveryOne[lane])}, ${quoteLiteral(ADDED_RULE_DESCRIPTIONS.FixEveryOne[lane])}, true, ${quoteLiteral(lane)}, false, true, 'FullAuto', 'OneUptimeAI', false, false, false, true, true
FROM "Project" AS project
WHERE project."deletedAt" IS NULL
  AND project."${FIX_SWITCH_COLUMNS[lane]}" = true
  AND EXISTS (SELECT 1 FROM "AIInvestigationRule" AS investigation WHERE investigation."projectId" = project."_id" AND investigation."triggerEntityType" = ${quoteLiteral(lane)} AND investigation."isEnabled" = true AND investigation."deletedAt" IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "AutoRemediationRule" AS rule WHERE rule."projectId" = project."_id" AND rule."triggerEntityType" = ${quoteLiteral(lane)} AND rule."deletedAt" IS NULL AND rule."isEnabled" = true AND ${getIsRemediationRuleSql("rule")})
ON CONFLICT ("_id") DO NOTHING`;
}

// Every statement up() runs, in order.
export function getUpStatements(): Array<string> {
  return [
    MERGE_PAIRS,
    COPY_INVESTIGATION_RULES,
    ...getCopyListStatements(),
    CONVERT_REMEDIATION_RULES,
    ...AI_RULE_LANES.map(getAddInvestigateEveryOneStatement),
    ...AI_RULE_LANES.map(getAddFixEveryOneStatement),
  ];
}

/*
 * down(): back to auto remediation rules beside the investigation rules,
 * which up() never changed, so they are as they were. Every AI rule that
 * is not an auto remediation rule goes - the copies (by their investigation
 * rules' ids; their lists with them), the two added rules, and any rule
 * made since that does not fix: the code before this change would read it
 * as one that fixes. Every rule left fixes, and investigates nothing again.
 * A rule made since that investigates and fixes keeps only fixing: the
 * code before this change has nowhere to keep the rest.
 */
// SQL over an AI rule aliased `alias`: down() takes it back.
function getTakenBackSql(alias: string): string {
  return `(${alias}."_id" IN (SELECT investigation."_id" FROM "AIInvestigationRule" AS investigation) OR ${alias}."fixes" = false OR ${alias}."_id" = ${getAddedRuleIdSql({ rule: "InvestigateEveryOne", projectIdSql: `${alias}."projectId"`, laneSql: `${alias}."triggerEntityType"` })} OR ${alias}."_id" = ${getAddedRuleIdSql({ rule: "FixEveryOne", projectIdSql: `${alias}."projectId"`, laneSql: `${alias}."triggerEntityType"` })})`;
}

// Every join table that holds a list of an AI rule, the fix-only ones too.
export const AI_RULE_JOIN_TABLES: ReadonlyArray<string> = [
  ...RULE_LIST_TABLES.map((table: RuleListTable): string => {
    return table.aiRuleTable;
  }),
  "AutoRemediationRuleRunbook",
  "AutoRemediationRuleRunner",
];

export function getDownStatements(): Array<string> {
  return [
    // Their lists first: the statements do not lean on a key's cascade.
    ...AI_RULE_JOIN_TABLES.map((table: string): string => {
      return `DELETE FROM "${table}" AS list WHERE list."autoRemediationRuleId" IN (SELECT rule."_id" FROM "AutoRemediationRule" AS rule WHERE ${getTakenBackSql("rule")})`;
    }),
    `DELETE FROM "AutoRemediationRule" AS rule WHERE ${getTakenBackSql("rule")}`,
    `UPDATE "AutoRemediationRule" SET "investigates" = false, "onlyIfOpenAfterMinutes" = NULL WHERE "investigates" = true OR "onlyIfOpenAfterMinutes" IS NOT NULL`,
  ];
}

export class MergeInvestigationRulesIntoAiRules1806910000000
  implements MigrationInterface
{
  public name: string = "MergeInvestigationRulesIntoAiRules1806910000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const statement of getUpStatements()) {
      await queryRunner.query(statement);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const statement of getDownStatements()) {
      await queryRunner.query(statement);
    }
  }
}
