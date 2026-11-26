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
const SEVERITY_READERS = OTLPBatcherModule.SEVERITY_READERS;

/*
 * The corpus the collector chain is tested with (real lines, many of them
 * captured from the programs that write them), so the two Kubernetes log
 * modes are held to the same lines.
 */
const { CASES, PROSE } = require(
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "Tests",
    "Ops",
    "Utils",
    "LogSeverityCorpus.js",
  ),
);

// The Kubernetes pods/log API merges stdout and stderr, so LogStream always
// reports "stdout" in this mode: anything no reader reads lands on INFO,
// unparsed, and the severity threshold keeps it.
const derive = (body) => {
  return deriveSeverity(body, "stdout");
};

const bucket = (number) => {
  if (number >= 1 && number <= 4) {
    return "Trace";
  }
  if (number >= 5 && number <= 8) {
    return "Debug";
  }
  if (number >= 9 && number <= 12) {
    return "Information";
  }
  if (number >= 13 && number <= 16) {
    return "Warning";
  }
  if (number >= 17 && number <= 20) {
    return "Error";
  }
  if (number >= 21 && number <= 24) {
    return "Fatal";
  }
  return "Unspecified";
};

const READER_IDS = SEVERITY_READERS.map((reader) => {
  return reader.id;
});

/*
 * THE CORPUS. A line a reader of the chain reads is read the same here, on
 * either stream, and counts as parsed, so the threshold may drop it. A line
 * no reader reads is INFO, unparsed, and kept: in this mode the stream that
 * would tell stdout from stderr is not there to ask.
 */
for (const entry of CASES) {
  test(`reads it as the collector chain does: ${entry.name}`, () => {
    const result = derive(entry.body);

    if (READER_IDS.includes(entry.reader)) {
      assert.equal(result.parsed, true, `body: ${entry.body}`);
      assert.equal(
        bucket(result.number),
        entry.severity,
        `body: ${entry.body}`,
      );
    } else {
      assert.equal(result.parsed, false, `body: ${entry.body}`);
      assert.equal(result.text, "INFO", `body: ${entry.body}`);
    }
  });
}

test("reads no level off prose that merely mentions one", () => {
  for (const body of PROSE) {
    const result = derive(body);

    assert.equal(result.parsed, false, `body: ${body}`);
    assert.equal(result.text, "INFO", `body: ${body}`);
  }
});

test("reads the issue #10972 lines, which the chain read as nothing", () => {
  const issueLines = CASES.filter((entry) => {
    return entry.name.startsWith("#10972 ");
  });

  assert.equal(issueLines.length, 5);
  assert.deepEqual(
    issueLines.map((entry) => {
      return derive(entry.body).text;
    }),
    ["INFO", "INFO", "WARN", "I", "LOG"],
  );
  assert.deepEqual(
    issueLines.map((entry) => {
      return bucket(derive(entry.body).number);
    }),
    ["Information", "Information", "Warning", "Information", "Information"],
  );
});

test("the real level field beats a level word quoted inside the message", () => {
  assert.equal(
    derive(`level=error msg="upstream returned info, aborting" component=proxy`)
      .text,
    "ERROR",
  );
  assert.equal(derive(`{"msg":"error, retrying","level":"info"}`).text, "INFO");
  assert.equal(
    derive(`{"error":"conn refused","level":"info","msg":"retry"}`).text,
    "INFO",
  );
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

/*
 * This mode never sees stderr. Were it handed a stderr line no reader reads,
 * it would do what the collector chain does with one: claim no severity,
 * rather than the Error the chain used to guess.
 */
test("claims no severity for an unread stderr line, as the collector chain does", () => {
  const stderr = deriveSeverity("no level here", "stderr");

  assert.deepEqual(stderr, { text: "", number: 0, parsed: false });
});

/*
 * THE LOCKSTEP CHECK.
 *
 * This module and the DaemonSet's collector chain are the two Kubernetes log
 * modes, and they are meant to classify a line identically — a user switching
 * between them should not see their severities move. Nothing else enforces
 * that: the two were written as copies of one another and had drifted before
 * (NOTICE 9 and CRITICAL 17 in the chain, 10 and 20 here).
 *
 * So the readers, their order and the numbers are all read back out of the
 * Helm template here rather than restated.
 */
const CONFIGMAP_PATH = path.join(
  __dirname,
  "..",
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

/** A YAML single-quoted scalar's value. The patterns carry no ', and if one ever does this naive read is wrong. */
const singleQuoted = (scalar, what) => {
  const match = /^'(.*)'$/.exec(scalar);

  assert.notEqual(
    match,
    null,
    `${what} is not a single-quoted scalar: ${scalar}`,
  );
  assert.equal(
    match[1].includes("''"),
    false,
    `${what} contains an escaped single quote; read it with a YAML parser`,
  );

  return match[1];
};

/** The value of `key:` in the operator with the given id. */
const fieldOfOperator = (id, key) => {
  const lines = configMapLines();
  const start = lines.findIndex((line) => {
    return line.trim() === `id: ${id}`;
  });

  assert.notEqual(start, -1, `no operator with id ${id} in ${CONFIGMAP_PATH}`);

  for (let index = start + 1; index < lines.length; index++) {
    if (/^\s*- type: /.test(lines[index])) {
      break;
    }

    const match = new RegExp(`^\\s*${key}: (.*)$`).exec(lines[index]);

    if (match) {
      return match[1].trim();
    }
  }

  throw new Error(`operator ${id} has no ${key}: line`);
};

/*
 * One layer of Go string-literal escaping off a router route's pattern, as
 * expr-lang reads it: strict, so a pattern written one backslash short is an
 * error rather than a quiet match.
 */
const unescapeGoString = (literal) => {
  let out = "";

  for (let index = 0; index < literal.length; index++) {
    if (literal[index] !== "\\") {
      out += literal[index];
      continue;
    }

    const next = literal[index + 1];

    assert.ok(
      next === "\\" || next === '"',
      `invalid char escape \\${next} in ${literal}`,
    );
    out += next;
    index++;
  }

  return out;
};

/** The router's routes, in order, as [output, expr]. */
const routerRoutes = () => {
  const lines = configMapLines();
  const start = lines.findIndex((line) => {
    return line.trim() === "id: severity-router";
  });

  assert.notEqual(start, -1, `no severity-router in ${CONFIGMAP_PATH}`);

  const routes = [];

  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index].trim();

    if (line.startsWith("default:") || line.startsWith("- type:")) {
      break;
    }

    const output = /^- output: (\S+)$/.exec(line);

    if (output) {
      const expr = /^\s*expr: (.*)$/.exec(lines[index + 1]);

      assert.notEqual(
        expr,
        null,
        `route to ${output[1]} has no expr: on the next line`,
      );
      routes.push([
        output[1],
        singleQuoted(expr[1].trim(), `the route to ${output[1]}`),
      ]);
    }
  }

  return routes;
};

const routePattern = (expr) => {
  const match = /^body matches "(.*)"$/.exec(expr);

  assert.notEqual(match, null, `not a body matches route: ${expr}`);

  return unescapeGoString(match[1]);
};

test("the readers are the chain's routes, in the chain's order, with its patterns", () => {
  const routes = routerRoutes();

  // The chain's last route is its stdout fallback, which this mode does not
  // have: it cannot tell stdout from stderr.
  assert.deepEqual(
    routes.map(([output]) => {
      return output;
    }),
    [...READER_IDS, "add-fallback-severity"],
  );

  for (const reader of SEVERITY_READERS) {
    const [, expr] = routes.find(([output]) => {
      return output === reader.id;
    });

    assert.equal(
      routePattern(expr),
      reader.pattern.replace("(?P<severity_text>", "("),
      `the route to ${reader.id}`,
    );

    if (reader.level) {
      assert.equal(
        fieldOfOperator(reader.id, "value"),
        reader.level,
        reader.id,
      );
    } else {
      assert.equal(
        singleQuoted(
          fieldOfOperator(reader.id, "regex"),
          `${reader.id}'s regex`,
        ),
        reader.pattern,
        reader.id,
      );
    }
  }
});

/**
 * The `mapping:` block of the severity_parser, as {alias: level}. Read as text
 * because this package deliberately carries no YAML parser, and the block is a
 * fixed two-level shape: `level:` followed by `- alias` items (a number
 * quoted, so YAML reads it as text).
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

    const aliasMatch = /^\s*-\s*"?([^"\s]+)"?\s*$/.exec(line);

    assert.notEqual(aliasMatch, null, `unparsed mapping line: ${line}`);
    assert.notEqual(level, null, `alias before any level: ${line}`);

    aliases[aliasMatch[1].toLowerCase()] = level;
  }

  assert.ok(Object.keys(aliases).length > 0, "mapping: block is empty");

  return aliases;
};

/*
 * stanza's built-in `default` preset, the base the config's own `mapping:`
 * block is layered on: these eight level names (and the numbers 1-24, which
 * the mapping overrides for pino's 10 and 20) and NOTHING else.
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

/** Every text a reader can produce: its fixed level, or what its group can capture. */
const textsOf = (reader) => {
  if (reader.level) {
    return [reader.level];
  }

  if (reader.id === "parse-klog-severity") {
    return ["I", "W", "E", "F"];
  }

  if (reader.id === "parse-numeric-severity") {
    return ["10", "20", "30", "40", "50", "60"];
  }

  const start =
    reader.pattern.indexOf("(?P<severity_text>") + "(?P<severity_text>".length;
  const end = reader.pattern.indexOf(")(?:$|", start);

  return reader.pattern
    .slice(start, end)
    .replace("(?-i:LOG)", "LOG")
    .split("|");
};

test("every text a reader produces gets the number the collector chain gives it", () => {
  const aliases = severityParserMapping();
  const texts = SEVERITY_READERS.flatMap(textsOf);

  assert.ok(texts.length >= 40, `only ${texts.length} texts`);

  for (const text of texts) {
    const lower = text.toLowerCase();
    // What the collector resolves it to: the config's mapping block, else the
    // built-in preset. Anything else leaves the record Unspecified.
    const level = aliases[lower] || (STANZA_BUILTIN[lower] ? lower : null);

    assert.notEqual(
      level,
      null,
      `${text} resolves to no severity in the collector chain`,
    );

    const collectorNumber = STANZA_BUILTIN[level];

    assert.notEqual(
      collectorNumber,
      undefined,
      `mapping sends ${text} to unknown level ${level}`,
    );
    assert.equal(
      severityTextToNumber[text.toUpperCase()],
      collectorNumber,
      `${text}: this mode says ${severityTextToNumber[text.toUpperCase()]}, the collector chain says ${collectorNumber}`,
    );
  }
});

/*
 * The readers run on every line this tailer ships, in JavaScript's
 * backtracking engine. Shapes that could make one of them quadratic or
 * exponential must stay cheap.
 */
test("every reader is linear on pathological input", () => {
  const bodies = [
    "\u001b[0m".repeat(30000) + "x",
    "0Z -".repeat(30000),
    "2026-11-23T18:58:14.670Z,".repeat(5000),
    `{${'"a":"b",'.repeat(20000)}"level":7}`,
    "a.".repeat(30000) + "x",
    "/x:1: ".repeat(20000) + "x",
    `${"[".repeat(30000)}x`,
  ];

  for (const body of bodies) {
    const started = process.hrtime.bigint();

    derive(body);

    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    assert.ok(
      elapsedMs < 1000,
      `${elapsedMs} ms on ${JSON.stringify(body.slice(0, 20))}...`,
    );
  }
});
