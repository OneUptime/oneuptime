"use strict";

/**
 * Helpers for reading the log-severity operator chain out of an agent's
 * OpenTelemetry Collector config and reasoning about it the way the collector
 * does.
 *
 * The three container agents (DockerAgent, PodmanAgent, DockerSwarmAgent) and
 * the Kubernetes agent's DaemonSet ConfigMap all carry the SAME chain inside
 * `receivers.filelog.operators`:
 *
 *   router(severity-router), the first route that holds:
 *     -> regex_parser(parse-klog-severity)       klog's I/W/E/F letter
 *     -> add(add-exception-severity)             an exception's header: ERROR
 *     -> add(add-warning-severity)               a Python/Node warning: WARN
 *     -> regex_parser(parse-numeric-severity)    pino/bunyan's "level":30
 *     -> regex_parser(parse-severity-from-body)  a level word where one sits
 *     -> add(add-fallback-severity)              nothing read, stdout: INFO
 *     default -> noop(severity-unspecified)      nothing read, stderr: none
 *   then -> severity_parser(severity-parser)  text -> LogRecord severity number
 *        -> remove(remove-severity-attr)      drop the scratch attribute
 *        -> noop(severity-unspecified)        where the default joins them
 *
 * Everything in here is derived from opentelemetry-collector-contrib v0.165.0,
 * which is the collector the three agent images are built FROM (see
 * DockerAgent/Dockerfile.tpl: `FROM otel/opentelemetry-collector-contrib:0.165.0`).
 * It was first derived from v0.154.0; severity_builder.go is byte-identical
 * between the two tags.
 */

const OTEL_COLLECTOR_VERSION = "0.165.0";

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
 * pkg/stanza/operator/helper/severity_builder.go @ v0.165.0, byte-identical to v0.161.0's (`getBuiltinMapping`).
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
 * otelcol-contrib binary (0.154.0, and again 0.161.0), so a dialect surprise would show up as a
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
 * The source of the group that opens at `start` (the index of its "("), read
 * to its balanced ")" — escaped parentheses and character classes skipped —
 * without the parentheses themselves.
 */
function balancedGroupBody(pattern, start) {
  let depth = 0;
  let inClass = false;

  for (let index = start; index < pattern.length; index++) {
    const char = pattern[index];

    if (char === "\\") {
      index++;
      continue;
    }

    if (inClass) {
      if (char === "]") {
        inClass = false;
      }
      continue;
    }

    if (char === "[") {
      inClass = true;
    } else if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;

      if (depth === 0) {
        return pattern.slice(start + 1, index);
      }
    }
  }

  throw new Error(`unbalanced group at offset ${start}: ${pattern}`);
}

/** `source` split on the "|" that are not inside a group or a class. */
function topLevelAlternatives(source) {
  const alternatives = [];
  let depth = 0;
  let inClass = false;
  let current = "";

  for (let index = 0; index < source.length; index++) {
    const char = source[index];

    if (char === "\\") {
      current += char + (source[index + 1] || "");
      index++;
      continue;
    }

    if (inClass) {
      inClass = char !== "]";
    } else if (char === "[") {
      inClass = true;
    } else if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;
    } else if (char === "|" && depth === 0) {
      alternatives.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  alternatives.push(current);

  return alternatives;
}

/**
 * The texts one alternative of a severity_text group can capture. The groups
 * in these configs use three shapes, and anything else is refused rather than
 * guessed at:
 *
 *   WORD          a literal keyword ("WARNING");
 *   (?-i:WORD)    a keyword matched in this case only ("LOG");
 *   [CLASS]tail   one character of a class, then a literal: klog's [IWEF] and
 *                 pino's [1-6]0.
 */
function expandSeverityAlternative(alternative) {
  if (/^[A-Za-z0-9]+$/.test(alternative)) {
    return [alternative];
  }

  const caseOnly = /^\(\?-i:([A-Za-z0-9|]+)\)$/.exec(alternative);

  if (caseOnly) {
    return caseOnly[1].split("|");
  }

  const classed = /^\[([^\]]+)\]([A-Za-z0-9]*)$/.exec(alternative);

  if (classed) {
    const members = [];
    const body = classed[1];

    for (let index = 0; index < body.length; index++) {
      if (body[index + 1] === "-" && body[index + 2] !== undefined) {
        for (
          let code = body.charCodeAt(index);
          code <= body.charCodeAt(index + 2);
          code++
        ) {
          members.push(String.fromCharCode(code));
        }
        index += 2;
      } else {
        members.push(body[index]);
      }
    }

    return members.map((member) => {
      return member + classed[2];
    });
  }

  throw new Error(
    `cannot list what this severity_text alternative captures: ${alternative}`,
  );
}

/**
 * Every text the severity_text capture group of a regex_parser's pattern can
 * lift off a log body: the keywords of the body reader, klog's four letters,
 * pino's six numbers.
 */
function severityKeywordsFromRegex(pattern) {
  const start = pattern.indexOf("(?P<severity_text>");

  if (start === -1) {
    throw new Error(
      `severity regex has no (?P<severity_text>…) capture group: ${pattern}`,
    );
  }

  const body = balancedGroupBody(pattern, start).slice(
    "?P<severity_text>".length,
  );

  return topLevelAlternatives(body).flatMap(expandSeverityAlternative);
}

/** The one stream route the chain has: an unread line on stdout. */
const STDOUT_ROUTE_EXPR = 'attributes["log.iostream"] != "stderr"';

/**
 * The fallback the chain had until issue #10972: an `add` whose value was an
 * expression of the stream. The only expression the chain ever computed a
 * level with, so `classify` can walk a config from before the fix and show
 * what it did; anything else that starts EXPR( is refused.
 */
const STREAM_GUESS_EXPR =
  'EXPR(attributes["log.iostream"] == "stderr" ? "ERROR" : "INFO")';

/**
 * Whether a router route sends this record its way, decided as stanza does:
 * a route is one expr-lang boolean over the entry. The chain uses exactly two
 * forms, `body matches "<RE2>"` and the stdout test, so anything else throws
 * rather than being evaluated wrongly.
 */
function routeMatches(expr, body, stream) {
  if (expr === STDOUT_ROUTE_EXPR) {
    return stream !== "stderr";
  }

  return compileRe2AsJs(extractMatchesPattern(expr)).test(body);
}

/**
 * What the chain does with one record, walked operator by operator the way
 * stanza runs it: the router hands it to the FIRST route whose expression
 * holds (or to its default), that operator lifts or adds the level text, and
 * the severity parser turns the text into a number.
 *
 * Returns the operator that read it (`reader`), the text, the OTel severity
 * number and the LogSeverity OneUptime stores. A route whose parser cannot
 * parse what the route admitted throws: in the collector that record would
 * leave Unspecified with an error logged, which is the router/parser drift
 * the escaping tests exist to catch.
 */
function classify(operators, body, stream) {
  const byId = indexOperatorsById(operators);
  const router = byId.get("severity-router");

  if (!router) {
    throw new Error("no severity-router operator");
  }

  const route = (router.routes || []).find((candidate) => {
    return routeMatches(candidate.expr, body, stream);
  });
  const reader = route ? route.output : router.default;
  const operator = byId.get(reader);

  if (!operator) {
    throw new Error(
      `the router sends records to ${reader}, which is no operator`,
    );
  }

  if (operator.type === "noop") {
    return { reader, text: null, number: 0, severity: "Unspecified" };
  }

  let text;

  if (operator.type === "regex_parser") {
    const match = compileRe2AsJs(operator.regex).exec(body);

    if (!match) {
      throw new Error(
        `${reader} cannot parse a body its route admitted: ${JSON.stringify(body)}`,
      );
    }

    text = match.groups.severity_text;
  } else if (operator.type === "add") {
    if (operator.value === STREAM_GUESS_EXPR) {
      text = stream === "stderr" ? "ERROR" : "INFO";
    } else if (String(operator.value).startsWith("EXPR(")) {
      throw new Error(
        `${reader} adds an expression, not a level: ${operator.value}`,
      );
    } else {
      text = String(operator.value);
    }
  } else {
    throw new Error(`${reader} is a ${operator.type}, which reads no level`);
  }

  const severityParser = byId.get(operator.output);

  if (!severityParser || severityParser.type !== "severity_parser") {
    throw new Error(`${reader} does not hand its text to the severity parser`);
  }

  const number = resolveSeverityNumber(text, severityParser);

  return { reader, text, number, severity: oneUptimeLogSeverity(number) };
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
  STDOUT_ROUTE_EXPR,
  STREAM_GUESS_EXPR,
  buildBuiltinDefaultPreset,
  classify,
  compileRe2AsJs,
  extractMatchesPattern,
  indexOperatorsById,
  oneUptimeLogSeverity,
  outputTargets,
  resolveSeverityNumber,
  severityKeywordsFromRegex,
  topLevelAlternatives,
  unescapeGoStringLiteral,
};
