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
 *                  notice / crit / critical / panic)
 *   4. ingest    — every severity number the chain can emit survives
 *                  OneUptime's ingest as a real LogSeverity, not Unspecified
 *   5. behaviour — a corpus of real log lines maps to the level a human would
 *                  read off them, and the lines that merely mention a level
 *                  word in prose do not
 *   6. lockstep  — the three agents and the Kubernetes agent's DaemonSet
 *                  ConfigMap carry one identical chain
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
     * The pattern takes the LEFTMOST match, so a line whose message mentions a
     * level word before the real level field is read wrong. Pinned rather than
     * fixed: the alternative is parsing every line as JSON, and this shape is
     * rare next to the Monolog/zap shapes the chain does get right. If someone
     * later teaches the chain to prefer a `"level":` key, this test is the one
     * that should change.
     */
    test("known limitation: the leftmost level word wins, even inside the message", () => {
      expect(
        regex.exec('{"msg":"error, retrying","level":"info"}').groups
          .severity_text,
      ).toBe("error");

      // The Monolog shape puts the level first, so the same message is fine.
      expect(
        regex.exec("[2026-08-31 07:25:04] app.INFO: error, retrying").groups
          .severity_text,
      ).toBe("INFO");
    });

    /*
     * The pattern requires a delimiter AFTER the keyword, so a body that ENDS
     * on the level matches only when something follows it. Docker's json-file
     * driver keeps the trailing newline in the `log` field, so Docker and Swarm
     * bodies match; Podman's k8s-file (CRI) format does not, so the same line
     * from Podman falls back to the stream. Pinned so the divergence is a known
     * quantity rather than a surprise.
     */
    test("known limitation: a body ending on the keyword needs a trailing delimiter", () => {
      expect(regex.exec("log level is set to WARN")).toBeNull();
      expect(
        regex.exec("log level is set to WARN\n").groups.severity_text,
      ).toBe("WARN");
    });

    /*
     * CHARACTERIZATION, NOT APPROVAL.
     *
     * Everything below is a line the chain gets WRONG. None of it is a bug in
     * the operator graph — the graph does exactly what it says — it is the
     * price of deciding severity by scanning for a keyword, and it is worth
     * writing down because the price is not free and the PR that introduced
     * this chain described only the upside.
     *
     * Two directions of damage, both reproduced against otelcol-contrib
     * 0.154.0:
     *
     *   ESCALATION  a benign stdout line that mentions a level word in prose
     *               used to be Information and is now Error or Fatal;
     *   INVERSION   a genuine stderr ERROR whose message happens to contain an
     *               earlier level word used to be Error and is now Information
     *               — a real error hidden, which is the worse of the two.
     *
     * The inversion is sharpest for logfmt (`level=error msg="…"`), because
     * `=` is in the pattern's TRAILING delimiter class but not its leading one:
     * the real `level=` token can never be captured, while a level word later
     * in the message can. That is the whole Go/CNCF ecosystem — Grafana,
     * Traefik, Prometheus, Loki, the Docker daemon, the HashiCorp tools.
     *
     * Fixing it properly means making the scan field-aware, or at minimum
     * adding `=` to the leading class, in all four copies of the chain at
     * once. Until that happens these tests are the record of what is
     * happening, and the day someone changes them should be a deliberate one.
     */
    describe("characterization: what the keyword scan gets wrong", () => {
      const severityOf = (body) => {
        const match = regex.exec(body);

        return match
          ? oneUptimeLogSeverity(
              resolveSeverityNumber(match.groups.severity_text, severityParser),
            )
          : null;
      };

      test("escalates benign stdout prose that used to be Information", () => {
        // A success envelope. Every OK response in this service is now Error.
        expect(severityOf('{"status":"ok","error":null,"took_ms":12}\n')).toBe(
          "Error",
        );
        // logrus WithError(err).Info(...) — logged AT info, stored as Error.
        expect(
          severityOf('{"error":"conn refused","level":"info","msg":"retry"}\n'),
        ).toBe("Error");
        // And the worst of them: a recovery notice stored in the top bucket.
        expect(severityOf("Recovered from panic, continuing\n")).toBe("Fatal");
        expect(severityOf("Connection error, retrying in 5s\n")).toBe("Error");
      });

      test("inverts a real stderr error into Information when the message mentions a level first", () => {
        // logfmt: the real level is `error`, but `=` is not a leading
        // delimiter, so `level=error` is invisible and ` info,` wins.
        expect(
          severityOf(
            'level=error msg="upstream returned info, aborting" component=proxy\n',
          ),
        ).toBe("Information");
      });

      test("cannot see a logfmt level at all, because `=` is only a trailing delimiter", () => {
        expect(regex.exec("level=info msg=ready\n")).toBeNull();
        expect(regex.exec("level=error msg=boom\n")).toBeNull();
        // The very same keyword IS seen when quoted, which is what proves the
        // leading class — not the keyword list — is what excludes logfmt.
        expect(
          regex.exec('level="error" msg=boom\n').groups.severity_text,
        ).toBe("error");
      });

      test("misses the two most severe PSR-3 levels, which the commit set out to support", () => {
        // Monolog defines eight levels; the alternation carries six. ALERT and
        // EMERGENCY — the two above CRITICAL — fall back to the stream, so on
        // stdout a site-is-down line is stored as Information.
        expect(
          regex.exec("[2026-08-31 07:25:04] app.EMERGENCY: site down\n"),
        ).toBeNull();
        expect(
          regex.exec("[2026-08-31 07:25:04] app.ALERT: replica lag\n"),
        ).toBeNull();
        // nginx writes the same level as [emerg], and misses for the same reason.
        expect(
          regex.exec("2026/08/31 [emerg] 1#1: bind() failed\n"),
        ).toBeNull();
      });
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
