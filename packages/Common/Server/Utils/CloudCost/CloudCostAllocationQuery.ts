import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import {
  CloudCostBasis,
  CloudCostBasisColumn,
  getCloudCostBasisColumn,
} from "../../../Types/Cloud/CloudCostBasis";
import {
  CloudCostRule,
  CloudCostRuleCondition,
  CloudCostRuleField,
  CloudCostRuleOperator,
} from "../../../Types/Cloud/CloudCostRules";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";

/*
 * A COST VIEW'S RULES AS CLICKHOUSE READS THEM.
 *
 * Every read of a view sorts the stored costs (CloudCost) into its groups
 * as it reads them: one multiIf puts each cost in the first group whose
 * rules match it - group 1, 2, ... in the view's order, 0 for none - and
 * the sums are taken per group. Nothing is written per cost, so a changed
 * rule restates every month the table keeps.
 *
 * What a rule reads that the costs do not carry is looked up in Postgres
 * first and handed to the read (CloudCostQueryFacts):
 *
 *   - each resource with owner teams or labels is named by a 64-bit hash of
 *     the key its costs are billed under (left(hex(MD5(resourceId)), 16)),
 *     and given a FACT CLASS: one per set of owner teams and labels, so a
 *     read carries a hash and a small number per resource, never its id;
 *   - a resource owned by several teams is split evenly: arrayJoin over its
 *     class's teams makes one part per team, each weighing 1/N, so a cost
 *     is never counted twice and the parts always add up to it;
 *   - an account's labels, and what makes a cost an App Platforms
 *     environment's or app's (CloudPlatformCosts), as plain predicates.
 *
 * Every text is compared in lower case (lowerUTF8), as CloudCostRules'
 * matcher compares it: the tests hold the two to the same answers.
 *
 * Every sum is of `spend`: the cost on the read's basis (#11007) - billed
 * (cost), amortized (amortizedCost) or net (netCost) - so a group's
 * figures, its shared costs' splits and the unallocated spend are all on
 * the one basis the page shows.
 */

// A resource's key as the facts name it: the first 16 hex digits of its MD5.
export const RESOURCE_HASH_SQL: string = "left(hex(MD5(resourceId)), 16)";

// The tag AWS puts on what an Elastic Beanstalk environment runs.
const ELASTIC_BEANSTALK_TAG: string = "elasticbeanstalk:environment-name";

/*
 * What makes a cost an App Platforms environment's: its platform's services
 * in its account and Region, or - an Elastic Beanstalk environment - what
 * carries Elastic Beanstalk's tag there. A cost with no Region is the
 * account's only environment of the platform's.
 */
export interface CloudCostEnvironmentFact {
  id: string;
  // Its platform (ManagedCloudPlatform): what its apps' resource ids are read by.
  platform: string;
  // The account's ID in its cloud, and the Region, in lower case.
  accountId: string;
  region: string;
  // The platform's billed services, in lower case; none for Elastic Beanstalk.
  services: Array<string>;
  isElasticBeanstalk: boolean;
  // Whether it is its account's only environment of its platform.
  isOnlyOfPlatformInAccount: boolean;
}

/*
 * What makes a cost an app's: its environment's, and billed to one of the
 * app's resources - or, on Elastic Beanstalk, tagged with its name.
 */
export interface CloudCostAppFact {
  id: string;
  environmentId: string;
  // The resources its platform bills it under, in lower case.
  resourceIds: Array<string>;
  // An Elastic Beanstalk app's environment name, in lower case.
  elasticBeanstalkName?: string | undefined;
}

export interface CloudCostQueryFacts {
  // Each resource's hash (RESOURCE_HASH_SQL), and its fact class beside it.
  resourceHashes: Array<string>;
  resourceClasses: Array<number>;
  // Per fact class (1-based): its owner teams, comma separated, lower case.
  classOwners: Array<string>;
  // Per fact class (1-based): its labels, lower case.
  classLabels: Array<Array<string>>;
  // CloudAccount ID (lower case) -> its labels (lower case).
  accountLabels: Map<string, Array<string>>;
  environments: Array<CloudCostEnvironmentFact>;
  apps: Array<CloudCostAppFact>;
  // Whether a cost is split between its resource's owner teams.
  splitsByOwner: boolean;
}

export function emptyCloudCostQueryFacts(): CloudCostQueryFacts {
  return {
    resourceHashes: [],
    resourceClasses: [],
    classOwners: [],
    classLabels: [],
    accountLabels: new Map(),
    environments: [],
    apps: [],
    splitsByOwner: false,
  };
}

export interface CloudCostAllocationSqlContext {
  databaseName: string;
  tableName: string;
  // The read's filter, the caller's permissions applied, after WHERE TRUE.
  where: Statement;
  groups: Array<{ rules: Array<CloudCostRule> }>;
  facts: CloudCostQueryFacts;
  // The cost basis summed: billed when absent.
  basis?: CloudCostBasis | undefined;
}

// The column a read sums, as `spend`: one of three, never the caller's text.
export function spendColumnOf(
  ctx: Pick<CloudCostAllocationSqlContext, "basis">,
): CloudCostBasisColumn {
  return getCloudCostBasisColumn(ctx.basis);
}

function texts(values: Array<string>): Statement {
  return SQL`${{
    type: TableColumnType.ArrayText,
    value: values,
    sendAsHex: true,
  }}`;
}

function text(value: string): Statement {
  return SQL`${{ type: TableColumnType.Text, value }}`;
}

function lowerAll(values: Array<string>): Array<string> {
  return values.map((value: string): string => {
    return value.toLowerCase();
  });
}

// "(a) OR (b)", or a false constant for none.
function anyOf(parts: Array<Statement>): Statement {
  if (parts.length === 0) {
    return SQL`0`;
  }

  const joined: Statement = SQL`(`;

  parts.forEach((part: Statement, index: number): void => {
    if (index > 0) {
      joined.append(SQL` OR `);
    }

    joined
      .append(SQL`(`)
      .append(part)
      .append(SQL`)`);
  });

  return joined.append(SQL`)`);
}

function allOf(parts: Array<Statement>): Statement {
  if (parts.length === 0) {
    return SQL`1`;
  }

  const joined: Statement = SQL`(`;

  parts.forEach((part: Statement, index: number): void => {
    if (index > 0) {
      joined.append(SQL` AND `);
    }

    joined
      .append(SQL`(`)
      .append(part)
      .append(SQL`)`);
  });

  return joined.append(SQL`)`);
}

function not(part: Statement): Statement {
  return SQL`NOT (`.append(part).append(SQL`)`);
}

// The text a field reads of a cost row, in lower case.
function fieldText(condition: CloudCostRuleCondition): Statement {
  switch (condition.field) {
    case CloudCostRuleField.Account:
      return SQL`lowerUTF8(toString(cloudAccountId))`;
    case CloudCostRuleField.Provider:
      return SQL`lowerUTF8(provider)`;
    case CloudCostRuleField.Service:
      return SQL`lowerUTF8(service)`;
    case CloudCostRuleField.Region:
      return SQL`lowerUTF8(region)`;
    case CloudCostRuleField.Resource:
      return SQL`lowerUTF8(resourceId)`;
    case CloudCostRuleField.Tag:
      return SQL`lowerUTF8(tags[`
        .append(text(condition.key || ""))
        .append(SQL`])`);
    case CloudCostRuleField.OwnerTeam:
      return SQL`ownerTeam`;
    default:
      // A Kubernetes namespace's or cluster's: no stored cost carries one.
      return SQL`''`;
  }
}

// Whether the text holds one of the values, by the operator's kind of match.
function textMatchesAny(condition: CloudCostRuleCondition): Statement {
  const values: Array<string> = lowerAll(condition.values);

  switch (condition.operator) {
    case CloudCostRuleOperator.Is:
    case CloudCostRuleOperator.IsNot:
      return SQL`has(`
        .append(texts(values))
        .append(SQL`, `)
        .append(fieldText(condition))
        .append(SQL`)`);
    case CloudCostRuleOperator.Contains:
    case CloudCostRuleOperator.DoesNotContain:
      return SQL`multiSearchAnyCaseInsensitiveUTF8(`
        .append(fieldText(condition))
        .append(SQL`, `)
        .append(texts(values))
        .append(SQL`)`);
    case CloudCostRuleOperator.StartsWith:
      return SQL`arrayExists(v -> startsWith(`
        .append(fieldText(condition))
        .append(SQL`, v), `)
        .append(texts(values))
        .append(SQL`)`);
    case CloudCostRuleOperator.EndsWith:
      return SQL`arrayExists(v -> endsWith(`
        .append(fieldText(condition))
        .append(SQL`, v), `)
        .append(texts(values))
        .append(SQL`)`);
    default:
      return SQL`0`;
  }
}

// The fact classes holding one of the labels, as text.
function classesWithLabels(
  facts: CloudCostQueryFacts,
  labels: Array<string>,
): Array<string> {
  const asked: Set<string> = new Set(lowerAll(labels));
  const classes: Array<string> = [];

  facts.classLabels.forEach(
    (classLabels: Array<string>, index: number): void => {
      if (
        classLabels.some((label: string): boolean => {
          return asked.has(label);
        })
      ) {
        classes.push(String(index + 1));
      }
    },
  );

  return classes;
}

function accountsWithLabels(
  facts: CloudCostQueryFacts,
  labels: Array<string>,
): Array<string> {
  const asked: Set<string> = new Set(lowerAll(labels));
  const accounts: Array<string> = [];

  for (const [accountId, accountLabels] of facts.accountLabels.entries()) {
    if (
      accountLabels.some((label: string): boolean => {
        return asked.has(label);
      })
    ) {
      accounts.push(accountId);
    }
  }

  return accounts;
}

export function environmentPredicate(
  environment: CloudCostEnvironmentFact,
): Statement {
  const where: Statement = SQL`lowerUTF8(accountId) = `.append(
    text(environment.accountId),
  );

  where
    .append(SQL` AND (lowerUTF8(region) = `)
    .append(text(environment.region))
    .append(
      environment.isOnlyOfPlatformInAccount ? SQL` OR region = '')` : SQL`)`,
    );

  if (environment.isElasticBeanstalk) {
    return where
      .append(SQL` AND tags[`)
      .append(text(ELASTIC_BEANSTALK_TAG))
      .append(SQL`] != ''`);
  }

  return where
    .append(SQL` AND has(`)
    .append(texts(environment.services.length ? environment.services : [""]))
    .append(SQL`, lowerUTF8(service))`);
}

function appPredicate(
  app: CloudCostAppFact,
  facts: CloudCostQueryFacts,
): Statement {
  const environment: CloudCostEnvironmentFact | undefined =
    facts.environments.find((candidate: CloudCostEnvironmentFact) => {
      return candidate.id === app.environmentId;
    });

  if (!environment) {
    return SQL`0`;
  }

  if (environment.isElasticBeanstalk) {
    return allOf([
      environmentPredicate(environment),
      SQL`lowerUTF8(tags[`
        .append(text(ELASTIC_BEANSTALK_TAG))
        .append(SQL`]) = `)
        .append(text(app.elasticBeanstalkName || "")),
    ]);
  }

  if (app.resourceIds.length === 0) {
    return SQL`0`;
  }

  return allOf([
    environmentPredicate(environment),
    SQL`has(`
      .append(texts(app.resourceIds))
      .append(SQL`, lowerUTF8(resourceId))`),
  ]);
}

// Whether a cost row matches a condition, as SQL.
export function conditionPredicate(
  condition: CloudCostRuleCondition,
  facts: CloudCostQueryFacts,
): Statement {
  const isNegated: boolean =
    condition.operator === CloudCostRuleOperator.IsNot ||
    condition.operator === CloudCostRuleOperator.DoesNotContain ||
    condition.operator === CloudCostRuleOperator.DoesNotExist;

  let holds: Statement;

  switch (condition.field) {
    case CloudCostRuleField.Label: {
      const classes: Array<string> = classesWithLabels(facts, condition.values);
      const accounts: Array<string> = accountsWithLabels(
        facts,
        condition.values,
      );
      const parts: Array<Statement> = [];

      if (classes.length > 0) {
        parts.push(
          SQL`has(`.append(texts(classes)).append(SQL`, toString(factClass))`),
        );
      }

      if (accounts.length > 0) {
        parts.push(
          SQL`has(`
            .append(texts(accounts))
            .append(SQL`, lowerUTF8(toString(cloudAccountId)))`),
        );
      }

      holds = anyOf(parts);
      break;
    }
    case CloudCostRuleField.Environment: {
      const asked: Set<string> = new Set(lowerAll(condition.values));
      holds = anyOf(
        facts.environments
          .filter((environment: CloudCostEnvironmentFact): boolean => {
            return asked.has(environment.id);
          })
          .map(environmentPredicate),
      );
      break;
    }
    case CloudCostRuleField.App: {
      const asked: Set<string> = new Set(lowerAll(condition.values));
      holds = anyOf(
        facts.apps
          .filter((app: CloudCostAppFact): boolean => {
            return asked.has(app.id);
          })
          .map((app: CloudCostAppFact): Statement => {
            return appPredicate(app, facts);
          }),
      );
      break;
    }
    default:
      if (
        condition.operator === CloudCostRuleOperator.Exists ||
        condition.operator === CloudCostRuleOperator.DoesNotExist
      ) {
        holds = SQL`tags[`
          .append(text(condition.key || ""))
          .append(SQL`] != ''`);
      } else {
        holds = textMatchesAny(condition);
      }
  }

  return isNegated ? not(holds) : holds;
}

export function rulePredicate(
  rule: CloudCostRule,
  facts: CloudCostQueryFacts,
): Statement {
  if (rule.conditions.length === 0) {
    return SQL`0`;
  }

  return allOf(
    rule.conditions.map((condition: CloudCostRuleCondition): Statement => {
      return conditionPredicate(condition, facts);
    }),
  );
}

export function rulesPredicate(
  rules: Array<CloudCostRule>,
  facts: CloudCostQueryFacts,
): Statement {
  return anyOf(
    rules.map((rule: CloudCostRule): Statement => {
      return rulePredicate(rule, facts);
    }),
  );
}

/*
 * The group a cost row falls into: the first whose rules match it (1, 2,
 * ...), or 0. A group with no rules is left out: it takes nothing.
 */
export function groupNumberExpression(
  ctx: Pick<CloudCostAllocationSqlContext, "groups" | "facts">,
): Statement {
  const branches: Array<{ number: number; predicate: Statement }> = [];

  ctx.groups.forEach(
    (group: { rules: Array<CloudCostRule> }, index: number): void => {
      if (group.rules.length > 0) {
        branches.push({
          number: index + 1,
          predicate: rulesPredicate(group.rules, ctx.facts),
        });
      }
    },
  );

  if (branches.length === 0) {
    return SQL`toUInt32(0)`;
  }

  const expression: Statement = SQL`multiIf(`;

  for (const branch of branches) {
    // The group's number is the read's own, never a request's: written in.
    expression
      .append(branch.predicate)
      .append(SQL`, toUInt32(`)
      .append(`${Math.trunc(branch.number)}`)
      .append(SQL`), `);
  }

  return expression.append(SQL`toUInt32(0))`);
}

// Whether any fact a read needs is about resources: only then is it looked up.
function readsResourceFacts(facts: CloudCostQueryFacts): boolean {
  return facts.resourceHashes.length > 0 || facts.splitsByOwner;
}

/*
 * The cost rows of a read, each with what its rules read beside it: its
 * fact class, and - split between its owner teams - one row per part, its
 * owner team and its weight. `extraWhere` narrows the rows further (a
 * window, a partition of the resources).
 */
export function sourceStatement(
  ctx: CloudCostAllocationSqlContext,
  extraWhere?: Statement | undefined,
): Statement {
  const statement: Statement = SQL`SELECT day, `
    .append(spendColumnOf(ctx))
    .append(
      SQL` AS spend, cloudAccountId, provider, accountId, service, region, resourceId, tags`,
    );

  if (readsResourceFacts(ctx.facts)) {
    statement
      .append(SQL`, toInt32OrZero(transform(`)
      .append(RESOURCE_HASH_SQL)
      .append(SQL`, `)
      .append(
        texts(
          ctx.facts.resourceHashes.length ? ctx.facts.resourceHashes : [""],
        ),
      )
      .append(SQL`, `)
      .append(
        texts(
          ctx.facts.resourceHashes.length
            ? ctx.facts.resourceClasses.map((value: number): string => {
                return String(value);
              })
            : ["0"],
        ),
      )
      .append(SQL`, '0')) AS factClass`);
  } else {
    statement.append(SQL`, toInt32(0) AS factClass`);
  }

  if (ctx.facts.splitsByOwner && ctx.facts.classOwners.length > 0) {
    statement
      .append(SQL`, arrayFilter(x -> x != '', splitByChar(',', arrayElement(`)
      .append(texts(["", ...ctx.facts.classOwners]))
      .append(SQL`, factClass + 1))) AS owners`)
      .append(
        SQL`, arrayJoin(if(empty(owners), [''], owners)) AS ownerTeam, if(empty(owners), 1.0, 1.0 / length(owners)) AS weight`,
      );
  } else {
    statement.append(SQL`, '' AS ownerTeam, 1.0 AS weight`);
  }

  statement
    .append(` FROM ${ctx.databaseName}.${ctx.tableName}`)
    .append(SQL` WHERE TRUE `)
    .append(ctx.where);

  if (extraWhere) {
    statement
      .append(SQL` AND (`)
      .append(extraWhere)
      .append(SQL`)`);
  }

  return statement;
}

// The days a window covers, as a filter: whole UTC days, both ends included.
export function windowFilter(data: { start: Date; lastDay: Date }): Statement {
  return SQL`day >= ${{
    type: TableColumnType.Date,
    value: data.start,
  }} AND day <= ${{
    type: TableColumnType.Date,
    value: data.lastDay,
  }}`;
}

// Settings every allocation read runs with: the API's time limit, four threads.
function settings(): string {
  return getQuerySettings({
    maxExecutionTimeInSeconds: 45,
    additionalSettings: { max_threads: 4 },
  });
}

/*
 * What each group took, bucket by bucket: by the day, or by the month. A
 * bucket is its first day ("2026-11-01"); group 0 is the unallocated spend.
 */
export function amountsStatement(
  ctx: CloudCostAllocationSqlContext,
  data: { byMonth: boolean; extraWhere?: Statement | undefined },
): Statement {
  const bucket: string = data.byMonth
    ? "toString(toStartOfMonth(toDate(day, 'UTC')))"
    : "toString(toDate(day, 'UTC'))";

  return SQL`SELECT groupNumber, bucket, sum(spend * weight) AS amount FROM (SELECT `
    .append(groupNumberExpression(ctx))
    .append(` AS groupNumber, ${bucket} AS bucket, spend, weight FROM (`)
    .append(sourceStatement(ctx, data.extraWhere))
    .append(SQL`)) GROUP BY groupNumber, bucket ORDER BY groupNumber, bucket`)
    .append(settings());
}

/*
 * What each group's rules match in a window before earlier groups take
 * their part: one sum per group (wouldMatch1, wouldMatch2, ...). A view
 * whose groups overlap says how much of each an earlier group took.
 */
export function wouldMatchStatement(
  ctx: CloudCostAllocationSqlContext,
  data: { extraWhere?: Statement | undefined },
): Statement {
  const statement: Statement = SQL`SELECT `;
  let first: boolean = true;

  ctx.groups.forEach(
    (group: { rules: Array<CloudCostRule> }, index: number): void => {
      if (!first) {
        statement.append(SQL`, `);
      }

      first = false;
      statement
        .append(SQL`sumIf(spend * weight, `)
        .append(
          group.rules.length > 0
            ? rulesPredicate(group.rules, ctx.facts)
            : SQL`0`,
        )
        .append(` ) AS wouldMatch${index + 1}`);
    },
  );

  if (first) {
    statement.append(SQL`0 AS nothing`);
  }

  return statement
    .append(SQL` FROM (`)
    .append(sourceStatement(ctx, data.extraWhere))
    .append(SQL`)`)
    .append(settings());
}

// What a group's costs (0: the unallocated) are made of, the costliest first.
export type CloudCostAllocationDimension =
  | "service"
  | "cloudAccountId"
  | "resourceId"
  | "ownerTeam";

const DIMENSION_SQL: Readonly<Record<CloudCostAllocationDimension, string>> = {
  service: "service",
  cloudAccountId: "lowerUTF8(toString(cloudAccountId))",
  resourceId: "resourceId",
  ownerTeam: "ownerTeam",
};

export function topStatement(
  ctx: CloudCostAllocationSqlContext,
  data: {
    groupNumber: number;
    dimension: CloudCostAllocationDimension;
    limit: number;
    extraWhere?: Statement | undefined;
  },
): Statement {
  const statement: Statement =
    SQL`SELECT key, sum(spend * weight) AS amount FROM (SELECT `
      .append(groupNumberExpression(ctx))
      .append(
        ` AS groupNumber, ${DIMENSION_SQL[data.dimension]} AS key, spend, weight FROM (`,
      )
      .append(sourceStatement(ctx, data.extraWhere))
      .append(
        SQL`)) WHERE groupNumber = ${{
          type: TableColumnType.Number,
          value: data.groupNumber,
        }}`,
      );

  if (data.dimension === "ownerTeam") {
    statement.append(SQL` AND key != ''`);
  }

  return statement
    .append(
      SQL` GROUP BY key ORDER BY amount DESC, key ASC LIMIT ${{
        type: TableColumnType.Number,
        value: data.limit,
      }}`,
    )
    .append(settings());
}

// The tag values the unallocated spend (or a group's) carries, the costliest first.
export function topTagValuesStatement(
  ctx: CloudCostAllocationSqlContext,
  data: {
    groupNumber: number;
    limit: number;
    extraWhere?: Statement | undefined;
  },
): Statement {
  return SQL`SELECT tagKey, tagValue, sum(c) AS amount FROM (SELECT `
    .append(groupNumberExpression(ctx))
    .append(SQL` AS groupNumber, spend * weight AS c, tags FROM (`)
    .append(sourceStatement(ctx, data.extraWhere))
    .append(
      SQL`)) ARRAY JOIN mapKeys(tags) AS tagKey, mapValues(tags) AS tagValue WHERE groupNumber = ${{
        type: TableColumnType.Number,
        value: data.groupNumber,
      }} AND tagValue != '' GROUP BY tagKey, tagValue ORDER BY amount DESC, tagKey ASC, tagValue ASC LIMIT ${{
        type: TableColumnType.Number,
        value: data.limit,
      }}`,
    )
    .append(settings());
}

/*
 * The distinct tag values of one key in the costs a read covers, the
 * costliest first: a view made per tag value makes a group for each.
 */
export function tagValuesStatement(data: {
  databaseName: string;
  tableName: string;
  where: Statement;
  tagKey: string;
  limit: number;
}): Statement {
  return SQL`SELECT tags[`
    .append(text(data.tagKey))
    .append(SQL`] AS value, sum(cost) AS amount FROM `)
    .append(`${data.databaseName}.${data.tableName}`)
    .append(SQL` WHERE TRUE `)
    .append(data.where)
    .append(SQL` AND tags[`)
    .append(text(data.tagKey))
    .append(
      SQL`] != '' GROUP BY value ORDER BY amount DESC, value ASC LIMIT ${{
        type: TableColumnType.Number,
        value: data.limit,
      }}`,
    )
    .append(settings());
}

/*
 * The App Platforms services' costs by account, Region, service and
 * resource: what an app's resources are found in (CloudPlatformCosts'
 * getCloudPlatformBilledAppName), for a view whose rules name an app.
 */
export function platformResourcesStatement(data: {
  databaseName: string;
  tableName: string;
  where: Statement;
  services: Array<string>;
}): Statement {
  return SQL`SELECT accountId, region, service, resourceId FROM `
    .append(`${data.databaseName}.${data.tableName}`)
    .append(SQL` WHERE TRUE `)
    .append(data.where)
    .append(SQL` AND resourceId != '' AND has(`)
    .append(texts(lowerAll(data.services)))
    .append(
      SQL`, lowerUTF8(service)) GROUP BY accountId, region, service, resourceId LIMIT 50000`,
    )
    .append(settings());
}
