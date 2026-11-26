import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import {
  CloudRequiredTagRule,
  isCloudTagValuePattern,
  normalizeCloudTagKey,
  toClickHouseLikePattern,
} from "../../../Types/Cloud/CloudRequiredTags";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";

/*
 * "CARRIES THE TAG", AS SQL (#11012): whether a cost's tags (ClickHouse,
 * CloudCost.tags, a Map) or a resource's (Postgres,
 * CloudResource.cloudTags, jsonb) hold a required tag in any spelling of
 * its key with a value it allows - exactly what findAllowedCloudTagValue
 * says in code, so a page's coverage, the daily count and the watcher
 * agree:
 *
 *   - the key matched without case;
 *   - an empty value is no value;
 *   - an allowed value matched without case, a pattern as a LIKE that
 *     ignores case (ilike, ILIKE), its `*` and `?` as `%` and `_` and
 *     LIKE's own characters escaped (toClickHouseLikePattern).
 *
 * Every value is a bound parameter, never written into the text.
 */

// A rule's allowed values, apart: the exact ones in lower case, the patterns as LIKEs.
export function splitAllowedValues(
  rule: Pick<CloudRequiredTagRule, "allowedValues">,
): {
  exact: Array<string>;
  patterns: Array<string>;
} {
  const exact: Array<string> = [];
  const patterns: Array<string> = [];

  for (const raw of rule.allowedValues) {
    const value: string = raw.trim();

    if (!value) {
      continue;
    }

    if (isCloudTagValuePattern(value)) {
      patterns.push(toClickHouseLikePattern(value));
    } else {
      exact.push(value.toLowerCase());
    }
  }

  return { exact, patterns };
}

/*
 * ClickHouse: whether a cost's `tags` carry the rule's tag with a value
 * it allows.
 */
export function getCostTagCondition(
  rule: Pick<CloudRequiredTagRule, "key" | "allowedValues">,
): Statement {
  const { exact, patterns } = splitAllowedValues(rule);
  const statement: Statement = SQL`arrayExists((k, v) -> lowerUTF8(k) = ${{
    type: TableColumnType.Text,
    value: normalizeCloudTagKey(rule.key),
  }} AND trimBoth(v) != ''`;

  if (exact.length > 0 || patterns.length > 0) {
    statement.append(SQL` AND (`);

    let isFirst: boolean = true;

    if (exact.length > 0) {
      statement.append(
        SQL`has(${{
          type: TableColumnType.ArrayText,
          value: exact,
        }}, lowerUTF8(trimBoth(v)))`,
      );
      isFirst = false;
    }

    for (const pattern of patterns) {
      if (!isFirst) {
        statement.append(SQL` OR `);
      }

      statement.append(
        SQL`ilike(trimBoth(v), ${{
          type: TableColumnType.Text,
          value: pattern,
        }})`,
      );
      isFirst = false;
    }

    statement.append(SQL`)`);
  }

  statement.append(SQL`, mapKeys(tags), mapValues(tags))`);

  return statement;
}

// ClickHouse: whether a cost carries every one of these rules' tags.
export function getCostAllTagsCondition(
  rules: ReadonlyArray<Pick<CloudRequiredTagRule, "key" | "allowedValues">>,
): Statement {
  if (rules.length === 0) {
    return SQL`1`;
  }

  const statement: Statement = SQL`(`;

  rules.forEach(
    (
      rule: Pick<CloudRequiredTagRule, "key" | "allowedValues">,
      index: number,
    ) => {
      if (index > 0) {
        statement.append(SQL` AND `);
      }

      statement.append(getCostTagCondition(rule));
    },
  );

  statement.append(SQL`)`);

  return statement;
}

/*
 * Postgres: whether a resource's tags (the jsonb column named) carry the
 * rule's tag with a value it allows. Its parameters are pushed onto
 * `params` and named by their place ($n).
 */
export function getResourceTagConditionSql(data: {
  rule: Pick<CloudRequiredTagRule, "key" | "allowedValues">;
  params: Array<unknown>;
  tagsColumn: string;
}): string {
  const { exact, patterns } = splitAllowedValues(data.rule);
  const next: (value: unknown) => string = (value: unknown): string => {
    data.params.push(value);
    return `$${data.params.length}`;
  };

  const keyParam: string = next(normalizeCloudTagKey(data.rule.key));
  const valueConditions: Array<string> = [];
  // A tag's value as text: only a string is a value, as in code.
  const value: string = `(t.j #>> '{}')`;

  if (exact.length > 0) {
    valueConditions.push(
      `lower(btrim(${value})) = ANY(${next(exact)}::text[])`,
    );
  }

  if (patterns.length > 0) {
    valueConditions.push(
      `btrim(${value}) ILIKE ANY(${next(patterns)}::text[])`,
    );
  }

  return `EXISTS (SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(${data.tagsColumn}) = 'object' THEN ${data.tagsColumn} ELSE '{}'::jsonb END) AS t(k, j) WHERE jsonb_typeof(t.j) = 'string' AND lower(t.k) = ${keyParam} AND btrim(${value}) <> ''${
    valueConditions.length > 0 ? ` AND (${valueConditions.join(" OR ")})` : ""
  })`;
}

// Postgres: whether a resource carries every one of these rules' tags.
export function getResourceAllTagsConditionSql(data: {
  rules: ReadonlyArray<Pick<CloudRequiredTagRule, "key" | "allowedValues">>;
  params: Array<unknown>;
  tagsColumn: string;
}): string {
  if (data.rules.length === 0) {
    return "TRUE";
  }

  return `(${data.rules
    .map((rule: Pick<CloudRequiredTagRule, "key" | "allowedValues">) => {
      return getResourceTagConditionSql({
        rule,
        params: data.params,
        tagsColumn: data.tagsColumn,
      });
    })
    .join(" AND ")})`;
}
