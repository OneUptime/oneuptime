import RuleBaseModel from "./RuleBaseModel";

/**
 * Marker base for rules whose legacy match fields are relations only.
 *
 * Criteria-backed rows encode logical enabled as a nullable legacy isEnabled
 * value: null means enabled and false means disabled. Older workers query for
 * true and therefore ignore both states while criteria-aware versions translate
 * the value through DatabaseService.
 */
export default class RelationOnlyRuleBaseModel extends RuleBaseModel {}
