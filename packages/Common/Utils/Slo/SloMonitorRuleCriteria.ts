import FilterCondition from "../../Types/Filter/FilterCondition";
import ObjectID from "../../Types/ObjectID";
import RuleCriteria, {
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../Types/Rules/RuleCriteria";
import { isValidRuleCriteria } from "../Rules/RuleCriteriaMatcher";

/*
 * Plain-English descriptions of what an SLO monitor rule matches, for the
 * places that cannot render the dashboard's RuleCriteriaSummary component:
 * the SLO feed ("Updated monitor rule ... Match criteria: A -> B") and the AI
 * toolbox (query_slos).
 *
 * The description follows the ENGINE's reading of a rule, not the form's:
 *
 *   - `criteria`, when present, is the whole truth. The legacy columns beside
 *     it are a rolling-deploy safety shadow - the name pattern is stored as
 *     "(?!)" and the label join rows are simply left behind - so describing
 *     them would report conditions the engine never evaluates.
 *   - Without `criteria`, the legacy columns are ANDed, and labels match on
 *     ANY of the selected labels - exactly what the engine's legacy matcher
 *     does, so the two are phrased the same way a criteria rule would be.
 *   - Criteria that fail validation, and rules with no criteria at all, match
 *     nothing, and say so. A description that read "matches everything" for an
 *     empty rule would be the most dangerous possible misreading.
 *
 * Pure and React-free (no services, no logger) so the server can use it and
 * tests can pin every phrase.
 */

export const SLO_MONITOR_RULE_CRITERIA_FIELD_TITLES: Readonly<
  Record<string, string>
> = {
  monitorLabels: "Labels",
  monitorNamePattern: "Name",
  monitorDescriptionPattern: "Description",
};

export const SLO_MONITOR_RULE_OPERATOR_PHRASES: Readonly<
  Record<RuleCriteriaOperator, string>
> = {
  [RuleCriteriaOperator.Equals]: "is",
  [RuleCriteriaOperator.NotEquals]: "is not",
  [RuleCriteriaOperator.Contains]: "contains",
  [RuleCriteriaOperator.DoesNotContain]: "does not contain",
  [RuleCriteriaOperator.StartsWith]: "starts with",
  [RuleCriteriaOperator.EndsWith]: "ends with",
  [RuleCriteriaOperator.MatchesPattern]: "matches pattern",
  [RuleCriteriaOperator.DoesNotMatchPattern]: "does not match pattern",
  [RuleCriteriaOperator.HasAnyOf]: "has any of",
  [RuleCriteriaOperator.HasAllOf]: "has all of",
  [RuleCriteriaOperator.HasNoneOf]: "has none of",
};

/*
 * A rule on a busy project can select dozens of labels. The description is a
 * sentence, not an inventory, so it names this many and counts the rest.
 */
export const SLO_MONITOR_RULE_MAX_LABELS_NAMED: number = 10;

export const SLO_MONITOR_RULE_NO_CRITERIA_DESCRIPTION: string =
  "No match criteria (matches no monitors)";

export const SLO_MONITOR_RULE_INVALID_CRITERIA_DESCRIPTION: string =
  "Invalid match criteria (matches no monitors)";

export interface SloMonitorRuleLabelReference {
  _id?: string | undefined;
  id?: ObjectID | null | undefined;
  name?: string | undefined;
}

/*
 * The slice of ServiceLevelObjectiveMonitorRule this module reads. Structural
 * so a partial row from findBy, a model instance and a test literal all fit.
 */
export interface SloMonitorRuleCriteriaCarrier {
  criteria?: RuleCriteria | null | undefined;
  monitorLabels?: Array<SloMonitorRuleLabelReference> | undefined;
  monitorNamePattern?: string | null | undefined;
  monitorDescriptionPattern?: string | null | undefined;
}

type LabelIdOfFunction = (
  label: SloMonitorRuleLabelReference | undefined | null,
) => string;

const labelIdOf: LabelIdOfFunction = (
  label: SloMonitorRuleLabelReference | undefined | null,
): string => {
  return (label?.id?.toString() || label?._id?.toString() || "").trim();
};

type HasConfiguredCriteriaFunction = (
  rule: SloMonitorRuleCriteriaCarrier,
) => boolean;

export const hasConfiguredCriteria: HasConfiguredCriteriaFunction = (
  rule: SloMonitorRuleCriteriaCarrier,
): boolean => {
  return rule.criteria !== undefined && rule.criteria !== null;
};

type GetSloMonitorRuleLabelIdsFunction = (
  rule: SloMonitorRuleCriteriaCarrier,
) => Array<string>;

/*
 * Every label id the rule's EFFECTIVE criteria refer to, de-duplicated in
 * first-seen order - what a caller has to look names up for before calling
 * describeSloMonitorRuleCriteria.
 */
export const getSloMonitorRuleLabelIds: GetSloMonitorRuleLabelIdsFunction = (
  rule: SloMonitorRuleCriteriaCarrier,
): Array<string> => {
  const ids: Array<string> = [];

  const push: (id: string) => void = (id: string): void => {
    const normalized: string = id.trim();

    if (normalized && !ids.includes(normalized)) {
      ids.push(normalized);
    }
  };

  if (hasConfiguredCriteria(rule)) {
    if (!isValidRuleCriteria(rule.criteria)) {
      return ids;
    }

    for (const filter of rule.criteria.filters) {
      if (filter.field === "monitorLabels" && Array.isArray(filter.value)) {
        for (const value of filter.value) {
          push(String(value));
        }
      }
    }

    return ids;
  }

  for (const label of rule.monitorLabels || []) {
    push(labelIdOf(label));
  }

  return ids;
};

type QuoteFunction = (value: string) => string;

const quote: QuoteFunction = (value: string): string => {
  return `"${value}"`;
};

type DescribeLabelsFunction = (data: {
  labelIds: Array<string>;
  labelNameById: ReadonlyMap<string, string>;
}) => string;

const describeLabels: DescribeLabelsFunction = (data: {
  labelIds: Array<string>;
  labelNameById: ReadonlyMap<string, string>;
}): string => {
  const named: Array<string> = data.labelIds
    .slice(0, SLO_MONITOR_RULE_MAX_LABELS_NAMED)
    .map((labelId: string): string => {
      const name: string | undefined = data.labelNameById.get(labelId);

      /*
       * A label that was deleted (or that the reader cannot see) still
       * counts towards the rule, so it is shown rather than dropped - an
       * "any of" list that silently shrank would misdescribe the rule.
       */
      return name ? quote(name) : `an unknown label (${labelId.slice(0, 8)})`;
    });

  const remaining: number = data.labelIds.length - named.length;

  if (remaining > 0) {
    named.push(`${remaining} more`);
  }

  if (named.length === 0) {
    return "no labels";
  }

  return named.join(", ");
};

type DescribeFilterFunction = (data: {
  filter: RuleCriteriaFilter;
  labelNameById: ReadonlyMap<string, string>;
}) => string;

const describeFilter: DescribeFilterFunction = (data: {
  filter: RuleCriteriaFilter;
  labelNameById: ReadonlyMap<string, string>;
}): string => {
  const { filter } = data;

  const fieldTitle: string =
    SLO_MONITOR_RULE_CRITERIA_FIELD_TITLES[filter.field] || filter.field;

  const operatorPhrase: string =
    SLO_MONITOR_RULE_OPERATOR_PHRASES[filter.operator] || filter.operator;

  if (Array.isArray(filter.value)) {
    return `${fieldTitle} ${operatorPhrase} ${describeLabels({
      labelIds: filter.value.map((value: string): string => {
        return String(value).trim();
      }),
      labelNameById: data.labelNameById,
    })}`;
  }

  return `${fieldTitle} ${operatorPhrase} ${quote(String(filter.value))}`;
};

type DescribeSloMonitorRuleCriteriaFunction = (data: {
  rule: SloMonitorRuleCriteriaCarrier;
  /*
   * Label names by id. Legacy rules usually carry their label names already
   * (select `monitorLabels: { name: true }`); criteria rules only store ids,
   * so the caller looks those up (see getSloMonitorRuleLabelIds).
   */
  labelNameById?: ReadonlyMap<string, string> | undefined;
}) => string;

export const describeSloMonitorRuleCriteria: DescribeSloMonitorRuleCriteriaFunction =
  (data: {
    rule: SloMonitorRuleCriteriaCarrier;
    labelNameById?: ReadonlyMap<string, string> | undefined;
  }): string => {
    const { rule } = data;

    const labelNameById: Map<string, string> = new Map<string, string>(
      data.labelNameById || [],
    );

    for (const label of rule.monitorLabels || []) {
      const labelId: string = labelIdOf(label);

      if (labelId && label.name && !labelNameById.has(labelId)) {
        labelNameById.set(labelId, label.name);
      }
    }

    if (hasConfiguredCriteria(rule)) {
      if (!isValidRuleCriteria(rule.criteria)) {
        return SLO_MONITOR_RULE_INVALID_CRITERIA_DESCRIPTION;
      }

      if (rule.criteria.filters.length === 0) {
        return SLO_MONITOR_RULE_NO_CRITERIA_DESCRIPTION;
      }

      const connector: string =
        rule.criteria.filterCondition === FilterCondition.Any
          ? " OR "
          : " AND ";

      return rule.criteria.filters
        .map((filter: RuleCriteriaFilter): string => {
          return describeFilter({ filter, labelNameById });
        })
        .join(connector);
    }

    const parts: Array<string> = [];

    const legacyLabelIds: Array<string> = getSloMonitorRuleLabelIds(rule);

    if (legacyLabelIds.length > 0) {
      parts.push(
        `${SLO_MONITOR_RULE_CRITERIA_FIELD_TITLES["monitorLabels"]} ${
          SLO_MONITOR_RULE_OPERATOR_PHRASES[RuleCriteriaOperator.HasAnyOf]
        } ${describeLabels({ labelIds: legacyLabelIds, labelNameById })}`,
      );
    }

    if (rule.monitorNamePattern) {
      parts.push(
        `${SLO_MONITOR_RULE_CRITERIA_FIELD_TITLES["monitorNamePattern"]} ${
          SLO_MONITOR_RULE_OPERATOR_PHRASES[RuleCriteriaOperator.MatchesPattern]
        } ${quote(rule.monitorNamePattern)}`,
      );
    }

    if (rule.monitorDescriptionPattern) {
      parts.push(
        `${SLO_MONITOR_RULE_CRITERIA_FIELD_TITLES["monitorDescriptionPattern"]} ${
          SLO_MONITOR_RULE_OPERATOR_PHRASES[RuleCriteriaOperator.MatchesPattern]
        } ${quote(rule.monitorDescriptionPattern)}`,
      );
    }

    if (parts.length === 0) {
      return SLO_MONITOR_RULE_NO_CRITERIA_DESCRIPTION;
    }

    return parts.join(" AND ");
  };

type GetSloMonitorRuleCriteriaKeyFunction = (
  rule: SloMonitorRuleCriteriaCarrier,
) => string;

type StableStringifyFunction = (value: unknown) => string;

/*
 * JSON with object keys sorted at every depth. jsonb hands keys back in its
 * own order, not the order they were written, so two reads of the same
 * criteria must not look different just because one came from a request
 * body and the other from Postgres.
 */
const stableStringify: StableStringifyFunction = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value
      .map((item: unknown): string => {
        return stableStringify(item);
      })
      .join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    const record: Record<string, unknown> = value as Record<string, unknown>;

    return `{${Object.keys(record)
      .filter((key: string): boolean => {
        return record[key] !== undefined;
      })
      .sort()
      .map((key: string): string => {
        return `${JSON.stringify(key)}:${stableStringify(record[key])}`;
      })
      .join(",")}}`;
  }

  return JSON.stringify(value === undefined ? null : value);
};

/*
 * An identity for "what this rule matches", equal for two rows exactly when
 * the engine would evaluate them the same way. Used to decide whether an edit
 * changed a rule's match criteria at all - a full-form resubmit that changed
 * nothing must not read as a change.
 */
export const getSloMonitorRuleCriteriaKey: GetSloMonitorRuleCriteriaKeyFunction =
  (rule: SloMonitorRuleCriteriaCarrier): string => {
    if (hasConfiguredCriteria(rule)) {
      return `criteria:${stableStringify(rule.criteria)}`;
    }

    return `legacy:${stableStringify({
      labels: getSloMonitorRuleLabelIds(rule)
        .map((id: string): string => {
          return id.toLowerCase();
        })
        .sort(),
      name: rule.monitorNamePattern || "",
      description: rule.monitorDescriptionPattern || "",
    })}`;
  };
