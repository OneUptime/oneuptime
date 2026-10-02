import {
  KeyFormat,
  makeKeyFromName,
  makeUniqueKeyFromName,
} from "../../Utils/KeyFromName";

/*
 * The metric a recording rule writes: its Output Metric Name.
 *
 * Nobody has to type one. It is made from the rule's name - "HTTP 5xx error
 * rate" writes http_5xx_error_rate - by the form while the name is typed and
 * by the server when a create leaves it out. Someone who wants a particular
 * name ("http.server.error_rate") still sets it, on create or later.
 *
 * Underscores, as metric names are written in OpenTelemetry and Prometheus
 * alike. Metric and trace recording rules write into the same metric store,
 * so a made name is kept clear of every rule of the project, of both kinds:
 * two rules writing one series would mix their data.
 *
 * Pure, so the dashboard and the server make the same name from the same
 * rule name.
 */

export const RECORDING_RULE_OUTPUT_METRIC_NAME_MAX_LENGTH: number = 64;

/*
 * What a rule name with nothing usable in it becomes ("!!!", or a name
 * written wholly in a script with no Latin transliteration).
 */
export const RECORDING_RULE_OUTPUT_METRIC_NAME_FALLBACK: string =
  "recording_rule";

// How Utils/KeyFromName makes an output metric name from a rule's name.
export const RECORDING_RULE_OUTPUT_METRIC_NAME_FORMAT: KeyFormat = {
  separator: "_",
  maxLength: RECORDING_RULE_OUTPUT_METRIC_NAME_MAX_LENGTH,
  fallback: RECORDING_RULE_OUTPUT_METRIC_NAME_FALLBACK,
};

export type GetOutputMetricNameFromRuleNameFunction = (
  ruleName: string,
) => string;

/**
 * The metric a rule of this name writes when no other rule of the project
 * writes it: "HTTP 5xx error rate" -> "http_5xx_error_rate".
 */
export const getOutputMetricNameFromRuleName: GetOutputMetricNameFromRuleNameFunction =
  (ruleName: string): string => {
    return makeKeyFromName(ruleName, RECORDING_RULE_OUTPUT_METRIC_NAME_FORMAT);
  };

export type GenerateOutputMetricNameFunction = (data: {
  ruleName: string;
  // The output metric names the project's recording rules, of both kinds, write.
  existingNames: Iterable<string | null | undefined>;
}) => string;

/**
 * The output metric name for a new rule created without one: its name's,
 * or the first of name_2, name_3, ... that no other rule writes.
 */
export const generateOutputMetricName: GenerateOutputMetricNameFunction =
  (data: {
    ruleName: string;
    existingNames: Iterable<string | null | undefined>;
  }): string => {
    return makeUniqueKeyFromName({
      name: data.ruleName,
      existingKeys: data.existingNames,
      format: RECORDING_RULE_OUTPUT_METRIC_NAME_FORMAT,
    });
  };
