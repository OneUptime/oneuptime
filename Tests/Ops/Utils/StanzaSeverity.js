"use strict";

/**
 * Helpers for reading the log-severity operator chain out of an agent's
 * OpenTelemetry Collector config and reasoning about it the way the collector
 * does.
 *
 * The three container agents (DockerAgent, PodmanAgent, DockerSwarmAgent) and
 * the Kubernetes agent's DaemonSet ConfigMap all carry the SAME five-operator
 * chain inside `receivers.filelog.operators`:
 *
 *   router(severity-router)                 body has a level keyword?
 *     -> regex_parser(parse-severity-from-body)   yes: lift it out of the body
 *     -> add(add-fallback-severity)               no:  stderr -> ERROR, else INFO
 *   both -> severity_parser(severity-parser)  text -> LogRecord severity number
 *        -> remove(remove-severity-attr)      drop the scratch attribute
 *
 * Everything in here is derived from opentelemetry-collector-contrib v0.154.0,
 * which is the collector the three agent images are built FROM (see
 * DockerAgent/Dockerfile.tpl: `FROM otel/opentelemetry-collector-contrib:0.154.0`).
 */

const OTEL_COLLECTOR_VERSION = "0.154.0";

/**
 * The OTel severity numbers, from the logs data model.
 * https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber
 */
const SEVERITY_NUMBER = {
  trace: 1,
  trace2: 2,
  trace3: 3,
  trace4: 4,
  debug: 5,
  debug2: 6,
  debug3: 7,
  debug4: 8,
  info: 9,
  info2: 10,
  info3: 11,
  info4: 12,
  warn: 13,
  warn2: 14,
  warn3: 15,
  warn4: 16,
  error: 17,
  error2: 18,
  error3: 19,
  error4: 20,
  fatal: 21,
  fatal2: 22,
  fatal3: 23,
  fatal4: 24,
};

/**
 * stanza's BUILT-IN `default` severity preset, transcribed from
 * pkg/stanza/operator/helper/severity_builder.go @ v0.154.0 (`getBuiltinMapping`).
 *
 * The "default" branch of that switch is `aliases` PLUS four warning aliases and
 * four err aliases:
 *
 *     default:
 *         mapping := getBuiltinMapping("aliases")
 *         mapping.add(entry.Warn, "warning")   ... "warning2".."warning4"
 *         mapping.add(entry.Error, "err")      ... "err2".."err4"
 *
 * and `aliases` is trace/trace2../fatal4 plus the numeric strings "1".."24".
 *
 * The point of transcribing it here rather than hand-waving it: WHAT IS NOT IN
 * THIS TABLE is what the agent configs have to supply themselves. `notice`,
 * `crit`, `critical` and `panic` are all absent, so a log line carrying one of
 * those keywords resolves to NO severity number at all — severity_parser leaves
 * the record Unspecified — unless the config's own `mapping:` block adds it.
 * That is the invariant `every keyword the regex can capture resolves to a real
 * severity` in ContainerAgentLogSeverity.test.js exists to hold.
 *
 * Verified against the real binary: running otelcol-contrib 0.154.0 with the
 * agent config minus its `mapping:` block emits severityNumber for
 * TRACE/DEBUG/INFO/WARN/WARNING/ERROR/ERR/FATAL and *no* severityNumber for
 * NOTICE/CRIT/CRITICAL/PANIC.
 */
function buildBuiltinDefaultPreset() {
  const mapping = {};

  for (const [level, number] of Object.entries(SEVERITY_NUMBER)) {
    mapping[level] = number;
    mapping[String(number)] = number;
  }

  // The four extra warn aliases and four extra err aliases the "default" preset
  // layers on top of "aliases".
  for (const suffix of ["", "2", "3", "4"]) {
    mapping[`warning${suffix}`] = SEVERITY_NUMBER[`warn${suffix}`];
    mapping[`err${suffix}`] = SEVERITY_NUMBER[`error${suffix}`];
  }

  return mapping;
}

/**
 * Resolve a severity keyword the way stanza's severity_parser does: lower-case
 * the incoming text (parseableValues() calls strings.ToLower), then look it up
 * in (built-in preset ∪ the operator's own `mapping:` block).
 *
 * Returns the OTel severity number, or 0 for "no match" — which is what the
 * collector actually emits in that case: the record keeps severityNumber
 * Unspecified rather than being dropped.
 */
function resolveSeverityNumber(text, severityParserOperator) {
  const table = buildBuiltinDefaultPreset();

  // `mapping:` is keyed by the TARGET level, valued by the source strings that
  // should land on it — the inverse of the lookup direction, so invert it here.
  const configured = severityParserOperator.mapping || {};

  for (const [level, sources] of Object.entries(configured)) {
    const number = SEVERITY_NUMBER[String(level).toLowerCase()];

    if (number === undefined) {
      throw new Error(
        `severity_parser mapping targets an unknown level "${level}"`,
      );
    }

    for (const source of Array.isArray(sources) ? sources : [sources]) {
      table[String(source).toLowerCase()] = number;
    }
  }

  return table[String(text).trim().toLowerCase()] || 0;
}

/**
 * OneUptime's ingest throws away whatever severityText a client sent and
 * re-derives it from severityNumber — see OtelLogsIngestService.getSeverityText,
 * which buckets 1-4/5-8/9-12/13-16/17-20/21-24 onto the seven LogSeverity enum
 * members. Mirrored here so the tests can assert that every severity these
 * agents can emit survives ingest as a real level rather than "Unspecified".
 */
function oneUptimeLogSeverity(severityNumber) {
  if (severityNumber >= 1 && severityNumber <= 4) {
    return "Trace";
  }
  if (severityNumber >= 5 && severityNumber <= 8) {
    return "Debug";
  }
  if (severityNumber >= 9 && severityNumber <= 12) {
    return "Information";
  }
  if (severityNumber >= 13 && severityNumber <= 16) {
    return "Warning";
  }
  if (severityNumber >= 17 && severityNumber <= 20) {
    return "Error";
  }
  if (severityNumber >= 21 && severityNumber <= 24) {
    return "Fatal";
  }
  return "Unspecified";
}

/**
 * Undo one layer of Go-style double-quoted string escaping.
 *
 * This is the step that makes the router's `expr` and the regex_parser's
 * `regex` two DIFFERENT strings on disk that must nevertheless compile to the
 * SAME pattern. The router's regex is written inside a string literal inside an
 * expr-lang expression, so it is escaped twice on the way in:
 *
 *   YAML single-quoted scalar   'body matches "...[\\s.\\[(\"]..."'
 *     -> YAML gives expr-lang    body matches "...[\\s.\\[(\"]..."
 *     -> expr-lang gives RE2     ...[\s.\[("]...
 *
 * while the regex_parser's `regex:` is a plain YAML scalar and reaches RE2 with
 * only one layer removed. Get the doubling wrong in either direction and the
 * two stop agreeing: the router would admit lines the parser cannot parse, or
 * reject lines that carry a level. Nothing in the collector cross-checks them —
 * `otelcol validate` compiles each in isolation and is happy — so the check has
 * to live in a test.
 *
 * expr-lang lexes double-quoted literals with Go's escape set, so this is
 * STRICT about unknown escapes rather than passing them through. That is not
 * pedantry: a pattern written with one backslash too few (`[\s...` where the
 * literal needs `[\\s...`) reads as the escape `\s`, which Go has no meaning
 * for, and the collector refuses to start with
 *
 *     failed to compile expression …: invalid char escape (1:26)
 *
 * Passing it through instead would make the two patterns compare equal and this
 * helper would report agreement on a config that cannot boot.
 */
const GO_STRING_ESCAPES = {
  a: "\u0007",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
  "\\": "\\",
  "'": "'",
  '"': '"',
};

function unescapeGoStringLiteral(literal) {
  let out = "";

  for (let index = 0; index < literal.length; index++) {
    const char = literal[index];

    if (char !== "\\") {
      out += char;
      continue;
    }

    const next = literal[index + 1];
    const replacement = GO_STRING_ESCAPES[next];

    if (replacement === undefined) {
      throw new Error(
        `invalid char escape \\${next === undefined ? "<end of string>" : next} at offset ${index}: ${literal}`,
      );
    }

    out += replacement;
    index++;
  }

  return out;
}

/**
 * Pull the RE2 pattern out of an expr-lang expression of the form
 *   body matches "<pattern>"
 * returning the pattern with expr-lang's string escaping already removed.
 */
function extractMatchesPattern(expression) {
  const match = /^body matches "(.*)"$/s.exec(String(expression).trim());

  if (!match) {
    throw new Error(
      `router expr is not of the form 'body matches "<regex>"': ${expression}`,
    );
  }

  return unescapeGoStringLiteral(match[1]);
}

/**
 * Compile a Go RE2 pattern as a JavaScript RegExp.
 *
 * Only two dialect differences matter for the patterns in these configs:
 *   - named groups are (?P<name>…) in RE2 and (?<name>…) in JS;
 *   - the inline (?i) flag is legal in RE2 and illegal in JS, so it is lifted
 *     to the `i` flag instead.
 *
 * Everything else in these patterns — non-capturing groups, character classes,
 * alternation, anchors — behaves identically, and both engines pick the
 * leftmost match with Perl-style leftmost-first alternation. The expectations
 * in ContainerAgentLogSeverity.test.js were cross-checked against the real
 * otelcol-contrib 0.154.0 binary, so a dialect surprise would show up as a
 * disagreement there rather than passing quietly.
 */
function compileRe2AsJs(pattern) {
  let flags = "";
  let source = pattern;

  while (source.startsWith("(?i)")) {
    flags = "i";
    source = source.slice("(?i)".length);
  }

  if (source.includes("(?i)")) {
    throw new Error(
      `inline (?i) away from the start of the pattern is not translatable: ${pattern}`,
    );
  }

  return new RegExp(source.replace(/\(\?P</g, "(?<"), flags);
}

/**
 * The alternatives of the first capturing group in the severity regex — i.e.
 * every keyword the chain can lift off a log body.
 */
function severityKeywordsFromRegex(pattern) {
  const group = /\(\?P<severity_text>([^)]+)\)/.exec(pattern);

  if (!group) {
    throw new Error(
      `severity regex has no (?P<severity_text>…) capture group: ${pattern}`,
    );
  }

  return group[1].split("|");
}

/**
 * Index a filelog operator list by `id`, failing loudly on a duplicate — stanza
 * would too, and an operator graph with two operators answering to one id is
 * not something a test should paper over.
 */
function indexOperatorsById(operators) {
  const byId = new Map();

  for (const operator of operators) {
    if (!operator.id) {
      continue;
    }

    if (byId.has(operator.id)) {
      throw new Error(`duplicate operator id: ${operator.id}`);
    }

    byId.set(operator.id, operator);
  }

  return byId;
}

/**
 * Every operator id an operator hands entries off to: its own `output`, plus a
 * router's per-route outputs and its `default`.
 */
function outputTargets(operator) {
  const targets = [];

  if (operator.output) {
    targets.push(operator.output);
  }

  if (operator.default) {
    targets.push(operator.default);
  }

  for (const route of operator.routes || []) {
    if (route.output) {
      targets.push(route.output);
    }
  }

  return targets;
}

module.exports = {
  OTEL_COLLECTOR_VERSION,
  SEVERITY_NUMBER,
  buildBuiltinDefaultPreset,
  compileRe2AsJs,
  extractMatchesPattern,
  indexOperatorsById,
  oneUptimeLogSeverity,
  outputTargets,
  resolveSeverityNumber,
  severityKeywordsFromRegex,
  unescapeGoStringLiteral,
};
