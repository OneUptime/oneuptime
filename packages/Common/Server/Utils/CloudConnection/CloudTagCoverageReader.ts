import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudRequiredTag from "../../../Models/DatabaseModels/CloudRequiredTag";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import CloudTagCoverageDay from "../../../Models/DatabaseModels/CloudTagCoverageDay";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  CloudAccountCostSummary,
  addUtcDays,
  getCloudCostResourceKey,
  getMostCommonCloudCurrency,
  readCloudAccountCostSummary,
  roundCost,
  startOfUtcDay,
  toCloudCostDay,
} from "../../../Types/Cloud/CloudCost";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CloudRequiredTagRule,
  CloudTagCoverageCount,
  getCloudRequiredTagsForAccount,
  normalizeCloudTagKey,
} from "../../../Types/Cloud/CloudRequiredTags";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import {
  CLOUD_TAG_COVERAGE_DAYS,
  CLOUD_TAG_TREND_WEEKS,
  CLOUD_TAG_UNTAGGED_LIMIT,
  CloudTagAccountCoverageJSON,
  CloudTagCoverageBreakdown,
  CloudTagCoverageJSON,
  CloudTagSpendState,
  CloudTagTrendPointJSON,
  CloudTagUntaggedResourceJSON,
} from "../../../Types/Cloud/CloudTagCoverage";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import CloudAccountService from "../../Services/CloudAccountService";
import CloudCostService from "../../Services/CloudCostService";
import CloudRequiredTagService from "../../Services/CloudRequiredTagService";
import CloudResourceService from "../../Services/CloudResourceService";
import CloudTagCoverageDayService from "../../Services/CloudTagCoverageDayService";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import QueryHelper from "../../Types/Database/QueryHelper";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import {
  getCostAllTagsCondition,
  getCostTagCondition,
  getResourceAllTagsConditionSql,
  getResourceTagConditionSql,
} from "./CloudTagConditions";
import CloudTagSuggestions, {
  CLOUD_TAG_SUBJECT_SELECT,
  CloudTagSubject,
  CloudTagSubjectFindings,
  toCloudTagSubject,
} from "./CloudTagSuggestions";

/*
 * HOW MUCH OF THE CLOUDS' SPEND AND RESOURCES CARRY THEIR REQUIRED TAGS
 * (#11012), for Cloud > Tags and an account's Tags (CloudTagCoverage's
 * shapes), read as the reader may read the accounts:
 *
 *   - spend: one read of the costs of the last 30 days, grouped by account
 *     and currency, summing what carries each required tag and what
 *     carries every one - each account by its own required tags
 *     (CloudTagConditions over CloudCost.tags);
 *   - resources: one read of the listed resources, grouped by account, as
 *     Postgres counts them (CloudTagConditions over cloudTags), never read
 *     out row by row;
 *   - the trend: the costs by week, and each account's daily count
 *     (CloudTagCoverageDay), the last day of each week;
 *   - the resources that lack a tag: the first few thousand Postgres
 *     names, priced by one read of the costs, the costliest first, each
 *     with its findings and suggestions (CloudTagSuggestions), read again
 *     as the reader so no name they may not read is shown.
 */

const COST_TABLE: string = AnalyticsTableName.CloudCost;

const COST_QUERY_SETTINGS: string = getQuerySettings({
  maxExecutionTimeInSeconds: 60,
  timeoutOverflowMode: "throw",
});

// The resources without a required tag priced at most, to find the costliest.
export const CLOUD_TAG_UNTAGGED_PRICED: number = 2000;

// The accounts one page reads at most.
const ACCOUNTS_READ: number = 1000;

// A resource's tags, as every Postgres read here names them.
const RESOURCE_TAGS_COLUMN: string = `r."cloudTags"`;

// An account as the resource reads tell its resources apart.
export interface CloudTagAccountKey {
  provider: string;
  // Its id in its cloud.
  accountId: string;
  // Its CloudAccount row.
  rowId: string;
}

interface AccountRow {
  id: ObjectID;
  name: string;
  provider: string;
  accountId: string;
  costSummary: CloudAccountCostSummary | null;
}

// One account's spend in one currency, as the costs read it.
interface SpendRow {
  account: string;
  currency: string;
  total: number;
  // Billed to a resource or carrying tags: what could carry a required tag.
  taggable: number;
  covered: number;
  // By rule index.
  byRule: Array<number>;
}

// One account's resources, as Postgres counts them.
interface ResourceCountRow {
  total: number;
  covered: number;
  byRule: Array<number>;
}

function toRule(row: CloudRequiredTag): CloudRequiredTagRule | null {
  const key: string = (row.tagKey || "").trim();

  if (!row.id || !key) {
    return null;
  }

  return {
    id: row.id.toString(),
    key,
    allowedValues: Array.isArray(row.allowedValues)
      ? row.allowedValues.filter((value: unknown): value is string => {
          return typeof value === "string";
        })
      : [],
    cloudAccountId: row.cloudAccountId?.toString() || null,
  };
}

function numberOf(value: unknown): number {
  const number: number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// The Monday of a day's week, at its start (UTC).
export function startOfUtcWeek(date: Date): Date {
  const day: Date = startOfUtcDay(date);
  // getUTCDay: Sunday 0 ... Saturday 6; Monday starts a week.
  const offset: number = (day.getUTCDay() + 6) % 7;
  return addUtcDays(day, -offset);
}

// The key a rule is reported under: its key in lower case.
function keyOf(rule: CloudRequiredTagRule): string {
  return normalizeCloudTagKey(rule.key);
}

export default class CloudTagCoverageReader {
  // The project's required tags, as the pure module reads them.
  public static async readRules(
    projectId: ObjectID,
  ): Promise<Array<CloudRequiredTagRule>> {
    const rows: Array<CloudRequiredTag> = await CloudRequiredTagService.findBy({
      query: { projectId },
      select: {
        _id: true,
        tagKey: true,
        allowedValues: true,
        cloudAccountId: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      sort: { createdAt: SortOrder.Ascending },
      props: { isRoot: true },
    });

    return rows
      .map(toRule)
      .filter((rule: CloudRequiredTagRule | null): boolean => {
        return Boolean(rule);
      }) as Array<CloudRequiredTagRule>;
  }

  /*
   * ClickHouse: each account's spend over [start, end), by currency, with
   * what carries each rule's tag and every tag of its account.
   */
  public static buildSpendStatement(data: {
    projectId: ObjectID;
    accountIds: Array<string>;
    rules: Array<CloudRequiredTagRule>;
    start: Date;
    end: Date;
  }): Statement {
    const statement: Statement = SQL`SELECT cloudAccountId AS account, currency AS currencyCode, sum(cost) AS total, sumIf(cost, resourceId != '' OR notEmpty(tags)) AS taggable`;

    data.rules.forEach((rule: CloudRequiredTagRule, index: number) => {
      statement.append(SQL`, sumIf(cost, `);
      statement.append(getCostTagCondition(rule));
      statement.append(`) AS r${index}`);
    });

    statement.append(SQL`, sumIf(cost, `);
    statement.append(
      CloudTagCoverageReader.buildCostCoveredCondition({
        accountIds: data.accountIds,
        rules: data.rules,
      }),
    );
    statement.append(SQL`) AS covered`);

    statement.append(
      SQL` FROM ${COST_TABLE} WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND has(${{
        type: TableColumnType.ArrayText,
        value: data.accountIds,
      }}, cloudAccountId) AND day >= ${{
        type: TableColumnType.Date,
        value: data.start,
      }} AND day < ${{
        type: TableColumnType.Date,
        value: data.end,
      }} GROUP BY account, currencyCode`,
    );
    statement.append(COST_QUERY_SETTINGS);

    return statement;
  }

  /*
   * Whether a cost carries every required tag of its own account: each
   * account with tags of its own by those, every other by the project's.
   */
  public static buildCostCoveredCondition(data: {
    accountIds: Array<string>;
    rules: Array<CloudRequiredTagRule>;
  }): Statement {
    const projectRules: Array<CloudRequiredTagRule> =
      getCloudRequiredTagsForAccount(data.rules, null);
    const ownAccounts: Array<string> = data.accountIds.filter(
      (accountId: string): boolean => {
        return data.rules.some((rule: CloudRequiredTagRule): boolean => {
          return (
            (rule.cloudAccountId || "").toLowerCase() ===
            accountId.toLowerCase()
          );
        });
      },
    );

    if (ownAccounts.length === 0) {
      return getCostAllTagsCondition(projectRules);
    }

    const statement: Statement = SQL`multiIf(`;

    for (const accountId of ownAccounts) {
      statement.append(
        SQL`cloudAccountId = ${{
          type: TableColumnType.Text,
          value: accountId,
        }}, `,
      );
      statement.append(
        getCostAllTagsCondition(
          getCloudRequiredTagsForAccount(data.rules, accountId),
        ),
      );
      statement.append(SQL`, `);
    }

    statement.append(getCostAllTagsCondition(projectRules));
    statement.append(SQL`)`);

    return statement;
  }

  // ClickHouse: the costs by week over [start, end) in one currency.
  public static buildTrendStatement(data: {
    projectId: ObjectID;
    accountIds: Array<string>;
    rules: Array<CloudRequiredTagRule>;
    currency: string;
    start: Date;
    end: Date;
  }): Statement {
    const statement: Statement = SQL`SELECT toString(toMonday(day)) AS week, sum(cost) AS total, sumIf(cost, `;

    statement.append(
      CloudTagCoverageReader.buildCostCoveredCondition({
        accountIds: data.accountIds,
        rules: data.rules,
      }),
    );
    statement.append(
      SQL`) AS covered FROM ${COST_TABLE} WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND has(${{
        type: TableColumnType.ArrayText,
        value: data.accountIds,
      }}, cloudAccountId) AND currency = ${{
        type: TableColumnType.Text,
        value: data.currency,
      }} AND day >= ${{
        type: TableColumnType.Date,
        value: data.start,
      }} AND day < ${{
        type: TableColumnType.Date,
        value: data.end,
      }} GROUP BY week ORDER BY week`,
    );
    statement.append(COST_QUERY_SETTINGS);

    return statement;
  }

  // ClickHouse: what each of these resources cost over [start, end).
  public static buildResourceSpendStatement(data: {
    projectId: ObjectID;
    accountIds: Array<string>;
    resourceKeys: Array<string>;
    start: Date;
    end: Date;
  }): Statement {
    const statement: Statement = SQL`SELECT resourceId AS resourceKey, currency AS currencyCode, sum(cost) AS total FROM ${COST_TABLE} WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND has(${{
      type: TableColumnType.ArrayText,
      value: data.accountIds,
    }}, cloudAccountId) AND has(${{
      type: TableColumnType.ArrayText,
      value: data.resourceKeys,
    }}, resourceId) AND day >= ${{
      type: TableColumnType.Date,
      value: data.start,
    }} AND day < ${{
      type: TableColumnType.Date,
      value: data.end,
    }} GROUP BY resourceKey, currencyCode`;

    statement.append(COST_QUERY_SETTINGS);

    return statement;
  }

  private static async query(statement: Statement): Promise<Array<JSONObject>> {
    const result: Results = await CloudCostService.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || []) as Array<JSONObject>;
  }

  public static readSpendRows(
    rows: Array<JSONObject>,
    ruleCount: number,
  ): Array<SpendRow> {
    return rows.map((row: JSONObject): SpendRow => {
      const byRule: Array<number> = [];

      for (let index: number = 0; index < ruleCount; index++) {
        byRule.push(numberOf(row[`r${index}`]));
      }

      return {
        account: String(row["account"] || ""),
        currency: String(row["currencyCode"] || ""),
        total: numberOf(row["total"]),
        taggable: numberOf(row["taggable"]),
        covered: numberOf(row["covered"]),
        byRule,
      };
    });
  }

  /*
   * Postgres: whether a resource (r) carries every required tag of its own
   * account - by account where it has tags of its own, else the project's.
   * Its parameters are pushed onto `params`.
   */
  public static buildResourceCoveredConditionSql(data: {
    accounts: Array<CloudTagAccountKey>;
    rules: Array<CloudRequiredTagRule>;
    params: Array<unknown>;
  }): string {
    const tagsColumn: string = RESOURCE_TAGS_COLUMN;
    const cases: Array<string> = [];

    for (const account of data.accounts) {
      const own: boolean = data.rules.some(
        (rule: CloudRequiredTagRule): boolean => {
          return (
            (rule.cloudAccountId || "").toLowerCase() ===
            account.rowId.toLowerCase()
          );
        },
      );

      if (!own) {
        continue;
      }

      data.params.push(account.provider);
      const providerParam: string = `$${data.params.length}`;
      data.params.push(account.accountId.toLowerCase());
      const accountParam: string = `$${data.params.length}`;

      cases.push(
        `WHEN r."cloudProvider" = ${providerParam} AND lower(r."cloudAccountId") = ${accountParam} THEN ${getResourceAllTagsConditionSql(
          {
            rules: getCloudRequiredTagsForAccount(data.rules, account.rowId),
            params: data.params,
            tagsColumn,
          },
        )}`,
      );
    }

    const defaultCondition: string = getResourceAllTagsConditionSql({
      rules: getCloudRequiredTagsForAccount(data.rules, null),
      params: data.params,
      tagsColumn,
    });

    return cases.length > 0
      ? `(CASE ${cases.join(" ")} ELSE ${defaultCondition} END)`
      : defaultCondition;
  }

  /*
   * Postgres: the listed resources of these accounts - their first two
   * parameters, the project and the accounts' ids in lower case - and the
   * kind, as the last parameter pushed.
   */
  private static listedResourcesWhere(data: {
    projectId: ObjectID;
    accounts: Array<CloudTagAccountKey>;
    params: Array<unknown>;
  }): string {
    data.params.push(CloudResourceKind.Resource);
    const kindParam: string = `$${data.params.length}`;

    return `r."projectId" = $1 AND r."deletedAt" IS NULL
        AND COALESCE(r."isArchived", false) = false
        AND r."cloudResourceKind" = ${kindParam}
        AND r."cloudConnectionId" IS NOT NULL
        AND lower(r."cloudAccountId") = ANY($2::text[])`;
  }

  private static firstParams(data: {
    projectId: ObjectID;
    accounts: Array<CloudTagAccountKey>;
  }): Array<unknown> {
    return [
      data.projectId.toString(),
      Array.from(
        new Set(
          data.accounts.map((account: CloudTagAccountKey): string => {
            return account.accountId.toLowerCase();
          }),
        ),
      ),
    ];
  }

  /*
   * Postgres: the listed resources of these accounts, counted by account,
   * with what carries each rule's tag and every tag of its account.
   */
  public static buildResourceCountSql(data: {
    projectId: ObjectID;
    accounts: Array<CloudTagAccountKey>;
    rules: Array<CloudRequiredTagRule>;
  }): { sql: string; params: Array<unknown> } {
    const params: Array<unknown> = CloudTagCoverageReader.firstParams(data);
    const columns: Array<string> = data.rules.map(
      (rule: CloudRequiredTagRule, index: number): string => {
        return `count(*) FILTER (WHERE ${getResourceTagConditionSql({
          rule,
          params,
          tagsColumn: RESOURCE_TAGS_COLUMN,
        })})::int AS "r${index}"`;
      },
    );
    const covered: string =
      CloudTagCoverageReader.buildResourceCoveredConditionSql({
        accounts: data.accounts,
        rules: data.rules,
        params,
      });
    const where: string = CloudTagCoverageReader.listedResourcesWhere({
      projectId: data.projectId,
      accounts: data.accounts,
      params,
    });

    const sql: string = `SELECT r."cloudProvider" AS "provider", lower(r."cloudAccountId") AS "account", count(*)::int AS "total"${
      columns.length > 0 ? `, ${columns.join(", ")}` : ""
    }, count(*) FILTER (WHERE ${covered})::int AS "covered"
      FROM "CloudResource" r
      WHERE ${where}
      GROUP BY 1, 2`;

    return { sql, params };
  }

  /*
   * Postgres: the ids of the listed resources of these accounts that lack
   * a required tag of their account, at most `limit`.
   */
  public static buildUntaggedSql(data: {
    projectId: ObjectID;
    accounts: Array<CloudTagAccountKey>;
    rules: Array<CloudRequiredTagRule>;
    limit: number;
  }): { sql: string; params: Array<unknown> } {
    const params: Array<unknown> = CloudTagCoverageReader.firstParams(data);
    const covered: string =
      CloudTagCoverageReader.buildResourceCoveredConditionSql({
        accounts: data.accounts,
        rules: data.rules,
        params,
      });
    const where: string = CloudTagCoverageReader.listedResourcesWhere({
      projectId: data.projectId,
      accounts: data.accounts,
      params,
    });

    return {
      sql: `SELECT r."_id" AS "id", r."cloudProvider" AS "provider", r."providerResourceId" AS "providerResourceId"
        FROM "CloudResource" r
        WHERE ${where} AND NOT ${covered}
        LIMIT ${Math.max(1, Math.floor(data.limit))}`,
      params,
    };
  }

  public static async read(data: {
    projectId: ObjectID;
    cloudAccountId?: ObjectID | null | undefined;
    props: DatabaseCommonInteractionProps;
    now: Date;
  }): Promise<CloudTagCoverageJSON> {
    const rules: Array<CloudRequiredTagRule> =
      await CloudTagCoverageReader.readRules(data.projectId);

    // The accounts the reader may read: every count is of these only.
    const accountRows: Array<CloudAccount> = await CloudAccountService.findBy({
      query: {
        projectId: data.projectId,
        ...(data.cloudAccountId ? { _id: data.cloudAccountId } : {}),
      },
      select: {
        _id: true,
        name: true,
        provider: true,
        accountId: true,
        costSummary: true,
      },
      skip: 0,
      limit: ACCOUNTS_READ,
      props: data.props,
    });
    const accounts: Array<AccountRow> = accountRows
      .filter((row: CloudAccount): boolean => {
        return Boolean(row.id && row.accountId);
      })
      .map((row: CloudAccount): AccountRow => {
        return {
          id: row.id!,
          name: (row.name || row.accountId || "").trim(),
          provider: (row.provider as string) || "",
          accountId: (row.accountId || "").trim(),
          costSummary: readCloudAccountCostSummary(row.costSummary),
        };
      });

    const currencies: Map<string, number> = new Map();

    for (const account of accounts) {
      if (account.costSummary?.currency) {
        currencies.set(
          account.costSummary.currency,
          (currencies.get(account.costSummary.currency) || 0) + 1,
        );
      }
    }

    const currency: string = getMostCommonCloudCurrency(currencies);
    const empty: CloudTagCoverageJSON = {
      hasRules: rules.length > 0,
      currency,
      periodDays: CLOUD_TAG_COVERAGE_DAYS,
      accounts: [],
      total: {
        spend: null,
        resources: { all: { covered: 0, total: 0 }, byKey: {} },
      },
      trend: [],
      untagged: [],
      untaggedCount: 0,
    };

    if (rules.length === 0 || accounts.length === 0) {
      return empty;
    }

    const accountIds: Array<string> = accounts.map(
      (account: AccountRow): string => {
        return account.id.toString();
      },
    );
    const end: Date = addUtcDays(startOfUtcDay(data.now), 1);
    const start: Date = addUtcDays(end, -CLOUD_TAG_COVERAGE_DAYS);

    const [spendRows, resourceRows]: [
      Array<SpendRow>,
      Map<string, ResourceCountRow>,
    ] = await Promise.all([
      CloudTagCoverageReader.query(
        CloudTagCoverageReader.buildSpendStatement({
          projectId: data.projectId,
          accountIds,
          rules,
          start,
          end,
        }),
      ).then((rows: Array<JSONObject>): Array<SpendRow> => {
        return CloudTagCoverageReader.readSpendRows(rows, rules.length);
      }),
      CloudTagCoverageReader.countResources({
        projectId: data.projectId,
        accounts,
        rules,
      }),
    ]);

    const result: CloudTagCoverageJSON = { ...empty };
    const totalSpend: CloudTagCoverageBreakdown = {
      all: { covered: 0, total: 0 },
      byKey: {},
    };
    const totalResources: CloudTagCoverageBreakdown = {
      all: { covered: 0, total: 0 },
      byKey: {},
    };
    let isAnySpendMeasured: boolean = false;
    const measuredAccounts: Array<string> = [];

    const add: (
      target: Record<string, CloudTagCoverageCount>,
      key: string,
      count: CloudTagCoverageCount,
    ) => void = (
      target: Record<string, CloudTagCoverageCount>,
      key: string,
      count: CloudTagCoverageCount,
    ): void => {
      const existing: CloudTagCoverageCount = target[key] || {
        covered: 0,
        total: 0,
      };
      target[key] = {
        covered: existing.covered + count.covered,
        total: existing.total + count.total,
      };
    };

    for (const account of accounts) {
      const id: string = account.id.toString();
      const accountRules: Array<CloudRequiredTagRule> =
        getCloudRequiredTagsForAccount(rules, id);
      const ruleIndex: (rule: CloudRequiredTagRule) => number = (
        rule: CloudRequiredTagRule,
      ): number => {
        return rules.findIndex((candidate: CloudRequiredTagRule): boolean => {
          return candidate.id === rule.id;
        });
      };

      // Its spend in its own main currency.
      const own: Array<SpendRow> = spendRows
        .filter((row: SpendRow): boolean => {
          return row.account === id;
        })
        .sort((a: SpendRow, b: SpendRow): number => {
          return b.total - a.total;
        });
      const main: SpendRow | undefined = own[0];
      let spendState: CloudTagSpendState = CloudTagSpendState.NoCosts;
      let spend: CloudTagCoverageBreakdown | null = null;

      if (main && main.total > 0) {
        if (account.provider === CloudProvider.AWS && main.taggable <= 0) {
          spendState = CloudTagSpendState.AwsWithoutResources;
        } else {
          spendState = CloudTagSpendState.Measured;
          spend = {
            all: { covered: main.covered, total: main.total },
            byKey: {},
          };

          for (const rule of accountRules) {
            const index: number = ruleIndex(rule);

            spend.byKey[keyOf(rule)] = {
              covered: index >= 0 ? main.byRule[index] || 0 : 0,
              total: main.total,
            };
          }

          if (main.currency === currency) {
            isAnySpendMeasured = true;
            measuredAccounts.push(id);
            totalSpend.all.covered += main.covered;
            totalSpend.all.total += main.total;

            for (const [key, count] of Object.entries(spend.byKey)) {
              add(totalSpend.byKey, key, count);
            }
          }
        }
      }

      const counted: ResourceCountRow | undefined = resourceRows.get(
        `${account.provider}|${account.accountId.toLowerCase()}`,
      );
      const resources: CloudTagCoverageBreakdown = {
        all: {
          covered: counted?.covered || 0,
          total: counted?.total || 0,
        },
        byKey: {},
      };

      for (const rule of accountRules) {
        const index: number = ruleIndex(rule);

        resources.byKey[keyOf(rule)] = {
          covered: counted && index >= 0 ? counted.byRule[index] || 0 : 0,
          total: counted?.total || 0,
        };
      }

      totalResources.all.covered += resources.all.covered;
      totalResources.all.total += resources.all.total;

      for (const [key, count] of Object.entries(resources.byKey)) {
        add(totalResources.byKey, key, count);
      }

      const roundSpend: (
        breakdown: CloudTagCoverageBreakdown | null,
      ) => CloudTagCoverageBreakdown | null = (
        breakdown: CloudTagCoverageBreakdown | null,
      ): CloudTagCoverageBreakdown | null => {
        if (!breakdown) {
          return null;
        }

        const byKey: Record<string, CloudTagCoverageCount> = {};

        for (const [key, count] of Object.entries(breakdown.byKey)) {
          byKey[key] = {
            covered: roundCost(count.covered),
            total: roundCost(count.total),
          };
        }

        return {
          all: {
            covered: roundCost(breakdown.all.covered),
            total: roundCost(breakdown.all.total),
          },
          byKey,
        };
      };

      const accountJson: CloudTagAccountCoverageJSON = {
        cloudAccountId: id,
        name: account.name,
        provider: account.provider,
        accountId: account.accountId,
        keys: accountRules.map((rule: CloudRequiredTagRule): string => {
          return rule.key;
        }),
        spendState,
        currency: main?.currency || currency,
        spend: roundSpend(spend),
        resources,
      };

      result.accounts.push(accountJson);
    }

    result.total = {
      spend: isAnySpendMeasured
        ? {
            all: {
              covered: roundCost(totalSpend.all.covered),
              total: roundCost(totalSpend.all.total),
            },
            byKey: Object.fromEntries(
              Object.entries(totalSpend.byKey).map(
                ([key, count]: [string, CloudTagCoverageCount]) => {
                  return [
                    key,
                    {
                      covered: roundCost(count.covered),
                      total: roundCost(count.total),
                    },
                  ];
                },
              ),
            ),
          }
        : null,
      resources: totalResources,
    };

    const [trend, untagged]: [
      Array<CloudTagTrendPointJSON>,
      { list: Array<CloudTagUntaggedResourceJSON>; count: number },
    ] = await Promise.all([
      CloudTagCoverageReader.readTrend({
        projectId: data.projectId,
        accountIds,
        measuredAccountIds: measuredAccounts,
        rules,
        currency,
        now: data.now,
      }),
      CloudTagCoverageReader.readUntagged({
        projectId: data.projectId,
        accounts,
        rules,
        currency,
        start,
        end,
        props: data.props,
        countedUntagged: result.accounts.reduce(
          (sum: number, account: CloudTagAccountCoverageJSON): number => {
            return (
              sum + account.resources.all.total - account.resources.all.covered
            );
          },
          0,
        ),
      }),
    ]);

    result.trend = trend;
    result.untagged = untagged.list;
    result.untaggedCount = untagged.count;

    return result;
  }

  // The accounts' resources counted, by "<provider>|<account id in lower case>".
  private static async countResources(data: {
    projectId: ObjectID;
    accounts: Array<AccountRow>;
    rules: Array<CloudRequiredTagRule>;
  }): Promise<Map<string, ResourceCountRow>> {
    const built: { sql: string; params: Array<unknown> } =
      CloudTagCoverageReader.buildResourceCountSql({
        projectId: data.projectId,
        accounts: data.accounts.map((account: AccountRow) => {
          return {
            provider: account.provider,
            accountId: account.accountId,
            rowId: account.id.toString(),
          };
        }),
        rules: data.rules,
      });
    const rows: Array<Record<string, unknown>> =
      await CloudResourceService.getRepository().manager.query(
        built.sql,
        built.params,
      );
    const counts: Map<string, ResourceCountRow> = new Map();

    for (const row of rows) {
      const byRule: Array<number> = [];

      for (let index: number = 0; index < data.rules.length; index++) {
        byRule.push(numberOf(row[`r${index}`]));
      }

      counts.set(
        `${String(row["provider"] || "")}|${String(row["account"] || "")}`,
        {
          total: numberOf(row["total"]),
          covered: numberOf(row["covered"]),
          byRule,
        },
      );
    }

    return counts;
  }

  /*
   * Each of the last 12 weeks: the spend of the accounts whose spend is
   * measured (by the costs), and every account's resources on the last
   * day of the week counted (CloudTagCoverageDay).
   */
  private static async readTrend(data: {
    projectId: ObjectID;
    accountIds: Array<string>;
    measuredAccountIds: Array<string>;
    rules: Array<CloudRequiredTagRule>;
    currency: string;
    now: Date;
  }): Promise<Array<CloudTagTrendPointJSON>> {
    const end: Date = addUtcDays(startOfUtcDay(data.now), 1);
    const start: Date = addUtcDays(
      startOfUtcWeek(data.now),
      -7 * (CLOUD_TAG_TREND_WEEKS - 1),
    );
    const points: Map<string, CloudTagTrendPointJSON> = new Map();

    for (let week: number = 0; week < CLOUD_TAG_TREND_WEEKS; week++) {
      const day: string = toCloudCostDay(addUtcDays(start, week * 7));
      points.set(day, { week: day, spend: null, resources: null });
    }

    const [spendRows, days]: [Array<JSONObject>, Array<CloudTagCoverageDay>] =
      await Promise.all([
        data.measuredAccountIds.length > 0
          ? CloudTagCoverageReader.query(
              CloudTagCoverageReader.buildTrendStatement({
                projectId: data.projectId,
                accountIds: data.measuredAccountIds,
                rules: data.rules,
                currency: data.currency,
                start,
                end,
              }),
            )
          : Promise.resolve([] as Array<JSONObject>),
        CloudTagCoverageDayService.findBy({
          query: {
            projectId: data.projectId,
            cloudAccountId: QueryHelper.any(data.accountIds),
            day: QueryHelper.greaterThanEqualTo(start),
          },
          select: {
            cloudAccountId: true,
            day: true,
            resourceCount: true,
            coveredCount: true,
          },
          skip: 0,
          limit: LIMIT_MAX,
          sort: { day: SortOrder.Ascending },
          props: { isRoot: true },
        }),
      ]);

    for (const row of spendRows) {
      const point: CloudTagTrendPointJSON | undefined = points.get(
        String(row["week"] || "").slice(0, 10),
      );

      if (point) {
        point.spend = {
          covered: roundCost(numberOf(row["covered"])),
          total: roundCost(numberOf(row["total"])),
        };
      }
    }

    // Each account's last count of each week.
    const lastOfWeek: Map<string, CloudTagCoverageDay> = new Map();

    for (const row of days) {
      if (!row.day || !row.cloudAccountId) {
        continue;
      }

      const week: string = toCloudCostDay(startOfUtcWeek(new Date(row.day)));
      // Sorted by day: a later count of the week replaces an earlier one.
      lastOfWeek.set(`${week}|${row.cloudAccountId.toString()}`, row);
    }

    for (const [key, row] of lastOfWeek) {
      const point: CloudTagTrendPointJSON | undefined = points.get(
        key.split("|")[0]!,
      );

      if (!point) {
        continue;
      }

      point.resources = {
        covered: (point.resources?.covered || 0) + (row.coveredCount || 0),
        total: (point.resources?.total || 0) + (row.resourceCount || 0),
      };
    }

    return Array.from(points.values());
  }

  /*
   * The resources that lack a required tag, the costliest over the period
   * first, then by name, each with what it lacks and what to put there.
   */
  private static async readUntagged(data: {
    projectId: ObjectID;
    accounts: Array<AccountRow>;
    rules: Array<CloudRequiredTagRule>;
    currency: string;
    start: Date;
    end: Date;
    props: DatabaseCommonInteractionProps;
    countedUntagged: number;
  }): Promise<{ list: Array<CloudTagUntaggedResourceJSON>; count: number }> {
    if (data.countedUntagged <= 0) {
      return { list: [], count: 0 };
    }

    const built: { sql: string; params: Array<unknown> } =
      CloudTagCoverageReader.buildUntaggedSql({
        projectId: data.projectId,
        accounts: data.accounts.map((account: AccountRow) => {
          return {
            provider: account.provider,
            accountId: account.accountId,
            rowId: account.id.toString(),
          };
        }),
        rules: data.rules,
        limit: CLOUD_TAG_UNTAGGED_PRICED,
      });
    const rows: Array<{
      id: string;
      provider: string;
      providerResourceId: string | null;
    }> = await CloudResourceService.getRepository().manager.query(
      built.sql,
      built.params,
    );

    if (rows.length === 0) {
      return { list: [], count: 0 };
    }

    // What each cost over the period, in the page's currency, by its cost key.
    const keyOfRow: Map<string, string> = new Map();

    for (const row of rows) {
      const key: string = getCloudCostResourceKey(
        row.provider || "",
        row.providerResourceId || "",
      );

      if (key) {
        keyOfRow.set(row.id, key);
      }
    }

    const spendByKey: Map<string, number> = new Map();
    const keys: Array<string> = Array.from(new Set(keyOfRow.values()));

    if (keys.length > 0) {
      const spendRows: Array<JSONObject> = await CloudTagCoverageReader.query(
        CloudTagCoverageReader.buildResourceSpendStatement({
          projectId: data.projectId,
          accountIds: data.accounts.map((account: AccountRow): string => {
            return account.id.toString();
          }),
          resourceKeys: keys,
          start: data.start,
          end: data.end,
        }),
      );

      for (const row of spendRows) {
        if (String(row["currencyCode"] || "") !== data.currency) {
          continue;
        }

        const key: string = String(row["resourceKey"] || "");
        spendByKey.set(
          key,
          (spendByKey.get(key) || 0) + numberOf(row["total"]),
        );
      }
    }

    // The costliest first; those with no cost read after them.
    const ranked: Array<string> = rows
      .map((row: { id: string }): string => {
        return row.id;
      })
      .sort((a: string, b: string): number => {
        const spendA: number = spendByKey.get(keyOfRow.get(a) || "") ?? -1;
        const spendB: number = spendByKey.get(keyOfRow.get(b) || "") ?? -1;
        return spendB - spendA;
      });

    // Read again as the reader: a name they may not read is never shown.
    const readable: Array<CloudResource> = await CloudResourceService.findBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(ranked.slice(0, CLOUD_TAG_UNTAGGED_LIMIT * 2)),
      },
      select: CLOUD_TAG_SUBJECT_SELECT,
      skip: 0,
      limit: CLOUD_TAG_UNTAGGED_LIMIT * 2,
      props: data.props,
    });
    const byId: Map<string, CloudResource> = new Map();

    for (const resource of readable) {
      if (resource.id) {
        byId.set(resource.id.toString(), resource);
      }
    }

    const subjects: Array<CloudTagSubject> = ranked
      .map((id: string): CloudResource | undefined => {
        return byId.get(id);
      })
      .filter((resource: CloudResource | undefined): boolean => {
        return Boolean(resource);
      })
      .slice(0, CLOUD_TAG_UNTAGGED_LIMIT)
      .map((resource: CloudResource | undefined): CloudTagSubject => {
        return toCloudTagSubject(resource!);
      });
    const accountOf: (subject: CloudTagSubject) => AccountRow | undefined = (
      subject: CloudTagSubject,
    ): AccountRow | undefined => {
      return data.accounts.find((account: AccountRow): boolean => {
        return (
          account.provider === subject.provider &&
          account.accountId.toLowerCase() === subject.accountId.toLowerCase()
        );
      });
    };
    const findings: Array<CloudTagSubjectFindings> =
      await CloudTagSuggestions.findMissing({
        projectId: data.projectId,
        subjects,
        rulesOf: (subject: CloudTagSubject): Array<CloudRequiredTagRule> => {
          return getCloudRequiredTagsForAccount(
            data.rules,
            accountOf(subject)?.id.toString() || null,
          );
        },
      });

    const list: Array<CloudTagUntaggedResourceJSON> = findings.map(
      (entry: CloudTagSubjectFindings): CloudTagUntaggedResourceJSON => {
        const account: AccountRow | undefined = accountOf(entry.subject);
        const spend: number | undefined = spendByKey.get(
          keyOfRow.get(entry.subject.id.toString()) || "",
        );

        return {
          cloudResourceId: entry.subject.id.toString(),
          name: entry.subject.name || entry.subject.providerResourceId,
          provider: entry.subject.provider,
          type: entry.subject.type,
          cloudAccountId: account?.id.toString() || null,
          accountName: account?.name || entry.subject.accountId,
          spend: spend === undefined ? null : roundCost(spend),
          currency: data.currency,
          missing: entry.missing,
          declaredCode: entry.declaredCode,
        };
      },
    );

    // Every one of them is counted: the list names the first.
    return { list, count: data.countedUntagged };
  }
}
