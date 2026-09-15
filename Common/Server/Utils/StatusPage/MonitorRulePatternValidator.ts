import MonitorRulePatternValidator from "../Rules/MonitorRulePatternValidator";

/*
 * Status page monitor rules validate their patterns with the validator every
 * monitor rule shares (SLO monitor rules use the same one). This name is kept
 * so existing imports keep resolving; the behaviour lives in
 * Server/Utils/Rules/MonitorRulePatternValidator.
 */
export default MonitorRulePatternValidator;
