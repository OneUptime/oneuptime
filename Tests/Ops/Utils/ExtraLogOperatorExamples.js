"use strict";

/**
 * logs.extraOperators (issue #11225): the operators the tests run through the
 * Kubernetes agent chart and the collector, kept in one place.
 *
 *   - DOCUMENTED_EXAMPLE: the example values.yaml and the docs give, held to
 *     both by Tests/Ops/AgentLogOperators.test.js;
 *   - ONE_OF_EACH: one operator of each type the chart takes, as a user might
 *     set it, so that the collector builds every one of them inside the
 *     agent's own pod log receiver;
 *   - ONE_OF_EACH_ON_0_96_0: those collector 0.96.0 has, which a
 *     `helm upgrade --reuse-values` from before chart 0.161.0 keeps running,
 *     with the on_error modes it has.
 *
 * Used by Utils/extra-log-operators-agreement.js and
 * validate-collector-configs.sh.
 */

const B = "\\";

const DOCUMENTED_EXAMPLE = [
  {
    type: "regex_parser",
    id: "inhouse-level",
    if: 'body matches "^<<[DIWEF]>> "',
    regex: "^<<(?P<severity_text>[DIWEF])>> ",
  },
  {
    type: "router",
    id: "sev-route",
    routes: [
      { output: "sev-fatal", expr: 'body matches "^SEV1 "' },
      { output: "sev-error", expr: 'body matches "^SEV2 "' },
    ],
    default: "severity-router",
  },
  {
    type: "add",
    id: "sev-fatal",
    field: "attributes.severity_text",
    value: "FATAL",
    output: "severity-router",
  },
  {
    type: "add",
    id: "sev-error",
    field: "attributes.severity_text",
    value: "ERROR",
    output: "severity-router",
  },
];

const ONE_OF_EACH = [
  { type: "json_parser", if: 'body startsWith "{"', on_error: "send_quiet" },
  {
    type: "key_value_parser",
    if: 'body matches "^[a-z]+="',
    on_error: "send_quiet",
  },
  {
    type: "csv_parser",
    header: "level,message",
    if: 'body matches "^[A-Z]+,"',
    on_error: "send_quiet",
  },
  {
    type: "json_array_parser",
    if: 'body startsWith "["',
    on_error: "send_quiet",
  },
  {
    type: "uri_parser",
    parse_from: 'attributes["url"]',
    if: 'attributes["url"] != nil',
  },
  {
    type: "time_parser",
    parse_from: "attributes.t",
    layout_type: "gotime",
    layout: "2006-01-02T15:04:05Z07:00",
    if: "attributes.t != nil",
  },
  {
    type: "scope_name_parser",
    parse_from: "attributes.logger",
    if: "attributes.logger != nil",
  },
  { type: "trace_parser" },
  {
    type: "regex_replace",
    field: "body",
    regex_name: "ansi_control_sequences",
  },
  { type: "regex_replace", field: "body", regex: `${B}x00+`, replace_with: "" },
  { type: "sanitize_utf8" },
  {
    type: "unquote",
    field: "attributes.quoted",
    if: "attributes.quoted != nil",
  },
  { type: "copy", from: "body", to: 'attributes["original.body"]' },
  { type: "move", from: 'attributes["original.body"]', to: "attributes.kept" },
  { type: "remove", field: "attributes.kept" },
  {
    type: "flatten",
    field: "attributes.nested",
    if: "attributes.nested != nil",
  },
  {
    type: "assign_keys",
    field: "attributes.list",
    keys: ["a", "b"],
    if: "attributes.list != nil",
  },
  {
    type: "retain",
    fields: ["attributes.level", "attributes.message"],
    if: "attributes.retain_only != nil",
  },
  { type: "filter", expr: 'body == "heartbeat"' },
  {
    type: "recombine",
    combine_field: "body",
    is_first_entry: `body matches "^${B}${B}d{4}-"`,
    source_identifier: 'attributes["log.file.path"]',
  },
  { type: "noop" },
];

// The types collector 0.96.0 does not have (the chart refuses them there),
// and the on_error modes it does.
const NEWER_THAN_0_96_0 = [
  "json_array_parser",
  "assign_keys",
  "regex_replace",
  "sanitize_utf8",
];

const ONE_OF_EACH_ON_0_96_0 = ONE_OF_EACH.filter((operator) => {
  return !NEWER_THAN_0_96_0.includes(operator.type);
}).map((operator) => {
  return operator.on_error === "send_quiet"
    ? { ...operator, on_error: "send" }
    : operator;
});

/*
 * Lines in the documented example's format, which the agent does not read:
 * an in-house letter between << and >>, and SEV1 or SEV2 at the start. Each
 * at the level the example's operators name, on either stream; without them
 * the agent reads none of these (ContainerAgentLogSeverity.test.js holds
 * that), so a run that gets them right got them from the operators.
 * agent-log-severity-behaviour.sh runs them through each agent with the
 * example set, beside the whole corpus, which must leave as it does without.
 */
const EXTRA_OPERATOR_CASES = [
  {
    name: "in-house letter D",
    stream: "stderr",
    body: "<<D>> cache warmed in 41ms",
    severity: "Debug",
  },
  {
    name: "in-house letter I",
    stream: "stderr",
    body: "<<I>> payment 8812 accepted",
    severity: "Information",
  },
  {
    name: "in-house letter W",
    stream: "stderr",
    body: "<<W>> payment 8812 retried after a timeout",
    severity: "Warning",
  },
  {
    name: "in-house letter E, on stdout",
    stream: "stdout",
    body: "<<E>> payment 8812 declined by the card network",
    severity: "Error",
  },
  {
    name: "in-house letter F",
    stream: "stderr",
    body: "<<F>> ledger unreachable, stopping",
    severity: "Fatal",
  },
  {
    name: "in-house SEV1, on stdout",
    stream: "stdout",
    body: "SEV1 checkout is down in eu-west-1",
    severity: "Fatal",
  },
  {
    name: "in-house SEV2",
    stream: "stderr",
    body: "SEV2 checkout latency over 2s for 5 minutes",
    severity: "Error",
  },
  {
    name: "a letter the example does not name, read by no one",
    stream: "stderr",
    body: "<<X>> nothing names this one",
    severity: "Unspecified",
  },
];

module.exports = {
  DOCUMENTED_EXAMPLE,
  EXTRA_OPERATOR_CASES,
  ONE_OF_EACH,
  ONE_OF_EACH_ON_0_96_0,
  NEWER_THAN_0_96_0,
};
