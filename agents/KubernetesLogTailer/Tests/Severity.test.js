// Config reads these at require time; OTLPBatcher pulls MIN_SEVERITY from it.
process.env.ONEUPTIME_URL = "http://test.invalid";
process.env.ONEUPTIME_API_KEY = "test-key";
process.env.CLUSTER_NAME = "test-cluster";
process.env.LOG_LEVEL = "error";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const OTLPBatcherModule = require("../build/dist/OTLPBatcher");

const deriveSeverity = OTLPBatcherModule.deriveSeverity;
const severityTextToNumber = OTLPBatcherModule.severityTextToNumber;
const SEVERITY_PATTERN = OTLPBatcherModule.SEVERITY_PATTERN;

// The Kubernetes pods/log API merges stdout and stderr, so LogStream always
// reports "stdout" in this mode. Every case below therefore uses "stdout":
// anything the regex fails to read off the body lands on INFO, unparsed.
const derive = (body) => {
  return deriveSeverity(body, "stdout");
};

const parsedAs = (body, text) => {
  const result = derive(body);

  assert.equal(result.text, text, `body: ${body}`);
  assert.equal(result.parsed, true, `body: ${body}`);
};

const notParsed = (body) => {
  const result = derive(body);

  assert.equal(result.parsed, false, `body: ${body}`);
  assert.equal(result.text, "INFO", `body: ${body}`);
};

test("reads the level out of PSR-3 / Monolog lines", () => {
  parsedAs(
    `[2026-08-31 07:25:04] app.INFO: user logged in {"id":7} []`,
    "INFO",
  );
  parsedAs("[2026-08-31 07:25:04] request.WARNING: slow response", "WARNING");
  parsedAs("[2026-08-31 07:25:04] app.ERROR: connection refused", "ERROR");
  parsedAs("[2026-08-31 07:25:04] doctrine.DEBUG: SELECT 1", "DEBUG");
  parsedAs("[2026-08-31 07:25:04] php.CRITICAL: out of memory", "CRITICAL");
});

// Monolog defines eight levels. The list carried six until the keyword scan was
// made field-aware, so the two ABOVE critical — the ones a human most wants to
// see — were the two the agent could not read.
test("reads the two PSR-3 levels above CRITICAL", () => {
  parsedAs("[2026-08-31 07:25:04] app.ALERT: replica lag", "ALERT");
  parsedAs("[2026-08-31 07:25:04] app.EMERGENCY: site is down", "EMERGENCY");
  // nginx spells emergency [emerg].
  parsedAs("2026/08/31 07:25:04 [emerg] 1#1: bind() failed", "EMERG");

  assert.equal(derive("[ALERT] x").number, 21);
  assert.equal(derive("[EMERG] x").number, 21);
  assert.equal(derive("[EMERGENCY] x").number, 21);
});

test("reads the level out of zap / logrus / slog JSON lines", () => {
  parsedAs(`{"level":"info","ts":1756628704.1,"msg":"started"}`, "INFO");
  parsedAs(`{"level":"warn","ts":1756628704.1,"msg":"retrying"}`, "WARN");
  parsedAs(`{"level":"error","ts":1756628704.1,"msg":"conn refused"}`, "ERROR");
  parsedAs(
    `{"level":"info","msg":"hello","time":"2026-08-31T07:25:04Z"}`,
    "INFO",
  );
  parsedAs(
    `{"time":"2026-08-31T07:25:04Z","level":"INFO","msg":"ready"}`,
    "INFO",
  );
});

// The key does not have to be spelled "level".
test("reads the other names structured loggers give the level field", () => {
  parsedAs(`{"severity":"ERROR","message":"boom"}`, "ERROR");
  parsedAs(`{"severity_text":"WARN","message":"x"}`, "WARN");
  parsedAs(`{"log.level":"warn","message":"x"}`, "WARN");
  parsedAs(`{"log_level":"debug","message":"x"}`, "DEBUG");
  parsedAs(`{"levelname":"DEBUG","msg":"x"}`, "DEBUG");
  parsedAs("lvl=warn msg=x", "WARN");
});

/*
 * logfmt — Grafana, Traefik, Prometheus, Loki, the Docker daemon and the
 * HashiCorp tools. `=` used to be a TRAILING delimiter and not a leading one,
 * so `level=error` could never be captured while a level word later in the same
 * message could. A genuine error was therefore stored as Information: not noise
 * but a hidden error, the worse of the two failure directions.
 */
test("reads a logfmt level, wherever in the line it sits", () => {
  parsedAs("level=info msg=ready", "INFO");
  parsedAs("level=error msg=boom", "ERROR");
  parsedAs(`level="error" msg=boom`, "ERROR");
  parsedAs(`time="2026-08-31T07:25:04Z" level=error msg=x`, "ERROR");
  parsedAs(
    "ts=2026-08-31T07:25:04Z caller=main.go:42 level=warn msg=x",
    "WARN",
  );
  parsedAs("component=proxy level=error msg=x", "ERROR");
});

test("the real level field beats a level word quoted inside the message", () => {
  parsedAs(
    `level=error msg="upstream returned info, aborting" component=proxy`,
    "ERROR",
  );
  parsedAs(`{"msg":"error, retrying","level":"info"}`, "INFO");
  // logrus WithError(err).Info(...) — logged AT info, and now stored at info.
  parsedAs(`{"error":"conn refused","level":"info","msg":"retry"}`, "INFO");
});

test("still reads the shapes that already worked", () => {
  parsedAs("[ERROR] something bad happened", "ERROR");
  parsedAs("WARN: disk almost full", "WARN");
  parsedAs("2026-08-31 07:25:04 INFO starting up", "INFO");
  parsedAs("[INFO] plugin/reload: Running configuration MD5", "INFO");
  parsedAs("2026/08/31 07:25:04 [error] 12#12: *1 open() failed", "ERROR");
  parsedAs("2026-08-31 07:25:04,123 - myapp - INFO - ready", "INFO");
  parsedAs("07:25:04.123 [main] INFO  c.e.App - started", "INFO");
  parsedAs("info: Microsoft.Hosting.Lifetime[14]", "INFO");
});

/*
 * The keyword needed a trailing delimiter that had to be CONSUMED, so a line
 * ending on its level only matched when something followed it. That is how
 * Docker (json-file keeps the newline in the `log` field) and Podman (CRI does
 * not) came to disagree about the same line. End-of-body is now a delimiter in
 * its own right, so the two agree and this mode agrees with both.
 */
test("reads a level that is the last thing on the line", () => {
  parsedAs("2026-08-31 07:25:04 ERROR", "ERROR");
  parsedAs("2026-08-31 07:25:04 ERROR\n", "ERROR");
  parsedAs("level=error", "ERROR");
  parsedAs("[WARN]", "WARN");
});

test("leaves a line with no level unparsed so the threshold cannot drop it", () => {
  notParsed("Server listening on port 8080");
  notParsed("    at com.example.Foo.bar(Foo.java:42)");
  notParsed("GET https://api.example.com/v1/errors?x=1 200");
  notParsed("there were 3 errors");
  notParsed("informational message");
  notParsed("loaded config from /etc/app/warning.yaml");
  notParsed("service.warning.example.com resolved");
  // klog's single-letter prefix needs its own letter-to-level mapping.
  notParsed("I0831 07:25:04.123456       1 server.go:100] Serving");
});

/*
 * The scan used to take the leftmost level word ANYWHERE in the body, so an
 * ordinary stdout line that merely mentioned one was escalated. In a scratch
 * corpus of 30 level-less container lines, 11 were reclassified. These are the
 * ones from that corpus that hurt most.
 */
test("does not escalate a benign line that merely mentions a level word", () => {
  notParsed(`{"status":"ok","error":null,"took_ms":12}`);
  notParsed("Recovered from panic, continuing");
  notParsed("Connection error, retrying in 5s");
  notParsed("Import finished with status: ERROR");
  notParsed("log level is set to WARN");
  notParsed("An error occurred while doing the thing");
  notParsed("failed to fetch: 3 errors occurred");
  notParsed("Deprecation warning in module foo");
  notParsed("No errors found");
  notParsed("the error rate is low");
  notParsed("curl -sS http://x/ --level=info");
});

test("maps every alias onto the OTel severity number for its level", () => {
  assert.equal(derive("[WARN] x").number, derive("[WARNING] x").number);
  assert.equal(derive("[ERR] x").number, derive("[ERROR] x").number);
  assert.equal(derive("[CRIT] x").number, derive("[CRITICAL] x").number);
  assert.equal(derive("[PANIC] x").number, derive("[FATAL] x").number);
  assert.equal(derive("[TRACE] x").number, 1);
  assert.equal(derive("[DEBUG] x").number, 5);
  assert.equal(derive("[INFO] x").number, 9);
  assert.equal(derive("[NOTICE] x").number, 9);
  assert.equal(derive("[CRIT] x").number, 17);
});

test("falls back to the stream when the body carries no level", () => {
  const stderr = deriveSeverity("no level here", "stderr");

  assert.equal(stderr.text, "ERROR");
  assert.equal(stderr.parsed, false);
});

/*
 * THE LOCKSTEP CHECK.
 *
 * This module and the DaemonSet's collector chain are the two Kubernetes log
 * modes, and they are meant to classify a line identically — a user switching
 * between them should not see their severities move. Nothing enforced that:
 * the two were written as copies of one another and had already drifted, the
 * chain numbering NOTICE 9 and CRITICAL 17 while this file numbered them 10 and
 * 20. Both bucket to the same OneUptime LogSeverity today, which is exactly why
 * the drift went unnoticed for as long as it did.
 *
 * So the pattern and the severity numbers are both read back out of the Helm
 * template here rather than restated.
 */
const CONFIGMAP_PATH = path.join(
  __dirname,
  "..",
  "..",
  "HelmChart",
  "Public",
  "kubernetes-agent",
  "templates",
  "configmap-daemonset.yaml",
);

const configMapLines = () => {
  return fs.readFileSync(CONFIGMAP_PATH, "utf8").split("\n");
};

/** The `regex:` scalar of the operator with the given id. */
const regexOfOperator = (id) => {
  const lines = configMapLines();
  const start = lines.findIndex((line) => {
    return line.trim() === `id: ${id}`;
  });

  assert.notEqual(start, -1, `no operator with id ${id} in ${CONFIGMAP_PATH}`);

  for (let index = start; index < lines.length; index++) {
    const match = /^\s*regex: '(.*)'\s*$/.exec(lines[index]);

    if (match) {
      // A YAML single-quoted scalar escapes a quote by doubling it. The pattern
      // carries none, and if it ever does this naive read would be wrong.
      assert.equal(
        match[1].includes("''"),
        false,
        "regex scalar contains an escaped single quote; read it with a YAML parser",
      );
      return match[1];
    }
  }

  throw new Error(`operator ${id} has no regex: line`);
};

/**
 * The `mapping:` block of the severity_parser, as {alias: level}. Read as text
 * because this package deliberately carries no YAML parser, and the block is a
 * fixed two-level shape: `level:` followed by `- alias` items.
 */
const severityParserMapping = () => {
  const lines = configMapLines();
  const start = lines.findIndex((line) => {
    return line.trim() === "id: severity-parser";
  });

  assert.notEqual(
    start,
    -1,
    `no severity-parser operator in ${CONFIGMAP_PATH}`,
  );

  const mappingIndex = lines.findIndex((line, index) => {
    return index > start && line.trim() === "mapping:";
  });

  assert.notEqual(mappingIndex, -1, "severity-parser has no mapping: block");

  const indentOf = (line) => {
    return line.length - line.trimStart().length;
  };

  const baseIndent = indentOf(lines[mappingIndex]);
  const aliases = {};
  let level = null;

  for (let index = mappingIndex + 1; index < lines.length; index++) {
    const line = lines[index];

    if (line.trim() === "" || line.trim().startsWith("#")) {
      continue;
    }

    if (indentOf(line) <= baseIndent) {
      break;
    }

    const levelMatch = /^\s*([a-z][a-z0-9]*):\s*$/.exec(line);

    if (levelMatch) {
      level = levelMatch[1];
      continue;
    }

    const aliasMatch = /^\s*-\s*(\S+)\s*$/.exec(line);

    assert.notEqual(aliasMatch, null, `unparsed mapping line: ${line}`);
    assert.notEqual(level, null, `alias before any level: ${line}`);

    aliases[aliasMatch[1].toLowerCase()] = level;
  }

  assert.ok(Object.keys(aliases).length > 0, "mapping: block is empty");

  return aliases;
};

/*
 * stanza's built-in `default` preset, which is the base the config's own
 * `mapping:` block is layered on top of. It knows these eight level names (plus
 * the numeric strings and the 2/3/4 variants, which nothing here uses) and
 * NOTHING else — no notice, crit, critical, panic, alert, emerg or emergency.
 */
const STANZA_BUILTIN = {
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  warning: 13,
  error: 17,
  err: 17,
  fatal: 21,
};

test("the pattern is the one the DaemonSet collector chain uses", () => {
  assert.equal(SEVERITY_PATTERN, regexOfOperator("parse-severity-from-body"));
});

test("every keyword resolves to the number the collector chain gives it", () => {
  const alternation = /\(\?P<severity_text>([^)]+)\)/.exec(SEVERITY_PATTERN);

  assert.notEqual(alternation, null, "pattern has no severity_text group");

  const aliases = severityParserMapping();
  const keywords = alternation[1].split("|");

  assert.ok(keywords.length >= 15, `only ${keywords.length} keywords`);

  for (const keyword of keywords) {
    const lower = keyword.toLowerCase();
    // What the collector resolves it to: the built-in preset, else the level
    // the config's mapping block routes it to. Anything else leaves the record
    // Unspecified, which is worse than the stream guess it replaced.
    const level = aliases[lower] || (STANZA_BUILTIN[lower] ? lower : null);

    assert.notEqual(
      level,
      null,
      `${keyword} resolves to no severity in the collector chain`,
    );

    const collectorNumber = STANZA_BUILTIN[level];

    assert.notEqual(
      collectorNumber,
      undefined,
      `mapping sends ${keyword} to unknown level ${level}`,
    );

    assert.equal(
      severityTextToNumber[keyword.toUpperCase()],
      collectorNumber,
      `${keyword}: this mode says ${severityTextToNumber[keyword.toUpperCase()]}, the collector chain says ${collectorNumber}`,
    );

    // And the same keyword read off a real line agrees with the table.
    assert.equal(derive(`[${keyword}] x`).number, collectorNumber);
  }
});
