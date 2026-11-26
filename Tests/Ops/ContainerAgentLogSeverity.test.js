"use strict";

/**
 * The container agents (DockerAgent, PodmanAgent, DockerSwarmAgent) and the
 * Kubernetes agent's DaemonSet ship a baked-in OpenTelemetry Collector config.
 * Container runtimes record no severity on a log line, only the stream it was
 * written to, so the config has to derive one. It does that with one chain of
 * stanza operators, duplicated in all four configs:
 *
 *   severity-router                 the FIRST route that holds:
 *     parse-klog-severity           klog/glog's letter: I W E F
 *     add-exception-severity        an exception's header: ERROR
 *     add-warning-severity          a Python or Node warning category: WARN
 *     parse-numeric-severity        pino/bunyan's "level":30
 *     parse-severity-from-body      a level word where a level sits
 *     add-fallback-severity         nothing read, on stdout: INFO
 *   default:
 *     severity-unspecified          nothing read, on stderr: no severity
 *   severity-parser                 the text -> the OTel severity number
 *   remove-severity-attr            drop the scratch attribute
 *
 * HOW IT GOT HERE.
 *
 * First the severity was the stream alone: stderr -> ERROR, stdout -> INFO.
 * Then a level keyword was read off the body, and the stream kept as the
 * fallback; that read was first an unanchored scan, which escalated prose
 * ("Recovered from panic" -> Fatal) and inverted logfmt ("level=error" ->
 * Information), and was made field-aware: a keyword counts only in the line's
 * PREAMBLE or as the value of a level FIELD (see parse-severity-from-body in
 * the configs).
 *
 * Issue #10972: the field-aware read still missed common formats, and every
 * line it missed on stderr was stored as Error. A time ending in "Z" (hclog,
 * zap's console encoder, Spring Boot 3, MySQL, Traefik, Rust's tracing) ended
 * the preamble, so "2026-11-23T18:58:14.670Z [INFO]" read nothing; hclog's
 * JSON key is "@level"; klog's level is a letter glued to the date;
 * PostgreSQL's informational level is "LOG", after its time zone. Programs
 * write all their logs to stderr more often than not (klog, zap's production
 * config, logrus, hclog, Python's logging, PostgreSQL), so their INFO and
 * WARN lines were Errors, and `filters.logs.minSeverity: ERROR` kept them.
 *
 * So the chain now reads those formats, and an unread line on stderr is no
 * longer claimed as ERROR: stderr is where programs write their diagnostics,
 * all of them, and a line there that names no level says nothing about its
 * level. It is stored with no severity (Unspecified), which the minSeverity
 * filter keeps, as the API-mode tailer keeps every line it cannot read. An
 * unread line on stdout is still INFO: stdout is a program's ordinary output.
 * The errors that name no level still read as ERROR, by their shape: a
 * traceback, an uncaught exception, a panic (add-exception-severity).
 *
 * WHAT IS TESTED HERE.
 *
 * Nothing compiles this chain, and `otelcol validate` only proves each
 * operator is well-formed. So:
 *
 *   1. structure  — every operator, in order, and an operator graph in which
 *                   nothing is unreachable and every branch converges;
 *   2. escaping   — each route's regex and its parser's regex are the same
 *                   pattern after their two different layers of quoting;
 *   3. coverage   — every text a parser can capture, and every level an `add`
 *                   writes, resolves to a real OTel severity number;
 *   4. ingest     — every number the chain emits is a real LogSeverity;
 *   5. behaviour  — the corpus (Utils/LogSeverityCorpus.js: real lines, most
 *                   captured from the programs themselves) reads as a human
 *                   reads it, through each config's own operators, and prose
 *                   that merely mentions a level word is not read;
 *   6. regression — the chain as it shipped in 17.0.0 really did misread the
 *                   corpus the way it says, and the unanchored scan's
 *                   mistakes stay fixed;
 *   7. cost       — every reader is linear on pathological input in
 *                   JavaScript's backtracking engine, which the API-mode
 *                   tailer runs these patterns through;
 *   8. lockstep   — the four configs carry one identical chain.
 *
 * Tests/Ops/agent-log-severity-behaviour.sh runs the same corpus through the
 * real collector, with each config as it ships.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { CASES, PROSE } = require("./Utils/LogSeverityCorpus.js");
const {
  STDOUT_ROUTE_EXPR,
  classify,
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
  "parse-klog-severity",
  "add-exception-severity",
  "add-warning-severity",
  "parse-numeric-severity",
  "parse-severity-from-body",
  "add-fallback-severity",
  "severity-parser",
  "remove-severity-attr",
  "severity-unspecified",
];

/** The type each of those operators must be. */
const OPERATOR_TYPES = {
  "severity-router": "router",
  "parse-klog-severity": "regex_parser",
  "add-exception-severity": "add",
  "add-warning-severity": "add",
  "parse-numeric-severity": "regex_parser",
  "parse-severity-from-body": "regex_parser",
  "add-fallback-severity": "add",
  "severity-parser": "severity_parser",
  "remove-severity-attr": "remove",
  "severity-unspecified": "noop",
};

/**
 * The router's routes, in the order they must be tried. Order is meaning
 * here: stanza takes the FIRST route whose expression holds, so a reader that
 * knows exactly where a format keeps its level (klog's letter, an
 * exception's header, pino's top-level number) goes before the general read,
 * which would otherwise find a level field further along the same line.
 */
const ROUTE_OUTPUTS = [
  "parse-klog-severity",
  "add-exception-severity",
  "add-warning-severity",
  "parse-numeric-severity",
  "parse-severity-from-body",
  "add-fallback-severity",
];

/** The level each `add` operator writes. */
const ADDED_LEVELS = {
  "add-exception-severity": "ERROR",
  "add-warning-severity": "WARN",
  "add-fallback-severity": "INFO",
};

/** The scratch attribute the chain writes and must clean up again. */
const SCRATCH_ATTRIBUTE = "attributes.severity_text";

function readAgentOperators(agent) {
  const configPath = path.join(
    REPO_ROOT,
    "agents",
    agent,
    "otel-collector-config.yaml",
  );
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

  return yaml.load(block.join("\n"));
}

/**
 * The chain's operators, in chain order, or a hard error naming what is
 * missing. Loud on purpose: every test below reaches into these, and "cannot
 * read property 'regex' of undefined" is a bad way to be told the chain is
 * gone.
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

const KUBERNETES_SOURCE = "the Kubernetes agent's DaemonSet";

/**
 * Every config the chain ships in: an agent's whole operator list, or the
 * Kubernetes agent's chain on its own.
 */
const CONFIGS = new Map([
  ...AGENTS.map((agent) => {
    return [agent, readAgentOperators(agent)];
  }),
  [KUBERNETES_SOURCE, readKubernetesOperators()],
]);

/** The pattern a regex_parser of the chain uses. */
function parserPattern(operators, id) {
  return indexOperatorsById(operators).get(id).regex;
}

/** The RE2 pattern of the route that leads to `output`. */
function routePattern(operators, output) {
  const router = indexOperatorsById(operators).get("severity-router");
  const route = router.routes.find((candidate) => {
    return candidate.output === output;
  });

  return extractMatchesPattern(route.expr);
}

/*
 * THE CHAIN AS IT SHIPPED IN 17.0.0 (and up to issue #10972), kept so the
 * suite can show what it did to the corpus: one route, the field-aware read,
 * and a stream fallback of stderr -> ERROR, stdout -> INFO.
 */
const CHAIN_AS_SHIPPED_IN_17_0_0 = {
  pattern: String.raw`(?i)(?:^(?:[^A-Za-z"\n]|[A-Za-z][A-Za-z0-9_]*[ \t]*[.:=,/>|)}\]-])*?|(?:^|[\s,{\[])"?(?:log[._]?level|severity_?text|severity|levelname|level|lvl)"?[ \t]*[:=][ \t]*"?)(?P<severity_text>TRACE|DEBUG|INFO|NOTICE|WARNING|WARN|EMERGENCY|EMERG|ALERT|CRITICAL|CRIT|ERROR|ERR|FATAL|PANIC)(?:$|[\s\]:=,)"}|>])`,
  severityParser: {
    mapping: {
      warn: ["warning"],
      error: ["err", "crit", "critical"],
      fatal: ["panic", "alert", "emerg", "emergency"],
      info: ["notice"],
    },
  },
};

function severityAsShippedIn17(body, stream) {
  const match = compileRe2AsJs(CHAIN_AS_SHIPPED_IN_17_0_0.pattern).exec(body);
  const text = match
    ? match.groups.severity_text
    : stream === "stderr"
      ? "ERROR"
      : "INFO";

  return oneUptimeLogSeverity(
    resolveSeverityNumber(text, CHAIN_AS_SHIPPED_IN_17_0_0.severityParser),
  );
}

/**
 * Pathological bodies for the backtracking engine, each as a function of a
 * repetition count. Shapes that could blow up any of the readers: long runs
 * of letters and digits, of separators, of colour codes, of timestamps, of
 * JSON pairs, of what looks like a package path or a file and line.
 */
const PATHOLOGICAL = {
  letters: (n) => "a".repeat(n),
  alnum: (n) => "a1".repeat(n),
  wordDot: (n) => "ab. ".repeat(n),
  wordDash: (n) => "a -".repeat(n),
  equals: (n) => "x=".repeat(n),
  levelEquals: (n) => `${"level=".repeat(n)}error`,
  brackets: (n) => `${"[".repeat(n)}ERROR`,
  bracketsThenNothing: (n) => `${"[".repeat(n)}x`,
  tabs: (n) => `${"\t ".repeat(n)}ERROR`,
  zuluThenBracket: (n) => "0Z]".repeat(n),
  zuluThenDash: (n) => "0Z -".repeat(n),
  zoneThenDash: (n) => "UTC -".repeat(n),
  colourColon: (n) => "\u001b[0m:".repeat(n),
  colours: (n) => `${"\u001b[0m".repeat(n)}x`,
  coloursAroundBracket: (n) =>
    `${"\u001b[0m".repeat(n)}[${"\u001b[0m".repeat(n)}x`,
  openEscapes: (n) => `${"\u001b[".repeat(n)}x`,
  timestamps: (n) => "2026-11-23T18:58:14.670Z,".repeat(n),
  timestampsWithZone: (n) => `${"2026-11-23T18:58:14.670Z UTC ".repeat(n)}x`,
  ctimes: (n) => `${"Thu Nov 26 04:02:18 2026 ".repeat(n)}x`,
  jsonStringLevels: (n) => `{${'"level":"x",'.repeat(n)}}`,
  jsonNumbers: (n) => `{${'"level":3'.repeat(n)}}`,
  jsonPairs: (n) => `{${'"a":"b",'.repeat(n)}"level":7}`,
  tracebacks: (n) => "Traceback ".repeat(n),
  packages: (n) => `${"java.".repeat(n)}x`,
  packagesThenException: (n) => `${"a.".repeat(n)}Exception`,
  fileLines: (n) => `${"/x:1: ".repeat(n)}x`,
  klogSpaces: (n) => `I1126 04:01:25.858478 ${" ".repeat(n)}1 x`,
  nodePids: (n) => "(node:1) ".repeat(n),
  camelWarning: (n) => `${"A".repeat(n)}Warning`,
  warningFileThenNothing: (n) => `/app/x.py:1: ${"A".repeat(n)}`,
  digitsColon: (n) => `${"1:".repeat(n)}x`,
  quotes: (n) => `${'" '.repeat(n)}x`,
  celeryProcess: (n) => `INFO/${"A".repeat(n)}`,
};

describe.each([...CONFIGS.keys()])("%s: the severity chain", (source) => {
  const operators = CONFIGS.get(source);
  const byId = indexOperatorsById(operators);
  const router = byId.get("severity-router");
  const severityParser = byId.get("severity-parser");
  // Looked up in the tests rather than here, so that a config missing part
  // of the chain fails those tests and still runs the corpus.
  const chain = () => {
    return severityChain(source, operators);
  };

  test("carries every operator of the chain, in order, with the right types", () => {
    chain();

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

    for (const operator of chain()) {
      expect([operator.id, operator.type]).toEqual([
        operator.id,
        OPERATOR_TYPES[operator.id],
      ]);
    }
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
   * route and has no `default` is dropped. The default is what keeps every
   * line nothing reads, and it must lead to no severity at all.
   */
  test("tries the readers in order, and sends what none of them reads on stderr to no severity", () => {
    expect(
      router.routes.map((route) => {
        return route.output;
      }),
    ).toEqual(ROUTE_OUTPUTS);
    expect(router.default).toBe("severity-unspecified");
  });

  test("only an unread line on stdout falls back to the stream, and to INFO", () => {
    const fallbackRoute = router.routes.find((route) => {
      return route.output === "add-fallback-severity";
    });

    expect(fallbackRoute.expr).toBe(STDOUT_ROUTE_EXPR);
    expect(byId.get("add-fallback-severity").value).toBe("INFO");
  });

  /*
   * THE HONEST FALLBACK (issue #10972). The old fallback was
   * EXPR(stderr ? "ERROR" : "INFO"), so every stderr line nothing read was
   * claimed as an Error. Nothing in the chain may compute a level from the
   * stream again: the stream decides only between INFO (stdout) and no
   * severity at all (stderr).
   */
  test("no operator claims a level from the stream: an unread stderr line is not an Error", () => {
    for (const operator of chain()) {
      expect(JSON.stringify(operator)).not.toMatch(/EXPR\(/);
    }

    expect(byId.get("severity-unspecified").output).toBeUndefined();
    expect(
      classify(operators, "connecting to the database at db:5432", "stderr"),
    ).toEqual({
      reader: "severity-unspecified",
      text: null,
      number: 0,
      severity: "Unspecified",
    });
    expect(
      classify(operators, "connecting to the database at db:5432", "stdout")
        .severity,
    ).toBe("Information");
  });

  /*
   * Every reader hands its text to the severity parser, which flows on to the
   * cleanup, which flows on to the noop the default leads to. If the cleanup
   * were reachable from only some branches, those records would ship a stray
   * `severity_text` attribute; if the default led past the noop to the
   * cleanup, every unread stderr line would log a "field does not exist"
   * error.
   */
  test("every reader converges on the severity parser, then the cleanup, then the end", () => {
    for (const output of ROUTE_OUTPUTS) {
      expect([output, byId.get(output).output]).toEqual([
        output,
        "severity-parser",
      ]);
    }

    for (const id of ["severity-parser", "remove-severity-attr"]) {
      expect(byId.get(id).output).toBeUndefined();
    }

    const at = (id) => {
      return operators.findIndex((operator) => {
        return operator.id === id;
      });
    };

    expect(at("remove-severity-attr")).toBe(at("severity-parser") + 1);
    expect(at("severity-unspecified")).toBe(at("remove-severity-attr") + 1);
    expect(at("severity-unspecified")).toBe(operators.length - 1);
    expect(byId.get("remove-severity-attr").field).toBe(SCRATCH_ATTRIBUTE);
    expect(severityParser.parse_from).toBe(SCRATCH_ATTRIBUTE);

    for (const id of Object.keys(ADDED_LEVELS)) {
      expect(byId.get(id).field).toBe(SCRATCH_ATTRIBUTE);
    }
  });

  test("each add operator writes its fixed level", () => {
    for (const [id, level] of Object.entries(ADDED_LEVELS)) {
      expect([id, byId.get(id).value]).toEqual([id, level]);
    }
  });

  /*
   * Whether an operator comes before the router. The Kubernetes agent's chain
   * is lifted out of its template on its own, so for it the operators before
   * the chain are read off the template's text: the same operators, in the
   * same order, as YAML lines.
   */
  const comesBeforeRouter = (operatorMatches, templatePattern) => {
    if (source !== KUBERNETES_SOURCE) {
      const index = operators.findIndex(operatorMatches);

      return index >= 0 && index < operators.indexOf(router);
    }

    const text = fs.readFileSync(KUBERNETES_CONFIGMAP_PATH, "utf8");
    const match = templatePattern.exec(text);

    return Boolean(match) && match.index < text.indexOf("id: severity-router");
  };

  /*
   * The stdout route reads attributes["log.iostream"]. That attribute is not
   * set by the receiver — an earlier `move` puts it there from the runtime's
   * own stream field. Reordered above that move, the route would see no
   * stream at all and send every unread line to INFO.
   */
  test("log.iostream is populated before the router reads it", () => {
    expect(
      comesBeforeRouter(
        (operator) => {
          return (
            operator.type === "move" &&
            operator.from === "attributes.stream" &&
            operator.to === 'attributes["log.iostream"]'
          );
        },
        /- type: move\s+id: move-stream\s+from: attributes\.stream\s+to: attributes\["log\.iostream"\]/,
      ),
    ).toBe(true);
  });

  /*
   * `body matches …` errors at runtime if body is not a string, and the router
   * then falls through to its default. An earlier `move … to: body` is what
   * guarantees body is the log text and not the parsed envelope.
   */
  test("body holds the log text by the time the router matches on it", () => {
    expect(
      comesBeforeRouter(
        (operator) => {
          return operator.type === "move" && operator.to === "body";
        },
        /- type: move\s+from: attributes\.log\s+to: body/,
      ),
    ).toBe(true);
  });

  /*
   * THE ESCAPING TEST.
   *
   * A route's pattern is a regex inside an expr-lang string literal inside a
   * YAML scalar, so it is written with doubled backslashes and escaped quotes;
   * its parser's pattern is a bare YAML scalar written with single backslashes.
   * They are different bytes on disk that must become the same RE2 pattern, and
   * nothing in the collector notices when they stop agreeing — the router
   * would admit lines the parser cannot parse (leaving them Unspecified, with
   * an error logged for each) or reject lines that carry a level.
   */
  test.each(["parse-klog-severity", "parse-numeric-severity", "parse-severity-from-body"])(
    "the route to %s uses its parser's pattern",
    (id) => {
      expect(routePattern(operators, id)).toBe(
        parserPattern(operators, id).replace("(?P<severity_text>", "("),
      );
      expect(byId.get(id).parse_from).toBe("body");
      // parse_to is left at its default (`attributes`), which MERGES the
      // capture into the attribute map rather than replacing it, so
      // log.iostream and log.file.path survive the parser.
      expect(byId.get(id).parse_to).toBeUndefined();
    },
  );

  test("every route's pattern compiles", () => {
    for (const route of router.routes) {
      if (route.expr !== STDOUT_ROUTE_EXPR) {
        expect(() => {
          return compileRe2AsJs(extractMatchesPattern(route.expr));
        }).not.toThrow();
      }
    }
  });

  /*
   * THE COVERAGE TEST.
   *
   * stanza's built-in `default` preset knows trace/debug/info/warn/warning/
   * error/err/fatal and nothing else. A text a parser captures but the
   * mapping cannot resolve does not error and does not drop the record:
   * severity_parser leaves it Unspecified. So every text every parser can
   * capture — the body reader's keywords, klog's letters, pino's numbers —
   * and every level an `add` writes must resolve.
   */
  test("every text the chain can produce resolves to a real severity number", () => {
    const texts = [
      ...["parse-klog-severity", "parse-numeric-severity", "parse-severity-from-body"].flatMap(
        (id) => {
          return severityKeywordsFromRegex(parserPattern(operators, id));
        },
      ),
      ...Object.values(ADDED_LEVELS),
    ];

    expect(texts.length).toBeGreaterThan(40);

    const unresolved = texts.filter((text) => {
      return resolveSeverityNumber(text, severityParser) === 0;
    });

    expect(unresolved).toEqual([]);
  });

  /*
   * One layer further down: OneUptime's ingest discards the severityText a
   * client sends and re-derives it from severityNumber
   * (OtelLogsIngestService.getSeverityText). A number outside the six ranges
   * lands on "Unspecified" and the Logs page cannot filter it.
   */
  test("every number the chain can emit survives OneUptime ingest as a real level", () => {
    const texts = [
      "parse-klog-severity",
      "parse-numeric-severity",
      "parse-severity-from-body",
    ].flatMap((id) => {
      return severityKeywordsFromRegex(parserPattern(operators, id));
    });

    for (const text of [...texts, ...Object.values(ADDED_LEVELS)]) {
      expect([
        text,
        oneUptimeLogSeverity(resolveSeverityNumber(text, severityParser)),
      ]).not.toEqual([text, "Unspecified"]);
    }
  });

  test("maps the level vocabularies each format writes onto the level it means", () => {
    const expected = {
      // klog / glog
      I: "Information",
      W: "Warning",
      E: "Error",
      F: "Fatal",
      // pino / bunyan
      10: "Trace",
      20: "Debug",
      30: "Information",
      40: "Warning",
      50: "Error",
      60: "Fatal",
      // PostgreSQL's informational level, and MySQL / MariaDB's
      LOG: "Information",
      Note: "Information",
      // .NET's console prefixes
      trce: "Trace",
      dbug: "Debug",
      fail: "Error",
      crit: "Error",
      // zerolog's and Serilog's three letters
      TRC: "Trace",
      DBG: "Debug",
      VRB: "Debug",
      INF: "Information",
      WRN: "Warning",
      FTL: "Fatal",
      PNC: "Fatal",
      // java.util.logging, .NET's full name, log15, zap's DPanic
      SEVERE: "Error",
      Information: "Information",
      Informational: "Information",
      eror: "Error",
      DPANIC: "Error",
      // PSR-3 / syslog, and the shapes read by their form
      notice: "Information",
      alert: "Fatal",
      emerg: "Fatal",
      emergency: "Fatal",
      panic: "Fatal",
      ERROR: "Error",
      WARN: "Warning",
      INFO: "Information",
    };

    for (const [text, severity] of Object.entries(expected)) {
      expect([
        text,
        oneUptimeLogSeverity(resolveSeverityNumber(text, severityParser)),
      ]).toEqual([text, severity]);
    }
  });

  /*
   * Monolog implements all eight PSR-3 levels and the body reader was written
   * for Monolog, so a keyword list that carries only six of them is a hole
   * with a name.
   */
  test("the body reader's keywords cover all eight PSR-3 levels", () => {
    const keywords = severityKeywordsFromRegex(
      parserPattern(operators, "parse-severity-from-body"),
    ).map((keyword) => {
      return keyword.toLowerCase();
    });

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

  /*
   * THE CORPUS. Each line goes through this config's own operators, as
   * stanza runs them, and must be read by the reader the corpus names and
   * stored as the level a human reads off it.
   */
  describe("reads the level a human reads off the line", () => {
    test.each(
      CASES.map((entry) => {
        return [entry.name, entry];
      }),
    )("%s", (name, entry) => {
      const result = classify(operators, entry.body, entry.stream);

      expect({ reader: result.reader, severity: result.severity }).toEqual({
        reader: entry.reader,
        severity: entry.severity,
      });
    });

    /*
     * Prose that mentions a level word but has none. Read as a level it would
     * escalate on stdout and claim a level it does not have on stderr; it
     * must reach the stream's answer instead: INFO on stdout, nothing on
     * stderr.
     */
    test.each(PROSE)("prose is not a level: %s", (body) => {
      expect(classify(operators, body, "stdout")).toMatchObject({
        reader: "add-fallback-severity",
        severity: "Information",
      });
      expect(classify(operators, body, "stderr")).toMatchObject({
        reader: "severity-unspecified",
        severity: "Unspecified",
      });
    });
  });

  describe("how the body reader decides", () => {
    const regex = compileRe2AsJs(
      parserPattern(operators, "parse-severity-from-body"),
    );
    const read = (body) => {
      const match = regex.exec(body);

      return match ? match.groups.severity_text : null;
    };

    /*
     * The alternation lists WARN before WARNING-like prefixes only where the
     * longer word comes first, and both RE2 and JS take the first alternative
     * that lets the whole pattern succeed, so "[WARNING]" captures WARNING
     * rather than a truncated WARN, and "INFORMATION" is not cut to INFO.
     */
    test("a longer keyword is not truncated to a shorter one", () => {
      expect(read("[WARNING] x")).toBe("WARNING");
      expect(read("[ERROR] x")).toBe("ERROR");
      expect(read("[CRITICAL] x")).toBe("CRITICAL");
      expect(read('{"LogLevel":"Information"}')).toBe("Information");
      expect(read("[EMERGENCY] x")).toBe("EMERGENCY");
    });

    /*
     * The preamble branch is anchored at the start of the body, so whenever it
     * matches its match begins at offset 0, which beats the level-field branch
     * anywhere later in the line.
     */
    test("an anchored preamble level beats a level field later in the line", () => {
      expect(read("[ERROR] could not apply level=debug")).toBe("ERROR");
      expect(read("[2026-08-31 07:25:04] app.INFO: error, retrying")).toBe(
        "INFO",
      );
      // And past a time ending in Z, which used to end the preamble and let
      // the level field win.
      expect(read("2026-11-23T18:58:14.670Z [INFO] set level=error")).toBe(
        "INFO",
      );
      expect(
        read("2026-11-26 04:02:18 UTC [27] LOG:  statement: SET level=error"),
      ).toBe("LOG");
    });

    test("the level field beats a level word quoted inside the message", () => {
      expect(read('{"msg":"error, retrying","level":"info"}')).toBe("info");
      expect(read('{"error":"conn refused","level":"info","msg":"retry"}')).toBe(
        "info",
      );
      expect(read('{"@message":"error","@level":"info"}')).toBe("info");
    });

    /*
     * Prose is not a preamble. A bare word followed by a space ends it, which
     * is the mechanism the whole escalation class rests on.
     */
    test("a bare word followed by a space ends the preamble", () => {
      expect(read("Connection error, retrying in 5s")).toBeNull();
      expect(read("Recovered from panic, continuing")).toBeNull();
      expect(read("Error, connection refused")).toBe("Error");
      expect(read("myapp - INFO - ready")).toBe("INFO");
    });

    /*
     * A time is read once, at the start of the line (after a bracket or a
     * colour code), with its letters: the T and Z of RFC 3339, a zone's
     * abbreviation, ctime's day and month. Anywhere else those letters are
     * words like any other, so prose after a time is still prose.
     */
    test("reads past a time at the start of the line, and only there", () => {
      expect(read("2026-11-23T18:58:14.670Z [INFO]  core: updated")).toBe(
        "INFO",
      );
      expect(read("2026-11-23T18:58:14.670Z\twarn\tx")).toBe("warn");
      expect(read("2026-11-23T18:58:14.670+01:00 INFO x")).toBe("INFO");
      expect(read("[2026-11-26T04:02:18Z INFO  my_service] x")).toBe("INFO");
      expect(read("2026-11-26 04:02:18.906 GMT [27] LOG:  x")).toBe("LOG");
      expect(read("[Thu Nov 26 04:02:18.123456 2026] [core:error] x")).toBe(
        "error",
      );
      expect(read("2026-11-23T18:58:14.670Z connection error")).toBeNull();
      expect(read("seen at 2026-11-23T18:58:14.670Z [INFO] x")).toBeNull();
      // A zone is a zone only by name, and only in its own case.
      expect(read("2026-11-26 04:02:18 NO ERROR was found")).toBeNull();
      expect(read("2026-11-26 04:02:18 utc [27] LOG:  x")).toBeNull();
    });

    test("reads a level between colour codes", () => {
      expect(read("\u001b[32mINFO\u001b[0m starting")).toBe("INFO");
      expect(read("\u001b[1;31mERROR\u001b[0m: x")).toBe("ERROR");
      expect(read("\u001b[2m2026-11-26T04:02:18.123456Z\u001b[0m \u001b[33m WARN\u001b[0m x")).toBe(
        "WARN",
      );
    });

    test("reads PostgreSQL's LOG only in capitals", () => {
      expect(read("LOG:  checkpoint complete")).toBe("LOG");
      expect(read("log: exiting because of error")).toBeNull();
      expect(read("Log rotated")).toBeNull();
    });

    test("reads a level that is the last thing on the line, newline or not", () => {
      for (const body of [
        "2026-08-31 07:25:04 ERROR",
        "2026-08-31 07:25:04 ERROR\n",
        "level=error",
        "level=error\n",
        "[WARN]",
        "[WARN]\n",
      ]) {
        expect(read(body)).not.toBeNull();
      }
    });

    /*
     * The recombine operator glues a stack trace into one record, so the body
     * is multi-line. The preamble branch is anchored with `^` and no pattern
     * is in multiline mode, so only the FIRST line can supply a preamble level.
     */
    test("only the first line of a recombined body can carry a preamble level", () => {
      expect(read("[INFO] request finished\n    ERROR in frame\n")).toBe("INFO");
      expect(read("Server started\n    at Foo.bar\n    ERROR here\n")).toBeNull();
    });
  });

  /*
   * THE REGRESSION BLOCK FOR THE UNANCHORED SCAN. Every line below is one
   * the unanchored keyword scan got wrong, in the direction it got it wrong,
   * kept asserting the fixed behaviour so a widening of the patterns cannot
   * undo it. On stderr those lines now have no severity, rather than the
   * old stream guess of Error.
   */
  describe("regression: what the unanchored keyword scan got wrong", () => {
    const severityOf = (body, stream) => {
      return classify(operators, body, stream).severity;
    };

    test("does not escalate benign stdout prose", () => {
      expect(
        severityOf('{"status":"ok","error":null,"took_ms":12}\n', "stdout"),
      ).toBe("Information");
      expect(
        severityOf(
          '{"error":"conn refused","level":"info","msg":"retry"}\n',
          "stdout",
        ),
      ).toBe("Information");
      expect(severityOf("Recovered from panic, continuing\n", "stdout")).toBe(
        "Information",
      );
      expect(severityOf("Connection error, retrying in 5s\n", "stdout")).toBe(
        "Information",
      );
    });

    test("does not invert a real error into Information", () => {
      expect(
        severityOf(
          'level=error msg="upstream returned info, aborting" component=proxy\n',
          "stderr",
        ),
      ).toBe("Error");
    });

    test("reads the two most severe PSR-3 levels", () => {
      expect(
        severityOf("[2026-08-31 07:25:04] app.EMERGENCY: site down\n", "stdout"),
      ).toBe("Fatal");
      expect(
        severityOf("[2026-08-31 07:25:04] app.ALERT: replica lag\n", "stdout"),
      ).toBe("Fatal");
      expect(severityOf("2026/08/31 [emerg] 1#1: bind() failed\n", "stdout")).toBe(
        "Fatal",
      );
    });

    test("Docker and Podman agree on a body that ends on its level", () => {
      const docker = "Import finished, level=error\n";
      const podman = "Import finished, level=error";

      expect(severityOf(docker, "stdout")).toBe(severityOf(podman, "stdout"));
      expect(severityOf(docker, "stdout")).toBe("Error");
    });

    test.each([
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
      "    at com.example.Foo.bar(Foo.java:42)",
      "npm notice New minor version of npm available!",
      "Compiled successfully in 1240ms",
      "Shutting down gracefully",
    ])("level-free stdout stays Information: %s", (body) => {
      expect(classify(operators, body, "stdout")).toMatchObject({
        reader: "add-fallback-severity",
        severity: "Information",
      });
    });
  });

  /*
   * The patterns run on every log line the agent ships, and the Kubernetes
   * API-mode tailer runs the same source through JavaScript's BACKTRACKING
   * engine rather than RE2. A pattern that is linear in RE2 can still be
   * exponential there (two alternatives of a repetition that can split the
   * same text two ways), or quadratic (two repetitions next to each other
   * that can share it). At this size a linear reader takes a few
   * milliseconds and a quadratic one seconds.
   */
  test.each(Object.keys(PATHOLOGICAL))(
    "every reader is linear on pathological input: %s",
    (shape) => {
      const body = PATHOLOGICAL[shape](30000);

      for (const route of router.routes) {
        if (route.expr === STDOUT_ROUTE_EXPR) {
          continue;
        }

        const regex = compileRe2AsJs(extractMatchesPattern(route.expr));
        const started = process.hrtime.bigint();

        regex.exec(body);

        const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

        expect([route.output, elapsedMs < 1000]).toEqual([route.output, true]);
      }
    },
  );
});

describe("issue #10972: what the chain as shipped in 17.0.0 did", () => {
  /*
   * Each case's `before` is what OneUptime stored it as with the chain as it
   * shipped in 17.0.0. Checking it against that chain is what makes every
   * case whose `before` differs from its `severity` a real regression test:
   * it is proven to have been misread, and is asserted above to be read
   * right now.
   */
  test.each(
    CASES.map((entry) => {
      return [entry.name, entry];
    }),
  )("as shipped: %s", (name, entry) => {
    expect(severityAsShippedIn17(entry.body, entry.stream)).toBe(entry.before);
  });

  test("stored the issue's five lines as Error", () => {
    const issueLines = CASES.filter((entry) => {
      return entry.name.startsWith("#10972 ");
    });

    expect(issueLines).toHaveLength(5);

    for (const entry of issueLines) {
      expect(severityAsShippedIn17(entry.body, entry.stream)).toBe("Error");
    }

    expect(
      issueLines.map((entry) => {
        return entry.severity;
      }),
    ).toEqual(["Information", "Information", "Warning", "Information", "Information"]);
  });

  test("misread most of the corpus, and in both directions", () => {
    const misread = CASES.filter((entry) => {
      return entry.before !== entry.severity;
    });
    const raisedToError = misread.filter((entry) => {
      return entry.before === "Error";
    });
    const hiddenAsInformation = misread.filter((entry) => {
      return (
        entry.before === "Information" &&
        ["Warning", "Error", "Fatal"].includes(entry.severity)
      );
    });

    expect(misread.length).toBeGreaterThan(60);
    // Lines that say INFO, WARN, DEBUG or nothing, stored as Error...
    expect(raisedToError.length).toBeGreaterThan(40);
    // ...and lines that say WARN or ERROR, stored as Information.
    expect(hiddenAsInformation.length).toBeGreaterThan(15);
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
  test.each([...CONFIGS.keys()].slice(1))("%s matches DockerAgent", (source) => {
    expect(severityChain(source, CONFIGS.get(source))).toEqual(
      severityChain("DockerAgent", CONFIGS.get("DockerAgent")),
    );
  });
});

describe("the helpers this suite reads the chain with", () => {
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
    expect(unescapeGoStringLiteral("\\\\x1b\\\\x27")).toBe("\\x1b\\x27");
  });

  /*
   * The failure this catches: writing a route's pattern with the parser's
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

  test("lists what a severity_text group can capture, nested groups and classes included", () => {
    expect(
      severityKeywordsFromRegex("(?i)x(?P<severity_text>INFO|(?-i:LOG)|WARN)y"),
    ).toEqual(["INFO", "LOG", "WARN"]);
    expect(severityKeywordsFromRegex("^(?P<severity_text>[IWEF])\\d")).toEqual([
      "I",
      "W",
      "E",
      "F",
    ]);
    expect(severityKeywordsFromRegex('"level":(?P<severity_text>[1-6]0)[,}]')).toEqual(
      ["10", "20", "30", "40", "50", "60"],
    );
    expect(() => {
      return severityKeywordsFromRegex("(?P<severity_text>IN+FO)");
    }).toThrow(/cannot list/);
  });

  test("refuses a chain whose parser cannot parse what its route admits", () => {
    const drifted = [
      {
        type: "router",
        id: "severity-router",
        routes: [{ output: "parse", expr: 'body matches "^x"' }],
        default: "end",
      },
      {
        type: "regex_parser",
        id: "parse",
        regex: "^(?P<severity_text>y)",
        output: "severity-parser",
      },
      { type: "severity_parser", id: "severity-parser" },
      { type: "noop", id: "end" },
    ];

    expect(() => {
      return classify(drifted, "x", "stdout");
    }).toThrow(/cannot parse a body its route admitted/);
  });
});
