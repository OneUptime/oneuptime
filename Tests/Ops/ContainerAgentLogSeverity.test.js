"use strict";

/**
 * The container agents (DockerAgent, PodmanAgent, DockerSwarmAgent) ship a
 * baked-in OpenTelemetry Collector config. Container runtimes record no
 * severity on a log line, so the config has to derive one, and for a long time
 * it derived it from the stream alone: stderr -> ERROR, stdout -> INFO.
 *
 * That is wrong for any service that writes structured logs to stderr, which
 * PSR-3/Monolog and Go's zap and logrus all do by default. Their entire log
 * stream — INFO, DEBUG, the lot — arrived stamped ERROR. The chain now reads a
 * level keyword out of the body first and only falls back to the stream when
 * there is no keyword to read.
 *
 * The first version of that read was an unanchored keyword scan, and it cost
 * more than it looked. It took the leftmost level word ANYWHERE in the
 * recombined body, with no notion of which token was the level, so
 * `{"status":"ok","error":null}` on stdout became Error, `Recovered from panic`
 * became Fatal, and — because `=` was a trailing delimiter but not a leading
 * one — logfmt's `level=error` was invisible while a level word later in the
 * same message was not, turning a genuine error into Information. The scan is
 * now FIELD-AWARE: a keyword counts only where a level actually sits, which is
 * one of exactly two shapes.
 *
 *   1. LINE PREAMBLE — the keyword is on the first line of the record and
 *      everything before it is preamble: punctuation, digits, and word tokens
 *      ending on a structural delimiter. "[ERROR] …", "app.INFO: …",
 *      "2026-08-31 07:25:04 INFO …", "… - myapp - INFO - …", "level=error …".
 *      Prose is not preamble, which is what keeps "Connection error, retrying"
 *      out.
 *   2. LEVEL FIELD — the keyword is the value of a level-ish key anywhere in
 *      the line (level / lvl / severity / severity_text / levelname /
 *      log.level / log_level), quoted or not, separated by ":" or "=". That is
 *      zap and logrus JSON, and logfmt whose level is not the first field.
 *
 * The preamble branch is anchored, so it is always the leftmost match when it
 * matches at all, and therefore beats a level field further along the line.
 *
 * These tests exist because that chain has no other guard rail. It is YAML
 * baked into three separate images; nothing compiles it, and `otelcol validate`
 * only proves each operator is individually well-formed — it will happily
 * accept a router whose regex has drifted away from the parser's, or a keyword
 * list that has outgrown the severity mapping. Both of those failure modes are
 * silent and both make the agent WORSE than the stream-only behaviour it
 * replaced, so each one gets a test below:
 *
 *   1. structure — the operator graph resolves and nothing is unreachable
 *   2. escaping  — the router's regex and the parser's regex are the same
 *                  pattern after their two different layers of quoting
 *   3. coverage  — every keyword the regex can capture resolves to a real OTel
 *                  severity number (stanza's built-in preset does NOT know
 *                  notice / crit / critical / panic / alert / emerg /
 *                  emergency)
 *   4. ingest    — every severity number the chain can emit survives
 *                  OneUptime's ingest as a real LogSeverity, not Unspecified
 *   5. behaviour — a corpus of real log lines maps to the level a human would
 *                  read off them, and the lines that merely mention a level
 *                  word in prose do not
 *   6. lockstep  — the three agents and the Kubernetes agent's DaemonSet
 *                  ConfigMap carry one identical chain
 *   7. regression — every line the unanchored scan got wrong, kept as a test
 *                  in the direction it is now supposed to go
 *
 * The expectations were cross-checked against the real thing: each config was
 * run through otelcol-contrib 0.154.0 (the version the images are built FROM)
 * over a fixture log file, and the severityNumber/severityText this suite
 * predicts is the severityNumber/severityText the collector emitted.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const {
  compileRe2AsJs,
  extractMatchesPattern,
  indexOperatorsById,
  oneUptimeLogSeverity,
  outputTargets,
  resolveSeverityNumber,
  severityKeywordsFromRegex,
  unescapeGoStringLiteral,
} = require("./Utils/StanzaSeverity.js");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The three agents whose `filelog` receiver carries the severity chain. */
const AGENTS = ["DockerAgent", "PodmanAgent", "DockerSwarmAgent"];

/**
 * The Kubernetes agent grew this chain first. It lives in a Helm template, so
 * it cannot be parsed as YAML wholesale — the block itself is plain YAML and is
 * lifted out textually below.
 */
const KUBERNETES_CONFIGMAP_PATH = path.join(
  REPO_ROOT,
  "HelmChart",
  "Public",
  "kubernetes-agent",
  "templates",
  "configmap-daemonset.yaml",
);

/** The chain, in the order the operators must appear in the list. */
const SEVERITY_CHAIN_IDS = [
  "severity-router",
  "parse-severity-from-body",
  "add-fallback-severity",
  "severity-parser",
  "remove-severity-attr",
];

/** The scratch attribute the chain writes and must clean up again. */
const SCRATCH_ATTRIBUTE = "attributes.severity_text";

function readAgentOperators(agent) {
  const configPath = path.join(REPO_ROOT, agent, "otel-collector-config.yaml");
  const config = yaml.load(fs.readFileSync(configPath, "utf8"));
  const operators = config.receivers.filelog.operators;

  if (!Array.isArray(operators) || operators.length === 0) {
    throw new Error(`${agent}: receivers.filelog.operators is empty`);
  }

  return operators;
}

/**
 * Lift the severity chain out of the Kubernetes agent's Helm template as text
 * and parse just that block.
 *
 * Deliberately strict: if a `{{ … }}` action ever appears inside the block the
 * extraction stops and the lockstep test fails loudly, rather than quietly
 * comparing half a chain.
 */
function readKubernetesOperators() {
  const lines = fs.readFileSync(KUBERNETES_CONFIGMAP_PATH, "utf8").split("\n");
  const start = lines.findIndex((line, index) => {
    return (
      /^\s*- type: router\s*$/.test(line) &&
      /^\s*id: severity-router\s*$/.test(lines[index + 1] || "")
    );
  });

  if (start === -1) {
    throw new Error(
      `${KUBERNETES_CONFIGMAP_PATH}: no 'severity-router' operator found`,
    );
  }

  const markerIndent = lines[start].length - lines[start].trimStart().length;
  const block = [];

  for (let index = start; index < lines.length; index++) {
    const line = lines[index];

    if (line.trim() === "") {
      continue;
    }

    if (line.includes("{{")) {
      break;
    }

    const indent = line.length - line.trimStart().length;

    if (indent < markerIndent) {
      break;
    }

    block.push(line.slice(markerIndent));
  }

  return severityChain(KUBERNETES_CONFIGMAP_PATH, yaml.load(block.join("\n")));
}

const AGENT_OPERATORS = new Map(
  AGENTS.map((agent) => {
    return [agent, readAgentOperators(agent)];
  }),
);

/**
 * A corpus of log lines as the agents actually see them, with the level a human
 * reads off each one.
 *
 * `keyword` is what the regex is expected to capture, or null when the line
 * carries no level and must therefore fall through to the stdout/stderr
 * fallback. Every non-null expectation here was produced by running the real
 * collector over the same line.
 */
const CORPUS = [
  // PSR-3 / Monolog. The keyword sits after a dot ("app.INFO:"), which a plain
  // word-boundary or whitespace match misses — this is half the reason the
  // stream-only behaviour branded whole PHP services ERROR.
  {
    body: '[2026-08-31 07:25:04] app.INFO: user logged in {"id":7} []',
    keyword: "INFO",
  },
  {
    body: "[2026-08-31 07:25:04] request.WARNING: slow response",
    keyword: "WARNING",
  },
  {
    body: "[2026-08-31 07:25:04] app.ERROR: connection refused",
    keyword: "ERROR",
  },
  { body: "[2026-08-31 07:25:04] doctrine.DEBUG: SELECT 1", keyword: "DEBUG" },
  {
    body: "[2026-08-31 07:25:04] php.CRITICAL: out of memory",
    keyword: "CRITICAL",
  },
  // The two PSR-3 levels ABOVE critical. Monolog defines eight; the alternation
  // carried six, so a site-is-down line on stdout was stored as Information.
  {
    body: "[2026-08-31 07:25:04] app.ALERT: replica lag 900s",
    keyword: "ALERT",
  },
  {
    body: "[2026-08-31 07:25:04] app.EMERGENCY: site is down",
    keyword: "EMERGENCY",
  },
  // nginx spells emergency [emerg], and missed for the same reason.
  { body: "2026/08/31 07:25:04 [emerg] 1#1: bind() failed", keyword: "emerg" },

  // Go zap / logrus / slog. The keyword sits between double quotes — the other
  // half of the reason.
  {
    body: '{"level":"info","ts":1756628704.1,"msg":"started"}',
    keyword: "info",
  },
  {
    body: '{"level":"warn","ts":1756628704.1,"msg":"retrying"}',
    keyword: "warn",
  },
  {
    body: '{"level":"error","ts":1756628704.1,"msg":"conn refused"}',
    keyword: "error",
  },
  {
    body: '{"time":"2026-08-31T07:25:04Z","level":"INFO","msg":"ready"}',
    keyword: "INFO",
  },

  // Shapes a whitespace/bracket match already handled — kept so the widened
  // delimiter class cannot regress them.
  { body: "[ERROR] something bad happened", keyword: "ERROR" },
  { body: "WARN: disk almost full", keyword: "WARN" },
  { body: "2026-08-31 07:25:04 INFO starting up", keyword: "INFO" },
  { body: "[INFO] plugin/reload: Running configuration MD5", keyword: "INFO" },
  {
    body: "2026/08/31 07:25:04 [error] 12#12: *1 open() failed",
    keyword: "error",
  },
  { body: "2026-08-31 07:25:04,123 - myapp - INFO - ready", keyword: "INFO" },
  { body: "07:25:04.123 [main] INFO  c.e.App - started", keyword: "INFO" },
  { body: "info: Microsoft.Hosting.Lifetime[14]", keyword: "info" },

  // logfmt — Grafana, Traefik, Prometheus, Loki, the Docker daemon and the
  // HashiCorp tools. Invisible to the old scan, because `=` was a trailing
  // delimiter and not a leading one.
  { body: "level=info msg=ready", keyword: "info" },
  { body: "level=error msg=boom", keyword: "error" },
  { body: 'level="error" msg=boom', keyword: "error" },
  {
    body: 'time="2026-08-31T07:25:04Z" level=error msg=x',
    keyword: "error",
  },
  {
    body: "ts=2026-08-31T07:25:04Z caller=main.go:42 level=warn msg=x",
    keyword: "warn",
  },
  { body: "component=proxy level=error msg=x", keyword: "error" },

  // The other names structured loggers give the level field.
  { body: '{"severity":"ERROR","message":"boom"}', keyword: "ERROR" },
  { body: '{"severity_text":"WARN","message":"x"}', keyword: "WARN" },
  { body: '{"log.level":"warn","message":"x"}', keyword: "warn" },
  { body: '{"log_level":"debug","message":"x"}', keyword: "debug" },
  { body: '{"levelname":"DEBUG","msg":"x"}', keyword: "DEBUG" },
  { body: "lvl=warn msg=x", keyword: "warn" },

  // A level that is the last thing on the line. Docker's json-file driver keeps
  // the trailing newline in the `log` field and Podman's CRI format does not,
  // so a consumed trailing delimiter made the two agents disagree here.
  { body: "2026-08-31 07:25:04 ERROR", keyword: "ERROR" },
  { body: "2026-08-31 07:25:04 ERROR\n", keyword: "ERROR" },
  { body: "level=error", keyword: "error" },
  { body: "[WARN]", keyword: "WARN" },

  // Aliases stanza's built-in preset does NOT know. Each of these is
  // Unspecified unless the config's own `mapping:` block supplies it.
  { body: "[NOTICE] configuration reloaded", keyword: "NOTICE" },
  { body: "[CRIT] disk failing", keyword: "CRIT" },
  { body: "[PANIC] goroutine died", keyword: "PANIC" },

  // Aliases the built-in preset does know.
  { body: "[TRACE] entering handler", keyword: "TRACE" },
  { body: "[ERR] short alias", keyword: "ERR" },
  { body: "[FATAL] cannot bind port", keyword: "FATAL" },

  // Lines with no level. These must NOT match: the fallback is only correct
  // because it is reached exactly when there is nothing to read.
  { body: "Server listening on port 8080", keyword: null },
  { body: "    at com.example.Foo.bar(Foo.java:42)", keyword: null },
  { body: "GET https://api.example.com/v1/errors?x=1 200", keyword: null },
  { body: "there were 3 errors", keyword: null },
  { body: "informational message", keyword: null },
  { body: "loaded config from /etc/app/warning.yaml", keyword: null },
  { body: "service.warning.example.com resolved", keyword: null },
  // klog's single-letter prefix would need its own letter-to-level mapping.
  {
    body: "I0831 07:25:04.123456       1 server.go:100] Serving",
    keyword: null,
  },
  // An ANSI colour escape sits between the delimiter and the keyword, so the
  // keyword is not seen. Colour-coded stdout falls back to INFO, as before.
  { body: "\u001b[32mINFO\u001b[0m starting", keyword: null },

  // Ordinary container output that merely MENTIONS a level word. Every one of
  // these was escalated by the unanchored scan; none of them carries a level.
  { body: '{"status":"ok","error":null,"took_ms":12}', keyword: null },
  { body: "Recovered from panic, continuing", keyword: null },
  { body: "Connection error, retrying in 5s", keyword: null },
  { body: "Import finished with status: ERROR", keyword: null },
  { body: "log level is set to WARN", keyword: null },
  { body: "An error occurred while doing the thing", keyword: null },
  { body: "failed to fetch: 3 errors occurred", keyword: null },
  { body: "Deprecation warning in module foo", keyword: null },
  { body: "No errors found", keyword: null },
  { body: "the error rate is low", keyword: null },
  { body: "curl -sS http://x/ --level=info", keyword: null },
  { body: "Traceback (most recent call last):", keyword: null },
  { body: "npm notice New minor version of npm available!", keyword: null },
];

/**
 * Thirty ordinary container stdout lines carrying no level field at all. The
 * unanchored scan reclassified eleven of them; the fallback is only correct if
 * it is reached, so NONE of these may match.
 */
const LEVEL_FREE_STDOUT = [
  "Server listening on port 8080",
  "Listening and serving HTTP on :8080",
  "Ready to accept connections tcp",
  "Database connection established",
  "Migrated 12 of 12 migrations",
  "Cache warmed in 84ms",
  "GET /healthz 200 1.2ms",
  "POST /api/v1/errors 201 8.4ms",
  '{"status":"ok","error":null,"took_ms":12}',
  '{"ok":true,"errors":[],"warnings":[]}',
  '{"event":"request.finished","status":200}',
  "Recovered from panic, continuing",
  "Connection error, retrying in 5s",
  "An error occurred while doing the thing",
  "No errors found",
  "there were 3 errors",
  "failed to fetch: 3 errors occurred",
  "the error rate is low",
  "Deprecation warning in module foo",
  "log level is set to WARN",
  "Import finished with status: ERROR",
  "informational message",
  "loaded config from /etc/app/warning.yaml",
  "service.warning.example.com resolved",
  "curl -sS http://x/ --level=info",
  "Traceback (most recent call last):",
  "    at com.example.Foo.bar(Foo.java:42)",
  "npm notice New minor version of npm available!",
  "Compiled successfully in 1240ms",
  "Shutting down gracefully",
];

/**
 * The five operators, in chain order, or a hard error naming what is missing.
 * Loud on purpose: every test below reaches into these, and "cannot read
 * property 'regex' of undefined" is a bad way to be told the chain is gone.
 */
function severityChain(source, operators) {
  const byId = indexOperatorsById(operators);
  const missing = SEVERITY_CHAIN_IDS.filter((id) => {
    return !byId.has(id);
  });

  if (missing.length > 0) {
    throw new Error(
      `${source}: severity chain is missing ${missing.join(", ")}`,
    );
  }

  return SEVERITY_CHAIN_IDS.map((id) => {
    return byId.get(id);
  });
}

describe.each(AGENTS)("%s severity operator chain", (agent) => {
  const operators = AGENT_OPERATORS.get(agent);
  const byId = indexOperatorsById(operators);
  const chain = severityChain(agent, operators);
  const [router, bodyParser, fallback, severityParser, cleanup] = chain;

  test("carries all five severity operators, in order, with the right types", () => {
    const positions = SEVERITY_CHAIN_IDS.map((id) => {
      return operators.findIndex((operator) => {
        return operator.id === id;
      });
    });

    expect(positions).toEqual(
      [...positions].sort((a, b) => {
        return a - b;
      }),
    );

    expect(router.type).toBe("router");
    expect(bodyParser.type).toBe("regex_parser");
    expect(fallback.type).toBe("add");
    expect(severityParser.type).toBe("severity_parser");
    expect(cleanup.type).toBe("remove");
  });

  test("every operator output names an operator that exists", () => {
    for (const operator of operators) {
      for (const target of outputTargets(operator)) {
        expect(byId.has(target)).toBe(true);
      }
    }
  });

  /*
   * A stanza router has no implicit fall-through: an entry that matches no
   * route and has no `default` is dropped on the floor. Without `default` here,
   * every log line WITHOUT a level keyword — the majority of container output —
   * would silently vanish. That is log loss, not a mislabelled severity, so it
   * gets its own assertion.
   */
  test("the router sends keyword-less lines to the stream fallback rather than dropping them", () => {
    expect(router.default).toBe("add-fallback-severity");
    expect(router.routes).toHaveLength(1);
    expect(router.routes[0].output).toBe("parse-severity-from-body");
  });

  /*
   * Both branches have to converge on the severity parser, and the scratch
   * attribute has to be removed on both. If the cleanup were reachable from
   * only one branch, half the records would ship a stray `severity_text`
   * attribute that duplicates the record's own severity field.
   */
  test("both branches converge on the severity parser and then the cleanup", () => {
    expect(bodyParser.output).toBe("severity-parser");
    expect(fallback.output).toBe("severity-parser");

    // severity-parser has no explicit output, so it flows to the next operator
    // in the list — which must be the cleanup.
    expect(severityParser.output).toBeUndefined();

    const severityParserIndex = operators.findIndex((operator) => {
      return operator.id === "severity-parser";
    });

    expect(operators[severityParserIndex + 1].id).toBe("remove-severity-attr");
    expect(cleanup.field).toBe(SCRATCH_ATTRIBUTE);
    expect(severityParser.parse_from).toBe(SCRATCH_ATTRIBUTE);
    expect(fallback.field).toBe(SCRATCH_ATTRIBUTE);
  });

  /*
   * The fallback reads attributes["log.iostream"]. That attribute is not set by
   * the receiver — an earlier `move` puts it there from the runtime's own
   * stream field. If the chain were ever reordered above that move, the
   * expression would compare undefined against "stderr" and quietly stamp every
   * record INFO, including the genuine errors.
   */
  test("log.iostream is populated before the fallback reads it", () => {
    const moveIndex = operators.findIndex((operator) => {
      return (
        operator.type === "move" &&
        operator.from === "attributes.stream" &&
        operator.to === 'attributes["log.iostream"]'
      );
    });

    expect(moveIndex).toBeGreaterThanOrEqual(0);

    const fallbackIndex = operators.findIndex((operator) => {
      return operator.id === "add-fallback-severity";
    });

    expect(moveIndex).toBeLessThan(fallbackIndex);
    expect(fallback.value).toBe(
      'EXPR(attributes["log.iostream"] == "stderr" ? "ERROR" : "INFO")',
    );
  });

  /*
   * `body matches …` errors at runtime if body is not a string, and the router
   * then falls through to its default — every keyword-carrying line would take
   * the stream fallback and the fix would be a no-op. An earlier `move … to:
   * body` is what guarantees body is the log text and not the parsed envelope.
   */
  test("body holds the log text by the time the router matches on it", () => {
    const moveIndex = operators.findIndex((operator) => {
      return operator.type === "move" && operator.to === "body";
    });

    expect(moveIndex).toBeGreaterThanOrEqual(0);

    const routerIndex = operators.findIndex((operator) => {
      return operator.id === "severity-router";
    });

    expect(moveIndex).toBeLessThan(routerIndex);
  });

  /*
   * THE ESCAPING TEST.
   *
   * The router's pattern is a regex inside an expr-lang string literal inside a
   * YAML scalar, so it is written with doubled backslashes and escaped quotes;
   * the parser's pattern is a bare YAML scalar written with single backslashes.
   * They are different bytes on disk that must become the same RE2 pattern, and
   * nothing in the collector notices when they stop agreeing — the router would
   * admit lines the parser cannot parse (leaving them Unspecified) or reject
   * lines that carry a level (undoing the fix entirely).
   */
  test("the router's regex and the parser's regex are the same pattern", () => {
    const routerPattern = extractMatchesPattern(router.routes[0].expr);
    const parserPattern = bodyParser.regex;

    expect(routerPattern).toBe(
      parserPattern.replace("(?P<severity_text>", "("),
    );
  });

  test("the parser reads the body and writes the attribute the severity parser reads", () => {
    expect(bodyParser.parse_from).toBe("body");
    expect(severityKeywordsFromRegex(bodyParser.regex).length).toBeGreaterThan(
      0,
    );
    // parse_to is left at its default (`attributes`), which MERGES the capture
    // into the existing attribute map rather than replacing it — verified
    // against otelcol-contrib 0.154.0, where log.iostream and log.file.path
    // both survive this operator.
    expect(bodyParser.parse_to).toBeUndefined();
  });

  /*
   * THE COVERAGE TEST.
   *
   * stanza's built-in `default` preset knows trace/debug/info/warn/warning/
   * error/err/fatal and nothing else — no notice, no crit, no critical, no
   * panic. A keyword the regex captures but the mapping cannot resolve does not
   * error and does not drop the record: severity_parser leaves it Unspecified,
   * which is strictly worse than the stderr->ERROR guess it replaced. So the
   * keyword list and the mapping have to stay in step, and this is the test
   * that makes adding a keyword without a mapping fail.
   */
  test("every keyword the regex can capture resolves to a real severity number", () => {
    const unresolved = severityKeywordsFromRegex(bodyParser.regex).filter(
      (keyword) => {
        return resolveSeverityNumber(keyword, severityParser) === 0;
      },
    );

    expect(unresolved).toEqual([]);
  });

  /*
   * The same list, one layer further down: OneUptime's ingest discards the
   * severityText a client sends and re-derives it from severityNumber
   * (OtelLogsIngestService.getSeverityText), bucketing 1-4/5-8/9-12/13-16/
   * 17-20/21-24 onto the seven LogSeverity members. A number outside those
   * ranges lands on "Unspecified" and the Logs page cannot filter it.
   */
  test("every severity the chain can emit survives OneUptime ingest as a real level", () => {
    const severities = severityKeywordsFromRegex(bodyParser.regex).map(
      (keyword) => {
        return oneUptimeLogSeverity(
          resolveSeverityNumber(keyword, severityParser),
        );
      },
    );

    expect(severities).not.toContain("Unspecified");
    // And the fallback's own two values, which never go through the regex.
    expect(
      oneUptimeLogSeverity(resolveSeverityNumber("ERROR", severityParser)),
    ).toBe("Error");
    expect(
      oneUptimeLogSeverity(resolveSeverityNumber("INFO", severityParser)),
    ).toBe("Information");
  });

  test("the aliases the built-in preset does not know are supplied by the config", () => {
    // Named explicitly rather than derived, so dropping one of them from the
    // mapping fails here with the alias in the message.
    expect(resolveSeverityNumber("notice", severityParser)).toBe(9);
    expect(resolveSeverityNumber("crit", severityParser)).toBe(17);
    expect(resolveSeverityNumber("critical", severityParser)).toBe(17);
    expect(resolveSeverityNumber("panic", severityParser)).toBe(21);
    // PSR-3 and syslog put alert and emergency above critical; nginx spells
    // emergency [emerg]. None of the three has a built-in mapping either.
    expect(resolveSeverityNumber("alert", severityParser)).toBe(21);
    expect(resolveSeverityNumber("emerg", severityParser)).toBe(21);
    expect(resolveSeverityNumber("emergency", severityParser)).toBe(21);
  });

  /*
   * Monolog implements all eight PSR-3 levels and this chain was written for
   * Monolog, so a keyword list that carries only six of them is a hole with a
   * name. The two it used to miss — ALERT and EMERGENCY — are the two above
   * CRITICAL, which is the worst possible half to drop.
   */
  test("the keyword list covers all eight PSR-3 levels", () => {
    const keywords = severityKeywordsFromRegex(bodyParser.regex).map(
      (keyword) => {
        return keyword.toLowerCase();
      },
    );

    for (const level of [
      "debug",
      "info",
      "notice",
      "warning",
      "error",
      "critical",
      "alert",
      "emergency",
    ]) {
      expect(keywords).toContain(level);
    }
  });

  test("matching is case-insensitive, as stanza lower-cases before lookup", () => {
    for (const text of ["ERROR", "error", "Error", "eRRoR"]) {
      expect(resolveSeverityNumber(text, severityParser)).toBe(17);
    }
  });

  describe("reads the level a human would read off the line", () => {
    const regex = compileRe2AsJs(bodyParser.regex);

    test.each(
      CORPUS.map((entry) => {
        return [entry.body, entry.keyword];
      }),
    )("%s -> %s", (body, keyword) => {
      const match = regex.exec(body);

      if (keyword === null) {
        expect(match).toBeNull();
        return;
      }

      expect(match).not.toBeNull();
      expect(match.groups.severity_text).toBe(keyword);
    });

    test("the levels it reads carry the severity numbers OTel defines", () => {
      const expected = {
        "[TRACE] x": 1,
        "[DEBUG] x": 5,
        "[INFO] x": 9,
        "[NOTICE] x": 9,
        "[WARN] x": 13,
        "[WARNING] x": 13,
        "[ERROR] x": 17,
        "[ERR] x": 17,
        "[CRIT] x": 17,
        "[CRITICAL] x": 17,
        "[FATAL] x": 21,
        "[PANIC] x": 21,
      };

      for (const [body, severityNumber] of Object.entries(expected)) {
        const match = regex.exec(body);

        expect(match).not.toBeNull();
        expect(
          resolveSeverityNumber(match.groups.severity_text, severityParser),
        ).toBe(severityNumber);
      }
    });

    /*
     * The alternation lists WARN before WARNING and ERR before ERROR. Both RE2
     * and JS take the leftmost match and, within it, the first alternative that
     * lets the whole pattern succeed — so "[WARNING]" captures WARNING (WARN
     * fails because "I" is not a closing delimiter), not a truncated WARN.
     * Getting this wrong would still resolve to the right severity here, but it
     * would matter the moment an alias maps somewhere the prefix does not.
     */
    test("a longer keyword is not truncated to the shorter alternative before it", () => {
      expect(regex.exec("[WARNING] x").groups.severity_text).toBe("WARNING");
      expect(regex.exec("[ERROR] x").groups.severity_text).toBe("ERROR");
      expect(regex.exec("[CRITICAL] x").groups.severity_text).toBe("CRITICAL");
    });

    /*
     * The two branches meet here. The preamble branch is anchored at the start
     * of the body, so whenever it matches its match begins at offset 0 — which
     * is leftmost by construction, and therefore beats the level-field branch
     * anywhere later in the line. That ordering is the whole reason a line can
     * carry both a real preamble level and the word `level=` in its message
     * without the message winning.
     */
    test("an anchored preamble level beats a level field later in the line", () => {
      expect(
        regex.exec("[ERROR] could not apply level=debug").groups.severity_text,
      ).toBe("ERROR");
      expect(
        regex.exec("[2026-08-31 07:25:04] app.INFO: error, retrying").groups
          .severity_text,
      ).toBe("INFO");
    });

    /*
     * And the other way round: with no preamble level, the level FIELD is what
     * decides, not the first level-looking word in the message. This is the
     * shape the unanchored scan inverted — a genuine error stored as
     * Information, which is worse than any amount of escalation.
     */
    test("the level field beats a level word quoted inside the message", () => {
      expect(
        regex.exec('{"msg":"error, retrying","level":"info"}').groups
          .severity_text,
      ).toBe("info");
      expect(
        regex.exec('{"error":"conn refused","level":"info","msg":"retry"}')
          .groups.severity_text,
      ).toBe("info");
    });

    /*
     * Prose is not a preamble. The preamble is punctuation, digits, and word
     * tokens that end on a structural delimiter; a bare word followed by a
     * space ends it. "Connection error, retrying" therefore stops dead at
     * "Connection " and never reaches the keyword, which is the mechanism the
     * whole escalation class rests on.
     */
    test("a bare word followed by a space ends the preamble", () => {
      expect(regex.exec("Connection error, retrying in 5s")).toBeNull();
      expect(regex.exec("Recovered from panic, continuing")).toBeNull();
      // The same word one token earlier, where a preamble can still reach it.
      expect(regex.exec("Error, connection refused").groups.severity_text).toBe(
        "Error",
      );
      // And a word token that DOES end on a delimiter is preamble, which is
      // what makes Monolog's "app.INFO:" and Python's "- myapp - INFO -" work.
      expect(regex.exec("myapp - INFO - ready").groups.severity_text).toBe(
        "INFO",
      );
    });

    /*
     * The trailing delimiter used to have to be CONSUMED, so a body ending on
     * its level only matched when something followed it. Docker's json-file
     * driver keeps the trailing newline in the `log` field and Podman's CRI
     * format does not, so the two agents read the same line differently. End of
     * body is now a delimiter in its own right and they agree.
     */
    test("a level at the very end of the body is read, newline or not", () => {
      for (const body of [
        "2026-08-31 07:25:04 ERROR",
        "2026-08-31 07:25:04 ERROR\n",
        "level=error",
        "level=error\n",
        "[WARN]",
        "[WARN]\n",
      ]) {
        expect(regex.exec(body)).not.toBeNull();
      }
    });

    /*
     * The recombine operator glues a stack trace into one record, so the body
     * the scan sees is multi-line. The preamble branch is anchored with `^` and
     * neither pattern is in multiline mode, so only the FIRST line can supply a
     * preamble level — a level word on a continuation line is not one.
     */
    test("only the first line of a recombined body can carry a preamble level", () => {
      expect(
        regex.exec("[INFO] request finished\n    ERROR in frame\n").groups
          .severity_text,
      ).toBe("INFO");
      expect(
        regex.exec("Server started\n    at Foo.bar\n    ERROR here\n"),
      ).toBeNull();
    });

    /*
     * THE REGRESSION BLOCK.
     *
     * Every line below is a line the unanchored keyword scan got wrong, in the
     * direction it got it wrong. They were the `characterization` block until
     * the scan was made field-aware; keeping them as assertions of the FIXED
     * behaviour is what stops the fix being undone by a well-meaning widening
     * of the delimiter classes.
     *
     * Two directions of damage, both reproduced against otelcol-contrib
     * 0.154.0 before the fix:
     *
     *   ESCALATION  a benign stdout line that mentions a level word in prose
     *               was Information and became Error or Fatal;
     *   INVERSION   a genuine stderr ERROR whose message happened to contain an
     *               earlier level word was Error and became Information — a
     *               real error hidden, which is the worse of the two.
     */
    describe("regression: what the unanchored keyword scan got wrong", () => {
      const severityOf = (body, stream) => {
        const match = regex.exec(body);

        if (match) {
          return oneUptimeLogSeverity(
            resolveSeverityNumber(match.groups.severity_text, severityParser),
          );
        }

        // No keyword: the chain's `add` operator supplies the stream fallback.
        return oneUptimeLogSeverity(
          resolveSeverityNumber(
            stream === "stderr" ? "ERROR" : "INFO",
            severityParser,
          ),
        );
      };

      test("no longer escalates benign stdout prose", () => {
        // A success envelope. Every OK response in this service used to be
        // Error, because `"error":null` sat inside it.
        expect(
          severityOf('{"status":"ok","error":null,"took_ms":12}\n', "stdout"),
        ).toBe("Information");
        // logrus WithError(err).Info(...) — logged AT info, stored as Error.
        expect(
          severityOf(
            '{"error":"conn refused","level":"info","msg":"retry"}\n',
            "stdout",
          ),
        ).toBe("Information");
        // And the worst of them: a recovery notice in the top bucket.
        expect(severityOf("Recovered from panic, continuing\n", "stdout")).toBe(
          "Information",
        );
        expect(severityOf("Connection error, retrying in 5s\n", "stdout")).toBe(
          "Information",
        );
      });

      test("no longer inverts a real error into Information", () => {
        // logfmt: the real level is `error`. `=` was a trailing delimiter and
        // not a leading one, so `level=error` was invisible and ` info,` won.
        expect(
          severityOf(
            'level=error msg="upstream returned info, aborting" component=proxy\n',
            "stderr",
          ),
        ).toBe("Error");
      });

      test("sees a logfmt level, which it could not before", () => {
        expect(regex.exec("level=info msg=ready\n").groups.severity_text).toBe(
          "info",
        );
        expect(regex.exec("level=error msg=boom\n").groups.severity_text).toBe(
          "error",
        );
        expect(
          regex.exec('level="error" msg=boom\n').groups.severity_text,
        ).toBe("error");
      });

      test("reads the two most severe PSR-3 levels", () => {
        // Monolog defines eight levels; the alternation carried six. ALERT and
        // EMERGENCY — the two above CRITICAL — fell back to the stream, so on
        // stdout a site-is-down line was stored as Information.
        expect(
          severityOf(
            "[2026-08-31 07:25:04] app.EMERGENCY: site down\n",
            "stdout",
          ),
        ).toBe("Fatal");
        expect(
          severityOf(
            "[2026-08-31 07:25:04] app.ALERT: replica lag\n",
            "stdout",
          ),
        ).toBe("Fatal");
        // nginx writes the same level as [emerg], and missed for the same reason.
        expect(
          severityOf("2026/08/31 [emerg] 1#1: bind() failed\n", "stdout"),
        ).toBe("Fatal");
      });

      test("Docker and Podman agree on a body that ends on its level", () => {
        // Docker's json-file driver keeps the newline, Podman's CRI does not.
        const docker = "Import finished, level=error\n";
        const podman = "Import finished, level=error";

        expect(severityOf(docker, "stdout")).toBe(severityOf(podman, "stdout"));
        expect(severityOf(docker, "stdout")).toBe("Error");
      });

      /*
       * The whole point of the fallback is that it is reached when there is
       * nothing to read. Thirty ordinary stdout lines, eleven of which the
       * unanchored scan reclassified; none of them may match now.
       */
      test.each(LEVEL_FREE_STDOUT)(
        "level-free stdout stays Information: %s",
        (body) => {
          expect(regex.exec(body)).toBeNull();
          expect(severityOf(body, "stdout")).toBe("Information");
        },
      );
    });

    /*
     * The pattern runs on every log line the agent ships, and the Kubernetes
     * API-mode tailer runs the same source through JavaScript's BACKTRACKING
     * engine rather than RE2. A pattern that is linear in RE2 can still be
     * exponential there, so the shapes that could blow up — long runs of
     * letters and digits, of separators, of quoted tokens — get a wall-clock
     * bound rather than a promise.
     */
    test("pathological bodies do not blow up the backtracking engine", () => {
      const bodies = [
        "a".repeat(20000),
        "a1".repeat(10000),
        "ab. ".repeat(5000),
        "a -".repeat(5000),
        "x=".repeat(10000),
        `${"level=".repeat(5000)}error`,
        `${"[".repeat(10000)}ERROR`,
        `${"\t ".repeat(10000)}ERROR`,
      ];

      const started = Date.now();

      for (const body of bodies) {
        regex.exec(body);
      }

      expect(Date.now() - started).toBeLessThan(2000);
    });
  });
});

describe("the severity chain is identical everywhere it ships", () => {
  /*
   * Three agent images and a Helm ConfigMap carry this chain. They were written
   * as copies of one another, and a fix applied to one of them and not the rest
   * is the obvious way for them to rot. Comparing the parsed operators (not the
   * text) means comments and indentation are free to differ per file while the
   * behaviour cannot.
   */
  const reference = severityChain(
    "DockerAgent",
    AGENT_OPERATORS.get("DockerAgent"),
  );

  test.each(AGENTS.slice(1))("%s matches DockerAgent", (agent) => {
    expect(severityChain(agent, AGENT_OPERATORS.get(agent))).toEqual(reference);
  });

  test("the Kubernetes agent DaemonSet ConfigMap matches too", () => {
    expect(readKubernetesOperators()).toEqual(reference);
  });
});

describe("Go string-literal unescaping", () => {
  /*
   * The escaping test above is only worth anything if this helper is right, so
   * it gets its own cases — including the one that actually appears in the
   * config, where a doubled backslash and an escaped quote sit inside the same
   * character class.
   */
  test("collapses doubled backslashes and escaped quotes", () => {
    expect(unescapeGoStringLiteral('[\\\\s.\\\\[(\\")]')).toBe('[\\s.\\[(")]');
    expect(unescapeGoStringLiteral("\\\\d+")).toBe("\\d+");
    expect(unescapeGoStringLiteral('say \\"hi\\"')).toBe('say "hi"');
  });

  /*
   * The failure this catches: writing the router's pattern with the parser's
   * single-backslash escaping. `\s` is not a Go escape, so expr-lang rejects it
   * and the collector refuses to start — but a lenient unescaper would quietly
   * hand back `\s` and make the two patterns compare EQUAL, reporting agreement
   * on a config that cannot boot.
   */
  test("rejects an escape Go has no meaning for, as expr-lang does", () => {
    expect(() => {
      return unescapeGoStringLiteral('[\\s.\\[(")]');
    }).toThrow(/invalid char escape/);
  });

  test("rejects an expr that is not a plain `body matches` test", () => {
    expect(() => {
      return extractMatchesPattern('attributes.foo == "bar"');
    }).toThrow(/body matches/);
  });
});
