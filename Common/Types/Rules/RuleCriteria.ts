import FilterCondition from "../Filter/FilterCondition";

type RuleCriteriaSchemaVersion = 1;

export const RULE_CRITERIA_SCHEMA_VERSION: RuleCriteriaSchemaVersion =
  1 as const;

/** A legacy regular expression that can never match any resource value. */
export const RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN: string = "(?!)";

export enum RuleCriteriaOperator {
  Equals = "Equals",
  NotEquals = "NotEquals",
  Contains = "Contains",
  DoesNotContain = "DoesNotContain",
  StartsWith = "StartsWith",
  EndsWith = "EndsWith",
  MatchesPattern = "MatchesPattern",
  DoesNotMatchPattern = "DoesNotMatchPattern",
  HasAnyOf = "HasAnyOf",
  HasAllOf = "HasAllOf",
  HasNoneOf = "HasNoneOf",
}

export type RuleCriteriaValue = string | number | boolean | Array<string>;

export interface RuleCriteriaFilter {
  field: string;
  operator: RuleCriteriaOperator;
  value: RuleCriteriaValue;
}

/**
 * Versioned, resource-agnostic criteria stored by rule models.
 *
 * Field allowlists and field-specific operator choices deliberately live with
 * each rule form and engine. This shared type only describes how conditions
 * are combined and serialized.
 */
export default interface RuleCriteria {
  schemaVersion: typeof RULE_CRITERIA_SCHEMA_VERSION;
  filterCondition: FilterCondition;
  filters: Array<RuleCriteriaFilter>;

  /**
   * Logical state carried only for relation-only rules during rolling deploys.
   * Their legacy `isEnabled` column is deliberately sent as false so an old
   * API cannot create an enabled match-all rule after dropping `criteria`.
   */
  isEnabled?: boolean;
}
