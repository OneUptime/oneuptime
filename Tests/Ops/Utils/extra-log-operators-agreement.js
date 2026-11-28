"use strict";

/**
 * logs.extraOperators (issue #11225): the Kubernetes agent chart's verdict on
 * an operator, held to the collector's own. Run by
 * Tests/Ops/validate-collector-configs.sh, which has Helm and Docker.
 *
 * Each case below is operators as a user would write them, with what the
 * chart must do (render them, or refuse them with a message that matches)
 * and what the pinned collector's `validate` must do with the same operators
 * in a filelog receiver of their own, ahead of a noop named severity-router,
 * where the chart hands lines on to the agent's chain:
 *
 *   - "takes", "takes": the chart renders what the collector runs;
 *   - "refuses", "refuses": the chart refuses at install time what would stop
 *     the collector, which is why it checks at all;
 *   - "refuses", "takes": a refusal of the chart's own, for a reason it gives
 *     (a level the agent would overwrite, a router that would drop lines, a
 *     format the agent has read already).
 *
 * Usage: node extra-log-operators-agreement.js <chart dir> <work dir> <collector image>
 * Prints one line a case, and exits 1 when any verdict is not the one written.
 */

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const {
  DOCUMENTED_EXAMPLE,
  ONE_OF_EACH,
} = require("./ExtraLogOperatorExamples.js");

const [chart, workDir, image] = process.argv.slice(2);
const B = "\\";

const CASES = [
  // ----- The chart renders what the collector runs -------------------------
  ["the documented example", DOCUMENTED_EXAMPLE, "takes", "takes"],
  ["one of each type the chart takes", ONE_OF_EACH, "takes", "takes"],
  [
    "an add with no value",
    [{ type: "add", field: "attributes.marker" }],
    "takes",
    "takes",
  ],
  [
    "every field spelling",
    [
      { type: "copy", from: "body.app.level", to: 'attributes["app.level"]' },
      {
        type: "copy",
        from: "attributes['app.level']",
        to: 'resource["k8s.app.level"]',
      },
      {
        type: "move",
        from: 'attributes["app"].team',
        to: "attributes.team.name",
      },
      { type: "remove", field: "resource" },
      { type: "retain", fields: ["body", "attributes.", "attributes.level"] },
    ],
    "takes",
    "takes",
  ],
  [
    "a whole map where the collector takes one: a remove's field, a parse_to",
    [
      { type: "remove", field: "attributes" },
      { type: "json_parser", parse_to: "resource", if: 'body startsWith "{"' },
    ],
    "takes",
    "takes",
  ],
  [
    "a regex's backslash twice, and in a raw string",
    [
      {
        type: "noop",
        if: `body matches "^${B}${B}d+ " or body matches \`^${B}d+ \``,
      },
    ],
    "takes",
    "takes",
  ],
  [
    "Go's escapes, a lone surrogate, octal, a class with backspace",
    [
      {
        type: "noop",
        if: `body matches "${B}x41${B}101${B}u00e9${B}uD800${B}U0010FFFF[${B}b${B}t]"`,
      },
    ],
    "takes",
    "takes",
  ],
  [
    "comments, and a // inside a string",
    [
      {
        type: "noop",
        if: 'body matches "https?://x" // a quote " in a comment',
      },
    ],
    "takes",
    "takes",
  ],
  [
    "an unended \\Q, and a brace RE2 reads as text",
    [
      {
        type: "regex_replace",
        field: "body",
        regex: `${B}Q[[x]]`,
        replace_with: "",
      },
      {
        type: "regex_parser",
        regex: "(?i)^(?P<severity_text>warn) a{2,",
        on_error: "send_quiet",
      },
    ],
    "takes",
    "takes",
  ],
  [
    "a (?<name>...) group, on the pinned collector",
    [
      {
        type: "regex_parser",
        regex: `^(?<severity_text>${B}w+) `,
        on_error: "send_quiet",
      },
    ],
    "takes",
    "takes",
  ],
  [
    "a type's name with a number, which the collector steps around",
    [
      { type: "move", from: "body", to: "attributes.x" },
      { type: "move", from: "attributes.x", to: "attributes.y" },
      { type: "noop", id: "move1" },
    ],
    "takes",
    "takes",
  ],
  [
    "outputs to later ones of yours",
    [
      { type: "noop", output: ["second", "third"] },
      { type: "noop", id: "second", output: "severity-router" },
      { type: "noop", id: "third" },
    ],
    "takes",
    "takes",
  ],

  // ----- The chart refuses what would stop the collector -------------------
  [
    "a move with no to",
    [{ type: "move", from: "attributes.lvl" }],
    /\(move\) has no to/,
    "refuses",
  ],
  [
    "a copy with no from",
    [{ type: "copy", to: "attributes.lvl" }],
    /\(copy\) has no from/,
    "refuses",
  ],
  [
    "a remove with no field",
    [{ type: "remove" }],
    /\(remove\) has no field/,
    "refuses",
  ],
  [
    "a retain with no fields",
    [{ type: "retain", fields: [] }],
    /\(retain\) has no fields/,
    "refuses",
  ],
  [
    "a flatten with no field",
    [{ type: "flatten" }],
    /\(flatten\) has no field/,
    "refuses",
  ],
  [
    "an assign_keys with no keys",
    [{ type: "assign_keys", field: "body" }],
    /\(assign_keys\) has no keys/,
    "refuses",
  ],
  [
    "a filter with no expr",
    [{ type: "filter" }],
    /\(filter\) has no expr/,
    "refuses",
  ],
  [
    "a recombine with no combine_field",
    [{ type: "recombine", is_first_entry: 'body matches "^x"' }],
    /\(recombine\) has no combine_field/,
    "refuses",
  ],
  [
    "a recombine with neither first nor last",
    [{ type: "recombine", combine_field: "body" }],
    /takes one of is_first_entry and is_last_entry/,
    "refuses",
  ],
  [
    "a recombine with both",
    [
      {
        type: "recombine",
        combine_field: "body",
        is_first_entry: 'body matches "^x"',
        is_last_entry: 'body matches "y$"',
      },
    ],
    /takes one of is_first_entry and is_last_entry/,
    "refuses",
  ],
  [
    "a regex_parser with no regex",
    [{ type: "regex_parser" }],
    /\(regex_parser\) has no regex/,
    "refuses",
  ],
  [
    "a regex_replace with no regex or name",
    [{ type: "regex_replace", field: "body" }],
    /takes a regex or a regex_name, one of them/,
    "refuses",
  ],
  [
    "a regex_replace with both",
    [
      {
        type: "regex_replace",
        field: "body",
        regex: "a",
        regex_name: "ansi_control_sequences",
      },
    ],
    /takes a regex or a regex_name, one of them/,
    "refuses",
  ],
  [
    "a regex_name the collector does not know",
    [{ type: "regex_replace", field: "body", regex_name: "ansi" }],
    /knows ansi_control_sequences only/,
    "refuses",
  ],
  [
    "a csv_parser with no header",
    [{ type: "csv_parser" }],
    /no header and no header_attribute/,
    "refuses",
  ],
  [
    "a time_parser with no layout",
    [{ type: "time_parser", parse_from: "attributes.t" }],
    /\(time_parser\) has no layout/,
    "refuses",
  ],
  [
    "a layout_type that is none",
    [
      {
        type: "time_parser",
        parse_from: "attributes.t",
        layout_type: "go",
        layout: "2006",
      },
    ],
    /takes strptime, gotime or epoch/,
    "refuses",
  ],
  [
    "a field that is not body, attributes or resource",
    [{ type: "add", field: "attribute.x", value: "y" }],
    /'s field is 'attribute\.x', which is no field/,
    "refuses",
  ],
  [
    "a bare name for a field",
    [{ type: "move", from: "attributes.lvl", to: "severity_text" }],
    /'s to is 'severity_text', which is no field/,
    "refuses",
  ],
  [
    "a bracket without a quoted name",
    [{ type: "json_parser", parse_to: "attributes.a[b]" }],
    /'s parse_to is 'attributes\.a\[b\]'/,
    "refuses",
  ],
  [
    "a whole map as a retain's field",
    [{ type: "retain", fields: ["attributes"] }],
    /'s fields\[0\] is 'attributes', the whole map/,
    "refuses",
  ],
  [
    "a whole map as a move's to",
    [{ type: "move", from: "body", to: "resource" }],
    /'s to is 'resource', the whole map/,
    "refuses",
  ],
  [
    "an on_error that is no mode",
    [{ type: "json_parser", on_error: "sendd" }],
    /'s on_error is 'sendd'/,
    "refuses",
  ],
  [
    "a regex's backslash once in an expression",
    [{ type: "noop", if: `body matches "^${B}d+"` }],
    /holds \\d in the string/,
    "refuses",
  ],
  [
    "\\? in an expression's string",
    [{ type: "noop", if: `body matches "a${B}?"` }],
    /holds \\\? in the string/,
    "refuses",
  ],
  [
    "\\' in a double-quoted string",
    [{ type: "noop", if: `body matches "it${B}'s"` }],
    /holds \\' in the string/,
    "refuses",
  ],
  [
    "an octal escape past \\377",
    [{ type: "noop", if: `body matches "${B}401"` }],
    /holds \\4 in the string/,
    "refuses",
  ],
  [
    "a code point past \\U0010FFFF",
    [{ type: "noop", if: `body == "${B}U00110000"` }],
    /holds \\U in the string/,
    "refuses",
  ],
  [
    "a regex after matches that does not compile",
    [{ type: "noop", if: 'body matches "[A-Z"' }],
    /if matches a regex the collector cannot compile: '\[A-Z'/,
    "refuses",
  ],
  [
    "a lookahead after matches, in a raw string",
    [{ type: "noop", if: "body matches `(?=x)`" }],
    /if matches a regex the collector cannot compile/,
    "refuses",
  ],
  [
    "a possessive quantifier after matches",
    [{ type: "noop", if: 'body matches "a++"' }],
    /if matches a regex the collector cannot compile/,
    "refuses",
  ],
  [
    "a repeat count past a thousand after matches",
    [{ type: "noop", if: 'body matches "x{1001}"' }],
    /if matches a regex the collector cannot compile/,
    "refuses",
  ],
  [
    "a route's regex that does not compile",
    [
      {
        type: "router",
        routes: [{ expr: 'body matches "^SEV[12"', output: "severity-router" }],
        default: "severity-router",
      },
    ],
    /routes\[0\]\.expr matches a regex the collector cannot compile/,
    "refuses",
  ],
  [
    "a regex that does not compile",
    [{ type: "regex_parser", regex: "^(?P<severity_text>[A-Z" }],
    /has a regex the collector cannot compile/,
    "refuses",
  ],
  [
    "a backreference",
    [{ type: "regex_parser", regex: `^(?P<q>a)${B}1` }],
    /has a regex the collector cannot compile/,
    "refuses",
  ],
  [
    "a backslash at a regex's end",
    [{ type: "regex_parser", regex: `^(?P<x>a)${B}` }],
    /has a regex the collector cannot compile/,
    "refuses",
  ],
  [
    "an if that is not a string",
    [{ type: "noop", if: true }],
    /'s if is not an expression/,
    "refuses",
  ],
  [
    "an output that names nothing",
    [{ type: "noop", output: "inhouse" }],
    /hands lines to "inhouse", which is none of your operators/,
    "refuses",
  ],
  [
    "an output back to an operator before it",
    [
      { type: "noop", id: "first" },
      { type: "noop", id: "second", output: "first" },
    ],
    /which is an operator before it, a loop the collector refuses/,
    "refuses",
  ],
  [
    "an output to the operator itself",
    [{ type: "noop", id: "inhouse", output: "inhouse" }],
    /which is itself, a loop the collector refuses/,
    "refuses",
  ],
  [
    "a type's bare name, which one of yours with no id gets",
    [{ type: "noop", id: "json_parser" }, { type: "json_parser" }],
    /the name the collector gives logs\.extraOperators\[1\], an operator of type json_parser with no id/,
    "refuses",
  ],
  [
    "two of yours with one id",
    [
      { type: "noop", id: "inhouse" },
      { type: "noop", id: "inhouse" },
    ],
    /id "inhouse" is another of yours already/,
    "refuses",
  ],

  // ----- Refusals of the chart's own ---------------------------------------
  [
    "a severity_parser, whose level the agent would overwrite",
    [{ type: "severity_parser", parse_from: "attributes.lvl" }],
    /is a severity_parser\. The agent reads every line's level after your operators/,
    "takes",
  ],
  [
    "a syslog_parser, which sets the level itself",
    [{ type: "syslog_parser", protocol: "rfc3164" }],
    /is a syslog_parser, which sets the line's severity itself/,
    "takes",
  ],
  [
    "an otelcol parser, which sets the level itself",
    [{ type: "otelcol" }],
    /is an otelcol parser, which sets the line's severity itself/,
    "takes",
  ],
  [
    "a parser's severity block",
    [
      {
        type: "regex_parser",
        regex: `^(?P<lvl>${B}w+) `,
        severity: { parse_from: "attributes.lvl" },
      },
    ],
    /has a severity block/,
    "takes",
  ],
  [
    "the container parser, for a format the agent has read",
    [{ type: "container" }],
    /is a container parser, but the agent has read the container runtime's format already/,
    "takes",
  ],
  [
    "a router with no default, which drops what no route matches",
    [
      {
        type: "router",
        routes: [{ expr: 'body matches "^x"', output: "severity-router" }],
      },
    ],
    /is a router with no default, and would drop every line none of its routes match/,
    "takes",
  ],
  [
    "a router with no routes, which drops every line",
    [{ type: "router", routes: [], default: "severity-router" }],
    /is a router with no routes, which drops every line/,
    "takes",
  ],
  [
    "a route with no output, which drops what it matches",
    [
      {
        type: "router",
        routes: [{ expr: 'body matches "^x"' }],
        default: "severity-router",
      },
    ],
    /has no expr or no output: each route needs both, and one with no output drops the lines it matches/,
    "takes",
  ],
];

function run(command, args) {
  return childProcess.spawnSync(command, args, { encoding: "utf8" });
}

function chartVerdict(operators) {
  const result = run("helm", [
    "template",
    "validate",
    chart,
    "--set",
    "clusterName=validate-only",
    "--set",
    "oneuptime.url=https://oneuptime.example.com",
    "--set",
    "oneuptime.apiKey=validate-only",
    "--set",
    "logs.enabled=true",
    "--set",
    "logs.mode=daemonset",
    "--set-json",
    `logs.extraOperators=${JSON.stringify(operators)}`,
  ]);

  return { refused: result.status !== 0, message: result.stderr };
}

function collectorVerdict(name, operators) {
  const config = {
    receivers: {
      filelog: {
        include: ["/tmp/agreement-*.log"],
        operators: [...operators, { type: "noop", id: "severity-router" }],
      },
    },
    exporters: { debug: {} },
    service: {
      telemetry: { metrics: { level: "none" } },
      pipelines: { logs: { receivers: ["filelog"], exporters: ["debug"] } },
    },
  };
  // JSON is YAML; written apart from everything else, readable by the image's user.
  const file = path.join(workDir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(config));
  fs.chmodSync(file, 0o644);
  const result = run("docker", [
    "run",
    "--rm",
    "-v",
    `${workDir}:/agreement:ro`,
    image,
    "validate",
    `--config=/agreement/${name}.json`,
  ]);

  return {
    refused: result.status !== 0,
    message: `${result.stdout}${result.stderr}`,
  };
}

fs.mkdirSync(workDir, { recursive: true });
fs.chmodSync(workDir, 0o755);
let mismatches = 0;

CASES.forEach(([label, operators, chartWants, collectorWants], index) => {
  const chartSays = chartVerdict(operators);
  const collectorSays = collectorVerdict(`case-${index}`, operators);
  const problems = [];

  if (chartWants === "takes" && chartSays.refused) {
    problems.push(`the chart refused it: ${chartSays.message.trim()}`);
  }
  if (chartWants instanceof RegExp) {
    if (!chartSays.refused) {
      problems.push("the chart took it");
    } else if (!chartWants.test(chartSays.message)) {
      problems.push(
        `the chart refused it with another message: ${chartSays.message.trim()}`,
      );
    }
  }
  if ((collectorWants === "refuses") !== collectorSays.refused) {
    problems.push(
      collectorSays.refused
        ? `the collector refused it: ${collectorSays.message.trim().split("\n").pop()}`
        : "the collector took it",
    );
  }

  if (problems.length > 0) {
    mismatches += 1;
    console.log(`    FAILED: ${label}\n      ${problems.join("\n      ")}`);
  } else {
    console.log(
      `    ok: ${label} (chart ${chartWants === "takes" ? "takes" : "refuses"}, collector ${collectorWants})`,
    );
  }
});

console.log(
  `${CASES.length - mismatches} of ${CASES.length} verdicts as written`,
);
process.exit(mismatches === 0 ? 0 : 1);
